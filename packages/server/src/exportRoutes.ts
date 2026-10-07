/**
 * Phase 129 — background export HTTP routes (EXPRT-V126-13/17; route half of -05/-07).
 * requireAuth-only (analyst passthrough): NO requirePermission — access to start = canViewDashboard
 * on the widget's dashboard; access to every :id route = ownership (operator O-4).
 * The download route (GET /api/exports/:id/download) lives here too: owner(404) -> complete(409) -> expired(410) -> file(410) -> track -> send.
 */
import type { Express, Request, Response } from "express";
import type { AuthedRequest } from "./auth";
import {
  getWidget,
  getDashboard,
  getExportJob,
  listExportJobsForUser,
  deleteExportJob,
  type ExportJob,
} from "./db";
import { canViewDashboard } from "./lib/dashboardAccessDb";
import { startExport, cancelExport, type ExportOptions } from "./lib/exportRunner";
import { ExportCapError } from "./lib/exportCaps";
import { ExportSpecError, type ExportSpec } from "./lib/exportSql";
import { findOwnedExportJob, toExportJobDto, exportDownloadName, resolveServableExportFile, isExportExpired } from "./lib/exportJobAccess";
import { trackExportDownload, removeExportFiles } from "./lib/exportCleanup";

const NOT_FOUND = { error: "Export not found." };
const GONE = { error: "This export is no longer available." };
const WIDGET_NOT_FOUND = { error: "Widget not found." };
const MAX_FILTERS = 200;
const ACTIVE = new Set(["queued", "running"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isObjArray = (v: unknown): boolean =>
  Array.isArray(v) && v.length <= MAX_FILTERS && v.every(isObj);

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;

/** The ONLY ownership path for :id routes; one body for malformed / unknown / not-yours. */
function loadOwnedJob(req: Request, res: Response): ExportJob | undefined {
  const job = findOwnedExportJob(String(req.params.id), usernameOf(req));
  if (!job) {
    res.status(404).json(NOT_FOUND);
    return undefined;
  }
  return job;
}

function bad(res: Response, error: string) {
  return res.status(400).json({ error, code: "invalid_export_request" });
}

export function registerExportRoutes(app: Express): void {
  app.post("/api/exports", (req: Request, res: Response) => {
    if (!process.env.KINETICA_URL) return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
    const b = req.body;
    if (!isObj(b)) return bad(res, "Request body must be an object.");
    if (!(Number.isInteger(b.widgetId) && (b.widgetId as number) > 0)) return bad(res, "widgetId must be a positive integer.");
    for (const name of ["filters", "spatialFilters"] as const) {
      if (b[name] !== undefined && !isObjArray(b[name])) return bad(res, `${name} must be an array of objects (max 200).`);
    }
    if (b.spatialTarget !== undefined && b.spatialTarget !== null && !isObj(b.spatialTarget)) {
      return bad(res, "spatialTarget must be an object or null.");
    }
    if (b.sortField !== undefined && b.sortField !== null && typeof b.sortField !== "string") {
      return bad(res, "sortField must be a string.");
    }
    if (b.sortDir !== undefined && b.sortDir !== "asc" && b.sortDir !== "desc") {
      return bad(res, 'sortDir must be "asc" or "desc".');
    }
    const rawOpts = b.options;
    if (rawOpts !== undefined && !isObj(rawOpts)) return bad(res, "options must be an object.");
    if (rawOpts && rawOpts.gzip !== undefined && typeof rawOpts.gzip !== "boolean") return bad(res, "options.gzip must be a boolean.");
    if (rawOpts && rawOpts.format !== undefined && rawOpts.format !== "raw") return bad(res, 'options.format must be "raw".');
    const options: ExportOptions = {};
    if (rawOpts && typeof rawOpts.gzip === "boolean") options.gzip = rawOpts.gzip;
    if (rawOpts && rawOpts.format === "raw") options.format = "raw";

    const spec = {
      widgetId: b.widgetId as number,
      ...(b.sortField !== undefined && { sortField: b.sortField }),
      ...(b.sortDir && { sortDir: b.sortDir }),
      ...(b.filters ? { filters: b.filters } : {}),
      ...(b.spatialFilters ? { spatialFilters: b.spatialFilters } : {}),
      ...(b.spatialTarget !== undefined && { spatialTarget: b.spatialTarget }),
    } as ExportSpec;

    const username = usernameOf(req);
    const widget = getWidget(spec.widgetId);
    if (!widget || !getDashboard(widget.dashboard_id) || !canViewDashboard(username, widget.dashboard_id)) {
      return res.status(404).json(WIDGET_NOT_FOUND);
    }
    if ((widget.config as Record<string, unknown> | null)?.enableCsvDownload === false) {
      return res.status(403).json({ error: "CSV download is disabled for this widget." });
    }
    try {
      const { jobId } = startExport({ spec, sid: (req as AuthedRequest).user!.sid, username, options });
      return res.status(202).json({ data: toExportJobDto(getExportJob(jobId)!) });
    } catch (e) {
      if (e instanceof ExportCapError) return res.status(429).json({ error: e.message, code: e.code });
      if (e instanceof ExportSpecError) {
        return e.code === "widget_not_found"
          ? res.status(404).json(WIDGET_NOT_FOUND)
          : res.status(400).json({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  app.get("/api/exports", (req: Request, res: Response) => {
    res.json({ data: listExportJobsForUser(usernameOf(req)).map(toExportJobDto) });
  });

  app.get("/api/exports/:id", (req: Request, res: Response) => {
    const job = loadOwnedJob(req, res);
    if (!job) return;
    return res.json({ data: toExportJobDto(job) });
  });

  app.post("/api/exports/:id/cancel", (req: Request, res: Response) => {
    const job = loadOwnedJob(req, res);
    if (!job) return;
    if (!ACTIVE.has(job.status) || !cancelExport(job.id)) {
      return res.status(409).json({ error: "Export is not running.", status: getExportJob(job.id)?.status ?? job.status });
    }
    return res.status(202).json({ data: toExportJobDto(getExportJob(job.id) ?? job) });
  });

  app.delete("/api/exports/:id", (req: Request, res: Response) => {
    const job = loadOwnedJob(req, res);
    if (!job) return;
    if (ACTIVE.has(job.status)) cancelExport(job.id);
    removeExportFiles(job);
    deleteExportJob(job.id);
    return res.status(204).end();
  });

  // EXPRT-V126-11: only a complete, closed file is served. The status gate refuses EVERY request for a
  // non-complete job, Range or not (operator O-1) — there is deliberately no Range-specific branch.
  // Range/206/416/If-Range/ETag come from res.download -> send@0.19.2. Ownership only (O-4).
  app.get("/api/exports/:id/download", (req: Request, res: Response) => {
    const job = loadOwnedJob(req, res);
    if (!job) return;
    if (job.status !== "complete") {
      return res.status(409).json({ error: "Export is not ready to download.", status: job.status });
    }
    // Phase 130 D-04: TTL means no longer OFFERED, independent of physical deletion; a Range resume after expiry is refused too.
    if (isExportExpired(job)) return res.status(410).json(GONE);
    const file = resolveServableExportFile(job);
    if (!file) return res.status(410).json(GONE);
    // Phase 130 D-04: claim the file in this same synchronous segment (no async gap since the gates) so the synchronous sweep either ran before (404/410 above) or sees it open and skips.
    trackExportDownload(job.id, res);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(file.path, exportDownloadName(job), { cacheControl: false, dotfiles: "allow" }, (err) => {
      if (!err || res.headersSent) return; // mid-stream failure: client resumes with Range
      const e = err as NodeJS.ErrnoException & { status?: number; statusCode?: number; headers?: Record<string, string> };
      if (e.code === "ENOENT") return res.status(410).json(GONE);
      // send reports 416 (unsatisfiable Range) through the callback with its Content-Range header on the error.
      const st = e.statusCode ?? e.status;
      if (st === 416) {
        if (e.headers) res.set(e.headers);
        return res.status(416).end();
      }
      return res.status(500).json({ error: "Download failed." });
    });
  });
}
