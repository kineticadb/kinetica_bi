/**
 * lib.exportJobAccess.spec.ts - Phase 129 Plan 01 (EXPRT-V126-11, EXPRT-V126-13).
 * Synthetic fixtures only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, finalizeExportJob, getExportJob, insertExportJob, markExportJobRunning } from "../src/db";
import {
  EXPORT_UUID_RE,
  exportDownloadName,
  findOwnedExportJob,
  resolveServableExportFile,
  toExportJobDto,
} from "../src/lib/exportJobAccess";

let dir = "";
const extraDirs: string[] = [];
beforeEach(() => {
  db.exec("DELETE FROM export_jobs");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-acc-"));
  process.env.EXPORT_DIR = dir;
});
afterEach(() => {
  process.env.EXPORT_DIR = "";
  for (const d of [dir, ...extraDirs.splice(0)]) fs.rmSync(d, { recursive: true, force: true });
});

const mk = (username = "alice", optionsJson: string | null = null, id: string = randomUUID()) =>
  insertExportJob({ id, username, sid: "SID-SECRET", dashboardId: 3, widgetId: 7, specJson: '{"spec":"SPEC-SECRET"}', optionsJson });

/** Complete job with a real file at filePath (default <dir>/<id>.csv). */
const mkComplete = (opts: { file?: (id: string) => string; fileBytes?: (real: number) => number; write?: boolean } = {}) => {
  const j = mk();
  const filePath = opts.file ? opts.file(j.id) : path.join(dir, `${j.id}.csv`);
  const content = "a,b\r\n1,2\r\n";
  if (opts.write !== false) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  const real = Buffer.byteLength(content);
  markExportJobRunning(j.id);
  finalizeExportJob(j.id, "complete", { rowsWritten: 1, filePath, fileBytes: opts.fileBytes ? opts.fileBytes(real) : real });
  return getExportJob(j.id)!;
};

describe("exportJobAccess", () => {
  it("EXPACC129-uuid-re: accepts UUIDs, rejects junk", () => {
    expect(EXPORT_UUID_RE.test(randomUUID())).toBe(true);
    expect(EXPORT_UUID_RE.test("1")).toBe(false);
    expect(EXPORT_UUID_RE.test("../etc/passwd")).toBe(false);
    expect(EXPORT_UUID_RE.test(`${randomUUID()}.csv`)).toBe(false);
    expect(EXPORT_UUID_RE.test("")).toBe(false);
  });

  it("EXPACC129-owner-match: owner finds the job", () => {
    const j = mk("alice");
    expect(findOwnedExportJob(j.id, "alice")?.id).toBe(j.id);
  });

  it("EXPACC129-owner-case: case/whitespace-insensitive owner", () => {
    const j = mk("Alice");
    expect(findOwnedExportJob(j.id, "alice")?.id).toBe(j.id);
    expect(findOwnedExportJob(j.id, " ALICE ")?.id).toBe(j.id);
  });

  it("EXPACC129-not-owner: other user gets undefined", () => {
    const j = mk("alice");
    expect(findOwnedExportJob(j.id, "bob")).toBeUndefined();
  });

  it("EXPACC129-missing-and-malformed: both undefined", () => {
    expect(findOwnedExportJob(randomUUID(), "alice")).toBeUndefined();
    expect(findOwnedExportJob("not-a-uuid", "alice")).toBeUndefined();
  });

  it("EXPACC129-dto-keys: exact key set, no secrets", () => {
    const j = mkComplete();
    const dto = toExportJobDto(j);
    expect(Object.keys(dto).sort()).toEqual([
      "createdAt", "dashboardId", "errorCode", "errorMessage", "fileBytes", "finishedAt",
      "gzip", "id", "rowsWritten", "startedAt", "status", "totalRows", "widgetId",
    ]);
    const json = JSON.stringify(dto);
    expect(json).not.toContain("SID-SECRET");
    expect(json).not.toContain("alice");
    expect(json).not.toContain(j.filePath!);
    expect(json).not.toContain("SPEC-SECRET");
  });

  it("EXPACC129-dto-gzip: parses gzip flag safely", () => {
    expect(toExportJobDto(mk("a", '{"gzip":true}')).gzip).toBe(true);
    expect(toExportJobDto(mk("a", null)).gzip).toBe(false);
    expect(toExportJobDto(mk("a", "{}")).gzip).toBe(false);
    expect(toExportJobDto(mk("a", "{")).gzip).toBe(false);
  });

  it("EXPACC129-name: download name seam", () => {
    const base = { id: "3a6ab67f-0000-4000-8000-000000000000", createdAt: "2026-10-07 12:34:56" };
    expect(exportDownloadName({ ...base, filePath: "/x/y.csv" })).toBe("export-2026-10-07-3a6ab67f.csv");
    expect(exportDownloadName({ ...base, filePath: "/x/y.csv.gz" })).toBe("export-2026-10-07-3a6ab67f.csv.gz");
  });

  it("EXPACC129-servable-ok: returns path and size", () => {
    const j = mkComplete();
    expect(resolveServableExportFile(j)).toEqual({ path: j.filePath, size: j.fileBytes });
  });

  it("EXPACC129-servable-missing: deleted file -> null", () => {
    const j = mkComplete();
    fs.rmSync(j.filePath!);
    expect(resolveServableExportFile(j)).toBeNull();
  });

  it("EXPACC129-servable-size: size mismatch -> null", () => {
    const j = mkComplete({ fileBytes: (r) => r + 1 });
    expect(resolveServableExportFile(j)).toBeNull();
  });

  it("EXPACC129-servable-part: .part -> null", () => {
    const j = mkComplete({ file: (id) => path.join(dir, `${id}.csv.part`) });
    expect(resolveServableExportFile(j)).toBeNull();
  });

  it("EXPACC129-servable-foreign: another job's basename -> null", () => {
    const j = mkComplete({ file: () => path.join(dir, `${randomUUID()}.csv`) });
    expect(resolveServableExportFile(j)).toBeNull();
  });

  it("EXPACC129-servable-outside: file outside EXPORT_DIR -> null", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-acc-other-"));
    extraDirs.push(other);
    const j = mkComplete({ file: (id) => path.join(other, `${id}.csv`) });
    expect(resolveServableExportFile(j)).toBeNull();
  });

  it("EXPACC129-servable-null: null filePath -> null", () => {
    const j = mk();
    expect(resolveServableExportFile({ id: j.id, filePath: null, fileBytes: 5 })).toBeNull();
  });
});
