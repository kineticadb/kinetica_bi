/**
 * Phase 60.1 Plan 02 — RadioLayerConfigEditor
 *
 * A CONTROLLED subcomponent rendered inside OptionRow when
 * option.action.target.kind === "layer".
 *
 * Surfaces:
 *   - A render-mode <select> (raster / heatmap / classbreak / contour)
 *   - For classbreak: the reusable CbConfigForm break builder
 *
 * Reads via patchToLayerFormConfig; writes via layerFormConfigToPatch.
 * ALL field writes are routed through the adapter — no out-of-list keys ever
 * reach the configPatch (SC2 safety boundary).
 *
 * CbConfigForm validity (zero breaks = invalid) surfaces via the onCbValid
 * callback (CONTEXT line 50, LOCKED). Non-classbreak modes reset to valid.
 *
 * Do NOT embed KineticaWmsLayerForm. Allow-listed fields only:
 *   renderMode / cb_config / visible / opacity
 */

import { useEffect } from "react";
import type { Column } from "../../lib/columnTypes";
import CbConfigForm from "./CbConfigForm";
import {
  patchToLayerFormConfig,
  layerFormConfigToPatch,
} from "../../lib/radioGroupLayerPatch";

// ---------------------------------------------------------------------------
// Local render-mode constants (mirrored from KineticaWmsLayerForm — not exported there)
// ---------------------------------------------------------------------------

type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";

const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  raster: "Raster (point markers)",
  heatmap: "Heatmap (density)",
  classbreak: "Classbreak (categorical)",
  contour: "Contour (lines)",
};

const ALL_RENDER_MODES: RenderMode[] = ["raster", "heatmap", "classbreak", "contour"];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type RadioLayerConfigEditorProps = {
  /** The option's FLAT allow-listed configPatch */
  configPatch: Record<string, unknown>;
  columns: Column[];
  schema?: string;
  tableName?: string;
  tableRef?: string;
  autoSuggestDisabledReason?: string;
  /** Emits a FLAT allow-listed patch (only LAYER_FORM_PATCH_FIELDS keys) */
  onChange: (nextPatch: Record<string, unknown>) => void;
  /** CbConfigForm validity — only meaningful in classbreak mode; non-classbreak always valid */
  onCbValid?: (valid: boolean) => void;
  /** For stable aria-labels / data-testids */
  idx: number;
};

// ---------------------------------------------------------------------------
// RadioLayerConfigEditor
// ---------------------------------------------------------------------------

export default function RadioLayerConfigEditor({
  configPatch,
  columns,
  schema,
  tableName,
  tableRef,
  autoSuggestDisabledReason,
  onChange,
  onCbValid,
  idx,
}: RadioLayerConfigEditorProps): JSX.Element {
  // Lift the flat patch into the form-blob CbConfigForm expects
  const formConfig = patchToLayerFormConfig(configPatch);
  const renderMode = (formConfig.renderMode as string) ?? "raster";

  // When the render mode is NOT classbreak, signal valid so the option is
  // never left stuck-invalid after switching away from classbreak (CONTEXT line 50).
  useEffect(() => {
    if (renderMode !== "classbreak") {
      onCbValid?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMode]);

  const handleRenderModeChange = (newMode: string) => {
    const next = layerFormConfigToPatch({ ...formConfig, renderMode: newMode });
    onChange(next);
  };

  const handleCbFormChange = (nextFormConfig: Record<string, unknown>) => {
    onChange(layerFormConfigToPatch(nextFormConfig));
  };

  return (
    <div className="radio-layer-config-editor" style={{ marginBottom: 8 }}>
      {/* Render-mode select */}
      <div className="ds-field" style={{ marginBottom: 8 }}>
        <span className="ds-field-label config-group-label" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>
          RENDER MODE
        </span>
        <select
          className="ds-select"
          aria-label={`Option ${idx + 1} render mode`}
          data-testid={`radio-layer-rendermode-${idx}`}
          value={renderMode}
          onChange={(e) => handleRenderModeChange(e.target.value)}
          style={{ width: "100%" }}
        >
          {ALL_RENDER_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {RENDER_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      {/* CbConfigForm — only when classbreak is selected */}
      {renderMode === "classbreak" && (
        <div
          data-testid={`radio-layer-cbform-${idx}`}
          style={{
            border: "1px solid var(--border-color, #3a3a4a)",
            borderRadius: 4,
            padding: "8px 10px",
            marginBottom: 4,
          }}
        >
          <CbConfigForm
            config={formConfig}
            columns={columns}
            schema={schema}
            tableName={tableName}
            tableRef={tableRef}
            autoSuggestDisabledReason={autoSuggestDisabledReason}
            onChange={handleCbFormChange}
            isValid={onCbValid}
          />
        </div>
      )}
    </div>
  );
}
