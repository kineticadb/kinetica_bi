// THE single egress choke point (AIGOV-V20-02). Adapters MUST call isOutboundRequest(req) and throw if false.
// Never accept raw strings from tool code - tool results arrive as classified parts built by per-tool
// allow-listed serializers. Never pass err.message / upstream bodies into a part.
import type { AiDataAccess } from "../aiConfig";
import type { LlmMessage, LlmToolCall, ToolSpec } from "./provider";

export type DataClass = "system" | "user" | "history" | "schema" | "config" | "values" | "rows";
export type OutboundPart = { readonly cls: DataClass; readonly text: string };

const mk = (cls: DataClass) => (text: string): OutboundPart => Object.freeze({ cls, text });
export const part: { [K in DataClass]: (text: string) => OutboundPart } = Object.freeze({
  system: mk("system"),
  user: mk("user"),
  history: mk("history"),
  schema: mk("schema"),
  config: mk("config"),
  values: mk("values"),
  rows: mk("rows"),
});

export type OutboundMessage =
  | { role: "user"; parts: OutboundPart[] }
  | { role: "assistant"; parts?: OutboundPart[]; toolCalls?: LlmToolCall[]; providerState?: unknown }
  | { role: "tool"; toolCallId: string; name: string; parts: OutboundPart[]; isError?: boolean };

declare const outboundBrand: unique symbol;
export type OutboundRequest = {
  readonly [outboundBrand]: true;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly ToolSpec[];
  readonly dataAccess: AiDataAccess;
};

export class EgressViolation extends Error {
  readonly cls: DataClass;
  constructor(cls: DataClass) {
    super(`egress violation: data class '${cls}' is not allowed to leave the server`); // class only, never the text
    this.name = "EgressViolation";
    this.cls = cls;
  }
}

const SCHEMA_OK: ReadonlySet<DataClass> = new Set(["system", "user", "history", "schema", "config"]);
const ALLOWED: Record<AiDataAccess, ReadonlySet<DataClass>> = {
  schema: SCHEMA_OK,
  query: new Set<DataClass>(["system", "user", "history", "schema", "config", "values", "rows"]),
};

const registry = new WeakSet<object>();

function check(parts: readonly OutboundPart[] | undefined, access: AiDataAccess): void {
  if (!parts) return;
  const ok = ALLOWED[access];
  for (const p of parts) if (!ok.has(p.cls)) throw new EgressViolation(p.cls);
}
const join = (parts: readonly OutboundPart[] | undefined): string => (parts ?? []).map((p) => p.text).join("\n");

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

function seal(system: string, messages: LlmMessage[], tools: ToolSpec[], dataAccess: AiDataAccess): OutboundRequest {
  const req = deepFreeze({ system, messages, tools, dataAccess }) as unknown as OutboundRequest;
  registry.add(req);
  return req;
}

export function buildOutboundRequest(input: {
  system: OutboundPart[];
  messages: OutboundMessage[];
  tools: ToolSpec[];
  dataAccess: AiDataAccess;
}): OutboundRequest {
  const { dataAccess } = input;
  // Walk EVERY part before allocating anything.
  check(input.system, dataAccess);
  for (const m of input.messages) check(m.role === "assistant" ? m.parts : m.parts, dataAccess);

  const messages: LlmMessage[] = input.messages.map((m): LlmMessage => {
    if (m.role === "user") return { role: "user", text: join(m.parts) };
    if (m.role === "assistant") {
      const out: LlmMessage = { role: "assistant" };
      if (m.parts && m.parts.length > 0) out.text = join(m.parts);
      if (m.toolCalls) out.toolCalls = m.toolCalls.map((c) => ({ ...c }));
      if (m.providerState !== undefined) out.providerState = m.providerState;
      return out;
    }
    const out: LlmMessage = { role: "tool", toolCallId: m.toolCallId, name: m.name, content: join(m.parts) };
    if (m.isError !== undefined) out.isError = m.isError;
    return out;
  });
  return seal(join(input.system), messages, input.tools.map((t) => ({ ...t })), dataAccess);
}

export function isOutboundRequest(x: unknown): x is OutboundRequest {
  return typeof x === "object" && x !== null && registry.has(x);
}

/** For decorators (json-action fallback): derive a NEW branded request from a branded one.
 *  `appendSystem` parts are class-checked like buildOutboundRequest; `rewriteMessages` may only re-shape
 *  already-admitted content. Throws if `base` is not branded. */
export function deriveOutboundRequest(
  base: OutboundRequest,
  change: {
    appendSystem?: OutboundPart[];
    tools?: ToolSpec[];
    rewriteMessages?: (m: readonly LlmMessage[]) => LlmMessage[];
  },
): OutboundRequest {
  if (!isOutboundRequest(base)) throw new Error("deriveOutboundRequest: base is not an OutboundRequest");
  check(change.appendSystem, base.dataAccess);
  const system = change.appendSystem && change.appendSystem.length > 0
    ? [base.system, join(change.appendSystem)].filter((s) => s !== "").join("\n")
    : base.system;
  const messages = change.rewriteMessages ? change.rewriteMessages(base.messages) : [...base.messages];
  const tools = change.tools ?? [...base.tools];
  return seal(system, structuredClone(messages), structuredClone(tools), base.dataAccess);
}
