// Phase 139-06 (D-23): drill clicks on a widget bound to an AI session view filter it like a saved dv.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db, createDashboard } from "../src/db";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { registerAiSessionView } from "../src/lib/aiSessionViews";

const NONCE = "0a1b2c3d";
const kbody = (result: unknown) =>
  new Response(JSON.stringify({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }) }), { status: 200 });

let stmts: string[] = [];
const stub = () =>
  vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
    const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
    stmts.push(stmt);
    return /LIMIT 0/.test(stmt) ? kbody({ column_headers: ["vendor", "fare"], column_1: [], column_2: [] }) : kbody({});
  }));

const filt = [{ column: "vendor", value: "CMT", dataType: "string", addedAt: 1 }];

async function setup() {
  stmts = [];
  stub();
  const agent = await buildTestApp();
  const dash = createDashboard("AI drill", "");
  const { sid, cookie } = createAdminSession();
  const username = process.env.APP_ADMIN_USERNAME || "admin";
  const aiName = buildAiDynamicViewName({ username, sid, nonce: NONCE, tempId: -3, gen: 0 });
  const seed = (over: Partial<{ sid: string; dashboardId: number; viewName: string }> = {}) =>
    registerAiSessionView({ viewName: over.viewName ?? aiName, sid: over.sid ?? sid, username, dashboardId: over.dashboardId ?? dash.id, nonce: NONCE, tempId: -3, gen: 0 });
  return { agent, dash: dash.id, sid, cookie, username, aiName, seed };
}

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM ai_session_views");
  db.exec("DELETE FROM dashboards");
});
afterEach(() => vi.unstubAllGlobals());

describe("POST/DELETE /api/filter/materialize on an AI view (139 D-23)", () => {
  it("DRILLDV-1: filters the AI view like a saved dv; returns a _dvn filter-view name", async () => {
    const c = await setup();
    c.seed();
    const res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
      .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce: NONCE, aiGen: 0, filters: filt, combinationKey: "k" });
    expect(res.status).toBe(200);
    expect(stmts.some((s) => s === `SELECT * FROM ${c.aiName} LIMIT 0`)).toBe(true);
    const create = stmts.find((s) => /CREATE OR REPLACE MATERIALIZED VIEW/.test(s))!;
    expect(create).toContain(`_kbi_filt_u${c.username}_d${c.dash}_dvn3_s${c.sid.slice(0, 8)}_c`);
    expect(create).toContain(`SELECT * FROM ${c.aiName} WHERE vendor = 'CMT'`);
    expect(res.body.viewName).toMatch(new RegExp(`^_kbi_filt_u${c.username}_d${c.dash}_dvn3_s\\w{8}_c\\w{8}$`));
    expect(typeof res.body.expiresAt).toBe("number");
  });

  it("DRILLDV-2: no registry row, or a row for another dashboard -> 404, no CREATE", async () => {
    const c = await setup();
    let res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
      .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce: NONCE, aiGen: 0, filters: filt });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dynamic view not found.");
    const other = createDashboard("other", "");
    c.seed({ dashboardId: other.id });
    res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
      .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce: NONCE, aiGen: 0, filters: filt });
    expect(res.status).toBe(404);
    expect(stmts.some((s) => /CREATE OR REPLACE/.test(s))).toBe(false);
  });

  it("DRILLDV-3: missing/invalid aiNonce for a negative id -> 400", async () => {
    const c = await setup();
    c.seed();
    for (const aiNonce of [undefined, "nothex!!", "abc"]) {
      const res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
        .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce, filters: filt });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("aiNonce is required for an AI dynamic view.");
    }
  });

  it("DRILLDV-4: a filter column absent from the AI view -> column-guard 400 naming the AI view", async () => {
    const c = await setup();
    c.seed();
    const res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
      .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce: NONCE, aiGen: 0, filters: [{ column: "nope", value: "x", dataType: "string", addedAt: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(res.body.table).toBe('dynamic view "AI view -3"');
    expect(stmts.some((s) => /CREATE OR REPLACE/.test(s))).toBe(false);
  });

  it("DRILLDV-5: a row belonging to ANOTHER sid of the same user is never used -> 404", async () => {
    const c = await setup();
    const other = createAdminSession();
    registerAiSessionView({
      viewName: buildAiDynamicViewName({ username: c.username, sid: other.sid, nonce: NONCE, tempId: -3, gen: 0 }),
      sid: other.sid, username: c.username, dashboardId: c.dash, nonce: NONCE, tempId: -3, gen: 0,
    });
    const res = await c.agent.post("/api/filter/materialize").set("Cookie", c.cookie)
      .send({ dashboardId: c.dash, dynamicViewId: -3, aiNonce: NONCE, aiGen: 0, filters: filt });
    expect(res.status).toBe(404);
  });

  it("DRILLDV-6: DELETE with a negative dynamicViewId drops the _dvn filter view (no hyphen)", async () => {
    const c = await setup();
    const res = await c.agent.delete(`/api/filter/materialize?dashboardId=${c.dash}&dynamicViewId=-3`).set("Cookie", c.cookie);
    expect(res.status).toBe(200);
    const drop = stmts.find((s) => /DROP TABLE IF EXISTS/.test(s))!;
    expect(drop).toBe(`DROP TABLE IF EXISTS _kbi_filt_u${c.username}_d${c.dash}_dvn3_s${c.sid.slice(0, 8)}`);
  });
});
