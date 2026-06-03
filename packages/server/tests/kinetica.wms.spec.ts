import { describe, it, expect, vi, beforeEach } from "vitest";
import { kineticaWms } from "../src/kinetica";
import {
  KineticaAuthError,
  KineticaPermissionError,
  KineticaUpstreamError,
} from "../src/kineticaErrors";
import type { AuthedRequest } from "../src/auth";

// ---------------------------------------------------------------------------
// Fake request builder
// ---------------------------------------------------------------------------
const buildReq = (
  username = "alice",
  password = "hunter2",
  requestId = "test-req-id-wms-1"
): AuthedRequest =>
  ({
    user: {
      sub: username,
      sid: "x".repeat(64),
      creds: { username, password },
    },
    requestId,
  }) as unknown as AuthedRequest;

const ROUTE = "GET /api/wms";
const QUERY_STRING = "SERVICE=WMS&LAYERS=ki_home.test_t1&WIDTH=256&HEIGHT=256";

// Mock fetch helper — returns a binary-ish response by default
const mockFetch = (status: number, body?: string) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
      status,
      headers: { "Content-Type": status === 200 ? "image/png" : "text/html" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const mockFetchNetworkError = (message = "ECONNREFUSED") => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError(message));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
describe("kineticaWms happy path", () => {
  it("200 response → returns the raw Response object", async () => {
    mockFetch(200);
    const req = buildReq();
    const response = await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
  });

  it("caller can read .arrayBuffer() from the returned Response", async () => {
    mockFetch(200);
    const req = buildReq();
    const response = await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    const buffer = await response.arrayBuffer();
    expect(buffer).toBeDefined();
  });

  it("builds Authorization: Basic header from req.user.creds (not env vars)", async () => {
    const fetchMock = mockFetch(200);
    const req = buildReq("alice", "hunter2");
    await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("alice:hunter2");
  });

  it("appends ?queryString verbatim to KINETICA_URL/wms — no transformation", async () => {
    const fetchMock = mockFetch(200);
    const req = buildReq();
    const qs = "SERVICE=WMS&LAYERS=test&bbox=99,99,100,100";
    await kineticaWms(req, qs, { route: ROUTE });
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain("/wms?");
    expect(url).toContain(qs);
  });

  it("URL contains KINETICA_URL base without double slash", async () => {
    const fetchMock = mockFetch(200);
    const req = buildReq();
    await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain(process.env.KINETICA_URL!.replace(/\/$/, ""));
    expect(url).not.toContain("//wms");
  });
});

// ---------------------------------------------------------------------------
// Error classification — helper throws BEFORE returning a Response
// ---------------------------------------------------------------------------
describe("kineticaWms error classification", () => {
  it("401 response → throws KineticaAuthError (caller never sees 4xx Response)", async () => {
    mockFetch(401, "Unauthorized");
    const req = buildReq();
    await expect(
      kineticaWms(req, QUERY_STRING, { route: ROUTE })
    ).rejects.toBeInstanceOf(KineticaAuthError);
  });

  it("401 → KineticaAuthError carries upstreamStatus: 401", async () => {
    mockFetch(401, "Unauthorized");
    const req = buildReq();
    try {
      await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    } catch (e) {
      expect((e as KineticaAuthError).upstreamStatus).toBe(401);
    }
  });

  it("403 response → throws KineticaPermissionError", async () => {
    mockFetch(403, "Forbidden");
    const req = buildReq();
    await expect(
      kineticaWms(req, QUERY_STRING, { route: ROUTE })
    ).rejects.toBeInstanceOf(KineticaPermissionError);
  });

  it("403 → KineticaPermissionError carries upstreamStatus: 403", async () => {
    mockFetch(403, "Forbidden");
    const req = buildReq();
    try {
      await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    } catch (e) {
      expect((e as KineticaPermissionError).upstreamStatus).toBe(403);
    }
  });

  it("500 response → throws KineticaUpstreamError with upstreamStatus: 500", async () => {
    mockFetch(500, "Internal Server Error");
    const req = buildReq();
    await expect(
      kineticaWms(req, QUERY_STRING, { route: ROUTE })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("500 → KineticaUpstreamError carries upstreamStatus: 500", async () => {
    mockFetch(500, "Internal Server Error");
    const req = buildReq();
    try {
      await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    } catch (e) {
      expect((e as KineticaUpstreamError).upstreamStatus).toBe(500);
    }
  });

  it("network error (fetch rejects) → throws KineticaUpstreamError", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const req = buildReq();
    await expect(
      kineticaWms(req, QUERY_STRING, { route: ROUTE })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("network error → KineticaUpstreamError has upstreamStatus: undefined", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const req = buildReq();
    try {
      await kineticaWms(req, QUERY_STRING, { route: ROUTE });
    } catch (e) {
      expect((e as KineticaUpstreamError).upstreamStatus).toBeUndefined();
    }
  });
});
