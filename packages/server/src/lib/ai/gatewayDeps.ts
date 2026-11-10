// 150: the gateway deps of one answer; shared by runAnswer and the Approve-first Apply re-check so both check identically.
import { getDashboardDynamicView, listDashboardTables } from "../../db";
import { canViewDashboard } from "../dashboardAccessDb";
import { getEffectivePermissions } from "../rbacDb";
import type { AiConfig } from "../aiConfig";
import type { GatewayDeps } from "./gateway";
import { gatewayDvLimits } from "./dvDeps";
import type { ShadowState } from "./shadow";
import type { LiveSchemaPort } from "./tools/types";

export function buildGatewayDeps(input: {
  username: string;
  dashboardId: number;
  shadow: ShadowState;
  liveSchema: LiveSchemaPort;
  config: AiConfig;
  approvals?: { removeSaved?: boolean };
}): GatewayDeps {
  const { username, dashboardId, shadow, liveSchema, config } = input;
  return {
    username,
    dashboardId,
    shadow,
    liveSchema,
    getPermissions: (u) => getEffectivePermissions(u),
    canViewDashboard: (u, id) => canViewDashboard(u, id),
    dashboardTableIds: () => listDashboardTables(dashboardId).map((t) => t.id),
    approvals: input.approvals,
    aiDv: gatewayDvLimits(config),
    dynamicViewInfo: (id) => {
      const r = getDashboardDynamicView(id);
      return r && r.dashboard_id === dashboardId ? { name: r.name, columns: r.columns_json ?? null, sourceTableId: r.source_table_id } : undefined;
    },
  };
}
