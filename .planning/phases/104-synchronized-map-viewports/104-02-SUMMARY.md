---
phase: 104-synchronized-map-viewports
plan: "02"
subsystem: web/components
tags: [openLayers, zustand, viewport-sync, echo-guard, cleanup-chain]
dependency_graph:
  requires:
    - mapViewportSyncStore (publish/clear/reset keyed by dashboardId) — Plan 104-01
    - getSyncViewportEnabled (mapInfoConfig.ts getter) — Plan 104-01
  provides:
    - MapChartRenderer publish effect (moveend → store publish, guarded by isSyncDrivenRef)
    - MapChartRenderer subscribe effect (incomingViewport → view.animate({duration:0}))
    - isSyncDrivenRef echo-loop guard (reset inside moveend handler)
    - mapViewportSyncStore.reset() in DashboardsPage cleanup chain (11th store, dashboard-switch)
    - mapViewportSyncStore.reset() in App.tsx logout cleanup chain (11th store)
  affects:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/App.tsx
tech_stack:
  added: []
  patterns:
    - OL map.on('moveend') + unByKey(EventsKey) listener cleanup (mirrors Effect 8 geomChangeKey pattern)
    - isSyncDrivenRef boolean ref (reset inside moveend, not animate callback — Pitfall 3 safe site)
    - Zustand selector scoped to s.viewports[dashboardId] (S-02 lock — never whole viewports object)
    - view.animate({center,zoom,duration:0}) atomic programmatic move (mirrors existing zoom toolbar pattern)
    - Module-level mutable _syncStoreState + hook mock (mirrors existing spec mock patterns)
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/App.tsx
decisions:
  - "isSyncDrivenRef reset inside moveend handler (not animate callback) — safest site per Pitfall 3 / Q2 in RESEARCH.md; avoids OL moveend/callback ordering uncertainty"
  - "dashboardId derived from existing dashboardCtx (not a second useDashboardContextOptional() call) — avoids double hook invocation at same render scope"
  - "Auto-fixed missing getSyncViewportEnabled + useMapViewportSyncStore mocks in actionEngine.canary.spec.tsx and WidgetRenderer.spec.tsx (Rule 2 — missing critical mock broke pre-existing tests)"
metrics:
  duration: "~50 minutes"
  completed_date: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 6
---

# Phase 104 Plan 02: MapChartRenderer Viewport Sync Wiring Summary

**One-liner:** Viewport sync wired in MapChartRenderer — moveend publish + isSyncDrivenRef echo-loop guard + scoped subscribe/animate effects + store reset in both cleanup chains (11th store), proven by OL-mock publish/disabled/echo-guard tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Publish effect + isSyncDrivenRef + subscribe effect in MapChartRenderer | 98562e2 | MapChartRenderer.tsx |
| 2 | Register mapViewportSyncStore.reset() in both cleanup chains | 783da5e | DashboardsPage.tsx, App.tsx |
| 3 | OL-mock tests for publish / disabled-no-op / echo-guard | 135bf90 | MapChartRenderer.spec.tsx |
| Auto-fix | Add getSyncViewportEnabled + useMapViewportSyncStore mocks to affected specs | ae29fc0 | actionEngine.canary.spec.tsx, WidgetRenderer.spec.tsx |

## What Was Built

### MapChartRenderer.tsx — Task 1

Four additions to the component:

**Import:** `getSyncViewportEnabled` added to the `mapInfoConfig` import; `useMapViewportSyncStore` imported from the store.

**`isSyncDrivenRef`** — `useRef<boolean>(false)` added alongside `mountedRef`. The critical echo-loop guard. Set to `true` BEFORE `view.animate()` in the subscribe effect; reset to `false` INSIDE the moveend handler (safest site per RESEARCH.md Pitfall 3 — avoids OL moveend/animate-callback ordering uncertainty). Ref (not state) so it is readable synchronously inside the moveend callback.

**`syncEnabled` + `dashboardId`** — derived at component scope from `widgetConfig` and the existing `dashboardCtx` (already in scope from `useDashboardContextOptional()`).

**Effect 9a (PUBLISH):** Attaches `map.on("moveend", ...)` only when `syncEnabled && dashboardId !== undefined`. The handler: checks `isSyncDrivenRef.current` → if true, resets flag and returns (echo suppressed); otherwise reads `view.getCenter()` + `view.getZoom()`, guards both, and calls `useMapViewportSyncStore.getState().publish(dashboardId, { center, zoom, originWidgetId: widget.id, bump: Date.now() })`. Cleanup: `unByKey(key)`. When `syncEnabled` is false, NO listener is attached — byte-identical to pre-Phase-104 (MAPSYNC-V119-06).

**`incomingViewport` selector** — `useMapViewportSyncStore((s) => dashboardId === undefined ? undefined : s.viewports[dashboardId])`. Scoped to this dashboard's slot only (S-02 lock).

**Effect 9b (SUBSCRIBE):** Gates on `syncEnabled + dashboardId + incomingViewport`. Skips own publishes via `incomingViewport.originWidgetId === widget.id` check. Sets `isSyncDrivenRef.current = true` before calling `map.getView().animate({ center, zoom, duration: 0 })`.

### DashboardsPage.tsx + App.tsx — Task 2

- `useMapViewportSyncStore` imported in both files
- `useMapViewportSyncStore.getState().reset()` appended as the 11th store reset in both cleanup chains, immediately after the existing final `useFilterCombinationStore.getState().reset()` line
- Comment: "Phase 104 (MAPSYNC-V119-05): 11th store — transient viewport sync, session-only, no server DROP."

### MapChartRenderer.spec.tsx — Task 3

**Mock additions:**
- `capturedMoveendHandler` and `lastMockView` module-level variables to track the moveend handler and view mock
- Extended `ol/Map` mock: `getView()` now returns `mockView` (captured in `lastMockView`) with `getCenter: vi.fn(() => [100, 200])`, `animate: vi.fn()` alongside the existing methods; `on()` now captures `'moveend'` handler in `capturedMoveendHandler`
- `vi.mock("../../store/mapViewportSyncStore", ...)` with module-level `_syncStoreState` (publish/reset as `vi.fn()`s)
- `getSyncViewportEnabled: (cfg) => cfg?.syncViewport ?? false` added to `mapInfoConfig` mock

**Tests added (new describe block):**
- **Test A (MAPSYNC-V119-02):** `syncViewport=true` → `map.on('moveend')` registered; firing it calls `publish` with `{ center: [100,200], zoom: 10, originWidgetId: 10 }` for `dashboardId=42`
- **Test B (MAPSYNC-V119-06):** `syncViewport` absent → NO `moveend` registration, `publish` never called
- **Test C (MAPSYNC-V119-04):** Foreign viewport in store → `view.animate({center, zoom, duration:0})` called; firing `capturedMoveendHandler` afterward → `publish` NOT called (isSyncDrivenRef guard proven end-to-end)

All tests use `DashboardContextProvider` wrapper with `dashboardId=42`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing mock] getSyncViewportEnabled absent in actionEngine.canary.spec.tsx + WidgetRenderer.spec.tsx**
- **Found during:** Task 3 full-suite run
- **Issue:** Both spec files mock `../../lib/mapInfoConfig` but did not include `getSyncViewportEnabled` (newly added by Task 1). Vitest strict mock validation throws: "No 'getSyncViewportEnabled' export is defined on the mock."
- **Fix:** Added `getSyncViewportEnabled: () => false` and `DEFAULT_SYNC_VIEWPORT: false` to both mocks. Added `vi.mock("../../store/mapViewportSyncStore", ...)` no-op to both (same reason — store now imported at top of MapChartRenderer).
- **Files modified:** actionEngine.canary.spec.tsx, WidgetRenderer.spec.tsx
- **Commit:** ae29fc0

## Test Gates

| Gate | Status |
|------|--------|
| `npx tsc --noEmit` (web) | PASS |
| `npx vitest run` (141 files, 3224 tests) | PASS |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASS (138 tests) |
| `npx vitest run src/components/charts/MapChartRenderer.spec.tsx` | PASS (207 tests, 3 new Phase 104) |

## Self-Check: PASSED

All modified files committed. All task commits verified in git log (98562e2, 783da5e, 135bf90, ae29fc0).
