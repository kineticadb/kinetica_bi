// Phase 135-10: one admitted ask -> streamed SSE events + the FinalizeInput for the audit row. Never throws.
// Events: status / step / result {answerId,text,ops,skipped,clarifications,followUps,applied} (ONLY on outcome ok, once) / error / done. Nothing from a non-ok answer is applied.
import { AI_QUERY_LIST_MAX, type AskRequest } from "@kinetica-bi/shared";
import { getDashboardDynamicView, listDashboardDynamicViews, listDashboardTables, listTables } from "../../db";
import type { AiConfig } from "../aiConfig";
import type { AiQueryAuditEntry, FinalizeInput } from "../aiAudit";
import { listAiSessionViewsForSid } from "../aiSessionViews";
import { canViewDashboard } from "../dashboardAccessDb";
import { getEffectivePermissions } from "../rbacDb";
import { principalForSession, SessionEndedError } from "../exportRunner";
import { AI_USER_MESSAGES, runAgentLoop, type AgentLoopResult } from "./agentLoop";
import { buildConversationMessages, buildSystemParts, projectSnapshot } from "./context";
import { gatewayDvLimits } from "./dvDeps";
import { createLiveSchema } from "./liveSchema";
import { buildQueryScope, type QueryScope } from "./queryScope";
import { createQueryPort, type QueryPort } from "./queryRunner";
import { parseReplyTrailer, toChoiceClarification } from "./replyTrailer";
import { getAiProviderFactory } from "./providers";
import { defaultSleep } from "./retry";
import { createShadow } from "./shadow";
import type { createSseWriter } from "./sseWriter";
import { buildToolRegistry } from "./tools/registry";
import { QUERY_TOOLS } from "./tools/query";
import type { LiveTableInfo } from "./tools/types";

export type RunAnswerInput = {
  sid: string;
  username: string;
  auditId: number;
  requestId: string;
  body: AskRequest;
  dashboard: { id: number; title?: string };
  config: AiConfig;
  signal: AbortSignal;
  sse: ReturnType<typeof createSseWriter>;
  now?: () => number;
  sleep?: (ms: number, s: AbortSignal) => Promise<void>;
  /** 140-09: set by runAnswer once the query port exists so the route's hard-deadline finalize can still record the queries attempted. */
  queryLog?: { current?: () => readonly AiQueryAuditEntry[] };
};

export type AiErrorCode = "AI_CAPPED" | "AI_RATE_LIMITED" | "AI_PROVIDER_ERROR" | "AI_CANCELLED" | "AI_SESSION_ENDED" | "AI_INTERNAL";

function errorCodeFor(r: Pick<AgentLoopResult, "outcome" | "detail">): AiErrorCode {
  switch (r.outcome) {
    case "capped": return "AI_CAPPED";
    case "rate_limited": return "AI_RATE_LIMITED";
    case "cancelled": return r.detail === "session_ended" ? "AI_SESSION_ENDED" : "AI_CANCELLED";
    case "provider_error": return r.detail === "internal" ? "AI_INTERNAL" : "AI_PROVIDER_ERROR";
    default: return "AI_INTERNAL";
  }
}

const FALLBACK_MESSAGE: Record<AiErrorCode, string> = {
  AI_CAPPED: "This answer reached its limit; try a more specific question.",
  AI_RATE_LIMITED: AI_USER_MESSAGES.rateLimited,
  AI_PROVIDER_ERROR: AI_USER_MESSAGES.providerFailed,
  AI_CANCELLED: "The answer was cancelled.",
  AI_SESSION_ENDED: AI_USER_MESSAGES.sessionEnded,
  AI_INTERNAL: AI_USER_MESSAGES.internal,
};

export async function runAnswer(input: RunAnswerInput): Promise<FinalizeInput> {
  const now = input.now ?? Date.now;
  const started = now();
  const { sse, config, body, username, sid } = input;
  const durationMs = () => Math.max(0, now() - started);
  let finalize: FinalizeInput;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  let steps = 0;
  let queryPort: QueryPort | undefined;

  try {
    const principal = () => principalForSession(sid);
    const liveSchema = createLiveSchema({ username, principal, signal: input.signal, tag: input.requestId });

    const dashboardTables: LiveTableInfo[] = [];
    for (const t of listDashboardTables(input.dashboard.id)) {
      const d = await liveSchema.describe(t.id);
      if (d.ok) dashboardTables.push(d.table);
    }
    const view = projectSnapshot(body, input.dashboard);
    let queryRules: { maxRows: number; maxPerAnswer: number; views: QueryScope["views"] } | undefined;
    if (config.dataAccess === "query") {
      const scope = buildQueryScope({
        username,
        dashboardId: input.dashboard.id,
        dashboardTables: listDashboardTables(input.dashboard.id).map((t) => ({ id: t.id, schema: t.schema, name: t.name })),
        savedViews: listDashboardDynamicViews(input.dashboard.id).map((v) => ({ id: v.id, name: v.name, columns: v.columns_json })),
        aiViews: listAiSessionViewsForSid(sid),
        aiViewNames: new Map(body.snapshot.dynamicViews.filter((d) => d.id < 0).map((d) => [d.id, d.name] as [number, string])),
      });
      queryPort = createQueryPort({
        requestId: input.requestId,
        principal,
        scope,
        liveSchema,
        limits: { maxRows: config.queryMaxRows, maxChars: config.queryMaxChars, timeoutMs: config.queryTimeoutMs, maxPerAnswer: config.queryMaxPerAnswer },
        dashboardTableIds: () => listDashboardTables(input.dashboard.id).map((t) => t.id),
      });
      const port = queryPort;
      if (input.queryLog) input.queryLog.current = () => port.entries();
      queryRules = { maxRows: config.queryMaxRows, maxPerAnswer: config.queryMaxPerAnswer, views: scope.views };
    }
    const system = buildSystemParts({ view, dashboardTables, maxToolSteps: config.maxToolSteps, dataAccess: config.dataAccess, ...(queryRules ? { query: queryRules } : {}) });
    const messages = buildConversationMessages(body.turns, body.question, config.historyTurns);
    const registry = buildToolRegistry({ dataAccess: config.dataAccess, extraTools: [...QUERY_TOOLS] });
    const shadow = createShadow(body.snapshot);
    const provider = getAiProviderFactory()(config);

    const result = await runAgentLoop(
      {
        system,
        messages,
        registry,
        toolCtx: {
          username,
          dashboardId: input.dashboard.id,
          dataAccess: config.dataAccess,
          dashboardView: () => view,
          dashboardTableIds: () => listDashboardTables(input.dashboard.id).map((t) => t.id),
          registeredTables: () => listTables().map((t) => ({ id: t.id, schema: t.schema, name: t.name, ...(t.description ? { description: t.description } : {}) })),
          liveSchema,
          ...(queryPort ? { query: queryPort } : {}),
        },
        gateway: {
          username,
          dashboardId: input.dashboard.id,
          shadow,
          liveSchema,
          getPermissions: (u) => getEffectivePermissions(u),
          canViewDashboard: (u, id) => canViewDashboard(u, id),
          dashboardTableIds: () => listDashboardTables(input.dashboard.id).map((t) => t.id),
          approvals: body.approvals,
          aiDv: gatewayDvLimits(config),
          dynamicViewInfo: (id) => {
            const r = getDashboardDynamicView(id);
            return r && r.dashboard_id === input.dashboard.id ? { name: r.name, columns: r.columns_json ?? null, sourceTableId: r.source_table_id } : undefined;
          },
        },
        dataAccess: config.dataAccess,
        maxToolSteps: config.maxToolSteps,
        timeoutMs: config.timeoutMs,
        maxNewWidgets: config.maxNewWidgets,
      },
      {
        provider,
        signal: input.signal,
        now,
        sleep: input.sleep ?? defaultSleep,
        checkSession: () => {
          principalForSession(sid);
        },
        emit: (ev) => {
          if (ev.type === "status") sse.send("status", { phase: ev.phase, label: ev.label, ...(ev.seconds !== undefined ? { seconds: ev.seconds } : {}) });
          else sse.send("step", { n: ev.n, tool: ev.tool, label: ev.label });
        },
      },
    );

    usage = result.usage;
    steps = result.steps;
    const trailer = result.outcome === "ok" ? parseReplyTrailer(result.text) : null;
    if (result.outcome === "ok" && trailer) {
      const choice = toChoiceClarification(trailer.text, trailer.choices);
      const clarifications = choice && !result.clarifications.some((c) => c.kind === "choose_option") ? [...result.clarifications, choice] : result.clarifications;
      const queries = queryPort
        ? queryPort.entries().slice(0, AI_QUERY_LIST_MAX).map((q) => ({
            sql: q.sql.slice(0, 8000),
            ...(q.rowCount !== undefined ? { rowCount: q.rowCount } : {}),
            outcome: q.outcome,
            ...(q.reason ? { reason: q.reason.slice(0, 300) } : {}),
          }))
        : [];
      sse.send("result", { answerId: input.auditId, text: trailer.text, ops: result.ops, skipped: result.skipped, clarifications, followUps: trailer.followUps, applied: result.applied, ...(queries.length > 0 ? { queries } : {}) });
    } else {
      const code = errorCodeFor(result);
      sse.send("error", { code, message: result.message ?? FALLBACK_MESSAGE[code] });
    }
    finalize = {
      auditId: input.auditId,
      outcome: result.outcome,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      answerText: trailer ? trailer.text : result.text,
      steps: result.steps,
      ...(result.usage.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
      ...(result.usage.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
      tools: result.tools,
      changes: { applied: result.outcome === "ok" ? result.applied : [], rejected: result.rejected },
      durationMs: durationMs(),
      ...(queryPort ? { queries: [...queryPort.entries()] } : {}),
    };
  } catch (e) {
    const ended = e instanceof SessionEndedError;
    const code: AiErrorCode = ended ? "AI_SESSION_ENDED" : "AI_INTERNAL";
    sse.send("error", { code, message: ended ? AI_USER_MESSAGES.sessionEnded : AI_USER_MESSAGES.internal });
    finalize = {
      auditId: input.auditId,
      outcome: ended ? "cancelled" : "provider_error",
      detail: ended ? "session_ended" : "internal",
      steps,
      tools: [],
      changes: { applied: [], rejected: [] },
      durationMs: durationMs(),
      ...(queryPort ? { queries: [...queryPort.entries()] } : {}),
    };
  }
  sse.send("done", { answerId: input.auditId, outcome: finalize.outcome, steps: finalize.steps, usage });
  return finalize;
}
