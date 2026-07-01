/**
 * CustomMetricsEditorModal spec — Phase 100 Plan 01
 *
 * Coverage:
 *   T1 — renders empty-state placeholder and "Add metric" affordance when no metrics exist
 *   T2 — add flow: click Add metric, type label + expression, click Save → createCustomMetric called + new row appears in left list
 *   T3 — duplicate-label flow: createCustomMetric rejects with 409 text → inline error shown, onClose NOT called
 *   T4 — delete flow: existing metric selected, confirm() true → deleteCustomMetric called + row disappears
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import CustomMetricsEditorModal from "./CustomMetricsEditorModal";
import * as clientModule from "../api/client";
import type { TableDto, CustomMetricRow } from "../api/client";
import { useCustomMetricsStore } from "../store/customMetricsStore";

// ---------------------------------------------------------------------------
// Mock api/client — only stub the custom metric functions
// ---------------------------------------------------------------------------
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listCustomMetrics: vi.fn(),
    createCustomMetric: vi.fn(),
    updateCustomMetric: vi.fn(),
    deleteCustomMetric: vi.fn(),
  };
});

const mockedClient = clientModule as unknown as {
  listCustomMetrics: ReturnType<typeof vi.fn>;
  createCustomMetric: ReturnType<typeof vi.fn>;
  updateCustomMetric: ReturnType<typeof vi.fn>;
  deleteCustomMetric: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Fixture table
// ---------------------------------------------------------------------------
const makeTable = (overrides?: Partial<TableDto>): TableDto => ({
  id: 10,
  name: "sales_data",
  schema: "public",
  columns: { revenue: "DOUBLE", cost: "DOUBLE" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const TABLE = makeTable();

// A minimal metric row fixture
const makeMetricRow = (overrides?: Partial<CustomMetricRow>): CustomMetricRow => ({
  id: 1,
  table_id: 10,
  label: "ROAS",
  expression: "SUM(revenue) / SUM(cost)",
  format_spec: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderModal(table: TableDto = TABLE) {
  const onClose = vi.fn();
  const utils = render(
    <CustomMetricsEditorModal table={table} onClose={onClose} />,
  );
  return { ...utils, onClose };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Default: no metrics
  mockedClient.listCustomMetrics.mockResolvedValue([]);
  mockedClient.createCustomMetric.mockResolvedValue(makeMetricRow());
  mockedClient.updateCustomMetric.mockResolvedValue(makeMetricRow());
  mockedClient.deleteCustomMetric.mockResolvedValue(undefined);
  useCustomMetricsStore.getState().reset();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CustomMetricsEditorModal", () => {
  // T1: renders empty state + Add metric button
  it("T1: renders empty-state placeholder and Add metric affordance when no metrics", async () => {
    renderModal();

    // Wait for the load to settle
    await waitFor(() => {
      expect(mockedClient.listCustomMetrics).toHaveBeenCalledWith(10);
    });

    // Empty-state text in the right pane
    expect(screen.getByText(/select a metric or add a new one/i)).toBeInTheDocument();

    // Add metric button in the left pane
    expect(screen.getByRole("button", { name: /add metric/i })).toBeInTheDocument();
  });

  // T2: add flow
  it("T2: add flow — type label + expression, Save → createCustomMetric called + row appears", async () => {
    const created = makeMetricRow({ id: 5, label: "Gross Margin", expression: "SUM(revenue) - SUM(cost)" });
    mockedClient.createCustomMetric.mockResolvedValue(created);

    renderModal();

    await waitFor(() => {
      expect(mockedClient.listCustomMetrics).toHaveBeenCalled();
    });

    // Click Add metric
    fireEvent.click(screen.getByRole("button", { name: /add metric/i }));

    // Form appears — label and expression inputs should be visible
    const labelInput = screen.getByRole("textbox", { name: /^label$/i });
    const exprInput = screen.getByRole("textbox", { name: /sql expression/i });

    expect(labelInput).toBeInTheDocument();
    expect(exprInput).toBeInTheDocument();

    // Type into the form
    fireEvent.change(labelInput, { target: { value: "Gross Margin" } });
    fireEvent.change(exprInput, { target: { value: "SUM(revenue) - SUM(cost)" } });

    // Save button should be enabled
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockedClient.createCustomMetric).toHaveBeenCalledWith(
        10,
        "Gross Margin",
        "SUM(revenue) - SUM(cost)",
        null, // no format spec (none kind)
      );
    });

    // The new metric row should appear in the left list
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /gross margin/i })).toBeInTheDocument();
    });
  });

  // T3: duplicate-label inline error
  it("T3: duplicate-label → inline .custom-metrics-editor-error shown, onClose NOT called", async () => {
    const DUPLICATE_MSG = "A custom metric with this label already exists on this table.";
    mockedClient.createCustomMetric.mockRejectedValue(new Error(DUPLICATE_MSG));

    const { onClose } = renderModal();

    await waitFor(() => {
      expect(mockedClient.listCustomMetrics).toHaveBeenCalled();
    });

    // Click Add metric
    fireEvent.click(screen.getByRole("button", { name: /add metric/i }));

    const labelInput = screen.getByRole("textbox", { name: /^label$/i });
    const exprInput = screen.getByRole("textbox", { name: /sql expression/i });
    fireEvent.change(labelInput, { target: { value: "ROAS" } });
    fireEvent.change(exprInput, { target: { value: "SUM(revenue)/SUM(cost)" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });

    // Inline error element with the correct class must exist
    await waitFor(() => {
      const errorEl = document.querySelector(".custom-metrics-editor-error");
      expect(errorEl).toBeInTheDocument();
      expect(errorEl?.textContent).toContain("already exists");
    });

    // onClose must NOT have been called
    expect(onClose).not.toHaveBeenCalled();
  });

  // T4: delete flow
  it("T4: delete flow — existing metric selected, confirm true → deleteCustomMetric called, row disappears", async () => {
    // Return the metric from the API so loadConfig populates the store on mount
    const row = makeMetricRow();
    mockedClient.listCustomMetrics.mockResolvedValue([row]);

    // Stub confirm to return true
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderModal();

    // The metric row should be visible in the left list once loadConfig resolves
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /roas/i })).toBeInTheDocument();
    });

    // Click the metric to select it
    fireEvent.click(screen.getByRole("button", { name: /roas/i }));

    // Delete button should now be visible
    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    expect(deleteBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(mockedClient.deleteCustomMetric).toHaveBeenCalledWith(10, 1);
    });

    // The row should disappear from the list
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /roas/i })).not.toBeInTheDocument();
    });
  });
});
