# Phase 102: Multi-Column Group-By on Bar Chart — Research

**Researched:** 2026-07-01
**Domain:** Recharts BarChart multi-series rendering + Kinetica GROUP BY SQL + env-var cap plumbing
**Confidence:** HIGH (all findings from direct codebase reads + existing prior-phase precedents)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Column 1 → x-axis categories. Columns 2..N combined (compound key) → colored series, clustered or stacked.
- recharts has NO native multi-level nested x-axis — "nested/hierarchical" render = multiple `<Bar>` series, NOT stacked axis ticks.
- The single deploy-time env var caps resulting SERIES (top-N by aggregate, truncate+warn), default ~12. Mirror `readPositiveIntEnv` + `/api/auth/me` + auth-store chain (BOTH-stack).
- Reuse the existing bar `stacked` boolean as grouped(false)/stacked(true) toggle.
- Reuse `groupedSeries.ts` `selectTopSeries`/`pivotSeriesRows` + ColorBrewer `ensureColor`; compound series labels joined by " / ".
- 0/1 group-by column → byte-identical to today.
- Multi-column UI = add/remove-row builder pattern from `NumericLineConfigPanel` metrics[] (adapted to columns).
- Bar SQL baked into `config.sql` at config-save; renderer reads `config.groupByColumns` to pivot.
- Drill-down on the primary group column (col1) only.
- `AggregatedWidgetRenderer` stays SOLE materialize trigger; no new materialize path.

### Claude's Discretion
- Exact config field shape/migration (`groupByColumns` vs extending `groupByColumn`).
- Env var name (suggested: `MAX_BAR_GROUP_BY_SERIES`).
- Warning UI for truncation (reuse existing hint/badge class — NEVER invent a className).
- Series-cap application site (client-side after pivot, mirroring timeline).

### Deferred Ideas (OUT OF SCOPE)
- Multi-column group-by on other chart types (pie/line/timeline).
- True multi-level nested x-axis ticks.
- Per-series manual color/label editor for compound series.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BARGRP-V119-01 | Designer can select more than one group-by column on the bar chart | Config field `groupByColumns?: string[]` + add/remove-row UI in bar config panel (mirrors NumericLineConfigPanel metrics builder) |
| BARGRP-V119-02 | Multiple group-by columns render nested/hierarchically with grouped/stacked toggle | N `<Bar>` series keyed by compound col2..N label; `stackId` when stacked; `pivotSeriesRows` pivot with `bucket` → col1 category |
| BARGRP-V119-03 | Series count capped via deploy-time env var; graceful truncation+warn | `readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12)` at boot → `/api/auth/me` → `MeResponse.maxBarGroupBySeriesCap` → auth store → renderer selectTopSeries |
| BARGRP-V119-04 | Single-column / no group-by renders byte-identical to current behavior | Guard: `groupByColumns` absent OR length ≤ 1 → existing single-series `groupByColumn` SQL + `<Bar dataKey="value">` path unchanged |
</phase_requirements>

---

## Summary

This phase extends the bar chart from a single `GROUP BY col1` to an ordered list of N columns. The first column is the x-axis category dimension (unchanged from today). Columns 2..N are combined into a compound series key (joined with " / "), and the flat SQL result rows are pivoted into Recharts-ready multi-key rows using the existing `pivotSeriesRows` from `groupedSeries.ts`. Multiple `<Bar>` elements render one per series value, with `stackId` for stacked mode or none for grouped (clustered).

The key architectural concern — the LIMIT vs series-cap interaction — is resolved by using an **oversized SQL LIMIT** (xCatCap × seriesCap × safety factor) that guarantees the pivot is fully populated, then applying `selectTopSeries` client-side to cap series. This mirrors exactly how `TimelineRenderer` handles its top-N series: a pre-query fetches aggregate totals, then the main query is filtered to the allowed series set. For the bar chart, the approach is even simpler because bars have no time-bin step — a single generous-LIMIT query suffices.

The env-var cap plumbing is a small BOTH-stack addition, exactly mirroring the `MAX_COMBINATION_VIEWS_PER_TABLE` chain from Phase 90: one new `readPositiveIntEnv` call at server boot, one new field on the `/api/auth/me` JSON response, one new field in `MeResponse`, one new coalesce in `fetchMe`, and one new field in the auth store.

**Primary recommendation:** Use approach (c) — a generous SQL `LIMIT = config.limit × maxSeriesCap × 2` — for the single query, then `selectTopSeries` client-side. This is the simplest change, avoids a second round-trip, and is proven safe in Kinetica by the existing bar path. Series cap is applied client-side in the renderer, not via SQL `IN` filter.

---

## Standard Stack

### Core (confirmed from codebase reads)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | existing (2.x) | `<BarChart>`, `<Bar>`, `<Cell>`, `<LabelList>`, `<Legend>` | Already in use across all chart types |
| groupedSeries.ts | internal | `selectTopSeries`, `pivotSeriesRows`, `MAX_SERIES` | Phase 72 — canonical pivot/cap utility |
| cbColorThemes.ts | internal | `getCbColorTheme`, `themeColorsFor` | Phase 72 — ColorBrewer series coloring |
| customWhere.ts | internal | `whereCustomWhere`, `andCustomWhere` | Phase 98 — WHERE injection |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| estimateAxisWidth | internal | Dynamic YAxis width for formatted labels | When value axis formatter changes |
| yAxisScale.ts | internal | Phase 101 scale props | Passed through unchanged |
| ColumnFormatTooltip | internal | Tooltip with column labels/formats | Unchanged; passes groupByColumns[0] as groupByColumn |

---

## Architecture Patterns

### Recommended Project Structure (new files)
```
packages/web/src/components/charts/
├── definitions/bar.ts           (add groupByColumns field, move stacked meaning docs)
├── BarConfigPanel.tsx           (NEW — CustomConfigPanel for bar, mirrors NumericLineConfigPanel)
packages/web/src/lib/
├── groupedSeries.ts             (no changes needed — already handles multi-series pivot)
packages/server/src/
├── index.ts                     (add MAX_BAR_GROUP_BY_SERIES env var read + /api/auth/me field)
packages/web/src/api/
├── client.ts                    (extend MeResponse + fetchMe coalesce)
packages/web/src/store/
├── auth.ts                      (add maxBarGroupBySeriesCap field)
```

### Pattern 1: SQL Shape for Multi-Column GROUP BY (RESOLVED — recommendation: generous LIMIT)

**What:** A single SQL query with all N columns in SELECT + GROUP BY, ordered by aggregate value, with LIMIT = `config.limit * maxSeriesCap * 2`.

**The problem:** With `GROUP BY col1, col2` and `LIMIT 100`, a naive ORDER BY value DESC returns the top-100 (col1, col2) pairs by aggregate. If there are 10 x-categories and 12 series, you need up to 120 rows. A LIMIT of 100 starves late categories. A naive top-100 may also over-represent one x-category and have zero rows for others that DO have combinations.

**Why approach (c) is correct:**
- The existing bar already has `ALLOWED_LIMITS = [5,10,25,50,100,250,500]` (config.limit, default 100). With multi-column GROUP BY, the conceptual "limit" is x-categories. The pivot client-side then handles capping series.
- A generous SQL LIMIT = `config.limit × maxSeriesCap × 2` (e.g. 100 × 12 × 2 = 2400) is cheap for Kinetica (it just truncates the result set) and guarantees the pivot sees enough rows.
- Alternative (a) — no SQL LIMIT, cap everything client-side — risks returning millions of rows from large tables. Unsafe.
- Alternative (b) — two-stage queries (first rank col1 categories, then fetch their combos) — avoids the LIMIT problem but requires two round trips and complex SQL. Not warranted given the generous-LIMIT approach works.

**Exact SQL template (multi-column path):**
```sql
SELECT col1, col2, …, colN, AGG(metric) AS value
FROM <table_or_view><customWhere>
GROUP BY col1, col2, …, colN
ORDER BY value DESC
LIMIT <config.limit * maxSeriesCap * 2>
```

Where `maxSeriesCap` is read from `useAuthStore.getState().maxBarGroupBySeriesCap` at config-save time (or just use a constant 12 × 2 = 24 as the multiplier, keeping `config.limit` as the x-category intent).

**Kinetica GROUP BY alias note:** Kinetica supports `GROUP BY alias` in some contexts but the safe pattern is `GROUP BY col1, col2, colN` (by column name, not alias). The existing `ORDER BY value DESC` uses the alias `value` — that is fine because `value` is the SELECT alias, and Kinetica supports ORDER BY alias.

**whereCustomWhere injection site:** `whereCustomWhere(draft.customWhere)` returns `' WHERE (<predicate>)'` or `''` — injected between FROM and GROUP BY:
```sql
FROM <table><cw> GROUP BY …
```
This is the existing pattern from `ChartConfigPanel.tsx:385`.

**1-column path (BARGRP-V119-04, byte-identical):**
```sql
SELECT col1, AGG(metric) AS value
FROM <table><cw>
GROUP BY col1
ORDER BY value DESC
LIMIT <config.limit>
```
Identical to today's `generatedSql` for the single-column case.

### Pattern 2: rows → recharts pivot for multi-column bar

**Input shape from SQL:** Each SQL row has: `{ col1: "East", col2: "A", col3: "X", value: 1234 }`.

**Step 1 — Build compound series key:** For columns `[col2, col3, …]`, the series key = `row[col2] + " / " + row[col3] + …`. Example: `"A / X"`.

**Step 2 — Adapt rows for pivotSeriesRows:** `pivotSeriesRows` expects `{ bucket, series, value }[]`. Map:
```typescript
const pivotInput = rows.map(r => ({
  bucket: String(r[col1]),          // x-axis category
  series: [col2, col3, ...].map(c => String(r[c])).join(" / "),  // compound series key
  value: typeof r.value === "number" ? r.value : null,
}));
```

**Step 3 — selectTopSeries:** Pass `pivotInput` to `selectTopSeries(pivotInput, { max: maxBarGroupBySeriesCap })`. This ranks series by total aggregate value descending, returns `{ series: string[], truncated, total }`.

**Step 4 — pivotSeriesRows:** Pass `pivotInput` + `top.series` to get Recharts rows:
```typescript
// Result: [{ bucket: "East", "A / X": 1234, "B / Y": 567, … }, …]
const chartData = pivotSeriesRows(pivotInput, top.series);
// Note: pivotSeriesRows uses "bucket" as the x-axis key name
// The existing resolveKeys() reads config.groupByColumn for x — must update for multi-column
```

**Missing (x × series) cells:** `pivotSeriesRows` fills with `null` (gap). For bar charts, recharts renders null as a gap (bar absent, not zero). This is visually correct — no phantom bars for missing combinations.

**resolveKeys() update needed:** The existing `resolveKeys()` function in `WidgetRenderer.tsx` reads `config.groupByColumn` to find the x-axis key. In multi-column mode, after pivot the x-axis key is `"bucket"` (the name `pivotSeriesRows` assigns). The renderer must detect multi-column mode and use `"bucket"` as the x key, and the series keys replace the single `"value"` y-key.

### Pattern 3: recharts grouped vs stacked multi-`<Bar>`

**Grouped (clustered) — `stacked === false`:**
```tsx
{seriesKeys.map((sk, i) => (
  <Bar
    key={`series_${sk}`}
    dataKey={sk}
    name={sk}
    fill={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")}
    radius={horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0]}
    // NO stackId
    isAnimationActive={false}
  />
))}
```

**Stacked — `stacked === true`:**
```tsx
{seriesKeys.map((sk, i) => (
  <Bar
    key={`series_${sk}`}
    dataKey={sk}
    name={sk}
    fill={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")}
    stackId="stacked"   // SAME string on all bars → recharts stacks them
    isAnimationActive={false}
  />
))}
```

**Color cycling:** Use `themeColorsFor(getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME)!, Math.max(1, seriesKeys.length))` — identical to TimelineRenderer's `seriesColors`. The bar chart's existing `color` config field (single-series solid color) becomes a no-op when `groupByColumns.length >= 2`; in single-series mode it is unchanged.

**recharts stackId gotcha:** All `<Bar>` elements that share the same `stackId` string are stacked. An empty string `""` is NOT the same as absent — an empty stackId still stacks them. Always omit the prop (`undefined`) for grouped mode, never pass `""`.

### Pattern 4: Single-`<Cell>` per-row coloring + LabelList + drill-down in multi-series mode

**Current single-series `<Bar>`:** Has `data.map((row, i) => <Cell key={i} fill={color} fillOpacity={...} />)` for per-row dim-on-click. **This must be dropped** in the multi-series path — recharts does not support per-`<Cell>` coloring inside a stacked/grouped multi-`<Bar>` setup in a meaningful way. The dim-on-click affordance instead dims ALL `<Bar>` elements for non-clicked x-categories using the `BarChart onClick` state + `fillOpacity` on the `<Bar>` itself (not per-`<Cell>`).

Implementation: in multi-series mode, pass `fillOpacity` as a prop on each `<Bar>` rather than per-`<Cell>`:
```tsx
<Bar
  dataKey={sk}
  fillOpacity={clickedElement !== null
    ? /* if the active bucket matches this row → dim the bar? no — we dim by xCategory */
      1.0   // recharts handles per-row opacity via Cell; for grouped bars just skip Cell
    : 1.0}
/>
```

The cleanest approach for multi-series: remove the `<Cell>` per-row loop entirely. The dim-on-click affordance is a "nice to have" for the single-series path that is harder to implement correctly across multiple series — keep it ONLY for the ≤1 column path (BARGRP-V119-04 byte-identical), remove it for the multi-series path. This is consistent with how TimelineRenderer (multi-series lines) has no dim-on-click.

**LabelList:** Similarly, `showValueLabels` with `<LabelList>` is only meaningful for the single-series bar. In multi-series mode, omit `<LabelList>` (too cluttered with N bars per category). Lock: only emit `<LabelList>` when NOT in multi-series mode.

**Drill-down in multi-series mode:** Drill target is ALWAYS col1 (the x-axis category / `bucket` key). The `resolveAggregatedDrillTarget` function takes `groupByColumn` — for multi-column mode, pass `groupByColumns[0]` as `groupByColumn`. The clicked `payload` row from recharts will have `{ bucket: "East", "A / X": 1234, … }` — `resolveAggregatedDrillTarget` reads `payload[groupByColumn]` = `payload[groupByColumns[0]]`, which works because col1 is the bucket key. Note: must also check that `ColumnFormatTooltip` receives `groupByColumn = groupByColumns[0]` in multi-series mode.

### Pattern 5: Backward-compat (BARGRP-V119-04) exact gate

The guard condition in both `generatedSql` (config panel) and `BarRenderer`:

```typescript
const multiColumn = Array.isArray(config.groupByColumns) && config.groupByColumns.length >= 2;
```

When `multiColumn === false`:
- Config panel emits the EXISTING single-group SQL (using `config.groupByColumn` as today).
- `BarRenderer` follows the existing single-`<Bar dataKey="value">` path with per-`<Cell>` coloring and `<LabelList>`.
- `stacked` flag continues to be a no-op (as it is today, since there's only one series).
- `resolveKeys()` continues reading `config.groupByColumn` → x, `"value"` → y (byte-identical).

When `multiColumn === true`:
- Config panel emits the new multi-column SQL.
- `BarRenderer` follows the new pivot path, N `<Bar>` elements, stackId or not, no `<Cell>` loops.

The config field relationship: `groupByColumns?: string[]` is the new field. `groupByColumn` (the existing single-select field owned by ChartConfigPanel's generic Group By picker) becomes the source for `groupByColumns[0]` when length=1, or is superseded entirely by the N-column builder UI in the new `BarConfigPanel`.

### Pattern 6: Env-var cap plumbing (mirroring Phase 90 MAX_COMBINATION_VIEWS_PER_TABLE)

**Server (`packages/server/src/index.ts`):**
```typescript
// Immediately after the MAX_COMBINATION_VIEWS_PER_TABLE line (~180):
const MAX_BAR_GROUP_BY_SERIES = readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12);
```

**`/api/auth/me` response (~line 420):**
```typescript
return res.json({
  user: { username: ..., roles, permissions },
  authMode,
  ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES,
  maxCombinationViewsPerTable: MAX_COMBINATION_VIEWS_PER_TABLE,
  dvFilterScopeDisabled: DISABLE_DV_FILTER_SCOPE,
  maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES,   // NEW
});
```

**`MeResponse` type (`packages/web/src/api/client.ts`):**
```typescript
export type MeResponse = {
  user: AuthUser;
  authMode: AuthMode;
  ttlKeepaliveLeadMinutes: number;
  maxCombinationViewsPerTable: number;
  dvFilterScopeDisabled: boolean;
  maxBarGroupBySeriesCap: number;   // NEW
};
```

**`fetchMe` coalesce (same file, ~line 288):**
```typescript
maxBarGroupBySeriesCap: typeof json.maxBarGroupBySeriesCap === "number" ? json.maxBarGroupBySeriesCap : 12,
```

**`auth.ts` store:**
```typescript
// AuthState type:
maxBarGroupBySeriesCap: number;

// Initial state:
maxBarGroupBySeriesCap: 12,

// bootstrap set():
set({ ..., maxBarGroupBySeriesCap: me.maxBarGroupBySeriesCap, ... });
```

**Client read site (BarConfigPanel + BarRenderer):**
```typescript
const maxBarGroupBySeriesCap = useAuthStore((s) => s.maxBarGroupBySeriesCap);
```

### Pattern 7: Multi-column config UI (BarConfigPanel)

The bar chart currently uses the GENERIC `ChartConfigPanel` (no `CustomConfigPanel` in its registry entry). The multi-column group-by UI requires a custom panel because the generic panel only supports a single `groupByColumn` select.

Two options:
1. **Convert bar to a CustomConfigPanel** (like NumericLineConfigPanel, TimelineConfigPanel) — gives full control, handles the N-column builder, but requires duplicating the Data Source / metric picker sections.
2. **Extend the generic panel** with an in-panel N-column builder for the bar type specifically — harder because ChartConfigPanel doesn't currently have chart-type-specific injection points.

**Recommendation: create `BarConfigPanel.tsx`** as a `CustomConfigPanel` (mirrors `NumericLineConfigPanel.tsx`). The bar's registry entry in `definitions/bar.ts` sets `CustomConfigPanel: BarConfigPanel`. The custom panel owns: data source picker, metric+aggregation picker, N-column group-by builder (add/remove row), sort/limit controls, grouped/stacked toggle, and the generated SQL preview.

This is exactly the pattern used for `NumericLineConfigPanel` — the metrics[] add/remove-row builder is adapted for an ordered `groupByColumns[]` list.

**N-column builder UI pattern (from NumericLineConfigPanel):**
- Ordered list of column selects, each with a remove (×) button.
- "+ Add column" button (disabled when at `sane_max_columns`, e.g. 6 — a soft constant, not the series cap).
- The first entry is "Primary group (x-axis)". Subsequent entries are "Series dimension 2", "Series dimension 3", etc.
- `groupByColumns` in config is the ordered array; `groupByColumns[0]` is always the x-axis.

### Anti-Patterns to Avoid
- **ORDER BY alias in GROUP BY:** Use column names in GROUP BY, not aliases. Kinetica supports `ORDER BY value` (alias) but `GROUP BY value` would be wrong if `value` is not a column name.
- **stackId="":** Empty string stackId still triggers stacking in recharts. Always omit the prop (undefined) for grouped mode.
- **Per-`<Cell>` in multi-series mode:** recharts `<Cell>` inside a multi-series `<BarChart>` affects only the first `<Bar>` series in some recharts versions. Remove `<Cell>` loops in the multi-series path.
- **Not gating LabelList:** `<LabelList>` inside the first `<Bar>` of a multi-series grouped bar cluster overflows labels. Gate on single-series mode only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Series ranking + top-N cap | Custom sort+slice | `selectTopSeries` from `groupedSeries.ts` | Already handles ties, null values, returns truncated+total |
| flat rows → keyed recharts rows | Custom pivot | `pivotSeriesRows` from `groupedSeries.ts` | Already handles missing (bucket×series) combos → null gaps |
| Series color cycling | Manual index→hex | `themeColorsFor(getCbColorTheme(...), N)` | ColorBrewer ramp, theme-aware, used by TimelineRenderer |
| CSS hex colors in SVG | Hardcode `#hex` | `toCssColor(aarrggbb)` local helper (already in TimelineRenderer) | Recharts needs `#hex`; Kinetica CB colors are `FFhhhhhh` |
| Env var parsing + fallback | Custom parse | `readPositiveIntEnv(name, default)` in server/index.ts | Already validates, warns on invalid, returns default |

---

## Common Pitfalls

### Pitfall 1: Kinetica GROUP BY alias vs column name
**What goes wrong:** Writing `GROUP BY series` when `series` is a SELECT alias — works in some SQL dialects, fails in Kinetica.
**Why it happens:** TimelineRenderer's top-N pre-query uses `GROUP BY series` (an alias) — this works because Kinetica's SQL parser allows it in that context. But in the generated SQL baked into `config.sql`, the columns are literal names, not aliases. Always use `GROUP BY col1, col2, colN` with the actual column names.
**How to avoid:** In `generatedSql`, enumerate column names directly: `GROUP BY ${groupByColumns.join(", ")}`.

### Pitfall 2: LIMIT starvation with naive ORDER BY value DESC
**What goes wrong:** `LIMIT 100` with `GROUP BY col1, col2` returns the 100 highest-aggregate (col1,col2) pairs, which may be dominated by one or a few x-categories. x-categories with lower aggregate values get zero rows, so the pivot has gaps that look like missing data rather than legitimate zero/null.
**Why it happens:** ORDER BY value DESC is globally across all (col1,col2) combos.
**How to avoid:** Use a generous LIMIT = `config.limit × maxSeriesCap × 2`. With defaults (100 × 12 × 2 = 2400), this is more than enough for any realistic bar chart. The pivot then client-side caps series via `selectTopSeries`.

### Pitfall 3: Compound series key collisions with " / " separator
**What goes wrong:** If a column VALUE contains " / " (e.g., `region = "North / East"`), the compound key `"North / East / Q1"` is ambiguous with `region = "North"` + `subregion = "East / Q1"`.
**Why it happens:** Simple string join.
**How to avoid:** Accept this as a known edge case (the CONTEXT.md decision says "joined by ' / '"). Document it; don't engineer around it. Column values containing " / " are uncommon in real data and the feature is designer-configured. If it becomes a problem, a different separator can be chosen later.
**Warning signs:** Duplicate series labels in the legend; series that appear to merge.

### Pitfall 4: `stacked` boolean was a no-op — now it matters
**What goes wrong:** Existing saved bar configs have `stacked: false` (default). When a designer adds a second group-by column, the existing `stacked: false` correctly defaults to grouped (clustered). This is fine. But the REVERSE is the risk: a designer who previously set `stacked: true` (which was a no-op) will now suddenly see stacked bars when they add a second column. This is the intended behavior per locked decisions, but deserves a note in the UI.
**How to avoid:** The config panel should show the Stacked toggle clearly with its new effective meaning when ≥2 columns are selected.

### Pitfall 5: `resolveKeys()` still reads `config.groupByColumn` — wrong in multi-series mode
**What goes wrong:** `resolveKeys()` at `WidgetRenderer.tsx:822` returns `x = config.groupByColumn`. After pivot, the x-axis key in chartData is `"bucket"` (assigned by `pivotSeriesRows`), not `config.groupByColumn`. The bar would try to use a non-existent key.
**How to avoid:** In multi-series mode, skip `resolveKeys()` entirely. Use `x = "bucket"` and `seriesKeys = top.series` directly. In single-series mode (BARGRP-V119-04 gate), continue using `resolveKeys()` unchanged.

### Pitfall 6: ColumnFormatTooltip `groupByColumn` prop in multi-series mode
**What goes wrong:** `ColumnFormatTooltip` receives `groupByColumn` to display the category label. In multi-series mode, the pivot key is `"bucket"` but the actual column name is `groupByColumns[0]`. Passing `"bucket"` would cause resolveLabel to fail to find a label.
**How to avoid:** Always pass `groupByColumns[0]` (or `groupByColumn` for the single-column path) as the `groupByColumn` prop to `ColumnFormatTooltip`, not the synthetic `"bucket"` key.

### Pitfall 7: drill-down target in multi-series mode
**What goes wrong:** `resolveAggregatedDrillTarget(payload, groupByColumn, ...)` reads `payload[groupByColumn]`. After pivot, `payload` has `{ bucket: "East", "A / X": 1234, … }`. The x-axis category IS `payload["bucket"]`, not `payload[groupByColumns[0]]`.
**How to avoid:** In multi-series mode, do NOT call `resolveAggregatedDrillTarget` with `groupByColumns[0]` unless the SQL SELECT also aliases col1 as `groupByColumns[0]` (which it does — `SELECT col1, col2, … AS value`). The pivotSeriesRows function uses the raw row's col1 value as the bucket key. The SQL emits col1 by its real name. So `pivotSeriesRows` maps `row[col1]` → `bucket`. The payload has key `"bucket"` only. Drill must read `payload["bucket"]` and filter on column `groupByColumns[0]`. Update `resolveAggregatedDrillTarget` call: pass `"bucket"` as `groupByColumn` and pass the correct `drillDownColumn = groupByColumns[0]` in the fallback; OR simply extract `payload["bucket"]` directly and dispatch with `column = groupByColumns[0]`.

The cleanest approach: in multi-series BarRenderer, bypass `resolveAggregatedDrillTarget` and directly do:
```typescript
const drillValue = payload?.["bucket"];
dispatchDrillDown({ ..., column: groupByColumns[0], value: drillValue, ... });
```

### Pitfall 8: config.sql baked at save time vs. renderer pivot needs groupByColumns
**What goes wrong:** The renderer reads `config.sql` to run the query (via `AggregatedWidgetRenderer`). But the pivot logic in `BarRenderer` needs to know `groupByColumns` to: (a) determine the x-axis key, (b) build compound series keys. The renderer must read `config.groupByColumns` from the config, NOT derive it from the SQL string.
**How to avoid:** `config.groupByColumns` must be persisted alongside `config.sql` at save time in `BarConfigPanel`'s `onChange`. The renderer reads both.

---

## Code Examples

### generatedSql multi-column path

```typescript
// Source: ChartConfigPanel.tsx:361-385 (single-column pattern); adapted for multi-column
// Triggered when groupByColumns.length >= 2
const cols = groupByColumns; // e.g. ["region", "category", "quarter"]
const colsClause = cols.join(", ");
const aggExpr = aggregation === "COUNT_DISTINCT"
  ? `COUNT(DISTINCT ${metricColumn})`
  : `${aggregation}(${metricColumn})`;
const sortDir = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
const rawLimit = Number(draft.limit);
const groupLimit = ALLOWED_LIMITS.includes(rawLimit) ? rawLimit : 100;
const seriesCap = useAuthStore.getState().maxBarGroupBySeriesCap; // read at save time
const sqlLimit = groupLimit * seriesCap * 2;
const cw = whereCustomWhere(draft.customWhere as string | undefined);
return `SELECT ${colsClause}, ${aggExpr} AS value FROM ${table}${cw} GROUP BY ${colsClause} ORDER BY value ${sortDir} LIMIT ${sqlLimit}`;
```

### BarRenderer multi-series pivot

```typescript
// Source: pattern mirrors TimelineRenderer.tsx:358-373 (pivot) + groupedSeries.ts:93-127
const groupByColumns = (config.groupByColumns as string[] | undefined) ?? [];
const multiSeries = groupByColumns.length >= 2;
const maxCap = useAuthStore((s) => s.maxBarGroupBySeriesCap);

if (multiSeries) {
  // data rows from AggregatedWidgetRenderer: { col1: "East", col2: "A", col3: "X", value: 1234 }
  const [col1, ...restCols] = groupByColumns;
  const pivotInput = data.map(row => ({
    bucket: String(row[col1]),
    series: restCols.map(c => String((row as Record<string,unknown>)[c])).join(" / "),
    value: typeof row["value"] === "number" && Number.isFinite(row["value"] as number)
      ? row["value"] as number
      : null,
  }));
  const top = selectTopSeries(pivotInput, { max: maxCap });
  const chartData = pivotSeriesRows(pivotInput, top.series);
  // chartData rows: { bucket: "East", "A / X": 1234, "B / Y": 567, … }
}
```

### N `<Bar>` elements

```tsx
// Source: pattern mirrors TimelineRenderer.tsx:656-668 (series Lines)
const stacked = config.stacked === true;
const seriesColors = themeColorsFor(
  getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME)!,
  Math.max(1, top.series.length),
);
{top.series.map((sk, i) => (
  <Bar
    key={`series_${sk}`}
    dataKey={sk}
    name={sk}
    fill={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")}
    radius={stacked ? 0 : (horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0])}
    {...(stacked ? { stackId: "stacked" } : {})}
    isAnimationActive={false}
  />
))}
```

### Truncation warning (reuse existing config-hint class)

```tsx
// Source: TimelineRenderer.tsx:531-539 pattern
{multiSeries && top.truncated && (
  <div
    className="config-hint"
    data-testid="bar-truncated-note"
    style={{ color: "var(--muted)", fontSize: 11, padding: "2px 6px" }}
  >
    Showing top {maxCap} of {top.total} series
  </div>
)}
```

The `config-hint` class is confirmed in `global.css` (used widely across the app). No new className invented.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Single `<Bar dataKey="value">` | N `<Bar dataKey={seriesKey}>` | Requires pivot step; resolveKeys() bypassed |
| `groupByColumn` single string | `groupByColumns?: string[]` (ordered) | Backward-compat: absent/length≤1 → old path |
| `stacked` no-op | `stacked` controls `stackId` presence | No breaking change for single-series configs |
| Generic ChartConfigPanel for bar | New `BarConfigPanel` CustomConfigPanel | Mirrors NumericLineConfigPanel pattern |

---

## Open Questions

1. **BarConfigPanel: does it duplicate the metric picker?**
   - What we know: `CustomConfigPanel` in ChartConfigPanel's scaffold already renders the Data Source section and calls `persistCustom(cfg)` — the metric picker lives in `ChartConfigPanel` for the generic path, but custom panel gets `columns` prop and owns its own metric UI.
   - What's unclear: Does BarConfigPanel need to re-implement the metric picker (metricColumn + aggregation + custom metrics support) from scratch?
   - Recommendation: Yes — look at `NumericLineConfigPanel` which fully owns its metric rows including custom metric support (it reads `selectMetrics(tableId)` and uses `decodeMetricSelection`). BarConfigPanel does the same for its single metric field. The existing `ChartConfigPanel` custom-panel scaffold passes `columns` so the panel has access.

2. **Should `config.limit` remain the x-category cap or the SQL LIMIT directly?**
   - What we know: In the single-column path, `config.limit` = the SQL LIMIT = number of top groups. In multi-column mode, the SQL LIMIT should be larger (generous multiple).
   - What's unclear: Whether to preserve `config.limit` as "max x-categories shown" (semantic) or document it as just "SQL row budget".
   - Recommendation: In multi-column mode, re-interpret `config.limit` as "max x-axis categories" and compute `sqlLimit = config.limit × maxSeriesCap × 2`. This is transparent to the designer — the hint text says "Maximum number of groups to return" which still makes sense.

3. **Horizontal bar orientation with multi-series stacked:** recharts `layout="vertical"` + stacked `<Bar>` — does the stack direction flip correctly?
   - What we know: recharts stacked bars work in both horizontal and vertical layout. The `stackId` mechanism is layout-agnostic.
   - Recommendation: Test visually; no code change needed for the stack direction.

---

## Validation Architecture

Nyquist validation is not required for this phase per task context. Key test considerations for the planner:

- **BARGRP-V119-04 gate:** A vitest spec that reads `BarRenderer` source and asserts the single-series path uses `dataKey="value"` (string literal), not `dataKey={seriesKey}` — mirroring the TimelineRenderer spec pattern (`TimelineRenderer.spec.tsx:496-501`).
- **generatedSql spec:** ChartConfigPanel.spec.tsx already tests `generatedSql` for bar. Add cases for `groupByColumns.length >= 2` → SQL contains `GROUP BY col1, col2` and appropriate LIMIT. And for `groupByColumns.length <= 1` → SQL is byte-identical to current.
- **selectTopSeries/pivotSeriesRows:** Already tested via groupedSeries.ts's own spec (if one exists) or covered by TimelineRenderer specs. No new tests needed for the library functions themselves.
- **Server test gate:** Adding a field to `/api/auth/me` does not add new test FILES — it modifies the existing `/api/auth/me` supertest (which is a known-passing file). Verify the server supertest covers the new field.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `packages/web/src/lib/groupedSeries.ts` — `selectTopSeries`, `pivotSeriesRows`, `MAX_SERIES` (12)
- Direct codebase read: `packages/web/src/components/charts/TimelineRenderer.tsx` — grouped path (lines 321-378), series pivot, color cycling, truncation warning
- Direct codebase read: `packages/web/src/components/charts/ChartConfigPanel.tsx` — `generatedSql` (lines 361-386), `whereCustomWhere` injection, `ALLOWED_LIMITS`, `sortDir`, `limit`
- Direct codebase read: `packages/web/src/components/charts/WidgetRenderer.tsx` — `BarRenderer` (lines 860-1051), `resolveKeys`, `resolveAggregatedDrillTarget`, `<Bar>/<Cell>/<LabelList>` structure
- Direct codebase read: `packages/web/src/components/charts/definitions/bar.ts` — `stacked` field (line 18), `defaultConfig.stacked: false` (line 46)
- Direct codebase read: `packages/server/src/index.ts` — `readPositiveIntEnv` (lines 162-173), `MAX_COMBINATION_VIEWS_PER_TABLE` (line 180), `/api/auth/me` payload (line 420)
- Direct codebase read: `packages/web/src/api/client.ts` — `MeResponse` type (line 251), `fetchMe` with defensive coalesces (lines 272-294)
- Direct codebase read: `packages/web/src/store/auth.ts` — `maxCombinationViewsPerTable` field pattern (lines 18-19, 36-37, 52)
- Direct codebase read: `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — metrics[] add/remove-row builder pattern (lines 140-267)

### Secondary (MEDIUM confidence)
- recharts 2.x `stackId` semantics — confirmed by existing `BarChart` usage pattern and TimelineRenderer multi-series lines pattern (no explicit recharts docs read; behavior is well-established in existing code)

---

## Metadata

**Confidence breakdown:**
- SQL shape + LIMIT strategy: HIGH — derived from reading actual `generatedSql` code + TimelineRenderer's top-N pre-query pattern; the generous-LIMIT approach is proven by existing patterns
- Pivot / recharts mapping: HIGH — `pivotSeriesRows` and `selectTopSeries` are fully read; recharts `<Bar stackId>` behavior confirmed from existing registry field
- Env-var plumbing: HIGH — the exact chain (readPositiveIntEnv → /api/auth/me → MeResponse → fetchMe coalesce → auth store) is read line by line from three files
- Drill-down target in multi-series mode: HIGH — `resolveAggregatedDrillTarget` and `payload["bucket"]` interaction fully analyzed
- Backward-compat path: HIGH — `groupByColumn` → single-series path guard is a simple `Array.isArray(groupByColumns) && groupByColumns.length >= 2` check

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (stable codebase, no fast-moving dependencies)
