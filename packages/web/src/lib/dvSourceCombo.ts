import { stableComboHash, NOFILTER_SENTINEL } from "./stableComboHash";
import type { ActiveFilter } from "../store/filterStore";

/**
 * The ONE definition of which filter combination a dynamic view reads: all active
 * column filters on the dv's source table (a dv row has no filter scope of its own).
 *
 * - useCombinationOrchestrator materializes + ref-counts this combination under vizKey `dv:<id>`.
 * - useDynamicViewMaterializeChain and DynamicViewsModal send it as `combination_key`
 *   so the server probes the matching `_c<hash8>` filter view.
 * - It equals the orchestrator's per-table ceiling-fallback hash by construction, so the
 *   ceiling can never orphan it.
 *
 * Spatial shapes are excluded on purpose (column-only, matching the existing dv path).
 * Returns undefined when there are no filters (NOFILTER).
 */
export function dvSourceComboHash(
  sourceTableId: number,
  filters: ActiveFilter[] | undefined,
): string | undefined {
  const hash = stableComboHash("table", sourceTableId, filters ?? []);
  return hash.endsWith(`:${NOFILTER_SENTINEL}`) ? undefined : hash;
}
