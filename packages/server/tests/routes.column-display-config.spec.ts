/**
 * routes.column-display-config.spec.ts — Phase 75 Plan 01 (COLCFG-V115-01)
 *
 * Integration supertests proving the per-table column display config CRUD
 * endpoints added in 75-01 Task 2. Covers:
 *
 *   READ (GET /api/tables/:tableId/column-display-config):
 *     - 200 + { data: [...] } for admin cookie
 *     - 200 for analyst cookie (read is ungated)
 *     - 401 for no cookie (requireAuth gate)
 *
 *   UPSERT (PUT /api/tables/:tableId/column-display-config/:columnName):
 *     - 200 for admin cookie — body has label + format_spec matching what was sent
 *     - 403 PERMISSION_DENIED for analyst cookie (datasets:manage gate)
 *
 *   DELETE (DELETE /api/tables/:tableId/column-display-config/:columnName):
 *     - 403 PERMISSION_DENIED for analyst cookie
 *     - 204 for admin on an existing row; 404 on second delete (key missing)
 *
 *   Upsert idempotency:
 *     - Two PUTs on the same (tableId, columnName) with different label → second
 *       succeeds (no 409), GET shows updated label, only ONE row exists.
 *
 *   format_spec round-trip:
 *     - PUT with a JSON FormatSpecNumber object, GET returns the identical object.
 *
 * AUTH-MODE NOTE: the JWT-cookie session path is auth-mode-agnostic.
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import { createSession } from "../src/sessionStore";
import jwt from "jsonwebtoken";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session. The user gets NO user_roles row → analyst fallback.
 * Analyst has dashboards:view only — no datasets:manage.
 * Mirrors the seedAnalystSession idiom from routes.dashboard-access.spec.ts.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM column_display_config");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TABLE_ID = 42;
const COL_NAME = "price";
const COL_NAME_2 = "quantity";

// ─── Read (GET) ───────────────────────────────────────────────────────────────

describe("GET /api/tables/:tableId/column-display-config", () => {
  it("returns 200 + { data: [] } for admin with no rows seeded", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .get(`/api/tables/${TABLE_ID}/column-display-config`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("returns 200 + row after an upsert for admin cookie", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Seed a row via PUT
    await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Unit Price", format_spec: null });
    const res = await app
      .get(`/api/tables/${TABLE_ID}/column-display-config`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].column_name).toBe(COL_NAME);
    expect(res.body.data[0].label).toBe("Unit Price");
  });

  it("returns 200 for analyst cookie (read is ungated — not 403)", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_reader");
    const res = await app
      .get(`/api/tables/${TABLE_ID}/column-display-config`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
  });

  it("returns 401 with no cookie (requireAuth gate)", async () => {
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${TABLE_ID}/column-display-config`);
    expect(res.status).toBe(401);
  });
});

// ─── Upsert (PUT) ────────────────────────────────────────────────────────────

describe("PUT /api/tables/:tableId/column-display-config/:columnName", () => {
  it("admin: 200, body has label + format_spec matching what was sent", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const payload = {
      label: "Price",
      format_spec: { kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false },
    };
    const res = await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Price");
    expect(res.body.format_spec).toEqual(payload.format_spec);
    expect(res.body.column_name).toBe(COL_NAME);
    expect(res.body.table_id).toBe(TABLE_ID);
  });

  it("analyst: 403 PERMISSION_DENIED (datasets:manage gate)", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_writer");
    const res = await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Forbidden Label" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });
});

// ─── Delete (DELETE) ──────────────────────────────────────────────────────────

describe("DELETE /api/tables/:tableId/column-display-config/:columnName", () => {
  it("analyst: 403 PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("analyst_deleter");
    const res = await app
      .delete(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin: 204 on existing row; 404 on second delete (key missing)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Seed a row
    await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Price" });
    // First delete → 204
    const del1 = await app
      .delete(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie);
    expect(del1.status).toBe(204);
    // Second delete → 404 (row no longer exists)
    const del2 = await app
      .delete(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie);
    expect(del2.status).toBe(404);
  });
});

// ─── Upsert idempotency ───────────────────────────────────────────────────────

describe("Upsert idempotency", () => {
  it("two PUTs on same (tableId, columnName) with different label: second succeeds (no 409), GET shows updated label, only ONE row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // First upsert
    const put1 = await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Original Label" });
    expect(put1.status).toBe(200);
    expect(put1.body.label).toBe("Original Label");
    // Second upsert — different label, same key
    const put2 = await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Updated Label" });
    expect(put2.status).toBe(200);
    expect(put2.body.label).toBe("Updated Label");
    // GET should show only ONE row with the updated label
    const get = await app
      .get(`/api/tables/${TABLE_ID}/column-display-config`)
      .set("Cookie", cookie);
    expect(get.status).toBe(200);
    expect(get.body.data).toHaveLength(1);
    expect(get.body.data[0].label).toBe("Updated Label");
  });
});

// ─── format_spec round-trip ───────────────────────────────────────────────────

describe("format_spec round-trip", () => {
  it("PUT with a JSON FormatSpec object, GET returns the identical object (deep-equal)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const formatSpec = {
      kind: "number",
      thousandsSep: true,
      decimals: 2,
      currency: "$",
      percent: false,
    };
    await app
      .put(`/api/tables/${TABLE_ID}/column-display-config/${COL_NAME}`)
      .set("Cookie", cookie)
      .send({ label: "Price", format_spec: formatSpec });
    const get = await app
      .get(`/api/tables/${TABLE_ID}/column-display-config`)
      .set("Cookie", cookie);
    expect(get.status).toBe(200);
    const row = get.body.data.find((r: { column_name: string }) => r.column_name === COL_NAME);
    expect(row).toBeDefined();
    expect(row.format_spec).toEqual(formatSpec);
  });
});
