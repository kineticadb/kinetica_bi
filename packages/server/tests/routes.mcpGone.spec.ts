// Claude Desktop connector: a build whose dashboard no longer exists answers 410 with no review link and no ok audit row.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, deleteDashboard, createTable, createDashboard, addDashboardTable, createWidget, getDashboard, listDashboardTables, listWidgets } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs, makeRole } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { createMcpToken } from "../src/lib/mcp/mcpTokens";
import { MCP_DASHBOARD_GONE_MESSAGE } from "../src/mcpRoutes";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { FIT_KPI_H, placeFitBands } from "@kinetica-bi/shared";

let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;

async function boot(mcp = true): Promise<Express> {
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  if (mcp) process.env.MCP_ENABLED = "true";
  else delete process.env.MCP_ENABLED;
  return createApp();
}
const dee = () => sessionFor("dee", ["designer"]).cookie;

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM mcp_tokens; DELETE FROM mcp_token_sessions;");
  __clearLiveSchemaCacheForTest();
  __resetMcpSessionsForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
  if (savedMcp === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedMcp;
});

async function startSession(app: Express, cookie: string, over: Record<string, unknown> = {}) {
  const t = createTable({ name: "trips", schema: "fleet", columns: {} });
  const res = await request(app).post("/api/mcp/sessions").set("Cookie", cookie).send({ name: "Trips", tableIds: [t.id], ...over });
  return { dashboardId: res.body.dashboardId as number, tableId: t.id, res, sessionId: res.body.sessionId as string };
}
const call = (app: Express, cookie: string, sid: string, name: string, args: unknown) =>
  request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });

const finish = (app: Express, c: string, sid: string) => request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({ summary: "done" });
const okRows = () => (db.prepare("SELECT COUNT(*) AS n FROM ai_audit WHERE kind = 'mcp' AND outcome = 'ok'").get() as { n: number }).n;
const expectGone = (r: request.Response) => {
  expect(r.status).toBe(410);
  expect(r.body).toEqual({ code: "MCP_DASHBOARD_GONE", error: MCP_DASHBOARD_GONE_MESSAGE });
  expect(r.body.url).toBeUndefined();
};

describe("Claude Desktop gone builds", () => {
  it("MCPGONE-1 finish on a discarded build says it no longer exists, with no link and no ok audit row", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId))).body.ok).toBe(true);
    expect((await request(app).post(`/api/dashboards/${dashboardId}/discard-generated`).set("Cookie", c)).status).toBe(204);
    expectGone(await finish(app, c, sessionId));
    expect(okRows()).toBe(0);
  });

  it("MCPGONE-2 finish on an edit session whose saved dashboard was deleted says the same", async () => {
    const app = await boot();
    const c = dee();
    const d = createDashboard("Ops", "");
    addDashboardGrant(d.id, "role", "designer");
    const T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
    addDashboardTable(d.id, T);
    const open = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ dashboardId: d.id });
    const sid = open.body.sessionId as string;
    expect((await call(app, c, sid, "add_widget", addWidgetArgs(T))).body.ok).toBe(true);
    deleteDashboard(d.id);
    expectGone(await finish(app, c, sid));
    expect(okRows()).toBe(0);
  });

  it("MCPGONE-3 a tool call on a gone build gets the same 410", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await request(app).post(`/api/dashboards/${dashboardId}/discard-generated`).set("Cookie", c);
    expectGone(await call(app, c, sessionId, "describe_table", { tableId }));
  });

  it("MCPGONE-4 a build that still exists finishes as before", async () => {
    const app = await boot();
    const c = dee();
    const { tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    const r = await finish(app, c, sessionId);
    expect(r.status).toBe(200);
    expect(typeof r.body.url).toBe("string");
  });
});
