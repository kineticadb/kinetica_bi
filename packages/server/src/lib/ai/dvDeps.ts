// 139: the AI dynamic-view limits the gateway enforces, taken from AiConfig (AI_DV_* env). One place so runAnswer and the e2e specs share it.
import type { AiConfig } from "../aiConfig";

export type GatewayDvLimits = { maxRecords: number; maxJoins: number; maxPerSession: number };

export function gatewayDvLimits(config: Pick<AiConfig, "dvMaxRecords" | "dvMaxJoins" | "dvMaxPerSession">): GatewayDvLimits {
  return { maxRecords: config.dvMaxRecords, maxJoins: config.dvMaxJoins, maxPerSession: config.dvMaxPerSession };
}
