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
import { patchToLayerFormConfig, layerFormConfigToPatch, snapshotToLayerForm, layerFormToSnapshot, DATA_BINDING_KEYS } from "./radioGroupLayerPatch";
import { validateActionPatch, validateLayerSnapshot } from "./actionAllowList";

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

// ---------------------------------------------------------------------------
// radioGroupLayerPatch — full snapshot (60.1 re-scope)
// ---------------------------------------------------------------------------

describe("radioGroupLayerPatch — full snapshot (60.1 re-scope)", () => {
  // ---------------------------------------------------------------------------
  // snapshotToLayerForm
  // ---------------------------------------------------------------------------

  it("snapshotToLayerForm: lifts cb_config/track_config into config blob and surfaces info_* separately", () => {
    const snapshot = {
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: '{"breaks":[1]}',
      track_config: "{}",
      info_enabled: 1,
      info_columns: '["a"]',
      info_template: "<b/>",
    };
    const { config, info } = snapshotToLayerForm(snapshot);
    // config blob has renderMode, colormap, cb_config, track_config (lifted into blob)
    expect(config.renderMode).toBe("classbreak");
    expect(config.colormap).toBe("viridis");
    expect(config.cb_config).toBe('{"breaks":[1]}');
    expect(config.track_config).toBe("{}");
    // info_* are NOT in the config blob
    expect("info_enabled" in config).toBe(false);
    expect("info_columns" in config).toBe(false);
    expect("info_template" in config).toBe(false);
    // info_* surfaced separately
    expect(info.info_enabled).toBe(1);
    expect(info.info_columns).toBe('["a"]');
    expect(info.info_template).toBe("<b/>");
  });

  it("snapshotToLayerForm: strips stray data-binding/spatial keys defensively", () => {
    const snapshot = {
      renderMode: "raster",
      table_id: 7,
      spatialMode: "latlon",
      latColumn: "x",
    };
    const { config } = snapshotToLayerForm(snapshot);
    expect(config.renderMode).toBe("raster");
    expect("table_id" in config).toBe(false);
    expect("spatialMode" in config).toBe(false);
    expect("latColumn" in config).toBe(false);
  });

  it("snapshotToLayerForm: empty snapshot yields { config: {}, info: {} }", () => {
    const { config, info } = snapshotToLayerForm({});
    expect(Object.keys(config)).toHaveLength(0);
    expect(Object.keys(info)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // layerFormToSnapshot
  // ---------------------------------------------------------------------------

  it("layerFormToSnapshot: strips data-binding/spatial keys, keeps render/style + cb_config/track_config top-level", () => {
    const formConfig = {
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: "{}",
      track_config: "{}",
      spatialMode: "latlon",
      latColumn: "x",
      lonColumn: "y",
      tableRef: "s.t",
    };
    const snapshot = layerFormToSnapshot(formConfig, { info_enabled: 1 });
    expect(snapshot.renderMode).toBe("classbreak");
    expect(snapshot.colormap).toBe("viridis");
    expect(snapshot.cb_config).toBe("{}");
    expect(snapshot.track_config).toBe("{}");
    expect(snapshot.info_enabled).toBe(1);
    // Stripped keys
    expect("spatialMode" in snapshot).toBe(false);
    expect("latColumn" in snapshot).toBe(false);
    expect("lonColumn" in snapshot).toBe(false);
    expect("tableRef" in snapshot).toBe(false);
    // cb_config/track_config are TOP-LEVEL siblings of renderMode (not nested under "config")
    expect("config" in snapshot).toBe(false);
  });

  it("layerFormToSnapshot: strips meta/permanently-blocked keys from form blob", () => {
    const formConfig: Record<string, unknown> = {
      renderMode: "raster",
      id: 9,
      type: "x",
    };
    // Inject __proto__ as own property via JSON parse
    const withProto = JSON.parse('{"renderMode":"raster","id":9,"type":"x"}') as Record<string, unknown>;
    const snapshot = layerFormToSnapshot(withProto, {});
    expect(snapshot.renderMode).toBe("raster");
    expect("id" in snapshot).toBe(false);
    expect("type" in snapshot).toBe(false);
  });

  it("layerFormToSnapshot: infoPatch fields fold to flat top-level in snapshot", () => {
    const snapshot = layerFormToSnapshot(
      { renderMode: "raster" },
      { info_enabled: 0, info_columns: null, info_template: "t" },
    );
    expect(snapshot.info_enabled).toBe(0);
    expect(snapshot.info_columns).toBeNull();
    expect(snapshot.info_template).toBe("t");
  });

  // ---------------------------------------------------------------------------
  // Round-trip
  // ---------------------------------------------------------------------------

  it("round-trip: snapshot → snapshotToLayerForm → layerFormToSnapshot → same snapshot", () => {
    const S = {
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: '{"breaks":[1]}',
      track_config: "{}",
      info_enabled: 1,
      info_columns: '["a"]',
      info_template: "<b/>",
    };
    const { config, info } = snapshotToLayerForm(S);
    const roundTripped = layerFormToSnapshot(config, info);
    expect(roundTripped).toEqual(S);
  });

  // ---------------------------------------------------------------------------
  // Safety: validateLayerSnapshot passes for all layerFormToSnapshot outputs
  // ---------------------------------------------------------------------------

  it("safety: layerFormToSnapshot output passes validateLayerSnapshot (no data-binding/meta leaks)", () => {
    const formConfig = {
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: "{}",
      track_config: "{}",
      spatialMode: "latlon",
      latColumn: "x",
      lonColumn: "y",
      tableRef: "s.t",
      table_id: 7,
    };
    const snapshot = layerFormToSnapshot(formConfig, { info_enabled: 1 });
    const result = validateLayerSnapshot(snapshot);
    expect(result.valid).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // DATA_BINDING_KEYS re-export
  // ---------------------------------------------------------------------------

  it("DATA_BINDING_KEYS contains table_id, dynamic_view_id, spatialMode, latColumn, lonColumn, wktColumn, wkbColumn, trackXColumn", () => {
    const keys = DATA_BINDING_KEYS as readonly string[];
    expect(keys).toContain("table_id");
    expect(keys).toContain("dynamic_view_id");
    expect(keys).toContain("spatialMode");
    expect(keys).toContain("latColumn");
    expect(keys).toContain("lonColumn");
    expect(keys).toContain("wktColumn");
    expect(keys).toContain("wkbColumn");
    expect(keys).toContain("trackXColumn");
  });
});
