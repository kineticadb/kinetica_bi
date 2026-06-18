import { describe, it, expect, vi, beforeEach } from "vitest";

// ResizeObserver stub for Recharts ResponsiveContainer.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function MockResizeObserver(this: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  return this;
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import NumericLineRenderer from "./NumericLineRenderer";
import type { TableDto, WidgetDto } from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runSql: vi.fn() };
});

vi.mock("../DashboardContext", () => ({
  useDashboardContext: () => ({ dashboardId: 42, widgets: [], dynamicViews: [], retryDynamicView: () => {} }),
}));

const mockSetBulkFilters = vi.fn();
const mockMarkMaterializing = vi.fn();
let mockFilters: Record<number, unknown[]> = {};
let mockFilterVersion = 0;
let mockViews: Record<number, unknown> = {};

vi.mock("../../store/filterStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterStore = ((selector?: (s: unknown) => unknown) => {
    const state = { filters: mockFilters, filterVersion: mockFilterVersion };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterStore.getState = () => ({
    filters: mockFilters,
    filterVersion: mockFilterVersion,
    setBulkFilters: mockSetBulkFilters,
  });
  return { ...actual, useFilterStore };
});

vi.mock("../../store/filterViewStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterViewStore = ((selector?: (s: unknown) => unknown) => {
    const state = { views: mockViews, clearView: () => {} };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterViewStore.getState = () => ({
    views: mockViews,
    clearView: () => {},
    markMaterializing: mockMarkMaterializing,
  });
  return { ...actual, useFilterViewStore };
});

import { runSql } from "../../api/client";

const TABLES: TableDto[] = [
  {
    id: 1,
    name: "nyctaxi",
    schema: "demo",
    columns: { trip_distance: "double", fare_amount: "double" },
  } as unknown as TableDto,
];

function makeWidget(overrides: Record<string, unknown> = {}): WidgetDto {
  return {
    id: 100,
    dashboard_id: 1,
    type: "numericline",
    title: "NL",
    position: { x: 0, y: 0, w: 6, h: 4 },
    config: {
      tableId: 1,
      tableRef: "demo.nyctaxi",
      xField: "trip_distance",
      metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      maxBuckets: 50,
      showLegend: true,
      showTooltip: true,
      colorTheme: "Set2",
      ...overrides,
    },
    created_at: "", updated_at: "",
  } as unknown as WidgetDto;
}

function mockRangeAndMetric(lo: number, hi: number, metricRows: { bucket: number; value: number | null }[][]) {
  const rangeResp = { column_headers: ["lo", "hi"], column_1: [lo], column_2: [hi] };
  const metricResps = metricRows.map((rows) => ({
    column_headers: ["bucket", "value"],
    column_1: rows.map((r) => r.bucket),
    column_2: rows.map((r) => r.value),
  }));
  let call = 0;
  (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    if (call === 0) { call++; return Promise.resolve(rangeResp); }
    const idx = call - 1; call++;
    return Promise.resolve(metricResps[idx] ?? { column_headers: [], column_1: [] });
  });
}

beforeEach(() => {
  mockSetBulkFilters.mockClear();
  mockMarkMaterializing.mockClear();
  mockFilters = {};
  mockFilterVersion = 0;
  mockViews = {};
  (runSql as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe("NumericLineRenderer", () => {
  it("sole-trigger invariant: file never imports materializeFilter", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    expect((src.match(/materializeFilter/g) ?? []).length).toBe(0);
  });

  it("mount issues numeric range probe (MIN/MAX) first, then a FLOOR-bucket metric query", async () => {
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 12 }, { bucket: 2, value: 8 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0] as string).toBe(
      "SELECT MIN(trip_distance) AS lo, MAX(trip_distance) AS hi FROM demo.nyctaxi WHERE trip_distance IS NOT NULL",
    );
    const metricSql = calls[1][0] as string;
    expect(metricSql).toContain("FLOOR(trip_distance / 2) * 2 AS bucket"); // range 100 / 50 → width 2
    expect(metricSql).toContain("SUM(fare_amount) AS value");
    expect(metricSql).toContain("FROM demo.nyctaxi");
  });

  it("with an active filter-view, range + metric queries target the view (not the base table)", async () => {
    mockViews = { 1: { viewName: "_kbi_filt_test", materializing: false, expiresAt: Date.now() + 60_000 } };
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 1 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0] as string).toContain("FROM _kbi_filt_test");
    expect(calls[0][0] as string).not.toContain("FROM demo.nyctaxi");
    expect(calls[1][0] as string).toContain("FROM _kbi_filt_test");
  });

  it("suspends (no query) while the filter-view is materializing", async () => {
    mockViews = { 1: { viewName: undefined, materializing: true, expiresAt: 0 } };
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 1 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("renders the empty-state when no X-axis column is configured", () => {
    render(<NumericLineRenderer widget={makeWidget({ xField: "" })} tables={TABLES} />);
    expect(screen.getByText("No X-axis column selected.")).toBeInTheDocument();
  });

  it("vertical orientation: renders (data-vertical=\"true\") and still issues range + metric queries", async () => {
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 5 }, { bucket: 2, value: 9 }]]);
    render(<NumericLineRenderer widget={makeWidget({ vertical: true })} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId("numericline-renderer").getAttribute("data-vertical")).toBe("true");
  });

  it("drag-to-filter commits a BETWEEN filter with dataType 'number' on the xField (source assertion)", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    expect(src).toMatch(/column:\s*xField/);
    expect(src).toMatch(/dataType:\s*"number"/);
    expect(src).toMatch(/operator:\s*"between"/);
  });

  // ---- Phase 72: grouped (series-split) rendering (GROUP-V114-04 numeric-line half) ----

  describe("Grouped (Phase 72)", () => {
    // Feeds: [0] range, [1] top-N pre-query (series/value rows), [2] main grouped query (bucket/series/value rows).
    function mockGroupedResponse(
      lo: number,
      hi: number,
      topRows: { series: string; value: number }[],
      groupedRows: { bucket: number; series: string; value: number | null }[],
    ) {
      const rangeResp = { column_headers: ["lo", "hi"], column_1: [lo], column_2: [hi] };
      const topResp = {
        column_headers: ["series", "value"],
        column_1: topRows.map((r) => r.series),
        column_2: topRows.map((r) => r.value),
      };
      const groupedResp = {
        column_headers: ["bucket", "series", "value"],
        column_1: groupedRows.map((r) => r.bucket),
        column_2: groupedRows.map((r) => r.series),
        column_3: groupedRows.map((r) => r.value),
      };
      let call = 0;
      (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const resp = call === 0 ? rangeResp : call === 1 ? topResp : groupedResp;
        call++;
        return Promise.resolve(resp);
      });
    }

    it("grouped path issues range → top-N pre-query → main grouped query (GROUP BY bucket, series + IN allow-list)", async () => {
      mockGroupedResponse(
        0, 100,
        [{ series: "A", value: 100 }, { series: "B", value: 50 }],
        [
          { bucket: 0, series: "A", value: 10 },
          { bucket: 0, series: "B", value: 5 },
        ],
      );
      render(<NumericLineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
      await waitFor(() => {
        expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
      });
      const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const topSql = calls[1][0] as string;
      const mainSql = calls[2][0] as string;
      // top-N pre-query ranks series by aggregate value DESC
      expect(topSql).toMatch(/driver_id AS series/);
      expect(topSql).toMatch(/ORDER BY value DESC/);
      // main grouped query splits by series and filters to the top-N allow-list
      expect(mainSql).toMatch(/driver_id AS series/);
      expect(mainSql).toMatch(/GROUP BY bucket, series/);
      expect(mainSql).toMatch(/driver_id IN \(/);
    });

    it("grouped renderer plots one Line per series value with numeric bucket pivot + theme-ramp colors (source + render)", async () => {
      // Recharts does not render dimension-dependent SVG under JSDOM; assert the
      // one-Line-per-series architecture via SOURCE text + a completing render.
      const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
      expect(src).toMatch(/top\.series\.map/);
      expect(src).toMatch(/selectTopSeries/);
      expect(src).toMatch(/pivotSeriesRows/);
      expect(src).toMatch(/numericBuckets:\s*true/);
      expect(src).toMatch(/themeColorsFor/);

      mockGroupedResponse(
        0, 100,
        [{ series: "A", value: 100 }, { series: "B", value: 50 }],
        [
          { bucket: 0, series: "A", value: 10 },
          { bucket: 0, series: "B", value: 5 },
        ],
      );
      render(<NumericLineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
      await waitFor(() => expect(screen.getByTestId("numericline-renderer")).toBeInTheDocument());
    });

    it("top-N affordance — 'Showing top 12 of N' rendered when series truncated", async () => {
      const many = Array.from({ length: 14 }, (_, i) => ({ series: `s${i}`, value: 100 - i }));
      const groupedRows = many.map((m) => ({ bucket: 0, series: m.series, value: m.value }));
      mockGroupedResponse(0, 100, many, groupedRows);
      render(<NumericLineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
      await waitFor(() => expect(screen.getByTestId("numericline-renderer")).toBeInTheDocument());
      expect(screen.getByTestId("numericline-truncated-note")).toHaveTextContent(/top 12 of 14/i);
    });

    it("drag-to-filter still dispatches a BETWEEN filter on xField when grouped (source contract preserved)", () => {
      // Drag handlers + commitFilter sit OUTSIDE the grouped/ungrouped branch, so the
      // BETWEEN-on-xField dispatch is identical in both. Static-assert the shared contract.
      const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
      expect(src).toMatch(/setBulkFilters\(tableId as number,\s*\[filter\]\)/);
      expect(src).toMatch(/operator:\s*"between"/);
      expect(src).toMatch(/column:\s*xField/);
    });

    it("groupByColumn is part of the fetch effect dep key (toggling group-by re-fetches)", () => {
      const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
      expect(src).toMatch(/groupByColumn/);
      const count = (src.match(/groupByColumn/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it("ungrouped single-metric path is unchanged — still range + 1 metric query, no series split (regression lock)", async () => {
      mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 10 }]]);
      render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
      await waitFor(() => {
        expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
      });
      const metricSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      expect(metricSql).not.toMatch(/AS series/);
      expect(metricSql).not.toMatch(/GROUP BY bucket, series/);
    });
  });
});
