/**
 * db.generatedPending.spec.ts - Phase 142 Plan 01 (AIGEN-V20-02, D-03/D-05/D-06/D-20).
 * Pending-generated marker, one-pending-per-user unique index, DTO flag, Keep clears flag atomically.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db, createDb, createDashboard, getDashboard, listDashboards, getDashboardVersion, getGeneratedPending } from "../src/db";
import { applyKeep, KeepConflict } from "../src/lib/aiKeepApply";
import { buildKeepFixture } from "./helpers/aiKeepFixture";

const colsOf = (c: ReturnType<typeof createDb>, t: string) =>
  (c.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((x) => x.name);
const mark = (id: number, by: string, at = Date.now()) =>
  db.prepare("UPDATE dashboards SET generated_by = ?, generated_pending_at = ? WHERE id = ?").run(by, at, id);
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("generated pending (GENPEND)", () => {
  beforeEach(() => {
    db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  });

  it("GENPEND-1 migration adds columns and is idempotent", () => {
    const c = createDb(":memory:");
    expect(colsOf(c, "dashboards")).toEqual(expect.arrayContaining(["generated_by", "generated_pending_at"]));
    expect(colsOf(c, "ai_audit")).toContain("kind");
    c.close();
  });

  it("GENPEND-2 indexes exist", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((x) => x.name);
    expect(names).toContain("uq_dashboards_one_pending");
    expect(names).toContain("idx_ai_audit_dash_ts");
  });

  it("GENPEND-3 one pending per user, race-proof", () => {
    const u = `u${uniq()}`;
    const o = `o${uniq()}`;
    const a = createDashboard(`gp-a-${uniq()}`).id;
    const b = createDashboard(`gp-b-${uniq()}`).id;
    const c = createDashboard(`gp-c-${uniq()}`).id;
    mark(a, u);
    expect(() => mark(b, u)).toThrow(/UNIQUE/);
    expect(() => mark(c, o)).not.toThrow();
    // kept rows (non-pending) never conflict
    db.prepare("UPDATE dashboards SET generated_by = ?, generated_pending_at = NULL WHERE id IN (?, ?)").run(u, b, c);
    expect(getGeneratedPending(b)).toBeNull();
  });

  it("GENPEND-4 DTO carries the boolean and never generated_by", () => {
    const a = createDashboard(`gp-dto-${uniq()}`).id;
    expect(getDashboard(a)!.generated_pending).toBe(false);
    mark(a, `u${uniq()}`);
    const dto = getDashboard(a)!;
    expect(dto.generated_pending).toBe(true);
    expect("generated_by" in dto).toBe(false);
    expect(listDashboards().find((d) => d.id === a)!.generated_pending).toBe(true);
  });

  it("GENPEND-5 getGeneratedPending", () => {
    const a = createDashboard(`gp-g-${uniq()}`).id;
    expect(getGeneratedPending(a)).toBeNull();
    expect(getGeneratedPending(999999)).toBeUndefined();
    const u = `u${uniq()}`;
    mark(a, u, 12345);
    expect(getGeneratedPending(a)).toEqual({ generatedBy: u, pendingAt: 12345 });
  });

  it("GENPEND-6 Keep clears the flag without extra version bump", () => {
    const f = buildKeepFixture();
    mark(f.D, "dee");
    const r = applyKeep(f.D, f.change, f.prepared);
    expect(getGeneratedPending(f.D)).toBeNull();
    expect(getDashboard(f.D)!.generated_pending).toBe(false);
    expect(getDashboardVersion(f.D)).toBe(r.version);
  });

  it("GENPEND-7 rolled-back Keep leaves the flag", () => {
    const f = buildKeepFixture();
    mark(f.D, "dee", 777);
    db.exec("CREATE TRIGGER kbi_test_abort BEFORE INSERT ON widgets BEGIN SELECT RAISE(ABORT, 'induced keep failure'); END;");
    try {
      expect(() => applyKeep(f.D, f.change, f.prepared)).toThrow(/induced keep failure/);
    } finally {
      db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
    }
    expect(getGeneratedPending(f.D)).toEqual({ generatedBy: "dee", pendingAt: 777 });
  });

  it("GENPEND-8 conflict keeps the flag", () => {
    const f = buildKeepFixture();
    mark(f.D, "dee", 888);
    expect(() => applyKeep(f.D, { ...f.change, baselineVersion: f.change.baselineVersion - 1 }, f.prepared)).toThrow(KeepConflict);
    expect(getGeneratedPending(f.D)).toEqual({ generatedBy: "dee", pendingAt: 888 });
  });
});
