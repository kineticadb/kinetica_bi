---
phase: 98-per-visualization-custom-where-clause
plan: 03
subsystem: ui
tags: [customWhere, vizsql, timeline, numeric-line, calendar, config-panel, renderer]

# Dependency graph
requires: ['98-01']
provides:
  - "TimelineConfig.customWhere?: string — optional member unlocking cfg.customWhere in panel and renderer"
  - "NumericLineConfig.customWhere?: string — optional member unlocking cfg.customWhere in panel and renderer"
  - "CalendarConfig.customWhere?: string — optional member (type-only; DEFAULT_CALENDAR_CONFIG untouched)"
  - "TimelineConfigPanel: Custom filter (SQL) textarea persisting to config.customWhere"
  - "NumericLineConfigPanel: Custom filter (SQL) textarea persisting to config.customWhere"
  - "CalendarConfigPanel: Custom filter (SQL) textarea persisting to config.customWhere"
  - "TimelineRenderer: cfg.customWhere threaded into both buildTimelineSql calls + inline top-N topSql"
  - "NumericLineRenderer: cfg.customWhere threaded into both buildNumericLineSql calls + inline top-N topSql"
  - "CalendarRenderer: cfg.customWhere passed as builder arg to buildCalendarSql (no string rewrite)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED → GREEN on panel spec (textarea pre-fill/onChange/empty) then renderer spec (AND injection + byte-identical) per widget"
    - "Type member added FIRST to unblock TS2339 before any cfg.customWhere access"
    - "CalendarRenderer: builder-arg-only pattern — no andCustomWhere() call in renderer; builder owns AND-splice"
    - "Top-N pre-query consistency: inline topSql in Timeline/NumericLine also appends andCustomWhere(customWhere)"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/TimelineConfigPanel.tsx
    - packages/web/src/components/charts/TimelineConfigPanel.spec.tsx
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.spec.tsx
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx

key-decisions:
  - "customWhere?: string added to each config type FIRST (before any cfg.customWhere access) to prevent TS2339"
  - "DEFAULT_CALENDAR_CONFIG untouched — preserving byte-identical behavior for existing calendar widgets (Phase 97 precedent)"
  - "CalendarRenderer passes customWhere as a builder arg only; no andCustomWhere() call in renderer (DATE_TRUNC contains FROM tokens that a regex would clobber)"
  - "Inline top-N topSql in Timeline and NumericLine also gets andCustomWhere(customWhere) so series ranking respects the same predicate as the main query"
  - "customWhere added to each renderer's fetch effect dep array so editing the predicate triggers a re-fetch"
  - "Reused existing classNames (config-textarea, ds-field, ds-field-label) from global.css — no invented class names"

requirements-completed: [VIZSQL-V119-01, VIZSQL-V119-02, VIZSQL-V119-03, VIZSQL-V119-04]

# Metrics
duration: 9min
completed: 2026-06-30
---

# Phase 98 Plan 03: Own-SQL Widget customWhere (Timeline / NumericLine / Calendar) Summary

**Three config types gain optional customWhere; three panels expose the field; three renderers inject the predicate at build time via pure builders — byte-identical when empty, isolated per-widget error on invalid SQL**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-30T20:56:23Z
- **Completed:** 2026-06-30T21:05:25Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added `customWhere?: string` to `TimelineConfig`, `NumericLineConfig`, and `CalendarConfig` as the FIRST action in each task (prerequisite for TS2339-free `cfg.customWhere` access)
- Wired "Custom filter (SQL)" textarea (`config-textarea` class, `ds-field`/`ds-field-label` structure) in all three config panels using exact existing classNames from global.css
- Timeline and NumericLine renderers: threaded `customWhere` into both the grouped main `buildXSql` call AND the inline top-N `topSql` string (consistent series ranking requires both queries share the predicate)
- Calendar renderer: passed `customWhere` exclusively as a builder arg to `buildCalendarSql` — no `andCustomWhere()` call in the renderer itself (DATE_TRUNC SQL contains FROM tokens; the no-fromSwap-in-CalendarRenderer architectural rule)
- Added `customWhere` to the fetch effect dep array in all three renderers
- `DEFAULT_CALENDAR_CONFIG` untouched: existing calendar widgets remain byte-identical without re-saving
- 15 new test cases across 6 spec files; all 3066 tests pass; tsc clean; theme-guard green; zero server diff

## Task Commits

1. **Task 1: Timeline** - `64ccb85` (feat) — TimelineConfig + TimelineConfigPanel + TimelineRenderer + specs
2. **Task 2: NumericLine** - `b294c52` (feat) — NumericLineConfig + NumericLineConfigPanel + NumericLineRenderer + specs
3. **Task 3: Calendar** - `79efd49` (feat) — CalendarConfig (type only) + CalendarConfigPanel + CalendarRenderer + specs

## Files Created/Modified

- `TimelineConfigPanel.tsx` — `customWhere?: string` on type + `customWhere = cfg.customWhere ?? ""` read + textarea
- `TimelineConfigPanel.spec.tsx` — 3 new cases: CW1 (pre-fill), CW2 (onChange fires with customWhere), CW3 (empty → empty string)
- `TimelineRenderer.tsx` — `andCustomWhere` import + `customWhere` read + injection in ungrouped path, grouped mainSql, inline topSql + dep array
- `TimelineRenderer.spec.tsx` — 3 new cases: CW1 (AND injection in ungrouped SQL), CW2 (byte-identical when empty), CW3 (grouped top-N + main SQL both get predicate)
- `NumericLineConfigPanel.tsx` — same pattern as Timeline
- `NumericLineConfigPanel.spec.tsx` — 3 new cases mirroring Timeline panel cases
- `NumericLineRenderer.tsx` — same pattern as Timeline (andCustomWhere import + injection in ungrouped + grouped + topSql)
- `NumericLineRenderer.spec.tsx` — 2 new cases: CW1 (AND injection), CW2 (byte-identical)
- `CalendarConfigPanel.tsx` — `customWhere?: string` on type (NOT in DEFAULT_CALENDAR_CONFIG) + read + textarea
- `CalendarConfigPanel.spec.tsx` — 4 new cases: CW1–CW3 (same as above) + CW4 (DEFAULT has no customWhere property)
- `CalendarRenderer.tsx` — `customWhere` read + `customWhere,` in buildCalendarSql args + dep array (no andCustomWhere call, no fromSwap)
- `CalendarRenderer.spec.tsx` — 3 new cases: CW1 (AND injection via builder), CW2 (byte-identical), CW3 (source: customWhere in args, not andCustomWhere call)

## Decisions Made

- Added `customWhere?: string` to each type as the first action per task — prerequisite for TS2339-free access in both panel and renderer
- `DEFAULT_CALENDAR_CONFIG` deliberately not updated — Phase 97 precedent for optional fields; ensures existing calendar widget configs remain byte-identical
- CalendarRenderer passes `customWhere` to the builder only; the builder's `andCustomWhere()` does the splice — the renderer must not touch the SQL string post-construction (DATE_TRUNC contains FROM tokens)
- Timeline and NumericLine inline top-N topSql also appended `andCustomWhere(customWhere)` so the pre-query and main query both honor the predicate (consistent series ranking)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three own-SQL widget types (timeline / numeric-line / calendar) now expose and inject `customWhere`
- Phase 98 is complete: 98-01 (builders), 98-02 (aggregated widgets — parallel), 98-03 (own-SQL widgets — parallel) all done
- Requirements VIZSQL-V119-01 through VIZSQL-V119-04 fulfilled

## Self-Check: PASSED

All 12 modified files confirmed on disk. Three task commits (64ccb85, b294c52, 79efd49) verified in git log.
