/**
 * lib.aiKeepApply.atomic.spec.ts - Phase 141 Plan 06 Task 2 (SC1 all-or-nothing).
 * RAISE(ABORT) triggers at four points of the transaction; full-row snapshots of every state table.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db, getWidget, getDashboardVersion } from "../src/db";
import { applyKeep, KeepConflict, KeepInvalid } from "../src/lib/aiKeepApply";
import { buildKeepFixture } from "./helpers/aiKeepFixture";

const snapshot = () => ({
  dashboards: db.prepare("SELECT * FROM dashboards ORDER BY id").all(),
  widgets: db.prepare("SELECT * FROM widgets ORDER BY id").all(),
  layers: db.prepare("SELECT * FROM dashboard_layers ORDER BY id").all(),
  dvs: db.prepare("SELECT * FROM dashboard_dynamic_views ORDER BY id").all(),
  tables: db.prepare("SELECT * FROM dashboard_tables ORDER BY dashboard_id, table_id").all(),
});

const withAbortTrigger = (event: "INSERT" | "UPDATE" | "DELETE", table: string, fn: () => void) => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  db.exec(`CREATE TRIGGER kbi_test_abort BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'induced keep failure'); END;`);
  try {
    fn();
  } finally {
    db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  }
};

beforeEach(() => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
});

const expectAbort = (fn: () => unknown) => {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(KeepConflict);
  expect(err).not.toBeInstanceOf(KeepInvalid);
  expect((err as Error).message).toContain("induced keep failure");
};

describe("applyKeep atomicity (KEEP-ATOMIC-)", () => {
  const cases: [string, "INSERT" | "UPDATE" | "DELETE", string][] = [
    ["KEEP-ATOMIC-first: the very first create (dynamic view)", "INSERT", "dashboard_dynamic_views"],
    ["KEEP-ATOMIC-mid: widget create after dv + layer exist", "INSERT", "widgets"],
    ["KEEP-ATOMIC-pass2: layer update in pass 2 / edits", "UPDATE", "dashboard_layers"],
    ["KEEP-ATOMIC-late: widget delete in the removal phase", "DELETE", "widgets"],
  ];
  for (const [name, event, table] of cases) {
    it(`${name} rolls back every row of every state table`, () => {
      const f = buildKeepFixture();
      const pre = snapshot();
      withAbortTrigger(event, table, () => expectAbort(() => applyKeep(f.D, f.change, f.prepared)));
      expect(snapshot()).toEqual(pre);
      expect(getDashboardVersion(f.D)).toBe(f.change.baselineVersion);
    });
  }

  it("KEEP-ATOMIC-late: W1 keeps its old title/type/config/layout", () => {
    const f = buildKeepFixture();
    const w1 = getWidget(f.W1)!;
    withAbortTrigger("DELETE", "widgets", () => expectAbort(() => applyKeep(f.D, f.change, f.prepared)));
    const after = getWidget(f.W1)!;
    expect(after.title).toBe(w1.title);
    expect(after.type).toBe(w1.type);
    expect(after.config).toEqual(w1.config);
    expect(after.config.layout).toEqual({ x: 0, y: 0, w: 6, h: 8 });
  });

  it("KEEP-ATOMIC-retry: the same change succeeds after every aborted attempt", () => {
    const f = buildKeepFixture();
    for (const [, event, table] of cases) {
      withAbortTrigger(event, table, () => expectAbort(() => applyKeep(f.D, f.change, f.prepared)));
    }
    const r = applyKeep(f.D, f.change, f.prepared);
    expect(r.version).toBeGreaterThan(r.before);
    expect(getWidget(f.W3)).toBeUndefined();
  });
});
