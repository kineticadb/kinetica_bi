// 146-02: browser logout spares a Claude Desktop build (generated_source 'mcp'); in-app generated dashboards still go.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/index";
import { db, createTable } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, resetAiTables, mockKinetica } from "./helpers/aiRouteKit";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";
import { createGeneratedDashboard, discardGeneratedDashboard } from "../src/lib/aiGenerate";

let restoreEnv: (() => void) | null = null;
let savedMcp: string | undefined;

async function boot(): Promise<Express> {
  restoreEnv = enableAiEnv();
  savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
  return createApp();
}
const dee = () => sessionFor("dee", ["designer"]).cookie;

beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets; DELETE FROM mcp_tokens; DELETE FROM mcp_token_sessions;");
  __clearLiveSchemaCacheForTest();
  __resetMcpSessionsForTest();
  forbidProviderNetwork(mockKinetica({ probes: { "fleet.trips": ["zone", "fare"] } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv?.();
  restoreEnv = null;
  if (savedMcp === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedMcp;
});

async function startSession(app: Express, cookie: string, over: Record<string, unknown> = {}) {
  const t = createTable({ name: "trips", schema: "fleet", columns: {} });
  const res = await request(app).post("/api/mcp/sessions").set("Cookie", cookie).send({ name: "Trips", tableIds: [t.id], ...over });
  return { dashboardId: res.body.dashboardId as number, tableId: t.id, res, sessionId: res.body.sessionId as string };
}
const sourceOf = (id: number) => (db.prepare("SELECT generated_source AS s FROM dashboards WHERE id = ?").get(id) as { s: string | null }).s;

describe("browser logout vs Claude Desktop builds", () => {
  it("MCPLO-1 a Claude Desktop build is marked as one; an in-app generated dashboard is not", async () => {
    const app = await boot();
    const { dashboardId, tableId } = await startSession(app, dee());
    expect(sourceOf(dashboardId)).toBe("mcp");
    await discardGeneratedDashboard(dashboardId);
    const g = createGeneratedDashboard({ username: "dee", name: "Gen", tableId });
    expect(sourceOf(g.id)).toBeNull();
    const cols = (db.prepare("PRAGMA table_info(dashboards)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("generated_source");
  });
});
