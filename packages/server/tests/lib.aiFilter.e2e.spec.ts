// Phase 138-02: scripted-provider end-to-end proofs for AI filters over the SHIPPING registry, gateway and agent loop.
// Only the provider (ScriptedProvider) and the live schema port are stubbed. No network, no real provider.
import { describe, it, expect, vi, afterEach } from "vitest";
import { type AskRequest } from "@kinetica-bi/shared";
import { runAgentLoop, type AgentLoopInput, type AgentLoopDeps, type AgentLoopResult } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
import type { LiveSchemaPort, ToolContext } from "../src/lib/ai/tools/types";
import type { LlmEvent } from "../src/lib/ai/provider";
import { forbidProviderNetwork } from "./helpers/aiTestKit";

afterEach(() => vi.unstubAllGlobals());

const call = (id: string, name: string, args: unknown): LlmEvent => ({ type: "tool_call", id, name, argsRaw: JSON.stringify(args) });
const DONE_TOOLS: LlmEvent = { type: "done", finish: "tool_calls" };
const DONE: LlmEvent = { type: "done", finish: "stop" };
const turn = (...calls: LlmEvent[]): LlmEvent[] => [...calls, DONE_TOOLS];
const final = (t: string): LlmEvent[] => [{ type: "text_delta", text: t }, DONE];

type Snap = AskRequest["snapshot"];
const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "payment_type", type: "string" }, { name: "vendor_id", type: "string" }, { name: "fare_amount", type: "double" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "payment_type", type: "string" }] };
const snap = (filters: Snap["filters"] = []): Snap => ({
  widgets: [{ id: 12, type: "bar", title: "Revenue", tableId: 5, layout: { x: 0, y: 0, w: 18, h: 30 } }],
  layers: [], dynamicViews: [], filters,
});
const f5 = (cols: string[]): Snap["filters"] => cols.map((column) => ({ source: { kind: "table" as const, id: 5 }, column, op: "eq" }));

function setup(steps: ScriptStep[], o: { snapshot?: Snap; tables?: number[] } = {}) {
  const tableIds = o.tables ?? [5];
  const liveSchema: LiveSchemaPort = {
    describe: async (id) => {
      const t = [T5, T6].find((x) => x.id === id);
      return t ? { ok: true as const, table: t } : { ok: false as const };
    },
  };
  const provider = new ScriptedProvider(steps);
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => tableIds, registeredTables: () => [{ id: 5, schema: "demo", name: "trips" }],
  };
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry: buildToolRegistry({ dataAccess: "schema" }), toolCtx,
    gateway: {
      username: "ann", dashboardId: 1, shadow: createShadow(o.snapshot ?? snap()), liveSchema,
      getPermissions: () => new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => tableIds,
    },
    maxNewWidgets: 6, dataAccess: "schema", maxToolSteps: 20, timeoutMs: 60_000,
  };
  const deps: AgentLoopDeps = { provider, signal: new AbortController().signal, now: () => 1_000, sleep: async () => {}, checkSession: () => {}, emit: () => {} };
  return { input, deps, provider };
}
const run = async (steps: ScriptStep[], o?: Parameters<typeof setup>[1]): Promise<AgentLoopResult & { requests: ScriptedProvider["requests"] }> => {
  forbidProviderNetwork();
  const s = setup(steps, o);
  const r = await runAgentLoop(s.input, s.deps);
  return { ...r, requests: s.provider.requests };
};
const CAP25 = [...Array.from({ length: 24 }, (_, i) => `c${i + 1}`), "payment_type"];

describe("AI filters e2e (scripted provider, real tools + gateway + loop)", () => {
  it("E2EF-1 no tableId resolves the single source and stamps the typed filter", async () => {
    const r = await run([turn(call("a", "apply_filter", { column: "payment_type", value: "Credit" })), final("Done.")]);
    expect(r.ops).toEqual([{ op: "apply_filter", source: { kind: "table", id: 5 }, filters: [{ column: "payment_type", operator: "eq", value: "Credit", dataType: "string" }] }]);
    expect(r.applied[0]).toBe("Filtered table 5 on payment_type");
  });

  it("E2EF-2 column on two tables asks which one", async () => {
    const r = await run([turn(call("a", "apply_filter", { column: "payment_type", value: "Credit" })), final("Which table?")], { tables: [5, 6] });
    expect(r.ops).toEqual([]);
    expect(r.clarifications[0].kind).toBe("choose_option");
    expect(r.clarifications[0].options).toHaveLength(2);
  });

  it("E2EF-3 a repeated bad column is skipped once with a did-you-mean", async () => {
    const bad = call("a", "apply_filter", { column: "paymnt_type", value: "Credit" });
    const r = await run([turn(bad), turn(call("b", "apply_filter", { column: "paymnt_type", value: "Credit" })), final("Skipped.")]);
    expect(r.ops).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reasons.join(" ")).toContain("payment_type");
  });

  it("E2EF-4 cap refuses a new column, allows a replace", async () => {
    const over = await run([turn(call("a", "apply_filter", { column: "vendor_id", value: "x" })), final("No.")], { snapshot: snap(f5(CAP25)) });
    expect(over.ops).toEqual([]);
    expect(over.skipped[0].stage).toBe("cap");
    const repl = await run([turn(call("a", "apply_filter", { column: "payment_type", value: "x" })), final("Ok.")], { snapshot: snap(f5(CAP25)) });
    expect(repl.ops).toHaveLength(1);
  });

  it("E2EF-5 clear_filter with no arguments clears everything; none is refused", async () => {
    const r = await run([turn(call("a", "clear_filter", {})), final("Cleared.")], { snapshot: snap(f5(["payment_type", "vendor_id"])) });
    expect(r.ops).toEqual([{ op: "clear_filter" }]);
    expect(r.applied[0]).toBe("Cleared all filters");
    const none = await run([turn(call("a", "clear_filter", {})), final("Nothing.")]);
    expect(none.ops).toEqual([]);
    expect(none.skipped[0].reasons.join(" ")).toContain("there are no filters to clear");
  });

  it("E2EF-6 the value reaches the op but never a tool result or the change label", async () => {
    const V = "SECRETVAL_77";
    const r = await run([turn(call("a", "apply_filter", { column: "payment_type", value: V })), final("Done.")]);
    expect((r.ops[0] as { filters: { value: string }[] }).filters[0].value).toBe(V);
    expect(JSON.stringify(r.applied)).not.toContain(V);
    const toolResults = r.requests.flatMap((q) => q.messages.filter((m) => m.role === "tool"));
    expect(toolResults.length).toBeGreaterThan(0);
    for (const m of toolResults) expect(JSON.stringify(m)).not.toContain(V);
    expect(JSON.stringify(toolResults)).toContain("OK: Filtered table 5 on payment_type");
  });
});
