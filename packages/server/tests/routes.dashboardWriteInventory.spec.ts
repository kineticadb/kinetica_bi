// 144 (ACCESS-V21-03): every write route is classified for the dashboard visibility check; a new dashboard-scoped write route without it fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/index";
import { DASHBOARD_WRITE_ROUTES } from "./helpers/dashboardWriteKit";

const SHARED_TABLE = "exempt: shared dataset config, not dashboard-scoped";
const RBAC = "exempt: RBAC, not dashboard-scoped";
const READ_ONLY_QUERY = "exempt: read-only Kinetica query over POST";

/** `METHOD /path` -> "view-check" | "exempt: <reason>". A new write route fails DWINV-1 until it is listed here. */
export const DASHBOARD_WRITE_ACCESS: Record<string, string> = {
  // view-check: the 22 routes in the behavioural table (routes.dashboardWriteAccess.spec.ts)
  "PATCH /api/dashboards/:id": "view-check",
  "DELETE /api/dashboards/:id": "view-check",
  "POST /api/dashboards/:id/access": "view-check",
  "DELETE /api/dashboards/:id/access": "view-check",
  "POST /api/dashboards/:id/widgets": "view-check",
  "PATCH /api/widgets/:id": "view-check",
  "DELETE /api/widgets/:id": "view-check",
  "POST /api/dashboards/:id/tables": "view-check",
  "DELETE /api/dashboards/:dashboardId/tables/:tableId": "view-check",
  "POST /api/dashboards/:id/layers": "view-check",
  "PATCH /api/dashboards/:id/layers/reorder": "view-check",
  "PATCH /api/dashboards/:id/layers/:layerId": "view-check",
  "DELETE /api/dashboards/:id/layers/:layerId": "view-check",
  "POST /api/dashboards/:id/views": "view-check",
  "PATCH /api/views/:id": "view-check",
  "DELETE /api/views/:id": "view-check",
  "POST /api/views/:id/materialize": "view-check",
  "POST /api/dashboards/:dashboardId/dynamic-views": "view-check",
  "PUT /api/dynamic-views/:id": "view-check",
  "DELETE /api/dynamic-view/:id": "view-check",
  "POST /api/dashboards/:id/ai-keep": "view-check",
  "POST /api/dashboards/:id/discard-generated": "view-check",

  "POST /api/auth/login": "exempt: auth/session, no dashboard id",
  "POST /api/auth/logout": "exempt: auth/session, no dashboard id",
  "PUT /api/branding": "exempt: branding is global",
  "POST /api/branding/logo": "exempt: branding is global",
  "DELETE /api/branding/logo": "exempt: branding is global",
  "POST /api/dashboards": "exempt: creates a NEW dashboard, no existing id to hide",
  "POST /api/dashboards/import": "exempt: creates a NEW dashboard, no existing id to hide",
  "POST /api/dashboards/generate": "exempt: creates a NEW dashboard, no existing id to hide",
  "POST /api/mcp/token-login": "exempt: the caller's own access token",
  "POST /api/mcp/tokens": "exempt: the caller's own access token",
  "DELETE /api/mcp/tokens/:id": "exempt: the caller's own access token",
  "POST /api/mcp/sessions": "exempt: opens an in-memory session; the route 404s via canViewDashboard before exposing a dashboard",
  "POST /api/mcp/sessions/:id/call": "exempt: the caller's own in-memory session; no dashboard row written (Keep writes)",
  "POST /api/mcp/sessions/:id/finish": "exempt: the caller's own in-memory session; no dashboard row written (Keep writes)",
  "POST /api/ai/ask": "exempt: per-user session/Kinetica view, no dashboard row written",
  "POST /api/ai/dynamic-view/materialize": "exempt: per-user session/Kinetica view, no dashboard row written",
  "POST /api/ai/dynamic-view/drop": "exempt: per-user session/Kinetica view, no dashboard row written",
  "POST /api/dynamic-view/materialize": "exempt: per-user Kinetica view, no dashboard row written",
  "POST /api/dynamic-view/:id/drop": "exempt: per-user Kinetica view, no dashboard row written",
  "POST /api/dynamic-view/preview": "exempt: read-only preview query",
  "POST /api/filter/materialize": "exempt: per-session filter view in Kinetica, no dashboard row written",
  "DELETE /api/filter/materialize": "exempt: per-session filter view in Kinetica, no dashboard row written",
  "POST /api/quantile": READ_ONLY_QUERY,
  "POST /api/top-values": READ_ONLY_QUERY,
  "POST /api/column-stats": READ_ONLY_QUERY,
  "POST /api/info/query": READ_ONLY_QUERY,
  "POST /api/sql": READ_ONLY_QUERY,
  "POST /api/exports": "exempt: export job; start already 404s via canViewDashboard",
  "POST /api/exports/:id/cancel": "exempt: export job; start already 404s via canViewDashboard",
  "DELETE /api/exports/:id": "exempt: export job; start already 404s via canViewDashboard",
  "POST /api/tables": SHARED_TABLE,
  "PATCH /api/tables/:id": SHARED_TABLE,
  "DELETE /api/tables/:id": SHARED_TABLE,
  "POST /api/tables/:id/schema-apply": SHARED_TABLE,
  "DELETE /api/tables/:id/sync-history/:entryId": SHARED_TABLE,
  "PUT /api/tables/:tableId/column-display-config/:columnName": SHARED_TABLE,
  "DELETE /api/tables/:tableId/column-display-config/:columnName": SHARED_TABLE,
  "POST /api/tables/:tableId/custom-metrics": SHARED_TABLE,
  "PUT /api/tables/:tableId/custom-metrics/:id": SHARED_TABLE,
  "DELETE /api/tables/:tableId/custom-metrics/:id": SHARED_TABLE,
  "POST /api/users/:username/roles": RBAC,
  "DELETE /api/users/:username/roles/:roleName": RBAC,
  "POST /api/roles": RBAC,
  "DELETE /api/roles/:id": RBAC,
  "PUT /api/roles/:id/permissions": RBAC,
};

const collectWriteRoutes = async (): Promise<string[]> => {
  // The MCP routes are classified, so register them whatever a dev .env says (it leaks into vitest).
  const savedMcp = process.env.MCP_ENABLED;
  process.env.MCP_ENABLED = "true";
  let app: any;
  try {
    app = (await createApp()) as any;
  } finally {
    if (savedMcp === undefined) delete process.env.MCP_ENABLED;
    else process.env.MCP_ENABLED = savedMcp;
  }
  const out = new Set<string>();
  for (const layer of app._router.stack as any[]) {
    if (!layer.route) continue;
    const paths: string[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const m of Object.keys(layer.route.methods)) {
      if (["get", "head", "options"].includes(m)) continue;
      for (const p of paths) out.add(`${m.toUpperCase()} ${p}`);
    }
  }
  return [...out].sort();
};

describe("dashboard write access inventory (DWINV)", () => {
  it("DWINV-1 every non-GET route is classified (no unclassified, no stale)", async () => {
    const actual = await collectWriteRoutes();
    const known = Object.keys(DASHBOARD_WRITE_ACCESS).sort();
    const unclassified = actual.filter((k) => !known.includes(k));
    const stale = known.filter((k) => !actual.includes(k));
    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  it("DWINV-2 view-check routes are exactly the behavioural route table", () => {
    for (const [k, v] of Object.entries(DASHBOARD_WRITE_ACCESS)) {
      expect(v === "view-check" || /^exempt: \S/.test(v), k).toBe(true);
    }
    const viewCheck = Object.entries(DASHBOARD_WRITE_ACCESS).filter(([, v]) => v === "view-check").map(([k]) => k).sort();
    expect(viewCheck).toEqual(DASHBOARD_WRITE_ROUTES.map((r) => r.key).sort());
    expect(viewCheck).toHaveLength(22);
  });

  it("DWINV-3 every view-check route's handler applies the check", () => {
    const src = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
    const keepSrc = readFileSync(join(__dirname, "../src/aiKeepRoutes.ts"), "utf8");
    const genSrc = readFileSync(join(__dirname, "../src/aiGenerateRoutes.ts"), "utf8");
    const regs = [...src.matchAll(/^\s*app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm)];
    for (const [k, v] of Object.entries(DASHBOARD_WRITE_ACCESS)) {
      if (v !== "view-check") continue;
      if (k === "POST /api/dashboards/:id/ai-keep") {
        expect(keepSrc, k).toContain("!canViewDashboard(username, id)");
        continue;
      }
      if (k === "POST /api/dashboards/:id/discard-generated") {
        expect(genSrc, k).toContain("!canViewDashboard(username, id)");
        continue;
      }
      const [method, path] = k.split(" ");
      const i = regs.findIndex((r) => r[1]!.toUpperCase() === method && r[2] === path);
      expect(i, `registration for ${k}`).toBeGreaterThanOrEqual(0);
      const start = regs[i]!.index!;
      const end = i + 1 < regs.length ? regs[i + 1]!.index! : src.length;
      expect(src.slice(start, end), k).toContain("denyHiddenDashboard(req, res,");
    }
  });

  it("DWINV-4 a dashboard-path write route cannot be exempt", () => {
    const DASHBOARD_PATH = /^\/api\/(dashboards\/:|widgets\/|views\/|dynamic-views?\/)/;
    const exemptOnDashboardPath = Object.entries(DASHBOARD_WRITE_ACCESS)
      .filter(([, v]) => v.startsWith("exempt:"))
      .map(([k]) => k)
      .filter((k) => DASHBOARD_PATH.test(k.split(" ")[1]!))
      .sort();
    expect(exemptOnDashboardPath).toEqual(["POST /api/dynamic-view/:id/drop", "POST /api/dynamic-view/materialize", "POST /api/dynamic-view/preview"]);
  });
});
