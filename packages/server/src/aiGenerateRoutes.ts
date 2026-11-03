// Phase 142 (AIGEN-V20-01/02): POST /api/dashboards/generate creates the pending generated dashboard (dashboard + table link
// + AI Assistant widget + pending marker in ONE transaction; the client can never forge the marker) and
// POST /api/dashboards/:id/discard-generated lets only the creator throw it away. D-06 is enforced server-side.
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthedRequest } from "./auth";
import { requireAuth } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { getAiConfig } from "./lib/aiConfig";
import { getDashboard, getTable } from "./db";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { createLiveSchema } from "./lib/ai/liveSchema";
import { principalForSession, SessionEndedError } from "./lib/exportRunner";
import { createGeneratedDashboard, discardGeneratedDashboard, findPendingForUser, GeneratePendingError } from "./lib/aiGenerate";

export type AiGenerateRouteDeps = {
  requireConfig: RequestHandler;
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler; // index.ts asyncHandler
};

const GenerateBody = z
  .object({ name: z.string().trim().min(1).max(200), description: z.string().max(1000).optional(), tableId: z.number().int().positive() })
  .strict();

const PENDING_MSG = "You already have a generated dashboard that isn't kept yet. Keep or discard it first.";
const KEPT_MSG = "This dashboard has been kept. Delete it from the dashboard list instead.";

const pending409 = (res: Response, existing: { id: number; name: string }) =>
  res.status(409).json({ code: "AI_GENERATE_PENDING", error: PENDING_MSG, dashboard: { id: existing.id, name: existing.name } });

export function registerAiGenerateRoutes(app: Express, deps: AiGenerateRouteDeps): void {
  const generate = async (req: Request, res: Response): Promise<unknown> => {
    const { creds, sid } = (req as AuthedRequest).user!;
    const username = creds.username;
    if (!getAiConfig().enabled) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });

    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".")}: ${i.message}`.slice(0, 200));
      return res.status(400).json({ error: "Invalid request.", code: "AI_GENERATE_BAD_REQUEST", issues });
    }
    const { name, description, tableId } = parsed.data;
    if (!getTable(tableId)) return res.status(404).json({ error: "Table not found." });

    const early = findPendingForUser(username);
    if (early) return pending409(res, early);

    try {
      const live = await createLiveSchema({ username, principal: () => principalForSession(sid) }).describe(tableId);
      if (!live.ok) return res.status(422).json({ error: "You can't read this table in Kinetica.", code: "AI_TABLE_UNREADABLE" });
    } catch (e) {
      if (e instanceof SessionEndedError) return res.status(401).json({ error: "Your session ended. Sign in again." });
      return res.status(422).json({ error: "You can't read this table in Kinetica.", code: "AI_TABLE_UNREADABLE" });
    }

    try {
      const d = createGeneratedDashboard({ username, name, description, tableId });
      console.log(JSON.stringify({ event: "ai_generate_created", username, dashboard_id: d.id, table_id: tableId }));
      return res.status(201).json(d);
    } catch (e) {
      if (e instanceof GeneratePendingError) return pending409(res, e.existing);
      throw e;
    }
  };

  const discard = async (req: Request, res: Response): Promise<unknown> => {
    const username = (req as AuthedRequest).user!.creds.username;
    const id = Number(req.params.id);
    const d = Number.isInteger(id) && id > 0 ? getDashboard(id) : undefined;
    // canViewDashboard is creator-only for a pending dashboard, so a non-creator sees 404 (never a hint it exists).
    if (!d || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
    const keptBody = { code: "DASHBOARD_ALREADY_KEPT", error: KEPT_MSG };
    if (!d.generated_pending) return res.status(409).json(keptBody);
    const r = await discardGeneratedDashboard(id);
    return r.deleted ? res.status(204).send() : res.status(409).json(keptBody);
  };

  app.post(
    "/api/dashboards/generate",
    requireAuth,
    deps.requireConfig,
    ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE),
    ...requirePermission(PERMISSIONS.AI_USE),
    deps.wrap(generate),
  );
  app.post("/api/dashboards/:id/discard-generated", requireAuth, deps.wrap(discard));
}
