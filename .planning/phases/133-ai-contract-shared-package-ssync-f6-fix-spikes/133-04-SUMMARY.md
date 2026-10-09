---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 04
subsystem: shared-contract
tags: [shared-package, zod, ai-op, allow-list]
requires: []
provides:
  - "@kinetica-bi/shared workspace package (TS source, no build)"
  - "AiOpSchema / parseAiOp / AI_OP_KINDS, AI_BLOCKED_CONFIG_KEYS, ALLOW_LIST_VERSION v3"
affects: [133-05, 134, 135, 141]
tech-stack:
  added: ["@kinetica-bi/shared"]
  patterns: ["re-export shims in web keep importers unchanged", "single barrel (server moduleResolution Node)"]
key-files:
  created:
    - packages/shared/package.json
    - packages/shared/tsconfig.json
    - packages/shared/vitest.config.ts
    - packages/shared/src/index.ts
    - packages/shared/src/aiOp.ts
    - packages/shared/src/aiOp.spec.ts
  modified:
    - packages/shared/src/widgetAction.ts (git mv)
    - packages/shared/src/actionAllowList.ts (git mv)
    - packages/web/src/lib/widgetAction.ts (shim)
    - packages/web/src/lib/actionAllowList.ts (shim)
    - packages/web/src/lib/actionEngineDecoupling.spec.ts
    - packages/web/docs/mcp-action-seam.md
    - packages/web/package.json
    - package-lock.json
decisions:
  - "Web engine WidgetActionTargetSchema stays positive-only; AI path uses AiActionTargetSchema"
metrics:
  tasks: 2
requirements-completed: []
---

# Phase 133 Plan 04: Shared package and AiOp contract Summary

packages/shared (zod-only TS source) now owns the v1.11 action contract plus a strict 9-kind AiOp union; allow-list is v3 with customWhere AI-blocked; web consumes everything via re-export shims.

## Commits
- 38dbef1: Task 1 scaffold, shims, decoupling spec, lockfile
- 4bccd61: Task 2 AiOp, v3, AI_BLOCKED_CONFIG_KEYS, seam doc
- Note: the `git mv` renames (4 files, 100% similarity) were swept into plan 133-01's commit 9482625 via the shared git index; history is intact (`git log --follow` works).

## Verification
- shared: tsc clean, vitest 75/75. web: tsc clean, vitest 4385 passed / 1 skipped, theme-guard 158/158, `vite build` succeeds (Task 1).
- Discrimination probe: removing `.strict()` from add_widget turned AIOP-6 red; widening AiTempIdSchema to `.int()` turned AIOP-5 (and AIOP-10) red; reverted, all green.

## Deviations from Plan
None in code. Observations: the Task 1 criterion `git log --follow ... | wc -l >= 2` holds. Doc heading text now carries the shim paths inline in the seam doc's path list.

## Self-Check: PASSED
Files verified present; commits 38dbef1 and 4bccd61 exist.
