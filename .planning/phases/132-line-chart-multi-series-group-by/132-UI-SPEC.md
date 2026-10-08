---
phase: 132
slug: line-chart-multi-series-group-by
status: approved
reviewed_at: 2026-10-08
shadcn_initialized: false
preset: none
created: 2026-10-08
---

# Phase 132: UI Design Contract (Line Chart Multi-Series Group By)

> Visual and interaction contract. Source decisions: 132-CONTEXT.md D-01..D-11 (locked). Every class and constant below was verified to exist in the codebase today (file:line cited). Phase 132 needs **zero new CSS classes**.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (no shadcn; plain elements + utility classes in `packages/web/src/styles/global.css`) |
| Preset | not applicable |
| Component library | none; Recharts for charts |
| Icon library | none (text glyphs, e.g. `×`, `+`) |
| Font | inherited app font; chart text is Recharts SVG text at the sizes below |

Registry safety gate: not applicable.

---

## Spacing Scale

No new layout. Reused values (all already in the bar chart / panel):

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | builder row `gap: "4px"` (ChartConfigPanel.tsx:848) |
| sm | 8px | Not used directly; chart gaps come from the inherited exceptions below |
| md | 16px | left-axis label extra width (`+ 16`, mirrors WidgetRenderer.tsx:1192) |

Exceptions (inherited verbatim from BarRenderer, not new): truncation note `padding: "2px 6px"` (WidgetRenderer.tsx:1274); Legend `paddingTop` 6 / 14 (:1206); chart `margin` stays `{ top: 10, right: 10, left: -10, bottom: 0 }` (WidgetRenderer.tsx:1386/1419) EXCEPT `left` becomes `0` when the Y-axis label is drawn so the rotated label is not clipped (see Y axis).

---

## Typography

Chart text is SVG, sized in px props, not CSS classes. Declared sizes: 2 (11px, 10px). Weights: 2 (regular 400, semibold 600 from the tooltip category line).

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Axis tick text (X and Y) | 11px (**changed from Line's current 12 to match bar**, WidgetRenderer.tsx:1186-1192) | 400 | n/a (SVG) |
| Axis title / legend / truncation note | 11px | 400 | n/a (SVG) / note inherits `.config-hint` |
| Tooltip category line | `var(--text-xs)` (10px) | 600 | inherited |
| Tooltip value lines | `var(--text-xs)` (10px) | 400 | inherited |

Tooltip typography is whatever `ColumnFormatTooltip.tsx` already renders; do not change it.

---

## Color

All colors are existing tokens/constants; NO hex or rgba is introduced.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `var(--bg)` / `var(--panel)` | widget surface (unchanged) |
| Secondary (30%) | `var(--border)`, `GRID_COLOR` | grid lines, builder borders |
| Accent (10%) | `var(--accent-text)` | truncation note text only (WidgetRenderer.tsx:1274); `btn-primary` Apply (existing) |
| Destructive/error | `var(--danger)` (`#fb7185` dark global.css:20, `#e11d48` light :130) | Group By column 1 validation message only |

Accent reserved for: the "Showing top N of M series" note and the existing Apply button. Series lines do NOT use the accent token.

**Axis/grid colors:** `const { grid: GRID_COLOR, axis: AXIS_COLOR } = useChartAxisColors();` (already at WidgetRenderer.tsx:1323 in LineRenderer; `lib/chartColors.ts:23`, reads `--color-chart-grid` / `--color-chart-axis`, which exist in both themes: global.css:106-107 dark, :145-146 light, and the hook re-runs on theme toggle). `CartesianGrid stroke={GRID_COLOR} vertical={false}`; `XAxis`/`YAxis stroke={AXIS_COLOR}`; axis titles `fill: AXIS_COLOR`.

**Series palette (D-11, identical to BarRenderer, WidgetRenderer.tsx:1029-1038):**
```
const colorTheme = (config.colorTheme as string) ?? DEFAULT_COLOR_THEME;   // "Set2" (TimelineConfigPanel.tsx:43)
const seriesColors = themeColorsFor(getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME)!, Math.max(1, top.series.length));
stroke={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")}
```
`themeColorsFor` is `lib/cbColorThemes.ts:92`; `toCssColor` is the file-local helper at WidgetRenderer.tsx:105. The Line definition has NO `colorTheme` field and gets none (D-11), so Line always resolves to default "Set2"; if a bar widget's `colorTheme` was changed from default, the same value will NOT match until a picker exists (accepted; Set2 default = same color for the same series index in a default bar). Series color is by index in `top.series` order, same as bar. These are theme-independent ColorBrewer colors (same in light and dark, as for bar); contrast against `var(--panel)` in both themes is a human-verify item.

**Single-series line color:** unchanged, `config.color || DEFAULT_LINE_COLOR` (D-05: saved dashboards render as before). The `color` field remains in the config panel and applies to single-series (one-line) mode only.

---

## Group By builder (Config panel, LINE-V126-01 / D-01..D-03)

Reuse the bar builder block at `ChartConfigPanel.tsx:828-903` verbatim. Required edits (all in that block, no new markup/classes):

1. Add `const isLine = widgetType === "line";` beside `isBar` (:346) and extend `usesMultiColumnGroupBy = isBar || isTable || isHeatmap || isLine` (:352). This also removes Line from the single `Group By` select branch (:907) automatically.
2. `labelFor` (:838-843): add a line branch mirroring bar wording:
   - idx 0 -> **`X axis`** (CONTEXT locked: column 1 = "X axis")
   - idx >= 1 -> **`Series dimension ${idx}`** (identical to bar, :842)
3. Group label stays `Group By Columns` (:846). Cap stays `MAX_BAR_GROUP_BY_COLUMNS` = 6 (:356).
4. Help text (the `config-hint` span, :894-900), line branch: **`First column = x-axis categories (required); the rest become colored lines (${MAX_BAR_GROUP_BY_COLUMNS} column max).`** (bar's string with "(required)" and "lines" for "colored series").
5. Icon-only `×` remove button: add `aria-label="Remove column"` (the bar block at :872-881 has none today; add it to the shared block so bar and line both get it). Classes used (all existing): `config-group`, `config-group-label`, `ds-field`, `ds-field-label`, `ds-select`, `ghost-sm`, `config-hint`. Buttons: `×` remove and `+ Add column` are `ghost-sm` (unchanged). Apply/Cancel footer stays `btn-primary btn-sm` + `ghost-sm` inside `config-panel-actions` (:1050-1098; already matched-height).
6. Column 1 row: the `×` remove button on idx 0 is allowed (matches bar), but removing it triggers the validation state below.

### Validation (D-02) - required-column message

Existing pattern: there is NO built-in-chart validation message today. Only the custom-panel path disables Apply via `customPanelValid` (ChartConfigPanel.tsx:125, :1054-1055 with `title={...}` text) and an inline hint uses `config-hint` (:745). **Warning:** `config-hint-warning` (used at :745) has NO CSS rule anywhere in `packages/web/src/styles` (verified by grep), so it is a no-op class; do NOT copy it. Use:

- Condition: `isLine && requiresGroupBy` (`requiresGroupBy` EXISTS at ChartConfigPanel.tsx:341 as `chartDef?.requiresGroupBy !== false`; the Line definition does not set it, so it is true) and `(groupByColumns[0] ?? "") === ""` (after the same legacy-seeding as :832-835, i.e. a legacy widget with `groupByColumn` set is VALID).
- Message element, rendered directly under the builder's help `config-hint` inside the same `config-group`:
  `<span className="config-hint" role="alert" style={{ color: "var(--danger)" }}>Group By column 1 is required: choose the column for the x-axis.</span>`
  (`style` color uses the token; `config-hint` supplies size/margin; this mirrors the existing inline-token-color style at WidgetRenderer.tsx:1274. No new class.)
- `lineMissingXColumn` is a NEW derived boolean the plan defines beside `customPanelValid` (:125): `isLine && requiresGroupBy && (groupByColumns[0] ?? "") === ""` after legacy seeding.
- Apply: add `|| lineMissingXColumn` to the existing `disabled` (:1054) and set `title={lineMissingXColumn ? "Group By column 1 is required" : (!customPanelValid ? "Add at least 2 break rows" : undefined)}`. `btn-primary btn-sm` already renders a disabled state.
- The validation shows immediately for a NEW Line widget (empty draft) and for a legacy Line saved with no Group By once edited (D-05); it does not block rendering of an unedited legacy widget.

---

**Focal point:** the series lines (stroke, palette colors) are the primary visual element; grid and axes are deliberately muted (`GRID_COLOR`/`AXIS_COLOR`) so they recede behind the lines.

## Chart rendering contract (LineRenderer, WidgetRenderer.tsx:1313-1445)

### Modes
- **multiSeries** = `groupByColumns.length >= 2` with non-empty col 2 (reuse `isMultiColumnBarGroupBy(config)`, WidgetRenderer.tsx:83/1027). Pivot via `toBarPivotInput` -> `selectTopSeries({max: maxBarGroupBySeriesCap})` -> `pivotSeriesRows` exactly as :1028-1035. X key = `"bucket"`.
- **single-series** = exactly one column (col 1 only, including all migrated legacy widgets). Data and `dataKey={y}` path unchanged (D-05); this is the ONE-line case.
- `fillArea`: honored in single-series only (existing AreaChart branch). In multiSeries always render `<LineChart>` with `<Line>`s and ignore `fillArea` (overlapping translucent areas are unreadable). Not a new setting.

### X axis (D-07, LINE-V126-02)
| Property | Value |
|----------|-------|
| `dataKey` | `xKey` (`"bucket"` multi, resolved `x` single) |
| `interval` | `{0}` (every category label, all modes) |
| `tick` font | `fontSize: 11, fill: AXIS_COLOR` (matches bar, :1191) |
| Slot constant | ONE constant: `LINE_CATEGORY_SLOT_PX = 48` (horizontal label slot: ~7 chars at ~6px + gap). The tilted slot is derived as `LINE_CATEGORY_SLOT_PX / 2` = 24px (a 45° 11px label needs ~19px horizontally). No other per-category constants. |
| Ordering | (1) horizontal if `n * 48 <= plotWidthPx`; (2) else TILT -45°; (3) SCROLL only when tilted labels still cannot fit, i.e. `n * 24 > plotWidthPx`. Tilt is always tried first; scroll never happens while horizontal labels fit. `n = chartData.length`; `plotWidthPx` from the `ResponsiveContainer`/a ref; do NOT measure text. If width is unknown, fall back to `tilt = n > 8`, no scroll. |
| Angled tick | `angle={-45}`, `textAnchor="end"`. Tilt STAYS on while scrolling (never revert to horizontal inside the scroll region). |
| Label text | Tick text renders in FULL: no truncation, no ellipsis, no character cap (D-07: "angle + scroll", shorten rejected; LINE-V126-02: every label shown, never dropped). The tooltip header also shows the full value. |
| Angled XAxis `height` | Derived from the longest label, with a wide-glyph safety margin: `maxLabelPx = maxLabelChars * 7` (7px/char at 11px, so wide glyphs such as W/M don't under-size); `height = ceil(maxLabelPx * sin(45°)) + 16`, floor 30 (horizontal default). Example: 12 chars -> 60 + 16 = 76; 24 chars -> 119 + 16 = 135. Typical upper range around 160px (about 29 chars). NEVER clamped, clipped or truncated (D-07). To stop a tall label area from squeezing the plot, the inner chart box gets `minHeight: xAxisHeight + LINE_MIN_PLOT_PX` (`LINE_MIN_PLOT_PX = 160`), in BOTH the scroll and non-scroll branches. When that exceeds the widget height, the region scrolls vertically (`overflowY: "auto"`), so the plot keeps at least 160px and every label stays fully visible. Horizontal ticks keep the Recharts default `height` (30). |
| Scroll trigger and slot width | when `n * 24 > plotWidthPx`, size the inner box `minWidth = n * 24 + ceil(maxLabelPx * cos(45°))` (the added term is the left overhang of the longest tilted label, so label length widens the box) and wrap in the bar's scroll region |
| Order | **SUPERSEDED by Amendment A1 (O-1):** ascending by the X category value (numbers numerically, dates chronologically, text A to Z), single AND multi-series |

Scroll region markup: copy the BarRenderer structure at WidgetRenderer.tsx:1266-1309 - outer `<div data-testid="line-chart" style={{ position:"relative", width:"100%", height:"100%", display:"flex", flexDirection:"column" }}>`; scroll branch `<div data-testid="line-scroll-region" style={{ flex:"1 1 auto", minHeight:0, overflowX:"auto", overflowY:"auto" }}>` wrapping `<div style={{ width:"100%", height:"100%", minWidth: neededCategoryPx }}>`; non-scroll branch the `position:relative` / `absolute inset:0` pair (:1303-1306). Inline styles only, as bar does (there is no `bar-scroll-region` CSS class, only a `data-testid`; do not add a className).

### Y axis (D-08/D-09)
- Tick: `fontSize: 11, fill/stroke AXIS_COLOR`, `tickFormatter` = column formatter for the metric (same as bar `valueAxisTickFormatter`; reuse if extractable, else identity as today).
- **Axis label (always shown when a title resolves), multi- AND single-series:**
  `label={{ value: yTitle, angle: -90, position: "insideLeft", fill: AXIS_COLOR, fontSize: 11, style: { textAnchor: "middle" } }}` (identical to bar `leftLabelObj`, :1076-1078). `YAxis width = 56 + 16` (label adds 16, mirrors :1192); chart `margin.left = 0`.
- **`yTitle` resolution (single source for axis label AND single-series legend name):**
  1. `config.yFieldLabel` if non-empty (existing field "Y-Axis Label", definitions/line.ts:11)
  2. else custom metric: `resolveMetricLabel(metricId, tableId)` (as :1019-1021)
  3. else if `resolveLabel(tableId, metricColumn)` returns something different from the raw `metricColumn` (a Format-columns label is set; `resolveLabel` falls back to the raw name, columnDisplayConfigStore.ts:151-152, so compare to detect "unset"): that label
  4. else `"<Aggregation label> of <metricColumn>"` using the `AGGREGATIONS` labels (ChartConfigPanel.tsx:84-92, e.g. `Sum of fare_amount`; export or duplicate the 8-entry map into a shared helper)
  5. never the literal `value`; if everything is empty fall back to `y` only for the legacy no-metric case.
  Put this in one pure helper (e.g. `resolveLineMetricTitle`) so it is unit-testable.

### Legend (D-08/D-09)
- `showLegend` stays honored. `<Legend wrapperStyle={{ paddingTop: 6, fontSize: 11 }} />` (bar's no-x-title value, :1206).
- Multi-series: one entry per series, `name={sk}` where `sk` is the series value (e.g. `Cash`) or the `" / "`-joined combination for 3+ columns (`BAR_SERIES_SEPARATOR`, barGroupedSeries.ts:8). No metric name in the legend.
- Single-series: one entry, `name={yTitle}` (same resolution). Never `value`.

### Tooltip (D-06, D-08)
- `<Tooltip {...RECHARTS_TOOLTIP_PROPS} content={<ColumnFormatTooltip tableId groupByColumn={multiSeries ? groupByColumns[0] : groupByColumn} metricColumn={metricColumn} />} />`. No cursor override needed for line (default vertical hairline); if the default renders opaque/white in dark mode it is a human-verify defect, fix with `cursor={{ stroke: AXIS_COLOR, strokeOpacity: 0.4 }}`.
- Header line = X value (`label`, with the resolved group-by-column-1 label prefix as `ColumnFormatTooltip` already renders: `<Column label>: <X value>`).
- One line per series that HAS a value, formatted `Cash: 12,400` (series name, value through the metric formatter, tinted by `entry.color`). `ColumnFormatTooltip` already lists payload entries only; Recharts omits `null`/`undefined` points for `connectNulls={false}` lines. The plan MUST add a spec asserting a series with no value at the hovered X is absent (and not "0" or empty); if Recharts still includes it, filter `payload` entries where `value == null` inside `ColumnFormatTooltip` (small, backward-safe edit).
- Single-series: `ColumnFormatTooltip` already uses the metric label for `singleSeries` (payload length 1). Caveat: in multi-series at an X where only ONE series has a value, `payload.length === 1` would wrongly relabel the line with the metric name. The plan must guard this (pass an explicit `multiSeries` prop, or skip the singleSeries relabel when more than one `<Line>` is rendered).

### Lines & dots (D-06, D-11)
| Property | Value |
|----------|-------|
| Line width | `strokeWidth={config.strokeWidth ?? 2}` for every line (existing Line Width field, 1-6) |
| `type` | `curved ? "monotone" : "linear"` (existing Smooth Curve) |
| `connectNulls` | `{false}` on every multi-series `<Line>` (gap, not zero, Timeline precedent TimelineRenderer.tsx:690-715) |
| `isAnimationActive` | `{false}` (matches bar and Timeline) |
| Dots | (**Amendment A1: multi-series only**; single-series keeps today's `dot={showDots ? { r: 3 } : false}`) shown when `showDots !== false` AND `chartData.length <= 24`; hidden (`dot={false}`) when `chartData.length > 24` even if `showDots` is true. Dot `{ r: 3 }` (existing). `activeDot={{ r: 5 }}` always on, so hover works when dots are hidden. |
| Isolated point | a point whose neighbors are both null renders as a dot REGARDLESS of the density threshold (otherwise it is invisible). Implement with a per-point `dot` renderer: draw `<circle r=3 fill=stroke>` when `prev == null && next == null`, else follow the rule above. Applies in multi-series; single-series has no nulls. |
| Legend/line order | `top.series` order (selectTopSeries), same as bar |

### Truncation note (D-04)
Identical element and text as bar (WidgetRenderer.tsx:1273-1277), rendered as its own flex row above the plot, `flexShrink: 0`:
`<div className="config-hint" data-testid="line-truncated-note" style={{ color: "var(--accent-text)", fontSize: 11, padding: "2px 6px", flexShrink: 0 }}>Showing top {maxCap} of {top.total} series</div>`
Shown only when `multiSeries && top.truncated`. `maxCap = useAuthStore((s) => s.maxBarGroupBySeriesCap)` (:1028).

### Click-to-drill (D-10)
`wrapperStyle.cursor = drillEnabled ? "pointer" : "default"` (existing, :1355; same as bar). Multi-series click handler = bar's branch (WidgetRenderer.tsx:1097-1114): `value = payload["bucket"]`, `column = groupByColumns[0]`, `setTimeout(300)` -> `dispatchDrillDown({tableId, dynamicViewId, dashboardId, column, value, dataType: typeof value === "number" ? "number" : "string", widgetId})`. The series column is never added to the filter. Single-series click path unchanged.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Apply` (existing, `btn-primary btn-sm`) |
| Builder group label | `Group By Columns` (existing) |
| Column 1 label | `X axis` |
| Column 2+ label | `Series dimension N` (N = 1, 2, ...; same as bar) |
| Empty column option | `Select a column...` (existing, :865) |
| Add / remove | `+ Add column` / `×` (existing) |
| Builder help | `First column = x-axis categories (required); the rest become colored lines (6 column max).` |
| Required-column error (Apply blocked) | `Group By column 1 is required: choose the column for the x-axis.` ; Apply `title`: `Group By column 1 is required` |
| Truncation note | `Showing top {N} of {M} series` |
| Y-axis label / single legend | Format-columns label, else `<Aggregation> of <column>` e.g. `Sum of fare_amount` |
| Tooltip series line | `<series>: <formatted value>` e.g. `Cash: 12,400` |
| Empty chart state | unchanged (existing widget empty/no-data handling; not touched) |
| Destructive actions | none in this phase (`×` removes a builder row only, no confirmation, same as bar) |

---

## Interaction States

| State | Behavior |
|-------|----------|
| New Line widget, no column 1 | Builder shows one empty `X axis` row (seed one empty row when `groupByColumns` is empty so the required control is visible); error text shown; Apply disabled. |
| Legacy Line, saved with groupByColumn only (D-05) | Builder seeds `X axis` = that column (:832-835); no error; renders exactly as today (single line, same color, same data, plus X ticks now `interval=0`/11px and a Y-axis title, which are LINE-V126-02/03 fixes). |
| Legacy Line saved with NO group by | Renders as today until edited; opening the panel shows the error; Apply blocked until column 1 is chosen. |
| One column | Single line, legend = metric name, tooltip `<Metric>: value`. |
| 2+ columns | One line per series value, palette by index, legend = series values, Y-axis label = metric. |
| Over cap | Note row above plot; extra series dropped (lowest-ranked per `selectTopSeries`). |
| Sparse data | Line breaks at the missing X (no zero, no interpolation); isolated point draws a dot; tooltip omits series without value. |
| Many categories | All labels shown in full (never truncated). Horizontal if `n*48` fits; else tilted -45° with XAxis height derived from the longest label; else (`n*24` still exceeds width) scroll horizontally with tilt kept, `minWidth = n*24 + label overhang`. |
| Drill enabled | Pointer cursor; click filters col 1 = X category, 300 ms delay. |

---

## Not automatically verifiable (route to `checkpoint:human-verify`, ROADMAP criterion 5)

Grep/tsc/vitest/theme-guard cannot prove any of these; per CLAUDE.md do not dress them up in greps:
1. Series line and dot colors read clearly against the panel in BOTH light and dark mode (Set2 pastels on `--panel`).
2. Axis labels, angled X labels and the rotated Y-axis title are legible and not clipped (label-derived XAxis height / `left` margin / width 72 are the structural preconditions; the look is human, including that a very long label is fully visible).
3. Sparse multi-series data shows a real gap (not zero, not bridged), including the lone-dot case; tooltip shows only series with a value.
4. Tooltip hover cursor is not an opaque white block in dark mode.
5. Horizontal scroll feels right at the 24px tilted-slot minimum and the legend does not collide with angled labels.
6. Legacy saved Line dashboards look unchanged apart from the intended X/Y labeling fixes.

Structural preconditions that ARE checkable (verify each reads 0/absent BEFORE the work): `interval={0}` and `connectNulls={false}` occurring inside `LineRenderer`; `data-testid="line-truncated-note"`; `data-testid="line-scroll-region"`; `isLine` in ChartConfigPanel.tsx; the string `Group By column 1 is required`; helper name `resolveLineMetricTitle`. (Run each grep first; e.g. `connectNulls` already appears in TimelineRenderer.tsx, so scope the grep to the LineRenderer range / the new spec.)

---

## Amendment A1 (2026-10-08, operator decisions O-1 / O-2 and planning resolutions)

Added at plan-phase time. Where this section conflicts with anything above, this section wins.

### O-1: X order is ascending by the X category value
- Applies to single-series AND multi-series line charts whose X column is configured (Group By column 1, or the legacy `groupByColumn`). A legacy Line saved with NO group-by (`SELECT * ... LIMIT 100`) is not re-sorted.
- Comparator (pure helper `sortLineRowsByX`, `lib/lineChartData.ts`): missing X values (`null`, `undefined`, `""`, the string `"null"`) sort last. If every other value is a finite number or a numeric string, sort numerically (1, 2, 10). Else, if every other value is an ISO-like date/time string (`YYYY-MM-DD` optionally followed by ` HH:MM[:SS[.fff]]` or `THH:MM...`), sort chronologically. Else sort as text with `String(a).localeCompare(String(b))` (A to Z). Never mutates its input.
- **Accepted visible change to D-05:** existing line charts used to plot points in metric-value order (`ORDER BY value DESC`); they now plot X ascending. The SQL is unchanged (it still fetches the top categories by metric value); only the display order changes.

### O-2: categories dropped by the Result limit are announced, never silent
- The SQL is unchanged: it still fetches the top categories by metric value (single-series `LIMIT <Result limit>`; multi-series `LIMIT <Result limit> x maxBarGroupBySeriesCap x 2`), then the chart sorts them by X.
- **Detection:** for a line widget whose SQL ends in the generated aggregate tail (`ORDER BY value ASC|DESC LIMIT n`), `AggregatedWidgetRenderer` asks for `LIMIT n+1` (the Phase 127 `bumpTrailingLimit` probe the heatmap already uses), shows at most n rows, and treats `n+1` returned rows as "the Result limit was hit".
- **Where M comes from:** only when the limit was hit, a second query counts the categories: `SELECT COUNT(DISTINCT <col1>) AS n FROM (<the same SQL without its ORDER BY/LIMIT tail>) kbi_line_x`, built by the pure helper `buildLineCategoryCountSql` from the SQL that was actually run (so it inherits the filter-view / dynamic-view FROM swap, the custom WHERE and the live custom-metric expression).
  - Justification: Kinetica's `has_more_records` (Phase 127) only reports the deployment per-query cap, never the widget's own LIMIT (`lib/rowTruncation.ts` header); the LIMIT+1 probe says "more exist" but not how many; `COUNT(DISTINCT col1)` over the grouped result is the only source of M. Running it only when the probe fired keeps the common path to one query.
  - If the count query fails (or returns no usable number), the notice still shows, without M.
- **Notice element** (same element and styling as the series note; no new class), rendered as its own flex row above the plot, below the series note when both apply:
  `<div className="config-hint" data-testid="line-categories-note" title={LINE_CATEGORY_NOTE_TITLE} style={{ color: "var(--accent-text)", fontSize: 11, padding: "2px 6px", flexShrink: 0 }}>{text}</div>`
- **Copy** (`lineCategoryNoteText({ shown, total })`; N = `chartData.length`, the categories actually drawn; M = the count; numbers via `toLocaleString()`):

| Case | Copy |
|------|------|
| M known and N < M | `Showing {N} of {M} categories` |
| M known and N >= M (multi-series only: every category is present but some lower (x, series) points were cut) | `Some lower values are not shown (result limit reached)` |
| M unknown (count query failed) | `Showing top {N} categories (more exist)` |
| Note `title` (all cases) | `The query reached its Result limit, so lower-value points are not shown. Raise "Result limit" or narrow the query.` |

- Not shown when the limit was not hit, for non-line widgets, or for a legacy Line with no group-by. The Phase 127 generic "Limited to N rows" note (deployment cap) is unchanged and may appear as well.

### Planning resolutions (Claude's discretion, adopted)
- **Dots:** the density rule (dots hidden when `chartData.length > 24`, isolated points always dotted) applies to multi-series only. Single-series keeps `dot={showDots ? { r: 3 } : false}`.
- **Tooltip:** `ColumnFormatTooltip` gains optional `multiSeries?: boolean` (when defined it replaces the `payload.length === 1` guess) and `metricTitle?: string` (when non-empty, the single-series value line uses it instead of the Format-columns label, so the tooltip matches the legend). Multi-series line passes `multiSeries`; single-series line passes `metricTitle={yTitle}`. Other renderers pass neither (unchanged).
- **Title helper never returns `value`:** when nothing resolves, `resolveLineMetricTitle` returns `fallbackKey` unless it is empty or the literal `value`, in which case it returns `Metric`.
- **Drill typing (multi-series):** the clicked bucket is mapped back to the raw X value from the fetched rows, and `resolveAggregatedDrillTarget` supplies the type, so the persisted `drillDownColumnType` of column 1 is honoured (a numeric X drills as a number, as single-series line does today). Column = Group By column 1; the series column is never added.
- **Blank builder rows:** the renderer uses `lineGroupByColumns(config)` (blank entries removed); multi-series means two or more non-blank columns. The SQL LIMIT multiplier applies to line only when two or more non-blank columns exist (`isBar || (isLine && cols.length >= 2)`), so `["region", ""]` produces the byte-identical single-column SQL.
- **Builder seeding:** a line whose `groupByColumns` is empty and whose `groupByColumn` is falsy seeds one blank `X axis` row, so the required control and its error are visible.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable |
| third-party | none | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
