/**
 * routes.materialize.spec.ts — Integration tests for POST /api/views/:id/materialize
 *
 * Tests that POST /api/views/:id/materialize:
 *   - Uses per-user credentials (NOT module-level admin env vars)
 *   - Returns 200 + { view: { status: "created" }, ddl } on success
 *   - Persists status="created" on success
 *   - Returns 502 + persists status="error" on Kinetica 403/400+access-denied
 *   - Returns 502 + persists status="error" on Kinetica 401
 *   - Returns 502 + persists status="error" on Kinetica 5xx
 *   - Returns 502 + persists status="error" when fetch throws
 *   - Emits audit log with op: "MATERIALIZE" (not "SQL")
 *   - Returns 404 if view not found
 *   - Returns 404 if source table not found
 *   - Does NOT leak credentials in persisted error_message
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createDashboard,
  createTable,
  createView,
  getView,
} from "../src/db";

// createAdminSession uses APP_ADMIN_USERNAME (default "admin") + "admin-test-secret"
const ADMIN_USERNAME = process.env.APP_ADMIN_USERNAME || "admin";
const ADMIN_SESSION_SECRET = "admin-test-secret";

// Seed a dashboard + table + view fixture
const seedFixture = () => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: "events", schema: "ki_home", columns: {} });
  const view = createView(dash.id, tbl.id, "events_view", "");
  return { dashId: dash.id, tableId: tbl.id, viewId: view.id, viewName: view.view_name };
};

const makeSessionCookie = () => createAdminSession();

// A Kinetica success response for DDL (materialize returns minimal data_str)
const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

describe("POST /api/views/:id/materialize with per-user credentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM dashboard_table_views");
    db.exec("DELETE FROM dashboard_tables");
    db.exec("DELETE FROM tables");
    db.exec("DELETE FROM dashboards");
  });

  it("happy path: per-user creds, returns 200 with view+ddl, persists status='created'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("view");
    expect(res.body.view.status).toBe("created");
    expect(res.body).toHaveProperty("ddl");
    expect(res.body.ddl).toContain("CREATE OR REPLACE MATERIALIZED VIEW");
    expect(res.body.ddl).toContain("events_view");
    expect(res.body.ddl).toContain("ki_home.events");
    // Persisted status must also be "created"
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("created");
    expect(persisted?.error_message).toBeUndefined();
  });

  it("forwards user creds (not admin env vars) to Kinetica Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`${ADMIN_USERNAME}:${ADMIN_SESSION_SECRET}`);
  });

  it("sends DDL statement: CREATE OR REPLACE MATERIALIZED VIEW <view_name> AS SELECT * FROM <schema>.<table>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { viewId, viewName } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.statement).toBe(
      `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS SELECT * FROM ki_home.events`
    );
  });

  it("403 from Kinetica → KineticaPermissionError → status='error' persisted, middleware returns 403 (Phase 3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBeUndefined();
    // Error message must not leak credentials
    expect(res.body.error).not.toContain("Basic ");
    expect(res.body.error).not.toContain(ADMIN_SESSION_SECRET);
    // DB persistence
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("error");
    expect(persisted?.error_message).toBeTruthy();
    expect(persisted?.error_message).not.toContain("Basic ");
    expect(persisted?.error_message).not.toContain(ADMIN_SESSION_SECRET);
  });

  it("400+access-denied from Kinetica (DDL denial) → KineticaPermissionError → status='error' persisted, middleware returns 403 (Phase 3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: "ERROR", message: "Access denied; ok" }),
          { status: 400 }
        )
      )
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBeUndefined();
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("error");
    expect(persisted?.error_message).toBeTruthy();
    // Must not leak credentials or raw Kinetica internals
    expect(persisted?.error_message).not.toContain("Basic ");
    expect(persisted?.error_message).not.toContain(ADMIN_SESSION_SECRET);
  });

  it("401 from Kinetica → KineticaAuthError → status='error' persisted, middleware returns 401 + REAUTH_REQUIRED (Phase 3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => /kbi_session=;/.test(c))).toBe(true);
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("error");
    expect(persisted?.error_message).toBeTruthy();
  });

  it("5xx from Kinetica → KineticaUpstreamError → status='error' persisted, middleware returns 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Internal Server Error", { status: 500 })
      )
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("error");
    expect(persisted?.error_message).toBeTruthy();
  });

  it("network throw → KineticaUpstreamError → status='error' persisted, middleware returns 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("error");
    expect(persisted?.error_message).toBeTruthy();
  });

  it("no double-persist on success: updateViewStatus called once, row has status='created' with no error_message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const persisted = getView(viewId);
    expect(persisted?.status).toBe("created");
    // error_message must be absent (null/undefined) on success
    expect(persisted?.error_message == null).toBe(true);
  });

  it("audit log uses op: MATERIALIZE (not SQL)", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const { viewId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    await agent
      .post(`/api/views/${viewId}/materialize`)
      .set("Cookie", cookie);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const matLine = lines.find((s) => s.includes('"op":"MATERIALIZE"'));
    expect(matLine).toBeDefined();
    // Must NOT be tagged as generic SQL
    const sqlLinesForMaterialize = lines.filter(
      (s) => s.includes('"op":"SQL"') && s.includes("MATERIALIZED")
    );
    expect(sqlLinesForMaterialize.length).toBe(0);
  });

  it("returns 404 if view not found (no Kinetica fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/views/99999/materialize")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("View not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 if source table not found (no Kinetica fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Create a view referencing a valid table, then delete the table while bypassing FK
    const dash = createDashboard("Test", "");
    const tbl = createTable({ name: "orphan", schema: "ki_home", columns: {} });
    const view = createView(dash.id, tbl.id, "orphan_view", "");
    // Temporarily disable FK constraints to delete the table without cascading view deletion
    db.pragma("foreign_keys = OFF");
    db.exec(`DELETE FROM tables WHERE id = ${tbl.id}`);
    db.pragma("foreign_keys = ON");
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent
      .post(`/api/views/${view.id}/materialize`)
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Source table not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when no session cookie (Phase 1 requireAuth behavior preserved)", async () => {
    const { viewId } = seedFixture();
    const agent = await buildTestApp();
    const res = await agent.post(`/api/views/${viewId}/materialize`);
    expect(res.status).toBe(401);
  });
});
