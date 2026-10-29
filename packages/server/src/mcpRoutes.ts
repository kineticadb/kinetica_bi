/**
 * kbi-mcp spike: routes for the Kinetica BI MCP server (packages/mcp). Registered only when MCP_ENABLED=true.
 *
 * The MCP client's model calls the in-app AI's tools; nothing here talks to an AI provider. Read tools run as the
 * user; mutate tools go through the same gateway (checkAiOp) and only collect ops. Nothing is persisted until the
 * user opens the handoff link and presses Keep (the existing /ai-keep route re-checks rights and the live schema).
 *
 *   GET  /api/mcp/tools                     tool specs (name, description, JSON schema)
 *   POST /api/mcp/sessions                  { dashboardId } -> { sessionId }   (an EMPTY dashboard the user can edit)
 *   POST /api/mcp/sessions/:id/call         { name, args } -> { ok, text } | { ok: false, stage, reasons }
 *   POST /api/mcp/sessions/:id/finish       { summary } -> { url }
 *   GET  /api/mcp/sessions/:id/handoff      ?dashboardId= -> { prompt, answer, ops, applied } (once; the browser)
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth";
import { requireAuth } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { getAiConfig } from "./lib/aiConfig";
import { getDashboard, getDashboardDynamicView, listDashboardTables, listTables, listWidgets } from "./db";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { getEffectivePermissions } from "./lib/rbacDb";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { checkAiOp } from "./lib/ai/gateway";
import { gatewayDvLimits } from "./lib/ai/dvDeps";
import { isClassAllowed } from "./lib/ai/outbound";
import { stampMapDefaultViews } from "./lib/ai/mapDefaultView";
import { applyFitBands } from "./lib/ai/generateMode";
import { buildToolRegistry } from "./lib/ai/tools/registry";
import { createMcpSession, getMcpSession, takeMcpHandoff } from "./lib/mcp/mcpSessions";

/** Spike scope: read the schema, then ADD views, charts and map layers to a new dashboard. */
export const MCP_TOOL_NAMES = ["list_tables", "describe_table", "add_dynamic_view", "add_widget", "add_heatmap_layer"] as const;
export const MCP_MAX_NEW_WIDGETS = 12;
const MCP_PROMPT = "Built in Claude Desktop";

export type McpRouteDeps = {
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler;
  /** Base URL of the web app for the handoff link (MCP_APP_URL, default http://localhost:5173). */
  appUrl: string;
};

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;

export function registerMcpRoutes(app: Express, deps: McpRouteDeps): void {
  const aiConfig = (res: Response) => {
    const cfg = getAiConfig();
    if (!cfg.enabled) {
      res.status(503).json({ error: "AI is not configured on this server.", code: "AI_NOT_CONFIGURED" });
      return undefined;
    }
    return cfg.config;
  };
  const registry = () => buildToolRegistry({ dataAccess: "schema" });

  app.get("/api/mcp/tools", ...requirePermission(PERMISSIONS.AI_USE), (_req, res) => {
    const specs = registry().specs.filter((s) => (MCP_TOOL_NAMES as readonly string[]).includes(s.name));
    return res.json({ tools: specs });
  });

  app.post("/api/mcp/sessions", ...requirePermission(PERMISSIONS.AI_USE), ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    if (!aiConfig(res)) return;
    const username = usernameOf(req);
    const dashboardId = Number((req.body as { dashboardId?: unknown } | undefined)?.dashboardId);
    if (!Number.isInteger(dashboardId) || dashboardId <= 0 || !getDashboard(dashboardId) || !canViewDashboard(username, dashboardId)) {
      return res.status(404).json({ error: "Dashboard not found." });
    }
    if (listWidgets(dashboardId).length > 0) return res.status(409).json({ error: "The MCP spike only builds new, empty dashboards." });
    const s = createMcpSession(username, dashboardId);
    return res.status(201).json({ sessionId: s.id, dashboardId });
  });

  app.post(
    "/api/mcp/sessions/:id/call",
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(async (req, res) => {
      const config = aiConfig(res);
      if (!config) return;
      const authedReq = req as AuthedRequest;
      const username = usernameOf(req);
      const s = getMcpSession(String(req.params.id), username);
      if (!s) return res.status(404).json({ error: "Session not found or expired. Start a new dashboard." });
      if (s.finished) return res.status(409).json({ error: "This dashboard was already handed to the browser." });
      const { name, args } = (req.body ?? {}) as { name?: unknown; args?: unknown };
      const reg = registry();
      const tool = typeof name === "string" && (MCP_TOOL_NAMES as readonly string[]).includes(name) ? reg.byName.get(name) : undefined;
      if (!tool) return res.status(400).json({ error: `Unknown tool. Use one of: ${MCP_TOOL_NAMES.join(", ")}.` });

      const liveSchema = createLiveSchema({ username, principal: () => authedReq });
      const dashboardTableIds = () => listDashboardTables(s.dashboardId).map((t) => t.id);

      if (tool.kind === "read") {
        const parsed = tool.args.safeParse(args ?? {});
        if (!parsed.success) return res.json({ ok: false, stage: "shape", reasons: ["Invalid arguments for this tool."] });
        const out = await tool.run(parsed.data, {
          username,
          dashboardId: s.dashboardId,
          dataAccess: config.dataAccess,
          dashboardView: () => ({ dashboardId: s.dashboardId, widgets: [], layers: [], dynamicViews: [], filters: [] }),
          dashboardTableIds,
          registeredTables: () => listTables().map((t) => ({ id: t.id, schema: t.schema, name: t.name, ...(t.description ? { description: t.description } : {}) })),
          liveSchema,
        });
        // Same egress rule as a provider request: classes the data-access mode does not allow never leave the server.
        const text = out.parts.filter((p) => isClassAllowed(config.dataAccess, p.cls)).map((p) => p.text).join("\n");
        return res.json({ ok: !out.isError, text });
      }

      if (tool.name === "add_widget" && s.ops.filter((o) => o.op === "add_widget").length >= MCP_MAX_NEW_WIDGETS) {
        return res.json({ ok: false, stage: "cap", reasons: [`limit of ${MCP_MAX_NEW_WIDGETS} new widgets reached`] });
      }
      const g = await checkAiOp(
        {
          username,
          dashboardId: s.dashboardId,
          shadow: s.shadow,
          liveSchema,
          getPermissions: (u) => getEffectivePermissions(u),
          canViewDashboard: (u, id) => canViewDashboard(u, id),
          dashboardTableIds,
          aiDv: gatewayDvLimits(config),
          dynamicViewInfo: (id) => {
            const r = getDashboardDynamicView(id);
            return r && r.dashboard_id === s.dashboardId ? { name: r.name, columns: r.columns_json ?? null, sourceTableId: r.source_table_id } : undefined;
          },
        },
        tool,
        JSON.stringify(args ?? {}),
      );
      if (!g.ok) return res.json({ ok: false, stage: g.stage, reasons: g.reasons });
      s.ops.push(g.op);
      s.applied.push(g.label);
      return res.json({ ok: true, text: `OK: ${g.label}` });
    }),
  );

  app.post(
    "/api/mcp/sessions/:id/finish",
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(async (req, res) => {
      if (!aiConfig(res)) return;
      const authedReq = req as AuthedRequest;
      const username = usernameOf(req);
      const s = getMcpSession(String(req.params.id), username);
      if (!s) return res.status(404).json({ error: "Session not found or expired." });
      if (s.ops.length === 0) return res.status(400).json({ error: "Nothing was added yet." });
      const summary = (req.body as { summary?: unknown } | undefined)?.summary;
      if (!s.finished) {
        s.summary = typeof summary === "string" ? summary.slice(0, 2000) : undefined;
        const liveSchema = createLiveSchema({ username, principal: () => authedReq });
        // 142: AI-added maps open on their data; values never leave the server.
        // The dashboard started empty, so every widget is Claude's: lay them all out to fit one screen.
        s.ops = applyFitBands(s.ops);
        s.ops = await stampMapDefaultViews(s.ops, {
          requestId: randomUUID(),
          principal: () => authedReq,
          liveSchema,
          dashboardTableIds: () => listDashboardTables(s.dashboardId).map((t) => t.id),
          signal: new AbortController().signal,
        });
        s.finished = true;
      }
      const url = `${deps.appUrl.replace(/\/$/, "")}/?dashboard=${s.dashboardId}&mcp=${s.id}`;
      return res.json({ url, dashboardId: s.dashboardId, applied: s.applied });
    }),
  );

  app.get("/api/mcp/sessions/:id/handoff", requireAuth, (req, res) => {
    const s = takeMcpHandoff(String(req.params.id), usernameOf(req), Number(req.query.dashboardId));
    if (!s) return res.status(404).json({ error: "Nothing to load from Claude Desktop (already loaded or expired)." });
    return res.json({ prompt: MCP_PROMPT, answer: s.summary ?? "", ops: s.ops, applied: s.applied });
  });
}
