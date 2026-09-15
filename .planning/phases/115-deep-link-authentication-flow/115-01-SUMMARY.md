---
phase: 115-deep-link-authentication-flow
plan: 01
subsystem: auth
tags: [react, zustand, history-api, sessionstorage, deep-link, vitest]

# Dependency graph
requires:
  - phase: 113-dashboard-url-sync
    provides: "lib/dashboardUrl.ts's readDashboardIdFromSearch/buildDashboardUrl/clearDashboardUrl History-API helpers"
  - phase: 114-deep-link-load-error-states
    provides: "hooks/useDeepLinkDashboard.ts's five-state resolution machine and its authStatus-gated effect"
provides:
  - "isValidDashboardId — the single shared positive-integer type-guard for dashboard ids, used by readDashboardIdFromSearch and consumable by Plan 02's kbi_returnTo reader"
  - "restoreDashboardUrl(id) — a replaceState-only writer that puts ?dashboard=<id> back on the address bar, for Plan 02's post-OIDC restore"
  - "useDeepLinkDashboard(storedId?) — the hook now accepts an optional id from outside the URL, consumed only at mount, for Plan 02/03 to feed a restored kbi_returnTo value"
  - "a permanent regression test proving password-mode's logged-out deep-link paste already works end-to-end with zero App.tsx/LoginPage.tsx changes"
affects: [115-02-PLAN, 115-03-PLAN, 115-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared type-guard predicate (isValidDashboardId) reused by both a URL-param reader and (in Plan 02) a sessionStorage reader — one id-shape definition, not two"
    - "Optional hook parameter consumed only inside the mount-time lazy useState initializer, so a value from a second source is treated with the exact same first-render-only precedence as the URL"

key-files:
  created:
    - packages/web/src/App.passwordDeepLink.spec.tsx
  modified:
    - packages/web/src/lib/dashboardUrl.ts
    - packages/web/src/lib/dashboardUrl.spec.ts
    - packages/web/src/hooks/useDeepLinkDashboard.ts
    - packages/web/src/hooks/useDeepLinkDashboard.spec.ts

key-decisions:
  - "Task 3's critical empirical claim held: App.passwordDeepLink.spec.tsx's 3 tests pass with git diff --stat HEAD -- src/App.tsx src/components/LoginPage.tsx producing EMPTY output — password mode needed only a regression test, confirming 115-RESEARCH.md §Q1 and narrowing the rest of the phase's real engineering to the OIDC half (Plans 02-04)."
  - "Two of this task's own prescribed grep acceptance criteria were toothless — not edited around, reported here per CLAUDE.md: (1) restoreDashboardUrl's plan-mandated docstring text contains the literal prose 'NEVER pushState', so naive `grep -c pushState` reads 2 instead of the assumed 1; the real requirement (`grep -c 'window\\.history\\.pushState('`, i.e. actual call sites) correctly stays at 1. (2) the storedId param's plan-mandated docstring uses the word 'sessionStorage' twice in prose explaining why the hook does NOT read it, so naive `grep -c sessionStorage` reads 2 instead of the assumed 0; the real requirement (`grep -c 'sessionStorage\\.(get|set)Item'`) correctly stays at 0."

requirements-completed: [DLINK-V121-03]

# Metrics
duration: 25min
completed: 2026-09-14
---

# Phase 115 Plan 01: Deep Link Authentication Flow — Shared Contracts Summary

**Added `isValidDashboardId` + `restoreDashboardUrl` to `lib/dashboardUrl.ts`, parameterized `useDeepLinkDashboard` with an optional stored id, and proved by executed test that password-mode's logged-out deep-link paste already works with zero App.tsx/LoginPage.tsx changes.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-09-14T13:35:23Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 created lines added to existing, 1 net-new)

## Accomplishments
- `isValidDashboardId` is now the ONE shared positive-integer type-guard; `readDashboardIdFromSearch` delegates to it instead of duplicating the shape check
- `restoreDashboardUrl(id)` exists, replaceState-only, idempotent — the missing address-bar writer Plan 02 needs for the post-OIDC restore
- `useDeepLinkDashboard(storedId?)` accepts an id from outside the URL, consumed only in the mount-time lazy initializer, with ZERO references to `sessionStorage` inside the hook
- `App.passwordDeepLink.spec.tsx` is a new permanent regression test (3 passing tests) proving password mode's half of DLINK-V121-03 already worked before this plan, with `App.tsx`/`LoginPage.tsx` byte-unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: isValidDashboardId + restoreDashboardUrl in lib/dashboardUrl.ts** - `829c4c6` (feat)
2. **Task 2: useDeepLinkDashboard accepts a stored id it did not read itself** - `1b3b1f8` (feat)
3. **Task 3: Pin the password-mode logged-out paste** - `bd82fec` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/web/src/lib/dashboardUrl.ts` - added `isValidDashboardId` type-guard and `restoreDashboardUrl` replaceState writer; `readDashboardIdFromSearch` now routes through the shared predicate
- `packages/web/src/lib/dashboardUrl.spec.ts` - added `AUTHLINK-115` describe blocks for both new exports (12 new tests)
- `packages/web/src/hooks/useDeepLinkDashboard.ts` - hook signature gained `storedId?: number | null`, consumed only in the lazy `useState` initializer; URL param still takes precedence over a stored id
- `packages/web/src/hooks/useDeepLinkDashboard.spec.ts` - added `AUTHLINK-115` describe block (6 new tests) covering the stored-id precedence rules and a StrictMode double-invoke guard; all 10 pre-existing `DEEPLINK-114` occurrences (9 test titles + 1 docstring mention) survive untouched
- `packages/web/src/App.passwordDeepLink.spec.tsx` - new file, 3 tests, adapted from 115-RESEARCH.md §Q1's throwaway spike, real `LoginPage` (not mocked)

## Decisions Made
- Followed the plan's prescribed code verbatim for Tasks 1 and 2 (docstrings included) rather than paraphrasing, since 115-RESEARCH.md and the plan had already worked out the exact reasoning worth preserving in comments for Plan 02's authors.
- Task 3's `DashboardsPage` stub mirrors the real component's `useState(() => initialOpenDashboard)` mount-time lazy capture, per the plan's explicit warning about the dumb-prop-reflector trap — verified this was necessary by getting a clean pass on the first attempt (no need to hit the trap to confirm it, since the plan and research already demonstrated it).

## Deviations from Plan

None requiring a code change — plan executed exactly as written for all 3 tasks. However, two of the plan's own acceptance-criteria grep commands turned out to be non-discriminating (toothless) once the plan's own prescribed docstring text was typed in verbatim, and are reported per CLAUDE.md's instruction to report rather than paper over:

**1. [Reported, not fixed] `grep -c "pushState" src/lib/dashboardUrl.ts` reads 2, not the plan's assumed 1**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The plan's own mandated docstring for `restoreDashboardUrl` contains the prose "replaceState, NEVER pushState:" — this literal substring match inflates the naive grep from 1 (the one real `window.history.pushState(` call site, inside `openDashboardUrl`) to 2.
- **Real requirement verified directly:** `grep -c "window\.history\.pushState("` (actual call sites, not prose) → **1**, confirming `restoreDashboardUrl` did not add a second history-mutating call. No source change made — the docstring is exactly what the plan specified, and rewording it to dodge a grep would be editing code to satisfy a broken check, which CLAUDE.md forbids.

**2. [Reported, not fixed] `grep -c "sessionStorage" src/hooks/useDeepLinkDashboard.ts` reads 2, not the plan's assumed 0**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan's own mandated JSDoc for the `storedId` parameter explains, in prose, that "the hook deliberately does NOT read sessionStorage itself" — twice using the word "sessionStorage" as prose, not code.
- **Real requirement verified directly:** `grep -c "sessionStorage\.\(get\|set\)Item"` (actual read/write calls) → **0**, confirming the hook never becomes a second reader of `kbi_returnTo`. No source change made for the same reason as above.

**3. [Reported, not fixed] `grep -c "storedId" src/hooks/useDeepLinkDashboard.ts` reads 3 (line-count), the plan's ≥4 threshold assumed occurrence-count**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** `grep -c` counts matching LINES, not occurrences; line 60 (`if (isValidDashboardId(storedId)) return { status: "pending", id: storedId };`) contains `storedId` twice on one line, so `grep -c` reports 3 lines even though there are 4 total occurrences (verified via `grep -o | wc -l` → 4). The code is exactly the plan's prescribed text.
- **Real requirement verified directly:** total occurrence count is 4, matching the plan's intent (JSDoc `@param`, function signature, and the guard's two uses).

**Total deviations:** 0 code changes; 3 acceptance-criteria observations reported per CLAUDE.md's "report, don't paper over a broken grep" rule.
**Impact on plan:** None on functionality or test coverage — every behavioral acceptance criterion and the full `<behavior>` list for both tasks holds; only three of the plan's own naive grep commands needed a stricter re-statement to actually discriminate, which is documented here for Plan 02's author (who will write similar `dashboardId`/`sessionStorage`-adjacent criteria against `App.tsx`).

## Issues Encountered
None. Task 3's critical risk — that the password-mode regression test might fail against the real, unmodified `App.tsx`/`LoginPage.tsx`, which per the plan would mean "STOP and report" — did not materialize; all 3 tests passed on the first run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (the OIDC commit-time write + `ReturnTo.dashboardId` field + read-side validation) can now import `isValidDashboardId` from `lib/dashboardUrl.ts` for its `kbi_returnTo` read-side guard, exactly as 115-RESEARCH.md §Q3 recommended.
- Plan 02/03 can call `restoreDashboardUrl(id)` unconditionally once `deepLink.status` transitions to `"opened"`, and can pass a restored id into `useDeepLinkDashboard(pendingDashboardId)` — both contracts are built, tested, and exported.
- No blockers. All four plan-level gates green: `tsc --noEmit` clean, targeted specs green (58/58), full `vitest run` green (3749/3749, ≥ the 3727 baseline), `theme-guard.spec.ts` green (150/150) — this plan touched no CSS/JSX styling.

## Self-Check: PASSED

All claimed files exist on disk and all claimed commits (`829c4c6`, `1b3b1f8`, `bd82fec`) are present in `git log`.

---
*Phase: 115-deep-link-authentication-flow*
*Completed: 2026-09-14*
