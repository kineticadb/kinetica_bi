// 150: dimmed previews of a pending proposal's new charts and layers. A scratch fold OUTSIDE derived: never counted, saved, materialized or sent in a snapshot.
import { aiOpDependencies, closeSelection, parseAiOp } from "@kinetica-bi/shared";
import { evaluateTurn, foldSession } from "./foldSession";
import type { ProposalGhosts, SessionBaseline, TurnEntry } from "./types";

export const GHOST_LAYER_OPACITY_FACTOR = 0.4;

const opKind = (raw: unknown): string | null => {
  const p = parseAiOp(raw);
  return p.ok ? p.op.op : null;
};

export function buildProposalGhosts(input: {
  baseline: SessionBaseline;
  priorEntries: readonly TurnEntry[];
  ops: readonly unknown[];
  ticked: readonly number[];
  removalApproved: boolean;
}): ProposalGhosts | null {
  const { baseline, priorEntries, ops, ticked, removalApproved } = input;
  const deps = aiOpDependencies(ops);
  const kinds = ops.map(opKind);
  // A chart that needs a view added by this same answer cannot be previewed: the view is not materialized.
  const candidates = ticked.filter((i) => {
    if (kinds[i] !== "add_widget" && kinds[i] !== "add_layer") return false;
    return !closeSelection([i], deps).some((j) => j !== i && kinds[j] === "add_dynamic_view");
  });
  if (candidates.length === 0) return null;
  const ok = new Set(candidates);
  const eligible = candidates
    .filter((i) => closeSelection([i], deps).every((j) => j === i || kinds[j] !== "add_widget" || ok.has(j)))
    .sort((a, b) => a - b);
  if (eligible.length === 0) return null;
  const eligibleOps = eligible.map((i) => ops[i]);
  const entries = evaluateTurn(baseline, priorEntries, eligibleOps, { removalApproved });
  const d = foldSession(baseline, [...priorEntries, ...entries]);

  const widgetIds = new Set<number>();
  const layerIds = new Set<number>();
  const layerHosts: Record<number, number> = {};
  for (const e of entries) {
    if (e.result.status !== "applied" || !e.op) continue;
    if (e.op.op === "add_widget") widgetIds.add(e.op.tempId);
    else if (e.op.op === "add_layer") {
      layerIds.add(e.op.tempId);
      layerHosts[e.op.tempId] = e.op.widgetId;
    }
  }
  const widgets = d.addedWidgets.filter((w) => widgetIds.has(w.id));
  const rects: ProposalGhosts["rects"] = {};
  for (const w of widgets) {
    const g = d.layout[w.id];
    const c = w.config?.layout as Partial<{ x: number; y: number; w: number; h: number }> | undefined;
    if (g) rects[w.id] = { x: g.x, y: g.y, w: g.w, h: g.h };
    else if (c && [c.x, c.y, c.w, c.h].every((n) => typeof n === "number")) rects[w.id] = { x: c.x!, y: c.y!, w: c.w!, h: c.h! };
  }
  const layers = d.addedLayers
    .filter((l) => layerIds.has(l.id))
    .map((l) => ({
      ...l,
      config: { ...l.config, POINTOPACITY: Math.round(((l.config?.POINTOPACITY as number | undefined) ?? 100) * GHOST_LAYER_OPACITY_FACTOR) },
    }));
  if (widgets.length === 0 && layers.length === 0) return null;
  return { widgets, rects, layers, layerHosts };
}
