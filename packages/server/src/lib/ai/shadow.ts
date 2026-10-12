// Phase 135: in-memory shadow of the dashboard as the AI edits it this turn. The gateway checks references against
// it so op N+1 can target what op N created/removed. Never persisted; titles/ids only.
import type { AiOp, AskRequest } from "@kinetica-bi/shared";

export type ShadowState = {
  widgets: Map<number, { type: string; title: string; tableId?: number }>;
  layers: Map<number, { widgetId: number; tableId?: number }>;
  dynamicViews: Set<number>;
  usedTempIds: Set<number>;
};

export function createShadow(snapshot: AskRequest["snapshot"]): ShadowState {
  const s: ShadowState = { widgets: new Map(), layers: new Map(), dynamicViews: new Set(), usedTempIds: new Set() };
  for (const w of snapshot.widgets) {
    s.widgets.set(w.id, { type: w.type, title: w.title, ...(w.tableId !== undefined ? { tableId: w.tableId } : {}) });
    if (w.id < 0) s.usedTempIds.add(w.id);
  }
  for (const l of snapshot.layers) {
    s.layers.set(l.id, { widgetId: l.widgetId, ...(l.tableId !== undefined ? { tableId: l.tableId } : {}) });
    if (l.id < 0) s.usedTempIds.add(l.id);
  }
  for (const d of snapshot.dynamicViews) {
    s.dynamicViews.add(d.id);
    if (d.id < 0) s.usedTempIds.add(d.id);
  }
  return s;
}

export function applyOpToShadow(s: ShadowState, op: AiOp): void {
  switch (op.op) {
    case "add_widget": {
      const tableId = (op.config as Record<string, unknown>).tableId;
      s.widgets.set(op.tempId, { type: op.type, title: op.title, ...(typeof tableId === "number" ? { tableId } : {}) });
      s.usedTempIds.add(op.tempId);
      return;
    }
    case "remove_widget":
      s.widgets.delete(op.id);
      return;
    case "add_layer":
      s.layers.set(op.tempId, { widgetId: op.widgetId });
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
    default:
      return; // patch / filters: no structural change
  }
}

/** Human label: titles and ids only - never config values. */
export function describeOp(op: AiOp, s: ShadowState): string {
  switch (op.op) {
    case "add_widget":
      return `Added ${op.type} "${op.title}"`;
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
    case "add_layer":
      return `Added layer to widget ${op.widgetId}`;
    case "remove_layer":
      return `Removed layer ${op.id}`;
    case "add_dynamic_view":
      return "Added dynamic view";
    case "remove_dynamic_view":
      return `Removed dynamic view ${op.id}`;
    case "apply_filter":
      return `Applied filter from widget ${op.widgetId}`;
    case "clear_filter":
      return op.widgetId === undefined ? "Cleared filters" : `Cleared filter from widget ${op.widgetId}`;
  }
}
