// kbi-mcp spike: /api/mcp/* (tools, sessions, call, finish, handoff). No AI provider is ever called.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createWidget } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { MCP_TOOL_NAMES } from "../src/mcpRoutes";

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
  db.exec("DELETE FROM widgets;");
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

async function startSession(app: Express, cookie: string) {
  const d = makeDashboard();
  const t = makeTableOn(d.id);
  const res = await request(app).post("/api/mcp/sessions").set("Cookie", cookie).send({ dashboardId: d.id });
  return { dashboardId: d.id, tableId: t.id, res, sessionId: res.body.sessionId as string };
}
const call = (app: Express, cookie: string, sid: string, name: string, args: unknown) =>
  request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });

describe("/api/mcp (kbi-mcp spike)", () => {
  it("MCP-1 the routes do not exist unless MCP_ENABLED=true", async () => {
    const app = await boot(false);
    const res = await request(app).get("/api/mcp/tools").set("Cookie", dee());
    expect(res.status).toBe(404);
  });

  it("MCP-2 tools lists exactly the spike's tools, with JSON schemas", async () => {
    const app = await boot();
    const res = await request(app).get("/api/mcp/tools").set("Cookie", dee());
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: { name: string }) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of res.body.tools) expect(t.jsonSchema).toMatchObject({ type: "object" });
  });

  it("MCP-3 a session needs an empty dashboard the caller can see", async () => {
    const app = await boot();
    const c = dee();
    const { res } = await startSession(app, c);
    expect(res.status).toBe(201);
    expect(typeof res.body.sessionId).toBe("string");
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ dashboardId: 999999 })).status).toBe(404);
    const used = makeDashboard();
    createWidget(used.id, { title: "x", type: "bar", config: {} } as never);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ dashboardId: used.id })).status).toBe(409);
  });

  it("MCP-4 add_widget through the gateway, finish, then the browser takes the ops exactly once", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    const ok = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    expect(ok.body).toMatchObject({ ok: true });
    expect(ok.body.text).toMatch(/^OK: /);
    const fin = await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({ summary: "Trips by zone." });
    expect(fin.status).toBe(200);
    expect(fin.body.url).toBe(`http://localhost:5173/?dashboard=${dashboardId}&mcp=${sessionId}`);
    // someone else cannot take it
    const other = await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", sessionFor("eve", ["designer"]).cookie);
    expect(other.status).toBe(404);
    const h = await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", c);
    expect(h.status).toBe(200);
    expect(h.body.answer).toBe("Trips by zone.");
    expect(h.body.ops).toHaveLength(1);
    expect(h.body.ops[0]).toMatchObject({ op: "add_widget", type: "bar", tempId: -1 });
    expect(h.body.ops[0].layout).toBeDefined(); // the gateway placed it
    expect((await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", c)).status).toBe(404);
  });

  it("MCP-5 a rejected call returns the stage and reasons so the client can repair it", async () => {
    const app = await boot();
    const c = dee();
    const { tableId, sessionId } = await startSession(app, c);
    const bad = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { aggregation: undefined }));
    expect(bad.body.ok).toBe(false);
    expect(bad.body.reasons).toContain("missing required field aggregation");
    const nocol = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { metric: "nope" }));
    expect(nocol.body.ok).toBe(false);
  });

  it("MCP-6 read tools answer from the live schema; unknown tools and other users' sessions are refused", async () => {
    const app = await boot();
    const c = dee();
    const { tableId, sessionId } = await startSession(app, c);
    const d = await call(app, c, sessionId, "describe_table", { tableId });
    expect(d.body.ok).toBe(true);
    expect(d.body.text).toContain("fare");
    expect((await call(app, c, sessionId, "run_query", { sql: "SELECT 1" })).status).toBe(400);
    expect((await call(app, sessionFor("eve", ["designer"]).cookie, sessionId, "describe_table", { tableId })).status).toBe(404);
  });

  it("MCP-7 finish with nothing added is refused; a finished session takes no more calls", async () => {
    const app = await boot();
    const c = dee();
    const { tableId, sessionId } = await startSession(app, c);
    expect((await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({})).status).toBe(400);
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({});
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -2 }))).status).toBe(409);
  });
});
