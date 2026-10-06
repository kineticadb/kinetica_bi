import { describe, it, expect } from "vitest";
import * as web from "../../web/src/lib/csvExport";
import * as server from "../src/lib/csvExport";

export const CSV_VECTORS: unknown[] = [
  "=1+1", '=HYPERLINK("x")', "@SUM(A1)", "+cmd", "-2+3", "\tx", "\rx", "=a,b",
  "-5", "+1e6", "-3.14", -5, -3.14, 0, ".5", "a=b", "", null, undefined, true,
  'say "hi"', "line1\nline2", "plain", "-Infinity", "1e", "--5",
];

describe("client/server CSV parity", () => {
  it("CSVPARITY-field: server escapeCsvField === web escapeCsvField for every vector", () => {
    CSV_VECTORS.forEach((v, i) => {
      expect(server.escapeCsvField(v), `vector #${i}`).toBe(web.escapeCsvField(v));
    });
  });
  it("CSVPARITY-rows: server rowsToCsv === web rowsToCsv for a mixed fixture", () => {
    const columns = ["=hdr", "ok"];
    const rows = CSV_VECTORS.map((v) => ({ "=hdr": v, ok: v }));
    expect(server.rowsToCsv(rows, columns)).toBe(web.rowsToCsv(rows, columns));
    expect(server.csvLine(CSV_VECTORS)).toBe(CSV_VECTORS.map(web.escapeCsvField).join(","));
  });
});
