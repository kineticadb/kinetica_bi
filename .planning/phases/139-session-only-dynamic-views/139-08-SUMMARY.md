---
phase: 139-session-only-dynamic-views
plan: 08
subsystem: web
tags: [ai, session-fold, dynamic-view]
requires: [139-01]
provides:
  - SessionDv, SessionDerived.addedDynamicViews/removedDynamicViewIds/layerBinding, SessionBaseline.dynamicViewSources/dynamicViewColumns
  - applySessionToDynamicViews, layerBinding in applySessionToLayers
  - fold of add/remove_dynamic_view with stamped repoint/drop, D-24 rebind, dv-bound add_widget/add_layer
affects: [139-09, 139-11]
key-files:
  created:
    - packages/web/src/lib/aiSession/foldSession.dv.spec.ts
  modified:
    - packages/web/src/lib/aiSession/types.ts
    - packages/web/src/lib/aiSession/constants.ts
    - packages/web/src/lib/aiSession/foldSession.ts
    - packages/web/src/lib/aiSession/applySession.ts
    - packages/web/src/lib/aiSession/changeCounts.ts
    - packages/web/src/lib/aiSession/foldSession.spec.ts
    - packages/web/src/lib/aiSession/applySession.spec.ts
    - packages/web/src/lib/aiSession/changeCounts.spec.ts
key-decisions:
  - "makeSessionWidget honours config.dynamicViewId only when the caller passes a resolved DvBinding; otherwise it is still stripped (keeps FOLD6-2 strip positive control valid)"
  - "Widget unbind uses dynamicViewId: undefined (saved, via widgetMeta) or key deletion (temp); layers use top-level dynamic_view_id null"
requirements-completed: [AIACT-V20-07, AIACT-V20-08]
duration: ~35min
completed: 2026-10-20
---

# Phase 139 Plan 08: Web session fold for AI dynamic views Summary

Op-log fold now represents AI views, their removal plan (repoint/drop applied in the same entry), rebinds and dv-bound widgets/layers, so one Revert restores a removed view and all dependents.

## Commits
- 86b262b: feat(139-08): session fold for AI dynamic views (both tasks in one commit)

## Verification
- Red-first: new foldSession.dv.spec (17 of 18 failing) and rewritten EVAL-2 failed before implementation. APPDV/CNTDV specs were added after the implementation, so they were not run red (tsc would have failed on the missing export).
- web `tsc --noEmit` clean; `src/lib/aiSession` + `src/store` 35 files / 538 tests green (`--maxWorkers=4`); theme-guard 172 green. Full web vitest not run (139-14 owns it, per orchestrator).
- FOLDDV-18 property: 200 sequences, LCG seed 139018, passes. Mutation check (removing the layer repoint) makes it fail with "layer -201 -> 90 (run 15)", so it discriminates.

## Deviations from Plan
1. [Process] Tasks 1 and 2 committed together: foldSession.ts, types and spec files interleave (SessionDerived return type needs both halves to compile), so a task-1-only commit would not pass tsc.
2. [Rule 1] FOLDF-6 (existing spec) asserted AI view -3 filter is `unsupported_target`; updated to `target_not_found` for an unknown id (D-23 lifts the refusal; positive case covered by FOLDDV-6).
3. FOLDDV-6 clear_filter: clear seeds from `currentFilters` only (existing FOLDF-8 contract), so the test passes `currentFilters` rather than relying on a prior apply entry.
4. Non-discriminating criterion noted: `grep -c "dynamic_view_id: null,"` pre-check is fine; but the "FOLDDV-1[0-8] >= 9" grep counts test titles only and cannot show behaviour. Real behaviour verified by the specs and the mutation check above.
5. `unsupported_in_134` left in SkipReason (still used elsewhere); `dynamic_view_rejected` added to the union but not emitted yet.

## Self-Check: PASSED
Files exist (foldSession.dv.spec.ts and the modified files); commit 86b262b present on feat/ai-driven-dashboards.
