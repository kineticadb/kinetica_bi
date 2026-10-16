---
phase: 138-ai-filters
verified: 2026-10-16T14:15:00Z
status: passed
score: 4/4 success criteria verified
gaps: []
---

# Phase 138: AI Filters Verification Report

**Phase Goal:** The AI applies and clears filters through the same path a click uses, so charts, records tables and map tiles narrow consistently.
**Status:** passed (with two non-blocking warnings, see below)
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | "Show only X" narrows charts, tables, map tiles like a click; clear removes it | VERIFIED | `lib/aiOps/aiFilterApplier.ts` `set()` writes through `useFilterStore` (addFilter/removeFilter/removeDvFilter), the same store a click uses. `applyAiTurn.ts` calls `executeFilterOp`. UAT step 1: AI filter and a hand click produce the identical combination view name; clear returns `LAYERS=demo.nyctaxi`. |
| 2a | Undo restores prior per-source filter state | VERIFIED | `undoFilterDeltas`/`redoFilterDeltas` restore per column only if the column still holds what the AI left (D-11). Wired through `aiFilterEffects.ts`, `useAiSessionActions.ts` and `AiDiscardDialog.tsx`. UAT steps 4, 5 and 7 passed. |
| 2b | Badges read `filterCombinationStore` | VERIFIED | `FilteringBadge.tsx` and `MapFilteringBadge.tsx` import `useFilterCombinationStore`, and neither imports `filterViewStore` (the only mentions are comments). AI filters go through filterStore, then the orchestrator, then the combination store. UAT step 8b showed a "0 of 1 filters" badge on a scoped widget. |
| 3 | Nonexistent column refused; per-table cap holds | VERIFIED | `server/src/lib/ai/gateway.ts` ~L425 refuses with `column ... not found on ...` plus did-you-mean, and refuses the whole op past the cap (D-08). The applier also drops filters the store refuses at cap (`aiFilterApplier.ts` L61). `tests/lib.aiGateway.filter.spec.ts` passes 12/12. |
| 4 | Map tiles visibly narrow on real Kinetica | VERIFIED (operator) | `138-08-UAT-RESULTS.md`: new WMS `LAYERS=_kbi_filt_...` combination view, map points thin, dark and light. Operator approved 2026-10-16. |

**Score:** 4/4

## Scrutiny items

- **Map WMS read path:** `MapChartRenderer.tsx` reads `useFilterCombinationStore` and has both `buildWmsParams` sites (~L1372 and ~L1630). Both resolve the layer through `vizToHash["l:<id>"]` and the registry (comments at L1336, L1595, L1651). It is a separate read path from WidgetRenderer, and it consumes the combination store, so AI filters narrow it. UAT confirmed this live.
- **Decoupling invariant:** `actionEngineDecoupling.spec.ts` passes. It covers the engine modules plus `aiSessionStore`, `foldSession` and `applySession`. The applier (`lib/aiOps/aiFilterApplier.ts`) sits outside the engine and is the only module that imports the filter store.
- **Tests run:** web, 11 files / 112 tests passed (decoupling, aiOps, filterStore.aiFilter, aiSessionStore.filter, orchestrator.aiFilter, useAiSessionActions, DashboardsPage.aiFilter, AiDiscardDialog). Shared `aiFilter` and `aiOp` specs: 27 passed. Server gateway filter spec: 12 passed. Stderr shows noisy `view.getCenter is not a function` from a map mock, which does not affect results.

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| AIACT-V20-09 | 138-01 through 138-08 (all eight declare it) | SATISFIED | See truths 1-4. REQUIREMENTS.md line 41 is `[x]` and line 133 reads "Phase 138 / Complete". No orphaned Phase 138 IDs. |

## Known weak tests (not gaps)

LOCKF-8 is non-discriminating. UNDOF-1..8 were red only as module-not-found. AAT-2 and ZR-4..8 pass against no-op stubs. Live UAT covered the corresponding behaviours (undo and revert in steps 4, 5 and 7; zero-rows note and "Clear this filter" in step 8; lock and leave dialog in step 3), so the automated proofs are weak but the behaviour is proven. **Unproven by anything:**
- Drawn-shape survival on clear-all (UAT: no shape drawn).
- Live model adherence (step 9 skipped; deferred to Phase 142).
- Dark mode for UAT steps 4 and 5 (light only).

## Anti-Patterns / Warnings (non-blocking)

| Item | Severity | Note |
|---|---|---|
| Intermittent blank map in DARK mode after an AI filter (3 of 3 first runs, 0 of 8 later; cause unknown) | Warning | Todo `todos/pending/2026-10-16-ai-filter-dark-map-blank-intermittent.md`, needs `/gsd:debug`. It could undermine SC1's "map narrows" in dark mode, and it is not reproducible. |
| "Clear this filter" button styled identically to follow-up suggestions | Info | Todo `2026-10-16-ai-filter-clear-button-styling.md`. |

## Human Verification

Already completed by the operator (138-08-UAT-RESULTS.md, 2026-10-16). Nothing further is required for phase closure.

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
