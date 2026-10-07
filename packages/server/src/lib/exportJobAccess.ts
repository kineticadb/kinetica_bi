/**
 * Phase 129 EXPRT-V126-11/13 — ownership, client DTO, download name and servable-file rules
 * shared by every /api/exports route.
 */
import fs from "node:fs";
import path from "node:path";
import { getExportJob, type ExportJob } from "../db";
import { getExportDir } from "./exportRunner";

export const EXPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sameExportOwner = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** undefined for malformed id, unknown id, or another user's job — callers MUST answer all three identically. */
export const findOwnedExportJob = (id: string, username: string): ExportJob | undefined => {
  if (!EXPORT_UUID_RE.test(id)) return undefined; // no DB lookup for malformed ids
  const job = getExportJob(id);
  return job && sameExportOwner(job.username, username) ? job : undefined;
};

// Phase 130 adds `expiresAt` and Phase 131 a user-supplied name to toExportJobDto / exportDownloadName.
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
  gzip: boolean;
};

const parseGzip = (s: string | null): boolean => {
  try {
    return JSON.parse(s ?? "{}")?.gzip === true;
  } catch {
    return false;
  }
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
  gzip: parseGzip(job.optionsJson),
});

export const exportDownloadName = (job: Pick<ExportJob, "id" | "createdAt" | "filePath">): string =>
  `export-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}${job.filePath?.endsWith(".csv.gz") ? ".csv.gz" : ".csv"}`;

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
