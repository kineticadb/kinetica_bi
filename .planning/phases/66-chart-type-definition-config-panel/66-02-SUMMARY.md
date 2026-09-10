---
phase: 66-chart-type-definition-config-panel
plan: 02
subsystem: ui
tags: [react, typescript, chart-config, dynamic-views, config-panel]

# Dependency graph
requires:
  - phase: 65-calendar-sql-builder-kinetica-spike
    provides: calendarBin constants (KINETICA_DATE_TRUNC_UNITS, computeCellBounds)
  - phase: 33-dynamic-view-store
    provides: DynamicViewRow type in api/client.ts
provides:
  - ConfigPanelProps.dynamicViews optional field (registry.ts)
  - ChartConfigPanel forwards dynamicViews into <Custom> panel slot
affects:
  - 66-03 (CalendarConfigPanel — consumes dynamicViews from ConfigPanelProps)
  - any future CustomConfigPanel that needs dv-aware data source picking

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ConfigPanelProps extension pattern: add optional prop with Phase JSDoc + mirror existing field style"
    - "ChartConfigPanel forwarding pattern: new props passed to <Custom> slot with inline comment"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/registry.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx

key-decisions:
  - "dynamicViews added as optional to ConfigPanelProps so all existing panels (Timeline/DataFilter/Legend/Map) remain unchanged — no forced prop threading"
  - "Forwarding placed alongside widgets={widgets} in <Custom> JSX with identical comment pattern to maintain code readability"

patterns-established:
  - "ConfigPanelProps is the canonical prop surface for the <Custom> slot — new panel capabilities require adding optional fields here, not bypassing via context"

requirements-completed: [CAL-V113-01]

# Metrics
duration: 5min
completed: 2026-06-16
---

# Phase 66 Plan 02: ConfigPanelProps dynamicViews Threading Summary

**Optional `dynamicViews?: DynamicViewRow[]` added to ConfigPanelProps and forwarded through ChartConfigPanel's `<Custom>` slot, unblocking CalendarConfigPanel's dv-aware data-source picker**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-16T10:20:00Z
- **Completed:** 2026-06-16T10:25:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Extended `ConfigPanelProps` in `registry.ts` with `dynamicViews?: DynamicViewRow[]` (imported `DynamicViewRow` from `api/client`)
- Added Phase 66 JSDoc comment matching the style of surrounding optional fields (mirrors `widgets?` entry style)
- Forwarded `dynamicViews={dynamicViews}` into the `<Custom>` panel slot in `ChartConfigPanel.tsx`
- Zero behavior change for all existing panels (Timeline/DataFilter/Legend/Map) — prop is optional throughout

## Task Commits

1. **Task 1: Add dynamicViews to ConfigPanelProps and forward it through ChartConfigPanel** - `2626157` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `packages/web/src/components/charts/registry.ts` - Added `DynamicViewRow` to import; added `dynamicViews?: DynamicViewRow[]` to `ConfigPanelProps`
- `packages/web/src/components/charts/ChartConfigPanel.tsx` - Added `dynamicViews={dynamicViews}` to `<Custom>` JSX prop list

## Decisions Made
- `dynamicViews` is optional in `ConfigPanelProps` — existing panels ignore it without needing updates; this matches the pattern for `widgets?` and `tables?`
- Pre-existing TypeScript error (`estimateCalendarCells.spec.ts` cannot find module) was confirmed as pre-existing before my changes (from Phase 66-03 spec file created ahead of implementation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing `tsc --noEmit` error in `src/lib/estimateCalendarCells.spec.ts` (Phase 66-03 spec references a module not yet created). Confirmed pre-existing via `git stash` baseline check. Not caused by or related to these changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `ConfigPanelProps.dynamicViews` is now the canonical prop surface for passing the dashboard's dv list to any `CustomConfigPanel`
- `ChartConfigPanel` already forwards it — Plan 66-03 (`CalendarConfigPanel`) can consume `dynamicViews` from its props immediately
- No blockers for Phase 66-03

---
*Phase: 66-chart-type-definition-config-panel*
*Completed: 2026-06-16*
