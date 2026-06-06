/**
 * rbacAudit.ts — Phase 50 Plan 01 (AUDIT-V18-01)
 *
 * Provides emitRbacAudit: the single helper that both writes an rbac_audit DB
 * row AND emits an OBS-01 structured JSON log line for every RBAC mutation.
 *
 * Called from all 5 role-mutation handlers in index.ts:
 *   POST   /api/users/:username/roles        → role_assigned
 *   DELETE /api/users/:username/roles/:role  → role_revoked
 *   PUT    /api/roles/:id/permissions        → mappings_updated
 *   POST   /api/roles                        → role_created
 *   DELETE /api/roles/:id                    → role_deleted
 *
 * Mirrors the OBS-01 shape from rbac.ts:51-68 (console.log JSON.stringify).
 */

import type Database from "better-sqlite3";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RbacAuditAction =
  | "role_assigned"
  | "role_revoked"
  | "mappings_updated"
  | "role_created"
  | "role_deleted";

export interface RbacAuditEntry {
  actor: string;
  action: RbacAuditAction;
  target: string;
  before_json: string | null;
  after_json: string | null;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * AUDIT-V18-01: emit BOTH an OBS-01 JSON log line AND an rbac_audit row.
 *
 * Mirrors the rbac.ts:51-68 console.log(JSON.stringify({...})) shape but with
 * level "info" (not "warn") since this is a successful audit record, not a denial.
 *
 * Call ONLY on mutation success — do NOT call when a 4xx guard rejects the request.
 * The before_json must be captured BEFORE the mutation fires (see Task 3 action).
 */
export function emitRbacAudit(db: Database.Database, entry: RbacAuditEntry): void {
  const ts = new Date().toISOString();
  console.log(
    JSON.stringify({ ts, level: "info", event: "rbac_audit", ...entry })
  );
  db.prepare(
    "INSERT INTO rbac_audit (ts, actor, action, target, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(ts, entry.actor, entry.action, entry.target, entry.before_json, entry.after_json);
}
