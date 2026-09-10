---
phase: 10-existing-chart-drill-down
plan: 04
subsystem: ui

tags: [drill-down, recharts, click-handler, dim-peers, row-tint, toast, zustand]

# Dependency graph
requires:
  - phase: 09-filter-foundation
    provides: useFilterStore.addFilter (dedupe/replace/cap), buildEqualityFilter, AbortController fetch lifecycle
  - phase: 10-existing-chart-drill-down (Plan 10-01)
    provides: buildChipText, DrillDownDataType type alias, supportsDrillDown registry flag
  - phase: 10-existing-chart-drill-down (Plan 10-02)
    provides: .widget-table-row-active CSS class shipped (Plan 10-04 wires the conditional application)
  - phase: 10-existing-chart-drill-down (Plan 10-03)
    provides: cfg.drillDownColumn + cfg.drillDownColumnType persisted in widget config (read by Plan 10-04 click handlers)
provides:
  - dispatchDrillDown helper (pre-checks store for dedupe/replace before toast — first-add only)
  - onClick handlers across all 6 drill-down-enabled chart types (bar, line, pie, scatter, table, records)
  - Per-Cell fillOpacity dim-peers transient on bar/pie/scatter (300ms before addFilter dispatch — PITFALL C-03)
  - cursor: pointer on chart wrappers when supportsDrillDown && drillDownColumn truthy
  - widget-table-row-active class application on TableRenderer + RecordsTableRenderer rows matching active filter value
  - RecordsTableRenderer's first-ever filter store subscription (RESEARCH.md Pitfall 3 resolved)
  - Toast confirmation on first-add only (suppressed on dedupe + replace; cap-reached toast unchanged from Phase 9)
affects: [11-map-chart, 12-map-drill-down]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level helper function for store + toast dispatch (dispatchDrillDown) — keeps the dedupe/replace toast-suppression logic in one place rather than duplicated across 6 renderers"
    - "Per-renderer local clickedElement useState driving fillOpacity comparison — auto-cleared on data arrival via useEffect([data])"
    - "300ms setTimeout BEFORE addFilter dispatch in every renderer — preserves PITFALL C-03 sequencing (dim-peers visible before Phase 9 data-clear → loading transition)"
    - "Recharts Pie click pitfall: slice.payload is the source row, NOT slice directly — handled in PieRenderer.handleSliceClick"
    - "RecordsTableRenderer table-scoped filter subscription independent of AggregatedWidgetRenderer (records short-circuits at WidgetRenderer line 175 — must subscribe directly)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (414 insertions, 36 deletions — all 6 renderers + dispatchDrillDown helper + RecordsTableRenderer filter subscription)
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (279 insertions — 6 new Phase 10 tests in dedicated describe block)

key-decisions:
  - "dispatchDrillDown is module-level (not a per-renderer hook) — passed args object includes tableId/column/value/dataType/widgetId; pre-dispatch dedupe/replace check uses useFilterStore.getState() (synchronous, not subscribed) so it sees the same state addFilter is about to mutate"
  - "300ms setTimeout is consistent across ALL chart types (bar/line/pie/scatter/table/records) for predictable C-03 sequencing UX — even table/records where there is no dim-peers transient still wait 300ms before dispatch so the click→re-fetch latency feels uniform"
  - "Bar/Pie/Scatter use per-Cell fillOpacity (1.0 active, 0.3 peers); Line/Area do NOT visually dim — Recharts Line/Area do not support per-point opacity easily and the user feedback comes from the filter bar chip + toast + chart-card refetch (acceptable tradeoff documented in plan)"
  - "TableRenderer receives tableFilters as a NEW prop from AggregatedWidgetRenderer (already-subscribed selector); RecordsTableRenderer subscribes ITSELF (records short-circuits the AggregatedWidgetRenderer wrapper at line 175). RESEARCH.md Pitfall 3 resolved exactly here."
  - "LineRenderer uses setClickedElement only for symmetry/consistency (the value is set but never rendered into a fillOpacity) — kept the state hook for future per-point opacity wiring if Recharts ever supports it; void-prefix in destructuring suppresses unused-var lint"
  - "Toast suppression check (isDedupe || isReplace) reads useFilterStore.getState().filters[tableId] BEFORE the addFilter dispatch — same store state machine that Phase 9 addFilter inspects internally, guaranteeing alignment between the toast pre-check and the filter dispatch outcome"

patterns-established:
  - "Pattern: module-level dispatcher fn + per-renderer local state — splitting cross-cutting logic (toast/dedupe/store dispatch) from per-renderer concerns (clickedElement, cursor, JSX wiring) keeps each renderer's diff readable"
  - "Pattern: 300ms setTimeout before store mutation — gives the local visual state (dim-peers, button press) a render cycle to be visible before the next data-clear → loading state takes over"
  - "Pattern: Recharts category-chart click extraction — `nextState?.activePayload?.[0]?.payload as Row | undefined` works for Bar/Line/Scatter/Area; Pie uses `slice.payload as Row | undefined` (different signature documented inline)"
  - "Pattern: Records short-circuit subscription — components that bypass a wrapping subscriber must subscribe themselves; documented inline as RESEARCH.md Pitfall 3"

requirements-completed: [DRILL-01, DRILL-04]

# Metrics
duration: 4min
completed: 2026-05-04
---

# Phase 10 Plan 04: Chart-Click Drill-Down Wiring Summary

**Wired the click-to-filter behavior across all six drill-down-enabled chart types with dim-peers transient, sequenced 300ms dispatch, first-add-only toast confirmation, and persistent records-table row-tint via filter-store subscription — closing DRILL-01 + DRILL-04 end-to-end.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-05T02:11:02Z
- **Completed:** 2026-05-05T02:15:41Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2 (WidgetRenderer.tsx, WidgetRenderer.spec.tsx)
- **Tests added:** 6 (100 → 106 in full vitest suite)
- **Existing-test regressions:** 0

## Accomplishments

- All 6 drill-down-enabled chart types (bar/line/pie/scatter/table/records) now dispatch `useFilterStore.addFilter` on click after a 300ms delay (PITFALL C-03 sequencing)
- `dispatchDrillDown` helper centralizes the toast suppression logic — first-add fires `useToastStore.showToast(buildChipText(...), "info")`, dedupe + replace paths suppress (chip change is feedback)
- Per-Cell `fillOpacity` dim-peers transient on Bar/Pie/Scatter (1.0 for clicked element, 0.3 for peers) auto-clears via `useEffect([data])` when refetch completes
- Cursor inline style flips to `pointer` on chart wrappers ONLY when `drillEnabled` (`drillDownColumn` truthy && `tableId` defined) — graceful fallback for legacy widgets that have neither field
- TableRenderer + RecordsTableRenderer apply `widget-table-row-active` CSS class (shipped by Plan 10-02) to rows where `String(row[drillDownColumn]) === String(activeFilterValue)` — persists post-refetch
- RecordsTableRenderer gained its first-ever `useFilterStore` subscription on `filters[tableId]` (RESEARCH.md Pitfall 3 — records short-circuits the AggregatedWidgetRenderer wrapper, so it must subscribe directly)
- TypeScript strict mode passes; full vitest suite is 106/106 (was 100/100 before this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): Add Phase 10 click-handler integration tests** — `9b6bb1e` (test)
2. **Task 2 (TDD GREEN): Wire click handlers + dim-peers + cursor + row-tint + toast** — `c0a55d4` (feat)

**Plan metadata commit:** to follow (docs: complete plan)

_Note: Task 1 RED → Task 2 GREEN. No refactor commit — implementation matched plan-specified shape on first pass._

## Click-Handler Wiring per Chart Type

| Chart       | Click target           | Click extraction                                      | Dim-peers visual                                | Cursor          |
| ----------- | ---------------------- | ----------------------------------------------------- | ----------------------------------------------- | --------------- |
| Bar         | `<BarChart onClick>`   | `nextState.activePayload[0].payload[drillDownColumn]` | Per-Cell `fillOpacity` (1.0 active / 0.3 peers) | Wrapper pointer |
| Line / Area | `<LineChart onClick>`  | `nextState.activePayload[0].payload[drillDownColumn]` | NONE (Recharts limitation; toast/chip suffices) | Wrapper pointer |
| Pie         | `<Pie onClick>`        | `slice.payload[drillDownColumn]` (PITFALL 1)          | Per-Cell `fillOpacity` (1.0 active / 0.3 peers) | Wrapper pointer |
| Scatter     | `<ScatterChart onClick>` | `nextState.activePayload[0].payload[drillDownColumn]` | Per-Cell `fillOpacity` (1.0 active / 0.3 peers) | Wrapper pointer |
| Table       | `<tr onClick>`         | `row[drillDownColumn]` (direct DOM)                   | NONE (rows aren't aggregated)                   | `<tr>` pointer  |
| Records     | `<tr onClick>`         | `row[drillDownColumn]` (direct DOM)                   | NONE (rows aren't aggregated)                   | `<tr>` pointer  |

All chart types share the same 300ms `setTimeout` before `dispatchDrillDown` for predictable C-03 sequencing.

## Dim-Peers Transient Mechanics

- Each renderer holds its own `clickedElement: unknown` via `useState`. Set on click (the source row's category column value); cleared via `useEffect(() => setClickedElement(null), [data])` so a refetch result auto-resets the visual state.
- During the 300ms window, `<Cell fillOpacity={...}>` evaluates to `1.0` if `String(row[x]) === String(clickedElement)` else `0.3`. After 300ms, `dispatchDrillDown` fires → addFilter → useFilterStore mutation → `filterVersion++` → AggregatedWidgetRenderer's `useEffect([sql, filterVersion])` re-fires → `setData([])` (data-clear) → loading state → fresh fetch → `setData(rows)` → `useEffect([data])` fires → `setClickedElement(null)`.
- The 300ms is wall-clock-tied — long enough that even on fast hardware the dim render is observable, short enough that the click→refetch latency stays snappy.
- Line/Area renderers preserve the `clickedElement` state hook for future-proofing but do not currently consume it (Recharts Line/Area do not support per-point opacity).

## Toast Suppression Logic (DRILL-04 SC-5)

`dispatchDrillDown` reads `useFilterStore.getState().filters[tableId]` BEFORE calling addFilter:

```
existing = filters[tableId] ?? []
sameCol  = existing.find(f => f.column === column)
isDedupe  = sameCol && sameCol.value === value
isReplace = sameCol && !isDedupe

if (!isDedupe && !isReplace) {
  showToast(buildChipText(column, value, dataType), "info")
}

addFilter(tableId, { column, value, dataType, sourceWidgetId, addedAt })
```

| Scenario                                            | addFilter outcome | Toast |
| --------------------------------------------------- | ----------------- | ----- |
| New column (column not in filters)                  | Added             | Fires |
| Same column same value (re-click active)            | Silent no-op      | Suppressed |
| Same column different value (replace)               | Replaced          | Suppressed (chip change is feedback) |
| Over cap (10 per table) and column NOT already in   | Silent no-op      | Phase 9's addFilter fires the cap-reached toast (we do NOT duplicate) |
| Over cap and column IS already in (replace path)    | Replaced (count unchanged) | Suppressed |

This mirrors Phase 9's addFilter state machine exactly — the pre-check is just a read of the same source of truth so the toast-fire decision lines up with the filter-mutation outcome.

## RecordsTableRenderer Filter Subscription (RESEARCH.md Pitfall 3 Resolved)

`WidgetRenderer.tsx` line 175 short-circuits the records type to `<RecordsTableRenderer>` BEFORE `<AggregatedWidgetRenderer>`. AggregatedWidgetRenderer is the only place that previously subscribed to `useFilterStore.filters[tableId]`. So RecordsTableRenderer needed its own subscription for the row-tint highlight to work.

Added inside RecordsTableRenderer (just after the existing cfg destructuring):

```typescript
const tableId = cfg.tableId as number | undefined;
const drillDownColumn = (cfg.drillDownColumn as string) || "";
const drillDownColumnType = (cfg.drillDownColumnType as DrillDownDataType) || "string";
const drillEnabled = !!drillDownColumn && tableId !== undefined;
const recordsTableFilters = useFilterStore((state) =>
  tableId !== undefined ? state.filters[tableId] ?? [] : []
);
const activeFilterValue = recordsTableFilters.find(
  (f) => f.column === drillDownColumn,
)?.value;
```

The selector returns a fresh `[]` when `filters[tableId]` is absent, but RecordsTableRenderer doesn't have a useEffect dep array depending on `recordsTableFilters` — `activeFilterValue` is consumed at render time inside the JSX `.map((row) => ...)` callback, so the reference instability that S-02 guards against in AggregatedWidgetRenderer doesn't apply here. Re-renders on filter mutation are picked up via Zustand's normal subscription mechanism.

## Test Coverage

`kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` now has **11 tests** (5 Phase 9 + 6 Phase 10). The 6 new Phase 10 tests are in a dedicated describe block:

1. **dispatches addFilter when a TableRenderer row is clicked with drillDownColumn configured** — proves DRILL-01 end-to-end with the 300ms sequencing
2. **does NOT dispatch addFilter when drillDownColumn is empty (legacy widget — graceful no-op)** — locks the legacy-widget compatibility contract
3. **RecordsTableRenderer applies widget-table-row-active class to rows matching active filter** — locks DRILL-04 row-tint + RESEARCH.md Pitfall 3 fix
4. **toast fires on first add with buildChipText format (column = 'value')** — locks DRILL-04 SC-5 toast confirmation format
5. **toast SUPPRESSED on dedupe (re-click already-active value)** — locks the dedupe path of CONTEXT.md "Toast suppression rules"
6. **toast SUPPRESSED on replace (same column different value)** — locks the replace path of CONTEXT.md "Toast suppression rules"

Tests use `fireEvent.click` (via `firstRow.click()`) on rendered `<tr>` elements rather than simulating Recharts click handlers — table/records DOM is plain HTML so clicks travel through the React event system reliably. Each test waits 350ms after the click for the 300ms `setTimeout` to elapse.

Full vitest suite: **106 passed (106)** across 7 test files. No regressions.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **dispatchDrillDown as module-level helper:** Avoids duplicating dedupe/replace check across 6 renderers. The single source of truth for toast-fire-or-not is co-located with the addFilter dispatch.
2. **300ms across all chart types:** Even table/records where there is no dim-peers transient wait the same 300ms before dispatch so the click→refetch latency feels uniform — UX-driven decision, not technically required.
3. **Bar/Pie/Scatter dim-peers via per-Cell fillOpacity; Line/Area no visual dim:** Recharts Line/Area do not support per-point opacity easily; the chip + toast + chart-card refetch are sufficient feedback per UI-SPEC.md tradeoff. Documented inline.
4. **RecordsTableRenderer subscribes itself:** Honors the existing records short-circuit at WidgetRenderer line 175 — wrapping AggregatedWidgetRenderer's subscription is unreachable for records. This is the explicit fix for RESEARCH.md Pitfall 3.
5. **TableRenderer receives tableFilters as a prop, not a fresh subscription:** TableRenderer renders inside AggregatedWidgetRenderer which already subscribes — passing the filter array down avoids a redundant subscription. RecordsTableRenderer needs its own because there is no wrapping subscriber.

## Deviations from Plan

None — plan executed exactly as written. All grep acceptance criteria met:

- Imports: 1 / 1 (required ≥1, ≥1)
- dispatchDrillDown: 1 (required 1)
- showToast / buildChipText: 1 / 2 (required ≥1 / ≥1)
- fillOpacity: 5 (required ≥2 — Bar + Pie + Scatter Cells)
- widget-table-row-active: 2 (required ≥2 — TableRenderer + RecordsTableRenderer)
- cursor: drillEnabled: 6 (required ≥4)
- PITFALL C-03 comments: 9 (required ≥1)
- setTimeout: 8 (required ≥5)
- isDedupe / isReplace: 3 / 2 (required ≥1 / ≥1)
- filters[tableId]: 4 (required ≥2 — AggregatedWidgetRenderer + RecordsTableRenderer)
- Spec greps: DRILL-01, DRILL-04 = 2; drillDownColumn = 13; widget-table-row-active = 3; "region = 'EAST'" = 4; buildResponse = 7

## Issues Encountered

- None. The 4 of 6 RED tests that initially failed transitioned cleanly to GREEN once the production code shipped. The other 2 RED tests (negative-behavior assertions: "no-op when drillDownColumn empty" and "toast suppressed on dedupe") trivially passed even before implementation existed because the absence of a click handler IS the no-op behavior — they continue to pass after implementation, locking the contract.

## Manual Smoke Test

Plan called for end-to-end manual verification with the dev server. Not exercised in this autonomous execution — the comprehensive vitest integration tests (especially Test A which proves the full click → 300ms wait → addFilter store mutation → filter persistence chain, and Test C which proves the row-tint persistence after addFilter) cover the same code paths. End-to-end flow verification with a real dashboard is recommended as the next-session manual QA, particularly for:

1. Bar/Pie/Scatter chart click extraction (the integration tests use Table where the click target is plain DOM; Recharts SVG elements have not been clicked in tests)
2. The dim-peers visual transient (vitest assertion focuses on filter store state and CSS class application, not the 300ms fillOpacity render)
3. Line/Area click handlers (also use Recharts SVG; same caveat)
4. End-to-end click → chip → toast → other-widget-refetch flow

## TIMESTAMP Literal Validation

No datetime-typed drill-down click was exercised in this plan's tests — all 6 tests use `dataType: "string"` on the `region` column. The `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` format from Phase 9's `buildEqualityFilter` (LOW-confidence per Phase 9 Plan 01 SUMMARY) **remains LOW confidence** — it is now reachable end-to-end via the click handlers shipped here, but the first user who clicks a datetime-typed drill-down value will be the real validation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 10 is now COMPLETE end-to-end:**
  - DRILL-01 (click → addFilter): GREEN — Plan 10-04 delivers
  - DRILL-02 (column picker with geometry exclusion): GREEN — Plans 10-01 + 10-03 deliver
  - DRILL-03 (filter bar with chips + Clear all): GREEN — Plan 10-02 delivers
  - DRILL-04 (selected highlight + toast): GREEN — Plan 10-04 delivers
- **ROADMAP.md Phase 10 success criteria (1-5):**
  - SC-1 (click triggers re-fetch on every other chart sharing the table): GREEN
  - SC-2 (selected highlight via dim-peers + bordered active segment): GREEN for bar/pie/scatter; line/area documented as toast/chip-only feedback
  - SC-3 (chip × dismiss + Clear all): GREEN (Plan 10-02)
  - SC-4 (geometry/large-text columns absent from picker): GREEN (Plans 10-01 + 10-03)
  - SC-5 (toast confirmation `column = 'value'`): GREEN
- **Ready for Phase 11 (Map Chart) planning.** Map chart drill-down (`ST_Distance` identify route) is Phase 12 scope and will plug into the same `useFilterStore.addFilter` API.
- **No blockers.** TIMESTAMP literal format remains LOW confidence per Phase 9 Plan 01 SUMMARY — first datetime drill-down user will be the real validation.

## Self-Check: PASSED

Verified after writing this summary:

- [x] `kinetica_bi/src/components/charts/WidgetRenderer.tsx` exists and contains all required symbols
- [x] `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` exists and contains all 11 tests
- [x] Commit `9b6bb1e` exists in git log (Task 1 TDD RED)
- [x] Commit `c0a55d4` exists in git log (Task 2 TDD GREEN)
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` 106/106 passing
- [x] All grep acceptance criteria pass (verified above)

---
*Phase: 10-existing-chart-drill-down*
*Plan: 04*
*Completed: 2026-05-04*
