/**
 * aiAudit.ts — Phase 135 (AIGOV-V20-04, AIGOV-V20-06; D-09, D-10, D-12, D-13, D-15)
 *
 * One ai_audit row per admitted AI answer; the same table is the SQLite-derived hourly/daily cap counter
 * (survives restart). admitAiAnswer checks caps and inserts in ONE synchronous transaction (atomic).
 * Never stores row values; outcome_detail never holds provider text.
 */
import type Database from "better-sqlite3";
import { db } from "../db";

export type AiOutcome = "ok" | "cancelled" | "capped" | "provider_error" | "rate_limited";
export type AiToolAuditEntry = { name: string; args?: unknown; result: "ok" | "rejected" | "error"; stage?: string; reasons?: string[] };
export type AdmitInput = { username: string; dashboardId: number; requestId: string; question: string; provider: string; model: string; dataAccess: string; allowListVersion: string; now: number; capPerHour: number; capPerDay: number };
export type AdmitResult =
  | { ok: true; auditId: number }
  | { ok: false; code: "AI_USER_CAP"; message: string; retryAfterSeconds: number }
  | { ok: false; code: "AI_DAY_CAP"; message: string; retryAfterSeconds: number };
export type FinalizeInput = { auditId: number; outcome: AiOutcome; detail?: string; answerText?: string; steps: number; inputTokens?: number; outputTokens?: number; tools: AiToolAuditEntry[]; changes: { applied: string[]; rejected: { label: string; stage: string; reasons: string[] }[] }; durationMs: number };

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

const INSERT_REFUSAL = `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, status, outcome, outcome_detail, counted, provider, model, data_access, allow_list_version, steps)
  VALUES (@now, @username, @dashboardId, @requestId, @question, 'final', 'capped', @detail, 0, @provider, @model, @dataAccess, @allowListVersion, 0)`;
const INSERT_RUNNING = `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, status, counted, provider, model, data_access, allow_list_version)
  VALUES (@now, @username, @dashboardId, @requestId, @question, 'running', 1, @provider, @model, @dataAccess, @allowListVersion)`;

export function admitAiAnswer(input: AdmitInput, conn: Database.Database = db): AdmitResult {
  const run = conn.transaction((): AdmitResult => {
    const { now, capPerHour, capPerDay } = input;
    if (capPerHour > 0) {
      const rows = conn
        .prepare("SELECT ts_ms FROM ai_audit WHERE username = ? AND counted = 1 AND ts_ms > ? ORDER BY ts_ms ASC")
        .all(input.username, now - HOUR_MS) as { ts_ms: number }[];
      if (rows.length >= capPerHour) {
        const waitMs = rows[rows.length - capPerHour].ts_ms + HOUR_MS - now;
        const minutes = waitMs < 60_000 ? 0 : Math.ceil(waitMs / 60_000);
        conn.prepare(INSERT_REFUSAL).run({ ...input, detail: "user_hour_cap" });
        return { ok: false, code: "AI_USER_CAP", message: formatUserCapMessage(capPerHour, minutes), retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
    }
    if (capPerDay > 0) {
      const rows = conn
        .prepare("SELECT ts_ms FROM ai_audit WHERE counted = 1 AND ts_ms > ? ORDER BY ts_ms ASC")
        .all(now - DAY_MS) as { ts_ms: number }[];
      if (rows.length >= capPerDay) {
        const waitMs = rows[rows.length - capPerDay].ts_ms + DAY_MS - now;
        conn.prepare(INSERT_REFUSAL).run({ ...input, detail: "deployment_day_cap" });
        return { ok: false, code: "AI_DAY_CAP", message: DAY_CAP_MESSAGE, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
    }
    const info = conn.prepare(INSERT_RUNNING).run(input);
    return { ok: true, auditId: Number(info.lastInsertRowid) };
  });
  return run();
}

export function finalizeAiAnswer(input: FinalizeInput, conn: Database.Database = db): boolean {
  const info = conn
    .prepare(
      `UPDATE ai_audit SET status='final', outcome=?, outcome_detail=?, answer_text=?, steps=?, input_tokens=?, output_tokens=?, tools_json=?, changes_json=?, duration_ms=?
       WHERE id=? AND status='running'`,
    )
    .run(
      input.outcome, input.detail ?? null, input.answerText ?? null, input.steps,
      input.inputTokens ?? null, input.outputTokens ?? null,
      JSON.stringify(input.tools), JSON.stringify(input.changes), input.durationMs, input.auditId,
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
