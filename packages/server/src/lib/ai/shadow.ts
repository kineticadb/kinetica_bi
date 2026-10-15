// Phase 135: in-memory shadow of the dashboard as the AI edits it this turn. The gateway checks references against
// it so op N+1 can target what op N created/removed. Never persisted; titles/ids only.
// Phase 136: also carries rects (placement/layout checks), saved-vs-temp flags (D-06), layer render modes/tables.
import { AI_DEFAULT_SIZE, placeWidget, resolveRect, type AiOp, type AiWidgetType, type AskRequest, type GridRect } from "@kinetica-bi/shared";

export type ShadowWidget = {
  type: string;
  title: string;
  tableId?: number;
  rect: GridRect;
  saved: boolean;
  dynamicViewId?: number;
  groupByCount: number;
};
export type ShadowLayer = { widgetId: number; tableId?: number; renderMode?: string; title?: string; saved: boolean };

export type ShadowState = {
  widgets: Map<number, ShadowWidget>;
  layers: Map<number, ShadowLayer>;
  dynamicViews: Set<number>;
  usedTempIds: Set<number>;
};

function groupCount(b: { groupByColumns?: unknown; groupByColumn?: unknown } | undefined): number {
  if (!b) return 0;
  if (Array.isArray(b.groupByColumns)) return b.groupByColumns.length;
  return typeof b.groupByColumn === "string" && b.groupByColumn ? 1 : 0;
}

export function createShadow(snapshot: AskRequest["snapshot"]): ShadowState {
  const s: ShadowState = { widgets: new Map(), layers: new Map(), dynamicViews: new Set(), usedTempIds: new Set() };
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
    });
    if (l.id < 0) s.usedTempIds.add(l.id);
  }
  for (const d of snapshot.dynamicViews) {
    s.dynamicViews.add(d.id);
    if (d.id < 0) s.usedTempIds.add(d.id);
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
      s.widgets.set(op.tempId, {
        type: op.type,
        title: op.title,
        ...(typeof tableId === "number" ? { tableId } : {}),
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        saved: false,
        groupByCount: groupCount(cfg),
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
      });
      s.usedTempIds.add(op.tempId);
      return;
    case "remove_layer":
      s.layers.delete(op.id);
      return;
    case "add_dynamic_view":
      s.dynamicViews.add(op.tempId);
      s.usedTempIds.add(op.tempId);
      return;
    case "remove_dynamic_view":
      s.dynamicViews.delete(op.id);
      return;
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
    default:
      return; // patch / filters: no structural change
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
      return "Added dynamic view";
    case "remove_dynamic_view":
      return `Removed dynamic view ${op.id}`;
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
      return "Add dynamic view";
    case "remove_dynamic_view":
      return `Remove dynamic view ${op.id}`;
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
