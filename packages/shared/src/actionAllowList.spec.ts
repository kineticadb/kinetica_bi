/**
 * Phase 58.1 Plan 01 — Task 1 TDD spec for the corrected versioned allow-list.
 *
 * Changes from Phase 58 Plan 01:
 *   - ALLOW_LIST_VERSION is now "v2" (contract changed)
 *   - render_mode (snake) → renderMode (camelCase, nested in layer.config)
 *   - visible and opacity declared as layer.config fields (nested)
 *   - track_config / cb_config remain TOP-LEVEL DashboardLayerDto fields
 *   - getFieldLocation() helper exported as single source of truth for field locations
 *   - render_mode (old snake key) is now REJECTED as unknown field
 *
 * Covers: ALLOW_LIST_VERSION check, positive valid cases, rejection cases,
 * and location-metadata assertions for the new getFieldLocation helper.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOW_LIST_VERSION,
  validateActionPatch,
  getFieldLocation,
  validateLayerSnapshot,
} from "./actionAllowList";

describe("ALLOW_LIST_VERSION", () => {
  it('is "v2" (contract updated — renderMode rename + per-field location metadata)', () => {
    expect(ALLOW_LIST_VERSION).toBe("v2");
  });
});

describe("getFieldLocation — layer fields", () => {
  it("renderMode is located in layer.config (nested)", () => {
    expect(getFieldLocation("layer", undefined, "renderMode")).toBe("layer.config");
  });

  it("visible is located in layer.config (nested)", () => {
    expect(getFieldLocation("layer", undefined, "visible")).toBe("layer.config");
  });

  it("opacity is located in layer.config (nested)", () => {
    expect(getFieldLocation("layer", undefined, "opacity")).toBe("layer.config");
  });

  it("track_config is located at the top-level layer (DashboardLayerDto field)", () => {
    expect(getFieldLocation("layer", undefined, "track_config")).toBe("layer");
  });

  it("cb_config is located at the top-level layer (DashboardLayerDto field)", () => {
    expect(getFieldLocation("layer", undefined, "cb_config")).toBe("layer");
  });

  it("returns null for an unknown/non-allow-listed field", () => {
    expect(getFieldLocation("layer", undefined, "render_mode")).toBeNull();
    expect(getFieldLocation("layer", undefined, "totally_unknown")).toBeNull();
  });
});

describe("getFieldLocation — widget fields", () => {
  it("widget/map fields are located in widget.config", () => {
    expect(getFieldLocation("widget", "map", "show_popup")).toBe("widget.config");
    expect(getFieldLocation("widget", "map", "show_scale_bar")).toBe("widget.config");
    expect(getFieldLocation("widget", "map", "show_fullscreen")).toBe("widget.config");
  });

  it("widget/chart fields are located in widget.config", () => {
    expect(getFieldLocation("widget", "chart", "metric")).toBe("widget.config");
    expect(getFieldLocation("widget", "chart", "aggregation")).toBe("widget.config");
  });

  it("widget/records fields are located in widget.config", () => {
    expect(getFieldLocation("widget", "records", "page_size")).toBe("widget.config");
  });
});

describe("validateActionPatch — positive cases", () => {
  it("accepts a valid widget/map patch with an allow-listed field", () => {
    const result = validateActionPatch("widget", "map", {
      show_popup: true,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer patch with renderMode (camelCase — the REAL key)", () => {
    const result = validateActionPatch("layer", undefined, {
      renderMode: "heatmap",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts all renderMode enum values", () => {
    for (const mode of ["raster", "heatmap", "classbreak", "contour"] as const) {
      const result = validateActionPatch("layer", undefined, { renderMode: mode });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts a valid layer patch with visible boolean", () => {
    const result = validateActionPatch("layer", undefined, {
      visible: true,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer patch with opacity in range", () => {
    const result = validateActionPatch("layer", undefined, {
      opacity: 0.5,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer patch with top-level track_config string", () => {
    const result = validateActionPatch("layer", undefined, {
      // track_config is a TOP-LEVEL DashboardLayerDto field (JSON string), NOT config.track_config
      track_config: JSON.stringify({ enabled: true }),
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer patch with top-level cb_config string", () => {
    const result = validateActionPatch("layer", undefined, {
      // cb_config is a TOP-LEVEL DashboardLayerDto field (JSON string), NOT config.cb_config
      cb_config: JSON.stringify({ breaks: [] }),
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid chart patch with metric field", () => {
    const result = validateActionPatch("widget", "chart", {
      metric: "revenue",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid chart patch with aggregation enum value", () => {
    const result = validateActionPatch("widget", "chart", {
      aggregation: "sum",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid dynamicView patch with an allow-listed field", () => {
    const result = validateActionPatch("dynamicView", undefined, {
      enabled: true,
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateActionPatch — rejection cases", () => {
  // REJECTION: render_mode (old snake key) — now an UNKNOWN field
  it("rejects render_mode (snake_case) — it is now an UNKNOWN field (correct key is renderMode)", () => {
    const result = validateActionPatch("layer", undefined, {
      render_mode: "heatmap",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("render_mode"))).toBe(true);
    }
  });

  // REJECTION 1: unknown key
  it("rejects a patch with a key not in the allow-list (unknown key)", () => {
    const result = validateActionPatch("widget", "map", {
      some_unknown_field: "anything",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("some_unknown_field"))).toBe(true);
    }
  });

  it("rejects a layer patch with a key not in the layer allow-list", () => {
    const result = validateActionPatch("layer", undefined, {
      totally_unknown: 42,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("totally_unknown"))).toBe(true);
    }
  });

  // REJECTION 2: wrong type
  it("rejects a patch where an allow-listed field has the wrong primitive type", () => {
    // visible should be boolean, not a string
    const result = validateActionPatch("layer", undefined, {
      visible: "yes",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("visible"))).toBe(true);
    }
  });

  it("rejects a layer patch where opacity is a string instead of number", () => {
    const result = validateActionPatch("layer", undefined, {
      opacity: "0.5",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("opacity"))).toBe(true);
    }
  });

  // REJECTION 3: enum violation
  it("rejects a layer patch where renderMode is not in the allowed enum", () => {
    const result = validateActionPatch("layer", undefined, {
      renderMode: "DELETE",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("renderMode"))).toBe(true);
    }
  });

  it("rejects a chart patch where aggregation is not in the allowed enum", () => {
    const result = validateActionPatch("widget", "chart", {
      aggregation: "INVALID_AGG",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("aggregation"))).toBe(true);
    }
  });

  // REJECTION 4: meta key
  it("rejects a patch containing meta key 'id'", () => {
    const result = validateActionPatch("widget", "map", {
      id: 99,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("id"))).toBe(true);
    }
  });

  it("rejects a patch containing meta key 'tableId'", () => {
    const result = validateActionPatch("layer", undefined, {
      tableId: "public.some_table",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("tableId"))).toBe(true);
    }
  });

  it("rejects a patch containing meta key 'type'", () => {
    const result = validateActionPatch("widget", "chart", {
      type: "map",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("type"))).toBe(true);
    }
  });

  // REJECTION 5: proto key
  it("rejects a patch containing proto key '__proto__'", () => {
    // Use JSON.parse to create the __proto__ key as an own property —
    // the real attack vector (object literal { __proto__: ... } silently sets
    // the prototype and doesn't appear in Object.keys).
    const patch = JSON.parse('{"__proto__": {"isAdmin": true}}') as Record<string, unknown>;
    const result = validateActionPatch("layer", undefined, patch);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("__proto__"))).toBe(true);
    }
  });

  it("rejects a patch containing proto key 'constructor'", () => {
    const result = validateActionPatch("widget", "map", {
      constructor: "evil",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("constructor"))).toBe(true);
    }
  });

  it("rejects a patch containing proto key 'prototype'", () => {
    const result = validateActionPatch("widget", "map", {
      prototype: {},
    } as Record<string, unknown>);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("prototype"))).toBe(true);
    }
  });

  // No allow-list for target kind
  it("rejects when no allow-list exists for the given kind/type combination", () => {
    const result = validateActionPatch("widget", "unknownWidgetType", {
      someField: "value",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateLayerSnapshot — layer-appearance denylist (60.1)
// ---------------------------------------------------------------------------

describe("validateLayerSnapshot — layer-appearance denylist (60.1)", () => {
  // Positive: render/style/info keys accepted (denylist, not allow-list)
  it("accepts a patch with render/style/info keys (denylist — all non-blocked keys pass)", () => {
    const result = validateLayerSnapshot({
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: "{}",
      info_enabled: 1,
    });
    expect(result.valid).toBe(true);
  });

  // Positive: realistic full snapshot
  it("accepts a realistic full snapshot with all render/style/info keys", () => {
    const result = validateLayerSnapshot({
      renderMode: "classbreak",
      colormap: "viridis",
      BLUR_RADIUS: 8,
      POINTCOLOR: "#ff0000",
      POINTSIZE: 3,
      opacity: 0.8,
      visible: true,
      name: "My Layer",
      minZoom: 0,
      maxZoom: 28,
      cb_config: '{"breaks":[]}',
      track_config: "{}",
      info_enabled: 1,
      info_columns: '["lon","lat"]',
      info_template: "<b>{name}</b>",
    });
    expect(result.valid).toBe(true);
  });

  // Data-binding keys blocked
  it("rejects a patch containing data-binding key table_id", () => {
    const result = validateLayerSnapshot({ renderMode: "raster", table_id: 5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("table_id"))).toBe(true);
    }
  });

  it("rejects a patch containing data-binding key dynamic_view_id", () => {
    const result = validateLayerSnapshot({ renderMode: "raster", dynamic_view_id: 3 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("dynamic_view_id"))).toBe(true);
    }
  });

  // Spatial keys blocked
  it("rejects a patch containing spatial key spatialMode", () => {
    const result = validateLayerSnapshot({ spatialMode: "latlon" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("spatialMode"))).toBe(true);
    }
  });

  it("rejects a patch containing spatial key latColumn", () => {
    const result = validateLayerSnapshot({ latColumn: "x" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("latColumn"))).toBe(true);
    }
  });

  it("rejects a patch containing spatial key lonColumn", () => {
    const result = validateLayerSnapshot({ lonColumn: "y" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("lonColumn"))).toBe(true);
    }
  });

  it("rejects a patch containing spatial key wktColumn", () => {
    const result = validateLayerSnapshot({ wktColumn: "g" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("wktColumn"))).toBe(true);
    }
  });

  it("rejects a patch containing spatial key wkbColumn", () => {
    const result = validateLayerSnapshot({ wkbColumn: "g" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("wkbColumn"))).toBe(true);
    }
  });

  // Track spatial columns blocked
  it("rejects a patch containing track spatial key trackXColumn", () => {
    const result = validateLayerSnapshot({ trackXColumn: "x" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("trackXColumn"))).toBe(true);
    }
  });

  it("rejects a patch containing track spatial key trackIdColumn", () => {
    const result = validateLayerSnapshot({ trackIdColumn: "id" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("trackIdColumn"))).toBe(true);
    }
  });

  // PERMANENTLY_BLOCKED_KEYS blocked
  it("rejects a patch containing permanently-blocked key __proto__", () => {
    const patch = JSON.parse('{"__proto__": {}}') as Record<string, unknown>;
    const result = validateLayerSnapshot(patch);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("__proto__"))).toBe(true);
    }
  });

  it("rejects a patch containing permanently-blocked key id", () => {
    const result = validateLayerSnapshot({ id: 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("id"))).toBe(true);
    }
  });

  it("rejects a patch containing permanently-blocked key type", () => {
    const result = validateLayerSnapshot({ type: "x" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("type"))).toBe(true);
    }
  });

  // Unchanged-contract regression: validateActionPatch still strict
  it("validateActionPatch('layer', undefined, { foo: 1 }) still returns valid:false (strict allow-list unchanged)", () => {
    const result = validateActionPatch("layer", undefined, { foo: 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("foo"))).toBe(true);
    }
  });

  it("validateActionPatch('widget', 'map', { show_popup: true }) still returns valid:true (widget path intact)", () => {
    const result = validateActionPatch("widget", "map", { show_popup: true });
    expect(result.valid).toBe(true);
  });
});
