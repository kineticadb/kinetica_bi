// Phase 136-09: route-level SSE proof of D-06 removal approvals and the strict approvals contract (the E2E6 route case).
// Scripted provider only; the global fetch is stubbed with forbidProviderNetwork so no real provider is reachable.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider } from "../src/lib/ai/providers/scripted";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp, toolCall, TOOLS_DONE, finalText } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

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

describe("POST /api/ai/ask structural (E2E6 route)", () => {
  it("E2E6-11 saved removal asks for approval; approvals.removeSaved lets it through; extra approval keys are a 400", async () => {
    restoreEnv = enableAiEnv();
    const app = await createApp();
    const { base, server } = await listenApp(app);
    servers.push(server);
    const dash = makeDashboard();
    const table = makeTableOn(dash.id);
    const user = sessionFor("dee", ["designer"]);
    const snapshot = { widgets: [{ id: 7, type: "bar", title: "Revenue", tableId: table.id }], layers: [], dynamicViews: [], filters: [] };
    const ask = (over: Record<string, unknown> = {}) =>
      realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id, { snapshot, ...over })) });
    const script = () => new ScriptedProvider([[toolCall("a", "remove_widget", { id: 7 }), TOOLS_DONE], finalText("Asked.")]);

    __setAiProviderFactoryForTest(() => script() as any);
    const r1 = (await readSse(await ask())).find((e) => e.event === "result")!.data;
    expect(r1.ops).toEqual([]);
    expect(r1.clarifications).toHaveLength(1);
    expect(r1.clarifications[0].kind).toBe("confirm_remove");

    __setAiProviderFactoryForTest(() => script() as any);
    const r2 = (await readSse(await ask({ approvals: { removeSaved: true } }))).find((e) => e.event === "result")!.data;
    expect(r2.ops).toEqual([{ op: "remove_widget", id: 7 }]);
    expect(r2.clarifications).toEqual([]);

    const bad = await ask({ approvals: { removeSaved: true, extra: 1 } });
    expect(bad.status).toBe(400);
  });
});
