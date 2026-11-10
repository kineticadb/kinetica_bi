// Phase 150 (APPROVE-V22-02/03): held AI proposals (memory only: ops can carry filter values, ai_audit never stores values) and the one-shot decision on the audit row.
import type Database from "better-sqlite3";
import type { AiOp } from "@kinetica-bi/shared";
import { db } from "../db";

export const AI_PROPOSAL_TTL_MS = 60 * 60_000;
export const AI_PROPOSAL_MAX_PER_USER = 20;
export const PROPOSE_SYSTEM_PART =
  "The user approves dashboard changes before they happen. Every change you make in this answer is only a proposal that the user will apply or reject, so describe it as proposed (for example \"I'd add ...\" or \"I've prepared ...\"), never as already done.";

export type HeldProposal = {
  auditId: number;
  username: string;
  dashboardId: number;
  ops: AiOp[];
  labels: string[];
  approvals?: { removeSaved?: boolean };
  createdMs: number;
};

const held = new Map<number, HeldProposal>();

function purgeExpired(now: number): void {
  for (const [id, p] of held) if (now - p.createdMs > AI_PROPOSAL_TTL_MS) held.delete(id);
}

export function registerProposal(p: { auditId: number; username: string; dashboardId: number; ops: AiOp[]; labels: string[]; approvals?: { removeSaved?: boolean }; now: number }): void {
  purgeExpired(p.now);
  const username = p.username.toLowerCase();
  held.set(p.auditId, { auditId: p.auditId, username, dashboardId: p.dashboardId, ops: p.ops, labels: p.labels, approvals: p.approvals, createdMs: p.now });
  const mine = [...held.values()].filter((h) => h.username === username).sort((a, b) => a.createdMs - b.createdMs || a.auditId - b.auditId);
  for (const h of mine.slice(0, Math.max(0, mine.length - AI_PROPOSAL_MAX_PER_USER))) held.delete(h.auditId);
}

export function getProposal(auditId: number, username: string, now: number = Date.now()): HeldProposal | undefined {
  const p = held.get(auditId);
  if (!p) return undefined;
  if (now - p.createdMs > AI_PROPOSAL_TTL_MS) {
    held.delete(auditId);
    return undefined;
  }
  return p.username === username.toLowerCase() ? p : undefined;
}

export function dropProposal(auditId: number): void {
  held.delete(auditId);
}

export function __resetProposalsForTest(): void {
  held.clear();
}

/** Removes the keys the gateway stamps, so a stored op re-enters the gateway exactly as the model produced it. Never mutates. */
export function stripStamped(op: AiOp): AiOp {
  const c = structuredClone(op) as Record<string, unknown>;
  if (c.op === "add_widget") delete c.layout;
  else if (c.op === "add_dynamic_view") {
    delete c.columns;
    delete c.maxRecords;
    delete c.aggregated;
  } else if (c.op === "remove_dynamic_view") {
    delete c.repoint;
    delete c.drop;
  }
  return c as AiOp;
}

export type ProposalDecision = {
  auditId: number;
  username: string;
  outcome: "applied" | "partly_applied" | "rejected";
  applied: string[];
  failed: { label: string; stage: string; reasons: string[] }[];
  unticked: string[];
};

const GUARD = "id=@id AND lower(username)=lower(@u) AND status='final' AND outcome='not_decided' AND outcome_detail='proposed'";

export function decideAiProposal(d: ProposalDecision, conn: Database.Database = db): boolean {
  const run = conn.transaction((): boolean => {
    const row = conn.prepare(`SELECT changes_json FROM ai_audit WHERE ${GUARD}`).get({ id: d.auditId, u: d.username }) as { changes_json: string | null } | undefined;
    if (!row) return false;
    let prev: { rejected?: unknown[]; proposed?: string[] } = {};
    try { prev = JSON.parse(row.changes_json ?? "{}") ?? {}; } catch { /* keep empty */ }
    const merged = {
      applied: d.applied,
      rejected: [...(Array.isArray(prev.rejected) ? prev.rejected : []), ...d.failed.map((f) => ({ label: f.label, stage: "recheck", reasons: f.reasons }))],
      unticked: d.unticked,
      proposed: Array.isArray(prev.proposed) ? prev.proposed : [],
    };
    const info = conn
      .prepare(`UPDATE ai_audit SET outcome=@o, outcome_detail=NULL, changes_json=@c WHERE ${GUARD}`)
      .run({ id: d.auditId, u: d.username, o: d.outcome, c: JSON.stringify(merged) });
    return info.changes === 1;
  });
  const ok = run();
  // OBS-01 metadata only: never labels or values.
  if (ok) console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "ai_proposal_decided", username: d.username.toLowerCase(), outcome: d.outcome }));
  return ok;
}

export function proposalRowState(auditId: number, username: string, conn: Database.Database = db): "pending" | "decided" | "not_found" {
  const row = conn.prepare("SELECT outcome, outcome_detail, status FROM ai_audit WHERE id=? AND lower(username)=lower(?)").get(auditId, username) as
    | { outcome: string | null; outcome_detail: string | null; status: string }
    | undefined;
  if (!row || row.status !== "final") return "not_found";
  return row.outcome === "not_decided" && row.outcome_detail === "proposed" ? "pending" : "decided";
}
