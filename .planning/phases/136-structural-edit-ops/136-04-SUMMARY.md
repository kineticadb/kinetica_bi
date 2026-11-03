---
phase: 136-structural-edit-ops
plan: 04
subsystem: server-ai-gateway
tags: [ai, gateway, catalogue, clarification, layout, heatmap]
requires: [136-01]
provides:
  - gateway enforcing D-23 catalogue, D-22 dashboard tables, D-04/D-02 refusals, D-06/D-11 clarifications, D-21 layer column checks, placement and layout validation
  - GatewayResult refKey/slot/label/clarification; stages layout/clarification/cap
  - layout-aware ShadowState, describeIntent, shadowRects
affects: [136-05, 136-06]
key-files:
  modified: [packages/server/src/lib/ai/gateway.ts, shadow.ts, tools/types.ts, runAnswer.ts, packages/server/src/spikes/toolCallSpike.ts, tests/lib.aiGateway.spec.ts, tests/lib.aiShadow.spec.ts, tests/lib.aiAgentLoop.spec.ts, tests/helpers/aiRouteKit.ts, tests/routes.aiAsk.sse.spec.ts]
metrics:
  tasks: 3
  completed: 2026-10-13
---

# Phase 136 Plan 04: Gateway structural-edit enforcement Summary

The Phase 135 gateway now enforces every server-checkable Phase 136 rule: positive config catalogue, dashboard-associated tables only, refusal rules, clarifications instead of unapproved removals, map host resolution, heatmap layer column checks, automatic placement and whole-layout validation.

## Commits
- f21e2ae feat(136-04): gateway result/stage types, layout-aware shadow, deps wiring
- 3d4954c feat(136-04): gateway catalogue, dashboard-tables rule, refusals, column hints and placement
- 0712576 feat(136-04): gateway clarifications, heatmap layer checks, map-plus-layer and layout validation

## Evidence
- Red first: SHD6 (4 failed before shadow work); GW6-1 and 12 other new/ripple cases red before gateway Task 2 (13 failed / 20); 5 new cases red before Task 3 (5 failed / 25). All green after.
- Mutation proofs (each reverted, file diffed identical to backup):
  - catalogue call replaced by accept-all -> GW6-1 and GW-2 fail
  - D-22 `includes` guard removed -> GW6-2 fails
  - `nearest` candidate pool widened with the sentinel column -> GW6-3 fails (there is no registered-tables dep in the gateway, so "widen to all registered tables" was simulated by injecting `fare_secret`)
  - approvals gate always-allow -> GW6-13 fails
  - layer-patch column refs removed -> GW6-11 fails
- Gates: server `tsc --noEmit` clean; 8 listed specs 92/92; `node scripts/test-gate.mjs` PASSED (3 off-list files lib.exportRunner.memory, routes.dashboard-import.refs, routes.exports passed alone = TD-V16-TEST-ISOLATION). `grep -rn fare_secret packages/server/src` = 0.

## Deviations
- [Rule 3] The nearest-name ranking gained a shared-prefix >= 4 rule so "fares" hints `fare_amount` (D-21 test required it; not in plan's rank list).
- routes.aiAsk.sse.spec SSE-R2: expected op now includes gateway-stamped `layout` and catalogue keys (`metric`/`aggregation`). The secret table there is associated with the dashboard, so its live_schema expectation is unchanged. routes.aiEgress and routes.aiSecrets needed no edits (their saved-id removes are rejected or pass without changing egress assertions; no clarification arose). routes.aiEgress.spec.ts therefore not modified despite being listed.
- lib.aiGateway.spec stub add_widget tool is now passthrough (catalogue keys flow into config); GW-7 uses `dashboardTableIds` [5,7,8] to keep its live_schema intent (table 8 off-dashboard would now be a reference failure).
- GW-9 label now `Added map "T" below existing content` (placement).
- Files outside the plan list: none.

## Non-discriminating criteria
- `grep -c "removeSaved: true" tests/lib.aiGateway.spec.ts >= 4`: the repaired GW-4/5/6/9 use a shared `APPR` constant, so the literal occurs once; real requirement verified by GW6-13 mutation (approvals gate removal fails the spec) and by GW-4/5/6/9 passing.
- GW6-3 "no disclosure" is only a proof because of its positive control plus the mutation above.
- Not automatically verifiable: placement default sizes / "reads well" (136-12 human check).

## Self-Check: PASSED
