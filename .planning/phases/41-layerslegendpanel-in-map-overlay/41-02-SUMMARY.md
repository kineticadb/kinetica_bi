---
phase: 41-layerslegendpanel-in-map-overlay
plan: "02"
subsystem: frontend-component
tags: [legend-panel, mapconfigpanel, mapchartrenderer, zustand-selector, tdd]
dependency_graph:
  requires: [plan-41-01-LayersLegendPanel, plan-41-01-legendPanelConfig, plan-41-01-MapWidgetConfig-extension]
  provides: [MapConfigPanel-LAYERS-PANEL-section, MapChartRenderer-legendKey-selector, MapChartRenderer-LayersLegendPanel-mount]
  affects: [phase-42-legend-chart-type]
tech_stack:
  added: []
  patterns: [tdd-red-green, primitive-selector-PITFALL-S02, useMemo-keyed-on-primitive, session-only-useState]
key_files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
decisions:
  - "Test 6 (toolbar ordering) uses role+aria-label selector instead of class selector — MapDrawToolbar mock renders without the .map-draw-toolbar class"
  - "includedLayerIdsForLegend reads from widgetConfig (Record<string,unknown>) not MapWidgetConfig cast — includedLayerIds is not a MapWidgetConfig field"
  - "getState() added to dashboardLayersStore mock in spec so resolvedLegendLayers useMemo can call getState().layers imperatively inside the memo"
  - "Test 12 (primitive selector grep audit) uses dynamic import('fs')/__dirname pattern matching Phase 39/40 tests — known tsc error, vitest handles correctly"
  - "Added 9b as an additional test (classbreak renderMode with cb_config populates break rows) to validate the visual classbreak path separately from the reactive re-render test"
metrics:
  duration_minutes: 8
  completed_date: "2026-05-22"
  tasks_completed: 2
  files_changed: 4
  new_tests: 25
---

# Phase 41 Plan 02: MapConfigPanel Toggle and Renderer Mount Summary

**One-liner:** MapConfigPanel gains LAYERS PANEL section (toggle + conditional corner picker) and MapChartRenderer mounts `<LayersLegendPanel />` as a React child of `.widget-map` after `<MapDrawToolbar>`, driven by a `legendKey` primitive selector and local `legendCollapsed` useState — wiring the dormant Plan 41-01 component into production.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | MapConfigPanel — LAYERS PANEL section (toggle + conditional corner picker) | 7e0e314 | MapConfigPanel.tsx, MapConfigPanel.spec.tsx |
| 2 | MapChartRenderer — legendKey selector + resolvedLegendLayers + legendCollapsed state + LayersLegendPanel JSX mount | bf29005 | MapChartRenderer.tsx, MapChartRenderer.spec.tsx |

## Test Results

- **MapConfigPanel.spec.tsx**: 58 total — 11 new LAYERS PANEL tests + 47 pre-existing (all green)
- **MapChartRenderer.spec.tsx**: 166 total — 14 new Phase 41 tests + 152 pre-existing (all green)
- **Total new tests this plan**: 25 (11 + 14)
- **Combined Phase 41 total**: 29 (Plan 41-01) + 25 (Plan 41-02) = 54 new green tests
- **Full frontend suite**: 1239/1239 tests pass (no regressions)
- **tsc --noEmit**: 9 pre-existing spec-file errors (fs/path/__dirname — same as pre-Plan-41-02 baseline + 3 new from Test 12 grep audit using same pattern); 0 new production code errors

## Artifacts

### `kinetica_bi/src/components/charts/MapConfigPanel.tsx` (extended)
Imports `getLegendPanelEnabled`, `getLegendPanelCorner`, `LEGEND_PANEL_CORNERS` from `legendPanelConfig.ts`. New LAYERS PANEL `<div className="config-group">` inserted after INFO POPUP section, before SHAPE DISPLAY: toggle checkbox (`aria-label="Show Layers Panel"`) + conditional `<select id="map-legend-panel-corner">` with 4 options. Uses `widgetCfg as MapWidgetConfig` cast (same as existing `infoEnabled` read pattern). Full `role="group"` + `aria-labelledby="map-legend-panel-label"` a11y.

### `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (extended)
- Two imports added: `LayersLegendPanel` (value) + `ResolvedLegendLayer` (type) from `../LayersLegendPanel`; `getLegendPanelEnabled` + `getLegendPanelCorner` from `../../lib/legendPanelConfig`
- `legendKey` primitive selector (after `shapesKey`): joins `${l.id}:${renderMode}:${cb_config ?? "null"}` per layer — mirrors viewsKey/dynamicViewsKey pattern; PITFALL S-02 lock
- `includedLayerIdsForLegend` reads from `widgetConfig` (Record<string,unknown>) — not `MapWidgetConfig` which doesn't have the field
- `resolvedLegendLayers` useMemo with deps `[legendKey, includedLayerIdsForLegend]`; calls `useDashboardLayersStore.getState().layers` imperatively inside memo so legendKey is the reactive trigger
- `legendCollapsed` useState (initial false); session-only, NOT persisted
- `<LayersLegendPanel>` JSX mount after `<MapDrawToolbar>`, before reconfigure/empty/threshold overlays; gated by `getLegendPanelEnabled(widgetConfig as MapWidgetConfig)`
- `lastEmittedParamsRef` fingerprint UNCHANGED (Phase 41 doesn't touch WMS emission)
- Popup container at JSX position 0 UNCHANGED (Phase 35 invariant preserved)
- No new `addOverlay()` calls (still 3 pre-existing OL overlay effects)

## All 5 ROADMAP Success Criteria for Phase 41 Satisfied

- **SC1** (pure presentational + legendKey selector): Plan 41-01 ships pure component (zero Zustand). Plan 41-02 adds `legendKey` primitive selector at MapChartRenderer site. ✓
- **SC2** (toggle shows/hides + persists via PATCH): Plan 41-02 wires toggle via `onChange({ ...config, legendPanelEnabled })` → existing debounced PATCH flow. ✓
- **SC3** (React-tree mount + 4 corners + doesn't block draw clicks): Mounts as React child of `.widget-map` after `<MapDrawToolbar>`; 4 corner modifier classes from Plan 41-01 CSS; z=1000 below toolbars z=1001. ✓
- **SC4** (header click collapses; session-only): Local `useState<boolean>(false)` + Plan 41-01 component header click → `onToggleCollapse` callback. ✓
- **SC5** (live cb_config edit reflects in panel): legendKey includes `cb_config` JSON → store updateLayer changes the key → useMemo recomputes `resolvedLegendLayers` → component re-renders. Tests 9/9b validate. ✓

## All 7 PANEL-V17-* Requirements Satisfied

| ID | Description | Satisfied by |
|----|-------------|--------------|
| PANEL-V17-01 | Pure presentational component (zero store) | Plan 41-01 LayersLegendPanel |
| PANEL-V17-02 | legendKey primitive selector in MapChartRenderer | Plan 41-02 Task 2 |
| PANEL-V17-03 | resolvedLegendLayers useMemo + includedLayerIds semantic | Plan 41-02 Task 2 |
| PANEL-V17-04 | getLegendPanelEnabled/Corner helpers + MapWidgetConfig extension | Plan 41-01 Task 1 |
| PANEL-V17-05 | MapConfigPanel LAYERS PANEL section (toggle + corner picker) | Plan 41-02 Task 1 |
| PANEL-V17-06 | Session-only collapse state (legendCollapsed useState) | Plan 41-02 Task 2 |
| PANEL-V17-07 | Live cb_config edit reflects in panel via legendKey | Plan 41-02 Task 2 |

## Phase 42 Unblocked

Phase 42 (standalone Legend chart type) now has everything it needs:
- `<LayersLegendPanel />` at the locked path with the correct props contract
- `ResolvedLegendLayer` type for Phase 42's own builder
- CSS modifier classes `.layers-legend-panel--{corner}` for all 4 corners
- Phase 42 can build its own `resolvedLegendLayers` builder against a different layer source

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 6 toolbar selector used wrong CSS class**
- **Found during:** Task 2 RED phase
- **Issue:** Test 6 searched for `.map-draw-toolbar` class; MapDrawToolbar mock renders `<div role="toolbar" aria-label="Drawing tools">` without that class
- **Fix:** Changed `c.classList.contains("map-draw-toolbar")` to `c.getAttribute("role") === "toolbar" && c.getAttribute("aria-label") === "Drawing tools"`
- **Files modified:** MapChartRenderer.spec.tsx
- **Commit:** bf29005

**2. [Rule 1 - Bug] TypeScript error: includedLayerIds not on MapWidgetConfig**
- **Found during:** Task 2 tsc verification
- **Issue:** `(widgetConfig as MapWidgetConfig).includedLayerIds` — field doesn't exist on MapWidgetConfig; it's a raw widget config field read from Record<string,unknown>
- **Fix:** Changed to `widgetConfig.includedLayerIds as number[] | undefined`
- **Files modified:** MapChartRenderer.tsx
- **Commit:** bf29005

**3. [Rule 2 - Missing Critical] getState() missing from dashboardLayersStore mock**
- **Found during:** Task 2 implementation (resolvedLegendLayers calls getState().layers)
- **Issue:** Mock only provided hook function, not `.getState()` method required by resolvedLegendLayers useMemo
- **Fix:** Added `(hook as any).getState = () => ({ layers: _layersState.layers })` to the mock
- **Files modified:** MapChartRenderer.spec.tsx
- **Commit:** bf29005

## No Regressions

- Popup container at `.widget-map > *:first-child` remains `info-popup-overlay-element` (Phase 35 position-0 invariant preserved)
- `lastEmittedParamsRef` fingerprint string in MapChartRenderer.tsx unchanged (Phase 41 doesn't touch WMS emission)
- No new `addOverlay()` calls (8 pre-existing occurrences, 1 in new comment only)
- `useDashboardLayersStore` import count in `LayersLegendPanel.tsx` = 0 (Plan 41-01 lock preserved)

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| MapConfigPanel.tsx has `LAYERS PANEL` | FOUND |
| MapConfigPanel.tsx has `id="map-legend-panel-label"` | FOUND |
| MapConfigPanel.tsx has `id="map-legend-panel-corner"` | FOUND |
| MapChartRenderer.tsx has `legendKey = useDashboardLayersStore` | FOUND |
| MapChartRenderer.tsx has `LayersLegendPanel` (>= 3) | FOUND (3) |
| MapChartRenderer.tsx has `resolvedLegendLayers` | FOUND |
| MapChartRenderer.tsx has `legendCollapsed` | FOUND |
| LayersLegendPanel.tsx useDashboardLayersStore count = 0 | FOUND (0) |
| Commit 7e0e314 (Task 1) exists | FOUND |
| Commit bf29005 (Task 2) exists | FOUND |
| 41-02-SUMMARY.md exists | FOUND |
| Full frontend suite: 1239/1239 | PASSED |
