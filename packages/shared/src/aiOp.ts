// Phase 133: minimal AI op contract. Payloads are .strict() so later phases (136/138/139) extend them deliberately. No raw SQL field exists or may be added (AISAFE-V20-04).
import { z } from "zod";
import { TARGET_KINDS } from "./widgetAction";
import { AiIdentifierSchema } from "./actionAllowList";
import { AiFilterSourceSchema, AiFilterItemSchema, checkAiFilterItem } from "./aiFilter";
import { AI_CHART_SWAP_TYPES, AiHeatmapStyleSchema } from "./aiCatalog";

export const AI_OP_KINDS = [
  "patch",
  "add_widget",
  "remove_widget",
  "add_layer",
  "remove_layer",
  "add_dynamic_view",
  "remove_dynamic_view",
  "apply_filter",
  "clear_filter",
  "set_layout",
  "change_widget_type",
  "set_widget_title",
] as const;
export type AiOpKind = (typeof AI_OP_KINDS)[number];

/** AI-created entities get negative temp ids until Keep assigns real ones. */
export const AiTempIdSchema = z.number().int().negative();
/** Reference id: positive = saved entity, negative = AI temp id. Never 0. */
export const AiRefIdSchema = z
  .number()
  .int()
  .refine((n) => n !== 0, { message: "id must be non-zero (positive = saved, negative = AI temp id)" });

/** Grid rect (36-col grid; mirrors layout.ts bounds). */
export const AiLayoutRectSchema = z
  .object({
    x: z.number().int().min(0).max(36),
    y: z.number().int().min(0).max(10000),
    w: z.number().int().min(6).max(36),
    h: z.number().int().min(6).max(200),
  })
  .strict();

export const AiActionTargetSchema = z
  .object({ kind: z.enum(TARGET_KINDS), id: AiRefIdSchema })
  .strict();
export const AiPatchActionSchema = z
  .object({ target: AiActionTargetSchema, configPatch: z.record(z.unknown()) })
  .strict();

export const AiOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("patch"), action: AiPatchActionSchema }).strict(),
  z
    .object({
      op: z.literal("add_widget"),
      tempId: AiTempIdSchema,
      type: z.string().min(1),
      title: z.string().max(200),
      config: z.record(z.unknown()),
      // the gateway stamps this; the catalogue rejects config.layout
      layout: AiLayoutRectSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove_widget"), id: AiRefIdSchema }).strict(),
  z
    .object({
      op: z.literal("add_layer"),
      tempId: AiTempIdSchema,
      widgetId: AiRefIdSchema,
      tableId: z.number().int().positive(),
      renderMode: z.literal("heatmap"),
      spatialMode: z.enum(["latlon", "wkt", "wkb"]),
      latColumn: AiIdentifierSchema.optional(),
      lonColumn: AiIdentifierSchema.optional(),
      wktColumn: AiIdentifierSchema.optional(),
      wkbColumn: AiIdentifierSchema.optional(),
      name: z.string().trim().min(1).max(100).optional(),
      style: AiHeatmapStyleSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove_layer"), id: AiRefIdSchema }).strict(),
  // structured spec added in Phase 139
  z.object({ op: z.literal("add_dynamic_view"), tempId: AiTempIdSchema }).strict(),
  z.object({ op: z.literal("remove_dynamic_view"), id: AiRefIdSchema }).strict(),
  // Phase 138: source-keyed filters (D-01). A table filter narrows every widget/layer on that table, like a click.
  z.object({ op: z.literal("apply_filter"), source: AiFilterSourceSchema, filters: z.array(AiFilterItemSchema).min(1).max(10) }).strict(),
  // no source = clear every column filter on the dashboard (D-07); source only = that source; source + column = one column
  z.object({ op: z.literal("clear_filter"), source: AiFilterSourceSchema.optional(), column: AiIdentifierSchema.optional() }).strict(),
  z
    .object({
      op: z.literal("set_layout"),
      items: z.array(AiLayoutRectSchema.extend({ id: AiRefIdSchema }).strict()).min(1).max(30),
    })
    .strict(),
  z.object({ op: z.literal("change_widget_type"), id: AiRefIdSchema, type: z.enum(AI_CHART_SWAP_TYPES) }).strict(),
  z.object({ op: z.literal("set_widget_title"), id: AiRefIdSchema, title: z.string().trim().min(1).max(200) }).strict(),
]);
export type AiOp = z.infer<typeof AiOpSchema>;

export function parseAiOp(raw: unknown): { ok: true; op: AiOp } | { ok: false; errors: string[] } {
  const r = AiOpSchema.safeParse(raw);
  if (r.success) {
    const op = r.data;
    if (op.op === "add_layer") {
      const need =
        op.spatialMode === "latlon" ? (["latColumn", "lonColumn"] as const)
        : op.spatialMode === "wkt" ? (["wktColumn"] as const)
        : (["wkbColumn"] as const);
      const errors = need.filter((c) => op[c] === undefined).map((c) => `${c} is required for spatialMode ${op.spatialMode}`);
      if (errors.length > 0) return { ok: false, errors };
    }
    if (op.op === "apply_filter") {
      const errors: string[] = [];
      const seen = new Set<string>();
      op.filters.forEach((f, i) => {
        for (const e of checkAiFilterItem(f)) errors.push(`filters.${i}.value: ${e}`);
        if (seen.has(f.column)) errors.push(`filters: column ${f.column} appears twice`);
        seen.add(f.column);
      });
      if (errors.length > 0) return { ok: false, errors };
    }
    if (op.op === "clear_filter" && op.column !== undefined && op.source === undefined) {
      return { ok: false, errors: ["column: column needs a source"] };
    }
    return { ok: true, op };
  }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
