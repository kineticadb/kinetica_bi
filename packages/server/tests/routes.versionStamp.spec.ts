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
