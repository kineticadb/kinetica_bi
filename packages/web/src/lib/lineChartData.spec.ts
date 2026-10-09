import { describe, it, expect } from "vitest";
import {
  sortLineRowsByX,
  buildLineCategoryCountSql,
  parseCategoryCount,
  lineCategoryNoteText,
  LINE_CATEGORY_NOTE_TITLE,
} from "./lineChartData";

const xs = (vals: unknown[]) => vals.map((x) => ({ x }));
const sortX = (vals: unknown[]) => sortLineRowsByX(xs(vals), (r) => r.x).map((r) => r.x);

describe("sortLineRowsByX", () => {
  it("LCD-1: numbers numerically", () => {
    expect(sortX([10, 2, 1])).toEqual([1, 2, 10]);
    expect(sortX(["10", "2", "1"])).toEqual(["1", "2", "10"]);
    expect(sortX(["1.5", "-2", "10"])).toEqual(["-2", "1.5", "10"]);
  });
  it("LCD-2: dates chronologically", () => {
    expect(sortX(["2024-03-01", "2024-01-15", "2023-12-31"])).toEqual(["2023-12-31", "2024-01-15", "2024-03-01"]);
    expect(sortX(["2024-01-05 10:00:00", "2024-01-05 09:30:00.000"])[0]).toBe("2024-01-05 09:30:00.000");
  });
  it("LCD-3: text A to Z", () => {
    expect(sortX(["b", "A", "c"])).toEqual(["A", "b", "c"]);
    expect(sortX([1, "x", 3])).toEqual([1, 3, "x"]);
  });
  it("LCD-4: missing last in original order", () => {
    expect(sortX([3, null, 1, undefined, "", "null"])).toEqual([1, 3, null, undefined, "", "null"]);
  });
  it("LCD-5: does not mutate and carries rows", () => {
    const input = Object.freeze([{ x: 3, value: "c" }, { x: 1, value: "a" }, { x: 2, value: "b" }]);
    const out = sortLineRowsByX(input, (r) => r.x);
    expect(out).not.toBe(input);
    expect(out.map((r) => r.value)).toEqual(["a", "b", "c"]);
    expect(input.map((r) => r.x)).toEqual([3, 1, 2]);
  });
});

describe("buildLineCategoryCountSql", () => {
  it("LCD-6: strips ORDER BY/LIMIT tail", () => {
    expect(buildLineCategoryCountSql("SELECT region, SUM(amount) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100", "region")).toBe(
      "SELECT COUNT(DISTINCT region) AS n FROM (SELECT region, SUM(amount) AS value FROM sales GROUP BY region) kbi_line_x",
    );
  });
  it("LCD-7: multi group-by with WHERE and trailing semicolon", () => {
    expect(buildLineCategoryCountSql("SELECT region, pay, AVG(fare) AS value FROM v_123 WHERE (x > 1) GROUP BY region, pay ORDER BY value ASC LIMIT 2400 ;", "region")).toBe(
      "SELECT COUNT(DISTINCT region) AS n FROM (SELECT region, pay, AVG(fare) AS value FROM v_123 WHERE (x > 1) GROUP BY region, pay) kbi_line_x",
    );
  });
  it("LCD-8: null when not derivable", () => {
    expect(buildLineCategoryCountSql("SELECT * FROM sales LIMIT 100", "region")).toBeNull();
    expect(buildLineCategoryCountSql("SELECT region, SUM(a) AS value FROM s GROUP BY region ORDER BY value DESC LIMIT 5", "")).toBeNull();
    expect(buildLineCategoryCountSql("SELECT region, SUM(a) AS value FROM s GROUP BY region ORDER BY value DESC", "region")).toBeNull();
  });
});

describe("parseCategoryCount", () => {
  it("LCD-9", () => {
    expect(parseCategoryCount([{ n: 40 }])).toBe(40);
    expect(parseCategoryCount([{ N: "17" }])).toBe(17);
    expect(parseCategoryCount([])).toBeNull();
    expect(parseCategoryCount([{ n: "abc" }])).toBeNull();
    expect(parseCategoryCount([{ n: -1 }])).toBeNull();
    expect(parseCategoryCount([{ n: 12.9 }])).toBe(12);
  });
});

describe("lineCategoryNoteText", () => {
  it("LCD-10: known total", () => {
    expect(lineCategoryNoteText({ shown: 5, total: 40 })).toBe("Showing 5 of 40 categories");
  });
  it("LCD-11: all present", () => {
    expect(lineCategoryNoteText({ shown: 7, total: 7 })).toBe("Some lower values are not shown (result limit reached)");
    expect(lineCategoryNoteText({ shown: 9, total: 7 })).toBe("Some lower values are not shown (result limit reached)");
  });
  it("LCD-12: unknown total", () => {
    expect(lineCategoryNoteText({ shown: 5, total: null })).toBe("Showing top 5 categories (more exist)");
  });
  it("LCD-13: tooltip title", () => {
    expect(LINE_CATEGORY_NOTE_TITLE).toBe('The query reached its Result limit, so lower-value points are not shown. Raise "Result limit" or narrow the query.');
  });
});
