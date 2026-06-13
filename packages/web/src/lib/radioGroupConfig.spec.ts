/**
 * Phase 59 Plan 01 — Task 1 (TDD RED)
 * Unit tests for radioGroupConfig.ts:
 *   - RadioGroupConfig / RadioOption types
 *   - RADIO_GROUP_DEFAULT_CONFIG
 *   - validateRadioOption
 *   - isRadioGroupConfigValid
 *
 * Phase 60.2 Plan 01 — Task 1: added getOptionActions describe block + multi-action
 *   validateRadioOption tests + back-compat single-action tests.
 */
import { describe, it, expect } from "vitest";
import {
  RADIO_GROUP_DEFAULT_CONFIG,
  validateRadioOption,
  isRadioGroupConfigValid,
  getOptionActions,
} from "./radioGroupConfig";
import type { RadioOption, RadioGroupConfig } from "./radioGroupConfig";

// ---------------------------------------------------------------------------
// Helpers — build valid RadioOption fixtures
// ---------------------------------------------------------------------------

function makeLayerOption(configPatch: Record<string, unknown>): RadioOption {
  return {
    id: "opt-1",
    label: "Option 1",
    actions: [
      {
        target: { kind: "layer", id: 42 },
        configPatch,
      },
    ],
  };
}

/** Legacy single-action option (back-compat fixture — carries `action`, not `actions`) */
function makeLegacyLayerOption(configPatch: Record<string, unknown>): RadioOption {
  return {
    id: "opt-legacy",
    label: "Legacy Option",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: {
      target: { kind: "layer", id: 42 },
      configPatch,
    },
  } as unknown as RadioOption;
}

function makeWidgetOption(
  widgetId: number,
  configPatch: Record<string, unknown>
): RadioOption {
  return {
    id: "opt-2",
    label: "Option 2",
    actions: [
      {
        target: { kind: "widget", id: widgetId },
        configPatch,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// getOptionActions — normalizer (Phase 60.2)
// ---------------------------------------------------------------------------

describe("getOptionActions", () => {
  it("returns actions array as-is when actions is present", () => {
    const opt: RadioOption = {
      id: "x",
      label: "X",
      actions: [
        { target: { kind: "layer", id: 1 }, configPatch: { renderMode: "raster" } },
        { target: { kind: "widget", id: 2 }, configPatch: { page_size: 50 } },
      ],
    };
    const result = getOptionActions(opt);
    expect(result).toHaveLength(2);
    expect(result[0].target.id).toBe(1);
    expect(result[1].target.id).toBe(2);
  });

  it("normalizes legacy single-action option (action field) to a 1-element array", () => {
    const legacyOpt = makeLegacyLayerOption({ renderMode: "heatmap" });
    const result = getOptionActions(legacyOpt);
    expect(result).toHaveLength(1);
    expect(result[0].configPatch).toEqual({ renderMode: "heatmap" });
  });

  it("returns [] when neither actions nor action is present", () => {
    const emptyOpt = { id: "e", label: "E" } as unknown as RadioOption;
    expect(getOptionActions(emptyOpt)).toEqual([]);
  });

  it("actions wins over action when both are present (even if actions is empty)", () => {
    const opt = {
      id: "x",
      label: "X",
      actions: [],
      action: { target: { kind: "layer" as const, id: 1 }, configPatch: { renderMode: "raster" } },
    } as unknown as RadioOption;
    expect(getOptionActions(opt)).toEqual([]);
  });

  it("returns [] for an option with actions: []", () => {
    const opt: RadioOption = { id: "e", label: "E", actions: [] };
    expect(getOptionActions(opt)).toEqual([]);
  });
});

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

  it("accepts a valid widget map option with widgetTypeFor", () => {
    const option = makeWidgetOption(10, { show_popup: true });
    const result = validateRadioOption(option, () => "map");
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

  it("back-compat: legacy single-action layer option (action field) validates identically", () => {
    const legacyOpt = makeLegacyLayerOption({ renderMode: "raster" });
    const result = validateRadioOption(legacyOpt);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — multi-action (Phase 60.2)
// ---------------------------------------------------------------------------

describe("validateRadioOption — multi-action (Phase 60.2)", () => {
  it("valid when BOTH actions (layer + widget) pass their respective validators", () => {
    const opt: RadioOption = {
      id: "multi",
      label: "Multi",
      actions: [
        { target: { kind: "layer", id: 1 }, configPatch: { renderMode: "raster" } },
        { target: { kind: "widget", id: 2 }, configPatch: { show_popup: true } },
      ],
    };
    const result = validateRadioOption(opt, (id) => (id === 2 ? "map" : undefined));
    expect(result.valid).toBe(true);
  });

  it("invalid when one action (widget) is invalid — reasons aggregate", () => {
    const opt: RadioOption = {
      id: "multi",
      label: "Multi",
      actions: [
        { target: { kind: "layer", id: 1 }, configPatch: { renderMode: "raster" } },
        { target: { kind: "widget", id: 2 }, configPatch: { page_size: "not-a-number" as unknown as number } },
      ],
    };
    const result = validateRadioOption(opt, () => "records");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("page_size"))).toBe(true);
    }
  });

  it("invalid when the second action (layer) has a blocked key", () => {
    const opt: RadioOption = {
      id: "multi",
      label: "Multi",
      actions: [
        { target: { kind: "widget", id: 2 }, configPatch: { show_popup: true } },
        { target: { kind: "layer", id: 1 }, configPatch: { table_id: 99 } as Record<string, unknown> },
      ],
    };
    const result = validateRadioOption(opt, (id) => (id === 2 ? "map" : undefined));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("table_id"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — rejected: empty configPatch
// ---------------------------------------------------------------------------

describe("validateRadioOption — empty configPatch", () => {
  it("rejects an option whose first action has an empty configPatch", () => {
    const option = makeLayerOption({});
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("empty configPatch"))).toBe(true);
    }
  });

  it("rejects an option with no actions (normalized to [])", () => {
    const opt = { id: "e", label: "E" } as unknown as RadioOption;
    const result = validateRadioOption(opt);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("no targets"))).toBe(true);
    }
  });

  it("rejects an option with actions: [] (no targets guard)", () => {
    const opt: RadioOption = { id: "e", label: "E", actions: [] };
    const result = validateRadioOption(opt);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("no targets"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — out-of-list / unknown style keys (Phase 60.1 RE-SCOPE)
// ---------------------------------------------------------------------------

describe("validateRadioOption — layer: unknown style keys accepted by denylist (Phase 60.1)", () => {
  it("accepts a layer option with unknown style key 'foo' via denylist (not blocked)", () => {
    // Phase 60.1 RE-SCOPE: layer targets use the denylist — only data-binding/spatial/meta keys
    // are blocked. Unknown style keys (foo, colormap, BLUR_RADIUS, etc.) are accepted.
    const option = makeLayerOption({ foo: 1 });
    const result = validateRadioOption(option);
    // foo is accepted because it's not in PERMANENTLY_BLOCKED_KEYS ∪ DATA_BINDING_KEYS
    expect(result.valid).toBe(true);
  });

  it("accepts render_mode (snake_case) — denylist does not check camelCase-vs-snake-case style keys", () => {
    // Phase 60.1 RE-SCOPE: the denylist only blocks data-binding/spatial/meta keys.
    // render_mode passes (it's just an unrecognized style key, not a blocked key).
    const option = makeLayerOption({ render_mode: "raster" } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("rejects a layer option with data-binding key table_id (always blocked by denylist)", () => {
    const option = makeLayerOption({ table_id: 99 } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("table_id"))).toBe(true);
    }
  });

  it("rejects a layer option with spatialMode (spatial key always blocked by denylist)", () => {
    const option = makeLayerOption({ spatialMode: "latlon" } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("spatialMode"))).toBe(true);
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
// validateRadioOption — type/value validation (Phase 60.1 RE-SCOPE behavior note)
// ---------------------------------------------------------------------------

describe("validateRadioOption — type/value: layer denylist does NOT check value types (Phase 60.1)", () => {
  it("accepts renderMode with any value (denylist does not validate enum; the form constrains input)", () => {
    // Phase 60.1 RE-SCOPE: the denylist only checks KEY names, not value schemas.
    // The form (KineticaWmsLayerForm) is the authoritative UI source — it produces valid enums.
    const option = makeLayerOption({ renderMode: "bogus" });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts opacity: 5 (denylist does not range-check; form constrains 0-1 range)", () => {
    const option = makeLayerOption({ opacity: 5 });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("accepts visible:'yes' (denylist does not type-check; form provides boolean toggles)", () => {
    const option = makeLayerOption({ visible: "yes" } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("widget target — wrong type still rejects via validateActionPatch (strict path unchanged)", () => {
    // Widget targets keep the strict allow-list with schema validation.
    const option = makeWidgetOption(10, { page_size: "not-a-number" } as Record<string, unknown>);
    const result = validateRadioOption(option, () => "records");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("invalid value for page_size"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateRadioOption — layer snapshot (60.1)
//    Layer targets validate via the denylist (validateLayerSnapshot); widget/dv keep validateActionPatch.
// ---------------------------------------------------------------------------

describe("validateRadioOption — layer snapshot (60.1)", () => {
  it("accepts a LAYER option with a full snapshot (renderMode + colormap + cb_config + info_enabled) via denylist", () => {
    // Previously validateActionPatch would reject colormap/info_enabled as out-of-list.
    const option = makeLayerOption({
      renderMode: "classbreak",
      colormap: "viridis",
      cb_config: "{}",
      info_enabled: 1,
    });
    const result = validateRadioOption(option);
    expect(result.valid).toBe(true);
  });

  it("rejects a LAYER option whose configPatch carries table_id (data-binding key)", () => {
    const option = makeLayerOption({ renderMode: "raster", table_id: 9 } as Record<string, unknown>);
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("table_id"))).toBe(true);
    }
  });

  it("rejects a LAYER option with EMPTY configPatch {} (empty-patch rule still applies)", () => {
    const option = makeLayerOption({});
    const result = validateRadioOption(option);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("empty configPatch"))).toBe(true);
    }
  });

  it("WIDGET option { show_popup:true } with widgetTypeFor returning 'map' → valid via validateActionPatch (UNCHANGED)", () => {
    const option = makeWidgetOption(10, { show_popup: true });
    const result = validateRadioOption(option, () => "map");
    expect(result.valid).toBe(true);
  });

  it("WIDGET option with out-of-list key → invalid via validateActionPatch (strict path UNCHANGED)", () => {
    const option = makeWidgetOption(10, { colormap: "viridis" });
    const result = validateRadioOption(option, () => "map");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("unknown field: colormap"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isRadioGroupConfigValid — layer snapshot (60.1)
// ---------------------------------------------------------------------------

describe("isRadioGroupConfigValid — layer snapshot (60.1)", () => {
  const noWidgetType = (_id: number): string | undefined => undefined;

  it("returns true for a config whose single layer option is a valid full snapshot", () => {
    const fullSnapshotOption: RadioOption = {
      id: "snap-1",
      label: "Class Break Viridis",
      actions: [
        {
          target: { kind: "layer", id: 1 },
          configPatch: { renderMode: "classbreak", colormap: "viridis", cb_config: "{}", info_enabled: 1 },
        },
      ],
    };
    const config: RadioGroupConfig = { orientation: "vertical", options: [fullSnapshotOption] };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(true);
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
    actions: [{ target: { kind: "layer", id: 1 }, configPatch: { renderMode: "classbreak" } }],
  };

  const validWidgetOption: RadioOption = {
    id: "b",
    label: "Show Popup",
    actions: [{ target: { kind: "widget", id: 2 }, configPatch: { show_popup: true } }],
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
      options: [{ ...validLayerOption, actions: [{ target: { kind: "layer", id: 1 }, configPatch: {} }] }],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(false);
  });

  it("returns true when an option has an unknown style key (denylist accepts it for layer targets)", () => {
    // Phase 60.1 RE-SCOPE: layer-target options use denylist; 'foo' is not a blocked key.
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [makeLayerOption({ foo: 1 })],
    };
    expect(isRadioGroupConfigValid(config, noWidgetType)).toBe(true);
  });

  it("returns false when a layer option has a data-binding key (always blocked by denylist)", () => {
    const config: RadioGroupConfig = {
      orientation: "vertical",
      options: [makeLayerOption({ table_id: 99 } as Record<string, unknown>)],
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

  it("returns true for a multi-action option (layer + widget) when both actions are valid", () => {
    const multiOpt: RadioOption = {
      id: "multi",
      label: "Multi",
      actions: [
        { target: { kind: "layer", id: 1 }, configPatch: { renderMode: "raster" } },
        { target: { kind: "widget", id: 2 }, configPatch: { show_popup: true } },
      ],
    };
    const config: RadioGroupConfig = { orientation: "vertical", options: [multiOpt] };
    expect(isRadioGroupConfigValid(config, mapWidgetType)).toBe(true);
  });
});
