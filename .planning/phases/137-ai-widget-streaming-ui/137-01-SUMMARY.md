---
phase: 137-ai-widget-streaming-ui
plan: 01
subsystem: server/ai
tags: [ai, gateway, agent-loop, rbac]
requires: []
provides:
  - "shape-key repair: a later success clears a slotless shape failure"
  - "gateway refuses ops targeting the AI Assistant widget (type ai)"
  - "server-side ai:use guard on adding/retyping to an AI widget"
affects: [137-02..12]
key-files:
  modified:
    - packages/server/src/lib/ai/agentLoop.ts
    - packages/server/src/lib/ai/gateway.ts
    - packages/server/src/lib/ai/context.ts
    - packages/server/src/index.ts
    - packages/server/tests/lib.aiAgentLoop.spec.ts
    - packages/server/tests/lib.aiGateway.spec.ts
    - packages/server/tests/routes.aiAsk.sse.spec.ts
  created:
    - packages/server/tests/routes.aiWidgetCreate.spec.ts
decisions:
  - "No new permission: ai:use reused (no RBAC catalogue ripple)"
requirements-completed: [AIGOV-V20-01, AIWID-V20-07]
completed: 2026-10-14
---

# Phase 137 Plan 01: Shape-key fix, AI widget lock, ai:use create guard

Repaired shape failures are no longer reported as skipped, the AI cannot touch the AI Assistant widget, and the server refuses to add or retype to an `ai` widget without `ai:use`.

## Commits
- 7bc35e5 fix: shape-key clear (agentLoop), W2-5/W2-6, SSE-R2 expectation
- a326000 feat: gateway AI-widget refusal + system rule + GW7 specs
- 2b0546b, 9931666 test: GW7-1 corrections (see deviations)
- 83f5740 feat: ai:use guard on widget POST/PATCH + WCG specs

## Red runs (before the fix)
- W2-5: `expected [ { label: 'add_widget', ... } ] to deeply equal []` (skipped held the shape entry).
- W2-6: `expected 'tempId: Invalid input...  Do not retry this; tell the user it was skipped...' not to contain 'Do not retry'`.
- GW7-1..3: `expected { ok: true, op: ... } to match object { ok: false, stage: 'reference' }` (GW7-2 and GW7-3 failed; GW7-1 failed at stage allow_list, see below). GW7-4 (placement avoids the AI widget) already passed: it is a guard.
- WCG-1: `expected 201 to be 403`; WCG-4: `expected 200 to be 403`. WCG-2/3 passed before (controls).

## Deviations
1. **[Rule 1 - spec correctness] GW7-1 stage.** Patches on an `ai` widget are already refused at `allow_list` (no allow-list keys exist for type ai), before the reference stage. GW7-1 now asserts refusal (`ok:false`) with a positive control on a map widget; the reference-stage lock is defense in depth for remove/change_type/set_title/set_layout (GW7-2/3 assert stage `reference`). Two intermediate commits (a326000 had a failing GW7-1 because of a shell-quoting slip; 2b0546b did not fully fix it) are corrected by 9931666.
2. SSE-R2 expected stages changed to `["allow_list","live_schema","reference"]` deliberately (call (e) repairs (a)).

## Notes
- Accepted residual: dashboard import can carry `ai` widgets; a viewer without ai:use sees only the read-only notice.
- `AI_WIDGET_TYPES` stays without "ai"; `grep -c '"ai"' packages/shared/src/aiAsk.ts` = 0.
- No lib.aiContext.spec.ts change was needed.
- Gates: `tsc --noEmit` clean; `node scripts/test-gate.mjs` PASSED (only known list + lib.exportRunner.memory.spec.ts contamination, passes alone).
- No STATE/ROADMAP/REQUIREMENTS/PROJECT edits.

## Self-Check: PASSED
Files and commits 7bc35e5, a326000, 2b0546b, 9931666, 83f5740 exist in git log.
