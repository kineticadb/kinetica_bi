/**
 * kinetica.creds.spec.ts — Unit tests locking the Bearer/Basic credential-type discriminant.
 *
 * Tests the credential-type-aware buildAuthHeader function (accessed via kineticaSql/kineticaWms)
 * and the PITFALL I-01 lock (branch on credentialType, never on creds.password truthiness).
 *
 * Phase 6 Plan 01 — Task 1 (TDD RED phase)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { kineticaSql, kineticaWms } from "../src/kinetica";
import type { AuthedRequest } from "../src/auth";

// ---------------------------------------------------------------------------
// Fixture builders — Phase 4 flat AuthedRequest shape
// ---------------------------------------------------------------------------

const buildOidcReq = (token = "oidc-access-token-abc"): AuthedRequest =>
  ({
    user: {
      sub: "alice",
      sid: "x".repeat(64),
      credentialType: "oidc" as const,
      creds: { username: "alice", password: "", token },
    },
    requestId: "test-req-id",
  }) as unknown as AuthedRequest;

const buildPasswordReq = (username = "alice", password = "hunter2"): AuthedRequest =>
  ({
    user: {
      sub: username,
      sid: "x".repeat(64),
      credentialType: "password" as const,
      creds: { username, password, token: "" },
    },
    requestId: "test-req-id",
  }) as unknown as AuthedRequest;

// Default happy-path SQL body
const happyBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [1] }),
  }),
};

// Default happy-path WMS response (binary-ish)
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

const mockFetchWms = (status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([0x89, 0x50]).buffer, {
      status,
      headers: { "Content-Type": "image/png" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: OIDC → Bearer header via kineticaSql
// ---------------------------------------------------------------------------
describe("buildAuthHeader — OIDC mode", () => {
  it("Test 1: credentialType=oidc → Authorization is 'Bearer <token>'", async () => {
    const fetchMock = mockFetchSql();
    const req = buildOidcReq("oidc-access-token-abc");
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe("Bearer oidc-access-token-abc");
    expect(authHeader).toContain("Bearer "); // starts with Bearer scheme
  });

  it("Test 4: PITFALL I-01 (OIDC ignores creds.password) — credentialType=oidc with creds.password set → Bearer uses token NOT password", async () => {
    const fetchMock = mockFetchSql();
    const req = {
      user: {
        sub: "alice",
        sid: "x".repeat(64),
        credentialType: "oidc" as const,
        creds: { username: "alice", password: "should-NEVER-appear", token: "real-token" },
      },
      requestId: "test-req-id",
    } as unknown as AuthedRequest;
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe("Bearer real-token");
    expect(authHeader).not.toContain("should-NEVER-appear");
  });
});

// ---------------------------------------------------------------------------
// Test 2: Password → Basic header via kineticaSql
// ---------------------------------------------------------------------------
describe("buildAuthHeader — password mode", () => {
  it("Test 2: credentialType=password → Authorization is 'Basic <b64(username:password)>'", async () => {
    const fetchMock = mockFetchSql();
    const req = buildPasswordReq("alice", "hunter2");
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    const expected = "Basic " + Buffer.from("alice:hunter2").toString("base64");
    expect(authHeader).toBe(expected);
  });

  it("Test 3: PITFALL I-01 (password ignores creds.token) — credentialType=password with creds.token set → Basic uses password NOT token", async () => {
    const fetchMock = mockFetchSql();
    const req = {
      user: {
        sub: "alice",
        sid: "x".repeat(64),
        credentialType: "password" as const,
        creds: { username: "alice", password: "real-pw", token: "should-NEVER-appear" },
      },
      requestId: "test-req-id",
    } as unknown as AuthedRequest;
    await kineticaSql(req, "SELECT 1", { route: "POST /api/sql", op: "SQL" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    const expected = "Basic " + Buffer.from("alice:real-pw").toString("base64");
    expect(authHeader).toBe(expected);
    expect(authHeader).not.toContain("should-NEVER-appear");
  });
});

// ---------------------------------------------------------------------------
// Test 5: kineticaWms uses same credential branch
// ---------------------------------------------------------------------------
describe("buildAuthHeader — kineticaWms", () => {
  it("Test 5: kineticaWms with credentialType=oidc → Authorization is 'Bearer <token>'", async () => {
    const fetchMock = mockFetchWms();
    const req = buildOidcReq("wms-tok");
    await kineticaWms(req, "SERVICE=WMS&LAYERS=test", { route: "GET /api/wms" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe("Bearer wms-tok");
    expect(authHeader).toContain("Bearer "); // starts with Bearer scheme
  });

  it("kineticaWms with credentialType=password → Authorization is 'Basic <b64>'", async () => {
    const fetchMock = mockFetchWms();
    const req = buildPasswordReq("bob", "secretpw");
    await kineticaWms(req, "SERVICE=WMS&LAYERS=test", { route: "GET /api/wms" });
    const authHeader: string = fetchMock.mock.calls[0][1].headers.Authorization;
    const expected = "Basic " + Buffer.from("bob:secretpw").toString("base64");
    expect(authHeader).toBe(expected);
  });
});
