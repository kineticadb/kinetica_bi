# Phase 45: Timeline Chart Widget — Research

**Researched:** 2026-05-29
**Domain:** Recharts multi-axis LineChart, Kinetica DATE_TRUNC, drag-to-filter, auto-bin algorithm
**Confidence:** HIGH (verified from source files and TypeScript definitions)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Chart type `timeline`, label "Timeline Chart", registered via `definitions/timeline.ts`.
- Own short-circuit renderer `TimelineRenderer.tsx` (NOT AggregatedWidgetRenderer path).
- CustomConfigPanel for multi-row metric builder + per-line color picker.
- X-axis: ONE time column at config time. Eligible: full `DATETIME_TYPES` set (`timestamp`, `date`, `time`, `datetime`).
- WHERE auto-appends `<timeCol> IS NOT NULL`.
- Up to 4 metric lines per widget: `{ column, aggregation, color, label? }`.
- Axis layout: Metric 1 → left, Metric 2 → right, Metric 3 → left (stacked outside M1), Metric 4 → right (stacked outside M2).
- Single-metric: single left axis only, no right axis reserved.
- Y-axis tick text AND axis line both take the line's color.
- Auto-bin: interval ladder coarsest→finest; first interval where `ceil(R/I) <= maxIntervals`.
- `maxIntervals` default 200, operator-configurable in config panel.
- SQL: `DATE_TRUNC('<interval>', <timeCol>) AS bucket` with possible sub-hour FLOOR fallback.
- One query per metric (parallel).
- Empty buckets → visual gap (null value at that x-point in Recharts).
- Drag-to-filter: commit on mouse-up only (NOT live during drag).
- Dispatch shape: `{ column: timeCol, value: [from, to], dataType: "datetime", operator: "between", sourceWidgetId: timelineWidgetId }`.
- Self-narrowing: timeline re-queries through materialized view (same as drill-down).
- Persistent `ReferenceArea` from `useFilterStore.filters[tableId]` while filter active.
- No dismiss button on the chart itself; dismiss via FilterBar chip ×.
- Color: `cbColorThemes.ts` + per-line override. Default theme "Tableau-10" (verify existence; see §Color Theme below).
- Y-axis tick text + axis line = same color as the line.
- Config panel sections: Data Source, Time column, Metrics rows, Options.
- WKT/geometry columns excluded via `isColumnDrillDownSafe`.
- Dynamic view binding via same picker pattern as other widgets.
- DV not materialized → standard empty-state pattern.
- No new FilterBar code needed (Phase 44's chipText handles BETWEEN datetime).
- No new endpoints (DATE_TRUNC SQL through `runSql` proxy; column-stats endpoint already supports empty schema for DV).

### Claude's Discretion

- Exact Recharts component composition (YAxis multi, ReferenceArea).
- Tooltip content layout (default Recharts built-in; custom styling to match dark theme).
- Legend position (default bottom; operator toggle visibility only).
- Date format default ("auto" based on interval).
- Drag pixel-to-time-value conversion logic.
- Sub-hour DATE_TRUNC fallback strategy.
- Behavior when operator picks the SAME column twice across metrics.

### Deferred Ideas (OUT OF SCOPE)

- Brush-strip mini-overview (`<Brush>`).
- Animated playback / time scrubber.
- Per-metric WHERE filters.
- Custom aggregation operators (PERCENTILE / RATE-OF-CHANGE).
- Epoch-integer X-axis support (INT/LONG columns flagged as Unix seconds/ms).
- Sub-hour intervals if DATE_TRUNC doesn't support them: research-outcome may defer sub-hour entirely.
- 5th+ metric.
- Per-metric axis-side picker.
- Stacked area chart variant.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TIMELINE-V17-01 | `timeline` chart type registered in `definitions/timeline.ts` + `definitions/index.ts` | Registry pattern confirmed via `data-filter.ts` + `index.ts` inspection |
| TIMELINE-V17-02 | `TimelineRenderer.tsx` short-circuit in `WidgetRenderer.tsx` before `AggregatedWidgetRenderer` | Exact insertion point confirmed: after `datafilter` branch (line 257), before `else` block |
| TIMELINE-V17-03 | `TimelineConfigPanel.tsx` CustomConfigPanel with data source picker + time column picker + metric row builder + options | `DataFilterConfigPanel.tsx` precedent; ChartConfigPanel optgroup picker reuse confirmed |
| TIMELINE-V17-04 | Auto-bin pure helper `timelineBin.ts` — interval ladder + selection algorithm | Pure function; interval ladder ms-values derived from CONTEXT.md; DATE_TRUNC support research below |
| TIMELINE-V17-05 | SQL builder `buildTimelineSql.ts` — DATE_TRUNC bucket query per metric; empty-schema DV support | `columnStatsSql.ts` empty-schema pattern confirmed; `runSql` is the proxy target |
| TIMELINE-V17-06 | Multi-axis Recharts LineChart with 2-4 `<YAxis yAxisId>` + matching `<Line yAxisId>` | Recharts type defs confirm `yAxisId` on both `YAxis` and `Line` props |
| TIMELINE-V17-07 | Drag-to-filter: `onMouseDown`/`onMouseMove`/`onMouseUp` on LineChart; commit `setBulkFilters` + `markMaterializing` on mouse-up | `CategoricalChartProps` type confirms `onMouseDown`/`onMouseMove`/`onMouseUp` on chart wrapper; Phase 44 dispatch pattern confirmed |
| TIMELINE-V17-08 | Persistent `ReferenceArea` band from `useFilterStore.filters[tableId]` | `ReferenceArea.d.ts` confirms `x1`, `x2` props; subscription pattern from DataFilterRenderer |
| TIMELINE-V17-09 | Per-line color from `themeColorsFor(theme, n)` with per-line override; Y-axis tick + line stroke share color | `cbColorThemes.ts` confirmed: `getCbColorTheme(id)` + `themeColorsFor(theme, count)` returns `string[]` AARRGGBB |
| TIMELINE-V17-10 | Column-stats for time range uses DV-aware target (empty schema when DV-bound) | `columnStatsSql.ts:39` confirms `schema === "" ? table : ${schema}.${table}` pattern; `ColumnStatsResponse.min/max` are `number` — CRITICAL BLOCKER: see §Gotcha C-01 |
| TIMELINE-V17-11 | Sole-materialize-trigger invariant preserved: `TimelineRenderer` never imports `materializeFilter` | Phase 44 static-assertion spec pattern available for reuse |
</phase_requirements>

---

## Executive Summary

Phase 45 builds a `timeline` chart type onto the existing Phase 44 BETWEEN filter infrastructure. All primary integration points are confirmed in source: `setBulkFilters` + `markMaterializing` dispatch pattern, `ActiveFilter operator: "between"` shape, `buildChipText` BETWEEN display, short-circuit renderer slot in `WidgetRenderer.tsx`, and the `cbColorThemes.ts` theme API. The Recharts multi-axis pattern (`yAxisId` on both `YAxis` and `Line`, `orientation` for left/right) is confirmed from type definitions; `ReferenceArea` with `x1`/`x2` is confirmed for the persistent selection band; `onMouseDown`/`onMouseMove`/`onMouseUp` are confirmed on `CategoricalChartProps` (the LineChart base).

**Three important gotchas discovered:**

1. **`columnStatsFn` does NOT work for datetime time-range fetch** — the parser at `columnStatsSql.ts:69` asserts `Number.isFinite(v)`, but Kinetica returns datetime MIN/MAX as date strings (not finite numbers). A separate time-range query using `CAST(MIN(timeCol) AS DOUBLE)` (epoch seconds) or `SELECT MIN(timeCol), MAX(timeCol)` parsed as strings is needed. This is the biggest implementation risk.

2. **Stacked outer-axis offset requires `margin` tuning, not a special prop** — Recharts stacks multiple Y-axes on the same side by allocating sequential width. There is NO `mirror` hack needed. Simply declare two `<YAxis orientation="left" yAxisId="m0" width={60}>` and `<YAxis orientation="left" yAxisId="m2" width={60}>` — Recharts stacks them. The chart's `margin.left` must accommodate both widths.

3. **"Tableau-10" is NOT a ColorBrewer scheme** — ColorBrewer has no "Tableau-10" key. CONTEXT.md says "Tableau-10 (or whichever is the codebase's existing default)." Inspection of `cbColorThemes.ts` shows schemes are from the `colorbrewer` package (qualitative includes `Set1`, `Set2`, `Set3`, `Paired`, `Dark2`, `Accent`, `Pastel1`, `Pastel2`). The codebase default should be `Set2` or `Paired` (8-class qualitative). Planner must confirm the actual default with the operator or pick a qualitative scheme.

**Primary recommendation:** Build the phase in three plans: (1) auto-bin + SQL helper (pure functions), (2) widget registration + config panel, (3) renderer with multi-axis chart + drag-to-filter. The time-range fetch needs its own endpoint or a different query shape — this is the only new server-side work beyond pure SQL building.

---

## Focus Area A: Recharts Multi-Axis Pattern

**Confidence: HIGH** — verified from TypeScript definition files in installed `recharts@2.15.4`.

### YAxis Multi-Axis: Confirmed API

From `types/cartesian/YAxis.d.ts`:
```
yAxisId?: string | number       — unique axis ID
orientation?: 'left' | 'right'  — which side
width?: number                  — pixel width reserved for this axis (default 60)
mirror?: boolean                — flip tick labels to the other side of the axis line
```

From `types/cartesian/Line.d.ts` (grep-confirmed):
```
yAxisId?: string | number       — must match a declared YAxis yAxisId
```

From `types/cartesian/ReferenceArea.d.ts`:
```
x1?: number | string
x2?: number | string
yAxisId?: number | string
xAxisId?: number | string
fill?: string
fillOpacity?: number
```

### LineChart Event Callbacks: Confirmed API

From `types/chart/generateCategoricalChart.d.ts` (`CategoricalChartProps`):
```typescript
onMouseDown?: CategoricalChartFunc;  // (nextState, event) => void
onMouseMove?: CategoricalChartFunc;  // nextState has activeLabel, activePayload
onMouseUp?: CategoricalChartFunc;
```

`getMouseInfo` returns `{ activeLabel, activePayload, activeCoordinate, chartX, chartY }`.

On a time-bucketed X-axis (`XAxis dataKey="bucket"`), `activeLabel` in the chart callback state is the bucket value at the hovered x-position — the ISO string or epoch value in the `bucket` column.

### Code Skeleton: 1 / 2 / 3 / 4 Axes

```typescript
// Source: recharts@2.15.4 type defs — YAxis.d.ts + generateCategoricalChart.d.ts

// axis layout by metric index:
// index 0 → orientation="left",  yAxisId="m0"
// index 1 → orientation="right", yAxisId="m1"
// index 2 → orientation="left",  yAxisId="m2"  (stacked outside m0)
// index 3 → orientation="right", yAxisId="m3"  (stacked outside m1)

const AXIS_ORIENTATION = ["left", "right", "left", "right"] as const;
const AXIS_IDS = ["m0", "m1", "m2", "m3"] as const;

// Stacked outer axes: Recharts allocates space for multiple YAxis on the same
// side sequentially. Chart margin must reserve room.
// With 4 metrics: margin={{ left: 120, right: 120 }} (2×60px per side).
// With 2 metrics: margin={{ left: 60, right: 60 }}.
// With 1 metric:  margin={{ left: 60, right: 10 }}.

const marginLeft  = metrics.length >= 3 ? 120 : 60;
const marginRight = metrics.length >= 2 ? (metrics.length >= 4 ? 120 : 60) : 10;

<LineChart
  data={mergedData}
  margin={{ top: 10, right: marginRight, left: marginLeft, bottom: 0 }}
  onMouseDown={(state) => { if (state.activeLabel) setDragStart(state.activeLabel as string); }}
  onMouseMove={(state) => { if (isDragging && state.activeLabel) setDragEnd(state.activeLabel as string); }}
  onMouseUp={(state)   => { if (dragStart) commitFilter(dragStart, state.activeLabel as string ?? dragEnd); }}
>
  <CartesianGrid stroke={GRID_COLOR} vertical={false} />
  <XAxis dataKey="bucket" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={formatBucket} />

  {metrics.map((m, i) => (
    <YAxis
      key={AXIS_IDS[i]}
      yAxisId={AXIS_IDS[i]}
      orientation={AXIS_ORIENTATION[i]}
      width={60}
      stroke={m.color}           // axis line color matches line color
      tick={{ fill: m.color, fontSize: 11 }}  // tick text color matches line color
    />
  ))}

  {metrics.map((m, i) => (
    <Line
      key={m.column + i}
      yAxisId={AXIS_IDS[i]}
      dataKey={`metric_${i}`}
      stroke={m.color}
      strokeWidth={2}
      dot={false}
      name={m.label || m.column}
      connectNulls={false}       // null = visual gap (empty bucket)
    />
  ))}

  {showTooltip && <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8 }} />}
  {showLegend && <Legend layout="horizontal" verticalAlign="bottom" />}

  {/* Transient drag band during mouse-drag */}
  {isDragging && dragStart && dragEnd && (
    <ReferenceArea x1={dragStart} x2={dragEnd} fill="#38bdf8" fillOpacity={0.2} />
  )}

  {/* Persistent applied-filter band from store */}
  {appliedBand && (
    <ReferenceArea x1={appliedBand[0]} x2={appliedBand[1]} fill="#38bdf8" fillOpacity={0.15} />
  )}
</LineChart>
```

### Stacked Outer Axis Mechanism

Recharts does not have a concept of "outer" vs "inner" axis. It stacks multiple axes on the same side in declaration order, each consuming `width` pixels. Metric 3 (yAxisId="m2", orientation="left") sits to the LEFT of Metric 1 (yAxisId="m0", orientation="left") — further from the chart body. There is no `mirror` prop needed. The `margin.left` must total all left-axis widths; `margin.right` must total all right-axis widths.

### ResponsiveContainer Compatibility

`onMouseDown`/`onMouseMove`/`onMouseUp` fire on the inner SVG element managed by Recharts, not on the `ResponsiveContainer` wrapper. The `ResponsiveContainer` uses a `ResizeObserver` to track dimensions — this does not interfere with pointer events. **Confirmed safe to use.**

---

## Focus Area B: Drag-to-Filter Implementation

**Confidence: HIGH** — pattern derived from confirmed Recharts API + Phase 44 dispatch pattern.

### State Machine

```typescript
const [dragStart, setDragStart] = useState<string | null>(null);
const [dragEnd,   setDragEnd]   = useState<string | null>(null);
const [isDragging, setIsDragging] = useState(false);

// Commit threshold: if start ≈ end (user just clicked without dragging),
// do NOT dispatch a filter. Check: dragStart !== dragEnd (string comparison).
```

### Mouse Event Handlers on LineChart

```typescript
// CategoricalChartFunc signature: (nextState: CategoricalChartState, event: any) => void
// nextState.activeLabel is the bucket string value at the hovered position.

onMouseDown={(state) => {
  if (!state.activeLabel) return;
  setDragStart(state.activeLabel as string);
  setIsDragging(true);
}}

onMouseMove={(state) => {
  if (!isDragging || !state.activeLabel) return;
  setDragEnd(state.activeLabel as string);
}}

onMouseUp={(state) => {
  setIsDragging(false);
  const end = (state.activeLabel as string | undefined) ?? dragEnd;
  if (!dragStart || !end || dragStart === end) {
    setDragStart(null); setDragEnd(null); return;
  }
  // Normalize order (user may drag right-to-left):
  const [from, to] = dragStart < end ? [dragStart, end] : [end, dragStart];
  commitFilter(from, to);
  setDragStart(null); setDragEnd(null);
}}
```

### Commit Filter (Phase 44 dispatch pattern)

```typescript
// Mirrors DataFilterRenderer.tsx:346,350 exactly.

function commitFilter(from: string, to: string) {
  const filter: ActiveFilter = {
    column: config.timeCol,
    value: [from, to] as [string, string],
    dataType: "datetime",
    operator: "between",
    sourceWidgetId: widget.id,
    addedAt: Date.now(),
  };
  useFilterStore.getState().setBulkFilters(tableId, [filter]);
  useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
}
```

### Persistent Band from Filter Store

```typescript
// Subscribe to the time-column filter (scoped selector — PITFALL C-02):
const appliedFilters = useFilterStore(
  (s) => (s.filters[tableId] ?? []).filter(
    (f) => f.column === config.timeCol && f.operator === "between"
  )
);
const appliedBand: [string, string] | null =
  appliedFilters.length > 0 && Array.isArray(appliedFilters[0].value)
    ? appliedFilters[0].value as [string, string]
    : null;
```

The `ReferenceArea x1/x2` props accept `string` values when the XAxis `dataKey` is a string-keyed field. The strings must match exactly the `bucket` values in the data array for Recharts to position them correctly. This is the KEY CONSTRAINT for band persistence: the `from`/`to` stored in the filter must be the bucket string, not a free-form ISO timestamp.

**Important edge case**: after a drag-to-filter, the timeline re-queries through the materialized view with a narrower time range. The auto-bin may change interval. New bucket strings may not align with the stored `from`/`to`. The persistent band may render at incorrect positions or not render at all if the stored bucket values don't appear in the new data. This is visually acceptable for a first version — the FilterBar chip is the ground truth, not the band position.

---

## Focus Area C: Auto-Bin Algorithm

**Confidence: HIGH** — pure algorithm, no external dependencies.

### Interval Ladder (ms equivalents)

```typescript
// Source: CONTEXT.md + standard calendar math
// Ladder ordered coarsest → finest.

export const INTERVAL_LADDER: Array<{ key: string; ms: number; dateTrunc: string | null; epochFloor?: number }> = [
  { key: "year",    ms: 31_536_000_000, dateTrunc: "year"    },
  { key: "quarter", ms:  7_889_400_000, dateTrunc: "quarter" },
  { key: "month",   ms:  2_628_000_000, dateTrunc: "month"   },
  { key: "week",    ms:    604_800_000, dateTrunc: "week"    },
  { key: "day",     ms:     86_400_000, dateTrunc: "day"     },
  { key: "12h",     ms:     43_200_000, dateTrunc: null, epochFloor: 43_200 }, // seconds
  { key: "6h",      ms:     21_600_000, dateTrunc: null, epochFloor: 21_600 },
  { key: "hour",    ms:      3_600_000, dateTrunc: "hour"    },
  { key: "30min",   ms:      1_800_000, dateTrunc: null, epochFloor: 1_800  },
  { key: "15min",   ms:        900_000, dateTrunc: null, epochFloor:   900  },
  { key: "5min",    ms:        300_000, dateTrunc: null, epochFloor:   300  },
  { key: "minute",  ms:         60_000, dateTrunc: "minute"  },
];
```

### DATE_TRUNC Support on Kinetica

**Kinetica supports `DATE_TRUNC` for: `year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`.**
**Kinetica does NOT support sub-interval multipliers like `DATE_TRUNC('5minute', ...)`.**

Source: CONTEXT.md explicitly states this and asks for research. Based on Kinetica 7.x documentation patterns (consistent with standard SQL semantics), sub-hour multi-minute intervals (`30min`, `15min`, `5min`, `12h`, `6h`) require the FLOOR-epoch fallback. Only `minute` and `hour` (and coarser) are DATE_TRUNC-native.

**Confidence for DATE_TRUNC 'minute' support: MEDIUM** — CONTEXT.md says "probably YES" for minute. Kinetica date functions documentation confirms DATE_TRUNC accepts standard SQL time parts. The deployed version should support minute-level truncation.

**FLOOR-epoch fallback pattern (for non-DATE_TRUNC intervals):**

```sql
-- For 30-minute buckets (epochFloor = 1800 seconds):
TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM pickup_time) / 1800) * 1800) AS bucket
```

Kinetica's `EXTRACT(EPOCH FROM col)` returns seconds since Unix epoch as a float. `TO_TIMESTAMP(epoch_seconds)` converts back. This pattern is the standard Kinetica approach for sub-DATE_TRUNC intervals.

**Confidence: MEDIUM** — based on Kinetica SQL function reference patterns. The spike output in CONTEXT.md acknowledges this may need FLOOR fallback. If `EXTRACT(EPOCH FROM ...)` syntax differs on deployed Kinetica, an alternative is to cast via `MSEC_TO_TIMESTAMP(FLOOR(TIMESTAMP_TO_MSEC(col) / N_ms) * N_ms)` — Kinetica-specific epoch-ms functions. Both patterns should be noted in the SQL builder.

### Auto-Bin Selection Algorithm

```typescript
// src/lib/timelineBin.ts — pure function, no imports needed

export function selectInterval(
  timeRangeMs: number,
  maxIntervals: number,
): typeof INTERVAL_LADDER[number] {
  for (const interval of INTERVAL_LADDER) {
    if (Math.ceil(timeRangeMs / interval.ms) <= maxIntervals) {
      return interval;
    }
  }
  // Fallback: finest interval (minute) even if it exceeds maxIntervals.
  // This happens when timeRangeMs is very small or maxIntervals is very small.
  return INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}
```

### SQL Builder Skeleton

```typescript
// src/lib/buildTimelineSql.ts

export function buildTimelineBucket(timeCol: string, interval: typeof INTERVAL_LADDER[number]): string {
  if (interval.dateTrunc) {
    return `DATE_TRUNC('${interval.dateTrunc}', ${timeCol})`;
  }
  // FLOOR-epoch fallback for sub-hour non-standard intervals:
  const epochSec = interval.epochFloor!;
  return `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM ${timeCol}) / ${epochSec}) * ${epochSec})`;
}

export function buildTimelineSql({
  schema,
  table,
  timeCol,
  metricCol,
  aggregation,   // "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT" | "STDDEV" | "VARIANCE"
  interval,
  maxIntervals,
}: TimelineSqlArgs): string {
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = buildTimelineBucket(timeCol, interval);
  const agg = aggregation === "COUNT_DISTINCT"
    ? `COUNT(DISTINCT ${metricCol})`
    : `${aggregation}(${metricCol})`;
  return (
    `SELECT ${bucket} AS bucket, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL ` +
    `GROUP BY bucket ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${maxIntervals}`
  );
}
```

**One query per metric** (N parallel `runSql` calls), then merge result arrays on the bucket key for the chart's unified `data` array.

**Merge strategy**: after N parallel queries each returning `{ bucket: string; value: number | null }[]`, create a union of all bucket keys and build a single merged array:
```typescript
type MergedRow = { bucket: string; metric_0?: number | null; metric_1?: number | null; /* ... */ };
```
Missing buckets for a metric get `undefined` (Recharts treats as null → gap in line when `connectNulls={false}`).

---

## Focus Area D: Time-Range Fetch — CRITICAL GOTCHA

**Confidence: HIGH** — confirmed by reading `columnStatsSql.ts:69`.

### Problem

`columnStatsFn` calls `POST /api/column-stats` which runs:
```sql
SELECT MIN(col), MAX(col), AVG(col), STDDEV(col) FROM table WHERE col IS NOT NULL
```

The response parser at `columnStatsSql.ts:69`:
```typescript
if (typeof v !== "number" || !Number.isFinite(v)) {
  throw new Error(`column-stats ${label} is not a finite number...`);
}
```

Kinetica returns DATETIME MIN/MAX as date strings (e.g. `"2024-01-15 08:30:00.000"`), NOT as float numbers. The parser will throw for datetime columns. **`columnStatsFn` cannot be used for the time column's min/max.**

### Solution Options

**Option A (Recommended): Client-built dedicated SQL via `runSql`**

```sql
SELECT
  EXTRACT(EPOCH FROM MIN(pickup_time)) AS min_epoch,
  EXTRACT(EPOCH FROM MAX(pickup_time)) AS max_epoch
FROM schema.table
WHERE pickup_time IS NOT NULL
```

Returns epoch seconds as numbers. Client multiplies by 1000 to get ms. This is a `runSql` call — no new endpoint.

**Option B: New `POST /api/time-range` endpoint** — mirrors column-stats; unnecessary if option A works via `runSql`.

**Option C: Parse datetime string from `runSql`** — query `SELECT MIN(col) AS lo, MAX(col) AS hi ...` and `new Date(lo).getTime()`. Less clean but avoids epoch arithmetic.

**Recommendation**: Option A — `EXTRACT(EPOCH FROM ...)` in the `runSql` call from the renderer. This is pure client-side work, no new endpoint. The renderer calls `runSql` for both the time-range fetch AND the metric data queries.

**DV-aware**: when DV-bound, use the materialized view name (empty schema pattern). The auto-bin will re-run against the filtered range after a drag-to-filter narrows the view.

---

## Focus Area E: Color Theme

**Confidence: HIGH** — verified from `cbColorThemes.ts` source.

### API

```typescript
// src/lib/cbColorThemes.ts

export const CB_COLOR_THEMES: CbColorTheme[];        // all ColorBrewer themes
export function getCbColorTheme(id: string): CbColorTheme | undefined;
export function themeColorsFor(theme: CbColorTheme, count: number): string[];
// Returns count colors as 8-char AARRGGBB (FF alpha prefix), e.g. "FF4E79A7".
```

### Default Theme

CONTEXT.md says "Tableau-10 (or whichever is the codebase's existing default)." **Tableau-10 is NOT in ColorBrewer.** The qualitative ColorBrewer schemes available are:
- `Set1` (9 classes), `Set2` (8 classes), `Set3` (12 classes)
- `Paired` (12 classes), `Dark2` (8 classes), `Accent` (8 classes)
- `Pastel1` (9 classes), `Pastel2` (8 classes)

**Recommendation**: Use `Set2` as the default (8 distinct qualitative colors, saturated, suitable for line charts). The config panel dropdown will show all `CB_COLOR_THEMES` filtered to `group === "Qualitative"` (since sequential/diverging themes are less suitable for distinct lines).

### Color Format

`themeColorsFor(theme, count)` returns `"FF" + RRGGBB.toUpperCase()` — 8-char AARRGGBB. The timeline metric's `color` field stores this format. To use in Recharts `stroke`, convert to CSS: strip the leading `"FF"` alpha prefix and prepend `"#"`:

```typescript
function toHexColor(aarrggbb: string): string {
  return "#" + aarrggbb.slice(2).toLowerCase();
}
```

The Class Break form uses the same conversion. This is a one-liner utility.

---

## Focus Area F: Widget Registration Pattern

**Confidence: HIGH** — confirmed from `data-filter.ts` and `index.ts`.

### Short-Circuit Slot

Insert AFTER the `datafilter` branch and BEFORE the `else` AggregatedWidgetRenderer fallback in `WidgetRenderer.tsx`:

```typescript
// Current line 249-256:
} else if (widget.type === "datafilter") {
  body = <DataFilterRenderer widget={widget} tables={tables} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}

// New:
} else if (widget.type === "datafilter") {
  body = <DataFilterRenderer widget={widget} tables={tables} />;
} else if (widget.type === "timeline") {
  // Phase 45 (TIMELINE-V17-02): timeline short-circuits — owns multi-axis + drag-to-filter lifecycle.
  body = <TimelineRenderer widget={widget} tables={tables} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}
```

### Definition File Pattern

Mirrors `data-filter.ts`:
```typescript
const timeline: ChartTypeDefinition = {
  type: "timeline",
  label: "Timeline Chart",
  icon: "TL",           // 2-char text icon
  fields: [],           // no generic fields — all config in CustomConfigPanel
  defaultConfig: {
    timeCol: "",
    metrics: [],
    maxIntervals: 200,
    showLegend: true,
    showTooltip: true,
    colorTheme: "Set2",
    dateFormatOverride: "",
  },
  usesAggregation: false,
  usesDataSource: false,  // TimelineConfigPanel renders its own data source + time + metrics pickers
  supportsDrillDown: false,
  CustomConfigPanel: TimelineConfigPanel,
};
```

Note: `usesDataSource: false` suppresses the generic Data Source section in ChartConfigPanel. `TimelineConfigPanel` renders its own source picker (reusing the `dv:` optgroup pattern from `ChartConfigPanel.tsx:155` by embedding the same picker logic or adapting it).

### Registration in `index.ts`

```typescript
import registerTimeline from "./timeline";
// ...
registerTimeline();   // Phase 45 (TIMELINE-V17-01)
```

---

## Focus Area G: Config Panel — DATETIME_TYPES Not Exported

**Confidence: HIGH** — confirmed by reading `columnTypes.ts` exports.

`DATETIME_TYPES` and `NUMERIC_TYPES` are module-private in `columnTypes.ts`. They are NOT exported. The `TimelineConfigPanel` needs to filter columns by type for:
- Time column picker: datetime types only.
- Metric column picker: numeric types only.

**Solution**: Use `inferDataTypeFromColumn(colName, columns)` from `columnTypes.ts`. This is already exported and used by `DataFilterConfigPanel`. Filter:

```typescript
// X-axis (time column):
const timeColumns = columns.filter(
  c => inferDataTypeFromColumn(c.name, { [c.name]: c.type }) === "datetime"
);

// Metric columns:
const metricColumns = columns.filter(
  c => inferDataTypeFromColumn(c.name, { [c.name]: c.type }) === "number"
    && isColumnDrillDownSafe(c.type)   // exclude WKT/geometry
);
```

Note: `inferDataTypeFromColumn` takes `(colName, Record<string, string>)`. To check a single column, pass `{ [c.name]: c.type }`. This is a consistent pattern with `DataFilterConfigPanel`.

---

## Architecture Risks & Gotchas

### C-01: columnStatsFn Returns Number, Datetime Min/Max Are Strings (BLOCKER)

**Risk**: CRITICAL — `columnStatsFn` will throw when called on a datetime column because the parser asserts `Number.isFinite(v)`. The auto-bin time range fetch MUST use a different query.

**Mitigation**: Use `runSql` directly with `EXTRACT(EPOCH FROM MIN(col)) AS min_epoch` query. The renderer builds this query client-side and calls `runSql`. No new endpoint needed.

**Spec impact**: `timelineBin.spec.ts` should test `selectInterval` with mocked ms values only (pure function). The renderer spec mocks `runSql` to return synthetic epoch values.

### C-02: Bucket String Alignment for Persistent ReferenceArea Band

**Risk**: MEDIUM — after drag-to-filter, the timeline auto-bins narrower range → new interval → new bucket strings. The stored `[from, to]` bucket strings from the drag gesture may not exist in the new dataset. Recharts renders `ReferenceArea` at matching data-key positions; unmatched keys result in the band not rendering.

**Mitigation**: This is acceptable UX for v1 — the FilterBar chip is the ground truth. The band rendering is a "nice to have." The operator can see the applied range via the chip. No fix needed in Phase 45.

### C-03: Drag State Leaks Across ResponsiveContainer Resize

**Risk**: LOW — if the container resizes mid-drag, the `onMouseUp` may not fire on the LineChart (pointer leaves the chart area). `isDragging` stays `true`; `dragStart` stays set.

**Mitigation**: Add `onMouseLeave` handler to reset drag state:
```typescript
onMouseLeave={() => { setIsDragging(false); setDragStart(null); setDragEnd(null); }}
```

### C-04: Single-Metric Case — Right Axis Must Be Absent (Not Hidden)

**Risk**: MEDIUM — with only 1 metric, if a `YAxis orientation="right"` is rendered but hidden (`hide={true}`), Recharts may still reserve space for it, producing blank space on the right. Must conditionally render: when `metrics.length === 1`, render only `<YAxis yAxisId="m0" orientation="left">` and NO right axis.

**Mitigation**: Render axes conditionally based on `metrics.length`, not hide/show. This is the correct Recharts pattern for truly absent axes.

### C-05: DATE_TRUNC Sub-Hour Support Unknown Until Live Test

**Risk**: MEDIUM — CONTEXT.md explicitly flags this as an open question. The FLOOR-epoch fallback is a reasonable default but `EXTRACT(EPOCH FROM col)` and `TO_TIMESTAMP()` may have different names on the specific deployed Kinetica version.

**Mitigation**: In `buildTimelineSql.ts`, always use DATE_TRUNC for `minute`-and-coarser intervals (per CONTEXT.md "probably YES" for minute). Use FLOOR-epoch for `12h`, `6h`, `30min`, `15min`, `5min`. Include a comment documenting the epoch functions used. If the deployed Kinetica fails on FLOOR-epoch, the ladder simply skips sub-hour and falls through to `hour` — this is the CONTEXT.md deferred option.

### C-06: Tableau-10 Not in ColorBrewer

**Risk**: LOW — CONTEXT.md says "Tableau-10 (or whichever is the codebase's existing default)." ColorBrewer has no "Tableau-10" scheme. Default to `Set2` (qualitative, 8 colors, visually distinct).

### C-07: AARRGGBB → CSS Color Conversion

**Risk**: LOW — `themeColorsFor` returns 8-char AARRGGBB with "FF" alpha prefix. Recharts `stroke` prop accepts CSS hex (`#RRGGBB`). Must strip the first two chars. One-liner utility; add to the Timeline helpers.

### C-08: Merging N Parallel Metric Queries

**Risk**: LOW-MEDIUM — if two metrics have different sets of populated buckets, the merge must produce a full union of all bucket keys. A missing bucket for metric_i should produce `null` (not `undefined` coerced to 0). Recharts `connectNulls={false}` ensures null → gap; `undefined` might render differently.

**Mitigation**: In the merge function, explicitly set `mergedRow[metricKey] = null` for missing buckets, not `undefined`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `kinetica_bi/vite.config.ts` |
| Quick run command | `cd kinetica_bi && npx vitest run --testPathPattern="timelineBin\|TimelineRenderer\|TimelineConfigPanel"` |
| Full suite command | `cd kinetica_bi && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIMELINE-V17-01 | `timeline` registered: type/label/icon/CustomConfigPanel present | unit | `npx vitest run --testPathPattern="timeline.spec"` | Wave 0 |
| TIMELINE-V17-02 | WidgetRenderer renders TimelineRenderer for `type === "timeline"` | unit | `npx vitest run --testPathPattern="WidgetRenderer.spec"` | Exists (add test) |
| TIMELINE-V17-03 | Config panel renders time-col picker (datetime columns only), metric rows, options | unit | `npx vitest run --testPathPattern="TimelineConfigPanel.spec"` | Wave 0 |
| TIMELINE-V17-04 | `selectInterval(timeRangeMs, maxIntervals)` returns correct ladder entry | unit | `npx vitest run --testPathPattern="timelineBin.spec"` | Wave 0 |
| TIMELINE-V17-05 | `buildTimelineSql` emits DATE_TRUNC for hour/day/etc; FLOOR-epoch for 30min/15min/5min | unit | `npx vitest run --testPathPattern="buildTimelineSql.spec"` | Wave 0 |
| TIMELINE-V17-06 | TimelineRenderer renders N `<YAxis>` elements with correct `yAxisId` + `orientation` | unit | `npx vitest run --testPathPattern="TimelineRenderer.spec"` | Wave 0 |
| TIMELINE-V17-07 | Drag gesture dispatches `setBulkFilters` + `markMaterializing` in correct order | unit | `npx vitest run --testPathPattern="TimelineRenderer.spec"` | Wave 0 |
| TIMELINE-V17-08 | Applied BETWEEN filter shows ReferenceArea; no filter = no band | unit | `npx vitest run --testPathPattern="TimelineRenderer.spec"` | Wave 0 |
| TIMELINE-V17-09 | Colors from `themeColorsFor(getCbColorTheme("Set2"), n)` applied to Line stroke + YAxis stroke/tick | unit | `npx vitest run --testPathPattern="TimelineRenderer.spec"` | Wave 0 |
| TIMELINE-V17-10 | Time-range query uses `EXTRACT(EPOCH FROM MIN/MAX)` pattern when called with DV empty schema | unit | `npx vitest run --testPathPattern="TimelineRenderer.spec"` | Wave 0 |
| TIMELINE-V17-11 | `TimelineRenderer.tsx` contains zero references to `materializeFilter` | static | `grep -c "materializeFilter" TimelineRenderer.tsx` | Wave 0 |

### Wave 0 Gaps

- [ ] `kinetica_bi/src/lib/timelineBin.spec.ts` — covers TIMELINE-V17-04: ladder selection
- [ ] `kinetica_bi/src/lib/buildTimelineSql.spec.ts` — covers TIMELINE-V17-05: SQL builder output
- [ ] `kinetica_bi/src/components/charts/TimelineRenderer.spec.tsx` — covers TIMELINE-V17-06..11
- [ ] `kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx` — covers TIMELINE-V17-03
- [ ] `kinetica_bi/src/components/charts/definitions/timeline.spec.ts` — covers TIMELINE-V17-01

### Sampling Rate

- Per task commit: `cd kinetica_bi && npx vitest run --testPathPattern="timelineBin\|buildTimeline\|TimelineRenderer\|TimelineConfigPanel\|WidgetRenderer"`
- Per wave merge: `cd kinetica_bi && npx vitest run`
- Phase gate: Full suite green before `/gsd:verify-work`

---

## Recommended Plan Structure

The planner makes the final call, but the following split is well-motivated by dependency ordering:

### Plan 45-01: Auto-Bin + SQL Helpers (Wave 1)

Pure functions, zero UI. No imports from React/Recharts/Zustand.

**Files:**
- `kinetica_bi/src/lib/timelineBin.ts` — `INTERVAL_LADDER`, `selectInterval(timeRangeMs, maxIntervals)`, `buildTimelineBucket(timeCol, interval)`, `buildTimelineRangeQuery(schema, table, timeCol)` (the EXTRACT(EPOCH) query)
- `kinetica_bi/src/lib/buildTimelineSql.ts` — `buildTimelineSql(args)` (single-metric query builder)
- `kinetica_bi/src/lib/timelineBin.spec.ts`
- `kinetica_bi/src/lib/buildTimelineSql.spec.ts`

**Note**: `buildTimelineRangeQuery` builds the EXTRACT(EPOCH) min/max SQL. The renderer calls `runSql(query)` and reads the epoch values.

### Plan 45-02: Widget Registration + Config Panel (Wave 2)

Depends on 45-01 for `TimelineMetric` type + default config shape.

**Files:**
- `kinetica_bi/src/components/charts/definitions/timeline.ts`
- `kinetica_bi/src/components/charts/TimelineConfigPanel.tsx`
- `kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx`
- `kinetica_bi/src/components/charts/definitions/index.ts` (add `registerTimeline()`)

### Plan 45-03: TimelineRenderer + Multi-Axis + Drag-to-Filter (Wave 2)

Depends on 45-01 (SQL helpers) + 45-02 (config shape for reading `config.timeCol` / `config.metrics`).

**Files:**
- `kinetica_bi/src/components/charts/TimelineRenderer.tsx`
- `kinetica_bi/src/components/charts/TimelineRenderer.spec.tsx`
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` (add `timeline` branch)

**Wave structure**: Plan 45-01 is Wave 1 (no dependencies). Plans 45-02 + 45-03 are Wave 2 (both depend on 45-01 types; 45-03 depends on 45-02 config shape). 45-03 can run after 45-02 because it imports `TimelineMetric` type and config defaults.

---

## File Inventory

### New Files

| File | Plan | Purpose |
|------|------|---------|
| `kinetica_bi/src/lib/timelineBin.ts` | 45-01 | `INTERVAL_LADDER`, `selectInterval`, `buildTimelineBucket`, `buildTimelineRangeQuery` |
| `kinetica_bi/src/lib/buildTimelineSql.ts` | 45-01 | `buildTimelineSql` per-metric query builder |
| `kinetica_bi/src/lib/timelineBin.spec.ts` | 45-01 | Unit tests: ladder selection + SQL output |
| `kinetica_bi/src/lib/buildTimelineSql.spec.ts` | 45-01 | Unit tests: SQL shape assertions |
| `kinetica_bi/src/components/charts/definitions/timeline.ts` | 45-02 | Chart type registration |
| `kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` | 45-02 | Config panel: source picker + time col + metrics rows + options |
| `kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx` | 45-02 | Config panel specs |
| `kinetica_bi/src/components/charts/TimelineRenderer.tsx` | 45-03 | Main renderer: LineChart multi-axis + drag-to-filter + data fetch |
| `kinetica_bi/src/components/charts/TimelineRenderer.spec.tsx` | 45-03 | Renderer specs: multi-axis render, drag dispatch, band, DV-aware |

### Modified Files

| File | Plan | Change |
|------|------|--------|
| `kinetica_bi/src/components/charts/definitions/index.ts` | 45-02 | Add `import + registerTimeline()` call |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx` | 45-03 | Add `timeline` short-circuit branch after `datafilter` |

**No server files touched** — all SQL built client-side and proxied through `runSql`. No new endpoints. No store changes. No FilterBar changes.

---

## Open Questions for Planner

1. **Default color theme**: CONTEXT.md says "Tableau-10" but ColorBrewer has no such scheme. Should the default be `Set2` (recommended), `Paired`, or should we add a small Tableau-like palette manually? Planner should confirm with operator or choose a qualitative scheme and document the choice.

2. **Combined vs. per-metric SQL query**: CONTEXT.md says "one query per metric" but notes it "could be combined into a single multi-AGG query if N metrics share the same WHERE." The per-metric approach is simpler and more extensible; the combined query would reduce from N round-trips to 1 but requires bucket-join in the SQL. Research recommends keeping per-metric for Phase 45 simplicity.

3. **EXTRACT(EPOCH FROM ...) vs. datetime string parsing for time range**: The FLOOR-epoch pattern relies on `EXTRACT(EPOCH FROM timeCol)` returning seconds as a number. If deployed Kinetica doesn't support this syntax, the fallback is to query `SELECT MIN(timeCol), MAX(timeCol)` returning datetime strings and `new Date(str).getTime()`. Planner should note both paths in the Plan 45-01 SQL builder and add a test for each.

4. **DATE_TRUNC 'minute' confirmed?**: CONTEXT.md says "probably YES." The auto-bin ladder includes `minute`. If DATE_TRUNC('minute', ...) fails on live Kinetica, minute-level bucketing falls back to FLOOR with `epochFloor: 60`. The planner can include both as separate `dateTrunc` and `epochFloor` fields in the ladder entry for minute, using `dateTrunc` preferentially.

5. **Sub-hour intervals deferred?**: CONTEXT.md deferred section says "if FLOOR adds complexity, defer sub-hour entirely (operator can pick `hour` as the finest interval)." The planner may choose to simply end the ladder at `hour` for Phase 45, deferring `30min`/`15min`/`5min`/`12h`/`6h` entirely. This is the safest path if the FLOOR-epoch pattern is uncertain.

6. **`TimelineConfigPanel` data source picker**: CONTEXT.md says "reuses ChartConfigPanel optgroup pattern." Since `usesDataSource: false` suppresses the generic picker, `TimelineConfigPanel` must embed its own data source picker. The cleanest approach is to copy the `dataSourceOptions` builder from `ChartConfigPanel.tsx` into the config panel's `useMemo`. Alternatively, extract a shared `DataSourcePicker` component. For Phase 45 simplicity, the inline copy is fine.

7. **Drag-to-filter: cursor styling**: Should the cursor change to `ew-resize` (east-west resize) while over the chart to hint at the drag gesture? This is a Claude's Discretion item not mentioned in CONTEXT.md but would improve UX. The planner can add `style={{ cursor: "crosshair" }}` on the LineChart wrapper.

---

## Sources

### Primary (HIGH confidence)

- `kinetica_bi/node_modules/recharts/types/cartesian/YAxis.d.ts` — `yAxisId`, `orientation`, `width`, `mirror` props
- `kinetica_bi/node_modules/recharts/types/cartesian/ReferenceArea.d.ts` — `x1`, `x2`, `yAxisId`, `fill`, `fillOpacity`
- `kinetica_bi/node_modules/recharts/types/chart/generateCategoricalChart.d.ts` — `onMouseDown`, `onMouseMove`, `onMouseUp` on `CategoricalChartProps`; `activeLabel` in `getMouseInfo` return
- `kinetica_bi/node_modules/recharts/types/cartesian/Line.d.ts` — `yAxisId` prop confirmed
- `kinetica_bi/src/lib/cbColorThemes.ts` — `getCbColorTheme`, `themeColorsFor`, `CB_COLOR_THEMES`; ColorBrewer scheme names (no Tableau-10)
- `kinetica_bi/server/src/lib/columnStatsSql.ts` — `Number.isFinite(v)` parser asserts numeric only; empty-schema DV pattern at line 39
- `kinetica_bi/src/components/charts/DataFilterRenderer.tsx:346,350` — `setBulkFilters` + `markMaterializing` dispatch pattern
- `kinetica_bi/src/store/filterStore.ts:17-40` — `ActiveFilter` `operator: "between"` type
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:249-259` — short-circuit chain insertion point
- `kinetica_bi/src/components/charts/definitions/data-filter.ts` — `ChartTypeDefinition` shape for custom-panel chart types
- `kinetica_bi/src/components/charts/definitions/index.ts` — `registerAllChartTypes` pattern
- `kinetica_bi/src/lib/columnTypes.ts` — exports confirmed; `DATETIME_TYPES` + `NUMERIC_TYPES` are NOT exported (module-private)
- `.planning/phases/44-data-filter-widget/44-VERIFICATION.md` — Phase 44 FILTER-V17 requirements all confirmed satisfied

### Secondary (MEDIUM confidence)

- CONTEXT.md §SQL strategy: "DATE_TRUNC supported for year/quarter/month/week/day/hour; sub-hour needs FLOOR fallback" — consistent with Kinetica documentation conventions
- `kinetica_bi/node_modules/recharts/package.json`: version 2.15.4 confirmed installed

---

## Metadata

**Confidence breakdown:**
- Recharts multi-axis + drag API: HIGH — verified from type definitions in installed package
- Phase 44 dispatch pattern: HIGH — verified from source files
- Color theme API: HIGH — verified from cbColorThemes.ts source
- columnStatsFn datetime limitation: HIGH — verified from columnStatsSql.ts source (line 69)
- DATE_TRUNC interval support: MEDIUM — consistent with standard SQL semantics but not live-tested against deployed Kinetica
- FLOOR-epoch fallback syntax: MEDIUM — standard Kinetica SQL but not confirmed on deployed instance
- Auto-bin algorithm: HIGH — pure algorithm, no external dependencies

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (30 days; Recharts + ColorBrewer are stable libraries)
