---
phase: 62-server-materialize-from-dv-view
plan: 01
subsystem: server-view-naming
tags: [server, view-naming, dynamic-view, filter-materialize, tdd, pure-module]
requires: []
provides:
  - "buildFilterViewName optional dynamicViewId param -> _kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>"
  - "FilterViewNameArgs.dynamicViewId field (tableId now optional)"
  - "runtime guard: both tableId+dynamicViewId undefined throws"
affects:
  - "packages/server/src/index.ts (Plan 62-02 dv-path route handler will pass dynamicViewId)"
tech-stack:
  added: []
  patterns:
    - "pure-module TDD (RED then GREEN), exact-string .toBe assertions"
    - "additive optional param, byte-identical back-compat regression lock"
    - "runtime guard for params tsc can no longer enforce (both-optional)"
key-files:
  created: []
  modified:
    - packages/server/src/lib/viewNaming.ts
    - packages/server/tests/lib.viewNaming.spec.ts
decisions:
  - "Segment-swap (_t<id> -> _dv<id>) chosen over a separate builder — keeps one composer, byte-identical table path"
  - "Runtime guard throws (not a fallback) when neither id supplied — prevents silent _tundefined view names"
metrics:
  duration: ~2min
  tasks: 2
  files: 2
  completed: 2026-06-15
requirements: [DVDRILL-V112-03]
---

# Phase 62 Plan 01: buildFilterViewName dynamicViewId Segment Summary

Extended the pure view-name composer `buildFilterViewName` with an optional `dynamicViewId` that swaps the `_t<tableId>` segment for `_dv<dynamicViewId>`, yielding a dv-filter view name (`_kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>`) distinct from both the table-filter view and the dv's own materialized view — locked via TDD with a byte-unchanged table-path regression test and a runtime guard.

## What Was Built

- **`FilterViewNameArgs`**: added `dynamicViewId?: number`; made `tableId?: number` (the dv path supplies dynamicViewId instead of tableId). Doc-comment notes the `_dv<id>` shape and that exactly one of the two ids is required.
- **`buildFilterViewName`**: runtime guard throws `"buildFilterViewName: tableId or dynamicViewId required"` when both are undefined; otherwise composes `_kbi_filt_u<u>_d<dash>_<segment>_s<s>` where `segment = dv<dynamicViewId>` (when present) else `t<tableId>` — byte-identical to the prior output on the table path.
- **Tests** (`tests/lib.viewNaming.spec.ts`): new `describe` block with 5 cases — dv-segment exact string, table-path regression lock, distinctness from `_t<id>` + the `_kbi_dv_..._<id>` dv view (imported `buildDynamicViewName`), OIDC username sanitization on the dv path, and the both-undefined guard `.toThrow`.

## Verification

- `cd packages/server && npx vitest run tests/lib.viewNaming.spec.ts` → 19/19 passed (RED confirmed at 16 passed / 3 failed before GREEN).
- `cd packages/server && npx tsc --noEmit -p tsconfig.json` → exit 0.
- `git diff --name-only -- packages/web` → EMPTY (server-only phase, asserted).
- `grep "dynamicViewId" packages/server/src/lib/viewNaming.ts` → matches the field + the branch.

## Deviations from Plan

None - plan executed exactly as written. (RED showed runtime failures rather than a tsc error because vitest transpiles via esbuild without type-checking; the three new dv cases failed at runtime as the plan anticipated, confirming RED.)

## Decisions Made

- Single-composer segment swap (not a new `buildDvFilterViewName`) keeps the table path byte-identical and the module pure.
- The both-undefined case throws rather than defaulting, so a 62-02 caller that forgets the dv id fails loud instead of materializing a `_tundefined` view.

## Follow-ups / Notes for 62-02

- The route handler (Plan 62-02) calls `buildFilterViewName({ ..., dynamicViewId })` on the dv path; the dv FROM source remains `buildDynamicViewName(...)`. Empty-filters / spatial-on-dv rejection + dv-row scoping live in 62-02, not here.

## Self-Check: PASSED

- FOUND: packages/server/src/lib/viewNaming.ts
- FOUND: packages/server/tests/lib.viewNaming.spec.ts
- FOUND: .planning/phases/62-server-materialize-from-dv-view/62-01-SUMMARY.md
- FOUND commit: d0414dc (test RED)
- FOUND commit: bd9bef5 (feat GREEN)
