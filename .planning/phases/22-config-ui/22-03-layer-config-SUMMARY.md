---
phase: "22"
plan: "03"
subsystem: config-ui
tags: [info-popup, config-form, chip-combobox, codemirror, tdd, sentinel-semantics]
dependency_graph:
  requires: ["22-01", "21-02", "19-01"]
  provides: ["CONFIG-V14-03"]
  affects: ["KineticaWmsLayerForm", "LayersModal", "InfoPopup"]
tech_stack:
  added: []
  patterns:
    - TDD RED-GREEN per task
    - Sentinel null compression (ChipCombobox all-selected → null)
    - Cross-phase sort (caller sorts, pure helper unchanged)
    - Controlled form props (onChangeInfoConfig separate from config-blob onChange)
key_files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - kinetica_bi/src/components/LayersModal.tsx
    - kinetica_bi/src/components/charts/InfoPopup.tsx
decisions:
  - "INFO POPUP section at bottom of KineticaWmsLayerForm (after all renderMode-specific blocks)"
  - "onChangeInfoConfig separate from config-blob onChange — top-level DashboardLayerDto attrs route differently"
  - "CodeMirror vi.mock in spec for jsdom compatibility — textarea mock with readOnly for disabled state"
  - "L3/L8 tests scoped via .info-popup-config-editor wrapper query to avoid multiple-textbox ambiguity"
  - "Cross-phase sort in InfoPopup caller; renderInfoTemplate.ts unchanged (pure)"
metrics:
  duration_min: 6
  completed_date: "2026-05-08"
  tasks_completed: 4
  files_modified: 4
requirements_satisfied:
  - CONFIG-V14-03
---

# Phase 22 Plan 03: Layer Config INFO POPUP Section Summary

**One-liner:** INFO POPUP section in KineticaWmsLayerForm with ChipCombobox + CodeMirror HTML editor, sentinel null semantics, and cross-phase column sort parity with InfoPopup KV mode.

## Tasks Completed

| Task | Name | Commit | Type |
|------|------|--------|------|
| 1 | Failing INFO POPUP spec (RED) | 8b441ce | test |
| 2 | Implement INFO POPUP section (GREEN) | 6a1e7ea | feat |
| 3 | Wire LayersModal info_* patches | b17116a | feat |
| 4 | Cross-phase column sort in InfoPopup | cc5cf38 | fix |

## Test Counts

| Spec file | Tests |
|-----------|-------|
| KineticaWmsLayerForm.spec.tsx | 20/20 (8 original + 12 new L1-L12) |
| InfoPopup.spec.tsx | 20/20 |
| LayersModal.spec.tsx | 16/16 |
| ChipCombobox.spec.tsx | 10/10 |
| Full suite | 470/470 |

## Locked Sentinel Semantics (3 Paths)

1. **Null preservation (default all-selected):** When `infoColumns=null`, ChipCombobox shows all chips selected; no write to storage until first deselect.
2. **Materialization on first deselect:** Clicking any chip from null state fires `onChangeInfoConfig({ info_columns: JSON.stringify(sortedRemaining) })`.
3. **Compression on re-select-all:** Re-adding the last deselected chip when all options are now included fires `onChangeInfoConfig({ info_columns: null })` back to sentinel.

## Cross-Phase Fix

`InfoPopup.tsx` now pre-sorts `entry.columns` alphabetically before calling `renderInfoTemplate`. This makes KV-mode column order match the ChipCombobox picker alphabetical order (established in `sortedColumnOptions` via `localeCompare`).

`renderInfoTemplate.ts` is byte-for-byte unchanged — the helper remains pure and order-preserving; sorting is the caller's responsibility.

## Must-Haves Verified

- INFO POPUP section appears at the very bottom of KineticaWmsLayerForm (after RASTER/HEATMAP/CLASSBREAK/CONTOUR PARAMS blocks) — verified by L1
- Toggle defaults ON when `infoEnabled=1`, OFF when `infoEnabled=0` — verified by L2/L12
- ChipCombobox columns sorted alphabetically regardless of `columns` prop order — verified by L4
- Default all-selected sentinel (null) preserved until first deselect — verified by L5/L6
- Re-selecting all chips compresses back to null — verified by L7
- Insert-column dropdown inserts `{column_name}` token at end — verified by L11
- CodeMirror onChange routes to `onChangeInfoConfig` — verified by L8
- Syntax note + security warning visible below editor — verified by L9
- Disabled when `infoEnabled=0`: chips + editor + insert picker disabled; toggle stays enabled — verified by L3
- Missing-table state: section disabled, "Bind a table to configure info popup" message, toggle also disabled — verified by L10
- `LayersModal` routes info_* patches via existing `onPatch` flow as DashboardLayerDto top-level attrs — Task 3
- No DOMPurify or sanitize imported (PROJECT.md no-sanitize lock confirmed)
- tsc --noEmit clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CodeMirror multiple-textbox ambiguity in L3/L8 tests**
- **Found during:** Task 2 GREEN implementation
- **Issue:** The form has multiple text inputs (color hex inputs render as `type="text"`) alongside the CodeMirror mock textarea; `getByRole("textbox")` found multiple elements
- **Fix:** L3 test changed to query `.info-popup-config-editor` wrapper and inspect its `aria-disabled` + child textarea's `readOnly`; L8 test scoped to same wrapper's textarea
- **Files modified:** KineticaWmsLayerForm.spec.tsx (same commit as implementation per TDD GREEN)
- **Commit:** 6a1e7ea

## Phase 22 Closure

CONFIG-V14-03 satisfied. Both extension targets carry INFO POPUP sections:
- `MapConfigPanel.tsx` (Plan 22-02) — toggle + radius input for the widget-level config
- `KineticaWmsLayerForm.tsx` (this plan) — full per-layer config: toggle, ChipCombobox, insert-column picker, CodeMirror HTML editor

## Next-Phase Readiness

Phase 23 (Info Card) will read the same per-layer `info_columns` / `info_template` fields. The alphabetical sort logic established in `InfoPopup.tsx` will need to be replicated or shared in the Info Card renderer so both surfaces render KV columns in the same order.

## Self-Check: PASSED

All 4 modified files verified present on disk. All 4 commits verified in git history.
