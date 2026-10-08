# Phase 132: Line Chart Multi-Series Group By - Research

**Researched:** 2026-10-08
**Domain:** Recharts 2.15.4 LineChart renderer + ChartConfigPanel multi-column Group By builder (React/Vite/zustand, in-repo)
**Confidence:** HIGH (every claim below is backed by file:line in this repo or by the installed Recharts 2.15.4 source; the few LOW items are called out)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Group By (LINE-V126-01)**
- **D-01: Reuse the bar chart's multi-column Group By Columns builder** (`ChartConfigPanel.tsx` ~824-890) for the Line Chart, with the same `groupByColumns` model, the `usesMultiColumnGroupBy` gate and the `toBarPivotInput`/`selectTopSeries`/`pivotSeriesRows` helpers (already chart-agnostic).
- **D-02: Column 1 is REQUIRED** and is the X-axis category. The config cannot be applied without it; validation states that, using the existing panel validation pattern.
- **D-03: Columns 2+ are optional.** Each distinct value (or combination, for 3+ columns, joined the way the bar chart builds series keys) draws one line.
- **D-04: Same series cap and note as bars.** Use `maxBarGroupBySeriesCap` (deploy-wide) and the "Showing top N of M series" note (`bar-truncated-note` pattern).
- **D-05: Existing Line Charts are migrated without a visible change.** Today's single Group By becomes column 1; metric and aggregation are unchanged; saved dashboards render as before. A Line Chart saved with NO Group By renders as today until edited, and editing then requires column 1.

**Missing points (ROADMAP criterion 5)**
- **D-06: Gap, not zero.** When a series has no value at an X category, the line breaks there (`connectNulls={false}`), matching the Timeline chart. A lone point between gaps shows as a dot. The tooltip lists only the lines that have a value at that X. The operator verifies this in light and dark mode at the phase checkpoint.

**X-axis labels (LINE-V126-02)**
- **D-07: Show every category label.** Override Recharts' default tick thinning (`interval={0}` or equivalent). When labels would overlap, tilt them -45°. When there are too many to fit legibly, the chart scrolls horizontally, using the same approach as the bar chart's min-bar-size scroll region. The X order follows the data order the chart already uses (category sort as today).

**Legend & tooltip naming (LINE-V126-03)**
- **D-08: Multi-series.**
  - Legend entries are the series values (e.g. Cash, Credit).
  - The tooltip header is the X value, with one line per series reading "Cash: 12,400".
  - The metric name appears as the **Y-axis label**: the Format-columns label for the metric column if set, else "<Aggregation> of <column>", e.g. "Sum of fare_amount".
- **D-09: Single-series.** The legend shows the metric name (the same resolution as D-08, honouring the existing `yFieldLabel`). It never shows the literal `value`.

**Drill-down (LINE-V126-04)**
- **D-10: Same as the multi-series bar chart.** Clicking a point drills on **Group By column 1 = the clicked X category** (`WidgetRenderer.tsx` ~1097-1114: bucket value, `groupByColumns[0]`, `dispatchDrillDown`, 300 ms). The series column is not added to the filter.

**Series look**
- **D-11: Same palette as the bar chart's multi-series**, so the same value gets the same color across bar and line.
  - Dots on points when X values are few, hidden when dense (threshold at Claude's discretion).
  - The existing Line Width setting applies to every line.
  - No new color-theme picker.

### Claude's Discretion
- The dot-density threshold. The exact angle/scroll trigger thresholds and minimum per-category width.
- Where the migration lives (read-time normalisation vs config migration). It must be lossless and not change saved JSON unexpectedly.
- Whether LineRenderer shares code with BarRenderer's series loop or ports it.
- Rewording LINE-V126-01 to add "Group By column 1 is required" (the last plan does it by hand in REQUIREMENTS.md).

### Deferred Ideas (OUT OF SCOPE)
- Merging Line Chart and Numeric Line Chart, or renaming them so their purposes are clearer in the picker (the operator noticed they look like duplicates).
- A Timeline-style metrics builder (max 4) on the plain Line Chart: not needed, since Numeric Line covers it.
- A per-widget "missing values: gap / connect / zero" setting.
- Pre-existing bug (Phase 58): records `page_size` widget-action override is a no-op (`page_size` vs `pageSize`). Logged in STATE; unrelated to this phase.

Also NOT in this phase: numeric X-axis picker, multi-metric builder on the Line Chart, any change to `numericline.ts`/`NumericLineConfigPanel.tsx`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LINE-V126-01 | Line chart has bar's Group By Columns builder; a 2nd column draws one line per value | SQL is built client-side in `ChartConfigPanel.generatedSql` (NOT a server builder); the multi-column branch is already gated on `isMultiColumnBarGroupBy(draft)` and works for line unchanged EXCEPT the LIMIT line `isBar ? ...` (ChartConfigPanel.tsx:441), which must include line or multi-series line gets `LIMIT 100`. Builder gating via `usesMultiColumnGroupBy` (:352). Sections 1, 3. |
| LINE-V126-02 | Every x-axis category label is shown | Root cause confirmed in Recharts source: XAxis default `interval` is `'preserveEnd'` (CartesianAxis.js:357) which thins ticks via DOM text measurement (getTicks.js:119-148); a numeric `interval={0}` short-circuits to "every tick" (getTicks.js:119-120). `angle`/`textAnchor` are whitelisted tick props. Section 5. |
| LINE-V126-03 | Legend shows the metric's name, not `value` | Today's Line `name` fallback chain bottoms out in `y` = `"value"` for custom metrics (no `metricColumn`) and when `tableId` is undefined (WidgetRenderer.tsx:1403-1404/1437-1438 area). LineRenderer also lacks the custom-metric store subscription BarRenderer has. New pure helper `resolveLineMetricTitle`. Sections 4, 9. |
| LINE-V126-04 | Click on a multi-series line point drills like the multi-series bar | Port BarRenderer's multi branch (WidgetRenderer.tsx:1097-1114). `drillDownColumn` auto-follows col 1 already (ChartConfigPanel.tsx:667-672 + builder `set("groupByColumn", next[0])`). One typing divergence to decide (Section 6). |
</phase_requirements>

## Summary

The work is almost entirely **client-side, in two files plus three small new libs**. There is no server SQL builder to change: the aggregated widget's SQL is generated in the browser by `ChartConfigPanel.generatedSql` (ChartConfigPanel.tsx:358-496), frozen into `config.sql` at Apply (:1066-1085), and `AggregatedWidgetRenderer` just runs `config.sql` (re-resolving custom-metric expressions live). The server only knows `groupByColumns[]` for schema-sync column-reference scanning (`server/src/lib/columnRefs.ts:756-766`), which is already chart-type-agnostic. So: no server change, no migration of stored JSON.

The multi-column SQL branch is gated on `isMultiColumnBarGroupBy(draft)` (length >= 2), not on chart type, so a line config with 2+ `groupByColumns` already generates `SELECT a, b, AGG(m) AS value ... GROUP BY a, b ORDER BY value ... LIMIT n`. The ONE SQL edit is the LIMIT multiplier (`isBar` at :441), which must become `isBar || isLine` or a multi-series line is silently capped at `Result limit` (100 default) rows, producing spurious gaps. The pivot helpers (`toBarPivotInput`, `selectTopSeries`, `pivotSeriesRows`) are truly chart-agnostic (pure, key `"bucket"`, separator `" / "`), with two caveats the UI-SPEC does not mention: `pivotSeriesRows` sorts buckets **lexically** (so numeric X categories order "1, 10, 2"), and `isMultiColumnBarGroupBy` does **not** check that column 2 is non-empty (so a blank "+ Add column" row yields a phantom series literally named `"undefined"`).

Recharts 2.15.4 (installed; npm latest is 3.10.1, do NOT upgrade, project pins `^2.10.3`) supports everything the UI-SPEC needs: `interval={0}`, `angle`/`textAnchor`, `connectNulls={false}`, and a per-point `dot` function. A lone point between nulls is NOT drawn by `dot={false}` and the line draws no segment for it; the UI-SPEC's custom per-point `dot` renderer is the correct and only practical mechanism (Line.renderDots maps ALL points including null ones, so the renderer must guard `cx/cy == null`). The Recharts `Tooltip` already filters null-valued entries (`filterNull` default `true`, Tooltip.js:65-67) BEFORE handing `payload` to custom `content`, so the UI-SPEC's "omit series without a value" needs no `ColumnFormatTooltip` change; only the `singleSeries` relabel trap needs a guard.

**Primary recommendation:** Keep `LineRenderer` inside `WidgetRenderer.tsx` (it needs `resolveKeys`, `toCssColor`, `dispatchDrillDown`, `DrillProps`; extraction would create a circular import), put all new pure logic (`resolveLineMetricTitle`, x-axis layout math, isolated-point test, blank-filtering group-by accessor, AGGREGATIONS labels) in new `packages/web/src/lib/*.ts` files with their own specs, add an optional `multiSeries?: boolean` prop to `ColumnFormatTooltip`, and write the behavioral LineRenderer tests in a NEW spec file with a prop-capturing recharts mock (the existing WidgetRenderer.spec mock strips `interval`, `connectNulls`, `dot`, `onClick`).

## Standard Stack

### Core (all already installed; NO new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 2.15.4 installed (`^2.10.3` in packages/web/package.json:32). npm `latest` = 3.10.1 (modified 2026-10-03). Do not upgrade in this phase. | LineChart/Line/XAxis/YAxis/Legend/Tooltip | Already the chart lib for every renderer; Timeline already uses `connectNulls={false}` (TimelineRenderer.tsx:690-715) |
| react / zustand / vitest / @testing-library | existing | UI + stores + tests | existing conventions |

### Existing in-repo helpers to REUSE (do not rewrite)
| Helper | Location | Use |
|--------|----------|-----|
| `toBarPivotInput`, `BAR_SERIES_SEPARATOR` (`" / "`), `isMultiColumnBarGroupBy` | packages/web/src/lib/barGroupedSeries.ts:8,17,35 | rows -> `{bucket, series, value}` |
| `selectTopSeries`, `pivotSeriesRows` | packages/web/src/lib/groupedSeries.ts:61,98 | rank/cap series; pivot to `{bucket, [series]: n or null}` |
| `themeColorsFor`, `getCbColorTheme` | packages/web/src/lib/cbColorThemes.ts:92 / :80 | palette by series index |
| `DEFAULT_COLOR_THEME` ("Set2") | TimelineConfigPanel.tsx (imported WidgetRenderer.tsx:93) | line has no `colorTheme` field; always resolves "Set2" |
| `useChartAxisColors` | lib/chartColors.ts:23 | grid/axis colors; already in LineRenderer |
| `estimateValueAxisWidth`, `estimateLabelWidth` | lib/estimateAxisWidth.ts (WidgetRenderer.tsx:69; HeatmapRenderer.tsx:24,267) | optional y-axis sizing; heatmap precedent for rotated labels (6.6 px/char) |
| `resolveLabel`, `resolveFormatter` | store/columnDisplayConfigStore.ts:151/160 | `resolveLabel` FALLS BACK TO THE RAW COLUMN NAME when unset (compare to detect "unset") |
| `resolveMetricLabel`, `isCustomSelection` | lib/customMetricSql.ts:96 / :23 | custom-metric label |
| `useAuthStore((s) => s.maxBarGroupBySeriesCap)` | store/auth | series cap (default 12) |
| `ColumnFormatTooltip` | components/charts/ColumnFormatTooltip.tsx | tooltip |

### New files recommended
| File | Contents |
|------|----------|
| `packages/web/src/lib/aggregationLabels.ts` | `export const AGGREGATIONS` (moved out of ChartConfigPanel.tsx:84-92, which re-imports it) + `aggregationLabel(value)` |
| `packages/web/src/lib/lineChartTitle.ts` (or one `lineChart.ts`) | `resolveLineMetricTitle(...)` pure |
| `packages/web/src/lib/lineChartLayout.ts` | `LINE_CATEGORY_SLOT_PX`, `LINE_MIN_PLOT_PX`, `LINE_DOT_DENSITY_MAX`, `computeLineXAxisLayout`, `isIsolatedLinePoint`, `lineGroupByColumns` |
| specs next to each + `WidgetRenderer.line.spec.tsx` | see Validation Architecture |

**Installation:** none. **Version verification:** `cat node_modules/recharts/package.json` -> 2.15.4 (checked); `npm view recharts version` -> 3.10.1 (checked 2026-10-08; 3.x has breaking changes to Tooltip/activePayload internals, so staying on 2.x is correct).

## Architecture Patterns

### 1. Data path (answers research Q1) - HIGH
```
ChartConfigPanel (draft.groupByColumns: string[], draft.groupByColumn = col1 mirror)
  -> generatedSql useMemo (ChartConfigPanel.tsx:358-496)           <-- SQL built HERE, in the browser
       isMultiColumnBarGroupBy(draft) -> multi branch (:416-470):
         SELECT c1, c2, [..], AGG(m) AS value FROM t[ WHERE (customWhere)] GROUP BY c1, c2, [..]
         ORDER BY value <dir> LIMIT <sqlLimit>                       (alias NEVER in GROUP BY: Kinetica pitfall)
  -> Apply: baseConfig = {...draft, sql: generatedSql, drillDownColumn, drillDownColumnType}  (:1066-1085)
  -> AggregatedWidgetRenderer runs cfg.sql (fromSwap for filter views; custom-metric expr re-resolved live,
     WidgetRenderer.tsx:431-444); heatmap-only LIMIT+1 probe (:667); everyone else gets chartLimitedRows
     "Limited to N rows" from the server's has_more_records (:688-691, :904-922) -- AUTOMATIC for line.
  -> LineRenderer: toBarPivotInput -> selectTopSeries({max: cap}) -> pivotSeriesRows -> chartData (xKey "bucket")
```
What must change for line:
1. **LIMIT multiplier** (ChartConfigPanel.tsx:441-445): `const sqlLimit = isBar ? baseLimit * cap * 2 : isHeatmap ? ... : baseLimit;` -> `(isBar || isLine)`. Without this a 2-column line gets `LIMIT 100`. Default result: 100 x 12 x 2 = 2400 rows; max picker 500 x 12 x 2 = 12,000 < `KINETICA_MAX_ROWS_PER_QUERY` default 20,000 (server/src/kinetica.ts:188, :246), so Phase 127's server clamp only bites if an operator raises `MAX_BAR_GROUP_BY_SERIES` above ~33. If it does bite, the existing generic "Limited to N rows" notice already appears for line/bar (no work).
2. **Dep array** of the `useMemo` (:496) needs nothing new if `isLine` derives from `widgetType` (a prop), but add `isLine`/`isBar` for lint hygiene if the file's lint cares.
3. **Single-column path untouched**: 1 column (or blank-filtered 1) -> falls to legacy `SELECT g, AGG(m) AS value ... LIMIT <limit>` (byte-identical, D-05).
4. **RISK (new, not in UI-SPEC):** `ORDER BY value DESC LIMIT n` keeps the highest-value (x, series) pairs globally (Phase 102 RESEARCH Pitfall 2). Bar tolerates this; a LINE with high-cardinality X (e.g. a date column with thousands of values x several series) will silently drop the lowest-value points, which then render as **gaps indistinguishable from "no data"**. The own-LIMIT is not detected by Phase 127's notice (that only reads the SERVER's `has_more_records`). Mitigation inside scope: none required beyond documenting it; add it to the human-verify checkpoint wording. Out of scope (do not build): a heatmap-style `bumpTrailingLimit`/`detectTruncation` probe for line (it exists in `lib/rowTruncation`, usable later). Record as an Open Question.

**Pivot helper chart-agnosticism check (verified by reading the code):**
- Pure, zero React/Recharts imports (barGroupedSeries.ts header; groupedSeries.ts header). X key is the literal `"bucket"`; series key is `restCols.map(String).join(" / ")`.
- `pivotSeriesRows` emits **`null`** for missing combos (groupedSeries.ts:121), not `undefined`. Recharts `Line.getComposedData` uses `isNil(value)` (Line.js:489) so null and undefined are equivalent. UI-SPEC "undefined vs null" worry is moot.
- **Caveat A - bucket sort is lexical** (`buckets.sort()` groupedSeries.ts:110) unless `{numericBuckets: true}`. So multi-series X order = lexical string order (dates in ISO format order correctly; "1,2,10" order wrong; day names alphabetical). Single-series line keeps SQL order (`ORDER BY value`). CONTEXT D-07 says "data order the chart already uses". Recommendation: call `pivotSeriesRows(pivotInput, top.series, { numericBuckets: allBucketsNumeric })` where `allBucketsNumeric` = every distinct bucket string is a finite number (guard against NaN comparator on mixed input). Otherwise stay lexical = bar parity. Flag to planner as an explicit decision (Open Question 2).
- **Caveat B - blank column entries.** `isMultiColumnBarGroupBy` is only `Array.isArray && length >= 2` (barGroupedSeries.ts:17-20). `+ Add column` appends `""` (ChartConfigPanel.tsx:889). Config `["region", ""]` -> SQL filters blanks (`cols = ...filter(Boolean)` :416) but the renderer's `toBarPivotInput` reads `r[""]` -> `"undefined"` -> one phantom legend entry "undefined". The UI-SPEC says "multiSeries = groupByColumns.length >= 2 with non-empty col 2 (reuse isMultiColumnBarGroupBy)" but that helper does NOT check non-empty. Fix: in LineRenderer derive `const groupByColumns = lineGroupByColumns(config)` = `(Array.isArray(config.groupByColumns) ? config.groupByColumns : []).map(String).filter(Boolean)` and `multiSeries = groupByColumns.length >= 2`. Do not call `isMultiColumnBarGroupBy` from LineRenderer. (Bar has this latent bug; fixing bar is out of scope.) Pass the filtered array to `toBarPivotInput`.
- Collision note: `" / "` inside a value merges series; accepted (Phase 102 Pitfall 3).

### 2. Config migration (D-05) (answers Q2) - HIGH
**Current line shape:** `definitions/line.ts` has NO group-by field. `groupByColumn` (string) and `metricColumn`/`aggregation`/`metricId`/`sortDir`/`limit` are injected by ChartConfigPanel's generic aggregation controls, not by the registry. `defaultConfig` has no `groupByColumns`.
**How bar did it (Phase 102):** NO data migration. `bar.ts:57` adds `groupByColumns: [] as string[]` to `defaultConfig`; the builder **seeds** from legacy `groupByColumn` at read time (ChartConfigPanel.tsx:832-835), the first edit writes BOTH `groupByColumns` and the mirror `groupByColumn = next[0]` (:861-862, :878-879, :890-891), and the renderer gates on `isMultiColumnBarGroupBy(config)` falling back to the legacy path.
**Recommendation (lossless, zero JSON rewrite): copy bar exactly.**
- `line.ts`: add `groupByColumns: [] as string[]` to `defaultConfig` (comment like bar's). Legacy widgets merge `{...defaults, ...config}` (ChartConfigPanel.tsx:133-135) -> `groupByColumns: []`, builder seeds `[groupByColumn]`.
- Renderer: single-series path = exactly today's code path (`resolveKeys` + `config.groupByColumn`); multi-series only when >= 2 NON-BLANK columns.
- Saved JSON is untouched until the operator opens, edits and Applies; then `groupByColumns: ["col"]` + `groupByColumn: "col"` + a regenerated `sql` (byte-identical single-column SQL, ChartConfigPanel.spec Test 1 pattern).
- **D-05 empty-builder seeding:** the existing builder renders ZERO rows when seeded array is empty (bar tests pass `groupByColumns: [""]` to see a select, ChartConfigPanel.spec.tsx:484). For line, seed `[""]` when both `groupByColumns` is empty and `groupByColumn` is falsy so the required X row is visible (UI-SPEC "New Line widget" state). Seeding expression: `stored?.length ? stored : draft.groupByColumn ? [draft.groupByColumn] : isLine ? [""] : []`.
- **Hoisting needed:** the seeded array is currently a local inside the builder IIFE (:832-835). `lineMissingXColumn` (Apply `disabled`, :1054) needs it, so hoist the seeding into a top-level `const effectiveGroupByColumns` defined AFTER `usesMultiColumnGroupBy` (:352). **TDZ pitfall:** UI-SPEC says define `lineMissingXColumn` "beside `customPanelValid` (:125)", but `isLine`/`requiresGroupBy` are `const`s declared at :341-352; referencing them at :125 throws ReferenceError at render. Declare `lineMissingXColumn` after :352.
- A legacy line saved with NO group-by: `groupByColumn` undefined -> renders as today (`data` rows, `resolveKeys` falls back to `keys[0]`; SQL was `SELECT * FROM t LIMIT 100`); opening the panel shows the required error and blocks Apply (D-05 second sentence). Unedited legacy widget never goes through ChartConfigPanel, so nothing blocks rendering.

### 3. ChartConfigPanel wiring (answers Q3) - HIGH
Exact edit list (all in packages/web/src/components/charts/ChartConfigPanel.tsx):
| Line | Edit |
|------|------|
| 346 | add `const isLine = widgetType === "line";` |
| 352 | `usesMultiColumnGroupBy = isBar \|\| isTable \|\| isHeatmap \|\| isLine;` (automatically removes line from the single `Group By` select at :907 because that branch is `requiresGroupBy && !usesMultiColumnGroupBy`) |
| 356 | `MAX_BAR_GROUP_BY_COLUMNS = isHeatmap ? 2 : 6` unchanged (line gets 6) |
| 441 | LIMIT multiplier: `isBar \|\| isLine` |
| 838-843 `labelFor` | add line branch BEFORE `isBar`: idx 0 -> `"X axis"`, idx>=1 -> `` `Series dimension ${idx}` `` (note heatmap uses "X Axis" capital A; test via `getByLabelText("X axis")`, exact-case string match) |
| 894-900 help text | add line string per UI-SPEC |
| after help | the `role="alert"` required-column `config-hint` span (UI-SPEC; NOT `config-hint-warning`, which has no CSS) |
| 872-881 | `aria-label="Remove column"` on `×` (verified: no spec queries the `×` button by name; `grep '×'` over *.spec.tsx finds none for this panel). Consider `` `Remove ${labelFor(idx)}` `` to disambiguate N identical names. |
| 1054-1055 | `disabled={!customPanelValid \|\| lineMissingXColumn}`; `title={lineMissingXColumn ? "Group By column 1 is required" : (!customPanelValid ? "Add at least 2 break rows" : undefined)}` |
| 84-92 | replace local `AGGREGATIONS` with import from the new lib |
Behavior for other chart types is unchanged because every new branch is guarded by `isLine`; `requiresGroupBy` for line is true by default (`chartDef?.requiresGroupBy !== false`, :341; `line.ts` does not set it).
Drill column: `defaultDrillDownColumn` for line = `draft.groupByColumn` (:667-672 `drillFollowsGroupBy`), and the builder keeps `groupByColumn = col1`, so `drillDownColumn`/`drillDownColumnType` persist as col 1 with no extra work. A new Line widget therefore has `drillEnabled` as soon as col 1 is chosen.

### 4. ColumnFormatTooltip `singleSeries` trap (answers Q4) - HIGH
Exact line: ColumnFormatTooltip.tsx:101 `const singleSeries = payload.length === 1;` used at ~:125 `singleSeries && metricLabel != null ? metricLabel : entry.name`.
Trap (UI-SPEC confirmed): in multi-series at an X where only one series has a value, Recharts' `filterNull` leaves `payload.length === 1`, so the line would be relabelled with the metric label instead of "Cash".
**Guard change (backward-safe):** add optional prop `multiSeries?: boolean` to `ColumnFormatTooltipProps`; `const singleSeries = multiSeries === undefined ? payload.length === 1 : !multiSeries;`. Line multi passes `multiSeries`; line single passes `multiSeries={false}` or omits it. Other consumers (TimelineRenderer.tsx:720, NumericLineRenderer.tsx:686, BarRenderer WidgetRenderer.tsx:1203, Pie/Scatter/Area at :1402/1429/1595/1690) pass nothing -> `undefined` -> identical legacy behavior. Existing spec cases to keep green: ColumnFormatTooltip.spec.tsx:211 ("multiple payload entries with name prefix"), :242 ("single-series ... metric label, not slice name"). Add: payload.length===1 + `multiSeries` -> shows `entry.name`; omitted -> metric label (regression).
Related (optional, planner discretion): for a REAL metric column with no Format-columns label, `resolveLabel` returns the raw column, so the single-series tooltip line reads `fare_amount: 1,234` while the legend/axis read `Sum of fare_amount`. If wanted, add an optional `metricTitle?: string` prop used instead of `metricLabel` when present (pass `yTitle`). D-09 only mandates the legend, so this is a polish choice. The tooltip also formats via `resolveFormatter(tableId, metricColumn)` only; custom metrics have no formatter (unchanged).
**No null filtering needed in ColumnFormatTooltip** for the real chart: Recharts `Tooltip` defaults `filterNull: true` and filters `entry.value != null` before `renderContent` (node_modules/recharts/es6/component/Tooltip.js:65-67, :85-87). The UI-SPEC's "if Recharts still includes it, filter inside the tooltip" contingency is not needed; still ADD the "series absent at hovered X" spec but assert it against the real Recharts `Tooltip`/payload contract at unit level (see Validation) rather than the jsdom mock (the WidgetRenderer.spec Tooltip mock injects a fixed 1-entry payload and bypasses filterNull).

### 5. Recharts specifics (answers Q5) - HIGH (installed source read) except where noted
- **Version:** 2.15.4.
- **`interval={0}`:** numeric interval -> `getNumberIntervalTicks(ticks, 0)` = every tick (cartesian/getTicks.js:119-120, util/TickUtils.js:36-38). Default `'preserveEnd'` (CartesianAxis.js:357) measures text via DOM and drops overlapping ticks; in jsdom measurement returns 0 so tests can NEVER observe the thinning; assert the prop instead.
- **Angled ticks:** both `angle` and `textAnchor` survive `filterProps` (util/types.js whitelist includes `'angle'`, `'textAnchor'`), applied either as `<XAxis angle={-45} textAnchor="end" .../>` or inside `tick={{ angle: -45, textAnchor: "end", fontSize: 11, fill }}`. `height` is a plain XAxis prop and is NOT auto-sized by Recharts, hence the UI-SPEC's label-derived height. Keep `tickMargin` default.
- **`connectNulls={false}`:** already the Recharts default (`Line.defaultProps.connectNulls: false`, Line.js:443); set it explicitly for intent + greppability. null and undefined both treated as missing (`isNil`, Line.js:489).
- **Lone point (the UI-SPEC question):** `Line.render` draws dots only when `(hasSinglePoint || dot)` (Line.js:388), where `hasSinglePoint = points.length === 1` (whole-array length, NOT "isolated run"). With `dot={false}` no dot is drawn and the null-bounded point has no segment, so it is INVISIBLE. `renderDots` maps **every** point including null ones (Line.js:193-206, `cx: entry.x, cy: entry.y` which are `null` for missing values; `points` retains nulls, Line.js:478-506) and passes `index`, `points`, `cx`, `cy`, `stroke`, `key` to a custom `dot` function (`renderDotItem`, Line.js:420-424). So the **custom dot renderer is the right implementation**:
```tsx
// Source: recharts 2.15.4 es6/cartesian/Line.js renderDots/renderDotItem (read from node_modules)
const makeLineDot = (showDots: boolean, dense: boolean) => (p: any) => {
  const { key, cx, cy, index, points, stroke } = p;
  if (cx == null || cy == null) return <g key={key} />;            // null point: draw nothing (must return an element for TS DotType)
  const isolated = isIsolatedLinePoint(points, index);              // prev.y == null && next.y == null (out-of-range neighbour counts as null)
  if (isolated || (showDots && !dense)) return <circle key={key} cx={cx} cy={cy} r={3} fill={stroke} />;
  return <g key={key} />;
};
```
  `fill={stroke}` carries the series color (no hex literal; theme-guard stays green). Pass `activeDot={{ r: 5 }}` always. Pure `isIsolatedLinePoint(points, i)` goes in the lib so it is unit-tested without Recharts. TS: Recharts' `dot` type requires `ReactElement<SVGElement>` from the function, so return an empty `<g/>` rather than `null`.
- **Dot density scope ambiguity (UI-SPEC vs D-05):** the UI-SPEC table applies "hidden when n > 24" without scoping to multi-series, but D-05 says legacy single-series lines must render exactly as today (today: `dot={showDots ? {r:3} : false}` at any n). Recommendation: apply the density rule and custom renderer in **multiSeries only**; keep the legacy single-series `dot` literal untouched. Flag in Open Questions.
- **Text measurement in jsdom vs browser:** do not measure text (UI-SPEC says so). Layout is pure arithmetic on `n`, `maxLabelChars` and the measured WRAPPER width. Measure width with the guarded ResizeObserver pattern from HeatmapRenderer.tsx:90-103 (`typeof ResizeObserver === "undefined"` guard; jsdom has none and `clientWidth` is 0, so the fallback `tilt = n > 8`, no scroll applies in tests unless the spec stubs `ResizeObserver` + `clientWidth` like HeatmapRenderer.spec.tsx:30-49). **Pitfall:** measure the OUTER wrapper (the `data-testid="line-chart"` div), never the inner scroll box, or tilt/scroll will oscillate as the inner box grows. `plotWidthPx = max(0, wrapperW - yAxisWidth - margin.left - margin.right)` (72 + 0 + 10 when the y-title is drawn).
- **Scroll region with ResponsiveContainer:** BarRenderer already puts `ResponsiveContainer` in `{width:"100%", height:"100%", minWidth|minHeight}` inside a flex scroll box (WidgetRenderer.tsx:1281-1301). The UI-SPEC adds a `minHeight` to the inner box in BOTH branches; the bar precedent only proves `minHeight` in the horizontal-bars scroll branch, so the non-scroll branch with `minHeight` is a human-verify item (legibility, no clipped labels), not provable by tests.
- **Mock caveat for tests:** `WidgetRenderer.spec.tsx:3823-3886` mocks `ResponsiveContainer` (fixed 800x400), `XAxis`/`YAxis` (render only `label`), `Line` (render only `name`), `Tooltip` (injects `payload: [{name:"value", value:1234}]`), `LineChart` (drops all props incl. `onClick`). This is hoisted file-wide, so it cannot observe `interval`/`angle`/`connectNulls`/`dot`/`onClick`. New behavioral tests need their own file.

### 6. Drill (answers Q6) - HIGH for the path, MEDIUM for activePayload with nulls
- Bar multi branch (WidgetRenderer.tsx:1097-1114) reads `payload["bucket"]`, `column = groupByColumns[0]`, `setClickedElement(value)`, 300 ms `setTimeout(dispatchDrillDown(...))`, `dataType: typeof value === "number" ? "number" : "string"`. LineRenderer's current handler (:1355-1376) is the single-series path via `resolveAggregatedDrillTarget` (kept for single-series).
- `LineChart onClick` gives `activePayload[0].payload` = the pivoted row (same contract the bar uses); `activePayload` entries are built for every `<Line>` regardless of null values (only the `Tooltip` component filters nulls), so `[0].payload.bucket` is reliable even if the first series is null at that X. (MEDIUM: derived from reading the Tooltip filter site and Line points; not exercised against a live chart.)
- **Typing divergence to decide:** `bucket` is always a `String` (toBarPivotInput `String(r[col1])`), so bar's `typeof value === "number"` is never true and a numeric/date X drills with `dataType: "string"`. The single-series line path instead honours the persisted `drillDownColumnType` when the drill column equals the group-by column (`resolveAggregatedDrillTarget`, WidgetRenderer.tsx:970-985). A date/number X is the COMMON line-chart case, so mirroring bar exactly would regress typed drilling when an operator adds a series column. Recommendation: for the multi branch use `dataType = drillDownColumnType` (persisted at Apply for col 1 via `defaultDrillDownColumn`, ChartConfigPanel.tsx:1062-1064), and `value = payload.bucket` (convert with `Number()` only if `drillDownColumnType === "number"`). This still satisfies D-10 ("drill on col 1 = clicked X; series not in the filter"). If the planner prefers literal bar parity, state that in the plan. Open Question 3.
- `dispatchDrillDown` (WidgetRenderer.tsx:150) is file-private; new drill tests must go through `<WidgetRenderer>` and assert `useFilterStore` state (or spy the store's `addFilter`), under fake timers advancing 300 ms. Remember `afterEach useRealTimers` is global (test/setup.ts).

### 7. Tests - existing coverage and exposure (answers Q7)
| Existing spec | Exposure | Action |
|---|---|---|
| WidgetRenderer.spec.tsx (4726 lines) | NO existing test renders a `type: "line"` widget (grep `type: "line"` = 0; mock `Line` exists but unused by tests). Bar Phase 102 tests are static-source regex over the WHOLE file (`readFileSync(WidgetRenderer.tsx)` + `expect(src).toMatch(...)`, :4363-4430) and will stay green; BUT any new regex-over-whole-file test for line would be toothless because BarRenderer contains the same strings (e.g. `groupByColumns\[0\]`, `["bucket"]`, `multiSeries`). Scope any source assertion to the LineRenderer slice (`src.slice(src.indexOf("const LineRenderer = ("), src.indexOf("const PieRenderer = ("))`), exactly as the existing bar "Invariant" test does (:4414-4430). Prefer behavioral tests. | none required to existing; new tests elsewhere |
| WidgetRenderer.spec.tsx Phase 77 mock (:3823-3886) exposes `yaxis-label`, `xaxis-label`, `line-series-name` | reusable for LINE-V126-03 integration assertions (legend `name`, y title) via `<WidgetRenderer>` with `makeWidget({type:"line"})`, same harness as Bar label tests (:3922-4095, `listColumnDisplayConfig` mocked, `upsertColumn` live-update test pattern :4077-4095) | add a `describe("LineRenderer ...")` here for title tests |
| ChartConfigPanel.spec.tsx | mocks `registry.getChartType` per describe (BAR_DEF_GROUPED pattern :1000-1215). No test uses `widgetType="line"`. Phase 102-02 tests (:1016-1215) are the mirror template: assert SQL string, `LIMIT 2400` (`100*12*2`), 1-column byte-identical, blank handling (:1332 uses `["",""]`). | add `describe("Phase 132 ...")` with a `LINE_DEF_GROUPED` (`usesAggregation: true, requiresGroupBy: true, supportsDrillDown: true`) |
| ColumnFormatTooltip.spec.tsx | see Section 4 | add 2 tests |
| TimelineRenderer.spec / NumericLineRenderer.spec | use ColumnFormatTooltip; unaffected by an optional prop | run in full suite |
| theme-guard.spec.ts | `toCssColor` already in WidgetRenderer; new code must introduce NO raw hex / rgba | run |

**CLAUDE.md grep-anchor discipline - counts verified TODAY (packages/web/src, non-spec):**
| Anchor | Count now | Verdict |
|---|---|---|
| `resolveLineMetricTitle` | 0 | good anchor |
| `data-testid="line-truncated-note"` | 0 | good (the bare string `line-truncated-note` is NOT: it already substring-matches `timeline-truncated-note` / `numericline-truncated-note`; always include `data-testid="` prefix) |
| `data-testid="line-scroll-region"` | 0 | good |
| `Group By column 1 is required` | 0 | good |
| `lineMissingXColumn` | 0 | good |
| `const isLine` | 0 | good |
| `LINE_CATEGORY_SLOT_PX` / `LINE_MIN_PLOT_PX` / `isIsolatedLinePoint` / `aggregationLabels` | 0 | good |
| `interval={0}` | 0 repo-wide | good |
| `connectNulls` | 2 in TimelineRenderer.tsx, 2 in NumericLineRenderer.tsx | **TOOTHLESS if unscoped.** Scope to the LineRenderer slice or assert via the prop-capturing mock |
| `multiSeries` | 13 in WidgetRenderer.tsx (all BarRenderer) | toothless unscoped |
| `Series dimension` | 1 (ChartConfigPanel.tsx:842, bar) | toothless for line |
| `aria-label="Remove column"` | 0 | good |
| `X axis` | 2 in ChartConfigPanel.tsx (comments/heatmap hint) | for the line label use the exact JSX string `"X axis"` inside `labelFor`, or better a behavioral `getByLabelText("X axis")` which reads 0 matches today for `widgetType="line"` |
Not automatically verifiable (route to checkpoint:human-verify, per UI-SPEC list): gap-vs-zero look, lone dot, light/dark legibility, cursor opacity, scroll feel, legacy-dashboard look unchanged. Structural preconditions ARE checkable via the prop-capturing mock.

### 8. Phase 102 artifacts to reuse (answers Q8)
Source: `.planning/phases/102-multi-column-group-by-on-bar-chart/102-RESEARCH.md` (Pitfalls 1-8) and `102-VERIFICATION.md`. Directly relevant, all still true:
- Pitfall 1: GROUP BY real column names, never the `value` alias (already in the shared branch).
- Pitfall 2: LIMIT starvation -> generous multiplier (applies to line, plus the high-cardinality-X risk above).
- Pitfall 3: `" / "` collision accepted.
- Pitfall 5: skip `resolveKeys` in multi mode; `xKey = "bucket"`.
- Pitfall 6: tooltip `groupByColumn` must be `groupByColumns[0]`, never `"bucket"`.
- Pitfall 7: drill reads `payload["bucket"]`, column `groupByColumns[0]`.
- Pitfall 8: renderer reads `config.groupByColumns` persisted at Apply, never parses SQL.
- Pitfall 4 (`stacked` no-op) does NOT apply (line has no `stacked`).
- Series cap env `MAX_BAR_GROUP_BY_SERIES` default 12 -> `/api/auth/me` -> `useAuthStore.maxBarGroupBySeriesCap`; bar's Test 3 asserts the truncation note uses `className="config-hint"`, never `config-hint-warning`.
- Project memory: UI classes that do not exist render unstyled and pass every gate; this phase needs zero new classes (reuse verified). `theme-guard` misses rgba and wrong tokens: use only `var(--accent-text)`, `var(--danger)`, `GRID_COLOR`/`AXIS_COLOR`.

### 9. `resolveLineMetricTitle` inputs (answers Q9)
- **AGGREGATIONS labels:** ChartConfigPanel.tsx:84-92 is a **non-exported** module const (`SUM:Sum, AVG:Average, MIN:Min, MAX:Max, COUNT:Count, COUNT_DISTINCT:Count Distinct, STDDEV:Std Deviation, VARIANCE:Variance`). Move to `lib/aggregationLabels.ts` and import from both ChartConfigPanel and the helper (do NOT import ChartConfigPanel from WidgetRenderer; WidgetRenderer already imports `DEFAULT_COLOR_THEME` from TimelineConfigPanel, so a lib avoids growing that cycle risk).
- **Custom metric label:** `resolveMetricLabel(metricId, tableId)` (lib/customMetricSql.ts:96), null when not custom/orphaned/unknown table. **LineRenderer today has neither the `customMetricsConfigVersion` subscription nor the `loadConfig` effect that BarRenderer has (WidgetRenderer.tsx:1010-1017)**; port both or the title is stale/unhydrated (the "4a8c117 failure mode" noted at :432-436).
- **Format-columns label:** `resolveLabel(tableId, metricColumn)` returns the raw column if unset; detect "set" as `label !== metricColumn`. A user who sets a label identical to the column name is indistinguishable but harmless (result is the same string).
- **`yFieldLabel`:** `config.yFieldLabel` (line.ts:11 "Y-Axis Label", default `""`).
- Suggested pure signature (all store reads done by the caller, so the helper is trivially unit-testable):
```ts
export function resolveLineMetricTitle(a: {
  yFieldLabel?: string; customLabel?: string | null; columnLabel?: string | null;
  metricColumn?: string; aggregation?: string; fallbackKey?: string;
}): string {
  if (a.yFieldLabel) return a.yFieldLabel;
  if (a.customLabel) return a.customLabel;
  if (a.metricColumn && a.columnLabel && a.columnLabel !== a.metricColumn) return a.columnLabel;
  if (a.metricColumn && a.aggregation) return `${aggregationLabel(a.aggregation)} of ${a.metricColumn}`;
  if (a.metricColumn) return a.metricColumn;
  return a.fallbackKey ?? "";   // legacy no-metric case only (y key); never reached for configured widgets
}
```
  Use the SAME result for the single-series `<Line name>`/`<Area name>`, and (when non-empty) the Y-axis `label`. Orphaned custom metric (deleted) with no metricColumn falls to `fallbackKey` = `"value"`: acceptable legacy edge; planner may prefer a literal like "Metric".

### Anti-Patterns to Avoid
- **Copying bar's `scaleValues`** (`Number(row[sk])` over pivoted rows, WidgetRenderer.tsx:1145-1148): `Number(null) === 0` poisons a smart/log min with phantom zeros. Line has no `yAxisScale` field; do not port it. If a value-axis width estimate is wanted use only non-null finite values.
- **Using `isMultiColumnBarGroupBy` in LineRenderer** (blank-column phantom series, Caveat B).
- **Referencing `isLine` before its declaration** (TDZ, Section 2).
- **Source-regex tests over the whole WidgetRenderer.tsx** for line behavior (BarRenderer satisfies them).
- **Measuring the inner scroll box** for plot width (oscillation).
- **Returning `null` from the `dot` function** (type error) or omitting `key`.
- **`config-hint-warning`** (no CSS rule; verified by UI-SPEC).
- **Adding `rgba(...)`/hex** in new TSX/CSS (theme-guard only flags hex; memory note says rgba still ships light-mode bugs).
- Forgetting the **AreaChart branch** (`fillArea` single-series): it has its own XAxis/YAxis/Legend/Tooltip and needs the same `interval={0}`, 11px ticks, y-title and legend name. Factor shared axis elements (build `xAxisEl`/`yAxisEl` once, reuse in both branches). Multi-series ignores `fillArea` (UI-SPEC).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rows -> per-series columns with gaps | custom pivot | `toBarPivotInput` + `selectTopSeries` + `pivotSeriesRows` | tested (barGroupedSeries.spec.ts, groupedSeries.spec.ts); null gap semantics built in |
| Series colors | new palette | `themeColorsFor(getCbColorTheme("Set2"), n)` | D-11 same palette as bar. Note `themeColorsFor` picks the palette VARIANT by series COUNT, so "same value, same color" across bar/line holds only when both charts have the same series count/order (accepted; human-verify) |
| Tick thinning override | measuring text to pick labels | `interval={0}` | Recharts' own numeric-interval path |
| Tooltip null omission | filtering in the tooltip | Recharts `Tooltip` `filterNull` (default true) | verified in installed source |
| Multi-column builder markup | a second builder | the existing block, `isLine` branches only | D-01, zero new CSS |
| Truncation note / scroll region markup | new classes | copy BarRenderer markup (WidgetRenderer.tsx:1273-1309) with `line-*` testids | UI-SPEC |
| Aggregation label map | duplicated literal | one shared `AGGREGATIONS` lib | avoid drift |
| Row-limit/truncation | bespoke | Phase 127 generic `chartLimitedRows` note (already wraps every non-heatmap chart) | automatic |

**Key insight:** this phase is wiring, not invention; the only genuinely new logic is label-width layout math, the isolated-point dot, the title resolver, and the blank-column accessor, all small and pure.

## Common Pitfalls

### Pitfall 1: Multi-series line silently capped at 100 rows
**What goes wrong:** gaps/missing X categories. **Why:** LIMIT multiplier `isBar` only (ChartConfigPanel.tsx:441). **Avoid:** `isBar || isLine`; add a ChartConfigPanel spec asserting `LIMIT 2400` for a 2-column line. **Warning sign:** the generated-SQL preview shows `LIMIT 100` with 2 group columns.

### Pitfall 2: Phantom "undefined" series from a blank builder row
**What goes wrong:** legend shows `undefined`. **Why:** `+ Add column` appends `""`; `isMultiColumnBarGroupBy` counts it. **Avoid:** `lineGroupByColumns(config)` filters blanks; multiSeries from the filtered length. Unit-test `["region","" ]` -> single-series.

### Pitfall 3: Required-X validation unreachable / crashes
**What goes wrong:** ReferenceError (TDZ) or Apply never blocked for a new widget (builder shows no row because seed is empty). **Avoid:** declare after :352; seed `[""]` for line; test "new line widget: Apply disabled + alert text present; selecting col 1 enables it; legacy `groupByColumn: "region"` is valid and enabled".

### Pitfall 4: Tooltip relabels a lone visible series
**What goes wrong:** at an X where only one series has a value the tooltip names the line by the metric. **Avoid:** `multiSeries` prop (Section 4).

### Pitfall 5: Lone point invisible
**Avoid:** per-point `dot` function; test `isIsolatedLinePoint` for first/last/middle/adjacent-null/n=1 cases.

### Pitfall 6: Lexical X order for numeric categories
**Avoid/decide:** `numericBuckets` when every bucket parses numeric (Open Question 2).

### Pitfall 7: Legacy single-series regression (D-05)
**What goes wrong:** changing tick font 12 -> 11, margin, y-width, adding a y-axis title alters a legacy dashboard. These ARE intended LINE-V126-02/03 changes (UI-SPEC "Legacy Line" state lists them); everything else (data, color, `dot`, curve, path through `resolveKeys`) must be untouched. Add a test: legacy config (no `groupByColumns`) -> single `<Line dataKey="value">`, `stroke` = `config.color || DEFAULT_LINE_COLOR`, exactly one Line, no truncation note.

### Pitfall 8: Unhydrated custom-metric label ("value" returns)
**Avoid:** port the `customMetricsConfigVersion` subscription + `loadConfig` effect from BarRenderer (:1010-1017) into LineRenderer. Test with a custom-metric line (mirror `WidgetRenderer.customMetric.spec.tsx`).

### Pitfall 9: Scroll box measurement oscillation / jsdom
See Section 5.

### Pitfall 10: Dev env / test isolation
Memory notes: web vitest has parallel fake-timer cross-file leaks (global `useRealTimers` afterEach already in test/setup.ts); server env leak irrelevant (no server change). Server gate not needed; run `cd packages/server && npx tsc --noEmit` only if any server file is touched (none expected).

## Code Examples

### X-axis layout (pure, UI-SPEC constants)
```ts
// packages/web/src/lib/lineChartLayout.ts  (new)
export const LINE_CATEGORY_SLOT_PX = 48;                       // horizontal slot, UI-SPEC
export const LINE_TILTED_SLOT_PX = LINE_CATEGORY_SLOT_PX / 2;  // 24
export const LINE_MIN_PLOT_PX = 160;
export const LINE_DOT_DENSITY_MAX = 24;
const PX_PER_CHAR = 7;                                         // UI-SPEC safety margin (heatmap uses 6.6)

export function computeLineXAxisLayout(a: { n: number; plotWidthPx: number; maxLabelChars: number }) {
  const known = a.plotWidthPx > 0;
  const tilt = known ? a.n * LINE_CATEGORY_SLOT_PX > a.plotWidthPx : a.n > 8;   // unknown width fallback (jsdom)
  const scroll = known && tilt && a.n * LINE_TILTED_SLOT_PX > a.plotWidthPx;
  const maxLabelPx = a.maxLabelChars * PX_PER_CHAR;
  const sin45 = Math.SQRT1_2;
  const xAxisHeight = tilt ? Math.max(30, Math.ceil(maxLabelPx * sin45) + 16) : 30;
  const minInnerWidth = scroll ? a.n * LINE_TILTED_SLOT_PX + Math.ceil(maxLabelPx * sin45) : 0;
  return { tilt, scroll, xAxisHeight, minInnerWidth, minInnerHeight: xAxisHeight + LINE_MIN_PLOT_PX };
}
```
(`maxLabelChars` = longest `String(row.bucket|x)` after applying no formatter; the X tick has no formatter today.)

### Multi-series Line (port of BarRenderer :1026-1043 and :1210-1220)
```tsx
// Source: WidgetRenderer.tsx BarRenderer (in-repo) adapted per 132-UI-SPEC.md
const groupByColumns = lineGroupByColumns(config);                 // blanks removed
const multiSeries = groupByColumns.length >= 2;
const maxCap = useAuthStore((s) => s.maxBarGroupBySeriesCap);
const pivotInput = multiSeries ? toBarPivotInput(data as Record<string, unknown>[], groupByColumns) : [];
const top = multiSeries ? selectTopSeries(pivotInput, { max: maxCap }) : { series: [] as string[], truncated: false, total: 0 };
const chartData = multiSeries ? pivotSeriesRows(pivotInput, top.series /*, { numericBuckets } */) : data;
const seriesColors = multiSeries ? themeColorsFor(getCbColorTheme(DEFAULT_COLOR_THEME)!, Math.max(1, top.series.length)) : [];
// ...
{top.series.map((sk, i) => (
  <Line key={`series_${sk}`} type={curved ? "monotone" : "linear"} dataKey={sk} name={sk}
        stroke={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")} strokeWidth={strokeWidth}
        connectNulls={false} isAnimationActive={false}
        dot={makeLineDot(showDots, chartData.length > LINE_DOT_DENSITY_MAX)} activeDot={{ r: 5 }} />
))}
```
(`config.colorTheme` is intentionally NOT read: the Line definition has no such field, D-11/UI-SPEC "always Set2". Bar reads `config.colorTheme ?? DEFAULT`; a bar with a non-default theme will not match line colors; accepted.)

### Multi-series drill (recommended typing, see Section 6)
```tsx
if (multiSeries) {
  const value = (payload as Record<string, unknown>)["bucket"];
  const column = groupByColumns[0];
  setClickedElement(value);
  setTimeout(() => dispatchDrillDown({ tableId, dynamicViewId, dashboardId, column, value,
    dataType: drillDownColumnType /* persisted for col 1; bar uses typeof value */, widgetId }), 300);
  return;
}
```

### Tooltip prop
```tsx
<Tooltip {...RECHARTS_TOOLTIP_PROPS}
  content={<ColumnFormatTooltip tableId={tableId} groupByColumn={multiSeries ? groupByColumns[0] : groupByColumn}
                                metricColumn={metricColumn} multiSeries={multiSeries} />} />
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Line: single `groupByColumn` select, one `<Line dataKey=y>` | N-column builder + pivoted multi-`<Line>` | this phase | mirrors bar Phase 102 (v1.19) |
| Recharts default `interval` (thins ticks) | `interval={0}` | this phase | root cause of LINE-V126-02 |
| Recharts 2.x | 3.x exists (3.10.1) | n/a | out of scope; do not upgrade |

**Deprecated/outdated in this repo:** `config-hint-warning` (no CSS), the UI-SPEC claim that `isMultiColumnBarGroupBy` checks non-empty col 2 (it does not), the UI-SPEC suggestion to define `lineMissingXColumn` beside :125 (TDZ).

## Open Questions

1. **High-cardinality X truncation (own LIMIT) is undetected for line.**
   - Known: line SQL LIMIT = `limit x cap x 2` (<= 12,000); `ORDER BY value` drops low-value points; Phase 127's notice reads only the server cap.
   - Unclear: whether operators will plot date-like X with thousands of values.
   - Recommendation: ship as bar does; add the sentence to the human-verify checkpoint; defer a heatmap-style probe (`bumpTrailingLimit`/`detectTruncation`) to a later phase.
2. **X order in multi-series (D-07 "data order as today").** Lexical `pivotSeriesRows` sort vs numeric. Recommendation: lexical default (bar parity) with `numericBuckets: true` when all buckets are finite numbers; single-series stays SQL order. Planner should confirm this reading of D-07, since single-series (value-DESC) and multi-series (sorted) orders legitimately differ.
3. **Drill `dataType` for multi-series.** Literal bar parity (`typeof value`, effectively always "string") vs the persisted `drillDownColumnType` (matches today's single-series line). Recommendation: persisted type (does not violate D-10's "column 1 = clicked X").
4. **Dot-density rule scope.** UI-SPEC table is unscoped; D-05 says legacy renders identically. Recommendation: multi-series only.
5. **Optional `metricTitle` on the tooltip** for single-series (aligns tooltip label with the legend). Recommended small polish; not required by D-09.
6. **REQUIREMENTS.md LINE-V126-01 rewording** ("Group By column 1 is required") is by hand in the last plan per CONTEXT; also tick the 4 requirement checkboxes/status rows (:35-38, :83-86) there. Assign shared-doc edits (REQUIREMENTS/ROADMAP/STATE) to ONE plan (memory: parallel executors clobber shared docs; gsd-tools corrupts planning docs, edit by hand).

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, so this section is not required by config; it is included because the orchestrator asked for it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (jsdom, globals, `isolate: true`) + @testing-library/react + jest-dom |
| Config file | `packages/web/vitest.config.ts` (setupFiles `./src/test/setup.ts`: stubs `getComputedStyle` CSS vars, `vi.mock("zustand")` store reset, global `useRealTimers` afterEach) |
| Quick run command | `cd packages/web && npx vitest run src/lib/lineChartLayout.spec.ts src/lib/lineChartTitle.spec.ts src/components/charts/ColumnFormatTooltip.spec.tsx` |
| Component run | `cd packages/web && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx src/components/charts/WidgetRenderer.line.spec.tsx src/components/charts/WidgetRenderer.spec.tsx` |
| Full suite command | `cd packages/web && npx tsc --noEmit && npx vitest run` then `npx vitest run src/styles/theme-guard.spec.ts` |
| Server | no server change; if touched: `cd packages/server && npx tsc --noEmit` (server vitest is SET-BASED vs `TD-V16-TEST-ISOLATION`, never assert a pass count) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINE-V126-01 | 2-col line SQL: `SELECT a, b, SUM(m) AS value ... GROUP BY a, b ... LIMIT 2400`; 1-col byte-identical; blank col ignored | unit (ChartConfigPanel render + Apply) | `npx vitest run src/components/charts/ChartConfigPanel.spec.tsx -t "Phase 132"` | add describe (file exists) |
| LINE-V126-01 | builder shown for line (`getByLabelText("X axis")`, "+ Add column", no `Group By` select); legacy `groupByColumn` seeds col 1; empty new widget seeds blank row | unit | same file | add |
| LINE-V126-01 (D-02) | Apply disabled + `role="alert"` text `Group By column 1 is required` for new widget; enabled once col 1 chosen; enabled for legacy | unit | same file | add |
| LINE-V126-01 (D-03/04) | blank-filtered multiSeries; pivot -> N `<Line>`; over-cap shows `data-testid="line-truncated-note"` "Showing top N of M series" | component, prop-capturing mock | `npx vitest run src/components/charts/WidgetRenderer.line.spec.tsx` | ❌ Wave 0 |
| LINE-V126-01 (D-05) | legacy single-series: one Line, `dataKey="value"`, stroke = config.color, no note | component | same | ❌ Wave 0 |
| LINE-V126-02 | `interval={0}` on XAxis in single, multi and area branches; tilt props when `n*48 > width`; scroll region + inner `minWidth` when `n*24 > width`; fallback `n > 8` tilt with no ResizeObserver | component (+ pure `computeLineXAxisLayout` unit) | `npx vitest run src/lib/lineChartLayout.spec.ts src/components/charts/WidgetRenderer.line.spec.tsx` | ❌ Wave 0 |
| LINE-V126-03 | `resolveLineMetricTitle` precedence (yFieldLabel > custom > Format label > "Sum of col" > fallback); never `value` for configured widgets; legend `name` single = title, multi = series values; Y-axis label = title | unit + component (can reuse WidgetRenderer.spec mock: `line-series-name`, `yaxis-label`) | `npx vitest run src/lib/lineChartTitle.spec.ts src/components/charts/WidgetRenderer.line.spec.tsx` | ❌ Wave 0 |
| LINE-V126-03 | custom-metric line shows custom label; label updates live (`configVersion`) | component | same | ❌ Wave 0 |
| LINE-V126-03 | tooltip `multiSeries` prop: lone visible series keeps its name; omitted -> legacy relabel | unit | `npx vitest run src/components/charts/ColumnFormatTooltip.spec.tsx` | add 2 tests |
| LINE-V126-04 | multi-series click -> after 300 ms filter on `groupByColumns[0]` = clicked bucket; series column absent from filters; drillEnabled false when `drillDownColumn` empty | component (capture `LineChart onClick`, fake timers, assert `useFilterStore`) | `npx vitest run src/components/charts/WidgetRenderer.line.spec.tsx -t drill` | ❌ Wave 0 |
| D-06 (structure) | every multi `<Line>` has `connectNulls={false}`; dot fn returns circle for isolated point, none for null/dense-non-isolated; `isIsolatedLinePoint` cases | unit + component | lineChartLayout.spec + line spec | ❌ Wave 0 |
| D-06 / criterion 5 (VISUAL) | gap-vs-zero look, lone dot, light AND dark theme, tooltip omits absent series, cursor not opaque, label legibility/clipping, scroll feel, legacy dashboards unchanged | **manual-only** (`checkpoint:human-verify`; CSS/SVG rendering is not provable by tsc/vitest/theme-guard; see memory "CSS bugs evade tests") | n/a | n/a |

### Sampling Rate
- **Per task commit:** the quick/targeted vitest command for the touched file + `npx tsc --noEmit`.
- **Per wave merge:** `cd packages/web && npx tsc --noEmit && npx vitest run` and `npx vitest run src/styles/theme-guard.spec.ts`.
- **Phase gate:** full web suite green + theme-guard green, then the human-verify checkpoint, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/web/src/lib/lineChartLayout.spec.ts` - layout math, `isIsolatedLinePoint`, `lineGroupByColumns` blank filtering (LINE-V126-01/02, D-06)
- [ ] `packages/web/src/lib/lineChartTitle.spec.ts` (+ `aggregationLabels` coverage) - LINE-V126-03
- [ ] `packages/web/src/components/charts/WidgetRenderer.line.spec.tsx` - own `vi.mock("recharts")` that records props (`interval`, `angle`, `textAnchor`, `height`, `connectNulls`, `dot`, `dataKey`, `name`, `stroke`, `onClick`) and, if needed, stubs `ResizeObserver` + `clientWidth` (HeatmapRenderer.spec.tsx:30-49 pattern); harness copied from WidgetRenderer.spec (`makeWidget`, `buildResponse`, `wrap`, `listColumnDisplayConfig` mock). For the Tooltip contract test, use the REAL Recharts `Tooltip` `filterNull` behavior at unit level, not the WidgetRenderer.spec mock (which injects a fixed payload)
- [ ] ChartConfigPanel.spec.tsx `LINE_DEF_GROUPED` + "Phase 132" describe
- [ ] ColumnFormatTooltip.spec.tsx: `multiSeries` cases
- Framework install: none (vitest present).
Order in the plan: libs + specs first (pure, parallel-safe), then ChartConfigPanel + its spec, then LineRenderer + ColumnFormatTooltip + specs, then the human-verify checkpoint, then the single shared-doc plan.

## Sources

### Primary (HIGH confidence; read directly)
- packages/web/src/components/charts/WidgetRenderer.tsx (BarRenderer :990-1310; LineRenderer :1313-1445; AggregatedWidgetRenderer fetch :412-700; dispatchDrillDown :150; resolveAggregatedDrillTarget :968-985)
- packages/web/src/components/charts/ChartConfigPanel.tsx (:84-92, :125, :133, :341-356, :358-496, :667-690, :826-975, :1054-1100)
- packages/web/src/components/charts/ColumnFormatTooltip.tsx and its spec; TimelineRenderer.tsx:640-725
- packages/web/src/lib/barGroupedSeries.ts, groupedSeries.ts, cbColorThemes.ts, customMetricSql.ts, estimateAxisWidth.ts; store/columnDisplayConfigStore.ts:151
- packages/web/src/components/charts/definitions/line.ts, bar.ts
- packages/server/src/lib/columnRefs.ts:676-766, server/src/kinetica.ts:186-188,246 (Phase 127 caps)
- node_modules/recharts 2.15.4 es6: cartesian/Line.js, cartesian/CartesianAxis.js, cartesian/getTicks.js, util/TickUtils.js, util/types.js, component/Tooltip.js
- .planning/phases/102-multi-column-group-by-on-bar-chart/102-RESEARCH.md, 102-VERIFICATION.md
- 132-CONTEXT.md, 132-UI-SPEC.md, REQUIREMENTS.md, ROADMAP.md (Phase 132), CLAUDE.md, .planning/config.json
- `npm view recharts version` -> 3.10.1 (2026-10-08)

### Secondary (MEDIUM)
- `activePayload` includes null-valued line entries (inferred from Tooltip being the only filter site; not run against a live chart)

### Tertiary (LOW)
- None relied on. Web search / Context7 were not needed: all Recharts claims were verified against the installed 2.15.4 source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new deps; versions read from node_modules/npm.
- Architecture (SQL path, migration, panel wiring): HIGH, every claim has file:line.
- Recharts behavior: HIGH for interval/connectNulls/dot/Tooltip filter (installed source); MEDIUM for activePayload-with-null and for the non-scroll-branch `minHeight` rendering (needs the human check).
- Pitfalls: HIGH (blank-column, LIMIT, TDZ, lexical sort, scaleValues were each traced in code).

**Research date:** 2026-10-08
**Valid until:** 2026-11-07 (stable; invalidated only by an edit to ChartConfigPanel/WidgetRenderer line numbers cited above, which drift with every phase touching those files, so re-grep anchors before relying on exact line numbers)
