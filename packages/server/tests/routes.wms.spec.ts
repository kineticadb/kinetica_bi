/**
 * routes.wms.spec.ts — Integration tests for GET /api/wms
 *
 * Tests that GET /api/wms:
 *   - Routes through kineticaWms(req, ...) using per-user credentials (NOT module env vars)
 *   - Passes through binary tile bytes on success (Content-Type forwarded, Buffer sent)
 *   - Returns 502 on any helper-thrown error (Phase 2 boundary)
 *   - Emits audit log with op: "WMS" and does NOT include WMS query string (no bbox leakage)
 *   - Returns 401 on unauthenticated request (Phase 1 behavior)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";

const makeSessionCookie = () => createAdminSession();

// Minimal PNG header bytes (first 8 bytes of a valid PNG)
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("GET /api/wms with per-user credentials", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    vi.restoreAllMocks();
  });

  it("forwards user creds to Kinetica WMS and passes through binary tile body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(PNG_HEADER, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app
      .get("/api/wms?bbox=1,2,3,4&width=256&height=256")
      .set("Cookie", cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(res.body as Buffer, PNG_HEADER)).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // URL must contain /wms? with the query string
    expect(String(url)).toContain("/wms?");
    expect(String(url)).toContain("bbox=");
    // Authorization header must use session creds, not env vars
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded).toBe(`mapuser:${SESSION_PASSWORD}`);
  });

  it("per-user Authorization header is built from session creds, not from any env var (sentinel check)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(PNG_HEADER, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    await app
      .get("/api/wms?bbox=0,0,1,1")
      .set("Cookie", cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    expect(decoded.startsWith("mapuser:")).toBe(true);
    expect(decoded).not.toContain("admin-env-user");
  });

  it("returns 401 + REAUTH_REQUIRED on Kinetica 401 (Phase 3 middleware)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent.get("/api/wms?bbox=0,0,1,1").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => /kbi_session=;/.test(c))).toBe(true);
  });

  it("returns 403 on Kinetica 403 (permission denied — Phase 3 middleware)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent.get("/api/wms?bbox=0,0,1,1").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBeUndefined();
  });

  it("returns 502 on Kinetica 5xx (upstream error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }))
    );
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent.get("/api/wms?bbox=0,0,1,1").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBeUndefined();
  });

  it("returns 502 when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    const res = await agent.get("/api/wms?bbox=0,0,1,1").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
    expect(res.body.code).toBeUndefined();
  });

  it("audit log uses op: WMS and does NOT include bbox parameter", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(PNG_HEADER, { status: 200, headers: { "Content-Type": "image/png" } })
      )
    );
    const { cookie } = makeSessionCookie();
    const agent = await buildTestApp();
    await agent
      .get("/api/wms?bbox=99,99,100,100&width=512&height=512")
      .set("Cookie", cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    const auditLines = logSpy.mock.calls.map((c) => String(c[0]));
    const wmsLine = auditLines.find((s) => s.includes('"op":"WMS"'));
    expect(wmsLine).toBeDefined();
    // WMS query string must NOT appear in the audit log (CONTEXT.md OBS-01 + bbox location-intent)
    expect(wmsLine).not.toContain("bbox=");
    expect(wmsLine).not.toContain("99,99,100,100");
    expect(wmsLine).not.toContain("width=");
  });

  it("returns 401 when no session cookie is present (regression — Phase 1 behavior)", async () => {
    const agent = await buildTestApp();
    const res = await agent.get("/api/wms?bbox=0,0,1,1");
    expect(res.status).toBe(401);
  });
});
