# Phase 42: Standalone Legend Chart Type - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-facing "Legend" widget that mirrors a chosen map widget's `<LayersLegendPanel />` content as a separate tile in the dashboard grid. Phase 42 ships:

1. **New `legend` chart type** registered in `kinetica_bi/src/components/charts/definitions/legend.ts` + `definitions/index.ts` (mirrors v1.4 Phase 23 `info-card` pattern). Registry entry: `type='legend'`, `label='Legend'`, `icon='LG'`, `fields=[]`, `defaultConfig={}`, `usesAggregation=false`, `supportsDrillDown=false`.
2. **`<WidgetRenderer />` early-return** for `widget.type === 'legend'` — mounts `<LegendRenderer widget={widget} />` BEFORE AggregatedWidgetRenderer (mirrors info-card short-circuit at WidgetRenderer.tsx:229-232).
3. **New `<LegendRenderer />` component** at `kinetica_bi/src/components/charts/LegendRenderer.tsx`:
   - Reads `widget.config.sourceMapWidgetId: number | undefined`
   - Reads dashboard widgets via `DashboardContextProvider` (existing pattern from Phase 30) to find `bound = widgets.find(w => w.id === sourceMapWidgetId && w.type === 'map')`
   - Subscribes to `useDashboardLayersStore` via `legendKey` primitive selector (PITFALL S-02 lock, Phase 41 pattern)
   - Computes `resolvedLegendLayers` via the SHARED helper `lib/resolveLegendLayers.ts` (Phase 42 lifts Phase 41's derivation; both consumers call it)
   - Renders `<LayersLegendPanel layers={...} corner='top-right' collapsed={false} onToggleCollapse={()=>{}} showChevron={false} />`
   - On orphan: renders empty-state copy "Source map widget not found. Reconfigure the legend." + `[Reconfigure]` button that opens the widget config modal (uses existing widget settings flow).
4. **NEW `lib/resolveLegendLayers.ts` shared helper** — extracted from Phase 41's inline `resolvedLegendLayers` `useMemo`:
   ```typescript
   export function resolveLegendLayers(
     storeLayers: DashboardLayerDto[],
     includedLayerIds: number[] | undefined,
   ): ResolvedLegendLayer[];
   ```
   Honors Phase 12 empty-array-means-all-on semantic. Phase 41 MapChartRenderer refactored to call this helper (zero-behavior-change refactor).
5. **NEW `LegendConfigPanel` CustomConfigPanel** for the legend chart type — single labeled `<select>` "Source map widget" populated from dashboard's map widgets at runtime. Disabled with placeholder "— no map widgets on this dashboard —" + inline hint "Add a map widget first, then bind the legend." when no map widgets exist.
6. **`<LayersLegendPanel />` extension** (additive, backward-compat): new optional `showChevron?: boolean` prop (default `true`). When `false`, header still shows "Layers" label but no chevron and click is a no-op. Phase 41 in-map mount continues to omit the prop (uses default `true`); Phase 42 LegendRenderer passes `false`.
7. **Auto-pick first map widget on creation**: ChartConfigPanel pre-selects the first available map widget on Apply when `sourceMapWidgetId` is undefined and at least one map widget exists. If no map widgets exist, `sourceMapWidgetId` stays undefined and the widget renders orphan state.

In scope: legend chart type registry + `<LegendRenderer />` + `LegendConfigPanel` + `lib/resolveLegendLayers.ts` helper + Phase 41 refactor to call the helper + `<LayersLegendPanel showChevron?>` extension + spec coverage.

Out of scope: cross-dashboard legend mirroring (WIDGET-V17-03 lock), corner-anchor picker for standalone widget (deferred — fixed grid-cell context), session-only collapse for standalone widget (deferred — same reason), live UAT (Phase 43), CB-only filter on eligible map widgets (deferred — all map widgets eligible).

</domain>

<decisions>
## Implementation Decisions

### Chart type registry entry

```typescript
// kinetica_bi/src/components/charts/definitions/legend.ts
const legend: ChartTypeDefinition = {
  type: "legend",
  label: "Legend",
  icon: "LG",                      // 2-char text icon mirroring info-card's "IC"
  fields: [],                       // CustomConfigPanel drives the picker; no declarative fields
  defaultConfig: {},                // sourceMapWidgetId starts undefined → orphan render or auto-pick at Apply time
  usesAggregation: false,
  supportsDrillDown: false,
  CustomConfigPanel: LegendConfigPanel,
};
```

`definitions/index.ts` imports `registerLegend` and calls it in `registerAllChartTypes()`.

### WidgetRenderer early-return

Mirror the info-card short-circuit at `WidgetRenderer.tsx:229-232`:

```typescript
} else if (widget.type === "legend") {
  // Phase 42 (WIDGET-V17-01): legend short-circuits BEFORE AggregatedWidgetRenderer
  // so it does not try to read widget.config.sql (legend defaultConfig is {} — no SQL).
  body = <LegendRenderer widget={widget} />;
}
```

`tables` prop NOT passed — LegendRenderer reads layer data from `useDashboardLayersStore`, not from `tables`. (Operator-bound source map widget is identified via `DashboardContextProvider.widgets`.)

### sourceMapWidgetId dropdown UX

**Picker UI: CustomConfigPanel with single dropdown** (mirrors MapConfigPanel + DynamicViewsModal patterns since options depend on runtime dashboard state):

```typescript
// kinetica_bi/src/components/charts/LegendConfigPanel.tsx
function LegendConfigPanel({ config, onChange }: ConfigPanelProps): JSX.Element {
  const widgets = useDashboardContext().widgets;
  const mapWidgets = widgets.filter(w => w.type === "map");
  const sourceMapWidgetId = config.sourceMapWidgetId as number | undefined;
  const hasMapWidgets = mapWidgets.length > 0;

  return (
    <div className="config-group" role="group" aria-labelledby="legend-source-label">
      <label id="legend-source-label" className="config-group-label">SOURCE MAP WIDGET</label>
      <select
        className="ds-select"
        aria-label="Source map widget"
        disabled={!hasMapWidgets}
        value={String(sourceMapWidgetId ?? "")}
        onChange={(e) => onChange({ ...config, sourceMapWidgetId: Number(e.target.value) })}
      >
        {!hasMapWidgets && <option value="">— no map widgets on this dashboard —</option>}
        {hasMapWidgets && sourceMapWidgetId === undefined && <option value="">— select —</option>}
        {mapWidgets.map(w => (
          <option key={w.id} value={String(w.id)}>{w.title || `Map widget #${w.id}`}</option>
        ))}
      </select>
      {!hasMapWidgets && (
        <div className="config-hint">Add a map widget first, then bind the legend.</div>
      )}
    </div>
  );
}
```

**Eligibility**: only `w.type === "map"` widgets on the same dashboard. Cross-dashboard binding NOT offered (WIDGET-V17-03 lock).

**Default selection on creation**: `defaultConfig.sourceMapWidgetId` stays undefined. ChartConfigPanel's Apply path pre-selects `mapWidgets[0].id` when `sourceMapWidgetId === undefined && mapWidgets.length > 0`. When no map widgets exist, stays undefined → orphan render.

**`DashboardContext`**: existing context from Phase 30 (DashboardContextProvider) carries the dashboard's widgets list. LegendConfigPanel reads via `useDashboardContext()`. **Required prop, not optional** — mirror Phase 30 lock for missing-context loud failure.

### Orphan state

**Trigger conditions** (any one triggers orphan render):
1. `sourceMapWidgetId === undefined`
2. `widgets.find(w => w.id === sourceMapWidgetId) === undefined` (bound widget deleted)
3. Found widget's `type !== "map"` (bound to non-map; defensive — shouldn't happen given picker eligibility filter, but handle the case)

All three render the SAME orphan UI (single state; no per-trigger differentiation).

**Orphan UI**:

```tsx
<div className="legend-widget-orphan" role="status">
  <div className="legend-widget-orphan-message">
    Source map widget not found. Reconfigure the legend.
  </div>
  <button
    type="button"
    className="legend-widget-orphan-reconfigure"
    onClick={() => /* open widget config modal — use existing widget settings flow */}
  >
    Reconfigure
  </button>
</div>
```

**Copy**: verbatim "Source map widget not found. Reconfigure the legend." per WIDGET-V17-04 lock.

**Reconfigure CTA**: inline `[Reconfigure]` button opens the widget config modal via the existing widget-settings flow. Planner identifies the exact open-config-modal handler (likely a prop from DashboardsPage or a context-based callback). NO auto-opening of the modal on orphan; operator-initiated only.

**On bound-map deletion**: legend stays in orphan state. NO auto-rebind to another map widget. NO cascade-delete of the legend widget. Operator must explicitly pick a new source map widget.

### Layer set + visibility

**Mirror bound map's includedLayerIds exactly**. LegendRenderer reads `bound.config.includedLayerIds` and filters store layers identically to Phase 41 in-map panel:

- Empty `includedLayerIds` array (Phase 12 semantic) → all store layers visible.
- Non-empty array → only those layer IDs.
- Mirrors in-map panel parity by construction (shared helper).

### Shared helper extraction — `lib/resolveLegendLayers.ts`

Phase 42 is the 2nd consumer of the derivation. Per the Phase 40 precedent (lifted `lib/trackConfig.ts` when Phase 40 became the 2nd consumer of `coalesceTrackConfig`), extract Phase 41's inline `useMemo` derivation:

```typescript
// kinetica_bi/src/lib/resolveLegendLayers.ts
import type { DashboardLayerDto } from "../api/client";

export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};

/**
 * Filter store layers by widget config's includedLayerIds and project to ResolvedLegendLayer[].
 * Honors Phase 12 empty-array-means-all-on semantic.
 *
 * Phase 41 in-map MapChartRenderer + Phase 42 standalone LegendRenderer both call this.
 */
export function resolveLegendLayers(
  storeLayers: DashboardLayerDto[],
  includedLayerIds: number[] | undefined,
): ResolvedLegendLayer[] {
  const filtered = includedLayerIds && includedLayerIds.length > 0
    ? storeLayers.filter(l => includedLayerIds.includes(l.id))
    : storeLayers;
  return filtered.map(layer => ({ layer, visible: true }));
}
```

**Phase 41 refactor**: MapChartRenderer's inline `resolvedLegendLayers` useMemo body replaced with `resolveLegendLayers(useDashboardLayersStore.getState().layers, widgetConfig.includedLayerIds)`. **Zero-behavior-change refactor**; Phase 41 tests must still pass without modification.

**`ResolvedLegendLayer` type** moves from `LayersLegendPanel.tsx` to `lib/resolveLegendLayers.ts`. `LayersLegendPanel.tsx` imports the type from the new location (back-compat: also re-export from LayersLegendPanel if existing imports rely on it). Spec file: `lib/resolveLegendLayers.spec.ts` with ~6 tests covering empty array, undefined, populated array, all-on semantic, mismatched IDs.

### legendKey subscription

LegendRenderer mirrors MapChartRenderer's `legendKey` selector verbatim:

```typescript
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map((l) => `${l.id}:${(l.config as {renderMode?: string})?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`)
    .join("|")
);
```

`resolvedLegendLayers` computed via `useMemo` with deps `[legendKey, bound?.config.includedLayerIds]`. Reads layers via `useDashboardLayersStore.getState().layers` inside the useMemo body to avoid array-equality re-render storms (PITFALL S-02 lock).

### `<LayersLegendPanel showChevron?>` extension

Additive, backward-compat. Default `true` to preserve Phase 41 behavior. When `false`:
- Header renders the "Layers" text label only (no chevron icon).
- Header div has no `onClick` / no `role='button'` / no `aria-expanded` / no `aria-controls`.
- Cursor on header is `default`, not `pointer`.
- Body always renders (collapsed prop ignored when showChevron=false).

Phase 41 in-map mount continues to NOT pass `showChevron` (defaults to true; current behavior preserved by spec).

Phase 42 LegendRenderer passes `showChevron={false}` + `collapsed={false}` + `onToggleCollapse={()=>{}}`. The corner prop is still required by the type signature; pass `corner='top-right'` (irrelevant — LegendRenderer's outer container fills the grid cell with `position: static`).

`LayersLegendPanel.spec.tsx` adds tests:
- showChevron=true (default): chevron renders, click toggles, aria-expanded present
- showChevron=false: no chevron, header has no onClick, click is no-op

### Standalone widget rendering — no corner anchor, no collapse, always expanded

Standalone Legend widget fills its dashboard-grid cell (no `position: absolute` corner anchor). LegendRenderer's outer container is a plain `<div className="legend-widget-body">` with no positioning concerns beyond filling the cell (`width: 100%; height: 100%`).

No collapse state in LegendRenderer. No corner-anchor field in `defaultConfig`. The widget is always-rendered-in-full whenever bound to a valid map widget.

### Widget creation flow

When operator adds a "Legend" widget from the chart type registry:
1. `defaultConfig` is `{}` (no `sourceMapWidgetId` initially).
2. ChartConfigPanel opens with the LegendConfigPanel showing the source-map-widget dropdown.
3. **Auto-pick on Apply**: if `sourceMapWidgetId === undefined` AND `mapWidgets.length > 0`, ChartConfigPanel's Apply handler sets `sourceMapWidgetId = mapWidgets[0].id` BEFORE persisting. If `mapWidgets.length === 0`, stays undefined → widget renders orphan state with reconfigure CTA.
4. After Apply: widget persists via existing `PATCH /api/widgets/:id` flow.

**Note**: planner identifies the exact ChartConfigPanel Apply hook for auto-pick. If injecting at the panel level is awkward, alternative is `LegendConfigPanel` doing the auto-pick via a `useEffect([mapWidgets])` that fires `onChange({...config, sourceMapWidgetId: mapWidgets[0].id})` when sourceMapWidgetId is undefined and mapWidgets is non-empty. Planner's discretion.

### CSS class names

- `.legend-widget-body` — LegendRenderer's outer container (fills grid cell)
- `.legend-widget-orphan` — orphan-state container
- `.legend-widget-orphan-message` — orphan message text
- `.legend-widget-orphan-reconfigure` — reconfigure button

LegendRenderer reuses `<LayersLegendPanel>` for the layer-list rendering, so the existing `.layers-legend-panel*` classes from Phase 41 apply automatically.

### Live updates lock (WIDGET-V17-05)

Operator edits a CB color or break label in LayersModal → autosave debounce (Phase 39) → `useDashboardLayersStore.updateLayer(id, patch)` → reference-stable mutation → `legendKey` primitive moves → LegendRenderer's `useMemo` recomputes → `<LayersLegendPanel>` re-renders with updated swatches/labels. Identical mechanism to Phase 41 in-map panel; shared store + shared selector guarantees parity.

Spec test (LegendRenderer.spec.tsx): mount LegendRenderer with bound source map widget; call `useDashboardLayersStore.getState().updateLayer(layerId, { cb_config: '{...new color...}' })`; assert legend swatch reflects new color without page reload or remount.

### Claude's Discretion

Areas explicitly left for the planner / executor:

- **Auto-pick injection site**: ChartConfigPanel Apply handler vs LegendConfigPanel `useEffect`. Planner picks based on which path requires the least cross-cutting change. Recommendation: `LegendConfigPanel` useEffect — keeps the auto-pick logic local to the legend chart type's panel.
- **Reconfigure button → modal open mechanism**: identify how DashboardsPage opens widget settings today (likely a prop callback from WidgetRenderer to DashboardsPage, OR a context-provided callback). Planner threads the existing mechanism. NO new modal infrastructure.
- **`ResolvedLegendLayer` re-export from `LayersLegendPanel.tsx`**: keep a back-compat re-export `export type { ResolvedLegendLayer } from "../lib/resolveLegendLayers"` if existing test imports depend on it. Planner checks and adjusts.
- **`DashboardContext` shape verification**: confirm DashboardContextProvider already provides `widgets` array (Phase 30) and that LegendConfigPanel can call `useDashboardContext()` from inside ChartConfigPanel. If context isn't threaded down to CustomConfigPanel, alternative is to add `widgets` to ConfigPanelProps — planner picks the cleanest path.
- **Spec file location**: `kinetica_bi/src/components/charts/LegendRenderer.spec.tsx` + `LegendConfigPanel.spec.tsx`. Planner picks file organization (one file vs two; if LegendConfigPanel is small, may inline in LegendRenderer.spec.tsx).
- **CSS file location**: append `.legend-widget*` to global.css (matches Phase 41 precedent).
- **Phase 41 refactor scope**: Phase 42's first task is the `lib/resolveLegendLayers.ts` extraction + Phase 41 MapChartRenderer refactor. Treat this as a pure-refactor task with zero-behavior-change requirement; Phase 41's 14 MapChartRenderer specs must still pass without modification (acceptance criterion grep + vitest).
- **WidgetDto.type union**: `WidgetDto.type` is currently a string union; verify 'legend' needs to be added to the union vs string type accepts it organically. Planner checks.
- **Legend widget's default sizing in dashboard grid**: react-grid-layout default sizing for new widgets. Planner picks a reasonable default (e.g., 4×6 grid units — small but readable for a typical 3-CB-layer legend).
- **Empty-state when bound map has 0 layers**: `<LayersLegendPanel>` already renders "No layers configured on this widget." for empty layer set. Same message applies when bound map has 0 layers. No special standalone-widget message.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 42 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Standalone 'Legend' Chart Type" — WIDGET-V17-01..05 literal requirements
- `.planning/ROADMAP.md` §"Phase 42: Standalone Legend Chart Type" — Goal + 4 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — milestone scope

### Phase 41 dependencies (CANONICAL — Phase 42 implementer reads first)
- `.planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md` — `<LayersLegendPanel>` props, legendKey selector formula, ResolvedLegendLayer shape, CSS conventions
- `.planning/phases/41-layerslegendpanel-in-map-overlay/41-01-SUMMARY.md` — component + helper actually shipped
- `.planning/phases/41-layerslegendpanel-in-map-overlay/41-02-SUMMARY.md` — MapChartRenderer mount + legendKey shipped

### v1.4 Phase 23 info-card precedent (CANONICAL — registry pattern)
- `kinetica_bi/src/components/charts/definitions/info-card.ts` — registry entry shape Phase 42 mirrors
- `kinetica_bi/src/components/charts/definitions/index.ts` — registerAllChartTypes pattern Phase 42 extends
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:225-235` — early-return ladder Phase 42 extends
- `kinetica_bi/src/components/charts/InfoCardRenderer.tsx` — sibling renderer pattern (component + spec organization)

### Phase 30 DashboardContext precedent
- `kinetica_bi/src/components/DashboardContext.tsx` — DashboardContextProvider providing widgets array; Phase 42 LegendConfigPanel reads via useDashboardContext()
- Phase 30 lock: widgets prop required (not optional) so missing-context errors are loud at compile time

### Phase 40 helper-extraction precedent
- `kinetica_bi/src/lib/trackConfig.ts` — Phase 40 lifted from inline to shared module when Phase 40 became the 2nd consumer. Phase 42 follows the same pattern for `lib/resolveLegendLayers.ts`.

### Phase 12 includedLayerIds semantic
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx:64-85` — `includedLayerIds` Phase 12 semantic: empty array = all-on (lazy/inclusive default). Phase 42 LegendRenderer + shared helper honor this.

### Existing code (Phase 42 modifies + extends)
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition`, `ConfigPanelProps`, `registerChartType`. Phase 42 extends with `legend` entry; verify `ConfigPanelProps` is enough or needs `widgets` addition.
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:225-235` — early-return ladder; Phase 42 adds `else if (widget.type === "legend")` branch
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:546-562` — current `legendKey` + `resolvedLegendLayers` useMemo + `legendCollapsed` useState; Phase 42 refactors lines 546-557 to call `lib/resolveLegendLayers.ts`
- `kinetica_bi/src/components/LayersLegendPanel.tsx` — pure presentational component; Phase 42 adds optional `showChevron?: boolean` prop (default `true`)
- `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` — add showChevron tests
- `kinetica_bi/src/store/dashboardLayersStore.ts` — useDashboardLayersStore + reference-stable updateLayer (Phase 42 subscribes via legendKey)
- `kinetica_bi/src/api/client.ts:481` — DashboardLayerDto shape
- `kinetica_bi/src/api/client.ts` — WidgetDto type (verify 'legend' union extension needed)
- `kinetica_bi/src/styles/global.css` — append `.legend-widget*` selectors

### v1.4 Phase 19 helper module pattern
- `kinetica_bi/src/lib/mapInfoConfig.ts` — defaults + null-coalescer helpers Phase 41 mirrored; Phase 42's `lib/resolveLegendLayers.ts` follows the pure-module convention

### TD-V14-WKB-SPIKE
- `.planning/PROJECT.md` §"Carried-in tech debt" — N/A for Phase 42 (no spatial columns surface in legend widget)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`<LayersLegendPanel />`** (Phase 41) — Phase 42 LegendRenderer mounts this verbatim with `showChevron={false}`.
- **`useDashboardLayersStore`** (`store/dashboardLayersStore.ts`) — Phase 42 LegendRenderer subscribes via legendKey primitive selector.
- **`useDashboardContext`** (`components/DashboardContext.tsx`) — Phase 42 LegendConfigPanel reads `widgets` array.
- **`getLegendPanelEnabled` + `getLegendPanelCorner`** (`lib/legendPanelConfig.ts`) — NOT used by Phase 42 (standalone widget always renders; no corner anchor). Listed for awareness only.
- **`info-card` chart type definition** (`definitions/info-card.ts`) — registry entry shape Phase 42 mirrors.
- **WidgetRenderer early-return ladder** at lines 225-235 — Phase 42 extends.
- **`coalesceCbConfig`** (`lib/cbConfig.ts`) — Phase 42 doesn't call directly (LayersLegendPanel handles internally), but listed for awareness.
- **react-grid-layout** — existing dashboard grid; Phase 42 widget plays nicely with grid resize/drag.

### Established Patterns

- **Chart type registry + register pattern** — locked since Phase 12; Phase 42 extends.
- **CustomConfigPanel for runtime-dependent options** (MapConfigPanel, DynamicViewsModal Edit panel) — Phase 42 LegendConfigPanel follows.
- **`WidgetRenderer` early-return ladder for non-aggregated widget types** (map, records, info-card) — Phase 42 adds legend.
- **`DashboardContextProvider.widgets` required prop** (Phase 30 lock) — Phase 42 LegendConfigPanel + LegendRenderer both consumers.
- **legendKey primitive selector** (Phase 41) — Phase 42 mirrors.
- **PITFALL S-02 primitive-selector pattern** — Phase 42 LegendRenderer subscribes via primitive string only.
- **Reference-stable Zustand `updateLayer`** (`dashboardLayersStore.ts:36-46`) — Phase 42 inherits.
- **Helper-module extraction on 2nd consumer** (Phase 40 lifted `lib/trackConfig.ts`) — Phase 42 lifts `lib/resolveLegendLayers.ts`.

### Integration Points

- **NEW FILE:** `kinetica_bi/src/components/charts/definitions/legend.ts` — chart type registry entry
- **NEW FILE:** `kinetica_bi/src/components/charts/LegendRenderer.tsx` — renderer component
- **NEW FILE:** `kinetica_bi/src/components/charts/LegendRenderer.spec.tsx`
- **NEW FILE:** `kinetica_bi/src/components/charts/LegendConfigPanel.tsx` — CustomConfigPanel for source-map-widget dropdown
- **NEW FILE:** `kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx` (or inline in LegendRenderer.spec.tsx)
- **NEW FILE:** `kinetica_bi/src/lib/resolveLegendLayers.ts` — shared derivation helper
- **NEW FILE:** `kinetica_bi/src/lib/resolveLegendLayers.spec.ts`
- **EXTEND:** `kinetica_bi/src/components/charts/definitions/index.ts` — register legend
- **EXTEND:** `kinetica_bi/src/components/charts/WidgetRenderer.tsx:225-235` — add `else if (widget.type === "legend")` branch
- **REFACTOR (zero-behavior-change):** `kinetica_bi/src/components/charts/MapChartRenderer.tsx:546-557` — replace inline derivation with `resolveLegendLayers(...)` call
- **EXTEND:** `kinetica_bi/src/components/LayersLegendPanel.tsx` — add optional `showChevron?: boolean` prop
- **EXTEND:** `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` — showChevron prop tests
- **EXTEND:** `kinetica_bi/src/api/client.ts` — verify WidgetDto.type union includes 'legend' (extend if needed)
- **EXTEND:** `kinetica_bi/src/styles/global.css` — append `.legend-widget*` selectors

### Risks & Anti-Patterns to Avoid

- **Don't subscribe to `useDashboardLayersStore.layers` array directly** — primitive `legendKey` only (PITFALL S-02).
- **Don't read `cb_config` directly** — `<LayersLegendPanel>` handles internally via `coalesceCbConfig`. LegendRenderer just passes resolved layers.
- **Don't add SQL fetch logic to LegendRenderer** — legend has no SQL (defaultConfig is `{}`). Don't accidentally drop into AggregatedWidgetRenderer's path.
- **Don't add `legend` as fallthrough to AggregatedWidgetRenderer** — must short-circuit in WidgetRenderer's early-return ladder (mirrors info-card).
- **Don't mount via OL `addOverlay`** — N/A; standalone widget has no OL container. Listed for paranoia.
- **Don't auto-rebind sourceMapWidgetId when bound widget is deleted** — orphan state until operator picks. Operator intent preservation.
- **Don't show widgets of any type other than 'map' in the dropdown** — eligibility filter is `w.type === "map"`. WIDGET-V17-03 lock.
- **Don't differentiate orphan trigger states** — single UI for all three triggers (undefined / not found / non-map). One state; one copy.
- **Don't break Phase 41 MapChartRenderer tests during refactor** — `lib/resolveLegendLayers.ts` extraction is zero-behavior-change; existing 14 MapChartRenderer specs must still pass without modification.
- **Don't add corner-anchor field to legend chart type's defaultConfig** — standalone widget fills the grid cell; no corner anchor concept.
- **Don't add collapse state to LegendRenderer** — always-expanded in grid cell. `<LayersLegendPanel collapsed={false}>` + `showChevron={false}`.
- **Don't add server-side changes** — frontend-only phase.
- **Don't fail typecheck if WidgetDto.type union doesn't include 'legend'** — planner extends the union if needed before adding the early-return branch.
- **Don't read `widget.config.includedLayerIds` from the LEGEND widget** — read from the BOUND MAP WIDGET's config.includedLayerIds. The legend widget itself has no layers.

</code_context>

<specifics>
## Specific Ideas

- **Single shared `<LayersLegendPanel>` consumed by both surfaces** — guarantees content parity by construction. Operator's edits in LayersModal flow through one path (store mutation → legendKey → both consumers re-render).
- **`lib/resolveLegendLayers.ts` extraction on 2nd-consumer trigger** — Phase 40 precedent. Avoids divergence; centralizes the includedLayerIds filter rule.
- **Auto-pick first map widget on creation** — saves a click in the common single-map-dashboard case. Operator adding a Legend widget to "my dashboard with The Map" doesn't need to pick from a 1-element dropdown.
- **Orphan stay-state (no auto-rebind)** — operator's prior binding intent preserved. Auto-rebind could silently re-aim a legend at the wrong map; operator notices the orphan and chooses explicitly.
- **`showChevron={false}` for standalone widget** — collapse is a floating-overlay UX concept; in a grid cell it's noise. Hide the affordance; widget always shows full content.
- **2-char text icon 'LG'** — matches info-card's 'IC' pattern. No FontAwesome dependency check needed; consistent visual rhythm with existing chart-type icons.
- **Cross-dashboard NOT offered** — WIDGET-V17-03 lock. Simplifies subscription (single dashboard's store), eliminates cross-dashboard re-render concerns, defers complexity.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-dashboard legend mirroring** — locked OUT by WIDGET-V17-03. v1.8+ if operator demand surfaces; would require cross-dashboard layer-store federation.
- **Corner-anchor picker for standalone widget** — N/A in grid-cell context; standalone widget fills the cell. No floating positioning concept.
- **Session-only collapse for standalone widget** — same N/A reason.
- **CB-only filter on eligible map widgets** — all map widgets eligible regardless of layer content. Operator may want a legend for raster-only or heatmap-only maps too (header + render-mode chip rows, no swatches).
- **Custom title pre-fill** — defaultConfig title undefined; operator sets manually or sees 'Legend' fallback. v1.8 may offer a 'mirror source map's title' default.
- **Preview pane in LegendConfigPanel** — show a live preview of the legend before Apply. Defer; reconfigure cycle is cheap enough.
- **Auto-rebind on bound-widget-deletion** — orphan stays until operator picks. Auto-rebind explicitly rejected.
- **Cascade-delete legend widgets when bound map deleted** — orphan stays; operator may want to re-aim. Explicitly rejected.
- **Differentiated orphan trigger UIs** — single UI for all three triggers (undefined / not found / non-map). v1.8 may differentiate.
- **Legend widget icon as FontAwesome glyph** — 2-char text 'LG' for v1.7. v1.8 may upgrade to a glyph if the registry's icon shape evolves.
- **Auto-open config modal on orphan render** — explicit operator click required; auto-open feels intrusive. v1.8 may add an opt-in setting.
- **`<LayersLegendPanel showHeader?>` to drop the entire header for standalone widget** — Phase 42 keeps header with 'Layers' label (showChevron=false hides only the chevron). v1.8 may add showHeader=false if operator demand surfaces.
- **Multi-map legend (bind to N map widgets, render N legends)** — v1.8+; cross-cuts the single-source assumption.
- **Live-resync when operator reconfigures bound map's includedLayerIds** — already covered by legendKey + includedLayerIds useMemo dep; no extra work.

</deferred>

---

*Phase: 42-standalone-legend-chart-type*
*Context gathered: 2026-05-22*
