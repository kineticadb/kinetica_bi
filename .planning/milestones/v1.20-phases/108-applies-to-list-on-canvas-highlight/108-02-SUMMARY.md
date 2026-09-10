---
phase: 108-applies-to-list-on-canvas-highlight
plan: 02
subsystem: ui
tags: [react, zustand, filter-panel, on-canvas-highlight, applies-to]

# Dependency graph
requires:
  - phase: 108-applies-to-list-on-canvas-highlight
    plan: 01
    provides: filterHighlightStore, WidgetCard (registerRef), useReverseFilterMap
  - phase: 107-panel-shell-reflow-xor-switch-chips
    provides: FilterPanel/FilterChip panel shell + prop-threading contract
provides:
  - FilterChip panel-variant applies-to line + chevron expander + hover/click handlers
  - FilterPanel/FilterPanelChip prop threading for appliesTo + highlight/activate callbacks
  - DashboardsPage reverse-map wiring (appliesByFilter/appliesByShape, ref-map, closures)
affects: [109-global-clear-all, 110-designer-settings-ui-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Panel-chip activation routed through a dedicated 'applies to N widgets' toggle button (not the whole chip div) so it never collides with the dismiss button; all inner buttons stopPropagation to keep hover/dismiss/activate independently addressable"
    - "Reference-identity join: Map<ActiveFilter|Shape, WidgetApplyEntry[]> built from useReverseFilterMap's filterEntries/shapeEntries, looked up by the SAME raw filter/shape object the chip-group builder already iterates"
    - "Topmost-widget selection via getWidgetLayout(widget,index) min-y/tie-min-x — never DOM order (react-grid-layout absolute-positions)"

key-files:
  created: []
  modified:
    - packages/web/src/components/FilterChip.tsx
    - packages/web/src/components/FilterChip.spec.tsx
    - packages/web/src/components/FilterPanel.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.panel.spec.tsx
    - packages/web/src/test/setup.ts

key-decisions:
  - "Click-to-activate lives on the 'applies to N widgets' button, not the outer chip div (which also contains the dismiss ✕) — avoids needing an extra stopPropagation layer on every other interactive child and keeps the topbar branch untouched (topbar never sets onClick on its root)."
  - "Global scrollIntoView stub added to test/setup.ts (jsdom doesn't implement it) rather than per-spec, since any future spec importing DashboardsPage transitively needs it — mirrors the getComputedStyle stub already there."

patterns-established:
  - "Any future panel-chip child interaction must stopPropagation on its own onClick to remain independently clickable inside the nested chip/applies-to/row button stack."

requirements-completed: [FSCOPE-V120-01, FSCOPE-V120-02, FSCOPE-V120-03]

# Metrics
duration: ~45min
completed: 2026-07-10
---

# Phase 108 Plan 02: Applies-To Panel Wiring Summary

**Wired Plan 108-01's foundation (filterHighlightStore, WidgetCard ref/highlight, useReverseFilterMap) into the panel FilterChip/FilterPanel: each chip now shows an "applies to N widgets" line + chevron expander (map-layer names appended), hovering rings the affected widget cards, and clicking scrolls to the topmost affected widget while flashing all — expanded rows scroll+flash just one, with prefers-reduced-motion respected. Top-bar variant left byte-unchanged.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 completed
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments
- `FilterChip` panel branch: applies-to line (`applies to N widgets`, literal copy, no pluralization) + chevron expander gated on N>0; expanded rows render `widgetTitle` (` — layer1, layer2` suffix for map entries); hover rings via `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`; click-to-activate on the applies-to button; dismiss button stopPropagation so it never triggers activate. Topbar branch untouched (byte-identical, verified by unmodified + new parity assertions).
- `FilterPanel`/`FilterPanelChip` thread the five new optional fields (`appliesTo`, `onHighlight`, `onClearHighlight`, `onActivate`, `onActivateWidget`) straight through to `FilterChip` with no store subscription added to `FilterPanel` itself.
- `DashboardsPage`: calls `useReverseFilterMap`, builds `appliesByFilter`/`appliesByShape` `Map`s keyed by the SAME filter/shape object references the panel group builders already iterate (reference-identity join per Phase 105's seeding contract), maintains a `cardRefs` ref-map populated via `WidgetCard`'s `registerRef`, and exposes `highlight`/`clearHl`/`activateAll`/`activateOne` closures wired into `panelTableGroups`/`panelDvGroups`/`panelSpatialGroup`. Topmost-widget selection uses `getWidgetLayout` (min y, tie-break min x) — never DOM order. `scrollToWidget` respects `prefers-reduced-motion` (`auto` vs `smooth`, always `block:"nearest"`).
- Global `Element.prototype.scrollIntoView` jsdom stub added to `test/setup.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend FilterChip (panel branch) + FilterPanel prop threading** - `4e081ac` (feat)
2. **Task 2: DashboardsPage wiring — hook, ref-map, group-builder closures** - `5813571` (feat)

## Files Created/Modified
- `packages/web/src/components/FilterChip.tsx` - panel-branch applies-to line/expander + hover/click/row handlers; topbar branch unchanged
- `packages/web/src/components/FilterChip.spec.tsx` - new panel-variant describe block (N-count, zero-no-chevron, expand+layerNames, hover, click/stopPropagation, row activation, topbar-parity) alongside the untouched existing topbar tests
- `packages/web/src/components/FilterPanel.tsx` - `FilterPanelChip` type + `FilterPanelGroup` chip forwarding extended with the five new optional fields; scope-guardrail comment updated
- `packages/web/src/components/DashboardsPage.tsx` - `useReverseFilterMap` call, `appliesByFilter`/`appliesByShape` lookups, `cardRefs`/`registerRef`, highlight/scroll/flash closures, group builders extended, `registerRef` passed to `<WidgetCard>`
- `packages/web/src/components/DashboardsPage.panel.spec.tsx` - new interaction describe block (chip count, hover highlight, click-topmost scroll+flash, row-single scroll+flash, reduced-motion behavior flag) + extended the Pitfall #6 class-presence list with the four Phase 108 classes
- `packages/web/src/test/setup.ts` - global `scrollIntoView` stub for jsdom

## Decisions Made
- Followed the plan's locked prop shapes, closure signatures, and topmost-selection algorithm exactly (getWidgetLayout, not DOM order).
- Routed chip-body activation through the "applies to N widgets" button rather than the whole chip div, per the plan's explicit guidance (avoids colliding with the dismiss ✕).

## Deviations from Plan

None — plan executed exactly as written. All CSS classes referenced (`widget-card--highlighted`, `widget-card--flashing`, `@keyframes widget-flash`, `filter-panel-chip-applies*`, `applies-to-row`) already existed in `global.css` from Plan 108-01, so no CSS edits were needed in this plan.

## Issues Encountered

- **Full-suite noise (not a regression):** `npx vitest run` full run shows 9 unhandled-rejection console errors from `InfoCardRenderer.spec.tsx` / `InfoPopup.spec.tsx` (401 `ReauthRequiredError` from `columnDisplayConfigStore.loadConfig` background fetch) — these are the documented pre-existing non-failing noise called out in the plan's critical reminders; all 149 test files / 3326 tests still report PASSED.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FSCOPE-V120-01 (display), FSCOPE-V120-02 (hover), and FSCOPE-V120-03 (click) are all wired end-to-end and covered by unit/interaction tests.
- Visual-only items (ring/flash appearance in light+dark theme, narrow-viewport, smooth-scroll motion feel) are explicitly deferred to Phase 110's blocking operator walk-through (VERIFY-V120-01) — no human-verify checkpoint was added in this phase, per the plan's verification section.
- No blockers for Phase 109 (global clear-all) or Phase 110 (designer settings UI + verification).

---
*Phase: 108-applies-to-list-on-canvas-highlight*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created files verified present; both task commits (`4e081ac`, `5813571`) verified in git log.
