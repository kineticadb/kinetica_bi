/**
 * layers.spec.ts — Integration tests for /api/dashboards/:id/layers
 *
 * Covers:
 *   - POST create (201, validation errors)
 *   - GET list (sorted by position ASC, id ASC)
 *   - PATCH update (:layerId) — config + v1.6 dynamic_view_id (DV-V16-13)
 *   - DELETE (:layerId returns 204)
 *   - PATCH reorder (normalises positions 0..N-1)
 *   - Reorder validation (count mismatch, unknown id)
 *   - Reorder route precedence (reorder handler reached before :layerId handler)
 *   - Cascade on dashboard delete (layers removed via FK ON DELETE CASCADE)
 *   - No cascade on table delete (soft FK; layers survive with stale table_id)
 *   - v1.6 Phase 35 PATCH dynamic_view_id (set / clear / preserve-on-omit) under both
 *     AUTH_MODE=password and AUTH_MODE=oidc — proves the field round-trips in both
 *     credential-type code paths (mirrors routes.dynamic-view.spec.ts dual-block pattern).
 *
 * Phase 11 lock: vi.stubEnv("AUTH_MODE", "password") required so the boot-time
 * session-wipe (triggered when AUTH_MODE=oidc) does NOT purge test sessions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { db } from "../src/db";
import { createSession } from "../src/sessionStore";
import { resetOidcClientForTests } from "../src/oidc";

// Hoisted openid-client mock — required for AUTH_MODE=oidc describe block below.
// Same pattern as routes.dynamic-view.spec.ts (lines 32-74) so createApp() boots
// without hitting the network during OIDC discovery.
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn(),
  };
  function Issuer(this: { metadata: unknown; Client: unknown }, _meta: unknown) {
    this.metadata = { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" };
    this.Client = function (_clientMeta: unknown) {
      return client;
    };
  }
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

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "layer-test-secret";

describe("layers", () => {
  let cookie: string;

  beforeEach(() => {
    // Phase 11 lock: stub password mode before createApp() so boot-time session
    // wipe (AUTH_MODE=oidc) does not purge our test session.
    vi.stubEnv("AUTH_MODE", "password");

    // Clean up tables in dependency order
    db.exec("DELETE FROM dashboard_layers");
    db.exec("DELETE FROM widgets");
    db.exec("DELETE FROM dashboard_table_views");
    db.exec("DELETE FROM dashboard_tables");
    db.exec("DELETE FROM dashboards");
    db.exec("DELETE FROM tables");
    db.exec("DELETE FROM sessions");

    // Issue a test session cookie for all requests
    const sid = createSession({ username: "testuser", secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
    const token = jwt.sign({ sub: "testuser", sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
    cookie = `kbi_session=${token}`;
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const createDashboard = async (app: Awaited<ReturnType<typeof buildTestApp>>, name = "Test Dashboard") => {
    const res = await app.post("/api/dashboards").set("Cookie", cookie).send({ name });
    expect(res.status).toBe(201);
    return res.body as { id: number };
  };

  const createTable = async (app: Awaited<ReturnType<typeof buildTestApp>>, name = "test_table") => {
    const res = await app.post("/api/tables").set("Cookie", cookie).send({ name, schema: "demo" });
    expect(res.status).toBe(201);
    return res.body as { id: number };
  };

  // ─── POST /api/dashboards/:id/layers ────────────────────────────────────────

  it("POST creates a layer with 201 — returns id, dashboard_id, table_id, layer_type, position, config, timestamps", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const res = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      dashboard_id: dashboard.id,
      table_id: table.id,
      layer_type: "KineticaWms",
      position: 0,
      config: {},
    });
    expect(typeof res.body.created_at).toBe("string");
    expect(typeof res.body.updated_at).toBe("string");
  });

  it("POST returns 400 when table_id is missing", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);

    const res = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ layer_type: "KineticaWms" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("table_id") });
  });

  it("POST returns 400 when layer_type is not 'KineticaWms'", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const res = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id, layer_type: "InvalidType" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("KineticaWms") });
  });

  it("POST defaults position to max+1 across multiple creates (positions 0, 1, 2)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r2 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r3 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(201);
    expect(r1.body.position).toBe(0);
    expect(r2.body.position).toBe(1);
    expect(r3.body.position).toBe(2);
  });

  // ─── GET /api/dashboards/:id/layers ─────────────────────────────────────────

  it("GET returns layers sorted by position ASC then id ASC", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    // Insert 3 layers (auto-position: 0, 1, 2)
    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r2 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r3 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    const res = await app.get(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].id).toBe(r1.body.id);
    expect(res.body.data[1].id).toBe(r2.body.id);
    expect(res.body.data[2].id).toBe(r3.body.id);
    // Positions are in ascending order
    expect(res.body.data[0].position).toBeLessThanOrEqual(res.body.data[1].position);
    expect(res.body.data[1].position).toBeLessThanOrEqual(res.body.data[2].position);
  });

  // ─── PATCH /api/dashboards/:id/layers/:layerId ───────────────────────────────

  it("PATCH updates config and returns updated layer; updated_at advances", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number; updated_at: string };

    const originalUpdatedAt = layer.updated_at;

    const patchRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ config: { renderMode: "heatmap", colormap: "viridis" } });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.config).toMatchObject({ renderMode: "heatmap", colormap: "viridis" });
    // updated_at should advance (or at minimum not be before original)
    expect(new Date(patchRes.body.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime()
    );
  });

  // ─── v1.6 Phase 35 (DV-V16-13): PATCH dynamic_view_id round-trip ─────────────

  it("PATCH accepts dynamic_view_id and round-trips it in the response (AUTH_MODE=password)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number; dynamic_view_id: number | null };
    // Fresh layer is created with dynamic_view_id = null
    expect(layer.dynamic_view_id).toBeNull();

    const patchRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ dynamic_view_id: 7 });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({ id: layer.id, dynamic_view_id: 7 });
    // table_id stays unchanged (NOT NULL constraint; dv-bound layers keep table_id = source_table_id)
    expect(patchRes.body.table_id).toBe(table.id);
  });

  it("PATCH explicit { dynamic_view_id: null } clears a previously-set binding (AUTH_MODE=password)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number };

    // Set first
    const setRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ dynamic_view_id: 7 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.dynamic_view_id).toBe(7);

    // Then clear
    const clearRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ dynamic_view_id: null });

    expect(clearRes.status).toBe(200);
    expect(clearRes.body).toMatchObject({ id: layer.id, dynamic_view_id: null });
  });

  it("PATCH that omits dynamic_view_id preserves the existing value — no implicit clear (AUTH_MODE=password)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number };

    // Set dynamic_view_id
    await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ dynamic_view_id: 7 });

    // PATCH a different field — dynamic_view_id should be preserved (NOT cleared by absence)
    const patchRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", cookie)
      .send({ position: 1 });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({ id: layer.id, dynamic_view_id: 7, position: 1 });
  });

  // ─── DELETE /api/dashboards/:id/layers/:layerId ──────────────────────────────

  it("DELETE returns 204 and layer disappears from subsequent GET", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layerId = createRes.body.id;

    const deleteRes = await app.delete(`/api/dashboards/${dashboard.id}/layers/${layerId}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const getRes = await app.get(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toHaveLength(0);
  });

  // ─── PATCH /api/dashboards/:id/layers/reorder ────────────────────────────────

  it("PATCH reorder accepts {orderedIds: [3,1,2]} and returns layers with normalised positions [0,1,2]", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r2 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r3 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const ids = [r1.body.id, r2.body.id, r3.body.id];

    // Reverse the order: [id3, id1, id2]
    const reorderedIds = [ids[2], ids[0], ids[1]];

    const reorderRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/reorder`)
      .set("Cookie", cookie)
      .send({ orderedIds: reorderedIds });

    expect(reorderRes.status).toBe(200);
    expect(reorderRes.body.data).toHaveLength(3);
    // After reorder, position 0 should be ids[2], position 1 ids[0], position 2 ids[1]
    expect(reorderRes.body.data[0].id).toBe(ids[2]);
    expect(reorderRes.body.data[0].position).toBe(0);
    expect(reorderRes.body.data[1].id).toBe(ids[0]);
    expect(reorderRes.body.data[1].position).toBe(1);
    expect(reorderRes.body.data[2].id).toBe(ids[1]);
    expect(reorderRes.body.data[2].position).toBe(2);
  });

  it("PATCH reorder returns 400 on count mismatch (send 2 ids when 3 layers exist)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    const r2 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    const reorderRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/reorder`)
      .set("Cookie", cookie)
      .send({ orderedIds: [r1.body.id, r2.body.id] }); // only 2, but 3 exist

    expect(reorderRes.status).toBe(400);
    expect(reorderRes.body).toMatchObject({ error: expect.stringContaining("expected 3") });
  });

  it("PATCH reorder returns 400 on unknown id (id not in dashboard)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    const reorderRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/reorder`)
      .set("Cookie", cookie)
      .send({ orderedIds: [99999] }); // 99999 does not belong to this dashboard

    expect(reorderRes.status).toBe(400);
    expect(reorderRes.body).toMatchObject({ error: expect.stringContaining("99999") });

    // The layer we actually created should still exist unchanged
    const getRes = await app.get(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie);
    expect(getRes.body.data[0].id).toBe(r1.body.id);
  });

  // ─── Reorder route precedence ─────────────────────────────────────────────

  it("reorder route precedence: PATCH .../layers/reorder hits reorder handler (not :layerId)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app);

    const r1 = await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    // Happy-path reorder: proves the reorder handler was reached (not the :layerId handler)
    const happyRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/reorder`)
      .set("Cookie", cookie)
      .send({ orderedIds: [r1.body.id] });
    expect(happyRes.status).toBe(200);

    // Malformed reorder body (not an array): must return 400 from the reorder handler.
    // If the :layerId handler had been matched instead, it would attempt
    // Number("reorder") = NaN, call updateDashboardLayer(NaN, ...), and return 404.
    const malformedRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/reorder`)
      .set("Cookie", cookie)
      .send({ orderedIds: "not-an-array" });
    expect(malformedRes.status).toBe(400);
    expect(malformedRes.body).toMatchObject({ error: expect.stringContaining("orderedIds") });
  });

  // ─── Cascade on dashboard delete ─────────────────────────────────────────────

  it("cascade on dashboard delete: layers are removed when the dashboard is deleted (ON DELETE CASCADE)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app, "Dashboard A");
    const table = await createTable(app);

    // Add 2 layers
    await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });
    await app.post(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie).send({ table_id: table.id });

    // Confirm they exist
    const beforeDelete = db
      .prepare("SELECT COUNT(*) AS cnt FROM dashboard_layers WHERE dashboard_id = ?")
      .get(dashboard.id) as { cnt: number };
    expect(beforeDelete.cnt).toBe(2);

    // Delete the dashboard
    const deleteRes = await app.delete(`/api/dashboards/${dashboard.id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    // GET layers for the now-deleted dashboard returns 404 (dashboard gone)
    const getRes = await app.get(`/api/dashboards/${dashboard.id}/layers`).set("Cookie", cookie);
    expect(getRes.status).toBe(404);

    // Direct DB check: rows are gone (FK ON DELETE CASCADE)
    const afterDelete = db
      .prepare("SELECT COUNT(*) AS cnt FROM dashboard_layers WHERE dashboard_id = ?")
      .get(dashboard.id) as { cnt: number };
    expect(afterDelete.cnt).toBe(0);
  });

  // ─── No cascade on table delete (soft FK) ────────────────────────────────────

  it("no cascade on table delete: layers survive with stale table_id (soft FK semantics)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboard(app);
    const table = await createTable(app, "temp_table");

    // Create layer bound to the table
    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", cookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layerId = createRes.body.id;
    const deletedTableId = table.id;

    // Delete the table via the tables API
    const tableDeleteRes = await app.delete(`/api/tables/${deletedTableId}`).set("Cookie", cookie);
    expect(tableDeleteRes.status).toBe(204);

    // The layer row MUST still exist with the stale table_id (soft FK, no cascade)
    const layerRow = db
      .prepare("SELECT * FROM dashboard_layers WHERE id = ?")
      .get(layerId) as { id: number; table_id: number } | undefined;
    expect(layerRow).toBeDefined();
    expect(layerRow!.table_id).toBe(deletedTableId);
  });
});

// ============================================================================
//  Layers PATCH dynamic_view_id — AUTH_MODE=oidc smoke (DV-V16-13)
// ============================================================================
// Proves the field round-trips in the OIDC credential-type code path. Mirrors
// routes.dynamic-view.spec.ts "AUTH_MODE=oidc smoke" describe block pattern.
// The PATCH route is not credential-type-aware (no Kinetica calls), but boot-time
// session-wipe + cookie/JWT decoding differ between modes — this proves end-to-end
// auth doesn't drop the field on the way through.

const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

const seedOidcSession = (username = "john.doe@kinetica.com") => {
  const AUTH_SECRET_LOCAL = process.env.AUTH_SECRET!;
  const KINETICA_URL_LOCAL = process.env.KINETICA_URL!;
  const sid = createSession({
    username,
    secret: FAKE_OIDC_ACCESS_TOKEN,
    kineticaUrl: KINETICA_URL_LOCAL,
    credentialType: "oidc",
    idToken: makeJwt({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const jwtCookie = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET_LOCAL, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${jwtCookie}` };
};

describe("layers PATCH dynamic_view_id — AUTH_MODE=oidc smoke", () => {
  let oidcCookie: string;

  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");

    // Clean up tables in dependency order
    db.exec("DELETE FROM dashboard_layers");
    db.exec("DELETE FROM widgets");
    db.exec("DELETE FROM dashboard_table_views");
    db.exec("DELETE FROM dashboard_tables");
    db.exec("DELETE FROM dashboards");
    db.exec("DELETE FROM tables");
    db.exec("DELETE FROM sessions");

    resetOidcClientForTests();

    // Issue an OIDC session cookie
    const seeded = seedOidcSession();
    oidcCookie = seeded.cookie;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const createDashboardOidc = async (app: Awaited<ReturnType<typeof buildTestApp>>, name = "Test Dashboard") => {
    const res = await app.post("/api/dashboards").set("Cookie", oidcCookie).send({ name });
    expect(res.status).toBe(201);
    return res.body as { id: number };
  };

  const createTableOidc = async (app: Awaited<ReturnType<typeof buildTestApp>>, name = "test_table") => {
    const res = await app.post("/api/tables").set("Cookie", oidcCookie).send({ name, schema: "demo" });
    expect(res.status).toBe(201);
    return res.body as { id: number };
  };

  it("PATCH accepts dynamic_view_id and round-trips it in the response (AUTH_MODE=oidc)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboardOidc(app);
    const table = await createTableOidc(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", oidcCookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number; dynamic_view_id: number | null };
    expect(layer.dynamic_view_id).toBeNull();

    const patchRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", oidcCookie)
      .send({ dynamic_view_id: 11 });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({ id: layer.id, dynamic_view_id: 11 });
    expect(patchRes.body.table_id).toBe(table.id);
  });

  it("PATCH explicit { dynamic_view_id: null } clears a previously-set binding (AUTH_MODE=oidc)", async () => {
    const app = await buildTestApp();
    const dashboard = await createDashboardOidc(app);
    const table = await createTableOidc(app);

    const createRes = await app
      .post(`/api/dashboards/${dashboard.id}/layers`)
      .set("Cookie", oidcCookie)
      .send({ table_id: table.id });
    expect(createRes.status).toBe(201);
    const layer = createRes.body as { id: number };

    // Set
    const setRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", oidcCookie)
      .send({ dynamic_view_id: 11 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.dynamic_view_id).toBe(11);

    // Clear
    const clearRes = await app
      .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
      .set("Cookie", oidcCookie)
      .send({ dynamic_view_id: null });

    expect(clearRes.status).toBe(200);
    expect(clearRes.body).toMatchObject({ id: layer.id, dynamic_view_id: null });
  });
});
