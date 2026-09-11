---
phase: 113-dashboard-url-sync
verified: 2026-09-11T15:46:07Z
status: passed
score: 13/13 must-haves verified
---

# Phase 113: Dashboard URL Sync Verification Report

**Phase Goal:** The browser address bar always reflects which dashboard, if any, is open — kept in sync via the native History API, no new dependency.
**Verified:** 2026-09-11T15:46:07Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking Open on a dashboard changes the address bar to `?dashboard=<id>` immediately, before widgets fetch | VERIFIED | `DashboardsPage.tsx:225` calls `openDashboardUrl(dash.id)` synchronously before `setView(...)`. Automated: `URLSYNC-113: opening a dashboard puts ?dashboard=<id> in the address bar` (jsdom). Operator: UAT-113-1 PASS, "does NOT appear-then-vanish" confirmed. |
| 2 | Browser Back while a dashboard is open puts the list back on screen and removes `?dashboard=` | VERIFIED | `DashboardsPage.tsx:121-132` popstate handler, param-absent branch. Automated: `URLSYNC-113: browser Back from an open dashboard returns to the dashboard list`. Operator: UAT-113-2 PASS. |
| 3 | In-app "Back to dashboards" leaves no `?dashboard=` in the address bar | VERIFIED | `DashboardsPage.tsx:145` calls `leaveDashboardUrl()`. Automated: two specs cover the sync pop-call and the eventual traversal-cleared URL. Operator: UAT-113-2/3 context. |
| 4 | In-app Back on an entry NOT pushed by this app writes the list URL instead of `history.back()`, so the user is never ejected | VERIFIED | `dashboardUrl.ts` `leaveDashboardUrl()` branches on `DASHBOARD_HISTORY_MARKER`; unmarked entry → `clearDashboardUrl()`, never `history.back()`. Direct spec: `"writes the list URL when there is no history entry to pop"` asserts `backSpy` called 0 times (confirmed present, `grep -c "no history entry to pop"` = 1). |
| 5 | Browser Forward into an entry already left does not leave a stale `?dashboard=` while the list is on screen | VERIFIED | `DashboardsPage.tsx:126-128`, `else if (view.mode !== "open") clearDashboardUrl();` — reconciles without opening. Automated: `URLSYNC-113: browser Forward into an entry we already left clears the stale param instead of re-opening` (asserts both URL clears AND list stays on screen). Operator: UAT-113-5 PASS, address bar confirmed `"http://localhost:5173/"`. |
| 6 | Sidebar navigation away (full unmount) clears `?dashboard=`; a 401/logout unmount leaves it alone | VERIFIED | `DashboardsPage.tsx:608-639`, `DashboardOpen` deferred unmount cleanup gated on `useAuthStore.getState().status === "authenticated"`. Automated: both the authenticated-unmount-clears and the unauthenticated-unmount-preserves specs pass. Operator: UAT-113-6 PASS, screenshots show no param after Datasets round-trip. |
| 7 | Opening in React StrictMode leaves `?dashboard=<id>` intact — the double-invoked cleanup does not wipe it | VERIFIED | Ref-cancelled `window.setTimeout` deferral (`clearUrlTimer` ref, cancel-on-remount) — NOT a naive `useEffect(() => () => {...}, [])`. Confirmed by direct experiment (see below): swapping in the naive form makes the `StrictMode double-invoke` test fail (`search` goes to `""`); the shipped form passes. |
| 8 | Reopening a different dashboard immediately after leaving one leaves the new dashboard's param intact | VERIFIED | Cleanup captures `openedId = dashboard.id` and compares `!== openedId`, not a global "any id present" check. Confirmed by direct experiment: swapping in a global `=== null` check makes the `stale unmount timer` test fail (`search` goes to `""` instead of `"?dashboard=88"`); the shipped form passes. |
| 9 (Plan 02) | Real browser: opening shows `?dashboard=<id>` | VERIFIED (operator) | UAT-113-1 PASS. |
| 10 (Plan 02) | Real browser: Back returns to list, param gone | VERIFIED (operator) | UAT-113-2 PASS. |
| 11 (Plan 02) | Real browser: history stack stays one entry deep — Back-after-in-app-Back exits the app, not re-opens the dashboard | VERIFIED (operator) | UAT-113-3 PASS — operator confirmed the dashboard did not re-open (auth-boot bounce noted and correctly not treated as a history artefact). |
| 12 (Plan 02) | Real browser: Forward after in-app Back does not leave a stale param | VERIFIED (operator) | UAT-113-5 PASS. |
| 13 (Plan 02) | Real browser: sidebar navigation away clears the param | VERIFIED (operator) | UAT-113-6 PASS. |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/dashboardUrl.ts` | Pure param helpers + 3 History-API writers, 7 exported symbols | VERIFIED | All 7 symbols present exactly as the plan's `<interfaces>` contract specifies; matches reference implementation verbatim. |
| `packages/web/src/lib/dashboardUrl.spec.ts` | Direct spec incl. no-history-entry-to-pop case | VERIFIED | 22 `it(...)` blocks; contains the exact title `"writes the list URL when there is no history entry to pop"`; `npx vitest run` passes (22/22). |
| `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` | Component spec: open/back/forward/unmount | VERIFIED | 10 `URLSYNC-113:`-prefixed tests (plan required ≥8), all pass. |
| `packages/web/src/components/DashboardsPage.tsx` | 5 wiring edits | VERIFIED | Import (1), Open button `openDashboardUrl(dash.id)` (1), open-branch `onBack` → `leaveDashboardUrl()` (1), popstate listener with `view.mode` in deps, `DashboardOpen` deferred instance-scoped unmount cleanup. All grep counts from the plan's acceptance criteria reproduced exactly (`openDashboardUrl`=2, `leaveDashboardUrl()`=1, `clearDashboardUrl`=4 — 3 real calls + 1 explanatory comment, documented and accepted in 113-01-SUMMARY as a criterion-arithmetic issue not an implementation gap, verified correct), `openedId`=2. |
| `.planning/phases/113-dashboard-url-sync/113-UAT.md` | Operator's recorded pass/fail for 6 real-browser checks | VERIFIED | 6/6 `UAT-113-` lines, all PASS, verdict "APPROVED — 6/6 checks passed", not self-approved (operator observations quoted verbatim). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Open button (`:225`) | `openDashboardUrl` | called before `setView({mode:"open"})` | WIRED | Confirmed by reading the line; order is `openDashboardUrl(dash.id); setView(...)`. |
| open-branch `onBack` (`:145`) | `leaveDashboardUrl` | called inside handler | WIRED | Only the `view.mode === "open"` branch touched; the other 3 `onBack={() => setView({ mode: "list" })}` sites (create/view/edit) are byte-identical to before. |
| popstate listener | `readDashboardIdFromSearch` | `useEffect` w/ `[onViewChange, view.mode]` deps | WIRED | `view.mode` confirmed present in the dependency array — the Forward-reconcile branch cannot read a stale closure. |
| popstate Forward branch | `clearDashboardUrl` | `else if (view.mode !== "open")` | WIRED | Confirmed at `:126-128`; does not set `view.mode` to `"open"` anywhere — no re-open path exists in this listener. |
| `DashboardOpen` unmount | `clearDashboardUrl` | deferred `window.setTimeout`, gated on `useAuthStore.getState().status === "authenticated"` | WIRED | Confirmed at `:620-639`; ref-cancelled (StrictMode-safe), scoped to `openedId` (not global). |
| `DashboardsPage.urlsync.spec.tsx` | React StrictMode | wraps `render()` in `React.StrictMode` | WIRED | Confirmed lines 202-211 of the spec; mirrors `MapChartRenderer.spec.tsx:1252-1266` precedent. |

### Discrimination-Test Verification (direct experiment, not just reading the plan)

Both of the phase's two highest-risk guard tests were independently re-verified by this verifier — not merely trusted from the SUMMARY's narrative — by temporarily swapping in the exact broken forms the plan describes and re-running the targeted test, then restoring the file to its committed state (confirmed clean via `git status --short` / `git diff --stat` afterward):

1. **StrictMode test vs. naive `useEffect(() => () => {...}, [])` cleanup:** swapped in the naive form → `URLSYNC-113: StrictMode double-invoke does not wipe the just-opened param` FAILED with `expected '' to be '?dashboard=77'` — i.e. the naive cleanup really does wipe the param React 18 StrictMode's mount→cleanup→mount would otherwise wipe in dev. Shipped ref-cancelled form passes.
2. **Stale-timer test vs. global "is any id present" check:** swapped `!== openedId` for `=== null` → `URLSYNC-113: a stale unmount timer does not clear a different dashboard's param` FAILED with `expected '' to be '?dashboard=88'` — i.e. a departing instance's stale timer really does wipe a freshly-opened different dashboard's valid param under the global form. Shipped `openedId`-scoped form passes.

Both tests are therefore genuine discrimination tests, not toothless structural greps — this is the defence CLAUDE.md's "Writing verifiable acceptance criteria" section asks for, and it holds up under direct adversarial testing.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DLINK-V121-01 | 113-01, 113-02 | Opening a dashboard puts a link in the address bar | SATISFIED | Code (Open button wiring) + automated spec + operator UAT-113-1/4 PASS. `.planning/REQUIREMENTS.md` updated from "In Progress" to "Complete" by this verification (checkbox `[x]` and traceability row both updated). |
| DLINK-V121-06 | 113-01, 113-02 | Browser Back from an open dashboard returns to the list | SATISFIED | Code (popstate param-absent branch) + automated spec + operator UAT-113-2 PASS. `.planning/REQUIREMENTS.md` updated to "Complete". |
| DLINK-V121-07 | 113-01, 113-02 | Leaving a dashboard removes it from the address bar on every route out | SATISFIED | Code covers all four exits (in-app Back, browser Back, browser Forward reconcile, full unmount/sidebar-away) + automated specs for each + operator UAT-113-3/5/6 PASS. `.planning/REQUIREMENTS.md` updated to "Complete". |

No orphaned requirements: REQUIREMENTS.md maps exactly DLINK-V121-01/06/07 to Phase 113 and all three appear in 113-01-PLAN.md's `requirements` frontmatter.

**Traceability update made by this verification:** `.planning/REQUIREMENTS.md` lines 19/24/25 (checkboxes) and lines 65/70/71 (traceability table) changed from `[ ]` / "In Progress (113-01 code + tests done; awaiting 113-02 operator walk-through)" to `[x]` / "Complete (113-01 code + tests; 113-02 operator UAT approved 6/6 2026-09-11)" for all three IDs. This reflects that the operator checkpoint referenced in 113-UAT.md genuinely passed 6/6 and was not self-approved, and that the code behind every browser-observed behavior was independently confirmed present and correct (including the two discrimination tests, re-run against their broken forms).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | `grep -n -E "TODO\|FIXME\|XXX\|HACK\|PLACEHOLDER"` across all four phase files returned nothing. No empty-return stubs, no console.log-only handlers. |

### Scope Fence Verification

- `git diff origin/master -- packages/web/src/App.tsx` → empty. `App.tsx` is genuinely unmodified.
- `grep -c "readDashboardIdFromSearch" packages/web/src/App.tsx` → 0. No boot-time URL reading anywhere.
- All `readDashboardIdFromSearch` call sites in `DashboardsPage.tsx` are inside the `popstate` handler or the `DashboardOpen` unmount cleanup — none in a render body, mount effect, or state initializer.
- `git diff origin/master -- packages/package.json packages/web/package.json packages/server/package.json` → empty. No new dependency.
- The one new `className="btn-primary btn-sm"` diff line is pre-existing (confirmed identical in `origin/master`'s version of the same button) — only the `onClick` handler changed on that line, not the class.
- No hardcoded hex introduced (`git diff origin/master` on the two touched files, checked for `#[0-9a-fA-F]{3,6}` in added lines → none).

### Gates

- `packages/web && npx tsc --noEmit` → clean.
- `packages/web && npx vitest run` → 164 test files, 3700 tests, all passed.
- `packages/web && npx vitest run src/styles/theme-guard.spec.ts` → 150/150 passed.

### Known Pre-Existing Defect (carried tech debt, not a phase gap)

**Sidebar "Dashboards" link is a no-op while a dashboard is open.** `Sidebar.tsx`'s `onSelect` → `App.tsx`'s `onSelect={(key) => { ...; setPage(key as Page); ... }}` calls `setPage("dashboards")` when `page` is already `"dashboards"`; React bails the no-op state update, so `DashboardsPage` (and therefore `DashboardOpen`) never unmounts, and the view stays `{ mode: "open" }`.

Confirmed pre-existing: `git diff origin/master -- packages/web/src/App.tsx` is empty on this branch, and the `DashboardsPage.tsx` diff touches only the open/onBack/popstate/unmount paths added by this phase — nothing related to the sidebar `onSelect` handler.

**Not a DLINK-V121-07 violation:** the user genuinely remains on the open dashboard, and the address bar genuinely still carries that dashboard's id — screen and URL agree. DLINK-V121-07 only requires the URL never describe a screen the user is *not* on; this case describes exactly the screen the user *is* on. It is a navigation-UX defect (clicking "Dashboards" while already there does nothing visible), not a URL-sync defect, and is correctly logged in `113-UAT.md` under "Findings outside this phase" rather than as a phase gap.

### Human Verification Required

None outstanding. The six real-browser checks this phase's design explicitly deferred to a human (history-stack depth, the physical Forward button, and address-bar rendering) were already performed by the operator and recorded in `113-UAT.md` with a verdict of "APPROVED — 6/6 checks passed," including verbatim address-bar contents for the two checks (5 and 6) that specifically exist to catch a stale param invisible from the screen alone. This verification independently re-confirmed the code paths behind all six checks exist and behave as claimed.

### Gaps Summary

None. All 13 must-haves across both plans verified: the helper module and its exports match the interface contract exactly; all five wiring edits in `DashboardsPage.tsx` are present and correctly scoped (only the open-dashboard `onBack`, not the create/view/edit sub-views); the three review-driven fixes (ref-cancelled deferral, `openedId`-scoped comparison, `view.mode` in the popstate effect's deps) are all present in the shipped code, not just described in the plan; the two discrimination tests were independently re-run against their broken forms by this verifier and genuinely fail against them; the scope fence holds (no boot-time reads, `App.tsx` untouched, no new dependency, no new className/hex); all three REQ-IDs are genuinely satisfied and have been updated from "In Progress" to "Complete" in `REQUIREMENTS.md`; and the one known defect surfaced during UAT is confirmed pre-existing and correctly out of this phase's scope.

---

*Verified: 2026-09-11T15:46:07Z*
*Verifier: Claude (gsd-verifier)*
