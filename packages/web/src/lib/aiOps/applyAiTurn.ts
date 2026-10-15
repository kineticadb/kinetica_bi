// 138: the ONE apply path for every AI turn (real askRunner answers and the DEV harness alike).
// Records the turn, executes applied filter ops through the click-path applier (138-05), attaches
// per-entry deltas, outlines changed + narrowed widgets (D-15), and writes value-bearing notes to the
// display-only TurnChat.filterNotes (D-16/D-18). Notes are never put in Turn.answer (AIGOV-V20-02).
import { aiFilterSourceKey } from "@kinetica-bi/shared";
import type { AiOp } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { useAuthStore } from "../../store/auth";
import { isFilterOp } from "../aiSession/foldSession";
import { changedWidgetIds } from "../aiSession/changeCounts";
import type { FilterDelta, FilterSourceRef, SessionBaseline, TurnEntry, TurnInput } from "../aiSession/types";
import { buildChipText } from "../columnTypes";
import { computeReverseFilterMap, type FilterApplyEntry } from "../computeReverseFilterMap";
import { enumerateVizDescriptors } from "../useReverseFilterMap";
import { aggregateSpatialTargetsByTable } from "../spatialTargets";
import { currentFilter, currentFilterColumns, executeFilterOp } from "./aiFilterApplier";
import { AI_FILTER_COPY } from "./aiFilterCopy";
import { checkZeroRowFilters, type ZeroRowCheck, type ZeroRowCheckInput } from "./aiFilterZeroRows";

export type ApplyAiTurnDeps = { checkZeroRows?: (input: ZeroRowCheckInput) => Promise<void> };

type FilterMaps = { filters: Record<number, ActiveFilter[]>; dvFilters: Record<number, ActiveFilter[]> };

const chip = (f: ActiveFilter): string =>
  buildChipText(f.column, f.value, f.dataType as Parameters<typeof buildChipText>[2], f.operator);

function sourceLabel(s: FilterSourceRef, baseline: SessionBaseline): string {
  if (s.kind === "table") return baseline.tables?.find((t) => t.id === s.id)?.name ?? `table ${s.id}`;
  return baseline.dynamicViewNames?.[s.id] ?? `dynamic view ${s.id}`;
}

function entryFor(entries: FilterApplyEntry[], f: ActiveFilter | null): Set<number> {
  const out = new Set<number>();
  if (!f) return out;
  const e = entries.find((x) => x.filter === f);
  for (const w of e?.widgets ?? []) out.add(w.widgetId);
  return out;
}

export function applyAiTurn(
  input: TurnInput,
  baseline: SessionBaseline,
  deps: ApplyAiTurnDeps = {},
): { turnId: string; entries: TurnEntry[] } {
  const store = useAiSessionStore.getState();
  const pre = store.derived;
  const fsPre = useFilterStore.getState();
  const preFs: FilterMaps = { filters: fsPre.filters, dvFilters: fsPre.dvFilters };

  const { turnId, entries } = store.applyTurn({ ...input, currentFilters: currentFilterColumns() }, baseline);

  const executed: { i: number; op: AiOp; deltas: FilterDelta[] }[] = [];
  entries.forEach((e, i) => {
    if (e.result.status === "applied" && e.op && isFilterOp(e.op)) {
      const deltas = executeFilterOp(e.op);
      if (deltas.length > 0) useAiSessionStore.getState().attachEntryFilterDeltas(turnId, i, deltas);
      executed.push({ i, op: e.op, deltas });
    }
  });

  const post = useAiSessionStore.getState().derived;
  const fsPost = useFilterStore.getState();
  const postFs: FilterMaps = { filters: fsPost.filters, dvFilters: fsPost.dvFilters };

  // 136-12 UAT finding 3: EFFECTIVE includedLayerIds (saved overridden by the session contribution,
  // before and after this answer) and every layer that existed before or after.
  const effIds = (id: number): unknown[] | undefined => {
    const a = pre.contribution.widget[id]?.includedLayerIds;
    const b = post.contribution.widget[id]?.includedLayerIds;
    const ids = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  };
  const hlWidgets: WidgetDto[] = baseline.widgets.map((w) => {
    const inc = effIds(w.id);
    return inc ? { ...w, config: { ...w.config, includedLayerIds: inc } } : w;
  });
  hlWidgets.push(...post.addedWidgets);
  const hlLayers = new Map<number, DashboardLayerDto>();
  for (const l of [...baseline.layers, ...pre.addedLayers, ...post.addedLayers]) hlLayers.set(l.id, l);
  const changed = changedWidgetIds(entries, { widgets: hlWidgets, layers: [...hlLayers.values()] });

  // Narrowing context: the dashboard as it is AFTER this turn.
  const nWidgets: WidgetDto[] = baseline.widgets
    .filter((w) => !post.removedWidgetIds.has(w.id))
    .map((w) => {
      const inc = post.contribution.widget[w.id]?.includedLayerIds;
      return Array.isArray(inc) ? { ...w, config: { ...w.config, includedLayerIds: inc } } : w;
    });
  nWidgets.push(...post.addedWidgets);
  const nLayers: DashboardLayerDto[] = [
    ...baseline.layers.filter((l) => !post.removedLayerIds.has(l.id)),
    ...post.addedLayers,
  ];
  const dvOff = useAuthStore.getState().dvFilterScopeDisabled;
  const vizs = enumerateVizDescriptors({
    widgets: nWidgets,
    layers: nLayers,
    associatedTables: [],
    targetsByTable: aggregateSpatialTargetsByTable(nWidgets),
  });
  const preMap = computeReverseFilterMap({ ...preFs, shapes: [], vizs, dvFilterScopeDisabled: dvOff });
  const postMap = computeReverseFilterMap({ ...postFs, shapes: [], vizs, dvFilterScopeDisabled: dvOff });

  const idsOf = (ds: readonly FilterDelta[]): Set<number> => {
    const out = new Set<number>();
    for (const d of ds) {
      for (const id of entryFor(postMap.filterEntries, d.after)) out.add(id);
      if (d.before && d.before !== d.after) for (const id of entryFor(preMap.filterEntries, d.before)) out.add(id);
    }
    return out;
  };

  const allNarrowed = new Set<number>();
  const perEntryCount = new Map<number, number>();
  const scopedIds = new Set<number>();
  for (const x of executed) {
    const ids = idsOf(x.deltas);
    perEntryCount.set(x.i, ids.size);
    ids.forEach((id) => allNarrowed.add(id));
    if (x.op.op === "apply_filter" && x.deltas.length > 0) {
      const src = x.op.source;
      for (const v of vizs) {
        const matches = src.kind === "table" ? v.tableId === src.id : v.dynamicViewId === src.id;
        if (!matches || ids.has(v.widgetId)) continue;
        const isDv = v.dynamicViewId !== undefined;
        const cfg = isDv && dvOff ? undefined : v.cfg;
        if (cfg?.sourceMode && cfg.sourceMode !== "all") scopedIds.add(v.widgetId);
      }
    }
  }
  useAiSessionStore.getState().setHighlight([...new Set([...changed, ...allNarrowed])]);

  // Notes (display only; never written to the answer).
  const notes: string[] = [];
  const touched = new Set<string>();
  let anyFilterNote = false;
  entries.forEach((e, i) => {
    const op = e.op;
    if (!op || !isFilterOp(op)) return;
    if (e.result.status === "skipped") {
      if (op.op !== "apply_filter") return;
      const label = sourceLabel(op.source, baseline);
      if (e.result.reason === "filter_cap") notes.push(AI_FILTER_COPY.skippedCap(label));
      else if (e.result.reason === "column_not_found") notes.push(AI_FILTER_COPY.skippedColumn(e.result.detail ?? "", label));
      return;
    }
    const x = executed.find((q) => q.i === i);
    if (!x) return;
    for (const d of x.deltas) touched.add(`${aiFilterSourceKey(d.source)}|${d.column}`);
    const n = perEntryCount.get(i) ?? 0;
    if (op.op === "apply_filter") {
      const label = sourceLabel(op.source, baseline);
      if (x.deltas.length > 0) {
        const chips = x.deltas.map((d) => (d.after ? chip(d.after) : "")).filter(Boolean);
        notes.push(AI_FILTER_COPY.filtered(label, chips.join(", "), n));
      } else {
        const cur = op.filters.map((f) => currentFilter(op.source, f.column)).filter((f): f is ActiveFilter => !!f);
        notes.push(AI_FILTER_COPY.alreadyFiltered(label, cur.map(chip).join(", ")));
      }
      anyFilterNote = true;
    } else if (op.op === "clear_filter" && x.deltas.length > 0) {
      if (op.source && op.column) notes.push(AI_FILTER_COPY.clearedColumn(op.column, sourceLabel(op.source, baseline), n));
      else if (op.source) notes.push(AI_FILTER_COPY.clearedSource(sourceLabel(op.source, baseline), n));
      else {
        notes.push(AI_FILTER_COPY.clearedAll(n));
        if (useSpatialFilterStore.getState().shapes.length > 0) notes.push(AI_FILTER_COPY.shapesLeft);
      }
      anyFilterNote = true;
    }
  });
  if (scopedIds.size > 0) notes.push(AI_FILTER_COPY.skippedScoped(scopedIds.size));
  if (anyFilterNote) {
    const cols: string[] = [];
    for (const [key, list] of Object.entries(currentFilterColumns())) {
      for (const c of list) if (!touched.has(`${key}|${c}`) && !cols.includes(c)) cols.push(c);
    }
    if (cols.length > 0) notes.push(AI_FILTER_COPY.stillOn(cols.slice(0, 5)));
  }
  if (notes.length > 0) useAiSessionStore.getState().appendFilterNotes(turnId, notes);

  // D-17: client-side zero-row check for applied filters; the filter stays applied either way.
  const checks: ZeroRowCheck[] = [];
  for (const x of executed) {
    if (x.op.op !== "apply_filter") continue;
    for (const d of x.deltas) {
      if (d.after) checks.push({ source: d.source, column: d.column, after: d.after, sourceLabel: sourceLabel(d.source, baseline) });
    }
  }
  if (checks.length > 0) {
    try {
      void Promise.resolve((deps.checkZeroRows ?? checkZeroRowFilters)({ turnId, epoch: useAiSessionStore.getState().epoch, checks })).catch(() => {});
    } catch {
      /* the filter stays applied either way */
    }
  }
  return { turnId, entries };
}
