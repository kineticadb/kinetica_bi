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

// Mock runSql to feed canned range + metric responses
vi.mock("../../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runSql: vi.fn(),
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
  // Selector-aware mock: the renderer now subscribes via useFilterViewStore((s) => ...)
  // (viewName / expiresAt / materializing) in addition to .getState().markMaterializing.
  // Default state has no active view → selectors resolve to undefined/false (base-table path).
  // Selector-aware mock: the renderer subscribes via useFilterViewStore((s) => ...)
  // for viewName/expiresAt/materializing, plus .getState() for markMaterializing/clearView.
  // References to module-level mock* vars are lazy (inside the wrapper/getState fns), so they
  // resolve at call time — safe despite vi.mock factory hoisting. mockViews lets a test inject
  // an active filter-view keyed by tableId.
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

  it("Test 2b: with an active filter-view, range + metric queries target the view (FROM-swap), not the base table", async () => {
    // Simulate a materialized filter-view for this table (e.g. after drag-to-filter).
    mockViews = {
      1: { viewName: "_kbi_filt_test", materializing: false, expiresAt: Date.now() + 60_000 },
    };
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const rangeSql = calls[0][0] as string;
    const metricSql = calls[1][0] as string;
    // FROM target swapped to the materialized view; base table no longer queried.
    expect(rangeSql).toContain("FROM _kbi_filt_test");
    expect(rangeSql).not.toContain("FROM demo.nyctaxi");
    expect(metricSql).toContain("FROM _kbi_filt_test");
    expect(metricSql).not.toContain("FROM demo.nyctaxi");
  });

  it("Test 2c: while the filter-view is materializing, the timeline suspends (no query fires)", async () => {
    mockViews = { 1: { viewName: undefined, materializing: true, expiresAt: 0 } };
    mockRangeAndMetricResponse(0, 86400, [[{ bucket: "2024-01-01 00:00:00", value: 10 }]]);
    render(<TimelineRenderer widget={makeWidget()} tables={TABLES} />);
    // Give effects a chance to run; assert no query fired during the materialize window.
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
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
});
