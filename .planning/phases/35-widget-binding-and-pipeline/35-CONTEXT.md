# Phase 35: widget-binding-and-pipeline - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire visualizations to dynamic views as their data source and ship the cascading materialize chain that re-fires the dynamic-view check whenever the source filter view re-materializes. Widgets dependent on an over-threshold dynamic view render a clear empty state without executing SQL.

In scope:
- **New dashboard-scope orchestrator hook** `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (+ spec) — subscribes to `useFilterViewStore.views[sourceTableId]?.materializeVersion` AND the list of dynamic-views for the dashboard. On materializeVersion bump for table T, iterates dynamic-views with `source_table_id === T` and fires `markPending → materializeDynamicView → setView/setError` for each. Per-dynamic-view AbortController in a `useRef<Map<dynamic_view_id, AbortController>>`. Mounted at the `DashboardOpen` level (alongside the existing filter-view materialize trigger surface).
- **ChartConfigPanel Data Source picker extension** — three optgroups (Tables / Views / Dynamic Views); selecting a dynamic-view writes `dynamicViewId: number` to `widget.config`; option label is the dynamic-view's bare name; optgroup hidden entirely when no dynamic-views exist for the dashboard.
- **AggregatedWidgetRenderer + RecordsTableRenderer integration** — both renderers detect `widget.config.dynamicViewId`, look up the resolved view name from `useDynamicViewStore.views[id]`, FROM-swap against it via the existing `fromSwap()` helper. Status-aware rendering: `undefined`/`pending` → loading skeleton; `over_threshold` → inline empty state "Too much data — narrow your filters to enable this view." (ROADMAP verbatim); `error` → inline error + Retry link; `materialized` → fromSwap fires + runSql.
- **MapChart per-layer binding** — NEW SQLite column `dashboard_layers.dynamic_view_id INTEGER` (nullable, FK to `dashboard_dynamic_views.id`). PRAGMA-guarded idempotent ALTER mirrors v1.4 Phase 19 + v1.5 Phase 19 patterns. Frontend `DashboardLayerDto` gains optional `dynamic_view_id: number | null`. PATCH route extended. LayersModal's `KineticaWmsLayerForm` gains a "Data Source" picker (per-layer; same Tables/Views/Dynamic Views structure as ChartConfigPanel).
- **`buildWmsParams` extension** — when layer has `dynamic_view_id` AND the store has a `materialized` status entry, LAYERS=<resolved_name>. When the store has `over_threshold`/`pending`/`error`/undefined, the layer is hidden from the N-layer stack and a `MapFilteringBadge`-style "Some layers over threshold" overlay surfaces in MapChartRenderer.
- **Orphan widget UX** — Renderer detects `dynamicViewId` set in config + no row in `listDynamicViews` (Phase 35 must ensure the renderer has access to the dashboard's dynamic-view list to make this determination, either via DashboardContext extension or a per-dashboard store) + no entry in store → empty state "This dynamic view was deleted. Reconfigure the widget."
- **`columns_json` consumption** — When ChartConfigPanel binds to a dynamic-view, the column-picker dropdowns (metric, group-by, drill-down) source from the dynamic-view row's `columns_json` field instead of the source table's columns.

Out of scope (deferred to later phases / TD):
- Widget creation flow for dynamic-view-bound widgets when no columns_json yet exists (operator must run Preview in DynamicViewsModal first; Phase 34 already ensures Save populates columns_json) — defensive handling only.
- Drill-down behavior on dynamic-view-bound widgets — Claude's discretion; recommend filter goes to the dynamic-view's source_table_id (which cascades through filter-view → dynamic-view re-materialize → widget refresh). Locked simple in this CONTEXT; full discussion deferred to verification UAT if surfacing issues.
- TD-V15-MAP-ONLY-TRIGGER carry-over for dynamic-views — partially solved by the new orchestrator hook (which fires on filter-view materializeVersion bump regardless of widget type), but the underlying issue (dashboards with NO aggregated widget have no filter-view materialize trigger to begin with) remains. NOT in Phase 35 scope.
- Server-side LAYERS-swap — none needed. All swaps happen client-side via `buildWmsParams` (already the established pattern).
- Cross-dashboard dynamic-view sharing — locked OUT per CONTEXT 32 §D4.
- Auto-refresh / live update — same out-of-scope as v1.6 generally.
- E2E verification → Phase 36 (VERIFY-V16-01).

</domain>

<decisions>
## Implementation Decisions

### Cascading materialize trigger architecture (FOUNDATIONAL)

**New dashboard-scope orchestrator hook `useDynamicViewMaterializeChain`:**

- File: `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` + `.spec.ts`.
- Mount site: `DashboardsPage.tsx` `DashboardOpen` body (alongside the existing widget render loop). Single instance per open dashboard.
- Inputs: `dashboardId: number`, list of dynamic-views for the dashboard (from a new `useDynamicViewsList(dashboardId)` selector hook OR via a simple `useEffect` that mounts the list via `listDynamicViews`, sets local state, and refreshes when DynamicViewsModal saves a new view — see "Dynamic-view list source" below).
- Behavior:
  1. Subscribe to `useFilterViewStore.views` with a primitive selector that yields a stable `materializeVersionByTable: Record<sourceTableId, materializeVersion>` map (or simpler: read `useFilterViewStore.views[T]?.materializeVersion ?? 0` for each unique `source_table_id` referenced by the dashboard's dynamic-views).
  2. On any source-table's materializeVersion bump, find dynamic-views with `source_table_id === T` and fire the cascade for each: `markPending(id, viewName) → materializeDynamicView(id, signal) → setView/setError`.
  3. Per-dynamic-view AbortController in a `useRef<Map<dynamic_view_id, AbortController>>`. Each cascade fire aborts the previous in-flight materialize for THAT dynamic-view (rapid filter changes don't queue stale calls). Other dynamic-views' in-flight calls are NOT aborted.
  4. On AbortError: silent.
  5. On other error: `setError(id, err.message)` + toast `"error"` kind. CRUD persistence unaffected.

**Why this design:**
- Decouples from widget renderers — solves the TD-V15-MAP-ONLY-TRIGGER carry-over for the dynamic-view materialize path. A dashboard with only map widgets bound to dynamic-views STILL fires the cascade because the orchestrator hook is mounted at DashboardOpen scope, not inside any widget.
- Mirrors v1.3 pattern where filter-view materialize fires from a single canonical site (AggregatedWidgetRenderer there; the new orchestrator here for dynamic-views).
- Pipeline order serialized implicitly via store state transitions (filter-view setView bumps `materializeVersion` → orchestrator detects → fires dynamic-view materialize → dynamic-view setView updates store → widget renderer scoped selector re-renders → fromSwap fires). No explicit chain orchestration; React effect graph carries it.

**Dynamic-view list source for orchestrator:**
- Simplest: orchestrator calls `listDynamicViews(dashboardId, signal)` on mount, stores result in local state, and refreshes whenever Phase 34's DynamicViewsModal completes a create/update/delete operation.
- Refresh trigger options (planner picks the cleanest):
  - (a) Custom event dispatched by DynamicViewsModal on successful CRUD ops (e.g., `kbi:dynamic-views-changed`) that the orchestrator hook listens for.
  - (b) Pull-on-mount + re-fetch when `useDynamicViewStore.dynamicViewVersion` increments (any store mutation = potentially-changed list).
  - (c) Lift the dynamic-view list into a Zustand slice (new `useDynamicViewListStore` — overkill for Phase 35; defer if needed).
- **Recommend (b)**: `dynamicViewVersion` is already the dep-array signal Phase 33 designed for downstream consumers. The orchestrator re-fetches `listDynamicViews` when version changes. Cleanest reuse of existing primitives. Caveat: false-positive refetches on every store mutation; acceptable given low cost of listDynamicViews (single GET).
- **Locked: option (b).** Planner verifies the dep-array correctness and adds an AbortController to the list-fetch so unmount/refresh cancels in-flight.

### Pipeline order (implicit via store transitions)

```
User drills / changes filter
  ↓
AggregatedWidgetRenderer Effect 1 (v1.3)
  ↓ materializeFilter
useFilterViewStore.setView(T, ...)  // bumps materializeVersion for table T
  ↓
useDynamicViewMaterializeChain hook detects materializeVersion bump
  ↓ for each dynamic-view with source_table_id === T:
    ↓ markPending(id, viewName)
    ↓ await materializeDynamicView(id, signal)
    ↓ setView(id, {status, ...}) or setError(id, msg)
  ↓ (each setView bumps dynamicViewVersion)
Renderer scoped selector to useDynamicViewStore.views[id] re-fires
  ↓
fromSwap(sql, viewName) re-runs
  ↓
runSql with new viewName
```

AbortController behavior on rapid filter changes:
- Filter change 1 → orchestrator fires materialize for dv-A (AbortController-1 stored in Map[dv-A]). In-flight.
- Filter change 2 (before AbortController-1 resolves) → AggregatedWidget Effect 1 aborts its prior materializeFilter, fires new one. Filter-view setView bumps materializeVersion AGAIN. Orchestrator hook detects, aborts AbortController-1, creates AbortController-2 for dv-A.
- AbortError from AbortController-1 is swallowed silently (V13-P-12 carry-forward).
- AbortController-2 materializeDynamicView completes → setView fires → renderer re-fetches.

### ChartConfigPanel "Data Source" picker UX

Current `ChartConfigPanel.tsx:70-86` builds a flat `dataSourceOptions` list with `kind: "table" | "view"`. Phase 35 extends:

1. Type union extended: `kind: "table" | "view" | "dynamic"`. New entry shape: `{ label, value, kind: "dynamic", dynamicViewId: number, sourceTableId: number, columnsJson: ParsedColumns | null }`.
2. Three `<optgroup>` blocks rendered in order: `Tables`, `Views`, `Dynamic Views`. Each optgroup is hidden when its array is empty (matches existing per-collection conditional render at line 78).
3. Dynamic-view option label is the bare `name` field (e.g., `Top vendors`). Optgroup label `Dynamic Views` provides the type context.
4. New prop on ChartConfigPanel: `dynamicViews: DynamicViewRow[] | undefined` — passed from `DashboardsPage` via the existing `tables` / `views` prop conduit. List sourced same way as the orchestrator hook (probably the same `listDynamicViews` call hoisted to DashboardOpen so both consume it).
5. **`columns_json` consumption for column pickers:** When operator selects a dynamic-view, the metric / group-by / drill-down column pickers source from the dynamic-view's `columns_json` (parsed JSON array of `{ name, type }`) instead of the source-table's `columns` map. If `columns_json` is null (Preview never ran in Phase 34), show inline hint "Run Preview in Dynamic Views to populate columns" and disable the column pickers.
6. **Widget config persistence on Save:**
   - `dynamicViewId: number` → `widget.config.dynamicViewId`
   - `tableId` is ALSO persisted as `widget.config.tableId` (the dynamic-view's source_table_id) so existing drill-down dispatch + filter-bar code paths still work without rewrites. The renderer treats `dynamicViewId` as the primary key when present.
   - `tableRef` (existing string field, schema.table) — keep populating with the source-table name for any legacy reader; renderers prefer dynamicViewId path when set.
   - **Mutual exclusion at config-pick time:** picker is single-select; choosing a table/view clears dynamicViewId; choosing a dynamic-view sets dynamicViewId + sets tableId from sourceTableId. The widget.config can never have BOTH a non-dynamic source AND a dynamicViewId.

### Renderer integration (AggregatedWidget + RecordsTable)

**`AggregatedWidgetRenderer`:**
- Read `cfg.dynamicViewId as number | undefined` near the existing `cfg.tableId` read at line 232.
- **Branch on `dynamicViewId !== undefined`:**
  - Skip the existing filter-view materialize trigger Effect 1 for this widget IF the widget is dynamic-view bound — the orchestrator hook owns the materialize chain for dv-bound widgets. (Alternative: keep the filter-view trigger to maintain filter materialization for the table; the cascade hook handles the dynamic-view layer. **Lock the alternative — Effect 1 stays unchanged**, since the filter-view still needs to materialize to provide the `{view}` substitution source for the dynamic-view; the orchestrator hook is downstream.)
  - Replace Effect 2's `viewName` source: instead of `useFilterViewStore.views[tableId]?.viewName`, read `useDynamicViewStore.views[dynamicViewId]?.viewName`.
  - Scoped selectors:
    ```typescript
    const dvEntry = useDynamicViewStore((s) => dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined);
    const dvStatus = dvEntry?.status; // "materialized" | "over_threshold" | "pending" | "error" | undefined
    const dvViewName = dvEntry?.viewName;
    const dvReason = dvEntry?.reason; // for over-threshold UX
    const dvError = dvEntry?.error;
    ```
- **Status-aware render gates BEFORE the existing fromSwap+runSql:**
  - `dvStatus === undefined || dvStatus === "pending"` → render loading skeleton (reuse existing `loading` UI path).
  - `dvStatus === "over_threshold"` → render inline empty state (see below). No runSql.
  - `dvStatus === "error"` → render inline error message with Retry link. No runSql.
  - `dvStatus === "materialized"` → fromSwap(sql, dvViewName) → runSql (existing path; viewName comes from dynamic-view store instead of filter-view store).
- **Orphan detection:** if `dynamicViewId !== undefined` AND `dvEntry === undefined` AND the dashboard's dynamic-view list (from a new selector or prop) does NOT contain `dynamicViewId` → render orphan empty state "This dynamic view was deleted. Reconfigure the widget."

**`RecordsTableRenderer`:**
- Same branching pattern as AggregatedWidget. Read `cfg.dynamicViewId`, scoped selector to `useDynamicViewStore.views[dynamicViewId]`, status-aware rendering, fromSwap on materialized.
- The widget still receives pagination params (LIMIT/OFFSET) which are applied at render time; the SQL FROM-swap target is the dynamic-view name.

### MapChart per-layer binding

**Schema migration (Plan A in execution):**
- `kinetica_bi/server/src/db/migrations.ts` (or wherever Phase 12 PRAGMA-guarded migrations live) gains a new step adding `dynamic_view_id INTEGER` column to `dashboard_layers`. NULL-default. No FK constraint enforced by SQLite (FK enabled per-connection; if it's already on, declare REFERENCES; otherwise the application code enforces).
- Idempotent: `PRAGMA table_info(dashboard_layers)` check before `ALTER TABLE ADD COLUMN`. Mirrors v1.4 Phase 19 + v1.5 Phase 19 patterns.
- Migration spec test asserts: missing column gets added; existing column not duplicated; existing rows retain NULL.

**Server CRUD extension:**
- `DashboardLayer` type extended with `dynamic_view_id: number | null`.
- `mapDashboardLayer` projection includes the field.
- `updateDashboardLayer` accepts the field.
- PATCH `/api/dashboards/:dashboardId/layers/:layerId` body schema extended to accept `dynamic_view_id`.
- Frontend `DashboardLayerDto` mirrors byte-for-byte: `dynamic_view_id?: number | null`.

**LayersModal UI:**
- `KineticaWmsLayerForm` gains a "Data Source" section (above or near the existing TABLE picker). Same three-optgroup pattern as ChartConfigPanel (Tables / Views / Dynamic Views).
- Selecting a dynamic-view writes `dynamic_view_id` to the layer's PATCH body and CLEARS `table_id` (mutual exclusion: each layer is either table-bound or dynamic-view-bound).
- Display label: bare dynamic-view name.
- When the layer is dynamic-view-bound, the existing TABLE picker is greyed out / hidden (or the section becomes a single picker labeled "Data Source" that handles all three kinds).

**LAYERS-swap mechanics (`buildWmsParams`):**

`kinetica_bi/src/lib/wmsUrlBuilder.ts` `buildWmsParams` reads each layer config and builds the WMS URL. Extension:
- Input gains a per-layer `dynamicViewEntry?: { status, viewName, dynamicViewVersion } | undefined` lookup (computed by caller from `useDynamicViewStore`).
- Precedence per layer:
  1. If layer has `dynamic_view_id` AND `dynamicViewEntry?.status === "materialized"` → `LAYERS=<dynamicViewEntry.viewName>`, `_mv=<dynamicViewVersion>`.
  2. If layer has `dynamic_view_id` AND `dynamicViewEntry?.status` is anything else (pending/over_threshold/error/undefined) → SKIP this layer from the N-layer stack (return null/undefined for this layer's URL).
  3. Else if layer has `table_id` and the source table has a filter-view (v1.3 path) → `LAYERS=<filter_view_name>`, `_mv=<materializeVersion>` (existing behavior).
  4. Else → `LAYERS=<schema.table>` (existing behavior).
- Cache-buster: dynamic-view-bound layers use `_mv=<dynamicViewVersion>`; filter-view-bound layers use `_mv=<filterViewMaterializeVersion>` (existing). Distinct counters, distinct buster sources — no collision.

**MapChartRenderer status surfacing:**
- Per-layer: when at least one bound dynamic-view is over-threshold or error, render `MapFilteringBadge`-style overlay: "Some layers over threshold" (or per-layer toast/badge — Claude's discretion within the spirit of "operator gets visual feedback without silent layer disappearance").
- The layer is omitted from the visible stack (no broken tile URLs, no failed network requests).

### Status-aware widget rendering (empty / pending / error / undefined / orphan)

**Status → render mapping (for AggregatedWidget + RecordsTable):**

| Status | Render | Notes |
|--------|--------|-------|
| `undefined` (no entry yet) | Loading skeleton | Orchestrator hook will fire markPending shortly. Identical to pending visually. |
| `pending` | Loading skeleton | Reuse v1.3 widget loading state (already in renderer). |
| `materialized` | fromSwap(sql, viewName) → runSql → render data | Existing happy path; viewName comes from dynamic-view store instead of filter-view store. |
| `over_threshold` | Inline empty state: "Too much data — narrow your filters to enable this view." + subtle icon | NO SQL executed. Reason field (`reason: "no_filter" \| "exceeds_max_records"`) is available if planner decides to differentiate copy; ROADMAP says single message, lock that. |
| `error` | Inline error: `error` string + Retry link | Retry calls `markPending(id, viewName) + materializeDynamicView(id, abortSignal)` via the same orchestrator path (or directly from the renderer — planner's call). |
| Orphan (dynamicViewId set, no row in dashboard's dynamic-view list, no store entry) | Inline empty state: "This dynamic view was deleted. Reconfigure the widget." | Operator opens ChartConfigPanel to rebind. |

**CSS:** Reuse existing widget empty-state and error-state classes if available. Add a new `.widget-over-threshold-*` class set if no existing pattern fits.

**Icon:** Font Awesome warning-triangle (`faTriangleExclamation`) for over-threshold + orphan; the existing chart-error icon for error.

### Drill-down on dynamic-view-bound widgets

Lock: drill-down click writes to `useFilterStore.filters[sourceTableId]` (the dynamic-view's source table). This naturally cascades: filterStore.addFilter → AggregatedWidget Effect 1 fires → filter-view materializes → filter-view materializeVersion bumps → orchestrator hook detects → dynamic-view re-materializes → renderer fromSwap fires with new viewName.

ChartConfigPanel persists `tableId: sourceTableId` on widget.config (alongside `dynamicViewId`) specifically so existing drill-down dispatch + filter-bar code paths work without rewrites.

### Test coverage scope

1. **Orchestrator hook spec** `useDynamicViewMaterializeChain.spec.ts`:
   - Fires materializeDynamicView for each dynamic-view with `source_table_id === T` when filter-view materializeVersion bumps for T.
   - Per-dynamic-view AbortController stored in a Map; rapid filter changes abort prior in-flight per id.
   - On AbortError: silent.
   - On other error: setError + toast.
   - Refreshes `listDynamicViews` when `dynamicViewVersion` increments.
   - Does NOT fire for dynamic-views whose source_table_id doesn't have a filter-view materialize.

2. **ChartConfigPanel.spec.tsx** extensions:
   - Dynamic Views optgroup rendered when list non-empty; hidden when empty.
   - Selecting a dynamic-view writes `dynamicViewId` + `tableId: sourceTableId` to onSave payload.
   - Column pickers source from dynamic-view's `columns_json` when bound.
   - Hint "Run Preview in Dynamic Views to populate columns" shown when columns_json is null.

3. **AggregatedWidgetRenderer.spec.tsx / WidgetRenderer.spec.tsx** extensions:
   - Bound to dynamic-view → reads from useDynamicViewStore (not useFilterViewStore for viewName).
   - status=undefined / pending → loading skeleton.
   - status=materialized → fromSwap(sql, dvViewName) + runSql.
   - status=over_threshold → empty state, no runSql.
   - status=error → error UI + Retry.
   - Orphan path: no entry, no row in list → orphan empty state.

4. **RecordsTableRenderer.spec.tsx** extensions:
   - Same status-aware rendering as AggregatedWidget.
   - Pagination still works on materialized dynamic-view.

5. **MapChartRenderer.spec.tsx** extensions:
   - Per-layer bound to dynamic-view: LAYERS=<dynamicViewName> when materialized.
   - Per-layer over-threshold: layer omitted from stack; "Some layers over threshold" overlay surfaces.

6. **LayersModal.spec.tsx + KineticaWmsLayerForm.spec.tsx** extensions:
   - "Data Source" picker shows three optgroups.
   - Selecting a dynamic-view sets `dynamic_view_id` and clears `table_id` in PATCH body.

7. **wmsUrlBuilder.spec.ts** extensions:
   - Layer with `dynamic_view_id` + materialized status → LAYERS=<dynamicViewName> + _mv=<dynamicViewVersion>.
   - Layer with `dynamic_view_id` + non-materialized → layer omitted (URL undefined/null).

8. **Server migration spec** `db.smoke.spec.ts` (or equivalent):
   - Idempotent ADD COLUMN test for `dynamic_view_id`.
   - Existing rows preserve NULL.

9. **Server route spec** `routes.layers.spec.ts` (or wherever the PATCH endpoint test lives):
   - PATCH accepts `dynamic_view_id`.
   - Both AUTH_MODE=password + AUTH_MODE=oidc.

### Claude's Discretion

- Whether ChartConfigPanel's `dynamicViews` prop is passed directly OR derived from a new `useDynamicViewsList(dashboardId)` hook reading from a Zustand slice. Recommend prop-passing if the list lives in DashboardOpen scope already (probably as state via `listDynamicViews` mount-fetch); hook if a slice is introduced.
- Whether to share a single Data Source picker component between ChartConfigPanel and KineticaWmsLayerForm OR duplicate the three-optgroup pattern. Recommend share if the JSX is non-trivial.
- Exact Retry-link implementation in error state — could call the orchestrator hook's exposed retry method, or fire markPending+materializeDynamicView directly from the renderer.
- Whether the orchestrator hook returns anything (e.g., a `retry(dynamicViewId)` function) or is fire-and-forget (subscribes via effects only).
- CSS class naming for over-threshold + orphan empty states (`.widget-over-threshold` / `.widget-orphan-dynamic-view` or reuse generic empty-state classes).
- Whether to show the dynamic-view's status badge inside the widget chrome (e.g., header) as an additional surface beyond the body empty state — out of scope for ROADMAP success criterion 4 but possibly nice-to-have for operator clarity.
- Exact orphan-detection algorithm (querying listDynamicViews on every render is wasteful; cache via state lifted to DashboardOpen).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 35: widget-binding-and-pipeline" — Goal, depends-on Phases 32+33+34, 4 success criteria.
- `.planning/REQUIREMENTS.md` §"Widget binding + pipeline integration (Phase 35)" — DV-V16-12 (ChartConfigPanel optgroup), DV-V16-13 (renderer FROM/LAYERS-swap), DV-V16-14 (over-threshold empty state).
- `.planning/REQUIREMENTS.md` §"Locked Decisions" — Template token, no-filter behavior, columns persistence, scoping.
- `.planning/PROJECT.md` §"Current Milestone: v1.6 Dynamic Views" — Milestone intent + Phase 33 + 34 close-out notes.

### Phase 33 + 34 contracts (this phase consumes)
- `.planning/phases/33-dynamic-view-store/33-CONTEXT.md` — Store actions, viewName deterministic helper, dynamicViewVersion semantics.
- `.planning/phases/34-dynamic-view-ui/34-CONTEXT.md` — Materialize-on-Save flow, columns_json populated by Preview, status union, toast taxonomy (`"info" | "error"` only).
- `kinetica_bi/src/store/dynamicViewStore.ts` — `useDynamicViewStore` with `views`, `dynamicViewVersion`, 5 actions.
- `kinetica_bi/src/lib/dynamicViewName.ts` — `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`.
- `kinetica_bi/src/api/client.ts` — 7 client helpers; `MaterializeDynamicViewResponse` 3-branch union; `DynamicViewRow` shape with `columns_json: { name: string; type: string }[] | null`.
- `kinetica_bi/src/components/DynamicViewsModal.tsx` — Modal already fires materialize on Save; Phase 35 orchestrator handles cascades.

### Phase 32 server endpoints (Phase 35 consumes)
- `.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md` — `columns_json` populated by Preview-then-Save; Kinetica round-trip for over-threshold detection.
- `kinetica_bi/server/src/index.ts:842-1240` — All 6 existing dynamic-view endpoints + the Plan 33 POST /drop endpoint. NO new server endpoints needed for Phase 35 except possibly the `dashboard_layers.dynamic_view_id` PATCH route extension.

### Renderer + materialize-trigger pattern templates (mirror these)
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:224-446` — `AggregatedWidgetRenderer` Effect 1 (sole filter-view materialize trigger, V13-P-01 lock) + Effect 2 (fromSwap + runSql + LIFE-V13-01/02 TTL recovery). Phase 35 extends both effects' dep arrays and status-aware gates.
- `kinetica_bi/src/lib/fromSwap.ts` — Pure FROM-swap helper. Phase 35 reuses unchanged; `viewName` source flips to `useDynamicViewStore.views[id].viewName` for dynamic-view-bound widgets.
- `kinetica_bi/src/store/filterViewStore.ts` — Reference for `materializeVersion` increment pattern + scoped selectors. Orchestrator subscribes to `materializeVersion` per source table.
- `kinetica_bi/src/components/charts/RecordsTableRenderer.tsx` — Pure-consumer renderer pattern (FILT-V13-04 lock); no materialize trigger of its own. Phase 35 extends with dynamic-view scoped selectors + status-aware gates.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Map renderer with N-layer ImageWMS stack (Phase 12) + LAYERS-swap (Phase 16). Phase 35 extends `buildWmsParams` callsites + per-layer status checks.
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — `buildWmsParams` pattern. Phase 35 extends precedence: dynamic-view-bound (materialized) → filter-view → bare table.

### ChartConfigPanel + LayersModal templates
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx:52-300` — Data Source picker `dataSourceOptions` builder (lines 70-86) + selected-source tracking. Phase 35 extends `kind` union + `dataSourceOptions` builder + adds `dynamicViews` prop + columns_json sourcing for column pickers.
- `kinetica_bi/src/components/LayersModal.tsx` + `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Per-layer config UI. Phase 35 extends KineticaWmsLayerForm with the "Data Source" picker (same three-optgroup pattern).
- `kinetica_bi/src/api/client.ts` — `DashboardLayerDto` shape; PATCH endpoint helper. Phase 35 extends both with `dynamic_view_id`.

### Server migration pattern
- `kinetica_bi/server/src/db/migrations.ts` (or wherever the v1.4 Phase 19 info_* columns were added) — PRAGMA-guarded idempotent ALTER pattern. Phase 35 mirrors for `dashboard_layers.dynamic_view_id`.
- Phase 32 `dashboard_dynamic_views` table — referenced by FK semantically (SQLite FK enforcement depends on PRAGMA; planner verifies).

### DashboardsPage integration site
- `kinetica_bi/src/components/DashboardsPage.tsx` — `DashboardOpen` component scope. Orchestrator hook mounts here (alongside existing widget render loop). DynamicViewsModal mount is at lines ~947+ (Phase 34).

### Toast helper
- `kinetica_bi/src/store/toast.ts` — `ToastKind = "permission" | "info" | "error"` (RESEARCH lock from Phase 34: NO `"warning"`).

### Test infra
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand reset shim. Existing stores auto-covered.
- Existing renderer specs (`AggregatedWidgetRenderer.spec.tsx` or whichever exists in the WidgetRenderer module) — extended with dynamic-view branches.
- `kinetica_bi/server/tests/routes.dynamic-view.spec.ts` — pattern for new layer-PATCH dynamic_view_id test.

### Downstream consumer (Phase 36 verifier)
- Phase 36 (VERIFY-V16-01) — Source-only attestation or live UAT.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AggregatedWidgetRenderer` Effect 1 + Effect 2** (`WidgetRenderer.tsx:224-446`) — Direct template for status-aware rendering. Status gates inserted before the fromSwap+runSql chain. Effect 1 stays unchanged (still fires filter-view materialize); Effect 2 reads from `useDynamicViewStore` instead of `useFilterViewStore` for dynamic-view-bound widgets.
- **`fromSwap(sql, viewName)`** (`kinetica_bi/src/lib/fromSwap.ts`) — Reused unchanged. Just flip the `viewName` source.
- **`buildWmsParams`** (`kinetica_bi/src/lib/wmsUrlBuilder.ts`) — Extended with dynamic-view precedence + new `_mv` source for dynamic-view-bound layers.
- **`useFilterViewStore.materializeVersion`** — Existing per-tableId counter. Phase 35 orchestrator hook subscribes to detect filter-view re-materialize bumps that should trigger dynamic-view cascade.
- **`useDynamicViewStore` (Phase 33)** — 5 actions (setView/markPending/setError/clearView/reset) + scoped per-id selectors. Phase 35 consumes heavily.
- **`buildDynamicViewName` (Phase 33)** — Deterministic frontend helper for computing the expected view name. Orchestrator hook uses it to populate markPending.
- **`MaterializeDynamicViewResponse` 3-branch union (Phase 33)** — Discriminated by `status`. Orchestrator handles each branch.
- **Phase 34 DynamicViewsModal** — Already fires materialize on Save (operator gets in-modal feedback). Phase 35 orchestrator handles the CASCADE re-materialize (different trigger source: filter-view materializeVersion bumps, not modal save). Both paths converge on the same store state.
- **ChartConfigPanel `dataSourceOptions` builder** (`ChartConfigPanel.tsx:70-86`) — Direct template for the three-optgroup picker extension.
- **`KineticaWmsLayerForm`** (`kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`) — Per-layer config form. Phase 35 adds "Data Source" section here.
- **PRAGMA-guarded idempotent ALTER pattern** (v1.4 Phase 19 + v1.5 Phase 19) — Template for adding `dashboard_layers.dynamic_view_id`.

### Established Patterns
- **Single canonical materialize-trigger site** (V13-P-01) — Phase 35 mirrors with `useDynamicViewMaterializeChain` hook for the dynamic-view materialize path.
- **AbortController per long-running operation** (V13-P-10) — Phase 35 uses a Map<id, AbortController> in the orchestrator hook.
- **Scoped Zustand selectors** (PITFALL C-02 / S-02) — Phase 35 renderers subscribe to `useDynamicViewStore.views[id]?.X` per dynamic-view ID, NOT the whole views map.
- **Primitive deps in useEffect arrays** (PITFALL S-02) — `dynamicViewVersion` is the primitive Phase 35 renderers use as the dep-array trigger.
- **`_mv` cache-buster for WMS URL invalidation** (Phase 16) — Phase 35 extends for dynamic-view-bound layers with `_mv=<dynamicViewVersion>`.
- **Idempotent server migration with PRAGMA-guard** (v1.4 Phase 19, v1.5 Phase 19) — Phase 35 mirrors for `dashboard_layers.dynamic_view_id`.
- **Per-layer config in `dashboard_layers` SQLite columns** (Phase 12 + v1.4 Phase 19 info_*) — Phase 35 adds `dynamic_view_id` as a first-class column (NOT in config JSON blob).
- **Mutual exclusion at config level** — Layer is either table-bound OR dynamic-view-bound. Operator picks one at config time.
- **Inline empty-state + Retry pattern** for renderer errors — Phase 35 mirrors for over-threshold + orphan + error states.

### Integration Points
1. `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (NEW) — Orchestrator hook. Mount in DashboardOpen.
2. `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — AggregatedWidgetRenderer + RecordsTableRenderer extended with status-aware rendering + dynamic-view scoped selectors.
3. `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Three-optgroup picker + `dynamicViews` prop + columns_json sourcing.
4. `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Per-layer "Data Source" picker section.
5. `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Per-layer dynamic-view-aware LAYERS-swap; over-threshold overlay surface.
6. `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Extended with dynamic-view precedence + new `_mv` source.
7. `kinetica_bi/src/api/client.ts` — `DashboardLayerDto` extended with `dynamic_view_id?: number | null`.
8. `kinetica_bi/server/src/db/migrations.ts` (or equivalent) — New idempotent ALTER for `dynamic_view_id` column.
9. `kinetica_bi/server/src/index.ts` (or wherever dashboard_layers CRUD lives) — Type + projection + updateDashboardLayer + PATCH route schema extended.
10. `kinetica_bi/src/components/DashboardsPage.tsx` — Orchestrator hook mount; `dynamicViews` prop threaded through to ChartConfigPanel (likely via existing widget-edit modal path); list-fetch on mount + refresh on `dynamicViewVersion` increment.

</code_context>

<specifics>
## Specific Ideas

- **"Mirror v1.3 sole-materialize-trigger pattern"** — but at dashboard-scope (orchestrator hook) instead of renderer-scope (AggregatedWidgetRenderer). The reason for the divergence: v1.3 chose renderer-scope to deduplicate across N widgets bound to the same table; Phase 35 chooses dashboard-scope because the cascade is N-dynamic-views per source-table-materialize, not N-widgets per dynamic-view.
- **"Implicit pipeline order via store transitions"** — No new orchestration code beyond the hook. React's effect graph carries the chain: filter-view setView → orchestrator detects → fires dynamic-view materialize → dynamic-view setView → renderer scoped selector re-fires.
- **"Mutual exclusion at config-pick time, not data-shape time"** — Widget config CAN store both `tableId` (sourceTableId) and `dynamicViewId`; the renderer treats `dynamicViewId` as primary when present. Drill-down + filter-bar continue to read `tableId` (the source). This avoids a widget config rewrite for legacy code paths.
- **`columns_json` is the contract for ChartConfigPanel column pickers** — When a widget is bound to a dynamic-view, the picker sources columns from the dynamic-view's `columns_json` (populated by Preview-then-Save in Phase 34) instead of the source table's `columns`. If columns_json is null, the picker is disabled with a hint.
- **MapChart per-layer dynamic-view binding is the FIRST SQLite-column-level dynamic-view reference** outside `dashboard_dynamic_views` itself. The FK relationship (logical, not enforced unless PRAGMA FK is on) means: deleting a dynamic-view should cascade to nulling `dashboard_layers.dynamic_view_id` (or block the delete) — Phase 35 should at least handle the orphan-layer case (renderer detects nullable resolution and surfaces "Some layers over threshold" overlay; planner decides whether to add a server-side FK cascade or leave the dangling reference to be cleaned up client-side).
- **Operator mental model:** "I create a dynamic view → bind widgets to it → when I change filters, every widget bound to that view updates automatically (cascading materialize). If the view goes over-threshold for the current filter, widgets clearly say so without breaking."

</specifics>

<deferred>
## Deferred Ideas

- **Drill-down behavior fine-tuning** — Locked simple in this CONTEXT (filter goes to source_table_id, cascades through pipeline). If UAT surfaces edge cases (e.g., operator wants drill-down to filter the dynamic-view's RESULT, not the source), revisit.
- **TD-V15-MAP-ONLY-TRIGGER carry-over for filter-view** — Same problem as before: map-only dashboards have no filter-view materialize trigger. Partially mitigated for dynamic-views by the new orchestrator hook (which fires on filter-view materializeVersion bumps), but the underlying issue (no filter-view materialize fires for map-only dashboards) remains. NOT in Phase 35 scope; carry forward as TD.
- **Server-side dynamic-view delete cascade to dashboard_layers** — When a dynamic-view is deleted via Phase 34's DELETE endpoint, layers referencing it become orphaned. Phase 35 handles the renderer side (over-threshold overlay surfaces); server-side cascade (SET NULL on FK) is a nice-to-have but not in success criteria.
- **Server-side dynamic-view delete cascade to widgets bound to it** — Same as above; widget orphan empty state handles the client-side rendering. Operator manually reconfigures.
- **Live preview pane for ChartConfigPanel when bound to dynamic-view** — Operator can preview columns via the DynamicViewsModal Preview already; ChartConfigPanel doesn't need a duplicate.
- **Auto-create dynamic-view shortcut from ChartConfigPanel** — Inline "+ Create dynamic view" option in the picker. Rejected as cross-component coupling.
- **Dynamic-view status badge in widget chrome** — Status info already surfaced in the body (loading/over-threshold/error). Adding to header is nice-to-have.
- **Cascade re-materialize during dashboard idle** — Currently fires only on filter-view bump. If a dynamic-view's filter-view materialized 10 minutes ago and the TTL expired silently, no automatic re-materialize fires. Out of scope; matches existing v1.3 filter-view TTL-recovery pattern (reactive on next fromSwap+runSql).
- **Performance: debounce orchestrator hook firings** — If filter-view materializeVersion bumps rapidly (e.g., during drag-resize of date range), the orchestrator fires N materializes back-to-back. AbortController dedupes but bandwidth is wasted. Add a 300ms debounce on the orchestrator trigger if perf issues surface in UAT. Phase 35 ships without debounce (mirrors v1.3 Effect 1 debounce, which is the source of bumps anyway).
- **Cross-dashboard dynamic-view sharing** — Locked OUT per CONTEXT 32 §D4.
- **URL/localStorage persistence of widget data-source selection** — Out (PERSIST-V2).

</deferred>

---

*Phase: 35-widget-binding-and-pipeline*
*Context gathered: 2026-05-15*
