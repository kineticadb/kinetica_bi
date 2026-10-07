/**
 * Phase 130 EXPRT-V126-14 — export expiry sweep, open-download tracking and boot reconciliation.
 * Wired by exportRoutes.ts (download/DELETE) and the index.ts bootstrap IIFE (NEVER createApp).
 */
import fs from "node:fs";
import path from "node:path";
import { getExportDir, exportFilePaths, isExportRunLive } from "./exportRunner";
import { getExportTtlHours, EXPORT_SERVER_RESTARTED_MESSAGE } from "./exportCaps";
import {
  listExpiredExportJobs,
  listActiveExportJobs,
  listCompleteExportFilePaths,
  deleteExportJob,
  finalizeExportJob,
  type ExportJob,
} from "../db";

const openDownloads = new Map<string, number>();
export const isExportDownloading = (id: string): boolean => (openDownloads.get(id) ?? 0) > 0;

/** Call in the download route's synchronous gate segment, before res.download. Released on the response's
 *  'close', which fires on completion AND on client abort, so an aborted download can never pin a file. */
export function trackExportDownload(id: string, res: { once(event: "close", listener: () => void): unknown }): void {
  openDownloads.set(id, (openDownloads.get(id) ?? 0) + 1);
  let released = false;
  res.once("close", () => {
    if (released) return;
    released = true;
    const n = (openDownloads.get(id) ?? 1) - 1;
    if (n <= 0) openDownloads.delete(id);
    else openDownloads.set(id, n);
  });
}

export const __resetExportDownloadsForTest = (): void => openDownloads.clear();

/** Removes every file a job may own. Errors propagate to the caller. */
export function removeExportFiles(job: Pick<ExportJob, "id" | "filePath">): void {
  for (const f of exportFilePaths(job.id)) fs.rmSync(f, { force: true });
  if (job.filePath) {
    const base = path.basename(job.filePath);
    if (base === `${job.id}.csv` || base === `${job.id}.csv.gz`) fs.rmSync(job.filePath, { force: true });
  }
}

export const EXPORT_SWEEP_INTERVAL_MS = 5 * 60_000;

// INVARIANT (D-04): fully synchronous. NEVER add an await between isExportDownloading() and the delete:
// the download route checks/claims in one synchronous turn, so with no await here no interleaving exists.
export function runExportSweepOnce(): { deleted: number; skippedOpen: number } {
  let deleted = 0;
  let skippedOpen = 0;
  for (const job of listExpiredExportJobs(getExportTtlHours())) {
    if (isExportDownloading(job.id)) { skippedOpen++; continue; }
    try {
      removeExportFiles(job); // files first: a failed unlink leaves the row for the next pass
      deleteExportJob(job.id);
      deleted++;
    } catch (e) {
      console.warn(`[export] sweep: could not remove ${job.id} (${(e as NodeJS.ErrnoException).code ?? (e as Error).name}); will retry`);
    }
  }
  if (deleted > 0 || skippedOpen > 0) {
    console.log(`[export] sweep: removed ${deleted} expired export(s), skipped ${skippedOpen} with an open download`);
  }
  return { deleted, skippedOpen };
}

export function startExportSweep(): NodeJS.Timeout {
  const tick = () => {
    try { runExportSweepOnce(); } catch (err) { console.error("[export] sweep failed", err); /* next tick retries; never clearInterval */ }
  };
  tick(); // rows that expired while the server was down go immediately
  const handle = setInterval(tick, EXPORT_SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}

const OWN_EXPORT_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.csv(?:\.gz)?(?:\.part)?$/i;

/** Phase 130 D-05..D-08. Called ONCE from the index.ts bootstrap IIFE before app.listen — NEVER from createApp()
 *  (every route spec calls createApp() while other jobs may be in flight). Makes no Kinetica call (D-06). Never throws. */
export function reconcileExportsOnBoot(): { failed: number; orphansRemoved: number; unrecognised: number } {
  let failed = 0;
  let orphansRemoved = 0;
  let unrecognised = 0;
  try {
    // 1. Interrupted jobs: fail them and delete partial files; never touch a job this process is running.
    for (const job of listActiveExportJobs()) {
      if (isExportRunLive(job.id)) continue;
      if (finalizeExportJob(job.id, "failed", { errorCode: "server_restarted", errorMessage: EXPORT_SERVER_RESTARTED_MESSAGE })) failed++;
      for (const f of exportFilePaths(job.id)) fs.rmSync(f, { force: true });
    }

    // 2. Orphan files: only regular files with our own <uuid>.csv[.gz][.part] names that no complete row owns.
    const resolved = path.resolve(getExportDir());
    if (path.parse(resolved).root === resolved) {
      console.warn("[export] reconcile: EXPORT_DIR is the filesystem root; skipping the orphan scan");
    } else {
      let entries: fs.Dirent[] | null = null;
      try {
        entries = fs.readdirSync(resolved, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (entries) {
        const keep = new Set(
          listCompleteExportFilePaths()
            .filter((r) => path.resolve(path.dirname(r.filePath)) === resolved)
            .map((r) => path.basename(r.filePath)),
        );
        for (const d of entries) {
          const m = OWN_EXPORT_FILE_RE.exec(d.name);
          if (!m || !d.isFile()) { unrecognised++; continue; }
          if (keep.has(d.name) || isExportRunLive(m[1].toLowerCase())) continue;
          fs.rmSync(path.join(resolved, d.name), { force: true });
          orphansRemoved++;
        }
      }
    }
  } catch (err) {
    console.error("[export] reconcile failed", err);
    return { failed, orphansRemoved, unrecognised };
  }

  // 3. Logging (D-07/D-08): one summary line only when something was done, one warning only for foreign files.
  if (failed + orphansRemoved > 0) {
    console.log(`[export] reconcile: ${failed} interrupted jobs failed, ${orphansRemoved} orphan files removed`);
  }
  if (unrecognised > 0) {
    console.warn(`[export] reconcile: left ${unrecognised} unrecognised file(s) in EXPORT_DIR untouched`);
  }
  return { failed, orphansRemoved, unrecognised };
}
