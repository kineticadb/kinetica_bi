# Architecture Research

**Domain:** v1.20 Dashboard Filter Panel — right-side collapsible alternative to the top filter bar, in an existing React + Vite + zustand app (`packages/web`) over an Express/SQLite server (`packages/server`).
**Researched:** 2026-07-08
**Confidence:** HIGH (all findings read directly from the current codebase; RGL behavior verified against installed `react-grid-layout@2.2.2`)

> This is a PRESENTATION-LAYER milestone. The v1.18 combination model, `useCombinationOrchestrator` sole-materialize-trigger invariant, and both read paths (`WidgetRenderer` + `MapChartRenderer` WMS) are UNCHANGED. The panel renders and manages the SAME active-filter state a different way.

---

## Standard Architecture

### System Overview — where the panel plugs in

```
┌───────────────────────────────────────────────────────────────────────────┐
│  DashboardOpen (packages/web/src/components/DashboardsPage.tsx)             │
│  owns: widgets[], layers, associatedTables, views, dynamicViews,           │
│        useCombinationOrchestrator(...), the cleanup/reset chain            │
│                                                                            │
│  ┌──────────────── filter surface (mode-switched per dashboard) ───────┐  │
│  │  MODE "topbar"  → existing .filter-bar  (unchanged)                  │  │
│  │  MODE "sidepanel" → NEW <FilterPanel> (right drawer)                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌── flex row ──────────────────────────────────────────────────────┐    │
│  │  <div ref=containerRef> ...ResponsiveGridLayout width={width}...   │    │
│  │      (useContainerWidth → ResizeObserver auto-reflow)  │  PANEL    │    │
│  │      widget-card × N  (subscribe highlight store)      │  (drawer) │    │
│  └──────────────────────────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────────────┤
│  INPUT STORES (active-filter source of truth — panel READS these)          │
│  ┌───────────────┐ ┌───────────────┐ ┌────────────────────┐               │
│  │ filterStore   │ │ spatialFilter │ │ views[].filter_    │               │
│  │ .filters[tid] │ │ Store.shapes  │ │ clause (server,    │               │
│  │ .dvFilters[dv]│ │ (global draws)│ │ static WHERE)      │               │
│  └───────────────┘ └───────────────┘ └────────────────────┘               │
├───────────────────────────────────────────────────────────────────────────┤
│  DERIVED (read-path registry — DO NOT treat as active-filter source)       │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │ filterCombinationStore: registry[hash], vizToHash[w:*|l:*|dv:*]    │     │
│  │  ← written ONLY by useCombinationOrchestrator (sole trigger)       │     │
│  └──────────────────────────────────────────────────────────────────┘     │
├───────────────────────────────────────────────────────────────────────────┤
│  NEW transient store (this milestone)                                       │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │ filterHighlightStore: highlightedVizKeys: Set<"w:*"|"l:*">        │     │
│  │  ← written by FilterPanel hover/click; read by widget cards        │     │
│  └──────────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New / Modified |
|-----------|----------------|----------------|
| `FilterPanel` (new) | Right drawer: renders active filters as vertical chips grouped by table/dv/spatial; per-filter "applies to" list/count; remove-chip, per-group clear-all, global clear-all; collapse toggle | **NEW** |
| `WidgetCard` (extract) | Thin wrapper around the existing `.widget-card` div that subscribes to `filterHighlightStore` scoped to its own vizKey and toggles a highlight class | **NEW** (extracted from inline map in `DashboardsPage.tsx`) |
| `filterHighlightStore` (new) | Session-only transient set of highlighted vizKeys; `setHighlight(keys)` / `clearHighlight()` / `reset()` | **NEW** |
| `resolveWidgetsForFilter` lib (new) | Pure reverse-mapping: given one active filter (or shape) + its source, return the vizKeys (`w:<id>` / `l:<id>`) that apply it, using the SAME `resolveFilterSet` / `resolveSpatialShapes` semantics as the orchestrator | **NEW** |
| `DashboardsPage.tsx` `DashboardOpen` | Choose top-bar vs panel by `dashboard.filter_display_mode`; render `FilterPanel`; own global-clear handler; register `filterHighlightStore.reset()` in the cleanup chain; wrap grid + panel in a flex row | **MODIFIED** |
| `filterStore` / `spatialFilterStore` | Unchanged data model; global-clear loops existing `clearFilters`/`clearDvFilters`/`clearAll` | **UNCHANGED** (reused) |
| `useCombinationOrchestrator` | Untouched — remains sole materialize/DROP trigger. Global-clear works by mutating inputs and letting the orchestrator tear down | **UNCHANGED** |
| `dashboards` table + DTO + PATCH route | Add `filter_display_mode` column (small BOTH-stack touch) | **MODIFIED (server)** |

---

## Question-by-Question Findings

### (1) Single source of truth for "the list of active filters" + reverse-mapping filter → widgets

**Source of truth — it is NOT `filterCombinationStore`.** The active-filter INPUTS the top bar already renders are the exact set the panel must render. Confirmed from `DashboardsPage.tsx` lines ~945–1099, the top bar composes its list from:

- `filterStore.filters` — `Record<tableId, ActiveFilter[]>` (drill-down + DataFilter-widget column filters). `filterStore.ts:43`.
- `filterStore.dvFilters` — `Record<dynamicViewId, ActiveFilter[]>` (dv-scoped drills; keyed by dvId to avoid tableId collision). `filterStore.ts:51`.
- `spatialFilterStore.shapes` — `Shape[]` (global drawn shapes; mapped to tables via `aggregateSpatialTargetsByTable(widgets)`). `spatialFilterStore.ts:56`.
- `views[].filter_clause` — server-persisted **static** WHERE (a definition, not a user-toggled drill filter). Shown as a read-only `WHERE ...` label in the top bar; carry it into the panel the same way but note it is not clearable by the user (see clear-all below).

`filterCombinationStore` is the DERIVED read-path registry (materialized-view names keyed by content hash, written ONLY by the orchestrator). The panel reads it only for the "which widgets" mapping's ceiling-fallback awareness and for a live "N widgets" count when convenient — never as the filter list itself.

**Reverse-mapping approach (concrete).** The forward mapping already exists in `useCombinationOrchestrator.ts`: for each widget/layer it computes `resolveFilterSet(cfg, filters[tableId])` (and `resolveSpatialShapes(cfg, shapes)`), where `cfg` is the per-viz `filterSelection` allow-list. Build a **pure inverse** in a new `lib/resolveWidgetsForFilter.ts` that REUSES the same two resolvers so semantics match the materialize path byte-for-byte:

For a given active filter `f` on `tableId`, a viz applies it iff `f ∈ resolveFilterSet(vizCfg, filters[tableId])`. Concretely a viz accepts `f` when its `sourceMode === "all"` OR `f.sourceWidgetId ∈ allowedSourceWidgetIds` (`resolveFilterSet.ts:8`). Enumerate:

- **Chart / table / bignumber widgets** (`w:<id>`): trigger-type, table-bound (`w.config.tableId === tableId`), cfg from `w.config.filterSelection`. Note: `records` and `table` ARE trigger types now (Phase 96 migrated records into the combo store; `map` is the only common non-trigger). Use the `NON_TRIGGER_TYPES` set from the orchestrator as the authority (`useCombinationOrchestrator.ts:70`).
- **Map layers** (`l:<id>`): table-bound layers where `layer.table_id === tableId`, cfg from **top-level** `layer.filter_scope` (NOT `layer.config.filter_scope` — it is a top-level field, threaded like `track_config`; `useCombinationOrchestrator.ts:251`, `db.ts:460`). This is the SECOND read path — a matched layer must then be translated to the owning **map widget(s)** for on-canvas highlight (a map widget includes layers via `config.includedLayerIds`, or all visible layers when empty — the exact `mapTableIds` logic already inlined at `DashboardsPage.tsx:1137–1149`).
- **DataType coverage:** equality (`eq`), `in`, `between` (numeric + datetime), and `isNull` are all just `ActiveFilter` variants (`filterStore.ts:22–37`); the allow-list resolver is operator-agnostic, so datetime/BETWEEN filters reverse-map identically to equality — no special casing.
- **Spatial shapes:** a shape applies to a viz iff the viz is spatial-capable for its table (`aggregateSpatialTargetsByTable(widgets).get(tableId)` is an eligible `SpatialTarget`, `spatialTargets.ts:111`) AND `resolveSpatialShapes(cfg, shapes)` includes it. dv-bound vizs are FORCED non-spatial (dv+spatial is server-rejected). Same rule the badge uses (`useFilterScopeSummary.ts:67–72`).
- **dv filters:** a dv filter on `dvId` applies to vizs bound to that `dvId` (`w.config.dynamicViewId === dvId` or `layer.dynamic_view_id === dvId`), gated by `resolveFilterSet` on `dvFilters[dvId]`, with the `dvFilterScopeDisabled` accept-all override (`useCombinationOrchestrator.ts:293`).

**Why recompute rather than read `vizToHash`:** the combination hash encodes the whole resolved SET, not individual filters — it cannot answer "which widgets apply THIS one filter." The per-filter inverse via `resolveFilterSet`/`resolveSpatialShapes` is the only granular, correct source, and it is exactly the building block `WidgetFilterBadge` / `useFilterScopeSummary` already use (Phase 95). Reuse them; do not reimplement resolve logic.

### (2) Right-side panel + react-grid-layout reflow

The grid is driven by `const { width, mounted, containerRef } = useContainerWidth()` and `<div ref={containerRef}>` wrapping `<ResponsiveGridLayout width={width} .../>` (`DashboardsPage.tsx:487, 1118–1132`). **Verified against installed `react-grid-layout@2.2.2`:** `useContainerWidth` attaches a `ResizeObserver` to the container ref (`dist/chunk-QGXQSZII.js:28–29`). Therefore:

- **Recommended: in-flow flex sibling.** Wrap the grid `containerRef` div and `<FilterPanel>` in a `display:flex` row. When the panel opens/collapses (its width animates from 0 → e.g. 320px), the sibling grid container's content-box shrinks, the ResizeObserver fires, `useContainerWidth` recomputes `width`, and `ResponsiveGridLayout` re-lays out automatically. No manual width math, no `key` remount.
- **Avoid: `position:fixed`/`absolute` overlay panel.** An overlay does not change the container's measured width, so the grid will NOT reflow and widgets render under the panel. If an overlay is desired for aesthetics, you must instead apply a right `padding`/`margin` to the `containerRef` element so its content box actually shrinks (still observer-driven) — the flex-sibling approach is simpler and less error-prone.
- **CSS:** width transition on the panel is fine; the ResizeObserver fires continuously during the transition (a few extra layout passes). If that proves janky, gate reflow to transition-end — but start simple.
- The `mounted` gate (`DashboardsPage.tsx:1119`) already prevents a zero-width first paint; keep it.

### (3) On-canvas widget highlight from hovering a filter

**New session-only `filterHighlightStore`** (mirrors `infoSelectionStore` / `mapViewportSyncStore` transient pattern):

- State: `highlightedVizKeys: Set<string>` (holds `w:<id>` and `l:<id>`), `setHighlight(keys)`, `clearHighlight()`, `reset()`.
- `FilterPanel` computes the vizKey set for a chip via `resolveWidgetsForFilter` (from Q1) and calls `setHighlight` on `onMouseEnter` / focus, `clearHighlight` on leave; click can pin (toggle) the same set.
- **Widget cards subscribe with a SCOPED, primitive selector** (PITFALL S-02): extract a small `WidgetCard` component from the inline `widgets.map(...)` in `DashboardsPage.tsx` (lines ~1150–1210) so each card can call `useFilterHighlightStore(s => s.highlightedVizKeys.has("w:"+w.id))` and return a boolean — Zustand short-circuits on the boolean, so only the highlighted card(s) re-render. Map widgets additionally check any of their included layer keys (`l:<id>`). Toggle a class like `.widget-card--highlighted` styled with `outline: 2px solid var(--accent)` (theme token only — theme-guard forbids raw hex).
- **Register `filterHighlightStore.reset()` in the DashboardOpen cleanup chain** (`DashboardsPage.tsx:500–559`) — session-only, NO server DROP loop (same class as `infoSelectionStore`, `lastInfoClickContextStore`, `mapViewportSyncStore`). Must not leak across dashboard switch.

### (4) Persisting the per-dashboard filter-display-mode

**Requires a small server change — it CANNOT be frontend-only.** Findings:

- The `dashboards` table is `id / name / description / created_at / updated_at` (`db.ts:15–20`); `DashboardDto` has no config blob (`api/client.ts:323–329`); there is no client store for dashboard-level prefs. Widget `config` JSON is per-widget, not dashboard-level.
- Requirement: the DESIGNER picks the mode and **all viewers see that choice** — rules out `localStorage` (per-browser) and per-widget config.
- **Decision:** add `filter_display_mode TEXT NOT NULL DEFAULT 'topbar'` to `dashboards`, exactly mirroring the v1.18 Phase 93 `filter_scope` migration on `dashboard_layers`: add to the `CREATE TABLE` block for fresh installs AND a `PRAGMA`-guarded `ALTER TABLE` for existing deployments (`db.ts` header comments describe this pattern). Thread through: `mapDashboard`, `DashboardDto`, `updateDashboard` (widen the `Partial<Pick<...>>` and add the column to the `UPDATE` SET at `db.ts:480–489`), and the client `updateDashboard` attrs (`api/client.ts:343`). The PATCH route already forwards `req.body` (`index.ts:794–799`), so no new route — just the widened update. Default `'topbar'` keeps every existing dashboard byte-identical.
- This is a **BOTH-stack** feature (the only server touch in the milestone), well-trodden and low-risk. Confidence HIGH.
- UI: a small dashboard-settings control (designer-only, gated by `DASHBOARDS_EDIT`) — a two-option toggle. No new RBAC permission needed (reuse `dashboards:edit`, mirroring how v1.19 custom-metrics reused `datasets:manage`).

### (5) Global "clear all dashboard filters" without violating the sole-materialize-trigger invariant

**The invariant:** `useCombinationOrchestrator` is the SOLE caller of `materializeFilter` and the SOLE issuer of `dropCombinationView` (ref-count DROP-at-0). Nothing else may materialize or drop combination views. Clear-all MUST therefore work by mutating only the INPUT stores and letting the orchestrator tear everything down.

**Correct implementation — mutate inputs, let the orchestrator drop:**
1. For every `tableId` in `filterStore.filters`: `clearFilters(tableId)`.
2. For every `dvId` in `filterStore.dvFilters`: `clearDvFilters(dvId)`.
3. `spatialFilterStore.clearAll()` (tears down folded spatial draws).

Each call bumps `filterVersion` / `spatialFilterVersion` monotonically → the orchestrator's debounced effect (`useCombinationOrchestrator.ts:186`, 300ms) fires once, computes an empty desired set, `release()`s every combo to refCount 0 (DROP-at-0), and fires `dropCombinationView` for each (`useCombinationOrchestrator.ts:611–681`). Both read paths react automatically: `WidgetRenderer`/`AggregatedWidgetRenderer` and `MapChartRenderer` WMS both resolve their viewName from `vizToHash[vizKey]`, which the orchestrator clears → they FROM-swap back to the raw base table. **No direct materialize/drop from the clear-all handler.**

**Do NOT** call `filterStore.reset()` for a live clear — `reset()` zeroes `filterVersion` to 0 (`filterStore.ts:237`) and is reserved for the dashboard-switch/logout lifecycle. Looping the existing `clearFilters`/`clearDvFilters`/`clearAll` actions preserves monotonic version bumps (the orchestrator/renderer dep contract) and mirrors the top bar's existing per-table "Clear all" which already loops `removeShape` (`DashboardsPage.tsx:1046–1052`).

**Chip parity:** individual chip removal reuses the exact existing handlers — `useFilterStore.getState().removeFilter(tableId, column)`, `removeDvFilter(dvId, column)`, `useSpatialFilterStore.getState().removeShape(shape.id)` (already wired in the top bar). Per-group "clear all" reuses `clearFilters(tableId)` / `clearDvFilters(dvId)` / spatial removal. The new **global** clear-all is just the union loop above.

**Static `views[].filter_clause`:** server-persisted definitions, not user drill filters — the top bar shows them read-only with no dismiss button. The panel should do the same; global clear-all does NOT touch them (matches current top-bar semantics).

**Edge to verify at plan time:** confirm `RecordsTableRenderer` no longer runs its own legacy spatial materialize (Phase 96-01 GAP 2 states records is now a pure combo-store consumer). If any renderer still self-materializes on spatial, clear-all's spatial branch must account for it — but per current comments the orchestrator is sole trigger for records too.

---

## Recommended Project Structure (new/changed files)

```
packages/web/src/
├── components/
│   ├── DashboardsPage.tsx          # MOD: mode switch, flex row, FilterPanel, global clear, reset chain
│   ├── FilterPanel.tsx             # NEW: right drawer, chips, applies-to, clears, collapse
│   ├── FilterPanel.css             # NEW: drawer + collapse; theme tokens only
│   ├── WidgetCard.tsx              # NEW: extracted card wrapper that subscribes to highlight store
│   └── DashboardSettings*.tsx      # NEW/MOD: designer toggle for filter_display_mode
├── store/
│   └── filterHighlightStore.ts     # NEW: session-only Set<vizKey>; reset() in cleanup chain
├── lib/
│   └── resolveWidgetsForFilter.ts  # NEW: pure inverse of resolveFilterSet/resolveSpatialShapes
└── api/client.ts                   # MOD: DashboardDto.filter_display_mode + updateDashboard attrs

packages/server/src/
├── db.ts                           # MOD: dashboards.filter_display_mode column + ALTER migration + mapDashboard + updateDashboard
└── index.ts                        # (PATCH route already forwards body — likely no change)
```

### Structure Rationale
- **`resolveWidgetsForFilter.ts` as a pure lib:** keeps the reverse-mapping testable without React/stores and guarantees it stays in lockstep with the orchestrator's resolve semantics (same imports).
- **`WidgetCard.tsx` extraction:** required so highlight subscription is per-card (scoped boolean selector, S-02), not a whole-page re-render.
- **`filterHighlightStore` separate from filter data:** transient UI state must not pollute the materialize dep graph (it must NEVER be a dep of the orchestrator).

---

## Architectural Patterns

### Pattern 1: Reuse the resolver, invert the loop
**What:** reverse-mapping = iterate vizs, ask `resolveFilterSet(cfg, [filters])`/`resolveSpatialShapes` per viz, collect matches per filter.
**When:** building the panel's "applies to" list and the highlight target set.
**Trade-offs:** O(widgets × filters) per render, but dashboards are small (tens of widgets); recompute in a `useMemo` keyed on `filterVersion`/`spatialFilterVersion`/widgets/layers. Guarantees parity with the materialize path.

### Pattern 2: Transient store + scoped boolean selector for highlight
**What:** session-only Set in zustand; each card selects a primitive boolean for its own key.
**When:** any "hover here, highlight there" cross-component transient.
**Trade-offs:** needs the `WidgetCard` extraction; in return, only affected cards re-render.

### Pattern 3: Clear-by-input, drop-by-orchestrator
**What:** never call materialize/drop directly; mutate `filterStore`/`spatialFilterStore` and let the orchestrator reconcile.
**When:** any bulk filter operation (global clear-all).
**Trade-offs:** one 300ms debounce before views drop (acceptable; matches all other filter mutations). Absolutely preserves the sole-materialize-trigger invariant.

## Data Flow

### Hover-to-highlight
```
FilterPanel chip hover
  → resolveWidgetsForFilter(filter, {filters, dvFilters, shapes, widgets, layers, targetsByTable})
  → filterHighlightStore.setHighlight(Set<"w:*"|"l:*">)
  → WidgetCard (scoped selector) toggles .widget-card--highlighted (map card also matches l:* keys)
```

### Global clear-all
```
Clear-all button
  → loop clearFilters(tid) + clearDvFilters(dvId) + spatialFilterStore.clearAll()
  → filterVersion / spatialFilterVersion bump
  → useCombinationOrchestrator (debounced) release()→DROP-at-0→dropCombinationView
  → vizToHash cleared → WidgetRenderer + MapChartRenderer WMS FROM-swap to raw base table
```

---

## Anti-Patterns

### Anti-Pattern 1: Treating `filterCombinationStore` as the active-filter list
**What people do:** enumerate `registry`/`vizToHash` to build the chip list.
**Why it's wrong:** it is derived, hash-keyed, and encodes SETS not individual filters; it also lags the inputs by one orchestrator tick.
**Do this instead:** render from `filterStore.filters`/`.dvFilters` + `spatialFilterStore.shapes` (same as the top bar).

### Anti-Pattern 2: Overlay panel without shrinking the grid container
**What people do:** `position:fixed` drawer over the grid.
**Why it's wrong:** container width unmeasured-change → no RGL reflow → widgets hidden under the panel.
**Do this instead:** in-flow flex sibling (ResizeObserver reflows automatically) or apply right padding to `containerRef`.

### Anti-Pattern 3: Global clear-all that calls `dropCombinationView`/`materializeFilter` directly
**What people do:** loop the registry and DROP views to "clean up fast."
**Why it's wrong:** breaks ref-counting and the sole-materialize-trigger invariant; risks dropping a view another viz still shares.
**Do this instead:** clear the input stores; let the orchestrator release + DROP-at-0.

### Anti-Pattern 4: Subscribing a whole page/card to the highlight store's object
**What people do:** `useStore(s => s.highlightedVizKeys)` (returns the Set).
**Why it's wrong:** every hover re-renders every subscriber (S-02 violation / re-render storm).
**Do this instead:** scoped boolean selector per card (`.has(myKey)`).

## Integration Points

### Internal Boundaries
| Boundary | Communication | Notes |
|----------|---------------|-------|
| FilterPanel ↔ input stores | direct zustand reads (same as top bar) | filters, dvFilters, shapes, views |
| FilterPanel ↔ WidgetCards | via `filterHighlightStore` (vizKeys) | transient; reset on dashboard switch |
| Panel/clear ↔ read paths | indirect, via orchestrator reconciliation | never call materialize/drop directly |
| filter_display_mode ↔ server | PATCH /api/dashboards/:id (existing route) | new column only |

### Two read paths to cover (memory lock)
`WidgetRenderer` (widgets, `w:<id>`) and `MapChartRenderer` WMS (layers, `l:<id>`) are SEPARATE read paths. Reverse-mapping must enumerate BOTH widgets and table-bound/dv-bound layers, and highlight must translate matched `l:<id>` back to the owning map widget(s) via `includedLayerIds`. Clear-all already covers both because the orchestrator clears both `w:*` and `l:*` bindings.

## Scaling Considerations

| Scale | Adjustment |
|-------|-----------|
| Typical dashboard (≤ tens of widgets, ≤ 25 filters/table) | Recompute reverse-map in a `useMemo`; no perf concern |
| Large dashboard / many combos | Ceiling (`MAX_COMBINATION_VIEWS_PER_TABLE`) already bounds combos; panel's "applies to" respects ceiling-fallback via `useFilterScopeSummary.fellBack` |

---

## Suggested Build Order (phases, continuing from 104)

1. **Reverse-mapping lib + tests** — `resolveWidgetsForFilter.ts` (pure; reuses `resolveFilterSet`/`resolveSpatialShapes`; covers eq/in/between/datetime, spatial, dv, layer→map-widget translation). No UI yet. *Foundation for panel content + highlight.*
2. **Persistence: `filter_display_mode`** (BOTH-stack) — column + ALTER migration + `mapDashboard`/`updateDashboard`/DTO/client. Default `'topbar'` (byte-identical). *Unblocks the mode switch; isolate the only server touch early.*
3. **FilterPanel shell + grid reflow** — flex-row layout, collapsible right drawer, mode switch reads `dashboard.filter_display_mode`; render active-filter chips (reuse `buildChipText`, existing chip classes) with chip-remove + per-group clear parity. *Verify RGL reflow visually (CSS bugs pass all gates).*
4. **Applies-to + on-canvas highlight** — `filterHighlightStore`, `WidgetCard` extraction, per-filter "applies to N widgets" list/count, hover/click highlight; register `reset()` in the cleanup chain.
5. **Global clear-all** — input-loop teardown; assert orchestrator remains sole trigger (grep test: clear-all handler contains no `materializeFilter`/`dropCombinationView`). *Sequenced last so combos exist to tear down during UAT.*
6. **Designer settings UI + polish** — mode toggle (gated `dashboards:edit`), empty/edit states, theme-token pass, live UAT.

**Dependency rationale:** lib (1) underpins panel content (3) and highlight (4); persistence (2) gates the mode switch (3); global clear-all (5) needs live combos and must respect the invariant proven by the orchestrator being untouched.

---

## Sources

- Codebase (read directly, 2026-07-08): `DashboardsPage.tsx`, `WidgetRenderer.tsx`, `filterStore.ts`, `filterCombinationStore.ts`, `spatialFilterStore.ts`, `useCombinationOrchestrator.ts`, `stableComboHash.ts`, `resolveFilterSet.ts`, `spatialTargets.ts`, `useFilterScopeSummary.ts`, `WidgetFilterBadge.tsx`, `MapFilteringBadge.tsx`, `types/filterSelection.ts`, `server/src/db.ts`, `server/src/index.ts`, `web/src/api/client.ts`. — HIGH
- `react-grid-layout@2.2.2` `dist/chunk-QGXQSZII.js` (`useContainerWidth` → `ResizeObserver`). — HIGH
- Project memory: "Map WMS is a separate read-path"; "track_config is a top-level layer field"; "CSS bugs evade tests + theme-guard"; "Filtering badges read combination store". — HIGH

---
*Architecture research for: v1.20 Dashboard Filter Panel*
*Researched: 2026-07-08*
