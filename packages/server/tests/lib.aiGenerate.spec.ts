// Phase 142-05 Task 1: generated-dashboard lifecycle helpers (create, discard, sweeps, TTL reader). No Kinetica: injected sql.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, createTable, createWidget, createDashboardLayer, createDashboardDynamicView, listWidgets, getDashboard } from "../src/db";
import {
  createGeneratedDashboard, discardGeneratedDashboard, discardPendingForUser, sweepGeneratedOnBoot, findPendingForUser,
  readAiGeneratedTtlHours, runGeneratedTtlSweepOnce, GeneratePendingError,
} from "../src/lib/aiGenerate";
import { registerAiSessionView } from "../src/lib/aiSessionViews";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import type { KineticaPrincipal } from "../src/kinetica";

const NONCE = "0a1b2c3d";
const SID = "aaaaaaaa11111111";
const okPrincipal = () => ({ user: { sub: "dee" } }) as unknown as KineticaPrincipal;
const view = (dash: number, tempId: number) => {
  const viewName = buildAiDynamicViewName({ username: "dee", sid: SID, nonce: NONCE, tempId, gen: 0 });
  registerAiSessionView({ viewName, sid: SID, username: "dee", dashboardId: dash, nonce: NONCE, tempId, gen: 0 });
  return viewName;
};
const count = (t: string, dash: number) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === "dashboards" ? "id" : "dashboard_id"} = ?`).get(dash) as { n: number }).n;
let T = 0;

beforeEach(() => {
  db.exec("DROP TRIGGER IF EXISTS kbi_gen_abort");
  for (const t of ["ai_session_views", "ai_audit", "widgets", "dashboard_tables", "dashboards", "tables"]) db.exec(`DELETE FROM ${t}`);
  T = createTable({ schema: "fleet", name: "trips", columns: {} }).id;
});
afterEach(() => {
  db.exec("DROP TRIGGER IF EXISTS kbi_gen_abort");
  vi.restoreAllMocks();
});

describe("generated lifecycle (GENLIFE)", () => {
  it("GENLIFE-1 create", () => {
    const d = createGeneratedDashboard({ username: "Dee", name: "Trips", tableId: T, now: 1000 });
    expect(d.generated_pending).toBe(true);
    const row = db.prepare("SELECT generated_by, generated_pending_at FROM dashboards WHERE id = ?").get(d.id);
    expect(row).toEqual({ generated_by: "dee", generated_pending_at: 1000 });
    expect(db.prepare("SELECT table_id FROM dashboard_tables WHERE dashboard_id = ?").all(d.id)).toEqual([{ table_id: T }]);
    const ws = listWidgets(d.id);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ type: "ai", title: "AI Assistant" });
    expect((ws[0]!.config as any).layout).toEqual({ x: 24, y: 0, w: 12, h: 40 });
  });
  it("GENLIFE-1b AI and Claude Desktop builds show filters in the right panel (2026-11-02 UAT)", async () => {
    expect(createGeneratedDashboard({ username: "Dee", name: "Trips", tableId: T }).filter_display_mode).toBe("panel");
    await discardPendingForUser("dee");
    expect(createGeneratedDashboard({ username: "Dee", name: "Desk", tableIds: [T], assistant: false }).filter_display_mode).toBe("panel");
  });
  it("GENLIFE-2 one per user", () => {
    const a = createGeneratedDashboard({ username: "dee", name: "Trips", tableId: T });
    const before = (db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n;
    try {
      createGeneratedDashboard({ username: "dee", name: "Again", tableId: T });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GeneratePendingError);
      expect((e as GeneratePendingError).existing).toEqual({ id: a.id, name: "Trips" });
    }
    expect((db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n).toBe(before);
    expect(() => createGeneratedDashboard({ username: "ann", name: "Ann", tableId: T })).not.toThrow();
  });
  it("GENLIFE-3 unique-index violation is converted", () => {
    // Simulates the race: the app-level check passes, then another writer's pending row exists at INSERT time.
    const real = db.prepare.bind(db);
    let armed = true;
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (armed && sql.startsWith("INSERT INTO dashboards (name, description, generated_by")) {
        armed = false;
        real("INSERT INTO dashboards (name, description, generated_by, generated_pending_at) VALUES ('raced', '', 'dee', 1)").run();
      }
      return real(sql);
    }) as typeof db.prepare);
    try {
      createGeneratedDashboard({ username: "dee", name: "Trips", tableId: T });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GeneratePendingError);
    }
    vi.restoreAllMocks();
    // the racing row was written inside the rolled-back transaction: nothing of ours remains
    expect(findPendingForUser("dee")).toBeUndefined();
  });
  it("GENLIFE-4 rollback when createWidget fails", () => {
    db.exec("CREATE TRIGGER kbi_gen_abort BEFORE INSERT ON widgets BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => createGeneratedDashboard({ username: "dee", name: "Trips", tableId: T })).toThrow(/boom/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM dashboard_tables").get() as { n: number }).n).toBe(0);
  });
  it("GENLIFE-5 discard removes every leftover but keeps audit", async () => {
    const d = createGeneratedDashboard({ username: "dee", name: "Trips", tableId: T });
    createWidget(d.id, { title: "Bar", type: "bar", position: 1, config: { tableId: T } });
    createDashboardLayer(d.id, { table_id: T, config: { renderMode: "points" } });
    createDashboardDynamicView(d.id, { source_table_id: T, name: "V", template_sql: "SELECT * FROM {view}", max_records: 10, columns_json: [{ name: "a", type: "string" }] });
    db.prepare("INSERT INTO dashboard_access_grants (dashboard_id, grantee_type, grantee) VALUES (?, 'user', 'x')").run(d.id);
    view(d.id, -1);
    view(d.id, -2);
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO ai_audit (ts_ms, username, dashboard_id, question) VALUES (1, 'dee', ?, 'q')").run(d.id);
    const sql = vi.fn().mockResolvedValue({});
    const r = await discardGeneratedDashboard(d.id, { sql, principalFor: okPrincipal });
    expect(r).toEqual({ deleted: true, views: { dropped: 2, failed: 0 } });
    for (const t of ["dashboards", "widgets", "dashboard_layers", "dashboard_dynamic_views", "dashboard_tables", "dashboard_access_grants", "ai_session_views"]) {
      expect(count(t, d.id), t).toBe(0);
    }
    expect(count("ai_audit", d.id)).toBe(2);
  });
  it("GENLIFE-6 kept dashboards are never deleted", async () => {
    const d = createGeneratedDashboard({ username: "dee", name: "Trips", tableId: T });
    db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL").run();
    const r = await discardGeneratedDashboard(d.id, { sql: vi.fn(), principalFor: okPrincipal });
    expect(r.deleted).toBe(false);
    expect(getDashboard(d.id)).toBeTruthy();
    expect(listWidgets(d.id)).toHaveLength(1);
  });
  it("GENLIFE-7 discardPendingForUser scopes to the user's pending row", async () => {
    const dee = createGeneratedDashboard({ username: "dee", name: "D", tableId: T });
    const ann = createGeneratedDashboard({ username: "ann", name: "A", tableId: T });
    const kept = createGeneratedDashboard({ username: "dee2", name: "K", tableId: T });
    db.prepare("UPDATE dashboards SET generated_pending_at = NULL WHERE id = ?").run(kept.id);
    const n = await discardPendingForUser("DEE", { sql: vi.fn(), principalFor: okPrincipal });
    expect(n).toBe(1);
    expect(getDashboard(dee.id)).toBeUndefined();
    expect(getDashboard(ann.id)).toBeTruthy();
    expect(getDashboard(kept.id)).toBeTruthy();
  });
  it("GENLIFE-8 boot sweep deletes every pending dashboard", async () => {
    createGeneratedDashboard({ username: "dee", name: "D", tableId: T });
    createGeneratedDashboard({ username: "ann", name: "A", tableId: T });
    const kept = createGeneratedDashboard({ username: "bob", name: "K", tableId: T });
    db.prepare("UPDATE dashboards SET generated_pending_at = NULL WHERE id = ?").run(kept.id);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await sweepGeneratedOnBoot({ sql: vi.fn(), principalFor: okPrincipal });
    expect(r).toEqual({ deleted: 2 });
    expect(log.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/^\[ai\] boot sweep: deleted 2 unkept generated dashboards/));
    expect(getDashboard(kept.id)).toBeTruthy();
  });
  it("GENLIFE-9 TTL reader", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readAiGeneratedTtlHours({})).toBe(24);
    expect(readAiGeneratedTtlHours({ AI_GENERATED_TTL_HOURS: "0" })).toBe(0);
    expect(readAiGeneratedTtlHours({ AI_GENERATED_TTL_HOURS: "48" })).toBe(48);
    expect(readAiGeneratedTtlHours({ AI_GENERATED_TTL_HOURS: "8760" })).toBe(8760);
    expect(warn).not.toHaveBeenCalled();
    for (const bad of ["8761", "-1", "abc", "1.5"]) {
      expect(readAiGeneratedTtlHours({ AI_GENERATED_TTL_HOURS: bad })).toBe(24);
      readAiGeneratedTtlHours({ AI_GENERATED_TTL_HOURS: bad });
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
  it("GENLIFE-10 TTL sweep", async () => {
    const now = 100 * 3_600_000;
    const old = createGeneratedDashboard({ username: "dee", name: "Old", tableId: T, now: now - 25 * 3_600_000 });
    const fresh = createGeneratedDashboard({ username: "ann", name: "Fresh", tableId: T, now: now - 23 * 3_600_000 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = { sql: vi.fn(), principalFor: okPrincipal };
    expect(await runGeneratedTtlSweepOnce(now, deps, { AI_GENERATED_TTL_HOURS: "0" })).toEqual({ deleted: 0 });
    expect(getDashboard(old.id)).toBeTruthy();
    expect(await runGeneratedTtlSweepOnce(now, deps, { AI_GENERATED_TTL_HOURS: "24" })).toEqual({ deleted: 1 });
    expect(getDashboard(old.id)).toBeUndefined();
    expect(getDashboard(fresh.id)).toBeTruthy();
  });
});
