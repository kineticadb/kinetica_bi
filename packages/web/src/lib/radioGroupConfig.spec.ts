/**
 * Phase 59 Plan 01 — Task 1 (TDD RED)
 * Unit tests for radioGroupConfig.ts:
 *   - RadioGroupConfig / RadioOption types
 *   - RADIO_GROUP_DEFAULT_CONFIG
 *   - validateRadioOption
 *   - isRadioGroupConfigValid
 */
import { describe, it, expect } from "vitest";
import {
  RADIO_GROUP_DEFAULT_CONFIG,
  validateRadioOption,
  isRadioGroupConfigValid,
} from "./radioGroupConfig";
import type { RadioOption, RadioGroupConfig } from "./radioGroupConfig";

// ---------------------------------------------------------------------------
// Helpers — build valid RadioOption fixtures
// ---------------------------------------------------------------------------

function makeLayerOption(configPatch: Record<string, unknown>): RadioOption {
  return {
    id: "opt-1",
    label: "Option 1",
    action: {
      target: { kind: "layer", id: 42 },
      configPatch,
    },
  };
}

function makeWidgetOption(
  widgetId: number,
  configPatch: Record<string, unknown>
): RadioOption {
  return {
    id: "opt-2",
    label: "Option 2",
    action: {
      target: { kind: "widget", id: widgetId },
      configPatch,
    },
  };
}

// ---------------------------------------------------------------------------
// RADIO_GROUP_DEFAULT_CONFIG
// ---------------------------------------------------------------------------

describe("RADIO_GROUP_DEFAULT_CONFIG", () => {
  it("has orientation vertical and empty options array", () => {
    expect(RADIO_GROUP_DEFAULT_CONFIG.orientation).toBe("vertical");
    expect(RADIO_GROUP_DEFAULT_CONFIG.options).toEqual([]);
  });

  it("has no title or defaultOptionId on the default", () => {
    expect(RADIO_GROUP_DEFAULT_CONFIG.title).toBeUndefined();
    expect(RADIO_GROUP_DEFAULT_CONFIG.defaultOptionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — valid cases
// ---------------------------------------------------------------------------

describe("validateRadioOption — valid cases", () => {
  it("accepts a valid layer option with renderMode", () => {
    const option = makeLayerOption({ renderMode: "classbreak" });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer option with multiple fields (renderMode + cb_config)", () => {
    const option = makeLayerOption({ renderMode: "classbreak", cb_config: "{}" });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer option with track_config", () => {
    const option = makeLayerOption({ track_config: '{"enabled":true}' });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid widget map option with widgetType", () => {
    const option = makeWidgetOption(10, { show_popup: true });
    const result = validateRadioOption(option, "map");
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer option with visible", () => {
    const option = makeLayerOption({ visible: false });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid layer option with opacity 0.5", () => {
    const option = makeLayerOption({ opacity: 0.5 });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — rejected: empty configPatch
// ---------------------------------------------------------------------------

describe("validateRadioOption — empty configPatch", () => {
  it("rejects an empty configPatch", () => {
    const option = makeLayerOption({});
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("empty configPatch"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — rejected: out-of-list field
// ---------------------------------------------------------------------------

describe("validateRadioOption — out-of-list field", () => {
  it("rejects a field not in the allow-list (layer: foo)", () => {
    const option = makeLayerOption({ foo: 1 });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("unknown field: foo"))).toBe(true);
    }
  });

  it("rejects render_mode (snake_case) — only renderMode (camelCase) is valid", () => {
    // render_mode is NOT in the allow-list — only renderMode
    const option = makeLayerOption({ render_mode: "raster" } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("unknown field: render_mode"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — rejected: meta / proto key
// ---------------------------------------------------------------------------

describe("validateRadioOption — meta/proto key", () => {
  it("rejects a meta key (id)", () => {
    const option = makeLayerOption({ id: 5 } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("blocked meta/proto key: id"))).toBe(true);
    }
  });

  it("rejects a blocked key via Object.defineProperty (bypasses object literal prototype shorthand)", () => {
    // __proto__ via object literal syntax sets the prototype (not an own key), so we use
    // Object.defineProperty to put an actual "__proto__" own-property on the configPatch.
    const configPatch: Record<string, unknown> = {};
    Object.defineProperty(configPatch, "__proto__", {
      value: {},
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const option = makeLayerOption(configPatch);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("blocked meta/proto key: __proto__"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — rejected: wrong type / enum violation
// ---------------------------------------------------------------------------

describe("validateRadioOption — wrong type", () => {
  it("rejects renderMode with a bogus value not in the enum", () => {
    const option = makeLayerOption({ renderMode: "bogus" });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("invalid value for renderMode"))).toBe(true);
    }
  });

  it("rejects opacity out of 0-1 range", () => {
    const option = makeLayerOption({ opacity: 5 });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("invalid value for opacity"))).toBe(true);
    }
  });

  it("rejects visible with a non-boolean", () => {
    const option = makeLayerOption({ visible: "yes" } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("invalid value for visible"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isRadioGroupConfigValid — matrix
// ---------------------------------------------------------------------------

describe("isRadioGroupConfigValid", () => {
  const noWidgetType = (_id: number): string | undefined => undefined;
  const mapWidgetType = (_id: number): string | undefined => "map";

  const validLayerOption: RadioOption = {
    id: "a",
    label: "Class Break",
    action: { target: { kind: "layer", id: 1 }, configPatch: { renderMode: "classbreak" } },
  };

  const validWidgetOption: RadioOption = {
    id: "b",
    label: "Show Popup",
    action: { target: { kind: "widget", id: 2 }, configPatch: { show_popup: true } },
  };

  it("returns false when options array is empty", () => {
    const config: RadioGroupConfig = { orientation: "vertical", options: [] };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });

  it("returns false when an option has an empty label", () => {
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [{ ...validLayerOption, label: "  " }],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });

  it("returns false when an option has an empty configPatch", () => {
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [{ ...validLayerOption, action: { ...validLayerOption.action, configPatch: {} } }],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });

  it("returns false when an option has an out-of-list field", () => {
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [makeLayerOption({ foo: 1 })],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });

  it("returns true for a single valid layer option", () => {
    const config: RadioGroupConfig = { orientation: "vertical", options: [validLayerOption] };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(true);
  });

  it("returns true for a mix of valid layer and widget options", () => {
    const config: RadioGroupConfig = {
      orientation: "horizontal",
      title: "My Radio Group",
      defaultOptionId: "a",
      options: [validLayerOption, validWidgetOption],
    };
    expect(isRadioGroupConfigValid(config, mapWidgetType)).toBe(true);
  });

  it("returns false if any option in a multi-option config is invalid", () => {
    const badOption: RadioOption = { ...validLayerOption, label: "" };
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [validLayerOption, badOption],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });
});
