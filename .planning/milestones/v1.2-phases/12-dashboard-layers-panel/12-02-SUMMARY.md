---
phase: 12-dashboard-layers-panel
plan: "02"
subsystem: map-chart
tags:
  - component-extraction
  - dead-code-deletion
  - tdd
dependency_graph:
  requires:
    - Phase 11 MapConfigPanel.tsx (source for the lift)
    - Phase 11 cardinalityProbe.ts (probeCardinality)
    - Phase 11 columnTypes.ts (getValidSpatialColumns, autoSuggestSpatialMode)
    - Phase 11 wmsCapabilities.ts (useWmsCapabilitiesStore)
  provides:
    - KineticaWmsLayerForm.tsx (reusable layer-config form, no table picker)
    - bboxHelper.ts deleted (zero dead-code references remain)
    - MapChartRenderer.tsx cleaned (no fetchBbox, no autoFitDoneRef, no zoom-to-data button)
  affects:
    - Plan 12-04 (LayersModal will embed KineticaWmsLayerForm in right pane)
    - Plan 12-05 (MapConfigPanel shrink — KineticaWmsLayerForm is now standalone)
tech_stack:
  added: []
  patterns:
    - TDD (RED commit → GREEN commit)
    - Purely controlled component (no auto-suggest, no stale-column-clear — caller's responsibility)
    - ClassbreakParamsGroup co-located sub-component
key_files:
  created:
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  deleted:
    - kinetica_bi/src/lib/bboxHelper.ts
    - kinetica_bi/src/lib/bboxHelper.spec.ts
decisions:
  - "KineticaWmsLayerForm is purely controlled — no auto-suggest, no stale-column-clear on columns prop change. The caller (LayersModal) is responsible for autoSuggestSpatialMode and resetting stale columns before calling onPatch."
  - "onSelectSpatialMode clears ALL four column fields (latColumn, lonColumn, wktColumn, wkbColumn) when mode changes, matching the intent of keeping only relevant columns in config."
  - "useCallback re-added to MapChartRenderer imports after removal — still needed for onRetryTiles callback."
  - "WidgetRenderer.spec.tsx bboxHelper vi.mock removed (file deleted); replaced with comment."
metrics:
  duration: "~7 minutes (390 seconds)"
  completed: "2026-05-06"
  tasks: 2
  files: 7
requirements_satisfied:
  - LAYER-03-form-extraction
  - LAYER-04-bbox-deletion
---

# Phase 12 Plan 02: KineticaWmsLayerForm Extract + bboxHelper Delete Summary

Extract spatial-mode/render-mode/classbreak form sections from MapConfigPanel into standalone `KineticaWmsLayerForm` component; delete dead-code `bboxHelper.ts` and remove zoom-to-data button from `MapChartRenderer`.

## What Was Built

### Task 1: KineticaWmsLayerForm extraction (TDD)

**Lifted sections from MapConfigPanel.tsx:**
- Module-level constants: `SPATIAL_MODE_LABELS`, `RENDER_MODE_LABELS`, `ALL_SPATIAL_MODES`, `ALL_RENDER_MODES`, `COLORMAP_CATALOG`, `CardinalityState` type
- `ClassbreakParamsGroup` sub-component (full implementation with `runProbe`, `warnFiredRef`, `abortRef`, isValid useEffect, cardinality state machine)
- Spatial mode picker (radio group with per-mode column dropdowns — latlon/wkt/wkb)
- Render mode picker (radio group gated against `useWmsCapabilitiesStore` capabilities)
- Raster params group (pointColor, pointSize, pointOpacity)
- Heatmap params group (colormap, blurRadius, minLevel, maxLevel) — PITFALL M-05 "Kinetica map units" label
- Classbreak params group (delegated to ClassbreakParamsGroup)
- Contour params group (contourColor, contourSmooth, contourBandwidth) — PITFALL M-05 "Kinetica map units" label

**NOT copied (intentionally excluded):**
- `BASEMAP_LABELS` / `ALL_BASEMAPS` (basemap is widget-scoped, not layer-scoped)
- Title field
- Table picker (table dropdown lives in LayersModal, Plan 04)
- stale-column-clear useEffect (caller's responsibility — purely controlled)
- Auto-suggest-on-mount useEffect (caller's responsibility — purely controlled)

**Label strings preserved verbatim:**
- "Latitude / Longitude pair", "WKT geometry column", "Kinetica geometry column"
- "Raster (point markers)", "Heatmap (density)", "Classbreak (categorical)", "Contour (lines)"

**CSS class usage:**
Zero new CSS classes. Uses exclusively existing classes: `.config-panel`, `.config-group`, `.config-group-label`, `.config-hint`, `.config-toggle`, `.config-color-field`, `.config-color-row`, `.config-color-picker`, `.config-color-text`, `.config-range`, `.config-range-value`, `.config-classbreak-rows`, `.config-classbreak-row`, `.config-classbreak-row-label`, `.config-classbreak-add`, `.config-cardinality-warn`, `.ds-select`, `.ds-field-label`

**Table-picker placement note:**
`KineticaWmsLayerForm` has NO table picker. The table dropdown lives in `LayersModal` (Plan 04) above this form. When the user changes the table, `LayersModal` calls `autoSuggestSpatialMode` + clears stale columns BEFORE `onPatch` — the form just sees a new `{config, columns}` pair.

**TDD commits:**
- RED: `b60fd4c` — failing spec (7 tests, component file missing)
- GREEN: `cfa6fce` — component created, all 7 tests pass

### Task 2: bboxHelper deletion + MapChartRenderer cleanup

**Files deleted:**
- `kinetica_bi/src/lib/bboxHelper.ts` — zoom-to-data SQL helper (dead code per CONTEXT.md Phase 12 hard cutover)
- `kinetica_bi/src/lib/bboxHelper.spec.ts` — spec for the deleted helper

**Removed from MapChartRenderer.tsx:**
- `import { fetchBbox } from "../../lib/bboxHelper"` (line ~43)
- `autoFitDoneRef` ref declaration
- Effect 5 (auto-fit once on first complete-config mount) — entire useEffect block using `fetchBbox`
- `onZoomToData` useCallback handler
- Zoom-to-data button JSX (`.widget-map-toolbar` div with "Zoom to data" button)

**Preserved in MapChartRenderer.tsx:**
- All PITFALL M-01..M-12 lock comments (12 PITFALL M-0x matches confirmed)
- OL Map lifecycle (mount/dispose, mapRef guard)
- Basemap swap logic (Effect 4)
- ImageWMS source construction and XHR imageLoadFunction (Fix E)
- ResizeObserver updateSize logic (Fix D)
- Filter subscription (Effects 3 + 4b)
- Error overlay and retry logic

**Removed from specs:**
- `MapChartRenderer.spec.tsx`: 2 test blocks ("auto-fit fires once", "zoom-to-data button click"), vi.mock for bboxHelper, waitFor import
- `WidgetRenderer.spec.tsx`: vi.mock for bboxHelper (replaced with comment)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useCallback removed from MapChartRenderer imports then re-added**
- Found during: Task 2 test run
- Issue: When removing `onZoomToData` useCallback, I also stripped `useCallback` from the React import. However `onRetryTiles` still uses `useCallback`, causing "useCallback is not defined" runtime error.
- Fix: Re-added `useCallback` to the React imports in MapChartRenderer.tsx
- Files modified: `kinetica_bi/src/components/charts/MapChartRenderer.tsx`
- Commit: included in `4929ad1`

**2. [Rule 3 - Blocking] WidgetRenderer.spec.tsx had vi.mock for deleted bboxHelper**
- Found during: Task 2 — grep check for remaining bboxHelper references
- Issue: `WidgetRenderer.spec.tsx` line 68 had `vi.mock("../../lib/bboxHelper", ...)` which would fail with a missing module error after deletion
- Fix: Removed the vi.mock call (replaced with comment explaining the removal)
- Files modified: `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
- Commit: included in `4929ad1`

## Self-Check: PASSED

All files verified:
- FOUND: `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`
- FOUND: `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx`
- CONFIRMED DELETED: `kinetica_bi/src/lib/bboxHelper.ts`
- CONFIRMED DELETED: `kinetica_bi/src/lib/bboxHelper.spec.ts`

All commits verified:
- `b60fd4c` — TDD RED (failing spec)
- `cfa6fce` — TDD GREEN (implementation, 7 tests)
- `4929ad1` — Task 2 (bboxHelper delete, MapChartRenderer cleanup, 256 tests)
