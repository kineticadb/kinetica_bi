/**
 * Phase 128 EXPRT-V126-05 — pure SQL layer for the export job.
 *
 * Trust model (dynamic-view-preview style): NO client-sent SQL. The table ref
 * comes from the DB row (tables.schema/name) or the deterministic dv view name;
 * filters pass through the escaping builders (buildServerWhereClause /
 * composeWhereClause) and every user-supplied identifier is IDENT_RE-validated.
 * customWhere is PERSISTED widget config, trusted per VIZSQL, and executed
 * under the exporting user's own Kinetica credentials.
 *
 * Runtime widget-action overrides (useWidgetActionStore.widgetOverrides) are
 * NOT applied: operator answer Q-D in 128-SPIKE-NOTES.md = "Phase 131
 * follow-up". Columns = cfg.columns in order (IDENT_RE-filtered), or all
 * columns in schema order when none are configured (operator answer Q-C).
 *
 * Pure module: no I/O.
 */
import { buildServerWhereClause, type ActiveFilter } from "./whereClause";
import { composeWhereClause, type SpatialFilter, type SpatialTarget } from "./spatialWhereClause";
import { buildDynamicViewName } from "./dynamicViewName";
import type { Widget } from "../types";

export const EXPORT_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/; // same as WidgetRenderer.tsx:1909

export type ExportPagingMechanism = "paging_table" | "offset";
/** Approved at the Phase 128 spike checkpoint — see 128-SPIKE-NOTES.md "## Decision". */
export const EXPORT_PAGING_MECHANISM: ExportPagingMechanism = "offset";

export type ExportSpec = {
  widgetId: number;
  sortField?: string | null;
  sortDir?: "asc" | "desc";
  filters?: ActiveFilter[];
  spatialFilters?: SpatialFilter[];
  spatialTarget?: SpatialTarget | null;
};

export type ExportSpecErrorCode =
  | "widget_not_found"
  | "not_records_table"
  | "invalid_source"
  | "invalid_column"
  | "invalid_sort"
  | "invalid_filter"
  | "unsupported_filter";

export class ExportSpecError extends Error {
  constructor(
    public readonly code: ExportSpecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExportSpecError";
  }
}

export type ExportPlan = {
  jobId: string;
  mechanism: ExportPagingMechanism;
  dashboardId: number;
  widgetId: number;
  source: string;
  snapshotView: string;
  pagingTable: string | null;
  snapshotBody: string;
  countSql: string;
  columns: string[];
  sortField: string | null;
  sortDir: "ASC" | "DESC";
};

export type BuildExportPlanInput = {
  spec: ExportSpec;
  widget: Widget | undefined;
  username: string;
  jobId: string;
  getTable: (id: number) => { name: string; schema: string } | undefined;
  getDashboardDynamicView: (id: number) => { dashboard_id: number } | undefined;
  mechanism?: ExportPagingMechanism;
};

export function buildExportPlan(input: BuildExportPlanInput): ExportPlan {
  const { spec, widget, username, jobId, getTable, getDashboardDynamicView } = input;
  const mechanism = input.mechanism ?? EXPORT_PAGING_MECHANISM;
  if (!widget) throw new ExportSpecError("widget_not_found", "Widget not found");
  if (widget.type !== "records") {
    throw new ExportSpecError("not_records_table", "Only records-table widgets can be exported");
  }
  const cfg = (widget.config ?? {}) as Record<string, unknown>;
  const filters = spec.filters ?? [];
  const spatialFilters = spec.spatialFilters ?? [];
  const spatialTarget = spec.spatialTarget ?? null;

  for (const f of filters) {
    if (typeof f.column !== "string" || !EXPORT_IDENT_RE.test(f.column)) {
      throw new ExportSpecError("invalid_column", `Invalid filter column: ${String(f.column)}`);
    }
  }

  let source: string;
  let filterWhere: string;
  if (typeof cfg.dynamicViewId === "number") {
    const dv = getDashboardDynamicView(cfg.dynamicViewId);
    if (!dv || dv.dashboard_id !== widget.dashboard_id) {
      throw new ExportSpecError("invalid_source", "Dynamic view does not belong to this dashboard");
    }
    if (spatialFilters.length > 0 || spatialTarget) {
      throw new ExportSpecError("unsupported_filter", "Spatial filters are not supported on dynamic views");
    }
    filterWhere = buildServerWhereClause(filters);
    source = buildDynamicViewName({
      userId: username,
      dashboardId: widget.dashboard_id,
      dynamicViewId: cfg.dynamicViewId,
    });
  } else {
    const tableId = typeof cfg.tableId === "number" ? cfg.tableId : undefined;
    const row = tableId !== undefined ? getTable(tableId) : undefined;
    if (row) {
      source = row.schema ? `${row.schema}.${row.name}` : row.name;
    } else if (typeof cfg.table === "string" && EXPORT_IDENT_RE.test(cfg.table)) {
      source = cfg.table;
    } else {
      throw new ExportSpecError("invalid_source", "Widget has no resolvable source table");
    }
    if ((spatialFilters.length > 0) !== (spatialTarget !== null)) {
      throw new ExportSpecError("invalid_filter", "spatialFilters and spatialTarget must be provided together");
    }
    if (spatialTarget) {
      if (spatialTarget.tableId !== tableId) {
        throw new ExportSpecError("invalid_filter", "spatialTarget.tableId does not match the widget table");
      }
      if (spatialTarget.spatialMode === "wkb") {
        throw new ExportSpecError("unsupported_filter", "WKB spatial mode is not supported");
      }
      for (const c of [spatialTarget.lonCol, spatialTarget.latCol, spatialTarget.spatialCol]) {
        if (c !== undefined && (typeof c !== "string" || !EXPORT_IDENT_RE.test(c))) {
          throw new ExportSpecError("invalid_column", `Invalid spatial column: ${String(c)}`);
        }
      }
    }
    filterWhere = composeWhereClause(filters, spatialFilters, spatialTarget);
  }

  const cw = String(cfg.customWhere ?? "").trim();
  const parts: string[] = [];
  if (filterWhere !== "1=1") parts.push(`(${filterWhere})`);
  if (cw) parts.push(`(${cw})`);
  const snapshotBody = `SELECT * FROM ${source}` + (parts.length ? ` WHERE ${parts.join(" AND ")}` : "");

  const columns = String(cfg.columns ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((c) => EXPORT_IDENT_RE.test(c));

  let sortField: string | null = null;
  let sortDir: "ASC" | "DESC" = "ASC";
  if (typeof spec.sortField === "string" && spec.sortField !== "") {
    if (!EXPORT_IDENT_RE.test(spec.sortField)) {
      throw new ExportSpecError("invalid_sort", "Invalid sort field");
    }
    if (spec.sortDir !== undefined && spec.sortDir !== "asc" && spec.sortDir !== "desc") {
      throw new ExportSpecError("invalid_sort", "Invalid sort direction");
    }
    sortField = spec.sortField;
    sortDir = spec.sortDir === "desc" ? "DESC" : "ASC";
  } else if (typeof cfg.sortField === "string" && EXPORT_IDENT_RE.test(cfg.sortField)) {
    sortField = cfg.sortField;
    sortDir = String(cfg.sortDirection ?? "").toLowerCase() === "desc" ? "DESC" : "ASC";
  }

  const id8 = jobId.replace(/-/g, "").slice(0, 8).toLowerCase();
  const snapshotView = `_kbi_exp_${id8}`;
  return {
    jobId,
    mechanism,
    dashboardId: widget.dashboard_id,
    widgetId: widget.id,
    source,
    snapshotView,
    pagingTable: mechanism === "paging_table" ? `${snapshotView}_pg` : null,
    snapshotBody,
    countSql: `SELECT COUNT(*) AS total FROM ${snapshotView}`,
    columns,
    sortField,
    sortDir,
  };
}
