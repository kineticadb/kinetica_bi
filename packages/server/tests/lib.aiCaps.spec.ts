import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { buildInMemoryDb } from "./helpers/db";
import { createDb } from "../src/db";
import { admitAiAnswer, formatStepCapMessage, DAY_CAP_MESSAGE } from "../src/lib/aiAudit";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const base = { dashboardId: 1, requestId: "r", question: "q", provider: "p", model: "m", dataAccess: "schema_only", allowListVersion: "v1", capPerHour: 30, capPerDay: 0 };

function seed(conn: ReturnType<typeof buildInMemoryDb>, user: string, tsList: number[], counted = 1) {
  const st = conn.prepare("INSERT INTO ai_audit (ts_ms, username, question, counted, status) VALUES (?,?,?,?, 'final')");
  for (const t of tsList) st.run(t, user, "q", counted);
}
const admit = (conn: ReturnType<typeof buildInMemoryDb>, over: Record<string, unknown> = {}) =>
  admitAiAnswer({ ...base, username: "ann", now: NOW, ...over } as never, conn);

describe("AI caps", () => {
  it("CAP-1 refuses the 31st with exact D-15 sentence", () => {
    const c = buildInMemoryDb();
    seed(c, "ann", [NOW - 48 * MIN, ...Array.from({ length: 29 }, (_, i) => NOW - (30 - i) * 1000)]);
    expect(admit(c)).toEqual({ ok: false, code: "AI_USER_CAP", message: "You've used 30 AI answers this hour. Try again in 12 minutes.", retryAfterSeconds: 720 });
  });
  it("CAP-2 minute wording", () => {
    const mk = (waitMs: number) => {
      const c = buildInMemoryDb();
      seed(c, "ann", Array.from({ length: 30 }, () => NOW - 60 * MIN + waitMs));
      return admit(c) as { message: string };
    };
    expect(mk(61_000).message).toContain("in 2 minutes.");
    expect(mk(60_000).message).toContain("in 1 minute.");
    expect(mk(20_000).message).toContain("in less than a minute.");
  });
  it("CAP-3 admits at 29 and the admitted row counts", () => {
    const c = buildInMemoryDb();
    seed(c, "ann", Array.from({ length: 29 }, (_, i) => NOW - 1000 * (i + 1)));
    const r = admit(c);
    expect(r.ok).toBe(true);
    const row = c.prepare("SELECT status, counted FROM ai_audit WHERE id = ?").get((r as { auditId: number }).auditId) as { status: string; counted: number };
    expect(row).toEqual({ status: "running", counted: 1 });
    expect(admit(c).ok).toBe(false);
  });
  it("CAP-4 refusals are recorded uncounted and do not extend the window", () => {
    const c = buildInMemoryDb();
    const o = { capPerHour: 5 };
    seed(c, "ann", [NOW - 50 * MIN, ...Array.from({ length: 4 }, (_, i) => NOW - MIN + i)]);
    for (let i = 0; i < 5; i++) expect(admit(c, o).ok).toBe(false);
    const ref = c.prepare("SELECT counted, outcome, status, outcome_detail FROM ai_audit WHERE outcome='capped'").all();
    expect(ref).toHaveLength(5);
    expect(ref[0]).toEqual({ counted: 0, outcome: "capped", status: "final", outcome_detail: "user_hour_cap" });
    // oldest counted row aged out; if refusals counted, 4 + 5 >= 5 would still refuse
    expect(admit(c, { ...o, now: NOW + 11 * MIN }).ok).toBe(true);
  });
  it("CAP-5 cap 0 disables", () => {
    const c = buildInMemoryDb();
    seed(c, "ann", Array.from({ length: 100 }, (_, i) => NOW - 1000 - i));
    expect(admit(c, { capPerHour: 0 }).ok).toBe(true);
  });
  it("CAP-6 other users and old rows do not count", () => {
    const c = buildInMemoryDb();
    seed(c, "bob", Array.from({ length: 30 }, (_, i) => NOW - 1000 - i));
    seed(c, "ann", Array.from({ length: 30 }, (_, i) => NOW - 61 * MIN - i));
    expect(admit(c).ok).toBe(true);
  });
  it("CAP-7 day cap", () => {
    const c = buildInMemoryDb();
    seed(c, "u1", [NOW - 3 * 3_600_000]); seed(c, "u2", [NOW - 5 * 3_600_000]); seed(c, "u3", [NOW - 7 * 3_600_000]);
    const r = admit(c, { capPerDay: 3 });
    expect(r).toMatchObject({ ok: false, code: "AI_DAY_CAP", message: "The AI's daily limit for this deployment has been reached." });
    expect(DAY_CAP_MESSAGE).toBe("The AI's daily limit for this deployment has been reached.");
    expect((r as { retryAfterSeconds: number }).retryAfterSeconds).toBe(17 * 3600);
    expect(admit(c, { capPerDay: 0 }).ok).toBe(true);
  });
  it("CAP-8 caps survive restart", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aicap-")), "t.db");
    const a = createDb(f);
    seed(a as never, "ann", Array.from({ length: 30 }, (_, i) => NOW - 1000 - i));
    a.close();
    const b = createDb(f);
    expect(admit(b as never).ok).toBe(false);
    b.close();
  });
  it("CAP-9 step cap message", () => {
    expect(formatStepCapMessage(8)).toBe("This answer reached the 8-step limit; try a more specific question.");
  });
});
