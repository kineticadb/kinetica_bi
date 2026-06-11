/**
 * widgetActionStore.spec.ts — Phase 60 Plan 01 Task 1 (RADIO-V111-03).
 *
 * Phase 60.01 refactor:
 *   - Store is now SOURCE-CONTROL-keyed: contributions keyed by controlId.
 *   - setControlContribution(controlId, contribution) REPLACES that control's
 *     prior contribution (switch-replace semantics).
 *   - clearControl(controlId): removes a control's contribution entirely.
 *   - reset(): clears contributions + derived maps (7th store lifecycle).
 *   - Derived maps (widgetOverrides/layerOverrides/dynamicViewOverrides) are
 *     recomputed on every write — consumer shape is UNCHANGED from Phase 58.
 *   - Layer deep-merge: config sub-objects merge; top-level (track_config/cb_config)
 *     shallow-merge across controls.
 *
 * Tests cover:
 *   - Initial state: contributions empty, all three derived maps empty
 *   - setControlContribution: writes a widget contribution → derived widgetOverrides
 *   - setControlContribution: writes a layer contribution → derived layerOverrides (DTO-shaped)
 *   - setControlContribution: writes a dynamicView contribution → derived dynamicViewOverrides
 *   - SWITCH-REPLACE: control C1 sets renderMode + cb_config, then re-sets renderMode only
 *     → derived layerOverrides no longer contains cb_config (reverted to baseline)
 *   - Multi-control merge: C1 and C2 both target the same layer → last-writer-per-field
 *   - clearControl: removes a control's contribution, derived maps recomputed
 *   - reset(): empties contributions + all three derived maps
 *   - Reference isolation: writing one control does not mutate another
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests (vi.mock("zustand") in src/test/setup.ts).
 *   - No spec-side beforeEach reset boilerplate needed.
 */
import { describe, it, expect } from "vitest";
import { useWidgetActionStore } from "./widgetActionStore";

describe("useWidgetActionStore — initial state", () => {
  it("starts with empty contributions and empty derived maps", () => {
    const s = useWidgetActionStore.getState();
    expect(s.contributions).toEqual({});
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });

  it("reading an unknown id from derived maps returns undefined cleanly", () => {
    const s = useWidgetActionStore.getState();
    expect(s.widgetOverrides[999]).toBeUndefined();
    expect(s.layerOverrides[999]).toBeUndefined();
    expect(s.dynamicViewOverrides[999]).toBeUndefined();
  });
});

describe("setControlContribution — widget", () => {
  it("writes a widget contribution and derives widgetOverrides", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toEqual({ page_size: 50 });
  });

  it("REPLACE: re-calling with a new patch replaces the prior widget contribution", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50, metric: "col_a" } },
    });
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 100 } },
    });
    // metric should be gone — the contribution was fully replaced
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toEqual({ page_size: 100 });
    expect(useWidgetActionStore.getState().widgetOverrides[42]).not.toHaveProperty("metric");
  });

  it("two controls targeting the same widget merge (last-writer wins per field)", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      widget: { 42: { metric: "col_a" } },
    });
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toEqual({
      page_size: 50,
      metric: "col_a",
    });
  });

  it("does not touch another target's derived entry", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      widget: { 99: { metric: "col" } },
    });
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toEqual({ page_size: 50 });
    expect(useWidgetActionStore.getState().widgetOverrides[99]).toEqual({ metric: "col" });
  });
});

describe("setControlContribution — layer (DTO-shaped)", () => {
  it("writes a nested config patch and derives layerOverrides with config sub-object", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { config: { renderMode: "heatmap" } } },
    });
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      config: { renderMode: "heatmap" },
    });
  });

  it("writes a top-level track_config (not nested under config)", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { track_config: '{"enabled":true}' } },
    });
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      track_config: '{"enabled":true}',
    });
  });

  it("writes mixed DTO patch (config nested + track_config top-level)", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: {
        100: {
          config: { renderMode: "classbreak" },
          cb_config: '{"breaks":[]}',
        },
      },
    });
    const overlay = useWidgetActionStore.getState().layerOverrides[100];
    expect((overlay.config as Record<string, unknown>).renderMode).toBe("classbreak");
    expect(overlay.cb_config).toBe('{"breaks":[]}');
  });

  it("SWITCH-REPLACE: option A sets renderMode + cb_config; option B sets renderMode only → cb_config reverts to baseline (gone from derived overlay)", () => {
    // Option A: renderMode + cb_config
    useWidgetActionStore.getState().setControlContribution(10, {
      layer: {
        100: {
          config: { renderMode: "classbreak" },
          cb_config: '{"breaks":[{"label":"A","minValue":0,"maxValue":10,"color":"FF0000"}]}',
        },
      },
    });
    const afterA = useWidgetActionStore.getState().layerOverrides[100];
    expect((afterA.config as Record<string, unknown>).renderMode).toBe("classbreak");
    expect(afterA.cb_config).toBeDefined();

    // Option B: renderMode only (no cb_config)
    useWidgetActionStore.getState().setControlContribution(10, {
      layer: {
        100: {
          config: { renderMode: "raster" },
        },
      },
    });

    const afterB = useWidgetActionStore.getState().layerOverrides[100];
    // renderMode updated
    expect((afterB.config as Record<string, unknown>).renderMode).toBe("raster");
    // cb_config GONE — reverted to baseline (not set by option B)
    expect(afterB.cb_config).toBeUndefined();
  });

  it("deep-merges config sub-objects across two controls for the same layer", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { config: { renderMode: "heatmap" } } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      layer: { 100: { config: { visible: false } } },
    });
    const overlay = useWidgetActionStore.getState().layerOverrides[100];
    // Both config fields present (deep-merged)
    expect((overlay.config as Record<string, unknown>).renderMode).toBe("heatmap");
    expect((overlay.config as Record<string, unknown>).visible).toBe(false);
  });
});

describe("setControlContribution — dynamicView", () => {
  it("writes a dynamicView contribution and derives dynamicViewOverrides", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      dynamicView: { 5: { enabled: true } },
    });
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({ enabled: true });
  });

  it("merges two controls targeting the same dynamicView", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      dynamicView: { 5: { enabled: true } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      dynamicView: { 5: { someFlag: false } },
    });
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({
      enabled: true,
      someFlag: false,
    });
  });
});

describe("clearControl", () => {
  it("removes a control's widget contribution and recomputes derived maps", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().clearControl(1);
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toBeUndefined();
    expect(useWidgetActionStore.getState().contributions[1]).toBeUndefined();
  });

  it("removes a control's layer contribution and recomputes derived maps", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { config: { renderMode: "heatmap" } } },
    });
    useWidgetActionStore.getState().clearControl(1);
    expect(useWidgetActionStore.getState().layerOverrides[100]).toBeUndefined();
  });

  it("is a no-op when the control has no prior contribution (no throw)", () => {
    useWidgetActionStore.getState().clearControl(999);
    expect(useWidgetActionStore.getState().contributions[999]).toBeUndefined();
  });

  it("does not affect sibling controls", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      widget: { 42: { metric: "col" } },
    });
    useWidgetActionStore.getState().clearControl(1);
    // C2's contribution still present in derived map
    expect(useWidgetActionStore.getState().widgetOverrides[42]).toEqual({ metric: "col" });
  });
});

describe("reset", () => {
  it("empties contributions and all three derived maps", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      layer: { 100: { config: { renderMode: "heatmap" } } },
    });
    useWidgetActionStore.getState().setControlContribution(3, {
      dynamicView: { 5: { enabled: true } },
    });
    useWidgetActionStore.getState().reset();
    const s = useWidgetActionStore.getState();
    expect(s.contributions).toEqual({});
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });

  it("reset on already-empty store is a no-op (no throw)", () => {
    useWidgetActionStore.getState().reset();
    const s = useWidgetActionStore.getState();
    expect(s.contributions).toEqual({});
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });
});

describe("reference isolation", () => {
  it("writing control C1's contribution does not mutate C2's contribution", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 50 } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      widget: { 99: { metric: "col" } },
    });
    // Mutate C1
    useWidgetActionStore.getState().setControlContribution(1, {
      widget: { 42: { page_size: 200 } },
    });
    // C2 is unaffected
    expect(useWidgetActionStore.getState().widgetOverrides[99]).toEqual({ metric: "col" });
  });

  it("clearing C1 does not affect C2's derived contribution", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { config: { renderMode: "heatmap" } } },
    });
    useWidgetActionStore.getState().setControlContribution(2, {
      layer: { 100: { track_config: '{"enabled":false}' } },
    });
    useWidgetActionStore.getState().clearControl(1);
    // C2's top-level track_config contribution still present
    expect(useWidgetActionStore.getState().layerOverrides[100]).toMatchObject({
      track_config: '{"enabled":false}',
    });
    // C1's config.renderMode is gone
    const cfg = useWidgetActionStore.getState().layerOverrides[100]?.config as
      | Record<string, unknown>
      | undefined;
    expect(cfg?.renderMode).toBeUndefined();
  });
});

describe("missing kinds normalize to {}", () => {
  it("setControlContribution with only layer kind leaves widget/dynamicView empty", () => {
    useWidgetActionStore.getState().setControlContribution(1, {
      layer: { 100: { config: { renderMode: "raster" } } },
    });
    const contrib = useWidgetActionStore.getState().contributions[1];
    expect(contrib.widget).toEqual({});
    expect(contrib.dynamicView).toEqual({});
    expect(Object.keys(contrib.layer)).toHaveLength(1);
  });
});
