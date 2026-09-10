---
phase: 85-si-smart-abbreviation-number-format
plan: "01"
subsystem: column-formatter + format-editor
tags: [formatter, si, d3-format, number-format, column-display-config]
dependency_graph:
  requires: [columnFormatter.ts (v1.15 foundation), d3-format@^3.1.2 (already installed)]
  provides: [FormatSpecSI type, buildSIFormatter, kind:si in buildFormatter, SIControls editor sub-component]
  affects: [all resolveFormatter consumers: WidgetRenderer, ColumnFormatTooltip, InfoSelectionView, TimelineRenderer, NumericLineRenderer]
tech_stack:
  added: []
  patterns: [d3 SI specifier .${N+1}~s, exhaustiveness guard in buildFormatter switch, SIControls mirrors D3Controls/NumberControls pattern]
key_files:
  created: []
  modified:
    - packages/web/src/lib/columnFormatter.ts
    - packages/web/src/lib/columnFormatter.spec.ts
    - packages/web/src/components/ColumnFormatEditorModal.tsx
    - packages/web/src/components/ColumnFormatEditorModal.spec.tsx
decisions:
  - "d3 specifier is .${decimals+1}~s (not .${decimals}s): the +1 offset maps user-facing decimal-places to d3 significant-digit precision; the ~ flag trims trailing zeros (1.0M → 1M)"
  - "Test assertion uses getByTestId('live-preview') + toHaveTextContent rather than getByText(/1.2M/) to avoid collision with the hint text which also contains '1.2M'"
  - "SIControls uses only existing CSS classes (config-group, config-group-label, ds-field, ds-field-label, config-hint) — no invented class names per CLAUDE.md"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-26"
  tasks_completed: 2
  files_modified: 4
---

# Phase 85 Plan 01: SI Smart-Abbreviation Number Format Summary

**One-liner:** SI smart-abbreviation format (d3 `.${N+1}~s` → k/M/G/T) added to the column-display formatter lib and exposed in the Column Format editor with decimal-places control and live preview.

## What Was Built

### Task 1: FormatSpecSI in columnFormatter.ts (FMT-V117-01)

Added a 5th `FormatSpec` variant `{ kind: "si"; decimals: number }` to the column-display formatter library:

- **`FormatSpecSI` type** exported alongside the other 4 variants
- **`FormatSpec` union** extended: `FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone | FormatSpecSI`
- **`buildSIFormatter`** internal function using `d3Format(\`.\${spec.decimals + 1}~s\`)` — the `+1` maps user-facing decimal places to d3 significant-digit precision; the `~` trims trailing zeros
- **`case "si":` in `buildFormatter` switch** — placed before the exhaustiveness guard (TypeScript now errors if a new union member is added without a switch case)
- **`defaultFormatKind` unchanged** — never returns "si"; SI is opt-in only
- **Never-throws contract preserved** — same null/undefined/isNaN/try-catch shape as `buildD3Formatter`
- **10 new tests** in `columnFormatter.spec.ts` covering: 1.2M/3.4G/decimals 0-2/sub-kilo/zero/negative Unicode minus/null+undefined passthrough/non-numeric raw fallback

### Task 2: SI option in ColumnFormatEditorModal (FMT-V117-02)

Exposed the new `kind:"si"` in the Column Format editor:

- **`FormatSpecSI` added to imports** from `../lib/columnFormatter`
- **`defaultSpecForKind("si")`** returns `{ kind: "si", decimals: 1 }` (default: `.2~s` → "1.2M")
- **5th kind-picker option** `<option value="si">Smart abbreviation (k / M / G / T)</option>`
- **`SIControls` sub-component** renders decimal-places `<input type="number">` using only existing CSS classes (`config-group`, `config-group-label`, `ds-field`, `ds-field-label`, `config-hint`)
- **`computePreview` and `handleSave` unchanged** — `buildFormatter(spec)(SAMPLE_NUMBER)` automatically produces "1.2M" for the default SI spec; save/load path via `upsertColumnDisplayConfig` is transparent JSON blob round-trip
- **T11 test** in `ColumnFormatEditorModal.spec.tsx`: switching kind to "si" shows decimal-places input + live preview shows "1.2M"

### Propagation

All existing render surfaces (records table cells, chart axis tick labels, bar value labels, chart tooltips, timeline/line tooltips, map info popup KV + template) consume `resolveFormatter → buildFormatter` — the new `kind:"si"` propagates to every surface automatically with zero per-surface wiring changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion for live preview text was ambiguous**
- **Found during:** Task 2, T11 test
- **Issue:** `screen.getByText(/1\.2M/)` matched two elements: the `SIControls` hint text (which contains "1.2M") and the live preview div — causing "Found multiple elements" error
- **Fix:** Changed assertion to `screen.getByTestId("live-preview")` + `toHaveTextContent("1.2M")` to target the preview div directly
- **Files modified:** `packages/web/src/components/ColumnFormatEditorModal.spec.tsx`
- **Commit:** f70435a (included in Task 2 commit)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 9b0287d | feat(85-01): add FormatSpecSI variant to columnFormatter (kind:si) |
| Task 2 | f70435a | feat(85-01): expose SI format option in ColumnFormatEditorModal (FMT-V117-02) |

## Test Gates

- `cd packages/web && npx tsc --noEmit`: CLEAN
- `cd packages/web && npx vitest run src/lib/columnFormatter.spec.ts`: 51/51 PASS
- `cd packages/web && npx vitest run src/components/ColumnFormatEditorModal.spec.tsx`: 11/11 PASS
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts`: 126/126 PASS
- `cd packages/web && npx vitest run`: 2783/2783 tests PASS (120/120 test files pass; 10 pre-existing TD-V16-TEST-ISOLATION unhandled rejections from InfoCardRenderer/InfoPopup cross-mode contamination — these are pre-existing, not introduced by this plan)
- `git diff --name-only -- packages/server`: EMPTY (frontend-only confirmed)

## Self-Check: PASSED

All 4 modified files confirmed on disk. Both task commits (9b0287d, f70435a) confirmed in git log.
