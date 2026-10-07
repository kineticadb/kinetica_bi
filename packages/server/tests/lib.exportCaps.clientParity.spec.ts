/** Phase 131 Plan 04 (D-08): the dialog's advance limit text must equal the server's exactly. */
import { describe, it, expect } from "vitest";
import * as web from "../../web/src/lib/exportFormat";
import * as server from "../src/lib/exportCaps";

describe("client/server export cap parity", () => {
  it("EXPCAPPAR-row-cap: rowCapMessage === exportRowCapMessage", () => {
    for (const [t, c] of [[1001, 1000], [12345678, 10000000], [2, 1]]) {
      expect(web.exportRowCapMessage(t, c), `${t}/${c}`).toBe(server.rowCapMessage(t, c));
    }
  });
  it("EXPCAPPAR-size: size and count formatting equal", () => {
    for (const mb of [1, 500, 1024, 1536, 2048, 10240]) expect(web.formatExportSizeLimit(mb)).toBe(server.formatExportSizeLimit(mb));
    for (const n of [0, 999, 1000, 1234567]) expect(web.formatExportCount(n)).toBe(server.formatExportCount(n));
  });
});
