/**
 * packages/server/src/lib/dashboardImport.ts — Phase 120 Plan 02 (DXIM-V124-06/-07/-11)
 *
 * Everything import must decide BEFORE it starts writing a dashboard: is this file well-formed,
 * and which target rows do its tables and custom metrics resolve to.
 *
 * TWO-TIER VALIDATION (`validateImportFile`):
 *   TIER 1 — STRUCTURAL, REJECT. Wrong top-level types, a missing required collection, a
 *   non-numeric id where a number is required, an unsupported `schemaVersion`, a duplicate id
 *   within one collection. This tier runs ENTIRELY IN MEMORY, over the parsed JSON value, before
 *   any transaction opens — so "a rejected file changes nothing" (DXIM-V124-11) is true by
 *   construction, not dependent on rollback working. No DB access happens anywhere in this
 *   function.
 *   TIER 2 — REFERENTIAL, ACCEPT + REPORT. A reference to something outside the file (e.g. a
 *   Legend widget bound to a widget on another dashboard) is a legitimate, previously-observed
 *   real case (Phase 119's own `DANGLE-cross` fixture) — never fatal. Recomputed via the SAME
 *   `collect*` functions Phase 119/120 Plan 01 established (never a second list — see
 *   `dashboardExportRefs.ts`'s header). The file's OWN self-reported `danglingReferences` is
 *   NEVER trusted — a hand-edited file can lie about it — so it is recomputed from scratch here.
 *
 * TABLE / METRIC RESOLUTION (`resolveTables`, `resolveCustomMetrics`): the two places import
 * deliberately does NOT create a fresh row. Tables match by `schema.name` (DXIM-V124-06); custom
 * metrics match by exact `label` on the matched table (DXIM-V124-07). Both matching rules have a
 * silent failure mode, so both report what they did — see `resolveCustomMetrics`'s doc comment
 * for the locked metric-conflict policy.
 */
import type { CustomMetricRow, Table } from "../types";
import type { DashboardExportFile, DanglingReference } from "./dashboardExport";
import {
  asId,
  collectDynamicViewRefs,
  collectLayerRefs,
  collectWidgetConfigRefs,
  type RefKind,
} from "./dashboardExportRefs";
import {
  createCustomMetric,
  createTable,
  getTable,
  getTableBySchemaName,
  listCustomMetrics,
} from "../db";

/** This build reads exactly these envelope versions. EXPORT_SCHEMA_VERSION is currently 1. */
export const SUPPORTED_IMPORT_SCHEMA_VERSIONS: readonly number[] = [1];

export type ImportRejection = { code: string; message: string };

export type ValidateResult =
  | { ok: true; file: DashboardExportFile; dangling: DanglingReference[] }
  | { ok: false; rejection: ImportRejection };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Human-readable type label for a malformed-field message (`got <actualType>`). */
const typeLabel = (v: unknown): string => {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

const fail = (code: string, message: string): { ok: false; rejection: ImportRejection } => ({
  ok: false,
  rejection: { code, message },
});

/**
 * Tier-1 "wrong shape" rejection. Message form:
 * `Import file is malformed: <path> <expectation> (got <actualType>).`
 */
const malformed = (path: string, expectation: string, actual: unknown) =>
  fail("IMPORT_MALFORMED", `Import file is malformed: ${path} ${expectation} (got ${typeLabel(actual)}).`);

/**
 * Everything the import must decide BEFORE it starts writing a dashboard: is this file
 * well-formed, and (Tier 2) which of its own cross-references dangle outside the file.
 *
 * Fails FAST — the first problem found is returned immediately, one clear message rather than a
 * list, so an operator staring at a hand-edited file gets a single actionable pointer.
 */
export const validateImportFile = (raw: unknown): ValidateResult => {
  // 1. Body itself.
  if (!isPlainObject(raw)) return malformed("body", "must be an object", raw);

  // 2. schemaVersion — must be a positive integer, then a member of the supported list.
  if (asId(raw.schemaVersion) === undefined) {
    return malformed("schemaVersion", "must be a positive integer", raw.schemaVersion);
  }
  const schemaVersion = raw.schemaVersion as number;
  if (!SUPPORTED_IMPORT_SCHEMA_VERSIONS.includes(schemaVersion)) {
    return fail(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Unsupported schemaVersion: ${schemaVersion} (this build supports ${SUPPORTED_IMPORT_SCHEMA_VERSIONS.join(", ")}).`
    );
  }

  // 3. dashboard — id read for provenance only (import ALWAYS allocates a new id), but still
  // required to be a positive integer so a mangled file is caught rather than silently accepted.
  if (!isPlainObject(raw.dashboard)) return malformed("dashboard", "must be an object", raw.dashboard);
  const dashboard = raw.dashboard;
  if (asId(dashboard.id) === undefined) {
    return malformed("dashboard.id", "must be a positive integer", dashboard.id);
  }
  if (!isNonEmptyString(dashboard.name)) {
    return malformed("dashboard.name", "must be a non-empty string", dashboard.name);
  }

  // 4. Required top-level collections. A MISSING key is a rejection, not an empty default — a
  // file that lost a whole collection is exactly the hand-edited case DXIM-V124-11 names.
  const arrayFields: [string, unknown][] = [
    ["widgets", raw.widgets],
    ["layers", raw.layers],
    ["dynamicViews", raw.dynamicViews],
    ["tables", raw.tables],
    ["customMetrics", raw.customMetrics],
    ["dashboardTableIds", raw.dashboardTableIds],
  ];
  for (const [name, value] of arrayFields) {
    if (!Array.isArray(value)) return malformed(name, "must be an array", value);
  }

  const widgets = raw.widgets as unknown[];
  const layers = raw.layers as unknown[];
  const dynamicViews = raw.dynamicViews as unknown[];
  const tables = raw.tables as unknown[];
  const customMetrics = raw.customMetrics as unknown[];
  const dashboardTableIds = raw.dashboardTableIds as unknown[];

  // 5. Per-element checks (index reported in the path).
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (!isPlainObject(t)) return malformed(`tables[${i}]`, "must be an object", t);
    if (asId(t.id) === undefined) return malformed(`tables[${i}].id`, "must be a positive integer", t.id);
    if (!isNonEmptyString(t.name)) return malformed(`tables[${i}].name`, "must be a non-empty string", t.name);
    // Empty string IS legal for schema — the DDL defaults it to ''.
    if (typeof t.schema !== "string") return malformed(`tables[${i}].schema`, "must be a string", t.schema);
    if (!isPlainObject(t.columns)) return malformed(`tables[${i}].columns`, "must be an object", t.columns);
  }

  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    if (!isPlainObject(w)) return malformed(`widgets[${i}]`, "must be an object", w);
    if (asId(w.id) === undefined) return malformed(`widgets[${i}].id`, "must be a positive integer", w.id);
    if (typeof w.title !== "string") return malformed(`widgets[${i}].title`, "must be a string", w.title);
    if (!isNonEmptyString(w.type)) return malformed(`widgets[${i}].type`, "must be a non-empty string", w.type);
    if (typeof w.position !== "number") return malformed(`widgets[${i}].position`, "must be a number", w.position);
    if (!isPlainObject(w.config)) return malformed(`widgets[${i}].config`, "must be an object", w.config);
  }

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!isPlainObject(l)) return malformed(`layers[${i}]`, "must be an object", l);
    if (asId(l.id) === undefined) return malformed(`layers[${i}].id`, "must be a positive integer", l.id);
    if (asId(l.table_id) === undefined) {
      return malformed(`layers[${i}].table_id`, "must be a positive integer", l.table_id);
    }
    if (typeof l.position !== "number") return malformed(`layers[${i}].position`, "must be a number", l.position);
    if (!isPlainObject(l.config)) return malformed(`layers[${i}].config`, "must be an object", l.config);
    if (l.dynamic_view_id !== null && l.dynamic_view_id !== undefined && asId(l.dynamic_view_id) === undefined) {
      return malformed(`layers[${i}].dynamic_view_id`, "must be null or a positive integer", l.dynamic_view_id);
    }
    // filter_scope's TYPE LIES at the DB boundary (string | null) — mapDashboardLayer in practice
    // hands back a parsed object. Accept both, matching remapFilterSelection's own "accept both" rule.
    const fs = l.filter_scope;
    if (fs !== null && fs !== undefined && typeof fs !== "string" && !isPlainObject(fs)) {
      return malformed(`layers[${i}].filter_scope`, "must be null, a string, or an object", fs);
    }
  }

  for (let i = 0; i < dynamicViews.length; i++) {
    const d = dynamicViews[i];
    if (!isPlainObject(d)) return malformed(`dynamicViews[${i}]`, "must be an object", d);
    if (asId(d.id) === undefined) return malformed(`dynamicViews[${i}].id`, "must be a positive integer", d.id);
    if (asId(d.source_table_id) === undefined) {
      return malformed(`dynamicViews[${i}].source_table_id`, "must be a positive integer", d.source_table_id);
    }
    if (!isNonEmptyString(d.name)) return malformed(`dynamicViews[${i}].name`, "must be a non-empty string", d.name);
    if (!isNonEmptyString(d.template_sql)) {
      return malformed(`dynamicViews[${i}].template_sql`, "must be a non-empty string", d.template_sql);
    }
    if (asId(d.max_records) === undefined) {
      return malformed(`dynamicViews[${i}].max_records`, "must be a positive integer", d.max_records);
    }
    if (d.columns_json !== null && d.columns_json !== undefined && !Array.isArray(d.columns_json)) {
      return malformed(`dynamicViews[${i}].columns_json`, "must be null or an array", d.columns_json);
    }
  }

  for (let i = 0; i < customMetrics.length; i++) {
    const m = customMetrics[i];
    if (!isPlainObject(m)) return malformed(`customMetrics[${i}]`, "must be an object", m);
    if (asId(m.id) === undefined) return malformed(`customMetrics[${i}].id`, "must be a positive integer", m.id);
    if (asId(m.table_id) === undefined) {
      return malformed(`customMetrics[${i}].table_id`, "must be a positive integer", m.table_id);
    }
    if (!isNonEmptyString(m.label)) return malformed(`customMetrics[${i}].label`, "must be a non-empty string", m.label);
    if (!isNonEmptyString(m.expression)) {
      return malformed(`customMetrics[${i}].expression`, "must be a non-empty string", m.expression);
    }
  }

  for (let i = 0; i < dashboardTableIds.length; i++) {
    if (asId(dashboardTableIds[i]) === undefined) {
      return malformed(`dashboardTableIds[${i}]`, "must be a positive integer", dashboardTableIds[i]);
    }
  }

  // 6. Duplicate ids WITHIN any one collection. A genuine export cannot produce this; a
  // hand-edited file can, and it would silently make one id's later entry clobber the earlier
  // one's resolution.
  const dupCheck = (label: string, items: unknown[]): ImportRejection | undefined => {
    const seen = new Set<number>();
    for (const item of items) {
      const id = (item as { id: number }).id;
      if (seen.has(id)) {
        return { code: "IMPORT_MALFORMED", message: `Import file is malformed: duplicate id ${id} found in ${label}.` };
      }
      seen.add(id);
    }
    return undefined;
  };
  const collections: [string, unknown[]][] = [
    ["widgets", widgets],
    ["layers", layers],
    ["dynamicViews", dynamicViews],
    ["tables", tables],
    ["customMetrics", customMetrics],
  ];
  for (const [label, items] of collections) {
    const rejection = dupCheck(label, items);
    if (rejection) return { ok: false, rejection };
  }

  // Tier 1 passed — every field on the envelope has now been shape-checked, so the cast below is
  // no longer a leap of faith.
  const file = raw as unknown as DashboardExportFile;

  // Tier 2 — referential dangling references. Recomputed from the FILE's own id sets using the
  // same collect* functions as export — NEVER read raw.danglingReferences (a hand-edited file can
  // lie about it).
  const widgetIdSet = new Set(widgets.map((w) => (w as { id: number }).id));
  const layerIdSet = new Set(layers.map((l) => (l as { id: number }).id));
  const dvIdSet = new Set(dynamicViews.map((d) => (d as { id: number }).id));
  const tableIdSet = new Set(tables.map((t) => (t as { id: number }).id));
  const metricIdSet = new Set(customMetrics.map((m) => (m as { id: number }).id));

  const dangling: DanglingReference[] = [];
  const absorb = (from: string, kind: RefKind, ids: number[], known: Set<number>) => {
    for (const id of ids) if (!known.has(id)) dangling.push({ from, kind, id });
  };

  for (const w of file.widgets) {
    const refs = collectWidgetConfigRefs(w.config);
    absorb(`widget:${w.id}`, "widget", refs.widgetIds, widgetIdSet);
    absorb(`widget:${w.id}`, "layer", refs.layerIds, layerIdSet);
    absorb(`widget:${w.id}`, "dynamicView", refs.dynamicViewIds, dvIdSet);
    absorb(`widget:${w.id}`, "table", refs.tableIds, tableIdSet);
    absorb(`widget:${w.id}`, "customMetric", refs.customMetricIds, metricIdSet);
  }
  for (const l of file.layers) {
    const refs = collectLayerRefs(l);
    absorb(`layer:${l.id}`, "widget", refs.widgetIds, widgetIdSet);
    absorb(`layer:${l.id}`, "dynamicView", refs.dynamicViewIds, dvIdSet);
    absorb(`layer:${l.id}`, "table", refs.tableIds, tableIdSet);
  }
  for (const d of file.dynamicViews) {
    const refs = collectDynamicViewRefs(d);
    absorb(`dynamicView:${d.id}`, "table", refs.tableIds, tableIdSet);
  }
  for (const id of file.dashboardTableIds) {
    if (!tableIdSet.has(id)) dangling.push({ from: "dashboardTables", kind: "table", id });
  }

  return { ok: true, file, dangling };
};

// -------------------------------------------------------------------------------------------
// Table resolution (DXIM-V124-06) — match by schema.name, create when absent, never duplicate
// either against the target or within one file.
// -------------------------------------------------------------------------------------------

export type TableResolution = {
  oldId: number;
  newId: number;
  schema: string;
  name: string;
  /** `${schema}.${name}` — the operator-facing identity used throughout the report. */
  tableRef: string;
};

export type ResolveTablesResult = {
  /** old file table id -> target table id */
  map: Map<number, number>;
  matched: TableResolution[];
  created: TableResolution[];
};

/**
 * For each file table, in array order: reuse a target row already resolved earlier in THIS run
 * for the same `schema.name` (a second file entry naming one `schema.name` must not create a
 * second row — DXIM-V124-06 says "never duplicated", and that includes within one file); else
 * reuse an existing target row via `getTableBySchemaName`; else create one.
 *
 * A matched row's `columns`/`description` are NEVER overwritten from the file — the target's
 * registry entry is authoritative for the target environment, and every OTHER dashboard already
 * using that table would silently change if it were.
 */
export const resolveTables = (tables: Table[]): ResolveTablesResult => {
  const map = new Map<number, number>();
  const matched: TableResolution[] = [];
  const created: TableResolution[] = [];
  const seen = new Map<string, number>();

  for (const t of tables) {
    const key = `${t.schema}.${t.name}`;
    let newId = seen.get(key);
    if (newId === undefined) {
      const existing = getTableBySchemaName(t.schema, t.name);
      if (existing) {
        newId = existing.id;
        matched.push({ oldId: t.id, newId, schema: t.schema, name: t.name, tableRef: key });
      } else {
        const createdRow = createTable({
          schema: t.schema,
          name: t.name,
          columns: t.columns,
          description: t.description,
        });
        newId = createdRow.id;
        created.push({ oldId: t.id, newId, schema: t.schema, name: t.name, tableRef: key });
      }
      seen.set(key, newId);
    }
    map.set(t.id, newId);
  }

  return { map, matched, created };
};

// -------------------------------------------------------------------------------------------
// Custom-metric resolution (DXIM-V124-07) — match by exact label on the resolved table, create
// when absent.
// -------------------------------------------------------------------------------------------

export type MetricResolution = {
  oldId: number;
  newId: number;
  tableId: number;
  tableRef: string;
  label: string;
};

export type MetricConflict = MetricResolution & {
  existingExpression: string;
  importedExpression: string;
  /** Operator-facing sentence. Names the metric, the table, and that the expressions differed. */
  message: string;
};

export type ResolveMetricsResult = {
  /** old file metric id -> target metric id */
  map: Map<number, number>;
  matched: MetricResolution[];
  created: MetricResolution[];
  conflicts: MetricConflict[];
  skipped: { oldId: number; label: string; reason: string }[];
};

/**
 * Metric-label conflict policy — LOCKED by the operator, 2026-09-16 (recorded in
 * `120-CONTEXT.md` §"Custom-metric label conflict — OPERATOR DECISION", closing a provenance gap
 * the plan checker flagged: the decision was made in session before that file existed).
 *
 * When the matched table already has a metric with the SAME label but a DIFFERENT expression,
 * import REUSES the target's existing definition rather than creating a duplicate or renaming.
 * This matches the already-locked "match by label" rule and respects that the target
 * environment's definition is deliberate. The ACCEPTED COST: the imported widget then computes
 * something subtly different from what it computed in the source environment. This function's
 * `conflicts` array is the ONLY thing that turns that from silent into visible — the message
 * below MUST name the metric label, the table, and the fact that the expressions differed; a
 * bare "matched: Revenue" would hide exactly the risk the operator agreed to take.
 *
 * A conflicted metric is ALSO present in `matched` — it WAS reused, not skipped.
 */
export const resolveCustomMetrics = (
  metrics: CustomMetricRow[],
  tableIdMap: Map<number, number>
): ResolveMetricsResult => {
  const map = new Map<number, number>();
  const matched: MetricResolution[] = [];
  const created: MetricResolution[] = [];
  const conflicts: MetricConflict[] = [];
  const skipped: { oldId: number; label: string; reason: string }[] = [];

  for (const m of metrics) {
    const newTableId = tableIdMap.get(m.table_id);
    if (newTableId === undefined) {
      // The table itself was not resolvable (e.g. a dangling table_id already stripped by the
      // Plan 120-01 remapper). Skip rather than throw — the widgets referencing this metric will
      // have that reference stripped and reported separately.
      skipped.push({ oldId: m.id, label: m.label, reason: "table not resolvable" });
      continue;
    }

    const targetTable = getTable(newTableId);
    const tableRef = targetTable ? `${targetTable.schema}.${targetTable.name}` : `table#${newTableId}`;

    // Exact string equality: `label` has no COLLATE NOCASE in the custom_metrics DDL, so
    // SQLite's own UNIQUE(table_id, label) constraint is case-sensitive too. Matching must agree
    // with the constraint, or the createCustomMetric call below would throw on a case-only
    // "duplicate" that the constraint does not actually consider one.
    const existing = listCustomMetrics(newTableId).find((r) => r.label === m.label);

    if (existing) {
      map.set(m.id, existing.id);
      matched.push({ oldId: m.id, newId: existing.id, tableId: newTableId, tableRef, label: m.label });
      if (existing.expression !== m.expression) {
        conflicts.push({
          oldId: m.id,
          newId: existing.id,
          tableId: newTableId,
          tableRef,
          label: m.label,
          existingExpression: existing.expression,
          importedExpression: m.expression,
          message: `Custom metric "${m.label}" on ${tableRef} already exists in this environment with a DIFFERENT expression. Imported widgets now use the EXISTING definition (${existing.expression}); the file's definition (${m.expression}) was NOT applied.`,
        });
      }
    } else {
      const createdRow = createCustomMetric(newTableId, m.label, m.expression, m.format_spec);
      map.set(m.id, createdRow.id);
      created.push({ oldId: m.id, newId: createdRow.id, tableId: newTableId, tableRef, label: m.label });
    }
  }

  return { map, matched, created, conflicts, skipped };
};

// -------------------------------------------------------------------------------------------
// ImportReport — the shape Plan 120-03's applyDashboardImport fills in. Declared here so both
// resolution functions' output types (TableResolution / MetricResolution / MetricConflict) and
// the report itself live next to each other.
// -------------------------------------------------------------------------------------------

export type ImportReport = {
  dashboardId: number;
  dashboardName: string;
  widgetsCreated: number;
  layersCreated: number;
  dynamicViewsCreated: number;
  tablesMatched: TableResolution[];
  tablesCreated: TableResolution[];
  metricsMatched: MetricResolution[];
  metricsCreated: MetricResolution[];
  metricConflicts: MetricConflict[];
  /** References that pointed outside the file and were removed rather than left pointing at
   *  whatever happens to carry that id in the target. */
  strippedReferences: { from: string; kind: RefKind; id: number }[];
  /** Human-readable notes that are not errors but change behaviour — e.g. a layer filter that
   *  widened to ALL LAYERS, a skipped metric, a skipped layer. */
  warnings: string[];
};
