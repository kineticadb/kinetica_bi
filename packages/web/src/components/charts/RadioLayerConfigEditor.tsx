/**
 * Phase 60.1 Plan 03 — RadioLayerConfigEditor (FULL-FORM SIDE-BY-SIDE)
 *
 * Replaces the narrow first-cut editor (render-mode <select> + standalone CbConfigForm)
 * with the FULL KineticaWmsLayerForm, embedded directly.
 *
 * Design (LOCKED by operator review, Phase 60.1 RE-SCOPE):
 *   - Seeds the form from option.action.configPatch via snapshotToLayerForm (adapter from Plan 01)
 *   - Every edit writes a full-config snapshot back via layerFormToSnapshot (adapter from Plan 01)
 *   - DATA SOURCE auto-hides: do NOT pass layer/onDataSourceChange (form returns null for that section)
 *   - SPATIAL MODE suppressed: pass hideSpatialMode={true}
 *   - INFO POPUP wired: infoEnabled / infoColumns / infoTemplate + onChangeInfoConfig
 *   - MERGE semantics: non-surfaced keys (e.g. track_config) preserved via the adapter's pass-through
 *
 * Prop surface is UNCHANGED from the first-cut (the panel passes the same set):
 *   configPatch, columns, schema, tableName, tableRef, autoSuggestDisabledReason, onChange, onCbValid, idx
 *
 * onChange now emits a FULL snapshot (via layerFormToSnapshot), not just a 4-field allow-listed subset.
 * The panel MERGES it onto option.action.configPatch using { ...option.action.configPatch, ...nextPatch }.
 * The snapshot adapter (layerFormToSnapshot) already strips data-binding/spatial/meta keys (SC2).
 *
 * INFINITE-RENDER PITFALL (DO NOT REPEAT): Do NOT call onChange/onCbValid in the render body.
 * The form's onChange / onChangeInfoConfig / isValid are event-driven. Compute formConfig + info
 * once per render from props (pure); the form owns its own effects. Mirrors LayersModal.tsx.
 */

import KineticaWmsLayerForm from "./KineticaWmsLayerForm";
import {
  snapshotToLayerForm,
  layerFormToSnapshot,
} from "../../lib/radioGroupLayerPatch";
import type { Column } from "../../lib/columnTypes";

// ---------------------------------------------------------------------------
// Props — UNCHANGED from first-cut; panel passes the same set
// ---------------------------------------------------------------------------

type RadioLayerConfigEditorProps = {
  /** The option's full-config snapshot (configPatch) — may carry any style/info keys */
  configPatch: Record<string, unknown>;
  /**
   * The target layer's CURRENT config as a flat baseline snapshot. The form is seeded from
   * `{ ...baseSnapshot, ...configPatch }` so it OPENS reflecting the layer's real appearance
   * (render-mode radio checked, params populated) even when the option's snapshot is still
   * empty. configPatch (the option's own overrides) always wins. Defaults to {}.
   */
  baseSnapshot?: Record<string, unknown>;
  columns: Column[];
  schema?: string;
  tableName?: string;
  tableRef?: string;
  autoSuggestDisabledReason?: string;
  /**
   * Emits a FULL layer-appearance snapshot (via layerFormToSnapshot).
   * The panel merges it onto option.action.configPatch.
   */
  onChange: (nextPatch: Record<string, unknown>) => void;
  /** CbConfigForm validity callback — forwarded to KineticaWmsLayerForm.isValid */
  onCbValid?: (valid: boolean) => void;
  /** For stable aria-labels / data-testids */
  idx: number;
};

// ---------------------------------------------------------------------------
// RadioLayerConfigEditor
// ---------------------------------------------------------------------------

export default function RadioLayerConfigEditor({
  configPatch,
  baseSnapshot = {},
  columns,
  schema,
  tableName,
  tableRef,
  autoSuggestDisabledReason,
  onChange,
  onCbValid,
  idx,
}: RadioLayerConfigEditorProps): JSX.Element {
  // 1. Seed the full form from the target layer's CURRENT config (baseSnapshot) with the
  //    option's own snapshot (configPatch) merged ON TOP. This makes the form open reflecting
  //    the layer's real appearance — render-mode radio checked, params populated — instead of
  //    blank when the option hasn't captured anything yet. configPatch keys win over baseline.
  //    snapshotToLayerForm lifts cb_config/track_config INTO formConfig and surfaces info_* separately.
  const { config: formConfig, info } = snapshotToLayerForm({
    ...baseSnapshot,
    ...configPatch,
  });

  // 2. Render the FULL form.
  //    - hideSpatialMode={true}: suppresses SPATIAL MODE radios + column pickers
  //    - No layer / onDataSourceChange: DATA SOURCE section auto-hides (form returns null at ~line 468)
  //    - INFO POPUP wired via infoEnabled/infoColumns/infoTemplate + onChangeInfoConfig
  //    - onChange writes a full snapshot via layerFormToSnapshot (strips data-binding/meta keys)
  //    - onChangeInfoConfig folds the info patch into the current info to produce a full snapshot
  return (
    <div
      data-testid={`radio-layer-form-${idx}`}
      className="radiogroup-layer-form"
    >
      <KineticaWmsLayerForm
        config={formConfig}
        columns={columns}
        onChange={(nextFormConfig) =>
          onChange(layerFormToSnapshot(nextFormConfig, info))
        }
        isValid={onCbValid}
        infoEnabled={(info.info_enabled as number | undefined) ?? 1}
        infoColumns={(info.info_columns as string | null | undefined) ?? null}
        infoTemplate={(info.info_template as string | null | undefined) ?? null}
        onChangeInfoConfig={(patch) =>
          onChange(layerFormToSnapshot(formConfig, { ...info, ...patch }))
        }
        hideSpatialMode={true}
        // DATA SOURCE deliberately omitted — do NOT pass layer / onDataSourceChange / associatedTables.
        // The form's renderDataSourcePicker returns null when those are absent (~line 468).
        // Phase 60.2 follow-up: forward the panel-resolved table context EXPLICITLY so
        // CbConfigForm's distinct-count probe + quantile auto-suggest hit the real table.
        // Without these, the form (which has no `layer`) derives no table → CbConfigForm
        // queries `FROM unknown` (distinct-count fails) and quantile auto-suggest returns 0.
        cbSchema={schema}
        cbTableName={tableName}
        cbTableRef={tableRef}
        cbAutoSuggestDisabledReason={autoSuggestDisabledReason}
      />
    </div>
  );
}
