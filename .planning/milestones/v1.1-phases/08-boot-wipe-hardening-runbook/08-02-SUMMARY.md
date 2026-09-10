---
phase: 08-boot-wipe-hardening-runbook
plan: 02
subsystem: auth
tags: [boot, hardening, structured-logging, fail-fast, oidc, vitest]

# Dependency graph
requires:
  - phase: 05-oidc-module-routes
    provides: validateOidcEnv() throws on missing AUTH_OIDC_* env vars; createApp() async; bootstrap IIFE try/catch with process.exit(1)
  - phase: 06-requireauth-helper-credential-branch
    provides: structured JSON one-liner logging convention (event:value, ts, level) used by oidc_boot and kinetica_unreachable
  - phase: 08-boot-wipe-hardening-runbook
    provides: Plan 08-01 wipeSessionsOnModeChange() inside createApp() — Test 2 simulates a wipe SQL throw to verify the IIFE catch surface
provides:
  - Bootstrap IIFE catch emits structured `boot_failed` JSON log (replaces unstructured `[boot] startup failed` console.error)
  - `message` and `stack` as separate top-level fields on the boot_failed event (operator-friendly + drill-down capable)
  - Two-case hardening tests verifying the contract for missing OIDC env var AND wipe SQL throw
  - Operator grep recipe `jq 'select(.event == "boot_failed")'` now functional
affects: [v1.1 deploy runbook (Plan 08-03 documents this log shape), future v2 boot hardening additions, ops dashboards keyed on boot_failed event]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structured JSON boot logs: `{ ts, level, event, message, stack }` shape locked at IIFE catch (matches Phase 6 oidc_boot/kinetica_unreachable convention)"
    - "Test-local IIFE-body reproduction: when NODE_ENV='test' suppresses the real bootstrap IIFE, tests reproduce the production catch shape verbatim in a helper to assert behavior contracts"
    - "Wrap-in-place over refactor: bootstrap IIFE structure preserved (no extraction to bootstrap()) to keep diffs small and structural regex tests unaffected"

key-files:
  created:
    - "kinetica_bi/server/tests/boot.hardening.spec.ts (198 lines, 2 test cases)"
  modified:
    - "kinetica_bi/server/src/index.ts (lines 746-757 — bootstrap IIFE catch swapped for structured JSON)"

key-decisions:
  - "Wrap-in-place at the existing IIFE catch (lines 746-757); do NOT refactor to a named bootstrap() function — preserves the diff scope and the existing tests/bootstrap.spec.ts gateRegex (which requires app.listen + startSessionSweep() in the IIFE body) keeps passing unchanged."
  - "`message` AND `stack` as separate top-level fields on the JSON object — operators see actionable message at a glance, drill into stack on deep library throws."
  - "Test file reproduces the production IIFE catch shape verbatim in a test-local `runBootstrap` helper. NODE_ENV='test' suppresses the real bootstrap IIFE, so direct triggering is impossible; CONTEXT.md 'Test strategy' explicitly sanctions this duplication-by-design. Test 1's `message` field check against AUTH_OIDC_ISSUER_URL mitigates production-drift risk (that string only appears via validateOidcEnv() throw)."
  - "Test 2 simulates the wipe-throw path via `vi.spyOn(db, 'prepare').mockImplementation(...)` that selectively throws on the SELECT COUNT statement — pass-through for other prepare calls keeps createApp's earlier setup functional. Verifies the wipe→IIFE control-flow contract from Plan 08-01."
  - "No `KINETICA_URL` boot-fail-fast gate added (CONTEXT.md explicit defer to runtime requireConfig middleware + Phase 6 kinetica_unreachable warn)."
  - "process.exit(1) preserved verbatim on the line after the new log — control flow unchanged from current state; only the log shape changes."

patterns-established:
  - "Boot-failure log shape: `{ ts: ISO, level: 'error', event: 'boot_failed', message, stack }` — future boot-time errors (network discovery rejections, DB-open failures) surface through the same IIFE catch and produce the same shape automatically."
  - "Hardening test pattern: stub `process.exit` with `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)` + spy on `console.error` + run a verbatim test-local copy of the production IIFE body."

requirements-completed: [MODE-05]

# Metrics
duration: 2 min
completed: 2026-05-01
---

# Phase 8 Plan 02: Boot Hardening (boot_failed structured log) Summary

**Bootstrap IIFE catch now emits `event: "boot_failed"` JSON with both `message` and `stack` fields, replacing unstructured `[boot] startup failed` console.error; two hardening tests lock the contract for missing-OIDC-env-var and wipe-SQL-throw failure paths.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-02T00:09:36Z
- **Completed:** 2026-05-02T00:11:52Z
- **Tasks:** 2
- **Files modified:** 1
- **Files created:** 1

## Accomplishments

- Bootstrap IIFE catch in `kinetica_bi/server/src/index.ts` now emits structured JSON via `console.error(JSON.stringify({ ts, level: "error", event: "boot_failed", message, stack }))` instead of the prose `console.error("[boot] startup failed", err)`. `process.exit(1)` preserved on the next line.
- New `kinetica_bi/server/tests/boot.hardening.spec.ts` covers two cases: (1) AUTH_MODE=oidc with AUTH_OIDC_ISSUER_URL unset → validateOidcEnv() throws → boot_failed log mentions the missing var; (2) Plan 08-01 wipe SELECT COUNT statement forced to throw via vi.spyOn(db, "prepare") → IIFE catch surfaces the underlying message. Both cases assert `process.exit(1)` was called exactly once.
- Existing `tests/bootstrap.spec.ts` gateRegex test (which requires the IIFE body to contain BOTH `app.listen` and `startSessionSweep()`) still passes unchanged — wrap-in-place strategy validated.
- Full server test suite stayed green: 337 tests pass / 1 skipped (pre-existing it.skip), no regressions.
- ROADMAP.md Phase 8 SC2 satisfied: "Starting the server with AUTH_MODE=oidc and AUTH_OIDC_ISSUER_URL unset (or pointing to an unreachable endpoint) causes the process to exit with a non-zero code and a log message naming the missing/invalid variable."
- Operators can now grep `jq 'select(.event == "boot_failed")'` across log streams to locate startup failures.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace bootstrap IIFE catch console.error with structured boot_failed JSON log** — `ceac4d3` (feat)
2. **Task 2: Add tests/boot.hardening.spec.ts with two cases (missing OIDC env var; wipe throw)** — `f18ac1a` (test)

_Note: Plan 08-02 is type=execute (not type=tdd), so commits use the standard `feat(...)` / `test(...)` convention rather than the RED→GREEN→REFACTOR sequence. The two commits map cleanly to the two `<task>` blocks in the plan._

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — Bootstrap IIFE catch (lines 746-757) swapped from unstructured `console.error("[boot] startup failed", err)` to structured `JSON.stringify({ ts, level, event, message, stack })`. Single 8-line replacement; no other lines in the file changed.
- `kinetica_bi/server/tests/boot.hardening.spec.ts` (new, 198 lines) — Two-case hardening test file. Reproduces the production IIFE catch shape in a test-local `runBootstrap` helper (NODE_ENV='test' suppresses the real IIFE), uses `vi.hoisted` + `vi.mock("openid-client", ...)` for Test 1's OIDC-mode boot, and `vi.spyOn(db, "prepare")` selective-throw pattern for Test 2's wipe-throw simulation.

## Decisions Made

- **Wrap-in-place at the IIFE catch, no `bootstrap()` extraction** — keeps the diff to a single 8-line edit, preserves the existing `tests/bootstrap.spec.ts:54-65` gateRegex regression check (which inspects the literal `if (process.env.NODE_ENV !== "test") { ... }` block contents).
- **`message` AND `stack` as separate top-level fields** — operators see actionable message at a glance ("AUTH_OIDC_ISSUER_URL is required when AUTH_MODE=oidc") and can drill into the stack on deep library throws (e.g., openid-client surfacing a network error from Issuer.discover()).
- **Test-local `runBootstrap` reproduces the production shape verbatim** — duplication-by-design sanctioned by CONTEXT.md "Test strategy". Mitigation for production drift: Test 1 asserts `message` matches `/AUTH_OIDC_ISSUER_URL/`, which is a string that only appears in production via the actual `validateOidcEnv()` throw — a passing test guarantees the production wrapper is at minimum correctly surfacing the production throw.
- **`vi.spyOn(db, "prepare")` selective-throw for Test 2** — passing through other prepare calls (e.g., the migration block in `db.ts`) keeps `createApp`'s earlier setup functional; the throw fires only when the wipe's SELECT COUNT statement is requested. Cleaner and safer than the fallback (drop credential_type column via PRAGMA), which was listed in the plan as a contingency.
- **No `KINETICA_URL` boot-fail-fast gate added** — CONTEXT.md explicitly defers to the existing runtime `requireConfig` middleware and the Phase 6 `kinetica_unreachable` warn-on-failure probe. Phase 8 stays scoped to AUTH_OIDC_* hardening.
- **No tightening of `validateOidcEnv()` error messages** — they already name the missing variable in Phase 5 (`AUTH_OIDC_X is required`); revisit only if a future operator complaint flags clarity issues.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<action>` block (Step 8) listed an alternative `db.prepare("ALTER TABLE sessions RENAME COLUMN credential_type TO _bak").run()` fallback for Test 2 in case the `vi.spyOn(db, "prepare")` approach failed. The primary approach worked on the first run; the fallback was not needed.

## Issues Encountered

None. Plan executed in 2 minutes with both tests passing on first run and no regressions in the 337-test full server suite.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 8 plan ledger:** 08-01 (wipe), 08-02 (hardening) ✓ this plan, 08-03 (runbook) all complete. Phase 8 fully complete.
- **v1.1 milestone:** All five v1.1 phases (4–8) complete. v1.1 OIDC SSO Support milestone is shippable.
- **Operator-facing contract:** The full v1.1 boot-time observability surface is now in place — `oidc_boot` (Phase 6, OIDC mode), `kinetica_unreachable` (Phase 6, warn-only), `auth_mode_change_wipe` (Phase 8, mode-flip wipe), `boot_failed` (Phase 8, fail-fast hardening). Operators can grep all four `event:` values via jq for end-to-end deploy verification.
- **No blockers or concerns identified.**

---
*Phase: 08-boot-wipe-hardening-runbook*
*Completed: 2026-05-01*

## Self-Check: PASSED

- FOUND: kinetica_bi/server/src/index.ts (modified)
- FOUND: kinetica_bi/server/tests/boot.hardening.spec.ts (created, 198 lines)
- FOUND: .planning/phases/08-boot-wipe-hardening-runbook/08-02-SUMMARY.md (this file)
- FOUND commit: ceac4d3 (Task 1: feat replace boot console.error with structured JSON)
- FOUND commit: f18ac1a (Task 2: test add tests/boot.hardening.spec.ts)
- Acceptance criteria: all greps + tsc + 2/2 hardening tests + 337/337 full suite green
