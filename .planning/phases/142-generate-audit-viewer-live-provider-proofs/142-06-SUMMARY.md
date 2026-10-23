---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 06
subsystem: ai
tags: [generate-mode, ask-route, audit]
requires: [142-01, 142-02]
provides:
  - ai_audit.kind written on running, refusal and keep rows (ask | generate | keep)
  - runAnswer generate mode (limits, recipe part, nudge, 4-widget minimum, band layout)
  - server-derived generate flag in POST /api/ai/ask
key-files:
  modified:
    - packages/server/src/lib/aiAudit.ts
    - packages/server/src/lib/ai/runAnswer.ts
    - packages/server/src/aiRoutes.ts
    - packages/server/tests/lib.aiAudit.spec.ts
  created:
    - packages/server/tests/routes.aiAsk.generate.spec.ts
requirements-completed: [AIGEN-V20-01, AIGOV-V20-05]
completed: 2026-10-23
gaps: []
---

# Phase 142 Plan 06: Generate mode on the ask path Summary

Generate mode is derived on the server (pending dashboard, saved widgets only `ai`, snapshot widgets only `ai`), raises tool steps to >= 20 and caps new widgets at 8, appends the recipe, nudges once, fails with `generate_too_few` under 4 data widgets, and rewrites ops to the server band layout; every ai_audit row records its kind.

## Commits
- 472b469: audit kind (Task 1)
- Task 2 commit: generate mode (runAnswer.ts, aiRoutes.ts, generate spec)

## RED records
- Task 1: AUDKIND-1..4 failed 4/4 before implementation; green after (54 tests across aiAudit, aiCaps, routes.aiAsk.audit, routes.aiKeep).
- Task 2: before implementation GENASK-1, 5, 6, 7 failed; GENASK-2, 3, 4, 8, 9, 10 passed (see non-discriminating list). After: 10/10, plus sse, structural, audit, deadline, preflight, aiQuery, aiAudit suites: 8 files / 70 tests green. `npx tsc --noEmit` clean.

## Non-discriminating criteria (reported, code not bent)
- GENASK-2, 3, 4 assert unchanged normal-mode behaviour, so they pass pre-implementation by design; the discriminating proofs are GENASK-1, 5, 6, 7.
- GENASK-8 (set_layout dropped) passed pre-implementation: the gateway already did not emit a set_layout op for that script. The band rewrite's own set_layout removal is covered by 142-02 unit tests (`applyGenerateBands`), not proven discriminating on the route.
- GENASK-9 (AI_MAX_TOOL_STEPS=30) passes pre-implementation, as generate limits only raise to max(config, 20); it guards against clamping down. GENASK-10 (`get_column_profile` in the system text) also passes pre-implementation because the base query-mode prompt already names that tool; the recipe-specific line is not isolated by it.

## Deviations from Plan
- [Rule 1 - test fixture] GENASK-1 first failed with 4 ops because my `records` add_widget args carried metric/aggregation/groupBy, which the allow-list rejects for records. Fixed the fixture, not the code.
- Default `maxNewWidgets` in this deployment is 6, so GENASK-1 (5 widgets) only proved the cap raise to 8 after implementation.

## Self-Check: PASSED
