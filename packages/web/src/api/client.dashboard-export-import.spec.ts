/**
 * Phase 121 Plan 01 (DXIM-V124-01/-03): unit tests for the dashboard export-download and
 * import-upload client helpers.
 *
 * Coverage:
 *   EXPDL- : exportFileNameForClient (slug rule) + downloadDashboardExport (blob/anchor mechanism)
 *   IMPCLI-: importDashboardFile (client-side JSON pre-check + JSON-body POST)
 *
 * EXPDL-nocd is the load-bearing CORS test — it proves the filename is derived client-side and
 * never depends on reading the attachment response header, which is invisible cross-origin (see
 * packages/server/src/index.ts:140-145 — no exposedHeaders configured).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportFileNameForClient, downloadDashboardExport, importDashboardFile } from "./client";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFetchStub(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)], { type: "application/json" })),
    headers: { get: () => null },
  });
}

// ─── EXPDL- : exportFileNameForClient ──────────────────────────────────────

describe("exportFileNameForClient", () => {
  it("EXPDL-slug: slugifies a normal name", () => {
    expect(exportFileNameForClient({ id: 4, name: "Test Dashboard" })).toBe(
      "dashboard-4-test-dashboard.json",
    );
  });

  it("EXPDL-slug-empty: empty name falls back to 'export'", () => {
    expect(exportFileNameForClient({ id: 9, name: "" })).toBe("dashboard-9-export.json");
  });

  it("EXPDL-slug-punct: punctuation collapses and leading/trailing dashes are stripped", () => {
    expect(exportFileNameForClient({ id: 1, name: "  Q3 // Sales (EU)!  " })).toBe(
      "dashboard-1-q3-sales-eu.json",
    );
  });
});

// ─── EXPDL- : downloadDashboardExport ──────────────────────────────────────

describe("downloadDashboardExport", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let captured: { href: string; download: string } | undefined;

  beforeEach(() => {
    captured = undefined;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        captured = { href: this.href, download: this.download };
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("EXPDL-url: fetches the export URL once with credentials included", async () => {
    fetchSpy = makeFetchStub({});
    vi.stubGlobal("fetch", fetchSpy);

    await downloadDashboardExport({ id: 4, name: "Test Dashboard" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain("/api/dashboards/4/export");
    expect(opts?.credentials).toBe("include");
  });

  it("EXPDL-anchor: on a 2xx response, clicks an anchor with the derived filename and a blob URL", async () => {
    fetchSpy = makeFetchStub({});
    vi.stubGlobal("fetch", fetchSpy);

    await downloadDashboardExport({ id: 4, name: "Test Dashboard" });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(captured?.download).toBe("dashboard-4-test-dashboard.json");
    expect(captured?.href).toBe("blob:x");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("EXPDL-nocd: filename is correct even when headers.get returns null for every name (dev cross-origin)", async () => {
    fetchSpy = makeFetchStub({});
    vi.stubGlobal("fetch", fetchSpy);

    await downloadDashboardExport({ id: 4, name: "Test Dashboard" });

    expect(captured?.download).toBe("dashboard-4-test-dashboard.json");
  });

  it("EXPDL-404: rejects with the server's error message and never creates an object URL", async () => {
    fetchSpy = makeFetchStub({ error: "Dashboard not found." }, { ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(downloadDashboardExport({ id: 4, name: "Test Dashboard" })).rejects.toThrow(
      "Dashboard not found.",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("EXPDL-403: rejects with a PermissionError", async () => {
    fetchSpy = makeFetchStub({}, { ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(downloadDashboardExport({ id: 4, name: "Test Dashboard" })).rejects.toMatchObject({
      name: "PermissionError",
    });
  });
});

// ─── IMPCLI- : importDashboardFile ─────────────────────────────────────────

function makeFakeFile(text: string, name = "dashboard-4-test-dashboard.json"): File {
  return { name, text: () => Promise.resolve(text) } as unknown as File;
}

describe("importDashboardFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("IMPCLI-post: POSTs the file's exact text as JSON with Content-Type application/json", async () => {
    const fileText = '{"schemaVersion":1}';
    const fetchSpy = makeFetchStub({ data: { dashboardId: 7 } }, { ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchSpy);

    await importDashboardFile(makeFakeFile(fileText));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain("/api/dashboards/import");
    expect(opts?.method).toBe("POST");
    expect((opts?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
    expect(opts?.body).toBe(fileText);
  });

  it("IMPCLI-report: resolves to the inner data object, with metricConflicts and warnings intact", async () => {
    const report = {
      dashboardId: 7,
      dashboardName: "Copy",
      widgetsCreated: 3,
      layersCreated: 1,
      dynamicViewsCreated: 0,
      tablesMatched: [],
      tablesCreated: [],
      metricsMatched: [],
      metricsCreated: [],
      metricConflicts: [{ oldId: 1, newId: 2, tableId: 3, tableRef: "s.t", label: "Revenue", existingExpression: "SUM(a)", importedExpression: "SUM(a)*1.1", message: "conflict message" }],
      strippedReferences: [],
      warnings: ["layerFilterWidened"],
      preflightDangling: [],
    };
    const fetchSpy = makeFetchStub({ data: report }, { ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await importDashboardFile(makeFakeFile('{"schemaVersion":1}'));

    expect(result.dashboardId).toBe(7);
    expect(result.metricConflicts).toEqual(report.metricConflicts);
    expect(result.warnings).toEqual(report.warnings);
  });

  it("IMPCLI-nonjson: rejects before any network call when file text is not valid JSON", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(importDashboardFile(makeFakeFile("not json at all"))).rejects.toThrow(
      "not valid JSON",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("IMPCLI-400: rejects with the server's malformed-import message verbatim", async () => {
    const fetchSpy = makeFetchStub(
      { error: "Import file is malformed: widgets must be an array (got undefined).", code: "IMPORT_MALFORMED" },
      { ok: false, status: 400 },
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(importDashboardFile(makeFakeFile('{"a":1}'))).rejects.toThrow(
      "Import file is malformed: widgets must be an array (got undefined).",
    );
  });

  it("IMPCLI-413: rejects with the server's payload-too-large message", async () => {
    const fetchSpy = makeFetchStub(
      { error: "Request body too large.", code: "PAYLOAD_TOO_LARGE" },
      { ok: false, status: 413 },
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(importDashboardFile(makeFakeFile('{"a":1}'))).rejects.toThrow(
      "Request body too large.",
    );
  });

  it("IMPCLI-403: rejects with a PermissionError", async () => {
    const fetchSpy = makeFetchStub({}, { ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(importDashboardFile(makeFakeFile('{"a":1}'))).rejects.toMatchObject({
      name: "PermissionError",
    });
  });

  it("IMPCLI-422: rejects with the rollback sentence verbatim", async () => {
    const fetchSpy = makeFetchStub(
      {
        error:
          "Import failed partway through and was rolled back. No dashboard, widgets, layers or table entries were created.",
        code: "IMPORT_FAILED",
      },
      { ok: false, status: 422 },
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(importDashboardFile(makeFakeFile('{"a":1}'))).rejects.toThrow(
      "Import failed partway through and was rolled back. No dashboard, widgets, layers or table entries were created.",
    );
  });
});
