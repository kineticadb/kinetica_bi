// Phase 135-10 Task 3: exactly one finalized ai_audit row per admitted answer (AUD-R).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { deleteSession } from "../src/sessionStore";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

async function boot(env: Record<string, string> = {}) {
  restoreEnv = enableAiEnv(env);
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const ask = async () => {
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { question: "Chart the fares" })) });
    return { res, evs: res.headers.get("content-type")?.startsWith("text/event-stream") ? await readSse(res) : [] };
  };
  return { dash, table, user, ask };
}

beforeEach(() => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const script = (steps: ScriptStep[]) => __setAiProviderFactoryForTest(() => new ScriptedProvider(steps));
const rows = () => db.prepare("SELECT * FROM ai_audit").all() as any[];

describe("one audit row per answer", () => {
  const cases: { name: string; env?: Record<string, string>; steps: (ctx: { sid: string; tableId: number }) => ScriptStep[]; outcome: string }[] = [
    { name: "ok", steps: () => [finalText("fine")], outcome: "ok" },
    { name: "rate_limited", steps: () => [[{ type: "error", kind: "rate_limited", retryAfterMs: 25_000 }]], outcome: "rate_limited" },
    { name: "capped", env: { AI_MAX_TOOL_STEPS: "1" }, steps: () => [[toolCall("a", "get_dashboard", {}), toolCall("b", "get_dashboard", {}), TOOLS_DONE]], outcome: "capped" },
    { name: "provider_error", steps: () => [[{ type: "error", kind: "auth", status: 401 }]], outcome: "provider_error" },
    {
      name: "cancelled",
      steps: ({ sid }) => [() => { deleteSession(sid); return [toolCall("a", "get_dashboard", {}), TOOLS_DONE]; }],
      outcome: "cancelled",
    },
  ];
  for (const c of cases) {
    it(`AUD-R1 ${c.name}: exactly one final counted row`, async () => {
      const { ask, user, table } = await boot(c.env);
      script(c.steps({ sid: user.sid, tableId: table.id }));
      await ask();
      const r = rows();
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ status: "final", counted: 1, outcome: c.outcome });
    });
  }

  it("AUD-R2 the ok row records question, answer, tools, changes, provider, model, tokens and versions", async () => {
    const { ask, table } = await boot();
    script([
      [
        { type: "usage", inputTokens: 5, outputTokens: 3 },
        toolCall("a", "add_widget", addWidgetArgs(table.id, { tempId: -1 })),
        toolCall("b", "remove_widget", { id: 999 }),
        toolCall("c", "add_widget", { type: "bar" }),
        TOOLS_DONE,
      ],
      finalText("Here is your chart.", { inputTokens: 11, outputTokens: 7 }),
    ]);
    await ask();
    const [row] = rows();
    expect(row.question).toBe("Chart the fares");
    expect(row.answer_text).toBe("Here is your chart.");
    expect(row.outcome).toBe("ok");
    const tools = JSON.parse(row.tools_json);
    expect(tools).toHaveLength(3);
    expect(tools[0]).toEqual({ name: "add_widget", args: addWidgetArgs(table.id, { tempId: -1 }), result: "ok" });
    expect(tools[1]).toEqual({ name: "remove_widget", args: { id: 999 }, result: "rejected", stage: "reference", reasons: ["widget 999 does not exist"] });
    expect(tools[2].name).toBe("add_widget");
    expect(tools[2].result).toBe("rejected");
    expect(tools[2].stage).toBe("shape");
    expect("args" in tools[2]).toBe(false); // no args for shape failures
    const changes = JSON.parse(row.changes_json);
    expect(changes.applied).toHaveLength(1);
    expect(typeof changes.applied[0]).toBe("string");
    expect(changes.rejected.map((x: any) => [x.label, x.stage])).toEqual([["remove_widget", "reference"], ["add_widget", "shape"]]);
    expect(changes.rejected[0].reasons).toEqual(["widget 999 does not exist"]);
    expect(row.provider).toBe("openai-compatible");
    expect(row.model).toBe("test-model");
    expect(row.allow_list_version).toBe("v3");
    expect(row.data_access).toBe("schema");
    expect(row.input_tokens).toBe(16);
    expect(row.output_tokens).toBe(10);
  });

  it("AUD-R2b token columns are NULL when the provider reports no usage", async () => {
    const { ask } = await boot();
    script([finalText("no usage")]);
    await ask();
    const [row] = rows();
    expect(row.input_tokens).toBeNull();
    expect(row.output_tokens).toBeNull();
  });

  it("AUD-R3 a cap refusal writes one counted=0 capped row and leaves no running row", async () => {
    const { ask, dash } = await boot({ AI_MAX_ANSWERS_PER_USER_PER_HOUR: "1" });
    script([finalText("first")]);
    await ask();
    const second = await ask();
    expect(second.res.status).toBe(429);
    const r = rows();
    expect(r).toHaveLength(2);
    expect(r.filter((x) => x.counted === 1)).toHaveLength(1);
    expect(r.filter((x) => x.counted === 0)).toEqual([expect.objectContaining({ outcome: "capped", status: "final", dashboard_id: dash.id })]);
    expect(r.filter((x) => x.status === "running")).toHaveLength(0);
  });
});
