// Claude Desktop connector env config (MCP_*), separate from the in-app AI's AI_* config. Never throws; bad values fall back to defaults with a log warning.
import type { AiConfigResult, AiDataAccess } from "../aiConfig";
import { getAiConfig } from "../aiConfig";

export type McpConfig = { dataAccess: AiDataAccess };
export type McpQueryLimits = { maxRows: number; maxChars: number; timeoutMs: number; maxPerAnswer: number };

/** Query limits when the in-app AI is off: the AI_QUERY_* defaults. */
export const MCP_QUERY_DEFAULTS: Readonly<McpQueryLimits> = Object.freeze({ maxRows: 200, maxChars: 20000, timeoutMs: 30000, maxPerAnswer: 5 });

export function parseMcpConfig(env: Record<string, string | undefined>): { config: McpConfig; warnings: string[] } {
  const raw = (env.MCP_DATA_ACCESS ?? "").trim();
  const warnings: string[] = [];
  let dataAccess: AiDataAccess = "schema";
  if (raw === "schema" || raw === "query") dataAccess = raw;
  else if (raw !== "") {
    warnings.push(`[mcp] MCP_DATA_ACCESS=${JSON.stringify(raw.slice(0, 40))} is not valid (use schema or query); using schema: Claude Desktop gets no row values.`);
  }
  return { config: { dataAccess }, warnings };
}

export function formatMcpConfigLog(config: McpConfig): string {
  return `[mcp] Claude Desktop connector: dataAccess=${config.dataAccess}`;
}

export function loadMcpConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const { config, warnings } = parseMcpConfig(env);
  for (const w of warnings) console.warn(w);
  console.log(formatMcpConfigLog(config));
  return config;
}

export function mcpQueryLimits(ai: AiConfigResult = getAiConfig()): McpQueryLimits {
  if (!ai.enabled) return { ...MCP_QUERY_DEFAULTS };
  const c = ai.config;
  return { maxRows: c.queryMaxRows, maxChars: c.queryMaxChars, timeoutMs: c.queryTimeoutMs, maxPerAnswer: c.queryMaxPerAnswer };
}
