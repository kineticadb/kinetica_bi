---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 02
subsystem: ai
tags: [generate-mode, layout, agent-loop]
requires: []
provides:
  - placeGenerateBands / GENERATE_AI_RECT / GENERATE_MAIN_COLS (shared)
  - generateMode.ts helpers (recipe, limits, nudge, applyGenerateBands, countDataWidgetAdds)
  - AgentLoopInput.beforeFinish
affects: [142-05, 142-06]
key-files:
  created:
    - packages/server/src/lib/ai/generateMode.ts
    - packages/server/tests/lib.aiGenerateMode.spec.ts
    - packages/server/tests/lib.aiAgentLoop.generate.spec.ts
  modified:
    - packages/shared/src/layout.ts
    - packages/shared/src/layout.spec.ts
    - packages/server/src/lib/ai/agentLoop.ts
decisions:
  - Widths rescaled from Phase 136 AI_DEFAULT_SIZE to fit the 24-col main area beside the 12-col AI column (KPI 12/8 wide, middle charts 12 or 24, map 24x40, records 36x36 below the AI column); heights kept (KPI 14, middle 30, records 36; map 45 -> 40).
metrics:
  tasks: 2
  completed: 2026-10-23
gaps: []
---

# Phase 142 Plan 02: Generate-mode building blocks Summary

Pure server-fixed band layout (shared), generate recipe/limits/nudge/op-rewrite helpers, and a one-shot `beforeFinish` nudge hook in the agent loop; nothing is wired into the ask path yet (142-06).

## Commits
- 9088e7a feat(142-02): placeGenerateBands and generate-mode helpers
- 98907c8 feat(142-02): agentLoop beforeFinish one-shot nudge hook

## RED records
- Task 1: shared `layout.spec.ts` 7 failed / 7 passed (GENBAND-* failing); server `lib.aiGenerateMode.spec.ts` failed to import (module missing). Green after implementation (14/14, 6/6).
- Task 2: `lib.aiAgentLoop.generate.spec.ts` 4 failed / 2 passed (GENNUDGE-1 and GENNUDGE-4 pass incidentally as no-hook baselines, as expected). Green after the hook; with `lib.aiAgentLoop.spec.ts` and `lib.aiJsonAction.spec.ts` 39/39.

## Deviations from Plan
None - plan executed as written. Both tsc runs (shared, server) clean. GENNUDGE-5 (json-action decorator) passes, so no `it.fails` needed; Open Question 2 is resolved (nudge message shape accepted).

## Notes
- GENNUDGE-1 and GENNUDGE-4 cannot discriminate red/green by themselves (they assert unchanged behaviour); the discriminating proofs are GENNUDGE-2/3/5/6.
- shared `main` is `src/index.ts`, so no rebuild step was needed.

## Self-Check: PASSED
