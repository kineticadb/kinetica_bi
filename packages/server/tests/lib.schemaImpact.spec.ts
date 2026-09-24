import { describe, it, expect } from "vitest";
import {
  certaintyProse,
  buildImpactReport,
  COLUMNS_JSON_TYPE_GAP,
  type ImpactInput,
} from "../src/lib/schemaImpact";
import type { ColumnFingerprint } from "../src/lib/schemaFingerprint";
import type { SchemaCheckResult } from "../src/lib/schemaDiff";
import type { ColumnRefsInput, DashboardNameRow } from "../src/lib/columnRefs";
import type { Widget, DashboardLayer, DashboardDynamicView, CustomMetricRow, DashboardTableView, ColumnDisplayConfigRow } from "../src/types";

// -----------------------------------------------------------------------------------------------
// Fixture helpers. Neutral synthetic names only (per CLAUDE.md dataset-hygiene rule) — real row
// SHAPES were read read-only from packages/server/data/kinetica.db (widget config keys,
// drillDownColumnType presence, layer config.name) and are labelled REAL-SHAPE below where used;
// everything else is SYNTHETIC.
// -----------------------------------------------------------------------------------------------

const fp = (base: string, refinements: string[] = []): ColumnFingerprint => ({ base, refinements });

type DiffCheck = Extract<SchemaCheckResult, { outcome: "diff" }>;

const makeCheck = (overrides: Partial<DiffCheck> = {}): DiffCheck => ({
  outcome: "diff",
  table: "demo_table",
  hasChanges: true,
  added: [],
  removed: [],
  retyped: [],
  live: {},
  ...overrides,
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

const makeCustomMetric = (overrides: Partial<CustomMetricRow> & { id: number }): CustomMetricRow => ({
  table_id: 1,
  label: "metric",
  expression: "",
  format_spec: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeTableView = (overrides: Partial<DashboardTableView> & { id: number }): DashboardTableView => ({
  dashboard_id: 1,
  table_id: 1,
  view_name: "view",
  filter_clause: "",
  status: "created",
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeCdc = (overrides: Partial<ColumnDisplayConfigRow> & { table_id: number; column_name: string }): ColumnDisplayConfigRow => ({
  label: null,
  format_spec: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeRefsInput = (overrides: Partial<ColumnRefsInput> = {}): ColumnRefsInput => ({
  widgets: [],
  layers: [],
  dynamicViews: [],
  customMetrics: [],
  tableViews: [],
  columnDisplayConfig: [],
  ...overrides,
});

const makeArgs = (overrides: Partial<ImpactInput> = {}): ImpactInput => ({
  check: makeCheck(),
  tableId: 1,
  refsInput: makeRefsInput(),
  dashboards: [] as DashboardNameRow[],
  ...overrides,
});

// -----------------------------------------------------------------------------------------------

describe("certaintyProse", () => {
  it("CERTAINTY: an exact structured reference reads as confirmed", () => {
    const prose = certaintyProse("col_a", "config.metricColumn", "exact", "scoped");
    expect(prose).toContain("confirmed —");
    expect(prose).not.toContain("possibly affected");
  });

  it("CERTAINTY: a heuristic free-SQL reference reads as possibly affected, never confirmed", () => {
    const prose = certaintyProse("col_a", "config.sql", "heuristic", "free-sql");
    expect(prose).toContain("possibly affected");
    expect(prose).not.toContain("confirmed");
  });

  it("CERTAINTY: a low-confidence reference says the name is short or common", () => {
    const prose = certaintyProse("id", "config.sql", "low-confidence", "free-sql");
    expect(prose).toContain("possibly affected");
    expect(prose).toContain("short or common");
    expect(prose).not.toContain("confirmed");
  });

  it("CERTAINTY: an unresolved table scope is stated honestly on top of the tier prose", () => {
    const exactUnresolved = certaintyProse("col_a", "config.metricColumn", "exact", "unresolved");
    expect(exactUnresolved).toContain("confirmed —");
    expect(exactUnresolved).toContain("This record's own table could not be determined");

    const heuristicResolved = certaintyProse("col_a", "config.sql", "heuristic", "free-sql");
    expect(heuristicResolved).not.toContain("This record's own table could not be determined");
  });
});

describe("buildImpactReport — sections", () => {
  it("SECTION: all three sections are always present, in breaking / changed / harmless order", () => {
    const report = buildImpactReport(makeArgs());
    expect(report.sections.map((s) => s.severity)).toEqual(["breaking", "changed", "harmless"]);
    expect(report.sections).toHaveLength(3);
  });

  it("SECTION: a removed column is breaking and carries its stored type with no live type", () => {
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_removed", stored: fp("string", []), storedType: "string" }],
        }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_removed")!;
    expect(col).toBeDefined();
    expect(col.changeKind).toBe("removed");
    expect(col.storedType).toBe("string");
    expect(col.liveType).toBeNull();
    expect(col.storedClass).toBe("string");
    expect(col.liveClass).toBeNull();
  });

  it("SECTION: a timestamp -> bigint retype lands in breaking and states both types", () => {
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          retyped: [
            {
              column: "col_time",
              stored: fp("long", ["timestamp"]),
              storedType: "long(timestamp)",
              live: fp("long", []),
              liveType: "long",
            },
          ],
        }),
      }),
    );
    const retypedEntry = report.sections[0].columns.find((c) => c.column === "col_time")!;
    expect(retypedEntry).toBeDefined();
    expect(retypedEntry.storedType).toBe("long(timestamp)");
    expect(retypedEntry.liveType).toBe("long");
    expect(retypedEntry.storedClass).toBe("datetime");
    expect(retypedEntry.liveClass).toBe("number");
  });

  it("SECTION: an int -> double retype lands in changed and states both types", () => {
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          retyped: [
            {
              column: "col_num",
              stored: fp("int", []),
              storedType: "int",
              live: fp("double", []),
              liveType: "double",
            },
          ],
        }),
      }),
    );
    const changedEntry = report.sections[1].columns.find((c) => c.column === "col_num")!;
    expect(changedEntry).toBeDefined();
    expect(changedEntry.storedType).toBe("int");
    expect(changedEntry.liveType).toBe("double");
    expect(changedEntry.storedClass).toBe("number");
    expect(changedEntry.liveClass).toBe("number");
  });

  it("SECTION: an added column lands in harmless with no records, and appears in NO other section", () => {
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          added: [{ column: "col_added", live: fp("string", []), liveType: "string" }],
        }),
      }),
    );
    const breakingColumns = report.sections[0].columns.map((c) => c.column);
    const changedColumns = report.sections[1].columns.map((c) => c.column);
    expect(breakingColumns).not.toContain("col_added");
    expect(changedColumns).not.toContain("col_added");
    expect(report.sections[2].columns[0].column).toBe("col_added");
    expect(report.sections[2].columns[0].changeKind).toBe("added");
    expect(report.sections[2].columns[0].records).toEqual([]);
  });

  it("SECTION: a removed column found ONLY in free SQL stays breaking and is worded possibly affected", () => {
    // REAL-SHAPE: widget.config.sql is a plain string field, per packages/server/data/kinetica.db.
    const widget = makeWidget({ id: 1, config: { sql: "select col_free from t" } });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_free", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ widgets: [widget] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_free")!;
    expect(col).toBeDefined();
    expect(col.records).toHaveLength(1);
    expect(report.sections[0].columns[0].records[0].references[0].confidence).toBe("heuristic");
    expect(report.sections[0].columns[0].records[0].references[0].certainty).toContain(
      "possibly affected",
    );
  });

  it("SECTION: an unchanged check returns outcome no_changes with three empty sections", () => {
    const report = buildImpactReport(
      makeArgs({ check: makeCheck({ hasChanges: false, added: [], removed: [], retyped: [] }) }),
    );
    expect(report.outcome).toBe("no_changes");
    expect(report.sections[0].columns).toEqual([]);
    expect(report.sections[1].columns).toEqual([]);
    expect(report.sections[2].columns).toEqual([]);
  });
});

describe("buildImpactReport — grouping", () => {
  it("GROUPING: a widget matching a column through BOTH a structured field and its config.sql appears once, with two references", () => {
    // REAL-SHAPE: config.metricColumn (value equality) and config.sql (free text) are both real
    // widget.config keys observed in packages/server/data/kinetica.db.
    const widget = makeWidget({
      id: 1,
      config: { metricColumn: "col_g", sql: "select col_g from t" },
    });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_g", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ widgets: [widget] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_g")!;
    expect(col.records).toHaveLength(1);
    expect(col.records[0].references.map((r) => r.site)).toEqual(["widget.config.metricColumn", "widget.config.sql"]);
  });

  it("GROUPING: two different widgets referencing one column are two records under that column", () => {
    const w1 = makeWidget({ id: 1, config: { metricColumn: "col_two" } });
    const w2 = makeWidget({ id: 2, config: { metricColumn: "col_two" } });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_two", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ widgets: [w1, w2] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_two")!;
    expect(col.records).toHaveLength(2);
  });

  it("GROUPING: a column-format rule bound to an affected column appears as its own record", () => {
    const cdc = makeCdc({ table_id: 1, column_name: "col_fmt" });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_fmt", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ columnDisplayConfig: [cdc] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_fmt")!;
    expect(col.records).toHaveLength(1);
    expect(col.records[0].recordKind).toBe("columnDisplayConfig");
  });

  it("GROUPING: reordering the input rows produces byte-identical JSON", () => {
    // P9 amendment (plan checker, 2026-09-24): "B_col" vs "a_col" provably diverges between
    // byte-ascending order (B=0x42 before a=0x61) and a typical case-insensitive localeCompare
    // (which would put a_col first) — a lowercase-only fixture cannot discriminate the two.
    const w1 = makeWidget({ id: 1, config: { metricColumn: "B_col" } });
    const w2 = makeWidget({ id: 2, config: { metricColumn: "a_col" } });

    const args = makeArgs({
      check: makeCheck({
        removed: [
          { column: "B_col", stored: fp("string", []), storedType: "string" },
          { column: "a_col", stored: fp("string", []), storedType: "string" },
        ],
      }),
      refsInput: makeRefsInput({ widgets: [w1, w2] }),
    });
    const shuffledArgs = makeArgs({
      check: makeCheck({
        removed: [
          { column: "a_col", stored: fp("string", []), storedType: "string" },
          { column: "B_col", stored: fp("string", []), storedType: "string" },
        ],
      }),
      refsInput: makeRefsInput({ widgets: [w2, w1] }),
    });

    expect(JSON.stringify(buildImpactReport(shuffledArgs))).toBe(
      JSON.stringify(buildImpactReport(args)),
    );

    // The byte-ascending requirement itself: "B_col" (0x42) sorts before "a_col" (0x61).
    const report = buildImpactReport(args);
    expect(report.sections[0].columns.map((c) => c.column)).toEqual(["B_col", "a_col"]);
  });
});

describe("COLUMNS_JSON_TYPE_GAP", () => {
  it("is recorded verbatim in knownGaps", () => {
    const report = buildImpactReport(makeArgs());
    expect(report.knownGaps).toEqual([COLUMNS_JSON_TYPE_GAP]);
    expect(COLUMNS_JSON_TYPE_GAP).toContain("second frozen type cache");
  });
});

describe("buildImpactReport — frozen drill-down type", () => {
  // REAL-SHAPE: config.drillDownColumn / config.drillDownColumnType are real widget.config keys
  // (packages/server/data/kinetica.db: widget 4's config carries drillDownColumn: "vendor_id",
  // drillDownColumnType: "string" — the value observed here is neutral/synthetic, the KEYS and
  // their shape are real).
  const breakingRetype = () =>
    makeCheck({
      retyped: [
        {
          column: "col_dd",
          stored: fp("string", []),
          storedType: "string",
          live: fp("long", ["timestamp"]),
          liveType: "long(timestamp)",
        },
      ],
    });

  it("STALE: a breaking retype flags a widget carrying a frozen drillDownColumnType for that column", () => {
    const widget = makeWidget({
      id: 1,
      config: { drillDownColumn: "col_dd", drillDownColumnType: "string" },
    });
    const report = buildImpactReport(
      makeArgs({ check: breakingRetype(), refsInput: makeRefsInput({ widgets: [widget] }) }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_dd")!;
    const rec = col.records[0];
    expect(rec.staleDrillDownType).toEqual({
      frozenType: "string",
      message:
        'This widget\'s drill-down is frozen at type "string", but the column is now ' +
        "datetime. It keeps filtering with the stale type until someone reopens its config " +
        "and re-picks the column — nothing errors in the meantime.",
    });
  });

  it("STALE: the flag names the frozen type and says the widget keeps filtering with the stale type", () => {
    const widget = makeWidget({
      id: 1,
      config: { drillDownColumn: "col_dd", drillDownColumnType: "string" },
    });
    const report = buildImpactReport(
      makeArgs({ check: breakingRetype(), refsInput: makeRefsInput({ widgets: [widget] }) }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_dd")!;
    const rec = col.records[0];
    expect(rec.staleDrillDownType?.frozenType).toBe("string");
    expect(rec.staleDrillDownType?.message).toContain("keeps filtering with the stale type");
  });

  it("STALE: a CHANGED retype does not flag the frozen type, because the class still holds", () => {
    const widget = makeWidget({
      id: 1,
      config: { drillDownColumn: "col_num", drillDownColumnType: "int" },
    });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          retyped: [
            { column: "col_num", stored: fp("int", []), storedType: "int", live: fp("double", []), liveType: "double" },
          ],
        }),
        refsInput: makeRefsInput({ widgets: [widget] }),
      }),
    );
    const changedRec = report.sections[1].columns.find((c) => c.column === "col_num")!.records[0];
    expect(changedRec.staleDrillDownType).toBeUndefined();
  });

  it("STALE: a widget with no drillDownColumnType is not flagged even under a breaking retype", () => {
    const widget = makeWidget({ id: 1, config: { drillDownColumn: "col_dd" } });
    const report = buildImpactReport(
      makeArgs({ check: breakingRetype(), refsInput: makeRefsInput({ widgets: [widget] }) }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_dd")!;
    const noFrozenRec = col.records[0];
    expect(noFrozenRec.staleDrillDownType).toBeUndefined();
  });

  it("STALE: the frozen type for a DIFFERENT column does not flag this column's finding", () => {
    const widget = makeWidget({
      id: 1,
      config: {
        metricColumn: "col_dd",
        drillDownColumn: "other_col",
        drillDownColumnType: "string",
      },
    });
    const report = buildImpactReport(
      makeArgs({ check: breakingRetype(), refsInput: makeRefsInput({ widgets: [widget] }) }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_dd")!;
    expect(col.records[0].staleDrillDownType).toBeUndefined();
  });

  it("STALE: a non-widget record is never flagged", () => {
    const cdc = makeCdc({ table_id: 1, column_name: "col_dd" });
    const report = buildImpactReport(
      makeArgs({ check: breakingRetype(), refsInput: makeRefsInput({ columnDisplayConfig: [cdc] }) }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_dd")!;
    const cdcRec = col.records.find((r) => r.recordKind === "columnDisplayConfig")!;
    expect(cdcRec.staleDrillDownType).toBeUndefined();
  });
});

describe("buildImpactReport — column display config", () => {
  it("GROUPING: a column-format rule bound to a REMOVED column appears in the breaking section", () => {
    const cdc = makeCdc({ table_id: 1, column_name: "col_cdc" });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_cdc", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ columnDisplayConfig: [cdc] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_cdc")!;
    expect(col).toBeDefined();
    const cdcRecord = col.records.find((r) => r.recordKind === "columnDisplayConfig")!;
    expect(cdcRecord).toBeDefined();
  });

  it("GROUPING: a column-format rule record carries recordId null and a label naming its column", () => {
    const cdc = makeCdc({ table_id: 1, column_name: "col_cdc" });
    const report = buildImpactReport(
      makeArgs({
        check: makeCheck({
          removed: [{ column: "col_cdc", stored: fp("string", []), storedType: "string" }],
        }),
        refsInput: makeRefsInput({ columnDisplayConfig: [cdc] }),
      }),
    );
    const col = report.sections[0].columns.find((c) => c.column === "col_cdc")!;
    const cdcRecord = col.records.find((r) => r.recordKind === "columnDisplayConfig")!;
    expect(cdcRecord.recordKind).toBe("columnDisplayConfig");
    expect(cdcRecord.recordId).toBeNull();
    expect(cdcRecord.displayLabel).toContain("col_cdc");
  });
});
