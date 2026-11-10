// Phase 150 (APPROVE-V22-02): propose instead of apply when "Approve changes first" is on.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db, createWidget } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { setAiPrefs } from "../src/lib/aiFeedback";
import { getProposal, PROPOSE_SYSTEM_PART, __resetProposalsForTest } from "../src/lib/aiProposals";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let provider: ScriptedProvider;

async function boot(opts: { pending?: boolean; asker?: string } = {}) {
  restoreEnv = enableAiEnv();
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const user = sessionFor(opts.asker ?? "dee", ["designer"]);
  let snapshot: Record<string, unknown> = { widgets: [], layers: [], dynamicViews: [], filters: [] };
  if (opts.pending) {
    const ai = createWidget(dash.id, { title: "AI Assistant", type: "ai", position: 0, config: {} });
    db.prepare("UPDATE dashboards SET generated_by='dee', generated_pending_at=? WHERE id=?").run(Date.now(), dash.id);
    snapshot = { widgets: [{ id: ai.id, type: "ai", title: "AI Assistant" }], layers: [], dynamicViews: [], filters: [] };
  }
  const ask = async () => {
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { question: "Chart the fares", snapshot })) });
    return { res, evs: await readSse(res) };
  };
  return { dash, table, ask };
}

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets");
  __resetProposalsForTest();
  __clearLiveSchemaCacheForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare", "pickup_datetime"] } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const script = (steps: ScriptStep[]) => {
  provider = new ScriptedProvider(steps);
  __setAiProviderFactoryForTest(() => provider);
};
const auditRow = () => db.prepare("SELECT * FROM ai_audit").get() as any;
const resultOf = (evs: { event: string; data: any }[]) => evs.find((e) => e.event === "result")!.data;
const oneBar = (tableId: number): ScriptStep[] => [[toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1 })), TOOLS_DONE], finalText("Here is your chart.")];

describe("propose mode on the ask route", () => {
  it("APPRASK-1: switch on -> proposed result, not_decided row, held op", async () => {
    const { table, ask } = await boot();
    // OFF run first: learn the label the gateway reports in `applied`
    script(oneBar(table.id));
    const off = resultOf((await ask()).evs);
    expect(off.applied).toHaveLength(1);
    db.exec("DELETE FROM ai_audit");

    setAiPrefs("dee", { approveFirst: true }, Date.now());
    script(oneBar(table.id));
    const r = resultOf((await ask()).evs);
    expect(r.proposed).toBe(true);
    expect(r.applied).toEqual([]);
    expect(r.ops).toHaveLength(1);
    const row = auditRow();
    expect(row).toMatchObject({ status: "final", outcome: "not_decided", outcome_detail: "proposed" });
    expect(JSON.parse(row.changes_json)).toEqual({ applied: [], rejected: [], proposed: off.applied });
    expect(getProposal(r.answerId, "dee")?.ops).toHaveLength(1);
  });

  it("APPRASK-1b: the done event reports not_decided", async () => {
    const { table, ask } = await boot();
    setAiPrefs("dee", { approveFirst: true }, Date.now());
    script(oneBar(table.id));
    const { evs } = await ask();
    expect(evs.find((e) => e.event === "done")!.data.outcome).toBe("not_decided");
  });

  for (const explicit of [false, true]) {
    it(`APPRASK-2: switch off (${explicit ? "explicit row" : "no prefs row"}) is exactly today's result and audit shape`, async () => {
      const { table, ask } = await boot();
      if (explicit) setAiPrefs("dee", { approveFirst: false }, Date.now());
      script(oneBar(table.id));
      const r = resultOf((await ask()).evs);
      expect(Object.keys(r).sort()).toEqual(["answerId", "applied", "clarifications", "followUps", "ops", "skipped", "text"]);
      expect(r.applied).toHaveLength(1);
      const row = auditRow();
      expect(row.outcome).toBe("ok");
      expect(row.outcome_detail).toBeNull();
      expect(Object.keys(JSON.parse(row.changes_json)).sort()).toEqual(["applied", "rejected"]);
      expect(JSON.stringify(provider.requests)).not.toContain(PROPOSE_SYSTEM_PART.slice(0, 60));
    });
  }

  it("APPRASK-3: switch on -> the propose system part reaches the provider", async () => {
    const { table, ask } = await boot();
    setAiPrefs("dee", { approveFirst: true }, Date.now());
    script(oneBar(table.id));
    await ask();
    expect(JSON.stringify(provider.requests[0])).toContain(PROPOSE_SYSTEM_PART.slice(0, 60));
  });

  it("APPRASK-4: switch on, 0 ops -> not a proposal", async () => {
    const { ask } = await boot();
    setAiPrefs("dee", { approveFirst: true }, Date.now());
    script([finalText("Nothing to change.")]);
    const r = resultOf((await ask()).evs);
    expect("proposed" in r).toBe(false);
    expect(auditRow().outcome).toBe("ok");
  });

  it("APPRASK-5: switch on, generate mode -> never a proposal", async () => {
    const { table, ask } = await boot({ pending: true });
    setAiPrefs("dee", { approveFirst: true }, Date.now());
    const specs: [number, string][] = [[-1, "bignumber"], [-2, "bignumber"], [-3, "line"], [-4, "bar"], [-5, "records"]];
    const adds = specs.map(([tempId, type]) =>
      toolCall(`c${-tempId}`, "add_widget", addWidgetArgs(table.id, type === "bignumber" ? { tempId, type, title: `T${tempId}`, groupBy: undefined } : type === "records" ? { tempId, type, title: `T${tempId}`, metric: undefined, aggregation: undefined, groupBy: undefined } : { tempId, type, title: `T${tempId}` })),
    );
    script([[...adds, TOOLS_DONE], finalText("Built a starter dashboard.")]);
    const r = resultOf((await ask()).evs);
    expect("proposed" in r).toBe(false);
    expect(auditRow()).toMatchObject({ kind: "generate", outcome: "ok" });
  });

  it("APPRASK-6: the switch is per user (eve on, dee asks -> applies as today)", async () => {
    const { table, ask } = await boot();
    setAiPrefs("eve", { approveFirst: true }, Date.now());
    script(oneBar(table.id));
    const r = resultOf((await ask()).evs);
    expect("proposed" in r).toBe(false);
    expect(r.applied).toHaveLength(1);
  });
});
