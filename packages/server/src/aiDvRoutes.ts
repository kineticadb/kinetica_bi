// Phase 139: ad-hoc AI dynamic views (research option B). The client sends a STRUCTURED spec + (nonce, tempId, gen);
// the server re-validates it against the live schema as the user, compiles it (lib/aiDvCompile), names it
// (lib/aiDvName), registers it (lib/aiSessionViews) and materializes it. No route here accepts a view name or SQL.
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import {
  AiDvMaterializeRequestSchema,
  AiDvDropRequestSchema,
  checkAiDvSpec,
} from "@kinetica-bi/shared";
import type { AuthedRequest } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { getAiConfig } from "./lib/aiConfig";
import { getDashboard, listDashboardTables } from "./db";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { kineticaSql, kineticaShowTable } from "./kinetica";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { validateAiDvSpec, compileAiDvSpec, AiDvCompileError, type AiDvTable } from "./lib/aiDvCompile";
import {
  buildAiDynamicViewName,
  aiDvJobTag,
  isOwnAiDynamicViewName,
  parseAiDynamicViewName,
} from "./lib/aiDvName";
import { registerAiSessionView, getAiSessionView, deleteAiSessionView, countAiSessionViews } from "./lib/aiSessionViews";
import {
  isTableNotFoundError,
  decodeCountResult,
  decideThreshold,
  decideAfterPreflight,
  buildOutputCountSql,
} from "./lib/dvThreshold";
import { cancelKineticaJobsByTag } from "./lib/kineticaJobs";
import { createOrReplaceMaterialized } from "./lib/materializedView";
import { substituteViewToken } from "./lib/dynamicViewSql";
import { buildFilterViewName, sanitizeForViewName } from "./lib/viewNaming";
import { buildViewColumnsProbeSql } from "./lib/viewColumns";
import { SessionEndedError } from "./lib/exportRunner";

export type AiDvRouteDeps = {
  requireConfig: RequestHandler;
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler; // index.ts asyncHandler
  ttlMinutes: number; // DEFAULT_VIEW_TTL_MINUTES (never re-read the env here)
  viewColumnsCache: { delete(name: string): void };
};

const MAT_ROUTE = "POST /api/ai/dynamic-view/materialize";
const DROP_ROUTE = "POST /api/ai/dynamic-view/drop";
const LIST_ROUTE = "GET /api/ai/dynamic-view/list";

const refOf = (t: { schema: string; name: string }): string => (t.schema ? `${t.schema}.${t.name}` : t.name);

const invalid = (res: Response, reasons: string[]) =>
  res.status(400).json({
    error: `This view can't be built: ${reasons[0] ?? "invalid request"}`,
    code: "AI_DV_INVALID",
    reasons,
  });

export function registerAiDvRoutes(app: Express, deps: AiDvRouteDeps): void {
  const materialize = async (req: Request, res: Response): Promise<unknown> => {
    const cfg = getAiConfig();
    if (!cfg.enabled) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
    const config = cfg.config;

    const parsed = AiDvMaterializeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // path + message only: never the offending value
      const reasons = parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`.slice(0, 200));
      return res.status(400).json({ error: "Invalid dynamic view request.", code: "AI_DV_INVALID", reasons });
    }
    const body = parsed.data;
    const spec = body.spec;
    const authedReq = req as AuthedRequest;
    const username = authedReq.user!.creds.username;
    const sid = authedReq.user!.sid;

    const dashboard = getDashboard(body.dashboardId);
    if (!dashboard || !canViewDashboard(username, body.dashboardId)) {
      return res.status(404).json({ error: "Dashboard not found." });
    }

    const shapeErrors = checkAiDvSpec(spec);
    if (shapeErrors.length > 0) return invalid(res, shapeErrors);
    const joins = spec.joins ?? [];
    if (joins.length > config.dvMaxJoins) return invalid(res, [`a view can join at most ${config.dvMaxJoins} tables`]);
    if (spec.limit !== undefined && spec.limit > config.dvMaxRecords) {
      return invalid(res, [`limit ${spec.limit} is over the ${config.dvMaxRecords}-row ceiling`]);
    }

    const dashTables = listDashboardTables(body.dashboardId);
    const onDash = new Map(dashTables.map((t) => [t.id, t]));
    const ids = [spec.baseTableId, ...joins.map((j) => j.tableId)];
    const notOn = ids.filter((id) => !onDash.has(id));
    if (notOn.length > 0) return invalid(res, [...new Set(notOn)].map((id) => `table ${id} isn't on this dashboard`));

    // Cap before any Kinetica call (describe probes included): a refused request costs nothing.
    const name = buildAiDynamicViewName({ username, sid, nonce: body.nonce, tempId: body.tempId, gen: body.gen });
    if (!getAiSessionView(name)) {
      const n = countAiSessionViews(sid, { nonce: body.nonce, tempId: body.tempId });
      if (n >= config.dvMaxPerSession) {
        return res.status(409).json({
          error: `you already have ${n} session views (limit ${config.dvMaxPerSession}); remove one first`,
          code: "AI_DV_CAP",
        });
      }
    }
    const live = createLiveSchema({ username, principal: () => authedReq });
    const tables: AiDvTable[] = [];
    for (const id of ids) {
      const d = await live.describe(id);
      if (!d.ok) return invalid(res, [`table ${id} is not available`]);
      tables.push({ tableId: id, ref: refOf(d.table), columns: d.table.columns });
    }
    const limits = { maxRecords: config.dvMaxRecords, maxJoins: config.dvMaxJoins };
    const v = validateAiDvSpec(spec, tables, limits);
    if (!v.ok) return invalid(res, v.reasons);

    if (!isOwnAiDynamicViewName(name, { username, sid })) throw new Error("internal: ai view name is not owned by the caller");

    // ---- build ----
    const tag = aiDvJobTag({ nonce: body.nonce, tempId: body.tempId, gen: body.gen });
    const ac = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, config.dvPreflightTimeoutMs);
    const onClose = (): void => {
      if (!res.writableEnded) {
        ac.abort();
        void cancelKineticaJobsByTag(authedReq, tag).catch(() => {});
      }
    };
    res.on("close", onClose);
    const opts = { route: MAT_ROUTE, op: "DYNAMIC_MATERIALIZE" as const, tag, signal: ac.signal };
    const sql = (s: string) => kineticaSql(authedReq, s, opts) as Promise<Record<string, unknown> | null>;
    let registered = false;

    try {
      // Source: current combination filter view, else the base table (mirrors the saved-dv route).
      const baseTable = onDash.get(spec.baseTableId)!;
      const baseRef = refOf(baseTable);
      let targetRef = baseRef;
      let sourceKind: "filter" | "base" = "base";
      let sourceCount: number | null = null;
      if (body.combination_key !== undefined) {
        const fv = buildFilterViewName({
          username,
          sessionId: sid,
          dashboardId: body.dashboardId,
          tableId: spec.baseTableId,
          combinationKey: body.combination_key,
        });
        try {
          sourceCount = decodeCountResult(await sql(`SELECT COUNT(*) FROM ${fv}`));
          targetRef = fv;
          sourceKind = "filter";
        } catch (err) {
          if (!isTableNotFoundError(err)) throw err;
        }
      }
      let noSource = false;
      if (sourceKind === "base") {
        try {
          sourceCount = decodeCountResult(await sql(`SELECT COUNT(*) FROM ${baseRef}`));
        } catch (err) {
          if (!isTableNotFoundError(err)) throw err;
          noSource = true;
        }
      }
      const over = async (payload: Record<string, unknown>) => {
        await kineticaSql(authedReq, `DROP TABLE IF EXISTS ${name}`, { route: MAT_ROUTE, op: "DYNAMIC_MATERIALIZE" });
        deleteAiSessionView(name);
        return res.json(payload);
      };
      if (noSource) return await over({ status: "over_threshold", reason: "no_filter" });

      // Joined tables read through their current filter view when one exists, else raw (D-07/D-22).
      const joinRefs: (string | undefined)[] = [];
      for (const j of joins) {
        const key = body.joinFilterKeys?.[String(j.tableId)];
        if (key === undefined) {
          joinRefs.push(undefined);
          continue;
        }
        const fv = buildFilterViewName({
          username,
          sessionId: sid,
          dashboardId: body.dashboardId,
          tableId: j.tableId,
          combinationKey: key,
        });
        try {
          await sql(buildViewColumnsProbeSql(fv));
          joinRefs.push(fv);
        } catch (err) {
          if (!isTableNotFoundError(err)) throw err;
          joinRefs.push(undefined);
        }
      }

      let compiled;
      try {
        compiled = compileAiDvSpec(spec, tables, limits, { joinRefs });
      } catch (err) {
        if (err instanceof AiDvCompileError) return invalid(res, err.reasons);
        throw err;
      }
      const sqlBody = substituteViewToken(compiled.template, targetRef);
      const d = decideThreshold({
        maxRecords: compiled.maxRecords,
        sourceCount: sourceCount ?? 0,
        sourceKind,
        aggregated: compiled.aggregated,
        hasJoins: joins.length > 0,
      });
      if (d.kind === "over") return await over({ status: "over_threshold", reason: d.reason, row_count: sourceCount ?? 0 });
      let rowCount = sourceCount ?? 0;
      if (d.kind === "preflight") {
        const outputCount = decodeCountResult(await sql(buildOutputCountSql(sqlBody, compiled.maxRecords)));
        const after = decideAfterPreflight({ maxRecords: compiled.maxRecords, outputCount, sourceKind });
        if (after.kind === "over") return await over({ status: "over_threshold", reason: after.reason, row_count: outputCount });
        rowCount = outputCount;
      }

      registerAiSessionView({ viewName: name, sid, username, dashboardId: body.dashboardId, nonce: body.nonce, tempId: body.tempId, gen: body.gen });
      registered = true;
      await createOrReplaceMaterialized({
        req: authedReq,
        view: name,
        sqlBody,
        ttl: deps.ttlMinutes,
        route: MAT_ROUTE,
        op: "DYNAMIC_MATERIALIZE",
        tag,
        signal: ac.signal,
      });

      // Pitfall 3: a concurrent drop deleted the row while the CREATE ran; the view must not outlive it.
      if (!getAiSessionView(name)) {
        await kineticaSql(authedReq, `DROP TABLE IF EXISTS ${name}`, { route: MAT_ROUTE, op: "DYNAMIC_MATERIALIZE" });
        deps.viewColumnsCache.delete(name);
        return res.json({ status: "dropped" });
      }
      deps.viewColumnsCache.delete(name);
      return res.json({
        status: "materialized",
        view_name: name,
        row_count: rowCount,
        expires_at: Date.now() + deps.ttlMinutes * 60000,
        columns: compiled.columns,
        aggregated: compiled.aggregated,
      });
    } catch (err) {
      if (registered) deleteAiSessionView(name);
      if (err instanceof SessionEndedError) throw err;
      if (timedOut) {
        await cancelKineticaJobsByTag(authedReq, tag).catch(() => {});
        return res.status(504).json({ error: "The view took too long to build and was cancelled.", code: "AI_DV_TIMEOUT" });
      }
      if (ac.signal.aborted) {
        // client went away: the cancel already ran from onClose; best-effort drop of a half-built view
        try {
          await kineticaSql(authedReq, `DROP TABLE IF EXISTS ${name}`, { route: MAT_ROUTE, op: "DYNAMIC_MATERIALIZE" });
        } catch { /* nothing to respond to */ }
        return undefined;
      }
      throw err;
    } finally {
      clearTimeout(deadline);
      res.off("close", onClose);
    }
  };

  // Session-only gate (no ai:use): a revoked ai:use must not strand views until TTL.
  const drop = async (req: Request, res: Response): Promise<unknown> => {
    const parsed = AiDvDropRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const reasons = parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`.slice(0, 200));
      return res.status(400).json({ error: "Invalid dynamic view request.", code: "AI_DV_INVALID", reasons });
    }
    const b = parsed.data;
    const authedReq = req as AuthedRequest;
    const username = authedReq.user!.creds.username;
    const sid = authedReq.user!.sid;
    const name = buildAiDynamicViewName({ username, sid, nonce: b.nonce, tempId: b.tempId, gen: b.gen });
    if (!isOwnAiDynamicViewName(name, { username, sid })) throw new Error("internal: ai view name is not owned by the caller");
    await cancelKineticaJobsByTag(authedReq, aiDvJobTag({ nonce: b.nonce, tempId: b.tempId, gen: b.gen }));
    await kineticaSql(authedReq, `DROP TABLE IF EXISTS ${name}`, { route: DROP_ROUTE, op: "DYNAMIC_DROP" });
    deleteAiSessionView(name);
    deps.viewColumnsCache.delete(name);
    return res.json({ dropped: true });
  };

  // Verification aid (SC3 "verified by listing views in Kinetica"); never used to drive a DROP.
  // Deliberately no ai:use (like drop): it lists only the caller's own views, and a user whose ai:use was
  // revoked must still be able to verify nothing leaked.
  const list = async (req: Request, res: Response): Promise<unknown> => {
    const authedReq = req as AuthedRequest;
    const username = authedReq.user!.creds.username;
    let body: unknown;
    try {
      body = await kineticaShowTable(authedReq, "*", { route: LIST_ROUTE, op: "DISCOVERY", showOptions: { show_children: "true" } });
    } catch (err) {
      if (err instanceof SessionEndedError) throw err;
      return res.status(502).json({ error: "Could not list views." });
    }
    const names = (body as { table_names?: unknown } | null)?.table_names;
    const views = (Array.isArray(names) ? names : [])
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.slice(n.lastIndexOf(".") + 1))
      .filter((bare) => {
        const parsed = parseAiDynamicViewName(bare);
        return parsed !== null && parsed.user === sanitizeForViewName(username);
      })
      .sort();
    return res.json({ views });
  };

  app.post("/api/ai/dynamic-view/materialize", deps.requireConfig, ...requirePermission(PERMISSIONS.AI_USE), deps.wrap(materialize));
  app.post("/api/ai/dynamic-view/drop", deps.requireConfig, deps.wrap(drop));
  app.get("/api/ai/dynamic-view/list", deps.requireConfig, deps.wrap(list));
}
