---
phase: 71-shape-params-latlon-hide
plan: 01
subsystem: map-layer-config-ui
tags: [wms, classbreak, spatial-mode, config-form, react]
requires:
  - "KineticaWmsLayerForm/CbConfigForm trackContext precedent (Phase 53)"
  - "SpatialMode type (packages/web/src/lib/columnTypes.ts:242)"
provides:
  - "spatialMode !== latlon gate around layer-level raster SHAPE* fields"
  - "hideShapeParams prop on CbConfigForm gating the per-break SHAPE* trio"
  - "hideShapeParams={spatialMode === latlon} threading from KineticaWmsLayerForm"
affects:
  - "Map layer config UI (raster + classbreak) for latlon point layers"
tech-stack:
  added: []
  patterns:
    - "Nested spatial-mode visibility gate mirroring the Phase 53 trackContext precedent"
    - "Additive boolean prop (default falsy = full form) for child-component field hiding"
key-files:
  created: []
  modified:
    - "packages/web/src/components/charts/KineticaWmsLayerForm.tsx"
    - "packages/web/src/components/charts/CbConfigForm.tsx"
    - "packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx"
    - "packages/web/src/components/charts/CbConfigForm.spec.tsx"
decisions:
  - "Prop named hideShapeParams (per CONTEXT discretion) — additive, undefined/false preserves full form"
  - "Kept the (WKT) label suffix as-is (cosmetic cleanup not required)"
  - "Migrated pre-existing L218 raster test by splitting: latlon render asserts SHAPE* absent + Point shape/Antialiasing present; wkt render carries the SHAPE* emit assertions"
metrics:
  duration: "3min"
  completed: "2026-06-18"
  tasks: 2
  files: 4
requirements: [SHAPE-V114-01, SHAPE-V114-02]
---

# Phase 71 Plan 01: SHAPE* Hidden for Lat/Lon Point Layers (Config UI) Summary

Hide the layer-level and per-break SHAPE* style fields (shape fill color/alpha, shape line color/alpha, shape line width) in the map config UI when `spatialMode === "latlon"` — SHAPE* params style polygon/line geometry and do nothing for point layers. Mirrors the v1.9 Phase 53 `trackContext` precedent for the `latlon` SHAPE* subset only; POINT* fields and Antialiasing stay visible. UI-only — WMS emission suppression is Plan 02's concern.

## What Was Built

- **Task 1 — layer-level raster gate** (`KineticaWmsLayerForm.tsx`): wrapped the five SHAPE* `<label>` blocks (fill color, fill alpha, line color, line alpha, line width) in a `{spatialMode !== "latlon" && (<>…</>)}` fragment, nested inside the existing `effectiveRenderMode === "raster" && spatialMode !== "track"` group. The Antialiasing toggle and all POINT* fields stay outside the gate.
- **Task 2 — per-break gate + prop threading** (`CbConfigForm.tsx` + `KineticaWmsLayerForm.tsx`): added an additive `hideShapeParams?: boolean` prop to `CbConfigForm` (declared, destructured, doc-commented), wrapped the per-break SHAPE* trio (shape line width/color/fill) in `{!hideShapeParams && (<>…</>)}` while keeping Point size + Point shape outside; the parent passes `hideShapeParams={spatialMode === "latlon"}` at the CbConfigForm mount, directly below the existing `trackContext={spatialMode === "track"}` line.

## Key Decisions

- **Prop name `hideShapeParams`** chosen from the CONTEXT discretion list for clarity; additive semantics (undefined/false → full form) keep the existing `CbConfigForm.spec.tsx:420` "full panel" regression guard green untouched.
- **L218 test migration:** the pre-existing combined raster test rendered `baseConfig` (latlon) and asserted SHAPE* present — now contradicted by the gate. Split into a latlon test (Point shape + Antialiasing present, SHAPE* absent) and a wkt test (the SHAPE* color/width emit assertions). No `getByLabelText` for a SHAPE* control runs against a latlon render.
- **(WKT) label suffix left as-is** — cosmetic cleanup was optional; the fields now only render for wkt/wkb so the suffix is accurate.

## Deviations from Plan

None — plan executed exactly as written. No server diff, no architectural changes, no auth gates.

## Verification

- `cd packages/web && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx src/components/charts/CbConfigForm.spec.tsx` → 146 passed.
- Full frontend vitest from `packages/web` → **2388 passed (104 files)**, 100%.
- `cd packages/web && npx tsc --noEmit` → clean. `cd packages/server && npx tsc --noEmit` → clean.
- `git diff --name-only packages/server` → empty (FRONTEND-ONLY honored).
- `theme-guard.spec.ts` → 50 passed (visibility-only change, no raw hex added).

Acceptance greps:
- `spatialMode !== "latlon"` new gate at `KineticaWmsLayerForm.tsx:1188`; `Antialiasing` label at line 1324 (after the gate's `</>)}`).
- `hideShapeParams` in `CbConfigForm.tsx` at lines 80 (type), 121 (destructure), 999 (`!hideShapeParams` gate).
- `hideShapeParams={spatialMode === "latlon"}` at `KineticaWmsLayerForm.tsx:1427`.

## Commits

- `a8aaffc` feat(71-01): hide layer-level raster SHAPE* fields for latlon
- `f9e6e0d` feat(71-01): hide per-break SHAPE* trio for latlon via hideShapeParams prop

## For the Next Phase

- Plan **71-02** owns `wmsUrlBuilder.ts` SHAPE* emission suppression (SHAPE-V114-03) — the leak fix. Hiding the UI fields here does NOT clear saved `shapeFillColor`/`shapeLineColor`/`shapeLineWidth` values; the builder gate is what prevents stale values from emitting once `spatialMode` is latlon. Do not assume this plan touched the builder.

## Self-Check: PASSED

All 4 modified source files + SUMMARY.md present on disk; both per-task commits (a8aaffc, f9e6e0d) found in git log.
