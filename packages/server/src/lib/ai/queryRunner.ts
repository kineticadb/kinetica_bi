// Phase 140 query port (stub for red-first).
import type { KineticaPrincipal } from "../../kinetica";
import { kineticaSql } from "../../kinetica";
import { cancelKineticaJobsByTag } from "../kineticaJobs";
import type { AiQueryAuditEntry } from "../aiAudit";
import type { QueryScope } from "./queryScope";
import { guardQuery, substituteViewAliases } from "./sqlGuard";
import { UNTRUSTED_NOTICE } from "./untrusted";
import { KineticaAuthError, KineticaPermissionError, KineticaUpstreamError } from "../../kineticaErrors";
import { SessionEndedError } from "../exportRunner";
import type { LiveSchemaPort } from "./tools/types";

export const CELL_MAX_CHARS = 200;
export const QUERY_ERRORS = {
  timedOut: "query timed out",
  cancelled: "query cancelled",
  noAccess: "you do not have access to that table or view",
  auth: "the database rejected your credentials",
  unknownColumnOrTable: "unknown column or table; check the names with describe_table",
  unknownTable: "unknown table or view; a saved view can be queried only while this dashboard has it loaded",
  syntax: "syntax error; rewrite as standard SQL",
  failed: "the query failed",
  unavailable: (tableId: number) => `Table ${tableId} is not available.`,
} as const;
export const unknownColumn = (name: string): string => `unknown column ${name.slice(0, 128)}; check the names with describe_table`;
export const queryLimitReached = (n: number): string => `query limit for this answer reached (${n}); answer with what you have`;
export type QueryResultEnvelope = { kind: "query_result"; untrusted: true; notice: string; columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean; truncation: { rows: boolean; chars: boolean; cellsClipped: number }; note?: string };
export type ColumnProfileEnvelope = { kind: "column_profile"; untrusted: true; notice: string; table: string; column: string; type?: string; rowCount: number; nullCount: number; distinctCount: number; min?: string | number; max?: string | number; topValues?: { value: string; count: number }[]; truncated: boolean };
export type QueryRunResult<E> = { ok: true; envelope: E } | { ok: false; message: string };
export interface QueryPort {
  run(sql: string, signal?: AbortSignal): Promise<QueryRunResult<QueryResultEnvelope>>;
  profile(args: { tableId: number; column: string }, signal?: AbortSignal): Promise<QueryRunResult<ColumnProfileEnvelope>>;
  entries(): readonly AiQueryAuditEntry[];
}
export type QueryPortDeps = {
  requestId: string;
  principal: () => KineticaPrincipal;
  scope: QueryScope;
  limits: { maxRows: number; maxChars: number; timeoutMs: number; maxPerAnswer: number };
  liveSchema: LiveSchemaPort;
  dashboardTableIds: () => number[];
  sql?: typeof kineticaSql;
  cancel?: typeof cancelKineticaJobsByTag;
  now?: () => number;
};
type Failure = { message: string; outcome: "timed_out" | "cancelled" | "error"; reason: string };

function classify(e: unknown, columnNames: readonly string[]): string {
  if (e instanceof KineticaPermissionError) return QUERY_ERRORS.noAccess;
  if (e instanceof KineticaAuthError) return QUERY_ERRORS.auth;
  if (e instanceof KineticaUpstreamError && e.upstreamStatus === 400) {
    const lower = e.message.toLowerCase();
    if (/(column|field)/.test(lower) && /(not found|unknown|does not exist|invalid|no such)/.test(lower)) {
      const name = columnNames.find((c) => c !== "" && new RegExp(`(^|[^a-z0-9_])${c.toLowerCase().replace(/[^a-z0-9_]/g, "\\$&")}([^a-z0-9_]|$)`).test(lower));
      return name !== undefined ? unknownColumn(name) : QUERY_ERRORS.unknownColumnOrTable;
    }
    if (/(table|view|relation|object)/.test(lower) && /(not found|unknown|does not exist|no such)/.test(lower)) return QUERY_ERRORS.unknownTable;
    if (/(syntax|parse|unexpected)/.test(lower)) return QUERY_ERRORS.syntax;
  }
  return QUERY_ERRORS.failed;
}

const clipCell = (s: string, counter: { n: number }): string => {
  if (s.length <= CELL_MAX_CHARS) return s;
  counter.n++;
  return s.slice(0, CELL_MAX_CHARS - 1) + "…";
};

function shapeCell(x: unknown, counter: { n: number }): unknown {
  if (typeof x === "string") return clipCell(x, counter);
  if (x === null || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) return x;
  if (x === undefined) return null;
  return clipCell(String(x), counter);
}

function shapeEnvelope(enc: unknown, maxRows: number, maxChars: number): QueryResultEnvelope {
  const o = (enc && typeof enc === "object" ? enc : {}) as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => /^column_\d+$/.test(k)).sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
  const headers = Array.isArray(o.column_headers) ? (o.column_headers as unknown[]).map(String) : keys;
  const cols = keys.map((k) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []));
  const total = cols.reduce((m, c) => Math.max(m, c.length), 0);
  const counter = { n: 0 };
  const rowsOver = total > maxRows;
  const n = Math.min(total, maxRows);
  const all: unknown[][] = [];
  for (let i = 0; i < n; i++) all.push(cols.map((c) => shapeCell(c[i], counter)));
  const env: QueryResultEnvelope = {
    kind: "query_result", untrusted: true, notice: UNTRUSTED_NOTICE, columns: headers, rows: [], rowCount: 0,
    truncated: false, truncation: { rows: rowsOver, chars: false, cellsClipped: counter.n },
  };
  let charsHit = false;
  for (const row of all) {
    env.rows.push(row);
    env.rowCount = env.rows.length;
    if (JSON.stringify(env).length > maxChars) {
      env.rows.pop();
      env.rowCount = env.rows.length;
      charsHit = true;
      break;
    }
  }
  env.truncation.chars = charsHit;
  env.truncated = rowsOver || charsHit;
  if (env.truncated) {
    const note = (): string => `Showing ${env.rowCount} rows (limit ${maxRows} rows / ${maxChars} characters); add filters or aggregate.`;
    env.note = note();
    while (env.rows.length > 0 && JSON.stringify(env).length > maxChars) {
      env.rows.pop();
      env.rowCount = env.rows.length;
      env.truncation.chars = true;
      env.note = note();
    }
  }
  return env;
}

export function createQueryPort(deps: QueryPortDeps): QueryPort {
  const { scope, limits } = deps;
  const sqlFn = deps.sql ?? kineticaSql;
  const cancelFn = deps.cancel ?? cancelKineticaJobsByTag;
  const now = deps.now ?? Date.now;
  const log: AiQueryAuditEntry[] = [];
  let executed = 0;

  const refuse = (sql: string, reason: string): { ok: false; message: string } => {
    log.push({ sql, durationMs: 0, outcome: "refused", reason });
    return { ok: false, message: `Refused: ${reason}` };
  };

  /** Timer + combined signal + tagged execution scaffold shared by run() and profile(). */
  async function guarded<T>(
    sqlText: string, signal: AbortSignal | undefined, columnNames: readonly string[],
    exec: (combined: AbortSignal, tag: string, principal: () => KineticaPrincipal) => Promise<T>,
  ): Promise<{ ok: true; value: T; durationMs: number; tag: string } | { ok: false; message: string }> {
    executed++;
    const tag = `${deps.requestId}-q${String(executed).padStart(2, "0")}`;
    const timeout = new AbortController();
    const t = setTimeout(() => timeout.abort(), limits.timeoutMs);
    t.unref?.();
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const start = now();
    let used: KineticaPrincipal | undefined;
    try {
      const value = await exec(combined, tag, () => (used = deps.principal()));
      return { ok: true, value, durationMs: now() - start, tag };
    } catch (e) {
      if (e instanceof SessionEndedError) throw e;
      const durationMs = now() - start;
      let f: Failure;
      if (combined.aborted) {
        try { await cancelFn(used ?? deps.principal(), tag); } catch (ce) { if (ce instanceof SessionEndedError) { /* skip cancel */ } }
        f = timeout.signal.aborted && !signal?.aborted
          ? { message: QUERY_ERRORS.timedOut, outcome: "timed_out", reason: QUERY_ERRORS.timedOut }
          : { message: QUERY_ERRORS.cancelled, outcome: "cancelled", reason: QUERY_ERRORS.cancelled };
      } else {
        const m = classify(e, columnNames);
        f = { message: m, outcome: "error", reason: m };
      }
      log.push({ sql: sqlText, durationMs, outcome: f.outcome, reason: f.reason });
      return { ok: false, message: f.message };
    } finally {
      clearTimeout(t);
    }
  }

  return {
    async run(sql, signal) {
      if (signal?.aborted) {
        log.push({ sql, durationMs: 0, outcome: "cancelled", reason: QUERY_ERRORS.cancelled });
        return { ok: false, message: QUERY_ERRORS.cancelled };
      }
      const g1 = await guardQuery(sql, { allowed: scope.pass1Allowed });
      if (!g1.ok) return refuse(sql, g1.reason);
      if (executed >= limits.maxPerAnswer) return refuse(sql, queryLimitReached(limits.maxPerAnswer));
      const sub = substituteViewAliases(sql, g1.tables, scope.aliases);
      if (!sub.ok) return refuse(sql, sub.reason);
      const g2 = await guardQuery(sub.sql, { allowed: scope.pass2Allowed });
      if (!g2.ok) return refuse(sql, g2.reason);
      const r = await guarded(sql, signal, g1.columnNames, (combined, tag, principal) =>
        sqlFn(principal(), sub.sql, { route: "AI run_query", op: "SQL", signal: combined, tag, extra: { limit: limits.maxRows + 1 } }),
      );
      if (!r.ok) return r;
      const envelope = shapeEnvelope(r.value, limits.maxRows, limits.maxChars);
      log.push({ sql, rowCount: envelope.rowCount, durationMs: r.durationMs, outcome: "ok" });
      return { ok: true, envelope };
    },
    async profile() {
      return { ok: false, message: "stub" };
    },
    entries: () => log,
  };
}
