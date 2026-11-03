// Phase 139 (AISAFE-V20-06, D-14/D-16): registry of live AI session dynamic views + the two cleanup primitives
// (logout drop, boot sweep). Stores names/ids only. Anything that cannot be dropped here (expired/deleted session,
// expired OIDC token, crash before the registry write) is left to the Kinetica TTL and logged, never hidden.
import type Database from "better-sqlite3";
import { db } from "../db";
import { kineticaSql, type KineticaPrincipal } from "../kinetica";
import { principalForSession, SessionEndedError } from "./exportRunner";
import { KineticaAuthError } from "../kineticaErrors";
import { parseAiDynamicViewName } from "./aiDvName";

export type AiSessionViewRow = { viewName: string; sid: string; username: string; dashboardId: number; nonce: string; tempId: number; gen: number };

type DbRow = { view_name: string; sid: string; username: string; dashboard_id: number; nonce: string; temp_id: number; gen: number };
const toRow = (r: DbRow): AiSessionViewRow => ({
  viewName: r.view_name, sid: r.sid, username: r.username, dashboardId: r.dashboard_id, nonce: r.nonce, tempId: r.temp_id, gen: r.gen,
});

export function registerAiSessionView(r: AiSessionViewRow, conn: Database.Database = db): void {
  conn
    .prepare("INSERT OR REPLACE INTO ai_session_views (view_name, sid, username, dashboard_id, nonce, temp_id, gen) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(r.viewName, r.sid, r.username, r.dashboardId, r.nonce, r.tempId, r.gen);
}

export function getAiSessionView(viewName: string, conn: Database.Database = db): AiSessionViewRow | undefined {
  const r = conn.prepare("SELECT * FROM ai_session_views WHERE view_name = ?").get(viewName) as DbRow | undefined;
  return r ? toRow(r) : undefined;
}

export function deleteAiSessionView(viewName: string, conn: Database.Database = db): boolean {
  return conn.prepare("DELETE FROM ai_session_views WHERE view_name = ?").run(viewName).changes > 0;
}

export function listAiSessionViewsForSid(sid: string, conn: Database.Database = db): AiSessionViewRow[] {
  return (conn.prepare("SELECT * FROM ai_session_views WHERE sid = ? ORDER BY created_at, view_name").all(sid) as DbRow[]).map(toRow);
}

/** Per-session cap count. `exclude` omits every generation of one view (a re-materialization does not count against itself). */
export function countAiSessionViews(sid: string, exclude?: { nonce: string; tempId: number }, conn: Database.Database = db): number {
  const r = exclude
    ? conn.prepare("SELECT COUNT(*) AS c FROM ai_session_views WHERE sid = ? AND NOT (nonce = ? AND temp_id = ?)").get(sid, exclude.nonce, exclude.tempId)
    : conn.prepare("SELECT COUNT(*) AS c FROM ai_session_views WHERE sid = ?").get(sid);
  return (r as { c: number }).c;
}

export function findAiSessionView(
  k: { sid: string; dashboardId: number; nonce: string; tempId: number; gen: number },
  conn: Database.Database = db,
): AiSessionViewRow | undefined {
  const r = conn
    .prepare("SELECT * FROM ai_session_views WHERE sid = ? AND dashboard_id = ? AND nonce = ? AND temp_id = ? AND gen = ?")
    .get(k.sid, k.dashboardId, k.nonce, k.tempId, k.gen) as DbRow | undefined;
  return r ? toRow(r) : undefined;
}

export type DropDeps = { sql?: typeof kineticaSql; principalFor?: (sid: string) => KineticaPrincipal; conn?: Database.Database; timeoutMs?: number };
type Tally = { dropped: number; ttlOnly: number; failed: number };

/** Drop every row of one sid (as that session's user), then delete the rows. Mutates `t` as drops settle. */
async function dropSid(sid: string, deps: DropDeps, t: Tally, dashboardId?: number): Promise<void> {
  const conn = deps.conn ?? db;
  const sql = deps.sql ?? kineticaSql;
  const principalFor = deps.principalFor ?? principalForSession;
  const rows = listAiSessionViewsForSid(sid, conn).filter((r) => dashboardId === undefined || r.dashboardId === dashboardId);
  if (rows.length === 0) return;
  let principal: KineticaPrincipal | null = null;
  let principalErr: "ttl" | "fail" | null = null;
  const valid = rows.filter((r) => parseAiDynamicViewName(r.viewName) !== null);
  t.failed += rows.length - valid.length; // never issue DDL for a name that is not a well-formed AI view
  if (valid.length > 0) {
    try {
      principal = principalFor(sid);
    } catch (e) {
      principalErr = e instanceof SessionEndedError ? "ttl" : "fail";
    }
  }
  if (principalErr === "ttl") t.ttlOnly += valid.length;
  else if (principalErr === "fail") t.failed += valid.length;
  else if (principal) {
    const p = principal;
    await Promise.all(
      valid.map(async (r) => {
        try {
          await sql(p, `DROP TABLE IF EXISTS ${r.viewName}`, { route: "AI session cleanup", op: "DYNAMIC_DROP" });
          t.dropped++;
        } catch (e) {
          if (e instanceof KineticaAuthError) t.ttlOnly++;
          else t.failed++;
        }
      }),
    );
  }
  for (const r of rows) deleteAiSessionView(r.viewName, conn);
}

async function bounded(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([work.catch(() => {}), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Logout: DROP each registered view as the session's user, then delete the rows. Never throws; bounded by timeoutMs (default 3000). */
export async function dropViewsForSid(sid: string, deps: DropDeps = {}): Promise<{ dropped: number; failed: number }> {
  const conn = deps.conn ?? db;
  const t: Tally = { dropped: 0, ttlOnly: 0, failed: 0 };
  let total = 0;
  try {
    total = listAiSessionViewsForSid(sid, conn).length;
    await bounded(dropSid(sid, deps, t), deps.timeoutMs ?? 3000);
    // Anything unsettled at the deadline, and anything left to TTL, counts as failed here.
    const settled = t.dropped + t.ttlOnly + t.failed;
    const pending = Math.max(0, total - settled);
    try {
      for (const r of listAiSessionViewsForSid(sid, conn)) deleteAiSessionView(r.viewName, conn);
    } catch { /* never throws */ }
    return { dropped: t.dropped, failed: t.failed + t.ttlOnly + pending };
  } catch {
    return { dropped: t.dropped, failed: Math.max(0, total - t.dropped) };
  }
}

/** 142 (AIGEN-V20-02): drop every AI session view of ONE dashboard (any session), as each session's user; then delete the rows.
 *  Ended sessions fall back to the Kinetica TTL (counted as failed). Never throws; bounded by timeoutMs (default 3000). */
export async function dropViewsForDashboard(dashboardId: number, deps: DropDeps = {}): Promise<{ dropped: number; failed: number }> {
  const conn = deps.conn ?? db;
  const t: Tally = { dropped: 0, ttlOnly: 0, failed: 0 };
  let total = 0;
  try {
    total = (conn.prepare("SELECT COUNT(*) AS c FROM ai_session_views WHERE dashboard_id = ?").get(dashboardId) as { c: number }).c;
    const sids = (conn.prepare("SELECT DISTINCT sid FROM ai_session_views WHERE dashboard_id = ?").all(dashboardId) as { sid: string }[]).map((r) => r.sid);
    await bounded(Promise.all(sids.map((sid) => dropSid(sid, deps, t, dashboardId))).then(() => {}), deps.timeoutMs ?? 3000);
    const settled = t.dropped + t.ttlOnly + t.failed;
    try {
      conn.prepare("DELETE FROM ai_session_views WHERE dashboard_id = ?").run(dashboardId);
    } catch { /* never throws */ }
    return { dropped: t.dropped, failed: t.failed + t.ttlOnly + Math.max(0, total - settled) };
  } catch {
    return { dropped: t.dropped, failed: Math.max(0, total - t.dropped) };
  }
}

/** Boot (before listen): sweep every registered view. Views whose session cannot be rebuilt (expired/deleted session, expired OIDC
 *  token) or that were never registered (crash before the row was written) are left to the Kinetica TTL (DEFAULT_VIEW_TTL_MINUTES).
 *  That gap is deliberate and logged (139 D-16). Never throws; bounded by timeoutMs (default 10000). */
export async function sweepAiViewsOnBoot(deps: DropDeps = {}): Promise<{ dropped: number; ttlOnly: number; failed: number }> {
  const conn = deps.conn ?? db;
  const t: Tally = { dropped: 0, ttlOnly: 0, failed: 0 };
  try {
    const sids = (conn.prepare("SELECT DISTINCT sid FROM ai_session_views").all() as { sid: string }[]).map((r) => r.sid);
    await bounded(Promise.all(sids.map((sid) => dropSid(sid, deps, t))).then(() => {}), deps.timeoutMs ?? 10000);
    try {
      conn.prepare("DELETE FROM ai_session_views").run();
    } catch { /* never throws */ }
  } catch { /* never throws */ }
  console.log(`[ai] boot sweep: dropped ${t.dropped} AI session views; ${t.ttlOnly} left to TTL (session ended or token expired); ${t.failed} failed`);
  return { ...t };
}
