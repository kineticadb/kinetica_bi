/**
 * db.exportJobs.spec.ts - v1.26 Phase 128 Plan 03 (EXPRT-V126-07, EXPRT-V126-16).
 * Synthetic fixtures only.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDb,
  db,
  finalizeExportJob,
  getExportJob,
  insertExportJob,
  listExportJobsForUser,
  markExportJobRunning,
  setExportJobTotalRows,
  updateExportJobProgress,
} from "../src/db";

const tmpFiles: string[] = [];
const mkTempDbPath = (): string => {
  const p = path.join(os.tmpdir(), `kbi-expjobs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  tmpFiles.push(p);
  return p;
};
afterEach(() => {
  while (tmpFiles.length) {
    const p = tmpFiles.pop();
    for (const f of [p, `${p}-wal`, `${p}-shm`]) {
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }
});

let n = 0;
const mk = (username = "alice") =>
  insertExportJob({
    id: `job-${++n}-${Math.random().toString(36).slice(2, 6)}`,
    username,
    sid: "sid-1",
    dashboardId: 3,
    widgetId: 7,
    specJson: '{"a":1}',
    optionsJson: '{"b":2}',
  });

describe("export_jobs registry", () => {
  it("EXPDB-ddl: a fresh DB has export_jobs with exactly the expected columns", () => {
    const d = createDb(mkTempDbPath());
    const cols = (d.prepare("PRAGMA table_info(export_jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual([
      "id", "username", "sid", "dashboard_id", "widget_id", "status", "error_code", "error_message",
      "total_rows", "rows_written", "file_path", "file_bytes", "spec_json", "options_json",
      "created_at", "started_at", "finished_at",
    ]);
    d.close();
  });

  it("EXPDB-reopen: re-opening an existing DB file is idempotent", () => {
    const p = mkTempDbPath();
    createDb(p).close();
    const d = createDb(p);
    expect(d.prepare("SELECT name FROM sqlite_master WHERE name='export_jobs'").get()).toBeTruthy();
    d.close();
  });

  it("EXPDB-check: the status CHECK rejects an unknown status", () => {
    const j = mk();
    expect(() => db.prepare("UPDATE export_jobs SET status='bogus' WHERE id=?").run(j.id)).toThrow(/CHECK constraint/);
  });

  it("EXPDB-insert-get: insert returns a queued job with rows_written 0 and round-trips", () => {
    const j = mk();
    expect(j.status).toBe("queued");
    expect(j.rowsWritten).toBe(0);
    expect(j.dashboardId).toBe(3);
    expect(j.widgetId).toBe(7);
    expect(j.specJson).toBe('{"a":1}');
    expect(j.optionsJson).toBe('{"b":2}');
    expect(j.totalRows).toBeNull();
    expect(j.filePath).toBeNull();
    expect(j.finishedAt).toBeNull();
    expect(getExportJob(j.id)).toEqual(j);
  });

  it("EXPDB-running-only-from-queued: markExportJobRunning is true once, false the second time", () => {
    const j = mk();
    expect(markExportJobRunning(j.id)).toBe(true);
    expect(markExportJobRunning(j.id)).toBe(false);
    expect(getExportJob(j.id)?.startedAt).not.toBeNull();
  });

  it("EXPDB-finalize-guard: a second terminal write is refused and does not overwrite", () => {
    const j = mk();
    markExportJobRunning(j.id);
    expect(finalizeExportJob(j.id, "complete", { rowsWritten: 5, filePath: "/x", fileBytes: 10 })).toBe(true);
    expect(finalizeExportJob(j.id, "cancelled", {})).toBe(false);
    const g = getExportJob(j.id)!;
    expect(g.status).toBe("complete");
    expect(g.filePath).toBe("/x");
    expect(g.rowsWritten).toBe(5);
  });

  it("EXPDB-finalize-from-queued: a queued job can be cancelled directly", () => {
    const j = mk();
    expect(finalizeExportJob(j.id, "cancelled", {})).toBe(true);
    const g = getExportJob(j.id)!;
    expect(g.status).toBe("cancelled");
    expect(g.finishedAt).not.toBeNull();
  });

  it("EXPDB-progress: setExportJobTotalRows and updateExportJobProgress write only while running", () => {
    const j = mk();
    setExportJobTotalRows(j.id, 99);
    updateExportJobProgress(j.id, 4);
    expect(getExportJob(j.id)).toMatchObject({ totalRows: null, rowsWritten: 0 });
    markExportJobRunning(j.id);
    setExportJobTotalRows(j.id, 100);
    updateExportJobProgress(j.id, 40);
    expect(getExportJob(j.id)).toMatchObject({ totalRows: 100, rowsWritten: 40 });
    finalizeExportJob(j.id, "failed", { errorCode: "E", errorMessage: "m" });
    setExportJobTotalRows(j.id, 1);
    updateExportJobProgress(j.id, 1);
    expect(getExportJob(j.id)).toMatchObject({ totalRows: 100, rowsWritten: 40, status: "failed", errorCode: "E" });
  });

  it("EXPDB-list-newest-first: listExportJobsForUser returns only that user's jobs, newest first", () => {
    const a = [mk("lister"), mk("lister"), mk("lister")];
    mk("other");
    const ids = listExportJobsForUser("lister").map((j) => j.id);
    expect(ids).toEqual(a.map((j) => j.id).reverse());
  });

  it("EXPDB-session-expired-status: session_expired is an accepted terminal status", () => {
    const j = mk();
    markExportJobRunning(j.id);
    expect(finalizeExportJob(j.id, "session_expired", { errorCode: "SESSION_EXPIRED" })).toBe(true);
    expect(getExportJob(j.id)?.status).toBe("session_expired");
  });
});
