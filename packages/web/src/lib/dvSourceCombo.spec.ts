import { describe, it, expect } from "vitest";
import { dvSourceComboHash, resolveDvSourceSpatial } from "./dvSourceCombo";
import type { WidgetDto } from "../api/client";
import { stableComboHash } from "./stableComboHash";
import type { ActiveFilter } from "../store/filterStore";

const f = (column: string, value: unknown, operator = "eq"): ActiveFilter =>
  ({ column, operator, value } as unknown as ActiveFilter);

describe("dvSourceComboHash", () => {
  it("DVCOMBO-H1: no filters -> undefined", () => {
    expect(dvSourceComboHash(7, [])).toBeUndefined();
    expect(dvSourceComboHash(7, undefined)).toBeUndefined();
  });
  it("DVCOMBO-H2: equals stableComboHash('table', id, filters) and is not NOFILTER", () => {
    const filters = [f("vendor", "A")];
    const h = dvSourceComboHash(7, filters);
    expect(h).toBe(stableComboHash("table", 7, filters));
    expect(h!.endsWith(":NOFILTER")).toBe(false);
  });
  it("DVCOMBO-H3: filter order does not matter", () => {
    const a = f("vendor", "A");
    const b = f("fare", 10, "gt");
    expect(dvSourceComboHash(7, [a, b])).toBe(dvSourceComboHash(7, [b, a]));
  });
});

describe("dvSourceComboHash — spatial (quick-261009-jg6 task 2b)", () => {
  const shape = { id: "s1", type: "circle", wkt: "POLYGON((0 0,1 0,1 1,0 0))", label: "Circle 1", measurement: "1 km", addedAt: 1 } as const;
  const mapW = (tableId: number) =>
    ({ id: 1, type: "map", config: { spatialTargets: [{ tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }] } }) as unknown as WidgetDto;

  it("DVCOMBO-SP-H1: spatial-only -> defined hash equal to stableComboHash('table', id, [], shapes)", () => {
    const h = dvSourceComboHash(7, [], [shape]);
    expect(h).toBe(stableComboHash("table", 7, [], [shape]));
    expect(h!.endsWith(":NOFILTER")).toBe(false);
  });
  it("DVCOMBO-SP-H2: resolveDvSourceSpatial returns shapes+target only when the table has an eligible target", () => {
    const withT = resolveDvSourceSpatial(7, [mapW(7)], [shape]);
    expect(withT.shapes).toEqual([shape]);
    expect(withT.target).toMatchObject({ tableId: 7, spatialMode: "latlon" });
    const noT = resolveDvSourceSpatial(7, [mapW(9)], [shape]);
    expect(noT.shapes).toEqual([]);
    expect(noT.target).toBeUndefined();
  });
});
