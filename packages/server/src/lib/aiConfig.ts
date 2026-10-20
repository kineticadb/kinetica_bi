// Phase 133 (AIPRV-V20-01, D-05..D-10): AI env config. Never calls process exit, never throws, never performs network I/O, never logs a key or a raw value.
import { AI_CONTRACT_VERSION } from "./aiContract";

export type AiProvider = "openai-compatible" | "claude";
export type AiDataAccess = "schema" | "query";
export type AiToolMode = "native" | "json";
export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  dataAccess: AiDataAccess;
  maxToolSteps: number;
  timeoutMs: number;
  maxAnswersPerUserPerHour: number; // 0 = no cap (D-12)
  maxAnswersPerDay: number; // whole deployment, rolling 24 h; 0 = off (D-13)
  historyTurns: number; // recent exchanges sent in full (D-05)
  toolMode: AiToolMode;
  maxNewWidgets: number; // D-09: new widgets per answer
  dvMaxRecords: number; // 139 D-04 ceiling; a view may ask for less, never more
  dvMaxJoins: number; // 139 D-07
  dvMaxPerSession: number; // 139 D-14 (AI views, not their filter re-materializations)
  dvPreflightTimeoutMs: number; // 139 D-08 server deadline for preflight + CREATE
  readonly apiKey?: string;
};
export type AiConfigResult =
  | { enabled: false; reason: "not_enabled" }
  | { enabled: false; reason: "invalid"; errors: string[] }
  | { enabled: true; config: AiConfig };

type Env = Record<string, string | undefined>;

const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

const val = (env: Env, name: string): string => (env[name] ?? "").trim();

const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const parseIntInRange = (raw: string, def: number, min: number, max: number): number | null => {
  if (raw === "") return def;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
};

export function parseAiConfig(env: Env): AiConfigResult {
  const enabledRaw = val(env, "AI_ENABLED").toLowerCase();
  if (enabledRaw === "" || enabledRaw === "false") return { enabled: false, reason: "not_enabled" };
  if (enabledRaw !== "true") {
    return { enabled: false, reason: "invalid", errors: ["AI_ENABLED must be 'true' or 'false'"] };
  }

  const errors: string[] = [];

  const providerRaw = val(env, "AI_PROVIDER");
  let provider: AiProvider | null = null;
  if (providerRaw === "") errors.push("AI_PROVIDER is missing");
  else if (providerRaw === "openai-compatible" || providerRaw === "claude") provider = providerRaw;
  else {
    errors.push(
      "AI_PROVIDER must be 'openai-compatible' or 'claude'" +
        (providerRaw.toLowerCase() === "anthropic" ? " (did you mean 'claude'?)" : ""),
    );
  }

  const model = val(env, "AI_MODEL");
  if (model === "") errors.push("AI_MODEL is missing");

  const key = val(env, "AI_API_KEY");
  let baseUrl = val(env, "AI_BASE_URL");
  if (baseUrl === "") {
    if (provider === "openai-compatible") errors.push("AI_BASE_URL is missing (required for AI_PROVIDER=openai-compatible)");
    else if (provider === "claude") baseUrl = CLAUDE_DEFAULT_BASE_URL;
  } else if (!isHttpUrl(baseUrl)) {
    errors.push("AI_BASE_URL is not a valid http(s) URL");
  }
  if (provider === "claude" && key === "") errors.push("AI_API_KEY is missing (required for AI_PROVIDER=claude)");

  const dataAccessRaw = val(env, "AI_DATA_ACCESS");
  let dataAccess: AiDataAccess = "schema";
  if (dataAccessRaw === "query" || dataAccessRaw === "schema") dataAccess = dataAccessRaw;
  else if (dataAccessRaw !== "") errors.push("AI_DATA_ACCESS must be 'schema' or 'query'");

  const maxToolSteps = parseIntInRange(val(env, "AI_MAX_TOOL_STEPS"), 8, 1, 50);
  if (maxToolSteps === null) errors.push("AI_MAX_TOOL_STEPS must be an integer from 1 to 50");
  const timeoutMs = parseIntInRange(val(env, "AI_TIMEOUT_MS"), 60000, 1000, 600000);
  if (timeoutMs === null) errors.push("AI_TIMEOUT_MS must be an integer from 1000 to 600000");

  const maxAnswersPerUserPerHour = parseIntInRange(val(env, "AI_MAX_ANSWERS_PER_USER_PER_HOUR"), 30, 0, 100000);
  if (maxAnswersPerUserPerHour === null) errors.push("AI_MAX_ANSWERS_PER_USER_PER_HOUR must be an integer from 0 to 100000");
  const maxAnswersPerDay = parseIntInRange(val(env, "AI_MAX_ANSWERS_PER_DAY"), 0, 0, 1000000);
  if (maxAnswersPerDay === null) errors.push("AI_MAX_ANSWERS_PER_DAY must be an integer from 0 to 1000000");
  const historyTurns = parseIntInRange(val(env, "AI_HISTORY_TURNS"), 6, 1, 20);
  if (historyTurns === null) errors.push("AI_HISTORY_TURNS must be an integer from 1 to 20");
  const maxNewWidgets = parseIntInRange(val(env, "AI_MAX_NEW_WIDGETS"), 6, 1, 30);
  if (maxNewWidgets === null) errors.push("AI_MAX_NEW_WIDGETS must be an integer from 1 to 30");
  const dvMaxRecords = parseIntInRange(val(env, "AI_DV_MAX_RECORDS"), 100000, 1, 10000000);
  if (dvMaxRecords === null) errors.push("AI_DV_MAX_RECORDS must be an integer from 1 to 10000000");
  const dvMaxJoins = parseIntInRange(val(env, "AI_DV_MAX_JOINS"), 2, 0, 4);
  if (dvMaxJoins === null) errors.push("AI_DV_MAX_JOINS must be an integer from 0 to 4");
  const dvMaxPerSession = parseIntInRange(val(env, "AI_DV_MAX_PER_SESSION"), 5, 1, 20);
  if (dvMaxPerSession === null) errors.push("AI_DV_MAX_PER_SESSION must be an integer from 1 to 20");
  const dvPreflightTimeoutMs = parseIntInRange(val(env, "AI_DV_PREFLIGHT_TIMEOUT_MS"), 30000, 1000, 600000);
  if (dvPreflightTimeoutMs === null) errors.push("AI_DV_PREFLIGHT_TIMEOUT_MS must be an integer from 1000 to 600000");
  const toolModeRaw = val(env, "AI_TOOL_MODE");
  let toolMode: AiToolMode = "native";
  if (toolModeRaw === "native" || toolModeRaw === "json") toolMode = toolModeRaw;
  else if (toolModeRaw !== "") errors.push("AI_TOOL_MODE must be 'native' or 'json'");

  if (errors.length > 0 || provider === null || maxToolSteps === null || timeoutMs === null ||
    maxAnswersPerUserPerHour === null || maxAnswersPerDay === null || historyTurns === null || maxNewWidgets === null ||
    dvMaxRecords === null || dvMaxJoins === null || dvMaxPerSession === null || dvPreflightTimeoutMs === null) {
    return { enabled: false, reason: "invalid", errors };
  }

  const config: AiConfig = {
    provider, baseUrl, model, dataAccess, maxToolSteps, timeoutMs,
    maxAnswersPerUserPerHour, maxAnswersPerDay, historyTurns, toolMode, maxNewWidgets,
    dvMaxRecords, dvMaxJoins, dvMaxPerSession, dvPreflightTimeoutMs,
  };
  if (key !== "") Object.defineProperty(config, "apiKey", { value: key, enumerable: false, writable: false });
  return { enabled: true, config };
}

export function formatAiConfigLog(result: AiConfigResult): string | null {
  if (result.enabled) {
    const c = result.config;
    return (
      `[ai] AI enabled: provider=${c.provider} model=${c.model} endpoint=${new URL(c.baseUrl).origin} ` +
      `dataAccess=${c.dataAccess} maxToolSteps=${c.maxToolSteps} timeoutMs=${c.timeoutMs} ` +
      `capPerHour=${c.maxAnswersPerUserPerHour === 0 ? "off" : c.maxAnswersPerUserPerHour} ` +
      `capPerDay=${c.maxAnswersPerDay === 0 ? "off" : c.maxAnswersPerDay} ` +
      `historyTurns=${c.historyTurns} maxNewWidgets=${c.maxNewWidgets} toolMode=${c.toolMode} ` +
      `dvMaxRecords=${c.dvMaxRecords} dvMaxJoins=${c.dvMaxJoins} dvMaxPerSession=${c.dvMaxPerSession} ` +
      `key=${c.apiKey ? "set" : "not set"} contract=${AI_CONTRACT_VERSION}`
    );
  }
  if (result.reason === "not_enabled") return null;
  return `[ai] AI is DISABLED — invalid configuration: ${result.errors.join("; ")}. The app is running without AI.`;
}

let current: AiConfigResult = { enabled: false, reason: "not_enabled" };

export function loadAiConfig(env: Env = process.env): AiConfigResult {
  const result = parseAiConfig(env);
  const line = formatAiConfigLog(result);
  if (line !== null) {
    if (result.enabled) console.log(line);
    else console.error(line);
  }
  current = result;
  return result;
}

export function getAiConfig(): AiConfigResult {
  return current;
}
