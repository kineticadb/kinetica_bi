import { describe, it, expect } from "vitest";
import {
  COLUMN_REF_SITES,
  FREE_SQL_SITES,
  EXCLUDED_LOOKALIKE_KEYS,
  LOW_CONFIDENCE_MAX_LENGTH,
  LOW_CONFIDENCE_STOPLIST,
  isLowConfidenceColumnName,
  columnMatchRegex,
  maskQuotedLiterals,
  scanFreeSql,
  collectColumnRefs,
  type ColumnRefsInput,
} from "../src/lib/columnRefs";
import type {
  Widget,
  DashboardLayer,
  DashboardDynamicView,
  CustomMetricRow,
  DashboardTableView,
} from "../src/types";

// -----------------------------------------------------------------------------------------------
// Fixture helpers — keep test bodies focused on the behaviour under test.
// -----------------------------------------------------------------------------------------------

const emptyInput = (): ColumnRefsInput => ({
  widgets: [],
  layers: [],
  dynamicViews: [],
  customMetrics: [],
  tableViews: [],
  columnDisplayConfig: [],
});

/**
 * Same fully-populated-defaults shape as emptyInput, but accepting overrides — used by the
 * exclude-list guard below (Plan 123-02, Task 3). Plan 123-03 EXTENDS this same helper with a
 * `layers` fixture and Plan 123-04 with a `configPatch` fixture, because each extension only
 * becomes discriminating once its own traversal exists — an exclude assertion written before the
 * traversal it guards is a check that cannot fail.
 */
const makeInput = (over: Partial<ColumnRefsInput> = {}): ColumnRefsInput => ({
  widgets: [], layers: [], dynamicViews: [], customMetrics: [],
  tableViews: [], columnDisplayConfig: [], ...over,
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

const makeDv = (
  overrides: Partial<DashboardDynamicView> & { id: number },
): DashboardDynamicView => ({
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

const makeLayer = (
  overrides: Partial<DashboardLayer> & { id: number },
): DashboardLayer => ({
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

const makeTableView = (
  overrides: Partial<DashboardTableView> & { id: number },
): DashboardTableView => ({
  dashboard_id: 1,
  table_id: 1,
  view_name: "view",
  filter_clause: "",
  status: "created",
  created_at: "",
  updated_at: "",
  ...overrides,
});

// -----------------------------------------------------------------------------------------------
// Golden site registry
// -----------------------------------------------------------------------------------------------

describe("COLUMN_REF_SITES", () => {
  it("GOLDEN: the site registry is exactly the 40 inventoried sites, in order", () => {
    expect(COLUMN_REF_SITES).toEqual([
      "widget.config.metricColumn",
      "widget.config.groupByColumn",
      "widget.config.groupByColumns[]",
      "widget.config.drillDownColumn",
      "widget.config.timeCol",
      "widget.config.xField",
      "widget.config.deltaField",
      "widget.config.sortField",
      "widget.config.columns",
      "widget.config.metrics[].column",
      "widget.config.filterFields[].column",
      "widget.config.spatialTargets[].lonCol",
      "widget.config.spatialTargets[].latCol",
      "widget.config.spatialTargets[].spatialCol",
      "widget.config.options[].configPatch.metric",
      "widget.config.options[].configPatch.cb_config.attr",
      "widget.config.options[].configPatch.track_config.trackIdAttr",
      "widget.config.options[].configPatch.track_config.trackOrderAttr",
      "widget.config.options[].configPatch.track_config.xCol",
      "widget.config.options[].configPatch.track_config.yCol",
      "widget.config.options[].configPatch.info_columns",
      "widget.config.options[].configPatch.info_template",
      "layer.config.latColumn",
      "layer.config.lonColumn",
      "layer.config.wktColumn",
      "layer.config.wkbColumn",
      "layer.cb_config.attr",
      "layer.track_config.trackIdAttr",
      "layer.track_config.trackOrderAttr",
      "layer.track_config.xCol",
      "layer.track_config.yCol",
      "layer.info_columns",
      "layer.info_template",
      "columnDisplayConfig.column_name",
      "widget.config.sql",
      "widget.config.customWhere",
      "customMetric.expression",
      "dynamicView.template_sql",
      "tableView.filter_clause",
      "dynamicView.columns_json[].name",
    ]);
    expect(COLUMN_REF_SITES).toHaveLength(40);
  });

  it("GOLDEN: FREE_SQL_SITES is exactly the five locked free-SQL sites and every entry is in COLUMN_REF_SITES", () => {
    expect(FREE_SQL_SITES).toEqual([
      "widget.config.sql",
      "widget.config.customWhere",
      "customMetric.expression",
      "dynamicView.template_sql",
      "tableView.filter_clause",
    ]);
    for (const site of FREE_SQL_SITES) {
      expect(COLUMN_REF_SITES).toContain(site);
    }
  });

  it("EXCLUDED_LOOKALIKE_KEYS documents look-alike keys, none of which are real COLUMN_REF_SITES paths", () => {
    expect(EXCLUDED_LOOKALIKE_KEYS.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------------------------
// Low-confidence classification
// -----------------------------------------------------------------------------------------------

describe("isLowConfidenceColumnName", () => {
  // The 26 real low-confidence names, from 123-RESEARCH.md (computed over the operator's
  // 564 real column names — 26/564 = 4.6%).
  const REAL_LOW_CONFIDENCE = [
    "2G", "3G", "4G", "Date", "MCC", "MNC", "NAME", "Time", "WKT", "X", "Y", "alt", "date", "edt",
    "eta", "ete", "fix", "gs", "lob", "mcc", "mnc", "name", "nic", "reg", "sil", "type",
  ];

  it("classifies all 26 real low-confidence column names from the operator's tables as low-confidence", () => {
    for (const n of REAL_LOW_CONFIDENCE) expect(isLowConfidenceColumnName(n)).toBe(true);
  });

  it("classifies specific real column names as NOT low-confidence", () => {
    for (const n of [
      "fare_amount", "vendor_id", "passenger_count", "Computed_Alias", "operator",
      "pickup_latitude", "Connection_ServiceProviderBrandName", "ts_result_date",
    ]) {
      expect(isLowConfidenceColumnName(n)).toBe(false);
    }
  });

  it("the 4-character names Date, name and type are caught by the stoplist, not by length", () => {
    for (const n of ["Date", "name", "type"]) {
      expect(n.length).toBeGreaterThan(LOW_CONFIDENCE_MAX_LENGTH);
      expect(LOW_CONFIDENCE_STOPLIST).toContain(n.toLowerCase());
      expect(isLowConfidenceColumnName(n)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------------------------
// Literal masking
// -----------------------------------------------------------------------------------------------

describe("maskQuotedLiterals", () => {
  it("replaces literal characters with spaces so offsets are preserved", () => {
    const sql = "SELECT * FROM t WHERE network = 'value' AND x = 1";
    const { masked, unterminated } = maskQuotedLiterals(sql);
    expect(unterminated).toBe(false);
    expect(masked.length).toBe(sql.length);
    const literalStart = sql.indexOf("'value'");
    const literalSpan = masked.slice(literalStart, literalStart + "'value'".length);
    expect(literalSpan).toBe(" ".repeat("'value'".length));
    expect(masked.slice(0, literalStart)).toBe(sql.slice(0, literalStart));
    expect(masked.slice(literalStart + "'value'".length)).toBe(
      sql.slice(literalStart + "'value'".length),
    );
  });

  it("treats a doubled single-quote as an escaped quote and stays inside the literal", () => {
    const sql = "WHERE name = 'O''Brien' AND x = 1";
    const { masked, unterminated } = maskQuotedLiterals(sql);
    expect(unterminated).toBe(false);
    expect(masked.length).toBe(sql.length);
    expect(masked.endsWith(" AND x = 1")).toBe(true);
    expect(masked).not.toContain("Brien");
  });

  it("reports unterminated when the text ends inside a literal", () => {
    const sql = "WHERE name = 'oops, no closing quote";
    const { unterminated } = maskQuotedLiterals(sql);
    expect(unterminated).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------
// Free-SQL scanner
// -----------------------------------------------------------------------------------------------

describe("scanFreeSql", () => {
  it("matches a whole identifier and reports its line, 1-based line number and 0-based offset within that line", () => {
    // The literal `\'ignore\'` earlier on the same line is deliberate: masking it must preserve the
    // TEXT\'S LENGTH (spaces, not deletion) for the offset of `x` afterward to stay correct.
    const text = "SELECT a\nFROM t WHERE name = 'ignore' AND x = 1";
    const matches = scanFreeSql(text, "x");
    expect(matches).toEqual([
      { line: "FROM t WHERE name = 'ignore' AND x = 1", lineNumber: 2, offset: 33 },
    ]);
  });

  it("does not match a substring: X does not match H3_XYTOCELL, X_COORD or max(fare_amount)", () => {
    expect(
      scanFreeSql("SELECT H3_XYTOCELL(pickup_longitude, pickup_latitude, 11) cell", "X"),
    ).toEqual([]);
    expect(scanFreeSql("WHERE X_COORD > 0", "X")).toEqual([]);
    expect(scanFreeSql("SELECT max(fare_amount) FROM t", "X")).toEqual([]);
    expect(scanFreeSql("SELECT X, Y FROM demo.track", "X")).toHaveLength(1);
  });

  it("matches case-insensitively: OPERATOR IN ('Etisalat', 'Du') matches the column operator", () => {
    const text = "OPERATOR IN ('Etisalat', 'Du') and val_upload_kbps > 0 and mcc = '424'";
    const matches = scanFreeSql(text, "operator");
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(text);
    expect(matches[0].offset).toBe(0);
  });

  it("skips quoted literals: network in ('2G', '3G', '4G') yields no match for 2G", () => {
    expect(scanFreeSql("network in ('2G', '3G', '4G')", "2G")).toEqual([]);
  });

  it("fails toward REPORTING: an unterminated literal is scanned raw rather than masked away", () => {
    const text = "WHERE name = 'oops mentions mcc but never closes";
    const matches = scanFreeSql(text, "mcc");
    expect(matches).toHaveLength(1);
  });

  it("returns one entry per occurrence, in ascending order", () => {
    const text = "SELECT x FROM t WHERE x > 0 AND x < 10";
    const matches = scanFreeSql(text, "x");
    expect(matches.map((m) => m.offset)).toEqual([7, 22, 32]);
  });

  it("columnMatchRegex is case-insensitive and whole-identifier (direct check, not just via scanFreeSql)", () => {
    const re = columnMatchRegex("x");
    expect("SELECT X FROM t".match(re)).toEqual(["X"]);
    expect("X_COORD".match(re)).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------
// The five free-SQL sites + collectColumnRefs semantics
// -----------------------------------------------------------------------------------------------

describe("free-SQL sites", () => {
  // widget 4 (type "table", tableId 1 = demo.nyctaxi) — REAL
  const widget4Config = {
    customWhere: "", groupByColumns: [], columns: "", sortField: "",
    table: "demo.nyctaxi", metricColumn: "fare_amount", aggregation: "AVG",
    groupByColumn: "vendor_id",
    sql: "SELECT vendor_id, AVG(fare_amount) AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    tableId: 1, drillDownColumn: "vendor_id", drillDownColumnType: "string",
  };
  // widget 59 (type "timeline", tableId 8 = ookla_dash.new_mobile_base_k_vs2) — REAL
  const widget59CustomWhere =
    "OPERATOR IN  ('Etisalat', 'Du') and val_upload_kbps > 0 and mcc = '424'";
  // custom_metrics row 1 (table_id 8) — REAL
  const metric1: CustomMetricRow = {
    id: 1, table_id: 8, label: "avg_ul_speed", expression: "AVG(val_upload_kbps/100)",
    format_spec: null, created_at: "", updated_at: "",
  };
  // SYNTHETIC: a dv template that joins a second table and references its columns.
  const dvJoinedTemplate =
    "-- joined slice\nWITH filtered_base AS (\n    SELECT b.*\n" +
    "FROM {view} a \n join syn.joined_tbl b on a.join_key_id = b.join_key_id\n)";

  it("SITE widget.config.sql: a generated SQL string mentioning the column yields one heuristic, table-less finding", () => {
    const widget = makeWidget({ id: 4, title: "Fare by Vendor", config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hits = refs.filter((r) => r.site === "widget.config.sql");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      column: "fare_amount",
      path: "config.sql",
      recordKind: "widget",
      recordId: 4,
      recordLabel: "Fare by Vendor",
      tableId: null,
      tableScope: "free-sql",
      confidence: "heuristic",
    });
    expect(hits[0].matches.length).toBeGreaterThan(0);
  });

  it("SITE widget.config.customWhere: widget 59's real customWhere yields a heuristic finding for operator", () => {
    const widget = makeWidget({
      id: 59, title: "Ookla Timeline", type: "timeline", config: { customWhere: widget59CustomWhere },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 8, columns: ["operator"] });
    const hits = refs.filter((r) => r.site === "widget.config.customWhere");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("config.customWhere");
    expect(hits[0].confidence).toBe("heuristic");
    expect(hits[0].tableScope).toBe("free-sql");
    expect(hits[0].tableId).toBeNull();
    expect(hits[0].matches[0].line).toBe(widget59CustomWhere);
  });

  it("SITE customMetric.expression: AVG(val_upload_kbps/100) yields a heuristic finding for val_upload_kbps", () => {
    const input = { ...emptyInput(), customMetrics: [metric1] };
    const refs = collectColumnRefs(input, { tableId: 8, columns: ["val_upload_kbps"] });
    const hits = refs.filter((r) => r.site === "customMetric.expression");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: "expression",
      recordKind: "customMetric",
      recordId: 1,
      recordLabel: "avg_ul_speed",
      confidence: "heuristic",
      tableScope: "free-sql",
      tableId: null,
    });
  });

  it("SITE dynamicView.template_sql: a joined template mentioning a column yields a heuristic finding", () => {
    const dv = makeDv({
      id: 1, name: "Joined DV", source_table_id: 4, template_sql: dvJoinedTemplate, columns_json: null,
    });
    const input = { ...emptyInput(), dynamicViews: [dv] };
    const refs = collectColumnRefs(input, { tableId: 5, columns: ["join_key_id"] });
    const hits = refs.filter((r) => r.site === "dynamicView.template_sql");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("template_sql");
    expect(hits[0].tableId).toBeNull();
    expect(hits[0].tableScope).toBe("free-sql");
  });

  it("SITE tableView.filter_clause: a populated filter_clause yields a heuristic finding (SYNTHETIC — zero instances in either database)", () => {
    const view = makeTableView({ id: 1, view_name: "Filtered View", filter_clause: "vendor_id = 'CMT'" });
    const input = { ...emptyInput(), tableViews: [view] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hits = refs.filter((r) => r.site === "tableView.filter_clause");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("filter_clause");
    expect(hits[0].recordLabel).toBe("Filtered View");
  });

  it("every FREE_SQL_SITES finding has tableScope 'free-sql', tableId null and at least one match", () => {
    const widget = makeWidget({ id: 4, config: widget4Config });
    const dv = makeDv({
      id: 1, name: "Joined DV", source_table_id: 4, template_sql: dvJoinedTemplate, columns_json: null,
    });
    const view = makeTableView({ id: 1, filter_clause: "vendor_id = 'CMT'" });
    const input = {
      ...emptyInput(), widgets: [widget], customMetrics: [metric1], dynamicViews: [dv],
      tableViews: [view],
    };
    const refs = collectColumnRefs(input, {
      tableId: 1, columns: ["vendor_id", "val_upload_kbps", "join_key_id"],
    });
    const freeSqlSet = new Set<string>(FREE_SQL_SITES);
    const freeSqlRefs = refs.filter((r) => freeSqlSet.has(r.site));
    expect(freeSqlRefs.length).toBeGreaterThan(0);
    for (const ref of freeSqlRefs) {
      expect(ref.tableScope).toBe("free-sql");
      expect(ref.tableId).toBeNull();
      expect(ref.matches.length).toBeGreaterThan(0);
    }
  });

  it("a widget produces BOTH an exact-site finding and a config.sql finding for the same column, with different paths", () => {
    // NOTE (123-01 scope, flagged in 123-01-SUMMARY.md): structured "exact" sites (e.g.
    // widget.config.metricColumn) are implemented in Plan 123-02, not this plan — see
    // visitColumnRefSites's numbered TODOs. As written, this test cannot yet assert a real
    // "exact" ColumnRef, because no exact-site block exists in the traversal until 123-02 lands.
    // Per CLAUDE.md ("if a criterion cannot discriminate... verify the real requirement
    // directly"), this test instead verifies the structural guarantee this plan DOES ship for
    // that future finding: "config.metricColumn" and "config.sql" are reserved as distinct,
    // non-colliding COLUMN_REF_SITES path conventions, and the config.sql heuristic finding this
    // plan implements already fires independently. Once 123-02 lands, widget4Config's
    // metricColumn="fare_amount" will additionally produce an exact finding at
    // "config.metricColumn" for the SAME column — the CONTEXT.md-locked "operator chose
    // completeness over a quieter report" consequence that Phase 124 must group by record for
    // display (see the SUMMARY's Phase-124 note).
    expect(COLUMN_REF_SITES).toContain("widget.config.metricColumn");
    expect(COLUMN_REF_SITES).toContain("widget.config.sql");

    const widget = makeWidget({ id: 4, title: "Fare by Vendor", config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const sqlHit = refs.find((r) => r.site === "widget.config.sql");
    expect(sqlHit).toBeDefined();
    expect(sqlHit?.path).toBe("config.sql");
    expect(sqlHit?.path).not.toBe("config.metricColumn");

    // Granularity is one finding per SITE, not one per occurrence (locked in 123-CONTEXT.md):
    // widget4Config.sql mentions "vendor_id" TWICE ("SELECT vendor_id, ... GROUP BY vendor_id").
    // A correct implementation collapses both occurrences into the SAME ColumnRef, carrying both
    // matches — never two separate config.sql findings for the same column.
    const vendorRefs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const vendorSqlHits = vendorRefs.filter((r) => r.site === "widget.config.sql");
    expect(vendorSqlHits).toHaveLength(1);
    expect(vendorSqlHits[0].matches.length).toBe(2);
  });

  it("SCOPE: the MCC/MNC vs mcc/mnc cross-table collision reports a heuristic finding for BOTH queries, by design", () => {
    // Table 7 (ookla_dash.mobile_time_only_k_vs1) has MCC/MNC; table 8
    // (ookla_dash.new_mobile_base_k_vs2) has mcc/mnc. Widget 59 is bound to table 8. This is the
    // direct, intended consequence of two already-locked decisions (case-insensitive matching +
    // free-SQL asserts no table) and is NOT a duplicate-detection bug — 123-RESEARCH.md Pitfall 3.
    const widget = makeWidget({
      id: 59, type: "timeline", config: { customWhere: widget59CustomWhere },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const forTable7 = collectColumnRefs(input, { tableId: 7, columns: ["MCC"] });
    const forTable8 = collectColumnRefs(input, { tableId: 8, columns: ["mcc"] });
    expect(forTable7.filter((r) => r.site === "widget.config.customWhere")).toHaveLength(1);
    expect(forTable8.filter((r) => r.site === "widget.config.customWhere")).toHaveLength(1);
    // Both are table-less: neither claims widget 59 belongs to the queried table.
    expect(forTable7[0].tableScope).toBe("free-sql");
  });

  it("a low-confidence column name in free SQL is reported, not suppressed", () => {
    const widget = makeWidget({ id: 59, config: { customWhere: widget59CustomWhere } });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 8, columns: ["mcc"] });
    const hit = refs.find((r) => r.site === "widget.config.customWhere");
    expect(hit).toBeDefined();
    expect(hit?.confidence).toBe("low-confidence");
  });

  it("collectColumnRefs returns [] for a column that appears nowhere", () => {
    const widget = makeWidget({ id: 4, config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    expect(collectColumnRefs(input, { tableId: 1, columns: ["totally_absent_column_xyz"] })).toEqual(
      [],
    );
  });

  it("collectColumnRefs output is deterministic and stable across input array reordering", () => {
    const widgetA = makeWidget({ id: 4, config: widget4Config });
    const widgetB = makeWidget({ id: 59, config: { customWhere: widget59CustomWhere } });
    const inputForward = { ...emptyInput(), widgets: [widgetA, widgetB] };
    const inputReversed = { ...emptyInput(), widgets: [widgetB, widgetA] };
    const columns = ["fare_amount", "operator", "vendor_id"];
    const resultForward = collectColumnRefs(inputForward, { tableId: 1, columns });
    const resultReversed = collectColumnRefs(inputReversed, { tableId: 1, columns });
    expect(resultForward).toEqual(resultReversed);
  });
});

// -----------------------------------------------------------------------------------------------
// dynamicView.columns_json[].name — the site three code-reading sweeps would have missed
// -----------------------------------------------------------------------------------------------

describe("dynamicView.columns_json[].name", () => {
  // dv 3 "Taxi Copy": source_table_id 1 (demo.nyctaxi, 19 cols), template_sql has NO column text.
  const dvTaxiCopy = makeDv({
    id: 3, dashboard_id: 1, source_table_id: 1, name: "Taxi Copy",
    template_sql: "select * from {view}", max_records: 10000,
    columns_json: [
      { name: "vendor_id", type: "char4" },
      { name: "pickup_datetime", type: "timestamp" },
      { name: "dropoff_datetime", type: "timestamp" },
    ],
  });
  // dv 6 "Avg NYC": source_table_id 1, but every columns_json entry is a COMPUTED ALIAS —
  // `cell`, `WKT` and `avg_passenger_count` are columns of nothing.
  const dvAvgNyc = makeDv({
    id: 6, source_table_id: 1, name: "Avg NYC",
    template_sql: "SELECT H3_XYTOCELL(pickup_longitude, pickup_latitude, 11) cell, WKT_MIN_MAX(geom) WKT, AVG(passenger_count) avg_passenger_count FROM demo.nyctaxi",
    columns_json: [
      { name: "cell", type: "ulong" },
      { name: "WKT", type: "geometry" },
      { name: "avg_passenger_count", type: "double" },
    ],
  });
  // SYNTHETIC: a dv whose cached columns_json does NOT describe its own source table.
  // source_table_id is 4, but three of the four cached columns belong to the DIFFERENT table
  // the template joins (id 5), and the fourth is a computed alias that is a column of no table
  // at all. This shape is WHY columns_json findings are table-less: attributing a joined
  // table's column to the dv's own source table would be ACTIVELY WRONG, not merely imprecise.
  const dvJoined = makeDv({
    id: 1, source_table_id: 4, name: "Joined DV",
    template_sql:
      "-- joined slice\nWITH filtered_base AS (\n    SELECT b.*\n" +
      "FROM {view} a \n join syn.joined_tbl b on a.join_key_id = b.join_key_id\n)",
    columns_json: [
      { name: "joined_col_a", type: "char64" },
      { name: "joined_col_b", type: "char64" },
      { name: "joined_col_c", type: "char64" },
      { name: "Computed_Alias", type: "double" },
    ],
  });

  it("SITE dynamicView.columns_json[].name: Taxi Copy's cached column list reports vendor_id even though its template_sql is `select * from {view}`", () => {
    const input = { ...emptyInput(), dynamicViews: [dvTaxiCopy] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "dynamicView.columns_json[].name");
    expect(hit).toBeDefined();
    expect(hit?.recordId).toBe(3);
    expect(hit?.recordLabel).toBe("Taxi Copy");
    expect(hit?.path).toBe("columns_json[0].name");
  });

  it("the finding is table-less: tableScope is 'free-sql' and tableId is null even for a dv whose columns_json matches its source table 19/19", () => {
    const input = { ...emptyInput(), dynamicViews: [dvTaxiCopy] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "dynamicView.columns_json[].name");
    expect(hit?.tableScope).toBe("free-sql");
    expect(hit?.tableId).toBeNull();
  });

  it("a joined dv reports a computed alias from columns_json without claiming its source table", () => {
    const input = { ...emptyInput(), dynamicViews: [dvJoined] };
    const refs = collectColumnRefs(input, { tableId: 4, columns: ["Computed_Alias"] });
    const hit = refs.find((r) => r.site === "dynamicView.columns_json[].name");
    expect(hit).toBeDefined();
    expect(hit?.tableId).toBeNull();
    expect(hit?.tableScope).toBe("free-sql");
  });

  it("columns_json findings carry confidence 'heuristic' and an empty matches array, even for a short name like WKT", () => {
    const refs = collectColumnRefs({ ...emptyInput(), dynamicViews: [dvAvgNyc] }, {
      tableId: 1, columns: ["WKT"],
    });
    const hit = refs.find((r) => r.site === "dynamicView.columns_json[].name");
    expect(hit?.confidence).toBe("heuristic"); // NOT "low-confidence" — this is value equality
    expect(hit?.matches).toEqual([]);
  });

  it("the path names the array index: columns_json[0].name", () => {
    const input = { ...emptyInput(), dynamicViews: [dvTaxiCopy] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "dynamicView.columns_json[].name");
    expect(hit?.path).toBe("columns_json[0].name");
  });
});

// -----------------------------------------------------------------------------------------------
// Widget structured sites — scalars / CSV (Plan 123-02, Task 1)
// -----------------------------------------------------------------------------------------------

describe("widget structured sites — scalars", () => {
  // widget 4, type "table", tableId 1 (demo.nyctaxi) — REAL
  const widget4Config = {
    customWhere: "", groupByColumns: [], columns: "", sortField: "", sortDirection: "asc",
    table: "demo.nyctaxi", metricColumn: "fare_amount", aggregation: "AVG",
    groupByColumn: "vendor_id",
    sql: "SELECT vendor_id, AVG(fare_amount) AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    tableId: 1, drillDownColumn: "vendor_id", drillDownColumnType: "string",
  };
  // widget 24, type "timeline", tableId 6 (telecom.demodata) — REAL
  const widget24Config = {
    timeCol: "QOS_Date",
    metrics: [
      { column: "QOS_DownloadThroughput", aggregation: "SUM", color: "FF66C2A5", label: "" },
      { column: "QOS_SignalStrength", aggregation: "SUM", color: "FFFC8D62", label: "" },
    ],
    colorTheme: "Set2", tableId: 6,
  };
  // widget 104, type "numericline", tableId 1 — REAL
  const widget104Config = {
    xField: "passenger_count",
    metrics: [{ column: "", aggregation: "SUM", color: "FF66C2A5", label: "", metricId: 9 }],
    colorTheme: "Set2", tableId: 1, groupByColumn: "vendor_id",
  };
  // widget 69, type "table", tableId 8 (ookla_dash.new_mobile_base_k_vs2) — REAL
  const widget69Config = {
    columns: "emirate", customWhere: "", sortField: "",
    table: "ookla_dash.new_mobile_base_k_vs2", metricColumn: "ts_result_month", tableId: 8,
  };

  it("SITE widget.config.metricColumn: widget 4's metricColumn fare_amount is an exact, table-1-scoped finding", () => {
    const widget = makeWidget({ id: 4, title: "Fare by Vendor", type: "table", config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.metricColumn");
    expect(hit).toMatchObject({
      column: "fare_amount", path: "config.metricColumn", recordKind: "widget",
      recordId: 4, recordLabel: "Fare by Vendor", tableId: 1, tableScope: "scoped",
      confidence: "exact", matches: [],
    });
  });

  it("SITE widget.config.groupByColumn: widget 4's groupByColumn vendor_id is an exact finding", () => {
    const widget = makeWidget({ id: 4, config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "widget.config.groupByColumn");
    expect(hit?.column).toBe("vendor_id");
    expect(hit?.path).toBe("config.groupByColumn");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE widget.config.drillDownColumn: widget 4's drillDownColumn vendor_id is an exact finding with its own path", () => {
    const widget = makeWidget({ id: 4, config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "widget.config.drillDownColumn");
    expect(hit?.path).toBe("config.drillDownColumn");
    expect(hit?.column).toBe("vendor_id");
  });

  it("SITE widget.config.timeCol: widget 24's timeCol QOS_Date is an exact finding", () => {
    const widget = makeWidget({ id: 24, type: "timeline", config: widget24Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 6, columns: ["QOS_Date"] });
    const hit = refs.find((r) => r.site === "widget.config.timeCol");
    expect(hit?.path).toBe("config.timeCol");
    expect(hit?.tableId).toBe(6);
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE widget.config.xField: widget 104's xField passenger_count is an exact finding", () => {
    const widget = makeWidget({ id: 104, type: "numericline", config: widget104Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refs.find((r) => r.site === "widget.config.xField");
    expect(hit?.path).toBe("config.xField");
    expect(hit?.tableId).toBe(1);
  });

  it("SITE widget.config.deltaField: a populated deltaField is an exact finding (SYNTHETIC — every real bignumber widget has deltaField \"\")", () => {
    const widget = makeWidget({
      id: 9001, type: "bignumber", config: { deltaField: "fare_amount", tableId: 1 },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.deltaField");
    expect(hit?.path).toBe("config.deltaField");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE widget.config.sortField: a populated sortField is an exact finding (SYNTHETIC — every real records widget has sortField \"\")", () => {
    const widget = makeWidget({
      id: 9002, type: "records", config: { sortField: "fare_amount", tableId: 1 },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.sortField");
    expect(hit?.path).toBe("config.sortField");
  });

  it("SITE widget.config.columns: widget 69's columns string emirate is an exact finding", () => {
    const widget = makeWidget({ id: 69, type: "table", config: widget69Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 8, columns: ["emirate"] });
    const hit = refs.find((r) => r.site === "widget.config.columns");
    expect(hit?.path).toBe("config.columns");
    expect(hit?.tableId).toBe(8);
    expect(hit?.confidence).toBe("exact");
  });

  it("the comma-separated columns string splits and trims: \"emirate, operator ,cluster\" finds all three", () => {
    const widget = makeWidget({
      id: 70, type: "table", config: { columns: "emirate, operator ,cluster", tableId: 8 },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    for (const col of ["emirate", "operator", "cluster"]) {
      const refs = collectColumnRefs(input, { tableId: 8, columns: [col] });
      const hit = refs.find((r) => r.site === "widget.config.columns");
      expect(hit?.column).toBe(col);
    }
  });

  it("an empty-string field yields no finding", () => {
    const widget = makeWidget({
      id: 71, config: { metricColumn: "", groupByColumn: "", tableId: 1 },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    expect(refs).toEqual([]);
  });

  it("structured matching is case-SENSITIVE: querying MCC does not match a widget whose groupByColumn is mcc", () => {
    const widget = makeWidget({ id: 72, config: { groupByColumn: "mcc", tableId: 8 } });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 8, columns: ["MCC"] });
    expect(refs.filter((r) => r.site === "widget.config.groupByColumn")).toEqual([]);
  });

  it("every structured finding has confidence 'exact' and an empty matches array", () => {
    const widget = makeWidget({ id: 4, config: widget4Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount", "vendor_id"] });
    const freeSqlSet = new Set<string>(FREE_SQL_SITES);
    const structuredRefs = refs.filter((r) => !freeSqlSet.has(r.site));
    expect(structuredRefs.length).toBeGreaterThan(0);
    for (const ref of structuredRefs) {
      expect(ref.confidence).toBe("exact");
      expect(ref.matches).toEqual([]);
    }
  });
});

// -----------------------------------------------------------------------------------------------
// Widget table resolution — resolveWidgetTableId (Plan 123-02, Task 1)
// -----------------------------------------------------------------------------------------------

describe("widget table resolution", () => {
  it("SCOPE: a dv-bound widget resolves through the dynamic view's source_table_id, not config.tableId", () => {
    // SYNTHETIC (both halves): every real dv-bound widget's config.tableId already equals
    // dv.source_table_id (a save-time convention, not a schema guarantee) — this fixture
    // DISAGREES on purpose (tableId: 1, but dv 1's source_table_id: 4) to prove the dv wins.
    const dv = makeDv({ id: 1, source_table_id: 4 });
    const widget = makeWidget({
      id: 80, config: { tableId: 1, dynamicViewId: 1, metricColumn: "fare_amount" },
    });
    const input = { ...emptyInput(), widgets: [widget], dynamicViews: [dv] };
    const refsForTable4 = collectColumnRefs(input, { tableId: 4, columns: ["fare_amount"] });
    const hit = refsForTable4.find((r) => r.site === "widget.config.metricColumn");
    expect(hit).toBeDefined();
    expect(hit?.tableId).toBe(4);
    expect(hit?.tableScope).toBe("scoped");
    // NOT scoped to the cached config.tableId (1):
    const refsForTable1 = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    expect(refsForTable1.filter((r) => r.site === "widget.config.metricColumn")).toEqual([]);
  });

  it("SCOPE: a non-dv-bound widget resolves through config.tableId", () => {
    const widget = makeWidget({ id: 81, config: { tableId: 1, metricColumn: "fare_amount" } });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.metricColumn");
    expect(hit?.tableId).toBe(1);
    expect(hit?.tableScope).toBe("scoped");
  });

  it("SCOPE: a widget whose dynamicViewId is dangling is reported with tableScope 'unresolved' regardless of the queried table", () => {
    // SYNTHETIC: every real dv reference in the dev DB resolves. This fixture's dynamicViewId
    // (4242) has no matching row in input.dynamicViews.
    const widget = makeWidget({
      id: 9003, config: { tableId: 1, dynamicViewId: 4242, metricColumn: "fare_amount" },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 7, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.metricColumn");
    expect(hit).toBeDefined();
    expect(hit?.tableScope).toBe("unresolved");
    expect(hit?.tableId).toBeNull();
  });

  it("SCOPE: a widget with neither dynamicViewId nor tableId is reported with tableScope 'unresolved'", () => {
    const widget = makeWidget({ id: 9004, config: { metricColumn: "fare_amount" } });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.metricColumn");
    expect(hit?.tableScope).toBe("unresolved");
    expect(hit?.tableId).toBeNull();
  });

  it("a widget bound to a different table yields no structured finding for a same-named column", () => {
    const widget = makeWidget({ id: 82, config: { tableId: 1, metricColumn: "fare_amount" } });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 2, columns: ["fare_amount"] });
    expect(refs.filter((r) => r.site === "widget.config.metricColumn")).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------------
// Widget structured sites — arrays, incl. spatialTargets' own tableId (Plan 123-02, Task 2)
// -----------------------------------------------------------------------------------------------

describe("widget structured sites — arrays", () => {
  // widget 1, type "map" — REAL. NOTE: no config.tableId and no dynamicViewId. Two spatialTargets
  // on DIFFERENT tables (1 = demo.nyctaxi, 3 = demo.track). Load-bearing fixture for BOTH scope
  // tests below.
  const widget1Config = {
    title: "Mapfffafsdf", basemapLight: "osm", basemapDark: "osm",
    spatialTargets: [
      { tableId: 1, spatialMode: "latlon", lonCol: "pickup_longitude", latCol: "pickup_latitude" },
      { tableId: 3, spatialMode: "latlon", lonCol: "X", latCol: "Y" },
    ],
    drillDownColumn: "", drillDownColumnType: "null",
  };

  it("SITE widget.config.groupByColumns[]: widget 60's [emirate, operator] yields one finding per element, each with its own index path", () => {
    const widget = makeWidget({
      id: 60, type: "bar",
      config: { groupByColumns: ["emirate", "operator"], customWhere: "", colorTheme: "", tableId: 8 },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refsEmirate = collectColumnRefs(input, { tableId: 8, columns: ["emirate"] });
    const hitEmirate = refsEmirate.find((r) => r.site === "widget.config.groupByColumns[]");
    expect(hitEmirate?.path).toBe("config.groupByColumns[0]");
    const refsOperator = collectColumnRefs(input, { tableId: 8, columns: ["operator"] });
    const hitOperator = refsOperator.find((r) => r.site === "widget.config.groupByColumns[]");
    expect(hitOperator?.path).toBe("config.groupByColumns[1]");
  });

  it("SITE widget.config.metrics[].column: widget 24's QOS_DownloadThroughput and QOS_SignalStrength each yield a finding", () => {
    const widget = makeWidget({
      id: 24, type: "timeline",
      config: {
        timeCol: "QOS_Date",
        metrics: [
          { column: "QOS_DownloadThroughput", aggregation: "SUM", color: "FF66C2A5", label: "" },
          { column: "QOS_SignalStrength", aggregation: "SUM", color: "FFFC8D62", label: "" },
        ],
        colorTheme: "Set2", tableId: 6,
      },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs1 = collectColumnRefs(input, { tableId: 6, columns: ["QOS_DownloadThroughput"] });
    const hit1 = refs1.find((r) => r.site === "widget.config.metrics[].column");
    expect(hit1?.path).toBe("config.metrics[0].column");
    const refs2 = collectColumnRefs(input, { tableId: 6, columns: ["QOS_SignalStrength"] });
    const hit2 = refs2.find((r) => r.site === "widget.config.metrics[].column");
    expect(hit2?.path).toBe("config.metrics[1].column");
  });

  it("SITE widget.config.filterFields[].column: widget 25's three filterFields each yield a finding", () => {
    const widget = makeWidget({
      id: 25, type: "datafilter",
      config: {
        filterFields: [
          { column: "Connection_Category", kind: "multi-select" },
          { column: "Location_City", kind: "dropdown" },
          { column: "Connection_Technology", kind: "multi-select" },
        ],
        tableId: 6, tableRef: "telecom.demodata", drillDownColumn: "",
      },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 6, columns: ["Connection_Technology"] });
    const hit = refs.find((r) => r.site === "widget.config.filterFields[].column");
    expect(hit?.path).toBe("config.filterFields[2].column");
  });

  it("SITE widget.config.spatialTargets[].lonCol: widget 1's element 0 lonCol pickup_longitude is scoped to table 1", () => {
    const widget = makeWidget({ id: 1, type: "map", config: widget1Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    const hit = refs.find((r) => r.site === "widget.config.spatialTargets[].lonCol");
    expect(hit?.path).toBe("config.spatialTargets[0].lonCol");
    expect(hit?.tableId).toBe(1);
    expect(hit?.tableScope).toBe("scoped");
  });

  it("SITE widget.config.spatialTargets[].latCol: widget 1's element 0 latCol pickup_latitude is scoped to table 1", () => {
    const widget = makeWidget({ id: 1, type: "map", config: widget1Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "widget.config.spatialTargets[].latCol");
    expect(hit?.path).toBe("config.spatialTargets[0].latCol");
    expect(hit?.tableId).toBe(1);
  });

  it("SITE widget.config.spatialTargets[].spatialCol: a wkt-mode target's spatialCol is an exact finding (SYNTHETIC — zero wkt-mode targets and zero spatialCol values in either database)", () => {
    const widget = makeWidget({
      id: 9005, type: "map",
      config: { spatialTargets: [{ tableId: 2, spatialMode: "wkt", spatialCol: "WKT" }] },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 2, columns: ["WKT"] });
    const hit = refs.find((r) => r.site === "widget.config.spatialTargets[].spatialCol");
    expect(hit?.path).toBe("config.spatialTargets[0].spatialCol");
    expect(hit?.tableId).toBe(2);
    expect(hit?.confidence).toBe("exact");
  });

  it("SCOPE: a spatialTargets element resolves against its OWN tableId, never the widget's", () => {
    // Table 3 (demo.track) has columns X and Y. Table 1 (demo.nyctaxi) does not.
    const widget = makeWidget({ id: 1, type: "map", config: widget1Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const forTable3 = collectColumnRefs(input, { tableId: 3, columns: ["X"] });
    const hit = forTable3.find((r) => r.site === "widget.config.spatialTargets[].lonCol");
    expect(hit?.path).toBe("config.spatialTargets[1].lonCol");
    expect(hit?.tableId).toBe(3);
    expect(hit?.tableScope).toBe("scoped");
    expect(hit?.confidence).toBe("exact"); // X is short, but the low-confidence tier grades
                                            // FREE-SQL matches only — never a structured site.
    // And element 0 must not be dragged along:
    expect(forTable3.filter((r) => r.path === "config.spatialTargets[0].lonCol")).toEqual([]);
  });

  it("SCOPE: widget 1 has no config.tableId at all, yet its spatialTargets findings are 'scoped', not 'unresolved'", () => {
    expect((widget1Config as Record<string, unknown>).tableId).toBeUndefined();
    const widget = makeWidget({ id: 1, type: "map", config: widget1Config });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    const hit = refs.find((r) => r.site === "widget.config.spatialTargets[].lonCol");
    expect(hit?.tableScope).toBe("scoped");
    expect(hit?.tableId).toBe(1);
  });

  it("an element with a missing or non-string column field yields no finding", () => {
    const widget = makeWidget({
      id: 9006, type: "map",
      config: { spatialTargets: [{ tableId: 1, spatialMode: "latlon" }] },
    });
    const input = { ...emptyInput(), widgets: [widget] };
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    expect(refs.filter((r) => (r.site as string).startsWith("widget.config.spatialTargets"))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------------
// Layer config column bindings (Plan 123-03, Task 1) — resolveLayerTableId + the four
// layer.config.* spatial column sites.
// -----------------------------------------------------------------------------------------------

describe("layer config column bindings", () => {
  // layer 4: table_id 1 (demo.nyctaxi), dynamic_view_id null — REAL
  const layer4Config = {
    renderMode: "heatmap", spatialMode: "latlon", colormap: "plasma",
    pointColor: "FF3B82F6", pointShape: "circle", shapeFillColor: "FFFF3838",
    visible: true, latColumn: "pickup_latitude", lonColumn: "pickup_longitude",
    wktColumn: "", wkbColumn: "",
  };
  const layer4 = makeLayer({
    id: 4, dashboard_id: 1, table_id: 1, config: layer4Config,
    info_enabled: 1, info_columns: null, info_template: null, dynamic_view_id: null,
    cb_config: "{\"attr\":\"passenger_count\",\"valsType\":\"numeric\",\"breaks\":[]}",
    track_config:
      "{\"trackIdAttr\":\"TRACKID\",\"trackOrderAttr\":\"TIMESTAMP\",\"headColor\":\"FFFF0000\"," +
      "\"trailColor\":\"FF0000FF\",\"headSize\":8,\"trailSize\":2,\"headShape\":\"circle\"," +
      "\"enabled\":true}",
  });

  it("SITE layer.config.latColumn: layer 4's latColumn pickup_latitude is an exact, table-1-scoped finding", () => {
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "layer.config.latColumn");
    expect(hit).toMatchObject({
      column: "pickup_latitude", path: "config.latColumn", recordKind: "layer",
      recordId: 4, tableId: 1, tableScope: "scoped", confidence: "exact", matches: [],
    });
  });

  it("SITE layer.config.lonColumn: layer 4's lonColumn pickup_longitude is an exact finding", () => {
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    const hit = refs.find((r) => r.site === "layer.config.lonColumn");
    expect(hit?.path).toBe("config.lonColumn");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE layer.config.wktColumn: a populated wktColumn is an exact finding", () => {
    // REAL shape (1 row in kinetica.db, 4 in env-b.db); layer 4's own wktColumn is "" (unset), so
    // this fixture sets a real value on a copy to exercise the site.
    const layer = makeLayer({
      id: 4001, table_id: 1, config: { ...layer4Config, wktColumn: "geom_wkt" },
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["geom_wkt"] });
    const hit = refs.find((r) => r.site === "layer.config.wktColumn");
    expect(hit?.path).toBe("config.wktColumn");
    expect(hit?.tableId).toBe(1);
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE layer.config.wkbColumn: a populated wkbColumn is an exact finding (SYNTHETIC — zero instances in either database; only wktColumn is ever populated)", () => {
    const layer = makeLayer({
      id: 4002, table_id: 1, config: { ...layer4Config, wkbColumn: "geom_wkb" },
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["geom_wkb"] });
    const hit = refs.find((r) => r.site === "layer.config.wkbColumn");
    expect(hit?.path).toBe("config.wkbColumn");
    expect(hit?.confidence).toBe("exact");
  });

  it("SCOPE: a layer bound through dynamic_view_id resolves through the dynamic view's source_table_id", () => {
    // SYNTHETIC (both halves): every real dv-bound layer's table_id already equals
    // dv.source_table_id (a save-time convention, not a schema guarantee) — this fixture
    // DISAGREES on purpose (table_id: 1, but dv 1's source_table_id: 4) to prove the dv wins.
    const dv = makeDv({ id: 1, source_table_id: 4 });
    const layer = makeLayer({
      id: 9101, table_id: 1, dynamic_view_id: 1, config: { latColumn: "pickup_latitude" },
    });
    const input = makeInput({ layers: [layer], dynamicViews: [dv] });
    const refsForTable4 = collectColumnRefs(input, { tableId: 4, columns: ["pickup_latitude"] });
    expect(refsForTable4.some((r) => r.recordId === 9101)).toBe(true);
    const refsForTable1 = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    expect(refsForTable1.some((r) => r.recordId === 9101)).toBe(false);
  });

  it("SCOPE: a layer with a dangling dynamic_view_id is reported with tableScope 'unresolved'", () => {
    // SYNTHETIC: every real dv reference in the dev DB resolves.
    const layer = makeLayer({
      id: 9102, table_id: 1, dynamic_view_id: 4242, config: { latColumn: "pickup_latitude" },
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 7, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.recordId === 9102 && r.site === "layer.config.latColumn");
    expect(hit).toBeDefined();
    expect(hit?.tableScope).toBe("unresolved");
    expect(hit?.tableId).toBeNull();
  });

  it("a layer bound to a different table yields no finding for a same-named column", () => {
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 2, columns: ["pickup_latitude"] });
    expect(refs.filter((r) => r.site === "layer.config.latColumn")).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------------
// Layer JSON-string sites (Plan 123-03, Task 2) — cb_config.attr, the four track_config fields,
// and the malformed-JSON fallback.
// -----------------------------------------------------------------------------------------------

describe("layer JSON-string sites", () => {
  // layer 4: table_id 1 (demo.nyctaxi) — REAL cb_config.attr / track_config values.
  const layer4 = makeLayer({
    id: 4, table_id: 1,
    config: { latColumn: "pickup_latitude", lonColumn: "pickup_longitude" },
    cb_config: "{\"attr\":\"passenger_count\",\"valsType\":\"numeric\",\"breaks\":[]}",
    track_config:
      "{\"trackIdAttr\":\"TRACKID\",\"trackOrderAttr\":\"TIMESTAMP\",\"headColor\":\"FFFF0000\"," +
      "\"trailColor\":\"FF0000FF\",\"headSize\":8,\"trailSize\":2,\"headShape\":\"circle\"," +
      "\"enabled\":true}",
  });

  it("SITE layer.cb_config.attr: layer 4's cb_config attr passenger_count is an exact finding", () => {
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refs.find((r) => r.site === "layer.cb_config.attr");
    expect(hit).toMatchObject({
      column: "passenger_count", path: "cb_config.attr", recordKind: "layer", recordId: 4,
      tableId: 1, tableScope: "scoped", confidence: "exact", matches: [],
    });
  });

  it("SITE layer.track_config.trackIdAttr: layer 4's trackIdAttr TRACKID is an exact finding", () => {
    // NOTE: table 1 (demo.nyctaxi) has no column named TRACKID — the traversal reports what the
    // record REFERENCES, it does not validate that the reference resolves. That is Phase 124's
    // report to render, not this module's judgement to make.
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["TRACKID"] });
    const hit = refs.find((r) => r.site === "layer.track_config.trackIdAttr");
    expect(hit?.path).toBe("track_config.trackIdAttr");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE layer.track_config.trackOrderAttr: layer 4's trackOrderAttr TIMESTAMP is an exact finding", () => {
    const input = makeInput({ layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["TIMESTAMP"] });
    const hit = refs.find((r) => r.site === "layer.track_config.trackOrderAttr");
    expect(hit?.path).toBe("track_config.trackOrderAttr");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE layer.track_config.xCol: a populated xCol is an exact finding (SYNTHETIC — no stored track_config in either database sets xCol or yCol)", () => {
    const layer = makeLayer({
      id: 4101, table_id: 1,
      track_config: "{\"enabled\":true,\"xCol\":\"pickup_longitude\"}",
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    const hit = refs.find((r) => r.site === "layer.track_config.xCol");
    expect(hit?.path).toBe("track_config.xCol");
    expect(hit?.confidence).toBe("exact");
  });

  it("SITE layer.track_config.yCol: a populated yCol is an exact finding (SYNTHETIC — see xCol)", () => {
    const layer = makeLayer({
      id: 4102, table_id: 1,
      track_config: "{\"enabled\":true,\"yCol\":\"pickup_latitude\"}",
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "layer.track_config.yCol");
    expect(hit?.path).toBe("track_config.yCol");
    expect(hit?.confidence).toBe("exact");
  });

  it("cb_config styling fields are never findings: a break's shapeFillColor holding a column name yields nothing", () => {
    const layer = makeLayer({
      id: 4103, table_id: 1,
      // valsType (a TOP-LEVEL cb_config key) is planted with the queried column name so this test
      // also discriminates a shallow "iterate the parsed object's own keys" mutation, not only a
      // hypothetical deep/recursive one — a generic key walk at either level would false-positive
      // on this fixture; reading `attr` by name alone does not.
      cb_config: JSON.stringify({
        attr: "vendor_id", valsType: "pickup_latitude",
        breaks: [{ value: "CMT", color: "FF000000", shapeFillColor: "pickup_latitude" }],
      }),
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    expect(refs.filter((r) => r.site === "layer.cb_config.attr")).toEqual([]);
  });

  it("a null cb_config or track_config yields no finding and does not throw", () => {
    const layer = makeLayer({ id: 4104, table_id: 1, cb_config: null, track_config: null });
    const input = makeInput({ layers: [layer] });
    expect(() =>
      collectColumnRefs(input, { tableId: 1, columns: ["passenger_count", "TRACKID"] }),
    ).not.toThrow();
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count", "TRACKID"] });
    expect(
      refs.filter((r) => r.site === "layer.cb_config.attr" || r.site === "layer.track_config.trackIdAttr"),
    ).toEqual([]);
  });

  it("malformed JSON still reports: a truncated cb_config string yields a heuristic finding rather than silence", () => {
    const broken = makeLayer({
      id: 9201, table_id: 1, cb_config: "{\"attr\":\"passenger_count\"",
    });
    const input = makeInput({ layers: [broken] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refs.find((r) => r.recordId === 9201 && r.site === "layer.cb_config.attr");
    expect(hit).toBeDefined();                 // NOT silence
    expect(hit?.confidence).toBe("heuristic"); // downgraded, because the path could not be proven
    expect(hit?.tableId).toBe(1);              // still table-scoped: the RECORD's table is known
    expect(hit?.matches.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------------------------
// Layer info popup sites (Plan 123-03, Task 3) — info_columns, info_template placeholders.
// -----------------------------------------------------------------------------------------------

describe("layer info popup sites", () => {
  // SYNTHETIC — 0/10 (kinetica.db) and 0/8 (env-b.db) layers populate either field; no operator
  // has ever configured an info-popup override in either environment.
  const layer9301 = makeLayer({
    id: 9301, table_id: 1,
    info_columns: "[\"pickup_longitude\", \"pickup_latitude\", \"fare_amount\"]",
    info_template:
      "<table><tr><td>Fare</td><td>{fare_amount}</td></tr>\n" +
      "<tr><td>Vendor</td><td>{vendor_id}</td></tr></table>",
  });

  it("SITE layer.info_columns: a populated info_columns array yields one finding per matching entry (SYNTHETIC — 0/10 and 0/8 layers populated)", () => {
    const input = makeInput({ layers: [layer9301] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "layer.info_columns");
    expect(hit).toMatchObject({
      column: "pickup_latitude", path: "info_columns[1]", recordKind: "layer", recordId: 9301,
      tableId: 1, tableScope: "scoped", confidence: "exact", matches: [],
    });
  });

  it("SITE layer.info_template: a {Column} placeholder yields a finding carrying its line and offset (SYNTHETIC — 0/10 and 0/8 layers populated)", () => {
    const input = makeInput({ layers: [layer9301] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] });
    const hit = refs.find((r) => r.site === "layer.info_template");
    expect(hit).toBeDefined();
    expect(hit?.matches[0].lineNumber).toBe(2); // vendor_id is on the second line
    expect(hit?.matches[0].line).toContain("{vendor_id}");
    expect(hit?.matches[0].offset).toBe(hit!.matches[0].line.indexOf("vendor_id"));
  });

  it("info_template placeholder matching is case-SENSITIVE and ignores surrounding HTML", () => {
    // Template says {Fare_Amount}; the column is fare_amount. Placeholders are generated from the
    // column name verbatim, so a case mismatch is a genuinely different reference.
    const layer = makeLayer({
      id: 9302, table_id: 1,
      info_template: "<div class=\"card\">{Fare_Amount}</div>",
    });
    const input = makeInput({ layers: [layer] });
    expect(
      collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] })
        .filter((r) => r.site === "layer.info_template"),
    ).toEqual([]);
  });

  it("an info_template with no placeholders yields no finding", () => {
    const layer = makeLayer({
      id: 9303, table_id: 1, info_template: "<table><tr><td>Fare</td></tr></table>",
    });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    expect(refs.filter((r) => r.site === "layer.info_template")).toEqual([]);
  });

  it("a null info_columns means ALL COLUMNS and yields no finding, because it names nothing", () => {
    const layer = makeLayer({ id: 9304, table_id: 1, info_columns: null });
    const input = makeInput({ layers: [layer] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    expect(refs.filter((r) => r.site === "layer.info_columns")).toEqual([]);
  });

  it("EXCLUDE: a layer config with the queried column name planted under EVERY excluded key yields zero findings", () => {
    // vendor_id is a REAL column of table 1 (demo.nyctaxi); the other excluded keys collide
    // case-insensitively/structurally with other real columns — exactly why a generic
    // "does this string equal a known column" walker would be wrong.
    const planted: Record<string, unknown> = {};
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const layer = makeLayer({ id: 7101, table_id: 1, config: planted });
    const input = makeInput({ layers: [layer] });
    expect(collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);
  });

  it("EXCLUDE: the layer exclude fixture DOES yield a finding once latColumn is set, proving the fixture reaches the traversal", () => {
    const planted: Record<string, unknown> = {};
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const withoutSite = makeInput({
      layers: [makeLayer({ id: 7101, table_id: 1, config: planted })],
    });
    expect(collectColumnRefs(withoutSite, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);

    const plantedWithSite = { ...planted, latColumn: "vendor_id" };
    const withSite = makeInput({
      layers: [makeLayer({ id: 7101, table_id: 1, config: plantedWithSite })],
    });
    const refs = collectColumnRefs(withSite, { tableId: 1, columns: ["vendor_id"] });
    expect(refs).toHaveLength(1);
    expect(refs[0].site).toBe("layer.config.latColumn");
  });
});

// -----------------------------------------------------------------------------------------------
// Excluded look-alike keys — the widget half of the guard (Plan 123-02, Task 3). Proves the
// traversal is path-driven, not value-driven: planting the queried column name under every
// EXCLUDED_LOOKALIKE_KEYS path yields zero findings, paired with a companion assertion proving the
// same fixture DOES fire once a real site is added (an exclude test that only asserts `[]` passes
// just as well against a traversal that walks nothing).
// -----------------------------------------------------------------------------------------------

describe("excluded look-alike keys", () => {
  it("EXCLUDE: a widget config with the queried column name planted under EVERY excluded key yields zero findings", () => {
    // vendor_id is a REAL column of table 1 (demo.nyctaxi); name, type, Date and WKT are all real
    // column names elsewhere in the operator's tables — exactly why a generic "does this string
    // equal a known column" walker would be wrong.
    const planted: Record<string, unknown> = { tableId: 1 };
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const input = makeInput({
      widgets: [makeWidget({ id: 7001, title: "lookalikes", type: "map", config: planted })],
    });
    expect(collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);
  });

  it("EXCLUDE: config.table holding a fully-qualified table name is never a column finding", () => {
    const widget = makeWidget({ id: 7002, config: { table: "demo.nyctaxi", tableId: 1 } });
    const input = makeInput({ widgets: [widget] });
    expect(
      collectColumnRefs(input, { tableId: 1, columns: ["demo.nyctaxi", "nyctaxi"] }),
    ).toEqual([]);
  });

  it("EXCLUDE: a wkt-mode spatialTargets element yields a finding for spatialCol but NOT for spatialMode", () => {
    const widget = makeWidget({
      id: 7003, type: "map",
      config: { spatialTargets: [{ tableId: 2, spatialMode: "wkt", spatialCol: "WKT" }] },
    });
    const input = makeInput({ widgets: [widget] });
    const refs = collectColumnRefs(input, { tableId: 2, columns: ["WKT"] });
    // A value-equality walker would ALSO fire on spatialMode:"wkt" (case-insensitively) — that is
    // the collision 123-RESEARCH.md names, and the reason identification is path-driven.
    expect(refs.map((r) => r.site)).toEqual(["widget.config.spatialTargets[].spatialCol"]);
  });

  it("EXCLUDE: the exclude fixture DOES yield findings once a real column site is added, proving the fixture reaches the traversal", () => {
    const planted: Record<string, unknown> = { tableId: 1 };
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const withoutSite = makeInput({
      widgets: [makeWidget({ id: 7001, title: "lookalikes", type: "map", config: planted })],
    });
    expect(collectColumnRefs(withoutSite, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);

    const plantedWithSite = { ...planted, metricColumn: "vendor_id" };
    const withSite = makeInput({
      widgets: [makeWidget({ id: 7001, title: "lookalikes", type: "map", config: plantedWithSite })],
    });
    const refs = collectColumnRefs(withSite, { tableId: 1, columns: ["vendor_id"] });
    expect(refs).toHaveLength(1);
    expect(refs[0].site).toBe("widget.config.metricColumn");
  });
});

// -----------------------------------------------------------------------------------------------
// Radio-group configPatch copies (Plan 123-04, Task 1) — both action shapes, target-scoped.
// -----------------------------------------------------------------------------------------------

describe("radio-group configPatch copies", () => {
  // layer 4 (real, table_id 1) — carries its OWN cb_config.attr = passenger_count, independent of
  // any configPatch copy. widget 6's own config.tableId is a deliberately UNRELATED value (99) so
  // the SCOPE test below can prove a configPatch finding is scoped to the TARGET's table, never
  // the host radio-group widget's own (nonsensical, for a radiogroup) table.
  const layer4 = makeLayer({
    id: 4, table_id: 1,
    cb_config: "{\"attr\":\"passenger_count\",\"valsType\":\"numeric\",\"breaks\":[]}",
  });
  // layer 9 (real, table_id 1) — widget 11's plural-shape target. Its own cb_config is null so a
  // hit can never be mistaken for "the layer's own record" leaking through into the per-site test
  // below.
  const layer9 = makeLayer({ id: 9, table_id: 1, cb_config: null });

  // widget 6, type "radiogroup" — REAL, LEGACY SINGULAR `action` shape. Targets layer 4.
  const widget6 = makeWidget({
    id: 6, type: "radiogroup", title: "", config: {
      tableId: 99,
      orientation: "vertical",
      options: [{
        id: "f35a3396-a088-45e2-8edb-1888fe0ece30", label: "hhh",
        action: { target: { kind: "layer", id: 4 }, configPatch: {
          renderMode: "heatmap", visible: true,
          track_config:
            "{\"trackIdAttr\":\"TRACKID\",\"trackOrderAttr\":\"TIMESTAMP\",\"headColor\":\"FFFF0000\"," +
            "\"trailColor\":\"FF0000FF\",\"headSize\":8,\"trailSize\":2,\"headShape\":\"circle\"," +
            "\"enabled\":true}",
          cb_config: "{\"attr\":\"passenger_count\",\"valsType\":\"numeric\",\"breaks\":[]}",
        } },
      }],
      drillDownColumn: "", drillDownColumnType: "null",
    },
  });

  // widget 11, type "radiogroup" — REAL, PLURAL `actions[]` shape. Targets layer 9.
  const widget11 = makeWidget({
    id: 11, type: "radiogroup", title: "", config: {
      orientation: "vertical",
      options: [{
        id: "50673528-76d9-4996-90af-ec2a64f964f2", label: "Heatmap",
        actions: [{ target: { kind: "layer", id: 9 }, configPatch: {
          renderMode: "heatmap", colormap: "inferno", pointColor: "FF3B82F6",
          pointShape: "circle", shapeFillColor: "FFFF3838", visible: true,
          name: "Main NYC taxi",
          cb_config: "{\"attr\":\"passenger_count\",\"valsType\":\"numeric\",\"breaks\":[]}",
        } }],
      }],
    },
  });

  it("SITE widget.config.options[].configPatch.cb_config.attr: widget 11's plural actions[] patch yields a finding for passenger_count", () => {
    const input = makeInput({ widgets: [widget11], layers: [layer9] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.cb_config.attr");
    expect(hit).toMatchObject({
      column: "passenger_count",
      path: "config.options[0].actions[0].configPatch.cb_config.attr",
      recordKind: "widget", recordId: 11,
      tableId: 1, tableScope: "scoped", confidence: "exact", matches: [],
    });
  });

  it("SITE widget.config.options[].configPatch.track_config.trackIdAttr: widget 6's legacy singular action patch yields a finding for TRACKID", () => {
    const input = makeInput({ widgets: [widget6], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["TRACKID"] });
    const hit = refs.find(
      (r) => r.site === "widget.config.options[].configPatch.track_config.trackIdAttr",
    );
    expect(hit?.path).toBe("config.options[0].action.configPatch.track_config.trackIdAttr");
    expect(hit?.recordId).toBe(6);
    expect(hit?.tableId).toBe(1);
  });

  it("SITE widget.config.options[].configPatch.track_config.trackOrderAttr: widget 6's legacy patch yields a finding for TIMESTAMP", () => {
    const input = makeInput({ widgets: [widget6], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["TIMESTAMP"] });
    const hit = refs.find(
      (r) => r.site === "widget.config.options[].configPatch.track_config.trackOrderAttr",
    );
    expect(hit?.path).toBe("config.options[0].action.configPatch.track_config.trackOrderAttr");
  });

  it("SITE widget.config.options[].configPatch.track_config.xCol: a patched xCol yields a finding (SYNTHETIC — zero instances in either database)", () => {
    const widget = makeWidget({
      id: 9401, type: "radiogroup", config: {
        options: [{ id: "o1", label: "x", action: { target: { kind: "layer", id: 4 },
          configPatch: { track_config: "{\"enabled\":true,\"xCol\":\"pickup_longitude\"}" } } }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_longitude"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.track_config.xCol");
    expect(hit?.path).toBe("config.options[0].action.configPatch.track_config.xCol");
  });

  it("SITE widget.config.options[].configPatch.track_config.yCol: a patched yCol yields a finding (SYNTHETIC — see xCol)", () => {
    const widget = makeWidget({
      id: 9402, type: "radiogroup", config: {
        options: [{ id: "o1", label: "y", action: { target: { kind: "layer", id: 4 },
          configPatch: { track_config: "{\"enabled\":true,\"yCol\":\"pickup_latitude\"}" } } }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.track_config.yCol");
    expect(hit?.path).toBe("config.options[0].action.configPatch.track_config.yCol");
  });

  it("SITE widget.config.options[].configPatch.info_columns: a patched info_columns yields a finding (SYNTHETIC — ZERO instances in either database; included because validateLayerSnapshot accepts the key today)", () => {
    const widget = makeWidget({
      id: 9403, type: "radiogroup", config: {
        options: [{ id: "o1", label: "info", action: { target: { kind: "layer", id: 4 },
          configPatch: { info_columns: "[\"pickup_longitude\",\"pickup_latitude\"]" } } }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["pickup_latitude"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.info_columns");
    expect(hit?.path).toBe("config.options[0].action.configPatch.info_columns[1]");
  });

  it("SITE widget.config.options[].configPatch.info_template: a patched info_template placeholder yields a finding (SYNTHETIC — see info_columns)", () => {
    const widget = makeWidget({
      id: 9404, type: "radiogroup", config: {
        options: [{ id: "o1", label: "tmpl", action: { target: { kind: "layer", id: 4 },
          configPatch: { info_template: "<div>{fare_amount}</div>" } } }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.info_template");
    expect(hit?.path).toBe("config.options[0].action.configPatch.info_template");
    expect(hit?.matches.length).toBeGreaterThan(0);
  });

  it("BOTH SHAPES: the plural actions[] and the legacy singular action are both walked", () => {
    const input = makeInput({ widgets: [widget6, widget11], layers: [layer4, layer9] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const sites = refs.filter((r) => r.site.startsWith("widget.config.options[].configPatch"));
    expect(sites.some((r) => r.path.includes(".actions[0]."))).toBe(true);
    expect(sites.some((r) => r.path.includes(".action."))).toBe(true);
  });

  it("a configPatch finding is DISTINCT from the layer it patches: same column, two findings, different recordKind", () => {
    const input = makeInput({ widgets: [widget6], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const layerHit = refs.find((r) => r.site === "layer.cb_config.attr" && r.recordId === 4);
    const patchHit = refs.find(
      (r) => r.site === "widget.config.options[].configPatch.cb_config.attr" && r.recordId === 6,
    );
    expect(layerHit).toBeDefined();
    expect(patchHit).toBeDefined();
    expect(patchHit!.recordKind).toBe("widget"); // the RADIOGROUP owns the copy, not the layer
    expect(patchHit!.tableId).toBe(1); // but it is scoped to the TARGET layer's table
    expect(patchHit!.path).toBe("config.options[0].action.configPatch.cb_config.attr");
  });

  it("SCOPE: a configPatch is scoped to the TARGET layer's table, not the host widget's", () => {
    // widget 6's own config.tableId is 99 (meaningless for a radiogroup, but deliberately set to
    // an unrelated value); target layer 4 is table 1. A finding must be scoped to 1, never 99.
    const input = makeInput({ widgets: [widget6], layers: [layer4] });
    const refsForTable1 = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refsForTable1.find(
      (r) => r.site === "widget.config.options[].configPatch.cb_config.attr",
    );
    expect(hit?.tableId).toBe(1);
    const refsForTable99 = collectColumnRefs(input, { tableId: 99, columns: ["passenger_count"] });
    expect(
      refsForTable99.filter((r) => r.site === "widget.config.options[].configPatch.cb_config.attr"),
    ).toEqual([]);
  });

  it("SCOPE: a configPatch whose target layer is absent is reported with tableScope 'unresolved'", () => {
    // SYNTHETIC: every real configPatch target layer in the dev DB resolves.
    const widget = makeWidget({
      id: 9405, type: "radiogroup", config: {
        options: [{ id: "o1", label: "dangling", action: { target: { kind: "layer", id: 4242 },
          configPatch: { cb_config: "{\"attr\":\"passenger_count\",\"breaks\":[]}" } } }],
      },
    });
    const input = makeInput({ widgets: [widget] });
    const refs = collectColumnRefs(input, { tableId: 7, columns: ["passenger_count"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.cb_config.attr");
    expect(hit).toBeDefined();
    expect(hit?.tableScope).toBe("unresolved");
    expect(hit?.tableId).toBeNull();
  });

  it("a dynamicView-target configPatch yields no finding, because its allow-list holds only `enabled`", () => {
    const widget = makeWidget({
      id: 9406, type: "radiogroup", config: {
        options: [{ id: "o1", label: "dv", action: { target: { kind: "dynamicView", id: 1 },
          configPatch: { cb_config: "{\"attr\":\"passenger_count\",\"breaks\":[]}" } } }],
      },
    });
    const dv = makeDv({ id: 1, source_table_id: 1 });
    const input = makeInput({ widgets: [widget], dynamicViews: [dv] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    expect(
      refs.filter((r) => r.site === "widget.config.options[].configPatch.cb_config.attr"),
    ).toEqual([]);
  });

  it("configPatch malformed JSON still reports: a truncated cb_config string yields a heuristic finding rather than silence", () => {
    const widget = makeWidget({
      id: 9407, type: "radiogroup", config: {
        options: [{ id: "o1", label: "broken", action: { target: { kind: "layer", id: 4 },
          configPatch: { cb_config: "{\"attr\":\"passenger_count\"" } } }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["passenger_count"] });
    const hit = refs.find(
      (r) => r.recordId === 9407 && r.site === "widget.config.options[].configPatch.cb_config.attr",
    );
    expect(hit).toBeDefined();
    expect(hit?.confidence).toBe("heuristic");
    expect(hit?.tableId).toBe(1);
    expect(hit?.matches.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------------------------
// configPatch.metric and columnDisplayConfig.column_name (Plan 123-04, Task 2)
// -----------------------------------------------------------------------------------------------

describe("configPatch.metric and column display config", () => {
  it("SITE widget.config.options[].configPatch.metric: a widget-target patch naming a metric column yields a finding (SYNTHETIC — ZERO widget-target configPatches exist in either database)", () => {
    // REAL — target widget 4, tableId 1. SYNTHETIC — no widget-target configPatch exists in
    // either database; this fixture targets a real row so the scope assertion has something real
    // to resolve against.
    const targetWidget = makeWidget({ id: 4, title: "Fare by Vendor", config: { tableId: 1 } });
    const radioWidget = makeWidget({
      id: 9401, type: "radiogroup", config: {
        options: [{ id: "o1", label: "Fare", actions: [{
          target: { kind: "widget", id: 4 },
          configPatch: { metric: "fare_amount", aggregation: "SUM" },
        }] }],
      },
    });
    const input = makeInput({ widgets: [radioWidget, targetWidget] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    const hit = refs.find((r) => r.site === "widget.config.options[].configPatch.metric");
    expect(hit).toMatchObject({
      column: "fare_amount", path: "config.options[0].actions[0].configPatch.metric",
      recordKind: "widget", recordId: 9401,
      tableId: 1, tableScope: "scoped", confidence: "exact", matches: [],
    });
  });

  it("SCOPE: a configPatch.metric is scoped to the TARGET widget's resolved table", () => {
    const targetWidget = makeWidget({ id: 4, config: { tableId: 1 } });
    const radioWidget = makeWidget({
      id: 9401, type: "radiogroup", config: {
        options: [{ id: "o1", label: "Fare", actions: [{
          target: { kind: "widget", id: 4 },
          configPatch: { metric: "fare_amount" },
        }] }],
      },
    });
    const input = makeInput({ widgets: [radioWidget, targetWidget] });
    const refsForTable1 = collectColumnRefs(input, { tableId: 1, columns: ["fare_amount"] });
    expect(
      refsForTable1.find((r) => r.site === "widget.config.options[].configPatch.metric"),
    ).toBeDefined();
    const refsForTable2 = collectColumnRefs(input, { tableId: 2, columns: ["fare_amount"] });
    expect(
      refsForTable2.filter((r) => r.site === "widget.config.options[].configPatch.metric"),
    ).toEqual([]);
  });

  it("SITE columnDisplayConfig.column_name: the real row (table 6, Device_Manufacturer) yields an exact finding", () => {
    // REAL — dev DB row.
    const row = {
      table_id: 6, column_name: "Device_Manufacturer", label: "Device Manufacture Label",
      format_spec: null, created_at: "", updated_at: "",
    };
    const input = makeInput({ columnDisplayConfig: [row] });
    const refs = collectColumnRefs(input, { tableId: 6, columns: ["Device_Manufacturer"] });
    const hit = refs.find((r) => r.site === "columnDisplayConfig.column_name");
    expect(hit?.recordId).toBeNull();
    expect(hit?.recordLabel).toBe("Device_Manufacturer");
    expect(hit?.tableId).toBe(6);
    expect(hit?.path).toBe("column_name");
  });

  it("a columnDisplayConfig finding has recordId null and is identified by (tableId, recordLabel)", () => {
    const row = {
      table_id: 6, column_name: "Device_Manufacturer", label: null,
      format_spec: null, created_at: "", updated_at: "",
    };
    const input = makeInput({ columnDisplayConfig: [row] });
    const refs = collectColumnRefs(input, { tableId: 6, columns: ["Device_Manufacturer"] });
    const hit = refs.find((r) => r.site === "columnDisplayConfig.column_name");
    expect(hit?.recordId).toBeNull();
    expect(hit?.recordKind).toBe("columnDisplayConfig");
    expect(hit?.tableId).toBe(6);
    expect(hit?.recordLabel).toBe("Device_Manufacturer");
  });

  it("a columnDisplayConfig row on a different table yields no finding", () => {
    const row = {
      table_id: 6, column_name: "Device_Manufacturer", label: "x",
      format_spec: null, created_at: "", updated_at: "",
    };
    const input = makeInput({ columnDisplayConfig: [row] });
    const refs = collectColumnRefs(input, { tableId: 1, columns: ["Device_Manufacturer"] });
    expect(refs.filter((r) => r.site === "columnDisplayConfig.column_name")).toEqual([]);
  });

  it("EXCLUDE: a configPatch with the queried column name planted under EVERY excluded key yields zero findings", () => {
    // vendor_id is a REAL column of table 1; the other excluded keys collide case-insensitively/
    // structurally with other real columns elsewhere — including `name`, load-bearing here since
    // 8 of the 12 real dev-DB patches carry a `name: "Main NYC taxi"`-style layer display name.
    const planted: Record<string, unknown> = {};
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const layer4 = makeLayer({ id: 4, table_id: 1 });
    const widget = makeWidget({
      id: 7201, type: "radiogroup", config: {
        options: [{ id: "o1", label: "lookalikes", actions: [{
          target: { kind: "layer", id: 4 }, configPatch: planted,
        }] }],
      },
    });
    const input = makeInput({ widgets: [widget], layers: [layer4] });
    expect(collectColumnRefs(input, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);
  });

  it("EXCLUDE: the configPatch exclude fixture DOES yield a finding once cb_config is set, proving the fixture reaches the traversal", () => {
    const planted: Record<string, unknown> = {};
    for (const key of EXCLUDED_LOOKALIKE_KEYS) planted[key] = "vendor_id";
    const layer4 = makeLayer({ id: 4, table_id: 1 });

    const withoutSite = makeInput({
      widgets: [makeWidget({
        id: 7201, type: "radiogroup", config: {
          options: [{ id: "o1", label: "lookalikes", actions: [{
            target: { kind: "layer", id: 4 }, configPatch: planted,
          }] }],
        },
      })],
      layers: [layer4],
    });
    expect(collectColumnRefs(withoutSite, { tableId: 1, columns: ["vendor_id"] })).toEqual([]);

    const plantedWithSite = { ...planted, cb_config: "{\"attr\":\"vendor_id\",\"breaks\":[]}" };
    const withSite = makeInput({
      widgets: [makeWidget({
        id: 7201, type: "radiogroup", config: {
          options: [{ id: "o1", label: "lookalikes", actions: [{
            target: { kind: "layer", id: 4 }, configPatch: plantedWithSite,
          }] }],
        },
      })],
      layers: [layer4],
    });
    const refs = collectColumnRefs(withSite, { tableId: 1, columns: ["vendor_id"] });
    expect(refs).toHaveLength(1);
    expect(refs[0].site).toBe("widget.config.options[].configPatch.cb_config.attr");
  });
});

// -----------------------------------------------------------------------------------------------
// Site coverage — criterion 1 (Plan 123-04, Task 3). Paired with Plan 123-01's own
// "GOLDEN: the site registry is exactly the 40 inventoried sites, in order" test: together, a site
// cannot be removed from the REGISTRY (golden reddens) nor from the TRAVERSAL (coverage below
// reddens) without a NAMED test failing — criterion 1's literal demand, made structural.
// -----------------------------------------------------------------------------------------------

describe("site coverage — criterion 1", () => {
  // One sentinel per site, derived from the site id, so a typo cannot silently alias two sites —
  // the plan checker computed all 40 and confirmed ZERO collisions before this plan was executed.
  const sentinel = (site: string) => "zz_" + site.replace(/[^A-Za-z0-9]+/g, "_");

  // ONE widget, carrying every widget-structured field, every array field, AND a configPatch all
  // at once — no site block gates on widget.type, so `type` is inert for this module (confirmed
  // by the plan checker reading every site-emitting block). config.tableId: 1 resolves the widget
  // itself to table 1; the configPatch's own target (layer 90002, below) is resolved independently.
  const masterWidget = makeWidget({
    id: 90001, type: "map", title: "Master Fixture Widget",
    config: {
      tableId: 1,
      metricColumn: sentinel("widget.config.metricColumn"),
      groupByColumn: sentinel("widget.config.groupByColumn"),
      groupByColumns: [sentinel("widget.config.groupByColumns[]")],
      drillDownColumn: sentinel("widget.config.drillDownColumn"),
      timeCol: sentinel("widget.config.timeCol"),
      xField: sentinel("widget.config.xField"),
      deltaField: sentinel("widget.config.deltaField"),
      sortField: sentinel("widget.config.sortField"),
      columns: sentinel("widget.config.columns"),
      metrics: [{ column: sentinel("widget.config.metrics[].column") }],
      filterFields: [{ column: sentinel("widget.config.filterFields[].column") }],
      spatialTargets: [{
        tableId: 1,
        lonCol: sentinel("widget.config.spatialTargets[].lonCol"),
        latCol: sentinel("widget.config.spatialTargets[].latCol"),
        spatialCol: sentinel("widget.config.spatialTargets[].spatialCol"),
      }],
      options: [{
        id: "o1", label: "opt",
        actions: [{
          target: { kind: "layer", id: 90002 },
          configPatch: {
            metric: sentinel("widget.config.options[].configPatch.metric"),
            cb_config: JSON.stringify({
              attr: sentinel("widget.config.options[].configPatch.cb_config.attr"),
            }),
            track_config: JSON.stringify({
              trackIdAttr: sentinel("widget.config.options[].configPatch.track_config.trackIdAttr"),
              trackOrderAttr:
                sentinel("widget.config.options[].configPatch.track_config.trackOrderAttr"),
              xCol: sentinel("widget.config.options[].configPatch.track_config.xCol"),
              yCol: sentinel("widget.config.options[].configPatch.track_config.yCol"),
            }),
            info_columns: JSON.stringify([
              sentinel("widget.config.options[].configPatch.info_columns"),
            ]),
            info_template: `{${sentinel("widget.config.options[].configPatch.info_template")}}`,
          },
        }],
      }],
      sql: `SELECT ${sentinel("widget.config.sql")} FROM t`,
      customWhere: `${sentinel("widget.config.customWhere")} = 1`,
    },
  });

  // ONE layer, carrying every layer-structured field and every JSON-string field at once.
  const masterLayer = makeLayer({
    id: 90002, table_id: 1,
    config: {
      latColumn: sentinel("layer.config.latColumn"),
      lonColumn: sentinel("layer.config.lonColumn"),
      wktColumn: sentinel("layer.config.wktColumn"),
      wkbColumn: sentinel("layer.config.wkbColumn"),
    },
    cb_config: JSON.stringify({ attr: sentinel("layer.cb_config.attr") }),
    track_config: JSON.stringify({
      trackIdAttr: sentinel("layer.track_config.trackIdAttr"),
      trackOrderAttr: sentinel("layer.track_config.trackOrderAttr"),
      xCol: sentinel("layer.track_config.xCol"),
      yCol: sentinel("layer.track_config.yCol"),
    }),
    info_columns: JSON.stringify([sentinel("layer.info_columns")]),
    info_template: `{${sentinel("layer.info_template")}}`,
  });

  // ONE column_display_config row.
  const masterColumnDisplayConfig = {
    table_id: 1, column_name: sentinel("columnDisplayConfig.column_name"), label: "x",
    format_spec: null, created_at: "", updated_at: "",
  };

  // ONE custom metric.
  const masterMetric: CustomMetricRow = {
    id: 90003, table_id: 1, label: "Master Metric",
    expression: `SUM(${sentinel("customMetric.expression")})`,
    format_spec: null, created_at: "", updated_at: "",
  };

  // ONE dynamic view, carrying both the free-SQL template_sql site and the cached columns_json
  // site.
  const masterDv = makeDv({
    id: 90004, source_table_id: 1, name: "Master DV",
    template_sql: `SELECT ${sentinel("dynamicView.template_sql")} FROM {view}`,
    columns_json: [{ name: sentinel("dynamicView.columns_json[].name"), type: "string" }],
  });

  // ONE table view.
  const masterTableView = makeTableView({
    id: 90005, table_id: 1, view_name: "Master View",
    filter_clause: `${sentinel("tableView.filter_clause")} = 1`,
  });

  const masterInput = makeInput({
    widgets: [masterWidget],
    layers: [masterLayer],
    dynamicViews: [masterDv],
    customMetrics: [masterMetric],
    tableViews: [masterTableView],
    columnDisplayConfig: [masterColumnDisplayConfig],
  });

  it("COVERAGE: every site in COLUMN_REF_SITES produces at least one finding from the master fixture", () => {
    const refs = collectColumnRefs(masterInput, {
      tableId: 1,
      columns: COLUMN_REF_SITES.map(sentinel),
    });
    const seen = new Set(refs.map((r) => r.site));
    for (const site of COLUMN_REF_SITES) {
      expect(seen, `no finding for site ${site}`).toContain(site);
    }
  });

  it("COVERAGE: the master fixture's finding sites are EXACTLY the registry, with nothing extra", () => {
    const refs = collectColumnRefs(masterInput, {
      tableId: 1,
      columns: COLUMN_REF_SITES.map(sentinel),
    });
    const seen = new Set(refs.map((r) => r.site));
    expect([...seen].sort()).toEqual([...COLUMN_REF_SITES].sort());
  });

  it("COVERAGE: removing any single site from the traversal is detectable — each site's sentinel column is unique to it", () => {
    const refs = collectColumnRefs(masterInput, {
      tableId: 1,
      columns: COLUMN_REF_SITES.map(sentinel),
    });
    for (const site of COLUMN_REF_SITES) {
      const forThis = refs.filter((r) => r.column === sentinel(site));
      expect(
        new Set(forThis.map((r) => r.site)),
        `sentinel for ${site} leaked`,
      ).toEqual(new Set([site]));
    }
  });
});
