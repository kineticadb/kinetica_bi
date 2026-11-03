import { describe, it, expect } from "vitest";
import { useFilterStore, type ActiveFilter } from "./filterStore";

const f = (column: string, extra: Partial<ActiveFilter> = {}): ActiveFilter => ({ column, value: "x", dataType: "string", addedAt: 0, ...extra });
const st = () => useFilterStore.getState();
const seed = (dv: Record<number, ActiveFilter[]>, t: Record<number, ActiveFilter[]> = {}) => useFilterStore.setState({ dvFilters: dv, filters: t });

describe("filterStore.rekeyDvFilters (141 D-13)", () => {
  it("KREKEY-1: moves a negative dv key to the saved id, table filters untouched, one tick", () => {
    const f1 = f("a"), f2 = f("b"), f3 = f("c");
    const tbl = [f3];
    seed({ [-3]: [f1], 7: [f2] }, { 5: tbl });
    const v = st().filterVersion;
    st().rekeyDvFilters({ "-3": 31 });
    expect(st().dvFilters).toEqual({ 31: [f1], 7: [f2] });
    expect(-3 in st().dvFilters).toBe(false);
    expect(st().filters[5]).toBe(tbl);
    expect(st().filterVersion).toBe(v + 1);
  });

  it("KREKEY-2: nothing negative -> no change, no tick", () => {
    seed({ 7: [f("b")] });
    const before = st();
    st().rekeyDvFilters({ "-3": 31 });
    expect(st()).toBe(before);
    expect(st().filterVersion).toBe(before.filterVersion);
  });

  it("KREKEY-3: an unmapped negative key is dropped", () => {
    seed({ [-4]: [f("a")] });
    const v = st().filterVersion;
    st().rekeyDvFilters({});
    expect(st().dvFilters).toEqual({});
    expect(st().filterVersion).toBe(v + 1);
  });

  it("KREKEY-4: widget map remaps negative sourceWidgetId in dv and table filters, one tick", () => {
    seed({ [-3]: [f("a", { sourceWidgetId: -1 })] }, { 5: [f("t", { sourceWidgetId: -1 })] });
    const v = st().filterVersion;
    st().rekeyDvFilters({ "-3": 31 }, { "-1": 41 });
    expect(st().dvFilters[31][0]).toEqual(f("a", { sourceWidgetId: 41 }));
    expect(st().filters[5][0].sourceWidgetId).toBe(41);
    expect(st().filterVersion).toBe(v + 1);
  });

  it("KREKEY-5: merging into an id that already has filters keeps existing first", () => {
    const a = f("a"), b = f("b");
    seed({ [-3]: [a], 31: [b] });
    st().rekeyDvFilters({ "-3": 31 });
    expect(st().dvFilters[31]).toEqual([b, a]);
  });
});
