import { describe, it, expect } from "vitest";
import { resolveSpatialShapes } from "./resolveSpatialShapes";
import type { Shape } from "../store/spatialFilterStore";
import { SPATIAL_DRAWS_SENTINEL } from "../components/charts/filterSourceTypes";

// Build full Shape fixtures (all fields required for correct typing against the real Shape type)
function makeShape(wkt: string, index = 1): Shape {
  return {
    id: `test-id-${index}`,
    type: "bbox",
    wkt,
    label: `Bbox ${index}`,
    measurement: `${index}km²`,
    addedAt: 1000 * index,
  };
}

const shapeA = makeShape("POLYGON((0 0,1 0,1 1,0 1,0 0))", 1);
const shapeB = makeShape("POLYGON((2 2,3 2,3 3,2 3,2 2))", 2);
const shapes = [shapeA, shapeB];

describe("resolveSpatialShapes", () => {
  // Test 1: accept-all default — cfg undefined → all shapes
  it("returns all shapes when cfg is undefined (accept-all default)", () => {
    const result = resolveSpatialShapes(undefined, shapes);
    expect(result).toEqual(shapes);
  });

  // Test 2: sourceMode "all" → all shapes
  it("returns all shapes when sourceMode is 'all'", () => {
    const result = resolveSpatialShapes(
      { sourceMode: "all", allowedSourceWidgetIds: [] },
      shapes,
    );
    expect(result).toEqual(shapes);
  });

  // Test 3: allowlist + SPATIAL_DRAWS_SENTINEL present → all shapes
  it("returns all shapes when sourceMode is 'allowlist' and SPATIAL_DRAWS_SENTINEL is in allowedSourceWidgetIds", () => {
    const result = resolveSpatialShapes(
      { sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL] },
      shapes,
    );
    expect(result).toEqual(shapes);
  });

  // Test 4: allowlist + sentinel absent (numeric id only) → []
  it("returns [] when sourceMode is 'allowlist' and SPATIAL_DRAWS_SENTINEL is absent (numeric id only)", () => {
    const result = resolveSpatialShapes(
      { sourceMode: "allowlist", allowedSourceWidgetIds: [42] },
      shapes,
    );
    expect(result).toEqual([]);
  });

  // Test 5: allowlist + empty allowedSourceWidgetIds → []
  it("returns [] when sourceMode is 'allowlist' and allowedSourceWidgetIds is empty", () => {
    const result = resolveSpatialShapes(
      { sourceMode: "allowlist", allowedSourceWidgetIds: [] },
      shapes,
    );
    expect(result).toEqual([]);
  });

  // Test 6: empty shapes passthrough — any config → [] (no crash, no mutation)
  it("returns [] when allShapes is empty regardless of config", () => {
    const r1 = resolveSpatialShapes(undefined, []);
    const r2 = resolveSpatialShapes(
      { sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL] },
      [],
    );
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
  });

  // NO-MUTATION: returned array is a copy; mutating it does not affect the input
  it("returns a copy (mutating result does not affect the original shapes array)", () => {
    const input = [shapeA, shapeB];
    const result = resolveSpatialShapes(undefined, input);
    // Mutate the returned array
    result.push(makeShape("POLYGON((9 9,10 9,10 10,9 10,9 9))", 99));
    // Original input must be unaffected
    expect(input).toHaveLength(2);
    expect(input).toEqual([shapeA, shapeB]);
  });

  // NO-MUTATION in the accept-all accept path (sentinel present)
  it("returns a copy in the sentinel-present accept path", () => {
    const input = [shapeA];
    const result = resolveSpatialShapes(
      { sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL] },
      input,
    );
    result.push(makeShape("POLYGON((5 5,6 5,6 6,5 6,5 5))", 50));
    expect(input).toHaveLength(1);
  });
});
