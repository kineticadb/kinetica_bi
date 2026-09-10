---
phase: 44-data-filter-widget
verified: 2026-05-28T20:18:00Z
status: passed
human_verification_outcome: approved by operator 2026-05-28 (6/6 live UAT items confirmed in-session)
score: 17/17 must-haves verified
re_verification: false
human_verification:
  - test: "Apply a Data Filter widget with a string IN field (e.g. region IN ['EAST','WEST']) and verify every co-table widget (bar, table, records) re-queries and shows only filtered rows"
    expected: "Dashboard narrows all widgets on the same table within ~300ms of pressing Apply; FilterBar shows chip `region in ('EAST', 'WEST')`"
    why_human: "End-to-end materialize pipeline over a live Kinetica connection; vitest mocks setBulkFilters and markMaterializing — actual DDL emission and view creation require a running server + Kinetica"
  - test: "Apply a numeric BETWEEN filter (e.g. fare between 5 and 50) and verify the materialized view DDL contains the correct BETWEEN clause"
    expected: "WHERE clause in the CREATE MATERIALIZED VIEW DDL reads `fare BETWEEN 5 AND 50`; downstream widgets show only rows in that range"
    why_human: "Datetime BETWEEN on Kinetica confirmed LOW confidence in RESEARCH.md §B — UAT required to confirm single-quoted ISO literals work on DATETIME columns with BETWEEN predicate"
  - test: "Dismiss a FilterBar chip for one column owned by a Data Filter widget; verify the widget's per-field indicator goes from applied (●) to not-applied without a page reload"
    expected: "After clicking ×, the field row for that column no longer shows the applied badge; other configured fields remain unchanged"
    why_human: "Reactive Zustand subscription tested in spec but visual badge rendering and chip-dismissal UX must be confirmed in-browser"
  - test: "Reload the dashboard after configuring a Data Filter widget (via ChartConfigPanel save); verify the config is persisted and the widget re-renders with the correct filter fields"
    expected: "After reload, widget shows the configured columns and kinds; controls are in their initial (no filter applied) state until Apply is pressed"
    why_human: "Config persistence (widget.config PATCH round-trip) not exercised by unit tests; requires live dashboard save + page reload"
  - test: "Press Clear on a Data Filter widget that has applied filters; verify FilterBar chips for those columns disappear and downstream widgets show unfiltered data"
    expected: "clearFilters(tableId) fires, chips disappear from FilterBar, all co-table widgets re-query against the unfiltered base table"
    why_human: "clearFilters removes ALL filters for tableId (including drill-down chips); side-effect documented but operator experience must be confirmed live"
  - test: "Add a Data Filter widget via the visualization picker; verify 'Data Filter' appears as a selectable type with icon 'DF'"
    expected: "Picker modal shows 'Data Filter' entry; selecting it creates a widget with the config panel visible and no pre-configured fields"
    why_human: "Visualization picker modal renders getAllChartTypes() — needs live browser to confirm label + icon render correctly"
---

# Phase 44: Data Filter Widget — Verification Report

**Phase Goal:** Ship a new dashboard widget type `datafilter` that lets operators configure N filter fields per widget (one per column) with per-column-type controls (string text/IN/dropdown/multi-select, numeric value/range, date single/range, boolean tri-toggle), dispatch into the existing `useFilterStore` via a new `setBulkFilters` action, and extend `ActiveFilter` + server `buildServerWhereClause` to support `IN` and `BETWEEN` operators so the v1.3 transient materialized-view pipeline narrows every widget on the same table.

**Verified:** 2026-05-28T20:18:00Z
**Status:** HUMAN NEEDED (all automated checks pass; 6 live UAT items remain)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ActiveFilter accepts optional `operator?: "eq"\|"in"\|"between"\|"isNull"` discriminator (default "eq") | VERIFIED | `filterStore.ts:37` — exact type declaration; `whereClause.ts:51` — server mirror |
| 2 | ActiveFilter.value union carries `(string\|number)[]` for IN and `[number,number]\|[string,string]` for BETWEEN | VERIFIED | `filterStore.ts:22-30` — full union; `whereClause.ts:42-49` — server mirror |
| 3 | `setBulkFilters` replaces N column filters in ONE `set()` call with ONE `filterVersion` increment | VERIFIED | `filterStore.ts:103-134` — single `set()` at line 103; `filterVersion: state.filterVersion + 1` at line 132 |
| 4 | `buildServerWhereClause` emits `col IN ('a','b')` with proper per-element escaping | VERIFIED | `whereClause.ts:93-110`; 11 passing whereClause spec tests for IN operator |
| 5 | `buildServerWhereClause` emits `col BETWEEN x AND y` (numeric) and `col BETWEEN 'lo' AND 'hi'` (datetime/string) | VERIFIED | `whereClause.ts:113-126`; 3 passing BETWEEN spec tests |
| 6 | Empty IN array emits `1=0` (defense-in-depth); widget layer also skips empty IN before dispatch | VERIFIED | `whereClause.ts:99` — `return "1=0"`; `DataFilterRenderer.tsx` Apply handler skips text-in empty array and multi-select empty array |
| 7 | Existing drill-down ActiveFilter literals (no operator field) still produce `col = 'value'` SQL | VERIFIED | `whereClause.ts:90` — `const op = f.operator ?? "eq"`; back-compat spec test passes; WidgetRenderer.spec.tsx static assertion (test 3 in Phase 44 describe block) confirms no `operator:` key in `dispatchDrillDown` body |
| 8 | FilterBar chip text shows `region in ('EAST', 'WEST')` and `fare between 5 and 50` | VERIFIED | `columnTypes.ts:107-121` — IN and BETWEEN branches; `DashboardsPage.tsx:797` imports `buildChipText` from columnTypes (no local copy) |
| 9 | `/api/top-values` accepts `n` up to 1000 (was 256) | VERIFIED | `server/src/index.ts:932` — `body.n > 1000`; error message `"n must be integer in [2, 1000]."` at line 936. `/api/quantile` still caps at 256 (correct per plan scope) |
| 10 | Filter cap is 25 per table (was 10) | VERIFIED | `filterStore.ts:15` — `export const FILTER_CAP_PER_TABLE = 25` |
| 11 | `datafilter` chart type registered with `label: "Data Filter"`, `usesDataSource: false`, `CustomConfigPanel: DataFilterConfigPanel` | VERIFIED | `definitions/data-filter.ts:19-31`; `definitions/index.ts:35` — `registerDataFilter()` called |
| 12 | `DataFilterConfigPanel` excludes WKT/geometry/large-text columns via `isColumnDrillDownSafe` | VERIFIED | `DataFilterConfigPanel.tsx:9,27,102` — imports and filters via `isColumnDrillDownSafe` |
| 13 | `DataFilterRenderer` fetches value universes from BASE TABLE (not filter view) using `topValuesFn`/`columnStatsFn` with `schemaName.baseTableName` parsed from `config.tableRef` | VERIFIED | `DataFilterRenderer.tsx:83-84` — `(tableRef ?? ".").split(".")`; calls at lines 160-161 and 171-172 use `{schema: schemaName, table: baseTableName}` |
| 14 | Apply dispatches `setBulkFilters` then `markMaterializing` synchronously (Phase 17-03 lock) | VERIFIED | `DataFilterRenderer.tsx:297,301` — exact sequence; spec test 17 asserts call order `["setBulkFilters", "markMaterializing"]` |
| 15 | `DataFilterRenderer` subscribes to scoped `useFilterStore((s) => s.filters[tableId] ?? [])` selector (PITFALL C-02) | VERIFIED | `DataFilterRenderer.tsx:119` — exact selector |
| 16 | `WidgetRenderer.tsx` short-circuits `widget.type === "datafilter"` BEFORE `AggregatedWidgetRenderer` fallback | VERIFIED | `WidgetRenderer.tsx:249-256` — `else if (widget.type === "datafilter")` branch after legend, before else |
| 17 | `DataFilterRenderer` does NOT import or call `materializeFilter` (sole-trigger invariant) | VERIFIED | `grep -c "materializeFilter" DataFilterRenderer.tsx` returns 0; static spec assertion in `DataFilterRenderer.spec.tsx` test 22 enforces this on every CI run |

**Score: 17/17 truths verified**

---

## Critical Invariant Results

| Invariant | Result | Evidence |
|-----------|--------|----------|
| Sole materialize trigger: `DataFilterRenderer` has 0 `materializeFilter` references | PASS | `grep -c "materializeFilter" DataFilterRenderer.tsx` = 0 |
| Drill-down back-compat: `dispatchDrillDown` ActiveFilter literal has NO `operator:` key | PASS | `grep -n "operator:" WidgetRenderer.tsx` = 0 matches; static spec assertion in `WidgetRenderer.spec.tsx` Phase 44 describe block (test 3) |
| Empty IN defense-in-depth: `whereClause.ts` emits `1=0` for empty array AND widget renderer skips empty IN before dispatch | PASS | `whereClause.ts:99`; `DataFilterRenderer.tsx` Apply skips text-in/multi-select empty arrays |
| WKT/geometry exclusion: `DataFilterConfigPanel.tsx` imports and uses `isColumnDrillDownSafe` | PASS | `DataFilterConfigPanel.tsx:27,102` — imported and used as column picker filter |
| `setBulkFilters` single tick: exactly ONE `set()` call with `filterVersion: state.filterVersion + 1` | PASS | `filterStore.ts:103-134` — single `set()` wrapper; `filterVersion: state.filterVersion + 1` at line 132 only within setBulkFilters body |
| Base-table value universes: `DataFilterRenderer` calls `topValuesFn`/`columnStatsFn` with base table (not filter view) | PASS | `DataFilterRenderer.tsx:83-84,160-161,171-172` — uses `schemaName`/`baseTableName` from `config.tableRef.split(".")` |
| Visualization picker shows "Data Filter": `data-filter.ts` registers `type: "datafilter"`, `label: "Data Filter"`; `index.ts` calls `registerDataFilter()` | PASS | `data-filter.ts:20-21`; `definitions/index.ts:35` |
| Filter cap raised to 25: `FILTER_CAP_PER_TABLE` constant = 25 | PASS | `filterStore.ts:15` |
| Top-values cap raised to 1000: server route validates `n ≤ 1000` | PASS | `server/src/index.ts:932` (`body.n > 1000`); message at line 936 |

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `kinetica_bi/src/store/filterStore.ts` | VERIFIED | ActiveFilter type extended, `setBulkFilters` action, `FILTER_CAP_PER_TABLE = 25` |
| `kinetica_bi/server/src/lib/whereClause.ts` | VERIFIED | Server ActiveFilter mirror, IN + BETWEEN emission, empty-IN → `1=0` |
| `kinetica_bi/src/lib/columnTypes.ts` | VERIFIED | `buildChipText` extended with `operator` 4th param, in/between display branches |
| `kinetica_bi/src/components/DashboardsPage.tsx` | VERIFIED | Local `chipText` deleted; `buildChipText` imported and called at line 797 |
| `kinetica_bi/server/src/index.ts` | VERIFIED | `/api/top-values` cap at 1000; `/api/quantile` intentionally left at 256 |
| `kinetica_bi/src/components/charts/definitions/data-filter.ts` | VERIFIED | Full `ChartTypeDefinition` with `type: "datafilter"`, `label: "Data Filter"`, `usesDataSource: false`, `CustomConfigPanel: DataFilterConfigPanel` |
| `kinetica_bi/src/components/charts/definitions/index.ts` | VERIFIED | `registerDataFilter()` called at line 35 |
| `kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` | VERIFIED | N-row builder, base-table picker, `isColumnDrillDownSafe` column exclusion, per-kind mapping |
| `kinetica_bi/src/components/charts/DataFilterRenderer.tsx` | VERIFIED | 9 per-kind controls, Apply (setBulkFilters + markMaterializing), Clear (clearFilters), mount-time fetch, chip-dismissal sync, 0 materializeFilter references |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx` | VERIFIED | Short-circuit branch at lines 249-256; `dispatchDrillDown` body unchanged |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `DataFilterRenderer` Apply handler | `AggregatedWidgetRenderer` Effect 1 (materialize) | `setBulkFilters` → `filterVersion + 1` → Effect 1 dep array | WIRED | `filterStore.ts:132`; `DataFilterRenderer.tsx:297` |
| `DataFilterRenderer` Apply handler | `useFilterViewStore.markMaterializing` | Synchronous call after `setBulkFilters` | WIRED | `DataFilterRenderer.tsx:301` |
| `buildServerWhereClause` IN path | `POST /api/filter/materialize` DDL | `composeWhereClause` interpolates `buildServerWhereClause` verbatim into AND chain | WIRED | `whereClause.ts:110`; 3 filter-materialize integration tests pass (including IN + BETWEEN DDL assertions) |
| `DashboardsPage` chip rendering | `buildChipText` (single source of truth) | Import at line 53; call at line 797 with `f.operator` 4th arg | WIRED | Local `chipText` deleted; `buildChipText` imported from `../lib/columnTypes` |
| `DataFilterConfigPanel` column picker | `isColumnDrillDownSafe` exclusion | Import at line 27; filter at line 102 | WIRED | WKT/geometry/blob/bytes/text/point columns excluded from picker |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FILTER-V17-01 | 44-01 | ActiveFilter operator discriminator + widened value union (client + server) | SATISFIED | `filterStore.ts:17-40`; `whereClause.ts:39-54` |
| FILTER-V17-02 | 44-01 | `setBulkFilters` action — single filterVersion tick for N column replacements | SATISFIED | `filterStore.ts:53,103-134` |
| FILTER-V17-03 | 44-01 | `FILTER_CAP_PER_TABLE` raised 10→25 | SATISFIED | `filterStore.ts:15` |
| FILTER-V17-04 | 44-01 | `buildServerWhereClause` emits IN + BETWEEN; empty IN → `1=0`; eq/isNull preserved | SATISFIED | `whereClause.ts:86-147`; 27 whereClause spec tests pass |
| FILTER-V17-05 | 44-01 | `buildChipText` extended for in/between; DashboardsPage local `chipText` deleted | SATISFIED | `columnTypes.ts:105-121`; `DashboardsPage.tsx:53,797` |
| FILTER-V17-06 | 44-01 | `/api/top-values` n cap raised 256→1000 | SATISFIED | `server/src/index.ts:932,936` |
| FILTER-V17-07 | 44-02 | `datafilter` chart type registered | SATISFIED | `definitions/data-filter.ts`; `definitions/index.ts:35` |
| FILTER-V17-08 | 44-02 | `DataFilterConfigPanel` with base-table picker + N-row field builder + per-type kind mapping | SATISFIED | `DataFilterConfigPanel.tsx` — all 19 spec tests pass |
| FILTER-V17-09 | 44-02 | Column picker excludes WKT/WKB/geometry/point/text/blob/bytes via `isColumnDrillDownSafe` | SATISFIED | `DataFilterConfigPanel.tsx:27,102`; spec test 7 asserts 4 excluded types absent |
| FILTER-V17-10 | 44-02 | Persisted config shape `{tableId, tableRef, filterFields}`; table change clears filterFields; `isValid` signaling | SATISFIED | `DataFilterConfigPanel.tsx` — onChange emits correct shape; spec tests 1-3 cover table change reset and isValid |
| FILTER-V17-11 | 44-03 | `DataFilterRenderer` with 9 per-kind controls; mount-time topValuesFn/columnStatsFn from BASE TABLE | SATISFIED | `DataFilterRenderer.tsx:139-203`; `schemaName.baseTableName` from `config.tableRef` split |
| FILTER-V17-12 | 44-03 | Apply builds `ActiveFilter[]` batch; `setBulkFilters` ONE tick; empty/partial fields SKIPPED | SATISFIED | `DataFilterRenderer.tsx:265-305`; spec tests covering skip paths for each kind |
| FILTER-V17-13 | 44-03 | Clear calls `clearFilters(tableId)` + resets staged values | SATISFIED | `DataFilterRenderer.tsx:308-315`; spec test for Clear |
| FILTER-V17-14 | 44-03 | Scoped `useFilterStore` subscription for chip-dismissal sync | SATISFIED | `DataFilterRenderer.tsx:119`; spec test for `removeFilter` sync |
| FILTER-V17-15 | 44-03 | `markMaterializing` synchronous after `setBulkFilters` (Phase 17-03 lock) | SATISFIED | `DataFilterRenderer.tsx:297,301`; spec test 17 asserts call order |
| FILTER-V17-16 | 44-03 | `WidgetRenderer` short-circuit for `type === "datafilter"` before `AggregatedWidgetRenderer` | SATISFIED | `WidgetRenderer.tsx:249-256`; 3 Phase 44 spec tests |
| FILTER-V17-17 | 44-03 | `DataFilterRenderer` has zero `materializeFilter` references (sole-trigger invariant) | SATISFIED | `grep -c "materializeFilter" DataFilterRenderer.tsx` = 0; static spec assertion |

**17/17 requirements satisfied**

---

## Test Gate Results

| Gate | Claimed | Actual | Result |
|------|---------|--------|--------|
| Frontend vitest (full suite) | 1389/1389 | 1389/1389 | PASS |
| Server vitest (whereClause + filter-materialize targeted) | 54/54 | 54/54 | PASS |
| Server vitest (full suite) | 54/54 | 106 failures (13 files) in pre-existing TD-V16-TEST-ISOLATION suites (oidc, auth-mode cross-test) | NOTE — pre-existing red; NOT Phase 44 regressions |
| Frontend tsc production files | 0 errors | 0 production errors (spec file node-type errors are pre-existing) | PASS |
| Server tsc | 0 errors | 0 errors | PASS |

**Test gate note:** The server vitest full-suite 106 failures are in OIDC, auth-mode isolation, and WMS spec files — documented carry-forward as `TD-V16-TEST-ISOLATION`. The REQUIREMENTS.md test gate spec (VERIFY-V17-05) explicitly acknowledges this: "NOT server vitest, per TD-V16-TEST-ISOLATION carry." The targeted Phase 44 server specs (54 tests across `lib.whereClause.spec.ts` + `routes.filter-materialize.spec.ts`) pass 54/54.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `DataFilterRenderer.spec.tsx` | N/A | `act()` warning for `renders a warning row for a configured column` test | INFO | React test warning — test still passes; not a production code issue |

No blocker or warning anti-patterns found in production source files.

---

## Human Verification Required

### 1. String IN filter end-to-end materialize

**Test:** Add a `datafilter` widget on a table. Configure a string column as `multi-select`. Select 2 values. Press Apply.
**Expected:** FilterBar shows chip `<column> in ('<val1>', '<val2>')`; all co-table widgets (bar, table, records) re-query and display only the 2 selected values within ~300ms.
**Why human:** Full materialize pipeline (DDL CREATE + Kinetica execute + view swap) requires a live Kinetica instance.

### 2. Date BETWEEN Kinetica compatibility

**Test:** Configure a `datafilter` with a date column as `date-range`. Set a from/to range. Press Apply.
**Expected:** Materialized view DDL contains `<column> BETWEEN '<lo>' AND '<hi>'`; downstream widgets show only rows in range.
**Why human:** RESEARCH.md §B flags Kinetica BETWEEN on DATETIME as LOW confidence — UAT required. Fallback noted: `col >= 'min' AND col <= 'max'` if single-quoted BETWEEN fails.

### 3. Chip dismissal visual sync

**Test:** Apply a Data Filter with 2 columns active. Click × on one chip in the FilterBar.
**Expected:** The widget's field row for that column shows no applied badge (●); the other column remains applied; downstream widgets re-query.
**Why human:** Reactive Zustand subscription verified in unit test, but visual badge rendering requires in-browser confirmation.

### 4. Config persistence across reload

**Test:** Configure a Data Filter widget (table + 3 filter fields). Save. Reload the dashboard.
**Expected:** Widget re-renders with all 3 configured fields; controls are in initial (no filter applied) state.
**Why human:** PATCH persistence + dashboard load round-trip not covered by unit tests.

### 5. Clear side-effect transparency

**Test:** Have both a Data Filter widget and drill-down chips active on the same table. Press Clear on the Data Filter widget.
**Expected:** ALL chips for that tableId disappear (documented side-effect); operator is aware that drill-down chips are also cleared.
**Why human:** UX impact (clearing drill-down chips as a side effect of Clear) must be confirmed acceptable in live use.

### 6. Visualization picker renders "Data Filter"

**Test:** Open the Add Widget modal. Look for the "Data Filter" entry with icon "DF".
**Expected:** Entry visible, selectable; clicking it creates a widget with the config panel open and no pre-configured fields.
**Why human:** Picker modal rendering of `getAllChartTypes()` requires live browser.

---

## Commit Evidence

All 7 Phase 44 task commits confirmed in git history:
- `471ae9d` feat(44-01): extend ActiveFilter type + setBulkFilters + raise filter cap to 25
- `7aa947c` feat(44-01): extend buildServerWhereClause for IN + BETWEEN operators
- `340a7a7` feat(44-01): consolidate chipText + extend buildChipText for in/between + raise top-values cap
- `8cd14a7` feat(44-02): register datafilter chart type with usesDataSource:false
- `cfa65e1` feat(44-02): DataFilterConfigPanel — base-table picker + N-row filter-field builder
- `85c63db` feat(44-03): DataFilterRenderer — per-kind controls + Apply/Clear + mount-time fetch + chip-dismissal sync
- `1b19525` feat(44-03): WidgetRenderer datafilter short-circuit + drill-down regression coverage

---

_Verified: 2026-05-28T20:18:00Z_
_Verifier: Claude (gsd-verifier)_
