# Phase 92: MapChartRenderer Wiring — Research

**Researched:** 2026-06-27
**Domain:** Frontend read-path flip — MapChartRenderer both buildWmsParams call sites
**Confidence:** HIGH — all findings verified from direct code inspection of production source files

---

## Summary

Phase 92 wires the WMS map read path to the `filterCombinationStore`, completing READ-V118-02. The orchestrator (`useCombinationOrchestrator`, Phase 90) currently enumerates only table-bound TRIGGER-TYPE WIDGETS (`w:<widgetId>` keys); it explicitly ignores map layers. Phase 92 has two distinct work areas:

**Area 1 — Orchestrator extension:** Extend `useCombinationOrchestrator` to also enumerate map layers (`l:<layerId>` vizKeys) so their combination views are materialized and ref-counted. The orchestrator is the sole materialize trigger and must own layer combos too.

**Area 2 — MapChartRenderer read swap:** Replace the `viewsKey` selector (which reads `filterViewStore.views[tableId]`) with a `comboViewsKey` selector (which reads `filterCombinationStore.vizToHash["l:<id>"]` → `registry[hash]`). Apply this substitution at BOTH `buildWmsParams` call sites: Effect 2 (ADD/REMOVE layer reconciliation, line ~1229) and Effect 3 (`source.updateParams`, line ~1477). Update both dep arrays.

The dv-bound layer branch (`layer.dynamic_view_id !== null`) stays on its existing `dvFilterViewsKey` / `dvEntry` / `resolvedDvEntry` path — unchanged until Phase 94. Table-bound layers only for Phase 92.

COMBO-V118-04 correctness gate: with default accept-all config, all layers sharing a table produce the same hash → one combination view per table → map renders identically to v1.17 (only view name suffix changes).

**Primary recommendation:** Extend the orchestrator with a `layersKey` dep primitive + layer enumeration loop (parallel to the widgets loop), then swap both MapChartRenderer sites atomically in one commit to avoid split-brain.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| READ-V118-02 | Map WMS layers bind to their combination's view by pointing the WMS request at the correct per-combination materialized view name — filters NEVER in the WMS request. Update BOTH buildWmsParams call sites + add combination key to dep arrays so layers re-request when their bound view changes. | Orchestrator layer extension + comboViewsKey selector + Effect 2 line ~1229 + Effect 3 line ~1477 both swapped. |
| COMBO-V118-04 (cross-cutting) | Default accept-all config → byte-identical render to v1.17 — correctness gate for this phase. | With no filterScope on any layer, all layers on the same table resolve the same hash → single combination view per table → WMS LAYERS param changes only in view name suffix. |
</phase_requirements>

---

## Current WMS Read Path (pre-Phase 92)

### viewsKey selector — MapChartRenderer.tsx lines 556–572

```typescript
// lines 556–559: stable uniqueTableIds derived from includedLayers
const uniqueTableIds = useMemo(() => {
  const ids = Array.from(new Set(includedLayers.map((l) => l.table_id)));
  return ids.sort((a, b) => a - b);
}, [includedLayers]);

// lines 566–572: the reactive primitive key read from filterViewStore.views
// Keyed by tableId (one segment per unique table), NOT per layer
const viewsKey = useFilterViewStore((s) =>
  uniqueTableIds
    .map((id) =>
      `${id}:${s.views[id]?.viewName ?? ''}:${s.views[id]?.materializeVersion ?? 0}:${s.views[id]?.materializing ? '1' : '0'}`
    )
    .join('|')
);
```

This is the dep-key that drives Effect 2 (line 1421) and Effect 3 (line 1498) re-fires when a filter view changes.

### Effect 2 view resolution — MapChartRenderer.tsx lines 1216–1223

```typescript
// Line 1217: imperative snapshot of filterViewStore at effect-fire time
const entry = useFilterViewStore.getState().views[tableId];
const expired = isViewExpired(entry);
const viewName = !expired ? entry?.viewName : undefined;
const materializeVersion = !expired ? entry?.materializeVersion : undefined;

// Line 1223: LAYERS-swap: viewName || rawTableRef (|| not ?? — empty-string falls through)
const wmsConfigInput = { ...cfg, tableId, tableRef: viewName || rawTableRef } as MapWidgetConfig;
```

Then `buildWmsParams(wmsConfigInput, materializeVersion, resolvedDvEntry, resolvedDvVersion, { cb_config: layer.cb_config, track_config: layer.track_config })` at line 1229.

**Dep array at line 1421:**
```typescript
[includedLayers, widgetConfig, imageLoadFunctionFor, tables, viewsKey, dynamicViewsKey, dvFilterViewsKey]
```

### Effect 3 view resolution — MapChartRenderer.tsx lines 1463–1472

```typescript
// Line 1464: same imperative snapshot pattern
const entry = useFilterViewStore.getState().views[tableId];
// Line 1466: suspend gate
if (entry?.materializing) continue;
const expired = isViewExpired(entry);
const viewName = !expired ? entry?.viewName : undefined;
const materializeVersion = !expired ? entry?.materializeVersion : undefined;

// Line 1472: LAYERS-swap (same || pattern)
const wmsConfigInput = { ...cfg, tableId, tableRef: viewName || rawTableRef } as MapWidgetConfig;
```

Then `buildWmsParams(...)` at line 1477.

**Dep array at line 1498:**
```typescript
[filterVersion, viewsKey, dynamicViewsKey, dvFilterViewsKey, includedLayers, tables]
```

### DashboardLayerDto shape — no filterScope field yet

`DashboardLayerDto` (api/client.ts line 613) currently has these top-level fields: `id`, `dashboard_id`, `table_id`, `layer_type`, `position`, `config`, `info_*`, `dynamic_view_id`, `cb_config`, `track_config`, `created_at`, `updated_at`. There is NO `filterScope` field. `filterScope` will be added as a top-level column in Phase 93 (config UI). In Phase 92, `layer.filterScope` is always `undefined` — `resolveFilterSet(undefined, allFilters)` returns `allFilters.slice()` (accept-all, correct default).

The `track_config` and `cb_config` precedent (top-level columns, never nested in `layer.config`) confirms the pattern: `filterScope` WILL be a top-level field when Phase 93 adds it, but Phase 92 does not need it to exist.

---

## Architecture Patterns

### Pattern 1: Orchestrator Layer Enumeration Extension

The orchestrator at `useCombinationOrchestrator.ts` currently:
- Accepts `(dashboardId: number, widgets: WidgetDto[])` — no layers param
- Builds `widgetsKey` from widget IDs+tableIds (stable primitive dep)
- Loops over widgets only; explicitly skips `NON_TRIGGER_TYPES` (includes "map")
- All vizKeys are `"w:<widgetId>"`
- Dep array: `[filterVersion, dashboardId, widgetsKey, ceiling]`

The orchestrator must be extended to also accept layers and produce `"l:<layerId>"` vizKeys.

**Signature extension:**
```typescript
export function useCombinationOrchestrator(
  dashboardId: number,
  widgets: WidgetDto[],
  layers: DashboardLayerDto[],  // NEW — Phase 92
): void
```

**New `layersKey` stable primitive dep (S-02 compliant):**
```typescript
const layersKey = useMemo(
  () =>
    layers
      .filter((l) => l.dynamic_view_id === null || l.dynamic_view_id === undefined) // table-bound only
      .map((l) => `${l.id}:${l.table_id}`)
      .sort()
      .join(","),
  [layers],
);
```

Add `layersKey` to Effect dep array: `[filterVersion, dashboardId, widgetsKey, layersKey, ceiling]`.

**New layer enumeration loop (in STEP A, after the widget loop):**
```typescript
for (const layer of layers) {
  // Skip dv-bound layers — Phase 94 scope
  if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) continue;

  const tableId = layer.table_id;
  const vizKey = `l:${layer.id}`;

  // filterScope is a TOP-LEVEL field (threaded like track_config).
  // In Phase 92, layer.filterScope is always undefined (no config UI yet).
  // resolveFilterSet(undefined, allFilters) = accept-all = same as v1.17.
  const cfg = (layer as any).filterScope as FilterSelectionConfig | undefined;
  const allFilters = (filterState.filters[tableId] ?? []) as ReturnType<typeof resolveFilterSet>;
  const resolved = resolveFilterSet(cfg, allFilters);
  const hash = stableComboHash("table", tableId, resolved);

  if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
    vizKeyToHash.set(vizKey, undefined);
    continue;
  }

  let hm = byTable.get(tableId);
  if (!hm) { hm = new Map(); byTable.set(tableId, hm); }
  let e = hm.get(hash);
  if (!e) { e = { resolved, widgetIds: [] }; hm.set(hash, e); }
  // widgetIds is a misnomer — stores both widget IDs and layer IDs (or rename to "vizIds")
  e.widgetIds.push(layer.id);
  vizKeyToHash.set(vizKey, hash);
}
```

**STEP E extension (vizKey ownership):**

The STEP E cleanup loop currently guards `vizKey.startsWith("w:")`. It needs two changes:
1. The `currentVizKeys` set must include `"l:<layerId>"` keys for the current tick's layers.
2. The orphan-cleanup loops that check `!vizKey.startsWith("w:") continue` must also include "l:" keys — or better, remove the prefix guard and handle both. The simplest change: add `"l:"` layers to `currentVizKeys` exactly as widgets are added.

**CEILING count:** Layer combos count toward the per-table ceiling alongside widget combos (same `byTable` map). This is correct — the ceiling governs total unique views per table regardless of whether they come from widgets or layers.

**Mount site — DashboardsPage.tsx line 449:**
```typescript
// Phase 90 (current):
useCombinationOrchestrator(dashboard.id, widgets);

// Phase 92 (updated):
useCombinationOrchestrator(dashboard.id, widgets, layers);
```

`layers` is already subscribed at line 452 (`useDashboardLayersStore((s) => s.layers)`). Pass it directly to the orchestrator. No new subscriptions needed at the mount site.

### Pattern 2: comboViewsKey Selector (replaces viewsKey)

The new selector for MapChartRenderer is per-layer (not per-unique-tableId), because each layer now has its own `l:<layerId>` vizKey:

```typescript
// Replace the viewsKey selector (lines 556–572) with:
const comboViewsKey = useFilterCombinationStore((s) =>
  includedLayers
    .filter((l) => l.dynamic_view_id === null || l.dynamic_view_id === undefined)
    .map((l) => {
      const hash = s.vizToHash[`l:${l.id}`];
      const entry = hash && !hash.endsWith(":NOFILTER") ? s.registry[hash] : undefined;
      return `${l.id}:${entry?.viewName ?? ""}:${entry?.materializeVersion ?? 0}:${entry?.materializing ? "1" : "0"}`;
    })
    .join("|")
);
```

Key points:
- Scoped to THIS map widget's `includedLayers` — not the whole registry (PITFALL S-02 / C-02)
- Per-layer (not per-unique-tableId) so two layers on the same table with different filterScopes produce separate segments
- Same field structure as the existing `viewsKey` segments (viewName:materializeVersion:materializing)
- dv-bound layers filtered out — they still move `dvFilterViewsKey` and `dynamicViewsKey`
- `":NOFILTER"` check uses `hash.endsWith(":NOFILTER")` — matches the NOFILTER_SENTINEL pattern established in Phase 88

The `uniqueTableIds` useMemo (lines 556–559) becomes dead code once `viewsKey` is removed — delete it.

**NOFILTER check:** `hash.endsWith(":NOFILTER")` is safe. Real hashes contain `|` chars; the empty-filter sentinel `"table:<id>:NOFILTER"` always ends with `:NOFILTER`. Import `NOFILTER_SENTINEL` from `../../lib/stableComboHash` and use template literal: `hash.endsWith(`:${NOFILTER_SENTINEL}`)`.

### Pattern 3: Per-Layer Combo Entry Resolution at Both buildWmsParams Call Sites

Both Effect 2 (line ~1229) and Effect 3 (line ~1477) have near-identical view-resolution blocks. Replace the `filterViewStore.getState().views[tableId]` reads with combo entry reads:

```typescript
// NEW per-layer combo resolution (replaces lines 1217-1220 in Effect 2 + lines 1464-1469 in Effect 3)
const layerVizKey = `l:${layer.id}`;
const comboHash = useFilterCombinationStore.getState().vizToHash[layerVizKey];
const comboEntry =
  comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
    ? useFilterCombinationStore.getState().registry[comboHash]
    : undefined;

// Suspend gate (Effect 3 only — Effect 2 skips via 'continue' if null wmsParams)
if (comboEntry?.materializing) continue;  // Effect 3 only

const isComboExpired = comboEntry ? isViewExpired(comboEntry) : false;
const viewName = comboEntry && !isComboExpired ? comboEntry.viewName : undefined;
const materializeVersion = comboEntry && !isComboExpired ? comboEntry.materializeVersion : undefined;

// LAYERS-swap unchanged (|| not ?? — empty-string falls through to rawTableRef)
const wmsConfigInput = { ...cfg, tableId, tableRef: viewName || rawTableRef } as MapWidgetConfig;
```

`isViewExpired` already exists in MapChartRenderer (imported or locally defined). The `comboEntry` shape (`viewName`, `expiresAt`, `materializing`, `materializeVersion`) matches the `FilterViewEntry` shape that `isViewExpired` expects — they are structurally compatible.

**NOFILTER / first-tick fallback:** When `comboHash` is `undefined` (orchestrator has not yet run, or layer was just added) or NOFILTER (no active filters on this table): `viewName = undefined` → `viewName || rawTableRef = rawTableRef`. WMS request points at the base table. This is identical to today's behavior when no filter view exists. No flash, no error.

### Pattern 4: Updated Dep Arrays

**Effect 2 dep array (line 1421) — replace `viewsKey`:**
```typescript
[includedLayers, widgetConfig, imageLoadFunctionFor, tables, comboViewsKey, dynamicViewsKey, dvFilterViewsKey]
```

**Effect 3 dep array (line 1498) — replace `viewsKey`:**
```typescript
[filterVersion, comboViewsKey, dynamicViewsKey, dvFilterViewsKey, includedLayers, tables]
```

`filterVersion` stays in Effect 3's dep array — it drives the re-fire that triggers the materialize loop (300ms debounce gap between filterVersion bump and combination store write means Effect 3 fires once with base-table params, then again when `comboViewsKey` changes after the orchestrator materializes).

---

## What Stays Unchanged

| Component | Unchanged Path | Reason |
|-----------|---------------|--------|
| `dynamicViewsKey` selector | Lines 585–594 | dv layers stay on `useDynamicViewStore` path |
| `dvFilterViewsKey` selector | Lines 600–609 | dv-filter path unchanged until Phase 94 |
| Effect 2 dv-filter block | Lines 1208–1214 | `resolvedDvEntry` / `resolvedDvVersion` resolution unchanged |
| Effect 3 dv-filter block | Lines 1455–1461 | Same `resolvedDvEntry` / `resolvedDvVersion` logic unchanged |
| Effect 2 `buildWmsParams` 5th arg | Lines 1234 | `{ cb_config: layer.cb_config, track_config: layer.track_config }` unchanged |
| Effect 3 `buildWmsParams` 5th arg | Lines 1482 | Same |
| `filterVersion` in Effect 3 dep | Line 1498 | Keeps the 300ms debounce-gap re-fire for filter changes |
| `shapesKey` selector | Line 613 | Spatial filter path unchanged |
| The `isOldPhase11Config` guard | Lines 1180/1428 | Unchanged |
| `useFilterViewStore` import | Line 62 | Still needed for `dvViews` slice (dv-filter path) |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Combo entry lookup per layer | Custom lookup logic | `useFilterCombinationStore.getState().vizToHash["l:<id>"]` → `registry[hash]` — already exists in Phase 89 |
| Stable primitive key for layers | Manual string concat | Mirror `widgetsKey` useMemo pattern; same sorted `${id}:${tableId}` format |
| NOFILTER check | Custom sentinel comparison | `hash.endsWith(`:${NOFILTER_SENTINEL}`)` — established pattern from Phase 88 |
| View expiry check | Re-implement isViewExpired | `isViewExpired(comboEntry)` — CombinationEntry is structurally compatible (has `expiresAt`) |

---

## Common Pitfalls

### Pitfall 1: Updating Only Effect 3, Missing Effect 2 (the recurring missed-path gotcha)

**What goes wrong:** Effect 2 (ADD/REMOVE reconciliation) and Effect 3 (`source.updateParams`) are independent effects. Both snapshot the view store imperatively at effect-fire time via `getState()`. A developer who only updates Effect 3 leaves Effect 2 reading `filterViewStore.views[tableId]`. When a new layer is added to the map after a filter change, Effect 2 fires and builds the WMS params with the old (all-filters) view name — the new layer shows unfiltered data. This was the exact v1.12 failure mode (Phase 63.1).

**Prevention:** Both call sites are at lines ~1229 and ~1477. Treat them as a pair. The ARCHITECTURE.md and PITFALLS.md explicitly label this "recurring missed-path gotcha." The planner MUST create a task that covers both sites atomically.

### Pitfall 2: Re-render Storm from Non-Primitive Selector (S-02)

**What goes wrong:** If `comboViewsKey` returns a new object/array reference on every store write (e.g., `(s) => includedLayers.map(l => s.registry[s.vizToHash["l:"+l.id]])` — an array of objects), MapChartRenderer re-renders on every registry mutation for every layer on every map widget in the dashboard.

**Prevention:** `comboViewsKey` MUST be a joined primitive string — same pattern as the existing `viewsKey`, `dynamicViewsKey`, `dvFilterViewsKey`. The string only changes when a layer's combo view actually changes. Zustand's default equality is `===` — stable string = no re-render.

### Pitfall 3: comboViewsKey Scoped to All Layers vs This Map's Layers

**What goes wrong:** If `comboViewsKey` is computed over ALL layers in `useDashboardLayersStore` (not `includedLayers`), any combination change for any layer on the dashboard re-fires this map's Effects 2+3, even for layers not on this widget.

**Prevention:** Scope to `includedLayers` only — the same array already used by the existing `viewsKey` selector. `includedLayers` is derived from `widget.config.includedLayerIds` intersected with the store (already established).

### Pitfall 4: layersKey Not in Orchestrator Dep Array

**What goes wrong:** Orchestrator Effect has deps `[filterVersion, dashboardId, widgetsKey, ceiling]`. If `layersKey` is not added, the orchestrator does not re-fire when layers are added/removed/modified. Layer combos are not materialized until the next `filterVersion` bump.

**Prevention:** Add `layersKey` to the Effect dep array. This is necessary even though `filterVersion` will eventually trigger a re-fire — without `layersKey`, a new layer added to the map (dashboard mutation, no filter change) would never get its combination view until the user adds a filter.

### Pitfall 5: vizKey Orphan Cleanup in Orchestrator Missing "l:" Keys

**What goes wrong:** The STEP E orphan-cleanup loop in the orchestrator (`for (const vizKey of Object.keys(prevVizToHash))`) currently guards `if (!vizKey.startsWith("w:")) continue`. If this guard is not updated, `"l:<layerId>"` vizKeys that were removed from the dashboard are never released, causing view leak (refCount stays > 0, view never DROPs).

**Prevention:** Update the guard to include "l:" keys, or better, remove the prefix restriction and handle all vizKeys uniformly. The current `currentVizKeys` set must include both widget AND layer keys.

### Pitfall 6: filterScope Type Assertion on layer

`DashboardLayerDto` does not have a `filterScope` field in Phase 92 (it's added in Phase 93). Reading `(layer as any).filterScope` (or `layer.filterScope as FilterSelectionConfig | undefined`) will be `undefined`. `resolveFilterSet(undefined, allFilters)` returns `allFilters.slice()` — correct accept-all behavior. The type assertion `as any` or casting is necessary until Phase 93 adds the column to `DashboardLayerDto`. The planner should note this as a TODO for Phase 93 type cleanup.

### Pitfall 7: Per-Table Ceiling Counting Layers + Widgets Together

**What goes wrong:** If the byTable map accumulates both widget hashes and layer hashes for the same tableId, a dashboard with many widgets AND layers on the same table may hit the ceiling and fall back to the all-filters view for some combinations, even though the actual unique combinations are fewer than the ceiling.

**Assessment:** This is by design — the ceiling bounds total unique Kinetica views per table, regardless of source. It is NOT a bug. Document it as intended behavior. If a customer hits the ceiling, the fallback (all-filters view) is correct data, just less customized.

---

## Code Examples

### comboViewsKey replacement for viewsKey

```typescript
// Source: ARCHITECTURE.md §"Read path B" + Phase 91 RESEARCH.md "Exact New Selector Pattern"
// Replaces lines 556-572 of MapChartRenderer.tsx

// uniqueTableIds useMemo becomes dead code — delete it.

// Import at top of file (add alongside existing imports):
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { NOFILTER_SENTINEL } from "../../lib/stableComboHash";

// New selector:
const comboViewsKey = useFilterCombinationStore((s) =>
  includedLayers
    .filter((l) => l.dynamic_view_id === null || l.dynamic_view_id === undefined)
    .map((l) => {
      const hash = s.vizToHash[`l:${l.id}`];
      const entry = hash && !hash.endsWith(`:${NOFILTER_SENTINEL}`)
        ? s.registry[hash]
        : undefined;
      return `${l.id}:${entry?.viewName ?? ""}:${entry?.materializeVersion ?? 0}:${entry?.materializing ? "1" : "0"}`;
    })
    .join("|")
);
```

### Effect 2 view resolution swap (line ~1217)

```typescript
// Source: ARCHITECTURE.md §"Read path B: MapChartRenderer" (lines 381-393)
// Replaces lines 1217-1220 of Effect 2

const layerVizKey = `l:${layer.id}`;
const comboHash = useFilterCombinationStore.getState().vizToHash[layerVizKey];
const comboEntry =
  comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
    ? useFilterCombinationStore.getState().registry[comboHash]
    : undefined;
const isComboExpired = comboEntry ? isViewExpired(comboEntry) : false;
const viewName = comboEntry && !isComboExpired ? comboEntry.viewName : undefined;
const materializeVersion = comboEntry && !isComboExpired ? comboEntry.materializeVersion : undefined;
// Line 1223 unchanged: viewName || rawTableRef
```

### Effect 3 view resolution swap (line ~1464)

```typescript
// Same resolution pattern as Effect 2 above, but with suspend gate

const layerVizKey = `l:${layer.id}`;
const comboHash = useFilterCombinationStore.getState().vizToHash[layerVizKey];
const comboEntry =
  comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
    ? useFilterCombinationStore.getState().registry[comboHash]
    : undefined;
// Phase 17-02 suspend gate: skip updateParams while materializing
if (comboEntry?.materializing) continue;
const isComboExpired = comboEntry ? isViewExpired(comboEntry) : false;
const viewName = comboEntry && !isComboExpired ? comboEntry.viewName : undefined;
const materializeVersion = comboEntry && !isComboExpired ? comboEntry.materializeVersion : undefined;
// Line 1472 unchanged: viewName || rawTableRef
```

### Orchestrator layers loop addition (STEP A)

```typescript
// Source: Phase 90 orchestrator pattern (90-03-SUMMARY.md)
// Add after the widget loop in useCombinationOrchestrator.ts STEP A:
for (const layer of layers) {
  if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) continue;
  const tableId = layer.table_id;
  const vizKey = `l:${layer.id}`;
  const cfg = (layer as any).filterScope as FilterSelectionConfig | undefined;
  const allFilters = (filterState.filters[tableId] ?? []) as ActiveFilter[];
  const resolved = resolveFilterSet(cfg, allFilters);
  const hash = stableComboHash("table", tableId, resolved);
  if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
    vizKeyToHash.set(vizKey, undefined);
    continue;
  }
  let hm = byTable.get(tableId);
  if (!hm) { hm = new Map(); byTable.set(tableId, hm); }
  let e = hm.get(hash);
  if (!e) { e = { resolved, widgetIds: [] }; hm.set(hash, e); }
  e.widgetIds.push(layer.id);
  vizKeyToHash.set(vizKey, hash);
}
```

---

## Concrete Integration Points (file:line)

| Integration point | File | Line (current) | Change |
|---|---|---|---|
| `viewsKey` selector | `MapChartRenderer.tsx` | 566 | Replace with `comboViewsKey` from `filterCombinationStore` |
| `uniqueTableIds` useMemo | `MapChartRenderer.tsx` | 556 | Delete (dead code once viewsKey removed) |
| Effect 2 view resolution | `MapChartRenderer.tsx` | 1217 | `filterViewStore.getState().views[tableId]` → `filterCombinationStore.getState().vizToHash["l:<id>"]` + `registry[hash]` |
| Effect 2 dep array | `MapChartRenderer.tsx` | 1421 | `viewsKey` → `comboViewsKey` |
| Effect 3 view resolution + suspend gate | `MapChartRenderer.tsx` | 1464 | Same swap + `comboEntry?.materializing` guard |
| Effect 3 dep array | `MapChartRenderer.tsx` | 1498 | `viewsKey` → `comboViewsKey` |
| Orchestrator signature | `useCombinationOrchestrator.ts` | 71 | Add `layers: DashboardLayerDto[]` param |
| Orchestrator `layersKey` dep | `useCombinationOrchestrator.ts` | 83 | New `useMemo` for `layersKey` |
| Orchestrator STEP A layer loop | `useCombinationOrchestrator.ts` | ~156 | Add layer enumeration after widget loop |
| Orchestrator STEP E `currentVizKeys` | `useCombinationOrchestrator.ts` | ~323 | Add `"l:<layerId>"` keys to `currentVizKeys` set |
| Orchestrator orphan cleanup guards | `useCombinationOrchestrator.ts` | ~329, ~381 | Change `startsWith("w:")` guards to include "l:" keys |
| Orchestrator Effect dep array | `useCombinationOrchestrator.ts` | 404 | Add `layersKey` |
| Mount site | `DashboardsPage.tsx` | 449 | `useCombinationOrchestrator(dashboard.id, widgets, layers)` |

---

## Critical Questions Resolved

### Q1: Orchestrator Extension — How?

The orchestrator's `widgetsKey` useMemo pattern is the model. Add a parallel `layersKey` useMemo filtering to table-bound layers only (`dynamic_view_id === null`). Add a layer enumeration loop in STEP A that mirrors the widget loop — same `byTable` map, same `vizKeyToHash` map, `"l:<id>"` vizKeys. Update STEP E `currentVizKeys` to include layer keys. Remove the `startsWith("w:")` guards from the orphan-cleanup loops (or change to `startsWith("w:") || startsWith("l:")`). Add `layersKey` to Effect deps.

The orchestrator is passed `layers` from its DashboardsPage mount site. `layers` is already subscribed there. No new subscriptions added.

### Q2: comboViewsKey — Exact Shape

Scoped to `includedLayers` (this map widget's layers), filtered to table-bound only, per-layer (not per-unique-tableId), same `${id}:${viewName}:${materializeVersion}:${materializing}` segment format. Replaces `viewsKey` in BOTH dep arrays. `dynamicViewsKey` and `dvFilterViewsKey` are unchanged.

### Q3: Per-Layer, Not Per-Map

Confirmed. A single map widget has N layers each potentially on different tables with different future `filterScope` values. Each layer has its own `l:<layerId>` vizKey → its own hash → its own combo entry. The WMS request PER LAYER uses THAT layer's combo view name. `buildWmsParams` is called inside a `for (const layer of includedLayers)` loop in both Effects — already per-layer.

### Q4: NOFILTER / First-Tick → Base

When `comboHash` is `undefined` or NOFILTER: `viewName = undefined` → `viewName || rawTableRef = rawTableRef`. The WMS request points at the base table schema.table. This is byte-identical to the current pre-filter behavior. The `||` (not `??`) operator is already in place at lines 1223 and 1472 — preserves this behavior.

### Q5: dv-Bound Layers

`dynamic_view_id !== null` layers are skipped in the orchestrator layer loop. In MapChartRenderer, the `resolvedDvEntry` / `resolvedDvVersion` block (lines 1208–1214 and 1455–1461) is unchanged. The `comboViewsKey` selector filters dv-bound layers out. These layers continue to read from `dynamicViewsKey` / `dvFilterViewsKey`. No Phase 92 change touches dv-bound layers.

### Q6: COMBO-V118-04 Byte-Identical Correctness

With no `filterScope` on any layer (Phase 92 state): `resolveFilterSet(undefined, allFilters)` → `allFilters.slice()` for every layer on a given table → `stableComboHash("table", tableId, allFilters)` is the SAME hash for all layers on that table → orchestrator creates ONE combination view per table. `comboViewsKey` for those layers all point to the same `entry.viewName`. WMS LAYERS param = that view name. The data is the same view as `_kbi_filt_...` today (same filters, same table); only the view name suffix differs (`_c<hash8>` appended). Tile content is byte-identical. Correctness test: create a spec in `MapChartRenderer.spec.tsx` that mocks `filterCombinationStore` with `vizToHash["l:1"] = hash` + `registry[hash] = { viewName: "_kbi_combo_test_c1234abcd", ... }` and asserts `source.updateParams` is called with `LAYERS = "_kbi_combo_test_c1234abcd"`, while `filterViewStore` is NOT consulted.

### Q7: filterScope in Phase 92

`DashboardLayerDto` has no `filterScope` field in Phase 92. The orchestrator reads `(layer as any).filterScope` which is `undefined`. `resolveFilterSet(undefined, allFilters)` → accept-all. The MapChartRenderer does not read `filterScope` at all — it only reads the resolved view name from the combination store. Phase 93 adds the column to `DashboardLayerDto` and the SQLite schema; Phase 92 just needs the plumbing to handle `undefined` (which it does naturally).

---

## COMBO-V118-04 Correctness Test

The correctness test is a new spec block in `MapChartRenderer.spec.tsx`:

```
describe("Phase 92 / COMBO-V118-04 — default (accept-all) WMS read via filterCombinationStore", () => {
  it("Test 92-A: when filterCombinationStore.vizToHash["l:1"] is set, Effect 3 calls source.updateParams with LAYERS=<comboViewName>", ...)
  it("Test 92-B: when vizToHash["l:1"] is undefined (no combo yet / NOFILTER), Effect 3 uses rawTableRef as LAYERS", ...)
  it("Test 92-C: when comboEntry.materializing=true, Effect 3 skips updateParams for that layer (suspend gate)", ...)
  it("Test 92-D: filterViewStore is NOT consulted for table-bound layers (pure consumer lock extension)", ...)
})
```

Test 92-D is the critical one: it asserts that `_filterViewState.views` is never read for table-bound layers in Effect 3 — only `filterCombinationStore` is. This mirrors the Test 16-E static pure-consumer-lock test but for the NEW combination-store path.

---

## Existing Spec Infrastructure to Extend

| File | Tests to update | New tests to add |
|------|----------------|-----------------|
| `MapChartRenderer.spec.tsx` | Test 16-D (Effect 3 updateParams fires when viewsKey changes) — update to use `filterCombinationStore` mock instead of `filterViewStore`. Test 17-02-1 (suspend gate) — update mock to use combination store materializing flag. Test 17-02-2 (materializing clears) — update mock. Test 17-02-3 (cross-tableId isolation) — update to cross-layerId isolation. | Describe block "Phase 92 / COMBO-V118-04" with tests 92-A through 92-D above. |

The existing `filterViewStore` vi.mock at MapChartRenderer.spec.tsx line 391 stays — it is still needed for the `dvViews` slice (dv-filter tests). Add a new `filterCombinationStore` vi.mock alongside it, using the same selector-aware pattern established in Phase 91's `WidgetRenderer.spec.tsx`:

```typescript
let mockVizToHash: Record<string, string | undefined> = {};
let mockRegistry: Record<string, any> = {};

vi.mock("../../store/filterCombinationStore", () => {
  const hook = (selector: (s: any) => any) =>
    selector({ vizToHash: mockVizToHash, registry: mockRegistry, combinationVersion: 0 });
  (hook as any).getState = () => ({ vizToHash: mockVizToHash, registry: mockRegistry, combinationVersion: 0 });
  return { useFilterCombinationStore: hook, NOFILTER_SENTINEL: "NOFILTER", MAX_COMBINATION_VIEWS_PER_TABLE: 10 };
});
```

---

## State of the Art

| Old Approach | New Approach | When Changed | Impact |
|---|---|---|---|
| `filterViewStore.views[tableId]` lookup per layer (one segment per unique tableId) | `filterCombinationStore.vizToHash["l:<layerId>"]` → `registry[hash]` (one segment per layer) | Phase 92 | Per-layer combination views; future filterScope support; dv path unchanged |
| `viewsKey` selector (per-unique-tableId segments) | `comboViewsKey` selector (per-layer segments) | Phase 92 | More granular re-fire trigger; allows different layers on same table to have different views |
| Orchestrator enumerates widgets only | Orchestrator enumerates widgets + table-bound layers | Phase 92 | Layers get their combination views materialized + ref-counted |

**Pure consumer lock preserved:** `MapChartRenderer` MUST NOT import `materializeFilter`, `dropFilterView`, `setView`, `markMaterializing`, or `bumpMaterializeVersion`. The Test 16-E static assertion (MapChartRenderer.spec.tsx line 1584) must remain green. Phase 92 only adds imports for `useFilterCombinationStore` and `NOFILTER_SENTINEL` — both are READ-ONLY.

---

## Open Questions / Planner Decisions Required

1. **Orchestrator `widgetIds` field naming:** The `byTable` map currently uses `{ resolved, widgetIds: number[] }`. In Phase 92, `widgetIds` stores both widget IDs and layer IDs. The planner must decide: rename to `vizIds` (semantic change) or leave as `widgetIds` (misleading but avoids churn). Recommendation: leave as-is for Phase 92 (it is an internal orchestrator type, not exposed); rename in a cleanup pass if desired.

2. **Orchestrator `currentVizKeys` guard cleanup:** The STEP E loops use `if (!vizKey.startsWith("w:")) continue` to skip non-widget keys. After Phase 92, both "w:" and "l:" keys exist. Options: (a) change guard to `if (!vizKey.startsWith("w:") && !vizKey.startsWith("l:")) continue`; (b) remove the guard entirely and handle all keys uniformly; (c) keep the "w:" guard for the widget-cleanup loop and add a separate layer-cleanup loop. Recommendation: option (a) is the minimal change; option (b) is cleaner but needs care that no other vizKey prefixes exist yet (dv keys are "dv:xxx" but Phase 92 does not add them).

3. **filterScope type on `DashboardLayerDto`:** The cast `(layer as any).filterScope` is needed until Phase 93. The planner should note this as a TODO comment in the orchestrator code, to be cleaned up when Phase 93 adds the column. Alternatively, add `filterScope?: FilterSelectionConfig` to `DashboardLayerDto` in Phase 92 (as an optional field) so the cast is not needed — this is a safe additive change since the field is optional. Recommendation: add the optional field to `DashboardLayerDto` in Phase 92 to avoid `as any` casts; it will have a value only after Phase 93 adds the SQLite column.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (packages/web) |
| Config file | packages/web/vite.config.ts |
| Quick run command | `cd packages/web && npx vitest run src/components/charts/MapChartRenderer.spec.tsx src/hooks/useCombinationOrchestrator.spec.ts` |
| Full suite command | `cd packages/web && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-V118-02 | Effect 3 calls source.updateParams with combo view name (not filterViewStore view name) | unit | Quick run command | No — Wave 0 gap (new describe block in MapChartRenderer.spec.tsx) |
| READ-V118-02 | Effect 3 suspend gate when combo entry materializing | unit | Quick run command | No — Wave 0 gap (test 92-C) |
| READ-V118-02 | Effect 2 ADD/REMOVE uses combo view name when building new OL source | unit | Quick run command | No — Wave 0 gap (test 92-A analog for Effect 2) |
| COMBO-V118-04 | No filterScope → base table WMS when no active filters (NOFILTER path) | unit | Quick run command | No — Wave 0 gap (test 92-B) |
| COMBO-V118-04 | filterViewStore NOT consulted for table-bound layers (pure consumer lock) | static + unit | Quick run command | Partial — Test 16-E static check stays; extend to assert filterCombinationStore IS consulted |
| READ-V118-02 (orchestrator) | Orchestrator emits "l:<layerId>" vizKeys and acquires/releases combo views for layers | unit | Quick run command | No — Wave 0 gap (extend useCombinationOrchestrator.spec.ts) |

### Sampling Rate
- **Per task commit:** `cd packages/web && npx vitest run src/components/charts/MapChartRenderer.spec.tsx src/hooks/useCombinationOrchestrator.spec.ts`
- **Per wave merge:** `cd packages/web && npx vitest run`
- **Phase gate:** Full suite green + tsc --noEmit clean + theme-guard green + zero server diff

### Wave 0 Gaps

- [ ] New `describe("Phase 92 / COMBO-V118-04 — default accept-all WMS read via filterCombinationStore")` block in `MapChartRenderer.spec.tsx` — 4 tests (92-A through 92-D)
- [ ] `filterCombinationStore` vi.mock in `MapChartRenderer.spec.tsx` — new mock alongside existing `filterViewStore` mock
- [ ] Update existing Test 16-D in `MapChartRenderer.spec.tsx` — change from `filterViewStore` mock population to `filterCombinationStore` mock
- [ ] Update Tests 17-02-1/2/3 in `MapChartRenderer.spec.tsx` — change suspend gate mocks to use combination store
- [ ] New orchestrator layer scenarios in `useCombinationOrchestrator.spec.ts` — at minimum: "layer combo materialized", "layer NOFILTER skipped", "layer combo shared with widget on same table" (dedup)
- [ ] `NOFILTER_SENTINEL` export added to `filterCombinationStore` mock (or imported from stableComboHash in mock factory)

---

## Sources

### Primary (HIGH confidence — direct code inspection)

- `packages/web/src/components/charts/MapChartRenderer.tsx` (lines 1–80, 550–640, 1200–1240, 1390–1500) — current viewsKey selector, both buildWmsParams call sites with view resolution blocks, both dep arrays, dv-filter path
- `packages/web/src/hooks/useCombinationOrchestrator.ts` (lines 1–405) — full orchestrator; widgets-only enumeration; vizKey "w:<id>" pattern; STEP A/B/C/D/E structure; dep array `[filterVersion, dashboardId, widgetsKey, ceiling]`
- `packages/web/src/store/dashboardLayersStore.ts` — `DashboardLayerDto` consumed; layers shape
- `packages/web/src/api/client.ts` (lines 613–643) — `DashboardLayerDto` type shape; confirms no `filterScope` field exists yet; `track_config`/`cb_config` are top-level columns (precedent)
- `packages/web/src/components/DashboardsPage.tsx` (lines 440–454) — orchestrator mount site; `layers` subscription already at line 452
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` (lines 385–430, 1540–1700) — existing `filterViewStore` mock pattern; Tests 16-D, 17-02-1/2/3 that must be updated
- `.planning/phases/88-foundation-pure-logic-types/88-01-SUMMARY.md` — stableComboHash contract, NOFILTER sentinel `"table:<id>:NOFILTER"` format
- `.planning/phases/89-store-server-foundation/89-01-SUMMARY.md` — CombinationEntry shape, `vizToHash["l:<layerId>"]` key format established, `acquire`/`release`/`setVizHash` API
- `.planning/phases/90-combination-orchestrator/90-03-SUMMARY.md` — DUAL-TRIGGER design, STEP A/E pattern, dep array `[filterVersion, dashboardId, widgetsKey, ceiling]`, `"w:<widgetId>"` vizKey, layers SKIPPED (Phase 92 scope)
- `.planning/phases/91-widgetrenderer-wiring/91-RESEARCH.md` — comboKey pattern (single primitive selector), NOFILTER → base-table path, Phase 91 precedent for this phase
- `.planning/phases/91-widgetrenderer-wiring/91-01-SUMMARY.md` — confirmed COMBO-V118-04 complete for widgets; Phase 92 is the parallel for layers
- `.planning/research/ARCHITECTURE.md` (lines 380–410, 545–562) — comboViewsKey definition, both buildWmsParams sites, dep arrays
- `.planning/research/PITFALLS.md` — Pitfall 3 (MapChartRenderer missed path), S-02 re-render storm

### Secondary (MEDIUM confidence)

- `.planning/REQUIREMENTS.md` — READ-V118-02 + COMBO-V118-04 exact text
- `.planning/STATE.md` — v1.18 locked decisions; filterScope TOP-LEVEL layer field confirmation

---

## Metadata

**Confidence breakdown:**
- Current WMS read path code: HIGH — read directly from file
- Orchestrator extension pattern: HIGH — mirrors established widget pattern in production code
- comboViewsKey selector: HIGH — directly specified in ARCHITECTURE.md + matches Phase 91 pattern
- Both buildWmsParams swap: HIGH — lines quoted exactly from file
- filterScope field absence: HIGH — DashboardLayerDto type read directly
- Test gaps: HIGH — confirmed no filterCombinationStore mock in MapChartRenderer.spec.tsx

**Research date:** 2026-06-27
**Valid until:** Stable (no moving dependencies — all upstream phases complete)
