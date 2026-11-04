// 144: shared route table for the dashboard write-access specs (ACCESS-V21-01..03).
import request from "supertest";
import type { Express } from "express";
import {
  db, createDashboard, createTable, addDashboardTable, createWidget, createDashboardLayer, createView, createDashboardDynamicView,
} from "../../src/db";
import { addDashboardGrant } from "../../src/lib/dashboardAccessDb";
import { PERMISSIONS } from "../../src/lib/permissions";
import { resetAiTables } from "./aiRouteKit";

export type DwFixture = { D: number; T: number; T2: number; W: number; L: number; V: number; DV: number };
export type DwRequest = { method: "post" | "patch" | "put" | "delete"; path: string; body?: Record<string, unknown> };
export type DwRoute = { key: string; okStatus: number | null; manageAccess?: boolean; kinetica?: boolean; build: (fx: DwFixture) => DwRequest };

export const DASHBOARD_WRITE_ROUTES: DwRoute[] = [
  { key: "PATCH /api/dashboards/:id", okStatus: 200, build: ({ D }) => ({ method: "patch", path: `/api/dashboards/${D}`, body: { name: "dw renamed" } }) },
  { key: "DELETE /api/dashboards/:id", okStatus: 204, build: ({ D }) => ({ method: "delete", path: `/api/dashboards/${D}` }) },
  { key: "POST /api/dashboards/:id/access", okStatus: 201, manageAccess: true, build: ({ D }) => ({ method: "post", path: `/api/dashboards/${D}/access`, body: { grantee_type: "user", grantee: "dw_new" } }) },
  { key: "DELETE /api/dashboards/:id/access", okStatus: 200, manageAccess: true, build: ({ D }) => ({ method: "delete", path: `/api/dashboards/${D}/access`, body: { grantee_type: "user", grantee: "dw_zed" } }) },
  { key: "POST /api/dashboards/:id/widgets", okStatus: 201, build: ({ D }) => ({ method: "post", path: `/api/dashboards/${D}/widgets`, body: { title: "dw w2", type: "table" } }) },
  { key: "PATCH /api/widgets/:id", okStatus: 200, build: ({ W }) => ({ method: "patch", path: `/api/widgets/${W}`, body: { title: "dw w renamed" } }) },
  { key: "DELETE /api/widgets/:id", okStatus: 204, build: ({ W }) => ({ method: "delete", path: `/api/widgets/${W}` }) },
  { key: "POST /api/dashboards/:id/tables", okStatus: 201, build: ({ D, T2 }) => ({ method: "post", path: `/api/dashboards/${D}/tables`, body: { table_id: T2 } }) },
  { key: "DELETE /api/dashboards/:dashboardId/tables/:tableId", okStatus: 204, build: ({ D, T }) => ({ method: "delete", path: `/api/dashboards/${D}/tables/${T}` }) },
  { key: "POST /api/dashboards/:id/layers", okStatus: 201, build: ({ D, T }) => ({ method: "post", path: `/api/dashboards/${D}/layers`, body: { table_id: T } }) },
  { key: "PATCH /api/dashboards/:id/layers/reorder", okStatus: 200, build: ({ D, L }) => ({ method: "patch", path: `/api/dashboards/${D}/layers/reorder`, body: { orderedIds: [L] } }) },
  { key: "PATCH /api/dashboards/:id/layers/:layerId", okStatus: 200, build: ({ D, L }) => ({ method: "patch", path: `/api/dashboards/${D}/layers/${L}`, body: { position: 5 } }) },
  { key: "DELETE /api/dashboards/:id/layers/:layerId", okStatus: 204, build: ({ D, L }) => ({ method: "delete", path: `/api/dashboards/${D}/layers/${L}` }) },
  { key: "POST /api/dashboards/:id/views", okStatus: 201, build: ({ D, T }) => ({ method: "post", path: `/api/dashboards/${D}/views`, body: { table_id: T, view_name: "dw_view_new" } }) },
  { key: "PATCH /api/views/:id", okStatus: 200, build: ({ V }) => ({ method: "patch", path: `/api/views/${V}`, body: { filter_clause: "x > 1" } }) },
  { key: "DELETE /api/views/:id", okStatus: 204, build: ({ V }) => ({ method: "delete", path: `/api/views/${V}` }) },
  { key: "POST /api/views/:id/materialize", okStatus: 200, kinetica: true, build: ({ V }) => ({ method: "post", path: `/api/views/${V}/materialize` }) },
  { key: "POST /api/dashboards/:dashboardId/dynamic-views", okStatus: 201, build: ({ D, T }) => ({ method: "post", path: `/api/dashboards/${D}/dynamic-views`, body: { source_table_id: T, name: "dw dv2", template_sql: "SELECT * FROM {view}", max_records: 0 } }) },
  { key: "PUT /api/dynamic-views/:id", okStatus: 200, build: ({ DV }) => ({ method: "put", path: `/api/dynamic-views/${DV}`, body: { name: "dw dv renamed" } }) },
  { key: "DELETE /api/dynamic-view/:id", okStatus: 200, kinetica: true, build: ({ DV }) => ({ method: "delete", path: `/api/dynamic-view/${DV}` }) },
  { key: "POST /api/dashboards/:id/ai-keep", okStatus: null, build: ({ D }) => ({ method: "post", path: `/api/dashboards/${D}/ai-keep`, body: {} }) },
  { key: "POST /api/dashboards/:id/discard-generated", okStatus: null, build: ({ D }) => ({ method: "post", path: `/api/dashboards/${D}/discard-generated` }) },
];

/** Every write permission except dashboards:manage_access. */
export const WRITE_PERMS: string[] = [
  PERMISSIONS.DASHBOARDS_EDIT, PERMISSIONS.DASHBOARDS_DELETE, PERMISSIONS.WIDGETS_CONFIGURE, PERMISSIONS.LAYERS_MANAGE, PERMISSIONS.DYNAMIC_VIEWS_MANAGE,
];

export function resetDwTables(): void {
  resetAiTables();
  resetDwContent();
}

/** Clears dashboard-scoped content only (keeps sessions, user roles and custom roles valid). */
export function resetDwContent(): void {
  for (const t of ["widgets", "dashboard_layers", "dashboard_table_views", "dashboard_dynamic_views", "rbac_audit", "dashboard_access_grants", "dashboard_tables", "tables", "dashboards"]) db.exec(`DELETE FROM ${t}`);
}

export function buildDwFixture(opts: { pendingBy?: string; grantUsers?: string[]; grantRoles?: string[] } = {}): DwFixture {
  const D = createDashboard("dw dashboard", "").id;
  const T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
  addDashboardTable(D, T);
  const T2 = createTable({ name: "zones", schema: "fleet", columns: {} }).id;
  const W = createWidget(D, { title: "dw w", type: "table" as any, position: 0, config: {} }).id;
  const L = createDashboardLayer(D, { table_id: T, config: { visible: true } as any }).id;
  const V = createView(D, T, "dw_view", "").id;
  const DV = createDashboardDynamicView(D, { source_table_id: T, name: "dw dv", template_sql: "SELECT * FROM {view}", max_records: 0 }).id;
  addDashboardGrant(D, "user", "dw_zed");
  for (const u of opts.grantUsers ?? []) addDashboardGrant(D, "user", u);
  for (const r of opts.grantRoles ?? []) addDashboardGrant(D, "role", r);
  if (opts.pendingBy) db.prepare("UPDATE dashboards SET generated_by = ?, generated_pending_at = ? WHERE id = ?").run(opts.pendingBy, Date.now(), D);
  return { D, T, T2, W, L, V, DV };
}

export function snapshotDashboard(id: number): string {
  const out: unknown[] = [db.prepare("SELECT * FROM dashboards WHERE id = ?").all(id)];
  for (const t of ["widgets", "dashboard_tables", "dashboard_table_views", "dashboard_layers", "dashboard_dynamic_views", "dashboard_access_grants"]) {
    out.push(db.prepare(`SELECT * FROM ${t} WHERE dashboard_id = ? ORDER BY rowid`).all(id));
  }
  return JSON.stringify(out);
}

export function sendDw(app: Express, cookie: string, r: DwRequest) {
  return request(app)[r.method](r.path).set("Cookie", cookie).send(r.body ?? {});
}
