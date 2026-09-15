---
phase: 117-dashboard-settings-links
plan: 01
subsystem: ui
tags: [react, history-api, deep-linking, dashboards, url-sync]

# Dependency graph
requires:
  - phase: 116-table-deep-links
    provides: "lib/tableUrl.ts's proven two-mode shape (setTableMode, mode-defaulted buildTableUrl) mirrored here for a third mode"
provides:
  - "DashboardMode = \"open\" | \"view\" | \"edit\" type in lib/dashboardUrl.ts"
  - "DASHBOARD_MODE_PARAM constant, readDashboardModeFromSearch reader"
  - "buildDashboardUrl/openDashboardUrl/restoreDashboardUrl each with a defaulted mode parameter, byte-identical bare-URL behavior preserved"
  - "setDashboardMode — the in-place mode writer, preserving window.history.state, ready for Plan 02's two call sites (DashboardDetail.onEdit and DashboardEdit.onSaved)"
  - "64-test lib/dashboardUrl.spec.ts (39 pre-existing + 25 new DSET-117 tests), 4 mutation probes run and reverted"
affects: [117-02-dashboardspage-wiring, 117-03, 117-04, 117-05, 117-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defaulted-parameter mode extension: add an optional 3rd/2nd param with the pre-existing behavior as its default, so every existing call site keeps compiling and behaving identically (mirrors 116's buildTableUrl exactly, with the absence-representing default swapped to \"open\")"
    - "Mode-preserving in-place writer: replaceState(window.history.state, ...) — never null, never a hardcoded marker — verified by two DIRECTION-SPECIFIC mutation probes that must fail on different tests"

key-files:
  created: []
  modified:
    - packages/web/src/lib/dashboardUrl.ts
    - packages/web/src/lib/dashboardUrl.spec.ts

key-decisions:
  - "openDashboardUrl 'pushes exactly ONE entry' is verified via a pushState call-count spy, not a raw window.history.length delta — a raw delta is corrupted in this file by an earlier test's dangling forward-history entry left behind by leaveDashboardUrl()'s async 'popped' branch (a jsdom session-history quirk, not an implementation bug). See 'Test-writing finding' below."
  - "Two Task-1 acceptance criteria (5 and 6, the window.history.state / replaceState(null grep counts) are toothless as written: the plan's own mandated setDashboardMode docstring (step 8's verbatim JSDoc) contains both literal substrings in prose, permanently inflating both counts by 1 beyond the plan's stated 'exactly 2'. Verified the real requirement directly instead (see below) rather than editing the mandated documentation to force the grep to read a different number."
  - "Criterion 4 of Task 2 (grep -c \"tableUrl\" -> 0) is also toothless: it is meant to prove no import from lib/tableUrl.ts, but matches doc-comment prose that names tableUrl.ts by cross-reference (which the plan itself requires elsewhere, e.g. Task 1's clearDashboardUrl comment). Verified the real requirement directly: zero import statements reference tableUrl anywhere in the file."

requirements-completed: []

# Metrics
duration: ~22min
completed: 2026-09-15
---

# Phase 117 Plan 01: Three-mode dashboard URL vocabulary Summary

**Extended `lib/dashboardUrl.ts` from a one-mode (`open`-only) URL module to a three-mode (`open`/`view`/`edit`) one via defaulted parameters, with 25 new tests and 4 reverted mutation probes proving the bare-URL default and both directions of marker preservation actually redden the suite when broken.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-09-15T13:39:00-04:00 (approx.)
- **Completed:** 2026-09-15T13:59:24-04:00
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `lib/dashboardUrl.ts` gained `DashboardMode`, `DASHBOARD_MODE_PARAM`, `readDashboardModeFromSearch`, and `setDashboardMode` — mirroring `lib/tableUrl.ts`'s already-shipped `setTableMode` shape exactly, including the "pass `window.history.state` through, never null, never hardcoded" discipline.
- `buildDashboardUrl`/`openDashboardUrl`/`restoreDashboardUrl` each gained a defaulted mode parameter (`"open"` is the default — the OPPOSITE absence-convention from tables' `"view"` default, by design and documented in the code).
- All 8 pre-existing 2-argument/1-argument call sites (3 inside the module, 5 in the spec, plus `DashboardsPage.tsx:240`'s `openDashboardUrl(dash.id)`) kept compiling and producing byte-identical output with **zero edits** — confirmed by the 39 pre-existing tests passing against an untouched-until-Task-2 spec file.
- `lib/dashboardUrl.spec.ts` extended from 39 to **64 passing tests** (25 new, all titled `DSET-117:`), covering all 24 required behaviour bullets plus one extra constant check.
- Four mandatory mutation probes run against the real implementation, their literal failure counts recorded, and the tree reverted to clean after each:
  - **Probe A (bare-URL default, "open"→"view"):** **4 failed** — 3 pre-existing `buildDashboardUrl` bare-path tests plus the new bullet-7 test (`(loc, 12)` no third argument). All redden correctly; the bare-URL guard IS guarding something.
  - **Probe B (marker preservation, null direction):** **2 failed** — bullets 20 (marker still true) and 22 (`leaveDashboardUrl` after `setDashboardMode` on a self-opened entry).
  - **Probe C (marker preservation, hardcoded-marker direction):** **2 failed** — bullets 21 (stays unmarked) and 22 (same `leaveDashboardUrl` test as Probe B).
  - **Probe D (unrecognised-mode fallback, "open"→"view"):** **4 failed** — bullets 1, 4, 5, 6.
  - Probes B and C fail on a shared test (22) plus one DIRECTION-SPECIFIC test each (20 vs. 21) — satisfying the plan's requirement that the two probes "must fail for DIFFERENT tests," since the failure sets are not identical.
- No table file touched (`git diff --name-only` over the table family: empty); `packages/server` diff: empty.

## Task Commits

1. **Task 1: Add the three-mode vocabulary to lib/dashboardUrl.ts** - `d5317ed` (feat)
2. **Task 2: Extend lib/dashboardUrl.spec.ts with mode coverage, the bare-URL guard and the collision record** - `8119ab6` (test)

_Note: both tasks were `tdd="true"`, but since Task 1 is itself the implementation the plan specified test coverage as a separate Task 2 (extending the existing spec in place per 117-RESEARCH §Q5) rather than a strict RED→GREEN pair — this matches the plan's own task structure._

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md are updated below)

## Files Created/Modified
- `packages/web/src/lib/dashboardUrl.ts` - Gained `DashboardMode`, `DASHBOARD_MODE_PARAM`, `readDashboardModeFromSearch`, `setDashboardMode`; three functions gained defaulted mode parameters; `clearDashboardUrl` gained a comment recording the accepted `?mode=` namespace collision with `lib/tableUrl.ts`.
- `packages/web/src/lib/dashboardUrl.spec.ts` - Gained 25 new `DSET-117:`-titled tests across 6 new `describe` blocks; no existing test edited or removed.

## Test Numbers (for Plan 06's arithmetic)

- `lib/dashboardUrl.spec.ts`: **39 → 64** (+25)
- Full suite (`npx vitest run`): baseline **175 files / 3902 tests** → **175 files / 3927 tests** (+25, no new spec file, matching expectation). 173 files pass clean; 2 files show 5 failures **only under full parallel scheduling** and pass 100% in isolation — see "Deviations" below. Neither failing file imports `dashboardUrl.ts` or `tableUrl.ts`.
- `theme-guard.spec.ts`: 150/150 passing, unaffected (no CSS/className touched).

## Decisions Made

- **`openDashboardUrl`'s "pushes exactly ONE entry" claim is verified via a `pushState` call-count spy, not a raw `window.history.length` delta.** Investigated a genuine test failure: a raw length-delta assertion (`lengthBefore + 1`) failed non-deterministically depending on test order, because an earlier test's `leaveDashboardUrl()` "popped" branch leaves the jsdom session-history POSITION behind the stack's top (its async `history.back()` moves the pointer but does not delete the resulting dangling forward entry). The very next `pushState` call in a later, unrelated test then truncates that stale forward entry and adds one — a net length delta of 0, not +1 — even though exactly one new entry was genuinely pushed. This is a jsdom/test-ordering artifact, not an implementation defect (confirmed: the `restoreDashboardUrl` "length UNCHANGED" assertions, which use `replaceState` and are immune to this truncation effect, all passed without issue). Switched the three `openDashboardUrl` push-count assertions to `vi.spyOn(window.history, "pushState")` + `toHaveBeenCalledTimes(1)`, which verifies the identical semantic ("exactly one push happened") without depending on absolute stack depth left over from prior tests.
- **Two Task 1 acceptance criteria (5, 6) and one Task 2 acceptance criterion (4) reported as non-discriminating rather than gamed** — see "Deviations from Plan" below for the full detail per CLAUDE.md's "Writing verifiable acceptance criteria" section.

## Deviations from Plan

### Toothless acceptance criteria found and reported (not gamed)

**1. Task 1 criterion 5 — `grep -c "window.history.state" lib/dashboardUrl.ts` expected "exactly 2", actual is 3.**
- **Found during:** Task 1, post-implementation verification.
- **Issue:** The plan's own step-8 mandated JSDoc for `setDashboardMode` (which I copied essentially verbatim, as instructed) contains the literal phrase `` `window.history.state` `` in its prose warning ("⚠️ `window.history.state` is passed THROUGH, deliberately..."). This is a THIRD line matching the pattern, on top of the pre-existing `leaveDashboardUrl` read (BEFORE: 1) and the new `setDashboardMode` implementation line (would-be AFTER: 2) — making the actual AFTER count 3, not the plan's predicted "exactly 2." This is precisely CLAUDE.md's named anti-pattern: "a plan anchoring a grep on prose the plan itself mandated in a comment."
- **Resolution:** Did NOT edit the mandated documentation (which is genuinely load-bearing — it records the exact Pitfall-1 reasoning the plan requires) merely to make the grep read 2. Verified the REAL requirement directly instead: read `lib/dashboardUrl.ts:157` and confirmed `setDashboardMode` passes `window.history.state` through (not `null`, not a hardcoded marker literal) — and confirmed this behaviorally via Mutation Probes B and C (Task 2), which reddened the suite in exactly the way a correct pass-through implementation should when broken in either direction.
- **Files affected:** none (no code change made for this finding).

**2. Task 1 criterion 6 — `grep -c "replaceState(null" lib/dashboardUrl.ts` expected "exactly 2", actual is 3 (after removing one avoidable extra match).**
- **Found during:** Task 1, post-implementation verification.
- **Issue:** Same root cause as #1 — the mandated `setDashboardMode` docstring also contains the literal substring `` replaceState(null, ...) `` in its warning prose. I did remove one AVOIDABLE extra match of my own creation (an editorial comment I'd added to `restoreDashboardUrl`'s docstring that also happened to contain this substring), reducing the count from 4 to 3, but the plan-mandated docstring's occurrence is irreducible without deleting content the plan explicitly requires.
- **Resolution:** Same as #1 — verified directly by reading the two real `replaceState(null, ...)` call sites (`clearDashboardUrl:129`, `restoreDashboardUrl:141`) are unchanged from before, and that `setDashboardMode` does NOT contain a third real `replaceState(null` call (Mutation Probe B proves this: forcing the code to actually call `replaceState(null, ...)` reddens 2 tests).
- **Files affected:** `packages/web/src/lib/dashboardUrl.ts` (removed one editorial line to reduce noise; no behavior change).

**3. Task 2 criterion 4 — `grep -c "tableUrl" dashboardUrl.spec.ts` expected 0, actual is 4.**
- **Found during:** Task 2, post-implementation verification.
- **Issue:** The criterion's stated intent is "must not import the table module." The actual matches are all doc-comment prose that names `lib/tableUrl.ts` by cross-reference (e.g., "Mirrors `lib/tableUrl.spec.ts`'s shapes; does NOT import anything from `lib/tableUrl.ts`") — exactly the kind of cross-referencing comment the plan itself mandates elsewhere (Task 1's `clearDashboardUrl` comment is explicitly required to point AT `tableUrl.ts`).
- **Resolution:** Verified the real requirement directly: `grep -n "^import"` on the spec file shows exactly 3 import statements (`vitest`, `@testing-library/react`, `./dashboardUrl`) — zero reference `tableUrl` in any form. The collision test (bullet 24) uses only raw query strings, as required.
- **Files affected:** none.

### Genuinely reddening mutation probes (not deviations, but recorded per plan instruction)

All four probes (A, B, C, D) DID redden the suite as required — see "Accomplishments" above for literal counts. No probe failed to redden; nothing to report as a non-firing guard.

---

**Total deviations:** 0 auto-fixed code changes (Rules 1-3 did not trigger); 3 toothless-criteria findings reported and verified directly per CLAUDE.md, with no code edited to game a grep; 1 test-robustness fix (pushState spy instead of a jsdom-fragile length delta) to make the mandated behaviour bullet 13-15 assertions correctly discriminating.
**Impact on plan:** No scope creep. All fixes were either documentation-preserving verifications or spec-only robustness improvements; the implementation itself matches the plan's action blocks essentially verbatim.

## Issues Encountered

- **jsdom session-history cross-test artifact** (detailed above under "Decisions Made") — resolved by switching to a `pushState` call-count spy for the three affected assertions. Confirmed via Mutation Probes A-D that the underlying implementation is correct; this was purely a test-authoring robustness issue, discovered and fixed within Task 2, before commit.
- **Full-suite run surfaced 5 pre-existing failures in 2 unrelated files** (`DatasetsPage.spec.tsx`, `actionEngine.canary.spec.tsx`) that occur ONLY under full parallel `npx vitest run` and pass 100% in isolation. Verified neither file imports `dashboardUrl.ts` or `tableUrl.ts`. This is the same class of issue as the repo's known "Web vitest parallel fake-timer leak" tech debt. Logged to `.planning/phases/117-dashboard-settings-links/deferred-items.md` per the scope-boundary rule (out of scope for this plan's files) — not fixed here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `lib/dashboardUrl.ts` now exports everything Plan 02 needs: `DashboardMode`, `readDashboardModeFromSearch`, and `setDashboardMode` (ready for its two call sites in `DashboardsPage.tsx` — `DashboardDetail.onEdit` and `DashboardEdit.onSaved`, per 117-RESEARCH §Q2/Q3).
- `openDashboardUrl`/`restoreDashboardUrl` are ready to be called with a mode argument from `DashboardsPage.tsx`'s remaining 11 URL-touching transitions (Q2's table).
- No blockers. No DSET requirement marked complete by this plan — Plans 02-06 remain, as required by this plan's success criteria.
- Deferred: the pre-existing parallel-scheduling test contamination noted above should be picked up by whichever phase eventually addresses `TD-V16`-class test-isolation debt; not blocking for Plan 02.

## Self-Check: PASSED

- FOUND: packages/web/src/lib/dashboardUrl.ts
- FOUND: packages/web/src/lib/dashboardUrl.spec.ts
- FOUND: .planning/phases/117-dashboard-settings-links/117-01-SUMMARY.md
- FOUND commit: d5317ed
- FOUND commit: 8119ab6

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
