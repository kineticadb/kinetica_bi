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

// Also mock listColumnDisplayConfig so loadConfig (Phase 77-02) never makes real HTTP calls.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runSql: vi.fn(), listColumnDisplayConfig: vi.fn().mockResolvedValue([]) };
});

vi.mock("../DashboardContext", () => ({
  useDashboardContext: () => ({ dashboardId: 42, widgets: [], dynamicViews: [], retryDynamicView: () => {} }),
}));

const mockSetBulkFilters = vi.fn();
const mockMarkMaterializing = vi.fn();
let mockFilters: Record<number, unknown[]> = {};
let mockFilterVersion = 0;
// Kept for filterViewStore mock (commitFilter still uses markMaterializing via filterViewStore).
let mockViews: Record<number, unknown> = {};
// Phase 91 (READ-V118-01): filterCombinationStore mock state.
let mockVizToHash: Record<string, string | undefined> = {};
let mockRegistry: Record<string, { viewName: string; expiresAt: number; materializing: boolean }> = {};
let mockCombinationVersion = 0;

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
  // commitFilter still calls useFilterViewStore.getState().markMaterializing — keep this mock.
  // The read selectors (fvViewName/fvExpiresAt/fvMaterializing) have moved to filterCombinationStore
  // in Phase 91, so mockViews is no longer used for read-path tests; retained for commitFilter wiring.
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

// Phase 103: customMetricsStore mock — controls what selectMetrics(tableId) returns so the
// grouped top-N pre-query resolveMetricExpr call can be exercised with a known expression.
let mockCustomMetricsConfigs: Record<number, { metrics: Record<number, { id: number; label: string; expression: string }> }> = {};

vi.mock("../../store/customMetricsStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useCustomMetricsStore = ((selector?: (s: unknown) => unknown) => {
    const state = { configVersion: 0, configs: mockCustomMetricsConfigs };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useCustomMetricsStore.getState = () => ({
    configVersion: 0,
    configs: mockCustomMetricsConfigs,
    loadConfig: vi.fn().mockResolvedValue(undefined),
  });
  // selectMetrics must read from the SAME mock state so resolveMetricExpr resolves correctly.
  const selectMetrics = (tableId: number) =>
    Object.values((mockCustomMetricsConfigs[tableId]?.metrics ?? {}) as Record<number, { id: number; label: string; expression: string }>)
      .sort((a, b) => a.label.localeCompare(b.label));
  return { ...actual, useCustomMetricsStore, selectMetrics };
});

// Phase 91 (READ-V118-01): selector-aware filterCombinationStore mock.
// Mirrors TimelineRenderer.spec.tsx mock exactly.
vi.mock("../../store/filterCombinationStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterCombinationStore = ((selector?: (s: unknown) => unknown) => {
    const state = {
      vizToHash: mockVizToHash,
      registry: mockRegistry,
      combinationVersion: mockCombinationVersion,
    };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterCombinationStore.getState = () => ({
    vizToHash: mockVizToHash,
    registry: mockRegistry,
    combinationVersion: mockCombinationVersion,
    clearEntry: vi.fn(),
  });
  return { ...actual, useFilterCombinationStore };
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
  // Phase 91: reset combination store mock state.
  mockVizToHash = {};
  mockRegistry = {};
  mockCombinationVersion = 0;
  // Phase 103: reset custom metrics store mock state.
  mockCustomMetricsConfigs = {};
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

  it("with an active combo entry, range + metric queries target the combo view (not the base table)", async () => {
    // Phase 91 (READ-V118-01): simulate an orchestrator-set combination view for widget id=100.
    const hash = "table:1:trip_distance|between|[0,50]";
    mockVizToHash["w:100"] = hash;
    mockRegistry[hash] = { viewName: "_kbi_combo_test", materializing: false, expiresAt: Date.now() + 60_000 };
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 1 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0] as string).toContain("FROM _kbi_combo_test");
    expect(calls[0][0] as string).not.toContain("FROM demo.nyctaxi");
    expect(calls[1][0] as string).toContain("FROM _kbi_combo_test");
  });

  it("suspends (no query) while the combo entry is materializing (viewName='')", async () => {
    // Phase 91: a materializing combo entry → fvMaterializing = true → suspend gate fires.
    const hash = "table:1:trip_distance|between|[0,50]";
    mockVizToHash["w:100"] = hash;
    mockRegistry[hash] = { viewName: "", materializing: true, expiresAt: 0 };
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 1 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("NOFILTER hash (no combo entry) → base table queried (no FROM-swap)", async () => {
    // Phase 91: when vizToHash maps to a NOFILTER hash, fvViewName="" → base table fallback.
    mockVizToHash["w:100"] = "table:1:NOFILTER";
    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 5 }]]);
    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const firstSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // NOFILTER → base table; no view name in FROM clause.
    expect(firstSql).toContain("FROM demo.nyctaxi");
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

    // Phase 103 regression: custom metric in grouped top-N pre-query must use resolved expression.
    it("Phase 103: grouped top-N pre-query with custom metric uses resolved expression, not empty AVG()", async () => {
      // Seed the store so selectMetrics(tableId=1) finds metric id=1 → expression "AVG(ul_speed)".
      mockCustomMetricsConfigs = {
        1: { metrics: { 1: { id: 1, label: "Avg UL Speed", expression: "AVG(ul_speed)" } } },
      };
      mockGroupedResponse(
        0, 100,
        [{ series: "A", value: 100 }],
        [{ bucket: 0, series: "A", value: 10 }],
      );
      // Widget: custom metric (metricId=1, column="" — as stored when user picks a custom metric).
      render(
        <NumericLineRenderer
          widget={makeWidget({
            groupByColumn: "driver_id",
            metrics: [{ column: "", aggregation: "AVG", metricId: 1, color: "FF66C2A5" }],
          })}
          tables={TABLES}
        />,
      );
      await waitFor(() => {
        expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
      });
      const topSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      // Must contain the resolved expression, NOT the empty-arg AVG().
      expect(topSql).toContain("AVG(ul_speed)");
      expect(topSql).not.toContain("AVG()");
    });

    it("Phase 103: grouped top-N pre-query with a real column metric is unchanged (resolveMetricExpr passthrough)", async () => {
      // Real metric (no metricId) → resolveMetricExpr returns realAgg0 unchanged.
      mockGroupedResponse(
        0, 100,
        [{ series: "A", value: 100 }],
        [{ bucket: 0, series: "A", value: 10 }],
      );
      render(
        <NumericLineRenderer
          widget={makeWidget({
            groupByColumn: "driver_id",
            metrics: [{ column: "fare_amount", aggregation: "AVG", color: "FF66C2A5" }],
          })}
          tables={TABLES}
        />,
      );
      await waitFor(() => {
        expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
      });
      const topSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      // Real column → standard AVG(col) — not empty parens.
      expect(topSql).toContain("AVG(fare_amount)");
      expect(topSql).not.toContain("AVG()");
    });

    // Phase 103 static assertion: the renderer now imports and calls resolveMetricExpr in the pre-query.
    it("Phase 103: NumericLineRenderer.tsx imports resolveMetricExpr and uses it in the grouped top-N pre-query (static assertion)", () => {
      const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
      expect(src).toContain("resolveMetricExpr");
      // The pre-query aggSql must be assigned from resolveMetricExpr, not a bare template literal.
      expect(src).toMatch(/resolveMetricExpr\(metric0\.metricId,\s*realAgg0,\s*tableId\)/);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 77-02 (COLAPPLY-V115-02) — NumericLineRenderer: ColumnFormatTooltip wired
// ---------------------------------------------------------------------------
// Note: readFileSync and resolve are already imported at the top of this file.

describe("NumericLineRenderer — ColumnFormatTooltip tooltip wiring (COLAPPLY-V115-02)", () => {
  it("NumericLineRenderer.tsx imports ColumnFormatTooltip (static assertion)", () => {
    const path = resolve(__dirname, "NumericLineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("ColumnFormatTooltip");
    expect(src).toContain('content={<ColumnFormatTooltip');
  });

  it("NumericLineRenderer.tsx subscribes to configVersion (primitive-selector subscription)", () => {
    const path = resolve(__dirname, "NumericLineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("useColumnDisplayConfigStore((s) => s.configVersion)");
  });

  it("NumericLineRenderer.tsx does NOT import materializeFilter (sole-trigger invariant preserved)", () => {
    const path = resolve(__dirname, "NumericLineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    const importLines = src.split("\n").filter((l) => l.trimStart().startsWith("import")).join("\n");
    expect(importLines).not.toMatch(/materializeFilter/);
  });

  it("tooltip uses ColumnFormatTooltip wiring with correct tableId/groupByColumn/metricColumn props", () => {
    const path = resolve(__dirname, "NumericLineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Assert the exact prop passthrough pattern
    expect(src).toContain("content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn}");
  });

  it("renders without crash when a metric column has a saved format spec", async () => {
    const { listColumnDisplayConfig } = await import("../../api/client");
    (listColumnDisplayConfig as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        table_id: 1,
        column_name: "fare_amount",
        label: "Fare Revenue",
        format_spec: { kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockRangeAndMetric(0, 100, [[{ bucket: 0, value: 500 }]]);
    const { container } = render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);

    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Component must render without crash (ColumnFormatTooltip is present in source)
    expect(container).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phase 86 (AXIS-V117-02/03) — NumericLineRenderer: yAxisTickFormatter resolution
// ---------------------------------------------------------------------------

describe("NumericLineRenderer — yAxisTickFormatter resolution (AXIS-V117-02/03)", () => {
  it("Y1 (override): yAxisFormat present → all 4 type=number axes carry tickFormatter; source wiring correct; buildFormatter SI output confirmed", async () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    // 4 value axes must carry tickFormatter={yAxisTickFormatter}
    const tickCount = (src.match(/tickFormatter=\{yAxisTickFormatter\}/g) ?? []).length;
    expect(tickCount).toBe(4);
    // bucket axes must be untouched (still use bucketFormatter)
    const bucketCount = (src.match(/tickFormatter=\{bucketFormatter\}/g) ?? []).length;
    expect(bucketCount).toBe(2);
    // override branch uses buildFormatter
    expect(src).toMatch(/buildFormatter\(cfg\.yAxisFormat/);
    // column-default branch uses resolveFormatter
    expect(src).toMatch(/resolveFormatter\(tableId, metricColumn\)/);
    // configVersion is in the useMemo dep array
    expect(src).toMatch(/configVersion\]/);
    // Invoke buildFormatter directly via ESM import to prove SI output
    const { buildFormatter } = await import("../../lib/columnFormatter");
    const fmt = buildFormatter({ kind: "si", decimals: 1 });
    expect(String(fmt(1234567) ?? 1234567)).toBe("1.2M");
  });

  it("Y2 (column-default): absent yAxisFormat → useMemo uses resolveFormatter(tableId, metricColumn); identity fallback produces raw string (source assertions)", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    expect(src).toMatch(/resolveFormatter\(tableId, metricColumn\)/);
    expect(src).toMatch(/configVersion\]/);
    expect(src).toContain('return (v: unknown) => String(v ?? "")');
    const identity = (v: unknown) => String(v ?? "");
    expect(identity(42)).toBe("42");
    expect(identity(null)).toBe("");
  });

  it("Y3 (tooltip isolation): ColumnFormatTooltip receives NO yAxisFormat prop — tooltip wiring is unchanged", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    // The ColumnFormatTooltip JSX must not include yAxisFormat
    const tooltipJsx = src.match(/content=\{<ColumnFormatTooltip[^}]+\}/)?.[0] ?? "";
    expect(tooltipJsx).not.toContain("yAxisFormat");
    // The tooltip still passes the three expected props
    expect(src).toContain("content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn}");
  });
});

// ---------------------------------------------------------------------------
// Phase 98 (VIZSQL-V119-02/03): NumericLineRenderer — customWhere injection
// ---------------------------------------------------------------------------

describe("NumericLineRenderer — customWhere injection (Phase 98, VIZSQL-V119-02/03)", () => {
  it("CW1: ungrouped metric SQL with customWhere='x = 1' contains ' AND (x = 1)'", async () => {
    const rangeResp = { column_headers: ["lo", "hi"], column_1: [0], column_2: [100] };
    const metricResp = {
      column_headers: ["bucket", "value"],
      column_1: [0],
      column_2: [10],
    };
    let call = 0;
    (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (call === 0) { call++; return Promise.resolve(rangeResp); }
      call++;
      return Promise.resolve(metricResp);
    });

    render(
      <NumericLineRenderer
        widget={makeWidget({ customWhere: "x = 1" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const metricSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(metricSql).toContain(" AND (x = 1)");
  });

  it("CW2: empty/absent customWhere → ungrouped metric SQL has no AND clause (byte-identical)", async () => {
    const rangeResp = { column_headers: ["lo", "hi"], column_1: [0], column_2: [100] };
    const metricResp = {
      column_headers: ["bucket", "value"],
      column_1: [0],
      column_2: [10],
    };
    let call = 0;
    (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (call === 0) { call++; return Promise.resolve(rangeResp); }
      call++;
      return Promise.resolve(metricResp);
    });

    render(<NumericLineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const metricSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(metricSql).toContain("IS NOT NULL");
    expect(metricSql).not.toContain(" AND (");
  });

  // ── Phase 101 (YAXIS-V119-04): byte-identical + spread tests ──────────────
  // Mode-output math (absent→{}, smart→['auto','auto'], log→[posMin,'auto']+scale+allowDataOverflow,
  // no-positive→{}) is runtime-locked in src/lib/yAxisScale.spec.ts (plan 101-01). These tests
  // verify only that the STRUCTURAL WIRING is correct: the spread reaches every value axis (not
  // the category axis) and flows exclusively through yAxisScaleProps.

  it("Phase 101: value axes derive scale props only via yAxisScaleProps (byte-identical when absent)", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    // yAxisScaleProps must be imported and called
    expect(src).toMatch(/import.*yAxisScaleProps.*from.*yAxisScale/);
    expect(src).toMatch(/yAxisScaleProps\(/);
    // The spread variable is assigned from the helper (not a literal)
    expect(src).toMatch(/scaleProps\s*=\s*yAxisScaleProps\(/);
    // No hardcoded domain or scale literals on axis elements (props must come from helper)
    expect(src).not.toMatch(/domain=\{\[0/);
    expect(src).not.toMatch(/scale="log"/);
  });

  it("Phase 101: scale-props spread reaches every value axis (4 branches), not the category axis", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    // 4 value-axis branches must each carry {...scaleProps}
    const spreadMatches = src.match(/\{\.\.\.(scaleProps)\}/g) ?? [];
    expect(spreadMatches.length).toBeGreaterThanOrEqual(4);
    // Category axes (type="category") must NOT carry the spread
    const categoryAxisBlock = src.match(/type="category"[^>]*\/?>/g) ?? [];
    for (const block of categoryAxisBlock) {
      expect(block).not.toContain("scaleProps");
    }
  });

  it("Phase 101: renderer reads cfg.yAxisScale", () => {
    const src = readFileSync(resolve(__dirname, "NumericLineRenderer.tsx"), "utf-8");
    expect(src).toMatch(/yAxisScale/);
    // Specifically reads from cfg
    expect(src).toMatch(/cfg\.yAxisScale/);
  });
});
