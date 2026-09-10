# Phase 105: Reverse-Mapping Pure Lib + Tests - Research

**Researched:** 2026-07-08
**Domain:** Pure TypeScript inversion of an existing per-viz filter-resolution pipeline (no React, no stores, no I/O) in `packages/web` (Kinetica BI, v1.20 Filter Panel milestone)
**Confidence:** HIGH — every finding below is read directly from the live codebase (`resolveFilterSet.ts`, `resolveSpatialShapes.ts`, `useFilterScopeSummary.ts`, `filterStore.ts`, `spatialFilterStore.ts`, `useCombinationOrchestrator.ts`, `DashboardsPage.tsx`, `MapChartRenderer.tsx`, `spatialTargets.ts`, `filterSourceTypes.ts`). No external libraries involved — this phase adds zero dependencies. Context7 / WebSearch not applicable (pure in-house TypeScript logic, no third-party API).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Reverse-map output granularity (widget-level, layer-annotated)**
- The reverse map returns, per active filter, a WIDGET-LEVEL applies-to set. A filter that matches a map LAYER (`l:<id>`) resolves to its OWNING map widget — because on-canvas highlight can only target a widget card (the stable DOM element), not an individual layer.
- For map widgets, each applies-to entry should carry the specific matching LAYER NAME(S) so Phase 108 can render "Coverage Map — Roads layer" while still highlighting the whole card. Chart widgets (`w:<id>`) map directly with no layer annotation.
- Dedup: a filter matching multiple layers of the SAME map widget yields ONE widget entry, with the matched layer names aggregated onto it (not multiple entries for one card).
- "Applies-to count" therefore counts distinct widget cards, not raw vizzes.

**Filter identity / join key**
- Operate per active filter (the `ActiveFilter` itself) and per spatial `Shape`, mirroring how the top-bar chips already identify filters — so Phase 108 can join panel chips → applies-to sets without inventing a separate key scheme. Keep the returned association keyed to the same filter objects the panel renders.

**Zero-match filters**
- A filter that applies to no widgets returns an EMPTY applies-to set. The lib imposes NO special zero-state contract — Phase 108 decides whether/how to render "applies to 0 widgets." (User chose: just an empty list from the lib.)

**Locked by mirroring existing behavior (do NOT re-decide)**
- REUSE `resolveFilterSet` (column filters) + `resolveSpatialShapes` (spatial) as the per-viz forward test; never reimplement scope logic. The reverse map is literally "for each viz, run the forward resolver; if this filter is in the applied set, add this viz's owning widget."
- Cover all filter kinds: equality/in, datetime-between (all are `ActiveFilter`s — operator-agnostic), and spatial shapes.
- Cover BOTH read paths: `w:<id>` chart widgets AND `l:<id>` map layers (translated to owning map widget).
- Honor `dvFilterScopeDisabled` (dv-bound sources revert to accept-all), exactly as `useFilterScopeSummary` does.
- Source of truth for active filters = `useFilterStore` (`filters[tableId]`, `dvFilters[dvId]`) + `useSpatialFilterStore` (`shapes`). Do NOT read `filterCombinationStore` (it is a DERIVED orchestrator-written registry — reading it as source of truth is the documented drift trap).
- PURE: no React, no store imports inside the lib. Live-store wiring is a thin hook added in Phase 108.

### Claude's Discretion
- Exact function name(s), signature, and return type shape (e.g. `Map`/array of `{ filter, widgets: Array<{ widgetId, title, layerNames? }> }`).
- How the caller enumerates the "all vizzes" input (widgets + layers with their cfg + tableId/dvId + spatialCapable). Keep the core fn pure by taking an enumerated viz list as an argument; where that enumeration is sourced (dashboard widgets store + `dashboardLayersStore`, mirroring DashboardsPage `includedLayers`) is a planner call.
- Whether to additionally expose a shared primitive that the Phase 95 per-widget badge could reuse to guarantee no drift, vs. leaving the badge untouched (both read the same resolvers already).
- Test structure/fixtures (the phase's deliverable is the lib + its unit tests).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Panel rendering, highlight behavior, and the live hook are Phases 107/108 by design.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| FSCOPE-V120-01 (computation portion only) | For each active filter, compute which widgets it applies to (names and/or count), across both chart widgets and map layers and all filter kinds (equality/in/date/spatial), honoring per-visualization filter scope. | This entire document: §"Core Algorithm" gives the exact inversion of `resolveFilterSet`/`resolveSpatialShapes`; §"Viz Descriptor Contract" enumerates every field needed and cites where each is sourced today; §"Both Read Paths" + §"dv Handling" show how to mirror `useFilterScopeSummary`/`useCombinationOrchestrator` byte-for-byte; §"Test Matrix" gives the required coverage grid. The panel DISPLAY half of FSCOPE-V120-01 is Phase 108's job — this phase ships only the pure computation + its tests. |
</phase_requirements>

## Summary

Phase 105 ships one pure, dependency-free TypeScript module (plus its unit tests) that inverts the existing forward per-viz filter-scope resolvers (`resolveFilterSet` + `resolveSpatialShapes`, both already in `packages/web/src/lib/`). The forward direction answers "given this viz's config, which of the active filters apply to it?" — Phase 95's `computeFilterScopeSummary` already does this per-viz. The reverse direction Phase 105 must ship answers "given ALL vizzes, which WIDGETS does THIS filter apply to?" It is built by iterating every viz descriptor, running the SAME two resolvers (never reimplementing filter-matching logic), and inverting the per-viz applied-set into a per-filter/per-shape applies-to set, aggregated to widget-card granularity (map layers roll up to their owning map widget, with matched layer names annotated on that one widget entry).

The critical design constraint is purity: the function takes a fully-enumerated list of viz descriptors as a plain argument (no store reads inside the lib) — enumeration from `useDashboardLayersStore`/widgets/`useAuthStore.dvFilterScopeDisabled` is explicitly deferred to Phase 108's hook wrapper. Every semantic rule the reverse map must honor (accept-all default, allow-list intersection, spatial all-or-nothing per viz, dv-bound accept-all override under `dvFilterScopeDisabled`, dv forcing `spatialCapable=false`, map widgets themselves never being direct filter targets) already exists verbatim in `useFilterScopeSummary.ts` and `useCombinationOrchestrator.ts` — Phase 105 must reproduce these rules exactly, with no branching on filter `operator` (eq/in/between are handled uniformly by `resolveFilterSet` already).

**Primary recommendation:** Write `packages/web/src/lib/computeReverseFilterMap.ts` exporting a single pure function `computeReverseFilterMap(args)` that accepts `{ filters, dvFilters, shapes, vizs, dvFilterScopeDisabled }` (structurally identical to the store shapes `useFilterScopeSummary` already reads) and returns `{ filterEntries: FilterApplyEntry[]; shapeEntries: ShapeApplyEntry[] }`, where each entry carries the ORIGINAL `ActiveFilter`/`Shape` object (reference-identity join, per locked decision) plus a deduped, widget-id-ascending-sorted `widgets: WidgetApplyEntry[]` array (`{ widgetId, widgetTitle, layerNames?: string[] }`).

## Standard Stack

### Core

No new libraries. This is 100% first-party TypeScript reusing three existing pure modules:

| Module | Purpose | Why reuse (not reinvent) |
|--------|---------|---------------------------|
| `packages/web/src/lib/resolveFilterSet.ts` | Per-viz column-filter forward resolver (allow-list ∩ active; accept-all default) | Single source of truth for column-filter matching semantics since Phase 88; every filter-scope feature (Phase 90 orchestrator, Phase 95 badge) already calls this — the reverse map MUST call it too or drift is guaranteed |
| `packages/web/src/lib/resolveSpatialShapes.ts` | Per-viz spatial forward resolver (all-or-nothing via `SPATIAL_DRAWS_SENTINEL`) | Same rationale; shapes have no per-shape source, so per-viz acceptance is a single boolean gate |
| `packages/web/src/types/filterSelection.ts` | `FilterSelectionConfig` type + `DEFAULT_FILTER_SELECTION` | The cfg shape every viz descriptor's `cfg` field must conform to |

### Supporting (types only, no runtime import needed by the pure lib itself)

| Type | Source | Used for |
|------|--------|----------|
| `ActiveFilter` | `packages/web/src/store/filterStore.ts` | Import the TYPE only (not the store) — the pure lib's `filters`/`dvFilters` args are plain `Record<number, ActiveFilter[]>` |
| `Shape` | `packages/web/src/store/spatialFilterStore.ts` | Import the TYPE only — `shapes: Shape[]` plain array arg |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Reusing `resolveFilterSet`/`resolveSpatialShapes` | Reimplement allow-list matching inline in the reverse-map fn | REJECTED — locked by CONTEXT.md; also this is exactly Pitfall 2 from `.planning/research/PITFALLS.md` ("reverse-map reinvents `sourceWidgetId` matching instead of calling `resolveFilterSet`") |
| Returning `{filter, widgets}[]` arrays keyed by reference | Returning a `Map<ActiveFilter, WidgetApplyEntry[]>` | A `Map` with object keys works identically (JS Maps support reference-identity object keys) and is arguably more ergonomic for Phase 108's O(1) lookup — recommend the planner pick whichever composes better with Phase 108's chip-render loop; document both are equally "pure" and equally satisfy the locked identity-join requirement |
| Widget-title/layer-name resolution inside the pure lib | Resolving `layerNameFor`-style names inside the reverse-map fn | REJECTED for purity — `layerNameFor` (in `MapChartRenderer.tsx:768`) needs `tables[]` + `layer.config.name` fallback logic; this resolution MUST happen in the Phase 108 enumeration step, which then hands the pure lib an already-resolved `layerName: string` per viz descriptor |

**Installation:** none — zero new packages.

**Version verification:** N/A (no external package).

## Architecture Patterns

### Recommended Project Structure

```
packages/web/src/lib/
├── computeReverseFilterMap.ts       # NEW — the pure reverse-map fn (Phase 105 deliverable)
├── computeReverseFilterMap.spec.ts  # NEW — unit tests (Phase 105 deliverable)
├── resolveFilterSet.ts              # EXISTING — reused, unmodified
├── resolveSpatialShapes.ts          # EXISTING — reused, unmodified
└── useFilterScopeSummary.ts         # EXISTING — unmodified this phase (Discretion: could later
                                      #   share internals — see "Don't Hand-Roll" below)
```

No new store, no new component, no wiring into `DashboardsPage.tsx`/`WidgetRenderer.tsx`/`MapChartRenderer.tsx` this phase — those all land in Phase 108.

### Pattern 1: Viz Descriptor Contract (the pure input shape)

**What:** A single flat descriptor type covering BOTH read paths (`w:<id>` chart widgets and `l:<id>` map layers), so the core fn iterates one homogeneous array instead of two widget/layer-shaped inputs.

**Recommended shape** (fields cited against where they're obtainable today):

```typescript
export type VizDescriptor = {
  /** "widget" = chart/table/etc widget entry (w:<id>); "layer" = map layer entry (l:<id>) */
  vizKind: "widget" | "layer";
  /**
   * The WIDGET-CARD id this entry aggregates onto. For vizKind "widget" this IS the
   * widget's own id. For vizKind "layer" this is the OWNING map widget's id (the
   * card that must be highlighted) — NOT the layer's own id.
   */
  widgetId: number;
  /** Present only for vizKind "layer" — the layer's own DB id (DashboardLayerDto.id). */
  layerId?: number;
  /**
   * Present only for vizKind "layer" — the display name Phase 108's enumeration step
   * already resolved (mirror MapChartRenderer.tsx:768 layerNameFor: layer.config.name
   * custom override, else "{schema.name} — {renderMode}"). The pure lib treats this as
   * an opaque string; it does NOT resolve names itself (keeps it store/table-free).
   */
  layerName?: string;
  /** The widget-card title shown in the applies-to list ("Sales by Region", "Coverage Map"). */
  widgetTitle: string;
  /**
   * The per-viz filter-selection config. For vizKind "widget": w.config.filterSelection.
   * For vizKind "layer": layer.filter_scope (TOP-LEVEL layer field — NEVER layer.config.filter_scope;
   * see MEMORY "track_config is a top-level layer field" — filter_scope follows the identical
   * top-level-field convention, confirmed at useCombinationOrchestrator.ts:251/323).
   * undefined => accept-all (DEFAULT_FILTER_SELECTION), exactly like resolveFilterSet's own default.
   */
  cfg: FilterSelectionConfig | undefined;
  /** Table-bound source id. Mutually exclusive with dynamicViewId. */
  tableId?: number;
  /** Dv-bound source id. Mutually exclusive with tableId. */
  dynamicViewId?: number;
  /**
   * Pre-computed by the caller (mirrors DashboardsPage.tsx:1164-1167 /
   * useFilterScopeSummary's own contract): true only for a TABLE-BOUND viz whose table
   * has an eligible SpatialTarget (targetsByTable.has(tableId) via
   * aggregateSpatialTargetsByTable(widgets) in lib/spatialTargets.ts). The pure lib still
   * applies the dv-forces-false override internally (see Pattern 2) — callers may pass
   * either the raw table-derived value OR pre-forced false for dv vizs; the lib is safe
   * either way because it re-derives isDv from dynamicViewId !== undefined and forces
   * effective spatialCapable=false whenever isDv is true, mirroring useFilterScopeSummary
   * line 120 exactly.
   */
  spatialCapable: boolean;
};
```

**Confirmed obtainable today** (for Phase 108's enumeration step, not this phase, but verified so the contract is realistic):
- `widgetId`/`widgetTitle`/`cfg`(widget)/`tableId`/`dynamicViewId`: `WidgetDto.id`/`.title`/`.config.filterSelection`/`.config.tableId`/`.config.dynamicViewId` — all read directly in `DashboardsPage.tsx:1150-1168`.
- `layerId`/`cfg`(layer)/`tableId`(layer)/`dynamicViewId`(layer): `DashboardLayerDto.id`/`.filter_scope`/`.table_id`/`.dynamic_view_id` — `packages/web/src/api/client.ts:619-654`; `filter_scope` confirmed top-level (not nested) at `client.ts:647-651` and consumed the same way at `useCombinationOrchestrator.ts:251,323`.
- `layerName`: `MapChartRenderer.tsx:768-775` `layerNameFor()` — needs `tables[]`, not available inside a pure lib; Phase 108 must resolve this string BEFORE building the descriptor.
- Owning map widget for a layer (`widgetId` when `vizKind==="layer"`): derived from `config.includedLayerIds` on each MAP widget, exactly the pattern already inlined at `DashboardsPage.tsx:1137-1149` (`mapTableIds` block) and `MapChartRenderer.tsx:533-561` (`includedLayers` useMemo) — empty/undefined `includedLayerIds` on a map widget defaults to "ALL dashboard layers". **Gotcha (see Common Pitfalls #4 below): this means a single physical layer can be "owned" by MORE THAN ONE map widget** if two+ map widgets both have empty `includedLayerIds`. The enumerator must emit ONE `VizDescriptor` per (layer, owning-widget) PAIR — if a layer is included by two map widgets, emit two descriptors with the same `layerId`/`layerName` but different `widgetId`. The pure lib requires no special-casing for this; it just produces two widget entries, which is correct (both cards genuinely should highlight).
- `spatialCapable`: `aggregateSpatialTargetsByTable(widgets)` (`lib/spatialTargets.ts:111-135`), used identically at `DashboardsPage.tsx:1166` and inside `useCombinationOrchestrator.ts:196,217`.

### Pattern 2: Core Algorithm — invert per-viz resolution into per-filter/per-shape applies-to sets

**What:** For each active filter/shape, determine the widget-level applies-to set by running the SAME forward resolvers used by `useFilterScopeSummary`/the orchestrator, then inverting membership.

**Why this shape (not "iterate filters, then vizs" naively):** `resolveFilterSet`'s accept-all branch returns `allFilters.slice()` — i.e. it needs the EXACT per-source active list (only `filters[tableId]` for a table-bound viz, or only `dvFilters[dvId]` for a dv-bound viz), never a flattened cross-table list. Passing a mixed list would silently leak filters across tables under accept-all mode. So the algorithm must resolve ONE viz at a time against its own correct active-list, then check membership of each candidate filter/shape in the per-viz resolved set — never the reverse (don't try to look up "what list does filter X belong to" generically; iterate vizs, resolve their own list, then check).

```typescript
// Source pattern verified against useFilterScopeSummary.ts:114-140 and
// useCombinationOrchestrator.ts:208-340 (dv branch at 282-312/314-340).
export function computeReverseFilterMap(args: {
  filters: Record<number, ActiveFilter[]>;      // == useFilterStore.getState().filters
  dvFilters: Record<number, ActiveFilter[]>;    // == useFilterStore.getState().dvFilters
  shapes: Shape[];                               // == useSpatialFilterStore.getState().shapes
  vizs: VizDescriptor[];
  dvFilterScopeDisabled: boolean;                // == useAuthStore.getState().dvFilterScopeDisabled
}): { filterEntries: FilterApplyEntry[]; shapeEntries: ShapeApplyEntry[] } {
  // 1. Seed one entry per active filter/shape (guarantees the LOCKED
  //    "zero-match => empty widgets[], never a missing key" contract).
  const filterEntries = new Map<ActiveFilter, WidgetApplyEntry[]>();
  for (const list of Object.values(args.filters)) for (const f of list) filterEntries.set(f, []);
  for (const list of Object.values(args.dvFilters)) for (const f of list) filterEntries.set(f, []);
  const shapeEntries = new Map<Shape, WidgetApplyEntry[]>();
  for (const s of args.shapes) shapeEntries.set(s, []);

  // 2. One pass over vizs — sort by widgetId ascending first for deterministic
  //    output order (mirrors aggregateSpatialTargetsByTable's own id-ascending
  //    determinism convention at spatialTargets.ts:115-120).
  const sortedVizs = [...args.vizs].sort((a, b) => a.widgetId - b.widgetId);
  for (const viz of sortedVizs) {
    const isDv = viz.dynamicViewId !== undefined;
    // GAP 3 mirror (useFilterScopeSummary.ts:131-133 / orchestrator.ts:292-293,322-323):
    // dv-bound + dvFilterScopeDisabled => cfg forced to undefined (accept-all).
    const effectiveCfg = isDv && args.dvFilterScopeDisabled ? undefined : viz.cfg;
    // dv forces spatialCapable=false (useFilterScopeSummary.ts:119-120; orchestrator
    // never folds shapes into the dv hash at all — orchestrator.ts:297,326).
    const effectiveSpatialCapable = isDv ? false : viz.spatialCapable;

    const activeList: ActiveFilter[] = isDv
      ? (viz.dynamicViewId !== undefined ? args.dvFilters[viz.dynamicViewId] ?? [] : [])
      : (viz.tableId !== undefined ? args.filters[viz.tableId] ?? [] : []);

    const resolvedFilters = resolveFilterSet(effectiveCfg, activeList);
    for (const f of resolvedFilters) {
      const entry = filterEntries.get(f);
      if (entry) addWidgetMatch(entry, viz); // f is guaranteed seeded in step 1 (same object ref)
    }

    if (effectiveSpatialCapable) {
      const resolvedShapes = resolveSpatialShapes(effectiveCfg, args.shapes);
      for (const s of resolvedShapes) {
        const entry = shapeEntries.get(s);
        if (entry) addWidgetMatch(entry, viz);
      }
    }
  }

  return {
    filterEntries: [...filterEntries].map(([filter, widgets]) => ({ kind: "filter" as const, filter, widgets })),
    shapeEntries: [...shapeEntries].map(([shape, widgets]) => ({ kind: "shape" as const, shape, widgets })),
  };
}

// Widget-level dedup + layer-name aggregation (LOCKED behavior — one entry per widget card).
function addWidgetMatch(target: WidgetApplyEntry[], viz: VizDescriptor): void {
  let entry = target.find((e) => e.widgetId === viz.widgetId);
  if (!entry) {
    entry = { widgetId: viz.widgetId, widgetTitle: viz.widgetTitle, layerNames: undefined };
    target.push(entry);
  }
  if (viz.vizKind === "layer" && viz.layerName) {
    entry.layerNames = entry.layerNames ? [...entry.layerNames, viz.layerName] : [viz.layerName];
  }
}
```

**Never throws / total function:** every field access above uses `??`/optional-chaining fallbacks (`?? []`, `?? undefined`); an incomplete `VizDescriptor` (e.g. `tableId` and `dynamicViewId` both undefined) simply resolves an empty `activeList` and contributes nothing — never throws. Tests should assert this explicitly (see Test Matrix, "malformed/incomplete descriptor" case).

### Pattern 3: dv Handling (mirror `useFilterScopeSummary` + orchestrator exactly)

| Rule | Where it's locked today | How the reverse map mirrors it |
|------|--------------------------|----------------------------------|
| dv-bound viz uses `dvFilters[dvId]`, never `filters[tableId]` | `useFilterScopeSummary.ts:122-127` | `isDv` branch selects `args.dvFilters[viz.dynamicViewId]` |
| dv + `dvFilterScopeDisabled` → cfg forced `undefined` (accept-all) | `useFilterScopeSummary.ts:131-133`; `useCombinationOrchestrator.ts:292-293,322-323` | `effectiveCfg = isDv && dvFilterScopeDisabled ? undefined : viz.cfg` |
| dv-bound viz is NEVER spatial-capable (no shapes folded in at all) | `useFilterScopeSummary.ts:119-120` (`effectiveSpatialCapable = isDv ? false : spatialCapable`); orchestrator's dv loops never pass a shapes arg to `stableComboHash` (`orchestrator.ts:297-298,326-327`) | `effectiveSpatialCapable = isDv ? false : viz.spatialCapable` — forced regardless of what the caller passed in `viz.spatialCapable` |
| Map WIDGETS themselves are never direct filter targets (`"map"` ∈ `NON_TRIGGER_TYPES`) | `useCombinationOrchestrator.ts:70-83` | The enumerator (Phase 108) must never emit a `vizKind:"widget"` descriptor for a map widget's own `w:<id>` — only its layers (`vizKind:"layer"`) participate. Document this as an enumeration-contract note; the pure lib has no special-case for widget `type` (it doesn't even receive `type`) — correctness here depends entirely on Phase 108 not emitting a spurious map-widget descriptor. **Flag for planner:** consider whether `VizDescriptor` should omit `type` entirely (current recommendation) or include it defensively — Discretion. |

### Pattern 4: Both Read Paths — worked example

```
Dashboard: 1 chart widget (w:5, table 10, cfg=accept-all), 1 map widget (w:8, table-agnostic
itself — NON_TRIGGER_TYPE), 2 layers on that map (l:20 table 10 cfg=accept-all "Roads",
l:21 table 10 cfg=allowlist[99] "Rivers"), both layers owned by w:8 (includedLayerIds unset).
Active filter f1 = {column:"region", sourceWidgetId:5} on table 10.

vizs = [
  {vizKind:"widget", widgetId:5, widgetTitle:"Sales by Region", cfg:undefined, tableId:10, spatialCapable:false},
  {vizKind:"layer",  widgetId:8, layerId:20, layerName:"Roads",  widgetTitle:"Coverage Map", cfg:undefined,               tableId:10, spatialCapable:false},
  {vizKind:"layer",  widgetId:8, layerId:21, layerName:"Rivers", widgetTitle:"Coverage Map", cfg:{sourceMode:"allowlist",allowedSourceWidgetIds:[99]}, tableId:10, spatialCapable:false},
]

computeReverseFilterMap({filters:{10:[f1]}, dvFilters:{}, shapes:[], vizs, dvFilterScopeDisabled:false})
=> filterEntries: [{
     kind:"filter", filter: f1,
     widgets: [
       {widgetId:5, widgetTitle:"Sales by Region", layerNames:undefined},
       {widgetId:8, widgetTitle:"Coverage Map",     layerNames:["Roads"]},   // Rivers excluded — sourceWidgetId 5 ∉ [99]
     ]
   }]
```

This demonstrates the widget-level dedup (ONE entry for widget 8, not two), the layer-name annotation on that one entry, and per-layer allow-list exclusion (Rivers correctly excluded while Roads is included, both owned by the same map widget).

### Anti-Patterns to Avoid

- **Flattening `filters`/`dvFilters` into one array before resolving:** breaks accept-all semantics (a table-bound viz would incorrectly "see" another table's filters). Always resolve per-viz against its OWN source's list.
- **Branching on `ActiveFilter.operator`:** `resolveFilterSet` is already operator-agnostic (eq/in/between/isNull all flow through the same allow-list logic) — do not special-case datetime/between filters anywhere in the reverse map.
- **Reading `filterCombinationStore`/`vizToHash` as a shortcut:** it encodes resolved SETS (hashes), not per-filter membership, and it's the documented drift trap (`FilteringBadge` legacy bug, MEMORY: filtering-badges-read-combination-store). The reverse map must be computable from `filters`/`dvFilters`/`shapes` + viz configs alone.
- **Emitting a `vizKind:"widget"` descriptor for a map widget's own `w:<id>`:** map is a `NON_TRIGGER_TYPE`; only its layers (`l:<id>`) participate in filter resolution. (Enumeration-layer concern for Phase 108, but the pure lib's tests should include a fixture proving a map-widget-shaped descriptor with no `layerId` still behaves sanely — i.e., the lib is defensive even though it shouldn't normally receive one.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| "Does filter X apply to viz Y?" | A new allow-list ∩ active-filters comparison inline in the reverse map | `resolveFilterSet(cfg, activeList)` + membership check (`.includes(f)`) | It already handles accept-all default, allow-list intersection, and `sourceWidgetId` undefined-safety; reimplementing risks silent semantic drift from the orchestrator/badge (locked by CONTEXT.md) |
| "Does shape X apply to viz Y?" | A new spatial-sentinel check | `resolveSpatialShapes(cfg, shapes)` + membership check | Same rationale; also the SPATIAL_DRAWS_SENTINEL constant lives in `filterSourceTypes.ts` and should never be duplicated |
| Widget/layer applies-to dedup key | A composite string key like `` `${widgetId}:${layerId ?? ''}` `` | Plain `widgetId` numeric dedup (`Array.find`/`Map<number, WidgetApplyEntry>`) | Widget ids are already unique dashboard-wide; a composite key adds complexity for no benefit and risks accidental type coercion bugs (number vs string) |

**Key insight:** every piece of "is this filter/shape active for this viz" logic in this codebase already exists in exactly two functions (`resolveFilterSet`, `resolveSpatialShapes`) plus two forcing rules (dv-accept-all-override, dv-forces-non-spatial). Phase 105's entire job is orchestration/inversion around those four things — zero new matching logic should be written.

## Common Pitfalls

### Pitfall 1: Flattening active filters loses per-source scoping
**What goes wrong:** Passing a merged/flattened list of all active filters (across tables and dvs) into `resolveFilterSet` for every viz. Under accept-all mode this returns the WHOLE merged list, so a table-10 widget would incorrectly show as "applies to" a table-20 filter.
**Why it happens:** It's tempting to precompute one big `allActiveFilters` array up front for "efficiency."
**How to avoid:** Always call `resolveFilterSet(cfg, sourceSpecificList)` — `filters[tableId]` for table-bound, `dvFilters[dvId]` for dv-bound — never a merged list. This is the same discipline `useFilterScopeSummary.ts:122-127` already enforces.
**Warning signs:** A unit test with two tables' filters both showing up in one table's widget's applies-to set.

### Pitfall 2: Forgetting the dv double-override (cfg AND spatialCapable)
**What goes wrong:** Implementing only the `dvFilterScopeDisabled` cfg override but forgetting to ALSO force `spatialCapable=false` for dv vizs (or vice versa) — a dv-bound layer could incorrectly show as "applies to" a spatial shape.
**Why it happens:** The two overrides live in two different places conceptually (cfg vs spatial gating) and are easy to implement separately/incompletely.
**How to avoid:** Both must be derived from the SAME `isDv` boolean inside the core loop, exactly as `useFilterScopeSummary.ts:119-120` (spatial) and `:131-133` (cfg) do side by side.
**Warning signs:** A test with a dv-bound viz + an active spatial shape + `spatialCapable: true` passed in the descriptor incorrectly shows the shape as applied.

### Pitfall 3: Layer→owning-widget is not always 1:1
**What goes wrong:** Assuming each layer has exactly one owning map widget (singular `ownerWidgetId`). In reality, if TWO map widgets both have an empty/undefined `config.includedLayerIds`, BOTH default to including ALL dashboard layers — so one physical layer can legitimately belong to multiple widget cards simultaneously.
**Why it happens:** CONTEXT.md's decision text says "resolves to its OWNING map widget" (singular), which is the common case but not universally true given the `includedLayerIds`-empty-means-all-layers default (`MapChartRenderer.tsx:533-541`, mirrored at `DashboardsPage.tsx:1137-1149`).
**How to avoid:** Phase 108's enumerator must emit one `VizDescriptor` per (layer, owning-widget) PAIR, not one descriptor per layer. The pure lib itself needs no special-casing — feeding it two descriptors with the same `layerId` but different `widgetId` naturally produces two correct widget entries.
**Warning signs:** A dashboard fixture with 2 map widgets sharing a layer only highlights one card when both should highlight.

### Pitfall 4: Reference-identity join breaks if the caller doesn't reuse filter objects
**What goes wrong:** Phase 108's hook recomputes a NEW `ActiveFilter`/`Shape` array (e.g. via `.map()` or spread) before passing it into `computeReverseFilterMap`, breaking the `Map<ActiveFilter, ...>` reference-identity lookup used internally and by the panel's later join.
**Why it happens:** It's a common React habit to `.slice()`/`.map()` "just to be safe" — but here identity matters.
**How to avoid:** Pass `filters`/`dvFilters`/`shapes` straight from `useFilterStore.getState()`/`useSpatialFilterStore.getState()` with NO transformation. Document this loudly in the function's JSDoc (mirrors the same "never mutates, callers get the same references" contract `resolveFilterSet`/`resolveSpatialShapes` already have).
**Warning signs:** Phase 108's chip → applies-to lookup returns "0 widgets" for every filter despite the reverse map's own tests passing (a give-away that entries exist but the LOOKUP key doesn't match objects by reference anymore).

### Pitfall 5: Treating `operator`/`dataType` as relevant to matching
**What goes wrong:** Adding an `if (filter.operator === "between") {...}` branch "to be safe" for datetime filters.
**Why it happens:** `between` filters carry tuple values and it's easy to assume they need special handling.
**How to avoid:** `resolveFilterSet` only ever inspects `sourceWidgetId` — operator/value/dataType are irrelevant to SCOPE resolution (they matter only to the SQL WHERE-building elsewhere). No branching needed; a `between` filter is matched or excluded exactly like an `eq` filter.
**Warning signs:** A test with a `between` filter behaving differently from an equivalent `eq` filter with the same `sourceWidgetId` and cfg.

## Code Examples

### Fixture pattern (mirrors `useFilterScopeSummary.spec.ts` — REUSE this factory style)

```typescript
// Source: packages/web/src/lib/useFilterScopeSummary.spec.ts:9-22 (existing convention to mirror)
function mkFilter(column: string, sourceWidgetId?: number): ActiveFilter {
  return { column, value: "x", dataType: "string", sourceWidgetId, addedAt: 0 };
}
function mkShape(label: string): Shape {
  return { id: label, type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", label, measurement: "1km", addedAt: 0 };
}
function mkWidgetViz(overrides: Partial<VizDescriptor> = {}): VizDescriptor {
  return {
    vizKind: "widget", widgetId: 1, widgetTitle: "Chart", cfg: undefined,
    tableId: 10, spatialCapable: false, ...overrides,
  };
}
function mkLayerViz(overrides: Partial<VizDescriptor> = {}): VizDescriptor {
  return {
    vizKind: "layer", widgetId: 8, layerId: 20, layerName: "Roads", widgetTitle: "Coverage Map",
    cfg: undefined, tableId: 10, spatialCapable: false, ...overrides,
  };
}
```

### Zero-match assertion pattern

```typescript
// Source: this document's Pattern 2 — a filter with no matching viz still gets a seeded EMPTY entry
const { filterEntries } = computeReverseFilterMap({
  filters: { 10: [mkFilter("region", 5)] },
  dvFilters: {}, shapes: [],
  vizs: [mkWidgetViz({ cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [999] } })], // excludes sourceWidgetId 5
  dvFilterScopeDisabled: false,
});
expect(filterEntries).toHaveLength(1);
expect(filterEntries[0].widgets).toEqual([]); // LOCKED: empty array, not a missing/undefined entry
```

## Test Matrix

Required coverage grid for `computeReverseFilterMap.spec.ts` (mirrors the dimensional coverage `useFilterScopeSummary.spec.ts` already uses, extended for the reverse direction and both read paths). Every row is a distinct `it(...)` case; combine dimensions rather than writing one test per cell where reasonable.

| Dimension | Values to cover |
|-----------|------------------|
| Filter operator | `eq`/scalar, `in` (array value), `between` (tuple value) — assert identical matching behavior across all three (Pitfall 5) |
| Item kind | column filter, spatial shape |
| Source binding | table-bound, dv-bound |
| Cfg mode | `cfg` undefined (accept-all default), `sourceMode:"all"`, `sourceMode:"allowlist"` with match, `sourceMode:"allowlist"` with no match |
| `dvFilterScopeDisabled` | `false` (respects dv cfg), `true` (dv cfg ignored, forced accept-all) |
| Viz kind | chart widget (`vizKind:"widget"`), single map layer (`vizKind:"layer"`), multiple layers on the SAME map widget (dedup + layer-name aggregation), layers on TWO DIFFERENT map widgets both matching (two separate widget entries) |
| spatialCapable | `true` + eligible table, `false` (non-spatial-capable table-bound viz ignores shapes even if cfg would accept them) |
| Zero-match | a filter/shape present in the store inputs but excluded by every viz's cfg → seeded entry with `widgets: []` (never a missing key) |
| Purity | same input object references in ⇒ same references out (`filterEntries[i].filter === inputFilter`); function does not mutate `filters`/`dvFilters`/`shapes`/`vizs` inputs (mirror `resolveFilterSet.spec.ts`/`resolveSpatialShapes.spec.ts`'s existing no-mutation assertions) |
| Totality / defensive | a `VizDescriptor` with both `tableId` and `dynamicViewId` undefined (malformed) does not throw and contributes no matches; an empty `vizs` array returns all-empty-widgets entries for every active filter/shape; empty `filters`/`dvFilters`/`shapes` returns empty entry arrays |
| Ordering | widget entries within one filter's `widgets[]` are sorted/deterministic (widgetId ascending, per Pattern 2) across repeated calls with the same input |

**Existing spec patterns to mirror:**
- `packages/web/src/lib/useFilterScopeSummary.spec.ts` — factory functions (`mkFilter`, `mkShape`), one `describe` block, numbered `it()` comments cross-referencing the dimension being tested (e.g. "Test 4: spatial-capable widget...").
- `packages/web/src/lib/resolveFilterSet.spec.ts` / `resolveSpatialShapes.spec.ts` — no-mutation-of-inputs assertions.

All of the above are `packages/web` vitest specs — run via `cd packages/web && npx vitest run src/lib/computeReverseFilterMap.spec.ts` during development; full gate is `npx vitest run` (100%) + `npx tsc --noEmit` clean, per CLAUDE.md.

## State of the Art

Not applicable — no external ecosystem to track (pure in-house TypeScript, no third-party library versions). The only "state of the art" is internal: this phase's approach must stay in lockstep with whatever `resolveFilterSet`/`resolveSpatialShapes`/`useFilterScopeSummary` do TODAY (Phase 88/93.5/95 baselines, unchanged since). If those resolvers are ever extended (e.g. per-shape source ids in a future phase), the reverse map must be updated in the same commit — flag this coupling explicitly in the new file's header comment.

**Deprecated/outdated:** N/A.

## Open Questions

1. **Should the reverse-map lib also expose a shared primitive that Phase 95's `computeFilterScopeSummary` could reuse (to structurally guarantee no drift), or should the two stay independent (both simply calling the same two resolvers)?**
   - What we know: `computeFilterScopeSummary` already reuses `resolveFilterSet`/`resolveSpatialShapes` directly — it does NOT reimplement matching logic, so drift risk is already low even without further sharing.
   - What's unclear: whether extracting a shared "does viz V accept item I" primitive (used by both the forward summary and the reverse map) is worth the indirection for a marginal drift-proofing gain.
   - Recommendation (Claude's Discretion per CONTEXT.md): keep them independent this phase — both already call the same two resolvers, which is the actual drift-prevention mechanism. Revisit sharing only if a THIRD consumer emerges. Do not modify `useFilterScopeSummary.ts` in Phase 105 (it's out of this phase's file-touch scope).

2. **Exact return-type ergonomics: `Map<ActiveFilter, WidgetApplyEntry[]>` vs `FilterApplyEntry[]` array with embedded `filter` reference.**
   - What we know: both satisfy the locked "reference-identity join" requirement equally.
   - What's unclear: which is more ergonomic for Phase 108's consumption (a `Map` gives O(1) `.get(chipFilter)`; an array requires either a `.find()` or the consumer builds its own `Map` from the array).
   - Recommendation: ship the array form (`FilterApplyEntry[]`/`ShapeApplyEntry[]`) as the PUBLIC return type (arrays are easier to assert in `expect(...).toHaveLength()`/`.toEqual()` unit tests and easier to serialize for debugging), but internally use `Map`s during computation (as shown in Pattern 2) for O(1) accumulation. Phase 108 can build its own `Map` from the returned array in one line if it wants O(1) lookup at render time.

3. **Should `VizDescriptor` carry a `type`/`isDv` field explicitly, or should `isDv` always be derived from `dynamicViewId !== undefined`?**
   - What we know: the additional_context brief's suggested field list includes an explicit `isDv` boolean; the codebase's own convention (`useFilterScopeSummary.ts:119`) computes `isDv` by presence-check, never as a caller-supplied flag.
   - What's unclear: whether an explicit flag adds safety (catches a caller bug where `dynamicViewId` is accidentally `0` — falsy but defined) or just adds a redundant field that can drift from the derived truth.
   - Recommendation: derive `isDv` internally as `dynamicViewId !== undefined` (matches existing convention exactly) and do NOT add a separate `isDv` field to `VizDescriptor` — one less field to keep in sync. Flag this as a deviation from the additional_context's suggested field list, made deliberately for internal consistency with `useFilterScopeSummary`.

## Sources

### Primary (HIGH confidence — codebase read directly, 2026-07-08)
- `packages/web/src/lib/resolveFilterSet.ts` — column-filter forward resolver
- `packages/web/src/lib/resolveSpatialShapes.ts` — spatial forward resolver
- `packages/web/src/lib/useFilterScopeSummary.ts` — `computeFilterScopeSummary` pure fn + hook (exact dv/spatial forcing rules)
- `packages/web/src/lib/useFilterScopeSummary.spec.ts` — test-fixture convention to mirror
- `packages/web/src/lib/spatialTargets.ts` — `aggregateSpatialTargetsByTable`, `SpatialTarget`, `isSpatialTargetEligible`
- `packages/web/src/components/charts/filterSourceTypes.ts` — `FILTER_PRODUCING_TYPES`, `SPATIAL_DRAWS_SENTINEL`
- `packages/web/src/store/filterStore.ts` — `ActiveFilter` type, `filters`/`dvFilters` shape
- `packages/web/src/store/spatialFilterStore.ts` — `Shape` type, `shapes` shape
- `packages/web/src/store/dashboardLayersStore.ts` — dashboard-wide layer list shape (`DashboardLayerDto[]`)
- `packages/web/src/types/filterSelection.ts` — `FilterSelectionConfig`, `DEFAULT_FILTER_SELECTION`
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — `NON_TRIGGER_TYPES`, both-read-path enumeration (lines 70-83, 208-340), dv override rules (lines 292-293, 297-298, 322-323, 326-327)
- `packages/web/src/components/DashboardsPage.tsx` — widget/layer enumeration pattern (lines 1133-1210), `mapTableIds`/`includedLayerIds` default-to-all-layers logic (lines 1137-1149)
- `packages/web/src/components/charts/MapChartRenderer.tsx` — `includedLayers` useMemo (lines 533-561, confirms empty `includedLayerIds` = ALL layers), `layerNameFor` (lines 768-775)
- `packages/web/src/api/client.ts` — `DashboardLayerDto` shape incl. top-level `filter_scope` (lines 619-654)

### Secondary (MEDIUM confidence)
- None needed — no external claims requiring verification.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all reused modules read directly and byte-verified.
- Architecture: HIGH — the inversion algorithm is a direct, verified mirror of existing forward-resolution code paths (`useFilterScopeSummary`, `useCombinationOrchestrator`); the layer-ownership multiplicity gotcha (Pitfall 3) was independently discovered by reading `MapChartRenderer.tsx`'s `includedLayers` default-to-all-layers behavior, not assumed.
- Pitfalls: HIGH — five pitfalls all traced to specific existing code patterns/comments (dv double-override, per-source list scoping, layer-ownership multiplicity, reference-identity fragility, operator-irrelevance) — none are speculative.

**Research date:** 2026-07-08
**Valid until:** Stable — this domain (in-house pure TS logic with zero external deps) does not go stale on a calendar basis; re-verify only if `resolveFilterSet`/`resolveSpatialShapes`/`useFilterScopeSummary` or the `w:<id>`/`l:<id>` viz-key/ownership conventions change in a future phase.
