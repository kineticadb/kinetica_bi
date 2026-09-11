---
phase: 114-deep-link-load-error-states
plan: 01
subsystem: ui
tags: [react-hooks, dashboards, deep-linking, history-api, security-non-leak]

# Dependency graph
requires:
  - phase: 113-dashboard-url-sync
    provides: "lib/dashboardUrl.ts — readDashboardIdFromSearch, clearDashboardUrl, DASHBOARD_URL_PARAM"
provides:
  - "lib/dashboardUrl.ts — hasDashboardParam, distinguishing 'no param' from 'param present but unparseable'"
  - "hooks/useDeepLinkDashboard.ts — a five-state boot-URL resolution state machine (none/pending/opened/unavailable/error) plus DEEP_LINK_UNAVAILABLE_MESSAGE, the single non-leaking failure message"
affects: [114-02-wire-app-and-dashboards-page, 115-deep-link-authentication-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Boot-URL captured once via a useState initializer (before any effect can mutate it), then resolved by an effect keyed on auth status — same 'capture first, resolve async' shape as Phase 113's history writers"
    - "startedRef guard (not just a state check) to make an async list-fetch StrictMode-safe: state alone flips 'pending'->'opened'/'unavailable' too late to stop the double-invoked effect from firing twice"
    - "Resolution via the existing permission-filtered LIST endpoint, never a per-id fetch — an id absent from listDashboards() is genuinely ambiguous (deleted vs not-permitted) by the backend's own non-leak design, so there is exactly one failure outcome and one message constant"

key-files:
  created:
    - packages/web/src/hooks/useDeepLinkDashboard.ts
    - packages/web/src/hooks/useDeepLinkDashboard.spec.ts
  modified:
    - packages/web/src/lib/dashboardUrl.ts
    - packages/web/src/lib/dashboardUrl.spec.ts

key-decisions:
  - "A junk deep link (?dashboard=abc) is treated as NO deep link, not a failure — stripped silently so the address bar matches the list about to render (locked discretion call per 114-CONTEXT.md)"
  - "Exactly one setState({ status: \"unavailable\" }) call site enforces the non-leak security property structurally, not just by convention — deleted and not-permitted cannot diverge in text because there is only one code path"
  - "A listDashboards() rejection arriving AFTER the session has ended does NOT strip the param and does NOT transition to 'error' — it stays 'pending' and re-arms (startedRef reset) so Phase 115's re-auth flow can retry the same id"

patterns-established:
  - "Five-state deep-link machine (none/pending/opened/unavailable/error) as the contract a consuming component (App.tsx, Plan 02) reads without further branching logic"

requirements-completed: [DLINK-V121-02, DLINK-V121-04, DLINK-V121-05]

# Metrics
duration: 9min
completed: 2026-09-11
---

# Phase 114 Plan 01: Deep Link Resolution Layer Summary

**A five-state `useDeepLinkDashboard` hook that resolves a boot `?dashboard=<id>` against the permission-filtered dashboard list, with exactly one non-leaking `unavailable` outcome for both "deleted" and "not permitted."**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-09-11T12:59:00-04:00
- **Completed:** 2026-09-11T13:07:19-04:00
- **Tasks:** 2
- **Files modified:** 2 (`dashboardUrl.ts`, `dashboardUrl.spec.ts`)
- **Files created:** 2 (`useDeepLinkDashboard.ts`, `useDeepLinkDashboard.spec.ts`)

## Accomplishments
- `hasDashboardParam(search)` added to `dashboardUrl.ts`, pairing with the existing `readDashboardIdFromSearch` so a caller can tell "no deep link" from "junk deep link" (`?dashboard=abc`) and strip the latter instead of leaving it in the address bar.
- `useDeepLinkDashboard()` — the boot-URL resolution state machine: `none | pending | opened | unavailable | error`. Captures the URL once (before any effect can mutate it), resolves by scanning the permission-filtered `listDashboards()` result (there is no per-id route, by design), and is StrictMode-safe (`listDashboards` called exactly once per session, verified by an actual discrimination check — see below).
- The non-leak security property is enforced structurally: `grep -c 'setState({ status: "unavailable" })'` reads exactly `1`. There is one message constant, `DEEP_LINK_UNAVAILABLE_MESSAGE`, used for both the "deleted" and "not permitted" cases — the backend cannot and must not distinguish them.
- A session-ended-mid-flight rejection preserves `?dashboard=<id>` and stays `pending` (re-arming `startedRef`) rather than stripping the param or surfacing an error, so Phase 115 can retry after re-auth.
- Verified — not just asserted — that the StrictMode single-call guard actually discriminates: temporarily removing the `startedRef.current` check flipped the StrictMode test's assertion from `toHaveBeenCalledTimes(1)` (pass) to `toHaveBeenCalledTimes(2)` (fail), confirming the guard is load-bearing. Restored immediately after.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hasDashboardParam to dashboardUrl.ts** - `f0815db` (feat, TDD: 5 failing tests confirmed RED, then GREEN)
2. **Task 2: Create the useDeepLinkDashboard boot-URL state machine** - `f2b1ad7` (feat, TDD: 9 failing tests confirmed RED via missing-module error, then GREEN on first implementation)

**Plan metadata:** (this commit)

_No refactor commits needed — both tasks passed on the first correct implementation._

## Files Created/Modified
- `packages/web/src/lib/dashboardUrl.ts` - added `hasDashboardParam` (thin `URLSearchParams.has()` wrapper, reuses `DASHBOARD_URL_PARAM`)
- `packages/web/src/lib/dashboardUrl.spec.ts` - 5 new `HASPARAM-114:`-prefixed tests (27 total, was 22)
- `packages/web/src/hooks/useDeepLinkDashboard.ts` - new hook: five-state machine, single `unavailable` outcome, single message constant
- `packages/web/src/hooks/useDeepLinkDashboard.spec.ts` - 9 new `DEEPLINK-114:`-prefixed tests covering every branch, including the StrictMode single-call and session-ended no-strip cases

## Decisions Made
None beyond what was already locked in `114-CONTEXT.md` — implemented as written. The one open "Claude's Discretion" item this plan touches (junk-param handling) was resolved as specified in the plan: `?dashboard=abc` counts as no deep link, stripped for consistency with the strip-on-failure design.

## Deviations from Plan

### Reported (not auto-fixed): two acceptance-criterion greps could not discriminate as literally stated

Per CLAUDE.md §"Writing verifiable acceptance criteria" and this plan's own critical-rules instruction, no code was edited to force either grep to hit its literal target — the real requirement was verified directly instead in both cases.

**1. Task 1, criterion 1** — `grep -c "hasDashboardParam" src/lib/dashboardUrl.ts` was specified to read `>= 2`; the actual count is `1`.
- The plan's own prescribed JSDoc comment for the new export (given verbatim in `<action>`) does not repeat the symbol name `hasDashboardParam` anywhere in its text — only the `export function hasDashboardParam(...)` declaration line contains it. The criterion's arithmetic assumed a second occurrence that the plan's own reference code does not produce.
- Verified directly: `hasDashboardParam` is exported from `dashboardUrl.ts` (confirmed via `grep -n`, one hit at the declaration), is imported and used correctly by `useDeepLinkDashboard.ts`, is covered by 5 dedicated `HASPARAM-114:` tests, and reuses `DASHBOARD_URL_PARAM` (not a string literal) — `grep -c "DASHBOARD_URL_PARAM" src/lib/dashboardUrl.ts` went from 4 to 5, confirming the constant, not a literal, is used.
- No code changed to inflate the count. This mirrors the identical pattern already documented in `113-01-SUMMARY.md` (criterion-arithmetic issue, not an implementation gap).

**2. Task 2, criterion 4b** — `grep -c "dashboards/" src/hooks/useDeepLinkDashboard.ts` was specified to read exactly `0`; the actual count is `1`.
- The plan's own prescribed file-header JSDoc (given verbatim in `<action>`) contains the sentence `GET /api/dashboards/:id route, deliberately` — explaining WHY no per-id route is used. That explanatory sentence itself contains the substring `dashboards/`, which the plan's own reference code introduces.
- Verified directly: there is no `fetch`, `apiFetch`, or template-literal URL construction anywhere in the file (`grep -n "fetch\|apiFetch\|\`" src/hooks/useDeepLinkDashboard.ts` returns only the comment line itself, no code). The hook's only network call is `listDashboards()`, confirmed by the file's single import from `../api/client`. The real requirement — "resolution goes through the existing permission-filtered list helper and NOT a hand-rolled fetch to a per-id URL" — holds.
- No code changed (e.g. no rewording of the comment) to force the grep to `0`; the comment is legitimate, plan-prescribed documentation of a design decision, not a functional per-id call.

**Total deviations:** 0 auto-fixed; 2 reported (toothless/miscounted acceptance criteria, both traced to the plan's own prescribed reference code containing the searched substring in explanatory prose — real requirements verified directly per CLAUDE.md guidance). No functional deviation from the plan.

## Issues Encountered
None. Both tasks' TDD RED→GREEN cycles passed on the first implementation attempt; the StrictMode guard's discrimination was verified by temporarily disabling it as the plan required, then restored.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `useDeepLinkDashboard` and `DEEP_LINK_UNAVAILABLE_MESSAGE` are exported and fully tested in isolation; `App.tsx` and `DashboardsPage.tsx` remain untouched, exactly as scoped.
- Plan 02 can now wire the hook into `App.tsx`'s render logic: hold the existing full-screen `Loading…` while `status === "pending"`, land on the dashboard list with a dismissible banner carrying `DEEP_LINK_UNAVAILABLE_MESSAGE` for `unavailable`/`error`, and open the dashboard directly (skipping the list) for `opened` — all without needing any further branching, since the hook already resolved every ambiguity.
- The session-ended/re-auth hand-off (`pending` state surviving a mid-flight rejection with the param intact) is ready for Phase 115 to consume without any changes to this plan's code.

---
*Phase: 114-deep-link-load-error-states*
*Completed: 2026-09-11*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (`f0815db`, `f2b1ad7`) verified present in git history.
