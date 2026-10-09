// Phase 132 (LINE-V126-03): PURE module, zero React/Recharts/Zustand imports.
import { aggregationLabel } from "./aggregationLabels";

export type LineMetricTitleInput = {
  yFieldLabel?: string;
  customLabel?: string | null;
  columnLabel?: string | null;
  metricColumn?: string;
  aggregation?: string;
  fallbackKey?: string;
};

/**
 * One source for the Y-axis title AND the single-series legend/tooltip name
 * (UI-SPEC D-08/D-09). The caller does all store reads (resolveMetricLabel /
 * resolveLabel) so this stays pure. Never returns the literal "value".
 */
export function resolveLineMetricTitle(a: LineMetricTitleInput): string {
  if (a.yFieldLabel && a.yFieldLabel.trim() !== "") return a.yFieldLabel;
  if (a.customLabel) return a.customLabel;
  // A label equal to the raw column means "unset" (resolveLabel falls back to the raw name).
  if (a.metricColumn && a.columnLabel && a.columnLabel !== a.metricColumn) return a.columnLabel;
  if (a.metricColumn && a.aggregation) return `${aggregationLabel(a.aggregation)} of ${a.metricColumn}`;
  if (a.metricColumn) return a.metricColumn;
  return a.fallbackKey && a.fallbackKey !== "value" ? a.fallbackKey : "Metric";
}
