/**
 * routes.dashboard-access.spec.ts — Phase 55 Plan 02 (ENFORCE-V110-01..04)
 *
 * Integration supertests proving the per-dashboard view access enforcement
 * wired in 55-02 Tasks 1-2. Covers:
 *
 *   ENFORCE-V110-01: GET /api/dashboards server-side filter
 *     - analyst sees only granted dashboards (user grant)
 *     - admin (bypass) sees all dashboards
 *     - role grant expands visibility
 *
 *   ENFORCE-V110-02: open gating — non-permitted user gets 404 "Dashboard not found."
 *     - /widgets, /tables, /layers, /views, /dynamic-views each return 404 for non-granted user
 *     - granted user + admin bypass gets 200
 *
 *   ENFORCE-V110-03: grant CRUD gating
 *     - non-manage_access user gets 403 on POST /api/dashboards/:id/access
 *     - admin (manage_access) can GET/POST/DELETE grants
 *
 *   ENFORCE-V110-04: audit
 *     - POST emits rbac_audit row with action="dashboard_access_granted"
 *     - DELETE emits rbac_audit row with action="dashboard_access_revoked"
 *
 *   Passthrough non-regression (ANALYST-PASSTHROUGH BOUNDARY):
 *     - analyst session is NOT 404'd on GET /api/tables (no dashboard id required)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import { createDashboard } from "../src/db";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { createSession } from "../src/sessionStore";
import jwt from "jsonwebtoken";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session. The user gets NO user_roles row → analyst fallback.
 * Analyst has dashboards:view only — no manage_access, not a bypass user.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

/**
 * Seeds a designer session (has manage_access = bypass user).
 * Inserts a user_roles row pointing at the designer role.
 */
const seedDesignerSession = (username: string): { cookie: string } => {
  const row = db.prepare<[], { id: number }>("SELECT id FROM roles WHERE name = 'designer'").get();
  if (!row) throw new Error("designer role not found — RBAC seed may not have run");
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, row.id);
  const sid = createSession({ username, secret: "designer-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM user_roles");
  db.exec("DELETE FROM dashboard_access_grants");
  db.exec("DELETE FROM dashboards");
  db.exec("DELETE FROM rbac_audit");
});

// ─── ENFORCE-V110-01: List filter ─────────────────────────────────────────────

describe("ENFORCE-V110-01: GET /api/dashboards server-side filter", () => {
  it("analyst 'ann' sees only the dashboard she has a user grant on (not the second)", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const dashB = createDashboard("Dashboard B");

    // Grant ann only on dashboard A
    addDashboardGrant(dashA.id, "user", "ann");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get("/api/dashboards").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d: { id: number }) => d.id);
    expect(ids).toContain(dashA.id);
    expect(ids).not.toContain(dashB.id);
  });

  it("admin (bypass) sees ALL dashboards regardless of grants", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const dashB = createDashboard("Dashboard B");

    // No grants seeded — admin bypasses entirely
    const { cookie } = createAdminSession();
    const res = await app.get("/api/dashboards").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d: { id: number }) => d.id);
    expect(ids).toContain(dashA.id);
    expect(ids).toContain(dashB.id);
  });

  it("analyst with no grants sees an empty list", async () => {
    const app = await buildTestApp();
    createDashboard("Dashboard A");

    const { cookie } = seedAnalystSession("nobody");
    const res = await app.get("/api/dashboards").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── ENFORCE-V110-02: Open gating — 404 on denial ────────────────────────────

describe("ENFORCE-V110-02: scoped GET routes return 404 for non-granted users", () => {
  it("analyst 'ann' gets 404 Dashboard not found. on /widgets for a dashboard she is not granted", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashB.id}/widgets`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dashboard not found.");
  });

  it("analyst 'ann' gets 200 on /widgets for a dashboard she IS granted", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashA.id}/widgets`).set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("admin bypass gets 200 on /widgets even without a grant", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dashB.id}/widgets`).set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("analyst 'ann' gets 404 on /tables for non-granted dashboard", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashB.id}/tables`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dashboard not found.");
  });

  it("analyst 'ann' gets 404 on /layers for non-granted dashboard", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashB.id}/layers`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dashboard not found.");
  });

  it("analyst 'ann' gets 404 on /views for non-granted dashboard", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashB.id}/views`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dashboard not found.");
  });

  it("analyst 'ann' gets 404 on /dynamic-views for non-granted dashboard", async () => {
    const app = await buildTestApp();
    const dashB = createDashboard("Dashboard B");

    const { cookie } = seedAnalystSession("ann");
    const res = await app.get(`/api/dashboards/${dashB.id}/dynamic-views`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dashboard not found.");
  });
});

// ─── Role-grant path ──────────────────────────────────────────────────────────

describe("Role-grant: analyst fallback user gets access via analyst role grant", () => {
  it("adding a role grant for 'analyst' makes dashboard B visible to analyst fallback user", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const dashB = createDashboard("Dashboard B");

    // Grant only A by user grant
    addDashboardGrant(dashA.id, "user", "ann");
    // Grant B by role grant for 'analyst' role
    addDashboardGrant(dashB.id, "role", "analyst");

    const { cookie } = seedAnalystSession("ann");

    // GET /api/dashboards should now include both
    const listRes = await app.get("/api/dashboards").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.data.map((d: { id: number }) => d.id);
    expect(ids).toContain(dashA.id);
    expect(ids).toContain(dashB.id);

    // GET /api/dashboards/:B/layers should also be 200
    const layersRes = await app.get(`/api/dashboards/${dashB.id}/layers`).set("Cookie", cookie);
    expect(layersRes.status).toBe(200);
  });
});

// ─── ENFORCE-V110-03: Grant CRUD gating ──────────────────────────────────────

describe("ENFORCE-V110-03: grant CRUD routes gated by dashboards:manage_access", () => {
  it("analyst 'ann' (no manage_access) gets 403 on POST /api/dashboards/:id/access", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann"); // grant view access but not manage_access

    const { cookie } = seedAnalystSession("ann");
    const res = await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "bob" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin can GET grants for a dashboard", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann");

    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dashA.id}/access`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.grants).toHaveLength(1);
    expect(res.body.grants[0].grantee).toBe("ann");
    expect(res.body.grants[0].grantee_type).toBe("user");
  });

  it("admin can POST a grant and see it in subsequent GET", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const { cookie } = createAdminSession();

    const postRes = await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "bob" });
    expect(postRes.status).toBe(201);
    expect(postRes.body.grants).toHaveLength(1);
    expect(postRes.body.grants[0].grantee).toBe("bob");

    const getRes = await app.get(`/api/dashboards/${dashA.id}/access`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.grants[0].grantee).toBe("bob");
  });

  it("admin can DELETE a grant and it disappears from GET", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann");

    const { cookie } = createAdminSession();
    const delRes = await app
      .delete(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "ann" });
    expect(delRes.status).toBe(200);
    expect(delRes.body.grants).toHaveLength(0);

    const getRes = await app.get(`/api/dashboards/${dashA.id}/access`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.grants).toHaveLength(0);
  });

  it("POST /api/dashboards/:id/access returns 400 for invalid grantee_type", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const { cookie } = createAdminSession();

    const res = await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "invalid", grantee: "bob" });
    expect(res.status).toBe(400);
  });

  it("designer (has manage_access) can also POST grants", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const { cookie } = seedDesignerSession("des1");

    const res = await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "role", grantee: "analyst" });
    expect(res.status).toBe(201);
    expect(res.body.grants).toHaveLength(1);
    expect(res.body.grants[0].grantee_type).toBe("role");
    expect(res.body.grants[0].grantee).toBe("analyst");
  });
});

// ─── ENFORCE-V110-04: Audit rows ─────────────────────────────────────────────

describe("ENFORCE-V110-04: dual-sink audit on grant add/remove", () => {
  it("POST grant emits an rbac_audit row with action=dashboard_access_granted", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    const { cookie } = createAdminSession();

    const before = (db.prepare("SELECT COUNT(*) AS c FROM rbac_audit").get() as { c: number }).c;
    await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "bob" });

    const row = db
      .prepare("SELECT action, target FROM rbac_audit ORDER BY id DESC LIMIT 1")
      .get() as { action: string; target: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.action).toBe("dashboard_access_granted");
    expect(row!.target).toContain(String(dashA.id));
    expect(row!.target).toContain("user");
    expect(row!.target).toContain("bob");

    const after = (db.prepare("SELECT COUNT(*) AS c FROM rbac_audit").get() as { c: number }).c;
    expect(after).toBe(before + 1);
  });

  it("DELETE grant emits an rbac_audit row with action=dashboard_access_revoked", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann");
    const { cookie } = createAdminSession();

    await app
      .delete(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "ann" });

    const row = db
      .prepare("SELECT action, target FROM rbac_audit ORDER BY id DESC LIMIT 1")
      .get() as { action: string; target: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.action).toBe("dashboard_access_revoked");
    expect(row!.target).toContain(String(dashA.id));
    expect(row!.target).toContain("ann");
  });

  it("idempotent re-grant (POST on existing grant) does NOT emit a duplicate audit row", async () => {
    const app = await buildTestApp();
    const dashA = createDashboard("Dashboard A");
    addDashboardGrant(dashA.id, "user", "ann"); // pre-existing grant
    const { cookie } = createAdminSession();

    const countBefore = (db.prepare("SELECT COUNT(*) AS c FROM rbac_audit").get() as { c: number }).c;
    await app
      .post(`/api/dashboards/${dashA.id}/access`)
      .set("Cookie", cookie)
      .send({ grantee_type: "user", grantee: "ann" });
    const countAfter = (db.prepare("SELECT COUNT(*) AS c FROM rbac_audit").get() as { c: number }).c;

    // audit-on-change: idempotent re-grant should not add a row
    expect(countAfter).toBe(countBefore);
  });
});

// ─── Passthrough non-regression (ANALYST-PASSTHROUGH BOUNDARY) ───────────────

describe("Passthrough non-regression: analyst is not 404'd on table-scoped auth-only routes", () => {
  it("analyst session reaches GET /api/tables without 404 (not gated by canViewDashboard)", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("passthrough_analyst");
    const res = await app.get("/api/tables").set("Cookie", cookie);
    // GET /api/tables is requireAuth only — analyst gets 200 with empty array (or data),
    // never 404 from any canViewDashboard gate.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });
});
