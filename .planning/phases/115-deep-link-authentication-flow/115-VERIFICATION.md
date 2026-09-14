---
phase: 115-deep-link-authentication-flow
verified: 2026-09-14T15:00:00Z
status: passed
score: 5/5 must-haves verified (plus 4/4 ROADMAP-mapped sub-checks)
---

# Phase 115: Deep Link Authentication Flow Verification Report

**Phase Goal:** A dashboard link works even for a visitor who isn't logged in yet — it routes through login and lands them on the dashboard from the link, not the dashboard list.
**Verified:** 2026-09-14
**Status:** passed
**Re-verification:** No — initial verification (no prior 115-VERIFICATION.md existed)
**Tree verified:** current branch tip (post-Phase-116, ~21 commits after Phase 115's own last commit) — NOT just Phase 115's own commits.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Visiting a dashboard link while not authenticated routes to the login page rather than erroring | ✓ VERIFIED | `App.tsx:565-567` — the `status !== "authenticated"` branch returns `<LoginPage .../>` and sits ABOVE the deep-link `pending` hold at `:575`, so an unauthenticated deep-link arrival never gets stuck on `Loading…`. Pinned by `App.deeplink.spec.tsx`'s `"DEEPLINK-114: an unauthenticated arrival goes to login and keeps the param for Phase 115"` and by all three `App.passwordDeepLink.spec.tsx` tests — all pass on the current tree. |
| 2 | After completing authentication, the user lands directly on the dashboard from the original link — reusing/extending the existing Phase 7 sessionStorage return-to-page mechanism, not a second mechanism | ✓ VERIFIED | `ReturnTo.dashboardId` extends the SAME `kbi_returnTo` key (`App.tsx:39-56`); no second key exists (`grep -rl "kbi_pendingDashboard\|kbi_deepLink\|kbi_pendingLink" src` → no files). `handleSignInCommit` (`App.tsx:331-376`) writes it at commit time, gated on `authMode === "oidc"`. The deep-link effect (`App.tsx:465-482`) opens the dashboard and calls `restoreDashboardUrl` to re-sync the address bar after the OIDC round trip. Password mode needs no write (proven by `App.passwordDeepLink.spec.tsx`, unmodified `App.tsx`/`LoginPage.tsx` at that plan's commit). |

**Score:** 2/2 ROADMAP truths verified.

### Plan-Level Must-Haves (from 115-01/02/03/04 PLAN.md frontmatter)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | One shared `isValidDashboardId` predicate for both URL and sessionStorage ids | ✓ VERIFIED | `dashboardUrl.ts:30-32` defines it; `readDashboardIdFromSearch` (`:39`) and `App.tsx`'s `readPendingDashboardId` (`:79`) both route through it. |
| 2 | `restoreDashboardUrl` re-syncs the address bar via `replaceState`, no new history entry | ✓ VERIFIED | `dashboardUrl.ts:90-92` — `window.history.replaceState`. `pushState` count in the file is still 1 (only in `openDashboardUrl`). |
| 3 | `useDeepLinkDashboard` accepts a stored id at mount, without reading sessionStorage itself | ✓ VERIFIED | `useDeepLinkDashboard(storedId?: number \| null)` consumes it in the mount-time lazy initializer; `grep "sessionStorage"` in the hook file matches only 2 **comment** lines, zero API calls. |
| 4 | Password-mode logged-out paste already worked, pinned by a regression test | ✓ VERIFIED | `App.passwordDeepLink.spec.tsx` — 3/3 tests pass on the current tree. |
| 5 | `handleSignInCommit` writes the pending dashboard id, gated on `authMode === "oidc"`, at commit time (not on arrival) | ✓ VERIFIED | `App.tsx:335` — `if (useAuthStore.getState().authMode !== "oidc") return;` inside `handleSignInCommit`, fired from `LoginPage`'s SSO anchor `onClick` (`LoginPage.tsx:69`), not on page render/arrival. |
| 6 | The `UNAUTHORIZED_EVENT` write and the commit-time write are NOT unified, and a comment explains why | ✓ VERIFIED | `App.tsx:323-328` contains the exact `⚠️ DELIBERATELY NOT UNIFIED …` comment block explaining the two-sources/two-moments/one-key reasoning. `grep -c "DELIBERATELY NOT UNIFIED"` → 1. |
| 7 | Exactly ONE sessionStorage key (`kbi_returnTo`) | ✓ VERIFIED | `grep -c "const RETURN_TO_KEY"` → 1; no `kbi_pendingDashboard`/`kbi_deepLink`/`kbi_pendingLink` anywhere in `src`. |
| 8 | `returnToWonElsewhereRef` suppresses a stale deep link IMMEDIATELY, not by delay | ✓ VERIFIED | `App.tsx:419-427` sets `returnToWonElsewhereRef.current = true` AND `deepLinkConsumedRef.current = true` in the SAME synchronous block as the ReturnTo restore (`deepLinkConsumedRef.current = true` count is 2, not 1 — the second one is this immediate burn, with a `SUPPRESS NOW` comment explaining why a delayed flip would be insufficient). Confirmed by the passing test `"AUTHLINK-115: the suppressed stale link does not resurface later in the same session"` in `App.deeplink.spec.tsx`, which clicks through to Dashboards after suppression and asserts the link does not reopen. |
| 9 | `restoreDashboardUrl` is called on the opened path so the address bar is re-synced after an OIDC round trip | ✓ VERIFIED | `App.tsx:478` — `restoreDashboardUrl(deepLink.dashboard.id);` inside the `deepLink.status === "opened"` branch. Confirmed by 3 passing tests: address-bar restore, no new history entry (`window.history.length` unchanged), and single-use key clearing. |
| 10 | The one amended Phase 114 test preserves Phase 114's intent, with the amendment recorded | ✓ VERIFIED | `App.deeplink.spec.tsx:183-197` contains the `PHASE 115 AMENDMENT` comment block; the old test title `"a pasted link beats the Phase 7 ReturnTo page restore"` is gone (count 0); it's replaced by `"AUTHLINK-115: a committed fresh paste beats a leftover ReturnTo page"` (Phase 114's intent, in the shape the app now actually produces) and `"AUTHLINK-115: an expiry captured on Roles beats a stale dashboard param, and the param is stripped"` (the inversion). 8 of the original 9 `DEEPLINK-114:` test TITLES survive untouched (verified directly by listing them). |

**Score:** 10/10 plan-level truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/web/src/lib/dashboardUrl.ts` | `isValidDashboardId` + `restoreDashboardUrl` | ✓ VERIFIED | Both exported, both used (Levels 1-3 all pass). |
| `packages/web/src/hooks/useDeepLinkDashboard.ts` | optional `storedId` param, mount-time only | ✓ VERIFIED | Present, wired from `App.tsx:147` (`useDeepLinkDashboard(pendingDashboardIdFromStorage)`), zero sessionStorage API calls. |
| `packages/web/src/App.passwordDeepLink.spec.tsx` | password-mode regression | ✓ VERIFIED | Exists, 3/3 pass. |
| `packages/web/src/App.tsx` | `ReturnTo.dashboardId`, `readPendingDashboardId`, `handleSignInCommit`, `expiredHereRef`, `returnToWonElsewhereRef` | ✓ VERIFIED | All present and wired; see truths table above. |
| `packages/web/src/components/LoginPage.tsx` | `deepLinkPending`/`onSignInCommit` props, shared banner, SSO `onClick` | ✓ VERIFIED | Props present (also extended with `deepLinkTablePending` by Phase 116, additively — Phase 115's contract unchanged); one shared `.login-banner` element per branch; SSO anchor `onClick={() => onSignInCommit?.()}` with no `preventDefault`. |
| `packages/web/src/App.signincommit.spec.tsx` | commit-moment write tests | ✓ VERIFIED | Exists, all `AUTHLINK-115` tests pass, including the real `UNAUTHORIZED_EVENT`-driven conflict test. |
| `packages/web/src/App.deeplink.spec.tsx` | amended + extended for OIDC round trip / suppression | ✓ VERIFIED | Amendment present and recorded; all `AUTHLINK-115` + surviving `DEEPLINK-114:` tests pass. |
| `.planning/phases/115-deep-link-authentication-flow/115-UAT.md` | operator walk-through record | ✓ VERIFIED | Exists, `status: complete`, `verdict: APPROVED`, 17 steps recorded (7 PASS, 10 NOT EXERCISED, honestly scoped per the 114-UAT precedent). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `LoginPage.tsx` SSO anchor | `App.tsx handleSignInCommit` | `onClick`, synchronous, no `preventDefault` | ✓ WIRED | `LoginPage.tsx:69`; confirmed no `preventDefault` added to the anchor (`grep -c "preventDefault"` in the file is 1, only in `handleSubmit`). |
| `App.tsx handleSignInCommit` | `sessionStorage kbi_returnTo` | `sessionStorage.setItem(RETURN_TO_KEY, ...)`, gated `authMode === "oidc"` | ✓ WIRED | `App.tsx:371`. |
| `App.tsx` mount | `useDeepLinkDashboard` | `useDeepLinkDashboard(pendingDashboardIdFromStorage)` | ✓ WIRED | `App.tsx:147`. |
| Phase 7 restore effect | deep-link effect | `returnToWonElsewhereRef.current`, ref read across effects | ✓ WIRED | Set at `:419`, read at `:469` (deep-link effect) and `:608` (banner render) — both fire strictly later per the documented effect-ordering guarantee. |
| deep-link effect | `dashboardUrl.ts` | `restoreDashboardUrl(deepLink.dashboard.id)` on `"opened"` | ✓ WIRED | `App.tsx:478`. |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| DLINK-V121-03 | 115-01, 115-02, 115-03, 115-04 | Visiting a dashboard link while not authenticated routes to login, then lands on that dashboard once authenticated | ✓ SATISFIED | Code + all automated tests verified above; `.planning/REQUIREMENTS.md:112` reads Complete with the password-mode-only coverage limitation named directly in the traceability text; `.planning/REQUIREMENTS.md:21` checkbox is `[x]`. No neighboring requirement row (`DLINK-V121-0[4567]` count still 9) was disturbed. No orphaned requirements mapped to Phase 115 beyond DLINK-V121-03. |

### Gate Results (run live against the current tree, not trusted from the SUMMARY)

```
$ cd packages/web && npx tsc --noEmit
(clean, exit 0)

$ npx vitest run
Test Files  175 passed (175)
     Tests  3902 passed (3902)
(console errors are the documented expected error-boundary-test noise)

$ npx vitest run src/styles/theme-guard.spec.ts
Test Files  1 passed (1)
     Tests  150 passed (150)

$ git diff --stat 83263ad -- packages/server        → empty
$ git diff --stat 83263ad -- packages/web/package.json → empty
$ git diff --stat 83263ad -- packages/web/src/styles/global.css → empty
```

Focused re-run of the seven Phase-115-touched spec files together: 139/139 tests pass
(`dashboardUrl.spec.ts`, `useDeepLinkDashboard.spec.ts`, `App.passwordDeepLink.spec.tsx`,
`App.spec.tsx`, `App.signincommit.spec.tsx`, `App.deeplink.spec.tsx`, `LoginPage.spec.tsx`).

All 11 of 115-04's locked-constraint static-audit counts were independently re-run and confirmed
to hold on the current (post-Phase-116) tree: `isValidDashboardId`/`restoreDashboardUrl` exports,
`readDashboardIdFromSearch` delegation, `pushState` count unchanged at 1, one `RETURN_TO_KEY`
constant with no second sessionStorage key, `sessionStorage.setItem` count 2 in `App.tsx` / 0 in
`LoginPage.tsx`, the `DELIBERATELY NOT UNIFIED` comment, `returnToWonElsewhereRef` count 4,
`restoreDashboardUrl` usage count 2, `deepLinkConsumedRef.current = true` count 2 (immediate
suppression, not delayed), `SUPPRESS NOW` comment present, no router dependency, and the Phase 114
test amendment (old title gone, `PHASE 115 AMENDMENT` present, 8 real `DEEPLINK-114:` titles
survive).

### Anti-Patterns Found

None. No TODO/FIXME/PLACEHOLDER/stub patterns in `App.tsx`, `LoginPage.tsx`, `dashboardUrl.ts`, or
`useDeepLinkDashboard.ts`.

### Human Verification Required

None additional. The two requirements that cannot be proven by grep — the login banner's
legibility in both themes, and the visual correctness of the landed dashboard after a real OIDC
round trip — were already routed to `checkpoint:human-verify` in Plan 04 and completed:
`115-UAT.md` records the operator's live walkthrough as APPROVED, with UAT-115-1 through -7
(banner in both themes, expiry-message-alone, password-mode direct landing) marked PASS, and
UAT-115-8 through -17 (the OIDC round trip and the conflict-rule race) honestly recorded as NOT
EXERCISED rather than upgraded to a pass — mirroring the project's own `114-UAT.md` precedent.

**Assessment of whether automated coverage substitutes for the NOT EXERCISED OIDC/race items:**
It substitutes for the *internal state-machine logic* (sessionStorage write/read shape, effect
ordering, URL restoration, single-use clearing, immediate suppression) — all of that is covered
by passing `AUTHLINK-115` jsdom tests in `App.deeplink.spec.tsx` and `App.signincommit.spec.tsx`.
It does NOT and cannot substitute for observing an actual full-page navigation to a real IdP,
real browser Back-button behavior, or an actual F5 reload — jsdom cannot perform those. This
matches the phase's own honest framing (115-UAT.md's "Coverage Limitation" section) and is not a
newly discovered gap; it is a correctly-scoped, already-disclosed, operator-accepted limitation.
Per the task brief, this is not re-reported as a defect.

### Gaps Summary

No gaps found. Every plan-level must-have (10/10) and both ROADMAP success criteria (2/2) verify
against the actual code on the CURRENT tree, not just at Phase 115's own commits — confirmed by
re-running all three project gates plus all 11 locked-constraint static-audit checks live after
Phase 116's ~21 intervening commits, all of which held unchanged. The specifically-flagged
verification points (OIDC-gated commit write, non-unification comment, single sessionStorage key,
immediate — not delayed — suppression, address-bar restoration, and the Phase 114 test amendment
preserving its original intent) were each independently confirmed by direct code inspection and
passing tests, not by trusting the SUMMARY's claims. `DLINK-V121-03` is correctly recorded as
Complete in `.planning/REQUIREMENTS.md`, with the password-mode-only live-coverage limitation
named in the same traceability entry.

---

*Verified: 2026-09-14*
*Verifier: Claude (gsd-verifier)*
