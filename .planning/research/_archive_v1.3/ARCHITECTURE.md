# Architecture Research

**Domain:** v1.3 Unified Dashboard Filtering — integration of transient Kinetica materialized views into existing v1.2 architecture
**Researched:** 2026-05-06
**Confidence:** HIGH (all integration points derived from reading actual source files; no training-data assumptions)

---

## Standard Architecture

### System Overview — v1.3 Filter Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React 18 + Zustand)                                          │
│                                                                         │
│  ┌──────────────────┐   filterVersion++   ┌────────────────────────┐   │
│  │  useFilterStore  │ ──────────────────→ │  useFilterViewStore    │   │
│  │  (chip display)  │                     │  (NEW — view-name map) │   │
│  │  STAYS unchanged │                     │  { [tableId]: string } │   │
│  └──────────────────┘                     └───────────┬────────────┘   │
│           │                                           │ viewName       │
│    filter │ addFilter                                 │ (or null)      │
│    chip   │                                           ▼                │
│    clicks │                               ┌────────────────────────┐   │
│           │                               │  useFilterEffect hook  │   │
│           │                               │  (NEW — debounced 300ms│   │
│           │                               │   materialize trigger) │   │
│           │                               └───────────┬────────────┘   │
│           │                                           │ POST           │
│           ▼                                           ▼                │
│  ┌──────────────────────┐              ┌──────────────────────────────┐ │
│  │ AggregatedWidget     │              │  materializeFilter()         │ │
│  │ Renderer             │              │  (NEW client fn in client.ts)│ │
│  │ reads viewName from  │              │  + dropFilterView()          │ │
│  │ useFilterViewStore   │              └──────────────────────────────┘ │
│  │ swaps FROM <table>   │                                               │
│  │ → FROM <view>        │                                               │
│  └──────────────────────┘                                               │
│                                                                         │
│  ┌──────────────────────┐                                               │
│  │ MapChartRenderer     │                                               │
│  │ Effect 3 → reads     │                                               │
│  │ viewName; calls      │                                               │
│  │ updateParams({LAYERS:│                                               │
│  │   viewName ?? table})│                                               │
│  └──────────────────────┘                                               │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │ POST /api/filter/materialize
                                       │ body: { tableId, dashboardId, filters }
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express 4 + TypeScript)                                       │
│                                                                         │
│  POST /api/filter/materialize   (NET-NEW route — not in existing views) │
│  DELETE /api/filter/materialize (NET-NEW route)                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  filterMaterializeHandler (asyncHandler-wrapped)                │   │
│  │  1. requireAuth → reads req.user (existing, unchanged)          │   │
│  │  2. requireConfig → KINETICA_URL check (existing, unchanged)    │   │
│  │  3. Derives: userId from req.user.creds.username               │   │
│  │             sessionId from JWT sid (decoded, not DB hit)        │   │
│  │  4. Constructs view name: _kbi_filt_u<h>_d<d>_t<t>_s<s>       │   │
│  │  5. filters.length > 0 → kineticaSql DDL (CREATE OR REPLACE)  │   │
│  │     filters.length === 0 → kineticaSql DDL (DROP TABLE IF EXISTS)  │
│  │  6. Returns { viewName, ttlMinutes: 5 } or { dropped: true }   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                          │                                              │
│                          ▼                                              │
│  ┌──────────────────────────────────┐                                  │
│  │  kineticaSql(req, ddl, {         │  (EXISTING — zero changes)       │
│  │    route: "POST /api/filter/...",│                                  │
│  │    op: "MATERIALIZE"             │                                  │
│  │  })                              │                                  │
│  └──────────────────────┬───────────┘                                  │
│                         │                                               │
└─────────────────────────┼───────────────────────────────────────────────┘
                          │ POST /execute/sql (CREATE OR REPLACE / DROP)
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  KINETICA GPU-DB                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  _kbi_filt_u<h>_d<d>_t<t>_s<s>                                  │  │
│  │  materialized view with WHERE clause                              │  │
│  │  TTL=5 (sliding per-access, auto-drop on 5min idle)              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  WMS endpoint: LAYERS=<view_name> when filtered                  │  │
│  │               LAYERS=<schema.table> when not                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Analysis: Every Existing Module Touched

### NEW vs MODIFIED vs DELETED — Explicit Breakdown

| File | Status | What Changes |
|------|--------|--------------|
| `server/src/index.ts` | MODIFIED | Add 2 new routes: `POST /api/filter/materialize` + `DELETE /api/filter/materialize` (or `filters: []` convention on POST). Mount before `errorMiddleware`. |
| `server/src/kinetica.ts` | UNCHANGED | `kineticaSql()` + `kineticaWms()` reused verbatim. `op: "MATERIALIZE"` already exists in `KineticaOp`. |
| `server/src/db.ts` | UNCHANGED | No new SQLite table. Transient views live only in Kinetica. The existing `dashboard_table_views` table is NOT used for v1.3 transient views. |
| `src/store/filterStore.ts` | MODIFIED (dead code deletion only) | Delete: `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`. Keep: all of `FilterState`, `ActiveFilter`, `useFilterStore`, `filterVersion` counter, `addFilter` / `removeFilter` / `clearFilters` / `reset`. |
| `src/store/filterViewStore.ts` | NET-NEW | New Zustand slice: `{ views: Record<number, string \| null>, expiresAt: Record<number, number> }`. Actions: `setView(tableId, viewName, expiresAt)`, `clearView(tableId)`, `resetAll()`. |
| `src/api/client.ts` | MODIFIED (additions only) | Add `materializeFilter(tableId, dashboardId, filters, signal?)` and `dropFilterView(tableId, dashboardId, signal?)` client functions following the existing `apiFetch` + `throwForStatus` pattern. |
| `src/components/charts/WidgetRenderer.tsx` | MODIFIED | `AggregatedWidgetRenderer`: remove `buildWhereClause` + `injectWhereClause` imports; add `useFilterViewStore` selector for viewName; replace `injectWhereClause(sql, whereClause)` with `sql.replace(FROM_PATTERN, \`FROM ${viewName}\`)`. Add `useFilterEffect` hook call or inline debounced materialize trigger on `filterVersion`. |
| `src/components/charts/MapChartRenderer.tsx` | MODIFIED | Effect 3: remove `buildWhereClause` import; remove `whereClause` computation; subscribe to `useFilterViewStore(s => s.views[layer.table_id])`; call `source.updateParams({ LAYERS: viewName ?? tableRef })`. The Effect 3 dep array changes from `[filterVersion, includedLayers, tables]` to `[viewNames, includedLayers, tables]` where `viewNames` is a stable primitive (e.g. JSON.stringify of the view map). |
| `src/lib/wmsUrlBuilder.ts` | MODIFIED | `buildWmsParams` signature changes: remove `filterVersion: number` and `whereClause: string` params. Remove `_v` cache-buster emission. Remove `QUERY` / `FILTER_PARAM` block. Caller passes `layersOverride?: string` for the view name, or the builder accepts `viewName?: string` so LAYERS = viewName ?? tableRef. |
| `src/lib/filterStore.ts` (dead code only) | See filterStore.ts row above | `buildWhereClause`, `injectWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` deleted |

### Files That Are UNTOUCHED

- `server/src/auth.ts` — `requireAuth` unchanged; the new endpoint flows through it identically
- `server/src/sessionStore.ts` — session structure unchanged; `req.user.creds` + `credentialType` used by `kineticaSql` as-is
- `server/src/kineticaErrors.ts` — typed errors unchanged; `KineticaPermissionError` (DDL denied) + `KineticaUpstreamError` (view not found on expired TTL) cover all new failure modes
- `server/src/oidc.ts` — unchanged
- `src/store/dashboardLayersStore.ts` — unchanged; layer list structure unchanged; `layer.table_id` is how the view name lookup is resolved at render time
- `src/store/toast.ts` — unchanged; toast on TTL expiry reuses existing `showToast`
- All drill-down click handlers in chart renderers — unchanged; they call `useFilterStore.addFilter`, which remains identical

---

## Question-by-Question Integration Analysis

### Q1: New Backend Endpoint Shape

**Endpoint:** `POST /api/filter/materialize`

**Request body:**
```typescript
{
  tableId: number;      // SQLite tables.id — used to look up schema.name for DDL
  dashboardId: number;  // For composite view name
  filters: ActiveFilter[]; // [] = clear/drop; non-empty = create/replace
}
```

**Response (filters non-empty):**
```json
{ "viewName": "_kbi_filt_u<h>_d42_t9_s1aef", "ttlMinutes": 5 }
```

**Response (filters empty — drop path):**
```json
{ "dropped": true }
```

**Idempotency:** `CREATE OR REPLACE MATERIALIZED VIEW` is inherently idempotent at the Kinetica level. Concurrent calls with the same scope write the same view name and the same DDL (assuming same filters). Last-write-wins is correct and harmless — no locking needed. The server does not need an in-memory dedup layer.

**Debounce:** Frontend-only, 300ms `setTimeout` in a `useEffect` cleanup pattern (identical to the existing `LayersModal` auto-save debounce). The server endpoint is stateless and idempotent, making server-side debounce unnecessary.

**Same-user concurrent calls:** Two rapid filter clicks → two concurrent POST calls. Both issue `CREATE OR REPLACE` with different WHERE clauses but the same view name. Kinetica DDL is serialized at the engine level; the second write wins, which is the desired behavior (the most recent filter state). No optimistic locking needed.

**View name construction (server-side, deterministic):**
```typescript
// In the new route handler in index.ts:
const username = (req as AuthedRequest).user!.creds.username;
const sessionId = decodeAndVerifyJwt(req)?.sid ?? "unknown";
// Hash or truncate to keep name short and URL-safe:
const userHash = username.replace(/[^a-z0-9]/gi, "").slice(0, 8);
const sessionShort = sessionId.slice(0, 4);
const viewName = `_kbi_filt_u${userHash}_d${dashboardId}_t${tableId}_s${sessionShort}`;
```

The view name is returned to the client and stored in `useFilterViewStore`. The server does not persist it — it is re-derivable from the same inputs on any future request.

**Where to mount:** In `index.ts`, AFTER `app.use("/api", requireAuth)` and with `requireConfig` middleware, BEFORE `errorMiddleware`. Use `asyncHandler` wrapper (same pattern as `/api/views/:id/materialize`).

**DELETE (clear) — use POST with empty filters:** Rather than a separate DELETE route, the convention `filters: []` on POST triggers `DROP TABLE IF EXISTS`. This avoids a second Express route and matches the single-endpoint pattern that's simpler to test.

---

### Q2: Backend State — Does the Server Track Active Views?

**Answer: No. Kinetica TTL is the single source of truth. Zero SQLite rows for transient views.**

Rationale from the codebase:
- The existing `dashboard_table_views` table (in `db.ts`) is for persisted, manually-managed views with a `status` lifecycle. It is NOT the right abstraction for transient filter views.
- The `updateViewStatus()` function (called by the existing materialize endpoint's try/catch) would require a matching row to exist — transient views have no row.
- Adding a second SQLite table for transient views duplicates state that Kinetica already tracks via TTL. The `DROP TABLE IF EXISTS` idiom handles the case where the view already expired — the `IF EXISTS` clause prevents errors.

**What the server does instead:**
- Constructs the view name deterministically from `(username, dashboardId, tableId, sessionId)` inputs available on every request
- Issues DDL fire-and-forget (no status column to update)
- Returns `{ viewName }` — the client stores it; the server has no memory of it

**Drop vs TTL:** The server issues `DROP TABLE IF EXISTS` explicitly when `filters: []` arrives. This is faster than waiting for TTL expiry (gives immediate feedback) and avoids leaving stale views when a user clears all filters and navigates away. TTL handles the case where the user simply walks away without explicitly clearing.

---

### Q3: Client-Side Flow — Where Does Debounce Live?

**Architecture decision: debounce lives in `AggregatedWidgetRenderer`'s filter-change `useEffect`, NOT in `useFilterStore` middleware or a standalone hook.**

Rationale: This matches the existing debounce placement in `LayersModal` auto-save. The `useEffect` cleanup pattern (`clearTimeout` in return) is already in the codebase and understood by all maintainers.

**Exact flow:**

```
User clicks bar chart element
  → dispatchDrillDown() (unchanged)
    → useFilterStore.addFilter(tableId, filter) (unchanged)
      → filterVersion++ (unchanged)
        → AggregatedWidgetRenderer useEffect fires on [sql, filterVersion]
          → clearTimeout(prevTimer)
          → setTimeout(300ms, () => {
              const filters = useFilterStore.getState().filters[tableId] ?? [];
              if (filters.length > 0) {
                materializeFilter(tableId, dashboardId, filters, signal)
                  .then(({ viewName }) => {
                    useFilterViewStore.getState().setView(tableId, viewName, Date.now() + 5*60*1000);
                  })
              } else {
                dropFilterView(tableId, dashboardId, signal)
                  .then(() => useFilterViewStore.getState().clearView(tableId));
              }
            })
```

**Who triggers the materialize:** `AggregatedWidgetRenderer` is the correct site because:
1. It already subscribes to `filterVersion` for its own SQL refresh
2. Debouncing the materialize alongside the SQL fetch avoids a race where the SQL runs before the view is created
3. It has `tableId` and can read `dashboardId` from `widget.config.dashboardId` (already stored in widget config)

**MapChartRenderer** does NOT call materialize. It only reads the resolved `viewName` from `useFilterViewStore`. Maps are consumers of the view, not triggers of its creation. This avoids duplicate materialize calls when both chart widgets and map widgets exist for the same table.

**The `useFilterViewStore` new Zustand slice:**
```typescript
type FilterViewState = {
  views: Record<number, string>;       // tableId → viewName (absent = use raw table)
  expiresAt: Record<number, number>;   // tableId → Date.now() ms timestamp
  setView: (tableId: number, viewName: string, expiresAt: number) => void;
  clearView: (tableId: number) => void;
  resetAll: () => void;  // called by App.tsx on logout + DashboardsPage on dashboard switch
};
```

---

### Q4: Source-of-Truth Split

**`useFilterStore`:** Owns chip display state (column, value, addedAt), filter version counter, 10-cap logic, dedupe/replace logic. Drives the filter bar UI. Unchanged from v1.2.

**`useFilterViewStore`:** Owns the resolved view name per tableId. This is the only state widget SQL execution and WMS LAYERS param depend on. Separate slice because:
- Chip display and SQL execution are different concerns with different update cadences (chip updates instantly on click; view name updates after 300ms debounce + server round-trip)
- Separating avoids `AggregatedWidgetRenderer` re-rendering on every filterVersion bump that doesn't yet have a resolved view name

**Widget re-render triggers:**

| Trigger | Which Store | Who Re-renders |
|---------|-------------|----------------|
| User clicks chart element | `filterVersion++` in filterStore | Filter bar chips (useFilterStore subscriber), AggregatedWidgetRenderer useEffect |
| materialize call resolves | `setView(tableId, ...)` in filterViewStore | AggregatedWidgetRenderer re-reads viewName selector → re-runs SQL effect with FROM swap |
| MapChartRenderer viewName changes | filterViewStore subscription in Effect 3 | `source.updateParams({ LAYERS: viewName })` per layer |

**React Query cache:** NOT used. The existing pattern is bare `apiFetch` calls in `useEffect` with AbortController. The new `materializeFilter` client function follows the same pattern (no React Query wrapper). This keeps consistency with the existing ~22 un-migrated helpers.

---

### Q5: MapChartRenderer Effect 3 Collapse

**Current Effect 3 (v1.2 — to be replaced):**
```typescript
useEffect(() => {
  if (isOldPhase11Config(widgetConfig)) return;
  for (const layer of includedLayers) {
    const source = imageSourcesRef.current.get(layer.id);
    if (!source) continue;
    const tableId = layer.table_id;
    const tableFilters = useFilterStore.getState().filters[tableId] ?? [];
    const whereClause = buildWhereClause(tableFilters);   // ← DELETE
    const tableMeta = tables.find((t) => t.id === tableId);
    const tableRef = tableMeta ? `${tableMeta.schema}.${tableMeta.name}` : undefined;
    const wmsConfigInput = { ...cfg, tableId, tableRef } as MapWidgetConfig;
    source.updateParams(buildWmsParams(wmsConfigInput, filterVersion, whereClause));  // ← QUERY+_v
  }
}, [filterVersion, includedLayers, tables]);
```

**v1.3 Effect 3:**
```typescript
// New: subscribe to viewName map from filterViewStore
const filterViews = useFilterViewStore((s) => s.views);
// Stable primitive dep: JSON.stringify of the view map keyed by layers present
const viewsKey = JSON.stringify(includedLayers.map(l => filterViews[l.table_id] ?? null));

useEffect(() => {
  if (isOldPhase11Config(widgetConfig)) return;
  for (const layer of includedLayers) {
    const source = imageSourcesRef.current.get(layer.id);
    if (!source) continue;
    const tableId = layer.table_id;
    const viewName = filterViews[tableId] ?? null;
    const tableMeta = tables.find((t) => t.id === tableId);
    const tableRef = tableMeta ? `${tableMeta.schema}.${tableMeta.name}` : undefined;
    const layersParam = viewName ?? tableRef;
    const cfg = layer.config as Record<string, unknown>;
    const wmsConfigInput = { ...cfg, tableId, tableRef } as MapWidgetConfig;
    // updateParams only updates LAYERS — all other WMS params stay from Effect 2 initial build
    source.updateParams({ ...buildWmsParams(wmsConfigInput), LAYERS: layersParam });
  }
}, [viewsKey, includedLayers, tables]);
```

**This is Effect 2 vs Effect 3 territory clarification:**
- Effect 2 (unchanged): creates/removes/updates ImageWMS sources when `includedLayers` changes. It builds the initial `buildWmsParams` call at layer-add time.
- Effect 3 (modified): fires when the resolved view name changes (not when filter chips change). Calls `updateParams` on existing sources — does NOT rebuild sources. This preserves the PITFALL M-02 lock (never rebuild the Map on filter change).

**LAYERS param in Effect 2 (initial source build):** At layer add time in Effect 2, the view name may not yet exist (no filter active at mount). Effect 2 should use `tableRef` (unfiltered) for the initial build. Effect 3 then updates LAYERS to the view name once materialize resolves.

---

### Q6: AggregatedWidgetRenderer SQL Synthesis

**Current (v1.2):**
```typescript
const whereClause = buildWhereClause(tableFilters);
const finalSql = injectWhereClause(sql, whereClause);
```

**v1.3 replacement:**
```typescript
const viewName = useFilterViewStore((s) => tableId !== undefined ? s.views[tableId] : undefined);
const expiresAt = useFilterViewStore((s) => tableId !== undefined ? s.expiresAt[tableId] : undefined);

// In the useEffect that runs SQL:
// Proactive expiry check: if view is known and expired, clear it so the next filter event
// triggers re-materialize. Do NOT re-materialize here — the materialize debounce effect
// will fire when filterVersion advances again.
if (viewName && expiresAt && Date.now() >= expiresAt) {
  useFilterViewStore.getState().clearView(tableId!);
}

const activeView = viewName && !(expiresAt && Date.now() >= expiresAt) ? viewName : undefined;
const finalSql = activeView
  ? sql.replace(/\bFROM\s+([\w."]+)/i, `FROM ${activeView}`)
  : sql;
```

**Why `sql.replace` not `injectWhereClause`:**
- The view contains the WHERE clause baked in — no SQL manipulation needed at query time
- `FROM <view>` swap has zero injection surface (view name is `_kbi_filt_[alnum_]` only)
- Handles all SQL shapes (bare SELECT, with GROUP BY, with ORDER BY) without regex-on-GROUP-BY complexity

**Where the baseSql `FROM <table>` value comes from:** Widget config's `sql` field (already stored with the original table name e.g. `FROM demo.taxi_trips`). The swap replaces only the first `FROM <token>` match. This is safe for the SQL shapes that `ChartConfigPanel` generates (single-table, no subqueries).

**Store the view name on widget config? No.** Widget config is persisted in SQLite and shared across sessions. The view name is session-scoped and transient. Storing it in config would leak stale view names across sessions and require migration logic. `useFilterViewStore` is the right home.

**Fetch baseSql with FROM substituted by server? No.** The server would need to know the active view per widget — a stateful server-side concern that contradicts the stateless endpoint design. Client-side substitution at render time is simpler and correct.

---

### Q7: Cross-Phase Integration with Map LAYERS

**Current LAYERS resolution (v1.2 Effect 2):**
```typescript
const tableMeta = tables.find((t) => t.id === layer.table_id);
const tableRef = `${tableMeta.schema}.${tableMeta.name}`;
const wmsParams = buildWmsParams({ ...cfg, tableId, tableRef }, filterVersion, whereClause);
// → LAYERS = "demo.taxi_trips"
```

**v1.3 resolution:** At Effect 3 time (after view name resolves):
```typescript
const viewName = filterViews[layer.table_id] ?? null;
const layersParam = viewName ?? tableRef;
source.updateParams({ ...buildWmsParams({ ...cfg, tableId, tableRef }), LAYERS: layersParam });
// → LAYERS = "_kbi_filt_u..." (when filtered) or "demo.taxi_trips" (when not)
```

**Client-side substitution, not a new backend endpoint.** The `dashboard_layers.table_id` → `tableRef` lookup is already done in Effect 2 via `tables.find(...)`. The `useFilterViewStore` lookup is a second O(1) map read keyed by `table_id`. No new endpoint needed for this resolution.

**Schema qualification of view names in LAYERS param:** This is Spike S4 from STACK.md. If the user's Kinetica default schema differs from the source table's schema, an unqualified `_kbi_filt_...` view name may resolve incorrectly. The server should return the fully-qualified view name if the user's schema is known, or the client should schema-qualify using the same schema as the source table. Resolution: the server returns `viewName` as constructed (unqualified), and the operator spike (S4) determines whether schema qualification is needed. If yes, append `req.user.creds.username`-derived schema prefix.

---

### Q8: TTL Expiry Recovery

**Recovery flow (concrete, not TBD):**

A. **Proactive (primary path):** `useFilterViewStore` stores `expiresAt = Date.now() + 5*60*1000` when the view is created. Before each chart SQL execution in `AggregatedWidgetRenderer`, the effect checks `Date.now() >= expiresAt`. If expired:
1. Call `useFilterViewStore.getState().clearView(tableId)` — removes view name from store
2. Do NOT re-materialize immediately — the existing `filters` for this table are still in `useFilterStore`
3. On the next user interaction (filter change → `filterVersion++`), the materialize debounce fires again and creates a fresh view
4. Between expiry detection and next interaction: `finalSql` falls back to raw table (`activeView = undefined`)

B. **Reactive (fallback for edge cases where proactive fails):** If a SQL query executes with a view name that Kinetica has already dropped, the error chain is:
- Kinetica returns non-2xx (likely 400 with "table not found" body message)
- `kineticaSql` throws `KineticaUpstreamError` (the `/access denied/i` check does not match "not found" messages)
- Express `errorMiddleware` returns 502 to the client
- `AggregatedWidgetRenderer` catches in the `.catch()` block
- Check error message for "not found" / "does not exist" patterns → if matched, call `useFilterViewStore.getState().clearView(tableId)` and show a toast: "Filter view expired — re-apply filter to refresh"
- Next filter interaction re-materializes

**New error classification needed:** The reactive path requires recognizing "view not found" as a recoverable condition, not a 502 shown as a permanent error. Add a new error check in the `AggregatedWidgetRenderer` `.catch()`:
```typescript
.catch((err) => {
  if (err?.name === "AbortError") return;
  // View expiry recovery: clear stale view name and prompt user
  if (err instanceof UpstreamError && /not found|does not exist/i.test(err.message)) {
    if (tableId !== undefined) {
      useFilterViewStore.getState().clearView(tableId);
    }
    useToastStore.getState().showToast(
      "Filter view expired. Click a chart element to re-apply filter.", "info"
    );
    return; // Don't show error state — fall back to unfiltered SQL on next render
  }
  setError(err.message);
})
```

**Map tiles (WMS):** When WMS returns an error because the LAYERS view expired, `MapChartRenderer` already has the `handleTileError` / error overlay. In v1.3, add a check in `imageloaderror` handler: if status matches a view-expiry signature, call `useFilterViewStore.getState().clearView(layer.table_id)`. The map will then re-request with `LAYERS = tableRef` (unfiltered) on next Effect 3 trigger.

---

### Q9: Test Infrastructure — New Patterns Needed

**Server tests (vitest + supertest):**

The existing materialize endpoint (`POST /api/views/:id/materialize`) has a try/catch that calls `updateViewStatus` as a side effect before forwarding to `next(err)`. The new `/api/filter/materialize` endpoint does NOT have this side-effect complexity (no SQLite row to update). It is simpler to test.

**New mock pattern needed: DDL interception.** Existing `kineticaSql` mock harness (used in supertest tests) stubs the `fetch` global. The same harness works for DDL — the handler calls `kineticaSql(req, ddl, { op: "MATERIALIZE" })` which calls `fetch(${KINETICA_URL}/execute/sql)`. The existing `global.fetch = vi.fn(...)` stub in test setup intercepts this.

**What to assert in server tests:**
```typescript
// Test: POST /api/filter/materialize with non-empty filters
it("creates a materialized view and returns viewName", async () => {
  // fetchMock resolves with a successful Kinetica response
  const res = await req.post("/api/filter/materialize")
    .set("Cookie", authCookie)
    .send({ tableId: 1, dashboardId: 1, filters: [{ column: "zone", value: "East Village", ... }] })
    .expect(200);
  expect(res.body.viewName).toMatch(/^_kbi_filt_/);
  expect(res.body.ttlMinutes).toBe(5);
  // Assert fetchMock was called with a CREATE OR REPLACE statement
  expect(fetchMock.mock.calls[0][1]?.body).toContain("CREATE OR REPLACE MATERIALIZED VIEW");
  expect(fetchMock.mock.calls[0][1]?.body).toContain("TTL = 5");
});
```

**Frontend tests (vitest + jsdom + RTL):**

New pattern: mock `materializeFilter` client function. The existing Zustand store-reset shim (`beforeEach(() => { useFilterStore.setState(initialState); })`) extends cleanly to `useFilterViewStore`.

**View-name resolution mock:**
```typescript
// In test setup:
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, materializeFilter: vi.fn().mockResolvedValue({ viewName: "_kbi_filt_test", ttlMinutes: 5 }) };
});
```

**FROM swap test (unit):**
```typescript
it("swaps FROM <table> to FROM <view> when view is active", () => {
  const sql = "SELECT zone, COUNT(*) AS value FROM demo.taxi_trips GROUP BY zone";
  const viewName = "_kbi_filt_u8_d1_t1_s1a2b";
  const result = sql.replace(/\bFROM\s+([\w."]+)/i, `FROM ${viewName}`);
  expect(result).toBe("SELECT zone, COUNT(*) AS value FROM _kbi_filt_u8_d1_t1_s1a2b GROUP BY zone");
});
```

**Does the existing `kineticaSql` mock harness suffice?** Yes for server tests. The handler calls `kineticaSql` internally — the harness stubs `fetch` at the network layer. No new mock infrastructure needed.

---

## Recommended Architecture Patterns

### Pattern 1: Deterministic View Names (No Server State)

**What:** View name is derived from stable inputs `(username, dashboardId, tableId, sessionId)` using simple string operations — no database lookup, no in-memory registry.

**When to use:** Any time the server needs to identify a transient resource without storing state about it.

**Trade-offs:** Requires that the client stores the returned view name. The server cannot reconstruct "what views are currently active" without querying Kinetica — acceptable because Kinetica TTL is authoritative.

```typescript
// In the new route handler:
const userSlug = (req as AuthedRequest).user!.creds.username
  .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
const sessionShort = (decodeAndVerifyJwt(req)?.sid ?? "0").slice(0, 4);
const viewName = `_kbi_filt_u${userSlug}_d${dashboardId}_t${tableId}_s${sessionShort}`;
```

### Pattern 2: Dual-Store Filter Architecture (Chips vs Views)

**What:** `useFilterStore` owns chip display state and `filterVersion`. `useFilterViewStore` owns the resolved view name and `expiresAt`. Widgets subscribe to both, using `filterVersion` to trigger materialize and `viewName` to drive SQL/WMS.

**When to use:** When filter state has multiple downstream consumers with different update cadences (instant UI vs async server round-trip).

**Trade-offs:** Two stores to reset on logout/dashboard-switch. Mitigated by calling both `useFilterStore.getState().reset()` and `useFilterViewStore.getState().resetAll()` in the same App.tsx logout + DashboardsPage dashboard-switch handlers.

### Pattern 3: Proactive TTL Check + Reactive Recovery Fallback

**What:** Client stores `expiresAt` timestamp from server. Before executing SQL with a view name, checks `Date.now() >= expiresAt` and clears the stale view name proactively. The reactive fallback catches the rare case where the proactive check was wrong (e.g., system clock skew, or view was dropped early by a Kinetica server event).

**When to use:** Any time client-held references to server-side transient resources can expire.

**Trade-offs:** Optimistic — client's estimate of TTL may drift from Kinetica's actual timer. The 5-minute TTL is generous; in practice, active users keep the view alive via query access (sliding TTL). The proactive check catches the idle-user case cleanly.

---

## Data Flow

### Filter Click → View Resolved → Widget Re-render

```
1. User clicks bar element
   ↓
2. dispatchDrillDown() [WidgetRenderer.tsx]
   → useFilterStore.addFilter(tableId, filter)
   → filterVersion++
   ↓
3. AggregatedWidgetRenderer useEffect fires [dep: [sql, filterVersion]]
   → clearTimeout(debounceTimer)
   → setTimeout(300ms, materializeFilter)
   ↓
4. POST /api/filter/materialize { tableId, dashboardId, filters }
   → requireAuth (existing) → requireConfig (existing)
   → construct viewName (deterministic)
   → kineticaSql(req, "CREATE OR REPLACE MATERIALIZED VIEW ...", { op: "MATERIALIZE" })
   → Kinetica executes DDL, creates view with WHERE clause
   → return { viewName: "_kbi_filt_...", ttlMinutes: 5 }
   ↓
5. .then(({ viewName }) => useFilterViewStore.getState().setView(tableId, viewName, now+5min))
   ↓
6. useFilterViewStore selector updates → AggregatedWidgetRenderer re-renders
   → viewName now truthy
   → finalSql = sql.replace(FROM_PATTERN, `FROM ${viewName}`)
   → runSql(finalSql, undefined, controller.signal)
   ↓
7. Kinetica executes SQL against materialized view (filtered data)
   → parseKineticaResponse → setData → chart renders filtered result
   ↓
8. MapChartRenderer Effect 3 fires [dep: viewsKey (derived from filterViews)]
   → for each layer: source.updateParams({ LAYERS: viewName ?? tableRef })
   → OpenLayers ImageWMS re-fetches tiles with LAYERS=<view_name>
   → /api/wms proxy → Kinetica WMS renders tiles from filtered view
```

### Clear Filters Flow

```
1. User clicks "Clear all" in filter bar
   ↓
2. useFilterStore.clearFilters(tableId) → filterVersion++
   ↓
3. AggregatedWidgetRenderer useEffect fires
   → filters.length === 0
   → setTimeout(300ms, dropFilterView(tableId, dashboardId))
   ↓
4. POST /api/filter/materialize { tableId, dashboardId, filters: [] }
   → kineticaSql(req, "DROP TABLE IF EXISTS _kbi_filt_...", { op: "MATERIALIZE" })
   → return { dropped: true }
   ↓
5. useFilterViewStore.clearView(tableId) → views[tableId] removed
   ↓
6. AggregatedWidgetRenderer: viewName = undefined → finalSql uses raw table
7. MapChartRenderer Effect 3: LAYERS = tableRef (raw table) → unfiltered tiles
```

---

## Build Order: Phase Boundaries with Dependency Analysis

### Phase 1 — Spike + Backend Endpoint (2–3 plans)

**Must land first because:** All frontend consumers depend on the endpoint existing and returning a view name.

Plans:
1. **Operator spike** (S1–S4 from STACK.md): `LAYERS=<view>` WMS validation + DDL permission check. Run against deployed Kinetica before any code. If S1 fails, the entire map-filtering approach needs redesign.
2. **New route in `index.ts`:** `POST /api/filter/materialize` with view name construction, DDL execution via `kineticaSql`, `{ viewName, ttlMinutes: 5 }` response. Mount with `requireAuth` + `requireConfig` + `asyncHandler`. Include `filters: []` → DROP path.
3. **Supertest coverage:** Mock `fetch` for CREATE OR REPLACE DDL + DROP paths. Test permission denied (403), TTL field in response, view name format validation.

### Phase 2 — `useFilterViewStore` + `materializeFilter` client function (1–2 plans)

**Must land before chart wiring:** Both `AggregatedWidgetRenderer` and `MapChartRenderer` import from this store and this client function.

Plans:
1. **`src/store/filterViewStore.ts`:** New Zustand slice with `views`, `expiresAt`, `setView`, `clearView`, `resetAll`. Unit tests with store-reset shim.
2. **`src/api/client.ts` additions:** `materializeFilter(tableId, dashboardId, filters, signal?)` + `dropFilterView(tableId, dashboardId, signal?)`. Follow existing `apiFetch` + `throwForStatus` pattern. Unit tests with `vi.fn()` fetch mock.

### Phase 3 — AggregatedWidgetRenderer Rewire (1–2 plans)

**Depends on:** Phase 1 (endpoint) + Phase 2 (store + client fn). `RecordsTableRenderer` also needs wiring (it bypasses `AggregatedWidgetRenderer` but has the same filter subscription pattern).

Plans:
1. **`WidgetRenderer.tsx` rewrite of `AggregatedWidgetRenderer`:** Remove `buildWhereClause`, `injectWhereClause` imports. Add `useFilterViewStore` selector for `viewName` + `expiresAt`. Add debounced materialize trigger in `useEffect`. Add proactive expiry check. Add reactive recovery in `.catch()`. Wire `FROM` swap for `finalSql`. Test: RTL test with mocked `materializeFilter` verifying filtered SQL uses view name.
2. **`RecordsTableRenderer` rewire (if it uses filter):** Check whether RecordsTableRenderer currently injects WHERE. Reading the code: it does NOT — it uses a raw `SELECT ... FROM table` without filter injection. In v1.3, RecordsTableRenderer also needs the `FROM <view>` swap if a filter view is active for its `cfg.table`. This is a second consumer of `useFilterViewStore`.

### Phase 4 — MapChartRenderer Effect 3 + wmsUrlBuilder Cleanup (1–2 plans)

**Depends on:** Phase 2 (filterViewStore). Can run parallel to Phase 3 if needed.

Plans:
1. **`wmsUrlBuilder.ts` changes:** Remove `filterVersion` and `whereClause` params from `buildWmsParams`. Remove `_v` emission. Remove `QUERY` / `FILTER_PARAM` block. Signature becomes `buildWmsParams(config: MapWidgetConfig): Record<string, string>`. This is a breaking change that requires updating all callers (Effect 2 and Effect 3 in `MapChartRenderer.tsx`) simultaneously.
2. **`MapChartRenderer.tsx` Effect 3 rewrite:** Subscribe to `useFilterViewStore`. Compute `viewsKey` as primitive dep. Call `source.updateParams({ ...buildWmsParams(wmsConfigInput), LAYERS: viewName ?? tableRef })`. Add view-expiry recovery in `imageloaderror` handler.

### Phase 5 — Dead Code Deletion + Reset Wiring (1 plan)

**Depends on:** Phases 3 + 4 complete (no consumers of old utilities remain).

Plans:
1. **`filterStore.ts` dead code deletion:** Delete `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`. Delete the `FILTER_PARAM` constant in `wmsUrlBuilder.ts`. Ensure no imports remain (TypeScript compiler catches this). Confirm test suite passes.
2. **Reset wiring:** Extend logout handler (`App.tsx`) and dashboard-switch handler (`DashboardsPage`) to call `useFilterViewStore.getState().resetAll()` alongside existing `useFilterStore.getState().reset()`. Test: RTL test verifying both stores reset on logout.

### Phase 6 — End-to-End Verification + Test Fixture (1 plan)

**Closes:** TD-V12-01 (WMS QUERY filter never narrowed tiles) + TD-V12-04 (filter visually unverifiable).

Plans:
1. **Verification against deployed Kinetica:** Use a low-cardinality table (or construct one). Verify chart widgets show filtered data when a view is active. Verify WMS tiles narrow. Verify TTL expiry recovery. Write `VERIFICATION.md`.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Server-Side In-Memory View Registry

**What people do:** Maintain a `Map<string, { viewName, createdAt }>` in the Express process to track active views, then sweep it on TTL expiry.

**Why it's wrong:** Process restart clears the registry, leaving orphan views in Kinetica with no cleanup path. Multi-process deployments (PM2 clusters) have split registries. Kinetica TTL already handles cleanup — duplicating it adds complexity with no benefit.

**Do this instead:** Deterministic view name construction + `DROP TABLE IF EXISTS` on explicit clear. Let Kinetica TTL auto-drop idle views.

### Anti-Pattern 2: Storing Transient View Names in SQLite

**What people do:** Add a `transient_filter_views` SQLite table that mirrors what Kinetica holds, then use `dashboard_table_views`-style status lifecycle for transient views.

**Why it's wrong:** The existing `dashboard_table_views` table has `status: pending | created | error` with `updateViewStatus()` called from route handlers. Transient views have no meaningful status lifecycle — they are either alive or expired (Kinetica knows; SQLite doesn't). Adding a SQLite row for each transient view creates state that can diverge from Kinetica reality.

**Do this instead:** Zero SQLite state for transient views. View name derivation is server-side code, not data.

### Anti-Pattern 3: Materializing in Multiple Components for the Same Table

**What people do:** Both `AggregatedWidgetRenderer` AND `MapChartRenderer` independently call `materializeFilter` when `filterVersion` changes, resulting in redundant DDL calls (2N calls for N widgets + N map layers showing the same table).

**Why it's wrong:** Redundant DDL is wasteful and creates a race between two concurrent `CREATE OR REPLACE` calls that could result in intermediate states visible to queries.

**Do this instead:** Only `AggregatedWidgetRenderer` triggers materialization. `MapChartRenderer` is a pure consumer of `useFilterViewStore`. Since `CREATE OR REPLACE` is idempotent, the first call wins and subsequent calls are no-ops, but the cleaner design avoids them entirely.

### Anti-Pattern 4: WHERE Injection as Fallback

**What people do:** When the materialize call fails (network error, DDL permission denied), fall back to `injectWhereClause` as a client-side filter path.

**Why it's wrong:** v1.3's architectural goal is to eliminate the WHERE-injection path entirely. Keeping it as a fallback means both paths must be maintained, tested, and kept in sync. The fallback also doesn't work for map tiles (no WHERE injection available for WMS).

**Do this instead:** On materialize failure, show a toast ("Could not apply filter — check Kinetica permissions"), leave the dashboard in an unfiltered state, and let the user retry. The `KineticaPermissionError → 403` path already surfaces a clear message.

---

## Integration Points Summary Table

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `useFilterStore.filterVersion` → `AggregatedWidgetRenderer` | Zustand subscription (existing) | Unchanged; Effect dep array stays `[sql, filterVersion]` |
| `AggregatedWidgetRenderer` → `/api/filter/materialize` | `materializeFilter()` client fn (new) | Debounced 300ms; abortable via AbortSignal |
| `/api/filter/materialize` → `kineticaSql()` | Direct call with `op: "MATERIALIZE"` (existing helper) | No changes to `kinetica.ts` |
| `/api/filter/materialize` → `decodeAndVerifyJwt()` | Decode sid from JWT cookie for sessionShort | Existing function; no changes |
| `materializeFilter()` response → `useFilterViewStore` | `setView(tableId, viewName, expiresAt)` | New store action |
| `useFilterViewStore.views[tableId]` → `AggregatedWidgetRenderer` SQL | `sql.replace(FROM_PATTERN, viewName)` | Replaces `injectWhereClause` |
| `useFilterViewStore.views[tableId]` → `MapChartRenderer` Effect 3 | `source.updateParams({ LAYERS: viewName ?? tableRef })` | Replaces `updateParams({ QUERY, _v })` |
| `clearFilters(tableId)` → `dropFilterView()` → `useFilterViewStore.clearView` | Sequential: store action → client fn → store mutation | Called from same debounce effect |
| `App.tsx` logout → both stores | `useFilterStore.reset()` + `useFilterViewStore.resetAll()` | Two-store reset; existing pattern extended |
| `DashboardsPage` switch → both stores | Same as logout handler | Two-store reset |

---

## Sources

- Codebase: `kinetica_bi/server/src/index.ts` — route mounting order, `asyncHandler` pattern, `requireAuth`/`requireConfig` middleware, existing materialize endpoint at line 613 (id-based, persisted — NOT what v1.3 uses)
- Codebase: `kinetica_bi/server/src/kinetica.ts` — `kineticaSql` helper, `KineticaOp` enum (MATERIALIZE already defined), `classifyHttpError` error taxonomy
- Codebase: `kinetica_bi/server/src/db.ts` — SQLite schema (no new tables needed); `dashboard_table_views` table documented as distinct from v1.3 transient views
- Codebase: `kinetica_bi/src/store/filterStore.ts` — `FilterState` shape, `filterVersion` counter, dead code targets identified
- Codebase: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect 3 at line 404–423 (exact code to replace); Effect 2 at line 286–397 (unchanged); `includedLayers` + `imageSourcesRef` patterns
- Codebase: `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer` filter effect at line 224–253; `RecordsTableRenderer` at line 852–1068 (separate filter subscription pattern)
- Codebase: `kinetica_bi/src/lib/wmsUrlBuilder.ts` — `buildWmsParams` signature, `FILTER_PARAM = "QUERY"` at line 100, `_v` cache-buster at line 134
- Codebase: `kinetica_bi/src/api/client.ts` — `apiFetch` + `throwForStatus` pattern, `runSql` with AbortSignal, existing `materializeView` function (id-based, persisted — NOT the v1.3 pattern)
- `.planning/research/STACK.md` — Kinetica DDL syntax, TTL semantics (sliding), `DROP TABLE IF EXISTS` for view cleanup, spike requirements S1–S4

---
*Architecture research for: Kinetica BI v1.3 Unified Dashboard Filtering*
*Researched: 2026-05-06*
