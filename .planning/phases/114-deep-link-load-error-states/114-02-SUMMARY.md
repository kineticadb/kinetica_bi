---
phase: 114-deep-link-load-error-states
plan: 02
subsystem: ui
tags: [react, deep-linking, history-api, boot-sequence, banner]

# Dependency graph
requires:
  - phase: 114-deep-link-load-error-states
    plan: 01
    provides: "hooks/useDeepLinkDashboard.ts — five-state boot-URL resolution machine + DEEP_LINK_UNAVAILABLE_MESSAGE"
  - phase: 113-dashboard-url-sync
    provides: "lib/dashboardUrl.ts History-API writers + DashboardsPage's open/back/popstate/unmount wiring"
provides:
  - "App.tsx — holds the existing full-screen Loading… shell while a deep link resolves; renders one dismissible failure banner on 'unavailable'; hands the resolved dashboard to DashboardsPage via a one-shot ref"
  - "DashboardsPage.tsx — initialOpenDashboard prop, consumed once by a mount-time lazy useState initializer so a deep-link arrival mounts straight into { mode: 'open' } with no list-page flash"
affects: [115-deep-link-authentication-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Render-time ref read (not effect-set state) for a one-shot parent-to-child handoff whose value must exist during the child's OWN mount-time useState initializer — state-in-effect would arrive one commit too late"
    - "Ref-flip effect gated on a SECOND condition (page === \"dashboards\") in addition to the handoff value itself, so the one-shot flag only burns on the render where the consumer actually mounts with it — see key-decisions"
    - "One shared `loadingShell` JSX constant returned from two different gates (auth-unknown, deep-link-pending) so there is structurally only one loading state, never two divergent ones"

key-files:
  created:
    - packages/web/src/App.deeplink.spec.tsx
  modified:
    - packages/web/src/App.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.urlsync.spec.tsx
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Ref-flip effect deps changed from [initialOpenDashboard] to [initialOpenDashboard, page] (Rule 1 auto-fix, not in the plan's literal code) — see Deviations. Without the page gate, a competing Phase 7 ReturnTo to a DIFFERENT page (e.g. roles) burns the one-shot handoff on the render where deepLink first resolves, which is NOT the same render where DashboardsPage first mounts (page isn't 'dashboards' yet), silently losing the deep link entirely."
  - "The DashboardsPage test double in App.deeplink.spec.tsx captures initialOpenDashboard via its OWN mount-time useState lazy initializer, mirroring the real component's mount-once contract, instead of a dumb prop-reflector — a dumb reflector produces a false failure on CORRECT App.tsx wiring (see Deviations)."
  - "fetchWmsCapabilities added to the spec's api/client mock — unmocked, Phase 11's authenticated-mount WMS probe hits a real network call that can return 401 and dispatch UNAUTHORIZED_EVENT mid-test, logging the test out while it's awaiting the deep-link resolution."

patterns-established:
  - "A parent that owns a one-shot handoff to a child's mount-time lazy initializer must gate the ref flip on the SAME condition that gates the child's actual mount, not merely on the handoff value being momentarily truthy."

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-09-11
---

# Phase 114 Plan 02: Wire App.tsx and DashboardsPage Summary

**App.tsx now holds the app's existing full-screen `Loading…` shell while a deep link resolves, hands the resolved dashboard to `DashboardsPage` via a one-shot ref so it mounts straight into `{ mode: "open" }` with structurally zero list-page flash, and shows one reused-class dismissible banner (`DEEP_LINK_UNAVAILABLE_MESSAGE`) when the link can't be opened — with a same-render fix so a competing Phase 7 ReturnTo doesn't silently swallow the deep link.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-11T13:09:45-04:00 (immediately after 114-01)
- **Completed:** 2026-09-11T13:24:12-04:00
- **Tasks:** 2
- **Files modified:** 3 (`App.tsx`, `DashboardsPage.tsx`, `DashboardsPage.urlsync.spec.tsx`)
- **Files created:** 1 (`App.deeplink.spec.tsx`)

## Accomplishments

- `DashboardsPage` accepts `initialOpenDashboard?: DashboardDto`, consumed ONCE by a mount-time lazy `useState` initializer — mounts straight into `{ mode: "open" }` (list chrome never rendered), pushes no history entry of its own (does NOT call `openDashboardUrl`, since the arriving URL already carries `?dashboard=<id>`), and its in-app Back correctly hits Phase 113's `leaveDashboardUrl()` unmarked-entry `"wrote"` branch (writes the list URL, never `history.back()`-ejects the user).
- `App.tsx` wired per the plan's `<boot_ordering>` exactly: `status === "unknown"` → `loadingShell`; `status !== "authenticated"` → `LoginPage` (kept ABOVE the deep-link hold so an unauthenticated arrival reaches login, not an infinite spinner — leaves `?dashboard=<id>` in the bar for Phase 115); `deepLink.status === "pending"` → the SAME `loadingShell` constant (one continuous loading state, structurally proven — see Task 2's discrimination check below).
- Failure banner reuses `.onboarding-banner` / `.banner-dismiss` verbatim (no invented class, no hex, no new CSS — `git diff global.css` is empty); shows `DEEP_LINK_UNAVAILABLE_MESSAGE` on `unavailable` only, dismissible independently of the existing onboarding banner; `error` (transport failure) shows no banner, letting `DashboardsPage`'s own error surface tell the honest story.
- The page-forcing effect (`deepLink.status === "opened"` → `setPage("dashboards")` + `setDashboardViewMode("open")`; `"unavailable"`/`"error"` → `setPage("dashboards")`) is declared AFTER Phase 7's ReturnTo effect in source order, and the ReturnTo block itself (lines, type) is byte-for-byte untouched — `git diff` removes zero `RETURN_TO_KEY`/`ReturnTo`/`dashboardViewMode?:` lines.
- Verified — not just asserted — that the no-flash structural proof (App.deeplink.spec.tsx test 1) actually discriminates: temporarily deleted the `if (deepLink.status === "pending") return loadingShell;` branch, confirmed the test goes RED (`page-dashboards` appears while `listDashboards` is still unsettled), then restored it.

## Task Commits

Each task was committed atomically:

1. **Task 1: DashboardsPage accepts initialOpenDashboard and mounts straight into the open view** - `0554ab7` (feat, TDD: 3 of 4 new tests confirmed RED before implementation, 1 already-true baseline case)
2. **Task 2: App.tsx holds the Loading gate, shows the failure banner, and hands off the resolved dashboard** - `f9fa02f` (feat, TDD: all 9 new tests confirmed RED via missing-wiring failures before the 6 App.tsx edits)

**Plan metadata:** (this commit)

_No separate refactor commits needed — both tasks reached green after their initial implementation plus the one in-scope bug fix documented below._

## Files Created/Modified

- `packages/web/src/components/DashboardsPage.tsx` — `initialOpenDashboard` prop + mount-time lazy `view` initializer (2 edits, nothing else touched: popstate effect, Open button, open-branch `onBack`, `DashboardOpen` unmount cleanup all untouched)
- `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` — 4 new `DEEPLINK-114:` tests appended (13 total, was 9); two of the four explicitly `unmount()` + flush the deferred unmount-cleanup macrotask before the test ends, to avoid bleeding Phase 113's instance-scoped cleanup timer into the next test sharing the same fixture id (77)
- `packages/web/src/App.tsx` — 6 edits: imports, hook + one-shot ref handoff (with the page-gated flip fix), page-forcing effect (after ReturnTo), render-gate `loadingShell` + pending hold, failure banner, `initialOpenDashboard` prop pass-through
- `packages/web/src/App.deeplink.spec.tsx` — new file, 9 `DEEPLINK-114:` tests covering the pending hold, success handoff, banner (shown/dismissible/non-leaking), transport failure, away-and-back non-reopening, ReturnTo race, and the unauthenticated boundary

## Decisions Made

Beyond what was already locked in `114-CONTEXT.md`, one implementation decision was required to make the plan's own specified behavior actually hold (see Deviations for the full reasoning): the ref-flip effect's dependency array was changed from the plan's literal `[initialOpenDashboard]` to `[initialOpenDashboard, page]`, with the flip itself also re-gated on `page === "dashboards"`.

## Deviations from Plan

### Auto-fixed (Rule 1 — bug in this task's own new code)

**1. Ref-flip effect could burn the one-shot deep-link handoff before `DashboardsPage` ever mounted with it, when a Phase 7 ReturnTo targets a DIFFERENT page.**
- **Found during:** Task 2, writing test 8 (`a pasted link beats the Phase 7 ReturnTo page restore`) — the plan's own explicitly required behavior ("A ReturnTo of `{"page":"roles"}` plus a resolving deep link ends on dashboards, not roles").
- **Root cause:** the plan's literal Edit 2 flips `deepLinkConsumedRef.current = true` in an effect keyed ONLY on `initialOpenDashboard`. But `initialOpenDashboard` first becomes truthy on the render where `deepLink.status` flips to `"opened"` — which is NOT necessarily the same render where `DashboardsPage` mounts, if `page` is still `"roles"` (from the earlier, synchronous ReturnTo effect) at that moment. The ref flip effect and the page-forcing effect (Edit 3) both fire in the SAME effect-flush, in declaration order: the ref flips to `true` BEFORE the page-forcing effect's `setPage("dashboards")` call has even scheduled the render where `DashboardsPage` would actually mount. By the time that later render happens, `initialOpenDashboard` re-evaluates against the now-`true` ref and comes back `undefined` — `DashboardsPage` mounts into the list, and the deep link is silently lost.
- **Fix:** gated the ref flip on `page === "dashboards"` too (`useEffect(() => { if (initialOpenDashboard && page === "dashboards") deepLinkConsumedRef.current = true; }, [initialOpenDashboard, page])`). This defers the flip to the render where `page` has actually become `"dashboards"` — which is the render where `DashboardsPage` mounts with the value — so the one-shot handoff survives until it is actually consumed. Verified: test 8 was RED with the plan's literal code and GREEN after this fix; all other 8 `App.deeplink.spec.tsx` tests and all 32 pre-existing `App.spec.tsx` tests remained green throughout.
- **Files modified:** `packages/web/src/App.tsx` (one `useEffect` deps array + condition).
- **Commit:** `f9fa02f`.

### Reported (not auto-fixed): a test-double design choice from the plan text produces a false failure on correct code

**2. The plan's literal `DashboardsPage` mock (a dumb prop-reflector) does not discriminate correctly for test 2 (`opens the linked dashboard directly once it resolves`) and test 8.**
- **Found during:** Task 2, first RED→GREEN pass — with App.tsx correctly wired (including the Rule-1 fix above), the plan's suggested mock `({ initialOpenDashboard }) => <main data-deeplink={... }>` still showed `data-deeplink=""` at assertion time, because App re-renders one more time (the page-forcing effect's `setDashboardViewMode("open")` call) AFTER the ref has flipped, passing `initialOpenDashboard=undefined` on that later render. The REAL `DashboardsPage` is immune to this because it reads the prop ONLY in its own mount-time lazy initializer (Task 1's whole point) — a later prop change is a no-op for it. The plan's simple stub has no such memory, so it faithfully reflects a prop value that is irrelevant to the real component's actual behavior, producing a false failure on genuinely correct App.tsx wiring.
- **Not auto-fixed silently** — per CLAUDE.md §"Writing verifiable acceptance criteria" and this plan's own critical-rules instruction, this is reported rather than declared a code bug, since App.tsx's behavior is correct and operator-verifiable (Plan 03's checkpoint); the flaw is in the test double's fidelity to the real component's documented contract.
- **Resolution:** the mock in `App.deeplink.spec.tsx` was written to capture `initialOpenDashboard` via its OWN `useState(() => initialOpenDashboard)` lazy initializer, mirroring the exact mount-once contract Task 1 built and tested directly. This is a stricter, more faithful double, not a weakened one — it fails if App ever fails to pass the value at the correct (first) render, and no longer fails on harmless later prop churn that the real component already ignores by design.
- **Files modified:** `packages/web/src/App.deeplink.spec.tsx` (mock definition only).

### Reported (not auto-fixed): one acceptance-criterion count could not discriminate as literally stated

**3. Task 1, criterion 4** — `grep -c "openDashboardUrl" src/components/DashboardsPage.tsx` was specified to read exactly `2`; the actual count is `3`.
- The plan's own prescribed Edit 2 comment (given verbatim in `<action>`) contains the explanatory sentence "Note what is NOT here: `openDashboardUrl()`." — a third, non-functional occurrence of the string that the plan's own reference code introduces.
- Verified directly: `openDashboardUrl` is actually CALLED exactly once in the file (the Open button, `onClick={() => { openDashboardUrl(dash.id); ... }}`), plus one import — the real requirement ("the deep-link path did NOT add a third, double-pushing call site") holds. The third grep hit is a comment, not a call. This mirrors the identical pattern already documented in `113-01-SUMMARY.md` and `114-01-SUMMARY.md`.
- No code changed to force the grep to `2`.

**Total deviations:** 1 auto-fixed (Rule 1, a real bug in this plan's own prescribed code, caught by implementing the plan's own required test 8); 2 reported (one test-double fidelity issue, one miscounted acceptance criterion — both traced to the plan's own prescribed reference text, real requirements verified directly per CLAUDE.md guidance).

### Environment-only fix (test infrastructure, Rule 3)

**4. `fetchWmsCapabilities` added to `App.deeplink.spec.tsx`'s `api/client` mock.**
- Phase 11's WMS-capabilities probe fires unconditionally on every authenticated mount. Left unmocked, it issues a real `fetch` to `API_BASE` (`http://localhost:4000` by default) which — whenever anything answers on that port during a test run — can return a non-2xx response and, via `apiFetch`'s 401/`REAUTH_REQUIRED` handling, dispatch `UNAUTHORIZED_EVENT` mid-test, logging the simulated session out while a test is still awaiting the deep-link resolution (observed as a spurious `login-page` render). Stubbed inert (`Promise.resolve({..., source: "fallback"})`), matching the existing `fetchMe`/`listUsers` stubbing pattern already used by `App.spec.tsx`. Blocking-issue fix, in scope of getting this task's own new spec file to run deterministically; no production code touched.

## Issues Encountered

None beyond the two Task 2 items resolved above (the Rule 1 ref-gating bug and the test-double fidelity issue) — both were caught by writing the plan's own prescribed tests (8 and 2) faithfully, exactly as the TDD discipline intends.

## Boot-Ordering Compliance

- `status === "unknown"` → `loadingShell` (identical markup to the deep-link hold — `grep -c "loadingShell"` reads exactly 3: 1 definition + 2 returns).
- `status !== "authenticated"` → `LoginPage`, confirmed ABOVE the deep-link hold in source order and by test 9 (`an unauthenticated arrival goes to login and keeps the param for Phase 115` — `listDashboards` is never called).
- `deepLink.status === "pending"` → the SAME `loadingShell` constant.
- Phase 7's ReturnTo effect (`App.tsx:200-238` originally, now shifted but line-identical) is untouched; the new page-forcing effect is declared AFTER it in source, confirmed by criterion 9's line-number check (`RETURN_TO_KEY` at line 253, `if (deepLink.status === "opened")` at line 269 — `ORDER_OK`).
- `git diff -U0 -- src/App.tsx | grep "^-" | grep -cE "RETURN_TO_KEY|ReturnTo|dashboardViewMode\?:"` → `0` — no ReturnTo mechanism or type line was removed or rewritten.

## User Setup Required

None — no external service configuration required.

## Requirements Status

DLINK-V121-02/-04/-05 are deliberately left at **In Progress** in `.planning/REQUIREMENTS.md` (descriptive note updated, checkboxes NOT ticked) per this plan's git-note instruction: Plan 03's operator checkpoint has not yet run, and this milestone's convention is server/operator-verified completion, not executor self-certification.

## Next Phase Readiness

- `App.tsx` and `DashboardsPage.tsx` now fully implement the success and failure paths structurally (Roadmap criteria 1-4 for this plan); the genuinely visual "no flash" / "banner reads correctly" confirmations are Plan 03's operator checkpoint, not re-asserted here via grep.
- The one-shot ref handoff pattern (gated on `page === "dashboards"`) is a precedent Phase 115 should be aware of if it extends the `ReturnTo` type to carry a dashboard id: any new page-forcing effect racing against this one must consider the SAME page-gating hazard this plan just fixed.
- Phase 115 (Deep Link Authentication Flow) can proceed: the unauthenticated deep-link arrival already reaches `LoginPage` with `?dashboard=<id>` intact and `listDashboards` never called, exactly as Phase 115 will need to build on.

---
*Phase: 114-deep-link-load-error-states*
*Completed: 2026-09-11*

## Self-Check: PASSED

All modified/created files verified present on disk; both task commit hashes (`0554ab7`, `f9fa02f`) verified present in git history.
