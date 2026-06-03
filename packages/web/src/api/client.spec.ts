import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  materializeFilter,
  dropFilterView,
  infoQuery,
  listDynamicViews,
  createDynamicView,
  updateDynamicView,
  deleteDynamicView,
  previewDynamicView,
  materializeDynamicView,
  dropDynamicView,
  runSql,
  PermissionError,
  ReauthRequiredError,
  UpstreamError,
} from "./client";
import type { ActiveFilter } from "../store/filterStore";
import type {
  InfoQueryRequest,
  DynamicViewRow,
  MaterializeDynamicViewResponse,
  PreviewDynamicViewResponse,
} from "./client";

const sampleFilter: ActiveFilter = {
  column: "borough",
  value: "Manhattan",
  dataType: "string",
  addedAt: 1_700_000_000_000,
};

describe("materializeFilter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("POSTs JSON body with credentials and threads signal; resolves on 200 with { viewName, expiresAt }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ viewName: "_kbi_filt_u1_d2_t3_sabcdefab", expiresAt: 1_700_000_300_000 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const controller = new AbortController();
    const result = await materializeFilter(
      { dashboardId: 2, tableId: 3, filters: [sampleFilter] },
      controller.signal
    );
    expect(result).toEqual({
      viewName: "_kbi_filt_u1_d2_t3_sabcdefab",
      expiresAt: 1_700_000_300_000,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/filter\/materialize$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      dashboardId: 2,
      tableId: 3,
      filters: [sampleFilter],
    });
  });

  it("works without a signal (signal is undefined when caller omits it)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ viewName: "_kbi_filt_u1_d2_t3_sabcdefab", expiresAt: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    await materializeFilter({ dashboardId: 1, tableId: 1, filters: [sampleFilter] });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeUndefined();
  });

  it("throws PermissionError with server-provided message on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "DDL permission denied for user alice" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      materializeFilter({ dashboardId: 1, tableId: 1, filters: [sampleFilter] })
    ).rejects.toBeInstanceOf(PermissionError);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "DDL permission denied for user alice" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      materializeFilter({ dashboardId: 1, tableId: 1, filters: [sampleFilter] })
    ).rejects.toMatchObject({ message: "DDL permission denied for user alice" });
  });

  it("throws UpstreamError on 502", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Kinetica unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      materializeFilter({ dashboardId: 1, tableId: 1, filters: [sampleFilter] })
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("propagates AbortError when signal is aborted before/during fetch", async () => {
    fetchSpy.mockImplementationOnce(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      materializeFilter({ dashboardId: 1, tableId: 1, filters: [sampleFilter] }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  // Phase 30 (MAT-V15-02): wire-payload byte-parity tests for extended MaterializeFilterArgs
  it("sends spatialFilters and spatialTarget in the request body when both are provided (combined payload)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ viewName: "_kbi_filt_x", expiresAt: 1 }), { status: 200 })
    );
    await materializeFilter({
      dashboardId: 7,
      tableId: 99,
      filters: [sampleFilter],
      spatialFilters: [{ id: "shape-1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
      spatialTarget: { tableId: 99, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      dashboardId: 7,
      tableId: 99,
      filters: [sampleFilter],
      spatialFilters: [{ id: "shape-1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
      spatialTarget: { tableId: 99, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
    });
    fetchSpy.mockRestore();
  });

  it("omits spatialFilters and spatialTarget from request body when undefined (v1.3 backward compat)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ viewName: "_kbi_filt_y", expiresAt: 1 }), { status: 200 })
    );
    await materializeFilter({ dashboardId: 1, tableId: 2, filters: [sampleFilter] });
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ dashboardId: 1, tableId: 2, filters: [sampleFilter] });
    expect("spatialFilters" in body).toBe(false);
    expect("spatialTarget" in body).toBe(false);
    fetchSpy.mockRestore();
  });

  it("sends spatial-only payload (filters: []) when caller has shapes but no column filters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ viewName: "_kbi_filt_z", expiresAt: 1 }), { status: 200 })
    );
    await materializeFilter({
      dashboardId: 3,
      tableId: 4,
      filters: [],
      spatialFilters: [{ id: "s1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
      spatialTarget: { tableId: 4, spatialMode: "wkt", spatialCol: "geom" },
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.filters).toEqual([]);
    expect(body.spatialFilters).toHaveLength(1);
    expect(body.spatialTarget.spatialMode).toBe("wkt");
    fetchSpy.mockRestore();
  });

  it("post-VERIFY: concurrent calls for same (dashboardId, tableId) dedupe to a single fetch", async () => {
    // Phase 30's RecordsTableRenderer materialize trigger duplicates AggregatedWidgetRenderer
    // Effect 1 when a dashboard has BOTH a chart AND a records-table on the same table.
    // Live UAT observed ~100ms-apart twin POSTs on every spatial-filter mutation. The
    // in-flight cache in materializeFilter collapses these to one HTTP request; both
    // callers await the same resolved promise.
    let resolveFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    // Two concurrent callers (e.g. AggregatedWidget + RecordsTable) — same args.
    const args = { dashboardId: 5, tableId: 7, filters: [sampleFilter] };
    const callA = materializeFilter(args);
    const callB = materializeFilter(args);

    // Both calls join the same in-flight promise — only ONE fetch fires.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify({ viewName: "_kbi_filt_dedup", expiresAt: 1 }), {
        status: 200,
      }),
    );

    const [resA, resB] = await Promise.all([callA, callB]);
    expect(resA).toEqual(resB);
    expect(resA.viewName).toBe("_kbi_filt_dedup");
    // Still only ONE fetch even after both awaited.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // After settle, the cache entry is cleared — a NEW call re-fires.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ viewName: "_kbi_filt_dedup2", expiresAt: 2 }), {
        status: 200,
      }),
    );
    await materializeFilter(args);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it("post-VERIFY: concurrent calls for DIFFERENT (tableId) do NOT dedupe (separate cache keys)", async () => {
    // mockImplementation gives a fresh Response per call (Response body can only be read once).
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ viewName: "_kbi_filt_x", expiresAt: 1 }), {
          status: 200,
        }),
      ),
    );
    await Promise.all([
      materializeFilter({ dashboardId: 5, tableId: 7, filters: [sampleFilter] }),
      materializeFilter({ dashboardId: 5, tableId: 8, filters: [sampleFilter] }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it("post-VERIFY: rejection clears cache so retries re-fire", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ viewName: "_kbi_filt_y", expiresAt: 1 }), {
          status: 200,
        }),
      );
    const args = { dashboardId: 9, tableId: 10, filters: [sampleFilter] };
    await expect(materializeFilter(args)).rejects.toThrow("network down");
    // Retry: cache cleared after rejection, second call fires anew.
    const result = await materializeFilter(args);
    expect(result.viewName).toBe("_kbi_filt_y");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });
});

describe("dropFilterView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("DELETEs with dashboardId+tableId in query string; no body; resolves with { dropped: true }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await dropFilterView({ dashboardId: 2, tableId: 3 });
    expect(result).toEqual({ dropped: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/filter\/materialize\?dashboardId=2&tableId=3$/);
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("threads signal into the DELETE fetch", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const controller = new AbortController();
    await dropFilterView({ dashboardId: 1, tableId: 1 }, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws PermissionError on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "DDL permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      dropFilterView({ dashboardId: 1, tableId: 1 })
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("post-VERIFY: concurrent drops for same (dashboardId, tableId) dedupe to a single fetch", async () => {
    // AggregatedWidgetRenderer Effect 1 AND RecordsTableRenderer spatial-trigger
    // effect both fire dropFilterView when filters clear for the same table.
    // Live UAT observed twin DELETEs ~6ms apart. In-flight cache collapses them.
    let resolveFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    fetchSpy.mockReturnValueOnce(fetchPromise);

    const args = { dashboardId: 5, tableId: 2 };
    const callA = dropFilterView(args);
    const callB = dropFilterView(args);

    // Both calls join the same in-flight promise — only ONE fetch fires.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [resA, resB] = await Promise.all([callA, callB]);
    expect(resA).toEqual({ dropped: true });
    expect(resB).toEqual({ dropped: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // After settle, cache cleared — next drop fires fresh.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await dropFilterView(args);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("post-VERIFY: concurrent drops for DIFFERENT (tableId) do NOT dedupe", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ dropped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await Promise.all([
      dropFilterView({ dashboardId: 5, tableId: 2 }),
      dropFilterView({ dashboardId: 5, tableId: 3 }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// POPUP-V14-02..05 — infoQuery client helper spec.
// Mirrors materializeFilter spec structure (vi.spyOn globalThis.fetch, beforeEach/afterEach restore).
describe("infoQuery", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const sampleRequest: InfoQueryRequest = {
    layerId: 1,
    tableId: 101,
    schema: "ki_home",
    table: "nyctaxi",
    spatialMode: "latlon",
    spatialColumns: { lonCol: "pickup_longitude", latCol: "pickup_latitude" },
    clickLon: -73.985,
    clickLat: 40.758,
    radiusPx: 5,
    mapBbox: [-8_236_000, 4_960_000, -8_200_000, 5_000_000],
    mapWidthPx: 800,
    mapHeightPx: 600,
    page: 0,
  };

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // I1: 200 OK — returns parsed body verbatim
  it("resolves with parsed response body on 200", async () => {
    const mockBody = { rows: [{ a: 1 }], columns: ["a"], hasMore: false, page: 0 };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await infoQuery(sampleRequest);
    expect(result).toEqual(mockBody);
  });

  // I2: 401 → throws ReauthRequiredError
  it("throws ReauthRequiredError on 401", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(infoQuery(sampleRequest)).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  // I3: 403 → throws PermissionError
  it("throws PermissionError on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(infoQuery(sampleRequest)).rejects.toBeInstanceOf(PermissionError);
  });

  // I4: 502 → throws UpstreamError
  it("throws UpstreamError on 502", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Kinetica unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(infoQuery(sampleRequest)).rejects.toBeInstanceOf(UpstreamError);
  });

  // I5: AbortSignal aborted before fetch resolves → throws AbortError
  it("propagates AbortError when signal is aborted before fetch resolves", async () => {
    fetchSpy.mockImplementationOnce(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const controller = new AbortController();
    controller.abort();
    await expect(infoQuery(sampleRequest, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  // I6: POST body matches InfoQueryRequest shape
  it("POSTs to /api/info/query with JSON body matching InfoQueryRequest and threads signal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], columns: [], hasMore: false, page: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const controller = new AbortController();
    await infoQuery(sampleRequest, controller.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/info\/query$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(sampleRequest);
  });
});

// ===========================================================================
// Phase 33 Plan 03 (DV-V16-07): Dynamic Views client helpers spec.
//
// Each helper covers: happy path (URL + method + body + credentials + return shape),
// error path (4xx/5xx → throwForStatus), AbortSignal threading.
// ===========================================================================

const sampleRow: DynamicViewRow = {
  id: 1,
  dashboard_id: 5,
  source_table_id: 2,
  name: "demo",
  template_sql: "SELECT * FROM {view}",
  max_records: 1000,
  columns_json: null,
  created_at: "2026-05-14T00:00:00Z",
  updated_at: "2026-05-14T00:00:00Z",
};

describe("listDynamicViews", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("GETs /api/dashboards/:dashboardId/dynamic-views and returns server { dynamic_views } shape", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_views: [sampleRow] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await listDynamicViews(5);
    expect(result.dynamic_views).toHaveLength(1);
    expect(result.dynamic_views[0].id).toBe(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dashboards\/5\/dynamic-views$/);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
  });

  it("threads AbortSignal into the GET fetch", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_views: [] }), { status: 200 })
    );
    const controller = new AbortController();
    await listDynamicViews(5, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws UpstreamError on 502", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Kinetica unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(listDynamicViews(5)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("createDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("POSTs body to /api/dashboards/:dashboardId/dynamic-views; returns { dynamic_view }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_view: sampleRow }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = {
      source_table_id: 2,
      name: "demo",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    };
    const result = await createDynamicView(5, body);
    expect(result.dynamic_view.id).toBe(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dashboards\/5\/dynamic-views$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("threads AbortSignal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_view: sampleRow }), { status: 201 })
    );
    const controller = new AbortController();
    await createDynamicView(
      5,
      { source_table_id: 2, name: "x", template_sql: "SELECT * FROM {view}", max_records: 100 },
      controller.signal,
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("propagates server 400 with verbatim server error message (DV-V16-09)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Dynamic view template must contain a {view} token." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    let actualMessage = "<no-error>";
    try {
      await createDynamicView(
        5,
        { source_table_id: 2, name: "x", template_sql: "SELECT 1", max_records: 100 },
      );
    } catch (e) {
      actualMessage = (e as Error).message;
    }
    // Byte-exact — NOT toMatchObject regex (vitest false-positive surface).
    expect(actualMessage).toBe("Dynamic view template must contain a {view} token.");
  });
});

describe("updateDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("PUTs partial body to /api/dynamic-views/:id; returns { dynamic_view }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_view: sampleRow }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await updateDynamicView(1, { name: "renamed" });
    expect(result.dynamic_view.id).toBe(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dynamic-views\/1$/);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ name: "renamed" });
  });

  it("threads AbortSignal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dynamic_view: sampleRow }), { status: 200 })
    );
    const controller = new AbortController();
    await updateDynamicView(1, { name: "x" }, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws on non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(updateDynamicView(1, { name: "x" })).rejects.toThrow(/Not found|Failed/i);
  });
});

describe("deleteDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("DELETEs /api/dynamic-view/:id; returns { deleted: true } (dropped may also be present)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: true, dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await deleteDynamicView(1);
    expect(result.deleted).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dynamic-view\/1$/);
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("threads AbortSignal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: true }), { status: 200 })
    );
    const controller = new AbortController();
    await deleteDynamicView(1, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws PermissionError on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "DDL permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(deleteDynamicView(1)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("previewDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("POSTs body to /api/dynamic-view/preview; returns { rows, columns }", async () => {
    const mockResp: PreviewDynamicViewResponse = {
      rows: [[1, "a"], [2, "b"]],
      columns: [{ name: "id", type: "int" }, { name: "label", type: "string" }],
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = {
      template_sql: "SELECT * FROM {view}",
      source_table_id: 2,
      dashboard_id: 5,
      sample_limit: 10,
    };
    const result = await previewDynamicView(body);
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toHaveLength(2);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dynamic-view\/preview$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("threads AbortSignal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], columns: [] }), { status: 200 })
    );
    const controller = new AbortController();
    await previewDynamicView(
      { template_sql: "SELECT * FROM {view}", source_table_id: 2, dashboard_id: 5 },
      controller.signal,
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws UpstreamError on 502", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Kinetica unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      previewDynamicView({ template_sql: "SELECT * FROM {view}", source_table_id: 2, dashboard_id: 5 })
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("propagates server 400 with verbatim server error message (DV-V16-10)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Dynamic view template must contain a {view} token." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    let actualMessage = "<no-error>";
    try {
      await previewDynamicView({
        template_sql: "SELECT 1",
        source_table_id: 2,
        dashboard_id: 5,
      });
    } catch (e) {
      actualMessage = (e as Error).message;
    }
    expect(actualMessage).toBe("Dynamic view template must contain a {view} token.");
  });
});

describe("materializeDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("POSTs { dynamic_view_id } to /api/dynamic-view/materialize; resolves with materialized branch", async () => {
    const mat: MaterializeDynamicViewResponse = {
      status: "materialized",
      view_name: "_kbi_dv_u1_d5_1",
      row_count: 42,
      expires_at: 1_700_000_300_000,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mat), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await materializeDynamicView(1);
    expect(result.status).toBe("materialized");
    if (result.status === "materialized") {
      expect(result.view_name).toBe("_kbi_dv_u1_d5_1");
      expect(result.row_count).toBe(42);
      expect(result.expires_at).toBe(1_700_000_300_000);
    }
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dynamic-view\/materialize$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ dynamic_view_id: 1 });
  });

  it("resolves with over_threshold/no_filter branch", async () => {
    const resp: MaterializeDynamicViewResponse = { status: "over_threshold", reason: "no_filter" };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(resp), { status: 200 })
    );
    const result = await materializeDynamicView(1);
    expect(result.status).toBe("over_threshold");
    if (result.status === "over_threshold") {
      expect(result.reason).toBe("no_filter");
    }
  });

  it("resolves with over_threshold/exceeds_max_records branch (includes row_count)", async () => {
    const resp: MaterializeDynamicViewResponse = {
      status: "over_threshold",
      reason: "exceeds_max_records",
      row_count: 5_000_000,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(resp), { status: 200 })
    );
    const result = await materializeDynamicView(1);
    expect(result.status).toBe("over_threshold");
    if (result.status === "over_threshold" && result.reason === "exceeds_max_records") {
      expect(result.row_count).toBe(5_000_000);
    }
  });

  it("threads AbortSignal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "over_threshold", reason: "no_filter" }), { status: 200 })
    );
    const controller = new AbortController();
    await materializeDynamicView(1, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws UpstreamError on 502", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Kinetica unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(materializeDynamicView(1)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("dropDynamicView", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("POSTs to /api/dynamic-view/:id/drop with no body; resolves with { dropped: true }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await dropDynamicView(7);
    expect(result).toEqual({ dropped: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/dynamic-view\/7\/drop$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("threads AbortSignal even though callsite is fire-and-forget (signature consistency)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), { status: 200 })
    );
    const controller = new AbortController();
    await dropDynamicView(7, controller.signal);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws on 404 (missing dynamic view row)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Dynamic view not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(dropDynamicView(999)).rejects.toThrow(/Dynamic view not found|Failed/i);
  });
});

describe("throwForStatus generic 4xx/5xx error preservation", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("preserves server-provided error message verbatim on 400 (non-401/403/502)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Bad request from server" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    let actualMessage = "<no-error>";
    try {
      await runSql("SELECT 1");
    } catch (e) {
      actualMessage = (e as Error).message;
    }
    expect(actualMessage).toBe("Bad request from server");
  });

  it("falls back to '${fallbackMessage}: ${text}' when body is text (not JSON)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal text error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    let actualMessage = "<no-error>";
    try {
      await runSql("SELECT 1");
    } catch (e) {
      actualMessage = (e as Error).message;
    }
    expect(actualMessage).toBe("SQL request failed: Internal text error");
  });

  it("falls back to fallbackMessage alone when body is empty + no JSON parse", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", { status: 418 }),
    );
    let actualMessage = "<no-error>";
    try {
      await runSql("SELECT 1");
    } catch (e) {
      actualMessage = (e as Error).message;
    }
    expect(actualMessage).toBe("SQL request failed");
  });
});
