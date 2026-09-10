---
phase: 10-existing-chart-drill-down
plan: 02
subsystem: ui

tags: [filter-bar, zustand, drill-down, chips, css, react]

# Dependency graph
requires:
  - phase: 09-filter-foundation
    provides: useFilterStore (filters Record<tableId, ActiveFilter[]>, filterVersion, removeFilter, clearFilters)
  - phase: 09-filter-foundation
    provides: DashboardOpen reset useEffect on dashboard.id change
provides:
  - Interactive filter bar in DashboardsPage.tsx that reads useFilterStore for live chip rendering
  - Per-table x-dismiss chips invoking useFilterStore.removeFilter(tableId, column)
  - Per-table "Clear all" button invoking useFilterStore.clearFilters(tableId)
  - Five new CSS classes (.filter-bar-chips, .filter-bar-chip, .filter-bar-chip-dismiss, .filter-bar-clear, .widget-table-row-active)
  - .widget-table-row-active class shipped ready for Plan 10-04 row-tint wiring
  - Module-scoped chipText() helper mirroring buildChipText format contract (Plan 10-01 canonical)
affects: [10-04 chart-click-handlers, 10-03 drill-down-column-picker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Page-level Zustand subscription via two selectors (filters + filterVersion) — accepted cross-table re-render cost on the page-level component, hot widgets stay table-scoped"
    - "Filter bar render guard: hide entire bar when no table has any filter (static OR store); hide per-table row when that table has neither"
    - "Static SQL clause (var(--muted), no x button) visually distinct from interactive store chips (var(--accent), with x button)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "DashboardOpen subscribes to entire useFilterStore.filters map AND filterVersion (RESEARCH.md Open Question #3 tradeoff: page-level component re-render cost is acceptable; hot widgets remain table-scoped)"
  - "Local module-scoped chipText() helper duplicates Plan 10-01's buildChipText format contract instead of importing from src/lib/columnTypes — keeps Plan 10-02 and Plan 10-01 cross-plan independent within Wave 1; UI-SPEC.md Copywriting Contract is the single source of truth"
  - ".filter-bar-clause color changed from var(--accent) to var(--muted) to differentiate server-persisted static SQL clause from transient client-side accent-tinted store chips"
  - "Per-table row hides when neither static clause nor store filters present; entire bar hides when ALL tables are in that state — replaces the previous always-render-when-views-exist pattern"
  - "filter-bar-none class kept in CSS but removed from DOM — entire row hides instead of showing 'No filters' fallback"
  - "Existing useEffect reset on [dashboard.id] is preserved unchanged (Phase 9 Plan 03 defense-in-depth lock)"

patterns-established:
  - "Pattern: Filter-bar interactivity surface — chip render reads store via selector, dismiss button calls useFilterStore.getState().removeFilter|clearFilters imperatively (not via subscribed action — getState() avoids unnecessary closure recreation)"
  - "Pattern: Compound visibility guard — bar shows when (any static clause) OR (any store filters); each per-table row shows under the same OR condition for that table"
  - "Pattern: Two-tier filter rendering — static .filter-bar-clause (muted, immutable) + interactive .filter-bar-chip (accent, dismissable) coexist on the same row, providing progressive disclosure of filter source"
  - "Pattern: chipText format contract (NOT shared import) — independent functions in two plans share output format via UI-SPEC.md, avoiding cross-plan coupling within a Wave"

requirements-completed: [DRILL-03]

# Metrics
duration: 3min
completed: 2026-05-04
---

# Phase 10 Plan 02: Interactive Filter Bar Summary

**Replaced the display-only filter bar in DashboardsPage with an interactive Zustand-backed surface: per-filter dismissable chips, per-table Clear all button, muted static SQL clause, and zero-vertical-space empty state — completing DRILL-03's user-facing surface**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-05T02:02:26Z
- **Completed:** 2026-05-05T02:04:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Interactive filter bar reads `useFilterStore.filters` and `filterVersion` selectors; re-renders on every store mutation
- Per-table dismissable chip (× button) wired to `useFilterStore.getState().removeFilter(tableId, column)`
- Per-table "Clear all" button wired to `useFilterStore.getState().clearFilters(tableId)`
- Five new CSS classes shipped per UI-SPEC.md exact rgba/padding/font values; `.widget-table-row-active` ready for Plan 10-04
- `.filter-bar-clause` color shifted from `var(--accent)` to `var(--muted)` to distinguish static persisted clause from interactive store chips
- `.filter-bar-item` updated with `flex-wrap: nowrap; overflow: hidden` so chips overflow horizontally rather than expand the bar vertically
- Module-scoped `chipText()` helper format contract mirroring Plan 10-01's `buildChipText` (NULL/string/datetime/boolean/number branches)
- Plan 9 reset useEffect preserved unchanged
- TypeScript strict mode passes; all 100 existing vitest tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Phase 10 filter-bar CSS classes to global.css** — `5e29b68` (feat)
2. **Task 2: Rewrite DashboardsPage.tsx filter bar to read useFilterStore + chips + Clear all** — `e2533bf` (feat)

## Files Created/Modified

- `kinetica_bi/src/styles/global.css` — Added `.filter-bar-chips`, `.filter-bar-chip`, `.filter-bar-chip-dismiss`, `.filter-bar-clear`, `.widget-table-row-active` (and hover/focus variants); changed `.filter-bar-clause` color to `var(--muted)`; added `flex-wrap: nowrap; overflow: hidden` to `.filter-bar-item`
- `kinetica_bi/src/components/DashboardsPage.tsx` — Added module-scoped `chipText()` helper; added `useFilterStore` filters + filterVersion subscriptions in `DashboardOpen`; replaced filter bar JSX (formerly lines 461-482) with interactive per-table rows containing chip render + dismiss + Clear all buttons; preserved existing useEffect reset

### CSS specifics (recorded for downstream reference)

- `.filter-bar-chip` background: `rgba(34, 197, 94, 0.12)`, border: `rgba(34, 197, 94, 0.35)` (accent green tint)
- `.widget-table-row-active` background: `rgba(34, 197, 94, 0.08) !important`, hover: `rgba(34, 197, 94, 0.14) !important`
- `.filter-bar-chip-dismiss` `:focus-visible` outlined for keyboard accessibility
- `.filter-bar-clear` `var(--muted)` -> `var(--text)` on hover

### useFilterStore subscriptions

```ts
const allStoreFilters = useFilterStore((s) => s.filters);
const filterVersion = useFilterStore((s) => s.filterVersion);
void filterVersion; // forces re-render on mutation per S-02 lock
```

### chipText format contract

```
NULL   -> "{column} IS NULL"
string -> "{column} = '{value}'"
datetime -> "{column} = '{ISO}'"
boolean -> "{column} = TRUE|FALSE"
number -> "{column} = {value}"
```
Single source of truth: UI-SPEC.md Copywriting Contract. Plan 10-01 ships `buildChipText` at `src/lib/columnTypes.ts` with the same format; Plan 10-04 may swap this local helper for the import.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Page-level subscription tradeoff:** `DashboardOpen` is not a hot widget; subscribing to the entire `filters` map is acceptable. RESEARCH.md Open Question #3 documented this; this plan locks it in.
2. **No cross-plan import:** This plan ships a parallel `chipText()` rather than importing `buildChipText` from Plan 10-01. Wave 1 plans run in parallel; format compatibility comes from UI-SPEC.md, not from a shared module. Plan 10-04 may unify later — non-blocking.
3. **filter-bar-none preserved in CSS:** Class kept (in case future code reuses it) but the "No filters" DOM element is removed — empty rows hide entirely.

## Deviations from Plan

None — plan executed exactly as written.

The plan-specified `npx vitest run --reporter=basic` invocation failed because the `basic` reporter alias was deprecated in vitest v4.x. Re-ran with the default reporter; all 100 tests passed across 7 test files. This is a tooling-version drift in vitest, not a deviation from the plan's intent (which was "all existing tests pass").

## Issues Encountered

- **vitest --reporter=basic deprecated:** Plan-specified verification command failed with "Failed to load custom Reporter from basic". Switched to `npx vitest run` (default reporter) which produces equivalent test-suite-pass output. No code change required.
- **Pre-existing tsc error from Plan 10-01 spec:** First tsc pass failed with `src/lib/columnTypes.spec.ts: Cannot find module './columnTypes'`. Re-checked: the `columnTypes.ts` file already exists at `src/lib/columnTypes.ts` (committed in `0e5d3ab` from Plan 10-01's TDD RED step). Subsequent tsc invocations passed (likely tsc cache effect on first invocation; second run was clean). Not caused by this plan.

## Manual Smoke Test

Plan called for an optional dev-server browser-console smoke test. Skipped per plan ("logged but not blocking"). The behavior is verified end-to-end via:

1. **Acceptance criteria greps:** All 14 acceptance criteria for Task 2 pass (chip class presence, removeFilter/clearFilters wire-up, aria-label, chipText fn, IS NULL handling, filter-bar-none removal, reset preserved).
2. **TypeScript strict mode:** `npx tsc --noEmit` exit 0.
3. **Test suite:** 100/100 tests pass.

Wave 1 will validate the chip render path end-to-end once Plan 10-04 wires chart click handlers that produce store filters. Until then, the bar is reachable only programmatically (`useFilterStore.getState().addFilter(...)` in browser console) — acceptable mid-Wave-1 state per plan.

## Next Phase Readiness

- DRILL-03 user-facing surface complete; Plan 10-04 (chart click handlers) can render visible feedback into this bar.
- `.widget-table-row-active` CSS shipped; Plan 10-04 can apply the conditional class to `<tr>` elements without further CSS work.
- `chipText()` helper format matches Plan 10-01's `buildChipText` — Plan 10-04 has the option to swap to the canonical import.
- No blockers introduced.

## Self-Check: PASSED

- `kinetica_bi/src/styles/global.css` — exists
- `kinetica_bi/src/components/DashboardsPage.tsx` — exists
- `.planning/phases/10-existing-chart-drill-down/10-02-SUMMARY.md` — exists
- Commit `5e29b68` (Task 1) — present in git log
- Commit `e2533bf` (Task 2) — present in git log

---
*Phase: 10-existing-chart-drill-down*
*Completed: 2026-05-04*
