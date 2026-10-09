// Phase 133: minimal AI op contract. Payloads are .strict() so later phases (136/138/139) extend them deliberately. No raw SQL field exists or may be added (AISAFE-V20-04).
import { z } from "zod";
import { TARGET_KINDS } from "./widgetAction";

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
] as const;
export type AiOpKind = (typeof AI_OP_KINDS)[number];

/** AI-created entities get negative temp ids until Keep assigns real ones. */
export const AiTempIdSchema = z.number().int().negative();
/** Reference id: positive = saved entity, negative = AI temp id. Never 0. */
export const AiRefIdSchema = z
  .number()
  .int()
  .refine((n) => n !== 0, { message: "id must be non-zero (positive = saved, negative = AI temp id)" });

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
    })
    .strict(),
  z.object({ op: z.literal("remove_widget"), id: AiRefIdSchema }).strict(),
  // payload extended in Phase 136
  z.object({ op: z.literal("add_layer"), tempId: AiTempIdSchema, widgetId: AiRefIdSchema }).strict(),
  z.object({ op: z.literal("remove_layer"), id: AiRefIdSchema }).strict(),
  // structured spec added in Phase 139
  z.object({ op: z.literal("add_dynamic_view"), tempId: AiTempIdSchema }).strict(),
  z.object({ op: z.literal("remove_dynamic_view"), id: AiRefIdSchema }).strict(),
  // filter payload added in Phase 138
  z.object({ op: z.literal("apply_filter"), widgetId: AiRefIdSchema }).strict(),
  z.object({ op: z.literal("clear_filter"), widgetId: AiRefIdSchema.optional() }).strict(),
]);
export type AiOp = z.infer<typeof AiOpSchema>;

export function parseAiOp(raw: unknown): { ok: true; op: AiOp } | { ok: false; errors: string[] } {
  const r = AiOpSchema.safeParse(raw);
  if (r.success) return { ok: true, op: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
