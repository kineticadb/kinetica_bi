import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportCapError,
  RowCapError,
  SizeCapError,
  concurrencyCapMessage,
  getExportLimits,
  getExportMaxConcurrentPerUser,
  getExportMaxFileMb,
  getExportMaxRows,
  getExportTtlHours,
  rowCapMessage,
  sizeCapMessage,
} from "../src/lib/exportCaps";

const VARS = ["EXPORT_TTL_HOURS", "EXPORT_MAX_ROWS", "EXPORT_MAX_FILE_MB", "EXPORT_MAX_CONCURRENT_PER_USER"];

describe("exportCaps", () => {
  beforeEach(() => {
    for (const v of VARS) vi.stubEnv(v, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("EXPCAP-env-defaults", () => {
    expect(getExportTtlHours()).toBe(24);
    expect(getExportMaxRows()).toBeNull();
    expect(getExportMaxFileMb()).toBeNull();
    expect(getExportMaxConcurrentPerUser()).toBe(2);
    expect(getExportLimits()).toEqual({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 });
  });

  it("EXPCAP-env-set", () => {
    vi.stubEnv("EXPORT_TTL_HOURS", "48");
    vi.stubEnv("EXPORT_MAX_ROWS", "10000000");
    vi.stubEnv("EXPORT_MAX_FILE_MB", "2048");
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "3");
    expect(getExportTtlHours()).toBe(48);
    expect(getExportMaxRows()).toBe(10000000);
    expect(getExportMaxFileMb()).toBe(2048);
    expect(getExportMaxConcurrentPerUser()).toBe(3);
  });

  it("EXPCAP-env-invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["abc", "0", "-5", "1.5"]) {
      for (const v of VARS) vi.stubEnv(v, bad);
      expect(getExportTtlHours()).toBe(24);
      expect(getExportMaxRows()).toBeNull();
      expect(getExportMaxFileMb()).toBeNull();
      expect(getExportMaxConcurrentPerUser()).toBe(2);
    }
    expect(warn).toHaveBeenCalled();
    const n = warn.mock.calls.length;
    // repeated reads of the same name+value do not warn again
    for (const v of VARS) vi.stubEnv(v, "1.5");
    getExportTtlHours();
    getExportMaxRows();
    getExportMaxFileMb();
    getExportMaxConcurrentPerUser();
    expect(warn.mock.calls.length).toBe(n);
    // once per name+value: a fresh bad value warns exactly once even over repeated reads
    vi.stubEnv("EXPORT_TTL_HOURS", "zzz-once");
    getExportTtlHours();
    getExportTtlHours();
    expect(warn.mock.calls.length).toBe(n + 1);
  });

  it("EXPCAP-env-read-per-call", () => {
    vi.stubEnv("EXPORT_TTL_HOURS", "5");
    expect(getExportTtlHours()).toBe(5);
    vi.stubEnv("EXPORT_TTL_HOURS", "6");
    expect(getExportTtlHours()).toBe(6);
  });

  it("EXPCAP-msg-row", () => {
    expect(rowCapMessage(12400000, 10000000)).toBe(
      "This export has 12,400,000 rows; the limit is 10,000,000. Add filters to narrow it down and try again.",
    );
  });

  it("EXPCAP-msg-size-nogzip", () => {
    expect(sizeCapMessage({ capMb: 2048, rowsAtCut: 3100000, totalRows: 12400000, gzip: false })).toBe(
      "This export passed the 2 GB size limit after 3,100,000 of 12,400,000 rows. Add filters to narrow it down and try again. You can also compress it (.csv.gz) to make the file smaller.",
    );
  });

  it("EXPCAP-msg-size-gzip", () => {
    expect(sizeCapMessage({ capMb: 2048, rowsAtCut: 3100000, totalRows: 12400000, gzip: true })).toBe(
      "This export passed the 2 GB size limit after 3,100,000 of 12,400,000 rows. Add filters to narrow it down and try again.",
    );
  });

  it("EXPCAP-msg-size-mb", () => {
    expect(sizeCapMessage({ capMb: 500, rowsAtCut: 1, totalRows: 2, gzip: true })).toContain("the 500 MB size limit");
    expect(sizeCapMessage({ capMb: 1536, rowsAtCut: 1, totalRows: 2, gzip: true })).toContain("the 1,536 MB size limit");
    expect(sizeCapMessage({ capMb: 500, rowsAtCut: 3100000, totalRows: null, gzip: true })).toBe(
      "This export passed the 500 MB size limit after 3,100,000 rows. Add filters to narrow it down and try again.",
    );
  });

  it("EXPCAP-msg-conc", () => {
    expect(concurrencyCapMessage(2)).toBe(
      "You already have 2 exports running. Wait for one to finish or cancel one, then try again.",
    );
    expect(concurrencyCapMessage(1)).toBe(
      "You already have 1 export running. Wait for one to finish or cancel one, then try again.",
    );
  });

  it("EXPCAP-errors", () => {
    const s = new SizeCapError(10, 5);
    expect(s.name).toBe("SizeCapError");
    expect(s.name).not.toBe("AbortError");
    expect(s.maxBytes).toBe(10);
    expect(s.rowsAtCut).toBe(5);
    const r = new RowCapError(20, 10);
    expect(r.name).toBe("RowCapError");
    expect(r.total).toBe(20);
    const c = new ExportCapError("nope");
    expect(c.code).toBe("concurrency_cap");
    expect(c.name).toBe("ExportCapError");
    expect(c.message).toBe("nope");
  });
});
