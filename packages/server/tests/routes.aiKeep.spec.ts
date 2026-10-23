// Phase 141-12: POST /api/dashboards/:id/ai-keep over HTTP. Kinetica is stubbed via fetch; no provider, no .env.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { createApp } from "../src/index";
import {
  db,
  createWidget,
  createDashboardLayer,
  createDashboardDynamicView,
  getDashboardDynamicView,
  getDashboardVersion,
  listWidgets,
  listDashboardLayers,
  createDashboard,
  addDashboardTable,
  createTable,
} from "../src/db";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";
import { collectSignedWidgetConfigRefs } from "../src/lib/dashboardExportRefs";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";

const kbody = (result: unknown) =>
  new Response(JSON.stringify({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }) }), { status: 200 });
const cols = (names: string[]) => {
  const r: Record<string, unknown> = { column_headers: names };
  names.forEach((_c, i) => (r[`column_${i + 1}`] = []));
  return kbody(r);
};
const untag = (s: string) => s.replace(/^\/\*[^*]*\*\/ /, "");

let calls: string[] = [];
/** Per-test hook run on every /execute/sql statement; return a Response to take over. */
let hook: ((stmt: string) => Response | undefined) | null = null;
let probeCols: Record<string, string[]> = {};
let logs: string[] = [];
let restoreEnv: (() => void) | null = null;

const kfetch = ((url: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  const stmt = untag(String(JSON.parse(String(init?.body ?? "{}")).statement ?? ""));
  calls.push(`${path} ${stmt}`);
  const h = hook?.(stmt);
  if (h) return Promise.resolve(h);
  const m = /^SELECT \* FROM (\S+) LIMIT 0$/.exec(stmt);
  if (m && probeCols[m[1]!]) return Promise.resolve(cols(probeCols[m[1]!]!));
  return Promise.resolve(kbody({}));
}) as typeof fetch;

const drops = () => calls.filter((c) => /DROP TABLE/.test(c));

const SNAP_TABLES = ["dashboards", "widgets", "dashboard_layers", "dashboard_dynamic_views", "dashboard_tables"];
const snapshot = () => Object.fromEntries(SNAP_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()])) as Record<string, unknown[]>;
// dashboard_tables has no id column in some schemas; fall back to rowid ordering
const snap = () => {
  const out: Record<string, unknown[]> = {};
  for (const t of SNAP_TABLES) out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  return out;
};
void snapshot;

const EDIT_PERMS = ["dashboards:view", "dashboards:edit", "widgets:configure", "layers:manage", "dynamic_views:manage"];
const rect = (y: number) => ({ x: 0, y, w: 12, h: 10 });

type Ctx = { app: Express; cookie: string; D: number; T: number; W1: number; W3: number; WAI: number; L1: number; V70: number; baseline: number; role: string };

async function setup(perms = EDIT_PERMS, user = "ed"): Promise<Ctx> {
  restoreEnv = enableAiEnv();
  const app = await createApp();
  const role = makeRole(`keep-${user}-${Math.random().toString(36).slice(2, 7)}`, perms);
  const dash = makeDashboard([role]);
  const T = createTable({ schema: "fleet", name: "trips", columns: { vendor: "string", fare: "double", pickup_datetime: "timestamp" } }).id;
  addDashboardTable(dash.id, T);
  const V70 = createDashboardDynamicView(dash.id, { source_table_id: T, name: "Old view", template_sql: "SELECT * FROM {view}", max_records: 10, columns_json: [{ name: "vendor", type: "string" }] }).id;
  const L1 = createDashboardLayer(dash.id, { table_id: T, config: { renderMode: "points" } }).id;
  const W1 = createWidget(dash.id, { title: "Bar one", type: "bar", position: 0, config: { tableId: T, layout: { x: 0, y: 0, w: 6, h: 8 } } }).id;
  const W3 = createWidget(dash.id, { title: "Records", type: "records", position: 2, config: { tableId: T } }).id;
  const WAI = createWidget(dash.id, { title: "Ask AI", type: "ai", position: 3, config: {} }).id;
  const { cookie } = sessionFor(user, [role]);
  return { app, cookie, D: dash.id, T, W1, W3, WAI, L1, V70, baseline: getDashboardVersion(dash.id)!, role };
}

const SPEC = (T: number) => ({ baseTableId: T, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "sum", column: "fare", as: "total" }] });

/** The KEEP-ROUTE-1 change set. */
const happy = (c: Ctx, over: Record<string, unknown> = {}) => ({
  baselineVersion: c.baseline,
  dynamicViews: { add: [{ tempId: -3, name: "AI view", spec: SPEC(c.T) }], remove: [c.V70] },
  layers: { add: [], edit: [], remove: [] },
  widgets: {
    add: [{ tempId: -1, type: "bar", title: "SECRET_TITLE_AI bar", config: { dynamicViewId: -3, tableId: c.T }, rect: rect(20) }],
    edit: [{ id: c.W1, title: "Renamed bar" }],
    remove: [c.W3],
  },
  ...over,
});
const empty = (c: Ctx) => ({ baselineVersion: c.baseline, dynamicViews: { add: [], remove: [] }, layers: { add: [], edit: [], remove: [] }, widgets: { add: [], edit: [], remove: [] } });
const post = (c: Ctx, body: unknown, id = c.D) => request(c.app).post(`/api/dashboards/${id}/ai-keep`).set("Cookie", c.cookie).send(body as object);
const auditRows = () => db.prepare("SELECT * FROM ai_audit ORDER BY id").all() as any[];

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM widgets; DELETE FROM ai_session_views");
  __clearLiveSchemaCacheForTest();
  calls = [];
  hook = null;
  probeCols = { "fleet.trips": ["vendor", "fare", "pickup_datetime"] };
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  forbidProviderNetwork(kfetch);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreEnv?.();
  restoreEnv = null;
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort");
});

describe("Keep route happy path (141-12 task 1)", () => {
  it("KEEP-ROUTE-1 saves the change set with real ids, version header and body", async () => {
    const c = await setup();
    const r = await post(c, happy(c));
    expect(r.body.reasons ?? []).toEqual([]);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.idMap.dynamicViews)).toEqual(["-3"]);
    expect(Object.keys(r.body.idMap.widgets)).toEqual(["-1"]);
    expect(r.body.version).toBe(getDashboardVersion(c.D));
    expect(r.headers["x-kbi-dashboard-version"]).toBe(`${c.D}:${c.baseline}:${r.body.version}`);
    const rows = listWidgets(c.D);
    const added = rows.find((w) => w.id === r.body.idMap.widgets["-1"])!;
    expect(added.config.dynamicViewId).toBe(r.body.idMap.dynamicViews["-3"]);
    expect(rows.find((w) => w.id === c.W3)).toBeUndefined();
    expect(getDashboardDynamicView(c.V70)).toBeUndefined();
    expect(Array.isArray(r.body.warnings)).toBe(true);
  });

  it("KEEP-ROUTE-2 a reload (the three GET lists) reads exactly the saved rows", async () => {
    const c = await setup();
    const k = await post(c, happy(c));
    expect(k.status).toBe(200);
    const w = await request(c.app).get(`/api/dashboards/${c.D}/widgets`).set("Cookie", c.cookie);
    const l = await request(c.app).get(`/api/dashboards/${c.D}/layers`).set("Cookie", c.cookie);
    const d = await request(c.app).get(`/api/dashboards/${c.D}/dynamic-views`).set("Cookie", c.cookie);
    expect(w.status).toBe(200);
    const ids = (w.body.data as any[]).map((x) => x.id);
    expect(ids).toContain(k.body.idMap.widgets["-1"]);
    expect(ids).not.toContain(c.W3);
    expect((w.body.data as any[]).find((x) => x.id === c.W1).title).toBe("Renamed bar");
    expect(l.status).toBe(200);
    const dvIds = (d.body.dynamic_views as any[]).map((x) => x.id);
    expect(dvIds).toContain(k.body.idMap.dynamicViews["-3"]);
    expect(dvIds).not.toContain(c.V70);
  });

  it("KEEP-ROUTE-3 the removed view's materialization is dropped AFTER commit, and a DROP failure is still 200", async () => {
    const c = await setup();
    const name = buildDynamicViewName({ userId: "ed", dashboardId: c.D, dynamicViewId: c.V70 });
    let rowGoneAtDrop: boolean | null = null;
    hook = (stmt) => {
      if (stmt === `DROP TABLE IF EXISTS ${name}`) {
        rowGoneAtDrop = getDashboardDynamicView(c.V70) === undefined;
        return new Response("{}", { status: 500 });
      }
      return undefined;
    };
    const r = await post(c, happy(c));
    expect(r.status).toBe(200);
    expect(drops().map((d) => untag(d.replace(/^\S+ /, "")))).toEqual([`DROP TABLE IF EXISTS ${name}`]);
    expect(rowGoneAtDrop).toBe(true);
  });

  it("KEEP-ROUTE-4 writes one counted-0 audit row with counts/ids only, plus an ai_keep log line", async () => {
    const c = await setup();
    const r = await post(c, happy(c));
    expect(r.status).toBe(200);
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const a = rows[0];
    expect(a).toMatchObject({ outcome: "kept", counted: 0, status: "final", question: "", dashboard_id: c.D, username: "ed" });
    const ch = JSON.parse(a.changes_json);
    expect(ch).toEqual({
      added: { widgets: 1, layers: 0, dynamicViews: 1 },
      edited: { widgets: 1, layers: 0 },
      removed: { widgets: 1, layers: 0, dynamicViews: 1 },
      idMap: r.body.idMap,
    });
    for (const bad of ["vendor", "fare", "SELECT", "SECRET_TITLE_AI", "Renamed bar"]) expect(a.changes_json).not.toContain(bad);
    const line = logs.find((l) => l.includes('"event":"ai_keep"'));
    expect(line).toBeDefined();
    for (const bad of ["vendor", "fare", "SELECT", "SECRET_TITLE_AI"]) expect(line).not.toContain(bad);
  });

  it("KEEP-ROUTE-5 ai:use is not required (D-19)", async () => {
    const c = await setup(EDIT_PERMS);
    expect(EDIT_PERMS).not.toContain("ai:use");
    const r = await post(c, happy(c));
    expect(r.status).toBe(200);
  });
});

describe("Keep route refusals (141-12 task 2)", () => {
  const expectUntouched = (before: Record<string, unknown[]>) => {
    expect(snap()).toEqual(before);
    expect(drops()).toHaveLength(0);
  };

  it("KEEP-ROUTE-forged-viewer no dashboards:edit -> 403 PERMISSION_DENIED", async () => {
    const c = await setup(["dashboards:view"], "vw");
    const before = snap();
    const r = await post(c, happy(c));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "dashboards:edit" });
    expectUntouched(before);
  });

  it("KEEP-ROUTE-forged-right a missing needed right -> 403 AI_KEEP_PERMISSION with the D-02 text", async () => {
    const c = await setup(["dashboards:view", "dashboards:edit", "widgets:configure", "layers:manage"], "nodv");
    let before = snap();
    let r = await post(c, happy(c));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      code: "AI_KEEP_PERMISSION",
      permission: "dynamic_views:manage",
      error: "You can't save these changes: saving dynamic views needs the Manage dynamic views permission.",
    });
    expectUntouched(before);
    const c2 = await setup(["dashboards:view", "dashboards:edit", "widgets:configure", "dynamic_views:manage"], "nolayer");
    before = snap();
    r = await post(c2, { ...empty(c2), layers: { add: [], edit: [{ id: c2.L1, configSet: { POINTSIZE: 4 } }], remove: [] } });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "AI_KEEP_PERMISSION", permission: "layers:manage" });
    expectUntouched(before);
    expect(auditRows().filter((a) => a.outcome === "keep_denied")).toHaveLength(2);
  });

  it("KEEP-ROUTE-forged-foreign editing/removing another dashboard's widget -> 422", async () => {
    const c = await setup();
    const E = createDashboard("Other", "").id;
    const WE = createWidget(E, { title: "Foreign", type: "records", position: 0, config: {} }).id;
    const before = snap();
    for (const widgets of [{ add: [], edit: [{ id: WE, title: "pwn" }], remove: [] }, { add: [], edit: [], remove: [WE] }]) {
      const r = await post(c, { ...empty(c), widgets });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("AI_KEEP_INVALID");
    }
    expectUntouched(before);
  });

  it("KEEP-ROUTE-forged-ai the ai widget cannot be edited or removed, nor added", async () => {
    const c = await setup();
    const before = snap();
    for (const widgets of [{ add: [], edit: [{ id: c.WAI, title: "x" }], remove: [] }, { add: [], edit: [], remove: [c.WAI] }]) {
      const r = await post(c, { ...empty(c), widgets });
      expect(r.status).toBe(422);
    }
    const r = await post(c, { ...empty(c), widgets: { add: [{ tempId: -1, type: "ai", title: "x", config: {}, rect: rect(0) }], edit: [], remove: [] } });
    expect(r.status).toBe(400);
    expectUntouched(before);
  });

  it("KEEP-ROUTE-ai-rect (141 UAT) a baked geometry edit of the ai widget is saved, not refused", async () => {
    const c = await setup();
    const r = await post(c, { ...empty(c), widgets: { add: [], edit: [{ id: c.WAI, rect: rect(3) }], remove: [] } });
    expect(r.status).toBe(200);
    const row = db.prepare("SELECT type, config FROM widgets WHERE id = ?").get(c.WAI) as { type: string; config: string };
    expect(row.type).toBe("ai");
    expect(JSON.parse(row.config).layout).toMatchObject(rect(3));
  });

  it("KEEP-ROUTE-forged-keys blocked config keys and client SQL fields are refused", async () => {
    const c = await setup();
    const before = snap();
    let r = await post(c, { ...empty(c), widgets: { add: [{ tempId: -1, type: "bar", title: "x", config: { customWhere: "1=1" }, rect: rect(0) }], edit: [], remove: [] } });
    expect(r.status).toBe(422);
    const dv = { tempId: -3, name: "v", spec: SPEC(c.T) };
    r = await post(c, { ...empty(c), dynamicViews: { add: [{ ...dv, template_sql: "SELECT 1" }], remove: [] } });
    expect(r.status).toBe(400);
    r = await post(c, { ...empty(c), dynamicViews: { add: [{ ...dv, columns: [] }], remove: [] } });
    expect(r.status).toBe(400);
    r = await post(c, { ...empty(c), dashboardId: 999 });
    expect(r.status).toBe(400);
    expectUntouched(before);
  });

  it("KEEP-ROUTE-forged-temp an unmapped temp id -> 422", async () => {
    const c = await setup();
    const before = snap();
    const r = await post(c, { ...empty(c), widgets: { add: [{ tempId: -1, type: "bar", title: "x", config: { dynamicViewId: -9, tableId: c.T }, rect: rect(0) }], edit: [], remove: [] } });
    expect(r.status).toBe(422);
    expectUntouched(before);
  });

  it("KEEP-ROUTE-forged-access edit rights but no grant on D -> 404", async () => {
    const c = await setup();
    const role2 = makeRole("keep-nogrant", EDIT_PERMS);
    const { cookie } = sessionFor("outsider", [role2]);
    const before = snap();
    const r = await request(c.app).post(`/api/dashboards/${c.D}/ai-keep`).set("Cookie", cookie).send(happy(c));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("Dashboard not found.");
    expectUntouched(before);
  });

  it("KEEP-ROUTE-forged-disabled AI off -> 503", async () => {
    const c = await setup();
    restoreEnv?.();
    restoreEnv = null;
    delete process.env.AI_ENABLED;
    const app2 = await createApp();
    const r = await request(app2).post(`/api/dashboards/${c.D}/ai-keep`).set("Cookie", c.cookie).send(happy(c));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("KEEP-ROUTE-conflict a foreign write before Keep -> 409, zero Kinetica calls, nothing overwritten", async () => {
    const c = await setup();
    const other = sessionFor("other", [c.role]);
    const p = await request(c.app).patch(`/api/widgets/${c.W1}`).set("Cookie", other.cookie).send({ title: "Theirs" });
    expect(p.status).toBe(200);
    const before = snap();
    calls = [];
    const r = await post(c, happy(c));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "AI_KEEP_CONFLICT", error: "Someone else changed this dashboard since you started. Your AI changes weren't saved." });
    expect(snap()).toEqual(before);
    expect(calls).toHaveLength(0);
    const a = auditRows().find((x) => x.outcome === "keep_conflict");
    expect(a?.outcome_detail).toBe("stale_baseline");
  });

  it("KEEP-ROUTE-race a foreign write during the live-schema step is caught in the transaction", async () => {
    const c = await setup();
    let fired = false;
    hook = (stmt) => {
      if (!fired && /LIMIT 0$/.test(stmt)) {
        fired = true;
        db.prepare("UPDATE widgets SET title = 'B' WHERE id = ?").run(c.W1);
      }
      return undefined;
    };
    const r = await post(c, happy(c));
    expect(fired).toBe(true);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("AI_KEEP_CONFLICT");
    expect(listWidgets(c.D).find((w) => w.id === c.W1)!.title).toBe("B");
    expect(listWidgets(c.D).some((w) => w.title.includes("SECRET_TITLE_AI"))).toBe(false);
    expect(getDashboardDynamicView(c.V70)).toBeDefined();
    expect(drops()).toHaveLength(0);
    expect(auditRows().find((x) => x.outcome === "keep_conflict")?.outcome_detail).toBe("in_txn_conflict");
  });

  it("KEEP-ROUTE-double the same baseline twice: 200 then 409, never duplicate rows", async () => {
    const c = await setup();
    const body = happy(c);
    expect((await post(c, body)).status).toBe(200);
    const n = listWidgets(c.D).length;
    expect((await post(c, body)).status).toBe(409);
    expect(listWidgets(c.D).length).toBe(n);
  });

  it("KEEP-ROUTE-atomic an injected failure at the last step -> 500 D-12 text, nothing saved, retry works", async () => {
    const c = await setup();
    db.exec("CREATE TRIGGER kbi_test_abort BEFORE DELETE ON widgets BEGIN SELECT RAISE(ABORT, 'injected'); END");
    const before = snap();
    const r = await post(c, happy(c));
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: "AI_KEEP_FAILED", error: "Couldn't save the AI changes. Nothing was saved; try again." });
    expect(JSON.stringify(r.body)).not.toContain("injected");
    expect(snap()).toEqual(before);
    expect(drops()).toHaveLength(0);
    expect(auditRows().find((x) => x.outcome === "keep_failed")).toBeDefined();
    db.exec("DROP TRIGGER kbi_test_abort");
    const r2 = await post(c, happy(c));
    expect(r2.status).toBe(200);
  });

  it("KEEP-ROUTE-temps temp ids inside layer add/edit dynamicViewId and EDIT configSet are all remapped; no negative id survives", async () => {
    const c = await setup();
    const WM = createWidget(c.D, { title: "Map", type: "map", position: 5, config: { includedLayerIds: [c.L1] } }).id;
    const baseline = getDashboardVersion(c.D)!;
    const r = await post(c, {
      baselineVersion: baseline,
      dynamicViews: { add: [{ tempId: -3, name: "AI view", spec: SPEC(c.T) }], remove: [] },
      layers: {
        add: [{ tempId: -2, tableId: c.T, config: { renderMode: "heatmap" }, dynamicViewId: -3 }],
        edit: [{ id: c.L1, dynamicViewId: -3 }],
        remove: [],
      },
      widgets: {
        add: [],
        edit: [
          { id: c.W1, configSet: { dynamicViewId: -3 } },
          { id: WM, configSet: { includedLayerIds: [c.L1, -2] } },
        ],
        remove: [],
      },
    });
    expect(r.body.reasons ?? []).toEqual([]);
    expect(r.status).toBe(200);
    const dvReal = r.body.idMap.dynamicViews["-3"] as number;
    const lReal = r.body.idMap.layers["-2"] as number;
    const layers = listDashboardLayers(c.D);
    expect(layers.find((l) => l.id === lReal)!.dynamic_view_id).toBe(dvReal);
    expect(layers.find((l) => l.id === c.L1)!.dynamic_view_id).toBe(dvReal);
    const ws = listWidgets(c.D);
    expect(ws.find((w) => w.id === c.W1)!.config.dynamicViewId).toBe(dvReal);
    expect(ws.find((w) => w.id === WM)!.config.includedLayerIds).toEqual([c.L1, lReal]);
    for (const w of ws) expect(collectSignedWidgetConfigRefs(w.config).filter((x) => x.id < 0)).toEqual([]);
    for (const t of ["widgets", "dashboard_layers", "dashboard_dynamic_views"]) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${t} WHERE dashboard_id = ?`).all(c.D));
      expect(dump, t).not.toMatch(/(?<![\w.])-\d+(?![\w.])/);
    }
  });

  it("KEEP-ROUTE-fixture the real 141-08 client payload validates and applies with real ids", async () => {
    const fx = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../shared/src/fixtures/aiKeepPayload.fixture.json", import.meta.url)), "utf8"));
    const c = await setup();
    // fresh dashboard seeded from the fixture baseline with its explicit ids
    const D = makeDashboard([c.role]).id;
    db.exec("DELETE FROM widgets; DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views");
    for (const id of [9101, 9102, 9103, 9104]) db.prepare("DELETE FROM widgets WHERE id = ?").run(id);
    db.prepare("DELETE FROM dashboard_tables WHERE table_id = 9001").run();
    db.prepare("DELETE FROM tables WHERE id = 9001").run();
    const t = fx.baseline.tables[0];
    db.prepare("INSERT INTO tables (id, schema, name, columns) VALUES (?, ?, ?, ?)").run(t.id, t.schema, t.name, JSON.stringify(t.columns));
    addDashboardTable(D, t.id);
    for (const w of fx.baseline.widgets) db.prepare("INSERT INTO widgets (id, dashboard_id, title, type, position, config) VALUES (?, ?, ?, ?, ?, ?)").run(w.id, D, w.title, w.type, w.position, JSON.stringify(w.config));
    for (const l of fx.baseline.layers) db.prepare("INSERT INTO dashboard_layers (id, dashboard_id, table_id, layer_type, position, config) VALUES (?, ?, ?, ?, ?, ?)").run(l.id, D, l.table_id, l.layer_type, l.position, JSON.stringify(l.config));
    for (const v of fx.baseline.dynamicViews) {
      db.prepare("INSERT INTO dashboard_dynamic_views (id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(v.id, D, v.source_table_id, v.name, "SELECT * FROM {view}", 10, JSON.stringify([{ name: "vendor", type: "string" }]));
    }
    const req = { ...fx.request, baselineVersion: getDashboardVersion(D) };
    const r = await post(c, req, D);
    expect(r.body.error ?? "").toBe("");
    expect(r.status).toBe(200);
    const temps = {
      widgets: fx.request.widgets.add.map((a: any) => String(a.tempId)),
      layers: fx.request.layers.add.map((a: any) => String(a.tempId)),
      dynamicViews: fx.request.dynamicViews.add.map((a: any) => String(a.tempId)),
    };
    expect(Object.keys(r.body.idMap.widgets).sort()).toEqual(temps.widgets.sort());
    expect(Object.keys(r.body.idMap.layers).sort()).toEqual(temps.layers.sort());
    expect(Object.keys(r.body.idMap.dynamicViews).sort()).toEqual(temps.dynamicViews.sort());
    const ws = listWidgets(D);
    for (const w of ws) expect(collectSignedWidgetConfigRefs(w.config).filter((x) => x.id < 0)).toEqual([]);
    for (const l of listDashboardLayers(D)) expect(l.dynamic_view_id === null || l.dynamic_view_id > 0).toBe(true);
    expect(ws.find((w) => w.id === 9103)).toBeUndefined();
    expect(ws.find((w) => w.id === 9104)!.config.dynamicViewId).toBeUndefined();
    expect(ws.find((w) => w.id === 9101)!.config.dynamicViewId).toBe(r.body.idMap.dynamicViews[temps.dynamicViews[0]]);
    const map = ws.find((w) => w.id === 9102)!.config.includedLayerIds as number[];
    expect(map).toEqual([9201, r.body.idMap.layers[temps.layers[0]]]);
  });

  it("KEEP-ROUTE-mapview (142 UAT) an AI map's server-stamped defaultView is accepted and persisted verbatim", async () => {
    const c = await setup();
    const view = { center: [-8226375.123456, 4974561.987654], zoom: 10.9 };
    const r = await post(c, {
      baselineVersion: c.baseline,
      dynamicViews: { add: [], remove: [] },
      layers: { add: [{ tempId: -2, tableId: c.T, config: { renderMode: "heatmap", latColumn: "fare", lonColumn: "fare" } }], edit: [], remove: [] },
      widgets: { add: [{ tempId: -1, type: "map", title: "Pickups", config: { includedLayerIds: [-2], defaultView: view }, rect: rect(20) }], edit: [], remove: [] },
    });
    expect(r.body.reasons ?? []).toEqual([]);
    expect(r.status).toBe(200);
    const saved = listWidgets(c.D).find((w) => w.id === r.body.idMap.widgets["-1"])!;
    expect(saved.config.defaultView).toEqual(view);
    expect(saved.config.includedLayerIds).toEqual([r.body.idMap.layers["-2"]]);
  });
});
