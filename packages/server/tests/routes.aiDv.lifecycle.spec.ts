// Phase 139-06: logout drops the session's AI views server-side BEFORE the session row is deleted (AISAFE-V20-06).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { getSession } from "../src/sessionStore";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { registerAiSessionView, listAiSessionViewsForSid } from "../src/lib/aiSessionViews";
import { sessionFor, resetAiTables } from "./helpers/aiRouteKit";

const NONCE = "0a1b2c3d";
const ok = () => new Response(JSON.stringify({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: "{}" }) }), { status: 200 });

const seed = (sid: string, tempId: number, username = "ann") => {
  const viewName = buildAiDynamicViewName({ username, sid, nonce: NONCE, tempId, gen: 0 });
  registerAiSessionView({ viewName, sid, username, dashboardId: 1, nonce: NONCE, tempId, gen: 0 });
  return viewName;
};

let drops: { stmt: string; sessionPresent: boolean }[] = [];
const sidRef: { sid: string } = { sid: "" };

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM ai_session_views");
  drops = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("logout drops AI views (139-06)", () => {
  it("LIFE-DV-1 ORDER: both DROPs run while the session still exists; afterwards session and rows are gone", async () => {
    const app = await createApp();
    const { sid, cookie } = sessionFor("ann");
    sidRef.sid = sid;
    seed(sid, -3);
    seed(sid, -4);
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
      if (/DROP TABLE IF EXISTS _kbi_ai_/.test(stmt)) drops.push({ stmt, sessionPresent: getSession(sid) !== null && getSession(sid) !== undefined });
      return ok();
    }));
    const r = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(r.status).toBe(204);
    expect(drops).toHaveLength(2);
    expect(drops.every((d) => d.sessionPresent)).toBe(true);
    expect(getSession(sid) ?? null).toBeNull();
    expect(listAiSessionViewsForSid(sid)).toHaveLength(0);
  });

  it("LIFE-DV-2: Kinetica down -> still 204, session deleted, rows deleted", async () => {
    const app = await createApp();
    const { sid, cookie } = sessionFor("ann");
    seed(sid, -3);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const t0 = Date.now();
    const r = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(r.status).toBe(204);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(getSession(sid) ?? null).toBeNull();
    expect(listAiSessionViewsForSid(sid)).toHaveLength(0);
  });

  it("LIFE-DV-3: no cookie / malformed cookie -> 204 and no DROP issued", async () => {
    const app = await createApp();
    const { sid } = sessionFor("ann");
    seed(sid, -3);
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    expect((await request(app).post("/api/auth/logout")).status).toBe(204);
    expect((await request(app).post("/api/auth/logout").set("Cookie", "kbi_session=garbage")).status).toBe(204);
    expect(f).not.toHaveBeenCalled();
    expect(listAiSessionViewsForSid(sid)).toHaveLength(1);
  });

  it("LIFE-DV-4: other sessions' rows (same user) are untouched", async () => {
    const app = await createApp();
    const a = sessionFor("ann");
    const b = sessionFor("ann");
    seed(a.sid, -3);
    const other = seed(b.sid, -3);
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    const r = await request(app).post("/api/auth/logout").set("Cookie", a.cookie);
    expect(r.status).toBe(204);
    expect(listAiSessionViewsForSid(a.sid)).toHaveLength(0);
    expect(listAiSessionViewsForSid(b.sid).map((x) => x.viewName)).toEqual([other]);
  });

  it("LIFE-DV-5: a DROP that never resolves -> 204 in < 4 s (bounded by 3000 ms)", async () => {
    const app = await createApp();
    const { sid, cookie } = sessionFor("ann");
    seed(sid, -3);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const t0 = Date.now();
    const r = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(r.status).toBe(204);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(getSession(sid) ?? null).toBeNull();
  }, 10000);
});
