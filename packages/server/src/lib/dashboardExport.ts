/**
 * Phase 119 Plan 02 — the export envelope assembler and download-filename helper.
 *
 * `buildDashboardExport(dashboardId)` assembles a single dashboard, its widgets, layers,
 * dynamic views, the UNION of associated + walk-derived tables, and only the custom metrics
 * actually referenced by a widget, into one versioned JSON envelope
 * (`schemaVersion: EXPORT_SCHEMA_VERSION`). It re-embeds every row VERBATIM — original ids and
 * timestamps travel unchanged; renumbering is Phase 120's job, not this one's. It reuses the
 * pure walk from Plan 01 (`dashboardExportRefs.ts`) rather than re-deriving references, and it
 * records (but does not block on) any reference that points at an id absent from this dashboard
 * — `danglingReferences` is informational provenance for the operator/importer, not a gate.
 *
 * Three tables are deliberately absent from the payload, by construction (never imported, never
 * read) rather than by after-the-fact filtering. Their accessors are not imported into this file
 * at all — see 119-RESEARCH.md / 119-CONTEXT.md for the full names:
 *   - the runtime materialized-view bookkeeping table — tied to a specific Kinetica cluster +
 *     TTL; meaningless outside this deployment.
 *   - the access-grant table — operator-excluded (DXIM-V124-08); who-can-view is a local
 *     access-control decision, not export data.
 *   - the per-table column-display/formatting table — operator-locked shared state, not
 *     per-dashboard, so it does not belong to a single dashboard's export.
 */
import type {
  CustomMetricRow,
  Dashboard,
  DashboardDynamicView,
  DashboardLayer,
  Table,
  Widget,
} from "../types";
import {
  getCustomMetric,
  getDashboard,
  getTable,
  listDashboardDynamicViews,
  listDashboardLayers,
  listDashboardTables,
  listWidgets,
} from "../db";
import {
  collectDynamicViewRefs,
  collectLayerRefs,
  collectWidgetConfigRefs,
  mergeExportRefs,
  type ExportRefs,
  type RefKind,
} from "./dashboardExportRefs";

export const EXPORT_SCHEMA_VERSION = 1;

/** A reference that points at an id absent from this dashboard's own entity sets. Informational only. */
export type DanglingReference = { from: string; kind: RefKind; id: number };

export type DashboardExportFile = {
  schemaVersion: number;
  exportedAt: string;
  dashboard: Dashboard;
  widgets: Widget[];
  layers: DashboardLayer[];
  dynamicViews: DashboardDynamicView[];
  tables: Table[];
  customMetrics: CustomMetricRow[];
  /** Only the ids associated via `dashboard_tables` — the subset `tables` cannot itself express. */
  dashboardTableIds: number[];
  danglingReferences: DanglingReference[];
};

export const buildDashboardExport = (dashboardId: number): DashboardExportFile | undefined => {
  const dashboard = getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const widgets = listWidgets(dashboardId);
  const layers = listDashboardLayers(dashboardId);
  const dynamicViews = listDashboardDynamicViews(dashboardId);
  const associated = listDashboardTables(dashboardId);

  const widgetIdSet = new Set(widgets.map((w) => w.id));
  const layerIdSet = new Set(layers.map((l) => l.id));
  const dvIdSet = new Set(dynamicViews.map((d) => d.id));

  const parts: ExportRefs[] = [];
  const danglingReferences: DanglingReference[] = [];

  const absorb = (from: string, refs: ExportRefs) => {
    parts.push(refs);
    for (const id of refs.widgetIds) if (!widgetIdSet.has(id)) danglingReferences.push({ from, kind: "widget", id });
    for (const id of refs.layerIds) if (!layerIdSet.has(id)) danglingReferences.push({ from, kind: "layer", id });
    for (const id of refs.dynamicViewIds)
      if (!dvIdSet.has(id)) danglingReferences.push({ from, kind: "dynamicView", id });
    for (const id of refs.tableIds) if (!getTable(id)) danglingReferences.push({ from, kind: "table", id });
    for (const id of refs.customMetricIds)
      if (!getCustomMetric(id)) danglingReferences.push({ from, kind: "customMetric", id });
  };

  for (const w of widgets) absorb(`widget:${w.id}`, collectWidgetConfigRefs(w.config));
  for (const l of layers) absorb(`layer:${l.id}`, collectLayerRefs(l));
  for (const d of dynamicViews) absorb(`dynamicView:${d.id}`, collectDynamicViewRefs(d));
  const refs = mergeExportRefs(...parts);

  // The UNION: a table can be dashboard_tables-associated with zero widget/layer/dv reference
  // (POST /api/dashboards/:id/layers does not validate table_id against dashboard_tables), so
  // either edge alone would drop rows the operator actually staged.
  const associatedIds = associated.map((t) => t.id);
  const tableIds = [...new Set([...associatedIds, ...refs.tableIds])].sort((a, b) => a - b);
  const tables = tableIds.map(getTable).filter((t): t is Table => t !== undefined);
  const dashboardTableIds = [...associatedIds].sort((a, b) => a - b);

  // Referenced-only metrics: NOT the full per-table metric listing accessor — that would drag in
  // every sibling metric on every exported table, which is exactly what EXCL-metric forbids.
  const customMetrics = refs.customMetricIds
    .map(getCustomMetric)
    .filter((m): m is CustomMetricRow => m !== undefined);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    dashboard,
    widgets,
    layers,
    dynamicViews,
    tables,
    customMetrics,
    dashboardTableIds,
    danglingReferences,
  };
};

/**
 * Slugifies via an ALLOW-list (`[a-z0-9]+` -> `-`), never a denylist, which is what guarantees
 * the returned string can only ever contain `[a-z0-9-.]` — so a dashboard name can never inject
 * a `"`, CR or LF into the `Content-Disposition` header the route (Task 2) builds from it.
 */
export const exportFileName = (dashboard: Pick<Dashboard, "id" | "name">): string => {
  const slug = String(dashboard.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `dashboard-${dashboard.id}-${slug || "export"}.json`;
};
