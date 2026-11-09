/**
 * Phase 142 AIGOV-V20-05 — read-only views of ai_audit for audit:view holders.
 * Returns only what the table already stores; never tool args; dashboard names only for live, kept dashboards.
 * Not gated on AI being enabled (rows outlive a config change). GETs only.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod/v4";
import { db, getDashboard, getGeneratedPending } from "./db";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";

export const AI_AUDIT_PAGE_SIZE = 50;
export const AI_AUDIT_OUTCOMES = ["ok", "cancelled", "capped", "provider_error", "rate_limited", "kept", "keep_conflict", "keep_denied", "keep_invalid", "keep_failed", "unfinished"] as const;

type DashState = "live" | "pending" | "deleted" | "none";
const DAY_MS = 86_400_000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function keepSummary(outcome: string | null, changesJson: string | null): string {
  switch (outcome) {
    case "kept": {
      try {
        const c = JSON.parse(changesJson ?? "") as any;
        if (!c || typeof c !== "object") return "Kept";
        const added = num(c.added?.widgets) + num(c.added?.layers) + num(c.added?.dynamicViews);
        const edited = num(c.edited?.widgets) + num(c.edited?.layers);
        const removed = num(c.removed?.widgets) + num(c.removed?.layers) + num(c.removed?.dynamicViews);
        return `Kept ${added} added, ${edited} edited, ${removed} removed`;
      } catch {
        return "Kept";
      }
    }
    case "keep_conflict": return "Not kept: someone else changed the dashboard";
    case "keep_denied": return "Not kept: a permission was missing";
    case "keep_invalid": return "Not kept: the change was invalid";
    case "keep_failed": return "Not kept: saving failed";
    default: return "Keep";
  }
}

const bad = (res: Response) => res.status(400).json({ error: "Invalid filter.", code: "AI_AUDIT_BAD_REQUEST" });

const intStr = (re: RegExp) => z.string().regex(re).transform(Number);
const WindowShape = { from: intStr(/^\d{1,15}$/).optional(), to: intStr(/^\d{1,15}$/).optional() };
const ListQuery = z.object({
  ...WindowShape,
  outcome: z.string().transform((s) => s.split(",")).pipe(z.array(z.enum(AI_AUDIT_OUTCOMES)).min(1).max(AI_AUDIT_OUTCOMES.length)).optional(),
  dashboardId: intStr(/^[1-9]\d{0,9}$/).optional(),
  page: intStr(/^[1-9]\d{0,5}$/).optional(),
});
const FacetQuery = z.object(WindowShape);

function windowOf(q: { from?: number; to?: number }): { from: number; to: number } | null {
  const to = q.to ?? Date.now();
  const from = q.from ?? to - 7 * DAY_MS;
  return from > to ? null : { from, to };
}

function safeParse(text: unknown): unknown | null {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function dashLookup() {
  const cache = new Map<number, { name: string | null; state: DashState }>();
  return (id: number | null): { name: string | null; state: DashState } => {
    if (id === null) return { name: null, state: "none" };
    const hit = cache.get(id);
    if (hit) return hit;
    let v: { name: string | null; state: DashState };
    const pending = getGeneratedPending(id);
    if (pending === undefined) v = { name: null, state: "deleted" };
    else if (pending !== null) v = { name: null, state: "pending" };
    else v = { name: getDashboard(id)?.name ?? null, state: "live" };
    cache.set(id, v);
    return v;
  };
}

type AuditKind = "ask" | "generate" | "keep" | "mcp";
const kindOf = (r: { kind: string | null; request_id: unknown }): AuditKind =>
  (r.kind as AuditKind | null) ?? (typeof r.request_id === "string" && r.request_id.startsWith("keep-") ? "keep" : "ask");

function baseDto(r: any, dash: ReturnType<typeof dashLookup>) {
  const d = dash(r.dashboard_id);
  return {
    id: r.id as number,
    ts: r.ts_ms as number,
    username: r.username as string,
    dashboardId: (r.dashboard_id ?? null) as number | null,
    dashboardName: d.name,
    dashboardState: d.state,
    kind: kindOf(r),
    outcome: (r.outcome ?? null) as string | null,
    outcomeDetail: (r.outcome_detail ?? null) as string | null,
    steps: (r.steps ?? null) as number | null,
    durationMs: (r.duration_ms ?? null) as number | null,
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const numOpt = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function registerAiAuditRoutes(app: Express): void {
  app.get("/api/ai/audit", ...requirePermission(PERMISSIONS.AUDIT_VIEW), (req: Request, res: Response) => {
    const p = ListQuery.safeParse(req.query);
    if (!p.success) return bad(res);
    const w = windowOf(p.data);
    if (!w) return bad(res);
    const page = p.data.page ?? 1;
    const params: Record<string, number | string> = { from: w.from, to: w.to };
    let where = "WHERE ts_ms >= @from AND ts_ms <= @to";
    if (p.data.outcome) {
      where += ` AND outcome IN (${p.data.outcome.map((_, i) => `@o${i}`).join(",")})`;
      p.data.outcome.forEach((o, i) => (params[`o${i}`] = o));
    }
    if (p.data.dashboardId !== undefined) {
      where += " AND dashboard_id = @d";
      params.d = p.data.dashboardId;
    }
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM ai_audit ${where}`).get(params) as { n: number }).n;
    const raw = db
      .prepare(
        `SELECT id, ts_ms, username, dashboard_id, kind, request_id, question, outcome, outcome_detail, steps, duration_ms, changes_json FROM ai_audit ${where} ORDER BY ts_ms DESC, id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: AI_AUDIT_PAGE_SIZE, offset: (page - 1) * AI_AUDIT_PAGE_SIZE }) as any[];
    const dash = dashLookup();
    const rows = raw.map((r) => {
      const dto = baseDto(r, dash);
      const q = typeof r.question === "string" ? r.question : "";
      return {
        ...dto,
        question: dto.kind === "keep" ? "" : q.length > 160 ? q.slice(0, 160) + "…" : q,
        summary: dto.kind === "keep" ? keepSummary(dto.outcome, r.changes_json ?? null) : null,
      };
    });
    return res.json({ rows, total, page, pageSize: AI_AUDIT_PAGE_SIZE });
  });

  app.get("/api/ai/audit/dashboards", ...requirePermission(PERMISSIONS.AUDIT_VIEW), (req: Request, res: Response) => {
    const p = FacetQuery.safeParse(req.query);
    if (!p.success) return bad(res);
    const w = windowOf(p.data);
    if (!w) return bad(res);
    const idsRows = db
      .prepare("SELECT DISTINCT dashboard_id FROM ai_audit WHERE ts_ms >= @from AND ts_ms <= @to AND dashboard_id IS NOT NULL")
      .all({ from: w.from, to: w.to }) as { dashboard_id: number }[];
    const dash = dashLookup();
    const all = idsRows.map((r) => ({ id: r.dashboard_id, ...dash(r.dashboard_id) }));
    const live = all.filter((d) => d.state === "live").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    const rest = all.filter((d) => d.state !== "live").sort((a, b) => a.id - b.id);
    return res.json({ dashboards: [...live, ...rest].map((d) => ({ id: d.id, name: d.name, state: d.state })) });
  });

  app.get("/api/ai/audit/:id", ...requirePermission(PERMISSIONS.AUDIT_VIEW), (req: Request, res: Response) => {
    const idParam = String(req.params.id ?? "");
    if (!/^[1-9]\d{0,15}$/.test(idParam)) return bad(res);
    const r = db.prepare("SELECT * FROM ai_audit WHERE id = ?").get(Number(idParam)) as any;
    if (!r) return res.status(404).json({ error: "Not found." });
    const dto = baseDto(r, dashLookup());

    const toolsRaw = safeParse(r.tools_json);
    const tools = Array.isArray(toolsRaw)
      ? toolsRaw
          .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
          .map((t) => ({
            name: String(t.name),
            result: String(t.result),
            ...(t.stage ? { stage: String(t.stage) } : {}),
            ...(Array.isArray(t.reasons) ? { reasons: t.reasons.map(String) } : {}),
          }))
      : null;

    const queriesRaw = safeParse(r.queries_json);
    const queries = Array.isArray(queriesRaw)
      ? queriesRaw
          .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
          .map((q) => ({
            sql: str(q.sql) ?? "",
            ...(numOpt(q.rowCount) !== undefined ? { rowCount: numOpt(q.rowCount) } : {}),
            ...(numOpt(q.durationMs) !== undefined ? { durationMs: numOpt(q.durationMs) } : {}),
            ...(str(q.outcome) !== undefined ? { outcome: str(q.outcome) } : {}),
            ...(str(q.reason) !== undefined ? { reason: str(q.reason) } : {}),
          }))
      : null;

    const changesRaw = safeParse(r.changes_json);
    let changes: Record<string, unknown> | null = null;
    if (changesRaw && typeof changesRaw === "object" && !Array.isArray(changesRaw)) {
      const { idMap: _drop, ...rest } = changesRaw as Record<string, unknown>;
      changes = rest;
    }

    return res.json({
      ...dto,
      question: dto.kind === "keep" ? "" : String(r.question ?? ""),
      summary: dto.kind === "keep" ? keepSummary(dto.outcome, r.changes_json ?? null) : null,
      answerText: r.answer_text ?? null,
      provider: r.provider ?? null,
      model: r.model ?? null,
      dataAccess: r.data_access ?? null,
      allowListVersion: r.allow_list_version ?? null,
      inputTokens: r.input_tokens ?? null,
      outputTokens: r.output_tokens ?? null,
      tools,
      changes,
      queries,
    });
  });
}
