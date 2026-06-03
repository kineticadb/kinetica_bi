/**
 * routes.discovery.spec.ts — Integration tests for the 3 discovery routes:
 *   GET /api/kinetica/schemas
 *   GET /api/kinetica/schemas/:schema/tables
 *   GET /api/kinetica/schemas/:schema/tables/:table/columns
 *
 * Tests that all 3 routes:
 *   - Use per-user credentials (NOT module env vars)
 *   - Emit audit log with op: "DISCOVERY"
 *   - Return 502 on any helper-thrown error (Phase 2 boundary)
 *   - Preserve existing client-facing response shapes
 *   - SQL-escape parameter values to prevent injection
 *   - Return existing { data: [...] } / { data: { col: type } } shapes
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-secret-pw";

const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

const successSchemasBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: ["public", "myschema"] }),
  }),
};

const successTablesBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: ["orders", "users"] }),
  }),
};

const successColumnsBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({
      column_1: ["id", "name"],
      column_2: ["int", "varchar"],
    }),
  }),
};

// Reused empty-body for SQL injection test (schemas don't exist but that's fine)
const emptyKineticaBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [] }),
  }),
};

describe("GET /api/kinetica/schemas with per-user credentials", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("happy path: returns { data: [schemas] } with per-user auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successSchemasBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.get("/api/kinetica/schemas").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: ["public", "myschema"] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/execute/sql");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`alice:${SESSION_PASSWORD}`);
    expect(decoded).not.toContain("admin-env-user");
  });

  it("uses per-user creds, not any env var (sentinel check)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successSchemasBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app.get("/api/kinetica/schemas").set("Cookie", cookie);

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded.startsWith("alice:")).toBe(true);
    expect(decoded).not.toContain("admin-env-user");
  });

  it("403 from Kinetica → 403 to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.get("/api/kinetica/schemas").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 from Kinetica → 401 + REAUTH_REQUIRED to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.get("/api/kinetica/schemas").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    expect(typeof res.body.error).toBe("string");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => /kbi_session=;/.test(c))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emits audit log with op: DISCOVERY", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successSchemasBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app.get("/api/kinetica/schemas").set("Cookie", cookie);
    const auditLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('"op":"DISCOVERY"'));
    expect(auditLine).toBeDefined();
  });

  it("restricted-user: returns only what Kinetica returns (no admin-cred fallback)", async () => {
    const restrictedBody = {
      status: "OK",
      data_str: JSON.stringify({
        json_encoded_response: JSON.stringify({ column_1: ["restricted_schema"] }),
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(restrictedBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.get("/api/kinetica/schemas").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: ["restricted_schema"] });
    // Only one fetch call — no fallback to admin creds that would show more schemas
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unauthenticated → 401 (Phase 1 behavior unchanged)", async () => {
    const app = await buildTestApp();
    const res = await app.get("/api/kinetica/schemas");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/kinetica/schemas/:schema/tables with per-user credentials", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("happy path: returns { data: [tables] } with schema param in SQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successTablesBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app
      .get("/api/kinetica/schemas/public/tables")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: ["orders", "users"] });

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.statement).toContain("TABLE_SCHEMA = 'public'");
  });

  it("per-user auth header: alice creds are forwarded NOT env vars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successTablesBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app.get("/api/kinetica/schemas/public/tables").set("Cookie", cookie);

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`alice:${SESSION_PASSWORD}`);
  });

  it("SQL-escape: single quotes in :schema are escaped to prevent injection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(emptyKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app
      .get("/api/kinetica/schemas/evil';DROP--/tables")
      .set("Cookie", cookie);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    // The single quote in "evil'" is escaped to "evil''"
    expect(sentBody.statement).toContain("'evil'';DROP--'");
  });

  it("403 from Kinetica → 403 to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app
      .get("/api/kinetica/schemas/public/tables")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network throw → 502 to client", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app
      .get("/api/kinetica/schemas/public/tables")
      .set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
  });
});

describe("GET /api/kinetica/schemas/:schema/tables/:table/columns with per-user credentials", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("happy path: returns { data: { col: type } } shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successColumnsBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app
      .get("/api/kinetica/schemas/public/tables/orders/columns")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: "int", name: "varchar" } });
  });

  it("per-user auth header: alice creds are forwarded NOT env vars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successColumnsBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app
      .get("/api/kinetica/schemas/public/tables/orders/columns")
      .set("Cookie", cookie);

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`alice:${SESSION_PASSWORD}`);
  });

  it("SQL-escape: single quotes in :schema and :table are escaped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(emptyKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app
      .get("/api/kinetica/schemas/evil';DROP--/tables/bad'table/columns")
      .set("Cookie", cookie);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.statement).toContain("'evil'';DROP--'");
    expect(sentBody.statement).toContain("'bad''table'");
  });

  it("403 from Kinetica → 403 to client (Phase 3 middleware)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app
      .get("/api/kinetica/schemas/public/tables/orders/columns")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emits audit log with op: DISCOVERY", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successColumnsBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    await app
      .get("/api/kinetica/schemas/public/tables/orders/columns")
      .set("Cookie", cookie);
    const auditLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('"op":"DISCOVERY"'));
    expect(auditLine).toBeDefined();
  });
});
