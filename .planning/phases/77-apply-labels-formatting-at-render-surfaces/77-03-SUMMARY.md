---
phase: 77-apply-labels-formatting-at-render-surfaces
plan: "03"
subsystem: map-info-popup
tags: [column-display-config, formatValue, renderInfoTemplate, InfoSelectionView, legend-exclusion-guard]
dependency_graph:
  requires: [75-03 (columnDisplayConfigStore + resolveLabel/resolveFormatter)]
  provides: [COLAPPLY-V115-03 (map popup both modes), COLAPPLY-V115-04 (legend exclusion test-locked)]
  affects: [InfoSelectionView.tsx, renderInfoTemplate.ts]
tech_stack:
  added: []
  patterns:
    - "formatValue callback injection into pure lib (keeps lib store-free)"
    - "configVersion primitive-selector re-render trigger"
    - "loadConfig useEffect keyed on activeLayer.table_id"
    - "resolveLabel / resolveFormatter bound to layer.table_id at call site"
key_files:
  created: []
  modified:
    - packages/web/src/lib/renderInfoTemplate.ts
    - packages/web/src/lib/renderInfoTemplate.spec.ts
    - packages/web/src/components/charts/InfoSelectionView.tsx
    - packages/web/src/components/charts/InfoSelectionView.spec.tsx
    - packages/web/src/components/LayersLegendPanel.spec.tsx
decisions:
  - "formatValue callback approach chosen over formatter-map: simpler, matches plan spec, keeps renderInfoTemplate fully pure (no Map iteration, no type widening)"
  - "void configVersion inline in render IIFE: ensures compiler sees the dependency without requiring a useMemo; matches existing filterVersion void-ref pattern"
  - "loadConfig via useColumnDisplayConfigStore.getState().loadConfig rather than imported loadConfig: avoids circular-ref risk and is idiomatic for non-reactive imperative calls inside effects"
  - "COLAPPLY-V115-04 guard: two test cases — behavioral (legend renders raw break text) + static (grep asserts no wiring in .tsx source)"
metrics:
  duration: "~65 minutes"
  completed: "2026-06-21"
  tasks_completed: 3
  files_modified: 5
  commits: 3
---

# Phase 77 Plan 03: Map Info Popups Template+KV + Legend Exclusion Guard Summary

Applied resolved display labels and value formatters to map info popups in both render modes (template `{column}` substitution and key/value), keeping `renderInfoTemplate` a pure store-free lib by injecting the formatter via a callback. Added the explicit COLAPPLY-V115-04 guard test locking the map layers legend as unaffected.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Add `formatValue` callback to `renderInfoTemplate`; lib stays pure | 83483c8 | renderInfoTemplate.ts, renderInfoTemplate.spec.ts |
| 2 | Wire formatter + label resolution into InfoSelectionView (template + KV) + configVersion | 51fec69 | InfoSelectionView.tsx |
| 3 | Tests — popup template+KV apply label/format + configVersion; LEGEND guard | e0366bf | InfoSelectionView.spec.tsx, LayersLegendPanel.spec.tsx |

## What Was Built

**renderInfoTemplate.ts** — Extended `RenderInfoTemplateArgs` with an optional `formatValue?(col, value) => string` callback. In the template branch: null/undefined guard runs first (returns ""), then calls `formatValue(col, v)` when provided, else `String(v)`. KV mode pairs contract unchanged (raw values; caller formats). No store imports; lib remains pure.

**InfoSelectionView.tsx** — Wired the Phase 75 column display helpers:
- Imported `useColumnDisplayConfigStore`, `resolveLabel`, `resolveFormatter`.
- Added `configVersion` primitive-selector subscription (re-render trigger on editor saves).
- Added `loadConfig(activeLayer.table_id)` useEffect keyed on table_id.
- Template mode: passes `formatValue: (col, value) => String(resolveFormatter(activeLayer.table_id, col)(value) ?? "")` into `renderInfoTemplate`.
- KV mode: `<th scope="row">{resolveLabel(activeLayer.table_id, col)}</th>` + `<td>{formatKvValue(resolveFormatter(activeLayer.table_id, col)(value))}</td>`.

**LayersLegendPanel.spec.tsx** — Added COLAPPLY-V115-04 guard describe block with two tests:
1. Behavioral: seeds `columnDisplayConfigStore` with a label/format for "fare" column, renders classbreak legend, asserts break labels render as raw cb_config text ("Low Fare", "10 – 20") and NOT as formatted currency ("$10.00 – $20.00").
2. Static: asserts `LayersLegendPanel.tsx` source contains no `resolveLabel`/`resolveFormatter`/`columnDisplayConfig`/`tableId`.

## Deviations from Plan

None — plan executed exactly as written. The `act` import correction (from `vitest` → `@testing-library/react`) in LayersLegendPanel.spec.tsx was a Rule 3 auto-fix caught immediately in the RED phase.

## Verification

- `renderInfoTemplate` imports no store — confirmed via `grep -nE "import .*columnDisplayConfigStore|from .*store/"` → no matches.
- `LayersLegendPanel.tsx` has no resolve*/tableId wiring — confirmed via `grep -nE "resolveLabel|resolveFormatter|columnDisplayConfig|tableId"` → no matches.
- `npx tsc --noEmit` — clean.
- `npx vitest run renderInfoTemplate.spec.ts InfoSelectionView.spec.tsx LayersLegendPanel.spec.tsx` — 74 passed.
- `npx vitest run theme-guard.spec.ts` — 52 passed (no raw hex introduced).

## Self-Check: PASSED

All key files confirmed present. All commits verified in git log.
