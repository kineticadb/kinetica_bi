/**
 * routes.dashboard-layers-patch.spec.ts — Plan 38-01 Task 2 supertest coverage.
 *
 * Covers PATCH /api/dashboards/:id/layers/:layerId for both AUTH_MODE variants
 * (password + oidc), satisfying SCHEMA-V17-02 (cb_config + track_config PATCH
 * round-trip) and the AUTH_MODE-agnostic spec constraint (TD-V16-TEST-ISOLATION).
 *
 * Mirrors routes.filter-materialize.spec.ts harness shape exactly:
 *   - Hoisted openid-client mock so AUTH_MODE=oidc boot does not network-call.
 *   - buildTestApp() builds a supertest agent against a live createApp().
 *   - makeSessionCookie() / seedOidcSession() bake the two credential-type variants.
 *   - cleanFixtures() drops sessions + dashboard_layers + tables + dashboards.
 *
 * Tests AUTH_MODE=password (full validation matrix — 5 behavior cases) and
 * AUTH_MODE=oidc (one smoke test) per SCHEMA-V17-02 + TD-V16-TEST-ISOLATION lock.
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
import {
  db,
  createDashboard,
  createTable,
  createDashboardLayer,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// Harmless Kinetica success payload — the PATCH route does not hit Kinetica,
// but stubbing global fetch defensively keeps any future requireConfig probe inert.
const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

const seedFixture = (tableName = "nyctaxi", schema = "demo") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  const layer = createDashboardLayer(dash.id, { table_id: tbl.id });
  return { dashId: dash.id, tableId: tbl.id, layerId: layer.id };
};

const makeSessionCookie = () => createAdminSession();

// Build a 3-segment JWT with a parseable exp claim for OIDC access_token.
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

const seedOidcSession = (username = "john.doe@kinetica.com", accessToken?: string) => {
  const token = accessToken ?? FAKE_OIDC_ACCESS_TOKEN;
  const sid = createSession({
    username,
    secret: token,
    kineticaUrl: KINETICA_URL,
    credentialType: "oidc",
    idToken: makeJwt({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const jwtCookie = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${jwtCookie}`, token };
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
//  PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=password
// ============================================================================
describe("PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1: PATCHing cb_config sets it; track_config remains null (key omitted = preserve)", async () => {
    const agent = await buildTestApp();
    const { dashId, layerId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const cbJson = '{"attr":"fare_amount","valsType":"numeric","breaks":[{"value":10,"color":"FF112233"}]}';
    const res = await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ cb_config: cbJson });
    expect(res.status).toBe(200);
    expect(res.body.cb_config).toBe(cbJson);
    expect(res.body.track_config).toBeNull();

    // Round-trip: GET /api/dashboards/:id/layers confirms persistence
    const getRes = await agent
      .get(`/api/dashboards/${dashId}/layers`)
      .set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    const layer = getRes.body.data.find((l: { id: number }) => l.id === layerId);
    expect(layer).toBeDefined();
    expect(layer.cb_config).toBe(cbJson);
    expect(layer.track_config).toBeNull();
  });

  it("Test 2: PATCHing track_config sets it; cb_config remains null (key omitted = preserve)", async () => {
    const agent = await buildTestApp();
    const { dashId, layerId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const trackJson = '{"enabled":true,"trackIdAttr":"TRACKID"}';
    const res = await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ track_config: trackJson });
    expect(res.status).toBe(200);
    expect(res.body.track_config).toBe(trackJson);
    expect(res.body.cb_config).toBeNull();

    // Round-trip via GET
    const getRes = await agent
      .get(`/api/dashboards/${dashId}/layers`)
      .set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    const layer = getRes.body.data.find((l: { id: number }) => l.id === layerId);
    expect(layer.track_config).toBe(trackJson);
    expect(layer.cb_config).toBeNull();
  });

  it("Test 3: PATCHing cb_config with explicit null CLEARS the field (key-in-attrs discriminant)", async () => {
    const agent = await buildTestApp();
    const { dashId, layerId } = seedFixture();
    const { cookie } = makeSessionCookie();

    // First set cb_config to a non-null value
    const cbJson = '{"attr":"x","valsType":"numeric","breaks":[]}';
    await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ cb_config: cbJson })
      .expect(200);

    // Now PATCH with explicit null — should CLEAR
    const clearRes = await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ cb_config: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.cb_config).toBeNull();

    // Round-trip via GET
    const getRes = await agent
      .get(`/api/dashboards/${dashId}/layers`)
      .set("Cookie", cookie);
    const layer = getRes.body.data.find((l: { id: number }) => l.id === layerId);
    expect(layer.cb_config).toBeNull();
  });

  it("Test 5: PATCH without cb_config / track_config in body preserves both existing values", async () => {
    const agent = await buildTestApp();
    const { dashId, layerId } = seedFixture();
    const { cookie } = makeSessionCookie();

    // Set both fields first
    const cbJson = '{"attr":"fare_amount","valsType":"numeric","breaks":[]}';
    const trackJson = '{"enabled":true,"trackIdAttr":"TRACKID"}';
    await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ cb_config: cbJson, track_config: trackJson })
      .expect(200);

    // PATCH only position — cb_config + track_config must be preserved
    const res = await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ position: 5 });
    expect(res.status).toBe(200);
    expect(res.body.cb_config).toBe(cbJson);
    expect(res.body.track_config).toBe(trackJson);

    // Round-trip via GET
    const getRes = await agent
      .get(`/api/dashboards/${dashId}/layers`)
      .set("Cookie", cookie);
    const layer = getRes.body.data.find((l: { id: number }) => l.id === layerId);
    expect(layer.cb_config).toBe(cbJson);
    expect(layer.track_config).toBe(trackJson);
  });
});

// ============================================================================
//  PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=oidc
// ============================================================================
describe("PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=oidc", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 4 (oidc smoke): PATCHing cb_config round-trips correctly under OIDC credentials", async () => {
    const agent = await buildTestApp();
    const { dashId, layerId } = seedFixture();
    // Phase 47 GUARD-V18-05: use bootstrap admin username so requirePermission short-circuits.
    const { cookie } = seedOidcSession(process.env.APP_ADMIN_USERNAME || "admin");
    const cbJson = '{"attr":"fare_amount","valsType":"numeric","breaks":[{"value":10,"color":"FF112233"}]}';
    const res = await agent
      .patch(`/api/dashboards/${dashId}/layers/${layerId}`)
      .set("Cookie", cookie)
      .send({ cb_config: cbJson });
    expect(res.status).toBe(200);
    expect(res.body.cb_config).toBe(cbJson);
    expect(res.body.track_config).toBeNull();

    // Round-trip via GET
    const getRes = await agent
      .get(`/api/dashboards/${dashId}/layers`)
      .set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    const layer = getRes.body.data.find((l: { id: number }) => l.id === layerId);
    expect(layer).toBeDefined();
    expect(layer.cb_config).toBe(cbJson);
    expect(layer.track_config).toBeNull();
  });
});
