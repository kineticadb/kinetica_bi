// Phase 142-05: POST /api/dashboards/generate, POST /api/dashboards/:id/discard-generated, DELETE via the helper, logout discard.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, createDashboard } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, resetAiTables, mockKinetica } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { registerAiSessionView } from "../src/lib/aiSessionViews";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import * as gen from "../src/lib/aiGenerate";

let restoreEnv: (() => void) | null = null;
let T = 0;
let BAD = 0;
const MSG_PENDING = "You already have a generated dashboard that isn't kept yet. Keep or discard it first.";

async function boot(ai = true): Promise<Express> {
  restoreEnv = ai ? enableAiEnv() : null;
  return createApp();
}
const dee = () => sessionFor("dee", ["designer"]).cookie;
const post = (app: Express, cookie: string, body: unknown) => request(app).post("/api/dashboards/generate").set("Cookie", cookie).send(body as object);
const pendingCount = (u: string) => (db.prepare("SELECT COUNT(*) AS n FROM dashboards WHERE generated_by = ? AND generated_pending_at IS NOT NULL").get(u) as { n: number }).n;
const exists = (id: number) => !!db.prepare("SELECT 1 FROM dashboards WHERE id = ?").get(id);

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM ai_session_views; DELETE FROM widgets;");
  __clearLiveSchemaCacheForTest();
  T = createTable({ schema: "fleet", name: "trips", columns: {} }).id;
  BAD = createTable({ schema: "fleet", name: "locked", columns: {} }).id;
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] }, failing: { "fleet.locked": 500 } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
});

describe("POST /api/dashboards/generate", () => {
  it("GENROUTE-1 201 creates dashboard, table link and AI widget", async () => {
    const app = await boot();
    const c = dee();
    const res = await post(app, c, { name: "Trips starter", tableId: T });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Trips starter", generated_pending: true });
    expect("generated_by" in res.body).toBe(false);
    const ws = await request(app).get(`/api/dashboards/${res.body.id}/widgets`).set("Cookie", c);
    expect(ws.body.data).toHaveLength(1);
    expect(ws.body.data[0]).toMatchObject({ type: "ai" });
    expect(ws.body.data[0].config.layout).toEqual({ x: 24, y: 0, w: 12, h: 40 });
    const ts = await request(app).get(`/api/dashboards/${res.body.id}/tables`).set("Cookie", c);
    expect((ts.body.data ?? ts.body).map((t: { id: number }) => t.id)).toEqual([T]);
  });

  it("GENROUTE-2 gates", async () => {
    const app = await boot();
    const al = await post(app, sessionFor("al").cookie, { name: "x", tableId: T });
    expect(al.status).toBe(403);
    expect(al.body.code).toBe("PERMISSION_DENIED");
    const role = makeRole("cara-role", ["dashboards:view", "dashboards:create"]);
    const cara = await post(app, sessionFor("cara", [role]).cookie, { name: "x", tableId: T });
    expect(cara.status).toBe(403);
    expect(cara.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
    expect((await request(app).post("/api/dashboards/generate").send({ name: "x", tableId: T })).status).toBe(401);
    restoreEnv?.();
    restoreEnv = null;
    const off = await createApp();
    const r = await post(off, dee(), { name: "x", tableId: T });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("GENROUTE-3 validation, unknown and unreadable tables create nothing", async () => {
    const app = await boot();
    const c = dee();
    for (const body of [{}, { name: "  ", tableId: T }, { name: "n".repeat(201), tableId: T }, { name: "x", tableId: 0 }, { name: "x", tableId: T, extra: 1 }]) {
      const r = await post(app, c, body);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("AI_GENERATE_BAD_REQUEST");
    }
    const nf = await post(app, c, { name: "x", tableId: 99999 });
    expect(nf.status).toBe(404);
    expect(nf.body.error).toBe("Table not found.");
    const un = await post(app, c, { name: "x", tableId: BAD });
    expect(un.status).toBe(422);
    expect(un.body).toMatchObject({ code: "AI_TABLE_UNREADABLE", error: "You can't read this table in Kinetica." });
    expect(pendingCount("dee")).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n).toBe(0);
  });

  it("GENROUTE-4 one pending per user, also under concurrency", async () => {
    const app = await boot();
    const c = dee();
    const a = await post(app, c, { name: "Trips starter", tableId: T });
    const b = await post(app, c, { name: "Second", tableId: T });
    expect(b.status).toBe(409);
    expect(b.body).toEqual({ code: "AI_GENERATE_PENDING", error: MSG_PENDING, dashboard: { id: a.body.id, name: "Trips starter" } });
    const fresh = sessionFor("fran", ["designer"]).cookie;
    const rs = await Promise.all([post(app, fresh, { name: "A", tableId: T }), post(app, fresh, { name: "B", tableId: T })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(pendingCount("fran")).toBe(1);
  });
});

describe("POST /api/dashboards/:id/discard-generated", () => {
  it("GENROUTE-5 only the creator discards", async () => {
    const app = await boot();
    const c = dee();
    const d = (await post(app, c, { name: "Trips", tableId: T })).body.id as number;
    const ann = sessionFor("ann", ["admin"]).cookie;
    expect((await request(app).post(`/api/dashboards/${d}/discard-generated`).set("Cookie", ann)).status).toBe(404);
    expect(exists(d)).toBe(true);
    expect((await request(app).post(`/api/dashboards/${d}/discard-generated`).set("Cookie", c)).status).toBe(204);
    expect(exists(d)).toBe(false);
    expect((db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE dashboard_id = ?").get(d) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM dashboard_tables WHERE dashboard_id = ?").get(d) as { n: number }).n).toBe(0);
    const list = await request(app).get("/api/dashboards").set("Cookie", c);
    expect(list.body.data.find((x: { id: number }) => x.id === d)).toBeUndefined();
    expect((await request(app).post(`/api/dashboards/${d}/discard-generated`).set("Cookie", c)).status).toBe(404);
  });

  it("GENROUTE-6 a kept dashboard is not discardable", async () => {
    const app = await boot();
    const c = dee();
    const d = (await post(app, c, { name: "Trips", tableId: T })).body.id as number;
    db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL WHERE id = ?").run(d);
    const r = await request(app).post(`/api/dashboards/${d}/discard-generated`).set("Cookie", c);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ code: "DASHBOARD_ALREADY_KEPT", error: "This dashboard has been kept. Delete it from the dashboard list instead." });
    expect(exists(d)).toBe(true);
  });
});

describe("DELETE /api/dashboards/:id on a pending dashboard", () => {
  it("GENROUTE-7 goes through the discard helper", async () => {
    const app = await boot();
    const c = dee();
    const d = (await post(app, c, { name: "Trips", tableId: T })).body.id as number;
    const SID = "aaaaaaaa11111111";
    for (const tempId of [-1, -2]) {
      registerAiSessionView({ viewName: buildAiDynamicViewName({ username: "dee", sid: SID, nonce: "0a1b2c3d", tempId, gen: 0 }), sid: SID, username: "dee", dashboardId: d, nonce: "0a1b2c3d", tempId, gen: 0 });
    }
    const ann = sessionFor("ann", ["admin"]).cookie;
    expect((await request(app).delete(`/api/dashboards/${d}`).set("Cookie", ann)).status).toBe(204);
    expect(exists(d)).toBe(false);
    expect((db.prepare("SELECT COUNT(*) AS n FROM ai_session_views WHERE dashboard_id = ?").get(d) as { n: number }).n).toBe(0);
    const plain = createDashboard("ordinary", "").id;
    expect((await request(app).delete(`/api/dashboards/${plain}`).set("Cookie", ann)).status).toBe(204);
  });
});

describe("logout discards unkept generated dashboards", () => {
  it("GENROUTE-8 logout removes the caller's pending dashboard only", async () => {
    const app = await boot();
    const c = dee();
    const d = (await post(app, c, { name: "Trips", tableId: T })).body.id as number;
    const kept = createDashboard("kept", "").id;
    const ann = sessionFor("ann", ["designer"]).cookie;
    const a = (await post(app, ann, { name: "Ann", tableId: T })).body.id as number;
    expect((await request(app).post("/api/auth/logout").set("Cookie", c)).status).toBe(204);
    expect(exists(d)).toBe(false);
    expect(exists(kept)).toBe(true);
    expect(exists(a)).toBe(true);
  });

  it("GENROUTE-9 logout never fails when the discard throws", async () => {
    const app = await boot();
    const s = sessionFor("dee", ["designer"]);
    await post(app, s.cookie, { name: "Trips", tableId: T });
    vi.spyOn(gen, "discardPendingForUser").mockRejectedValue(new Error("boom"));
    expect((await request(app).post("/api/auth/logout").set("Cookie", s.cookie)).status).toBe(204);
    expect(db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(s.sid)).toBeUndefined();
  });
});
