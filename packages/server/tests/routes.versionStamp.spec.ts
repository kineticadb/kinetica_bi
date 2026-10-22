/**
 * routes.versionStamp.spec.ts - Phase 141 Plan 05 (AISES-V20-06, D-07/D-17).
 * VSTAMP-1..7: own-write attribution headers + list read baselines + cors exposure.
 * VSTAMP-8..10 (route classification) are appended in the second block.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createDashboard,
  createTable,
  addDashboardTable,
  createWidget,
  createDashboardLayer,
  getDashboardVersion,
} from "../src/db";
import { parseVersionWriteHeader, parseVersionReadHeader } from "@kinetica-bi/shared";

const W_HDR = "x-kbi-dashboard-version";
const R_HDR = "x-kbi-dashboard-version-read";

let cookie: string;
let D: number;
let OTHER: number;
let T: number;
let W: number;
let L: number;

beforeEach(() => {
  for (const t of ["sessions", "dashboard_layers", "widgets", "dashboard_tables", "dashboard_dynamic_views", "tables", "dashboards"]) db.exec(`DELETE FROM ${t}`);
  cookie = createAdminSession().cookie;
  D = createDashboard("vstamp D", "").id;
  OTHER = createDashboard("vstamp other", "").id;
  T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
  addDashboardTable(D, T);
  W = createWidget(D, { title: "w", type: "table" as any, position: 0, config: {} }).id;
  L = createDashboardLayer(D, { table_id: T, config: { visible: true } as any }).id;
});

const write = (res: { headers: Record<string, string> }) => parseVersionWriteHeader(res.headers[W_HDR]);
const grew = (res: { headers: Record<string, string> }) => {
  const h = write(res);
  expect(h).not.toBeNull();
  expect(h!.dashboardId).toBe(D);
  expect(h!.after).toBeGreaterThan(h!.before);
};

describe("VSTAMP write stamps", () => {
  it("VSTAMP-1 widget PATCH stamps before/after and keeps the body", async () => {
    const app = await buildTestApp();
    const v0 = getDashboardVersion(D)!;
    const res = await app.patch(`/api/widgets/${W}`).set("Cookie", cookie).send({ title: "renamed" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("renamed");
    const h = write(res)!;
    expect(h).toEqual({ dashboardId: D, before: v0, after: getDashboardVersion(D)! });
    expect(h.after).toBeGreaterThan(h.before);
  });

  it("VSTAMP-2 eye toggle stamps the layer's REAL dashboard, ignoring the path id", async () => {
    const app = await buildTestApp();
    const res = await app.patch(`/api/dashboards/${OTHER}/layers/${L}`).set("Cookie", cookie).send({ config: { visible: false } });
    expect(res.status).toBe(200);
    grew(res);
  });

  it("VSTAMP-3 the remaining sync writes each stamp D", async () => {
    const app = await buildTestApp();
    const T2 = createTable({ name: "other", schema: "fleet", columns: {} }).id;
    const L2 = createDashboardLayer(D, { table_id: T, config: {} as any }).id;
    let res = await app.post(`/api/dashboards/${D}/widgets`).set("Cookie", cookie).send({ title: "n", type: "table", config: {} });
    expect(res.status).toBe(201); grew(res);
    const newW = res.body.id;
    res = await app.delete(`/api/widgets/${newW}`).set("Cookie", cookie);
    expect(res.status).toBe(204); grew(res);
    res = await app.post(`/api/dashboards/${D}/tables`).set("Cookie", cookie).send({ table_id: T2 });
    expect(res.status).toBe(201); grew(res);
    res = await app.delete(`/api/dashboards/${D}/tables/${T2}`).set("Cookie", cookie);
    expect(res.status).toBe(204); grew(res);
    res = await app.post(`/api/dashboards/${D}/layers`).set("Cookie", cookie).send({ table_id: T });
    expect(res.status).toBe(201); grew(res);
    const newL = res.body.id;
    res = await app.patch(`/api/dashboards/${D}/layers/reorder`).set("Cookie", cookie).send({ orderedIds: [newL, L, L2] });
    expect(res.status).toBe(200); grew(res);
    res = await app.delete(`/api/dashboards/${D}/layers/${newL}`).set("Cookie", cookie);
    expect(res.status).toBe(204); grew(res);
    res = await app.patch(`/api/dashboards/${D}`).set("Cookie", cookie).send({ filter_display_mode: "panel" });
    expect(res.status).toBe(200); grew(res);
  });

  it("VSTAMP-4 a no-op write has before === after", async () => {
    const app = await buildTestApp();
    const res = await app.post(`/api/dashboards/${D}/tables`).set("Cookie", cookie).send({ table_id: T });
    expect(res.status).toBe(201);
    const h = write(res)!;
    expect(h.dashboardId).toBe(D);
    expect(h.after).toBe(h.before);
  });

  it("VSTAMP-5 404 carries no version header", async () => {
    const app = await buildTestApp();
    const res = await app.patch("/api/widgets/999999").set("Cookie", cookie).send({ title: "x" });
    expect(res.status).toBe(404);
    expect(res.headers[W_HDR]).toBeUndefined();
  });
});

describe("VSTAMP read stamps", () => {
  it("VSTAMP-6 the four list GETs stamp the list version", async () => {
    const app = await buildTestApp();
    const v = getDashboardVersion(D)!;
    for (const [path, list] of [["widgets", "widgets"], ["layers", "layers"], ["tables", "tables"], ["dynamic-views", "dynamic-views"]] as const) {
      const res = await app.get(`/api/dashboards/${D}/${path}`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(parseVersionReadHeader(res.headers[R_HDR])).toEqual({ dashboardId: D, list, version: v });
    }
  });
});

describe("VSTAMP cors", () => {
  it("VSTAMP-7 exposes exactly the two version headers", async () => {
    const app = await buildTestApp();
    const res = await app.get(`/api/dashboards/${D}/widgets`).set("Cookie", cookie).set("Origin", "http://localhost:5173");
    const exposed = String(res.headers["access-control-expose-headers"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).sort();
    expect(exposed).toEqual([W_HDR, R_HDR].sort());
  });
});

// ─── VSTAMP-8..10: every non-GET route is classified ─────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/index";

/** `METHOD /path` -> "stamped" | "exempt: <reason>". A new write route fails VSTAMP-8 until it is listed here. */
export const WRITE_ROUTE_CLASSIFICATION: Record<string, string> = {
  "DELETE /api/branding/logo": "exempt: branding is global, not dashboard state",
  "DELETE /api/dashboards/:dashboardId/tables/:tableId": "stamped",
  "DELETE /api/dashboards/:id": "exempt: dashboard removed, nothing left to version",
  "DELETE /api/dashboards/:id/access": "exempt: not dashboard state; visibility re-checked at Keep",
  "DELETE /api/dashboards/:id/layers/:layerId": "stamped",
  "DELETE /api/dynamic-view/:id": "stamped",
  "DELETE /api/exports/:id": "exempt: export job, no dashboard row written",
  "DELETE /api/filter/materialize": "exempt: drops a session filter view in Kinetica, no dashboard row written",
  "DELETE /api/roles/:id": "exempt: RBAC role, not dashboard state; visibility re-checked at Keep",
  "DELETE /api/tables/:id": "exempt: shared dataset admin; cascades bump the version and count as foreign by design",
  "DELETE /api/tables/:id/sync-history/:entryId": "exempt: shared dataset admin, not dashboard state",
  "DELETE /api/tables/:tableId/column-display-config/:columnName": "exempt: shared per-table config, D-19",
  "DELETE /api/tables/:tableId/custom-metrics/:id": "exempt: shared per-table config, D-19",
  "DELETE /api/users/:username/roles/:roleName": "exempt: RBAC assignment, not dashboard state; visibility re-checked at Keep",
  "DELETE /api/views/:id": "exempt: legacy dashboard-table filter view not part of the AI Keep dashboard load lists (widgets/layers/dynamic-views/tables)",
  "DELETE /api/widgets/:id": "stamped",
  "PATCH /api/dashboards/:id": "stamped",
  "PATCH /api/dashboards/:id/layers/:layerId": "stamped",
  "PATCH /api/dashboards/:id/layers/reorder": "stamped",
  "PATCH /api/tables/:id": "exempt: shared dataset admin; cascades bump the version and count as foreign by design",
  "PATCH /api/views/:id": "exempt: legacy dashboard-table filter view not part of the AI Keep dashboard load lists",
  "PATCH /api/widgets/:id": "stamped",
  "POST /api/ai/ask": "exempt: session/materialize only, no dashboard row written",
  "POST /api/ai/dynamic-view/drop": "exempt: session/materialize only, no dashboard row written",
  "POST /api/ai/dynamic-view/materialize": "exempt: session/materialize only, no dashboard row written",
  "POST /api/auth/login": "exempt: auth/session, not dashboard state",
  "POST /api/auth/logout": "exempt: auth/session, not dashboard state",
  "POST /api/branding/logo": "exempt: branding is global, not dashboard state",
  "POST /api/column-stats": "exempt: read-only Kinetica query over POST",
  "POST /api/dashboards": "exempt: creates a NEW dashboard",
  "POST /api/dashboards/:dashboardId/dynamic-views": "stamped",
  "POST /api/dashboards/:id/access": "exempt: not dashboard state; visibility re-checked at Keep",
  "POST /api/dashboards/:id/layers": "stamped",
  "POST /api/dashboards/:id/tables": "stamped",
  "POST /api/dashboards/:id/views": "exempt: legacy dashboard-table filter view not part of the AI Keep dashboard load lists",
  "POST /api/dashboards/:id/widgets": "stamped",
  "POST /api/dashboards/import": "exempt: creates a NEW dashboard",
  "POST /api/dynamic-view/:id/drop": "exempt: drops the materialized Kinetica view only, no dashboard row written",
  "POST /api/dynamic-view/materialize": "exempt: materialize only, no dashboard row written",
  "POST /api/dynamic-view/preview": "exempt: read-only preview query",
  "POST /api/exports": "exempt: export job, no dashboard row written",
  "POST /api/exports/:id/cancel": "exempt: export job, no dashboard row written",
  "POST /api/filter/materialize": "exempt: session filter view in Kinetica, no dashboard row written",
  "POST /api/info/query": "exempt: read-only Kinetica query over POST",
  "POST /api/quantile": "exempt: read-only Kinetica query over POST",
  "POST /api/roles": "exempt: RBAC role, not dashboard state; visibility re-checked at Keep",
  "POST /api/sql": "exempt: read-only Kinetica query over POST",
  "POST /api/tables": "exempt: shared dataset admin, registers a table without touching an existing dashboard",
  "POST /api/tables/:id/schema-apply": "exempt: shared dataset admin; cascades bump the version and count as foreign by design",
  "POST /api/tables/:tableId/custom-metrics": "exempt: shared per-table config, D-19",
  "POST /api/top-values": "exempt: read-only Kinetica query over POST",
  "POST /api/users/:username/roles": "exempt: RBAC assignment, not dashboard state; visibility re-checked at Keep",
  "POST /api/views/:id/materialize": "exempt: materialize only, no dashboard row written",
  "PUT /api/branding": "exempt: branding is global, not dashboard state",
  "PUT /api/dynamic-views/:id": "stamped",
  "PUT /api/roles/:id/permissions": "exempt: RBAC role, not dashboard state; visibility re-checked at Keep",
  "PUT /api/tables/:tableId/column-display-config/:columnName": "exempt: shared per-table config, D-19",
  "PUT /api/tables/:tableId/custom-metrics/:id": "exempt: shared per-table config, D-19",
};

const collectWriteRoutes = async (): Promise<string[]> => {
  const app = (await createApp()) as any;
  const out = new Set<string>();
  for (const layer of app._router.stack as any[]) {
    if (!layer.route) continue;
    const paths: string[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const m of Object.keys(layer.route.methods)) {
      if (["get", "head", "options"].includes(m)) continue;
      for (const p of paths) out.add(`${m.toUpperCase()} ${p}`);
    }
  }
  return [...out].sort();
};

describe("VSTAMP route classification", () => {
  it("VSTAMP-8 every non-GET route is classified (no unclassified, no stale)", async () => {
    const actual = await collectWriteRoutes();
    const known = Object.keys(WRITE_ROUTE_CLASSIFICATION).sort();
    const unclassified = actual.filter((k) => !known.includes(k));
    const stale = known.filter((k) => !actual.includes(k));
    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  it("VSTAMP-9 values are stamped or exempt-with-reason; stamped set is exactly the 13 routes", () => {
    for (const [k, v] of Object.entries(WRITE_ROUTE_CLASSIFICATION)) {
      expect(v === "stamped" || (v.startsWith("exempt: ") && v.slice(8).trim().length > 0), k).toBe(true);
    }
    const stamped = Object.entries(WRITE_ROUTE_CLASSIFICATION).filter(([, v]) => v === "stamped").map(([k]) => k).sort();
    expect(stamped).toEqual([
      "DELETE /api/dashboards/:dashboardId/tables/:tableId",
      "DELETE /api/dashboards/:id/layers/:layerId",
      "DELETE /api/dynamic-view/:id",
      "DELETE /api/widgets/:id",
      "PATCH /api/dashboards/:id",
      "PATCH /api/dashboards/:id/layers/:layerId",
      "PATCH /api/dashboards/:id/layers/reorder",
      "PATCH /api/widgets/:id",
      "POST /api/dashboards/:dashboardId/dynamic-views",
      "POST /api/dashboards/:id/layers",
      "POST /api/dashboards/:id/tables",
      "POST /api/dashboards/:id/widgets",
      "PUT /api/dynamic-views/:id",
    ]);
  });

  it("VSTAMP-10 every stamped route's registration block calls stampWrite(", () => {
    const src = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
    const regs = [...src.matchAll(/^\s*app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm)];
    for (const [k, v] of Object.entries(WRITE_ROUTE_CLASSIFICATION)) {
      if (v !== "stamped") continue;
      const [method, path] = k.split(" ");
      const i = regs.findIndex((r) => r[1].toUpperCase() === method && r[2] === path);
      expect(i, `registration for ${k}`).toBeGreaterThanOrEqual(0);
      const start = regs[i].index!;
      const end = i + 1 < regs.length ? regs[i + 1].index! : src.length;
      expect(src.slice(start, end), k).toContain("stampWrite(");
    }
  });
});
