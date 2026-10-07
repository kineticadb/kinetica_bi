import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ExportJobDto } from "../api/client";

const listExportJobs = vi.fn();
vi.mock("../api/client", async () => {
  class PermissionError extends Error {}
  return { listExportJobs: (...a: unknown[]) => listExportJobs(...a), PermissionError };
});

import { PermissionError } from "../api/client";
import { EXPORTS_LIST_POLL_MS, useExportsList } from "./useExportsList";

const job = (o: Partial<ExportJobDto>): ExportJobDto => ({
  id: "a", status: "complete", widgetId: 1, dashboardId: 1, rowsWritten: 1, totalRows: 1, fileBytes: 1,
  errorCode: null, errorMessage: null, createdAt: "2026-01-01 00:00:00", startedAt: null, finishedAt: null,
  expiresAt: null, gzip: false, name: null, dashboardName: null, widgetTitle: null, ...o,
});
const running = job({ id: "r", status: "running" });
const done = job({ id: "d", status: "complete" });

const tick = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
const mount = async () => {
  const h = renderHook(() => useExportsList());
  await tick(0);
  return h;
};

beforeEach(() => { vi.useFakeTimers(); listExportJobs.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("useExportsList", () => {
  it("EXPLIST-first-load: loading until resolved", async () => {
    let resolve!: (v: ExportJobDto[]) => void;
    listExportJobs.mockReturnValue(new Promise((r) => { resolve = r; }));
    const h = renderHook(() => useExportsList());
    expect(h.result.current.loading).toBe(true);
    await act(async () => { resolve([done]); });
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.jobs).toEqual([done]);
  });

  it("EXPLIST-sort: newest first", async () => {
    const older = job({ id: "o", createdAt: "2026-01-01 00:00:00" });
    const newer = job({ id: "n", createdAt: "2026-02-01 00:00:00" });
    listExportJobs.mockResolvedValue([older, newer]);
    const h = await mount();
    expect(h.result.current.jobs.map((j) => j.id)).toEqual(["n", "o"]);
  });

  it("EXPLIST-poll-active: polls at 5000 ms with no loading flash", async () => {
    listExportJobs.mockResolvedValue([running]);
    const seen: boolean[] = [];
    const h = renderHook(() => {
      const r = useExportsList();
      seen.push(r.loading);
      return r;
    });
    await tick(0);
    expect(listExportJobs).toHaveBeenCalledTimes(1);
    await tick(EXPORTS_LIST_POLL_MS - 1);
    expect(listExportJobs).toHaveBeenCalledTimes(1);
    const mark = seen.length;
    let resolvePoll!: (v: ExportJobDto[]) => void;
    listExportJobs.mockReturnValueOnce(new Promise((r) => { resolvePoll = r; }));
    await tick(1);
    expect(listExportJobs).toHaveBeenCalledTimes(2);
    // poll is in flight: loading must still be false (no flash)
    expect(h.result.current.loading).toBe(false);
    await act(async () => { resolvePoll([running]); });
    expect(seen.slice(mark)).not.toContain(true);
    expect(h.result.current.loading).toBe(false);
  });

  it("EXPLIST-poll-idle: no polling when all terminal", async () => {
    listExportJobs.mockResolvedValue([done]);
    await mount();
    await tick(5000);
    await tick(10000);
    expect(listExportJobs).toHaveBeenCalledTimes(1);
  });

  it("EXPLIST-poll-stops: stops once a poll returns only terminal rows", async () => {
    listExportJobs.mockResolvedValueOnce([running]).mockResolvedValue([{ ...running, status: "complete" }]);
    await mount();
    await tick(5000);
    expect(listExportJobs).toHaveBeenCalledTimes(2);
    await tick(20000);
    expect(listExportJobs).toHaveBeenCalledTimes(2);
  });

  it("EXPLIST-no-overlap: a pending poll yields exactly one call", async () => {
    listExportJobs.mockResolvedValueOnce([running]).mockReturnValue(new Promise(() => {}));
    await mount();
    await tick(20000);
    expect(listExportJobs).toHaveBeenCalledTimes(2);
  });

  it("EXPLIST-unmount: no timers left", async () => {
    listExportJobs.mockResolvedValue([running]);
    const h = await mount();
    expect(vi.getTimerCount()).toBe(1);
    h.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EXPLIST-errors: permission, other, reload clears", async () => {
    listExportJobs.mockRejectedValueOnce(new PermissionError("nope"));
    const h = await mount();
    expect(h.result.current.error).toEqual({ kind: "permission", message: "nope" });
    listExportJobs.mockRejectedValueOnce(new Error("boom"));
    await act(async () => { h.result.current.reload(); });
    expect(h.result.current.error).toEqual({ kind: "other", message: "boom" });
    listExportJobs.mockResolvedValueOnce([done]);
    await act(async () => { h.result.current.reload(); });
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.jobs).toEqual([done]);
  });

  it("EXPLIST-poll-error: poll rejection keeps jobs, no error, polls again", async () => {
    listExportJobs.mockResolvedValueOnce([running]).mockRejectedValueOnce(new Error("blip")).mockResolvedValue([running]);
    const h = await mount();
    await tick(5000);
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.jobs).toEqual([running]);
    await tick(5000);
    expect(listExportJobs).toHaveBeenCalledTimes(3);
  });

  it("EXPLIST-mutators: replaceJob swaps, restarts polling; removeJob drops", async () => {
    listExportJobs.mockResolvedValue([done]);
    const h = await mount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => h.result.current.replaceJob({ ...done, status: "running" }));
    expect(h.result.current.jobs[0].status).toBe("running");
    expect(vi.getTimerCount()).toBe(1);
    act(() => h.result.current.removeJob("d"));
    expect(h.result.current.jobs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
