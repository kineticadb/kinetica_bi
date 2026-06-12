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
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerVisibilityToggle } from "./useLayerVisibilityToggle";
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import { useWidgetActionStore } from "../store/widgetActionStore";
import type { DashboardLayerDto } from "../api/client";

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
