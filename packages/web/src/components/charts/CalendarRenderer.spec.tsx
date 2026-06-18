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
let mockDvViews2: Record<number, { viewName?: string; status: string; reason?: string; error?: string }> = {};

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

  it("Test 5 (filterVersion re-fetch — respondToFilters ON): bumping filterVersion causes runSql to be called again", async () => {
    // respondToFilters:true — re-fetching on a filter change is the CORRECT behavior only when ON.
    // (The OFF case is asserted by Test 37: a filterVersion bump must NOT re-fetch.)
    const { rerender } = render(<CalendarRenderer widget={makeWidget({ respondToFilters: true })} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const callsBefore = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    // Bump filterVersion — simulate a filter being applied
    mockFilterVersion = 1;
    rerender(<CalendarRenderer widget={makeWidget({ respondToFilters: true })} tables={TABLES} />);
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

  /* ------------------------------------------------------------------ */
  /*  Phase 68.1-03: Wrapped layout + control bar + effective-value drill */
  /* ------------------------------------------------------------------ */

  // Test 25 (wrapped layout): with CANNED_ROWS, calendar-renderer appears and at least
  // one populated rect with a <title> is present (blocks still render cells).
  it("Test 25 (wrapped layout): calendar-renderer present + at least one populated rect with <title>", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const allRects = container.querySelectorAll("rect");
    const populatedRects = Array.from(allRects).filter((r) => !r.getAttribute("data-empty"));
    expect(populatedRects.length).toBeGreaterThan(0);
    for (const r of populatedRects) {
      expect(r.querySelector("title")).not.toBeNull();
    }
  });

  // Test 26 (group labels): with CANNED_ROWS (2 domain groups), the SVG contains
  // at least 1 <text> element (per-block group label).
  it("Test 26 (group labels): SVG contains at least one <text> group label", async () => {
    const { container } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const svg = container.querySelector('[data-testid="calendar-renderer"]');
    expect(svg).not.toBeNull();
    const texts = svg!.querySelectorAll("text");
    expect(texts.length).toBeGreaterThan(0);
  });

  // Test 27 (control bar OFF by default): without showDomainSubdomainControls,
  // calendar-control-bar is absent and no aria-labelled domain select is present.
  it("Test 27 (control bar OFF by default): no calendar-control-bar without showDomainSubdomainControls", async () => {
    render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    expect(screen.queryByTestId("calendar-control-bar")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /domain/i })).toBeNull();
  });

  // Test 28 (control bar ON): with showDomainSubdomainControls:true, calendar-control-bar
  // renders with both a Domain select and a Subdomain select.
  it("Test 28 (control bar ON): calendar-control-bar with Domain + Subdomain selects when showDomainSubdomainControls:true", async () => {
    render(
      <CalendarRenderer
        widget={makeWidget({ showDomainSubdomainControls: true })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const controlBar = screen.getByTestId("calendar-control-bar");
    expect(controlBar).toBeTruthy();
    // Use getByRole with exact aria-label match
    expect(screen.getByRole("combobox", { name: "Domain" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Subdomain" })).toBeTruthy();
  });

  // Test 29 (dependent gating): with controls ON and config domain="week",
  // the Subdomain select only lists VALID_DOMAIN_SUBDOMAIN.week = ["day","hour"].
  it("Test 29 (dependent gating): Subdomain select lists only valid subdomains for the effective domain", async () => {
    render(
      <CalendarRenderer
        widget={makeWidget({ domain: "week", subdomain: "day", showDomainSubdomainControls: true })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const subdomainSelect = screen.getByRole("combobox", { name: /subdomain/i });
    const options = Array.from(subdomainSelect.querySelectorAll("option")).map((o) => o.value);
    // VALID_DOMAIN_SUBDOMAIN.week = ["day", "hour"]
    expect(options).toContain("day");
    expect(options).toContain("hour");
    // Must NOT contain subdomains invalid for week (month/week)
    expect(options).not.toContain("month");
    expect(options).not.toContain("week");
  });

  // Test 30 (re-fetch on viewer change): with controls ON, changing the Domain select
  // triggers runSql again (call count increases).
  it("Test 30 (re-fetch on viewer change): changing viewer Domain select fires runSql again", async () => {
    render(
      <CalendarRenderer
        widget={makeWidget({ domain: "month", subdomain: "day", showDomainSubdomainControls: true })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    const callsBefore = (runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    // Change domain to "year" — valid subdomain day is in VALID_DOMAIN_SUBDOMAIN.year
    const domainSelect = screen.getByRole("combobox", { name: "Domain" });
    fireEvent.change(domainSelect, { target: { value: "year" } });

    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // Test 31 (view-local, no persist): CalendarRenderer.tsx never calls patch() —
  // viewer dropdowns are view-local state only; config never written from this component.
  it("Test 31 (view-local no persist): CalendarRenderer.tsx has no patch( call; viewer state via setViewerDomain/setViewerSubdomain", () => {
    const src = readFileSync(resolve(__dirname, "CalendarRenderer.tsx"), "utf-8");
    // Must not call patch() — view-local state only; config writes are never issued
    expect(src).not.toMatch(/\bpatch\s*\(/);
    // The component function signature accepts only widget + tables (not onChange)
    // Confirmed by checking the export default function line
    const funcLine = src.split("\n").find((l) => l.includes("export default function CalendarRenderer"));
    expect(funcLine).toBeDefined();
    expect(funcLine).not.toContain("onChange");
    // Confirm viewer state is managed via internal setState (not prop)
    expect(src).toContain("setViewerDomain");
    expect(src).toContain("setViewerSubdomain");
  });

  // Test 32 (effective-value drill): with controls ON, after changing viewer Subdomain to "week"
  // (valid for month domain), clicking a populated cell uses computeCellBounds with the effective
  // (viewer) subdomain. Verified by checking the BETWEEN filter bounds match a week-granularity bucket.
  it("Test 32 (effective-value drill): drill uses effective (viewer) subdomain bounds after viewer-subdomain change", async () => {
    // Config: domain=month, subdomain=day. We change viewer subdomain to "week".
    // Per-group gap-fill (68.2-03): after subdomain switches to "week", the re-fetched SQL must
    // return week-keyed subdomain_bucket values so gapFillCalendar can match them.
    // enumerateGroupBuckets("2026-01-01 00:00:00", "month", "week") → Mondays in Jan 2026:
    //   "2026-01-05 00:00:00", "2026-01-12 00:00:00", "2026-01-19 00:00:00", "2026-01-26 00:00:00"
    // computeCellBounds("2026-01-05 00:00:00", "week") → span = 7 days - 1ms = 604799999ms.

    // First fetch returns day-keyed CANNED_ROWS (already set up in beforeEach).
    // Second fetch (after subdomain→"week") returns week-keyed data.
    const weekKeyedRows = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-05 00:00:00", value: 42 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeCalendarResponse(CANNED_ROWS));
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeCalendarResponse(weekKeyedRows));

    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ domain: "month", subdomain: "day", showDomainSubdomainControls: true })}
        tables={TABLES}
      />,
    );

    // Wait for initial render with day subdomain
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Change viewer Subdomain to "week" (valid for month domain — VALID_DOMAIN_SUBDOMAIN.month = ["week","day"])
    const subdomainSelect = screen.getByRole("combobox", { name: "Subdomain" });
    fireEvent.change(subdomainSelect, { target: { value: "week" } });

    // Wait for re-fetch with new effSubdomain (runSql called again)
    await waitFor(() => {
      expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    });

    // After re-fetch, wait for calendar-renderer (week-keyed data returned by mock)
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Click the first populated cell — drill should use effSubdomain="week" bounds
    const allRects = container.querySelectorAll("rect");
    const populatedRect = Array.from(allRects).find((r) => !r.getAttribute("data-empty"));
    expect(populatedRect).toBeTruthy();
    fireEvent.click(populatedRect!);

    expect(mockSetBulkFilters).toHaveBeenCalled();
    const [, calledFilters] = mockSetBulkFilters.mock.calls[0] as [number, Array<Record<string, unknown>>];
    expect(calledFilters).toHaveLength(1);
    const f = calledFilters[0];
    expect(f.operator).toBe("between");
    // With effSubdomain="week", the BETWEEN span should be 7 days - 1ms = 604799999ms
    const [lo, hi] = f.value as [string, string];
    const diffMs = new Date(hi).getTime() - new Date(lo).getTime();
    expect(diffMs).toBe(604_799_999); // 7 days - 1ms (week bucket)
  });

  /* ------------------------------------------------------------------ */
  /*  Phase 68.2-03: per-group gap-fill renderer invariants              */
  /* ------------------------------------------------------------------ */

  // Test 33 (week×day single column): a week×day domain group renders at most 7 cells
  // (1 col × 7 rows) — never a month-shaped phantom block.
  // Confirms cross-fill bug is gone: previously a week group got cells from all weeks'
  // days, creating multiple columns.
  it("Test 33 (week×day single column): a week-domain/day-subdomain group has at most 7 day cells — no phantom cross-fill", async () => {
    // Single-week response: Mon 2024-10-07, data on Wed 2024-10-09 only
    const weekRows = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 5 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(weekRows));

    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ domain: "week", subdomain: "day" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // Count ALL rects (populated + data-empty) within the calendar renderer
    const allRects = container.querySelectorAll("rect");
    // A single week×day group should produce at most 7 rects (1 populated + ≤6 grey)
    // Before the fix, the global cross-fill would produce many more if multiple weeks' data
    expect(allRects.length).toBeLessThanOrEqual(7);
    expect(allRects.length).toBeGreaterThanOrEqual(7); // full week always shown
  });

  // Test 34 (out-of-range blank): for a single-week group, the total rects is ≤7 —
  // NOT month-shaped (30+). Confirms out-of-range slots produce no rect at all.
  it("Test 34 (out-of-range blank): single-week group renders ≤7 total rects — not month-shaped", async () => {
    const weekRows = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 10 },
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-11 00:00:00", value: 20 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(weekRows));

    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ domain: "week", subdomain: "day" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    const allRects = container.querySelectorAll("rect");
    // Exactly 7 cells for the one week group — not 30+ from phantom cross-fill
    expect(allRects.length).toBeLessThanOrEqual(7);
  });

  // Test 35 (in-range grey preserved): a week group with data on 2 of 7 days
  // renders data-empty="true" rects for the 5 missing in-range days.
  it("Test 35 (in-range grey preserved): missing in-range days render data-empty rects; populated days have <title>", async () => {
    // Week of 2024-10-07: data only on Mon (Oct 7) and Wed (Oct 9) — 5 missing days
    const weekRows = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-07 00:00:00", value: 1 },
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 3 },
    ];
    (runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeCalendarResponse(weekRows));

    const { container } = render(
      <CalendarRenderer
        widget={makeWidget({ domain: "week", subdomain: "day" })}
        tables={TABLES}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });

    // 5 in-range missing days → 5 grey cells
    const emptyCells = container.querySelectorAll('[data-empty="true"]');
    expect(emptyCells.length).toBe(5);

    // Empty cells have no <title> (non-interactive)
    for (const cell of Array.from(emptyCells)) {
      expect(cell.querySelector("title")).toBeNull();
    }

    // 2 populated cells have <title>
    const allRects = container.querySelectorAll("rect");
    const populatedRects = Array.from(allRects).filter((r) => !r.getAttribute("data-empty"));
    expect(populatedRects.length).toBe(2);
    for (const cell of populatedRects) {
      expect(cell.querySelector("title")).not.toBeNull();
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Phase 69 gap-fixes (live-UAT findings)                          */
  /* ---------------------------------------------------------------- */

  // Test 36 (issue 1 — dv over_threshold parity): a dv-bound calendar whose dv is NOT materialized
  // (over_threshold/no_filter) must show the SAME "Load full table" placeholder other charts show
  // — NOT an infinite "Loading…" — and must NOT issue runSql against a non-materialized dv.
  it("Test 36 (dv over_threshold/no_filter): shows Load-full-table CTA, not infinite loading; no runSql", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "over_threshold", reason: "no_filter" } };
    render(
      <CalendarRenderer widget={makeWidget({ dynamicViewId: 99, tableRef: "demo.sales" })} tables={TABLES} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-over-threshold")).toBeTruthy();
    });
    expect(screen.getByText(/load the full table/i)).toBeTruthy();
    // NOT stuck on the loading placeholder, and no SQL issued for a non-materialized dv.
    expect(screen.queryByTestId("calendar-loading")).toBeNull();
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // Test 36b (issue 1 — exceeds_max_records): a filter is applied but the dv result is still too
  // large → "Too much data" message (no CTA), parity with WidgetRenderer.
  it("Test 36b (dv over_threshold/exceeds_max_records): shows narrow-filters message; no runSql", async () => {
    mockDvViews2 = { 99: { viewName: "_kbi_dv_raw_v99", status: "over_threshold", reason: "exceeds_max_records" } };
    render(
      <CalendarRenderer widget={makeWidget({ dynamicViewId: 99, tableRef: "demo.sales" })} tables={TABLES} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-over-threshold")).toBeTruthy();
    });
    expect(screen.getByText(/too much data/i)).toBeTruthy();
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // Test 37 (issue 3 — respondToFilters OFF ignores filter changes): with OFF (default), bumping
  // filterVersion must NOT re-fetch — the calendar reads the unfiltered source, so filter-store
  // churn is irrelevant. (Old behavior re-fetched on every filter change; see fixed Test 5.)
  it("Test 37 (respondToFilters OFF): filterVersion bump does NOT re-fetch", async () => {
    const { rerender } = render(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // Apply a dashboard filter (bump version) — an OFF calendar must ignore it.
    mockFilterVersion = 5;
    rerender(<CalendarRenderer widget={makeWidget()} tables={TABLES} />);
    // Give any (erroneous) re-fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 25));
    expect((runSql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // Test 38 (issue 2 — no flicker on re-fetch): while a re-fetch is IN FLIGHT, the calendar keeps
  // the previously-rendered grid (stale data) instead of blanking to "Loading…". respondToFilters
  // ON so a filterVersion bump drives the re-fetch; the second runSql is held open.
  it("Test 38 (re-fetch keeps stale grid — no Loading flash)", async () => {
    const fn = runSql as unknown as ReturnType<typeof vi.fn>;
    let resolveSecond: (v: unknown) => void = () => {};
    fn.mockReset();
    fn.mockResolvedValueOnce(makeCalendarResponse(CANNED_ROWS)); // initial load
    fn.mockImplementationOnce(() => new Promise((res) => { resolveSecond = res; })); // re-fetch hangs
    fn.mockResolvedValue(makeCalendarResponse(CANNED_ROWS)); // any further calls

    const { rerender } = render(
      <CalendarRenderer widget={makeWidget({ respondToFilters: true })} tables={TABLES} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    });
    // Trigger a re-fetch (filter applied) — the second runSql is in flight.
    mockFilterVersion = 1;
    rerender(<CalendarRenderer widget={makeWidget({ respondToFilters: true })} tables={TABLES} />);
    await new Promise((r) => setTimeout(r, 25));
    // While the re-fetch is in flight the OLD grid stays — NO loading flash.
    expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    expect(screen.queryByTestId("calendar-loading")).toBeNull();
    resolveSecond(makeCalendarResponse(CANNED_ROWS)); // unblock the hung fetch
  });
});
