/**
 * columnRefs.ts — answers "what in this app refers to column X of table Y".
 *
 * This module is PURE: it reads only already-loaded, already-parsed app state (widgets, layers,
 * dynamic views, custom metrics, table views, column display config) that the caller has fetched
 * from SQLite. It makes NO Kinetica call, opens no connection, and REWRITES NOTHING — it is a
 * read-only enumeration, never a writer.
 *
 * It INHERITS the one-enumeration-two-directions discipline of
 * `packages/server/src/lib/dashboardExportRefs.ts` — one traversal function, driven by an `emit`
 * callback, so there is never a second list of "the sites" to fall out of sync with the first. It
 * deliberately does NOT extend that module (imports nothing from it; `dashboardExportRefs.ts` has
 * zero diff as a phase success criterion). Its `asId` safety model does not transfer here: a
 * `dashboardExportRefs.ts` reference is a positive-integer FK, trivially distinguishable from a
 * string. A column reference is a bare STRING, and widget configs are full of strings that are NOT
 * columns — `colormap: "viridis"`, `pointShape: "circle"`, `basemapDark: "dark"`,
 * `spatialMode: "latlon"`, hex colours, enum discriminators. Because there is no cheap structural
 * test that separates a column-valued string from a look-alike one, identification here is
 * PATH-DRIVEN: the traversal only ever reads a fixed, named set of config keys, never "does this
 * string happen to equal a known column name" run generically over the whole object. That is
 * strictly more fragile than an id check, which is exactly why every entry in `COLUMN_REF_SITES`
 * carries its own dedicated test.
 *
 * Whether a given reference matters, and how much, is Phase 124's job, not this module's. This
 * module reports that a reference exists and how confidently — nothing about its consequence.
 */

import type {
  Widget,
  DashboardLayer,
  DashboardDynamicView,
  CustomMetricRow,
  DashboardTableView,
  ColumnDisplayConfigRow,
} from "../types";

// -------------------------------------------------------------------------------------------
// The ColumnRef contract. Phase 124 renders this; Phase 125 persists it. Reproduced verbatim in
// 123-01-SUMMARY.md before either of those phases is planned further.
// -------------------------------------------------------------------------------------------

/** exact = a structured site (the value IS the column name). heuristic = a free-SQL / cached-name
 *  match. low-confidence = a free-SQL match on a short or common name. Low-confidence findings are
 *  REPORTED, never suppressed (123-CONTEXT.md, locked). */
export type RefConfidence = "exact" | "heuristic" | "low-confidence";

export type ColumnRefRecordKind =
  | "widget" | "layer" | "customMetric" | "dynamicView" | "tableView" | "columnDisplayConfig";

/** "scoped"     -> tableId is a number and the finding belongs to that table.
 *  "free-sql"   -> tableId is null BY DESIGN (the five free-SQL sites + columns_json). The finding
 *                  says "this text mentions the name you asked about" and asserts nothing more.
 *  "unresolved" -> tableId is null because the record's table could not be determined (dangling
 *                  dynamicViewId, dangling configPatch target layer, or no tableId at all). Such a
 *                  finding is ALWAYS reported regardless of the queried table: a missed finding is
 *                  the expensive failure, a surplus one is merely noise. */
export type ColumnRefTableScope = "scoped" | "free-sql" | "unresolved";

export type ColumnRefMatch = {
  /** The full source line containing the match, VERBATIM from the original text (never the
   *  literal-masked copy, and never trimmed) — Phase 124 shows this to the operator. */
  line: string;
  /** 1-based line number within the scanned text. */
  lineNumber: number;
  /** 0-based character offset of the match WITHIN `line`, so Phase 124 can highlight precisely. */
  offset: number;
};

export type ColumnRef = {
  /** The queried column name, echoed exactly as supplied. */
  column: string;
  /** Stable site id; always a member of COLUMN_REF_SITES. */
  site: ColumnRefSite;
  /** The concrete path, e.g. "config.spatialTargets[1].lonCol" or
   *  "config.options[0].action.configPatch.cb_config.attr". This is what makes granularity
   *  one-finding-per-SITE rather than one-per-record. */
  path: string;
  recordKind: ColumnRefRecordKind;
  /** null ONLY for columnDisplayConfig, whose primary key is (table_id, column_name) and which
   *  therefore has no id; identify it as (tableId, recordLabel). */
  recordId: number | null;
  /** Human label for Phase 124: widget.title / layer config.name / metric label / dv name /
   *  view_name / column_name. Empty string when the record carries none. */
  recordLabel: string;
  tableId: number | null;
  tableScope: ColumnRefTableScope;
  confidence: RefConfidence;
  /** One entry per occurrence, ascending. Non-empty for every FREE_SQL_SITES finding and for
   *  layer/configPatch info_template placeholder findings. EMPTY for value-equality sites
   *  (including dynamicView.columns_json[].name, which is table-less but not text-scanned). */
  matches: ColumnRefMatch[];
};

export type ColumnRefsInput = {
  widgets: Widget[];
  layers: DashboardLayer[];
  dynamicViews: DashboardDynamicView[];
  customMetrics: CustomMetricRow[];
  tableViews: DashboardTableView[];
  columnDisplayConfig: ColumnDisplayConfigRow[];
};

/** One table, N columns — the shape Phase 124 has after a SchemaCheckResult for one table. */
export type ColumnQuery = { tableId: number; columns: string[] };

// -------------------------------------------------------------------------------------------
// The registry. This IS the inventory: the traversal (visitColumnRefSites, below) may only emit
// `site` values drawn from this list, and "GOLDEN: the site registry is exactly the 40 inventoried
// sites, in order" pins it exactly — so a later plan cannot quietly shrink the inventory by
// forgetting a block. Two of these entries — `dynamicView.columns_json[].name` and the two
// `configPatch.info_*` entries — were added on 2026-09-22 after an adversarial, DATA-DRIVEN sweep
// found what three prior code-reading sweeps had missed. That is the same miss-class as v1.24's
// REF-9 (`dashboardExportRefs.ts`): a code-reading enumeration only ever proves "I found every site
// I thought to look for," never "I found every site." This plan implements only the SIX sites in
// the "free SQL" and "cached dynamic-view column list" groups below; the remaining 34 arrive in
// Plans 123-02 (widget structured + spatial), 123-03 (layer structured) and 123-04 (configPatch
// copies + columnDisplayConfig) — see the numbered TODOs inside `visitColumnRefSites`.
// -------------------------------------------------------------------------------------------
export const COLUMN_REF_SITES = [
  // --- widget structured: table = the widget's RESOLVED table (Plan 123-02) ---
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
  // --- widget spatial targets: table = the ELEMENT'S OWN tableId, never inherited (Plan 123-02) ---
  "widget.config.spatialTargets[].lonCol",
  "widget.config.spatialTargets[].latCol",
  "widget.config.spatialTargets[].spatialCol",
  // --- radio-group configPatch copies: table = the TARGET record's table (Plan 123-04) ---
  "widget.config.options[].configPatch.metric",
  "widget.config.options[].configPatch.cb_config.attr",
  "widget.config.options[].configPatch.track_config.trackIdAttr",
  "widget.config.options[].configPatch.track_config.trackOrderAttr",
  "widget.config.options[].configPatch.track_config.xCol",
  "widget.config.options[].configPatch.track_config.yCol",
  "widget.config.options[].configPatch.info_columns",
  "widget.config.options[].configPatch.info_template",
  // --- layer structured: table = the layer's RESOLVED table (Plan 123-03) ---
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
  // --- global per-table column display config (Plan 123-04) ---
  "columnDisplayConfig.column_name",
  // --- free SQL: heuristic / low-confidence, ALWAYS table-less (this plan) ---
  "widget.config.sql",
  "widget.config.customWhere",
  "customMetric.expression",
  "dynamicView.template_sql",
  "tableView.filter_clause",
  // --- cached dynamic-view column list: heuristic, table-less, value-equality (this plan) ---
  "dynamicView.columns_json[].name",
] as const;

export type ColumnRefSite = (typeof COLUMN_REF_SITES)[number];

export const FREE_SQL_SITES: readonly ColumnRefSite[] = [
  "widget.config.sql",
  "widget.config.customWhere",
  "customMetric.expression",
  "dynamicView.template_sql",
  "tableView.filter_clause",
];

/** Keys that LOOK column-ish and are NOT columns (evidence: 123-RESEARCH.md § "Key paths that
 *  LOOK column-ish but are NOT"). A generic "does this string equal a known column name" walker
 *  would false-positive on every one of them — `WKT`, `name`, `type` and `Date` are all real
 *  column names in the operator's tables. The traversal is path-driven precisely so this cannot
 *  happen; the exclude test in Plan 123-02 is what keeps it that way. `table` / `tableRef` hold a
 *  fully-qualified TABLE name, which is dashboardExportRefs.ts's concern, not this module's. */
export const EXCLUDED_LOOKALIKE_KEYS = [
  "spatialMode", "basemapDark", "basemapLight", "colorTheme", "color",
  "color1", "color2", "color3", "color4", "color5", "color6",
  "pointColor", "shapeFillColor", "shapeLineColor", "headColor", "trailColor", "markerColor",
  "pointShape", "headShape", "markerShape", "renderMode",
  "kind", "label", "name", "table", "tableRef", "colormap", "valsType",
] as const;

// -------------------------------------------------------------------------------------------
// The low-confidence rule. Applied ONLY when grading a FREE_SQL_SITES match. It is never applied
// to a structured site — `WKT` is short, but `layer.config.wktColumn = "WKT"` is `exact` regardless
// of the column name's length — and it is never applied to `dynamicView.columns_json[].name`,
// which is a value equality on a stored name, not a text match; grading text-match noise makes no
// sense for a comparison that has none. Against the operator's 564 real column names this rule
// classifies 26 (4.6%).
// -------------------------------------------------------------------------------------------
export const LOW_CONFIDENCE_MAX_LENGTH = 3;
/** Common SQL / English words that are ALSO real column names in the operator's tables. A pure
 *  length rule is insufficient: Date, name and type are all 4 characters. */
export const LOW_CONFIDENCE_STOPLIST: readonly string[] = [
  "date", "time", "name", "type", "value", "count", "key", "data",
  "status", "code", "id", "text", "number",
];
export const isLowConfidenceColumnName = (name: string): boolean =>
  name.length <= LOW_CONFIDENCE_MAX_LENGTH ||
  LOW_CONFIDENCE_STOPLIST.includes(name.toLowerCase());

/**
 * Whole-identifier, case-INSENSITIVE match, locked verbatim in 123-CONTEXT.md. Whole identifier,
 * never a bare substring — there are 248 substring pairs among the operator's 564 real columns
 * (`2G` in `2G_Layer`, `Date` in `Meta_CreatedDate`, `Connection_Band` in
 * `Connection_Bandwidth`). Case-INSENSITIVE, DELIBERATELY unlike Phase 122's case-SENSITIVE
 * column-identity diff in `schemaDiff.ts`: "is this the same column?" and "does this text mention
 * it?" are two different questions. Widget 59's real `customWhere` reads `OPERATOR IN (...)` while
 * the column is `operator`; a case-sensitive scan would under-report on widgets that exist today.
 * Do not unify the two.
 */
export const columnMatchRegex = (columnName: string): RegExp => {
  const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi");
};

/**
 * Single-quote state machine that masks quoted string-literal contents with spaces so that
 * offsets computed on `masked` stay valid against the original `sql`. `masked` and `sql` always
 * have identical length and identical line breaks: every character emitted while inside a literal
 * (and the quote characters themselves) becomes a SPACE, never deleted, and a newline inside a
 * literal is emitted as a newline (not a space) so line numbering survives. On `''` (a doubled
 * single-quote) while inside a literal, this is the SQL-standard escaped quote: emit two spaces,
 * advance two, stay inside. `unterminated: true` when the scan finishes still inside a literal —
 * the caller (`scanFreeSql`) fails toward REPORTING on that signal rather than trusting the mask.
 */
export const maskQuotedLiterals = (sql: string): { masked: string; unterminated: boolean } => {
  let out = "";
  let inLiteral = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inLiteral && sql[i + 1] === "'") {
        out += "  ";
        i++;
        continue;
      }
      inLiteral = !inLiteral;
      out += " ";
      continue;
    }
    if (inLiteral) {
      out += ch === "\n" ? "\n" : " ";
    } else {
      out += ch;
    }
  }
  return { masked: out, unterminated: inLiteral };
};

/**
 * The only place free text becomes findings. Rules, all load-bearing:
 * - Empty `columnName` -> `[]`.
 * - Run `maskQuotedLiterals`. If it reports `unterminated`, scan the ORIGINAL `text` instead of
 *   the masked copy — fail toward REPORTING per the locked rule: a missed finding is expensive, a
 *   false positive on malformed SQL is merely noise.
 * - `line` always comes from the ORIGINAL `text` (split on "\n"), never the masked copy — the
 *   operator must see their real SQL, not a space-scrubbed rendering of it.
 * - Matches are returned in ascending index order.
 */
export const scanFreeSql = (text: string, columnName: string): ColumnRefMatch[] => {
  if (!columnName) return [];
  const { masked, unterminated } = maskQuotedLiterals(text);
  const haystack = unterminated ? text : masked;
  const originalLines = text.split("\n");
  // Precompute the 0-based start offset of each line within the full text, so an absolute match
  // index can be converted to (lineNumber, offset-within-line) without re-scanning per match.
  const lineStarts: number[] = [0];
  for (const l of originalLines.slice(0, -1)) {
    lineStarts.push(lineStarts[lineStarts.length - 1] + l.length + 1); // +1 for the "\n"
  }

  const matches: ColumnRefMatch[] = [];
  const regex = columnMatchRegex(columnName);
  let m: RegExpExecArray | null;
  while ((m = regex.exec(haystack)) !== null) {
    const index = m.index;
    // Binary search would be overkill for these text sizes; linear scan from the end is simplest
    // and correct since lineStarts is ascending.
    let lineIdx = 0;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] <= index) lineIdx = i;
      else break;
    }
    matches.push({
      line: originalLines[lineIdx],
      lineNumber: lineIdx + 1,
      offset: index - lineStarts[lineIdx],
    });
    // Guard against a zero-length match causing an infinite loop (cannot happen with this
    // pattern, since `escaped` is always non-empty for a non-empty columnName, but a defensive
    // advance costs nothing).
    if (m[0].length === 0) regex.lastIndex++;
  }
  return matches;
};

