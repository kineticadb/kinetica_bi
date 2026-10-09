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
