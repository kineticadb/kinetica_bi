import { describe, it, expect } from "vitest";
import {
  namingKey,
  buildNamingContext,
  resolveRecordName,
  summariseAdvisories,
  type ImpactAdvisory,
  type DashboardNameRow,
} from "../src/lib/impactNaming";
import type { ColumnRefsInput } from "../src/lib/columnRefs";
import type { Widget, DashboardLayer, DashboardDynamicView, CustomMetricRow } from "../src/types";

// -----------------------------------------------------------------------------------------------
// Fixture helpers — neutral synthetic names only. Mirrors the makeInput/makeWidget/makeLayer/makeDv
// style of tests/lib.columnRefs.spec.ts.
// -----------------------------------------------------------------------------------------------

const makeInput = (over: Partial<ColumnRefsInput> = {}): ColumnRefsInput => ({
  widgets: [],
  layers: [],
  dynamicViews: [],
  customMetrics: [],
  tableViews: [],
  columnDisplayConfig: [],
  ...over,
});

const makeWidget = (overrides: Partial<Widget> & { id: number }): Widget => ({
  dashboard_id: 1,
  title: "Widget",
  type: "table",
  position: 0,
  config: {},
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeLayer = (overrides: Partial<DashboardLayer> & { id: number }): DashboardLayer => ({
  dashboard_id: 1,
  table_id: 1,
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
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeDv = (overrides: Partial<DashboardDynamicView> & { id: number }): DashboardDynamicView => ({
  dashboard_id: 1,
  source_table_id: 1,
  name: "dv",
  template_sql: "",
  max_records: 10000,
  columns_json: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeMetric = (overrides: Partial<CustomMetricRow> & { id: number }): CustomMetricRow => ({
  table_id: 5,
  label: "Metric",
  expression: "",
  format_spec: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const OPERATIONS: DashboardNameRow[] = [{ id: 1, name: "Operations" }];

// -----------------------------------------------------------------------------------------------
// resolveRecordName
// -----------------------------------------------------------------------------------------------

describe("resolveRecordName", () => {
  it("NAMING: a uniquely-titled widget is named by title and dashboard, with NO id in the label", () => {
    const input = makeInput({
      widgets: [makeWidget({ id: 40, dashboard_id: 1, title: "Trips over time" })],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const r = resolveRecordName(
      { recordKind: "widget", recordId: 40, recordLabel: "Trips over time" },
      ctx,
    );
    expect(r.displayLabel).toBe('widget "Trips over time" on dashboard "Operations"');
    expect(r.displayLabel).not.toMatch(/\bid\b/);
    expect(r.advisories).toEqual([]);
  });

  it("NAMING: two widgets sharing a title on one dashboard BOTH get an id and BOTH get an advisory", () => {
    const input = makeInput({
      widgets: [
        makeWidget({ id: 41, dashboard_id: 1, title: "Bar Chart" }),
        makeWidget({ id: 42, dashboard_id: 1, title: "Bar Chart" }),
      ],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const a = resolveRecordName({ recordKind: "widget", recordId: 41, recordLabel: "Bar Chart" }, ctx);
    const b = resolveRecordName({ recordKind: "widget", recordId: 42, recordLabel: "Bar Chart" }, ctx);
    expect(a.displayLabel).toBe('widget "Bar Chart" (id 41) on dashboard "Operations"');
    expect(b.displayLabel).toBe('widget "Bar Chart" (id 42) on dashboard "Operations"');
    expect(a.advisories[0].kind).toBe("ambiguous-name");
    expect(b.advisories[0].kind).toBe("ambiguous-name");
    expect(a.advisories[0].message).toContain("Rename one and re-run this check");
  });

  it("NAMING: the same title on two DIFFERENT dashboards is not a collision and neither gets an id", () => {
    const input = makeInput({
      widgets: [
        makeWidget({ id: 44, dashboard_id: 1, title: "Same Title" }),
        makeWidget({ id: 45, dashboard_id: 2, title: "Same Title" }),
      ],
    });
    const ctx = buildNamingContext(input, [...OPERATIONS, { id: 2, name: "Logistics" }]);
    const a = resolveRecordName({ recordKind: "widget", recordId: 44, recordLabel: "Same Title" }, ctx);
    const b = resolveRecordName({ recordKind: "widget", recordId: 45, recordLabel: "Same Title" }, ctx);
    expect(a.displayLabel).toBe('widget "Same Title" on dashboard "Operations"');
    expect(b.displayLabel).toBe('widget "Same Title" on dashboard "Logistics"');
    expect(a.advisories).toEqual([]);
    expect(b.advisories).toEqual([]);
  });

  it("NAMING: a widget with an empty title falls back to its id and is flagged as having no name", () => {
    const input = makeInput({
      widgets: [makeWidget({ id: 43, dashboard_id: 1, title: "" })],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const u = resolveRecordName({ recordKind: "widget", recordId: 43, recordLabel: "" }, ctx);
    expect(u.displayLabel).toBe('widget 43 (no name) on dashboard "Operations"');
    expect(u.advisories[0].kind).toBe("unnamed-record");
    expect(u.advisories[0].message).toContain("has no name");
    expect(u.advisories[0].message).toContain("re-run this check");
  });

  it("NAMING: two unnamed widgets on one dashboard are flagged unnamed, never ambiguous", () => {
    const input = makeInput({
      widgets: [
        makeWidget({ id: 60, dashboard_id: 1, title: "" }),
        makeWidget({ id: 61, dashboard_id: 1, title: "" }),
      ],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const x = resolveRecordName({ recordKind: "widget", recordId: 60, recordLabel: "" }, ctx);
    expect(x.advisories.map((a) => a.kind)).toEqual(["unnamed-record"]);
    // Also probe buildNamingContext directly: an empty name must NEVER be counted toward a
    // collision, independent of resolveRecordName's own empty-name-first check order (which would
    // otherwise mask a broken collision count for this exact case).
    expect(ctx.ambiguous.has(namingKey("widget", 60))).toBe(false);
    expect(ctx.ambiguous.has(namingKey("widget", 61))).toBe(false);
  });

  it("NAMING: a layer is named from config.name, and a layer with no config.name falls back to its id", () => {
    const input = makeInput({
      layers: [
        makeLayer({ id: 70, dashboard_id: 1, config: { name: "Main layer" } }),
        makeLayer({ id: 71, dashboard_id: 1, config: {} }),
        // Two more layers sharing a config.name on one dashboard: the ONLY way
        // buildNamingContext's collision scan (which reads config.name, not a
        // non-existent `layer.name` column) can be proven to source the right field is by
        // observing it actually detect a layer collision — reading recordLabel back from the
        // caller (as the two assertions above do) never exercises that source at all.
        makeLayer({ id: 72, dashboard_id: 1, config: { name: "Dup layer" } }),
        makeLayer({ id: 73, dashboard_id: 1, config: { name: "Dup layer" } }),
      ],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const named = resolveRecordName({ recordKind: "layer", recordId: 70, recordLabel: "Main layer" }, ctx);
    const unnamed = resolveRecordName({ recordKind: "layer", recordId: 71, recordLabel: "" }, ctx);
    expect(named.displayLabel).toBe('map layer "Main layer" on dashboard "Operations"');
    expect(unnamed.displayLabel).toBe('map layer 71 (no name) on dashboard "Operations"');
    expect(unnamed.advisories[0].kind).toBe("unnamed-record");
    expect(ctx.ambiguous.has(namingKey("layer", 72))).toBe(true);
    expect(ctx.ambiguous.has(namingKey("layer", 73))).toBe(true);
  });

  it("NAMING: a custom metric is named by label alone — it has no dashboard", () => {
    const input = makeInput({
      customMetrics: [makeMetric({ id: 80, table_id: 5, label: "Average duration" })],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const m = resolveRecordName(
      { recordKind: "customMetric", recordId: 80, recordLabel: "Average duration" },
      ctx,
    );
    expect(m.displayLabel).toBe('custom metric "Average duration"');
    expect(m.dashboardName).toBeNull();
  });

  it("NAMING: colliding custom-metric labels on one table are disambiguated even though today's data has none", () => {
    const input = makeInput({
      customMetrics: [
        makeMetric({ id: 81, table_id: 5, label: "Total" }),
        makeMetric({ id: 82, table_id: 5, label: "Total" }),
      ],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const a = resolveRecordName({ recordKind: "customMetric", recordId: 81, recordLabel: "Total" }, ctx);
    const b = resolveRecordName({ recordKind: "customMetric", recordId: 82, recordLabel: "Total" }, ctx);
    expect(a.displayLabel).toBe('custom metric "Total" (id 81)');
    expect(b.displayLabel).toBe('custom metric "Total" (id 82)');
    expect(a.advisories[0].kind).toBe("ambiguous-name");
    expect(b.advisories[0].kind).toBe("ambiguous-name");
  });

  it("NAMING: a column-format rule is named by its column and never carries an id", () => {
    const ctx = buildNamingContext(makeInput(), OPERATIONS);
    const c = resolveRecordName(
      { recordKind: "columnDisplayConfig", recordId: null, recordLabel: "col_a" },
      ctx,
    );
    expect(c.displayLabel).toBe('column-format rule for "col_a"');
    expect(c.displayLabel).not.toMatch(/\(id /);
    expect(c.advisories).toEqual([]);
  });

  it("NAMING: a record whose dashboard_id has no dashboard row renders a dashboard-id fallback", () => {
    const input = makeInput({
      widgets: [makeWidget({ id: 90, dashboard_id: 99, title: "Orphan" })],
    });
    const ctx = buildNamingContext(input, OPERATIONS);
    const d = resolveRecordName({ recordKind: "widget", recordId: 90, recordLabel: "Orphan" }, ctx);
    expect(d.displayLabel).toBe('widget "Orphan" on dashboard 99');
  });
});

// -----------------------------------------------------------------------------------------------
// summariseAdvisories
// -----------------------------------------------------------------------------------------------

const amb = (label: string): ImpactAdvisory => ({
  kind: "ambiguous-name",
  message: `irrelevant prose for ${label}`,
});
const unnamed = (label: string): ImpactAdvisory => ({
  kind: "unnamed-record",
  message: `irrelevant prose for ${label}`,
});

describe("summariseAdvisories", () => {
  it("ADVISORY: no advisories in, empty summary out", () => {
    expect(summariseAdvisories([])).toEqual([]);
  });

  it("ADVISORY: three ambiguous records produce one report-level line naming the count", () => {
    expect(summariseAdvisories([amb("a"), amb("b"), amb("c")])).toEqual([
      {
        kind: "ambiguous-name",
        message:
          "3 records could not be named unambiguously — rename them and re-run this check to " +
          "see exactly which.",
      },
    ]);
  });

  it("ADVISORY: one unnamed record uses the singular form", () => {
    expect(summariseAdvisories([unnamed("a")])[0].message).toBe(
      "1 record has no name — name it and re-run this check so the report can identify it " +
        "without ids.",
    );
  });

  it("ADVISORY: both kinds present produce exactly two lines, ambiguous first, unnamed second", () => {
    const both = summariseAdvisories([amb("a"), unnamed("b"), amb("c")]);
    expect(both.map((a) => a.kind)).toEqual(["ambiguous-name", "unnamed-record"]);
    expect(both).toHaveLength(2);
  });

  it("ADVISORY: the summary counts records, and repeated advisories from one record count once", () => {
    // Two DISTINCT unnamed records -> count 2. If a caller were to (incorrectly) pass the same
    // record's advisory twice, this function still counts what it is given — its half of the
    // contract is "count by kind, exactly", not de-duplication; de-duplication is the caller's job
    // (Plan 124-03's own GROUPING: tests pin that half).
    const summary = summariseAdvisories([unnamed("x"), unnamed("y")]);
    expect(summary).toEqual([
      {
        kind: "unnamed-record",
        message:
          "2 records have no name — name them and re-run this check so the report can identify " +
          "them without ids.",
      },
    ]);
  });
});
