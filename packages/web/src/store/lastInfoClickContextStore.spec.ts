import { describe, it, expect } from "vitest";
import { useLastInfoClickContextStore, type LastInfoClickContext } from "./lastInfoClickContextStore";

const FIXTURE_CTX: LastInfoClickContext = {
  clickLon: -73.985,
  clickLat: 40.748,
  mapBbox: [-74.1, 40.6, -73.85, 40.85],
  mapWidthPx: 800,
  mapHeightPx: 600,
  radiusPx: 20,
  sourceWidgetId: 42,
};

describe("useLastInfoClickContextStore — Plan 23-02 (Phase 23 CARD-V14-02)", () => {
  // Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.

  it("L1: initial state has context: null", () => {
    expect(useLastInfoClickContextStore.getState().context).toBeNull();
  });

  it("L2: setContext writes the full LastInfoClickContext object (deep equality)", () => {
    useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
    expect(useLastInfoClickContextStore.getState().context).toEqual(FIXTURE_CTX);
  });

  it("L3: setContext is replace-semantics (not merge) — second call wins", () => {
    useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
    const ctxB: LastInfoClickContext = {
      ...FIXTURE_CTX,
      clickLon: -122.0,
      clickLat: 37.5,
      sourceWidgetId: 99,
    };
    useLastInfoClickContextStore.getState().setContext(ctxB);
    expect(useLastInfoClickContextStore.getState().context).toEqual(ctxB);
    expect(useLastInfoClickContextStore.getState().context?.clickLon).toBe(-122.0);
    expect(useLastInfoClickContextStore.getState().context?.sourceWidgetId).toBe(99);
  });

  it("L4: reset clears context to null even when previously set (Pitfall 1 lock)", () => {
    useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
    expect(useLastInfoClickContextStore.getState().context).not.toBeNull();
    useLastInfoClickContextStore.getState().reset();
    expect(useLastInfoClickContextStore.getState().context).toBeNull();
  });

  it("L5: store has only 'context' state field plus actions (no extra top-level keys)", () => {
    const state = useLastInfoClickContextStore.getState();
    const stateKeys = Object.keys(state).sort();
    expect(stateKeys).toEqual(["context", "reset", "setContext"]);
  });

  it("L6 (compile-time): LastInfoClickContext requires all seven fields", () => {
    // Positive: full assignment compiles.
    const ok: LastInfoClickContext = FIXTURE_CTX;
    expect(ok.clickLon).toBeTypeOf("number");
    expect(ok.clickLat).toBeTypeOf("number");
    expect(ok.mapBbox).toHaveLength(4);
    expect(ok.mapWidthPx).toBeTypeOf("number");
    expect(ok.mapHeightPx).toBeTypeOf("number");
    expect(ok.radiusPx).toBeTypeOf("number");
    expect(ok.sourceWidgetId).toBeTypeOf("number");

    // Negative: missing field would fail tsc; the @ts-expect-error directive enforces this.
    // @ts-expect-error — radiusPx missing from this assignment
    const bad: LastInfoClickContext = {
      clickLon: 0,
      clickLat: 0,
      mapBbox: [0, 0, 0, 0],
      mapWidthPx: 1,
      mapHeightPx: 1,
      sourceWidgetId: 0,
    };
    void bad;
  });
});
