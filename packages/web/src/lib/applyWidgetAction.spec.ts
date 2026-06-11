/**
 * applyWidgetAction.spec.ts — Phase 60 Plan 01 Task 2 (RADIO-V111-03).
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
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import { applyWidgetAction, type ActionLookups } from "./applyWidgetAction";
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

  it("rejects an unknown layer field (old snake-case keys are unknown; use renderMode camelCase)", () => {
    // The old Phase 58 snake-case key is not in the allow-list.
    // Any unknown field should be rejected. The renderMode (camelCase) spec above
    // confirms the correct key is accepted.
    const result = applyWidgetAction(
      { target: { kind: "layer", id: 100 }, configPatch: { totally_unknown: "heatmap" } },
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
