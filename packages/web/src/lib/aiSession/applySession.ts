// Phase 134: ref-stable merge helpers for the read sites. Pure, no store imports.
// Patches on SAVED targets are NOT applied here; they flow through widgetActionStore overlays
// under AI_SOURCE_ID. Only structural adds/removes are merged into the lists.
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { SessionDerived } from "./types";

export function hasSessionChanges(d: SessionDerived): boolean {
  return (
    d.addedWidgets.length > 0 ||
    d.removedWidgetIds.size > 0 ||
    d.addedLayers.length > 0 ||
    d.removedLayerIds.size > 0 ||
    Object.keys(d.contribution.widget).length > 0 ||
    Object.keys(d.contribution.layer).length > 0 ||
    Object.keys(d.contribution.dynamicView).length > 0 ||
    Object.keys(d.layout).length > 0 ||
    Object.keys(d.widgetMeta).length > 0 ||
    d.aiEditedWidgetIds.size > 0 ||
    d.aiEditedLayerIds.size > 0
  );
}

export function applySessionToWidgets(saved: WidgetDto[], d: SessionDerived): WidgetDto[] {
  const metaIds = Object.keys(d.widgetMeta);
  if (d.removedWidgetIds.size === 0 && d.addedWidgets.length === 0 && metaIds.length === 0) return saved;
  const base = metaIds.length === 0 ? saved : saved.map((w) => {
    const m = d.widgetMeta[w.id];
    if (!m) return w;
    return {
      ...w,
      ...(m.type !== undefined ? { type: m.type } : {}),
      ...(m.title !== undefined ? { title: m.title } : {}),
      ...(m.config ? { config: { ...w.config, ...m.config } } : {}),
    };
  });
  return [...base.filter((w) => !d.removedWidgetIds.has(w.id)), ...d.addedWidgets];
}

export function applySessionToLayers(
  saved: DashboardLayerDto[],
  d: SessionDerived,
  tempVisibility: Readonly<Record<number, boolean>> = {},
): DashboardLayerDto[] {
  const hasVis = Object.keys(tempVisibility).length > 0;
  if (d.removedLayerIds.size === 0 && d.addedLayers.length === 0 && !hasVis) return saved;
  const merged =
    d.removedLayerIds.size === 0 && d.addedLayers.length === 0
      ? saved
      : [...saved.filter((l) => !d.removedLayerIds.has(l.id)), ...d.addedLayers];
  if (!hasVis) return merged;
  let changed = false;
  const out = merged.map((l) => {
    if (l.id >= 0 || tempVisibility[l.id] === undefined) return l;
    changed = true;
    return { ...l, config: { ...l.config, visible: tempVisibility[l.id] } };
  });
  return changed ? out : merged;
}
