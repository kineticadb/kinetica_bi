import { describe, it, expect } from "vitest";
import { useMapViewportSyncStore, type ViewportSnapshot } from "./mapViewportSyncStore";

// Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.
// No explicit beforeEach reset of the store is needed — the shim handles it.

const snapA: ViewportSnapshot = {
  center: [1_500_000, 6_000_000],
  zoom: 8,
  originWidgetId: 11,
  bump: 1_000_000,
};

const snapB: ViewportSnapshot = {
  center: [2_000_000, 7_000_000],
  zoom: 10,
  originWidgetId: 11,
  bump: 1_000_001,
};

const snapC: ViewportSnapshot = {
  center: [3_000_000, 8_000_000],
  zoom: 12,
  originWidgetId: 22,
  bump: 1_000_002,
};

describe("useMapViewportSyncStore — Phase 104 (MAPSYNC-V119-01..06)", () => {

  // ---------- Canary: initial state ----------

  it("I1: initial state — viewports is {}", () => {
    expect(useMapViewportSyncStore.getState().viewports).toEqual({});
  });

  it("I2: initial state again (proves shim resets between tests)", () => {
    expect(useMapViewportSyncStore.getState().viewports).toEqual({});
  });

  // ---------- publish ----------

  it("P1: publish(1, snapA) writes snapA at viewports[1]", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    expect(useMapViewportSyncStore.getState().viewports[1]).toEqual(snapA);
  });

  it("P2: publish(1, snapB) overwrites viewports[1] with snapB (single slot per dashboard)", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    useMapViewportSyncStore.getState().publish(1, snapB);
    expect(useMapViewportSyncStore.getState().viewports[1]).toEqual(snapB);
  });

  it("P3: publish to different dashboardIds are isolated — viewports[1]===snapA and viewports[2]===snapC", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    useMapViewportSyncStore.getState().publish(2, snapC);
    const { viewports } = useMapViewportSyncStore.getState();
    expect(viewports[1]).toEqual(snapA);
    expect(viewports[2]).toEqual(snapC);
  });

  // ---------- clear ----------

  it("CL1: clear(1) after publish(1, snapA) sets viewports[1] to undefined", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    useMapViewportSyncStore.getState().clear(1);
    expect(useMapViewportSyncStore.getState().viewports[1]).toBeUndefined();
  });

  it("CL2: clear(1) leaves other keys untouched — publish(1,snapA), publish(2,snapC), clear(1) → viewports[2]===snapC", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    useMapViewportSyncStore.getState().publish(2, snapC);
    useMapViewportSyncStore.getState().clear(1);
    const { viewports } = useMapViewportSyncStore.getState();
    expect(viewports[1]).toBeUndefined();
    expect(viewports[2]).toEqual(snapC);
  });

  // ---------- reset ----------

  it("RS1: reset() after publishing several brings viewports back to {}", () => {
    useMapViewportSyncStore.getState().publish(1, snapA);
    useMapViewportSyncStore.getState().publish(2, snapC);
    useMapViewportSyncStore.getState().reset();
    expect(useMapViewportSyncStore.getState().viewports).toEqual({});
  });

  // ---------- ViewportSnapshot shape ----------

  it("VS1: ViewportSnapshot carries center:[number,number], zoom:number, originWidgetId:number, bump:number", () => {
    const snap: ViewportSnapshot = {
      center: [1_000, 2_000],
      zoom: 5.5,
      originWidgetId: 99,
      bump: Date.now(),
    };
    useMapViewportSyncStore.getState().publish(7, snap);
    const stored = useMapViewportSyncStore.getState().viewports[7]!;
    expect(stored.center).toEqual([1_000, 2_000]);
    expect(stored.zoom).toBe(5.5);
    expect(stored.originWidgetId).toBe(99);
    expect(typeof stored.bump).toBe("number");
  });

  // ---------- structural ----------

  it("K1: state keys are exactly { viewports, publish, clear, reset }", () => {
    const keys = Object.keys(useMapViewportSyncStore.getState()).sort();
    expect(keys).toEqual(["clear", "publish", "reset", "viewports"].sort());
  });
});
