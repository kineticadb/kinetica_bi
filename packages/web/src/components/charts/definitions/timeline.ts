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
    vertical: false,
    colorTheme: DEFAULT_COLOR_THEME,
    dateFormatOverride: "",
  },
  usesAggregation: false,
  usesDataSource: false, // TimelineConfigPanel renders its own table picker
  supportsDrillDown: false,
  CustomConfigPanel: TimelineConfigPanel,
};

export default function registerTimeline() {
  registerChartType(timeline);
}
