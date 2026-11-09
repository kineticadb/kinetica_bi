// 146-02: browser logout spares a Claude Desktop build (generated_source 'mcp'); in-app generated dashboards still go.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, getDashboard } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { createGeneratedDashboard, discardGeneratedDashboard, runGeneratedTtlSweepOnce, sweepGeneratedOnBoot } from "../src/lib/aiGenerate";

let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;

async function boot(): Promise<Express> {
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
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
const sourceOf = (id: number) => (db.prepare("SELECT generated_source AS s FROM dashboards WHERE id = ?").get(id) as { s: string | null }).s;

describe("browser logout vs Claude Desktop builds", () => {
  it("MCPLO-1 a Claude Desktop build is marked as one; an in-app generated dashboard is not", async () => {
    const app = await boot();
    const { dashboardId, tableId } = await startSession(app, dee());
    expect(sourceOf(dashboardId)).toBe("mcp");
    await discardGeneratedDashboard(dashboardId);
    const g = createGeneratedDashboard({ username: "dee", name: "Gen", tableId });
    expect(sourceOf(g.id)).toBeNull();
    const cols = (db.prepare("PRAGMA table_info(dashboards)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("generated_source");
  });

  it("MCPLO-2 browser logout leaves the Claude Desktop build and Claude finishes it", async () => {
    const app = await boot();
    const browser = sessionFor("dee", ["designer"]);
    const connector = sessionFor("dee", ["designer"]);
    const { dashboardId, tableId, sessionId } = await startSession(app, connector.cookie);
    expect((await request(app).post("/api/auth/logout").set("Cookie", browser.cookie)).status).toBe(204);
    expect(getDashboard(dashboardId)?.generated_pending).toBe(true);
    const add = await request(app).post(`/api/mcp/sessions/${sessionId}/call`).set("Cookie", connector.cookie).send({ name: "add_widget", args: addWidgetArgs(tableId) });
    expect(add.body.ok).toBe(true);
    const fin = await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", connector.cookie).send({ summary: "Done." });
    expect(fin.status).toBe(200);
    expect(fin.body.url).toContain(`dashboard=${dashboardId}`);
    const h = await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", dee());
    expect(h.status).toBe(200);
    expect(h.body.ops).toHaveLength(1);
  });

  it("MCPLO-3 browser logout still discards the same user's in-app generated dashboard", async () => {
    const app = await boot();
    const t = createTable({ name: "trips", schema: "fleet", columns: {} });
    const g = createGeneratedDashboard({ username: "dee", name: "Gen", tableId: t.id });
    expect((await request(app).post("/api/auth/logout").set("Cookie", dee())).status).toBe(204);
    expect(getDashboard(g.id)).toBeUndefined();
  });

  it("MCPLO-4 Discard and the sweeps still delete a Claude Desktop build", async () => {
    const app = await boot();
    const c = dee();
    const a = await startSession(app, c);
    await runGeneratedTtlSweepOnce(Date.now() + 25 * 3_600_000, {}, {});
    expect(getDashboard(a.dashboardId)).toBeUndefined();
    const b = await startSession(app, c);
    expect(b.res.status).toBe(201);
    await sweepGeneratedOnBoot();
    expect(getDashboard(b.dashboardId)).toBeUndefined();
    const d = await startSession(app, c);
    expect(d.res.status).toBe(201);
    expect((await request(app).post(`/api/dashboards/${d.dashboardId}/discard-generated`).set("Cookie", c)).status).toBe(204);
    expect(getDashboard(d.dashboardId)).toBeUndefined();
  });
});
