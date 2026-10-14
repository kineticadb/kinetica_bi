import type { AskRequest, AskStreamEvent } from "@kinetica-bi/shared";
import { askAi } from "../../api/client";
// Ported from packages/server/src/lib/ai/sseParse.ts; keep in sync.
// Phase 137: server -> browser SSE framing (WHATWG field rules; only `event` and `data` are used).
export type SseEvent = { event?: string; data: string };

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let event: string | undefined;
  let data: string[] = [];
  let hasData = false;

  const abortErr = () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    return e;
  };
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const flush = (): SseEvent | null => {
    const out = hasData ? { event, data: data.join("\n") } : null;
    event = undefined;
    data = [];
    hasData = false;
    return out;
  };
  const handleLine = (line: string): SseEvent | null => {
    if (line === "") return flush();
    if (line.startsWith(":")) return null;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? "" : line.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") {
      data.push(value);
      hasData = true;
    }
    return null;
  };

  try {
    if (signal?.aborted) throw abortErr();
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortErr();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      const re = /\r\n|\n|\r/;
      while ((m = re.exec(buf)) !== null) {
        // a lone trailing \r may be the first half of \r\n; wait for more input
        if (m[0] === "\r" && m.index === buf.length - 1) break;
        const line = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const ev = handleLine(line);
        if (ev) yield ev;
      }
    }
    buf += decoder.decode();
    if (buf !== "") {
      for (const line of buf.split(/\r\n|\n|\r/)) {
        const ev = handleLine(line);
        if (ev) yield ev;
      }
    }
    const last = flush();
    if (last) yield last;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* pending read after cancel; ignore */
    }
  }
}

const KNOWN_EVENTS = new Set(["status", "step", "result", "error", "done"]);

export class AskHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AskHttpError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** For the runner: the stream ended with neither a result nor an error event. */
export const AI_CONNECTION_LOST = {
  code: "AI_CONNECTION_LOST",
  message: "Lost connection to the AI. Nothing was changed.",
} as const;

async function toAskHttpError(res: Response): Promise<AskHttpError> {
  let j: { message?: unknown; error?: unknown; code?: unknown; retryAfterSeconds?: unknown } = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") j = parsed as typeof j;
  } catch {
    /* non-JSON body */
  }
  const message =
    typeof j.message === "string" ? j.message : typeof j.error === "string" ? j.error : "The AI request failed.";
  const code = typeof j.code === "string" ? j.code : `HTTP_${res.status}`;
  const retry = typeof j.retryAfterSeconds === "number" ? j.retryAfterSeconds : undefined;
  return new AskHttpError(res.status, code, message, retry);
}

export async function* streamAsk(body: AskRequest, signal: AbortSignal): AsyncGenerator<AskStreamEvent> {
  const res = await askAi(body, signal);
  if (!res.ok) throw await toAskHttpError(res);
  if (!res.body) return;
  for await (const ev of parseSseStream(res.body, signal)) {
    if (!ev.event || !KNOWN_EVENTS.has(ev.event)) continue;
    let data: unknown;
    try {
      data = JSON.parse(ev.data);
    } catch {
      continue;
    }
    yield { event: ev.event, data } as AskStreamEvent;
  }
}
