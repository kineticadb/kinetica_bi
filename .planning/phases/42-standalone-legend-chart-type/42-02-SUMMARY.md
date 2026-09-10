---
phase: "42"
plan: "02"
subsystem: frontend-legend-chart-type
tags: [feature, tdd, legend, chart-registry, widget-renderer]
dependency_graph:
  requires:
    - Phase 42 Plan 01 (resolveLegendLayers, showChevron prop, ConfigPanelProps.widgets, onConfigureWidget threading)
    - Phase 41 (LayersLegendPanel, MapChartRenderer legendKey pattern)
    - Phase 23 (info-card registry entry pattern)
  provides:
    - LegendRenderer.tsx (standalone legend widget renderer)
    - LegendConfigPanel.tsx (source-map-widget dropdown config panel)
    - definitions/legend.ts (legend chart type registry entry)
    - WidgetRenderer early-return branch for widget.type==='legend'
    - global.css .legend-widget-* selectors
  affects:
    - chart picker (legend now appears as a selectable type)
    - DashboardsPage (LegendRenderer mounts inside DashboardContextProvider with onConfigureWidget)
tech_stack:
  added: []
  patterns:
    - legendKey primitive selector (PITFALL S-02 mirror of MapChartRenderer)
    - orphan-state rendering (3 triggers → single verbatim UI)
    - props.widgets (not useDashboardContext) for provider-boundary safety
    - mapWidgetIdsKey primitive dep for auto-pick useEffect
    - early-return ladder extension in WidgetRenderer before AggregatedWidgetRenderer
key_files:
  created:
    - kinetica_bi/src/components/charts/LegendConfigPanel.tsx
    - kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx
    - kinetica_bi/src/components/charts/LegendRenderer.tsx
    - kinetica_bi/src/components/charts/LegendRenderer.spec.tsx
    - kinetica_bi/src/components/charts/definitions/legend.ts
  modified:
    - kinetica_bi/src/components/charts/definitions/index.ts
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
    - kinetica_bi/src/styles/global.css
decisions:
  - "LegendConfigPanel reads widgets from props (not useDashboardContext) — WidgetConfigModal is outside DashboardContextProvider; hook would throw at runtime"
  - "mapWidgetIdsKey primitive string dep avoids referential re-fires on auto-pick useEffect (same pattern as legendKey in MapChartRenderer)"
  - "void onConfigureWidget removed from WidgetRenderer atomically with legend branch addition — Plan 42-01's placeholder removed when consumer ships"
  - "JSDoc comment must not contain useDashboardContext string — Test 9 source audit catches it; comment reworded to avoid false positive"
  - "import registerAllChartTypes from definitions/index.ts (not registry.ts) — registry only exports registerChartType/getChartType/getAllChartTypes"
metrics:
  duration: "~6 minutes (386 seconds)"
  completed: "2026-05-22"
  tasks_completed: 3
  files_modified: 9
  files_created: 5
---

# Phase 42 Plan 02: Legend Renderer Config and Registry Summary

Shipped the standalone Legend chart type consuming the foundation from Plan 42-01. `LegendConfigPanel` provides source-map-widget dropdown driven by `props.widgets`; `LegendRenderer` subscribes via `legendKey` primitive selector and mounts `<LayersLegendPanel showChevron={false}>`; the `legend` chart type is registered in the chart-type registry; WidgetRenderer routes `widget.type==='legend'` to `LegendRenderer` before the AggregatedWidgetRenderer fallback. All 5 WIDGET-V17-* requirements close.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | LegendConfigPanel — source-map-widget dropdown + auto-pick + empty state | 1039dc0 | LegendConfigPanel.tsx, LegendConfigPanel.spec.tsx |
| 2 | LegendRenderer — orphan-aware, legendKey-subscribed, LayersLegendPanel showChevron=false + CSS | 911bd3d | LegendRenderer.tsx, LegendRenderer.spec.tsx, global.css |
| 3 | Register legend chart type + WidgetRenderer early-return branch + spec | bfa83d5 | definitions/legend.ts, definitions/index.ts, WidgetRenderer.tsx, WidgetRenderer.spec.tsx |

## Test Counts

| Spec File | Pre-Plan | New Tests | Post-Plan |
|-----------|----------|-----------|-----------|
| LegendConfigPanel.spec.tsx | 0 | 10 | 10 |
| LegendRenderer.spec.tsx | 0 | 11 | 11 |
| WidgetRenderer.spec.tsx | 60 | 5 | 65 |
| Full suite | 1253 | 26 | 1279 |

## WIDGET-V17-* Requirement Closure

| Requirement | Closed By | Test |
|-------------|-----------|------|
| WIDGET-V17-01 (legend registry + WidgetRenderer branch) | legend.ts + index.ts + WidgetRenderer.tsx | Test 12-16 |
| WIDGET-V17-02 (LegendRenderer legendKey + resolveLegendLayers + showChevron=false) | LegendRenderer.tsx | Tests 5-10 |
| WIDGET-V17-03 (config UI props.widgets dropdown, cross-dashboard out of scope) | LegendConfigPanel.tsx | Tests 1-10 |
| WIDGET-V17-04 (orphan state + Reconfigure CTA) | LegendRenderer.tsx | Tests 1-4 |
| WIDGET-V17-05 (live updates via shared store) | LegendRenderer.tsx | Test 8 |

## ROADMAP Phase 42 Success Criteria

- SC1 (chart type registry + WidgetRenderer early-return): definitions/legend.ts registered, WidgetRenderer legend branch before AggregatedWidgetRenderer fallback. PASS
- SC2 (config UI source-map-widget dropdown): LegendConfigPanel dropdown filtered to type==='map', auto-picks, reads from props.widgets. PASS
- SC3 (orphan state + Reconfigure CTA): 3 triggers render verbatim copy + Reconfigure button calling onConfigureWidget(widget). PASS
- SC4 (live updates via shared store): legendKey primitive selector; Test 8 validates cb_config mutation → re-render. PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment in LegendConfigPanel.tsx contained `useDashboardContext`**
- **Found during:** Task 1 Test 9 (source file audit: must not contain `useDashboardContext`)
- **Issue:** Plan-provided JSDoc comment verbatim included `useDashboardContext()` in the CRITICAL note, causing Test 9's `source.not.toMatch(/useDashboardContext/)` to fail even though no import or call existed.
- **Fix:** Rewrote the comment to "NOT from the dashboard context hook" instead of "NOT from useDashboardContext()" — same semantic meaning, no grep hit.
- **Files modified:** kinetica_bi/src/components/charts/LegendConfigPanel.tsx
- **Commit:** 1039dc0

**2. [Rule 1 - Bug] `registerAllChartTypes` import pointed to wrong module in spec**
- **Found during:** Task 3 Tests 12-13 (registry tests)
- **Issue:** Plan-provided skeleton imported `registerAllChartTypes` from `"./registry"`, but that function is defined in `"./definitions/index"` — registry.ts only exports `registerChartType`, `getChartType`, `getAllChartTypes`.
- **Fix:** Split import: `getChartType`/`getAllChartTypes` from `"./registry"`, `registerAllChartTypes` from `"./definitions/index"`.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Commit:** bfa83d5

## tsc Parity

Zero new errors in non-spec source files. Pre-existing spec-only errors (fs/path module in .spec.tsx files) remain unchanged from Phase 41 + Plan 42-01 baseline.

## Self-Check: PASSED
