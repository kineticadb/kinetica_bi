/**
 * Phase 59 Plan 02 (RADIO-V111-01): Radio Group chart type registry entry.
 *
 * Mirrors Phase 44 data-filter precedent:
 *   - icon: "RG" (2-char text, matches data-filter's "DF", legend's "LG")
 *   - usesAggregation: false (no SQL — widget applies config patches to targets)
 *   - usesDataSource: false (RadioGroupConfigPanel renders its own target pickers;
 *     suppresses ChartConfigPanel's generic Data Source section)
 *   - supportsDrillDown: false (widget is a control, not a drill-down target)
 *   - defaultConfig: spread of RADIO_GROUP_DEFAULT_CONFIG as a plain Record
 *                    (orientation: "vertical", options: [])
 *
 * Phase 60 Plan 02 ships RadioGroupRenderer and wires its runtime dispatch via
 * WidgetRenderer.tsx (the `radiogroup` branch before AggregatedWidgetRenderer fallback).
 * This mirrors the datafilter + legend pattern: the registry def has no `renderer` field
 * because WidgetRenderer is the sole runtime dispatch point for these control widgets.
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import RadioGroupConfigPanel from "../RadioGroupConfigPanel";
import { RADIO_GROUP_DEFAULT_CONFIG } from "../../../lib/radioGroupConfig";

const radioGroup: ChartTypeDefinition = {
  type: "radiogroup",
  label: "Radio Dashboard Control",
  icon: "RG",
  fields: [],
  defaultConfig: {
    ...RADIO_GROUP_DEFAULT_CONFIG, // spread to a plain Record<string, unknown>
  },
  usesAggregation: false,
  usesDataSource: false, // RadioGroupConfigPanel renders its own target pickers
  supportsDrillDown: false,
  CustomConfigPanel: RadioGroupConfigPanel,
};

export default function registerRadioGroup() {
  registerChartType(radioGroup);
}
