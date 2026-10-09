import { describe, it, expect } from "vitest";
import { dvSourceComboHash } from "./dvSourceCombo";
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
