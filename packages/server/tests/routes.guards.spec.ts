/**
 * routes.guards.spec.ts — Phase 47 Plan 03 (GUARD-V18-02, GUARD-V18-03)
 *
 * Spot-checks the Plan-02 requirePermission factory ACROSS REAL routes:
 *
 *   (a) A non-holder session → 403 PERMISSION_DENIED on mutation routes:
 *         POST /api/dashboards, PATCH /api/widgets/:id, POST /api/tables
 *
 *   (b) An analyst session reaches passthrough routes WITHOUT 403:
 *         POST /api/filter/materialize, POST /api/sql, POST /api/info/query, GET /api/wms
 *         All may return 4xx/5xx from Kinetica mocks but NEVER 403 PERMISSION_DENIED.
 *
 * The analyst session is seeded with user_roles (analyst role only, no write permissions).
 * This confirms the analyst-passthrough boundary is correctly placed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import jwt from "jsonwebtoken";
import { createSession } from "../src/sessionStore";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Creates a non-admin session for a user seeded with analyst role only.
 * Analyst has only dashboards:view — NO write/management permissions.
 */
const createAnalystSession = (username = "guardtest_analyst") => {
  const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number } | undefined;
  if (analystRole) {
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, analystRole.id);
  }
  const sid = createSession({ username, secret: "analyst-test-secret", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM user_roles");
});

// ─── (a) Non-holder → 403 PERMISSION_DENIED on gated mutation routes ─────────

describe("GUARD-V18-02: non-holder gets 403 on gated mutation routes", () => {
  it("POST /api/dashboards → 403 PERMISSION_DENIED for analyst session", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/dashboards").set("Cookie", cookie).send({ name: "test" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe("dashboards:create");
  });

  it("PATCH /api/widgets/:id → 403 PERMISSION_DENIED for analyst session", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    // Create a widget first using admin session
    const { cookie: adminCookie } = createAdminSession();
    const dash = await app.post("/api/dashboards").set("Cookie", adminCookie).send({ name: "guard test dash" });
    const widget = await app.post(`/api/dashboards/${dash.body.id}/widgets`).set("Cookie", adminCookie).send({ title: "w", type: "bar" });
    // Now try to patch with analyst — must 403
    const res = await app.patch(`/api/widgets/${widget.body.id}`).set("Cookie", cookie).send({ config: {} });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe("widgets:configure");
  });

  it("POST /api/tables → 403 PERMISSION_DENIED for analyst session", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/tables").set("Cookie", cookie).send({ name: "test_table", schema: "demo" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe("datasets:manage");
  });

  it("admin session → POST /api/dashboards succeeds (201)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/dashboards").set("Cookie", cookie).send({ name: "admin dash" });
    expect(res.status).toBe(201);
  });
});

// ─── (b) Analyst passthrough routes — NEVER return 403 PERMISSION_DENIED ────

describe("GUARD-V18-03: analyst session can reach passthrough routes (no 403)", () => {
  it("POST /api/filter/materialize does NOT return 403 PERMISSION_DENIED for analyst", async () => {
    // Mock Kinetica to avoid real network calls; any non-403 response is acceptable.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), { status: 200 })
    ));
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: 1, tableId: 1, filters: [] });
    // Must NOT be 403 PERMISSION_DENIED (may be other error from Kinetica or missing KINETICA_URL)
    expect(res.body.code).not.toBe("PERMISSION_DENIED");
    expect(res.status).not.toBe(403);
    vi.unstubAllGlobals();
  });

  it("POST /api/sql does NOT return 403 PERMISSION_DENIED for analyst", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK", data: [] }), { status: 200 })
    ));
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/sql")
      .set("Cookie", cookie)
      .send({ sql: "SELECT 1", options: {} });
    expect(res.body.code).not.toBe("PERMISSION_DENIED");
    expect(res.status).not.toBe(403);
    vi.unstubAllGlobals();
  });

  it("POST /api/info/query does NOT return 403 PERMISSION_DENIED for analyst", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK", data: [] }), { status: 200 })
    ));
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/info/query")
      .set("Cookie", cookie)
      .send({
        layerId: 1,
        dashboardId: 1,
        lon: 0,
        lat: 0,
        radiusPx: 10,
        mapBbox: { minLon: -1, maxLon: 1, minLat: -1, maxLat: 1 },
        mapWidthPx: 800,
        mapHeightPx: 600,
      });
    expect(res.body.code).not.toBe("PERMISSION_DENIED");
    expect(res.status).not.toBe(403);
    vi.unstubAllGlobals();
  });

  it("GET /api/wms does NOT return 403 PERMISSION_DENIED for analyst", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("PNG", { status: 200 })
    ));
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.get("/api/wms")
      .set("Cookie", cookie)
      .query({ LAYERS: "test", WIDTH: "256", HEIGHT: "256" });
    expect(res.body.code).not.toBe("PERMISSION_DENIED");
    expect(res.status).not.toBe(403);
    vi.unstubAllGlobals();
  });
});
