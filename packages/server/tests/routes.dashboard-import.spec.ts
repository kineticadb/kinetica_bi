/**
 * routes.dashboard-import.spec.ts — Phase 120 Plan 04 (DXIM-V124-03/-10/-11)
 *
 * `POST /api/dashboards/import` — the route that exposes Plan 120-02's `validateImportFile` and
 * Plan 120-03's `applyDashboardImport` over HTTP, plus two pre-existing `errorMiddleware` gaps
 * this plan closes: `express.json({ limit: "1mb" })` (mounted globally, BEFORE routing) rejects a
 * truncated body with `entity.parse.failed` and an oversized body with `entity.too.large`.
 * Neither type is one of the three typed Kinetica errors `errorMiddleware` already branches on,
 * so BOTH fell through to a bare `500 "Internal server error"` before this plan — verified below
 * (see `MALFORMED-` / `OVERSIZE-` tests), not merely asserted.
 *
 * Task 1 (`MALFORMED-` / `OVERSIZE-`): the two body-parser branches in `errorMiddleware`.
 * Task 2 (`ROUTE-` / `PARITY-`): the route itself — permission gate (composed from two EXISTING
 * permissions, no new one added), 201 + report shape, 400 for a structurally malformed file, and
 * that the permission catalog is unchanged at 18 entries.
 *
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 *
 * MUTATION PROBES (Plan 120-04 Task 3) — 5 probes run for real against the committed
 * src/index.ts route + errorMiddleware branches, then reverted; `git diff --exit-code -- src/index.ts`
 * confirmed the source byte-identical afterward each time.
 * R1  removed the `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` spread from the route
 *       -> did NOT redden on first attempt: an analyst holds NEITHER gate permission, so removing
 *       one gate still left the other to deny (403), which is exactly the "guard that cannot
 *       fail manufactures confidence" case CLAUDE.md warns about. STRENGTHENED with a new fixture
 *       `seedCreateOnlySession` (custom role holding EXACTLY dashboards:create) and a new test
 *       "ROUTE-403: a user holding only dashboards:create is still denied (datasets:manage is
 *       required too)" — that test DOES redden under this mutation (403 -> 400, the gate no
 *       longer blocks so the request reaches validation), re-run and confirmed.
 * R2  removed the `...requirePermission(PERMISSIONS.DASHBOARDS_CREATE)` spread from the route
 *       -> also did NOT redden on first attempt, for the same reason in reverse: every existing
 *       fixture either holds neither permission or already lacks datasets:manage regardless.
 *       STRENGTHENED with the mirror fixture `seedManageOnlySession` (custom role holding EXACTLY
 *       datasets:manage) and a new test "ROUTE-403: a user holding only datasets:manage is still
 *       denied (dashboards:create is required too)" — reddens under this mutation (403 -> 400),
 *       re-run and confirmed.
 * R3  skipped validateImportFile and called applyDashboardImport(req.body as any) directly
 *       -> reddened "ROUTE-400: a structurally malformed file returns 400 with the validator's
 *       message" (400 -> 422, since the un-validated body throws inside applyDashboardImport and
 *       is caught by the route's own try/catch instead of being rejected by the validator) and
 *       "ROUTE-400: an unsupported schemaVersion returns 400 naming the version" (400 -> 201,
 *       since nothing rejects the version once validation is skipped). "ROUTE-400: a rejected
 *       import writes nothing" did NOT redden — expected and correct: with no rows written before
 *       the thrown TypeError, the dashboard/widget counts stay unchanged either way (rejected by
 *       validation, or thrown-and-rolled-back mid-transaction); the assertion is about a
 *       write-count invariant that genuinely holds under both paths, not a discrimination gap.
 * R4  deleted the `entity.parse.failed` branch from errorMiddleware
 *       -> reddened both MALFORMED-truncated tests (400 -> 500, "Internal server error").
 * R5  deleted the `entity.too.large` branch from errorMiddleware
 *       -> reddened both OVERSIZE-limit tests (413 -> 500, "Internal server error").
 * 5/5 probes fired (after strengthening R1 and R2 with two new single-permission fixtures); no
 * other assertion required strengthening.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import { createDashboard, createTable, addDashboardTable, createWidget, createCustomMetric } from "../src/db";
import { createSession } from "../src/sessionStore";
import { PERMISSIONS, ALL_PERMISSIONS } from "../src/lib/permissions";
import jwt from "jsonwebtoken";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session (verbatim idiom from routes.dashboard-export.spec.ts). A user with no
 * `user_roles` row falls back to `analyst`, which holds `dashboards:view` only — neither
 * `dashboards:create` nor `datasets:manage`, so this is the 403 fixture for the import route's
 * AND-gate.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

/**
 * Seeds a session for a user holding EXACTLY `dashboards:create` — no built-in role holds one
 * of the two import permissions without the other, so this custom role is the only fixture that
 * can discriminate the SECOND half of the AND-gate (Task 3, mutation probe R1: an analyst holds
 * NEITHER permission, so removing `datasets:manage` alone still leaves `dashboards:create` to
 * deny — that probe cannot fail without this fixture).
 */
const seedCreateOnlySession = (username: string): { cookie: string } => {
  db.prepare("INSERT INTO roles (name, description, built_in) VALUES ('creator_only', '', 0)").run();
  const role = db.prepare("SELECT id FROM roles WHERE name = 'creator_only'").get() as { id: number };
  db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)").run(
    role.id,
    PERMISSIONS.DASHBOARDS_CREATE
  );
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, role.id);
  const sid = createSession({ username, secret: "creator-only-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

/**
 * Mirror of `seedCreateOnlySession` holding EXACTLY `datasets:manage` — added to discriminate
 * mutation probe R2 (Task 3): removing the `dashboards:create` spread alone does not redden any
 * existing test (an analyst holds neither permission, and the create-only fixture still lacks
 * `datasets:manage` regardless of whether the `dashboards:create` gate is present), so this is
 * the fixture that proves the FIRST half of the AND-gate independently.
 */
const seedManageOnlySession = (username: string): { cookie: string } => {
  db.prepare("INSERT INTO roles (name, description, built_in) VALUES ('manager_only', '', 0)").run();
  const role = db.prepare("SELECT id FROM roles WHERE name = 'manager_only'").get() as { id: number };
  db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)").run(
    role.id,
    PERMISSIONS.DATASETS_MANAGE
  );
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, role.id);
  const sid = createSession({ username, secret: "manage-only-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

beforeEach(() => {
  db.exec(`
    DELETE FROM dashboard_access_grants;
    DELETE FROM dashboard_layers;
    DELETE FROM dashboard_dynamic_views;
    DELETE FROM widgets;
    DELETE FROM dashboard_tables;
    DELETE FROM custom_metrics;
    DELETE FROM dashboards;
    DELETE FROM tables;
    DELETE FROM user_roles;
    DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE built_in = 0);
    DELETE FROM roles WHERE built_in = 0;
    DELETE FROM sessions;
  `);
});

// ─── Task 1: body-parser failures land in errorMiddleware ────────────────────

describe("MALFORMED-truncated: express.json entity.parse.failed", () => {
  it("a truncated JSON body returns 400 with a clear message, not 500", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post("/api/dashboards/import")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send('{"schemaVersion":1,"dash');

    expect(res.status).toBe(400);
  });

  it("the truncated-body response names JSON, not an internal error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post("/api/dashboards/import")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send('{"schemaVersion":1,"dash');

    expect(res.body.error).toMatch(/JSON/i);
    expect(res.body.error).not.toContain("Internal server error");
  });
});

describe("OVERSIZE-limit: express.json entity.too.large", () => {
  const buildOversizedEnvelope = () => ({
    schemaVersion: 1,
    dashboard: { id: 1, name: "oversize-test" },
    widgets: [],
    layers: [],
    dynamicViews: [],
    tables: [],
    customMetrics: [],
    dashboardTableIds: [],
    padding: "a".repeat(1_200_000), // ~1.2 MB — over the 1 MB cap, ~60x the real 17 KB export
  });

  it("a body over the 1 MB cap returns 413 with a message naming the limit", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(buildOversizedEnvelope());

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/1 ?MB/i);
  });

  it("the oversized response is not a 500 and does not say \"Internal server error\"", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(buildOversizedEnvelope());

    expect(res.status).not.toBe(500);
    expect(res.body.error).not.toContain("Internal server error");
  });
});

// ─── Task 2: the route — permission gate, report shape, malformed rejection ──

describe("ROUTE: POST /api/dashboards/import", () => {
  /** Builds a real, small export envelope: one table, one dashboard, one widget referencing a
   *  custom metric (REF-4 `config.metricId`), captured via the REAL export route end-to-end —
   *  never hand-written. The seeded rows are then cleared so import creates fresh target rows. */
  const buildRealExportFile = async (app: Awaited<ReturnType<typeof buildTestApp>>, adminCookie: string) => {
    const table = createTable({ schema: "kbi_import", name: "t_import", columns: { c1: "int" } });
    const metric = createCustomMetric(table.id, "Revenue", "SUM(c1)");
    const dashboard = createDashboard("Import Source Dashboard");
    addDashboardTable(dashboard.id, table.id);
    createWidget(dashboard.id, { title: "Bar", type: "bar", position: 0, config: { metricId: metric.id } });

    const exportRes = await app.get(`/api/dashboards/${dashboard.id}/export`).set("Cookie", adminCookie);
    expect(exportRes.status).toBe(200);
    const file = JSON.parse(exportRes.text);

    // Clear so the target environment has nothing matching by schema.name / label — proves
    // tablesCreated / metricsCreated rather than tablesMatched / metricsMatched.
    db.exec(`
      DELETE FROM dashboard_tables;
      DELETE FROM widgets;
      DELETE FROM custom_metrics;
      DELETE FROM dashboards;
      DELETE FROM tables;
    `);

    return file;
  };

  it("ROUTE-401: no cookie returns 401", async () => {
    const app = await buildTestApp();
    const res = await app.post("/api/dashboards/import").send({});
    expect(res.status).toBe(401);
  });

  it("ROUTE-403: an analyst (dashboards:view only) is denied with code PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("import_analyst");
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("ROUTE-403: the denial names one of the two required permissions", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("import_analyst2");
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send({});
    expect([PERMISSIONS.DASHBOARDS_CREATE, PERMISSIONS.DATASETS_MANAGE]).toContain(res.body.permission);
  });

  it("ROUTE-403: a user holding only dashboards:create is still denied (datasets:manage is required too)", async () => {
    // Added for Task 3 mutation probe R1: an analyst holds NEITHER gate permission, so removing
    // just one requirePermission spread still leaves the other to deny — that probe cannot fail
    // without a fixture holding exactly ONE of the two. This test is the one that discriminates
    // the second half of the AND-gate.
    const app = await buildTestApp();
    const { cookie } = seedCreateOnlySession("import_create_only");
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe(PERMISSIONS.DATASETS_MANAGE);
  });

  it("ROUTE-403: a user holding only datasets:manage is still denied (dashboards:create is required too)", async () => {
    // Added for Task 3 mutation probe R2: removing the dashboards:create spread alone reddens
    // NOTHING without this fixture — every other fixture either holds neither permission
    // (analyst) or lacks datasets:manage regardless (the create-only fixture above). This test
    // discriminates the FIRST half of the AND-gate independently of the second.
    const app = await buildTestApp();
    const { cookie } = seedManageOnlySession("import_manage_only");
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe(PERMISSIONS.DASHBOARDS_CREATE);
  });

  it("ROUTE-201: an admin import returns 201", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    expect(res.status).toBe(201);
  });

  it("ROUTE-201: the response names the NEW dashboard id and it differs from the file's id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    expect(typeof res.body.data.dashboardId).toBe("number");
    expect(res.body.data.dashboardId).not.toBe(file.dashboard.id);
  });

  it("ROUTE-201: the response lists tablesMatched and tablesCreated", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    expect(Array.isArray(res.body.data.tablesMatched)).toBe(true);
    expect(Array.isArray(res.body.data.tablesCreated)).toBe(true);
    expect(res.body.data.tablesCreated.length).toBe(1);
  });

  it("ROUTE-201: the response lists metricsCreated", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    expect(Array.isArray(res.body.data.metricsCreated)).toBe(true);
    expect(res.body.data.metricsCreated.length).toBe(1);
  });

  it("ROUTE-201: the new dashboard is retrievable at GET /api/dashboards/:newId", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    const newId = res.body.data.dashboardId;
    const getRes = await app.get("/api/dashboards").set("Cookie", cookie);
    expect(getRes.body.data.map((d: { id: number }) => d.id)).toContain(newId);
  });

  it("ROUTE-400: a structurally malformed file returns 400 with the validator's message", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post("/api/dashboards/import")
      .set("Cookie", cookie)
      .send({ schemaVersion: 1, dashboard: { id: 1, name: "x" } }); // missing widgets/layers/etc.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/malformed/i);
  });

  it("ROUTE-400: a rejected import writes nothing — dashboard and widget counts are unchanged", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const before = {
      dashboards: (db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n,
      widgets: (db.prepare("SELECT COUNT(*) AS n FROM widgets").get() as { n: number }).n,
    };
    await app
      .post("/api/dashboards/import")
      .set("Cookie", cookie)
      .send({ schemaVersion: 1, dashboard: { id: 1, name: "x" } });
    const after = {
      dashboards: (db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n,
      widgets: (db.prepare("SELECT COUNT(*) AS n FROM widgets").get() as { n: number }).n,
    };
    expect(after).toEqual(before);
  });

  it("ROUTE-400: an unsupported schemaVersion returns 400 naming the version", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post("/api/dashboards/import")
      .set("Cookie", cookie)
      .send({
        schemaVersion: 999,
        dashboard: { id: 1, name: "x" },
        widgets: [],
        layers: [],
        dynamicViews: [],
        tables: [],
        customMetrics: [],
        dashboardTableIds: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("999");
  });

  it("ROUTE-path: POST /api/dashboards/import is not captured by any :id route", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const file = await buildRealExportFile(app, cookie);
    const res = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
    // If this literal segment were ever captured as a numeric :id param on some OTHER verb
    // handler, the response would not be an import report — it would 404 or return something
    // with no `tablesMatched` key.
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("tablesMatched");
  });

  it("PARITY: the permission catalog still has exactly 18 entries", () => {
    expect(ALL_PERMISSIONS.length).toBe(18);
  });

  it("PARITY: no import-specific permission string exists", () => {
    expect(ALL_PERMISSIONS.some((p) => p.includes("import"))).toBe(false);
  });
});
