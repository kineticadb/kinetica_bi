/**
 * Phase 136 Plan 07 — SEAM: SQL-affecting overlays regenerate chart SQL at the render-time merge
 * (D-01, D-19). Appearance-only overlays and dv-bound widgets keep the saved SQL.
 * Harness mirrors WidgetRenderer.customMetric.spec.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import WidgetRenderer from "./WidgetRenderer";
import { DashboardContextProvider } from "../DashboardContext";
import * as clientModule from "../../api/client";
import type { WidgetDto, TableDto } from "../../api/client";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";

vi.mock("../../store/filterCombinationStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const state = { vizToHash: {}, registry: {}, combinationVersion: 0 };
  const useFilterCombinationStore = ((selector?: (s: unknown) => unknown) =>
    selector ? selector(state) : state) as unknown as { getState: () => unknown };
  useFilterCombinationStore.getState = () => ({ ...state, clearEntry: vi.fn() });
  return { ...actual, useFilterCombinationStore };
});

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    runSql: vi.fn(),
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
    listCustomMetrics: vi.fn().mockResolvedValue([]),
  };
});

const EMPTY = { column_headers: [] as string[], column_datatypes: [] as string[] };
const SAVED_SQL = "SELECT vendor_id, SUM(fare_amount) AS value FROM demo.trips GROUP BY vendor_id ORDER BY value DESC LIMIT 10";
const tables: TableDto[] = [
  { id: 5, schema: "demo", name: "trips", columns: { vendor_id: "string", fare_amount: "double", payment_type: "string" } },
] as unknown as TableDto[];

const makeWidget = (config: Record<string, unknown> = {}): WidgetDto => ({
  id: 1, dashboard_id: 1, title: "T", type: "bar", position: 0,
  config: {
    tableId: 5, table: "demo.trips", metricColumn: "fare_amount", aggregation: "SUM", groupByColumn: "vendor_id",
    sortDir: "DESC", limit: 10, sql: SAVED_SQL, drillDownColumn: "vendor_id", ...config,
  },
  created_at: "", updated_at: "",
});

const mount = async (widget: WidgetDto, overlay: Record<string, unknown>) => {
  useWidgetActionStore.getState().setControlContribution(99, { widget: { [widget.id]: overlay } });
  render(
    <DashboardContextProvider dashboardId={1} widgets={[widget]} dynamicViews={[]} retryDynamicView={() => {}}>
      <WidgetRenderer widget={widget} tables={tables} />
    </DashboardContextProvider>,
  );
  await waitFor(() => expect(clientModule.runSql).toHaveBeenCalled());
  return vi.mocked(clientModule.runSql).mock.calls[0][0];
};

beforeEach(() => {
  vi.clearAllMocks();
  useDynamicViewStore.getState().reset();
  vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY as unknown as Record<string, unknown>);
});

describe("SEAM — render-time SQL regeneration", () => {
  it("SEAM-10: group-by + aggregation overlay runs regenerated SQL, not the saved SQL", async () => {
    const sql = await mount(makeWidget(), { groupByColumn: "payment_type", aggregation: "avg" });
    expect(sql).toBe("SELECT payment_type, AVG(fare_amount) AS value FROM demo.trips GROUP BY payment_type ORDER BY value DESC LIMIT 10");
  });
  it("SEAM-11: appearance-only overlay keeps the saved SQL", async () => {
    expect(await mount(makeWidget(), { color: "teal" })).toBe(SAVED_SQL);
  });
  it("SEAM-12: saved customWhere is preserved in the regenerated SQL", async () => {
    const sql = await mount(makeWidget({ customWhere: "fare_amount > 0" }), { aggregation: "max" });
    expect(sql).toBe("SELECT vendor_id, MAX(fare_amount) AS value FROM demo.trips WHERE (fare_amount > 0) GROUP BY vendor_id ORDER BY value DESC LIMIT 10");
  });
  it("SEAM-13: dv-bound widget is not regenerated", async () => {
    useDynamicViewStore.getState().setView(3, { viewName: "_kbi_dv_u1_d1_3", status: "materialized", expiresAt: Date.now() + 300000 });
    const sql = await mount(makeWidget({ dynamicViewId: 3 }), { metric: "fare_amount", aggregation: "avg" });
    // saved SQL (SUM), FROM-swapped to the dv view: the overlay did not regenerate it
    expect(sql).toBe(SAVED_SQL.replace("demo.trips", "_kbi_dv_u1_d1_3"));
  });
  it("SEAM-17: metric edit on a custom-metric widget switches to the real column", async () => {
    const sql = await mount(makeWidget({ metricId: 9, sql: "SELECT vendor_id, X AS value FROM demo.trips GROUP BY vendor_id ORDER BY value DESC LIMIT 10" }), { metric: "fare_amount", aggregation: "min" });
    expect(sql).toBe("SELECT vendor_id, MIN(fare_amount) AS value FROM demo.trips GROUP BY vendor_id ORDER BY value DESC LIMIT 10");
  });
});
