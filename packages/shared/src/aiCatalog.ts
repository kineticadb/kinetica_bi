// Phase 136 (D-03, D-10, D-11..D-13, D-23): positive AI config catalogue. Pure (zod only).
// Never imports ./aiOp (aiOp imports AiHeatmapStyleSchema from here).
import { z } from "zod";
import { AI_PALETTE_NAMES, AiIdentifierSchema, CHART_AGGREGATIONS, getWidgetAllowListSchemas } from "./actionAllowList";
import type { AiWidgetType } from "./aiAsk";
import { AiMapDefaultViewSchema } from "./mapView";

/** Curated subset of the web colormap catalogue (cividis/turbo removed: deployed server rejects them). */
export const AI_HEATMAP_RAMPS = [
  "viridis", "inferno", "plasma", "magma", "hot", "jet", "YlOrRd",
  "Blues", "Reds", "Greens", "coolwarm", "Spectral", "RdYlBu",
] as const;

/** D-02: chart types a widget may be swapped between. */
export const AI_CHART_SWAP_TYPES = ["bar", "line", "pie"] as const;

export const AI_NUMERIC_COLUMN_TYPES = [
  "int", "integer", "int8", "int16", "int32", "int64", "long", "float", "double",
  "double precision", "decimal", "numeric", "smallint", "bigint", "real", "number", "tinyint",
] as const;

/** undefined when the type is unknown. */
export function isAiNumericColumnType(t: string | undefined): boolean | undefined {
  if (t === undefined) return undefined;
  const base = t.toLowerCase().replace(/\(.*\)\s*$/, "").trim();
  return (AI_NUMERIC_COLUMN_TYPES as readonly string[]).includes(base);
}

export const AI_TEMPORAL_COLUMN_TYPES = ["timestamp", "date", "time", "datetime"] as const;

/** 142: true for a date/time column type (same set as the web's inferDataTypeFromColumn "datetime"); undefined when unknown. */
export function isAiTemporalColumnType(t: string | undefined): boolean | undefined {
  if (t === undefined) return undefined;
  const base = t.toLowerCase().replace(/\(.*\)\s*$/, "").trim();
  if (base === "") return undefined;
  return (AI_TEMPORAL_COLUMN_TYPES as readonly string[]).includes(base);
}

/**
 * 142: timeline is add-only for the AI, so its keys live here and NOT in the action allow-list (WIDGET_ALLOW_LIST):
 * edit_widget patches on a timeline stay rejected and ALLOW_LIST_VERSION is unchanged (the 139 carve-out precedent).
 * Same vocabulary as the other charts; the web fold translates to the renderer's timeCol + metrics[].
 */
const TIMELINE_FIELDS: Record<string, z.ZodTypeAny> = {
  timeColumn: AiIdentifierSchema,
  metric: AiIdentifierSchema,
  aggregation: z.enum(CHART_AGGREGATIONS),
  color: z.enum(AI_PALETTE_NAMES),
  showLegend: z.boolean(),
  yFieldLabel: z.string().max(80),
};

export const AI_WIDGET_CONFIG: Record<AiWidgetType, { fields: Record<string, z.ZodTypeAny>; required: readonly string[] }> = (() => {
  const f = (t: string) => ({ ...(getWidgetAllowListSchemas(t) ?? {}) });
  const chartReq = ["metric", "aggregation", "groupByColumn"] as const;
  return {
    bar: { fields: f("bar"), required: chartReq },
    line: { fields: f("line"), required: chartReq },
    pie: { fields: f("pie"), required: chartReq },
    table: { fields: f("table"), required: chartReq },
    bignumber: { fields: f("bignumber"), required: ["metric", "aggregation"] },
    records: {
      fields: {
        ...f("records"),
        columns: z.array(AiIdentifierSchema).min(1).max(50),
        sortField: AiIdentifierSchema,
        sortDirection: z.enum(["asc", "desc"]),
      },
      required: [],
    },
    map: { fields: f("map"), required: [] },
    timeline: { fields: { ...TIMELINE_FIELDS }, required: ["timeColumn", "metric", "aggregation"] },
  };
})();

export type AiValidation = { valid: true } | { valid: false; reasons: string[] };

/**
 * 142 UAT: config keys the SERVER stamps onto an AI op after the model is done (never in the model-facing schema).
 * Accepted only when the caller passes allowServerStamped (the web fold of a server answer); the gateway never does,
 * so a model that sends one is rejected like any unknown key.
 */
export const AI_SERVER_STAMPED_CONFIG: Partial<Record<AiWidgetType, Record<string, z.ZodTypeAny>>> = {
  map: { defaultView: AiMapDefaultViewSchema },
};

/** Reasons never contain the rejected value. `tableId` and `dynamicViewId` (D-24) are the ignored binding keys, checked at the gateway. */
export function validateAiWidgetConfig(
  type: string,
  config: Record<string, unknown>,
  opts?: { allowServerStamped?: boolean },
): AiValidation {
  if (!Object.prototype.hasOwnProperty.call(AI_WIDGET_CONFIG, type)) {
    return { valid: false, reasons: [`widget type "${type}" is not supported`] };
  }
  const cat = AI_WIDGET_CONFIG[type as AiWidgetType];
  const reasons: string[] = [];
  const keys = Object.keys(config);
  for (const k of keys) {
    if (k === "dynamicViewId") {
      const v = config[k];
      if (!(typeof v === "number" && Number.isInteger(v) && v !== 0)) reasons.push("invalid value for dynamicViewId");
      continue;
    }
    if (k === "tableId") continue;
    const stamped = opts?.allowServerStamped ? AI_SERVER_STAMPED_CONFIG[type as AiWidgetType] : undefined;
    const schema = Object.prototype.hasOwnProperty.call(cat.fields, k)
      ? cat.fields[k]
      : stamped && Object.prototype.hasOwnProperty.call(stamped, k) ? stamped[k] : undefined;
    if (!schema) {
      reasons.push(`config key "${k}" is not allowed for ${type}`);
      continue;
    }
    if (!schema.safeParse(config[k]).success) reasons.push(`invalid value for ${k}`);
  }
  for (const k of cat.required) {
    if (!keys.includes(k)) reasons.push(`missing required field ${k}`);
  }
  return reasons.length > 0 ? { valid: false, reasons } : { valid: true };
}

export const AI_HEATMAP_PATCH_KEYS = [
  "colormap", "reverseColormap", "blurRadius", "opacity", "valueColumn", "visible", "name",
] as const;

const HEATMAP_FIELDS = {
  colormap: z.enum(AI_HEATMAP_RAMPS),
  reverseColormap: z.boolean(),
  blurRadius: z.number().int().min(1).max(32),
  opacity: z.number().min(0).max(1),
  valueColumn: AiIdentifierSchema,
};
const PATCH_SCHEMAS: Record<string, z.ZodTypeAny> = {
  ...HEATMAP_FIELDS,
  visible: z.boolean(),
  name: z.string().trim().min(1).max(100),
};

export const AiHeatmapStyleSchema = z.object(HEATMAP_FIELDS).partial().strict();

/** D-13: only heatmap layers can be restyled; `visible` is accepted on any layer. */
export function validateAiLayerPatch(patch: Record<string, unknown>, renderMode: string | undefined): AiValidation {
  const reasons: string[] = [];
  for (const k of Object.keys(patch)) {
    const schema = Object.prototype.hasOwnProperty.call(PATCH_SCHEMAS, k) ? PATCH_SCHEMAS[k] : undefined;
    if (!schema) {
      reasons.push(`layer key "${k}" is not allowed`);
      continue;
    }
    if (k !== "visible" && renderMode !== "heatmap") {
      if (!reasons.includes("only heatmap layers can be restyled")) reasons.push("only heatmap layers can be restyled");
      continue;
    }
    if (!schema.safeParse(patch[k]).success) reasons.push(`invalid value for ${k}`);
  }
  return reasons.length > 0 ? { valid: false, reasons } : { valid: true };
}

/** Same rule as MapChartRenderer includedLayers: absent or empty = all dashboard layers. */
export function layersOfMap<L extends { id: number }>(map: { config?: Record<string, unknown> }, layers: readonly L[]): L[] {
  const ids = map.config?.includedLayerIds;
  if (!Array.isArray(ids) || ids.length === 0) return [...layers];
  return layers.filter((l) => (ids as unknown[]).includes(l.id));
}

export type HeatmapHost =
  | { kind: "add_map" }
  | { kind: "use"; widgetId: number }
  | { kind: "ask"; options: { widgetId: number; title: string }[] };

/** D-11/D-12: pick the map that should host a new heatmap layer on `tableId`. */
export function resolveHeatmapHost(input: {
  maps: { id: number; title: string }[];
  layers: { id: number; widgetId: number; tableId?: number }[];
  tableId: number;
}): HeatmapHost {
  const { maps, layers, tableId } = input;
  if (maps.length === 0) return { kind: "add_map" };
  if (maps.length === 1) return { kind: "use", widgetId: maps[0].id };
  const hosting = maps.filter((m) => layers.some((l) => l.widgetId === m.id && l.tableId === tableId));
  if (hosting.length === 1) return { kind: "use", widgetId: hosting[0].id };
  const pool = hosting.length > 1 ? hosting : maps;
  return { kind: "ask", options: pool.map((m) => ({ widgetId: m.id, title: m.title })) };
}
