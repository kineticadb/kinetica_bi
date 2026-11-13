// 152: who the per-dashboard Viewer AI setting applies to. ONE copy of the server "can edit" rule for AI;
// mirrors aiKeepRoutes.ts (dashboards:edit, or the caller's own unkept build + dashboards:create).
// Callers must have run canViewDashboard first: a pending dashboard is visible only to its creator.
import { DEFAULT_VIEWER_AI_MODE, type ViewerAiMode } from "@kinetica-bi/shared";
import { getDashboard, getGeneratedPending } from "../db";
import { getEffectivePermissions } from "./rbacDb";
import { PERMISSIONS } from "./permissions";

export function resolveViewerAi(username: string, dashboardId: number): { mode: ViewerAiMode; restricted: boolean } {
  const mode = getDashboard(dashboardId)?.viewer_ai ?? DEFAULT_VIEWER_AI_MODE;
  const perms = getEffectivePermissions(username);
  const canEdit = perms.has(PERMISSIONS.DASHBOARDS_EDIT) || (getGeneratedPending(dashboardId) != null && perms.has(PERMISSIONS.DASHBOARDS_CREATE));
  return { mode, restricted: !canEdit };
}
