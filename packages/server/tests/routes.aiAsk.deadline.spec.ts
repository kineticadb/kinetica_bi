// 137-02 W1: the hard deadline always releases the per-user AI lock; Cancel/deadline cancel tagged Kinetica jobs.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { ScriptedProvider } from "../src/lib/ai/providers/scripted";
import { AI_USER_MESSAGES } from "../src/lib/ai/agentLoop";
import { __setAiHeartbeatMsForTest, __setAiGraceMsForTest } from "../src/aiRoutes";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import {
  enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables, mockKinetica, validAsk, readSse, listenApp,
  finalText, customProvider, pollUntil,
} from "./helpers/aiRouteKit";

const cancelSpy = vi.hoisted(() => vi.fn(async () => ({ cancelled: [] as unknown[] })));
vi.mock("../src/lib/kineticaJobs", async (orig) => ({ ...(await orig<typeof import("../src/lib/kineticaJobs")>()), cancelKineticaJobsByTag: cancelSpy }));

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

async function boot() {
  restoreEnv = enableAiEnv({ AI_TIMEOUT_MS: "1000" });
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const ask = (signal?: AbortSignal) =>
    realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: user.cookie }, body: JSON.stringify(validAsk(dash.id)), signal });
  return { ask };
}

beforeEach(() => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  cancelSpy.mockClear();
  __setAiGraceMsForTest(50);
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  __setAiHeartbeatMsForTest(null);
  __setAiGraceMsForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const use = (p: { complete: any }) => __setAiProviderFactoryForTest(() => p as any);
const auditRows = () => db.prepare("SELECT * FROM ai_audit").all() as any[];
// a provider that never yields and ignores abort
const stuck = () => customProvider(async function* () { await new Promise<void>(() => {}); });

describe("AI ask hard deadline (W1)", () => {
  it("W1-1 a never-settling provider is cut at the deadline: one AI_TIMEOUT error, lock released", async () => {
    const { ask } = await boot();
    use(stuck());
    const t0 = Date.now();
    const evs = await readSse(await ask());
    expect(Date.now() - t0).toBeLessThan(2500);
    const errs = evs.filter((e) => e.event === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].data).toEqual({ code: "AI_TIMEOUT", message: AI_USER_MESSAGES.timeout });
    use(new ScriptedProvider([finalText("ok")]));
    const second = await ask();
    expect(second.status).toBe(200);
    await readSse(second);
  });

  it("W1-2 exactly one audit row for the timed-out answer", async () => {
    const { ask } = await boot();
    use(stuck());
    await readSse(await ask());
    await new Promise((r) => setTimeout(r, 100));
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("provider_error");
    expect(rows[0].outcome_detail).toBe("timeout");
  });

  it("W1-3 a never-settling Kinetica probe also releases the lock at the deadline", async () => {
    const { ask } = await boot();
    forbidProviderNetwork(() => new Promise<Response>(() => {}));
    use(new ScriptedProvider([finalText("never")]));
    const evs = await readSse(await ask());
    expect(evs.filter((e) => e.event === "error").map((e) => e.data.code)).toEqual(["AI_TIMEOUT"]);
    forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone"] } }));
    use(new ScriptedProvider([finalText("ok")]));
    expect((await ask()).status).toBe(200);
  });

  it("W1-4 closing the connection cancels the answer's tagged Kinetica jobs once and frees the lock", async () => {
    const { ask } = await boot();
    const hang = customProvider(async function* (signal) {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      yield { type: "error", kind: "aborted" };
    });
    use(hang);
    const ctl = new AbortController();
    const res = await ask(ctl.signal);
    const reader = res.body!.getReader();
    let seen = "";
    while (!seen.includes("event: status")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    ctl.abort();
    expect(await pollUntil(() => cancelSpy.mock.calls.length > 0)).toBe(true);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    const [, tag] = cancelSpy.mock.calls[0] as unknown as [unknown, string];
    expect(tag).toMatch(/^[0-9a-f-]{36}$/);
    expect(await pollUntil(() => auditRows().some((r) => r.status === "final"))).toBe(true);
    use(new ScriptedProvider([finalText("ok")]));
    expect((await ask()).status).toBe(200);
  });
});
