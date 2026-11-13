// 152-01 (VIEWAI-V22-01): resolveViewerAi says "restricted" exactly when the caller could not Keep (aiKeepRoutes rule).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables, mockKinetica } from "./helpers/aiRouteKit";
import { createGeneratedDashboard } from "../src/lib/aiGenerate";
import { resolveViewerAi } from "../src/lib/viewerAi";

let app: Express;
let T: number;
let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;
let viewerRole: string;
let creatorRole: string;
let cookies: Record<string, string>;

const setMode = (id: number, mode: string | null) => db.prepare("UPDATE dashboards SET viewer_ai = ? WHERE id = ?").run(mode, id);
const gen = (username: string) => createGeneratedDashboard({ username, name: "Gen", tableIds: [T], assistant: true }).id;

beforeEach(async () => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM ai_session_views");
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
  app = await createApp();
  T = createTable({ schema: "fleet", name: "trips", columns: {} }).id;
  viewerRole = makeRole("vai_viewer", ["dashboards:view", "ai:use"]);
  creatorRole = makeRole("vai_creator", ["dashboards:view", "dashboards:create", "ai:use"]);
  cookies = {
    sam: sessionFor("sam", ["designer"]).cookie,
    vic: sessionFor("vic", [viewerRole]).cookie,
    cora: sessionFor("cora", [creatorRole]).cookie,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
  if (savedMcp === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedMcp;
});

describe("resolveViewerAi (152)", () => {
  it("VAIRES-1: a designer is never restricted, in every mode, and mode is the stored value", () => {
    const D = makeDashboard([]).id;
    for (const mode of ["off", "answers_filters", "session_only"]) {
      setMode(D, mode);
      expect(resolveViewerAi("sam", D)).toEqual({ mode, restricted: false });
    }
  });

  it("VAIRES-2: a view + ai:use role is restricted; NULL reads session_only, off reads off", () => {
    const D = makeDashboard([viewerRole]).id;
    setMode(D, null);
    expect(resolveViewerAi("vic", D)).toEqual({ mode: "session_only", restricted: true });
    setMode(D, "off");
    expect(resolveViewerAi("vic", D)).toEqual({ mode: "off", restricted: true });
  });

  it("VAIRES-3: a create-only role is unrestricted on its own unkept build, restricted on an ordinary dashboard", () => {
    const own = gen("cora");
    const ordinary = makeDashboard([creatorRole]).id;
    expect(resolveViewerAi("cora", own).restricted).toBe(false);
    expect(resolveViewerAi("cora", ordinary).restricted).toBe(true);
  });

  it("VAIRES-4: restricted agrees with Keep (no 403 from ai-keep exactly when not restricted)", async () => {
    const ordinary = makeDashboard([viewerRole, creatorRole]).id;
    const own = gen("cora");
    const cases: Array<[string, number]> = [["sam", ordinary], ["vic", ordinary], ["cora", own], ["cora", ordinary]];
    const seen = new Set<boolean>();
    for (const [user, id] of cases) {
      const res = await request(app).post(`/api/dashboards/${id}/ai-keep`).set("Cookie", cookies[user]).send({});
      const keepAllowed = res.status !== 403;
      expect(!resolveViewerAi(user, id).restricted, `${user} on ${id}`).toBe(keepAllowed);
      seen.add(keepAllowed);
    }
    expect(seen.size).toBe(2); // both outcomes were exercised
  });

  it("VAIRES-5: an unknown dashboard id resolves to session_only without throwing", () => {
    expect(resolveViewerAi("vic", 987654).mode).toBe("session_only");
  });
});
