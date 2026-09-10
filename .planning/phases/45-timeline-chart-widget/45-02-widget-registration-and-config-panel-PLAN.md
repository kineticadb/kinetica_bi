---
phase: 45-timeline-chart-widget
plan: 02
type: execute
wave: 2
depends_on: ["45-01"]
files_modified:
  - kinetica_bi/src/components/charts/definitions/timeline.ts
  - kinetica_bi/src/components/charts/definitions/index.ts
  - kinetica_bi/src/components/charts/TimelineConfigPanel.tsx
  - kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx
autonomous: true
requirements:
  - TIMELINE-V17-01
  - TIMELINE-V17-03
must_haves:
  truths:
    - "Visualization picker shows 'Timeline Chart' as a selectable type"
    - "TimelineConfigPanel renders a base-table picker, a time-column picker (datetime-only), an N-row metric builder (max 4 rows), and options (maxIntervals/showLegend/showTooltip/colorTheme/dateFormatOverride)"
    - "Time-column picker excludes non-datetime columns; uses inferDataTypeFromColumn === 'datetime'"
    - "Metric-column picker excludes non-numeric columns AND WKT/geometry via isColumnDrillDownSafe"
    - "Color theme defaults to 'Set2' (locked in CONTEXT.md 2026-05-29 post-research decisions)"
    - "Add metric button disables when filterFields.length >= 4"
    - "Changing base table clears time column AND metrics (old refs invalid)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/definitions/timeline.ts"
      provides: "registerTimeline() registry entry with type='timeline' / usesAggregation:false / usesDataSource:false / supportsDrillDown:false / CustomConfigPanel"
      exports: ["default registerTimeline"]
    - path: "kinetica_bi/src/components/charts/TimelineConfigPanel.tsx"
      provides: "CustomConfigPanel with base-table picker + time-col picker + N-row metric builder + options"
      exports: ["default TimelineConfigPanel", "TimelineConfig"]
    - path: "kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx"
      provides: "Config panel unit specs covering picker filters, max-4 metrics, change-table reset"
  key_links:
    - from: "kinetica_bi/src/components/charts/definitions/timeline.ts"
      to: "kinetica_bi/src/components/charts/TimelineConfigPanel.tsx"
      via: "import TimelineConfigPanel from \"../TimelineConfigPanel\""
      pattern: "CustomConfigPanel: TimelineConfigPanel"
    - from: "kinetica_bi/src/components/charts/definitions/index.ts"
      to: "kinetica_bi/src/components/charts/definitions/timeline.ts"
      via: "import registerTimeline + registerTimeline() call inside registerAllChartTypes"
      pattern: "registerTimeline\\(\\)"
    - from: "kinetica_bi/src/components/charts/TimelineConfigPanel.tsx"
      to: "kinetica_bi/src/lib/timelineBin.ts"
      via: "import type { TimelineMetric, TimelineAggregation } + DEFAULT_MAX_INTERVALS"
      pattern: "from \"\\.\\./\\.\\./lib/timelineBin\""
---

<objective>
Register the new "timeline" chart type and ship its CustomConfigPanel.

Purpose: Operators can pick "Timeline Chart" from the visualization picker. The config panel renders a base-table picker, a time-column picker (datetime types only), an N-row metric builder (column + aggregation + color + optional label; max 4 rows), and an options section (maxIntervals/showLegend/showTooltip/colorTheme/dateFormatOverride).

Output: timeline.ts registry entry, TimelineConfigPanel + its spec, updated definitions/index.ts. Plan ships dormant — no rendered widget until Plan 45-03 wires the short-circuit branch in WidgetRenderer.tsx.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/45-timeline-chart-widget/45-CONTEXT.md
@.planning/phases/45-timeline-chart-widget/45-RESEARCH.md
@.planning/phases/45-timeline-chart-widget/45-01-SUMMARY.md

<!-- Source-of-truth files the executor MUST read before touching anything -->
@kinetica_bi/src/components/charts/definitions/data-filter.ts
@kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/components/charts/definitions/index.ts
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/src/lib/cbColorThemes.ts
@kinetica_bi/src/lib/timelineBin.ts

<interfaces>
<!-- TYPES CREATED BY 45-01 (already on disk when this plan runs) -->

From `kinetica_bi/src/lib/timelineBin.ts`:
```typescript
export type TimelineAggregation =
  | "SUM" | "AVG" | "MIN" | "MAX"
  | "COUNT" | "COUNT_DISTINCT"
  | "STDDEV" | "VARIANCE";

export type TimelineMetric = {
  column: string;
  aggregation: TimelineAggregation;
  color: string;       // 8-char AARRGGBB
  label?: string;
};

export const DEFAULT_MAX_INTERVALS: number; // 200
```

<!-- TYPES CREATED BY THIS PLAN (Plan 45-02) — consumed by Plan 45-03 -->

From `kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` (CREATE):
```typescript
export type TimelineConfig = {
  tableId?: number;
  tableRef?: string;          // "schema.name"
  dynamicViewId?: number;     // future-compat; not exposed in picker yet (defer to follow-up)
  timeCol: string;
  metrics: TimelineMetric[];  // length 0..4
  maxIntervals: number;       // default 200
  showLegend: boolean;
  showTooltip: boolean;
  colorTheme: string;         // ColorBrewer scheme id; default "Set2"
  dateFormatOverride: string; // "" → "auto" smart format
};
```

<!-- EXISTING CONTRACTS (already in codebase) -->

From `kinetica_bi/src/components/charts/registry.ts`:
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  tables?: { id: number; name: string; schema: string; columns: Record<string, string> }[];
  isValid?: (valid: boolean) => void;
  widgets?: WidgetDto[];
};

export type ChartTypeDefinition = {
  type: string; label: string; icon: string;
  fields: ConfigField[];
  defaultConfig: Record<string, unknown>;
  CustomConfigPanel?: ComponentType<ConfigPanelProps>;
  usesAggregation?: boolean;
  requiresGroupBy?: boolean;
  usesDataSource?: boolean;
  supportsDrillDown?: boolean;
};
export function registerChartType(def: ChartTypeDefinition): void;
```

From `kinetica_bi/src/lib/columnTypes.ts`:
```typescript
export function inferDataTypeFromColumn(
  colName: string,
  columns: Record<string, string>
): "string" | "number" | "boolean" | "datetime" | "null";
export function isColumnDrillDownSafe(colType: string): boolean;
```

From `kinetica_bi/src/lib/cbColorThemes.ts`:
```typescript
export type CbColorTheme = { id: string; label: string; group: "Sequential"|"Diverging"|"Qualitative"; byCount: Record<number, string[]> };
export const CB_COLOR_THEMES: CbColorTheme[];
export function getCbColorTheme(id: string): CbColorTheme | undefined;
export function themeColorsFor(theme: CbColorTheme, count: number): string[]; // 8-char AARRGGBB
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: TimelineConfigPanel.tsx + TimelineConfig type + spec (Tasks 2 + 3 consumers)</name>
  <files>kinetica_bi/src/components/charts/TimelineConfigPanel.tsx, kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx (closest precedent — multi-row builder with base-table picker; mirror the patchTable + handleAddRow + handleRemoveRow + isValid effect pattern verbatim)
    - kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx (spec layout to mirror)
    - kinetica_bi/src/components/charts/registry.ts (ConfigPanelProps shape)
    - kinetica_bi/src/lib/columnTypes.ts (inferDataTypeFromColumn + isColumnDrillDownSafe — locked in CONTEXT.md 2026-05-29 post-research: DATETIME_TYPES is NOT exported; use inferDataTypeFromColumn === "datetime")
    - kinetica_bi/src/lib/cbColorThemes.ts (CB_COLOR_THEMES + getCbColorTheme + themeColorsFor — Set2 default locked)
    - kinetica_bi/src/lib/timelineBin.ts (TimelineMetric, TimelineAggregation, DEFAULT_MAX_INTERVALS — created by Plan 45-01)
    - .planning/phases/45-timeline-chart-widget/45-CONTEXT.md §Config panel UX + §Post-research decisions 2026-05-29
    - .planning/phases/45-timeline-chart-widget/45-RESEARCH.md §Focus Area E (Color Theme), §Focus Area G (DATETIME_TYPES not exported)
  </read_first>
  <action>
Create `kinetica_bi/src/components/charts/TimelineConfigPanel.tsx`:

```typescript
/**
 * Phase 45 Plan 02 (TIMELINE-V17-03): CustomConfigPanel for the 'timeline' chart type.
 *
 * Mirrors v1.7 Phase 44 DataFilterConfigPanel precedent (base-table picker + N-row builder).
 *
 * Sections (top → bottom):
 *   1. Data Source — base-table picker from props.tables
 *   2. Time column — single-select dropdown, filtered to datetime types via inferDataTypeFromColumn
 *   3. Metrics — N-row builder (max 4): column picker (numeric+safe) + aggregation + color swatch + label
 *   4. Options — maxIntervals / showLegend / showTooltip / colorTheme / dateFormatOverride
 *
 * Color theme default: "Set2" (locked in CONTEXT.md 2026-05-29 post-research decisions —
 * Tableau-10 from earlier RESEARCH was not in ColorBrewer; Set2 is 8-color qualitative).
 *
 * NO data fetch. NO Apply/Clear. This is config-only; Plan 45-03 ships the renderer.
 */

import { useEffect, useMemo } from "react";
import type { ConfigPanelProps } from "./registry";
import {
  inferDataTypeFromColumn,
  isColumnDrillDownSafe,
} from "../../lib/columnTypes";
import { CB_COLOR_THEMES, getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import type { TimelineMetric, TimelineAggregation } from "../../lib/timelineBin";
import { DEFAULT_MAX_INTERVALS } from "../../lib/timelineBin";

export const MAX_METRICS = 4;
export const DEFAULT_COLOR_THEME = "Set2"; // 8-color ColorBrewer qualitative (locked)

export type TimelineConfig = {
  tableId?: number;
  tableRef?: string;
  dynamicViewId?: number;
  timeCol: string;
  metrics: TimelineMetric[];
  maxIntervals: number;
  showLegend: boolean;
  showTooltip: boolean;
  colorTheme: string;
  dateFormatOverride: string;
};

const AGGREGATIONS: { value: TimelineAggregation; label: string }[] = [
  { value: "SUM",            label: "SUM" },
  { value: "AVG",            label: "AVG" },
  { value: "MIN",            label: "MIN" },
  { value: "MAX",            label: "MAX" },
  { value: "COUNT",          label: "COUNT" },
  { value: "COUNT_DISTINCT", label: "COUNT_DISTINCT" },
  { value: "STDDEV",         label: "STDDEV" },
  { value: "VARIANCE",       label: "VARIANCE" },
];

// AARRGGBB ("FF66C2A5") → "#66C2A5" for HTML color input + Recharts stroke.
function toCssColor(aarrggbb: string): string {
  // Defensive: accept already-hex inputs verbatim.
  if (aarrggbb.startsWith("#")) return aarrggbb;
  const hex = aarrggbb.length === 8 ? aarrggbb.slice(2) : aarrggbb;
  return "#" + hex.toLowerCase();
}

// "#66C2A5" → "FF66C2A5" (canonical AARRGGBB storage).
function toAarrggbb(css: string): string {
  const hex = css.replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return "FF" + hex;
  return "FF66C2A5"; // safe Set2[0] fallback
}

export default function TimelineConfigPanel({
  config,
  onChange,
  tables,
  isValid,
}: ConfigPanelProps): JSX.Element {
  const cfg = config as Partial<TimelineConfig>;
  const tableId = cfg.tableId;
  const allTables = tables ?? [];
  const timeCol = cfg.timeCol ?? "";
  const metrics = cfg.metrics ?? [];
  const maxIntervals = cfg.maxIntervals ?? DEFAULT_MAX_INTERVALS;
  const showLegend = cfg.showLegend ?? true;
  const showTooltip = cfg.showTooltip ?? true;
  const colorTheme = cfg.colorTheme ?? DEFAULT_COLOR_THEME;
  const dateFormatOverride = cfg.dateFormatOverride ?? "";

  // Resolve selected table
  const selectedTable = useMemo(
    () => (tableId !== undefined ? allTables.find((t) => t.id === tableId) : undefined),
    [tableId, allTables],
  );
  const columns: Record<string, string> = selectedTable?.columns ?? {};

  // Datetime columns for time-col picker (inferDataTypeFromColumn-based per CONTEXT.md 2026-05-29 lock).
  const timeColumns = useMemo(
    () =>
      Object.keys(columns).filter(
        (name) => inferDataTypeFromColumn(name, columns) === "datetime",
      ),
    [columns],
  );

  // Numeric + drilldown-safe columns for metric pickers.
  const metricColumns = useMemo(
    () =>
      Object.entries(columns)
        .filter(
          ([name, type]) =>
            inferDataTypeFromColumn(name, columns) === "number" &&
            isColumnDrillDownSafe(type),
        )
        .map(([name]) => name),
    [columns],
  );

  // Form validity: must have tableId + timeCol + at least 1 metric, every metric must have column + aggregation
  const formValid = useMemo(
    () =>
      tableId !== undefined &&
      timeCol !== "" &&
      metrics.length >= 1 &&
      metrics.length <= MAX_METRICS &&
      metrics.every((m) => m.column !== "" && m.aggregation !== undefined),
    [tableId, timeCol, metrics],
  );

  useEffect(() => {
    isValid?.(formValid);
  }, [formValid, isValid]);

  // Theme palette (size = current metrics count, min 1)
  const themePalette = useMemo(() => {
    const t = getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME);
    if (!t) return [];
    return themeColorsFor(t, Math.max(1, metrics.length || 1));
  }, [colorTheme, metrics.length]);

  // ----- Handlers -----

  const patch = (partial: Partial<TimelineConfig>) => {
    onChange({ ...(config as Record<string, unknown>), ...partial });
  };

  const handleTableChange = (newValue: string) => {
    if (newValue === "") {
      patch({ tableId: undefined, tableRef: undefined, timeCol: "", metrics: [] });
      return;
    }
    const newTable = allTables.find((t) => `${t.schema}.${t.name}` === newValue);
    if (!newTable) return;
    // Old timeCol / metrics may not exist on the new schema — clear both.
    patch({
      tableId: newTable.id,
      tableRef: `${newTable.schema}.${newTable.name}`,
      timeCol: "",
      metrics: [],
    });
  };

  const handleTimeColChange = (newCol: string) => patch({ timeCol: newCol });

  const handleAddMetric = () => {
    if (metrics.length >= MAX_METRICS) return;
    const palette = themePalette.length > 0
      ? themePalette
      : themeColorsFor(getCbColorTheme(DEFAULT_COLOR_THEME)!, metrics.length + 1);
    const nextColor = palette[metrics.length % palette.length] ?? "FF66C2A5";
    const newMetric: TimelineMetric = {
      column: "",
      aggregation: "SUM",
      color: nextColor,
      label: "",
    };
    patch({ metrics: [...metrics, newMetric] });
  };

  const handleRemoveMetric = (idx: number) =>
    patch({ metrics: metrics.filter((_, i) => i !== idx) });

  const updateMetric = (idx: number, partial: Partial<TimelineMetric>) => {
    const next = [...metrics];
    next[idx] = { ...next[idx], ...partial };
    patch({ metrics: next });
  };

  // Re-color all existing metrics from the newly-picked theme palette
  const handleThemeChange = (newTheme: string) => {
    const t = getCbColorTheme(newTheme);
    if (!t) {
      patch({ colorTheme: newTheme });
      return;
    }
    const palette = themeColorsFor(t, Math.max(1, metrics.length));
    const recolored = metrics.map((m, i) => ({
      ...m,
      color: palette[i % palette.length] ?? m.color,
    }));
    patch({ colorTheme: newTheme, metrics: recolored });
  };

  // ----- Render -----

  const baseTableValue = selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : "";
  const qualitativeThemes = CB_COLOR_THEMES.filter((t) => t.group === "Qualitative");

  return (
    <div className="config-group" role="group" aria-labelledby="timeline-config-label">
      <label id="timeline-config-label" className="config-group-label">
        TIMELINE CONFIG
      </label>

      {/* Data Source */}
      <div className="ds-field">
        <span className="ds-field-label">Base table</span>
        <select
          className="ds-select"
          aria-label="Base table"
          value={baseTableValue}
          onChange={(e) => handleTableChange(e.target.value)}
        >
          <option value="">Select a base table...</option>
          {allTables.map((t) => {
            const full = `${t.schema}.${t.name}`;
            return <option key={t.id} value={full}>{full}</option>;
          })}
        </select>
      </div>

      {tableId === undefined ? (
        <div className="config-hint">Pick a base table first.</div>
      ) : (
        <>
          {/* Time column */}
          <div className="ds-field">
            <span className="ds-field-label">Time column (X-axis)</span>
            <select
              className="ds-select"
              aria-label="Time column"
              value={timeCol}
              onChange={(e) => handleTimeColChange(e.target.value)}
            >
              <option value="">Pick a datetime column...</option>
              {timeColumns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {timeColumns.length === 0 && (
              <div className="config-hint">
                No datetime columns on this table. Pick a different table.
              </div>
            )}
          </div>

          {/* Metrics */}
          <div className="config-group-label" style={{ marginTop: 16 }}>
            METRICS (max {MAX_METRICS})
          </div>

          {metrics.length === 0 && (
            <div className="config-hint">
              No metrics. Click "Add metric" below to add up to {MAX_METRICS} lines.
            </div>
          )}

          {metrics.map((m, idx) => {
            const columnMissing = m.column !== "" && columns[m.column] === undefined;
            return (
              <div
                key={idx}
                className="timeline-metric-row"
                data-testid={`timeline-metric-row-${idx}`}
                style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <select
                  className="ds-select"
                  aria-label={`Metric ${idx + 1} column`}
                  value={m.column}
                  onChange={(e) => updateMetric(idx, { column: e.target.value })}
                >
                  <option value="">Pick a column...</option>
                  {metricColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                  className="ds-select"
                  aria-label={`Metric ${idx + 1} aggregation`}
                  value={m.aggregation}
                  onChange={(e) => updateMetric(idx, { aggregation: e.target.value as TimelineAggregation })}
                  disabled={m.column === "" || columnMissing}
                >
                  {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>

                <input
                  type="color"
                  aria-label={`Metric ${idx + 1} color`}
                  value={toCssColor(m.color)}
                  onChange={(e) => updateMetric(idx, { color: toAarrggbb(e.target.value) })}
                  style={{ width: 40, height: 28, padding: 0, border: "none" }}
                />

                <input
                  type="text"
                  className="ds-input"
                  aria-label={`Metric ${idx + 1} label`}
                  placeholder="Label (optional)"
                  value={m.label ?? ""}
                  onChange={(e) => updateMetric(idx, { label: e.target.value })}
                  style={{ flex: "1 1 120px", minWidth: 120 }}
                />

                <button
                  type="button"
                  className="ghost-sm ghost-danger"
                  aria-label={`Remove metric ${idx + 1}`}
                  onClick={() => handleRemoveMetric(idx)}
                >
                  Remove
                </button>

                {columnMissing && (
                  <span className="config-hint" style={{ color: "#c44" }}>
                    Column &apos;{m.column}&apos; not found on base table
                  </span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="ghost-sm"
            aria-label="Add metric"
            onClick={handleAddMetric}
            disabled={metrics.length >= MAX_METRICS}
          >
            + Add metric {metrics.length >= MAX_METRICS && `(max ${MAX_METRICS})`}
          </button>

          {/* Options */}
          <div className="config-group-label" style={{ marginTop: 16 }}>
            OPTIONS
          </div>

          <div className="ds-field">
            <span className="ds-field-label">Max intervals</span>
            <input
              type="number"
              className="ds-input"
              aria-label="Max intervals"
              min={2}
              max={1000}
              value={maxIntervals}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 2 && n <= 1000) patch({ maxIntervals: n });
              }}
            />
          </div>

          <label className="ds-field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              aria-label="Show legend"
              checked={showLegend}
              onChange={(e) => patch({ showLegend: e.target.checked })}
            />
            Show legend
          </label>

          <label className="ds-field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              aria-label="Show tooltip"
              checked={showTooltip}
              onChange={(e) => patch({ showTooltip: e.target.checked })}
            />
            Show tooltip
          </label>

          <div className="ds-field">
            <span className="ds-field-label">Color theme</span>
            <select
              className="ds-select"
              aria-label="Color theme"
              value={colorTheme}
              onChange={(e) => handleThemeChange(e.target.value)}
            >
              {qualitativeThemes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="ds-field">
            <span className="ds-field-label">Date format override</span>
            <input
              type="text"
              className="ds-input"
              aria-label="Date format override"
              placeholder='"auto" — smart format by interval (leave blank)'
              value={dateFormatOverride}
              onChange={(e) => patch({ dateFormatOverride: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

Then create `kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx` (mirror DataFilterConfigPanel.spec.tsx structure):

```typescript
// Phase 45 Plan 02 (TIMELINE-V17-03): TimelineConfigPanel specs.
// Mirrors DataFilterConfigPanel.spec.tsx layout. Uses @testing-library/react.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import TimelineConfigPanel, { MAX_METRICS, DEFAULT_COLOR_THEME, type TimelineConfig } from "./TimelineConfigPanel";
import type { TableDto } from "../../api/client";

const TABLES: NonNullable<Parameters<typeof TimelineConfigPanel>[0]["tables"]> = [
  {
    id: 1,
    name: "nyctaxi",
    schema: "demo",
    columns: {
      pickup_time: "timestamp",
      dropoff_time: "datetime",
      fare_amount: "double",
      passenger_count: "int",
      pickup_geom: "wkt",
      driver_id: "varchar",
    },
  },
  {
    id: 2,
    name: "other",
    schema: "demo",
    columns: { ts: "timestamp", amt: "double" },
  },
];

function renderPanel(initial: Partial<TimelineConfig> = {}, opts?: { isValid?: (b: boolean) => void }) {
  const onChange = vi.fn();
  const isValid = opts?.isValid ?? vi.fn();
  const utils = render(
    <TimelineConfigPanel
      config={{ metrics: [], ...initial } as Record<string, unknown>}
      onChange={onChange}
      tables={TABLES}
      isValid={isValid}
    />,
  );
  return { onChange, isValid, ...utils };
}

describe("TimelineConfigPanel", () => {
  it("Test 1: renders base-table picker with all tables; no fields visible until table selected", () => {
    renderPanel();
    expect(screen.getByLabelText("Base table")).toBeInTheDocument();
    expect(screen.getByText("Pick a base table first.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Time column")).not.toBeInTheDocument();
  });

  it("Test 2: selecting a base table calls onChange clearing timeCol+metrics", () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.nyctaxi" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "", metrics: [] }),
    );
  });

  it("Test 3: time-column picker only lists datetime columns (pickup_time + dropoff_time) — no numeric/wkt/string", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi" });
    const sel = screen.getByLabelText("Time column") as HTMLSelectElement;
    const opts = Array.from(sel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("pickup_time");
    expect(opts).toContain("dropoff_time");
    expect(opts).not.toContain("fare_amount");
    expect(opts).not.toContain("pickup_geom");
    expect(opts).not.toContain("driver_id");
  });

  it("Test 4: metric column picker only lists numeric+drilldown-safe columns; wkt excluded", () => {
    renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [{ column: "", aggregation: "SUM", color: "FF66C2A5" }],
    });
    const colSel = screen.getByLabelText("Metric 1 column") as HTMLSelectElement;
    const opts = Array.from(colSel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("fare_amount");
    expect(opts).toContain("passenger_count");
    expect(opts).not.toContain("pickup_time");
    expect(opts).not.toContain("driver_id");
    expect(opts).not.toContain("pickup_geom");
  });

  it("Test 5: Add metric button caps at MAX_METRICS=4 (disabled at 4)", () => {
    const metrics = Array.from({ length: 4 }, (_, i) => ({ column: "fare_amount", aggregation: "SUM" as const, color: "FF66C2A5" }));
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics });
    const btn = screen.getByRole("button", { name: /Add metric/ });
    expect(btn).toBeDisabled();
  });

  it("Test 6: isValid(true) once tableId + timeCol + ≥1 complete metric; isValid(false) otherwise", () => {
    const isValid = vi.fn();
    const { rerender } = render(
      <TimelineConfigPanel
        config={{ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "", metrics: [] } as Record<string, unknown>}
        onChange={vi.fn()}
        tables={TABLES}
        isValid={isValid}
      />,
    );
    expect(isValid).toHaveBeenLastCalledWith(false);

    rerender(
      <TimelineConfigPanel
        config={{
          tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
          metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
        } as Record<string, unknown>}
        onChange={vi.fn()}
        tables={TABLES}
        isValid={isValid}
      />,
    );
    expect(isValid).toHaveBeenLastCalledWith(true);
  });

  it("Test 7: default color theme is 'Set2' when colorTheme unspecified", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }] });
    expect((screen.getByLabelText("Color theme") as HTMLSelectElement).value).toBe(DEFAULT_COLOR_THEME);
  });

  it("Test 8: changing color theme re-colors all metrics", () => {
    const { onChange } = renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [
        { column: "fare_amount", aggregation: "SUM", color: "FF000000" },
        { column: "passenger_count", aggregation: "AVG", color: "FF111111" },
      ],
    });
    fireEvent.change(screen.getByLabelText("Color theme"), { target: { value: "Dark2" } });
    const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
    expect(call.colorTheme).toBe("Dark2");
    expect(call.metrics).toHaveLength(2);
    // New colors from Dark2 palette — must NOT equal the previous overrides.
    expect(call.metrics[0].color).not.toBe("FF000000");
    expect(call.metrics[1].color).not.toBe("FF111111");
  });

  it("Test 9: changing base table clears timeCol AND metrics (old refs invalid)", () => {
    const { onChange } = renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
    });
    fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.other" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tableId: 2, timeCol: "", metrics: [] }),
    );
  });

  it("Test 10: maxIntervals input clamps to [2, 1000]; default 200 displayed when unset", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }] });
    expect((screen.getByLabelText("Max intervals") as HTMLInputElement).value).toBe("200");
  });
});
```

The spec covers all 10 behaviors. Run after writing to ensure the test file compiles and all tests pass.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/TimelineConfigPanel.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/components/charts/TimelineConfigPanel.tsx && test -f kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx`
    - `grep -c "export type TimelineConfig" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns 1
    - `grep -c "export const MAX_METRICS = 4" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns 1
    - `grep -c "DEFAULT_COLOR_THEME = \"Set2\"" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns 1
    - `grep -c "inferDataTypeFromColumn" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns at least 2 (time + metric pickers)
    - `grep -c "isColumnDrillDownSafe" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns at least 1
    - `grep -c "from \"\\.\\./\\.\\./lib/timelineBin\"" kinetica_bi/src/components/charts/TimelineConfigPanel.tsx` returns 1
    - `cd kinetica_bi && npx vitest run src/components/charts/TimelineConfigPanel.spec.tsx` exits 0 with at least 10 tests passing
  </acceptance_criteria>
  <done>
    TimelineConfigPanel renders base-table picker → time-col picker (datetime-only) → N-row metric builder (max 4) → options. Color theme defaults to Set2; changing theme re-colors all metrics. Changing base table resets timeCol + metrics. isValid signals true only when tableId + timeCol + ≥1 complete metric exist.
  </done>
</task>

<task type="auto">
  <name>Task 2: definitions/timeline.ts registry entry + register in definitions/index.ts</name>
  <files>kinetica_bi/src/components/charts/definitions/timeline.ts, kinetica_bi/src/components/charts/definitions/index.ts</files>
  <read_first>
    - kinetica_bi/src/components/charts/definitions/data-filter.ts (verbatim pattern to mirror — usesAggregation:false + usesDataSource:false + CustomConfigPanel)
    - kinetica_bi/src/components/charts/definitions/legend.ts (second precedent)
    - kinetica_bi/src/components/charts/definitions/index.ts (existing register chain)
    - kinetica_bi/src/components/charts/registry.ts (ChartTypeDefinition shape)
    - kinetica_bi/src/components/charts/TimelineConfigPanel.tsx (Task 1; provides CustomConfigPanel + DEFAULT_COLOR_THEME + MAX_METRICS exports)
    - kinetica_bi/src/lib/timelineBin.ts (DEFAULT_MAX_INTERVALS)
  </read_first>
  <action>
Create `kinetica_bi/src/components/charts/definitions/timeline.ts`:

```typescript
/**
 * Phase 45 Plan 02 (TIMELINE-V17-01): Timeline Chart type registry entry.
 *
 * Mirrors v1.7 Phase 44 DataFilter precedent (CustomConfigPanel + usesDataSource:false +
 * no SQL run by the registry; the TimelineRenderer owns its full SQL lifecycle).
 *
 * - icon: "TL" (2-char text — matches DataFilter "DF", legend "LG", info-card "IC")
 * - usesAggregation: false (TimelineRenderer issues its own DATE_TRUNC/FLOOR-epoch SQL via runSql)
 * - usesDataSource: false (TimelineConfigPanel renders its own base-table picker; suppresses
 *   ChartConfigPanel's generic Data Source section)
 * - supportsDrillDown: false (drag-to-filter is a custom gesture in the renderer; the registry's
 *   generic drill-down picker is not applicable)
 * - defaultConfig: full TimelineConfig shape with sensible defaults; colorTheme = "Set2" (locked)
 *
 * Short-circuit renderer wired in Plan 45-03 via:
 *   else if (widget.type === "timeline") body = <TimelineRenderer widget={widget} tables={tables} />
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import TimelineConfigPanel, { DEFAULT_COLOR_THEME } from "../TimelineConfigPanel";
import { DEFAULT_MAX_INTERVALS } from "../../../lib/timelineBin";

const timeline: ChartTypeDefinition = {
  type: "timeline",
  label: "Timeline Chart",
  icon: "TL",
  fields: [],
  defaultConfig: {
    timeCol: "",
    metrics: [],
    maxIntervals: DEFAULT_MAX_INTERVALS,
    showLegend: true,
    showTooltip: true,
    colorTheme: DEFAULT_COLOR_THEME,
    dateFormatOverride: "",
  },
  usesAggregation: false,
  usesDataSource: false,
  supportsDrillDown: false,
  CustomConfigPanel: TimelineConfigPanel,
};

export default function registerTimeline() {
  registerChartType(timeline);
}
```

Then EDIT `kinetica_bi/src/components/charts/definitions/index.ts`:

1. Add `import registerTimeline from "./timeline";` next to the other imports (alphabetical position recommended but not required — match the existing import order style).
2. Add `registerTimeline();  // Phase 45 Plan 02 (TIMELINE-V17-01): Timeline Chart widget` to `registerAllChartTypes()` AFTER `registerDataFilter()`.

Final `registerAllChartTypes()` should call all existing registers PLUS `registerTimeline()`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/definitions src/components/charts/TimelineConfigPanel.spec.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/components/charts/definitions/timeline.ts`
    - `grep -c "type: \"timeline\"" kinetica_bi/src/components/charts/definitions/timeline.ts` returns 1
    - `grep -c "label: \"Timeline Chart\"" kinetica_bi/src/components/charts/definitions/timeline.ts` returns 1
    - `grep -c "usesDataSource: false" kinetica_bi/src/components/charts/definitions/timeline.ts` returns 1
    - `grep -c "CustomConfigPanel: TimelineConfigPanel" kinetica_bi/src/components/charts/definitions/timeline.ts` returns 1
    - `grep -c "registerTimeline" kinetica_bi/src/components/charts/definitions/index.ts` returns at least 2 (import + call)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run src/components/charts` exits 0 (broader chart-folder suite stays green)
  </acceptance_criteria>
  <done>
    Timeline chart type registered. `getAllChartTypes()` (used by the visualization picker modal at DashboardsPage.tsx:1025-1058) auto-includes "Timeline Chart" with no picker changes. Definition exports valid defaultConfig with Set2 theme + 200 maxIntervals. Plan 45-03 ready to consume.
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/lib/timelineBin.spec.ts src/lib/buildTimelineSql.spec.ts src/components/charts/TimelineConfigPanel.spec.tsx` exits 0
- `cd kinetica_bi && npx tsc --noEmit` exits 0
- Visualization picker auto-discovers "Timeline Chart" via `getAllChartTypes()` (no DashboardsPage edit needed; mirrors Phase 44 DataFilter precedent).
- Plan 45-02 ships dormant — `WidgetRenderer.tsx` does NOT yet short-circuit for `type === "timeline"` (Plan 45-03 wires the branch).
</verification>

<success_criteria>
- "Timeline Chart" appears in the visualization picker after `registerAllChartTypes()` runs at app boot.
- TimelineConfigPanel renders 4 sections: Data Source / Time column / Metrics / Options.
- Time-col picker uses `inferDataTypeFromColumn(name, columns) === "datetime"` for filtering (locked decision 2026-05-29).
- Metric-col picker uses `inferDataTypeFromColumn === "number" && isColumnDrillDownSafe(type)` (excludes WKT/geometry).
- Color theme default is "Set2" (locked 2026-05-29; was "Tableau-10" in earlier docs — corrected).
- Add-metric button disabled when metrics.length >= 4.
- Changing base table clears timeCol + metrics (both invalidate on new schema).
- TimelineConfig exported type ready for Plan 45-03 consumption.
- 10+ vitest specs pass for TimelineConfigPanel; tsc --noEmit clean.
</success_criteria>

<output>
After completion, create `.planning/phases/45-timeline-chart-widget/45-02-SUMMARY.md` recording:
- TimelineConfig final shape (any field additions/renames vs CONTEXT.md).
- DEFAULT_COLOR_THEME = "Set2" — confirm Set2 exists in CB_COLOR_THEMES at runtime.
- MAX_METRICS = 4 enforcement points (Add button disabled + render shows hint).
- handleThemeChange recoloring semantics (re-colors ALL metrics; documented for downstream verification).
- Spec test count + any rerender pattern notes if used.
</output>
