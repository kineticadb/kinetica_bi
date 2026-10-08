import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExportJobDto } from "../api/client";

vi.mock("../api/client", async (orig) => ({
  ...(await orig<typeof import("../api/client")>()),
  startExport: vi.fn(),
  cancelExportJob: vi.fn(),
  getExportJob: vi.fn(),
}));
vi.mock("../lib/exportDownload", async (orig) => ({
  ...(await orig<typeof import("../lib/exportDownload")>()),
  startExportDownload: vi.fn(),
}));

import {
  cancelExportJob,
  getExportJob,
  NAVIGATE_EXPORTS_EVENT,
  startExport,
} from "../api/client";
import { startExportDownload } from "../lib/exportDownload";
import { exportRowCapMessage } from "../lib/exportFormat";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import {
  setDialogJob,
  stopAllExportTracking,
  useExportTrackerStore,
} from "../store/exportTracker";
import ExportDialog, { type ExportDialogProps } from "./ExportDialog";

function dto(over: Partial<ExportJobDto> = {}): ExportJobDto {
  return {
    id: "j1",
    status: "running",
    widgetId: 1,
    dashboardId: 1,
    rowsWritten: 0,
    totalRows: null,
    fileBytes: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-10-07 10:00:00",
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    compress: false,
    name: "Q1",
    dashboardName: null,
    widgetTitle: null,
    ...over,
  };
}

const body = {
  widgetId: 1,
  filters: [],
  options: { compress: false, format: "raw" as const, name: "x" },
};

function setup(over: Partial<ExportDialogProps> = {}) {
  const props: ExportDialogProps = {
    widgetTitle: "Taxi trips",
    totalCount: 5_000_000,
    inBrowserCap: 100000,
    formattedAvailable: true,
    overrideActive: false,
    dvNotReady: false,
    buildRequest: vi.fn().mockReturnValue(body),
    onPartialDownload: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const utils = render(<ExportDialog {...props} />);
  return { props, ...utils };
}

const setJob = (d: ExportJobDto) =>
  act(() => useExportTrackerStore.setState({ jobs: { [d.id]: d } }));

async function startWith(running: ExportJobDto = dto()) {
  vi.mocked(startExport).mockResolvedValue(running);
  await userEvent.click(screen.getByRole("button", { name: "Start export" }));
  await screen.findByText("Close", { selector: ".ds-actions button" });
}

beforeEach(() => {
  useAuthStore.setState({
    exportLimits: { maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 },
  });
  vi.mocked(startExport).mockReset();
  vi.mocked(cancelExportJob).mockReset();
  vi.mocked(getExportJob).mockReset();
  vi.mocked(startExportDownload).mockReset();
});
afterEach(() => {
  stopAllExportTracking();
  vi.useRealTimers();
});

describe("ExportDialog", () => {
  // Gap closure (operator UAT 2026-10-08): the dashboard grid positions widgets with CSS transforms, which trap
  // position:fixed descendants, so the dialog must render into <body>, not inside the widget.
  it("EXPDLG-portal: renders into document.body, outside the widget that mounts it", () => {
    const { container } = setup();
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest(".modal-overlay")?.parentElement).toBe(document.body);
  });

  it("EXPDLG-modal-classes: uses the modal field/segmented-choice classes, not the side-panel heading", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".config-group-label")).toBeNull();
    expect(dialog.querySelector(".radiogroup--buttons")).not.toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Values" })).toBeTruthy();
    expect(dialog.querySelectorAll(".ds-field-label").length).toBeGreaterThanOrEqual(2);
  });

  it("EXPDLG-defaults: name, raw, compress off, file hint", async () => {
    setup();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toMatch(/^Taxi trips \d{4}-\d{2}-\d{2} \d{4}$/);
    expect(input).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Raw values" })).toBeChecked();
    expect(screen.getByLabelText("Compress (.zip)")).not.toBeChecked();
    expect(screen.getByText(`${input.value}.csv`)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Compress (.zip)"));
    expect(screen.getByText(`${input.value}.zip`)).toBeInTheDocument();
    expect(screen.queryByText(`${input.value}.csv.gz`)).toBeNull();
  });

  it("EXPDLG-limits: shows set caps", () => {
    useAuthStore.setState({
      exportLimits: {
        maxRows: 10_000_000,
        maxFileMb: 2048,
        maxConcurrentPerUser: 2,
      },
    });
    setup();
    expect(
      screen.getByText("Limits: 10,000,000 rows · 2 GB · 2 at a time"),
    ).toBeInTheDocument();
  });

  it("EXPDLG-over-limit: row cap message and Start disabled", () => {
    useAuthStore.setState({
      exportLimits: {
        maxRows: 10_000_000,
        maxFileMb: null,
        maxConcurrentPerUser: 2,
      },
    });
    setup({ totalCount: 12_000_000 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      exportRowCapMessage(12_000_000, 10_000_000),
    );
    const start = screen.getByRole("button", { name: "Start export" });
    expect(start).toBeDisabled();
    expect(start).not.toHaveAttribute("title");
  });

  it("EXPDLG-unknown-count: no alert, partial label uses cap", () => {
    useAuthStore.setState({
      exportLimits: { maxRows: 10, maxFileMb: null, maxConcurrentPerUser: 2 },
    });
    setup({ totalCount: null });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download first 100,000 rows now" }),
    ).toBeInTheDocument();
  });

  it("EXPDLG-empty-name: Start disabled with title", async () => {
    setup();
    await userEvent.clear(screen.getByRole("textbox"));
    const start = screen.getByRole("button", { name: "Start export" });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute("title", "Enter a name for the export.");
  });

  it("EXPDLG-start-body: builds request from the form and shows Starting…", async () => {
    let resolve!: (d: ExportJobDto) => void;
    vi.mocked(startExport).mockReturnValue(new Promise((r) => (resolve = r)));
    const { props } = setup();
    await userEvent.click(screen.getByLabelText("Compress (.zip)"));
    await userEvent.click(screen.getByRole("radio", { name: "Formatted values" }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "Q1");
    await userEvent.click(screen.getByRole("button", { name: "Start export" }));
    expect(props.buildRequest).toHaveBeenCalledWith({
      compress: true,
      format: "formatted",
      name: "Q1",
    });
    expect(startExport).toHaveBeenCalledWith(body);
    const pending = screen.getByRole("button", { name: "Starting…" });
    expect(pending).toBeDisabled();
    await act(async () => resolve(dto()));
  });

  it("EXPDLG-enter-submits: Enter in name starts", async () => {
    vi.mocked(startExport).mockResolvedValue(dto());
    setup();
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it("EXPDLG-refused: server message verbatim, dialog stays, Start enabled", async () => {
    const msg =
      "You already have 2 exports running. Wait for one to finish or cancel one, then try again.";
    vi.mocked(startExport).mockRejectedValue(new Error(msg));
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start export" })).toBeEnabled();
  });

  it("EXPDLG-network: TypeError shows connection message", async () => {
    vi.mocked(startExport).mockRejectedValue(new TypeError("x"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Check your connection and try again.",
    );
  });

  it("EXPDLG-formatted-unavailable: radio disabled with hint", () => {
    setup({ formattedAvailable: false });
    expect(screen.getByRole("radio", { name: "Formatted values" })).toBeDisabled();
    expect(
      screen.getByText(
        "Not available for this widget: it has no dataset with column formats.",
      ),
    ).toBeInTheDocument();
  });

  it("EXPDLG-override-note: only when active", () => {
    const note =
      "Exports use the saved widget settings. Filters and sort are included; widget-action overrides are not.";
    const { unmount } = setup({ overrideActive: true });
    expect(screen.getByText(note)).toBeInTheDocument();
    unmount();
    setup({ overrideActive: false });
    expect(screen.queryByText(note)).toBeNull();
  });

  it("EXPDLG-dv-not-ready: message and Start disabled", () => {
    setup({ dvNotReady: true });
    expect(
      screen.getByText("The data view is not ready yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start export" })).toBeDisabled();
  });

  it("EXPDLG-progress: counts, progressbar aria, queued, unknown total", async () => {
    setup();
    await startWith(dto({ status: "queued" }));
    expect(screen.getByText("Waiting to start…")).toBeInTheDocument();
    setJob(dto({ rowsWritten: 1_240_000, totalRows: 5_000_000 }));
    expect(screen.getByText("1,240,000 of 5,000,000 rows")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuenow", "1240000");
    expect(bar).toHaveAttribute("aria-valuemax", "5000000");
    setJob(dto({ rowsWritten: 1500, totalRows: null }));
    expect(screen.getByText("1,500 rows")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuemax",
    );
  });

  it("EXPDLG-cancel: Cancelling… until the server reports cancelled", async () => {
    setup();
    await startWith();
    vi.mocked(cancelExportJob).mockResolvedValue(dto({ rowsWritten: 5 }));
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel export" }),
    );
    expect(cancelExportJob).toHaveBeenCalledWith("j1");
    const btn = await screen.findByRole("button", { name: "Cancelling…" });
    expect(btn).toBeDisabled();
    setJob(dto({ status: "cancelled" }));
    expect(screen.getByText("Export cancelled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelling…" })).toBeNull();
  });

  it("EXPDLG-complete: size line and Download <button>, no anchors", async () => {
    setup();
    await startWith();
    setJob(
      dto({
        status: "complete",
        totalRows: 5_000_000,
        rowsWritten: 5_000_000,
        fileBytes: 1.2 * 1024 ** 3,
      }),
    );
    expect(screen.getByText("5,000,000 rows · 1.2 GB")).toBeInTheDocument();
    const dl = screen.getByRole("button", { name: "Download" });
    expect(dl).toHaveClass("btn-primary", "btn-sm");
    await userEvent.click(dl);
    expect(startExportDownload).toHaveBeenCalledWith("j1");
    expect(document.querySelector("a")).toBeNull();
  });

  it("EXPDLG-failed: failed and session_expired show errorMessage", async () => {
    setup();
    await startWith();
    setJob(dto({ status: "failed", errorMessage: "Boom happened." }));
    expect(screen.getByRole("alert")).toHaveTextContent("Boom happened.");
    setJob(
      dto({ status: "session_expired", errorMessage: "Your session ended." }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Your session ended.");
  });

  it("EXPDLG-close-running: Close keeps the tracker job", async () => {
    const { props } = setup();
    await startWith();
    await userEvent.click(
      screen.getByText("Close", { selector: ".ds-actions button" }),
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(useExportTrackerStore.getState().dialogJobId).toBeNull();
    expect(useExportTrackerStore.getState().jobs.j1).toBeDefined();
  });

  it("EXPDLG-escape-overlay: Escape and overlay close; inside click does not", async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("dialog"));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("EXPDLG-escape-progress: Escape closes in the progress phase", async () => {
    const { props } = setup();
    await startWith();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("EXPDLG-focus-return: focus returns to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = setup();
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("EXPDLG-unmount-running: unmount without Close still lets the tracker toast", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const showToast = vi.fn();
    useToastStore.setState({ showToast } as never);
    const { unmount } = setup();
    await startWith();
    expect(useExportTrackerStore.getState().dialogJobId).toBe("j1");
    unmount();
    expect(useExportTrackerStore.getState().dialogJobId).toBeNull();
    expect(useExportTrackerStore.getState().jobs.j1).toBeDefined();
    vi.mocked(getExportJob).mockResolvedValue(dto({ status: "complete" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(showToast).toHaveBeenCalledWith(
      'Export "Q1" is ready',
      "info",
      expect.objectContaining({ label: "Download" }),
    );
  });

  it("EXPDLG-unmount-foreign: cleanup leaves another dialog's claim", async () => {
    const { unmount } = setup();
    await startWith();
    act(() => setDialogJob("other-id"));
    unmount();
    expect(useExportTrackerStore.getState().dialogJobId).toBe("other-id");
  });

  it("EXPDLG-partial: closes then runs the in-browser download", async () => {
    const { props } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Download first 100,000 rows now" }),
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onPartialDownload).toHaveBeenCalled();
    expect(vi.mocked(props.onClose).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(props.onPartialDownload).mock.invocationCallOrder[0],
    );
  });

  it("EXPDLG-see-all: closes and dispatches navigate event", async () => {
    const handler = vi.fn();
    window.addEventListener(NAVIGATE_EXPORTS_EVENT, handler);
    const { props } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "See all exports" }),
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(NAVIGATE_EXPORTS_EVENT, handler);
  });
});
