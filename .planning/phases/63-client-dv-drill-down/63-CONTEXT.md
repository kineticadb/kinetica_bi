# Phase 63: Client — DV Drill-Down - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Source:** v1.12 bug diagnosis (this session) + client filter-pipeline trace. Consumes the Phase 62 server contract (the `dynamicViewId` body field on `POST/DELETE /api/filter/materialize`).

<domain>
## Phase Boundary

**Delivers (the user-visible fix):** Clicking a drill-eligible element on a **dynamic-view-backed** widget (pie/bar/line/scatter/table/records) filters THAT dynamic view's data LIVE — the clicked widget + every other widget bound to the SAME dv update; source-table widgets and other dvs are untouched. Removable chip; clear reverts to the unfiltered dv; resets on dashboard-switch/logout.

**FRONTEND-ONLY** (`packages/web`). The server piece (materialize `FROM <dv_view>`) shipped in Phase 62. ZERO changes under `packages/server` (assert empty server diff). Covers DVDRILL-V112-01, -02, -04, -05 + the CLIENT side of -03.

**Out of scope:** the server route (done, Phase 62); spatial filtering of a dv map layer (DVX-V2-01); cross-scope propagation to source-table/other-dv widgets (locked OUT); the verification walk (Phase 64).
</domain>

<decisions>
## Implementation Decisions (LOCKED / recommended)

### Filter-store keying — dv-scoped SLICE (recommended; avoids collision, keeps table path byte-unchanged)
- LOCKED constraint: a dynamic-view id and a table id are BOTH numbers — `filters[dvId]` would collide with `filters[tableId]`. Do NOT reuse the table-keyed maps for dv filters.
- RECOMMENDED: add PARALLEL dv-keyed slices rather than re-keying everything:
  - `useFilterStore` (store/filterStore.ts) gains `dvFilters: Record<number, ActiveFilter[]>` (keyed by dynamicViewId) + `addDvFilter/removeDvFilter/clearDvFilters` mirroring the table-keyed ones. The existing `filters: Record<number, ActiveFilter[]>` + addFilter/removeFilter/clearFilters stay BYTE-UNCHANGED.
  - `useFilterViewStore` (store/filterViewStore.ts) gains `dvViews: Record<number, FilterViewEntry>` (keyed by dynamicViewId) + `setDvView/markDvMaterializing/clearDvView` mirroring setView/markMaterializing/clearView. Existing `views` untouched.
- LOCKED: `reset()` on BOTH stores must zero the new dv slices too (App.tsx ~89-90 + DashboardsPage.tsx ~479-480 already call `useFilterStore.getState().reset()` + `useFilterViewStore.getState().reset()` on logout/dashboard-switch — extend the existing reset() implementations so the dv slices clear for free; NO new reset call sites needed). This satisfies DVDRILL-V112-05 lifecycle.
- (Alternative considered: a composite string key `t<id>`/`dv<id>` re-keying `Record<number>`→`Record<string>`. Rejected for v1.12 — it touches every `filters[tableId]` caller and risks the table path. The parallel-slice approach is lower-risk. Planner may revisit if cleaner.)

### Drill dispatch (route to the dv)
- LOCKED: `dispatchDrillDown` (components/charts/WidgetRenderer.tsx ~103-135; called at ~899/1016/1125/1208/1338 for the chart renderers + 1971) currently keys by `tableId`. When the widget has `dynamicViewId` (already read at WidgetRenderer ~328), route to the dv: `addDvFilter(dynamicViewId, …)` + `markDvMaterializing(dynamicViewId, …)` instead of `addFilter(tableId, …)`. Each per-chart drill handler must pass the widget's `dynamicViewId` (or call a dv-aware dispatch). Table-backed widgets (no dynamicViewId) take the EXISTING path unchanged.
- LOCKED: the clicked column is a DV column (the dv projects its own columns — a dv can rename/aggregate). The drill column for a dv widget is `drillDownColumn` from the widget config as today; it references the dv's projected column. No source-table column mapping.

### Materialize trigger + dv read-path swap
- LOCKED: Today the dv-bound widget's per-renderer Effect 1 (WidgetRenderer ~535-604) SKIPS the filter-materialize when `dynamicViewId !== undefined` and reads the RAW dv view (`s.views[dynamicViewId]` via dynamicViewStore at ~374/1526; viewName resolved at ~705). Change: when `dynamicViewId` is set AND `dvFilters[dynamicViewId]` is non-empty → the widget materializes the dv-filter: `materializeFilter({ dashboardId, dynamicViewId, filters: dvFilters })` (the Phase 62 server path) → `setDvView(dynamicViewId, result, dashboardId)`. When `dvFilters[dynamicViewId]` is empty → `clearDvView` + `dropFilterView({ dashboardId, dynamicViewId })`.
- LOCKED: dv read-path PRECEDENCE = filtered-dv view (`dvViews[dynamicViewId].viewName`) → raw dv materialized view → (existing pending/over-threshold/empty UX). The widget's data query FROM-swaps to the dv-filter view when active. Over-threshold / not-yet-materialized dv states preserve the EXISTING empty/pending behavior (no crash) — and a dv that isn't materialized should not attempt a dv-filter (gate on dvStatus, mirroring the existing `dvStatus === "pending"` early-return at ~535).
- LOCKED: the dv-bound widget remains the materialize trigger for ITS dv (sole-materialize-trigger invariant preserved — no NEW component starts calling materialize; the existing per-renderer Effect 1 just gains the dv-filter branch). Stays decoupled from the v1.11 action engine.

### Client API
- LOCKED: extend `MaterializeFilterArgs` (api/client.ts ~690) with optional `dynamicViewId?: number`; `materializeFilter` (~728) passes it in the POST body (the Phase 62 server reads it). The request cache key (currently `${dashboardId}:${tableId}`) must incorporate `dynamicViewId` so a dv-filter call doesn't collapse with a table call on the same ids. `dropFilterView` (DELETE) gains the dv variant (`?dashboardId=&dynamicViewId=`).

### Chips (DVDRILL-V112-05)
- LOCKED: the filter chip bar (rendered in components/DashboardsPage.tsx — same bar as the table-filter + spatial chips) shows dv-filter chips for `dvFilters`, labeled by the dynamic-view NAME (from dynamicViewStore / the dashboard's dv list) + the clicked value; removing a chip calls `removeDvFilter(dynamicViewId, column)` → the dv widgets revert (re-materialize or clear). Keep table-filter + spatial chips unchanged.

### Invariants
- Table-backed drill-down path BYTE-UNCHANGED (regression-test it). dv-isolated scope (same-dv widgets only; source-table + other-dv untouched — test it). Frontend vitest 100% from `packages/web`; web tsc clean. ZERO `packages/server` diff (server done Phase 62). The dv drill must NOT bump the source table's `filters[tableId]` (the bug was exactly that).
</decisions>

<canonical_refs>
## Canonical References (read before planning/implementing — under packages/web/src)

- `store/filterStore.ts` — `filters: Record<number, ActiveFilter[]>` + addFilter/removeFilter/clearFilters/reset (~42-150). ADD the dv slice + actions; extend reset.
- `store/filterViewStore.ts` — `views: Record<number, FilterViewEntry>` + setView/markMaterializing/clearView/reset (~39-75). ADD dvViews + actions; extend reset.
- `store/dynamicViewStore.ts` — the raw dv view + status the dv-bound widget reads today (dvStatus/viewName).
- `components/charts/WidgetRenderer.tsx` — `dispatchDrillDown` (~103-135); widget config reads `tableId`/`dynamicViewId`/`drillDownColumn` (~323-333); the dv-bound read selectors (~374, 1526) + viewName resolution (~705); per-renderer Effect 1 materialize trigger (table path ~435-490; the dv-gating skip ~535-604); per-chart drill handlers calling dispatchDrillDown (~899/1016/1125/1208/1338/1971).
- `api/client.ts` — `MaterializeFilterArgs` (~690), `materializeFilter` (~728, cache key ~31), `dropFilterView` (DELETE). ADD `dynamicViewId`.
- `components/DashboardsPage.tsx` — the filter chip bar (renders filters[tableId] + spatial chips) + the lifecycle reset chain (~479-487).
- `App.tsx` — the unauthenticated reset chain (~89-115).
- Tests: `store/filterStore.spec.ts`, `store/filterViewStore.spec.ts`, `components/charts/WidgetRenderer.spec.tsx`, `api/client.spec.ts`, the DashboardsPage chip tests. Mirror existing dv-aware test patterns (the dv-bound read-path tests already exist for v1.6).
</canonical_refs>

<specifics>
## Specific Ideas
- THE key regression/isolation test: drill a dv-backed widget → `dvFilters[dvId]` gets the filter AND `filters[sourceTableId]` stays EMPTY (the original bug: the filter must NOT land on the source table). Plus: a source-table widget on the same source is NOT filtered by a dv drill, and vice-versa.
- materializeFilter cache-key test: a dv call `{dashboardId, dynamicViewId}` doesn't collapse with a table call `{dashboardId, tableId}` on the same numeric ids.
- dv read-path test: with a dv-filter active, the widget FROM-swaps to `dvViews[dvId].viewName`; cleared → raw dv view.
- Lifecycle test: reset() zeroes dvFilters + dvViews.
- Gate: `cd packages/web && npx vitest run` (100% green, run FROM packages/web — cwd pitfall); `npx tsc --noEmit -p tsconfig.json` exit 0; `git diff --name-only -- packages/server` EMPTY.
</specifics>

<deferred>
## Deferred Ideas
- Composite-string re-keying of the filter stores (vs the parallel dv slice) — only if the slice approach proves messy.
- Spatial filtering of dv map layers — DVX-V2-01.
- The live operator verification — Phase 64.
</deferred>

---

*Phase: 63-client-dv-drill-down*
*Context gathered: 2026-06-15*
