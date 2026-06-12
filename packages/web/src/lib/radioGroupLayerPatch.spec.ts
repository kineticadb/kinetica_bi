/**
 * Phase 60.1 Plan 01 — Task 1 (TDD RED)
 * Unit tests for radioGroupLayerPatch.ts — bidirectional adapter between flat allow-listed
 * configPatch and the config-blob shape CbConfigForm / render-mode picker expect.
 *
 * The cb_config "location move":
 *   - In the FLAT patch: cb_config is a TOP-LEVEL key (location "layer")
 *   - In the FORM blob: cb_config lives under the same key name inside the config blob
 *     (CbConfigForm reads/writes config.cb_config as a JSON string)
 *   Because the key NAME is the same in both sides, the adapter's job is a PLACEMENT
 *   move (sibling-of-renderMode in the blob, vs flat top-level in the patch), NOT a rename.
 *
 * References:
 *   - MapChartRenderer.effectiveLayers (~line 482): const { config: cfgPatch, ...topLevel } = ov
 *   - widgetActionStore.deriveOverlays (~line 179): const { config: patchConfig, ...patchTopLevel } = patch
 */
import { describe, it, expect } from "vitest";
import { patchToLayerFormConfig, layerFormConfigToPatch } from "./radioGroupLayerPatch";
import { validateActionPatch } from "./actionAllowList";

// ---------------------------------------------------------------------------
// patchToLayerFormConfig — flat configPatch → form config blob
// ---------------------------------------------------------------------------

describe("patchToLayerFormConfig", () => {
  it("lifts renderMode and cb_config from flat patch into the config blob", () => {
    const patch = { renderMode: "classbreak", cb_config: '{"breaks":[]}' };
    const result = patchToLayerFormConfig(patch);
    expect(result.renderMode).toBe("classbreak");
    expect(result.cb_config).toBe('{"breaks":[]}');
  });

  it("lifts visible and opacity from flat patch into the config blob", () => {
    const patch = { visible: true, opacity: 0.5 };
    const result = patchToLayerFormConfig(patch);
    expect(result.visible).toBe(true);
    expect(result.opacity).toBe(0.5);
  });

  it("drops non-allow-listed keys (track_config and foo) from the flat patch", () => {
    const patch = { renderMode: "raster", track_config: "x", foo: 1 };
    const result = patchToLayerFormConfig(patch);
    expect(result.renderMode).toBe("raster");
    expect("track_config" in result).toBe(false);
    expect("foo" in result).toBe(false);
  });

  it("returns empty object for empty patch", () => {
    const result = patchToLayerFormConfig({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// layerFormConfigToPatch — form config blob → flat allow-listed configPatch
// ---------------------------------------------------------------------------

describe("layerFormConfigToPatch", () => {
  it("extracts renderMode and cb_config from form blob back to flat patch", () => {
    const formConfig = { renderMode: "classbreak", cb_config: '{"breaks":[1]}' };
    const result = layerFormConfigToPatch(formConfig);
    expect(result.renderMode).toBe("classbreak");
    expect(result.cb_config).toBe('{"breaks":[1]}');
  });

  it("drops extra junk keys (spatialMode, lonColumn, latColumn) — safety guarantee SC2", () => {
    const formConfig = {
      renderMode: "raster",
      spatialMode: "latlon",
      lonColumn: "x",
      latColumn: "y",
    };
    const result = layerFormConfigToPatch(formConfig);
    expect(result.renderMode).toBe("raster");
    expect("spatialMode" in result).toBe(false);
    expect("lonColumn" in result).toBe(false);
    expect("latColumn" in result).toBe(false);
  });

  it("omits allow-listed keys that are absent/undefined in the form config", () => {
    // Only renderMode present — visible/opacity/cb_config must be absent (not set to undefined)
    const formConfig = { renderMode: "heatmap" };
    const result = layerFormConfigToPatch(formConfig);
    expect(result.renderMode).toBe("heatmap");
    expect("visible" in result).toBe(false);
    expect("opacity" in result).toBe(false);
    expect("cb_config" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// round-trip — flat patch P round-trips through both directions unchanged
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("round-trips a full flat patch through patchToLayerFormConfig then layerFormConfigToPatch", () => {
    const P = {
      renderMode: "classbreak",
      cb_config: '{"breaks":[{"v":1}]}',
      visible: true,
      opacity: 0.7,
    };
    const roundTripped = layerFormConfigToPatch(patchToLayerFormConfig(P));
    expect(roundTripped).toEqual(P);
  });
});

// ---------------------------------------------------------------------------
// allow-list safety — layerFormConfigToPatch output passes validateActionPatch
// ---------------------------------------------------------------------------

describe("allow-list safety", () => {
  it("patch output from layerFormConfigToPatch passes validateActionPatch (no out-of-list leak)", () => {
    const formConfig = {
      renderMode: "classbreak",
      cb_config: '{"breaks":[{"v":2}]}',
      visible: false,
      opacity: 1,
      // junk keys that CbConfigForm may emit
      spatialMode: "latlon",
      lonColumn: "lng",
      latColumn: "lat",
      someOtherKey: "value",
    };
    const patch = layerFormConfigToPatch(formConfig);
    const result = validateActionPatch("layer", undefined, patch);
    expect(result.valid).toBe(true);
  });

  it("empty patch from empty form config also passes validateActionPatch", () => {
    const patch = layerFormConfigToPatch({});
    const result = validateActionPatch("layer", undefined, patch);
    expect(result.valid).toBe(true);
  });

  it("renderMode-only patch passes validateActionPatch", () => {
    const patch = layerFormConfigToPatch({ renderMode: "raster" });
    const result = validateActionPatch("layer", undefined, patch);
    expect(result.valid).toBe(true);
  });
});
