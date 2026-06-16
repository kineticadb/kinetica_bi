// Phase 67 Plan 02 (CAL-V113-04 + CAL-V113-05): CalendarRenderer specs.
//
// Mirrors TimelineRenderer.spec.tsx scaffolding:
//   - runSql mock (canned column_headers + column_N responses)
//   - useFilterStore / useFilterViewStore / useDynamicViewStore selector-aware mocks
//   - useDashboardContext mock
//   - Static source-grep invariant (materializeFilter|dropFilterView|fromSwap)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ResizeObserver is not available in jsdom — stub globally.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function MockResizeObserver(
  this: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> },
) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  return this;
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import CalendarRenderer from "./CalendarRenderer";
import type { TableDto, WidgetDto } from "../../api/client";

// Mock runSql to feed canned calendar responses
vi.mock("../../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runSql: vi.fn(),
  };
});

vi.mock("../DashboardContext", () => ({
  useDashboardContext: () => ({
    dashboardId: 42,
    widgets: [],
    dynamicViews: [],
    retryDynamicView: () => {},
  }),
}));

// ---- Filter store mock ----
let mockFilterVersion = 0;

vi.mock("../../store/filterStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterStore = ((selector?: (s: unknown) => unknown) => {
    const state = { filters: {}, filterVersion: mockFilterVersion };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterStore.getState = () => ({
    filters: {},
    filterVersion: mockFilterVersion,
  });
  return { ...actual, useFilterStore };
});

// ---- Filter view store mock ----
// mockViews = table-path views keyed by tableId
// mockDvViews = dv-filter-path views keyed by dynamicViewId
let mockViews: Record<number, { viewName?: string; materializing: boolean; expiresAt: number }> = {};
let mockDvViews: Record<number, { viewName?: string; materializing: boolean }> = {};
const mockClearView = vi.fn();

vi.mock("../../store/filterViewStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterViewStore = ((selector?: (s: unknown) => unknown) => {
    const state = { views: mockViews, dvViews: mockDvViews, clearView: mockClearView };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterViewStore.getState = () => ({
    views: mockViews,
    dvViews: mockDvViews,
    clearView: mockClearView,
  });
  return { ...actual, useFilterViewStore };
});

// ---- Dynamic view store mock ----
let mockDvViews2: Record<number, { viewName?: string; status: string }> = {};

vi.mock("../../store/dynamicViewStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useDynamicViewStore = ((selector?: (s: unknown) => unknown) => {
    const state = { views: mockDvViews2 };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useDynamicViewStore.getState = () => ({ views: mockDvViews2 });
  return { ...actual, useDynamicViewStore };
});

// ---- Theme store mock (for useChartAxisColors) ----
vi.mock("../../store/theme", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) =>
    selector({ theme: "light" }),
}));

import { runSql } from "../../api/client";

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

const TABLES: TableDto[] = [
  {
    id: 1,
    name: "sales",
    schema: "demo",
    columns: { order_date: "timestamp", amount: "double" },
    created_at: "",
    updated_at: "",
  },
];

function makeWidget(overrides: Record<string, unknown> = {}): WidgetDto {
  return {
    id: 100,
    dashboard_id: 1,
    type: "calendar",
    title: "CAL",
    position: { x: 0, y: 0, w: 6, h: 4 },
    config: {
      tableId: 1,
      tableRef: "demo.sales",
      timeCol: "order_date",
      metricColumn: "amount",
      aggregation: "SUM",
      domain: "month",
      subdomain: "day",
      colorTheme: "Greens",
      ...overrides,
    },
    created_at: "",
    updated_at: "",
  } as unknown as WidgetDto;
}

/**
 * Build a canned calendar SQL response payload.
 * Produces column_headers + column_1 (domain_bucket) + column_2 (subdomain_bucket) + column_3 (value).
 */
function makeCalendarResponse(rows: { domain_bucket: string; subdomain_bucket: string; value: number | null }[]) {
  return {
    column_headers: ["domain_bucket", "subdomain_bucket", "value"],
    column_1: rows.map((r) => r.domain_bucket),
    column_2: rows.map((r) => r.subdomain_bucket),
    column_3: rows.map((r) => r.value),
  };
}

/** Canned 2×2 data: 2 domain keys × 2 subdomain keys = 4 populated cells */
const CANNED_ROWS = [
  { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 100 },
  { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-04 00:00:00", value: 200 },
  { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-10 00:00:00", value: 150 },
  { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-11 00:00:00", value: 50 },
];

beforeEach(() => {
  mockFilterVersion = 0;
  mockViews = {};
  mockDvViews = {};
  mockDvViews2 = {};
  mockClearView.mockClear();
  (runSql as unknown as ReturnType<typeof vi.fn>).mockReset();
  (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(CANNED_ROWS));
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CalendarRenderer", () => {
  it("Test 0 (static invariant): source does NOT import materializeFilter|dropFilterView|fromSwap", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Extract import lines only — comments that mention banned symbols are OK
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/materializeFilter|dropFilterView|fromSwap/);
  });

  it("Test 1 (reactive domain): source contains exact useMemo(() => computeDomain(data), [data]) string", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("useMemo(() => computeDomain(data), [data])");
  });

  it("Test 2 (fetch + grid): on mount with canned populated rows, runSql is called and calendar-renderer appears", async () => {
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // SQL must contain DATE_TRUNC markers
    expect(sql).toContain("DATE_TRUNC");
    expect(sql).toContain("domain_bucket");
    // FROM target = schema.table (no filter view active)
    expect(sql).toContain("FROM demo.sales");
  });

  it("Test 3 (table FROM resolution): with an active filter-view, SQL FROM = view name (unprefixed)", async () => {
    mockViews = {
      1: { viewName: "_kbi_filt_abc", materializing: false, expiresAt: Date.now() + 60_000 },
    };
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("FROM _kbi_filt_abc");
    expect(sql).not.toContain("FROM demo.sales");
  });

  it("Test 4a (DV FROM resolution — filtered-dv): with dvFilterViewName set, FROM = filtered-dv view", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    mockDvViews = { 99: { viewName: "_kbi_dv_filt_v99", materializing: false } };
    render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99, tableRef: "demo.sales" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("FROM _kbi_dv_filt_v99");
    expect(sql).not.toContain("FROM demo.sales");
    expect(sql).not.toContain("FROM _kbi_dv_raw_v99");
  });

  it("Test 4b (DV FROM resolution — raw dv): with dvViewName only (no filter), FROM = raw dv view", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    mockDvViews = {}; // no dv filter view active
    render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99, tableRef: "demo.sales" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("FROM _kbi_dv_raw_v99");
    expect(sql).not.toContain("FROM demo.sales");
  });

  it("Test 5 (filterVersion re-fetch): bumping filterVersion causes runSql to be called again", async () => {
    const { rerender } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const callsBefore = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    // Bump filterVersion — simulate a filter being applied
    mockFilterVersion = 1;
    rerender(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("Test 6 (gap-fill greys): sparse response renders data-empty cell with fill=emptyCell; populated cells get <title>", async () => {
    // Sparse: only 1 out of 2×2 positions is populated → 3 gap cells should be grey
    const sparseRows = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 100 },
      { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 200 },
      // 2026-01-01 × 2026-02-10 and 2026-02-01 × 2026-02-10 are missing → gap cells
      { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-10 00:00:00", value: 300 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(sparseRows));
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    // There should be at least one data-empty="true" cell
    const emptyCells = container.querySelectorAll('[data-empty="true"]');
    expect(emptyCells.length).toBeGreaterThan(0);
    // Empty cells have NO <title>
    for (const cell of Array.from(emptyCells)) {
      expect(cell.querySelector("title")).toBeNull();
    }
    // Populated cells (rect WITHOUT data-empty) should have a <title>
    const allRects = container.querySelectorAll("rect");
    const populatedRects = Array.from(allRects).filter((r) => !r.getAttribute("data-empty"));
    expect(populatedRects.length).toBeGreaterThan(0);
    for (const cell of populatedRects) {
      expect(cell.querySelector("title")).not.toBeNull();
    }
  });

  it("Test 7 (no-data): empty response renders calendar-empty with 'No data for this time range'", async () => {
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCalendarResponse([]),
    );
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-empty")).toBeTruthy();
    });
    expect(screen.getByTestId("calendar-empty").textContent).toContain("No data for this time range");
  });

  it("Test 8 (config-incomplete): missing tableId shows config hint, not calendar", () => {
    const { container } = render(
      <CalendarRenderer widget={makeWidget({ tableId: undefined, tableRef: undefined })} tables={TABLES} />,
    );
    expect(container.querySelector(".config-hint")).not.toBeNull();
    expect(screen.queryByTestId("calendar-renderer")).toBeNull();
    expect(screen.queryByTestId("calendar-loading")).toBeNull();
  });

  it("Test 9 (suspend during materializing): while fvMaterializing, runSql is not called", async () => {
    mockViews = { 1: { viewName: undefined, materializing: true, expiresAt: 0 } };
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
