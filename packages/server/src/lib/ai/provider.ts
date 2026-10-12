// Phase 135: normalised provider contract. Adapters translate to/from the vendor wire format.
// Provider errors carry kind/status/retryAfterMs ONLY - never provider body text (it may echo prompt data).
// `argsRaw` is never pre-parsed here; the gateway parses it exactly once.
import type { OutboundRequest } from "./outbound";

export type ToolSpec = { name: string; description: string; jsonSchema: Record<string, unknown> };
export type LlmToolCall = { id: string; name: string; argsJson: string; providerState?: unknown };
export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: LlmToolCall[]; providerState?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };
export type Capabilities = {
  nativeTools: boolean;
  parallelTools: boolean;
  streaming: boolean;
  usageInStream: boolean;
  forcedToolChoice: boolean;
  opaqueReplay: boolean;
};
export type ProviderErrorKind =
  | "rate_limited"
  | "overloaded"
  | "auth"
  | "bad_request"
  | "network"
  | "timeout"
  | "aborted"
  | "protocol";
export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; argsRaw: string; providerState?: unknown }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done"; finish: "stop" | "tool_calls" | "length" | "filtered" | "other"; assistantState?: unknown }
  | { type: "error"; kind: ProviderErrorKind; status?: number; retryAfterMs?: number }; // NEVER provider body text
export interface LlmProvider {
  readonly id: string; // "openai-compatible" | "claude" | "json-action(<inner>)" | "scripted"
  readonly model: string;
  readonly capabilities: Capabilities;
  complete(req: OutboundRequest, signal: AbortSignal): AsyncIterable<LlmEvent>;
}
export type ProviderDeps = { fetchFn?: typeof fetch; now?: () => number };
