import { describe, it, expect, vi, afterEach } from "vitest";
import {
  API_BASE, startExport, getExportJob, listExportJobs, cancelExportJob, deleteExportJob,
  exportDownloadUrl, preflightExportDownload, type ExportJobDto, type StartExportBody,
} from "./client";

const dto = { id: "abc", status: "queued" } as ExportJobDto;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const stub = (r: Response) => vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(r);

afterEach(() => vi.restoreAllMocks());

describe("export client helpers", () => {
  it("EXPCLI-start: posts JSON and returns data", async () => {
    const spy = stub(json({ data: dto }, 202));
    const body = { widgetId: 1, filters: [], options: { compress: false, format: "raw", name: "n" } } as StartExportBody;
    expect(await startExport(body)).toEqual(dto);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/exports`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });
  it("EXPCLI-start-429: server error verbatim", async () => {
    const msg = "You already have 2 exports running. Wait for one to finish or cancel one, then try again.";
    stub(json({ error: msg, code: "concurrency_cap" }, 429));
    await expect(startExport({ widgetId: 1, filters: [], options: { compress: false, format: "raw", name: "n" } })).rejects.toThrow(msg);
  });
  it("EXPCLI-get: dto or null on 404", async () => {
    stub(json({ data: dto }));
    expect(await getExportJob("abc")).toEqual(dto);
    stub(json({ error: "Export not found." }, 404));
    expect(await getExportJob("abc")).toBeNull();
  });
  it("EXPCLI-list: returns data array", async () => {
    stub(json({ data: [dto] }));
    expect(await listExportJobs()).toEqual([dto]);
  });
  it("EXPCLI-cancel: dto, null on 409, rejects on 404", async () => {
    stub(json({ data: dto }, 202));
    expect(await cancelExportJob("abc")).toEqual(dto);
    stub(json({ error: "Export is not running.", status: "complete" }, 409));
    expect(await cancelExportJob("abc")).toBeNull();
    stub(json({ error: "Export not found." }, 404));
    await expect(cancelExportJob("abc")).rejects.toThrow("Export not found.");
  });
  it("EXPCLI-delete: 204 and 404 resolve, 500 rejects", async () => {
    stub(new Response(null, { status: 204 }));
    await expect(deleteExportJob("abc")).resolves.toBeUndefined();
    stub(json({ error: "Export not found." }, 404));
    await expect(deleteExportJob("abc")).resolves.toBeUndefined();
    stub(json({ error: "boom" }, 500));
    await expect(deleteExportJob("abc")).rejects.toThrow("boom");
  });
  it("EXPCLI-url: API_BASE-prefixed and encoded", () => {
    expect(exportDownloadUrl("abc")).toBe(`${API_BASE}/api/exports/abc/download`);
    expect(exportDownloadUrl("a/b")).toBe(`${API_BASE}/api/exports/a%2Fb/download`);
  });
  it("EXPCLI-preflight: Range header, ok on 200/206, server text on errors", async () => {
    const spy = stub(new Response("a", { status: 206 }));
    expect(await preflightExportDownload("abc")).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(exportDownloadUrl("abc"));
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
    stub(new Response("a", { status: 200 }));
    expect(await preflightExportDownload("abc")).toEqual({ ok: true });
    stub(json({ error: "This export is no longer available." }, 410));
    expect(await preflightExportDownload("abc")).toEqual({ ok: false, status: 410, message: "This export is no longer available." });
    stub(json({ error: "Export is not ready to download.", status: "running" }, 409));
    expect(await preflightExportDownload("abc")).toMatchObject({ ok: false, status: 409, message: "Export is not ready to download." });
  });
});
