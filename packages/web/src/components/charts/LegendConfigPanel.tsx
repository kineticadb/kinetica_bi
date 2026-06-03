/**
 * v1.7 Phase 42 Plan 02 (WIDGET-V17-03): CustomConfigPanel for the 'legend' chart type.
 *
 * Renders a single labeled <select> "Source map widget" populated from
 * props.widgets filtered to type === "map". Auto-picks the first map widget
 * on mount when sourceMapWidgetId is undefined and at least one map widget exists.
 *
 * CRITICAL: Reads `widgets` from props (Plan 42-01 ConfigPanelProps extension),
 * NOT from the dashboard context hook — WidgetConfigModal is rendered OUTSIDE
 * DashboardContextProvider, so the context hook would throw at runtime.
 */

import { useEffect } from "react";
import type { ConfigPanelProps } from "./registry";

export default function LegendConfigPanel({
  config,
  onChange,
  widgets,
}: ConfigPanelProps): JSX.Element {
  const allWidgets = widgets ?? [];
  const mapWidgets = allWidgets.filter((w) => w.type === "map");
  const sourceMapWidgetId = config.sourceMapWidgetId as number | undefined;
  const hasMapWidgets = mapWidgets.length > 0;

  // Auto-pick: when sourceMapWidgetId is undefined AND map widgets exist,
  // pre-select the first one via onChange. Dep array uses a primitive string
  // (joined map widget IDs) to avoid referential-equality re-fires.
  const mapWidgetIdsKey = mapWidgets.map((w) => w.id).join(",");
  useEffect(() => {
    if (sourceMapWidgetId === undefined && mapWidgets.length > 0) {
      onChange({ ...config, sourceMapWidgetId: mapWidgets[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapWidgetIdsKey]);

  return (
    <div
      className="config-group"
      role="group"
      aria-labelledby="legend-source-label"
    >
      <label id="legend-source-label" className="config-group-label">
        SOURCE MAP WIDGET
      </label>
      <select
        className="ds-select"
        aria-label="Source map widget"
        disabled={!hasMapWidgets}
        value={String(sourceMapWidgetId ?? "")}
        onChange={(e) =>
          onChange({ ...config, sourceMapWidgetId: Number(e.target.value) })
        }
      >
        {!hasMapWidgets && (
          <option value="">— no map widgets on this dashboard —</option>
        )}
        {hasMapWidgets && sourceMapWidgetId === undefined && (
          <option value="">— select —</option>
        )}
        {mapWidgets.map((w) => (
          <option key={w.id} value={String(w.id)}>
            {w.title || `Map widget #${w.id}`}
          </option>
        ))}
      </select>
      {!hasMapWidgets && (
        <div className="config-hint">
          Add a map widget first, then bind the legend.
        </div>
      )}
    </div>
  );
}
