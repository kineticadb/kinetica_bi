/**
 * aiAudit.ts — Phase 135 (AIGOV-V20-04, AIGOV-V20-06; D-09, D-10, D-12, D-13, D-15)
 *
 * One ai_audit row per admitted AI answer; the same table is the SQLite-derived hourly/daily cap counter
 * (survives restart). admitAiAnswer checks caps and inserts in ONE synchronous transaction (atomic).
 * Never stores row values; outcome_detail never holds provider text.
 */
import type Database from "better-sqlite3";
import { db } from "../db";
import type { AiKeepIdMap } from "@kinetica-bi/shared";

export type AiOutcome = "ok" | "cancelled" | "capped" | "provider_error" | "rate_limited";
export type AiAuditKind = "ask" | "generate" | "keep" | "mcp";
export type AiToolAuditEntry = { name: string; args?: unknown; result: "ok" | "rejected" | "error"; stage?: string; reasons?: string[] };
export type AdmitInput = { username: string; dashboardId: number; requestId: string; question: string; provider: string; model: string; dataAccess: string; allowListVersion: string; now: number; capPerHour: number; capPerDay: number; kind?: "ask" | "generate" };
export type AdmitResult =
  | { ok: true; auditId: number }
  | { ok: false; code: "AI_USER_CAP"; message: string; retryAfterSeconds: number }
  | { ok: false; code: "AI_DAY_CAP"; message: string; retryAfterSeconds: number };
export type AiQueryOutcome = "ok" | "refused" | "timed_out" | "cancelled" | "error";
/** 140 D-12: one AI query. SQL text (may hold literal filter values the user/model typed) — NEVER result values. */
export type AiQueryAuditEntry = { sql: string; rowCount?: number; durationMs: number; outcome: AiQueryOutcome; reason?: string };
export type FinalizeInput = { auditId: number; outcome: AiOutcome; detail?: string; answerText?: string; steps: number; inputTokens?: number; outputTokens?: number; tools: AiToolAuditEntry[]; changes: { applied: string[]; rejected: { label: string; stage: string; reasons: string[] }[] }; durationMs: number; queries?: AiQueryAuditEntry[] };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const DAY_CAP_MESSAGE = "The AI's daily limit for this deployment has been reached.";

export function formatUserCapMessage(cap: number, minutes: number): string {
  const when = minutes < 1 ? "less than a minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `You've used ${cap} AI answers this hour. Try again in ${when}.`;
}

export function formatStepCapMessage(maxSteps: number): string {
  return `This answer reached the ${maxSteps}-step limit; try a more specific question.`;
}

const INSERT_REFUSAL = `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, status, outcome, outcome_detail, counted, provider, model, data_access, allow_list_version, steps, kind)
  VALUES (@now, @username, @dashboardId, @requestId, @question, 'final', 'capped', @detail, 0, @provider, @model, @dataAccess, @allowListVersion, 0, @kind)`;
const INSERT_RUNNING = `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, status, counted, provider, model, data_access, allow_list_version, kind)
  VALUES (@now, @username, @dashboardId, @requestId, @question, 'running', 1, @provider, @model, @dataAccess, @allowListVersion, @kind)`;

export function admitAiAnswer(input: AdmitInput, conn: Database.Database = db): AdmitResult {
  const run = conn.transaction((): AdmitResult => {
    const { now, capPerHour, capPerDay } = input;
    const row = { ...input, kind: input.kind ?? "ask" };
    if (capPerHour > 0) {
      const rows = conn
        .prepare("SELECT ts_ms FROM ai_audit WHERE username = ? AND counted = 1 AND ts_ms > ? ORDER BY ts_ms ASC")
        .all(input.username, now - HOUR_MS) as { ts_ms: number }[];
      if (rows.length >= capPerHour) {
        const waitMs = rows[rows.length - capPerHour].ts_ms + HOUR_MS - now;
        const minutes = waitMs < 60_000 ? 0 : Math.ceil(waitMs / 60_000);
        conn.prepare(INSERT_REFUSAL).run({ ...row, detail: "user_hour_cap" });
        return { ok: false, code: "AI_USER_CAP", message: formatUserCapMessage(capPerHour, minutes), retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
    }
    if (capPerDay > 0) {
      const rows = conn
        .prepare("SELECT ts_ms FROM ai_audit WHERE counted = 1 AND ts_ms > ? ORDER BY ts_ms ASC")
        .all(now - DAY_MS) as { ts_ms: number }[];
      if (rows.length >= capPerDay) {
        const waitMs = rows[rows.length - capPerDay].ts_ms + DAY_MS - now;
        conn.prepare(INSERT_REFUSAL).run({ ...row, detail: "deployment_day_cap" });
        return { ok: false, code: "AI_DAY_CAP", message: DAY_CAP_MESSAGE, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
    }
    const info = conn.prepare(INSERT_RUNNING).run(row);
    return { ok: true, auditId: Number(info.lastInsertRowid) };
  });
  return run();
}

export function finalizeAiAnswer(input: FinalizeInput, conn: Database.Database = db): boolean {
  const info = conn
    .prepare(
      `UPDATE ai_audit SET status='final', outcome=?, outcome_detail=?, answer_text=?, steps=?, input_tokens=?, output_tokens=?, tools_json=?, changes_json=?, duration_ms=?, queries_json=?
       WHERE id=? AND status='running'`,
    )
    .run(
      input.outcome, input.detail ?? null, input.answerText ?? null, input.steps,
      input.inputTokens ?? null, input.outputTokens ?? null,
      JSON.stringify(input.tools), JSON.stringify(input.changes), input.durationMs,
      input.queries === undefined ? null : JSON.stringify(input.queries), input.auditId,
    );
  if (info.changes !== 1) return false;
  const row = conn.prepare("SELECT username, dashboard_id, provider, model FROM ai_audit WHERE id=?").get(input.auditId) as
    | { username: string; dashboard_id: number | null; provider: string | null; model: string | null }
    | undefined;
  // OBS-01 metadata only: never the question or answer text.
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level: "info", event: "ai_answer",
    username: row?.username, dashboard_id: row?.dashboard_id, outcome: input.outcome, outcome_detail: input.detail ?? null,
    steps: input.steps, provider: row?.provider, model: row?.model, duration_ms: input.durationMs,
  }));
  return true;
}

// ---- Retention sweep (D-10) — always on, independent of AI_ENABLED ----
const DEFAULT_RETENTION_DAYS = 90;
const warnedRetention = new Set<string>();

export function readAiAuditRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.AI_AUDIT_RETENTION_DAYS ?? "").trim();
  if (raw === "") return DEFAULT_RETENTION_DAYS;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n <= 36500) return n;
  }
  if (!warnedRetention.has(raw)) {
    warnedRetention.add(raw);
    console.warn(`[boot] AI_AUDIT_RETENTION_DAYS is invalid (expected 0..36500); using default ${DEFAULT_RETENTION_DAYS}`);
  }
  return DEFAULT_RETENTION_DAYS;
}

export const AI_AUDIT_SWEEP_INTERVAL_MS = 60 * 60_000;
const STALE_RUNNING_MS = 15 * 60_000;

export function runAiAuditSweepOnce(now: number = Date.now(), conn: Database.Database = db): { deleted: number; interrupted: number } {
  const days = readAiAuditRetentionDays();
  const deleted = days > 0 ? conn.prepare("DELETE FROM ai_audit WHERE ts_ms < ?").run(now - days * DAY_MS).changes : 0;
  const interrupted = conn
    .prepare("UPDATE ai_audit SET status='final', outcome='provider_error', outcome_detail='interrupted' WHERE status='running' AND ts_ms < ?")
    .run(now - STALE_RUNNING_MS).changes;
  if (deleted > 0 || interrupted > 0) console.log(`[ai] audit sweep: removed ${deleted}, marked ${interrupted} interrupted`);
  return { deleted, interrupted };
}

export function startAiAuditSweep(): NodeJS.Timeout {
  const tick = () => {
    try { runAiAuditSweepOnce(); } catch (err) { console.error("[ai] audit sweep failed", err); /* next tick retries; never clearInterval */ }
  };
  tick();
  const handle = setInterval(tick, AI_AUDIT_SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}

// ---- Keep (141-12): one audit row per Keep attempt that reaches the handler. Counts and ids only (Pitfall 8). ----
export type AiKeepAuditOutcome = "kept" | "keep_conflict" | "keep_denied" | "keep_invalid" | "keep_failed";
export type AiKeepAuditInput = {
  username: string;
  dashboardId: number;
  outcome: AiKeepAuditOutcome;
  detail?: string; // a fixed code, never a message carrying values
  counts: { added: { widgets: number; layers: number; dynamicViews: number }; edited: { widgets: number; layers: number }; removed: { widgets: number; layers: number; dynamicViews: number } };
  idMap?: AiKeepIdMap;
  durationMs: number;
  now?: number;
};

export function recordAiKeep(input: AiKeepAuditInput, conn: Database.Database = db): void {
  const now = input.now ?? Date.now();
  conn
    .prepare(
      `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, status, outcome, outcome_detail, counted, steps, changes_json, duration_ms, kind)
       VALUES (?, ?, ?, ?, '', 'final', ?, ?, 0, 0, ?, ?, 'keep')`,
    )
    .run(
      now, input.username, input.dashboardId, `keep-${now}-${Math.random().toString(36).slice(2, 10)}`, input.outcome, input.detail ?? null,
      JSON.stringify({ ...input.counts, ...(input.idMap ? { idMap: input.idMap } : {}) }), input.durationMs,
    );
  console.log(JSON.stringify({
    ts: new Date(now).toISOString(), level: "info", event: "ai_keep",
    username: input.username, dashboard_id: input.dashboardId, outcome: input.outcome, outcome_detail: input.detail ?? null, duration_ms: input.durationMs,
  }));
}

/** Phase 143 (AIMCP-V20-06): a Claude Desktop build (connector session). Claude's model did the work, so it is not counted against the in-app AI's caps. */
export type McpBuildAuditInput = {
  username: string;
  dashboardId: number;
  dashboardName: string;
  /** "new" = built; "edit" = changed a saved dashboard (Phase 143). */
  mode?: "new" | "edit";
  summary?: string;
  dataAccess: string;
  allowListVersion: string;
  tools: AiToolAuditEntry[];
  changes: FinalizeInput["changes"];
  startedAt: number;
  now: number;
};

export function recordMcpBuild(input: McpBuildAuditInput, conn: Database.Database = db): number {
  const info = conn
    .prepare(
      `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, answer_text, status, outcome, counted, provider, model, data_access,
         allow_list_version, steps, tools_json, changes_json, duration_ms, kind)
       VALUES (@now, lower(@username), @dashboardId, @requestId, @question, @summary, 'final', 'ok', 0, 'claude-desktop', '', @dataAccess,
         @allowListVersion, @steps, @tools, @changes, @duration, 'mcp')`,
    )
    .run({
      now: input.now,
      username: input.username,
      dashboardId: input.dashboardId,
      requestId: `mcp-${input.now}-${input.dashboardId}`,
      question: `${input.mode === "edit" ? "Changed" : "Built"} "${input.dashboardName}" in Claude Desktop`,
      summary: input.summary ?? null,
      dataAccess: input.dataAccess,
      allowListVersion: input.allowListVersion,
      steps: input.tools.length,
      tools: JSON.stringify(input.tools),
      changes: JSON.stringify(input.changes),
      duration: Math.max(0, input.now - input.startedAt),
    });
  return Number(info.lastInsertRowid);
}

/** 146-03: why a Claude Desktop build ended without finish. Stored as ai_audit.outcome_detail. */
export type McpUnfinishedReason = "discarded" | "expired" | "server_restart";

/**
 * One ai_audit row for a Claude Desktop build that never finished. Exactly once: skipped when any kind 'mcp' row exists for
 * the dashboard since it went pending (a finished build already has its ok row). Never throws; session data is optional and
 * is serialised defensively. Meant to run inside the discard transaction.
 */
export function recordMcpUnfinished(
  input: {
    username: string;
    dashboardId: number;
    dashboardName: string;
    pendingAt: number;
    reason: McpUnfinishedReason;
    tools?: AiToolAuditEntry[];
    changes?: FinalizeInput["changes"];
    startedAt?: number;
    allowListVersion: string;
    now: number;
  },
  conn: Database.Database = db,
): boolean {
  try {
    const exists = conn.prepare("SELECT 1 FROM ai_audit WHERE kind = 'mcp' AND dashboard_id = ? AND ts_ms >= ?").get(input.dashboardId, input.pendingAt);
    if (exists) return false;
    const tools = Array.isArray(input.tools) ? input.tools : [];
    const ch = input.changes;
    const changes = {
      applied: Array.isArray(ch?.applied) ? ch.applied : [],
      rejected: Array.isArray(ch?.rejected) ? ch.rejected : [],
    };
    let toolsJson = "[]";
    let changesJson = '{"applied":[],"rejected":[]}';
    try { toolsJson = JSON.stringify(tools); } catch { /* keep fallback */ }
    try { changesJson = JSON.stringify(changes); } catch { /* keep fallback */ }
    conn
      .prepare(
        `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, answer_text, status, outcome, outcome_detail, counted, provider, model, data_access,
           allow_list_version, steps, tools_json, changes_json, duration_ms, kind)
         VALUES (?, lower(?), ?, ?, ?, NULL, 'final', 'unfinished', ?, 0, 'claude-desktop', '', NULL, ?, ?, ?, ?, ?, 'mcp')`,
      )
      .run(
        input.now, input.username, input.dashboardId, `mcp-unfinished-${input.now}-${input.dashboardId}`,
        `Started "${input.dashboardName}" in Claude Desktop (not finished)`, input.reason,
        input.allowListVersion, tools.length, toolsJson, changesJson, Math.max(0, input.now - (input.startedAt ?? input.pendingAt)),
      );
    return true;
  } catch {
    console.warn(JSON.stringify({ event: "ai_mcp_unfinished_audit_failed", dashboard_id: input.dashboardId }));
    return false;
  }
}
