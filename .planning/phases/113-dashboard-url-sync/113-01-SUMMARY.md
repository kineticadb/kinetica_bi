---
phase: 113-dashboard-url-sync
plan: 01
subsystem: ui
tags: [history-api, dashboards, react, react-strictmode]

# Dependency graph
requires: []
provides:
  - "src/lib/dashboardUrl.ts — pure ?dashboard=<id> param read/build + the three History-API writers (openDashboardUrl / leaveDashboardUrl / clearDashboardUrl)"
  - "DashboardsPage.tsx wired to the address bar: open pushes, in-app Back leaves, popstate returns-or-reconciles, DashboardOpen unmount clears its own id"
affects: [114-deep-link-load-and-error-states, 115-deep-link-authentication-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ref-cancelled deferred unmount cleanup (window.setTimeout + useRef, empty deps) to survive React 18 StrictMode's mount->cleanup->mount, mirroring MapChartRenderer.tsx PITFALL M-01"
    - "Deferred cleanup captures its OWN instance id (openedId) at effect setup and re-checks it against the live URL before acting, so a fast unmount-then-reopen of a different dashboard cannot be wiped by a departing instance's stale timer"

key-files:
  created:
    - packages/web/src/lib/dashboardUrl.ts
    - packages/web/src/lib/dashboardUrl.spec.ts
    - packages/web/src/components/DashboardsPage.urlsync.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx

key-decisions:
  - "URL shape is a query param (?dashboard=12), never a path or hash — no router added (locked in 113-CONTEXT.md)"
  - "Opening pushes exactly ONE history entry, marked with a DASHBOARD_HISTORY_MARKER; leaving pops that entry when we own it, or replaceState-writes the list URL when we don't (the Phase-114 deep-link arrival case) — never ejects the user via history.back() on an unmarked entry"
  - "The popstate handler never OPENS a dashboard — a Forward navigation into an already-left entry reconciles the address bar down to the list in place; resolving a URL into an open dashboard stays out of scope for Phase 114"
  - "DashboardOpen's unmount cleanup is gated on useAuthStore.getState().status === \"authenticated\" so a 401/logout teardown leaves the param for Phase 115 to consume on re-auth"

patterns-established:
  - "Any future unmount-cleanup that must survive StrictMode's double-invoke uses the ref-cancelled window.setTimeout(...,0) idiom with empty deps, not useEffect(() => () => {...}, [])"

requirements-completed: [DLINK-V121-01, DLINK-V121-06, DLINK-V121-07]

duration: 20min
completed: 2026-09-11
---

# Phase 113 Plan 01: Dashboard URL Sync — Wiring Summary

**Native History API sync between the open dashboard and `?dashboard=<id>` in the address bar, with a StrictMode-proof, instance-scoped unmount cleanup.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-11T14:44:30Z
- **Tasks:** 2
- **Files modified:** 1 (`DashboardsPage.tsx`)
- **Files created:** 3 (`dashboardUrl.ts`, `dashboardUrl.spec.ts`, `DashboardsPage.urlsync.spec.tsx`)

## Accomplishments
- `src/lib/dashboardUrl.ts`: pure `readDashboardIdFromSearch` / `buildDashboardUrl` plus the three History-API writers (`openDashboardUrl`, `clearDashboardUrl`, `leaveDashboardUrl`), each covered directly (22 tests).
- `DashboardsPage.tsx` wired end-to-end: the Open button pushes the URL before `setView`; the open-branch `onBack` calls `leaveDashboardUrl()`; a new `popstate` listener returns to the list or reconciles a stale Forward-navigated param; `DashboardOpen`'s unmount cleanup clears its own dashboard's param on any full unmount (e.g. sidebar navigation), gated on auth status.
- Verified — not just asserted — that the two highest-risk new tests actually discriminate: temporarily swapping in the naive `useEffect(() => () => {...}, [])` cleanup made the StrictMode test fail (`search` went to `""` instead of `"?dashboard=77"`); temporarily swapping in a global "is any id present" check made the stale-timer test fail (`search` went to `""` instead of `"?dashboard=88"`). Both were restored to the plan's ref-cancelled, `openedId`-scoped form afterward.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the dashboardUrl helper module and its direct spec** - `71219bf` (feat, TDD: spec written and confirmed RED before implementation)
2. **Task 2: Wire DashboardsPage — open pushes, in-app Back leaves, popstate returns-or-reconciles, unmount clears** - `4b149a8` (feat, TDD: spec written and confirmed RED — all 9 failing — before the 5 wiring edits)

_No separate refactor commits were needed — both tasks passed on the first correct implementation._

## Files Created/Modified
- `packages/web/src/lib/dashboardUrl.ts` - pure param helpers + the three History-API writers
- `packages/web/src/lib/dashboardUrl.spec.ts` - 22 direct unit tests, including the explicit "writes the list URL when there is no history entry to pop" case
- `packages/web/src/components/DashboardsPage.tsx` - 5 wiring edits (import, Open button, open-branch onBack, popstate listener, DashboardOpen unmount cleanup)
- `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` - 9 `URLSYNC-113:`-prefixed component specs

## Decisions Made
None beyond what was already locked in `113-CONTEXT.md` and specified in the plan — implemented as written, including the three review-caught fixes (ref-cancelled deferral, `openedId`-scoped comparison, `view.mode` retained in the popstate effect's deps).

## Deviations from Plan

### Reported (not auto-fixed): one acceptance-criterion count could not discriminate as stated

**Acceptance criterion 4 for Task 2** expected `grep -c "clearDashboardUrl" src/components/DashboardsPage.tsx` to read exactly `3` (import + Forward-branch call + unmount-cleanup call). The actual count is `4`. Per CLAUDE.md §"Writing verifiable acceptance criteria" and this plan's own critical-rules instruction, I did not edit the code to force the grep to read `3` — I verified the real requirement directly instead:

- The plan's own prescribed Edit 4 comment text (verbatim, as given in `<action>`) reads: `//     replaceState via clearDashboardUrl(), NOT a push and NOT an open.` — this is a fourth, purely explanatory occurrence of the string `clearDashboardUrl` that the plan's own reference code introduces. The count-of-3 arithmetic in the criterion did not account for its own prescribed comment.
- Verified directly: `clearDashboardUrl` is invoked (as a real call, `clearDashboardUrl();`) in exactly two places — the popstate Forward-reconciliation branch and `DashboardOpen`'s unmount cleanup — plus one import. That is the actual, intended wiring; the fourth occurrence is documentation, not a defect.
- No code was changed to satisfy this criterion; the comment was kept because it is directly prescribed by the plan and is legitimate documentation of why `replaceState` (via `clearDashboardUrl`) rather than a push is used there.

All other numeric acceptance criteria for both tasks were verified to read their exact expected values (see the full list run during execution) — this was the sole discrepancy, and it was a criterion-arithmetic issue, not an implementation gap.

**Total deviations:** 0 auto-fixed; 1 reported (toothless/miscounted acceptance criterion, real requirement verified directly per CLAUDE.md guidance).
**Impact on plan:** None on functionality — the wiring, behavior, and all behavioral (non-count) acceptance criteria match the plan exactly.

## Issues Encountered
- The rendered "Back to dashboards" button text only appears when `document.getElementById("topbar-left-slot")` exists (portal path); in the jsdom test harness (no app shell), `DashboardOpen` falls back to a plain `<button>Back</button>` bound to the identical `onBack` handler. The component spec's button selector was adjusted to `/^back/i` to match both render paths — same handler, no functional difference, confirmed by reading both button call sites (`DashboardsPage.tsx:1161` and `:1202`, both `onClick={onBack}`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The address bar now always reflects the open dashboard's id and is kept honest across all four exit routes (in-app Back, browser Back, browser Forward into a left entry, and full-unmount sidebar navigation), with the 401/logout case deliberately left alone for Phase 115.
- Phase 114 (Deep Link Load & Error States) can now read `?dashboard=<id>` on boot and resolve it to an open dashboard — nothing in this plan does that, and `App.tsx` is untouched, so Phase 114 starts from a clean slate.
- Phase 115 (Deep Link Authentication Flow) will need to extend `ReturnTo` (`App.tsx:35-38`) to carry a dashboard id, since this plan's unmount cleanup intentionally preserves `?dashboard=<id>` across an unauthenticated teardown.

---
*Phase: 113-dashboard-url-sync*
*Completed: 2026-09-11*

## Self-Check: PASSED

All created files and both task commit hashes verified present on disk / in git history.
