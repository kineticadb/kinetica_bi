---
phase: 115-deep-link-authentication-flow
plan: 03
subsystem: auth
tags: [react, zustand, history-api, sessionstorage, deep-link, vitest]

# Dependency graph
requires:
  - phase: 115-deep-link-authentication-flow
    plan: "01"
    provides: "restoreDashboardUrl(id), isValidDashboardId, hasDashboardParam, clearDashboardUrl"
  - phase: 115-deep-link-authentication-flow
    plan: "02"
    provides: "ReturnTo.dashboardId, readPendingDashboardId(), expiredHereRef, handleSignInCommit's page:\"dashboards\" pairing"
provides:
  - "returnToWonElsewhereRef — an immediate (not delayed) suppression of a stale deep link when a restored ReturnTo page other than \"dashboards\" wins the expiry-vs-paste conflict"
  - "restoreDashboardUrl(deepLink.dashboard.id) wired into the deep-link 'opened' effect — the address bar reads ?dashboard=<id> again after the OIDC round trip"
  - "The Phase 114 unavailable banner and the Phase 114 setPage('dashboards') call both gated on returnToWonElsewhereRef"
  - "App.deeplink.spec.tsx: one Phase 114 test amended (recorded), 8 new AUTHLINK-115 tests covering the full expiry-vs-paste conflict, OIDC round-trip landing/restore/single-use, and stale-link non-resurfacing"
affects: [115-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Suppress-immediately, not delay: a one-shot ref is burned in the SAME effect that decides the conflict, not left to a later condition (page === 'dashboards') that may or may not become true again this session — the fix for Phase 114 Wave-2's defect class recurring at a new seam"
    - "A structural discriminator (restored ReturnTo.page !== 'dashboards') stands in for a disproven clock-based one (reason field, nulled before restore runs) — no new field, reuses data already being restored"

key-files:
  created: []
  modified:
    - packages/web/src/App.tsx
    - packages/web/src/App.deeplink.spec.tsx

key-decisions:
  - "**THE PHASE 114 TEST AMENDMENT (DLINK-V121-03, the highest-risk act in this plan):** deleted `DEEPLINK-114: a pasted link beats the Phase 7 ReturnTo page restore` (kbi_returnTo={page:\"roles\"} + ?dashboard=7 → dashboard wins) and replaced it with two tests under a `PHASE 115 AMENDMENT` comment: (a) `AUTHLINK-115: a committed fresh paste beats a leftover ReturnTo page`, using the REAL shape a paste produces (kbi_returnTo={dashboardId:7, page:\"dashboards\"}) — Phase 114's actual intent, re-verified; (b) `AUTHLINK-115: an expiry captured on Roles beats a stale dashboard param, and the param is stripped` — the inversion, which is what the deleted test's hand-written setup actually represents under 115-CONTEXT.md's locked conflict rule. Verified before amending that no real code path (Plan 02's handleSignInCommit) ever writes {page:\"roles\"} alongside a dashboardId for a paste — it always pairs the id with page:\"dashboards\" — so the deleted test's setup was unreachable via any real paste journey, only via a real expiry journey, which is the case Phase 115 was built to invert. A pointer to where the 'paste overwrites a stale ReturnTo page' guarantee now lives (App.signincommit.spec.tsx, Plan 02 test 2) was added in the same comment block so a future reader of this file in isolation does not conclude coverage was dropped."
  - "Followed the plan's prescribed App.tsx edits verbatim (imports, returnToWonElsewhereRef declaration/comment, the suppression branch inside the restore effect, the deep-link effect's early-return + restoreDashboardUrl call, the banner gate) — this reasoning must survive at the code site for Plan 04's operator checkpoint and the phase verifier."
  - "Two more of this plan's own prescribed grep acceptance criteria (and one plan-level verification-section criterion) turned out to be non-discriminating — same recurring mechanism as Plans 01/02 (the plan's own mandated comment text repeats the anchor word), reported per CLAUDE.md rather than papered over:
    (1) Task 2's criterion `grep -c \"DEEPLINK-114:\" src/App.deeplink.spec.tsx` → **10**, not the plan's assumed **9**. The plan's own mandated `PHASE 115 AMENDMENT` comment text quotes the deleted test's title verbatim in backticks (\"Phase 114's test here was `DEEPLINK-114: a pasted link beats...`\"), adding a 10th matching line on top of the file-header mention (1) + 8 surviving test titles. Real requirement verified directly: `grep -c 'it(\"DEEPLINK-114:'` → **8** (exact test-title count), confirming exactly one of the original 9 titles was reclassified and the other 8 are byte-identical.
    (2) The plan's `<verification>` section's `grep -rc \"kbi_returnTo\" packages/web/src/App.tsx` → **4**, not its assumed **1** (this criterion was ALSO already reported toothless in Plan 02's SUMMARY, which found it at 3 before this plan even ran — this plan's own new comments referencing the key name in prose pushed it to 4). Real requirement verified directly: `grep -c \"const RETURN_TO_KEY\"` → **1**; `grep -rl \"kbi_pendingDashboard\\|kbi_deepLink\" src` → no files. Confirms one key constant, still no second sessionStorage mechanism, unchanged from Plan 02."

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-09-14
---

# Phase 115 Plan 03: Deep Link Authentication Flow — Close the Loop Summary

**Wired `restoreDashboardUrl` into the post-OIDC landing so the address bar reads `?dashboard=<id>` again, and made a restored ReturnTo page other than "dashboards" suppress a stale deep link IMMEDIATELY (not merely delay it) for the rest of the session — including one deliberate, recorded amendment to a Phase 114 test.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-09-14
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments
- `returnToWonElsewhereRef` — set synchronously inside the existing Phase 7 restore effect the instant a restored `ReturnTo.page` other than `"dashboards"` is honoured; burns `deepLinkConsumedRef`'s one-shot immediately and strips a stale `?dashboard=` param via `clearDashboardUrl()`, closing the delayed-not-suppressed hazard 115-RESEARCH.md §Q4/§Q5 Pitfall 3 named
- The Phase 114 deep-link effect now early-returns on `returnToWonElsewhereRef.current` before acting on `"opened"` — so an expiry-elsewhere case never navigates the user and never shows the unavailable banner for a link they never asked for in this session
- `restoreDashboardUrl(deepLink.dashboard.id)` called unconditionally on `deepLink.status === "opened"` — the missing DLINK-V121-07 fix for OIDC users, whose round trip returns to a bare `/`
- `App.deeplink.spec.tsx`: one Phase 114 test amended (with a recorded, in-file justification and a pointer to its coverage's new home), 8 new `AUTHLINK-115` tests added covering both directions of the conflict rule, non-resurfacing after in-session navigation, and the full OIDC round-trip contract (opens, address-bar restore, no manufactured history entry, single-use clear, unavailable-after-restore banner)

## Task Commits

Each task was committed atomically:

1. **Task 1: App.tsx — immediate suppression when the ReturnTo page wins, and the address-bar restore** - `ca714e3` (feat)
2. **Task 2: App.deeplink.spec.tsx — amend the one inverted Phase 114 test, and cover the OIDC round trip** - `9867a79` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/web/src/App.tsx` - import extended (`clearDashboardUrl`, `hasDashboardParam`, `restoreDashboardUrl`); `returnToWonElsewhereRef` declared next to `expiredHereRef`; the Phase 7 restore effect's allow-list branch gained the immediate-suppression block; the Phase 114 deep-link effect gained the early-return guard + `restoreDashboardUrl` call; the unavailable-banner render condition gained the `!returnToWonElsewhereRef.current` gate
- `packages/web/src/App.deeplink.spec.tsx` - one test deleted and replaced (`PHASE 115 AMENDMENT` comment block + 2 tests), 6 further `AUTHLINK-115` tests added; all 8 non-amended `DEEPLINK-114:` tests remain byte-identical

## Decisions Made
- Followed the plan's prescribed code and test structure verbatim, including its mandated comments (the `SUPPRESS NOW` reasoning, the `PHASE 115 AMENDMENT` block, the OIDC-restore rationale) — these must survive at the code site for Plan 04's operator checkpoint and the phase verifier, per the plan's own objective.
- The amendment itself: see `key-decisions` in frontmatter for the full reasoning. Summary: the deleted test's setup (`{page:"roles"}` + `?dashboard=7`) is a state no real paste journey produces (Plan 02's `handleSignInCommit` always writes `page:"dashboards"` alongside a fresh id); it IS the shape a real expiry-elsewhere journey produces, and Phase 115's locked conflict rule says Roles wins there. Phase 114's intent (paste beats a leftover page) is preserved and re-tested in its real shape.

## Deviations from Plan

None requiring a code change — plan executed exactly as written for both tasks. Two of the plan's own acceptance/verification-criteria grep commands (one from this plan's Task 2, one from this plan's `<verification>` section, the latter already flagged as trending toothless in Plan 02) turned out non-discriminating, once the plan's own prescribed comment text was typed in verbatim. Reported per CLAUDE.md's "report, don't paper over a broken grep" rule; no source or test content was altered to chase either:

**1. [Reported, not fixed] `grep -c "DEEPLINK-114:" src/App.deeplink.spec.tsx` reads 10, not the plan's assumed 9**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** the plan's own mandated `PHASE 115 AMENDMENT` comment quotes the deleted test's exact title in backticks ("Phase 114's test here was `DEEPLINK-114: a pasted link beats the Phase 7 ReturnTo page restore`"), which is itself a line matching the grep. That's the file-header mention (1, pre-existing) + 8 surviving test titles + this 1 new prose mention = 10, not the assumed 9 (which only accounted for header + 8 survivors, not realizing its own mandated amendment text would add a 10th).
- **Real requirement verified directly:** `grep -c 'it("DEEPLINK-114:'` (actual test-title lines, not prose) → **8**. Confirms exactly one of the original 9 titled tests was reclassified and the other 8 are unchanged.

**2. [Reported, not fixed — continuation of a Plan 02 finding] `grep -rc "kbi_returnTo" packages/web/src/App.tsx` (plan's `<verification>` section) reads 4, not the plan's assumed 1**
- **Found during:** Plan-level verification pass
- **Issue:** this exact criterion was already reported toothless in Plan 02's SUMMARY (read 3 there, not Plan 02's own assumed 1) because of Plan 02's own mandated docstring prose. This plan's Task 1 comments (e.g. "the id came from kbi_returnTo, not the URL") add a further mention, taking it to 4.
- **Real requirement verified directly:** `grep -c "const RETURN_TO_KEY"` → **1**; `grep -rl "kbi_pendingDashboard\|kbi_deepLink" src"` → no files. Confirms the single-key invariant (ROADMAP §Phase 115 criterion 2) still holds; no second sessionStorage mechanism was introduced by this plan.

**Total deviations:** 0 code changes; 2 acceptance/verification-criteria observations reported per CLAUDE.md's "report, don't paper over a broken grep" rule (both caused by the SAME class of issue already documented in Plans 01/02: plan-mandated prose polluting a grep anchor).

## Issues Encountered
None. Both tasks' behavioral acceptance criteria and `<done>` requirements hold exactly as specified. Task 1's expected single failing test (`App.deeplink.spec.tsx`'s Phase 114 precedence test) materialized precisely as the plan predicted, and Task 2 resolved it via the prescribed amendment rather than any workaround.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04 (the operator checkpoint / live UAT for DLINK-V121-03) can now rely on: the full expiry-vs-paste conflict rule enforced structurally and immediately (not delayed) in `App.tsx`; the address bar reading `?dashboard=<id>` again after any OIDC round trip; and the Phase 114 unavailable banner correctly suppressed in the expiry-elsewhere case.
- No blockers. Gates green: `tsc --noEmit` clean; `src/App.spec.tsx` + `src/App.signincommit.spec.tsx` + `src/App.passwordDeepLink.spec.tsx` green (56/56) after Task 1 with the one EXPECTED Task-1-only failure in `App.deeplink.spec.tsx` (resolved by Task 2); `App.deeplink.spec.tsx` green (16/16) after Task 2; full `vitest run` green (3778/3778, up from the 3771 baseline by net +7 — 8 added, 1 removed); `theme-guard.spec.ts` green (150/150); `git diff --stat HEAD -- packages/server` empty (v1.21 remains frontend-only).
- **DLINK-V121-03 is NOT marked complete** — Plan 04 (the operator checkpoint) remains, per this plan's own success-criteria instruction.

## Self-Check: PASSED

All claimed files exist on disk and all claimed commits (`ca714e3`, `9867a79`) are present in `git log`.

---
*Phase: 115-deep-link-authentication-flow*
*Completed: 2026-09-14*
</content>
