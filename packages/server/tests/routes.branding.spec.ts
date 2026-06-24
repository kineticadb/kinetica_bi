/**
 * routes.branding.spec.ts — Phase 81 Plan 02 (BRANDFND-01, BRANDFND-02, SECA-V116-01)
 *
 * Integration supertests covering the 4 branding API routes added in 81-02:
 *
 *   GET /api/branding (unauthenticated):
 *     - 200 + { config, logoUrl: null } with no cookie
 *     - Cache-Control: no-cache, no-store
 *
 *   PUT /api/branding (branding:manage gated):
 *     - 401 with no session
 *     - 403 PERMISSION_DENIED with analyst session
 *     - 200 with admin session; subsequent GET reflects change
 *     - 400 with missing/invalid config
 *
 *   POST /api/branding/logo (branding:manage gated):
 *     - 401 with no session
 *     - 403 PERMISSION_DENIED with analyst session
 *     - 200 with admin session + valid PNG
 *     - 413 when file > 256 KB (multer size limit)
 *     - SVG <script> stripped before storage (honestly-labeled SVG)
 *     - SVG <script> stripped even when declared as Content-Type: image/png (mislabeled bypass)
 *
 *   GET /api/branding/logo (unauthenticated):
 *     - 404 with no logo stored
 *     - 200 + correct Content-Type + immutable Cache-Control after upload
 *
 * AUTH-MODE NOTE: the JWT-cookie session path is auth-mode-agnostic.
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
 * Analyst has no branding:manage permission.
 * Mirrors the seedAnalystSession idiom from routes.column-display-config.spec.ts.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Test data ────────────────────────────────────────────────────────────────

// Minimal valid 1x1 PNG (base64-encoded)
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec(
    "UPDATE brand_config SET config_json='{}', logo_data=NULL, logo_mime=NULL, logo_updated_at=NULL, updated_by=NULL WHERE id=1"
  );
});

// ─── Branding routes — AUTH_MODE=password ─────────────────────────────────────

describe("branding routes — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── GET /api/branding (unauthenticated) ─────────────────────────────────────

  it("GET /api/branding with no cookie returns 200 + config/logoUrl", async () => {
    const app = await buildTestApp();
    const res = await app.get("/api/branding");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("config");
    expect(typeof res.body.config).toBe("object");
    expect(res.body.logoUrl).toBeNull();
  });

  it("GET /api/branding has Cache-Control: no-cache, no-store", async () => {
    const app = await buildTestApp();
    const res = await app.get("/api/branding");
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  // ── PUT /api/branding auth gating ───────────────────────────────────────────

  it("PUT /api/branding with no cookie returns 401", async () => {
    const app = await buildTestApp();
    const res = await app.put("/api/branding").send({ config: { appName: "X" } });
    expect(res.status).toBe(401);
  });

  it("PUT /api/branding with analyst cookie returns 403 PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("branding_analyst");
    const res = await app
      .put("/api/branding")
      .set("Cookie", cookie)
      .send({ config: { appName: "X" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("PUT /api/branding with admin cookie + valid body returns 200 and persists", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();

    const putRes = await app
      .put("/api/branding")
      .set("Cookie", cookie)
      .send({ config: { appName: "Acme Corp", customCss: "button { color: red }" } });
    expect(putRes.status).toBe(200);
    expect(putRes.body.config.appName).toBe("Acme Corp");

    // Subsequent unauthenticated GET must reflect the change
    const getRes = await app.get("/api/branding");
    expect(getRes.status).toBe(200);
    expect(getRes.body.config.appName).toBe("Acme Corp");
  });

  it("PUT /api/branding with missing config body returns 400", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .put("/api/branding")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  // ── POST /api/branding/logo auth gating ─────────────────────────────────────

  it("POST /api/branding/logo with no cookie returns 401", async () => {
    const app = await buildTestApp();
    const res = await app
      .post("/api/branding/logo")
      .attach("logo", PNG_1x1, "logo.png");
    expect(res.status).toBe(401);
  });

  it("POST /api/branding/logo with analyst cookie returns 403 PERMISSION_DENIED", async () => {
    const app = await buildTestApp();
    const { cookie } = seedAnalystSession("branding_analyst2");
    const res = await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", PNG_1x1, "logo.png");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  // ── POST /api/branding/logo upload behaviors ─────────────────────────────────

  it("POST /api/branding/logo with admin + valid PNG returns 200 + logoUrl", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", PNG_1x1, "logo.png");
    expect(res.status).toBe(200);
    expect(typeof res.body.logoUrl).toBe("string");
    expect(res.body.logoUrl).toContain("/api/branding/logo?v=");
  });

  it("POST /api/branding/logo with file > 256 KB returns 413", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const bigBuffer = Buffer.alloc(300 * 1024, 0x00);
    const res = await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", bigBuffer, "big.png");
    expect(res.status).toBe(413);
  });

  // ── GET /api/branding/logo serve behaviors ───────────────────────────────────

  it("GET /api/branding/logo with no logo stored returns 404", async () => {
    const app = await buildTestApp();
    const res = await app.get("/api/branding/logo");
    expect(res.status).toBe(404);
  });

  it("GET /api/branding/logo after PNG upload returns 200 + correct content-type + immutable cache", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();

    // Upload
    await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", PNG_1x1, "logo.png");

    // Serve
    const res = await app.get("/api/branding/logo");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  // ── SVG sanitization (honestly-labeled) ──────────────────────────────────────

  it("POST /api/branding/logo: SVG with <script> is sanitized before storage (honestly labeled)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const evilSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>'
    );

    const res = await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", evilSvg, "evil.svg");
    expect(res.status).toBe(200);

    const row = db
      .prepare("SELECT logo_data, logo_mime FROM brand_config WHERE id=1")
      .get() as { logo_data: string; logo_mime: string };
    const decoded = Buffer.from(row.logo_data, "base64").toString("utf-8");
    expect(decoded).not.toContain("<script");
    expect(row.logo_mime).toBe("image/svg+xml");
  });

  // ── SVG MIME-bypass (Pitfall 2 — mislabeled SVG sent as image/png) ───────────
  // This is the security regression that SECA-V116-01 closes. An attacker sends SVG
  // bytes but declares Content-Type: image/png, hoping file-type returns undefined
  // (it always does for SVG — no magic bytes) and the client MIME skips DOMPurify.
  // The content-sniff path must catch this and sanitize before storage.

  it("POST /api/branding/logo: mislabeled SVG (declared image/png) is sanitized + stored as image/svg+xml", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const evilSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>'
    );

    const res = await app
      .post("/api/branding/logo")
      .set("Cookie", cookie)
      .attach("logo", evilSvg, { filename: "evil.png", contentType: "image/png" });
    expect(res.status).toBe(200); // content-sniffed as SVG, sanitized, stored

    const row = db
      .prepare("SELECT logo_data, logo_mime FROM brand_config WHERE id=1")
      .get() as { logo_data: string; logo_mime: string };
    const decoded = Buffer.from(row.logo_data, "base64").toString("utf-8");
    expect(decoded).not.toContain("<script"); // script stripped BEFORE storage
    expect(row.logo_mime).toBe("image/svg+xml"); // stored as SVG, not the spoofed image/png

    // Subsequent GET also serves it as SVG with no script
    const serveRes = await app.get("/api/branding/logo");
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers["content-type"]).toContain("image/svg+xml");
    const servedBody = serveRes.text ?? serveRes.body.toString();
    expect(servedBody).not.toContain("<script");
  });
});
