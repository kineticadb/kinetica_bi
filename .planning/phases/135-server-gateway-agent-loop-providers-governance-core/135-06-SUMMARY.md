---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 06
subsystem: ai-governance
tags: [gateway, shadow, live-schema, rbac, d-16]
requires: [135-02]
provides: [checkAiOp, AI_COLUMN_BINDING_KEYS, createShadow, applyOpToShadow, describeOp, createLiveSchema]
key-files:
  created:
    - packages/server/src/lib/ai/shadow.ts
    - packages/server/src/lib/ai/liveSchema.ts
    - packages/server/src/lib/ai/gateway.ts
    - packages/server/tests/lib.aiShadow.spec.ts
    - packages/server/tests/lib.aiLiveSchema.spec.ts
    - packages/server/tests/lib.aiGateway.spec.ts
decisions:
  - "D-16: gateway has no edit-permission checks; permission stage = ai:use + canViewDashboard, both re-read per op"
  - "AI_COLUMN_BINDING_KEYS = metricColumn, groupByColumn, groupByColumns (metric/dimension are snapshot names only; no renderer reads them from config)"
requirements: [AISAFE-V20-02, AISAFE-V20-03]
completed: 2026-10-12
---

# Phase 135 Plan 06: Validation gateway Summary

`checkAiOp` runs shape, allow_list, permission, reference, live_schema in fixed order and stops at the first failure. Shadow state tracks in-turn adds and removes. The live-schema port probes `SELECT * FROM schema.name LIMIT 0` as the asking user, cached 60 s per (user, table), and returns exactly `{ok:false}` for unregistered, inaccessible and upstream-failed tables.

## Commits
- 950c8f6 feat(135-06): AI shadow state and user-credentialed live-schema probe
- 915da34 feat(135-06): one fixed-order validation gateway for AI ops (D-16) (also contains a comment-only liveSchema.ts edit)

## Verification
- Server `tsc --noEmit` clean. 17 tests green across the 3 new specs. Shared vitest 80/80.
- Grep: `dashboards:edit|widgets:configure|...` in gateway.ts = 0; `columns_json` in liveSchema.ts = 0; `buildViewColumnsProbeSql` = 2.

## Mutation proofs (all reverted, file diffed identical to original)
1. Added a `dashboards:edit` requirement to the permission stage: GW-4 failed (6 failed in total, because every positive op also broke).
2. Cached `getPermissions` across calls: GW-5 failed (GW-3 and GW-8 also failed).
3. Swapped the permission and live_schema stages: GW-8 failed (only that test).

## Red-first
Specs were run red (module missing) for Task 1 before implementation. For Task 2 the gateway spec and implementation were written in one pass and then run, so red was not observed separately; the mutation proofs are the discriminating evidence.

## Deviations / notes
- **[Plan vs reality] `__proto__` -> allow_list is not observable.** `parseAiOp`'s `z.record` strips an own `__proto__` key at the shape stage (probed: raw and passthrough keep it, parseAiOp drops it). GW-2 asserts the real guarantee instead: an accepted op never carries an own `__proto__`. `constructor` is rejected by the allow-list as planned (via a pass-through fake tool).
- **[Rule 1] `tableId` exempted for add_widget config.** `PERMANENTLY_BLOCKED_KEYS` includes `tableId`, but the plan binds a new widget through `config.tableId` (checked at live_schema). The gateway removes only `tableId` from the blocked set for add_widget; `id`, `type`, `widgetId` etc. stay blocked. A patch still cannot change a table (`validateActionPatch` blocks it).
- The `liveSchema` cache is module-level and keyed by ttl value; `now` is taken from the first creator for that ttl. Fine in production (default `Date.now`); tests use `__clearLiveSchemaCacheForTest` in `beforeEach`.
- Reasons for a missing column include the column NAME the model supplied (and near column names from the user's own table); never values from args other than the name, never upstream text.
- Non-discriminating criterion: the plan's `columns_json` = 0 criterion initially failed only because my own header comment named it; reworded. Plan GW-7 "add_widget without tableId -> shape" holds only because the fake tool's schema requires it; real tools (135-07) must require tableId too.
- Server full set-based gate not run; only the AI files plus tsc.

## Self-Check: PASSED
Files exist; commits 950c8f6 and 915da34 exist.
