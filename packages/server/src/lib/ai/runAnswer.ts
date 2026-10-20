// Phase 135-10: one admitted ask -> streamed SSE events + the FinalizeInput for the audit row. Never throws.
// Events: status / step / result {answerId,text,ops,skipped,clarifications,followUps,applied} (ONLY on outcome ok, once) / error / done. Nothing from a non-ok answer is applied.
import type { AskRequest } from "@kinetica-bi/shared";
import { getDashboardDynamicView, listDashboardTables, listTables } from "../../db";
import type { AiConfig } from "../aiConfig";
import type { FinalizeInput } from "../aiAudit";
import { canViewDashboard } from "../dashboardAccessDb";
import { getEffectivePermissions } from "../rbacDb";
import { principalForSession, SessionEndedError } from "../exportRunner";
import { AI_USER_MESSAGES, runAgentLoop, type AgentLoopResult } from "./agentLoop";
import { buildConversationMessages, buildSystemParts, projectSnapshot } from "./context";
import { createLiveSchema } from "./liveSchema";
import { parseReplyTrailer, toChoiceClarification } from "./replyTrailer";
import { getAiProviderFactory } from "./providers";
import { defaultSleep } from "./retry";
import { createShadow } from "./shadow";
import type { createSseWriter } from "./sseWriter";
import { buildToolRegistry } from "./tools/registry";
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

  try {
    const principal = () => principalForSession(sid);
    const liveSchema = createLiveSchema({ username, principal, signal: input.signal, tag: input.requestId });

    const dashboardTables: LiveTableInfo[] = [];
    for (const t of listDashboardTables(input.dashboard.id)) {
      const d = await liveSchema.describe(t.id);
      if (d.ok) dashboardTables.push(d.table);
    }
    const view = projectSnapshot(body, input.dashboard);
    const system = buildSystemParts({ view, dashboardTables, maxToolSteps: config.maxToolSteps, dataAccess: config.dataAccess });
    const messages = buildConversationMessages(body.turns, body.question, config.historyTurns);
    const registry = buildToolRegistry({ dataAccess: config.dataAccess });
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
          aiDv: { maxRecords: config.dvMaxRecords, maxJoins: config.dvMaxJoins, maxPerSession: config.dvMaxPerSession },
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
      sse.send("result", { answerId: input.auditId, text: trailer.text, ops: result.ops, skipped: result.skipped, clarifications, followUps: trailer.followUps, applied: result.applied });
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
    };
  }
  sse.send("done", { answerId: input.auditId, outcome: finalize.outcome, steps: finalize.steps, usage });
  return finalize;
}
