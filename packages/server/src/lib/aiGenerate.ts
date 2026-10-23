// Phase 142 (AIGEN-V20-01/02): generated-dashboard lifecycle. ONE create path (a single SQLite transaction, one pending
// dashboard per user, race-proof via uq_dashboards_one_pending) and ONE discard helper shared by Discard, DELETE, logout,
// the boot sweep and the TTL sweep. ai_audit rows are kept on purpose (D-21): the audit trail outlives the dashboard.
import { GENERATE_AI_RECT } from "@kinetica-bi/shared";
import { db, getDashboard, deleteDashboard, createWidget, getGeneratedPending } from "../db";
import type { Dashboard, Widget } from "../types";
import { dropViewsForDashboard, type DropDeps } from "./aiSessionViews";

export const AI_ASSISTANT_TITLE = "AI Assistant";

export class GeneratePendingError extends Error {
  constructor(readonly existing: { id: number; name: string }) {
    super("a generated dashboard is still unkept");
    this.name = "GeneratePendingError";
  }
}

const norm = (u: string): string => u.trim().toLowerCase();

export function findPendingForUser(username: string): { id: number; name: string } | undefined {
  return db
    .prepare("SELECT id, name FROM dashboards WHERE generated_by = ? AND generated_pending_at IS NOT NULL")
    .get(norm(username)) as { id: number; name: string } | undefined;
}

export function createGeneratedDashboard(input: { username: string; name: string; description?: string; tableId: number; now?: number }): Dashboard {
  const u = norm(input.username);
  try {
    return db.transaction((): Dashboard => {
      const existing = findPendingForUser(u);
      if (existing) throw new GeneratePendingError(existing);
      const r = db
        .prepare("INSERT INTO dashboards (name, description, generated_by, generated_pending_at) VALUES (?, ?, ?, ?)")
        .run(input.name, input.description ?? "", u, input.now ?? Date.now());
      const id = Number(r.lastInsertRowid);
      db.prepare("INSERT INTO dashboard_tables (dashboard_id, table_id) VALUES (?, ?)").run(id, input.tableId);
      createWidget(id, { title: AI_ASSISTANT_TITLE, type: "ai" as Widget["type"], position: 0, config: { layout: { ...GENERATE_AI_RECT } } });
      return getDashboard(id)!;
    })();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (typeof err.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT") && /generated_by|uq_dashboards_one_pending/.test(err.message ?? "")) {
      throw new GeneratePendingError(findPendingForUser(u) ?? { id: 0, name: "" });
    }
    throw e;
  }
}

export async function discardGeneratedDashboard(id: number, deps: DropDeps = {}): Promise<{ deleted: boolean; views: { dropped: number; failed: number } }> {
  if (!getGeneratedPending(id)) return { deleted: false, views: { dropped: 0, failed: 0 } };
  const views = await dropViewsForDashboard(id, deps);
  // Re-check inside the transaction: a Keep that commits during the (slow) view drop wins.
  const deleted = db.transaction((): boolean => {
    if (!getGeneratedPending(id)) return false;
    db.prepare("DELETE FROM ai_session_views WHERE dashboard_id = ?").run(id);
    return deleteDashboard(id);
  })();
  console.log(JSON.stringify({ event: "ai_generated_discard", dashboard_id: id, deleted }));
  return { deleted, views };
}

async function discardAll(ids: number[], deps: DropDeps): Promise<number> {
  let n = 0;
  for (const id of ids) {
    try {
      if ((await discardGeneratedDashboard(id, deps)).deleted) n++;
    } catch { /* never throws; the next sweep retries */ }
  }
  return n;
}

const idsOf = (sql: string, ...args: unknown[]): number[] => {
  try {
    return (db.prepare(sql).all(...args) as { id: number }[]).map((r) => r.id);
  } catch {
    return [];
  }
};

export async function discardPendingForUser(username: string, deps: DropDeps = {}): Promise<number> {
  try {
    return await discardAll(idsOf("SELECT id FROM dashboards WHERE generated_pending_at IS NOT NULL AND generated_by = ?", norm(username)), deps);
  } catch {
    return 0;
  }
}

export async function sweepGeneratedOnBoot(deps: DropDeps = {}): Promise<{ deleted: number }> {
  let deleted = 0;
  try {
    deleted = await discardAll(idsOf("SELECT id FROM dashboards WHERE generated_pending_at IS NOT NULL"), deps);
  } catch { /* never throws */ }
  console.log(`[ai] boot sweep: deleted ${deleted} unkept generated dashboards`);
  return { deleted };
}

const DEFAULT_TTL_HOURS = 24;
const warnedTtl = new Set<string>();

export function readAiGeneratedTtlHours(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.AI_GENERATED_TTL_HOURS ?? "").trim();
  if (raw === "") return DEFAULT_TTL_HOURS;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n <= 8760) return n;
  }
  if (!warnedTtl.has(raw)) {
    warnedTtl.add(raw);
    console.warn(`[boot] AI_GENERATED_TTL_HOURS is invalid (expected 0..8760); using default ${DEFAULT_TTL_HOURS}`);
  }
  return DEFAULT_TTL_HOURS;
}

export async function runGeneratedTtlSweepOnce(
  now: number = Date.now(),
  deps: DropDeps = {},
  env: Record<string, string | undefined> = process.env,
): Promise<{ deleted: number }> {
  const hours = readAiGeneratedTtlHours(env);
  if (hours === 0) return { deleted: 0 };
  let deleted = 0;
  try {
    deleted = await discardAll(idsOf("SELECT id FROM dashboards WHERE generated_pending_at IS NOT NULL AND generated_pending_at < ?", now - hours * 3_600_000), deps);
  } catch { /* never throws */ }
  if (deleted > 0) console.log(`[ai] generated sweep: deleted ${deleted} unkept generated dashboards older than ${hours} h`);
  return { deleted };
}

export const AI_GENERATED_SWEEP_INTERVAL_MS = 60 * 60_000;

export function startGeneratedSweep(): NodeJS.Timeout {
  const tick = () => {
    void runGeneratedTtlSweepOnce().catch((err) => console.error("[ai] generated sweep failed", err)); // next tick retries; never clearInterval
  };
  tick();
  const handle = setInterval(tick, AI_GENERATED_SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}
