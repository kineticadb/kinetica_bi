/**
 * Phase 121 Plan 02 (DXIM-V124-10): ImportDashboardModal spec.
 *
 * Every test title begins "IMPRPT-" per the plan's grep anchor. The load-bearing test is
 * IMPRPT-conflict-verbatim: it asserts the server's MetricConflict.message renders EXACTLY,
 * and that no count-summary ("1 conflict") sneaks into the DOM instead.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ImportDashboardModal from "./ImportDashboardModal";
import * as clientModule from "../api/client";
import type { ImportReportDto } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    importDashboardFile: vi.fn(),
  };
});

const mockedClient = clientModule as unknown as {
  importDashboardFile: ReturnType<typeof vi.fn>;
};

// ─── fixtures ───────────────────────────────────────────────────────────────

const CONFLICT_MESSAGE =
  'Custom metric "Revenue" on kbi.sales already exists in this environment with a DIFFERENT expression. Imported widgets now use the EXISTING definition (SUM(amount)); the file\'s definition (SUM(amount) * 1.1) was NOT applied.';

const WIDENED_WARNING =
  'Widget "Sales by region" (file id 7): every layer in its includedLayerIds was unresolvable, so the list is now EMPTY — which means ALL LAYERS. Review this widget after import.';

const baseReport: ImportReportDto = {
  dashboardId: 42,
  dashboardName: "Test Dashboard",
  widgetsCreated: 3,
  layersCreated: 1,
  dynamicViewsCreated: 0,
  tablesMatched: [],
  tablesCreated: [],
  metricsMatched: [],
  metricsCreated: [],
  metricConflicts: [],
  strippedReferences: [],
  warnings: [],
  preflightDangling: [],
};

const makeFile = () =>
  new File(['{"schemaVersion":1}'], "dashboard-4-test-dashboard.json", { type: "application/json" });

describe("ImportDashboardModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IMPRPT-picker: Import disabled with no file, enabled after choosing one", async () => {
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    const importBtn = screen.getByRole("button", { name: "Import" });
    expect(importBtn).toBeDisabled();

    const file = makeFile();
    await userEvent.upload(screen.getByLabelText("Import file"), file);

    expect(importBtn).not.toBeDisabled();
  });

  it("IMPRPT-post: clicking Import calls importDashboardFile exactly once with the chosen File", async () => {
    mockedClient.importDashboardFile.mockResolvedValue(baseReport);
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    const file = makeFile();
    await userEvent.upload(screen.getByLabelText("Import file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(mockedClient.importDashboardFile).toHaveBeenCalledTimes(1));
    expect(mockedClient.importDashboardFile).toHaveBeenCalledWith(file);
  });

  it("IMPRPT-counts: shows widgetsCreated/layersCreated/dynamicViewsCreated/dashboardId after success", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({
      ...baseReport,
      widgetsCreated: 5,
      layersCreated: 2,
      dynamicViewsCreated: 1,
      dashboardId: 99,
    });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("99");
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("IMPRPT-tables: renders BOTH a matched tableRef and a created tableRef", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({
      ...baseReport,
      tablesMatched: [{ oldId: 1, newId: 10, schema: "kbi", name: "sales", tableRef: "kbi.sales" }],
      tablesCreated: [{ oldId: 2, newId: 20, schema: "kbi", name: "regions", tableRef: "kbi.regions" }],
    });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("kbi.sales");
    expect(screen.getByText("kbi.regions")).toBeInTheDocument();
    expect(screen.getAllByText("matched").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("created").length).toBeGreaterThanOrEqual(1);
  });

  it("IMPRPT-conflict-verbatim: shows the FULL conflict message, never a count summary", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({
      ...baseReport,
      metricConflicts: [
        {
          oldId: 1,
          newId: 10,
          tableId: 10,
          tableRef: "kbi.sales",
          label: "Revenue",
          existingExpression: "SUM(amount)",
          importedExpression: "SUM(amount) * 1.1",
          message: CONFLICT_MESSAGE,
        },
      ],
    });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText(CONFLICT_MESSAGE);
    expect(screen.queryByText(/1 conflict/)).not.toBeInTheDocument();
  });

  it("IMPRPT-conflict-hidden: metricConflicts: [] renders no 'Metric conflicts' heading", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({ ...baseReport, metricConflicts: [] });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("Test Dashboard", { exact: false });
    expect(screen.queryByText(/Metric conflicts/)).not.toBeInTheDocument();
  });

  it("IMPRPT-warnings: renders both warning strings verbatim", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({
      ...baseReport,
      warnings: [WIDENED_WARNING, "Custom metric \"Cost\" (file id 3) skipped: table not resolvable."],
    });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText(WIDENED_WARNING);
    expect(screen.getByText(/ALL LAYERS/)).toBeInTheDocument();
    expect(screen.getByText('Custom metric "Cost" (file id 3) skipped: table not resolvable.')).toBeInTheDocument();
  });

  it("IMPRPT-stripped: renders from/kind/id of a stripped reference", async () => {
    mockedClient.importDashboardFile.mockResolvedValue({
      ...baseReport,
      strippedReferences: [{ from: "widget:7", kind: "layer", id: 3 }],
    });
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("widget:7 — layer #3");
  });

  it("IMPRPT-error: shows the exact rejection message; report sections not rendered", async () => {
    mockedClient.importDashboardFile.mockRejectedValue(
      new Error("Import file is malformed: widgets must be an array (got undefined).")
    );
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("Import file is malformed: widgets must be an array (got undefined).");
    expect(screen.queryByText(/Import report:/)).not.toBeInTheDocument();
  });

  it("IMPRPT-rollback: shows the 422 rollback sentence verbatim", async () => {
    mockedClient.importDashboardFile.mockRejectedValue(
      new Error("Import failed partway through and was rolled back. No dashboard, widgets, layers or table entries were created.")
    );
    render(<ImportDashboardModal onClose={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText(
      "Import failed partway through and was rolled back. No dashboard, widgets, layers or table entries were created."
    );
  });

  it("IMPRPT-onImported: called once with the report on success; not called on rejection", async () => {
    const onImported = vi.fn();
    mockedClient.importDashboardFile.mockResolvedValue(baseReport);
    render(<ImportDashboardModal onClose={vi.fn()} onImported={onImported} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith(baseReport);

    onImported.mockClear();
    cleanup();
    mockedClient.importDashboardFile.mockRejectedValue(new Error("boom"));
    render(<ImportDashboardModal onClose={vi.fn()} onImported={onImported} />);
    await userEvent.upload(screen.getByLabelText("Import file"), makeFile());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await screen.findByText("boom");
    expect(onImported).not.toHaveBeenCalled();
  });

  it("IMPRPT-close: clicking Close in the header calls onClose", async () => {
    const onClose = vi.fn();
    render(<ImportDashboardModal onClose={onClose} onImported={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
