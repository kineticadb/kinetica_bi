// Phase 135-10 Task 3: streaming behaviour of POST /api/ai/ask through the real route (SSE-R).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db, createTable, addDashboardTable } from "../src/db";
import { deleteSession } from "../src/sessionStore";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider } from "../src/lib/ai/providers/scripted";
import { AI_USER_MESSAGES } from "../src/lib/ai/agentLoop";
import { __setAiHeartbeatMsForTest } from "../src/aiRoutes";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import {
  enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp,
  toolCall, TOOLS_DONE, finalText, addWidgetArgs, customProvider, pollUntil,
} from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch; // the TEST's client; the global stub only serves the server-side Kinetica calls
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

async function boot(env: Record<string, string> = {}) {
  restoreEnv = enableAiEnv(env);
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const secret = createTable({ name: "secret", schema: "other", columns: {} });
  addDashboardTable(dash.id, secret.id);
  const user = sessionFor("dee", ["designer"]);
  const ask = (signal?: AbortSignal, over: Record<string, unknown> = {}) =>
    realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, over)), signal });
  return { base, dash, table, secret, user, ask };
}

beforeEach(() => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] }, failing: { "other.secret": 403 } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  __setAiHeartbeatMsForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const use = (p: { complete: any }) => __setAiProviderFactoryForTest(() => p as any);
const auditRows = () => db.prepare("SELECT * FROM ai_audit").all() as any[];

describe("POST /api/ai/ask streaming", () => {
  it("SSE-R1 streams with event-stream headers and no buffering", async () => {
    const { ask } = await boot();
    use(new ScriptedProvider([finalText("hello")]));
    const res = await ask();
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const evs = await readSse(res);
    expect(evs.map((e) => e.event)).toContain("done");
  });

  it("SSE-R2 only the gateway-approved op reaches the browser, in one result event", async () => {
    const { ask, table, secret } = await boot();
    const good = addWidgetArgs(table.id, { tempId: -5 });
    use(
      new ScriptedProvider([
        [
          toolCall("a", "add_widget", { type: "bar" }), // (a) malformed -> shape
          toolCall("b", "patch", { targetKind: "widget", targetId: 7, changes: { tableId: 99 } }), // (b) permanently blocked key -> allow_list
          toolCall("e", "add_widget", good), // (e) valid (before a 2nd add_widget rejection: the loop blocks a tool after 2 rejections)
          toolCall("c", "add_widget", addWidgetArgs(secret.id, { tempId: -3 })), // (c) probe denied -> live_schema
          toolCall("d", "remove_widget", { id: 999 }), // (d) -> reference
          TOOLS_DONE,
        ],
        finalText("Added it."),
      ]),
    );
    const evs = await readSse(await ask(undefined, { snapshot: { widgets: [{ id: 7, type: "bar", title: "Existing", tableId: table.id }], layers: [], dynamicViews: [], filters: [] } }));
    const results = evs.filter((e) => e.event === "result");
    expect(results).toHaveLength(1);
    const r = results[0].data;
    expect(r.ops).toEqual([{ op: "add_widget", tempId: -5, type: "bar", title: "Trips by zone", config: { metricColumn: "fare", groupByColumn: "zone", tableId: table.id } }]);
    expect(r.skipped.map((s: any) => s.stage)).toEqual(["shape", "allow_list", "live_schema", "reference"]);
    expect(r.text).toBe("Added it.");
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { outcome: "ok" } });
    expect(evs.indexOf(results[0])).toBe(evs.findIndex((e) => e.event === "result")); // single, before done
  });

  it("SSE-R3 a permission revoked mid-answer rejects the later op at the permission stage", async () => {
    const { ask, table } = await boot();
    use(
      new ScriptedProvider([
        [toolCall("a", "add_widget", addWidgetArgs(table.id, { tempId: -1 })), TOOLS_DONE],
        () => {
          db.prepare("DELETE FROM user_roles WHERE username = 'dee'").run(); // designer role removed between tool calls
          return [toolCall("b", "add_widget", addWidgetArgs(table.id, { tempId: -2 })), TOOLS_DONE];
        },
        finalText("done"),
      ]),
    );
    const evs = await readSse(await ask());
    const r = evs.find((e) => e.event === "result")!.data;
    expect(r.ops.map((o: any) => o.tempId)).toEqual([-1]);
    expect(r.skipped.map((s: any) => s.stage)).toEqual(["permission"]);
  });

  it("SSE-R4 atomic: a failed answer streams NO result even after valid ops", async () => {
    const { ask, table } = await boot();
    use(
      new ScriptedProvider([
        [toolCall("a", "add_widget", addWidgetArgs(table.id, { tempId: -1 })), toolCall("b", "add_widget", addWidgetArgs(table.id, { tempId: -2 })), TOOLS_DONE],
        [{ type: "error", kind: "rate_limited", retryAfterMs: 25_000 }],
      ]),
    );
    const evs = await readSse(await ask());
    expect(evs.some((e) => e.event === "result")).toBe(false);
    expect(evs.find((e) => e.event === "error")!.data).toEqual({ code: "AI_RATE_LIMITED", message: AI_USER_MESSAGES.rateLimited });
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { outcome: "rate_limited" } });
  });

  it("SSE-R5 step cap -> AI_CAPPED with the exact message and no result", async () => {
    const { ask } = await boot({ AI_MAX_TOOL_STEPS: "2" });
    use(new ScriptedProvider([[toolCall("a", "get_dashboard", {}), toolCall("b", "get_dashboard", {}), toolCall("c", "get_dashboard", {}), TOOLS_DONE]]));
    const evs = await readSse(await ask());
    expect(evs.some((e) => e.event === "result")).toBe(false);
    expect(evs.find((e) => e.event === "error")!.data).toEqual({
      code: "AI_CAPPED",
      message: "This answer reached the 2-step limit; try a more specific question.",
    });
  });

  it("SSE-R6 closing the connection aborts the provider call and audits cancelled", async () => {
    const { ask } = await boot();
    const hang = customProvider(async function* (signal) {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      yield { type: "error", kind: "aborted" };
    });
    use(hang);
    const ctl = new AbortController();
    const res = await ask(ctl.signal);
    const reader = res.body!.getReader();
    let seen = "";
    while (!seen.includes("event: status")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    expect(seen).toContain("event: status");
    ctl.abort();
    expect(await pollUntil(() => hang.signals.length > 0 && hang.signals[0].aborted)).toBe(true);
    expect(await pollUntil(() => auditRows().some((r) => r.status === "final"))).toBe(true);
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("cancelled");
  });

  it("SSE-R7 a session revoked between steps yields no result and AI_SESSION_ENDED", async () => {
    const { ask, user } = await boot();
    use(
      new ScriptedProvider([
        () => {
          deleteSession(user.sid);
          return [toolCall("a", "get_dashboard", {}), TOOLS_DONE];
        },
        finalText("never"),
      ]),
    );
    const evs = await readSse(await ask());
    expect(evs.some((e) => e.event === "result")).toBe(false);
    expect(evs.find((e) => e.event === "error")!.data.code).toBe("AI_SESSION_ENDED");
  });

  it("SSE-R8 a factory that throws after headers becomes an AI_INTERNAL error event, not a JSON 500", async () => {
    const { ask } = await boot();
    __setAiProviderFactoryForTest(() => {
      throw new Error("boom-secret-detail");
    });
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const evs = await readSse(res);
    expect(evs.find((e) => e.event === "error")!.data).toEqual({ code: "AI_INTERNAL", message: AI_USER_MESSAGES.internal });
    expect(JSON.stringify(evs)).not.toContain("boom-secret-detail");
    expect(evs.at(-1)!.event).toBe("done");
  });

  it("SSE-R9 a heartbeat comment is sent while the provider is slow", async () => {
    const { ask } = await boot();
    __setAiHeartbeatMsForTest(20);
    use(
      customProvider(async function* () {
        await new Promise((r) => setTimeout(r, 120));
        yield { type: "text_delta", text: "ok" };
        yield { type: "done", finish: "stop" };
      }),
    );
    const res = await ask();
    const text = await res.text();
    expect(text).toContain(": ping");
    expect(text).toContain("event: done");
  });
});
