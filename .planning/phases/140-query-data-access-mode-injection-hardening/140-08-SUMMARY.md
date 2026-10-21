---
phase: 140-query-data-access-mode-injection-hardening
plan: 08
subsystem: ai-tools
tags: [ai, query-tools, registry, abort-signal]
requires: [140-06]
provides: [QUERY_TOOLS, ToolContext.query, ToolContext.signal]
affects: [140-09]
key-files:
  created: [packages/server/src/lib/ai/tools/query.ts, packages/server/tests/lib.aiQueryTools.spec.ts]
  modified: [packages/server/src/lib/ai/tools/types.ts, packages/server/src/lib/ai/agentLoop.ts, packages/server/tests/lib.aiToolsRegistry.spec.ts, packages/server/tests/lib.aiAgentLoop.spec.ts]
decisions:
  - QUERY_TOOLS kept out of READ_TOOLS; registry gate hides them in schema mode (18 vs 20 tools)
metrics:
  completed: 2026-10-21
---

# Phase 140 Plan 08: Query tools and loop abort pass-through Summary

run_query and get_column_profile ship as flat-schema read tools (QUERY_TOOLS) classified rows/values on success and config+isError on failure; agentLoop now passes its combined abort signal (route cancel + answer deadline) to read tools.

## Commits
- b821f08: feat(140-08) query tools, ToolContext.query/signal, QTL-1..6, REG-5a/b
- 3679b1a: feat(140-08) agent loop passes combined abort signal, LOOPQ-1..3

## RED evidence
- Task 1: `vitest run tests/lib.aiQueryTools.spec.ts tests/lib.aiToolsRegistry.spec.ts` -> Test Files 2 failed (2), no tests (module `tools/query` missing).
- Task 2: `vitest run tests/lib.aiAgentLoop.spec.ts -t LOOPQ` -> Tests 3 failed | 24 skipped (observed/ctx.signal undefined).

## Verification
- GREEN: registry, tools, contract, query-tools specs 41/41 (TL-7, REG-1..4 unchanged); agent-loop + dv/structural/filter e2e 52/52; server tsc clean.
- `npx vitest run ai --maxWorkers=4` (DEFAULT_VIEW_TTL_MINUTES=5): 51 files, 606 tests passed.
- read.ts invariant grep (QUERY_TOOLS|runQuery|getColumnProfile) = 0.

## Deviations from Plan
None in code. One execution slip: the first commit attempt failed (zsh did not split a quoted file-list variable); nothing was staged, re-run with explicit paths succeeded.

## Notes
- Criterion `grep -c "\.\.\.toolCtx, signal"` = 1 is meaningful (was 0 pre-change). REG-5/QTL/LOOPQ count criteria were verified 0 beforehand per the plan.
- Test spec counts: the QTL- grep counts test titles (6); LOOPQ- = 3 test titles plus the describe-free body, so count matches.
- 140-09 only needs to build the port per answer, set toolCtx.query, and pass QUERY_TOOLS as extraTools.

## Self-Check: PASSED
