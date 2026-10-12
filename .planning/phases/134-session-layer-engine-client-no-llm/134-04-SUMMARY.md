---
phase: 134-session-layer-engine-client-no-llm
plan: 04
subsystem: web/map-read-path
tags: [session-layer, effective-layers, map, legend, info-card, eye-toggle]
requires: [134-03]
provides: [session-aware map/legend/info-card layer reads, temp-layer guard in eye toggle]
key-files:
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/LegendRenderer.tsx
    - packages/web/src/components/charts/InfoCardRenderer.tsx
    - packages/web/src/hooks/useLayerVisibilityToggle.ts
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/components/charts/LegendRenderer.spec.tsx
    - packages/web/src/components/charts/InfoCardRenderer.spec.tsx
    - packages/web/src/hooks/useLayerVisibilityToggle.spec.ts
requirements: [AISES-V20-01]
completed: 2026-10-12
---

# Phase 134 Plan 04: Renderers read effective layers Summary

Map, standalone legend and info card now read `useEffectiveLayers()` (saved layers merged with the AI session add/remove, overlay patches still applied afterwards); the eye toggle returns early for negative (AI temp) layer ids so they can never reach `apiUpdateLayer`.

## Evidence
- Red before wiring (recorded): AIREAD-MAP-1 (expected 1 legend block, got 2), AIREAD-MAP-2 (expected 2, got 1), AIREAD-LEG-1 ([7,8] vs [8]), AIREAD-INFO-1 (options not narrowed). Positive controls in each (saved layers visible before the session turn) passed in the same run. All green after.
- AIREAD-EYE-2 red before the guard (apiUpdateLayer called once for id -2); AIREAD-EYE-1 (saved layer saves under an applied AI turn) green before and after.
- AIREAD-MAP-2 runs inside a DashboardContextProvider, so the source-validity auto-hide is active: the placeholder (table_id 0) appears as a legend row but no new ImageWMS source is constructed.
- tsc clean; MapChartRenderer/LegendRenderer/InfoCardRenderer/useLayerVisibilityToggle/theme-guard specs: 5 files, 421 tests pass. Full suite not run (parallel executors editing DashboardsPage/App).
- buildWmsParams sites and dv dep keys untouched (Phase 139).

## Deviations
1. [Rule 3] The first spec commit command failed (shell var not word-split in zsh) after the renderer edits had been made; the spec commit was redone with explicit paths, so the "red" evidence was captured before the renderer edits but the commit order is still test then feat.
2. [Rule 3] Added a follow-up commit fixing a tsc error in the new eye-toggle spec wrapper (children passed as prop); the guard commit landed before that fix.
3. The map specs mock `dashboardLayersStore` with a non-reactive `_layersState`, so AIREAD-MAP tests use `rerender` after the session turn; the session store itself is the real one.
4. Acceptance note: the plan's pre-check `grep -c "useDashboardLayersStore((s) => s.layers)"` = 0 is fine after; no non-discriminating criteria found. MapChartRenderer no longer imports `useDashboardLayersStore` (only the selector was used).

## Self-Check: PASSED
