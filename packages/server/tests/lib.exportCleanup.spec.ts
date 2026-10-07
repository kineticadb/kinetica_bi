/**
 * Phase 130 Plan 03 — exportCleanup (EXPRT-V126-14). Do NOT assert a fixed server pass-count (SET-BASED gate).
 * Structural proof only: refcount skip + synchronous sweep. The live held-open HTTP race is Plan 130-04's job.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { db, finalizeExportJob, getExportJob, insertExportJob, markExportJobRunning } from "../src/db";
import {
  trackExportDownload,
  isExportDownloading,
  removeExportFiles,
  runExportSweepOnce,
  startExportSweep,
  EXPORT_SWEEP_INTERVAL_MS,
  __resetExportDownloadsForTest,
} from "../src/lib/exportCleanup";

let dir: string;

beforeEach(() => {
  db.prepare("DELETE FROM export_jobs").run();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expclean-"));
  process.env.EXPORT_DIR = dir;
  __resetExportDownloadsForTest();
});
afterEach(() => {
  process.env.EXPORT_DIR = "";
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mkJob = (): string => {
  const id = randomUUID();
  insertExportJob({ id, username: "u", sid: "s", dashboardId: null, widgetId: null, specJson: "{}", optionsJson: null });
  return id;
};
const mkTerminal = (status: "complete" | "failed" | "cancelled" | "session_expired", ageHours: number, withFile = true): { id: string; file: string } => {
  const id = mkJob();
  const file = path.join(dir, `${id}.csv`);
  if (status === "complete") {
    if (withFile) fs.writeFileSync(file, "a,b\n");
    finalizeExportJob(id, "complete", { rowsWritten: 1, filePath: file, fileBytes: 4 });
  } else {
    finalizeExportJob(id, status, { errorMessage: "x" });
  }
  db.prepare("UPDATE export_jobs SET finished_at = datetime('now', ?) WHERE id = ?").run(`-${ageHours} hours`, id);
  return { id, file };
};

describe("exportCleanup sweep", () => {
  it("EXPSWEEP-tracker-refcount: two downloads, idempotent close, released only when both closed", () => {
    const id = randomUUID();
    const e1 = new EventEmitter();
    const e2 = new EventEmitter();
    trackExportDownload(id, e1);
    trackExportDownload(id, e2);
    expect(isExportDownloading(id)).toBe(true);
    e1.emit("close");
    expect(isExportDownloading(id)).toBe(true);
    e1.emit("close");
    expect(isExportDownloading(id)).toBe(true);
    e2.emit("close");
    expect(isExportDownloading(id)).toBe(false);
  });

  it("EXPSWEEP-deletes-expired-all-statuses: complete/failed/cancelled/session_expired past TTL are removed", () => {
    const a = mkTerminal("complete", 25);
    const ids = [a.id, mkTerminal("failed", 25).id, mkTerminal("cancelled", 25).id, mkTerminal("session_expired", 25).id];
    expect(fs.existsSync(a.file)).toBe(true);
    expect(runExportSweepOnce()).toEqual({ deleted: 4, skippedOpen: 0 });
    for (const id of ids) expect(getExportJob(id)).toBeUndefined();
    expect(fs.existsSync(a.file)).toBe(false);
  });

  it("EXPSWEEP-keeps-unexpired: 23h-old complete row and file kept", () => {
    const a = mkTerminal("complete", 23);
    expect(runExportSweepOnce()).toEqual({ deleted: 0, skippedOpen: 0 });
    expect(getExportJob(a.id)).toBeDefined();
    expect(fs.existsSync(a.file)).toBe(true);
  });

  it("EXPSWEEP-ttl-env: EXPORT_TTL_HOURS=1 expires a 2h-old row", () => {
    vi.stubEnv("EXPORT_TTL_HOURS", "1");
    const a = mkTerminal("complete", 2);
    expect(runExportSweepOnce().deleted).toBe(1);
    expect(getExportJob(a.id)).toBeUndefined();
  });

  it("EXPSWEEP-never-active: running row and its .part are untouched", () => {
    const id = mkJob();
    markExportJobRunning(id);
    const part = path.join(dir, `${id}.csv.part`);
    fs.writeFileSync(part, "x");
    db.prepare("UPDATE export_jobs SET created_at = datetime('now','-99 hours') WHERE id = ?").run(id);
    expect(runExportSweepOnce()).toEqual({ deleted: 0, skippedOpen: 0 });
    expect(getExportJob(id)?.status).toBe("running");
    expect(fs.existsSync(part)).toBe(true);
  });

  it("EXPSWEEP-open-download: skipped while a download is open, removed after close", () => {
    const a = mkTerminal("complete", 25);
    const res = new EventEmitter();
    trackExportDownload(a.id, res);
    expect(runExportSweepOnce()).toEqual({ deleted: 0, skippedOpen: 1 });
    expect(getExportJob(a.id)).toBeDefined();
    expect(fs.existsSync(a.file)).toBe(true);
    res.emit("close");
    expect(runExportSweepOnce()).toEqual({ deleted: 1, skippedOpen: 0 });
    expect(getExportJob(a.id)).toBeUndefined();
    expect(fs.existsSync(a.file)).toBe(false);
  });

  it("EXPSWEEP-sync: runExportSweepOnce is synchronous", () => {
    const r = runExportSweepOnce();
    expect(r).not.toBeInstanceOf(Promise);
    expect(typeof (r as { deleted: number }).deleted).toBe("number");
    expect(runExportSweepOnce.constructor.name).not.toBe("AsyncFunction");
  });

  it("EXPSWEEP-remove-files-guard: a foreign file_path basename is never removed", () => {
    const id = randomUUID();
    const foreign = path.join(os.tmpdir(), `kbi-foreign-${randomUUID()}.txt`);
    fs.writeFileSync(foreign, "keep me");
    const own = path.join(dir, `${id}.csv.part`);
    fs.writeFileSync(own, "x");
    try {
      removeExportFiles({ id, filePath: foreign });
      expect(fs.existsSync(foreign)).toBe(true);
      expect(fs.existsSync(own)).toBe(false);
    } finally {
      fs.rmSync(foreign, { force: true });
    }
  });

  it("EXPSWEEP-row-kept-on-unlink-failure: failed unlink keeps the row and the pass continues", () => {
    const a = mkTerminal("failed", 25);
    const b = mkTerminal("failed", 25);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    const r = runExportSweepOnce();
    expect(r.deleted).toBe(1);
    const remaining = [a.id, b.id].filter((id) => getExportJob(id));
    expect(remaining).toHaveLength(1);
  });

  it("EXPSWEEP-interval: first pass runs at start, then every EXPORT_SWEEP_INTERVAL_MS", () => {
    vi.useFakeTimers();
    const A = mkTerminal("failed", 25);
    const handle = startExportSweep();
    try {
      expect(getExportJob(A.id)).toBeUndefined();
      const B = mkTerminal("failed", 25);
      expect(getExportJob(B.id)).toBeDefined();
      vi.advanceTimersByTime(EXPORT_SWEEP_INTERVAL_MS);
      expect(getExportJob(B.id)).toBeUndefined();
    } finally {
      clearInterval(handle);
    }
  });
});
