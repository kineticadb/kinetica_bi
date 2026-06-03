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
  tableRef?: string;          // "schema.name"
  dynamicViewId?: number;     // future-compat; not exposed in picker yet (defer to follow-up)
  timeCol: string;
  metrics: TimelineMetric[];  // length 0..4
  maxIntervals: number;       // default 200
  showLegend: boolean;
  showTooltip: boolean;
  vertical: boolean;          // true → render with the bucket axis vertical (Recharts layout="vertical")
  colorTheme: string;         // ColorBrewer scheme id; default "Set2"
  dateFormatOverride: string; // "" → "auto" smart format
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
  const vertical = cfg.vertical ?? false;
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

          {/* Color theme — placed above Metrics so re-picking a theme visibly
              recolors each metric's swatch below. */}
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

          {/* Metrics */}
          <div className="config-group-label" style={{ marginTop: 16 }}>
            METRICS (max {MAX_METRICS})
          </div>

          {metrics.length === 0 && (
            <div className="config-hint">
              No metrics. Click &quot;Add metric&quot; below to add up to {MAX_METRICS} lines.
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
