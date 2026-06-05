/**
 * boot.rbacAdminWarning.spec.ts — SCHEMA-V18-03 / ROADMAP success-criterion-4 proof.
 *
 * Verifies that the structured `rbac_bootstrap_admin_warning` boot log is emitted
 * (console.warn) when AUTH_MODE=oidc and APP_ADMIN_USERNAME resolves to the default
 * "admin", and is SUPPRESSED when:
 *   - APP_ADMIN_USERNAME is set to a non-default value (real OIDC admin username), or
 *   - AUTH_MODE=password (default "admin" is correct and must not warn).
 *
 * STANDALONE spec: does NOT depend on the ~106 pre-existing-red shared OIDC mocks
 * ("Issuer is not a constructor"). Defines its own openid-client mock via vi.hoisted()
 * + vi.mock() at the top of the file, exactly like boot.hardening.spec.ts.
 * createApp() is called directly — the bootstrap IIFE that wraps it only runs when
 * NODE_ENV !== "test", so importing index.ts in a test is safe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock for openid-client — self-contained so this spec does NOT depend on the
// ~106 pre-existing-red shared OIDC mocks.
//
// Key difference from the broken shared mocks: oidc.ts calls `new Issuer(meta)` (a class
// constructor call) after `Issuer.discover()`. The shared mocks provide Issuer as a plain
// object { discover } which is not constructable. We make Issuer a real class with a static
// `discover` method AND constructable (returns the mock issuer object), matching oidc.ts
// usage exactly.
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
  // issuer object returned by both Issuer.discover() and new Issuer().
  const issuer = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Client: vi.fn().mockImplementation(function (_metadata: unknown) {
      return client;
    }),
    metadata: { issuer: "https://idp.example.com" },
  };
  // Issuer must be constructable (oidc.ts: `const issuer = new Issuer(meta)`)
  // AND have a static discover() method (oidc.ts: `await Issuer.discover()`).
  class Issuer {
    Client = issuer.Client;
    metadata = issuer.metadata;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_meta: unknown) {}
    static discover = vi.fn().mockResolvedValue(issuer);
  }
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

// Helper: parse console spy calls as JSON, find the first entry with the given event.
// Verbatim from boot.hardening.spec.ts findEvent helper.
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

// Full valid OIDC env vars — satisfies validateOidcEnv() so createApp() reaches the oidc block.
const OIDC_ENV = {
  AUTH_MODE: "oidc",
  AUTH_OIDC_ISSUER_URL: "https://idp.example.com",
  AUTH_OIDC_CLIENT_ID: "kinetica-bi",
  AUTH_OIDC_CLIENT_SECRET: "secret",
  AUTH_OIDC_REDIRECT_URI: "https://bi.example.com/cb",
} as const;

describe("boot rbac_bootstrap_admin_warning (SCHEMA-V18-03 / ROADMAP SC4)", () => {
  beforeEach(() => {
    resetOidcClientForTests();
    bootMocks.Issuer.discover.mockClear();
    bootMocks.Issuer.discover.mockResolvedValue(bootMocks.issuer);
    // Clean sessions table (mirrors boot.hardening.spec.ts beforeEach).
    db.prepare("DELETE FROM sessions").run();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Test 1 (SC4 proof): oidc + default APP_ADMIN_USERNAME → rbac_bootstrap_admin_warning emitted", async () => {
    // Stub full valid OIDC env; do NOT set APP_ADMIN_USERNAME so it resolves to default "admin".
    for (const [k, v] of Object.entries(OIDC_ENV)) {
      vi.stubEnv(k, v);
    }
    // Ensure APP_ADMIN_USERNAME is unset (delete from process.env if present).
    delete process.env.APP_ADMIN_USERNAME;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Suppress console.log noise from oidc_boot + reachability probe.
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const log = findEvent(warnSpy, "rbac_bootstrap_admin_warning");
    expect(log).toBeDefined();
    expect(log!.level).toBe("warn");
    expect(log!.auth_mode).toBe("oidc");
    expect(log!.app_admin_username).toBe("admin");
    expect(String(log!.message)).toMatch(/APP_ADMIN_USERNAME/);
    expect(typeof log!.ts).toBe("string");
  });

  it("Test 1b: oidc + APP_ADMIN_USERNAME='ADMIN' (uppercase) → warning still emitted", async () => {
    for (const [k, v] of Object.entries(OIDC_ENV)) {
      vi.stubEnv(k, v);
    }
    vi.stubEnv("APP_ADMIN_USERNAME", "ADMIN");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const log = findEvent(warnSpy, "rbac_bootstrap_admin_warning");
    expect(log).toBeDefined();
    expect(log!.app_admin_username).toBe("ADMIN");
  });

  it("Test 2 (no false-positive): oidc + APP_ADMIN_USERNAME='alice@corp.com' → warning suppressed", async () => {
    for (const [k, v] of Object.entries(OIDC_ENV)) {
      vi.stubEnv(k, v);
    }
    vi.stubEnv("APP_ADMIN_USERNAME", "alice@corp.com");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const log = findEvent(warnSpy, "rbac_bootstrap_admin_warning");
    expect(log).toBeUndefined();
  });

  it("Test 3 (mode gate): password mode + APP_ADMIN_USERNAME unset → warning NOT emitted", async () => {
    // password mode — the default "admin" is correct and must not warn.
    vi.stubEnv("AUTH_MODE", "password");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
    delete process.env.APP_ADMIN_USERNAME;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const log = findEvent(warnSpy, "rbac_bootstrap_admin_warning");
    expect(log).toBeUndefined();
  });
});
