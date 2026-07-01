/**
 * routes.custom-metrics.spec.ts — Phase 99 Plan 01 (METRIC-V119-01/02)
 *
 * Integration supertests proving the per-table custom metrics CRUD endpoints
 * added in 99-01 Task 2. Covers:
 *
 *   READ (GET /api/tables/:tableId/custom-metrics):
 *     - 200 + { data: [] } for admin cookie (no rows seeded)
 *     - 200 for analyst cookie (read is ungated — NOT 403)
 *     - 401 for no cookie (requireAuth gate)
 *
 *   CREATE (POST /api/tables/:tableId/custom-metrics):
 *     - 201 for admin cookie — body has server-generated numeric id + echoed fields
 *     - 403 PERMISSION_DENIED for analyst cookie (datasets:manage gate)
 *     - 400 on empty/whitespace label
 *     - 400 on empty/whitespace expression
 *     - 409 on duplicate label same table (second POST with same label)
 *
 *   UPDATE (PUT /api/tables/:tableId/custom-metrics/:id):
 *     - 200 for admin — GET reflects new label/expression, still ONE row for that id
 *     - 403 PERMISSION_DENIED for analyst cookie
 *     - 409 on rename-to-existing-label (create A + B, PUT B's id with label A)
 *     - 404 on non-existent id
 *     - 200 on no-op save (PUT same label+expression) — existence-check semantics,
 *       NOT result.changes, so a no-op does NOT spuriously 404
 *
 *   DELETE (DELETE /api/tables/:tableId/custom-metrics/:id):
 *     - 403 PERMISSION_DENIED for analyst cookie
 *     - 204 for admin on existing id
 *     - 404 on second delete (id gone)
 *
 *   format_spec round-trip:
 *     - POST a JSON FormatSpec object, GET returns the deep-equal object
 *     - format_spec omitted -> stored + returned as null
 *
 *   Permission catalog parity:
 *     - PERMISSIONS still has exactly 18 keys
 *     - No custom-metrics-specific permission string exists
 *
 * AUTH-MODE NOTE: the JWT-cookie session path is auth-mode-agnostic.
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import { createSession } from "../src/sessionStore";
import { PERMISSIONS } from "../src/lib/permissions";
import jwt from "jsonwebtoken";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session. The user gets NO user_roles row -> analyst fallback.
 * Analyst has dashboards:view only — no datasets:manage.
 * Mirrors the seedAnalystSession idiom from routes.column-display-config.spec.ts.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM custom_metrics");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TABLE_ID = 42;

// ─── Read (GET) ───────────────────────────────────────────────────────────────

describe("GET /api/tables/:tableId/custom-metrics", () => {
  it("returns 200 + { data: [] } for admin with no rows seeded", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("returns 200 for analyst cookie (read is ungated — NOT 403)", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_reader");
    const res = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
  });

  it("returns 401 with no cookie (requireAuth gate)", async () => {
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${TABLE_ID}/custom-metrics`);
    expect(res.status).toBe(401);
  });

  it("returns 200 + row after a create for admin cookie", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Revenue Per Unit", expression: "SUM(revenue)/SUM(units)", format_spec: null });
    const res = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].label).toBe("Revenue Per Unit");
    expect(res.body.data[0].expression).toBe("SUM(revenue)/SUM(units)");
    expect(res.body.data[0].table_id).toBe(TABLE_ID);
  });
});

// ─── Create (POST) ────────────────────────────────────────────────────────────

describe("POST /api/tables/:tableId/custom-metrics", () => {
  it("admin: 201, body has server-generated numeric id + echoed label/expression/format_spec/table_id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const payload = {
      label: "Margin",
      expression: "SUM(revenue - cost) / SUM(revenue)",
      format_spec: { kind: "number", decimals: 2, percent: true },
    };
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send(payload);
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    expect(res.body.label).toBe("Margin");
    expect(res.body.expression).toBe("SUM(revenue - cost) / SUM(revenue)");
    expect(res.body.format_spec).toEqual(payload.format_spec);
    expect(res.body.table_id).toBe(TABLE_ID);
  });

  it("analyst: 403 PERMISSION_DENIED (datasets:manage gate)", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_writer");
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Forbidden", expression: "SUM(x)" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("400 on empty label", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "", expression: "SUM(x)" });
    expect(res.status).toBe(400);
  });

  it("400 on whitespace-only label", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "   ", expression: "SUM(x)" });
    expect(res.status).toBe(400);
  });

  it("400 on empty expression", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Margin", expression: "" });
    expect(res.status).toBe(400);
  });

  it("400 on whitespace-only expression", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Margin", expression: "   " });
    expect(res.status).toBe(400);
  });

  it("409 on duplicate label same table (second POST with same label)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Margin", expression: "SUM(revenue - cost)" });
    const res = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Margin", expression: "SUM(revenue) / SUM(cost)" });
    expect(res.status).toBe(409);
  });
});

// ─── Update (PUT) ─────────────────────────────────────────────────────────────

describe("PUT /api/tables/:tableId/custom-metrics/:id", () => {
  it("admin: 200, GET reflects new label/expression, still ONE row for that id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create a metric
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Original Label", expression: "SUM(x)" });
    expect(create.status).toBe(201);
    const { id } = create.body;
    // Update it
    const put = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie)
      .send({ label: "Updated Label", expression: "AVG(x)" });
    expect(put.status).toBe(200);
    expect(put.body.label).toBe("Updated Label");
    expect(put.body.expression).toBe("AVG(x)");
    expect(put.body.id).toBe(id);
    // GET should show exactly ONE row with the updated values
    const get = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(get.status).toBe(200);
    expect(get.body.data).toHaveLength(1);
    expect(get.body.data[0].label).toBe("Updated Label");
    expect(get.body.data[0].id).toBe(id);
  });

  it("analyst: 403 PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_updater");
    const res = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/999`)
      .set("Cookie", cookie)
      .send({ label: "Forbidden", expression: "SUM(x)" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("409 on rename-to-existing-label (create A + B, PUT B's id with label A)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Metric A", expression: "SUM(a)" });
    const createB = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Metric B", expression: "SUM(b)" });
    expect(createB.status).toBe(201);
    const bId = createB.body.id;
    // Rename B to A — should 409 (A already exists)
    const res = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/${bId}`)
      .set("Cookie", cookie)
      .send({ label: "Metric A", expression: "SUM(b)" });
    expect(res.status).toBe(409);
  });

  it("404 on non-existent id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/99999`)
      .set("Cookie", cookie)
      .send({ label: "Ghost", expression: "SUM(x)" });
    expect(res.status).toBe(404);
  });

  it("200 on no-op save (PUT same label+expression already stored) — existence-check semantics, NOT result.changes", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Stable Metric", expression: "SUM(revenue)" });
    expect(create.status).toBe(201);
    const { id } = create.body;
    // PUT the exact same label + expression — SQLite changes:0 but row exists
    const res = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie)
      .send({ label: "Stable Metric", expression: "SUM(revenue)" });
    // Must be 200, NOT 404 — updateCustomMetric uses existence-check semantics
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.label).toBe("Stable Metric");
  });
});

// ─── Delete (DELETE) ──────────────────────────────────────────────────────────

describe("DELETE /api/tables/:tableId/custom-metrics/:id", () => {
  it("analyst: 403 PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_deleter");
    const res = await app
      .delete(`/api/tables/${TABLE_ID}/custom-metrics/1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin: 204 on existing id; 404 on second delete (id gone)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create a metric first
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "To Delete", expression: "COUNT(*)" });
    expect(create.status).toBe(201);
    const { id } = create.body;
    // First delete -> 204
    const del1 = await app
      .delete(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie);
    expect(del1.status).toBe(204);
    // Second delete -> 404 (id no longer exists)
    const del2 = await app
      .delete(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie);
    expect(del2.status).toBe(404);
  });
});

// ─── Lifecycle (create -> update -> delete) ───────────────────────────────────

describe("Create -> update -> delete lifecycle", () => {
  it("full lifecycle: create 201 -> update 200 -> delete 204 -> GET shows empty", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Lifecycle Metric", expression: "SUM(sales)" });
    expect(create.status).toBe(201);
    const { id } = create.body;
    // Update
    const put = await app
      .put(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie)
      .send({ label: "Updated Metric", expression: "AVG(sales)" });
    expect(put.status).toBe(200);
    expect(put.body.label).toBe("Updated Metric");
    // Delete
    const del = await app
      .delete(`/api/tables/${TABLE_ID}/custom-metrics/${id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);
    // GET should show empty
    const get = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(get.status).toBe(200);
    expect(get.body.data).toHaveLength(0);
  });
});

// ─── format_spec round-trip ───────────────────────────────────────────────────

describe("format_spec round-trip", () => {
  it("POST a JSON FormatSpec object, GET returns the deep-equal object", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const formatSpec = {
      kind: "number",
      thousandsSep: true,
      decimals: 4,
      currency: null,
      percent: false,
    };
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "Formatted Metric", expression: "SUM(revenue)", format_spec: formatSpec });
    expect(create.status).toBe(201);
    expect(create.body.format_spec).toEqual(formatSpec);
    const get = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    expect(get.status).toBe(200);
    const row = get.body.data.find((r: { label: string }) => r.label === "Formatted Metric");
    expect(row).toBeDefined();
    expect(row.format_spec).toEqual(formatSpec);
  });

  it("format_spec omitted -> stored + returned as null", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const create = await app
      .post(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie)
      .send({ label: "No Format Metric", expression: "COUNT(*)" });
    expect(create.status).toBe(201);
    expect(create.body.format_spec).toBeNull();
    const get = await app
      .get(`/api/tables/${TABLE_ID}/custom-metrics`)
      .set("Cookie", cookie);
    const row = get.body.data.find((r: { label: string }) => r.label === "No Format Metric");
    expect(row).toBeDefined();
    expect(row.format_spec).toBeNull();
  });
});

// ─── Permission catalog parity ────────────────────────────────────────────────

describe("Permission catalog parity (METRIC-V119-02)", () => {
  it("PERMISSIONS catalog still has exactly 18 keys (no new custom-metrics permission)", () => {
    expect(Object.values(PERMISSIONS).length).toBe(18);
  });

  it("no custom-metrics-specific permission string exists in the catalog", () => {
    const hasCustomMetricsPermission = Object.values(PERMISSIONS).some((p) =>
      /custom.?metric|metrics:manage/i.test(p)
    );
    expect(hasCustomMetricsPermission).toBe(false);
  });
});
