---
phase: 08-boot-wipe-hardening-runbook
verified: 2026-05-01T20:17:00Z
status: passed
score: 5/5 success criteria verified
---

# Phase 8: Boot Wipe + Hardening + Runbook Verification Report

**Phase Goal:** Changing `AUTH_MODE` between deployments wipes stale sessions atomically; the server refuses to start with missing OIDC config; operators have a clear, actionable runbook for Kinetica OIDC trust configuration.
**Verified:** 2026-05-01T20:17:00Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #   | Truth (Success Criterion)                                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SC1: AUTH_MODE flip → contradicting credential_type rows deleted in a single SQLite transaction before app.listen()                                                                                                                | VERIFIED | `index.ts:97-120` defines `wipeSessionsOnModeChange()` invoked at line 120 (before `let oidcConfig` at 122 and before bootstrap `app.listen` at 739). COUNT + DELETE wrapped in `db.transaction(() => {...})()`. `boot.wipe.spec.ts` 3/3 tests pass. |
| 2   | SC2: AUTH_MODE=oidc with AUTH_OIDC_ISSUER_URL unset → process exits non-zero with log naming the missing variable; never serves requests                                                                                            | VERIFIED | `index.ts:746-757` IIFE catch emits structured `boot_failed` JSON with `message` field surfacing `validateOidcEnv()` throw; `process.exit(1)` preserved. `boot.hardening.spec.ts` Test 1 asserts `message` matches `/AUTH_OIDC_ISSUER_URL/` and `process.exit(1)` called. |
| 3   | SC3: DEPLOY-RUNBOOK.md contains "Kinetica OIDC Trust Configuration" section covering issuer URL, expected audience (= AUTH_OIDC_CLIENT_ID), JWKS URL, claim-to-Kinetica-username mapping, and explicit DBA-task callout            | VERIFIED | `DEPLOY-RUNBOOK.md:237-248` heading "Kinetica server side: OIDC trust configuration" with all four bullets (Trusted issuer URL, Expected audience, JWKS URL, Claim-to-Kinetica-username mapping) and verbatim "This is a DBA task on the Kinetica server" at line 239. |
| 4   | SC4: Runbook explicitly calls out PITFALLS O-04 / I-06 with verbatim re-auth-loop diagnostic line                                                                                                                                  | VERIFIED | `DEPLOY-RUNBOOK.md:278` "Troubleshooting (PITFALLS O-04 / I-06)" heading; line 280 verbatim: "If users can log in but every dashboard call fails with re-auth loop, check Kinetica's OIDC trust configuration first." |
| 5   | SC5: Server startup in AUTH_MODE=oidc logs structured line (issuer + audience). NOTE: verify-only - already shipped Phase 6                                                                                                        | VERIFIED | `index.ts:132-142` `event: "oidc_boot"` JSON log with `issuer`, `audience`, and verbatim message "Kinetica must be configured to trust tokens from ${issuer} with audience ${clientId}" - intact post-Phase-8 wipe insertion. |

**Score:** 5/5 success criteria verified.

### Required Artifacts

| Artifact                                                                                              | Expected                                                                       | Status   | Details                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kinetica_bi/server/src/index.ts`                                                                     | wipeSessionsOnModeChange function + invocation; structured auth_mode_change_wipe log; structured boot_failed log | VERIFIED | 759 lines. Wipe at lines 97-120 (function decl + invocation). `auth_mode_change_wipe` at line 112. `DELETE FROM sessions WHERE credential_type = ?` at line 106. `db.transaction` at line 99. `boot_failed` at line 751. `db` import at line 27. |
| `kinetica_bi/server/tests/boot.wipe.spec.ts`                                                          | Three-case wipe spec: oidc-clears-password, password-clears-oidc, no-contradiction-no-log | VERIFIED | 224 lines. Three `it()` blocks. All 3 tests pass via `npx vitest run tests/boot.wipe.spec.ts`. Mirrors bootstrap.spec.ts vi.hoisted+vi.mock("openid-client") pattern. |
| `kinetica_bi/server/tests/boot.hardening.spec.ts`                                                     | Two-case hardening spec: missing-OIDC-env-var → boot_failed; wipe-throw → boot_failed | VERIFIED | 198 lines. Two `it()` blocks. Both tests pass. Test 1 asserts message matches `/AUTH_OIDC_ISSUER_URL/` and `stack` contains it; Test 2 forces wipe SQL throw via `vi.spyOn(db, "prepare")` selective-throw and asserts message contains "forced wipe failure". `process.exit(1)` asserted in both. |
| `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md`            | Phase 8 Delta section appended at end (DBA-task callout, PITFALLS O-04/I-06 verbatim line, env vars enumerated, AUTH_MODE-change behavior, boot_failed event, secret rotation, acceptance checklist) | VERIFIED | 305 lines (was 209 → +96). `## Phase 8 Delta` at line 213, AFTER `## Phase 3 Delta` at line 129. All 6 AUTH_OIDC_* env vars enumerated (228-233). 4 trust-config bullets at 243-246. Verbatim re-auth-loop line at 280. `auth_mode_change_wipe` and `boot_failed` documented in body + acceptance checklist. AUTH_OIDC_CLIENT_SECRET rotation safety at 274-276. 5-item acceptance checklist at 294-298. |

### Key Link Verification

| From                                              | To                                          | Via                                                  | Status | Details                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts createApp()`                            | `db.ts db singleton`                        | `db.transaction(() => {...})()` + `db.prepare()`     | WIRED | `db` named export added to import block (line 27). `db.transaction` invoked at line 99. `db.prepare` for COUNT (line 101) and DELETE (line 106). |
| `index.ts createApp()`                            | sessions.credential_type column (Phase 4)   | `DELETE FROM sessions WHERE credential_type = ?`     | WIRED | Line 106 `.prepare("DELETE FROM sessions WHERE credential_type = ?")`. Schema column shipped Phase 4 (MODE-02), confirmed by passing 3-case wipe spec. |
| `index.ts bootstrap IIFE catch`                   | structured JSON log + process.exit(1)        | `console.error(JSON.stringify({ event: 'boot_failed', message, stack }))` | WIRED | Lines 746-757. Both `message` and `stack` as separate top-level fields with `instanceof Error` guards. `process.exit(1)` preserved on next line. |
| `index.ts createApp() (line 120)`                 | OIDC boot block (`let oidcConfig` line 122) | line ordering: wipe runs BEFORE OIDC env validation/discover | WIRED | Wipe invocation at line 120; `let oidcConfig` at line 122; `validateOidcEnv()` at line 127. Wipe sits between authMode validation and OIDC init per ARCHITECTURE.md. |
| `index.ts createApp()`                            | bootstrap IIFE catch                         | uncaught throw → IIFE catch → boot_failed log        | WIRED | Verified by `boot.hardening.spec.ts` Test 2 (forced wipe-throw surfaces through IIFE catch with structured boot_failed shape). |
| DEPLOY-RUNBOOK.md "Phase 8 Delta"                 | Operators (DBA + BI app deployer)           | Markdown append; chronological per-milestone delta   | WIRED | Section appears after Phase 3 Delta at the file end. Heading depth (## delta, ### subsections) matches Phase 3 Delta precedent. |

### Requirements Coverage

| Requirement | Source Plan       | Description                                                                                                          | Status     | Evidence                                                                                                                                                  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODE-05     | 08-01-PLAN, 08-02-PLAN | At server startup, if persisted last-known AUTH_MODE differs from current, sessions table is wiped in a single SQLite transaction. JWT cookie `v: 1` NOT bumped. | SATISFIED | Wipe in `createApp()` at index.ts:97-120 inside `db.transaction()`. Implementation uses data-derived contradiction check (no persisted last-mode meta-row), interpreting MODE-05's "entire sessions table" as "all rows of contradicting type" per ARCHITECTURE.md. JWT cookie unchanged (no edits to issueSessionCookie). 3/3 wipe tests + 2/2 hardening tests pass. |
| OPS-01      | 08-03-PLAN        | DEPLOY-RUNBOOK.md extended with Kinetica OIDC trust configuration prereqs (issuer URL, expected audience, JWKS URL, claim-to-Kinetica-username mapping); explicit DBA-task callout; PITFALLS O-04/I-06 referenced. | SATISFIED | `## Phase 8 Delta` section (lines 213-305) contains all four bullets at 243-246, verbatim "This is a DBA task on the Kinetica server" at 239, and PITFALLS O-04/I-06 with verbatim re-auth-loop line at 278-280. |

No orphaned requirements - all phase-08-mapped requirements (MODE-05, OPS-01) are claimed by plans and verified satisfied.

### Anti-Patterns Found

| File                          | Line | Pattern                                       | Severity | Impact                                                                                                       |
| ----------------------------- | ---- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `kinetica_bi/server/src/index.ts` | 152  | `// TODO: Could be made env-configurable via KINETICA_HEALTHCHECK_PATH` | Info | Pre-existing Phase 6 TODO; CONTEXT.md explicitly defers `KINETICA_HEALTHCHECK_PATH` to v2. Not Phase 8 territory. |
| `DEPLOY-RUNBOOK.md`           | 167  | word "placeholder" appears in Phase 3 Delta widget-permission text | Info | Pre-existing Phase 3 Delta content; not Phase 8 territory. References `widget-permission-denied` placeholder UI element (legitimate use). |

No blocker or warning anti-patterns in Phase 8 deliverables. No empty `return null` / `return {}` stubs in new code. No commented-out implementations. No `console.log`-only handlers in new code (the wipe + boot_failed paths emit structured JSON intentionally).

### Test & Build Verification

- `cd kinetica_bi/server && npx vitest run tests/boot.wipe.spec.ts tests/boot.hardening.spec.ts tests/bootstrap.spec.ts` → **15 passed / 1 skipped (3 files)**.
- `cd kinetica_bi/server && npx vitest run` → **337 passed / 1 skipped (24 files)** - full suite green, no regressions.
- `cd kinetica_bi/server && npx tsc --noEmit` → **exit 0** - no type errors.
- bootstrap.spec.ts gateRegex (verifies IIFE body still contains both `app.listen` and `startSessionSweep()`) - PASSING; wrap-in-place strategy validated.

### Human Verification Required

None. All 5 ROADMAP success criteria are programmatically verifiable via test runs and grep-based content checks. The runbook content (SC3, SC4) is reviewed via verbatim string match against the locked-in CONTEXT.md decisions; no human aesthetic judgment required.

### Gaps Summary

No gaps found. Phase 8 fully achieves its goal across all three deliverables:

1. **Boot-time AUTH_MODE-change wipe** — `wipeSessionsOnModeChange()` runs unconditionally inside `createApp()` between authMode validation and OIDC boot, wraps COUNT + DELETE in `db.transaction()`, deletes only contradicting `credential_type` rows, emits structured `auth_mode_change_wipe` JSON only when `deleted > 0`, and tests cover both directions plus the steady-state no-op.

2. **Boot hardening** — Bootstrap IIFE catch swapped from prose `console.error("[boot] startup failed", err)` to structured JSON `boot_failed` event with separate `message` and `stack` top-level fields. Hardening tests lock the contract for both the missing-OIDC-env-var path (validateOidcEnv → IIFE catch) and the wipe-SQL-throw path (Plan 08-01 wipe → IIFE catch).

3. **Operator runbook (Phase 8 Delta)** — Appended 96 lines to existing DEPLOY-RUNBOOK.md mirroring Phase 3 Delta's precedent. Contains all 10 required content elements (frontmatter, TL;DR, BI env vars, Kinetica trust config with DBA-task callout, AUTH_MODE-change behavior, boot hardening event, secret rotation safety, troubleshooting with verbatim re-auth-loop line, 5-item acceptance checklist, "What is NOT in Phase 8"). All four universal OIDC trust bullets present (issuer URL, expected audience, JWKS URL, claim-to-username mapping).

Phase 8 closes the v1.1 OIDC SSO Support milestone. Both phase-mapped requirements (MODE-05, OPS-01) are satisfied. Full server test suite (337/337 + 1 intentional skip) is green; TypeScript compiles clean.

---

_Verified: 2026-05-01T20:17:00Z_
_Verifier: Claude (gsd-verifier)_
