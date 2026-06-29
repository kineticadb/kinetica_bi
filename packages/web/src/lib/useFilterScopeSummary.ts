/**
 * Phase 95 (COMM-V118-01): On-widget filter scope summary.
 *
 * Pure helper `computeFilterScopeSummary` + thin React hook `useFilterScopeSummary`.
 *
 * Design decisions (locked in 95-01-PLAN.md):
 *   - Badge data is computed LOCALLY — do NOT read filterCombinationStore here.
 *   - REUSE resolveFilterSet (Phase 88) + resolveSpatialShapes (Phase 93.5); never reimplement.
 *   - Shapes only participate for spatial-capable table-bound widgets (spatialCapable===true).
 *   - dv-bound: activeShapes=[] and spatialCapable=false are FORCED (dv+spatial deferred).
 *   - Hook: SCOPED primitive-stable selectors (PITFALL S-02): read version integers for
 *     re-render triggers; read arrays via getState() inside useMemo.
 */

import { useMemo } from "react";
import { resolveFilterSet } from "./resolveFilterSet";
import { resolveSpatialShapes } from "./resolveSpatialShapes";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useAuthStore } from "../store/auth";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IgnoredItem =
  | { kind: "filter"; filter: ActiveFilter; reason: "source excluded" }
  | { kind: "shape"; shape: Shape; reason: "source excluded" };

export type FilterScopeSummary = {
  appliedCount: number;   // N — badge label LHS
  totalCount: number;     // M — badge label RHS (includes spatial for spatial-capable table-bound)
  applied: { filters: ActiveFilter[]; shapes: Shape[] };
  ignored: IgnoredItem[];
};

// ─── Pure Function ────────────────────────────────────────────────────────────

/**
 * Pure fn — testable without React or stores.
 * REUSES resolveFilterSet + resolveSpatialShapes (no reimplementation of resolve logic).
 * Never mutates inputs.
 */
export function computeFilterScopeSummary(args: {
  cfg: FilterSelectionConfig | undefined;
  activeFilters: ActiveFilter[];   // filters[tableId] for table-bound; dvFilters[dvId] for dv-bound
  activeShapes: Shape[];            // spatial draws; pass [] for dv-bound or non-spatial-capable
  spatialCapable: boolean;          // true only for table-bound widget with an eligible SpatialTarget
}): FilterScopeSummary {
  const { cfg, activeFilters, activeShapes, spatialCapable } = args;

  // 1. Resolve column filters (REUSE Phase 88 resolver)
  const appliedFilters = resolveFilterSet(cfg, activeFilters);
  const ignoredFilters: IgnoredItem[] = activeFilters
    .filter((f) => !appliedFilters.includes(f))
    .map((f) => ({ kind: "filter" as const, filter: f, reason: "source excluded" as const }));

  // 2. Resolve spatial shapes (REUSE Phase 93.5 resolver — only when spatialCapable)
  const effShapes = spatialCapable ? activeShapes : [];
  const appliedShapes = resolveSpatialShapes(cfg, effShapes);
  const ignoredShapes: IgnoredItem[] = effShapes
    .filter((s) => !appliedShapes.includes(s))
    .map((s) => ({ kind: "shape" as const, shape: s, reason: "source excluded" as const }));

  // 3. Aggregate
  const totalCount = activeFilters.length + effShapes.length;
  const appliedCount = appliedFilters.length + appliedShapes.length;
  const applied = { filters: appliedFilters, shapes: appliedShapes };
  const ignored: IgnoredItem[] = [...ignoredFilters, ...ignoredShapes];

  return { appliedCount, totalCount, applied, ignored };
}

// ─── React Hook ──────────────────────────────────────────────────────────────

/**
 * Thin hook that wires live store reads with SCOPED primitive-stable selectors (PITFALL S-02).
 * Version integers drive re-renders; arrays are read via getState() inside useMemo.
 */
export function useFilterScopeSummary(args: {
  cfg: FilterSelectionConfig | undefined;
  tableId: number | undefined;        // table-bound source
  dynamicViewId: number | undefined;  // dv-bound source (mutually exclusive with tableId)
  spatialCapable: boolean;            // true only for table-bound widget with an eligible SpatialTarget
}): FilterScopeSummary {
  const { cfg, tableId, dynamicViewId, spatialCapable } = args;

  // SCOPED primitive selectors to drive re-renders on mutation (PITFALL S-02)
  const filterVersion = useFilterStore((s) => s.filterVersion);
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
  // GAP 3 / Test 7: when dvFilterScopeDisabled is set, dv-bound sources revert to accept-all
  // (saved filterSelection is ignored → no badge/indicator for dv widgets/layers).
  const dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled);

  return useMemo(() => {
    const filterState = useFilterStore.getState();
    const spatialState = useSpatialFilterStore.getState();

    // dv-bound: force spatialCapable=false (dv+spatial deferred); no shapes
    const isDv = dynamicViewId !== undefined;
    const effectiveSpatialCapable = isDv ? false : spatialCapable;

    let activeFilters: ActiveFilter[];
    if (isDv) {
      activeFilters = filterState.dvFilters[dynamicViewId] ?? [];
    } else {
      activeFilters = tableId !== undefined ? (filterState.filters[tableId] ?? []) : [];
    }

    const activeShapes = effectiveSpatialCapable ? spatialState.shapes : [];

    // GAP 3 / Test 7: dv-bound + dvFilterScopeDisabled → pass cfg=undefined (accept-all).
    // Table-bound sources are never affected by this flag.
    const effectiveCfg = isDv && dvFilterScopeDisabled ? undefined : cfg;

    return computeFilterScopeSummary({
      cfg: effectiveCfg,
      activeFilters,
      activeShapes,
      spatialCapable: effectiveSpatialCapable,
    });
  }, [cfg, tableId, dynamicViewId, spatialCapable, filterVersion, spatialFilterVersion, dvFilterScopeDisabled]);
}
