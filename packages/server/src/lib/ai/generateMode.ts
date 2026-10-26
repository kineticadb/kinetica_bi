// Phase 142 generate mode: pure helpers (recipe text, limits, nudge, deterministic band layout rewrite). No I/O.
import type { AiOp } from "@kinetica-bi/shared";
import { placeGenerateBands } from "@kinetica-bi/shared";
import type { AiDataAccess } from "../aiConfig";

export const GEN_MIN_STEPS = 20;
export const GEN_MIN_WIDGETS = 4;
export const GEN_MAX_WIDGETS = 8;
export const GENERATE_TOO_FEW_MESSAGE = "Couldn't build a starter dashboard from this table. Try again, or ask for specific charts.";

export function generateLimits(c: { maxToolSteps: number; maxNewWidgets: number }): { maxToolSteps: number; maxNewWidgets: number } {
  return { maxToolSteps: Math.min(50, Math.max(c.maxToolSteps, GEN_MIN_STEPS)), maxNewWidgets: GEN_MAX_WIDGETS };
}

export function buildGenerateRecipe(dataAccess: AiDataAccess): string {
  const lines = [
    "- Generate mode: this dashboard was just created from the table listed above and has no charts yet. Build a starter dashboard in this answer.",
    "- Add between 4 and 8 widgets with add_widget, all on that table, following this recipe and skipping any slot that does not fit its columns:",
    "  1. One to three KPIs (type bignumber), for example a row count and the sum or average of key numeric columns.",
    "  2. One time trend (type timeline) if there is a date or timestamp column, with timeColumn set to that column; not a line chart, which groups by raw values.",
    "  3. One or two breakdowns (type bar or pie) by low-cardinality text columns; avoid ids and free text.",
    "  4. One map (type map) and one heatmap layer on it (add_layer) if the table has a geometry column or latitude and longitude columns.",
    "  5. One records table (type records).",
    "- If the user's message names a focus, follow it when choosing columns; still fill the other slots so there are at least 4 widgets.",
    "- Do not call set_layout: the server arranges the widgets. Never add or change the AI Assistant widget.",
    "- Call add_widget several times in one turn where you can. When the widgets are added, reply in two or three sentences describing what you built.",
    dataAccess === "query"
      ? "- You may call get_column_profile to check how many distinct values a column has before choosing breakdown columns."
      : "- Choose columns from their column names and types only.",
  ];
  return lines.join("\n");
}

export function generateNudge(added: number): string {
  return `Only ${added} ${added === 1 ? "widget was" : "widgets were"} added. A starter dashboard needs at least ${GEN_MIN_WIDGETS}: add more widgets from the recipe now, then reply.`;
}

export function countDataWidgetAdds(ops: readonly AiOp[]): number {
  return ops.filter((o) => o.op === "add_widget").length;
}

export function applyGenerateBands(ops: readonly AiOp[]): AiOp[] {
  const adds = ops.filter((o): o is Extract<AiOp, { op: "add_widget" }> => o.op === "add_widget");
  const rects = placeGenerateBands(adds.map((o) => ({ key: o.tempId, type: o.type })));
  const out: AiOp[] = [];
  for (const o of ops) {
    if (o.op === "set_layout") continue;
    if (o.op === "add_widget") out.push({ ...o, layout: { ...rects[o.tempId] } });
    else out.push(o);
  }
  return out;
}
