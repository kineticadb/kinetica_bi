/**
 * Phase 129 EXPRT-V126-11/13 — ownership, client DTO, download name and servable-file rules
 * shared by every /api/exports route.
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboard, getExportJob, getWidget, type ExportJob } from "../db";
import { getExportDir } from "./exportRunner";
import { getExportTtlHours } from "./exportCaps";
import { exportDownloadBase } from "./exportName";

export const EXPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sameExportOwner = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** undefined for malformed id, unknown id, or another user's job — callers MUST answer all three identically. */
export const findOwnedExportJob = (id: string, username: string): ExportJob | undefined => {
  if (!EXPORT_UUID_RE.test(id)) return undefined; // no DB lookup for malformed ids
  const job = getExportJob(id);
  return job && sameExportOwner(job.username, username) ? job : undefined;
};

// Phase 130 added `expiresAt` (computed).
// Phase 131 added name (options_json.name), dashboardName and widgetTitle (resolved at read time; null after deletion).
export type ExportJobDto = {
  id: string;
  status: ExportJob["status"];
  widgetId: number | null;
  dashboardId: number | null;
  rowsWritten: number;
  totalRows: number | null;
  fileBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  compress: boolean;
  name: string | null;
  dashboardName: string | null;
  widgetTitle: string | null;
};

const parseExportOptions = (s: string | null | undefined): Record<string, unknown> => {
  try {
    const o = JSON.parse(s ?? "{}");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

/** Phase 130 D-02/D-03: expiry = finished_at + EXPORT_TTL_HOURS for EVERY terminal status. Computed, never stored (an env change applies retroactively). */
export const exportExpiresAt = (job: Pick<ExportJob, "finishedAt">): string | null => {
  if (!job.finishedAt) return null;
  const t = Date.parse(job.finishedAt.replace(" ", "T") + "Z"); // SQLite UTC string has no Z; without it JS parses LOCAL time
  return Number.isFinite(t) ? new Date(t + getExportTtlHours() * 3_600_000).toISOString() : null;
};
export const isExportExpired = (job: Pick<ExportJob, "finishedAt">, now: number = Date.now()): boolean => {
  const e = exportExpiresAt(job);
  return e !== null && Date.parse(e) <= now;
};

export const toExportJobDto = (job: ExportJob): ExportJobDto => ({
  id: job.id,
  status: job.status,
  widgetId: job.widgetId,
  dashboardId: job.dashboardId,
  rowsWritten: job.rowsWritten,
  totalRows: job.totalRows,
  fileBytes: job.fileBytes,
  errorCode: job.errorCode,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  expiresAt: exportExpiresAt(job),
  compress: ((o) => o.compress === true || o.gzip === true)(parseExportOptions(job.optionsJson)), // legacy rows stored gzip
  name: (() => {
    const n = parseExportOptions(job.optionsJson).name;
    return typeof n === "string" && n.trim() !== "" ? n : null;
  })(),
  dashboardName: job.dashboardId == null ? null : (getDashboard(job.dashboardId)?.name ?? null),
  widgetTitle: job.widgetId == null ? null : (getWidget(job.widgetId)?.title ?? null),
});

export const exportDownloadName = (job: Pick<ExportJob, "id" | "createdAt" | "filePath"> & { optionsJson?: string | null }): string => {
  const ext = job.filePath?.endsWith(".csv.gz") ? ".csv.gz" : ".csv";
  return exportDownloadBase(parseExportOptions(job.optionsJson).name, job.id, job.createdAt) + ext;
};

/** Does NOT check job status — the route gates that separately. */
export const resolveServableExportFile = (
  job: Pick<ExportJob, "id" | "filePath" | "fileBytes">,
): { path: string; size: number } | null => {
  const fp = job.filePath;
  if (typeof fp !== "string" || fp === "") return null;
  const base = path.basename(fp);
  if (base !== `${job.id}.csv` && base !== `${job.id}.csv.gz`) return null;
  if (path.resolve(path.dirname(fp)) !== path.resolve(getExportDir())) return null;
  try {
    const st = fs.statSync(fp);
    if (!st.isFile() || st.size !== job.fileBytes) return null;
    return { path: fp, size: st.size };
  } catch {
    return null;
  }
};
