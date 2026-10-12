---
phase: 134-session-layer-engine-client-no-llm
plan: 01
subsystem: web/store
tags: [zustand, widgetActionStore, D-11, recency]
requires: []
provides: [recency-ordered deriveOverlays, widgetActionStore.order]
affects: [134-03 AI source (controlId 0), RadioGroup precedence]
key-files:
  modified:
    - packages/web/src/store/widgetActionStore.ts
    - packages/web/src/store/widgetActionStore.spec.ts
decisions:
  - "Per-control monotonic sequence (module-level contributionSeq, never reset) + state.order; deriveOverlays sorts controls by order"
requirements: [AISES-V20-02]
completed: 2026-10-12
---

# Phase 134 Plan 01: Recency ordering in widgetActionStore Summary

`deriveOverlays` now sorts controls by a per-control monotonic write sequence, so the most recent explicit action wins per field (D-11), enabling the AI source (controlId 0) and radios to coexist.

## Commits
- 59a5e63 test(134-01): failing D11- specs
- 7c9e950 feat(134-01): recency ordering

## RED run (against unmodified store)
Red: D11-1, D11-4, D11-5, D11-6, D11-7. Green: D11-2, D11-3 (as predicted; D11-5 and D11-7 were red too). D11-7 also asserts `order` (undefined pre-change), so part of its red is the missing field; its behavioural half (9 then 3 -> 3) was independently red.

## Behaviour change (intentional)
Radio-vs-radio conflicts on the same field: "higher control id wins" -> "most recently selected wins". No pre-existing spec pinned the old id order, so no existing assertion was changed or weakened.

## Verification
- `tsc --noEmit` clean.
- widgetActionStore, applyWidgetAction, RadioGroupRenderer, RadioGroupConfigPanel, actionEngineDecoupling: 173/173 pass.
- Also passed: DashboardsPage, WidgetRenderer, LegendRenderer, actionEngine.canary, MapChartRenderer, useLayerVisibilityToggle, radioGroupLayerPatch (477/477). Full suite not run.

## Notes
- `releaseLayerConfigField` keeps `order` and strips the field from the AI source too; the next AI rebuild re-pins it (documented in the store).
- Criterion note: D11-7 cannot distinguish "order cleared on reset" from "stale order harmless" via behaviour alone, since the sequence is global and monotonic; the added `order` toEqual assertion covers the cleared state directly.

## Deviations
None.

## Self-Check: PASSED
