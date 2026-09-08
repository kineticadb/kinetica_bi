import { describe, it, expect } from "vitest";
import {
  buildHeatmapGrid,
  cellKey,
  orderAxis,
  resolveHeatmapColumns,
  sliceDomain,
} from "./heatmapGrid";

const rows = [
  { day_name: "Monday", hour_of_day: 0, value: 10 },
  { day_name: "Monday", hour_of_day: 1, value: 20 },
  { day_name: "Tuesday", hour_of_day: 0, value: 30 },
  { day_name: "Tuesday", hour_of_day: 1, value: 40 },
];

describe("orderAxis", () => {
  it("sorts an all-numeric axis numerically, not lexically", () => {
    // The bug this prevents: string sort gives 0,1,10,11,2,... for hour_of_day.
    const hours = ["0", "1", "2", "10", "11", "23"];
    expect(orderAxis(["10", "2", "0", "23", "1", "11"])).toEqual(hours);
  });

  it("keeps first-seen order for a textual axis so SQL ORDER BY survives", () => {
    const days = ["Monday", "Tuesday", "Wednesday"];
    expect(orderAxis(days)).toEqual(days);
    // Alphabetizing would give Monday, Tuesday, Wednesday here by luck, so use
    // a sequence where alphabetical and meaningful order genuinely differ.
    expect(orderAxis(["Friday", "Saturday", "Sunday"])).toEqual([
      "Friday", "Saturday", "Sunday",
    ]);
  });

  it("keeps first-seen order for a mixed axis", () => {
    expect(orderAxis(["10", "n/a", "2"])).toEqual(["10", "n/a", "2"]);
  });

  it("handles an empty axis", () => {
    expect(orderAxis([])).toEqual([]);
  });
});

describe("cellKey", () => {
  it("cannot collide when a value contains the delimiter-adjacent text", () => {
    // A printable delimiter (e.g. " / ") collides for these two pairs; NUL cannot.
    expect(cellKey("a", "b c")).not.toBe(cellKey("a b", "c"));
  });
});

describe("buildHeatmapGrid", () => {
  it("builds axes and cells from the aggregated row shape", () => {
    const g = buildHeatmapGrid(rows, "day_name", "hour_of_day");
    expect(g.xValues).toEqual(["Monday", "Tuesday"]);
    expect(g.yValues).toEqual(["0", "1"]);
    expect(g.cells.size).toBe(4);
    expect(g.cells.get(cellKey("Tuesday", "1"))?.value).toBe(40);
    expect(g.domain).toEqual([10, 40]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["non-numeric text", "n/a"],
    ["NaN", NaN],
  ])("SKIPS a %s value so a missing cell never renders as zero", (_label, bad) => {
    // Number(null) and Number("") are both 0 — coercing first would silently
    // turn a SQL NULL into a populated zero cell.
    const g = buildHeatmapGrid(
      [...rows, { day_name: "Sunday", hour_of_day: 5, value: bad }],
      "day_name",
      "hour_of_day",
    );
    expect(g.cells.get(cellKey("Sunday", "5"))).toBeUndefined();
    expect(g.domain).toEqual([10, 40]);
  });

  it("coerces numeric strings (a driver may return NUMERIC as text)", () => {
    const g = buildHeatmapGrid(
      [{ x: "a", y: "b", value: "7.5" }],
      "x",
      "y",
    );
    expect(g.cells.get(cellKey("a", "b"))?.value).toBe(7.5);
  });

  it("returns a null domain and empty axes for no usable rows", () => {
    const g = buildHeatmapGrid([], "x", "y");
    expect(g.domain).toBeNull();
    expect(g.xValues).toEqual([]);
    expect(g.cells.size).toBe(0);
  });

  it("keeps a genuine 0 as a populated cell", () => {
    const g = buildHeatmapGrid([{ x: "a", y: "b", value: 0 }], "x", "y");
    expect(g.cells.get(cellKey("a", "b"))?.value).toBe(0);
    expect(g.domain).toEqual([0, 0]);
  });

  it("last row wins for a duplicated (x,y) pair", () => {
    const g = buildHeatmapGrid(
      [{ x: "a", y: "b", value: 1 }, { x: "a", y: "b", value: 2 }],
      "x",
      "y",
    );
    expect(g.cells.get(cellKey("a", "b"))?.value).toBe(2);
  });
});

describe("sliceDomain", () => {
  const g = buildHeatmapGrid(rows, "day_name", "hour_of_day");

  it("'heatmap' mode uses the whole grid domain", () => {
    expect(sliceDomain(g, "heatmap", "Monday", "0")).toEqual([10, 40]);
  });

  it("'x' mode uses only the cell's column", () => {
    expect(sliceDomain(g, "x", "Monday", "0")).toEqual([10, 20]);
    expect(sliceDomain(g, "x", "Tuesday", "0")).toEqual([30, 40]);
  });

  it("'y' mode uses only the cell's row", () => {
    expect(sliceDomain(g, "y", "Monday", "0")).toEqual([10, 30]);
    expect(sliceDomain(g, "y", "Monday", "1")).toEqual([20, 40]);
  });

  it("falls back to the grid domain for an empty slice", () => {
    expect(sliceDomain(g, "x", "Nonexistent", "0")).toEqual([10, 40]);
  });
});

describe("resolveHeatmapColumns", () => {
  it("prefers the configured groupByColumns order (x first, y second)", () => {
    expect(
      resolveHeatmapColumns({ groupByColumns: ["day_name", "hour_of_day"] }, rows),
    ).toEqual({ xCol: "day_name", yCol: "hour_of_day" });
  });

  it("respects a swapped configuration", () => {
    expect(
      resolveHeatmapColumns({ groupByColumns: ["hour_of_day", "day_name"] }, rows),
    ).toEqual({ xCol: "hour_of_day", yCol: "day_name" });
  });

  it("ignores configured columns absent from the rows", () => {
    expect(
      resolveHeatmapColumns({ groupByColumns: ["gone", "day_name"] }, rows),
    ).toEqual({ xCol: "day_name", yCol: "hour_of_day" });
  });

  it("infers from the row shape for a legacy sql-only widget", () => {
    expect(resolveHeatmapColumns({}, rows)).toEqual({
      xCol: "day_name",
      yCol: "hour_of_day",
    });
  });

  it("returns null when fewer than two dimensions are available", () => {
    expect(resolveHeatmapColumns({}, [{ day_name: "Monday", value: 1 }])).toBeNull();
    expect(resolveHeatmapColumns({}, [])).toBeNull();
  });
});

// ── Live-UAT regression: a date axis must read chronologically ───────────────
// Rows arrive ORDER BY value DESC, and a non-numeric axis keeps first-seen
// order, so a timestamp-string axis came out in METRIC order — the kind of
// silently-wrong axis a reader takes for a data bug.
describe("orderAxis — date mode", () => {
  it("sorts ISO timestamp strings chronologically, not in arrival order", () => {
    const arrival = ["2026-03-05T00:00:00Z", "2026-01-02T00:00:00Z", "2026-02-01T00:00:00Z"];
    expect(orderAxis(arrival, "date")).toEqual([
      "2026-01-02T00:00:00Z",
      "2026-02-01T00:00:00Z",
      "2026-03-05T00:00:00Z",
    ]);
  });

  it("sorts epoch values chronologically, seconds and millis alike", () => {
    // 1e9 seconds (2001) vs 1.7e12 ms (2023) — the shared normalizeToMs heuristic.
    expect(orderAxis(["1700000000000", "1000000000"], "date")).toEqual([
      "1000000000",
      "1700000000000",
    ]);
  });

  it("keeps unparseable values last, in their original relative order", () => {
    const mixed = ["nope", "2026-01-02T00:00:00Z", "also-bad"];
    expect(orderAxis(mixed, "date")).toEqual(["2026-01-02T00:00:00Z", "nope", "also-bad"]);
  });

  it("leaves auto mode untouched — text axes still keep first-seen order", () => {
    const days = ["Monday", "Tuesday", "Wednesday"];
    expect(orderAxis(days)).toEqual(days);
    expect(orderAxis(days, "auto")).toEqual(days);
  });

  it("buildHeatmapGrid threads the per-axis order through", () => {
    const rows = [
      { d: "2026-03-05", p: "a", value: 9 },
      { d: "2026-01-02", p: "a", value: 1 },
    ];
    // Default (auto): non-numeric, so first-seen (metric) order survives.
    expect(buildHeatmapGrid(rows, "p", "d").yValues).toEqual(["2026-03-05", "2026-01-02"]);
    // date: chronological regardless of arrival order.
    expect(buildHeatmapGrid(rows, "p", "d", { y: "date" }).yValues).toEqual([
      "2026-01-02",
      "2026-03-05",
    ]);
  });
});
