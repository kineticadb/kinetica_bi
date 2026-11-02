/**
 * MCP connector (143): routes for the Kinetica BI MCP server (packages/mcp). Registered only when MCP_ENABLED=true.
 *
 * The MCP client's model calls the in-app AI's tools; nothing here talks to an AI provider. Read tools run as the
 * user; mutate tools go through the same gateway (checkAiOp) and only collect ops. Nothing is persisted until the
 * user opens the handoff link and presses Keep (the existing /ai-keep route re-checks rights and the live schema).
 *
 *   GET  /api/mcp/tools                     tool specs (name, description, JSON schema)
 *   POST /api/mcp/sessions                  { name, tableIds, replace? } -> { sessionId, dashboardId }
 *                                           Phase 143 (AIMCP-V20-05): creates an UNKEPT dashboard (Generate's lifecycle:
 *                                           creator-only, Discard/logout/boot/TTL delete it, Keep clears the mark)
 *   POST /api/mcp/sessions/:id/call         { name, args } -> { ok, text } | { ok: false, stage, reasons }
 *   POST /api/mcp/sessions/:id/finish       { summary } -> { url }
 *   GET  /api/mcp/sessions/:id/handoff      ?dashboardId= -> { prompt, answer, ops, applied } (once; the browser)
 *
 * Phase 143 (AIMCP-V20-04) personal access tokens, so Claude Desktop's config holds a revocable token, not a password:
 *   GET    /api/mcp/tokens                  the user's tokens (never the token itself)
 *   POST   /api/mcp/tokens                  { name } -> { id, token, name, expiresAt }   (token shown once)
 *   DELETE /api/mcp/tokens/:id              revoke; ends the sessions it opened
 *   POST   /api/mcp/token-login             { token } -> session cookie (no session needed; checked with Kinetica)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth";
import { issueSessionCookie, requireAuth, verifyKineticaCredentials } from "./auth";
import { createSession } from "./sessionStore";
import { createMcpToken, listMcpTokens, recordMcpTokenSession, redeemMcpToken, revokeMcpToken } from "./lib/mcp/mcpTokens";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { aiCheckLimits } from "./lib/aiConfig";
import { getDashboard, getDashboardDynamicView, getTable, listDashboardTables, listTables, listWidgets } from "./db";
import { createGeneratedDashboard, discardGeneratedDashboard, findPendingForUser, GeneratePendingError } from "./lib/aiGenerate";
import { principalForSession, SessionEndedError } from "./lib/exportRunner";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { getEffectivePermissions } from "./lib/rbacDb";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { projectSnapshot } from "./lib/ai/context";
import { snapshotForDashboard } from "./lib/mcp/mcpSnapshot";
import { checkAiOp } from "./lib/ai/gateway";
import { gatewayDvLimits } from "./lib/ai/dvDeps";
import { isClassAllowed } from "./lib/ai/outbound";
import { stampMapDefaultViews } from "./lib/ai/mapDefaultView";
import { applyFitBands } from "./lib/ai/generateMode";
import { buildToolRegistry } from "./lib/ai/tools/registry";
import { createMcpSession, getMcpSession, takeMcpHandoff, MCP_MAX_AUDITED_CALLS, type McpSession } from "./lib/mcp/mcpSessions";
import { recordMcpBuild, type AiToolAuditEntry } from "./lib/aiAudit";
import { ALLOW_LIST_VERSION, type AiOp } from "@kinetica-bi/shared";

/** The in-app AI's tools Claude Desktop may call: read the schema and the dashboard, add, and (Phase 143) edit, remove and filter. */
export const MCP_TOOL_NAMES = [
  "list_tables", "describe_table", "get_dashboard",
  "add_dynamic_view", "add_widget", "add_heatmap_layer",
  "edit_widget", "rename_widget", "change_widget_type", "set_layout", "edit_heatmap_layer", "set_layer_visibility",
  "remove_widget", "remove_layer", "remove_dynamic_view",
  // Phase 143 (AIMCP-V20-09): session-only, like the in-app AI's; Keep does not save filters.
  "apply_filter", "clear_filter",
] as const;
const REMOVE_TOOLS: ReadonlySet<string> = new Set(["remove_widget", "remove_layer", "remove_dynamic_view"]);
const CONFIRM_REASON = "Removing saved content needs the user's approval: ask the user, then call again with confirmed: true.";
export const MCP_MAX_NEW_WIDGETS = 12;
/** New widgets still on the dashboard: removing one Claude added frees its slot under MCP_MAX_NEW_WIDGETS. */
const liveNewWidgets = (ops: AiOp[]): number => {
  const removed = new Set(ops.flatMap((o) => (o.op === "remove_widget" ? [o.id] : [])));
  return ops.filter((o) => o.op === "add_widget" && !removed.has(o.tempId)).length;
};
const MCP_PROMPT = "Built in Claude Desktop";
export const MCP_TOKENS_PER_USER = 10;
const MCP_TOKEN_NAME_MAX = 60;
/** MCP_TOKEN_TTL_DAYS (1-365, default 90). */
const OpenBody = z.object({ dashboardId: z.number().int().positive() }).strict();
const StartBody = z
  .object({ name: z.string().trim().min(1).max(200), tableIds: z.array(z.number().int().positive()).min(1).max(4), replace: z.boolean().optional() })
  .strict();

const pending409 = (res: Response, existing: { id: number; name: string }) =>
  res.status(409).json({
    code: "AI_GENERATE_PENDING",
    error: `You already have an unkept dashboard, "${existing.name}". Open it and Keep or Discard it, or start again with replace to discard it.`,
    dashboard: { id: existing.id, name: existing.name },
  });

export function mcpTokenTtlDays(): number {
  const n = Number(process.env.MCP_TOKEN_TTL_DAYS ?? 90);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 90;
}

export type McpRouteDeps = {
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler;
  /** Base URL of the web app for the handoff link (MCP_APP_URL, default http://localhost:5173). */
  appUrl: string;
};

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;
/** finish_dashboard re-lays out every widget, so the gateway's first-fit position would mislead Claude and the audit. */
const withoutPlacement = (label: string): string => label.replace(/ (at row \d+, column \d+|below existing content)$/, "");
const logCall = (s: McpSession, entry: AiToolAuditEntry): void => {
  if (s.tools.length < MCP_MAX_AUDITED_CALLS) s.tools.push(entry);
};

/** Token sign-in has no session yet, so it is registered before the app's global sign-in gate (index.ts). */
export function registerMcpTokenLoginRoute(app: Express, deps: Pick<McpRouteDeps, "wrap">): void {
  app.post(
    "/api/mcp/token-login",
    deps.wrap(async (req, res) => {
      if ((process.env.AUTH_MODE || "password") !== "password") return res.status(400).json({ error: "Access tokens need password sign-in." });
      const raw = (req.body as { token?: unknown } | undefined)?.token;
      const redeemed = typeof raw === "string" ? redeemMcpToken(raw.trim()) : null;
      if (!redeemed) return res.status(401).json({ error: "Invalid, expired or revoked token." });
      // Same check as password sign-in: a changed Kinetica password makes the token stop working.
      const check = await verifyKineticaCredentials(redeemed.username, redeemed.secret);
      if (!check.ok) return res.status(check.status).json({ error: check.status === 401 ? "The token's Kinetica password no longer works. Create a new token." : check.message });
      const kineticaUrl = process.env.KINETICA_URL;
      if (!kineticaUrl) return res.status(500).json({ error: "KINETICA_URL is not configured." });
      const sid = createSession({ username: redeemed.username, secret: redeemed.secret, kineticaUrl });
      recordMcpTokenSession(sid, redeemed.tokenId);
      issueSessionCookie(res, redeemed.username, sid);
      return res.json({ user: { username: redeemed.username } });
    }),
  );
}

export function registerMcpRoutes(app: Express, deps: McpRouteDeps): void {
  // 143 (AIMCP-V20-07): the in-app AI's limits when it is on; else schema-only defaults (MCP_ENABLED is on, or these routes would not exist).
  const aiConfig = (res: Response) => {
    const limits = aiCheckLimits();
    if (!limits) res.status(503).json({ error: "AI is not configured on this server.", code: "AI_NOT_CONFIGURED" });
    return limits;
  };
  const registry = () => buildToolRegistry({ dataAccess: "schema" });

  // Listing and revoking need only a session: someone who lost ai:use can still see and revoke the tokens they made.
  app.get("/api/mcp/tokens", requireAuth, (req, res) => {
    return res.json({ tokens: listMcpTokens(usernameOf(req)), ttlDays: mcpTokenTtlDays() });
  });

  app.post("/api/mcp/tokens", ...requirePermission(PERMISSIONS.AI_USE), (req, res) => {
    const user = (req as AuthedRequest).user!;
    // The token wraps the Kinetica password; OIDC sessions carry a short-lived access token instead, which cannot be wrapped.
    if ((process.env.AUTH_MODE || "password") !== "password" || user.credentialType !== "password" || !user.creds.password) {
      return res.status(400).json({ error: "Access tokens need password sign-in; this server uses single sign-on." });
    }
    const raw = (req.body as { name?: unknown } | undefined)?.name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name === "" || name.length > MCP_TOKEN_NAME_MAX) return res.status(400).json({ error: `Give the token a name (up to ${MCP_TOKEN_NAME_MAX} characters).` });
    if (listMcpTokens(user.creds.username).length >= MCP_TOKENS_PER_USER) {
      return res.status(409).json({ error: `You already have ${MCP_TOKENS_PER_USER} tokens. Revoke one first.` });
    }
    const kineticaUrl = process.env.KINETICA_URL;
    if (!kineticaUrl) return res.status(500).json({ error: "KINETICA_URL is not configured." });
    const { id, token } = createMcpToken({ username: user.creds.username, secret: user.creds.password, kineticaUrl, name, ttlDays: mcpTokenTtlDays() });
    const row = listMcpTokens(user.creds.username).find((t) => t.id === id)!;
    return res.status(201).json({ id, token, name, expiresAt: row.expiresAt });
  });

  app.delete("/api/mcp/tokens/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !revokeMcpToken(usernameOf(req), id)) return res.status(404).json({ error: "Token not found." });
    return res.status(204).end();
  });

  // The tables Claude may use, before any session exists: the in-app list_tables tool, so only tables the user can
  // describe in Kinetica are listed and registry descriptions carry the untrusted-text markers.
  app.get(
    "/api/mcp/tables",
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(async (req, res) => {
      const config = aiConfig(res);
      if (!config) return;
      const tool = registry().byName.get("list_tables");
      if (!tool || tool.kind !== "read") return res.status(500).json({ error: "list_tables is unavailable." });
      const username = usernameOf(req);
      const out = await tool.run({}, {
        username,
        dashboardId: 0,
        dataAccess: config.dataAccess,
        dashboardView: () => {
          throw new Error("no dashboard before start_dashboard");
        },
        dashboardTableIds: () => [],
        registeredTables: () => listTables().map((t) => ({ id: t.id, schema: t.schema, name: t.name, ...(t.description ? { description: t.description } : {}) })),
        liveSchema: createLiveSchema({ username, principal: () => req as AuthedRequest }),
      });
      const text = out.parts.filter((p) => isClassAllowed(config.dataAccess, p.cls)).map((p) => p.text).join("\n");
      return res.json({ ok: !out.isError, text });
    }),
  );

  app.get("/api/mcp/tools", ...requirePermission(PERMISSIONS.AI_USE), (_req, res) => {
    const specs = registry().specs.filter((s) => (MCP_TOOL_NAMES as readonly string[]).includes(s.name));
    // The in-app AI asks the user in its own UI before removing saved content; Claude asks in chat and says so with `confirmed`.
    return res.json({
      tools: specs.map((t) => {
        if (!REMOVE_TOOLS.has(t.name)) return t;
        const js = t.jsonSchema as { properties?: Record<string, unknown> };
        return {
          ...t,
          description: `${t.description} Removing saved content: ask the user first, then pass confirmed: true.`,
          jsonSchema: { ...js, properties: { ...(js.properties ?? {}), confirmed: { type: "boolean", description: "The user approved removing this saved item" } } },
        };
      }),
    });
  });

  app.post(
    "/api/mcp/sessions",
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(async (req, res) => {
      if (!aiConfig(res)) return;
      const { creds, sid } = (req as AuthedRequest).user!;
      const username = creds.username;
      const perms = getEffectivePermissions(username);
      const open = OpenBody.safeParse(req.body);
      if (open.success) {
        // Phase 143 (AIMCP-V20-08): change a saved dashboard. Reviewed with the same Keep bar; Keep re-checks rights and conflicts.
        const id = open.data.dashboardId;
        const d = getDashboard(id);
        if (!d || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
        if (!perms.has(PERMISSIONS.DASHBOARDS_EDIT)) return res.status(403).json({ error: "You can't edit dashboards." });
        const s = createMcpSession(username, id, { mode: "edit", snapshot: snapshotForDashboard(id) });
        return res.status(201).json({ sessionId: s.id, dashboardId: id, name: d.name });
      }
      if (!perms.has(PERMISSIONS.DASHBOARDS_CREATE)) return res.status(403).json({ error: "You can't create dashboards." });
      const parsed = StartBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Give the dashboard a name and 1 to 4 table ids from list_tables." });
      const { name, tableIds, replace } = parsed.data;
      for (const tableId of tableIds) if (!getTable(tableId)) return res.status(404).json({ error: `Table ${tableId} not found.` });
      // Like Generate: the user must be able to read every table in Kinetica before anything is created.
      const live = createLiveSchema({ username, principal: () => principalForSession(sid) });
      try {
        for (const tableId of tableIds) {
          if (!(await live.describe(tableId)).ok) return res.status(422).json({ error: `You can't read table ${tableId} in Kinetica.` });
        }
      } catch (e) {
        if (e instanceof SessionEndedError) return res.status(401).json({ error: "Your session ended. Sign in again." });
        throw e;
      }
      const existing = findPendingForUser(username);
      if (existing) {
        if (!replace) return pending409(res, existing);
        await discardGeneratedDashboard(existing.id);
      }
      try {
        const d = createGeneratedDashboard({ username, name, tableIds, assistant: false });
        const s = createMcpSession(username, d.id);
        return res.status(201).json({ sessionId: s.id, dashboardId: d.id });
      } catch (e) {
        if (e instanceof GeneratePendingError) return pending409(res, e.existing);
        throw e;
      }
    }),
  );

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
      const { name, args: rawArgs } = (req.body ?? {}) as { name?: unknown; args?: unknown };
      // `confirmed` is the connector's removal approval, not a tool argument (the tools' schemas are strict).
      let confirmed = false;
      let args = rawArgs;
      if (typeof name === "string" && REMOVE_TOOLS.has(name) && rawArgs && typeof rawArgs === "object") {
        const { confirmed: c, ...rest } = rawArgs as Record<string, unknown>;
        confirmed = c === true;
        args = rest;
      }
      const reg = registry();
      const tool = typeof name === "string" && (MCP_TOOL_NAMES as readonly string[]).includes(name) ? reg.byName.get(name) : undefined;
      if (!tool) return res.status(400).json({ error: `Unknown tool. Use one of: ${MCP_TOOL_NAMES.join(", ")}.` });

      const liveSchema = createLiveSchema({ username, principal: () => authedReq });
      const dashboardTableIds = () => listDashboardTables(s.dashboardId).map((t) => t.id);

      if (tool.kind === "read") {
        const parsed = tool.args.safeParse(args ?? {});
        if (!parsed.success) {
          logCall(s, { name: tool.name, args, result: "rejected", stage: "shape", reasons: ["Invalid arguments for this tool."] });
          return res.json({ ok: false, stage: "shape", reasons: ["Invalid arguments for this tool."] });
        }
        const out = await tool.run(parsed.data, {
          username,
          dashboardId: s.dashboardId,
          dataAccess: config.dataAccess,
          dashboardView: () => projectSnapshot({ dashboardId: s.dashboardId, question: "-", snapshot: s.snapshot, turns: [] }, { id: s.dashboardId }),
          dashboardTableIds,
          registeredTables: () => listTables().map((t) => ({ id: t.id, schema: t.schema, name: t.name, ...(t.description ? { description: t.description } : {}) })),
          liveSchema,
        });
        // Same egress rule as a provider request: classes the data-access mode does not allow never leave the server.
        const text = out.parts.filter((p) => isClassAllowed(config.dataAccess, p.cls)).map((p) => p.text).join("\n");
        logCall(s, { name: tool.name, args: parsed.data, result: out.isError ? "error" : "ok" });
        return res.json({ ok: !out.isError, text });
      }

      if (tool.name === "add_widget" && liveNewWidgets(s.ops) >= MCP_MAX_NEW_WIDGETS) {
        const reasons = [`limit of ${MCP_MAX_NEW_WIDGETS} new widgets reached`];
        logCall(s, { name: tool.name, args, result: "rejected", stage: "cap", reasons });
        s.rejected.push({ label: tool.name, stage: "cap", reasons });
        return res.json({ ok: false, stage: "cap", reasons });
      }
      const g = await checkAiOp(
        {
          username,
          dashboardId: s.dashboardId,
          shadow: s.shadow,
          liveSchema,
          getPermissions: (u) => getEffectivePermissions(u),
          canViewDashboard: (u, id) => canViewDashboard(u, id),
          approvals: { removeSaved: confirmed },
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
      if (!g.ok) {
        if (g.stage === "clarification" && REMOVE_TOOLS.has(tool.name)) {
          logCall(s, { name: tool.name, args, result: "rejected", stage: g.stage, reasons: [CONFIRM_REASON] });
          return res.json({ ok: false, stage: g.stage, reasons: [CONFIRM_REASON] });
        }
        logCall(s, { name: tool.name, args, result: "rejected", stage: g.stage, reasons: g.reasons });
        s.rejected.push({ label: tool.name, stage: g.stage, reasons: g.reasons });
        return res.json({ ok: false, stage: g.stage, reasons: g.reasons });
      }
      logCall(s, { name: tool.name, args, result: "ok" });
      const label = withoutPlacement(g.label);
      s.ops.push(g.op);
      s.applied.push(label);
      return res.json({ ok: true, text: `OK: ${label}` });
    }),
  );

  app.post(
    "/api/mcp/sessions/:id/finish",
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(async (req, res) => {
      const config = aiConfig(res);
      if (!config) return;
      const authedReq = req as AuthedRequest;
      const username = usernameOf(req);
      const s = getMcpSession(String(req.params.id), username);
      if (!s) return res.status(404).json({ error: "Session not found or expired." });
      if (s.ops.length === 0) return res.status(400).json({ error: "Nothing was added yet." });
      const summary = (req.body as { summary?: unknown } | undefined)?.summary;
      if (!s.finished) {
        s.summary = typeof summary === "string" ? summary.slice(0, 2000) : undefined;
        const liveSchema = createLiveSchema({ username, principal: () => authedReq });
        // A new build started empty, so every widget is Claude's: lay them all out to fit one screen. An edit keeps the
        // saved layout; its new widgets were already placed in free space by the gateway.
        if (s.mode === "new") s.ops = applyFitBands(s.ops);
        // 142: AI-added maps open on their data; values never leave the server.
        s.ops = await stampMapDefaultViews(s.ops, {
          requestId: randomUUID(),
          principal: () => authedReq,
          liveSchema,
          dashboardTableIds: () => listDashboardTables(s.dashboardId).map((t) => t.id),
          signal: new AbortController().signal,
        });
        s.finished = true;
        // Phase 143 (AIMCP-V20-06): one audit row per Claude Desktop build, its own kind on the AI activity page.
        recordMcpBuild({
          username,
          dashboardId: s.dashboardId,
          dashboardName: getDashboard(s.dashboardId)?.name ?? "",
          mode: s.mode,
          summary: s.summary,
          dataAccess: config.dataAccess,
          allowListVersion: ALLOW_LIST_VERSION,
          tools: s.tools,
          changes: { applied: s.applied, rejected: s.rejected },
          startedAt: s.startedAt,
          now: Date.now(),
        });
      }
      const url = `${deps.appUrl.replace(/\/$/, "")}/?dashboard=${s.dashboardId}&mcp=${s.id}`;
      return res.json({ url, dashboardId: s.dashboardId, applied: s.applied });
    }),
  );

  app.get("/api/mcp/sessions/:id/handoff", requireAuth, (req, res) => {
    const s = takeMcpHandoff(String(req.params.id), usernameOf(req), Number(req.query.dashboardId));
    if (!s) return res.status(404).json({ error: "Nothing to load from Claude Desktop (already loaded or expired)." });
    return res.json({ prompt: MCP_PROMPT, answer: s.summary ?? "", ops: s.ops, applied: s.applied, mode: s.mode });
  });
}
