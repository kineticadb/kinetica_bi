import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "../src/db";
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildInMemoryDb } from "./helpers/db";
import { admitAiAnswer, finalizeAiAnswer, readAiAuditRetentionDays, runAiAuditSweepOnce } from "../src/lib/aiAudit";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const base = { dashboardId: 1, requestId: "r", question: "QSENTINEL-q", provider: "gemini", model: "m1", dataAccess: "schema_only", allowListVersion: "v1", capPerHour: 30, capPerDay: 0 };
const fin = (auditId: number, over = {}) => ({ auditId, outcome: "ok" as const, steps: 3, tools: [], changes: { applied: [], rejected: [] }, durationMs: 42, ...over });
afterEach(() => vi.restoreAllMocks());

describe("AI audit", () => {
  it("AUD-1 finalize exactly once", () => {
    const c = buildInMemoryDb();
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    expect(finalizeAiAnswer(fin(r.auditId, { answerText: "A", inputTokens: 5, outputTokens: 7 }), c)).toBe(true);
    expect(finalizeAiAnswer(fin(r.auditId, { outcome: "cancelled", answerText: "B" }), c)).toBe(false);
    const row = c.prepare("SELECT * FROM ai_audit WHERE id=?").get(r.auditId) as Record<string, unknown>;
    expect(row).toMatchObject({ status: "final", outcome: "ok", answer_text: "A", steps: 3, input_tokens: 5, output_tokens: 7, duration_ms: 42 });
  });
  it("AUD-2 token columns NULL when unreported", () => {
    const c = buildInMemoryDb();
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    finalizeAiAnswer(fin(r.auditId), c);
    const row = c.prepare("SELECT input_tokens i, output_tokens o FROM ai_audit WHERE id=?").get(r.auditId);
    expect(row).toEqual({ i: null, o: null });
  });
  it("AUD-3 exact column list, no row-value column", () => {
    const c = buildInMemoryDb();
    const cols = (c.prepare("PRAGMA table_info(ai_audit)").all() as { name: string }[]).map((x) => x.name);
    expect(cols).toEqual(["id","ts_ms","username","dashboard_id","request_id","question","answer_text","status","outcome","outcome_detail","counted","provider","model","data_access","allow_list_version","steps","input_tokens","output_tokens","tools_json","changes_json","duration_ms","queries_json"]);
  });
  it("AUD-4 log line has metadata only", () => {
    const c = buildInMemoryDb();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    finalizeAiAnswer(fin(r.auditId, { answerText: "ASENTINEL-a" }), c);
    const out = spy.mock.calls.map((a) => a.join(" ")).join("\n");
    expect(out).toContain('"event":"ai_answer"');
    expect(out).toContain('"username":"ann"');
    expect(out).not.toContain("QSENTINEL-q");
    expect(out).not.toContain("ASENTINEL-a");
  });
});

describe("Phase 140 query audit", () => {
  const Q = [
    { sql: "SELECT 1 FROM demo.t", rowCount: 3, durationMs: 12, outcome: "ok" as const },
    { sql: "DELETE FROM demo.t", durationMs: 0, outcome: "refused" as const, reason: "only a single SELECT (or WITH ... SELECT) is allowed" },
  ];
  it("AUDQ-1 queries persisted as JSON", () => {
    const c = buildInMemoryDb();
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    finalizeAiAnswer(fin(r.auditId, { queries: Q }), c);
    const row = c.prepare("SELECT queries_json q FROM ai_audit WHERE id=?").get(r.auditId) as { q: string };
    expect(JSON.parse(row.q)).toEqual(Q);
  });
  it("AUDQ-2 NULL when omitted", () => {
    const c = buildInMemoryDb();
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    finalizeAiAnswer(fin(r.auditId), c);
    const row = c.prepare("SELECT queries_json q FROM ai_audit WHERE id=?").get(r.auditId) as { q: unknown };
    expect(row.q).toBeNull();
  });
  it("AUDQ-3 pre-140 database gains the column, idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-audq-"));
    const file = path.join(dir, "t.db");
    try {
      const old = new Database(file);
      old.exec(`CREATE TABLE ai_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, username TEXT NOT NULL, dashboard_id INTEGER, request_id TEXT, question TEXT NOT NULL, answer_text TEXT, status TEXT NOT NULL DEFAULT 'running', outcome TEXT, outcome_detail TEXT, counted INTEGER NOT NULL DEFAULT 1, provider TEXT, model TEXT, data_access TEXT, allow_list_version TEXT, steps INTEGER, input_tokens INTEGER, output_tokens INTEGER, tools_json TEXT, changes_json TEXT, duration_ms INTEGER);`);
      old.prepare("INSERT INTO ai_audit (ts_ms, username, question) VALUES (1, 'ann', 'keep-me')").run();
      old.close();
      const a = createDb(file);
      const cols = (a.prepare("PRAGMA table_info(ai_audit)").all() as { name: string }[]).map((x) => x.name);
      expect(cols).toContain("queries_json");
      expect((a.prepare("SELECT question FROM ai_audit").get() as { question: string }).question).toBe("keep-me");
      a.close();
      const b = createDb(file);
      expect((b.prepare("SELECT COUNT(*) n FROM ai_audit").get() as { n: number }).n).toBe(1);
      b.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("AUDQ-4 log line carries no SQL text", () => {
    const c = buildInMemoryDb();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = admitAiAnswer({ ...base, username: "ann", now: NOW }, c) as { auditId: number };
    finalizeAiAnswer(fin(r.auditId, { queries: Q }), c);
    const out = spy.mock.calls.map((a) => a.join(" ")).join("\n");
    expect(out).toContain('"event":"ai_answer"');
    expect(out).not.toContain("SELECT 1 FROM demo.t");
  });
});

describe("AI audit sweep", () => {
  const ins = (c: ReturnType<typeof buildInMemoryDb>, ts: number, status = "final") =>
    c.prepare("INSERT INTO ai_audit (ts_ms, username, question, status) VALUES (?, 'ann', 'q', ?)").run(ts, status);
  it("SWP-1 retention 90 default", () => {
    const c = buildInMemoryDb();
    vi.stubEnv("AI_AUDIT_RETENTION_DAYS", "");
    ins(c, NOW - 91 * DAY); ins(c, NOW - 89 * DAY);
    expect(runAiAuditSweepOnce(NOW, c).deleted).toBe(1);
    expect((c.prepare("SELECT COUNT(*) n FROM ai_audit").get() as { n: number }).n).toBe(1);
  });
  it("SWP-2 0 keeps everything", () => {
    const c = buildInMemoryDb();
    vi.stubEnv("AI_AUDIT_RETENTION_DAYS", "0");
    ins(c, NOW - 3650 * DAY);
    expect(runAiAuditSweepOnce(NOW, c).deleted).toBe(0);
    expect((c.prepare("SELECT COUNT(*) n FROM ai_audit").get() as { n: number }).n).toBe(1);
  });
  it("SWP-3 invalid warns once, defaults 90", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { AI_AUDIT_RETENTION_DAYS: "abc-swp3" };
    expect(readAiAuditRetentionDays(env)).toBe(90);
    expect(readAiAuditRetentionDays(env)).toBe(90);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("AI_AUDIT_RETENTION_DAYS");
  });
  it("SWP-4 stale running rows interrupted", () => {
    const c = buildInMemoryDb();
    vi.stubEnv("AI_AUDIT_RETENTION_DAYS", "");
    ins(c, NOW - 20 * 60_000, "running"); ins(c, NOW - 5 * 60_000, "running");
    expect(runAiAuditSweepOnce(NOW, c).interrupted).toBe(1);
    const rows = c.prepare("SELECT status, outcome, outcome_detail FROM ai_audit ORDER BY ts_ms").all();
    expect(rows).toEqual([{ status: "final", outcome: "provider_error", outcome_detail: "interrupted" }, { status: "running", outcome: null, outcome_detail: null }]);
  });
  it("SWP-5 works with AI disabled", () => {
    const c = buildInMemoryDb();
    vi.stubEnv("AI_ENABLED", "");
    vi.stubEnv("AI_AUDIT_RETENTION_DAYS", "");
    ins(c, NOW - 100 * DAY);
    expect(runAiAuditSweepOnce(NOW, c).deleted).toBe(1);
  });
  afterEach(() => vi.unstubAllEnvs());
});
