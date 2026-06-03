/**
 * MapZoomToolbar — custom zoom-in / zoom-out overlay matching the MapDrawToolbar
 * styling family (`.map-draw-toolbar-btn`). Sits at top-left of the map widget,
 * above the MapDrawToolbar. Replaces the default `ol/control/Zoom` control whose
 * Bootstrap-era styling clashed visually with the Phase 29 toolbar.
 *
 * Mounted as a sibling to the OL canvas (NOT as an ol/control/Control) — same
 * V15-P-17 anti-pattern lock that MapDrawToolbar follows. Pure React; positioning
 * is via CSS; `pointer-events: none` on container + `auto` on buttons lets clicks
 * between buttons fall through to the underlying map.
 *
 * Stateless: receives onZoomIn/onZoomOut callbacks; parent (MapChartRenderer)
 * owns the OL view animate calls.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faMinus } from "@fortawesome/free-solid-svg-icons";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export default function MapZoomToolbar({ onZoomIn, onZoomOut }: Props) {
  return (
    <div className="map-zoom-toolbar" role="toolbar" aria-label="Zoom">
      <button
        type="button"
        className="map-draw-toolbar-btn"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>
      <button
        type="button"
        className="map-draw-toolbar-btn"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onZoomOut}
      >
        <FontAwesomeIcon icon={faMinus} />
      </button>
    </div>
  );
}
