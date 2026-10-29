// kbi-mcp spike: /api/mcp/* (tools, sessions, call, finish, handoff). No AI provider is ever called.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, createDashboard, addDashboardTable, createWidget, getDashboard, listDashboardTables, listWidgets } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica, addWidgetArgs, makeRole } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { MCP_TOOL_NAMES } from "../src/mcpRoutes";
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

  it("MCP-3 start creates an unkept dashboard only its creator sees, with the tables and no widgets", async () => {
    const app = await boot();
    const c = dee();
    const { res, dashboardId, tableId } = await startSession(app, c);
    expect(res.status).toBe(201);
    expect(typeof res.body.sessionId).toBe("string");
    expect(getDashboard(dashboardId)).toMatchObject({ name: "Trips", generated_pending: true });
    expect(listDashboardTables(dashboardId).map((t) => t.id)).toEqual([tableId]);
    expect(listWidgets(dashboardId)).toEqual([]); // no AI Assistant widget, unlike Generate
    expect((await request(app).get("/api/dashboards").set("Cookie", sessionFor("eve", ["designer"]).cookie)).body.data?.map((d: { id: number }) => d.id) ?? []).not.toContain(dashboardId);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "x", tableIds: [999999] })).status).toBe(404);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "", tableIds: [tableId] })).status).toBe(400);
  });

  it("MCP-3b one unkept build at a time: a second start names the first, replace discards it", async () => {
    const app = await boot();
    const c = dee();
    const first = await startSession(app, c);
    const again = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "Second", tableIds: [first.tableId] });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "AI_GENERATE_PENDING", dashboard: { id: first.dashboardId, name: "Trips" } });
    const replaced = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ name: "Second", tableIds: [first.tableId], replace: true });
    expect(replaced.status).toBe(201);
    expect(getDashboard(first.dashboardId)).toBeUndefined();
    expect(getDashboard(replaced.body.dashboardId)).toMatchObject({ name: "Second", generated_pending: true });
  });

  it("MCP-3c Discard on a Claude build deletes the dashboard", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId } = await startSession(app, c);
    expect((await request(app).post(`/api/dashboards/${dashboardId}/discard-generated`).set("Cookie", c)).status).toBe(204);
    expect(getDashboard(dashboardId)).toBeUndefined();
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

  it("MCP-8 finish lays the whole dashboard out to fit one screen (compact KPIs, charts side by side)", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    const kpi = (tempId: number) => addWidgetArgs(tableId, { tempId, type: "bignumber", title: `K${tempId}`, groupBy: undefined });
    for (const args of [addWidgetArgs(tableId, { tempId: -1 }), kpi(-2), addWidgetArgs(tableId, { tempId: -3, type: "pie" }), kpi(-4)]) {
      expect((await call(app, c, sessionId, "add_widget", args)).body).toMatchObject({ ok: true });
    }
    await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({});
    const h = await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", c);
    const ops = h.body.ops as { tempId: number; type: string; layout: unknown }[];
    const want = placeFitBands(ops.map((o) => ({ key: o.tempId, type: o.type })));
    expect(ops).toHaveLength(4);
    for (const o of ops) expect(o.layout).toEqual(want[o.tempId]);
    expect(ops.find((o) => o.tempId === -2)?.layout).toEqual({ x: 0, y: 0, w: 18, h: FIT_KPI_H });
  });

  it("MCP-9 a text widget needs no table, refuses one, and leads the finished layout", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    const text = { tempId: -1, type: "text", title: "Summary", markdown: "## Tips\n- Cash trips tip **more** on average" };
    expect((await call(app, c, sessionId, "add_widget", { ...text, tableId })).body).toMatchObject({ ok: false });
    expect((await call(app, c, sessionId, "add_widget", text)).body).toMatchObject({ ok: true });
    expect((await call(app, c, sessionId, "add_widget", { tempId: -2, type: "text", title: "Empty", markdown: "" })).body).toMatchObject({ ok: false });
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { tempId: -3 }))).body).toMatchObject({ ok: true });
    await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({});
    const ops = (await request(app).get(`/api/mcp/sessions/${sessionId}/handoff?dashboardId=${dashboardId}`).set("Cookie", c)).body.ops as { tempId: number; config: Record<string, unknown>; layout: { x: number; y: number; w: number } }[];
    const t = ops.find((o) => o.tempId === -1)!;
    expect(t.config).toEqual({ markdown: "## Tips\n- Cash trips tip **more** on average" });
    expect(t.layout).toMatchObject({ x: 0, y: 0, w: 36 });
    expect(ops.find((o) => o.tempId === -3)!.layout.y).toBeGreaterThan(0);
  });

  it("MCP-10 a personal access token signs the connector in; revoking it signs it out", async () => {
    const app = await boot();
    const c = dee();
    const made = await request(app).post("/api/mcp/tokens").set("Cookie", c).send({ name: "Claude Desktop" });
    expect(made.status).toBe(201);
    expect(made.body.token).toMatch(/^kbi_/);
    const list = await request(app).get("/api/mcp/tokens").set("Cookie", c);
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(made.body.token);

    const login = await request(app).post("/api/mcp/token-login").send({ token: made.body.token });
    expect(login.body).toEqual({ user: { username: "dee" } });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe("dee");
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    expect((await request(app).get("/api/mcp/tools").set("Cookie", cookie)).status).toBe(200);

    expect((await request(app).post("/api/mcp/token-login").send({ token: made.body.token + "x" })).status).toBe(401);
    expect((await request(app).delete(`/api/mcp/tokens/${made.body.id}`).set("Cookie", sessionFor("eve", ["designer"]).cookie)).status).toBe(404);
    expect((await request(app).delete(`/api/mcp/tokens/${made.body.id}`).set("Cookie", c)).status).toBe(204);
    expect((await request(app).post("/api/mcp/token-login").send({ token: made.body.token })).status).toBe(401);
    expect((await request(app).get("/api/mcp/tools").set("Cookie", cookie)).status).toBe(401);
  });

  it("MCP-11 tokens need the Use AI permission and password sign-in", async () => {
    const app = await boot();
    expect((await request(app).post("/api/mcp/tokens").set("Cookie", sessionFor("vic", ["analyst"]).cookie).send({ name: "x" })).status).toBe(403);
    expect((await request(app).post("/api/mcp/tokens").set("Cookie", dee()).send({ name: "" })).status).toBe(400);
  });

  it("MCP-12 finish writes one Claude Desktop audit row with the tool calls and changes, not counted against AI caps", async () => {
    const app = await boot();
    const c = dee();
    const { dashboardId, tableId, sessionId } = await startSession(app, c);
    await call(app, c, sessionId, "describe_table", { tableId });
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId, { aggregation: undefined }));
    await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId));
    await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({ summary: "Trips by zone." });
    await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({}); // idempotent: still one row
    const rows = db.prepare("SELECT * FROM ai_audit WHERE dashboard_id = ?").all(dashboardId) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({ kind: "mcp", status: "final", outcome: "ok", counted: 0, provider: "claude-desktop", answer_text: "Trips by zone.", steps: 3 });
    expect(String(r.question)).toBe('Built "Trips" in Claude Desktop');
    const tools = JSON.parse(String(r.tools_json)) as { name: string; result: string; stage?: string }[];
    expect(tools.map((t) => [t.name, t.result])).toEqual([["describe_table", "ok"], ["add_widget", "rejected"], ["add_widget", "ok"]]);
    const changes = JSON.parse(String(r.changes_json)) as { applied: string[]; rejected: { stage: string; reasons: string[] }[] };
    expect(changes.applied).toHaveLength(1);
    // finish re-lays out everything, so a first-fit position in the label would be wrong
    expect(changes.applied[0]).toBe('Added bar "Trips by zone"');
    expect(changes.rejected[0].reasons).toContain("missing required field aggregation");
    const list = await request(app).get("/api/ai/audit").set("Cookie", sessionFor("ada", ["admin"]).cookie);
    expect(list.body.rows?.find((x: { id: number }) => x.id === r.id)).toMatchObject({ kind: "mcp" });
  });

  it("MCP-13 with the in-app AI off, the connector still builds (schema-only access) and finishes", async () => {
    restoreEnv = enableAiEnv();
    delete process.env.AI_ENABLED;
    savedMcp = process.env.MCP_ENABLED;
    process.env.MCP_ENABLED = "true";
    const app = await createApp();
    const c = dee();
    const { res, tableId, sessionId } = await startSession(app, c);
    expect(res.status).toBe(201);
    expect((await call(app, c, sessionId, "describe_table", { tableId })).body).toMatchObject({ ok: true });
    expect((await call(app, c, sessionId, "add_widget", addWidgetArgs(tableId))).body).toMatchObject({ ok: true });
    expect((await request(app).post(`/api/mcp/sessions/${sessionId}/finish`).set("Cookie", c).send({})).status).toBe(200);
    const row = db.prepare("SELECT data_access FROM ai_audit WHERE kind = 'mcp'").get() as { data_access: string };
    expect(row.data_access).toBe("schema");
  });

  it("MCP-14 Claude opens a saved dashboard, reads it, edits and (with confirmation) removes saved widgets, and the layout is kept", async () => {
    const app = await boot();
    const c = dee();
    const d = createDashboard("Ops", "");
    addDashboardGrant(d.id, "role", "designer");
    const T = createTable({ name: "trips", schema: "fleet", columns: {} }).id;
    addDashboardTable(d.id, T);
    const W1 = createWidget(d.id, { title: "Fares", type: "bar", position: 0, config: { tableId: T, metricColumn: "fare", aggregation: "SUM", groupByColumn: "zone", layout: { x: 0, y: 0, w: 12, h: 20 } } } as never).id;
    const W2 = createWidget(d.id, { title: "Old", type: "bar", position: 1, config: { tableId: T, metricColumn: "fare", aggregation: "SUM", groupByColumn: "zone", layout: { x: 12, y: 0, w: 12, h: 20 } } } as never).id;

    const open = await request(app).post("/api/mcp/sessions").set("Cookie", c).send({ dashboardId: d.id });
    expect(open.status).toBe(201);
    const sid = open.body.sessionId as string;
    const view = await call(app, c, sid, "get_dashboard", {});
    expect(view.body.text).toContain('"Fares"');
    expect((await call(app, c, sid, "rename_widget", { id: W1, title: "Fares by zone" })).body).toMatchObject({ ok: true });
    const blocked = await call(app, c, sid, "remove_widget", { id: W2 });
    expect(blocked.body).toMatchObject({ ok: false, stage: "clarification" });
    expect(blocked.body.reasons.join(" ")).toMatch(/confirmed/);
    expect((await call(app, c, sid, "remove_widget", { id: W2, confirmed: true })).body).toMatchObject({ ok: true });
    expect((await call(app, c, sid, "add_widget", addWidgetArgs(T, { tempId: -1 }))).body).toMatchObject({ ok: true });

    await request(app).post(`/api/mcp/sessions/${sid}/finish`).set("Cookie", c).send({ summary: "Renamed and tidied." });
    const h = await request(app).get(`/api/mcp/sessions/${sid}/handoff?dashboardId=${d.id}`).set("Cookie", c);
    expect(h.body.mode).toBe("edit");
    const add = (h.body.ops as { op: string; layout?: { x: number; y: number; w: number; h: number } }[]).find((o) => o.op === "add_widget")!;
    // placed first-fit into free space, not re-laid out over the saved widgets
    expect(add.layout).toMatchObject({ x: 12, y: 0 });
    const audit = db.prepare("SELECT question FROM ai_audit WHERE kind = 'mcp' AND dashboard_id = ?").get(d.id) as { question: string };
    expect(audit.question).toBe('Changed "Ops" in Claude Desktop');
  });

  it("MCP-15 opening needs edit rights and view access; other users' unkept builds stay hidden", async () => {
    const app = await boot();
    const d = createDashboard("Private", "");
    addDashboardGrant(d.id, "role", "admin");
    // no manage_access bypass (designer has it): this user can edit dashboards but cannot see this one
    const editor = makeRole("mcp-editor", ["ai:use", "dashboards:view", "dashboards:edit", "dashboards:create"]);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", sessionFor("rex", [editor]).cookie).send({ dashboardId: d.id })).status).toBe(404);
    addDashboardGrant(d.id, "role", "analyst");
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", sessionFor("ana", ["analyst"]).cookie).send({ dashboardId: d.id })).status).toBe(403);
    const eve = sessionFor("eve", ["designer"]).cookie;
    const theirs = await startSession(app, eve);
    expect((await request(app).post("/api/mcp/sessions").set("Cookie", dee()).send({ dashboardId: theirs.dashboardId })).status).toBe(404);
  });
});
