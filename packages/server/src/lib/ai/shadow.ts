// Phase 135: in-memory shadow of the dashboard as the AI edits it this turn. The gateway checks references against
// it so op N+1 can target what op N created/removed. Never persisted; titles/ids only.
// Phase 136: also carries rects (placement/layout checks), saved-vs-temp flags (D-06), layer render modes/tables.
import { AI_DEFAULT_SIZE, aiFilterSourceKey, aiLayerColumnRefs, aiWidgetColumnRefs, placeWidget, resolveRect, type AiOp, type AiWidgetType, type AskRequest, type GridRect } from "@kinetica-bi/shared";

export type ShadowWidget = {
  type: string;
  title: string;
  tableId?: number;
  rect: GridRect;
  saved: boolean;
  dynamicViewId?: number;
  groupByCount: number;
  /** 139: column names this widget's binding reads (for dependent planning when its view is removed). */
  refCols: string[];
};
export type ShadowLayer = { widgetId: number; tableId?: number; renderMode?: string; title?: string; saved: boolean; dynamicViewId?: number; refCols: string[] };
/** 139: what the gateway knows about a view (saved views carry only the name). */
export type ShadowDvInfo = { name: string; baseTableId?: number; columns?: { name: string; type?: string }[]; aggregated?: boolean };

export type ShadowState = {
  widgets: Map<number, ShadowWidget>;
  layers: Map<number, ShadowLayer>;
  dynamicViews: Set<number>;
  dvInfo: Map<number, ShadowDvInfo>;
  usedTempIds: Set<number>;
  /** 138: filtered column names per source key ("table:5"); seeded from the snapshot, updated by filter ops. */
  filterCols: Map<string, Set<string>>;
};

function groupCount(b: { groupByColumns?: unknown; groupByColumn?: unknown } | undefined): number {
  if (!b) return 0;
  if (Array.isArray(b.groupByColumns)) return b.groupByColumns.length;
  return typeof b.groupByColumn === "string" && b.groupByColumn ? 1 : 0;
}

export function createShadow(snapshot: AskRequest["snapshot"]): ShadowState {
  const s: ShadowState = { widgets: new Map(), layers: new Map(), dynamicViews: new Set(), dvInfo: new Map(), usedTempIds: new Set(), filterCols: new Map() };
  let savedIndex = 0;
  snapshot.widgets.forEach((w, i) => {
    const saved = w.id > 0;
    // Saved widgets without a layout use the grid fallback by their position among saved widgets (DashboardsPage getWidgetLayout).
    const rect = resolveRect(w.layout, saved ? savedIndex : i);
    if (saved) savedIndex++;
    s.widgets.set(w.id, {
      type: w.type,
      title: w.title,
      ...(w.tableId !== undefined ? { tableId: w.tableId } : {}),
      rect,
      saved,
      ...(w.dynamicViewId !== undefined ? { dynamicViewId: w.dynamicViewId } : {}),
      groupByCount: groupCount(w.binding),
      refCols: aiWidgetColumnRefs((w.binding ?? {}) as Record<string, unknown>),
    });
    if (w.id < 0) s.usedTempIds.add(w.id);
  });
  for (const l of snapshot.layers) {
    s.layers.set(l.id, {
      widgetId: l.widgetId,
      ...(l.tableId !== undefined ? { tableId: l.tableId } : {}),
      ...(l.renderMode !== undefined ? { renderMode: l.renderMode } : {}),
      ...(l.title !== undefined ? { title: l.title } : {}),
      saved: l.id > 0,
      ...(l.dynamicViewId !== undefined ? { dynamicViewId: l.dynamicViewId } : {}),
      refCols: [...(l.columns ?? [])],
    });
    if (l.id < 0) s.usedTempIds.add(l.id);
  }
  for (const d of snapshot.dynamicViews) {
    s.dynamicViews.add(d.id);
    s.dvInfo.set(d.id, {
      name: d.name,
      ...(d.baseTableId !== undefined ? { baseTableId: d.baseTableId } : {}),
      ...(d.aggregated !== undefined ? { aggregated: d.aggregated } : {}),
      ...(d.columns !== undefined ? { columns: d.columns } : {}),
    });
    if (d.id < 0) s.usedTempIds.add(d.id);
  }
  for (const f of snapshot.filters) {
    const k = `${f.source.kind}:${f.source.id}`;
    const set = s.filterCols.get(k) ?? new Set<string>();
    set.add(f.column);
    s.filterCols.set(k, set);
  }
  return s;
}

export function shadowRects(s: ShadowState): ({ id: number } & GridRect)[] {
  return [...s.widgets.entries()].map(([id, w]) => ({ id, ...w.rect }));
}

export function applyOpToShadow(s: ShadowState, op: AiOp): void {
  switch (op.op) {
    case "add_widget": {
      const cfg = op.config as Record<string, unknown>;
      const tableId = cfg.tableId;
      const size = AI_DEFAULT_SIZE[op.type as AiWidgetType] ?? { w: 18, h: 24 };
      const rect = op.layout ?? placeWidget(shadowRects(s), size);
      const dvId = typeof cfg.dynamicViewId === "number" ? cfg.dynamicViewId : undefined;
      const dvBase = dvId !== undefined ? s.dvInfo.get(dvId)?.baseTableId : undefined;
      const tid = dvBase ?? (typeof tableId === "number" ? tableId : undefined);
      s.widgets.set(op.tempId, {
        type: op.type,
        title: op.title,
        ...(tid !== undefined ? { tableId: tid } : {}),
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        saved: false,
        ...(dvId !== undefined ? { dynamicViewId: dvId } : {}),
        groupByCount: groupCount(cfg),
        refCols: aiWidgetColumnRefs(cfg),
      });
      s.usedTempIds.add(op.tempId);
      return;
    }
    case "remove_widget":
      s.widgets.delete(op.id);
      return;
    case "add_layer":
      s.layers.set(op.tempId, {
        widgetId: op.widgetId,
        tableId: op.tableId,
        renderMode: "heatmap",
        ...(op.name ? { title: op.name } : {}),
        saved: false,
        ...(op.dynamicViewId !== undefined ? { dynamicViewId: op.dynamicViewId } : {}),
        refCols: aiLayerColumnRefs({ latColumn: op.latColumn, lonColumn: op.lonColumn, wktColumn: op.wktColumn, wkbColumn: op.wkbColumn, valueColumn: op.style?.valueColumn }),
      });
      s.usedTempIds.add(op.tempId);
      return;
    case "remove_layer":
      s.layers.delete(op.id);
      return;
    case "add_dynamic_view":
      s.dynamicViews.add(op.tempId);
      s.usedTempIds.add(op.tempId);
      s.dvInfo.set(op.tempId, {
        name: op.name,
        baseTableId: op.spec.baseTableId,
        ...(op.columns ? { columns: op.columns } : {}),
        ...(op.aggregated !== undefined ? { aggregated: op.aggregated } : {}),
      });
      return;
    case "remove_dynamic_view":
      s.dynamicViews.delete(op.id);
      s.dvInfo.delete(op.id);
      if (op.repoint) {
        for (const id of op.repoint.widgetIds) {
          const w = s.widgets.get(id);
          if (!w) continue;
          delete w.dynamicViewId;
          w.tableId = op.repoint.tableId;
        }
        for (const id of op.repoint.layerIds) {
          const l = s.layers.get(id);
          if (!l) continue;
          delete l.dynamicViewId;
          l.tableId = op.repoint.tableId;
        }
      }
      for (const id of op.drop?.widgetIds ?? []) s.widgets.delete(id);
      for (const id of op.drop?.layerIds ?? []) s.layers.delete(id);
      return;
    case "patch": {
      const dvId = op.action.configPatch.dynamicViewId;
      if (typeof dvId !== "number") return;
      const base = s.dvInfo.get(dvId)?.baseTableId;
      const t = op.action.target;
      const ent = t.kind === "widget" ? s.widgets.get(t.id) : t.kind === "layer" ? s.layers.get(t.id) : undefined;
      if (!ent) return;
      ent.dynamicViewId = dvId;
      if (base !== undefined) ent.tableId = base;
      return;
    }
    case "set_layout":
      for (const it of op.items) {
        const w = s.widgets.get(it.id);
        if (w) w.rect = { x: it.x, y: it.y, w: it.w, h: it.h };
      }
      return;
    case "change_widget_type": {
      const w = s.widgets.get(op.id);
      if (w) w.type = op.type;
      return;
    }
    case "set_widget_title": {
      const w = s.widgets.get(op.id);
      if (w) w.title = op.title;
      return;
    }
    case "apply_filter": {
      const k = aiFilterSourceKey(op.source);
      const set = s.filterCols.get(k) ?? new Set<string>();
      for (const f of op.filters) set.add(f.column);
      s.filterCols.set(k, set);
      return;
    }
    case "clear_filter": {
      if (op.source === undefined) {
        s.filterCols.clear();
        return;
      }
      const k = aiFilterSourceKey(op.source);
      if (op.column === undefined) {
        s.filterCols.delete(k);
        return;
      }
      const set = s.filterCols.get(k);
      set?.delete(op.column);
      if (set && set.size === 0) s.filterCols.delete(k);
      return;
    }
    default:
      return;
  }
}

/** Human label: titles and ids only - never config values. */
export function describeOp(op: AiOp, s: ShadowState): string {
  switch (op.op) {
    case "add_widget": {
      const base = `Added ${op.type} "${op.title}"`;
      if (!op.layout) return base;
      let bottom = 0;
      for (const r of s.widgets.values()) bottom = Math.max(bottom, r.rect.y + r.rect.h);
      if (s.widgets.size > 0 && op.layout.y >= bottom) return `${base} below existing content`;
      return `${base} at row ${op.layout.y}, column ${op.layout.x}`;
    }
    case "patch": {
      const { kind, id } = op.action.target;
      if (kind === "widget") {
        const w = s.widgets.get(id);
        return w ? `Changed widget "${w.title}"` : `Changed widget ${id}`;
      }
      return `Changed ${kind} ${id}`;
    }
    case "remove_widget": {
      const w = s.widgets.get(op.id);
      return w ? `Removed widget "${w.title}"` : `Removed widget ${op.id}`;
    }
    case "add_layer": {
      const m = s.widgets.get(op.widgetId);
      return `Added heatmap layer${op.name ? ` "${op.name}"` : ""} to ${m ? `map "${m.title}"` : `widget ${op.widgetId}`}`;
    }
    case "remove_layer":
      return `Removed layer ${op.id}`;
    case "add_dynamic_view":
      return `Added dynamic view "${op.name}"`;
    case "remove_dynamic_view": {
      const base = `Removed dynamic view ${dvName(op.id, s)}`;
      const parts: string[] = [];
      const wt = (id: number) => (s.widgets.get(id) ? `"${s.widgets.get(id)!.title}"` : `widget ${id}`);
      const lt = (id: number) => (s.layers.get(id)?.title ? `layer "${s.layers.get(id)!.title}"` : `layer ${id}`);
      const re = [...(op.repoint?.widgetIds ?? []).map(wt), ...(op.repoint?.layerIds ?? []).map(lt)];
      const dr = [...(op.drop?.widgetIds ?? []).map(wt), ...(op.drop?.layerIds ?? []).map(lt)];
      if (re.length) parts.push(`repointed ${andList(re)} to its table`);
      if (dr.length) parts.push(`removed ${andList(dr)}`);
      return parts.length ? `${base}; ${parts.join("; ")}` : base;
    }
    case "apply_filter":
      return `Filtered ${filterSrc(op.source)} on ${op.filters.map((f) => f.column).join(", ")}`;
    case "clear_filter":
      if (op.source === undefined) return "Cleared all filters";
      return op.column === undefined
        ? `Cleared the filters on ${filterSrc(op.source)}`
        : `Cleared the ${op.column} filter on ${filterSrc(op.source)}`;
    case "set_layout":
      return `Rearranged ${op.items.length} widgets`;
    case "change_widget_type": {
      const w = s.widgets.get(op.id);
      return `Changed ${w ? `"${w.title}"` : `widget ${op.id}`} to a ${op.type} chart`;
    }
    case "set_widget_title": {
      const w = s.widgets.get(op.id);
      return `Renamed ${w ? `"${w.title}"` : `widget ${op.id}`} to "${op.title}"`;
    }
  }
}

const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const dvName = (id: number, s: ShadowState): string => {
  const n = s.dvInfo.get(id)?.name;
  return n ? `"${n}"` : String(id);
};

const filterSrc = (s: { kind: string; id: number }) => (s.kind === "table" ? `table ${s.id}` : `dynamic view ${s.id}`);

/** Label for a SKIPPED op (change log): what the model tried. Titles and ids only. */
export function describeIntent(op: AiOp, s: ShadowState): string {
  const wt = (id: number) => {
    const w = s.widgets.get(id);
    return w ? `"${w.title}"` : String(id);
  };
  switch (op.op) {
    case "add_widget":
      return `Add ${op.type} "${op.title}"`;
    case "patch": {
      const { kind, id } = op.action.target;
      return kind === "widget" ? `Change widget ${wt(id)}` : `Change ${kind} ${id}`;
    }
    case "remove_widget":
      return `Remove widget ${wt(op.id)}`;
    case "add_layer":
      return `Add heatmap layer${op.name ? ` "${op.name}"` : ""}`;
    case "remove_layer": {
      const l = s.layers.get(op.id);
      return l?.title ? `Remove layer "${l.title}"` : `Remove layer ${op.id}`;
    }
    case "add_dynamic_view":
      return `Add dynamic view "${op.name}"`;
    case "remove_dynamic_view":
      return `Remove dynamic view ${dvName(op.id, s)}`;
    case "apply_filter":
      return `Filter ${filterSrc(op.source)} on ${op.filters.map((f) => f.column).join(", ")}`;
    case "clear_filter":
      if (op.source === undefined) return "Clear all filters";
      return op.column === undefined
        ? `Clear the filters on ${filterSrc(op.source)}`
        : `Clear the ${op.column} filter on ${filterSrc(op.source)}`;
    case "set_layout":
      return "Rearrange widgets";
    case "change_widget_type":
      return `Change widget ${wt(op.id)} to a ${op.type} chart`;
    case "set_widget_title":
      return `Rename widget ${wt(op.id)}`;
  }
}
