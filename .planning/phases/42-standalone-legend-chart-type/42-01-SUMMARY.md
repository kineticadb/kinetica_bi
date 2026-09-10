---
phase: "42"
plan: "01"
subsystem: frontend-legend-foundation
tags: [refactor, foundation, prop-threading, tdd, zero-behavior-change]
dependency_graph:
  requires:
    - Phase 41 (LayersLegendPanel + MapChartRenderer in-map overlay)
    - Phase 35 (WidgetDto type in client.ts)
  provides:
    - lib/resolveLegendLayers.ts (shared layer-derivation helper)
    - LayersLegendPanel showChevron prop (non-collapsible mode)
    - ConfigPanelProps.widgets field (dashboard widget list threading)
    - WidgetRenderer.onConfigureWidget callback (config modal request)
  affects:
    - Phase 42 Plan 42-02 (LegendRenderer + LegendConfigPanel — fully unblocked)
tech_stack:
  added: []
  patterns:
    - 2nd-consumer extraction (same as Phase 40 lib/trackConfig.ts precedent)
    - Back-compat re-export pattern (export type { X } from + local import type { X })
    - void no-op pattern for noUnusedLocals (onConfigureWidget void-tag)
    - Required prop at WidgetConfigModal boundary (mirrors Phase 30 widgets-required lock)
key_files:
  created:
    - kinetica_bi/src/lib/resolveLegendLayers.ts
    - kinetica_bi/src/lib/resolveLegendLayers.spec.ts
  modified:
    - kinetica_bi/src/components/LayersLegendPanel.tsx
    - kinetica_bi/src/components/LayersLegendPanel.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/registry.ts
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
    - kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx
decisions:
  - "ResolvedLegendLayer local import required alongside re-export: export type { X } from ... re-export alone does NOT bring name into local scope in TypeScript (Phase 30 note confirmed at Layer 41 boundary)"
  - "LayersLegendPanel.tsx imports DashboardLayerDto removed: after extracting inline type to lib, only comment references remain — import safely dropped"
  - "WidgetConfigModal.widgets is REQUIRED (not optional): DashboardsPage always has widgets state; required prop makes missing-context errors loud (mirrors Phase 30 DashboardContextProvider.widgets lock)"
  - "void onConfigureWidget no-op pattern: prevents noUnusedLocals tsc/eslint flag before Plan 42-02 LegendRenderer consumer ships"
metrics:
  duration: "~6 minutes (362 seconds)"
  completed: "2026-05-22"
  tasks_completed: 3
  files_modified: 8
  files_created: 2
---

# Phase 42 Plan 01: Foundation Helper and Threading Summary

Laid the complete infrastructure for Phase 42's standalone Legend widget. Three foundation changes: (1) `resolveLegendLayers` helper extracted from MapChartRenderer (zero-behavior refactor), (2) `<LayersLegendPanel showChevron={false}>` mode for non-collapsible rendering in grid cells, (3) `widgets` + `onConfigureWidget` prop threading from DashboardsPage → renderers/config panels.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract resolveLegendLayers + back-compat re-export + MapChartRenderer refactor | ed97f9f | resolveLegendLayers.ts, resolveLegendLayers.spec.ts, LayersLegendPanel.tsx, MapChartRenderer.tsx |
| 2 | Extend LayersLegendPanel with optional showChevron prop | 1ef22de | LayersLegendPanel.tsx, LayersLegendPanel.spec.tsx |
| 3 | Thread ConfigPanelProps.widgets + onConfigureWidget through ChartConfigPanel + WidgetRenderer + DashboardsPage | 046984d | registry.ts, ChartConfigPanel.tsx, ChartConfigPanel.spec.tsx, WidgetRenderer.tsx, DashboardsPage.tsx, LayersLegendPanel.tsx (local import fix) |

## Test Counts

| Spec File | Pre-Plan | New Tests | Post-Plan |
|-----------|----------|-----------|-----------|
| resolveLegendLayers.spec.ts | 0 | 9 | 9 |
| LayersLegendPanel.spec.tsx | 16 | 4 | 20 |
| MapChartRenderer.spec.tsx | 166 | 0 | 166 (unchanged) |
| ChartConfigPanel.spec.tsx | existing | 1 | +1 |
| Full suite | 1239 | 14+ | 1253 |

## Phase 41 Zero-Behavior-Change Regression

All 166 MapChartRenderer.spec.tsx tests pass without modification. The useMemo body refactor (calling `resolveLegendLayers(...)` instead of inline filter+map) is observationally identical — same deps array `[legendKey, includedLayerIdsForLegend]`, same eslint-disable comment, same empty-array-means-all-on semantic.

## Plan 42-02 Readiness Checklist

- `lib/resolveLegendLayers.ts` callable from LegendRenderer — DONE
- `<LayersLegendPanel showChevron={false}>` usable for non-collapsible in-grid rendering — DONE
- `ConfigPanelProps.widgets?: WidgetDto[]` available for LegendConfigPanel source-map-widget dropdown — DONE
- `onConfigureWidget?: (widget: WidgetDto) => void` available for LegendRenderer's Reconfigure button — DONE
- WidgetConfigModal receives `widgets: WidgetDto[]` (required) forwarded to ChartConfigPanel → Custom slot — DONE

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Local import required alongside re-export for TypeScript scoping**
- **Found during:** Task 1 (LayersLegendPanel.tsx back-compat re-export)
- **Issue:** `export type { ResolvedLegendLayer } from "../lib/resolveLegendLayers"` alone does NOT bring the name into local scope for use in `LayersLegendPanelProps`. TypeScript error TS2304 on `ResolvedLegendLayer` in props type definition.
- **Fix:** Added `import type { ResolvedLegendLayer } from "../lib/resolveLegendLayers"` alongside the re-export (both lines required — same pattern documented in Phase 30 STATE.md decisions for SpatialTarget).
- **Files modified:** kinetica_bi/src/components/LayersLegendPanel.tsx
- **Commit:** 046984d (fixed as part of Task 3 tsc check)

## tsc Baseline Parity

Running `npx tsc --noEmit` produces zero new errors in non-spec source files. Pre-existing spec-only errors (fs/path module resolution in .spec.tsx files, `__dirname` usage) remain unchanged from Phase 41 baseline — these are test-infrastructure errors that don't affect compilation.

## Self-Check: PASSED

All created files exist on disk. All task commits verified in git log.
