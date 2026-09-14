---
phase: 115-deep-link-authentication-flow
plan: 04
subsystem: auth
tags: [react, zustand, history-api, sessionstorage, deep-link, vitest, uat]

# Dependency graph
requires:
  - phase: 115-deep-link-authentication-flow
    plan: "01"
    provides: "isValidDashboardId, restoreDashboardUrl, useDeepLinkDashboard(storedId?), the password-mode regression proof"
  - phase: 115-deep-link-authentication-flow
    plan: "02"
    provides: "ReturnTo.dashboardId, readPendingDashboardId(), expiredHereRef, handleSignInCommit, LoginPage's shared banner"
  - phase: 115-deep-link-authentication-flow
    plan: "03"
    provides: "returnToWonElsewhereRef immediate suppression, the post-OIDC address-bar restore"
provides:
  - "A full four-gate re-run against the CURRENT tree (post-Phase-116), confirming Phase 115's work still holds unmodified"
  - "115-UAT.md — the operator's recorded, honestly-scoped walk-through: 7/7 pass in password mode, OIDC round trip and the conflict-rule race explicitly NOT exercised rather than upgraded to a pass"
  - "DLINK-V121-03 flipped to Complete in REQUIREMENTS.md, with the password-mode-only coverage limitation named in the same edit"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-verify locked constraints against the CURRENT tree, not the tree at plan-write time — Phase 116 landed 19 commits on this branch between Task 1's first pass and this continuation; re-running the full gate suite (rather than trusting a stale record) is what caught that nothing in Phase 115's surface had drifted"

key-files:
  created:
    - .planning/phases/115-deep-link-authentication-flow/115-UAT.md
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Re-ran Task 1's full gate suite and static audit from scratch in this continuation (rather than trusting the prior session's 'all green' note) because the tree had moved on — Phase 116 (6 plans, 19 commits) landed on this same branch since Task 1 first ran. Every gate and every one of the 11 locked-constraint counts was re-verified live; all held."
  - "The operator's 7 reported checks map onto Group A (banner, steps 1-5) and Group B (password mode, steps 6-7) of the plan's 17-step verification script — not the full 17. Group C (the OIDC round trip, steps 8-15) and Group D (the conflict-rule race, steps 16-17) were recorded as NOT EXERCISED, per the operator's own flagged limitation and the plan's explicit allowance that Group D's race is 'the hardest to hit; NOT EXERCISED is an acceptable answer.' This mirrors 114-UAT.md's UAT-114-2 precedent: an unobserved behavior is recorded honestly, never upgraded to a pass."
  - "DLINK-V121-03's REQUIREMENTS.md traceability entry names the password-mode-only limitation directly in the Complete-status text (not just in 115-UAT.md), so a reader scanning REQUIREMENTS.md alone sees the caveat without having to open the UAT file."

requirements-completed: [DLINK-V121-03]

# Metrics
duration: 20min
completed: 2026-09-14
---

# Phase 115 Plan 04: Deep Link Authentication Flow — Proof + Operator UAT Summary

**Re-ran all four project gates and all 11 locked-constraint static-audit counts against the tree AFTER Phase 116 landed on top of it (all held unchanged), then recorded the operator's 7/7-pass password-mode walkthrough with the OIDC round trip and the conflict-rule race explicitly named as not exercised — closing v1.21's last open Dashboard Links requirement, DLINK-V121-03.**

## Performance

- **Duration:** ~20 min (continuation session; Task 1 + Task 2 were completed in a prior session, this continuation resumed at Task 3 per the operator's resolved checkpoint, and additionally RE-RAN Task 1's gates/audit live to confirm nothing had drifted)
- **Completed:** 2026-09-14
- **Tasks:** 3/3 completed (Task 1 re-verified in this continuation; Task 2 resolved by operator response; Task 3 executed in this continuation)
- **Files modified:** 2 (`115-UAT.md` created, `REQUIREMENTS.md` edited)

## Accomplishments
- Confirmed, live, against the CURRENT tree (post-Phase-116, not the phase-115-start tree the original Task 1 pass used): `tsc --noEmit` clean, full `vitest run` green at 3902/3902 (175 files) — well above the 3727 phase-start baseline — and `theme-guard.spec.ts` green at 150/150
- Confirmed all 11 locked-constraint static-audit criteria still hold: frontend-only (empty `packages/server` diff against `83263ad`), no new dependency (`package.json` diff empty), no router (`grep -rl "react-router\|useNavigate\|BrowserRouter\|useSearchParams" src` → no files), one sessionStorage mechanism (`RETURN_TO_KEY` constant count 1, no `kbi_pendingDashboard`/`kbi_deepLink`/`kbi_pendingLink` files), two deliberate write moments (`sessionStorage.setItem` count 2 in `App.tsx`, 0 in `LoginPage.tsx`, `DELIBERATELY NOT UNIFIED` comment present), no new CSS class (`global.css` diff empty, one shared `.login-banner` element), the Phase 114 test amendment recorded (old title absent, `PHASE 115 AMENDMENT` marker present, 8 real `DEEPLINK-114:` test titles survive), immediate (not delayed) suppression (`deepLinkConsumedRef.current = true` appears twice), and the phase-wide `AUTHLINK-115` test anchor present in 8 files
- `115-UAT.md` created recording all 17 of the plan's verification steps: 7 PASS (Groups A+B, password mode — banner legible both themes, address bar preserved, expiry-only banner never stacked, direct dashboard landing with no flash, correct default-state dashboard), 8 NOT EXERCISED (Group C, the OIDC round trip — the environment is `AUTH_MODE=password` only), 2 NOT EXERCISED (Group D, the conflict-rule race — acceptable per the plan's own wording)
- `DLINK-V121-03` flipped to Complete in `REQUIREMENTS.md` (checkbox + traceability row), with the password-mode-only coverage limitation named directly in the traceability entry
- v1.21's Dashboard Links track (DLINK-V121-01 through -07) is now fully Complete

## Task Commits

Each task was committed atomically:

1. **Task 1: Full gate run + static audit of locked constraints** — no commit (read-only audit; results recorded below and in this SUMMARY only, per the plan's own `<files>` note)
2. **Task 2: Operator walk-through (checkpoint, resolved by the operator's response)** — bundled into the Task 3 commit below, since both produced `.planning`-only documentation output in the same continuation
3. **Task 3: Record the result — 115-UAT.md + REQUIREMENTS.md** — `8365a7c` (docs)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `.planning/phases/115-deep-link-authentication-flow/115-UAT.md` — new file, all 17 verification steps recorded (7 PASS, 10 NOT EXERCISED), the two accept/reject decisions recorded as accepted, and a named "Coverage Limitation" section explaining the OIDC gap
- `.planning/REQUIREMENTS.md` — `DLINK-V121-03` checkbox flipped `[ ]` → `[x]`; its traceability-table row changed from `Pending` to a Complete entry citing the 2026-09-14 operator UAT (7/7) and naming the password-mode-only limitation; no neighboring row touched (verified: `DLINK-V121-0[4567]` count unchanged at 9)

## Literal Gate Output (re-run against the current tree, post-Phase-116)

```
$ cd packages/web && npx tsc --noEmit
(no output, exit 0)

$ npx vitest run
 Test Files  175 passed (175)
      Tests  3902 passed (3902)
   Duration  41.13s
(console errors from an intentional DashboardContext error-boundary test are expected output,
not failures — that spec asserts the thrown-outside-Provider behavior)

$ npx vitest run src/styles/theme-guard.spec.ts
 Test Files  1 passed (1)
      Tests  150 passed (150)

$ git diff --stat 83263ad -- packages/server
(empty)

$ git diff --stat 83263ad -- packages/web/package.json
(empty)

$ git diff --stat 83263ad -- packages/web/src/styles/global.css
(empty)
```

## Static Constraint Audit — all 11 criteria, re-verified live

| # | Criterion | Naive grep result | Real requirement (where naive is toothless) | Holds? |
|---|---|---|---|---|
| 1 | `tsc --noEmit` | exit 0, no output | — | yes |
| 2 | `vitest run` ≥ 3727 total, 100% pass | 3902/3902 | — | yes |
| 3 | `theme-guard.spec.ts` green | 150/150 | — | yes |
| 4 | Frontend-only: empty server diff | empty | — | yes |
| 5 | No new dep, no router | `package.json` diff empty; router-grep → no files | — | yes |
| 6 | One sessionStorage mechanism | `kbi_returnTo` naive count 6 (prose-inflated, same mechanism flagged toothless in 115-01/02/03) | `const RETURN_TO_KEY` count → 1; no `kbi_pendingDashboard`/`kbi_deepLink`/`kbi_pendingLink` files | yes |
| 7 | Two deliberate write moments | `setItem` in App.tsx → 2, in LoginPage.tsx → 0, `DELIBERATELY NOT UNIFIED` → 1 | — | yes |
| 8 | No new CSS class/colour | `global.css` diff empty; `login-banner` naive count in LoginPage.tsx → 2 (prose-inflated, flagged toothless in 115-02) | `className="login-banner"` count → 1 | yes |
| 9 | Phase 114 amendment recorded | old test string → 0; `PHASE 115 AMENDMENT` → 1; `DEEPLINK-114:` naive count → 10 (prose-inflated, flagged toothless in 115-03) | `it("DEEPLINK-114:` count → 8 | yes |
| 10 | Immediate (not delayed) suppression | `deepLinkConsumedRef.current = true` → 2 | — | yes |
| 11 | Phase-wide test anchor | `AUTHLINK-115` present in 8 files (≥ 6 required) | — | yes |

All three "naive grep inflated by the plan's own mandated prose" cases (#6, #8, #9) were already
identified and reported as toothless in 115-01/02/03-SUMMARY.md at the time each plan ran; this
re-verification confirms they remain non-discriminating for the same documented reason (mandated
docstring/comment text reusing the anchor word) and that the underlying REAL requirement still
holds in every case. No new toothless criteria were found in this pass.

## Operator UAT Verdict

**APPROVED.** See `115-UAT.md` for the full 17-step record. Summary: 7/7 of the checks the operator
actually ran PASSED (Group A — the banner, legible in both light and dark theme, correctly never
stacked with the expiry message; Group B — password-mode deep-link-to-login-to-dashboard, landing
directly on the correct dashboard in its default state with no flash). Group C (the OIDC round
trip, 8 steps) and Group D (the conflict-rule race, 2 steps) were explicitly recorded as NOT
EXERCISED — Group C because the only available environment is `AUTH_MODE=password`, Group D
because the plan itself allows "NOT EXERCISED" as the honest answer for a hard-to-reproduce race.
The operator additionally accepted, by approving the phase, both of the plan's named
deliberate-design questions (the two-site `kbi_returnTo` write, and the Phase 114 test replacement).

**This is recorded honestly, not smoothed over:** DLINK-V121-03 is closed on the strength of the
automated test suite (unit + integration, with mutation probes on the shared helpers) PLUS a live
password-mode walkthrough. The OIDC half of the mechanism — the actual reason this phase needed
sessionStorage — remains test-suite-proven but not yet browser-observed, and `115-UAT.md` names a
concrete follow-up: re-verify Group C the next time an OIDC deployment is available.

## Decisions Made
- Re-ran Task 1's gates and audit from scratch rather than trusting the prior session's summary
  note, because the `<gates>` instruction for this continuation explicitly warned the tree had
  moved (Phase 116 landed 19 commits since). This was the correct call: the full suite grew from
  3778 (115-03's baseline) to 3902 tests (Phase 116's additions), and re-running confirmed none of
  that growth touched anything Phase 115 locked down.
- Combined Task 2's output (`115-UAT.md`) and Task 3's edit (`REQUIREMENTS.md`) into a single git
  commit, since both are `.planning`-only documentation produced in the same continuation session
  with no intervening code change between them.

## Deviations from Plan

None — plan executed exactly as written for the continuation (Task 3), and Task 1's re-verification
reproduced the prior session's "all green, 11/11 held" result exactly, with no drift found.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required. (The OIDC coverage limitation is an
environment-availability gap, not a setup task for this executor to perform.)

## Next Phase Readiness
- v1.21's Dashboard Links track (DLINK-V121-01 through -07, Phases 113-115) is now fully Complete.
- Phase 116 (Table Deep Links) is a separate, already-in-flight body of work on this same branch —
  untouched by this plan, per its explicit scope boundary. Its own checkpoint (116-06, awaiting
  operator response on `116-UAT.md`) is independent of this phase's closure.
- Recorded follow-up (not a blocker): re-verify `115-UAT.md`'s Group C (the OIDC round trip) live
  the next time an OIDC-configured deployment is available.

## Self-Check: PASSED

`.planning/phases/115-deep-link-authentication-flow/115-UAT.md` exists on disk. Commit `8365a7c` is
present in `git log`. `REQUIREMENTS.md`'s `DLINK-V121-03` checkbox and traceability row read
Complete as claimed (re-verified live: criteria 1-4 above all pass post-edit).

---
*Phase: 115-deep-link-authentication-flow*
*Completed: 2026-09-14*
