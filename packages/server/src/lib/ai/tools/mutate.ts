// Phase 135 validate-only mutate tools: each emits a raw AiOp candidate; the gateway validates it.
// add_layer / add_dynamic_view / apply_filter / clear_filter are deliberately not exposed in 135.
import { z } from "zod/v4";
import { AI_WIDGET_TYPES } from "@kinetica-bi/shared";
import type { MutateTool } from "./types";

const addWidgetArgs = z.object({
  tempId: z.number().int().negative(),
  type: z.enum(AI_WIDGET_TYPES),
  title: z.string().max(200),
  tableId: z.number().int().positive(),
  config: z.record(z.string(), z.unknown()),
});
const patchArgs = z.object({
  targetKind: z.enum(["widget", "layer", "dynamicView"]),
  targetId: z.number().int(),
  changes: z.record(z.string(), z.unknown()),
});
const idArgs = z.object({ id: z.number().int() });

const addWidget: MutateTool = {
  kind: "mutate",
  name: "add_widget",
  description: "Add a widget. Use a new negative tempId (-1, -2, ...). tableId comes from list_tables; column names in config must come from describe_table.",
  args: addWidgetArgs,
  toOp(args) {
    const a = addWidgetArgs.parse(args);
    return { op: "add_widget", tempId: a.tempId, type: a.type, title: a.title, config: { ...a.config, tableId: a.tableId } };
  },
};
const patch: MutateTool = {
  kind: "mutate",
  name: "patch",
  description: "Change settings of an existing widget, layer or dynamic view. targetId comes from get_dashboard; changes holds only the settings to change.",
  args: patchArgs,
  toOp(args) {
    const a = patchArgs.parse(args);
    return { op: "patch", action: { target: { kind: a.targetKind, id: a.targetId }, configPatch: a.changes } };
  },
};
const remover = (op: "remove_widget" | "remove_layer" | "remove_dynamic_view", what: string): MutateTool => ({
  kind: "mutate",
  name: op,
  description: `Remove a ${what} by id (from get_dashboard).`,
  args: idArgs,
  toOp(args) {
    return { op, id: idArgs.parse(args).id };
  },
});

export const MUTATE_TOOLS: readonly MutateTool[] = [
  addWidget,
  patch,
  remover("remove_widget", "widget"),
  remover("remove_layer", "layer"),
  remover("remove_dynamic_view", "dynamic view"),
];
