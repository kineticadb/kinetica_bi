---
phase: 48-me-extension-frontend-store-ui-gating
plan: "03"
subsystem: frontend-permission-gating
tags: [rbac, permissions, ui-gating, dashboards, widgets, analyst, designer]
dependency_graph:
  requires: [48-01]
  provides: [GATE-V18-02, GATE-V18-03, GATE-V18-04]
  affects: [DashboardsPage, WidgetRenderer, LegendRenderer, DashboardsPage.spec, LegendRenderer.spec]
tech_stack:
  added: []
  patterns:
    - "hide-don't-disable: {canX && <button/>} — permission booleans derived from hasPermission(PERMISSIONS.*)"
    - "react-grid-layout dragConfig.enabled + resizeConfig.enabled boolean API for grid inertness"
    - "seedDesignerStore() + seedAnalystStore() helpers consumed in beforeEach (inside Zustand reset shim boundary)"
key_files:
  created: []
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx
    - packages/web/src/components/charts/LegendRenderer.tsx
    - packages/web/src/components/charts/LegendRenderer.spec.tsx
decisions:
  - "dragConfig.enabled:false used for grid inertness (first-class DragConfig boolean in react-grid-layout v2.2.2; no per-item isDraggable/static fallback needed)"
  - "ChartConfigPanel needs NO read-only mode: GATE-V18-04 satisfied by unreachability via canConfigure gate on both gear button and onConfigureWidget prop"
  - "LegendRenderer Reconfigure button hidden when onConfigureWidget is undefined (clean-hide > no-op for analyst)"
  - "seedDesignerStore() placed as FIRST line inside each affected beforeEach (after Zustand reset shim wipes user→null)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-05"
  tasks: 3
  files: 4
---

# Phase 48 Plan 03: DashboardsPage Permission Gating Summary

Permission-gating of all DashboardsPage affordances (action-bar, toolbar, widget grid/gear/remove, LegendRenderer Reconfigure CTA) behind `hasPermission(PERMISSIONS.*)` with hide-don't-disable semantics, plus co-located spec migration and new GATE-V18-02/03/04 analyst/designer test assertions.

## Tasks Completed

### Task 1: Migrate DashboardsPage.spec beforeEach blocks to seed designer permissions
**Commit:** 93292ce

Added `import { seedDesignerStore, seedAnalystStore } from "../test/seedAuthStore"` and `seedDesignerStore()` as the first line in the beforeEach of 4 describe blocks:
- "DashboardsPage — LIFE-V13-04"
- "Phase 30 — spatial chips in FilterBar"
- "Phase 34 — Dynamic Views action-bar button"
- "Phase 35 — useDynamicViewMaterializeChain"

Result: 19/20 passing (only the pre-existing known-red button-order TD-V17-DASHPAGE-SPEC).

### Task 2: Gate DashboardsPage action-bar + toolbar buttons + verify grid inert
**Commit:** 6b0c893

Applied the full gating table from interfaces to DashboardsPage.tsx:
- **List view:** `+ New Dashboard` → `canCreate`; per-row `Edit` → `canEdit`; per-row `Delete` → `canDelete`
- **DashboardDetail:** `Edit` → `canEdit` (component refactored from arrow function to function body to allow hook call)
- **DashboardOpen toolbar:** `Tables` / `Visualizations` → `canEdit`; `Dynamic Views` → `canDynamicViews`; `Map Layers` → `canLayers`
- **Grid:** `dragConfig={{ enabled: canEdit }}` + `resizeConfig={{ enabled: canEdit }}`

Grid path taken: `dragConfig.enabled: false` — confirmed first-class boolean in react-grid-layout v2.2.2 DragConfig interface. No per-item `isDraggable/static` fallback was needed.

Result: 19/20 passing (1 pre-existing known-red unchanged).

### Task 3: Gate widget gear/x + Reconfigure CTA; add analyst-hidden + designer-visible tests
**Commit:** 9cbc62d

- DashboardsPage: gear (`widget-configure`) gated on `canConfigure` (WIDGETS_CONFIGURE); × (`widget-remove`) on `canEdit`
- WidgetRenderer call: `onConfigureWidget={canConfigure ? (target) => setConfiguringWidget(target) : undefined}` — LegendRenderer orphan Reconfigure CTA cannot open ChartConfigPanel for non-configurers
- LegendRenderer polish: `{onConfigureWidget && <button>Reconfigure</button>}` — clean hide semantics for analyst
- LegendRenderer.spec: Test 1 updated to assert Reconfigure is absent when onConfigureWidget is undefined
- DashboardsPage.spec: new "Phase 48 — permission gating (GATE-V18-02/03/04)" describe block with:
  - Analyst context: asserts + New Dashboard, Dynamic Views, Map Layers, Visualizations, Tables, .widget-configure, .widget-remove all absent
  - Designer context: asserts all the above ARE present
  - EXPLICIT ANALYST REGRESSION: FilterBar chip dismiss is clickable and fires removeFilter without error

Final suite: **1513/1514** (1 pre-existing known-red; no new regressions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DashboardDetail arrow-function-to-body conversion**
- **Found during:** Task 2
- **Issue:** DashboardDetail was an arrow-function arrow-expression component (`() => <div>...`); converting to body form required closing the implicit return with `return (...)` and adding the proper `}` closing brace
- **Fix:** Refactored to function body with explicit `return (...)` to allow `useAuthStore` hook call at component top
- **Files modified:** packages/web/src/components/DashboardsPage.tsx
- **Commit:** 6b0c893

**2. [Rule 1 - Bug] LegendRenderer.spec Test 1 assertion update**
- **Found during:** Task 3
- **Issue:** After applying clean-hide to LegendRenderer's Reconfigure button (hidden when onConfigureWidget is undefined), Test 1 asserted `getByRole("button", { name: "Reconfigure" })` but the button no longer renders without an onConfigureWidget prop
- **Fix:** Changed to `queryByRole("button", { name: "Reconfigure" })` with `toBeNull()` assertion — documents the hide semantics as a positive test
- **Files modified:** packages/web/src/components/charts/LegendRenderer.spec.tsx
- **Commit:** 9cbc62d

## GATE-V18-04 Documentation: ChartConfigPanel Unreachability

Per CONTEXT.md, GATE-V18-04's read-only intent is satisfied by unreachability. The ChartConfigPanel needs NO read-only mode because it is only reachable when `canConfigure` is true:
1. The gear button (`widget-configure`) is hidden with `{canConfigure && <button ...>}`
2. `onConfigureWidget` passed to WidgetRenderer is `undefined` when `!canConfigure`, so LegendRenderer's Reconfigure CTA (which calls `onConfigureWidget?.(widget)`) is also hidden

An analyst cannot open ChartConfigPanel by any UI path.

## Self-Check: PASSED

Files confirmed to exist:
- packages/web/src/components/DashboardsPage.tsx — FOUND
- packages/web/src/components/DashboardsPage.spec.tsx — FOUND
- packages/web/src/components/charts/LegendRenderer.tsx — FOUND
- packages/web/src/components/charts/LegendRenderer.spec.tsx — FOUND

Commits confirmed:
- 93292ce (Task 1)
- 6b0c893 (Task 2)
- 9cbc62d (Task 3)
