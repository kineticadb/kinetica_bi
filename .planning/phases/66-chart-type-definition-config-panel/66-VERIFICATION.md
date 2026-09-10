---
phase: 66-chart-type-definition-config-panel
verified: 2026-06-16T10:45:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 66: Chart-Type Definition + Config Panel Verification Report

**Phase Goal:** Operators can add a Calendar Heatmap widget to a dashboard, configure it end-to-end (table/dv binding, timestamp column, metric + aggregation, domain/subdomain dropdowns enforcing the 8 valid combos, palette), and save a valid config — with a cell-count cap preventing runaway grid configurations before any renderer exists.
**Verified:** 2026-06-16T10:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A `calendar` chart type appears in the widget-type picker; adding a calendar widget renders a placeholder (NOT AggregatedWidgetRenderer) — usesAggregation:false, usesDataSource:false, CustomConfigPanel:CalendarConfigPanel registered in definitions/index.ts | VERIFIED | `definitions/calendar.ts` has all four flags; `definitions/index.ts` line 43 calls `registerCalendar()`; `WidgetRenderer.tsx` line 347 short-circuits before line 358 `AggregatedWidgetRenderer` |
| 2 | CalendarConfigPanel shows table/dv data-source picker, timestamp column dropdown (datetime only), metric column + aggregation (reusing AGGREGATIONS), Domain dropdown, dependent Subdomain dropdown gated to the 8 valid combos | VERIFIED | CalendarConfigPanel.tsx lines 357-489 render all sections; `VALID_DOMAIN_SUBDOMAIN[domain]` drives subdomain options (line 349); AGGREGATIONS list at lines 68-77 matches TimelineConfigPanel; `inferDataTypeFromColumn === "datetime"` gates timestamp columns |
| 3 | Saving an invalid domain/subdomain combo is blocked — isValid(false); invalid subdomain options not selectable | VERIFIED | `isValidCombo(domain, subdomain)` in formValid (line 267-272); subdomain `<select>` renders only `validSubdomains` (VALID_DOMAIN_SUBDOMAIN[domain]) so invalid options are never rendered; spec Test 11 asserts isValid(false) for impossible combo |
| 4 | Saving a config whose estimated cell count exceeds the cap (CELL_LIMIT=10000) produces a clear message and does NOT persist; sensible default domain/subdomain pre-filled on creation | VERIFIED | Cap probe at lines 212-261 calls runSql + estimateCalendarCells; capState "over" sets formValid=false; line 519-525 renders "exceeds" message with `var(--danger)` token; DEFAULT_CALENDAR_CONFIG has domain:"month", subdomain:"day" |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/estimateCalendarCells.ts` | Pure cell-count upper-bound estimator + MIN/MAX range probe query builder | VERIFIED | 91 lines; exports `estimateCalendarCells`, `buildCalendarRangeQuery`, `SUBDOMAIN_GRANULARITY_MS`; imports only from `./calendarBin`; zero React/Zustand/Recharts imports |
| `packages/web/src/lib/estimateCalendarCells.spec.ts` | Vitest coverage for estimator + cap boundary | VERIFIED | 87 lines; 8 tests all green (confirmed by targeted vitest run) |
| `packages/web/src/components/charts/CalendarConfigPanel.tsx` | dv-aware calendar config panel with combo gating + cell-count cap | VERIFIED | 530 lines (>200 min); exports `CalendarConfig`, `DEFAULT_CALENDAR_CONFIG`, default `CalendarConfigPanel`; all key imports confirmed |
| `packages/web/src/components/charts/CalendarConfigPanel.spec.tsx` | Vitest coverage: dv dual-write, combo gating, cap block, defaults | VERIFIED | 11 tests all green (confirmed by targeted vitest run) |
| `packages/web/src/components/charts/definitions/calendar.ts` | Calendar chart-type registry entry | VERIFIED | Contains `type: "calendar"`, `usesAggregation: false`, `usesDataSource: false`, `supportsDrillDown: false`, `CustomConfigPanel: CalendarConfigPanel`; default export `registerCalendar()` |
| `packages/web/src/components/charts/definitions/index.ts` | registerCalendar() wired into registerAllChartTypes | VERIFIED | Line 25 imports `registerCalendar`; line 43 calls `registerCalendar()` with Phase 66 comment |
| `packages/web/src/components/charts/WidgetRenderer.tsx` | calendar placeholder short-circuit branch | VERIFIED | Line 347 `effectiveWidget.type === "calendar"` branch before line 358 `AggregatedWidgetRenderer` fallback; placeholder uses `var(--text-muted)` theme token only |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `estimateCalendarCells.ts` | `calendarBin.ts` | `import type { CalendarSubdomain } from "./calendarBin"` | WIRED | Line 25; also imports `CELL_LIMIT` indirectly via spec; does NOT redefine the cap |
| `CalendarConfigPanel.tsx` | `calendarBin.ts` | `import VALID_DOMAIN_SUBDOMAIN, isValidCombo, CELL_LIMIT` | WIRED | Lines 28-31 |
| `CalendarConfigPanel.tsx` | `estimateCalendarCells.ts` | `import estimateCalendarCells, buildCalendarRangeQuery` | WIRED | Lines 34-36 |
| `CalendarConfigPanel.tsx` | `/api/sql (runSql)` | save-time MIN/MAX cap probe | WIRED | Line 37 import; line 233 call with AbortController signal |
| `CalendarConfigPanel.tsx` | `cbColorThemes.ts` | `CB_COLOR_THEMES.filter(t => t.group === "Sequential")` | WIRED | Line 204 |
| `definitions/calendar.ts` | `CalendarConfigPanel.tsx` | `import CalendarConfigPanel, { DEFAULT_CALENDAR_CONFIG }` | WIRED | Line 22 |
| `definitions/index.ts` | `definitions/calendar.ts` | `import registerCalendar from "./calendar"` + call | WIRED | Lines 25 and 43 |
| `registry.ts` | `api/client.ts` | `import type { WidgetDto, DynamicViewRow }` | WIRED | Line 2; `dynamicViews?: DynamicViewRow[]` in ConfigPanelProps line 86 |
| `ChartConfigPanel.tsx` | `ConfigPanelProps.dynamicViews` | `dynamicViews={dynamicViews}` forwarded to `<Custom>` | WIRED | Line 441 |
| `WidgetRenderer.tsx` | calendar placeholder | `else if (effectiveWidget.type === "calendar")` before `else { AggregatedWidgetRenderer }` | WIRED | Lines 347-358; ordering confirmed |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAL-V113-01 | 66-02, 66-04 | calendar chart type registered + selectable + routes through its own short-circuit (NOT AggregatedWidgetRenderer) | SATISFIED | `definitions/calendar.ts` + `definitions/index.ts` registration; WidgetRenderer line 347 short-circuit before line 358 AggregatedWidgetRenderer; `usesAggregation:false` locked invariant |
| CAL-V113-02 | 66-03 | Config panel: timestamp column, metric+aggregation, Domain, dependent Subdomain (8 valid combos), color-palette | SATISFIED | CalendarConfigPanel.tsx: datetime-only filter, AGGREGATIONS list, VALID_DOMAIN_SUBDOMAIN-gated subdomain options, Sequential CB_COLOR_THEMES; 11 spec tests green |
| CAL-V113-05 (cap portion) | 66-01, 66-03 | Cell-count cap prevents runaway grids; sensible defaults | SATISFIED | `estimateCalendarCells.ts` + `buildCalendarRangeQuery`; CalendarConfigPanel cap probe blocks save when estimate > CELL_LIMIT; DEFAULT_CALENDAR_CONFIG domain:month/subdomain:day; 8 estimator spec tests + cap block test (Test 9) green |

No orphaned requirements — all three IDs claimed by plans map to shipped code.

---

### Locked Invariant Checks

| Invariant | Status | Evidence |
|-----------|--------|----------|
| CalendarConfigPanel.tsx does NOT import materializeFilter/dropFilterView | VERIFIED | grep returned NOT_FOUND — no such imports anywhere in the file |
| definitions/calendar.ts does NOT import materializeFilter/dropFilterView | VERIFIED | grep returned NOT_FOUND |
| CalendarConfigPanel.tsx contains NO raw hex literals (#RGB / #RRGGBB) | VERIFIED | grep for hex pattern returned NO_HEX_FOUND; theme-guard spec (49 tests) passes with CalendarConfigPanel.tsx auto-scanned and NOT on allowlist |
| CalendarConfigPanel.tsx is NOT on theme-guard ALLOWLIST | VERIFIED | ALLOWLIST in theme-guard.spec.ts contains only TimelineRenderer, NumericLineRenderer, ChartConfigPanel, MapChartRenderer, TimelineConfigPanel, NumericLineConfigPanel |

---

### Anti-Patterns Found

None detected. Scanned all 9 files created/modified across Plans 01-04:
- No TODO/FIXME/placeholder comments in implementation files
- No empty return bodies — all exports are substantive
- No raw hex in CalendarConfigPanel.tsx or WidgetRenderer.tsx calendar branch
- No CalendarRenderer import in WidgetRenderer.tsx (Phase 67 only referenced in comments)

---

### Human Verification Required

One item benefits from human confirmation during Phase 69 UAT (already flagged in ROADMAP):

**1. Widget-type picker appearance**
Test: Open the dashboard widget-type picker and confirm "Calendar Heatmap" appears with icon "CH".
Expected: "Calendar Heatmap" is listed and selectable; adding it renders the placeholder text "Calendar Heatmap — renderer coming in Phase 67."
Why human: Visual/UX confirmation of picker layout and placeholder text cannot be verified programmatically.

This does not block phase status — the registry wiring is fully verified in code.

---

### Test Gate Confirmation

All targeted spec runs confirmed green:

| Test file | Tests | Result |
|-----------|-------|--------|
| `src/lib/estimateCalendarCells.spec.ts` | 8 | passed |
| `src/components/charts/CalendarConfigPanel.spec.tsx` | 11 | passed |
| `src/styles/theme-guard.spec.ts` | 49 | passed |
| `npx tsc --noEmit` | — | clean (no output) |

All 7 documented commits exist in git log (095b833 through 8ddd1bb).

---

_Verified: 2026-06-16T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
