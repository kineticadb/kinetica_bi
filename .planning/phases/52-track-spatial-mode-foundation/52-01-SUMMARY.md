---
phase: 52-track-spatial-mode-foundation
plan: "01"
subsystem: spatial-layer-types
tags: [track, spatialMode, columnTypes, wmsUrlBuilder, spatialColumns, isConfigComplete, infoQuery]
dependency_graph:
  requires: []
  provides: [track-spatial-mode-contract, track-column-helpers, track-autoSuggest, track-wms-spatial-branch, track-info-query-translation]
  affects: [MapChartRenderer, InfoSelectionView, KineticaWmsLayerForm, MapConfigPanel]
tech_stack:
  added: []
  patterns: [tdd-red-green, track→latlon wire translation, SpatialMode union widening]
key_files:
  created:
    - packages/web/src/lib/spatialColumns.spec.ts
  modified:
    - packages/web/src/lib/columnTypes.ts
    - packages/web/src/lib/columnTypes.spec.ts
    - packages/web/src/lib/trackConfig.ts
    - packages/web/src/lib/spatialColumns.ts
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/InfoSelectionView.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/MapConfigPanel.tsx
decisions:
  - "SpatialMode widened in columnTypes.ts only (layer-facing); spatialTargets.ts + client.ts InfoSpatialMode stay 3-mode (wire contracts)"
  - "autoSuggestSpatialMode detects track shape after geometry/wkt steps, before latlon name heuristic (x/y columns would otherwise match latlon)"
  - "MapConfigPanel coerces autoSuggestSpatialMode 'track' result to 'latlon' for SpatialTarget (track is not a valid spatial-filter target)"
  - "track→latlon translation at wire boundary via infoMode variable in both MapChartRenderer and InfoSelectionView; buildSpatialColumns handles the column translation"
  - "KineticaWmsLayerForm SPATIAL_MODE_LABELS Record<SpatialMode, string> extended with 'track' entry for TypeScript completeness"
metrics:
  duration: "7 minutes"
  completed_date: "2026-06-07"
  tasks: 3
  files: 10
---

# Phase 52 Plan 01: Track Spatial Mode Foundation Summary

Laid the type + library contract layer for Track as a layer-side spatial mode. Widened the layer-facing `SpatialMode` union to include `"track"`, extended the track column model with xCol/yCol, added track-aware auto-suggest, and wired four boundary translation sites so track layers speak latlon natively across all wire contracts.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Widen SpatialMode, add getTrackIdColumns/getTrackOrderColumns, extend autoSuggestSpatialMode | d95215d |
| 2 | Extend TrackConfig xCol/yCol, track branches in spatialColumns + wmsUrlBuilder | 9b0543e |
| 3 | isConfigComplete track branch + track→latlon cast translations in renderer/info view | ec1aa97 |

## What Was Built

**columnTypes.ts:**
- `SpatialMode` widened to `"latlon" | "wkt" | "wkb" | "track"` (layer-facing only; wire contracts unchanged)
- `getTrackIdColumns(columns)`: returns all non-geometry columns (string + numeric IDs both valid track ID candidates)
- `getTrackOrderColumns(columns)`: returns datetime + numeric columns (valid ordering keys)
- `autoSuggestSpatialMode`: inserts `isTrackTable` check after geometry/wkt detection, before latlon name heuristic — a track table's x/y columns would otherwise match latlon

**trackConfig.ts:**
- `TrackConfig` extended with `xCol?: string` and `yCol?: string` (Phase 52 coordinate columns; additive; existing `enabled`/style fields unchanged)

**spatialColumns.ts:**
- Track branch translates `track_config.xCol/yCol` to `{ lonCol, latCol }` at the info-popup boundary via `coalesceTrackConfig`

**wmsUrlBuilder.ts:**
- Explicit `config.spatialMode === "track"` case in the spatial-attribute branch emits `X_ATTR/Y_ATTR` from `layerJsonFields.track_config.xCol/yCol`; prevents the wkb fallthrough that would emit an empty `GEO_ATTR`
- Track WMS emission block (lines 425-458) untouched

**MapChartRenderer.tsx:**
- `isConfigComplete` track branch: all four fields (xCol, yCol, trackIdAttr, trackOrderAttr) must be set
- `infoQuery` call: `infoMode` variable translates `"track"` → `"latlon"` before the wire

**InfoSelectionView.tsx:**
- Both `infoQuery` call sites translated via `infoMode1` / `infoMode2` variables

**KineticaWmsLayerForm.tsx:**
- `SPATIAL_MODE_LABELS` record extended with `track: "Track (x/y point sequence)"` to satisfy `Record<SpatialMode, string>` completeness

**MapConfigPanel.tsx:**
- `autoSuggestSpatialMode` result coerced from "track" to "latlon" at both `SpatialTarget` construction sites (track is not a valid spatial-filter target)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] KineticaWmsLayerForm SPATIAL_MODE_LABELS Record completeness**
- **Found during:** Task 3 (tsc check after Task 3 changes)
- **Issue:** `Record<SpatialMode, string>` in KineticaWmsLayerForm.tsx required all 4 members after SpatialMode widening; missing "track" caused TypeScript error TS2741
- **Fix:** Added `track: "Track (x/y point sequence)"` to SPATIAL_MODE_LABELS
- **Files modified:** packages/web/src/components/charts/KineticaWmsLayerForm.tsx
- **Commit:** ec1aa97

**2. [Rule 2 - Missing Critical Functionality] MapConfigPanel SpatialTarget type mismatch**
- **Found during:** Task 3 (tsc check)
- **Issue:** `autoSuggestSpatialMode` result (now `"latlon" | "wkt" | "wkb" | "track"`) was assigned directly to `SpatialTarget.spatialMode` (type `"latlon" | "wkt" | "wkb"` from spatialTargets.ts). TypeScript error TS2322.
- **Fix:** Coerce "track" → "latlon" at both SpatialTarget construction sites (track is not a valid spatial-filter target per architecture decision)
- **Files modified:** packages/web/src/components/charts/MapConfigPanel.tsx
- **Commit:** ec1aa97

## Verification

- `npx tsc --noEmit`: CLEAN
- `npx vitest run columnTypes spatialColumns wmsUrlBuilder MapChartRenderer`: 328 passed
- Full suite: 1625 passed (0 failures)
- Wire-contract locks: all held (spatialTargets.ts 3-mode, InfoSpatialMode 3-mode, no server diffs, no server track references)
- wmsUrlBuilder.spec.ts lines 781-843 (regression lock tests): green

## Self-Check: PASSED

All key files found. All commit hashes verified (d95215d, 9b0543e, ec1aa97).
