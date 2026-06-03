/**
 * routes.wms.capabilities.spec.ts — GET /api/wms/capabilities route spec
 *
 * Phase 11 Plan 03 Task 2 (MAP-01, MAP-02)
 *
 * Tests:
 *   - Route returns JSON with the locked WmsCapabilities shape (renderModes, colormaps,
 *     spatialModes, srs, source fields)
 *   - Route sets Cache-Control: private, max-age=300 (browser-cacheable for 5 min,
 *     NOT no-store — capabilities don't encode per-user state or auth-sensitive data)
 *
 * Note: The spec mocks getCachedCapabilities at the module level to avoid a real HTTP call
 * to Kinetica. The wmsCapabilities.spec.ts suite covers the parser + cache logic directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";

// Mock the wmsCapabilities module so getCachedCapabilities returns a fixed shape
// and does NOT hit the real Kinetica network.
vi.mock("../src/wmsCapabilities", () => ({
  getCachedCapabilities: vi.fn().mockResolvedValue({
    renderModes: ["raster", "heatmap"],
    colormaps: ["viridis", "plasma"],
    spatialModes: ["latlon", "wkt", "wkb"],
    srs: ["EPSG:3857", "EPSG:900913"],
    source: "probed",
  }),
  // parseWmsCapabilities is not used in the route but must be present so the import succeeds
  parseWmsCapabilities: vi.fn(),
  __resetCacheForTest: vi.fn(),
}));

const AUTH_SECRET = process.env.AUTH_SECRET!;
const SESSION_PASSWORD = "wmsuser-secret";

const stubPasswordMode = () => {
  vi.stubEnv("AUTH_MODE", "password");
};

const makeSessionCookie = (username = "wmsuser") => {
  const kineticaUrl = process.env.KINETICA_URL!;
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

describe("GET /api/wms/capabilities route (Phase 11 Plan 03)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    vi.restoreAllMocks();
    stubPasswordMode();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET /api/wms/capabilities returns JSON with renderModes, colormaps, spatialModes, srs, source fields", async () => {
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app
      .get("/api/wms/capabilities")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty("renderModes");
    expect(body).toHaveProperty("colormaps");
    expect(body).toHaveProperty("spatialModes");
    expect(body).toHaveProperty("srs");
    expect(body).toHaveProperty("source");
    expect(Array.isArray(body["renderModes"])).toBe(true);
    expect(Array.isArray(body["colormaps"])).toBe(true);
    expect(Array.isArray(body["spatialModes"])).toBe(true);
    expect(Array.isArray(body["srs"])).toBe(true);
  });

  it("GET /api/wms/capabilities sets Cache-Control: private, max-age=300", async () => {
    const { cookie } = makeSessionCookie();
    const app = await buildTestApp();
    const res = await app
      .get("/api/wms/capabilities")
      .set("Cookie", cookie);

    expect(res.headers["cache-control"]).toBe("private, max-age=300");
  });
});
