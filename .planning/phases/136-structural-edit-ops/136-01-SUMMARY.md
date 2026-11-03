---
phase: 136-structural-edit-ops
plan: 01
subsystem: shared-contract
tags: [ai, allow-list, layout, catalogue, zod]
requires: []
provides:
  - allow-list v4 keyed by real widget types (bar, line, pie, table, bignumber, records, map)
  - layout.ts grid math (placeWidget, validateLayout, resolveRect, AI_DEFAULT_SIZE)
  - aiCatalog.ts positive config catalogue, heatmap ramps/patch validator, map host resolution
  - 12 AI op kinds; heatmap add_layer payload; ask approvals flag; AiClarificationSchema
affects: [136-02..136-12]
key-files:
  created: [packages/shared/src/layout.ts, packages/shared/src/layout.spec.ts, packages/shared/src/aiCatalog.ts, packages/shared/src/aiCatalog.spec.ts]
  modified: [packages/shared/src/actionAllowList.ts, packages/shared/src/aiOp.ts, packages/shared/src/aiAsk.ts, packages/shared/src/index.ts, packages/server/src/lib/ai/shadow.ts, packages/web/src/lib/aiSession/foldSession.ts, packages/web/src/lib/radioGroupCapture.ts]
decisions:
  - "add_layer column fields are optional in the zod object; per-spatialMode requirement is enforced in parseAiOp (discriminatedUnion members cannot use superRefine)"
  - "placeWidget reports below:false for an empty dashboard"
metrics:
  tasks: 3
  completed: 2026-10-13
---

# Phase 136 Plan 01: Shared structural-edit contract Summary

Allow-list v4 re-keyed to real widget types, plus new shared grid-layout math, a positive AI config catalogue, and 12-op contract with heatmap add_layer.

## Commits
- eb18cb9 feat(136-01): allow-list v4 keyed by real widget types
- 2f3c607 feat(136-01): shared grid layout math and AI config catalogue
- 26034c5 feat(136-01): extend AI op contract

## Verification
- shared: tsc clean, vitest 144/144.
- server: tsc clean; test-gate run reported routes.dashboard-export.spec.ts failing alone (INCL-envelope, 5000ms timeout while the parallel executor and gate were loading the machine); rerun alone: 38/38 pass. Other 4 off-list files passed in isolation (TD-V16-TEST-ISOLATION).
- web: tsc clean; full vitest 4555 passed (an earlier run had 1 WidgetRenderer.line.spec failure that passed in isolation = known fake-timer flake); theme-guard green.

## Red/green and mutation proofs
- Task 1: the "dead chart key invalid" case is green now; I wrote spec and implementation in the same pass and did not capture a separate red run (honest deviation from strict TDD order). Under v3 `chart` was valid, so the case cannot have passed before.
- Mutation: adding `sql` to catalogue fields fails CAT-2 (sql); `rectsOverlap` `<=` fails LAYOUT-3/4/5/6; adding `sql` to add_widget fails AIOP-6 and AIOP6-7. All reverted.

## Deviations
- [Rule 3] New files had to be `git add`ed before pathspec commit (untracked pathspec error); no scope impact.
- CAT-2 `__proto__` case: spreading JSON.parse output keeps `__proto__` as own key, so the test passes the parsed object directly.
- lib.aiContract.spec AIC-4 title and count updated (planned).

## Non-discriminating criteria
- Task 1 regression-guard greps (hex count 0) and Task 2 hex grep are 0 before and after by design; CAT-4 colour fuzz is the real proof.

## Self-Check: PASSED
Files and commits eb18cb9, 2f3c607, 26034c5 verified present.
