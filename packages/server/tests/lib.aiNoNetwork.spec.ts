import { describe, it, expect, afterEach, vi } from "vitest";
import { forbidProviderNetwork, ProviderNetworkForbidden } from "./helpers/aiTestKit";

const NAMES = [
  "AI_ENABLED", "AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY", "AI_DATA_ACCESS", "AI_MAX_TOOL_STEPS", "AI_TIMEOUT_MS",
  "AI_MAX_ANSWERS_PER_USER_PER_HOUR", "AI_MAX_ANSWERS_PER_DAY", "AI_HISTORY_TURNS", "AI_TOOL_MODE", "AI_AUDIT_RETENTION_DAYS",
];

afterEach(() => vi.unstubAllGlobals());

describe("AI test isolation", () => {
  it("NET-1: every AI_* env name is blanked by setup", () => {
    expect(NAMES).toHaveLength(13);
    for (const n of NAMES) expect(process.env[n], n).toBe("");
  });

  it("NET-2: provider hosts are unreachable", async () => {
    forbidProviderNetwork();
    for (const u of [
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://api.anthropic.com/v1/messages",
      "http://localhost:11434/v1/chat/completions",
    ]) {
      await expect(fetch(u)).rejects.toBeInstanceOf(ProviderNetworkForbidden);
    }
  });

  it("NET-3: positive control - allowed hosts delegate to the inner mock", async () => {
    const inner = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    forbidProviderNetwork(inner, { allowHosts: ["provider.test"] });
    expect(await (await fetch("https://kinetica.test:9191/x")).text()).toBe("ok");
    expect(await (await fetch("https://provider.test/v1/chat/completions")).text()).toBe("ok");
    vi.unstubAllGlobals();
    forbidProviderNetwork(inner);
    await expect(fetch("https://provider.test/v1/chat/completions")).rejects.toBeInstanceOf(ProviderNetworkForbidden);
  });
});
