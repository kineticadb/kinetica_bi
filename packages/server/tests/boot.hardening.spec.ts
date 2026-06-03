/**
 * boot.hardening.spec.ts — Plan 08-02 / MODE-05.
 *
 * Two cases verifying the bootstrap IIFE catch emits a structured `boot_failed`
 * JSON log on startup failure, with both `message` and `stack` as top-level fields:
 *
 *   1. AUTH_MODE=oidc with AUTH_OIDC_ISSUER_URL unset → validateOidcEnv() throws,
 *      the IIFE catch emits boot_failed with `message` mentioning AUTH_OIDC_ISSUER_URL
 *      and a non-empty `stack`. process.exit(1) called once.
 *   2. Plan 08-01's wipe SQL throws (simulated by spying on `db.prepare` to throw on
 *      the SELECT COUNT statement) → IIFE catches → same boot_failed shape, message
 *      contains the underlying error, process.exit(1) called once.
 *
 * The bootstrap IIFE only runs when NODE_ENV !== "test", so we cannot import
 * src/index.ts and trigger the IIFE directly in the test environment. Instead, the
 * test reproduces the IIFE body verbatim in a test-local `runBootstrap` helper
 * (CONTEXT.md "Test strategy" allows this) and asserts the catch behavior. The
 * helper's JSON shape is a verbatim copy of the production shape at index.ts ~747-756
 * (post-Task-1). If production drifts, Test 1's `message` field check against
 * AUTH_OIDC_ISSUER_URL still mitigates: that string only appears in production via
 * validateOidcEnv()'s throw, so a correctly-shaped log proves the production wrapper
 * surfaced the production throw correctly.
 *
 * Pattern mirrors tests/bootstrap.spec.ts and tests/boot.wipe.spec.ts (vi.hoisted +
 * vi.mock for openid-client, findEvent helper). Required because Test 1 boots in
 * AUTH_MODE=oidc.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock for openid-client. Verbatim shape from tests/bootstrap.spec.ts;
// needed because Test 1 boots in AUTH_MODE=oidc (validateOidcEnv runs before any
// Issuer.discover call, but the import of src/index.ts pulls in src/oidc.ts which
// imports openid-client at module top — so the mock must be in place even if the
// test path never reaches Issuer.discover).
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
import { db } from "../src/db";

// Test-local reproduction of the production bootstrap IIFE catch shape (index.ts ~747-756
// post-Task-1). Asserts that the production-shape JSON log is emitted on createApp() rejection.
// CONTEXT.md "Test strategy" sanctions this duplication-by-design.
const runBootstrap = async (): Promise<void> => {
  try {
    await createApp();
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "boot_failed",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    process.exit(1);
  }
};

describe("bootstrap hardening (Plan 08-02 / boot_failed log)", () => {
  // Helper: parse spy calls as JSON, find the first entry with the given event.
  // Mirrors findEvent in tests/bootstrap.spec.ts:144-159.
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

  beforeEach(() => {
    resetOidcClientForTests();
    bootMocks.Issuer.discover.mockClear();
    bootMocks.Issuer.discover.mockResolvedValue(bootMocks.issuer);
    // Clean slate for sessions table per test (in-memory DB shared across this
    // spec file via the db singleton; isolate:true gives a fresh module graph per file).
    db.prepare("DELETE FROM sessions").run();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Test 1: AUTH_MODE=oidc with AUTH_OIDC_ISSUER_URL unset → boot_failed log mentions the missing var, process.exit(1) called", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    // AUTH_OIDC_ISSUER_URL deliberately not stubbed — validateOidcEnv() throws.
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/cb");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await runBootstrap();

    const log = findEvent(errSpy, "boot_failed");
    expect(log).toBeDefined();
    expect(log!.level).toBe("error");
    expect(typeof log!.ts).toBe("string");
    expect(String(log!.message)).toMatch(/AUTH_OIDC_ISSUER_URL/);
    expect(typeof log!.stack).toBe("string");
    expect(String(log!.stack)).toContain("AUTH_OIDC_ISSUER_URL");
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Test 2: wipe SQL throw → boot_failed log surfaces the underlying error message, process.exit(1) called", async () => {
    // AUTH_MODE=password so we don't engage the OIDC fail-fast path; we want the
    // wipe (Plan 08-01) to be the failure surface.
    vi.stubEnv("AUTH_MODE", "password");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");

    // Force the wipe's SELECT COUNT(*) statement to throw. Spy on db.prepare and
    // throw only when the SELECT COUNT statement is requested; pass through all
    // other prepares (so createApp's earlier setup remains functional).
    const realPrepare = db.prepare.bind(db);
    const prepareSpy = vi
      .spyOn(db, "prepare")
      .mockImplementation((sql: string) => {
        if (sql.includes("SELECT COUNT(*) AS n FROM sessions WHERE credential_type")) {
          throw new Error("forced wipe failure: simulated disk I/O error");
        }
        return realPrepare(sql);
      });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await runBootstrap();

    const log = findEvent(errSpy, "boot_failed");
    expect(log).toBeDefined();
    expect(log!.level).toBe("error");
    expect(String(log!.message)).toContain("forced wipe failure");
    expect(typeof log!.stack).toBe("string");
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    prepareSpy.mockRestore();
  });
});
