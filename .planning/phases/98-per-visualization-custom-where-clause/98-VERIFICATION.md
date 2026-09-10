---
phase: 98-per-visualization-custom-where-clause
verified: 2026-06-30T17:15:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 98: Per-Visualization Custom WHERE Clause — Verification Report

**Phase Goal:** On every plain-SQL widget, a designer can enter a freeform raw-SQL WHERE expression that is ANDed on top of the active drill-down / per-viz-selection filters against the materialized view the widget already reads — never a new materialize path.
**Verified:** 2026-06-30T17:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | VIZSQL-V119-01: All in-scope plain-SQL widget types expose a persisted "Custom filter (SQL)" textarea field | VERIFIED | 7 registry definitions (bar/pie/line/scatter/bignumber/table/records) carry the field + defaultConfig entry; TimelineConfig, NumericLineConfig, CalendarConfig each declare `customWhere?: string` and their panels render the textarea via canonical `config-textarea`/`ds-field`/`ds-field-label` classNames |
| 2 | VIZSQL-V119-02: Non-empty customWhere is parenthesized and injected into the widget's own read query via AND/WHERE | VERIFIED | andCustomWhere → ` AND (<predicate>)` for timeline/numeric-line/calendar builders; whereCustomWhere → ` WHERE (<predicate>)` for aggregated generatedSql (records-style/scalar/grouped) and RecordsTableRenderer page-fetch + CSV export; CalendarRenderer passes it as a builder arg (no string rewrite) |
| 3 | VIZSQL-V119-03: Empty/absent customWhere leaves every SQL path byte-identical | VERIFIED | andCustomWhere("") returns ""; whereCustomWhere("") returns ""; explicit regression-lock tests in all 7 spec files; pre-existing test suites pass unchanged (3066/3066) |
| 4 | VIZSQL-V119-04: Invalid customWhere surfaces error in existing per-widget error state, isolated | VERIFIED | No new error UI introduced; existing `.catch((err) => setError(err.message))` + `widget-error` div paths confirmed unchanged in all three renderer types; WidgetRenderer.spec covers records page-fetch error isolation |
| 5 | Invariant: AggregatedWidgetRenderer is the sole materialize trigger — no new materializeFilter/dropFilterView calls | VERIFIED | grep on all Phase 98 files (builders, config panels, renderers) returns nothing for materializeFilter/dropFilterView |
| 6 | Invariant: No new fromSwap in CalendarRenderer or any Phase 98 renderer | VERIFIED | CalendarRenderer.tsx contains no fromSwap; grep of fromSwap on the file returns only header comments saying "no fromSwap"; customWhere is builder-arg-only |
| 7 | Invariant: customWhere.ts is a pure module (zero React/Zustand/network imports) | VERIFIED | grep for react/zustand/api/client/runSql returns nothing in customWhere.ts |
| 8 | Invariant: No packages/server diff | VERIFIED | `git status --porcelain packages/server` is empty |
| 9 | Invariant: No invented CSS classNames | VERIFIED | All panels use canonical `config-textarea`, `ds-field`, `ds-field-label` from global.css; theme-guard passes (132/132) |
| 10 | Map/WMS and no-SQL widgets excluded | VERIFIED | grep -L on map.ts/data-filter.ts/info-card.ts/legend.ts/radio-group.ts confirms none carry customWhere |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `packages/web/src/lib/customWhere.ts` | andCustomWhere + whereCustomWhere pure helpers; single parenthesization source of truth | VERIFIED | 37 lines; both exports; trim-based empty guard; zero framework imports; correct output format |
| `packages/web/src/lib/customWhere.spec.ts` | 12 tests covering all edge cases | VERIFIED | 12 tests: non-empty, undefined, empty, whitespace, trim, OR predicate for both functions |
| `packages/web/src/lib/buildTimelineSql.ts` | customWhere? arg + andCustomWhere import + cw splice on both paths | VERIFIED | customWhere in args type, `const cw = andCustomWhere(customWhere)`, spliced into ungrouped (`IS NOT NULL${cw} GROUP BY`) and grouped (`IS NOT NULL${inClause}${cw} GROUP BY`) |
| `packages/web/src/lib/buildNumericLineSql.ts` | same pattern as timeline | VERIFIED | Identical structure to buildTimelineSql |
| `packages/web/src/lib/buildCalendarSql.ts` | customWhere? arg + andCustomWhere import + cw splice on single path | VERIFIED | Single emit path; `WHERE ${timeCol} IS NOT NULL${cw} GROUP BY` |
| `packages/web/src/components/charts/definitions/bar.ts` | Advanced textarea field + defaultConfig | VERIFIED | `{ key: "customWhere", label: "Custom filter (SQL)", type: "textarea", defaultValue: "", group: "Advanced", hint: "..." }` + `customWhere: ""` in defaultConfig |
| `packages/web/src/components/charts/definitions/pie.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/definitions/line.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/definitions/scatter.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/definitions/bignumber.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/definitions/table.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/definitions/records.ts` | same | VERIFIED | |
| `packages/web/src/components/charts/ChartConfigPanel.tsx` | whereCustomWhere import + cw in generatedSql useMemo (3 real-SELECT shapes) + draft.customWhere in dep array | VERIFIED | Line 10: import; line 295: `const cw = whereCustomWhere(draft.customWhere...)`; lines 306/323/339: cw spliced into records-style/scalar/grouped; line 340: dep array contains `draft.customWhere` |
| `packages/web/src/components/charts/WidgetRenderer.tsx` | whereCustomWhere import + cw at RecordsTableRenderer top + injection at both SQL sites | VERIFIED | Line 76: import; line 1617: `const cw = whereCustomWhere(...)`; line 1740: CSV export SQL; line 1861: page-fetch SQL; AggregatedWidgetRenderer path untouched |
| `packages/web/src/components/charts/TimelineConfigPanel.tsx` | customWhere?: string on TimelineConfig + textarea panel field | VERIFIED | Line 47: type member; line 97: cfg read; line 548-549: textarea value/onChange |
| `packages/web/src/components/charts/TimelineRenderer.tsx` | andCustomWhere import + customWhere threaded into both buildTimelineSql calls + inline topSql + dep array | VERIFIED | Line 57: import; line 128: cfg read; lines 319/338/373: topSql/grouped main/ungrouped builder calls; line 424: dep array |
| `packages/web/src/components/charts/NumericLineConfigPanel.tsx` | customWhere?: string on NumericLineConfig + textarea panel field | VERIFIED | Line 42: type member; line 90: cfg read; lines 513-514: textarea |
| `packages/web/src/components/charts/NumericLineRenderer.tsx` | andCustomWhere import + customWhere threaded into both buildNumericLineSql calls + inline topSql + dep array | VERIFIED | Lines 48/117/295/314/351/400 confirmed |
| `packages/web/src/components/charts/CalendarConfigPanel.tsx` | customWhere?: string on CalendarConfig (type only, NOT in DEFAULT_CALENDAR_CONFIG) + textarea panel field | VERIFIED | Line 61: type member; DEFAULT_CALENDAR_CONFIG block confirmed has no customWhere; line 145: cfg read; lines 663-664: textarea |
| `packages/web/src/components/charts/CalendarRenderer.tsx` | customWhere threaded as buildCalendarSql arg only; no andCustomWhere/whereCustomWhere call; no new fromSwap | VERIFIED | Line 114: cfg read; lines 307/361: builder-arg pass; zero andCustomWhere/whereCustomWhere calls in renderer; no fromSwap |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `buildTimelineSql.ts` | `customWhere.ts` | `import { andCustomWhere }` + call at line 95 | WIRED | `const cw = andCustomWhere(customWhere);` spliced at both emit sites |
| `buildNumericLineSql.ts` | `customWhere.ts` | `import { andCustomWhere }` + call at line 92 | WIRED | Same pattern |
| `buildCalendarSql.ts` | `customWhere.ts` | `import { andCustomWhere }` + call at line 88 | WIRED | Same pattern |
| `ChartConfigPanel.tsx` | `customWhere.ts` | `import { whereCustomWhere }` at line 10, called at line 295 | WIRED | `cw` spliced into all 3 real-SELECT shapes |
| `WidgetRenderer.tsx` | `customWhere.ts` | `import { whereCustomWhere }` at line 76, called at line 1617 | WIRED | `cw` at both SQL sites in RecordsTableRenderer |
| `TimelineRenderer.tsx` | `buildTimelineSql.ts` | `customWhere` passed as builder arg at lines 338/373 | WIRED | Also inline topSql at line 319 via `andCustomWhere(customWhere)` |
| `CalendarRenderer.tsx` | `buildCalendarSql.ts` | `customWhere,` in args object at lines 307/361 | WIRED | Builder-arg only; no direct string splice in renderer |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| VIZSQL-V119-01 | 98-02, 98-03 | Config field on all plain-SQL widgets | SATISFIED | 7 registry defs + 3 CustomConfigPanel types; REQUIREMENTS.md shows [x] |
| VIZSQL-V119-02 | 98-01, 98-02, 98-03 | Non-empty customWhere ANDed into own read query | SATISFIED | andCustomWhere/whereCustomWhere injection at all 3 paths; REQUIREMENTS.md shows [x] |
| VIZSQL-V119-03 | 98-01, 98-02, 98-03 | Empty/absent → byte-identical SQL | SATISFIED | Trim-based empty guard; explicit regression-lock tests across all spec files; REQUIREMENTS.md shows [x] |
| VIZSQL-V119-04 | 98-02, 98-03 | Invalid WHERE surfaces per-widget error, isolated | SATISFIED | No new error UI; existing catch/setError/widget-error path confirmed unchanged; REQUIREMENTS.md shows [x] |

---

### Anti-Patterns Found

None. Scan across all 8 commits' files:
- No TODO/FIXME/placeholder comments in production code
- No `return null` or stub implementations
- No invented CSS classNames (config-textarea, ds-field, ds-field-label all verified in global.css)
- No raw hex colors (theme-guard passes 132/132)
- No fromSwap in CalendarRenderer
- No materializeFilter/dropFilterView in any Phase 98 file

---

### Human Verification Required

| # | Test | Expected | Why Human |
|---|------|----------|-----------|
| 1 | Open a bar/pie/line/scatter/bignumber/table/records widget config, navigate to the "Advanced" group | "Custom filter (SQL)" textarea appears with the correct hint | Visual panel rendering — cannot assert in jsdom |
| 2 | Enter `region = 'West'` in the Custom filter field and apply | Widget data refreshes filtered by that predicate against the active combination view | Real Kinetica backend required |
| 3 | Enter an invalid predicate (e.g. `INVALID !!!`) and apply | Widget shows error message in red error area; other dashboard widgets unaffected | Real Kinetica error response required |
| 4 | Clear the custom filter field and apply | Widget returns to unfiltered state (byte-identical query behavior) | Visual / runtime check |
| 5 | Open a Timeline/NumericLine/Calendar widget config | "Custom filter (SQL)" textarea appears in the appropriate panel section | Visual panel rendering |

---

### Test Gate Results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | CLEAN (no output) |
| `npx vitest run` | 131 test files passed, 3066 tests passed, 0 failed (3 pre-existing unhandled-rejection 401 errors from InfoCardRenderer — known, per CLAUDE.md) |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASSED 132/132 |
| `git status --porcelain packages/server` | EMPTY (zero server diff) |

---

### Gaps Summary

No gaps. All must-haves verified at all three levels (exists, substantive, wired). All 4 VIZSQL requirement IDs are marked satisfied in REQUIREMENTS.md. All 8 commits exist in git history. All test gates pass.

The phase goal is achieved: every plain-SQL widget (bar, pie, line, scatter, bignumber, table, records, timeline, numeric-line, calendar) exposes a persisted "Custom filter (SQL)" field whose predicate is parenthesized and injected into the widget's own read query against the existing materialized view, with no new materialize path, no new fromSwap in CalendarRenderer, byte-identical behavior when empty, and per-widget error isolation when invalid.

---

_Verified: 2026-06-30T17:15:00Z_
_Verifier: Claude (gsd-verifier)_
