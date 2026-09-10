# Phase 41: LayersLegendPanel + In-Map Overlay — Research

**Researched:** 2026-05-21
**Domain:** React component architecture, Zustand primitive selectors, CSS absolute positioning, MapChartRenderer JSX sibling pattern
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Component shape**: `<LayersLegendPanel />` at `kinetica_bi/src/components/LayersLegendPanel.tsx` — pure presentational, props-driven, NO internal store subscriptions. Props contract: `{ layers: ResolvedLegendLayer[], collapsed?: boolean, onToggleCollapse?: () => void }`.
- **`ResolvedLegendLayer` type**: `{ layer: DashboardLayerDto; visible: boolean }`. Pure data shape; component handles formatting.
- **Mount strategy**: React child of `<div className="widget-map">` (NOT OL `addOverlay`). Position: absolute, configurable corner.
- **`legendKey` primitive selector**: joined string `${id}:${renderMode ?? "raster"}:${cb_config ?? "null"}` per layer, joined with `|`. Mirrors `viewsKey`/`dynamicViewsKey`/`shapesKey` PITFALL S-02 lock.
- **Anchor corner UX**: 4-option `<select>` in MapConfigPanel beneath the `[ ] Show Layers Panel` checkbox. CSS modifier classes `.layers-legend-panel--top-right` etc. 8px offset.
- **Persist fields**: `MapWidgetConfig.legendPanelEnabled?: boolean` (default false) + `legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'` (default 'top-right').
- **Collapse interaction**: session-only `useState<boolean>(false)` in MapChartRenderer consumer site. NOT persisted to SQLite.
- **Z-index**: panel z=1000; toolbars z=1001 (V15-P-17 lock preserved).
- **CSS class names**: `.layers-legend-panel`, `.layers-legend-panel-header`, `.layers-legend-panel-body`, `.layers-legend-panel-layer`, `.layers-legend-panel-break-row`, `.layers-legend-panel-swatch`, `.layers-legend-panel-empty`, `.layers-legend-panel-mode-chip`. Corner modifiers: `.layers-legend-panel--top-right`, `--top-left`, `--bottom-right`, `--bottom-left`.
- **Per-render-mode layout**: raster/heatmap = header row only. classbreak (configured) = header + N break rows. classbreak (empty cb_config) = header + italic gray "No breaks configured". empty widget = header + "No layers configured on this widget."
- **`<other>` row**: rendered verbatim as `<other>` — NO titlecase.
- **Label fallback**: if `break.label` empty string or undefined, show `break.value` verbatim including `<other>`.
- **helpers file**: `kinetica_bi/src/lib/legendPanelConfig.ts` with `getLegendPanelEnabled` + `getLegendPanelCorner` + `LEGEND_PANEL_CORNERS` const + `LegendPanelCorner` type.
- **Layer display order**: store order (rendering order, bottom-up — matches LayersModal).
- **includedLayerIds filter**: empty array = all-on (Phase 12 semantic). Only widget-visible layers shown.
- **MapChartRenderer mount site**: AFTER `<MapDrawToolbar>` in JSX order, BEFORE the reconfigure/empty overlays. Popup at position 0 is unchanged.
- **MapConfigPanel section**: NEW section under existing INFO POPUP section labeled "LAYERS PANEL". Uses same `<div className="config-group" role="group" aria-labelledby="map-legend-panel-label">` pattern.
- **`onChange` pattern**: `onChange({ ...config, legendPanelEnabled: bool })` / `onChange({ ...config, legendPanelCorner: corner })`. Existing debounced PATCH flow.
- **No OL addOverlay**: V15-P-17 / Phase 35 post-VERIFY popup-DOM-tracking lesson. React tree only.
- **No store subscriptions inside `<LayersLegendPanel />`**: PANEL-V17-01 lock.
- **Contour layers**: render as raster-style header row only (dead code path post-Phase 39).
- **No persist collapse state to SQLite**: PANEL-V17-06 explicitly session-only.
- **No numeric range computation in breaks**: show `break.value` verbatim. Deferred to v1.8.
- **No new server changes**: frontend-only phase.

### Claude's Discretion

- File location for `<LayersLegendPanel />`: top-level `components/` is REQUIREMENTS.md spec; component reused by Phase 42. Recommendation: `kinetica_bi/src/components/LayersLegendPanel.tsx`.
- Render-mode chip styling: tailwind classes vs custom CSS. Planner picks based on codebase chip patterns.
- Color swatch exact size: 12×12 px recommended; planner can adjust 10–16 px range.
- CSS file location: append to `src/styles/global.css` vs new `LayersLegendPanel.module.css`.
- Default classbreak chip text: `Class Break` (two words, title-case — matches render-mode picker label in KineticaWmsLayerForm).
- `legendKey` formula: planner can adjust per-layer summary (recommendation: include layer.id + renderMode + cb_config; rely on widget.config.includedLayerIds being a separate dep).
- Empty-state copy exact wording: planner picks final phrasing.
- Spec file location: `LayersLegendPanel.spec.tsx` + MapChartRenderer.spec.tsx additions + MapConfigPanel.spec.tsx additions.
- A11y attrs: `role="region"` + `aria-label="Map layer legend"` for panel; chevron has `aria-expanded` + `aria-controls`.
- Panel max-height + scroll: `max-height: calc(100% - 24px)` + `overflow-y: auto` recommended.

### Deferred Ideas (OUT OF SCOPE)

- Standalone Legend widget (Phase 42).
- Drag-to-reposition panel.
- Numeric break range rendering (`≤ 10`, `10–25`).
- Heatmap colormap swatch.
- Raster pointColor swatch.
- Render-mode chip click → opens LayersModal.
- Collapse-state persistence to SQLite.
- "N hidden layers" footer.
- CSS custom-property theming.
- Live cb_config preview from in-flight LayersModal edits (already handled by autosave debounce from Phase 39).
- Per-layer visibility toggle in the panel.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PANEL-V17-01 | `<LayersLegendPanel />` pure presentational component at `src/components/LayersLegendPanel.tsx`; props `{ layers: ResolvedLegendLayer[] }`; no store subscriptions; renders name + chip; classbreak layers render legend rows | Confirmed: DashboardLayerDto has `cb_config: string | null` and `config: Record<string,unknown>` with renderMode. coalesceCbConfig parses raw JSON. Pure presentational pattern established by InfoPopup/InfoCard (Phase 21/23). |
| PANEL-V17-02 | `legendKey` primitive selector (PITFALL S-02) applied to all consumer subscriptions to `useDashboardLayersStore` | Confirmed: viewsKey (line 491), dynamicViewsKey (line 510), shapesKey (line 523) patterns verified in MapChartRenderer.tsx. `useDashboardLayersStore` reference-stable `updateLayer` verified. |
| PANEL-V17-03 | In-map overlay — floating panel anchored to configurable corner of `.widget-map`; React child of MapChartRenderer container (NOT OL addOverlay); does not block draw-mode clicks | Confirmed: `.widget-map` is `position: relative` in global.css. MapDrawToolbar at z=1001 (`map-draw-toolbar`). Panel at z=1000 sits below. Mount point: after `<MapDrawToolbar>` in JSX (lines 1887-1893), before reconfigure/empty overlays (lines 1895-1922). |
| PANEL-V17-04 | `MapWidgetConfig.legendPanelEnabled?: boolean` field persisted via existing PATCH /api/widgets/:id | Confirmed: MapWidgetConfig in wmsUrlBuilder.ts lines 65-134 uses optional field pattern consistently. onChange chain flows through existing debounced PATCH. |
| PANEL-V17-05 | MapConfigPanel gains `[ ] Show Layers Panel` toggle; flipping toggles overlay visibility in real-time | Confirmed: MapConfigPanel INFO POPUP pattern at lines 269-349 is the exact mirror. `config as Partial<MapWidgetConfig>` cast on line 93. `onChange({ ...config, field: value })` pattern established. |
| PANEL-V17-06 | Panel collapsible (header click toggles body open/closed); collapse state is per-session (not persisted) | Confirmed: `selectedShapeId` (Phase 29), `expandedRowIds` (Phase 35), `previewRanSinceLastSave` (Phase 34) all use session-only `useState` in MapChartRenderer. Pattern is established. |
| PANEL-V17-07 | When LayersModal is open with CB rows mid-edit, panel reflects live `cb_config` from store (autosave debounce coalesces) | Confirmed: `useDashboardLayersStore.updateLayer` is reference-stable (dashboardLayersStore.ts lines 36-46). `legendKey` includes raw cb_config JSON string — changes when any cb_config edit fires (debounce from Phase 39 coalesces rapid edits into single store update). |
</phase_requirements>

---

## Summary

Phase 41 is a frontend-only component build with no new server routes, no schema changes, and no new npm dependencies. All upstream infrastructure (cb_config JSON schema, coalesceCbConfig helper, DashboardLayerDto with cb_config/track_config fields, PALETTE_COLORS, createDefaultBreak) shipped in Phases 38 and 39 and is ready for consumption.

The primary technical challenge is threading Zustand store subscriptions correctly (PITFALL S-02 primitive-selector discipline) so the panel re-renders on cb_config edits without causing re-render storms. The `legendKey` string selector — mirroring viewsKey/dynamicViewsKey/shapesKey — solves this correctly. The second challenge is mounting the panel inside `.widget-map` at the right JSX position so it does not interact with the popup-at-position-0 invariant locked in Phase 35.

The codebase's CSS convention is a single global stylesheet (`src/styles/global.css`). Phase 41's panel CSS classes should be appended there following the established `.widget-map-*` and `.config-group` section patterns already in the file. Chip/badge styles in the codebase (`.layer-row-badge`, `.filter-bar-chip`, `.info-popup-config-chip`) are all custom CSS in the global sheet — no Tailwind or CSS modules in use.

**Primary recommendation:** Write `<LayersLegendPanel />` as a pure function with zero side effects, mount it as a React sibling of `<MapDrawToolbar>` (after it in JSX), drive it from a `legendKey` primitive selector + a derived `resolvedLegendLayers` array computed from the full store layers + widget.config.includedLayerIds, and append all CSS to global.css.

---

## Standard Stack

### Core (all already in codebase — zero new npm installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component + hooks | Project foundation |
| Zustand | existing | `useDashboardLayersStore` subscription via `legendKey` primitive selector | PITFALL S-02 lock; matches viewsKey pattern |
| `lib/cbConfig.ts` | Phase 38 — already shipped | `coalesceCbConfig`, `CbBreak`, `CbConfig`, `PALETTE_COLORS`, `createDefaultBreak` | Phase 38 deliverable; phase 41 is read-only consumer |
| `lib/colorHex.ts` | existing | `normalizeAARRGGBB` for swatch color string | Already used by raster/heatmap branches |
| `lib/mapInfoConfig.ts` | Phase 19 — already shipped | Pattern mirror for `legendPanelConfig.ts` helpers | Exact template: defaults + null-coalescer + Pick<MapWidgetConfig,...> argument types |
| `kinetica_bi/src/styles/global.css` | existing | Panel CSS — append `.layers-legend-panel*` selectors | Single-file CSS convention established across all phases |

### No New Dependencies

The REQUIREMENTS.md explicitly documents: "New npm dependencies for charting or legend computation: zero new deps needed." This phase confirms: the only new code is new React components + a lib helper module + CSS appended to the existing global sheet.

---

## Architecture Patterns

### Recommended Project Structure for Phase 41 deliverables

```
kinetica_bi/src/
├── components/
│   ├── LayersLegendPanel.tsx          # NEW — pure presentational shared component
│   └── LayersLegendPanel.spec.tsx     # NEW — companion spec
├── lib/
│   └── legendPanelConfig.ts           # NEW — getLegendPanelEnabled + getLegendPanelCorner helpers
│   └── legendPanelConfig.spec.ts      # NEW — companion spec (pure unit)
├── components/charts/
│   ├── MapConfigPanel.tsx             # EXTEND — LAYERS PANEL section
│   ├── MapConfigPanel.spec.tsx        # EXTEND — toggle/picker tests
│   ├── MapChartRenderer.tsx           # EXTEND — legendKey selector + mount + legendCollapsed state
│   └── MapChartRenderer.spec.tsx      # EXTEND — panel visibility + corner + collapse tests
├── lib/
│   └── wmsUrlBuilder.ts               # EXTEND — MapWidgetConfig + two optional fields
└── styles/
    └── global.css                     # EXTEND — append .layers-legend-panel* CSS
```

### Pattern 1: legendKey Primitive Selector (PITFALL S-02)

**What:** A single joined string summarizing all layer identity + cb_config per layer, subscribed via `useDashboardLayersStore`. React equality-shorts the re-render when the string doesn't change.

**When to use:** Any `useDashboardLayersStore` subscription in MapChartRenderer that depends on layer identity or classbreak config.

**Example (verified against MapChartRenderer.tsx:491, 510, 523):**

```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 491, 510, 523
// The legendKey selector mirrors this exact pattern:
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map((l) => `${l.id}:${(l.config as {renderMode?: string}).renderMode ?? "raster"}:${l.cb_config ?? "null"}`)
    .join("|")
);
```

**Why this works:** `useDashboardLayersStore`'s `updateLayer` (dashboardLayersStore.ts:36-46) only mutates the matching layer object. When cb_config changes for layer 3, the joined string changes, React re-renders, consumer rebuilds `resolvedLegendLayers` from the full store snapshot. Other layers' object references remain stable, but the primitive string changes → correct re-render.

### Pattern 2: ResolvedLegendLayer Builder (Consumer Site in MapChartRenderer)

**What:** The consumer site in MapChartRenderer reads the full layers list after `legendKey` triggers a re-render, then filters and maps to `ResolvedLegendLayer[]`.

**Example:**

```typescript
// In MapChartRenderer — after legendKey selector
const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
  const includedLayerIds = widgetConfig.includedLayerIds as number[] | undefined;
  const storeLayersSnapshot = useDashboardLayersStore.getState().layers;
  const filtered = (includedLayerIds && includedLayerIds.length > 0)
    ? storeLayersSnapshot.filter(l => includedLayerIds.includes(l.id))
    : storeLayersSnapshot; // Phase 12 semantic: empty array = all on
  return filtered.map(layer => ({ layer, visible: true }));
}, [legendKey, widgetConfig.includedLayerIds]);
// NOTE: legendKey change triggers re-render → useMemo recomputes.
// widgetConfig.includedLayerIds as separate dep ensures visibility changes (widget config
// PATCH) also recompute the filtered list.
```

### Pattern 3: MapConfigPanel Section (INFO POPUP Mirror)

**What:** New "LAYERS PANEL" config group below INFO POPUP, using the same `<div className="config-group">` + `<div className="config-group-label">` structure.

**Verified from MapConfigPanel.tsx lines 269-349:**

```tsx
{/* ─── LAYERS PANEL (Phase 41 PANEL-V17-04/05) ─────────────────── */}
<div className="config-group" role="group" aria-labelledby="map-legend-panel-label">
  <div className="config-group-label" id="map-legend-panel-label">LAYERS PANEL</div>
  <label className="config-toggle">
    <input
      type="checkbox"
      aria-label="Show Layers Panel"
      checked={getLegendPanelEnabled(widgetCfg as MapWidgetConfig)}
      onChange={(e) => onChange({ ...config, legendPanelEnabled: e.target.checked })}
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
        onChange={(e) => onChange({ ...config, legendPanelCorner: e.target.value })}
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

### Pattern 4: MapChartRenderer JSX Mount Site (popup-at-position-0 safe)

**What:** Phase 41 panel goes AFTER `<MapDrawToolbar>` (line 1887-1893) and BEFORE the reconfigure/empty overlays (lines 1895-1922). The popup container stays at JSX position 0 (line 1832) — unchanged.

**Verified from MapChartRenderer.tsx lines 1809-1946:**

```tsx
<div className="widget-map">
  {/* Position 0 — popup container (CRITICAL: never move this per Phase 35 post-VERIFY) */}
  <div ref={popupContainerRef} ... />

  {/* Phase 29 test seams */}
  <span data-testid="draw-mode-debug" ... />
  <span data-testid="selected-shape-id" ... />

  {/* OL canvas */}
  <div ref={containerRef} className="widget-map-canvas" />

  {/* Toolbars (z=1001 lock) */}
  <MapZoomToolbar ... />
  <MapDrawToolbar ... />

  {/* Phase 41: in-map legend overlay (React tree, NOT OL addOverlay; z=1000) */}
  {getLegendPanelEnabled(widgetConfig as MapWidgetConfig) && (
    <LayersLegendPanel
      layers={resolvedLegendLayers}
      corner={getLegendPanelCorner(widgetConfig as MapWidgetConfig)}
      collapsed={legendCollapsed}
      onToggleCollapse={() => setLegendCollapsed(c => !c)}
    />
  )}

  {/* Reconfigure / empty / over-threshold / tile-error overlays */}
  {showReconfigureOverlay && (...)}
  {showEmptyOverlay && (...)}
  {hasOverThresholdLayers && (...)}
  {tileLoadError && (...)}
</div>
```

### Pattern 5: legendPanelConfig.ts Helpers (mapInfoConfig.ts Mirror)

**What:** New lib module with defaults + null-coalescer helpers. Exact shape verified from `mapInfoConfig.ts`.

**mapInfoConfig.ts actual pattern (verified):**
- Each helper takes `Pick<MapWidgetConfig, "fieldName">` and returns `value ?? DEFAULT`.
- Constants exported (`DEFAULT_INFO_ENABLED = true`, etc.).
- No clamping — UI enforces bounds at edit time.

**Phase 41 mirror:**

```typescript
// Source: kinetica_bi/src/lib/legendPanelConfig.ts (NEW)
import type { MapWidgetConfig } from "./wmsUrlBuilder";

export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];

export function getLegendPanelEnabled(config: Pick<MapWidgetConfig, "legendPanelEnabled">): boolean {
  return config.legendPanelEnabled ?? false;
}

export function getLegendPanelCorner(config: Pick<MapWidgetConfig, "legendPanelCorner">): LegendPanelCorner {
  const v = config.legendPanelCorner;
  return LEGEND_PANEL_CORNERS.includes(v as LegendPanelCorner) ? (v as LegendPanelCorner) : 'top-right';
}
```

### Pattern 6: Color Swatch from AARRGGBB

**What:** Convert 8-char AARRGGBB break.color to CSS `background-color` for the swatch span. `normalizeAARRGGBB` already exists in `lib/colorHex.ts`.

**Verified exports from colorHex.ts:**
- `normalizeAARRGGBB(hex, fallback): string` — normalizes to 8-char AARRGGBB
- `rgbFromAARRGGBB(hex, fallback): string` — last 6 chars (RGB)
- `alphaFromAARRGGBB(hex, fallback): string` — first 2 chars (alpha byte)

**Rendering approach:**

```typescript
// Convert AARRGGBB to CSS rgba(r,g,b,a) for the swatch
function aarrggbbToCssColor(aarrggbb: string): string {
  const norm = normalizeAARRGGBB(aarrggbb, "FF000000");
  const a = parseInt(norm.slice(0, 2), 16) / 255;
  const r = parseInt(norm.slice(2, 4), 16);
  const g = parseInt(norm.slice(4, 6), 16);
  const b = parseInt(norm.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

// Usage in JSX:
<span
  className="layers-legend-panel-swatch"
  style={{ backgroundColor: aarrggbbToCssColor(brk.color) }}
  aria-hidden="true"
/>
```

### Anti-Patterns to Avoid

- **Don't use `useDashboardLayersStore(s => s.layers)` directly in MapChartRenderer** — array reference changes on every `updateLayer` call. Use `legendKey` joined string.
- **Don't mount panel via OL `addOverlay`** — Phase 35 post-VERIFY crash lesson (popup DOM tracking, getHostSibling invariant).
- **Don't subscribe to store inside `<LayersLegendPanel />`** — PANEL-V17-01 lock; pure presentational.
- **Don't insert the panel between popup container (position 0) and anything else** — position 0 must stay the popup. Insert AFTER `<MapDrawToolbar>`.
- **Don't titlecase `<other>`** — render verbatim.
- **Don't persist collapse state** — session-only `useState<boolean>(false)` only.
- **Don't add `legendKey` to `lastEmittedParamsRef` fingerprint** — Phase 41 doesn't touch WMS emission; fingerprint is unaffected (Phase 39 CB-V17-09 already covers cb_config in the fingerprint).
- **Don't call `coalesceCbConfig` on every render without useMemo** — it does a JSON.parse; memoize or call once from the passed `layer.cb_config` prop.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CB config JSON parsing | Custom JSON.parse branch | `coalesceCbConfig(layer.cb_config)` from `lib/cbConfig.ts` | Handles null, parse failure, missing keys gracefully (NEVER throws) |
| Color normalization | Custom hex parsing | `normalizeAARRGGBB` from `lib/colorHex.ts` | Already handles 6-char vs 8-char, `#` prefix, undefined, malformed input |
| Default palette colors | Hardcoded hex literals in component | `PALETTE_COLORS` from `lib/cbConfig.ts` | Already there; phase 41 reads break.color directly (palette only used at row creation time in Phase 39) |
| Widget config field reading | `(config.legendPanelEnabled as boolean) ?? false` inline | `getLegendPanelEnabled(widgetConfig)` from `legendPanelConfig.ts` | Centralized default; matches mapInfoConfig.ts precedent so config reads are consistent |
| Store subscription in component | Internal `useDashboardLayersStore` inside `<LayersLegendPanel />` | Pass `ResolvedLegendLayer[]` as prop from consumer | PANEL-V17-01 requirement; keeps component reusable by Phase 42 Legend widget with different source |

**Key insight:** Every data-shaping concern (JSON parse, color normalize, eligible-column filter) already has a pure helper module from Phases 38/39. Phase 41 is purely a component-assembly phase — no new data transformation logic needed.

---

## Common Pitfalls

### Pitfall 1: Store Array Selector Causing Re-Render Storms
**What goes wrong:** `useDashboardLayersStore(s => s.layers)` returns a new array reference on every store mutation (including unrelated mutations on other stores). MapChartRenderer re-renders on every unrelated layer edit.
**Why it happens:** Zustand equality checks object reference; `s.layers` always returns a new array from `updateLayer` (slice() creates new array).
**How to avoid:** Use `legendKey` primitive string selector. `useMemo` over the full derived `resolvedLegendLayers` array, keyed on `legendKey` + `widgetConfig.includedLayerIds`.
**Warning signs:** MapChartRenderer re-renders on every keystroke in LayersModal text inputs.

### Pitfall 2: Popup Container Position Violated
**What goes wrong:** The `popupContainerRef` div is moved out of `widget-map`'s React-tracked children by OL's `addOverlay()`. If any conditional sibling after it in JSX flips (e.g., `{enabled && <LayersLegendPanel />}` inserted before the popup), React's `getHostSibling` walks forward and finds the popup DOM node — which OL has already moved. `insertBefore` crashes.
**Why it happens:** Phase 35 post-VERIFY lesson documented at MapChartRenderer.tsx:1811-1831. Popup is at DOM position 0 but OL moves it into the canvas viewport on mount.
**How to avoid:** Always insert Phase 41 panel AFTER `<MapDrawToolbar>` in JSX source order. The popup container is at JSX position 0 and must stay there.
**Warning signs:** `"The node before which the new node is to be inserted is not a child of this node"` error in React reconciler.

### Pitfall 3: CSS Class Name Collision
**What goes wrong:** Using a generic class name like `.legend-panel` or `.layers-panel` that already exists in the global stylesheet and has conflicting styles.
**Why it happens:** The global.css is 2000+ lines; no scoping mechanism (no CSS modules in this project).
**How to avoid:** Use the locked prefix `.layers-legend-panel` for all new classes. Grep global.css before writing CSS to verify no existing usages.
**Warning signs:** Panel styles unexpectedly override or inherit from existing widget styles.

### Pitfall 4: Z-index Above Toolbars
**What goes wrong:** Panel set to z=1001 or higher causes draw-mode buttons to be unclickable when the panel overlaps the toolbar area.
**Why it happens:** MapZoomToolbar and MapDrawToolbar are both at z=1001 (`map-zoom-toolbar` and `map-draw-toolbar` verified in global.css lines 1670, 1683).
**How to avoid:** Panel z-index MUST be 1000. The locked class `.layers-legend-panel` sets `z-index: 1000`.
**Warning signs:** Draw mode buttons stop responding to clicks in the top-right area of the map.

### Pitfall 5: coalesceCbConfig Called on Every Render Without Memoization
**What goes wrong:** `JSON.parse` fires on every render of `<LayersLegendPanel />` for every layer in the list. With many CB layers and frequent re-renders, this is measurable overhead.
**Why it happens:** `layer.cb_config` is a string; callers may pass it directly without memoizing the parsed result.
**How to avoid:** In the panel's render body, call `coalesceCbConfig(layer.cb_config)` once per layer per render. Since the component is pure (no useState), React's normal render batching applies. If profiling shows cost, wrap the derived CB config list in `useMemo` at the consumer site.
**Warning signs:** Profiler shows JSON.parse in the hot path.

### Pitfall 6: includedLayerIds Not a Separate useMemo Dep
**What goes wrong:** `resolvedLegendLayers` is only keyed on `legendKey` (store changes) but not on `widgetConfig.includedLayerIds` (widget config changes). When operator toggles a layer on/off via MapConfigPanel, the widget config PATCH changes `includedLayerIds`, but `legendKey` (which reads store layers) doesn't change — so the panel doesn't update.
**Why it happens:** `legendKey` is a store selector; `includedLayerIds` is a widget prop value. They are separate dependency chains.
**How to avoid:** Include both `legendKey` AND `widgetConfig.includedLayerIds` as deps on the `resolvedLegendLayers` useMemo.
**Warning signs:** Panel shows wrong set of layers after layer toggle in MapConfigPanel.

---

## Code Examples

### LayersLegendPanel props contract

```typescript
// Source: 41-CONTEXT.md decisions (locked)
export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};

// Component signature (NEW file: kinetica_bi/src/components/LayersLegendPanel.tsx)
type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
```

### MapWidgetConfig extension

```typescript
// Extend kinetica_bi/src/lib/wmsUrlBuilder.ts MapWidgetConfig (currently ends at line 134):
// Add after the spatialTargets?: SpatialTarget[] field:

// v1.7 Phase 41 (PANEL-V17-04): Layers Legend Panel widget-level config.
// Both optional for backward-compat with legacy widget config blobs —
// missing fields default via getLegendPanelEnabled() / getLegendPanelCorner()
// in lib/legendPanelConfig.ts (same pattern as v1.4 Phase 19 mapInfoConfig.ts).
legendPanelEnabled?: boolean;
legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
```

### Collapse state in MapChartRenderer

```typescript
// Session-only collapse state (mirrors Phase 29 selectedShapeId, Phase 35 expandedRowIds)
const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);
```

### CSS corner positioning

```css
/* Append to kinetica_bi/src/styles/global.css */
.layers-legend-panel {
  position: absolute;
  z-index: 1000;
  background: rgba(11, 18, 36, 0.9);
  border: 1px solid var(--border);
  border-radius: 8px;
  backdrop-filter: blur(6px);
  min-width: 180px;
  max-width: 280px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  font-size: 12px;
  pointer-events: auto;
}

.layers-legend-panel--top-right    { top: 8px; right: 8px; }
.layers-legend-panel--top-left     { top: 8px; left: 8px; }
.layers-legend-panel--bottom-right { bottom: 8px; right: 8px; }
.layers-legend-panel--bottom-left  { bottom: 8px; left: 8px; }

.layers-legend-panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.layers-legend-panel-body { padding: 6px 0; }

.layers-legend-panel-layer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
}

.layers-legend-panel-mode-chip {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.08);
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
}

.layers-legend-panel-break-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 20px;
  font-size: 11px;
  color: var(--text);
}

.layers-legend-panel-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(255,255,255,0.2);
  flex-shrink: 0;
}

.layers-legend-panel-empty {
  padding: 8px 10px;
  font-style: italic;
  color: var(--muted);
  font-size: 11px;
}
```

### MapConfigPanel INFO POPUP section (verified reference at lines 269-349)

The INFO POPUP section pattern confirmed:
- `<div className="config-group">` wrapper
- `<div className="config-group-label">INFO POPUP</div>` label
- `<label className="config-toggle">` for the checkbox
- `onChange({ ...config, infoEnabled: e.target.checked })` inline handler
- Conditional sub-controls rendered when enabled

Phase 41 LAYERS PANEL section mirrors this structure exactly, no new CSS classes needed for the wrapper.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OL addOverlay for DOM overlays | React-tree-mounted absolute-positioned divs | Phase 35 post-VERIFY | Phase 41 panel MUST follow React-tree approach |
| Object/array Zustand selectors | Primitive string selectors (PITFALL S-02) | Phase 27/29/35 | legendKey follows the locked pattern |
| Per-component store subscriptions | Caller composes props, component is pure | Phase 21/23 InfoPopup/InfoCard | LayersLegendPanel props-driven; Phase 42 reuses for different source |
| Inline CSS in JSX `style={}` | Global stylesheet classes | Phase 11+ | Append to global.css; no inline styles for layout |

**Deprecated/outdated:**
- OL `addOverlay` for React overlays: documented pitfall at MapChartRenderer.tsx:1811-1831. Crashes React reconciler when popup fiber is moved by OL.
- `useDashboardLayersStore(s => s.layers)` as direct dep: causes re-render storms. Use joined primitive selector.

---

## Key Integration Points: Exact File Locations + Signatures

These are verified from source inspection and are the authoritative data for the planner.

### 1. MapChartRenderer.tsx — Legend-relevant lines

| Line range | Content | Phase 41 action |
|------------|---------|-----------------|
| 414 | `const widgetConfig = (widget.config ?? {}) as Record<string, unknown>` | Read `widgetConfig.legendPanelEnabled` + `widgetConfig.legendPanelCorner` here |
| 491–497 | `viewsKey` primitive selector (PITFALL S-02 example) | Mirror for `legendKey` |
| 510–519 | `dynamicViewsKey` primitive selector | Mirror for `legendKey` |
| 523–525 | `shapesKey` primitive selector | Mirror for `legendKey` |
| 1809–1832 | `<div className="widget-map">` open + popup container at position 0 | Popup STAYS at position 0 |
| 1862 | `<div ref={containerRef} className="widget-map-canvas" />` | OL canvas — panel is NOT inside this |
| 1868–1883 | `<MapZoomToolbar ... />` | z=1001; panel must be z=1000 |
| 1885–1893 | `<MapDrawToolbar ... />` | Panel goes AFTER this |
| 1895–1922 | Reconfigure + empty overlays | Panel goes BEFORE these |
| 1946 | `</div>` close `widget-map` | Panel is a sibling inside here |

### 2. MapConfigPanel.tsx — Integration point

| Line range | Content | Phase 41 action |
|------------|---------|-----------------|
| 65–100 | Props destructure + `widgetCfg = config as Partial<MapWidgetConfig>` cast | Phase 41 reads `getLegendPanelEnabled(widgetCfg)` same way |
| 93 | `const widgetCfg = config as Partial<MapWidgetConfig>` | Phase 41 helpers receive this same cast |
| 269–349 | INFO POPUP section | Phase 41 LAYERS PANEL section mirrors this EXACT structure |
| 349 (end of INFO POPUP div) | Closing `</div>` of INFO POPUP config-group | Phase 41 LAYERS PANEL section appended immediately after |

### 3. DashboardLayerDto — verified fields for panel

```typescript
// kinetica_bi/src/api/client.ts lines 454-484 (verified)
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;  // renderMode is at (config as Record<string,unknown>).renderMode
  info_enabled: number;
  info_columns: string | null;
  info_template: string | null;
  dynamic_view_id: number | null;
  cb_config: string | null;         // Phase 41 panel reads this via coalesceCbConfig()
  track_config: string | null;
  created_at: string;
  updated_at: string;
};
```

**Critical**: `config` is `Record<string, unknown>` — access renderMode as `(layer.config as {renderMode?: string}).renderMode ?? "raster"`.

### 4. useDashboardLayersStore — verified signature

```typescript
// kinetica_bi/src/store/dashboardLayersStore.ts (verified)
export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer] })),
  updateLayer: (id, patch) =>
    set((state) => {
      // Reference-stable: only matching layer is recreated (lines 36-46)
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx < 0) return state;
      const next = state.layers.slice();
      next[idx] = { ...next[idx], ...patch };
      return { layers: next };
    }),
  removeLayer: (id) => ...,
  reorderLayers: (ordered) => ...,
}));
```

`updateLayer` is reference-stable — only the mutated layer changes identity. Non-mutated layers keep their object reference. The `legendKey` primitive selector correctly tracks this.

### 5. cbConfig.ts — verified exports (Phase 38 deliverable)

```typescript
// kinetica_bi/src/lib/cbConfig.ts (verified — Phase 38 shipped)
export type CbBreak = {
  value: string | number;
  color: string;          // 8-char AARRGGBB
  label?: string;
  pointSize?: number;
  pointShape?: string;
  shapeLineWidth?: number;
  shapeLineColor?: string;
  shapeFillColor?: string;
};

export type CbConfig = {
  attr: string;
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];
  includeOtherBucket?: boolean;
};

export const EMPTY_CB_CONFIG: CbConfig = { attr: "", valsType: "numeric", breaks: [] };
export const PALETTE_COLORS: readonly string[];       // 8 colors, AARRGGBB format
export function coalesceCbConfig(raw: string | null): CbConfig;       // NEVER throws
export function isCbConfigConfigured(cfg: CbConfig): boolean;          // attr non-empty + breaks.length > 0
export function createDefaultBreak(valsType, index): CbBreak;          // fully-populated break
export function filterCbEligibleColumns(columns, spatialBound?): {...}[];
export function detectValsTypeFromColumn(column?): "numeric" | "categorical";
```

**Phase 41 uses**: `coalesceCbConfig`, `CbBreak`, `CbConfig`, `isCbConfigConfigured`.

### 6. colorHex.ts — verified exports

```typescript
// kinetica_bi/src/lib/colorHex.ts (verified)
export function normalizeAARRGGBB(hex: string | undefined, fallback?: string): string;
export function rgbFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function alphaFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function joinAARRGGBB(alpha: string, rgb: string): string;
export function alphaPercentToHex(pct: number): string;
export function alphaHexToPercent(hex: string): number;
```

**Phase 41 uses**: `normalizeAARRGGBB` for swatch color conversion. Extract alpha + RGB for `rgba(r,g,b,a)` CSS syntax.

### 7. mapInfoConfig.ts — template to mirror for legendPanelConfig.ts

```typescript
// kinetica_bi/src/lib/mapInfoConfig.ts (verified — Phase 19 shipped)
// Pattern:
export const DEFAULT_INFO_ENABLED = true;
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
  return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
}
// Phase 41 mirrors with Pick<MapWidgetConfig, "legendPanelEnabled"> etc.
```

### 8. CSS conventions — verified

- **Single global stylesheet**: `kinetica_bi/src/styles/global.css` — the ONLY CSS file.
- **No CSS modules, no Tailwind**.
- **`.widget-map` is `position: relative`** (line 1592–1597) — panel uses `position: absolute` inside it.
- **Toolbar z-index**: `map-zoom-toolbar` and `map-draw-toolbar` both at `z-index: 1001` (lines 1670, 1683).
- **Chip/badge existing patterns** (for render-mode chip reference):
  - `.layer-row-badge` (line 2036): `font-size: 11px; padding: 4px 8px; border-radius: 4px; font-weight: 600`. Phase 41 `.layers-legend-panel-mode-chip` should mirror this for visual consistency.
  - `.filter-bar-chip` (line 1038): larger chip with accent color. Not appropriate for the panel's neutral chip.

### 9. MapConfigPanel.spec.tsx — test pattern for Phase 41 additions

```typescript
// kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (verified)
// Store mock pattern:
vi.mock("../../store/dashboardLayersStore", () => ({
  useDashboardLayersStore: (selector: (s: any) => any) =>
    selector({ layers: _storeState.layers }),
}));

// makeLayer helper includes cb_config: null and track_config: null (Phase 38 fields)
const makeLayer = (id: number, position: number = 0): DashboardLayerDto => ({
  ...
  cb_config: null,
  track_config: null,
  ...
});

// makeConfig helper:
const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  basemap: "osm",
  title: "Test Map",
  ...overrides,
});
```

Phase 41 adds tests that pass `legendPanelEnabled: true` / `false` in `makeConfig` overrides and assert the toggle + corner picker render/fire correctly.

### 10. MapChartRenderer.spec.tsx — test pattern for Phase 41

The spec file uses module-level shared state objects (`_layersState`, `_filterState`, etc.) captured by `vi.mock` factories. Phase 41 adds a Phase 39 pattern (CB fingerprint tests at line 4347-4392) — a standalone `describe` block at the end of the file is the correct addition point. The spatial filter store mock at Phase 29+ does NOT mock `useDashboardLayersStore` directly (the real store is used via the `_layersState` module-level variable).

---

## Open Questions

1. **Should `legendKey` include `layer.name` changes?**
   - What we know: Layer name is in `DashboardLayerDto.config` (implicitly, as the panel shows `layer.name`). Actually: the name is displayed by the panel but the panel gets it from the full DTO via `ResolvedLegendLayer.layer`. If the layer name changes (via a server-side PATCH), the store's `updateLayer` fires, which changes the layer object → `legendKey` changes IF name participates in the key.
   - What's unclear: The 41-CONTEXT.md legendKey formula only includes `id:renderMode:cb_config`. A name change (renaming a layer) would NOT change legendKey as currently specified.
   - Recommendation: Keep the formula as specified in CONTEXT.md — include `layer.id + renderMode + cb_config`. If layer naming surfaces in Phase 42+, the planner can extend the key. The panel shows whatever `layer.config.name` (or similar) is at render time; name changes do cause a MapChartRenderer re-render via the PATCH chain naturally.

2. **`layer.config.renderMode` access vs `layer.config` typing**
   - What we know: `DashboardLayerDto.config` is `Record<string, unknown>`. The renderMode is accessed as `(layer.config as {renderMode?: string}).renderMode` in MapChartRenderer.tsx line 553.
   - Recommendation: Follow the same cast pattern in the panel: `const renderMode = (layer.config as {renderMode?: string}).renderMode ?? "raster"`. No new types needed.

---

## Sources

### Primary (HIGH confidence — verified from direct source inspection)

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — lines 413-414 (widgetConfig), 491-525 (viewsKey/dynamicViewsKey/shapesKey patterns), 1809-1946 (widget-map JSX block, popup position 0, toolbar siblings, overlay mounts)
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — lines 65-100 (props + widgetCfg cast), 269-349 (INFO POPUP section pattern), 350-368 (SHAPE DISPLAY section pattern after INFO POPUP)
- `kinetica_bi/src/lib/cbConfig.ts` — full file verified (CbBreak, CbConfig, coalesceCbConfig, PALETTE_COLORS, createDefaultBreak, EMPTY_CB_CONFIG, isCbConfigConfigured)
- `kinetica_bi/src/lib/colorHex.ts` — full file verified (normalizeAARRGGBB, rgbFromAARRGGBB, alphaFromAARRGGBB, joinAARRGGBB)
- `kinetica_bi/src/lib/mapInfoConfig.ts` — full file verified (DEFAULT_INFO_ENABLED, getInfoEnabled, getInfoRadiusPx pattern — exact template for legendPanelConfig.ts)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — lines 65-134 (MapWidgetConfig type — confirmed optional field pattern)
- `kinetica_bi/src/store/dashboardLayersStore.ts` — full file verified (updateLayer reference-stable implementation)
- `kinetica_bi/src/api/client.ts` — lines 454-484 (DashboardLayerDto — cb_config: string | null confirmed)
- `kinetica_bi/src/styles/global.css` — key sections verified: `.widget-map` (1592-1597 position:relative), `.map-zoom-toolbar` (1670 z:1001), `.map-draw-toolbar` (1673-1684 z:1001), `.config-group` (887-916), `.layer-row-badge` (2036-2048 chip pattern), `.filter-bar-chip` (1038-1051 chip pattern)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — lines 1-82 (module-level shared state mock pattern), 4347-4392 (Phase 39 standalone describe block pattern)
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — full file verified (store mock + makeLayer + makeConfig test helpers)
- `kinetica_bi/src/components/charts/CbConfigForm.tsx` — lines 1-80 (component structure, imports, patchCb pattern) — confirmed Phase 39 shipped
- `.planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md` — all locked decisions, CSS class names, z-index, component shape, legendKey formula

### Secondary (MEDIUM confidence — planning docs + verified code alignment)

- `.planning/REQUIREMENTS.md` §"LayersLegendPanel + In-Map Overlay" — PANEL-V17-01..07 literal requirements cross-checked against code findings
- `.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md` — cb_config JSON schema + coalesceCbConfig helper decisions
- `.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md` — `<other>` default-ON, value-fallback rule, palette, autosave debounce

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in source files; zero new npm deps confirmed
- Architecture patterns: HIGH — viewsKey/dynamicViewsKey/shapesKey patterns read directly from MapChartRenderer.tsx; INFO POPUP section pattern read directly from MapConfigPanel.tsx
- CSS conventions: HIGH — verified single global.css; no CSS modules; toolbar z-index locked in source; `.widget-map` position:relative confirmed
- DashboardLayerDto fields: HIGH — cb_config: string | null field confirmed at client.ts:480
- Pitfalls: HIGH — popup-at-position-0 lesson documented in source comments at lines 1811-1831; PITFALL S-02 pattern documented at lines 521-523
- Open questions: LOW — minor edge cases with negligible planning risk

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (stable patterns; frontend-only; no external API dependencies)
