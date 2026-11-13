// Phase 150 (APPROVE-V22-03): apply or reject a held AI proposal. Apply re-checks every selected op through the ONE gateway (checkAiCandidate) against the client's current effective snapshot; the client folds only what this returns. Keep still re-validates anything it persists.
// Never log request bodies (filter values).
import type { Express, Request, Response } from "express";
import { AskRequestSchema, ASK_REQUEST_MAX_BYTES, aiOpDependencies, isClosedSelection, VIEWER_AI_OFF_CODE, VIEWER_AI_OFF_MESSAGE, type AiOp } from "@kinetica-bi/shared";
import type { AuthedRequest } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { getAiConfig } from "./lib/aiConfig";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { resolveViewerAi } from "./lib/viewerAi";
import { checkAiCandidate } from "./lib/ai/gateway";
import { buildGatewayDeps } from "./lib/ai/gatewayDeps";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { createShadow } from "./lib/ai/shadow";
import { principalForSession, SessionEndedError } from "./lib/exportRunner";
import { decideAiProposal, dropProposal, getProposal, proposalRowState, stripStamped } from "./lib/aiProposals";

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;
const sidOf = (req: Request): string => (req as AuthedRequest).user!.sid;
const ID_RE = /^[1-9]\d{0,15}$/;
const SNAPSHOT_SCHEMA = AskRequestSchema.shape.snapshot;

const badRequest = (res: Response) => res.status(400).json({ error: "Invalid request.", code: "AI_PROPOSAL_BAD_REQUEST" });
const notFound = (res: Response) => res.status(404).json({ error: "Proposal not found.", code: "AI_PROPOSAL_NOT_FOUND" });
const decided = (res: Response) => res.status(409).json({ error: "These changes were already decided.", code: "AI_PROPOSAL_DECIDED" });

function parseApplyBody(raw: unknown): { selected: number[]; snapshot: ReturnType<typeof SNAPSHOT_SCHEMA.parse> } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "selected" && k !== "snapshot")) return null;
  const sel = o.selected;
  if (!Array.isArray(sel) || sel.length < 1 || sel.length > 200) return null;
  if (!sel.every((n) => Number.isInteger(n) && n >= 0 && n <= 199)) return null;
  if (new Set(sel).size !== sel.length) return null;
  const snap = SNAPSHOT_SCHEMA.safeParse(o.snapshot);
  if (!snap.success) return null;
  return { selected: [...(sel as number[])].sort((a, b) => a - b), snapshot: snap.data };
}

export function registerAiProposalRoutes(app: Express): void {
  app.post("/api/ai/proposals/:id/apply", ...requirePermission(PERMISSIONS.AI_USE), async (req: Request, res: Response) => {
    const idRaw = String(req.params.id);
    if (!ID_RE.test(idRaw)) return badRequest(res);
    const id = Number(idRaw);
    const cfg = getAiConfig();
    if (!cfg.enabled) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > ASK_REQUEST_MAX_BYTES) {
      return res.status(413).json({ error: "Request too large.", code: "AI_REQUEST_TOO_LARGE" });
    }
    const body = parseApplyBody(req.body);
    if (!body) return badRequest(res);
    const username = usernameOf(req);

    const p = getProposal(id, username);
    if (!p) {
      const state = proposalRowState(id, username);
      if (state === "pending") return res.status(410).json({ error: "This proposal expired. Ask again.", code: "AI_PROPOSAL_GONE" });
      if (state === "decided") return decided(res);
      return notFound(res);
    }
    if (!canViewDashboard(username, p.dashboardId)) return notFound(res);
    // 152: Viewer AI Off refuses the whole Apply for a user without edit rights. The proposal stays undecided and expires
    // (the web marks it expired). Answers and filters needs nothing here: the gateway re-check (buildGatewayDeps) fails
    // every non-filter op with the mode reason, so the existing accepted/failed logic yields partly_applied / none.
    const viewer = resolveViewerAi(username, p.dashboardId);
    if (viewer.restricted && viewer.mode === "off") {
      return res.status(423).json({ error: VIEWER_AI_OFF_MESSAGE, code: VIEWER_AI_OFF_CODE, mode: "off" });
    }

    const { selected } = body;
    if (selected.some((i) => i >= p.ops.length) || !isClosedSelection(selected, aiOpDependencies(p.ops))) {
      return res.status(400).json({ error: "Changes that depend on each other must be applied together.", code: "AI_PROPOSAL_BAD_SELECTION" });
    }

    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    const accepted: AiOp[] = [];
    const acceptedIndexes: number[] = [];
    const applied: string[] = [];
    const failed: { index: number; label: string; stage: string; reasons: string[] }[] = [];
    try {
      const liveSchema = createLiveSchema({ username, principal: () => principalForSession(sidOf(req)), signal: ac.signal, tag: `proposal-${id}` });
      const deps = buildGatewayDeps({ username, dashboardId: p.dashboardId, shadow: createShadow(body.snapshot), liveSchema, config: cfg.config, approvals: p.approvals });
      for (const i of selected) {
        const g = await checkAiCandidate(deps, stripStamped(p.ops[i]));
        if (g.ok) {
          accepted.push(g.op);
          acceptedIndexes.push(i);
          applied.push(g.label);
        } else {
          failed.push({ index: i, label: g.label ?? p.labels[i] ?? "Change", stage: g.stage, reasons: g.stage === "clarification" ? ["needs your approval; ask again"] : g.reasons });
        }
      }
    } catch (e) {
      if (e instanceof SessionEndedError) return res.status(401).json({ error: "Your session ended.", code: "AI_SESSION_ENDED" });
      return res.status(500).json({ error: "Something went wrong.", code: "AI_INTERNAL" });
    }
    if (accepted.length === 0) {
      return res.json({ outcome: "none", accepted: [], acceptedIndexes: [], applied: [], failed, unticked: [] });
    }
    const unticked = p.ops.map((_, i) => i).filter((i) => !selected.includes(i)).map((i) => p.labels[i] ?? "Change");
    const outcome = failed.length === 0 && unticked.length === 0 ? "applied" : "partly_applied";
    const failedForAudit = failed.map((f) => ({ label: f.label, stage: f.stage, reasons: f.reasons }));
    if (!decideAiProposal({ auditId: id, username, outcome, applied, failed: failedForAudit, unticked })) return decided(res);
    dropProposal(id);
    return res.json({ outcome, accepted, acceptedIndexes, applied, failed, unticked });
  });

  app.post("/api/ai/proposals/:id/reject", ...requirePermission(PERMISSIONS.AI_USE), (req: Request, res: Response) => {
    const idRaw = String(req.params.id);
    if (!ID_RE.test(idRaw)) return badRequest(res);
    const id = Number(idRaw);
    const b = req.body as unknown;
    if (b !== undefined && b !== null && !(typeof b === "object" && !Array.isArray(b) && Object.keys(b as object).length === 0)) return badRequest(res);
    const username = usernameOf(req);
    if (!decideAiProposal({ auditId: id, username, outcome: "rejected", applied: [], failed: [], unticked: [] })) {
      return proposalRowState(id, username) === "decided" ? decided(res) : notFound(res);
    }
    dropProposal(id);
    return res.json({ outcome: "rejected" });
  });
}
