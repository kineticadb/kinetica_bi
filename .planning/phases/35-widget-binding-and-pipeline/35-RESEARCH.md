# Phase 35: widget-binding-and-pipeline — Research

**Researched:** 2026-05-15
**Domain:** Frontend renderer integration + dashboard-scope orchestrator hook + per-layer schema migration + WMS LAYERS-swap precedence
**Confidence:** HIGH (source code primary; all references verbatim from the codebase at known paths/line ranges; Context7 not consulted — domain is project-internal architecture, not third-party APIs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cascading materialize trigger architecture (FOUNDATIONAL)**
- NEW dashboard-scope orchestrator hook `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (+ `.spec.ts`).
- Mount site: `DashboardsPage.tsx` `DashboardOpen` body. Single instance per open dashboard.
- Inputs: `dashboardId: number`, list of dynamic-views for the dashboard (see "Dynamic-view list source" below).
- Behavior:
  1. Subscribe to `useFilterViewStore.views` with a primitive selector yielding `materializeVersionByTable: Record<sourceTableId, materializeVersion>` (or simpler: read `useFilterViewStore.views[T]?.materializeVersion ?? 0` for each unique `source_table_id` referenced by the dashboard's dynamic-views).
  2. On any source-table's `materializeVersion` bump, find dynamic-views with `source_table_id === T` and fire the cascade for each: `markPending(id, viewName) → materializeDynamicView(id, signal) → setView/setError`.
  3. Per-dynamic-view AbortController in a `useRef<Map<dynamic_view_id, AbortController>>`. Each cascade fire aborts the previous in-flight materialize for THAT dynamic-view (rapid filter changes do not queue stale calls). Other dynamic-views' in-flight calls are NOT aborted.
  4. On AbortError: silent.
  5. On other error: `setError(id, err.message)` + toast `"error"` kind. CRUD persistence unaffected.

**Dynamic-view list source (LOCKED option b):** Pull-on-mount + re-fetch when `useDynamicViewStore.dynamicViewVersion` increments. Planner verifies dep-array correctness and adds an AbortController to the list-fetch so unmount/refresh cancels in-flight.

**Pipeline order (implicit via store transitions):** filter-view setView → orchestrator detects materializeVersion bump → dynamic-view materialize → dynamic-view setView updates store → widget renderer scoped selector re-fires → fromSwap fires → runSql.

**ChartConfigPanel "Data Source" picker:**
- Three `<optgroup>` blocks: Tables, Views, Dynamic Views. Each hidden when empty.
- `kind: "table" | "view" | "dynamic"` union extended on the existing `dataSourceOptions` builder.
- New prop on ChartConfigPanel: `dynamicViews: DynamicViewRow[] | undefined` (passed from DashboardsPage via the WidgetConfigModal prop conduit alongside existing `tables` / `views`).
- Dynamic-view option label is the bare `name` field.
- `columns_json` consumption: when bound to a dynamic-view, column pickers (metric / group-by / drill-down) source from the dynamic-view row's `columns_json` (parsed array of `{ name, type }`) instead of source-table `columns`. When `columns_json === null`, show inline hint "Run Preview in Dynamic Views to populate columns" and disable the column pickers.
- Widget config persistence on Save: `dynamicViewId: number` → `widget.config.dynamicViewId`; ALSO persists `tableId: number` (= sourceTableId) so existing drill-down dispatch + filter-bar code paths still work; `tableRef` keeps source-table name for legacy reader; renderers prefer `dynamicViewId` when set. Mutual exclusion at config-pick time (single-select picker; choosing a non-dynamic source clears `dynamicViewId`; choosing a dynamic-view sets `dynamicViewId` + `tableId` from `sourceTableId`).

**Renderer integration (AggregatedWidget + RecordsTable):**
- Read `cfg.dynamicViewId as number | undefined` near existing `cfg.tableId` read.
- **Effect 1 stays UNCHANGED** (still fires filter-view materialize). The filter-view must materialize to provide `{view}` substitution source for the dynamic-view; orchestrator hook is downstream.
- Replace Effect 2's `viewName` source: `useDynamicViewStore.views[dynamicViewId]?.viewName` when `dynamicViewId !== undefined`, else existing `useFilterViewStore.views[tableId]?.viewName`.
- Scoped selectors (verbatim spec from CONTEXT.md):
  ```typescript
  const dvEntry = useDynamicViewStore((s) => dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined);
  const dvStatus = dvEntry?.status;
  const dvViewName = dvEntry?.viewName;
  const dvReason = dvEntry?.reason;
  const dvError = dvEntry?.error;
  ```
- Status-aware gates BEFORE existing fromSwap+runSql:
  - `undefined` | `pending` → loading skeleton (reuse existing `loading` UI path).
  - `over_threshold` → inline empty state (no runSql). Single ROADMAP-verbatim message regardless of `reason`.
  - `error` → inline error + Retry link (no runSql).
  - `materialized` → fromSwap(sql, dvViewName) → runSql.
- Orphan detection: `dynamicViewId !== undefined` AND `dvEntry === undefined` AND dashboard's dynamic-view list does NOT contain `dynamicViewId` → orphan empty state.

**MapChart per-layer binding:**
- NEW SQLite column: `dashboard_layers.dynamic_view_id INTEGER` (nullable; logical FK to `dashboard_dynamic_views.id`). PRAGMA-guarded idempotent ALTER mirrors v1.4 Phase 19 pattern.
- Server `DashboardLayer` type extended with `dynamic_view_id: number | null`.
- `mapDashboardLayer` projection includes the field.
- `updateDashboardLayer` accepts the field (with `"key" in attrs` discriminant so explicit null clears).
- PATCH `/api/dashboards/:dashboardId/layers/:layerId` body schema extended.
- Frontend `DashboardLayerDto` mirrors: `dynamic_view_id?: number | null`.
- LayersModal `KineticaWmsLayerForm` gains "Data Source" picker (same three-optgroup as ChartConfigPanel). Selecting a dynamic-view writes `dynamic_view_id` to PATCH body and CLEARS `table_id`. Mutual exclusion.

**buildWmsParams precedence (per layer):**
1. `dynamic_view_id` set AND `dynamicViewEntry?.status === "materialized"` → `LAYERS=<dynamicViewEntry.viewName>`, `_mv=<dynamicViewVersion>`.
2. `dynamic_view_id` set AND status non-materialized → SKIP layer from stack (return null/undefined; "Some layers over threshold" overlay surfaces).
3. Else `table_id` + filter-view (v1.3 path) → `LAYERS=<filter_view_name>`, `_mv=<materializeVersion>` (existing).
4. Else → `LAYERS=<schema.table>` (existing).
- Cache-buster: dynamic-view-bound uses `_mv=<dynamicViewVersion>`; filter-view-bound uses `_mv=<filterViewMaterializeVersion>` (existing). Distinct counters, no collision.

**MapChartRenderer status surfacing:** Per-layer over-threshold/error/pending → omit layer from visible stack (no broken tile URLs). Surface a `MapFilteringBadge`-style "Some layers over threshold" overlay.

**Status → render mapping (AggregatedWidget + RecordsTable):**
| Status | Render | Notes |
|--------|--------|-------|
| `undefined` (no entry) | Loading skeleton | Orchestrator will fire `markPending` shortly |
| `pending` | Loading skeleton | Reuse v1.3 widget loading state |
| `materialized` | fromSwap(sql, viewName) → runSql | Happy path; viewName comes from dynamic-view store |
| `over_threshold` | Inline empty state: "Too much data — narrow your filters to enable this view." | NO SQL executed. Single message regardless of reason. |
| `error` | Inline error + Retry link | Retry path = markPending + materializeDynamicView |
| Orphan | Inline empty state: "This dynamic view was deleted. Reconfigure the widget." | Operator opens ChartConfigPanel to rebind |

**Drill-down on dynamic-view-bound widgets (LOCKED):** Click writes to `useFilterStore.filters[sourceTableId]` (the dynamic-view's source table). Natural cascade: filterStore.addFilter → AggregatedWidget Effect 1 → filter-view materializes → materializeVersion bumps → orchestrator hook detects → dynamic-view re-materializes → renderer fromSwap fires with new viewName. ChartConfigPanel persists `tableId: sourceTableId` alongside `dynamicViewId` specifically so existing drill-down dispatch + filter-bar code paths work without rewrites.

**Test coverage scope (locked at 9 buckets):**
1. Orchestrator hook spec (`useDynamicViewMaterializeChain.spec.ts`)
2. ChartConfigPanel.spec.tsx extensions
3. AggregatedWidgetRenderer / WidgetRenderer spec extensions
4. RecordsTableRenderer spec extensions
5. MapChartRenderer spec extensions
6. LayersModal + KineticaWmsLayerForm spec extensions
7. wmsUrlBuilder.spec.ts extensions
8. Server migration spec (`db.smoke.spec.ts` or equivalent)
9. Server route spec (`routes.layers.spec.ts` PATCH dynamic_view_id; both AUTH_MODE blocks)

### Claude's Discretion (planner picks within locked semantics)

- Whether ChartConfigPanel's `dynamicViews` prop is passed directly OR derived from a new `useDynamicViewsList(dashboardId)` hook reading from a Zustand slice. Recommend prop-passing if the list lives in DashboardOpen scope already.
- Whether to share a single Data Source picker component between ChartConfigPanel and KineticaWmsLayerForm OR duplicate the three-optgroup pattern. Recommend share if JSX is non-trivial.
- Exact Retry-link implementation (orchestrator hook exposed retry method vs direct fire from renderer).
- Whether orchestrator hook returns anything (e.g., `retry(dynamicViewId)`) or is fire-and-forget.
- CSS class naming for over-threshold + orphan empty states.
- Whether to show dynamic-view's status badge inside widget chrome (header) in addition to body empty state.
- Exact orphan-detection algorithm (caching list).

### Deferred Ideas (OUT OF SCOPE)

- Widget creation flow when no `columns_json` yet exists (defensive handling only; Phase 34 already ensures Save populates).
- Drill-down fine-tuning beyond the locked simple path (UAT-driven).
- TD-V15-MAP-ONLY-TRIGGER carry-over for filter-view-only dashboards (partially mitigated by orchestrator hook).
- Server-side LAYERS-swap (none needed — all swaps client-side).
- Cross-dashboard dynamic-view sharing (locked OUT per CONTEXT 32 §D4).
- Auto-refresh / live update.
- Server-side dynamic-view delete cascade to dashboard_layers / widgets (renderer side handles orphan UX).
- Live preview pane in ChartConfigPanel for dv-bound widgets.
- Auto-create dynamic-view shortcut from ChartConfigPanel.
- Dynamic-view status badge in widget chrome (nice-to-have).
- Cascade re-materialize during dashboard idle / TTL recovery.
- Performance: debounce orchestrator hook firings (Phase 35 ships without debounce; 300ms debounce in Effect 1 upstream is enough).
- URL/localStorage persistence of widget data-source selection.
- E2E verification (Phase 36 / VERIFY-V16-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **DV-V16-12** | ChartConfigPanel "Data Source" picker adds a Dynamic Views optgroup (when `usesDataSource: true`). Selecting writes `dynamicViewId` to `widget.config`. | `ChartConfigPanel.tsx:70-86` shows the existing two-optgroup `dataSourceOptions` builder — extend to three-optgroup with `kind: "dynamic"` entries; `ChartConfigPanel.tsx:217-249` (CustomConfigPanel branch) and `:356-386` (standard branch) BOTH render the picker — extend both. `registry.ts:99-107` confirms `usesDataSource: false` for map widgets (map's per-layer picker is in `KineticaWmsLayerForm`); `definitions/map.ts:26` confirms. Save-time persistence already plumbs `tableId` via `ChartConfigPanel.tsx:513` (standard) + `:275` (custom branch — `selectedSource?.tableId`) — extend to write `dynamicViewId` and have `selectedSource` track `sourceTableId` from the dynamic-view row. |
| **DV-V16-13** | Renderers (AggregatedWidgetRenderer, RecordsTableRenderer, MapChartRenderer) read `dynamicViewId`, look up resolved view from `useDynamicViewStore`, FROM-swap (or LAYERS-swap) against it. Cascading re-materialize on filter-view version bump. | AggregatedWidget Effect 2 at `WidgetRenderer.tsx:390-500` uses `fromSwap(sql, viewName)` with `viewName` from `useFilterViewStore.views[tableId]?.viewName` (line 252-254) — flip selector to `useDynamicViewStore.views[dynamicViewId]?.viewName` when `dynamicViewId` set. RecordsTableRenderer at `WidgetRenderer.tsx:1112-1295` uses **raw `fromSource = viewName \|\| table`** at line 1294 (NOT `fromSwap`) — extend same conditional. MapChartRenderer Effects 2+3 at `MapChartRenderer.tsx:776-952` read `useFilterViewStore.getState().views[tableId]` per-layer (lines 827, 934) — extend with parallel `useDynamicViewStore.getState().views[layer.dynamic_view_id]` lookup. Orchestrator hook owns the cascade firing — see §"Code Examples" below. |
| **DV-V16-14** | Widgets bound to `over_threshold` dynamic view render clear empty state: "Too much data — narrow your filters to enable this view." NO SQL executed. | Status-aware gate inserted BEFORE Effect 2's runSql call. `dvStatus === "over_threshold"` → early return with empty-state JSX. Single ROADMAP-verbatim message — CONTEXT.md locks "Reason field differentiation rejected." For maps, the over-threshold layer is omitted from the WMS stack AND surfaced via overlay. |
</phase_requirements>

## Summary

Phase 35 is the deepest integration phase of v1.6: a NEW dashboard-scope orchestrator hook plus three renderer extensions (AggregatedWidget, RecordsTable, MapChart) plus ChartConfigPanel three-optgroup picker plus LayersModal per-layer "Data Source" picker plus `buildWmsParams` precedence extension plus a schema migration. Every architectural piece has a direct template in the existing codebase — Phase 35 is composition, not invention.

**Primary recommendation:** Mount `useDynamicViewMaterializeChain` at the FIRST line of the `DashboardOpen` body (alongside the lifecycle `useEffect` at `DashboardsPage.tsx:396-433` and BEFORE the `DashboardContextProvider` render at line 857). Pass the local `dynamicViews: DynamicViewRow[]` state (lifted from a new `useEffect` that calls `listDynamicViews(dashboardId, signal)` on mount + re-fetches when `useDynamicViewStore.dynamicViewVersion` increments). Thread the SAME `dynamicViews` array to (a) the orchestrator hook (input), (b) `ChartConfigPanel` (via `WidgetConfigModal` prop), (c) renderers (via DashboardContext extension for orphan-detection) — single source of truth, no Zustand slice needed.

The cascade chain is implicit via React's effect graph + Zustand store transitions — Effect 1 in AggregatedWidget keeps its existing dep array `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion]` UNCHANGED (locked); the orchestrator subscribes to `useFilterViewStore.views[T]?.materializeVersion` via a primitive selector and reacts when the value increments after `setView` at `filterViewStore.ts:59-73`.

## Standard Stack

### Core (all already present in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zustand` | ^4.5.2 | Store subscriptions, scoped selectors, `getState()` imperative reads | Established v1.2-v1.6 pattern; Zustand reset shim at `kinetica_bi/__mocks__/zustand.ts` auto-covers new stores |
| `vitest` | ^4.1.5 + `@testing-library/react` ^16.3.2 | Component + hook + spec tests | Established frontend test harness (887/887 passing as of Phase 34 close) |
| `better-sqlite3` (server) | n/a (already installed) | SQLite schema migration | PRAGMA-guarded ALTER pattern established in v1.0→v1.1 sessions + v1.4 Phase 19 dashboard_layers info_* migration |
| `supertest` (server) | n/a (already installed) | PATCH /api/dashboards/:id/layers/:layerId route test | Established AUTH_MODE=password + AUTH_MODE=oidc dual-block pattern (e.g., `routes.dynamic-view.spec.ts`, `layers.spec.ts`) |

**No new dependencies required.** Every library Phase 35 needs is already in `kinetica_bi/package.json`:
- React 18 hooks (`useEffect`, `useRef`, `useMemo`) — already used in every renderer
- Zustand stores — `useDynamicViewStore` (Phase 33), `useFilterViewStore` (Phase 14), `useFilterStore` (Phase 9), `useToastStore` (existing)
- API client helpers — `materializeDynamicView`, `listDynamicViews` (Phase 33; already imported by `DynamicViewsModal.tsx`)
- `buildDynamicViewName` from `kinetica_bi/src/lib/dynamicViewName.ts` (Phase 33; already imported by `DynamicViewsModal.tsx:65`)
- `useAuthStore` from `kinetica_bi/src/store/auth.ts` (existing; needed by orchestrator for userId in `buildDynamicViewName`)

### Supporting (already imported by sibling phases)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `fromSwap` from `kinetica_bi/src/lib/fromSwap.ts` | Single-FROM regex replace | AggregatedWidget Effect 2 — reuse unchanged; flip `viewName` source |
| `useToastStore.showToast(msg, kind)` from `kinetica_bi/src/store/toast.ts` | Operator feedback | Orchestrator error path; renderer error states |
| `aggregateSpatialTargetsByTable` from `kinetica_bi/src/lib/spatialTargets.ts` | Existing widget-level aggregation | Reference pattern only (Phase 30); orchestrator does similar aggregation `source_table_id → dynamic_view_id[]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Local `dynamicViews` state in DashboardOpen (RECOMMENDED) | New Zustand slice `useDynamicViewListStore` | Overkill for Phase 35; CONTEXT marks as "defer if needed". A slice would add 30+ LOC for what's a single fetch + version-watcher. Local state + prop-drilling is leaner. |
| Per-id Map AbortController in orchestrator (LOCKED) | Single AbortController for all cascades | Cross-cancellation — filter change on table A would abort in-flight materialize for table B's dynamic-views. Per-id Map is the correct isolation primitive. |
| `dynamicViewVersion` bump as list re-fetch trigger (LOCKED — option b) | Custom event `kbi:dynamic-views-changed` dispatched by DynamicViewsModal | Custom event introduces a new coupling surface and lifecycle hazard (forget-to-fire on Save = stale list). `dynamicViewVersion` is already the v1.6 dep-array primitive; re-using it preserves the single-signal-of-mutation invariant. False-positive refetches on every store mutation are cheap (single GET). |
| Status-aware gate as renderer-local short-circuit (LOCKED) | Lift gate into `WidgetRenderer.tsx` top-level switch | Top-level switch is the routing layer (`map` → MapChartRenderer; `info-card` → InfoCardRenderer; etc.); inserting per-widget-binding logic there bloats it. Per-renderer gate keeps the status-handling co-located with the data fetch. |
| `useDynamicViewStore.views[id]` scoped selector per renderer (LOCKED PITFALL C-02) | Read whole `views` map | Would re-render every widget on any dynamic-view mutation. Scoped selector pattern is locked across v1.2-v1.6 (`PITFALL C-02 / S-02`). |

**Version verification:** All listed packages are already present in `kinetica_bi/package.json` (line 13-29) at the versions used by Phase 34 (closed 2026-05-15). No new package adds — no `npm view` round-trip needed.

## Architecture Patterns

### Recommended Project Structure (additions only)

```
kinetica_bi/src/
├── hooks/
│   ├── useApiQuery.ts                          # existing
│   ├── useDynamicViewMaterializeChain.ts       # NEW (Phase 35)
│   └── useDynamicViewMaterializeChain.spec.ts  # NEW (Phase 35)
├── components/
│   ├── DashboardsPage.tsx                      # extended: hook mount, dynamicViews list state, dynamicViews prop threading
│   ├── LayersModal.tsx                         # extended: pass dynamicViews to KineticaWmsLayerForm
│   ├── DynamicViewsModal.tsx                   # UNCHANGED in Phase 35 (Phase 34 already triggers materialize on Save)
│   └── charts/
│       ├── WidgetRenderer.tsx                  # extended: AggregatedWidget + RecordsTable dynamic-view branches
│       ├── MapChartRenderer.tsx                # extended: Effect 2/3 per-layer dynamic-view branch + overlay
│       ├── ChartConfigPanel.tsx                # extended: three-optgroup picker + dynamicViews prop + columns_json sourcing
│       └── KineticaWmsLayerForm.tsx            # extended: "Data Source" picker section + dynamic_view_id PATCH routing
└── lib/
    └── wmsUrlBuilder.ts                        # extended: precedence + per-layer dynamicViewEntry input

kinetica_bi/server/src/
├── types.ts                                    # extended: DashboardLayer.dynamic_view_id: number | null
├── db.ts                                       # extended: SCHEMA_DDL + PRAGMA migration + mapDashboardLayer + updateDashboardLayer + createDashboardLayer (optional)
└── index.ts                                    # extended: PATCH /api/dashboards/:id/layers/:layerId body Pick<>

kinetica_bi/server/tests/
├── db.smoke.spec.ts                            # extended: v1.5 → v1.6 layers.dynamic_view_id migration test
└── layers.spec.ts                              # extended: PATCH accepts dynamic_view_id (both AUTH_MODE blocks)
```

### Pattern 1: Dashboard-Scope Orchestrator Hook (NEW for v1.6)

**What:** A `useEffect`-based subscription to `useFilterViewStore.materializeVersion` per relevant source-table that fires cascades through `useDynamicViewStore`. Per-dynamic-view AbortController in a `useRef<Map>`. Listens for `dynamicViewVersion` to refresh the dashboard's dynamic-view list.

**When to use:** Phase 35 is the first instance. The divergence from v1.3's sole-materialize-trigger pattern (Effect 1 in AggregatedWidgetRenderer) is intentional: v1.3 deduplicates across N widgets per table; Phase 35 deduplicates across N dynamic-views per source-table-materialize. The orchestrator solves "what if no aggregated widget exists on this source table?" (partial mitigation of TD-V15-MAP-ONLY-TRIGGER for dynamic-views — full filter-view trigger gap remains).

**Example (skeleton):**

```typescript
// Source: synthesized from CONTEXT.md §"Cascading materialize trigger architecture"
//         + Phase 30 RecordsTableRenderer Effect at WidgetRenderer.tsx:1212-1256
//         + Phase 33 client helpers at api/client.ts:737-927
//         + Phase 33 store at store/dynamicViewStore.ts
import { useEffect, useRef } from "react";
import { useFilterViewStore } from "../store/filterViewStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { buildDynamicViewName } from "../lib/dynamicViewName";
import {
  listDynamicViews,
  materializeDynamicView,
  type DynamicViewRow,
} from "../api/client";

export function useDynamicViewMaterializeChain(dashboardId: number): {
  dynamicViews: DynamicViewRow[];
  retry: (dynamicViewId: number) => void;
} {
  // 1. Local list state — refreshed on mount and on dynamicViewVersion increment.
  const [dynamicViews, setDynamicViews] = useState<DynamicViewRow[]>([]);
  const dynamicViewVersion = useDynamicViewStore((s) => s.dynamicViewVersion);
  const listAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listAbortRef.current?.abort();
    const ctrl = new AbortController();
    listAbortRef.current = ctrl;
    listDynamicViews(dashboardId, ctrl.signal)
      .then(({ dynamic_views }) => {
        if (!ctrl.signal.aborted) setDynamicViews(dynamic_views);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        // Soft-fail — operator can still use widgets; cascades just won't fire.
      });
    return () => ctrl.abort();
  }, [dashboardId, dynamicViewVersion]);

  // 2. Subscribe to materializeVersion per source-table referenced by dynamic-views.
  //    PITFALL S-02 lock: primitive key — sorted-stable join — for stable subscription identity.
  const sourceTableIds = useMemo(
    () => Array.from(new Set(dynamicViews.map((dv) => dv.source_table_id))).sort((a, b) => a - b),
    [dynamicViews]
  );
  const matVersionKey = useFilterViewStore((s) =>
    sourceTableIds.map((tid) => `${tid}:${s.views[tid]?.materializeVersion ?? 0}`).join(",")
  );

  // 3. Per-dynamic-view AbortController Map — survives re-renders via useRef.
  //    Each id has at most one in-flight materialize.
  const cascadeControllersRef = useRef<Map<number, AbortController>>(new Map());

  useEffect(() => {
    // For each dynamic-view: read its source table's materializeVersion; if a fresh
    // materializeVersion is observed (or any present), fire the cascade. The selector
    // re-renders fire this effect; tracking "last seen" per-id is unnecessary because
    // materializeVersion is monotonic and abort dedups in-flight calls.
    const username = useAuthStore.getState().user?.username;
    if (!username) return;

    for (const dv of dynamicViews) {
      const matVer = useFilterViewStore.getState().views[dv.source_table_id]?.materializeVersion;
      if (matVer === undefined || matVer === 0) continue; // filter view hasn't materialized yet

      // Abort prior in-flight cascade for THIS dv (other dvs unaffected).
      cascadeControllersRef.current.get(dv.id)?.abort();
      const ctrl = new AbortController();
      cascadeControllersRef.current.set(dv.id, ctrl);

      const viewName = buildDynamicViewName({
        userId: username,
        dashboardId: dv.dashboard_id,
        dynamicViewId: dv.id,
      });
      useDynamicViewStore.getState().markPending(dv.id, viewName);

      materializeDynamicView(dv.id, ctrl.signal)
        .then((result) => {
          if (ctrl.signal.aborted) return;
          if (result.status === "materialized") {
            useDynamicViewStore.getState().setView(dv.id, {
              viewName: result.view_name,
              status: "materialized",
              expiresAt: result.expires_at,
            });
          } else if (result.status === "over_threshold") {
            useDynamicViewStore.getState().setView(dv.id, {
              viewName,
              status: "over_threshold",
              reason: result.reason,
            });
          }
        })
        .catch((err) => {
          if ((err as Error)?.name === "AbortError") return;
          const msg = (err as Error).message ?? "Materialize failed";
          useDynamicViewStore.getState().setError(dv.id, msg);
          useToastStore.getState().showToast(`Materialize failed: ${msg}`, "error");
        });
    }
    // PITFALL S-02 dep array: primitive key (matVersionKey) + dynamicViews ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matVersionKey, dynamicViews]);

  // 4. Cleanup: abort all in-flight cascades on unmount.
  useEffect(() => () => {
    cascadeControllersRef.current.forEach((c) => c.abort());
    cascadeControllersRef.current.clear();
  }, []);

  // 5. Retry — exposed for renderer error states.
  const retry = useCallback((dynamicViewId: number) => {
    const dv = dynamicViews.find((d) => d.id === dynamicViewId);
    if (!dv) return;
    const username = useAuthStore.getState().user?.username;
    if (!username) return;
    cascadeControllersRef.current.get(dv.id)?.abort();
    const ctrl = new AbortController();
    cascadeControllersRef.current.set(dv.id, ctrl);
    const viewName = buildDynamicViewName({ userId: username, dashboardId: dv.dashboard_id, dynamicViewId: dv.id });
    useDynamicViewStore.getState().markPending(dv.id, viewName);
    materializeDynamicView(dv.id, ctrl.signal)
      .then((r) => { /* same branching as above */ })
      .catch((e) => { /* same branching as above */ });
  }, [dynamicViews]);

  return { dynamicViews, retry };
}
```

**KEY DECISION FOR PLANNER:** The hook design above returns `{ dynamicViews, retry }`. The list is consumed by ChartConfigPanel (via prop) + renderers (via DashboardContext extension or direct prop). The `retry` function is consumed by renderer error-state Retry links. If planner prefers fire-and-forget (no return value), retry can be inlined per-renderer using the same `markPending + materializeDynamicView` pattern.

### Pattern 2: Scoped Zustand Selectors (PITFALL C-02 / S-02 carry-forward)

Every per-id consumer scopes selector to `s.views[id]` — never the whole `views` map. Phase 33 store contract (lines 79-155 of `dynamicViewStore.ts`) and Phase 14 filterViewStore (lines 52-129) both use this pattern.

```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:252-272 (verbatim model)
const dvEntry = useDynamicViewStore((s) =>
  dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined
);
// PITFALL S-02: derive primitives from the entry for dep arrays — never use the
//               entry reference directly (the entry is a fresh object on every mutation,
//               but the primitives below are stable when underlying state is unchanged).
const dvStatus = dvEntry?.status;
const dvViewName = dvEntry?.viewName;
const dvReason = dvEntry?.reason;
const dvError = dvEntry?.error;
```

**Why this is non-negotiable:** Without scoped selectors, every widget would re-render on every dynamic-view mutation. With N widgets × M dynamic-views, that's O(N×M) wasted renders per filter change. The C-02 lock has prevented this regression in v1.3-v1.5.

### Pattern 3: PRAGMA-Guarded Idempotent ALTER (v1.4 Phase 19 template)

The `dashboard_layers.dynamic_view_id` column is added the same way `info_enabled` / `info_columns` / `info_template` were in v1.4 Phase 19 (now at `kinetica_bi/server/src/db.ts:149-170` for the migration block + `:83-96` for the fresh-install CREATE TABLE).

```typescript
// Source: kinetica_bi/server/src/db.ts:149-170 (verbatim model)
// To add after the info_* block (lines 165-170):
if (!layerColNames.has("dynamic_view_id")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN dynamic_view_id INTEGER");
}
```

And the fresh-install CREATE TABLE block at `db.ts:83-96` gains a single line:

```sql
CREATE TABLE IF NOT EXISTS dashboard_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL,
  layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  info_enabled INTEGER NOT NULL DEFAULT 1,
  info_columns TEXT,
  info_template TEXT,
  dynamic_view_id INTEGER,  -- v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding; logical FK to dashboard_dynamic_views.id (no REFERENCES — soft FK, layer survives if dynamic-view deleted; renderer detects orphan)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**SOFT FK RATIONALE (LOCKED):** No `REFERENCES dashboard_dynamic_views(id)` clause. Mirrors the existing `table_id INTEGER NOT NULL` line (db.ts:87 — comment: "soft FK (no REFERENCES) — layers survive table deletion; frontend renders error badge"). This lets a layer survive the deletion of its dynamic-view without a SQLite-level cascade; the renderer's orphan-detection path handles the UX (CONTEXT.md "Orphan widget UX" — renderer surfaces empty state).

### Pattern 4: `updateDashboardLayer` with `"key" in attrs` Discriminant (v1.4 Phase 19 template)

The `dynamic_view_id` column needs `null`-vs-`undefined` discrimination so explicit clear works without ambiguity. Mirror lines 482-491 of `db.ts`:

```typescript
// Source: kinetica_bi/server/src/db.ts:470-493 (existing pattern, extend by one line)
export const updateDashboardLayer = (
  id: number,
  attrs: Partial<Pick<DashboardLayer,
    "table_id" | "position" | "config" |
    "info_enabled" | "info_columns" | "info_template" |
    "dynamic_view_id"  // NEW Phase 35
  >>
): DashboardLayer | undefined => {
  const existing = getDashboardLayer(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, dynamic_view_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.table_id ?? existing.table_id,
    attrs.position ?? existing.position,
    JSON.stringify(attrs.config ?? existing.config),
    "info_enabled" in attrs ? attrs.info_enabled : existing.info_enabled,
    "info_columns" in attrs ? attrs.info_columns : existing.info_columns,
    "info_template" in attrs ? attrs.info_template : existing.info_template,
    "dynamic_view_id" in attrs ? attrs.dynamic_view_id : existing.dynamic_view_id,  // NEW
    id
  );
  return getDashboardLayer(id);
};
```

### Pattern 5: Frontend `DashboardLayerDto` Byte-Parity Extension (v1.4 Phase 19 template)

```typescript
// Source: kinetica_bi/src/api/client.ts:454-471 — extend in-place
export type DashboardLayerDto = {
  // ... existing fields ...
  info_enabled: number;
  info_columns: string | null;
  info_template: string | null;
  dynamic_view_id: number | null;  // NEW Phase 35 — mirrors server DashboardLayer.dynamic_view_id
  created_at: string;
  updated_at: string;
};

// And extend updateLayer's Pick<>:
export const updateLayer = async (
  dashboardId: number,
  layerId: number,
  attrs: Partial<Pick<DashboardLayerDto,
    | "table_id"
    | "position"
    | "config"
    | "info_enabled"
    | "info_columns"
    | "info_template"
    | "dynamic_view_id"  // NEW Phase 35
  >>
) => { /* unchanged body */ };
```

### Pattern 6: Three-Optgroup Picker (extend existing two-optgroup at ChartConfigPanel.tsx)

```typescript
// Source: kinetica_bi/src/components/charts/ChartConfigPanel.tsx:70-86 (existing two-optgroup)
// Extend to three by adding a third entry-kind:
const dataSourceOptions = useMemo(() => {
  const opts: Array<
    | { label: string; value: string; kind: "table"; tableId: number }
    | { label: string; value: string; kind: "view"; tableId: number }
    | { label: string; value: string; kind: "dynamic"; dynamicViewId: number; sourceTableId: number; columnsJson: { name: string; type: string }[] | null }
  > = [];
  if (tables) {
    for (const t of tables) {
      const full = t.schema ? `${t.schema}.${t.name}` : t.name;
      opts.push({ label: full, value: full, kind: "table", tableId: t.id });
    }
  }
  if (views) {
    for (const v of views) {
      if (v.status === "created") {
        opts.push({ label: `${v.view_name} (view)`, value: v.view_name, kind: "view", tableId: v.table_id });
      }
    }
  }
  if (dynamicViews) {
    for (const dv of dynamicViews) {
      // Value MUST be unique across all three kinds — use a discriminator prefix.
      // Recommended: `dv:${dv.id}` (never collides with schema.table or filter-view name).
      opts.push({
        label: dv.name,
        value: `dv:${dv.id}`,
        kind: "dynamic",
        dynamicViewId: dv.id,
        sourceTableId: dv.source_table_id,
        columnsJson: dv.columns_json,
      });
    }
  }
  return opts;
}, [tables, views, dynamicViews]);
```

**JSX (extends `ChartConfigPanel.tsx:223-247` standard branch + `:222-249` custom-panel branch — BOTH render the picker; both need a third optgroup):**

```tsx
<select className="ds-select" value={selectedTableName} onChange={(e) => handleTableChange(e.target.value)}>
  <option value="">Select a data source...</option>
  {tables && tables.length > 0 && (
    <optgroup label="Tables">{/* ... existing ... */}</optgroup>
  )}
  {views && views.filter((v) => v.status === "created").length > 0 && (
    <optgroup label="Views">{/* ... existing ... */}</optgroup>
  )}
  {dynamicViews && dynamicViews.length > 0 && (
    <optgroup label="Dynamic Views">
      {dynamicViews.map((dv) => (
        <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>{dv.name}</option>
      ))}
    </optgroup>
  )}
</select>
```

### Anti-Patterns to Avoid

- **DO NOT** add `dynamicViewId` to AggregatedWidget Effect 1's dep array. CONTEXT.md locks: "Effect 1 stays unchanged (still fires filter-view materialize)." The dynamic-view materialize is the orchestrator's job; Effect 1's job remains filter-view materialization (which the dynamic-view depends on).
- **DO NOT** use a single AbortController for all dynamic-view cascades in the orchestrator. The per-id Map is mandatory — otherwise filter changes on table A would cancel in-flight materializes for unrelated table B's dynamic-views.
- **DO NOT** subscribe the orchestrator to the entire `useFilterViewStore.views` object. Use a primitive key derived from `sourceTableIds.map((tid) => '${tid}:${views[tid]?.materializeVersion ?? 0}').join(',')` — same `viewsKey` pattern as `MapChartRenderer.tsx:411-417`.
- **DO NOT** mix `dynamicViewId` and `tableId` mutual-exclusion logic into the widget config schema. CONTEXT.md locks: BOTH can coexist on `widget.config` (`dynamicViewId` is primary; `tableId` is `sourceTableId` for drill-down / filter-bar). Mutual exclusion is enforced at the picker level, not at the schema level.
- **DO NOT** introduce a `kind: "warning"` toast for over-threshold. Phase 34 RESEARCH locked: `ToastKind = "permission" | "info" | "error"` — see `toast.ts:3`. Use `"error"` for orchestrator materialize failures; over-threshold transitions are silent in the orchestrator (renderer shows the empty state).
- **DO NOT** use `??` for `viewName || rawTableRef` substitution. Use `||` so an empty-string placeholder (which `markMaterializing` writes at `filterViewStore.ts:94`) falls through to the raw table reference. See `MapChartRenderer.tsx:833,942` ("`||` not `??`" comment lock).
- **DO NOT** add a server-side cascade for dynamic-view delete → dashboard_layers SET NULL. CONTEXT.md deferred: client-side orphan handling via renderer surface (overlay) is the locked v1.6 UX.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cascading materialize trigger | Per-renderer subscription to filter-view materializeVersion | Single dashboard-scope `useDynamicViewMaterializeChain` hook | N renderers × M dynamic-views = N×M trigger fires per filter change; orchestrator gives O(M) per filter change |
| AbortController dedup across N async cascades | Single `useRef<AbortController>` | `useRef<Map<number, AbortController>>` | Single controller cross-cancels; the Map gives per-id isolation |
| Dynamic-view list freshness signal | Custom `kbi:dynamic-views-changed` event | `useDynamicViewStore.dynamicViewVersion` increment | Phase 33 already designed this primitive as the dep-array signal for downstream consumers (33-CONTEXT.md "dynamicViewVersion semantics") |
| FROM-swap for dynamic-view-bound SQL | New regex helper | Existing `fromSwap(sql, viewName)` from `lib/fromSwap.ts:19-24` | Same first-FROM-identifier semantic; viewName source flip is the only change |
| LAYERS-swap precedence cascade | New helper module | Extend `buildWmsParams` in `lib/wmsUrlBuilder.ts:156-272` | Existing builder is the canonical WMS URL composer; precedence is a 4-case branch above the existing 2-case (filter-view / bare-table) |
| Schema migration for dashboard_layers.dynamic_view_id | New migration framework | PRAGMA-guarded idempotent ALTER (v1.4 Phase 19 template at `db.ts:149-170`) | Established pattern, single-line addition |
| Toast for over-threshold | `kind: "warning"` | `kind: "info"` for Save-time toast (Phase 34 already does this at `DynamicViewsModal.tsx:478,490,498`); no toast for orchestrator cascade (renderer empty state IS the feedback) | ToastKind union doesn't include "warning" (`toast.ts:3`) |
| Per-layer "Data Source" picker JSX | Duplicate ChartConfigPanel's three-optgroup inline | Extract a `<DataSourcePicker>` component if planner judges the JSX non-trivial (~30 LOC × 2 sites) | CONTEXT.md "Claude's Discretion"; recommend share |

**Key insight:** Phase 35 is composition, not invention. Every architectural primitive has a direct in-repo template. The cost of NOT mirroring existing patterns is: lost C-02/S-02 selector locks, inconsistent abort semantics across renderers, drift from the v1.3 sole-trigger pattern.

## Common Pitfalls

### Pitfall 1: Orchestrator hook re-fires materialize on first mount before filter-view has materialized

**What goes wrong:** `useFilterViewStore.views[T]?.materializeVersion` is `undefined` (no entry yet) before the user applies a filter. If the orchestrator naively fires cascades whenever its effect re-runs (e.g., on initial mount with dynamicViews loaded), it will trigger materializes against a non-existent filter view → server returns `over_threshold/no_filter` (the design path, not an error) but the cascade fires for every dynamic-view on every dashboard open, even with zero filters.

**Why it happens:** Effects fire on every dep-array change including initial mount. The matVersionKey primitive starts as `"4:0,7:0,9:0"` (all zeros) on first mount.

**How to avoid:** Gate the cascade firing on `matVer !== undefined && matVer > 0` (see hook skeleton above, `// filter view hasn't materialized yet` comment). This ensures cascades only fire AFTER the filter-view's first successful materialize, not on initial dashboard open. Server's `over_threshold/no_filter` short-circuit at `server/src/index.ts:1156-1163` is for live filter changes, not initial loads.

**Warning signs:** Server logs show `DYNAMIC_MATERIALIZE` POST flood on dashboard open with no operator interaction. Toasts fire on dashboard mount.

### Pitfall 2: AbortController Map leaks on dynamic-view delete

**What goes wrong:** A dynamic-view is deleted via Phase 34's DELETE flow → `useDynamicViewStore.clearView(id)` fires → the dynamicViews list refreshes (because `dynamicViewVersion` bumps) → the deleted dv is no longer in the list → but the orchestrator's `cascadeControllersRef.current.get(id)` AbortController remains in the Map with no cleanup path.

**Why it happens:** The orchestrator's effect cleanup runs on EVERY effect re-fire (dep change), not on dynamic-view removal specifically. The Map grows unbounded if dynamic-views churn over a session.

**How to avoid:** After the cascade loop in the orchestrator's effect, prune entries for dvs no longer in the list:

```typescript
const activeIds = new Set(dynamicViews.map((dv) => dv.id));
for (const [id, ctrl] of cascadeControllersRef.current.entries()) {
  if (!activeIds.has(id)) {
    ctrl.abort();
    cascadeControllersRef.current.delete(id);
  }
}
```

Practically, the leak is bounded by per-session dynamic-view creation count (single-digit), but a clean Map is the correct discipline.

**Warning signs:** Memory in dev tools grows linearly with the number of dynamic-view delete actions during a session.

### Pitfall 3: `tableId` vs `dynamicViewId` config field coexistence breaks filter-bar render loop

**What goes wrong:** CONTEXT.md locks that BOTH `tableId` and `dynamicViewId` can coexist on `widget.config` (dynamicViewId is primary; tableId points to sourceTableId for drill-down + filter-bar). If a planner reads ONLY `tableId` to drive the filter-bar without considering `dynamicViewId`, the filter-bar correctly renders chips for the source table — but if a planner conditions the filter-bar on `tableId === undefined` (an inverse check), dv-bound widgets would lose their filter-bar entry.

**Verified via code trace:** `DashboardsPage.tsx:733-849` (filter-bar render loop) iterates `tableIdsWithFilters` keyed on `tableId` from `view.table_id` and `allStoreFilters[tableId]`. It does NOT check `widget.config.dynamicViewId`. SO this works correctly with the locked design: dv-bound widgets persist `tableId: sourceTableId`, and the filter-bar renders chips against `sourceTableId` (which is exactly the drill-down target).

**How to avoid:** Plan tasks MUST verify that `tableId` is ALWAYS written alongside `dynamicViewId` at ChartConfigPanel Save time. The locked Save shape is `{ tableId: sourceTableId, dynamicViewId, tableRef: sourceTableName, ... }`. Drop ANY of those and downstream code breaks silently.

**Verified clean code paths (rely on `tableId` and work unchanged with dv-bound widgets):**
- AggregatedWidget filter store subscription at `WidgetRenderer.tsx:242-248`
- RecordsTable filter store subscription at `WidgetRenderer.tsx:1140-1158`
- AggregatedWidget Effect 1 materialize trigger at `WidgetRenderer.tsx:314-376`
- RecordsTable Effect 1 materialize trigger at `WidgetRenderer.tsx:1212-1256`
- Drill-down dispatch at `WidgetRenderer.tsx:70-112`
- Filter-bar render loop at `DashboardsPage.tsx:733-849`

**Warning signs:** Drill-down clicks on dv-bound widget produce no chip in filter-bar; filter-bar Clear button doesn't reset dv-bound widget data.

### Pitfall 4: Empty-string viewName placeholder leaks through fromSwap

**What goes wrong:** `markPending` writes `viewName: ""` on the defensive setError-on-absent fallback (Phase 33 store at `dynamicViewStore.ts:128-130`). If fromSwap is called with `""`, the `!viewName` falsy guard at `fromSwap.ts:22` correctly returns the unswapped SQL — but if the renderer's `dvViewName` is `""` and the renderer ALSO performs a status check via `if (dvStatus === "materialized")` BEFORE the fromSwap call, the materialized path emits SQL with empty FROM (because `materialized` status with empty `viewName` is the defensive fallback state that should never reach the renderer in practice).

**Why it happens:** Phase 33 contract guarantees `viewName` is populated from `markPending` forward; the empty-string is ONLY the setError-on-absent placeholder. Phase 35 renderer code must trust the contract.

**How to avoid:** Status-aware gate runs BEFORE viewName check. Pseudocode:

```typescript
if (dvStatus === undefined || dvStatus === "pending") return <loading-skeleton />;
if (dvStatus === "over_threshold") return <over-threshold-empty-state />;
if (dvStatus === "error") return <error-with-retry />;
// dvStatus === "materialized"
if (!dvViewName) return <error-internal />;  // defense in depth — should never hit
const finalSql = fromSwap(sql, dvViewName);
```

The `fromSwap.ts:22` falsy guard means `fromSwap(sql, "")` returns `sql` unchanged — but the renderer should never reach that path in Phase 35 because the `materialized` status check is the gate. Defense-in-depth check on `!dvViewName` after the status gate catches Phase 33 contract violations.

**Warning signs:** SQL logged to server showing `SELECT * FROM ` (empty FROM) errors from Kinetica.

### Pitfall 5: WMS URL cache collision between filter-view and dynamic-view materialize counters

**What goes wrong:** Layer A is filter-view-bound; its `_mv` is `useFilterViewStore.views[A.table_id].materializeVersion = 3`. Layer B is dynamic-view-bound; its `_mv` is `useDynamicViewStore.dynamicViewVersion = 7` (the GLOBAL counter, not per-id). If both layers happen to share the same `_mv` value at some moment, OL's URL-based cache wouldn't be busted on subsequent updates if Kinetica returned the same image bytes (rare but technically possible).

**Why it might matter:** `useFilterViewStore.materializeVersion` is per-tableId (`filterViewStore.ts:34`); `useDynamicViewStore.dynamicViewVersion` is a single counter that increments on EVERY store mutation across all dynamic-views (33-CONTEXT.md "dynamicViewVersion semantics"). Mixing them in the same `_mv` URL param risks coincidental value collision across layers from different sources.

**How to avoid:** Per CONTEXT.md "buildWmsParams extension":
- Dynamic-view-bound layers: `_mv=<dynamicViewVersion>` (global counter — value coincidence with filter-view counter is acceptable because OL caches per-URL, and the LAYERS value differs between the two source kinds — `<dynamicViewName>` vs `<filterViewName>` — so cache keys never collide regardless of `_mv` value).
- Filter-view-bound layers: `_mv=<materializeVersion>` (per-tableId — existing behavior).

The LAYERS value being different between the two source kinds (different Kinetica view names) means OL's cache key (full URL) is always distinct. The `_mv` is just a cache-buster for the SAME-LAYERS case. No collision possible.

**Alternative (safer):** Per-dynamic-view materializeVersion in the dynamic-view store entry (mirror filterViewStore's per-tableId counter). CONTEXT.md does NOT spec this; the global `dynamicViewVersion` is the locked choice. Planner can verify this is sufficient via spec.

**Warning signs:** OL renders stale tile after dynamic-view re-materialize. (Hard to repro because LAYERS values differ.)

### Pitfall 6: Renderer status gate fires before dynamic-view store entry exists (race)

**What goes wrong:** Dashboard mounts. AggregatedWidget renders. `useDynamicViewStore.views[dynamicViewId]` is `undefined` because the orchestrator hook hasn't run yet (effect ordering). Renderer reads `dvStatus === undefined` → shows loading skeleton. Orchestrator effect fires → `markPending` writes `status: "pending"` → renderer re-renders → STILL loading skeleton (per the locked render mapping). User sees infinite loading until cascade completes.

**Why it happens:** On initial dashboard open with NO filter applied yet, the filter-view's `materializeVersion` is `0` (or `undefined`) — orchestrator's `if (matVer === undefined || matVer === 0) continue` short-circuit (Pitfall 1's fix) means NO cascade fires. So `dvStatus` stays `undefined` forever and the widget is stuck on loading skeleton.

**How to avoid:** When `dvStatus === undefined` AND `useFilterViewStore.views[sourceTableId]` is also undefined/no-materialize-yet, the renderer should show a DIFFERENT empty state — something like "Apply a filter to load data" — NOT a loading skeleton. CONTEXT.md "Status → render mapping" treats `undefined` and `pending` identically as loading; the planner needs to add a distinction:

- `undefined` + filter-view not yet materialized → empty state "Apply a filter to enable this view" (no spinner)
- `undefined` + filter-view materialized AND orchestrator hasn't fired yet → loading skeleton (legitimate transient state)
- `pending` → loading skeleton

OR: simplify to always show "Apply a filter to enable this view" for `undefined` status (clearer initial-state UX), and only show loading skeleton for `pending`.

**Verified via store contract:** Phase 33 `useDynamicViewStore` entry is created lazily (only on `markPending` / `setView` / `setError`). Until the orchestrator fires, there's no entry. The renderer MUST distinguish "no entry because orchestrator hasn't fired yet (cold-start)" from "no entry because operator just bound to this dv and it's pending."

**Warning signs:** User reports "widget never loads" after opening dashboard with dv-bound widget but no filter applied yet.

### Pitfall 7: Map cache-buster doesn't fire because `useDynamicViewStore.dynamicViewVersion` isn't in MapChartRenderer's Effect 3 dep array

**What goes wrong:** `MapChartRenderer.tsx:920-952` (Effect 3) has dep array `[filterVersion, viewsKey, includedLayers, tables]`. `viewsKey` is a primitive derived from `useFilterViewStore.views`. Phase 35 dv-bound layers need a parallel `dynamicViewsKey` derived from `useDynamicViewStore.views` so Effect 3 re-fires when a layer's dv re-materializes.

**How to avoid:** Add a `dynamicViewsKey` selector to MapChartRenderer (mirror `viewsKey` at `MapChartRenderer.tsx:411-417`):

```typescript
const dynamicViewsKey = useDynamicViewStore((s) =>
  includedLayers
    .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
    .map((l) =>
      `${l.dynamic_view_id}:${s.views[l.dynamic_view_id!]?.viewName ?? ''}:${s.views[l.dynamic_view_id!]?.status ?? ''}`
    )
    .join(",")
);
```

Then add `dynamicViewsKey` to Effect 3's dep array.

**Warning signs:** Map tile doesn't refresh after dynamic-view re-materializes.

### Pitfall 8: ChartConfigPanel's CustomConfigPanel branch (used by map widget) renders ITS OWN Data Source picker

**What goes wrong:** Map widget has `usesDataSource: false` (`definitions/map.ts:26`), so its CustomConfigPanel branch at `ChartConfigPanel.tsx:197-291` skips the Data Source dropdown render (the `hasSources && chartDef.usesDataSource !== false` guard at line 220). Phase 35 must NOT add the three-optgroup picker to the map widget's config panel — map's per-layer source binding lives in `KineticaWmsLayerForm`/`LayersModal` (per-row).

**How to avoid:** The three-optgroup picker extension targets the standard branch at `ChartConfigPanel.tsx:356-386` and the CustomConfigPanel branch at `:222-249`. For the map widget specifically, the `usesDataSource: false` flag already correctly suppresses the picker at line 220 — DO NOT remove that flag.

**Verified via code:** `ChartConfigPanel.tsx:220` exact match: `{hasSources && chartDef.usesDataSource !== false && (` — extending the optgroup count from 2 to 3 inside this conditional preserves the map widget's exclusion automatically.

**Warning signs:** Map widget's config panel suddenly grows a "Data Source" dropdown that shouldn't be there.

## Code Examples

### Example 1: AggregatedWidgetRenderer dynamic-view branch (extends WidgetRenderer.tsx:224-500)

```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:224-500 (existing)
//         + CONTEXT.md §"Renderer integration" verbatim scoped selectors
//         + Pitfall 6 fix (cold-start UX)

const AggregatedWidgetRenderer = ({ widget }: Props) => {
  const cfg = widget.config ?? {};
  const sql = cfg.sql as string | undefined;
  const tableId = cfg.tableId as number | undefined;
  // NEW Phase 35: dynamic-view binding
  const dynamicViewId = cfg.dynamicViewId as number | undefined;

  // ... existing drillDownColumn, drillDownColumnType, tableFilters, filterVersion ...
  // ... existing materializing, clearMaterializingVersion ...

  // EXISTING filterView selector (used when dynamicViewId is undefined OR for the upstream filter-view trigger)
  const fvViewName = useFilterViewStore((s) =>
    tableId !== undefined ? s.views[tableId]?.viewName : undefined
  );
  const fvExpiresAt = useFilterViewStore((s) =>
    tableId !== undefined ? s.views[tableId]?.expiresAt ?? 0 : 0
  );

  // NEW Phase 35: scoped selectors to useDynamicViewStore (PITFALL C-02)
  const dvEntry = useDynamicViewStore((s) =>
    dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined
  );
  const dvStatus = dvEntry?.status;
  const dvViewName = dvEntry?.viewName;
  const dvReason = dvEntry?.reason;
  const dvError = dvEntry?.error;

  // ... existing dashboardId, widgets, targetsByTable, myTarget, spatialFilterVersion ...

  // EXISTING Effect 1 (filter-view materialize trigger) — UNCHANGED.
  // CONTEXT.md lock: "Effect 1 stays unchanged (still fires filter-view materialize)".
  // The filter-view still needs to materialize to provide {view} substitution for the
  // dynamic-view; orchestrator hook (downstream) reads filter-view materializeVersion.

  // ... existing materializeAbortRef, Effect 1 useEffect at line 314 ...

  // EXTENDED Effect 2 (chart-query) — viewName source flip + status gates
  const retryRef = useRef<{ viewName: string | undefined; retried: boolean }>({
    viewName: undefined, retried: false,
  });

  useEffect(() => {
    if (!sql?.trim()) {
      setData([]);
      return;
    }

    // EXISTING filter-view suspend gate (Phase 17-02 / 17-03)
    if (materializing) return;

    // EXISTING LIFE-V13-01 proactive expiry for filter-view
    if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt && tableId !== undefined) {
      useFilterViewStore.getState().clearView(tableId);
      return;
    }

    // NEW Phase 35: status-aware gates BEFORE fromSwap+runSql.
    // Resolve effective viewName: dynamic-view path when dvId set, else filter-view path.
    let effectiveViewName: string | undefined;
    if (dynamicViewId !== undefined) {
      // Pitfall 6 cold-start: when dvStatus undefined AND filter-view hasn't materialized yet,
      // distinguish from "transient before orchestrator fires." See Pitfall 6 above.
      if (dvStatus === undefined || dvStatus === "pending") {
        // Loading skeleton path — return early to short-circuit setData([])
        setData([]);
        setLoading(true);
        setError(null);
        return;
      }
      if (dvStatus === "over_threshold") {
        setData([]);
        setLoading(false);
        setError(null);
        return;  // Renderer returns the empty-state JSX via dvStatus check in the render body
      }
      if (dvStatus === "error") {
        setData([]);
        setLoading(false);
        setError(dvError ?? "Dynamic view materialize failed");
        return;
      }
      // dvStatus === "materialized"
      effectiveViewName = dvViewName;
    } else {
      // Existing filter-view path
      effectiveViewName = fvViewName;
    }

    // EXISTING retry budget reset on viewName change
    if (retryRef.current.viewName !== effectiveViewName) {
      retryRef.current = { viewName: effectiveViewName, retried: false };
    }

    // EXISTING fromSwap + runSql + LIFE-V13-02 reactive retry
    const controller = new AbortController();
    const finalSql = fromSwap(sql, effectiveViewName);
    setLoading(true);
    setError(null);

    const runChartQuery = async (sqlToRun: string): Promise<void> => {
      // ... existing body unchanged ...
    };
    runChartQuery(finalSql).finally(() => setLoading(false));
    return () => controller.abort();
    // PITFALL S-02: new deps — dynamicViewId (primitive) + dvStatus + dvViewName.
    // dvEntry NOT in deps (reference unstable on every mutation); status/viewName primitives are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, filterVersion, fvViewName, fvExpiresAt, clearMaterializingVersion,
      dynamicViewId, dvStatus, dvViewName]);

  // ... existing render gates ...

  // NEW Phase 35: status-aware render gates BEFORE existing data.length check
  if (dynamicViewId !== undefined) {
    if (dvStatus === undefined || dvStatus === "pending") {
      return <div className="widget-placeholder"><span>Loading...</span></div>;
    }
    if (dvStatus === "over_threshold") {
      return (
        <div className="widget-placeholder widget-over-threshold">
          <span>Too much data — narrow your filters to enable this view.</span>
        </div>
      );
    }
    if (dvStatus === "error") {
      return (
        <div className="widget-placeholder widget-error">
          <span>{dvError ?? "Dynamic view error"}</span>
          <button onClick={() => /* call orchestrator's retry(dynamicViewId) */}>Retry</button>
        </div>
      );
    }
    // dvStatus === "materialized" → fall through to existing render
  }

  // Orphan detection (separate from status — checks dashboard list)
  // dashboardDynamicViewsList: DynamicViewRow[] — sourced from DashboardContext extension or prop.
  if (dynamicViewId !== undefined && dvEntry === undefined &&
      dashboardDynamicViewsList && !dashboardDynamicViewsList.some((dv) => dv.id === dynamicViewId)) {
    return (
      <div className="widget-placeholder widget-orphan-dynamic-view">
        <span>This dynamic view was deleted. Reconfigure the widget.</span>
      </div>
    );
  }

  // ... existing render switch ...
};
```

### Example 2: buildWmsParams precedence extension (extends wmsUrlBuilder.ts:156-272)

```typescript
// Source: kinetica_bi/src/lib/wmsUrlBuilder.ts:156-272 (existing 2-case)
//         + CONTEXT.md §"buildWmsParams extension" 4-case precedence

// Phase 35 NEW: per-layer dynamic-view entry input (caller computes from useDynamicViewStore)
export type DynamicViewEntryInput = {
  status: "materialized" | "over_threshold" | "pending" | "error";
  viewName: string;
};

// Phase 35: extended signature — caller passes per-layer dvEntry and dvVersion.
// Caller is MapChartRenderer Effects 2+3 at lines 776-952.
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  // NEW Phase 35 (optional for backward-compat with existing callers that don't bind dynamic-views):
  dynamicViewEntry?: DynamicViewEntryInput,
  dynamicViewVersion?: number,
): Record<string, string> | null {  // CHANGED RETURN: null when layer should be SKIPPED
  const params: Record<string, string> = { /* ... existing ... */ };

  // NEW Phase 35: dynamic-view precedence at the TOP of the LAYERS branch.
  // Precedence 1: layer has dv binding AND materialized → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>.
  // Precedence 2: layer has dv binding AND non-materialized → SKIP (return null).
  // Caller MUST check the dv binding from layer.dynamic_view_id (DashboardLayerDto top-level field).
  if (dynamicViewEntry !== undefined) {
    if (dynamicViewEntry.status === "materialized") {
      params.LAYERS = dynamicViewEntry.viewName;
      if (dynamicViewVersion !== undefined) {
        params._mv = String(dynamicViewVersion);
      }
      // Spatial branch + render branch still apply (caller passes the same config).
      // Skip the existing filter-view LAYERS resolution.
    } else {
      // Pending / over_threshold / error → omit this layer entirely.
      return null;
    }
  } else {
    // EXISTING Phase 16 precedence 3 + 4:
    if (materializeVersion !== undefined) {
      params._mv = String(materializeVersion);
    }
    if (config.tableRef) {
      params.LAYERS = config.tableRef;
    } else if (config.layerName) {
      params.LAYERS = config.layerName;
    }
  }

  // ... existing spatial-mode + render-mode branches unchanged ...

  return params;
}
```

**Caller (MapChartRenderer Effect 2 at line 833) extension:**

```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx:826-834 (existing)
//         + Pitfall 7 dynamicViewsKey selector
//         + Phase 35 per-layer dv lookup

// New per-layer dv lookup at effect-fire time (PITFALL C-02 imperative snapshot):
const dvEntry = layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
  ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
  : undefined;
const dvVersion = layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
  ? useDynamicViewStore.getState().dynamicViewVersion
  : undefined;

// Existing filter-view lookup (UNCHANGED for non-dv layers)
const fvEntry = useFilterViewStore.getState().views[tableId];
const fvExpired = isViewExpired(fvEntry);
const fvViewName = !fvExpired ? fvEntry?.viewName : undefined;
const fvMaterializeVersion = !fvExpired ? fvEntry?.materializeVersion : undefined;

const wmsConfigInput = { ...cfg, tableId, tableRef: fvViewName || rawTableRef } as MapWidgetConfig;
const wmsParams = buildWmsParams(
  wmsConfigInput,
  fvMaterializeVersion,
  // NEW Phase 35 args:
  dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined,
  dvVersion,
);

// Layer skipping (precedence 2 — null return from buildWmsParams)
if (wmsParams === null) {
  // Mark this layer for omit from the visible stack.
  // OPTION A (simpler): set the layer's visible flag transiently (still requires patching the source).
  // OPTION B (cleaner): skip the addLayer / updateParams call entirely; track in a separate ref.
  // Planner decides — locked behavior is "omit from visible stack."
  continue;  // skip this layer's add/update
}
```

### Example 3: KineticaWmsLayerForm "Data Source" picker section

```tsx
// Source: kinetica_bi/src/components/LayersModal.tsx:293-364 (existing TABLE picker)
//         + CONTEXT.md §"LayersModal UI"

// Inside the LayersModal right pane, ABOVE the existing TABLE picker (line 296-319):
<div className="config-group">
  <div className="config-group-label">DATA SOURCE</div>
  <select
    className="ds-select"
    aria-label="Layer data source"
    value={
      selectedLayer.dynamic_view_id !== null && selectedLayer.dynamic_view_id !== undefined
        ? `dv:${selectedLayer.dynamic_view_id}`
        : String(selectedLayer.table_id)
    }
    onChange={(e) => {
      const v = e.target.value;
      if (v.startsWith("dv:")) {
        const dvId = parseInt(v.slice(3), 10);
        const dv = dynamicViews.find((d) => d.id === dvId);
        if (!dv) return;
        // Mutual exclusion: set dynamic_view_id, clear table_id (or keep tableId = sourceTableId? — CONTEXT lock unclear).
        // CONTEXT.md "LayersModal UI" says "CLEARS table_id." So pass null on the wire.
        // BUT db.ts:87 says table_id is NOT NULL. So planner must EITHER:
        //   (a) keep table_id = sourceTableId (mirrors widget config locked behavior)
        //   (b) relax the NOT NULL constraint on table_id
        // RECOMMEND (a): mirrors widget config; no schema change; existing filter-bar + drill code paths preserved.
        onPatch(selectedLayer.id, { dynamic_view_id: dvId, table_id: dv.source_table_id });
      } else {
        const tableId = parseInt(v, 10);
        // Clear dynamic_view_id when picking a plain table.
        handleTableChange(tableId);  // existing handler; ALSO patches dynamic_view_id: null
      }
    }}
  >
    {/* Plain table options */}
    <optgroup label="Tables">
      {!associatedTables.find((t) => t.id === selectedLayer.table_id) && (
        <option value={String(selectedLayer.table_id)}>(table removed)</option>
      )}
      {associatedTables.map((t) => (
        <option key={`t-${t.id}`} value={String(t.id)}>
          {t.schema ? `${t.schema}.${t.name}` : t.name}
        </option>
      ))}
    </optgroup>
    {/* Dynamic Views optgroup — hidden when empty */}
    {dynamicViews && dynamicViews.length > 0 && (
      <optgroup label="Dynamic Views">
        {dynamicViews.map((dv) => (
          <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>{dv.name}</option>
        ))}
      </optgroup>
    )}
  </select>
</div>
```

**LOCKED RECOMMENDATION FOR PLANNER (CRITICAL):** The existing `db.ts:87` schema has `table_id INTEGER NOT NULL`. CONTEXT.md says "Selecting a dynamic-view writes `dynamic_view_id` to the layer's PATCH body and CLEARS `table_id`" — this CONFLICTS with the NOT NULL constraint. **Resolution:** Keep `table_id = dv.source_table_id` (mirrors widget config pattern). The "mutual exclusion at config-pick time" semantic still holds: a layer is EITHER table-bound (rendering raw `schema.table` via fv-swap) OR dv-bound (rendering `dvViewName` per buildWmsParams precedence). When `dynamic_view_id` is set, the buildWmsParams precedence 1 always wins regardless of `table_id`. So `table_id` becomes the "source table for filter-bar / drill-down" reference, exactly mirroring the widget config pattern.

### Example 4: Server PATCH route extension (extends index.ts:583-594)

```typescript
// Source: kinetica_bi/server/src/index.ts:583-594 (existing PATCH route)
//         + Phase 35: extend body Pick<>

app.patch("/api/dashboards/:id/layers/:layerId", (req, res) => {
  const layerId = Number(req.params.layerId);
  const body = req.body as Partial<Pick<DashboardLayer,
    "table_id" | "position" | "config" |
    "info_enabled" | "info_columns" | "info_template" |
    "dynamic_view_id"  // NEW Phase 35 — pass-through forwarding mirrors v1.4 info_* pattern
  >>;
  const updated = updateDashboardLayer(layerId, body);
  if (!updated) return res.status(404).json({ error: "Layer not found." });
  return res.json(updated);
});
```

### Example 5: Server migration spec extension (extends db.smoke.spec.ts:246-336)

```typescript
// Source: kinetica_bi/server/tests/db.smoke.spec.ts:246-336 (existing v1.3 → v1.4 migration test)
//         + Phase 35: v1.5 → v1.6 migration test for dynamic_view_id

it("v1.5 → v1.6 migration: createDb adds dynamic_view_id to dashboard_layers and preserves pre-existing rows (PITFALLS M-02)", async () => {
  const Database = (await import("better-sqlite3")).default;
  const inst = new Database(":memory:");
  // Build a v1.5-shape dashboard_layers (no dynamic_view_id column)
  inst.exec(`
    CREATE TABLE dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE dashboard_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      table_id INTEGER NOT NULL,
      layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
      position INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      info_enabled INTEGER NOT NULL DEFAULT 1,
      info_columns TEXT,
      info_template TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  inst.prepare("INSERT INTO dashboards (id, name) VALUES (1, 'test')").run();
  inst.prepare(
    "INSERT INTO dashboard_layers (dashboard_id, table_id, layer_type, position, config) VALUES (?, ?, ?, ?, ?)"
  ).run(1, 42, "KineticaWms", 0, '{"foo":"bar"}');

  // Pre-migration: no dynamic_view_id
  const preCols = inst.prepare("PRAGMA table_info(dashboard_layers)").all().map((r: { name: string }) => r.name);
  expect(preCols).not.toContain("dynamic_view_id");

  // Apply the v1.5→v1.6 migration block (verbatim duplicate of db.ts createDb addition)
  const cols = inst.prepare("PRAGMA table_info(dashboard_layers)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("dynamic_view_id")) {
    inst.exec("ALTER TABLE dashboard_layers ADD COLUMN dynamic_view_id INTEGER");
  }

  // Post-migration: dynamic_view_id present
  const postCols = inst.prepare("PRAGMA table_info(dashboard_layers)").all().map((r: { name: string }) => r.name);
  expect(postCols).toContain("dynamic_view_id");

  // Pre-existing row still selectable + dynamic_view_id is NULL
  const row = inst.prepare("SELECT dynamic_view_id, table_id FROM dashboard_layers WHERE id = ?").get(1) as {
    dynamic_view_id: number | null;
    table_id: number;
  };
  expect(row.dynamic_view_id).toBeNull();
  expect(row.table_id).toBe(42);  // preserved

  inst.close();
});
```

### Example 6: Orchestrator hook mount in DashboardOpen

```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx:359-450 (existing DashboardOpen body)
//         + Phase 35: hook mount

const DashboardOpen = ({ dashboard, onBack }: { dashboard: DashboardDto; onBack: () => void }) => {
  // ... existing tablesQuery, widgetsQuery, viewsQuery, state declarations ...

  // NEW Phase 35: orchestrator hook — mounted at DashboardOpen scope.
  // Returns the dashboard's dynamic-views list + a retry function for renderers.
  const { dynamicViews, retry: retryDynamicView } = useDynamicViewMaterializeChain(dashboard.id);

  // ... existing useEffects (lifecycle, layer loading, etc.) ...

  return (
    <div className="dashboard-open">
      {/* ... existing header, toolbar, filter-bar, widget grid ... */}

      {/* WidgetConfigModal — pass dynamicViews through to ChartConfigPanel */}
      {configuringWidget && (
        <WidgetConfigModal
          widget={configuringWidget}
          tables={associatedTables}
          views={views}
          dynamicViews={dynamicViews}  // NEW Phase 35
          onSave={(chartConfig) => handleSaveConfig(configuringWidget, chartConfig)}
          onClose={() => setConfiguringWidget(null)}
        />
      )}

      {/* LayersModal — also pass dynamicViews through for per-layer picker */}
      {showLayersModal && (
        <LayersModal
          layers={layers}
          associatedTables={associatedTables}
          dynamicViews={dynamicViews}  // NEW Phase 35
          onClose={handleLayersModalClose}
          onCreate={handleLayerCreate}
          onDelete={handleLayerDelete}
          onDuplicate={handleLayerDuplicate}
          onPatch={handleLayerPatch}
          onReorder={handleLayerReorder}
        />
      )}

      {/* DynamicViewsModal — UNCHANGED in Phase 35 */}
      {showDynamicViewsModal && (
        <DynamicViewsModal
          dashboardId={dashboard.id}
          associatedTables={associatedTables}
          onClose={() => setShowDynamicViewsModal(false)}
        />
      )}
    </div>
  );
};
```

### Example 7: DashboardContext extension for orphan-detection

The renderer needs access to the dashboard's dynamic-views list for orphan-detection (CONTEXT.md "Orphan detection"). Two options:

**OPTION A (RECOMMENDED — extend DashboardContext):**

```typescript
// Source: kinetica_bi/src/components/DashboardContext.tsx (existing — extended by Phase 30 with widgets)
// Phase 35: add dynamicViews

export type DashboardContextValue = {
  dashboardId: number;
  widgets: WidgetDto[];
  dynamicViews: DynamicViewRow[];  // NEW Phase 35
};
```

Then renderers read via:

```typescript
const { dashboardId, widgets, dynamicViews } = useDashboardContext();
// Orphan check:
const isOrphan = dynamicViewId !== undefined &&
                 dvEntry === undefined &&
                 !dynamicViews.some((dv) => dv.id === dynamicViewId);
```

**OPTION B:** Pass `dynamicViews` as a direct prop to each renderer. Cleaner for tests but adds prop-drilling.

**Recommend A:** Phase 30 already established the pattern of adding `widgets` to DashboardContext for cross-renderer access (`DashboardContext.spec.tsx` exists for verification). Adding `dynamicViews` follows the same pattern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Materialize trigger lives inside AggregatedWidgetRenderer (v1.3) | Dashboard-scope orchestrator hook for dynamic-views (Phase 35) | 2026-05-15 | Solves TD-V15-MAP-ONLY-TRIGGER for dynamic-views; dashboards with only map widgets bound to dvs still get the cascade |
| `useState` for dynamic-view list inside DynamicViewsModal (Phase 34) | Lifted to DashboardOpen via `useDynamicViewMaterializeChain` hook (Phase 35) | 2026-05-15 | Single source of truth for: orchestrator, ChartConfigPanel, LayersModal, renderers (orphan detection) |
| `dashboard_layers.config.tableId` (Phase 11) | `dashboard_layers.table_id` top-level column (Phase 12) — Phase 35 adds `dynamic_view_id` as a peer | 2026-05-15 | Per-layer source binding is a first-class SQLite column, not JSON-blob field. Consistent with Phase 12 architecture. |
| Filter-view-only LAYERS-swap in buildWmsParams (Phase 16) | Filter-view OR dynamic-view LAYERS-swap with precedence (Phase 35) | 2026-05-15 | 4-case precedence: dv-materialized → filter-view → bare-table → no-layer-skip |
| `kind: "warning"` toast (CONTEXT.md draft) | `kind: "info"` for non-error outcomes (Phase 34 RESEARCH lock — `toast.ts:3`) | 2026-05-14 | ToastKind union enforced; no "warning" exists |

**Deprecated/outdated:**

- **In CONTEXT.md, the suggestion to use `useDynamicViewListStore` as a Zustand slice** — locked OUT in favor of local DashboardOpen state lifted via the orchestrator hook (CONTEXT.md "option (c) overkill for Phase 35; defer if needed").
- **CONTEXT.md "could call DELETE on filter-view materialize" speculative note** — does NOT apply to Phase 35. Filter-view DELETE is the existing `dropFilterView` helper; Phase 35 dv-store uses `dropDynamicView` (Phase 33 endpoint) — different primitives.

## Open Questions

1. **Per-layer over-threshold overlay vs per-layer badge — operator UX preference**
   - What we know: CONTEXT.md says "Per-layer: when at least one bound dynamic-view is over-threshold or error, render `MapFilteringBadge`-style overlay: 'Some layers over threshold' (or per-layer toast/badge — Claude's discretion within the spirit of 'operator gets visual feedback without silent layer disappearance')."
   - What's unclear: Whether a single dashboard-level "N layers over threshold" overlay (mirrors `MapFilteringBadge` at `MapFilteringBadge.tsx:24-46` aggregated semantics) OR per-layer badges in LayersModal (already a possible surface).
   - Recommendation: Single map-level overlay surfacing inside the map widget chrome (mirrors `MapFilteringBadge`). Per-layer detail is in LayersModal — operator can drill in if they need to know which layer.

2. **Effective viewName resolution order in renderer when BOTH `tableId` AND `dynamicViewId` are set with filter-view materializing concurrently**
   - What we know: CONTEXT.md locks dynamicViewId precedence. AggregatedWidget Effect 1 still fires filter-view materialize (so filter-view materializeVersion bumps), orchestrator detects bump and fires dv materialize, dv setView triggers Effect 2 re-fire with new dvViewName.
   - What's unclear: Is there a transient state where filter-view setView has fired but dv setView hasn't yet? In that state, Effect 2's dep array changes via `fvViewName` increment (existing dep) — does it run with stale dvViewName?
   - Recommendation: Add `dvStatus === "pending"` to the suspend-gate (mirrors `materializing` gate at line 400) — if dv is pending, suspend chart query (don't fire with stale dvViewName). Confirmed safe by the locked `pending` → loading skeleton render mapping.

3. **`updateLayer` `table_id` NOT NULL constraint when dv-bound**
   - What we know: Schema has `table_id INTEGER NOT NULL` (`db.ts:87`); CONTEXT.md says "Selecting a dynamic-view writes `dynamic_view_id` to the layer's PATCH body and CLEARS `table_id`."
   - What's unclear: Whether CLEARS means literally `null` (which violates NOT NULL) or "set to source-table_id" (which doesn't actually clear).
   - Recommendation (LOCKED in Example 3 above): Keep `table_id = dv.source_table_id` when dv-binding a layer. Mirrors widget config pattern, no schema migration needed, all existing code paths (drill-down, filter-bar) continue to work. The "mutual exclusion" semantic is enforced at the buildWmsParams precedence level, not at the schema level.

4. **Retry-link inside renderer error state — orchestrator-exposed function vs renderer-local call**
   - What we know: CONTEXT.md Claude's Discretion: "Exact Retry-link implementation in error state — could call the orchestrator hook's exposed retry method, or fire markPending+materializeDynamicView directly from the renderer."
   - Recommendation: Orchestrator returns `retry(dynamicViewId)` (see hook skeleton). Renderer imports the hook return via context or prop; retry path is centralized. Avoids duplicating the `markPending → materializeDynamicView → setView/setError` chain.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — section skipped.

## Sources

### Primary (HIGH confidence — verbatim source code citations)

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:224-500` — AggregatedWidgetRenderer Effect 1 (filter-view materialize trigger) + Effect 2 (fromSwap + runSql + LIFE-V13-01/02 TTL recovery + Phase 17-02 suspend gate). Phase 35 extends Effect 2's gates and viewName source.
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:1107-1342` — RecordsTableRenderer Effect 1 (Phase 30 spatial materialize trigger; mirrors AggregatedWidget pattern) + page-fetch Effect at 1264 + count-fetch Effect at 1316 — three sites that consume `viewName`. Phase 35 extends all three.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:776-952` — Effect 2 (layer-stack reconciliation, source/listener attach at 836-879) + Effect 3 (per-layer filter subscription via `updateParams` at 943-948) + viewsKey selector at 411-417. Phase 35 extends Effect 2 source construction + Effect 3 with parallel `dynamicViewsKey` and dv lookup; adds layer-skip path for non-materialized dvs.
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx:70-86, 217-249, 356-386` — Existing two-optgroup dataSourceOptions builder + JSX in both CustomConfigPanel and standard branches. Phase 35 extends to three-optgroup; `allColumns` derivation at lines 101-104 + numericColumns/drillDownColumns at 122-133 flip source to `columns_json` when dynamic-view selected.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:1-200, 1046-1131` — Form structure + Info Popup section (Phase 22) as model. Phase 35 adds a parallel "Data Source" section above the existing table picker (which lives in `LayersModal.tsx:293-364`).
- `kinetica_bi/src/components/LayersModal.tsx:293-364` — Existing TABLE picker location. Phase 35 EITHER replaces with three-source picker OR adds a parallel "DATA SOURCE" picker ABOVE.
- `kinetica_bi/src/components/DashboardsPage.tsx:359-450, 696-715, 942-974` — DashboardOpen body, action-bar (with existing Dynamic Views button from Phase 34 at line 710), WidgetConfigModal/LayersModal/DynamicViewsModal mount points. Phase 35 mounts orchestrator hook here, threads `dynamicViews` through props.
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:156-272` — `buildWmsParams` existing 2-case (filter-view → bare-table). Phase 35 extends to 4-case with dynamic-view precedence.
- `kinetica_bi/src/lib/fromSwap.ts:1-24` — FROM-swap helper (reused unchanged).
- `kinetica_bi/src/store/dynamicViewStore.ts:1-155` — Phase 33 store: shape, actions, version semantics, scoped selector contract.
- `kinetica_bi/src/store/filterViewStore.ts:1-129` — Phase 14 store: setView at 59-73 increments materializeVersion; markMaterializing at 89-96 writes empty-string placeholder.
- `kinetica_bi/src/store/toast.ts:1-35` — `ToastKind = "permission" | "info" | "error"`. No "warning".
- `kinetica_bi/src/api/client.ts:610-657, 770-927` — `materializeFilter`, `dropFilterView` (v1.3 templates), `MaterializeDynamicViewResponse` discriminated union, `listDynamicViews`, `materializeDynamicView`, `dropDynamicView`, `DynamicViewRow`, `DashboardLayerDto` (Phase 12 + v1.4 extensions; Phase 35 adds `dynamic_view_id`).
- `kinetica_bi/src/lib/dynamicViewName.ts:1-46` — `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` — Phase 33 deterministic helper. Orchestrator uses this.
- `kinetica_bi/src/store/auth.ts:1-71` — `useAuthStore.user.username` source.
- `kinetica_bi/src/components/DynamicViewsModal.tsx:280-516` — Phase 34 Save flow: shows the canonical markPending → materializeDynamicView → setView/setError chain that the Phase 35 orchestrator mirrors for cascades.
- `kinetica_bi/server/src/db.ts:80-115, 149-211, 436-529` — Schema DDL + PRAGMA migration block (v1.4 Phase 19 pattern at 149-170 — Phase 35 mirrors) + `mapDashboardLayer` projection + `updateDashboardLayer` with `"key" in attrs` discriminant (lines 470-493).
- `kinetica_bi/server/src/index.ts:540-601` — Layer CRUD routes including PATCH at 583-594. Phase 35 extends Pick<> body to include `dynamic_view_id`.
- `kinetica_bi/server/src/index.ts:999-1216` — Dynamic-view materialize endpoint (Phase 32 + 33) — already produces the 3-branch response that the orchestrator consumes.
- `kinetica_bi/server/src/types.ts:47-78` — `DashboardLayer` type (Phase 35 extends with `dynamic_view_id`); `DashboardDynamicView` (Phase 32 — used for FK reference).
- `kinetica_bi/server/tests/db.smoke.spec.ts:246-336` — v1.3→v1.4 migration test pattern. Phase 35 mirrors verbatim for v1.5→v1.6 dynamic_view_id addition.
- `.planning/phases/19-config-schema/19-01-schema-migration-PLAN.md` — Documented PRAGMA-guarded ALTER pattern Phase 35 mirrors.
- `.planning/phases/33-dynamic-view-store/33-CONTEXT.md` — Phase 33 store contract, version semantics, action semantics.
- `.planning/phases/34-dynamic-view-ui/34-CONTEXT.md` — Phase 34 modal flow + toast taxonomy lock (`"info" | "error"` only).
- `.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md` — Endpoint contracts (`materialize`, `preview`), columns_json semantics.
- `.planning/phases/34-dynamic-view-ui/34-RESEARCH.md` — Detailed pitfalls including AbortController separation (Pitfall 6), toast dedup (Pitfall 5), Zustand selector scoping (Pitfall 4).
- `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md` — Background context (not load-bearing for Phase 35 — Phase 35 inherits patterns from in-tree code).
- `.planning/STATE.md` — Phase 32/33/34 lock annotations.

### Secondary (MEDIUM confidence — derived from primary, cross-verified)

- Pitfall 5 (WMS URL cache collision) — derived from `wmsUrlBuilder.ts:170-184` + `dynamicViewStore.ts:81` global counter semantics. Real-world impact is bounded by LAYERS value distinctness; flagged as low-risk.
- Pitfall 6 (cold-start UX) — derived from Phase 33 store contract (entries created lazily on markPending/setView) + locked render mapping (`undefined` → loading skeleton). Recommended distinction NOT in CONTEXT.md but flagged as a UX hazard the planner should address.

### Tertiary (LOW confidence)

- None — all findings are sourced from primary in-tree code or upstream phase CONTEXT files.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in repo at known versions; no new adds
- Architecture patterns: HIGH — every pattern has a direct template (v1.3 sole-trigger, v1.4 Phase 19 migration, v1.5 spatialFilterStore, Phase 33 store, Phase 34 materialize chain in DynamicViewsModal Save)
- Pitfalls: HIGH for #1-#5, #7-#8 (verified via source code traces); MEDIUM for #6 (cold-start UX — derived recommendation; planner should validate via spec)
- Renderer integration: HIGH — direct line-number references in WidgetRenderer.tsx, MapChartRenderer.tsx
- Schema migration: HIGH — v1.4 Phase 19 pattern is byte-for-byte mirror at `db.ts:149-170` + `db.smoke.spec.ts:246-336`
- Orchestrator hook: HIGH for skeleton structure (per-id Map AbortController pattern is well-established); MEDIUM for the exact gate `matVer !== undefined && matVer > 0` (Pitfall 1 fix — recommended; planner should spec-validate)

**Research date:** 2026-05-15
**Valid until:** 30 days (stable codebase patterns; only risk is if Phase 32 server endpoint contracts change before Phase 35 implementation begins)
