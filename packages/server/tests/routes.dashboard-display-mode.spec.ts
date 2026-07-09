/**
 * routes.dashboard-display-mode.spec.ts — Plan 106-01 Task 2 supertest coverage.
 *
 * Covers the v1.20 Phase 106 persistence surface for `dashboards.filter_display_mode`
 * (FSET-V120-02, FSET-V120-03) for both AUTH_MODE variants (password + oidc), mirroring
 * routes.dashboard-layers-patch.spec.ts harness shape exactly:
 *   - Hoisted openid-client mock so AUTH_MODE=oidc boot does not network-call.
 *   - buildTestApp() builds a supertest agent against a live createApp().
 *   - createAdminSession() / seedOidcSession() bake the two credential-type variants.
 *   - cleanFixtures() drops sessions + dashboards between tests.
 *
 * There is NO GET /api/dashboards/:id route — dashboards load via GET /api/dashboards
 * (list). Round-trip reads use `.data.find(d => d.id === id)` on that list response.
 *
 * SET-BASED gate (TD-V16-TEST-ISOLATION): this file MUST be fully green in isolation.
 * No fixed whole-suite pass-count is asserted anywhere in this file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
// `Issuer` must function as BOTH a static `discover` namespace AND a constructor
// (oidc.ts:82 does `new Issuer(meta)` to suppress the RFC 9207 iss-check workaround).
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn(),
  };
  // Constructor function so `new Issuer(meta)` works AND `Issuer.discover` resolves.
  function Issuer(this: { metadata: unknown; Client: unknown }, _meta: unknown) {
    this.metadata = { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" };
    this.Client = function (_clientMeta: unknown) {
      return client;
    };
  }
  // Static discover() returns an "issuer instance" with .metadata and .Client.
  (Issuer as unknown as { discover: ReturnType<typeof vi.fn> }).discover = vi
    .fn()
    .mockResolvedValue({
      metadata: { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" },
      Client: function (_clientMeta: unknown) {
        return client;
      },
    });
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
  return { CLOCK_TOLERANCE, client, Issuer, OPError, RPError };
});

vi.mock("openid-client", () => ({
  Issuer: mocks.Issuer,
  custom: { clock_tolerance: mocks.CLOCK_TOLERANCE },
  errors: { OPError: mocks.OPError, RPError: mocks.RPError },
}));

import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

const makeSessionCookie = () => createAdminSession();

// Build a 3-segment JWT with a parseable exp claim for OIDC access_token.
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

const seedOidcSession = (username = "john.doe@kinetica.com") => {
  const sid = createSession({
    username,
    secret: "fake-oidc-access-token",
    kineticaUrl: KINETICA_URL,
    credentialType: "oidc",
    idToken: makeJwt({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const jwtCookie = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${jwtCookie}` };
};

const cleanFixtures = () => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM dashboard_layers");
  db.exec("DELETE FROM dashboard_table_views");
  db.exec("DELETE FROM dashboard_tables");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM dashboards");
};

// ============================================================================
//  dashboards.filter_display_mode — AUTH_MODE=password
// ============================================================================
describe("dashboards.filter_display_mode — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1 (FSET-V120-03): an unconfigured dashboard defaults to 'topbar'", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();

    const createRes = await agent
      .post("/api/dashboards")
      .set("Cookie", cookie)
      .send({ name: "Unconfigured Dashboard" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.filter_display_mode).toBe("topbar");
    const id = createRes.body.id as number;

    const listRes = await agent.get("/api/dashboards").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    const dash = listRes.body.data.find((d: { id: number }) => d.id === id);
    expect(dash).toBeDefined();
    expect(dash.filter_display_mode).toBe("topbar");
  });

  it("Test 2 (FSET-V120-02): PATCH filter_display_mode='panel' round-trips via GET list", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();

    const createRes = await agent
      .post("/api/dashboards")
      .set("Cookie", cookie)
      .send({ name: "Round Trip Dashboard" });
    const id = createRes.body.id as number;

    const patchRes = await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ filter_display_mode: "panel" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.filter_display_mode).toBe("panel");

    const listRes = await agent.get("/api/dashboards").set("Cookie", cookie);
    const dash = listRes.body.data.find((d: { id: number }) => d.id === id);
    expect(dash).toBeDefined();
    expect(dash.filter_display_mode).toBe("panel");
  });

  it("Test 3: PATCH with an invalid mode returns 400 and leaves the mode unchanged", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();

    const createRes = await agent
      .post("/api/dashboards")
      .set("Cookie", cookie)
      .send({ name: "Invalid Mode Dashboard" });
    const id = createRes.body.id as number;

    const badRes = await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ filter_display_mode: "bogus" });
    expect(badRes.status).toBe(400);

    const listRes = await agent.get("/api/dashboards").set("Cookie", cookie);
    const dash = listRes.body.data.find((d: { id: number }) => d.id === id);
    expect(dash.filter_display_mode).toBe("topbar");
  });

  it("Test 4: an unrelated PATCH (no filter_display_mode key) preserves the current mode", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();

    const createRes = await agent
      .post("/api/dashboards")
      .set("Cookie", cookie)
      .send({ name: "Preserve Mode Dashboard" });
    const id = createRes.body.id as number;

    await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ filter_display_mode: "panel" })
      .expect(200);

    const renameRes = await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ name: "renamed" });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.filter_display_mode).toBe("panel");

    const listRes = await agent.get("/api/dashboards").set("Cookie", cookie);
    const dash = listRes.body.data.find((d: { id: number }) => d.id === id);
    expect(dash.name).toBe("renamed");
    expect(dash.filter_display_mode).toBe("panel");
  });
});

// ============================================================================
//  dashboards.filter_display_mode — AUTH_MODE=oidc
// ============================================================================
describe("dashboards.filter_display_mode — AUTH_MODE=oidc", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 5 (oidc smoke): PATCH 'panel' round-trips 200; PATCH invalid value 400", async () => {
    const agent = await buildTestApp();
    // Phase 47 GUARD-V18-05: use bootstrap admin username so requirePermission short-circuits.
    const { cookie } = seedOidcSession(process.env.APP_ADMIN_USERNAME || "admin");

    const createRes = await agent
      .post("/api/dashboards")
      .set("Cookie", cookie)
      .send({ name: "OIDC Dashboard" });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id as number;

    const patchRes = await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ filter_display_mode: "panel" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.filter_display_mode).toBe("panel");

    const badRes = await agent
      .patch(`/api/dashboards/${id}`)
      .set("Cookie", cookie)
      .send({ filter_display_mode: "bogus" });
    expect(badRes.status).toBe(400);
  });
});
