// Phase 142-06: generate mode on the real ask route (scripted provider only). Server-derived flag, limits, recipe, nudge, minimum, bands.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { placeGenerateBands } from "@kinetica-bi/shared";
import { createApp } from "../src/index";
import { db, createWidget } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { generateNudge, GENERATE_TOO_FEW_MESSAGE } from "../src/lib/ai/generateMode";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let provider: ScriptedProvider;

const AI_ONLY = (id: number) => ({ widgets: [{ id, type: "ai", title: "AI Assistant" }], layers: [], dynamicViews: [], filters: [] });

async function boot(opts: { env?: Record<string, string>; pending?: boolean; savedWidget?: "bar"; extraSnapshot?: boolean } = {}) {
  restoreEnv = enableAiEnv(opts.env ?? {});
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const ai = createWidget(dash.id, { title: "AI Assistant", type: "ai", position: 0, config: {} });
  if (opts.savedWidget) createWidget(dash.id, { title: "Saved", type: opts.savedWidget, position: 1, config: {} });
  if (opts.pending ?? true) db.prepare("UPDATE dashboards SET generated_by='dee', generated_pending_at=? WHERE id=?").run(Date.now(), dash.id);
  const snapshot = AI_ONLY(ai.id);
  if (opts.extraSnapshot) snapshot.widgets.push({ id: -1, type: "bar", title: "Temp" });
  const ask = async () => {
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { question: "Build a starter dashboard", snapshot })) });
    return { res, evs: await readSse(res) };
  };
  return { dash, table, ask };
}

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets");
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
const adds = (tableId: number, specs: [number, string][]) =>
  specs.map(([tempId, type]) => toolCall(`c${-tempId}`, "add_widget", addWidgetArgs(tableId, type === "bignumber" ? { tempId, type, title: `T${tempId}`, groupBy: undefined } : type === "records" ? { tempId, type, title: `T${tempId}`, metric: undefined, aggregation: undefined, groupBy: undefined } : { tempId, type, title: `T${tempId}` })));
const FIVE: [number, string][] = [[-1, "bignumber"], [-2, "bignumber"], [-3, "line"], [-4, "bar"], [-5, "records"]];
const sysText = (i = 0) => provider.requests[i].system;
const auditRow = () => db.prepare("SELECT * FROM ai_audit").get() as any;
const resultOf = (evs: { event: string; data: any }[]) => evs.find((e) => e.event === "result")?.data;

describe("generate mode on the ask route", () => {
  it("GENASK-1 success: recipe, 20 steps, server bands, kind generate", async () => {
    const { table, ask } = await boot();
    script([[...adds(table.id, FIVE), TOOLS_DONE], finalText("Built a starter dashboard.")]);
    const { evs } = await ask();
    const r = resultOf(evs);
    expect(r.ops.filter((o: any) => o.op === "add_widget")).toHaveLength(5);
    const rects = placeGenerateBands(FIVE.map(([key, type]) => ({ key, type })));
    for (const o of r.ops.filter((o: any) => o.op === "add_widget")) expect(o.layout).toEqual(rects[o.tempId]);
    expect(sysText()).toContain("Generate mode");
    expect(sysText()).toContain("Use at most 20 tool calls");
    expect(auditRow()).toMatchObject({ kind: "generate", outcome: "ok" });
  });

  it("GENASK-2 normal dashboard is unchanged", async () => {
    const { table, ask } = await boot({ pending: false });
    script([[...adds(table.id, FIVE), TOOLS_DONE], finalText("ok")]);
    const { evs } = await ask();
    expect(sysText()).not.toContain("Generate mode");
    expect(sysText()).toContain("Use at most 8 tool calls");
    expect(auditRow().kind).toBe("ask");
    const rects = placeGenerateBands(FIVE.map(([key, type]) => ({ key, type })));
    const lay = resultOf(evs).ops.filter((o: any) => o.op === "add_widget").map((o: any) => o.layout);
    expect(lay).not.toEqual(FIVE.map(([k]) => rects[k]));
  });

  it("GENASK-3 refine ask (temp widget in snapshot) is not generate", async () => {
    const { table, ask } = await boot({ extraSnapshot: true });
    script([[...adds(table.id, [[-2, "bar"]]), TOOLS_DONE], finalText("ok")]);
    await ask();
    expect(sysText()).not.toContain("Generate mode");
    expect(auditRow().kind).toBe("ask");
  });

  it("GENASK-4 saved data widget means normal mode", async () => {
    const { ask } = await boot({ savedWidget: "bar" });
    script([finalText("ok")]);
    await ask();
    expect(sysText()).not.toContain("Generate mode");
    expect(auditRow().kind).toBe("ask");
  });

  it("GENASK-5 nudge then success", async () => {
    const { table, ask } = await boot();
    script([
      [...adds(table.id, FIVE.slice(0, 2)), TOOLS_DONE],
      finalText("done"),
      [...adds(table.id, FIVE.slice(2, 4)), TOOLS_DONE],
      finalText("done now"),
    ]);
    const { evs } = await ask();
    expect(resultOf(evs).ops.filter((o: any) => o.op === "add_widget")).toHaveLength(4);
    expect(provider.requests).toHaveLength(4);
    const msgs = provider.requests[2].messages;
    expect(msgs[msgs.length - 1]).toMatchObject({ role: "user", text: generateNudge(2) });
  });

  it("GENASK-6 too few after one nudge fails cleanly", async () => {
    const { table, ask } = await boot();
    script([[...adds(table.id, FIVE.slice(0, 2)), TOOLS_DONE], finalText("a"), finalText("b")]);
    const { evs } = await ask();
    expect(evs.find((e) => e.event === "error")?.data).toEqual({ code: "AI_PROVIDER_ERROR", message: GENERATE_TOO_FEW_MESSAGE });
    expect(resultOf(evs)).toBeUndefined();
    const row = auditRow();
    expect(row).toMatchObject({ outcome: "provider_error", outcome_detail: "generate_too_few", kind: "generate" });
    expect(JSON.parse(row.changes_json).applied).toEqual([]);
  });

  it("GENASK-7 caps new widgets at 8", async () => {
    const { table, ask } = await boot();
    const ten: [number, string][] = Array.from({ length: 10 }, (_, i) => [-(i + 1), "bar"]);
    script([[...adds(table.id, ten), TOOLS_DONE], finalText("ok")]);
    const { evs } = await ask();
    const r = resultOf(evs);
    expect(r.ops.filter((o: any) => o.op === "add_widget")).toHaveLength(8);
    expect(JSON.stringify(r.skipped)).toContain("limit of 8 new widgets per answer reached");
  });

  it("GENASK-8 set_layout is dropped", async () => {
    const { table, ask } = await boot();
    script([
      [...adds(table.id, FIVE.slice(0, 4)), toolCall("sl", "set_layout", { items: [{ id: -1, x: 0, y: 0, w: 6, h: 6 }] }), TOOLS_DONE],
      finalText("ok"),
    ]);
    const { evs } = await ask();
    expect(resultOf(evs).ops.some((o: any) => o.op === "set_layout")).toBe(false);
  });

  it("GENASK-9 raised config shows the effective step count", async () => {
    const { table, ask } = await boot({ env: { AI_MAX_TOOL_STEPS: "30" } });
    script([[...adds(table.id, FIVE.slice(0, 4)), TOOLS_DONE], finalText("ok")]);
    await ask();
    expect(sysText()).toContain("Use at most 30 tool calls");
  });

  it("GENASK-10 query mode recipe mentions get_column_profile", async () => {
    const { table, ask } = await boot({ env: { AI_DATA_ACCESS: "query" } });
    script([[...adds(table.id, FIVE.slice(0, 4)), TOOLS_DONE], finalText("ok")]);
    await ask();
    expect(sysText()).toContain("get_column_profile");
  });
});
