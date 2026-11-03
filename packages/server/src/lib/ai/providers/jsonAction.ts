// JSON action-plan fallback (AI_TOOL_MODE=json). Decorates any provider that lacks reliable native tool calling:
// tools are rendered into a (class `system`) prompt part, the model replies with ONE JSON object, and we emit the
// normal tool_call / text_delta events so the agent loop is unchanged. Parsing is tolerant but never evaluates code.
import { deriveOutboundRequest, isOutboundRequest, part, type OutboundRequest } from "../outbound";
import type { Capabilities, LlmEvent, LlmMessage, LlmProvider, ToolSpec } from "../provider";

/** Strip ``` fences, then return the first balanced `{...}` that JSON.parses to a plain object. */
export function extractFirstJsonObject(text: string): unknown | undefined {
  const s = text.replace(/```[a-zA-Z0-9_-]*/g, " ");
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const v: unknown = JSON.parse(s.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v;
        } catch {
          /* not JSON; try the next opening brace */
        }
        break;
      }
    }
  }
  return undefined;
}

/** null means "not given": small models fill every optional field with null, which the strict tool schemas reject. */
function withoutNulls(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== null) out[k] = v;
  return out;
}

/**
 * The tool call in a reply: the documented {"tool","args"} shape, or (142-11 Ollama UAT: qwen2.5 wrote
 * {"add_widget":{...}}) a single key that is one of THIS request's tool names with an object value.
 */
function toolCallOf(obj: Record<string, unknown>, toolNames: ReadonlySet<string>): { name: string; args: Record<string, unknown> } | undefined {
  const isArgs = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (typeof obj.tool === "string" && obj.tool !== "") return { name: obj.tool, args: withoutNulls(isArgs(obj.args) ? obj.args : {}) };
  const keys = Object.keys(obj);
  if (keys.length === 1 && toolNames.has(keys[0]) && isArgs(obj[keys[0]])) return { name: keys[0], args: withoutNulls(obj[keys[0]] as Record<string, unknown>) };
  return undefined;
}

function renderTools(tools: readonly ToolSpec[]): string {
  const lines = [
    "You can use tools. Reply with EXACTLY ONE JSON object and nothing else:",
    '{"tool":"<name>","args":{...}} to call a tool, or {"final":"<text>"} to give your final answer.',
    "Available tools:",
  ];
  for (const t of tools) lines.push(`- ${t.name}: ${t.description}\n  args JSON schema: ${JSON.stringify(t.jsonSchema)}`);
  return lines.join("\n");
}

function rewrite(messages: readonly LlmMessage[]): LlmMessage[] {
  return messages.map((m): LlmMessage => {
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const sent = m.toolCalls
        .map((c) => {
          let args: unknown = {};
          try {
            args = JSON.parse(c.argsJson);
          } catch {
            /* keep {} */
          }
          return JSON.stringify({ tool: c.name, args });
        })
        .join("\n");
      return { role: "assistant", text: sent };
    }
    if (m.role === "assistant") return m.text !== undefined ? { role: "assistant", text: m.text } : { role: "assistant" };
    if (m.role === "tool") return { role: "user", text: `Tool result (${m.name}): ${m.content}` };
    return m;
  });
}

const CAPS = (inner: Capabilities): Capabilities => ({
  ...inner,
  nativeTools: false,
  parallelTools: false,
  forcedToolChoice: false,
  opaqueReplay: false,
});

export function createJsonActionProvider(inner: LlmProvider): LlmProvider {
  let n = 0;
  return {
    id: `json-action(${inner.id})`,
    model: inner.model,
    capabilities: CAPS(inner.capabilities),
    async *complete(req: OutboundRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
      if (!isOutboundRequest(req)) throw new Error("json-action provider: request is not an OutboundRequest");
      const derived = deriveOutboundRequest(req, {
        appendSystem: [part.system(renderTools(req.tools))],
        tools: [],
        rewriteMessages: rewrite,
      });
      let text = "";
      for await (const ev of inner.complete(derived, signal)) {
        if (ev.type === "text_delta") {
          text += ev.text;
        } else if (ev.type === "done") {
          const obj = extractFirstJsonObject(text) as Record<string, unknown> | undefined;
          const call = obj ? toolCallOf(obj, new Set(req.tools.map((t) => t.name))) : undefined;
          if (call) {
            yield { type: "tool_call", id: `json_call_${++n}`, name: call.name, argsRaw: JSON.stringify(call.args) };
            yield { type: "done", finish: "tool_calls" };
          } else if (obj && typeof obj.final === "string") {
            if (obj.final !== "") yield { type: "text_delta", text: obj.final };
            yield { type: "done", finish: "stop" };
          } else {
            if (text !== "") yield { type: "text_delta", text };
            yield { type: "done", finish: ev.finish === "tool_calls" ? "stop" : ev.finish };
          }
          return;
        } else {
          yield ev; // usage / error / any inner tool_call pass through unchanged
          if (ev.type === "error") return;
        }
      }
    },
  };
}
