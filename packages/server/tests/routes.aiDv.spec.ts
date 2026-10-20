// Phase 139-05: ad-hoc AI dynamic-view routes (materialize / drop / list), Kinetica stubbed via fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db, createTable, addDashboardTable } from "../src/db";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { registerAiSessionView, getAiSessionView, countAiSessionViews } from "../src/lib/aiSessionViews";
import { buildFilterViewName } from "../src/lib/viewNaming";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables, pollUntil, listenApp } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";

const realFetch = globalThis.fetch;
const NONCE = "0a1b2c3d";
const SECRET = "SECRETVAL_139";
const DV_ENV = ["AI_DV_MAX_JOINS", "AI_DV_MAX_PER_SESSION", "AI_DV_PREFLIGHT_TIMEOUT_MS", "AI_DV_MAX_RECORDS", "DEFAULT_VIEW_TTL_MINUTES"] as const;

type Call = { path: string; stmt: string; body: any };
let calls: Call[] = [];
/** Per-test override: return a Response/Promise to take over a /execute/sql statement; undefined = default behaviour. */
let override: ((stmt: string, signal?: AbortSignal) => Response | Promise<Response> | undefined) | null = null;
let counts: { match: RegExp; n: number }[] = [];
let showTable: unknown = { table_names: [] };
let restoreEnv: (() => void) | null = null;
let savedDv: Record<string, string | undefined> = {};
let servers: Server[] = [];

const kbody = (result: unknown) =>
  new Response(JSON.stringify({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }) }), { status: 200 });
const kerr = (message: string, status = 400) => new Response(JSON.stringify({ status: "ERROR", message }), { status });
const notFound = (n: string) => kerr(`SqlEngine: Object '${n}' not found (S/SDc:1513)`);
const cols = (names: string[]) => {
  const r: Record<string, unknown> = { column_headers: names };
  names.forEach((_c, i) => (r[`column_${i + 1}`] = []));
  return kbody(r);
};
const TRIPS_COLS = ["vendor", "fare", "pickup_datetime"];
const ZONES_COLS = ["id", "borough"];
const untag = (s: string) => s.replace(/^\/\*[^*]*\*\/ /, "");

const kfetch = ((url: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  const body = JSON.parse(String(init?.body ?? "{}"));
  const stmt = String(body.statement ?? "");
  calls.push({ path, stmt, body });
  if (path === "/admin/show/jobs") {
    const last = [...calls].reverse().find((c) => c.stmt.startsWith("/* kbi-ai:"));
    return Promise.resolve(new Response(JSON.stringify({ status: "OK", data_str: JSON.stringify({ job_id: ["j1"], query_text: [last?.stmt ?? ""] }) }), { status: 200 }));
  }
  if (path === "/admin/alter/jobs") return Promise.resolve(new Response(JSON.stringify({ status: "OK", data_str: "{}" }), { status: 200 }));
  if (path === "/show/table") return Promise.resolve(new Response(JSON.stringify({ status: "OK", data_str: JSON.stringify(showTable) }), { status: 200 }));
  const o = override?.(untag(stmt), init?.signal as AbortSignal | undefined);
  if (o) return Promise.resolve(o);
  const s = untag(stmt);
  const probe = /^SELECT \* FROM (\S+) LIMIT 0$/.exec(s);
  if (probe) {
    if (probe[1] === "fleet.trips") return Promise.resolve(cols(TRIPS_COLS));
    if (probe[1] === "fleet.zones") return Promise.resolve(cols(ZONES_COLS));
    return Promise.resolve(notFound(probe[1]!));
  }
  if (/^SELECT COUNT\(\*\) FROM _kbi_filt_/.test(s)) return Promise.resolve(notFound("filter"));
  const cnt = counts.find((c) => c.match.test(s));
  if (/^SELECT COUNT\(\*\)/.test(s)) return Promise.resolve(kbody({ column_1: [cnt?.n ?? 50] }));
  return Promise.resolve(kbody({}));
}) as typeof fetch;

const sqlOf = (re: RegExp) => calls.filter((c) => c.path === "/execute/sql" && re.test(untag(c.stmt)));
const kineticaCalls = () => calls.length;

type Ctx = { app: Express; cookie: string; sid: string; dash: number; trips: number; zones: number; name: (tempId?: number, gen?: number) => string };

async function setup(env: Record<string, string> = {}, roles?: { perms: string[] }): Promise<Ctx> {
  for (const k of DV_ENV) savedDv[k] = process.env[k];
  for (const k of DV_ENV) delete process.env[k];
  const { AI_DV_MAX_JOINS, AI_DV_MAX_PER_SESSION, AI_DV_PREFLIGHT_TIMEOUT_MS, AI_DV_MAX_RECORDS, DEFAULT_VIEW_TTL_MINUTES, ...ai } = env;
  for (const [k, v] of Object.entries({ AI_DV_MAX_JOINS, AI_DV_MAX_PER_SESSION, AI_DV_PREFLIGHT_TIMEOUT_MS, AI_DV_MAX_RECORDS, DEFAULT_VIEW_TTL_MINUTES })) {
    if (v !== undefined) process.env[k] = v;
  }
  process.env.DEFAULT_VIEW_TTL_MINUTES ??= "5";
  restoreEnv = enableAiEnv(ai);
  const app = await createApp();
  const role = makeRole("ai-dv-users", roles?.perms ?? ["dashboards:view", "ai:use"]);
  const dash = makeDashboard([role]);
  const trips = createTable({ name: "trips", schema: "fleet", columns: { vendor: "string", fare: "double", pickup_datetime: "timestamp" } });
  const zones = createTable({ name: "zones", schema: "fleet", columns: { id: "int", borough: "string" } });
  addDashboardTable(dash.id, trips.id);
  addDashboardTable(dash.id, zones.id);
  const { cookie, sid } = sessionFor("ann", [role]);
  return { app, cookie, sid, dash: dash.id, trips: trips.id, zones: zones.id, name: (t = -3, g = 0) => buildAiDynamicViewName({ username: "ann", sid, nonce: NONCE, tempId: t, gen: g }) };
}

const summarySpec = (c: Ctx, over: Record<string, unknown> = {}) => ({
  baseTableId: c.trips,
  groupBy: [{ column: "vendor" }],
  aggregates: [{ fn: "sum", column: "fare", as: "total" }],
  filters: [{ column: "vendor", operator: "eq", value: SECRET }],
  ...over,
});
const rowSpec = (c: Ctx, over: Record<string, unknown> = {}) => ({ baseTableId: c.trips, columns: [{ column: "vendor" }, { column: "fare" }], ...over });
const req = (c: Ctx, spec: unknown, over: Record<string, unknown> = {}) => ({ dashboardId: c.dash, nonce: NONCE, tempId: -3, gen: 0, spec, ...over });
const post = (c: Ctx, body: unknown, path = "/api/ai/dynamic-view/materialize") => request(c.app).post(path).set("Cookie", c.cookie).send(body as object);
const seedRow = (c: Ctx, tempId: number, sid = c.sid, username = "ann", nonce = NONCE) =>
  registerAiSessionView({ viewName: buildAiDynamicViewName({ username, sid, nonce, tempId, gen: 0 }), sid, username, dashboardId: c.dash, nonce, tempId, gen: 0 });

let logs: string[] = [];
beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM ai_session_views");
  __clearLiveSchemaCacheForTest();
  calls = [];
  override = null;
  counts = [];
  showTable = { table_names: [] };
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  forbidProviderNetwork(kfetch);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
  for (const k of DV_ENV) {
    if (savedDv[k] === undefined) delete process.env[k];
    else process.env[k] = savedDv[k];
  }
  savedDv = {};
});

describe("AI dynamic-view routes (139)", () => {
  it("AIDV-1 gates: 403 without ai:use, 503 when AI is off, 401 without a cookie", async () => {
    const c = await setup({}, { perms: ["dashboards:view"] });
    let r = await post(c, req(c, rowSpec(c)));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("PERMISSION_DENIED");
    r = await request(c.app).post("/api/ai/dynamic-view/materialize").send(req(c, rowSpec(c)));
    expect(r.status).toBe(401);
    restoreEnv?.();
    restoreEnv = null;
    for (const k of ["AI_ENABLED"]) delete process.env[k];
    const app2 = await createApp();
    const role = makeRole("ai-dv-users2", ["dashboards:view", "ai:use"]);
    const { cookie } = sessionFor("bea", [role]);
    r = await request(app2).post("/api/ai/dynamic-view/materialize").set("Cookie", cookie).send(req(c, rowSpec(c)));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("AIDV-2 a body carrying name/sql/view_name or a bad nonce is 400 with zero Kinetica calls", async () => {
    const c = await setup();
    for (const extra of [{ name: "x" }, { sql: "DROP TABLE a" }, { view_name: "v" }, { nonce: "XYZ" }]) {
      const r = await post(c, req(c, rowSpec(c), extra));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("AI_DV_INVALID");
    }
    expect(kineticaCalls()).toBe(0);
  });

  it("AIDV-3 unviewable dashboard 404; tables not on the dashboard 400", async () => {
    const c = await setup();
    let r = await post(c, { ...req(c, rowSpec(c)), dashboardId: c.dash + 999 });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("Dashboard not found.");
    const stray = createTable({ name: "stray", schema: "fleet", columns: {} });
    r = await post(c, req(c, rowSpec(c, { baseTableId: stray.id })));
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain(`table ${stray.id} isn't on this dashboard`);
    r = await post(c, req(c, rowSpec(c, { joins: [{ tableId: stray.id, type: "inner", on: [{ left: "vendor", right: "id" }] }] })));
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain(`table ${stray.id} isn't on this dashboard`);
    expect(kineticaCalls()).toBe(0);
  });

  it("AIDV-4 more joins than AI_DV_MAX_JOINS is refused without a Kinetica call", async () => {
    const c = await setup();
    const j = { tableId: c.zones, type: "inner", on: [{ left: "vendor", right: "id" }] };
    const r = await post(c, req(c, rowSpec(c, { joins: [j, j, j] })));
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain("a view can join at most 2 tables");
    expect(kineticaCalls()).toBe(0);
  });

  it("AIDV-5 an unknown column is refused from the live schema and nothing is created", async () => {
    const c = await setup();
    const r = await post(c, req(c, summarySpec(c, { aggregates: [{ fn: "sum", column: "fair", as: "total" }] })));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("AI_DV_INVALID");
    expect(r.body.error).toBe("This view can't be built: column `fair` not found on fleet.trips");
    expect(r.body.reasons).toContain("column `fair` not found on fleet.trips");
    expect(sqlOf(/CREATE/)).toHaveLength(0);
  });

  it("AIDV-6 the per-session cap refuses a new view with 409 and no Kinetica call", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "2" });
    seedRow(c, -1);
    seedRow(c, -2);
    const r = await post(c, req(c, rowSpec(c)));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ code: "AI_DV_CAP", error: "you already have 2 session views (limit 2); remove one first" });
    expect(kineticaCalls()).toBe(0);
  });

  it("AIDV-7 the cap counts only the caller's login session", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "2" });
    for (const t of [-11, -12, -13]) seedRow(c, t, "bobsid01", "bob");
    seedRow(c, -1);
    seedRow(c, -2);
    const r = await post(c, req(c, rowSpec(c)));
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("you already have 2 session views");
    expect(kineticaCalls()).toBe(0);
  });

  it("AIDV-8 refusal bodies never contain the spec's filter value", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "1" });
    const bodies = [
      (await post(c, req(c, summarySpec(c), { name: "x" }))).body,
      (await post(c, { ...req(c, summarySpec(c)), dashboardId: c.dash + 999 })).body,
      (await post(c, req(c, summarySpec(c, { baseTableId: 99999 })))).body,
      (await post(c, req(c, summarySpec(c, { groupBy: [{ column: "nope" }] })))).body,
    ];
    seedRow(c, -1);
    bodies.push((await post(c, req(c, summarySpec(c), { tempId: -2 }))).body);
    for (const b of bodies) expect(JSON.stringify(b)).not.toContain(SECRET);
  });

  it("AIDV-9 happy path: aggregated, tagged CREATE under the server-chosen name, registry row written", async () => {
    const c = await setup();
    counts = [{ match: /fleet\.trips/, n: 50 }];
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "materialized", view_name: c.name(), row_count: 50, aggregated: true });
    expect(typeof r.body.expires_at).toBe("number");
    expect(r.body.columns.map((x: { name: string }) => x.name)).toEqual(["vendor", "total"]);
    const sqls = calls.filter((x) => x.path === "/execute/sql").map((x) => x.stmt);
    expect(sqls.filter((s) => /FROM _kbi_filt_/.test(s))).toHaveLength(0);
    const create = sqls.find((s) => /CREATE OR REPLACE MATERIALIZED VIEW/.test(s))!;
    expect(create.startsWith(`/* kbi-ai:aidv-${NONCE}-3-g0 */ CREATE OR REPLACE MATERIALIZED VIEW ${c.name()} AS (SELECT`)).toBe(true);
    expect(create).toContain("FROM fleet.trips AS t0");
    expect(create).toContain("USING TABLE PROPERTIES (TTL = 5)");
    expect(getAiSessionView(c.name())).toBeTruthy();
    expect(c.name()).toMatch(/_n0a1b2c3d_3$/);
  });

  it("AIDV-10 with a combination key the base reads through its filter view", async () => {
    const c = await setup();
    const fv = buildFilterViewName({ username: "ann", sessionId: c.sid, dashboardId: c.dash, tableId: c.trips, combinationKey: "k1" });
    override = (s) => (s === `SELECT COUNT(*) FROM ${fv}` ? kbody({ column_1: [7] }) : undefined);
    const r = await post(c, req(c, summarySpec(c), { combination_key: "k1" }));
    expect(r.status).toBe(200);
    expect(r.body.row_count).toBe(7);
    expect(sqlOf(/CREATE OR REPLACE/)[0]!.stmt).toContain(`FROM ${fv} AS t0`);
  });

  it("AIDV-11 an aggregated view over the source cap builds when the output fits (tagged preflight)", async () => {
    const c = await setup();
    counts = [{ match: /fleet\.trips/, n: 5_000_000 }];
    override = (s) => (/AS kbi_q LIMIT 100001/.test(s) ? kbody({ column_1: [24] }) : undefined);
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "materialized", row_count: 24 });
    const pre = calls.find((x) => x.path === "/execute/sql" && /AS kbi_q LIMIT 100001/.test(x.stmt))!;
    expect(pre.stmt.startsWith(`/* kbi-ai:aidv-${NONCE}-3-g0 */`)).toBe(true);
  });

  it("AIDV-12 a row view over the cap with no filter is over_threshold: no preflight, no CREATE, stale DROP, no row", async () => {
    const c = await setup();
    counts = [{ match: /fleet\.trips/, n: 5_000_000 }];
    const r = await post(c, req(c, rowSpec(c)));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("over_threshold");
    expect(r.body.reason).toBe("no_filter");
    expect(sqlOf(/kbi_q/)).toHaveLength(0);
    expect(sqlOf(/CREATE/)).toHaveLength(0);
    expect(sqlOf(new RegExp(`^DROP TABLE IF EXISTS ${c.name()}$`))).toHaveLength(1);
    expect(getAiSessionView(c.name())).toBeUndefined();
  });

  it("AIDV-13 joins: joined filter view used when it exists, raw otherwise; joined views always preflight", async () => {
    const c = await setup();
    const fv2 = buildFilterViewName({ username: "ann", sessionId: c.sid, dashboardId: c.dash, tableId: c.zones, combinationKey: "k2" });
    const join = { tableId: c.zones, type: "inner", on: [{ left: "vendor", right: "borough" }] };
    const spec = rowSpec(c, { joins: [join], columns: [{ column: "vendor" }, { from: 1, column: "borough" }] });
    override = (s) => (s === `SELECT * FROM ${fv2} LIMIT 0` ? cols(ZONES_COLS) : undefined);
    let r = await post(c, req(c, spec, { joinFilterKeys: { [String(c.zones)]: "k2" } }));
    expect(r.status).toBe(200);
    expect(sqlOf(/CREATE OR REPLACE/)[0]!.stmt).toContain(`JOIN ${fv2} AS t1`);
    expect(sqlOf(/AS kbi_q LIMIT/).length).toBeGreaterThanOrEqual(1);

    calls = [];
    override = null;
    r = await post(c, req(c, spec, { joinFilterKeys: { [String(c.zones)]: "k2" } }));
    expect(r.status).toBe(200);
    expect(sqlOf(/CREATE OR REPLACE/)[0]!.stmt).toContain("JOIN fleet.zones AS t1");
    expect(sqlOf(/AS kbi_q LIMIT/).length).toBeGreaterThanOrEqual(1);

    calls = [];
    override = (s) => (/AS kbi_q LIMIT/.test(s) ? kbody({ column_1: [100001] }) : undefined);
    r = await post(c, req(c, spec));
    expect(r.body).toMatchObject({ status: "over_threshold", reason: "no_filter", row_count: 100001 });
    expect(sqlOf(/CREATE OR REPLACE/)).toHaveLength(0);
  });

  it("AIDV-14 the deadline cancels the tagged job and answers 504", async () => {
    const c = await setup({ AI_DV_PREFLIGHT_TIMEOUT_MS: "1000" });
    counts = [{ match: /fleet\.trips/, n: 5_000_000 }];
    override = (s, signal) =>
      /AS kbi_q LIMIT/.test(s)
        ? (new Promise((_res, rej) => signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) as Promise<Response>)
        : undefined;
    const t0 = Date.now();
    const r = await post(c, req(c, summarySpec(c)));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.status).toBe(504);
    expect(r.body).toEqual({ code: "AI_DV_TIMEOUT", error: "The view took too long to build and was cancelled." });
    expect(calls.some((x) => x.path === "/admin/show/jobs")).toBe(true);
    expect(calls.some((x) => x.path === "/admin/alter/jobs")).toBe(true);
    expect(getAiSessionView(c.name())).toBeUndefined();
  });

  it("AIDV-15 a client abort mid-CREATE cancels the tagged job", async () => {
    const c = await setup();
    const { base, server } = await listenApp(c.app);
    servers.push(server);
    override = (s, signal) =>
      /CREATE OR REPLACE/.test(s)
        ? (new Promise((_res, rej) => signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) as Promise<Response>)
        : undefined;
    const ac = new AbortController();
    const p = realFetch(`${base}/api/ai/dynamic-view/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c.cookie },
      body: JSON.stringify(req(c, summarySpec(c))),
      signal: ac.signal,
    }).catch(() => null);
    expect(await pollUntil(() => sqlOf(/CREATE OR REPLACE/).length > 0)).toBe(true);
    ac.abort();
    await p;
    expect(await pollUntil(() => calls.some((x) => x.path === "/admin/alter/jobs"))).toBe(true);
  });

  it("AIDV-16 Pitfall 3: a row deleted during the CREATE means the view is dropped again", async () => {
    const c = await setup();
    override = (s) => {
      if (/CREATE OR REPLACE/.test(s)) db.prepare("DELETE FROM ai_session_views WHERE view_name = ?").run(c.name());
      return undefined;
    };
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.body).toEqual({ status: "dropped" });
    const all = calls.filter((x) => x.path === "/execute/sql").map((x) => untag(x.stmt));
    const ci = all.findIndex((s) => /CREATE OR REPLACE/.test(s));
    expect(all.slice(ci + 1)).toContain(`DROP TABLE IF EXISTS ${c.name()}`);
  });

  it("AIDV-17 a failing CREATE surfaces an error and removes the registry row", async () => {
    const c = await setup();
    override = (s) => (/CREATE OR REPLACE/.test(s) ? kerr("boom", 500) : undefined);
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(getAiSessionView(c.name())).toBeUndefined();
  });

  it("AIDV-18 gen 2 names the view _g2 and a gen-0 row of the same temp id does not trip the cap", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "1" });
    seedRow(c, -3);
    const r = await post(c, req(c, summarySpec(c), { gen: 2 }));
    expect(r.status).toBe(200);
    expect(r.body.view_name).toBe(c.name(-3, 2));
    expect(r.body.view_name).toMatch(/_3_g2$/);
    expect(getAiSessionView(c.name(-3, 0))).toBeTruthy();
  });

  it("AIDV-6b a rebuild of a temp id that already has a row passes the cap", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "2" });
    seedRow(c, -3);
    seedRow(c, -2);
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("materialized");
  });

  it("AIDV-7b another user's rows do not count against the caller", async () => {
    const c = await setup({ AI_DV_MAX_PER_SESSION: "2" });
    for (const t of [-11, -12, -13]) seedRow(c, t, "bobsid01", "bob");
    seedRow(c, -1);
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBe(200);
    expect(countAiSessionViews(c.sid)).toBe(2);
  });

  it("AIDV-19 a base table the user cannot describe is refused and nothing is created", async () => {
    const c = await setup();
    override = (s) => (s === "SELECT * FROM fleet.trips LIMIT 0" ? kerr("denied", 403) : undefined);
    const r = await post(c, req(c, summarySpec(c)));
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain(`table ${c.trips} is not available`);
    expect(sqlOf(/CREATE/)).toHaveLength(0);
  });

  it("AIDV-20 neither responses nor logs carry the filter value", async () => {
    const c = await setup();
    const r1 = await post(c, req(c, summarySpec(c)));
    const r2 = await post(c, req(c, summarySpec(c, { groupBy: [{ column: "nope" }] }), { tempId: -4 }));
    const r3 = await post(c, req(c, summarySpec(c)), "/api/ai/dynamic-view/drop");
    for (const r of [r1, r2, r3]) expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  const dropBody = (c: Ctx, over: Record<string, unknown> = {}) => ({ dashboardId: c.dash, nonce: NONCE, tempId: -3, gen: 0, ...over });

  it("AIDV-21 drop cancels tagged jobs, drops the view and deletes the row", async () => {
    const c = await setup();
    seedRow(c, -3);
    const r = await post(c, dropBody(c), "/api/ai/dynamic-view/drop");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ dropped: true });
    expect(calls.some((x) => x.path === "/admin/show/jobs")).toBe(true);
    expect(sqlOf(new RegExp(`^DROP TABLE IF EXISTS ${c.name()}$`))).toHaveLength(1);
    expect(getAiSessionView(c.name())).toBeUndefined();
  });

  it("AIDV-22 drop is idempotent", async () => {
    const c = await setup();
    expect((await post(c, dropBody(c), "/api/ai/dynamic-view/drop")).body).toEqual({ dropped: true });
    expect((await post(c, dropBody(c), "/api/ai/dynamic-view/drop")).body).toEqual({ dropped: true });
  });

  it("AIDV-23 drop works for a user whose ai:use is revoked", async () => {
    const c = await setup({}, { perms: ["dashboards:view"] });
    seedRow(c, -3);
    const r = await post(c, dropBody(c), "/api/ai/dynamic-view/drop");
    expect(r.status).toBe(200);
    expect(sqlOf(new RegExp(`^DROP TABLE IF EXISTS ${c.name()}$`))).toHaveLength(1);
  });

  it("AIDV-24 drop only ever targets the caller's own user+session prefix", async () => {
    const c = await setup();
    await post(c, dropBody(c, { nonce: "ffffffff", tempId: -9 }), "/api/ai/dynamic-view/drop");
    const drops = sqlOf(/^DROP TABLE IF EXISTS /).map((x) => untag(x.stmt));
    expect(drops).toHaveLength(1);
    expect(drops[0]!.startsWith(`DROP TABLE IF EXISTS _kbi_ai_uann_s${c.sid.slice(0, 8)}_nffffffff_9`)).toBe(true);
  });

  it("AIDV-25 list returns only the caller's own AI views (exact owner, any session), schema stripped", async () => {
    const c = await setup();
    const mine = "_kbi_ai_uann_s01234567_n0a1b2c3d_3";
    showTable = { table_names: [`ki_home.${mine}`, "_kbi_ai_uother_s99999999_n0a1b2c3d_1", "_kbi_dv_uann_d1_2", "demo.trips"] };
    const r = await request(c.app).get("/api/ai/dynamic-view/list").set("Cookie", c.cookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ views: [mine] });
    const st = calls.find((x) => x.path === "/show/table")!;
    expect(st.body.table_name).toBe("*");
    expect(st.body.options.show_children).toBe("true");
  });

  it("AIDV-26 a Kinetica error on list is 502 with fixed text", async () => {
    const c = await setup();
    const orig = kfetch;
    vi.stubGlobal("fetch", (u: RequestInfo | URL, i?: RequestInit) =>
      new URL(String(u)).pathname === "/show/table" ? Promise.resolve(new Response("{}", { status: 500 })) : orig(u, i),
    );
    const r = await request(c.app).get("/api/ai/dynamic-view/list").set("Cookie", c.cookie);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "Could not list views." });
  });

  it("AIDV-27 a longer-prefixed user (al_x) is not listed for caller al", async () => {
    const c = await setup();
    const { cookie } = sessionFor("al", [makeRole("al-role", ["dashboards:view"])]);
    showTable = { table_names: ["_kbi_ai_ual_x_s01234567_n0a1b2c3d_4", "_kbi_ai_ual_s89abcdef_n0a1b2c3d_5"] };
    const r = await request(c.app).get("/api/ai/dynamic-view/list").set("Cookie", cookie);
    expect(r.body).toEqual({ views: ["_kbi_ai_ual_s89abcdef_n0a1b2c3d_5"] });
  });

  it("AIDV-28 list needs only a session (no ai:use) and a cookie", async () => {
    const c = await setup({}, { perms: ["dashboards:view"] });
    showTable = { table_names: ["_kbi_ai_uann_s01234567_n0a1b2c3d_3"] };
    const ok = await request(c.app).get("/api/ai/dynamic-view/list").set("Cookie", c.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.views).toHaveLength(1);
    expect((await request(c.app).get("/api/ai/dynamic-view/list")).status).toBe(401);
  });
});
