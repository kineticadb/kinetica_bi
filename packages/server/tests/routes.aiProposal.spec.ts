// Phase 150 (APPROVE-V22-03): re-check + decide a held proposal.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { addDashboardGrant, removeDashboardGrant } from "../src/lib/dashboardAccessDb";
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
let dee: { cookie: string }, eve: { cookie: string }, nora: { cookie: string };

const SNAPSHOT = { widgets: [], layers: [], dynamicViews: [], filters: [] };

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
  dashId = makeDashboard().id;
  tableId = makeTableOn(dashId).id;
  dee = sessionFor("dee", ["designer"]);
  eve = sessionFor("eve", ["designer"]);
  nora = sessionFor("nora", [makeRole("noai", ["dashboards:view"])]);
  setAiPrefs("dee", { approveFirst: true }, Date.now());
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

async function propose(steps: ScriptStep[]): Promise<{ answerId: number; result: any }> {
  __setAiProviderFactoryForTest(() => new ScriptedProvider(steps));
  const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: dee.cookie }, body: JSON.stringify(validAsk(dashId, { question: "Chart", snapshot: SNAPSHOT })) });
  const result = (await readSse(res)).find((e) => e.event === "result")!.data;
  return { answerId: result.answerId, result };
}
const twoBars = (): ScriptStep[] => [
  [toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1, title: "A" })), toolCall("b", "add_widget", addWidgetArgs(tableId, { tempId: -2, title: "B" })), TOOLS_DONE],
  finalText("Two charts."),
];
const apply = (id: number | string, body: unknown, who: { cookie: string } | null = dee) =>
  realFetch(`${base}/api/ai/proposals/${id}/apply`, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { Cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
const reject = (id: number | string, who: { cookie: string } | null = dee) =>
  realFetch(`${base}/api/ai/proposals/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { Cookie: who.cookie } : {}) }, body: "{}" });
const rowOf = (id: number) => db.prepare("SELECT outcome, outcome_detail, changes_json FROM ai_audit WHERE id=?").get(id) as { outcome: string; outcome_detail: string | null; changes_json: string };
const sel = (selected: number[]) => ({ selected, snapshot: SNAPSHOT });

describe("apply", () => {
  it("APPRROUTE-1: apply all -> applied, re-stamped ops, row decided, proposal dropped", async () => {
    const { answerId, result } = await propose(twoBars());
    expect(result.ops).toHaveLength(2);
    const r = await apply(answerId, sel([0, 1]));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ outcome: "applied", acceptedIndexes: [0, 1], failed: [], unticked: [] });
    expect(b.applied).toHaveLength(2);
    expect(b.accepted.map((o: any) => o.op)).toEqual(["add_widget", "add_widget"]);
    for (const o of b.accepted) expect(o.layout).toBeDefined();
    const row = rowOf(answerId);
    expect(row.outcome).toBe("applied");
    expect(row.outcome_detail).toBeNull();
    expect(getProposal(answerId, "dee")).toBeUndefined();
  });

  it("APPRROUTE-2: partial selection -> partly_applied with the unticked label", async () => {
    const { answerId } = await propose(twoBars());
    const labels = JSON.parse(rowOf(answerId).changes_json).proposed as string[];
    const r = await apply(answerId, sel([1]));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ outcome: "partly_applied", acceptedIndexes: [1], unticked: [labels[0]] });
    const row = rowOf(answerId);
    expect(row.outcome).toBe("partly_applied");
    expect(JSON.parse(row.changes_json).unticked).toEqual([labels[0]]);
  });

  it("APPRROUTE-3: stale column -> outcome none, nothing decided, still held, reject still works", async () => {
    const { answerId } = await propose([[toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1, metric: "fare" })), TOOLS_DONE], finalText("One.")]);
    forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone"] } }));
    __clearLiveSchemaCacheForTest();
    const r = await apply(answerId, sel([0]));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ outcome: "none", accepted: [] });
    expect(b.failed).toHaveLength(1);
    expect(b.failed[0]).toMatchObject({ index: 0, stage: "live_schema" });
    expect(b.failed[0].reasons.join(" ")).toContain("fare");
    expect(rowOf(answerId)).toMatchObject({ outcome: "not_decided", outcome_detail: "proposed" });
    expect(getProposal(answerId, "dee")).toBeDefined();
    const rj = await reject(answerId);
    expect(rj.status).toBe(200);
    expect(await rj.json()).toEqual({ outcome: "rejected" });
  });

  it("APPRROUTE-4: a selection that is not dependency-closed or malformed is a 400, nothing decided", async () => {
    const { answerId } = await propose([
      [toolCall("a", "add_widget", addWidgetArgs(tableId, { tempId: -1 })), toolCall("b", "rename_widget", { id: -1, title: "Renamed" }), TOOLS_DONE],
      finalText("Added and renamed."),
    ]);
    expect(JSON.parse(rowOf(answerId).changes_json).proposed).toHaveLength(2);
    for (const s of [[1], [5]]) {
      const r = await apply(answerId, sel(s));
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("AI_PROPOSAL_BAD_SELECTION");
    }
    for (const body of [sel([]), { ...sel([0]), extra: 1 }]) {
      const r = await apply(answerId, body);
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("AI_PROPOSAL_BAD_REQUEST");
    }
    const bad = await apply("abc", sel([0]));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("AI_PROPOSAL_BAD_REQUEST");
    expect(rowOf(answerId)).toMatchObject({ outcome: "not_decided", outcome_detail: "proposed" });
  });

  it("APPRROUTE-5: a decided proposal cannot be decided again", async () => {
    const { answerId } = await propose(twoBars());
    expect((await apply(answerId, sel([0, 1]))).status).toBe(200);
    const again = await apply(answerId, sel([0, 1]));
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("AI_PROPOSAL_DECIDED");
    const rj = await reject(answerId);
    expect(rj.status).toBe(409);
    expect((await rj.json()).code).toBe("AI_PROPOSAL_DECIDED");
  });

  it("APPRROUTE-6: held proposal gone (restart) -> apply 410, reject still decides the row", async () => {
    const { answerId } = await propose(twoBars());
    __resetProposalsForTest();
    const r = await apply(answerId, sel([0, 1]));
    expect(r.status).toBe(410);
    expect((await r.json()).code).toBe("AI_PROPOSAL_GONE");
    const rj = await reject(answerId);
    expect(rj.status).toBe(200);
    expect(await rj.json()).toEqual({ outcome: "rejected" });
    expect(rowOf(answerId).outcome).toBe("rejected");
  });

  it("APPRROUTE-7: another user's id looks exactly like an unknown id", async () => {
    const { answerId } = await propose(twoBars());
    const a = await apply(answerId, sel([0, 1]), eve);
    const unknown = await apply(999999, sel([0, 1]), eve);
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(await unknown.json());
    const rj = await reject(answerId, eve);
    expect(rj.status).toBe(404);
    expect((await rj.json()).code).toBe("AI_PROPOSAL_NOT_FOUND");
    expect(rowOf(answerId)).toMatchObject({ outcome: "not_decided", outcome_detail: "proposed" });
  });

  it("APPRROUTE-8: 401 without a session, 403 without ai:use on both routes", async () => {
    const { answerId } = await propose(twoBars());
    expect((await apply(answerId, sel([0]), null)).status).toBe(401);
    expect((await reject(answerId, null)).status).toBe(401);
    for (const r of [await apply(answerId, sel([0]), nora), await reject(answerId, nora)]) {
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
    }
  });

  it("APPRROUTE-10: apply 404s once the user can no longer view the dashboard", async () => {
    const role = makeRole("viewers", ["dashboards:view", "ai:use"]);
    const dash = makeDashboard([role]);
    const t = makeTableOn(dash.id, "fleet", "trips2");
    const ann = sessionFor("ann", [role]);
    setAiPrefs("ann", { approveFirst: true }, Date.now());
    forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"], "fleet.trips2": ["zone", "fare"] } }));
    __setAiProviderFactoryForTest(() => new ScriptedProvider([[toolCall("a", "add_widget", addWidgetArgs(t.id, { tempId: -1 })), TOOLS_DONE], finalText("One.")]));
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: ann.cookie }, body: JSON.stringify(validAsk(dash.id, { snapshot: SNAPSHOT })) });
    const answerId = (await readSse(res)).find((e) => e.event === "result")!.data.answerId;
    removeDashboardGrant(dash.id, "role", role);
    addDashboardGrant(dash.id, "role", makeRole("others", ["dashboards:view"]));
    const r = await apply(answerId, sel([0]), ann);
    expect(r.status).toBe(404);
    expect(rowOf(answerId).outcome).toBe("not_decided");
  });

  it("APPRROUTE-11: with AI disabled apply is 503 but reject still works", async () => {
    const { answerId } = await propose(twoBars());
    restoreEnv?.();
    restoreEnv = null;
    for (const s of servers) s.close();
    servers = [];
    const app = await createApp();
    const l = await listenApp(app);
    servers.push(l.server);
    base = l.base;
    const r = await apply(answerId, sel([0, 1]));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("AI_NOT_CONFIGURED");
    expect((await reject(answerId)).status).toBe(200);
  });
});

describe("reject", () => {
  it("APPRROUTE-9: reject records the decision and drops the proposal", async () => {
    const { answerId } = await propose(twoBars());
    const labels = JSON.parse(rowOf(answerId).changes_json).proposed as string[];
    const r = await reject(answerId);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ outcome: "rejected" });
    const row = rowOf(answerId);
    expect(row.outcome).toBe("rejected");
    expect(JSON.parse(row.changes_json)).toMatchObject({ applied: [], unticked: [], proposed: labels });
    expect(getProposal(answerId, "dee")).toBeUndefined();
  });
});
