// Phase 135-10: shared helpers for the POST /api/ai/ask route specs. No real provider, no .env.
import jwt from "jsonwebtoken";
import { db, createDashboard, createTable, addDashboardTable } from "../../src/db";
import { addDashboardGrant } from "../../src/lib/dashboardAccessDb";
import { createSession } from "../../src/sessionStore";
import { parseSseStream } from "../../src/lib/ai/sseParse";
import { FAKE_PROVIDER_BASE_URL, KEY_SENTINEL } from "./aiTestKit";

const AI_ENV_KEYS = [
  "AI_ENABLED", "AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY", "AI_DATA_ACCESS", "AI_MAX_TOOL_STEPS", "AI_TIMEOUT_MS",
  "AI_MAX_ANSWERS_PER_USER_PER_HOUR", "AI_MAX_ANSWERS_PER_DAY", "AI_HISTORY_TURNS", "AI_TOOL_MODE",
  "AI_QUERY_MAX_ROWS", "AI_QUERY_MAX_CHARS", "AI_QUERY_TIMEOUT_MS", "AI_QUERY_MAX_PER_ANSWER",
] as const;

/** Enable AI via env BEFORE createApp() (config is read once at boot). Returns restore(). */
export function enableAiEnv(overrides: Record<string, string> = {}): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of AI_ENV_KEYS) saved[k] = process.env[k];
  const next: Record<string, string> = {
    AI_ENABLED: "true",
    AI_PROVIDER: "openai-compatible",
    AI_BASE_URL: FAKE_PROVIDER_BASE_URL,
    AI_MODEL: "test-model",
    AI_API_KEY: KEY_SENTINEL,
    ...overrides,
  };
  for (const [k, v] of Object.entries(next)) process.env[k] = v;
  return () => {
    for (const k of AI_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

/** A password-mode session for `username`, with the named roles assigned (no roles = analyst fallback). */
export function sessionFor(username: string, roles: string[] = []): { sid: string; cookie: string } {
  for (const r of roles) {
    const row = db.prepare<[string], { id: number }>("SELECT id FROM roles WHERE name = ?").get(r);
    if (!row) throw new Error(`role ${r} not found`);
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, row.id);
  }
  const sid = createSession({ username, secret: "pw", kineticaUrl: process.env.KINETICA_URL! });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
}

/** A role holding exactly `permissions`; returns its name. */
export function makeRole(name: string, permissions: string[]): string {
  const info = db.prepare("INSERT INTO roles (name, description, built_in) VALUES (?, '', 0)").run(name);
  for (const p of permissions) db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)").run(Number(info.lastInsertRowid), p);
  return name;
}

export function makeDashboard(grantRoles: string[] = []): { id: number } {
  const d = createDashboard("AI test dashboard", "");
  for (const r of grantRoles) addDashboardGrant(d.id, "role", r);
  return { id: d.id };
}

/** Registers a table and puts it on the dashboard. */
export function makeTableOn(dashboardId: number, schema = "fleet", name = "trips"): { id: number } {
  const t = createTable({ name, schema, columns: {} });
  addDashboardTable(dashboardId, t.id);
  return { id: t.id };
}

export function resetAiTables(): void {
  for (const t of ["ai_audit", "sessions", "user_roles", "dashboard_access_grants", "dashboard_tables", "tables", "dashboards"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE built_in = 0)");
  db.exec("DELETE FROM roles WHERE built_in = 0");
}

const kbody = (result: unknown) => ({
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }),
});

/** Kinetica fetch delegate: `SELECT * FROM schema.name LIMIT 0` probes answer from `probes`; `failing` answers an HTTP status. */
export function mockKinetica(opts: { probes?: Record<string, string[]>; failing?: Record<string, number> } = {}): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const stmt = String(JSON.parse(String(init?.body ?? "{}")).statement ?? "");
    const m = /FROM\s+([^\s]+)\s+LIMIT 0/i.exec(stmt);
    const key = m?.[1]?.replace(/["`]/g, "");
    if (key && opts.failing?.[key] !== undefined) return new Response("{}", { status: opts.failing[key] });
    if (key && opts.probes?.[key]) {
      const cols = opts.probes[key];
      const result: Record<string, unknown> = { column_headers: cols };
      cols.forEach((_c, i) => (result[`column_${i + 1}`] = []));
      return new Response(JSON.stringify(kbody(result)), { status: 200 });
    }
    return new Response(JSON.stringify(kbody({ column_headers: [] })), { status: 200 });
  }) as typeof fetch;
}

export function validAsk(dashboardId: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dashboardId,
    question: "Show trips by zone",
    snapshot: { widgets: [], layers: [], dynamicViews: [], filters: [] },
    turns: [],
    ...over,
  };
}

export type SseEv = { event: string; data: any };

/** Reads a whole SSE response body (fetch Response) into parsed events. */
export async function readSse(resp: Response): Promise<SseEv[]> {
  const out: SseEv[] = [];
  for await (const ev of parseSseStream(resp.body!)) out.push({ event: ev.event ?? "message", data: JSON.parse(ev.data) });
  return out;
}

import type { Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LlmEvent, LlmProvider } from "../../src/lib/ai/provider";

/** Listen on an ephemeral port; use with a fetch captured BEFORE forbidProviderNetwork stubs the global. */
export async function listenApp(app: Express): Promise<{ base: string; server: Server }> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

export const toolCall = (id: string, name: string, args: unknown): LlmEvent => ({
  type: "tool_call",
  id,
  name,
  argsRaw: typeof args === "string" ? args : JSON.stringify(args),
});
export const TOOLS_DONE: LlmEvent = { type: "done", finish: "tool_calls" };
export const finalText = (text: string, usage?: { inputTokens?: number; outputTokens?: number }): LlmEvent[] => [
  { type: "text_delta", text },
  ...(usage ? [{ type: "usage", ...usage } as LlmEvent] : []),
  { type: "done", finish: "stop" },
];

export const addWidgetArgs = (tableId: number, over: Record<string, unknown> = {}) => ({
  tempId: -1,
  type: "bar",
  title: "Trips by zone",
  tableId,
  metric: "fare",
  aggregation: "sum",
  groupBy: "zone",
  ...over,
});

const CAPS = { nativeTools: true, parallelTools: true, streaming: true, usageInStream: true, forcedToolChoice: false, opaqueReplay: false };
/** A provider driven by an async function (for waits / signal capture). */
export function customProvider(run: (signal: AbortSignal, call: number) => AsyncGenerator<LlmEvent>): LlmProvider & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  let n = 0;
  return {
    id: "custom", model: "m", capabilities: CAPS, signals,
    complete(_req, signal) {
      signals.push(signal);
      return run(signal, n++);
    },
  };
}

export async function pollUntil(cond: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}
