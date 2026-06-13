/**
 * applyWidgetAction.spec.ts — Phase 60 Plan 01 Task 2 (RADIO-V111-03);
 * Phase 60 Plan 03 Task 2 (SEAM-V111-01): MCP seam doc existence/content asserts.
 *
 * Phase 60.01 migration:
 *   - applyWidgetAction now accepts controlId: number as the 3rd argument.
 *   - Write-side calls store.setControlContribution(controlId, contribution)
 *     instead of the removed applyWidgetOverride/applyLayerOverride/applyDynamicViewOverride.
 *   - Idempotency guards against the per-control contribution for the target (not merged overlay).
 *   - Consumer assertions still read the DERIVED maps (widgetOverrides/layerOverrides) —
 *     same shape as Phase 58 since a single control's contribution == the derived overlay
 *     when no other controls target the same entity.
 *
 * Phase 58.1 behaviors preserved:
 *   - renderMode (camelCase) is the correct allow-listed field name
 *   - Layer overlay for renderMode/visible/opacity nests under `config` sub-object
 *   - track_config / cb_config stay top-level in the overlay
 *   - Mixed-patch test: { renderMode, track_config } splits correctly
 *   - Idempotency compares against the per-control contribution (deep-equal)
 *
 * Tests cover ALL behaviors:
 *   1. applied — each of the 3 target kinds (widget / layer / dynamicView)
 *   2. rejected — allow-list failure → no overlay write + toast fired
 *   3. target_not_found — target id not in lookups → no write + toast
 *   4. idempotency — double-dispatch on same action → at most one effective store write
 *   5. zero PATCH — applyWidgetAction never calls updateWidget/updateLayer (transient-only)
 *   6. partial lookups — missing widgetType → handled (no allow-list = rejected)
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests.
 *   - Toast store is auto-reset between tests by the same shim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import { applyWidgetAction, applyWidgetActions, type ActionLookups } from "./applyWidgetAction";
import { useWidgetActionStore } from "../store/widgetActionStore";
import { useToastStore } from "../store/toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 1,
  dashboard_id: 10,
  title: "Test Widget",
  type: "records",
  position: 0,
  config: { page_size: 25 },
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeLayer = (overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id: 100,
  dashboard_id: 10,
  table_id: 50,
  layer_type: "wms",
  position: 0,
  config: { renderMode: "raster", visible: true, POINTOPACITY: 100 },
  info_enabled: 0,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "",
  updated_at: "",
  ...overrides,
} as DashboardLayerDto);

const makeLookups = (overrides: Partial<ActionLookups> = {}): ActionLookups => ({
  widgets: [makeWidget()],
  layers: [makeLayer()],
  dynamicViewIds: [5],
  ...overrides,
});

// Control id used in all single-control tests
const CONTROL_ID = 1;

// ---------------------------------------------------------------------------
// Mocking updateWidget / updateLayer to assert zero PATCH calls
// ---------------------------------------------------------------------------
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    updateWidget: vi.fn(() => Promise.resolve({})),
    updateLayer: vi.fn(() => Promise.resolve({})),
  };
});

// ---------------------------------------------------------------------------
// 1. Applied — widget target
// ---------------------------------------------------------------------------
describe("applyWidgetAction — applied (widget)", () => {
  it("applies an allow-listed widget config patch and returns applied status", () => {
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(result.target).toEqual({ kind: "widget", id: 1 });
    // Derived widgetOverrides has the patch (single control)
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ page_size: 50 });
  });

  it("applying to widget id 2 records correctly in derived widgetOverrides", () => {
    const result = applyWidgetAction(
      // chart widget — need chart lookups
      { target: { kind: "widget", id: 2 }, configPatch: { metric: "col_a" } },
      makeLookups({ widgets: [makeWidget({ id: 2, type: "chart", config: {} }) ] }),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().widgetOverrides[2]).toEqual({ metric: "col_a" });
  });
});

// ---------------------------------------------------------------------------
// 2. Applied — layer target (renderMode → nested config)
// ---------------------------------------------------------------------------
describe("applyWidgetAction — applied (layer)", () => {
  it("applies a renderMode patch and stores it nested under config (not top-level)", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { renderMode: "heatmap" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    // renderMode is a layer.config field — derived overlay carries it under config
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      config: { renderMode: "heatmap" },
    });
  });

  it("stores visible patch nested under config", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { visible: false } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      config: { visible: false },
    });
  });

  it("stores opacity patch nested under config", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { opacity: 0.5 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      config: { opacity: 0.5 },
    });
  });

  it("stores track_config at top level (TOP-LEVEL DashboardLayerDto field)", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { track_config: '{"enabled":true}' } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    // track_config stays at top level (not nested under config)
    expect(useWidgetActionStore.getState().layerOverrides[100]).toMatchObject({
      track_config: '{"enabled":true}',
    });
    // NOT nested under config
    const overlay = useWidgetActionStore.getState().layerOverrides[100];
    expect((overlay?.config as Record<string, unknown> | undefined)?.track_config).toBeUndefined();
  });

  it("stores cb_config at top level (TOP-LEVEL DashboardLayerDto field)", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { cb_config: '{"breaks":[]}' } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().layerOverrides[100]).toMatchObject({
      cb_config: '{"breaks":[]}',
    });
  });

  it("handles mixed patch: renderMode goes nested, track_config stays top-level", () => {
    const result = applyWidgetAction(
      {
        target: { kind: "layer", id: 100 },
        configPatch: { renderMode: "classbreak", track_config: '{"enabled":true}' },
      },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    const overlay = useWidgetActionStore.getState().layerOverrides[100];
    // renderMode nested under config
    expect((overlay?.config as Record<string, unknown>)?.renderMode).toBe("classbreak");
    // track_config at top level
    expect(overlay?.track_config).toBe('{"enabled":true}');
  });
});

// ---------------------------------------------------------------------------
// 3. Applied — dynamicView target
// ---------------------------------------------------------------------------
describe("applyWidgetAction — applied (dynamicView)", () => {
  it("applies an allow-listed patch to the dynamic view overlay", () => {
    const result = applyWidgetAction(
      { target: { kind: "dynamicView", id: 5 }, configPatch: { enabled: false } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({ enabled: false });
  });
});

// ---------------------------------------------------------------------------
// 4. Rejected — allow-list failure
// ---------------------------------------------------------------------------
describe("applyWidgetAction — rejected", () => {
  it("returns rejected when the patch field is not on the allow-list", () => {
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { unknown_field: "x" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("does NOT write to the overlay store on rejection", () => {
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { unknown_field: "x" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toBeUndefined();
  });

  it("fires a toast on rejection", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { unknown_field: "x" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(showToastSpy).toHaveBeenCalled();
  });

  it("returns rejected for a meta/proto key (permanently blocked)", () => {
    // Use JSON.parse to create __proto__ as an own enumerable property.
    // An object literal { __proto__: ... } silently mutates the prototype and
    // never creates an own-property key — Object.keys() would return [].
    // This mirrors the widgetAction.spec.ts pattern from Plan 58-01.
    const configPatch = JSON.parse('{"__proto__": {}}') as Record<string, unknown>;
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
  });

  it("does not write to the overlay store when a meta key is blocked", () => {
    applyWidgetAction(
      // Use a permanently blocked key
      { target: { kind: "widget", id: 1 }, configPatch: { id: 99 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toBeUndefined();
  });

  it("returns rejected for wrong type (enum violation)", () => {
    const result = applyWidgetAction(
      // aggregation must be one of the allowed enum values
      { target: { kind: "widget", id: 1 }, configPatch: { aggregation: "median" } },
      makeLookups({ widgets: [makeWidget({ id: 1, type: "chart" })] }),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
  });

  it("layer target with unknown style key is ACCEPTED (denylist: not blocked) — Phase 60.1 snapshot path", () => {
    // Phase 60.1 RE-SCOPE: layer targets now use the DENYLIST (validateLayerSnapshot).
    // Unknown style keys (colormap, BLUR_RADIUS, arbitrary form fields) are ACCEPTED —
    // only data-binding/spatial/meta keys are rejected. This is intentional: the designer
    // UI snapshot carries all style keys from KineticaWmsLayerForm.
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { totally_unknown_style_key: "viridis" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
  });

  it("layer target with data-binding key (table_id) is REJECTED even with denylist", () => {
    // Data-binding keys are always blocked for layer targets (safety boundary).
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { table_id: 99 } as Record<string, unknown> },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// 5. target_not_found — deleted / absent target
// ---------------------------------------------------------------------------
describe("applyWidgetAction — target_not_found", () => {
  it("returns target_not_found for a widget id not in lookups", () => {
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 999 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("target_not_found");
    expect(result.target).toEqual({ kind: "widget", id: 999 });
  });

  it("does NOT write to the overlay store when target is not found", () => {
    applyWidgetAction(
      { target: { kind: "widget", id: 999 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(useWidgetActionStore.getState().widgetOverrides[999]).toBeUndefined();
  });

  it("fires a toast when target is not found", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    applyWidgetAction(
      { target: { kind: "widget", id: 999 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(showToastSpy).toHaveBeenCalled();
  });

  it("returns target_not_found for a layer id not in lookups", () => {
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 999 }, configPatch: { renderMode: "heatmap" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("target_not_found");
  });

  it("returns target_not_found for a dynamicView id not in dynamicViewIds", () => {
    const result = applyWidgetAction(
      { target: { kind: "dynamicView", id: 999 }, configPatch: { enabled: true } },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("target_not_found");
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency — double-dispatch → at most one effective store write
// ---------------------------------------------------------------------------
describe("applyWidgetAction — idempotency", () => {
  it("second dispatch with same action returns applied without writing again (store stays same)", () => {
    const action = { target: { kind: "widget" as const, id: 1 }, configPatch: { page_size: 50 } };
    const lookups = makeLookups();

    // First dispatch — should write
    applyWidgetAction(action, lookups, CONTROL_ID);
    const overrideAfterFirst = useWidgetActionStore.getState().widgetOverrides[1];

    // Second dispatch — identical merged value → must NOT write (idempotency)
    // To detect this, we spy on setControlContribution
    const setContribSpy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");

    const result = applyWidgetAction(action, lookups, CONTROL_ID);
    expect(result.status).toBe("applied"); // still reports applied
    expect(setContribSpy).not.toHaveBeenCalled(); // no redundant write
    // Derived store value unchanged
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual(overrideAfterFirst);
  });

  it("idempotency for layer renderMode — second dispatch does not write", () => {
    const action = {
      target: { kind: "layer" as const, id: 100 },
      configPatch: { renderMode: "heatmap" as const },
    };
    const lookups = makeLookups();

    applyWidgetAction(action, lookups, CONTROL_ID);
    const setContribSpy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    const result = applyWidgetAction(action, lookups, CONTROL_ID);
    expect(result.status).toBe("applied");
    expect(setContribSpy).not.toHaveBeenCalled();
  });

  it("changed patch breaks idempotency — second dispatch with different value DOES write", () => {
    const lookups = makeLookups();
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { page_size: 50 } },
      lookups,
      CONTROL_ID
    );
    const setContribSpy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { page_size: 100 } },
      lookups,
      CONTROL_ID
    );
    expect(setContribSpy).toHaveBeenCalled();
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ page_size: 100 });
  });

  it("idempotency: dispatching same renderMode again after it was already applied does not write", () => {
    // Layer starts with config.renderMode = "raster"
    // After first dispatch, control's layer contribution = { config: { renderMode: "heatmap" } }
    // Second dispatch of renderMode: "heatmap" should be idempotent (no write)
    const layer = makeLayer({ id: 100, config: { renderMode: "raster", visible: true } });
    const lookups = makeLookups({ layers: [layer] });
    const action = {
      target: { kind: "layer" as const, id: 100 },
      configPatch: { renderMode: "heatmap" as const },
    };

    applyWidgetAction(action, lookups, CONTROL_ID);
    // After first dispatch: derived overlay = { config: { renderMode: "heatmap" } }
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      config: { renderMode: "heatmap" },
    });

    const spy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    const result = applyWidgetAction(action, lookups, CONTROL_ID);
    expect(result.status).toBe("applied");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Zero PATCH assertion — applyWidgetAction never calls updateWidget/updateLayer
// ---------------------------------------------------------------------------
describe("applyWidgetAction — zero PATCH (transient-only)", () => {
  it("never calls updateWidget on a valid dispatch", async () => {
    const { updateWidget } = await import("../api/client");
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("never calls updateLayer on a valid layer dispatch", async () => {
    const { updateLayer } = await import("../api/client");
    applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { renderMode: "heatmap" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(updateLayer).not.toHaveBeenCalled();
  });

  it("never calls updateWidget on rejection (no partial write)", async () => {
    const { updateWidget } = await import("../api/client");
    applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { unknown: "x" } },
      makeLookups(),
      CONTROL_ID
    );
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("never calls updateWidget on target_not_found (no partial write)", async () => {
    const { updateWidget } = await import("../api/client");
    applyWidgetAction(
      { target: { kind: "widget", id: 999 }, configPatch: { page_size: 50 } },
      makeLookups(),
      CONTROL_ID
    );
    expect(updateWidget).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. applyWidgetAction — layer snapshot (60.1)
//    Validates routing through validateLayerSnapshot + DTO-shaped snapshot-aware split
// ---------------------------------------------------------------------------
describe("applyWidgetAction — layer snapshot (60.1)", () => {
  const LAYER_ID = 100;

  it("full snapshot accepted: DTO overlay has nested config (renderMode+colormap) + top-level cb_config + top-level info_enabled", () => {
    const result = applyWidgetAction(
      {
        target: { kind: "layer", id: LAYER_ID },
        configPatch: { renderMode: "classbreak", colormap: "viridis", cb_config: "{}", info_enabled: 0 },
      },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");

    const overlay = useWidgetActionStore.getState().layerOverrides[LAYER_ID];
    // Style/render keys → nested under config
    expect((overlay?.config as Record<string, unknown>)?.renderMode).toBe("classbreak");
    expect((overlay?.config as Record<string, unknown>)?.colormap).toBe("viridis");
    // Top-level fields NOT nested in config
    expect(overlay?.cb_config).toBe("{}");
    expect(overlay?.info_enabled).toBe(0);
    // renderMode/colormap must NOT be at top-level
    expect(overlay?.renderMode).toBeUndefined();
    expect(overlay?.colormap).toBeUndefined();
  });

  it("snapshot with data-binding key (table_id) → rejected; no store write", () => {
    const result = applyWidgetAction(
      {
        target: { kind: "layer", id: LAYER_ID },
        configPatch: { renderMode: "raster", table_id: 9 } as Record<string, unknown>,
      },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((r) => r.includes("table_id"))).toBe(true);
    }
    expect(useWidgetActionStore.getState().layerOverrides[LAYER_ID]).toBeUndefined();
  });

  it("snapshot with spatialMode → rejected (spatial key blocked)", () => {
    const result = applyWidgetAction(
      {
        target: { kind: "layer", id: LAYER_ID },
        configPatch: { spatialMode: "latlon" } as Record<string, unknown>,
      },
      makeLookups(),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((r) => r.includes("spatialMode"))).toBe(true);
    }
  });

  it("idempotency: dispatching the same full snapshot twice writes once (second call does not write to store)", () => {
    const action = {
      target: { kind: "layer" as const, id: LAYER_ID },
      configPatch: { renderMode: "classbreak", colormap: "viridis", cb_config: "{}", info_enabled: 0 },
    };
    applyWidgetAction(action, makeLookups(), CONTROL_ID);
    const spy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    const result = applyWidgetAction(action, makeLookups(), CONTROL_ID);
    expect(result.status).toBe("applied");
    expect(spy).not.toHaveBeenCalled();
  });

  it("widget strict path (regression): map show_popup still validates via validateActionPatch + applies", () => {
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } },
      makeLookups({ widgets: [makeWidget({ id: 1, type: "map", config: {} })] }),
      CONTROL_ID
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ show_popup: true });
  });

  it("widget strict path (regression): out-of-list key still rejects via validateActionPatch (strict path intact)", () => {
    const result = applyWidgetAction(
      { target: { kind: "widget", id: 1 }, configPatch: { colormap: "viridis" } },
      makeLookups({ widgets: [makeWidget({ id: 1, type: "map", config: {} })] }),
      CONTROL_ID
    );
    expect(result.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// 9. MCP action seam doc — existence + content asserts (SEAM-V111-01)
// (formerly section 8; renumbered after adding layer-snapshot section above)
// ---------------------------------------------------------------------------
describe("MCP action seam doc (SEAM-V111-01)", () => {
  // Resolve the doc relative to this spec file:
  // packages/web/src/lib/ -> up 3 dirs -> packages/web/ -> docs/mcp-action-seam.md
  const DOC_PATH = resolve(__dirname, "../../docs/mcp-action-seam.md");
  const SRC_PATH = resolve(__dirname, "applyWidgetAction.ts");

  let docContent: string;
  let srcContent: string;

  beforeEach(() => {
    docContent = readFileSync(DOC_PATH, "utf-8");
    srcContent = readFileSync(SRC_PATH, "utf-8");
  });

  it("mcp-action-seam.md exists and is non-empty", () => {
    expect(docContent.length).toBeGreaterThan(0);
  });

  it("doc contains the envelope shape { target, configPatch }", () => {
    expect(docContent).toMatch(/target.*configPatch|configPatch.*target/i);
    expect(docContent).toContain("configPatch");
    expect(docContent).toContain("target");
  });

  it("doc contains inputSchema (the MCP tool shape)", () => {
    expect(docContent).toContain("inputSchema");
  });

  it("doc contains ALLOW_LIST_VERSION (the versioned safety boundary)", () => {
    expect(docContent).toContain("ALLOW_LIST_VERSION");
  });

  it("doc references the allow-list as the safety boundary", () => {
    expect(docContent.toLowerCase()).toContain("allow-list");
  });

  it("doc contains PATCH /api/widgets (the existing server route)", () => {
    expect(docContent).toContain("PATCH /api/widgets");
  });

  it("doc explicitly states NO AI / MCP server is built this milestone", () => {
    // Any of these patterns qualifies as the explicit not-built statement
    const hasNotBuilt =
      /no AI\b/i.test(docContent) ||
      /NOT BUILT/i.test(docContent) ||
      /NO MCP/i.test(docContent) ||
      /design.*only/i.test(docContent);
    expect(hasNotBuilt).toBe(true);
  });

  it("applyWidgetAction.ts source contains the mcp-action-seam pointer comment", () => {
    expect(srcContent).toContain("mcp-action-seam");
  });
});

// ---------------------------------------------------------------------------
// 10. applyWidgetActions — combined contribution + switch-replace (Phase 60.2)
// ---------------------------------------------------------------------------

describe("applyWidgetActions — combined contribution + switch-replace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWidgetActionStore.getState().reset();
  });

  const L1_ID = 100;
  const W2_ID = 1;
  const CTRL = 99;

  const layerAction = (id: number, patch: Record<string, unknown>) =>
    ({ target: { kind: "layer" as const, id }, configPatch: patch });
  const widgetAction = (id: number, patch: Record<string, unknown>) =>
    ({ target: { kind: "widget" as const, id }, configPatch: patch });
  const dvAction = (id: number, patch: Record<string, unknown>) =>
    ({ target: { kind: "dynamicView" as const, id }, configPatch: patch });

  const lookups = (wIds: number[] = [W2_ID], lIds: number[] = [L1_ID]): ActionLookups => ({
    widgets: wIds.map((id) => makeWidget({ id, type: "records" })),
    layers: lIds.map((id) => makeLayer({ id })),
    dynamicViewIds: [5],
  });

  /* ---- multi-target applied: both targets appear in store ---- */
  it("applyWidgetActions([layerAction→L1, widgetAction→W2]) writes ONE combined contribution", () => {
    const result = applyWidgetActions(
      [layerAction(L1_ID, { renderMode: "heatmap" }), widgetAction(W2_ID, { page_size: 50 })],
      lookups(),
      CTRL,
    );
    expect(result.status).toBe("applied");
    expect(result.applied).toHaveLength(2);
    // Both overlays are present
    const state = useWidgetActionStore.getState();
    expect((state.layerOverrides[L1_ID]?.config as Record<string, unknown>)?.renderMode).toBe("heatmap");
    expect(state.widgetOverrides[W2_ID]).toEqual({ page_size: 50 });
  });

  it("setControlContribution called exactly ONCE for a 2-action batch", () => {
    const spy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    applyWidgetActions(
      [layerAction(L1_ID, { renderMode: "heatmap" }), widgetAction(W2_ID, { page_size: 50 })],
      lookups(),
      CTRL,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /* ---- THE critical switch-replace test (SC2) ---- */
  it("SWITCH-REPLACE: Option A {L1+W2} then Option B {L1} → W2 overlay is GONE", () => {
    // Option A: sets both L1 and W2
    applyWidgetActions(
      [layerAction(L1_ID, { renderMode: "heatmap" }), widgetAction(W2_ID, { page_size: 50 })],
      lookups(),
      CTRL,
    );
    const stateA = useWidgetActionStore.getState();
    expect(stateA.widgetOverrides[W2_ID]).toBeDefined();
    expect((stateA.layerOverrides[L1_ID]?.config as Record<string, unknown>)?.renderMode).toBe("heatmap");

    // Option B: sets ONLY L1 (different value)
    applyWidgetActions(
      [layerAction(L1_ID, { renderMode: "classbreak" })],
      lookups(),
      CTRL,
    );
    const stateB = useWidgetActionStore.getState();
    // W2 is GONE — switch-replace drops stale targets
    expect(stateB.widgetOverrides[W2_ID]).toBeUndefined();
    // L1 reflects Option B's value
    expect((stateB.layerOverrides[L1_ID]?.config as Record<string, unknown>)?.renderMode).toBe("classbreak");
  });

  /* ---- empty actions array → noop, no write ---- */
  it("empty actions array → noop status, setControlContribution NOT called", () => {
    const spy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    const result = applyWidgetActions([], lookups(), CTRL);
    expect(result.status).toBe("noop");
    expect(result.applied).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  /* ---- best-effort: valid + rejected → partial, ONE toast, ONE write ---- */
  it("best-effort: valid widget + rejected widget(out-of-list) → partial status, ONE setControlContribution", () => {
    const spy = vi.spyOn(useWidgetActionStore.getState(), "setControlContribution");
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    const widgetId3 = 3;
    const result = applyWidgetActions(
      [
        widgetAction(W2_ID, { page_size: 50 }),                    // valid
        widgetAction(widgetId3, { unknown_field: "x" }),           // rejected (not in allow-list)
      ],
      lookups([W2_ID, widgetId3]),
      CTRL,
    );
    expect(result.status).toBe("partial");
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    // Only ONE write
    expect(spy).toHaveBeenCalledTimes(1);
    // ONE combined toast
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    // Valid target is in the store
    expect(useWidgetActionStore.getState().widgetOverrides[W2_ID]).toEqual({ page_size: 50 });
  });

  /* ---- best-effort: not-found target ---- */
  it("target_not_found in batch: found target written, not-found collected, ONE combined toast", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    const result = applyWidgetActions(
      [
        widgetAction(W2_ID, { page_size: 50 }),   // found + valid
        widgetAction(999, { page_size: 100 }),     // not found
      ],
      lookups([W2_ID]),   // only W2_ID in lookups, 999 not present
      CTRL,
    );
    expect(result.status).toBe("partial");
    expect(result.applied).toHaveLength(1);
    expect(result.notFound).toHaveLength(1);
    expect(result.notFound[0]).toEqual({ kind: "widget", id: 999 });
    // ONE combined toast
    expect(showToastSpy).toHaveBeenCalledTimes(1);
  });

  /* ---- dynamicView target ---- */
  it("dynamicView target applies correctly in a batch", () => {
    const result = applyWidgetActions(
      [dvAction(5, { enabled: false })],
      lookups(),
      CTRL,
    );
    expect(result.status).toBe("applied");
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({ enabled: false });
  });

  /* ---- layer top-level fields stay top-level (snapshot split preserved) ---- */
  it("layer action with cb_config: stays top-level in overlay", () => {
    applyWidgetActions(
      [layerAction(L1_ID, { renderMode: "classbreak", cb_config: '{"breaks":[]}' })],
      lookups(),
      CTRL,
    );
    const overlay = useWidgetActionStore.getState().layerOverrides[L1_ID];
    expect(overlay?.cb_config).toBe('{"breaks":[]}');
    expect((overlay?.config as Record<string, unknown>)?.renderMode).toBe("classbreak");
  });

  /* ---- no updateWidget/updateLayer calls (transient-only invariant) ---- */
  it("never calls updateWidget or updateLayer (transient-only invariant)", async () => {
    const { updateWidget, updateLayer } = await import("../api/client");
    applyWidgetActions(
      [widgetAction(W2_ID, { page_size: 50 })],
      lookups(),
      CTRL,
    );
    expect(updateWidget).not.toHaveBeenCalled();
    expect(updateLayer).not.toHaveBeenCalled();
  });
});
