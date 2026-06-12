/**
 * Phase 60.1 Plan 01 — Bidirectional adapter: flat allow-listed configPatch ↔ CbConfigForm config blob.
 *
 * This module is the bridge between the FLAT radio-option configPatch (as captured by
 * captureAllowListedSubset / stored in RadioOption.action.configPatch) and the config-blob
 * shape that CbConfigForm + the render-mode picker expect.
 *
 * The cb_config "location move" (placement, NOT a rename):
 *   In the flat patch:  { cb_config: "...", renderMode: "classbreak", visible: true, opacity: 0.8 }
 *                        └── cb_config is a TOP-LEVEL key (allow-list location "layer")
 *   In the form blob:   { cb_config: "...", renderMode: "classbreak", visible: true, opacity: 0.8 }
 *                        └── cb_config is INSIDE the config blob (CbConfigForm reads config.cb_config)
 *   Because the key name is the same on both sides, the adapter simply filters the four
 *   surfaced fields into/out of the config blob using the same key names.
 *
 * Canonical split contract (DO NOT diverge):
 *   MapChartRenderer.effectiveLayers (~line 482): const { config: cfgPatch, ...topLevel } = ov
 *   widgetActionStore.deriveOverlays (~line 179): const { config: patchConfig, ...patchTopLevel } = patch
 * Both treat cb_config as TOP-LEVEL in the overlay and renderMode/visible/opacity as config-nested.
 * The FORM, however, edits everything inside one flat config blob — this adapter bridges the two.
 *
 * Pure module — NO React, NO Zustand, NO filter-store imports.
 * Mirrors the lib/radioGroupCapture.ts helper-module style.
 */

// ---------------------------------------------------------------------------
// Surfaced fields
// ---------------------------------------------------------------------------

/**
 * The allow-listed layer fields the STRUCTURED editor surfaces.
 * `track_config` is intentionally EXCLUDED — out of scope for the structured editor
 * (Advanced JSON only). `cb_config` lives top-level in the flat patch and under the
 * same key name inside the form blob; `renderMode`/`visible`/`opacity` are flat keys
 * in the patch and flat keys in the form blob too.
 */
export const LAYER_FORM_PATCH_FIELDS = ["renderMode", "cb_config", "visible", "opacity"] as const;

// ---------------------------------------------------------------------------
// patchToLayerFormConfig
// ---------------------------------------------------------------------------

/**
 * Flat allow-listed configPatch → the config-blob CbConfigForm + render-mode picker edit.
 *
 * Lifts ALL surfaced fields into one object (CbConfigForm reads config.cb_config when
 * the returned object is passed as its `config` prop; renderMode/visible/opacity are
 * flat keys on the same blob).
 *
 * Only LAYER_FORM_PATCH_FIELDS cross — any other key (track_config, junk, meta) is dropped.
 *
 * @param configPatch - The flat allow-listed configPatch from RadioOption.action.configPatch
 * @returns A config blob suitable for passing to CbConfigForm as `config`
 */
export function patchToLayerFormConfig(
  configPatch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of LAYER_FORM_PATCH_FIELDS) {
    if (configPatch[f] !== undefined) out[f] = configPatch[f];
  }
  return out;
}

// ---------------------------------------------------------------------------
// layerFormConfigToPatch
// ---------------------------------------------------------------------------

/**
 * The config-blob the form emits (which may carry arbitrary extra keys from CbConfigForm
 * or the wider form state) → flat allow-listed configPatch.
 *
 * Extracts ONLY LAYER_FORM_PATCH_FIELDS back to flat top-level keys.
 * This is the SAFETY boundary (SC2): no out-of-list key can reach the configPatch.
 * The resulting patch passes `validateActionPatch("layer", undefined, patch)` unchanged.
 *
 * Keys absent from the form blob are omitted from the patch (not set to undefined).
 *
 * @param formConfig - The config blob emitted by CbConfigForm's onChange (or the form state)
 * @returns A flat allow-listed configPatch ready for RadioOption.action.configPatch
 */
export function layerFormConfigToPatch(
  formConfig: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of LAYER_FORM_PATCH_FIELDS) {
    if (formConfig[f] !== undefined) out[f] = formConfig[f];
  }
  return out;
}
