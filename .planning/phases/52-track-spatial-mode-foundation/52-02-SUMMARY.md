---
phase: 52-track-spatial-mode-foundation
plan: "02"
subsystem: track-form-ux
tags: [track, spatialMode, KineticaWmsLayerForm, LayersModal, MapConfigPanel, TrackSubSection-removal, column-pickers, isValid]
dependency_graph:
  requires: [track-spatial-mode-contract, track-column-helpers, track-autoSuggest]
  provides: [track-form-entry-point, track-mode-picker, track-defaults-seeding, track-latlon-spatial-targets]
  affects: [KineticaWmsLayerForm, LayersModal, MapConfigPanel, MapChartRenderer]
tech_stack:
  added: []
  patterns: [capabilities-exemption, isValid-gating, track-config-merge, latlon-wire-translation]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - packages/web/src/components/LayersModal.tsx
    - packages/web/src/components/charts/MapConfigPanel.tsx
    - packages/web/src/components/LayersModal.cbconfig-seam.spec.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
  deleted:
    - packages/web/src/components/charts/TrackSubSection.tsx
    - packages/web/src/components/charts/TrackSubSection.spec.tsx
decisions:
  - "Track mode picker exempt from WMS capabilities gate (mirror classbreak exemption at line 609)"
  - "isValid(false) until all four track pickers set; isValid(true) on switch away from track"
  - "track_config NOT cleared in onSelectSpatialMode — preserved for re-selection (Phase 53 needs it)"
  - "LayersModal seeds xCol/yCol/trackIdAttr/trackOrderAttr into track_config when suggestedMode=track"
  - "MapConfigPanel both autoSuggest sites prefill lonCol/latCol from isTrackTable match (CHECKER ADVISORY FIX)"
  - "TrackSubSection deleted; no compat shim — cutover overlay handles old-model layers (Phase 53)"
metrics:
  duration: "7 minutes"
  completed_date: "2026-06-07"
  tasks: 3
  files: 8
---

# Phase 52 Plan 02: Track Form UX and v1.7 Model Removal Summary

Track mode picker + four typed column pickers in KineticaWmsLayerForm, default seeding in LayersModal, track→latlon SpatialTarget translation at both MapConfigPanel autoSuggest sites, and atomic deletion of TrackSubSection + its spec + the TRACK-V17-03 describe block.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Add Track to mode picker + four typed pickers + isValid signaling | a702d48 |
| 2 | Seed track defaults in LayersModal + translate track→latlon SpatialTargets in MapConfigPanel | 317ad5d |
| 3 | Delete TrackSubSection + host gate + breaking specs; add track-picker specs | d1b85c2 |
| - | Remove stale TrackSubSection comment references (grep-lock cleanup) | d95799c |

## What Was Built

**KineticaWmsLayerForm.tsx:**
- `ALL_SPATIAL_MODES` widened to `["latlon", "wkt", "wkb", "track"]`
- Spatial mode picker filter: `m === "track" || allowedSpatialModes.includes(m)` — track exempt from WMS capabilities gate
- Four track column pickers rendered behind `spatialMode === "track"` gate:
  - X column (longitude): numeric columns via `getValidSpatialColumns(columns, "latlon")`
  - Y column (latitude): same numeric list
  - Track ID column: non-geometry columns via `getTrackIdColumns`
  - Ordering column: datetime + numeric via `getTrackOrderColumns`
- `onPickTrackCol` helper merges into track_config with `enabled: true`
- isValid useEffect for track mode: `isValid(false)` until all four fields set
- `onSelectSpatialMode` calls `isValid(true)` when switching away from track
- TrackSubSection import and mount gate removed entirely
- Imports: `getTrackIdColumns`, `getTrackOrderColumns` from columnTypes; `coalesceTrackConfig` from trackConfig

**LayersModal.tsx:**
- `handleTableChange`: when `suggestedMode === "track"`, calls `isTrackTable(newColumns)` and patches `track_config` with `xCol/yCol/trackIdAttr/trackOrderAttr` + `enabled: true` merged onto existing config
- Imports: `isTrackTable` from trackDetect, `coalesceTrackConfig` from trackConfig

**MapConfigPanel.tsx:**
- New-row autoSuggest site (line 469): when rawMode === "track", prefills `lonCol: match.xCol` and `latCol: match.yCol` on the SpatialTarget — complete latlon target (CHECKER ADVISORY FIX)
- Existing-row changeTable site (line 533): same prefill applied — both sites now consistent
- Import: `isTrackTable` from trackDetect

**Deleted:**
- `TrackSubSection.tsx` — v1.7 Phase 40 "Treat as track table" checkbox component
- `TrackSubSection.spec.tsx` — all associated tests

**KineticaWmsLayerForm.spec.tsx:**
- Removed entire `describe("Phase 40 TRACK-V17-03 mount-gate + state preservation", ...)` block (7 tests)
- Added `describe("Phase 52 TRACKMODE-V19-01/02 — track mode picker and column pickers", ...)` with 4 specs:
  - Track radio visible even when WMS capabilities omits it
  - Selecting Track reveals four column pickers
  - Track ID pre-selects TRACKID, ordering pre-selects TIMESTAMP from track_config
  - isValid(false) when picker empty, isValid(true) when all four set

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] TrackSubSection comment stubs broke grep-lock**
- **Found during:** Post-Task-3 verification (deletion grep-lock check)
- **Issue:** Stale doc-comment references to "TrackSubSection" in LayersModal.tsx, LayersModal.cbconfig-seam.spec.tsx, and MapChartRenderer.spec.tsx caused `! grep -rn "TrackSubSection" packages/web/src/` to fail
- **Fix:** Replaced comment text with equivalent descriptions not mentioning the deleted component
- **Files modified:** LayersModal.tsx, LayersModal.cbconfig-seam.spec.tsx, MapChartRenderer.spec.tsx
- **Commit:** d95799c

## Verification

- `npx tsc --noEmit`: CLEAN
- `npx vitest run`: 1593 passed (0 failures) — full suite green
- Deletion grep-locks: PASS — no TrackSubSection import/reference/comment anywhere in src/
- Wire-contract locks: spatialTargets.ts SpatialMode stays 3-mode; zero server diffs
- Track in picker: ALL_SPATIAL_MODES includes "track"; capabilities exemption in place
- `! grep -n "Treat as track table" KineticaWmsLayerForm.spec.tsx`: PASS

## Self-Check: PASSED

All key files verified:
- KineticaWmsLayerForm.tsx: contains `spatialMode === "track"`, four pickers, capabilities exemption
- LayersModal.tsx: contains `isTrackTable`, `trackIdAttr` seeding
- MapConfigPanel.tsx: contains `latlon` coercion at both sites with lonCol/latCol prefill
- TrackSubSection.tsx: DELETED (file absent)
- TrackSubSection.spec.tsx: DELETED (file absent)

Commits verified: a702d48, 317ad5d, d1b85c2, d95799c all in git log.
