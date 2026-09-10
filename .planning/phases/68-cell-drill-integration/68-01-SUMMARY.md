---
phase: 68-cell-drill-integration
plan: 01
subsystem: ui
tags: [chip-text, datetime, calendar, filter, columnTypes]

# Dependency graph
requires:
  - phase: 65-calendar-sql-builder
    provides: computeCellBounds returning [cellStartIso, cellEnd=nextBucketStart-1ms]
  - phase: 44-filter-chips
    provides: buildChipText with between/in/eq operator dispatch
provides:
  - buildChipText datetime-between branch renders human-readable inclusive range
  - formatDatetimeRange helper (pure UTC, no imports) in columnTypes.ts
affects:
  - 68-cell-drill-integration (plan 68-02 writes between filters whose chips use this)
  - 69-verification — UAT chip copy assertions

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "formatDatetimeRange: UTC getters only (getUTCFullYear/Month/Date/Hours), never local getters"
    - "Inclusive human end: hi day/hour that CONTAINS hiMs, not the artificial nextBucketStart"
    - "sameDay detection gates single-date collapse before sub-day hour logic"
    - "En-dash U+2013 as range separator (matching chip-copy spec)"

key-files:
  created: []
  modified:
    - packages/web/src/lib/columnTypes.ts
    - packages/web/src/lib/columnTypes.spec.ts

key-decisions:
  - "formatDatetimeRange is a private helper in columnTypes.ts — no new imports, pure string logic"
  - "sameDay check precedes the sub-day branch so full-day cells (00:00→23:59:59.999) collapse to date-only, not hour range"
  - "Numeric/string between paths are verbatim unchanged — only dataType=datetime arm is enhanced"
  - "Single-hour cell (rangeMs < 1h): format as 'Mon D, YYYY HH:00' (collapsed, no en-dash)"

patterns-established:
  - "Pattern: datetime-between chip formatting lives exclusively in buildChipText/formatDatetimeRange — single source of truth for ALL datetime-between chips (calendar AND timeline drag)"

requirements-completed: [CALDR-V113-01]

# Metrics
duration: 2min
completed: 2026-06-16
---

# Phase 68 Plan 01: Human-readable datetime-between chip range Summary

**formatDatetimeRange helper in columnTypes.ts formats datetime BETWEEN filters as inclusive human ranges (e.g. "Mar 2 – Mar 8, 2026") instead of raw ISO strings, benefiting all datetime-between chips**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-16T18:09:05Z
- **Completed:** 2026-06-16T18:11:04Z
- **Tasks:** 1 (TDD: 2 commits — RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Added `formatDatetimeRange(loIso, hiIso): string` pure helper (UTC getters, no imports, no React)
- Wired it into the `between` branch of `buildChipText` when `dataType === "datetime"`
- Week-range chip now shows "Mar 2 – Mar 8, 2026" with en-dash; no ISO T/Z substrings
- Single-day range collapses to "Mar 3, 2026" (no en-dash separator)
- Hour-granularity range shows "Mar 3, 2026 14:00"
- All numeric/string between and eq datetime paths are unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing datetime-between chip specs** - `9761aa7` (test)
2. **Task 1 GREEN: implement formatDatetimeRange** - `b6579ab` (feat)

**Plan metadata:** (docs commit — see below)

_Note: TDD task has two commits (RED test → GREEN implementation)_

## Files Created/Modified
- `packages/web/src/lib/columnTypes.ts` — Added `MONTH_NAMES` constant, `formatDatetimeRange` helper (~75 lines), wired into between branch
- `packages/web/src/lib/columnTypes.spec.ts` — Added 5 new datetime-between assertions; replaced old raw-value spec with human-readable assertions

## Decisions Made
- Single-day detection (`sameDay`) precedes sub-day hour logic to ensure full-day cells (00:00 → 23:59:59.999) collapse to date-only, not an awkward "00:00 – 23:00" hour range.
- `formatDatetimeRange` is a module-private function (no export) — it has no callers outside `buildChipText` and doesn't need to be part of the public API.

## Deviations from Plan

None — plan executed exactly as written. TDD RED→GREEN flow followed as specified.

## Issues Encountered

Initial GREEN run had 1 failing test: single-day range showed "Mar 3, 2026 00:00 – 23:00" instead of collapsing. Root cause: the sub-day branch checked `rangeMs < 24h` before the `sameDay` check, so a full-day cell (23h 59m 59.999s span) matched sub-day logic. Fix: restructured to check `sameDay` first (Day 1 of logic tree), then inside sameDay check if partial-day (non-zero/non-23 hours) vs full-day. Fixed in the same GREEN commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- `buildChipText` is ready for Plan 68-02 (cell-click dispatch) to write `between` datetime filters whose chips will display correctly
- `formatDatetimeRange` handles week/day/hour granularities from `computeCellBounds`
- No blockers

---
*Phase: 68-cell-drill-integration*
*Completed: 2026-06-16*
