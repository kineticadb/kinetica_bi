import { describe, it, expect } from "vitest";
import { resolveLineMetricTitle } from "./lineChartTitle";

describe("resolveLineMetricTitle", () => {
  it("LCT-1: Y-axis label wins", () => {
    expect(resolveLineMetricTitle({ yFieldLabel: "Revenue", customLabel: "C", columnLabel: "Fare ($)", metricColumn: "fare", aggregation: "SUM" })).toBe("Revenue");
  });
  it("LCT-2: custom metric label next", () => {
    expect(resolveLineMetricTitle({ yFieldLabel: "", customLabel: "Avg tip", metricColumn: "", aggregation: "SUM" })).toBe("Avg tip");
  });
  it("LCT-3: Format-columns label next", () => {
    expect(resolveLineMetricTitle({ columnLabel: "Fare ($)", metricColumn: "fare", aggregation: "SUM" })).toBe("Fare ($)");
  });
  it("LCT-4: label equal to raw column is unset", () => {
    expect(resolveLineMetricTitle({ columnLabel: "fare_amount", metricColumn: "fare_amount", aggregation: "SUM" })).toBe("Sum of fare_amount");
  });
  it("LCT-5: Aggregation of column", () => {
    expect(resolveLineMetricTitle({ metricColumn: "trip_id", aggregation: "COUNT_DISTINCT" })).toBe("Count Distinct of trip_id");
    expect(resolveLineMetricTitle({ metricColumn: "fare", aggregation: "AVG" })).toBe("Average of fare");
  });
  it("LCT-6: bare column", () => {
    expect(resolveLineMetricTitle({ metricColumn: "fare" })).toBe("fare");
  });
  it("LCT-7: fallback never yields value", () => {
    expect(resolveLineMetricTitle({ fallbackKey: "value" })).toBe("Metric");
    expect(resolveLineMetricTitle({})).toBe("Metric");
    expect(resolveLineMetricTitle({ fallbackKey: "fare" })).toBe("fare");
    expect(resolveLineMetricTitle({ yFieldLabel: "   ", fallbackKey: "value" })).toBe("Metric");
  });
  it("LCT-8: never value / never empty over all combinations", () => {
    for (const yFieldLabel of ["", "Y"])
      for (const customLabel of [null, "", "C"])
        for (const columnLabel of [null, "fare", "L"])
          for (const metricColumn of ["", "fare"])
            for (const aggregation of [undefined, "SUM"])
              for (const fallbackKey of [undefined, "value"]) {
                const r = resolveLineMetricTitle({ yFieldLabel, customLabel, columnLabel, metricColumn, aggregation, fallbackKey });
                expect(r).not.toBe("");
                expect(r).not.toBe("value");
              }
  });
});
