// server/tests/auth.oidc.spec.ts
// Plan 05-04: route-level OIDC behavior coverage. Pairs the 4 new route surfaces from
// Plan 05-03 with vi.mock("openid-client") to make every Phase 5 success criterion
// (SC1-SC5) automated. Friendly error codes are LOCKED — Phase 7 frontend asserts them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Hoisted mock fixtures — must precede any imports that pull in oidc.ts.
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const makeTokenSet = (
    claims: Record<string, unknown> = { sub: "u1", preferred_username: "alice" }
  ) => ({
    access_token: "mock.access.token",
    id_token: "mock.id.token",
    token_type: "Bearer",
    expires_in: 3600,
    claims: () => claims,
  });
  const tokenSet = makeTokenSet();
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi
      .fn()
      .mockReturnValue("https://idp.example.com/authorize?mock=1&state=stub"),
    callback: vi.fn().mockResolvedValue(tokenSet),
  };
  const issuer = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Client: vi.fn().mockImplementation(function (_metadata: unknown) {
      return client;
    }),
    metadata: { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" },
  };
  const Issuer = { discover: vi.fn().mockResolvedValue(issuer) };
  class OPError extends Error {
    error: string;
    error_description?: string;
    constructor(error: string, desc?: string) {
      super(error);
      this.name = "OPError";
      this.error = error;
      this.error_description = desc;
    }
  }
  class RPError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "RPError";
    }
  }
  return { CLOCK_TOLERANCE, makeTokenSet, tokenSet, client, issuer, Issuer, OPError, RPError };
});

vi.mock("openid-client", () => ({
  Issuer: mocks.Issuer,
  custom: { clock_tolerance: mocks.CLOCK_TOLERANCE },
  errors: { OPError: mocks.OPError, RPError: mocks.RPError },
}));

import { buildTestApp } from "./helpers/app";
import { db } from "../src/db";
import { resetOidcClientForTests } from "../src/oidc";
import { createAdminSession } from "./helpers/db";

const stubOidcEnv = () => {
  vi.stubEnv("AUTH_MODE", "oidc");
  vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
  vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
  vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
};

const stubPasswordEnv = () => {
  vi.stubEnv("AUTH_MODE", "password");
};

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  resetOidcClientForTests();
  // Reset call counts AND queued onces on mocks (mockClear does not clear queued onces).
  // Then re-establish the default callback resolution so tests that don't queue a Once
  // still get a successful tokenSet.
  (mocks.client.authorizationUrl as ReturnType<typeof vi.fn>).mockClear();
  (mocks.client.callback as ReturnType<typeof vi.fn>).mockReset();
  (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValue(mocks.tokenSet);
  // After mockReset(), the issuer.Client mock loses its impl; restore so initOidcClient
  // continues to construct a Client returning our `client` fixture.
  (mocks.issuer.Client as ReturnType<typeof vi.fn>).mockImplementation(function (
    _metadata: unknown
  ) {
    return mocks.client;
  });
  (mocks.Issuer.discover as ReturnType<typeof vi.fn>).mockResolvedValue(mocks.issuer);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const setOidcStateCookie = (state: string, nonce: string) =>
  `oidc_state=${encodeURIComponent(JSON.stringify({ state, nonce }))}`;

// Helper: assert that a Set-Cookie header array contains an oidc_state clearing line.
// Express `res.clearCookie('oidc_state', { path: '/' })` emits a Set-Cookie of the form:
//   oidc_state=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
// The matcher accepts either an empty value (oidc_state=;) or any line containing the
// 1970 epoch expiry, since both forms are valid clearing signals across Express versions.
const assertOidcStateCleared = (
  setCookieHeader: string | string[] | undefined,
  branchLabel: string
) => {
  const arr = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const cleared = arr.find(
    (c) =>
      /^oidc_state=;/.test(c) ||
      (/oidc_state=/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c))
  );
  if (!cleared) {
    throw new Error(
      `[${branchLabel}] expected Set-Cookie to clear oidc_state. Got: ${JSON.stringify(arr)}`
    );
  }
  expect(cleared).toBeDefined();
};

// ---------- /api/auth/config ----------
describe("GET /api/auth/config", () => {
  it("returns {authMode: 'password'} in password mode", async () => {
    stubPasswordEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: "password" });
  });

  it("returns {authMode: 'oidc'} in oidc mode", async () => {
    stubOidcEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: "oidc" });
  });

  it("sets Cache-Control: no-store header (PITFALLS I-03)", async () => {
    stubPasswordEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/config");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is reachable without authentication", async () => {
    stubPasswordEnv();
    const agent = await buildTestApp();
    // No Cookie header set; expect 200 (not 401)
    const res = await agent.get("/api/auth/config");
    expect(res.status).toBe(200);
  });
});

// ---------- /api/auth/oidc/start ----------
describe("GET /api/auth/oidc/start", () => {
  it("oidc mode: 302 redirect to mocked authorizationUrl + oidc_state cookie set", async () => {
    stubOidcEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/oidc/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://idp.example.com/authorize?mock=1&state=stub");
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
    expect(cookieStr).toMatch(/oidc_state=/);
    expect(cookieStr).toMatch(/HttpOnly/);
    expect(cookieStr).toMatch(/Path=\//);
    expect(cookieStr).toMatch(/SameSite=Lax/);
  });

  it("oidc mode: oidc_state cookie value parses to {state,nonce}", async () => {
    stubOidcEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/oidc/start");
    const setCookie = res.headers["set-cookie"] as string[];
    // Find the oidc_state cookie line
    const stateLine = setCookie.find((c) => c.startsWith("oidc_state="));
    expect(stateLine).toBeDefined();
    const valueRaw = stateLine!.split(";")[0].slice("oidc_state=".length);
    const value = decodeURIComponent(valueRaw);
    const parsed = JSON.parse(value) as { state: string; nonce: string };
    expect(typeof parsed.state).toBe("string");
    expect(typeof parsed.nonce).toBe("string");
    expect(parsed.state.length).toBeGreaterThan(20); // base64url(32 bytes) ~= 43 chars
    expect(parsed.nonce.length).toBeGreaterThan(20);
  });

  it("password mode: 400 with {error: 'OIDC is not enabled.'}", async () => {
    stubPasswordEnv();
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/oidc/start");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "OIDC is not enabled." });
  });

  it("oidc mode: passes scope='openid profile' + state + nonce + redirect_uri to authorizationUrl", async () => {
    stubOidcEnv();
    const agent = await buildTestApp();
    await agent.get("/api/auth/oidc/start");
    expect(mocks.client.authorizationUrl).toHaveBeenCalledTimes(1);
    const arg = (mocks.client.authorizationUrl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.scope).toBe("openid profile");
    expect(arg.redirect_uri).toBe("https://bi.example.com/api/auth/oidc/callback");
    expect(typeof arg.state).toBe("string");
    expect(typeof arg.nonce).toBe("string");
  });
});

// ---------- /api/auth/oidc/callback ----------
describe("GET /api/auth/oidc/callback (oidc mode)", () => {
  beforeEach(() => {
    stubOidcEnv();
  });

  it("?error=access_denied → 302 /login?error=oidc_denied", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?error=access_denied&state=anything")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_denied");
  });

  it("?error=server_error (non-access_denied IdP error) → /login?error=oidc_invalid", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?error=server_error&state=anything")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
  });

  it("missing code → /login?error=oidc_invalid", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
  });

  it("missing state → /login?error=oidc_invalid", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
  });

  it("missing oidc_state cookie → /login?error=oidc_invalid", async () => {
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/oidc/callback?code=AC&state=S");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
  });

  it("state mismatch → /login?error=oidc_invalid", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=WRONG")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
    // exchangeCode must NOT be reached when state mismatches
    expect(mocks.client.callback).not.toHaveBeenCalled();
  });

  it("OPError(invalid_request) from exchangeCode → /login?error=oidc_invalid", async () => {
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new mocks.OPError("invalid_request", "Bad request")
    );
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_invalid");
  });

  it("RPError from exchangeCode → /login?error=oidc_token_invalid (PITFALLS C-01..C-05)", async () => {
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new mocks.RPError("nonce mismatch")
    );
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_token_invalid");
  });

  it("empty preferred_username claim → /login?error=oidc_no_username (PITFALLS T-03)", async () => {
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mocks.makeTokenSet({ sub: "u1", preferred_username: "" })
    );
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=oidc_no_username");
  });

  it("success → 302 /, kbi_session cookie set, sessions row has credential_type='oidc' + id_token populated (Phase 5 SC5)", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    // kbi_session cookie issued
    const setCookie = res.headers["set-cookie"] as string[];
    const cookieJoined = setCookie.join(";");
    expect(cookieJoined).toMatch(/kbi_session=/);
    // Session row has credential_type='oidc' AND id_token columns populated
    const rows = db
      .prepare(
        `SELECT username, credential_type,
                length(ciphertext) AS ct_len,
                length(id_token_ciphertext) AS id_ct_len
         FROM sessions`
      )
      .all() as Array<{
      username: string;
      credential_type: string;
      ct_len: number;
      id_ct_len: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("alice");
    expect(rows[0].credential_type).toBe("oidc");
    expect(rows[0].ct_len).toBeGreaterThan(0);
    expect(rows[0].id_ct_len).toBeGreaterThan(0);
  });
});

// ---------- /api/auth/oidc/callback: parametrized "every exit clears oidc_state" ----------
// Per CONTEXT.md locked decision: "cookie cleared on every callback exit — success + all errors".
// This single parametrized test exercises ALL 11 exit branches and asserts Set-Cookie clearing
// on each. Without this, only 2 of ~11 branches were covered, and a regression in any of the
// other 9 (e.g., a wrapped early-return) would silently pass.
describe("GET /api/auth/oidc/callback: every exit clears oidc_state cookie", () => {
  // ----- oidc-mode branches (10) -----
  type OidcCase = {
    label: string;
    setupBeforeRequest?: () => void; // runs after stubOidcEnv, before buildTestApp
    url: string; // querystring after `?`
    cookie: string | null; // raw Cookie header value, or null to omit
  };

  const oidcCases: OidcCase[] = [
    {
      label: "access_denied",
      url: "?error=access_denied&state=anything",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "server_error",
      url: "?error=server_error&state=anything",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "missing code",
      url: "?state=S",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "missing state",
      url: "?code=AC",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "missing cookie",
      url: "?code=AC&state=S",
      cookie: null,
    },
    {
      label: "state mismatch",
      url: "?code=AC&state=WRONG",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "OPError from exchange",
      setupBeforeRequest: () => {
        (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new mocks.OPError("invalid_request", "Bad request")
        );
      },
      url: "?code=AC&state=S",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "RPError from exchange",
      setupBeforeRequest: () => {
        (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new mocks.RPError("nonce mismatch")
        );
      },
      url: "?code=AC&state=S",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "no-username",
      setupBeforeRequest: () => {
        (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
          mocks.makeTokenSet({ sub: "u1", preferred_username: "" })
        );
      },
      url: "?code=AC&state=S",
      cookie: setOidcStateCookie("S", "N"),
    },
    {
      label: "success",
      url: "?code=AC&state=S",
      cookie: setOidcStateCookie("S", "N"),
    },
  ];

  it.each(oidcCases)("[oidc-mode] $label clears oidc_state cookie", async (tc) => {
    stubOidcEnv();
    if (tc.setupBeforeRequest) tc.setupBeforeRequest();
    const agent = await buildTestApp();
    const req = agent.get(`/api/auth/oidc/callback${tc.url}`);
    if (tc.cookie) req.set("Cookie", tc.cookie);
    const res = await req;
    assertOidcStateCleared(res.headers["set-cookie"], `oidc-mode/${tc.label}`);
  });

  // ----- password-mode branch (1) -----
  // The password-mode 400 path returns BEFORE clearCookie runs in the current implementation
  // (the route guard at the top short-circuits). CONTEXT.md scopes "every exit clears the cookie"
  // to the OIDC-mode callback path (where the cookie is meaningfully set in /oidc/start). In
  // password mode, /oidc/start returns 400 and never sets oidc_state, so /oidc/callback in
  // password mode has no cookie to clear. This test asserts the 400 branch returns the locked
  // payload — covering the 11th exit for completeness — and does NOT require Set-Cookie clearing.
  it("[password-mode] callback returns 400 (no oidc_state cookie ever set in password mode)", async () => {
    stubPasswordEnv();
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "OIDC is not enabled." });
    // No assertion on Set-Cookie clearing: in password mode /oidc/start cannot run, so a real
    // browser will never have an oidc_state cookie to clear. The 400 branch short-circuits
    // before any cookie logic. CONTEXT.md's "every exit clears oidc_state" applies to the
    // oidc-mode callback path, all 10 branches covered above.
  });
});

// ---------- /api/auth/oidc/* in password mode ----------
describe("OIDC routes in password mode return 400", () => {
  beforeEach(() => {
    stubPasswordEnv();
  });

  it("/api/auth/oidc/callback returns 400 in password mode", async () => {
    const agent = await buildTestApp();
    const res = await agent.get("/api/auth/oidc/callback?code=AC&state=S");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "OIDC is not enabled." });
  });
});

// ---------- POST /api/auth/login gate ----------
describe("POST /api/auth/login (oidc mode gate)", () => {
  beforeEach(() => {
    stubOidcEnv();
  });

  it("returns 400 with locked message", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Password login is disabled. Use OIDC." });
    // verifyKineticaCredentials is NEVER called — gate trips first.
    // Filter for /execute/sql (the verifyKineticaCredentials endpoint); ignore Plan 06-03's
    // unauthenticated /version boot probe which also flows through this fetchMock.
    const sqlCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(sqlCalls.length).toBe(0);
  });
});

// Plan 06-03: opaque-token warning at /oidc/callback (PITFALL T-05).
// CONTEXT.md "Opaque access token handling": once-per-login structured warn before
// createSession when tryDecodeAccessTokenExp(accessToken) === null.
describe("GET /api/auth/oidc/callback: opaque-token warning (Plan 06-03)", () => {
  // Build a valid 3-segment JWT with parseable exp claim.
  const makeJwt = (payload: Record<string, unknown>): string => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.sig`;
  };

  // Helper: parse warn-spy entries as JSON and find the first matching event.
  const findWarn = (
    spy: ReturnType<typeof vi.spyOn>,
    event: string
  ): Record<string, unknown> | undefined => {
    return (spy.mock.calls as unknown[][])
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((o): o is Record<string, unknown> => o?.event === event);
  };

  it("Test 8: opaque access_token (decode fails) emits one structured oidc_opaque_access_token warn", async () => {
    stubOidcEnv();
    // Override the openid-client callback mock to return an opaque access_token.
    // "opaque-no-dots" has no dots → tryDecodeAccessTokenExp returns null.
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      access_token: "opaque-no-dots",
      id_token: "mock.id.token",
      token_type: "Bearer",
      expires_in: 3600,
      claims: () => ({ sub: "u1", preferred_username: "alice" }),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const opaqueWarn = findWarn(warnSpy, "oidc_opaque_access_token");
    expect(opaqueWarn).toBeDefined();
    expect(opaqueWarn!.username).toBe("alice");
    expect(opaqueWarn!.level).toBe("warn");
    expect(opaqueWarn!.message).toContain("opaque");
    // Secret never leaked
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain("opaque-no-dots");
  });

  it("Test 9: JWT access_token with valid exp emits NO oidc_opaque_access_token warn", async () => {
    stubOidcEnv();
    const future = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({ exp: future, sub: "alice" });
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      access_token: jwt,
      id_token: "mock.id.token",
      token_type: "Bearer",
      expires_in: 3600,
      claims: () => ({ sub: "u1", preferred_username: "alice" }),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = await buildTestApp();
    const res = await agent
      .get("/api/auth/oidc/callback?code=AC&state=S")
      .set("Cookie", setOidcStateCookie("S", "N"));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const opaqueWarn = findWarn(warnSpy, "oidc_opaque_access_token");
    expect(opaqueWarn).toBeUndefined();
  });
});
