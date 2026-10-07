import { describe, it, expect } from "vitest";
import {
  defaultExportName, exportFileName, exportLimitsHint, exportRowCapMessage, relativeExpiry,
  formatExportBytes, parseExportTimestamp, exportStatusLabel, isTerminalExportStatus, exportDisplayName,
  type ExportJobStatus,
} from "./exportFormat";

describe("exportFormat", () => {
  it("EXPFMTC-default-name: local-time stamp, padded, 'Export' fallback", () => {
    expect(defaultExportName("Taxi trips", new Date(2026, 9, 7, 14, 30))).toBe("Taxi trips 2026-10-07 1430");
    expect(defaultExportName("  ", new Date(2026, 9, 7, 14, 30)).startsWith("Export 2026-10-07")).toBe(true);
    expect(defaultExportName(undefined, new Date(2026, 9, 7, 14, 30)).startsWith("Export 2026-10-07")).toBe(true);
    expect(defaultExportName("T", new Date(2026, 0, 5, 9, 5))).toBe("T 2026-01-05 0905");
  });
  it("EXPFMTC-file-name: trims and appends extension", () => {
    expect(exportFileName(" a b ", false)).toBe("a b.csv");
    expect(exportFileName(" a b ", true)).toBe("a b.csv.gz");
  });
  it("EXPFMTC-limits: hint composition", () => {
    expect(exportLimitsHint({ maxRows: 10000000, maxFileMb: 2048, maxConcurrentPerUser: 2 })).toBe("Limits: 10,000,000 rows · 2 GB · 2 at a time");
    expect(exportLimitsHint({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 })).toBe("Limits: 2 at a time");
    expect(exportLimitsHint({ maxRows: null, maxFileMb: 1536, maxConcurrentPerUser: null })).toBe("Limits: 1,536 MB");
    expect(exportLimitsHint({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: null })).toBeNull();
  });
  it("EXPFMTC-row-cap: identical to server text", () => {
    expect(exportRowCapMessage(12345678, 10000000)).toBe(
      "This export has 12,345,678 rows; the limit is 10,000,000. Add filters to narrow it down and try again.");
  });
  it("EXPFMTC-expiry: relative buckets", () => {
    const now = Date.parse("2026-10-07T12:00:00.000Z");
    const at = (ms: number) => new Date(now + ms).toISOString();
    const H = 3_600_000;
    expect(relativeExpiry(at(25 * H), now)).toBe("in 1 d");
    expect(relativeExpiry(at(23.5 * H), now)).toBe("in 23 h");
    expect(relativeExpiry(at(59 * 60_000), now)).toBe("in 59 min");
    expect(relativeExpiry(at(30_000), now)).toBe("in under 1 min");
    expect(relativeExpiry(at(0), now)).toBe("Expired");
    expect(relativeExpiry(at(-H), now)).toBe("Expired");
    expect(relativeExpiry(null, now)).toBe("—");
  });
  it("EXPFMTC-bytes: unit scaling", () => {
    expect(formatExportBytes(null)).toBe("—");
    expect(formatExportBytes(512)).toBe("512 B");
    expect(formatExportBytes(12 * 1024)).toBe("12 KB");
    expect(formatExportBytes(340 * 1024 ** 2)).toBe("340 MB");
    expect(formatExportBytes(1.2 * 1024 ** 3)).toBe("1.2 GB");
  });
  it("EXPFMTC-timestamp: SQLite string is UTC, ISO passes through", () => {
    expect(parseExportTimestamp("2026-10-07 14:30:00").toISOString()).toBe("2026-10-07T14:30:00.000Z");
    expect(parseExportTimestamp("2026-10-07T14:30:00.000Z").toISOString()).toBe("2026-10-07T14:30:00.000Z");
  });
  it("EXPFMTC-status: labels and terminal set", () => {
    const labels: Record<ExportJobStatus, string> = {
      queued: "Queued", running: "Running", complete: "Complete", failed: "Failed", cancelled: "Cancelled", session_expired: "Session ended",
    };
    for (const [s, l] of Object.entries(labels)) expect(exportStatusLabel(s as ExportJobStatus)).toBe(l);
    const terminal = (Object.keys(labels) as ExportJobStatus[]).filter(isTerminalExportStatus).sort();
    expect(terminal).toEqual(["cancelled", "complete", "failed", "session_expired"]);
  });
  it("EXPFMTC-display-name: name or Export <date>", () => {
    expect(exportDisplayName({ name: "Q1", createdAt: "2026-10-07 14:30:00" })).toBe("Q1");
    expect(exportDisplayName({ name: null, createdAt: "2026-10-07 14:30:00" }).startsWith("Export ")).toBe(true);
  });
});
