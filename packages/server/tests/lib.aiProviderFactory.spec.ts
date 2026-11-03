// Phase 135-10 Task 1: provider factory selection (PF-).
import { describe, it, expect, afterEach } from "vitest";
import { createProviderFromConfig, getAiProviderFactory, __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import type { AiConfig } from "../src/lib/aiConfig";

const base = (over: Partial<AiConfig> = {}): AiConfig => ({
  provider: "openai-compatible",
  baseUrl: "https://provider.test/v1",
  model: "test-model",
  dataAccess: "schema",
  maxToolSteps: 8,
  timeoutMs: 60000,
  maxAnswersPerUserPerHour: 30,
  maxAnswersPerDay: 0,
  historyTurns: 6,
  toolMode: "native",
  ...over,
});

afterEach(() => {
  __setAiProviderFactoryForTest(null);
  delete process.env.AI_MODEL;
});

describe("provider factory", () => {
  it("PF-1 openai-compatible config yields the openai-compatible provider with the model", () => {
    const p = createProviderFromConfig(base());
    expect(p.id).toBe("openai-compatible");
    expect(p.model).toBe("test-model");
  });
  it("PF-2 claude config yields the claude provider", () => {
    const cfg = base({ provider: "claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-x" });
    Object.defineProperty(cfg, "apiKey", { value: "k", enumerable: false });
    const p = createProviderFromConfig(cfg);
    expect(p.id).toBe("claude");
    expect(p.model).toBe("claude-x");
  });
  it("PF-3 toolMode json wraps the provider in the json-action decorator", () => {
    const p = createProviderFromConfig(base({ toolMode: "json" }));
    expect(p.id).toBe("json-action(openai-compatible)");
  });
  it("PF-4 the test seam swaps the factory and null restores the default", () => {
    const def = getAiProviderFactory();
    const custom = () => createProviderFromConfig(base({ model: "custom" }));
    __setAiProviderFactoryForTest(custom);
    expect(getAiProviderFactory()).toBe(custom);
    __setAiProviderFactoryForTest(null);
    expect(getAiProviderFactory()).toBe(def);
    expect(def).toBe(createProviderFromConfig);
  });
  it("PF-5 never reads process.env: the config model wins over AI_MODEL", () => {
    process.env.AI_MODEL = "from-env";
    expect(createProviderFromConfig(base({ model: "from-config" })).model).toBe("from-config");
  });
});
