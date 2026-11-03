// Single overlay -> concrete widget merge, shared by WidgetRenderer (what the user sees) and
// buildKeepPayload (what Keep saves). Extracted verbatim from WidgetRenderer's effectiveWidget memo.
import type { WidgetDto, TableDto } from "../api/client";
import { translateWidgetOverlay, overlayTouchesChartSql } from "./widgetOverlayKeys";
import { deriveChartConfig } from "./chartSql";
import { resolveMetricExpr } from "./customMetricSql";

export type WidgetOverlayDeps = { tables: readonly TableDto[]; maxBarGroupBySeriesCap: number };

export function mergeWidgetOverlay(
  widget: WidgetDto,
  overlay: Record<string, unknown> | null | undefined,
  deps: WidgetOverlayDeps,
): WidgetDto {
  if (!overlay) return widget;
  const { tables, maxBarGroupBySeriesCap } = deps;
  const translated = translateWidgetOverlay(widget.type, overlay);
  const merged: Record<string, unknown> = { ...(widget.config ?? {}), ...translated };
  if (
    ["bar", "line", "pie", "table", "bignumber"].includes(widget.type) &&
    merged.dynamicViewId === undefined &&
    overlayTouchesChartSql(translated)
  ) {
    const t = tables.find((x) => x.id === merged.tableId);
    const tableName = t ? `${t.schema}.${t.name}` : typeof merged.table === "string" ? merged.table : "";
    const d = deriveChartConfig(widget.type, merged, {
      tableName,
      tableColumns: t?.columns ?? {},
      maxBarGroupBySeriesCap,
      // deriveChartConfig does not pass tableId; custom metrics resolve against the widget's tableId.
      resolveMetricExpr: (id, fb) => resolveMetricExpr(id, fb, merged.tableId as number | undefined),
    });
    if (d) Object.assign(merged, d);
  }
  return { ...widget, config: merged };
}
