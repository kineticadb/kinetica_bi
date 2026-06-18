/**
 * NumericLineConfigPanel — CustomConfigPanel for the 'numericline' chart type.
 *
 * The numeric analog of TimelineConfigPanel: instead of a datetime X-axis binned by a
 * time interval, the operator picks a NUMERIC X-axis column that is auto-binned into a
 * target number of buckets (Max buckets). Multiple metrics (1-4) plot as separate lines
 * on alternating Y-axes, exactly like the Timeline chart.
 *
 * Sections (top → bottom):
 *   1. Data Source — base-table picker from props.tables
 *   2. X-axis column — single-select, filtered to numeric columns
 *   3. Color theme — ColorBrewer Qualitative (above Metrics so swatches visibly recolor)
 *   4. Metrics — N-row builder (max 4): numeric column + aggregation + color + label
 *   5. Options — maxBuckets / showLegend / showTooltip
 *
 * NO data fetch. NO Apply/Clear. Config-only; NumericLineRenderer owns the SQL lifecycle.
 */

import { useEffect, useMemo } from "react";
import type { ConfigPanelProps } from "./registry";
import { inferDataTypeFromColumn, isColumnDrillDownSafe } from "../../lib/columnTypes";
import { CB_COLOR_THEMES, getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import type { NumericMetric, NumericAggregation } from "../../lib/numericBin";
import { DEFAULT_MAX_BUCKETS } from "../../lib/numericBin";
import { MAX_METRICS, DEFAULT_COLOR_THEME } from "./TimelineConfigPanel";

export type NumericLineConfig = {
  tableId?: number;
  tableRef?: string; // "schema.name"
  dynamicViewId?: number; // future-compat; not exposed in picker yet
  xField: string; // numeric X-axis column
  groupByColumn?: string; // Phase 72: optional group-by dimension. Non-empty → single-metric series-split.
  metrics: NumericMetric[]; // length 0..4
  maxBuckets: number; // default 50
  showLegend: boolean;
  showTooltip: boolean;
  vertical: boolean; // true → render with the bucket axis vertical (Recharts layout="vertical")
  colorTheme: string; // ColorBrewer scheme id; default "Set2"
};

const AGGREGATIONS: { value: NumericAggregation; label: string }[] = [
  { value: "SUM", label: "SUM" },
  { value: "AVG", label: "AVG" },
  { value: "MIN", label: "MIN" },
  { value: "MAX", label: "MAX" },
  { value: "COUNT", label: "COUNT" },
  { value: "COUNT_DISTINCT", label: "COUNT_DISTINCT" },
  { value: "STDDEV", label: "STDDEV" },
  { value: "VARIANCE", label: "VARIANCE" },
];

// AARRGGBB ("FF66C2A5") → "#66C2A5" for the HTML color input + Recharts stroke.
function toCssColor(aarrggbb: string): string {
  if (aarrggbb.startsWith("#")) return aarrggbb;
  const hex = aarrggbb.length === 8 ? aarrggbb.slice(2) : aarrggbb;
  return "#" + hex.toLowerCase();
}

// "#66C2A5" → "FF66C2A5" (canonical AARRGGBB storage).
function toAarrggbb(css: string): string {
  const hex = css.replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return "FF" + hex;
  return "FF66C2A5";
}

export default function NumericLineConfigPanel({
  config,
  onChange,
  tables,
  isValid,
}: ConfigPanelProps): JSX.Element {
  const cfg = config as Partial<NumericLineConfig>;
  const tableId = cfg.tableId;
  const allTables = tables ?? [];
  const xField = cfg.xField ?? "";
  const groupByColumn = cfg.groupByColumn ?? "";
  const grouped = groupByColumn !== "";
  const metrics = cfg.metrics ?? [];
  const maxBuckets = cfg.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  const showLegend = cfg.showLegend ?? true;
  const showTooltip = cfg.showTooltip ?? true;
  const vertical = cfg.vertical ?? false;
  const colorTheme = cfg.colorTheme ?? DEFAULT_COLOR_THEME;

  const selectedTable = useMemo(
    () => (tableId !== undefined ? allTables.find((t) => t.id === tableId) : undefined),
    [tableId, allTables],
  );
  const columns: Record<string, string> = selectedTable?.columns ?? {};

  // Numeric columns for the X-axis picker.
  const numericColumns = useMemo(
    () =>
      Object.keys(columns).filter(
        (name) => inferDataTypeFromColumn(name, columns) === "number",
      ),
    [columns],
  );

  // Numeric + drilldown-safe columns for metric pickers.
  const metricColumns = useMemo(
    () =>
      Object.entries(columns)
        .filter(
          ([name, type]) =>
            inferDataTypeFromColumn(name, columns) === "number" && isColumnDrillDownSafe(type),
        )
        .map(([name]) => name),
    [columns],
  );

  // Phase 72: group-eligible dimensions (drilldown-safe; excludes the selected xField).
  // Mirrors ChartConfigPanel / TimelineConfigPanel `isColumnDrillDownSafe` eligibility.
  const groupByColumns = useMemo(
    () =>
      Object.entries(columns)
        .filter(([name, type]) => name !== xField && isColumnDrillDownSafe(type))
        .map(([name]) => name),
    [columns, xField],
  );

  // Form validity:
  //  - ungrouped: tableId + xField + 1..MAX_METRICS, each metric complete.
  //  - grouped: tableId + xField + groupByColumn + a complete metrics[0] (metrics[1..] ignored).
  const formValid = useMemo(() => {
    if (tableId === undefined || xField === "") return false;
    if (grouped) {
      const m0 = metrics[0];
      return m0 !== undefined && m0.column !== "" && m0.aggregation !== undefined;
    }
    return (
      metrics.length >= 1 &&
      metrics.length <= MAX_METRICS &&
      metrics.every((m) => m.column !== "" && m.aggregation !== undefined)
    );
  }, [tableId, xField, grouped, metrics]);

  useEffect(() => {
    isValid?.(formValid);
  }, [formValid, isValid]);

  const themePalette = useMemo(() => {
    const t = getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME);
    if (!t) return [];
    return themeColorsFor(t, Math.max(1, metrics.length || 1));
  }, [colorTheme, metrics.length]);

  // ----- Handlers -----

  const patch = (partial: Partial<NumericLineConfig>) => {
    onChange({ ...(config as Record<string, unknown>), ...partial });
  };

  const handleTableChange = (newValue: string) => {
    if (newValue === "") {
      patch({ tableId: undefined, tableRef: undefined, xField: "", groupByColumn: "", metrics: [] });
      return;
    }
    const newTable = allTables.find((t) => `${t.schema}.${t.name}` === newValue);
    if (!newTable) return;
    // Old xField / groupByColumn / metrics may not exist on the new schema — clear all.
    patch({
      tableId: newTable.id,
      tableRef: `${newTable.schema}.${newTable.name}`,
      xField: "",
      groupByColumn: "",
      metrics: [],
    });
  };

  const handleXFieldChange = (newCol: string) =>
    // If the new X-axis column equals the current group-by, clear the group-by
    // (a column can't be both the X axis and the series split).
    patch({ xField: newCol, ...(newCol === groupByColumn ? { groupByColumn: "" } : {}) });

  // Phase 72: toggle the group-by dimension. NON-DESTRUCTIVE — never mutates the metrics
  // array on enable (metrics[1..] stay in config so clearing restores the multi-metric
  // builder). Only seeds metrics[0] when enabling with zero metrics so a single row renders.
  const handleGroupByChange = (newCol: string) => {
    if (newCol !== "" && metrics.length === 0) {
      const palette = themePalette.length > 0
        ? themePalette
        : themeColorsFor(getCbColorTheme(DEFAULT_COLOR_THEME)!, 1);
      const seedColor = palette[0] ?? "FF66C2A5";
      patch({
        groupByColumn: newCol,
        metrics: [{ column: "", aggregation: "SUM", color: seedColor, label: "" }],
      });
      return;
    }
    patch({ groupByColumn: newCol });
  };

  const handleAddMetric = () => {
    if (metrics.length >= MAX_METRICS) return;
    const palette = themePalette.length > 0
      ? themePalette
      : themeColorsFor(getCbColorTheme(DEFAULT_COLOR_THEME)!, metrics.length + 1);
    const nextColor = palette[metrics.length % palette.length] ?? "FF66C2A5";
    const newMetric: NumericMetric = { column: "", aggregation: "SUM", color: nextColor, label: "" };
    patch({ metrics: [...metrics, newMetric] });
  };

  const handleRemoveMetric = (idx: number) =>
    patch({ metrics: metrics.filter((_, i) => i !== idx) });

  const updateMetric = (idx: number, partial: Partial<NumericMetric>) => {
    const next = [...metrics];
    next[idx] = { ...next[idx], ...partial };
    patch({ metrics: next });
  };

  const handleThemeChange = (newTheme: string) => {
    const t = getCbColorTheme(newTheme);
    if (!t) {
      patch({ colorTheme: newTheme });
      return;
    }
    const palette = themeColorsFor(t, Math.max(1, metrics.length));
    const recolored = metrics.map((m, i) => ({ ...m, color: palette[i % palette.length] ?? m.color }));
    patch({ colorTheme: newTheme, metrics: recolored });
  };

  // ----- Render -----

  const baseTableValue = selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : "";
  const qualitativeThemes = CB_COLOR_THEMES.filter((t) => t.group === "Qualitative");

  return (
    <div className="config-group" role="group" aria-labelledby="numericline-config-label">
      <label id="numericline-config-label" className="config-group-label">
        NUMERIC LINE CONFIG
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
          {/* X-axis column */}
          <div className="ds-field">
            <span className="ds-field-label">X-axis column (numeric)</span>
            <select
              className="ds-select"
              aria-label="X-axis column"
              value={xField}
              onChange={(e) => handleXFieldChange(e.target.value)}
            >
              <option value="">Pick a numeric column...</option>
              {numericColumns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {numericColumns.length === 0 && (
              <div className="config-hint">
                No numeric columns on this table. Pick a different table.
              </div>
            )}
          </div>

          {/* Group By (optional) — Phase 72. Selecting a dimension collapses the
              chart to a single metric split into one series per group value;
              "None" restores the 1-4 multi-metric builder. */}
          <div className="ds-field">
            <span className="ds-field-label">Group By (optional)</span>
            <select
              className="ds-select"
              aria-label="Group by"
              value={groupByColumn}
              onChange={(e) => handleGroupByChange(e.target.value)}
            >
              <option value="">None</option>
              {groupByColumns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Color theme — above Metrics so re-picking visibly recolors swatches. */}
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

          {/* Metrics — when grouped, a single metric is split into one series per
              group value (multi-metric is mutually exclusive with group-by). */}
          <div className="config-group-label" style={{ marginTop: 16 }}>
            {grouped ? `METRIC (grouped by ${groupByColumn})` : `METRICS (max ${MAX_METRICS})`}
          </div>

          {metrics.length === 0 && (
            <div className="config-hint">
              No metrics. Click &quot;Add metric&quot; below to add up to {MAX_METRICS} lines.
            </div>
          )}

          {(grouped ? metrics.slice(0, 1) : metrics).map((m, idx) => {
            const columnMissing = m.column !== "" && columns[m.column] === undefined;
            return (
              <div
                key={idx}
                className="timeline-metric-row"
                data-testid={`numericline-metric-row-${idx}`}
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
                  onChange={(e) => updateMetric(idx, { aggregation: e.target.value as NumericAggregation })}
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

                {!grouped && (
                  <button
                    type="button"
                    className="ghost-sm ghost-danger"
                    aria-label={`Remove metric ${idx + 1}`}
                    onClick={() => handleRemoveMetric(idx)}
                  >
                    Remove
                  </button>
                )}

                {columnMissing && (
                  <span className="config-hint" style={{ color: "var(--danger)" }}>
                    Column &apos;{m.column}&apos; not found on base table
                  </span>
                )}
              </div>
            );
          })}

          {!grouped && (
            <button
              type="button"
              className="ghost-sm"
              aria-label="Add metric"
              onClick={handleAddMetric}
              disabled={metrics.length >= MAX_METRICS}
            >
              + Add metric {metrics.length >= MAX_METRICS && `(max ${MAX_METRICS})`}
            </button>
          )}

          {/* Options */}
          <div className="config-group-label" style={{ marginTop: 16 }}>
            OPTIONS
          </div>

          <div className="ds-field">
            <span className="ds-field-label">Max buckets</span>
            <input
              type="number"
              className="ds-input"
              aria-label="Max buckets"
              min={2}
              max={1000}
              value={maxBuckets}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 2 && n <= 1000) patch({ maxBuckets: n });
              }}
            />
          </div>

          <label className="config-toggle">
            <input
              type="checkbox"
              aria-label="Show legend"
              checked={showLegend}
              onChange={(e) => patch({ showLegend: e.target.checked })}
            />
            <span>Show legend</span>
          </label>

          <label className="config-toggle">
            <input
              type="checkbox"
              aria-label="Show tooltip"
              checked={showTooltip}
              onChange={(e) => patch({ showTooltip: e.target.checked })}
            />
            <span>Show tooltip</span>
          </label>

          <label className="config-toggle">
            <input
              type="checkbox"
              aria-label="Vertical orientation"
              checked={vertical}
              onChange={(e) => patch({ vertical: e.target.checked })}
            />
            <span>Vertical orientation</span>
          </label>
        </>
      )}
    </div>
  );
}
