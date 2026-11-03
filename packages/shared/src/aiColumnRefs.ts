// Phase 139: ONE list of config keys renderers read as column names (moved from server gateway.ts), plus the D-17 planner.
export const AI_COLUMN_BINDING_KEYS = ["metric", "metricColumn", "groupByColumn", "groupByColumns"] as const;
/** Widget types whose SQL is regenerated from structured fields, so a repoint to the base table is safe. */
export const AI_REPOINTABLE_WIDGET_TYPES = ["bar", "line", "pie", "table", "bignumber", "records"] as const;

function pushNames(out: string[], v: unknown): void {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  for (const it of items) {
    if (typeof it !== "string") continue;
    const t = it.trim();
    if (t !== "") out.push(t);
  }
}
const dedupe = (xs: string[]): string[] => [...new Set(xs)];

export function aiWidgetColumnRefs(cfg: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const k of AI_COLUMN_BINDING_KEYS) {
    const v = cfg[k];
    if (typeof v === "string" || Array.isArray(v)) {
      // binding keys hold single names; do not comma-split them
      if (typeof v === "string") { if (v.trim() !== "") out.push(v.trim()); } else pushNames(out, v.filter((x) => typeof x === "string"));
    }
  }
  pushNames(out, cfg.columns);
  if (typeof cfg.sortField === "string" && cfg.sortField.trim() !== "") out.push(cfg.sortField.trim());
  // 142 timeline: model-facing timeColumn; renderer config timeCol + metrics[].column
  for (const k of ["timeColumn", "timeCol"]) {
    const v = cfg[k];
    if (typeof v === "string" && v.trim() !== "") out.push(v.trim());
  }
  if (Array.isArray(cfg.metrics)) {
    for (const m of cfg.metrics) {
      const c = typeof m === "object" && m !== null ? (m as { column?: unknown }).column : undefined;
      if (typeof c === "string" && c.trim() !== "") out.push(c.trim());
    }
  }
  return dedupe(out);
}

export function aiLayerColumnRefs(cfg: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const k of ["latColumn", "lonColumn", "wktColumn", "wkbColumn", "valueColumn"]) {
    const v = cfg[k];
    if (typeof v === "string" && v.trim() !== "") out.push(v.trim());
  }
  return dedupe(out);
}

export type DvDependent = { id: number; type?: string; refs: readonly string[] };
export type DvDependentsPlan = { repoint: { widgetIds: number[]; layerIds: number[] }; drop: { widgetIds: number[]; layerIds: number[] } };

/** D-17: repoint when EVERY referenced column exists on the view's base table (and, for widgets, the type regenerates SQL); otherwise drop. Column names only, never values. */
export function planDvDependents(input: {
  widgets: readonly DvDependent[];
  layers: readonly DvDependent[];
  baseColumns: readonly string[];
}): DvDependentsPlan {
  const base = new Set(input.baseColumns);
  const fits = (d: DvDependent) => d.refs.every((r) => base.has(r));
  const plan: DvDependentsPlan = { repoint: { widgetIds: [], layerIds: [] }, drop: { widgetIds: [], layerIds: [] } };
  for (const w of input.widgets) {
    const ok = (AI_REPOINTABLE_WIDGET_TYPES as readonly string[]).includes(w.type ?? "") && fits(w);
    (ok ? plan.repoint : plan.drop).widgetIds.push(w.id);
  }
  for (const l of input.layers) (fits(l) ? plan.repoint : plan.drop).layerIds.push(l.id);
  return plan;
}
