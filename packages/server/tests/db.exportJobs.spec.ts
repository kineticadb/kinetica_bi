/**
 * db.exportJobs.spec.ts - v1.26 Phase 128 Plan 03 (EXPRT-V126-07, EXPRT-V126-16).
 * Synthetic fixtures only.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  countActiveExportJobsForUser,
  createDb,
  db,
  deleteExportJob,
  finalizeExportJob,
  getExportJob,
  insertExportJob,
  listActiveExportJobs,
  listCompleteExportFilePaths,
  listExpiredExportJobs,
  listExportJobsForUser,
  markExportJobRunning,
  setExportJobTotalRows,
  updateExportJobProgress,
} from "../src/db";
import { exportFilePaths } from "../src/lib/exportRunner";

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

describe("Phase 129 additions", () => {
  it("EXPDB129-delete: deletes an existing row once", () => {
    const j = mk();
    expect(deleteExportJob(j.id)).toBe(true);
    expect(getExportJob(j.id)).toBeUndefined();
    expect(deleteExportJob(j.id)).toBe(false);
  });

  it("EXPDB129-delete-unknown: unknown id returns false and leaves others", () => {
    const j = mk();
    expect(deleteExportJob("never-existed")).toBe(false);
    expect(getExportJob(j.id)).toBeDefined();
  });

  it("EXPDB129-list-case-insensitive: matches username regardless of case, excludes others", () => {
    db.exec("DELETE FROM export_jobs");
    const a = mk("Alice");
    const b = mk("alice");
    mk("bob");
    const ids = listExportJobsForUser("ALICE").map((x) => x.id);
    expect(ids).toEqual([b.id, a.id]);
  });

  it("EXPDB129-list-stored-case: stored username keeps its case", () => {
    db.exec("DELETE FROM export_jobs");
    mk("Alice");
    expect(listExportJobsForUser("alice")[0].username).toBe("Alice");
  });

  it("EXPDB129-file-paths: returns the six known paths under the export dir", () => {
    const prev = process.env.EXPORT_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-fp-"));
    process.env.EXPORT_DIR = dir;
    try {
      expect(exportFilePaths("abc")).toEqual([
        path.join(dir, "abc.csv"), path.join(dir, "abc.zip"),
        path.join(dir, "abc.csv.part"), path.join(dir, "abc.zip.part"),
        path.join(dir, "abc.csv.gz"), path.join(dir, "abc.csv.gz.part"),
      ]);
    } finally {
      process.env.EXPORT_DIR = prev ?? "";
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 130 export job queries", () => {
  const backdate = (id: string, mod: string) =>
    db.prepare("UPDATE export_jobs SET finished_at = datetime('now', ?) WHERE id = ?").run(mod, id);

  it("EXPDB130-count-active: queued+running only, case-insensitive, per user", () => {
    const u = `cnt-${Math.random().toString(36).slice(2, 8)}`;
    const q = mk(u);
    const r = mk(u);
    markExportJobRunning(r.id);
    const c = mk(u);
    finalizeExportJob(c.id, "complete", { filePath: "x.csv", fileBytes: 1 });
    const f = mk(u);
    finalizeExportJob(f.id, "failed", { errorCode: "x" });
    const other = mk(`${u}-other`);
    expect(countActiveExportJobsForUser(u)).toBe(2);
    expect(countActiveExportJobsForUser(u.toUpperCase())).toBe(2);
    expect(countActiveExportJobsForUser(`${u}-other`)).toBe(1);
    expect(q.id).not.toBe(other.id);
  });

  it("EXPDB130-list-active: exactly the queued + running rows", () => {
    const u = `act-${Math.random().toString(36).slice(2, 8)}`;
    const q = mk(u);
    const r = mk(`${u}-b`);
    markExportJobRunning(r.id);
    const c = mk(u);
    finalizeExportJob(c.id, "complete", { filePath: "x.csv", fileBytes: 1 });
    const ids = listActiveExportJobs().map((j) => j.id);
    expect(ids).toContain(q.id);
    expect(ids).toContain(r.id);
    expect(ids).not.toContain(c.id);
    for (const j of listActiveExportJobs()) expect(["queued", "running"]).toContain(j.status);
  });

  it("EXPDB130-expired: every terminal status past the TTL, never fresh or running", () => {
    const u = `exp-${Math.random().toString(36).slice(2, 8)}`;
    const statuses = ["complete", "failed", "cancelled", "session_expired"] as const;
    const old = statuses.map((s) => {
      const j = mk(u);
      finalizeExportJob(j.id, s, {});
      backdate(j.id, "-25 hours");
      return j.id;
    });
    const fresh = mk(u);
    finalizeExportJob(fresh.id, "failed", {});
    backdate(fresh.id, "-23 hours");
    const running = mk(u);
    markExportJobRunning(running.id);
    const ids = listExpiredExportJobs(24).map((j) => j.id);
    for (const id of old) expect(ids).toContain(id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(running.id);
  });

  it("EXPDB130-expired-bad-ttl: non positive-integer ttl throws", () => {
    expect(() => listExpiredExportJobs(0)).toThrow();
    expect(() => listExpiredExportJobs(1.5)).toThrow();
  });

  it("EXPDB130-complete-files: only complete rows with a file path", () => {
    const u = `fil-${Math.random().toString(36).slice(2, 8)}`;
    const c = mk(u);
    finalizeExportJob(c.id, "complete", { filePath: `${c.id}.csv`, fileBytes: 3 });
    const c2 = mk(u);
    finalizeExportJob(c2.id, "complete", {});
    const f = mk(u);
    finalizeExportJob(f.id, "failed", { filePath: "stale.csv" });
    const q = mk(u);
    const res = listCompleteExportFilePaths();
    expect(res).toContainEqual({ id: c.id, filePath: `${c.id}.csv` });
    const ids = res.map((r) => r.id);
    for (const id of [c2.id, f.id, q.id]) expect(ids).not.toContain(id);
  });
});
