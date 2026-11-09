// Phase 142-01 (AIGEN-V20-02, AIGOV-V20-05, D-04): a generated, never-kept dashboard is creator-only everywhere.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createWidget, createDashboard, listKeptDashboards } from "../src/db";
import { canViewDashboard } from "../src/lib/dashboardAccessDb";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, resetAiTables } from "./helpers/aiRouteKit";

let restoreEnv: (() => void) | null = null;
let app: Express;
let P: number;
let O: number;
const ck: Record<string, string> = {};

const markPending = (id: number, by: string) =>
  db.prepare("UPDATE dashboards SET generated_by = ?, generated_pending_at = ? WHERE id = ?").run(by, Date.now(), id);
const get = (user: string, path: string) => request(app).get(path).set("Cookie", ck[user]!);

beforeEach(async () => {
  resetAiTables();
  db.exec("DELETE FROM widgets");
  restoreEnv = enableAiEnv();
  app = await createApp();
  P = makeDashboard().id;
  makeTableOn(P);
  createWidget(P, { title: "w", type: "table", position: 0, config: {} as any });
  markPending(P, "dee");
  O = createDashboard("ordinary").id;
  ck.dee = sessionFor("dee", ["designer"]).cookie;
  ck.ann = sessionFor("ann", ["admin"]).cookie;
  ck.sam = sessionFor("sam", ["designer"]).cookie;
  sessionFor("al");
  db.prepare("INSERT INTO dashboard_access_grants (dashboard_id, grantee_type, grantee) VALUES (?, 'user', 'al')").run(P);
});
afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

describe("generated pending visibility (PENDVIS)", () => {
  it("PENDVIS-1 resolver is creator-only before any bypass or grant", () => {
    expect(canViewDashboard("dee", P)).toBe(true);
    expect(canViewDashboard("DEE ", P)).toBe(true);
    expect(canViewDashboard("ann", P)).toBe(false);
    expect(canViewDashboard("sam", P)).toBe(false);
    expect(canViewDashboard("al", P)).toBe(false);
    expect(canViewDashboard("ann", O)).toBe(true);
  });

  it("PENDVIS-2 list hides it from everyone but the creator", async () => {
    const dee = (await get("dee", "/api/dashboards")).body.data as any[];
    expect(dee.find((d) => d.id === P)?.generated_pending).toBe(true);
    for (const u of ["ann", "sam"]) {
      const rows = (await get(u, "/api/dashboards")).body.data as any[];
      expect(rows.some((d) => d.id === P)).toBe(false);
      expect(rows.some((d) => d.id === O)).toBe(true);
    }
  });

  it("PENDVIS-3 direct GETs 404 for admin, 200 for creator", async () => {
    for (const sub of ["widgets", "tables", "layers", "views", "export"]) {
      const a = await get("ann", `/api/dashboards/${P}/${sub}`);
      expect(a.status, sub).toBe(404);
      expect(a.body).toEqual({ error: "Dashboard not found." });
      expect((await get("dee", `/api/dashboards/${P}/${sub}`)).status, sub).toBe(200);
    }
  });

  it("PENDVIS-4 granting a pending dashboard: creator 409, others 404", async () => {
    const r = await request(app).post(`/api/dashboards/${P}/access`).set("Cookie", ck.ann!).send({ grantee_type: "user", grantee: "bob" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "Dashboard not found." });
    const own = await request(app).post(`/api/dashboards/${P}/access`).set("Cookie", ck.dee!).send({ grantee_type: "user", grantee: "bob" });
    expect(own.status).toBe(409);
    expect(own.body).toEqual({ code: "DASHBOARD_NOT_KEPT", error: "This dashboard hasn't been kept yet, so it can't be shared." });
    expect(db.prepare("SELECT 1 FROM dashboard_access_grants WHERE dashboard_id = ? AND grantee = 'bob'").get(P)).toBeUndefined();
    const ok = await request(app).post(`/api/dashboards/${O}/access`).set("Cookie", ck.ann!).send({ grantee_type: "user", grantee: "bob" });
    expect(ok.status).toBe(201);
  });

  it("PENDVIS-5 clearing the flag makes it ordinary", async () => {
    db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL WHERE id = ?").run(P);
    const rows = (await get("ann", "/api/dashboards")).body.data as any[];
    expect(rows.some((d) => d.id === P)).toBe(true);
    expect((await get("ann", `/api/dashboards/${P}/widgets`)).status).toBe(200);
  });

  it("PENDVIS-6 enumerators omit pending dashboards", () => {
    const ids = listKeptDashboards().map((d) => d.id);
    expect(ids).not.toContain(P);
    expect(ids).toContain(O);
  });
});
