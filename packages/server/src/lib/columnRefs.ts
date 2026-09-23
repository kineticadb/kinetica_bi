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
 *
 * The traversal reads ONLY the paths named in `COLUMN_REF_SITES` (via `visitColumnRefSites`'s
 * fixed, per-site field reads) and never compares an arbitrary config value against a column
 * name — see the header comment above for why a generic value-equality walker would be wrong here.
 * `EXCLUDED_LOOKALIKE_KEYS` plus its "excluded look-alike keys" test suite (Plan 123-02, Task 3)
 * are what keep that true: planting a real column name under every excluded key must yield zero
 * findings, paired with a companion assertion proving the same fixture DOES fire once a real site
 * is added, so the guard can actually fail if this property is ever violated.
 *
 * The traversal covers all 40 inventoried sites as of Phase 123 (Plans 123-01 through 123-04).
 * Adding a 41st site means adding exactly FOUR things: one entry in `COLUMN_REF_SITES`, one block
 * inside `visitColumnRefSites`, one `SITE ` test, and one fixture entry in the master coverage
 * fixture (`tests/lib.columnRefs.spec.ts`, "site coverage — criterion 1"). The coverage test will
 * redden until all four exist — deliberately proven by Plan 123-04 Task 3, which deleted the
 * `widget.config.metricColumn` block, observed BOTH the coverage test and that site's own `SITE `
 * test redden, then restored it. A guard that has never been seen to fail is not a guard.
 *
 * Twelve of the forty sites have NO real row behind them in either dev database and are therefore
 * the first place to look if production data ever contradicts these tests: `widget.config.
 * deltaField`, `widget.config.sortField`, `widget.config.spatialTargets[].spatialCol`,
 * `layer.config.wkbColumn`, `layer.track_config.xCol`, `layer.track_config.yCol`,
 * `layer.info_columns`, `layer.info_template`, `tableView.filter_clause`,
 * `widget.config.options[].configPatch.info_columns`,
 * `widget.config.options[].configPatch.info_template`, and
 * `widget.config.options[].configPatch.metric`.
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
  /** One entry per occurrence, ascending. Non-empty for every FREE_SQL_SITES finding, for
   *  layer/configPatch info_template placeholder findings, and for a JSON-string site whose
   *  stored JSON failed to parse (malformed-JSON fallback, Plan 123-03). EMPTY for
   *  value-equality sites (including dynamicView.columns_json[].name, which is table-less but
   *  not text-scanned). */
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

// -------------------------------------------------------------------------------------------
// collectColumnRefs / visitColumnRefSites — Task 2 (five free-SQL sites) and Task 3
// (dynamicView.columns_json[].name). The remaining 34 sites arrive in Plans 123-02/03/04 — each
// is a numbered TODO below naming the plan that owns it. Adding a site means adding exactly one
// block inside `visitColumnRefSites` plus one entry in `COLUMN_REF_SITES` above — there is no
// second list to forget, mirroring `dashboardExportRefs.ts`'s REF-1..REF-9 discipline (that module
// is inherited-from conceptually, never imported — see the header comment).
// -------------------------------------------------------------------------------------------

const RECORD_KIND_ORDER: readonly ColumnRefRecordKind[] = [
  "widget", "layer", "customMetric", "dynamicView", "tableView", "columnDisplayConfig",
];

/**
 * Local positive-integer predicate — the same SHAPE as `dashboardExportRefs.ts`'s `asId` (a
 * positive integer, never `Number()`/`parseInt`), but declared LOCALLY: importing from that module
 * is forbidden by the phase's zero-diff success criterion, and re-implementing a four-line
 * predicate is cheaper than adding a cross-module dependency for it.
 */
const asPositiveInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;

/** Same predicate `dashboardExportRefs.ts` uses to guard property reads on unknown JSON. */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Resolve which table a widget's structured column fields belong to (Plan 123-02). Exported
 * because Plan 123-04's `configPatch` blocks and Plan 123-03's layer resolution mirror this exact
 * rule, and there must be exactly one implementation of it project-wide.
 *
 * Rules, in order — do NOT reorder:
 * 1. `config.dynamicViewId` is a positive integer -> look it up in `dynamicViews` by `id`.
 *    Found -> `{ tableId: dv.source_table_id, tableScope: "scoped" }`.
 *    NOT found -> `{ tableId: null, tableScope: "unresolved" }` — do NOT fall back to
 *    `config.tableId`; a dangling dv reference makes the table genuinely undeterminable, and a
 *    missed finding is the expensive failure this module exists to avoid.
 * 2. Else `config.tableId` is a positive integer -> `{ tableId, tableScope: "scoped" }`.
 * 3. Else -> `{ tableId: null, tableScope: "unresolved" }`.
 *
 * WHY step 1 looks redundant but isn't: `ChartConfigPanel.tsx:1071-1084` dual-writes BOTH
 * `config.tableId` (= `dv.source_table_id`) AND `config.dynamicViewId` on a dv-bound widget, so the
 * two agree in every row of the dev DB today. But that equality is a save-time convention enforced
 * by ONE call site, not a schema-level guarantee — the dv is the authority and `config.tableId` is
 * merely a cache of it, so the dv is checked FIRST.
 */
export const resolveWidgetTableId = (
  config: Record<string, unknown>,
  dynamicViews: DashboardDynamicView[],
): { tableId: number | null; tableScope: ColumnRefTableScope } => {
  const dvId = asPositiveInt(config.dynamicViewId);
  if (dvId !== undefined) {
    const dv = dynamicViews.find((d) => d.id === dvId);
    if (dv) return { tableId: dv.source_table_id, tableScope: "scoped" };
    return { tableId: null, tableScope: "unresolved" };
  }
  const tableId = asPositiveInt(config.tableId);
  if (tableId !== undefined) return { tableId, tableScope: "scoped" };
  return { tableId: null, tableScope: "unresolved" };
};

/**
 * Resolve which table a layer's own structured column fields belong to (Plan 123-03) — the SAME
 * three-step rule as `resolveWidgetTableId` immediately above, applied to a `DashboardLayer`
 * instead of a widget's `config`. Exported and kept side by side with `resolveWidgetTableId` so a
 * reader sees at a glance that this is not a second, independently-invented rule.
 *
 * Rules, in order — do NOT reorder:
 * 1. `layer.dynamic_view_id` is a positive integer -> look it up in `dynamicViews` by `id`.
 *    Found -> `{ tableId: dv.source_table_id, tableScope: "scoped" }`.
 *    NOT found -> `{ tableId: null, tableScope: "unresolved" }` — do NOT fall back to
 *    `layer.table_id`; a dangling dv reference makes the table genuinely undeterminable.
 * 2. Else `layer.table_id` is a positive integer -> `{ tableId, tableScope: "scoped" }`.
 * 3. Else -> `{ tableId: null, tableScope: "unresolved" }`.
 *
 * WHY step 1 looks redundant but isn't: `table_id` on `dashboard_layers` is NOT NULL even when
 * `dynamic_view_id` is set — when dv-bound, `table_id` is written as `dv.source_table_id` by the
 * LayersModal/ChartConfigPanel picker (`packages/server/src/types.ts` documents this at the
 * `dynamic_view_id` field), so the same cache-vs-authority argument as `resolveWidgetTableId`
 * applies and the dv wins even where today's data always agrees with the cache.
 */
export const resolveLayerTableId = (
  layer: DashboardLayer,
  dynamicViews: DashboardDynamicView[],
): { tableId: number | null; tableScope: ColumnRefTableScope } => {
  const dvId = asPositiveInt(layer.dynamic_view_id);
  if (dvId !== undefined) {
    const dv = dynamicViews.find((d) => d.id === dvId);
    if (dv) return { tableId: dv.source_table_id, tableScope: "scoped" };
    return { tableId: null, tableScope: "unresolved" };
  }
  const tableId = asPositiveInt(layer.table_id);
  if (tableId !== undefined) return { tableId, tableScope: "scoped" };
  return { tableId: null, tableScope: "unresolved" };
};

/**
 * Local shape for a radio-group option's `action`/`actions[]` entry — deliberately loose (`unknown`
 * fields) because a `configPatch` is untrusted, arbitrary JSON.
 */
type PatchActionLike = { target?: unknown; configPatch?: unknown };

/**
 * Walk a radio-group option's action(s), returning BOTH the action object and a path fragment
 * naming which shape it came from — Plan 123-04. This MIRRORS `dashboardExportRefs.ts`'s
 * `getOptionActionsLike` helper of the same name, deliberately copied rather than imported (zero
 * diff to that module is a phase success criterion; that module's own version returns a different
 * shape because it answers a different question — table/widget references, not column
 * references). Reading only the plural `actions[]` would silently drop every legacy-shaped
 * option's patch: the dev DB's 12 known `configPatch` copies split 11 plural / 1 legacy, and they
 * only reconcile when both shapes are walked.
 */
const getOptionActionsLike = (
  option: Record<string, unknown>,
): { action: PatchActionLike; pathFragment: string }[] => {
  if (Array.isArray(option.actions)) {
    return (option.actions as PatchActionLike[]).map((action, j) => ({
      action, pathFragment: `actions[${j}]`,
    }));
  }
  if (option.action && typeof option.action === "object") {
    return [{ action: option.action as PatchActionLike, pathFragment: "action" }];
  }
  return [];
};

/**
 * Resolve which table a radio-group option's `configPatch` action TARGETS (Plan 123-04) — as
 * opposed to the table the host widget itself belongs to. A `configPatch` finding is owned by the
 * radio-group widget (`recordKind: "widget"`) but must be SCOPED to whatever the action's `target`
 * points at, never the host's own table.
 *
 * Rules, in order:
 * 1. `target.kind === "layer"` and `target.id` resolves to a real layer in `input.layers` ->
 *    delegate to `resolveLayerTableId` for THAT layer.
 * 2. `target.kind === "widget"` and `target.id` resolves to a real widget in `input.widgets` ->
 *    delegate to `resolveWidgetTableId` for THAT widget's config.
 * 3. Anything else — including `kind: "dynamicView"`, an unknown kind, a non-positive id, or a
 *    target that resolves to nothing — -> `{ tableId: null, tableScope: "unresolved" }`.
 *
 * `dynamicView` targets are deliberately included in the "anything else" bucket here (the function
 * always returns a well-defined result for them) even though the CALLER in `visitColumnRefSites`
 * skips dv-target configPatches entirely before ever reaching this function: `DYNAMIC_VIEW_ALLOW_LIST`
 * in `actionAllowList.ts` holds exactly one field, `enabled: z.boolean()` — no column can ever
 * reach a dv-target configPatch, so the caller treats that case as "nothing to walk," not merely
 * "resolved to nothing."
 */
export const resolveConfigPatchTableId = (
  target: unknown,
  input: ColumnRefsInput,
): { tableId: number | null; tableScope: ColumnRefTableScope } => {
  if (!isPlainObject(target)) return { tableId: null, tableScope: "unresolved" };
  const kind = target.kind;
  const id = asPositiveInt(target.id);
  if (kind === "layer" && id !== undefined) {
    const layer = input.layers.find((l) => l.id === id);
    if (layer) return resolveLayerTableId(layer, input.dynamicViews);
    return { tableId: null, tableScope: "unresolved" };
  }
  if (kind === "widget" && id !== undefined) {
    const widget = input.widgets.find((w) => w.id === id);
    if (widget) {
      return resolveWidgetTableId((widget.config ?? {}) as Record<string, unknown>, input.dynamicViews);
    }
    return { tableId: null, tableScope: "unresolved" };
  }
  return { tableId: null, tableScope: "unresolved" };
};

/**
 * Shared structured-site emitter (Plan 123-02), used by every `widget.config.*` exact site below
 * and, in Plans 123-03/04, by the layer and `configPatch` sites too. Rules, all load-bearing:
 * - Skip unless `value` is a non-empty (post-trim) string and `column` is non-empty.
 * - Match is EXACT, case-SENSITIVE string equality against the RAW value — the same identity
 *   question `schemaDiff.ts` answers case-sensitively. The case-INSENSITIVE rule belongs to
 *   free-SQL text scanning ONLY (`scanFreeSql` above); unifying the two is explicitly forbidden by
 *   123-CONTEXT.md.
 * - Emit only when `resolved.tableScope === "unresolved"` OR `resolved.tableId === query.tableId`.
 *   An `unresolved` record is ALWAYS reported regardless of the queried table — fail toward
 *   reporting, per the locked rule that a missed finding is the expensive failure and a surplus
 *   one is merely noise.
 * - `confidence: "exact"`, `matches: []` — always, for a structured site.
 */
const emitStructured = (args: {
  value: unknown;
  column: string;
  site: ColumnRefSite;
  path: string;
  recordKind: ColumnRefRecordKind;
  recordId: number | null;
  recordLabel: string;
  resolved: { tableId: number | null; tableScope: ColumnRefTableScope };
  query: ColumnQuery;
  emit: (ref: ColumnRef) => void;
}): void => {
  const {
    value, column, site, path, recordKind, recordId, recordLabel, resolved, query, emit,
  } = args;
  if (typeof value !== "string" || value.trim() === "" || column === "") return;
  if (value !== column) return;
  if (resolved.tableScope !== "unresolved" && resolved.tableId !== query.tableId) return;
  emit({
    column,
    site,
    path,
    recordKind,
    recordId,
    recordLabel,
    tableId: resolved.tableId,
    tableScope: resolved.tableScope,
    confidence: "exact",
    matches: [],
  });
};

/**
 * Shared free-SQL emitter, used by all five FREE_SQL_SITES blocks below.
 * - Skips when `text` is null/undefined/empty or when `column` is empty.
 * - Emits EXACTLY ONE ColumnRef carrying ALL matches — one finding per reference SITE (locked),
 *   never one per occurrence.
 * - `tableId: null`, `tableScope: "free-sql"` — ALWAYS. A free-SQL finding never claims a table.
 *   Forced by real data: dynamic-view templates join tables the app never registered through the
 *   view's own bound table, through aliases (`FROM {view} a join vaipr.vaipr_location_exposure b
 *   on ...` — a DIFFERENT REGISTERED table, id 5, not the dv's own source_table_id 4), so
 *   attributing a match there to the view's own bound table would often simply be wrong.
 * - `confidence`: `low-confidence` when `isLowConfidenceColumnName(column)`, else `heuristic`.
 */
const emitFreeSql = (args: {
  text: string | null | undefined;
  site: ColumnRefSite;
  path: string;
  recordKind: ColumnRefRecordKind;
  recordId: number | null;
  recordLabel: string;
  column: string;
  emit: (ref: ColumnRef) => void;
}): void => {
  const { text, site, path, recordKind, recordId, recordLabel, column, emit } = args;
  if (!text || !column) return;
  const matches = scanFreeSql(text, column);
  if (matches.length === 0) return;
  emit({
    column,
    site,
    path,
    recordKind,
    recordId,
    recordLabel,
    tableId: null,
    tableScope: "free-sql",
    confidence: isLowConfidenceColumnName(column) ? "low-confidence" : "heuristic",
    matches,
  });
};

/**
 * Shared JSON-string reader (Plan 123-03) — `cb_config`, `track_config` and `info_columns` are all
 * TEXT columns holding JSON. `null` or an all-whitespace string is "not configured", never
 * malformed. A `JSON.parse` failure is reported as `malformed: true` rather than thrown or
 * swallowed — the caller decides what to do with that signal (see `emitMalformedJsonFallback`
 * below).
 */
const readJsonString = (raw: string | null): { parsed: unknown; malformed: boolean } => {
  if (raw === null || raw.trim() === "") return { parsed: undefined, malformed: false };
  try {
    return { parsed: JSON.parse(raw), malformed: false };
  } catch {
    return { parsed: undefined, malformed: true };
  }
};

/**
 * The malformed-JSON fallback (Plan 123-03) — the rule that keeps a corrupt stored blob from
 * silently erasing a reference. Invoked when a layer's `cb_config` / `track_config` /
 * `info_columns` TEXT column fails to `JSON.parse`. Runs `scanFreeSql` over the RAW stored string
 * and emits (at most) ONE finding at the site that owns the record's primary column-bearing
 * field, with:
 * - `confidence`: downgraded via the SAME `isLowConfidenceColumnName` rule free-SQL sites use —
 *   the exact path could not be proven, so the claim is no stronger than a text match.
 * - `tableId` / `tableScope`: taken from the RECORD's own `resolved` (NOT `null`/`"free-sql"`) —
 *   the record's table is still known; only the exact path inside its corrupt blob could not be.
 * - `matches`: from `scanFreeSql`, so Phase 124 can show the operator the corrupt text. If
 *   `scanFreeSql` finds nothing (the column genuinely is not mentioned in the corrupt text), no
 *   finding is emitted — this fallback reports what the raw text actually contains, it does not
 *   manufacture a finding out of nothing.
 *
 * Rationale, load-bearing: `coalesceTrackConfig` in `packages/web/src/lib/trackConfig.ts` returns
 * `{ enabled: false }` on a parse failure — it SWALLOWS the error, which is correct for a renderer
 * (better a plain layer than a crash) and catastrophically wrong for an impact report. A malformed
 * blob that silently reports zero references is precisely the confidently-incomplete outcome this
 * phase exists to prevent. 123-CONTEXT.md's discretion clause is explicit: fail toward REPORTING
 * a match; a missed finding is the expensive failure and a false positive is merely noise.
 */
const emitMalformedJsonFallback = (args: {
  raw: string;
  site: ColumnRefSite;
  path: string;
  recordKind: ColumnRefRecordKind;
  recordId: number | null;
  recordLabel: string;
  resolved: { tableId: number | null; tableScope: ColumnRefTableScope };
  column: string;
  emit: (ref: ColumnRef) => void;
}): void => {
  const { raw, site, path, recordKind, recordId, recordLabel, resolved, column, emit } = args;
  const matches = scanFreeSql(raw, column);
  if (matches.length === 0) return;
  emit({
    column,
    site,
    path,
    recordKind,
    recordId,
    recordLabel,
    tableId: resolved.tableId,
    tableScope: resolved.tableScope,
    confidence: isLowConfidenceColumnName(column) ? "low-confidence" : "heuristic",
    matches,
  });
};

/**
 * Walk every record in `input` once, testing every queried column (`query.columns`, empty entries
 * skipped) at each site this plan implements, and call `emit` per site hit. This is the ONLY place
 * these sites are enumerated; `collectColumnRefs` drives it with a collecting visitor.
 */
const visitColumnRefSites = (
  input: ColumnRefsInput,
  query: ColumnQuery,
  emit: (ref: ColumnRef) => void,
): void => {
  const columns = query.columns.filter((c) => c.length > 0);
  if (columns.length === 0) return;

  // --- widget structured sites, Task 1 (Plan 123-02): the eight scalar / CSV fields on
  // widget.config. Each widget's table is resolved ONCE via resolveWidgetTableId — this is what
  // makes a same-named column on a different table yield no finding (phase success criterion 4).
  // The six array sites (groupByColumns[], metrics[].column, filterFields[].column,
  // spatialTargets[].*) are a SEPARATE loop below (Task 2) so each task's commit is a pure
  // addition, never an edit to a block a previous commit's own tests already cover. ---
  for (const widget of input.widgets) {
    const cfg = (widget.config ?? {}) as Record<string, unknown>;
    const resolved = resolveWidgetTableId(cfg, input.dynamicViews);
    const recordKind: ColumnRefRecordKind = "widget";
    const recordId = widget.id;
    const recordLabel = widget.title;

    for (const column of columns) {
      emitStructured({
        value: cfg.metricColumn, column, site: "widget.config.metricColumn",
        path: "config.metricColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.groupByColumn, column, site: "widget.config.groupByColumn",
        path: "config.groupByColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.drillDownColumn, column, site: "widget.config.drillDownColumn",
        path: "config.drillDownColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.timeCol, column, site: "widget.config.timeCol",
        path: "config.timeCol", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.xField, column, site: "widget.config.xField",
        path: "config.xField", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      // deltaField / sortField: the KEY is present on every real bignumber / records widget, but
      // its value is ALWAYS "" in both kinetica.db and env-b.db — their tests use SYNTHETIC
      // fixtures. A site with no real data behind it is where a bug survives a suite built from
      // real fixtures — said at the site, not only in the SUMMARY.
      emitStructured({
        value: cfg.deltaField, column, site: "widget.config.deltaField",
        path: "config.deltaField", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.sortField, column, site: "widget.config.sortField",
        path: "config.sortField", recordKind, recordId, recordLabel, resolved, query, emit,
      });
    }

    // widget.config.columns is a COMMA-SEPARATED string, not a single column — split on ",",
    // trim each token, skip empty tokens, compare each token EXACTLY (still case-sensitive). Path
    // stays "config.columns" (the field is the site; de-duplication in collectColumnRefs collapses
    // a repeated token). Real value in the dev DB: widget 69's columns: "emirate" — a single
    // token, which is exactly why the multi-token behaviour needs its own explicitly-synthetic
    // test.
    if (typeof cfg.columns === "string" && cfg.columns.trim() !== "") {
      const tokens = cfg.columns
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "");
      for (const column of columns) {
        if (!tokens.includes(column)) continue;
        if (resolved.tableScope !== "unresolved" && resolved.tableId !== query.tableId) continue;
        emit({
          column,
          site: "widget.config.columns",
          path: "config.columns",
          recordKind,
          recordId,
          recordLabel,
          tableId: resolved.tableId,
          tableScope: resolved.tableScope,
          confidence: "exact",
          matches: [],
        });
      }
    }
  }

  // --- widget structured sites, Task 2 (Plan 123-02): the six array fields. A SEPARATE loop from
  // Task 1's scalar/CSV sites above (each task's commit is a pure addition). ---
  for (const widget of input.widgets) {
    const cfg = (widget.config ?? {}) as Record<string, unknown>;
    const resolved = resolveWidgetTableId(cfg, input.dynamicViews);
    const recordKind: ColumnRefRecordKind = "widget";
    const recordId = widget.id;
    const recordLabel = widget.title;

    if (Array.isArray(cfg.groupByColumns)) {
      const arr = cfg.groupByColumns as unknown[];
      for (let i = 0; i < arr.length; i++) {
        for (const column of columns) {
          emitStructured({
            value: arr[i], column, site: "widget.config.groupByColumns[]",
            path: `config.groupByColumns[${i}]`, recordKind, recordId, recordLabel, resolved,
            query, emit,
          });
        }
      }
    }

    if (Array.isArray(cfg.metrics)) {
      const arr = cfg.metrics as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i];
        if (!isPlainObject(el)) continue;
        for (const column of columns) {
          emitStructured({
            value: el.column, column, site: "widget.config.metrics[].column",
            path: `config.metrics[${i}].column`, recordKind, recordId, recordLabel, resolved,
            query, emit,
          });
        }
      }
    }

    if (Array.isArray(cfg.filterFields)) {
      const arr = cfg.filterFields as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i];
        if (!isPlainObject(el)) continue;
        for (const column of columns) {
          // Never read el.kind here: filterFields[].kind holds "multi-select" / "dropdown", a
          // structural discriminator, not a column — it is in EXCLUDED_LOOKALIKE_KEYS.
          emitStructured({
            value: el.column, column, site: "widget.config.filterFields[].column",
            path: `config.filterFields[${i}].column`, recordKind, recordId, recordLabel, resolved,
            query, emit,
          });
        }
      }
    }

    // spatialTargets[] — the REF-9 shape (dashboardExportRefs.ts). Each element is scoped by its
    // OWN tableId, NEVER by the widget's `resolved` above: a map widget's own config.tableId can
    // differ from any/all of its spatialTargets[].tableId values, and widget 1 in the dev DB has
    // NO config.tableId at all while carrying two targets on tables 1 and 3. Inheriting the
    // parent's table here would produce exactly the silent wrong-table attribution
    // dashboardExportRefs.ts's REF-9 comment describes — the reference kind three separate audit
    // sweeps missed in v1.24, and the stated reason this phase is flagged highest-risk.
    if (Array.isArray(cfg.spatialTargets)) {
      const arr = cfg.spatialTargets as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i];
        if (!isPlainObject(el)) continue;
        const ownId = asPositiveInt(el.tableId);
        const own: { tableId: number | null; tableScope: ColumnRefTableScope } =
          ownId !== undefined
            ? { tableId: ownId, tableScope: "scoped" }
            : { tableId: null, tableScope: "unresolved" };
        for (const column of columns) {
          // lonCol / latCol / spatialCol are read UNCONDITIONALLY, never gated on the element's
          // own spatial mode field: that field is a structural discriminator ("latlon"/"wkt"/
          // "wkb"), collides case-insensitively with the real column WKT, and is in
          // EXCLUDED_LOOKALIKE_KEYS. Gating on it would make a mode/field mismatch in stored data
          // silently unreportable. Whichever field is a non-empty string gets tested.
          emitStructured({
            value: el.lonCol, column, site: "widget.config.spatialTargets[].lonCol",
            path: `config.spatialTargets[${i}].lonCol`, recordKind, recordId, recordLabel,
            resolved: own, query, emit,
          });
          emitStructured({
            value: el.latCol, column, site: "widget.config.spatialTargets[].latCol",
            path: `config.spatialTargets[${i}].latCol`, recordKind, recordId, recordLabel,
            resolved: own, query, emit,
          });
          // spatialCol: ZERO instances in the dev DB — no wkt-mode targets and no spatialCol
          // values anywhere in widgets.config (confirmed read-only during PLANNING, not by
          // 123-RESEARCH.md's own zero-instance table — a NINTH zero-instance site on top of the
          // eight the research listed). Its test fixture is SYNTHETIC.
          emitStructured({
            value: el.spatialCol, column, site: "widget.config.spatialTargets[].spatialCol",
            path: `config.spatialTargets[${i}].spatialCol`, recordKind, recordId, recordLabel,
            resolved: own, query, emit,
          });
        }
      }
    }
  }

  // --- layer structured sites, Task 1 (Plan 123-03): the four layer.config.* spatial column
  // bindings. Each layer's table is resolved ONCE via resolveLayerTableId, mirroring the widget
  // loop above. Task 2 extends this SAME loop with the cb_config/track_config JSON-string sites
  // and Task 3 extends it further with info_columns/info_template — one loop, not three, because
  // each TEXT column must be parsed once per layer, not once per site. ---
  for (const layer of input.layers) {
    const cfg = (layer.config ?? {}) as Record<string, unknown>;
    const resolved = resolveLayerTableId(layer, input.dynamicViews);
    const recordKind: ColumnRefRecordKind = "layer";
    const recordId = layer.id;
    // config.name is a DISPLAY NAME, not a column — it is in EXCLUDED_LOOKALIKE_KEYS precisely
    // because it can look column-ish. Reading it here as a LABEL is correct; reading it as a
    // VALUE (comparing it against a queried column, the way the four sites below do) would not
    // be — exactly the confusion the exclude list exists to prevent.
    const recordLabel = typeof cfg.name === "string" ? cfg.name : "";

    for (const column of columns) {
      emitStructured({
        value: cfg.latColumn, column, site: "layer.config.latColumn",
        path: "config.latColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.lonColumn, column, site: "layer.config.lonColumn",
        path: "config.lonColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      emitStructured({
        value: cfg.wktColumn, column, site: "layer.config.wktColumn",
        path: "config.wktColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
      // wkbColumn: ZERO instances in kinetica.db or env-b.db — only wktColumn is ever populated
      // (1 row and 4 rows respectively). Its test fixture is SYNTHETIC. Related:
      // TD-V14-WKB-SPIKE means WKB is gated at 501 throughout the app, so this field has never
      // had a reason to be filled — a sleeper, not a dead field.
      emitStructured({
        value: cfg.wkbColumn, column, site: "layer.config.wkbColumn",
        path: "config.wkbColumn", recordKind, recordId, recordLabel, resolved, query, emit,
      });
    }

    // cb_config / track_config — Task 2 (Plan 123-03). Each TEXT column is parsed ONCE per layer
    // (not once per site) and read by NAMED KEY ONLY — the parsed object's own key set is never
    // enumerated generically — so `cb_config.breaks[]`'s styling siblings (color, label,
    // pointShape, shapeLineColor, shapeFillColor) and `track_config`'s styling siblings
    // (headColor, trailColor, headShape, markerColor, markerShape) can never false-positive under
    // a generic walk.
    const cbConfigResult = readJsonString(layer.cb_config);
    if (cbConfigResult.malformed && layer.cb_config) {
      for (const column of columns) {
        emitMalformedJsonFallback({
          raw: layer.cb_config, site: "layer.cb_config.attr", path: "cb_config.attr",
          recordKind, recordId, recordLabel, resolved, column, emit,
        });
      }
    } else if (isPlainObject(cbConfigResult.parsed)) {
      const cbConfig = cbConfigResult.parsed;
      for (const column of columns) {
        emitStructured({
          value: cbConfig.attr, column, site: "layer.cb_config.attr",
          path: "cb_config.attr", recordKind, recordId, recordLabel, resolved, query, emit,
        });
      }
    }

    const trackConfigResult = readJsonString(layer.track_config);
    if (trackConfigResult.malformed && layer.track_config) {
      for (const column of columns) {
        emitMalformedJsonFallback({
          raw: layer.track_config, site: "layer.track_config.trackIdAttr",
          path: "track_config.trackIdAttr", recordKind, recordId, recordLabel, resolved, column,
          emit,
        });
      }
    } else if (isPlainObject(trackConfigResult.parsed)) {
      const trackConfig = trackConfigResult.parsed;
      for (const column of columns) {
        emitStructured({
          value: trackConfig.trackIdAttr, column, site: "layer.track_config.trackIdAttr",
          path: "track_config.trackIdAttr", recordKind, recordId, recordLabel, resolved, query,
          emit,
        });
        emitStructured({
          value: trackConfig.trackOrderAttr, column, site: "layer.track_config.trackOrderAttr",
          path: "track_config.trackOrderAttr", recordKind, recordId, recordLabel, resolved, query,
          emit,
        });
        // xCol / yCol: real TrackConfig fields (Phase 52, x/longitude and y/latitude for track
        // points, packages/web/src/lib/trackConfig.ts) that ZERO stored rows in either database
        // set — every real track_config uses only trackIdAttr/trackOrderAttr plus styling.
        // SYNTHETIC fixtures. Unrelated: packages/web/src/lib/trackDetect.ts has its own
        // xCol/yCol identifiers — a RUNTIME column-shape detector over live query results, not a
        // persisted field; do not conflate the two.
        emitStructured({
          value: trackConfig.xCol, column, site: "layer.track_config.xCol",
          path: "track_config.xCol", recordKind, recordId, recordLabel, resolved, query, emit,
        });
        emitStructured({
          value: trackConfig.yCol, column, site: "layer.track_config.yCol",
          path: "track_config.yCol", recordKind, recordId, recordLabel, resolved, query, emit,
        });
      }
    }

    // info_columns — Task 3 (Plan 123-03): a JSON-array-of-strings TEXT column
    // (`'["lon","lat"]'`, packages/server/src/types.ts). `null` (or empty) means ALL COLUMNS and
    // therefore names nothing — emitting a finding for "all columns" here would flood the report
    // with a hit for every layer on every query, so a null/empty value is deliberately skipped,
    // never defaulted to "everything matches". ZERO populated instances in either database (0/10
    // kinetica.db, 0/8 env-b.db) — no operator has ever configured an info-popup override in
    // either environment, so this fixture is SYNTHETIC, inferred from the writer
    // (KineticaWmsLayerForm.tsx) and the type, not observed.
    const infoColumnsResult = readJsonString(layer.info_columns);
    if (infoColumnsResult.malformed && layer.info_columns) {
      for (const column of columns) {
        emitMalformedJsonFallback({
          raw: layer.info_columns, site: "layer.info_columns", path: "info_columns",
          recordKind, recordId, recordLabel, resolved, column, emit,
        });
      }
    } else if (Array.isArray(infoColumnsResult.parsed)) {
      const arr = infoColumnsResult.parsed as unknown[];
      for (let i = 0; i < arr.length; i++) {
        for (const column of columns) {
          emitStructured({
            value: arr[i], column, site: "layer.info_columns",
            path: `info_columns[${i}]`, recordKind, recordId, recordLabel, resolved, query, emit,
          });
        }
      }
    }

    // info_template — Task 3: raw HTML carrying `{ColumnName}` placeholders, emitted verbatim by
    // KineticaWmsLayerForm.tsx's `` `{${col}}` `` (braces, no spaces, no case change). Does NOT
    // use `scanFreeSql` — this is not SQL and the whole-identifier lookaround is the wrong tool.
    // Matching is EXACT and case-SENSITIVE against the trimmed placeholder body: a case mismatch
    // is a genuinely different reference, not a formatting variation. ZERO populated instances in
    // either database — SYNTHETIC fixture only, same "no operator has ever configured this"
    // caveat as info_columns above.
    if (typeof layer.info_template === "string" && layer.info_template !== "") {
      const template = layer.info_template;
      const templateLines = template.split("\n");
      const lineStarts: number[] = [0];
      for (const l of templateLines.slice(0, -1)) {
        lineStarts.push(lineStarts[lineStarts.length - 1] + l.length + 1); // +1 for the "\n"
      }
      for (const column of columns) {
        const templateMatches: ColumnRefMatch[] = [];
        const placeholderRegex = /\{([^{}]*)\}/g;
        let placeholderMatch: RegExpExecArray | null;
        while ((placeholderMatch = placeholderRegex.exec(template)) !== null) {
          const rawBody = placeholderMatch[1];
          const trimmedBody = rawBody.trim();
          if (trimmedBody !== column) continue;
          const leadingWhitespace = rawBody.length - rawBody.trimStart().length;
          // +1 skips the opening "{"; the column name's offset is measured from the FIRST
          // non-whitespace character of the placeholder body, not from the brace — Phase 124
          // highlights the name, not the delimiter.
          const absoluteIndex = placeholderMatch.index + 1 + leadingWhitespace;
          let lineIdx = 0;
          for (let i = 0; i < lineStarts.length; i++) {
            if (lineStarts[i] <= absoluteIndex) lineIdx = i;
            else break;
          }
          templateMatches.push({
            line: templateLines[lineIdx],
            lineNumber: lineIdx + 1,
            offset: absoluteIndex - lineStarts[lineIdx],
          });
        }
        if (templateMatches.length === 0) continue;
        if (resolved.tableScope !== "unresolved" && resolved.tableId !== query.tableId) continue;
        emit({
          column,
          site: "layer.info_template",
          path: "info_template",
          recordKind,
          recordId,
          recordLabel,
          tableId: resolved.tableId,
          tableScope: resolved.tableScope,
          confidence: "exact",
          matches: templateMatches,
        });
      }
    }
  }

  // --- radio-group configPatch copies (Plan 123-04, Tasks 1-2): the eight
  // widget.config.options[].configPatch.* sites, walked across BOTH the plural
  // options[].actions[] shape and the legacy singular options[].action shape via
  // getOptionActionsLike (below) — a file-local MIRROR of dashboardExportRefs.ts's helper of the
  // same name, deliberately copied rather than imported (zero diff to that module is a phase
  // success criterion). The dev DB's 12 known copies split 11 plural / 1 legacy; they only
  // reconcile when both shapes are walked.
  //
  // Each finding is OWNED by the radio-group WIDGET (recordKind: "widget", recordId: the
  // widget's own id — the copy lives in ITS config, not the record it patches) but SCOPED to the
  // TARGET record's table via resolveConfigPatchTableId, below — distinct from the layer's (or
  // widget's) own matching site, which is a SEPARATE finding with its own recordKind/recordId.
  //
  // A dynamicView-target configPatch is skipped ENTIRELY, never reported even as 'unresolved':
  // DYNAMIC_VIEW_ALLOW_LIST in actionAllowList.ts holds exactly one field, `enabled: z.boolean()`
  // — no column can ever reach a dv-target configPatch, so treating it as unresolved-but-reported
  // would be pure noise.
  for (const widget of input.widgets) {
    const cfg = (widget.config ?? {}) as Record<string, unknown>;
    if (!Array.isArray(cfg.options)) continue;
    const recordKind: ColumnRefRecordKind = "widget";
    const recordId = widget.id;
    const recordLabel = widget.title;
    const options = cfg.options as unknown[];

    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (!isPlainObject(option)) continue;
      const actionsLike = getOptionActionsLike(option);

      for (const { action, pathFragment } of actionsLike) {
        if (!isPlainObject(action)) continue;
        const patch = action.configPatch;
        if (!isPlainObject(patch)) continue;

        const target = action.target;
        const targetKind = isPlainObject(target) ? target.kind : undefined;
        if (targetKind === "dynamicView") continue;

        const resolved = resolveConfigPatchTableId(target, input);
        const pathPrefix = `config.options[${i}].${pathFragment}.configPatch`;

        // widget.config.options[].configPatch.metric (Task 2) — a PLAIN string, not JSON. Its
        // sibling `aggregation` key is never read: it is one of CHART_AGGREGATIONS
        // (sum/avg/min/max/count/count_distinct), an enum, not a column.
        //
        // PLANNER NOTE: this is the ONE site in COLUMN_REF_SITES that ROADMAP success criterion 2
        // does not name. It is included because 123-CONTEXT.md's canonical_refs section states
        // plainly that `chart.metric` in the configPatch allow-list IS a column name, and because
        // it costs one block inside a traversal that already visits every configPatch. It has
        // ZERO instances in either database. Striking it (if the operator wants the inventory held
        // to exactly criterion 2's literal wording) means removing this block, its registry entry,
        // its named test and its master-fixture entry — flagged for the operator in the SUMMARY.
        for (const column of columns) {
          emitStructured({
            value: patch.metric, column, site: "widget.config.options[].configPatch.metric",
            path: `${pathPrefix}.metric`, recordKind, recordId, recordLabel, resolved, query, emit,
          });
        }

        // cb_config.attr — a JSON-string TOP-LEVEL configPatch field (same shape as the layer's
        // own cb_config, read via the SAME readJsonString/emitMalformedJsonFallback helpers Plan
        // 123-03 wrote — these are the same payload in a different location, not a second
        // implementation of the same idea).
        const cbConfigResult = readJsonString(
          typeof patch.cb_config === "string" ? patch.cb_config : null,
        );
        if (cbConfigResult.malformed && typeof patch.cb_config === "string") {
          for (const column of columns) {
            emitMalformedJsonFallback({
              raw: patch.cb_config, site: "widget.config.options[].configPatch.cb_config.attr",
              path: `${pathPrefix}.cb_config.attr`, recordKind, recordId, recordLabel, resolved,
              column, emit,
            });
          }
        } else if (isPlainObject(cbConfigResult.parsed)) {
          const cbConfig = cbConfigResult.parsed;
          for (const column of columns) {
            emitStructured({
              value: cbConfig.attr, column,
              site: "widget.config.options[].configPatch.cb_config.attr",
              path: `${pathPrefix}.cb_config.attr`, recordKind, recordId, recordLabel, resolved,
              query, emit,
            });
          }
        }

        // track_config.{trackIdAttr,trackOrderAttr,xCol,yCol} — same JSON-string treatment.
        // xCol/yCol are SYNTHETIC (zero instances anywhere — see layer.track_config.xCol/yCol
        // above; the same real TrackConfig fields, one layer deeper).
        const trackConfigResult = readJsonString(
          typeof patch.track_config === "string" ? patch.track_config : null,
        );
        if (trackConfigResult.malformed && typeof patch.track_config === "string") {
          for (const column of columns) {
            emitMalformedJsonFallback({
              raw: patch.track_config,
              site: "widget.config.options[].configPatch.track_config.trackIdAttr",
              path: `${pathPrefix}.track_config.trackIdAttr`, recordKind, recordId, recordLabel,
              resolved, column, emit,
            });
          }
        } else if (isPlainObject(trackConfigResult.parsed)) {
          const trackConfig = trackConfigResult.parsed;
          for (const column of columns) {
            emitStructured({
              value: trackConfig.trackIdAttr, column,
              site: "widget.config.options[].configPatch.track_config.trackIdAttr",
              path: `${pathPrefix}.track_config.trackIdAttr`, recordKind, recordId, recordLabel,
              resolved, query, emit,
            });
            emitStructured({
              value: trackConfig.trackOrderAttr, column,
              site: "widget.config.options[].configPatch.track_config.trackOrderAttr",
              path: `${pathPrefix}.track_config.trackOrderAttr`, recordKind, recordId, recordLabel,
              resolved, query, emit,
            });
            emitStructured({
              value: trackConfig.xCol, column,
              site: "widget.config.options[].configPatch.track_config.xCol",
              path: `${pathPrefix}.track_config.xCol`, recordKind, recordId, recordLabel,
              resolved, query, emit,
            });
            emitStructured({
              value: trackConfig.yCol, column,
              site: "widget.config.options[].configPatch.track_config.yCol",
              path: `${pathPrefix}.track_config.yCol`, recordKind, recordId, recordLabel,
              resolved, query, emit,
            });
          }
        }

        // info_columns — a JSON-array-of-strings TOP-LEVEL configPatch field. SYNTHETIC: ZERO
        // instances in either database. Enumerated because the CURRENT layer-target validator
        // (validateLayerSnapshot, actionAllowList.ts, Phase 60.1 RE-SCOPE — a DENYLIST that
        // supersedes the stricter LAYER_ALLOW_LIST for layer targets) accepts this key today,
        // making it structurally identical to cb_config/track_config the moment an operator
        // configures a per-option info-popup override.
        const infoColumnsResult = readJsonString(
          typeof patch.info_columns === "string" ? patch.info_columns : null,
        );
        if (infoColumnsResult.malformed && typeof patch.info_columns === "string") {
          for (const column of columns) {
            emitMalformedJsonFallback({
              raw: patch.info_columns, site: "widget.config.options[].configPatch.info_columns",
              path: `${pathPrefix}.info_columns`, recordKind, recordId, recordLabel, resolved,
              column, emit,
            });
          }
        } else if (Array.isArray(infoColumnsResult.parsed)) {
          const arr = infoColumnsResult.parsed as unknown[];
          for (let j = 0; j < arr.length; j++) {
            for (const column of columns) {
              emitStructured({
                value: arr[j], column, site: "widget.config.options[].configPatch.info_columns",
                path: `${pathPrefix}.info_columns[${j}]`, recordKind, recordId, recordLabel,
                resolved, query, emit,
              });
            }
          }
        }

        // info_template — raw HTML carrying {ColumnName} placeholders. Same dedicated placeholder
        // regex as layer.info_template above (never scanFreeSql — this is not SQL). SYNTHETIC:
        // ZERO instances in either database, same "no operator has ever configured this" caveat.
        if (typeof patch.info_template === "string" && patch.info_template !== "") {
          const template = patch.info_template;
          const templateLines = template.split("\n");
          const lineStarts: number[] = [0];
          for (const l of templateLines.slice(0, -1)) {
            lineStarts.push(lineStarts[lineStarts.length - 1] + l.length + 1);
          }
          for (const column of columns) {
            const templateMatches: ColumnRefMatch[] = [];
            const placeholderRegex = /\{([^{}]*)\}/g;
            let placeholderMatch: RegExpExecArray | null;
            while ((placeholderMatch = placeholderRegex.exec(template)) !== null) {
              const rawBody = placeholderMatch[1];
              const trimmedBody = rawBody.trim();
              if (trimmedBody !== column) continue;
              const leadingWhitespace = rawBody.length - rawBody.trimStart().length;
              const absoluteIndex = placeholderMatch.index + 1 + leadingWhitespace;
              let lineIdx = 0;
              for (let k = 0; k < lineStarts.length; k++) {
                if (lineStarts[k] <= absoluteIndex) lineIdx = k;
                else break;
              }
              templateMatches.push({
                line: templateLines[lineIdx],
                lineNumber: lineIdx + 1,
                offset: absoluteIndex - lineStarts[lineIdx],
              });
            }
            if (templateMatches.length === 0) continue;
            if (resolved.tableScope !== "unresolved" && resolved.tableId !== query.tableId) continue;
            emit({
              column,
              site: "widget.config.options[].configPatch.info_template",
              path: `${pathPrefix}.info_template`,
              recordKind,
              recordId,
              recordLabel,
              tableId: resolved.tableId,
              tableScope: resolved.tableScope,
              confidence: "exact",
              matches: templateMatches,
            });
          }
        }
      }
    }
  }

  // --- columnDisplayConfig.column_name (Plan 123-04, Task 2): global per-table column display
  // config. ColumnDisplayConfigRow has a COMPOSITE primary key (table_id, column_name) and no
  // surrogate id — recordId is ALWAYS null; identify a finding as (tableId, recordLabel). A
  // deliberate divergence from custom_metrics, which took an opaque autoincrement id so Phase 100
  // widget references could survive label edits. Phase 124 must not assume recordId is a number.
  for (const row of input.columnDisplayConfig) {
    for (const column of columns) {
      if (row.column_name !== column) continue;
      if (row.table_id !== query.tableId) continue;
      emit({
        column,
        site: "columnDisplayConfig.column_name",
        path: "column_name",
        recordKind: "columnDisplayConfig",
        recordId: null,
        recordLabel: row.column_name,
        tableId: row.table_id,
        tableScope: "scoped",
        confidence: "exact",
        matches: [],
      });
    }
  }

  // --- The five FREE_SQL_SITES (this plan). All emitted REGARDLESS of query.tableId: they are
  // table-less, so there is nothing to filter on — this is why widget.config.sql for a widget on
  // a different table still appears; the operator chose completeness over a quieter report,
  // knowing it duplicates exact findings elsewhere. ---

  for (const widget of input.widgets) {
    const cfg = widget.config as Record<string, unknown> | null | undefined;
    const sql = typeof cfg?.sql === "string" ? cfg.sql : undefined;
    const customWhere = typeof cfg?.customWhere === "string" ? cfg.customWhere : undefined;
    for (const column of columns) {
      emitFreeSql({
        text: sql,
        site: "widget.config.sql",
        path: "config.sql",
        recordKind: "widget",
        recordId: widget.id,
        recordLabel: widget.title,
        column,
        emit,
      });
      emitFreeSql({
        text: customWhere,
        site: "widget.config.customWhere",
        path: "config.customWhere",
        recordKind: "widget",
        recordId: widget.id,
        recordLabel: widget.title,
        column,
        emit,
      });
    }
  }

  for (const metric of input.customMetrics) {
    for (const column of columns) {
      emitFreeSql({
        text: metric.expression,
        site: "customMetric.expression",
        path: "expression",
        recordKind: "customMetric",
        recordId: metric.id,
        recordLabel: metric.label,
        column,
        emit,
      });
    }
  }

  for (const dv of input.dynamicViews) {
    for (const column of columns) {
      emitFreeSql({
        text: dv.template_sql,
        site: "dynamicView.template_sql",
        path: "template_sql",
        recordKind: "dynamicView",
        recordId: dv.id,
        recordLabel: dv.name,
        column,
        emit,
      });
    }
  }

  // `tableView.filter_clause` — ZERO populated instances in either packages/server/data/kinetica.db
  // (0 of 12 rows) or env-b.db (0 rows), so its test fixture is SYNTHETIC. A site with no real data
  // behind it is exactly where a bug survives a suite built from real fixtures — flagged here, not
  // only in the SUMMARY.
  for (const view of input.tableViews) {
    for (const column of columns) {
      emitFreeSql({
        text: view.filter_clause,
        site: "tableView.filter_clause",
        path: "filter_clause",
        recordKind: "tableView",
        recordId: view.id,
        recordLabel: view.view_name,
        column,
        emit,
      });
    }
  }

  // --- dynamicView.columns_json[].name (this plan, Task 3) — the site three code-reading sweeps
  // would have missed. See 123-RESEARCH.md Finding 1 / Pitfall 1, 123-CONTEXT.md's "TWO SITES
  // ADDED 2026-09-22" section, item 1.
  //
  // Why it exists at all: `Taxi Copy` (source table 1) and `mv view` (source table 6) both have
  // `template_sql = "select * from {view}"` — literally no column text — while their
  // `columns_json` holds 19 and 251 real source columns respectively. Every dv-bound config panel
  // (`LayersModal`, `ChartConfigPanel`, `CalendarConfigPanel`, `RadioGroupConfigPanel`) reads its
  // column picker from `dv.columns_json`, NOT from the source table. Without this block, dropping
  // `vendor_id` from table 1 reports nothing for those views while they silently go stale.
  //
  // Why TABLE-LESS rather than scoped to `source_table_id`: the provenance is mixed and proven so
  // in the operator's own data. `FF` and `EQ` (source table 4, `vaipr.vaipr_location`) hold
  // columns of the joined table `vaipr.vaipr_location_exposure` — REGISTERED as table id 5,
  // distinct from the dv's own source_table_id 4 (verified read-only against the dev DB
  // 2026-09-22; an earlier draft of this comment called that table "unregistered" — it is not,
  // which makes the table-less decision STRONGER, not weaker: attributing `cede_db` to table 4
  // would be ACTIVELY WRONG, since it is table 5's column, not merely imprecise). `Avg NYC`
  // (source table 1) holds computed aliases (`cell`, `WKT`, `avg_passenger_count`) that are
  // columns of nothing at all. Scoping these to `source_table_id` would attribute a name to a
  // table it does not belong to. Detecting "this template has no join" from `template_sql` text
  // is exactly the kind of heuristic the free-SQL rules exist to avoid trusting.
  //
  // Why `heuristic` and not `exact`: `exact` in this module means "the value IS this table's
  // column". Here the value is a cached output-shape name whose table is unknown. Reporting it as
  // `exact` would be a stronger claim than the data supports.
  //
  // Match rule: EXACT string equality, case-SENSITIVE — comparing a stored column name to a
  // stored column name is the same identity question `schemaDiff.ts` answers case-sensitively; it
  // is NOT a text scan, so the case-insensitive free-SQL rule does not apply, and neither does the
  // low-confidence tier (which grades TEXT-match noise; a stored-name equality carries none).
  //
  // Note for Phase 124: `columns_json[].type` is frozen at Preview time exactly like
  // `drillDownColumnType`, so it is a second stale-type cache. Enumerating type staleness is NOT
  // this module's job (it enumerates NAME references); flagging its existence is.
  for (const dv of input.dynamicViews) {
    if (!dv.columns_json) continue;
    for (let i = 0; i < dv.columns_json.length; i++) {
      const entry = dv.columns_json[i];
      for (const column of columns) {
        if (entry.name !== column) continue;
        emit({
          column,
          site: "dynamicView.columns_json[].name",
          path: `columns_json[${i}].name`,
          recordKind: "dynamicView",
          recordId: dv.id,
          recordLabel: dv.name,
          tableId: null,
          tableScope: "free-sql",
          confidence: "heuristic",
          matches: [],
        });
      }
    }
  }
};

/**
 * Byte-stable ascending sort, same rationale as `schemaDiff.ts`'s `byColumnAscending`: Phase 125
 * persists these arrays, and a locale-dependent order would produce spurious history churn between
 * machines. Sort key, in order: recordKind (by RECORD_KIND_ORDER index), recordId ascending with
 * null last, site (by COLUMN_REF_SITES index), path (byte-ascending), column (byte-ascending).
 */
const byteAscending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortColumnRefs = (refs: ColumnRef[]): ColumnRef[] =>
  [...refs].sort((a, b) => {
    const kindDiff =
      RECORD_KIND_ORDER.indexOf(a.recordKind) - RECORD_KIND_ORDER.indexOf(b.recordKind);
    if (kindDiff !== 0) return kindDiff;

    if (a.recordId !== b.recordId) {
      if (a.recordId === null) return 1;
      if (b.recordId === null) return -1;
      return a.recordId - b.recordId;
    }

    const siteDiff = COLUMN_REF_SITES.indexOf(a.site) - COLUMN_REF_SITES.indexOf(b.site);
    if (siteDiff !== 0) return siteDiff;

    const pathDiff = byteAscending(a.path, b.path);
    if (pathDiff !== 0) return pathDiff;

    return byteAscending(a.column, b.column);
  });

/**
 * De-duplicate at most one finding per (recordKind, recordId, site, path, column) tuple. Two
 * identical tuples can only arise from a traversal bug; collapsing them silently would hide it, so
 * de-duplication happens at the END, here, not inside the emitter.
 */
const dedupeColumnRefs = (refs: ColumnRef[]): ColumnRef[] => {
  const seen = new Set<string>();
  const out: ColumnRef[] = [];
  for (const ref of refs) {
    const key = `${ref.recordKind}|${ref.recordId}|${ref.site}|${ref.path}|${ref.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

/**
 * Entry point. Collects every ColumnRef finding across `input` for the queried table's columns
 * (`query.columns`), sorted deterministically and de-duplicated.
 */
export function collectColumnRefs(input: ColumnRefsInput, query: ColumnQuery): ColumnRef[] {
  const out: ColumnRef[] = [];
  visitColumnRefSites(input, query, (ref) => out.push(ref));
  return sortColumnRefs(dedupeColumnRefs(out));
}
