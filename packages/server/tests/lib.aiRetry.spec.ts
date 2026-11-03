// Phase 135-04: D-14 provider retry budget. Injected sleep, no fake timers.
import { describe, expect, it } from "vitest";
import { createRetryBudget, defaultSleep, withProviderRetry } from "../src/lib/ai/retry";
import type { LlmEvent, LlmProvider } from "../src/lib/ai/provider";
import { buildOutboundRequest, part } from "../src/lib/ai/outbound";

const req = buildOutboundRequest({ system: [part.system("s")], messages: [{ role: "user", parts: [part.user("q")] }], tools: [], dataAccess: "schema" });
const scripted = (attempts: LlmEvent[][]): LlmProvider & { calls: number } => {
  const p = {
    id: "scripted",
    model: "m",
    calls: 0,
    capabilities: { nativeTools: true, parallelTools: false, streaming: true, usageInStream: false, forcedToolChoice: false, opaqueReplay: false },
    async *complete() {
      const evs = attempts[Math.min(p.calls, attempts.length - 1)];
      p.calls++;
      for (const e of evs) yield e;
    },
  };
  return p as unknown as LlmProvider & { calls: number };
};
const rl = (ms?: number): LlmEvent => ({ type: "error", kind: "rate_limited", status: 429, ...(ms !== undefined ? { retryAfterMs: ms } : {}) });
const ok: LlmEvent[] = [{ type: "text_delta", text: "hi" }, { type: "done", finish: "stop" }];
const harness = (budget = createRetryBudget()) => {
  const sleeps: number[] = [];
  const waits: number[] = [];
  return {
    sleeps,
    waits,
    budget,
    deps: { budget, sleep: async (ms: number) => void sleeps.push(ms), onWait: (s: number) => void waits.push(s) },
  };
};
async function drain(it: AsyncIterable<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const sig = () => new AbortController().signal;

describe("RTY provider retry budget", () => {
  it("RTY-1 waits on 429 then yields only the successful attempt", async () => {
    const h = harness();
    const p = scripted([[{ type: "text_delta", text: "partial" }, rl(2000)], ok]);
    expect(await drain(withProviderRetry(p, req, sig(), h.deps))).toEqual(ok);
    expect(h.sleeps).toEqual([2000]);
    expect(h.waits).toEqual([2]);
  });

  it("RTY-2 delay beyond budget fails immediately", async () => {
    const h = harness();
    const ev = await drain(withProviderRetry(scripted([[rl(25000)], ok]), req, sig(), h.deps));
    expect(ev).toEqual([rl(25000)]);
    expect(h.sleeps).toEqual([]);
  });

  it("RTY-3 budget is cumulative across calls", async () => {
    const h = harness();
    await drain(withProviderRetry(scripted([[rl(12000)], ok]), req, sig(), h.deps));
    const ev = await drain(withProviderRetry(scripted([[rl(9000)], ok]), req, sig(), h.deps));
    expect(ev).toEqual([rl(9000)]);
    expect(h.sleeps).toEqual([12000]);
  });

  it("RTY-4 missing retryAfterMs uses exponential fallback, max 3 retries", async () => {
    const h = harness(createRetryBudget(1_000_000));
    const p = scripted([[rl()]]);
    const ev = await drain(withProviderRetry(p, req, sig(), h.deps));
    expect(h.sleeps).toEqual([2000, 4000, 8000]);
    expect(p.calls).toBe(4);
    expect(ev).toEqual([rl()]);
  });

  it("RTY-5 overloaded gets exactly one quick retry", async () => {
    const h = harness();
    const ov: LlmEvent = { type: "error", kind: "overloaded", status: 503 };
    expect(await drain(withProviderRetry(scripted([[ov], ok]), req, sig(), h.deps))).toEqual(ok);
    expect(h.sleeps).toEqual([1500]);
    const h2 = harness();
    const p2 = scripted([[ov]]);
    expect(await drain(withProviderRetry(p2, req, sig(), h2.deps))).toEqual([ov]);
    expect(h2.sleeps).toEqual([1500]);
    expect(p2.calls).toBe(2);
  });

  it("RTY-6 auth / bad_request / protocol are never retried", async () => {
    for (const kind of ["auth", "bad_request", "protocol"] as const) {
      const h = harness();
      const e: LlmEvent = { type: "error", kind };
      const p = scripted([[e], ok]);
      expect(await drain(withProviderRetry(p, req, sig(), h.deps))).toEqual([e]);
      expect(p.calls).toBe(1);
      expect(h.sleeps).toEqual([]);
    }
  });

  it("RTY-7 abort during sleep ends with AbortError; defaultSleep settles promptly on abort", async () => {
    const h = harness();
    const deps = { ...h.deps, sleep: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; } };
    await expect(drain(withProviderRetry(scripted([[rl(1000)], ok]), req, sig(), deps))).rejects.toMatchObject({ name: "AbortError" });
    const ac = new AbortController();
    const t0 = Date.now();
    const p = defaultSleep(10_000, ac.signal);
    await Promise.resolve();
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - t0).toBeLessThan(1000);
    const pre = new AbortController();
    pre.abort();
    await expect(defaultSleep(10_000, pre.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("RTY-8 text then error is retried from scratch; consumer never sees the first attempt", async () => {
    const h = harness();
    const p = scripted([[{ type: "text_delta", text: "LEAKY-PARTIAL" }, rl(1000)], ok]);
    const ev = await drain(withProviderRetry(p, req, sig(), h.deps));
    expect(JSON.stringify(ev)).not.toContain("LEAKY-PARTIAL");
    expect(ev).toEqual(ok);
  });
});
