// 146-03: a Claude Desktop build that ends without finish (discard, TTL, boot sweep) gets exactly one 'unfinished' AI activity row.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, getDashboard } from "../src/db";
import * as aiAudit from "../src/lib/aiAudit";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest, findMcpBuildSession } from "../src/lib/mcp/mcpSessions";
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
const call = (app: Express, cookie: string, sid: string, name: string, args: unknown) =>
  request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });
const finish = (app: Express, c: string, sid: string) => request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({ summary: "done" });
const discard = (app: Express, c: string, id: number) => request(app).post(`/api/dashboards/${id}/discard-generated`).set("Cookie", c);
const mcpRows = (id: number) => db.prepare("SELECT * FROM ai_audit WHERE kind = 'mcp' AND dashboard_id = ?").all(id) as Record<string, unknown>[];
const CANARY = "kbi-canary-7f3a91";

describe("unfinished Claude Desktop builds", () => {
  it("MCPUNF-1 discard of an unfinished build writes one unfinished row", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId))).body.ok).toBe(true);
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -2, metric: "nope" }))).body.ok).toBe(false);
    expect((await discard(app, c, dashboardId)).status).toBe(204);
    const rows = mcpRows(dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mcp", status: "final", outcome: "unfinished", outcome_detail: "discarded", counted: 0, provider: "claude-desktop", steps: 2, question: 'Started "Trips" in Claude Desktop (not finished)' });
    expect(JSON.parse(String(rows[0].tools_json))).toHaveLength(2);
  });

  it("MCPUNF-2 TTL expiry writes one row marked expired", async () => {
    const app = await boot();
    const { dashboardId } = await startSession(app, dee());
    await runGeneratedTtlSweepOnce(Date.now() + 25 * 3_600_000, {}, {});
    const rows = mcpRows(dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "unfinished", outcome_detail: "expired" });
  });

  it("MCPUNF-3 the boot sweep after a restart writes one row marked server_restart", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    __resetMcpSessionsForTest();
    await sweepGeneratedOnBoot();
    const rows = mcpRows(dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "unfinished", outcome_detail: "server_restart", tools_json: "[]", steps: 0 });
  });

  it("MCPUNF-4 a finished build gets no second row when it is later discarded", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    expect((await finish(app, c, sessionId)).status).toBe(200);
    await discard(app, c, dashboardId);
    const rows = mcpRows(dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("ok");
  });

  it("MCPUNF-5 discard, finish and sweep never double the row", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await discard(app, c, dashboardId);
    expect((await finish(app, c, sessionId)).status).toBe(410);
    await sweepGeneratedOnBoot();
    await runGeneratedTtlSweepOnce(Date.now() + 25 * 3_600_000, {}, {});
    expect(mcpRows(dashboardId)).toHaveLength(1);
  });

  it("MCPUNF-6 starting over with replace marks the replaced build unfinished", async () => {
    const app = await boot();
    const c = dee();
    const first = await startSession(app, c);
    const second = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "Trips", tableIds: [first.tableId], replace: true });
    expect(second.status).toBeLessThan(300);
    const rows = mcpRows(first.dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "unfinished", outcome_detail: "discarded" });
    expect(mcpRows(second.body.dashboardId as number)).toHaveLength(0);
  });

  it("MCPUNF-7 an in-app generated dashboard writes no Claude Desktop row", async () => {
    await boot();
    const T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
    const g = createGeneratedDashboard({ username: "dee", name: "Gen", tableId: T });
    await discardGeneratedDashboard(g.id);
    const g2 = createGeneratedDashboard({ username: "dee", name: "Gen2", tableId: T });
    await runGeneratedTtlSweepOnce(Date.now() + 25 * 3_600_000, {}, {});
    expect(getDashboard(g2.id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM ai_audit WHERE kind = 'mcp'").get()).toEqual({ n: 0 });
  });

  it("MCPUNF-8 the unfinished row holds no refused-call canary", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    const bad = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -2, title: CANARY, metric: "nope" }));
    expect(bad.body.ok).toBe(false);
    await discard(app, c, dashboardId);
    const rows = mcpRows(dashboardId);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(CANARY);
  });

  it("MCPUNF-9 odd session data never blocks the discard", async () => {
    const app = await boot();
    const c = dee();
    const one = await startSession(app, c);
    const s = findMcpBuildSession(one.dashboardId)!;
    expect(s).toBeTruthy();
    s.tools.push({ name: "x", result: "ok", args: { n: 1n } });
    (s as { applied: unknown }).applied = undefined;
    expect((await discard(app, c, one.dashboardId)).status).toBe(204);
    expect(getDashboard(one.dashboardId)).toBeUndefined();
    const rows = mcpRows(one.dashboardId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("unfinished");

    const two = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "Trips2", tableIds: [one.tableId] });
    const id2 = two.body.dashboardId as number;
    vi.spyOn(aiAudit, "recordMcpUnfinished").mockImplementation(() => { throw new Error("boom"); });
    expect((await discard(app, c, id2)).status).toBe(204);
    expect(getDashboard(id2)).toBeUndefined();
  });
});
