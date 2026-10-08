import { describe, it, expect } from "vitest";
import { AGGREGATIONS, aggregationLabel } from "./aggregationLabels";

describe("aggregationLabels", () => {
  it("AGG-L1: the 8 aggregations in picker order", () => {
    expect(AGGREGATIONS.map((a) => a.value)).toEqual(["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT", "STDDEV", "VARIANCE"]);
    expect(AGGREGATIONS.map((a) => a.label)).toEqual(["Sum", "Average", "Min", "Max", "Count", "Count Distinct", "Std Deviation", "Variance"]);
  });
  it("AGG-L2: known values resolve to labels", () => {
    expect(aggregationLabel("COUNT_DISTINCT")).toBe("Count Distinct");
    expect(aggregationLabel("AVG")).toBe("Average");
  });
  it("AGG-L3: unknown passes through, empty gives empty", () => {
    expect(aggregationLabel("FOO")).toBe("FOO");
    expect(aggregationLabel(undefined)).toBe("");
    expect(aggregationLabel("")).toBe("");
  });
});
