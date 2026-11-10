// 150: future-tense wording of a pending AI proposal (client-side; values stay out of Turn.answer and the audit). Plain text only.
import type { AskRequest } from "@kinetica-bi/shared";
import { buildChipText, type DrillDownDataType } from "../columnTypes";
import type { SessionBaseline } from "./types";

export const PROPOSAL_COPY = {
  switchLabel: "Approve changes first",
  marker: "Proposed",
  listLabel: "Proposed changes",
  apply: "Apply changes",
  reject: "Reject",
  askDisabled: "Apply or reject the proposed changes first.",
  tileLine: "Changes proposed — review",
  rejected: "You rejected these changes. Nothing was changed.",
  expired: "This proposal expired. Ask again.",
  allFailed: "None of the ticked changes can be applied now. Untick them or reject.",
  leftUnticked: (label: string) => `Left unticked: ${label}`,
  notApplied: (label: string, reasons: readonly string[]) => (reasons.length ? `Not applied: ${label} (${reasons.join("; ")})` : `Not applied: ${label}`),
  leaveTitle: "Proposed changes are waiting",
  leaveBody: "Leaving will drop the proposed changes; they will be recorded as not decided.",
} as const;

export type ProposalNames = {
  widgets: Record<number, { title: string; type?: string }>;
  layers: Record<number, string>;
  views: Record<number, string>;
  tables: Record<number, string>;
};

/** Names for ids the proposal may mention: the effective snapshot (cursor state) plus baseline table / view names. */
export function proposalNamesFrom(snapshot: AskRequest["snapshot"], baseline: SessionBaseline): ProposalNames {
  const names: ProposalNames = { widgets: {}, layers: {}, views: {}, tables: {} };
  for (const t of baseline.tables ?? []) names.tables[t.id] = t.name;
  for (const [id, n] of Object.entries(baseline.dynamicViewNames ?? {})) names.views[Number(id)] = n;
  for (const w of snapshot?.widgets ?? []) names.widgets[w.id] = { title: w.title, type: w.type };
  for (const l of snapshot?.layers ?? []) if (l.title) names.layers[l.id] = l.title;
  for (const v of snapshot?.dynamicViews ?? []) names.views[v.id] = v.name;
  return names;
}

type Loose = Record<string, unknown>;
const isObj = (x: unknown): x is Loose => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function filterChip(f: unknown): string | null {
  if (!isObj(f)) return null;
  const column = str(f.column);
  if (!column) return null;
  const dataType = (str(f.dataType) as DrillDownDataType | null) ?? (typeof f.value === "number" ? "number" : "string");
  const operator = f.operator === "in" || f.operator === "between" || f.operator === "isNull" ? f.operator : "eq";
  return buildChipText(column, f.value, dataType, operator);
}

/** One future-tense line per op, same order and length. Temp ids of earlier ops in the same proposal resolve to their names. */
export function describeProposal(ops: readonly unknown[], names: ProposalNames): string[] {
  const widgets = { ...names.widgets };
  const layers = { ...names.layers };
  const views = { ...names.views };
  // a known name renders quoted; an unknown id falls back to a bare "widget 99"
  const wref = (id: number | null) => (id !== null && widgets[id] ? `"${widgets[id].title}"` : `widget ${id}`);
  const lref = (id: number | null) => (id !== null && layers[id] ? `"${layers[id]}"` : `layer ${id}`);
  const vref = (id: number | null) => (id !== null && views[id] ? `"${views[id]}"` : `view ${id}`);
  return ops.map((raw): string => {
    if (!isObj(raw)) return "Will make a change";
    switch (raw.op) {
      case "add_widget": {
        const title = str(raw.title);
        const type = str(raw.type);
        const tempId = num(raw.tempId);
        if (tempId !== null && title !== null) widgets[tempId] = { title, type: type ?? undefined };
        if (!type || title === null) return "Will make a change";
        return `Will add ${type} "${title}"`;
      }
      case "add_layer": {
        const name = str(raw.name);
        const tempId = num(raw.tempId);
        if (tempId !== null) layers[tempId] = name ?? "heatmap layer";
        return name ? `Will add heatmap layer "${name}"` : `Will add a heatmap layer to ${wref(num(raw.widgetId))}`;
      }
      case "add_dynamic_view": {
        const name = str(raw.name);
        const tempId = num(raw.tempId);
        if (tempId !== null && name) views[tempId] = name;
        return name ? `Will create view "${name}"` : "Will make a change";
      }
      case "apply_filter": {
        const chips = (Array.isArray(raw.filters) ? raw.filters : []).map(filterChip).filter((c): c is string => c !== null);
        return chips.length ? `Will filter to ${chips.join(", ")}` : "Will make a change";
      }
      case "clear_filter": {
        const column = str(raw.column);
        const source = isObj(raw.source) ? raw.source : null;
        if (source && column) return `Will clear the ${column} filter`;
        if (source) {
          const id = num(source.id);
          const n = source.kind === "table" && id !== null ? names.tables[id] : id !== null ? views[id] : undefined;
          return `Will clear the filters on ${n ?? "this source"}`;
        }
        return "Will clear all filters";
      }
      case "set_widget_title": {
        const id = num(raw.id);
        const title = str(raw.title);
        if (!title) return "Will make a change";
        // later lines keep naming the widget as it is on the dashboard now (the pre-rename title)
        return `Will rename ${wref(id)} to "${title}"`;
      }
      case "change_widget_type":
        return str(raw.type) ? `Will change ${wref(num(raw.id))} to ${raw.type}` : "Will make a change";
      case "remove_widget":
        return `Will remove ${wref(num(raw.id))}`;
      case "remove_layer": {
        const id = num(raw.id);
        return id !== null && layers[id] ? `Will remove layer ${lref(id)}` : `Will remove ${lref(id)}`;
      }
      case "remove_dynamic_view": {
        const id = num(raw.id);
        return id !== null && views[id] ? `Will remove view ${vref(id)}` : `Will remove ${vref(id)}`;
      }
      case "patch": {
        const target = isObj(raw.action) && isObj(raw.action.target) ? raw.action.target : null;
        const id = target ? num(target.id) : null;
        if (!target || id === null) return "Will make a change";
        if (target.kind === "layer") return `Will edit ${lref(id)}`;
        return `Will edit ${wref(id)}`;
      }
      case "set_layout": {
        const n = Array.isArray(raw.items) ? raw.items.length : 0;
        return n > 0 ? `Will rearrange ${n} widget${n === 1 ? "" : "s"}` : "Will make a change";
      }
      default:
        return "Will make a change";
    }
  });
}
