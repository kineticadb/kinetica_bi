/**
 * routes.dynamic-view-crud.spec.ts — Phase 32 Plan 02 supertest coverage.
 *
 * Covers all three dynamic-view CRUD endpoints introduced by Plan 02:
 *   - GET  /api/dashboards/:dashboardId/dynamic-views
 *   - POST /api/dashboards/:dashboardId/dynamic-views
 *   - PUT  /api/dynamic-views/:id
 *
 * Mirrors routes.filter-materialize.spec.ts harness shape:
 *   - Hoisted openid-client mock so AUTH_MODE=oidc boot does not hit the network.
 *   - buildTestApp() builds a supertest agent against a live createApp().
 *   - makeSessionCookie() / seedOidcSession() bake the two credential-type variants.
 *   - cleanFixtures() drops sessions + dashboard_dynamic_views + the v1.3 fixture tables.
 *
 * Tests both AUTH_MODE=password (full validation matrix) and AUTH_MODE=oidc
 * (one happy-path smoke per route) per DV-V16-01 requirement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
// Same shape as routes.filter-materialize.spec.ts — `Issuer` is both a constructor
// AND a namespace exposing a static `discover` method.
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

import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { createAdminSession } from "./helpers/db";
import { resetOidcClientForTests } from "../src/oidc";
import {
  db,
  createDashboard,
  createTable,
  createDashboardDynamicView,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// Harmless Kinetica success payload — these CRUD routes don't actually hit Kinetica,
// but stubbing global fetch defensively keeps any future requireConfig probe inert.
const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

const seedFixture = (tableName = "events", schema = "ki_home") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  return { dashId: dash.id, tableId: tbl.id, schema, tableName };
};

const makeSessionCookie = () => createAdminSession();

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
  db.exec("DELETE FROM dashboard_dynamic_views");
  db.exec("DELETE FROM dashboard_table_views");
  db.exec("DELETE FROM dashboard_tables");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM dashboards");
};

// ============================================================================
//  GET /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password
// ============================================================================
describe("GET /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with empty array when no dynamic views exist for dashboard", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .get(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dynamic_views: [] });
  });

  it("returns 200 with all dynamic views for the dashboard, ordered by id ASC", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const r1 = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "First view",
      template_sql: "SELECT vendor FROM {view}",
      max_records: 1000,
    });
    const r2 = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Second view",
      template_sql: "SELECT zone FROM {view}",
      max_records: 500,
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .get(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.dynamic_views).toHaveLength(2);
    expect(res.body.dynamic_views[0].id).toBe(r1.id);
    expect(res.body.dynamic_views[1].id).toBe(r2.id);
    expect(res.body.dynamic_views[0].id).toBeLessThan(res.body.dynamic_views[1].id);
  });

  it("only returns dynamic views for the requested dashboard (FK scoping per CONTEXT.md D4)", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const otherDash = createDashboard("Other Dashboard", "");
    createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Mine",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    createDashboardDynamicView(otherDash.id, {
      source_table_id: tableId,
      name: "Theirs",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .get(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.dynamic_views).toHaveLength(1);
    expect(res.body.dynamic_views[0].name).toBe("Mine");
  });

  it("returns 400 when dashboardId path param is non-numeric", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .get("/api/dashboards/abc/dynamic-views")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("numeric");
  });

  it("returns 401 with no session cookie (requireConfig enforces requireAuth)", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const res = await agent.get(`/api/dashboards/${dashId}/dynamic-views`);
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  POST /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password
// ============================================================================
describe("POST /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 201 with the persisted row when all fields are valid", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Top vendors by fare",
        template_sql: "SELECT vendor, AVG(fare) FROM {view} GROUP BY vendor",
        max_records: 1000,
      });
    expect(res.status).toBe(201);
    expect(res.body.dynamic_view).toMatchObject({
      dashboard_id: dashId,
      source_table_id: tableId,
      name: "Top vendors by fare",
      template_sql: "SELECT vendor, AVG(fare) FROM {view} GROUP BY vendor",
      max_records: 1000,
      columns_json: null,
    });
    expect(typeof res.body.dynamic_view.id).toBe("number");
    // ISO-ish SQLite datetime format: "YYYY-MM-DD HH:MM:SS"
    expect(res.body.dynamic_view.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(res.body.dynamic_view.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns 400 when template_sql lacks {view} token (MissingViewTokenError → 400)", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Bad template",
        template_sql: "SELECT * FROM raw_events",
        max_records: 1000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("{view}");
  });

  it("returns 400 when source_table_id is missing", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        name: "Missing FK",
        template_sql: "SELECT * FROM {view}",
        max_records: 1000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("source_table_id");
  });

  it("returns 400 when name is empty string", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "",
        template_sql: "SELECT * FROM {view}",
        max_records: 1000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("name");
  });

  it("accepts max_records 0 (unlimited); rejects negative", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    // 0 = unlimited → now a valid value (201).
    const res0 = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Unlimited",
        template_sql: "SELECT * FROM {view}",
        max_records: 0,
      });
    expect(res0.status).toBe(201);
    expect(res0.body.dynamic_view.max_records).toBe(0);

    const resNeg = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Negative",
        template_sql: "SELECT * FROM {view}",
        max_records: -5,
      });
    expect(resNeg.status).toBe(400);
    expect(resNeg.body.error).toContain("max_records");
  });

  it("returns 400 when template_sql is a whitespace-only string", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Whitespace template",
        template_sql: "   \n\t ",
        max_records: 1000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("template_sql");
  });

  it("returns 400 when dashboardId path param is non-numeric", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/dashboards/abc/dynamic-views")
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "x",
        template_sql: "SELECT * FROM {view}",
        max_records: 100,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("numeric");
  });

  it("accepts case-insensitive + whitespace-tolerant variants of {view}", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();

    const resUpper = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Upper case",
        template_sql: "SELECT * FROM {VIEW}",
        max_records: 1000,
      });
    expect(resUpper.status).toBe(201);

    const resPadded = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Padded",
        template_sql: "SELECT * FROM { view }",
        max_records: 1000,
      });
    expect(resPadded.status).toBe(201);

    const resMixed = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "Mixed case",
        template_sql: "SELECT * FROM {View}",
        max_records: 1000,
      });
    expect(resMixed.status).toBe(201);
  });

  it("returns 401 with no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .send({
        source_table_id: tableId,
        name: "No auth",
        template_sql: "SELECT * FROM {view}",
        max_records: 1000,
      });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  PUT /api/dynamic-views/:id — AUTH_MODE=password
// ============================================================================
describe("PUT /api/dynamic-views/:id — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with the updated row when partial fields are supplied", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Original name",
      template_sql: "SELECT vendor FROM {view}",
      max_records: 1000,
    });
    const { cookie } = makeSessionCookie();
    // Sleep 1.1s so SQLite's datetime('now') (second granularity) advances.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ name: "New name" });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.name).toBe("New name");
    expect(res.body.dynamic_view.template_sql).toBe("SELECT vendor FROM {view}"); // unchanged
    expect(res.body.dynamic_view.max_records).toBe(1000); // unchanged
    // updated_at advances
    expect(res.body.dynamic_view.updated_at >= row.updated_at).toBe(true);
  });

  it("clears columns_json automatically when template_sql changes and caller omits columns_json", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Preview-then-saved",
      template_sql: "SELECT foo FROM {view}",
      max_records: 1000,
      columns_json: [{ name: "foo", type: "TEXT" }],
    });
    expect(row.columns_json).toEqual([{ name: "foo", type: "TEXT" }]);
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ template_sql: "SELECT a, b FROM {view}" });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.template_sql).toBe("SELECT a, b FROM {view}");
    expect(res.body.dynamic_view.columns_json).toBeNull();
  });

  it("preserves columns_json when template_sql is unchanged and caller omits columns_json", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const original = "SELECT foo FROM {view}";
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Stable template",
      template_sql: original,
      max_records: 1000,
      columns_json: [{ name: "foo", type: "TEXT" }],
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ template_sql: original, name: "New name only" });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.template_sql).toBe(original);
    expect(res.body.dynamic_view.columns_json).toEqual([{ name: "foo", type: "TEXT" }]);
  });

  it("honors caller-supplied columns_json verbatim (UI Preview-then-Save flow)", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Will be updated",
      template_sql: "SELECT old FROM {view}",
      max_records: 1000,
      columns_json: [{ name: "old", type: "TEXT" }],
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({
        template_sql: "SELECT x FROM {view}",
        columns_json: [{ name: "x", type: "INT" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.columns_json).toEqual([{ name: "x", type: "INT" }]);
  });

  it("explicit columns_json: null clears the field (even when template_sql unchanged)", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Force clear",
      template_sql: "SELECT a FROM {view}",
      max_records: 1000,
      columns_json: [{ name: "a", type: "TEXT" }],
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ columns_json: null });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.columns_json).toBeNull();
  });

  it("returns 400 when template_sql is updated to a value lacking {view}", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "Will reject",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ template_sql: "SELECT * FROM raw_events" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("{view}");
  });

  it("returns 400 when template_sql is updated to whitespace-only", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "x",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ template_sql: "  \t " });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("template_sql");
  });

  it("returns 404 when id does not exist", async () => {
    const agent = await buildTestApp();
    seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put("/api/dynamic-views/999999")
      .set("Cookie", cookie)
      .send({ name: "x" });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("returns 400 when id path param is non-numeric", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .put("/api/dynamic-views/not-a-number")
      .set("Cookie", cookie)
      .send({ name: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("numeric");
  });

  it("returns 401 with no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "x",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .send({ name: "y" });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  Dynamic-view CRUD — AUTH_MODE=oidc smoke (one happy path per route)
// ============================================================================
describe("Dynamic-view CRUD — AUTH_MODE=oidc smoke", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    cleanFixtures();
    resetOidcClientForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET works under AUTH_MODE=oidc with credential_type=oidc session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .get(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dynamic_views)).toBe(true);
  });

  it("POST works under AUTH_MODE=oidc", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post(`/api/dashboards/${dashId}/dynamic-views`)
      .set("Cookie", cookie)
      .send({
        source_table_id: tableId,
        name: "oidc created",
        template_sql: "SELECT * FROM {view}",
        max_records: 1000,
      });
    expect(res.status).toBe(201);
    expect(res.body.dynamic_view.name).toBe("oidc created");
  });

  it("PUT works under AUTH_MODE=oidc", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const row = createDashboardDynamicView(dashId, {
      source_table_id: tableId,
      name: "oidc pre-existing",
      template_sql: "SELECT * FROM {view}",
      max_records: 1000,
    });
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .put(`/api/dynamic-views/${row.id}`)
      .set("Cookie", cookie)
      .send({ name: "oidc updated" });
    expect(res.status).toBe(200);
    expect(res.body.dynamic_view.name).toBe("oidc updated");
  });
});
