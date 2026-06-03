/**
 * Phase 29 (DRAW-V15-01): MapDrawToolbar — React-rendered absolutely-positioned overlay
 * with 5 mutually-exclusive mode buttons (Pan / Info / Bbox / Lasso / Circle) and a
 * conditional Trash "Clear all" button.
 *
 * Anti-pattern lock (29-CONTEXT.md / STATE.md): NEVER subclass ol/control/Control.
 * Root-cause family of GAP-24-01-A / GAP-24-02-A. This is a pure React component;
 * positioning is via CSS, pointer-events: none on container + pointer-events: auto
 * on buttons (V15-P-17 mitigation).
 *
 * Stateless — receives drawMode + shapesCount via props; emits onModeChange + onClearAll.
 * All state lives in MapChartRenderer (Plans 01 + 03).
 *
 * Re-click already-active button = no-op (29-CONTEXT.md operator lock).
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHand,
  faCircleInfo,
  faCropSimple,
  faDrawPolygon,
  faCircle,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
// Note: faVectorSquare is not in @fortawesome/free-solid-svg-icons at this version.
// Using faCropSimple (rectangular crop/selection) as semantic equivalent for bbox drawing.
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { DrawMode } from "../../lib/shapeDraw";

type Props = {
  drawMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  shapesCount: number;
  onClearAll: () => void;
  // Eligible spatial-target table names (e.g. ["demo.nyctaxi", "demo.zones"]) — used by
  // the bbox/lasso/circle buttons' hover tooltip so the user knows BEFORE drawing whether
  // their shape will actually filter anything. Empty array → action-oriented warning.
  eligibleTargetTableNames: string[];
};

// Bbox/lasso/circle buttons get the spatial-target tooltip; pan/info do not (mode-only).
const DRAWING_MODES = new Set<DrawMode>(["bbox", "lasso", "circle"]);

// Render order locked by 29-UI-SPEC.md Component Inventory.
const MODE_BUTTONS: Array<{ mode: DrawMode; icon: IconDefinition; label: string }> = [
  { mode: "pan",    icon: faHand,         label: "Pan" },
  { mode: "info",   icon: faCircleInfo,   label: "Info" },
  { mode: "bbox",   icon: faCropSimple,   label: "Draw bounding box" },
  { mode: "lasso",  icon: faDrawPolygon,  label: "Draw lasso" },
  { mode: "circle", icon: faCircle,       label: "Draw circle" },
];

function buildTargetsTooltip(names: string[]): string {
  return names.length === 0
    ? "No tables configured — add targets in widget config to filter on draw."
    : `Filters: ${names.join(", ")}`;
}

export default function MapDrawToolbar({
  drawMode,
  onModeChange,
  shapesCount,
  onClearAll,
  eligibleTargetTableNames,
}: Props) {
  const targetsTooltip = buildTargetsTooltip(eligibleTargetTableNames);
  // Bbox/lasso/circle are disabled when this map has no eligible spatial targets —
  // drawing a shape would silently produce no chip and no materialize (orphan-shape UX).
  // The button stays focusable so the title-attribute tooltip still surfaces on hover.
  const drawingDisabled = eligibleTargetTableNames.length === 0;
  return (
    <div className="map-draw-toolbar" role="toolbar" aria-label="Drawing tools">
      {MODE_BUTTONS.map(({ mode, icon, label }) => {
        const isActive = drawMode === mode;
        const isDrawing = DRAWING_MODES.has(mode);
        const disabled = isDrawing && drawingDisabled;
        return (
          <button
            key={mode}
            type="button"
            className={`map-draw-toolbar-btn${isActive ? " is-active" : ""}`}
            aria-label={label}
            aria-pressed={isActive}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={isDrawing ? targetsTooltip : undefined}
            onClick={() => {
              // 29-CONTEXT.md re-click lock: clicking the already-active mode is a no-op.
              if (isActive) return;
              onModeChange(mode);
            }}
          >
            <FontAwesomeIcon icon={icon} />
          </button>
        );
      })}
      {shapesCount > 0 && (
        <>
          <div className="map-draw-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="map-draw-toolbar-btn map-draw-toolbar-trash"
            aria-label="Clear all shapes"
            onClick={onClearAll}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </>
      )}
    </div>
  );
}
