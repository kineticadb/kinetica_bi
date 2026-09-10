---
phase: 45-timeline-chart-widget
verified: 2026-05-29T17:30:00Z
status: human_needed
score: 11/11 must-haves verified
re_verification: false
human_verification:
  - test: "Drag horizontal range on a live TimelineRenderer chart with a real Kinetica table"
    expected: "Mouse-up emits a FilterBar chip showing '<col> between <iso-from> and <iso-to>'; all widgets on the same table narrow; timeline itself re-bins on the narrower range"
    why_human: "Recharts onMouseDown/Move/Up fire on JSDOM but actual pixel-to-activeLabel translation requires a live browser with real layout dimensions"
  - test: "Multi-axis visual render with 3 or 4 metrics in a real browser"
    expected: "Left and right YAxes visible and colored to match their respective Line; stacked outer axes (M3 left-of-M1, M4 right-of-M2) spaced correctly by margin"
    why_human: "Recharts SVG layout is dimension-dependent; JSDOM renders 0x0 for ResponsiveContainer so axis DOM cannot be verified programmatically"
  - test: "Persistent ReferenceArea band after drag-to-filter commit"
    expected: "A shaded blue band appears over the dragged time range and persists until the FilterBar chip is dismissed; band disappears synchronously on chip x click"
    why_human: "Band x1/x2 must match exact bucket strings in data; alignment can only be confirmed visually in a live browser with real data"
  - test: "Sub-hour intervals in live SQL (5min / 15min / 30min / 6h / 12h) via FLOOR-epoch"
    expected: "DATE_TRUNC does not throw; FLOOR(EXTRACT(EPOCH FROM col) / N) * N buckets correctly on deployed Kinetica instance"
    why_human: "RESEARCH.md rates FLOOR-epoch syntax MEDIUM confidence — not confirmed on deployed Kinetica version; requires a live runSql call"
  - test: "Single-metric widget renders only a left YAxis (no blank right-side space)"
    expected: "Only one YAxis element visible; no empty reserved space on the right"
    why_human: "Conditional axis rendering requires live Recharts SVG output to confirm no blank right margin"
  - test: "DV-bound timeline widget (dynamic view selected in config panel)"
    expected: "Queries emit unprefixed FROM <viewName>; timeline re-bins over the filtered materialized view on filter change"
    why_human: "Requires a live Kinetica instance with a configured Dynamic View and a materialized view to test the effectiveSchema=''/effectiveTable path"
---

# Phase 45: Timeline Chart Widget Verification Report

**Phase Goal:** Ship a new dashboard widget type `timeline` — multi-metric line chart over time (up to 4 metrics, each with its own y-axis), auto-binning by time interval from a fixed ladder, drag-to-filter emitting a BETWEEN filter via `useFilterStore.setBulkFilters`, persistent ReferenceArea band from filter store, color theme palette (Set2 default) + per-line override, DV-aware data source.

**Verified:** 2026-05-29T17:30:00Z
**Status:** HUMAN NEEDED (all automated checks pass; 6 live UAT items require a browser + Kinetica instance)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `timeline` chart type registered in `definitions/timeline.ts` + `definitions/index.ts` | VERIFIED | `timeline.ts:24` `type: "timeline"`, `timeline.ts:25` `label: "Timeline Chart"`, `index.ts:22+37` `import registerTimeline` + `registerTimeline()` call |
| 2 | `WidgetRenderer.tsx` short-circuits `type === "timeline"` to `TimelineRenderer` before `AggregatedWidgetRenderer` | VERIFIED | `WidgetRenderer.tsx:258-263` — `else if (widget.type === "timeline") body = <TimelineRenderer ...>` placed after datafilter branch, before else fallback |
| 3 | `TimelineConfigPanel` renders base-table picker + datetime-only time-col picker + max-4 metric builder + options | VERIFIED | `TimelineConfigPanel.tsx:99` filters `inferDataTypeFromColumn === "datetime"`; `TimelineConfigPanel.tsx:110` filters `=== "number" && isColumnDrillDownSafe`; `MAX_METRICS=4` at line 28; Add-metric button `disabled={metrics.length >= MAX_METRICS}` at line 334 |
| 4 | Auto-bin `pickInterval` walks DATE_TRUNC-native ladder coarsest→finest, returns finest that fits `maxIntervals` cap | VERIFIED | `timelineBin.ts:92-108` — scans `dateTrunc !== null` entries, tracks `best` (last match = finest), falls back to minute. 12-entry INTERVAL_LADDER at lines 59-72 |
| 5 | `buildTimelineSql` emits DATE_TRUNC for native intervals; FLOOR-epoch for sub-hour intervals | VERIFIED | `timelineBin.ts:125-131` — `DATE_TRUNC('<dateTrunc>', col)` when `dateTrunc` non-null; `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N)` otherwise. `buildTimelineSql.ts:52-67` uses `buildTimelineBucket` + `fromTarget` pattern |
| 6 | Multi-axis Recharts LineChart with alternating left/right YAxis + matching per-line colors | VERIFIED (source contract) | `TimelineRenderer.tsx:62-63` — `AXIS_ORIENTATIONS=["left","right","left","right"]`, `AXIS_IDS=["m0","m1","m2","m3"]`; lines 350-372 map metrics to `<YAxis stroke={toCssColor(m.color)}>` + `<Line stroke={toCssColor(m.color)}>` |
| 7 | Drag-to-filter dispatches `setBulkFilters` + `markMaterializing` on mouseUp; click-no-drag suppressed | VERIFIED | `TimelineRenderer.tsx:270-282` — `commitFilter` with exact `operator: "between"` / `dataType: "datetime"` / `column: timeCol` / `value: [from, to] as [string, string]` / `setBulkFilters` + `markMaterializing`; line 327 `dragStart !== end` guard |
| 8 | Persistent `ReferenceArea` band from `useFilterStore.filters[tableId]` BETWEEN subscription | VERIFIED | `TimelineRenderer.tsx:152` — `useFilterStore((s) => s.filters[tableId] ?? [])`; lines 155-162 `useMemo` finds BETWEEN filter on `timeCol`; lines 390-398 `{appliedBand && <ReferenceArea x1=... x2=...>}` |
| 9 | Default color theme = `"Set2"`; Y-axis tick + axis line match line color | VERIFIED | `TimelineConfigPanel.tsx:29` — `export const DEFAULT_COLOR_THEME = "Set2"`; `TimelineRenderer.tsx:356` — `<YAxis stroke={toCssColor(m.color)} tick={{ fill: toCssColor(m.color) }}>` |
| 10 | Time-range fetch uses `EXTRACT(EPOCH FROM MIN/MAX)` via `runSql`, not `columnStatsFn`; DV-bound honored | VERIFIED | `timelineBin.ts:157-160` — `SELECT EXTRACT(EPOCH FROM MIN(...)) AS lo, EXTRACT(EPOCH FROM MAX(...)) AS hi FROM <fromTarget>` with `fromTarget = schema === "" ? table : schema.table`; `TimelineRenderer.tsx:186-191` calls `runSql(buildTimelineRangeQuery(...))` |
| 11 | Sole-materialize-trigger invariant preserved — `TimelineRenderer.tsx` contains 0 references to `materializeFilter` | VERIFIED | `grep -c "materializeFilter" TimelineRenderer.tsx` = **0** |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `kinetica_bi/src/lib/timelineBin.ts` | INTERVAL_LADDER + pickInterval + buildTimelineBucket + buildTimelineRangeQuery + types | VERIFIED | 162 lines; all exports confirmed present |
| `kinetica_bi/src/lib/timelineBin.spec.ts` | 12 unit tests for ladder selection | VERIFIED | 127 lines; 12 tests confirmed passing |
| `kinetica_bi/src/lib/buildTimelineSql.ts` | Per-metric SQL builder with DATE_TRUNC + FLOOR-epoch | VERIFIED | 67 lines; imports from timelineBin confirmed |
| `kinetica_bi/src/lib/buildTimelineSql.spec.ts` | 9 unit tests for SQL shape | VERIFIED | 147 lines; 9 tests confirmed passing |
| `kinetica_bi/src/components/charts/definitions/timeline.ts` | registerTimeline() with full ChartTypeDefinition | VERIFIED | 45 lines; `type:"timeline"`, `label:"Timeline Chart"`, `usesDataSource:false`, `CustomConfigPanel:TimelineConfigPanel` |
| `kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` | CustomConfigPanel with all 4 sections | VERIFIED | 409 lines; datetime/number column filtering, MAX_METRICS=4, DEFAULT_COLOR_THEME="Set2" |
| `kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx` | 10 config panel specs | VERIFIED | 155 lines; 10 tests confirmed passing |
| `kinetica_bi/src/components/charts/TimelineRenderer.tsx` | Full renderer — data fetch + multi-axis + drag-to-filter | VERIFIED | 404 lines (exceeds min_lines:250); all lifecycle components present |
| `kinetica_bi/src/components/charts/TimelineRenderer.spec.tsx` | 10 renderer specs | VERIFIED | 294 lines; 10 tests confirmed passing |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `WidgetRenderer.tsx` | `TimelineRenderer.tsx` | `else if (widget.type === "timeline")` | WIRED | Lines 258-263 confirm branch position after datafilter, before AggregatedWidgetRenderer |
| `definitions/index.ts` | `definitions/timeline.ts` | `import registerTimeline` + `registerTimeline()` | WIRED | Lines 22 + 37 in index.ts |
| `definitions/timeline.ts` | `TimelineConfigPanel.tsx` | `CustomConfigPanel: TimelineConfigPanel` | WIRED | `timeline.ts:16` import + `CustomConfigPanel` field wired |
| `TimelineConfigPanel.tsx` | `timelineBin.ts` | `import { TimelineMetric, TimelineAggregation, DEFAULT_MAX_INTERVALS }` | WIRED | `TimelineConfigPanel.tsx` imports from `../../lib/timelineBin` |
| `TimelineRenderer.tsx` | `filterStore.ts` | `useFilterStore.getState().setBulkFilters(tableId, [filter])` | WIRED | Line 280 in commitFilter; subscription at line 152 |
| `TimelineRenderer.tsx` | `filterViewStore.ts` | `useFilterViewStore.getState().markMaterializing(tableId, dashboardId)` | WIRED | Line 281 in commitFilter, synchronous after setBulkFilters |
| `TimelineRenderer.tsx` | `timelineBin.ts + buildTimelineSql.ts` | `import pickInterval + buildTimelineRangeQuery + buildTimelineSql` | WIRED | Lines 47-53 imports confirmed |
| `buildTimelineSql.ts` | `timelineBin.ts` | `import type { TimelineInterval, TimelineMetric }` | WIRED | Lines 13-14 in buildTimelineSql.ts |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TIMELINE-V17-01 | 45-02 | timeline chart type registered | SATISFIED | `definitions/timeline.ts` + `definitions/index.ts:37` `registerTimeline()` |
| TIMELINE-V17-02 | 45-03 | WidgetRenderer short-circuit branch | SATISFIED | `WidgetRenderer.tsx:258-263` — `else if (widget.type === "timeline")` |
| TIMELINE-V17-03 | 45-02 | TimelineConfigPanel CustomConfigPanel | SATISFIED | 409-line panel with all 4 sections; inferDataTypeFromColumn filtering confirmed |
| TIMELINE-V17-04 | 45-01 | Pure `timelineBin.ts` with INTERVAL_LADDER + pickInterval | SATISFIED | 12-entry ladder; `pickInterval` DATE_TRUNC-only scan; fallback to minute |
| TIMELINE-V17-05 | 45-01 | `buildTimelineSql` DATE_TRUNC + FLOOR-epoch | SATISFIED | Both paths in `buildTimelineBucket`; `buildTimelineSql` uses `buildTimelineBucket` |
| TIMELINE-V17-06 | 45-03 | Multi-axis Recharts LineChart | SATISFIED (source) | AXIS_ORIENTATIONS/AXIS_IDS constants + YAxis/Line mapping in render; UAT needed for visual confirmation |
| TIMELINE-V17-07 | 45-03 | Drag-to-filter with click-no-drag suppression | SATISFIED | commitFilter dispatches exact shape; `dragStart !== end` guard at line 327 |
| TIMELINE-V17-08 | 45-03 | Persistent ReferenceArea from filterStore | SATISFIED | `useFilterStore` scoped selector at line 152; appliedBand useMemo; ReferenceArea at lines 390-398 |
| TIMELINE-V17-09 | 45-03 | Per-line color from Set2 theme; Y-axis tick + axis line match | SATISFIED | `DEFAULT_COLOR_THEME="Set2"` exported; YAxis stroke+tick.fill and Line stroke all use `toCssColor(m.color)` |
| TIMELINE-V17-10 | 45-01 | Time-range fetch via EXTRACT(EPOCH) runSql; DV-bound empty-schema | SATISFIED | `buildTimelineRangeQuery` in timelineBin.ts lines 157-160; `fromTarget = schema === "" ? table : schema.table` |
| TIMELINE-V17-11 | 45-03 | Zero `materializeFilter` references in TimelineRenderer | SATISFIED | `grep -c` = 0 confirmed |

No orphaned requirements — all 11 TIMELINE-V17 IDs claimed by plans and evidenced in code.

---

### Critical Invariant Verification

| # | Invariant | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `materializeFilter` count in TimelineRenderer.tsx = 0 | PASS (0) | `grep -c "materializeFilter" TimelineRenderer.tsx` = 0 |
| 2 | Drag dispatch shape: `column: timeCol`, `operator: "between"`, `dataType: "datetime"`, `value: [from, to] as [string, string]`, `setBulkFilters`, `markMaterializing` | PASS | All 6 elements present at lines 273-281 |
| 3 | Click-no-drag suppression: `dragStart !== end` guard before dispatch | PASS | Line 327: `if (dragStart && end && dragStart !== end)` |
| 4 | DV-aware unprefixed FROM in both `buildTimelineRangeQuery` and `buildTimelineSql` | PASS | `timelineBin.ts:155` and `buildTimelineSql.ts:56` — both use `schema === "" ? table : schema.table` |
| 5 | Picker filters via `inferDataTypeFromColumn` with `=== "datetime"` and `=== "number"` | PASS | `TimelineConfigPanel.tsx:99` and `110` |
| 6 | Sub-hour SQL via `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N)` | PASS | `timelineBin.ts:128-130` |
| 7 | `DEFAULT_COLOR_THEME = "Set2"` exported from TimelineConfigPanel | PASS | `TimelineConfigPanel.tsx:29` |
| 8 | Persistent ReferenceArea reads from `useFilterStore` selector scoped to `filters[tableId]` | PASS | `TimelineRenderer.tsx:152` — `(s) => s.filters[tableId] ?? []` |
| 9 | `MAX_METRICS = 4` exported; Add button disabled at 4; renderer slices defensively; `definitions/timeline.ts` registers type + label; `definitions/index.ts` calls `registerTimeline()` | PASS | `TimelineConfigPanel.tsx:28`, `334`; `TimelineRenderer.tsx:114` `.slice(0, MAX_METRICS)`; `timeline.ts:24-25`; `index.ts:37` |

All 9 critical invariants pass.

---

### Test Gate Results

| Spec File | Tests | Result |
|-----------|-------|--------|
| `TimelineRenderer.spec.tsx` | 10 | PASS |
| `TimelineConfigPanel.spec.tsx` | 10 | PASS |
| `timelineBin.spec.ts` | 12 | PASS |
| `buildTimelineSql.spec.ts` | 9 | PASS |
| `WidgetRenderer.spec.tsx` | Included in 146 total | PASS |
| `DataFilterRenderer.spec.tsx` | Included in 146 total | PASS |
| `DataFilterConfigPanel.spec.tsx` | Included in 146 total | PASS |
| **Total (7 spec files)** | **146** | **ALL PASS** |

**TypeScript:** Zero production errors. Pre-existing `@types/node` errors in spec files (carry-forward tech debt documented in all three SUMMARY files — `__dirname`, `node:fs/promises`, `node:path` in `.spec.` files only).

---

### Anti-Patterns Scan

| File | Finding | Severity | Assessment |
|------|---------|----------|-----------|
| `TimelineConfigPanel.tsx:305` | `placeholder="Label (optional)"` | Info | HTML input placeholder attribute — legitimate UI label, not a stub |
| `TimelineConfigPanel.tsx:400` | `placeholder='"auto"...'` | Info | HTML input placeholder attribute — legitimate UI label, not a stub |
| All 5 production files | No TODO/FIXME/XXX/HACK patterns | None | Clean |
| All 5 production files | No `return null`/`return {}`/`return []` stubs | None | All return substantive JSX or SQL strings |

No blockers or warnings.

---

### Commit Verification

All 6 task commits documented in SUMMARYs confirmed in git history:

| Commit | Description |
|--------|-------------|
| `efca45f` | feat(45-01): timelineBin |
| `8c97add` | feat(45-01): buildTimelineSql |
| `17ee8e1` | feat(45-02): TimelineConfigPanel |
| `6405303` | feat(45-02): timeline definitions |
| `ec9423b` | feat(45-03): TimelineRenderer |
| `9199346` | feat(45-03): WidgetRenderer + spec |

---

### Human Verification Required

#### 1. Drag-to-Filter End-to-End (Live Browser)

**Test:** Open a dashboard with a timeline widget configured on a real Kinetica table with a datetime column. Click and drag horizontally across the chart X-axis.
**Expected:** Mouse-up dispatches a FilterBar chip displaying `<col> between '<iso-from>' and '<iso-to>'`; all widgets on the same table narrow their data; the timeline itself re-bins on the filtered (narrower) range.
**Why human:** `onMouseDown`/`onMouseMove`/`onMouseUp` fire in JSDOM but `state.activeLabel` pixel-to-bucket translation requires real Recharts layout dimensions (ResponsiveContainer uses ResizeObserver internally).

#### 2. Multi-Axis Visual Rendering (3-4 Metrics)

**Test:** Configure a timeline widget with 3 or 4 metrics (different columns/aggregations). Open the widget in a live browser.
**Expected:** Three or four distinct YAxes visible — left (M1), right (M2), outer-left (M3), outer-right (M4) — each colored to match its Line stroke. Chart has `margin.left = 120`, `margin.right = 120` for 4-metric case, reserving space for stacked outer axes.
**Why human:** Recharts SVG layout is dimension-dependent; JSDOM cannot produce layout-driven SVG output for class-based selectors.

#### 3. Persistent ReferenceArea Band (Live Browser)

**Test:** After a successful drag-to-filter, observe the chart; then click the FilterBar chip × button.
**Expected:** A blue shaded band appears over the dragged bucket range and persists on re-renders; clicking the × removes the chip and the band disappears on the next render.
**Why human:** Band position correctness (x1/x2 matching actual bucket strings in data) can only be confirmed visually.

#### 4. Sub-Hour Interval SQL on Live Kinetica

**Test:** Configure a timeline widget on a table with dense datetime data covering a 1-2 hour range; set `maxIntervals = 200`. Observe what interval is auto-selected vs manually select a 5min/15min/30min interval.
**Expected:** FLOOR-epoch SQL (`TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N)`) executes without error on the deployed Kinetica instance and returns correctly bucketed data.
**Why human:** RESEARCH.md rates FLOOR-epoch syntax MEDIUM confidence — not confirmed on deployed Kinetica version (Kinetica-specific epoch functions may differ by version).

#### 5. Single-Metric Axis Layout (Live Browser)

**Test:** Configure a timeline widget with exactly 1 metric. Render it in a live browser.
**Expected:** Only a left YAxis is visible; no blank/empty space reserved on the right side of the chart. `margin.right = 10` (not 60).
**Why human:** Conditional axis rendering (`metrics.length < 2` → no right axis) requires live Recharts SVG to confirm no residual right-side space.

#### 6. DV-Bound Timeline Widget (Live Kinetica + DV)

**Test:** Configure a timeline widget bound to a dynamic view (select from the DV section of the table picker). Apply a spatial or data filter to trigger materialization; wait for the materialized view. Observe the timeline.
**Expected:** Queries emit unprefixed `FROM <viewName>` (not `schema.viewName`); timeline re-bins over the filtered materialized view; the effective time range shrinks as the DV filter narrows the data.
**Why human:** Requires a live Kinetica instance with configured Dynamic View and a materialized view available to exercise the `effectiveSchema=""` path.

---

### Phase Goal Achievement Summary

The phase goal is **functionally complete** as verified by static code analysis and 146 automated tests. All 11 TIMELINE-V17 requirements are satisfied with substantive implementations. All 9 critical invariants pass. The 6 human verification items are live-Kinetica / live-browser behavioral confirmations that fall outside automated testing scope — they do not indicate implementation gaps.

---

_Verified: 2026-05-29T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
