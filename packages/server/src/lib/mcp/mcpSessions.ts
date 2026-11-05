// MCP connector (143): an MCP client (Claude Desktop) builds a dashboard through the SAME tools and gateway as the in-app
// AI, but the client's model does the thinking. Accepted ops collect here, in memory; the browser takes them once
// (handoff) and applies them as an unsaved AI session (applyAiTurn), so preview, the change bar and Keep are unchanged.
// 145 (MCPSAFE-V21-01/02): baseVersion + the owner's own write edges give the browser a Keep baseline that a foreign save breaks.
import { randomUUID } from "node:crypto";
import type { AiOp, AskRequest } from "@kinetica-bi/shared";
import { createShadow, type ShadowState } from "../ai/shadow";
import type { AiToolAuditEntry } from "../aiAudit";

/** Tool calls kept for the audit row (Phase 143); a runaway client cannot grow a session without bound. */
export const MCP_MAX_AUDITED_CALLS = 200;

export const MCP_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const MCP_MAX_SESSIONS_PER_USER = 3;

export type McpSession = {
  id: string;
  username: string; // lowercased owner
  dashboardId: number;
  /** Phase 143: "new" = an unkept dashboard Claude builds (re-laid out at finish); "edit" = a saved dashboard (AIMCP-V20-08). */
  mode: "new" | "edit";
  /** The saved dashboard as the AI sees it (names and ids, never values); empty for a new build. */
  snapshot: AskRequest["snapshot"];
  shadow: ShadowState;
  ops: AiOp[];
  applied: string[];
  /** Phase 143 (AIMCP-V20-06): every tool call and every rejected change, for the audit row written at finish. */
  tools: AiToolAuditEntry[];
  rejected: { label: string; stage: string; reasons: string[] }[];
  startedAt: number;
  summary?: string;
  finished: boolean;
  touchedAt: number;
  /** 145: dashboard version when the session was created (open_dashboard / new build). */
  baseVersion: number | null;
  /** 145: the owner's own write edges on this dashboard while the session is live (before -> after). */
  ownEdges: Record<number, number>;
};

const sessions = new Map<string, McpSession>();

function sweep(now: number): void {
  for (const [id, s] of sessions) if (now - s.touchedAt > MCP_SESSION_TTL_MS) sessions.delete(id);
}

const EMPTY: AskRequest["snapshot"] = { widgets: [], layers: [], dynamicViews: [], filters: [] };

/** A new session; the oldest of the user's sessions goes past the cap. An edit session starts from the saved dashboard's snapshot. */
export function createMcpSession(
  username: string,
  dashboardId: number,
  opts: { mode?: "new" | "edit"; snapshot?: AskRequest["snapshot"]; baseVersion?: number } = {},
  now = Date.now(),
): McpSession {
  sweep(now);
  const owner = username.toLowerCase();
  const mine = [...sessions.values()].filter((s) => s.username === owner).sort((a, b) => a.touchedAt - b.touchedAt);
  while (mine.length >= MCP_MAX_SESSIONS_PER_USER) sessions.delete(mine.shift()!.id);
  const s: McpSession = {
    id: randomUUID(),
    username: owner,
    dashboardId,
    mode: opts.mode ?? "new",
    snapshot: opts.snapshot ?? EMPTY,
    shadow: createShadow(opts.snapshot ?? EMPTY),
    ops: [],
    applied: [],
    tools: [],
    rejected: [],
    startedAt: now,
    finished: false,
    touchedAt: now,
    baseVersion: opts.baseVersion ?? null,
    ownEdges: {},
  };
  sessions.set(s.id, s);
  return s;
}

/** 145: a stamped write by `username` on the dashboard took it from `before` to `after`; live sessions of that user record the edge. */
export function noteMcpOwnWrite(dashboardId: number, username: string, before: number, after: number): void {
  if (!(after > before)) return;
  const owner = username.toLowerCase();
  for (const s of sessions.values()) {
    if (s.dashboardId === dashboardId && s.username === owner) s.ownEdges[before] = Math.max(s.ownEdges[before] ?? after, after);
  }
}

/** 145: the version at open, advanced only along the owner's own writes (mirrors the browser's dashboardVersionStore.baseline walk). */
export function mcpKeepBaseline(s: McpSession): number | null {
  if (s.baseVersion === null) return null;
  let v = s.baseVersion;
  for (let i = 0; i < 10000; i++) {
    const n = s.ownEdges[v];
    if (n === undefined || n <= v) break;
    v = n;
  }
  return v;
}

/** The caller's live session, or undefined (missing, expired and someone else's all look the same). */
export function getMcpSession(id: string, username: string, now = Date.now()): McpSession | undefined {
  sweep(now);
  const s = sessions.get(id);
  if (!s || s.username !== username.toLowerCase()) return undefined;
  s.touchedAt = now;
  return s;
}

/** The browser takes a finished session's ops exactly once. */
export function takeMcpHandoff(id: string, username: string, dashboardId: number, now = Date.now()): McpSession | undefined {
  const s = getMcpSession(id, username, now);
  if (!s || !s.finished || s.dashboardId !== dashboardId) return undefined;
  sessions.delete(id);
  return s;
}

export function __resetMcpSessionsForTest(): void {
  sessions.clear();
}
