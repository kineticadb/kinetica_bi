// Phase 150 (APPROVE-V22-03): held proposals, stamps, one-shot decision.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";
import { db } from "../src/db";
import {
  registerProposal, getProposal, stripStamped, decideAiProposal, proposalRowState,
  AI_PROPOSAL_TTL_MS, AI_PROPOSAL_MAX_PER_USER, __resetProposalsForTest,
} from "../src/lib/aiProposals";
import { checkAiCandidate, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import type { LiveSchemaPort } from "../src/lib/ai/tools/types";
import { resetAiTables } from "./helpers/aiRouteKit";

beforeEach(() => {
  __resetProposalsForTest();
  resetAiTables();
});

const OPS: AiOp[] = [{ op: "set_widget_title", id: 1, title: "x" }];
const reg = (auditId: number, username: string, now: number) =>
  registerProposal({ auditId, username, dashboardId: 1, ops: OPS, labels: ["l"], now });

describe("proposal store", () => {
  it("APPRSTORE-1: owner-only, lower-cased, expires after the TTL and is purged", () => {
    reg(5, "Dee", 0);
    expect(AI_PROPOSAL_TTL_MS).toBe(3_600_000);
    expect(getProposal(5, "dee", 1000)?.username).toBe("dee");
    expect(getProposal(5, "eve", 1000)).toBeUndefined();
    expect(getProposal(5, "dee", AI_PROPOSAL_TTL_MS + 1)).toBeUndefined();
    expect(getProposal(5, "dee", 1000)).toBeUndefined();
  });

  it("APPRSTORE-2: at most 20 per user, oldest dropped, per user", () => {
    expect(AI_PROPOSAL_MAX_PER_USER).toBe(20);
    reg(100, "eve", 0);
    for (let i = 1; i <= 21; i++) reg(i, "dee", i);
    expect(getProposal(1, "dee", 30)).toBeUndefined();
    for (let i = 2; i <= 21; i++) expect(getProposal(i, "dee", 30)).toBeDefined();
    expect(getProposal(100, "eve", 30)).toBeDefined();
  });
});

describe("stripStamped", () => {
  it("APPRSTORE-3: drops only the gateway-stamped keys and does not mutate", () => {
    const widget = { op: "add_widget", tempId: -1, type: "bar", title: "T", config: { a: 1 }, layout: { x: 0, y: 0, w: 4, h: 3 } } as unknown as AiOp;
    const dv = { op: "add_dynamic_view", tempId: -2, name: "v", spec: { s: 1 }, columns: [{ name: "a" }], maxRecords: 5, aggregated: true } as unknown as AiOp;
    const rm = { op: "remove_dynamic_view", id: 9, repoint: { tableId: 1, widgetIds: [], layerIds: [] }, drop: { widgetIds: [3], layerIds: [] } } as unknown as AiOp;
    const keep = { op: "set_widget_title", id: 1, title: "x" } as AiOp;
    const copies = [widget, dv, rm, keep].map((o) => structuredClone(o));
    expect(stripStamped(widget)).toEqual({ op: "add_widget", tempId: -1, type: "bar", title: "T", config: { a: 1 } });
    expect(stripStamped(dv)).toEqual({ op: "add_dynamic_view", tempId: -2, name: "v", spec: { s: 1 } });
    expect(stripStamped(rm)).toEqual({ op: "remove_dynamic_view", id: 9 });
    expect(stripStamped(keep)).toEqual(keep);
    [widget, dv, rm, keep].forEach((o, i) => expect(o).toEqual(copies[i]));
  });

  it("APPRSTORE-4: a re-check of an already-typed apply_filter is idempotent (no dataType stripping needed)", async () => {
    const live: LiveSchemaPort = {
      describe: vi.fn(async (id: number) => (id === 7 ? { ok: true as const, table: { id: 7, schema: "demo", name: "t", columns: [{ name: "fare", type: "double" }] } } : { ok: false as const })),
    };
    const deps: GatewayDeps = {
      username: "ann", dashboardId: 1, shadow: createShadow({ widgets: [], layers: [], dynamicViews: [], filters: [] }), liveSchema: live,
      getPermissions: () => new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [7],
    };
    const first = await checkAiCandidate(deps, { op: "apply_filter", source: { kind: "table", id: 7 }, filters: [{ column: "fare", operator: "eq", value: 5 }] });
    expect(first.ok).toBe(true);
    if (!first.ok || first.op.op !== "apply_filter") throw new Error("setup");
    const typed = structuredClone(first.op.filters);
    expect(typed[0].dataType).toBe("number");
    const deps2 = { ...deps, shadow: createShadow({ widgets: [], layers: [], dynamicViews: [], filters: [] }) };
    const second = await checkAiCandidate(deps2, stripStamped(first.op));
    expect(second.ok).toBe(true);
    if (second.ok && second.op.op === "apply_filter") expect(second.op.filters).toEqual(typed);
  });
});

function pendingRow(username = "dee", status = "final", outcome = "not_decided", detail: string | null = "proposed"): number {
  const changes = JSON.stringify({ applied: [], rejected: [{ label: "Add pie", stage: "live_schema", reasons: ["r"] }], proposed: ['Add bar "A"', 'Add bar "B"'] });
  const info = db
    .prepare(`INSERT INTO ai_audit (ts_ms, username, request_id, question, status, outcome, outcome_detail, counted, changes_json, kind) VALUES (?, ?, 'uuid-x', 'q', ?, ?, ?, 1, ?, 'ask')`)
    .run(Date.now(), username, status, outcome, detail, changes);
  return Number(info.lastInsertRowid);
}
const rowOf = (id: number) => db.prepare("SELECT outcome, outcome_detail, changes_json FROM ai_audit WHERE id=?").get(id) as { outcome: string; outcome_detail: string | null; changes_json: string };

describe("decision", () => {
  it("APPRSTORE-5: one-shot, owner-only, merges labels only", () => {
    const id = pendingRow();
    const d = { auditId: id, username: "DEE", outcome: "partly_applied" as const, applied: ['Add bar "A"'], failed: [{ label: 'Add bar "B"', stage: "live_schema", reasons: ["column fare not found"] }], unticked: [] };
    expect(decideAiProposal(d)).toBe(true);
    const r = rowOf(id);
    expect(r.outcome).toBe("partly_applied");
    expect(r.outcome_detail).toBeNull();
    expect(JSON.parse(r.changes_json)).toEqual({
      applied: ['Add bar "A"'],
      rejected: [{ label: "Add pie", stage: "live_schema", reasons: ["r"] }, { label: 'Add bar "B"', stage: "recheck", reasons: ["column fare not found"] }],
      unticked: [],
      proposed: ['Add bar "A"', 'Add bar "B"'],
    });
    const before = rowOf(id);
    expect(decideAiProposal({ ...d, outcome: "rejected", applied: [] })).toBe(false);
    expect(rowOf(id)).toEqual(before);
    const other = pendingRow();
    expect(decideAiProposal({ ...d, auditId: other, username: "eve" })).toBe(false);
    expect(rowOf(other).outcome).toBe("not_decided");
  });

  it("APPRSTORE-6: proposalRowState", () => {
    const pending = pendingRow();
    const decided = pendingRow("dee", "final", "applied", null);
    const running = pendingRow("dee", "running", "not_decided", "proposed");
    expect(proposalRowState(pending, "dee")).toBe("pending");
    expect(proposalRowState(decided, "dee")).toBe("decided");
    expect(proposalRowState(pending, "eve")).toBe("not_found");
    expect(proposalRowState(999999, "dee")).toBe("not_found");
    expect(proposalRowState(running, "dee")).toBe("not_found");
  });
});
