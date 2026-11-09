// 144 (ACCESS-V21-02): callers who can view a dashboard and hold the permission still make every write they could before.
// DWOK-1/2 are non-regression guards: they pass before AND after the fix by design.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { enableAiEnv, sessionFor, makeRole, mockKinetica } from "./helpers/aiRouteKit";
import { DASHBOARD_WRITE_ROUTES, WRITE_PERMS, resetDwTables, resetDwContent, buildDwFixture, snapshotDashboard, sendDw } from "./helpers/dashboardWriteKit";

let restoreEnv: (() => void) | null = null;
let app: Express;
let callers: { name: string; cookie: string; custom: boolean }[];
let dee: string;

beforeEach(async () => {
  resetDwTables();
  restoreEnv = enableAiEnv();
  app = await createApp();
  vi.stubGlobal("fetch", vi.fn(mockKinetica()));
  dee = sessionFor("dee", ["designer"]).cookie;
  callers = [
    { name: "dina", cookie: sessionFor("dina", ["designer"]).cookie, custom: false }, // designer bypass
    { name: "adam", cookie: sessionFor("adam", ["admin"]).cookie, custom: false }, // admin bypass
    { name: "gus", cookie: sessionFor("gus", [makeRole("dw_grant_user", WRITE_PERMS)]).cookie, custom: true }, // per-user grant
    { name: "rita", cookie: sessionFor("rita", [makeRole("dw_grant_role", WRITE_PERMS)]).cookie, custom: true }, // per-role grant
  ];
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv?.();
  restoreEnv = null;
});

describe("dashboard write still allowed (DWOK)", () => {
  it("DWOK-1 every caller who can view the dashboard still gets the success status and the write happens", async () => {
    const mismatches: string[] = [];
    for (const c of callers) {
      for (const r of DASHBOARD_WRITE_ROUTES) {
        if (r.okStatus === null) continue;
        resetDwContent();
        const fx = buildDwFixture({ grantUsers: ["gus"], grantRoles: ["dw_grant_role"] });
        const before = snapshotDashboard(fx.D);
        const res = await sendDw(app, c.cookie, r.build(fx));
        // custom roles never hold dashboards:manage_access, before and after the fix
        const expected = r.manageAccess && c.custom ? 403 : r.okStatus;
        if (res.status !== expected) mismatches.push(`${c.name} ${r.key}: got ${res.status}, want ${expected}`);
        else if (expected === r.okStatus && snapshotDashboard(fx.D) === before) mismatches.push(`${c.name} ${r.key}: status ok but nothing written`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 30_000); // 4 callers x 20 routes; the default 5s can trip under full-suite parallel load

  it("DWOK-2 the creator can still write to their own unkept dashboard", async () => {
    const fx = buildDwFixture({ pendingBy: "dee" });
    const patch = await sendDw(app, dee, { method: "patch", path: `/api/dashboards/${fx.D}`, body: { name: "dee renamed" } });
    expect(patch.status).toBe(200);
    expect((db.prepare("SELECT name FROM dashboards WHERE id = ?").get(fx.D) as { name: string }).name).toBe("dee renamed");
    const widget = await sendDw(app, dee, { method: "post", path: `/api/dashboards/${fx.D}/widgets`, body: { title: "dee w", type: "table" } });
    expect(widget.status).toBe(201);
    const del = await sendDw(app, dee, { method: "delete", path: `/api/dashboards/${fx.D}` });
    expect(del.status).toBe(204);
    expect(db.prepare("SELECT id FROM dashboards WHERE id = ?").get(fx.D)).toBeUndefined();
  });
});
