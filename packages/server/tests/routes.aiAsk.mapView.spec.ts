// Phase 142 UAT: the ask route stamps a data-extent defaultView on every AI-added map (generate AND normal asks).
// The extent values never reach the provider or the AI audit row.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { mapViewForBounds } from "@kinetica-bi/shared";
import { createApp } from "../src/index";
import { db, createWidget } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText, addWidgetArgs } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let provider: ScriptedProvider;
let statements: string[] = [];

// distinctive values so a leak is unambiguous
const P = { minLon: -74.01234567, maxLon: -73.78765432, minLat: 40.63456789, maxLat: 40.85678912 };
const kbody = (result: unknown) => ({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }) });
const COLS = ["zone", "fare", "pickup_datetime", "pickup_longitude", "pickup_latitude"];

function kinetica(mode: "ok" | "error"): typeof fetch {
  const probes = mockKinetica({ probes: { "fleet.trips": COLS } });
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
    statements.push(stmt);
    if (stmt.includes("APPROX_PERCENTILE")) {
      if (mode === "error") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(kbody({ column_headers: ["a", "b", "c", "d"], column_1: [P.minLon], column_2: [P.maxLon], column_3: [P.minLat], column_4: [P.maxLat] })), { status: 200 });
    }
    return probes(url, init);
  }) as typeof fetch;
}

async function boot(opts: { pending?: boolean; kin?: "ok" | "error" } = {}) {
  restoreEnv = enableAiEnv({});
  forbidProviderNetwork(kinetica(opts.kin ?? "ok"));
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  const table = makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const ai = createWidget(dash.id, { title: "AI Assistant", type: "ai", position: 0, config: {} });
  if (opts.pending) db.prepare("UPDATE dashboards SET generated_by='dee', generated_pending_at=? WHERE id=?").run(Date.now(), dash.id);
  const snapshot = { widgets: [{ id: ai.id, type: "ai", title: "AI Assistant" }], layers: [], dynamicViews: [], filters: [] };
  const ask = async () => {
    const res = await realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { question: "Map the pickups", snapshot })) });
    return { res, evs: await readSse(res) };
  };
  return { table, ask };
}

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets");
  __clearLiveSchemaCacheForTest();
  statements = [];
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
const mapCall = () => toolCall("m", "add_widget", { tempId: -1, type: "map", title: "Pickups" });
const layerCall = (tableId: number) =>
  toolCall("l", "add_heatmap_layer", { tempId: -2, mapWidgetId: -1, tableId, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude" });
const resultOf = (evs: { event: string; data: any }[]) => evs.find((e) => e.event === "result")?.data;
const mapOp = (r: any) => r.ops.find((o: any) => o.op === "add_widget" && o.type === "map");
const auditRow = () => db.prepare("SELECT * FROM ai_audit").get() as any;
const VALUE_STRINGS = ["74.0123", "73.7876", "40.6345", "40.8567"];

describe("AI map default view on the ask route", () => {
  it("MAPASK-1 normal ask: AI map + heatmap layer -> defaultView from the extent; provider and audit never see it", async () => {
    const { table, ask } = await boot();
    script([[mapCall(), layerCall(table.id), TOOLS_DONE], finalText("Added a pickup map.")]);
    const { evs } = await ask();
    const r = resultOf(evs);
    expect(r).toBeDefined();
    expect(mapOp(r).config.defaultView).toEqual(mapViewForBounds(P));
    expect(statements.filter((s) => s.includes("APPROX_PERCENTILE"))).toHaveLength(1);
    expect(statements.find((s) => s.includes("APPROX_PERCENTILE"))).toMatch(/^\/\* kbi-ai:/);
    const outbound = JSON.stringify(provider.requests);
    const audit = JSON.stringify(auditRow());
    const center = mapViewForBounds(P)!.center.map((c) => String(c).slice(0, 8));
    for (const s of [...VALUE_STRINGS, ...center, "defaultView", "APPROX_PERCENTILE"]) {
      expect(outbound).not.toContain(s);
      expect(audit).not.toContain(s);
    }
  });

  it("MAPASK-2 generate mode: the banded map still gets the defaultView", async () => {
    const { table, ask } = await boot({ pending: true });
    const kpi = (tempId: number) => toolCall(`k${-tempId}`, "add_widget", addWidgetArgs(table.id, { tempId, type: "bignumber", title: `K${tempId}`, groupBy: undefined }));
    script([[kpi(-3), kpi(-4), kpi(-5), mapCall(), layerCall(table.id), TOOLS_DONE], finalText("Built it.")]);
    const { evs } = await ask();
    const m = mapOp(resultOf(evs));
    expect(m.layout).toBeDefined();
    expect(m.config.defaultView).toEqual(mapViewForBounds(P));
  });

  it("MAPASK-3 extent query fails -> no defaultView, the answer is still ok", async () => {
    const { table, ask } = await boot({ kin: "error" });
    script([[mapCall(), layerCall(table.id), TOOLS_DONE], finalText("Added a pickup map.")]);
    const { evs } = await ask();
    const r = resultOf(evs);
    expect(r).toBeDefined();
    expect(mapOp(r).config.defaultView).toBeUndefined();
    expect(evs.find((e) => e.event === "error")).toBeUndefined();
    expect(auditRow().outcome).toBe("ok");
  });

  it("MAPASK-4 a map with no AI layer runs no extent query", async () => {
    const { table, ask } = await boot();
    script([[mapCall(), TOOLS_DONE], finalText("Added a map.")]);
    const { evs } = await ask();
    expect(mapOp(resultOf(evs)).config.defaultView).toBeUndefined();
    expect(statements.some((s) => s.includes("APPROX_PERCENTILE"))).toBe(false);
  });

  it("MAPASK-5 the model cannot set defaultView itself", async () => {
    const { table, ask } = await boot();
    script([[toolCall("m", "add_widget", { tempId: -1, type: "map", title: "M", defaultView: { center: [1, 2], zoom: 3 } }), TOOLS_DONE], finalText("ok")]);
    const { evs } = await ask();
    const r = resultOf(evs);
    expect(r.ops.some((o: any) => o.op === "add_widget")).toBe(false);
  });
});
