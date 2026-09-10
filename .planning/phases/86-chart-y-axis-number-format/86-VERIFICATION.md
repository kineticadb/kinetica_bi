---
phase: 86-chart-y-axis-number-format
verified: 2026-06-26T15:22:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 86: Chart Y-Axis Number Format — Verification Report

**Phase Goal:** A designer can control how a timeline or line chart's Y-axis tick labels are formatted per widget, defaulting to the bound value column's format and overridable per chart, without touching tooltips or data labels.
**Verified:** 2026-06-26T15:22:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A designer sees a Y-axis number-format control in BOTH the timeline and the line chart config panels | VERIFIED | TimelineConfigPanel.tsx line 530 and NumericLineConfigPanel.tsx line 495 both render "Y-AXIS FORMAT" section with FormatSpecEditor |
| 2 | The control offers the same number-format kinds as the Column Format editor, including SI smart-abbreviation | VERIFIED | FormatSpecEditor.tsx lines 262-268: options none/number/date/d3/si — identical to modal picker; SIControls exported and rendered |
| 3 | Picking a kind writes yAxisFormat into the widget config (override set) | VERIFIED | Both panels: `patch({ yAxisFormat: s ?? undefined })` on non-null onChange; specs Y2 assert `yAxisFormat: { kind: "si", ... }` |
| 4 | Choosing 'Use column default' clears the override (yAxisFormat becomes undefined, NOT kind:"none") | VERIFIED | FormatSpecEditor onChange with val=="" fires `onChange(null)`; panels map null to `patch({ yAxisFormat: undefined })`; specs Y3 assert `yAxisFormat` is undefined |
| 5 | Extracting the shared controls leaves the existing Column Format editor behavior unchanged | VERIFIED | ColumnFormatEditorModal.tsx local `defaultSpecForKind` count = 0; re-imports from FormatSpecEditor; ColumnFormatEditorModal.spec.tsx passes (11 tests unchanged) |
| 6 | With no per-widget override, Y-axis ticks render using the bound value column's display-config formatter | VERIFIED | useMemo branch 2: `resolveFormatter(tableId, metricColumn)` when `cfg.yAxisFormat` absent; configVersion in deps; TimelineRenderer.spec.tsx Y2 + NumericLineRenderer.spec.tsx Y2 confirm |
| 7 | Setting a per-widget yAxisFormat overrides the tick formatter live on both renderers | VERIFIED | useMemo branch 1: `buildFormatter(cfg.yAxisFormat)` when override present; 4 `tickFormatter={yAxisTickFormatter}` per renderer on type="number" axes only |
| 8 | The override changes Y-axis TICK labels ONLY — tooltips and data labels unchanged | VERIFIED | ColumnFormatTooltip.tsx unmodified (git diff f8d66f0..HEAD empty for that file); tooltip JSX receives no yAxisFormat prop; Y3 spec in both renderers asserts this |
| 9 | Editing the bound column's display config refreshes the default tick formatter (configVersion-reactive) | VERIFIED | `configVersion` is the last dep in both useMemo dep arrays: `[cfg.yAxisFormat, tableId, metricColumn, configVersion]` |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/components/charts/FormatSpecEditor.tsx` | Shared kind picker + 4 controls + defaultSpecForKind | VERIFIED | 298 lines; exports FormatSpecEditor + NumberControls + DateControls + D3Controls + SIControls + defaultSpecForKind; "Use column default" option (value="") present |
| `packages/web/src/components/charts/FormatSpecEditor.spec.tsx` | Tests for null/si/clear/decimals paths | VERIFIED | 4 tests (T1-T4) covering spec=null, selecting si, editing decimals, selecting "" |
| `packages/web/src/components/ColumnFormatEditorModal.tsx` | Re-imports extracted helpers; no local defaultSpecForKind | VERIFIED | Imports NumberControls/DateControls/D3Controls/SIControls/defaultSpecForKind from `./charts/FormatSpecEditor`; `grep -c "function defaultSpecForKind"` = 0 |
| `packages/web/src/components/charts/TimelineConfigPanel.tsx` | yAxisFormat?: FormatSpec + Y-AXIS FORMAT section | VERIFIED | Line 39: `yAxisFormat?: FormatSpec`; line 530: "Y-AXIS FORMAT" label; FormatSpecEditor import + render (2 occurrences) |
| `packages/web/src/components/charts/NumericLineConfigPanel.tsx` | yAxisFormat?: FormatSpec + Y-AXIS FORMAT section | VERIFIED | Line 35: `yAxisFormat?: FormatSpec`; line 495: "Y-AXIS FORMAT" label; FormatSpecEditor import + render (2 occurrences) |
| `packages/web/src/components/charts/TimelineRenderer.tsx` | yAxisTickFormatter useMemo + tickFormatter on 4 value axes | VERIFIED | useMemo with override/column-default/identity branches; configVersion dep; exactly 4 `tickFormatter={yAxisTickFormatter}` + 2 `tickFormatter={bucketFormatter}` (unchanged) |
| `packages/web/src/components/charts/NumericLineRenderer.tsx` | yAxisTickFormatter useMemo + tickFormatter on 4 value axes | VERIFIED | Identical structure to TimelineRenderer; 4 + 2 tickFormatter counts verified |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ColumnFormatEditorModal.tsx | FormatSpecEditor.tsx | `import { NumberControls, DateControls, D3Controls, SIControls, defaultSpecForKind } from "./charts/FormatSpecEditor"` | WIRED | Lines 30-35 confirmed by grep |
| TimelineConfigPanel.tsx | FormatSpecEditor.tsx | import + `<FormatSpecEditor spec={yAxisFormat} onChange={...} />` | WIRED | Line 28 import; line 531 render |
| NumericLineConfigPanel.tsx | FormatSpecEditor.tsx | import + `<FormatSpecEditor spec={yAxisFormat} onChange={...} />` | WIRED | Line 27 import; line 496 render |
| TimelineRenderer.tsx | buildFormatter / resolveFormatter | `cfg.yAxisFormat ? buildFormatter(cfg.yAxisFormat) : resolveFormatter(tableId, metricColumn)` | WIRED | Lines 148-158; both functions imported; configVersion dep present |
| TimelineRenderer.tsx | recharts YAxis/XAxis type=number | `tickFormatter={yAxisTickFormatter}` on all 4 value axes | WIRED | Count = 4; bucket axes keep `tickFormatter={bucketFormatter}` (count = 2) |
| NumericLineRenderer.tsx | buildFormatter / resolveFormatter | Same useMemo shape | WIRED | Lines 137-147; identical structure |
| NumericLineRenderer.tsx | recharts YAxis/XAxis type=number | `tickFormatter={yAxisTickFormatter}` on all 4 value axes | WIRED | Count = 4; bucket axes unchanged (count = 2) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AXIS-V117-01 | 86-01-PLAN.md | Config panels each expose a Y-axis number-format control reusing column format options incl. SI | SATISFIED | FormatSpecEditor with all 5 kinds wired into both config panels; verified by TimelineConfigPanel.spec.tsx Y1-Y3, NumericLineConfigPanel.spec.tsx Y1-Y3 |
| AXIS-V117-02 | 86-01-PLAN.md, 86-02-PLAN.md | Y-axis format defaults to bound column's formatter; overridable per-widget; clearing falls back | SATISFIED | Config panels: set via `patch({ yAxisFormat: spec })`, clear via `patch({ yAxisFormat: undefined })`; renderers: useMemo hybrid resolution (override then column-default then identity), configVersion-reactive |
| AXIS-V117-03 | 86-02-PLAN.md | Resolved formatter applied to Y-axis tick labels (recharts tickFormatter); tooltips/data labels NOT changed | SATISFIED | Exactly 4 `tickFormatter={yAxisTickFormatter}` per renderer on value axes only; ColumnFormatTooltip.tsx unmodified; Y3 spec in both renderer specs asserts tooltip isolation |

All three requirements marked Complete in REQUIREMENTS.md. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

No TODO/FIXME/placeholder comments in new files. No empty implementations. No `return null` / `return {}` stubs. No invented CSS class names. No raw hex colors. No `console.log`-only implementations.

---

### Human Verification Required

One item warrants optional visual confirmation, though all automated checks pass:

**Visual appearance of the Y-AXIS FORMAT section in config panels**

Test: Open a timeline or line chart widget, navigate to the OPTIONS section of the config panel. Verify the "Y-AXIS FORMAT" heading appears after the existing group-by section, the format kind select shows "— Use column default —" as the initial selection, and selecting "Smart abbreviation" renders the SIControls (Decimal places input) below the picker.

Expected: Section label visible; controls render correctly; the hint text "Applied to the Y-axis tick labels only..." appears; selecting a format kind in the panel and saving updates the chart's Y-axis tick labels while tooltips remain in the column-format style.

Why human: Visual layout, CSS rendering, and recharts tick-label output in a real browser with real data cannot be asserted by JSDOM/vitest. The renderer specs use source-text assertions rather than recharts SVG rendering due to JSDOM fragility with recharts.

---

### Guardrails Verified

| Check | Result |
|-------|--------|
| FRONTEND-ONLY (no packages/server changes) | PASSED — `git diff f8d66f0..HEAD -- packages/server/` is empty |
| No new dependency added | PASSED — packages/web/package.json unchanged; buildFormatter/resolveFormatter were pre-existing imports |
| No invented CSS class names | PASSED — grep for format-editor/fmt-editor/yaxis/y-axis-format/yaxis-format/format-section returns nothing |
| No raw hex in component files | PASSED — theme-guard.spec.ts 128/128 PASS |
| tsc --noEmit clean | PASSED — 0 errors |
| All 4 documented commits exist | PASSED — f8d66f0, 5d871ab, 176ba5c, dde20e7 all present in git log |

---

### Test Results Summary

| Spec File | Tests | Result |
|-----------|-------|--------|
| FormatSpecEditor.spec.tsx | 4 | PASS |
| ColumnFormatEditorModal.spec.tsx | 11 | PASS (unchanged, pure refactor confirmed) |
| TimelineConfigPanel.spec.tsx | 26 (3 new Y1-Y3) | PASS |
| NumericLineConfigPanel.spec.tsx | 21 (3 new Y1-Y3) | PASS |
| TimelineRenderer.spec.tsx | 26 (3 new Y1-Y3) | PASS |
| NumericLineRenderer.spec.tsx | 21 (3 new Y1-Y3) | PASS |
| theme-guard.spec.ts | 128 | PASS |

**Total tested in this run: 109/109 across 6 spec files + 128/128 theme-guard.**

---

_Verified: 2026-06-26T15:22:00Z_
_Verifier: Claude (gsd-verifier)_
