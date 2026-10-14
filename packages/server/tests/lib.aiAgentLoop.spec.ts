import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { runAgentLoop, AI_USER_MESSAGES, type AgentLoopInput, type AgentLoopDeps, type AiProgressEvent } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
import type { LiveSchemaPort, ReadTool, ToolContext } from "../src/lib/ai/tools/types";
import type { LlmEvent } from "../src/lib/ai/provider";
import { SessionEndedError } from "../src/lib/exportRunner";
import { CANARY_ROW_VALUE_9f3 as C } from "./helpers/aiTestKit";

const OUTCOMES = ["ok", "cancelled", "capped", "provider_error", "rate_limited"];
const call = (id: string, name: string, args: unknown): LlmEvent => ({ type: "tool_call", id, name, argsRaw: JSON.stringify(args) });
const DONE_TOOLS: LlmEvent = { type: "done", finish: "tool_calls" };
const DONE: LlmEvent = { type: "done", finish: "stop" };
const turn = (...calls: LlmEvent[]): LlmEvent[] => [...calls, DONE_TOOLS];
const final = (t: string): LlmEvent[] => [{ type: "text_delta", text: t }, DONE];
const addW = (id: string, tempId = -1, col = "fare_amount") => call(id, "add_widget", { tempId, type: "bar", title: "T", tableId: 7, metric: col, aggregation: "sum", groupBy: "vendor_id" });
const describeT = (id: string) => call(id, "describe_table", { tableId: 7 });

function setup(steps: ScriptStep[], o: { maxToolSteps?: number; timeoutMs?: number; extraTools?: ReadTool[]; deps?: Partial<AgentLoopDeps>; perms?: ReadonlySet<string> } = {}) {
  const describe = vi.fn(async (id: number) =>
    id === 7
      ? { ok: true as const, table: { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] } }
      : { ok: false as const });
  const liveSchema: LiveSchemaPort = { describe };
  const provider = new ScriptedProvider(steps);
  const registry = buildToolRegistry({ dataAccess: "schema", extraTools: o.extraTools });
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [7], registeredTables: () => [],
  };
  const shadow = createShadow({ widgets: [{ id: 42, type: "map", title: "Trips", tableId: 7 }], layers: [], dynamicViews: [], filters: [] });
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry, toolCtx,
    gateway: { username: "ann", dashboardId: 1, shadow, liveSchema, getPermissions: () => o.perms ?? new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [7] },
    dataAccess: "schema", maxToolSteps: o.maxToolSteps ?? 10, timeoutMs: o.timeoutMs ?? 60_000,
  };
  const events: AiProgressEvent[] = [];
  const sleeps: number[] = [];
  const clock = { t: 1_000 };
  const deps: AgentLoopDeps = {
    provider, signal: new AbortController().signal, now: () => clock.t,
    sleep: async (ms) => { sleeps.push(ms); }, checkSession: () => {}, emit: (e) => events.push(e), ...o.deps,
  };
  return { input, deps, provider, events, sleeps, clock, describe };
}
const run = (s: ReturnType<typeof setup>) => runAgentLoop(s.input, s.deps);

describe("runAgentLoop", () => {
  it("LOOP-1 happy path", async () => {
    const s = setup([turn(describeT("c1")), turn(addW("c2")), [{ type: "usage", inputTokens: 5, outputTokens: 2 }, ...final("Added.")]]);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ op: "add_widget", tempId: -1 });
    expect(r.applied).toHaveLength(1);
    expect(r.steps).toBe(2);
    expect(r.text).toBe("Added.");
    expect(r.tools.map((t) => t.name)).toEqual(["describe_table", "add_widget"]);
    expect(r.tools[0].args).toEqual({ tableId: 7 });
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    const second = s.provider.requests[1].messages;
    expect(second.some((m) => m.role === "tool" && m.toolCallId === "c1")).toBe(true);
    const r2 = await run(setup([final("x")]));
    expect(r2.usage).toEqual({});
  });

  it("LOOP-2 atomicity: 429 give-up discards validated ops", async () => {
    const s = setup([turn(addW("a", -1), addW("b", -2)), [{ type: "error", kind: "rate_limited", retryAfterMs: 25_000 }]]);
    const r = await run(s);
    expect(r.outcome).toBe("rate_limited");
    expect(r.message).toBe(AI_USER_MESSAGES.rateLimited);
    expect(r.ops).toEqual([]);
    expect(r.applied).toEqual([]);
    expect(s.sleeps).toEqual([]);
  });

  it("LOOP-3 429 within budget waits and succeeds", async () => {
    const s = setup([[{ type: "error", kind: "rate_limited", retryAfterMs: 2000 }], final("ok")]);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(s.sleeps).toEqual([2000]);
    expect(s.events).toContainEqual({ type: "status", phase: "waiting_provider", label: "Waiting for the AI provider… (2s)", seconds: 2 });
  });

  it("LOOP-4 step cap", async () => {
    const s = setup([0, 1, 2, 3, 4].map((i) => turn(describeT(`c${i}`))), { maxToolSteps: 3 });
    const r = await run(s);
    expect(r.outcome).toBe("capped");
    expect(r.detail).toBe("step_cap");
    expect(r.message).toBe("This answer reached the 3-step limit; try a more specific question.");
    expect(r.ops).toEqual([]);
    expect(r.steps).toBe(3);
    expect(s.describe).toHaveBeenCalledTimes(3);
  });

  it("LOOP-4b rejected calls count as steps toward the cap", async () => {
    const s = setup([0, 1, 2, 3].map((i) => turn(addW(`c${i}`, -1, "nope"))), { maxToolSteps: 2 });
    const r = await run(s);
    expect(r.outcome).toBe("capped");
    expect(r.steps).toBe(2);
  });

  it("LOOP-5 rejection, repair and per-tool repair limit", async () => {
    const s = setup([turn(addW("a", -1, "nope")), turn(addW("b", -1)), final("done")]);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(r.ops).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].stage).toBe("live_schema");
    const toolMsg = s.provider.requests[1].messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ isError: true });
    expect(toolMsg && "content" in toolMsg ? toolMsg.content : "").toContain("nope");

    const s2 = setup([0, 1, 2].map((i) => turn(addW(`c${i}`, -1, "nope"))).concat([final("giving up")]));
    const r2 = await run(s2);
    expect(r2.outcome).toBe("ok");
    expect(s2.describe).toHaveBeenCalledTimes(2); // 3rd call never reached the gateway
    expect(r2.steps).toBe(3);
    const last = s2.provider.requests[3].messages.filter((m) => m.role === "tool").pop();
    expect(last && "content" in last ? last.content : "").toBe("Not executed: too many invalid attempts for add_widget.");
    expect(r2.ops).toEqual([]);
  });

  it("LOOP-6 parallel calls each answered; cap between them", async () => {
    const s = setup([turn(describeT("p1"), describeT("p2")), final("ok")]);
    const r = await run(s);
    expect(r.steps).toBe(2);
    const ids = s.provider.requests[1].messages.filter((m) => m.role === "tool").map((m) => (m.role === "tool" ? m.toolCallId : ""));
    expect(ids).toEqual(["p1", "p2"]);

    const s2 = setup([turn(describeT("p1"), describeT("p2"))], { maxToolSteps: 1 });
    const r2 = await run(s2);
    expect(r2.outcome).toBe("capped");
    expect(r2.tools).toHaveLength(2);
    expect(r2.tools[1]).toMatchObject({ result: "error" });
    expect(s2.describe).toHaveBeenCalledTimes(1);
  });

  it("LOOP-7 cancel during step 2", async () => {
    const ctl = new AbortController();
    const s = setup([turn(addW("a")), () => { ctl.abort(); return final("late"); }], { deps: { signal: ctl.signal } });
    const r = await run(s);
    expect(r.outcome).toBe("cancelled");
    expect(r.detail).toBe("client_abort");
    expect(r.ops).toEqual([]);
  });

  it("LOOP-8 timeout via injected clock", async () => {
    const s = setup([() => { s.clock.t += 5000; return turn(addW("a")); }], { timeoutMs: 1000 });
    const r = await run(s);
    expect(r.outcome).toBe("provider_error");
    expect(r.detail).toBe("timeout");
    expect(r.message).toBe(AI_USER_MESSAGES.timeout);
    expect(r.ops).toEqual([]);
  });

  it("LOOP-9 session ended mid-answer and at the final check", async () => {
    let n = 0;
    const s = setup([turn(addW("a", -1), addW("b", -2)), final("x")], { deps: { checkSession: () => { if (++n === 2) throw new SessionEndedError(); } } });
    const r = await run(s);
    expect(r).toMatchObject({ outcome: "cancelled", detail: "session_ended", message: AI_USER_MESSAGES.sessionEnded, ops: [] });

    let m = 0;
    const s2 = setup([turn(addW("a")), final("x")], { deps: { checkSession: () => { if (++m === 2) throw new SessionEndedError(); } } });
    const r2 = await run(s2);
    expect(m).toBe(2);
    expect(r2).toMatchObject({ outcome: "cancelled", detail: "session_ended", ops: [] });
  });

  it("LOOP-10 provider auth and network errors", async () => {
    const a = await run(setup([[{ type: "error", kind: "auth", status: 401 }]]));
    expect(a).toMatchObject({ outcome: "provider_error", detail: "auth", message: AI_USER_MESSAGES.providerAuth });
    const n = await run(setup([[{ type: "error", kind: "network" }]]));
    expect(n).toMatchObject({ outcome: "provider_error", detail: "network", message: AI_USER_MESSAGES.providerFailed });
  });

  it("LOOP-11 egress violation stops the answer before anything is sent", async () => {
    const leak: ReadTool = { kind: "read", name: "leak", description: "x", args: z.object({}), run: async () => ({ parts: [part.rows(C)] }) };
    expect(JSON.stringify((await leak.run({}, {} as ToolContext)).parts)).toContain(C); // positive control
    const s = setup([turn(call("l", "leak", {})), final("never")], { extraTools: [leak] });
    const r = await run(s);
    expect(r).toMatchObject({ outcome: "provider_error", detail: "egress_blocked", message: AI_USER_MESSAGES.egressBlocked, ops: [] });
    expect(JSON.stringify(s.provider.requests)).not.toContain(C);
    expect(s.provider.requests).toHaveLength(1);
  });

  it("LOOP-12 unknown tool is a shape rejection; loop never throws on fuzz", async () => {
    const s = setup([turn(call("u", "drop_database", {})), final("ok")]);
    const r = await run(s);
    expect(r.steps).toBe(1);
    const tm = s.provider.requests[1].messages.find((m) => m.role === "tool");
    expect(tm && "content" in tm ? tm.content : "").toBe("Unknown tool drop_database.");

    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const evPool = (): LlmEvent => pick<LlmEvent>([
      { type: "text_delta", text: "t" }, DONE, DONE_TOOLS, { type: "usage", inputTokens: 1 },
      { type: "error", kind: pick(["rate_limited", "overloaded", "auth", "network", "bad_request", "timeout", "aborted", "protocol"] as const), retryAfterMs: 10 },
      { type: "tool_call", id: "x", name: pick(["add_widget", "describe_table", "nope", "patch"]), argsRaw: pick(["{}", "not json", '{"tableId":7}', "null", '{"tempId":-1}']) },
    ]);
    for (let i = 0; i < 50; i++) {
      const steps = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Array.from({ length: Math.floor(rnd() * 5) }, evPool));
      const rr = await run(setup(steps, { maxToolSteps: 3 }));
      expect(OUTCOMES).toContain(rr.outcome);
      if (rr.outcome !== "ok") expect(rr.ops).toEqual([]);
    }
  });

  it("LOOP-13 progress events", async () => {
    const s = setup([turn(describeT("c1")), final("ok")]);
    await run(s);
    expect(s.events.filter((e) => e.type === "status" && e.phase === "thinking")).toHaveLength(2);
    expect(s.events.filter((e) => e.type === "step")).toEqual([{ type: "step", n: 1, tool: "describe_table", label: "describe_table" }]);
  });

});
