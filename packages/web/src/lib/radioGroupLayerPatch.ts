/**
 * Phase 60.1 Plan 01 (RE-SCOPE) — Bidirectional adapter between:
 *   (a) The FULL layer-config SNAPSHOT (option.action.configPatch for a layer target), and
 *   (b) The inputs KineticaWmsLayerForm needs (config blob + separate info_* props).
 *
 * === SNAPSHOT SHAPE ===
 *   { renderMode, colormap, BLUR_RADIUS, ..., name, minZoom, maxZoom, opacity, visible,
 *     cb_config: "{...}", track_config: "{...}",          // TOP-LEVEL JSON strings
 *     info_enabled: 1, info_columns: "[...]", info_template: "..." }  // TOP-LEVEL info_*
 *
 * === cb_config / track_config placement ===
 *   In the SNAPSHOT (DTO-like): cb_config / track_config are SIBLINGS of renderMode (flat).
 *   In the FORM BLOB: cb_config / track_config are also INSIDE the blob (same key name).
 *   LayersModal.tsx (~line 557-574) uses this same lift/split: it merges { ...layer.config,
 *   cb_config, track_config } into the config prop and on change splits them back out.
 *   This adapter mirrors that precedent exactly.
 *
 * === MapChartRenderer effectiveLayers split (canonical, DO NOT diverge) ===
 *   const { config: cfgPatch, ...topLevel } = ov;   // (~line 482)
 *   return cfgPatch ? { ...l, ...topLevel, config: { ...l.config, ...cfgPatch } } : { ...l, ...topLevel };
 *   The OVERLAY stored in widgetActionStore.layerOverrides is DTO-shaped:
 *     { config: { renderMode, colormap, ... }, cb_config, track_config, info_enabled, ... }
 *   Plan 02's engine produces that DTO-shaped overlay. THIS adapter is for the FORM side.
 *
 * === Data-binding / spatial key stripping (SC2) ===
 *   Keys in DATA_BINDING_KEYS (table_id/dynamic_view_id/spatialMode/lat+lon+wkt+wkbColumn/
 *   track spatial cols) and PERMANENTLY_BLOCKED_KEYS (id/type/__proto__/...) are STRIPPED
 *   from both directions. Output of layerFormToSnapshot always passes validateLayerSnapshot.
 *
 * === info_* fields ===
 *   info_enabled / info_columns / info_template are TOP-LEVEL DashboardLayerDto fields
 *   (NOT in the config blob). snapshotToLayerForm surfaces them in a separate `info` return
 *   value for the form's infoEnabled/infoColumns/infoTemplate props. layerFormToSnapshot
 *   folds them back to flat top-level.
 *
 * Pure module — NO React, NO Zustand, NO filter-store imports.
 */

import { DATA_BINDING_KEYS, PERMANENTLY_BLOCKED_KEYS } from "./actionAllowList";

// Re-export DATA_BINDING_KEYS so the spec (and other modules) can import from this module.
export { DATA_BINDING_KEYS } from "./actionAllowList";

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** info_* fields live at the snapshot top-level; the form surfaces them as separate props. */
const INFO_FIELDS = ["info_enabled", "info_columns", "info_template"] as const;

/**
 * Keys stripped from form config → snapshot and from snapshot → form config.
 * Includes data-binding/spatial, permanently-blocked meta/proto, and info_*
 * (info_* ride separate props, never in the form's config blob).
 */
const STRIP = new Set<string>([
  ...(DATA_BINDING_KEYS as readonly string[]),
  ...(PERMANENTLY_BLOCKED_KEYS as readonly string[]),
  ...INFO_FIELDS,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayerSnapshot = Record<string, unknown>;
export type InfoPatch = {
  info_enabled?: number;
  info_columns?: string | null;
  info_template?: string | null;
};

// ---------------------------------------------------------------------------
// Full-snapshot bidirectional adapter (60.1 RE-SCOPE)
// ---------------------------------------------------------------------------

/**
 * Snapshot → the inputs KineticaWmsLayerForm needs:
 *   - config: ONE blob with renderMode + ALL style keys + cb_config + track_config (lifted IN),
 *     data-binding/spatial/meta keys STRIPPED, info_* removed.
 *   - info: the top-level info_* fields surfaced for the form's
 *     infoEnabled / infoColumns / infoTemplate props.
 *
 * Mirrors the LayersModal.tsx lift (line 557-574):
 *   config={{ ...layer.config, cb_config: layer.cb_config, track_config: layer.track_config }}
 *
 * Defensive: stray data-binding/spatial/meta keys in the snapshot are silently stripped.
 */
export function snapshotToLayerForm(snapshot: LayerSnapshot): {
  config: Record<string, unknown>;
  info: InfoPatch;
} {
  const config: Record<string, unknown> = {};
  const info: InfoPatch = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if ((INFO_FIELDS as readonly string[]).includes(k)) {
      // info_* → surfaced as separate props
      (info as Record<string, unknown>)[k] = v;
    } else if (STRIP.has(k)) {
      // data-binding/meta stripped defensively
      continue;
    } else {
      // renderMode + style keys + cb_config + track_config lifted into the blob
      config[k] = v;
    }
  }
  return { config, info };
}

/**
 * Form config blob (+ the info patch) → a FLAT layer-appearance snapshot.
 *
 * cb_config / track_config stay TOP-LEVEL siblings of renderMode in the output
 * (they are already at the form-blob top level — LayersModal injects them there;
 * Plan 02's engine will split the stored DTO-shaped overlay at apply time).
 *
 * Data-binding/spatial + meta keys are STRIPPED (SC2).
 * info_* fold to flat top-level from the separate infoPatch argument.
 * Output is guaranteed to pass validateLayerSnapshot.
 */
export function layerFormToSnapshot(
  formConfig: Record<string, unknown>,
  infoPatch: InfoPatch = {},
): LayerSnapshot {
  const out: LayerSnapshot = {};
  for (const [k, v] of Object.entries(formConfig)) {
    if (STRIP.has(k)) continue; // strip data-binding/meta (+ stray info_*)
    out[k] = v; // renderMode + style + cb_config + track_config (all top-level)
  }
  for (const f of INFO_FIELDS) {
    if (infoPatch[f as keyof InfoPatch] !== undefined) {
      out[f] = infoPatch[f as keyof InfoPatch];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Surfaced fields (first-cut / back-compat)
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
