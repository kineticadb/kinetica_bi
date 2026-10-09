/** Phase 131 Plan 04 (EXPRT-V126-08): export name sanitising. */
import { describe, it, expect } from "vitest";
import { sanitizeExportName, exportFileBase } from "../src/lib/exportName";

const len = (s: string) => Array.from(s).length;

describe("sanitizeExportName", () => {
  it("EXPNAME-display-nonstring: non-strings and blanks -> undefined", () => {
    for (const v of [undefined, 5, null, {}, "", "   "]) expect(sanitizeExportName(v)).toBeUndefined();
  });
  it("EXPNAME-display-whitespace: controls to space, collapsed, trimmed", () => {
    expect(sanitizeExportName("  Taxi\ttrips\n 2026 ")).toBe("Taxi trips 2026");
  });
  it("EXPNAME-display-bidi: bidi/format controls removed", () => {
    expect(sanitizeExportName("a‮b‏c﻿")).toBe("abc");
  });
  it("EXPNAME-display-keeps-slash: unicode and slash kept", () => {
    expect(sanitizeExportName("Résumé – 数据 / Q1")).toBe("Résumé – 数据 / Q1");
  });
  it("EXPNAME-display-cap: 200 code points", () => {
    expect(len(sanitizeExportName("数".repeat(250))!)).toBe(200);
  });
});

describe("exportFileBase", () => {
  it("EXPNAME-file-unicode: slash replaced, unicode intact", () => {
    expect(exportFileBase("Résumé – 数据 / Q1")).toBe("Résumé – 数据 - Q1");
  });
  it("EXPNAME-file-reserved: reserved chars", () => {
    expect(exportFileBase('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });
  it("EXPNAME-file-control: NUL/newline", () => {
    expect(exportFileBase("a\u0000b\nc")).toBe("a-b-c");
  });
  it("EXPNAME-file-dots-ext: dots and extensions", () => {
    expect(exportFileBase("..hidden..")).toBe("hidden");
    expect(exportFileBase("report.csv")).toBe("report");
    expect(exportFileBase("report.CSV.GZ")).toBe("report");
    expect(exportFileBase("x.csv.csv")).toBe("x.csv");
  });
  it("EXPNAME-strip-zip: a typed .zip extension is stripped", () => {
    expect(exportFileBase("report.ZIP")).toBe("report");
    expect(exportFileBase("a.zip.csv")).toBe("a.zip");
  });
  it("EXPNAME-file-device: windows device names", () => {
    expect(exportFileBase("CON")).toBe("CON_");
    expect(exportFileBase("nul")).toBe("nul_");
    expect(exportFileBase("console")).toBe("console");
  });
  it("EXPNAME-file-cap: 150 code points, no trailing dot/space", () => {
    const r = exportFileBase("a".repeat(149) + ". " + "b".repeat(150))!;
    expect(len(r)).toBeLessThanOrEqual(150);
    expect(r).not.toMatch(/[.\s]$/);
    expect(len(exportFileBase("数".repeat(300))!)).toBe(150);
  });
  it("EXPNAME-file-empty: nothing usable -> undefined", () => {
    for (const v of ["‮", "...", "", null, undefined]) expect(exportFileBase(v)).toBeUndefined();
  });
  it("EXPNAME-file-nfc: decomposed -> composed", () => {
    expect(exportFileBase("é")).toBe("é");
  });
});
