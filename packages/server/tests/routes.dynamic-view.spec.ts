/**
 * routes.dynamic-view.spec.ts — Phase 32 Plan 03 supertest coverage.
 *
 * Covers the three v1.6 Dynamic Views runtime endpoints:
 *   - POST   /api/dynamic-view/preview      (DV-V16-03)
 *   - POST   /api/dynamic-view/materialize  (DV-V16-04)
 *   - DELETE /api/dynamic-view/:id          (DV-V16-05)
 *
 * Each route is exercised in AUTH_MODE=password (full validation matrix)
 * with an additional OIDC smoke (one happy path per route) to prove the
 * credential-type branch works end-to-end.
 *
 * Mock pattern mirrors routes.filter-materialize.spec.ts:
 *   - Hoisted openid-client mock so AUTH_MODE=oidc boot does not hit the network.
 *   - vi.stubGlobal("fetch", ...) returns Kinetica-shaped column-major responses.
 *   - For multi-call routes (materialize: COUNT → CREATE; race-recovery: 4 calls)
 *     fetchMock.mockImplementation cycles through the planned response sequence.
 *
 * Kinetica response shape (column-major, JSON-encoded twice — see kinetica.ts):
 *   { status: "OK", data_str: JSON.stringify({
 *       json_encoded_response: JSON.stringify({
 *         column_headers: ["c1", ...],
 *         column_1: [v1, v2, ...],
 *         ...
 *       })
 *     })
 *   }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
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
import { resetOidcClientForTests } from "../src/oidc";
import {
  db,
  createDashboard,
  createTable,
  createDashboardDynamicView,
  getDashboardDynamicView,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// ── Kinetica response builders ────────────────────────────────────────────

/** Generic success body. Wraps a column-major encoded payload twice (kinetica.ts contract). */
const kineticaOk = (encoded: Record<string, unknown> = {}): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify({
    status: "OK",
    message: "",
    data_type: "execute_sql_response",
    data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded) }),
  }),
});

/** Build a column-major preview response: rows.length identical for every column. */
const previewRows = (cols: string[], rows: unknown[][]): { status: number; body: string } => {
  const encoded: Record<string, unknown> = { column_headers: cols };
  cols.forEach((_, idx) => {
    encoded[`column_${idx + 1}`] = rows.map((r) => r[idx]);
  });
  return kineticaOk(encoded);
};

/** Build a COUNT(*) response. */
const countResult = (n: number): { status: number; body: string } =>
  kineticaOk({ column_headers: ["c"], column_1: [n] });

/** Build a Kinetica 400/ERROR with "Could not find the table" — used to signal the no_filter / race-recovery paths. */
const kineticaTableNotFound = (viewName: string): { status: number; body: string } => ({
  status: 400,
  body: JSON.stringify({
    status: "ERROR",
    message: `Could not find the table: '${viewName}' (TM/SMc:1078)`,
  }),
});

/** Build a Kinetica 400/ERROR with "Object '...' not found (S/SDc:1513)" — observed in live
 *  testing when SELECT'ing against a materialized view that doesn't exist (the no-filter-yet
 *  case for Preview probes). isTableNotFoundError must recognize this code too. */
const kineticaObjectNotFound = (viewName: string): { status: number; body: string } => ({
  status: 400,
  body: JSON.stringify({
    status: "ERROR",
    message: `SqlEngine: Object '${viewName}' not found (S/SDc:1513)`,
  }),
});

/** Convenience: convert a {status,body} into a Response. */
const respond = (r: { status: number; body: string }) =>
  Promise.resolve(new Response(r.body, { status: r.status }));

// ── Test fixtures ─────────────────────────────────────────────────────────

const seedFixture = (tableName = "events", schema = "ki_home") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  return { dashId: dash.id, tableId: tbl.id, schema, tableName };
};

const seedDynamicView = (
  dashId: number,
  tableId: number,
  overrides: Partial<{ name: string; template_sql: string; max_records: number }> = {},
) => {
  return createDashboardDynamicView(dashId, {
    source_table_id: tableId,
    name: overrides.name ?? "Top vendors",
    template_sql:
      overrides.template_sql ?? "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
    max_records: overrides.max_records ?? 1000,
  });
};

const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

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

/** Extract Kinetica /execute/sql statements in call order. */
const sqlStatements = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/execute/sql"))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string).statement as string);

// ============================================================================
//  POST /api/dynamic-view/preview — AUTH_MODE=password
// ============================================================================
describe("POST /api/dynamic-view/preview — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with { rows, columns } when filter view is active", async () => {
    // Sequence: SELECT 1 probe → ok (filter view exists); preview → 3 rows.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaOk({ column_headers: [] }));
      return respond(
        previewRows(["vendor", "avg_fare"], [
          ["A", 12.5],
          ["B", 10.0],
          ["C", 8.75],
        ]),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
        sample_limit: 100,
      });

    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual([
      { name: "vendor", type: "unknown" },
      { name: "avg_fare", type: "unknown" },
    ]);
    expect(res.body.rows).toEqual([
      ["A", 12.5],
      ["B", 10.0],
      ["C", 8.75],
    ]);

    // Second call is the real preview against the filter view (not the bare table).
    const statements = sqlStatements(fetchMock);
    expect(statements[1]).toMatch(/^SELECT \* FROM \(SELECT vendor, AVG\(fare\) AS avg_fare FROM _kbi_filt_u\w+_d\d+_t\d+_s\w{8} GROUP BY vendor\) LIMIT 100$/);
  });

  it("falls back to bare source-table when no active filter view exists", async () => {
    // Sequence: SELECT 1 probe → 'Could not find the table' (filter view absent);
    // preview against bare table → empty result.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaTableNotFound("_kbi_filt_dummy"));
      return respond(kineticaOk({ column_headers: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT vendor FROM {view}",
      });

    expect(res.status).toBe(200);

    // 2nd call is the bare-table preview — must reference ki_home.events, not _kbi_filt_...
    const statements = sqlStatements(fetchMock);
    expect(statements[1]).toMatch(/SELECT \* FROM \(SELECT vendor FROM ki_home\.events\) LIMIT 100/);
    expect(statements[1]).not.toContain("_kbi_filt_");
  });

  it("falls back to bare source-table when filter-view probe returns S/SDc:1513 (Object not found)", async () => {
    // Regression for post-VERIFY bug: live Kinetica returned `S/SDc:1513` for the no-filter
    // case (instead of `TM/SMc:1078`), so the original isTableNotFoundError matcher missed
    // it and Preview surfaced "Preview failed: SqlEngine: Object '...' not found" to the
    // operator instead of falling back to the bare source table. The matcher now also
    // recognizes the S/SDc:1513 code AND the generic "Object '...' not found" prose.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaObjectNotFound("_kbi_filt_dummy"));
      return respond(kineticaOk({ column_headers: ["vendor"], column_1: ["A"] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT vendor FROM {view}",
      });

    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual([{ name: "vendor", type: "unknown" }]);
    // Bare-table preview substitution — NOT the filter view name.
    const statements = sqlStatements(fetchMock);
    expect(statements[1]).toMatch(/SELECT \* FROM \(SELECT vendor FROM ki_home\.events\) LIMIT 100/);
    expect(statements[1]).not.toContain("_kbi_filt_");
  });

  it("returns 400 when template_sql lacks {view} token", async () => {
    // Probe still fires (no filter view) → fallback chosen, then substitution fails → 400.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(kineticaTableNotFound("_kbi_filt_x").body, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT * FROM raw_events",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("{view}");
  });

  it("clamps sample_limit to 1000 when caller asks for more", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaOk({ column_headers: [] }));
      return respond(kineticaOk({ column_headers: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT * FROM {view}",
        sample_limit: 5000,
      });

    const statements = sqlStatements(fetchMock);
    expect(statements[1]).toMatch(/LIMIT 1000$/);
  });

  it("defaults sample_limit to 100 when omitted", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaOk({ column_headers: [] }));
      return respond(kineticaOk({ column_headers: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT * FROM {view}",
      });

    const statements = sqlStatements(fetchMock);
    expect(statements[1]).toMatch(/LIMIT 100$/);
  });

  it("returns 404 when source_table_id does not exist", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: 99999,
        template_sql: "SELECT * FROM {view}",
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Source table");
  });

  it("returns 400 when template_sql is missing", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({ dashboard_id: dashId, source_table_id: tableId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("template_sql");
  });

  it("returns 400 when source_table_id is missing", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({ dashboard_id: dashId, template_sql: "SELECT * FROM {view}" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("source_table_id");
  });

  it("returns 400 when dashboard_id is missing", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({ source_table_id: tableId, template_sql: "SELECT * FROM {view}" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("dashboard_id");
  });

  it("returns 401 with no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const res = await agent
      .post("/api/dynamic-view/preview")
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT * FROM {view}",
      });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  POST /api/dynamic-view/materialize — AUTH_MODE=password
// ============================================================================
describe("POST /api/dynamic-view/materialize — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path below threshold — returns { status: 'materialized', view_name, row_count, expires_at } and fires CREATE OR REPLACE", async () => {
    // Sequence: COUNT → 500, CREATE OR REPLACE → ok.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(countResult(500));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 1000 });
    const { cookie } = makeSessionCookie("alice");
    const before = Date.now();

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    expect(res.body.view_name).toMatch(/^_kbi_dv_u\w+_d\d+_\d+$/);
    expect(res.body.row_count).toBe(500);
    expect(res.body.expires_at).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(2);
    expect(statements[0]).toMatch(/^SELECT COUNT\(\*\) FROM _kbi_filt_u\w+/);
    expect(statements[1]).toMatch(/^CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_u\w+_d\d+_\d+ AS \(SELECT vendor, AVG\(fare\) AS avg_fare FROM _kbi_filt_u\w+ GROUP BY vendor\) USING TABLE PROPERTIES \(TTL = 5\)$/);
  });

  it("over threshold — drops dynamic view + returns { status: 'over_threshold', reason: 'exceeds_max_records', row_count }", async () => {
    // Sequence: COUNT → 200, DROP → ok.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(countResult(200));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 100 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "over_threshold",
      reason: "exceeds_max_records",
      row_count: 200,
    });

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(2);
    expect(statements[0]).toMatch(/^SELECT COUNT\(\*\)/);
    expect(statements[1]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);
  });

  it("max_records 0 (unlimited) — materializes regardless of row count (no over_threshold)", async () => {
    // COUNT → a huge number that would exceed any positive cap; CREATE OR REPLACE → ok.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(countResult(9_999_999));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 0 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    expect(res.body.row_count).toBe(9_999_999);

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(2);
    expect(statements[0]).toMatch(/^SELECT COUNT\(\*\)/);
    expect(statements[1]).toMatch(/^CREATE OR REPLACE MATERIALIZED VIEW/);
    // Never dropped (not over threshold).
    expect(statements.find((s) => s.startsWith("DROP"))).toBeUndefined();
  });

  it("no filter view + base under cap — materializes against the unfiltered BASE table", async () => {
    // Sequence: COUNT filter view → not found; COUNT base table → 500 (< max 1000);
    // CREATE OR REPLACE against the base table → ok.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaTableNotFound("_kbi_filt_dummy"));
      if (callIndex === 2) return respond(countResult(500));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 1000 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    expect(res.body.row_count).toBe(500);

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(3);
    expect(statements[0]).toMatch(/^SELECT COUNT\(\*\) FROM _kbi_filt_u\w+/); // filter-view probe
    expect(statements[1]).toBe("SELECT COUNT(*) FROM ki_home.events");       // base-table count
    // CREATE substitutes {view} → the BASE table (NOT a filter view).
    expect(statements[2]).toMatch(
      /^CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_u\w+_d\d+_\d+ AS \(SELECT vendor, AVG\(fare\) AS avg_fare FROM ki_home\.events GROUP BY vendor\) USING TABLE PROPERTIES \(TTL = 5\)$/,
    );
    expect(statements.find((s) => s.startsWith("DROP"))).toBeUndefined();
  });

  it("no filter view + unlimited (max_records 0) — materializes against the BASE table regardless of size", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaTableNotFound("_kbi_filt_dummy"));
      if (callIndex === 2) return respond(countResult(9_999_999));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 0 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    expect(res.body.row_count).toBe(9_999_999);
    const statements = sqlStatements(fetchMock);
    expect(statements[2]).toMatch(/FROM ki_home\.events GROUP BY vendor/);
  });

  it("no filter view + capped base over cap — drops + returns over_threshold/no_filter", async () => {
    // COUNT filter view → not found; COUNT base → 500 (>= max 100); DROP → ok. No CREATE.
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaTableNotFound("_kbi_filt_dummy"));
      if (callIndex === 2) return respond(countResult(500));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 100 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "over_threshold", reason: "no_filter" });

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(3);
    expect(statements[1]).toBe("SELECT COUNT(*) FROM ki_home.events");
    expect(statements[2]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);
    expect(statements.find((s) => s.includes("CREATE"))).toBeUndefined();
  });

  it("TM/SMc:1078 race-recovery — CREATE OR REPLACE retries with DROP+CREATE and still returns materialized", async () => {
    // Sequence:
    //   1. COUNT → 500
    //   2. CREATE OR REPLACE → 400 TM/SMc:1078
    //   3. DROP TABLE IF EXISTS → ok
    //   4. CREATE MATERIALIZED VIEW (plain) → ok
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(countResult(500));
      if (callIndex === 2) return respond(kineticaTableNotFound("_kbi_dv_dummy"));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 1000 });
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    expect(res.body.view_name).toMatch(/^_kbi_dv_u\w+/);

    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(4);
    expect(statements[0]).toMatch(/^SELECT COUNT\(\*\)/);
    expect(statements[1]).toMatch(/^CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_/);
    expect(statements[2]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_/);
    expect(statements[3]).toMatch(/^CREATE MATERIALIZED VIEW _kbi_dv_/);
    expect(statements[3]).not.toMatch(/CREATE OR REPLACE/);
  });

  it("returns 400 when dynamic_view_id is missing", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");
    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("dynamic_view_id");
  });

  it("returns 404 when dynamic_view_id does not exist", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");
    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: 99999 });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Dynamic view");
  });

  it("returns 401 with no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const res = await agent
      .post("/api/dynamic-view/materialize")
      .send({ dynamic_view_id: dv.id });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  DELETE /api/dynamic-view/:id — AUTH_MODE=password
// ============================================================================
describe("DELETE /api/dynamic-view/:id — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path — drops view + deletes row + returns { deleted: true, dropped: true }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(kineticaOk().body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .delete(`/api/dynamic-view/${dv.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, dropped: true });
    // SQLite row removed.
    expect(getDashboardDynamicView(dv.id)).toBeUndefined();
    // Kinetica DROP statement was fired.
    const statements = sqlStatements(fetchMock);
    expect(statements.length).toBe(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);
  });

  it("returns 404 when id does not exist — no DROP fired", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(kineticaOk().body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .delete("/api/dynamic-view/99999")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Dynamic view");
    expect(sqlStatements(fetchMock).length).toBe(0);
  });

  it("returns 400 when id path param is non-numeric", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .delete("/api/dynamic-view/abc")
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("numeric");
  });

  it("returns 401 with no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const res = await agent.delete(`/api/dynamic-view/${dv.id}`);
    expect(res.status).toBe(401);
  });
});

// ============================================================================
//  Dynamic-view runtime — AUTH_MODE=oidc smoke (one happy path per route)
// ============================================================================
describe("Dynamic-view runtime — AUTH_MODE=oidc smoke", () => {
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

  it("preview works under AUTH_MODE=oidc with Bearer <access_token>", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(kineticaOk({ column_headers: [] }));
      return respond(previewRows(["vendor"], [["A"], ["B"]]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie, token } = seedOidcSession("john.doe@kinetica.com");

    const res = await agent
      .post("/api/dynamic-view/preview")
      .set("Cookie", cookie)
      .send({
        dashboard_id: dashId,
        source_table_id: tableId,
        template_sql: "SELECT vendor FROM {view}",
      });

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([["A"], ["B"]]);
    // Auth header on Kinetica call is Bearer <access_token>.
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql"),
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("materialize below threshold works under AUTH_MODE=oidc", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) return respond(countResult(50));
      return respond(kineticaOk());
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId, { max_records: 1000 });
    const { cookie } = seedOidcSession("john.doe@kinetica.com");

    const res = await agent
      .post("/api/dynamic-view/materialize")
      .set("Cookie", cookie)
      .send({ dynamic_view_id: dv.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("materialized");
    // OIDC-sanitized username appears in both filter-view and dynamic-view names.
    expect(res.body.view_name).toMatch(/^_kbi_dv_ujohn_doe_kinetica_com_d\d+_\d+$/);
    const statements = sqlStatements(fetchMock);
    expect(statements[0]).toMatch(/SELECT COUNT\(\*\) FROM _kbi_filt_ujohn_doe_kinetica_com_/);
    expect(statements[1]).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_ujohn_doe_kinetica_com_/);
    expect(statements[1]).toContain("USING TABLE PROPERTIES (TTL = 5)");
  });

  it("delete works under AUTH_MODE=oidc", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(kineticaOk().body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = seedOidcSession("john.doe@kinetica.com");

    const res = await agent
      .delete(`/api/dynamic-view/${dv.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, dropped: true });
    expect(getDashboardDynamicView(dv.id)).toBeUndefined();
    const statements = sqlStatements(fetchMock);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_ujohn_doe_kinetica_com_/);
  });
});
