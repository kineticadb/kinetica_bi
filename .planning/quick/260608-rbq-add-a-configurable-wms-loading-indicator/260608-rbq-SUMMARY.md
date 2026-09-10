---
phase: quick-260608-rbq
plan: 01
subsystem: map-chart-renderer
tags: [loading-indicator, imageloadstart, wms, config-panel, tdd]
dependency_graph:
  requires: [quick-260608-j5k]
  provides: [showLoadingIndicator-field, getShowLoadingIndicator, widget-map-loading-badge]
  affects: [MapChartRenderer, MapConfigPanel, mapInfoConfig, wmsUrlBuilder, global.css]
tech_stack:
  added: []
  patterns: [per-layer-ref-tracking, queueMicrotask-defer, mountedRef-guard, cleanup-closure]
key_files:
  created: []
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/mapInfoConfig.ts
    - packages/web/src/lib/mapInfoConfig.spec.ts
    - packages/web/src/components/charts/MapConfigPanel.tsx
    - packages/web/src/components/charts/MapConfigPanel.spec.tsx
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/styles/global.css
decisions:
  - "Default TRUE for showLoadingIndicator (opt-out not opt-in) — mirrors getInfoEnabled pattern; legacy widgets get the indicator ON without migration"
  - "Badge uses existing .widget-filtering-spinner (no new animation); .widget-map-loading-badge CSS uses theme tokens only for light-mode safety"
  - "recomputeLoading() defined per-closure-scope so it captures layer.id implicitly but reads loadingByLayerRef.current (shared ref) correctly"
  - "Cleanup closure guards recomputeLoading() with mountedRef.current check to avoid post-unmount setState warning on unmount path"
  - "allImageWmsInstances.length = 0 added to new test describe beforeEach to avoid stale source references across describe blocks"
metrics:
  duration: 8min
  completed: 2026-06-08
  tasks: 3
  files: 8
  test_baseline: 1688
  test_final: 1700
  tests_added: 12
---

# Phase quick-260608-rbq Plan 01: Add Configurable WMS Loading Indicator Summary

**One-liner:** Per-layer loadingByLayerRef tracker wired through imageloadstart/imageloadend/imageloaderror with mandatory queueMicrotask defer, driving a top-center `.widget-map-loading-badge` React overlay controlled by a default-ON `showLoadingIndicator` config field and MAP CONTROLS checkbox.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | getShowLoadingIndicator default-true spec | 7aac37c | mapInfoConfig.spec.ts |
| 1 GREEN | showLoadingIndicator field + default-true getter | 7729107 | wmsUrlBuilder.ts, mapInfoConfig.ts |
| 2 RED | MapConfigPanel loading-indicator checkbox spec | 19e89e3 | MapConfigPanel.spec.tsx |
| 2 GREEN | MAP CONTROLS loading-indicator checkbox (default on) | 85f433f | MapConfigPanel.tsx |
| 3 RED | renderer loading-indicator specs | 5e457f1 | MapChartRenderer.spec.tsx |
| 3 GREEN | imageloadstart tracker + top-center badge | 1059c88 | MapChartRenderer.tsx, MapChartRenderer.spec.tsx, global.css |

## Verification

- `cd packages/web && npx tsc --noEmit` — clean (no new type errors)
- `cd packages/web && npx vitest run` — **1700/1700 passed** (baseline 1688; +12 new tests)
- All 4 lifecycle invariants preserved:
  1. `handleTileLoadStart` has `if (!mountedRef.current) return;` guard
  2. `queueMicrotask` defer with re-check inside (setState never synchronous on image events)
  3. Cleanup closure: `source.un("imageloadstart")` + `loadingByLayerRef.current.delete(layer.id)` + guarded `recomputeLoading()`
  4. Effect 1 unmount: `loadingByLayerRef.current.clear()`

## Deviations from Plan

**1. [Rule 2 - Missing] Added getShowLoadingIndicator to mapInfoConfig mock in MapChartRenderer.spec.tsx**
- **Found during:** Task 3 GREEN
- **Issue:** mapInfoConfig is vi.mock'd in MapChartRenderer.spec.tsx with an explicit allowlist of getters; the new `getShowLoadingIndicator` was not in the mock, causing "No export defined" error at test runtime
- **Fix:** Added `getShowLoadingIndicator: (cfg: any) => cfg?.showLoadingIndicator ?? true` and `DEFAULT_SHOW_LOADING_INDICATOR: true` to the existing mock object
- **Files modified:** packages/web/src/components/charts/MapChartRenderer.spec.tsx

**2. [Rule 2 - Missing] Added allImageWmsInstances reset to new test describe's beforeEach**
- **Found during:** Task 3 GREEN (4th test case)
- **Issue:** The leak test used `allImageWmsInstances[0]` but the array accumulated instances from all preceding describe blocks; the beforeEach didn't reset it, causing source.un assertions against a stale instance
- **Fix:** Added `allImageWmsInstances.length = 0;` to the new describe's beforeEach, mirroring the existing pattern at line 738
- **Files modified:** packages/web/src/components/charts/MapChartRenderer.spec.tsx

## Self-Check: PASSED

All files present, all content verified, all commits found. 1700/1700 tests green. tsc clean.
