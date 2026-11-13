// Phase 152 (VIEWAI-V22-02/03/04): the ask route enforces the Viewer AI mode on every ask. VAIASK-1..9.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { createGeneratedDashboard } from "../src/lib/aiGenerate";
import { isToolAllowedForViewerMode } from "../src/lib/viewerAi";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let base = "";
let dashId = 0;
let tableId = 0;
let dee: { cookie: string }, vic: { cookie: string }, nora: { cookie: string }, cora: { cookie: string };
let factoryCalls = 0;
let lastProvider: ScriptedProvider | null = null;

async function boot(env: Record<string, string> = {}): Promise<void> {
  restoreEnv?.();
  restoreEnv = enableAiEnv(env);
  const app = await createApp();
  const l = await listenApp(app);
  servers.push(l.server);
  base = l.base;
}
beforeEach(async () => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  factoryCalls = 0;
  lastProvider = null;
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
  await boot();
  const role = makeRole("aiviewer", ["dashboards:view", "ai:use"]);
  dashId = makeDashboard([role, "designer"]).id;
  tableId = makeTableOn(dashId).id;
  dee = sessionFor("dee", ["designer"]);
  vic = sessionFor("vic", [role]);
  nora = sessionFor("nora", [makeRole("noai", ["dashboards:view"])]);
  cora = sessionFor("cora", [makeRole("creator", ["dashboards:view", "dashboards:create", "ai:use"])]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const setMode = (id: number, m: string | null) => db.prepare("UPDATE dashboards SET viewer_ai=? WHERE id=?").run(m, id);
const script = (steps: ScriptStep[]) =>
  __setAiProviderFactoryForTest(() => {
    factoryCalls++;
    lastProvider = new ScriptedProvider(steps);
    return lastProvider;
  });
const ask = (who: { cookie: string }, id = dashId, over: Record<string, unknown> = {}) =>
  realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: who.cookie }, body: JSON.stringify(validAsk(id, over)) });
const result = async (res: Response) => {
  const evs = await readSse(res);
  const r = evs.find((e) => e.event === "result");
  if (!r) throw new Error("no result event: " + JSON.stringify(evs));
  return r.data;
};
const rows = () => db.prepare("SELECT * FROM ai_audit ORDER BY id").all() as any[];
const addW = (): ScriptStep[] => [[toolCall("a", "add_widget", addWidgetArgs(tableId)), TOOLS_DONE], finalText("Done.")];
const filterSteps = (): ScriptStep[] => [
  [toolCall("a", "add_widget", addWidgetArgs(tableId)), toolCall("b", "apply_filter", { column: "zone", value: "North", tableId }), TOOLS_DONE],
  finalText("Filtered."),
];

describe("152 Viewer AI on the ask route", () => {
  it("VAIASK-1: Off refuses with 423, no provider call, one uncounted viewer_ai_off row", async () => {
    setMode(dashId, "off");
    script(addW());
    const res = await ask(vic, dashId, { question: "Please chart this" });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: "AI is off for this dashboard.", code: "AI_VIEWER_OFF", mode: "off" });
    expect(factoryCalls).toBe(0);
    const r = rows();
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ outcome: "viewer_ai_off", outcome_detail: "viewer_ai_off", counted: 0, status: "final", steps: 0, viewer_ai: "off", kind: "ask", question: "Please chart this" });
  });

  it("VAIASK-2: Off refusals do not use up the cap", async () => {
    await boot({ AI_MAX_ANSWERS_PER_USER_PER_HOUR: "1" });
    setMode(dashId, "off");
    for (let i = 0; i < 3; i++) expect((await ask(vic)).status).toBe(423);
    setMode(dashId, "session_only");
    script([finalText("Hi.")]);
    const res = await ask(vic);
    expect(res.status).toBe(200);
    expect((await readSse(res)).some((e) => e.event === "result")).toBe(true);
  });

  it("VAIASK-3: editors are unaffected in every mode and store no mode", async () => {
    let baseline: string[] = [];
    for (const m of [null, "off", "answers_filters", "session_only"]) {
      setMode(dashId, m);
      script(addW());
      const res = await ask(dee);
      expect(res.status).toBe(200);
      const r = await result(res);
      expect(r.ops.filter((o: any) => o.op === "add_widget").length).toBe(1);
      const names = lastProvider!.requests[0].tools.map((t: any) => t.name);
      if (m === null) baseline = names;
      expect(names).toEqual(baseline);
    }
    expect(baseline).toContain("add_widget");
    expect(rows().every((x) => x.viewer_ai === null)).toBe(true);
  });

  it("VAIASK-4: answers_filters offers only read and filter tools and tells the model why", async () => {
    setMode(dashId, "session_only");
    script([finalText("ok")]);
    await result(await ask(dee));
    const full: string[] = lastProvider!.requests[0].tools.map((t: any) => t.name);
    setMode(dashId, "answers_filters");
    script([finalText("ok")]);
    await result(await ask(vic));
    const req = lastProvider!.requests[0];
    const names: string[] = req.tools.map((t: any) => t.name);
    expect(names).toEqual(full.filter((n) => isToolAllowedForViewerMode(n, "answers_filters")));
    expect(names).toContain("apply_filter");
    expect(names).not.toContain("add_widget");
    expect(req.system).toContain("This dashboard lets the AI answer questions and apply filters");
  });

  it("VAIASK-5: a change the model tries anyway is skipped and audited, filters still apply", async () => {
    setMode(dashId, "answers_filters");
    script(filterSteps());
    const r = await result(await ask(vic));
    expect(r.ops.some((o: any) => o.op === "apply_filter")).toBe(true);
    expect(r.ops.some((o: any) => o.op === "add_widget")).toBe(false);
    expect(r.skipped.some((s: any) => JSON.stringify(s.reasons) === JSON.stringify(["Viewer AI: answers and filters only"]))).toBe(true);
    const row = rows()[0];
    expect(row).toMatchObject({ outcome: "ok", viewer_ai: "answers_filters" });
    expect(JSON.parse(row.changes_json).rejected).toContainEqual({ label: "add_widget", stage: "permission", reasons: ["Viewer AI: answers and filters only"] });
  });

  it("VAIASK-6: session_only (never set) is the full AI but Keep is still refused", async () => {
    setMode(dashId, null);
    script(addW());
    const r = await result(await ask(vic));
    expect(r.ops.some((o: any) => o.op === "add_widget")).toBe(true);
    expect(rows()[0].viewer_ai).toBe("session_only");
    const keep = await realFetch(`${base}/api/dashboards/${dashId}/ai-keep`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: vic.cookie }, body: JSON.stringify({ baselineVersion: 1, dynamicViews: { add: [], remove: [] }, layers: { add: [], edit: [], remove: [] }, widgets: { add: [], edit: [], remove: [] } }) });
    expect(keep.status).toBe(403);
  });

  it("VAIASK-7: a creator on their own unkept build is never restricted", async () => {
    const gen = createGeneratedDashboard({ username: "cora", name: "Gen", tableIds: [tableId], assistant: true }).id;
    setMode(gen, "off");
    script([finalText("Built.")]);
    const res = await ask(cora, gen);
    expect(res.status).toBe(200);
    await readSse(res);
    expect(rows()[0].viewer_ai).toBeNull();
  });

  it("VAIASK-8: the mode is re-read mid-answer", async () => {
    setMode(dashId, "session_only");
    const steps: ScriptStep[] = addW();
    __setAiProviderFactoryForTest(() => {
      const inner = new ScriptedProvider(steps);
      let n = 0;
      return Object.create(inner, {
        complete: { value: (req: any, signal: AbortSignal) => { if (n++ === 0) setMode(dashId, "answers_filters"); return inner.complete(req, signal); } },
      });
    });
    const r = await result(await ask(vic));
    expect(r.ops.some((o: any) => o.op === "add_widget")).toBe(false);
    expect(r.skipped.some((s: any) => JSON.stringify(s.reasons) === JSON.stringify(["Viewer AI: answers and filters only"]))).toBe(true);
  });

  it("VAIASK-9: 403 and 404 come before the mode check", async () => {
    setMode(dashId, "off");
    expect((await ask(nora)).status).toBe(403);
    const other = makeDashboard().id;
    setMode(other, "off");
    expect((await ask(vic, other)).status).toBe(404);
  });
});
