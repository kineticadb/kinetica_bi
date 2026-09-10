# Phase 45: Timeline Chart widget - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a new dashboard widget type, **"Timeline Chart"** (`type: "timeline"`), that renders a
multi-metric line chart over time with auto-binning by time interval. Up to 4 metric lines per
widget, each with its own y-axis. Drag-selection on the X-axis emits a `BETWEEN` filter on the
chosen time column via `useFilterStore` (uses the Phase 44 BETWEEN operator), narrowing every
widget on the same table — including the timeline itself.

In scope:
- New chart type registered alongside the other 12 (`timeline`).
- Multi-metric line series (N×`AGG(col)`, max 4) with per-line color + matching y-axis tick
  styling.
- Auto-bin selection from a fixed interval ladder, picking the largest interval that yields
  ≤ `maxIntervals` buckets for the visible time range.
- Drag-to-filter: click-drag horizontal range on the X-axis → emit `operator: "between"`
  filter on the time column.
- Visual feedback: `ReferenceArea` shaded band over the selected range, persisted across
  re-renders while the filter is active.
- Per-line color via theme palette + per-line override (Class Break-style).

Out of scope (this phase): brush-style mini-overview-strip, animated playback / time scrubber,
operator-configurable axis orientation per metric, epoch-integer X-axis support, custom
aggregation operators beyond the existing AGG set.

</domain>

<decisions>
## Implementation Decisions

### Widget shape
- New chart type `timeline`, label "Timeline Chart". Registered via `definitions/timeline.ts`.
- Has its own short-circuit renderer (`TimelineRenderer.tsx`) — NOT the AggregatedWidgetRenderer
  path, because multi-axis + drag-to-filter need full lifecycle ownership (mirrors map / info-card /
  legend / datafilter precedent).
- CustomConfigPanel for the multi-row metric builder + per-line color picker.

### X-axis: time column
- Operator picks ONE column at config time. Eligible column types: `TIMESTAMP`, `DATETIME`,
  `DATE`, `TIME` (the full `DATETIME_TYPES` set in `lib/columnTypes.ts`).
- WHERE clause auto-appends `<timeCol> IS NOT NULL` — rows with NULL time are excluded from
  the chart.

### Y-axis: multi-metric, multi-axis
- Up to **4** distinct metric lines per widget. Each metric = `{ column: string;
  aggregation: "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT" | "STDDEV" | "VARIANCE";
  color: string; label?: string }`.
- Layout: alternate **left / right by index**.
  - Metric 1 → left axis
  - Metric 2 → right axis
  - Metric 3 → left (stacked outside Metric 1)
  - Metric 4 → right (stacked outside Metric 2)
- **Single-metric special case**: when there's only 1 metric, render a single left axis only
  (no right axis reserved).
- **Y-axis tick styling**: both the tick text AND the axis line take the line's color.
  Strongest visual link between line and its axis.

### Auto-bin selection
- **Interval ladder** (coarsest → finest, all DATE_TRUNC-friendly Kinetica intervals):
  `year` / `quarter` / `month` / `week` / `day` / `12h` / `6h` / `hour` / `30min` / `15min` /
  `5min` / `minute`.
- **Auto algorithm**: given the time range R (max − min from `columnStatsFn` against the time
  column on the base/dv table) and operator-set `maxIntervals`:
  walk the ladder coarsest → finest, return the first interval `I` where
  `ceil(R / I) ≤ maxIntervals`.
- Operator-set `maxIntervals` default: **200**. Configurable in the config panel.
- The interval picked is recomputed every render — when the operator drags a filter and the
  range shrinks, the interval may auto-refine.

### SQL strategy
- `DATE_TRUNC('<interval>', <time_col>) AS bucket` per metric query. Kinetica supports
  `DATE_TRUNC` for year/quarter/month/week/day/hour. For sub-hour intervals (30min / 15min /
  5min / minute) the spike output may require an `epoch_seconds` FLOOR fallback — research to
  verify. If only DATE_TRUNC('minute') works, multi-minute sub-hour buckets need the FLOOR
  fallback regardless.
- One query per metric (parallel) — keeps the query simple and lets each metric narrow its own
  WHERE if we ever add per-metric filtering later. **Open question for planner:** could be
  combined into a single multi-AGG query if N metrics share the same WHERE.

### Empty buckets
- **Gap in the line** when a bucket has zero rows. Recharts `LineChart` with a `null` value at
  that x-point produces a visual gap. Best when "no events" and "zero count" are meaningfully
  different (e.g. event counts vs metric averages).
- Note: this is a slight departure from typical bar/aggregated chart behavior which densely
  fills buckets. Operator-visible difference — flag during UAT.

### Drag-to-filter
- Click-drag on the X-axis (mouse-down → mouse-move → mouse-up) defines a time range.
- **Commit on mouse-up**: single materialize cycle per gesture (NOT live during drag — would
  produce N materialize calls per gesture).
- Dispatch via `useFilterStore.setBulkFilters` (single tick) with one `ActiveFilter`:
  `{ column: <timeCol>, value: [from, to], dataType: "datetime", operator: "between",
     sourceWidgetId: <timelineWidgetId> }`.
- **Self-narrowing**: same as drill-down — the timeline ALSO re-queries through the
  materialized view because filters are table-scoped. The timeline rebins on the narrower range,
  giving the operator a zoom-in effect for free.
- **Visual feedback**: persistent shaded `ReferenceArea` on the chart while the filter is
  active. Reads the current applied filter for the time column from `useFilterStore.filters[tableId]`
  and renders the band at the corresponding x-coords.
- **Dismiss**: clicking the × on the FilterBar chip removes the filter; the shaded band disappears
  on the next render (filter subscription pattern, same as Data Filter widget's chip-sync).
- NO dedicated dismiss button on the chart itself.

### Color palette
- **Theme + per-line override**, mirroring Class Break's pattern. Reuse `lib/cbColorThemes.ts`
  themes where applicable; default theme "Tableau-10" (or whichever is the codebase's existing
  default).
- Each line has a `color` field (8-char AARRGGBB hex) that defaults to the theme's color at
  that index. Operator can override with a free color picker per line.
- Y-axis tick text + axis line = same color as the line (computed at render time).

### Config panel UX
- CustomConfigPanel with sections:
  - **Data Source** (table picker — base table or dynamic view; reuses ChartConfigPanel
    optgroup pattern).
  - **Time column** (X-axis): single-select dropdown filtered to DATETIME_TYPES.
  - **Metrics**: N-row builder (1–4 rows). Each row: column picker (numeric) + aggregation
    picker + color swatch + optional label override. Add Row button disabled at 4.
  - **Options**: maxIntervals (number input, default 200), Show legend (boolean, default ON),
    Show tooltip (boolean, default ON), Date format override (free text, default "auto"),
    Color theme picker (dropdown, default "Tableau-10").
- WKT/geometry columns explicitly excluded from both column pickers via `isColumnDrillDownSafe`.

### Dynamic view binding
- Timeline can bind to a base table OR a dynamic view (same picker pattern as other widgets).
- DV-bound queries use the materialized view's bare identifier (Phase 44 follow-up: empty
  schema + viewName as table).
- DV not materialized → widget shows the same "Over threshold" / "Materializing…" / "Error"
  empty state pattern as the AggregatedWidgetRenderer already implements for dv-bound widgets.

### Filter Bar chip integration
- Drag-to-filter dispatches into `useFilterStore` → existing `chipText` builder in
  `lib/columnTypes.ts` (Phase 44) handles the BETWEEN format. Operator sees a chip like
  `pickup_time between '2024-01-01 00:00:00' and '2024-06-30 23:59:59'`.
- **No new FilterBar code needed** — Phase 44's chipText already handles BETWEEN for datetime.

### Post-research decisions (2026-05-29)
- **Default color theme: `Set2`** (8-color ColorBrewer qualitative scheme). The
  earlier "Tableau-10" mention was wrong — that palette is not in the `colorbrewer`
  package the codebase uses via `cbColorThemes.ts`. Set2 reads well on the dark
  dashboard, provides 8 distinct hues (well over the 4-metric cap).
- **Sub-hour intervals ship with FLOOR-epoch fallback**. DATE_TRUNC('minute', col)
  is the preferred path; for multi-minute intervals (5min / 15min / 30min) use
  `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N)` to bucket on N-second
  boundaries. The SQL builder picks the right path per interval; full ladder works.
- **Time-range fetch uses a direct runSql with EXTRACT(EPOCH FROM MIN/MAX(col))**
  NOT columnStatsFn — its response parser asserts finite numbers and Kinetica
  datetime MIN/MAX returns strings. The renderer issues a one-shot query
  `SELECT EXTRACT(EPOCH FROM MIN(<timeCol>)) AS lo, EXTRACT(EPOCH FROM MAX(<timeCol>)) AS hi FROM <fromTarget>`
  and plugs the numeric epochs straight into the auto-bin algorithm. `<fromTarget>`
  honors empty-schema (dv-bound) per Phase 44 follow-up.
- **Column-picker filters use `inferDataTypeFromColumn()`** — `DATETIME_TYPES` and
  `NUMERIC_TYPES` are private sets inside `lib/columnTypes.ts`; the public API is
  the inference function. Time-col picker filters where `inferDataTypeFromColumn(c, columns) === "datetime"`;
  metric-col picker filters where it === "number".

### Claude's Discretion
- Exact Recharts component composition (LineChart with multiple `<YAxis yAxisId="...">` +
  `<Line yAxisId="..." />` + `<ReferenceArea>` for the drag selection).
- Tooltip content layout — default to Recharts' built-in (all series at hover x). Custom
  tooltip styling to match dashboard dark theme.
- Legend position — default to `bottom`. Operator can toggle visibility only.
- Date format default — "auto" means a smart format that picks based on the auto-selected
  interval (interval=day → "MMM D", interval=hour → "MMM D HH:00", interval=minute → "HH:mm").
- Drag-selection's pixel-to-time-value conversion logic (Recharts' brush + onMouseDown / Move /
  Up coordinates on the chart wrapper).
- Sub-hour DATE_TRUNC fallback strategy — research first; pick the cleanest path.
- Behavior when operator picks the SAME column twice across metrics (allowed; produces two
  lines with different aggregations on the same column).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Filter store + BETWEEN operator (Phase 44 — drag-to-filter integration target)
- `kinetica_bi/src/store/filterStore.ts` — `ActiveFilter` type with `operator?: "eq" | "in" | "between" | "isNull"` discriminator. The drag-to-filter dispatches a BETWEEN filter via `setBulkFilters`.
- `kinetica_bi/src/lib/columnTypes.ts` — `buildChipText()` already handles BETWEEN for datetime; no new chipText code needed for the FilterBar.
- `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause` BETWEEN path (Phase 44). Materialize-time WHERE for the drag filter goes through this.

### Existing renderer precedents
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — short-circuit pattern (map / records / info-card / legend / datafilter all have their own renderers); add `timeline` branch alongside `datafilter`.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — precedent for a full-lifecycle widget that subscribes to filter / dv stores and renders its own SQL/queries.
- `kinetica_bi/src/components/charts/DataFilterRenderer.tsx` — Phase 44 precedent for `setBulkFilters` dispatch + `markMaterializing` synchronous-tick pattern.

### Chart type registration
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` shape.
- `kinetica_bi/src/components/charts/definitions/index.ts` — call `registerTimeline()`.
- `kinetica_bi/src/components/charts/definitions/datafilter.ts` — closest precedent (custom config panel + custom renderer + `usesAggregation: false`).

### Column / type metadata
- `kinetica_bi/src/lib/columnTypes.ts` — `DATETIME_TYPES` set for X-axis picker; `NUMERIC_TYPES` for metric column pickers; `isColumnDrillDownSafe` for excluding WKT/geometry/large-text.
- `kinetica_bi/src/api/client.ts` — `columnStatsFn` for fetching `{min, max}` of the time column to compute the auto-bin interval.

### Existing Line widget (for visual reference, NOT inheritance)
- `kinetica_bi/src/components/charts/definitions/line.ts` — the existing single-metric line chart's config schema. Some fields (showLegend / showTooltip / curved) translate directly.

### Color themes
- `kinetica_bi/src/lib/cbColorThemes.ts` — Class Break color themes. Reuse same theme dropdown + per-line override pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`useFilterStore.setBulkFilters` + `markMaterializing`** — Phase 44 added these; drag-to-filter
  uses the exact same dispatch pattern.
- **`columnStatsFn`** — already used by Class Break + Data Filter for min/max; same call shape
  works for the time column.
- **`buildChipText` (Phase 44)** — already handles BETWEEN format for datetime; no FilterBar
  changes needed.
- **`CbColorThemes`** — reusable theme dropdown + palette colors.
- **Recharts `LineChart` + `<YAxis yAxisId>`** — Recharts natively supports multi-axis. Existing
  `Line` widget shows the basic Recharts integration.
- **`ReferenceArea`** — Recharts built-in for the shaded selection band; no custom SVG needed.

### Established Patterns
- **Short-circuit renderer**: `WidgetRenderer.tsx` if-branches before `AggregatedWidgetRenderer`.
  Timeline = `if (widget.type === "timeline") return <TimelineRenderer ... />`.
- **CustomConfigPanel**: bypass `ChartConfigPanel`'s generic field rendering when the panel
  needs custom rows/builders. Pattern in `LegendConfigPanel` / `DataFilterConfigPanel` / map.
- **Phase 44 sole-materialize-trigger lock**: only `AggregatedWidgetRenderer` calls
  `materializeFilter()`. **Timeline must NOT** — dispatch into the store + `markMaterializing`
  synchronously; let the existing materialize trigger fire.
- **Dv-aware data source**: KineticaWmsLayerForm + DataFilterConfigPanel patterns for handling
  `tableRef` vs DV materialized view name.

### Integration Points
- **No FilterBar changes** — BETWEEN chip text already formatted by Phase 44 chipText.
- **No store changes** — `setBulkFilters` + ActiveFilter operator discriminator already in place.
- **No new endpoints** — DATE_TRUNC SQL fits the existing `runSql` proxy. If sub-hour binning
  needs an epoch FLOOR fallback, that's a SQL-builder library addition (`buildTimelineSql.ts`),
  not a new endpoint.
- **WidgetRenderer.tsx**: short-circuit branch + register chart type in definitions/index.ts.

### Potential gotchas (flag in research)
- **Recharts ReferenceArea drag UX**: native Recharts examples use `onMouseDown / onMouseMove /
  onMouseUp` on the wrapper to capture a pixel range, then translate via `dataXValue` accessor.
  Research the exact pattern in current Recharts docs for the time-axis specifically.
- **DATE_TRUNC sub-hour support on deployed Kinetica**: confirm whether `DATE_TRUNC('minute', ...)`
  exists, and whether multi-minute intervals (5min / 15min / 30min) need FLOOR(epoch / N) * N.
  Research output: capability matrix per interval.
- **Time column WHERE composition**: when the drag-filter is active, the timeline's OWN
  WHERE clause needs to honor the BETWEEN filter from the materialized view. Since the materialize
  pipeline produces a view with the filter already applied, the timeline just queries `FROM <view>` —
  no extra client-side WHERE handling needed. Confirm.
- **Auto-bin re-computation on filter change**: when a BETWEEN narrows the range, recomputed
  interval should be from the FILTERED range, not the BASE range. So `columnStatsFn` runs against
  the materialized view (not the base table) for the time column's min/max. Counter to the Data
  Filter widget's "always base table" rule — this is intentional because the timeline IS supposed
  to zoom in.

</code_context>

<specifics>
## Specific Ideas

- "Pick up where Phase 44 left off" — drag-to-filter is the showcase use of the BETWEEN operator
  that was added in Phase 44 specifically for this purpose. The exact dispatch shape mirrors
  what Data Filter widget does on Apply.
- Single-metric chart should "look like the existing Line widget but with time-bucketing." Operators
  shouldn't perceive a major UX gap between single-metric Timeline and the existing simple Line.
- "Click and drag time values across the x axis" — operator's mental model is a horizontal brush
  on the time axis. Recharts' ReferenceArea + manual pointer event capture is the right primitive.
- "Each calculation should also show its own y-axis range as the values can differ" — explicitly
  multi-axis, NOT a normalized 0-1 overlay.

</specifics>

<deferred>
## Deferred Ideas

- **Brush-strip mini-overview** below the main chart for navigation (Recharts `<Brush>`) — could
  combine with the drag-to-filter but adds visual complexity. Defer.
- **Animated playback** / time scrubber across the timeline. Defer to a future "Timeline Cinema"
  phase if there's demand.
- **Per-metric WHERE filters** — operator narrows Metric 1's rows but not Metric 2's. Adds
  significant UI + SQL surface; defer.
- **Custom aggregation operators** beyond the standard set (e.g. PERCENTILE / RATE-OF-CHANGE).
  Defer.
- **Epoch-integer X-axis support** — INT/LONG columns flagged as Unix seconds/ms. Needs schema
  metadata pathway. Defer.
- **Sub-hour intervals if DATE_TRUNC doesn't support them on deployed Kinetica** — research
  outcome may push to FLOOR-epoch fallback. If FLOOR adds complexity, defer sub-hour entirely
  (operator can pick `hour` as the finest interval and live with it).
- **5th+ metric** — config panel hard-caps at 4. Adding a 5th would crowd the y-axes.
- **Per-metric axis-side picker** (left vs right operator choice). Alternating by index is
  predictable; explicit picker is a follow-on if it becomes a real ask.
- **Stacked vs grouped lines** (stacked area chart variant). Different chart shape; future
  "Stacked Area Timeline" widget if requested.

</deferred>

---

*Phase: 45-timeline-chart-widget*
*Context gathered: 2026-05-29*
