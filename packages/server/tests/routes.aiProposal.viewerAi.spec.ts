// Phase 152 (VIEWAI-V22-02/04): Apply re-checks against the CURRENT Viewer AI mode; Off refuses the whole Apply.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { setAiPrefs } from "../src/lib/aiFeedback";
import { getProposal, __resetProposalsForTest } from "../src/lib/aiProposals";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let base = "";
let dashId = 0;
let tableId = 0;
let dee: { cookie: string }, vic: { cookie: string };

const SNAPSHOT = { widgets: [], layers: [], dynamicViews: [], filters: [] };
const AF = "Viewer AI: answers and filters only";

beforeEach(async () => {
  resetAiTables();
  __resetProposalsForTest();
  __clearLiveSchemaCacheForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
  restoreEnv = enableAiEnv();
  const app = await createApp();
  const l = await listenApp(app);
  servers.push(l.server);
  base = l.base;
  const role = makeRole("aiviewer", ["dashboards:view", "ai:use"]);
  dashId = makeDashboard([role]).id;
  tableId = makeTableOn(dashId).id;
  dee = sessionFor("dee", ["designer"]);
  vic = sessionFor("vic", [role]);
  setAiPrefs("dee", { approveFirst: true }, Date.now());
  setAiPrefs("vic", { approveFirst: true }, Date.now());
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const setMode = (m: string | null) => db.prepare("UPDATE dashboards SET viewer_ai=? WHERE id=?").run(m, dashId);
async function propose(steps: ScriptStep[], who = vic): Promise<number> {
  __setAiProviderFactoryForTest(() => new ScriptedProvider(steps));
  const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: who.cookie }, body: JSON.stringify(validAsk(dashId, { question: "Chart", snapshot: SNAPSHOT })) });
  return (await readSse(res)).find((e) => e.event === "result")!.data.answerId;
}
const widgetPlusFilter = (): ScriptStep[] => [
  [toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1, title: "A" })), toolCall("f", "apply_filter", { tableId, column: "zone", operator: "eq", value: "Queens" }), TOOLS_DONE],
  finalText("Done."),
];
const twoBars = (): ScriptStep[] => [
  [toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1, title: "A" })), toolCall("b", "add_widget", addWidgetArgs(tableId, { tempId: -2, title: "B" })), TOOLS_DONE],
  finalText("Two charts."),
];
const post = (id: number, kind: "apply" | "reject", body: unknown, who = vic) =>
  realFetch(`${base}/api/ai/proposals/${id}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: who.cookie }, body: JSON.stringify(body) });
const sel = (selected: number[]) => ({ selected, snapshot: SNAPSHOT });
const rowOf = (id: number) => db.prepare("SELECT outcome, outcome_detail FROM ai_audit WHERE id=?").get(id) as { outcome: string; outcome_detail: string | null };

describe("Viewer AI on Apply (152)", () => {
  it("VAIAPPLY-1: mode flips to answers_filters after the proposal -> filter applies, widget fails (partly_applied)", async () => {
    const id = await propose(widgetPlusFilter());
    const ops = (getProposal(id, "vic")!).ops;
    const filterIdx = ops.findIndex((o) => o.op === "apply_filter");
    const widgetIdx = ops.findIndex((o) => o.op === "add_widget");
    setMode("answers_filters");
    const r = await post(id, "apply", sel([0, 1]));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.outcome).toBe("partly_applied");
    expect(b.accepted.map((o: any) => o.op)).toEqual(["apply_filter"]);
    expect(b.failed).toHaveLength(1);
    expect(b.failed[0]).toMatchObject({ index: widgetIdx, stage: "permission", reasons: [AF] });
    expect(b.acceptedIndexes).toEqual([filterIdx]);
    expect(rowOf(id).outcome).toBe("partly_applied");
  });

  it("VAIAPPLY-2: answers_filters and only the widget ticked -> outcome none with the mode reason", async () => {
    const id = await propose(widgetPlusFilter());
    const widgetIdx = getProposal(id, "vic")!.ops.findIndex((o) => o.op === "add_widget");
    setMode("answers_filters");
    const r = await post(id, "apply", sel([widgetIdx]));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.outcome).toBe("none");
    expect(b.failed[0].reasons).toEqual([AF]);
  });

  it("VAIAPPLY-3: mode flips to off -> Apply is 423 AI_VIEWER_OFF and the proposal stays undecided", async () => {
    const id = await propose(widgetPlusFilter());
    const before = rowOf(id);
    setMode("off");
    const r = await post(id, "apply", sel([0, 1]));
    expect(r.status).toBe(423);
    expect(await r.json()).toEqual({ error: "AI is off for this dashboard.", code: "AI_VIEWER_OFF", mode: "off" });
    expect(getProposal(id, "vic")).toBeDefined();
    expect(rowOf(id)).toEqual(before);
    expect(["applied", "partly_applied", "rejected"]).not.toContain(rowOf(id).outcome);
  });

  it("VAIAPPLY-4: after the Off refusal Reject still works", async () => {
    const id = await propose(twoBars());
    setMode("off");
    expect((await post(id, "apply", sel([0, 1]))).status).toBe(423);
    const rj = await post(id, "reject", {});
    expect(rj.status).toBe(200);
    expect(await rj.json()).toEqual({ outcome: "rejected" });
  });

  it("VAIAPPLY-5: an editor on an off dashboard applies everything", async () => {
    setMode("off");
    const id = await propose(twoBars(), dee);
    const r = await post(id, "apply", sel([0, 1]), dee);
    expect(r.status).toBe(200);
    expect((await r.json()).outcome).toBe("applied");
  });
});
