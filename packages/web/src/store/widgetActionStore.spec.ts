/**
 * widgetActionStore.spec.ts — Phase 58 Plan 02 Task 1 (ENGINE-V111-02).
 *
 * Tests cover:
 *   - Initial state: all three override maps are empty
 *   - applyWidgetOverride: writes and merges into widgetOverrides keyed by id
 *   - applyLayerOverride: writes and merges into layerOverrides keyed by id
 *   - applyDynamicViewOverride: writes and merges into dynamicViewOverrides keyed by id
 *   - clearOverride: removes the keyed entry for a given kind+id
 *   - reset(): empties all three maps (canonical session-lifecycle reset)
 *   - Reference isolation: applying an override doesn't mutate a sibling entry
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests (vi.mock("zustand") in src/test/setup.ts).
 *   - No spec-side beforeEach reset boilerplate needed.
 */
import { describe, it, expect } from "vitest";
import { useWidgetActionStore } from "./widgetActionStore";

describe("useWidgetActionStore — initial state", () => {
  it("starts with empty override maps", () => {
    const s = useWidgetActionStore.getState();
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });

  it("reading an unknown id returns undefined cleanly", () => {
    const s = useWidgetActionStore.getState();
    expect(s.widgetOverrides[999]).toBeUndefined();
    expect(s.layerOverrides[999]).toBeUndefined();
    expect(s.dynamicViewOverrides[999]).toBeUndefined();
  });
});

describe("applyWidgetOverride", () => {
  it("writes a patch entry for the given widget id", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 50 });
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ page_size: 50 });
  });

  it("merges a second patch into an existing entry (does not replace)", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 50 });
    useWidgetActionStore.getState().applyWidgetOverride(1, { metric: "count_col" });
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({
      page_size: 50,
      metric: "count_col",
    });
  });

  it("does not mutate a different widget's entry", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 50 });
    useWidgetActionStore.getState().applyWidgetOverride(2, { metric: "col" });
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ page_size: 50 });
    expect(useWidgetActionStore.getState().widgetOverrides[2]).toEqual({ metric: "col" });
  });
});

describe("applyLayerOverride", () => {
  it("writes a partial layer patch for the given layer id", () => {
    useWidgetActionStore.getState().applyLayerOverride(10, { render_mode: "heatmap" });
    expect(useWidgetActionStore.getState().layerOverrides[10]).toEqual({ render_mode: "heatmap" });
  });

  it("merges additional patches (e.g. visible + opacity)", () => {
    useWidgetActionStore.getState().applyLayerOverride(10, { render_mode: "heatmap" });
    useWidgetActionStore.getState().applyLayerOverride(10, { visible: false, opacity: 0.5 });
    expect(useWidgetActionStore.getState().layerOverrides[10]).toEqual({
      render_mode: "heatmap",
      visible: false,
      opacity: 0.5,
    });
  });

  it("supports top-level track_config as a string patch (TOP-LEVEL field, not nested)", () => {
    useWidgetActionStore.getState().applyLayerOverride(10, { track_config: '{"enabled":true}' });
    expect(useWidgetActionStore.getState().layerOverrides[10]).toEqual({
      track_config: '{"enabled":true}',
    });
  });
});

describe("applyDynamicViewOverride", () => {
  it("writes an override for the given dynamic view id", () => {
    useWidgetActionStore.getState().applyDynamicViewOverride(5, { enabled: true });
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({ enabled: true });
  });

  it("merges additional patches", () => {
    useWidgetActionStore.getState().applyDynamicViewOverride(5, { enabled: true });
    useWidgetActionStore.getState().applyDynamicViewOverride(5, { someFlag: false });
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toEqual({
      enabled: true,
      someFlag: false,
    });
  });
});

describe("clearOverride", () => {
  it("removes a widget override by kind+id", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 50 });
    useWidgetActionStore.getState().clearOverride("widget", 1);
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toBeUndefined();
  });

  it("removes a layer override by kind+id", () => {
    useWidgetActionStore.getState().applyLayerOverride(10, { visible: false });
    useWidgetActionStore.getState().clearOverride("layer", 10);
    expect(useWidgetActionStore.getState().layerOverrides[10]).toBeUndefined();
  });

  it("removes a dynamicView override by kind+id", () => {
    useWidgetActionStore.getState().applyDynamicViewOverride(5, { enabled: false });
    useWidgetActionStore.getState().clearOverride("dynamicView", 5);
    expect(useWidgetActionStore.getState().dynamicViewOverrides[5]).toBeUndefined();
  });

  it("is a no-op when the entry does not exist", () => {
    // Should not throw
    useWidgetActionStore.getState().clearOverride("widget", 999);
    expect(useWidgetActionStore.getState().widgetOverrides[999]).toBeUndefined();
  });

  it("does not affect sibling entries of the same kind", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 10 });
    useWidgetActionStore.getState().applyWidgetOverride(2, { metric: "col" });
    useWidgetActionStore.getState().clearOverride("widget", 1);
    expect(useWidgetActionStore.getState().widgetOverrides[2]).toEqual({ metric: "col" });
  });
});

describe("reset", () => {
  it("empties all three override maps", () => {
    useWidgetActionStore.getState().applyWidgetOverride(1, { page_size: 50 });
    useWidgetActionStore.getState().applyLayerOverride(10, { visible: false });
    useWidgetActionStore.getState().applyDynamicViewOverride(5, { enabled: true });
    useWidgetActionStore.getState().reset();
    const s = useWidgetActionStore.getState();
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });

  it("reset on already-empty store is a no-op (no throw)", () => {
    useWidgetActionStore.getState().reset();
    const s = useWidgetActionStore.getState();
    expect(s.widgetOverrides).toEqual({});
    expect(s.layerOverrides).toEqual({});
    expect(s.dynamicViewOverrides).toEqual({});
  });
});
