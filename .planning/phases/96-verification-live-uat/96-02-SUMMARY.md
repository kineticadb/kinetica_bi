---
phase: 96-verification-live-uat
plan: "02"
subsystem: filter-scope-config-ui
tags: [filter-scope, dv-bound, spatial-sentinel, gap-closure, frontend-only]
dependency_graph:
  requires: [FilterSelectionPanel.tsx (Phase 93), ChartConfigPanel.tsx (Phase 93/94), KineticaWmsLayerForm.tsx (Phase 93/94)]
  provides: [FilterSelectionPanel allowSpatial prop, Customize-on all-checked pre-population]
  affects: [ChartConfigPanel FilterSelectionPanel usage, KineticaWmsLayerForm FilterSelectionPanel usage]
tech_stack:
  added: []
  patterns: [optional prop with default, pre-populate allow-list on enable]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/FilterSelectionPanel.tsx
    - packages/web/src/components/charts/FilterSelectionPanel.spec.tsx
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
decisions:
  - "allowSpatial=false suppresses SPATIAL_DRAWS_SENTINEL row; passed as draftDynamicViewId===undefined from ChartConfigPanel and layer?.dynamic_view_id==null from KineticaWmsLayerForm"
  - "Customize-on pre-populates allowedSourceWidgetIds with all current source ids + sentinel (when allowSpatial) so start state == accept-all; accept-none warning preserved for manual-uncheck-all"
  - "showAcceptNoneWarning when allowSpatial=false depends only on hasLiveSelection (sentinel cannot be selected, so hasSentinel check skipped)"
metrics:
  duration: "~17 minutes"
  completed: "2026-06-29"
  tasks_completed: 2
  files_changed: 4
---

# Phase 96 Plan 02: FilterSelectionPanel Gap Closure (GAPs 4+5) Summary

Closed two config-UI gaps: Customize-on now pre-checks all sources (accept-all start state, GAP 4) and the SPATIAL_DRAWS_SENTINEL row is suppressed for dv-bound vizs via a new `allowSpatial` prop (GAP 5).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | FilterSelectionPanel — default-all-checked + allowSpatial prop | 6d88083 | FilterSelectionPanel.tsx, FilterSelectionPanel.spec.tsx |
| 2 | Thread allowSpatial from both config surfaces | decc288 | ChartConfigPanel.tsx, KineticaWmsLayerForm.tsx |

## What Was Built

### GAP 4 — Customize-on starts ALL-CHECKED (accept-all)

Previously, enabling Customize initialized `allowedSourceWidgetIds: []` (empty allow-list = ignore all filters). This contradicted the "all filters applied by default" model.

The fix: `handleCustomizeToggle`'s enable branch now builds the all-checked set from currently-listed sources before calling `onChange`:
```
const ids: (number | string)[] = sources.map((w) => w.id);
if (allowSpatial) ids.push(SPATIAL_DRAWS_SENTINEL);
onChange({ sourceMode: "allowlist", allowedSourceWidgetIds: ids });
```

The accept-none warning is preserved — it appears when the user manually unchecks every source.

### GAP 5 — Suppress spatial sentinel for dv-bound vizs

Previously, the "Spatial draws (map)" row was always rendered in allowlist mode, including for dv-bound vizs where dv+spatial is server-rejected (400).

The fix: new `allowSpatial?: boolean` prop (default `true`). When `false`, the sentinel `<label>` is suppressed via `{allowSpatial && (...)}`. Consumers wire:
- `ChartConfigPanel`: `allowSpatial={draftDynamicViewId === undefined}` — dv-bound → false, table-bound → true
- `KineticaWmsLayerForm`: `allowSpatial={layer?.dynamic_view_id == null}` — dv-bound layer → false, table-bound → true

The `showAcceptNoneWarning` logic was also updated: when `allowSpatial=false`, the sentinel cannot be selected, so the warning depends only on `hasLiveSelection` (not `hasSentinel`).

## Test Coverage Added

11 new scenarios in `FilterSelectionPanel.spec.tsx` (groups 10+11):

**Group 10 — GAP 4 Customize-on pre-checks:**
- Enabling Customize (allowSpatial=true) pre-checks both widget ids AND sentinel
- All checkboxes start checked; no accept-none warning shown
- allowSpatial=false pre-checks widget ids only (no sentinel)
- accept-none warning fires when allowSpatial=false and allowlist empty
- selfWidgetId-excluded sources NOT included in pre-checked set

**Group 11 — GAP 5 spatial row suppression:**
- allowSpatial=false hides the spatial row in allowlist mode
- allowSpatial=false hides it even in accept-all mode (not rendered at all)
- allowSpatial=true (explicit) shows the spatial row
- Omitted allowSpatial (default=true) shows the spatial row
- accept-none warning fires when allowSpatial=false and allowlist empty

1 existing test updated: "checking Customize fires onChange" updated to expect pre-populated ids (sentinel included) rather than empty array.

Total spec: 34 tests (all pass).

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run src/components/charts/FilterSelectionPanel.spec.tsx`: 34/34 pass
- `npx vitest run src/styles/theme-guard.spec.ts`: 132/132 pass (no new hex, no new CSS classes)
- `npx tsc --noEmit` (plan-02 files isolated): clean
- No new CSS class names added; no raw hex; `var(--danger)` used for warning text (unchanged)
- Zero server diff (pure client UI)
- SPATIAL_DRAWS_SENTINEL sentinel row unchanged in table-bound flow (allowSpatial=true default)

## Self-Check: PASSED

- FilterSelectionPanel.tsx: FOUND
- FilterSelectionPanel.spec.tsx: FOUND
- ChartConfigPanel.tsx (allowSpatial): FOUND
- KineticaWmsLayerForm.tsx (allowSpatial): FOUND
- Task 1 commit 6d88083: FOUND
- Task 2 commit decc288: FOUND
