import { describe, it, expect, vi, beforeEach } from "vitest";
import { kineticaSql, kineticaWms } from "../src/kinetica";
import type { AuthedRequest } from "../src/auth";

// ---------------------------------------------------------------------------
// Fake request builders — Phase 4 flat AuthedRequest shape
// ---------------------------------------------------------------------------

// Password-mode request (default)
const buildReq = (
  username = "alice",
  password = "hunter2",
  requestId = "test-req-id-audit-1"
): AuthedRequest =>
  ({
    user: {
      sub: username,
      sid: "x".repeat(64),
      credentialType: "password" as const,
      creds: { username, password, token: "" },
    },
    requestId,
  }) as unknown as AuthedRequest;

// OIDC-mode request
const buildOidcReq = (
  token = "oidc-access-token-audit",
  requestId = "test-req-id-audit-oidc"
): AuthedRequest =>
  ({
    user: {
      sub: "alice",
      sid: "x".repeat(64),
      credentialType: "oidc" as const,
      creds: { username: "alice", password: "", token },
    },
    requestId,
  }) as unknown as AuthedRequest;

// Default happy-path Kinetica SQL body
const happyBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [1, 2] }),
  }),
};

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

const mockFetchNetworkError = (message = "ECONNREFUSED") => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError(message));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Audit log structure for kineticaSql
// ---------------------------------------------------------------------------
describe("kineticaSql audit log — shape", () => {
  it("emits exactly ONE console.log call per invocation (happy path)", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("logged string is valid JSON (no leading prefix, no trailing duplication)", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const logArg: string = logSpy.mock.calls[0][0];
    expect(() => JSON.parse(logArg)).not.toThrow();
  });

  it("field set is EXACTLY { ts, request_id, username, route, op, outcome, status, duration_ms, auth_mode } — no extras, no missing (9 keys)", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    const EXPECTED_KEYS = [
      "auth_mode",
      "duration_ms",
      "op",
      "outcome",
      "request_id",
      "route",
      "status",
      "ts",
      "username",
    ].sort();
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_KEYS);
  });

  it("username matches req.user.creds.username", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq("alice");
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.username).toBe("alice");
  });

  it("request_id matches req.requestId", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq("alice", "hunter2", "my-unique-req-id");
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.request_id).toBe("my-unique-req-id");
  });

  it("route matches the route option", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.route).toBe("POST /api/sql");
  });

  it("op matches the op option", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "GET /api/kinetica/schemas", op: "DISCOVERY" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.op).toBe("DISCOVERY");
  });

  it("duration_ms is a non-negative number", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(typeof parsed.duration_ms).toBe("number");
    expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Audit log outcome mapping
// ---------------------------------------------------------------------------
describe("kineticaSql audit log — outcome field", () => {
  it("success path → outcome: 'success', status: 200", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("success");
    expect(parsed.status).toBe(200);
  });

  it("401 → outcome: 'auth-fail', status: 502", async () => {
    mockFetch(401, "Unauthorized");
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("auth-fail");
    expect(parsed.status).toBe(502);
  });

  it("403 → outcome: 'permission-denied', status: 502", async () => {
    mockFetch(403, "Forbidden");
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("permission-denied");
    expect(parsed.status).toBe(502);
  });

  it("400+access-denied → outcome: 'permission-denied', status: 502", async () => {
    mockFetch(400, { status: "ERROR", message: "Access denied; ok" });
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/views/:id/materialize", op: "MATERIALIZE" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("permission-denied");
    expect(parsed.status).toBe(502);
  });

  it("500 → outcome: 'upstream-error', status: 502", async () => {
    mockFetch(500, "Internal Server Error");
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("upstream-error");
    expect(parsed.status).toBe(502);
  });

  it("network throw → outcome: 'upstream-error', status: 502", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("upstream-error");
    expect(parsed.status).toBe(502);
  });

  it("body.status==='ERROR' (200 response) → outcome: 'upstream-error', status: 502", async () => {
    mockFetch(200, { status: "ERROR", message: "Kinetica internal error" });
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected throw
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("upstream-error");
    expect(parsed.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Audit log — NO leakage: SQL body, WMS query string, Authorization header
// ---------------------------------------------------------------------------
describe("kineticaSql audit log — no leakage", () => {
  it("SQL body does NOT appear in the audit log line", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    const sentinelSql = "SELECT secret_admin_table FROM admin_only_schema";
    await kineticaSql(req, sentinelSql, { route: "POST /api/sql", op: "SQL" });
    const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).not.toContain("secret_admin_table");
    expect(logged).not.toContain("admin_only_schema");
  });

  it("password does NOT appear in the audit log line", async () => {
    const sentinelPassword = "P@ssw0rd-do-not-leak-in-audit";
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq("alice", sentinelPassword);
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).not.toContain(sentinelPassword);
  });

  it("Authorization header ('Basic ...') does NOT appear in the audit log", async () => {
    mockFetch(200, happyBody);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq("alice", "hunter2");
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).not.toContain("Basic ");
    // No base64 credential string in log
    const b64Creds = Buffer.from("alice:hunter2").toString("base64");
    expect(logged).not.toContain(b64Creds);
  });

  it("password does NOT appear in audit log on failure paths", async () => {
    const sentinelPassword = "P@ssw0rd-do-not-leak-failure";
    const logSpy = vi.spyOn(console, "log");

    for (const { status, body } of [
      { status: 401, body: "Unauthorized" },
      { status: 403, body: "Forbidden" },
      { status: 500, body: "Server Error" },
    ]) {
      mockFetch(status, body);
      const req = buildReq("alice", sentinelPassword);
      try {
        await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
      } catch {
        // expected
      }
    }

    const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).not.toContain(sentinelPassword);
  });
});

// ---------------------------------------------------------------------------
// Failure paths: console.error is called exactly once for raw upstream detail
// ---------------------------------------------------------------------------
describe("kineticaSql audit log — console.error on failure", () => {
  it("401 → console.error called exactly once (separate from audit console.log)", async () => {
    mockFetch(401, "Unauthorized");
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected
    }
    expect(logSpy).toHaveBeenCalledTimes(1); // audit line
    expect(errSpy).toHaveBeenCalledTimes(1); // raw error detail
  });

  it("500 → both console.log (audit) and console.error (raw detail) called exactly once", async () => {
    mockFetch(500, "Internal Server Error");
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("network throw → both console.log and console.error called exactly once", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    try {
      await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    } catch {
      // expected
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("success path → console.error is NOT called", async () => {
    mockFetch(200, happyBody);
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    expect(errSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// kineticaWms audit log
// ---------------------------------------------------------------------------
describe("kineticaWms audit log", () => {
  const ROUTE = "GET /api/wms";

  const mockWmsFetch = (status: number) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(status === 200 ? new Uint8Array([0x89, 0x50]).buffer : "", {
        status,
        headers: { "Content-Type": status === 200 ? "image/png" : "text/html" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("emits exactly ONE console.log call per WMS invocation (happy path)", async () => {
    mockWmsFetch(200);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaWms(req, "SERVICE=WMS&LAYERS=test&bbox=99,99,100,100", { route: ROUTE });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("WMS audit log field set is EXACTLY the same 9 fields as SQL (includes auth_mode)", async () => {
    mockWmsFetch(200);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    const EXPECTED_KEYS = [
      "auth_mode",
      "duration_ms",
      "op",
      "outcome",
      "request_id",
      "route",
      "status",
      "ts",
      "username",
    ].sort();
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_KEYS);
  });

  it("WMS op is always 'WMS'", async () => {
    mockWmsFetch(200);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.op).toBe("WMS");
  });

  it("WMS query string does NOT appear in the audit log line", async () => {
    mockWmsFetch(200);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    const sentinelQs = "bbox=99,99,100,100&LAYERS=secret_location_data";
    await kineticaWms(req, sentinelQs, { route: ROUTE });
    const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).not.toContain("bbox=99,99,100,100");
    expect(logged).not.toContain("secret_location_data");
  });

  it("WMS 401 → outcome: 'auth-fail', status: 502", async () => {
    mockWmsFetch(401);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    } catch {
      // expected
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("auth-fail");
    expect(parsed.status).toBe(502);
  });

  it("WMS 500 → outcome: 'upstream-error', status: 502", async () => {
    mockWmsFetch(500);
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    try {
      await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    } catch {
      // expected
    }
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.outcome).toBe("upstream-error");
    expect(parsed.status).toBe(502);
  });

  it("WMS success → console.error is NOT called", async () => {
    mockWmsFetch(200);
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("WMS failure → console.error called exactly once", async () => {
    mockWmsFetch(401);
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    const req = buildReq();
    try {
      await kineticaWms(req, "SERVICE=WMS", { route: ROUTE });
    } catch {
      // expected
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// auth_mode field in audit log (OBS-02 / SC5)
// ---------------------------------------------------------------------------
describe("audit log — auth_mode field", () => {
  const mockFetchSql = (status = 200, body: unknown = happyBody) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const mockFetchWmsLocal = (status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50]).buffer, {
        status,
        headers: { "Content-Type": "image/png" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("Test 6: kineticaSql with credentialType=oidc → audit line has auth_mode: 'oidc'", async () => {
    mockFetchSql();
    const logSpy = vi.spyOn(console, "log");
    const req = buildOidcReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.auth_mode).toBe("oidc");
  });

  it("Test 7: kineticaSql with credentialType=password → audit line has auth_mode: 'password'", async () => {
    mockFetchSql();
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.auth_mode).toBe("password");
  });

  it("Test 8: kineticaWms with credentialType=password → audit line has auth_mode: 'password'", async () => {
    mockFetchWmsLocal();
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaWms(req, "SERVICE=WMS", { route: "GET /api/wms" });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.auth_mode).toBe("password");
  });

  it("Test 10 (negative): audit line does NOT contain 'auth_scheme' key (rejected design)", async () => {
    mockFetchSql();
    const logSpy = vi.spyOn(console, "log");
    const req = buildReq();
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const logged = logSpy.mock.calls[0][0];
    expect(logged).not.toContain("auth_scheme");
    const parsed = JSON.parse(logged);
    expect(parsed).not.toHaveProperty("auth_scheme");
  });
});
