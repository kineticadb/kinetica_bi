# Phase 33: dynamic-view-store - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship `useDynamicViewStore` — a frontend Zustand slice (per-dynamic_view_id session-only) that holds the dashboard's current dynamic-view materialization state, plus six pure client API helpers in `client.ts`, plus its lifecycle reset wiring (6th position in canonical block) at `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen cleanup.

Phase 33 ALSO ships **one server-side addition**: a new `POST /api/dynamic-view/:id/drop` endpoint (DROP-only, leaves SQLite row intact) used exclusively by the reset() DROP loop. The existing destructive `DELETE /api/dynamic-view/:id` stays untouched — it's the operator's explicit "delete this saved config" primitive, NOT a lifecycle cleanup primitive.

**Ships dormant for feature** (no UI / no widget consumer this phase — Phase 34 management modal is first writer at create/edit/preview; Phase 35 renderer is first reader at FROM-swap time), **but reset-active** (success criterion 3 demands the 6-store reset block work end-to-end this phase).

In scope:
- Store file + spec at `kinetica_bi/src/store/dynamicViewStore.ts`
- Client helpers in `kinetica_bi/src/api/client.ts` (6 helpers, all AbortSignal-threaded)
- Frontend pure helper `kinetica_bi/src/lib/dynamicViewName.ts` (byte-parity with server `lib/dynamicViewName.ts`)
- Server endpoint `POST /api/dynamic-view/:id/drop` + supertest both auth modes
- DROP loop wiring + 6th-position `reset()` call at App.tsx + DashboardsPage.tsx, with extended spec assertions

Out of scope (deferred to later phases):
- Management modal (create/edit/preview/delete UI) → Phase 34
- ChartConfigPanel Data Source picker + renderer FROM/LAYERS-swap → Phase 35
- Cascading re-materialize on filter-view bump → Phase 35
- Over-threshold empty state UI → Phase 35
- E2E verification → Phase 36

</domain>

<decisions>
## Implementation Decisions

### Store shape (locked by ROADMAP success criterion 1 + extended this phase)

State:
```ts
{
  views: Record<dynamic_view_id, {
    viewName: string;                                           // pre-computed client-side (see Naming below)
    status: "materialized" | "over_threshold" | "pending" | "error";
    expiresAt?: number;                                         // ONLY present when status === "materialized"
    error?: string;                                             // present when status === "error"
    reason?: "no_filter" | "exceeds_max_records";               // present when status === "over_threshold" (byte-parity with server wire)
  }>;
  dynamicViewVersion: number;
}
```

Status union is locked to exactly the four ROADMAP values. No "stale" — TTL-expired entries are derived client-side from `expiresAt + Date.now()` by Phase 35 renderers, not stored.

### Action contract (5 actions per ROADMAP)

1. **`setView(id: number, payload: { viewName: string; status: Status; expiresAt?: number; error?: string; reason?: Reason }): void`** — REPLACE semantics. Caller passes a full payload; store writes the entry verbatim. ALWAYS bumps `dynamicViewVersion` (even on byte-identical payload — mirrors filterViewStore.setView).

2. **`markPending(id: number, viewName: string): void`** — Placeholder write before `materializeDynamicView` call. Caller (Phase 35 renderer) computes `viewName` via `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`. If entry exists: overwrite status to `"pending"`, strip `expiresAt`/`error`/`reason`, keep `viewName` unchanged. If entry absent: create placeholder `{ viewName, status: "pending" }`. ALWAYS bumps `dynamicViewVersion`.

3. **`setError(id: number, error: string): void`** — Error transition. Preserves prior `viewName` (append-fail UX lock — Phase 35 renderer can retry without re-fetching name). Sets `status: "error"`, populates `error`, strips `expiresAt` and `reason`. If entry absent: creates placeholder `{ viewName: "", status: "error", error }` — caller should always have called markPending first, but defensive placeholder prevents crash. ALWAYS bumps `dynamicViewVersion` (including `setError(id, message)` over a current-null-error entry — locked: always bump on error transitions).

4. **`clearView(id: number): void`** — DELETE-KEY semantics. Removes the per-id entry. NO-OP when entry absent (reference-stable state, no version bump) — locked to mirror spatialFilterStore.removeShape(non-existent) + filterViewStore.clearView patterns. Bumps `dynamicViewVersion` on successful removal.

5. **`reset(): void`** — Internal-only lifecycle wipe. Hard-set to `{ views: {}, dynamicViewVersion: 0 }`. NOT a mutation signal — version goes to 0, not increment. Called from App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup AFTER the snapshot-DROP loop completes (see Lifecycle wiring below).

### `dynamicViewVersion` semantics

Increments by 1 on every successful mutation:
- `setView` — always +1 (even if payload deep-equals current entry — treat as fresh write, e.g., second-tick TTL refresh)
- `markPending` — always +1 (even when entry was already pending — overlapping triggers signal abort+retry cycle; Phase 35 renderer dedupes via AbortController)
- `setError(id, message)` — always +1 (state transition signal, including when error was already populated)
- `clearView(existing id)` — +1
- `clearView(non-existent id)` — NO-OP (no version bump, no state change, reference-preserved)

`reset()` hard-sets to 0 — NOT an increment. Mirrors spatialFilterStore.reset() pattern verbatim.

### Initial state

```ts
{ views: {}, dynamicViewVersion: 0 }
```

### viewName resolution (pre-computed client-side, deterministic)

- New pure helper: `kinetica_bi/src/lib/dynamicViewName.ts` exports `buildDynamicViewName({ userId: string, dashboardId: number, dynamicViewId: number }): string` returning `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>`. Byte-parity with server `kinetica_bi/server/src/lib/dynamicViewName.ts`.
- `userId` is the Kinetica username from `useAuthStore.getState().user?.username` (Phase 35 callsite — NOT this phase's concern).
- Phase 35 renderers will pass it forward via `markPending(id, viewName)` and the materialize response will echo the same name. Two paths produce the same string by construction.
- Re-materialize cycles (filter-view bump → renderer re-fires markPending → materialize → setView) keep the SAME viewName (deterministic name, no hash-salt, no version suffix). Server `CREATE OR REPLACE MATERIALIZED VIEW` reuses the name; the `_mv` cache-buster on WMS callers (Phase 35) handles tile invalidation orthogonally.
- For pending/over_threshold/error entries, viewName is the cached deterministic name (valid for retry / cleanup), NOT empty string and NOT null. Type stays `viewName: string` per ROADMAP.

### Client helpers (6 helpers, all `AbortSignal?`-threaded per V13-P-10)

All live in `kinetica_bi/src/api/client.ts`. Pure pass-through — NONE import the store; caller (Phase 34 modal, Phase 35 renderer) owns store side-effects.

1. **`listDynamicViews(dashboardId: number, signal?: AbortSignal): Promise<{ dynamic_views: DynamicViewRow[] }>`** — `GET /api/dashboards/:dashboardId/dynamic-views`. Returns full server row shape including `columns_json`. Phase 34 modal consumer.

2. **`createDynamicView(dashboardId: number, body: { source_table_id, name, template_sql, max_records }, signal?: AbortSignal): Promise<{ dynamic_view: DynamicViewRow }>`** — `POST /api/dashboards/:dashboardId/dynamic-views`. Server validates `{view}` token presence and returns 400 on missing. 201 success.

3. **`updateDynamicView(id: number, body: Partial<{ source_table_id, name, template_sql, max_records, columns_json }>, signal?: AbortSignal): Promise<{ dynamic_view: DynamicViewRow }>`** — `PUT /api/dynamic-views/:id`. Server clears `columns_json` automatically when `template_sql` changes unless explicitly co-supplied (CONTEXT 32 § D3).

4. **`deleteDynamicView(id: number, signal?: AbortSignal): Promise<{ deleted: true }>`** — `DELETE /api/dynamic-view/:id`. **Destructive** — drops Kinetica view AND removes SQLite row. Phase 34 modal "Delete" button is the only authorized caller; never called from reset() path.

5. **`previewDynamicView(body: { template_sql, source_table_id, dashboard_id, sample_limit? }, signal?: AbortSignal): Promise<{ rows: unknown[][]; columns: { name: string; type: string }[] }>`** — `POST /api/dynamic-view/preview`. Server probes for active filter view; falls back to bare-table substitution if absent. Phase 34 Preview button.

6. **`materializeDynamicView(dynamicViewId: number, signal?: AbortSignal): Promise<MaterializeDynamicViewResponse>`** — `POST /api/dynamic-view/materialize`. Response is a discriminated union by `status`:
   - `{ status: "materialized", view_name: string, row_count: number, expires_at: number }`
   - `{ status: "over_threshold", reason: "no_filter" }`
   - `{ status: "over_threshold", reason: "exceeds_max_records", row_count: number }`

   AbortError propagates natively (helper does NOT swallow). 4xx/5xx route through `throwForStatus` (consistent with materializeFilter / infoQuery).

7. **`dropDynamicView(id: number, signal?: AbortSignal): Promise<{ dropped: true }>`** — NEW endpoint. `POST /api/dynamic-view/:id/drop`. Server-side: `DROP TABLE IF EXISTS <dynamic_view_name>` only — SQLite row UNTOUCHED. This is the lifecycle-cleanup primitive used by the reset() DROP loop. Fire-and-forget: caller `.catch(()=>{})` swallows errors (user is logging out — V13-P-12 carry-forward).

**TypeScript types in `client.ts` mirror server response shapes byte-for-byte** (Plan 32 established this pattern: see `kinetica_bi/server/src/db/dashboardDynamicViews.ts` for `DynamicViewRow`).

### NEW server endpoint: `POST /api/dynamic-view/:id/drop`

Behavior:
1. Load row from `dashboard_dynamic_views` by `:id`. If absent → 404 `{ error: "Dynamic view not found." }`.
2. Compute `dynamicViewName` via `buildDynamicViewName({ userId: authedReq.user!.creds.username, dashboardId: row.dashboard_id, dynamicViewId: row.id })` — same code path the materialize endpoint uses (index.ts:1132-1136).
3. `await kineticaSqlHelper(authedReq, \`DROP TABLE IF EXISTS ${dynamicViewName}\`, { route: "POST /api/dynamic-view/:id/drop", op: "DYNAMIC_DROP" })`.
4. Respond `200 { dropped: true }`.

Idempotent (DROP IF EXISTS is silent on missing views). No row mutation. Errors propagate through global errorMiddleware as standard upstream/permission errors.

Tests (supertest):
- `routes.dynamic-view-drop.spec.ts` — happy path 200; missing-id 404; both `AUTH_MODE=password` AND `AUTH_MODE=oidc` blocks (mirrors `routes.dynamic-view.spec.ts` shape).
- Existing `routes.dynamic-view.spec.ts` (DELETE) unchanged — separate primitive.

### Lifecycle reset wiring (6th store)

Reset block grows from 5 stores → 6 stores. Canonical order (locked by ROADMAP success criterion 3):

```
filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore
```

Sites (both already established at 5 stores):
1. `kinetica_bi/src/App.tsx` UNAUTHORIZED handler (currently lines 65-93 — adds 6th call after spatialFilterStore.reset() at line 92).
2. `kinetica_bi/src/components/DashboardsPage.tsx` DashboardOpen cleanup (currently lines 393-415 — adds 6th call after spatialFilterStore.reset() at line 414).

**DROP loop wiring (this phase, callsite-resident — NOT inside store):**

Both sites snapshot materialized entries BEFORE calling `dynamicViewStore.reset()`, mirroring the filterViewStore DROP loop pattern (App.tsx lines 68-78):

```ts
// Phase 33 DV-V16-07: snapshot materialized entries BEFORE reset so the loop can read entry IDs.
const views = useDynamicViewStore.getState().views;
for (const idStr of Object.keys(views)) {
  const id = Number(idStr);
  if (views[id]?.status === "materialized") {
    // Fire-and-forget — errors swallowed (V13-P-12: user is leaving session, nothing to surface).
    dropDynamicView(id).catch(() => {});
  }
}
useDynamicViewStore.getState().reset();
```

- Loop snapshots before reset (store would be empty if iterated after).
- Only `status === "materialized"` entries fire DROP (pending/error/over_threshold have no live Kinetica view).
- `.catch(()=>{})` — never blocks logout / dashboard switch.
- No `await` — fire-and-forget. Network latency must not slow lifecycle transition.

### Test coverage (locked by ROADMAP success criterion 4)

Sibling spec at `kinetica_bi/src/store/dynamicViewStore.spec.ts`. Must cover:

**Store actions:**
- `setView` happy path — writes entry verbatim, bumps version.
- `setView` byte-identical payload — still bumps version (locked rule).
- `markPending` on absent entry — creates placeholder `{ viewName, status: "pending" }`, bumps version.
- `markPending` on existing entry — overwrites status, strips expiresAt/error/reason, keeps viewName, bumps version.
- `markPending` over pending entry — still bumps (locked rule).
- `setError` preserves prior viewName, strips expiresAt/reason, populates error, bumps version.
- `setError(id, null)` over already-null error — still bumps (locked rule). (If signature doesn't accept null, omit this case; final signature is `setError(id, error: string)` — see below.)
- `clearView` on existing — removes key, bumps version.
- `clearView` on non-existent — strict no-op, no version bump, state reference preserved (assertable via `===`).
- Version monotonicity — chain of 5 mutations produces version `5`.
- `reset()` zeroes views={} AND dynamicViewVersion=0.
- Reference stability — mutation to entry A leaves entry B's object identity intact (PITFALL C-02 / S-02 carry-forward).

**Empty-state reads (success criterion 4):**
- Reading `state.views[unknownId]` returns `undefined` cleanly.
- Empty initial state passes deep-equal check against `{ views: {}, dynamicViewVersion: 0 }`.

**Error-state rendering (success criterion 4):**
- After `markPending → setError`, entry shape is `{ viewName, status: "error", error: msg }` with no expiresAt/reason fields.

**`viewName` deterministic helper:**
- `kinetica_bi/src/lib/dynamicViewName.spec.ts` — round-trip identity with server `buildDynamicViewName` (use the same input/output pairs from `kinetica_bi/server/src/lib/dynamicViewName.spec.ts` if it exists, else generate).

**Lifecycle integration (sites: App.spec.tsx + DashboardsPage.spec.tsx — existing specs extended):**
- All 6 stores' `reset()` called in canonical order on UNAUTHORIZED + DashboardOpen cleanup.
- DROP loop called for each materialized entry with mock `dropDynamicView`.
- DROP loop NOT called for pending/over_threshold/error entries.
- Reset happens AFTER the loop snapshot.

**Client helpers (`client.spec.ts` extended):**
- Each of the 7 helpers (listDynamicViews, createDynamicView, updateDynamicView, deleteDynamicView, previewDynamicView, materializeDynamicView, dropDynamicView) — happy path + error path + AbortSignal threading verification.

**Server endpoint (`routes.dynamic-view-drop.spec.ts` new file):**
- Happy path 200, missing-id 404, both auth modes (password + oidc) — mirrors existing `routes.dynamic-view.spec.ts` shape.

### Final action signature decisions (Claude's discretion within locked semantics)

- `setError(id: number, error: string): void` — `error` is `string` (NOT `string | null`). To clear an error, caller uses `clearView(id)` or `markPending(id, viewName)` or `setView(id, payload)`. Simpler contract; mirrors no-clear-via-set patterns in filterViewStore.
- `setView` payload is a single object arg (matches infoSelectionStore convention).
- `markPending` takes positional `(id, viewName)` — only 2 args, positional is idiomatic.
- All actions return `void` (no chaining).

### Claude's Discretion

- Internal placeholder shape for `setError` on absent entry: `{ viewName: "", status: "error", error }`. Defensive fallback; Phase 35 should never trigger this path.
- Exported type names: `DynamicViewStatus`, `DynamicViewReason`, `DynamicViewEntry` — match infoSelectionStore convention (`InfoSelectionEntry`).
- Spec organization (single describe block vs. grouped per-action) — follow `spatialFilterStore.spec.ts` style.
- `routes.dynamic-view-drop.spec.ts` — co-locate with `routes.dynamic-view.spec.ts` or split into own file (recommend split — separate concerns, separate failures).
- Whether `dropDynamicView` AbortSignal threading is meaningful (fire-and-forget callsite doesn't pass one; but signature stays consistent with other helpers).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 33: dynamic-view-store" — Goal, depends-on Phase 32, 4 success criteria with full state shape + action list.
- `.planning/REQUIREMENTS.md` §"Frontend store (Phase 33)" — DV-V16-06 (Zustand slice) + DV-V16-07 (client helpers + lifecycle reset).
- `.planning/REQUIREMENTS.md` §"Locked Decisions" — Template token, no-filter behavior, columns persistence, scoping.
- `.planning/PROJECT.md` §"Current Milestone: v1.6 Dynamic Views" — milestone-level intent + Phase 32 close-out notes.

### Phase 32 server foundation (the contract this store wraps)
- `.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md` — D1 token substitution, D2 no-filter → over_threshold, D3 columns persistence, D5 TM/SMc:1078 retry, D6 TTL=5, D7 naming `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>`.
- `kinetica_bi/server/src/index.ts:842-1240` — All 6 existing endpoints (GET list, POST create, PUT update, DELETE destroy, POST preview, POST materialize). NEW `POST /api/dynamic-view/:id/drop` registers in the same region; mirror the existing pattern (asyncHandler + requireConfig + kineticaSqlHelper + global errorMiddleware).
- `kinetica_bi/server/src/lib/dynamicViewName.ts` — `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`. NEW frontend `kinetica_bi/src/lib/dynamicViewName.ts` must byte-parity this — copy the function body verbatim if it's pure (it is).
- `kinetica_bi/server/src/db/dashboardDynamicViews.ts` — `DynamicViewRow` shape; frontend client.ts types mirror this.
- `kinetica_bi/server/tests/routes.dynamic-view.spec.ts` — supertest harness pattern; new `routes.dynamic-view-drop.spec.ts` follows the same shape (both auth modes via `describe.each`).

### Established Zustand store patterns (mirror these)
- `kinetica_bi/src/store/filterViewStore.ts` — Primary template. Reference-stable per-key updates, placeholder-on-missing for `markMaterializing`, internal-only `reset()`, view-name pre-computation, expiresAt handling. Phase 33 mirrors at action-by-action level.
- `kinetica_bi/src/store/spatialFilterStore.ts` — Phase 27 reference. Version-counter no-op rules, internal-only reset, no DROP loop pattern (Phase 33 DIVERGES here — adds DROP loop in callsite).
- `kinetica_bi/src/store/infoSelectionStore.ts` — Phase 20 reference. Per-key entry shape, reference-stable mutation pattern.
- `kinetica_bi/src/store/filterStore.ts` — Original `filterVersion` counter that `dynamicViewVersion` mirrors at the dep-array-signal level.

### Lifecycle reset block (touched in this phase — currently 5 stores)
- `kinetica_bi/src/App.tsx` lines 65-93 — UNAUTHORIZED handler with filterViewStore DROP loop + 5 store resets. Phase 33 adds the dynamicViewStore DROP loop (mirroring filterViewStore lines 68-78 verbatim with status filter) + 6th reset call.
- `kinetica_bi/src/components/DashboardsPage.tsx` lines 388-415 — DashboardOpen cleanup with same 5-store reset pattern + filterViewStore DROP loop (lines 393-401). Phase 33 mirrors at lines ~414 area.

### Client helper patterns
- `kinetica_bi/src/api/client.ts:610-624` (`materializeFilter`) — Body POST, AbortSignal threading, throwForStatus error path, typed response. Primary template for materializeDynamicView.
- `kinetica_bi/src/api/client.ts:635-652` (`dropFilterView`) — DELETE with query string, AbortSignal, throwForStatus. Template for the DROP-style endpoints.
- `kinetica_bi/src/api/client.ts:687-723` area (`infoQuery`) — discriminated-union response shape (status branches). Template for materializeDynamicView's `MaterializeDynamicViewResponse` union type.

### Test infra
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand reset shim auto-applies to `src/store/*.ts`. NEW store MUST live under `src/store/` (NOT `src/state/`).
- `kinetica_bi/src/store/spatialFilterStore.spec.ts` — Closest spec style for stores with several mutations + no-op rules. Phase 33 mirrors structure.
- `kinetica_bi/src/store/filterViewStore.spec.ts` — Spec style for stores with placeholder-on-missing pattern (markPending mirrors markMaterializing).
- `kinetica_bi/src/App.spec.tsx` + `kinetica_bi/src/components/DashboardsPage.spec.tsx` — extend to assert all 6 stores reset + DROP loop fires for materialized entries.

### Downstream consumers (do NOT touch in this phase, but be aware of the contract)
- Phase 34 modal — calls `listDynamicViews` on mount, `createDynamicView` / `updateDynamicView` on Save, `previewDynamicView` on Preview, `deleteDynamicView` on Delete. Owns its own loading/error UI; does NOT write to `useDynamicViewStore` (only Phase 35 renderer writes there).
- Phase 35 `AggregatedWidgetRenderer` / `RecordsTableRenderer` / `MapChartRenderer` — read `useDynamicViewStore.views[widget.config.dynamicViewId]` for FROM/LAYERS-swap. Call `markPending → await materializeDynamicView → setView` triggered by `[dynamicViewId, filterVersion, materializeVersion]` dep array. AbortController wraps the materialize call. On filter-view version bump → re-fire markPending → re-materialize.
- Phase 35 over-threshold UX — reads `view.status === "over_threshold"` + `view.reason` for "narrow your filters" vs "no filter active" empty-state text.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`useFilterViewStore`** (`kinetica_bi/src/store/filterViewStore.ts`) — Direct template. Copy structure, rename types/actions, adapt to discriminated-union entry shape. The `markMaterializing` placeholder-on-missing pattern (lines 75-90) is the model for `markPending`. The reference-stable `setView` mutation pattern (lines 59-73) is the model for every per-id mutation.
- **`useSpatialFilterStore`** (`kinetica_bi/src/store/spatialFilterStore.ts`) — Phase 27 reference. Version-counter no-op rules (lines 98-122), reset semantics (lines 126-127), JSDoc style.
- **`useInfoSelectionStore`** (`kinetica_bi/src/store/infoSelectionStore.ts`) — Phase 20 reference. Per-key entry shape with status-like fields.
- **`materializeFilter` / `dropFilterView`** (`kinetica_bi/src/api/client.ts:610-652`) — Direct templates for materializeDynamicView / dropDynamicView client helpers.
- **`buildFilterViewName`** (`kinetica_bi/server/src/lib/filterViewName.ts`) + parallel `buildDynamicViewName` (`kinetica_bi/server/src/lib/dynamicViewName.ts`) — Server-side deterministic naming helpers. New frontend `kinetica_bi/src/lib/dynamicViewName.ts` mirrors the dynamic-view version byte-for-byte.
- **`asyncHandler` + `requireConfig` + `kineticaSqlHelper`** (`kinetica_bi/server/src/index.ts:1004-1216` area) — Server endpoint registration pattern; new `POST /api/dynamic-view/:id/drop` plugs into the same region.
- **Zustand reset shim** (`kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts`) — Auto-covers any new store under `src/store/*.ts`. No spec-side reset boilerplate needed.

### Established Patterns
- **Session-only stores have NO persistence** — locked across v1.3/v1.4/v1.5. Phase 33 follows; saved dynamic-view *configs* persist in SQLite (Phase 32), but the *materialization state* (which view ID maps to which Kinetica view name + TTL) is session-only.
- **Reset block grows as stores are added; canonical order tracked in App.tsx comments** — 5th store (Phase 27) is currently last; Phase 33 makes it 6th. The fileViewStore DROP-loop-before-reset pattern is the only divergence Phase 33 needs to mirror (with status filter).
- **Counter-style state fields use plain incrementing numbers** (`filterVersion`, `materializeVersion`, `spatialFilterVersion`, now `dynamicViewVersion`) — no overflow guard, sessions are short. `dynamicViewVersion` is the dep-array signal that Phase 35 `AggregatedWidgetRenderer` will read alongside `filterVersion` to trigger cascading re-materialize.
- **Reference-stable per-key updates**: `views: { ...state.views, [id]: nextEntry }` pattern produces new top-level object but other keys keep object identity. Selector consumers scope to `s.views[id]` (PITFALL C-02 / S-02 carry-forward).
- **Client helpers are pure pass-through**: NO helper imports the store. Callers (Phase 34 modal, Phase 35 renderer) own all store side-effects. Locked across v1.3 / v1.4 / v1.5.
- **Pure-lib mirror pattern**: When server and frontend need identical pure helpers (e.g., naming, predicate), each side gets its own `lib/X.ts` file. Established by `kinetica_bi/src/lib/mapInfoConfig.ts` (v1.4) and `kinetica_bi/src/lib/spatialTargets.ts` (v1.5).

### Integration Points
1. `kinetica_bi/src/App.tsx` UNAUTHORIZED handler (lines 65-93) — append dynamicViewStore DROP loop + 6th reset call. Imports: `useDynamicViewStore` from `./store/dynamicViewStore`, `dropDynamicView` from `./api/client`.
2. `kinetica_bi/src/components/DashboardsPage.tsx` DashboardOpen cleanup (lines 388-415) — mirror: DROP loop + 6th reset. Same imports.
3. `kinetica_bi/server/src/index.ts` — register `POST /api/dynamic-view/:id/drop` in the existing dynamic-view region (between `POST /api/dynamic-view/materialize` at line 1115 and `DELETE /api/dynamic-view/:id` at line 1219). Reuse `buildDynamicViewName` import from server lib.
4. Phase 34 / 35 (NOT THIS PHASE) — will import `useDynamicViewStore` + all 7 client helpers from their respective files.

</code_context>

<specifics>
## Specific Ideas

- **"Mirror useFilterViewStore exactly"** for the placeholder-on-missing + view-name-pre-compute + entry-shape pattern. `markPending` is to `useDynamicViewStore` what `markMaterializing` is to `useFilterViewStore`.
- **"Mirror useSpatialFilterStore"** for the no-op rules and the reset-to-zero (not reset-to-bumped) semantic.
- **The DROP-only endpoint exists because the destructive DELETE was the only existing primitive**, and firing DELETE on logout would wipe operator's saved configs — wrong UX. The new endpoint is the missing lifecycle-cleanup primitive that filterViewStore already has by accident (filter views never had a config-row equivalent — they live only as Kinetica views — so `DELETE /api/filter/materialize` IS the DROP primitive there).
- **viewName is always populated** from `markPending` forward — never empty string, never null — so the type stays `viewName: string` per ROADMAP. The deterministic helper enables this.
- **`reason` on over_threshold** is byte-parity with server wire so Phase 35 can render "Apply a filter to enable this view" (no_filter) vs "Too much data — narrow your filters" (exceeds_max_records) without an extra round-trip.

</specifics>

<deferred>
## Deferred Ideas

- **TTL-stale-then-retry recovery** — Phase 35 renderer concern. Pattern locked at v1.3 dual-path (proactive `expiresAt` check + reactive `isViewNotFoundError`) on filterViewStore; Phase 35 will mirror for dynamic views. Phase 33 just makes sure `expiresAt` is populated/stripped correctly.
- **Over-threshold UI text + iconography** — Phase 35.
- **ChartConfigPanel Data Source picker integration** — Phase 35 (`DV-V16-12`).
- **Cascading re-materialize trigger from filter-view bump** — Phase 35 (`DV-V16-13`). Phase 33 just exposes the version counter; renderer wires the dep array.
- **`columns_json` consumption** — Phase 34 modal (Save side) + Phase 35 ChartConfigPanel (read side). Phase 33 client.ts types include the field but no consumer this phase.
- **`useDynamicViewStore.views[id]` selector ergonomics in renderers** — Phase 35 concern (PITFALL C-02 / S-02 scoping). Phase 33 just guarantees reference stability.
- **URL / localStorage persistence of dynamic-view bindings** — explicitly out of scope (PERSIST-V2 territory).

</deferred>

---

*Phase: 33-dynamic-view-store*
*Context gathered: 2026-05-14*
