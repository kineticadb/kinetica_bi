import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiEditLock, isAiEditLocked } from "./useAiEditLock";
import { useEffectiveLayers } from "./useEffectiveLayers";
import { useAiSessionActions } from "./useAiSessionActions";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import { baselineFixture, addWidgetOp, removeLayerOp, addLayerOp, patchWidgetOp, mapWidget, savedLayer } from "../test/aiSessionHarness";

const baseline = baselineFixture();

describe("ai session hooks", () => {
  it("AIHOOK-1: edit lock follows applied turns", () => {
    const { result } = renderHook(() => useAiEditLock());
    expect(result.current).toBe(false);
    act(() => {
      useAiSessionStore.getState().applyTurn({ prompt: "p", ops: [addWidgetOp(-1)] }, baseline);
    });
    expect(result.current).toBe(true);
    expect(isAiEditLocked()).toBe(true);
    act(() => useAiSessionStore.getState().reset());
    expect(result.current).toBe(false);
    expect(isAiEditLocked()).toBe(false);
  });

  it("AIHOOK-2: effective layers = saved by identity, or merged after a turn", () => {
    const saved = [savedLayer(7), savedLayer(8)];
    useDashboardLayersStore.setState({ layers: saved });
    const { result } = renderHook(() => useEffectiveLayers());
    expect(result.current).toBe(saved);
    act(() => {
      useAiSessionStore.getState().applyTurn({ prompt: "p", ops: [removeLayerOp(7), addLayerOp(-2, 42)] }, baseline);
    });
    expect(result.current.map((l) => l.id)).toEqual([8, -2]);
  });

  it("AIHOOK-3: effective layers is stable across re-renders", () => {
    useDashboardLayersStore.setState({ layers: [savedLayer(7)] });
    act(() => {
      useAiSessionStore.getState().applyTurn({ prompt: "p", ops: [addLayerOp(-2, 42)] }, baseline);
    });
    const { result, rerender } = renderHook(() => useEffectiveLayers());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("AIHOOK-4: actions are stable, read the latest baseline, discard resets", () => {
    let b = baseline;
    const { result, rerender } = renderHook(() => useAiSessionActions(() => b));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    const r1 = result.current.applyTurn({ prompt: "p", ops: [patchWidgetOp(77, { show_popup: true })] });
    expect(r1.entries[0].result.status).toBe("skipped");
    b = baselineFixture({ widgets: [...baseline.widgets, mapWidget(77)] });
    const r2 = result.current.applyTurn({ prompt: "p", ops: [patchWidgetOp(77, { show_popup: true })] });
    expect(r2.entries[0].result.status).toBe("applied");
    result.current.setCursor(-1);
    expect(useAiSessionStore.getState().cursor).toBe(-1);
    result.current.discard();
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
  });
});
