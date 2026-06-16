/**
 * Phase 66 Plan 04 (CAL-V113-01): Calendar Heatmap chart-type registry entry.
 *
 * Mirrors Phase 45 Plan 02 timeline.ts (CustomConfigPanel + usesDataSource:false +
 * no SQL run by the registry; CalendarRenderer owns its full SQL lifecycle in Phase 67).
 *
 * - icon: "CH" (2-char text — matches "TL"/"DF"/"LG"/"IC" convention)
 * - usesAggregation: false  ← LOCKED INVARIANT: keeps calendar OUT of
 *   AggregatedWidgetRenderer (the sole materialize trigger); never flip this.
 * - usesDataSource: false (CalendarConfigPanel renders its own dv-aware data-source
 *   picker; suppresses ChartConfigPanel's generic Data Source section)
 * - supportsDrillDown: false (cell-drill is a custom BETWEEN gesture in Phase 68,
 *   not the generic eq-only drill-down picker)
 * - defaultConfig: full CalendarConfig shape spread from DEFAULT_CALENDAR_CONFIG
 *
 * Short-circuit placeholder branch wired in Plan 66-04 Task 2 via:
 *   else if (effectiveWidget.type === "calendar") body = <placeholder div />
 * Real SVG CalendarRenderer ships in Phase 67.
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import CalendarConfigPanel, { DEFAULT_CALENDAR_CONFIG } from "../CalendarConfigPanel";

const calendar: ChartTypeDefinition = {
  type: "calendar",
  label: "Calendar Heatmap",
  icon: "CH",
  fields: [],
  defaultConfig: { ...DEFAULT_CALENDAR_CONFIG },
  usesAggregation: false,     // LOCKED INVARIANT: keeps calendar out of AggregatedWidgetRenderer (sole-materialize-trigger)
  usesDataSource: false,      // CalendarConfigPanel renders its OWN dv-aware data-source picker
  supportsDrillDown: false,   // cell-drill is a custom BETWEEN gesture (Phase 68), not the generic eq-only picker
  CustomConfigPanel: CalendarConfigPanel,
};

export default function registerCalendar() {
  registerChartType(calendar);
}
