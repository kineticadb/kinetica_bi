---
phase: 97-calendar-smart-domain-control
plan: 01
subsystem: ui
tags: [react, calendar, config-panel, smart-mode, domain-subdomain]

# Dependency graph
requires:
  - phase: 65-calendar-sql-builder-kinetica-spike
    provides: calendarBin.ts with VALID_DOMAIN_SUBDOMAIN, isValidCombo, computeCellBounds
  - phase: 66-chart-type-definition-config-panel
    provides: CalendarConfigPanel.tsx with domain/subdomain two-dropdown UI
provides:
  - SmartScale type + SMART_SCALES list + SMART_SCALE_TO_PAIR mapping in calendarBin.ts (single source of truth)
  - controlMode/smartScale/allowedSmartScales optional fields on CalendarConfig
  - Mode-branched config panel UI (advanced=two-dropdown, smart=single Time scale dropdown + allowed-scales checkboxes)
  - Backward-compat: absent controlMode coalesces to "advanced" — existing calendars byte-identical
affects:
  - 97-02 (plan 02 — renderer may read controlMode; uses domain+subdomain as-is, no special-casing needed)
  - definitions/calendar.ts (spreads DEFAULT_CALENDAR_CONFIG, inherits new fields automatically)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "smart-mode writes mapped domain+subdomain into config via SMART_SCALE_TO_PAIR; renderer is unchanged"
    - "optional config fields default-safe: absent → legacy behavior via ?? coalescing"
    - "TDD: RED (failing spec) → GREEN (implementation) → verify gates"

key-files:
  created: []
  modified:
    - packages/web/src/lib/calendarBin.ts
    - packages/web/src/lib/calendarBin.spec.ts
    - packages/web/src/components/charts/CalendarConfigPanel.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.spec.tsx

key-decisions:
  - "Smart mode writes domain+subdomain into config (renderer unchanged) — not a new render path"
  - "SMART_SCALE_TO_PAIR is the SINGLE SOURCE OF TRUTH for the smart→pair mapping in calendarBin.ts"
  - "controlMode absent → coalesces to 'advanced' — zero change to existing calendar configs"
  - "toggleAllowedScale enforces ≥1: last remaining allowed scale cannot be unchecked (onChange not called)"
  - "allowedSmartScales builds from SMART_SCALES.filter to keep canonical coarsest→finest order"

patterns-established:
  - "Smart-scale UI branch: controlMode===smart renders Time scale <select> + checkbox group; controlMode===advanced (default) renders original Domain+Subdomain selects"
  - "New optional CalendarConfig fields use ?? coalescing against DEFAULT_CALENDAR_CONFIG"

requirements-completed:
  - CALSMART-V119-01
  - CALSMART-V119-02
  - CALSMART-V119-03

# Metrics
duration: 7min
completed: 2026-06-30
---

# Phase 97 Plan 01: Calendar Smart Domain Control Summary

**SmartScale type + SMART_SCALE_TO_PAIR mapping added to calendarBin.ts; CalendarConfigPanel gains controlMode/smartScale/allowedSmartScales with mode-branched UI (advanced=two-dropdown, smart=single Time-scale picker with ≥1-enforced allowed-scales checkboxes)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-30T19:38:51Z
- **Completed:** 2026-06-30T19:45:57Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Exported SmartScale, SMART_SCALES, SMART_SCALE_TO_PAIR from calendarBin.ts as the single source of truth for the month→year/month, week→month/week, day→month/day, hour→day/hour mapping; all four pairs are valid combos in VALID_DOMAIN_SUBDOMAIN (test-locked in 6 new spec assertions)
- Added controlMode/smartScale/allowedSmartScales optional fields to CalendarConfig with backward-safe defaults; absent controlMode coalesces to "advanced" so existing calendars are byte-identical
- Added mode-branched config panel UI: advanced mode shows original Domain+Subdomain dropdowns (unchanged); smart mode shows a single "Time scale" select + ALLOWED TIME SCALES checkbox group with ≥1 enforcement; selecting a smart scale writes the mapped domain+subdomain pair into config so the renderer needs no changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add smart→pair mapping source-of-truth to calendarBin.ts** - `7bbfda4` (feat)
2. **Task 2: Add controlMode/smartScale/allowedSmartScales config fields + mode-branched panel UI** - `0bc4e87` (feat)

**Plan metadata:** (docs commit below)

_Note: Both tasks used TDD — failing spec committed before implementation_

## Files Created/Modified

- `packages/web/src/lib/calendarBin.ts` - Added SmartScale type, SMART_SCALES list, SMART_SCALE_TO_PAIR mapping (after isValidCombo, before CELL_LIMIT)
- `packages/web/src/lib/calendarBin.spec.ts` - Added `describe("calendarBin — smart scale mapping (Phase 97)")` with 6 assertions covering all pairs + isValidCombo loop
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` - Added 3 new optional fields to CalendarConfig, defaults, coalescing, 2 new handlers, mode-branched UI
- `packages/web/src/components/charts/CalendarConfigPanel.spec.tsx` - Added `describe("CalendarConfigPanel — smart mode (Phase 97)")` with 10 assertions covering all behaviors

## Decisions Made

- Smart mode writes domain+subdomain into config at selection time; renderer reads domain+subdomain as-is with no special-casing — cleanest separation of config UI from render logic
- SMART_SCALE_TO_PAIR lives in calendarBin.ts (the pure lib) so config panel, renderer, and tests share one import with no circular deps
- controlMode absent → coalesces to "advanced" (not "smart") — guarantees existing calendars are byte-identical to pre-Phase 97 behavior (CALSMART-V119-01)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All tests green, tsc clean, theme-guard green, invariant check passed (no materializeFilter/dropFilterView/fromSwap in modified files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 97 Plan 02 can now read `controlMode`, `smartScale`, and `allowedSmartScales` from CalendarConfig; the renderer receives the already-mapped `domain`+`subdomain` values and needs no special smart-mode branching
- All three CALSMART-V119-0x requirements are fulfilled by this plan

---
*Phase: 97-calendar-smart-domain-control*
*Completed: 2026-06-30*
