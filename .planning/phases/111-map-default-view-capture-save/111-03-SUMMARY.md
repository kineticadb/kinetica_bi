---
phase: 111-map-default-view-capture-save
plan: 03
subsystem: ui
tags: [react, zustand, map-config, config-panel]

# Dependency graph
requires:
  - phase: 111-01
    provides: "useMapCurrentViewStore, formatLatLon/formatZoom, MapWidgetConfig.defaultView + getDefaultView getter"
  - phase: 111-02
    provides: "MapChartRenderer publishing the live OL view into useMapCurrentViewStore on mount + moveend"
provides:
  - "MapConfigPanel DEFAULT VIEW config-group: live readout, Set-as-default button, Clear button"
  - "The consumer half of MAPVIEW-V121-01 (save) and MAPVIEW-V121-04 (clear) — config.defaultView is now writable/clearable from the UI"
affects: [112-map-default-view-apply-on-load]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First buttons ever added to MapConfigPanel — established the btn-primary btn-sm + ghost-sm ghost-danger inside ds-actions pairing as this panel's button convention"
    - "Scoped Zustand selector (s.views[widgetId]) to avoid re-rendering the config panel on every mounted map's moveend"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/MapConfigPanel.tsx
    - packages/web/src/components/charts/MapConfigPanel.spec.tsx

key-decisions:
  - "widgetId destructured directly from ConfigPanelProps (already optional/already threaded per 111-CONTEXT.md correction) — no prop-chain plumbing needed"
  - "Clear deletes config.defaultView via `delete next.defaultView` rather than setting undefined, matching the existing changeBasemapCss/spatial-target clear precedent in this same file"
  - "Both saved default and pending live replacement are shown simultaneously per the 111-CONTEXT.md lock — the button's own label carries the live readout so the overwrite is visible before the click"

requirements-completed: [MAPVIEW-V121-01, MAPVIEW-V121-04]

# Metrics
duration: 8min
completed: 2026-09-09
---

# Phase 111 Plan 03: DEFAULT VIEW Consumer UI in MapConfigPanel Summary

**MapConfigPanel gains a DEFAULT VIEW config-group with a live zoom/centre readout (via a scoped `useMapCurrentViewStore` selector), a Set-as-default button that writes the exact unrounded EPSG:3857 view into `config.defaultView`, and a Clear button that deletes the key entirely.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-09T18:55:00Z
- **Completed:** 2026-09-09T19:03:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- A `DEFAULT VIEW` config-group sits between `VIEWPORT SYNC` and `LAYERS PANEL`, reading only its own widget's slot from `useMapCurrentViewStore` (`s.views[widgetId]`) — never the whole store, so this panel does not re-render on every map's pan/zoom.
- The primary button's own label carries the live readout (`Set as default — zoom 12.4 · 40.71°N, 74.01°W`), satisfying the 111-CONTEXT.md lock that a blind save behind the opaque `.modal-overlay` is unacceptable; it is disabled when no live view is available.
- Saving persists the exact unrounded fractional zoom and EPSG:3857 centre via the panel's existing `onChange` auto-save path; clearing deletes the `defaultView` key (never sets it to `undefined`).
- When a default already exists, both the saved value and the pending live replacement are shown simultaneously, making the imminent (undo-less) overwrite visible before the click.
- 9 new spec tests lock the save/clear/readout/edge-case behavior, using a scoped mock of `mapCurrentViewStore` and a formatter mock so the spec stays OpenLayers-free.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the DEFAULT VIEW section to MapConfigPanel** - `0060fd2` (feat)
2. **Task 2: Spec-cover save, clear, both-values readout and the undefined-widgetId edge** - `57e9f45` (test)

_Note: not TDD-flagged tasks; each task's single commit is the plan's specified `type`._

## Files Created/Modified
- `packages/web/src/components/charts/MapConfigPanel.tsx` - destructured `widgetId`, added the scoped live-view selector + `getDefaultView` read + save/clear handlers + the DEFAULT VIEW JSX block (all pre-existing `global.css` classes: `config-group`, `config-group-label`, `config-hint`, `ds-actions`, `btn-primary btn-sm`, `ghost-sm ghost-danger`)
- `packages/web/src/components/charts/MapConfigPanel.spec.tsx` - added `vi.mock` for `mapCurrentViewStore` (scoped selector) and `mapViewFormat` (hand-computable formatters), plus a new `describe` block with 9 tests (D1-D9: section exists, disabled state, live readout, save-writes-exact-value, both-values-before-overwrite, Clear visibility, Clear deletes key, undefined-widgetId safety, per-widget isolation)

## Decisions Made
- Followed the plan's specified interfaces and JSX verbatim — no architectural deviation.
- Adjusted one spec assertion (D7) to grep-match the plan's literal acceptance pattern (`Object.prototype.hasOwnProperty.call(onChange.mock.calls[0][0], "defaultView")` inline rather than via an intermediate `next` variable) so the acceptance-criteria grep passes exactly as specified.
- Added `_currentViewState.views = {}` reset to both the pre-existing top-level `beforeEach` (Phase 12 describe block) and a new local `beforeEach` in the Phase 111 describe block, for full test isolation given the shared module-level mock state.

## Deviations from Plan

None — plan executed exactly as written, aside from the one cosmetic assertion-wording adjustment noted above (not a behavior change).

## Issues Encountered
- The full `npx vitest run` (161 files) showed 6 pre-existing/transient failures in `WidgetRenderer.spec.tsx` and `actionEngine.canary.spec.tsx` — both exercise `MapChartRenderer`, which a parallel agent (Plan 111-02, executing concurrently on the same branch) is actively committing to. None of the failures touch `MapConfigPanel.tsx`/`.spec.tsx`; `git diff --name-only` on both of this plan's commits confirms only `MapConfigPanel.tsx` and `MapConfigPanel.spec.tsx` were touched. Per this plan's scope fence ("this plan touches only `MapConfigPanel.tsx` and its spec... do not open [`MapChartRenderer.tsx`]"), these failures are out of scope and were not fixed here. Targeted verification (`MapConfigPanel.spec.tsx` + `theme-guard.spec.ts`) is 242/242 green, and `tsc --noEmit` is clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `config.defaultView` is now fully writable/clearable by designers. Phase 112 (apply-on-load) can read it via `getDefaultView()` and construct the OL `View` with it, falling back to world view (`center: [0,0], zoom: 2`) when absent — `MapChartRenderer.tsx` remains the sole file Phase 112 needs to touch for that read-path.
- Both `MapConfigPanel.tsx` and `.spec.tsx` gates are green in isolation; the full-suite noise from the concurrent 111-02 branch work should clear once that plan's SUMMARY lands — worth a fresh full-suite run at that point before declaring Phase 111 fully verified.

---
*Phase: 111-map-default-view-capture-save*
*Completed: 2026-09-09*

## Self-Check: PASSED

All created/modified files and commit hashes verified present on disk / in git log:
- packages/web/src/components/charts/MapConfigPanel.tsx (modified, DEFAULT VIEW section present)
- packages/web/src/components/charts/MapConfigPanel.spec.tsx (modified, 9 new tests present)
- commits: 0060fd2, 57e9f45
