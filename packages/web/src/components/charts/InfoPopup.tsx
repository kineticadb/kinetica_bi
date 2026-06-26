/**
 * Phase 21 (POPUP-V14-02..05) / Phase 23 P01 / Phase 23 P03 — Map info popup chrome wrapper.
 *
 * SCOPE: Chrome only — anchored container, close X, ESC handler, click-outside backdrop.
 * Body presentation (dropdown header + records list + Load more + cross-phase column
 * sort + auto-eligibility-leave) lives in <InfoSelectionView /> (Phase 23 P01 Task 2).
 *
 * Plan 23-03 (Task 1): the popup wrapper DROPPED its dropdown-switch + Load-more
 * callback props — those handlers now live INSIDE <InfoSelectionView /> and replay
 * coords from `useLastInfoClickContextStore`. Both popup and card share the same
 * fetch path. Caller (MapChartRenderer) only supplies `resolveTable` (table_id ->
 * schema/name) and `onClose` (dismiss). The view internally calls `infoQuery`
 * with replayed context, so the popup wrapper no longer needs map-coord access
 * for those flows.
 *
 * MOUNTING: This component is mounted inside an `ol/Overlay` element by Plan 21-03
 * MapChartRenderer. The popup container DOM lives outside React's normal tree (OL
 * imperatively appends the element ref to its DOM). Because of that, ESC handler
 * uses `window.addEventListener("keydown")` (mirrors LayersModal:71-77).
 *
 * STORE SELECTOR (PITFALL S-02 lock from Phase 12+):
 *   - activeLayerId only — used to (a) suppress chrome render when nothing selected
 *     and (b) drive ESC handler dep array. Body-level state subscriptions live in
 *     <InfoSelectionView />.
 */
import { useEffect } from "react";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import InfoSelectionView from "./InfoSelectionView";
import type { DashboardLayerDto } from "../../api/client";

type Props = {
  /** Visible-enabled-non-WKB layers — derived by parent (Plan 21-03 MapChartRenderer eligibleLayers useMemo). Stable order by ascending position. */
  eligibleLayers: DashboardLayerDto[];
  /** Display-name resolver for dropdown options. Caller maps tableId → schema.name (mirrors LayersModal:82-99). */
  layerNameFor: (layer: DashboardLayerDto) => string;
  /** Plan 23-03 Task 1: caller resolves layer.table_id → { schema, name } so <InfoSelectionView />
   *  can build infoQuery payloads internally. Returns null when the table is not found in tables prop. */
  resolveTable: (tableId: number) => { schema: string; name: string } | null;
  /** Dismiss — close X, ESC, click-outside, active-layer-leaves-set. Caller invokes useInfoSelectionStore.getState().reset() + Overlay.setPosition(undefined). */
  onClose: () => void;
  /** Popup-only dimensions (px). Card sizes itself via the dashboard widget grid; these props
   *  don't apply there. Caller (MapChartRenderer) resolves defaults via getInfoPopupWidthPx /
   *  getInfoPopupHeightPx so legacy widgets without these fields use the pre-config baseline. */
  widthPx: number;
  heightPx: number;
};

export default function InfoPopup({ eligibleLayers, layerNameFor, resolveTable, onClose, widthPx, heightPx }: Props) {
  // PITFALL S-02 lock: scoped selector — NEVER s.state whole.
  // Used here only for chrome-render suppression + ESC dep array.
  const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);

  // ESC key dismiss — mirrors LayersModal.tsx:71-77.
  useEffect(() => {
    if (activeLayerId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeLayerId, onClose]);

  // Suppress popup chrome entirely when nothing is selected.
  if (activeLayerId === null) return null;

  // Click-outside dismiss: backdrop div onClick → onClose; popup body stops propagation.
  // Mirrors LayersModal.tsx:168 pattern.
  return (
    <div className="info-popup-backdrop" onClick={onClose}>
      <div
        className="info-popup"
        onClick={(e) => e.stopPropagation()}
        style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
      >
        <InfoSelectionView
          eligibleLayers={eligibleLayers}
          layerNameFor={layerNameFor}
          resolveTable={resolveTable}
          emptyStateCopy="No records"
          onActiveLayerIneligible={onClose}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
