// 142 UAT (Ollama): Node's fetch gives up after 300 s without response headers, and a local model on CPU sends none
// until it has read the whole prompt. Provider calls use their own dispatcher with undici's timeouts off; the agent
// loop's abort signal (AI_TIMEOUT_MS) is the only deadline.
import { Agent } from "undici";

export const AI_PROVIDER_AGENT_OPTIONS = { headersTimeout: 0, bodyTimeout: 0 } as const;
export const aiProviderDispatcher = new Agent(AI_PROVIDER_AGENT_OPTIONS);

/** globalThis.fetch is read per call, so test stubs still apply. */
export const providerFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, dispatcher: aiProviderDispatcher } as RequestInit);
