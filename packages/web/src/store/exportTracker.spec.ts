import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExportJobDto } from "../api/client";

vi.mock("../api/client", async (orig) => ({
  ...(await orig<typeof import("../api/client")>()),
  getExportJob: vi.fn(),
}));
vi.mock("../lib/exportDownload", () => ({ startExportDownload: vi.fn() }));

import { getExportJob, ReauthRequiredError } from "../api/client";
import { startExportDownload } from "../lib/exportDownload";
import { useToastStore } from "./toast";
import {
  EXPORT_POLL_MS,
  setDialogJob,
  stopAllExportTracking,
  trackExport,
  useExportTrackerStore,
} from "./exportTracker";

const getJob = vi.mocked(getExportJob);

function dto(over: Partial<ExportJobDto> = {}): ExportJobDto {
  return {
    id: "j1",
    status: "running",
    widgetId: 1,
    dashboardId: 1,
    rowsWritten: 0,
    totalRows: 100,
    fileBytes: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-10-07 10:00:00",
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    gzip: false,
    name: "Q1",
    dashboardName: null,
    widgetTitle: null,
    ...over,
  };
}

let showToast: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  getJob.mockReset();
  vi.mocked(startExportDownload).mockReset();
  showToast = vi.fn();
  useToastStore.setState({ showToast } as never);
});

afterEach(() => {
  stopAllExportTracking();
  vi.useRealTimers();
});

describe("exportTracker", () => {
  it("EXPTRK-interval: polls at 5000 ms and again at 10000 ms", async () => {
    getJob.mockResolvedValue(dto());
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS - 1);
    expect(getJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it("EXPTRK-no-overlap: a hung poll is not followed by another", async () => {
    getJob.mockReturnValue(new Promise(() => {}));
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(20000);
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it("EXPTRK-ready-toast: closed dialog + complete fires a Download toast", async () => {
    getJob.mockResolvedValue(dto({ status: "complete" }));
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(showToast).toHaveBeenCalledWith('Export "Q1" is ready', "info", {
      label: "Download",
      onClick: expect.any(Function),
    });
    showToast.mock.calls[0][2].onClick();
    expect(startExportDownload).toHaveBeenCalledWith("j1");
    expect(useExportTrackerStore.getState().jobs.j1).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20000);
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it("EXPTRK-fail-toast: failed and session_expired show the server message as an error", async () => {
    const msg = "This export has 12,345 rows; the limit is 1,000. Add filters to narrow it down and try again.";
    getJob.mockResolvedValue(dto({ status: "failed", errorMessage: msg }));
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(showToast).toHaveBeenCalledWith(msg, "error");

    showToast.mockClear();
    getJob.mockResolvedValue(dto({ id: "j2", status: "session_expired", errorMessage: "Session ended." }));
    trackExport(dto({ id: "j2" }));
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(showToast).toHaveBeenCalledWith("Session ended.", "error");
  });

  it("EXPTRK-cancelled-silent: cancelled shows no toast and drops the entry", async () => {
    getJob.mockResolvedValue(dto({ status: "cancelled" }));
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(showToast).not.toHaveBeenCalled();
    expect(useExportTrackerStore.getState().jobs.j1).toBeUndefined();
  });

  it("EXPTRK-dialog-open: an open dialog gets the result, no toast; closing drops it", async () => {
    getJob.mockResolvedValue(dto({ status: "complete" }));
    trackExport(dto());
    setDialogJob("j1");
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(showToast).not.toHaveBeenCalled();
    expect(useExportTrackerStore.getState().jobs.j1.status).toBe("complete");
    await vi.advanceTimersByTimeAsync(20000);
    expect(getJob).toHaveBeenCalledTimes(1);
    setDialogJob(null);
    expect(useExportTrackerStore.getState().jobs.j1).toBeUndefined();
  });

  it("EXPTRK-dialog-closed-running: closing the dialog keeps a running job polling", async () => {
    getJob.mockResolvedValue(dto());
    trackExport(dto());
    setDialogJob("j1");
    setDialogJob(null);
    expect(useExportTrackerStore.getState().jobs.j1).toBeDefined();
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS * 2);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it("EXPTRK-404: a vanished job is untracked silently", async () => {
    getJob.mockResolvedValue(null);
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(useExportTrackerStore.getState().jobs.j1).toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EXPTRK-network: a network failure keeps tracking and retries", async () => {
    getJob.mockRejectedValueOnce(new TypeError("fail")).mockResolvedValue(dto());
    trackExport(dto());
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(useExportTrackerStore.getState().jobs.j1).toBeDefined();
    expect(showToast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it("EXPTRK-reauth: a 401 stops all tracking", async () => {
    getJob.mockRejectedValue(new ReauthRequiredError("expired"));
    trackExport(dto());
    trackExport(dto({ id: "j2" }));
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    expect(useExportTrackerStore.getState().jobs).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EXPTRK-stop-all: clears timers and ignores an in-flight poll", async () => {
    let resolve!: (d: ExportJobDto) => void;
    getJob
      .mockReturnValueOnce(new Promise<ExportJobDto>((r) => (resolve = r)))
      .mockReturnValue(new Promise(() => {}));
    trackExport(dto());
    trackExport(dto({ id: "j2" }));
    await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    stopAllExportTracking();
    expect(vi.getTimerCount()).toBe(0);
    expect(useExportTrackerStore.getState()).toMatchObject({ jobs: {}, dialogJobId: null });
    // The same id is tracked again (re-login) before the stale poll lands: only the generation check rejects it.
    trackExport(dto());
    resolve(dto({ status: "complete" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(useExportTrackerStore.getState().jobs.j1.status).toBe("running");
    expect(showToast).not.toHaveBeenCalled();
  });
});
