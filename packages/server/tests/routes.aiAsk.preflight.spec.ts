// Phase 135-10 Task 2: pre-stream refusals of POST /api/ai/ask (PRE-). All JSON, before any stream starts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import type { LlmEvent, LlmProvider } from "../src/lib/ai/provider";
import { forbidProviderNetwork, CANARY_ROW_VALUE_9f3, KEY_SENTINEL } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables, mockKinetica, validAsk } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];

const buildApp = async (env: Record<string, string> | null = {}) => {
  restoreEnv = env === null ? null : enableAiEnv(env);
  return createApp();
};

beforeEach(() => {
  resetAiTables();
  forbidProviderNetwork(mockKinetica(), { allowHosts: ["provider.test"] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const insertAudit = (username: string, tsMs: number, counted = 1) =>
  db
    .prepare("INSERT INTO ai_audit (ts_ms, username, dashboard_id, question, status, outcome, counted) VALUES (?, ?, 1, 'q', 'final', 'ok', ?)")
    .run(tsMs, username, counted);

describe("POST /api/ai/ask pre-stream refusals", () => {
  it("PRE-1 analyst without ai:use gets 403 PERMISSION_DENIED", async () => {
    const app = await buildApp();
    const dash = makeDashboard();
    const { cookie } = sessionFor("ann");
    const res = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
  });

  it("PRE-2 designer passes the permission stage (AI disabled -> 503 AI_NOT_CONFIGURED)", async () => {
    const app = await buildApp(null);
    const dash = makeDashboard();
    const { cookie } = sessionFor("dee", ["designer"]);
    const res = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("PRE-3 an analyst granted ai:use via a custom role passes the permission stage", async () => {
    const app = await buildApp();
    const role = makeRole("ai-analysts", ["dashboards:view", "ai:use"]);
    const dash = makeDashboard([role]);
    const { cookie } = sessionFor("ann", [role]);
    const res = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id, { question: "" }));
    expect(res.status).toBe(400); // a later stage than the 403
    expect(res.body.code).toBe("AI_BAD_REQUEST");
  });

  it("PRE-4 oversize body -> 413; invalid body -> 400 without echoing values", async () => {
    const app = await buildApp();
    const dash = makeDashboard();
    const { cookie } = sessionFor("dee", ["designer"]);
    const big = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id, { pad: "x".repeat(70_000) }));
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("AI_REQUEST_TOO_LARGE");

    const payload = validAsk(dash.id, { question: "", dashboardId: CANARY_ROW_VALUE_9f3, extra: CANARY_ROW_VALUE_9f3 });
    expect(JSON.stringify(payload)).toContain(CANARY_ROW_VALUE_9f3); // positive control
    const bad = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(payload);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("AI_BAD_REQUEST");
    expect(Array.isArray(bad.body.issues)).toBe(true);
    expect(bad.body.issues.length).toBeGreaterThan(0);
    for (const i of bad.body.issues) expect(Object.keys(i).sort()).toEqual(["message", "path"]);
    expect(bad.text).not.toContain(CANARY_ROW_VALUE_9f3);
  });

  it("PRE-5 missing dashboard and not-viewable dashboard give an identical 404", async () => {
    const app = await buildApp();
    const role = makeRole("ai-analysts", ["dashboards:view", "ai:use"]);
    const hidden = makeDashboard(); // no grant for ann
    const { cookie } = sessionFor("ann", [role]);
    const missing = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(99999));
    const denied = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(hidden.id));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Dashboard not found." });
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual(missing.body);
  });

  it("PRE-6 a second ask from the same user while one is running -> 409 AI_BUSY; another user is not refused", async () => {
    const app = await buildApp();
    const dash = makeDashboard();
    // A provider that never finishes until its request is aborted.
    const hanging: LlmProvider = {
      id: "hang", model: "m",
      capabilities: { nativeTools: true, parallelTools: true, streaming: true, usageInStream: true, forcedToolChoice: false, opaqueReplay: false },
      async *complete(_req, signal): AsyncGenerator<LlmEvent> {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield { type: "error", kind: "aborted" };
      },
    };
    __setAiProviderFactoryForTest(() => hanging);
    const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { cookie } = sessionFor("dee", ["designer"]);
    const other = sessionFor("eve", ["designer"]);
    const post = (c: string, signal?: AbortSignal) =>
      realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify(validAsk(dash.id)), signal });

    const ctlA = new AbortController();
    const a = await post(cookie, ctlA.signal);
    expect(a.status).toBe(200);
    const b = await post(cookie);
    expect(b.status).toBe(409);
    expect((await b.json()).code).toBe("AI_BUSY");
    const ctlC = new AbortController();
    const c = await post(other.cookie, ctlC.signal);
    expect(c.status).toBe(200); // not 409
    ctlA.abort();
    ctlC.abort();
  });

  it("PRE-7 per-user hourly cap -> 429 with exact message and Retry-After; no stream", async () => {
    const app = await buildApp();
    const dash = makeDashboard();
    const { cookie } = sessionFor("dee", ["designer"]);
    const now = Date.now();
    insertAudit("dee", now - 48 * 60_000);
    for (let i = 1; i < 30; i++) insertAudit("dee", now - (47 - i) * 60_000 + 1000);
    const res = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id));
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("720");
    expect(res.headers["content-type"]).toContain("json");
    expect(res.body).toEqual({
      code: "AI_USER_CAP",
      message: "You've used 30 AI answers this hour. Try again in 12 minutes.",
      retryAfterSeconds: 720,
    });
    const refused = db.prepare("SELECT outcome, status, counted FROM ai_audit WHERE counted = 0").all();
    expect(refused).toEqual([{ outcome: "capped", status: "final", counted: 0 }]);
    expect(db.prepare("SELECT COUNT(*) c FROM ai_audit WHERE status = 'running'").get()).toEqual({ c: 0 });
  });

  it("PRE-7b deployment daily cap -> 429 AI_DAY_CAP with the exact message", async () => {
    const app = await buildApp({ AI_MAX_ANSWERS_PER_DAY: "1" });
    const dash = makeDashboard();
    const { cookie } = sessionFor("dee", ["designer"]);
    insertAudit("someone-else", Date.now() - 60_000);
    const res = await request(app).post("/api/ai/ask").set("Cookie", cookie).send(validAsk(dash.id));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AI_DAY_CAP");
    expect(res.body.message).toBe("The AI's daily limit for this deployment has been reached.");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("PRE-8 GET /api/ai/config returns the public shape and never the key or endpoint", async () => {
    const app = await buildApp();
    expect(process.env.AI_API_KEY).toBe(KEY_SENTINEL); // positive control: the secret IS in the process
    const { cookie } = sessionFor("ann");
    const res = await request(app).get("/api/ai/config").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      provider: "openai-compatible",
      model: "test-model",
      dataAccess: "schema",
      toolMode: "native",
      limits: { maxToolSteps: 8, answersPerUserPerHour: 30, answersPerDay: 0 },
    });
    expect(res.text).not.toContain(KEY_SENTINEL);
    expect(res.text).not.toContain("provider.test");
    const anon = await request(app).get("/api/ai/config");
    expect(anon.status).toBe(401);
  });
});
