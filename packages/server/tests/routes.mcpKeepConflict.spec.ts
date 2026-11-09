// 145 (MCPSAFE-V21-01/02): Keep of a Claude Desktop edit vs saves made while Claude was working.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, createDashboard, addDashboardTable, createWidget, createDashboardLayer, getDashboard, getDashboardVersion, listWidgets } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { KEEP_CONFLICT_MESSAGE, AI_KEEP_ERROR_CODES } from "@kinetica-bi/shared";

let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;
let app: Express;
let D: number;
let T: number;
let W1: number;
let L1: number;
const W1_CONFIG = (): Record<string, unknown> => ({ tableId: T, metricColumn: "fare", aggregation: "SUM", groupByColumn: "zone", layout: { x: 0, y: 0, w: 12, h: 20 } });

const dee = () => sessionFor("dee", ["designer"]).cookie;
const eve = () => sessionFor("eve", ["designer"]).cookie;
const call = (sid: string, cookie: string, name: string, args: unknown) => request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });
const open = async (cookie: string) => (await request(app).post("/api/mcp/sessions").set("Cookie", cookie).send({ dashboardId: D })).body.sessionId as string;
const finishAndHandOff = async (sid: string, cookie: string, dashboardId = D) => {
  expect((await call(sid, cookie, "rename_widget", { id: W1, title: "Fares by zone" })).body).toMatchObject({ ok: true });
  expect((await request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", cookie).send({ summary: "Renamed." })).status).toBe(200);
  return request(app).get(`/api/mcp/sessions/${sid}/handoff?dashboardId=${dashboardId}`).set("Cookie", cookie);
};
const renameKeep = (v: number) => ({
  baselineVersion: v,
  dynamicViews: { add: [], remove: [] },
  layers: { add: [], edit: [], remove: [] },
  widgets: { add: [], edit: [{ id: W1, title: "Fares by zone" }], remove: [] },
});
const keep = (cookie: string, id: number, body: unknown) => request(app).post(`/api/dashboards/${id}/ai-keep`).set("Cookie", cookie).send(body as object);
const rows = () => JSON.stringify([db.prepare("SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY id").all(D), db.prepare("SELECT * FROM dashboard_layers WHERE dashboard_id = ? ORDER BY id").all(D)]);
const title = () => listWidgets(D).find((w) => w.id === W1)!.title;

beforeEach(async () => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM mcp_tokens; DELETE FROM mcp_token_sessions; DELETE FROM dashboard_layers");
  __clearLiveSchemaCacheForTest();
  __resetMcpSessionsForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
  app = await createApp();
  const d = createDashboard("Ops", "");
  D = d.id;
  addDashboardGrant(D, "role", "designer");
  T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
  addDashboardTable(D, T);
  W1 = createWidget(D, { title: "Fares", type: "bar", position: 0, config: W1_CONFIG() } as never).id;
  L1 = createDashboardLayer(D, { table_id: T, config: { visible: true } as never }).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
  if (savedMcp === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedMcp;
});

describe("Claude Desktop Keep conflict check", () => {
  it("MKC-1 a foreign save after open_dashboard blocks the Claude Desktop Keep with the in-app conflict message", async () => {
    const c = dee();
    const v0 = getDashboardVersion(D)!;
    const sid = await open(c);
    expect((await request(app).patch(`/api/widgets/${W1}`).set("Cookie", eve()).send({ title: "Eve's title" })).status).toBe(200);
    const h = await finishAndHandOff(sid, c);
    expect(h.body.baselineVersion).toBe(v0);
    const before = rows();
    const r = await keep(c, D, renameKeep(h.body.baselineVersion));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: KEEP_CONFLICT_MESSAGE, code: AI_KEEP_ERROR_CODES.conflict });
    expect(rows()).toBe(before);
    expect(title()).toBe("Eve's title");
    const audit = db.prepare("SELECT outcome FROM ai_audit WHERE outcome = 'keep_conflict'").all();
    expect(audit).toHaveLength(1);
  });

  it("MKC-2 own layout saves and eye toggles in between are not conflicts", async () => {
    const c = dee();
    const sid = await open(c);
    const lay = await request(app).patch(`/api/widgets/${W1}`).set("Cookie", c).send({ config: { ...W1_CONFIG(), layout: { x: 0, y: 0, w: 10, h: 20 } } });
    expect(lay.status).toBe(200);
    const eye = await request(app).patch(`/api/dashboards/${D}/layers/${L1}`).set("Cookie", c).send({ config: { visible: false } });
    expect(eye.status).toBe(200);
    const h = await finishAndHandOff(sid, c);
    expect(h.body.baselineVersion).toBe(getDashboardVersion(D));
    const r = await keep(c, D, renameKeep(h.body.baselineVersion));
    expect(r.status).toBe(200);
    expect(title()).toBe("Fares by zone");
  });

  it("MKC-3 own, then foreign, then own: the baseline stops before the foreign save", async () => {
    const c = dee();
    const v0 = getDashboardVersion(D)!;
    const sid = await open(c);
    expect((await request(app).patch(`/api/widgets/${W1}`).set("Cookie", c).send({ config: { ...W1_CONFIG(), layout: { x: 0, y: 0, w: 10, h: 20 } } })).status).toBe(200);
    const afterOwn = getDashboardVersion(D)!;
    expect(afterOwn).toBeGreaterThan(v0);
    expect((await request(app).patch(`/api/widgets/${W1}`).set("Cookie", eve()).send({ title: "Eve's title" })).status).toBe(200);
    expect((await request(app).patch(`/api/dashboards/${D}/layers/${L1}`).set("Cookie", c).send({ config: { visible: false } })).status).toBe(200);
    const h = await finishAndHandOff(sid, c);
    expect(h.body.baselineVersion).toBe(afterOwn);
    const before = rows();
    const r = await keep(c, D, renameKeep(h.body.baselineVersion));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(KEEP_CONFLICT_MESSAGE);
    expect(rows()).toBe(before);
  });

  it("MKC-4 a new Claude Desktop build hands over the current version and keeps as before", async () => {
    const c = dee();
    const start = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "Build", tableIds: [T] });
    expect(start.status).toBe(201);
    const sid = start.body.sessionId as string;
    const nd = start.body.dashboardId as number;
    expect((await call(sid, c, "add_widget", addWidgetArgs(T))).body).toMatchObject({ ok: true });
    await request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({ summary: "Built." });
    const h = await request(app).get(`/api/mcp/sessions/${sid}/handoff?dashboardId=${nd}`).set("Cookie", c);
    expect(h.body.baselineVersion).toBe(getDashboardVersion(nd));
    const r = await keep(c, nd, {
      baselineVersion: h.body.baselineVersion,
      dynamicViews: { add: [], remove: [] },
      layers: { add: [], edit: [], remove: [] },
      widgets: { add: [{ tempId: -1, type: "bar", title: "Built bar", config: { tableId: T }, rect: { x: 0, y: 0, w: 12, h: 10 } }], edit: [], remove: [] },
    });
    expect(r.status).toBe(200);
    expect(getDashboard(nd)!.generated_pending).toBe(false);
  });
});
