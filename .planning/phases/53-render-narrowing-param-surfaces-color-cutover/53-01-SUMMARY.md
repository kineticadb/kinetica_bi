---
phase: 53-render-narrowing-param-surfaces-color-cutover
plan: 01
subsystem: map-layer-form
tags: [track, render-mode, color-picker, classbreak, tdd]
key-decisions:
  - "effectiveRenderMode derived locally (before onChange round-trip) so UI updates immediately on heatmap coercion"
  - "onSetTrackField merges into track_config JSON preserving all Phase 52 columns (xCol/yCol/trackIdAttr/trackOrderAttr)"
  - "TRACK STYLE section placed before RASTER PARAMS for top-to-bottom readability: spatial pickers → render mode → track style → cb builder"
  - "trackContext gates both chevron button AND advanced panel with single !trackContext predicate"
  - "Silent coercion uses useEffect with [spatialMode, renderMode] deps; no import of useToastStore"
dependency-graph:
  requires: [52-track-spatial-mode-foundation]
  provides: [RENDER-V19-01, RENDER-V19-02, RENDER-V19-03, COLOR-V19-01]
  affects: [KineticaWmsLayerForm, CbConfigForm]
tech-stack:
  patterns: [TDD red-green, AARRGGBB color idiom, track_config JSON merge, controlled form, useEffect coercion]
key-files:
  created: []
  modified:
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - packages/web/src/components/charts/CbConfigForm.tsx
    - packages/web/src/components/charts/CbConfigForm.spec.tsx
metrics:
  duration: "5 minutes"
  completed: "2026-06-07"
  tasks_completed: 3
  files_modified: 4
---

# Phase 53 Plan 01: Render Narrowing + Param Surfaces + Color Cutover Summary

**One-liner:** Track render narrowing to Raster+Classbreak with silent heatmap coercion, TRACK STYLE color-input section, RASTER PARAMS gating, and CbConfigForm trackContext prop suppressing per-break advanced panels.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Narrow render modes under Track + silent heatmap→raster coercion | d564abd | KineticaWmsLayerForm.tsx, .spec.tsx |
| 2 | TRACK STYLE section + hide RASTER PARAMS under Track+Raster | 54253e9 | KineticaWmsLayerForm.tsx, .spec.tsx |
| 3 | Track+Classbreak: CB builder + TRACK STYLE; hide per-break advanced via trackContext | d05d453 | CbConfigForm.tsx, .spec.tsx, KineticaWmsLayerForm.tsx, .spec.tsx |

## What Was Built

### Task 1 — Render-mode narrowing + silent coercion (RENDER-V19-01)

Added `if (spatialMode === "track" && m === "heatmap") return false` to the render-mode picker filter so heatmap is absent from the list under Track. Added a `useEffect` that fires `onChange({ ...config, renderMode: "raster" })` when `spatialMode === "track"` and `renderMode` is heatmap or contour — no toast, no confirm. Added `effectiveRenderMode` local variable so the Raster radio appears checked immediately before the parent round-trip completes.

### Task 2 — TRACK STYLE section + RASTER PARAMS gate (RENDER-V19-02, COLOR-V19-01)

Imported `TRACK_DEFAULTS` and `type TrackConfig` from `trackConfig.ts`. Added `onSetTrackField` helper that merges a single field into `track_config` JSON preserving `enabled: true` and all Phase 52 column fields. Added a TRACK STYLE `config-group` block rendered when `spatialMode === "track"`, containing head color (color swatch + AARRGGBB hex text + alpha range), head size range, head shape select, trail color (same idiom), trail color alpha, and line width range — all using the existing `rgbFromAARRGGBB`/`joinAARRGGBB`/`alphaFromAARRGGBB`/`normalizeAARRGGBB`/`alphaPercentToHex`/`alphaHexToPercent` idiom mirroring pointColor. Changed the RASTER PARAMS gate from `renderMode === "raster"` to `effectiveRenderMode === "raster" && spatialMode !== "track"`.

### Task 3 — Track+Classbreak CB builder + trackContext prop (RENDER-V19-03)

Added `trackContext?: boolean` prop to `CbConfigFormProps` with doc comment. Gated both the per-row chevron toggle button and the per-row advanced panel with `{!trackContext && (...)}`. Updated the classbreak mount in `KineticaWmsLayerForm` to use `effectiveRenderMode === "classbreak"` and pass `trackContext={spatialMode === "track"}`. Under Track+Classbreak, both TRACK STYLE and CLASS BREAK PARAMS sections render together.

## Verification

- All 115 tests passing (47 in KineticaWmsLayerForm.spec.tsx + 68 in CbConfigForm.spec.tsx)
- `npx tsc --noEmit` — clean
- Grep locks confirmed: narrowing filter, TRACK STYLE label, RASTER PARAMS gate, trackContext wiring
- No changes to packages/web/package.json (no new dependencies)
- No changes to wmsUrlBuilder.ts (emission byte-preserved; Plan 02 owns emission specs)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
