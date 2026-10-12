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
    Object.keys(d.contribution.dynamicView).length > 0
  );
}

export function applySessionToWidgets(saved: WidgetDto[], d: SessionDerived): WidgetDto[] {
  if (d.removedWidgetIds.size === 0 && d.addedWidgets.length === 0) return saved;
  return [...saved.filter((w) => !d.removedWidgetIds.has(w.id)), ...d.addedWidgets];
}

export function applySessionToLayers(saved: DashboardLayerDto[], d: SessionDerived): DashboardLayerDto[] {
  if (d.removedLayerIds.size === 0 && d.addedLayers.length === 0) return saved;
  return [...saved.filter((l) => !d.removedLayerIds.has(l.id)), ...d.addedLayers];
}
