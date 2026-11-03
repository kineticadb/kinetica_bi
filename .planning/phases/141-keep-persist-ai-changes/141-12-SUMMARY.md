---
phase: 141-keep-persist-ai-changes
plan: 12
subsystem: server
tags: [keep, route, audit, rbac, optimistic-concurrency]
requires: [141-01, 141-02, 141-03, 141-05, 141-06, 141-07, 141-08]
provides: [registerAiKeepRoutes, recordAiKeep, KEEP-ROUTE-* proofs]
key-files:
  created:
    - packages/server/src/aiKeepRoutes.ts
    - packages/server/tests/routes.aiKeep.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/src/lib/aiAudit.ts
    - packages/server/tests/routes.versionStamp.spec.ts
gaps: []
requirements: [AISES-V20-05, AISES-V20-06]
completed: 2026-10-21
---

# Phase 141 Plan 12: Keep route Summary

`POST /api/dashboards/:id/ai-keep` is the single Keep authority: rights, version pre-check, validation, live-schema re-check, one-transaction write, `ai_audit` row (counted 0) and after-commit drop of removed saved views. SC1, SC2 and SC3 are proven over HTTP.

## Commits
- 36e61dc feat(141-12): route, recordAiKeep, index registration, versionStamp 13 -> 14, full KEEP-ROUTE-* spec

## RED evidence
- Spec written first with the route absent: `18 failed (18)` (404s, plus a fixture-insert error that was a test bug, fixed).
- First GREEN attempt exposed test-fixture bugs of mine (not code): tables from `makeTableOn` have `columns: {}` so `fare` was "not numeric" (switched to `createTable` with typed columns); the list GETs return `{data}` / `{dynamic_views}`; the fixture layer insert needs `layer_type`.
- Weakened-handler discrimination (restored every time, nothing committed, `git status` clean):
  - rights check disabled -> `KEEP-ROUTE-forged-right` fails (1 failed | 18 passed).
  - version pre-check removed -> `KEEP-ROUTE-conflict` and `KEEP-ROUTE-double` fail (2 failed | 17 passed); `KEEP-ROUTE-race` stays green because the in-transaction compare is the real guard.
- Green on arrival (protected by an earlier layer, not by new route code): the schema 400s (`template_sql`/`columns`/`dashboardId` extras, `type: "ai"` add) are enforced by the 141-01 strict schema; `KEEP-ROUTE-fixture` and `KEEP-ROUTE-temps` passed first time because `applyKeep` (141-06) already remaps temp ids inside EDIT `configSet.dynamicViewId`, `configSet.includedLayerIds`, layer add/edit `dynamicViewId`. No `applyKeep` fix was needed (carry-forward note 2 verified, no negative id survives in stored rows).

## Gates
- Server `tsc --noEmit` clean. `node scripts/test-gate.mjs`: GATE PASSED, 2606/2663, 12 failing files = the 8 known-set files + 4 contamination-only files that pass alone (lib.exportRunner.memory, routes.aiAsk.sse, routes.branding, routes.custom-metrics). No TTL rerun needed.
- `git diff --stat e1b3cda` on the three permission source files: empty (no new permission, D-19).
- Shared: `tsc --noEmit` clean, vitest 203/203.
- Route specs: routes.aiKeep (19) + routes.versionStamp + routes.aiDv = all green.

## Deviations from Plan
1. **[Rule 1 - Bug] Version pre-check moved before `checkKeepChange`.** Plan order was rights -> checkKeepChange -> pre-check. With that order a stale replay (second Keep from the same baseline, whose removed widget/dv no longer exist) returns 422 "not found" instead of 409. The SC3 contract says a changed dashboard is 409, so the pre-check now runs right after the rights check (still before any Kinetica call). `KEEP-ROUTE-double` caught this.
2. Both tasks' tests were written together and committed in one commit (Task 2 added no new file changes after Task 1's commit; discrimination runs are recorded above). Added an extra test `KEEP-ROUTE-temps` for carry-forward note 2.
3. Criterion `grep -c "/api/dashboards/:id/ai-keep" aiKeepRoutes.ts = 1` reads 3 (path also appears in header comments and the ROUTE tag); it was structural, the registration itself occurs once. No code changed to satisfy it. The `PERMISSIONS.AI_USE` = 0 grep is an invariant and cannot fail first; the discriminating proof is KEEP-ROUTE-5.
4. Response warnings combine `checkKeepChange` and `prepareKeep`/`applyKeep` warnings (carry-forward note 3).

## Self-Check: PASSED
Files exist, commit 36e61dc present, gate green.
