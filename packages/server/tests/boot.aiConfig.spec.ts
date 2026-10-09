import { describe, it, expect, vi, afterEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { getAiConfig } from "../src/lib/aiConfig";

const lines = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => c.map(String).join(" "));

const setup = () => ({
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  err: vi.spyOn(console, "error").mockImplementation(() => {}),
  exit: vi.spyOn(process, "exit").mockImplementation((() => undefined) as never),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI boot wiring", () => {
  it("AIBOOT-1: no AI_* -> silent, not_enabled", async () => {
    const s = setup();
    await buildTestApp();
    const all = [...lines(s.log), ...lines(s.warn), ...lines(s.err)];
    expect(all.filter((l) => l.includes("[ai]"))).toEqual([]);
    expect(getAiConfig()).toEqual({ enabled: false, reason: "not_enabled" });
  });

  it("AIBOOT-2: bad config -> app boots, AI disabled, key never logged, no exit", async () => {
    const s = setup();
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openai-compatible");
    vi.stubEnv("AI_MODEL", "m");
    vi.stubEnv("AI_BASE_URL", "not-a-url");
    vi.stubEnv("AI_API_KEY", "sk-test-SENTINEL");
    const app = await buildTestApp();
    const res = await app.get("/api/health");
    expect(res.status).toBe(200);
    const errs = lines(s.err).filter((l) => l.includes("AI is DISABLED"));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("AI_BASE_URL is not a valid http(s) URL");
    expect([...lines(s.log), ...lines(s.warn), ...lines(s.err)].join("\n")).not.toContain("SENTINEL");
    expect(s.exit).not.toHaveBeenCalled();
    expect(getAiConfig().enabled).toBe(false);
  });

  it("AIBOOT-3: valid config -> enabled line, no provider call at boot", async () => {
    const s = setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openai-compatible");
    vi.stubEnv("AI_MODEL", "m");
    vi.stubEnv("AI_BASE_URL", "https://ai-sentinel.invalid/v1");
    await buildTestApp();
    expect(lines(s.log).filter((l) => l.includes("[ai] AI enabled"))).toHaveLength(1);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes("ai-sentinel.invalid"))).toEqual([]);
    vi.unstubAllGlobals();
  });
});
