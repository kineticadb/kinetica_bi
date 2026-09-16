/**
 * Phase 119 Plan 01 — the single source of truth for WHERE ids hide inside a persisted
 * dashboard's JSON (widgets.config, dashboard_layers.filter_scope) and its FK columns.
 *
 * Research (119-RESEARCH.md §Q1) found EIGHT reference kinds inside `widgets.config`, plus a
 * sixth site carrying the same shape on the `dashboard_layers.filter_scope` DB column:
 *
 *   REF-1  config.tableId                              -> table
 *   REF-2  config.dynamicViewId                         -> dynamicView
 *   REF-3  config.sourceMapWidgetId                      -> widget       (standalone Legend, Phase 42)
 *   REF-4  config.metricId (scalar)                      -> customMetric
 *   REF-5  config.metrics[].metricId (array)              -> customMetric
 *   REF-6  config.includedLayerIds (array)                -> layer
 *   REF-7  config.filterSelection.allowedSourceWidgetIds   -> widget (mixed with a non-id sentinel string)
 *   REF-8  config.options[].actions[].target               -> widget | layer | dynamicView (polymorphic),
 *          AND the legacy singular config.options[].action.target (pre-Phase-60.2 persisted blobs)
 *
 * Plus, on `dashboard_layers` directly (not nested in `config`):
 *   `table_id`, `dynamic_view_id` (FK columns) and `filter_scope` (same shape as REF-7).
 * And on `dashboard_dynamic_views`: `source_table_id`.
 *
 * Adding a NINTH reference kind anywhere in `packages/web/src/components/charts/` (a new widget
 * type, or a new id-valued field on an existing config) requires updating this module and its
 * spec (`tests/lib.dashboardExportRefs.spec.ts`) — this file is the only place a value is allowed
 * to become an id for export purposes.
 *
 * Pure module — NO DB access, NO Express, NO new dependency. Only a type-only import of the two
 * row shapes it reads. This is deliberate: Phase 120's import remapper consumes the same
 * `ExportRefs` shape produced here, and the assembler (Plan 02) is kept separate so the walk
 * itself stays fully unit-testable in isolation.
 */
import type { DashboardLayer, DashboardDynamicView } from "../types";

/** The five distinct kinds of entity a reference can point at. */
export type RefKind = "table" | "widget" | "layer" | "dynamicView" | "customMetric";

/** De-duplicated, ascending-sorted id lists, one per RefKind. */
export type ExportRefs = {
  tableIds: number[];
  widgetIds: number[];
  layerIds: number[];
  dynamicViewIds: number[];
  customMetricIds: number[];
};

export const emptyExportRefs = (): ExportRefs => ({
  tableIds: [],
  widgetIds: [],
  layerIds: [],
  dynamicViewIds: [],
  customMetricIds: [],
});

/**
 * The ONLY place a value becomes an id. `> 0` matches `WidgetActionTargetSchema`'s
 * `z.number().int().positive()` and every AUTOINCREMENT rowid in this schema. Strings are
 * rejected outright — this is what makes the spatial-draws sentinel string (see
 * `filterSourceTypes.ts` on the web side) pass through harmlessly instead of becoming `NaN`.
 * Never coerce with `Number(v)` or `parseInt`.
 */
const asId = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;

const dedupSorted = (list: number[]): number[] => [...new Set(list)].sort((a, b) => a - b);

/**
 * Normalize a raw accumulation (possibly containing duplicates, in any order) into the
 * de-duplicated, ascending-sorted shape every collector in this module must return.
 */
const normalize = (raw: ExportRefs): ExportRefs => ({
  tableIds: dedupSorted(raw.tableIds),
  widgetIds: dedupSorted(raw.widgetIds),
  layerIds: dedupSorted(raw.layerIds),
  dynamicViewIds: dedupSorted(raw.dynamicViewIds),
  customMetricIds: dedupSorted(raw.customMetricIds),
});

/** Concatenate every list across all parts, then de-dup + sort each. */
export const mergeExportRefs = (...parts: ExportRefs[]): ExportRefs =>
  normalize({
    tableIds: parts.flatMap((p) => p.tableIds),
    widgetIds: parts.flatMap((p) => p.widgetIds),
    layerIds: parts.flatMap((p) => p.layerIds),
    dynamicViewIds: parts.flatMap((p) => p.dynamicViewIds),
    customMetricIds: parts.flatMap((p) => p.customMetricIds),
  });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * REF-7 / sixth-site shared shape: `{ sourceMode, allowedSourceWidgetIds: (number | string)[] }`.
 * Accepts either an already-parsed object (widgets.config.filterSelection, always an object) or a
 * raw JSON string (dashboard_layers.filter_scope is typed `string | null` at the DB boundary,
 * though `mapDashboardLayer` in practice hands back a parsed object — accept both rather than
 * trusting a type that is documented to lie).
 *
 * Returns only the numeric, positive-integer entries. Anything non-numeric — including the
 * spatial-draws sentinel string (see `SPATIAL_DRAWS_SENTINEL` in
 * `packages/web/src/components/charts/filterSourceTypes.ts`) — is dropped silently by `asId`'s
 * structural check. Never `Number(entry)`, never `parseInt`: that would turn the sentinel into
 * `NaN`, which would then survive into the array and corrupt filter behaviour on import.
 */
export const collectFilterSelectionRefs = (value: unknown): number[] => {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!isPlainObject(parsed)) return [];
  const ids = parsed.allowedSourceWidgetIds;
  if (!Array.isArray(ids)) return [];
  const out: number[] = [];
  for (const entry of ids) {
    const id = asId(entry);
    if (id !== undefined) out.push(id);
  }
  return out;
};

/** RadioGroup action shape as read off a persisted config option (both `actions[]` and legacy `action`). */
type ActionLike = { target?: unknown };

/**
 * Mirrors `getOptionActions()` in `packages/web/src/lib/radioGroupConfig.ts`: reads the new
 * `actions[]` array shape (Phase 60.2+) OR falls back to the legacy singular `action` field
 * (pre-Phase-60.2 persisted blobs). Reading only `actions[]` would silently drop every
 * legacy-shaped option's target.
 */
const getOptionActionsLike = (option: Record<string, unknown>): ActionLike[] => {
  if (Array.isArray(option.actions)) return option.actions as ActionLike[];
  if (option.action && typeof option.action === "object") return [option.action as ActionLike];
  return [];
};

/**
 * Walk a single widget's parsed `config` object and extract every reference kind (REF-1..8).
 * Returns `emptyExportRefs()` for any non-object config (null, undefined, string, array) — a
 * widget with a malformed config simply contributes no references rather than throwing.
 */
export const collectWidgetConfigRefs = (config: unknown): ExportRefs => {
  const out = emptyExportRefs();
  if (!isPlainObject(config)) return out;
  const cfg = config;

  // REF-1: config.tableId -> table
  const tableId = asId(cfg.tableId);
  if (tableId !== undefined) out.tableIds.push(tableId);

  // REF-2: config.dynamicViewId -> dynamicView
  const dynamicViewId = asId(cfg.dynamicViewId);
  if (dynamicViewId !== undefined) out.dynamicViewIds.push(dynamicViewId);

  // REF-3: config.sourceMapWidgetId -> widget (standalone Legend widget, Phase 42)
  const sourceMapWidgetId = asId(cfg.sourceMapWidgetId);
  if (sourceMapWidgetId !== undefined) out.widgetIds.push(sourceMapWidgetId);

  // REF-4: config.metricId (scalar) -> customMetric
  const metricId = asId(cfg.metricId);
  if (metricId !== undefined) out.customMetricIds.push(metricId);

  // REF-5: config.metrics[].metricId (array) -> customMetric, one per element
  if (Array.isArray(cfg.metrics)) {
    for (const el of cfg.metrics) {
      if (!isPlainObject(el)) continue;
      const id = asId(el.metricId);
      if (id !== undefined) out.customMetricIds.push(id);
    }
  }

  // REF-6: config.includedLayerIds (array) -> layer, one per element.
  // An empty array AND an absent field BOTH mean "render all layers" (Map-widget sentinel).
  // Both therefore contribute ZERO layer references here — never expand either one to the
  // dashboard's full layer list, that would fabricate references the operator never made and
  // would defeat the sentinel on import.
  if (Array.isArray(cfg.includedLayerIds)) {
    for (const el of cfg.includedLayerIds) {
      const id = asId(el);
      if (id !== undefined) out.layerIds.push(id);
    }
  }

  // REF-7: config.filterSelection.allowedSourceWidgetIds -> widget (mixed with sentinel string)
  out.widgetIds.push(...collectFilterSelectionRefs(cfg.filterSelection));

  // REF-8: config.options[].actions[].target (and legacy singular options[].action.target)
  // -> polymorphic {kind, id} dispatch to widget / layer / dynamicView.
  // Does NOT recurse into configPatch — research verified the full allow-list contains no
  // id-valued field.
  if (Array.isArray(cfg.options)) {
    for (const option of cfg.options) {
      if (!isPlainObject(option)) continue;
      const actions = getOptionActionsLike(option);
      for (const action of actions) {
        if (!action || !isPlainObject(action.target as unknown)) continue;
        const target = action.target as Record<string, unknown>;
        const id = asId(target.id);
        if (id === undefined) continue;
        switch (target.kind) {
          case "widget":
            out.widgetIds.push(id);
            break;
          case "layer":
            out.layerIds.push(id);
            break;
          case "dynamicView":
            out.dynamicViewIds.push(id);
            break;
          default:
            // unknown target.kind is ignored rather than mis-filed
            break;
        }
      }
    }
  }

  return normalize(out);
};

/**
 * Walk a single `dashboard_layers` row's FK columns and its `filter_scope` JSON-as-TEXT column.
 * Does NOT touch `cb_config`, `track_config` or `layer.config` — layer `config` is style state
 * and research found no id-valued field in any of the three.
 */
export const collectLayerRefs = (layer: DashboardLayer): ExportRefs => {
  const out = emptyExportRefs();

  const tableId = asId(layer.table_id);
  if (tableId !== undefined) out.tableIds.push(tableId);

  const dynamicViewId = asId(layer.dynamic_view_id);
  if (dynamicViewId !== undefined) out.dynamicViewIds.push(dynamicViewId);

  out.widgetIds.push(...collectFilterSelectionRefs(layer.filter_scope));

  return normalize(out);
};

/**
 * Walk a single `dashboard_dynamic_views` row. Only `source_table_id` carries an id;
 * `columns_json` carries no ids.
 */
export const collectDynamicViewRefs = (dv: DashboardDynamicView): ExportRefs => {
  const out = emptyExportRefs();
  const tableId = asId(dv.source_table_id);
  if (tableId !== undefined) out.tableIds.push(tableId);
  return normalize(out);
};
