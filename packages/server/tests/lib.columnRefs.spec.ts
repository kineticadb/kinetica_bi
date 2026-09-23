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
} from "../src/lib/columnRefs";

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
    // The literal `'ignore'` earlier on the same line is deliberate: masking it must preserve the
    // TEXT'S LENGTH (spaces, not deletion) for the offset of `x` afterward to stay correct.
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
