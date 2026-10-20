---
phase: 139-session-only-dynamic-views
plan: 01
subsystem: shared
tags: [zod, ai, dynamic-view, contract]
requires: []
provides:
  - AiDvSpecSchema / checkAiDvSpec / aiDvOutputNames / aiDvIsAggregated
  - AiDvMaterializeRequestSchema / AiDvDropRequestSchema / AiDvMaterializeResponse
  - add_dynamic_view / remove_dynamic_view / add_layer.dynamicViewId ops
  - AI_COLUMN_BINDING_KEYS, aiWidgetColumnRefs, aiLayerColumnRefs, planDvDependents
affects: [139-02..139-14]
tech-stack:
  added: []
  patterns: [strict zod, value-free reasons]
key-files:
  created:
    - packages/shared/src/aiDynamicView.ts
    - packages/shared/src/aiDynamicView.spec.ts
    - packages/shared/src/aiColumnRefs.ts
    - packages/shared/src/aiColumnRefs.spec.ts
  modified:
    - packages/shared/src/aiOp.ts
    - packages/shared/src/aiOp.spec.ts
    - packages/shared/src/aiCatalog.ts
    - packages/shared/src/aiCatalog.spec.ts
    - packages/shared/src/aiAsk.ts
    - packages/shared/src/aiAsk.spec.ts
    - packages/shared/src/index.ts
key-decisions:
  - "No SQL-bearing field exists in spec, ops or request schemas (AISAFE-V20-04)"
  - "ALLOW_LIST_VERSION left at v4"
requirements-completed: [AISAFE-V20-04, AIACT-V20-07, AIACT-V20-08]
duration: ~15min
completed: 2026-10-20
---

# Phase 139 Plan 01: Shared dynamic-view contract Summary

Strict zod structured dynamic-view spec (no SQL field), extended ops, value-free snapshot additions and a shared D-17 dependents planner.

## Tasks and commits
1. aiDynamicView.ts + DVSPEC-1..12: bb9c338
2. Ops, dynamicViewId carve-out, snapshot extensions (DVOP-1..6, CATDV-1..3, SNAPDV-1..4): see git log "feat(139-01): dynamic-view ops..."
3. aiColumnRefs.ts + REFS-1..6: see git log "feat(139-01): shared column refs..."

## Verification
- Red-first confirmed: Task 1 spec failed (module missing); Task 2 had 10 failing tests before implementation.
- Full shared gate: tsc clean; vitest 9 files / 189 tests pass.
- Acceptance greps: SQL-key grep = 0; `spec: AiDvSpecSchema` = 1; `checkAiDvSpec(op.spec)` = 1; ALLOW_LIST_VERSION = "v4" unchanged.

## Deviations from Plan
- Non-discriminating criterion: Task 2 pre-check `grep -c "structured spec added in Phase 139" aiOp.ts` was 1 before and 0 after (fine, it does discriminate). No other issues.
- Task 1 commit pathspec first attempt failed on a shell quoting error (no commit made); retried with explicit paths. No code impact.
- Known transient (owned by 139-08): web foldSession.spec EVAL-2 now fails with invalid_op because add_dynamic_view requires name + spec. Not run here.

## Self-Check: PASSED
All created files exist; three commits present on feat/ai-driven-dashboards.
