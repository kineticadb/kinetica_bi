/**
 * Phase 77 Plan 02 (COLAPPLY-V115-02): Shared custom Recharts Tooltip content component.
 *
 * Replaces the bare `<Tooltip {...RECHARTS_TOOLTIP_PROPS} />` across chart renderers.
 * Formats the numeric value via resolveFormatter(tableId, metricColumn) and labels the
 * category via resolveLabel(tableId, groupByColumn).
 *
 * CONTRACT:
 *   - Wrap container uses RECHARTS_TOOLTIP_PROPS.contentStyle (theme tokens) so the
 *     tooltip passes theme-guard WITHOUT allowlisting (no raw hex in this file).
 *   - Pass as `content={<ColumnFormatTooltip tableId={...} groupByColumn={...} metricColumn={...} />}`.
 *     Recharts injects active/payload/label onto the element at render time.
 *   - When tableId is undefined OR groupByColumn/metricColumn is empty, falls back to the
 *     raw recharts label/value — legacy/dv-bound widgets are never broken.
 */

import React from "react";
import { RECHARTS_TOOLTIP_PROPS } from "../../lib/chartTheme";
import {
  resolveLabel,
  resolveFormatter,
} from "../../store/columnDisplayConfigStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnFormatTooltipProps = {
  /** The source table id — undefined for dv-bound or legacy widgets (raw fallback). */
  tableId: number | undefined;
  /** Source column name for the category / x dimension. Empty string = unknown. */
  groupByColumn: string;
  /** Source column name for the metric / y dimension. Empty string = unknown. */
  metricColumn: string;
  // Recharts-injected (set by Recharts when used as `content` prop):
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: unknown;
    payload?: Record<string, unknown>;
    color?: string;
  }>;
  label?: unknown;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared custom Recharts Tooltip content component.
 *
 * Used as: `<Tooltip {...RECHARTS_TOOLTIP_PROPS} content={<ColumnFormatTooltip ... />} />`
 *
 * Recharts spreads active/payload/label onto the element — own props (tableId,
 * groupByColumn, metricColumn) are passed by the chart renderer at JSX creation time.
 */
export function ColumnFormatTooltip({
  tableId,
  groupByColumn,
  metricColumn,
  active,
  payload,
  label,
}: ColumnFormatTooltipProps): React.ReactElement | null {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Category label: resolved column label if both tableId and groupByColumn are known.
  const catLabel =
    tableId !== undefined && groupByColumn
      ? resolveLabel(tableId, groupByColumn)
      : undefined;

  // Category value: recharts injects the x-axis value as `label`.
  // When label is undefined (scatter/pie), fall back to the first payload row's groupByColumn key.
  const categoryValue =
    label !== undefined
      ? label
      : groupByColumn && payload[0]?.payload
        ? payload[0].payload[groupByColumn]
        : undefined;

  // Metric formatter: applied to each payload entry's value.
  const fmt: (v: unknown) => unknown =
    tableId !== undefined && metricColumn
      ? resolveFormatter(tableId, metricColumn)
      : (v) => v;

  // Metric label: the value line should describe the METRIC (e.g. "Total Revenue"),
  // not echo Recharts' per-entry `name`. For a pie/single-series chart that name is
  // the slice's CATEGORY value (e.g. "NYC") — already shown on the category line above,
  // so repeating it is redundant and the metric's label never appears. Use the resolved
  // metric label for single-series payloads; keep per-entry names for true multi-series
  // (grouped bar/line) where each entry is a distinct series.
  const metricLabel =
    tableId !== undefined && metricColumn
      ? resolveLabel(tableId, metricColumn)
      : undefined;
  const singleSeries = payload.length === 1;

  return (
    <div
      style={{
        ...RECHARTS_TOOLTIP_PROPS.contentStyle,
        padding: "6px 10px",
      }}
    >
      {/* Category line */}
      {categoryValue !== undefined && (
        <p
          style={{
            margin: "0 0 4px 0",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: "var(--text-sm)",
          }}
        >
          {catLabel != null ? `${catLabel}: ` : ""}
          {String(categoryValue)}
        </p>
      )}

      {/* Value lines — one per payload entry */}
      {payload.map((entry, i) => {
        // Single-series → prefer the metric label; multi-series → keep the per-series name.
        const valueName = singleSeries && metricLabel != null ? metricLabel : entry.name;
        return (
          <p
            key={i}
            style={{
              margin: "2px 0",
              color: entry.color ?? "var(--text)",
              fontSize: "var(--text-sm)",
            }}
          >
            {valueName != null ? `${valueName}: ` : ""}
            {String(fmt(entry.value) ?? "")}
          </p>
        );
      })}
    </div>
  );
}
