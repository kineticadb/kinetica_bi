/**
 * errorMiddleware.spec.ts — Integration tests for the global Express error-handling middleware
 *
 * Tests the middleware translation rules:
 *   - KineticaAuthError   → 401 + { error, code: "REAUTH_REQUIRED" } + clearSessionCookie
 *   - KineticaPermissionError → 403 + { error } (NO code field)
 *   - KineticaUpstreamError   → 502 + { error } (NO code field)
 *   - Generic Error / TypeError → 500 + { error: "Internal server error" } + console.error
 *
 * Tests 1-4 are it.todo placeholders because:
 *   - The routes' try/catch blocks currently intercept typed errors and return 502 directly.
 *   - Plan 03-02 strips those try/catches so typed errors bubble to the middleware.
 *   - Plan 03-02 will convert these todos to live it() tests.
 *
 * Test 5 is live: it constructs a minimal inline Express app mounting the exported
 * `errorMiddleware` and exercises it with a plain Error (non-typed), which the middleware
 * handles directly (no route try/catch in the way).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";
import { errorMiddleware } from "../src/index";

// Save a reference to the Fetch API Response constructor BEFORE Express's Response type
// shadows the identifier name in this module's scope. The Express `Response` import (line above)
// shadows the global `Response` (Fetch API), so tests that do `new Response(...)` would fail
// with "Response is not a constructor". Using FetchResponse alias preserves both.
const FetchResponse = globalThis.Response;

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-secret-pw";

const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

describe("errorMiddleware", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Tests 1-4: Activated in Plan 03-02 after route try/catches are stripped.
  // Routes no longer catch typed errors — they bubble to errorMiddleware.
  // ------------------------------------------------------------------

  // Test 1: KineticaAuthError — after Plan 03-02 strips try/catch, middleware returns 401 + REAUTH_REQUIRED.
  it("401 from Kinetica → BI app returns 401 with code:REAUTH_REQUIRED and clears the session cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new FetchResponse("Unauthorized", { status: 401 }))
    );
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    expect(typeof res.body.error).toBe("string");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => /kbi_session=;/.test(c))).toBe(true);
  });

  // Test 2: KineticaPermissionError — after Plan 03-02 strips try/catch, middleware returns 403 with no code field.
  it("403 from Kinetica → BI app returns 403 with NO code field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new FetchResponse("Forbidden", { status: 403 }))
    );
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
  });

  // Test 3: KineticaUpstreamError (5xx from Kinetica) — middleware returns 502 with no code field.
  it("500 from Kinetica → BI app returns 502 with NO code field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new FetchResponse("Internal Server Error", { status: 500 }))
    );
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
  });

  // Test 4: KineticaUpstreamError (network throw) — same as above.
  it("network throw → BI app returns 502 with NO code field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { cookie } = makeSessionCookie("alice");
    const app = await buildTestApp();
    const res = await app.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
  });

  // ------------------------------------------------------------------
  // Test 5 (live): Construct a minimal inline Express app that directly
  // mounts errorMiddleware and exercises the non-typed Error → 500 path.
  // This test does NOT go through the production routes (no try/catch in the way).
  // ------------------------------------------------------------------
  it("non-typed thrown Error → BI app returns 500 with generic message", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const testApp = express();
    testApp.get("/throw", (_req: Request, _res: Response, next: NextFunction) => {
      next(new Error("synthetic test error"));
    });
    testApp.use(errorMiddleware);

    const agent = request(testApp);
    const res = await agent.get("/throw");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((consoleSpy.mock.calls[0][0] as Error).message).toBe("synthetic test error");
  });
});
