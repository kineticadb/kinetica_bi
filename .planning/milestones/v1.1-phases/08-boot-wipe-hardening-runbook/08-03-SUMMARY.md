---
phase: 08-boot-wipe-hardening-runbook
plan: 03
subsystem: docs
tags: [runbook, oidc, kinetica-trust, auth-mode, ops]

# Dependency graph
requires:
  - phase: 03-auth-failure-ux-admin-credential-removal
    provides: "Phase 3 Delta runbook section established the append-style precedent (TL;DR / env vars / behavior / acceptance verification structure)"
  - phase: 05-oidc-module-routes
    provides: "AUTH_OIDC_* env var contract, validateOidcEnv() boot-throw, oidc_boot structured log line"
  - phase: 06-requireauth-helper-credential-branch
    provides: "Kinetica /version reachability probe, oidc_boot wording (the SC5 verify-only signal)"
provides:
  - "Phase 8 Delta section appended to v1.0 DEPLOY-RUNBOOK.md (lines 213-305)"
  - "Operator-facing OIDC mode + Kinetica trust documentation (DBA-task callout, four trust-config bullets)"
  - "Verbatim PITFALLS O-04/I-06 re-auth-loop diagnostic line for the #1 documented v1.1 deployment failure mode"
  - "5-item Phase 8 acceptance verification checklist (curl /api/auth/config, oidc_boot, browser end-to-end, auth_mode_change_wipe, boot_failed)"
affects: [v1.1 deployment, operator handoff, future v1.2+ runbook deltas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only deploy-runbook deltas (mirrors Phase 3 Delta precedent — single canonical file, chronological per-milestone deltas)"
    - "Generic-only runbook depth (no worked Keycloak/Okta/Auth0 examples; vendor-agnostic OIDC-spec contract)"

key-files:
  created: []
  modified:
    - ".planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md"

key-decisions:
  - "Append `## Phase 8 Delta` section to existing v1.0 DEPLOY-RUNBOOK.md rather than creating a new file — matches Phase 3 Delta precedent and CONTEXT.md 'one canonical runbook' decision"
  - "Generic-only depth: no worked Keycloak/Okta/Auth0/Azure AD examples in the runbook — vendor docs cross-reference the four universal OIDC trust-config bullets"
  - "Explicit 'DBA task on the Kinetica server' callout used verbatim per acceptance criteria — frames Kinetica trust config as separate from BI app's AUTH_OIDC_* env vars"
  - "Verbatim re-auth-loop diagnostic line included in Troubleshooting subsection per SC4 (PITFALLS O-04 / I-06)"
  - "5-item acceptance checklist mirrors Phase 1 + Phase 3 Delta structure for operator muscle-memory continuity"
  - "Cross-referenced 8 PITFALLS codes (O-01, O-02, O-03, O-04, I-03, I-05, I-06, T-3) inline in the runbook prose for traceability"

patterns-established:
  - "Per-milestone deltas append to the original runbook (DEPLOY-RUNBOOK.md is now structured Phase 1 base → Phase 3 Delta → Phase 8 Delta)"
  - "Operator-facing pitfall references use the canonical PITFALLS code (O-01, I-06, etc.) rather than re-explaining the failure mode"

requirements-completed:
  - OPS-01

# Metrics
duration: 5min
completed: 2026-05-01
---

# Phase 8 Plan 3: Phase 8 Delta Operator Runbook Summary

**Appended a 96-line `## Phase 8 Delta` section to v1.0 DEPLOY-RUNBOOK.md documenting OIDC mode env vars, Kinetica server-side OIDC trust config as a DBA task, AUTH_MODE-change wipe behavior, boot fail-fast event, secret rotation safety, and the verbatim PITFALLS O-04/I-06 re-auth-loop diagnostic.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-01T20:39:10Z
- **Completed:** 2026-05-01T20:44:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Single-task append of the Phase 8 Delta section closed OPS-01, Phase 8 SC3, and Phase 8 SC4 in one atomic commit.
- Mirror of the existing `## Phase 3 Delta` style (heading depth, frontmatter pattern, subsection ordering, numbered acceptance checklist) preserves the runbook's chronological-per-milestone shape.
- Kinetica server-side OIDC trust configuration documented as a DBA task with the four universal OIDC-spec bullets (issuer, audience, JWKS URL, claim-to-username mapping), explicitly callable out as "separate from the BI app's AUTH_OIDC_* env vars."
- Verbatim PITFALLS O-04/I-06 diagnostic line ("If users can log in but every dashboard call fails with re-auth loop, check Kinetica's OIDC trust configuration first.") preserved exactly per acceptance criteria.
- 5-item Phase 8 acceptance verification checklist enumerated per ROADMAP success criteria: curl /api/auth/config, oidc_boot log presence, browser end-to-end, auth_mode_change_wipe verification, boot_failed log on missing env var.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append Phase 8 Delta section to existing DEPLOY-RUNBOOK.md** - `4f533d8` (docs)

_Note: Plan metadata commit (this SUMMARY.md + STATE.md + ROADMAP.md updates) is captured separately at the end._

## Files Created/Modified

- `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` - Appended `## Phase 8 Delta — OIDC Mode + AUTH_MODE-Change Wipe` section (96 lines added, 0 removed). File grew from 209 to 305 lines. Existing Phase 1 base + Phase 3 Delta sections untouched.

## Decisions Made

- **Append vs new file:** Appended to the existing v1.0 DEPLOY-RUNBOOK.md (not a new file at `kinetica_bi/server/`). Matches CONTEXT.md "one canonical runbook" decision and Phase 3 Delta precedent. Single-file chronological history per milestone delta is more navigable than fragmenting across files.
- **Heading style:** `## Phase 8 Delta — OIDC Mode + AUTH_MODE-Change Wipe` mirrors the Phase 3 Delta heading depth (## for delta title, ### for subsections) per CONTEXT.md "Match the existing 'Phase 3 Delta' style for consistency."
- **Generic-only depth:** No worked Keycloak/Okta/Auth0 examples — keeps the runbook vendor-agnostic per CONTEXT.md "Generic-only depth" decision; vendor docs translate the four universal trust-config bullets to vendor-specific UI fields.
- **Verbatim diagnostic line:** The PITFALLS O-04/I-06 re-auth-loop line is included verbatim per SC4 verification (the line is the canonical operator-facing flag for the #1 v1.1 deployment failure mode).
- **`---` separator placement:** Added blank line + `---` + blank line before the new heading to match the structure already present at lines 126-128 (between Phase 1 acceptance verification and Phase 3 Delta).

## Deviations from Plan

None - plan executed exactly as written.

The plan specified exact verbatim content for the appended section. The append produced 96 lines of content (within the plan's "approximately 90-100 lines" target). All 12 acceptance grep checks passed on the first re-application of the edit.

## Issues Encountered

- **Initial Edit reverted:** The first Edit application appeared to succeed (the tool reported success) but a subsequent linter/external process reverted the file back to 209 lines. Re-running the same Edit a second time persisted correctly (verified by `wc -l` returning 305 and `grep -n "^## Phase 8 Delta"` returning a match at line 213). All downstream acceptance grep checks then passed. No content drift between attempts — the second application was byte-identical to the first.

## User Setup Required

None - documentation-only change. No external service configuration introduced. The runbook itself documents the operator-side and DBA-side configuration steps needed to deploy v1.1 OIDC mode, but the act of appending the runbook section requires no setup.

## Next Phase Readiness

- **OPS-01 closed.** Kinetica server's OIDC trust configuration prereqs are documented in the deploy runbook as a DBA task, with the four universal OIDC-spec bullets (issuer, audience, JWKS, claim mapping).
- **Phase 8 SC3 and SC4 satisfied** by the appended content (Kinetica trust config section + verbatim re-auth-loop diagnostic line).
- **Plans 08-01 (boot wipe) and 08-02 (boot hardening) remain.** This plan (08-03) was the documentation deliverable; the executable changes (auth_mode_change_wipe transaction, boot_failed structured logging) are scoped to those plans.
- **Runbook is operator-ready** for v1.1 deploys once Plans 08-01 and 08-02 ship — the runbook references those plans' events (`auth_mode_change_wipe`, `boot_failed`) by name in the acceptance checklist.

## Self-Check: PASSED

Verified post-write:

- File `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` exists and is 305 lines (was 209 — net +96 lines).
- Commit `4f533d8` is present in `git log` (`docs(08-03): append Phase 8 Delta runbook for OIDC mode + AUTH_MODE wipe`).
- All 12 plan acceptance grep checks pass:
  - `grep -c "^## Phase 8 Delta"` → 1
  - `grep -c "^## Phase 3 Delta"` → 1 (untouched)
  - `grep -c "Kinetica server side: OIDC trust configuration"` → 2
  - `grep -cF "If users can log in but every dashboard call fails with re-auth loop, check Kinetica's OIDC trust configuration first."` → 1
  - `grep -cF "This is a DBA task on the Kinetica server"` → 1
  - `grep -c "auth_mode_change_wipe"` → 3
  - `grep -c "boot_failed"` → 3
  - `grep -c "AUTH_OIDC_*"` env var alternation → 13 (≥6 required)
  - `grep -c "PITFALLS O-04\|PITFALLS I-06"` → 2
  - `grep -cF "Cache-Control: no-store"` → 1
  - `wc -l` → 305 (≥290 required)
  - awk ordering check → exit 0 (Phase 8 Delta heading appears after Phase 3 Delta heading)

---
*Phase: 08-boot-wipe-hardening-runbook*
*Completed: 2026-05-01*
