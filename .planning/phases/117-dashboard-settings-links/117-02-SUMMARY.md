---
phase: 117-dashboard-settings-links
plan: 02
subsystem: ui
tags: [react, history-api, deep-linking, dashboards, url-sync]

# Dependency graph
requires:
  - phase: 117-dashboard-settings-links (plan 01)
    provides: "DashboardMode type, readDashboardModeFromSearch, setDashboardMode, and the mode-defaulted buildDashboardUrl/openDashboardUrl/restoreDashboardUrl in lib/dashboardUrl.ts"
provides:
  - "All twelve in-component DashboardsPage.tsx mode transitions wired per the verified 13-transition table (create->view push, list View/Edit pushes, view->list/edit->list leaves, and the two setDashboardMode in-place call sites)"
  - "initialOpenDashboard extended to { dashboard, mode }, with the mount-time lazy capture narrowing into the correct View union arm"
  - "The popstate reconciliation branch widened to three dashboard-screen states (open/view/edit)"
  - "34-test DashboardsPage.urlsync.spec.tsx (13 URLSYNC-113 + 4 DEEPLINK-114 fixture-fixed + 18 new DSET-117 tests split for mutation-probe discrimination), 3 mutation probes run and reverted"
  - "App.tsx passes the temporary { dashboard, mode: \"open\" as const } shape, ready for Plan 04 to swap in deepLink.mode"
affects: [117-03-unmount-clear, 117-04-app-mode-threading, 117-05, 117-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit View-union narrowing on the mount-time lazy initializer (if/if/return, not a spread) so a three-value DashboardMode maps 1:1 onto the three dashboard-carrying View arms without a type assertion"
    - "Mutation-probe-driven test splitting: an assertion pair that a single mistake could redden together (URL correctness vs. push-vs-replace, or URL correctness vs. marker preservation) is split into two independent `it()`s so two DIFFERENT wrong implementations redden two DIFFERENT tests, not the same one — required by CLAUDE.md's mutation-probe discrimination rule and proved by running both probes"

key-files:
  created: []
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.urlsync.spec.tsx
    - packages/web/src/App.tsx
    - packages/web/src/App.deeplink.spec.tsx
    - packages/web/src/App.signincommit.spec.tsx
    - packages/web/src/App.passwordDeepLink.spec.tsx
    - packages/web/src/App.tableDeeplink.spec.tsx
    - packages/web/src/App.tableSignincommit.spec.tsx
    - packages/web/src/App.tablePasswordDeepLink.spec.tsx

key-decisions:
  - "Two of the plan's own acceptance-criterion grep counts (Task 1 criteria 1 and 2) are toothless as written and were verified directly instead of gamed — see 'Deviations' below."
  - "Split two composite in-place-transition tests into four independent ones so the two required mutation probes (A: missing write, B: wrong writer) redden non-overlapping test sets, proving the suite discriminates WHICH mistake was made, not just THAT something changed."
  - "Fixed the page-stub trap in three App spec files not listed in the plan's file list (App.tableDeeplink.spec.tsx, App.tableSignincommit.spec.tsx, App.tablePasswordDeepLink.spec.tsx) — Rule 3 blocking-issue fix, required to keep the full suite green after initialOpenDashboard's shape change."
  - "No DSET requirement marked complete by this plan, per its own success criteria — DSET-V122-03's 'arrival mounts in the named mode' is only reachable end-to-end once Plan 04 replaces App.tsx's temporary `mode: \"open\" as const` literal with the real deepLink.mode."

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-09-15
---

# Phase 117 Plan 02: DashboardsPage view/edit transition wiring Summary

**Wired all twelve in-component `DashboardsPage.tsx` mode transitions (view/edit push+leave, the two `setDashboardMode` in-place sites, and the create→view push) to Plan 01's three-mode URL vocabulary, extended `initialOpenDashboard` to carry a mode, and added 18 new tests including three reverted mutation probes proving the two in-place writers and the bare-URL guard actually discriminate correct from incorrect code.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-15T14:00:00-04:00 (approx.)
- **Completed:** 2026-09-15T14:31:08-04:00
- **Tasks:** 2 completed
- **Files modified:** 9 (2 planned production/spec files + 3 planned App spec stubs + 3 additional App spec stubs fixed under Rule 3 + 1 SUMMARY)

## Accomplishments

- `DashboardsPage.tsx` gained `setDashboardMode`/`type DashboardMode` in its import, and all twelve transitions from the verified 13-transition table are wired exactly per the table:
  - `create → view` (`DashboardCreate.onSaved`): now calls `openDashboardUrl(created.id, "view")` before `setView` — the first-ever linkable moment for a fresh dashboard, a transition `117-CONTEXT.md`'s own list omitted.
  - `list → view` / `list → edit`: the View/Edit buttons now call `openDashboardUrl(dash.id, "view"|"edit")`.
  - `view → list` / `edit → list`: `DashboardDetail.onBack` / `DashboardEdit.onBack` now call `leaveDashboardUrl()`.
  - `view → edit` (`DashboardDetail.onEdit`) and `edit → view` (`DashboardEdit.onSaved`): both call `setDashboardMode`, in opposite directions — the transition pair with no table analogue, since `TableDetail` has no Edit affordance.
  - `list → open` and `open → list` are byte-identical, confirmed by an unchanged grep anchor.
- `initialOpenDashboard` changed from a bare `DashboardDto` to `{ dashboard: DashboardDto; mode: DashboardMode }`; the mount-time lazy `useState` initializer narrows explicitly (`if (mode === "view") ... if (mode === "edit") ... else "open"`) into the correct `View` union arm.
- The popstate listener's second branch widened from one dashboard-screen state (`open`) to three (`open`/`view`/`edit`), with a comment explaining why a third popstate case is unnecessary (`view↔edit` only ever changes via `replaceState`, never a `pushState`/`popstate` pair).
- `App.tsx` passes the new `{ dashboard, mode: "open" as const }` shape with a documented temporary literal (Plan 04 swaps in `deepLink.mode`); the three App spec stubs in the plan's file list were updated to the new prop shape while preserving the mount-time lazy-capture contract the page-stub trap requires.
- `DashboardsPage.urlsync.spec.tsx` grew from 13 to 34 passing tests: the 3 legacy `DEEPLINK-114` fixture renders were fixed to the new prop shape (assertions untouched), and 18 new `DSET-117:`-titled tests were added covering all 17 behaviour bullets (one bullet split into two tests for discrimination, described below).
- Three mandatory mutation probes were run against the real implementation and reverted:
  - **Probe A (deleting the `view→edit` `setDashboardMode` call):** **2 failed** — the two "changes the mode qualifier to edit" tests (list-triggered in-place edit, and deep-link-arrival-into-view-triggered in-place edit).
  - **Probe B (replacing that same call with a hardcoded `openDashboardUrl(id, "edit")` push):** **3 failed** — "does not push a new history entry", "does not turn the arrived entry into one we own", and "the in-app Back still WRITES" — a **completely disjoint set** from Probe A's two failures, proving the suite discriminates a missing write from a wrong-shaped write, not just "something changed."
  - **Probe C (changing the list's Open button to push `"view"` instead of the bare id):** **6 failed** — 5 pre-existing `URLSYNC-113` tests plus the new page-level bare-URL guard test, confirming DSET-V122-08's regression surface is real.
- Full suite: **175 files / 3948 tests, 100% green** (baseline after Plan 01 was 175/3927; net +21, all from the extended urlsync spec — matches expectation exactly since no new spec file was created). `theme-guard.spec.ts`: 150/150 green. Table family diff (`tableUrl.ts`, `useDeepLinkTable.ts`, `DatasetsPage.tsx`, `DatasetsPage.urlsync.spec.tsx`, `tableUrl.spec.ts`, `useDeepLinkTable.spec.ts`): empty. `packages/server` diff: empty.

## Task Commits

1. **Task 1: Wire all twelve in-component transitions and change initialOpenDashboard to carry a mode** - `105d371` (feat)
2. **Task 2: Extend DashboardsPage.urlsync.spec.tsx with view/edit transition and arrival coverage** - `9d2c14b` (test)

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md are updated below)

## Files Created/Modified

- `packages/web/src/components/DashboardsPage.tsx` - All twelve transitions wired; `initialOpenDashboard` prop type and mount-time lazy capture extended to carry mode; popstate listener widened to three dashboard-screen states.
- `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` - Legacy fixture fix (3 renders) + 18 new `DSET-117:` tests + 3 reverted mutation probes; `afterEach(vi.restoreAllMocks())` added to prevent spy leakage across tests.
- `packages/web/src/App.tsx` - `initialOpenDashboard` now passes `{ dashboard, mode: "open" as const }` (temporary literal, Plan 04 replaces it).
- `packages/web/src/App.deeplink.spec.tsx`, `App.signincommit.spec.tsx`, `App.passwordDeepLink.spec.tsx` - `DashboardsPage` mock stub updated to the new prop shape (planned files).
- `packages/web/src/App.tableDeeplink.spec.tsx`, `App.tableSignincommit.spec.tsx`, `App.tablePasswordDeepLink.spec.tsx` - Same stub fix, applied under Rule 3 (see Deviations) — not in the plan's file list but broken by the same shape change.

## Decisions Made

- **Split two composite mutation-probe-target tests into four independent ones.** The plan's own action text for bullets 5 and 8 combined a URL-correctness assertion with a push/marker-invariant assertion in one `it()`. Running Probe A and Probe B against that combined shape reddened the exact same two tests for both probes (different failure *messages*, same failing *test identities*) — which CLAUDE.md's mutation-probe rule (and the plan's own criterion 6) explicitly disallows: "if they redden exactly the same single test, the suite proves only 'something happens,' not 'the RIGHT thing happens.'" Splitting each into a URL-only test and an invariant-only test (marker or push-count) made Probe A and Probe B redden fully disjoint sets, which was then verified by re-running both.
- **Added `afterEach(() => vi.restoreAllMocks())` to the new describe block.** Discovered during Probe A's first run: an assertion failure before a test's own `pushSpy.mockRestore()` line leaves a wrapped spy attached to `window.history.pushState`/`back` for the rest of the file's run, cascading into unrelated later tests' call counts. This is a test-authoring robustness fix, not a change to the tests' semantics.
- **`requirements-completed` left empty**, per this plan's own success criteria ("No DSET requirement marked complete — plans 03-06 remain"). Although the plan's frontmatter lists `DSET-V122-01/02/03/05/08`, DSET-V122-03 ("visiting a link opens directly in the named mode") is not actually reachable end-to-end yet: `App.tsx` still hardcodes `mode: "open" as const` until Plan 04 threads `deepLink.mode` through. Marking any of these complete now would be premature.

## Deviations from Plan

### Toothless acceptance criteria found and reported (not gamed)

**1. Task 1 criterion 1 — `grep -o "openDashboardUrl(" DashboardsPage.tsx | wc -l` expected "exactly 4", actual is 5.**
- **Found during:** Task 1, post-implementation verification.
- **Issue:** The plan's own criterion enumerates "same comment + Open unchanged + list View + create->view" = 4, but its own action block (step 4) separately and correctly requires wiring the list's **Edit** button to also call `openDashboardUrl(dash.id, "edit")` (transition #3 in the verified table). The criterion's arithmetic simply omitted this real, required call site — it is not a docstring-prose inflation like Plan 01's findings, but a plain miscount in the criterion text itself.
- **Resolution:** Verified the real requirement directly by reading every matching line: 1 comment (line 104, pre-existing) + 4 real calls (Open unchanged, list View push, list Edit push, create→view push) = 5, which is exactly what the 13-transition table requires (transitions #1 unchanged, #2, #3, #5). Did not remove or alter the correctly-implemented Edit-button call to force the grep to read 4.
- **Files affected:** none (no code change made for this finding).

**2. Task 1 criterion 2 — `grep -o "leaveDashboardUrl(" DashboardsPage.tsx | wc -l` expected "exactly 4", actual is 5.**
- **Found during:** Task 1, post-implementation verification.
- **Issue:** Same root cause as Plan 01's findings — the plan's own mandated comment on the `DashboardDetail.onEdit` handler (step 4's required text: "...which `leaveDashboardUrl()` must still read correctly afterwards") contains a second, unavoidable prose occurrence of the literal substring, on top of the pre-existing comment (line 106) and the 3 real calls (open unchanged, view→list, edit→list).
- **Resolution:** Verified directly: 2 comment occurrences (both pre-existing/mandated prose, not code) + 3 real calls at the exact three lines the table requires (transitions #7 unchanged, #8, #10) = 5. Did not shorten the mandated comment to force the grep to read 4.
- **Files affected:** none.

### Auto-fixed issues (Rule 3 — blocking, required for the 100% vitest gate)

**3. [Rule 3] Fixed the page-stub trap in three App spec files not listed in the plan's file list.**
- **Found during:** Task 2's full-suite verification run.
- **Issue:** `App.tableDeeplink.spec.tsx` failed (`TLINK-116: ?dashboard=7&table=12 — the DASHBOARD opens, page-datasets is not rendered` — `data-deeplink` read `undefined` instead of `"7"`). Its `DashboardsPage` mock stub still read `captured.id` against the OLD `{ id: number }` shape; Task 1's `initialOpenDashboard` shape change silently broke it at runtime (TypeScript did not catch it because the stub's own inline type annotation is independent of the real component's prop type). A broader grep then found two MORE files with the identical stale stub — `App.tableSignincommit.spec.tsx` and `App.tablePasswordDeepLink.spec.tsx` — that happened not to be exercised by any assertion reading the broken field, so they did not fail, but carried the same latent defect.
- **Fix:** Updated all three stubs to the `{ dashboard: { id }; mode }` shape with `captured.dashboard.id` / `captured?.mode`, mirroring the fix already applied to the three plan-listed App spec files.
- **Files modified:** `packages/web/src/App.tableDeeplink.spec.tsx`, `packages/web/src/App.tableSignincommit.spec.tsx`, `packages/web/src/App.tablePasswordDeepLink.spec.tsx`.
- **Verification:** Full suite re-run: 175 files / 3948 tests, 100% green.
- **Committed in:** `9d2c14b` (Task 2 commit).

---

**Total deviations:** 0 code changes made to game a grep (2 toothless-criteria findings reported and verified directly); 1 Rule-3 blocking-issue fix touching 3 files outside the plan's declared file list, required to keep the full suite green.
**Impact on plan:** No scope creep — the Rule 3 fix is the mechanical, unavoidable consequence of Task 1's `initialOpenDashboard` shape change reaching every consumer, not new functionality.

## Issues Encountered

- **Mutation Probe A's first run cascaded into 2 unrelated failures via an unrestored `vi.spyOn`.** An assertion failure inside a probe run skipped that test's own `pushSpy.mockRestore()` line, leaving a wrapped spy on `window.history.pushState` for the remainder of the file's execution and corrupting later tests' call counts (visible as a `pushState` called "5 times" assertion in an otherwise-unrelated create-dashboard test). Root-caused and fixed by adding `afterEach(() => vi.restoreAllMocks())` to the new describe block before re-running the probes; both probes then produced clean, correctly-attributed failure sets.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `DashboardsPage.tsx` now writes (or deliberately does not write) the URL on every one of its twelve in-component transitions; `setDashboardMode` exists at exactly two call sites in opposite directions, mutation-probe-verified.
- Plan 03 (`DSET-V122-06`, the unmount clear) can add the two new deferred-clear timers to `DashboardDetail`/`DashboardEdit` without touching any of this plan's transition-wiring code.
- Plan 04 (the App-side mode threading) has a single, clearly marked seam to replace: `App.tsx`'s `mode: "open" as const` literal, once `useDeepLinkDashboard` resolves the mode qualifier from the URL.
- No blockers. No DSET requirement marked complete by this plan, as required by its own success criteria — Plans 03-06 remain.
- Carried forward, not fixed (per plan's `<output>` instruction): the Sidebar "Dashboards" entry is a no-op while a dashboard screen is open (`TLINK-F3`, pre-existing, affects both pages).

## Self-Check: PASSED

- FOUND: packages/web/src/components/DashboardsPage.tsx
- FOUND: packages/web/src/components/DashboardsPage.urlsync.spec.tsx
- FOUND: packages/web/src/App.tsx
- FOUND: .planning/phases/117-dashboard-settings-links/117-02-SUMMARY.md
- FOUND commit: 105d371
- FOUND commit: 9d2c14b

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
