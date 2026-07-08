/**
 * Phase 105 (FSCOPE-V120-01, computation portion): Reverse filter map.
 *
 * This module is the structural INVERSE of resolveFilterSet.ts + resolveSpatialShapes.ts.
 * Those forward resolvers answer "given this viz's config, which active filters/shapes apply
 * to it?" — this module answers "given ALL vizzes, which WIDGETS does THIS filter/shape apply
 * to?" by iterating every viz descriptor and re-running the SAME two forward resolvers, then
 * inverting per-viz membership into a per-filter/per-shape, widget-level applies-to set.
 *
 * MUST stay in lockstep with resolveFilterSet.ts / resolveSpatialShapes.ts / the dv-override
 * rules in useFilterScopeSummary.ts — if any of those change, update this file in the SAME
 * commit, or the panel's applies-to list (Phase 108) and the per-widget badge (Phase 95) can
 * silently drift apart.
 *
 * PURE: no React import, no runtime store import (types only), never mutates its inputs
 * (filters/dvFilters/shapes/vizs), and never throws — even on a malformed/incomplete
 * VizDescriptor (e.g. both tableId and dynamicViewId undefined resolves an empty active list
 * and contributes nothing). Live-store wiring is a thin hook added in Phase 108.
 */

import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { resolveFilterSet } from "./resolveFilterSet";
import { resolveSpatialShapes } from "./resolveSpatialShapes";

// ─── Public Types ───────────────────────────────────────────────────────────────

export type VizDescriptor = {
  /** "widget" = chart/table/etc widget entry (w:<id>); "layer" = map layer entry (l:<id>). */
  vizKind: "widget" | "layer";
  /**
   * The WIDGET-CARD id this entry aggregates onto. For vizKind "widget" this IS the widget's
   * own id. For vizKind "layer" this is the OWNING map widget's id — NOT the layer's own id.
   */
  widgetId: number;
  /** Present only for vizKind "layer" — the layer's own DB id. */
  layerId?: number;
  /**
   * Present only for vizKind "layer" — a pre-resolved opaque display name. The lib never
   * resolves layer names itself (keeps it store/table-free); it only aggregates the string.
   */
  layerName?: string;
  /** The widget-card title shown in an applies-to list. */
  widgetTitle: string;
  /** The per-viz filter-selection config. undefined => accept-all. */
  cfg: FilterSelectionConfig | undefined;
  /** Table-bound source id. Mutually exclusive with dynamicViewId. */
  tableId?: number;
  /** Dv-bound source id. Mutually exclusive with tableId. */
  dynamicViewId?: number;
  /**
   * Caller-supplied; true only for a table-bound viz with an eligible spatial target. The lib
   * forces this to false internally for dv-bound vizs regardless of the value passed here.
   */
  spatialCapable: boolean;
};

export type WidgetApplyEntry = {
  widgetId: number;
  widgetTitle: string;
  layerNames?: string[];
};

export type FilterApplyEntry = {
  kind: "filter";
  filter: ActiveFilter;
  widgets: WidgetApplyEntry[];
};

export type ShapeApplyEntry = {
  kind: "shape";
  shape: Shape;
  widgets: WidgetApplyEntry[];
};

// ─── Core Algorithm ─────────────────────────────────────────────────────────────

/**
 * Pure fn — testable without React or stores.
 * REUSES resolveFilterSet + resolveSpatialShapes (no reimplementation of matching logic).
 * Never mutates inputs; never throws.
 */
export function computeReverseFilterMap(args: {
  filters: Record<number, ActiveFilter[]>;
  dvFilters: Record<number, ActiveFilter[]>;
  shapes: Shape[];
  vizs: VizDescriptor[];
  dvFilterScopeDisabled: boolean;
}): { filterEntries: FilterApplyEntry[]; shapeEntries: ShapeApplyEntry[] } {
  // 1. Seed one entry per active filter/shape (guarantees the LOCKED
  //    "zero-match => empty widgets[], never a missing key" contract).
  const filterEntries = new Map<ActiveFilter, WidgetApplyEntry[]>();
  for (const list of Object.values(args.filters)) for (const f of list) filterEntries.set(f, []);
  for (const list of Object.values(args.dvFilters)) for (const f of list) filterEntries.set(f, []);
  const shapeEntries = new Map<Shape, WidgetApplyEntry[]>();
  for (const s of args.shapes) shapeEntries.set(s, []);

  // 2. One pass over vizs, sorted by widgetId ascending for deterministic output order.
  //    Sort a COPY — never mutate the caller's args.vizs array.
  const sortedVizs = [...args.vizs].sort((a, b) => a.widgetId - b.widgetId);
  for (const viz of sortedVizs) {
    const isDv = viz.dynamicViewId !== undefined;
    // dv-bound + dvFilterScopeDisabled => cfg forced to undefined (accept-all).
    const effectiveCfg = isDv && args.dvFilterScopeDisabled ? undefined : viz.cfg;
    // dv forces spatialCapable=false regardless of what the caller passed.
    const effectiveSpatialCapable = isDv ? false : viz.spatialCapable;

    const activeList: ActiveFilter[] = isDv
      ? (args.dvFilters[viz.dynamicViewId as number] ?? [])
      : (viz.tableId !== undefined ? args.filters[viz.tableId] ?? [] : []);

    const resolvedFilters = resolveFilterSet(effectiveCfg, activeList);
    for (const f of resolvedFilters) {
      const entry = filterEntries.get(f);
      if (entry) addWidgetMatch(entry, viz);
    }

    if (effectiveSpatialCapable) {
      const resolvedShapes = resolveSpatialShapes(effectiveCfg, args.shapes);
      for (const s of resolvedShapes) {
        const entry = shapeEntries.get(s);
        if (entry) addWidgetMatch(entry, viz);
      }
    }
  }

  return {
    filterEntries: [...filterEntries].map(([filter, widgets]) => ({ kind: "filter" as const, filter, widgets })),
    shapeEntries: [...shapeEntries].map(([shape, widgets]) => ({ kind: "shape" as const, shape, widgets })),
  };
}

// Widget-level dedup + layer-name aggregation (LOCKED behavior — one entry per widget card).
function addWidgetMatch(target: WidgetApplyEntry[], viz: VizDescriptor): void {
  let entry = target.find((e) => e.widgetId === viz.widgetId);
  if (!entry) {
    entry = { widgetId: viz.widgetId, widgetTitle: viz.widgetTitle, layerNames: undefined };
    target.push(entry);
  }
  if (viz.vizKind === "layer" && viz.layerName) {
    entry.layerNames = entry.layerNames ? [...entry.layerNames, viz.layerName] : [viz.layerName];
  }
}
