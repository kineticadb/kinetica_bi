/**
 * lib.dashboardImport.validate.spec.ts — Phase 120 Plan 02 (DXIM-V124-06/-07/-11)
 *
 * Task 1 (`VALID-*`): the two-tier validation gate. `VALID-reject` cases each mutate ONE field
 * of a single well-formed fixture and assert `ok === false`, a `code`, and that `message`
 * CONTAINS the offending field path — proving that specific check, not "the fixture is broken".
 * `VALID-accept` / `VALID-dangle` / `VALID-nowrite` cover the acceptance path, the referential
 * (never-fatal, never-trusted-from-file) dangling-reference recomputation, and the "a rejected
 * file writes nothing" guarantee.
 *
 * Task 2 (`RESOLVE-*`): table and custom-metric match-or-create resolution.
 *
 * Task 3: MUTATION PROBES block appended below once Tasks 1/2 are committed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import {
  validateImportFile,
  SUPPORTED_IMPORT_SCHEMA_VERSIONS,
} from "../src/lib/dashboardImport";

// ─── Fixture ──────────────────────────────────────────────────────────────────

/**
 * One of each entity (table, widget, layer, dynamicView, customMetric), all mutually consistent
 * (widget.config.tableId / layer.table_id / dynamicView.source_table_id / customMetric.table_id
 * all point at the one table; dashboardTableIds names it too) so every VALID-reject test can
 * mutate exactly one field of the base fixture without incidentally breaking a different check.
 */
const makeValidFile = (): any => ({
  schemaVersion: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  dashboard: {
    id: 1,
    name: "Test Dashboard",
    filter_display_mode: "topbar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  widgets: [
    {
      id: 10,
      dashboard_id: 1,
      title: "Widget One",
      type: "bar",
      position: 0,
      config: { tableId: 100 },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  layers: [
    {
      id: 20,
      dashboard_id: 1,
      table_id: 100,
      layer_type: "KineticaWms",
      position: 0,
      config: {},
      info_enabled: 1,
      info_columns: null,
      info_template: null,
      dynamic_view_id: null,
      cb_config: null,
      track_config: null,
      filter_scope: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  dynamicViews: [
    {
      id: 30,
      dashboard_id: 1,
      source_table_id: 100,
      name: "DV One",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
      columns_json: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  tables: [
    {
      id: 100,
      name: "t1",
      schema: "kbi_x",
      description: "",
      columns: { c1: "int" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  customMetrics: [
    {
      id: 40,
      table_id: 100,
      label: "M1",
      expression: "SUM(c1)",
      format_spec: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  dashboardTableIds: [100],
  danglingReferences: [],
});

beforeEach(() => {
  db.exec(`
    DELETE FROM dashboard_access_grants;
    DELETE FROM column_display_config;
    DELETE FROM dashboard_table_views;
    DELETE FROM dashboard_layers;
    DELETE FROM dashboard_dynamic_views;
    DELETE FROM widgets;
    DELETE FROM dashboard_tables;
    DELETE FROM custom_metrics;
    DELETE FROM dashboards;
    DELETE FROM tables;
    DELETE FROM sessions;
  `);
});

// ─── VALID-reject ───────────────────────────────────────────────────────────

describe("validateImportFile — Tier 1 structural rejection", () => {
  it("VALID-reject: a non-object body is rejected", () => {
    const result = validateImportFile("not an object");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBeTruthy();
      expect(result.rejection.message).toContain("body");
    }
  });

  it("VALID-reject: a missing schemaVersion is rejected", () => {
    const file = makeValidFile();
    delete file.schemaVersion;
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("schemaVersion");
  });

  it("VALID-reject: schemaVersion 2 is rejected naming both 2 and the supported version", () => {
    const file = makeValidFile();
    file.schemaVersion = 2;
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
      expect(result.rejection.message).toContain("2");
      expect(result.rejection.message).toContain(SUPPORTED_IMPORT_SCHEMA_VERSIONS.join(", "));
    }
  });

  it('VALID-reject: a missing widgets array is rejected naming "widgets"', () => {
    const file = makeValidFile();
    delete file.widgets;
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("widgets");
  });

  it("VALID-reject: widgets is rejected when it is an object rather than an array", () => {
    const file = makeValidFile();
    file.widgets = { not: "an array" };
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("widgets");
  });

  it("VALID-reject: a widget with a non-numeric id is rejected naming widgets[0].id", () => {
    const file = makeValidFile();
    file.widgets[0].id = "ten";
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("widgets[0].id");
  });

  it("VALID-reject: a widget whose config is a string is rejected naming widgets[0].config", () => {
    const file = makeValidFile();
    file.widgets[0].config = "not an object";
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("widgets[0].config");
  });

  it("VALID-reject: a layer with a missing table_id is rejected naming layers[0].table_id", () => {
    const file = makeValidFile();
    delete file.layers[0].table_id;
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("layers[0].table_id");
  });

  it("VALID-reject: a dynamic view with a non-string template_sql is rejected naming dynamicViews[0].template_sql", () => {
    const file = makeValidFile();
    file.dynamicViews[0].template_sql = 12345;
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("dynamicViews[0].template_sql");
  });

  it("VALID-reject: a table with an empty name is rejected naming tables[0].name", () => {
    const file = makeValidFile();
    file.tables[0].name = "";
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("tables[0].name");
  });

  it("VALID-reject: a custom metric with an empty expression is rejected naming customMetrics[0].expression", () => {
    const file = makeValidFile();
    file.customMetrics[0].expression = "";
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("customMetrics[0].expression");
  });

  it("VALID-reject: duplicate widget ids inside the file are rejected", () => {
    const file = makeValidFile();
    file.widgets.push({ ...file.widgets[0] });
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("10");
  });

  it("VALID-reject: a truncated file (JSON.parse of a sliced export) never reaches validateImportFile", () => {
    const file = makeValidFile();
    const json = JSON.stringify(file);
    const truncated = json.slice(0, json.length - 20); // sever mid-object, like a cut-off upload
    expect(() => JSON.parse(truncated)).toThrow();
    // Documents that truncation is caught one layer earlier than this function (Plan 120-04
    // wires the JSON.parse failure to a 400) — validateImportFile is never reached with it.
  });
});

// ─── VALID-accept / VALID-dangle / VALID-nowrite ───────────────────────────

describe("validateImportFile — acceptance and Tier 2 referential handling", () => {
  it("VALID-accept: the well-formed fixture validates with ok true", () => {
    const result = validateImportFile(makeValidFile());
    expect(result.ok).toBe(true);
  });

  it("VALID-accept: an unknown EXTRA top-level key does not cause rejection", () => {
    const file = makeValidFile();
    file.someFutureField = { anything: true };
    const result = validateImportFile(file);
    expect(result.ok).toBe(true);
  });

  it("VALID-dangle: a widget referencing a widget id absent from the file is reported, NOT rejected", () => {
    const file = makeValidFile();
    file.widgets[0].config = { sourceMapWidgetId: 999 }; // 999 does not exist in this file
    const result = validateImportFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dangling.some((d) => d.kind === "widget" && d.id === 999)).toBe(true);
    }
  });

  it("VALID-dangle: the file's own danglingReferences array is IGNORED and recomputed", () => {
    const file = makeValidFile();
    // Deliberately FALSE — nothing in this file actually references widget 999.
    file.danglingReferences = [{ from: "widget:999", kind: "widget", id: 999 }];
    const result = validateImportFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dangling.some((d) => d.id === 999)).toBe(false);
    }
  });

  it("VALID-dangle: a dashboardTableIds entry absent from tables[] is reported, not rejected", () => {
    const file = makeValidFile();
    file.dashboardTableIds = [100, 999]; // 999 has no corresponding tables[] entry
    const result = validateImportFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.dangling.some((d) => d.from === "dashboardTables" && d.kind === "table" && d.id === 999)
      ).toBe(true);
    }
  });

  it("VALID-nowrite: a rejected file performs no database write", () => {
    const before = {
      dashboards: (db.prepare("SELECT COUNT(*) as c FROM dashboards").get() as any).c,
      widgets: (db.prepare("SELECT COUNT(*) as c FROM widgets").get() as any).c,
      tables: (db.prepare("SELECT COUNT(*) as c FROM tables").get() as any).c,
      custom_metrics: (db.prepare("SELECT COUNT(*) as c FROM custom_metrics").get() as any).c,
    };

    const file = makeValidFile();
    delete file.schemaVersion; // guaranteed rejection
    const result = validateImportFile(file);
    expect(result.ok).toBe(false);

    const after = {
      dashboards: (db.prepare("SELECT COUNT(*) as c FROM dashboards").get() as any).c,
      widgets: (db.prepare("SELECT COUNT(*) as c FROM widgets").get() as any).c,
      tables: (db.prepare("SELECT COUNT(*) as c FROM tables").get() as any).c,
      custom_metrics: (db.prepare("SELECT COUNT(*) as c FROM custom_metrics").get() as any).c,
    };

    expect(after).toEqual(before);
  });
});
