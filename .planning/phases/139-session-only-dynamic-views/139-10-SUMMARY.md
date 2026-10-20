---
phase: 139-session-only-dynamic-views
plan: 10
subsystem: server
tags: [ai, gateway, tools, prompt, dynamic-view]
requires: [139-03, 139-07, 139-09]
provides:
  - gateway bind (add_widget / add_heatmap_layer) and rebind (edit_widget / edit_heatmap_layer) to a dynamic view, validated against the VIEW's columns
  - flat typed add_dynamic_view tool (closed enums, no SQL field); dynamicViewId on the widget and heatmap tools
  - AI_DV_RULES (3 prompt lines); session-view base table, aggregated flag and columns in the snapshot view
  - AiConfig AI_DV_* limits and saved-view sourceTableId wired into the gateway, e2e-proven
affects: [139-14]
key-files:
  created:
    - packages/server/src/lib/ai/dvDeps.ts
    - packages/server/tests/lib.aiGateway.bind.spec.ts
    - packages/server/tests/lib.aiDv.e2e.spec.ts
  modified:
    - packages/server/src/lib/ai/gateway.ts
    - packages/server/src/lib/ai/tools/mutate.ts
    - packages/server/src/lib/ai/tools/types.ts
    - packages/server/src/lib/ai/context.ts
    - packages/server/src/lib/ai/runAnswer.ts
    - packages/server/tests/lib.aiGateway.spec.ts
    - packages/server/tests/lib.aiTools.spec.ts
    - packages/server/tests/lib.aiToolsRegistry.spec.ts
    - packages/server/tests/lib.aiContext.spec.ts
key-decisions:
  - "A patch carrying configPatch.dynamicViewId is a REBIND: it must stand alone, skips DV_BOUND, and is checked against the target view's columns using the widget/layer's recorded refCols"
  - "add_layer bound to a view takes the view's base table when tableId is omitted; an explicit different tableId is refused ('the view is built on table N; use tableId N')"
  - "AI_DV_* limits are built by gatewayDvLimits(config) in a new dvDeps.ts so runAnswer and the e2e specs share one code path"
requirements-completed: [AIACT-V20-07, AIACT-V20-08, AISAFE-V20-04]
duration: ~50min
completed: 2026-10-20
---

# Phase 139 Plan 10: AI tools, binding and prompt for dynamic views Summary

A model can now create a view with `add_dynamic_view` (no SQL anywhere in its args), point widgets and heatmap layers at it, rebind existing ones, and change a view in a single answer (add new, rebind, remove old). The gateway checks every binding against the view's own columns.

## Commits
- a5dbaef: feat(139-10): gateway binds and rebinds widgets/layers to dynamic views
- 6a88671: feat(139-10): add_dynamic_view tool, dynamicViewId binding args, prompt rules, runAnswer dv limits
- a12e21f: test(139-10): scripted-provider e2e for AI dynamic views; shared gateway dv limits helper

## Verification
- Red-first (recorded):
  - Task 1: BINDDV-1..11 (11 tests, covering BINDDV-1..12) 11/11 failed before the gateway change; 11/11 pass after. Tightened GW-2 failed first with `expected [ 'tableId is required for bar' ] to deeply equal [ 'dynamic view 3 does not exist' ]`, then passed.
  - Task 2: TOOLDV-1..5, CTXDV-1/2, REG-1 (18 tools) and TL-7 (order): 9 failed, 33 passed before implementation; 48/48 pass after.
  - Task 3: E2EDV-1..7 were green on first run because the layers beneath were already proven red. To prove E2EDV-4 can fail, `aiDv` was temporarily set to undefined in the harness: E2EDV-4 went red (1 failed, 7 passed), then the file was restored and went back to 8/8.
- `npx tsc --noEmit` clean. `vitest run ai --maxWorkers=4`: 44 files, 459 tests, all green. The full gate (`node scripts/test-gate.mjs`) was NOT run, per orchestrator override (139-14 owns it).
- No provider or Kinetica call (ScriptedProvider, stub LiveSchemaPort, `forbidProviderNetwork`); `packages/server/.env` not read.

## Orchestrator follow-ups
1. GW-2 (`lib.aiGateway.spec.ts`): the `dynamicViewId: 3` assertion is back to `"reference"`. The stage alone does not discriminate: a call without tableId is also "reference" ("tableId is required for bar"), so the first tightening passed before any implementation. The assertion now also pins the reason to `["dynamic view 3 does not exist"]` and goes red against the old gateway.
2. Runtime cap wiring: `aiDv` and `sourceTableId` are wired in `runAnswer`. E2EDV-4 builds the limits via `parseAiConfig(env)` then `gatewayDvLimits(config)` and proves non-default values are enforced: `AI_DV_MAX_PER_SESSION=2` refuses the third view ("limit 2"), `AI_DV_MAX_JOINS=0` refuses a join, `AI_DV_MAX_RECORDS=500` is stamped onto the op. `runAnswer` itself needs a DB and Kinetica so it is not driven; E2EDV-4b is a structural source check that it calls `gatewayDvLimits(config)` and passes `sourceTableId: r.source_table_id`.

## Count-asserting specs updated deliberately
- `lib.aiToolsRegistry.spec.ts` REG-1: "17 tools" retitled "18 tools", `add_dynamic_view` added to the sorted list, `toHaveLength(18)`.
- `lib.aiTools.spec.ts` TL-7: MUTATE_TOOLS order gains `add_dynamic_view` right after `clear_filter`.
- `bootstrap.spec.ts` and `structuralOps.e2e`: grep found no 17-tool assertion, and the whole `ai` pattern suite is green; no edit needed.

## Deviations from Plan
1. [Rule 3 - structure] The plan puts the limits object inline in `runAnswer.ts` (`dvMaxPerSession` count 1 there). Moved to `gatewayDvLimits(config)` in the new `src/lib/ai/dvDeps.ts` so the e2e can exercise the real mapping. The plan's grep `grep -c "dvMaxPerSession" runAnswer.ts = 1` now reads 0 (the symbol is in dvDeps.ts); behaviour is proven by E2EDV-4 instead. `grep -c "sourceTableId: r.source_table_id"` = 1 as planned.
2. BINDDV-11 and BINDDV-12 share one test (the privacy check runs over the labels and reasons of the change-a-view flow); file has 11 `it` blocks and 12 BINDDV- ids.
3. Non-discriminating criteria: the plan's `grep -c "BINDDV-"`, `TOOLDV-`, `CTXDV-`, `E2EDV-` counts only count titles; behaviour is proven by running the specs red then green. The awk SQL-word check on `addDynamicViewArgs` reads 0 but its range stops at the first `.strict();` line, so it only covers part of the block; the full block was read and contains none of sql/template/where/expression, and TOOLDV-3 asserts the strict rejection directly.

## Notes and known gaps
- `apply_filter` / `clear_filter` tool args still declare `dynamicViewId` as `.positive()` (138), so the model cannot filter an AI (negative-id) view through the tool even though the gateway accepts it (D-23). Left untouched (outside this plan's files); flag for 139-14 / a follow-up.
- A rebind to a saved view does not update the shadow widget's `tableId` (shadow dvInfo does not hold saved views' base table); column checks and dv id are updated.
- Known red, not mine: TTL specs under the `packages/server/.env` DEFAULT_VIEW_TTL_MINUTES leak.

## Self-Check: PASSED
Files exist: dvDeps.ts, lib.aiGateway.bind.spec.ts, lib.aiDv.e2e.spec.ts. Commits a5dbaef, 6a88671, a12e21f are in git log.
