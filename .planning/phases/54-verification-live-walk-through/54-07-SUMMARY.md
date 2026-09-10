---
phase: 54-verification-live-walk-through
plan: "07"
subsystem: wms-rendering, track-styling, form-gating
tags: [track, classbreak, per-break-color, TRACKFIX-V19-06, wmsUrlBuilder, KineticaWmsLayerForm]
dependency_graph:
  requires: [54-06]
  provides: [per-break-track-color-emission, track-style-color-gating-under-cb]
  affects: [wmsUrlBuilder.ts, KineticaWmsLayerForm.tsx]
tech_stack:
  added: []
  patterns:
    - cbColors derived from cb.breaks[].color when CB configured; colorList() helper selects per-break or expand fallback
    - effectiveRenderMode gate on 3 TRACK STYLE color control pairs (head/line/marker color + alpha)
key_files:
  created: []
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - packages/web/src/components/charts/CbConfigForm.spec.tsx
decisions:
  - "cbColors uses the SAME per-break color for all three TRACK_* color params (one break color drives head/line/marker — cb_config has a single color per break, not distinct per-param colors)"
  - "colorList() helper: cbColors.join(',') when available, else expand(single) — clean null-CB fallback with no structural change to the expand pattern"
  - "CbConfigForm.tsx unchanged — confirmed trackContext only hides per-row advanced chevron/panel, NOT the column picker / method / auto-suggest / theme / per-break color picker (spec coverage added)"
  - "Updated existing 'Track line color present in Track+Classbreak' test to reflect new behavior (color hidden, width still present)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-08T03:01:59Z"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 5
  tests_added: 7
  tests_baseline: 1638
  tests_final: 1645
---

# Phase 54 Plan 07: Per-Break Track Color Emission + Form Color Gating Summary

**One-liner:** TRACKHEADCOLORS/TRACKLINECOLORS/TRACKMARKERCOLORS now emit per-break color list from cb.breaks[].color under track+classbreak, with the 3 TRACK STYLE single-color controls gated on effectiveRenderMode !== "classbreak".

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Per-break track color emission (TDD) | 56d2d16 (RED), 9b20ad2 (GREEN) | wmsUrlBuilder.ts, wmsUrlBuilder.spec.ts |
| 2 | TRACK STYLE color control gating + tests | 7b51653 | KineticaWmsLayerForm.tsx, KineticaWmsLayerForm.spec.tsx, CbConfigForm.spec.tsx |
| 3 | Operator §3 re-walk | CHECKPOINT | (not executed — human verify) |

## What Was Built

### Task 1: wmsUrlBuilder.ts — Per-Break Track Color Emission

Added two helpers alongside the existing `expand` and `n` variables in the track block:

```typescript
const cbColors: string[] | null =
  isCb && cbForTrack && isCbConfigConfigured(cbForTrack) && cbForTrack.breaks.length > 0
    ? cbForTrack.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.color, "FFFFFFFF"))
    : null;
const colorList = (single: string): string => (cbColors ? cbColors.join(",") : expand(single));
```

Changed TRACKHEADCOLORS, TRACKLINECOLORS, TRACKMARKERCOLORS to use `colorList(...)` instead of `expand(...)`. Non-color params (TRACKHEADSIZES, TRACKHEADSHAPES, TRACKLINEWIDTHS, TRACKMARKERSHAPES, TRACKMARKERSIZES) stay on `expand(...)` unchanged.

Fallback paths preserved:
- Under raster: cbColors=null → colorList = expand(single) → single TRACK STYLE color unchanged
- Under classbreak with null/unconfigured cb_config: cbColors=null → same single-color fallback

### Task 2: KineticaWmsLayerForm.tsx — Color Control Gating

Wrapped each of the 3 TRACK STYLE color control pairs in `{effectiveRenderMode !== "classbreak" && (<>...</>)}`:
1. Head color (RGB picker + hex text) + Head color alpha slider
2. Track line color (RGB picker + hex text) + Track line color alpha slider  
3. Track marker color (RGB picker + hex text) + Track marker color alpha slider

Uses `effectiveRenderMode` (not raw `renderMode`) so the heatmap→raster coercion path is honored.

Kept visible always: Head size, Head shape, Track line width, Track marker shape, Track marker size.

### Task 2 Part B: CbConfigForm.tsx — Confirmed No Over-Hiding

CbConfigForm.tsx was NOT modified. Confirmed via code review and added spec: `trackContext=true` gates ONLY the per-row advanced chevron (aria-label "Toggle advanced for row N") and the advanced panel (data-testid "cb-row-advanced-N"). The column picker, method, auto-suggest, N slider, color theme, and per-break color picker (aria-label "Color (RGB) for break N") are all rendered regardless of trackContext.

## Spec Changes

**wmsUrlBuilder.spec.ts:**
- Updated "under STYLES=cb_raster" test: TRACKHEADCOLORS/LINE/MARKER now "FF000000,FFFFFFFF,FF112233" (not single × N)
- Updated "cb_raster: track+enabled" test: same per-break expectation; renamed to reflect per-break behavior
- Added sibling test with markerColor in trackJson to assert TRACKMARKERCOLORS per-break
- Added null-CB fallback test: verifies single TRACK STYLE color with no commas when cb_config=null

**KineticaWmsLayerForm.spec.tsx:**
- Updated "Track line color + width controls present in Track+Classbreak mode too" → now asserts Track line color absent, Track line width present
- Added describe "Track + Class Break — TRACK STYLE color gating (TRACKFIX-V19-06)" with 4 tests:
  - 3 color controls absent under classbreak
  - 5 non-color controls present under classbreak
  - Full CB builder (CB column, Auto-suggest) present under track
  - All 3 color controls present under raster (guard)

**CbConfigForm.spec.tsx:**
- Added test "trackContext=true (TRACKFIX-V19-06): per-break color picker PRESENT and editable; advanced chevron ABSENT" in the RENDER-V19-03 describe block

## Verification

- Tests: 1645/1645 (baseline 1638, added 7) — all green
- tsc: clean (no errors)
- Track+raster single-color specs from 54-06 unchanged and green
- Non-track CB specs unchanged and green

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Adjustment] Sibling test needed for TRACKMARKERCOLORS in RENDER-V19-04 describe**
- **Found during:** Task 1 GREEN phase
- **Issue:** The RENDER-V19-04 describe block's shared `trackJson` fixture has no `markerColor`, so TRACKMARKERCOLORS would be undefined (gate: `if (tc.markerColor !== undefined)`). Asserting it in the main cb_raster test would fail on undefined.
- **Fix:** Split into main test (TRACKHEADCOLORS + TRACKLINECOLORS + non-color params) + sibling test with own `trackJsonWithMarker` fixture that includes markerColor, asserts all 3 per-break color params.
- **Files modified:** wmsUrlBuilder.spec.ts
- **Commit:** 9b20ad2

## Task 3: Awaiting Operator

Task 3 is a `checkpoint:human-verify` — paused here per plan instructions. Operator must run the app and walk UAT §3 to confirm Kinetica renders per-break-colored track segments.

## Self-Check: PASSED

- wmsUrlBuilder.ts: FOUND
- KineticaWmsLayerForm.tsx: FOUND
- 54-07-SUMMARY.md: FOUND
- Commit 56d2d16 (RED): FOUND
- Commit 9b20ad2 (GREEN Task 1): FOUND
- Commit 7b51653 (Task 2): FOUND
- Tests: 1645/1645
- tsc: clean
