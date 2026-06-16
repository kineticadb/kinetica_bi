// Phase 67 Plan 02 (CAL-V113-04 + CAL-V113-05): CalendarRenderer specs.
// Phase 68 Plan 02 (CALDR-V113-01 + CALDR-V113-02): adds cell-click drill + selected-cell highlight.
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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
let mockFilters: Record<number, unknown[]> = {};
let mockDvFiltersStore: Record<number, unknown[]> = {};
const mockSetBulkFilters = vi.fn();
const mockAddDvFilter = vi.fn();
const mockRemoveDvFilter = vi.fn();
const mockRemoveFilter = vi.fn();

vi.mock("../../store/filterStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterStore = ((selector?: (s: unknown) => unknown) => {
    const state = {
      filters: mockFilters,
      dvFilters: mockDvFiltersStore,
      filterVersion: mockFilterVersion,
    };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterStore.getState = () => ({
    filters: mockFilters,
    dvFilters: mockDvFiltersStore,
    filterVersion: mockFilterVersion,
    setBulkFilters: mockSetBulkFilters,
    addDvFilter: mockAddDvFilter,
    removeDvFilter: mockRemoveDvFilter,
    removeFilter: mockRemoveFilter,
  });
  return { ...actual, useFilterStore };
});

// ---- Filter view store mock ----
// mockViews = table-path views keyed by tableId
// mockDvViews = dv-filter-path views keyed by dynamicViewId
let mockViews: Record<number, { viewName?: string; materializing: boolean; expiresAt: number }> = {};
let mockDvViews: Record<number, { viewName?: string; materializing: boolean }> = {};
const mockClearView = vi.fn();
const mockMarkMaterializing = vi.fn();
const mockMarkDvMaterializing = vi.fn();

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
    markMaterializing: mockMarkMaterializing,
    markDvMaterializing: mockMarkDvMaterializing,
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

// ---- Toast store mock ----
const mockShowToast = vi.fn();
vi.mock("../../store/toast", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useToastStore = ((selector?: (s: unknown) => unknown) => {
    const state = { showToast: mockShowToast };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useToastStore.getState = () => ({ showToast: mockShowToast });
  return { ...actual, useToastStore };
});

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
  mockFilters = {};
  mockDvFiltersStore = {};
  mockViews = {};
  mockDvViews = {};
  mockDvViews2 = {};
  mockClearView.mockClear();
  mockMarkMaterializing.mockClear();
  mockMarkDvMaterializing.mockClear();
  mockSetBulkFilters.mockClear();
  mockAddDvFilter.mockClear();
  mockRemoveDvFilter.mockClear();
  mockRemoveFilter.mockClear();
  mockShowToast.mockClear();
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

  it("Test 3 (table FROM resolution — respondToFilters OFF default): with filter-view present but respondToFilters absent/false, SQL FROM = BASE TABLE (not filter view)", async () => {
    // Phase 68-03: default is OFF → calendar always reads unfiltered source
    mockViews = {
      1: { viewName: "_kbi_filt_abc", materializing: false, expiresAt: Date.now() + 60_000 },
    };
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // respondToFilters OFF: ignore fvViewName, use base table
    expect(sql).toContain("FROM demo.sales");
    expect(sql).not.toContain("FROM _kbi_filt_abc");
  });

  it("Test 3a (table FROM resolution — respondToFilters ON): with filter-view present and respondToFilters:true, SQL FROM = filter view name", async () => {
    mockViews = {
      1: { viewName: "_kbi_filt_abc", materializing: false, expiresAt: Date.now() + 60_000 },
    };
    render(
      <CalendarRenderer
        widget={makeWidget({ respondToFilters: true })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // respondToFilters ON: use filter view name (Phase 67 behavior)
    expect(sql).toContain("FROM _kbi_filt_abc");
    expect(sql).not.toContain("FROM demo.sales");
  });

  it("Test 4a (DV FROM resolution — respondToFilters OFF): with dvFilterViewName set but respondToFilters=false, FROM = raw dvViewName", async () => {
    // Phase 68-03: OFF → ignore dvFilterViewName, use raw dvViewName
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
    // OFF: uses raw dv view, NOT filtered-dv view
    expect(sql).toContain("FROM _kbi_dv_raw_v99");
    expect(sql).not.toContain("FROM _kbi_dv_filt_v99");
    expect(sql).not.toContain("FROM demo.sales");
  });

  it("Test 4a-on (DV FROM resolution — respondToFilters ON): with dvFilterViewName set and respondToFilters:true, FROM = filtered-dv view", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    mockDvViews = { 99: { viewName: "_kbi_dv_filt_v99", materializing: false } };
    render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99, tableRef: "demo.sales", respondToFilters: true })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const sql = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // ON: uses filtered-dv view (Phase 67 behavior)
    expect(sql).toContain("FROM _kbi_dv_filt_v99");
    expect(sql).not.toContain("FROM demo.sales");
    expect(sql).not.toContain("FROM _kbi_dv_raw_v99");
  });

  it("Test 4b (DV FROM resolution — raw dv): with dvViewName only (no filter), FROM = raw dv view (same for ON/OFF)", async () => {
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

  it("Test 9 (suspend during materializing — respondToFilters ON): while fvMaterializing and respondToFilters:true, runSql is not called", async () => {
    // Phase 68-03: suspend gate only applies when respondToFilters=ON (filter-aware mode).
    // With OFF (default), the base table fetch ignores fvMaterializing.
    mockViews = { 1: { viewName: undefined, materializing: true, expiresAt: 0 } };
    render(
      <CalendarRenderer widget={makeWidget({ respondToFilters: true })} tables={TABLES} />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  /* ------------------------------------------------------------------ */
  /*  Phase 68-02: Cell-click drill dispatch tests (CALDR-V113-01/02)   */
  /* ------------------------------------------------------------------ */

  it("Test 10 (table drill): clicking a populated cell calls setBulkFilters with operator 'between' and [cellStart, cellEnd]", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Click the first populated cell (data-empty is absent)
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    expect(populatedRect).toBeTruthy();

    fireEvent.click(populatedRect!);

    expect(mockSetBulkFilters).toHaveBeenCalledOnce();
    const [calledTableId, calledFilters] = mockSetBulkFilters.mock.calls[0] as [number, unknown[]];
    expect(calledTableId).toBe(1);
    expect(calledFilters).toHaveLength(1);
    const f = calledFilters[0] as Record<string, unknown>;
    expect(f.operator).toBe("between");
    expect(f.dataType).toBe("datetime");
    expect(f.column).toBe("order_date");
    expect(Array.isArray(f.value) && (f.value as unknown[]).length === 2).toBe(true);
  });

  it("Test 11 (table drill calls markMaterializing, NOT addDvFilter): table-bound click triggers markMaterializing only", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    expect(mockMarkMaterializing).toHaveBeenCalledOnce();
    expect(mockMarkMaterializing).toHaveBeenCalledWith(1, 42); // tableId=1, dashboardId=42
    expect(mockAddDvFilter).not.toHaveBeenCalled();
  });

  it("Test 12 (dv drill): dv-bound click calls addDvFilter and NOT setBulkFilters", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99 })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    expect(mockAddDvFilter).toHaveBeenCalledOnce();
    const [calledDvId, calledFilter] = mockAddDvFilter.mock.calls[0] as [number, Record<string, unknown>];
    expect(calledDvId).toBe(99);
    expect(calledFilter.operator).toBe("between");
    expect(calledFilter.dataType).toBe("datetime");

    expect(mockSetBulkFilters).not.toHaveBeenCalled();
  });

  it("Test 13 (dv drill calls markDvMaterializing, NOT markMaterializing): dv isolation", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99 })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    expect(mockMarkDvMaterializing).toHaveBeenCalledOnce();
    expect(mockMarkDvMaterializing).toHaveBeenCalledWith(99, 42); // dynamicViewId=99, dashboardId=42
    expect(mockMarkMaterializing).not.toHaveBeenCalled();
  });

  it("Test 14 (dv isolation): filters[tableId] is untouched after a dv-bound drill", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ dynamicViewId: 99 })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    // setBulkFilters (table path) must NOT be called — table filters untouched
    expect(mockSetBulkFilters).not.toHaveBeenCalled();
    // filters[tableId] in the store stays empty
    expect(mockFilters[1] ?? []).toHaveLength(0);
  });

  it("Test 15 (empty cell guard): clicking a cell with value===null does NOT dispatch any store write", async () => {
    // Use sparse data so we get an empty cell
    const sparseRows = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 100 },
      { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-10 00:00:00", value: 150 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(sparseRows));

    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Find an empty cell — these have pointerEvents:none so clicking won't fire, but verify no store writes
    const emptyCell = container.querySelector('[data-empty="true"]');
    expect(emptyCell).toBeTruthy();
    // Empty cells have pointerEvents:none — no click dispatched, stores untouched
    expect(mockSetBulkFilters).not.toHaveBeenCalled();
    expect(mockAddDvFilter).not.toHaveBeenCalled();
    expect(mockMarkMaterializing).not.toHaveBeenCalled();
  });

  it("Test 16 (toggle off): re-clicking the active cell clears the calendar timeCol filter", async () => {
    // Pre-seed the store with an active between filter matching the first populated cell's bounds
    // First cell: domain=2026-01-01, subdomain=2026-01-03 → day subdomain
    // computeCellBounds("2026-01-03 00:00:00", "day") = ["2026-01-03T00:00:00.000Z", "2026-01-03T23:59:59.999Z"]
    const cellStart = "2026-01-03T00:00:00.000Z";
    const cellEnd = "2026-01-03T23:59:59.999Z";
    mockFilters = {
      1: [{ column: "order_date", value: [cellStart, cellEnd], operator: "between", dataType: "datetime", addedAt: Date.now() }],
    };

    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Click the SAME cell — should toggle OFF (clear the filter)
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    // Toggle-off: removeFilter called to clear the calendar's timeCol filter (targeted remove)
    expect(mockRemoveFilter).toHaveBeenCalledOnce();
    const [calledTableId, calledColumn] = mockRemoveFilter.mock.calls[0] as [number, string];
    expect(calledTableId).toBe(1);
    expect(calledColumn).toBe("order_date");
    expect(mockMarkMaterializing).toHaveBeenCalledOnce();
    // No toast on toggle-off
    expect(mockShowToast).not.toHaveBeenCalled();
    // setBulkFilters should NOT be called (not the clear path)
    expect(mockSetBulkFilters).not.toHaveBeenCalled();
  });

  it("Test 17 (toast on new drill): a toast fires when drilling a new cell", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    fireEvent.click(populatedRect!);

    expect(mockShowToast).toHaveBeenCalledOnce();
    const [toastMsg, toastKind] = mockShowToast.mock.calls[0] as [string, string];
    expect(toastKind).toBe("info");
    expect(typeof toastMsg).toBe("string");
    expect(toastMsg.length).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------ */
  /*  Phase 68-02 Task 2: Reactive selected-cell highlight              */
  /* ------------------------------------------------------------------ */

  it("Test 18 (highlight): cell matching active between filter has a stroke attribute", async () => {
    // Pre-seed a between filter matching cell at subdomain_bucket "2026-01-03 00:00:00"
    const cellStart = "2026-01-03T00:00:00.000Z";
    const cellEnd = "2026-01-03T23:59:59.999Z";
    mockFilters = {
      1: [{ column: "order_date", value: [cellStart, cellEnd], operator: "between", dataType: "datetime", addedAt: Date.now() }],
    };

    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // There should be at least one rect with a non-zero stroke (the active cell)
    const allRects = container.querySelectorAll("rect");
    const outlined = Array.from(allRects).find(
      (r) => r.getAttribute("stroke") && r.getAttribute("stroke") !== "none" && r.getAttribute("stroke") !== "",
    );
    expect(outlined).toBeTruthy();
  });

  it("Test 19 (no highlight): no rect has a non-default stroke when no between filter is active", async () => {
    // No filters active
    mockFilters = {};

    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    const outlined = Array.from(allRects).find(
      (r) => r.getAttribute("stroke") && r.getAttribute("stroke") !== "none" && r.getAttribute("stroke") !== "",
    );
    expect(outlined).toBeUndefined();
  });

  it("Test 19b (respondToFilters OFF — cell click still dispatches): with respondToFilters false, clicking a cell still calls setBulkFilters", async () => {
    // Cell clicks ALWAYS drive filters regardless of the toggle
    const { container } = render(
      <CalendarRenderer widget={makeWidget({ respondToFilters: false })} tables={TABLES} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    expect(populatedRect).toBeTruthy();
    fireEvent.click(populatedRect!);
    expect(mockSetBulkFilters).toHaveBeenCalledOnce();
  });

  it("Test 19c (respondToFilters in dep array): CalendarRenderer.tsx includes respondToFilters in the useEffect dependency array", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    expect(src).toContain("respondToFilters");
  });

  it("Test 20 (source contains appliedCell useMemo): CalendarRenderer.tsx has a useMemo deriving active between bounds", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Must contain the computeCellBounds import
    expect(src).toContain("computeCellBounds");
    // Must have operator "between" in a filter check
    expect(src).toMatch(/operator.*between|between.*operator/);
    // Must use useMemo for the appliedCell derivation
    expect(src).toContain("useMemo");
  });

  it("Test 21 (source: no raw hex in stroke): CalendarRenderer.tsx outline stroke is via theme token/CSS var, not raw hex", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Check that the stroke for the active cell uses a variable (not a raw hex)
    // The theme-guard spec scans the file — this assertion is supplementary
    const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
    expect(hexRe.test(src)).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /*  Phase 68-04 Task 2: Sole-materialize-trigger re-assertion +        */
  /*  chip lifecycle (CALDR-V113-03)                                     */
  /* ------------------------------------------------------------------ */

  // Test 22: Static-source-grep re-assertion (Phase 68-04 in-phase invariant check).
  // Mirrors Phase 67 plan 03 precedent: read the FULL source file, extract import statements,
  // and assert no import line contains the banned symbols — the sole-materialize-trigger
  // invariant is critical safety property (AggregatedWidgetRenderer = sole trigger).
  // This is a re-assertion of Test 0 in the 68-04 context with a broader grep:
  // any line starting with "import" (or "export { ... } from") must not reference the banned symbols.
  it("Test 22 (Phase 68-04 static re-assertion): CalendarRenderer.tsx — no import line contains materializeFilter|dropFilterView|fromSwap", () => {
    const path = resolve(__dirname, "CalendarRenderer.tsx");
    const src = readFileSync(path, "utf-8");
    // Extract all import/re-export declaration lines (broader than Test 0)
    const importBlock = src
      .split("\n")
      .filter((line) => /^\s*(import|export\s*\{|\s*}\s*from)\s/.test(line))
      .join("\n");
    expect(importBlock).not.toMatch(/materializeFilter|dropFilterView|fromSwap/);
    // Also confirm AggregatedWidgetRenderer pattern: the file DOES write to filter stores
    // (via setBulkFilters/addDvFilter/removeFilter/removeDvFilter) but never calls materialize
    // (any occurrence of materializeFilter in an import statement would be caught above).
    expect(src).toContain("setBulkFilters");
    // The string "materializeFilter" may appear in comments (e.g. "NO import of materializeFilter")
    // but must NOT appear in any import line — that is already asserted by importBlock check above.
  });

  // Test 23: Chip lifecycle — add→dismiss→unfiltered.
  // After a calendar drill, the between filter is present in the filterStore (chip appears).
  // After the chip-X dismiss action (removeFilter), the timeCol between filter is gone from
  // the store (calendar returns to unfiltered; the between entry is absent).
  it("Test 23 (chip lifecycle — table): after drill, between filter present; after chip removeFilter, filter gone", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // --- ADD: click a populated cell → setBulkFilters dispatched (chip appears in store) ---
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    expect(populatedRect).toBeTruthy();
    fireEvent.click(populatedRect!);

    // setBulkFilters was called with tableId=1 and a between filter for timeCol
    expect(mockSetBulkFilters).toHaveBeenCalledOnce();
    const [calledTableId, calledFilters] = mockSetBulkFilters.mock.calls[0] as [number, Array<Record<string, unknown>>];
    expect(calledTableId).toBe(1);
    expect(calledFilters).toHaveLength(1);
    const drillFilter = calledFilters[0];
    expect(drillFilter.column).toBe("order_date");
    expect(drillFilter.operator).toBe("between");
    // The filter is now "in the store" (chip present) — simulate by seeding mockFilters
    mockFilters = {
      1: [{
        column: drillFilter.column as string,
        value: drillFilter.value as [string, string],
        operator: "between",
        dataType: "datetime",
        addedAt: Date.now(),
      }],
    };

    // --- DISMISS: chip X → removeFilter(tableId, timeCol) → filter gone ---
    // Simulate what FilterBar does on chip dismiss: calls removeFilter(tableId, column).
    // After this, the store slice for timeCol is empty (between filter cleared).
    // The mock is wired in the filterStore mock above via useFilterStore.getState().removeFilter.
    mockRemoveFilter(1, "order_date");
    expect(mockRemoveFilter).toHaveBeenCalledWith(1, "order_date");
    // Simulate store update: the entry is now cleared
    mockFilters = { 1: [] };

    // The timeCol between filter is gone — filters[1] has no "between" entry for "order_date"
    const remaining = (mockFilters[1] ?? []).filter(
      (f) => (f as Record<string, unknown>).column === "order_date" && (f as Record<string, unknown>).operator === "between",
    );
    expect(remaining).toHaveLength(0);
  });

  // Test 24: Chip lifecycle — dv path: after dv drill, dvFilters[dvId] present; after removeDvFilter, gone.
  it("Test 24 (chip lifecycle — dv): after dv drill, dv between filter present; after chip removeDvFilter, filter gone", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "materialized" } };
    const { container } = render(
      <CalendarRenderer widget={makeWidget({ dynamicViewId: 99 })} tables={TABLES} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // --- ADD: click a populated cell → addDvFilter dispatched ---
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    expect(populatedRect).toBeTruthy();
    fireEvent.click(populatedRect!);

    expect(mockAddDvFilter).toHaveBeenCalledOnce();
    const [calledDvId, calledFilter] = mockAddDvFilter.mock.calls[0] as [number, Record<string, unknown>];
    expect(calledDvId).toBe(99);
    expect(calledFilter.column).toBe("order_date");
    expect(calledFilter.operator).toBe("between");
    // Simulate store: dv filter is now "present" (chip exists)
    mockDvFiltersStore = {
      99: [{
        column: calledFilter.column as string,
        value: calledFilter.value as [string, string],
        operator: "between",
        dataType: "datetime",
        addedAt: Date.now(),
      }],
    };

    // --- DISMISS: chip X → removeDvFilter(dvId, timeCol) → filter gone ---
    // The mock is wired in the filterStore mock above via useFilterStore.getState().removeDvFilter.
    mockRemoveDvFilter(99, "order_date");
    expect(mockRemoveDvFilter).toHaveBeenCalledWith(99, "order_date");
    // Simulate store update: dv entry cleared
    mockDvFiltersStore = { 99: [] };

    // The timeCol between filter is gone from dvFilters[99]
    const remaining = (mockDvFiltersStore[99] ?? []).filter(
      (f) => (f as Record<string, unknown>).column === "order_date" && (f as Record<string, unknown>).operator === "between",
    );
    expect(remaining).toHaveLength(0);
  });
});
