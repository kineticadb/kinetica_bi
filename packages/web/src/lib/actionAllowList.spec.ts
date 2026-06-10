/**
 * Phase 58 Plan 01 — Task 2 TDD spec for the versioned allow-list and validateActionPatch.
 * Covers: ALLOW_LIST_VERSION check, positive valid cases, and 5+ rejection cases.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOW_LIST_VERSION,
  validateActionPatch,
} from "./actionAllowList";

describe("ALLOW_LIST_VERSION", () => {
  it('is "v1"', () => {
    expect(ALLOW_LIST_VERSION).toBe("v1");
  });
});

describe("validateActionPatch — positive cases", () => {
  it("accepts a valid widget/map patch with an allow-listed field", () => {
    const result = validateActionPatch("widget", "map", {
      show_popup: true,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer patch with render_mode", () => {
    const result = validateActionPatch("layer", undefined, {
      render_mode: "heatmap",
    });
    expect(result.valid).toBe(true);
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
  it("rejects a layer patch where render_mode is not in the allowed enum", () => {
    const result = validateActionPatch("layer", undefined, {
      render_mode: "DELETE",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("render_mode"))).toBe(true);
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
