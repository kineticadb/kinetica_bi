---
phase: 70-numeric-other-bucket
plan: 01
subsystem: ui
tags: [class-break, wms, cb_config, numeric-other-bucket, react, vitest]

# Dependency graph
requires:
  - phase: 39-classbreak-config
    provides: categorical <other> sink-bucket (CB-V17-04), CbBreak/CbConfig shape, createDefaultBreak, PALETTE_COLORS, cb-other-chip render
  - phase: 38-wms-cb-raster
    provides: Lane C cb_raster CB_VALS emission (numeric lo:hi vs categorical verbatim ternary)
provides:
  - Numeric class-break CB_VALS emits the literal <other> catch-all token after the ranges (1:3,3:5,<other>)
  - <other> toggle surfaced for numeric mode (default-ON for new/column-changed configs)
  - Numeric <other> row whitelisted in min<max validation; renders as read-only cb-other-chip
  - Regression test locking the preservation invariant (no <other> auto-injection)
affects: [71-shape-latlon-hiding, 72-group-by-timeline-numeric-line, 73-verification-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Numeric mirror of categorical <other>: same b.value === '<other>' identification check, reused onToggleOtherBucket / cb-other-chip / column-change default-on"
    - "Shared (valsType-agnostic) toggle block gated on cbConfig.attr !== '' — single render across both modes"

key-files:
  created: []
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/components/charts/CbConfigForm.tsx
    - packages/web/src/components/charts/CbConfigForm.spec.tsx

key-decisions:
  - "Numeric CB_VALS .map emits literal '<other>' for the <other> break, else `${min}:${max}` — no pre-encoding (URLSearchParams handles %3Cother%3E)"
  - "Column-change default-on broadened from categorical-only to BOTH valsTypes (typeChanged guard)"
  - "Toggle + NULL hint MOVED (not copied) out of the categorical-only gate into a shared cbConfig.attr-gated block — renders exactly once per mode"
  - "onToggleOtherBucket passes the real cbConfig.valsType into createDefaultBreak (cleanliness; min/max unused for the chip row)"
  - "Builder + coalesceCbConfig do NOT auto-inject <other> — preservation invariant locked by regression test (CBOTHER-V114-02)"

patterns-established:
  - "Preservation regression test: assert byte-identical CB_VALS AND .not.toContain('<other>') for a config without an <other> break"

requirements-completed: [CBOTHER-V114-01, CBOTHER-V114-02, CBOTHER-V114-03]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 70 Plan 01: Numeric `<other>` Catch-All Bucket Summary

**Numeric class-break configs now emit the literal `<other>` token after their ranges (`1:3,3:5,<other>`), with the toggle surfaced + default-ON for numeric mode, the `<other>` row rendered as a read-only chip, validation whitelisting it, and a regression test locking the no-auto-injection preservation invariant.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-18T15:32:43Z
- **Completed:** 2026-06-18T15:36:44Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Numeric `CB_VALS` builder emits the literal `<other>` token for the `<other>` break, mirroring the categorical identification check; POINTCOLORS stays positionally aligned (N+1) with zero special-casing.
- `<other>` bucket toggle now renders in numeric mode (relocated to a shared block — exactly one toggle per mode), default-ON when a column is switched to numeric, with the NULL hint shown when OFF.
- Numeric `<other>` row whitelisted in min<max validation and renders as the read-only `cb-other-chip` (no min/max inputs) with its own palette color.
- Preservation invariant (CBOTHER-V114-02) locked by a regression test: a numeric config with no `<other>` break emits byte-identical `CB_VALS` and no `<other>` substring.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: Numeric `<other>` CB_VALS emission + preservation lock**
   - `c9ff170` (test — RED: failing numeric-emit + preservation tests)
   - `7425023` (feat — GREEN: numeric ternary arm emits literal `<other>`)
2. **Task 2: Surface toggle for numeric + default-on + validation whitelist**
   - `21c7f64` (test — RED: numeric-render + default-on + validity; retire stale NOT-rendered test)
   - `d417d5b` (feat — GREEN: typeChanged guard broadened, toggle moved to shared block, numeric validation whitelist)
3. **Task 3: Full-suite + tsc + theme-guard gates** — no production edits (gate verification only; all green)

**Plan metadata:** committed separately with SUMMARY.md / STATE.md / ROADMAP.md.

## Files Created/Modified
- `packages/web/src/lib/wmsUrlBuilder.ts` — numeric `CB_VALS` `.map` now emits `"<other>"` for the `<other>` break, else `min:max`.
- `packages/web/src/lib/wmsUrlBuilder.spec.ts` — added numeric-`<other>`-emission test + preservation regression test (`.not.toContain("<other>")`).
- `packages/web/src/components/charts/CbConfigForm.tsx` — `typeChanged` default-on broadened to both valsTypes; toggle + NULL hint relocated to a shared `cbConfig.attr`-gated block; numeric validation whitelists `<other>`; `onToggleOtherBucket` passes real valsType into `createDefaultBreak`.
- `packages/web/src/components/charts/CbConfigForm.spec.tsx` — retired stale "in numeric mode … NOT rendered" test; added numeric-render-positive, categorical single-render guard, switch-to-numeric default-on, numeric read-only chip, and numeric `<other>` `isValid(true)` tests.

## Decisions Made
- Followed the plan and CONTEXT exactly: emit raw `<other>` (no pre-encoding); broaden the column-change default-on to both valsTypes; move (not copy) the toggle to a shared block; whitelist `<other>` in numeric validation.
- Exercised the CONTEXT discretion note to pass `cbConfig.valsType` into `createDefaultBreak` inside `onToggleOtherBucket` (cosmetic — min/max unused for the chip row).

## Deviations from Plan

None - plan executed exactly as written. The only added wrapper element was a `cb-other-section` div around the relocated toggle/hint (no new CSS or hex — `git diff packages/web/src/styles/global.css` is empty); the class is purely a structural grouping consistent with the prior `cb-categorical-section` wrapper.

## Issues Encountered
None. The RED phase behaved as expected: Task 1's numeric-emit test failed while the preservation test passed pre-change (confirming no prior auto-injection); Task 2's numeric-render + default-on + validity tests failed pre-change while the chip-render test already passed (the chip render was already valsType-agnostic).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 70 complete: frontend vitest 100% (104 files / 2383 tests), web + server tsc clean (separate gates), theme-guard green (50/50), zero server diff.
- Phases 71 (SHAPE* hiding) and 72 (group-by) are independent and unblocked.
- Note for re-save / round-trip verification: numeric `<other>` is opt-in at creation/column-change only; already-saved numeric layers with no `<other>` row remain untouched until re-saved (verified by the preservation regression test) — relevant context for Phase 73 live UAT.

## Self-Check: PASSED

All 4 modified source files exist; SUMMARY.md exists; all 4 task commits (c9ff170, 7425023, 21c7f64, d417d5b) present in git log.

---
*Phase: 70-numeric-other-bucket*
*Completed: 2026-06-18*
