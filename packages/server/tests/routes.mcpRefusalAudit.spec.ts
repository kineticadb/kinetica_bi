// Claude Desktop connector: refused calls are audited with tool, stage and reasons, never the arguments the client sent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, createDashboard, addDashboardTable, createWidget, getDashboard, listDashboardTables, listWidgets } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs, makeRole } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { createMcpToken } from "../src/lib/mcp/mcpTokens";
import { MCP_MAX_NEW_WIDGETS, MCP_TOOL_NAMES } from "../src/mcpRoutes";
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

const CANARY = "kbi-canary-7f3a91";
type Tool = { name: string; result: string; stage?: string; reasons?: string[]; args?: unknown };
const auditRow = (dashboardId: number) => {
  const rows = db.prepare("SELECT * FROM ai_audit WHERE dashboard_id = ?").all(dashboardId) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  return { row: rows[0], tools: JSON.parse(String(rows[0].tools_json)) as Tool[] };
};
const finish = (app: Express, c: string, sid: string) => request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({ summary: "done" });

describe("Claude Desktop refusal audit", () => {
  it("MCPREF-1 a refused call is audited with tool, stage and reasons, never the canary argument", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "describe_table", { tableId: CANARY });
    const bad = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -2, title: CANARY, metric: "nope" }));
    expect(bad.body.ok).toBe(false);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await finish(app, c, sessionId);
    const { row, tools } = auditRow(dashboardId);
    expect(JSON.stringify(row)).not.toContain(CANARY);
    const rejected = tools.filter((t) => t.result === "rejected");
    expect(rejected.map((t) => t.name)).toEqual(["describe_table", "add_widget"]);
    for (const t of rejected) {
      expect(t.stage).toBeTruthy();
      expect(t.reasons?.length).toBeGreaterThan(0);
      expect("args" in t).toBe(false);
    }
    expect(rejected[0].stage).toBe("shape");
    expect(rejected[1].stage).toBe(bad.body.stage);
  });

  it("MCPREF-2 a refusal at the new-widget cap stores no arguments", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    for (let i = 1; i <= MCP_MAX_NEW_WIDGETS; i++) {
      expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -i }))).body.ok).toBe(true);
    }
    const over = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -50, title: CANARY }));
    expect(over.body).toMatchObject({ ok: false, stage: "cap" });
    await finish(app, c, sessionId);
    const { row, tools } = auditRow(dashboardId);
    expect(JSON.stringify(row)).not.toContain(CANARY);
    const cap = tools.find((t) => t.stage === "cap")!;
    expect(cap).toBeTruthy();
    expect("args" in cap).toBe(false);
  });

  it("MCPREF-3 a remove refused for missing confirmation stores no arguments", async () => {
    const app = await boot();
    const c = dee();
    const d = createDashboard("Ops", "");
    addDashboardGrant(d.id, "role", "designer");
    const T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
    addDashboardTable(d.id, T);
    const W = createWidget(d.id, { title: "Fares", type: "bar", position: 0, config: { tableId: T, metricColumn: "fare", aggregation: "SUM", groupByColumn: "zone", layout: { x: 0, y: 0, w: 12, h: 20 } } } as never).id;
    const open = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ dashboardId: d.id });
    const sid = open.body.sessionId as string;
    expect((await call(app, c, sid, "remove_widget", { id: W })).body).toMatchObject({ ok: false, stage: "clarification" });
    expect((await call(app, c, sid, "rename_widget", { id: W, title: "Fares by zone" })).body.ok).toBe(true);
    await finish(app, c, sid);
    const { tools } = auditRow(d.id);
    const refused = tools.find((t) => t.name === "remove_widget")!;
    expect(refused.stage).toBe("clarification");
    expect(refused.reasons?.join(" ")).toMatch(/confirmed: true/);
    expect("args" in refused).toBe(false);
  });

  it("MCPREF-4 accepted calls still record their arguments", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await finish(app, c, sessionId);
    const ok = auditRow(dashboardId).tools.find((t) => t.result === "ok")!;
    expect("args" in ok).toBe(true);
  });
});
