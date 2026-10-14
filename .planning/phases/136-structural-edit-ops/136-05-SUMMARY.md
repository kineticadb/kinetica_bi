---
phase: 136-structural-edit-ops
plan: 05
subsystem: server-ai-tools
tags: [ai, tools, system-rules, enums]
requires: [136-01, 136-04]
provides:
  - 12 flat strict typed mutate tools (add/edit/rename/retype widget, set_layout, add/edit heatmap layer, layer visibility, patch, removes)
  - Phase 136 system rules built from shared vocabularies
  - DashboardView layers[].widgetId and widgets[].dynamicViewId
affects: [136-06, 136-12]
key-files:
  modified: [packages/server/src/lib/ai/tools/mutate.ts, tools/types.ts, context.ts, tests/lib.aiTools.spec.ts, tests/lib.aiToolsRegistry.spec.ts, tests/lib.aiContext.spec.ts, tests/helpers/aiRouteKit.ts, tests/lib.aiAgentLoop.spec.ts]
metrics:
  tasks: 2
  completed: 2026-10-13
---

# Phase 136 Plan 05: Flat typed mutate tools and system rules Summary

Twelve flat `.strict()` mutate tools whose colours, aggregations, ramps and topN are enums (no config/sql/layout properties, no composites), plus system rules for no-SQL/no-hex/repair/confirm/dashboard-tables, and layer map ids in the projected view.

## Commits
- 0787440 feat(136-05): flat typed mutate tools for structural and edit ops
- 0e48615 feat(136-05): system rules for structural ops; layer map ids in the dashboard view

## Evidence
- Red first: Task 1 9 failed / 18 before implementation; Task 2 CTX-1 and CTX6-2 failed before.
- Mutation: `colour` made `z.string()` -> TOOL6-6 fails; reverted, 14/14 green.
- Gates: server tsc clean; test-gate PASSED (only off-list file lib.exportRunner.memory passes alone = TD-V16-TEST-ISOLATION). Greps: `config: z.record` 0, hex in mutate.ts 0.

## Deviations
- tests/lib.aiTools.spec.ts needed a `zod/v4` import for the schema walker.
- TOOL6-7 skips the legacy `patch` tool (its `changes` record is kept for dynamic views; it has no config/sql/layout property anyway).
- routes.aiAsk.sse/audit, routes.aiEgress, routes.aiSecrets needed no edits: they use the aiRouteKit `addWidgetArgs`, which was flattened. Files outside plan list: none.
- Pre-existing tests/lib.aiShadow and aiGateway specs use their own stubs; untouched.

## Non-discriminating criteria
- Regression-guard hex grep reads 0 before and after by design; TOOL6-6 plus the mutation proof is the real check.
- CTX6-3 (no hex in rules) likewise passes pre-work; the CTX6-2 vocabulary assertions are the discriminating ones.

## Notes for 136-06
- add_heatmap_layer omits `widgetId` when mapWidgetId absent (gateway resolves host).
- edit_widget with no fields yields `configPatch: {}`; gateway rejects it.
- Loop fixtures now use flat add_widget args (`metric`, `aggregation`, `groupBy`).
- Tool set changed: S6 scores invalid until the 136-12 live check.

## Self-Check: PASSED
