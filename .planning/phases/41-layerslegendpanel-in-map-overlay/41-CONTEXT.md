# Phase 41: LayersLegendPanel + In-Map Overlay - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-facing visual surface showing which layers are configured on a map widget and, for classbreak layers, what color → label rows define their style. Phase 41 ships:

1. **New shared component `<LayersLegendPanel />`** at `kinetica_bi/src/components/LayersLegendPanel.tsx` — pure presentational, props-driven, NO internal store subscriptions. Reusable by both the in-map overlay (this phase) and Phase 42's standalone Legend widget.
2. **Props contract**: `{ layers: ResolvedLegendLayer[], collapsed?: boolean, onToggleCollapse?: () => void }`. `ResolvedLegendLayer` = `{ layer: DashboardLayerDto, visible: boolean }`. Caller composes the array from `useDashboardLayersStore` filtered by `widget.config.includedLayerIds`.
3. **In-map overlay mount**: React child of `MapChartRenderer`'s `<div className="widget-map">` container (NOT OL `addOverlay` — popup DOM-tracking lesson from v1.4/v1.6 already documented at MapChartRenderer.tsx:1811-1831). CSS-positioned `position: absolute` to a configurable corner of `.widget-map`.
4. **MapConfigPanel additions**:
   - `[ ] Show Layers Panel` checkbox writing `MapWidgetConfig.legendPanelEnabled?: boolean` (default `false`).
   - Conditional `<select>` "Panel corner" with 4 options writing `MapWidgetConfig.legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'` (default `'top-right'`). Only visible when `legendPanelEnabled === true`.
5. **`legendKey` primitive selector** — joined string of per-layer summary fields (`${id}:${renderMode}:${cb_config_breaks_length}:${cb_config_serialized}`). Mirrors `viewsKey` (line 491), `dynamicViewsKey` (line 510), `shapesKey` (line 523) at MapChartRenderer.tsx. PITFALL S-02 lock — no array-equality re-render storms.
6. **Per-render-mode panel layout**:
   - Raster + heatmap layers: header row only (layer name + render-mode chip). NO swatch row.
   - Classbreak layers: header row + N break-rows where each break-row = `[color swatch] {break.label || break.value}` and `<other>` rows show literal `<other>` verbatim.
   - Empty CB layer (`cb_config === null` OR `breaks.length === 0`): header row + italic gray hint "No breaks configured".
   - Empty widget (`includedLayerIds` resolves to 0 layers OR all layers off): panel renders header + empty body "No layers configured on this widget."
7. **Collapse interaction**: click anywhere on header row toggles expand/collapse. Default `expanded` on first show. Collapse state is session-only (component-local `useState` in the in-map consumer site — NOT persisted to `MapWidgetConfig`). Header shows literal `Layers` label + `▾`/`▸` chevron.
8. **Display order**: store order (rendering order, bottom-up — matches LayersModal). Only layers visible on this widget per `widget.config.includedLayerIds` (Phase 12 semantic: empty array = all on).
9. **Z-index**: panel z=1000; below MapDrawToolbar + MapZoomToolbar (z=1001 per V15-P-17 lock) so tool clicks always win.
10. **`getLegendPanelEnabled` + `getLegendPanelCorner` helpers** in `kinetica_bi/src/lib/legendPanelConfig.ts` mirror `mapInfoConfig.ts` pattern (defaults + null coalescer + type-narrow).
11. **No production-code change in MapChartRenderer's existing OL setup** beyond adding the React-tree mount; existing `lastEmittedParamsRef` fingerprint is unaffected (this phase doesn't change WMS emission). No new fingerprint scope.

In scope: `<LayersLegendPanel />` shared component + `legendKey` primitive selector + in-map overlay mount in MapChartRenderer + MapConfigPanel toggle + corner picker + `legendPanelConfig.ts` helpers + persistence round-trip through PATCH + spec coverage.

Out of scope: standalone Legend widget (Phase 42 — consumes `<LayersLegendPanel />` against a different layer source), live UAT (Phase 43), drag-to-reposition (deferred), classbreak numeric-range computation (deferred), heatmap colormap swatch (deferred — render-mode chip only).

</domain>

<decisions>
## Implementation Decisions

### `ResolvedLegendLayer` shape — full DTO + visibility

```typescript
export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};
```

- `layer`: full DTO so the component can read `name`, `cb_config`, `config.renderMode` (parsed from JSON), `config.pointColor` if a future swatch ships, etc., without forcing the caller to derive intermediate fields.
- `visible`: `boolean` — `true` if the layer is included on the current widget (or this consumer doesn't care about visibility — Phase 42 Legend widget passes `true` always).
- Pure data shape: no DOM refs, no callbacks, no derived display strings. Component handles all formatting.

Contour layers are NOT excluded by the panel — they're filtered out upstream by the caller (Phase 39 render-mode filter removed contour from the picker, so contour layers shouldn't exist in v1.7 anyway; if any legacy contour layer slips through, render as raster-style header row).

### Per-render-mode rendering

| Render mode | Header row | Body rows |
|-------------|-----------|-----------|
| `raster` | `{layer.name}` + `[Raster]` chip | (none — header only) |
| `heatmap` | `{layer.name}` + `[Heatmap]` chip | (none — header only) |
| `classbreak` (configured) | `{layer.name}` + `[Class Break]` chip | N rows of `[swatch] {label || value}` |
| `classbreak` (empty cb_config) | `{layer.name}` + `[Class Break]` chip | italic gray hint "No breaks configured" |
| `contour` (legacy) | `{layer.name}` + `[Contour]` chip | (none — header only) |

**Render-mode chip styling**: small pill, neutral background, matches existing component-library chip patterns (e.g., FilterBar chip styling).

**Color swatch**: 12×12 px (or similar; planner's discretion within reason) `<span>` with `background-color` style + 1px border + 2px border-radius. AARRGGBB color from `break.color`; rendered via `#${normalizeAARRGGBB(color, "FF000000")}` or `rgba(...)` if alpha < FF (planner picks the most-readable approach).

**`<other>` row**: rendered as `[swatch] <other>` verbatim — no titlecasing. Mirrors Phase 39's read-only chip semantics.

**Label vs value fallback**: if `break.label` is empty string OR undefined, show `break.value`. For numeric values, use `String(value)`. For categorical values, use the string verbatim including `<other>`. NO numeric-range computation (e.g., no "≤ 10" or "10–25" rendering) — defer to v1.8.

### Anchor corner UX

Operator picks via a 4-option `<select>` in MapConfigPanel beneath the "Show Layers Panel" toggle:

```
[✓] Show Layers Panel
Panel corner: [Top-right (default) ▾]
              [Top-left           ]
              [Bottom-right       ]
              [Bottom-left        ]
```

- The `<select>` only renders when `legendPanelEnabled === true`. Hidden by default.
- Persisted as `MapWidgetConfig.legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'` (string union).
- Default `'top-right'` applied via `getLegendPanelCorner(config)` helper from `lib/legendPanelConfig.ts` so legacy widgets pre-Phase-41 backward-compat without migration.
- CSS positioning: panel gets `position: absolute` + computed offset based on corner: `top: 8px; right: 8px` for `'top-right'`, etc. 8px offset chosen to match existing toolbar offsets in `.widget-map`.

### Persisted field types — `lib/legendPanelConfig.ts` helpers

Mirror `kinetica_bi/src/lib/mapInfoConfig.ts` pattern:

```typescript
export function getLegendPanelEnabled(config: MapWidgetConfig): boolean {
  return config.legendPanelEnabled ?? false;
}

export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];

export function getLegendPanelCorner(config: MapWidgetConfig): LegendPanelCorner {
  const v = config.legendPanelCorner;
  return LEGEND_PANEL_CORNERS.includes(v as LegendPanelCorner) ? (v as LegendPanelCorner) : 'top-right';
}
```

Spec file `lib/legendPanelConfig.spec.ts` — pure unit tests covering defaults + validation.

`MapWidgetConfig` (in `wmsUrlBuilder.ts`) extended with two new optional fields:
- `legendPanelEnabled?: boolean`
- `legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'`

Both nullable / optional for backward-compat with legacy widget config blobs.

### Empty / no-layers state

When `legendPanelEnabled === true` AND filtered layers array is empty:
- Panel still renders (header visible).
- Body shows italic gray text "No layers configured on this widget."
- Operator sees the toggle is on but the widget needs layers.

### `legendKey` primitive selector

The in-map overlay's consumer site in `MapChartRenderer.tsx` uses a `legendKey` primitive (`string`) selector against `useDashboardLayersStore` mirroring the existing pattern:

```typescript
// Mirrors viewsKey/dynamicViewsKey/shapesKey at lines 491, 510, 523.
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map((l) => `${l.id}:${l.config?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`)
    .join("|")
);
```

- Joined per-layer string includes layer id + renderMode + raw cb_config JSON string.
- Changes when ANY layer is added/removed/renamed/reconfigured (renderMode swap, cb_config edit).
- Does NOT change on filter-view updates, dynamic-view updates, shape changes — those have separate keys.
- Primitive `string` return → React.useState equality short-circuits re-renders unless the joined key moves.

Re-rendering cascade:
1. Operator edits a CB color in LayersModal → debounced (Phase 39 autosave) → store.updateLayer fires.
2. Reference-stable update at `dashboardLayersStore.ts:36-46` only mutates the matching layer object.
3. `legendKey` re-computes; new value differs from previous; React re-renders the consumer.
4. Consumer re-builds `ResolvedLegendLayer[]` from store + widget.config.includedLayerIds.
5. `<LayersLegendPanel layers={...} />` re-renders with new break rows.

### Layer filter + display order

```typescript
const includedLayerIds = widget.config.includedLayerIds as number[] | undefined;
const layersInStoreOrder = useDashboardLayersStore.getState().layers;
const filtered = (includedLayerIds && includedLayerIds.length > 0)
  ? layersInStoreOrder.filter(l => includedLayerIds.includes(l.id))
  : layersInStoreOrder;  // Phase 12 semantic: empty array = all on
const resolved: ResolvedLegendLayer[] = filtered.map(layer => ({
  layer,
  visible: true,  // visible-only path always passes true
}));
```

- Filter to widget-visible layers only (no "hidden" chip; no "N hidden" footer).
- Order: store order (rendering order, bottom-up). Matches LayersModal. Operator sees stack top-to-bottom in panel.

### Collapse interaction + default

- Default state: **expanded** on first show. Operator sees what the panel contains.
- Click anywhere on header row toggles. Chevron icon (`▾` expanded, `▸` collapsed) indicates state visually.
- Collapse state is **session-only**, stored as `useState<boolean>(false)` in the consumer site (MapChartRenderer). NOT persisted to `MapWidgetConfig`. Mirrors Phase 35 dv `expandedRowIds` session-local pattern.
- Header: `[chevron] Layers` left-aligned. Click target = entire header `<div>`. Cursor: pointer.

### MapConfigPanel placement

The new `[ ] Show Layers Panel` toggle + corner picker live in `MapConfigPanel.tsx` in a NEW section beneath the existing INFO POPUP section:

```
LAYERS PANEL
  [ ] Show Layers Panel
  Panel corner: [select ▾]   (only when checkbox checked)
```

- Section-group `<div className="config-group" role="group" aria-labelledby="map-legend-panel-label">`.
- Persists via existing `onChange({ ...config, legendPanelEnabled: bool, legendPanelCorner: corner })` pattern (Phase 12 onChange chain → debounced PATCH /api/widgets/:id).

### Z-index stacking

```
.widget-map  (relative positioning)
├── popup (z auto; OL moves it to canvas viewport)
├── widget-map-canvas (z auto)
├── MapZoomToolbar (z 1001)
├── MapDrawToolbar (z 1001)
├── LayersLegendPanel (z 1000)        ← Phase 41
└── overlays (reconfigure / empty; z auto)
```

Tool buttons (z=1001) always win clicks over the legend panel (z=1000). Panel does NOT block draw-mode clicks because z=1000 sits below the toolbar control row at z=1001.

### CSS class names

- Panel container: `.layers-legend-panel`
- Header: `.layers-legend-panel-header`
- Body: `.layers-legend-panel-body`
- Layer row: `.layers-legend-panel-layer`
- Break row: `.layers-legend-panel-break-row`
- Color swatch: `.layers-legend-panel-swatch`
- Empty state: `.layers-legend-panel-empty`
- Render-mode chip: `.layers-legend-panel-mode-chip`

Per-corner positioning via modifier classes: `.layers-legend-panel--top-right`, `.layers-legend-panel--top-left`, `.layers-legend-panel--bottom-right`, `.layers-legend-panel--bottom-left`.

### MapChartRenderer mount site

Mount as a SIBLING of MapDrawToolbar inside `<div className="widget-map">`, AFTER the canvas + toolbars in JSX order (so it appears later in source for sibling positioning predictability):

```tsx
<div className="widget-map">
  {/* popup container (must stay at index 0) */}
  <div ref={popupContainerRef} ... />

  {/* OL canvas */}
  <div ref={containerRef} className="widget-map-canvas" />

  {/* Toolbars */}
  <MapZoomToolbar ... />
  <MapDrawToolbar ... />

  {/* Phase 41: in-map legend overlay (React child, NOT OL addOverlay) */}
  {getLegendPanelEnabled(widgetConfig) && (
    <LayersLegendPanel
      layers={resolvedLegendLayers}
      corner={getLegendPanelCorner(widgetConfig)}
      collapsed={legendCollapsed}
      onToggleCollapse={() => setLegendCollapsed(c => !c)}
    />
  )}

  {/* reconfigure / empty overlays */}
  ...
</div>
```

`corner` prop drives the modifier class for absolute positioning. `collapsed` + `onToggleCollapse` from local `useState`.

### Claude's Discretion

Areas explicitly left for the planner / executor:

- **File location for `<LayersLegendPanel />`**: `kinetica_bi/src/components/LayersLegendPanel.tsx` (per REQUIREMENTS.md PANEL-V17-01) vs `kinetica_bi/src/components/charts/LayersLegendPanel.tsx`. Per requirements, top-level `components/` is the spec; the component is reused by Phase 42's legend widget so it's not chart-specific.
- **Render-mode chip styling**: tailwind classes vs custom CSS. Planner picks based on existing chip patterns in the codebase (e.g., FilterBar chip uses inline-block badge style).
- **Color swatch exact size**: 12×12 px recommended; planner can adjust 10–16 px range. Should be readable but compact.
- **CSS file location**: append to existing global stylesheet vs new `LayersLegendPanel.module.css`. Planner picks based on existing convention.
- **Default classbreak header chip text**: `Class Break` vs `CB` vs `Classbreak`. Recommendation: `Class Break` (two words, title-case — matches the render-mode picker label in KineticaWmsLayerForm).
- **`getLegendPanelEnabled` / `getLegendPanelCorner` helper file location**: `kinetica_bi/src/lib/legendPanelConfig.ts` (new module) or appended to existing `kinetica_bi/src/lib/mapInfoConfig.ts`. Planner picks; if appended, rename consideration deferred.
- **`legendKey` formula exact**: planner can adjust per-layer summary (e.g., include `layer.name` if name changes should re-render, include `widget.config.includedLayerIds.join(",")` to react to visibility toggles). Recommendation: include layer.id + renderMode + cb_config; rely on widget.config.includedLayerIds being a separate dep at the consumer site (changes via onChange flow → MapChartRenderer re-renders naturally).
- **Empty-state copy exact wording**: planner picks final phrasing for "No layers configured on this widget." / "No breaks configured".
- **Spec file location**: `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` + MapChartRenderer.spec.tsx additions + MapConfigPanel.spec.tsx additions. Planner organizes test surface.
- **A11y attrs**: `role="region"` + `aria-label="Map layer legend"` for the panel; chevron button has `aria-expanded` + `aria-controls`. Planner finalizes.
- **Panel max-height + scroll**: if many layers + CB breaks, the panel may exceed `.widget-map` height. Recommendation: `max-height: calc(100% - 24px)` + `overflow-y: auto` so it scrolls inside the corner. Planner picks final styling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 41 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"LayersLegendPanel + In-Map Overlay" — PANEL-V17-01..07 literal requirements
- `.planning/ROADMAP.md` §"Phase 41: LayersLegendPanel + In-Map Overlay" — Goal + 5 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — milestone scope

### Phase 38 dependencies (CANONICAL)
- `.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md` — cb_config JSON shape lock; coalesceCbConfig helper

### Phase 39 patterns to mirror
- `kinetica_bi/src/components/charts/CbConfigForm.tsx` — break-row rendering, color swatch idiom, `<other>` chip styling, palette colors
- `.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md` — `<other>` default-ON decision, value-fallback rule

### Phase 27/29/35 PITFALL S-02 pattern (CRITICAL)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:491` — `viewsKey` primitive selector
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:510` — `dynamicViewsKey` primitive selector
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:523` — `shapesKey` primitive selector
- Phase 41 `legendKey` follows the same idiom

### React-tree-mount lesson (CRITICAL)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:1811-1831` — Phase 35 post-VERIFY lesson: OL `addOverlay` physically moves DOM out of React's tracked tree; getHostSibling crashes if a conditional sibling later tries `insertBefore`. Phase 41 panel MUST be React-tree-mounted, not `addOverlay`.
- `.planning/phases/35-widget-binding-and-pipeline/STATE.md` lock — popup at position 0 of widget-map children (Phase 41 panel goes LATER in JSX so no conflict).

### v1.5 V15-P-17 toolbar lock
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:1864-1893` — MapZoomToolbar + MapDrawToolbar are SIBLINGS to OL canvas (NOT OL controls); z=1001 lock. Phase 41 panel mirrors the sibling pattern, z=1000.

### v1.4 Phase 19 helper module precedent
- `kinetica_bi/src/lib/mapInfoConfig.ts` — `getInfoEnabled`/`getInfoRadiusPx`/`getInfoPopupWidthPx`/`getInfoPopupHeightPx` defaults + null-coalescer pattern. Phase 41 `lib/legendPanelConfig.ts` mirrors.

### Store + DTO references
- `kinetica_bi/src/store/dashboardLayersStore.ts` — `useDashboardLayersStore` + reference-stable `updateLayer`
- `kinetica_bi/src/api/client.ts:481` — `DashboardLayerDto.cb_config: string | null`
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:65-134` — `MapWidgetConfig` type (Phase 41 extends with `legendPanelEnabled` + `legendPanelCorner`)
- `kinetica_bi/src/lib/cbConfig.ts` — `coalesceCbConfig`, `CbBreak`, `CbConfig`, `PALETTE_COLORS` (legend swatches match Phase 39 form palette)

### MapConfigPanel integration
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — INFO POPUP section pattern (Phase 22 CONFIG-V14-04) Phase 41 mirrors for LAYERS PANEL section
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — existing spec test patterns for config-toggle additions

### MapChartRenderer integration
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:1809-1908` — `<div className="widget-map">` JSX block, Phase 41 mounts panel as a sibling of toolbars
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — spec patterns

### Phase 12 visibility semantics
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx:64-85` — `includedLayerIds` Phase 12 semantic: empty array = all-on (lazy/inclusive default). Phase 41 filter mirrors.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useDashboardLayersStore`** (`store/dashboardLayersStore.ts`) — reference-stable `updateLayer`; primitive-selector-safe.
- **`useDashboardLayersStore.layers`** — single source of truth; Phase 41 consumer uses `legendKey` primitive selector against it.
- **`coalesceCbConfig`** (`lib/cbConfig.ts`) — Phase 41 panel uses to parse `layer.cb_config` JSON → `CbConfig`.
- **`PALETTE_COLORS`** (`lib/cbConfig.ts`) — palette used by Phase 39 form; legend swatches match the form's emitted colors (since they read from `cb_config.breaks[].color`).
- **`normalizeAARRGGBB`** (`lib/colorHex.ts` or similar) — Phase 41 panel uses for swatch color string normalization (8-char hex output).
- **`MapWidgetConfig`** (`lib/wmsUrlBuilder.ts:65-134`) — extended with `legendPanelEnabled` + `legendPanelCorner` optional fields.
- **`MapConfigPanel` INFO POPUP section pattern** (Phase 22) — Phase 41 mirrors for the LAYERS PANEL section.
- **`MapChartRenderer` JSX layout** — `<div className="widget-map">` sibling-mount pattern for toolbars; Phase 41 mounts panel here.
- **`getInfoEnabled` + `getInfoRadiusPx` helper pattern** (`lib/mapInfoConfig.ts`) — Phase 41 `getLegendPanelEnabled` + `getLegendPanelCorner` mirror exactly.
- **PITFALL S-02 primitive-selector pattern** (`MapChartRenderer.tsx:491,510,523`) — `legendKey` follows the same idiom.

### Established Patterns

- **Pure presentational shared components** — `<InfoPopup />`, `<InfoCard />` (v1.4 Phase 23) — Phase 41 ships its component in the same shape; props-only, no internal store subscriptions.
- **Caller composes the props** — `<InfoSelectionView />` parent reads stores then passes derived props to `<InfoPopup />`; Phase 41 MapChartRenderer reads store + widget.config then passes `ResolvedLegendLayer[]` to `<LayersLegendPanel />`.
- **MapWidgetConfig optional fields with null-coalescer helpers** — `mapInfoConfig.ts` precedent locked in v1.4 Phase 19; Phase 41 follows.
- **MapConfigPanel `<div className="config-group">` section pattern** with `role="group"` + `aria-labelledby` — Phase 41 LAYERS PANEL section uses the same structure.
- **Reference-stable Zustand updates** — `useDashboardLayersStore.updateLayer` already does this; legendKey primitive selector works correctly because identity changes only when the relevant layer changes.
- **Session-only `useState` for ephemeral UI state** — `expandedRowIds` (Phase 35), `selectedShapeId` (Phase 29), `previewRanSinceLastSave` (Phase 34). Phase 41 `legendCollapsed` follows.
- **MapChartRenderer toolbar sibling pattern** (V15-P-17) — `<MapZoomToolbar>` + `<MapDrawToolbar>` siblings to OL canvas, NOT OL controls. Phase 41 panel mirrors.
- **`includedLayerIds` empty-array-means-all-on semantic** (Phase 12) — Phase 41 layer-filter uses this rule.

### Integration Points

- **NEW FILE:** `kinetica_bi/src/components/LayersLegendPanel.tsx` — pure presentational shared component
- **NEW FILE:** `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` — companion spec
- **NEW FILE:** `kinetica_bi/src/lib/legendPanelConfig.ts` — `getLegendPanelEnabled` + `getLegendPanelCorner` + type union
- **NEW FILE:** `kinetica_bi/src/lib/legendPanelConfig.spec.ts` — companion spec
- **EXTEND:** `kinetica_bi/src/lib/wmsUrlBuilder.ts` `MapWidgetConfig` type — add `legendPanelEnabled?: boolean` + `legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'`
- **EXTEND:** `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — LAYERS PANEL section with toggle + conditional corner picker
- **EXTEND:** `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — toggle/picker tests
- **EXTEND:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — `legendKey` primitive selector + `resolvedLegendLayers` computation + `<LayersLegendPanel />` mount in `<div className="widget-map">` JSX + local `legendCollapsed` state
- **EXTEND:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — panel visibility + corner + collapse tests + legendKey change → re-render tests
- **(optional)** CSS: append `.layers-legend-panel*` selectors to existing global stylesheet OR new module CSS

### Risks & Anti-Patterns to Avoid

- **Don't mount panel via OL `addOverlay`** — v1.4/v1.6 popup DOM-tracking lesson (MapChartRenderer.tsx:1811-1831). React-tree-mount only.
- **Don't subscribe to `useDashboardLayersStore` inside `<LayersLegendPanel />`** — PANEL-V17-01 lock; pure presentational. Caller subscribes via `legendKey`.
- **Don't use `useDashboardLayersStore(s => s.layers)` directly in MapChartRenderer** — non-primitive selector causes re-render storms. Use `legendKey` joined string.
- **Don't break the V15-P-17 z=1001 toolbar invariant** — Phase 41 panel z=1000 (lower) so tool clicks always win.
- **Don't persist collapse state to SQLite** — PANEL-V17-06 explicitly says session-only.
- **Don't render contour layers with classbreak-style rows** — contour is dead code path post-Phase 39; if any legacy contour layer exists, render header row only.
- **Don't auto-compute numeric ranges in legend** — deferred to v1.8. Show `break.value` verbatim.
- **Don't titlecase `<other>`** — render literal verbatim to match Phase 39 read-only chip semantics.
- **Don't include `widget.config.includedLayerIds` in `legendKey`** — that's a separate dep at the consumer site; `legendKey` is the store-layer key, not the widget-visibility key.
- **Don't add panel to popup-position-0 invariant** — Phase 41 panel goes AFTER toolbars in JSX, AFTER the existing reconfigure/empty overlays. Popup remains at index 0.
- **Don't change `lastEmittedParamsRef` fingerprint** — Phase 41 doesn't touch WMS emission; fingerprint unaffected. No new regression tests on fingerprint.
- **Don't add new server vitest specs** — frontend-only phase.
- **Don't break the `MapWidgetConfig` shape compatibility** — both new fields are optional; legacy widget config blobs continue to type-check + render correctly (panel hidden when `legendPanelEnabled` undefined).
- **Don't read `cb_config` directly without `coalesceCbConfig`** — JSON parse failures should produce empty config, not crashes. Use Phase 38's helper.

</code_context>

<specifics>
## Specific Ideas

- **`<other>` literal rendering** — matches Phase 39's read-only chip pattern; consistent operator experience across form + legend.
- **Header label = `Layers`** (not `Legend`) — operator-facing word matches the conceptual content (a list of map layers, with classbreak breakdowns inline).
- **Corner picker beneath the toggle, conditional on enabled** — operator-friendly progressive disclosure.
- **Store-order display** — matches LayersModal so the operator's mental model of "what's on top" stays consistent across the two surfaces.
- **legendKey includes raw cb_config JSON string** — sidesteps the need to parse on every selector call; cheap string compare.
- **8px corner offset** — matches existing toolbar offsets; visual consistency.
- **z=1000 lock** — panel sits above OL canvas (z auto) and below toolbars (z=1001); tool clicks always win.
- **Render-mode chip pattern** — explicit visual signal of what's beneath each layer; operator can scan and identify CB layers at a glance.
- **Empty CB hint "No breaks configured"** — discoverable signal that CB is selected but operator needs to add break rows. Better than silently rendering an empty list.

</specifics>

<deferred>
## Deferred Ideas

- **Standalone Legend widget** — Phase 42 ships a `legend` chart type that reuses `<LayersLegendPanel />` against a different source (`config.sourceMapWidgetId`). Phase 41 prepares the component; Phase 42 ships the widget.
- **Drag-to-reposition panel** — Operator drags the panel to any corner with auto-snap. PANEL-V17-03 only requires "configurable corner" via a picker, not drag. v1.8+.
- **Numeric break range rendering** (`≤ 10`, `10–25`, `> 100`) — Phase 41 shows raw values. v1.8 may compute ranges from adjacent break values.
- **Heatmap colormap swatch** — Render the actual color ramp gradient under heatmap layers (similar to QGIS legend). Phase 41 shows just the render-mode chip. v1.8+.
- **Raster pointColor swatch** — Show layer.config.pointColor as a single swatch under raster layers. Phase 41 shows just chip. v1.8 may add.
- **Render-mode chip click → opens LayersModal pre-focused on this layer** — Power-user shortcut. v1.8+.
- **Panel collapsed-state persistence to SQLite** — Explicitly rejected (PANEL-V17-06 = session-only).
- **"N hidden layers" footer when filtering to visible only** — Defer; not required by PANEL-V17-01.
- **Panel resize / drag-resize** — Fixed width set by CSS; v1.8+ if operator demand surfaces.
- **CSS custom-property theming** (e.g., `--legend-panel-bg`) — Defer to dark-mode work in v1.8+.
- **Live cb_config preview from in-flight LayersModal edits** — Already covered by PANEL-V17-07 + the autosave debounce (Phase 39 ships the debounce); Phase 41 just inherits.
- **Render-mode chip uses Kinetica WMS docs naming** (e.g., `cb_raster` instead of `Class Break`) — Defer; operator-friendly names win.
- **Per-layer visibility toggle in the panel itself** — Defer; visibility is set via MapConfigPanel's inclusion picker. Panel is read-only.

</deferred>

---

*Phase: 41-layerslegendpanel-in-map-overlay*
*Context gathered: 2026-05-22*
