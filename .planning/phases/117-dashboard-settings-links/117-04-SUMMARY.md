---
phase: 117-dashboard-settings-links
plan: 04
subsystem: ui
tags: [react, history-api, deep-linking, dashboards, url-sync, auth-restore]

# Dependency graph
requires:
  - phase: 117-dashboard-settings-links (plan 01)
    provides: "DashboardMode type, readDashboardModeFromSearch, setDashboardMode, mode-aware buildDashboardUrl/openDashboardUrl/restoreDashboardUrl in lib/dashboardUrl.ts"
  - phase: 117-dashboard-settings-links (plan 02)
    provides: "DashboardsPage's twelve mode transitions, and App.tsx's temporary { dashboard, mode: \"open\" as const } initialOpenDashboard shape"
  - phase: 117-dashboard-settings-links (plan 03)
    provides: "The id-and-mode-scoped unmount-clear timers, confirming DashboardsPage needs no further changes for this plan"
provides:
  - "useDeepLinkDashboard's DeepLinkState carries mode on pending/opened, mirroring useDeepLinkTable's shape exactly"
  - "The stored-link parameter reshaped from storedId: number to storedDashboard: { id, mode } | null"
  - "App.tsx's dashboard deep-link effect, handleSignInCommit's commit payload, and initialOpenDashboard's page prop all read deepLink.mode instead of a hardcoded \"open\""
  - "ReturnTo.dashboardMode, extending the SAME kbi_returnTo key (no second storage key)"
  - "28-test hooks/useDeepLinkDashboard.spec.ts (16 legacy + 12 new DSET-117 tests), 3 mutation probes run and reverted"
affects: [117-05, 117-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional payload construction (d.mode === \"open\" ? twoKeyObject : threeKeyObject) instead of a spread with an undefined-valued key, to keep JSON.stringify's output byte-identical to the pre-Phase-117 closed-shape test assertions for the common bare-link case"
    - "Mode threaded through the SAME single call site (restoreDashboardUrl) rather than adding a second writer — mirrors dashboardUrl.ts's existing default-parameter pattern from Plan 01"

key-files:
  created: []
  modified:
    - packages/web/src/hooks/useDeepLinkDashboard.ts
    - packages/web/src/hooks/useDeepLinkDashboard.spec.ts
    - packages/web/src/App.tsx

key-decisions:
  - "Task 3's acceptance criterion 1 (`grep -o \"storedId\" ... -> 0`) named the wrong original occurrences: the plan text described \"six existing storedId call sites\" but the actual pre-Phase-117 code called the hook with bare numeric literals (e.g. `useDeepLinkDashboard(12)`) — the six literal `storedId` substrings were all in test-title/describe prose referencing the OLD parameter name. Verified the real intent (retire the stale parameter name from the file entirely, matching how useDeepLinkTable.spec.ts's analogous block is titled 'storedTable parameter') and renamed the six prose occurrences (1 describe title + 5 it titles) from 'storedId' to 'stored dashboard' — not just the already-correct call-site reshaping — so the criterion's AFTER: 0 is satisfied by genuinely retiring the name, not by coincidence."
  - "Task 2's acceptance criterion 1 (`grep -o \"deepLink.mode\" App.tsx -> exactly 4`) is arithmetically inconsistent with its own enumeration: it lists three sites (setDashboardViewMode, restoreDashboardUrl, page prop) as producing the literal substring `deepLink.mode`, then separately notes the commit-payload comparison `d.mode === \"open\"` \"counts separately\" (criterion 1b) — but `d` is a local alias (`const d = deepLink`), so `d.mode` never matches the pattern `deepLink.mode` at all. The real, literal count is 3, exactly matching the criterion's own three-item enumeration. Verified directly (grep -n, read each of the 3 sites) rather than manufacturing a fourth `deepLink.mode` occurrence to force the grep to 4 — no site hardcodes a mode, which is the criterion's stated real intent."
  - "No DSET requirement marked complete, per this plan's own explicit instruction — closure belongs to Plan 06 after operator UAT."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-09-15
---

# Phase 117 Plan 04: App-side dashboard mode threading Summary

**Extended `useDeepLinkDashboard`'s state machine and stored-link parameter with a `DashboardMode`, and replaced every hardcoded `"open"` in `App.tsx`'s dashboard deep-link effect, sign-in-commit payload, and page prop with `deepLink.mode` — closing the loop Plan 02 left as a documented temporary literal.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-15T15:09:00Z (approx.)
- **Completed:** 2026-09-15T15:24:00Z
- **Tasks:** 3 completed
- **Files modified:** 3 (2 production, 1 spec)

## Accomplishments

- `hooks/useDeepLinkDashboard.ts`: `DeepLinkState`'s `pending`/`opened` variants now carry a `mode: DashboardMode` field; the parameter renamed `storedId: number` → `storedDashboard: { id, mode } | null`, mirroring `useDeepLinkTable`'s `storedTable` shape exactly. The mount-time initializer resolves the mode from the URL (`readDashboardModeFromSearch`) or from storage, with URL taking precedence for id AND mode. The resolution effect threads `pendingMode` into the success `setState`. `DEEP_LINK_UNAVAILABLE_MESSAGE` is byte-identical; its comment now records the Phase 117 re-verification that the combined wording still holds.
- `App.tsx` gained `ReturnTo.dashboardMode?: "view" | "edit"` (absent means open); `readPendingDashboardId` was renamed `readPendingDashboard` and now returns `{ id, mode }`, applying the same absent-or-unrecognised-means-"open" rule the URL reader uses; the mount-time `pendingDashboardFromStorage` state and the hook call site were updated to match.
- The dashboard deep-link effect's two hardcoded lines (`setDashboardViewMode("open")`, `restoreDashboardUrl(deepLink.dashboard.id)`) now read `deepLink.mode`. `handleSignInCommit` builds the pending-dashboard payload conditionally — `{ dashboardId, page }` for `mode === "open"`, `{ dashboardId, dashboardMode, page }` otherwise — so the two pre-existing closed-shape assertions in `App.signincommit.spec.tsx` (`:115`, `:128`, both bare `?dashboard=12` links) keep passing unmodified. `initialOpenDashboard`'s page prop now reads `{ dashboard: deepLink.dashboard, mode: deepLink.mode }`, replacing Plan 02's temporary `mode: "open" as const` literal and its now-obsolete comment.
- `hooks/useDeepLinkDashboard.spec.ts` grew from 16 to 28 tests: the six legacy fixtures that called the hook with a bare number were reshaped to `{ id, mode: "open" }` (assertions unchanged), and their prose (1 describe title + 5 `it` titles) was renamed from the stale `storedId` wording to `stored dashboard`/`storedDashboard`, matching the parameter's new name. Twelve new `DSET-117:`-titled tests cover all 12 behaviour bullets: open/view/edit/unrecognised(`banana`)/case-mismatch(`EDIT`) mode resolution, unavailable-strips-both-params, the two-clause message content, stored-mode-on-bare-URL, URL-beats-storage for id AND mode, stored-`null`, StrictMode single-call, and the 401-mid-flight pending-with-mode-intact path.
- Three mandatory mutation probes run against the real implementation and reverted (`git diff --stat` empty after each):
  - **Probe A** (hardcode the success `setState`'s mode to `"open"` instead of `pendingMode`): **4 failed** — the `mode: view`, `mode: edit`, stored-`edit`-on-bare-URL, and URL-beats-storage-for-mode tests (bullets 2, 3, 8, 9).
  - **Probe B** (check `storedDashboard` before the URL in the initializer): **3 failed** — the pre-existing "URL beats storedId 12" test, the pre-existing "?dashboard=abc junk is stripped AND stored 12 still resolves" test, and the new URL-beats-storage-for-mode test (bullet 9).
  - **Probe C** (narrow `DEEP_LINK_UNAVAILABLE_MESSAGE` to the table sibling's one-clause wording): **1 failed** — the new message-content test (bullet 7), confirming it asserts on content, not merely on the imported constant's identity.
- Full suite: **175 files / 3969 tests, 100% green** on the confirming re-run (baseline after Plan 03 was 3957; net **+12**, exactly the new `DSET-117` tests). A first full-suite run showed 2 failures (`DatasetsPage.spec.tsx` and `DashboardContext.spec.tsx`'s unrelated `useDashboardContext` negative-path console-error path); both are pre-documented, load-dependent flakes (`DatasetsPage.spec.tsx` is explicitly named in `deferred-items.md`) — an immediate clean re-run reproduced 175/175 green, and neither failing test touches any file this plan modified. `theme-guard.spec.ts`: 150/150 green. Table-family diff (`tableUrl.ts`, `useDeepLinkTable.ts`, `DatasetsPage.tsx`, `useDeepLinkTable.spec.ts`, `App.tableDeeplink.spec.tsx`, `App.tablePasswordDeepLink.spec.tsx`): empty. `packages/server` diff: empty.

## Task Commits

1. **Task 1: Give DeepLinkState a mode, and reshape the stored-link parameter** - `4ff8ee0` (feat)
2. **Task 2: Thread the resolved mode through App.tsx's effect, commit write and page prop** - `16e31a5` (feat)
3. **Task 3: Extend hooks/useDeepLinkDashboard.spec.ts with mode resolution coverage** - `f05eb0a` (test)

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md are updated below)

## Files Created/Modified

- `packages/web/src/hooks/useDeepLinkDashboard.ts` - `DeepLinkState` carries `mode`; parameter reshaped to `storedDashboard`; resolution effect threads the pending mode into `opened`.
- `packages/web/src/hooks/useDeepLinkDashboard.spec.ts` - 6 legacy fixtures reshaped + renamed prose; 12 new `DSET-117:` tests; 3 reverted mutation probes.
- `packages/web/src/App.tsx` - `ReturnTo.dashboardMode` added; `readPendingDashboard` (renamed) returns `{ id, mode }`; the dashboard deep-link effect, `handleSignInCommit`, and `initialOpenDashboard` all read `deepLink.mode` instead of a hardcoded `"open"`.

## Decisions Made

- **Renamed six stale `storedId`-titled test descriptions to `stored dashboard`/`storedDashboard`.** The plan's Task 3 criterion expected the literal substring `storedId` to read 0 in the spec file after the fixture reshape, but the reshape itself (bare number → `{id, mode}` object) never touched those six occurrences — they were all in test/describe title prose referencing the OLD parameter name, not in code. Renamed the prose to retire the stale name genuinely, matching `useDeepLinkTable.spec.ts`'s own "storedTable parameter" phrasing, rather than leaving the criterion satisfied by coincidence.
- **Left `App.tsx:372-376`'s general "Built conditionally..." comment in place** alongside the new, more specific comment added inside the `d.status === "pending"` branch (mirroring the plan's action text exactly) — the outer comment's claim ("`page` is written EXPLICITLY in both branches...") remains true and un-duplicative of the inner one's narrower claim about `dashboardMode`.
- **No DSET requirement marked complete**, per this plan's own explicit instruction (critical warning 10) — closure is Plan 06's responsibility, after operator UAT.

## Deviations from Plan

### Toothless acceptance criteria found and reported (not gamed)

**1. Task 2 criterion 1 — `grep -o "deepLink.mode" App.tsx | wc -l` expected "exactly 4", actual is 3.**
- **Found during:** Task 2, post-implementation verification.
- **Issue:** The criterion's own text enumerates three sites that produce the literal substring `deepLink.mode` (`setDashboardViewMode`, `restoreDashboardUrl`, the page prop), then states the commit-payload comparison "counts separately" as if it also matched the same grep pattern. It does not: the commit-payload code uses a local alias `const d = deepLink; ... d.mode === "open"`, so the substring `deepLink.mode` never appears there. The literal, case-sensitive count is 3, exactly matching the criterion's own three-item enumeration — the "exactly 4" total is the criterion's own arithmetic error, not a missed call site.
- **Resolution:** Verified directly with `grep -n "deepLink.mode" App.tsx`, confirming exactly 3 sites, all real (no hardcoded mode remains at `setDashboardViewMode`, `restoreDashboardUrl`, or the page prop), and separately confirmed `d.mode === "open"` (1 occurrence) and `dashboardMode: d.mode` (1 occurrence) exist in the commit-payload branch as required by criteria 4/4b. Did not invent a fourth spurious `deepLink.mode` reference to force the grep to read 4.
- **Files affected:** none (no code change made for this finding).

**2. Task 3 criterion 1 — `grep -o "storedId" hooks/useDeepLinkDashboard.spec.ts | wc -l` expected BEFORE 6 / AFTER 0, and BEFORE was correct but for the wrong reason.**
- **Found during:** Task 3, immediately after the fixture-fix step.
- **Issue:** The plan's action text says "the six existing storedId call sites become `{ id: <number>, mode: 'open' }`" — implying the code itself used an identifier or literal `storedId`. In fact the pre-Phase-117 code called the hook with bare numbers (`useDeepLinkDashboard(12)`); the six literal `storedId` substrings were all in test/describe title strings referencing the parameter's OLD name. Reshaping only the six numeric call sites (as literally instructed) left the count at 6, unchanged — the fixture reshape and the prose cleanup are two different edits that happened to share a "six" count.
- **Resolution:** Verified the real intent (retire the stale parameter name from the file) and renamed the six title-prose occurrences from `storedId` to `stored dashboard`/`storedDashboard`, which both satisfies the literal grep (0 after) and matches `useDeepLinkTable.spec.ts`'s own precedent for naming this describe block after the current parameter name.
- **Files affected:** `packages/web/src/hooks/useDeepLinkDashboard.spec.ts` (title-only edits, no assertion changed).

### Non-blocking investigation (confirmed NOT a regression, no fix needed)

**3. First full-suite run showed 2 failures in `DatasetsPage.spec.tsx` and `DashboardContext.spec.tsx`; a clean re-run passed 175/175.**
- **Found during:** Final full-suite verification (Task 3 gate).
- **Issue:** `DatasetsPage.spec.tsx`'s `renderAndNavigateToDetail` helper timed out waiting for a "View" button; `DashboardContext.spec.tsx` printed its own pre-existing intentional negative-path console error (`useDashboardContext must be used inside DashboardContext.Provider`) without an actual test failure attributed to it in the summary line.
- **Investigation:** `DatasetsPage.spec.tsx` is explicitly named in this phase's own `deferred-items.md` as a file that "has flaked once and proved non-reproducible" under heavy parallel load. Per the suite-stability note's instruction, re-ran the full suite immediately: **175 files / 3969 tests, 100% green**, with no code or test change in between. Neither failing test touches any file this plan modified (`useDeepLinkDashboard.ts`, its spec, or `App.tsx`).
- **Resolution:** No code change. Logged here per the plan's own gate note, consistent with Plan 03's identical finding for the same file.
- **Files affected:** none.

---

**Total deviations:** 1 code change made (title-only prose rename, not a grep-gaming edit — it retires a stale identifier genuinely); 2 toothless-criteria findings reported and verified directly; 1 non-blocking flake investigated and confirmed not a regression.
**Impact on plan:** No scope creep. Both toothless-criteria findings were verified against the real requirement ("no site hardcodes a mode" / "the stale parameter name is retired") rather than worked around by inventing spurious code.

## Issues Encountered

- See Deviation #3 above (the `DatasetsPage.spec.tsx`/`DashboardContext.spec.tsx` transient failures) — investigated per the suite-stability protocol, confirmed non-reproducible and unrelated to this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- No line in `App.tsx` hardcodes a dashboard mode any more: `grep -c 'setDashboardViewMode("open")' App.tsx` reads 0, and `grep -c 'mode: "open" as const' App.tsx` reads 0 (Plan 02's temporary literal is gone).
- Exactly one sessionStorage key (`kbi_returnTo`) carries the extended `ReturnTo` shape; `RETURN_TO_KEY` occurs once as a declaration.
- All 79 pre-existing App-family tests and all 15 table-family App tests pass with zero assertions edited; the table file family (`tableUrl.ts`, `useDeepLinkTable.ts`, `DatasetsPage.tsx`, and their specs) has zero diff across this entire plan.
- No DSET requirement marked complete, per this plan's own success criteria — Plans 05-06 remain, and DSET-V122-03/-04/-07/-08's end-to-end behavior is now real (no longer gated behind a temporary literal), ready for Plan 05's UI-level coverage and Plan 06's operator UAT + closure.

## Self-Check: PASSED

- FOUND: packages/web/src/hooks/useDeepLinkDashboard.ts
- FOUND: packages/web/src/hooks/useDeepLinkDashboard.spec.ts
- FOUND: packages/web/src/App.tsx
- FOUND: .planning/phases/117-dashboard-settings-links/117-04-SUMMARY.md
- FOUND commit: 4ff8ee0
- FOUND commit: 16e31a5
- FOUND commit: f05eb0a

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
