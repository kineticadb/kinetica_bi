// Phase 132 (LINE-V126-03): the aggregation picker labels, moved out of ChartConfigPanel so the line-chart title helper can reuse them (single source; ChartConfigPanel re-imports in plan 132-03).
// PURE module, zero React/Recharts/Zustand imports.

export type AggregationOption = { value: string; label: string };

export const AGGREGATIONS: readonly AggregationOption[] = [
  { value: "SUM", label: "Sum" },
  { value: "AVG", label: "Average" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "COUNT", label: "Count" },
  { value: "COUNT_DISTINCT", label: "Count Distinct" },
  { value: "STDDEV", label: "Std Deviation" },
  { value: "VARIANCE", label: "Variance" },
];

export function aggregationLabel(value: string | undefined): string {
  if (!value) return "";
  return AGGREGATIONS.find((a) => a.value === value)?.label ?? value;
}

export function isCountAggregation(aggregation: unknown): boolean {
  const a = typeof aggregation === "string" ? aggregation.toUpperCase() : "";
  return a === "COUNT" || a === "COUNT_DISTINCT";
}

/** The column whose display format applies to an aggregated value: none for a count, which is a plain number even when it counts a date or currency column. */
export function valueFormatColumn(metricColumn: string, aggregation: unknown): string {
  return isCountAggregation(aggregation) ? "" : metricColumn;
}

/** Axis ticks for a count: thousands separators ("32,000"). undefined for other aggregations, whose ticks keep their own format. */
export function countTickFormatter(aggregation: unknown): ((v: unknown) => string) | undefined {
  if (!isCountAggregation(aggregation)) return undefined;
  return (v) => (typeof v === "number" ? v.toLocaleString() : String(v ?? ""));
}
