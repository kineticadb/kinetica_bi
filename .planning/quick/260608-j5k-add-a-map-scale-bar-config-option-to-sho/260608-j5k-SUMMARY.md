---
phase: quick-260608-j5k
plan: 01
subsystem: map-widget
tags: [map, openlayers, config, controls, scale-bar, fullscreen]
dependency_graph:
  requires: []
  provides: [showScaleBar config field, showFullscreenButton config field, getShowScaleBar getter, getShowFullscreenButton getter, MAP CONTROLS panel section, conditional OL controls at mount]
  affects: [MapWidgetConfig, mapInfoConfig.ts, MapConfigPanel.tsx, MapChartRenderer.tsx]
tech_stack:
  added: []
  patterns: [default-false opt-in getters mirroring getInfoEnabled pattern, config-toggle checkbox with green accent, M-01 lifecycle invariant - controls built once at mount]
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
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - M-01-invariant: controls constructed once in OlMap options at mount time; a config toggle takes effect on the widget's next mount; StrictMode guard and cleanup return left byte-unchanged
  - FullScreen-target: FullScreen control targets containerRef.current (the widget's map container element) so fullscreen fills the dashboard grid cell, not document.body
  - no-new-css: MAP CONTROLS reuses config-toggle class (accent-color: var(--accent) already in global.css ~line 970); zero new CSS added
  - spec-mock-update: WidgetRenderer.spec.tsx mapInfoConfig mock updated to include new getter stubs (auto-fix Rule 1 — missing exports caused test failure when MapChartRenderer called the new getters)
metrics:
  duration: ~15min
  completed: "2026-06-08"
  tasks: 3
  files: 8
---

# Quick Task 260608-j5k: Add Map Scale Bar + Fullscreen Button Config Options Summary

**One-liner:** Opt-in OL ScaleLine + FullScreen controls gated by two new `MapWidgetConfig` boolean fields, wired through default-false getters and green-accent config-toggle checkboxes.

## What Was Built

Two new opt-in map widget controls for dashboard operators:

1. **Scale bar** (`showScaleBar`) — renders an OpenLayers `ScaleLine` control showing the current map scale. Off by default; legacy widgets are byte-identical to before.
2. **Fullscreen button** (`showFullscreenButton`) — renders an OpenLayers `FullScreen` control that expands the map widget to fill the screen. Targets the widget's container element (not `document.body`) so fullscreen fills the dashboard grid cell and OL layout restores correctly on exit. Off by default.

## Files Modified

| File | Change |
|------|--------|
| `packages/web/src/lib/wmsUrlBuilder.ts` | Added `showScaleBar?` and `showFullscreenButton?` optional booleans to `MapWidgetConfig` |
| `packages/web/src/lib/mapInfoConfig.ts` | Added `DEFAULT_SHOW_SCALE_BAR=false`, `DEFAULT_SHOW_FULLSCREEN_BUTTON=false`, `getShowScaleBar`, `getShowFullscreenButton` |
| `packages/web/src/lib/mapInfoConfig.spec.ts` | Added 10 new specs (6 behavior cases per getter) in new describe blocks |
| `packages/web/src/components/charts/MapConfigPanel.tsx` | Imported new getters, derived values, added MAP CONTROLS config-group with two config-toggle checkboxes |
| `packages/web/src/components/charts/MapConfigPanel.spec.tsx` | Added 6 new specs for MAP CONTROLS checkbox rendering and onChange behavior |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | Added ScaleLine/FullScreen/Control imports, read flags from widgetConfig, conditional extraControls array, updated OlMap construction |
| `packages/web/src/components/charts/MapChartRenderer.spec.tsx` | Added ScaleLine/FullScreen vi.mocks, imports, updated mapInfoConfig mock, added 4-test describe block |
| `packages/web/src/components/charts/WidgetRenderer.spec.tsx` | Updated mapInfoConfig mock to include new getter stubs (auto-fix) |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `5fd921a` | Config fields + default-false getters (TDD) |
| 2 | `cf0eb4e` | MapConfigPanel MAP CONTROLS checkboxes (TDD) |
| 3 | `0adec90` | MapChartRenderer conditional ScaleLine + FullScreen (TDD) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WidgetRenderer.spec.tsx mapInfoConfig mock missing new exports**
- **Found during:** Task 3 full suite run
- **Issue:** `WidgetRenderer.spec.tsx` has a manual `vi.mock("../../lib/mapInfoConfig", ...)` that didn't include `getShowScaleBar` / `getShowFullscreenButton`. Vitest's strict mock validation threw: "No 'getShowScaleBar' export is defined on the mock."
- **Fix:** Added `getShowScaleBar: (_cfg) => false` and `getShowFullscreenButton: (_cfg) => false` stubs + corresponding DEFAULT constants to the mock in `WidgetRenderer.spec.tsx`
- **Files modified:** `packages/web/src/components/charts/WidgetRenderer.spec.tsx`
- **Commit:** `0adec90` (included in Task 3 commit)

## Verification

- `npx tsc --noEmit`: clean (zero errors)
- `npx vitest run`: **1685/1685 tests pass** (1665 baseline + 20 new specs)
  - `mapInfoConfig.spec.ts`: 28/28 (18 pre-existing + 10 new)
  - `MapConfigPanel.spec.tsx`: 72/72 (66 pre-existing + 6 new)
  - `MapChartRenderer.spec.tsx`: 174/174 (170 pre-existing + 4 new)
- Zero server changes
- No new npm dependencies (`ol` already present; `ScaleLine` + `FullScreen` + control CSS all ship with existing `ol` package)

## Self-Check: PASSED

All 4 modified source files verified present. All 3 task commits (5fd921a, cf0eb4e, 0adec90) verified in git history.
