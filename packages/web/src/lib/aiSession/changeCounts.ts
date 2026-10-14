// 137 (D-15/D-19/D-18): pure change counts for the AI bar and the set of widgets changed by an answer.
import { layersOfMap } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { SessionDerived, TurnEntry } from "./types";

export type AiChangeCounts = { added: number; edited: number; removed: number; removedNames: string[] };

/**
 * Each change is counted ONCE: a layer change counts as the layer, never also as its host map
 * (host maps live in a separate set in 137-07 that this function must not read).
 */
export function computeChangeCounts(
  derived: SessionDerived,
  saved: { widgets: readonly WidgetDto[]; layers: readonly DashboardLayerDto[] },
): AiChangeCounts {
  const removedNames: string[] = [];
  for (const id of derived.removedWidgetIds) {
    const w = saved.widgets.find((x) => x.id === id);
    if (w) removedNames.push(w.title);
  }
  for (const id of derived.removedLayerIds) {
    const l = saved.layers.find((x) => x.id === id);
    const cfg = (l?.config ?? {}) as { name?: unknown; title?: unknown };
    const name =
      typeof cfg.name === "string" && cfg.name.trim()
        ? cfg.name.trim()
        : typeof cfg.title === "string" && cfg.title.trim()
          ? cfg.title.trim()
          : `Layer ${id}`;
    removedNames.push(name);
  }
  return {
    added: derived.addedWidgets.length + derived.addedLayers.length,
    edited: derived.aiEditedWidgetIds.size + derived.aiEditedLayerIds.size,
    removed: derived.removedWidgetIds.size + derived.removedLayerIds.size,
    removedNames,
  };
}

/**
 * Widget ids changed by the applied entries of one answer (D-18 fading outline). A layer change
 * resolves to the map(s) hosting it via layersOfMap. `ctx.widgets` must carry the EFFECTIVE
 * `config.includedLayerIds` (saved list overridden by the session contribution) and `ctx.layers`
 * must include saved layers (even removed ones) plus every temp layer that existed before OR
 * after the answer, otherwise an AI-added layer's host map is missed.
 */
export function changedWidgetIds(
  entries: readonly TurnEntry[],
  ctx: { widgets: readonly WidgetDto[]; layers: readonly { id: number }[] },
): number[] {
  const out = new Set<number>();
  const maps = ctx.widgets.filter((w) => w.type === "map");
  const hostsOf = (layerId: number) => {
    for (const m of maps) {
      if (layersOfMap(m, ctx.layers).some((l) => l.id === layerId)) out.add(m.id);
    }
  };
  for (const e of entries) {
    if (e.result.status !== "applied" || !e.op) continue;
    const op = e.op;
    switch (op.op) {
      case "add_widget":
        out.add(op.tempId);
        break;
      case "patch": {
        const t = op.action.target;
        if (t.kind === "widget") out.add(t.id);
        else if (t.kind === "layer") hostsOf(t.id);
        break;
      }
      case "add_layer":
        out.add(op.widgetId);
        break;
      case "remove_layer":
        hostsOf(op.id);
        break;
      case "set_layout":
        for (const i of op.items) out.add(i.id);
        break;
      case "set_widget_title":
      case "change_widget_type":
        out.add(op.id);
        break;
      default:
        break;
    }
  }
  return [...out];
}
