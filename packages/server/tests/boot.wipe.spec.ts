/**
 * boot.wipe.spec.ts — Plan 08-01 / MODE-05.
 *
 * Three cases covering the boot-time AUTH_MODE-change session wipe in createApp():
 *   1. AUTH_MODE=oidc with a credential_type='password' row → row deleted, log emitted.
 *   2. AUTH_MODE=password with a credential_type='oidc' row → row deleted, log emitted.
 *   3. AUTH_MODE=oidc with only credential_type='oidc' rows → NO log, table unchanged.
 *
 * The wipe runs unconditionally in BOTH modes inside a single db.transaction(),
 * deletes only contradicting-type rows (never full-table), and emits a structured
 * auth_mode_change_wipe JSON one-liner only when deleted > 0 (silent no-op).
 *
 * Pattern mirrors tests/bootstrap.spec.ts (vi.hoisted + vi.mock for openid-client,
 * findEvent helper, stubOidcEnv helper) — Test 1 boots in OIDC mode and would
 * otherwise call the real Issuer.discover().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock for openid-client. Verbatim shape from tests/bootstrap.spec.ts;
// needed because Test 1 + Test 3 boot in AUTH_MODE=oidc and createApp() will
// call Issuer.discover() before reaching app.listen().
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
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";

describe("AUTH_MODE-change session wipe (Plan 08-01 / MODE-05)", () => {
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

  // Helper: stub the full AUTH_OIDC_* env block needed for AUTH_MODE=oidc boot.
  const stubOidcEnv = () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
  };

  beforeEach(() => {
    resetOidcClientForTests();
    bootMocks.Issuer.discover.mockClear();
    bootMocks.Issuer.discover.mockResolvedValue(bootMocks.issuer);
    // Clean slate for sessions table per test (in-memory DB shared across this spec
    // file via the db singleton; isolate:true gives us a fresh module graph per file).
    db.prepare("DELETE FROM sessions").run();
    // Stub fetch so the Phase 6 /version probe doesn't hit the network when we boot
    // in OIDC mode. Resolves OK so no kinetica_unreachable warn fires.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Test 1: AUTH_MODE=oidc with a credential_type='password' row → row deleted, log from='password' to='oidc' deleted=1", async () => {
    // Seed a password-mode row (the contradicting type for an oidc boot).
    createSession({
      username: "alice",
      secret: "hunter2",
      kineticaUrl: "https://kinetica.example.com",
      credentialType: "password",
    });
    expect(
      (db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE credential_type = 'password'")
        .get() as { n: number }).n
    ).toBe(1);

    stubOidcEnv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const wipeLog = findEvent(logSpy, "auth_mode_change_wipe");
    expect(wipeLog).toBeDefined();
    expect(wipeLog!.from).toBe("password");
    expect(wipeLog!.to).toBe("oidc");
    expect(wipeLog!.deleted).toBe(1);
    expect(wipeLog!.level).toBe("info");
    expect(typeof wipeLog!.ts).toBe("string");

    // Row count for the contradicting type should now be zero.
    const remaining = (
      db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE credential_type = 'password'")
        .get() as { n: number }
    ).n;
    expect(remaining).toBe(0);
  });

  it("Test 2: AUTH_MODE=password with a credential_type='oidc' row → row deleted, log from='oidc' to='password' deleted=1", async () => {
    // Seed an oidc-mode row (the contradicting type for a password boot).
    createSession({
      username: "bob",
      secret: "header.payload.sig",
      kineticaUrl: "https://kinetica.example.com",
      credentialType: "oidc",
      idToken: "header.payload.sig",
    });
    expect(
      (db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE credential_type = 'oidc'")
        .get() as { n: number }).n
    ).toBe(1);

    vi.stubEnv("AUTH_MODE", "password");
    vi.stubEnv("KINETICA_URL", "https://kinetica.example.com");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    const wipeLog = findEvent(logSpy, "auth_mode_change_wipe");
    expect(wipeLog).toBeDefined();
    expect(wipeLog!.from).toBe("oidc");
    expect(wipeLog!.to).toBe("password");
    expect(wipeLog!.deleted).toBe(1);
    expect(wipeLog!.level).toBe("info");

    const remaining = (
      db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE credential_type = 'oidc'")
        .get() as { n: number }
    ).n;
    expect(remaining).toBe(0);
  });

  it("Test 3: AUTH_MODE=oidc with only credential_type='oidc' rows → no log, sessions table unchanged (silent no-op)", async () => {
    // Seed two oidc-mode rows; both match the booting mode → no contradicting rows.
    createSession({
      username: "carol",
      secret: "tok-carol",
      kineticaUrl: "https://kinetica.example.com",
      credentialType: "oidc",
    });
    createSession({
      username: "dave",
      secret: "tok-dave",
      kineticaUrl: "https://kinetica.example.com",
      credentialType: "oidc",
    });
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n
    ).toBe(2);

    stubOidcEnv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createApp();

    // Silent no-op: no auth_mode_change_wipe event emitted at all.
    const wipeLog = findEvent(logSpy, "auth_mode_change_wipe");
    expect(wipeLog).toBeUndefined();

    // Table is unchanged — both rows still present.
    const total = (
      db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
    ).n;
    expect(total).toBe(2);
  });
});
