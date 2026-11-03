/**
 * Pure helper — compose the deterministic Kinetica view name for a saved
 * dynamic view. Shape locked by Phase 32 context § D7:
 *
 *   _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
 *
 * No session-short suffix (mirrors filter-view naming) and no hash salt
 * (dynamic_view_id is unique per dashboard; CREATE OR REPLACE handles
 * cache-busting on SQL edit — the phase context D7).
 *
 * Pure module — reuses `sanitizeForViewName` from viewNaming.ts so the
 * sanitization rule is in exactly one place (single source of truth).
 */
import { sanitizeForViewName } from "./viewNaming";

export type DynamicViewNameArgs = {
  userId: string;
  dashboardId: number;
  dynamicViewId: number;
};

export function buildDynamicViewName(args: DynamicViewNameArgs): string {
  const u = sanitizeForViewName(args.userId);
  return `_kbi_dv_u${u}_d${args.dashboardId}_${args.dynamicViewId}`;
}
