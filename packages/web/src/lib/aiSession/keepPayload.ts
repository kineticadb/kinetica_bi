// 141 Keep: build the request from the folded session. Pure. Saved edits are resolved through the SAME
// functions the read paths use (applySessionToWidgets + mergeWidgetOverlay, applySessionToLayers +
// applyLayerOverrides), from derived.contribution only (never the radio-merged overlay map), so what
// Keep saves is what the user saw.
import type { AiKeepRequest } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { SessionDerived, SessionRect } from "./types";
import { applySessionToWidgets, applySessionToLayers } from "./applySession";
import { mergeWidgetOverlay, type WidgetOverlayDeps } from "../widgetOverlay";
import { applyLayerOverrides } from "../applyLayerOverrides";

export type KeepPayloadInput = {
  baselineVersion: number;
  derived: SessionDerived;
  savedWidgets: readonly WidgetDto[];
  savedLayers: readonly DashboardLayerDto[];
  tempLayerVisibility: Readonly<Record<number, boolean>>;
  /** The DashboardsPage `layouts` rect for every visible widget. */
  rects: Readonly<Record<number, SessionRect>>;
  overlay: WidgetOverlayDeps;
};

type Cfg = Record<string, unknown>;
type WidgetEdit = AiKeepRequest["widgets"]["edit"][number];
type LayerEdit = AiKeepRequest["layers"]["edit"][number];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const withoutUndefined = (o: Cfg): Cfg => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const hasCompleteLayout = (cfg: Cfg): boolean => {
  const l = cfg.layout as Partial<SessionRect> | undefined;
  return !!l && [l.x, l.y, l.w, l.h].every((n) => typeof n === "number");
};
const asJsonText = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
const positive = (ids: Iterable<number>): number[] => [...ids].filter((n) => n > 0);

/** 141 D-20: saved-view on/off toggles are not saved; the UI tells the user when this is > 0. */
export function countViewToggles(derived: SessionDerived): number {
  return Object.values(derived.contribution.dynamicView).filter((p) => p && Object.keys(p).length > 0).length;
}

export function buildKeepPayload(input: KeepPayloadInput): AiKeepRequest {
  const { derived, savedWidgets, savedLayers, tempLayerVisibility, rects, overlay } = input;

  // ---- widgets: adds
  const widgetAdds: AiKeepRequest["widgets"]["add"] = derived.addedWidgets.map((w) => {
    const eff = mergeWidgetOverlay(w, derived.contribution.widget[w.id] ?? null, overlay);
    const { layout, ...config } = withoutUndefined(eff.config);
    const rect = rects[w.id] ?? (hasCompleteLayout(eff.config) ? (layout as SessionRect) : undefined);
    if (!rect) throw new Error(`No displayed rect for new widget ${w.id}`);
    return { tempId: w.id, type: eff.type as never, title: eff.title, config, rect };
  });

  // ---- widgets: edits of saved, non-removed widgets
  const removed = derived.removedWidgetIds;
  const appliedById = new Map(applySessionToWidgets([...savedWidgets], derived).map((w) => [w.id, w]));
  const candidates = new Set<number>([
    ...derived.aiEditedWidgetIds,
    ...Object.keys(derived.widgetMeta).map(Number),
    ...Object.keys(derived.contribution.widget).map(Number),
    ...Object.keys(derived.layout).map(Number),
  ]);
  const baked = new Set<number>();
  if (removed.size > 0) {
    for (const w of savedWidgets) if (!removed.has(w.id) && !hasCompleteLayout(w.config)) baked.add(w.id);
    for (const id of baked) candidates.add(id);
  }
  const widgetEdits: WidgetEdit[] = [];
  for (const saved of savedWidgets) {
    if (!candidates.has(saved.id) || removed.has(saved.id)) continue;
    const applied = appliedById.get(saved.id) ?? saved;
    const eff = mergeWidgetOverlay(applied, derived.contribution.widget[saved.id] ?? null, overlay);
    const edit: WidgetEdit = { id: saved.id };
    const configSet: Cfg = {};
    for (const [k, v] of Object.entries(eff.config)) {
      if (k === "layout" || v === undefined) continue;
      if (!same(v, saved.config[k])) configSet[k] = v;
    }
    const configUnset = Object.keys(saved.config).filter((k) => k !== "layout" && eff.config[k] === undefined);
    if (Object.keys(configSet).length > 0) edit.configSet = configSet;
    if (configUnset.length > 0) edit.configUnset = configUnset;
    if (eff.title !== saved.title) edit.title = eff.title;
    if (eff.type !== saved.type) edit.type = eff.type as never;
    if (derived.layout[saved.id] || baked.has(saved.id)) {
      const rect = rects[saved.id] ?? derived.layout[saved.id];
      if (rect) edit.rect = rect;
    }
    if (Object.keys(edit).length > 1) widgetEdits.push(edit);
  }

  // ---- layers
  const bound = applySessionToLayers([...savedLayers], derived);
  const boundById = new Map(bound.map((l) => [l.id, l]));
  const savedLayerById = new Map(savedLayers.map((l) => [l.id, l]));
  const layerAdds: AiKeepRequest["layers"]["add"] = derived.addedLayers.map((l) => {
    const eff = applyLayerOverrides([l], derived.contribution.layer as Record<number, Cfg>)[0];
    const vis = tempLayerVisibility[l.id];
    return {
      tempId: l.id,
      tableId: l.table_id as number,
      config: { ...withoutUndefined(eff.config as Cfg), ...(vis !== undefined ? { visible: vis } : {}) },
      dynamicViewId: l.dynamic_view_id ?? null,
    };
  });
  const layerIds = new Set<number>(positive([
    ...Object.keys(derived.contribution.layer).map(Number),
    ...Object.keys(derived.layerBinding).map(Number),
    ...derived.aiEditedLayerIds,
  ]));
  const layerEdits: LayerEdit[] = [];
  for (const id of layerIds) {
    const saved = savedLayerById.get(id);
    if (!saved || derived.removedLayerIds.has(id)) continue;
    const resolved = applyLayerOverrides([boundById.get(id) ?? saved], derived.contribution.layer as Record<number, Cfg>)[0];
    const edit: LayerEdit = { id };
    const configSet: Cfg = {};
    for (const [k, v] of Object.entries(resolved.config as Cfg)) {
      if (v !== undefined && !same(v, (saved.config as Cfg)[k])) configSet[k] = v;
    }
    if (Object.keys(configSet).length > 0) edit.configSet = configSet;
    if (resolved.table_id !== saved.table_id) edit.tableId = resolved.table_id as number;
    if (resolved.dynamic_view_id !== saved.dynamic_view_id) edit.dynamicViewId = resolved.dynamic_view_id ?? null;
    const cb = asJsonText(resolved.cb_config);
    if (cb !== asJsonText(saved.cb_config)) edit.cb_config = cb;
    const tr = asJsonText(resolved.track_config);
    if (tr !== asJsonText(saved.track_config)) edit.track_config = tr;
    if (Object.keys(edit).length > 1) layerEdits.push(edit);
  }

  return {
    baselineVersion: input.baselineVersion,
    dynamicViews: {
      add: derived.addedDynamicViews.map((d) => ({ tempId: d.id, name: d.name, spec: d.spec })),
      remove: positive(derived.removedDynamicViewIds),
    },
    layers: { add: layerAdds, edit: layerEdits, remove: positive(derived.removedLayerIds) },
    widgets: { add: widgetAdds, edit: widgetEdits, remove: positive(removed) },
  };
}
