import { useFilterCombinationStore } from "../store/filterCombinationStore";

/**
 * Phase 15 (FILT-V13-04): "Filtering..." badge for widgets on a tableId
 * that is currently materializing a filter view.
 *
 * Phase 96-01 GAP fix: migrated from the legacy filterViewStore (keyed by tableId) to the
 * combination store. Since v1.18 the table-bound render path materializes per-combination
 * views in filterCombinationStore (keyed by hash), and nothing writes/clears
 * filterViewStore.views[tableId].materializing anymore — so reading it left the badge stuck
 * "Filtering..." forever once the records legacy island was removed. The badge now reflects
 * whether ANY table-combination for this tableId is currently materializing (sourceType
 * "table" && sourceId === tableId && materializing), which the orchestrator sets on dispatch
 * and clears on resolve.
 *
 * Visual layout (15-CONTEXT.md user-lock):
 *   - Inline next to widget title (margin-left: 8px in CSS)
 *   - Small spinner glyph + "Filtering..." text
 *   - No threshold / grace period — appears while a combo materializes, disappears on resolve
 *   - Renders for EVERY widget on the filtered tableId (each widget independently subscribes)
 *   - Existing chart data stays visible underneath (badge is in card header, NOT a full overlay)
 *
 * PITFALL C-02 / S-02 lock: selector returns a primitive boolean (Zustand short-circuits on
 * shallow equality), so iterating the registry here is safe.
 */

export const FilteringBadge = ({ tableId }: { tableId: number | undefined }) => {
  const materializing = useFilterCombinationStore((s) => {
    if (tableId === undefined) return false;
    for (const hash in s.registry) {
      const e = s.registry[hash];
      if (e.sourceType === "table" && e.sourceId === tableId && e.materializing) return true;
    }
    return false;
  });
  if (!materializing) return null;
  return (
    <span className="widget-filtering-badge">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>Filtering...</span>
    </span>
  );
};
