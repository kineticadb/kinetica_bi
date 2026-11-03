// 142 UAT (Ollama): provider calls must not inherit Node fetch's 300 s headers timeout; AI_TIMEOUT_MS is the only deadline.
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { createOpenAiCompatProvider } from "../src/lib/ai/providers/openaiCompat";
import { createClaudeProvider } from "../src/lib/ai/providers/claude";
import { AI_PROVIDER_AGENT_OPTIONS, aiProviderDispatcher, providerFetch } from "../src/lib/ai/providers/providerFetch";
import { buildOutboundRequest, part } from "../src/lib/ai/outbound";
import type { LlmEvent } from "../src/lib/ai/provider";

const req = () =>
  buildOutboundRequest({ system: [part.system("s")], messages: [{ role: "user", parts: [part.user("hi")] }], tools: [], dataAccess: "schema" });

async function drain(it: AsyncIterable<LlmEvent>): Promise<void> {
  for await (const _ of it) void _;
}

function stubFetch() {
  const inits: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
    inits.push(init ?? {});
    return new Response("{}", { status: 500 });
  }));
  return inits;
}

afterEach(() => vi.unstubAllGlobals());

describe("PFETCH: provider calls use the AI dispatcher", () => {
  it("PFETCH-1 the AI dispatcher has undici's headers and body timeouts off", () => {
    expect(AI_PROVIDER_AGENT_OPTIONS).toEqual({ headersTimeout: 0, bodyTimeout: 0 });
    expect(aiProviderDispatcher).toBeInstanceOf(Agent);
  });

  it("PFETCH-2 OpenAI-compatible default fetch passes the AI dispatcher (and still the caller's signal)", async () => {
    const inits = stubFetch();
    const ctl = new AbortController();
    await drain(createOpenAiCompatProvider({ baseUrl: "https://p.test/v1", model: "m" }).complete(req(), ctl.signal));
    expect(inits).toHaveLength(1);
    expect((inits[0] as { dispatcher?: unknown }).dispatcher).toBe(aiProviderDispatcher);
    expect(inits[0]!.signal).toBe(ctl.signal);
  });

  it("PFETCH-3 Claude default fetch passes the AI dispatcher", async () => {
    const inits = stubFetch();
    await drain(createClaudeProvider({ baseUrl: "https://c.test/v1", model: "m", apiKey: "k" }).complete(req(), new AbortController().signal));
    expect(inits).toHaveLength(1);
    expect((inits[0] as { dispatcher?: unknown }).dispatcher).toBe(aiProviderDispatcher);
  });

  it("PFETCH-4 Node's fetch honours the dispatcher: a short headers timeout fails, providerFetch waits", { timeout: 15_000 }, async () => {
    const server = http.createServer((_req, res) => setTimeout(() => res.end("ok"), 2500));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const short = new Agent({ headersTimeout: 1000 }); // undici timers are coarse (~0.5 s ticks)
      await expect(fetch(url, { dispatcher: short } as RequestInit)).rejects.toMatchObject({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
      await short.close();
      const res = await providerFetch(url);
      expect(await res.text()).toBe("ok");
    } finally {
      server.close();
    }
  });
});
