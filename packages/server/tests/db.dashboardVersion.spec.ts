/**
 * db.dashboardVersion.spec.ts — Phase 141 Plan 02 (AISES-V20-06, D-05/D-17).
 * dashboards.version is bumped by kbi_ver_* triggers + updateDashboard.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createDb,
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboardVersion,
  updateDashboard,
  createWidget,
  updateWidget,
  deleteWidget,
  createTable,
  deleteTable,
  addDashboardTable,
  removeDashboardTable,
  createDashboardLayer,
  updateDashboardLayer,
  deleteDashboardLayer,
  reorderDashboardLayers,
  createDashboardDynamicView,
  updateDashboardDynamicView,
  deleteDashboardDynamicView,
} from "../src/db";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mkTable = () => createTable({ name: `t_${uniq()}`, schema: "public" });
const mkDash = () => createDashboard(`dver-${uniq()}`);
const widgetInput = { title: "w", type: "table" as any, position: 0, config: {} as any };

const tmpFiles: string[] = [];
afterEach(() => {
  while (tmpFiles.length) {
    const p = tmpFiles.pop();
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe("dashboards.version (Phase 141 DVER)", () => {
  it("DVER-1: new dashboard starts at 0; unknown id undefined", () => {
    const a = mkDash();
    expect(getDashboardVersion(a.id)).toBe(0);
    expect(getDashboardVersion(999999)).toBeUndefined();
  });

  it("DVER-2 widgets: create/update/delete bump", () => {
    const a = mkDash();
    const v = () => getDashboardVersion(a.id)!;
    let prev = v();
    const w = createWidget(a.id, widgetInput);
    expect(v()).toBeGreaterThan(prev); prev = v();
    updateWidget(w.id, { title: "x" });
    expect(v()).toBeGreaterThan(prev); prev = v();
    deleteWidget(w.id);
    expect(v()).toBeGreaterThan(prev);
  });

  it("DVER-3 layers: create/update/delete/reorder bump", () => {
    const a = mkDash();
    const t = mkTable();
    const v = () => getDashboardVersion(a.id)!;
    let prev = v();
    const l1 = createDashboardLayer(a.id, { table_id: t.id, config: { visible: true } });
    expect(v()).toBeGreaterThan(prev); prev = v();
    updateDashboardLayer(l1.id, { config: { ...l1.config, visible: false } });
    expect(v()).toBeGreaterThan(prev); prev = v();
    const l2 = createDashboardLayer(a.id, { table_id: t.id });
    prev = v();
    reorderDashboardLayers(a.id, [l2.id, l1.id]);
    expect(v()).toBeGreaterThanOrEqual(prev + 1); prev = v();
    deleteDashboardLayer(l1.id);
    expect(v()).toBeGreaterThan(prev);
  });

  it("DVER-4 dynamic views: create/update/delete bump", () => {
    const a = mkDash();
    const t = mkTable();
    const v = () => getDashboardVersion(a.id)!;
    let prev = v();
    const dv = createDashboardDynamicView(a.id, { source_table_id: t.id, name: "dv", template_sql: "SELECT 1", max_records: 10 });
    expect(v()).toBeGreaterThan(prev); prev = v();
    updateDashboardDynamicView(dv.id, { name: "dv2" });
    expect(v()).toBeGreaterThan(prev); prev = v();
    deleteDashboardDynamicView(dv.id);
    expect(v()).toBeGreaterThan(prev);
  });

  it("DVER-5 tables: add bumps, duplicate add does not, remove bumps", () => {
    const a = mkDash();
    const t = mkTable();
    const v = () => getDashboardVersion(a.id)!;
    let prev = v();
    addDashboardTable(a.id, t.id);
    expect(v()).toBeGreaterThan(prev); prev = v();
    addDashboardTable(a.id, t.id);
    expect(v()).toBe(prev);
    removeDashboardTable(a.id, t.id);
    expect(v()).toBeGreaterThan(prev);
  });

  it("DVER-6 settings: updateDashboard bumps; DTO has no version key", () => {
    const a = mkDash();
    const prev = getDashboardVersion(a.id)!;
    updateDashboard(a.id, { filter_display_mode: "panel" });
    expect(getDashboardVersion(a.id)!).toBeGreaterThan(prev);
    expect("version" in (getDashboard(a.id) as object)).toBe(false);
  });

  it("DVER-7 isolation: writes on A leave B unchanged", () => {
    const a = mkDash();
    const b = mkDash();
    const t = mkTable();
    const before = getDashboardVersion(b.id);
    const w = createWidget(a.id, widgetInput);
    updateWidget(w.id, { title: "y" });
    addDashboardTable(a.id, t.id);
    createDashboardLayer(a.id, { table_id: t.id });
    createDashboardDynamicView(a.id, { source_table_id: t.id, name: "d", template_sql: "SELECT 1", max_records: 1 });
    updateDashboard(a.id, { name: "renamed" });
    deleteWidget(w.id);
    expect(getDashboardVersion(b.id)).toBe(before);
  });

  it("DVER-8 cascade: deleting a source table bumps dashboard version", () => {
    const a = mkDash();
    const t2 = mkTable();
    createDashboardDynamicView(a.id, { source_table_id: t2.id, name: "d", template_sql: "SELECT 1", max_records: 1 });
    const prev = getDashboardVersion(a.id)!;
    deleteTable(t2.id);
    expect(getDashboardVersion(a.id)!).toBeGreaterThan(prev);
  });

  it("DVER-9 delete: deleteDashboard works with triggers present", () => {
    const a = mkDash();
    const t = mkTable();
    createWidget(a.id, widgetInput);
    addDashboardTable(a.id, t.id);
    expect(deleteDashboard(a.id)).toBe(true);
    expect(getDashboardVersion(a.id)).toBeUndefined();
  });

  it("DVER-10 migration: idempotent, upgrades old DBs", () => {
    const p = path.join(os.tmpdir(), `kbi-dver-${uniq()}.db`);
    tmpFiles.push(p);
    const trig = (d: Database.Database) =>
      d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'kbi_ver_%'").all() as { name: string }[];
    const hasVer = (d: Database.Database) =>
      (d.prepare("PRAGMA table_info(dashboards)").all() as { name: string }[]).some((c) => c.name === "version");
    const x = createDb(p);
    expect(hasVer(x)).toBe(true);
    expect(trig(x)).toHaveLength(12);
    x.close();

    const raw = new Database(p);
    for (const t of trig(raw)) raw.exec(`DROP TRIGGER ${t.name}`);
    raw.exec("ALTER TABLE dashboards DROP COLUMN version");
    raw.prepare("INSERT INTO dashboards (name) VALUES ('old')").run();
    raw.close();

    const y = createDb(p);
    expect(hasVer(y)).toBe(true);
    expect((y.prepare("SELECT version FROM dashboards WHERE name='old'").get() as { version: number }).version).toBe(0);
    expect(trig(y)).toHaveLength(12);
    y.close();
    expect(() => createDb(p).close()).not.toThrow();
  });
});
