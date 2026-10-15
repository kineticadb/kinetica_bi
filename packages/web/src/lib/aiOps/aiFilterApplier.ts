// 138: the ONLY place the AI writes filterStore. Calls exactly the actions a click/chip calls, so the orchestrator,
// charts, records and map tiles follow the same path (AIACT-V20-09). Lives outside the action engine (ACTION-ENGINE-NO-FILTER).
import type { AiOp, AiFilterItem } from "@kinetica-bi/shared";
import { aiFilterSourceKey } from "@kinetica-bi/shared";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import type { FilterDelta, FilterSourceRef, CurrentFilterColumns } from "../aiSession/types";

export function aiFilterKey(f: ActiveFilter | null): string {
  return f ? `${f.column}|${f.operator ?? "eq"}|${JSON.stringify(f.value)}` : "∅";
}

function listFor(source: FilterSourceRef): ActiveFilter[] {
  const s = useFilterStore.getState();
  return (source.kind === "table" ? s.filters[source.id] : s.dvFilters[source.id]) ?? [];
}

export function currentFilter(source: FilterSourceRef, column: string): ActiveFilter | null {
  return listFor(source).find((f) => f.column === column) ?? null;
}

export function currentFilterColumns(): CurrentFilterColumns {
  const s = useFilterStore.getState();
  const out: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(s.filters)) {
    if (list.length > 0) out[aiFilterSourceKey({ kind: "table", id: Number(id) })] = list.map((f) => f.column);
  }
  for (const [id, list] of Object.entries(s.dvFilters)) {
    if (list.length > 0) out[aiFilterSourceKey({ kind: "dynamicView", id: Number(id) })] = list.map((f) => f.column);
  }
  return out;
}

export function toActiveFilter(item: AiFilterItem, now = Date.now()): ActiveFilter {
  const isNull = item.operator === "isNull";
  const v = item.value;
  const dataType: ActiveFilter["dataType"] =
    item.dataType ?? (isNull ? "null" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string");
  const base = { column: item.column, value: (isNull ? null : v) as ActiveFilter["value"], dataType };
  const withOp = item.operator === "in" || item.operator === "between" ? { ...base, operator: item.operator } : base;
  return { ...withOp, addedAt: now, aiApplied: true };
}

function set(source: FilterSourceRef, column: string, f: ActiveFilter | null): void {
  const s = useFilterStore.getState();
  if (f) {
    if (source.kind === "table") s.addFilter(source.id, f);
    else s.addDvFilter(source.id, f);
  } else if (source.kind === "table") s.removeFilter(source.id, column);
  else s.removeDvFilter(source.id, column);
}

export function executeFilterOp(op: AiOp): FilterDelta[] {
  const deltas: FilterDelta[] = [];
  if (op.op === "apply_filter") {
    for (const item of op.filters) {
      const next = toActiveFilter(item);
      const before = currentFilter(op.source, item.column);
      if (aiFilterKey(before) === aiFilterKey(next)) continue;
      set(op.source, item.column, next);
      const after = currentFilter(op.source, item.column);
      if (aiFilterKey(after) !== aiFilterKey(next)) continue; // store refused (cap): nothing to record
      deltas.push({ source: op.source, column: item.column, before, after });
    }
    return deltas;
  }
  if (op.op === "clear_filter") {
    const targets: { source: FilterSourceRef; column: string }[] = [];
    if (op.source && op.column) {
      targets.push({ source: op.source, column: op.column });
    } else if (op.source) {
      for (const f of listFor(op.source)) targets.push({ source: op.source, column: f.column });
    } else {
      const s = useFilterStore.getState();
      for (const [id, list] of Object.entries(s.filters)) for (const f of list) targets.push({ source: { kind: "table", id: Number(id) }, column: f.column });
      for (const [id, list] of Object.entries(s.dvFilters)) for (const f of list) targets.push({ source: { kind: "dynamicView", id: Number(id) }, column: f.column });
    }
    for (const t of targets) {
      const before = currentFilter(t.source, t.column);
      if (!before) continue;
      set(t.source, t.column, null);
      deltas.push({ source: t.source, column: t.column, before, after: null });
    }
    return deltas;
  }
  return deltas;
}

/** Reverse order; only restores a column when it still holds exactly what the AI left (D-11). */
export function undoFilterDeltas(ds: readonly FilterDelta[]): void {
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i];
    if (aiFilterKey(currentFilter(d.source, d.column)) === aiFilterKey(d.after)) set(d.source, d.column, d.before);
  }
}

export function redoFilterDeltas(ds: readonly FilterDelta[]): void {
  for (const d of ds) {
    if (aiFilterKey(currentFilter(d.source, d.column)) === aiFilterKey(d.before)) set(d.source, d.column, d.after);
  }
}

/** D-17 "Clear this filter": the plain chip-x path. */
export function clearFilterAsUser(source: FilterSourceRef, column: string): void {
  set(source, column, null);
}
