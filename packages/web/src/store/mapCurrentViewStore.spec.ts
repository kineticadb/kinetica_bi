import { describe, it, expect } from "vitest";
import { useMapCurrentViewStore, type MapCurrentView } from "./mapCurrentViewStore";

// Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.
// No explicit beforeEach reset of the store is needed — the shim handles it.

const viewA: MapCurrentView = { center: [1_500_000, 6_000_000], zoom: 8 };
const viewB: MapCurrentView = { center: [2_000_000, 7_000_000], zoom: 10 };
const viewC: MapCurrentView = { center: [3_000_000, 8_000_000], zoom: 12 };

describe("useMapCurrentViewStore — Phase 111 (MAPVIEW-V121-01/04)", () => {

  // ---------- Canary: initial state ----------

  it("I1: initial state — views is {}", () => {
    expect(useMapCurrentViewStore.getState().views).toEqual({});
  });

  it("I2: initial state again (proves the zustand shim resets between tests)", () => {
    expect(useMapCurrentViewStore.getState().views).toEqual({});
  });

  // ---------- publish ----------

  it("P1: publish(10, viewA) writes viewA at views[10]", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    expect(useMapCurrentViewStore.getState().views[10]).toEqual(viewA);
  });

  it("P2: publish(10, viewA) then publish(10, viewB) — views[10] equals viewB (single slot per widget)", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    useMapCurrentViewStore.getState().publish(10, viewB);
    expect(useMapCurrentViewStore.getState().views[10]).toEqual(viewB);
  });

  it("P3: publish(10, viewA) and publish(20, viewC) are isolated — views[10]===viewA AND views[20]===viewC", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    useMapCurrentViewStore.getState().publish(20, viewC);
    const { views } = useMapCurrentViewStore.getState();
    expect(views[10]).toEqual(viewA);
    expect(views[20]).toEqual(viewC);
  });

  it("P4: publish preserves the EXACT fractional zoom — no rounding", () => {
    useMapCurrentViewStore.getState().publish(10, { center: [1, 2], zoom: 12.437 });
    expect(useMapCurrentViewStore.getState().views[10]!.zoom).toBe(12.437);
  });

  // ---------- clear ----------

  it("C1: clear(10) deletes views[10] (becomes undefined) and leaves views[20] intact", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    useMapCurrentViewStore.getState().publish(20, viewC);
    useMapCurrentViewStore.getState().clear(10);
    const { views } = useMapCurrentViewStore.getState();
    expect(views[10]).toBeUndefined();
    expect(views[20]).toEqual(viewC);
  });

  it("C2: clear(99) on an absent key is a no-op (does not throw, other entries untouched)", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    expect(() => useMapCurrentViewStore.getState().clear(99)).not.toThrow();
    expect(useMapCurrentViewStore.getState().views[10]).toEqual(viewA);
  });

  // ---------- reset ----------

  it("R1: reset() sets views back to {} after multiple publishes", () => {
    useMapCurrentViewStore.getState().publish(10, viewA);
    useMapCurrentViewStore.getState().publish(20, viewC);
    useMapCurrentViewStore.getState().reset();
    expect(useMapCurrentViewStore.getState().views).toEqual({});
  });
});
