---
phase: 104-synchronized-map-viewports
plan: "01"
subsystem: web/store + web/lib + web/components
tags: [zustand, map, viewport-sync, config-panel, tdd]
dependency_graph:
  requires: []
  provides:
    - mapViewportSyncStore (publish/clear/reset keyed by dashboardId)
    - getSyncViewportEnabled (mapInfoConfig.ts getter)
    - syncViewport?: boolean on MapWidgetConfig
    - "Sync map viewport" toggle in MapConfigPanel (default OFF)
  affects:
    - packages/web/src/store/mapViewportSyncStore.ts
    - packages/web/src/store/mapViewportSyncStore.spec.ts
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/mapInfoConfig.ts
    - packages/web/src/components/charts/MapConfigPanel.tsx
tech_stack:
  added: []
  patterns:
    - Transient Zustand store keyed by dashboardId (mirrors spatialFilterStore.ts)
    - Config getter with DEFAULT_* constant (mirrors all existing mapInfoConfig getters)
    - config-group/config-toggle/config-hint markup (mirrors showScaleBar toggle)
key_files:
  created:
    - packages/web/src/store/mapViewportSyncStore.ts
    - packages/web/src/store/mapViewportSyncStore.spec.ts
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/mapInfoConfig.ts
    - packages/web/src/components/charts/MapConfigPanel.tsx
decisions:
  - "syncViewport field is NOT emitted as a WMS param — pure client-side view-state flag"
  - "VIEWPORT SYNC group inserted after MAP CONTROLS (before LAYERS PANEL) in config panel"
  - "Store ships dormant; Plan 104-02 wires publish/subscribe in MapChartRenderer"
metrics:
  duration: "228s (~4 minutes)"
  completed_date: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 3
---

# Phase 104 Plan 01: mapViewportSyncStore + config foundation Summary

**One-liner:** Transient per-dashboard viewport-sync Zustand store (publish/clear/reset + ViewportSnapshot) with getSyncViewportEnabled() getter (default OFF) and a "Sync map viewport" config-toggle in MapConfigPanel — all dormant until Plan 104-02 wires MapChartRenderer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create mapViewportSyncStore + pure-logic spec (TDD) | 94e6c5f | mapViewportSyncStore.ts, mapViewportSyncStore.spec.ts |
| 2 | Add syncViewport config field + getSyncViewportEnabled getter | fd7a518 | wmsUrlBuilder.ts, mapInfoConfig.ts |
| 3 | Add "Sync map viewport" toggle to MapConfigPanel | 2eee132 | MapConfigPanel.tsx |

## What Was Built

### mapViewportSyncStore.ts

New transient Zustand store under `src/store/`. Exposes:
- `viewports: Record<number, ViewportSnapshot | undefined>` — keyed by dashboardId
- `publish(dashboardId, snap)` — writes/overwrites the dashboard slot
- `clear(dashboardId)` — removes the dashboard slot, leaves others intact
- `reset()` — full wipe (used on logout and dashboard-switch cleanup)

`ViewportSnapshot` carries `center: [number, number]` (EPSG:3857), `zoom`, `originWidgetId`, and `bump` (monotonic for force-resync).

### mapViewportSyncStore.spec.ts

10 spec tests covering: initial state (shim canary), publish overwrite, dashboard isolation, clear with isolation, reset, ViewportSnapshot field shape, and state key structure. No explicit `beforeEach` reset — relies on the Zustand reset shim.

### wmsUrlBuilder.ts (MapWidgetConfig)

Added `syncViewport?: boolean` after the existing `showLoadingIndicator` field. Annotated as a pure client-side flag — never emitted as a WMS URL parameter (mirrors the showScaleBar / showFullscreenButton pattern).

### mapInfoConfig.ts

Added `DEFAULT_SYNC_VIEWPORT = false` and `getSyncViewportEnabled()` getter after the existing `getShowLoadingIndicator` pair. Backward-compat: absent field returns `false` (legacy maps unchanged).

### MapConfigPanel.tsx

- Added `getSyncViewportEnabled` to the import block from `mapInfoConfig`
- Added `const syncViewport = getSyncViewportEnabled({ syncViewport: widgetCfg.syncViewport })` derivation
- Added a new `config-group` (VIEWPORT SYNC) inserted between MAP CONTROLS and LAYERS PANEL
- Uses only existing classes: `config-group`, `config-group-label`, `config-toggle`, `config-hint`
- No raw hex; no invented class names; theme tokens only

## Test Gates

| Gate | Status |
|------|--------|
| `npx tsc --noEmit` (web) | PASS |
| `npx vitest run` (141 files, 3221 tests) | PASS |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASS (138 tests) |
| `npx vitest run src/store/mapViewportSyncStore.spec.ts` | PASS (10 tests) |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All created files exist on disk. All task commits verified in git log.
