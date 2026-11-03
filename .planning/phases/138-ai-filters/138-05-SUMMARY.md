---
phase: 138-ai-filters
plan: 05
subsystem: web-ai-filter-applier
tags: [ai, filters, undo, orchestrator]
requires: [138-01, 138-03, 138-04]
provides: [executeFilterOp, undoFilterDeltas, redoFilterDeltas, clearFilterAsUser, currentFilterColumns, installAiFilterEffects, discardAiSession, AI_FILTER_COPY]
affects: [138-06, 138-07]
key-files:
  created:
    - packages/web/src/lib/aiOps/aiFilterApplier.ts
    - packages/web/src/lib/aiOps/aiFilterApplier.spec.ts
    - packages/web/src/lib/aiOps/aiFilterEffects.ts
    - packages/web/src/lib/aiOps/aiFilterEffects.spec.ts
    - packages/web/src/lib/aiOps/aiFilterCopy.ts
    - packages/web/src/hooks/useCombinationOrchestrator.aiFilter.spec.ts
requirements-completed: [AIACT-V20-09 (applier/undo part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 05: AI filter applier, undo and orchestrator proof Summary

The AI now writes filterStore through exactly the actions a click uses (addFilter/addDvFilter/removeFilter/removeDvFilter), with guarded per-column undo/redo, a cursor sink for Revert/Forward, a Discard helper, and an orchestrator-level proof that an AI filter and the equal click post the same materialize request and share the same combination view for charts, records, map layers and dvs.

## Commits
- Task 1: feat(138-05) AI filter applier with per-column undo/redo and copy (aiFilterApplier.ts, spec, aiFilterCopy.ts)
- Task 2: feat(138-05) AI filter cursor sink and discard restore per column
- Task 3: test(138-05) AI filter equals click through the real orchestrator

## Red-first evidence
- Task 1: spec written first; run failed to load: `Failed to resolve import "./aiFilterApplier"` (no tests ran). Then implemented; APF-1..12 passed (12/12).
- Task 2: HONEST DEVIATION. I wrote spec and implementation in the same step, then noticed. I recovered by moving aiFilterEffects.ts aside and re-running: `Failed to resolve import "./aiFilterEffects"` (Test Files 1 failed, no tests), restored it, then UNDOF-1..8 passed (8/8). This red is "module absent" only, not behavioural, so it proves little on its own; behaviour discrimination is by the specs' assertions (e.g. UNDOF-1 double-install, UNDOF-6 no double undo).
- Task 3: no production change is expected, so a red run is impossible by design. Discrimination checked by mutation instead: temporarily adding `sourceWidgetId: 1` to toActiveFilter made ORCHF-4 fail (1 failed, 3 passed); reverted (verified clean, 0 occurrences). ORCHF-1 still passed under that mutation because the combination hash ignores sourceWidgetId by design.

## Verification
- web tsc clean; full `vitest run --maxWorkers=4`: 237 files passed, 1 skipped, 4810 tests passed; theme-guard green; actionEngineDecoupling spec green.
- Applier source contains 0 of filterViewStore/materializeFilter/clearAllFilters/setBulkFilters/useSpatialFilterStore/`sourceWidgetId:` (APF-12 asserts it).
- No 138-05 commits touch useCombinationOrchestrator.ts, MapChartRenderer.tsx, WidgetRenderer.tsx, foldSession.ts or aiSessionStore.ts (0 each).

## Not verified here
- Map TILES narrowing against real Kinetica (SC4) cannot be asserted in jsdom; routed to 138-08 operator check. ORCHF-1 proves the layer key `l:<id>` resolves to the same combination hash as after a click.
- ORCHF-1 uses a table-bound layer without a hosting map widget (the orchestrator takes layers independently).

## Deviations from Plan
- Task 2 red-first lapse (above), recovered by removal re-run.
- Pre-check criteria held (aiOps dir absent, symbols absent before work). APF-/UNDOF-/ORCHF- counts were 0 before.
- In APF-8 the shape assertion checks `shapes` length 1 after clear-all (the plan's wording only said "still present").

## Notes for downstream (138-06/07)
- Callers must pass `TurnInput.currentFilters: currentFilterColumns()` into applyTurn, then execute applied filter ops and `attachEntryFilterDeltas`; spec helper `aiTurn` in aiFilterEffects.spec.ts shows the shape.
- Call `installAiFilterEffects()` once at app/session mount; use `discardAiSession()` only for Discard (reset() alone must not restore).
- `reset()` does not notify the sink (138-03); allow-list widgets deliberately ignore AI filters (ORCHF-4), surfaced via `AI_FILTER_COPY.skippedScoped`.

## Self-Check: PASSED
All six files exist and the three commits are in git log.
