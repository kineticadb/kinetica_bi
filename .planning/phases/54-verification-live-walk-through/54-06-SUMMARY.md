---
phase: 54-verification-live-walk-through
plan: "06"
subsystem: wms-track-emission
tags: [track, wms, emission, form-controls, gap-closure]
dependency_graph:
  requires: [54-05]
  provides: [TRACKFIX-V19-04, TRACKFIX-V19-05]
  affects: [wmsUrlBuilder.ts, trackConfig.ts, KineticaWmsLayerForm.tsx]
tech_stack:
  added: []
  patterns: [tdd-red-green, color-input-alpha-idiom, aarrggbb-normalization]
key_files:
  created: []
  modified:
    - packages/web/src/lib/trackConfig.ts
    - packages/web/src/lib/trackConfig.spec.ts
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
decisions:
  - "headShape → TRACKHEADSHAPES (fixes OQ-9 misnaming; was TRACKMARKERSHAPES); markerShape → TRACKMARKERSHAPES as distinct param"
  - "7 point/shape keys deleted inside enabled-track block using delete operator after DOTRACKS set — robust to both raster and classbreak lanes"
  - "TRACK_DEFAULTS updated to Kinetica WMS doc defaults (FFFFFFFF white / FF00FF00 green / FF0000FF blue marker) per operator confirmation 2026-06-07"
  - "normalizeAARRGGBB fallback values in track block updated to match new defaults for belt-and-suspenders correctness"
  - "RENDER-V19-04 byte-lock spec updated to use TRACKHEADSHAPES (misnaming fix is the explicit scope of this plan)"
metrics:
  duration: 5min
  completed: "2026-06-07"
  tasks: 2
  files: 6
  test_delta: "+13 tests (1625 → 1638)"
---

# Phase 54 Plan 06: TrackConfig + Emission + Marker Controls (Gap Closure) Summary

GAP-54-05 (suppression) and GAP-54-06 (full TRACK_* surface) closed: track WMS emission now deletes 7 point/shape keys inside the enabled-track block and emits all 8 distinct TRACK_* params (TRACKHEADSHAPES/TRACKMARKERSHAPES fixed and separate), with full UI controls for head color/shape/size, line color/width, and marker color/shape/size defaulting to Kinetica doc defaults.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend TrackConfig + TRACK_DEFAULTS, fix emission | cd51d4d | trackConfig.ts, trackConfig.spec.ts, wmsUrlBuilder.ts, wmsUrlBuilder.spec.ts |
| 2 | Add TRACK STYLE marker controls (color/shape/size) | 23490d6 | KineticaWmsLayerForm.tsx, KineticaWmsLayerForm.spec.tsx |

## What Was Built

**Task 1 (TRACKFIX-V19-04 + TRACKFIX-V19-05):**

1. Extended `TrackConfig` type with `markerColor?: string`, `markerShape?: string`, `markerSize?: number` (emitted as TRACKMARKERCOLORS/TRACKMARKERSHAPES/TRACKMARKERSIZES).

2. Updated `TRACK_DEFAULTS` to Kinetica WMS doc defaults (operator-confirmed 2026-06-07):
   - `headColor: "FFFFFFFF"` (white, was red FFFF0000)
   - `trailColor: "FF00FF00"` (green, was blue FF0000FF)
   - `headSize: 10` (was 8)
   - `trailSize: 3` (was 2)
   - Added `markerColor: "FF0000FF"`, `markerShape: "none"`, `markerSize: 2`

3. Suppression fix (TRACKFIX-V19-04/GAP-54-05): 7 `delete params.*` calls inside the enabled-track block — POINTCOLORS, POINTOPACITY, POINTSIZES, POINTSHAPES, SHAPEFILLCOLORS, SHAPELINECOLORS, SHAPELINEWIDTHS. Runs after DOTRACKS is set, regardless of which render lane set them.

4. OQ-9 misnaming fix (TRACKFIX-V19-05): `headShape` now emits `params.TRACKHEADSHAPES` (was `params.TRACKMARKERSHAPES`). `markerShape` emits `params.TRACKMARKERSHAPES` as a distinct param. Both TRACKHEADSHAPES and TRACKMARKERSHAPES are now distinct, individually guarded.

5. Added 3 new marker param emissions: TRACKMARKERCOLORS (via normalizeAARRGGBB), TRACKMARKERSHAPES, TRACKMARKERSIZES.

6. Spec changes: updated TRACK_DEFAULTS describe to new values + new marker field assertions; replaced single raster emission test with a full 8-param test; added raster+track suppression test; added classbreak+track suppression test; added cb_raster expand test for all 8 params including markers; updated RENDER-V19-04 byte-lock to use TRACKHEADSHAPES.

**Task 2 (TRACKFIX-V19-05 form surface):**

Added 3 marker controls to the TRACK STYLE section of `KineticaWmsLayerForm.tsx` after the Track line width control:

- **Track marker color**: color swatch + AARRGGBB hex text input + alpha range (copies head-color idiom), writes `markerColor` via `onSetTrackField`, defaults to `TRACK_DEFAULTS.markerColor`.
- **Track marker shape**: select over `POINT_SHAPES` (12 options including "none"), writes `markerShape` via `onSetTrackField`, defaults to `TRACK_DEFAULTS.markerShape`.
- **Track marker size**: range (min 0, max 20, step 1), writes `markerSize` via `onSetTrackField`, defaults to `TRACK_DEFAULTS.markerSize`.

Added `TRACKFIX-V19-05` describe block in the form spec: 8 assertions covering control presence, 12-option shape dropdown, marker color hex onChange integration (preserves other fields), latlon no-regression, and a single "all 8 controls present" test.

## Verification

- `cd packages/web && npx vitest run`: 1638/1638 passed (net +13 from 1625 baseline)
- `npx tsc --noEmit -p packages/web/tsconfig.json`: clean
- Non-track paths (latlon/wkt/cb-without-track) emit POINT*/SHAPE* unchanged — backward-compat snapshot and Phase 52 track-spatial mode describes all green

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated RENDER-V19-04 byte-lock spec to TRACKHEADSHAPES**

- **Found during:** Task 1 GREEN phase
- **Issue:** The Phase 52/53 `RENDER-V19-04` describe block had a byte-lock asserting `params.TRACKMARKERSHAPES === "circle"` — the old (incorrect) emission from before the OQ-9 fix. After fixing the misnaming, that test failed because TRACKHEADSHAPES is now the correct param for headShape.
- **Fix:** Updated the single assertion to `expect(params!.TRACKHEADSHAPES).toBe("circle")` with a comment referencing the misnaming fix. This is expected collateral of the TRACKFIX-V19-05 scope (the whole point of the task is to rename this param).
- **Files modified:** packages/web/src/lib/wmsUrlBuilder.spec.ts
- **Commit:** cd51d4d

## Task 3 — Checkpoint (Human Required)

Task 3 (TRACKFIX-V19-03: operator re-walk §2/§3 of 54-UAT) is a blocking human-verify checkpoint. The code has landed; the operator must re-walk sections 2 and 3 of 54-UAT.md with the running app to attest:
- WMS request under track mode has no POINTCOLORS/POINTOPACITY/POINTSIZES/POINTSHAPES/SHAPEFILLCOLORS/SHAPELINECOLORS/SHAPELINEWIDTHS
- WMS request carries all 8 TRACK_* params (TRACKHEADSHAPES and TRACKMARKERSHAPES as distinct keys)
- TRACK STYLE section shows all 8 controls, editable and effective
- Track tiles render reflecting head/line/marker styling

## Self-Check: PASSED

- FOUND: packages/web/src/lib/trackConfig.ts
- FOUND: packages/web/src/lib/wmsUrlBuilder.ts
- FOUND: packages/web/src/components/charts/KineticaWmsLayerForm.tsx
- FOUND commit cd51d4d (Task 1)
- FOUND commit 23490d6 (Task 2)
- Test suite: 1638/1638 passed
- TSC: clean
