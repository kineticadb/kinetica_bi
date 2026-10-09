import { describe, it, expect } from "vitest";
import { parseAiConfig, formatAiConfigLog } from "../src/lib/aiConfig";

const GEMINI = {
  AI_ENABLED: "true",
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  AI_MODEL: "gemini-2.5-flash",
  AI_API_KEY: "sk-test-SENTINEL",
};
const OLLAMA = {
  AI_ENABLED: "true",
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "http://localhost:11434/v1",
  AI_MODEL: "llama3.1",
};

const errorsOf = (env: Record<string, string>): string[] => {
  const r = parseAiConfig(env);
  if (r.enabled || r.reason !== "invalid") throw new Error("expected invalid, got " + JSON.stringify(r));
  return r.errors;
};

describe("parseAiConfig", () => {
  it("AICFG-1: unset / blank / false -> not_enabled, no log", () => {
    for (const env of [{}, { AI_ENABLED: "" }, { AI_ENABLED: "  " }, { AI_ENABLED: "false" }, { AI_ENABLED: "FALSE" }]) {
      const r = parseAiConfig(env);
      expect(r).toEqual({ enabled: false, reason: "not_enabled" });
      expect(formatAiConfigLog(r)).toBeNull();
    }
  });

  it("AICFG-2: bad AI_ENABLED", () => {
    expect(errorsOf({ AI_ENABLED: "yes" })).toContain("AI_ENABLED must be 'true' or 'false'");
  });

  it("AICFG-3: Gemini config, defaults, key non-enumerable", () => {
    const r = parseAiConfig(GEMINI);
    if (!r.enabled) throw new Error("expected enabled");
    expect(r.config.dataAccess).toBe("schema");
    expect(r.config.maxToolSteps).toBe(8);
    expect(r.config.timeoutMs).toBe(60000);
    expect(Object.keys(r.config)).not.toContain("apiKey");
    expect(r.config.apiKey).toBe("sk-test-SENTINEL");
    expect(JSON.stringify(r)).not.toContain("SENTINEL");
  });

  it("AICFG-4: Ollama without key", () => {
    const r = parseAiConfig(OLLAMA);
    if (!r.enabled) throw new Error("expected enabled");
    expect(r.config.apiKey).toBeUndefined();
    const log = formatAiConfigLog(r)!;
    expect(log).toContain("key=not set");
    expect(log).toContain("endpoint=http://localhost:11434");
  });

  it("AICFG-5: AI_ENABLED case-insensitive", () => {
    expect(parseAiConfig({ ...OLLAMA, AI_ENABLED: "TRUE" }).enabled).toBe(true);
  });

  it("AICFG-6: provider and model errors", () => {
    const base = { AI_ENABLED: "true", AI_BASE_URL: "http://x/v1" };
    expect(errorsOf({ ...base, AI_MODEL: "m" })).toContain("AI_PROVIDER is missing");
    const e = errorsOf({ ...base, AI_MODEL: "m", AI_PROVIDER: "anthropic" });
    expect(e.join(";")).toContain("AI_PROVIDER must be 'openai-compatible' or 'claude'");
    expect(e.join(";")).toContain("did you mean 'claude'?");
    expect(errorsOf({ ...base, AI_PROVIDER: "openai-compatible" })).toContain("AI_MODEL is missing");
  });

  it("AICFG-7: base url rules", () => {
    const { AI_BASE_URL: _u, ...noUrl } = OLLAMA;
    expect(errorsOf(noUrl)).toContain("AI_BASE_URL is missing (required for AI_PROVIDER=openai-compatible)");
    expect(errorsOf({ ...OLLAMA, AI_BASE_URL: "ftp://x" })).toContain("AI_BASE_URL is not a valid http(s) URL");
    expect(errorsOf({ ...OLLAMA, AI_BASE_URL: "not a url" })).toContain("AI_BASE_URL is not a valid http(s) URL");
  });

  it("AICFG-8: claude key + default base url", () => {
    const env = { AI_ENABLED: "true", AI_PROVIDER: "claude", AI_MODEL: "m" };
    expect(errorsOf(env)).toContain("AI_API_KEY is missing (required for AI_PROVIDER=claude)");
    const r = parseAiConfig({ ...env, AI_API_KEY: "k" });
    if (!r.enabled) throw new Error("expected enabled");
    expect(r.config.baseUrl).toBe("https://api.anthropic.com/v1");
  });

  it("AICFG-9: data access, steps, timeout", () => {
    const ok = (extra: Record<string, string>) => parseAiConfig({ ...OLLAMA, ...extra });
    const r1 = ok({ AI_DATA_ACCESS: "query" });
    if (!r1.enabled) throw new Error("x");
    expect(r1.config.dataAccess).toBe("query");
    expect(errorsOf({ ...OLLAMA, AI_DATA_ACCESS: "rows" })).toContain("AI_DATA_ACCESS must be 'schema' or 'query'");
    for (const v of ["0", "51", "2.5", "abc"])
      expect(errorsOf({ ...OLLAMA, AI_MAX_TOOL_STEPS: v })).toContain("AI_MAX_TOOL_STEPS must be an integer from 1 to 50");
    const r2 = ok({ AI_MAX_TOOL_STEPS: "50" });
    if (!r2.enabled) throw new Error("x");
    expect(r2.config.maxToolSteps).toBe(50);
    for (const v of ["999", "600001", "1e3x"])
      expect(errorsOf({ ...OLLAMA, AI_TIMEOUT_MS: v })).toContain("AI_TIMEOUT_MS must be an integer from 1000 to 600000");
    const r3 = ok({ AI_TIMEOUT_MS: "1000" });
    if (!r3.enabled) throw new Error("x");
    expect(r3.config.timeoutMs).toBe(1000);
  });

  it("AICFG-10: all errors collected", () => {
    const e = errorsOf({ AI_ENABLED: "true", AI_PROVIDER: "x", AI_DATA_ACCESS: "rows", AI_MAX_TOOL_STEPS: "0", AI_TIMEOUT_MS: "1" });
    expect(e.length).toBeGreaterThanOrEqual(5);
  });

  it("AICFG-11: redaction", () => {
    const url = "https://user:sk-test-SENTINEL@host/v1?key=sk-test-SENTINEL";
    const bad = parseAiConfig({ ...OLLAMA, AI_BASE_URL: url, AI_API_KEY: "sk-test-SENTINEL", AI_DATA_ACCESS: "rows" });
    expect(bad.enabled).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("SENTINEL");
    expect(formatAiConfigLog(bad)).not.toContain("SENTINEL");
    const bad2 = parseAiConfig({ AI_ENABLED: "true", AI_PROVIDER: "claude", AI_BASE_URL: "nope", AI_API_KEY: "sk-test-SENTINEL" });
    expect(JSON.stringify(bad2)).not.toContain("SENTINEL");
    expect(formatAiConfigLog(bad2)).not.toContain("SENTINEL");
    const good = parseAiConfig({ ...OLLAMA, AI_BASE_URL: url, AI_API_KEY: "sk-test-SENTINEL" });
    const log = formatAiConfigLog(good)!;
    expect(log).toContain("endpoint=https://host ");
    expect(log).not.toContain("SENTINEL");
  });

  it("AICFG-12: contract version in log", () => {
    expect(formatAiConfigLog(parseAiConfig(OLLAMA))).toContain("contract=v3");
  });
});
