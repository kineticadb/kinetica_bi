import { useFilterViewStore } from "../store/filterViewStore";

/**
 * Phase 15 (FILT-V13-04): "Filtering..." badge for widgets on a tableId
 * that is currently materializing a filter view.
 *
 * Subscribes to useFilterViewStore.views[tableId]?.materializing via a SCOPED
 * selector (PITFALL C-02 lock). Returns null when not materializing — caller
 * embeds <FilteringBadge tableId={cfg.tableId} /> unconditionally in the widget
 * card-header chrome; the component handles its own visibility.
 *
 * Visual layout (15-CONTEXT.md user-lock):
 *   - Inline next to widget title (margin-left: 8px in CSS)
 *   - Small spinner glyph + "Filtering..." text
 *   - No threshold / grace period — appears on markMaterializing, disappears on setView/clearView/error
 *   - Renders for EVERY widget on the filtered tableId (each widget independently subscribes)
 *   - Existing chart data stays visible underneath (badge is in card header, NOT a full overlay)
 */

export const FilteringBadge = ({ tableId }: { tableId: number | undefined }) => {
  const materializing = useFilterViewStore((s) =>
    tableId !== undefined ? s.views[tableId]?.materializing ?? false : false
  );
  if (!materializing) return null;
  return (
    <span className="widget-filtering-badge">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>Filtering...</span>
    </span>
  );
};
