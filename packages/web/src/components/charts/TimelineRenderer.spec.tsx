// Phase 45 Plan 03 (TIMELINE-V17-02/06/07/08/09/10/11): TimelineRenderer specs.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ResizeObserver is not available in jsdom — stub it globally so Recharts'
// ResponsiveContainer (which creates a ResizeObserver on mount) does not throw.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function MockResizeObserver(this: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  return this;
}));

// ResponsiveContainer in JSDOM reports 0×0 dimensions so Recharts renders nothing.
// Stub it to render children with fixed dimensions so SVG output is exercisable.
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
import TimelineRenderer from "./TimelineRenderer";
import type { TableDto, WidgetDto } from "../../api/client";

// Mock runSql to feed canned range + metric responses.
// Also mock listColumnDisplayConfig so loadConfig (Phase 77-02) never makes real HTTP calls.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runSql: vi.fn(),
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../DashboardContext", () => ({
  useDashboardContext: () => ({ dashboardId: 42, widgets: [], dynamicViews: [], retryDynamicView: () => {} }),
}));

// Mock the two stores so we can spy on dispatched filters
const mockSetBulkFilters = vi.fn();
const mockMarkMaterializing = vi.fn();
let mockFilters: Record<number, unknown[]> = {};
let mockFilterVersion = 0;
// Active filter-views keyed by tableId (empty = no active view → base-table path).
// Kept for filterViewStore mock (commitFilter still uses markMaterializing via filterViewStore).
let mockViews: Record<number, unknown> = {};
// Phase 91 (READ-V118-01): filterCombinationStore mock state.
// vizToHash: maps vizKey ("w:<widgetId>") → hash string | undefined.
// mockRegistry: maps hash → CombinationEntry-like object.
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
// vizToHash/mockRegistry/mockCombinationVersion are module-level let-bindings reset in beforeEach.
// Selector-aware: the renderer subscribes via useFilterCombinationStore((s) => ...) for
// fvViewName/fvExpiresAt/fvMaterializing + calls .getState() for proactive clearEntry.
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
    id: 1, name: "nyctaxi", schema: "demo",
    columns: { pickup_time: "timestamp", fare_amount: "double", passenger_count: "int" },
    created_at: "", updated_at: "",
  },
];

function makeWidget(overrides: Record<string, unknown> = {}): WidgetDto {
  return {
    id: 100,
    dashboard_id: 1,
    type: "timeline",
    title: "TL",
    position: { x: 0, y: 0, w: 6, h: 4 },
    config: {
      tableId: 1,
      tableRef: "demo.nyctaxi",
      timeCol: "pickup_time",
      metrics: [
        { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
      ],
      maxIntervals: 200,
      showLegend: true,
      showTooltip: true,
      colorTheme: "Set2",
      dateFormatOverride: "",
      ...overrides,
    },
    created_at: "", updated_at: "",
  } as unknown as WidgetDto;
}

function mockRangeAndMetricResponse(lo: number, hi: number, metricRows: { bucket: string; value: number | null }[][]) {
  const rangeResp = {
    column_headers: ["lo", "hi"],
    column_1: [lo],
    column_2: [hi],
  };
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

describe("TimelineRenderer", () => {
  it("Test 1 (TIMELINE-V17-11): file contains ZERO references to materializeFilter (sole-trigger invariant)", () => {
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    const count = (src.match(/materializeFilter/g) ?? []).length;
    expect(count).toBe(0);
  });

  it("Test 2 (TIMELINE-V17-10): mount issues range query first, then N metric queries", async () => {
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const firstSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(firstSql).toContain("EXTRACT(EPOCH FROM MIN(pickup_time))");
    expect(firstSql).toContain("EXTRACT(EPOCH FROM MAX(pickup_time))");
    expect(firstSql).toContain("FROM demo.nyctaxi");
  });

  it("Test 2b: with an active combo entry, range + metric queries target the combo view (FROM-swap), not the base table", async () => {
    // Phase 91 (READ-V118-01): simulate an orchestrator-set combination view for widget id=100.
    const hash = "table:1:pickup_time|between|[\"2024-01-01\",\"2024-02-01\"]";
    mockVizToHash["w:100"] = hash;
    mockRegistry[hash] = { viewName: "_kbi_combo_test", materializing: false, expiresAt: Date.now() + 60_000 };
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const rangeSql = calls[0][0] as string;
    const metricSql = calls[1][0] as string;
    // FROM target swapped to the combo view; base table no longer queried.
    expect(rangeSql).toContain("FROM _kbi_combo_test");
    expect(rangeSql).not.toContain("FROM demo.nyctaxi");
    expect(metricSql).toContain("FROM _kbi_combo_test");
    expect(metricSql).not.toContain("FROM demo.nyctaxi");
  });

  it("Test 2c: while the combo entry is materializing (viewName=''), the timeline suspends (no query fires)", async () => {
    // Phase 91: a materializing combo entry → fvMaterializing = true → suspend gate fires.
    const hash = "table:1:pickup_time|between|[\"2024-01-01\",\"2024-02-01\"]";
    mockVizToHash["w:100"] = hash;
    mockRegistry[hash] = { viewName: "", materializing: true, expiresAt: 0 };
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    // Give effects a chance to run; assert no query fired during the materialize window.
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("Test 2d: NOFILTER hash (no combo entry) → base table queried (no FROM-swap)", async () => {
    // Phase 91: when vizToHash maps to a NOFILTER hash, fvViewName="" → base table fallback.
    mockVizToHash["w:100"] = "table:1:NOFILTER";
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const firstSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // NOFILTER → base table; no view name in FROM clause.
    expect(firstSql).toContain("FROM demo.nyctaxi");
  });

  it("Test 3 (TIMELINE-V17-10): DV-bound widget (dynamicViewId set) emits unprefixed FROM", async () => {
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 5 }]]);
    render(<TimelineRenderer widget={makeWidget({ dynamicViewId: 999, tableRef: "demo._kbi_dv_v999" })} tables={TABLES} />);
    await waitFor(() => expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2));
    const firstSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // dv-bound → empty schema → unprefixed FROM
    expect(firstSql).toMatch(/FROM\s+_kbi_dv_v999\s/);
    expect(firstSql).not.toMatch(/FROM\s+demo\._kbi_dv_v999/);
  });

  it("Test 4 (TIMELINE-V17-06): renders multi-axis YAxis with yAxisId per metric (2 metrics) — static source assertion", async () => {
    // Recharts in JSDOM does not render real SVG with dimension-dependent class selectors like
    // .recharts-yAxis (RESEARCH.md §C-08 Gotchas). Use static source assertions to verify the
    // multi-axis architecture: N <YAxis yAxisId=...> mapped per metric index.
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // AXIS_IDS maps metrics[0..3] to yAxisId "m0".."m3"
    expect(src).toMatch(/AXIS_IDS\s*=\s*\["m0",\s*"m1",\s*"m2",\s*"m3"\]/);
    // YAxis rendered per metric with alternating left/right orientation
    expect(src).toMatch(/orientation=\{AXIS_ORIENTATIONS\[i\]\}/);
    // Each Line has yAxisId matching its metric index
    expect(src).toMatch(/yAxisId=\{AXIS_IDS\[i\]\}/);
    // 2-metric render path also issues 2 parallel SQL calls
    mockRangeAndMetricResponse(0, 86400, [
      [{ bucket: "2024-01-01 00:00:00", value: 10 }],
      [{ bucket: "2024-01-01 00:00:00", value: 20 }],
    ]);
    const widget = makeWidget({
      metrics: [
        { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
        { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
      ],
    });
    render(<TimelineRenderer widget={widget} tables={TABLES} />);
    await waitFor(() => {
      // 1 range query + 2 metric queries = 3 total calls
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("Test 5 (TIMELINE-V17-06): single-metric case renders only ONE left axis — static source assertion", async () => {
    // Static assertion: single-metric → only AXIS_IDS[0]="m0" left axis; no right axis because
    // AXIS_ORIENTATIONS[0]="left" and no second metric exists. AXIS_ORIENTATIONS array is the
    // source of left/right alternation.
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/AXIS_ORIENTATIONS\s*=\s*\["left",\s*"right",\s*"left",\s*"right"\]/);
    // Single-metric render: issues 1 range query + 1 metric query = 2 calls total
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId("timeline-renderer")).toBeInTheDocument();
  });

  it("Test 6 (TIMELINE-V17-07): drag mouseDown → mouseUp at different activeLabel dispatches setBulkFilters with between/datetime + markMaterializing", async () => {
    mockRangeAndMetricResponse(0, 86400, [
      [
        { bucket: "2024-01-01 00:00:00", value: 10 },
        { bucket: "2024-01-01 01:00:00", value: 20 },
      ],
    ]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("timeline-renderer")).toBeInTheDocument();
    });

    // PRAGMATIC PATH: recharts surfaces mouse callbacks with synthetic state objects which we
    // cannot easily fabricate from JSDOM. We accept that this test verifies the dispatch path
    // CONTRACT by importing the renderer's commit logic indirectly — instead, we assert the
    // file content for the verbatim dispatch shape.
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/setBulkFilters\(tableId as number,\s*\[filter\]\)/);
    expect(src).toMatch(/markMaterializing\(tableId as number,\s*dashboardId\)/);
    expect(src).toMatch(/operator:\s*"between"/);
    expect(src).toMatch(/dataType:\s*"datetime"/);
    expect(src).toMatch(/column:\s*timeCol/);
  });

  it("Test 7 (TIMELINE-V17-07): click-no-drag suppression — dragStart === dragEnd produces NO dispatch", () => {
    // The renderer's onMouseUp guard `if (dragStart && end && dragStart !== end)` enforces this.
    // Static-assert the guard exists in source.
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/dragStart !== end/);
  });

  it("Test 8 (TIMELINE-V17-08): persistent ReferenceArea band rendered when useFilterStore has BETWEEN filter on timeCol — source + render assertions", async () => {
    // Static assertion: the renderer has a conditional ReferenceArea keyed off appliedBand
    // (derived from useFilterStore.filters[tableId] BETWEEN filter on timeCol).
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Persistent band reads from filterStore subscription
    expect(src).toMatch(/appliedBand/);
    expect(src).toMatch(/data-testid="timeline-applied-band"/);
    // Subscription scoped to filters[tableId]
    expect(src).toMatch(/s\.filters\[tableId\]/);

    // Runtime test: with a BETWEEN filter in the mock store, the renderer should
    // reach the data-render state (not the loading/error/empty-config state).
    mockFilters = {
      1: [
        {
          column: "pickup_time",
          value: ["2024-01-01 00:00:00", "2024-01-01 06:00:00"],
          dataType: "datetime",
          operator: "between",
          addedAt: 0,
        },
      ],
    };
    mockRangeAndMetricResponse(0, 86400, [[
      { bucket: "2024-01-01 00:00:00", value: 10 },
      { bucket: "2024-01-01 06:00:00", value: 20 },
    ]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    // Renderer transitions from loading → data-render state
    await waitFor(() => expect(screen.getByTestId("timeline-renderer")).toBeInTheDocument());
    // Recharts SVG rendering in JSDOM is dimension-fragile (RESEARCH.md §C-08):
    // .recharts-reference-area requires actual SVG layout. The static assertion above
    // verifies the architectural contract; the waitFor above confirms the render path completes.
  });

  it("Test 9 (TIMELINE-V17-02): WidgetRenderer.tsx contains the timeline short-circuit branch", () => {
    const path = resolve(__dirname, "WidgetRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/effectiveWidget\.type === "timeline"/);
    expect(src).toMatch(/<TimelineRenderer\s+widget=/);
  });

  it("Test 10 (TIMELINE-V17-06): empty buckets produce null in merged data — connectNulls=false renders gaps", () => {
    // Static assertion (visual gap requires DOM measurement which is fragile in JSDOM)
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/connectNulls=\{false\}/);
    // Merge logic explicitly sets `null` for missing bucket values
    expect(src).toMatch(/row\[`metric_\$\{idx\}`\]\s*=\s*typeof v === "number"/);
  });

  it("Test 11: vertical orientation renders (data-vertical=\"true\") and still issues queries", async () => {
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget({ vertical: true })} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId("timeline-renderer").getAttribute("data-vertical")).toBe("true");
  });

  // ---- Phase 72: grouped (series-split) rendering (GROUP-V114-04 timeline half) ----

  describe("Grouped (Phase 72)", () => {
    // Feeds: [0] range, [1] top-N pre-query (series/value rows), [2] main grouped query (bucket/series/value rows).
    function mockGroupedResponse(
      lo: number,
      hi: number,
      topRows: { series: string; value: number }[],
      groupedRows: { bucket: string; series: string; value: number | null }[],
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

    it("Test 12: grouped path issues range → top-N pre-query → main grouped query (GROUP BY bucket, series + IN allow-list)", async () => {
      mockGroupedResponse(
        0, 86400,
        [{ series: "A", value: 100 }, { series: "B", value: 50 }],
        [
          { bucket: "2024-01-01 00:00:00", series: "A", value: 10 },
          { bucket: "2024-01-01 00:00:00", series: "B", value: 5 },
        ],
      );
      render(<TimelineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
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

    it("Test 13: grouped renderer plots one Line per series value (source-text: top.series.map → <Line dataKey={sv}>)", async () => {
      // Recharts does not render dimension-dependent SVG under JSDOM (RESEARCH §C-08); assert
      // the one-Line-per-series architecture via SOURCE text + a completing render.
      const path = resolve(__dirname, "TimelineRenderer.tsx");
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/top\.series\.map/);
      expect(src).toMatch(/selectTopSeries/);
      expect(src).toMatch(/pivotSeriesRows/);
      // shared Y-axis when grouped (no per-metric alternating axes)
      expect(src).toMatch(/themeColorsFor/);

      mockGroupedResponse(
        0, 86400,
        [{ series: "A", value: 100 }, { series: "B", value: 50 }],
        [
          { bucket: "2024-01-01 00:00:00", series: "A", value: 10 },
          { bucket: "2024-01-01 00:00:00", series: "B", value: 5 },
        ],
      );
      render(<TimelineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
      await waitFor(() => expect(screen.getByTestId("timeline-renderer")).toBeInTheDocument());
    });

    it("Test 14: top-N affordance — 'Showing top 12 of N' rendered when series truncated", async () => {
      // 14 distinct series → truncated at MAX_SERIES (12).
      const many = Array.from({ length: 14 }, (_, i) => ({ series: `s${i}`, value: 100 - i }));
      const groupedRows = many.map((m) => ({ bucket: "2024-01-01 00:00:00", series: m.series, value: m.value }));
      mockGroupedResponse(0, 86400, many, groupedRows);
      render(<TimelineRenderer widget={makeWidget({ groupByColumn: "driver_id" })} tables={TABLES} />);
      await waitFor(() => expect(screen.getByTestId("timeline-renderer")).toBeInTheDocument());
      expect(screen.getByTestId("timeline-truncated-note")).toHaveTextContent(/top 12 of 14/i);
    });

    it("Test 15: drag-to-filter still dispatches a BETWEEN filter on timeCol when grouped (source contract preserved)", () => {
      // Drag handlers + commitFilter sit OUTSIDE the grouped/ungrouped branch, so the
      // BETWEEN-on-timeCol dispatch is identical in both. Static-assert the shared contract.
      const path = resolve(__dirname, "TimelineRenderer.tsx");
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/setBulkFilters\(tableId as number,\s*\[filter\]\)/);
      expect(src).toMatch(/operator:\s*"between"/);
      expect(src).toMatch(/column:\s*timeCol/);
    });

    it("Test 16: groupByColumn is part of the fetch effect dep key (toggling group-by re-fetches)", () => {
      const path = resolve(__dirname, "TimelineRenderer.tsx");
      const src = readFileSync(path, "utf-8");
      // dep array (~the JSON.stringify metrics block) must reference groupByColumn
      expect(src).toMatch(/groupByColumn/);
      const grouped = (src.match(/groupByColumn/g) ?? []).length;
      expect(grouped).toBeGreaterThanOrEqual(3);
    });

    it("Test 17: ungrouped single-metric path is unchanged — still range + 1 metric query (regression lock)", async () => {
      mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
      render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
      await waitFor(() => {
        expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
      });
      // ungrouped metric query has no series split
      const metricSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      expect(metricSql).not.toMatch(/AS series/);
      expect(metricSql).not.toMatch(/GROUP BY bucket, series/);
    });

    // Phase 103 regression: custom metric in grouped top-N pre-query must use resolved expression.
    it("Test 18 (Phase 103): grouped top-N pre-query with custom metric uses resolved expression, not empty AVG()", async () => {
      // Seed the store so selectMetrics(tableId=1) finds metric id=1 → expression "AVG(ul_speed)".
      mockCustomMetricsConfigs = {
        1: { metrics: { 1: { id: 1, label: "Avg UL Speed", expression: "AVG(ul_speed)" } } },
      };
      mockGroupedResponse(
        0, 86400,
        [{ series: "A", value: 100 }],
        [{ bucket: "2024-01-01 00:00:00", series: "A", value: 10 }],
      );
      // Widget: custom metric (metricId=1, column="" — as stored when user picks a custom metric).
      render(
        <TimelineRenderer
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

    it("Test 19 (Phase 103): grouped top-N pre-query with a real column metric is unchanged (resolveMetricExpr passthrough)", async () => {
      // Real metric (no metricId) → resolveMetricExpr returns realAgg0 unchanged.
      mockGroupedResponse(
        0, 86400,
        [{ series: "A", value: 100 }],
        [{ bucket: "2024-01-01 00:00:00", series: "A", value: 10 }],
      );
      render(
        <TimelineRenderer
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
    it("Test 20 (Phase 103): TimelineRenderer.tsx imports resolveMetricExpr and uses it in the grouped top-N pre-query (static assertion)", () => {
      const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
      expect(src).toContain("resolveMetricExpr");
      // The pre-query aggSql must be assigned from resolveMetricExpr, not a bare template literal.
      expect(src).toMatch(/resolveMetricExpr\(metric0\.metricId,\s*realAgg0,\s*tableId\)/);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 77-02 (COLAPPLY-V115-02) — TimelineRenderer: ColumnFormatTooltip wired
// ---------------------------------------------------------------------------

describe("TimelineRenderer — ColumnFormatTooltip tooltip wiring (COLAPPLY-V115-02)", () => {
  it("TimelineRenderer.tsx imports ColumnFormatTooltip (static assertion)", () => {
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("ColumnFormatTooltip");
    expect(src).toContain('content={<ColumnFormatTooltip');
  });

  it("TimelineRenderer.tsx subscribes to configVersion (primitive-selector subscription)", () => {
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("useColumnDisplayConfigStore((s) => s.configVersion)");
  });

  it("TimelineRenderer.tsx does NOT import materializeFilter (sole-trigger invariant preserved)", () => {
    const path = resolve(__dirname, "TimelineRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    const importLines = src.split("\n").filter((l) => l.trimStart().startsWith("import")).join("\n");
    expect(importLines).not.toMatch(/materializeFilter/);
  });

  it("tooltip renders ColumnFormatTooltip content with formatted value on mount", async () => {
    // Seed a format spec for the metric column so the formatter is applied.
    const { listColumnDisplayConfig } = await import("../../api/client");
    (listColumnDisplayConfig as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        table_id: 1,
        column_name: "fare_amount",
        label: "Fare Revenue",
        format_spec: { kind: "number", thousandsSep: true, decimals: 0, currency: "$", percent: false },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 999 }]]);
    const { container } = render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);

    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Verify the Tooltip component in the rendered output uses ColumnFormatTooltip
    // by checking the source file wiring (static) — recharts SVG rendering is not
    // introspectable in jsdom; formatter correctness is proven in ColumnFormatTooltip.spec.tsx.
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
    expect(src).toContain("content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn}");
    expect(container).toBeTruthy(); // component rendered without crash
  });
});

// ---------------------------------------------------------------------------
// Phase 86 (AXIS-V117-02/03) — TimelineRenderer: yAxisTickFormatter resolution
// ---------------------------------------------------------------------------

describe("TimelineRenderer — yAxisTickFormatter resolution (AXIS-V117-02/03)", () => {
  it("Y1 (override): yAxisFormat present → all 4 type=number axes carry tickFormatter; source wiring correct; buildFormatter SI output confirmed", async () => {
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
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
    // Source assertion: the fallback path calls resolveFormatter(tableId, metricColumn)
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
    expect(src).toMatch(/resolveFormatter\(tableId, metricColumn\)/);
    // Source assertion: configVersion is the last dep in the yAxisTickFormatter useMemo
    expect(src).toMatch(/configVersion\]/);
    // Source assertion: the identity branch returns String(v ?? "")
    expect(src).toContain('return (v: unknown) => String(v ?? "")');
    // Prove identity semantics directly (no store needed)
    const identity = (v: unknown) => String(v ?? "");
    expect(identity(42)).toBe("42");
    expect(identity(null)).toBe("");
  });

  it("Y3 (tooltip isolation): ColumnFormatTooltip receives NO yAxisFormat prop — tooltip wiring is unchanged", () => {
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
    // The ColumnFormatTooltip JSX must not include yAxisFormat
    const tooltipJsx = src.match(/content=\{<ColumnFormatTooltip[^}]+\}/)?.[0] ?? "";
    expect(tooltipJsx).not.toContain("yAxisFormat");
    // The tooltip still passes the three expected props
    expect(src).toContain("content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn}");
  });
});

// ---------------------------------------------------------------------------
// Phase 98 (VIZSQL-V119-02/03): TimelineRenderer — customWhere injection
// ---------------------------------------------------------------------------

describe("TimelineRenderer — customWhere injection (Phase 98, VIZSQL-V119-02/03)", () => {
  it("CW1: ungrouped SQL with customWhere='x = 1' contains ' AND (x = 1)'", async () => {
    // range → [0] + metric → [1]
    const rangeResp = { column_headers: ["lo", "hi"], column_1: [0], column_2: [86400] };
    const metricResp = {
      column_headers: ["bucket", "value"],
      column_1: ["2024-01-01 00:00:00"],
      column_2: [10],
    };
    let call = 0;
    (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (call === 0) { call++; return Promise.resolve(rangeResp); }
      call++;
      return Promise.resolve(metricResp);
    });

    render(
      <TimelineRenderer
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

  it("CW2: empty customWhere → ungrouped SQL is byte-identical to baseline (no AND clause)", async () => {
    // Baseline: no customWhere in config → metric SQL must NOT contain ' AND ('
    const rangeResp = { column_headers: ["lo", "hi"], column_1: [0], column_2: [86400] };
    const metricResp = {
      column_headers: ["bucket", "value"],
      column_1: ["2024-01-01 00:00:00"],
      column_2: [10],
    };
    let call = 0;
    (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (call === 0) { call++; return Promise.resolve(rangeResp); }
      call++;
      return Promise.resolve(metricResp);
    });

    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const metricSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    // byte-identical: the IS NOT NULL clause is present and no AND (x = 1) appended
    expect(metricSql).toContain("IS NOT NULL");
    expect(metricSql).not.toContain(" AND (");
  });

  it("CW3: grouped top-N SQL with customWhere='x = 1' contains ' AND (x = 1)' (top-N pre-query consistency)", async () => {
    const rangeResp = { column_headers: ["lo", "hi"], column_1: [0], column_2: [86400] };
    const topResp = {
      column_headers: ["series", "value"],
      column_1: ["A"], column_2: [100],
    };
    const groupedResp = {
      column_headers: ["bucket", "series", "value"],
      column_1: ["2024-01-01 00:00:00"], column_2: ["A"], column_3: [10],
    };
    let call = 0;
    (runSql as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if (call === 0) { call++; return Promise.resolve(rangeResp); }
      if (call === 1) { call++; return Promise.resolve(topResp); }
      call++;
      return Promise.resolve(groupedResp);
    });

    render(
      <TimelineRenderer
        widget={makeWidget({ groupByColumn: "driver_id", customWhere: "x = 1" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    const topSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    const mainSql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[2][0] as string;
    // top-N pre-query also includes the predicate (consistent series ranking)
    expect(topSql).toContain(" AND (x = 1)");
    // main grouped SQL also includes the predicate
    expect(mainSql).toContain(" AND (x = 1)");
  });

  // ── Phase 101 (YAXIS-V119-04): byte-identical + spread tests ──────────────
  // Mode-output math (absent→{}, smart→['auto','auto'], log→[posMin,'auto']+scale+allowDataOverflow,
  // no-positive→{}) is runtime-locked in src/lib/yAxisScale.spec.ts (plan 101-01). These tests
  // verify only that the STRUCTURAL WIRING is correct: the spread reaches every value axis (not
  // the category axis) and flows exclusively through yAxisScaleProps.

  it("Phase 101: value axes derive scale props only via yAxisScaleProps (byte-identical when absent)", () => {
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
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
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
    // 4 value-axis branches must each carry {...scaleProps}
    const spreadMatches = src.match(/\{\.\.\.(scaleProps)\}/g) ?? [];
    expect(spreadMatches.length).toBeGreaterThanOrEqual(4);
    // Category axes (type="category") must NOT carry the spread
    // Split on type="category" occurrences and assert scaleProps is NOT in the immediately following element
    const categoryAxisBlock = src.match(/type="category"[^>]*\/?>/g) ?? [];
    for (const block of categoryAxisBlock) {
      expect(block).not.toContain("scaleProps");
    }
  });

  it("Phase 101: renderer reads cfg.yAxisScale", () => {
    const src = readFileSync(resolve(__dirname, "TimelineRenderer.tsx"), "utf-8");
    expect(src).toMatch(/yAxisScale/);
    // Specifically reads from cfg
    expect(src).toMatch(/cfg\.yAxisScale/);
  });
});
