/**
 * auth.login-rbac.spec.ts — regression for the post-Phase-48 login-shape gap.
 *
 * Bug (operator-reported 2026-06-06): POST /api/auth/login returned
 * `{ user: { username } }` WITHOUT roles/permissions, so a fresh login rendered
 * the analyst UI (no User Management / Roles nav, inert grid) until a page
 * refresh re-ran bootstrap (/me, which Phase 48 DID widen). The login response
 * must mirror /me: `{ user: { username, roles, permissions } }`.
 *
 * Deterministic + standalone: mocks ONLY verifyKineticaCredentials (passthrough
 * for the rest of ../src/auth) so it stays out of the TD-V13-01 fetch-mock
 * flake class. Mirrors the self-contained-mock precedent of
 * boot.rbacAdminWarning.spec.ts.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

vi.mock("../src/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth")>();
  return {
    ...actual,
    verifyKineticaCredentials: vi.fn(async () => ({ ok: true as const })),
  };
});

import { db } from "../src/db";
import { ALL_PERMISSIONS, DEFAULT_ROLE_MAPPINGS } from "../src/lib/permissions";

let app: Express;

beforeAll(async () => {
  process.env.AUTH_MODE = "password";
  process.env.KINETICA_URL = process.env.KINETICA_URL || "http://kinetica.test:9191";
  const { createApp } = await import("../src/index");
  app = await createApp();
});

describe("POST /api/auth/login — RBAC shape (post-48 gap regression)", () => {
  it("bootstrap admin login returns roles + ALL permissions (no refresh needed)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "pw" });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("admin");
    expect(res.body.user.roles).toContain("admin");
    expect(res.body.user.permissions).toEqual(
      expect.arrayContaining([...ALL_PERMISSIONS]),
    );
    expect(res.body.user.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it("unassigned user login returns analyst-fallback permissions", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "fresh_user_login_shape", password: "pw" });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual(["analyst"]);
    expect(res.body.user.permissions).toEqual(
      expect.arrayContaining([...DEFAULT_ROLE_MAPPINGS.analyst]),
    );
  });

  it("user with explicit role assignment returns that role's permissions at login", async () => {
    const roleId = (db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number }).id;
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("login_shape_designer", roleId);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "login_shape_designer", password: "pw" });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual(["designer"]);
    expect(res.body.user.permissions).toEqual(
      expect.arrayContaining(["dashboards:edit", "widgets:configure"]),
    );
    expect(res.body.user.permissions).not.toContain("users:assign_roles");
  });
});
