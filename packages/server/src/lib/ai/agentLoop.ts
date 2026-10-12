// Phase 135-09: the agent loop. Sequential steps of provider call -> tool execution. Read tools run; mutate tools
// go through the validation gateway. Validated ops are BUFFERED and surfaced only when the whole answer succeeds
// (D-14 atomic apply): a cap, provider error, 429 give-up, timeout, cancel or ended session yields ZERO ops.
// Timing is injected (now/sleep). Errors shown to the model/user are fixed strings, never upstream text.
import type { AiOp } from "@kinetica-bi/shared";
import type { AiDataAccess } from "../aiConfig";
import { SessionEndedError } from "../exportRunner";
import { formatStepCapMessage, type AiOutcome, type AiToolAuditEntry } from "../aiAudit";
import { buildOutboundRequest, EgressViolation, part, type OutboundMessage, type OutboundPart } from "./outbound";
import type { LlmEvent, LlmProvider, LlmToolCall } from "./provider";
import { createRetryBudget, withProviderRetry } from "./retry";
import { checkAiOp, type GatewayDeps } from "./gateway";
import type { ToolRegistry } from "./tools/registry";
import type { GatewayStage, ToolContext } from "./tools/types";

export const AI_USER_MESSAGES = {
  rateLimited: "The AI provider is rate-limiting requests. Try again in a minute.",
  providerAuth: "The AI provider rejected the server's credentials. Ask an administrator to check the AI configuration.",
  providerFailed: "The AI provider could not complete this answer. Try again.",
  timeout: "The AI took too long to answer. Try a more specific question.",
  sessionEnded: "Your session ended. Sign in again to keep using the AI assistant.",
  egressBlocked: "This answer was stopped because it would have sent data the AI is not allowed to see.",
  internal: "Something went wrong while answering. Nothing was changed.",
} as const;

export type AiProgressEvent =
  | { type: "status"; phase: "thinking" | "tool" | "waiting_provider"; label: string; seconds?: number }
  | { type: "step"; n: number; tool: string; label: string };

export type AgentLoopInput = {
  system: OutboundPart[];
  messages: OutboundMessage[];
  registry: ToolRegistry;
  toolCtx: ToolContext;
  gateway: GatewayDeps;
  dataAccess: AiDataAccess;
  maxToolSteps: number;
  timeoutMs: number;
};
export type AgentLoopDeps = {
  provider: LlmProvider;
  signal: AbortSignal;
  now: () => number;
  sleep: (ms: number, s: AbortSignal) => Promise<void>;
  retryBudgetMs?: number;
  checkSession: () => void;
  emit: (ev: AiProgressEvent) => void;
};
export type AgentLoopResult = {
  outcome: AiOutcome;
  detail?: string;
  message?: string;
  text: string;
  ops: AiOp[];
  applied: string[];
  rejected: { label: string; stage: GatewayStage; reasons: string[] }[];
  tools: AiToolAuditEntry[];
  steps: number;
  usage: { inputTokens?: number; outputTokens?: number };
};

const MAX_REJECTIONS_PER_TOOL = 2;
class Stop extends Error {
  constructor(readonly outcome: AiOutcome, readonly detail: string, readonly message2?: string) {
    super(detail);
  }
}

export async function runAgentLoop(input: AgentLoopInput, deps: AgentLoopDeps): Promise<AgentLoopResult> {
  const { registry, toolCtx, gateway, maxToolSteps } = input;
  const bufferedOps: AiOp[] = [];
  const applied: string[] = [];
  const rejected: AgentLoopResult["rejected"] = [];
  const tools: AiToolAuditEntry[] = [];
  const usage: { inputTokens?: number; outputTokens?: number } = {};
  let steps = 0;
  let text = "";
  let outcome: AiOutcome = "ok";
  let detail: string | undefined;
  let message: string | undefined;

  const deadline = deps.now() + input.timeoutMs;
  const deadlineCtl = new AbortController();
  const timer = setTimeout(() => deadlineCtl.abort(), Math.max(0, input.timeoutMs));
  (timer as { unref?: () => void }).unref?.();
  const signal = AbortSignal.any([deps.signal, deadlineCtl.signal]);
  const budget = createRetryBudget(deps.retryBudgetMs);
  const rejections = new Map<string, number>();
  const convo: OutboundMessage[] = [...input.messages];

  const guard = (): void => {
    if (deps.signal.aborted) throw new Stop("cancelled", "client_abort");
    if (deadlineCtl.signal.aborted || deps.now() > deadline) {
      deadlineCtl.abort();
      throw new Stop("provider_error", "timeout", AI_USER_MESSAGES.timeout);
    }
  };

  try {
    for (;;) {
      guard();
      deps.emit({ type: "status", phase: "thinking", label: "Thinking…" });
      let req;
      try {
        req = buildOutboundRequest({ system: input.system, messages: convo, tools: [...registry.specs], dataAccess: input.dataAccess });
      } catch (e) {
        if (e instanceof EgressViolation) throw new Stop("provider_error", "egress_blocked", AI_USER_MESSAGES.egressBlocked);
        throw e;
      }

      let turnText = "";
      const calls: LlmToolCall[] = [];
      let assistantState: unknown;
      let done = false;
      let err: Extract<LlmEvent, { type: "error" }> | undefined;
      try {
        for await (const ev of withProviderRetry(deps.provider, req, signal, {
          budget,
          sleep: deps.sleep,
          onWait: (s) => deps.emit({ type: "status", phase: "waiting_provider", label: `Waiting for the AI provider… (${s}s)`, seconds: s }),
        })) {
          if (ev.type === "text_delta") turnText += ev.text;
          else if (ev.type === "tool_call") calls.push({ id: ev.id, name: ev.name, argsJson: ev.argsRaw, ...(ev.providerState !== undefined ? { providerState: ev.providerState } : {}) });
          else if (ev.type === "usage") {
            if (ev.inputTokens !== undefined) usage.inputTokens = (usage.inputTokens ?? 0) + ev.inputTokens;
            if (ev.outputTokens !== undefined) usage.outputTokens = (usage.outputTokens ?? 0) + ev.outputTokens;
          } else if (ev.type === "done") {
            done = true;
            assistantState = ev.assistantState;
          } else if (ev.type === "error") err = ev;
        }
      } catch (e) {
        // sleep/provider rejected: an abort is a cancel/timeout; anything else is internal
        if (signal.aborted) {
          guard();
          throw new Stop("cancelled", "client_abort");
        }
        throw e;
      }
      guard();
      if (err) {
        switch (err.kind) {
          case "rate_limited":
          case "overloaded":
            throw new Stop("rate_limited", err.kind === "overloaded" ? "overloaded" : "rate_limited", AI_USER_MESSAGES.rateLimited);
          case "auth":
            throw new Stop("provider_error", "auth", AI_USER_MESSAGES.providerAuth);
          case "timeout":
            throw new Stop("provider_error", "timeout", AI_USER_MESSAGES.timeout);
          case "aborted":
            throw new Stop("cancelled", "client_abort");
          default:
            throw new Stop("provider_error", err.kind, AI_USER_MESSAGES.providerFailed);
        }
      }
      if (!done) throw new Stop("provider_error", "protocol", AI_USER_MESSAGES.providerFailed);

      if (calls.length === 0) {
        deps.checkSession();
        text = turnText;
        break;
      }

      convo.push({
        role: "assistant",
        ...(turnText ? { parts: [part.history(turnText)] } : {}),
        toolCalls: calls,
        ...(assistantState !== undefined ? { providerState: assistantState } : {}),
      });

      let capped = false;
      for (const call of calls) {
        const answer = (parts: OutboundPart[], isError?: boolean) =>
          convo.push({ role: "tool", toolCallId: call.id, name: call.name, parts, ...(isError ? { isError: true } : {}) });
        if (capped || steps >= maxToolSteps) {
          capped = true;
          tools.push({ name: call.name, result: "error", reasons: ["Not executed: step limit reached."] });
          answer([part.config("Not executed: step limit reached.")], true);
          continue;
        }
        guard();
        deps.checkSession();
        steps++;
        const tool = registry.byName.get(call.name);
        if (!tool) {
          const msg = `Unknown tool ${call.name}.`;
          tools.push({ name: call.name, result: "rejected", stage: "shape", reasons: [msg] });
          answer([part.config(msg)], true);
          deps.emit({ type: "step", n: steps, tool: call.name, label: msg });
          continue;
        }
        deps.emit({ type: "status", phase: "tool", label: tool.name });
        let parsedArgs: unknown;
        let parsedOk = false;
        try {
          const r = tool.args.safeParse(JSON.parse(call.argsJson));
          if (r.success) { parsedArgs = r.data; parsedOk = true; }
        } catch { /* parsedOk stays false */ }

        if (tool.kind === "read") {
          if (!parsedOk) {
            const msg = "Invalid arguments for this tool.";
            tools.push({ name: tool.name, result: "rejected", stage: "shape", reasons: [msg] });
            answer([part.config(msg)], true);
            deps.emit({ type: "step", n: steps, tool: tool.name, label: tool.name });
            continue;
          }
          try {
            const res = await tool.run(parsedArgs, toolCtx);
            tools.push({ name: tool.name, args: parsedArgs, result: res.isError ? "error" : "ok" });
            answer(res.parts, res.isError);
          } catch (e) {
            if (e instanceof SessionEndedError) throw e;
            tools.push({ name: tool.name, args: parsedArgs, result: "error" });
            answer([part.config("The tool failed.")], true);
          }
          deps.emit({ type: "step", n: steps, tool: tool.name, label: tool.name });
          continue;
        }

        // mutate tool
        if ((rejections.get(tool.name) ?? 0) >= MAX_REJECTIONS_PER_TOOL) {
          const msg = `Not executed: too many invalid attempts for ${tool.name}.`;
          tools.push({ name: tool.name, ...(parsedOk ? { args: parsedArgs } : {}), result: "rejected", reasons: [msg] });
          answer([part.config(msg)], true);
          deps.emit({ type: "step", n: steps, tool: tool.name, label: msg });
          continue;
        }
        const g = await checkAiOp(gateway, tool, call.argsJson);
        if (g.ok) {
          bufferedOps.push(g.op);
          applied.push(g.label);
          tools.push({ name: tool.name, ...(parsedOk ? { args: parsedArgs } : {}), result: "ok" });
          answer([part.config("OK: " + g.label)]);
          deps.emit({ type: "step", n: steps, tool: tool.name, label: g.label });
        } else {
          rejections.set(tool.name, (rejections.get(tool.name) ?? 0) + 1);
          rejected.push({ label: tool.name, stage: g.stage, reasons: g.reasons });
          tools.push({ name: tool.name, ...(parsedOk ? { args: parsedArgs } : {}), result: "rejected", stage: g.stage, reasons: g.reasons });
          answer([part.config(g.reasons.join("; "))], true);
          deps.emit({ type: "step", n: steps, tool: tool.name, label: tool.name });
        }
      }
      if (capped) throw new Stop("capped", "step_cap", formatStepCapMessage(maxToolSteps));
    }
  } catch (e) {
    if (e instanceof Stop) {
      outcome = e.outcome;
      detail = e.detail;
      message = e.message2;
    } else if (e instanceof SessionEndedError) {
      outcome = "cancelled";
      detail = "session_ended";
      message = AI_USER_MESSAGES.sessionEnded;
    } else {
      outcome = "provider_error";
      detail = "internal";
      message = AI_USER_MESSAGES.internal;
    }
  } finally {
    clearTimeout(timer);
  }

  // The ONLY read of the buffer: atomic apply on full success.
  const ops = outcome === "ok" ? bufferedOps : [];
  return {
    outcome,
    ...(detail !== undefined ? { detail } : {}),
    ...(message !== undefined ? { message } : {}),
    text: outcome === "ok" ? text : "",
    ops,
    applied: outcome === "ok" ? applied : [],
    rejected,
    tools,
    steps,
    usage,
  };
}
