---
phase: 108-applies-to-list-on-canvas-highlight
plan: 01
subsystem: ui
tags: [react, zustand, react-grid-layout, filter-panel, on-canvas-highlight]

# Dependency graph
requires:
  - phase: 105-reverse-mapping-pure-lib-tests
    provides: computeReverseFilterMap pure lib (VizDescriptor / FilterApplyEntry / ShapeApplyEntry)
  - phase: 107-panel-shell-reflow-xor-switch-chips
    provides: FilterPanel/FilterChip panel shell (consumed by 108-02, not this plan)
provides:
  - filterHighlightStore (session-only zustand store, 12th reset-chain store)
  - WidgetCard (extracted, React.memo + forwardRef, scoped-selector highlight/flash + deterministic timer cleanup)
  - useReverseFilterMap hook (+ enumerateVizDescriptors) wrapping computeReverseFilterMap
  - ring/flash/applies-to CSS classes in global.css
affects: [108-02-panel-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scoped boolean zustand selector (s => s.set.has(id)) + React.memo for re-render-storm avoidance"
    - "Deterministic setTimeout cleanup: clear-prior-timer-before-arming-new + effect cleanup + reflow-restart via offsetWidth"
    - "React.forwardRef + ...rest spread required when a mapped child is handed to react-grid-layout (ref/className/style/children/mouse-touch-handlers must all pass through)"

key-files:
  created:
    - packages/web/src/store/filterHighlightStore.ts
    - packages/web/src/store/filterHighlightStore.spec.ts
    - packages/web/src/components/WidgetCard.tsx
    - packages/web/src/components/WidgetCard.spec.tsx
    - packages/web/src/lib/useReverseFilterMap.ts
    - packages/web/src/lib/useReverseFilterMap.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/App.tsx
    - packages/web/src/styles/global.css

key-decisions:
  - "WidgetCard must forward RGL's injected ref/className/style/children/mouse-touch-handlers onto its root div (React.forwardRef + rest-spread) — react-resizable and react-draggable both clone the mapped grid child, so a plain memo'd component without pass-through silently loses grid positioning/drag/resize"
  - "handleDuplicateWidget/handleRemoveWidget/setConfiguringWidget wrapped in useCallback in DashboardsPage so WidgetCard's React.memo prop-stability holds"

patterns-established:
  - "Pattern: any future extracted react-grid-layout child component must forwardRef + spread rest props + render {children} (resize handles) or grid drag/resize breaks invisibly (only caught by an existing DOM-structure test, not by tsc/theme-guard)"

requirements-completed: [FSCOPE-V120-01]

# Metrics
duration: ~55min
completed: 2026-07-10
---

# Phase 108 Plan 01: Highlight Foundation Summary

**Session-only filterHighlightStore (12th reset-chain store) + WidgetCard extraction with scoped-selector re-render isolation and deterministic flash-timer cleanup + useReverseFilterMap hook wrapping the Phase-105 pure lib + ring/flash/applies-to CSS — all inert (byte-identical grid rendering) until Plan 108-02 wires the panel hover/click.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 completed
- **Files modified:** 9 (3 created source, 3 created specs, 3 modified)

## Accomplishments
- New `filterHighlightStore` (highlightedIds/flashingIds/flashNonce + setHighlighted/clearHighlighted/flash/reset) wired into both the DashboardsPage dashboard-switch cleanup and the App.tsx UNAUTHORIZED handler as the 12th reset-chain store
- `WidgetCard` extracted verbatim from DashboardsPage's `widgets.map` body, wrapped in `React.memo` + `React.forwardRef`, subscribing to the highlight store via scoped boolean selectors so only the affected card re-renders on hover/flash — with a fake-timer-covered deterministic flash-timeout cleanup (clears prior timer before arming a new one; always clears on unmount)
- `useReverseFilterMap` + exported `enumerateVizDescriptors`: live hook wrapping the Phase-105 `computeReverseFilterMap`, enumerating chart/table trigger-type widgets and map layers resolved to their owning map widget (reading the TOP-LEVEL `layer.filter_scope`, never `layer.config.filter_scope`)
- Ring (`.widget-card--highlighted`), flash (`.widget-card--flashing` + `@keyframes widget-flash`, reduced-motion guarded), and applies-to line/expander classes added to `global.css`, tokens/color-mix only

## Task Commits

Each task was committed atomically:

1. **Task 1: filterHighlightStore + both reset chains + CSS** - `518cf48` (feat)
2. **Task 2: Extract WidgetCard with scoped selectors, ref-map, deterministic flash cleanup** - `e9c87df` (feat)
3. **Task 3: useReverseFilterMap hook + enumerateVizDescriptors** - `ddef946` (feat)

## Files Created/Modified
- `packages/web/src/store/filterHighlightStore.ts` - session-only zustand highlight/flash store
- `packages/web/src/store/filterHighlightStore.spec.ts` - store behavior + reset-chain source-grep + CSS class-presence/no-hex/no-rgba assertions
- `packages/web/src/components/WidgetCard.tsx` - extracted, memo'd, forwardRef'd widget card with highlight/flash wiring
- `packages/web/src/components/WidgetCard.spec.tsx` - render-isolation + flash-timer-cleanup/re-trigger/auto-clear specs
- `packages/web/src/lib/useReverseFilterMap.ts` - live hook + enumerateVizDescriptors
- `packages/web/src/lib/useReverseFilterMap.spec.tsx` - enumeration + hook-wiring + reference-identity specs
- `packages/web/src/components/DashboardsPage.tsx` - registers filterHighlightStore.reset(); replaced inline `.widget-card` JSX with `<WidgetCard>`; wrapped handleDuplicateWidget/handleRemoveWidget/handleConfigureWidget in useCallback
- `packages/web/src/App.tsx` - registers filterHighlightStore.reset() in the UNAUTHORIZED chain
- `packages/web/src/styles/global.css` - ring/flash/applies-to classes

## Decisions Made
- Followed the plan's locked store shape, WidgetCard prop shape, and enumeration recipe exactly.
- Extended the WidgetCard prop type to accept and forward standard `HTMLAttributes<HTMLDivElement>` (className/style/children/mouse-touch handlers) via `React.forwardRef`, discovered necessary during Task 2 verification (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WidgetCard didn't forward react-grid-layout's injected ref/className/style/children/handlers, breaking grid positioning/drag/resize**
- **Found during:** Task 2, running the existing `DashboardsPage.panel.spec.tsx` regression suite after the extraction
- **Issue:** `ResponsiveGridLayout` clones each mapped child with `ref`/`className`/`style` (grid position), and its internal `react-resizable`/`react-draggable` wrappers further clone that same element with resize-handle `children` and `onMouseDown`/`onMouseUp`/`onTouchEnd`. The plan's WidgetCard template (a plain function component with no ref/rest-prop forwarding) silently swallowed all of this — `.react-grid-item` never applied and `document.querySelectorAll(".react-grid-item")` returned 0, failing the panel-mode layout test.
- **Fix:** Converted `WidgetCard` to `React.forwardRef`, added a merged-ref helper (`mergeRefs`) combining the internal card ref (used for the flash reflow + future ref-map registration) with RGL's forwarded ref, extended the prop type with `Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">`, spread `...rest` onto the root div, merged the injected `className`/`style` with the internal `widget-card`/highlight/flash classes, and rendered `{children}` (the resize-handle elements).
- **Files modified:** `packages/web/src/components/WidgetCard.tsx`
- **Verification:** `DashboardsPage.spec.tsx` + `DashboardsPage.panel.spec.tsx` (66 tests) green; full `npx vitest run` clean of any grid-related failures.
- **Committed in:** `e9c87df` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary for correctness — without it the widget grid would silently lose drag/resize for every dashboard. No scope creep; the fix stayed entirely inside `WidgetCard.tsx`.

## Issues Encountered

- **Full-suite noise (not a regression):** `npx vitest run` shows 6 pre-existing failures across 2 files (`DatasetsPage.spec.tsx` — 1 test; `src/components/charts/actionEngine.canary.spec.tsx` — 5 tests) that are cross-test-isolation contamination on this large suite, not caused by this plan. Verified: (a) `DatasetsPage.spec.tsx` passes 6/6 in isolation; (b) `actionEngine.canary.spec.tsx` fails an equivalent set of assertions (`lastMapInstance` null) even checked out at the pre-108-01 baseline commit (`aa31186`) run in isolation — confirming this flake predates and is unrelated to this plan's changes. Every spec file touched or created by this plan (`filterHighlightStore.spec.ts`, `WidgetCard.spec.tsx`, `useReverseFilterMap.spec.tsx`, `DashboardsPage.spec.tsx`, `DashboardsPage.panel.spec.tsx`, `theme-guard.spec.ts`) is 100% green both in isolation and in the full run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `filterHighlightStore`, `WidgetCard` (with `registerRef` prop already stubbed in for the ref-map), and `useReverseFilterMap` are all ready for Plan 108-02 to wire hover→highlight / click→scroll+flash into the panel chips.
- No blockers. The grid renders byte-identically with the store empty (verified via the existing `DashboardsPage`/`DashboardsPage.panel` spec suites staying green), satisfying the "inert extraction" gate for this plan.

---
*Phase: 108-applies-to-list-on-canvas-highlight*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created files verified present; all three task commits (`518cf48`, `e9c87df`, `ddef946`) verified in git log.
