---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 01
subsystem: auth
tags: [rbac, permissions, ai]
requires: []
provides:
  - "PERMISSIONS.AI_USE ('ai:use') on server + web, designer default"
  - "AI permission group on Roles page"
affects: [135-10, 137, 141]
key-files:
  modified:
    - packages/server/src/lib/permissions.ts
    - packages/web/src/lib/permissions.ts
    - packages/web/src/lib/permissionGroups.ts
decisions:
  - "No migration: history-gated rbacSeed seeds (designer, ai:use) once on existing DBs"
metrics:
  tasks: 2
  completed: 2026-10-12
---

# Phase 135 Plan 01: ai:use permission Summary

`ai:use` added as the 19th permission on both stacks (designer default, admin automatic, analyst/user_admin excluded), shown in its own "AI" group on the Roles page, with every count-asserting spec updated in this one plan.

## Commits
- 5a49da1 feat(135-01): server catalog, designer default, 8 server specs
- cf973a6 feat(135-01): web mirror, AI group, 3 web specs

## Red-first evidence
- Server (before the source edit): `lib.permissions.spec`, `db.rbacMigration.spec`, `auth.login-rbac.spec` showed "15 failed" including the new `PERMISSIONS.AI_USE is 'ai:use'`, `designer defaults include ai:use`, the AI-UPGRADE test (seed once, removal persists) and `designer login lists ai:use; the analyst fallback omits it`. All green after.
- Web: with `permissionGroups.ts` temporarily reverted to HEAD, `lands in its own "AI" group, not "Other"`, `maps all known permission nouns` and `has the seven expected group names` failed (3 failed | 7 passed); green after restore. (Web catalog mirror and spec count edits were made together with the source, so only the group tests were demonstrated red.)

## Verification
- Server tsc clean; 8 touched specs 165/165; `node scripts/test-gate.mjs` PASSED (non-listed failures lib.exportRunner.memory / routes.exports pass alone = TD-V16-TEST-ISOLATION).
- Web tsc clean; theme-guard green; full vitest green on re-run (one first-run failure did not reproduce, not investigated further).
- Grep: `toBe(18)|toHaveLength(18)|.length).toBe(18)` in server tests 0; web src 2 (BrandColorSection.spec.tsx, cbColorThemes.spec.ts - unrelated, intentionally untouched).

## Deviations
**[Rule 1 - missed spec] ** Two assertions not in the plan's table also depended on designer's size: `db.rbacMigration.spec.ts:199` (SQL count 10->11) and `lib.rbacDb.spec.ts` multi-role union (designer+user_admin 15->16, plus `ai:use` in the comment list). Found by running the specs; fixed in the server commit.

## Criterion notes
- The plan's grep pre-check for server (`toBe(18)...` = 14) was not 14 on arrival for web/server combined counts being exact, but all criteria discriminated (went from >0 to 0 / 2 as stated). No non-discriminating criterion found.
- Operator-visible Roles page rendering was not eyeballed (no new CSS; reuses the existing group rendering).

## Self-Check: PASSED
Commits 5a49da1 and cf973a6 exist; permissions.ts files contain AI_USE.
