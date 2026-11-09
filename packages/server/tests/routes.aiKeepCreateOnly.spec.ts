// 145 (KEEP-V21-01/02): Keep rules for a create-only role: own unkept dashboard yes, saved or someone else's no.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, createDashboard, addDashboardTable, getDashboard, getDashboardVersion, listWidgets } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, resetAiTables, mockKinetica } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { createGeneratedDashboard } from "../src/lib/aiGenerate";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { applyKeep, KeepConflict, type KeepPreparedInput } from "../src/lib/aiKeepApply";

const CREATOR_PERMS = ["ai:use", "dashboards:view", "dashboards:create"];
const EMPTY_PREPARED: KeepPreparedInput = { dynamicViews: [], warnings: [] };

let app: Express;
let T: number;
let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;
let cora: string;
let cole: string;
let sam: string;
let dee: string;

const emptyBody = (v: number) => ({ baselineVersion: v, dynamicViews: { add: [], remove: [] }, layers: { add: [], edit: [], remove: [] }, widgets: { add: [], edit: [], remove: [] } });
const addBar = (v: number) => ({
  ...emptyBody(v),
  widgets: { add: [{ tempId: -1, type: "bar", title: "KCO bar", config: { tableId: T }, rect: { x: 0, y: 0, w: 12, h: 10 } }], edit: [], remove: [] },
});
const keep = (cookie: string, id: number, body: unknown) => request(app).post(`/api/dashboards/${id}/ai-keep`).set("Cookie", cookie).send(body as object);
const gen = (username: string) => createGeneratedDashboard({ username, name: "Gen", tableIds: [T], assistant: true }).id;
const snapRows = (d: number) =>
  JSON.stringify([
    db.prepare("SELECT * FROM dashboards WHERE id = ?").all(d),
    db.prepare("SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY id").all(d),
    db.prepare("SELECT * FROM dashboard_layers WHERE dashboard_id = ? ORDER BY id").all(d),
    db.prepare("SELECT * FROM dashboard_dynamic_views WHERE dashboard_id = ? ORDER BY id").all(d),
    db.prepare("SELECT * FROM dashboard_access_grants WHERE dashboard_id = ? ORDER BY rowid").all(d),
  ]);
const auditCount = () => (db.prepare("SELECT COUNT(*) AS n FROM ai_audit").get() as { n: number }).n;
const auditOutcomes = () => (db.prepare("SELECT outcome FROM ai_audit").all() as { outcome: string }[]).map((r) => r.outcome);
const grantCount = (d: number, user: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM dashboard_access_grants WHERE dashboard_id = ? AND grantee_type = 'user' AND grantee = ?").get(d, user) as { n: number }).n;

beforeEach(async () => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM dashboard_access_grants; DELETE FROM ai_session_views");
  __clearLiveSchemaCacheForTest();
  __resetMcpSessionsForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
  app = await createApp();
  T = createTable({ schema: "fleet", name: "trips", columns: {} }).id;
  const role = makeRole("kco_creator", CREATOR_PERMS);
  cora = sessionFor("cora", [role]).cookie;
  cole = sessionFor("cole", [role]).cookie;
  sam = sessionFor("sam", ["designer"]).cookie;
  dee = sessionFor("dee", ["designer"]).cookie;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
  if (savedMcp === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedMcp;
});

describe("Keep for a create-only role (145)", () => {
  it("KCO-1 create-only creator keeps their own unkept generated dashboard", async () => {
    const D = gen("cora");
    const res = await keep(cora, D, addBar(getDashboardVersion(D)!));
    expect(res.status).toBe(200);
    expect(getDashboard(D)!.generated_pending).toBe(false);
    expect(listWidgets(D).some((w) => w.title === "KCO bar")).toBe(true);
    expect(auditOutcomes()).toEqual(["kept"]);
  });

  it("KCO-2 create-only creator keeps their own unkept Claude Desktop build", async () => {
    const start = await request(app).post("/api/mcp/sessions").set("Cookie", cora).send({ name: "Claude build", tableIds: [T] });
    expect(start.status).toBe(201);
    const D = start.body.dashboardId as number;
    const res = await keep(cora, D, addBar(getDashboardVersion(D)!));
    expect(res.status).toBe(200);
    expect(getDashboard(D)!.generated_pending).toBe(false);
  });

  it("KCO-3 create-only user cannot keep AI changes on a saved dashboard", async () => {
    const D = createDashboard("Saved", "").id;
    addDashboardTable(D, T);
    addDashboardGrant(D, "user", "cora");
    const before = snapRows(D);
    const res = await keep(cora, D, addBar(getDashboardVersion(D)!));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "dashboards:edit", error: "Permission denied: dashboards:edit is required" });
    expect(snapRows(D)).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("KCO-4 create-only user cannot open a saved dashboard for a Claude Desktop edit", async () => {
    const D = createDashboard("Saved", "").id;
    addDashboardTable(D, T);
    addDashboardGrant(D, "user", "cora");
    const res = await request(app).post("/api/mcp/sessions").set("Cookie", cora).send({ dashboardId: D });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "You can't edit dashboards." });
  });

  it("KCO-5 nobody keeps another user's unkept dashboard", async () => {
    const D = gen("cora");
    const before = snapRows(D);
    const v = getDashboardVersion(D)!;
    const asCole = await keep(cole, D, addBar(v));
    expect(asCole.status).toBe(404);
    expect(asCole.body).toMatchObject({ error: "Dashboard not found." });
    const asSam = await keep(sam, D, addBar(v));
    expect(asSam.status).toBe(404);
    expect(asSam.body).toMatchObject({ error: "Dashboard not found." });
    expect(snapRows(D)).toBe(before);
    expect(getDashboard(D)!.generated_pending).toBe(true);
  });

  it("KCO-6 a create-only Keep is refused in the transaction if the dashboard stopped being unkept", () => {
    const D = gen("cora");
    db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL WHERE id = ?").run(D);
    expect(() => applyKeep(D, emptyBody(getDashboardVersion(D)!), EMPTY_PREPARED, { expectPending: true })).toThrow(KeepConflict);
    expect(() => applyKeep(D, emptyBody(getDashboardVersion(D)!), EMPTY_PREPARED, { expectPending: false })).not.toThrow();
    expect(() => applyKeep(D, emptyBody(getDashboardVersion(D)!), EMPTY_PREPARED)).not.toThrow();
  });

  it("KCO-7 the create-only creator still sees what they kept; designers get no extra grant", async () => {
    const D = gen("cora");
    expect((await keep(cora, D, addBar(getDashboardVersion(D)!))).status).toBe(200);
    expect((await request(app).get(`/api/dashboards/${D}/widgets`).set("Cookie", cora)).status).toBe(200);
    const list = await request(app).get("/api/dashboards").set("Cookie", cora);
    const ids = ((list.body.data ?? list.body) as { id: number }[]).map((d) => d.id);
    expect(ids).toContain(D);
    expect(grantCount(D, "cora")).toBe(1);

    const D2 = gen("dee");
    expect((await keep(dee, D2, addBar(getDashboardVersion(D2)!))).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM dashboard_access_grants WHERE dashboard_id = ?").get(D2)).toEqual({ n: 0 });
  });
});
