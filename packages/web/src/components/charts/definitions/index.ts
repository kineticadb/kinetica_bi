/**
 * Import and register all chart type definitions.
 *
 * To add a new chart type:
 *   1. Create a new file in this directory (e.g. `funnel.ts`)
 *   2. Export a default `register` function that calls `registerChartType`
 *   3. Import and call it here
 */

import registerBar from "./bar";
import registerLine from "./line";
import registerPie from "./pie";
import registerScatter from "./scatter";
import registerTable from "./table";
import registerBigNumber from "./bignumber";
import registerHeatmap from "./heatmap";
import registerMap from "./map";
import registerRecords from "./records";
import registerInfoCard from "./info-card";
import registerLegend from "./legend";
import registerDataFilter from "./data-filter";
import registerTimeline from "./timeline";
import registerNumericLine from "./numericline";
import registerRadioGroup from "./radio-group";

export function registerAllChartTypes() {
  registerBar();
  registerLine();
  registerPie();
  registerScatter();
  registerTable();
  registerBigNumber();
  registerHeatmap();
  registerMap();
  registerRecords();
  registerInfoCard();
  registerLegend();         // Phase 42 Plan 02 (WIDGET-V17-01)
  registerDataFilter();     // Phase 44 Plan 02 (FILTER-V17-07): Data Filter widget
  registerTimeline();       // Phase 45 Plan 02 (TIMELINE-V17-01): Timeline Chart widget
  registerNumericLine();    // Numeric Line Chart — numeric-X, interval-binned, multi-metric
  registerRadioGroup();     // Phase 59 (RADIO-V111-01): Radio Group control widget
}
