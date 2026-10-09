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
import { db, finalizeExportJob, getExportJob, insertExportJob, markExportJobRunning, createDashboard, createWidget, createTable } from "../src/db";
import { createSession } from "../src/sessionStore";
import { startExport, __exportRunForTest } from "../src/lib/exportRunner";
import {
  trackExportDownload,
  isExportDownloading,
  removeExportFiles,
  runExportSweepOnce,
  reconcileExportsOnBoot,
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
const mkTerminal = (status: "complete" | "failed" | "cancelled" | "session_expired", ageHours: number, withFile = true, ext = ".csv"): { id: string; file: string } => {
  const id = mkJob();
  const file = path.join(dir, `${id}${ext}`);
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

  it("EXPSWEEP-tracker-already-closed: a response that already closed is not tracked (would never release)", () => {
    const id = randomUUID();
    const closed = Object.assign(new EventEmitter(), { destroyed: true });
    trackExportDownload(id, closed);
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

const RESTART_MSG = "Export stopped: the server restarted. Start it again.";
const touch = (name: string, body = "x") => fs.writeFileSync(path.join(dir, name), body);

describe("exportCleanup boot reconcile", () => {
  it("EXPBOOT-interrupted: queued + running rows fail with server_restarted and partials are removed", () => {
    const q = mkJob();
    const r = mkJob();
    markExportJobRunning(r);
    touch(`${q}.csv.part`);
    touch(`${r}.csv.gz.part`);
    const res = reconcileExportsOnBoot();
    expect(res.failed).toBe(2);
    for (const id of [q, r]) {
      const j = getExportJob(id)!;
      expect(j.status).toBe("failed");
      expect(j.errorCode).toBe("server_restarted");
      expect(j.errorMessage).toBe(RESTART_MSG);
      expect(j.finishedAt).toBeTruthy();
    }
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("EXPBOOT-keeps-complete-file: a complete row's file is kept", () => {
    const a = mkTerminal("complete", 1);
    reconcileExportsOnBoot();
    expect(fs.existsSync(a.file)).toBe(true);
  });

  it("EXPBOOT-orphans: only unowned own-name files are removed (a .part beside a complete file is an orphan)", () => {
    const A = randomUUID();
    const B = mkTerminal("failed", 1).id;
    const C = mkTerminal("complete", 1);
    const D = randomUUID();
    touch(`${A}.csv`);
    touch(`${B}.csv.gz`);
    touch(`${C.id}.csv.part`);
    touch(`${D}.csv.gz.part`);
    const res = reconcileExportsOnBoot();
    expect(res.orphansRemoved).toBe(4);
    expect(fs.readdirSync(dir)).toEqual([`${C.id}.csv`]);
  });

  it("EXPBOOT-zip-orphans: unowned .zip/.zip.part/legacy .csv.gz removed, the owned .zip kept", () => {
    const A = randomUUID();
    const B = mkTerminal("failed", 1).id;
    const C = mkTerminal("complete", 1, true, ".zip");
    const D = randomUUID();
    touch(`${A}.zip`);
    touch(`${B}.zip.part`);
    touch(`${D}.csv.gz`);
    const res = reconcileExportsOnBoot();
    expect(res.orphansRemoved).toBe(3);
    expect(fs.readdirSync(dir)).toEqual([`${C.id}.zip`]);
  });

  it("EXPCLEAN-zip-remove: removeExportFiles deletes the .zip and its .zip.part", () => {
    const id = randomUUID();
    touch(`${id}.zip`);
    touch(`${id}.zip.part`);
    removeExportFiles({ id, filePath: path.join(dir, `${id}.zip`) });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("EXPBOOT-foreign-untouched: non-matching names, dirs and symlinks are left alone", () => {
    const outside = path.join(os.tmpdir(), `kbi-outside-${randomUUID()}.csv`);
    fs.writeFileSync(outside, "precious");
    const u1 = randomUUID();
    const u2 = randomUUID();
    const u3 = randomUUID();
    touch("notes.txt");
    touch(`${u1}.csv.bak`);
    touch(`${randomUUID()}.zip.bak`);
    fs.mkdirSync(path.join(dir, `${u3}.csv`));
    fs.symlinkSync(outside, path.join(dir, `${u2}.csv`));
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = reconcileExportsOnBoot();
      expect(res.unrecognised).toBe(5);
      expect(res.orphansRemoved).toBe(0);
      expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
      expect(fs.existsSync(path.join(dir, `${u1}.csv.bak`))).toBe(true);
      expect(fs.statSync(path.join(dir, `${u3}.csv`)).isDirectory()).toBe(true);
      expect(fs.lstatSync(path.join(dir, `${u2}.csv`)).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(outside, "utf8")).toBe("precious");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("EXPBOOT-missing-dir: no throw, zero counts, directory not created", () => {
    const missing = path.join(dir, "nope");
    process.env.EXPORT_DIR = missing;
    expect(reconcileExportsOnBoot()).toEqual({ failed: 0, orphansRemoved: 0, unrecognised: 0 });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("EXPBOOT-skip-live: a run this process owns is neither failed nor has its .part removed", async () => {
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    const sid = createSession({ username: "bootuser", secret: "s", kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("expboot-" + Math.random());
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    const widgetId = createWidget(dash.id, {
      title: "w", type: "records", position: 0,
      config: { tableId: t.id, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" },
    }).id;
    const respond = (encoded: unknown, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ status: "OK", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded), ...extra }) }), { status: 200 });
    let release!: () => void;
    const deferred = new Promise<void>((r) => (release = r));
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_u: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt) || /^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [100] });
      calls++;
      if (calls === 2) await deferred;
      const n = Math.min(body.limit, Math.max(0, 100 - body.offset));
      const ids = Array.from({ length: n }, (_, k) => body.offset + k);
      return respond(
        { column_headers: ["id", "name", "amount"], column_1: ids, column_2: ids.map((i) => `n${i}`), column_3: ids.map((i) => i * 1.5) },
        { has_more_records: body.offset + n < 100 },
      );
    }));
    try {
      const { jobId } = startExport({ spec: { widgetId }, sid, username: "bootuser" });
      const run = __exportRunForTest(jobId)!;
      const t0 = Date.now();
      while (calls < 2 || !fs.existsSync(path.join(dir, `${jobId}.csv.part`))) {
        if (Date.now() - t0 > 3000) throw new Error("timeout");
        await new Promise((r) => setTimeout(r, 5));
      }
      const res = reconcileExportsOnBoot();
      expect(res.failed).toBe(0);
      expect(res.orphansRemoved).toBe(0);
      expect(getExportJob(jobId)!.status).toBe("running");
      expect(fs.existsSync(path.join(dir, `${jobId}.csv.part`))).toBe(true);
      release();
      await run;
    } finally {
      release();
      process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
      vi.unstubAllGlobals();
    }
  });

  it("EXPBOOT-log-once: one summary line and one warning line", () => {
    const j = mkJob();
    touch(`${j}.csv.part`);
    touch(`${randomUUID()}.csv`);
    touch("notes.txt");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reconcileExportsOnBoot();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[export] reconcile: 1 interrupted jobs failed, 1 orphan files removed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[export] reconcile: left 1 unrecognised file(s) in EXPORT_DIR untouched");
  });

  it("EXPBOOT-silent: nothing to do logs nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reconcileExportsOnBoot();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("EXPBOOT-never-throws: an unreadable EXPORT_DIR is logged, not thrown", () => {
    const file = path.join(dir, "afile");
    fs.writeFileSync(file, "x");
    process.env.EXPORT_DIR = file; // readdirSync -> ENOTDIR
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reconcileExportsOnBoot()).not.toThrow();
    expect(err).toHaveBeenCalled();
  });
});
