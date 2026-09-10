---
phase: 54
plan: "09"
subsystem: map-spatial-filter
tags: [trackfix, spatial-targets, gap-closure, tdd]
dependency_graph:
  requires: [spatialTargets.ts, MapConfigPanel.tsx, trackDetect.ts]
  provides: [TRACKFIX-V19-08]
  affects: [draw-to-filter, aggregateSpatialTargetsByTable, isSpatialTargetEligible]
tech_stack:
  added: []
  patterns: [track-to-latlon coercion, displayMode guard, controlled-component TDD]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/MapConfigPanel.tsx
    - packages/web/src/components/charts/MapConfigPanel.spec.tsx
decisions:
  - "displayMode coercion: compute displayMode=latlon when stored spatialMode==track rather than fixing stored value, keeping isSpatialTargetEligible + SpatialTarget type byte-unchanged"
  - "changeMode repopulation: when switching to latlon for a track-shaped table, populate lonCol/latCol from isTrackTable rather than leaving undefined"
  - "rerender in TRK-6 test: controlled-component pattern requires parent to apply intermediate config update between mode steps"
metrics:
  duration_minutes: 15
  completed: "2026-06-08T13:43:08Z"
  tasks_completed: 2
  files_modified: 2
  commits: 2
---

# Phase 54 Plan 09: TRACKFIX-V19-08 — Track Spatial Filter Target Translation

**One-liner:** Coerce legacy spatialMode:"track" targets to latlon+X/Y display and repopulate columns on mode toggle, enabling draw-to-filter on track-shaped tables.

## What Was Built

A spatial-filter target configured for a track-shaped table (columns: TRACKID/X/Y/TIMESTAMP) was broken end-to-end: `autoSuggestSpatialMode` returns `"track"` for those tables, but `SpatialTarget.spatialMode` is the 3-mode wire union `"latlon" | "wkt" | "wkb"`. Any stored `spatialMode:"track"` target fails `isSpatialTargetEligible` → `aggregateSpatialTargetsByTable` drops it → draw-to-filter no-ops.

Phase 52 partially fixed the **new-row** and **changeTable** paths (translating `"track"` → `"latlon"` + pre-filling `lonCol`/`latCol` from `isTrackTable`). This gap-closure fixes the remaining two paths missed by Phase 52.

### Fix 1 — displayMode coercion (TRK-5)

Any legacy stored `spatialMode:"track"` row is coerced to `displayMode: "latlon"` at render time. `displayMode` is used for:
- Radio button `checked` prop (ensures latlon radio shows as selected, not "nothing checked")
- Line 3 section guards (`displayMode === "latlon"` / `"wkt"` / `"wkb"`)
- `validColumns` computation (track would fall through to wkb path)
- `showIncomplete` indicator and `rowKey`

`SpatialTarget` type and `isSpatialTargetEligible` are byte-unchanged.

### Fix 2 — changeMode repopulation (TRK-6)

`changeMode` previously wiped all columns unconditionally when the mode changed. Now: when switching TO latlon on a track-shaped table, `isTrackTable(rowColumns)` is called and `lonCol`/`latCol` are repopulated with `xCol`/`yCol`. Non-track tables still get `undefined` columns (unchanged behavior).

## Commits

| Hash | Message |
|------|---------|
| b8fea4b | test(54-09): add failing tests for track spatial-target translation gaps |
| f589dd9 | fix(54-09): translate track spatial target to latlon+X/Y at all paths |

## Tests Added (TRK-1 through TRK-7)

| Test | Description | Result |
|------|-------------|--------|
| TRK-1 | new-row path: track-shaped first table → stores latlon+X+Y | GREEN (Phase 52 had this) |
| TRK-2 | changeTable to track table → stores latlon+X+Y | GREEN (Phase 52 had this) |
| TRK-3 | translated target is isSpatialTargetEligible=true | GREEN (Phase 52 had this) |
| TRK-4 | radio group shows only 3 options (no "track") | GREEN (Phase 52 had this) |
| TRK-5 | legacy spatialMode:"track" row shows latlon radio checked | RED → GREEN (this fix) |
| TRK-6 | changeMode latlon→wkt→latlon repopulates lonCol/latCol | RED → GREEN (this fix) |
| TRK-7 | non-track changeTable regression guard | GREEN (Phase 52 had this) |

## Verification

- All 1656 tests pass (baseline 1645 + 11 new)
- `tsc --noEmit` clean
- `isSpatialTargetEligible` and `SpatialTarget` type are byte-unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Operator Action Required

Re-add (or re-open) the `demo.track` spatial-filter target in MapConfigPanel, then draw a shape on the map. The target should now store `{spatialMode:"latlon", lonCol:"X", latCol:"Y"}`, pass `isSpatialTargetEligible`, and materialize the filter so draw-to-filter filters the track layer.

## Self-Check: PASSED

- `packages/web/src/components/charts/MapConfigPanel.tsx` — modified (displayMode coercion + changeMode repopulation)
- `packages/web/src/components/charts/MapConfigPanel.spec.tsx` — modified (7 new TRK tests)
- Commits b8fea4b and f589dd9 present in git log
