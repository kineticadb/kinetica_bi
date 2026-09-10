# Pitfalls Research: v1.3 Unified Dashboard Filtering

**Domain:** Adding server-side transient materialized-view filtering to a React/Kinetica BI app that already has v1.2 client-side WHERE-injection infrastructure
**Researched:** 2026-05-06
**Confidence:** HIGH — grounded in codebase analysis of actual v1.2 source files (`filterStore.ts`, `WidgetRenderer.tsx`, `MapChartRenderer.tsx`, `wmsUrlBuilder.spec.ts`, `filterStore.spec.ts`) plus Kinetica official docs (TTL, DDL, WMS API)

---

> **Scope note:** Every pitfall here is specific to *adding* server-side materialize to an existing system that already has v1.2 client-side filter state. Generic React/async pitfalls are excluded. v1.2 pitfalls that could *regress* under v1.3 changes are called out explicitly with a "REGRESSION RISK" marker.

---

## Critical Pitfalls

### V13-P-01: Store Update Before Server Resolve — Widgets Query Non-Existent View

**What goes wrong:**
The intended v1.3 flow is: filter click → debounce → `POST /api/filter/materialize` → server creates view → response returns `{ viewName }` → store updates `views[tableId] = viewName` → widgets re-render with `FROM <viewName>`. If `useFilterViewStore` is updated with the view name *before* the materialize response arrives (e.g., optimistically on click), any widget that re-renders in the 50-300ms window before the server confirms the view exists will issue `SELECT ... FROM _kbi_filt_...` against a view that does not yet exist in Kinetica. Kinetica returns a 400/502 error, the widget flashes an error state, and the user sees a broken dashboard for the duration of the materialize round-trip.

**Why it happens:**
Optimistic updates are a natural React pattern — update the store immediately, confirm later. It feels faster. But unlike a local state mutation, the view name is meaningless until Kinetica has executed the DDL. The "optimistic" update here refers to a Kinetica-side object that doesn't exist yet.

**How to avoid:**
The view name store MUST only be updated after a successful materialize response:
```typescript
// In the debounce effect (AggregatedWidgetRenderer or a shared hook):
const response = await materializeFilter(tableId, dashboardId, filters, signal);
// ONLY update store after confirmed success:
useFilterViewStore.getState().setView(tableId, response.viewName, response.expiresAt);
// Then let the widget's next render pick up the new view name.
```
Never write to `useFilterViewStore` before the `POST /api/filter/materialize` 200 response. During the materialize in-flight period, widgets should continue querying the previous view name (or raw table if no previous view). This means: while a materialize is in flight, `views[tableId]` stays at its prior value. Only replace on confirmed success.

**Warning signs:**
- Widget error flash immediately after a filter click (500ms burst, then resolves)
- Server logs show `SELECT ... FROM _kbi_filt_...` before any `CREATE MATERIALIZED VIEW` log for the same name
- `KineticaUpstreamError` in the 502 path with a "table not found" body arriving 50-200ms after a filter click

**Phase to address:** P2 (backend endpoint) + P3 (chart wiring) — the contract must be specified in the P2 endpoint spec and enforced in P3's store integration. The `materializeFilter` client function must return a Promise; callers must await it before updating the view store.

---

### V13-P-02: Two In-Flight Materialize Calls, Wrong-Order Resolution (Out-of-Order Response)

**What goes wrong:**
User clicks filter A (triggers debounce, debounce fires, `POST /api/filter/materialize` #1 in flight). Within the debounce window, user changes to filter B (debounce resets, #1 is now racing against a soon-to-fire #2). If debounce fires for #2 while #1 is still in flight, both calls hit the server. Kinetica executes `CREATE OR REPLACE MATERIALIZED VIEW` for both — the last one to execute wins in Kinetica. But if #1's *response* arrives at the frontend after #2's response, the frontend stores the view name from call #1 (which Kinetica has already replaced with #2's filter). Widgets query the view name from #1, but Kinetica's view reflects #2's filter. The filter bar shows filter A, but the data reflects filter B — silent wrong results.

**Why it happens:**
AbortController is used to cancel the data-fetch effects in `AggregatedWidgetRenderer`, but there's a separate materialize call that also needs its own AbortController. The v1.2 pattern only aborts `runSql` calls — it has no precedent for aborting a materialize call.

**How to avoid:**
The materialize call needs its own AbortController, separate from the chart-query controller. Pattern: one `materializeAbortRef` in the shared hook or effect that owns the materialize call:
```typescript
const materializeAbortRef = useRef<AbortController | null>(null);

useEffect(() => {
  const controller = new AbortController();
  materializeAbortRef.current?.abort(); // abort previous in-flight materialize
  materializeAbortRef.current = controller;

  const timer = setTimeout(async () => {
    try {
      const result = await materializeFilter(tableId, dashboardId, filters, controller.signal);
      if (!controller.signal.aborted) {
        useFilterViewStore.getState().setView(tableId, result.viewName, result.expiresAt);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') { /* handle real error */ }
    }
  }, 300);

  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}, [filterVersion]);
```
The AbortError silencing pattern from v1.2 `AggregatedWidgetRenderer` (line 243: `if (err?.name === "AbortError") return;`) applies identically here — abort is expected control flow, not an error.

**Warning signs:**
- Dashboard shows data inconsistent with the filter bar values (wrong slice of data displayed)
- Rapid filter clicks cause the final displayed data to be from an intermediate filter state
- Network tab shows multiple in-flight `POST /api/filter/materialize` calls without prior ones being cancelled

**Phase to address:** P2 (materializeFilter client function must accept AbortSignal) + P3/P4 (effect wiring must use the abort pattern). Document in P2's spec that the client function mirrors the `runSql(sql, options, signal?)` signature.

---

### V13-P-03: Clear-All While Materialize In Flight — View Name Stored After Drop Completes

**What goes wrong:**
User adds filter (debounce fires, materialize in flight). User clicks "Clear All" 100ms later. The clear should: abort the materialize, drop any existing view, clear `views[tableId]` from the store, return widgets to raw table. If the materialize AbortController is not invoked on clear, the sequence becomes: drop executes (via `DELETE /api/filter/materialize`) → materialize completes → frontend stores the new view name → widgets now query the view Kinetica just dropped. Kinetica returns "table not found" on the next widget query. One-shot error that clears on the next data fetch — but it's visible to the user.

**Why it happens:**
`clearFilters` in `useFilterStore` increments `filterVersion`, which re-fires the materialize effect. The effect cleanup from the previous run aborts the old materialize, but if the cleanup timing is wrong (React batching, StrictMode double-fire), the abort may not reach the in-flight fetch before the response arrives.

**How to avoid:**
`clearFilters` must do two things in sequence: (1) abort any in-flight materialize for that tableId, (2) dispatch `DELETE /api/filter/materialize`. The cleanest approach: the materialize effect's cleanup function always aborts — and `clearFilters` advancing `filterVersion` re-triggers the effect, which immediately sees an empty filter array and fires the DROP path instead of a CREATE path. This means the effect must distinguish between "no filters — fire DROP" and "has filters — fire CREATE":
```typescript
useEffect(() => {
  const controller = new AbortController();
  // abort previous materialize call
  materializeAbortRef.current?.abort();
  materializeAbortRef.current = controller;

  const filters = useFilterStore.getState().filters[tableId] ?? [];

  if (filters.length === 0) {
    // Clear path: drop any existing view
    const existingView = useFilterViewStore.getState().views[tableId];
    if (existingView) {
      dropFilterView(tableId, dashboardId, controller.signal).catch(() => {});
      useFilterViewStore.getState().clearView(tableId);
    }
    return () => controller.abort();
  }

  // Create/update path: debounce then materialize
  const timer = setTimeout(async () => { ... }, 300);
  return () => { clearTimeout(timer); controller.abort(); };
}, [filterVersion]);
```
The DROP call is fire-and-forget because Kinetica's `DROP TABLE IF EXISTS` is idempotent — even if the view already expired via TTL, the call succeeds without error (confirmed per STACK.md spike requirement S3).

**Warning signs:**
- After "Clear All", one chart briefly shows an error before recovering to unfiltered data
- Network tab shows a `DELETE /api/filter/materialize` followed immediately by a `POST /api/filter/materialize` for the same table (the clear fired, then the stale materialize response triggered a re-store)

**Phase to address:** P3 (chart wiring) and P4 (map wiring) — the effect must handle the empty-filter DROP case before the create-on-filter case. Specify in P3's plan as a required case, not a follow-up.

---

### V13-P-04: WMS LAYERS Swap Source Cache Not Invalidated — Stale Tiles After Filter

**What goes wrong:**
In v1.2, Effect 3 of `MapChartRenderer` calls `source.updateParams({ QUERY: whereClause, _v: filterVersion })`. In v1.3, QUERY is removed and LAYERS is swapped: `source.updateParams({ LAYERS: viewName ?? tableRef })`. OpenLayers `ImageWMS.updateParams()` triggers a new image request when the params change. This works correctly *if* the view name actually changes between calls. The trap: if a second filter change produces the same view name (the name is deterministic per user+session+dashboard+table, so it doesn't change between filter updates — only the WHERE clause inside the view changes), then `updateParams({ LAYERS: viewName })` is a no-op from OpenLayers's perspective. OL sees the same params, uses its internal image cache, and serves the old tile.

**Why it happens:**
v1.2's `_v: filterVersion` cache-buster forced OL to re-request every time, regardless of whether params "changed." v1.3 removes `_v` (per STACK.md recommendation), but the replacement cache-busting mechanism is now only the LAYERS value changing — which only changes on filter-on and filter-off transitions, not on filter-update transitions (where view name stays the same but Kinetica view content changed because `CREATE OR REPLACE` re-ran).

**How to avoid:**
Keep a minimal cache-buster in the WMS params that changes on every materialize completion — not `filterVersion` (which is a store counter that increments on every filter store write including non-materialize events), but a `materializeVersion` counter from `useFilterViewStore` that only increments when a materialize successfully completes:
```typescript
// In wmsUrlBuilder.ts v1.3:
// LAYERS = viewName (filtered) or tableRef (unfiltered)
// _mv = materializeVersion (changes on each materialize completion — forces OL cache-bust)
params.LAYERS = viewName ?? config.tableRef;
if (materializeVersion !== undefined) {
  params._mv = String(materializeVersion);
}
```
`_mv` is a new field in `useFilterViewStore` per-entry: `{ viewName, expiresAt, materializeVersion: number }`. Increment it on every successful `setView` call. When filters are cleared, `_mv` is removed from params (or kept at its last value — either is fine since LAYERS changes back to the raw table name).

Alternatively: keep `_v: filterVersion` in the WMS params even in v1.3. It's cheap, harmless (a cache-buster that fires slightly more than necessary does no harm), and is already tested in `wmsUrlBuilder.spec.ts` (the test "emits _v as stringified filterVersion" will fail if `_v` is deleted — see pitfall V13-P-10 on dead-code deletion).

**Warning signs:**
- Map tiles do not update when a filter is changed (updated to a different value, same table)
- Filter bar shows the new filter value, charts (non-map) update correctly, map stays stale
- Network tab shows zero new `/api/wms` requests after a filter change on an already-filtered table

**Phase to address:** P4 (map wiring) — must be addressed in the `wmsUrlBuilder.ts` modification plan. REGRESSION RISK from v1.2 PITFALL M-02: this is exactly the problem M-02 solved, and v1.3's removal of `_v` risks reintroducing it.

---

### V13-P-05: TTL Expiry Surfaces as 502 — Client Has No Recovery Path

**What goes wrong:**
A user applies a filter at 9:00am. Kinetica creates the view with `TTL=5` (5-minute sliding). The user attends a meeting; no dashboard interaction for 6 minutes. The view expires and Kinetica auto-drops it. At 9:06am the user glances at the dashboard — `AggregatedWidgetRenderer` fires `runSql("SELECT ... FROM _kbi_filt_u1_d2_t3_s1abc")`. Kinetica returns a 400 error with a body indicating the table doesn't exist. The existing `classifyHttpError` in `kinetica.ts` maps this to `KineticaUpstreamError` (502 to frontend). The widget shows an error state. The user sees a broken chart with a red error state. `useFilterViewStore` still thinks the view exists (it was never told otherwise). The user cannot recover by clicking anything — the filter bar shows active filters, the widget shows error, and there's no "re-materialize" trigger.

**Why it happens:**
Reactive error detection requires wiring the error response back to the view store. v1.2's `AggregatedWidgetRenderer` catch block has `if (err?.name === "AbortError") return; setError(err.message)` — it surfaces the error but does not attempt to re-materialize.

**How to avoid:**
In `AggregatedWidgetRenderer`'s catch block, detect the specific "view expired" condition and trigger a re-materialize:
```typescript
.catch((err) => {
  if (err?.name === 'AbortError') return; // expected control flow
  
  // Detect view-not-found error (Kinetica 400 "table not found" → our 502)
  // Check both the error kind and whether a view name was active
  const currentView = useFilterViewStore.getState().views[tableId];
  if (currentView && isViewNotFoundError(err)) {
    // View expired — clear it and trigger re-materialize on next filterVersion bump
    useFilterViewStore.getState().clearView(tableId);
    // Re-materialize immediately if filters are still active
    const activeFilters = useFilterStore.getState().filters[tableId] ?? [];
    if (activeFilters.length > 0) {
      // Bump a re-materialize trigger — don't call materialize directly here
      // (would be called outside the debounce effect). Instead, increment a
      // re-materialize counter that the effect depends on.
      useFilterViewStore.getState().triggerRematerialize(tableId);
    }
    return; // don't setError — the rematerialize will fix it transparently
  }
  
  setError(err.message);
})
```
`isViewNotFoundError(err)` checks the error message for "table not found" / "object not found" patterns (low confidence on exact Kinetica error text — must be spike-verified in P1). The re-materialize should be transparent to the user: no error state, just a brief loading spinner while the view is recreated.

**Do NOT:** Auto-retry forever in a loop (runaway server calls), eat the error silently (debugging nightmare), or show "something went wrong" with no path to recovery. The correct UX: transparent re-materialize, then the widget refreshes. If the re-materialize also fails (e.g., Kinetica is down), THEN show the error.

**Warning signs:**
- Charts show error state after a period of user inactivity (5+ minutes) while the filter bar still shows active filters
- Server logs show `FROM _kbi_filt_...` queries without a preceding materialize call for that view
- The error clears if the user clicks "Clear All" and re-applies the filter manually (confirming it's a view-expired issue)

**Phase to address:** P3 (chart wiring) for the detection and re-materialize trigger. P1 spike should identify the exact Kinetica error message/code for "table not found" so `isViewNotFoundError` can be accurate.

---

### V13-P-06: Effect 3 Collapse Breaks the ResizeObserver / BBOX / Blob Lifecycle Fixes From v1.2

**What goes wrong:**
v1.3 collapses `MapChartRenderer` Effect 3 (the `filterVersion`-driven effect that calls `source.updateParams`) into a new pattern that calls the materialize endpoint instead. The risk: v1.2's Effect 3 contains critical fixes from commits c63eea0 (NaN BBOX from ResizeObserver), 823058c (ImageWMS render loop from blob lifecycle), and 4abb3e7 (fillOpacity dim-peers per-Cell). These fixes were applied to the Effect structure in specific ways. If Effect 3 is collapsed into a different shape, it's easy to accidentally drop one of these fixes — especially the blob lifecycle protection (using XHR+arraybuffer+base64 instead of fetch+blob) or the PITFALL M-01 lock (`mapRef` guard preventing StrictMode double-construction).

Looking at the actual code: Effect 3 in v1.2 (`MapChartRenderer.tsx` lines 404-423) is the filter-subscription effect with deps `[filterVersion, includedLayers, tables]`. It iterates `includedLayers`, reads `layer.table_id`, calls `buildWhereClause`, and calls `source.updateParams(buildWmsParams(..., filterVersion, whereClause))`. In v1.3, this becomes: iterate layers, check if view exists for `layer.table_id`, set `LAYERS = viewName ?? tableRef`. The `buildWmsParams` call still needs the same `source.updateParams` invocation — but the `buildWhereClause` import and `filterVersion` param to `buildWmsParams` may be modified.

**Why it happens:**
Effect 3 imports `buildWhereClause` from `filterStore.ts`. That import will be removed in the dead-code deletion phase. If the removal is done as a bulk "delete these lines" operation without checking what else the import provided, the Effect 3 logic breaks. Similarly, if `buildWmsParams`'s signature changes (the `whereClause` param is removed), the spec tests in `wmsUrlBuilder.spec.ts` will fail — but only if the tests weren't also deleted.

**How to avoid:**
Before touching Effect 3, document its exact current deps and what each dep drives. The v1.3 change is surgical: remove the `buildWhereClause` call and the `whereClause` variable; replace the `LAYERS` param value. Everything else (the `source.updateParams` call, the `layer.table_id` read, the `tables.find()` table resolution, the `imageSourcesRef` lookup) stays identical. Use a diff-locked comment in the code:
```typescript
// V13-P-06 lock: Effect structure preserved from v1.2. Only changed:
// - REMOVED: buildWhereClause import and whereClause computation
// - REMOVED: QUERY param from buildWmsParams call
// - CHANGED: LAYERS = viewName ?? tableRef (was tableRef only)
// - KEPT: source.updateParams() call (M-02 lock)
// - KEPT: layer.table_id read (not config.tableId — Phase 12 fix)
// - KEPT: tables.find() table resolution
```

**Warning signs:**
- After v1.3, map tiles stop updating on filter changes (Effect 3 body was incorrectly modified)
- After v1.3, StrictMode dev builds create two OL Map instances (mapRef guard was accidentally removed)
- After v1.3, map tiles show blank on initial render (ResizeObserver updateSize removed)

**Phase to address:** P4 (map wiring) — the phase plan must include a line-by-line diff review of Effect 3 changes against v1.2's known fixes. The PITFALL lock comments in `MapChartRenderer.tsx` are the authoritative reference.

---

### V13-P-07: Dead-Code Deletion Breaks Active Callers — `filterStore.ts` Utility Functions

**What goes wrong:**
v1.3 deletes `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, and `buildEqualityFilter` from `filterStore.ts`. These functions have callers beyond `AggregatedWidgetRenderer`:

1. **`MapChartRenderer.tsx` line 316**: calls `buildWhereClause(tableFilters)` in Effect 2 (layer-stack reconciliation). This is the source-creation path — when a new layer is added while filters are already active.
2. **`MapChartRenderer.tsx` line 419**: calls `buildWmsParams(wmsConfigInput, filterVersion, whereClause)` in Effect 3, where `whereClause` comes from `buildWhereClause`.
3. **`WidgetRenderer.tsx` line 28**: imports `buildWhereClause` and `injectWhereClause` directly.
4. **`filterStore.spec.ts`**: has 20+ tests for `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, and `injectWhereClause`. These tests will fail (imported symbols undefined) if the functions are deleted without also updating the test file.
5. **`wmsUrlBuilder.spec.ts` lines 471-492**: the `buildWmsParams — filter clause (FILT-04)` describe block asserts `result.QUERY` is set when `whereClause` is non-empty. If `buildWmsParams`'s `whereClause` parameter is removed and `QUERY` is no longer emitted, these 4 tests fail.
6. **`wmsUrlBuilder.ts`**: the `buildWmsParams(config, filterVersion, whereClause)` function signature takes `whereClause` as third param. All callers pass it. If the signature changes, all callers must be updated atomically.

**Why it happens:**
Dead-code deletion in a codebase with cross-file imports requires a complete caller scan. TypeScript compilation catches import errors, but only if the build runs clean — if tests are run without a prior `tsc` check, deleted exports cause runtime errors in jest/vitest that look like "property is not a function."

**How to avoid:**
Before deleting any export from `filterStore.ts`, run: `grep -r "injectWhereClause\|buildWhereClause\|escapeKineticaStringLiteral\|buildEqualityFilter" src/ --include="*.ts" --include="*.tsx" -l`. The output confirms every caller. Delete in this order:
1. Update `wmsUrlBuilder.ts` to remove `whereClause` param (or make it optional/ignored)
2. Update `wmsUrlBuilder.spec.ts` to remove/update the `FILT-04 filter clause` tests
3. Update `MapChartRenderer.tsx` Effects 2 and 3 to use view-name swap instead of WHERE clause
4. Update `WidgetRenderer.tsx` to use view-name swap instead of `injectWhereClause`
5. Only then delete the functions from `filterStore.ts`
6. Update `filterStore.spec.ts` to remove the utility function tests

TypeScript type-checks (`tsc --noEmit`) must pass before marking any dead-code deletion phase complete.

**Warning signs:**
- TypeScript build errors: "Module 'filterStore' has no exported member 'buildWhereClause'"
- Vitest run fails with "TypeError: buildWhereClause is not a function" in `filterStore.spec.ts`
- `wmsUrlBuilder.spec.ts` fails: "expected object to have property 'QUERY'" (FILT-04 tests still asserting on deleted behavior)

**Phase to address:** P5 (cleanup) — but the *order* of cleanup within P5 matters critically. The plan must specify the deletion order and require `tsc --noEmit` + full test run between each deletion step. REGRESSION RISK: if P5 cleanup happens before P3/P4 have fully wired the view-name swap, the intermediate state will have no filter mechanism at all.

---

### V13-P-08: View Name Collision — OIDC `userId` Is a String, Not an Integer

**What goes wrong:**
The v1.3 view name format is `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`. In password mode, `userId` is an integer (Kinetica user ID from the auth layer). In OIDC mode (`AUTH_MODE=oidc`), `userId` is derived from an OIDC claim (e.g., `sub` or `preferred_username`) — it's a string that may contain characters invalid in Kinetica identifiers (hyphens, at-signs, dots, spaces). A OIDC `sub` claim like `auth0|507f1f77bcf86cd799439011` contains a pipe character — Kinetica identifiers permit `a-z, A-Z, 0-9, _, #, {, }, [, ], (, ), :, -, space` (per STACK.md naming constraints). The pipe `|` is not in this set.

Even without invalid characters, a long OIDC username (e.g., `firstName.lastName@company.com`) in the `u<userId>` segment makes the view name exceed expected length. The total `_kbi_filt_uFirstNameLastName_companycom_d12345_t67890_s1a2b3c4` could approach 60-70 characters — still within the 200-char Kinetica limit, but potentially violating any future length constraints or logging truncation.

**Why it happens:**
The view name generation was designed with integer user IDs in mind (password mode). OIDC mode was added in v1.1 and uses string claims as usernames. The session store has a `userId` field that holds whatever the authentication layer provides.

**How to avoid:**
Sanitize `userId` before interpolating into the view name. The server-side view name generator (in the new `POST /api/filter/materialize` route handler) must apply:
```typescript
function sanitizeForViewName(id: string | number): string {
  return String(id)
    .replace(/[^a-zA-Z0-9_]/g, '_')  // replace invalid chars with underscore
    .substring(0, 20);                 // truncate to prevent overly long names
}
const viewName = `_kbi_filt_u${sanitizeForViewName(userId)}_d${dashboardId}_t${tableId}_s${sessionShort}`;
```
The sanitized name may collide between two different OIDC usernames that differ only in their special characters (e.g., `user.a` and `user-a` both become `user_a`). This is acceptable because the session-scoping (`s<sessionShort>`) provides the uniqueness guarantee — two different users with sanitized-identical usernames will have different sessions.

**Warning signs:**
- `CREATE MATERIALIZED VIEW` DDL returns a Kinetica error about invalid identifier characters when an OIDC user applies a filter
- View names in server logs contain URL-encoded or raw special characters (pipe, at-sign, dot)
- OIDC users cannot filter at all; password users work fine

**Phase to address:** P2 (backend endpoint) — the view name generator is in the new route handler. The sanitizer must be implemented and tested with OIDC claim-derived username strings before the endpoint is considered complete.

---

### V13-P-09: Concurrent Tabs — Same User+Session+Dashboard+Table → Same View Name, Second Tab Overwrites First

**What goes wrong:**
A user opens the same dashboard in two browser tabs. Both tabs share the same BI session (same session cookie). Both tabs apply filters to the same table. The view name is deterministic by `(userId, sessionId, dashboardId, tableId)` — both tabs generate the same name. Tab A materializes `_kbi_filt_u1_d2_t3_sabc`. Tab B materializes the same name with a different filter. Kinetica executes `CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u1_d2_t3_sabc` — this is `OR REPLACE`, so it silently overwrites Tab A's view. Tab A's charts now query the view with Tab B's filter. Last-write-wins.

**Why it happens:**
The view name is designed to be deterministic for simplicity (idempotent CREATE OR REPLACE). Multi-tab use of the same BI session was not in the v1.3 design scope.

**How to avoid:**
Accept last-write-wins as the documented behavior for this release. It is consistent with the internal team use case and is not silent data corruption (the user sees a filter change, not wrong data for the active filter). Document it explicitly in a code comment on the view name generator:

```typescript
// V13-P-09: View name is deterministic per (userId, sessionId, dashboardId, tableId).
// If the same user opens the same dashboard in two tabs, the second tab's materialize
// overwrites the first. Last-write-wins is acceptable for v1.3 internal use.
// To fix for multi-tab: add a per-tab UUID to the name generation (e.g., a sessionStorage key).
```

If multi-tab isolation becomes a requirement in v1.4, the fix is to add a `tabId` (a `crypto.randomUUID()` stored in `sessionStorage` on app boot) to the view name computation. This does not require a server change — the `tabId` is just another segment in the name.

**Warning signs:**
- A user reports that their filter "randomly changes" — they have two tabs open on the same dashboard
- Charts show data filtered by a column the user doesn't remember clicking

**Phase to address:** P2 (backend endpoint) — document the decision in the view name generator. No code change needed for v1.3; the document comment prevents future confusion.

---

### V13-P-10: `wmsUrlBuilder.spec.ts` FILT-04 Tests Assert on `QUERY` — Will Fail After Removal

**What goes wrong:**
`wmsUrlBuilder.spec.ts` lines 471-492 contain a `describe("buildWmsParams — filter clause (FILT-04)")` block with 4 tests that assert `result.QUERY === whereClause` and `result` does not have `QUERY` when the clause is empty. After v1.3 removes the `QUERY` param from `buildWmsParams`, these tests fail. If the cleanup phase deletes the tests without a deliberate review, regression coverage for LAYERS-based filtering is lost entirely. If the tests are left in place, the test suite is red and blocking CI.

Additionally, the test "emits _v as stringified filterVersion — M-02 cache-buster lock" (line 70) and "emits _v=0 when filterVersion is 0" (line 74) test the `_v` cache-buster. If v1.3 removes `_v` from `buildWmsParams` (as STACK.md recommends), these two tests also fail. However, per V13-P-04 above, keeping `_v` (renamed to `_mv`) is the safer approach — in which case these tests only need a rename update.

**Why it happens:**
Test files are treated as "infrastructure" and not reviewed with the same care as source files during dead-code cleanup. The tests for deleted behavior are left in place, causing persistent test-suite failures that mask actual regressions.

**How to avoid:**
During P5 (cleanup), every deleted behavior must have its test updated or deleted with an explicit decision. The plan should include a checklist:
- [ ] `filterStore.spec.ts` — 20+ tests for deleted utility functions: DELETE (functions gone)
- [ ] `wmsUrlBuilder.spec.ts` `FILT-04` block — 4 tests for QUERY param: DELETE (QUERY removed)
- [ ] `wmsUrlBuilder.spec.ts` `_v` tests — UPDATE to `_mv` if renamed, or DELETE if removed
- [ ] `MapChartRenderer.spec.tsx` — any test that mocks `buildWhereClause`: UPDATE to not mock it

Run `npx vitest run` after each deletion step to confirm suite passes incrementally.

**Warning signs:**
- Test suite has red `wmsUrlBuilder.spec.ts` FILT-04 failures after v1.3 deployment
- CI blocks on deleted-function import errors in `filterStore.spec.ts`
- Someone adds `QUERY` back to `buildWmsParams` to "fix the tests" instead of removing the tests

**Phase to address:** P5 (cleanup) — but the plan must pre-enumerate which tests are deleted vs. updated, not discover it during execution.

---

### V13-P-11: `RecordsTableRenderer` Not Subscribed to View Store — Continues Querying Raw Table

**What goes wrong:**
`AggregatedWidgetRenderer` will be updated in P3 to use `FROM <viewName>` instead of `injectWhereClause`. But `RecordsTableRenderer` is a separate component (see `WidgetRenderer.tsx` line 852) with its own data-fetch effect (`useEffect` at line 900). It builds its SQL directly: `SELECT ${colsClause} FROM ${table} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}` — it does not go through `AggregatedWidgetRenderer` at all (it's short-circuited at line 192: `if (widget.type === "records") return <RecordsTableRenderer ...>`). If `RecordsTableRenderer` is not updated to use the view name, applying a filter leaves all non-records charts filtered but the records table unfiltered.

**Why it happens:**
`RecordsTableRenderer` was added after the initial `AggregatedWidgetRenderer` architecture and duplicates the data-fetch pattern rather than sharing it. The v1.2 PITFALL notes (MILESTONES.md Phase 10 summary) specifically called out "RESEARCH.md Pitfall 3: RecordsTableRenderer was previously NOT subscribed to the filter store" — the same oversight pattern recurs with the view-store subscription.

**How to avoid:**
P3's plan must explicitly list `RecordsTableRenderer` as a target for the view-name swap. The FROM swap in RecordsTableRenderer is different from `AggregatedWidgetRenderer` — instead of replacing a `config.sql` string, it replaces the `table` variable in the SQL builder:
```typescript
// RecordsTableRenderer v1.3 pattern:
const viewName = useFilterViewStore(s => tableId !== undefined ? s.views[tableId]?.viewName ?? null : null);
const materializeVersion = useFilterViewStore(s => tableId !== undefined ? s.views[tableId]?.materializeVersion ?? 0 : 0);
const effectiveTable = viewName ?? table; // view if filtered, raw table if not

// SQL uses effectiveTable instead of table:
const sql = `SELECT ${colsClause} FROM ${effectiveTable} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;
```
The `materializeVersion` dep ensures re-fetch on each materialize completion (same view name, new content).

**Warning signs:**
- Applying a filter updates bar/line/pie/scatter charts but the records table below them still shows all rows
- Paginating the records table while a filter is active shows results from the full raw table

**Phase to address:** P3 (chart wiring) — include `RecordsTableRenderer` in the list of components to update alongside `AggregatedWidgetRenderer`. Do not defer to P5.

---

### V13-P-12: DDL Permission Failure Silently Disables Filtering

**What goes wrong:**
Per STACK.md: if the BI user lacks DDL rights (`CREATE MATERIALIZED VIEW`), `kineticaSql` throws `KineticaPermissionError`, which maps to a 403 from the server. The new `materializeFilter` client function receives a 403 and throws a `PermissionError`. In the materialize effect's catch block, if this error is swallowed (or treated the same as an AbortError), the frontend never knows the materialize failed. `views[tableId]` stays empty. Widgets continue querying the raw table. The filter bar shows active filters. Users see unfiltered data that looks like filtered data — the worst possible outcome: silent wrong results.

**Why it happens:**
The catch block for the materialize call needs to handle three distinct error classes: AbortError (silent), view-not-found (re-materialize), and permission error (hard fail with actionable message). If the pattern is just "abort = silent, everything else = setError", the permission error will show a generic error in the widget rather than a dashboard-level explanatory message.

**How to avoid:**
In the materialize effect's catch block, detect `PermissionError` (check `err.status === 403` or `err instanceof PermissionError` — the frontend already has `PermissionError` from v1.0 Phase 3):
```typescript
if (err instanceof PermissionError) {
  // Filtering is permanently unavailable for this user
  // Show a dashboard-level toast, not a per-widget error
  useToastStore.getState().showToast(
    "Filtering is unavailable — your Kinetica account lacks CREATE VIEW permission. Contact your DBA.",
    "warning"
  );
  // Set a dashboard-level flag to suppress further materialize attempts
  useFilterViewStore.getState().setPermissionDenied(tableId);
  return;
}
```
Once `permissionDenied[tableId]` is set, the materialize effect bails out immediately on subsequent filter changes (no retrying a known-failed permission). Widgets fall back to querying the raw table. The filter bar still shows active filters — this is intentional (user's intent is preserved, execution is gracefully degraded).

**Warning signs:**
- Filters appear active (filter bar shows chips) but charts show unfiltered data with no error
- Server logs show 403 responses from `POST /api/filter/materialize` with no frontend error state
- User reports "filters don't work" with no visible error message

**Phase to address:** P2 (backend endpoint spec — document the 403 response) + P3 (chart wiring — the catch block must handle `PermissionError` distinctly).

---

### V13-P-13: State Desync — Server Crashes After DROP, Before Client Knows — View Thought To Exist

**What goes wrong:**
The client calls `DELETE /api/filter/materialize`. The server executes `DROP TABLE IF EXISTS _kbi_filt_...` in Kinetica. Kinetica confirms the drop. Before the server sends the 204 response, the server process crashes (deploy, OOM, graceful restart). The client never receives the 204, so the fetch fails with a network error. `useFilterViewStore.clearView(tableId)` is never called — the client still thinks the view exists. The next widget query fires `SELECT ... FROM _kbi_filt_...` against a dropped view. Kinetica returns "table not found". This triggers the recovery path from V13-P-05 (view-not-found → clear view + re-materialize).

**Why it happens:**
The DROP response is confirmation of a Kinetica-side state change. Network failures between Kinetica-confirms and server-responds are rare but real (redeploy, k8s pod restart, etc.).

**How to avoid:**
The V13-P-05 recovery path already handles this case: "view not found" error in a widget query triggers `clearView(tableId)` and optionally re-materializes. The additional defensive measure: treat `DELETE /api/filter/materialize` network failures client-side as "assume dropped" (not "assume still exists"). If the DELETE request fails at the network level, still call `useFilterViewStore.clearView(tableId)` — because (a) the server may have succeeded before crashing, or (b) the server will be back shortly and the view may have expired by then anyway:
```typescript
try {
  await dropFilterView(tableId, dashboardId, signal);
} catch (err) {
  if (err?.name === 'AbortError') return;
  // Network error or server error — assume view is gone (safe: DROP IF EXISTS is idempotent)
  // Don't re-throw; don't show error to user
} finally {
  // Always clear the view store on a drop attempt, regardless of server confirmation
  useFilterViewStore.getState().clearView(tableId);
}
```

**Warning signs:**
- After a server restart, some users see widget errors immediately upon the next filter interaction
- Users who had filters active during a deploy see "table not found" errors rather than a clean filter state

**Phase to address:** P3 (chart wiring) — the drop path's error handling must include the "always clear on drop attempt" rule.

---

## Moderate Pitfalls

### V13-P-14: Debounce + AbortController Interaction — Timer Not Cleared on Component Unmount

**What goes wrong:**
The 300ms debounce timer for the materialize call (`setTimeout` in the `filterVersion` useEffect) is stored in a `useRef`. If the component unmounts (user navigates to a different dashboard) while the timer is pending, the cleanup function must call `clearTimeout`. If the effect cleanup only calls `controller.abort()` but not `clearTimeout(timerRef.current)`, the timer fires 300ms later on an unmounted component. The `materializeFilter` call fires, the server creates a view for a dashboard the user has already left, and React may warn about a state update on an unmounted component (if the `.then` handler calls `useFilterViewStore.getState().setView(...)`).

**How to avoid:**
The effect cleanup function must always clear both the timeout and abort the controller:
```typescript
return () => {
  clearTimeout(timerRef.current);
  controller.abort();
};
```
This is already the pattern for the 300ms debounce in `LayersModal` (v1.2) — replicate it exactly. Using `useFilterViewStore.getState().setView(...)` (the imperative form) rather than a React state setter avoids the "state update on unmounted component" warning — Zustand's `getState()` is always safe to call regardless of mount state.

**Phase to address:** P3/P4 — include in the effect implementation review checklist.

---

### V13-P-15: Multiple Widgets on Same Table — Multiple Materialize Calls for Same View

**What goes wrong:**
If `AggregatedWidgetRenderer` directly owns the materialize logic, and there are 4 bar charts on a dashboard all pointing to the same table, a single filter click causes 4 independent materialize calls (one per widget's `filterVersion` useEffect). All 4 call `POST /api/filter/materialize` with identical parameters. The server handles them idempotently (`CREATE OR REPLACE`) but generates 4x the network traffic and 4x the server log noise. Kinetica executes `CREATE OR REPLACE` 4 times, which is wasteful.

**How to avoid:**
The materialize call must live in a shared coordinator, not per-widget. Options:
1. A dashboard-level hook (`useDashboardFilter`) that owns the materialize effect and is mounted once per dashboard per table
2. A `useFilterViewStore` action that coalesces concurrent materialize calls for the same `(tableId, dashboardId)` into a single in-flight request

The simplest approach for v1.3: put the materialize logic in a small `FilterMaterializeCoordinator` component rendered once per `(dashboardId, tableId)` combination at the dashboard level, not inside each widget. Widgets only read from `useFilterViewStore` — they never call the materialize endpoint directly.

**Phase to address:** P3 — specify the coordinator architecture before implementing the per-widget data fetch changes.

---

### V13-P-16: Empty Filter Set After `removeFilter` — DROP Not Triggered

**What goes wrong:**
User adds filter A and filter B. User removes filter A (not "Clear All" — just the × button on one chip). `useFilterStore.removeFilter` fires, `filterVersion` increments, the materialize effect re-fires. `filters[tableId]` now has 1 filter (filter B). The effect sees `filters.length > 0`, calls materialize → `CREATE OR REPLACE` with the remaining filter B. Correct behavior. But: user then removes filter B. `filters[tableId]` is now empty. The materialize effect must detect this as the "drop" case. Per V13-P-03, the effect already handles this. But if the implementation uses `tableFilters.length === 0` to decide DROP vs. CREATE, there's a subtle timing issue: the effect fires with the updated `filterVersion`, but at the time of execution, `useFilterStore.getState().filters[tableId]` must be read via `getState()` (not a stale closure) to get the current empty state.

**How to avoid:**
In the materialize effect, always read current filter state via `useFilterStore.getState()` at effect-run time, not from the closed-over React selector value (`tableFilters`). The closed-over `tableFilters` was current at the time the effect was scheduled, but `getState()` is always current:
```typescript
useEffect(() => {
  const currentFilters = useFilterStore.getState().filters[tableId] ?? [];
  if (currentFilters.length === 0) {
    // DROP path
  } else {
    // CREATE path
  }
}, [filterVersion]);
```

**Phase to address:** P3 (chart wiring) — document the "read via getState() not closure" requirement in the effect implementation.

---

### V13-P-17: `sessionShort` Collision Across Concurrent BI Deployments Sharing the Same Kinetica

**What goes wrong:**
Two separate BI deployments (e.g., a dev instance and a staging instance) both connect to the same Kinetica cluster. Both generate view names using `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`. If user 1 on the dev deployment happens to get the same `sessionShort` as user 1 on staging (both are short 4-8 char hex strings from a session ID), their view names collide. Dev deployment overwrites staging's filter view.

**How to avoid:**
Add a deployment-scoped prefix to the view name, configured via an environment variable:
```typescript
// In view name generator:
const deploymentPrefix = process.env.KBI_DEPLOYMENT_ID || 'kbi';
const viewName = `_${deploymentPrefix}_filt_u${userId}_d${dashId}_t${tableId}_s${sessionShort}`;
```
`KBI_DEPLOYMENT_ID` defaults to `kbi` (no change for single-deployment use). For multi-deployment: set `KBI_DEPLOYMENT_ID=dev` and `KBI_DEPLOYMENT_ID=staging` in respective `.env` files. Document this in the deploy runbook.

**Phase to address:** P2 (backend endpoint) — the view name generator. Low-urgency for single-deployment setups; document as a runbook item even if not actively configured.

---

## Minor Pitfalls

### V13-P-18: Test Mocking for `POST /api/filter/materialize` — Wrong Mock Shape

**What goes wrong:**
The new endpoint `POST /api/filter/materialize` needs both server-side tests (vitest+supertest, already established) and frontend tests (vitest+jsdom, already established). The common mistake: server tests mock `kineticaSql` as a global mock that returns success for all DDL calls, then assert on the response body. But if the mock is too broad (returns success for any SQL statement), it doesn't verify that the correct DDL is issued. The DDL string format matters: `CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_... AS (SELECT * FROM ... WHERE ...) USING TABLE PROPERTIES (TTL = 5)` — getting the parentheses, TTL syntax, and view name format wrong will compile but fail at runtime against real Kinetica.

**How to avoid:**
Server-side test for the materialize endpoint should assert on the SQL string passed to the `kineticaSql` mock:
```typescript
// In routes.materialize-filter.spec.ts:
const kineticaSqlSpy = vi.spyOn(kinetica, 'kineticaSql');
await request(app)
  .post('/api/filter/materialize')
  .send({ tableId: 1, dashboardId: 2, filters: [...] })
  .expect(200);

expect(kineticaSqlSpy).toHaveBeenCalledWith(
  expect.any(Object), // req
  expect.stringMatching(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u\w+_d\w+_t\w+_s\w+ AS\s*\([\s\S]+\)\s*USING TABLE PROPERTIES \(TTL = 5\)/i),
  expect.objectContaining({ op: 'MATERIALIZE' })
);
```
Frontend tests should mock `materializeFilter` from `src/api/client.ts` (not the fetch call) to return `{ viewName: '_kbi_filt_u1_d2_t3_sabc', expiresAt: Date.now() + 300000 }`.

The existing v1.2 pattern for `routes.materialize.spec.ts` is the reference — replicate it with the new TTL and transient view name assertions.

**Phase to address:** P2 (backend endpoint) must include the server-side test with DDL assertion. P3 (chart wiring) frontend tests mock `materializeFilter` at the client function level.

---

### V13-P-19: Schema-Qualified vs Unqualified View Name in WMS LAYERS

**What goes wrong:**
The unqualified view name `_kbi_filt_u1_d2_t3_sabc` lands in the creating user's default schema (e.g., `ki_home` or `<username>`). When `LAYERS=_kbi_filt_u1_d2_t3_sabc` is passed to Kinetica WMS, it resolves using the WMS request's auth context (the user's default schema). If the WMS request's auth user is different from the SQL user (possible if WMS requests use different credentials), the unqualified name resolves to a different schema. Since `kineticaWms` uses the same per-user credentials (`kineticaWms(req, ...)` from `kinetica.ts`), the auth user is the same — but if Kinetica's WMS resolution differs from SQL resolution in edge cases, LAYERS may fail to find the view.

**How to avoid:**
If the schema can be determined at materialize time (the server knows the user's default schema from a one-time `SHOW SCHEMAS` or similar query), schema-qualify the view name: `ki_home._kbi_filt_...`. The STACK.md spike S4 ("What does the user's default schema resolve to?") addresses this. Until S4 is validated, use unqualified names and treat schema-resolution failure as a spike finding that may require a name change.

**Phase to address:** P1 (spike) — S4 spike. If schema-qualification is needed, the view name generator in P2 must include it.

---

## v1.2 Carryover Regression Risks

The following v1.2 pitfall locks could regress under v1.3 changes:

| v1.2 Pitfall | v1.3 Regression Risk | How v1.3 Changes It | Mitigation |
|-------------|---------------------|---------------------|------------|
| **M-02**: WMS tile cache not busted on filter change | V13-P-04 above — `_v` removal breaks the M-02 lock | `_v` may be removed from `buildWmsParams` | Keep `_mv` (materialize version) as replacement cache-buster |
| **S-02**: filterVersion primitive dep | Effect 3 collapse changes effect deps — if `filterVersion` dep is removed, Effect 3 stops firing | Effect 3 currently dep on `[filterVersion, includedLayers, tables]` | Replace with `[materializeVersion, includedLayers, tables]` — same pattern, different source |
| **C-02**: Per-layer filter subscription scoping | Effect 3 currently reads `filters[layer.table_id]` per layer; if rewritten naively it may read all filters | Rewrite for view-name swap | Keep the `imageSourcesRef.current.get(layer.id)` per-layer loop structure |
| **M-01**: Map dispose + mapRef guard | Effect 1 is untouched in v1.3 — minimal risk unless Effect 1 is accidentally modified | Effect 1 has empty deps `[]` — should be left completely alone | Never modify Effect 1 in v1.3. Its deps are `[]` for a reason. |
| **D-05**: Same-column replace in filterStore | `filterStore.ts` core logic unchanged — low risk | No changes to store logic | Regression tested by existing `filterStore.spec.ts` suite |
| **S-03**: Zustand shim coverage for new stores | New `useFilterViewStore` must be covered by the shim | New `create()` call in a new file | Verify `__mocks__/zustand.ts` shim auto-registers the new store (same as v1.2 PITFALL S-03) |
| **C-04**: Cross-table filter scope bleed | Unchanged — `filters` is still `Record<tableId, ActiveFilter[]>` | No change to store structure | No action needed |

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Materialize call inside each widget renderer | Simpler per-widget implementation | 4+ redundant materialize calls per filter click (V13-P-15) | Never — implement a shared coordinator |
| Update `useFilterViewStore` before server confirms view | Perceived faster UI | Widget errors on view-not-found (V13-P-01) | Never — await confirmation before store update |
| Keep `QUERY` param in `wmsUrlBuilder.ts` as a no-op | Avoids test updates | Dead code, misleading test coverage, future confusion | Acceptable only as a temporary bridge during P4; delete in P5 |
| Single AbortController for both materialize + chart query | Simpler code | Incorrect cancellation behavior (V13-P-02) — one controller should not control both | Never — materialize and chart query have different lifecycles |
| Skip `DROP TABLE IF EXISTS` on filter clear (let TTL expire) | Fewer API calls | Kinetica accumulates stale views; users may see stale data on re-filter if name hasn't changed | Acceptable only if operator has verified TTL=5 cleans up in the expected time window; not recommended as default |
| Use `filterVersion` as the WMS LAYERS cache-buster dep | Already implemented and tested | Fires for all filter mutations including non-map-table ones; more re-requests than necessary | Acceptable — overhead is one redundant WMS request per non-map-table filter change; simpler than a separate `materializeVersion` dep |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Kinetica DDL via `kineticaSql` | Passing the view name without TTL: `CREATE OR REPLACE MATERIALIZED VIEW ... AS SELECT * FROM ...` | Always include `USING TABLE PROPERTIES (TTL = 5)` — without it, view uses the server's `default_ttl` which may be 0 (immediate expiry) or very long |
| Kinetica DROP via `kineticaSql` | Using `DROP MATERIALIZED VIEW <name>` (standard SQL syntax) | Kinetica uses `DROP TABLE IF EXISTS <name>` to drop views — confirmed in STACK.md |
| OpenLayers ImageWMS `updateParams` | Calling `updateParams({ LAYERS: viewName })` when viewName is unchanged between filter updates | Add a `_mv` (materializeVersion) param that changes on each materialize — forces OL to re-request even when LAYERS is the same view name |
| `useFilterViewStore` new Zustand slice | Forgetting to verify the Zustand test shim covers it | Check `__mocks__/zustand.ts` — the shim auto-registers stores created with `create()`. Verify with a canary test that store resets between test runs. |
| `materializeFilter` AbortSignal threading | Reusing the chart-query AbortController for the materialize call | Materialize and chart query have separate lifecycles; materialize should be aborted on the next filter change, not on component unmount |
| Server route session context | Reading `userId` from `req.user.username` (string in OIDC mode) vs integer assumption | Sanitize userId for view name generation (V13-P-08) — handle both string and number |
| `buildWmsParams` signature change | Removing the `whereClause` param without updating all 3+ callers atomically | Update callers before deleting the param; use TypeScript compiler errors as the deletion checklist |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-widget materialize calls | 4+ parallel `POST /api/filter/materialize` for same table | Shared coordinator at dashboard level (V13-P-15) | Day 1 with > 2 widgets on same table |
| No AbortController on materialize | In-flight materialize from old filter state completes after new state is stored | Dedicated `materializeAbortRef` per table (V13-P-02) | On rapid filter changes (< 300ms between clicks) |
| TTL re-materialize on every expiry | If user is idle and returns, every widget triggers a separate re-materialize on their first query failure | Coordinator deduplicates re-materialize calls per (tableId, dashboardId) | On any page with multiple widgets and a user returning after > 5 min |
| Schema-unqualified view names with high user count | WMS LAYERS resolution failure if user's default schema is unexpected | Spike S4 validation; optionally schema-qualify view names in P2 | Any deployment where user schema != expected default |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Show error widget on TTL expiry | User sees broken charts with no context | Transparent re-materialize; show loading state, not error state (V13-P-05) |
| Show generic "something went wrong" on permission error | User has no actionable information | Show "Filtering unavailable — contact DBA to enable CREATE VIEW permission" (V13-P-12) |
| Filter bar shows active filters while data is from raw table (permission denied) | Silent wrong results — user thinks filter is applied | After permission error is detected, add a visual "filter degraded" indicator to the filter bar chips |
| Re-materialize happens silently on every 5-minute idle return | Surprise loading spinners after user returns to dashboard | Expected behavior; add a subtle loading indicator only on the charts currently refetching |

---

## "Looks Done But Isn't" Checklist

- [ ] **View-name swap in RecordsTableRenderer**: Charts filter correctly — verify records table ALSO queries the filtered view (V13-P-11). Check by applying a filter and confirming the records table row count changes.
- [ ] **AbortController on materialize**: Rapid clicking works — verify Network tab shows previous materialize calls cancelled (network request status = "cancelled") before a new one fires.
- [ ] **TTL expiry recovery**: Filter appears active after 6+ minutes idle — verify no widget error state (V13-P-05). Simulate by reducing TTL to 1 minute in dev, leaving the page idle, then returning.
- [ ] **Dead-code deletion completeness**: Test suite is fully green — verify `filterStore.spec.ts` and `wmsUrlBuilder.spec.ts` have no failing tests referencing deleted exports (V13-P-07, V13-P-10).
- [ ] **OIDC userId sanitization**: OIDC user can apply a filter — verify the generated view name contains no special characters from OIDC claim strings (V13-P-08). Test with a username like `user@domain.com`.
- [ ] **Permission error toast**: User without CREATE VIEW permission sees an actionable message — verify by testing against a read-only Kinetica user account (V13-P-12).
- [ ] **Effect 3 preserved fixes**: Map renders after filter clear and re-apply — verify no blank tile flash (PITFALL M-02 regression), no doubled OL Map in dev StrictMode (PITFALL M-01 regression) (V13-P-06).
- [ ] **WMS cache-bust on filter update**: Map updates when filter is changed to a different value on the same table — verify new WMS requests fire in Network tab (V13-P-04).
- [ ] **Zustand shim covers `useFilterViewStore`**: Filter view state does not bleed between tests — run the test suite with `--reporter=verbose`, check for order-dependent failures (regression of v1.2 PITFALL S-03).
- [ ] **Store update only after server confirm**: No widget error flash after filter click — verify 200-300ms after a filter click, no error state appears before data loads (V13-P-01).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| V13-P-01: Store update before server confirm | LOW | Add `await` before `setView()` call in effect; re-run tests |
| V13-P-02: Out-of-order materialize response | LOW | Add dedicated `materializeAbortRef`; pattern is established from chart-query AbortController |
| V13-P-04: WMS tile cache not busted | LOW | Add `_mv` param to `buildWmsParams`; update `wmsUrlBuilder.spec.ts` |
| V13-P-06: Effect 3 collapse broke v1.2 fixes | MEDIUM | Restore Effect 3 body from v1.2 git history; apply only the v1.3 delta (LAYERS swap, remove WHERE clause) |
| V13-P-07: Dead-code deletion broke callers | HIGH | Restore deleted functions from git; re-plan deletion order; execute incrementally with tsc checks |
| V13-P-08: OIDC userId invalid in view name | LOW | Add sanitizer function; redeploy; existing views with bad names expire via TTL |
| V13-P-11: RecordsTableRenderer not updated | LOW | Update `RecordsTableRenderer` in P3; likely missed in initial implementation pass |
| V13-P-12: Permission error silently swallowed | LOW | Add `instanceof PermissionError` branch to catch block; add toast |

---

## Pitfall-to-Phase Mapping

| Pitfall ID | Pitfall | Prevention Phase | Verification |
|------------|---------|------------------|--------------|
| V13-P-01 | Store update before server confirms view | P2 spec + P3 implementation | Widget shows no error flash on filter click |
| V13-P-02 | Out-of-order materialize response | P2 client function (AbortSignal) + P3/P4 effect | Rapid filter clicks show correct final filter state |
| V13-P-03 | Clear-All while materialize in flight | P3 effect (DROP path on empty filters) | Clear-All while debounce pending leaves no stale view |
| V13-P-04 | WMS LAYERS swap cache not invalidated | P4 map wiring (`_mv` or `_v` retention) | Map updates on filter-value change for same table |
| V13-P-05 | TTL expiry surfaces as unrecoverable 502 | P3 catch block (view-not-found detection) | Charts recover transparently after 5+ min idle |
| V13-P-06 | Effect 3 collapse breaks v1.2 fixes | P4 map wiring (line-by-line diff review) | Map functions correctly post-v1.3 in dev and prod |
| V13-P-07 | Dead-code deletion breaks active callers | P5 cleanup (ordered deletion + tsc checks) | `tsc --noEmit` and full test suite green after each deletion |
| V13-P-08 | OIDC userId invalid chars in view name | P2 backend endpoint (sanitizer) | OIDC user can apply filter without Kinetica DDL error |
| V13-P-09 | Concurrent tabs last-write-wins | P2 (document in code comment) | Documented; not fixed in v1.3 |
| V13-P-10 | wmsUrlBuilder FILT-04 tests fail on deletion | P5 cleanup (test deletion checklist) | `wmsUrlBuilder.spec.ts` fully green after v1.3 |
| V13-P-11 | RecordsTableRenderer not updated | P3 chart wiring | Records table shows filtered rows when filter active |
| V13-P-12 | Permission error silently disables filtering | P3 catch block (PermissionError branch) | User sees actionable toast on 403 from materialize |
| V13-P-13 | State desync after server crash | P3 DROP error handling (always-clear pattern) | Filter state is clean after server restart |
| V13-P-14 | Debounce timer not cleared on unmount | P3/P4 effect cleanup | No materialize calls fire after dashboard navigation |
| V13-P-15 | Multiple widgets trigger duplicate materialize | P3 (coordinator architecture decision) | Network tab shows 1 materialize call per filter change |
| V13-P-16 | Empty filter after removeFilter doesn't DROP | P3 effect (getState() vs closure) | Last-filter removal triggers view drop |
| V13-P-17 | sessionShort collision across deployments | P2 (KBI_DEPLOYMENT_ID env var) | Documented in deploy runbook |
| V13-P-18 | Test mocking wrong shape for materialize | P2 server test + P3 frontend test | Materialize spec asserts on DDL SQL string shape |
| V13-P-19 | Unqualified view name WMS resolution | P1 spike (S4) + P2 if schema-qual needed | Map tiles render for filtered view name |

---

## Sources

- Codebase analysis: `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer` AbortController pattern (lines 224-253); `RecordsTableRenderer` independent data fetch (lines 900-929); drill-down 300ms setTimeout pattern
- Codebase analysis: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect 1 (M-01 lock, lines 229-279); Effect 2 (layer reconciliation, lines 286-397); Effect 3 (M-02 lock, lines 404-423); `buildWhereClause` calls in both Effects 2 and 3
- Codebase analysis: `kinetica_bi/src/store/filterStore.ts` — `PITFALL S-02` primitive dep lock (filterVersion); `PITFALL D-05` same-column replace; dead-code export targets (`injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter`)
- Codebase analysis: `kinetica_bi/src/store/filterStore.spec.ts` — 20+ tests covering deleted exports; test deletion scope for P5
- Codebase analysis: `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` — FILT-04 describe block (lines 470-492) asserting on `QUERY` param; `_v` cache-buster tests (lines 70-78)
- `.planning/PROJECT.md` — v1.3 architecture (locked), v1.2 known gaps (TD-V12-01 root cause), v1.1 OIDC mode (string userId source)
- `.planning/MILESTONES.md` — v1.2 Phase 10 "RESEARCH.md Pitfall 3: RecordsTableRenderer not subscribed to filter store"; Phase 12 LAYER-12 hard cutover decision
- `.planning/research/STACK.md` — Kinetica DDL syntax (TTL, CREATE OR REPLACE, DROP TABLE IF EXISTS); WMS LAYERS spike requirement S1/S4; per-user DDL permission model; `classifyHttpError` existing 400+access-denied → `KineticaPermissionError` mapping
- `.planning/research/_archive_v1.2/PITFALLS.md` — M-01 (map dispose), M-02 (WMS cache bust), S-02 (filterVersion primitive dep), S-03 (Zustand shim), C-02 (per-table filter scoping) — all carried forward as regression risks
- [Kinetica TTL Concepts 7.1](https://docs.kinetica.com/7.1/concepts/ttl/) — sliding TTL behavior, auto-drop on expiry
- [Kinetica DDL Reference 7.1](https://docs.kinetica.com/7.1/sql/ddl/) — CREATE OR REPLACE MATERIALIZED VIEW syntax
- [Kinetica Table Naming 7.1](https://docs.kinetica.com/7.1/concepts/tables/) — allowed identifier characters (pipe `|` not in allowed set)
- [Kinetica WMS REST API 7.1](https://docs.kinetica.com/7.1/api/rest/wms_rest/index.html) — LAYERS param format (views not mentioned; LOW confidence for view support)

---
*Pitfalls research for: v1.3 Unified Dashboard Filtering (server-side materialized-view filter added to v1.2 client-side filter infrastructure)*
*Researched: 2026-05-06*
