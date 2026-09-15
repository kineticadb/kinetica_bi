---
phase: 117-dashboard-settings-links
plan: 03
subsystem: ui
tags: [react, history-api, deep-linking, dashboards, url-sync, mutation-testing]

# Dependency graph
requires:
  - phase: 117-dashboard-settings-links (plan 02)
    provides: "All twelve in-component DashboardsPage.tsx mode transitions wired to the three-mode URL vocabulary, including the two in-place setDashboardMode call sites (view->edit, edit->view)"
provides:
  - "detailClearUrlTimer (DashboardDetail) and editClearUrlTimer (DashboardEdit): two deferred, StrictMode-safe, auth-guarded, id-AND-mode-scoped unmount-clear timers"
  - "The correction to 117-RESEARCH.md §Q3's id-only guard sketch, proved by two mutation probes"
  - "9 new DSET-117 tests + 4 mutation probes (A/B/C/D) run and reverted"
affects: [117-04-app-mode-threading, 117-05, 117-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two small, self-contained useRef+useEffect unmount-clear timers, deliberately NOT folded into DashboardOpen's existing 13-store-reset effect — mirrors the shape but not the entanglement"
    - "Id-AND-mode-scoped unmount guard: readDashboardIdFromSearch(...) !== openedId short-circuits on identity, readDashboardModeFromSearch(...) !== capturedMode short-circuits on an in-place transition that already rewrote the bar — both checks required, proved independently by probes B/C"

key-files:
  created: []
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.urlsync.spec.tsx

key-decisions:
  - "Corrected 117-RESEARCH.md §Q3's timer sketch, which guards on id alone. An id-only guard would wipe the URL an in-place view<->edit transition just wrote, one macrotask after the outgoing screen unmounts. Each new timer additionally checks the captured mode against the CURRENT bar's mode before clearing."
  - "Toothless acceptance criterion found and verified directly, not gamed: Task 1 criterion 6 (`grep -o \"clearUrlTimer\" ... | wc -l` -> expected >=15 AFTER) is written with a lowercase-c pattern that cannot match the new `detailClearUrlTimer`/`editClearUrlTimer` identifiers (capital C). The literal grep reads 5 both BEFORE and AFTER. Verified the real requirement with a case-insensitive count (15, matching the criterion's intent) rather than renaming the new refs to force the literal grep to pass."
  - "One shared failing test between mutation Probes B and C (a pre-existing Plan 02 composite test exercising both transitions in one flow) does not violate the discrimination rule: each probe has 3 of 4 failures UNIQUE to it, including the specific bullet-5/bullet-6 tests this plan wrote to hold the correction in place."
  - "A full-suite failure in App.tableDeeplink.spec.tsx (table family, off-limits) was investigated rather than assumed pre-existing or caused-by-this-plan: reproduced the SAME single failure at the pre-Plan-03 baseline commit (d810801) under full-suite load, and it passes 12/12 in isolation at both commits. Confirmed non-deterministic-under-parallel-load per the phase's own deferred-items.md precedent, not a regression."

requirements-completed: [DSET-V122-06]

# Metrics
duration: ~25min
completed: 2026-09-15
---

# Phase 117 Plan 03: Dashboard settings/edit unmount-clear timers Summary

**Added two small, id-AND-mode-scoped deferred unmount-clear timers to `DashboardDetail`/`DashboardEdit` — closing the one gap `117-RESEARCH.md` named but sketched with a guard that would have broken Plan 02's in-place view↔edit transitions — and proved the mode half of the guard load-bearing with two directional mutation probes.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-15T18:38:00Z (approx.)
- **Completed:** 2026-09-15T19:01:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 production, 1 spec)

## Accomplishments

- `DashboardDetail` gained `detailClearUrlTimer`: a deferred (`setTimeout(..., 0)`), StrictMode-safe (cancels on re-mount), auth-guarded (`useAuthStore.getState().status !== "authenticated"` bails), id-scoped (`readDashboardIdFromSearch(...) !== openedId` bails) unmount-clear effect that ALSO bails when `readDashboardModeFromSearch(...) !== "view"` — the correction that makes an in-app Edit click (which unmounts `DashboardDetail` while the bar is rewritten to `mode=edit`) survive the outgoing screen's own timer.
- `DashboardEdit` gained the mirror-image `editClearUrlTimer`, guarding on `mode === "edit"`, so an after-Save `edit→view` transition survives.
- Neither timer touches `DashboardOpen`'s existing 13-store-reset effect (verified: zero diff on `useMapCurrentViewStore`/`useFilterCombinationStore`/`useCustomMetricsStore` across the whole plan).
- `DashboardsPage.urlsync.spec.tsx` grew from 32 to 43 tests: 9 new `DSET-117:`-titled tests (up from 22 to 32 `DSET-117:` occurrences by string count, since two of the 9 titles reuse the prefix once each internally is not the case — 9 new `it()` blocks) covering both genuine-leave clears, both 401-teardown non-clears, both in-place-transition-survives-unmount cases (the two tests this plan cares about most), a StrictMode double-invoke, a stale-timer-vs-different-dashboard guard, and a `DashboardOpen` regression check.
- Four mutation probes run against the real implementation and reverted, each restoring the file to a byte-identical state (`git diff --stat` empty after every revert):
  - **Probe A** (delete `clearDashboardUrl()` from `DashboardDetail`'s timer): **1 failed** — "unmounting the page while the settings screen is open clears the address bar" (bullet 1).
  - **Probe B** (delete the mode guard from `DashboardEdit`'s timer — i.e. reduce it to exactly `117-RESEARCH.md` §Q3's id-only sketch): **4 failed**, including the specific target test "saving from the edit screen leaves ?mode=view in the bar after the deferred macrotask, and the settings screen stays rendered" (bullet 5) — **confirmed reddening, exactly as the plan's warning predicted for the uncorrected sketch.**
  - **Probe C** (delete the mode guard from `DashboardDetail`'s timer, the opposite direction): **4 failed**, including "clicking the in-app Edit button leaves ?mode=edit in the bar after the deferred macrotask, and the edit screen stays rendered" (bullet 6).
  - **Probe D** (delete the 401 guard from `DashboardDetail`'s timer): **1 failed** — "unmounting the settings screen after the session ended leaves the param alone" (bullet 3).
  - Probes B and C share exactly one failing test (a pre-existing Plan 02 composite test exercising both transitions in sequence); each has 3 of its 4 failures unique to it, including the bullet-5/bullet-6 tests written specifically to hold this correction in place — the discrimination this plan's own warning demands.
- Full suite: **175 files / 3957 tests, 100% green** (baseline after Plan 02 was 3948; net +9, exactly the new describe block's size). `theme-guard.spec.ts`: 150/150 green. Table family diff across the whole plan (`tableUrl.ts`, `useDeepLinkTable.ts`, `DatasetsPage.tsx`, `DatasetsPage.urlsync.spec.tsx`, `tableUrl.spec.ts`, `useDeepLinkTable.spec.ts`, `App.tsx`): empty. `packages/server` diff: empty.

## Task Commits

1. **Task 1: Add id-and-mode-scoped deferred unmount-clear timers to DashboardDetail and DashboardEdit** - `9c6a158` (feat)
2. **Task 2: Cover the unmount clears, and prove the in-place transitions survive them** - `d62ef24` (test)

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md are updated below)

## Files Created/Modified

- `packages/web/src/components/DashboardsPage.tsx` - `DashboardDetail` and `DashboardEdit` each gained a small `useRef`+`useEffect` deferred unmount-clear timer, id-and-mode-scoped, guarded on auth status. `DashboardOpen`'s existing timer and its 13-store reset effect are untouched (verified by grep and full diff review).
- `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` - New fourth `describe` block ("DashboardsPage settings/edit unmount-clear (Phase 117 Plan 03)") with 9 `DSET-117:` tests; four mutation probes run and reverted.

## Decisions Made

- **Kept the two timers as separate, small effects — not folded into `DashboardOpen`'s timer or into each other.** Per the plan's scope fence and 117-RESEARCH's own anti-pattern warning: `DashboardOpen`'s effect is entangled with a 13-Zustand-store reset unrelated to URL cleanup, and `DashboardDetail`/`DashboardEdit` are separate components with separate lifetimes.
- **The guard is id-AND-mode-scoped, not id-only.** This is the plan's central correction to `117-RESEARCH.md` §Q3's sketch. Verified with two directional mutation probes (B and C), both of which reddened their target tests when the mode check was removed.
- **Reported, not gamed, a toothless acceptance criterion.** Task 1's criterion 6 grep (`grep -o "clearUrlTimer"`, lowercase) cannot discriminate before/after because the new identifiers (`detailClearUrlTimer`, `editClearUrlTimer`) use a capital C, not the pattern's lowercase c — the literal command reads 5 both before and after. Verified the real requirement directly with a case-insensitive count (15, matching the criterion's evident intent) instead of renaming the refs to satisfy the broken grep.
- **Investigated rather than assumed a full-suite `App.tableDeeplink.spec.tsx` failure.** It appeared once, then again on a fresh full-suite run at HEAD, then a third time reproduced at the pre-Plan-03 baseline commit under full-suite load — but passed 12/12 in isolation at every commit tested. Concluded non-deterministic-under-parallel-load (the same class as `deferred-items.md`'s documented `DatasetsPage.spec.tsx`/`actionEngine.canary.spec.tsx` flakes from 117-01), not a regression this plan introduced. No table file was touched by this plan (confirmed by an empty `git diff --name-only` across the whole table family, `d810801`..`HEAD`).

## Deviations from Plan

### Toothless acceptance criteria found and reported (not gamed)

**1. Task 1 criterion 6 — `grep -o "clearUrlTimer" components/DashboardsPage.tsx | wc -l` expected ">= 15" AFTER, actual is 5.**
- **Found during:** Task 1, post-implementation verification.
- **Issue:** The criterion's own AFTER-count text says the new refs' names "both end in `ClearUrlTimer`" (capital C) but the grep pattern itself is lowercase `clearUrlTimer`. Since `detailClearUrlTimer`/`editClearUrlTimer` have a capital C where the pattern has lowercase c, the case-sensitive literal grep matches only `DashboardOpen`'s own 5 pre-existing occurrences, unchanged, both before and after this plan's work.
- **Resolution:** Verified directly with `grep -io "clearUrlTimer" ... | wc -l` → 15 (5 original + 5 each for the two new refs), matching the criterion's evident intent exactly. Did not rename `detailClearUrlTimer`/`editClearUrlTimer` to force the literal case-sensitive grep to read 15.
- **Files affected:** none (no code change made for this finding).

### Non-blocking investigation (Rule 3-adjacent — confirmed NOT a regression, no fix needed)

**2. Full-suite run intermittently reddens `App.tableDeeplink.spec.tsx`'s "unavailable dashboard-wins-precedence" test.**
- **Found during:** Task 2's full-suite verification (occurred on 2 of 3 full-suite runs at HEAD).
- **Issue:** `expect(screen.getByTestId("page-datasets")).toBeInTheDocument()` intermittently fails to find the element under heavy parallel scheduling (runs took 107-152s against a ~40-70s norm for this suite).
- **Investigation:** The test passes 12/12 every time it is run in isolation, at both HEAD and the pre-Plan-03 baseline commit (`d810801`). Reproduced the SAME single failure running the FULL suite at the baseline commit's content (checked out temporarily, then restored via `git checkout d62ef24 -- .`, confirmed byte-identical restore via clean `git status`). This rules out both "pre-existing, unaffected" (asserted without testing) and "caused by this plan" (this plan touches zero table files) — it is a transient, load-dependent flake in the same class `.planning/phases/117-dashboard-settings-links/deferred-items.md` already documents for two OTHER files from 117-01.
- **Resolution:** No code change. Logged here per this plan's own gate note ("if unrelated tests fail: re-run before concluding anything") rather than assumed away.
- **Files affected:** none.

---

**Total deviations:** 0 code changes made to game a grep (1 toothless-criterion finding reported and verified directly); 0 blocking fixes required; 1 non-blocking flake investigated and confirmed pre-existing-and-non-deterministic, not a regression.
**Impact on plan:** None — both findings were verified directly rather than worked around, and neither required any code change.

## Issues Encountered

- See Deviation #2 above (the `App.tableDeeplink.spec.tsx` flake) — fully investigated, confirmed not caused by this plan, no action taken per the phase's own deferred-items.md precedent.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `DashboardsPage.tsx` now clears its address bar correctly on every genuine leave from `view`/`edit`/`open`, and correctly does NOT clear it on either direction of the in-place `view<->edit` transition — DSET-V122-06 is complete.
- Plan 04 (App-side mode threading, replacing `App.tsx`'s `mode: "open" as const` literal with `deepLink.mode`) can proceed without any further changes to `DashboardsPage.tsx`'s unmount behavior.
- No blockers. Per this plan's own success criteria, only DSET-V122-06 is marked complete — no other DSET requirement is touched.

## Self-Check: PASSED

- FOUND: packages/web/src/components/DashboardsPage.tsx
- FOUND: packages/web/src/components/DashboardsPage.urlsync.spec.tsx
- FOUND: .planning/phases/117-dashboard-settings-links/117-03-SUMMARY.md
- FOUND commit: 9c6a158
- FOUND commit: d62ef24

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
