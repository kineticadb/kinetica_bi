// Phase 135-10: provider selection. Built from an AiConfig object ONLY (never process.env).
// The api key (a non-enumerable getter on the config) is read here solely to hand it to the adapter constructor.
import type { AiConfig } from "../../aiConfig";
import type { LlmProvider } from "../provider";
import { createOpenAiCompatProvider } from "./openaiCompat";
import { createClaudeProvider } from "./claude";
import { createJsonActionProvider } from "./jsonAction";

export type AiProviderFactory = (config: AiConfig) => LlmProvider;

export function createProviderFromConfig(config: AiConfig): LlmProvider {
  const inner: LlmProvider =
    config.provider === "claude"
      ? createClaudeProvider({ baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey ?? "" })
      : createOpenAiCompatProvider({ baseUrl: config.baseUrl, model: config.model, ...(config.apiKey ? { apiKey: config.apiKey } : {}) });
  return config.toolMode === "json" ? createJsonActionProvider(inner) : inner;
}

let override: AiProviderFactory | null = null;

export function getAiProviderFactory(): AiProviderFactory {
  return override ?? createProviderFromConfig;
}

/** TEST seam: route specs inject scripted providers. null restores the default. */
export function __setAiProviderFactoryForTest(f: AiProviderFactory | null): void {
  override = f;
}
