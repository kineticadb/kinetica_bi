---
phase: 140-query-data-access-mode-injection-hardening
plan: 03
subsystem: ai-ask
tags: [shared-schema, sse, chat-state, dev-harness]
requires: []
provides:
  - AskQueryEntrySchema / AskQueryEntry / AI_QUERY_LIST_MAX in shared aiAsk.ts
  - optional AskResultEventSchema.queries
  - TurnChat.queries (display only), populated by askRunner.applyResult and DEV chatTurn
affects: [140-07, 140-09, 140-13]
key-files:
  modified:
    - packages/shared/src/aiAsk.ts
    - packages/shared/src/aiAsk.spec.ts
    - packages/web/src/lib/aiSession/types.ts
    - packages/web/src/lib/aiSession/askRunner.ts
    - packages/web/src/lib/aiSession/askRunner.spec.ts
    - packages/web/src/lib/aiSession/devHarness.ts
    - packages/web/src/lib/aiSession/devHarness.spec.ts
decisions:
  - "queries is optional on the strict result schema; schema-mode payloads unchanged"
  - "buildAskRequest.ts untouched (0 'queries' occurrences); ASKRQ-3 proves display-only"
metrics:
  tasks: 2
  files: 7
completed: 2026-10-21
---

# Phase 140 Plan 03: Query list contract and client plumbing Summary

Optional, strict, value-free `queries` list on the SSE result event, carried into `TurnChat` by the ask runner and settable from the DEV harness; never sent back to the provider.

## Commits
- 5a7ea51: shared schema + spec (Task 1)
- d8ecec3: web types/askRunner/devHarness + specs (Task 2)

## RED evidence
- Shared (`vitest run src/aiAsk.spec.ts`) before implementation: ASKQ-2 and ASKQ-3 failed (2 failed, 17 passed). ASKQ-1 passed pre-implementation by design: it is the backward-compat guard (result without `queries` stays valid) and cannot discriminate before the work.
- Web before implementation: ASKRQ-1 and HARNQ-1 failed (`expected undefined to deeply equal [...]`); 2 failed, 42 passed. ASKRQ-2 (no key when absent) and ASKRQ-3 (SQL marker absent from the follow-up request body) also pass pre-implementation because they are invariants; they guard against regression rather than prove new behaviour.

## Verification (GREEN)
- shared: `tsc --noEmit` clean; full shared vitest 9 files / 192 tests pass.
- web: `tsc --noEmit` clean; askRunner + devHarness + buildAskRequest specs 60/60 pass (`--maxWorkers=4`).

## Deviations from Plan
- The plan's ASKQ spec location: the `res()` helper in aiAsk.spec.ts is scoped to another describe, so the new tests define a local `res()` at the end of the file. No behavioural impact.
- Acceptance note: `grep -c "ASKQ-"` after = 3 as expected; the grep for `queries` in devHarness.ts >= 3 holds.

## Self-Check: PASSED
