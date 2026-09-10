---
phase: 41-layerslegendpanel-in-map-overlay
plan: "01"
subsystem: frontend-component
tags: [legend-panel, pure-presentational, css, helpers, tdd]
dependency_graph:
  requires: [phase-38-cbConfig, phase-38-colorHex, phase-38-wmsUrlBuilder]
  provides: [LayersLegendPanel-component, legendPanelConfig-helpers, MapWidgetConfig-extension, layers-legend-panel-css]
  affects: [plan-41-02-wiring]
tech_stack:
  added: []
  patterns: [tdd-red-green, pure-presentational-component, mapInfoConfig-helper-mirror, global-css-append]
key_files:
  created:
    - kinetica_bi/src/lib/legendPanelConfig.ts
    - kinetica_bi/src/lib/legendPanelConfig.spec.ts
    - kinetica_bi/src/components/LayersLegendPanel.tsx
    - kinetica_bi/src/components/LayersLegendPanel.spec.tsx
  modified:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/styles/global.css
decisions:
  - "useId() generates colon-containing IDs (:rb:) invalid for CSS querySelector; fixed Test 12 to use document.getElementById instead"
  - "Component JSDoc comments must not mention useDashboardLayersStore or grep-based Test 14 will false-positive match the component source"
  - "aarrggbbToCssColor uses rgba() format (not #RRGGBB) to correctly handle the alpha channel from AARRGGBB input"
  - "Both new MapWidgetConfig fields are optional for backward-compat; getLegendPanelCorner uses LEGEND_PANEL_CORNERS.includes() not ?? for junk-string fallback"
metrics:
  duration_minutes: 6
  completed_date: "2026-05-22"
  tasks_completed: 3
  files_changed: 6
  new_tests: 29
---

# Phase 41 Plan 01: Foundation Helpers and Component Summary

**One-liner:** Pure presentational `<LayersLegendPanel />` component + `getLegendPanelEnabled`/`getLegendPanelCorner` helpers + `MapWidgetConfig` extension + 12 CSS selectors at z=1000 — fully dormant, ready for Plan 41-02 wiring.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | legendPanelConfig helpers + MapWidgetConfig extension | c8e4be8 | legendPanelConfig.ts, legendPanelConfig.spec.ts, wmsUrlBuilder.ts |
| 2 | LayersLegendPanel pure presentational component | 4d57cdf | LayersLegendPanel.tsx, LayersLegendPanel.spec.tsx |
| 3 | .layers-legend-panel* CSS in global.css | cf7ab39 | global.css |

## Test Results

- **legendPanelConfig.spec.ts**: 13 tests — all green
- **LayersLegendPanel.spec.tsx**: 16 tests — all green
- **Total new tests**: 29
- **Full frontend suite**: 1215/1215 tests pass (no regressions)
- **tsc --noEmit**: 6 pre-existing errors in MapChartRenderer.spec.tsx (fs/path/__dirname — same pattern as pre-existing); 0 new errors introduced

## Artifacts

### `kinetica_bi/src/lib/legendPanelConfig.ts`
Exports: `LEGEND_PANEL_CORNERS`, `LegendPanelCorner`, `DEFAULT_LEGEND_PANEL_ENABLED`, `DEFAULT_LEGEND_PANEL_CORNER`, `getLegendPanelEnabled`, `getLegendPanelCorner`. Mirrors mapInfoConfig.ts pattern exactly. Uses `LEGEND_PANEL_CORNERS.includes()` for corner validation (not `??`) so stored junk-strings fall back to default rather than being preserved.

### `kinetica_bi/src/lib/wmsUrlBuilder.ts` (extended)
`MapWidgetConfig` has two new optional fields: `legendPanelEnabled?: boolean` and `legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'`. Both are optional for backward-compat with legacy widget config blobs.

### `kinetica_bi/src/components/LayersLegendPanel.tsx`
Pure presentational component (PANEL-V17-01 lock: zero Zustand imports). Props: `layers: ResolvedLegendLayer[]`, `corner: LegendPanelCorner`, `collapsed: boolean`, `onToggleCollapse: () => void`. Per-mode rendering: raster/heatmap/contour show mode chip only; classbreak shows N break-rows with color swatch + label/value fallback; empty classbreak shows "No breaks configured"; empty layers shows "No layers configured on this widget." `<other>` values rendered verbatim (no titlecasing). a11y: `role="region"` + `aria-label="Map layer legend"`, button has `aria-expanded` + `aria-controls`.

### `kinetica_bi/src/styles/global.css` (extended)
12 CSS selectors appended: `.layers-legend-panel` (z=1000), 4 corner modifiers, `.layers-legend-panel-header`, `.layers-legend-panel-body`, `.layers-legend-panel-layer-block`, `.layers-legend-panel-layer`, `.layers-legend-panel-mode-chip`, `.layers-legend-panel-break-row`, `.layers-legend-panel-swatch`, `.layers-legend-panel-empty`. z=1000 is below MapDrawToolbar/MapZoomToolbar (z=1001) per V15-P-17 lock.

## Decisions Made

1. **Claude's Discretion — chip text**: `Class Break` (two words, title-case) matching the render-mode picker label in KineticaWmsLayerForm.
2. **Claude's Discretion — swatch size**: 12×12 px (`width: 12px; height: 12px`), compact and readable.
3. **Claude's Discretion — CSS location**: appended to existing `global.css` (not a new CSS module) — matches codebase convention.
4. **Claude's Discretion — component location**: `kinetica_bi/src/components/LayersLegendPanel.tsx` (top-level, not charts/ subdir — reused by Phase 42 Legend widget).
5. **Claude's Discretion — color swatch format**: `rgba(r,g,b,a)` CSS string via `aarrggbbToCssColor()` helper to correctly handle the alpha channel from 8-char AARRGGBB.
6. **Claude's Discretion — legendKey formula**: deferred to Plan 41-02 (CONTEXT.md §legendKey primitive selector).
7. **Claude's Discretion — palette colors**: NOT re-emitted by the panel; reads `cb_config.breaks[].color` directly (palette is creation-time only per cbConfig.ts comment).
8. **Runtime fix — Test 12 querySelector**: React's `useId()` generates IDs like `:rb:` with colons, which are invalid CSS selector characters. Fixed the spec test to use `document.getElementById()` instead of `container.querySelector('#' + id)`.
9. **Runtime fix — Test 14 grep lock**: Component's JSDoc comments must not contain the string `useDashboardLayersStore` — the Test 14 grep reads the component source file and would false-positive. Replaced wording in comments to avoid the banned string.

## Plan 41-02 Unblocked

Plan 41-02 (mount + MapConfigPanel wiring) now has everything it needs:
- `LayersLegendPanel` component at the locked path with the correct props contract
- `getLegendPanelEnabled` + `getLegendPanelCorner` helpers ready to consume
- `MapWidgetConfig` fields `legendPanelEnabled` + `legendPanelCorner` available
- CSS modifier classes `.layers-legend-panel--{corner}` for all 4 corners
- `ResolvedLegendLayer` type for the store-derived layer array

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `kinetica_bi/src/lib/legendPanelConfig.ts` exists | FOUND |
| `kinetica_bi/src/lib/legendPanelConfig.spec.ts` exists | FOUND |
| `kinetica_bi/src/components/LayersLegendPanel.tsx` exists | FOUND |
| `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` exists | FOUND |
| `41-01-SUMMARY.md` exists | FOUND |
| Commit c8e4be8 (Task 1) exists | FOUND |
| Commit 4d57cdf (Task 2) exists | FOUND |
| Commit cf7ab39 (Task 3) exists | FOUND |
