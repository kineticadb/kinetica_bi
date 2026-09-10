---
phase: 100-custom-metrics-tables-area-editor-metric-picker-integration
verified: 2026-07-01T11:10:00Z
status: passed
score: 9/9 must-haves verified
gaps: []
human_verification:
  - test: "Open Tables area, navigate to any table's detail, click 'Custom metrics'"
    expected: "Two-pane modal opens; left pane lists existing metrics; Add metric button visible"
    why_human: "Visual layout + modal open/close behaviour cannot be confirmed programmatically"
  - test: "Add a metric with a duplicate label for the same table"
    expected: "Save button triggers an inline error message (not a toast, not a crash); modal stays open"
    why_human: "End-to-end 409 flow requires a live API call"
  - test: "Select a custom metric in ChartConfigPanel (bar/pie/line/area/bignumber)"
    expected: "Aggregation selector disappears; generated SQL preview shows the raw expression with no AGG() wrapper"
    why_human: "Visual verification of UI element hiding + SQL preview text"
  - test: "Delete a metric, then open a widget that had it selected"
    expected: "Picker shows '(deleted metric)'; widget falls to its existing empty/error state without crashing"
    why_human: "Multi-step cross-widget state flow"
---

# Phase 100: Custom Metrics Tables-Area Editor + Metric-Picker Integration — Verification Report

**Phase Goal:** Users define/edit/delete custom metrics from the Tables area (mirroring the Column Format editor), and those metrics appear in every visualization's metric picker, emitted directly into the widget SQL with no extra aggregation wrapper.
**Verified:** 2026-07-01T11:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | From the Tables area a user opens a Custom metrics editor for a table | VERIFIED | `DatasetsPage.tsx:141` — "Custom metrics" `ghost-sm` button in TableDetail; `showMetricsEditor` state + conditional `<CustomMetricsEditorModal>` render at line 195 |
| 2 | User can add / edit / delete a metric and it persists via the API | VERIFIED | `CustomMetricsEditorModal.tsx` calls `createCustomMetric`, `updateCustomMetric`, `deleteCustomMetric`; `upsertMetric`/`removeMetric` update store; 4/4 spec tests pass |
| 3 | Duplicate label surfaces the server 409 as inline error, not a crash | VERIFIED | `handleSave` catches error message and sets `formError`; rendered in `.custom-metrics-editor-error` (real CSS rule — `color: var(--danger)`); spec test "duplicate-409-inline" passes |
| 4 | Custom metrics appear in every metric picker (bar/pie/line/area/bignumber, calendar, timeline, numeric-line); scatter excluded | VERIFIED | `ChartConfigPanel.tsx:680` — `<optgroup label="Custom metrics">`; `CalendarConfigPanel.tsx:512`; `TimelineConfigPanel.tsx:434`; `NumericLineConfigPanel.tsx:412`; `metricPicker.spec.tsx` 4/4 pass |
| 5 | Selecting a custom metric writes its id and hides the aggregation selector | VERIFIED | Each panel: `decodeMetricSelection` on onChange writes `metricId`, clears column; aggregation wrapped in `{!isCustomSelection(metricId) && ...}`; spec test (b) confirms agg hidden |
| 6 | Custom metrics emit raw expression with NO extra AGG wrapper | VERIFIED | `customMetricSql.ts` `resolveMetricExpr`: custom → `found.expression` directly; all 4 emission sites branch through it; builder specs assert `not.toContain("SUM(SUM(")` and `toContain("SUM(revenue)/SUM(cost) AS value")` |
| 7 | Real-column widgets emit byte-identical SQL (backward-compat) | VERIFIED | Byte-identical regression lock tests in `buildCalendarSql.spec.ts`, `buildTimelineSql.spec.ts`, `buildNumericLineSql.spec.ts`, `ChartConfigPanel.customMetric.spec.tsx` — all assert `toBe` the exact golden string when `metricId` is absent |
| 8 | Orphaned metric id shows "(deleted metric)" marker and degrades gracefully | VERIFIED | `isOrphanedMetric` renders extra option; spec test (c) confirms; builders use `resolved ?? realAgg` (orphan → realAgg with empty col → existing empty/error state, documented in comments) |
| 9 | Renderers thread tableId + subscribe to configVersion so edits resolve live | VERIFIED | `CalendarRenderer.tsx:322-323` passes `tableId` + `metricId` to `buildCalendarSql`; `TimelineRenderer.tsx:352,389` passes `tableId` to both builder calls with `customMetricsConfigVersion` in dep array; `NumericLineRenderer.tsx` same pattern |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/components/CustomMetricsEditorModal.tsx` | Two-pane CRUD editor modal | VERIFIED | 461 lines; imports `useCustomMetricsStore`, `selectMetrics`, all 3 CRUD fns; two-pane layout with `modal-overlay`/`modal-left`/`modal-right` |
| `packages/web/src/components/CustomMetricsEditorModal.css` | Layout + real `.custom-metrics-editor-error` rule | VERIFIED | 112 lines; defines all custom-metrics-editor-* layout classes; `.custom-metrics-editor-error { color: var(--danger); }` at line 109; no raw hex |
| `packages/web/src/components/CustomMetricsEditorModal.spec.tsx` | CRUD lifecycle + 409 inline + delete spec | VERIFIED | 4/4 tests pass |
| `packages/web/src/components/DatasetsPage.tsx` | Custom metrics button + modal render on TableDetail | VERIFIED | `CustomMetricsEditorModal` import at line 15; `showMetricsEditor` state at 128; button at 141; conditional render at 195 |
| `packages/web/src/lib/customMetricSql.ts` | `isCustomSelection` + `resolveMetricExpr` + encode/decode helpers | VERIFIED | 89 lines; exports all required symbols; zero React imports; reads `selectMetrics` from store |
| `packages/web/src/lib/customMetricSql.spec.ts` | All 4 resolution behaviors + encode/decode + orphan | VERIFIED | 22 tests all pass; includes `not.toMatch(/SUM\(SUM\(/)` assertion |
| `packages/web/src/lib/timelineBin.ts` | `metricId?: number` on TimelineMetric | VERIFIED | Line 35: `metricId?: number` added; `NumericMetric` inherits via re-export |
| `packages/web/src/lib/buildCalendarSql.ts` | `resolveMetricExpr` branch + `tableId` + `metricId` args | VERIFIED | `resolveMetricExpr` import at line 21; `tableId?: number` at 47; `metricId?: number` at 53; branch at line 100 |
| `packages/web/src/lib/buildTimelineSql.ts` | `resolveMetricExpr` branch + `tableId` arg | VERIFIED | Import at 17; `tableId?: number` at 49; branch at line 101 |
| `packages/web/src/lib/buildNumericLineSql.ts` | `resolveMetricExpr` branch + `tableId` arg | VERIFIED | Import at 19; `tableId?: number` at 50; branch at line 98 |
| `packages/web/src/components/charts/ChartConfigPanel.tsx` | Custom picker optgroup + agg hide + `draft.metricId` in deps | VERIFIED | `selectMetrics` at 648; `Custom metrics` optgroup at 680; `isCustomSelection` agg guard at 697; `draft.metricId` in deps at 386 |
| `packages/web/src/components/charts/ChartConfigPanel.customMetric.spec.tsx` | Byte-identical + custom emission tests | VERIFIED | 4/4 tests pass; scalar + grouped byte-identical locks + custom raw-expression assertions |
| `packages/web/src/components/charts/CalendarConfigPanel.tsx` | `metricId?: number` in CalendarConfig type + picker | VERIFIED | `metricId?: number` at line 59; `Custom metrics` optgroup at 512; agg hide at 526 |
| `packages/web/src/components/charts/TimelineConfigPanel.tsx` | Per-row custom picker + completeness guard | VERIFIED | `Custom metrics` optgroup at 434; `isCustomSelection` agg guard at 445; completeness guard updated at lines 170+175 |
| `packages/web/src/components/charts/NumericLineConfigPanel.tsx` | Per-row custom picker + completeness guard | VERIFIED | `Custom metrics` optgroup at 412; agg guard at 423; completeness guard at lines 161+166 |
| `packages/web/src/components/charts/CalendarRenderer.tsx` | `tableId` + `metricId` passed to `buildCalendarSql`; `configVersion` dep | VERIFIED | Lines 322-323: `tableId` and `metricId` in builder args; `customMetricsConfigVersion` at 120; `loadConfig` effect at 123 |
| `packages/web/src/components/charts/TimelineRenderer.tsx` | `tableId` to both builder calls; `configVersion` dep | VERIFIED | Lines 352 and 389; `customMetricsConfigVersion` at 152; `loadConfig` effect at 154 |
| `packages/web/src/components/charts/NumericLineRenderer.tsx` | `tableId` to both builder calls; `configVersion` dep | VERIFIED | Lines 328 and 367; `customMetricsConfigVersion` at 141; `loadConfig` effect at 143 |
| `packages/web/src/components/charts/metricPicker.spec.tsx` | 4 integration tests (optgroup + hide-agg + deleted-marker + Timeline row) | VERIFIED | 4/4 tests pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `CustomMetricsEditorModal.tsx` | `api/client.ts` | `createCustomMetric`/`updateCustomMetric`/`deleteCustomMetric` | WIRED | All 3 CRUD imports present and called in `handleSave`/`handleDelete` |
| `DatasetsPage.tsx` | `CustomMetricsEditorModal` | TableDetail button + conditional render | WIRED | Import at line 15; button at 141; conditional render at 195 |
| `customMetricSql.ts` | `customMetricsStore.ts` | `selectMetrics(tableId)` | WIRED | `import { selectMetrics }` at line 20; used in `resolveMetricExpr` and `isOrphanedMetric` |
| `buildCalendarSql.ts` | `customMetricSql.ts` | `resolveMetricExpr` branch | WIRED | Import + branch at `const resolved = resolveMetricExpr(metricId, realAgg, tableId)` |
| `buildTimelineSql.ts` | `customMetricSql.ts` | `resolveMetricExpr` branch | WIRED | Import + branch at line 101 |
| `buildNumericLineSql.ts` | `customMetricSql.ts` | `resolveMetricExpr` branch | WIRED | Import + branch at line 98 |
| `ChartConfigPanel.tsx` | `customMetricSql.ts` | `resolveMetricExpr` (generatedSql) + picker helpers | WIRED | `resolveMetricExpr` at lines 12+348+366; `selectMetrics` at 648; picker helpers imported |
| `CalendarRenderer.tsx` | `buildCalendarSql.ts` | `tableId` + `metricId` threaded into call | WIRED | Lines 322-323 in `buildCalendarSql({..., tableId, metricId})` |
| `TimelineRenderer.tsx` | `buildTimelineSql.ts` | `tableId` threaded into both calls | WIRED | Lines 352 and 389 |
| `NumericLineRenderer.tsx` | `buildNumericLineSql.ts` | `tableId` threaded into both calls | WIRED | Lines 328 and 367 |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| METRIC-V119-01 | 100-01, 100-03 | Tables-area authoring UI: create/edit/delete custom metrics | SATISFIED | `CustomMetricsEditorModal` + DatasetsPage button; picker integration in all 4 config panels |
| METRIC-V119-03 | 100-03 | Custom metrics appear in every visualization metric picker | SATISFIED | All 4 config panels have `<optgroup label="Custom metrics">`; `metricPicker.spec.tsx` integration tests pass |
| METRIC-V119-04 | 100-02 | Custom metric expression emitted directly, no extra AGG wrapper | SATISFIED | `resolveMetricExpr` returns raw expression; builder specs assert `not.toContain("SUM(SUM(")` at all 4 emission sites |

All 3 requirement IDs are marked `[x]` in REQUIREMENTS.md.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `ChartConfigPanel.tsx` | 634 | `config-hint-warning` (undefined CSS class) | INFO | PRE-EXISTING — present before Phase 100; not introduced by this phase; renders unstyled but this is a latent issue from an earlier phase |
| `CustomMetricsEditorModal.tsx` | 289,314 | `modal-left` / `modal-right` (undefined standalone classes) | INFO | NOT a Phase 100 issue — mirrors exactly `ColumnFormatEditorModal.tsx` which uses the same pattern; the layout is provided by the paired `custom-metrics-editor-left`/`custom-metrics-editor-right` classes which ARE defined in `CustomMetricsEditorModal.css` |

No Phase 100 anti-patterns introduced. All custom classes used by the new modal are defined in `CustomMetricsEditorModal.css` with theme tokens only. Theme-guard passes with 136/136.

---

### Human Verification Required

#### 1. Tables-area modal reachability and UX

**Test:** Log in, go to Tables area, open any table detail, click "Custom metrics"
**Expected:** Two-pane modal opens showing an empty left pane and "Select a metric or add a new one." placeholder; "Add metric" button is visible; Close button and ESC both dismiss (with dirty guard if form has content)
**Why human:** Modal open/close behaviour, keyboard navigation, and visual layout cannot be confirmed programmatically

#### 2. 409 duplicate-label inline error

**Test:** Add a metric, then try to add a second metric with the same label
**Expected:** Inline error message appears inside the modal (not a toast), modal stays open, no crash
**Why human:** Requires a live API to produce a real 409 response

#### 3. Aggregation-hide behavior in all 4 pickers

**Test:** Open any widget's config panel (bar, calendar, timeline, numeric-line); the "Custom metrics" optgroup should appear; select a custom metric
**Expected:** Aggregation selector disappears for that picker/row; re-selecting a real column brings it back
**Why human:** Visual verification of UI element toggling

#### 4. Orphan / deleted-metric degradation

**Test:** Configure a widget to use a custom metric, then delete the metric from the Tables area editor, then reopen the widget config panel
**Expected:** Picker shows "(deleted metric)" for that entry; the widget falls to its existing empty/error state without crashing or silently substituting a value
**Why human:** Multi-step cross-widget state flow requiring actual data persistence

---

### Gaps Summary

No gaps found. All 9 observable truths verified, all key links wired, all 3 requirement IDs satisfied, test gates clean.

---

## Test Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | CLEAN (no output) |
| `npx vitest run` (full suite) | 136 files / 3134 tests PASSED; 8 pre-existing InfoCardRenderer 401 unhandled-rejection errors (known, not test failures) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 136/136 PASSED |
| `git diff --name-only packages/server` | EMPTY (FRONTEND-ONLY confirmed) |

---

_Verified: 2026-07-01T11:10:00Z_
_Verifier: Claude (gsd-verifier)_
