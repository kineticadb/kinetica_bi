import { useMemo } from "react";
import { useFilterCombinationStore } from "../store/filterCombinationStore";

/**
 * Phase 16 (MAP-V13-04 / default per 16-CONTEXT § "Filtering...
 * badge on map widgets"): "Filtering..." badge for map widgets whose included layers
 * collectively span tableIds where ANY entry is currently materializing.
 *
 * Mirrors Phase 15 FilteringBadge component but with any-of-N-tableIds semantics:
 * a single badge in the widget card header (NOT per-layer), driven by ANY included
 * layer's tableId having materializing=true. Matches Phase 15 chart-widget chrome
 * for UX parity.
 *
 * PITFALL C-02 lock: selector returns a primitive boolean (Zustand short-circuits on
 * shallow equality of returned value). Caller must memoize tableIds (array identity
 * stability) to avoid spurious selector re-runs — done here via useMemo on the input
 * array's stringified content.
 *
 * Layout: identical to FilteringBadge (inline next to widget title; small spinner +
 * "Filtering..." text; no threshold; appears on markMaterializing, disappears on
 * setView/clearView/error).
 */

export const MapFilteringBadge = ({ tableIds }: { tableIds: number[] }) => {
  // Memoize tableIds by content for selector stability (PITFALL C-02 / PT16-B lock).
  // Sort + join to produce a content-stable key; same set of tableIds in a different
  // order will produce the same memo.
  const tableIdsKey = useMemo(
    () => [...tableIds].sort((a, b) => a - b).join(","),
    [tableIds],
  );

  // Phase 96-01 GAP fix: read the combination store (sourceType "table" combos) instead of the
  // legacy filterViewStore — same migration as FilteringBadge. ANY table-combo whose sourceId is
  // one of the map's included tableIds and is materializing → show the badge.
  const anyMaterializing = useFilterCombinationStore((s) => {
    if (tableIdsKey === "") return false;
    const ids = new Set(tableIdsKey.split(",").map(Number));
    for (const hash in s.registry) {
      const e = s.registry[hash];
      if (e.sourceType === "table" && ids.has(e.sourceId) && e.materializing) return true;
    }
    return false;
  });

  if (!anyMaterializing) return null;
  return (
    <span className="widget-filtering-badge">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>Filtering...</span>
    </span>
  );
};
