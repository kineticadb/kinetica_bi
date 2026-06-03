/**
 * routes.wms.cache-control.spec.ts — Cache-Control: no-store enforcement on GET /api/wms
 *
 * PITFALL M-08 lock: The browser HTTP cache is not auth-aware. If tiles are cached without
 * Cache-Control: no-store, a logged-out user or a user whose OIDC token has rotated can
 * receive stale tiles from a previous session. This spec enforces that the header is set
 * on every /api/wms response — including error paths where kineticaWms throws.
 *
 * These are the authoritative tests for the M-08 mitigation; routes.wms.spec.ts covers
 * the functional correctness of the WMS proxy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const SESSION_PASSWORD = "mapuser-secret";

// Minimal PNG header bytes (first 8 bytes of a valid PNG)
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Force password mode so the boot-time session-wipe does not purge the test session
// (the .env file has AUTH_MODE=oidc for dev; tests must override to avoid the wipe).
const stubPasswordMode = () => {
  vi.stubEnv("AUTH_MODE", "password");
};

const makeSessionCookie = (username = "mapuser") => {
  // Must be called AFTER stubPasswordMode() so the session is created after KINETICA_URL is stable
  const kineticaUrl = process.env.KINETICA_URL!;
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

describe("GET /api/wms Cache-Control: no-store enforcement (PITFALL M-08)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    vi.restoreAllMocks();
    stubPasswordMode();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET /api/wms responds with Cache-Control: no-store header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(PNG_HEADER, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      )
    );
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app
      .get("/api/wms?bbox=0,0,1,1&width=256&height=256")
      .set("Cookie", cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /api/wms sets Cache-Control even when upstream Kinetica errors", async () => {
    // Simulate a Kinetica upstream error (502 path — kineticaWms throws KineticaUpstreamError
    // because the upstream returned 500). The Cache-Control header is set BEFORE the
    // kineticaWms call in the route handler, so it must survive the error path.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }))
    );
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app
      .get("/api/wms?bbox=0,0,1,1")
      .set("Cookie", cookie);

    // The error middleware returns 502 because kineticaWms classifies 5xx as KineticaUpstreamError
    expect(res.status).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
