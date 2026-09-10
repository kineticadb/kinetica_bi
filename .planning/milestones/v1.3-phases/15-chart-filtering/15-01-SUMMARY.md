---
phase: 15-chart-filtering
plan: "01"
subsystem: ui
tags: [react, context, dashboard, vitest, testing-library]

# Dependency graph
requires:
  - phase: 12-dashboard-layers-panel
    provides: DashboardOpen component structure in DashboardsPage.tsx; widget grid layout
provides:
  - DashboardContext.tsx with DashboardContextProvider + useDashboardContext hook
  - DashboardContext.spec.tsx covering provider/consumer happy path + fail-loud throw
  - DashboardsPage.tsx DashboardOpen mount site wrapping widget grid in DashboardContextProvider
affects:
  - 15-02 (AggregatedWidgetRenderer consumes useDashboardContext().dashboardId for materializeFilter args)
  - 15-05 (lifecycle cleanup reads dashboardId from FilterViewEntry, not this context hook)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React context with null sentinel createContext — enables fail-loud hook throw without default value"
    - "DashboardContextProvider wraps DashboardOpen widget grid — auto-cleared on dashboard switch"
    - "useDashboardContext fail-loud guard: if (ctx === null) throw Error(...) — mirrors react-redux useSelector idiom"

key-files:
  created:
    - kinetica_bi/src/components/DashboardContext.tsx
    - kinetica_bi/src/components/DashboardContext.spec.tsx
  modified:
    - kinetica_bi/src/components/DashboardsPage.tsx

key-decisions:
  - "DashboardContextValue shape is { dashboardId: number } only — no full DashboardDto, no associated tableIds, no drop helpers (user-locked minimal surface)"
  - "Mount site is DashboardOpen (not App.tsx, not DashboardsPage component level) so context auto-clears on dashboard switch"
  - "useDashboardContext throws fail-loud Error — no silent null fallback; tests must wrap renderers in provider"
  - "Provider placed OUTSIDE widgets.length>0 conditional so context exists during zero-widget states (15-02 specs may render zero-widget states with provider)"
  - "No useMemo on provider value — re-renders cheap; 15-02 selector subscriptions are reference-stable per tableId"

patterns-established:
  - "React null-sentinel context pattern: createContext<T | null>(null) + throw guard in hook"
  - "Inline Consumer component in spec for hook testing (not renderHook) — portable across @testing-library versions"
  - "console.error spy in beforeEach/afterEach to suppress React error-boundary noise in throw tests"

requirements-completed:
  - FILT-V13-01

# Metrics
duration: 3min
completed: "2026-05-07"
---

# Phase 15 Plan 01: DashboardContext + dashboardId Plumbing Summary

**React context shipping { dashboardId: number } via DashboardContextProvider in DashboardOpen; fail-loud useDashboardContext hook; 4 spec tests green; dormant until Plan 15-02 wires the first consumer**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-07T01:39:15Z
- **Completed:** 2026-05-07T01:41:55Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Created `DashboardContext.tsx` with the user-locked minimal shape `{ dashboardId: number }`, null-sentinel createContext, fail-loud throw guard, and TSDoc documenting mount site + consumer list
- Created `DashboardContext.spec.tsx` with 4 tests: happy path read, re-render with different dashboardId, throw string match, throw instanceof Error
- Modified `DashboardsPage.tsx` to import DashboardContextProvider and wrap the widget grid in DashboardOpen with `<DashboardContextProvider dashboardId={dashboard.id}>`
- Phase 14 stores (filterViewStore.ts, filterStore.ts, client.ts), WidgetRenderer.tsx, and App.tsx remain byte-unchanged
- tsc --noEmit clean; full vitest suite: 19 files, 282 tests, all pass — zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DashboardContext provider + useDashboardContext hook** - `f5826dc` (feat)
2. **Task 2: Write DashboardContext.spec.tsx** - `2bbddc5` (test)
3. **Task 3: Mount DashboardContextProvider inside DashboardOpen** - `b087fa6` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `kinetica_bi/src/components/DashboardContext.tsx` — DashboardContextValue type, DashboardContextProvider, useDashboardContext hook with fail-loud null guard
- `kinetica_bi/src/components/DashboardContext.spec.tsx` — 4 vitest tests using @testing-library/react + inline Consumer component
- `kinetica_bi/src/components/DashboardsPage.tsx` — Import DashboardContextProvider; wrap DashboardOpen widget grid container in provider with dashboardId={dashboard.id}

## Decisions Made

- Provider placed outside `widgets.length > 0 && mounted` conditional — ensures context is available for zero-widget states that Plan 15-02 specs may render
- No `useMemo` on provider value object — downstream selector subscriptions in `useFilterViewStore` are reference-stable per tableId; dashboardId object-identity churn is not a performance concern
- Inline `Consumer` component pattern for spec throw tests rather than `renderHook` — portable across @testing-library/react versions per plan spec

## Deviations from Plan

None - plan executed exactly as written. The exact implementation code was prescribed in the plan; all acceptance criteria met on first attempt.

## Issues Encountered

None. `--reporter=basic` vitest flag caused an ERR_LOAD_URL runner error (pre-existing vitest reporter issue unrelated to plan changes); switched to default reporter — all 282 tests passed.

## Inheritance for Plan 15-02

- **Consumer import pattern:** `import { useDashboardContext } from "../DashboardContext";` (relative from `src/components/charts/`)
- **Usage:** `const { dashboardId } = useDashboardContext();` in `AggregatedWidgetRenderer` to populate `materializeFilter({ dashboardId, tableId, filters }, signal)` and `dropFilterView({ dashboardId, tableId })` args
- **Test wrapping:** All `AggregatedWidgetRenderer` specs MUST wrap renders in `<DashboardContextProvider dashboardId={N}>` — fail-loud hook will throw otherwise
- **DashboardContextValue type:** `import type { DashboardContextValue } from "../DashboardContext";` for type-checking provider wrapping in specs

## Next Phase Readiness

- Plan 15-02 can wire `AggregatedWidgetRenderer` as the first production consumer of `useDashboardContext().dashboardId`
- Context mount site is stable; no changes needed to DashboardOpen in 15-02
- Phase 14 stores dormant plumbing (`materializeFilter`, `dropFilterView`, `useFilterViewStore`) ready for 15-02 wiring

---
*Phase: 15-chart-filtering*
*Completed: 2026-05-07*
