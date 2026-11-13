// Phase 152 (VIEWAI-V22-04): the AI view materialize route is closed to restricted users outside Session only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable, addDashboardTable } from "../src/db";
import { buildAiDynamicViewName } from "../src/lib/aiDvName";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";

const NONCE = "0a1b2c3d";
let calls: string[] = [];
let restoreEnv: (() => void) | null = null;
let app: Express;
let dash = 0;
let trips = 0;
let vic: { cookie: string; sid: string };
let dee: { cookie: string; sid: string };

const kfetch = ((url: RequestInfo | URL, init?: RequestInit) => {
  calls.push(`${new URL(String(url)).pathname} ${String(JSON.parse(String(init?.body ?? "{}")).statement ?? "")}`);
  const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
  const cols = /LIMIT 0/.test(stmt)
    ? { column_headers: ["vendor", "fare"], column_1: [], column_2: [] }
    : { column_1: [50] };
  return Promise.resolve(new Response(JSON.stringify({ status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(cols) }) }), { status: 200 }));
}) as typeof fetch;

beforeEach(async () => {
  resetAiTables();
  db.exec("DELETE FROM ai_session_views");
  __clearLiveSchemaCacheForTest();
  calls = [];
  process.env.DEFAULT_VIEW_TTL_MINUTES ??= "5";
  forbidProviderNetwork(kfetch);
  restoreEnv = enableAiEnv();
  app = await createApp();
  const role = makeRole("ai-dv-vic", ["dashboards:view", "ai:use"]);
  dash = makeDashboard([role]).id;
  trips = createTable({ name: "trips", schema: "fleet", columns: { vendor: "string", fare: "double" } }).id;
  addDashboardTable(dash, trips);
  vic = sessionFor("vic", [role]);
  dee = sessionFor("dee", ["designer"]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv?.();
  restoreEnv = null;
});

const setMode = (m: string | null) => db.prepare("UPDATE dashboards SET viewer_ai=? WHERE id=?").run(m, dash);
const mat = (who: { cookie: string }) =>
  request(app).post("/api/ai/dynamic-view/materialize").set("Cookie", who.cookie).send({ dashboardId: dash, nonce: NONCE, tempId: -3, gen: 0, spec: { baseTableId: trips, columns: [{ column: "vendor" }, { column: "fare" }] } });

describe("Viewer AI on AI view materialize (152)", () => {
  it("VAIDV-1: off -> 423 AI_VIEWER_OFF and no Kinetica call", async () => {
    setMode("off");
    const r = await mat(vic);
    expect(r.status).toBe(423);
    expect(r.body).toMatchObject({ code: "AI_VIEWER_OFF", mode: "off" });
    expect(calls).toEqual([]);
    expect(buildAiDynamicViewName({ username: "vic", sid: vic.sid, nonce: NONCE, tempId: -3, gen: 0 })).toBeTruthy();
  });

  it("VAIDV-2: answers_filters -> 423 AI_VIEWER_RESTRICTED", async () => {
    setMode("answers_filters");
    const r = await mat(vic);
    expect(r.status).toBe(423);
    expect(r.body).toMatchObject({ code: "AI_VIEWER_RESTRICTED", mode: "answers_filters", error: "Viewer AI: answers and filters only" });
    expect(calls).toEqual([]);
  });

  it("VAIDV-3: Session only for the viewer and off for the designer are not refused", async () => {
    setMode(null);
    expect((await mat(vic)).status).not.toBe(423);
    setMode("off");
    expect((await mat(dee)).status).not.toBe(423);
  });
});
