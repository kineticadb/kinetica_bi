// 152: who the per-dashboard Viewer AI setting applies to. ONE copy of the server "can edit" rule for AI;
// mirrors aiKeepRoutes.ts (dashboards:edit, or the caller's own unkept build + dashboards:create).
// Callers must have run canViewDashboard first: a pending dashboard is visible only to its creator.
import { DEFAULT_VIEWER_AI_MODE, VIEWER_AI_AF_REASON, VIEWER_AI_OFF_REASON, type ViewerAiMode } from "@kinetica-bi/shared";
import { getDashboard, getGeneratedPending } from "../db";
import { getEffectivePermissions } from "./rbacDb";
import { PERMISSIONS } from "./permissions";

export function resolveViewerAi(username: string, dashboardId: number): { mode: ViewerAiMode; restricted: boolean } {
  const mode = getDashboard(dashboardId)?.viewer_ai ?? DEFAULT_VIEWER_AI_MODE;
  const perms = getEffectivePermissions(username);
  const canEdit = perms.has(PERMISSIONS.DASHBOARDS_EDIT) || (getGeneratedPending(dashboardId) != null && perms.has(PERMISSIONS.DASHBOARDS_CREATE));
  return { mode, restricted: !canEdit };
}

export type ViewerAiToolClass = "read" | "filter" | "change";
/** 152: EVERY registered tool must be listed (classification spec fails otherwise). Phase 153 classifies its tools here at birth. */
export const VIEWER_AI_TOOL_CLASS: Readonly<Record<string, ViewerAiToolClass>> = {
  get_dashboard: "read", list_tables: "read", describe_table: "read", run_query: "read", get_column_profile: "read",
  apply_filter: "filter", clear_filter: "filter",
  add_widget: "change", edit_widget: "change", rename_widget: "change", change_widget_type: "change", set_layout: "change",
  add_heatmap_layer: "change", edit_heatmap_layer: "change", set_layer_visibility: "change", patch: "change",
  add_dynamic_view: "change", remove_widget: "change", remove_layer: "change", remove_dynamic_view: "change",
};
export const VIEWER_AF_ALLOWED_OPS: ReadonlySet<string> = new Set(["apply_filter", "clear_filter"]);
export const VIEWER_AF_REFUSED_OPS: ReadonlySet<string> = new Set(["patch", "add_widget", "remove_widget", "add_layer", "remove_layer", "add_dynamic_view", "remove_dynamic_view", "set_layout", "change_widget_type", "set_widget_title"]);

/** Default-deny: an unknown tool is refused for a restricted user in Answers and filters (and everything in Off). */
export function isToolAllowedForViewerMode(name: string, mode: ViewerAiMode): boolean {
  if (mode === "session_only") return true;
  if (mode === "off") return false;
  const c = Object.prototype.hasOwnProperty.call(VIEWER_AI_TOOL_CLASS, name) ? VIEWER_AI_TOOL_CLASS[name] : undefined;
  return c === "read" || c === "filter";
}
/** Default-deny for ops too (covers ops a later phase adds). */
export function isOpAllowedForViewerMode(op: string, mode: ViewerAiMode): boolean {
  if (mode === "session_only") return true;
  if (mode === "off") return false;
  return VIEWER_AF_ALLOWED_OPS.has(op);
}
export function viewerAiRefusalReason(mode: ViewerAiMode): string {
  return mode === "off" ? VIEWER_AI_OFF_REASON : VIEWER_AI_AF_REASON;
}
export const VIEWER_AI_AF_PART =
  "This dashboard's Viewer AI setting is Answers and filters. For this user you may only answer questions about the data and apply or clear filters. You must not add, edit, rename, move, remove or change charts, map layers or views, even if asked; the tools for that are not available. If the user asks for such a change, say plainly that this dashboard lets the AI answer questions and apply filters, not change charts, layers or views (for example: \"This dashboard lets the AI answer questions and apply filters, not add charts.\"), then help with what you can: answer in text, or apply a filter that shows what they wanted. Never claim a change was made. If a call is refused with \"Viewer AI: answers and filters only\", do not retry it.";
