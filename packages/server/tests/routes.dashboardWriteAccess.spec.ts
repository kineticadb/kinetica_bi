// 144 (ACCESS-V21-01): a caller who cannot view a dashboard cannot write to it or its children; same 404 as opening it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { enableAiEnv, sessionFor, makeRole, mockKinetica } from "./helpers/aiRouteKit";
import { DASHBOARD_WRITE_ROUTES, WRITE_PERMS, resetDwTables, resetDwContent, buildDwFixture, snapshotDashboard, sendDw } from "./helpers/dashboardWriteKit";

const NOT_FOUND = { error: "Dashboard not found." };
let restoreEnv: (() => void) | null = null;
let app: Express;
let fetchSpy: ReturnType<typeof vi.fn>;
let sam: string;
let carl: string;
let ana: string;
let dee: string;

beforeEach(async () => {
  resetDwTables();
  restoreEnv = enableAiEnv();
  app = await createApp();
  fetchSpy = vi.fn(mockKinetica());
  vi.stubGlobal("fetch", fetchSpy);
  dee = sessionFor("dee", ["designer"]).cookie;
  sam = sessionFor("sam", ["designer"]).cookie;
  carl = sessionFor("carl", [makeRole("dw_writer", WRITE_PERMS)]).cookie;
  ana = sessionFor("ana").cookie;
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv?.();
  restoreEnv = null;
});

describe("dashboard write access (DWA)", () => {
  it("DWA-1 non-creator designer gets 404 on every write to another user's unkept dashboard", async () => {
    const failures: string[] = [];
    for (const r of DASHBOARD_WRITE_ROUTES) {
      resetDwContent();
      const fx = buildDwFixture({ pendingBy: "dee" });
      const before = snapshotDashboard(fx.D);
      fetchSpy.mockClear();
      const res = await sendDw(app, sam, r.build(fx));
      const problems: string[] = [];
      if (res.status !== 404) problems.push(`status ${res.status}`);
      if (JSON.stringify(res.body) !== JSON.stringify(NOT_FOUND)) problems.push(`body ${JSON.stringify(res.body)}`);
      if (snapshotDashboard(fx.D) !== before) problems.push("rows changed");
      if (fetchSpy.mock.calls.length) problems.push("kinetica called");
      if (problems.length) failures.push(`${r.key}: ${problems.join(", ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("DWA-2 a writer with no grant gets 404 on every write to a kept dashboard (grant routes stay 403)", async () => {
    const failures: string[] = [];
    for (const r of DASHBOARD_WRITE_ROUTES) {
      resetDwContent();
      const fx = buildDwFixture();
      const before = snapshotDashboard(fx.D);
      fetchSpy.mockClear();
      const res = await sendDw(app, carl, r.build(fx));
      const problems: string[] = [];
      if (res.status !== (r.manageAccess ? 403 : 404)) problems.push(`status ${res.status}`);
      if (!r.manageAccess && JSON.stringify(res.body) !== JSON.stringify(NOT_FOUND)) problems.push(`body ${JSON.stringify(res.body)}`);
      if (snapshotDashboard(fx.D) !== before) problems.push("rows changed");
      if (fetchSpy.mock.calls.length) problems.push("kinetica called");
      if (problems.length) failures.push(`${r.key}: ${problems.join(", ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("DWA-3 PATCH, DELETE and POST widget on another user's unkept dashboard leave it unchanged", async () => {
    const fx = buildDwFixture({ pendingBy: "dee" });
    for (const r of [DASHBOARD_WRITE_ROUTES[0]!, DASHBOARD_WRITE_ROUTES[1]!, DASHBOARD_WRITE_ROUTES[4]!]) {
      const res = await sendDw(app, sam, r.build(fx));
      expect(res.status, r.key).toBe(404);
      expect(res.body, r.key).toEqual(NOT_FOUND);
    }
    expect((db.prepare("SELECT name FROM dashboards WHERE id = ?").get(fx.D) as { name: string }).name).toBe("dw dashboard");
    expect((db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE dashboard_id = ?").get(fx.D) as { n: number }).n).toBe(1);
  });

  it("DWA-4 permission is checked before visibility (403, not 404)", async () => {
    const fx = buildDwFixture();
    const before = snapshotDashboard(fx.D);
    const res = await sendDw(app, ana, DASHBOARD_WRITE_ROUTES[0]!.build(fx));
    expect(res.status).toBe(403);
    expect(snapshotDashboard(fx.D)).toBe(before);
  });

  it("DWA-5 a missing child id keeps its own not-found message", async () => {
    const res = await sendDw(app, dee, { method: "patch", path: "/api/widgets/999999", body: { title: "x" } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Widget not found." });
  });
});
