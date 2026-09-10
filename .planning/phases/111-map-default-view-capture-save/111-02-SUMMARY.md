---
phase: 111-map-default-view-capture-save
plan: 02
subsystem: ui
tags: [openlayers, ol-map, zustand, react-effects, vitest]

# Dependency graph
requires:
  - phase: 111-01
    provides: "useMapCurrentViewStore (widgetId-keyed live-view store, publish/clear/reset)"
provides:
  - "MapChartRenderer Effect 9c — always-on publish of the live OL view (center+zoom) into useMapCurrentViewStore, keyed by widget.id, at mount and on every moveend"
  - "useMapCurrentViewStore wired into both canonical cleanup chains (App.tsx logout, DashboardsPage.tsx dashboard-switch) as the 13th store"
affects: [111-03-consumer, 112-map-default-view-apply-on-load]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Always-on OL effect with a single `if (!map) return;` guard, deliberately with NO syncViewport/dashboardId gate — contrasts with the neighboring Effect 9a (Phase 104) which IS gated, documented inline to prevent future conflation"
    - "Publish-at-mount + publish-on-moveend via the same closure, so a store slot exists even for a never-panned map"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/App.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
    - packages/web/src/components/charts/actionEngine.canary.spec.tsx

key-decisions:
  - "Effect 9c is strictly one-directional (map -> store) and never references isSyncDrivenRef — nothing ever animates a map from this store, so a sync-driven pan's resulting view SHOULD still be reflected in the config readout, unlike Effect 9a's echo-suppressed publish"
  - "The three hand-rolled OL Map mocks in WidgetRenderer.spec.tsx, actionEngine.canary.spec.tsx, and DashboardsPage.spec.tsx needed getCenter (and in one case getZoom) added to their getView() stub — Effect 9c calls both unconditionally at mount for every map widget, which these hadn't needed before since only the gated Effect 9a exercised them"

requirements-completed: [MAPVIEW-V121-01]

# Metrics
duration: 12min
completed: 2026-09-09
---

# Phase 111 Plan 02: Publisher — Always-On Live-View Publish + Cleanup-Chain Wiring Summary

**MapChartRenderer now unconditionally publishes its live OL view into the widgetId-keyed `useMapCurrentViewStore` at mount and on every `moveend`, unblocking `MapConfigPanel`'s live readout, and the store joins the App.tsx/DashboardsPage.tsx cleanup chains as the 13th store.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-09T18:53:00Z
- **Completed:** 2026-09-09T19:05:08Z
- **Tasks:** 3
- **Files modified:** 7 (4 plan-specified + 3 test-mock fixes)

## Accomplishments
- Effect 9c in `MapChartRenderer.tsx` — deliberately ungated live-view publish (mount + moveend), clearing its store slot on unmount; the initial OL `View` construction (`center: [0, 0], zoom: 2`) is byte-unchanged, preserving the Phase 112 scope fence
- `MapChartRenderer.spec.tsx` updated for a two-moveend-listener world (`capturedMoveendHandlers[]` + `fireAllMoveend()`), with all three Phase 104 sync-behaviour assertions preserved verbatim, plus four new tests (D-G) locking the initial publish, the missing sync gate, unmount cleanup, and the Phase 112 scope fence
- `useMapCurrentViewStore.getState().reset()` wired as the 13th store in both the `App.tsx` logout chain and `DashboardsPage.tsx` dashboard-switch chain, immediately after the existing `useFilterHighlightStore` (12th) reset

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the always-on live-view publish effect to MapChartRenderer** - `ee26f3b` (feat)
2. **Task 2: Update MapChartRenderer.spec.tsx for two moveend listeners and add Phase 111 publish tests** - `561adba` (test)
3. **Task 3: Add the store to both cleanup chains (13th store)** - `95256d5` (feat)

**Deviation fix (Rule 3 — blocking issue):** `8826d01` (fix) — two more hand-rolled OL Map mocks (`WidgetRenderer.spec.tsx`, `actionEngine.canary.spec.tsx`) needed `getCenter`/`getZoom` added, discovered when running the full suite after Task 3.

_Note: no TDD flag on this plan's tasks; each is a single commit except the deviation fix._

## Files Created/Modified
- `packages/web/src/components/charts/MapChartRenderer.tsx` - added Effect 9c: always-on publish of `{center, zoom}` to `useMapCurrentViewStore`, keyed by `widget.id`, firing once at mount and on every `moveend`, clearing the slot on unmount
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` - replaced single-handler `capturedMoveendHandler` with `capturedMoveendHandlers[]` + `fireAllMoveend()`; added a `mapCurrentViewStore` mock mirroring the existing sync-store mock; fixed Phase 104 Tests A/B/C for the 2-listener reality; added Tests D-G for Phase 111 coverage
- `packages/web/src/App.tsx` - added `useMapCurrentViewStore.getState().reset()` as the 13th store in the logout cleanup chain
- `packages/web/src/components/DashboardsPage.tsx` - added `useMapCurrentViewStore.getState().reset()` as the 13th store in the dashboard-switch cleanup chain
- `packages/web/src/components/DashboardsPage.spec.tsx` - added `getCenter`/`getZoom` to the OL Map mock's `getView()` stub (Rule 3 fix)
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` - added `getCenter`/`getZoom` to the OL Map mock's `getView()` stub (Rule 3 fix)
- `packages/web/src/components/charts/actionEngine.canary.spec.tsx` - added `getCenter` to the OL Map mock's `getView()` stub (Rule 3 fix)

## Decisions Made
- Followed the plan's specified interfaces and effect body verbatim — no architectural deviation.
- Did not add a `syncEnabled`/`dashboardId`/`isSyncDrivenRef` guard to Effect 9c, per the plan's explicit instruction — confirmed by grep that none of those identifiers appear in the effect's actual code (only in surrounding explanatory comments).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two additional OL Map test mocks needed `getCenter`/`getZoom`**
- **Found during:** Post-Task-3 full-suite verification (`npx vitest run`)
- **Issue:** `WidgetRenderer.spec.tsx` and `actionEngine.canary.spec.tsx` each render `MapChartRenderer` against a hand-rolled `ol/Map` mock. Effect 9c (Task 1) unconditionally calls `view.getCenter()`/`view.getZoom()` at mount for every map widget; these two mocks' `getView()` stubs didn't provide one or both, so 6 previously-passing tests across the two files started throwing `TypeError: view.getCenter is not a function`. The plan's own `<verification>` section flagged this exact risk by name and pre-authorized the fix.
- **Fix:** Added `getCenter: vi.fn(() => [0, 0])` (and `getZoom` where missing) to each mock's `getView()` return object. `DashboardsPage.spec.tsx` had the identical gap (surfaced during Task 3's own gate run) and was fixed the same way, one commit earlier (`95256d5`).
- **Files modified:** `packages/web/src/components/charts/WidgetRenderer.spec.tsx`, `packages/web/src/components/charts/actionEngine.canary.spec.tsx`, `packages/web/src/components/DashboardsPage.spec.tsx`
- **Verification:** `npx vitest run` — 161 files / 3641 tests passing (up from the plan's stated 161/3628 baseline, reflecting the 4 new Phase 111 tests plus 9 net-new assertions in the touched specs); no assertion in any of these three files was weakened, skipped, or deleted.
- **Committed in:** `95256d5` (DashboardsPage.spec.tsx fix, bundled with Task 3) and `8826d01` (the other two, standalone fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue, three files affected)
**Impact on plan:** Necessary consequence of making the publish unconditional (the plan's own stated purpose); no scope creep, no weakened assertions.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `MapConfigPanel` (Plan 111-03, executed in parallel on the same branch) can now read a live `{center, zoom}` for the widget it is configuring via `useMapCurrentViewStore((s) => s.views[widgetId])` — confirmed present via `git log` showing 111-03's commits interleaved with this plan's on `feat/map-default-view`.
- Phase 112 (apply saved `defaultView` on load) can proceed: `MapChartRenderer.tsx`'s initial `View` construction is confirmed unchanged (`grep -c 'center: \[0, 0\]'` → 1, `grep -c defaultView` → 0), and Effect 9c's independence from that scope fence is explicit in its own comments.
- All three test gates green: `tsc --noEmit` clean, `npx vitest run` 3641/3641 passing (161 files), `theme-guard.spec.ts` 150/150 passing.

---
*Phase: 111-map-default-view-capture-save*
*Completed: 2026-09-09*

## Self-Check: PASSED

All commit hashes verified present in `git log --oneline`: ee26f3b, 561adba, 95256d5, 8826d01.
All modified files verified present on disk with expected content via grep during execution.
