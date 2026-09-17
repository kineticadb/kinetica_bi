/**
 * Phase 119 Plan 01 / Phase 120 Plan 01 — the single source of truth for WHERE ids hide inside a
 * persisted dashboard's JSON (widgets.config, dashboard_layers.filter_scope) and its FK columns.
 *
 * Research (119-RESEARCH.md §Q1, confirmed again in 120-RESEARCH.md) found EIGHT reference kinds
 * inside `widgets.config`, plus a sixth site carrying the same shape on the
 * `dashboard_layers.filter_scope` DB column:
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
 * ONE TRAVERSAL, TWO DIRECTIONS (Phase 120 Plan 01). `visitWidgetConfigRefs` is now the ONLY place
 * these eight sites are enumerated. `collectWidgetConfigRefs` drives it with an identity visitor
 * (report the id, keep it unchanged); Phase 120's `remapWidgetConfigRefs` drives the SAME function
 * with a map-or-strip visitor (report the id, write back the mapped id or delete the site). Adding
 * a NINTH reference kind means adding exactly one new block inside `visitWidgetConfigRefs` — both
 * collect and remap automatically pick it up, because there is no second list to forget.
 * `visitFilterSelectionRefs` is the equivalent single traversal for the REF-7 / sixth-site shape
 * (`{ sourceMode, allowedSourceWidgetIds }`), shared by `collectFilterSelectionRefs` and Phase 120's
 * `remapFilterSelection`.
 *
 * Pure module — NO DB access, NO Express, NO new dependency. Only a type-only import of the two
 * row shapes it reads.
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
 * Called once per reference SITE found by the traversal.
 * Return a number    -> that value is written back AT THAT SITE.
 * Return `undefined` -> the reference is unresolvable and the site is STRIPPED per its own rule.
 *                        NEVER left as the original id (see Pitfall 3 in 120-RESEARCH.md).
 * The identity visitor (`(site) => site.id`) turns this into a pure, non-mutating COLLECT pass.
 */
export type RefVisitor = (site: { kind: RefKind; id: number }) => number | undefined;

/** Side-channel for site-specific outcomes the flat visitor signature cannot express. */
export type VisitNotes = {
  /**
   * Set true when a NON-EMPTY includedLayerIds array became EMPTY because every element was
   * unmapped. `[]` means ALL LAYERS, so this is a silent WIDENING of what the widget shows and the
   * caller MUST surface it. Never fires for an already-empty or absent array.
   */
  layerFilterWidened: boolean;
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
 * REF-7 / sixth-site shared traversal: `{ sourceMode, allowedSourceWidgetIds: (number | string)[] }`.
 * Takes an ALREADY-PARSED object — string parsing (dashboard_layers.filter_scope is typed
 * `string | null` at the DB boundary, though `mapDashboardLayer` in practice hands back a parsed
 * object) stays where it already lives: `collectFilterSelectionRefs` and Phase 120's
 * `remapFilterSelection`.
 *
 * Rebuilds `allowedSourceWidgetIds` in place. Non-numeric entries — including the spatial-draws
 * sentinel string (see `SPATIAL_DRAWS_SENTINEL` in
 * `packages/web/src/components/charts/filterSourceTypes.ts`) — are pushed through completely
 * VERBATIM, never inspected, never coerced: a naive `.map()` over the whole array would look the
 * sentinel up in a `Map<number, number>`, get `undefined` back, and silently destroy spatial-draw
 * filtering on the imported dashboard.
 */
export const visitFilterSelectionRefs = (value: unknown, visit: RefVisitor): void => {
  if (!isPlainObject(value)) return;
  const ids = value.allowedSourceWidgetIds;
  if (!Array.isArray(ids)) return;
  const out: unknown[] = [];
  for (const entry of ids) {
    const id = asId(entry);
    if (id === undefined) {
      out.push(entry); // non-numeric (including the sentinel) passes through untouched
      continue;
    }
    const next = visit({ kind: "widget", id });
    if (next !== undefined) out.push(next); // unmapped => dropped, never left as the old id
  }
  value.allowedSourceWidgetIds = out;
};

/**
 * Walk a single widget's parsed `config` object, visiting every reference kind (REF-1..8) exactly
 * once each. Mutates `config` IN PLACE — callers that must not mutate their own object (e.g.
 * `collectWidgetConfigRefs`) must pass a clone.
 *
 * This is the ONLY place the eight sites are enumerated. `collectWidgetConfigRefs` drives it with
 * an identity visitor; Phase 120's `remapWidgetConfigRefs` drives it with a map-or-strip visitor.
 * A ninth reference kind added here is automatically picked up by both directions.
 */
export const visitWidgetConfigRefs = (
  config: unknown,
  visit: RefVisitor,
  notes?: VisitNotes
): void => {
  if (!isPlainObject(config)) return;
  const cfg = config;

  // REF-1: config.tableId -> table
  {
    const id = asId(cfg.tableId);
    if (id !== undefined) {
      const next = visit({ kind: "table", id });
      if (next === undefined) delete cfg.tableId;
      else cfg.tableId = next;
    }
  }

  // REF-2: config.dynamicViewId -> dynamicView
  {
    const id = asId(cfg.dynamicViewId);
    if (id !== undefined) {
      const next = visit({ kind: "dynamicView", id });
      if (next === undefined) delete cfg.dynamicViewId;
      else cfg.dynamicViewId = next;
    }
  }

  // REF-3: config.sourceMapWidgetId -> widget (standalone Legend widget, Phase 42)
  {
    const id = asId(cfg.sourceMapWidgetId);
    if (id !== undefined) {
      const next = visit({ kind: "widget", id });
      if (next === undefined) delete cfg.sourceMapWidgetId;
      else cfg.sourceMapWidgetId = next;
    }
  }

  // REF-4: config.metricId (scalar) -> customMetric
  {
    const id = asId(cfg.metricId);
    if (id !== undefined) {
      const next = visit({ kind: "customMetric", id });
      if (next === undefined) delete cfg.metricId;
      else cfg.metricId = next;
    }
  }

  // REF-5: config.metrics[].metricId (array) -> customMetric, one per element.
  // On strip, delete the ELEMENT's metricId only — dropping the element itself would renumber
  // the metrics list and shift every sibling's position.
  if (Array.isArray(cfg.metrics)) {
    for (const el of cfg.metrics) {
      if (!isPlainObject(el)) continue;
      const id = asId(el.metricId);
      if (id !== undefined) {
        const next = visit({ kind: "customMetric", id });
        if (next === undefined) delete el.metricId;
        else el.metricId = next;
      }
    }
  }

  // REF-6: config.includedLayerIds (array) -> layer, one per element.
  // An empty array is a SENTINEL meaning ALL LAYERS (including layers added later) — it must
  // NEVER be materialised into a concrete list, and it must survive as [] unchanged. If every
  // element of a NON-empty array is unmapped, dropping them all yields [] too — indistinguishable
  // from the ALL-layers sentinel, and there is no representation for "zero layers" (the UI cannot
  // produce that state either). That is UNFIXABLE; `notes.layerFilterWidened` surfaces it instead.
  if (Array.isArray(cfg.includedLayerIds)) {
    const src = cfg.includedLayerIds as unknown[];
    const out: unknown[] = [];
    let numericSeen = 0;
    for (const el of src) {
      const id = asId(el);
      if (id === undefined) {
        out.push(el); // non-numeric passes through verbatim
        continue;
      }
      numericSeen++;
      const next = visit({ kind: "layer", id });
      if (next !== undefined) out.push(next); // unmapped => dropped
    }
    cfg.includedLayerIds = out;
    if (notes && numericSeen > 0 && out.length === 0) notes.layerFilterWidened = true;
  }

  // REF-7: config.filterSelection.allowedSourceWidgetIds -> widget (mixed with sentinel string).
  // No `notes`: an emptied allowlist narrows (fewer filter sources apply), it does not widen.
  visitFilterSelectionRefs(cfg.filterSelection, visit);

  // REF-8: config.options[].actions[].target (and legacy singular options[].action.target)
  // -> polymorphic {kind, id} dispatch to widget / layer / dynamicView.
  // Does NOT recurse into configPatch — research verified the full allow-list contains no
  // id-valued field.
  if (Array.isArray(cfg.options)) {
    for (const option of cfg.options) {
      if (!isPlainObject(option)) continue;
      const usesArray = Array.isArray(option.actions);
      const actions = getOptionActionsLike(option);
      const keep: ActionLike[] = [];
      for (const action of actions) {
        if (!action || !isPlainObject(action.target)) {
          keep.push(action);
          continue;
        }
        const target = action.target as Record<string, unknown>;
        const id = asId(target.id);
        if (id === undefined) {
          keep.push(action); // no numeric id: untouched, never mis-filed
          continue;
        }
        const kind: RefKind | undefined =
          target.kind === "widget"
            ? "widget"
            : target.kind === "layer"
              ? "layer"
              : target.kind === "dynamicView"
                ? "dynamicView"
                : undefined;
        if (kind === undefined) {
          keep.push(action); // unknown target.kind: untouched, never mis-filed
          continue;
        }
        const next = visit({ kind, id });
        if (next === undefined) continue; // DROP the whole action: a stale target.id with no
        // remapped destination is the exact "points at a coincidental pre-existing record"
        // defect this module exists to prevent; WidgetActionTargetSchema also requires a
        // positive integer id, so nulling target.id would be malformed anyway.
        target.id = next;
        keep.push(action);
      }
      if (usesArray) option.actions = keep;
      else if (keep.length === 0) delete option.action;
      // else: the legacy singular `action` object was mutated in place above (keep[0] === it).
    }
  }
};

/**
 * Deep-clone a plain-JSON value via a JSON round-trip. Widget config is pure JSON by construction
 * (`mapWidget` produces it via `JSON.parse`), so this avoids any `structuredClone`
 * global/lib-typing question while guaranteeing the visitor's in-place mutation never reaches the
 * caller's own object.
 */
const cloneJson = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * REF-7 / sixth-site shared shape: `{ sourceMode, allowedSourceWidgetIds: (number | string)[] }`.
 * Accepts either an already-parsed object (widgets.config.filterSelection, always an object) or a
 * raw JSON string (dashboard_layers.filter_scope is typed `string | null` at the DB boundary,
 * though `mapDashboardLayer` in practice hands back a parsed object — accept both rather than
 * trusting a type that is documented to lie).
 *
 * Returns only the numeric, positive-integer entries, by driving `visitFilterSelectionRefs` over a
 * CLONE with an identity visitor — collecting must never mutate the caller's object.
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
  const out: number[] = [];
  visitFilterSelectionRefs(cloneJson(parsed), (site) => {
    out.push(site.id);
    return site.id; // identity => no observable rewrite
  });
  return out;
};

/**
 * Walk a single widget's parsed `config` object and extract every reference kind (REF-1..8).
 * Returns `emptyExportRefs()` for any non-object config (null, undefined, string, array) — a
 * widget with a malformed config simply contributes no references rather than throwing.
 *
 * Drives the single shared `visitWidgetConfigRefs` traversal with an identity visitor over a
 * CLONE of `config` — collecting must never mutate the caller's object.
 */
export const collectWidgetConfigRefs = (config: unknown): ExportRefs => {
  const out = emptyExportRefs();
  visitWidgetConfigRefs(cloneJson(config), (site) => {
    switch (site.kind) {
      case "table":
        out.tableIds.push(site.id);
        break;
      case "widget":
        out.widgetIds.push(site.id);
        break;
      case "layer":
        out.layerIds.push(site.id);
        break;
      case "dynamicView":
        out.dynamicViewIds.push(site.id);
        break;
      case "customMetric":
        out.customMetricIds.push(site.id);
        break;
    }
    return site.id; // identity => no observable rewrite
  });
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

// ---------------------------------------------------------------------------------------------
// Phase 120 Plan 01 — the remap side. Drives the SAME `visitWidgetConfigRefs` /
// `visitFilterSelectionRefs` traversal as the collectors above, with a map-or-strip visitor
// instead of an identity one. There is no second enumeration of the eight sites here.
// ---------------------------------------------------------------------------------------------

/** Old-id -> new-id, one map per RefKind. A MISSING key means "unresolvable" -> strip the site. */
export type RefIdMaps = {
  table: Map<number, number>;
  widget: Map<number, number>;
  layer: Map<number, number>;
  dynamicView: Map<number, number>;
  customMetric: Map<number, number>;
};

export const emptyRefIdMaps = (): RefIdMaps => ({
  table: new Map(),
  widget: new Map(),
  layer: new Map(),
  dynamicView: new Map(),
  customMetric: new Map(),
});

export type StrippedRef = { kind: RefKind; id: number };

export type RemapOutcome = {
  /** A NEW object. The input is never mutated. */
  config: Record<string, unknown>;
  /** Every site whose old id had no entry in the corresponding map. Reported, never silently kept. */
  stripped: StrippedRef[];
  /** See VisitNotes.layerFilterWidened — a non-empty layer filter became [] (= ALL LAYERS). */
  layerFilterWidened: boolean;
};

/**
 * Rewrite every reference site inside a widget's `config` to its NEW id, per `maps`. Any old id
 * with no entry in the matching map is STRIPPED (never left in place — see Pitfall 3,
 * 120-RESEARCH.md: an unmapped old id in the TARGET environment silently points at whatever
 * happens to carry that id there). The visitor below never falls back to the site's own original
 * value on a lookup miss — a missing map entry always resolves to `undefined`, i.e. strip.
 */
export const remapWidgetConfigRefs = (config: unknown, maps: RefIdMaps): RemapOutcome => {
  const next = isPlainObject(config) ? cloneJson(config) : {};
  const stripped: StrippedRef[] = [];
  const notes: VisitNotes = { layerFilterWidened: false };
  visitWidgetConfigRefs(
    next,
    (site) => {
      const mapped = maps[site.kind].get(site.id);
      if (mapped === undefined) {
        stripped.push({ kind: site.kind, id: site.id });
        return undefined;
      }
      return mapped;
    },
    notes,
  );
  return { config: next, stripped, layerFilterWidened: notes.layerFilterWidened };
};

/**
 * Rewrite a `filterSelection`-shaped value (widgets.config.filterSelection, or the sixth site
 * `dashboard_layers.filter_scope`) to NEW widget ids. Accepts either an already-parsed object or a
 * raw JSON string (mirrors `collectFilterSelectionRefs`'s "accept both" rule — `filter_scope` is
 * typed `string | null` but `mapDashboardLayer` hands back a parsed object at runtime).
 *
 * The CALLER is responsible for `JSON.stringify`-ing the returned `value` before it reaches
 * `updateDashboardLayer` (see db.ts's own "Route stringifies on write" comment) — this function
 * only ever returns a plain object or `null`.
 */
export const remapFilterSelection = (
  value: unknown,
  widgetIdMap: Map<number, number>,
): { value: Record<string, unknown> | null; stripped: StrippedRef[] } => {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { value: null, stripped: [] };
    }
  }
  if (!isPlainObject(parsed)) return { value: null, stripped: [] };
  const next = cloneJson(parsed);
  const stripped: StrippedRef[] = [];
  visitFilterSelectionRefs(next, (site) => {
    const mapped = widgetIdMap.get(site.id);
    if (mapped === undefined) {
      stripped.push({ kind: site.kind, id: site.id });
      return undefined;
    }
    return mapped;
  });
  return { value: next, stripped };
};
