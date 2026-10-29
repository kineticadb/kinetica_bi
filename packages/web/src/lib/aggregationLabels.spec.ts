import { describe, it, expect } from "vitest";
import { AGGREGATIONS, aggregationLabel, countTickFormatter, isCountAggregation, valueFormatColumn } from "./aggregationLabels";

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

describe("valueFormatColumn", () => {
  it("AGG-CNT-1: a count is a plain number, so the metric column's format does not apply", () => {
    expect(isCountAggregation("COUNT")).toBe(true);
    expect(isCountAggregation("count_distinct")).toBe(true);
    expect(isCountAggregation("SUM")).toBe(false);
    expect(isCountAggregation(undefined)).toBe(false);
    expect(valueFormatColumn("pickup_datetime", "COUNT")).toBe("");
    expect(valueFormatColumn("fare", "COUNT_DISTINCT")).toBe("");
    expect(valueFormatColumn("fare", "SUM")).toBe("fare");
    expect(valueFormatColumn("fare", undefined)).toBe("fare");
  });
});

describe("countTickFormatter", () => {
  it("AGG-CNT-3: count ticks get thousands separators; other aggregations get none (a year stays 2015)", () => {
    expect(countTickFormatter("COUNT")?.(32000)).toBe("32,000");
    expect(countTickFormatter("count_distinct")?.(1500)).toBe("1,500");
    expect(countTickFormatter("COUNT")?.("x")).toBe("x");
    expect(countTickFormatter("SUM")).toBeUndefined();
    expect(countTickFormatter(undefined)).toBeUndefined();
  });
});
