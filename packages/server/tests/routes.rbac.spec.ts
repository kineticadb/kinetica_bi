/**
 * routes.rbac.spec.ts — Plan 47-02 TDD RED→GREEN coverage for requirePermission factory.
 *
 * Tests the requirePermission(permission) factory in isolation by mounting a minimal
 * throwaway Express app with a gated test route. Does NOT depend on the full createApp()
 * route surface — this keeps the contract crisp and deterministic.
 *
 * Coverage:
 *   Test 1 (admin pass):    createAdminSession() cookie → 200 { ok: true }
 *   Test 2 (holder pass):   user with designer role (dashboards:create) → 200 { ok: true }
 *   Test 3 (non-holder deny): unassigned analyst-fallback user → 403 PERMISSION_DENIED body
 *   Test 4 (denial log):    403 response emits one OBS-01 JSON log line with all required fields
 *   Test 5 (unauth → 401):  no cookie → 401 from requireAuth (NOT 403 from rbacCheck)
 *
 * AUTH_MODE-agnostic: does NOT mock openid-client; test app is built directly from
 * express + requireAuth; does NOT call createApp() (avoids OIDC discovery).
 *
 * GUARD-V18-01 deliverable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

import { requirePermission } from "../src/rbac";
import { requireAuth } from "../src/auth";
import { PERMISSIONS } from "../src/lib/permissions";
import { db } from "../src/db";
import { createAdminSession } from "./helpers/db";
import { createSession } from "../src/sessionStore";
import jwt from "jsonwebtoken";

// ─── Throwaway test app ───────────────────────────────────────────────────────

const buildRbacTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mirror production: global requireAuth on /api, then the gated route.
  app.use("/api", requireAuth);
  app.post(
    "/api/__test/gated",
    ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE),
    (_req, res) => res.json({ ok: true })
  );

  return app;
};

// ─── Session helpers ──────────────────────────────────────────────────────────

const seedDesignerSession = (): { cookie: string } => {
  const username = "designer-user";
  const AUTH_SECRET = process.env.AUTH_SECRET!;
  const kineticaUrl = process.env.KINETICA_URL!;

  // Insert a user_roles row for designer role (look up designer role id from roles table).
  const row = db
    .prepare<[], { id: number }>("SELECT id FROM roles WHERE name = 'designer'")
    .get();
  if (!row) throw new Error("designer role not found in roles table — RBAC seed may not have run");
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run(
    username,
    row.id
  );

  const sid = createSession({ username, secret: "designer-pw", kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

const seedAnalystSession = (): { cookie: string } => {
  // "analyst-user" has NO user_roles row → falls back to analyst permissions.
  // Analyst only has dashboards:view, NOT dashboards:create → should be denied.
  const username = "analyst-user";
  const AUTH_SECRET = process.env.AUTH_SECRET!;
  const kineticaUrl = process.env.KINETICA_URL!;

  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("requirePermission factory — GUARD-V18-01", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM user_roles");
  });

  it("Test 1 (admin pass): createAdminSession() cookie reaches handler → 200 { ok: true }", async () => {
    const app = buildRbacTestApp();
    const { cookie } = createAdminSession();
    const res = await request(app)
      .post("/api/__test/gated")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("Test 2 (holder pass): designer user (has dashboards:create) → 200 { ok: true }", async () => {
    const app = buildRbacTestApp();
    const { cookie } = seedDesignerSession();
    const res = await request(app)
      .post("/api/__test/gated")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("Test 3 (non-holder deny): analyst-fallback user lacks dashboards:create → 403 PERMISSION_DENIED", async () => {
    const app = buildRbacTestApp();
    const { cookie } = seedAnalystSession();
    const res = await request(app)
      .post("/api/__test/gated")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect(res.body.permission).toBe(PERMISSIONS.DASHBOARDS_CREATE);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("Test 4 (denial log): denial emits one OBS-01 JSON log line with required fields", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = buildRbacTestApp();
    const { cookie } = seedAnalystSession();
    await request(app)
      .post("/api/__test/gated")
      .set("Cookie", cookie)
      .send({});

    const logLines = logSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(String(args[0])); } catch { return null; }
      })
      .filter(Boolean) as Record<string, unknown>[];

    const denialLine = logLines.find((l) => l.event === "permission_denied");
    expect(denialLine).toBeDefined();
    expect(denialLine!.outcome).toBe("denied");
    expect(denialLine!.permission).toBe(PERMISSIONS.DASHBOARDS_CREATE);
    expect(typeof denialLine!.username).toBe("string");
    expect(denialLine!.method).toBe("POST");
    expect(typeof denialLine!.route).toBe("string");
    expect(denialLine!.level).toBe("warn");
  });

  it("Test 5 (unauth → 401): no cookie returns 401 from requireAuth (not 403 from rbacCheck)", async () => {
    const app = buildRbacTestApp();
    const res = await request(app)
      .post("/api/__test/gated")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
  });
});
