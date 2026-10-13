/**
 * toolCallSpikeMetrics.ts - pure parts of the Phase 135 S6 spike (no I/O, no network, no env).
 * Unit-tested in tests/spike.s6-toolcall.spec.ts. NOT part of the Express app.
 */

export type SpikeCall = {
  name: string;
  /** name exists in the registry for this run */
  known: boolean;
  /** argsRaw parsed as JSON */
  jsonOk: boolean;
  /** args passed the tool's zod schema */
  zodOk: boolean;
  /** passed the gateway shape/allow-list stages (read tools: true when zodOk) */
  gatewayOk: boolean;
};

export type SpikeRun = {
  scenario: number;
  /** tool names that are acceptable for this run, or "none" when the prompt should be answered with text only */
  expect: string[] | "none";
  calls: SpikeCall[];
  text: string;
  finish: string;
  latencyMs: number;
  /** one error bounce (tool result isError) was sent back to the model */
  repairAttempted?: boolean;
  repairOk?: boolean;
  /** scenario 6 only: step 2 after a tool result succeeded (no provider error, produced text or a call) */
  secondTurnOk?: boolean;
  indexPresent?: boolean;
  idPresent?: boolean;
  extraContentSeen?: boolean;
  /** number of HTTP 429s seen during the run */
  rateLimited: number;
  retryAfterHeader?: boolean;
  /** largest provider-suggested delay (header or body) during the run, ms */
  retryDelayMs?: number;
  error?: { kind: string; status?: number };
};

export type SpikeAggregate = {
  /** every trial, including ones that never reached the model */
  trials: number;
  /** trials scored for model quality (no transport/quota/request error) - the >= 20 rule counts these */
  cleanTrials: number;
  /** trials excluded from the validity / text-instead / second-turn / latency figures, by error kind */
  excludedTrials: { count: number; byKind: Record<string, number> };
  /** excluded trials whose error was a request error (4xx other than 429: bad model id, bad URL, auth) */
  requestErrorTrials: number;
  calls: number;
  validCallPct: number;
  malformedPct: number;
  wrongToolPct: number;
  textInsteadOfToolPct: number;
  parallelPct: number;
  repairAttempted: number;
  repairOk: number;
  repairSuccessPct: number | null;
  secondTurnRuns: number;
  secondTurnOk: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  finishReasons: Record<string, number>;
  indexPresent: "yes" | "no" | "n/a";
  idPresent: "yes" | "no" | "n/a";
  extraContentSeen: boolean;
  rateLimit: { count: number; retryAfterHeaderCount: number; maxRetryDelayMs: number; over20sCount: number };
  errors: Record<string, number>;
};

/**
 * Error kinds that say nothing about the model's tool-calling quality: quota/rate limits, transport failures,
 * timeouts/aborts, provider 5xx, and request errors (bad AI_MODEL / AI_BASE_URL / key). Trials ending in one of
 * these are EXCLUDED from the quality denominators and reported separately. `protocol` (malformed stream/response)
 * is deliberately NOT here - it is a model/adapter failure and stays in the denominator.
 */
export const EXCLUDED_ERROR_KINDS: ReadonlySet<string> = new Set([
  "rate_limited", "overloaded", "network", "timeout", "aborted", "auth", "bad_request",
]);
const REQUEST_ERROR_KINDS: ReadonlySet<string> = new Set(["auth", "bad_request"]);
export const MIN_CLEAN_TRIALS = 20;
export const INVALID_RUN_VERDICT = "INVALID RUN (check AI_MODEL / AI_BASE_URL)";

const isExcluded = (r: SpikeRun): boolean => r.error !== undefined && EXCLUDED_ERROR_KINDS.has(r.error.kind);

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

/** nearest-rank percentile on an unsorted list */
function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[Math.min(rank, s.length) - 1];
}

const tri = (vals: (boolean | undefined)[]): "yes" | "no" | "n/a" => {
  const seen = vals.filter((v): v is boolean => v !== undefined);
  if (seen.length === 0) return "n/a";
  return seen.every(Boolean) ? "yes" : "no";
};

export function aggregateSpikeRuns(allRuns: readonly SpikeRun[]): SpikeAggregate {
  const excluded = allRuns.filter(isExcluded);
  const runs = allRuns.filter((r) => !isExcluded(r)); // quality figures below use clean trials only
  const excludedByKind: Record<string, number> = {};
  for (const r of excluded) excludedByKind[r.error!.kind] = (excludedByKind[r.error!.kind] ?? 0) + 1;
  const allCalls = runs.flatMap((r) => r.calls);
  const validCalls = allCalls.filter((c) => c.known && c.jsonOk && c.zodOk && c.gatewayOk).length;
  const malformed = allCalls.filter((c) => c.known && !(c.jsonOk && c.zodOk && c.gatewayOk)).length;

  const toolExpected = runs.filter((r) => r.expect !== "none");
  const textInstead = toolExpected.filter((r) => r.calls.length === 0).length;
  const wrongTool = runs.filter((r) => {
    if (r.expect === "none") return r.calls.length > 0;
    const ok = r.expect;
    return r.calls.some((c) => !c.known || !ok.includes(c.name));
  }).length;
  const withCalls = runs.filter((r) => r.calls.length > 0);
  const parallel = withCalls.filter((r) => r.calls.length > 1).length;

  const repairRuns = runs.filter((r) => r.repairAttempted);
  const repairOk = repairRuns.filter((r) => r.repairOk).length;
  const stRuns = runs.filter((r) => r.secondTurnOk !== undefined);

  const finishReasons: Record<string, number> = {};
  for (const r of runs) finishReasons[r.finish] = (finishReasons[r.finish] ?? 0) + 1;
  const errors: Record<string, number> = {};
  for (const r of allRuns) if (r.error) errors[r.error.kind] = (errors[r.error.kind] ?? 0) + 1;

  const delays = allRuns.map((r) => r.retryDelayMs).filter((d): d is number => d !== undefined);
  const lat = runs.map((r) => r.latencyMs);

  return {
    trials: allRuns.length,
    cleanTrials: runs.length,
    excludedTrials: { count: excluded.length, byKind: excludedByKind },
    requestErrorTrials: excluded.filter((r) => REQUEST_ERROR_KINDS.has(r.error!.kind)).length,
    calls: allCalls.length,
    validCallPct: pct(validCalls, allCalls.length),
    malformedPct: pct(malformed, allCalls.length),
    wrongToolPct: pct(wrongTool, runs.length),
    textInsteadOfToolPct: pct(textInstead, toolExpected.length),
    parallelPct: pct(parallel, withCalls.length),
    repairAttempted: repairRuns.length,
    repairOk,
    repairSuccessPct: repairRuns.length === 0 ? null : pct(repairOk, repairRuns.length),
    secondTurnRuns: stRuns.length,
    secondTurnOk: stRuns.filter((r) => r.secondTurnOk).length,
    latencyP50Ms: percentile(lat, 50),
    latencyP95Ms: percentile(lat, 95),
    finishReasons,
    indexPresent: tri(runs.map((r) => r.indexPresent)),
    idPresent: tri(runs.map((r) => r.idPresent)),
    extraContentSeen: runs.some((r) => r.extraContentSeen === true),
    rateLimit: {
      count: allRuns.reduce((n, r) => n + r.rateLimited, 0),
      retryAfterHeaderCount: allRuns.filter((r) => r.retryAfterHeader === true).length,
      maxRetryDelayMs: delays.length === 0 ? 0 : Math.max(...delays),
      over20sCount: delays.filter((d) => d > 20_000).length,
    },
    errors,
  };
}

export const MATRIX_HEADER =
  "| provider | model | date | stream | tool valid% | malformed% | parallel% | 2nd-turn ok | index present | 429 delay>20s | verdict |";

export function verdictFor(a: SpikeAggregate): string {
  if (a.trials > 0 && a.requestErrorTrials === a.trials) return INVALID_RUN_VERDICT;
  if (a.cleanTrials < MIN_CLEAN_TRIALS) return `inconclusive (${a.cleanTrials} clean trials)`;
  const repairsFine = a.repairAttempted === 0 || a.repairOk === a.repairAttempted; // at most one bounce per run is ever sent
  const secondTurn = a.secondTurnRuns > 0 && a.secondTurnOk === a.secondTurnRuns;
  return a.validCallPct >= 90 && repairsFine && secondTurn ? "native" : "json (best effort)";
}

export function formatMatrixRow(i: { provider: string; model: string; date: string; stream: string; agg: SpikeAggregate }): string {
  const a = i.agg;
  const second = a.secondTurnRuns === 0 ? "n/a" : a.secondTurnOk === a.secondTurnRuns ? "ok" : `fail (${a.secondTurnOk}/${a.secondTurnRuns})`;
  const cells = [
    i.provider,
    i.model,
    i.date,
    i.stream,
    `${a.validCallPct}%`,
    `${a.malformedPct}%`,
    `${a.parallelPct}%`,
    second,
    a.indexPresent,
    `${a.rateLimit.over20sCount}/${a.rateLimit.count}`,
    verdictFor(a),
  ];
  return `| ${cells.join(" | ")} |`;
}

/** Spaces calls >= 60000/rpm ms apart. Clock and sleep are injected (no fake timers). */
export function createPacer(o: { rpm: number; now: () => number; sleep: (ms: number) => Promise<void> }): { wait(): Promise<void> } {
  const interval = o.rpm > 0 ? 60_000 / o.rpm : 0;
  let last: number | undefined;
  return {
    async wait() {
      if (last !== undefined) {
        const gap = o.now() - last;
        if (gap < interval) await o.sleep(Math.ceil(interval - gap));
      }
      last = o.now();
    },
  };
}

const SECRET_HEADERS = new Set(["authorization", "x-api-key", "x-goog-api-key", "proxy-authorization"]);

/** Deep-copies a wire capture, dropping credential headers and replacing every occurrence of each secret. */
export function sanitizeRecording<T>(input: T, ...secrets: (string | undefined)[]): T {
  const live = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  const scrub = (s: string): string => live.reduce((acc, k) => acc.split(k).join("[REDACTED]"), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_HEADERS.has(k.toLowerCase())) continue;
        out[scrub(k)] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}

/** Extracts the provider-suggested retry delay and quota id from a Gemini-style 429 body (RetryInfo / QuotaFailure). */
export function parse429Body(text: string): { retryDelayMs?: number; quotaId?: string } {
  const out: { retryDelayMs?: number; quotaId?: string } = {};
  const d = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(text);
  if (d) out.retryDelayMs = Math.round(parseFloat(d[1]) * 1000);
  const q = /"quotaId"\s*:\s*"([^"]+)"/.exec(text);
  if (q) out.quotaId = q[1];
  return out;
}

export type StepOutcome = { kind?: string; status?: number; retryDelayMs?: number; quotaId?: string };
export const MAX_CONSECUTIVE_BAD_REQUESTS = 3;
export const DAILY_QUOTA_DELAY_MS = 60 * 60 * 1000;

/**
 * Decides when the spike should stop instead of burning more requests: after 3 consecutive 400s (the request itself
 * is wrong - e.g. AI_MODEL is a display name, not a model id), or on a 429 that signals an exhausted DAILY quota
 * (quota id contains "PerDay", or the suggested delay is over an hour). observe() returns the stop reason once tripped.
 */
export function createEarlyStopGuard(): { observe(o: StepOutcome): string | null; stopped(): string | null } {
  let consecutive400 = 0;
  let reason: string | null = null;
  return {
    observe(o) {
      if (reason) return reason;
      const is400 = o.status === 400 || (o.kind === "bad_request" && o.status === undefined);
      consecutive400 = is400 ? consecutive400 + 1 : 0;
      if (consecutive400 >= MAX_CONSECUTIVE_BAD_REQUESTS) {
        reason = `${MAX_CONSECUTIVE_BAD_REQUESTS} consecutive 400 (bad request) responses - check AI_MODEL is a model id (not a display name) and AI_BASE_URL`;
      } else if (o.kind === "rate_limited" || o.status === 429) {
        const perDay = o.quotaId !== undefined && o.quotaId.includes("PerDay");
        const long = o.retryDelayMs !== undefined && o.retryDelayMs > DAILY_QUOTA_DELAY_MS;
        if (perDay || long) {
          const delay = o.retryDelayMs !== undefined ? ` (retry in ~${Math.round(o.retryDelayMs / 60_000)} min)` : "";
          reason = `daily quota exhausted${o.quotaId ? ` [${o.quotaId}]` : ""}${delay} - re-run after the quota resets`;
        }
      }
      return reason;
    },
    stopped: () => reason,
  };
}
