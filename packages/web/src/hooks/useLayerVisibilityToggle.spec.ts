/**
 * useLayerVisibilityToggle.spec.ts — Phase 61 GAP-61-02.
 *
 * Bug: after toggling a radio group that pins a layer's config (renderMode + a
 * captured `visible`), the legend eye toggle "no longer works" — the radio overlay
 * pins config.visible and MapChartRenderer.effectiveLayers merges the overlay ON TOP
 * of the persisted dashboardLayersStore, so the toggle's store write is masked.
 *
 * Fix (chosen contract — "radio can hide, toggle releases it"): the eye toggle still
 * writes config.visible to the persisted store, AND calls
 * widgetActionStore.releaseLayerConfigField(layerId, "visible") so the overlay no
 * longer holds `visible` — the user's explicit live action wins. Re-selecting a radio
 * option re-applies its full patch (re-pinning visible): most-recent action wins.
 *
 * These use the REAL widgetActionStore + REAL dashboardLayersStore (auto-reset by the
 * global zustand shim in src/test/setup.ts). No DashboardContext provider is mounted,
 * so the server PATCH is skipped (dashboardId undefined) — exactly the legacy-render path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useLayerVisibilityToggle } from "./useLayerVisibilityToggle";
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import { useWidgetActionStore } from "../store/widgetActionStore";
import type { DashboardLayerDto } from "../api/client";
import { DashboardContextProvider } from "../components/DashboardContext";
import { useAiSessionStore } from "../store/aiSessionStore";
import { baselineFixture, savedLayer, addLayerOp } from "../test/aiSessionHarness";

const { updateLayerApi } = vi.hoisted(() => ({ updateLayerApi: vi.fn() }));
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, updateLayer: updateLayerApi };
});

function seedLayer(id: number, config: Record<string, unknown>): void {
  useDashboardLayersStore.getState().setLayers([
    {
      id,
      table_id: 10,
      position: 0,
      config,
      cb_config: null,
    } as unknown as DashboardLayerDto,
  ]);
}

describe("useLayerVisibilityToggle — Phase 61 GAP-61-02 (live toggle releases radio overlay hold)", () => {
  it("writes config.visible to the layers store AND releases the overlay's visible (renderMode survives)", () => {
    seedLayer(1, { visible: true, renderMode: "classbreak" });

    // A radio control pins renderMode + a captured visible on the same layer.
    useWidgetActionStore.getState().setControlContribution(777, {
      layer: { 1: { config: { renderMode: "classbreak", visible: true } } },
    });
    // Pre-condition: overlay masks visibility (this is what broke the toggle).
    expect(
      (useWidgetActionStore.getState().layerOverrides[1].config as Record<string, unknown>).visible,
    ).toBe(true);

    const { result } = renderHook(() => useLayerVisibilityToggle());
    act(() => result.current(1, false));

    // Persisted store reflects the toggle.
    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === 1)!;
    expect((layer.config as Record<string, unknown>).visible).toBe(false);

    // Overlay's visible is RELEASED (so the store value now wins), renderMode preserved.
    const ovCfg = useWidgetActionStore.getState().layerOverrides[1]?.config as
      | Record<string, unknown>
      | undefined;
    expect(ovCfg && "visible" in ovCfg).toBe(false);
    expect(ovCfg?.renderMode).toBe("classbreak");
  });

  it("toggling with no active overlay still updates the store and does not throw", () => {
    seedLayer(2, { visible: true });

    const { result } = renderHook(() => useLayerVisibilityToggle());
    act(() => result.current(2, false));

    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === 2)!;
    expect((layer.config as Record<string, unknown>).visible).toBe(false);
    // No overlay was ever set.
    expect(useWidgetActionStore.getState().layerOverrides[2]).toBeUndefined();
  });
});

describe("useLayerVisibilityToggle - Phase 134 D-16 (AI session vs eye toggle)", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      DashboardContextProvider,
      { dashboardId: 1, widgets: [], dynamicViews: [], retryDynamicView: () => {}, children },
    );

  beforeEach(() => {
    updateLayerApi.mockReset();
    updateLayerApi.mockResolvedValue({});
    useAiSessionStore.getState().reset();
  });

  it("AIREAD-EYE-1: a SAVED layer still saves while an applied AI turn holds the edit lock (D-16)", () => {
    seedLayer(7, { visible: true });
    act(() => {
      useAiSessionStore.getState().applyTurn(
        { prompt: "p", ops: [addLayerOp(-2, 42)] },
        baselineFixture({ layers: [savedLayer(7)] }),
      );
    });
    const { result } = renderHook(() => useLayerVisibilityToggle(), { wrapper });
    act(() => result.current(7, false));
    expect(updateLayerApi).toHaveBeenCalledTimes(1);
    expect(updateLayerApi.mock.calls[0][1]).toBe(7);
    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === 7)!;
    expect((layer.config as Record<string, unknown>).visible).toBe(false);
  });

  it("AIREAD-EYE-2: a temp (negative id) layer never reaches apiUpdateLayer or the saved store", () => {
    // With correct wiring temp layers never enter this store; this guards the API boundary
    // if a future change leaks one into it.
    seedLayer(-2, { visible: true });
    const { result } = renderHook(() => useLayerVisibilityToggle(), { wrapper });
    act(() => result.current(-2, false));
    expect(updateLayerApi).not.toHaveBeenCalled();
    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === -2)!;
    expect((layer.config as Record<string, unknown>).visible).toBe(true);
  });
});
