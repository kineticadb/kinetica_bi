---
phase: 140-query-data-access-mode-injection-hardening
plan: 05
subsystem: ai
tags: [prompt-injection, untrusted-data, context]
requires: []
provides: [UNTRUSTED_NOTICE, markUntrusted, sanitizeSchemaText, buildQueryRules, buildSystemParts query input]
affects: [140-09]
key-files:
  created: [packages/server/src/lib/ai/untrusted.ts]
  modified: [packages/server/src/lib/ai/tools/read.ts, packages/server/src/lib/ai/context.ts, packages/server/tests/lib.aiTools.spec.ts, packages/server/tests/lib.aiContext.spec.ts]
requirements-completed: [AISAFE-V20-05]
completed: 2026-10-21
---

# Phase 140 Plan 05: Untrusted-data marking Summary

Read tool results (describe_table, list_tables, get_dashboard) are JSON marked `untrusted:true` with a fixed notice; schema text in the system part is flattened and clipped; query-mode rule block and optional `query` system parts added (only when dataAccess=query).

## Commits
- Task 1: feat(140-05) untrusted.ts + read.ts + lib.aiTools.spec.ts
- Task 2: feat(140-05) context.ts + lib.aiContext.spec.ts

## RED (before implementation)
- lib.aiTools.spec.ts: suite failed to load (`Cannot find module '../src/lib/ai/untrusted'`), so TL-3/TL-5/TLQ-1/TLQ-2/UNT-1 could not run (red).
- lib.aiContext.spec.ts: 3 failed: CTXQ-2 (`buildQueryRules is not a function`), CTXQ-3 (a line started with SYSTEM:/ASSISTANT:), CTXQ-4 (rules lacked "tool results"). CTXQ-1 passed pre-change, as expected: schema mode ignoring an unknown `query` field is trivially true until the field exists; it guards the post-change behaviour.

## GREEN
lib.aiTools 25/25; lib.aiContext + aiTools + aiOutbound 51/51; wider set `tests/lib.ai*.spec.ts tests/routes.aiAsk.*.spec.ts tests/routes.aiEgress.spec.ts`: 42 files, 486 tests passed, no other spec reddened. server `tsc --noEmit` clean.

## Spec assertion changes
Only TL-3 and TL-5 in lib.aiTools.spec.ts, exactly per plan. CTX-1..4 untouched.

## Deviations
- Wrote the U+2028/2029 chars as `  ` escapes in untrusted.ts (literal chars in the plan snippet broke the regex literal and failed to parse). Same behaviour.
- CTXQ tests define their own local `tables`/`view` (the existing ones are scoped inside another describe).
- Acceptance note: `grep -c "TLQ-"` etc. were verified absent beforehand; `sanitizeSchemaText` count in context.ts is 2 (import + one use via local `clean` helper), meeting >=2.

## Self-Check: PASSED
