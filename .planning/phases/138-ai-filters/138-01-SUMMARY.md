---
phase: 138-ai-filters
plan: 01
subsystem: shared-contract
tags: [ai, filters, zod, shared]
requires: []
provides: [aiFilter contract, source-keyed apply_filter/clear_filter, coerceAiFilterItem]
affects: [138-02, 138-03, 138-04]
key-files:
  created:
    - packages/shared/src/aiFilter.ts
    - packages/shared/src/aiFilter.spec.ts
  modified:
    - packages/shared/src/aiOp.ts
    - packages/shared/src/aiOp.spec.ts
    - packages/shared/src/aiAsk.ts
    - packages/shared/src/aiAsk.spec.ts
    - packages/shared/src/index.ts
    - packages/server/src/lib/ai/shadow.ts
    - packages/web/src/lib/aiSession/foldSession.spec.ts
requirements-completed: [AIACT-V20-09 (contract part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 01: Source-keyed AI filter contract Summary

Source-keyed `apply_filter`/`clear_filter` ops in the shared zod contract, plus one pure `coerceAiFilterItem` (value-free failure reasons) for server gateway, web fold and the dev harness.

## Commits
- 2cdaa14: aiFilter.ts + spec + index export (Task 1)
- 4d9b65b: aiOp/aiAsk payloads, shadow labels, fold spec fixture (Task 2)

## Red-first evidence
- aiFilter.spec.ts failed to load (module absent) before implementation, then 8/8 passed.
- AF1-9, AF1-10, AF1-11 failed (3 failed, 28 passed) before the aiOp/aiAsk change, then all green.

## Verification
- shared: tsc clean, vitest 7 files / 158 tests pass.
- server: tsc clean. web: tsc clean; foldSession.spec + actionEngineDecoupling.spec pass (88 tests).
- AIOP-8 unchanged and green (12 kinds). Banned decoupling strings: 0 in aiOp.ts and aiFilter.ts.
- Snapshot filters cap raised to 300; `value` key still rejected.

## Deviations from Plan
- Task 1 was committed on its own (the plan listed a single combined commit) to honour per-task commits.
- Shell note: zsh does not word-split path variables, so paths were passed explicitly.
- Non-discriminating criteria: none found. The plan's pre-checks held (old placeholders present, new symbols absent); the old shadow labels have no other references in server/web src.

## Self-Check: PASSED
Files and both commits verified present.
