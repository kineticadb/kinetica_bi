/**
 * spike.s6-toolcall.spec.ts - Phase 135 Plan 12, S6 code half.
 * Pure metric/pacing/sanitiser logic only. The live run (src/spikes/toolCallSpike.ts) is operator-run; no network here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  aggregateSpikeRuns,
  formatMatrixRow,
  createPacer,
  sanitizeRecording,
  MATRIX_HEADER,
  type SpikeAggregate,
  type SpikeRun,
} from "../src/spikes/toolCallSpikeMetrics";
import { forbidProviderNetwork, KEY_SENTINEL } from "./helpers/aiTestKit";

const good = { known: true, jsonOk: true, zodOk: true, gatewayOk: true };
const run = (o: Partial<SpikeRun> & { calls: SpikeRun["calls"] }): SpikeRun => ({
  scenario: 1,
  expect: ["list_tables"],
  text: "",
  finish: "tool_calls",
  latencyMs: 100,
  rateLimited: 0,
  ...o,
});

describe("S6-1 aggregateSpikeRuns", () => {
  const runs: SpikeRun[] = [
    run({ calls: [{ name: "list_tables", ...good }], latencyMs: 100, indexPresent: true, idPresent: true }),
    run({ calls: [{ name: "list_tables", ...good }, { name: "describe_table", ...good }], latencyMs: 300, expect: ["describe_table", "list_tables"] }),
    run({ calls: [{ name: "add_widget", ...good, zodOk: false }], latencyMs: 200, expect: ["add_widget"], repairAttempted: true, repairOk: true, extraContentSeen: true }),
    run({ calls: [{ name: "bogus_tool", ...good, known: false }], latencyMs: 400 }),
    run({ calls: [], text: "hello", finish: "stop", latencyMs: 500 }),
    run({ calls: [], text: "a bar chart shows...", finish: "stop", expect: "none", latencyMs: 600 }),
    run({ scenario: 6, calls: [{ name: "list_tables", ...good }], latencyMs: 700, secondTurnOk: true, rateLimited: 2, retryAfterHeader: true, retryDelayMs: 34_000 }),
    run({ calls: [{ name: "list_tables", ...good }], latencyMs: 800, rateLimited: 1, retryDelayMs: 5_000, indexPresent: false }),
  ];
  const a = aggregateSpikeRuns(runs);

  it("per-call validity and malformed rate (unknown tool names are wrong-tool, not malformed)", () => {
    expect(a.trials).toBe(8);
    expect(a.calls).toBe(7);
    expect(a.validCallPct).toBe(71.4); // 5 of 7
    expect(a.malformedPct).toBe(14.3); // 1 of 7 (zod-invalid add_widget)
  });
  it("wrong-tool, text-instead-of-tool, parallel rates", () => {
    expect(a.wrongToolPct).toBe(12.5); // bogus_tool in 1 of 8 runs
    expect(a.textInsteadOfToolPct).toBe(14.3); // 1 of 7 tool-expected runs; the 'none' run does not count
    expect(a.parallelPct).toBe(16.7); // 1 of 6 runs that made calls
  });
  it("repair, second turn, latency, finish distribution", () => {
    expect(a.repairAttempted).toBe(1);
    expect(a.repairOk).toBe(1);
    expect(a.repairSuccessPct).toBe(100);
    expect(a.secondTurnRuns).toBe(1);
    expect(a.secondTurnOk).toBe(1);
    expect(a.latencyP50Ms).toBe(400);
    expect(a.latencyP95Ms).toBe(800);
    expect(a.finishReasons).toEqual({ tool_calls: 6, stop: 2 });
  });
  it("wire observations and 429 stats", () => {
    expect(a.indexPresent).toBe("no"); // one run reported it missing
    expect(a.idPresent).toBe("yes");
    expect(a.extraContentSeen).toBe(true);
    expect(a.rateLimit).toEqual({ count: 3, retryAfterHeaderCount: 1, maxRetryDelayMs: 34_000, over20sCount: 1 });
  });
  it("empty input does not throw and reports nulls / n/a", () => {
    const e = aggregateSpikeRuns([]);
    expect(e.trials).toBe(0);
    expect(e.latencyP50Ms).toBeNull();
    expect(e.repairSuccessPct).toBeNull();
    expect(e.indexPresent).toBe("n/a");
  });
});

describe("S6-2 formatMatrixRow", () => {
  const mk = (n: number, over: Partial<SpikeRun> = {}): SpikeRun[] =>
    Array.from({ length: n }, (_, i) =>
      run({ calls: [{ name: "list_tables", ...good }], scenario: i === 0 ? 6 : 1, ...(i === 0 ? { secondTurnOk: true } : {}), ...over }),
    );
  const row = (agg: SpikeAggregate) => formatMatrixRow({ provider: "gemini", model: "m-1", date: "2026-10-12", stream: "true", agg });
  const cells = (s: string) => s.split("|").slice(1, -1).map((c) => c.trim());

  it("emits the header's 11 cells in the documented order", () => {
    expect(cells(MATRIX_HEADER)).toEqual([
      "provider", "model", "date", "stream", "tool valid%", "malformed%", "parallel%", "2nd-turn ok", "index present", "429 delay>20s", "verdict",
    ]);
    const c = cells(row(aggregateSpikeRuns(mk(25))));
    expect(c).toEqual(["gemini", "m-1", "2026-10-12", "true", "100%", "0%", "0%", "ok", "n/a", "0/0", "native"]);
  });
  it("verdict native needs valid>=90% over >=20 trials with second turn ok", () => {
    expect(cells(row(aggregateSpikeRuns(mk(20))))[10]).toBe("native");
  });
  it("fewer than 20 trials is insufficient even when everything is valid", () => {
    expect(cells(row(aggregateSpikeRuns(mk(19))))[10]).toBe("insufficient trials");
  });
  it("valid below 90% falls back to json (best effort)", () => {
    const bad = mk(20).map((r, i) => (i < 3 ? { ...r, calls: [{ name: "list_tables", ...good, zodOk: false }] } : r)); // 85% valid
    const c = cells(row(aggregateSpikeRuns(bad)));
    expect(c[4]).toBe("85%");
    expect(c[10]).toBe("json (best effort)");
  });
  it("a failed second turn or an unrepaired bounce forces json (best effort)", () => {
    expect(cells(row(aggregateSpikeRuns(mk(20, { secondTurnOk: false }))))[10]).toBe("json (best effort)");
    const unrepaired = mk(20).map((r, i) => (i === 5 ? { ...r, repairAttempted: true, repairOk: false } : r));
    expect(cells(row(aggregateSpikeRuns(unrepaired)))[10]).toBe("json (best effort)");
  });
});

describe("S6-3 createPacer", () => {
  it("spaces calls at least 60000/rpm ms apart using the injected clock", async () => {
    let t = 1_000;
    const slept: number[] = [];
    const pacer = createPacer({ rpm: 6, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    const starts: number[] = [];
    for (let i = 0; i < 4; i++) {
      await pacer.wait();
      starts.push(t);
      t += 250; // the call itself takes 250 ms
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(10_000);
    expect(slept).toEqual([9_750, 9_750, 9_750]);
  });
  it("does not sleep when the previous call already took longer than the interval, nor on the first call", async () => {
    let t = 0;
    const slept: number[] = [];
    const pacer = createPacer({ rpm: 60, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    await pacer.wait();
    t += 5_000;
    await pacer.wait();
    expect(slept).toEqual([]);
  });
});

describe("S6-4 sanitizeRecording", () => {
  const capture = {
    request: {
      headers: { Authorization: `Bearer ${KEY_SENTINEL}`, "X-Api-Key": KEY_SENTINEL, "content-type": "application/json" },
      url: `https://provider.test/v1/chat?key=${KEY_SENTINEL}`,
      body: { messages: [{ role: "user", content: `echo ${KEY_SENTINEL} please` }] },
    },
    response: { status: 200, text: `data: {"echo":"${KEY_SENTINEL}"}` },
  };
  it("positive control: the raw capture does contain the key", () => {
    expect(JSON.stringify(capture)).toContain(KEY_SENTINEL);
  });
  it("removes credential headers and every occurrence of the key, keeping the rest", () => {
    const out = sanitizeRecording(capture, KEY_SENTINEL);
    const s = JSON.stringify(out);
    expect(s).not.toContain(KEY_SENTINEL);
    expect(s.toLowerCase()).not.toContain("authorization");
    expect(s.toLowerCase()).not.toContain("x-api-key");
    expect(out.request.headers["content-type"]).toBe("application/json");
    expect(out.response.status).toBe(200);
    expect(s).toContain("[REDACTED]");
  });
  it("does not mutate its input", () => {
    sanitizeRecording(capture, KEY_SENTINEL);
    expect(JSON.stringify(capture)).toContain(KEY_SENTINEL);
  });
});

describe("S6-5 importing the spike runs nothing", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("makes no network call and does not throw on import", async () => {
    forbidProviderNetwork();
    const fetchSpy = vi.fn(globalThis.fetch);
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../src/spikes/toolCallSpike");
    expect(typeof mod.main).toBe("function");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
