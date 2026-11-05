// Phase 141: POST /api/dashboards/:id/ai-keep. The client sends a folded change set; the server re-checks rights,
// ownership, shape and the live schema, compares the dashboard version, then writes everything in ONE transaction
// (applyKeep). Kinetica side effects (dropping removed saved views) happen only after commit. D-04: server = authority.
// 145: a create-only role keeps its own unkept dashboard with dashboards:create alone; saved dashboards still need dashboards:edit + per-item rights.
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import {
  AiKeepRequestSchema,
  AI_KEEP_ERROR_CODES,
  KEEP_CONFLICT_MESSAGE,
  KEEP_FAILED_MESSAGE,
  keepPermissionMessage,
  DASHBOARD_VERSION_HEADER,
  formatVersionWriteHeader,
  type AiKeepRequest,
  type AiKeepIdMap,
} from "@kinetica-bi/shared";
import { requireAuth, type AuthedRequest } from "./auth";
import { PERMISSIONS } from "./lib/permissions";
import { aiCheckLimits } from "./lib/aiConfig";
import { getDashboard, getDashboardVersion, getGeneratedPending, getDashboardDynamicView } from "./db";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { getEffectivePermissions } from "./lib/rbacDb";
import { kineticaSql } from "./kinetica";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { buildDynamicViewName } from "./lib/dynamicViewName";
import { noteMcpOwnWrite } from "./lib/mcp/mcpSessions";
import { applyKeep, KeepConflict, KeepInvalid } from "./lib/aiKeepApply";
import { requiredRights, missingRights, checkKeepChange, prepareKeep } from "./lib/aiKeepValidate";
import { recordAiKeep, type AiKeepAuditOutcome } from "./lib/aiAudit";

export type AiKeepRouteDeps = {
  requireConfig: RequestHandler;
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler; // index.ts asyncHandler
  viewColumnsCache: { delete(name: string): void };
};

const ROUTE = "POST /api/dashboards/:id/ai-keep";

const countsOf = (c: AiKeepRequest) => ({
  added: { widgets: c.widgets.add.length, layers: c.layers.add.length, dynamicViews: c.dynamicViews.add.length },
  edited: { widgets: c.widgets.edit.length, layers: c.layers.edit.length },
  removed: { widgets: c.widgets.remove.length, layers: c.layers.remove.length, dynamicViews: c.dynamicViews.remove.length },
});

// Route-level entry gate: dashboards:edit OR dashboards:create (create-only creators may keep their own unkept build).
// Same refusal body and log line as requirePermission(DASHBOARDS_EDIT) so callers with neither right see no change.
const keepEntryGate: RequestHandler = (req, res, next) => {
  const username = (req as AuthedRequest).user!.creds.username;
  const perms = getEffectivePermissions(username);
  if (perms.has(PERMISSIONS.DASHBOARDS_EDIT) || perms.has(PERMISSIONS.DASHBOARDS_CREATE)) return next();
  console.warn(
    JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "permission_denied", username, route: req.path, method: req.method, permission: PERMISSIONS.DASHBOARDS_EDIT, outcome: "denied" }),
  );
  return res.status(403).json({ error: `Permission denied: ${PERMISSIONS.DASHBOARDS_EDIT} is required`, code: "PERMISSION_DENIED", permission: PERMISSIONS.DASHBOARDS_EDIT });
};

export function registerAiKeepRoutes(app: Express, deps: AiKeepRouteDeps): void {
  const handler = async (req: Request, res: Response): Promise<unknown> => {
    const started = Date.now();
    const authedReq = req as AuthedRequest;
    const username = authedReq.user!.creds.username;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || !getDashboard(id) || !canViewDashboard(username, id)) {
      return res.status(404).json({ error: "Dashboard not found." });
    }
    // 145 (KEEP-V21-01/02): the caller's own unkept dashboard (the 404 above already proved the caller is its creator)
    // can be kept with dashboards:create alone; any other dashboard needs dashboards:edit plus the per-item rights.
    const perms = getEffectivePermissions(username);
    const ownUnkept = getGeneratedPending(id) != null;
    const createOnlyKeep = ownUnkept && perms.has(PERMISSIONS.DASHBOARDS_CREATE);
    if (!createOnlyKeep && !perms.has(PERMISSIONS.DASHBOARDS_EDIT)) {
      return res.status(403).json({ error: `Permission denied: ${PERMISSIONS.DASHBOARDS_EDIT} is required`, code: "PERMISSION_DENIED", permission: PERMISSIONS.DASHBOARDS_EDIT });
    }
    // 143: Keep also serves Claude Desktop builds, so it works when the in-app AI is off but the connector is on.
    const limits = aiCheckLimits();
    if (!limits) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });

    const parsed = AiKeepRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // path + message only: never the offending value
      const reasons = parsed.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".")}: ${i.message}`.slice(0, 200));
      return res.status(400).json({ error: "Invalid Keep request.", code: AI_KEEP_ERROR_CODES.invalid, reasons });
    }
    const c = parsed.data;
    const counts = countsOf(c);
    const audit = (outcome: AiKeepAuditOutcome, detail?: string, idMap?: AiKeepIdMap): void => {
      try {
        recordAiKeep({ username, dashboardId: id, outcome, detail, counts, idMap, durationMs: Date.now() - started });
      } catch {
        console.error(JSON.stringify({ level: "error", event: "ai_keep_audit_failed", dashboard_id: id }));
      }
    };
    const refuse = (reasons: string[], outcome: "keep_invalid" = "keep_invalid") => {
      audit(outcome, "invalid");
      return res.status(422).json({ error: `This change can't be saved: ${reasons[0] ?? "invalid change"}`, code: AI_KEEP_ERROR_CODES.invalid, reasons });
    };
    const conflict = (detail: string) => {
      audit("keep_conflict", detail);
      return res.status(409).json({ error: KEEP_CONFLICT_MESSAGE, code: AI_KEEP_ERROR_CODES.conflict });
    };

    // d. rights the change set actually needs (D-01/D-02)
    if (!createOnlyKeep) {
      const missing = missingRights(requiredRights(c), perms);
      if (missing.length > 0) {
        audit("keep_denied", missing[0]);
        return res.status(403).json({ error: keepPermissionMessage(missing[0]!), code: AI_KEEP_ERROR_CODES.permission, permission: missing[0], missing });
      }
    }

    // f. cheap stale-baseline pre-check: no Kinetica call has happened yet. Runs BEFORE the reference checks so a
    // dashboard that changed under the user (items they reference may be gone) is a 409, not a confusing 422.
    if (getDashboardVersion(id) !== c.baselineVersion) return conflict("stale_baseline");

    // e. ownership / shape / blocked keys / references
    const check = checkKeepChange(id, c);
    if (!check.ok) return refuse(check.reasons);

    // g. live-schema re-validation as the caller; dynamic views are rebuilt from the structured spec only
    const live = createLiveSchema({ username, principal: () => authedReq });
    const prep = await prepareKeep(c, {
      describe: (t) => live.describe(t),
      limits: { maxRecords: limits.dvMaxRecords, maxJoins: limits.dvMaxJoins },
      savedDvColumns: (dv) => {
        const r = getDashboardDynamicView(dv);
        return r && r.dashboard_id === id ? r.columns_json : null;
      },
    });
    if (!prep.ok) return refuse(prep.reasons);

    // h. the real guard: version compare + every write in one synchronous transaction
    let out: ReturnType<typeof applyKeep>;
    try {
      out = applyKeep(id, c, prep.prepared, {
        expectPending: createOnlyKeep,
        ...(createOnlyKeep && !perms.has(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS) ? { grantCreator: username } : {}),
      });
    } catch (e) {
      if (e instanceof KeepConflict) return conflict("in_txn_conflict");
      if (e instanceof KeepInvalid) return refuse(e.reasons);
      console.error(JSON.stringify({ level: "error", event: "ai_keep_failed", dashboard_id: id }));
      audit("keep_failed", "transaction_failed");
      return res.status(500).json({ error: KEEP_FAILED_MESSAGE, code: AI_KEEP_ERROR_CODES.failed });
    }

    // i. committed: header, best-effort drops of the removed saved views' materializations, audit, body
    res.setHeader(DASHBOARD_VERSION_HEADER, formatVersionWriteHeader(id, out.before, out.version));
    noteMcpOwnWrite(id, username, out.before, out.version); // 145: an own in-app Keep is an own write for an open Claude Desktop edit
    await Promise.allSettled(
      out.removedDynamicViewIds.map(async (dvId) => {
        const name = buildDynamicViewName({ userId: username, dashboardId: id, dynamicViewId: dvId });
        deps.viewColumnsCache.delete(name);
        try {
          await kineticaSql(authedReq, `DROP TABLE IF EXISTS ${name}`, { route: ROUTE, op: "DYNAMIC_MATERIALIZE" });
        } catch {
          console.error(JSON.stringify({ level: "warn", event: "ai_keep_drop_failed", dashboard_id: id, dynamic_view_id: dvId }));
        }
      }),
    );
    audit("kept", undefined, out.idMap);
    return res.json({ idMap: out.idMap, version: out.version, warnings: [...check.warnings, ...out.warnings] });
  };

  app.post("/api/dashboards/:id/ai-keep", deps.requireConfig, requireAuth, keepEntryGate, deps.wrap(handler));
}
