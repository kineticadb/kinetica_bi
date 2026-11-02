/**
 * spike.s6-toolcall.spec.ts - Phase 135 Plan 12, S6 code half.
 * Pure metric/pacing/sanitiser logic only. The live run (src/spikes/toolCallSpike.ts) is operator-run; no network here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateSpikeRuns,
  formatMatrixRow,
  createPacer,
  sanitizeRecording,
  createEarlyStopGuard,
  parse429Body,
  verdictFor,
  MATRIX_HEADER,
  type SpikeAggregate,
  type SpikeRun,
} from "../src/spikes/toolCallSpikeMetrics";
import { captureConsole, FAKE_PROVIDER_BASE_URL, forbidProviderNetwork, KEY_SENTINEL } from "./helpers/aiTestKit";

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
  it("fewer than 20 (clean) trials is inconclusive even when everything is valid", () => {
    expect(cells(row(aggregateSpikeRuns(mk(19))))[10]).toBe("inconclusive (19 clean trials)");
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

// ---- S6-6..S6-9: operator run 2026-10-13 showed quota/transport errors being scored as model failures ----
const rl = (o: Partial<SpikeRun> = {}): SpikeRun =>
  run({ calls: [], finish: "other", rateLimited: 1, retryDelayMs: 29_911_000, error: { kind: "rate_limited", status: 429 }, ...o });

/** Shape of the 2026-10-13 Gemini run: 19 clean trials + 15 daily-quota 429s + 1 first-call abort. */
function operatorLikeRuns(): SpikeRun[] {
  const clean: SpikeRun[] = Array.from({ length: 19 }, (_, i) =>
    i < 2
      ? run({ scenario: 6, calls: [{ name: "list_tables", ...good }], secondTurnOk: true })
      : i < 4
        ? run({ scenario: 5, calls: [], text: "Bar charts compare categories.", finish: "stop", expect: "none" })
        : run({ calls: [{ name: "list_tables", ...good }] }),
  );
  const errored: SpikeRun[] = [
    ...Array.from({ length: 12 }, () => rl()),
    rl({ scenario: 6, secondTurnOk: false }),
    rl({ scenario: 6, secondTurnOk: false }),
    rl({ scenario: 6, secondTurnOk: false }),
    run({ calls: [], finish: "other", latencyMs: 60_000, error: { kind: "aborted" } }),
  ];
  return [...clean, ...errored];
}

describe("S6-6 transport/quota-errored trials are excluded from the model-quality denominators", () => {
  const a = aggregateSpikeRuns(operatorLikeRuns());
  it("reports clean vs excluded trials separately", () => {
    expect(a.trials).toBe(35);
    expect(a.cleanTrials).toBe(19);
    expect(a.excludedTrials).toEqual({ count: 16, byKind: { rate_limited: 15, aborted: 1 } });
  });
  it("text-instead-of-tool and second-turn use clean trials only", () => {
    expect(a.textInsteadOfToolPct).toBe(0); // the 15 errored tool-expected trials made no call, but that is quota, not the model
    expect(a.secondTurnRuns).toBe(2);
    expect(a.secondTurnOk).toBe(2);
  });
  it("calls made inside an errored trial (multi-step cut off by a 429) do not count toward validity", () => {
    const mixed = [
      ...operatorLikeRuns(),
      rl({ calls: [{ name: "add_widget", ...good, zodOk: false }] }),
    ];
    const m = aggregateSpikeRuns(mixed);
    expect(m.validCallPct).toBe(100);
    expect(m.malformedPct).toBe(0);
    expect(m.excludedTrials.count).toBe(17);
  });
  it("429 statistics still count every trial (they are reported, never hidden)", () => {
    expect(a.rateLimit.count).toBe(15);
    expect(a.rateLimit.over20sCount).toBe(15);
    expect(a.errors).toEqual({ rate_limited: 15, aborted: 1 });
  });
  it("a protocol error is a model/adapter failure and stays in the denominator", () => {
    const p = aggregateSpikeRuns([run({ calls: [], finish: "other", error: { kind: "protocol" } })]);
    expect(p.cleanTrials).toBe(1);
    expect(p.textInsteadOfToolPct).toBe(100);
  });
});

describe("S6-7 verdicts on a clean-trial basis", () => {
  const cells = (s: string) => s.split("|").slice(1, -1).map((c) => c.trim());
  it("19 clean trials + quota errors is inconclusive, NOT json (best effort)", () => {
    const a = aggregateSpikeRuns(operatorLikeRuns());
    expect(verdictFor(a)).toBe("inconclusive (19 clean trials)");
    const c = cells(formatMatrixRow({ provider: "gemini", model: "gemini-3-flash-preview", date: "2026-10-13", stream: "true", agg: a }));
    expect(c[7]).toBe("ok"); // 2nd-turn: 2/2 clean
    expect(c[9]).toBe("15/15");
    expect(c[10]).toBe("inconclusive (19 clean trials)");
  });
  it("20 clean trials plus rate-limited ones is native", () => {
    const runs = [...operatorLikeRuns(), run({ calls: [{ name: "list_tables", ...good }] })];
    expect(verdictFor(aggregateSpikeRuns(runs))).toBe("native");
  });
  it("every trial failing with a request error (bad model id / URL) is an INVALID RUN", () => {
    const bad = (k: string, s: number) => run({ calls: [], finish: "other", error: { kind: k, status: s } });
    expect(verdictFor(aggregateSpikeRuns([bad("bad_request", 400), bad("bad_request", 400), bad("bad_request", 400)]))).toBe(
      "INVALID RUN (check AI_MODEL / AI_BASE_URL)",
    );
    expect(verdictFor(aggregateSpikeRuns(Array.from({ length: 35 }, () => bad("auth", 401))))).toBe("INVALID RUN (check AI_MODEL / AI_BASE_URL)");
  });
  it("a mix of request errors and clean trials is not an invalid run", () => {
    const runs = [run({ calls: [], finish: "other", error: { kind: "bad_request", status: 400 } }), run({ calls: [{ name: "list_tables", ...good }] })];
    expect(verdictFor(aggregateSpikeRuns(runs))).toBe("inconclusive (1 clean trials)");
  });
});

describe("S6-8 early-stop guard and 429 body parsing", () => {
  it("stops after 3 consecutive 400s; a success in between resets the count", () => {
    const g = createEarlyStopGuard();
    expect(g.observe({ kind: "bad_request", status: 400 })).toBeNull();
    expect(g.observe({ kind: "bad_request", status: 400 })).toBeNull();
    expect(g.observe({})).toBeNull();
    expect(g.observe({ kind: "bad_request", status: 400 })).toBeNull();
    expect(g.observe({ kind: "bad_request", status: 400 })).toBeNull();
    const r = g.observe({ kind: "bad_request", status: 400 });
    expect(r).toMatch(/3 consecutive 400/);
    expect(g.stopped()).toBe(r);
  });
  it("stops on a daily-quota 429 (quota id contains PerDay) even with a short delay", () => {
    const g = createEarlyStopGuard();
    expect(g.observe({ kind: "rate_limited", status: 429, retryDelayMs: 5_000, quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" })).toMatch(/daily quota/i);
  });
  it("stops on a 429 whose retry delay exceeds one hour", () => {
    const g = createEarlyStopGuard();
    expect(g.observe({ kind: "rate_limited", status: 429, retryDelayMs: 29_911_000 })).toMatch(/daily quota/i);
  });
  it("does not stop on a per-minute 429 with a short delay", () => {
    const g = createEarlyStopGuard();
    expect(g.observe({ kind: "rate_limited", status: 429, retryDelayMs: 34_000, quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" })).toBeNull();
    expect(g.stopped()).toBeNull();
  });
  it("parse429Body extracts retryDelay and quotaId from a Gemini RESOURCE_EXHAUSTED body", () => {
    const body = JSON.stringify([{ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "29911s" },
    ] } }], null, 2);
    expect(parse429Body(body)).toEqual({ retryDelayMs: 29_911_000, quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" });
    expect(parse429Body("not json")).toEqual({});
  });
});

describe("S6-9 the spike stops early and writes partial output (scripted fetch, no network)", () => {
  let dir = "";
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const env = { AI_ENABLED: "true", AI_PROVIDER: "openai-compatible", AI_BASE_URL: FAKE_PROVIDER_BASE_URL, AI_MODEL: "m-1", AI_API_KEY: KEY_SENTINEL };
  async function runMain(respond: () => Response): Promise<{ calls: number; out: any; log: string }> {
    dir = await mkdtemp(join(tmpdir(), "s6-spec-"));
    let calls = 0;
    forbidProviderNetwork(async () => { calls++; return respond(); }, { allowHosts: ["provider.test"] });
    const con = captureConsole();
    try {
      const { main } = await import("../src/spikes/toolCallSpike");
      const code = await main(["--runs", "2", "--rpm", "60000", "--out", join(dir, "out.json")], env);
      expect(code).toBe(0);
    } finally {
      con.restore();
    }
    return { calls, out: JSON.parse(await readFile(join(dir, "out.json"), "utf8")), log: con.text() };
  }
  it("3 consecutive 400s (e.g. AI_MODEL is a display name) stop the run with INVALID RUN", async () => {
    const r = await runMain(() => new Response(JSON.stringify([{ error: { code: 400, message: "unexpected model name format" } }]), { status: 400 }));
    expect(r.calls).toBe(3);
    expect(r.out.stoppedEarly).toMatch(/3 consecutive 400/);
    expect(r.out.matrixRow).toContain("INVALID RUN (check AI_MODEL / AI_BASE_URL)");
    expect(r.log).toMatch(/stopping early/i);
    expect(r.log).not.toContain(KEY_SENTINEL);
  });
  it("a daily-quota 429 stops immediately instead of burning the remaining scenarios", async () => {
    const body = JSON.stringify([{ error: { code: 429, details: [
      { violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
      { retryDelay: "29911s" },
    ] } }]);
    const r = await runMain(() => new Response(body, { status: 429 }));
    expect(r.calls).toBe(1);
    expect(r.out.stoppedEarly).toMatch(/daily quota/i);
    expect(r.out.aggregate.excludedTrials.count).toBe(1);
    expect(r.out.matrixRow).toContain("inconclusive (0 clean trials)");
  });
});

// ---- S6-10: operator run 2026-11-02 pasted the whole block, read -s took no key, and 3 trials burned on 400s ----
describe("S6-10 refuses to start against Gemini without a key", () => {
  afterEach(() => vi.unstubAllGlobals());
  const gemini = {
    AI_ENABLED: "true",
    AI_PROVIDER: "openai-compatible",
    AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    AI_MODEL: "gemini-3-flash-preview",
  };
  it.each([["unset", undefined], ["blank", "   "]])("key %s -> exit 1, no request, says how to set it", async (_label, key) => {
    forbidProviderNetwork();
    const fetchSpy = vi.fn(globalThis.fetch);
    vi.stubGlobal("fetch", fetchSpy);
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((m: unknown) => void errors.push(String(m)));
    const { main } = await import("../src/spikes/toolCallSpike");
    const code = await main(["--runs", "1"], { ...gemini, AI_API_KEY: key });
    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("AI_API_KEY is not set");
  });
});
