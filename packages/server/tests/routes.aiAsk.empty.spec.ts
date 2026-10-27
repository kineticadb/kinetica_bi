// 142 UAT (Ollama): a reply with no text, no changes, no choices and nothing skipped is a retryable error, not "Answered".
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { EMPTY_ANSWER_MESSAGE } from "../src/lib/ai/runAnswer";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

async function boot() {
  restoreEnv = enableAiEnv({});
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const ask = async () => {
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { question: "Chart the fares" })) });
    return readSse(res);
  };
  return { table, ask };
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

describe("EMPTYANS: an empty reply is not an answer", () => {
  for (const [name, text] of [["no text", ""], ["whitespace only", "  \n\n "], ["follow-ups only", "Follow-ups:\n- Show fares by zone\n- Add a map"]] as const) {
    it(`EMPTYANS-1 ${name}: retryable provider error, audit provider_error/empty_answer`, async () => {
      const { ask } = await boot();
      script([finalText(text)]);
      const evs = await ask();
      expect(evs.find((e) => e.event === "result")).toBeUndefined();
      expect(evs.find((e) => e.event === "error")?.data).toEqual({ code: "AI_PROVIDER_ERROR", message: EMPTY_ANSWER_MESSAGE });
      const [row] = rows();
      expect(row).toMatchObject({ status: "final", outcome: "provider_error", outcome_detail: "empty_answer", answer_text: "" });
    });
  }

  it("EMPTYANS-2 no text but a change was applied: still a normal result", async () => {
    const { ask, table } = await boot();
    script([[toolCall("a", "add_widget", addWidgetArgs(table.id, { tempId: -1 })), TOOLS_DONE], finalText("")]);
    const evs = await ask();
    expect(evs.find((e) => e.event === "error")).toBeUndefined();
    expect(evs.find((e) => e.event === "result")?.data.ops).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ outcome: "ok" });
  });

  it("EMPTYANS-3 no text but a call was skipped: still a normal result (the skip is the answer)", async () => {
    const { ask } = await boot();
    script([[toolCall("a", "add_widget", { type: "bar" }), TOOLS_DONE], finalText("")]);
    const evs = await ask();
    expect(evs.find((e) => e.event === "result")?.data.skipped.length).toBeGreaterThan(0);
    expect(rows()[0]).toMatchObject({ outcome: "ok" });
  });
});
