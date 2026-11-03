---
phase: 139-session-only-dynamic-views
plan: 11
subsystem: web
tags: [ai, dynamic-view, chain, orchestrator]
requires: [139-02, 139-05, 139-09]
provides:
  - toSessionDvRows, notifyAiDvStatus
  - chain sessionRows/removedSavedIds params, merged dynamicViews + savedDynamicViews, id<0 materialize branch
  - aggregated fast-path skip (D-02/D-03)
  - orchestrator aiNonce/aiGen for AI-view drill filters (D-23)
affects: [139-12, 139-13, 139-14]
key-files:
  created:
    - packages/web/src/lib/aiDv/sessionDvRows.ts
    - packages/web/src/lib/aiDv/sessionDvRows.spec.ts
    - packages/web/src/lib/aiDv/aiDvNotes.ts
    - packages/web/src/lib/aiDv/aiDvNotes.spec.ts
    - packages/web/src/hooks/useDynamicViewMaterializeChain.aiDv.spec.ts
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/hooks/useDynamicViewMaterializeChain.ts
    - packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
key-decisions:
  - "Session row change token = g<gen>|<base token>|j<tableId>:<hash:viewName:expiresAt | raw>...; dedupe on the full token, fast-path/wait logic on the base token"
  - "Orchestrator skips (continue, before markMaterializing) a negative dv id with no session row so the registry entry is never touched"
requirements-completed: [AIACT-V20-07, AISAFE-V20-06]
duration: ~40min
completed: 2026-10-20
---

# Phase 139 Plan 11: Web read/materialize path for AI views Summary

Session AI views become DynamicViewRows merged into the chain's single list, materialize through the ad-hoc route with base and joined-table filter keys, generation and pending-drop ordering, and the local no_filter fast-path is skipped for aggregated views. Drill filters on AI views carry aiNonce/aiGen.

## Commits
- ab426e1: Task 1 `feat(139-11): session dv rows, client row types and D-05 status notes`
- ef47812: Task 2 `feat(139-11): chain merges session AI views and materializes them via the ad-hoc route`
- 881a46e: Task 3 `feat(139-11): orchestrator sends aiNonce/aiGen for AI-view drill filters (D-23)`

## Red-first record
- Task 1: sessionDvRows.spec + aiDvNotes.spec run before implementation: both files failed to load (modules missing). After: 9/9 green.
- Task 2: aiDv spec + CHAINDV-A1/A2 run before implementation: 11 failed (CHAINDV-1..10 and A1); A2 passed pre-change by design (it pins the unchanged fast-path for aggregated false/undefined). After: 41/41 in the two chain specs; T2, T18, DVCOMBO-C4, DVCOMBO-SP-C3/C4 unchanged and green.
- Task 3: ORCHDV-1 and ORCHDV-3 failed before implementation; ORCHDV-2 passed pre-change by design (pins positive path key set). After: 53/53.

## Verification
- `npx tsc --noEmit` clean; FULL web vitest `--maxWorkers=4`: 248 files passed / 1 skipped, 4917 tests passed (includes theme-guard).
- Acceptance greps after: `materializeAiDynamicView(` 1, `pendingAiDvDrop(` 1, `!dv.aggregated` 1 in the chain.

## Deviations from Plan
None functionally. Notes:
- Task 1 first commit attempt failed on shell quoting (no partial commit); retried as ab426e1.
- The "visible legibility of the D-05 note" requirement is not auto-verifiable; routed to 139-14 UAT (light + dark).

## Open observation for 139-12/13/14 (not changed here)
The orchestrator's dv key (`${dv.id}:${source_table_id}`) does not include the AI view generation. After undo/redo (new gen -> new server view name) an existing combination entry for `dv:-N` keeps pointing at the old generation's filter view until its hash changes. 139-13/UAT should exercise filter + undo + redo on an AI view; if stale, add `ai.gen` to the dv key and drop the entry on gen change.

## Self-Check: PASSED
Created files exist (sessionDvRows.ts/.spec.ts, aiDvNotes.ts/.spec.ts, chain aiDv spec); commits ef47812 and 881a46e present; Task 1 commit present on branch.
