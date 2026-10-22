import { z } from "zod";
import { AiDvSpecSchema, AI_DV_NAME_MAX } from "./aiDynamicView";
import { AI_WIDGET_TYPES } from "./aiAsk";
import { AI_CHART_SWAP_TYPES } from "./aiCatalog";

/** Keep (141): the single contract for persisting an AI session's folded change set. */
export const AI_KEEP_LIMITS = { widgets: 200, layers: 100, dynamicViews: 50, configKeys: 200, unsetKeys: 50, titleMax: 200 } as const;

const TempId = z.number().int().negative();
const SavedId = z.number().int().positive();
const RefId = z.number().int().refine((n) => n !== 0, "id must be non-zero"); // negative = temp, positive = saved
const Config = z.record(z.unknown()).refine((o) => Object.keys(o).length <= AI_KEEP_LIMITS.configKeys, "too many config keys");

export const AiKeepRectSchema = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).strict();
export const AiKeepDvAddSchema = z.object({ tempId: TempId, name: z.string().trim().min(1).max(AI_DV_NAME_MAX), spec: AiDvSpecSchema }).strict();
export const AiKeepLayerAddSchema = z.object({ tempId: TempId, tableId: SavedId, config: Config, dynamicViewId: RefId.nullable().optional() }).strict();
export const AiKeepLayerEditSchema = z
  .object({
    id: SavedId,
    configSet: Config.optional(),
    tableId: SavedId.optional(),
    dynamicViewId: RefId.nullable().optional(),
    cb_config: z.string().max(20000).nullable().optional(),
    track_config: z.string().max(20000).nullable().optional(),
  })
  .strict();
export const AiKeepWidgetAddSchema = z
  .object({ tempId: TempId, type: z.enum(AI_WIDGET_TYPES), title: z.string().min(1).max(AI_KEEP_LIMITS.titleMax), config: Config, rect: AiKeepRectSchema })
  .strict();
export const AiKeepWidgetEditSchema = z
  .object({
    id: SavedId,
    title: z.string().min(1).max(AI_KEEP_LIMITS.titleMax).optional(),
    type: z.enum(AI_CHART_SWAP_TYPES).optional(),
    configSet: Config.optional(),
    configUnset: z.array(z.string().min(1).max(100)).max(AI_KEEP_LIMITS.unsetKeys).optional(),
    rect: AiKeepRectSchema.optional(),
  })
  .strict();

export const AiKeepRequestSchema = z
  .object({
    baselineVersion: z.number().int().min(0),
    dynamicViews: z.object({ add: z.array(AiKeepDvAddSchema).max(AI_KEEP_LIMITS.dynamicViews), remove: z.array(SavedId).max(AI_KEEP_LIMITS.dynamicViews) }).strict(),
    layers: z
      .object({
        add: z.array(AiKeepLayerAddSchema).max(AI_KEEP_LIMITS.layers),
        edit: z.array(AiKeepLayerEditSchema).max(AI_KEEP_LIMITS.layers),
        remove: z.array(SavedId).max(AI_KEEP_LIMITS.layers),
      })
      .strict(),
    widgets: z
      .object({
        add: z.array(AiKeepWidgetAddSchema).max(AI_KEEP_LIMITS.widgets),
        edit: z.array(AiKeepWidgetEditSchema).max(AI_KEEP_LIMITS.widgets),
        remove: z.array(SavedId).max(AI_KEEP_LIMITS.widgets),
      })
      .strict(),
  })
  .strict()
  .superRefine((req, ctx) => {
    const dup = (ids: number[]): number | null => {
      const seen = new Set<number>();
      for (const i of ids) {
        if (seen.has(i)) return i;
        seen.add(i);
      }
      return null;
    };
    const issue = (path: (string | number)[], msg: string, id: number) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `${msg}: ${id}` });
    const dvTemp = dup(req.dynamicViews.add.map((a) => a.tempId));
    if (dvTemp !== null) issue(["dynamicViews", "add"], "duplicate tempId", dvTemp);
    const dvRem = dup(req.dynamicViews.remove);
    if (dvRem !== null) issue(["dynamicViews", "remove"], "duplicate id", dvRem);
    for (const kind of ["layers", "widgets"] as const) {
      const g = req[kind] as { add: { tempId: number }[]; edit: { id: number }[]; remove: number[] };
      const t = dup(g.add.map((a) => a.tempId));
      if (t !== null) issue([kind, "add"], "duplicate tempId", t);
      const e = dup(g.edit.map((a) => a.id));
      if (e !== null) issue([kind, "edit"], "duplicate id", e);
      const r = dup(g.remove);
      if (r !== null) issue([kind, "remove"], "duplicate id", r);
      const removed = new Set(g.remove);
      for (const ed of g.edit) if (removed.has(ed.id)) issue([kind, "edit"], "id both edited and removed", ed.id);
    }
  });

export type AiKeepRequest = z.infer<typeof AiKeepRequestSchema>;
export type AiKeepIdMap = { widgets: Record<string, number>; layers: Record<string, number>; dynamicViews: Record<string, number> }; // key = String(tempId)
export type AiKeepResponse = { idMap: AiKeepIdMap; version: number; warnings: string[] };

export const AI_KEEP_ERROR_CODES = { conflict: "AI_KEEP_CONFLICT", permission: "AI_KEEP_PERMISSION", invalid: "AI_KEEP_INVALID", failed: "AI_KEEP_FAILED" } as const;
export const KEEP_CONFLICT_MESSAGE = "Someone else changed this dashboard since you started. Your AI changes weren't saved.";
export const KEEP_FAILED_MESSAGE = "Couldn't save the AI changes. Nothing was saved; try again.";
export const KEEP_RIGHTS_ORDER = ["dynamic_views:manage", "layers:manage", "widgets:configure"] as const;
export type KeepRight = (typeof KEEP_RIGHTS_ORDER)[number];
export const KEEP_PERMISSION_LABELS: Record<KeepRight, { noun: string; label: string }> = {
  "dynamic_views:manage": { noun: "dynamic views", label: "Manage dynamic views" },
  "layers:manage": { noun: "layer changes", label: "Manage layers" },
  "widgets:configure": { noun: "widget changes", label: "Configure widgets" },
};
export function keepPermissionMessage(p: KeepRight): string {
  const l = KEEP_PERMISSION_LABELS[p];
  return `You can't save these changes: saving ${l.noun} needs the ${l.label} permission.`;
}
