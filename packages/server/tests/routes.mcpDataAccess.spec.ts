// Claude Desktop data access (MCP_DATA_ACCESS), independent of AI_DATA_ACCESS. No real provider, no real Kinetica.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, addWidgetArgs } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { getAiConfig } from "../src/lib/aiConfig";
import { MCP_TOOL_NAMES } from "../src/mcpRoutes";

const kbody = (result: unknown) => ({
  status: "OK", message: "", data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }),
});
const adminBody = (d: unknown) => ({ status: "OK", message: "", data_str: JSON.stringify(d) });

type Rec = { statement: string; auth: string | null };
let userStmts: Rec[] = [];
function installMock() {
  userStmts = [];
  forbidProviderNetwork((async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (u.endsWith("/admin/show/jobs")) return new Response(JSON.stringify(adminBody({ job_id: [], query_text: [] })), { status: 200 });
    if (u.endsWith("/admin/alter/jobs")) return new Response(JSON.stringify(adminBody({})), { status: 200 });
    const stmt = String(body.statement ?? "");
    if (/LIMIT 0/i.test(stmt)) return new Response(JSON.stringify(kbody({ column_headers: ["zone", "fare"], column_1: [], column_2: [] })), { status: 200 });
    userStmts.push({ statement: stmt, auth: new Headers(init?.headers).get("Authorization") });
    return new Response(JSON.stringify(kbody({ column_headers: ["zone", "fare"], column_1: ["CANARY_ROW_7731"], column_2: [12.5], total_number_of_records: 1 })), { status: 200 });
  }) as typeof fetch);
}

const MCP_KEYS = ["MCP_ENABLED", "MCP_DATA_ACCESS", "MCP_MAX_CALLS_PER_USER_PER_HOUR"] as const;
let restoreEnv: (() => void) | null = null;
let savedMcp: Record<string, string | undefined> = {};

/** aiOn=false deletes AI_ENABLED. mcpAccess undefined = key unset. Set BEFORE createApp (read at registration). */
async function boot(o: { ai?: string; aiOn?: boolean; mcpAccess?: string }): Promise<Express> {
  restoreEnv = enableAiEnv(o.ai !== undefined ? { AI_DATA_ACCESS: o.ai } : {});
  if (o.aiOn === false) delete process.env.AI_ENABLED;
  for (const k of MCP_KEYS) savedMcp[k] = process.env[k];
  process.env.MCP_ENABLED = "true";
  delete process.env.MCP_MAX_CALLS_PER_USER_PER_HOUR;
  if (o.mcpAccess === undefined) delete process.env.MCP_DATA_ACCESS;
  else process.env.MCP_DATA_ACCESS = o.mcpAccess;
  return createApp();
}
const dee = () => sessionFor("dee", ["designer"]).cookie;

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM mcp_tokens; DELETE FROM mcp_token_sessions;");
  __clearLiveSchemaCacheForTest();
  __resetMcpSessionsForTest();
  installMock();
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
  return { tableId: t.id, sessionId: res.body.sessionId as string };
}
const call = (app: Express, cookie: string, sid: string, name: string, args: unknown) =>
  request(app).post(`/api/mcp/sessions/${sid}/call`).set("Cookie", cookie).send({ name, args });
const toolNames = async (app: Express, c: string) =>
  ((await request(app).get("/api/mcp/tools").set("Cookie", c)).body.tools as { name: string }[]).map((t) => t.name).sort();
async function auditAfterFinish(app: Express, c: string, sid: string, tableId: number): Promise<string> {
  expect((await call(app, c, sid, "add_widget", addWidgetArgs(tableId))).body).toMatchObject({ ok: true });
  expect((await request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({})).status).toBe(200);
  return (db.prepare("SELECT data_access FROM ai_audit WHERE kind = 'mcp'").get() as { data_access: string }).data_access;
}
const RUN = { sql: "SELECT zone, fare FROM fleet.trips" };

describe("Claude Desktop data access (MCP_DATA_ACCESS)", () => {
  for (const [id, mcpAccess] of [["MCPDA-1", undefined], ["MCPDA-2", "schema"]] as const) {
    it(`${id} AI_DATA_ACCESS=query, MCP_DATA_ACCESS ${mcpAccess ?? "unset"}: no query tools, no row values, audited as schema`, async () => {
      const app = await boot({ ai: "query", mcpAccess });
      const gc = getAiConfig();
      expect(gc.enabled && gc.config.dataAccess).toBe("query");
      const c = dee();
      expect(await toolNames(app, c)).toEqual([...MCP_TOOL_NAMES].sort());
      const { sessionId, tableId } = await startSession(app, c);
      expect((await call(app, c, sessionId, "run_query", RUN)).status).toBe(400);
      expect((await call(app, c, sessionId, "get_column_profile", { tableId, column: "zone" })).status).toBe(400);
      const d = await call(app, c, sessionId, "describe_table", { tableId });
      expect(JSON.stringify(d.body)).not.toContain("CANARY_ROW_7731");
      expect(userStmts).toHaveLength(0);
      expect(await auditAfterFinish(app, c, sessionId, tableId)).toBe("schema");
    });
  }

  it("MCPDA-3 MCP_DATA_ACCESS=query: run_query returns rows run as the signed-in user", async () => {
    const app = await boot({ ai: "schema", mcpAccess: "query" });
    const c = dee();
    const names = await toolNames(app, c);
    expect(names).toEqual(expect.arrayContaining(["run_query", "get_column_profile"]));
    const { sessionId, tableId } = await startSession(app, c);
    const r = await call(app, c, sessionId, "run_query", RUN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
    expect(r.body.text).toContain("CANARY_ROW_7731");
    expect(userStmts[0].auth).toBe(`Basic ${Buffer.from("dee:pw").toString("base64")}`);
    expect(await auditAfterFinish(app, c, sessionId, tableId)).toBe("query");
  });

  it("MCPDA-4 MCP_DATA_ACCESS=query works with the in-app AI off", async () => {
    const app = await boot({ aiOn: false, mcpAccess: "query" });
    const c = dee();
    const { sessionId } = await startSession(app, c);
    const r = await call(app, c, sessionId, "run_query", RUN);
    expect(r.body).toMatchObject({ ok: true });
    expect(r.body.text).toContain("CANARY_ROW_7731");
  });

  it("MCPDA-5 query mode keeps the SQL guard", async () => {
    const app = await boot({ mcpAccess: "query" });
    const c = dee();
    const { sessionId } = await startSession(app, c);
    for (const sql of ["DELETE FROM fleet.trips", "SELECT * FROM other.secret"]) {
      const r = await call(app, c, sessionId, "run_query", { sql });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(false);
    }
    expect(userStmts).toHaveLength(0);
  });

  it("MCPDA-6 an invalid MCP_DATA_ACCESS boots schema-only and warns with the value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = await boot({ ai: "query", mcpAccess: "qurey" });
    expect(warn.mock.calls.some((a) => String(a[0]).includes('MCP_DATA_ACCESS="qurey"'))).toBe(true);
    const c = dee();
    expect(await toolNames(app, c)).not.toContain("run_query");
    const { sessionId } = await startSession(app, c);
    expect((await call(app, c, sessionId, "run_query", RUN)).status).toBe(400);
  });
});
