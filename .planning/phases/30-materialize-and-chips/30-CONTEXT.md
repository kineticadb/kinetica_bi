# Phase 30: materialize-and-chips - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire `useSpatialFilterStore` changes into the existing v1.3 materialize pipeline and surface drawn shapes as chips in `FilterBar`. After this phase, drawing a shape on any map triggers a server materialize that combines the spatial WHERE (Phase 26) with any column filters, the resulting view name flows through `useFilterViewStore` and `_mv` cache-buster, and tiles re-render with spatially-filtered data — dashboard tile filtering becomes live end-to-end.

This phase does NOT change:
- The single-materialize-trigger invariant (AggregatedWidgetRenderer remains the SOLE trigger; MapChartRenderer is a pure consumer)
- The server `composeWhereClause` contract (Phase 26 ships unchanged)
- The `useSpatialFilterStore` action set (Phase 27 ships unchanged)
- The `SpatialTarget` shape on map widget configs (Phase 28 ships unchanged)

It DOES change:
- `MaterializeFilterArgs` over the wire (extends with optional `spatialFilters` + `spatialTarget`)
- `AggregatedWidgetRenderer` Effect 1 (5th dep: `spatialFilterVersion`; payload extension)
- `FilterBar` JSX inside `DashboardsPage.tsx` (spatial chips inside each targeted table row)
- `DashboardContext` (extended to expose `widgets: WidgetDto[]` alongside `dashboardId`)
- `lib/spatialTargets.ts` (new pure helper `aggregateSpatialTargetsByTable`)

</domain>

<decisions>
## Implementation Decisions

### SpatialTarget resolution

- **Aggregation helper is pure, lives in `lib/spatialTargets.ts`.** Sibling to existing `getSpatialTargets` / `isSpatialTargetEligible`. Signature:
  ```ts
  export function aggregateSpatialTargetsByTable(
    widgets: WidgetDto[]
  ): Map<number, SpatialTarget>
  ```
  Implementation: iterate widgets sorted by `widget.id` ascending; for each map widget, call `getSpatialTargets(w).filter(isSpatialTargetEligible)`; first eligible target per `tableId` wins (subsequent duplicates are skipped). WKB targets are filtered out by `isSpatialTargetEligible` so they cannot reach the wire.
- **Widget id ascending order is the canonical first-eligible rule.** Deterministic across renders; stable with the SQLite-assigned ids; survives grid reorders. Document explicitly: "If two map widgets target the same table with different modes/columns, the widget with the lower `id` (older) wins."
- **AggregatedWidgetRenderer reads widgets via DashboardContext.** `DashboardContext.tsx` is extended to expose `widgets: WidgetDto[]` alongside `dashboardId`. The provider (in `DashboardsPage.tsx`) passes the already-loaded widgets array. No prop-drilling, no new store.
- **AggregatedWidgetRenderer memoizes the aggregation:**
  ```ts
  const { dashboardId, widgets } = useDashboardContext();
  const targetsByTable = useMemo(
    () => aggregateSpatialTargetsByTable(widgets),
    [widgets],
  );
  const myTarget = tableId !== undefined
    ? targetsByTable.get(tableId)
    : undefined;
  ```
- **`spatialFilterVersion` is the 5th Effect 1 dep.** Add `spatialFilterVersion` from `useSpatialFilterStore` directly to the existing dep array alongside `[sql, filterVersion, dashboardId, tableId]`. Matches v1.3 PITFALL S-02 primitive-dep pattern (counter, not array reference). No combined-version derivation.
- **Test seam:** specs that wrap in `<DashboardContextProvider>` must now also supply `widgets={[]}` (or a fixture array). Update `WidgetRenderer.spec.tsx`, `MapChartRenderer.spec.tsx`, and any other spec that mounts AggregatedWidgetRenderer or its descendants.

### Materialize payload contract

- **Client `materializeFilter` always includes both column AND spatial fields when both states exist.** Server `composeWhereClause` (Phase 26) handles all four cases (col-only, spatial-only, both, neither). Client does not skip empty fields; let the server compose.
- **Payload shape:**
  ```ts
  type MaterializeFilterArgs = {
    dashboardId: number;
    tableId: number;
    filters: ColumnFilter[];
    spatialFilters?: SpatialFilter[];   // NEW
    spatialTarget?: SpatialTarget;       // NEW
  };
  ```
- **When shapes exist but no eligible target for THIS table → omit spatial fields.** AggregatedWidgetRenderer for table X falls through to the v1.3 column-only materialize path. If column filters are ALSO empty, the existing DROP branch fires (Phase 15 lock preserved). Net effect: table X behaves as if no shapes were drawn.
- **WKB is gated client-side via `isSpatialTargetEligible`.** Because `aggregateSpatialTargetsByTable` filters via this predicate, `myTarget` can never be a WKB target by construction. Server's HTTP 501 response (Phase 26 + v1.4 mirror) remains as defense-in-depth — never reached during normal operation.
- **`Shape → SpatialFilter` projection happens at the AggregatedWidgetRenderer boundary.** The store keeps full `Shape` records (id, type, label, wkt, measurement, createdAt). The server's `SpatialFilter` shape is `{ id: string; wkt: string }` only (verified at `kinetica_bi/server/src/lib/spatialWhereClause.ts:63-66` — server keeps `id` as an audit-log breadcrumb, ignores `type`). Inside Effect 1, project before sending:
  ```ts
  const spatialFilters = shapes.map(s => ({
    id: s.id,
    wkt: s.wkt,
  }));
  ```
  Keeps the store UI-rich (type/label/measurement remain client-only for chip rendering) while honoring server byte-parity contract from Phase 26.

### FilterBar chip placement

- **Spatial chips render INSIDE each targeted table row.** For each table that has an eligible spatial target, render the table's column chips followed by spatial chips for every shape that resolves to that table via `targetsByTable`. A shape that filters two tables shows up twice — once in each row. Mirrors the per-table mental model of the existing FilterBar.
- **FilterBar lives inline in `DashboardsPage.tsx`** (no extracted FilterBar component). Phase 30 extends the existing JSX block (lines ~691-758) — does NOT extract a new component. Same `tableIdsWithFilters` set discovery, extended to include any tableId in `targetsByTable` whose shapes are non-empty.
- **Single-line chip style matches existing `.filter-bar-chip`.** Text format from ROADMAP success criteria #2 locked verbatim:
  - `Bbox 1 (5km × 3km)`
  - `Circle 1 (2.5 km)`
  - `Lasso 1 (12.4 km²)`
  
  Reuses `.filter-bar-chip` + `.filter-bar-chip-dismiss` CSS classes; no new chip variant. No icon prefix, no two-tier label, no muted secondary text.
- **Chip × is immediate, no toast, no confirmation.** Matches column-chip × behavior and the Phase 29 Trash-button "immediate, no confirmation" lock. On click: `useSpatialFilterStore.getState().removeShape(shape.id)` → `spatialFilterVersion` increments → Effect 1 re-fires → materialize updates.
- **Per-table "Clear all" button removes column filters AND any shape that targets this table.** Semantics: every shape whose `targetsByTable` mapping includes the current tableId is removed from `useSpatialFilterStore` entirely. Multi-target shapes are nuked globally (their chips disappear from other table rows too). User explicitly accepted this risk over the "exclusively-targets-X" alternative — simpler mental model: "Clear all means this row is empty afterward."

### Orphan shape UX

- **Drawing always succeeds, regardless of target config.** If no map widget has an eligible target for any table, the shape lands in `useSpatialFilterStore`, renders on every map's Vector overlay (Phase 29 cross-map visibility), but produces no chip and triggers no materialize side effect for any table.
- **Retroactive eligibility fires on the NEXT materialize trigger.** When the user later adds an eligible target (via a map widget's MapConfigPanel), the `widgets` array changes → `targetsByTable` memo recomputes → `myTarget` flips from `undefined` to `SpatialTarget`. Effect 1's deps don't change, so it doesn't re-fire on the target add alone. The next mutation that bumps `filterVersion` or `spatialFilterVersion` (e.g., user draws another shape, removes a chip, edits a filter) will then materialize with the now-eligible target. The user explicitly accepted this semantic — adding a target is itself a user action, and they typically continue interacting.
- **Symmetric for target removal:** when an admin/user removes the last eligible target for a table, any shape that was filtering it stays in the store (still rendered on the overlay), but the chip vanishes from FilterBar since `targetsByTable` no longer contains that tableId. No auto-clear.

### Test surface

- **`spatialTargets.ts` spec:** extend with unit tests for `aggregateSpatialTargetsByTable` — empty widgets, no map widgets, one map with one target, multiple maps with same tableId (lower id wins), WKB skip, incomplete target skip.
- **`WidgetRenderer.spec.tsx`:** wrap AggregatedWidgetRenderer mounts in `<DashboardContextProvider dashboardId={N} widgets={W}>`. Add cases: shape exists + no target (column-only payload), shape + eligible target (combined payload), shape + target removed mid-flight, `spatialFilterVersion` dep triggers re-fire.
- **`DashboardsPage.spec.tsx` (or new sibling):** spatial chips render inside targeted table rows; chip × calls `removeShape`; per-table "Clear all" removes shapes whose targets include the tableId.
- **`client.spec.ts`:** `materializeFilter` sends extended payload byte-for-byte (Phase 26 server contract parity).

### Claude's Discretion

- Exact memo invalidation strategy (likely `useMemo` keyed on widgets reference is sufficient; if reference churn proves problematic, switch to a stable hash like `widgets.length + lastUpdatedAt sum`).
- React key strategy for spatial chips (likely `shape.id`, which is the `crypto.randomUUID()` from Phase 27).
- Whether to add an `aria-label` like `Remove spatial filter ${label}` to the chip × (matches the existing column-chip pattern; planner can decide exact wording).
- CSS additions for chip spacing within the chips row when mixed types appear (likely no change needed — existing `.filter-bar-chips` flex layout handles it).
- Whether the projection from `Shape → SpatialFilter` lives inline in Effect 1 or as a tiny helper. No correctness implication; planner picks based on readability and test ergonomics.

</decisions>

<specifics>
## Specific Ideas

- The orphan-shape UX explicitly preserves "drawing the tool always works" — the draw toolbar is never gated by config state. This matches the Phase 29 ergonomic of "Pan and Info modes never reject input."
- Per-table "Clear all" intentionally has dashboard-wide side effects when shapes are multi-target. The user reasoned: "Clear all of a row means this row should be empty afterward — the only way to achieve that with a multi-target shape is to remove the shape globally." The per-map toolbar Trash button is the same dashboard-scoped operation (DRAW-V15-01).
- Widget-id-ascending as the conflict tiebreaker is intentionally insensitive to grid reorders — moving a widget shouldn't silently change which target is authoritative.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 30 scope and contract
- `.planning/ROADMAP.md` §"Phase 30: materialize-and-chips" — goal, success criteria, requirement IDs MAT-V15-01..03 + CHIP-V15-01..02
- `.planning/REQUIREMENTS.md` §MAT-V15 + §CHIP-V15 — full acceptance criteria

### Server contract (Phase 26 — locked)
- `kinetica_bi/server/src/lib/spatialWhereClause.ts` — `SpatialFilter`, `SpatialTarget`, `SpatialMode`, `buildSpatialOrBlock`, `composeWhereClause`; byte-parity with frontend types
- `kinetica_bi/server/src/index.ts` (POST /api/filter/materialize handler) — accepts `{ dashboardId, tableId, filters, spatialFilters?, spatialTarget? }`; WKB → HTTP 501 with `{ error, td: "TD-V14-WKB-SPIKE" }`
- `.planning/phases/26-server-spatial-where/26-CONTEXT.md` — 5-step validation chain, v1.3 backward compat
- `.planning/phases/26-server-spatial-where/26-VERIFICATION.md` — 66/66 tests, 12/12 must-haves

### Frontend store (Phase 27 — locked)
- `kinetica_bi/src/store/spatialFilterStore.ts` — `useSpatialFilterStore`, `shapes`, `spatialFilterVersion`, `shapeCounter`; actions `addShape` / `removeShape(id)` / `clearAll()` / `reset()`; auto-label `{Type} {N}` rule; no-op guards
- `.planning/phases/27-spatial-filter-store/27-CONTEXT.md` — store shape lock, 5-store lifecycle order, dormant-ship rationale

### Frontend target config (Phase 28 — locked)
- `kinetica_bi/src/lib/spatialTargets.ts` — `SpatialTarget` type, `SpatialMode`, `getSpatialTargets`, `isSpatialTargetEligible`, `autoSuggestSpatialMode`
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — "Spatial filter targets" section (read-only for Phase 30; no UI changes)
- `.planning/phases/28-spatial-target-config/28-CONTEXT.md` — byte-parity lock with server, eligibility predicate as single source of truth

### Frontend draw + measurement (Phase 29 — locked)
- `kinetica_bi/src/components/charts/MapDrawToolbar.tsx` — toolbar component (read-only for Phase 30)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect 6 mode-guard, Effect 7 shape sync, Effect 8 OL Draw, drawend pipeline (WKT EPSG:4326 + sphere measurement); Phase 30 does NOT modify this file
- `kinetica_bi/src/lib/shapeDraw.ts` — `DrawMode`, `formatDistance`, `formatArea` (chip secondary-text format draws from these)
- `.planning/phases/29-draw-and-shape/29-CONTEXT.md` — "immediate, no confirmation" lock for destructive actions; chip × inherits this

### v1.3 materialize pipeline (unchanged by Phase 30)
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` §AggregatedWidgetRenderer — Effect 1 materialize trigger (line 281), Effect 2 chart-query (line 339); 300ms debounce + materializeAbortRef + suspend gate locks
- `kinetica_bi/src/api/client.ts` §`materializeFilter` (line 585), §`dropFilterView` (line 610), `MaterializeFilterArgs`, `MaterializeFilterResponse`
- `kinetica_bi/src/store/filterViewStore.ts` — `useFilterViewStore`, `views[tableId]`, `markMaterializing` / `setView` / `clearView` / `clearMaterializing`; `clearMaterializingVersion` re-fire trigger
- `kinetica_bi/src/components/DashboardContext.tsx` — current shape (`dashboardId` only); Phase 30 extends to add `widgets: WidgetDto[]`
- `kinetica_bi/src/components/DashboardsPage.tsx` §FilterBar JSX (lines ~691-758) — current per-table organization; Phase 30 extends in place (no new component)
- `kinetica_bi/src/styles/global.css` §`.filter-bar*` (line 918+) — chip classes Phase 30 reuses verbatim

### Carry-over tech debt
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` — TD-V14-WKB-SPIKE re-run path (Phase 30 mirrors the v1.4 501 deferral pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`getSpatialTargets(widget)` + `isSpatialTargetEligible(target)`** (`lib/spatialTargets.ts`) — already do the per-widget filtering work; `aggregateSpatialTargetsByTable` composes them.
- **`useFilterStore` chip pattern** (DashboardsPage.tsx:728-742) — exact template to copy for spatial chips (`<span className="filter-bar-chip">` + `<button className="filter-bar-chip-dismiss">`).
- **`useDashboardContext()`** (DashboardContext.tsx) — already used by AggregatedWidgetRenderer (line 274) to read `dashboardId`; extending the context value type is the path-of-least-resistance for the widgets list.
- **`formatDistance` / `formatArea`** (`lib/shapeDraw.ts`) — Phase 29 formatters that produce the measurement strings; Shape records persist `measurement` already, so chip text can read `shape.measurement` directly without re-computation.
- **Effect 1 cancellation/debounce skeleton** (WidgetRenderer.tsx:284-325) — `materializeAbortRef` + `setTimeout(300)` + `setView` / `clearMaterializing` pattern stays. Phase 30 only changes deps and payload.

### Established Patterns

- **Primitive-dep selectors (PITFALL S-02):** version counters (filterVersion, spatialFilterVersion, materializeVersion, viewsKey, shapesKey) are the dep array members, not arrays. Phase 30 follows this for `spatialFilterVersion`.
- **DROP semantics:** `useFilterViewStore.clearView(tableId)` + fire-and-forget `dropFilterView({...}).catch(() => {})` when post-state has no filters of any kind. Phase 30 extends the empty-check to `(tableFilters.length === 0 && !myTarget) || (tableFilters.length === 0 && shapes.length === 0)` per the success-criteria #3 lock.
- **Spec wrapping for AggregatedWidgetRenderer:** every spec wraps in `<DashboardContextProvider dashboardId={N}>`. Phase 30 extends this to pass `widgets={[…]}` — all existing spec fixtures need this addition.
- **Map widget identification:** `widget.type === 'map'` (used in `MapChartRenderer.tsx` and `WidgetRenderer.tsx`); same predicate used inside `aggregateSpatialTargetsByTable`.

### Integration Points

- **`DashboardContext.tsx`** — extend `DashboardContextValue` type and the provider's value object to include `widgets`.
- **`DashboardsPage.tsx`** — provider already mounts at line 766 (`<DashboardContextProvider dashboardId={dashboard.id}>`); add `widgets={widgets}` prop.
- **`DashboardsPage.tsx` FilterBar JSX (lines ~691-758)** — extend `tableIdsWithFilters` set construction to include any tableId in `aggregateSpatialTargetsByTable(widgets)` whose shapes are non-empty; render spatial chips per row.
- **`WidgetRenderer.tsx` AggregatedWidgetRenderer (line 222+)** — pull `widgets` from context, memoize `targetsByTable`, derive `myTarget`, subscribe to `spatialFilterVersion`, extend Effect 1 deps and payload.
- **`client.ts` `MaterializeFilterArgs` type + `materializeFilter` body** — extend with optional `spatialFilters` + `spatialTarget`; no other helper signature changes.
- **`spatialTargets.ts`** — add `aggregateSpatialTargetsByTable` export + spec coverage.

</code_context>

<deferred>
## Deferred Ideas

- Per-shape eligibility warning chip (orphan-state UI) — explicitly rejected for Phase 30 in favor of silent allow. Revisit in a UX-polish phase if users miss the visibility.
- Confirmation dialog for multi-target shape removal — explicitly rejected; the operator chose simpler semantics.
- Combined version counter (`combinedFilterVersion = filterVersion + spatialFilterVersion`) — rejected in favor of direct 5th dep.
- Extracting `FilterBar` to its own component — out of scope; Phase 30 extends the existing inline JSX.

</deferred>

---

*Phase: 30-materialize-and-chips*
*Context gathered: 2026-05-12*
