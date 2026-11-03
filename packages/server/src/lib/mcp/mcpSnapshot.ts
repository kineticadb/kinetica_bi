// Phase 143 (AIMCP-V20-08): the AI snapshot of a SAVED dashboard, for a Claude Desktop session that edits it. The in-app
// AI gets this from the browser; Claude Desktop has no browser while it works, so the server builds the same snapshot
// with the same builder (shared buildAskSnapshot: names and ids only, never filter values or SQL). No filters: the
// connector session has none.
import { buildAskSnapshot, type AskRect, type AskRequest } from "@kinetica-bi/shared";
import { listDashboardDynamicViews, listDashboardLayers, listWidgets } from "../../db";
import { isAggregatedTemplate } from "../dvThreshold";

const rectOf = (v: unknown): AskRect | undefined => {
  const r = v as Partial<AskRect> | undefined;
  return r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number") ? (r as AskRect) : undefined;
};

export function snapshotForDashboard(dashboardId: number): AskRequest["snapshot"] {
  const widgets = listWidgets(dashboardId);
  const layouts: Record<number, AskRect> = {};
  for (const w of widgets) {
    const r = rectOf((w.config as Record<string, unknown>).layout);
    if (r) layouts[w.id] = r;
  }
  return buildAskSnapshot({
    widgets,
    layouts,
    layers: listDashboardLayers(dashboardId),
    dynamicViews: listDashboardDynamicViews(dashboardId).map((d) => ({
      id: d.id,
      name: d.name,
      baseTableId: d.source_table_id,
      aggregated: isAggregatedTemplate(d.template_sql),
      ...(d.columns_json ? { columns: d.columns_json } : {}),
    })),
  });
}
