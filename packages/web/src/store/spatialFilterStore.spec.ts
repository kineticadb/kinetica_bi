import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpatialFilterStore, type Shape } from "./spatialFilterStore";

// Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.
// No explicit beforeEach reset of the store is needed — the shim handles it.

describe("useSpatialFilterStore — Phase 27 (STORE-V15-01..03)", () => {
  let uuidCounter = 0;

  beforeEach(() => {
    uuidCounter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `uuid-${++uuidCounter}` as ReturnType<typeof crypto.randomUUID>,
    );
    vi.spyOn(Date, "now").mockReturnValue(12345);
  });

  // ---------- Canary: prove Zustand reset shim is active ----------

  it("C1: initial state — shapes [], spatialFilterVersion 0, shapeCounter 0", () => {
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
  });

  it("C2: initial state again (proves shim resets between tests)", () => {
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
  });

  // ---------- addShape ----------

  it("A1: addShape synthesizes id (crypto.randomUUID), label, addedAt; preserves type/wkt/measurement", () => {
    useSpatialFilterStore.getState().addShape({
      type: "bbox",
      wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
      measurement: "5km × 3km",
    });
    const shape = useSpatialFilterStore.getState().shapes[0];
    expect(shape.id).toBe("uuid-1");
    expect(shape.label).toBe("Bbox 1");
    expect(shape.addedAt).toBe(12345);
    expect(shape.type).toBe("bbox");
    expect(shape.wkt).toBe("POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))");
    expect(shape.measurement).toBe("5km × 3km");
  });

  it("A2: addShape bumps spatialFilterVersion +1 and shapeCounter +1", () => {
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(1);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(1);
  });

  it("A3: label capitalization for all three types — bbox→Bbox, lasso→Lasso, circle→Circle", () => {
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
    expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Bbox 1");
    useSpatialFilterStore.getState().reset();
    useSpatialFilterStore.getState().addShape({ type: "lasso", wkt: "W", measurement: "M" });
    expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Lasso 1");
    useSpatialFilterStore.getState().reset();
    useSpatialFilterStore.getState().addShape({ type: "circle", wkt: "W", measurement: "M" });
    expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Circle 1");
  });

  it("A4: N counter is session-wide global (Bbox 1, Circle 2, Lasso 3, Bbox 4 — NOT per-type)", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
    s.addShape({ type: "circle", wkt: "W", measurement: "M" });
    s.addShape({ type: "lasso", wkt: "W", measurement: "M" });
    s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
    const labels = useSpatialFilterStore.getState().shapes.map((sh) => sh.label);
    expect(labels).toEqual(["Bbox 1", "Circle 2", "Lasso 3", "Bbox 4"]);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(4);
  });

  // ---------- removeShape ----------

  it("R1: removeShape(existing) drops the shape and bumps spatialFilterVersion +1", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
    s.addShape({ type: "circle", wkt: "W2", measurement: "M2" });
    const firstId = useSpatialFilterStore.getState().shapes[0].id;
    useSpatialFilterStore.getState().removeShape(firstId);
    const after = useSpatialFilterStore.getState();
    expect(after.shapes.length).toBe(1);
    expect(after.shapes[0].label).toBe("Circle 2");
    expect(after.spatialFilterVersion).toBe(3); // 2 adds + 1 remove
  });

  it("R2: removeShape(non-existent) is a strict no-op (no version bump, shapes reference preserved)", () => {
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
    const before = useSpatialFilterStore.getState();
    const beforeShapesRef = before.shapes;
    const beforeVersion = before.spatialFilterVersion;
    useSpatialFilterStore.getState().removeShape("nonexistent-id-zzz");
    const after = useSpatialFilterStore.getState();
    expect(after.shapes).toBe(beforeShapesRef); // reference identity preserved
    expect(after.spatialFilterVersion).toBe(beforeVersion);
    expect(after.shapeCounter).toBe(1);
  });

  it("R3: post-removal counter is monotonic — no recycling (Bbox 1, Bbox 2, remove first, addShape → Bbox 3)", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
    s.addShape({ type: "bbox", wkt: "W2", measurement: "M2" });
    const firstId = useSpatialFilterStore.getState().shapes[0].id;
    useSpatialFilterStore.getState().removeShape(firstId);
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W3", measurement: "M3" });
    const labels = useSpatialFilterStore.getState().shapes.map((sh) => sh.label);
    expect(labels).toEqual(["Bbox 2", "Bbox 3"]); // NOT ["Bbox 2", "Bbox 2"] — counter never recycles
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(3);
  });

  // ---------- clearAll ----------

  it("CL1: clearAll with shapes empties array, resets shapeCounter to 0, bumps spatialFilterVersion +1", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
    s.addShape({ type: "circle", wkt: "W2", measurement: "M2" });
    useSpatialFilterStore.getState().clearAll();
    const after = useSpatialFilterStore.getState();
    expect(after.shapes).toEqual([]);
    expect(after.shapeCounter).toBe(0);
    expect(after.spatialFilterVersion).toBe(3); // 2 adds + 1 clearAll
  });

  it("CL2: clearAll when empty is a strict no-op (no version bump, shapes reference preserved)", () => {
    const before = useSpatialFilterStore.getState();
    const beforeShapesRef = before.shapes;
    useSpatialFilterStore.getState().clearAll();
    const after = useSpatialFilterStore.getState();
    expect(after.shapes).toBe(beforeShapesRef);
    expect(after.spatialFilterVersion).toBe(0);
    expect(after.shapeCounter).toBe(0);
  });

  it("CL3: post-clearAll counter resets — next addShape produces {Type} 1", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
    useSpatialFilterStore.getState().clearAll();
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W2", measurement: "M2" });
    const after = useSpatialFilterStore.getState();
    expect(after.shapes[0].label).toBe("Bbox 1");
    expect(after.shapeCounter).toBe(1);
  });

  // ---------- reset ----------

  it("RS1: reset zeroes shapes, spatialFilterVersion, and shapeCounter", () => {
    const s = useSpatialFilterStore.getState();
    s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
    s.addShape({ type: "circle", wkt: "W", measurement: "M" });
    useSpatialFilterStore.getState().reset();
    const after = useSpatialFilterStore.getState();
    expect(after.shapes).toEqual([]);
    expect(after.spatialFilterVersion).toBe(0);
    expect(after.shapeCounter).toBe(0);
  });

  // ---------- structural ----------

  it("K1: state keys are exactly { shapes, spatialFilterVersion, shapeCounter, addShape, removeShape, clearAll, reset }", () => {
    const keys = Object.keys(useSpatialFilterStore.getState()).sort();
    expect(keys).toEqual(
      ["addShape", "clearAll", "removeShape", "reset", "shapeCounter", "shapes", "spatialFilterVersion"].sort(),
    );
  });

  it("K2 (compile-time): Shape type requires all six fields", () => {
    const ok: Shape = {
      id: "x",
      type: "bbox",
      wkt: "POLYGON(())",
      label: "Bbox 1",
      measurement: "5km × 3km",
      addedAt: 12345,
    };
    expect(ok.id).toBeTypeOf("string");
    // @ts-expect-error — addedAt missing from this assignment
    const bad: Shape = {
      id: "x", type: "bbox", wkt: "P", label: "L", measurement: "M",
    };
    void bad;
  });
});
