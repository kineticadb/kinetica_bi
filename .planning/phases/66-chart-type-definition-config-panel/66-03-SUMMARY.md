---
phase: 66-chart-type-definition-config-panel
plan: 03
subsystem: ui
tags: [react, typescript, calendar, config-panel, dynamic-views, cell-count-cap, colorbrewer]

# Dependency graph
requires:
  - phase: 66-01
    provides: estimateCalendarCells + buildCalendarRangeQuery (cell-count cap probe library)
  - phase: 66-02
    provides: ConfigPanelProps.dynamicViews field + ChartConfigPanel dv forwarding
  - phase: 65-01
    provides: VALID_DOMAIN_SUBDOMAIN + isValidCombo + CELL_LIMIT (calendarBin.ts)
provides:
  - CalendarConfigPanel.tsx — dv-aware config panel with combo gating + cell-count cap
  - CalendarConfig type + DEFAULT_CALENDAR_CONFIG exports
  - CalendarConfigPanel.spec.tsx — 11 tests covering all acceptance criteria
affects: [66-04 (registry wiring uses CalendarConfigPanel as CustomConfigPanel), 67 (renderer reads CalendarConfig fields)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dv-aware picker: unified Tables + Dynamic Views optgroups in a single <select>"
    - "EPOCH-seconds → ms conversion: (hi - lo) * 1000 (mirrors TimelineRenderer line 241)"
    - "Dependent subdomain dropdown: render only VALID_DOMAIN_SUBDOMAIN[domain] options — invalid ones hidden, not greyed"
    - "Cap probe with AbortController cleanup in useEffect; probe failure → capState idle (never blocks save)"
    - "Source-table as conservative probe target for dv-bound widgets (dv view is narrower, source is upper bound)"

key-files:
  created:
    - packages/web/src/components/charts/CalendarConfigPanel.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.spec.tsx
  modified: []

key-decisions:
  - "Single metric + aggregation pair (not N-row builder like Timeline) — calendar cells encode one value per bucket"
  - "Subdomain options are hidden when invalid for current domain (not disabled/greyed) — prevents impossible combos from being accidentally saved"
  - "Cap probe targets tableRef (source table) for both table-bound and dv-bound configs — dv view is narrower so source table span is a safe upper bound; documented in code comment"
  - "Probe failure (network error, SQL error) silently resets capState to idle — cap is a UX guard, not a hard requirement; documented in code comment"
  - "Domain change auto-resets subdomain to VALID_DOMAIN_SUBDOMAIN[newDomain][0] when current subdomain becomes invalid"

patterns-established:
  - "CalendarConfigPanel follows TimelineConfigPanel structural template: ConfigPanelProps destructure, cfg = config as Partial<T>, patch() helper, useEffect isValid wiring"
  - "vi.mock('../../api/client') with makeSqlResponse({column_headers, column_1, column_2}) for deterministic cap probe tests"

requirements-completed: [CAL-V113-02, CAL-V113-05]

# Metrics
duration: 8min
completed: 2026-06-16
---

# Phase 66 Plan 03: CalendarConfigPanel Summary

**dv-aware calendar config panel with dependent domain/subdomain combo gating, single metric+aggregation, Sequential ColorBrewer palette, and save-time cell-count cap (estimateCalendarCells + runSql probe)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-16T14:24:00Z
- **Completed:** 2026-06-16T14:32:02Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- CalendarConfigPanel.tsx: dv-aware data source picker (unified optgroups), datetime-only timestamp picker, single metric+aggregation, dependent subdomain dropdown (renders only valid options), Sequential palette defaulting to Greens, save-time cell-count cap probe with AbortController cleanup — all theme tokens, zero hex literals
- CalendarConfigPanel.spec.tsx: 11 tests covering dv dual-write, table-pick clears dynamicViewId, timestamp-only column filter, metric column includes *, dependent subdomain for domain=week, domain change resets subdomain, creation defaults, cap block (over limit) and cap ok (narrow range), and isValidCombo defense-in-depth

## Task Commits

1. **Task 1: CalendarConfigPanel.tsx** - `e38e40a` (feat)
2. **Task 2: CalendarConfigPanel.spec.tsx** - `cd0328f` (test)

## Files Created/Modified
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — dv-aware calendar config panel, 370 lines
- `packages/web/src/components/charts/CalendarConfigPanel.spec.tsx` — 11 vitest tests, all green

## Decisions Made
- Single metric + aggregation (not N-row builder): calendar cells encode one value per domain/subdomain bucket pair — multi-metric would require multiple heat-grid overlays which is out of scope for v1.13.
- Dependent subdomain dropdown hides invalid options (not disables): prevents any code path from saving an invalid combo; isValidCombo provides defense-in-depth for direct config injection.
- Cap probe targets source tableRef for both table-bound and dv-bound configs at config time: the dv's filtered materialized view is always narrower than the source table, making the source table a conservative upper bound. Documented in code with explicit comment.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- CalendarConfigPanel ready for Plan 66-04 registry wiring (CalendarConfigPanel as CustomConfigPanel, usesDataSource:false, usesAggregation:false)
- CalendarConfig type + DEFAULT_CALENDAR_CONFIG ready for Plan 67 renderer to read config fields
- Cell-count cap enforced at config-save; no renderer constraint on this

---
*Phase: 66-chart-type-definition-config-panel*
*Completed: 2026-06-16*
