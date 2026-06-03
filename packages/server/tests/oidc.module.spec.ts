// server/tests/oidc.module.spec.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// IMPORTANT: vi.mock is hoisted; it must precede oidc imports.
// Use vi.hoisted() so the mock fixtures are accessible from outside the factory.
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const tokenSet = {
    access_token: "mock-access-token",
    id_token: "mock.id.token",
    token_type: "Bearer",
    expires_in: 3600,
    claims: () => ({ sub: "u1", preferred_username: "alice" }),
  };
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn().mockResolvedValue(tokenSet),
  };
  const issuer = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Client: vi.fn().mockImplementation(function (_metadata: unknown) { return client; }),
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
  return {
    CLOCK_TOLERANCE,
    tokenSet,
    client,
    issuer,
    Issuer,
    OPError,
    RPError,
  };
});

vi.mock("openid-client", () => ({
  Issuer: mocks.Issuer,
  custom: { clock_tolerance: mocks.CLOCK_TOLERANCE },
  errors: { OPError: mocks.OPError, RPError: mocks.RPError },
}));

import {
  validateOidcEnv,
  initOidcClient,
  buildAuthorizationUrl,
  exchangeCode,
  extractUsername,
  mapOidcError,
  resetOidcClientForTests,
} from "../src/oidc";

describe("validateOidcEnv", () => {
  beforeEach(() => {
    // Clear all OIDC env vars per test
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "");
    vi.stubEnv("AUTH_OIDC_USERNAME_CLAIM", "");
    vi.stubEnv("AUTH_OIDC_USERNAME_REGEX", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // NOTE on env stubbing: vi.stubEnv("X", "") sets process.env.X = "" which is falsy in
  // string-ternary form `process.env.X || default` — same as unset for the validator's purpose.

  it("throws when AUTH_OIDC_ISSUER_URL is missing", () => {
    expect(() => validateOidcEnv()).toThrow(/AUTH_OIDC_ISSUER_URL is required/);
  });

  it("throws when AUTH_OIDC_CLIENT_ID is missing (with issuer set)", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    expect(() => validateOidcEnv()).toThrow(/AUTH_OIDC_CLIENT_ID is required/);
  });

  it("throws when AUTH_OIDC_CLIENT_SECRET is missing", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    expect(() => validateOidcEnv()).toThrow(/AUTH_OIDC_CLIENT_SECRET is required/);
  });

  it("throws when AUTH_OIDC_REDIRECT_URI is missing", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    expect(() => validateOidcEnv()).toThrow(/AUTH_OIDC_REDIRECT_URI is required/);
  });

  it("strips trailing slash from issuer URL (PITFALLS O-01, C-05)", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com/");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    const cfg = validateOidcEnv();
    expect(cfg.issuer).toBe("https://idp.example.com");
  });

  it("defaults usernameClaim to 'preferred_username' when unset", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    const cfg = validateOidcEnv();
    expect(cfg.usernameClaim).toBe("preferred_username");
  });

  it("honors AUTH_OIDC_USERNAME_CLAIM override", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    vi.stubEnv("AUTH_OIDC_USERNAME_CLAIM", "email");
    const cfg = validateOidcEnv();
    expect(cfg.usernameClaim).toBe("email");
  });

  it("captures AUTH_OIDC_USERNAME_REGEX when set", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    vi.stubEnv("AUTH_OIDC_USERNAME_REGEX", "^([^@]+)@");
    const cfg = validateOidcEnv();
    expect(cfg.usernameRegex).toBe("^([^@]+)@");
  });

  it("returns undefined for usernameRegex when empty string", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    // AUTH_OIDC_USERNAME_REGEX explicitly set to empty string in beforeEach
    const cfg = validateOidcEnv();
    expect(cfg.usernameRegex).toBeUndefined();
  });

  it("returns a frozen config object", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    const cfg = validateOidcEnv();
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

describe("extractUsername", () => {
  const baseConfig = {
    issuer: "https://idp.example.com",
    clientId: "kinetica-bi",
    clientSecret: "s",
    redirectUri: "https://bi.example.com/cb",
    usernameClaim: "preferred_username",
  };

  it("returns claim value when no regex set", () => {
    expect(extractUsername({ preferred_username: "alice" }, baseConfig)).toBe("alice");
  });

  it("returns null when claim absent", () => {
    expect(extractUsername({}, baseConfig)).toBeNull();
  });

  it("returns null when claim is empty string", () => {
    expect(extractUsername({ preferred_username: "" }, baseConfig)).toBeNull();
  });

  it("returns null when claim is whitespace", () => {
    expect(extractUsername({ preferred_username: "   " }, baseConfig)).toBeNull();
  });

  it("returns null when claim is non-string", () => {
    expect(extractUsername({ preferred_username: 42 } as Record<string, unknown>, baseConfig)).toBeNull();
  });

  it("applies regex capture group 1 (email local-part)", () => {
    const cfg = { ...baseConfig, usernameRegex: "^([^@]+)@.*$" };
    expect(extractUsername({ preferred_username: "alice@example.com" }, cfg)).toBe("alice");
  });

  it("falls back to full match when regex has no capture group", () => {
    const cfg = { ...baseConfig, usernameRegex: "alice" };
    expect(extractUsername({ preferred_username: "alice@example.com" }, cfg)).toBe("alice");
  });

  it("returns null when regex does not match", () => {
    const cfg = { ...baseConfig, usernameRegex: "^bob$" };
    expect(extractUsername({ preferred_username: "alice@example.com" }, cfg)).toBeNull();
  });

  it("returns null when regex match yields empty string", () => {
    const cfg = { ...baseConfig, usernameRegex: "^()$" };
    expect(extractUsername({ preferred_username: "" }, cfg)).toBeNull();
  });
});

describe("mapOidcError", () => {
  it("OPError(access_denied) → oidc_denied", () => {
    const e = new mocks.OPError("access_denied");
    expect(mapOidcError(e)).toEqual({ code: "oidc_denied" });
  });

  it("OPError(server_error) → oidc_invalid", () => {
    const e = new mocks.OPError("server_error");
    expect(mapOidcError(e)).toEqual({ code: "oidc_invalid" });
  });

  it("OPError(invalid_request) → oidc_invalid", () => {
    const e = new mocks.OPError("invalid_request");
    expect(mapOidcError(e)).toEqual({ code: "oidc_invalid" });
  });

  it("RPError → oidc_token_invalid", () => {
    const e = new mocks.RPError("nonce mismatch");
    expect(mapOidcError(e)).toEqual({ code: "oidc_token_invalid" });
  });

  it("generic Error → oidc_invalid", () => {
    expect(mapOidcError(new Error("boom"))).toEqual({ code: "oidc_invalid" });
  });

  it("non-Error → oidc_invalid", () => {
    expect(mapOidcError("string thrown")).toEqual({ code: "oidc_invalid" });
  });
});

describe("initOidcClient + buildAuthorizationUrl + exchangeCode", () => {
  const cfg = {
    issuer: "https://idp.example.com",
    clientId: "kinetica-bi",
    clientSecret: "secret",
    redirectUri: "https://bi.example.com/api/auth/oidc/callback",
    usernameClaim: "preferred_username",
  };

  beforeEach(() => {
    resetOidcClientForTests();
    mocks.Issuer.discover.mockClear();
    mocks.issuer.Client.mockClear();
    (mocks.client.authorizationUrl as ReturnType<typeof vi.fn>).mockClear();
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockClear();
  });

  it("buildAuthorizationUrl throws before init", () => {
    expect(() => buildAuthorizationUrl("s", "n")).toThrow(/not initialized/);
  });

  it("exchangeCode throws before init", async () => {
    await expect(exchangeCode("c", "s", "n")).rejects.toThrow(/not initialized/);
  });

  it("initOidcClient awaits Issuer.discover with config.issuer", async () => {
    await initOidcClient(cfg);
    expect(mocks.Issuer.discover).toHaveBeenCalledWith("https://idp.example.com");
  });

  it("initOidcClient constructs Client with locked metadata", async () => {
    await initOidcClient(cfg);
    expect(mocks.issuer.Client).toHaveBeenCalledWith({
      client_id: "kinetica-bi",
      client_secret: "secret",
      redirect_uris: ["https://bi.example.com/api/auth/oidc/callback"],
      response_types: ["code"],
      id_token_signed_response_alg: "RS256",
    });
  });

  it("initOidcClient sets clock_tolerance=30 via custom symbol (PITFALLS T-06)", async () => {
    await initOidcClient(cfg);
    expect(mocks.client[mocks.CLOCK_TOLERANCE]).toBe(30);
  });

  it("initOidcClient propagates Issuer.discover rejection (fail-fast SC6)", async () => {
    mocks.Issuer.discover.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(initOidcClient(cfg)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("buildAuthorizationUrl calls client.authorizationUrl with scope='openid profile' and pinned redirect_uri", async () => {
    await initOidcClient(cfg);
    const url = buildAuthorizationUrl("STATE-X", "NONCE-Y");
    expect(mocks.client.authorizationUrl).toHaveBeenCalledWith({
      scope: "openid profile",
      redirect_uri: "https://bi.example.com/api/auth/oidc/callback",
      state: "STATE-X",
      nonce: "NONCE-Y",
    });
    expect(url).toBe("https://idp.example.com/authorize?mock=1");
  });

  it("exchangeCode calls client.callback with redirectUri + {code,state} params + {state,nonce} checks", async () => {
    await initOidcClient(cfg);
    const result = await exchangeCode("AUTH-CODE", "STATE-X", "NONCE-Y");
    expect(mocks.client.callback).toHaveBeenCalledWith(
      "https://bi.example.com/api/auth/oidc/callback",
      { code: "AUTH-CODE", state: "STATE-X" },
      { state: "STATE-X", nonce: "NONCE-Y" }
    );
    expect(result).toEqual({
      accessToken: "mock-access-token",
      idToken: "mock.id.token",
      claims: { sub: "u1", preferred_username: "alice" },
    });
  });

  it("exchangeCode propagates OPError from client.callback", async () => {
    await initOidcClient(cfg);
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new mocks.OPError("invalid_request")
    );
    await expect(exchangeCode("c", "s", "n")).rejects.toBeInstanceOf(mocks.OPError);
  });

  it("exchangeCode propagates RPError from client.callback", async () => {
    await initOidcClient(cfg);
    (mocks.client.callback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new mocks.RPError("nonce mismatch")
    );
    await expect(exchangeCode("c", "s", "n")).rejects.toBeInstanceOf(mocks.RPError);
  });

  it("resetOidcClientForTests clears the singleton", async () => {
    await initOidcClient(cfg);
    resetOidcClientForTests();
    expect(() => buildAuthorizationUrl("s", "n")).toThrow(/not initialized/);
  });
});
