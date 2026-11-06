// Phase 142-09 (AIGOV-V20-05): read-only audit API behind audit:view. AUDAPI-1..12.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db, createDashboard } from "../src/db";
import { sessionFor, resetAiTables, listenApp } from "./helpers/aiRouteKit";

let servers: Server[] = [];
let base = "";
let ann: { cookie: string }, dee: { cookie: string }, al: { cookie: string };
let L = 0, P = 0;
const DAY = 86_400_000;
const NOW = Date.now();
const ids: Record<string, number> = {};

type Row = Partial<{ ts: number; user: string; dash: number | null; req: string | null; q: string; ans: string | null; outcome: string | null; detail: string | null;
  kind: string | null; tools: string | null; changes: string | null; queries: string | null; steps: number; dur: number }>;
function ins(key: string, r: Row): number {
  const info = db.prepare(
    `INSERT INTO ai_audit (ts_ms, username, dashboard_id, request_id, question, answer_text, status, outcome, outcome_detail, provider, model, data_access, allow_list_version,
       steps, input_tokens, output_tokens, tools_json, changes_json, duration_ms, queries_json, kind)
     VALUES (@ts, @user, @dash, @req, @q, @ans, 'done', @outcome, @detail, 'gemini', 'g-model', 'schema_only', 'v1', @steps, 10, 20, @tools, @changes, @dur, @queries, @kind)`,
  ).run({ ts: r.ts ?? NOW - 1000, user: r.user ?? "dee", dash: r.dash === undefined ? L : r.dash, req: r.req ?? `uuid-${key}`, q: r.q ?? `q ${key}`, ans: r.ans === undefined ? `answer ${key}` : r.ans,
    outcome: r.outcome === undefined ? "ok" : r.outcome, detail: r.detail ?? null, steps: r.steps ?? 1, tools: r.tools ?? null, changes: r.changes ?? null, dur: r.dur ?? 5, queries: r.queries ?? null, kind: r.kind === undefined ? "ask" : r.kind });
  ids[key] = Number(info.lastInsertRowid);
  return ids[key];
}
const ARGS = "SECRET_ARG_VALUE_42";

beforeEach(async () => {
  resetAiTables();
  const l = createDashboard("Fleet", "");
  L = l.id;
  const p = createDashboard("Secret starter", "");
  P = p.id;
  db.prepare("UPDATE dashboards SET generated_by = 'dee', generated_pending_at = ? WHERE id = ?").run(NOW, P);
  const app = await createApp();
  const l2 = await listenApp(app);
  servers.push(l2.server);
  base = l2.base;
  ann = sessionFor("ann", ["admin"]);
  dee = sessionFor("dee", ["designer"]);
  al = sessionFor("al", ["analyst"]);
  const k = (n: number, a: number, b: number, c: number) => JSON.stringify({ added: { widgets: n, layers: a, dynamicViews: 0 }, edited: { widgets: b, layers: 0 }, removed: { widgets: c, layers: 0, dynamicViews: 0 }, idMap: { "1": 2 } });
  ins("ask", { ts: NOW - 1000, q: "How many trips?", tools: JSON.stringify([{ name: "describe_table", args: { t: ARGS }, result: "ok", stage: "s", reasons: ["r1"] }]),
    queries: JSON.stringify([{ sql: "SELECT 1", rowCount: 200, durationMs: 35, outcome: "ok" }]), changes: JSON.stringify({ applied: ["a"], rejected: [] }) });
  ins("gen", { ts: NOW - 2000, dash: P, kind: "generate", q: "Build me one" });
  ins("kept", { ts: NOW - 3000, kind: "keep", q: "", req: "keep-1-a", outcome: "kept", changes: k(1, 1, 1, 0) });
  ins("conflict", { ts: NOW - 4000, kind: "keep", q: "", req: "keep-2-a", outcome: "keep_conflict" });
  ins("denied", { ts: NOW - 5000, kind: "keep", q: "", req: "keep-3-a", outcome: "keep_denied" });
  ins("invalid", { ts: NOW - 6000, kind: "keep", q: "", req: "keep-4-a", outcome: "keep_invalid" });
  ins("failed", { ts: NOW - 7000, kind: "keep", q: "", req: "keep-5-a", outcome: "keep_failed" });
  ins("legacykeep", { ts: NOW - 8000, kind: null, q: "", req: "keep-1-abc", outcome: "kept" });
  ins("legacyask", { ts: NOW - 9000, kind: null });
  ins("deadline", { ts: NOW - 10000, tools: "[]", outcome: "provider_error", detail: "timeout" });
  ins("interrupted", { ts: NOW - 11000, tools: null, outcome: null });
  ins("capped", { ts: NOW - 12000, ans: null, outcome: "capped" });
  ins("deleted", { ts: NOW - 13000, dash: 999 });
  ins("nodash", { ts: NOW - 14000, dash: null });
  ins("old", { ts: NOW - 8 * DAY });
  ins("long", { ts: NOW - 15000, q: "x".repeat(300) });
  ins("badjson", { ts: NOW - 16000, tools: "{not json", changes: "[[", queries: "oops" });
  for (let i = 0; i < 60; i++) ins(`pg${i}`, { ts: NOW - 100_000 - i });
});
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

const get = (path: string, who: { cookie: string } | null = ann) => fetch(`${base}${path}`, { headers: who ? { Cookie: who.cookie } : {} });
const json = async (path: string, who: { cookie: string } | null = ann) => (await get(path, who)).json() as Promise<any>;
const IN_WINDOW = 60 + 16; // all rows except "old"

describe("AUDAPI-1 gate", () => {
  it("401 / 403 / 200, even with AI disabled", async () => {
    for (const p of ["/api/ai/audit", `/api/ai/audit/${ids.ask}`, "/api/ai/audit/dashboards"]) {
      expect((await get(p, null)).status).toBe(401);
      for (const who of [dee, al]) {
        const r = await get(p, who);
        expect(r.status).toBe(403);
        expect(await r.json()).toMatchObject({ code: "PERMISSION_DENIED", permission: "audit:view" });
      }
      expect((await get(p, ann)).status).toBe(200);
    }
  });
});

describe("AUDAPI-2 window + order + paging", () => {
  it("default 7 days, newest first, 50 per page", async () => {
    const b = await json("/api/ai/audit");
    expect(b.pageSize).toBe(50);
    expect(b.total).toBe(IN_WINDOW);
    expect(b.rows.length).toBe(50);
    expect(b.rows.map((r: any) => r.id)).not.toContain(ids.old);
    const ts = b.rows.map((r: any) => r.ts);
    expect([...ts].sort((x: number, y: number) => y - x)).toEqual(ts);
    expect(b.rows[0].id).toBe(ids.ask);
    const p2 = await json("/api/ai/audit?page=2");
    expect(p2.rows.length).toBe(IN_WINDOW - 50);
    const p99 = await json("/api/ai/audit?page=99");
    expect(p99.rows).toEqual([]);
    expect(p99.total).toBe(IN_WINDOW);
  });
});

describe("AUDAPI-3 outcome filter", () => {
  it("filters and validates", async () => {
    expect((await json("/api/ai/audit?outcome=keep_conflict")).rows.map((r: any) => r.id)).toEqual([ids.conflict]);
    const two = await json("/api/ai/audit?outcome=kept,keep_failed");
    expect(new Set(two.rows.map((r: any) => r.outcome))).toEqual(new Set(["kept", "keep_failed"]));
    for (const o of ["ok", "cancelled", "capped", "provider_error", "rate_limited", "kept", "keep_conflict", "keep_denied", "keep_invalid", "keep_failed"]) {
      expect((await get(`/api/ai/audit?outcome=${o}`)).status).toBe(200);
    }
    for (const bad of ["bogus", encodeURIComponent("ok')") + "%20OR%201=1--"]) {
      const r = await get(`/api/ai/audit?outcome=${bad}`);
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: "AI_AUDIT_BAD_REQUEST" });
    }
  });
});

describe("AUDAPI-3b unfinished Claude Desktop row", () => {
  it("an unfinished Claude Desktop row is listed and filterable", async () => {
    const id = ins("unfinished", { kind: "mcp", outcome: "unfinished", detail: "discarded", q: 'Started "Trips" in Claude Desktop (not finished)' });
    const res = await get("/api/ai/audit?outcome=unfinished");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: any) => r.id)).toEqual([id]);
    expect(body.rows[0]).toMatchObject({ outcome: "unfinished", kind: "mcp" });
    const d = await json(`/api/ai/audit/${id}`);
    expect(d.outcomeDetail).toBe("discarded");
  });
});

describe("AUDAPI-4 dashboard filter", () => {
  it("filters and validates", async () => {
    const b = await json(`/api/ai/audit?dashboardId=${L}`);
    expect(b.rows.length).toBeGreaterThan(0);
    expect(b.rows.every((r: any) => r.dashboardId === L)).toBe(true);
    for (const bad of ["0", "-1", "abc", encodeURIComponent("1 OR 1=1")]) expect((await get(`/api/ai/audit?dashboardId=${bad}`)).status).toBe(400);
  });
});

describe("AUDAPI-5 date params", () => {
  it("bound the window; invalid -> 400", async () => {
    const b = await json(`/api/ai/audit?from=${NOW - 9 * DAY}&to=${NOW}`);
    expect(b.total).toBe(IN_WINDOW + 1);
    const narrow = await json(`/api/ai/audit?from=${NOW - 3500}&to=${NOW}`);
    expect(narrow.rows.map((r: any) => r.id)).toEqual([ids.ask, ids.gen, ids.kept]);
    expect((await get("/api/ai/audit?from=10&to=5")).status).toBe(400);
    expect((await get("/api/ai/audit?from=1.5")).status).toBe(400);
    expect((await get("/api/ai/audit?to=abc")).status).toBe(400);
  });
});

describe("AUDAPI-6/7 kind + keep summaries", () => {
  it("derives kind and exact summaries", async () => {
    const b = await json("/api/ai/audit?page=1");
    const by = (k: string) => b.rows.find((r: any) => r.id === ids[k]);
    expect(by("gen").kind).toBe("generate");
    expect(by("legacykeep").kind).toBe("keep");
    expect(by("legacyask").kind).toBe("ask");
    expect(by("kept").summary).toBe("Kept 2 added, 1 edited, 0 removed");
    expect(by("conflict").summary).toBe("Not kept: someone else changed the dashboard");
    expect(by("denied").summary).toBe("Not kept: a permission was missing");
    expect(by("invalid").summary).toBe("Not kept: the change was invalid");
    expect(by("failed").summary).toBe("Not kept: saving failed");
    expect(by("kept").question).toBe("");
    expect(by("ask").summary).toBeNull();
  });
});

describe("AUDAPI-8 truncation", () => {
  it("160 + ellipsis in list, full in detail", async () => {
    const b = await json("/api/ai/audit");
    expect(b.rows.find((r: any) => r.id === ids.long).question).toBe("x".repeat(160) + "…");
    expect((await json(`/api/ai/audit/${ids.long}`)).question).toBe("x".repeat(300));
  });
});

describe("AUDAPI-9 dashboard state", () => {
  it("live / pending / deleted / none", async () => {
    const text = JSON.stringify(await json("/api/ai/audit?page=1"));
    expect(text).not.toContain("Secret starter");
    const b = await json("/api/ai/audit");
    const by = (k: string) => b.rows.find((r: any) => r.id === ids[k]);
    expect(by("ask")).toMatchObject({ dashboardName: "Fleet", dashboardState: "live" });
    expect(by("gen")).toMatchObject({ dashboardName: null, dashboardState: "pending" });
    expect(by("deleted")).toMatchObject({ dashboardName: null, dashboardState: "deleted" });
    expect(by("nodash")).toMatchObject({ dashboardName: null, dashboardState: "none" });
  });
});

describe("AUDAPI-10 list leaks nothing", () => {
  it("no answer, tools, queries or args", async () => {
    const text = JSON.stringify(await json("/api/ai/audit"));
    for (const w of ["answerText", "answer_text", "answer ask", '"tools"', '"queries"', ARGS, "SELECT 1"]) expect(text).not.toContain(w);
  });
});

describe("AUDAPI-11 detail", () => {
  it("ask row", async () => {
    const d = await json(`/api/ai/audit/${ids.ask}`);
    expect(d).toMatchObject({ answerText: "answer ask", provider: "gemini", model: "g-model", dataAccess: "schema_only", allowListVersion: "v1", inputTokens: 10, outputTokens: 20 });
    expect(d.tools).toEqual([{ name: "describe_table", result: "ok", stage: "s", reasons: ["r1"] }]);
    expect(JSON.stringify(d)).not.toContain(ARGS);
    expect(d.queries).toEqual([{ sql: "SELECT 1", rowCount: 200, durationMs: 35, outcome: "ok" }]);
    expect(d.changes).toEqual({ applied: ["a"], rejected: [] });
  });
  it("keep changes drop idMap", async () => {
    const d = await json(`/api/ai/audit/${ids.kept}`);
    expect(d.changes.added).toBeTruthy();
    expect(d.changes.idMap).toBeUndefined();
  });
  it("deadline / interrupted / malformed / capped", async () => {
    expect((await json(`/api/ai/audit/${ids.deadline}`)).tools).toEqual([]);
    expect((await json(`/api/ai/audit/${ids.interrupted}`)).tools).toBeNull();
    const r = await get(`/api/ai/audit/${ids.badjson}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ tools: null, changes: null, queries: null });
    expect((await json(`/api/ai/audit/${ids.capped}`)).answerText).toBeNull();
  });
  it("404 / 400", async () => {
    const r = await get("/api/ai/audit/99999999");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not found." });
    expect((await get("/api/ai/audit/abc")).status).toBe(400);
  });
});

describe("AUDAPI-12 facet", () => {
  it("lists each dashboard once, no pending name", async () => {
    const b = await json("/api/ai/audit/dashboards");
    expect(JSON.stringify(b)).not.toContain("Secret starter");
    expect(b.dashboards).toEqual([
      { id: L, name: "Fleet", state: "live" },
      ...[{ id: P, name: null, state: "pending" }, { id: 999, name: null, state: "deleted" }].sort((x, y) => x.id - y.id),
    ]);
  });
});
