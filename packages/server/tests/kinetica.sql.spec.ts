import { describe, it, expect, vi, beforeEach } from "vitest";
import { kineticaSql } from "../src/kinetica";
import {
  KineticaAuthError,
  KineticaPermissionError,
  KineticaUpstreamError,
} from "../src/kineticaErrors";
import type { AuthedRequest } from "../src/auth";

// ---------------------------------------------------------------------------
// Fake request builder — does NOT require a live session row
// ---------------------------------------------------------------------------
const buildReq = (
  username = "alice",
  password = "hunter2",
  requestId = "test-req-id-sql-1"
): AuthedRequest =>
  ({
    user: {
      sub: username,
      sid: "x".repeat(64),
      creds: { username, password },
    },
    requestId,
  }) as unknown as AuthedRequest;

const ROUTE = "POST /api/sql";

// Default happy-path body mirrors the Kinetica /execute/sql response shape
const happyBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [1, 2] }),
  }),
};

// Mock fetch helper
const mockFetch = (status: number, body?: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body !== undefined ? JSON.stringify(body) : "", {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// Mock fetch to reject with a network error
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
describe("kineticaSql happy path", () => {
  it("200 + valid body → returns parsed encoded shape { column_1: [1,2] }", async () => {
    mockFetch(200, happyBody);
    const req = buildReq();
    const result = await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    expect(result).toEqual({ column_1: [1, 2] });
  });

  it("builds Authorization: Basic header from req.user.creds (not env vars)", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq("alice", "hunter2");
    await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("alice:hunter2");
  });

  it("URL is constructed from KINETICA_URL env + /execute/sql", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain("/execute/sql");
    expect(url).toContain(process.env.KINETICA_URL!.replace(/\/$/, ""));
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------
describe("kineticaSql error classification", () => {
  it("401 response → throws KineticaAuthError with upstreamStatus: 401", async () => {
    mockFetch(401, "Unauthorized");
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaAuthError);
  });

  it("401 response → KineticaAuthError carries upstreamStatus: 401", async () => {
    mockFetch(401, "Unauthorized");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect((e as KineticaAuthError).upstreamStatus).toBe(401);
    }
  });

  it("403 response → throws KineticaPermissionError with upstreamStatus: 403", async () => {
    mockFetch(403, "Forbidden");
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaPermissionError);
  });

  it("403 response → KineticaPermissionError carries upstreamStatus: 403", async () => {
    mockFetch(403, "Forbidden");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect((e as KineticaPermissionError).upstreamStatus).toBe(403);
    }
  });

  // -----------------------------------------------------------------------
  // KEY TEST: 400 + 'Access denied; ok' → KineticaPermissionError (02-01 spike finding)
  // Kinetica returns HTTP 400 (not 403) for DDL permission denial.
  // Helper must classify this as KineticaPermissionError, NOT KineticaUpstreamError.
  // -----------------------------------------------------------------------
  it("400 + body.message='Access denied; ok' → throws KineticaPermissionError (not KineticaUpstreamError)", async () => {
    mockFetch(400, { status: "ERROR", message: "Access denied; ok" });
    const req = buildReq();
    await expect(
      kineticaSql(req, "CREATE OR REPLACE MATERIALIZED VIEW v AS SELECT 1", {
        route: "POST /api/views/:id/materialize",
        op: "MATERIALIZE",
      })
    ).rejects.toBeInstanceOf(KineticaPermissionError);
  });

  it("400 + body.message='Access denied; ok' → NOT KineticaUpstreamError", async () => {
    mockFetch(400, { status: "ERROR", message: "Access denied; ok" });
    const req = buildReq();
    try {
      await kineticaSql(req, "CREATE OR REPLACE MATERIALIZED VIEW v AS SELECT 1", {
        route: "POST /api/views/:id/materialize",
        op: "MATERIALIZE",
      });
    } catch (e) {
      expect(e).not.toBeInstanceOf(KineticaUpstreamError);
      expect((e as KineticaPermissionError).upstreamStatus).toBe(400);
    }
  });

  it("400 + body.message='permission denied for operation' → throws KineticaPermissionError", async () => {
    mockFetch(400, { status: "ERROR", message: "permission denied for operation" });
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaPermissionError);
  });

  it("400 + unrelated error body → throws KineticaUpstreamError", async () => {
    mockFetch(400, { status: "ERROR", message: "Invalid SQL syntax" });
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT FROM WHERE", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("500 response → throws KineticaUpstreamError with upstreamStatus: 500", async () => {
    mockFetch(500, "Internal Server Error");
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("500 response → KineticaUpstreamError carries upstreamStatus: 500", async () => {
    mockFetch(500, "Internal Server Error");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect((e as KineticaUpstreamError).upstreamStatus).toBe(500);
    }
  });

  it("200 + body.status === 'ERROR' → throws KineticaUpstreamError", async () => {
    mockFetch(200, { status: "ERROR", message: "Some Kinetica internal error" });
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("200 + body.status === 'ERROR' → NOT KineticaAuthError or KineticaPermissionError", async () => {
    mockFetch(200, { status: "ERROR", message: "Some Kinetica internal error" });
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect(e).not.toBeInstanceOf(KineticaAuthError);
      expect(e).not.toBeInstanceOf(KineticaPermissionError);
    }
  });

  it("network error (fetch rejects) → throws KineticaUpstreamError", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const req = buildReq();
    await expect(
      kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" })
    ).rejects.toBeInstanceOf(KineticaUpstreamError);
  });

  it("network error → KineticaUpstreamError has upstreamStatus: undefined", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect((e as KineticaUpstreamError).upstreamStatus).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// extra options merge
// ---------------------------------------------------------------------------
describe("kineticaSql extra options merge", () => {
  it("extra fields spread into the Kinetica request body", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", {
      route: ROUTE,
      op: "SQL",
      extra: { limit: 100, options: { foo: "bar" } },
    });
    const rawBody: string = fetchMock.mock.calls[0][1].body as string;
    const parsedBody = JSON.parse(rawBody);
    expect(parsedBody.limit).toBe(100);
    expect(parsedBody.options.foo).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// Sanitization: thrown error messages must NOT contain credential values
// ---------------------------------------------------------------------------
describe("kineticaSql sanitization", () => {
  const failureCases: Array<{ label: string; status: number; body?: unknown }> = [
    { label: "401", status: 401, body: "Unauthorized" },
    { label: "403", status: 403, body: "Forbidden" },
    {
      label: "400+access-denied",
      status: 400,
      body: { status: "ERROR", message: "Access denied; ok" },
    },
    { label: "500", status: 500, body: "Internal Server Error" },
    { label: "200+ERROR body", status: 200, body: { status: "ERROR", message: "internal" } },
  ];

  const sentinelPassword = "P@ssw0rd-do-not-leak";

  for (const { label, status, body } of failureCases) {
    it(`[${label}] thrown error.message does NOT contain the sentinel password`, async () => {
      mockFetch(status, body);
      const req = buildReq("alice", sentinelPassword);
      try {
        await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
        throw new Error("should have thrown");
      } catch (e) {
        expect(String(e)).not.toContain(sentinelPassword);
        expect((e as Error).message).not.toContain(sentinelPassword);
      }
    });
  }

  it("network throw: thrown error.message does NOT contain the sentinel password", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const req = buildReq("alice", sentinelPassword);
    try {
      await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
    } catch (e) {
      expect(String(e)).not.toContain(sentinelPassword);
    }
  });

  it("thrown errors do NOT contain 'Basic ' or Authorization header value", async () => {
    for (const { status, body } of failureCases) {
      mockFetch(status, body);
      const req = buildReq("alice", sentinelPassword);
      try {
        await kineticaSql(req, "SELECT 1", { route: ROUTE, op: "SQL" });
      } catch (e) {
        expect(String(e)).not.toContain("Basic ");
      }
    }
  });
});
