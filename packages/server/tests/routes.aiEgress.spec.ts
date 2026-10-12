// Phase 135-11 Task 1: EGRESS canary matrix through the real POST /api/ai/ask route (AIGOV-V20-02).
// A planted row value must never appear in an outbound provider request in schema mode. Every absence assertion
// is backed by positive controls (EGX-P1..P3): the canary really is upstream, the recording really holds
// probe-derived data, and the egress gate (not luck) is what blocks rows.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { createTable, addDashboardTable } from "../src/db";
import { deleteSession } from "../src/sessionStore";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, RecordingProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildOutboundRequest, EgressViolation, part } from "../src/lib/ai/outbound";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { CANARY_ROW_VALUE_9f3 as CANARY, findLeak, forbidProviderNetwork } from "./helpers/aiTestKit";
import {
  enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs,
} from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

const kbody = (result: unknown) => ({
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }),
});
// The upstream trips probe answers column headers AND (unexpectedly) a row carrying the canary.
const TRIPS_BODY = JSON.stringify(kbody({ column_headers: ["fare_amount", "vendor_id"], column_1: [CANARY], column_2: [CANARY], total_number_of_records: 1 }));
function kineticaMock(): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
    const key = /FROM\s+([^\s]+)\s+LIMIT 0/i.exec(stmt)?.[1]?.replace(/["`]/g, "");
    if (key === "demo.trips") return new Response(TRIPS_BODY, { status: 200 });
    if (key === "demo.secret") return new Response(JSON.stringify({ status: "ERROR", message: `denied ${CANARY}` }), { status: 403 });
    if (key === "demo.broken") return new Response(`Internal error: ${CANARY}`, { status: 500 });
    return new Response(JSON.stringify(kbody({ column_headers: [] })), { status: 200 });
  }) as typeof fetch;
}

async function boot(env: Record<string, string> = {}) {
  restoreEnv = enableAiEnv({ AI_MAX_TOOL_STEPS: "20", ...env });
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const trips = makeTableOn(dash.id, "demo", "trips");
  const secret = createTable({ name: "secret", schema: "demo", columns: {} });
  const broken = createTable({ name: "broken", schema: "demo", columns: {} });
  addDashboardTable(dash.id, secret.id);
  addDashboardTable(dash.id, broken.id);
  const user = sessionFor("dee", ["designer"]);
  const snapshot = {
    widgets: [{ id: 7, type: "map", title: "Existing", tableId: trips.id }],
    layers: [{ id: 3, widgetId: 7, tableId: trips.id }],
    dynamicViews: [{ id: 4, name: "dv" }],
    filters: [],
  };
  const ask = (over: Record<string, unknown> = {}) =>
    realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { snapshot, ...over })) });
  return { dash, trips, secret, broken, user, ask };
}

beforeEach(() => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  forbidProviderNetwork(kineticaMock());
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
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
/** Asserts every encoded form of the canary is absent from `text`. */
function expectNoCanary(text: string): void {
  expect(findLeak(text, CANARY)).toBeNull();
}
const toolContents = (rec: RecordingProvider): string =>
  JSON.stringify(rec.requests.flatMap((r) => r.messages.filter((m) => m.role === "tool").map((m) => (m as any).content)).concat(rec.requests.map((r) => r.system)));

function everyToolValid(ids: { trips: number; secret: number; broken: number }): ScriptStep[] {
  return [
    [
      toolCall("1", "get_dashboard", {}),
      toolCall("2", "list_tables", {}),
      toolCall("3", "describe_table", { tableId: ids.trips }),
      toolCall("4", "describe_table", { tableId: ids.secret }),
      toolCall("5", "describe_table", { tableId: ids.broken }),
      toolCall("6", "add_widget", addWidgetArgs(ids.trips, { tempId: -1, config: { metricColumn: "fare_amount", groupByColumn: "vendor_id" } })),
      toolCall("7", "patch", { targetKind: "widget", targetId: 7, changes: { title: "renamed" } }),
      toolCall("8", "remove_widget", { id: 7 }),
      toolCall("9", "remove_layer", { id: 3 }),
      toolCall("10", "remove_dynamic_view", { id: 4 }),
      TOOLS_DONE,
    ],
    finalText("done"),
  ];
}

describe("EGRESS canary matrix (schema mode)", () => {
  it("EGX-1 every registered tool with valid args: no canary in any outbound request", async () => {
    const { ask, trips, secret, broken } = await boot();
    const rec = record(everyToolValid({ trips: trips.id, secret: secret.id, broken: broken.id }));
    const evs = await readSse(await ask());
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { outcome: "ok" } });
    expect(rec.requests).toHaveLength(2);
    expectNoCanary(JSON.stringify(rec.requests));
  });

  it("EGX-2 every tool with INVALID args containing the canary: gateway reasons never echo values", async () => {
    const { ask } = await boot();
    const rec = record([
      [
        toolCall("1", "get_dashboard", { extra: CANARY }),
        toolCall("2", "list_tables", { extra: CANARY }),
        toolCall("3", "describe_table", { tableId: CANARY }),
        toolCall("4", "add_widget", { tempId: CANARY, type: CANARY, title: CANARY, tableId: CANARY, config: { x: CANARY } }),
        toolCall("5", "patch", { targetKind: CANARY, targetId: CANARY, changes: { a: CANARY } }),
        toolCall("6", "remove_widget", { id: CANARY }),
        toolCall("7", "remove_layer", { id: CANARY }),
        toolCall("8", "remove_dynamic_view", { id: CANARY }),
        TOOLS_DONE,
      ],
      finalText("done"),
    ]);
    await readSse(await ask());
    expect(rec.requests).toHaveLength(2);
    const second = rec.requests[1];
    // control inside the case: the model's own args ARE echoed in the assistant message (by design), so the recording would see a leak.
    expect(findLeak(JSON.stringify(second.messages.filter((m) => m.role === "assistant")), CANARY)).not.toBeNull();
    expect(second.messages.filter((m) => m.role === "tool").length).toBe(8);
    expectNoCanary(toolContents(rec));
  });

  it("EGX-3 unknown table id, unknown column, unknown tool name", async () => {
    const { ask, trips } = await boot();
    const rec = record([
      [
        toolCall("1", "describe_table", { tableId: 999999 }),
        toolCall("2", "add_widget", addWidgetArgs(trips.id, { tempId: -2, config: { metricColumn: "no_such_col", groupByColumn: "vendor_id" } })),
        toolCall("3", "drop_everything", { sql: "select 1" }),
        TOOLS_DONE,
      ],
      finalText("done"),
    ]);
    await readSse(await ask());
    expect(rec.requests).toHaveLength(2);
    expect(rec.requests[1].messages.filter((m) => m.role === "tool").length).toBe(3);
    expectNoCanary(JSON.stringify(rec.requests));
  });

  it("EGX-4 provider error paths: bad_request, rate_limited beyond budget, auth", async () => {
    for (const err of [
      { type: "error", kind: "bad_request" },
      { type: "error", kind: "rate_limited", retryAfterMs: 25_000 },
      { type: "error", kind: "auth" },
    ] as const) {
      const { ask, trips, secret, broken } = await boot();
      const rec = record([
        [
          toolCall("1", "describe_table", { tableId: trips.id }),
          toolCall("2", "describe_table", { tableId: secret.id }),
          toolCall("3", "describe_table", { tableId: broken.id }),
          TOOLS_DONE,
        ],
        [err as any],
      ]);
      const evs = await readSse(await ask());
      expect(evs.some((e) => e.event === "result")).toBe(false);
      expect(rec.requests).toHaveLength(2); // the request that carried the tool results was recorded, then the error
      expectNoCanary(JSON.stringify(rec.requests));
      expectNoCanary(JSON.stringify(evs));
      for (const s of servers) s.close();
      servers = [];
      restoreEnv?.();
      restoreEnv = null;
      resetAiTables();
      __clearLiveSchemaCacheForTest();
    }
  });

  it("EGX-5 session ended mid-answer", async () => {
    const { ask, user, trips, secret } = await boot();
    const rec = record([
      [toolCall("1", "describe_table", { tableId: trips.id }), toolCall("2", "describe_table", { tableId: secret.id }), TOOLS_DONE],
      () => {
        deleteSession(user.sid);
        return [toolCall("3", "describe_table", { tableId: trips.id }), TOOLS_DONE];
      },
      finalText("never"),
    ]);
    const evs = await readSse(await ask());
    expect(evs.find((e) => e.event === "error")!.data.code).toBe("AI_SESSION_ENDED");
    expectNoCanary(JSON.stringify(rec.requests));
    expectNoCanary(JSON.stringify(evs));
  });

  it("EGX-6 a snapshot carrying the canary is refused before any provider request", async () => {
    const { ask, trips } = await boot();
    const rec = record([finalText("never")]);
    const filterRes = await ask({
      snapshot: { widgets: [], layers: [], dynamicViews: [], filters: [{ source: { kind: "table", id: trips.id }, column: "fare_amount", op: "eq", value: CANARY }] },
    });
    expect(filterRes.status).toBe(400);
    expect((await filterRes.json()).code).toBe("AI_BAD_REQUEST");
    const whereRes = await ask({
      snapshot: { widgets: [{ id: 7, type: "bar", title: "w", tableId: trips.id, binding: { customWhere: `fare_amount = '${CANARY}'` } }], layers: [], dynamicViews: [], filters: [] },
    });
    expect(whereRes.status).toBe(400);
    expect((await whereRes.json()).code).toBe("AI_BAD_REQUEST");
    expect(rec.requests).toHaveLength(0);
  });

  // ---- positive controls ----
  it("EGX-P1 the planted value really is in the upstream Kinetica data", () => {
    expect(findLeak(TRIPS_BODY, CANARY)).toBe("raw");
    // encoded-form branches of the detector fire (needle with URL-special chars; base64 of the canary)
    expect(findLeak(encodeURIComponent("a b&c"), "a b&c")).toBe("url");
    expect(findLeak(Buffer.from(CANARY).toString("base64"), CANARY)).toBe("base64");
    expect(findLeak("nothing here", CANARY)).toBeNull();
  });

  it("EGX-P2 the recording holds probe-derived schema data (so absence of the canary is meaningful)", async () => {
    const { ask, trips, secret, broken } = await boot();
    const rec = record(everyToolValid({ trips: trips.id, secret: secret.id, broken: broken.id }));
    await readSse(await ask());
    const all = JSON.stringify(rec.requests);
    expect(all).toContain("fare_amount");
    expect(all).toContain("vendor_id");
  });

  it("EGX-P3 the egress gate, not luck, blocks rows: query mode admits them, schema mode throws", () => {
    const build = (dataAccess: "schema" | "query") =>
      buildOutboundRequest({
        system: [part.system("sys")],
        messages: [{ role: "tool", toolCallId: "t", name: "x", parts: [part.rows(CANARY)] }],
        tools: [],
        dataAccess,
      });
    const q = build("query");
    expect(JSON.stringify(q.messages)).toContain(CANARY);
    expect(() => build("schema")).toThrow(EgressViolation);
  });
});
