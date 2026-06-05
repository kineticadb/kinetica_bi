/**
 * routes.sql.spec.ts — Integration tests for POST /api/sql
 *
 * Tests that POST /api/sql:
 *   - Routes through kineticaSql(req, ...) using per-user credentials (NOT module env vars)
 *   - Returns parsed encoded shape on success
 *   - Returns 502 on any helper-thrown error (Phase 2 boundary)
 *   - Forwards options as extra body fields
 *   - Never retries with admin creds
 *   - Returns 401 on unauthenticated request (Phase 1 behavior)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";

// createAdminSession uses APP_ADMIN_USERNAME (default "admin") + "admin-test-secret"
const ADMIN_USERNAME = process.env.APP_ADMIN_USERNAME || "admin";
const ADMIN_SESSION_SECRET = "admin-test-secret";

const makeSessionCookie = () => createAdminSession();

const successKineticaBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: ["one", "two"] }),
  }),
};

describe("POST /api/sql with per-user credentials", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("forwards user creds to Kinetica and returns parsed encoded shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ column_1: ["one", "two"] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/execute/sql");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`${ADMIN_USERNAME}:${ADMIN_SESSION_SECRET}`);
    // Must NOT be admin creds from env (module-level env vars)
    expect(decoded).not.toContain("admin-env-user");
  });

  it("per-user Authorization header is built from session creds, not from any env var (sentinel check)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    // Must be the session user (admin bootstrap), not a module-level env sentinel
    expect(decoded.startsWith(`${ADMIN_USERNAME}:`)).toBe(true);
    expect(decoded).not.toContain("admin-env-user");
  });

  it("401 from Kinetica → 401 + REAUTH_REQUIRED to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    expect(typeof res.body.error).toBe("string");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => /kbi_session=;/.test(c))).toBe(true);
    // Fetch called exactly once — no admin-cred fallback
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("403 from Kinetica → 403 to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx from Kinetica → 502 to client (KineticaUpstreamError)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network throw (fetch rejects) → 502 to client", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("options pass-through: extra options are merged into the Kinetica request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    await app
      .post("/api/sql")
      .set("Cookie", cookie)
      .send({ sql: "SELECT 1", options: { limit: 50 } });

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.limit).toBe(50);
  });

  it("no admin-cred fallback: fetch called exactly once even on error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });
    expect(res.status).toBe(403);
    // Exactly one call — no retry/fallback
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unauthenticated request (no cookie) → 401 from requireAuth (Phase 1 behavior unchanged)", async () => {
    const app = await buildTestApp();
    const res = await app.post("/api/sql").send({ sql: "SELECT 1" });
    expect(res.status).toBe(401);
  });

  it("missing sql field → 400 Bad Request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ options: {} });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
