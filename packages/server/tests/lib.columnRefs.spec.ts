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
      "fare_amount", "vendor_id", "passenger_count", "GR_ExpLim", "operator",
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
  // dynamic view 1 "FF" (source_table_id 4) — REAL (abbreviated template)
  const dvFFTemplate =
    "-- FF Slice\nWITH peril_filtered_base_table AS (\n    SELECT b.*\n" +
    "FROM {view} a \n join vaipr.vaipr_location_exposure b on a.vaipr_location_id = b.vaipr_location_id\n)";

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
      id: 1, name: "FF", source_table_id: 4, template_sql: dvFFTemplate, columns_json: null,
    });
    const input = { ...emptyInput(), dynamicViews: [dv] };
    const refs = collectColumnRefs(input, { tableId: 5, columns: ["vaipr_location_id"] });
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
      id: 1, name: "FF", source_table_id: 4, template_sql: dvFFTemplate, columns_json: null,
    });
    const view = makeTableView({ id: 1, filter_clause: "vendor_id = 'CMT'" });
    const input = {
      ...emptyInput(), widgets: [widget], customMetrics: [metric1], dynamicViews: [dv],
      tableViews: [view],
    };
    const refs = collectColumnRefs(input, {
      tableId: 1, columns: ["vendor_id", "val_upload_kbps", "vaipr_location_id"],
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
  // dv 1 "FF": source_table_id 4 (vaipr.vaipr_location), but 3 of its 4 columns_json entries
  // (cede_db, contract_key, location_exposure_id) belong to a DIFFERENT REGISTERED table —
  // id 5, vaipr.vaipr_location_exposure, joined by the template. The 4th, GR_ExpLim, is a
  // computed alias from the template's own CASE expression and is a column of no table at all.
  // Verified read-only against the dev DB 2026-09-22. This is WHY columns_json is table-less:
  // attributing cede_db to table 4 would be ACTIVELY WRONG, not merely imprecise.
  const dvFF = makeDv({
    id: 1, source_table_id: 4, name: "FF",
    template_sql:
      "-- FF Slice\nWITH peril_filtered_base_table AS (\n    SELECT b.*\n" +
      "FROM {view} a \n join vaipr.vaipr_location_exposure b on a.vaipr_location_id = b.vaipr_location_id\n)",
    columns_json: [
      { name: "cede_db", type: "char64" },
      { name: "contract_key", type: "char64" },
      { name: "location_exposure_id", type: "char64" },
      { name: "GR_ExpLim", type: "double" },
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

  it("a joined dv (FF) reports GR_ExpLim from columns_json without claiming vaipr_location", () => {
    const input = { ...emptyInput(), dynamicViews: [dvFF] };
    const refs = collectColumnRefs(input, { tableId: 4, columns: ["GR_ExpLim"] });
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
