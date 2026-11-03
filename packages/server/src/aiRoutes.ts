/**
 * Phase 135-10 — AI HTTP routes. POST /api/ai/ask (SSE over POST) and GET /api/ai/config.
 *
 * Route boundary:
 *  - POST /api/ai/ask requires `ai:use` (requirePermission); any ai:use user may ask about a dashboard they can VIEW.
 *  - D-16: the AI proposes SESSION-ONLY ops (nothing is persisted here); the browser applies them via the normal
 *    edit paths, which enforce edit rights (Phase 141). The gateway therefore checks ai:use + view access only.
 *  - GET /api/ai/config is requireAuth only and exposes no key / endpoint.
 *
 * Order: permission -> config -> size -> body -> dashboard viewable -> in-flight -> caps/audit admit -> stream.
 * Everything before the stream is JSON; once headers are sent every failure is an SSE `error` event.
 * Exactly one ai_audit row is finalized per admitted answer.
 * W1 (137-02): a hard deadline (AI_TIMEOUT_MS + grace) always releases the lock; Cancel/deadline also cancel the
 * answer's tagged Kinetica jobs.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { AskRequestSchema, ASK_REQUEST_MAX_BYTES } from "@kinetica-bi/shared";
import { requireAuth, type AuthedRequest } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { getAiConfig } from "./lib/aiConfig";
import { AI_CONTRACT_VERSION } from "./lib/aiContract";
import { admitAiAnswer, finalizeAiAnswer, type AiQueryAuditEntry, type FinalizeInput } from "./lib/aiAudit";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { getDashboard, listWidgets } from "./db";
import { runAnswer } from "./lib/ai/runAnswer";
import { createSseWriter } from "./lib/ai/sseWriter";
import { AI_USER_MESSAGES } from "./lib/ai/agentLoop";
import { cancelKineticaJobsByTag } from "./lib/kineticaJobs";
import { principalForSession } from "./lib/exportRunner";

const DEFAULT_HEARTBEAT_MS = 15_000;
let heartbeatOverride: number | null = null;
export function __setAiHeartbeatMsForTest(ms: number | null): void {
  heartbeatOverride = ms;
}

const DEFAULT_GRACE_MS = 5_000;
let graceOverride: number | null = null;
export function __setAiGraceMsForTest(ms: number | null): void {
  graceOverride = ms;
}

/** lowercased username -> controller of the answer currently running for that user (one at a time). */
const inflight = new Map<string, AbortController>();

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;
const sidOf = (req: Request): string => (req as AuthedRequest).user!.sid;

export function registerAiRoutes(app: Express): void {
  app.get("/api/ai/config", requireAuth, (_req: Request, res: Response) => {
    const cfg = getAiConfig();
    if (!cfg.enabled) return res.json({ enabled: false });
    const c = cfg.config;
    return res.json({
      enabled: true,
      provider: c.provider,
      model: c.model,
      dataAccess: c.dataAccess,
      toolMode: c.toolMode,
      limits: { maxToolSteps: c.maxToolSteps, answersPerUserPerHour: c.maxAnswersPerUserPerHour, answersPerDay: c.maxAnswersPerDay },
    });
  });

  app.post("/api/ai/ask", ...requirePermission(PERMISSIONS.AI_USE), async (req: Request, res: Response) => {
    const cfg = getAiConfig();
    if (!cfg.enabled) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
    const config = cfg.config;

    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > ASK_REQUEST_MAX_BYTES) {
      return res.status(413).json({ error: "Request too large.", code: "AI_REQUEST_TOO_LARGE" });
    }
    const parsed = AskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // path + message only: never the offending value
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      return res.status(400).json({ error: "Invalid request.", code: "AI_BAD_REQUEST", issues });
    }
    const body = parsed.data;
    const username = usernameOf(req);
    const key = username.toLowerCase();

    const dashboard = getDashboard(body.dashboardId);
    if (!dashboard || !canViewDashboard(username, body.dashboardId)) {
      return res.status(404).json({ error: "Dashboard not found." });
    }
    // 142 Pattern 2: generate mode is derived on the server, never sent by the client. A Retry re-enters it while the
    // dashboard is still empty; a refine ask (temp widgets in the snapshot) does not.
    const generate =
      dashboard.generated_pending === true &&
      listWidgets(dashboard.id).every((w) => String(w.type) === "ai") &&
      body.snapshot.widgets.every((w) => w.type === "ai");
    if (inflight.has(key)) {
      return res.status(409).json({ error: "An AI answer is already in progress.", code: "AI_BUSY" });
    }

    const requestId = randomUUID();
    const admit = admitAiAnswer({
      username: key,
      dashboardId: body.dashboardId,
      requestId,
      question: body.question,
      provider: config.provider,
      model: config.model,
      dataAccess: config.dataAccess,
      allowListVersion: AI_CONTRACT_VERSION,
      now: Date.now(),
      capPerHour: config.maxAnswersPerUserPerHour,
      capPerDay: config.maxAnswersPerDay,
      kind: generate ? "generate" : "ask",
    });
    if (!admit.ok) {
      res.setHeader("Retry-After", String(admit.retryAfterSeconds));
      return res.status(429).json({ code: admit.code, message: admit.message, retryAfterSeconds: admit.retryAfterSeconds });
    }

    const started = Date.now();
    const ac = new AbortController();
    inflight.set(key, ac);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (inflight.get(key) === ac) inflight.delete(key);
    };
    let finalized = false;
    const finalizeOnce = (f: FinalizeInput): void => {
      if (finalized) return;
      finalized = true;
      try {
        finalizeAiAnswer(f);
      } catch (err) {
        console.error("[ai] audit finalize failed", err instanceof Error ? err.message : "unknown");
      }
    };
    // Probes only: run_query jobs (<requestId>-qNN) are cancelled by the query port via the abort signal (140).
    // Aborting the HTTP request does not stop a Kinetica job; cancel the answer's tagged jobs (best effort).
    const cancelJobs = (): void => {
      try {
        void cancelKineticaJobsByTag(principalForSession(sidOf(req)), requestId).catch(() => {});
      } catch {
        /* session already gone: nothing to cancel with */
      }
    };
    // S2 C4: the abort signal is the RESPONSE's close, not the request's.
    res.on("close", () => {
      if (!res.writableEnded) {
        ac.abort();
        cancelJobs();
      }
    });

    const queryLog: { current?: () => readonly AiQueryAuditEntry[] } = {};
    let fin: FinalizeInput | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    try {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const sse = createSseWriter(res);
      heartbeat = setInterval(() => sse.comment("ping"), heartbeatOverride ?? DEFAULT_HEARTBEAT_MS);
      heartbeat.unref();
      // Started before runAnswer so a hung pre-loop Kinetica probe is covered too.
      const hardDeadline = new Promise<"deadline">((resolve) => {
        hardTimer = setTimeout(() => resolve("deadline"), config.timeoutMs + (graceOverride ?? DEFAULT_GRACE_MS));
        hardTimer.unref();
      });
      const outcome = await Promise.race([
        runAnswer({
          sid: sidOf(req),
          username,
          auditId: admit.auditId,
          requestId,
          body,
          dashboard: { id: dashboard.id, title: dashboard.name },
          config,
          generate,
          signal: ac.signal,
          sse,
          queryLog,
        }),
        hardDeadline,
      ]);
      if (outcome === "deadline") {
        ac.abort();
        cancelJobs();
        release();
        sse.send("error", { code: "AI_TIMEOUT", message: AI_USER_MESSAGES.timeout });
        finalizeOnce({
          auditId: admit.auditId,
          outcome: "provider_error",
          detail: "timeout",
          steps: 0,
          tools: [],
          changes: { applied: [], rejected: [] },
          durationMs: Date.now() - started,
          ...(queryLog.current ? { queries: [...queryLog.current()] } : {}),
        });
        res.end();
      } else {
        fin = outcome;
      }
    } catch {
      // runAnswer never throws; this covers a failure while setting up the stream itself.
      try {
        createSseWriter(res).send("error", { code: "AI_INTERNAL", message: "Something went wrong while answering. Nothing was changed." });
      } catch { /* socket gone */ }
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
      if (heartbeat) clearInterval(heartbeat);
      release();
      finalizeOnce(
        fin ?? {
          auditId: admit.auditId,
          outcome: ac.signal.aborted ? "cancelled" : "provider_error",
          detail: ac.signal.aborted ? "client_abort" : "internal",
          steps: 0,
          tools: [],
          changes: { applied: [], rejected: [] },
          durationMs: Date.now() - started,
        },
      );
      if (!res.writableEnded) res.end();
    }
    return undefined;
  });
}
