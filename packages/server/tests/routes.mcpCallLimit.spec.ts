// Claude Desktop per-user call limit (MCP_MAX_CALLS_PER_USER_PER_HOUR). No real provider, no real Kinetica.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest, getMcpSession } from "../src/lib/mcp/mcpSessions";

const MCP_KEYS = ["MCP_ENABLED", "MCP_DATA_ACCESS", "MCP_MAX_CALLS_PER_USER_PER_HOUR"] as const;
let restoreEnv: (() => void) | null = null;
let savedMcp: Record<string, string | undefined> = {};

/** Set BEFORE createApp (read at registration; the limiter is fresh per app). */
async function boot(limit: string): Promise<Express> {
  restoreEnv?.();
  restoreEnv = enableAiEnv();
  for (const k of MCP_KEYS) if (!(k in savedMcp)) savedMcp[k] = process.env[k];
  process.env.MCP_ENABLED = "true";
  delete process.env.MCP_DATA_ACCESS;
  process.env.MCP_MAX_CALLS_PER_USER_PER_HOUR = limit;
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
  for (const k of MCP_KEYS) {
    if (savedMcp[k] === undefined) delete process.env[k];
    else process.env[k] = savedMcp[k];
  }
  savedMcp = {};
});

async function startSession(app: Express, cookie: string) {
  const t = createTable({ name: "trips", schema: "fleet", columns: {} });
  const res = await request(app).post("/api/mcp/sessions").set("Cookie", cookie).send({ name: "Trips", tableIds: [t.id] });
  return { dashboardId: res.body.dashboardId as number, tableId: t.id, res, sessionId: res.body.sessionId as string };
}
const call = (app: Express, cookie: string, sid: string, name: string, args: unknown) =>
  request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });
const finish = (app: Express, cookie: string, sid: string) =>
  request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", cookie).send({ summary: "Trips." });

describe("Claude Desktop call limit", () => {
  it("MCPLIM-1 the call over the limit gets 429 MCP_CALL_LIMIT and applies nothing", async () => {
    const app = await boot("3");
    const c = dee();
    const { res, sessionId, tableId } = await startSession(app, c);
    expect(res.status).toBe(201);
    expect((await call(app, c, sessionId, "describe_table", { tableId })).status).toBe(200);
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId))).status).toBe(200);
    const over = await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -2 }));
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("MCP_CALL_LIMIT");
    expect(over.body.error).toContain("3 calls per hour");
    expect(over.body.error).toContain("Nothing was changed");
    expect(Number.isInteger(over.body.retryAfterSeconds)).toBe(true);
    expect(over.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(over.body.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(over.headers["retry-after"]).toBe(String(over.body.retryAfterSeconds));
    expect(getMcpSession(sessionId, "dee")!.ops).toHaveLength(1);
    expect((await request(app).get("/api/mcp/tools").set("Cookie", c)).status).toBe(200);
  });

  it("MCPLIM-2 another user is unaffected", async () => {
    const app = await boot("1");
    const c = dee();
    expect((await request(app).get("/api/mcp/tables").set("Cookie", c)).status).toBe(200);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", c)).status).toBe(429);
    const eve = sessionFor("eve", ["designer"]).cookie;
    expect((await request(app).get("/api/mcp/tables").set("Cookie", eve)).status).toBe(200);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", eve).send({ name: "E", tableIds: [createTable({ name: "t2", schema: "fleet", columns: {} }).id] })).status).toBe(201);
  });

  it("MCPLIM-3 0 means no limit (regression guard)", async () => {
    const app = await boot("0");
    const c = dee();
    const { sessionId, tableId } = await startSession(app, c);
    for (let i = 0; i < 8; i++) expect((await call(app, c, sessionId, "describe_table", { tableId })).status).toBe(200);
  });

  it("MCPLIM-4 a call refused by the permission check is not counted", async () => {
    const app = await boot("2");
    const ann = sessionFor("ann", []).cookie;
    for (let i = 0; i < 3; i++) expect((await request(app).get("/api/mcp/tables").set("Cookie", ann)).status).toBe(403);
    sessionFor("ann", ["designer"]);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", ann)).status).toBe(200);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", ann)).status).toBe(200);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", ann)).status).toBe(429);
  });

  it("MCPLIM-5 finish_dashboard is exempt: it works at the limit and does not use a slot", async () => {
    // (a) at the limit
    let app = await boot("3");
    const c = dee();
    const { sessionId, tableId, dashboardId } = await startSession(app, c);
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId))).status).toBe(200);
    expect((await call(app, c, sessionId, "describe_table", { tableId })).status).toBe(200);
    expect((await call(app, c, sessionId, "describe_table", { tableId })).status).toBe(429);
    const f1 = await finish(app, c, sessionId);
    expect(f1.status).toBe(200);
    expect(f1.body.url).toBe(`http://localhost:5173/?dashboard=${dashboardId}&mcp=${sessionId}`);
    expect((await finish(app, c, sessionId)).status).toBe(200);

    // (b) finish does not use a slot (fresh app = fresh limiter)
    app = await boot("3");
    const fay = sessionFor("fay", ["designer"]).cookie;
    const s = await startSession(app, fay);
    expect((await call(app, fay, s.sessionId, "add_widget", addWidgetArgs(s.tableId))).status).toBe(200);
    expect((await finish(app, fay, s.sessionId)).status).toBe(200);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", fay)).status).toBe(200);
    expect((await request(app).get("/api/mcp/tables").set("Cookie", fay)).status).toBe(429);
  });
});
