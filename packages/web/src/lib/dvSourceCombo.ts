import { stableComboHash, NOFILTER_SENTINEL } from "./stableComboHash";
import { aggregateSpatialTargetsByTable } from "./spatialTargets";
import type { SpatialTarget } from "./spatialTargets";
import type { ActiveFilter } from "../store/filterStore";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { WidgetDto } from "../api/client";

/**
 * The ONE definition of which filter combination a dynamic view reads: all active
 * column filters AND spatial draws on the dv's source table (a dv row has no filter
 * scope of its own, so it accepts every draw — same as an unscoped layer).
 *
 * - useCombinationOrchestrator materializes + ref-counts this combination under vizKey `dv:<id>`.
 * - useDynamicViewMaterializeChain and DynamicViewsModal send it as `combination_key`
 *   so the server probes the matching `_c<hash8>` filter view.
 * - Column-only it equals the orchestrator's per-table ceiling-fallback hash by construction.
 *
 * Spatial shapes are folded in only when the source table has an eligible spatial target
 * (see resolveDvSourceSpatial); otherwise callers pass no shapes and it stays column-only.
 * Returns undefined when there is neither a column filter nor a shape (NOFILTER).
 */
export function dvSourceComboHash(
  sourceTableId: number,
  filters: ActiveFilter[] | undefined,
  shapes: Pick<Shape, "wkt">[] = [],
): string | undefined {
  const hash = stableComboHash("table", sourceTableId, filters ?? [], shapes);
  return hash.endsWith(`:${NOFILTER_SENTINEL}`) ? undefined : hash;
}

/**
 * Spatial part of a dv source combination: all drawn shapes + the table's eligible spatial
 * target (resolved from the dashboard's map widgets, exactly as widgets/layers do). When the
 * table has no eligible target, shapes is [] and target undefined (column-only fallback).
 */
export function resolveDvSourceSpatial(
  sourceTableId: number,
  widgets: WidgetDto[],
  allShapes: Shape[],
): { shapes: Shape[]; target: SpatialTarget | undefined } {
  const target = aggregateSpatialTargetsByTable(widgets).get(sourceTableId);
  return { shapes: target ? allShapes.slice() : [], target };
}

/** Imperative convenience for the chain + modal: current hash for a dv source table. */
export function currentDvSourceComboHash(sourceTableId: number, widgets: WidgetDto[]): string | undefined {
  const { shapes } = resolveDvSourceSpatial(sourceTableId, widgets, useSpatialFilterStore.getState().shapes);
  return dvSourceComboHash(sourceTableId, useFilterStore.getState().filters[sourceTableId], shapes);
}
