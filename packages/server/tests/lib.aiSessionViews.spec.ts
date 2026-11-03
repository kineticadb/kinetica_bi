import { describe, it, expect, vi, afterEach } from "vitest";
import { createDb } from "../src/db";
import {
  registerAiSessionView, getAiSessionView, deleteAiSessionView, countAiSessionViews, findAiSessionView,
  dropViewsForSid, dropViewsForDashboard, sweepAiViewsOnBoot, type AiSessionViewRow,
} from "../src/lib/aiSessionViews";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { SessionEndedError } from "../src/lib/exportRunner";
import { KineticaAuthError } from "../src/kineticaErrors";
import type { KineticaPrincipal } from "../src/kinetica";

afterEach(() => vi.restoreAllMocks());

const NONCE = "0a1b2c3d";
const mk = (sid: string, tempId: number, gen = 0, username = "alice", dashboardId = 12): AiSessionViewRow => ({
  viewName: buildAiDynamicViewName({ username, sid, nonce: NONCE, tempId, gen }), sid, username, dashboardId, nonce: NONCE, tempId, gen,
});
const A = "aaaaaaaa11111111";
const B = "bbbbbbbb22222222";
const principal = { user: { sub: "alice" } } as unknown as KineticaPrincipal;
const okPrincipal = () => principal;

describe("aiSessionViews", () => {
  it("REGV-1: table + index", () => {
    const c = createDb(":memory:");
    expect(c.prepare("SELECT name FROM sqlite_master WHERE name = 'ai_session_views'").get()).toBeTruthy();
    expect(c.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_ai_session_views_sid'").get()).toBeTruthy();
  });
  it("REGV-2: CRUD + replace", () => {
    const c = createDb(":memory:");
    const r = mk(A, -3);
    registerAiSessionView(r, c);
    expect(getAiSessionView(r.viewName, c)).toEqual(r);
    registerAiSessionView({ ...r, dashboardId: 99 }, c);
    expect(getAiSessionView(r.viewName, c)!.dashboardId).toBe(99);
    expect(deleteAiSessionView(r.viewName, c)).toBe(true);
    expect(deleteAiSessionView(r.viewName, c)).toBe(false);
  });
  it("REGV-3: cap count with exclude", () => {
    const c = createDb(":memory:");
    for (const t of [-1, -2, -3]) registerAiSessionView(mk(A, t), c);
    registerAiSessionView(mk(A, -3, 1), c);
    registerAiSessionView(mk(B, -1), c);
    expect(countAiSessionViews(A, undefined, c)).toBe(4);
    expect(countAiSessionViews(A, { nonce: NONCE, tempId: -3 }, c)).toBe(2);
    expect(countAiSessionViews(B, undefined, c)).toBe(1);
  });
  it("REGV-4: find by gen", () => {
    const c = createDb(":memory:");
    registerAiSessionView(mk(A, -3, 0), c);
    registerAiSessionView(mk(A, -3, 1), c);
    const f = findAiSessionView({ sid: A, dashboardId: 12, nonce: NONCE, tempId: -3, gen: 1 }, c);
    expect(f?.gen).toBe(1);
    expect(findAiSessionView({ sid: A, dashboardId: 12, nonce: NONCE, tempId: -3, gen: 2 }, c)).toBeUndefined();
  });
  it("REGV-5: dropViewsForSid drops own rows only", async () => {
    const c = createDb(":memory:");
    const rows = [mk(A, -1), mk(A, -2), mk(A, -3)];
    rows.forEach((r) => registerAiSessionView(r, c));
    registerAiSessionView(mk(B, -1), c);
    const sql = vi.fn().mockResolvedValue({});
    const res = await dropViewsForSid(A, { sql, principalFor: okPrincipal, conn: c });
    expect(res).toEqual({ dropped: 3, failed: 0 });
    expect(sql.mock.calls.map((x) => x[1]).sort()).toEqual(rows.map((r) => `DROP TABLE IF EXISTS ${r.viewName}`).sort());
    expect(sql.mock.calls.every((x) => x[2].op === "DYNAMIC_DROP")).toBe(true);
    expect(countAiSessionViews(A, undefined, c)).toBe(0);
    expect(countAiSessionViews(B, undefined, c)).toBe(1);
  });
  it("REGV-6: unparseable name never dropped", async () => {
    const c = createDb(":memory:");
    c.prepare("INSERT INTO ai_session_views (view_name, sid, username, dashboard_id, nonce, temp_id) VALUES ('evil_table', ?, 'alice', 1, 'x', -1)").run(A);
    const sql = vi.fn().mockResolvedValue({});
    const res = await dropViewsForSid(A, { sql, principalFor: okPrincipal, conn: c });
    expect(sql).not.toHaveBeenCalled();
    expect(res).toEqual({ dropped: 0, failed: 1 });
    expect(getAiSessionView("evil_table", c)).toBeUndefined();
  });
  it("REGV-7: one failure does not stop others", async () => {
    const c = createDb(":memory:");
    const rows = [mk(A, -1), mk(A, -2), mk(A, -3)];
    rows.forEach((r) => registerAiSessionView(r, c));
    const sql = vi.fn().mockImplementation(async (_p: unknown, q: string) => {
      if (q.includes(rows[1]!.viewName)) throw new Error("boom");
      return {};
    });
    const res = await dropViewsForSid(A, { sql, principalFor: okPrincipal, conn: c });
    expect(res).toEqual({ dropped: 2, failed: 1 });
    expect(countAiSessionViews(A, undefined, c)).toBe(0);
  });
  it("REGV-8: bounded by timeoutMs", async () => {
    const c = createDb(":memory:");
    registerAiSessionView(mk(A, -1), c);
    registerAiSessionView(mk(A, -2), c);
    const sql = vi.fn().mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await dropViewsForSid(A, { sql, principalFor: okPrincipal, conn: c, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res).toEqual({ dropped: 0, failed: 2 });
  });
  it("REGV-9: sweep drops rebuildable sessions, rest TTL-only", async () => {
    const c = createDb(":memory:");
    const C = "cccccccc33333333";
    registerAiSessionView(mk(A, -1), c);
    registerAiSessionView(mk(B, -1), c);
    registerAiSessionView(mk(C, -1), c);
    const principalFor = (sid: string) => {
      if (sid === B) throw new SessionEndedError();
      return { user: { sub: sid } } as unknown as KineticaPrincipal;
    };
    const sql = vi.fn().mockImplementation(async (p: { user: { sub: string } }) => {
      if (p.user.sub === C) throw new KineticaAuthError("expired", 401);
      return {};
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sweepAiViewsOnBoot({ sql, principalFor, conn: c });
    expect(res).toEqual({ dropped: 1, ttlOnly: 2, failed: 0 });
    expect(sql).toHaveBeenCalledTimes(2); // B never reaches DDL
    expect(c.prepare("SELECT COUNT(*) AS n FROM ai_session_views").get()).toEqual({ n: 0 });
  });
  it("REGV-10: one summary log line, no names", async () => {
    const c = createDb(":memory:");
    registerAiSessionView(mk(A, -1), c);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sweepAiViewsOnBoot({ sql: vi.fn().mockResolvedValue({}), principalFor: okPrincipal, conn: c });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toMatch(/^\[ai\] boot sweep: dropped \d+ AI session views; \d+ left to TTL/);
    expect(line).not.toContain("alice");
    expect(line).not.toContain("_kbi_ai_");
  });
});

describe("dropViewsForDashboard (REGV-D)", () => {
  const forDash = (c: ReturnType<typeof createDb>, d: number) => (c.prepare("SELECT COUNT(*) AS n FROM ai_session_views WHERE dashboard_id = ?").get(d) as { n: number }).n;
  it("REGV-D1: drops only that dashboard's rows, across sessions", async () => {
    const c = createDb(":memory:");
    const rows = [mk(A, -1, 0, "alice", 7), mk(A, -2, 0, "alice", 7), mk(B, -1, 0, "alice", 7)];
    rows.forEach((r) => registerAiSessionView(r, c));
    registerAiSessionView(mk(A, -3, 0, "alice", 8), c);
    const sql = vi.fn().mockResolvedValue({});
    const res = await dropViewsForDashboard(7, { sql, principalFor: okPrincipal, conn: c });
    expect(res).toEqual({ dropped: 3, failed: 0 });
    expect(sql.mock.calls.map((x) => x[1]).sort()).toEqual(rows.map((r) => `DROP TABLE IF EXISTS ${r.viewName}`).sort());
    expect(sql.mock.calls.every((x) => x[2].op === "DYNAMIC_DROP")).toBe(true);
    expect(forDash(c, 7)).toBe(0);
    expect(forDash(c, 8)).toBe(1);
  });
  it("REGV-D2: ended session counts failed but rows are deleted", async () => {
    const c = createDb(":memory:");
    registerAiSessionView(mk(A, -1, 0, "alice", 7), c);
    const sql = vi.fn().mockResolvedValue({});
    const res = await dropViewsForDashboard(7, { sql, principalFor: () => { throw new SessionEndedError(); }, conn: c });
    expect(res).toEqual({ dropped: 0, failed: 1 });
    expect(sql).not.toHaveBeenCalled();
    expect(forDash(c, 7)).toBe(0);
  });
  it("REGV-D3: bounded by timeoutMs and still deletes rows", async () => {
    const c = createDb(":memory:");
    registerAiSessionView(mk(A, -1, 0, "alice", 7), c);
    const sql = vi.fn().mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await dropViewsForDashboard(7, { sql, principalFor: okPrincipal, conn: c, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res).toEqual({ dropped: 0, failed: 1 });
    expect(forDash(c, 7)).toBe(0);
  });
});
