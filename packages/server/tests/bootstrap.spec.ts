import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Hoisted mock for AUTH_MODE=oidc fail-fast tests.
const bootMocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const tokenSet = {
    access_token: "x",
    id_token: "y",
    token_type: "Bearer",
    expires_in: 3600,
    claims: () => ({ sub: "u", preferred_username: "alice" }),
  };
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn().mockResolvedValue(tokenSet),
  };
  const issuer = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Client: vi.fn().mockImplementation(function (_metadata: unknown) {
      return client;
    }),
    metadata: { issuer: "https://idp.example.com" },
  };
  const Issuer = { discover: vi.fn().mockResolvedValue(issuer) };
  class OPError extends Error {
    error: string;
    constructor(error: string) {
      super(error);
      this.name = "OPError";
      this.error = error;
    }
  }
  class RPError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "RPError";
    }
  }
  return { CLOCK_TOLERANCE, client, issuer, Issuer, OPError, RPError };
});

vi.mock("openid-client", () => ({
  Issuer: bootMocks.Issuer,
  custom: { clock_tolerance: bootMocks.CLOCK_TOLERANCE },
  errors: { OPError: bootMocks.OPError, RPError: bootMocks.RPError },
}));

import { createApp } from "../src/index";
import { resetOidcClientForTests } from "../src/oidc";

describe("bootstrap gate (Phase 3 EADDRINUSE regression)", () => {
  it("wraps both app.listen() AND startSessionSweep() in a NODE_ENV !== 'test' gate", () => {
    const src = readFileSync(
      resolve(__dirname, "../src/index.ts"),
      "utf-8"
    );
    // The regex demands: an `if (process.env.NODE_ENV !== "test") { ... }` block whose body
    // contains BOTH `app.listen` and `startSessionSweep()`. Order doesn't matter; the body
    // captures everything until the matching closing brace at the same indent.
    const gateRegex =
      /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*"test"\s*\)\s*\{[\s\S]*?app\.listen[\s\S]*?startSessionSweep\(\)[\s\S]*?\}/;
    expect(gateRegex.test(src)).toBe(true);
  });

  it.skip("does NOT call app.listen or startSessionSweep when NODE_ENV === 'test' (runtime check)", async () => {
    // Skipped by default — vi.doMock + resetModules + dynamic import is fragile in this codebase
    // because tests/helpers/app.ts has already imported src/index in other specs. The structural
    // test above is the reliable regression check. This test is left as documentation of intent.
    expect(process.env.NODE_ENV).toBe("test");
    const sweepMock = vi.fn();
    vi.doMock("../src/sessionStore", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/sessionStore")>();
      return { ...actual, startSessionSweep: sweepMock };
    });
    const http = await import("node:http");
    const listenSpy = vi.spyOn(http.Server.prototype, "listen");
    try {
      vi.resetModules();
      await import("../src/index");
    } finally {
      listenSpy.mockRestore();
    }
    expect(sweepMock).not.toHaveBeenCalled();
    expect(listenSpy).not.toHaveBeenCalled();
  });
});

// Plan 05-04: AUTH_MODE=oidc fail-fast tests (Phase 5 SC6).
describe("createApp boot fail-fast in AUTH_MODE=oidc", () => {
  beforeEach(() => {
    resetOidcClientForTests();
    bootMocks.Issuer.discover.mockClear();
    // Default: discovery resolves successfully (each test overrides as needed)
    bootMocks.Issuer.discover.mockResolvedValue(bootMocks.issuer);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when AUTH_MODE=oidc and AUTH_OIDC_ISSUER_URL is missing (validateOidcEnv)", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    // AUTH_OIDC_ISSUER_URL deliberately not set
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    await expect(createApp()).rejects.toThrow(/AUTH_OIDC_ISSUER_URL is required/);
  });

  it("throws when Issuer.discover rejects (initOidcClient — SC6)", async () => {
    bootMocks.Issuer.discover.mockRejectedValueOnce(
      new Error("getaddrinfo ENOTFOUND idp.example.com")
    );
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    await expect(createApp()).rejects.toThrow(/ENOTFOUND/);
  });

  it("throws when AUTH_MODE is neither 'password' nor 'oidc'", async () => {
    vi.stubEnv("AUTH_MODE", "saml");
    await expect(createApp()).rejects.toThrow(/AUTH_MODE must be 'password' or 'oidc'/);
  });
});

// Plan 06-03: oidc_boot structured log + unauthenticated /version reachability probe.
// CONTEXT.md "Kinetica trust boot signal (PITFALL I-06)": OIDC mode only; fire-and-forget
// probe; warn-and-continue on failure; no fail-fast.
describe("oidc boot probe (Plan 06-03)", () => {
  const stubOidcEnv = () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
  };

  // Helper: parse spy calls as JSON, find the first entry with the given event.
  const findEvent = (
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

  // Helper: wait for fire-and-forget probe to settle (one microtask + one macrotask).
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(() => {
    resetOidcClientForTests();
    bootMocks.Issuer.discover.mockClear();
    bootMocks.Issuer.discover.mockResolvedValue(bootMocks.issuer);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Test 1: emits one structured oidc_boot log in OIDC mode (issuer + audience)", async () => {
    stubOidcEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await createApp();
    await flush();
    const bootLog = findEvent(logSpy, "oidc_boot");
    expect(bootLog).toBeDefined();
    expect(bootLog!.issuer).toBe("https://idp.example.com");
    expect(bootLog!.audience).toBe("kinetica-bi");
    expect(bootLog!.level).toBe("info");
    expect(bootLog!.message).toContain("Kinetica must be configured to trust tokens");
  });

  it("Test 2: fires fire-and-forget unauthenticated GET /version in OIDC mode", async () => {
    stubOidcEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await createApp();
    await flush();
    const versionCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/version")
    );
    expect(versionCalls.length).toBe(1);
    // No init / no Authorization header on the probe (it's unauthenticated).
    const init = versionCalls[0][1] as RequestInit | undefined;
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      expect(h.Authorization).toBeUndefined();
      expect(h.authorization).toBeUndefined();
    }
  });

  it("Test 3: rejected probe → kinetica_unreachable warn + createApp still resolves", async () => {
    stubOidcEnv();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(createApp()).resolves.toBeDefined();
    await flush();
    const warnLog = findEvent(warnSpy, "kinetica_unreachable");
    expect(warnLog).toBeDefined();
    expect(warnLog!.url).toContain("/version");
    expect(warnLog!.status).toBe(0);
  });

  it("Test 4: non-2xx probe → kinetica_unreachable warn with status 503", async () => {
    stubOidcEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createApp();
    await flush();
    const warnLog = findEvent(warnSpy, "kinetica_unreachable");
    expect(warnLog).toBeDefined();
    expect(warnLog!.status).toBe(503);
  });

  it("Test 5: password mode emits NO oidc_boot log", async () => {
    vi.stubEnv("AUTH_MODE", "password");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await createApp();
    await flush();
    const bootLog = findEvent(logSpy, "oidc_boot");
    expect(bootLog).toBeUndefined();
  });

  it("Test 6: password mode fires NO /version probe", async () => {
    vi.stubEnv("AUTH_MODE", "password");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await createApp();
    await flush();
    const versionCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/version")
    );
    expect(versionCalls.length).toBe(0);
  });
});
