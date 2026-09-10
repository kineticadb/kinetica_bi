---
phase: 97-calendar-smart-domain-control
plan: 02
subsystem: ui
tags: [react, calendar, smart-mode, controlMode, viewer-control-bar, backward-compat]

# Dependency graph
requires:
  - phase: 97-01
    provides: controlMode/smartScale/allowedSmartScales fields on CalendarConfig + SMART_SCALE_TO_PAIR mapping
provides:
  - controlMode-aware suppression of the viewer control bar in CalendarRenderer (smart mode → no live grouping dropdowns)
  - Backward-compat lock: absent controlMode → "advanced" → control bar behavior byte-identical to pre-Phase-97
affects:
  - packages/web/src/components/charts/CalendarRenderer.tsx (5-line cfg-coalescing change)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "controlMode coalescing: cfg.controlMode ?? 'advanced' — safe default for all existing calendars"
    - "showControls gated on controlMode === 'advanced' AND showDomainSubdomainControls — single expression"
    - "TDD: RED (failing spec committed) → GREEN (implementation) → full-suite green"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx

key-decisions:
  - "Gate showControls on controlMode === 'advanced' (not smart) — one expression, no render-path change"
  - "Absent controlMode coalesces to 'advanced' — zero change to existing calendar configs (backward-compat)"
  - "INVARIANT preserved: CalendarRenderer imports no materializeFilter/dropFilterView/fromSwap"

# Metrics
duration: 2min
completed: 2026-06-30
---

# Phase 97 Plan 02: CalendarRenderer Smart-Mode Control-Bar Gate Summary

**controlMode-aware showControls gate added to CalendarRenderer — smart mode suppresses the viewer-live grouping control bar; advanced/absent mode keeps it; backward-compat locked by test**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-30T19:48:46Z
- **Completed:** 2026-06-30T19:50:51Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Added `controlMode = cfg.controlMode ?? "advanced"` to CalendarRenderer's cfg-coalescing block (line 120); rewrote `showControls` as `controlMode === "advanced" && (cfg.showDomainSubdomainControls ?? false)` — one expression, no render/layout/SQL change
- Smart-mode calendars now render fixed at the domain+subdomain written by SMART_SCALE_TO_PAIR (Plan 01) with the viewer-live grouping control bar suppressed
- Backward-compat locked by explicit Test P97-3: absent controlMode + showDomainSubdomainControls ON → control bar present (byte-identical to pre-Phase-97 behavior)
- Added 4 new spec assertions in `describe("CalendarRenderer — smart mode (Phase 97)")` covering all mode combinations + the SMART_SCALE_TO_PAIR.week pair (month/week) grid render
- Static-source invariant (Test 0) still green: no materializeFilter/dropFilterView/fromSwap in import lines

## Task Commits

Each phase committed atomically (TDD pattern):

1. **RED — failing smart-mode suppression tests** - `fc29b38` (test)
2. **GREEN — gate viewer control bar to advanced mode** - `e877a44` (feat)

## Files Created/Modified

- `packages/web/src/components/charts/CalendarRenderer.tsx` — Added `controlMode` coalesce + gated `showControls` on `controlMode === "advanced"` (5 lines changed in cfg-coalescing block)
- `packages/web/src/components/charts/CalendarRenderer.spec.tsx` — Added `describe("CalendarRenderer — smart mode (Phase 97)")` with 4 tests (P97-1 through P97-4) including explicit backward-compat lock comment for success criterion 4

## Decisions Made

- Gate `showControls` on `controlMode === "advanced"` rather than `!== "smart"` — explicit positive check makes the intent clear and is robust if a third mode is ever introduced
- No render/layout/SQL change needed — Plan 01 already writes the mapped domain+subdomain into config via SMART_SCALE_TO_PAIR, so the renderer consumes the correct pair as-is

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. All tests green (49/49 in CalendarRenderer.spec.tsx; 3020/3020 full suite), tsc clean, theme-guard green, invariant check passed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 97 is complete: CALSMART-V119-01 (mode separation), CALSMART-V119-02 (renderer uses mapped pair), and CALSMART-V119-03 (config panel UI) are all fulfilled
- Phase 98 (Per-Visualization Custom WHERE Clause) is independent and can proceed immediately

---

## Self-Check: PASSED

- CalendarRenderer.tsx: FOUND
- CalendarRenderer.spec.tsx: FOUND
- 97-02-SUMMARY.md: FOUND
- Commit fc29b38 (RED): FOUND
- Commit e877a44 (GREEN): FOUND
