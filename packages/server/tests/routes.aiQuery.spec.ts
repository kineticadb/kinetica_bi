// Phase 140-09: query mode (AI_DATA_ACCESS=query) through the real POST /api/ai/ask route. RQ-1..RQ-9.
// No real provider, no real Kinetica: a fetch mock records every statement + admin call.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db, createDashboardDynamicView } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, RecordingProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __setAiHeartbeatMsForTest, __setAiGraceMsForTest } from "../src/aiRoutes";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { registerAiSessionView } from "../src/lib/aiSessionViews";
import { GUARD_REASONS } from "../src/lib/ai/sqlGuard";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import {
  enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText,
  customProvider, pollUntil,
} from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

const kbody = (result: unknown) => ({
  status: "OK", message: "", data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }),
});
const adminBody = (d: unknown) => ({ status: "OK", message: "", data_str: JSON.stringify(d) });

type Rec = { statement: string; limit: unknown; auth: string | null };
type Mock = {
  userStmts: Rec[];
  show: number;
  alter: any[];
  /** answer for a non-probe statement; default 2 rows */
  answer: (rec: Rec, init: RequestInit | undefined) => Promise<Response> | Response;
  jobs: () => { job_id: number[]; query_text: string[] };
  fetch: typeof fetch;
};
function makeMock(): Mock {
  const m: Mock = {
    userStmts: [], show: 0, alter: [],
    answer: () => new Response(JSON.stringify(kbody({ column_headers: ["vendor_id", "n"], column_1: ["V1", "V2"], column_2: [3, 4], total_number_of_records: 2 })), { status: 200 }),
    jobs: () => ({ job_id: [], query_text: [] }),
    fetch: undefined as unknown as typeof fetch,
  };
  m.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (u.endsWith("/admin/show/jobs")) { m.show++; return new Response(JSON.stringify(adminBody(m.jobs())), { status: 200 }); }
    if (u.endsWith("/admin/alter/jobs")) { m.alter.push(body); return new Response(JSON.stringify(adminBody({})), { status: 200 }); }
    const stmt = String(body.statement ?? "");
    if (/LIMIT 0/i.test(stmt)) return new Response(JSON.stringify(kbody({ column_headers: ["vendor_id", "n"], column_1: [], column_2: [] })), { status: 200 });
    const rec: Rec = { statement: stmt, limit: body.limit, auth: new Headers(init?.headers).get("Authorization") };
    m.userStmts.push(rec);
    return m.answer(rec, init);
  }) as typeof fetch;
  return m;
}
/** hangs until the request signal aborts, then rejects like fetch does */
const hang = (_rec: Rec, init: RequestInit | undefined): Promise<Response> =>
  new Promise((_res, rej) => {
    const sig = init?.signal;
    const abort = () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (sig?.aborted) abort(); else sig?.addEventListener("abort", abort);
  });

let mock: Mock;
async function boot(env: Record<string, string> = {}) {
  restoreEnv = enableAiEnv({ AI_MAX_TOOL_STEPS: "20", ...env });
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const trips = makeTableOn(dash.id, "demo", "trips");
  const user = sessionFor("dee", ["designer"]);
  const ask = (over: Record<string, unknown> = {}, signal?: AbortSignal) =>
    realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, over)), signal });
  return { dash, trips, user, ask };
}

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM ai_session_views");
  db.exec("DELETE FROM dashboard_dynamic_views");
  __clearLiveSchemaCacheForTest();
  mock = makeMock();
  forbidProviderNetwork(mock.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  __setAiHeartbeatMsForTest(null);
  __setAiGraceMsForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

function record(steps: ScriptStep[]): RecordingProvider {
  const rec = new RecordingProvider(new ScriptedProvider(steps));
  __setAiProviderFactoryForTest(() => rec as any);
  return rec;
}
const SQL1 = "SELECT vendor_id, COUNT(*) AS n FROM demo.trips GROUP BY vendor_id";
const runQ = (sql: string, id = "1") => [toolCall(id, "run_query", { sql }), TOOLS_DONE];
const auditRow = () => db.prepare("SELECT * FROM ai_audit ORDER BY id DESC LIMIT 1").get() as any;
const toolMsgs = (rec: RecordingProvider, req = 1) => rec.requests[req].messages.filter((m) => m.role === "tool").map((m: any) => m.content as string);
const everything = (rec: RecordingProvider) => JSON.stringify(rec.requests.map((r) => ({ s: r.system, m: r.messages, t: r.tools })));
const resultOf = (evs: { event: string; data: any }[]) => evs.find((e) => e.event === "result")?.data;

describe("AI query mode through POST /api/ai/ask", () => {
  it("RQ-1 single SELECT runs as the signed-in user with limit max+1 and a tag; result + audit carry the query list", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query" });
    const rec = record([runQ(SQL1), finalText("done")]);
    const evs = await readSse(await ask());
    const reqId = auditRow().request_id as string;
    expect(mock.userStmts).toHaveLength(1);
    expect(mock.userStmts[0].statement).toBe(`/* kbi-ai:${reqId}-q01 */ ${SQL1}`);
    expect(mock.userStmts[0].limit).toBe(201);
    expect(mock.userStmts[0].auth).toBe(`Basic ${Buffer.from("dee:pw").toString("base64")}`);
    const env = JSON.parse(toolMsgs(rec)[0].slice(toolMsgs(rec)[0].indexOf("{")));
    expect(env).toMatchObject({ kind: "query_result", untrusted: true, rows: [["V1", 3], ["V2", 4]] });
    const names = rec.requests[0].tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["run_query", "get_column_profile"]));
    expect(rec.requests[0].system).toContain("YOUR OWN reading");
    expect(resultOf(evs).queries).toEqual([{ sql: SQL1, rowCount: 2, outcome: "ok" }]);
    const q = JSON.parse(auditRow().queries_json);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ outcome: "ok", rowCount: 2 });
    expect(typeof q[0].durationMs).toBe("number");
    expect(JSON.stringify(auditRow())).not.toContain("V1");
  });

  it("RQ-2 a refused statement never reaches Kinetica but is visible in the list", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query" });
    const rec = record([runQ("DELETE FROM demo.trips"), finalText("done")]);
    const evs = await readSse(await ask());
    expect(mock.userStmts).toHaveLength(0);
    expect(toolMsgs(rec)[0]).toBe("Refused: only a single SELECT (or WITH ... SELECT) is allowed");
    expect(resultOf(evs).queries).toEqual([{ sql: "DELETE FROM demo.trips", outcome: "refused", reason: GUARD_REASONS.notSelect }]);
  });

  it("RQ-3 schema mode (default): tools unknown, no queries key, queries_json NULL", async () => {
    const { ask } = await boot();
    const rec = record([runQ(SQL1), finalText("done")]);
    const evs = await readSse(await ask());
    expect(mock.userStmts).toHaveLength(0);
    expect(toolMsgs(rec)[0]).toBe("Unknown tool run_query.");
    for (const r of rec.requests) expect(r.tools.map((t) => t.name)).not.toEqual(expect.arrayContaining(["run_query"]));
    for (const r of rec.requests) expect(r.tools.map((t) => t.name)).not.toContain("get_column_profile");
    expect("queries" in resultOf(evs)).toBe(false);
    expect(auditRow().queries_json).toBeNull();
  });

  it("RQ-4 saved dynamic view by alias; physical name reaches Kinetica, never the provider", async () => {
    const { ask, dash, trips } = await boot({ AI_DATA_ACCESS: "query" });
    const dv = createDashboardDynamicView(dash.id, { source_table_id: trips.id, name: "Big trips", template_sql: "SELECT * FROM demo.trips", max_records: 100, columns_json: [{ name: "vendor_id", type: "string" }] });
    const rec = record([runQ(`SELECT * FROM dv_${dv.id}`), finalText("done")]);
    await readSse(await ask());
    expect(mock.userStmts).toHaveLength(1);
    expect(mock.userStmts[0].statement).toContain(buildDynamicViewName({ userId: "dee", dashboardId: dash.id, dynamicViewId: dv.id }));
    expect(everything(rec)).not.toContain("_kbi_dv_");
    expect(rec.requests[0].system).toContain(`dv_${dv.id}`);
  });

  it("RQ-5 AI session view by alias; another session's view is not in scope", async () => {
    const { ask, dash, user } = await boot({ AI_DATA_ACCESS: "query" });
    const nonce = "abcdef01";
    const mine = buildAiDynamicViewName({ username: "dee", sid: user.sid, nonce, tempId: -101 });
    registerAiSessionView({ viewName: mine, sid: user.sid, username: "dee", dashboardId: dash.id, nonce, tempId: -101, gen: 0 });
    const other = buildAiDynamicViewName({ username: "dee", sid: "zzzzzzzzzz", nonce: "12345678", tempId: -102 });
    registerAiSessionView({ viewName: other, sid: "zzzzzzzzzz", username: "dee", dashboardId: dash.id, nonce: "12345678", tempId: -102, gen: 0 });
    const rec = record([[...runQ("SELECT * FROM aidv_101", "1").slice(0, 1), toolCall("2", "run_query", { sql: "SELECT * FROM aidv_102" }), TOOLS_DONE], finalText("done")]);
    const snapshot = { widgets: [], layers: [], dynamicViews: [{ id: -101, name: "Trips by hour" }], filters: [] };
    const evs = await readSse(await ask({ snapshot }));
    expect(mock.userStmts).toHaveLength(1);
    expect(mock.userStmts[0].statement).toContain(mine);
    expect(toolMsgs(rec)[1]).toMatch(/^Refused: .*not on this dashboard/);
    expect(everything(rec)).not.toContain("_kbi_ai_");
    expect(resultOf(evs).queries.map((q: any) => q.outcome)).toEqual(["ok", "refused"]);
  });

  it("RQ-6 timeout cancels the tagged Kinetica job and tells the model", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query", AI_QUERY_TIMEOUT_MS: "1000" });
    mock.answer = hang;
    mock.jobs = () => ({ job_id: [77], query_text: [mock.userStmts[0].statement] });
    const rec = record([runQ(SQL1), finalText("done")]);
    const evs = await readSse(await ask());
    expect(mock.alter).toHaveLength(1);
    expect(mock.alter[0]).toMatchObject({ job_ids: [77], action: "cancel" });
    expect(toolMsgs(rec)[0]).toBe("query timed out");
    expect(resultOf(evs).queries[0].outcome).toBe("timed_out");
  });

  it("RQ-7 AI_QUERY_MAX_ROWS drives the envelope limit and truncation", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query", AI_QUERY_MAX_ROWS: "3" });
    mock.answer = () => new Response(JSON.stringify(kbody({ column_headers: ["vendor_id", "n"], column_1: ["a", "b", "c", "d"], column_2: [1, 2, 3, 4], total_number_of_records: 4 })), { status: 200 });
    const rec = record([runQ(SQL1), finalText("done")]);
    const evs = await readSse(await ask());
    expect(mock.userStmts[0].limit).toBe(4);
    const env = JSON.parse(toolMsgs(rec)[0].slice(toolMsgs(rec)[0].indexOf("{")));
    expect(env.rows).toHaveLength(3);
    expect(env.truncated).toBe(true);
    expect(resultOf(evs).queries[0].rowCount).toBe(3);
  });

  it("RQ-8 client abort mid-query cancels the in-flight <requestId>-qNN job through the port", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query" });
    mock.answer = hang;
    mock.jobs = () => ({ job_id: [88], query_text: [mock.userStmts[0]?.statement ?? ""] });
    record([runQ(SQL1), finalText("done")]);
    const ac = new AbortController();
    const p = ask({}, ac.signal).then((r) => readSse(r)).catch(() => []);
    expect(await pollUntil(() => mock.userStmts.length === 1)).toBe(true);
    ac.abort();
    await p;
    expect(await pollUntil(() => mock.alter.length >= 1)).toBe(true);
    expect(mock.alter[0]).toMatchObject({ job_ids: [88], action: "cancel" });
    expect(await pollUntil(() => auditRow()?.status === "final")).toBe(true);
    expect(JSON.parse(auditRow().queries_json)[0].outcome).toBe("cancelled");
  });

  it("RQ-9 the hard-deadline finalize keeps the queries attempted so far", async () => {
    const { ask } = await boot({ AI_DATA_ACCESS: "query", AI_TIMEOUT_MS: "1000" });
    __setAiGraceMsForTest(50);
    const p = customProvider(async function* (_s, call) {
      if (call === 0) { yield toolCall("1", "run_query", { sql: SQL1 }); yield TOOLS_DONE; return; }
      await new Promise<void>(() => {});
    });
    __setAiProviderFactoryForTest(() => p as any);
    const evs = await readSse(await ask());
    expect(evs.filter((e) => e.event === "error").map((e) => e.data.code)).toEqual(["AI_TIMEOUT"]);
    expect(await pollUntil(() => auditRow()?.status === "final")).toBe(true);
    const q = JSON.parse(auditRow().queries_json);
    expect(q).toHaveLength(1);
    expect(q[0].outcome).toBe("ok");
  });
});
