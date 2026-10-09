import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExportJobDto } from "../api/client";

const listExportJobs = vi.fn();
const cancelExportJob = vi.fn();
const deleteExportJob = vi.fn();
const startExportDownload = vi.fn();
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listExportJobs: (...a: unknown[]) => listExportJobs(...a),
    cancelExportJob: (...a: unknown[]) => cancelExportJob(...a),
    deleteExportJob: (...a: unknown[]) => deleteExportJob(...a),
  };
});
vi.mock("../lib/exportDownload", () => ({
  startExportDownload: (...a: unknown[]) => startExportDownload(...a),
}));

import { PermissionError } from "../api/client";
import { parseExportTimestamp } from "../lib/exportFormat";
import ExportsPage from "./ExportsPage";

const job = (o: Partial<ExportJobDto>): ExportJobDto => ({
  id: "j1", status: "complete", widgetId: 1, dashboardId: 1, rowsWritten: 5000000, totalRows: 5000000,
  fileBytes: null, errorCode: null, errorMessage: null, createdAt: "2026-03-01 10:00:00", startedAt: null,
  finishedAt: null, expiresAt: null, compress: false, name: "Q1", dashboardName: "Sales", widgetTitle: "Trips table", ...o,
});

const rowOf = (name: string) => screen.getByText(name).closest(".ds-row") as HTMLElement;

beforeEach(() => {
  listExportJobs.mockReset();
  cancelExportJob.mockReset();
  deleteExportJob.mockReset();
  startExportDownload.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ExportsPage", () => {
  it("EXPPAGE-card: title and description", async () => {
    listExportJobs.mockResolvedValue([]);
    render(<ExportsPage />);
    expect(await screen.findByText("Exports")).toBeTruthy();
    expect(screen.getByText("Your background CSV exports. Files are kept until they expire.")).toBeTruthy();
  });

  it("EXPPAGE-loading: shown on first load", async () => {
    listExportJobs.mockReturnValue(new Promise(() => {}));
    render(<ExportsPage />);
    expect(screen.getByText("Loading exports…")).toBeTruthy();
  });

  it("EXPPAGE-empty", async () => {
    listExportJobs.mockResolvedValue([]);
    render(<ExportsPage />);
    expect(await screen.findByText("No exports yet. Use Download on a large records table to start one.")).toBeTruthy();
  });

  it("EXPPAGE-permission", async () => {
    listExportJobs.mockRejectedValue(new PermissionError("x"));
    const { container } = render(<ExportsPage />);
    await screen.findByText("Permission denied");
    expect(container.querySelector(".widget-permission-denied")).toBeTruthy();
  });

  it("EXPPAGE-error-retry: error + Retry reloads", async () => {
    listExportJobs.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    const { container } = render(<ExportsPage />);
    await screen.findByText("boom");
    expect(container.querySelector(".export-error")?.textContent).toBe("boom");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(listExportJobs).toHaveBeenCalledTimes(2));
    await screen.findByText(/No exports yet/);
  });

  it("EXPPAGE-headers", async () => {
    listExportJobs.mockResolvedValue([job({})]);
    const { container } = render(<ExportsPage />);
    await screen.findByText("Q1");
    const table = container.querySelector(".datasets-table.exports-table")!;
    const heads = Array.from(table.querySelectorAll(".ds-header > span")).map((s) => s.textContent);
    expect(heads).toEqual(["Name", "Status", "Rows", "Size", "Started", "Expires", "Actions"]);
  });

  it("EXPPAGE-row: names, deleted fallbacks, null name", async () => {
    listExportJobs.mockResolvedValue([
      job({}),
      job({ id: "j2", name: "Gone", dashboardName: null, widgetTitle: null }),
      job({ id: "j3", name: null, createdAt: "2026-04-02 08:00:00" }),
    ]);
    render(<ExportsPage />);
    await screen.findByText("Q1");
    expect(within(rowOf("Q1")).getByText("Sales · Trips table")).toBeTruthy();
    expect(within(rowOf("Gone")).getByText("Deleted dashboard · Deleted widget")).toBeTruthy();
    expect(screen.getByText(/^Export /)).toBeTruthy();
  });

  it("EXPPAGE-rows-col: running N of M, complete total", async () => {
    listExportJobs.mockResolvedValue([
      job({ id: "r", name: "Run", status: "running", rowsWritten: 1240000, totalRows: 5000000 }),
      job({}),
    ]);
    render(<ExportsPage />);
    await screen.findByText("Run");
    expect(within(rowOf("Run")).getByText("1,240,000 of 5,000,000")).toBeTruthy();
    expect(within(rowOf("Q1")).getByText("5,000,000")).toBeTruthy();
  });

  it("EXPPAGE-size-started-expires", async () => {
    const created = "2026-03-01 10:00:00";
    listExportJobs.mockResolvedValue([
      job({ fileBytes: 340 * 1024 ** 2, createdAt: created, expiresAt: new Date(Date.now() + 23.5 * 3_600_000).toISOString() }),
      job({ id: "n", name: "NoSize", status: "failed", fileBytes: null }),
    ]);
    render(<ExportsPage />);
    await screen.findByText("Q1");
    const r = rowOf("Q1");
    expect(within(r).getByText("340 MB")).toBeTruthy();
    expect(within(r).getByText(parseExportTimestamp(created).toLocaleString())).toBeTruthy();
    expect(within(r).getByText("in 23 h")).toBeTruthy();
    const n = rowOf("NoSize");
    expect(within(n).getAllByText("—").length).toBe(2); // size + expires
  });

  it("EXPPAGE-status: labels and classes", async () => {
    listExportJobs.mockResolvedValue([
      job({ id: "a", name: "A", status: "queued", totalRows: null }),
      job({ id: "b", name: "B", status: "running" }),
      job({ id: "c", name: "C", status: "complete" }),
      job({ id: "d", name: "D", status: "failed", errorMessage: "Disk full" }),
      job({ id: "e", name: "E", status: "cancelled" }),
      job({ id: "f", name: "F", status: "session_expired", errorMessage: "Session ended mid-export" }),
    ]);
    render(<ExportsPage />);
    await screen.findByText("A");
    expect(within(rowOf("A")).getByText("Queued")).toBeTruthy();
    expect(within(rowOf("B")).getByText("Running")).toBeTruthy();
    expect(within(rowOf("C")).getByText("Complete")).toBeTruthy();
    expect(within(rowOf("D")).getByText("Failed").className).toBe("export-error");
    expect(within(rowOf("D")).getByText("Disk full").className).toBe("export-error");
    expect(within(rowOf("E")).getByText("Cancelled").className).toBe("muted");
    expect(within(rowOf("F")).getByText("Session ended").className).toBe("export-error");
    expect(within(rowOf("F")).getByText("Session ended mid-export").className).toBe("export-error");
  });

  it("EXPPAGE-actions: per-status buttons, no anchors", async () => {
    listExportJobs.mockResolvedValue([
      job({ id: "a", name: "A", status: "queued" }),
      job({ id: "b", name: "B", status: "running" }),
      job({ id: "c", name: "C", status: "complete" }),
      job({ id: "d", name: "D", status: "failed" }),
      job({ id: "e", name: "E", status: "cancelled" }),
      job({ id: "f", name: "F", status: "session_expired" }),
    ]);
    const { container } = render(<ExportsPage />);
    await screen.findByText("A");
    const labels = (n: string) =>
      within(rowOf(n)).getAllByRole("button").map((b) => b.textContent);
    expect(labels("A")).toEqual(["Cancel"]);
    expect(labels("B")).toEqual(["Cancel"]);
    expect(labels("C")).toEqual(["Download", "Delete"]);
    expect(labels("D")).toEqual(["Delete"]);
    expect(labels("E")).toEqual(["Delete"]);
    expect(labels("F")).toEqual(["Delete"]);
    const c = within(rowOf("C"));
    expect(c.getByRole("button", { name: "Download" }).className).toBe("ghost-sm");
    expect(c.getByRole("button", { name: "Delete" }).className).toBe("ghost-sm ghost-danger");
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("EXPPAGE-delete: confirm gate, removal, failure message", async () => {
    listExportJobs.mockResolvedValue([job({}), job({ id: "k", name: "Keep" })]);
    deleteExportJob.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(<ExportsPage />);
    await screen.findByText("Q1");
    await userEvent.click(within(rowOf("Q1")).getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith('Delete export "Q1"? The file will be removed and cannot be recovered.');
    expect(deleteExportJob).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(within(rowOf("Q1")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteExportJob).toHaveBeenCalledWith("j1"));
    await waitFor(() => expect(screen.queryByText("Q1")).toBeNull());

    deleteExportJob.mockRejectedValueOnce(new Error("Server said no"));
    await userEvent.click(within(rowOf("Keep")).getByRole("button", { name: "Delete" }));
    const msg = await screen.findByText("Server said no");
    expect(msg.className).toBe("export-error");
    expect(container.querySelector(".exports-table")!.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // cleared on next action
    confirm.mockReturnValue(false);
    await userEvent.click(within(rowOf("Keep")).getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Server said no")).toBeNull();
  });

  it("EXPPAGE-cancel: Cancelling… until terminal, buttons disabled in flight", async () => {
    listExportJobs.mockResolvedValue([job({ status: "running", rowsWritten: 10 })]);
    let resolve!: (v: ExportJobDto | null) => void;
    cancelExportJob.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<ExportsPage />);
    await screen.findByText("Q1");
    const btn = within(rowOf("Q1")).getByRole("button", { name: "Cancel" });
    await userEvent.click(btn);
    expect(cancelExportJob).toHaveBeenCalledWith("j1");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    resolve(job({ status: "running", rowsWritten: 10 }));
    await screen.findByText("Cancelling…");
    expect((within(rowOf("Q1")).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("EXPPAGE-download: false result reloads the list", async () => {
    listExportJobs.mockResolvedValue([job({})]);
    startExportDownload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<ExportsPage />);
    await screen.findByText("Q1");
    await userEvent.click(within(rowOf("Q1")).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(startExportDownload).toHaveBeenCalledWith("j1"));
    expect(listExportJobs).toHaveBeenCalledTimes(1);
    await userEvent.click(within(rowOf("Q1")).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(listExportJobs).toHaveBeenCalledTimes(2));
  });
});
