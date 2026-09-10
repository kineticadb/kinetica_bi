---
phase: 41-layerslegendpanel-in-map-overlay
plan: 02
type: execute
wave: 2
depends_on:
  - 41-01
files_modified:
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - PANEL-V17-02
  - PANEL-V17-03
  - PANEL-V17-05
  - PANEL-V17-06
  - PANEL-V17-07
must_haves:
  truths:
    - "Operator toggling `[ ] Show Layers Panel` in MapConfigPanel writes `legendPanelEnabled` via existing onChange chain"
    - "Conditional `<select>` for Panel corner appears only when `legendPanelEnabled === true`"
    - "Panel mounts as a React child of `<div className=\"widget-map\">` AFTER `<MapDrawToolbar>` in JSX order"
    - "Panel is NOT mounted via OL `addOverlay` (React tree only, popup-at-position-0 invariant preserved)"
    - "MapChartRenderer subscribes to `useDashboardLayersStore` via a `legendKey` PRIMITIVE STRING selector (no array-equality re-render storms)"
    - "`resolvedLegendLayers` is computed via useMemo keyed on `[legendKey, widgetConfig.includedLayerIds]`"
    - "Empty `includedLayerIds` array = all layers visible (Phase 12 semantic preserved)"
    - "Collapse state is component-local `useState<boolean>(false)` in MapChartRenderer — NOT persisted to MapWidgetConfig"
    - "Live cb_config edit in LayersModal causes the in-map panel to re-render with new break rows (PANEL-V17-07 — covered by autosave debounce from Phase 39 + legendKey change)"
    - "`lastEmittedParamsRef` fingerprint in MapChartRenderer is UNCHANGED (Phase 41 doesn't touch WMS emission)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "LAYERS PANEL section beneath INFO POPUP with toggle + conditional corner picker"
      contains: "LAYERS PANEL"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "legendKey primitive selector + resolvedLegendLayers useMemo + legendCollapsed useState + <LayersLegendPanel /> mount inside <div className=\"widget-map\">"
      contains: "<LayersLegendPanel"
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx"
      provides: "Tests for toggle visibility + conditional corner picker render + onChange firing"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "Tests for panel mount/unmount on enabled flip + corner class + collapse toggle + legendKey re-render on cb_config change"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      to: "kinetica_bi/src/lib/legendPanelConfig.ts"
      via: "getLegendPanelEnabled + getLegendPanelCorner imports"
      pattern: "getLegendPanelEnabled|getLegendPanelCorner"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      via: "import + JSX mount as sibling of MapDrawToolbar"
      pattern: "LayersLegendPanel"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "kinetica_bi/src/store/dashboardLayersStore.ts"
      via: "useDashboardLayersStore via legendKey primitive selector"
      pattern: "useDashboardLayersStore\\(\\(s\\)\\s*=>"
---

<objective>
Wire the dormant Plan 41-01 component into production: MapConfigPanel gains LAYERS PANEL section (toggle + corner picker); MapChartRenderer mounts `<LayersLegendPanel />` as a React child of `.widget-map` after `<MapDrawToolbar>`, driven by a `legendKey` primitive selector and a local `legendCollapsed` useState.

Purpose: Operator sees + uses the layers legend overlay; live cb_config edits in LayersModal reflect in the panel via the autosave debounce + legendKey change.

Output:
- Extended `MapConfigPanel.tsx` (LAYERS PANEL section)
- Extended `MapConfigPanel.spec.tsx` (toggle + corner picker tests)
- Extended `MapChartRenderer.tsx` (legendKey + resolvedLegendLayers + legendCollapsed + panel mount)
- Extended `MapChartRenderer.spec.tsx` (mount/unmount + corner + collapse + re-render tests)
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md
@.planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md
@.planning/phases/41-layerslegendpanel-in-map-overlay/41-01-foundation-helpers-and-component-PLAN.md
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md

# Plan 41-01 outputs (dormant — Plan 41-02 wires)
@kinetica_bi/src/lib/legendPanelConfig.ts
@kinetica_bi/src/components/LayersLegendPanel.tsx

# Integration targets
@kinetica_bi/src/components/charts/MapConfigPanel.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

# Store + DTO references
@kinetica_bi/src/store/dashboardLayersStore.ts
@kinetica_bi/src/lib/wmsUrlBuilder.ts

<interfaces>
<!-- Authoritative contracts (Plan 41-01 deliverables + existing code Plan 41-02 consumes) -->

From kinetica_bi/src/lib/legendPanelConfig.ts (shipped by Plan 41-01):
```typescript
export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];
export const DEFAULT_LEGEND_PANEL_ENABLED: boolean;
export const DEFAULT_LEGEND_PANEL_CORNER: LegendPanelCorner;
export function getLegendPanelEnabled(config: Pick<MapWidgetConfig, "legendPanelEnabled">): boolean;
export function getLegendPanelCorner(config: Pick<MapWidgetConfig, "legendPanelCorner">): LegendPanelCorner;
```

From kinetica_bi/src/components/LayersLegendPanel.tsx (shipped by Plan 41-01):
```typescript
export type ResolvedLegendLayer = { layer: DashboardLayerDto; visible: boolean };
export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
export function LayersLegendPanel(props: LayersLegendPanelProps): JSX.Element;
```

From kinetica_bi/src/lib/wmsUrlBuilder.ts MapWidgetConfig (extended by Plan 41-01):
```typescript
legendPanelEnabled?: boolean;
legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
```

From kinetica_bi/src/store/dashboardLayersStore.ts (VERIFIED — reference-stable updates):
```typescript
export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: DashboardLayerDto[],
  // updateLayer is reference-stable: only matching layer object changes identity
}));
```

Existing PITFALL S-02 primitive-selector pattern in MapChartRenderer.tsx (VERIFIED):
```typescript
// Line 491 viewsKey precedent:
const viewsKey = useFilterViewStore((s) =>
  /* primitive string join */
);
// Line 510 dynamicViewsKey precedent; Line 523 shapesKey precedent
// Phase 41 legendKey MIRRORS this exact pattern
```

NEW additions Plan 41-02 makes:
```typescript
// In MapChartRenderer.tsx
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map((l) => `${l.id}:${(l.config as { renderMode?: string })?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`)
    .join("|")
);

const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
  const includedLayerIds = (widgetConfig as MapWidgetConfig).includedLayerIds as number[] | undefined;
  const all = useDashboardLayersStore.getState().layers;
  const filtered = (includedLayerIds && includedLayerIds.length > 0)
    ? all.filter(l => includedLayerIds.includes(l.id))
    : all;
  return filtered.map(layer => ({ layer, visible: true }));
}, [legendKey, (widgetConfig as MapWidgetConfig).includedLayerIds]);

const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: MapConfigPanel — LAYERS PANEL section (toggle + conditional corner picker)</name>
  <files>
    kinetica_bi/src/components/charts/MapConfigPanel.tsx (EXTEND),
    kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (EXTEND)
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx lines 65-100 (props destructure + `widgetCfg = config as Partial<MapWidgetConfig>` cast at line 93 per research)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx lines 269-349 (INFO POPUP section — EXACT structure to mirror, ending with closing `</div>` of the config-group at ~line 349)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx lines 350-368 (SHAPE DISPLAY section — confirms append point AFTER INFO POPUP, BEFORE SHAPE DISPLAY OR at end of widgetConfig sections)
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx FULL (store mock pattern at top, makeLayer + makeConfig helpers — Phase 41 adds tests using same helpers with `legendPanelEnabled` / `legendPanelCorner` overrides)
    - kinetica_bi/src/lib/legendPanelConfig.ts (Plan 41-01 helpers — imports needed)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (MapWidgetConfig type — verify both new fields exist post Plan 41-01)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md §"Pattern 3: MapConfigPanel Section (INFO POPUP Mirror)" (verbatim JSX template)
  </read_first>
  <behavior>
    - Test 1 (section renders): MapConfigPanel renders an element with text exactly "LAYERS PANEL" (the section label) when widget config is non-empty.
    - Test 2 (toggle default off): with `config = {}` (no legendPanelEnabled), the checkbox labeled "Show Layers Panel" renders with `checked={false}`.
    - Test 3 (toggle default off — corner picker hidden): with `config = {}`, the element with id `map-legend-panel-corner` is NOT in the document.
    - Test 4 (toggle on shows picker): with `config = { legendPanelEnabled: true }`, the element with id `map-legend-panel-corner` IS in the document.
    - Test 5 (toggle fires onChange): clicking the "Show Layers Panel" checkbox calls `onChange` once with the partial `{ ..., legendPanelEnabled: true }`.
    - Test 6 (corner select fires onChange): with toggle on, changing `<select id="map-legend-panel-corner">` to "Bottom-left" calls `onChange` with partial `{ ..., legendPanelCorner: 'bottom-left' }`.
    - Test 7 (default corner value): with `config = { legendPanelEnabled: true }` (no legendPanelCorner), the select's value is `'top-right'`.
    - Test 8 (all 4 options present): the select contains exactly 4 `<option>` elements with values `'top-right'`, `'top-left'`, `'bottom-right'`, `'bottom-left'`.
    - Test 9 (option labels): the options have visible text: "Top-right (default)", "Top-left", "Bottom-right", "Bottom-left".
    - Test 10 (a11y): the section root has `role="group"` and `aria-labelledby="map-legend-panel-label"`; the label element has `id="map-legend-panel-label"`.
    - Test 11 (re-toggle preserves corner): toggling off then on does NOT re-emit a `legendPanelCorner` reset — only `legendPanelEnabled` is in the patch. (Verifies the corner setting is preserved when toggle off → on.)
  </behavior>
  <action>
    1. EDIT `kinetica_bi/src/components/charts/MapConfigPanel.tsx`:

    a. Add imports near the existing `MapWidgetConfig` import:

```typescript
import {
  getLegendPanelEnabled,
  getLegendPanelCorner,
  LEGEND_PANEL_CORNERS,
} from "../../lib/legendPanelConfig";
```

    b. Locate the closing `</div>` of the INFO POPUP `<div className="config-group">` block (per research, around line 349). Immediately AFTER that closing tag, append the LAYERS PANEL section:

```tsx
{/* ─── LAYERS PANEL (Phase 41 PANEL-V17-04/05) ─────────────────── */}
<div
  className="config-group"
  role="group"
  aria-labelledby="map-legend-panel-label"
>
  <div className="config-group-label" id="map-legend-panel-label">
    LAYERS PANEL
  </div>
  <label className="config-toggle">
    <input
      type="checkbox"
      aria-label="Show Layers Panel"
      checked={getLegendPanelEnabled(widgetCfg as MapWidgetConfig)}
      onChange={(e) =>
        onChange({ ...config, legendPanelEnabled: e.target.checked })
      }
    />
    Show Layers Panel
  </label>
  {getLegendPanelEnabled(widgetCfg as MapWidgetConfig) && (
    <>
      <label className="ds-field-label" htmlFor="map-legend-panel-corner">
        Panel corner
      </label>
      <select
        id="map-legend-panel-corner"
        className="ds-select"
        value={getLegendPanelCorner(widgetCfg as MapWidgetConfig)}
        onChange={(e) =>
          onChange({ ...config, legendPanelCorner: e.target.value as typeof LEGEND_PANEL_CORNERS[number] })
        }
      >
        <option value="top-right">Top-right (default)</option>
        <option value="top-left">Top-left</option>
        <option value="bottom-right">Bottom-right</option>
        <option value="bottom-left">Bottom-left</option>
      </select>
    </>
  )}
</div>
```

NOTE on `widgetCfg`: research locates `const widgetCfg = config as Partial<MapWidgetConfig>` at line 93 — the helper call site reuses the same name. If executor finds a different cast variable name (e.g., `widgetConfig`), use whichever name is actually established in that file at the INFO POPUP section.

NOTE on class names `config-toggle`, `ds-field-label`, `ds-select`: these are the EXISTING class names used in the INFO POPUP section. Mirror exactly — do NOT introduce new class names.

    2. EDIT `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx`: add a new `describe("LAYERS PANEL section (Phase 41)")` block at the end of the file with tests 1-11 above. Use the existing `makeLayer` + `makeConfig` helpers. For Test 5/6/11, use the existing `onChange` mock pattern (`const onChange = vi.fn()`).

    Specific test snippets:
```typescript
describe("LAYERS PANEL section (Phase 41)", () => {
  it("renders LAYERS PANEL section label", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} {...otherProps} />);
    expect(screen.getByText("LAYERS PANEL")).toBeInTheDocument();
  });

  it("toggle is unchecked by default (legendPanelEnabled missing)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} {...otherProps} />);
    const cb = screen.getByLabelText("Show Layers Panel") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("corner picker is hidden when toggle off", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} {...otherProps} />);
    expect(document.getElementById("map-legend-panel-corner")).toBeNull();
  });

  it("corner picker is visible when legendPanelEnabled: true", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} {...otherProps} />);
    expect(document.getElementById("map-legend-panel-corner")).not.toBeNull();
  });

  it("toggling on fires onChange with legendPanelEnabled: true", async () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig()} onChange={onChange} {...otherProps} />);
    await userEvent.click(screen.getByLabelText("Show Layers Panel"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legendPanelEnabled: true }));
  });

  it("corner select fires onChange with new corner", async () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={onChange} {...otherProps} />);
    await userEvent.selectOptions(document.getElementById("map-legend-panel-corner")!, "bottom-left");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legendPanelCorner: "bottom-left" }));
  });

  it("defaults to top-right when legendPanelCorner missing", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} {...otherProps} />);
    const sel = document.getElementById("map-legend-panel-corner") as HTMLSelectElement;
    expect(sel.value).toBe("top-right");
  });

  it("exposes 4 corner options", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} {...otherProps} />);
    const opts = (document.getElementById("map-legend-panel-corner") as HTMLSelectElement).querySelectorAll("option");
    expect(opts).toHaveLength(4);
    expect(Array.from(opts).map(o => o.value)).toEqual(["top-right", "top-left", "bottom-right", "bottom-left"]);
  });

  it("option labels are operator-friendly", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} {...otherProps} />);
    const opts = (document.getElementById("map-legend-panel-corner") as HTMLSelectElement).querySelectorAll("option");
    const labels = Array.from(opts).map(o => o.textContent);
    expect(labels).toEqual(["Top-right (default)", "Top-left", "Bottom-right", "Bottom-left"]);
  });

  it("section has role=group + aria-labelledby", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} {...otherProps} />);
    const labelEl = screen.getByText("LAYERS PANEL");
    expect(labelEl.id).toBe("map-legend-panel-label");
    const groupEl = labelEl.closest('[role="group"]')!;
    expect(groupEl).toHaveAttribute("aria-labelledby", "map-legend-panel-label");
  });

  it("toggling off does not emit a legendPanelCorner reset", async () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true, legendPanelCorner: "bottom-left" })} onChange={onChange} {...otherProps} />);
    await userEvent.click(screen.getByLabelText("Show Layers Panel"));
    const call = onChange.mock.calls[0][0];
    // legendPanelCorner should NOT be in the patch's own keys IF onChange only adds legendPanelEnabled,
    // OR if the spread preserves it that's also acceptable. Assert the corner is still 'bottom-left' OR unchanged in the patch.
    expect(call.legendPanelCorner).toBe("bottom-left");
    expect(call.legendPanelEnabled).toBe(false);
  });
});
```

    AVOID:
    - Do NOT introduce new CSS class names (use existing `config-group`, `config-group-label`, `config-toggle`, `ds-field-label`, `ds-select`).
    - Do NOT add validation that prevents toggle flip — operator-driven; widget config can hold any boolean.
    - Do NOT change the existing INFO POPUP section.
    - Do NOT move the LAYERS PANEL section to a non-`config-group` wrapper — pattern parity required for visual consistency.
    - Do NOT directly mutate `config` — always use `onChange({ ...config, fieldName: newValue })`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx --reporter=verbose && npx tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "LAYERS PANEL" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `>= 1`
    - `grep -c "id=\"map-legend-panel-label\"" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `1`
    - `grep -c "id=\"map-legend-panel-corner\"" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `1`
    - `grep -c "Show Layers Panel" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `>= 1`
    - `grep -c "getLegendPanelEnabled" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `>= 2` (checkbox checked + corner conditional render)
    - `grep -c "getLegendPanelCorner" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `>= 1`
    - `grep -c "legendPanelEnabled: e.target.checked" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `1`
    - `grep -c "legendPanelCorner: e.target.value" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `1`
    - `grep -c "Top-right (default)" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns `1`
    - All 11 spec tests pass (vitest exit 0)
    - Pre-existing MapConfigPanel tests still pass (no regression)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    LAYERS PANEL section renders beneath INFO POPUP with toggle + conditional corner picker; 11 new green tests; pre-existing tests still pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MapChartRenderer — legendKey selector + resolvedLegendLayers + legendCollapsed state + LayersLegendPanel JSX mount</name>
  <files>
    kinetica_bi/src/components/charts/MapChartRenderer.tsx (EXTEND),
    kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (EXTEND)
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 414 (`widgetConfig` cast site) — Phase 41 reads `legendPanelEnabled` + `legendPanelCorner` from this cast
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 491-497 (viewsKey primitive selector — EXACT mirror template)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 510-519 (dynamicViewsKey primitive selector)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 523-525 (shapesKey primitive selector)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1809-1832 (`<div className="widget-map">` open + popup container at position 0 — CRITICAL: never move popupContainerRef; Phase 41 panel goes LATER in JSX)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1811-1831 (popup-DOM-tracking lesson comment — confirms React-tree-mount-only rule)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1862 (containerRef OL canvas — panel is NOT inside this)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1868-1893 (MapZoomToolbar + MapDrawToolbar — Phase 41 panel goes AFTER `<MapDrawToolbar>`)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1895-1922 (reconfigure / empty / over-threshold / tile-error overlays — Phase 41 panel goes BEFORE these so popup invariant holds + overlays stack above)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1946 (closing `</div>` of widget-map — panel must be inside this div)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx lines 1-82 (module-level shared state mock pattern: `_layersState`, etc.)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx around line 4347-4392 (Phase 39 CB fingerprint tests — standalone describe block pattern at end of file is the correct add-point)
    - kinetica_bi/src/store/dashboardLayersStore.ts FULL (verify `updateLayer` reference-stable behavior — only matching layer changes identity)
    - kinetica_bi/src/components/LayersLegendPanel.tsx (Plan 41-01 — import LayersLegendPanel + ResolvedLegendLayer)
    - kinetica_bi/src/lib/legendPanelConfig.ts (Plan 41-01 — import getLegendPanelEnabled + getLegendPanelCorner)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md §"Pattern 1: legendKey Primitive Selector" + §"Pattern 2: ResolvedLegendLayer Builder" + §"Pattern 4: MapChartRenderer JSX Mount Site"
  </read_first>
  <behavior>
    - Test 1 (panel absent by default): with widget config NOT containing `legendPanelEnabled`, the element with class `.layers-legend-panel` is NOT in the rendered DOM.
    - Test 2 (panel present when enabled): with widget config `{ legendPanelEnabled: true }`, the element with class `.layers-legend-panel` IS in the rendered DOM.
    - Test 3 (default corner = top-right class): with `{ legendPanelEnabled: true }` (no corner field), the panel root has class `.layers-legend-panel--top-right`.
    - Test 4 (corner class applies): with `{ legendPanelEnabled: true, legendPanelCorner: "bottom-left" }`, the panel root has class `.layers-legend-panel--bottom-left`.
    - Test 5 (popup container stays at position 0): query `div.widget-map > *:nth-child(1)` and verify it has the `popupContainerRef` data-* attribute or matches the popup container element (NOT the legend panel).
    - Test 6 (panel rendered AFTER MapDrawToolbar): in the DOM `div.widget-map`, the index of the `.layers-legend-panel` element is GREATER than the index of `.map-draw-toolbar` (when both present).
    - Test 7 (empty includedLayerIds = all layers): with 3 layers in `_layersState` + widget config `{ legendPanelEnabled: true, includedLayerIds: [] }`, the panel body contains 3 layer rows (class `.layers-legend-panel-layer`).
    - Test 8 (filtered includedLayerIds): with 3 layers (ids 10, 20, 30) + `includedLayerIds: [10, 30]`, the panel body shows exactly 2 layer rows.
    - Test 9 (legendKey re-renders on cb_config change — PANEL-V17-07): with `legendPanelEnabled: true` + 1 classbreak layer with empty cb_config, the body shows "No breaks configured". Calling `useDashboardLayersStore.getState().updateLayer(id, { cb_config: JSON.stringify({attr:"x", valsType:"numeric", breaks:[{value:10,color:"FFFF0000"}]}) })` causes the panel to re-render with 1 break row containing color swatch (within the same React act).
    - Test 10 (collapse toggle): with `legendPanelEnabled: true`, clicking the header (`.layers-legend-panel-header`) hides the body element (`.layers-legend-panel-body` is no longer in DOM). Clicking again restores it.
    - Test 11 (toggle flip — react re-render): with `legendPanelEnabled: false` initial, re-rendering with `legendPanelEnabled: true` mounts the panel; re-rendering back to `false` unmounts it (no DOM residue).
    - Test 12 (legendKey is primitive — no array-storm regression): the `useDashboardLayersStore` call site for `legendKey` returns a `string` not an `array`. Inspect via grep the selector return type. (Validated via Test 9's reactive update — if it were an array selector, React's equality check might still re-render but legendKey-as-string is the locked pattern.)
  </behavior>
  <action>
    1. EDIT `kinetica_bi/src/components/charts/MapChartRenderer.tsx`:

    a. Add imports near the top of the file (alongside existing component imports):

```typescript
import { LayersLegendPanel, type ResolvedLegendLayer } from "../LayersLegendPanel";
import { getLegendPanelEnabled, getLegendPanelCorner } from "../../lib/legendPanelConfig";
```

    b. Locate the existing `widgetConfig` cast (per research line 414: `const widgetConfig = (widget.config ?? {}) as Record<string, unknown>;`). Phase 41 reads `legendPanelEnabled` + `legendPanelCorner` from this; no rewrite of the cast.

    c. Locate the `shapesKey` primitive selector at line 523. AFTER the `shapesKey` declaration block, add the `legendKey` selector + `resolvedLegendLayers` useMemo + `legendCollapsed` useState:

```typescript
// v1.7 Phase 41 (PANEL-V17-02): legendKey primitive selector mirrors viewsKey/dynamicViewsKey/shapesKey.
// Joined per-layer string changes when ANY layer's id/renderMode/cb_config changes; primitive string
// short-circuits React re-renders on irrelevant store mutations.
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map(
      (l) =>
        `${l.id}:${(l.config as { renderMode?: string })?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`,
    )
    .join("|"),
);

// v1.7 Phase 41 (PANEL-V17-03 + Phase 12 includedLayerIds semantic):
// Build the filtered legend-layer list. Empty includedLayerIds === all layers visible.
const includedLayerIdsForLegend = (widgetConfig as MapWidgetConfig).includedLayerIds;
const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
  const all = useDashboardLayersStore.getState().layers;
  const filtered =
    includedLayerIdsForLegend && includedLayerIdsForLegend.length > 0
      ? all.filter((l) => includedLayerIdsForLegend.includes(l.id))
      : all;
  return filtered.map((layer) => ({ layer, visible: true }));
  // legendKey is the read-trigger; includedLayerIdsForLegend is the filter trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [legendKey, includedLayerIdsForLegend]);

// v1.7 Phase 41 (PANEL-V17-06): session-only collapse state. NOT persisted to MapWidgetConfig.
const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);
```

NOTE: `MapWidgetConfig` is likely imported at the top of the file; if not, add the import: `import type { MapWidgetConfig } from "../../lib/wmsUrlBuilder";`. Executor confirms.

NOTE: `useState` and `useMemo` are React imports — verify they're already imported at the top; if React imports are `import { useEffect, useRef, ... } from "react"`, add `useState` and `useMemo` to that destructure.

    d. Locate the closing `</div>` of `<MapDrawToolbar>` (per research line 1893) — actually, MapDrawToolbar is a self-closing component (`<MapDrawToolbar ... />`). Phase 41 panel goes AS A SIBLING after the `<MapDrawToolbar ... />` line, BEFORE the reconfigure/empty overlays at lines 1895+.

    Insert:

```tsx
{/* v1.7 Phase 41 (PANEL-V17-03/05): in-map legend overlay.
    React tree only — NOT OL addOverlay (Phase 35 popup-DOM-tracking lesson).
    z=1000 sits below toolbars (z=1001 per V15-P-17 lock). */}
{getLegendPanelEnabled(widgetConfig as MapWidgetConfig) && (
  <LayersLegendPanel
    layers={resolvedLegendLayers}
    corner={getLegendPanelCorner(widgetConfig as MapWidgetConfig)}
    collapsed={legendCollapsed}
    onToggleCollapse={() => setLegendCollapsed((c) => !c)}
  />
)}
```

    e. Verify the existing `lastEmittedParamsRef` fingerprint computation is UNCHANGED (Phase 41 doesn't touch WMS emission per PANEL-V17 scope lock). Do NOT modify the fingerprint string or any `imageWmsSource.updateParams` call site.

    2. EDIT `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`:

    Add a new `describe("LayersLegendPanel mount (Phase 41)")` block at the end of the file (mirroring the Phase 39 CB fingerprint standalone-describe pattern). Tests 1-12 above. Use the existing module-level `_layersState` shared state pattern to seed layers, the existing `widget.config` builder pattern to seed `legendPanelEnabled` / `legendPanelCorner` / `includedLayerIds`, and `useDashboardLayersStore.getState().updateLayer(...)` (or whichever store-mutation API the existing mock exposes) for Test 9.

    For Test 5 (popup container at position 0): query `document.querySelector('.widget-map')` then verify its `children[0]` is the popup container (it should NOT have class `.layers-legend-panel`; check it matches the popup container — likely a `<div>` with a specific class like `.widget-map-popup` or matches the `popupContainerRef.current` selector).

    For Test 6 (panel after MapDrawToolbar): in the same `.widget-map`, find both elements and compare their `parentElement.children` indexes.

    For Test 9 (live cb_config edit re-renders): use `act(() => { useDashboardLayersStore.getState().updateLayer(id, { cb_config: newJson }) })`, then assert the new break row appears. This validates PANEL-V17-07.

    For Test 12 (primitive selector — grep audit): add a node-fs read of `MapChartRenderer.tsx`, assert it contains:
```typescript
expect(src).toMatch(/legendKey\s*=\s*useDashboardLayersStore\(/);
expect(src).toMatch(/\.join\("\|"\)/);
expect(src).not.toMatch(/legendKey\s*=\s*useDashboardLayersStore\(\(s\)\s*=>\s*s\.layers\)/);  // forbid array selector
```

    AVOID:
    - Do NOT use `useDashboardLayersStore(s => s.layers)` directly — must use the joined-string `legendKey` selector (PITFALL S-02 lock).
    - Do NOT mount the panel via `map.addOverlay(...)` — Phase 35 popup-DOM-tracking crash lesson at MapChartRenderer.tsx:1811-1831.
    - Do NOT insert the panel BEFORE the popup container at JSX position 0 — popup position 0 is the locked invariant.
    - Do NOT add the panel mount INSIDE the OL canvas `<div ref={containerRef}>` — it must be a sibling of toolbars.
    - Do NOT modify the existing `lastEmittedParamsRef` fingerprint — Phase 41 doesn't touch WMS emission. If executor finds tests breaking on fingerprint, the fingerprint code was modified — revert.
    - Do NOT subscribe to `useDashboardLayersStore` inside the LayersLegendPanel component (Plan 41-01 lock; verified zero subscriptions).
    - Do NOT include `widget.config.includedLayerIds` IN the `legendKey` join string — it's a SEPARATE useMemo dep (Pitfall 6 from research).
    - Do NOT persist `legendCollapsed` via `onChange` or PATCH — session-only useState (PANEL-V17-06 lock).
    - Do NOT change the OL canvas position OR the popup container — Phase 35 invariant.
    - Do NOT add z-index inline styles (CSS class `.layers-legend-panel` carries z=1000 from Plan 41-01).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose && npx tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "LayersLegendPanel" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 3` (import + JSX mount + type import)
    - `grep -c "getLegendPanelEnabled" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 1`
    - `grep -c "getLegendPanelCorner" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 1`
    - `grep -c "const legendKey = useDashboardLayersStore" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c "resolvedLegendLayers" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 2`
    - `grep -c "legendCollapsed" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 2`
    - `grep -c "setLegendCollapsed" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 2`
    - `grep -c "addOverlay" kinetica_bi/src/components/charts/MapChartRenderer.tsx | head -1` count is UNCHANGED from pre-edit (no new addOverlay calls; existing popup overlay preserved)
    - `grep "useDashboardLayersStore((s) => s.layers)" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 matches (no array selector regression)
    - All new spec tests (12 tests in LayersLegendPanel mount describe) pass
    - Pre-existing MapChartRenderer.spec.tsx tests still pass (no regressions — including the Phase 39 CB-V17-09 fingerprint tests around line 4347)
    - `npx tsc --noEmit` exits 0
    - Full frontend vitest suite: `npx vitest run --reporter=summary` shows pre-existing test count + new tests, zero failures
  </acceptance_criteria>
  <done>
    Panel mounts inside `.widget-map` after `<MapDrawToolbar>`, driven by `legendKey` primitive selector + `resolvedLegendLayers` useMemo + local `legendCollapsed` useState. 12 new green tests; pre-existing tests still pass; tsc clean.
  </done>
</task>

</tasks>

<verification>
**Overall plan verification:**

1. `cd kinetica_bi && npx tsc --noEmit` exits 0
2. `cd kinetica_bi && npx vitest run` full frontend suite green (pre-existing + new Plan 41-01 + new Plan 41-02 tests all pass)
3. `grep -c "useDashboardLayersStore" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `0` (Plan 41-01 lock preserved — component never grows a store subscription)
4. `grep "legendKey = useDashboardLayersStore" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1 match (PITFALL S-02 primitive selector)
5. `grep "LayersLegendPanel" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `>= 3` matches (import + mount + types)
6. Popup container at `.widget-map > *:nth-child(1)` remains the popupContainerRef (NOT the legend panel) — Phase 35 invariant preserved
7. `lastEmittedParamsRef` fingerprint string in MapChartRenderer.tsx is UNCHANGED from pre-edit (Phase 41 doesn't touch WMS emission)
8. No new `addOverlay()` calls added (panel is React-tree-mounted)

**Goal-backward check against 5 ROADMAP SC for Phase 41:**
- SC1 (pure presentational + legendKey selector): Plan 41-01 ships pure component (zero Zustand). Plan 41-02 adds legendKey primitive selector at MapChartRenderer site. ✓
- SC2 (toggle shows/hides + persists via PATCH): Plan 41-02 wires toggle via existing `onChange({ ...config, legendPanelEnabled })` → existing debounced PATCH flow. ✓
- SC3 (React-tree mount + 4 corners + doesn't block draw clicks): Plan 41-02 mounts as React child of `.widget-map` after `<MapDrawToolbar>`; 4 corner modifier classes via Plan 41-01 CSS; z=1000 below toolbars z=1001 so tool clicks always win. ✓
- SC4 (header click collapses; session-only): Plan 41-02 local `useState<boolean>(false)` + Plan 41-01 component header click → onToggleCollapse callback. ✓
- SC5 (live cb_config edit reflects in panel): Plan 41-02 legendKey includes `cb_config` JSON → store updateLayer changes the key → useMemo recomputes resolvedLegendLayers → component re-renders. Test 9 in Task 2 validates this. ✓

All 5 SCs covered by Plans 01 + 02 combined.
</verification>

<success_criteria>
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` has a LAYERS PANEL section between INFO POPUP and SHAPE DISPLAY with toggle + conditional corner picker
- `MapConfigPanel.spec.tsx` has 11 new green tests covering the section
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` has:
  - `legendKey` primitive string selector mirroring viewsKey/dynamicViewsKey/shapesKey
  - `resolvedLegendLayers` useMemo with deps `[legendKey, includedLayerIdsForLegend]`
  - `legendCollapsed` useState
  - `<LayersLegendPanel ... />` JSX mount inside `.widget-map`, AFTER `<MapDrawToolbar>`, BEFORE reconfigure/empty overlays
  - Popup container at JSX position 0 remains unchanged
  - `lastEmittedParamsRef` fingerprint UNCHANGED
- `MapChartRenderer.spec.tsx` has 12 new green tests covering panel mount/unmount, corner classes, live re-render on cb_config edit, popup-position-0 invariant, primitive selector lock
- Frontend tsc + vitest suite fully green
- All 5 ROADMAP success criteria for Phase 41 are TRUE (verifiable by running the app + Plan 41-02 test surface)
</success_criteria>

<output>
After completion, create `.planning/phases/41-layerslegendpanel-in-map-overlay/41-02-SUMMARY.md` documenting:
- All 2 tasks shipped (MapConfigPanel section + MapChartRenderer mount)
- Test counts: 11 MapConfigPanel + 12 MapChartRenderer = 23 new green tests
- Combined Phase 41 total with Plan 41-01: 29 + 23 = 52 new green tests
- All 7 PANEL-V17-* requirement IDs satisfied
- All 5 ROADMAP success criteria for Phase 41 satisfied
- Phase 42 (standalone Legend chart type) is now unblocked — consumes `<LayersLegendPanel />` against a different layer source via Phase 42's own ResolvedLegendLayer[] builder
- No regressions: popup-at-position-0 invariant preserved, `lastEmittedParamsRef` fingerprint unchanged, z=1001 toolbar lock preserved
</output>
