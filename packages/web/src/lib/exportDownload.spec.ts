import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/client", () => ({
  preflightExportDownload: vi.fn(),
  exportDownloadUrl: (id: string) => `http://api/api/exports/${id}/download`,
}));

import { preflightExportDownload } from "../api/client";
import { startExportDownload, __assignLocation } from "./exportDownload";
import { useToastStore } from "../store/toast";

const preflight = vi.mocked(preflightExportDownload);
const origAssign = __assignLocation.fn;
let assign: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn<(message: string, kind?: string) => void>>;

beforeEach(() => {
  assign = vi.fn();
  showToast = vi.fn<(message: string, kind?: string) => void>();
  __assignLocation.fn = assign as unknown as (url: string) => void;
  useToastStore.setState({ showToast: showToast as never });
  preflight.mockReset();
});
afterEach(() => {
  __assignLocation.fn = origAssign;
  vi.useRealTimers();
});

describe("startExportDownload", () => {
  it("EXPDL-ok: navigates after a good preflight", async () => {
    preflight.mockResolvedValue({ ok: true });
    expect(await startExportDownload("x1")).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("http://api/api/exports/x1/download");
    expect(showToast).not.toHaveBeenCalled();
  });
  it("EXPDL-gone: 410 toasts and does not navigate", async () => {
    preflight.mockResolvedValue({ ok: false, status: 410, message: "This export is no longer available." });
    expect(await startExportDownload("x1")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("This export is no longer available.", "error");
  });
  it("EXPDL-network: preflight rejection toasts the network message", async () => {
    preflight.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await startExportDownload("x1")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Could not reach the server. Check your connection and try again.", "error");
  });
  it("EXPDL-reauth: 401 neither navigates nor toasts", async () => {
    preflight.mockResolvedValue({ ok: false, status: 401, message: "x" });
    expect(await startExportDownload("x1")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
