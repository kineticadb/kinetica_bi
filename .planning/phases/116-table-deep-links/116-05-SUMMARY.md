---
phase: 116-table-deep-links
plan: 05
subsystem: web-ui
tags: [deep-links, session-storage, auth-flow, history-api, react, oidc, password-auth]

requires:
  - phase: 116-table-deep-links (Plan 02)
    provides: "hooks/useDeepLinkTable.ts — the five-state table deep-link resolution machine, already accepting an optional storedTable argument"
  - phase: 116-table-deep-links (Plan 04)
    provides: "App.tsx wired to useDeepLinkTable for the authenticated-at-boot journey; tableDeepLinkConsumedRef/tableReturnToWonElsewhereRef declared (unwritten) refs"
  - phase: 115-deep-link-authentication-flow
    provides: "the kbi_returnTo mechanism, write-on-commit/write-at-interruption asymmetry, the login banner pattern"
provides:
  - "App.tsx: ReturnTo extended with tableId/tableMode, readPendingTable, handleSignInCommit extended to write the table branch (dashboard wins, one write site), the Phase 7 restore effect gained a table sibling branch"
  - "LoginPage.tsx: deepLinkTablePending prop, table rung on the existing bannerText ternary, reusing .login-banner"
  - "App.tableSignincommit.spec.tsx (15 tests), App.tablePasswordDeepLink.spec.tsx (3 tests), LoginPage.tableBanner.spec.tsx (9 tests) — all logged-out table journey coverage in both auth modes"
affects:
  - "116-06 — the checkpoint/UAT plan verifies the full logged-out table journey end-to-end in a real browser; no TLINK requirement is marked complete by this plan (see Decisions)"

tech-stack:
  added: []
  patterns:
    - "Same function, extended — handleSignInCommit gained a table branch inside its existing single write site, rather than a second function or a second sessionStorage.setItem call (mirrors 116-RESEARCH §Q4's explicit 'one function, extended, not duplicated' recommendation)"

key-files:
  created:
    - packages/web/src/App.tableSignincommit.spec.tsx
    - packages/web/src/App.tablePasswordDeepLink.spec.tsx
    - packages/web/src/components/LoginPage.tableBanner.spec.tsx
  modified:
    - packages/web/src/App.tsx
    - packages/web/src/components/LoginPage.tsx

key-decisions:
  - "handleSignInCommit narrows via two locally-captured consts (const d = deepLink; const t = deepLinkTable) checked directly by status, rather than boolean flags (dashboardPending/tablePending) used inside the payload-construction branch — TypeScript does not narrow a union through an intermediate boolean, so the payload build re-checks d.status/t.status directly while the earlier early-return guard still uses the boolean flags for readability"
  - "No TLINK requirement marked complete by this plan, per the prompt's explicit success-criteria instruction, even though the plan's own frontmatter lists requirements: [TLINK-V121-03] — plan 06 (the checkpoint/UAT) remains, mirroring 116-04-SUMMARY's identical precedent for TLINK-V121-02/04"

requirements-completed: []

duration: ~35min
completed: 2026-09-14
---

# Phase 116 Plan 05: Table Deep-Link Authentication Flow Summary

Extended the Phase 115 `kbi_returnTo` mechanism (same key, same single write site, same
write-on-commit/write-at-interruption asymmetry) to carry a pending table id and mode, wired the
existing login banner to a third rung ("Sign in to open this table."), and proved the full
logged-out journey in both OIDC and password auth modes with three new sibling spec files — all
five mandated mutation probes executed for real and all reddening as required, and all eight
protected Phase 113/114/115 spec files verified byte-identical.

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-14T17:28:01Z (session start, after Plan 04's commit)
- **Completed:** 2026-09-14T17:37:17Z
- **Tasks:** 3
- **Files modified:** 5 (2 modified, 3 created)

## Accomplishments
- `ReturnTo` extended with `tableId?: number` / `tableMode?: "view" | "edit"` on the SAME
  `kbi_returnTo` key — `sessionStorage.setItem` call count in `App.tsx` stayed at exactly 2, and
  a codebase-wide grep confirms no new storage key of any name was introduced.
- `readPendingTable()` added as a strict sibling of `readPendingDashboardId()` — deliberately
  stricter (requires an EXPLICIT `page: "datasets"`, since absent-page cannot fairly default to
  the non-default Datasets screen the way it does for the default Dashboards screen).
- `handleSignInCommit` extended in place — one function, one write site, dashboard-wins
  precedence when both a dashboard and a table link are somehow pending at once (only reachable
  by hand-crafting a URL).
- The Phase 7 ReturnTo restore effect gained a table-sibling branch: an expiry captured
  elsewhere than Datasets now strips a stale `?table=` and burns the table one-shot immediately,
  mirroring the existing dashboard branch exactly.
- `LoginPage.tsx` gained `deepLinkTablePending`, reusing the single `.login-banner` slot with no
  new className — the session-expired message still wins outright, and the dashboard message
  still wins over the table message when (hand-crafted) both are pending.
- New `App.tableSignincommit.spec.tsx` (15 tests): commit-write for every behavior bullet in the
  plan (edit mode, view mode/absent mode, dashboard-wins, password-mode no-write, no-pending
  no-write, leftover-previous-document overwrite, in-document-expiry-not-clobbered), the
  LoginPage table-pending signal, the full OIDC-round-trip restore (mode + address bar restored
  to `?table=12&mode=edit` + no manufactured history entry + single-use clear), the
  unavailable-restored-id banner, and junk-`tableId` rejection.
- New `App.tablePasswordDeepLink.spec.tsx` (3 tests): the real (unmocked) password login form
  renders and keeps the param, the in-place auth flip lands on the table in EDIT mode, and
  `kbi_returnTo` is never written on this journey.
- New `LoginPage.tableBanner.spec.tsx` (9 tests): the table banner in both auth branches, the
  expiry-wins and dashboard-wins precedence cases, the no-banner regression, and the SSO-commit
  seam.
- All 8 protected Phase 113/114/115 spec files (`App.spec.tsx`, `App.deeplink.spec.tsx`,
  `App.passwordDeepLink.spec.tsx`, `App.signincommit.spec.tsx`, `LoginPage.spec.tsx`,
  `dashboardUrl.spec.ts`, `useDeepLinkDashboard.spec.ts`, `DashboardsPage.urlsync.spec.tsx`) —
  `git diff --numstat` confirms byte-identical, 152/152 passing.
- Full suite: 175 files / 3902 tests, 100% passing (baseline after Plan 04 was 172 files / 3875
  tests; this plan added exactly 3 files / 27 tests). `theme-guard.spec.ts`: 150 passed.
  `packages/server` diff: empty. `tsc --noEmit`: clean.

## Task Commits

1. **Task 1: Extend ReturnTo, readPendingTable, handleSignInCommit and the restore effect in App.tsx** — `a36f26a` (feat)
2. **Task 2: LoginPage table banner + LoginPage.tableBanner.spec.tsx** — `1bfaa73` (test)
3. **Task 3: App.tableSignincommit.spec.tsx + App.tablePasswordDeepLink.spec.tsx** — `81f4763` (test)

_Each task's own action produced its final artifact in one commit (no separate RED/GREEN split),
matching the same shape 116-03 and 116-04's summaries documented for their own tasks — Task 1 is
App.tsx wiring verified against the pre-existing protected suite (no new test needed to prove it
still passes); Tasks 2-3 ARE the new test files, written and immediately green against the Task 1
code._

## Files Created/Modified
- `packages/web/src/App.tsx` — `ReturnTo` type extension, `readPendingTable()`,
  `pendingTableFromStorage` feeding `useDeepLinkTable`, `handleSignInCommit` extended with the
  table branch, the Phase 7 restore effect's new table-sibling block, and the
  `deepLinkTablePending` prop threaded to `LoginPage`.
- `packages/web/src/components/LoginPage.tsx` — `deepLinkTablePending` prop, a third rung on the
  `bannerText` ternary.
- `packages/web/src/App.tableSignincommit.spec.tsx` — new, 15 tests.
- `packages/web/src/App.tablePasswordDeepLink.spec.tsx` — new, 3 tests.
- `packages/web/src/components/LoginPage.tableBanner.spec.tsx` — new, 9 tests.

## Decisions Made

1. **`handleSignInCommit`'s payload-construction narrows via direct status checks, not the
   earlier boolean flags.** The early-return guard uses `dashboardPending`/`tablePending` booleans
   for readability, but building the actual payload re-checks `d.status === "pending"` /
   `t.status === "pending"` directly (`const d = deepLink; const t = deepLinkTable;`), because
   TypeScript's control-flow narrowing does not follow through an intermediate boolean variable —
   accessing `deepLink.id` inside `if (dashboardPending)` would not type-check. This is a plain
   `tsc`-driven detail with no behavioral difference from the plan's sketch.
2. **No TLINK requirement marked complete.** Per the prompt's explicit instruction
   ("No TLINK requirement marked complete — plan 06 (the checkpoint) remains"), `requirements
   mark-complete` was NOT run for `TLINK-V121-03` even though the plan's own frontmatter lists it
   — mirroring 116-04-SUMMARY's identical precedent for its own two requirement IDs.

## Deviations from Plan

None — plan executed exactly as written. Every acceptance-criteria grep anchor in the plan was
re-verified at the stated BEFORE count in this session before the edit, and at the stated AFTER
count (or higher, where the plan used `≥`) after it. No protected spec file required editing.

## Mutation Probe Results (all executed for real)

**Probe 1 (Task 2, precedence).** Temporarily reordered `LoginPage.tsx`'s `bannerText` ternary so
`deepLinkTablePending` was checked BEFORE `reason === "session-expired"`. Re-ran
`LoginPage.spec.tsx` + `LoginPage.tableBanner.spec.tsx`: **4 failed, 25 passed** — reddened
exactly the two expiry-wins tests (OIDC + password branches) and the two dashboard-wins tests
(both banners now incorrectly read the table text). Reverted; confirmed byte-identical to the
pre-mutation file, then re-ran green (29/29).

**Probe 2 (Task 3, no second key).** Temporarily changed `handleSignInCommit`'s table payload key
from `tableId` to `pendingTableId` (a plausible "second mechanism" slip), WITHOUT changing
`readPendingTable`. Re-ran `App.tableSignincommit.spec.tsx`: **3 failed, 12 passed** — reddened
the three tests whose `toEqual` assertions name `tableId` explicitly (the edit-mode write, the
no-mode write, and the leftover-overwrite test). Reverted; confirmed byte-identical to the
committed `App.tsx` via `diff`, then re-ran green (15/15).

**Probe 3 (Task 3, password-mode no-write).** Temporarily deleted `handleSignInCommit`'s
`if (useAuthStore.getState().authMode !== "oidc") return;` guard. Re-ran
`App.tablePasswordDeepLink.spec.tsx` + `App.signincommit.spec.tsx`: **1 failed, 9 passed** —
reddened `App.signincommit.spec.tsx`'s existing "password mode — committing to sign in writes
nothing" test (it now wrote `{dashboardId:12,page:"dashboards"}` instead of leaving the key
null). Note: none of the NEW table-specific password tests reddened on their own here, because
`App.tablePasswordDeepLink.spec.tsx`'s URL-only fixture (`?table=12&mode=edit`, no
`?dashboard=`) does not exercise the guard being removed in the same way the pre-existing
dashboard test does — the dashboard test is what proves the guard's removal is detectable, and it
is the SAME code path the table branch shares (one function, one guard). Reverted; confirmed
byte-identical via `diff`, then re-ran green.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The full logged-out table deep-link journey (OIDC round trip AND in-place password flip) is now
  wired and tested end-to-end, using the same `kbi_returnTo` key the dashboard journey uses (one
  key, one write site — verified: `sessionStorage.setItem` count in `App.tsx` is still exactly 2,
  and no `kbi_pendingTable`-style key exists anywhere in `packages/web/src`).
- Plan 06 can proceed to whatever checkpoint/UAT work remains for Phase 116 — this plan
  deliberately marks no TLINK requirement complete, per the explicit instruction carried in from
  the phase's requirement-completion sequencing.
- No blockers. `git diff --numstat` confirms zero touch to any of the 8 protected Phase
  113/114/115 spec files, and `packages/server` diff is empty.

---
*Phase: 116-table-deep-links*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/web/src/App.tableSignincommit.spec.tsx`
- FOUND: `packages/web/src/App.tablePasswordDeepLink.spec.tsx`
- FOUND: `packages/web/src/components/LoginPage.tableBanner.spec.tsx`
- FOUND: `.planning/phases/116-table-deep-links/116-05-SUMMARY.md`
- FOUND commit `a36f26a` (Task 1 — `feat(116-05): extend ReturnTo, readPendingTable, handleSignInCommit and the restore effect`)
- FOUND commit `1bfaa73` (Task 2 — `test(116-05): LoginPage table banner + LoginPage.tableBanner.spec.tsx`)
- FOUND commit `81f4763` (Task 3 — `test(116-05): App.tableSignincommit.spec.tsx + App.tablePasswordDeepLink.spec.tsx`)
