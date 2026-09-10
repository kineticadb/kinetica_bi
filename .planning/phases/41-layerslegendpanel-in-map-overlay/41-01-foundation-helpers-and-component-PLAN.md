---
phase: 41-layerslegendpanel-in-map-overlay
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/legendPanelConfig.ts
  - kinetica_bi/src/lib/legendPanelConfig.spec.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/components/LayersLegendPanel.tsx
  - kinetica_bi/src/components/LayersLegendPanel.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - PANEL-V17-01
  - PANEL-V17-04
  - PANEL-V17-06
must_haves:
  truths:
    - "`<LayersLegendPanel />` is a pure presentational component with no internal Zustand subscriptions"
    - "Component renders per-layer header rows + classbreak break-rows + empty states correctly"
    - "Component renders `<other>` rows verbatim, no titlecasing"
    - "`MapWidgetConfig` has new optional fields `legendPanelEnabled?` and `legendPanelCorner?` for backward-compat"
    - "`getLegendPanelEnabled` defaults to `false`; `getLegendPanelCorner` defaults to `'top-right'` with union validation"
    - "Panel CSS classes `.layers-legend-panel*` + 4 corner-modifier classes exist in global.css at z=1000"
  artifacts:
    - path: "kinetica_bi/src/lib/legendPanelConfig.ts"
      provides: "LEGEND_PANEL_CORNERS const + LegendPanelCorner type + getLegendPanelEnabled + getLegendPanelCorner helpers"
      exports: ["LEGEND_PANEL_CORNERS", "LegendPanelCorner", "DEFAULT_LEGEND_PANEL_ENABLED", "DEFAULT_LEGEND_PANEL_CORNER", "getLegendPanelEnabled", "getLegendPanelCorner"]
    - path: "kinetica_bi/src/lib/legendPanelConfig.spec.ts"
      provides: "Pure unit tests covering defaults + validation for both helpers"
    - path: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      provides: "Pure presentational component, props-driven, no store subscriptions"
      exports: ["LayersLegendPanel", "ResolvedLegendLayer"]
      min_lines: 90
    - path: "kinetica_bi/src/components/LayersLegendPanel.spec.tsx"
      provides: "Component test surface covering per-mode rendering + empty states + collapse callback + a11y"
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "MapWidgetConfig extended with legendPanelEnabled? + legendPanelCorner? optional fields"
      contains: "legendPanelEnabled?: boolean"
    - path: "kinetica_bi/src/styles/global.css"
      provides: "`.layers-legend-panel*` selectors + 4 corner modifiers at z=1000"
      contains: ".layers-legend-panel"
  key_links:
    - from: "kinetica_bi/src/lib/legendPanelConfig.ts"
      to: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      via: "import type { MapWidgetConfig }"
      pattern: "import type \\{ MapWidgetConfig \\} from \"./wmsUrlBuilder\""
    - from: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      to: "kinetica_bi/src/lib/cbConfig.ts"
      via: "coalesceCbConfig + CbBreak"
      pattern: "coalesceCbConfig"
    - from: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      to: "kinetica_bi/src/lib/colorHex.ts"
      via: "normalizeAARRGGBB for swatch color conversion"
      pattern: "normalizeAARRGGBB"
---

<objective>
Ship the foundation for Phase 41: dormant pure-presentational `<LayersLegendPanel />` component + `lib/legendPanelConfig.ts` helpers + `MapWidgetConfig` field extension + CSS. Zero production wiring — Plan 41-02 mounts the component and adds the MapConfigPanel toggle.

Purpose: Establish the contract (props, types, defaults, CSS classes) so Plan 41-02 has no architectural choices to make — only wiring.

Output:
- New file `kinetica_bi/src/lib/legendPanelConfig.ts` (helpers + types + defaults)
- New file `kinetica_bi/src/lib/legendPanelConfig.spec.ts` (unit tests)
- New file `kinetica_bi/src/components/LayersLegendPanel.tsx` (pure presentational component)
- New file `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` (component tests)
- Extended `kinetica_bi/src/lib/wmsUrlBuilder.ts` (`MapWidgetConfig` with 2 new optional fields)
- Extended `kinetica_bi/src/styles/global.css` (panel CSS classes)
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
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md

# Phase 38 deliverables to consume
@kinetica_bi/src/lib/cbConfig.ts
@kinetica_bi/src/lib/colorHex.ts

# Helper-pattern precedent to mirror
@kinetica_bi/src/lib/mapInfoConfig.ts
@kinetica_bi/src/lib/mapInfoConfig.spec.ts

# MapWidgetConfig owner — extension point
@kinetica_bi/src/lib/wmsUrlBuilder.ts

# DTO contract for layers prop
@kinetica_bi/src/api/client.ts

# Pure presentational precedent
@kinetica_bi/src/components/InfoPopup.tsx

<interfaces>
<!-- Authoritative contracts the executor MUST implement against -->

From kinetica_bi/src/lib/cbConfig.ts (Phase 38 shipped — VERIFIED):
```typescript
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

export const EMPTY_CB_CONFIG: CbConfig;
export const PALETTE_COLORS: readonly string[];
export function coalesceCbConfig(raw: string | null): CbConfig;       // NEVER throws
export function isCbConfigConfigured(cfg: CbConfig): boolean;
```

From kinetica_bi/src/lib/colorHex.ts (existing):
```typescript
export function normalizeAARRGGBB(hex: string | undefined, fallback?: string): string;
```

From kinetica_bi/src/api/client.ts (lines 454-484 — VERIFIED):
```typescript
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;  // renderMode accessed as (config as {renderMode?: string}).renderMode
  info_enabled: number;
  info_columns: string | null;
  info_template: string | null;
  dynamic_view_id: number | null;
  cb_config: string | null;
  track_config: string | null;
  created_at: string;
  updated_at: string;
};
```

From kinetica_bi/src/lib/mapInfoConfig.ts (template to MIRROR for legendPanelConfig.ts):
```typescript
export const DEFAULT_INFO_ENABLED = true;
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
  return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
}
```

NEW contracts this plan creates (Plan 41-02 will consume):
```typescript
// kinetica_bi/src/lib/legendPanelConfig.ts (NEW)
export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];
export const DEFAULT_LEGEND_PANEL_ENABLED: boolean = false;
export const DEFAULT_LEGEND_PANEL_CORNER: LegendPanelCorner = 'top-right';
export function getLegendPanelEnabled(config: Pick<MapWidgetConfig, "legendPanelEnabled">): boolean;
export function getLegendPanelCorner(config: Pick<MapWidgetConfig, "legendPanelCorner">): LegendPanelCorner;

// kinetica_bi/src/components/LayersLegendPanel.tsx (NEW)
export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};
export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
export function LayersLegendPanel(props: LayersLegendPanelProps): JSX.Element;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: legendPanelConfig helpers + MapWidgetConfig extension + companion spec</name>
  <files>
    kinetica_bi/src/lib/legendPanelConfig.ts (NEW),
    kinetica_bi/src/lib/legendPanelConfig.spec.ts (NEW),
    kinetica_bi/src/lib/wmsUrlBuilder.ts (EXTEND)
  </files>
  <read_first>
    - kinetica_bi/src/lib/mapInfoConfig.ts (FULL — exact template to mirror including export ordering, comment style, Pick<> argument typing)
    - kinetica_bi/src/lib/mapInfoConfig.spec.ts (FULL — unit-test pattern to mirror)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts lines 1-150 (locate MapWidgetConfig type definition; identify the field-append site — per research it's lines 65-134 with `spatialTargets?: SpatialTarget[]` as the last field)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md §"Persisted field types — `lib/legendPanelConfig.ts` helpers" (verbatim helper code)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md §"Pattern 5: legendPanelConfig.ts Helpers" (verified mirror template)
  </read_first>
  <behavior>
    - Test 1: `getLegendPanelEnabled({})` returns `false` (default).
    - Test 2: `getLegendPanelEnabled({ legendPanelEnabled: true })` returns `true`.
    - Test 3: `getLegendPanelEnabled({ legendPanelEnabled: false })` returns `false`.
    - Test 4: `getLegendPanelEnabled({ legendPanelEnabled: undefined })` returns `false`.
    - Test 5: `getLegendPanelCorner({})` returns `'top-right'` (default).
    - Test 6: `getLegendPanelCorner({ legendPanelCorner: 'top-left' })` returns `'top-left'`.
    - Test 7: `getLegendPanelCorner({ legendPanelCorner: 'bottom-right' })` returns `'bottom-right'`.
    - Test 8: `getLegendPanelCorner({ legendPanelCorner: 'bottom-left' })` returns `'bottom-left'`.
    - Test 9: `getLegendPanelCorner({ legendPanelCorner: 'invalid-corner' as any })` returns `'top-right'` (fallback).
    - Test 10: `getLegendPanelCorner({ legendPanelCorner: undefined })` returns `'top-right'`.
    - Test 11: `LEGEND_PANEL_CORNERS` contains exactly 4 entries in order: `'top-right', 'top-left', 'bottom-right', 'bottom-left'`.
    - Test 12: `DEFAULT_LEGEND_PANEL_ENABLED === false` (exact).
    - Test 13: `DEFAULT_LEGEND_PANEL_CORNER === 'top-right'` (exact).
  </behavior>
  <action>
    1. CREATE `kinetica_bi/src/lib/legendPanelConfig.ts` with EXACT content (mirror mapInfoConfig.ts style):

```typescript
import type { MapWidgetConfig } from "./wmsUrlBuilder";

// v1.7 Phase 41 (PANEL-V17-04): Layers Legend Panel defaults + corner enum.
// Mirrors v1.4 Phase 19 mapInfoConfig.ts pattern verbatim.

export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];

export const DEFAULT_LEGEND_PANEL_ENABLED: boolean = false;
export const DEFAULT_LEGEND_PANEL_CORNER: LegendPanelCorner = 'top-right';

export function getLegendPanelEnabled(
  config: Pick<MapWidgetConfig, "legendPanelEnabled">,
): boolean {
  return config.legendPanelEnabled ?? DEFAULT_LEGEND_PANEL_ENABLED;
}

export function getLegendPanelCorner(
  config: Pick<MapWidgetConfig, "legendPanelCorner">,
): LegendPanelCorner {
  const v = config.legendPanelCorner;
  return LEGEND_PANEL_CORNERS.includes(v as LegendPanelCorner)
    ? (v as LegendPanelCorner)
    : DEFAULT_LEGEND_PANEL_CORNER;
}
```

    2. EXTEND `kinetica_bi/src/lib/wmsUrlBuilder.ts` `MapWidgetConfig` type. Locate the `MapWidgetConfig` type (per research lines 65-134, ending with `spatialTargets?: SpatialTarget[];` field). Append AFTER the last field, BEFORE the closing brace:

```typescript
  // v1.7 Phase 41 (PANEL-V17-04): Layers Legend Panel widget-level config.
  // Both optional for backward-compat with legacy widget config blobs —
  // missing fields default via getLegendPanelEnabled() / getLegendPanelCorner()
  // in lib/legendPanelConfig.ts (same pattern as v1.4 Phase 19 mapInfoConfig.ts).
  legendPanelEnabled?: boolean;
  legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
```

    3. CREATE `kinetica_bi/src/lib/legendPanelConfig.spec.ts` covering all 13 behaviors above. Use vitest `describe`/`it`/`expect`. Mirror `mapInfoConfig.spec.ts` patterns (describe per helper, one assertion per `it`). Use empty cast `as Pick<MapWidgetConfig, "legendPanelEnabled">` or `as any` for the partial config inputs in tests — do NOT import MapWidgetConfig in tests (mapInfoConfig.spec.ts precedent).

    4. Verify TypeScript compiles: `cd kinetica_bi && npx tsc --noEmit` must succeed.

    AVOID:
    - Do NOT import MapWidgetConfig from a different module (use `./wmsUrlBuilder` — same file as Phase 19 helper).
    - Do NOT add validation that throws on invalid input — return the default silently (matches mapInfoConfig pattern).
    - Do NOT add a clamping function — UI enforces bounds at edit time (Plan 41-02 picker is a hard select).
    - Do NOT use `??` for corner validation — must use `LEGEND_PANEL_CORNERS.includes(...)` so a stored junk-string falls back to default (NOT preserved).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/legendPanelConfig.spec.ts --reporter=verbose && npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export const LEGEND_PANEL_CORNERS" kinetica_bi/src/lib/legendPanelConfig.ts` returns `1`
    - `grep -c "export function getLegendPanelEnabled" kinetica_bi/src/lib/legendPanelConfig.ts` returns `1`
    - `grep -c "export function getLegendPanelCorner" kinetica_bi/src/lib/legendPanelConfig.ts` returns `1`
    - `grep -c "DEFAULT_LEGEND_PANEL_ENABLED" kinetica_bi/src/lib/legendPanelConfig.ts` returns `>= 2` (declare + use)
    - `grep -c "DEFAULT_LEGEND_PANEL_CORNER" kinetica_bi/src/lib/legendPanelConfig.ts` returns `>= 2` (declare + use)
    - `grep "legendPanelEnabled?: boolean" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 1 match
    - `grep "legendPanelCorner?:" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 1 match
    - `grep -c "'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns `1`
    - All 13 spec tests pass (vitest exit 0)
    - `npx tsc --noEmit` exits 0 (no type errors anywhere in the project)
  </acceptance_criteria>
  <done>
    legendPanelConfig.ts + spec exist with all 13 tests green; MapWidgetConfig in wmsUrlBuilder.ts has the two new optional fields; tsc clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: LayersLegendPanel pure presentational component + companion spec</name>
  <files>
    kinetica_bi/src/components/LayersLegendPanel.tsx (NEW),
    kinetica_bi/src/components/LayersLegendPanel.spec.tsx (NEW)
  </files>
  <read_first>
    - kinetica_bi/src/lib/cbConfig.ts (FULL — CbBreak, CbConfig, coalesceCbConfig, isCbConfigConfigured signatures + behavior)
    - kinetica_bi/src/lib/colorHex.ts (FULL — normalizeAARRGGBB signature)
    - kinetica_bi/src/api/client.ts lines 454-484 (DashboardLayerDto shape; access renderMode via (config as {renderMode?: string}).renderMode)
    - kinetica_bi/src/components/InfoPopup.tsx (pure presentational component precedent — props-only, no Zustand)
    - kinetica_bi/src/lib/legendPanelConfig.ts (created in Task 1 — import LegendPanelCorner type)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md §"Per-render-mode rendering" + §"Color swatch" + §"<other> row" + §"Label vs value fallback" + §"Collapse interaction + default" + §"Empty / no-layers state"
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md §"Pattern 6: Color Swatch from AARRGGBB" + §"LayersLegendPanel props contract"
  </read_first>
  <behavior>
    - Test 1 (empty layers): `<LayersLegendPanel layers={[]} corner="top-right" collapsed={false} onToggleCollapse={fn} />` renders header "Layers" + body containing exact text "No layers configured on this widget." with class `.layers-legend-panel-empty`.
    - Test 2 (raster layer): a layer with `config: { renderMode: "raster" }` renders ONE row with the layer name + a chip containing exact text "Raster" with class `.layers-legend-panel-mode-chip` and NO break rows.
    - Test 3 (heatmap layer): a layer with `config: { renderMode: "heatmap" }` renders chip text "Heatmap" + NO break rows.
    - Test 4 (classbreak layer with breaks): a layer with `config: { renderMode: "classbreak" }, cb_config: JSON.stringify({attr: "fare", valsType: "numeric", breaks: [{value: 10, color: "FFFF0000", label: "Low"}, {value: 20, color: "FF00FF00", label: ""}]})` renders chip text "Class Break" + 2 break rows. Row 1 text contains "Low" (label preferred). Row 2 text contains "20" (label empty → value fallback).
    - Test 5 (classbreak layer with empty cb_config): a layer with `cb_config: null` and `renderMode: "classbreak"` renders chip "Class Break" + italic gray hint with exact text "No breaks configured" (class `.layers-legend-panel-empty`).
    - Test 6 (`<other>` row verbatim): a CB break with `value: "<other>"` renders the LITERAL text `<other>` (not "Other" or "<Other>"). Use `getByText` exact match.
    - Test 7 (color swatch present): each CB break row contains ONE element with class `.layers-legend-panel-swatch`. Its `style.backgroundColor` is a valid CSS color string derived from the break.color via `normalizeAARRGGBB` (e.g., `"rgba(255,0,0,1)"` for `FFFF0000`).
    - Test 8 (collapsed body hidden): when `collapsed={true}`, body element (class `.layers-legend-panel-body`) is NOT present in the DOM OR has `aria-hidden="true"`.
    - Test 9 (header click fires toggle): clicking the header (class `.layers-legend-panel-header`) calls `onToggleCollapse` exactly once.
    - Test 10 (chevron icon reflects state): when `collapsed={false}` header text contains `▾`; when `collapsed={true}` header text contains `▸`.
    - Test 11 (corner modifier class): `corner="bottom-left"` applies CSS class `.layers-legend-panel--bottom-left` to the root.
    - Test 12 (a11y): root has `role="region"` + `aria-label="Map layer legend"`. Chevron button has `aria-expanded={!collapsed}` + `aria-controls` pointing to a body element id.
    - Test 13 (contour render-mode legacy): a layer with `config: { renderMode: "contour" }` renders chip text "Contour" + NO break rows + does NOT crash.
    - Test 14 (no Zustand imports): grep verifies the component source file does NOT import from `../store/dashboardLayersStore` or any `useDashboardLayersStore` reference (pure presentational lock).
    - Test 15 (renderMode fallback): a layer with `config: {}` (no renderMode) renders chip text "Raster" (default fallback).
    - Test 16 (label fallback chain): CB break with `label: undefined` and numeric `value: 42` renders text "42". CB break with `label: ""` and `value: "categoryA"` renders text "categoryA". CB break with `label: "Custom Label"` and `value: 99` renders text "Custom Label".
  </behavior>
  <action>
    1. CREATE `kinetica_bi/src/components/LayersLegendPanel.tsx` as a pure functional component. Use the EXACT structure below:

```typescript
import type { DashboardLayerDto } from "../api/client";
import type { LegendPanelCorner } from "../lib/legendPanelConfig";
import { coalesceCbConfig, isCbConfigConfigured, type CbBreak } from "../lib/cbConfig";
import { normalizeAARRGGBB } from "../lib/colorHex";
import { useId } from "react";

export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};

export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// Convert 8-char AARRGGBB to CSS rgba() string for swatch background.
function aarrggbbToCssColor(aarrggbb: string): string {
  const norm = normalizeAARRGGBB(aarrggbb, "FF000000");
  const a = parseInt(norm.slice(0, 2), 16) / 255;
  const r = parseInt(norm.slice(2, 4), 16);
  const g = parseInt(norm.slice(4, 6), 16);
  const b = parseInt(norm.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function renderModeLabel(renderMode: string): string {
  switch (renderMode) {
    case "raster":     return "Raster";
    case "heatmap":    return "Heatmap";
    case "classbreak": return "Class Break";
    case "contour":    return "Contour";
    default:           return "Raster";
  }
}

function breakDisplayText(brk: CbBreak): string {
  if (brk.label && brk.label.length > 0) return brk.label;
  // value can be string or number; render <other> verbatim, no titlecasing
  return String(brk.value);
}

export function LayersLegendPanel({
  layers,
  corner,
  collapsed,
  onToggleCollapse,
}: LayersLegendPanelProps): JSX.Element {
  const bodyId = useId();
  const rootClass = `layers-legend-panel layers-legend-panel--${corner}`;

  return (
    <div className={rootClass} role="region" aria-label="Map layer legend">
      <div
        className="layers-legend-panel-header"
        onClick={onToggleCollapse}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span>Layers</span>
      </div>
      {!collapsed && (
        <div className="layers-legend-panel-body" id={bodyId}>
          {layers.length === 0 ? (
            <div className="layers-legend-panel-empty">
              No layers configured on this widget.
            </div>
          ) : (
            layers.map(({ layer }) => {
              const renderMode = ((layer.config as { renderMode?: string })?.renderMode) ?? "raster";
              const cb = coalesceCbConfig(layer.cb_config);
              const isCb = renderMode === "classbreak";
              const cbConfigured = isCb && isCbConfigConfigured(cb);
              return (
                <div key={layer.id} className="layers-legend-panel-layer-block">
                  <div className="layers-legend-panel-layer">
                    <span>{(layer as any).name ?? `Layer ${layer.id}`}</span>
                    <span className="layers-legend-panel-mode-chip">
                      {renderModeLabel(renderMode)}
                    </span>
                  </div>
                  {isCb && cbConfigured && cb.breaks.map((brk, i) => (
                    <div key={i} className="layers-legend-panel-break-row">
                      <span
                        className="layers-legend-panel-swatch"
                        style={{ backgroundColor: aarrggbbToCssColor(brk.color) }}
                        aria-hidden="true"
                      />
                      <span>{breakDisplayText(brk)}</span>
                    </div>
                  ))}
                  {isCb && !cbConfigured && (
                    <div className="layers-legend-panel-empty">
                      No breaks configured
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
```

NOTE on `layer.name`: `DashboardLayerDto` per client.ts does NOT have a top-level `name` field (it has `config` blob). Check actual DTO: if `name` is at `(layer.config as any).name` use that; if it's a top-level field on the actual DTO type adjust accordingly. Use `(layer as any).name ?? (layer.config as any)?.name ?? \`Layer ${layer.id}\`` defensive chain. EXECUTOR: verify the actual DTO shape via grep before finalizing this line.

    2. CREATE `kinetica_bi/src/components/LayersLegendPanel.spec.tsx`. Use vitest + @testing-library/react. Build a `makeLayer(overrides)` helper that produces a valid `DashboardLayerDto`. Build a `makeResolvedLayer(layerOverrides)` helper returning `{ layer, visible: true }`. Cover all 16 behaviors above using `render(<LayersLegendPanel ... />)` + `screen.getByText` / `getByRole` / `queryByText` / `container.querySelector('.layers-legend-panel-body')`.

For Test 14 (no Zustand): use a grep in the spec setup OR a separate node-level test:
```typescript
import fs from "node:fs";
import path from "node:path";

it("does not import from dashboardLayersStore (pure presentational lock)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "./LayersLegendPanel.tsx"),
    "utf8",
  );
  expect(src).not.toMatch(/from\s+["'].*dashboardLayersStore["']/);
  expect(src).not.toMatch(/useDashboardLayersStore/);
});
```

    3. Verify: `cd kinetica_bi && npx vitest run src/components/LayersLegendPanel.spec.tsx` passes all 16 tests; `npx tsc --noEmit` clean.

    AVOID:
    - Do NOT import `useDashboardLayersStore` or any Zustand store inside the component (PANEL-V17-01 lock).
    - Do NOT call any side effects (no useEffect, no useState — collapse state is owned by the consumer).
    - Do NOT titlecase `<other>` — render literal.
    - Do NOT auto-compute numeric ranges (`≤ 10`, `10-25`) — show raw values only.
    - Do NOT add a "N hidden layers" footer (deferred).
    - Do NOT add a heatmap colormap gradient OR a raster pointColor swatch (deferred).
    - Do NOT include any `import { useDashboardLayersStore }` line — that's the explicit anti-pattern lock.
    - Do NOT add `addOverlay` or any OpenLayers code (this is a pure React component).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/LayersLegendPanel.spec.tsx --reporter=verbose && npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/LayersLegendPanel.tsx` exists with `>= 90` non-blank lines
    - `grep -c "export function LayersLegendPanel" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `1`
    - `grep -c "export type ResolvedLegendLayer" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `1`
    - `grep -c "coalesceCbConfig" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `>= 1`
    - `grep -c "normalizeAARRGGBB" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `>= 1`
    - `grep -c "useDashboardLayersStore" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `0` (pure presentational lock)
    - `grep -c "from.*dashboardLayersStore" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `0`
    - `grep -c "addOverlay" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `0`
    - `grep "role=\"region\"" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1 match
    - `grep "aria-label=\"Map layer legend\"" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1 match
    - `grep -c "aria-expanded" kinetica_bi/src/components/LayersLegendPanel.tsx` returns `>= 1`
    - All 16 spec tests pass (vitest exit 0)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Pure presentational `<LayersLegendPanel />` exists at the locked path with 16 green tests; grep confirms zero store subscriptions; tsc clean.
  </done>
</task>

<task type="auto">
  <name>Task 3: Append `.layers-legend-panel*` CSS to global.css</name>
  <files>
    kinetica_bi/src/styles/global.css (EXTEND)
  </files>
  <read_first>
    - kinetica_bi/src/styles/global.css lines 1592-1700 (locate `.widget-map` position:relative + `.map-zoom-toolbar` z=1001 + `.map-draw-toolbar` z=1001 + verify Phase 41 z=1000 is below toolbars)
    - kinetica_bi/src/styles/global.css search for `.layer-row-badge` (line ~2036 per research) — render-mode chip mirrors this exactly: font-size 11px, padding 4px 8px, border-radius 4px, font-weight 600
    - kinetica_bi/src/styles/global.css search for `.config-group` (line ~887 per research) — verify CSS-variable usage convention (`var(--border)`, `var(--muted)`, `var(--text)`)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-RESEARCH.md §"CSS corner positioning" (verbatim CSS block)
    - .planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md §"Z-index stacking" (z=1000 lock) + §"CSS class names" (all class names listed)
  </read_first>
  <action>
    1. Open `kinetica_bi/src/styles/global.css`. Locate the END of the file (or a convention-clean append point — likely after the existing `.widget-map*` block).

    2. Append the following CSS block VERBATIM (preserving the comment header so a grep audit can find the Phase 41 block):

```css
/* ============================================================================
 * v1.7 Phase 41: LayersLegendPanel (PANEL-V17-01/03/06)
 * In-map overlay panel mounted as React child of .widget-map.
 * z=1000 sits BELOW MapDrawToolbar/MapZoomToolbar (z=1001) per V15-P-17 lock.
 * ============================================================================ */

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

.layers-legend-panel-body {
  padding: 6px 0;
}

.layers-legend-panel-layer-block {
  /* Per-layer container; groups the header row + (optional) break rows */
}

.layers-legend-panel-layer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
}

/* Render-mode chip mirrors .layer-row-badge exactly per research */
.layers-legend-panel-mode-chip {
  display: inline-block;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border);
  color: var(--muted);
  font-weight: 600;
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
  border: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.layers-legend-panel-empty {
  padding: 8px 10px;
  font-style: italic;
  color: var(--muted);
  font-size: 11px;
}
```

    3. Verify no existing CSS class collisions by grepping `.layers-legend-panel` BEFORE appending — should return 0 matches OUTSIDE this new block.

    AVOID:
    - Do NOT use `z-index: 1001` or higher — locked at 1000 below toolbars.
    - Do NOT change the existing `.widget-map` `position: relative` rule (Phase 35 invariant).
    - Do NOT introduce CSS modules or Tailwind classes — codebase convention is single global.css.
    - Do NOT use inline `style={}` for positioning in the component (Plan 41-02 uses the modifier classes).
  </action>
  <verify>
    <automated>grep -c "layers-legend-panel" kinetica_bi/src/styles/global.css | awk '{ if ($1 >= 12) print "PASS: " $1 " selectors"; else print "FAIL: only " $1 " selectors found"; exit ($1 >= 12 ? 0 : 1) }'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^\\.layers-legend-panel " kinetica_bi/src/styles/global.css` returns exactly `1` (root selector)
    - `grep -c "^\\.layers-legend-panel--top-right" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel--top-left" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel--bottom-right" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel--bottom-left" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-header" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-body" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-layer " kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-mode-chip" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-break-row" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-swatch" kinetica_bi/src/styles/global.css` returns `1`
    - `grep -c "^\\.layers-legend-panel-empty" kinetica_bi/src/styles/global.css` returns `1`
    - `grep "z-index: 1000" kinetica_bi/src/styles/global.css | grep -c "layers-legend\\|Phase 41"` returns `>= 1` (z=1000 lock)
    - `grep -c "z-index: 1001" kinetica_bi/src/styles/global.css` is unchanged from pre-edit count (toolbar z=1001 NOT modified)
    - `cd kinetica_bi && npx vitest run --reporter=summary 2>&1 | tail -10` shows full frontend suite still passing
  </acceptance_criteria>
  <done>
    All 12 CSS selectors present in global.css; z=1000 lock confirmed; no toolbar z-index regressions; full frontend vitest still green.
  </done>
</task>

</tasks>

<verification>
**Overall plan verification:**

1. `cd kinetica_bi && npx tsc --noEmit` exits 0 (no type errors introduced)
2. `cd kinetica_bi && npx vitest run src/lib/legendPanelConfig.spec.ts src/components/LayersLegendPanel.spec.tsx` exits 0
3. `cd kinetica_bi && npx vitest run --reporter=summary` total suite still passes (previous pass count + new tests; no regressions)
4. Grep `useDashboardLayersStore` inside `LayersLegendPanel.tsx` returns 0 matches (pure presentational lock)
5. Grep `addOverlay` inside `LayersLegendPanel.tsx` returns 0 matches
6. Grep `legendPanelEnabled` inside `wmsUrlBuilder.ts` returns 1 match (the new optional field)
7. CSS file has all 12 `.layers-legend-panel*` selectors AND root z-index is 1000 (NOT 1001)

**Goal-backward check against the 5 ROADMAP SC for Phase 41:**
- SC1 (pure presentational + legendKey selector): Plan 41-01 ships PURE component (this plan). legendKey selector is Plan 41-02.
- SC2 (toggle shows/hides + persists): Plan 41-01 ships MapWidgetConfig field. Plan 41-02 wires toggle.
- SC3 (React-tree mount + corners + doesn't block draw): Plan 41-01 ships CSS with z=1000. Plan 41-02 mounts.
- SC4 (collapse session-only): Plan 41-01 component accepts collapsed prop + emits onToggleCollapse. Plan 41-02 owns the local useState.
- SC5 (live cb_config edit reflects): Plan 41-01 component reads from layer.cb_config every render. Plan 41-02 legendKey triggers re-render on store change.

All 5 SCs are supported once Plans 01 + 02 ship.
</verification>

<success_criteria>
- `kinetica_bi/src/lib/legendPanelConfig.ts` exports `LEGEND_PANEL_CORNERS`, `LegendPanelCorner`, `DEFAULT_LEGEND_PANEL_ENABLED`, `DEFAULT_LEGEND_PANEL_CORNER`, `getLegendPanelEnabled`, `getLegendPanelCorner`
- `kinetica_bi/src/lib/legendPanelConfig.spec.ts` has 13 green tests
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` `MapWidgetConfig` has `legendPanelEnabled?: boolean` and `legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'` optional fields
- `kinetica_bi/src/components/LayersLegendPanel.tsx` exports `LayersLegendPanel`, `ResolvedLegendLayer`, `LayersLegendPanelProps` — pure presentational, zero Zustand imports
- `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` has 16 green tests including the no-Zustand-import grep test
- `kinetica_bi/src/styles/global.css` has all 12 `.layers-legend-panel*` CSS selectors at z=1000
- Frontend `npx tsc --noEmit` clean
- Frontend `npx vitest run` total suite green (no regressions)
- Plan 41-02 has everything it needs to wire (helpers + component + types + CSS classes)
</success_criteria>

<output>
After completion, create `.planning/phases/41-layerslegendpanel-in-map-overlay/41-01-SUMMARY.md` documenting:
- All 3 tasks shipped (helpers + component + CSS)
- Test counts: 13 helper tests + 16 component tests = 29 new green tests
- Plan 41-02 unblocked (component dormant, ready for mount + wiring)
- Decisions made under "Claude's Discretion" from CONTEXT.md (chip text "Class Break", swatch 12×12, CSS in global.css, component file at `components/LayersLegendPanel.tsx`, palette colors NOT re-emitted (read from cb_config directly), legendKey formula deferred to Plan 41-02)
</output>
