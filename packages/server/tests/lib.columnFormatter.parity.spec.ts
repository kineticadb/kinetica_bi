import { describe, it, expect } from "vitest";
import * as web from "../../web/src/lib/columnFormatter";
import * as server from "../src/lib/columnFormatter";

const NUM_VECTORS: unknown[] = [0, 1.5, -1234.567, 1e9, "12.5", "abc", null, undefined, NaN];
const DATE_VECTORS: unknown[] = [1696680000000, 1696680000, "2026-10-07T14:30:00Z", "2026-10-07 14:30:00", "not a date", null];

const same = (spec: any, vectors: unknown[]) => {
  vectors.forEach((v, i) => {
    expect(server.buildFormatter(spec)(v), `vector #${i} (${String(v)}) spec ${JSON.stringify(spec)}`).toEqual(
      web.buildFormatter(spec)(v),
    );
  });
};

describe("client/server column formatter parity", () => {
  it("CMFPARITY-number", () => {
    same({ kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false }, NUM_VECTORS);
    same({ kind: "number", thousandsSep: false, decimals: 0, currency: false, percent: true }, NUM_VECTORS);
    expect(server.buildFormatter({ kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false })(-1234.567)).toBe(
      web.buildFormatter({ kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false })(-1234.567),
    );
  });
  it("CMFPARITY-d3", () => {
    for (const specifier of [",.2f", ".1%", "$,.0f", "~s"]) same({ kind: "d3", specifier }, NUM_VECTORS);
  });
  it("CMFPARITY-si", () => {
    for (const decimals of [0, 1, 2]) same({ kind: "si", decimals }, NUM_VECTORS);
  });
  it("CMFPARITY-date", () => {
    for (const preset of ["iso", "us", "long", "us_time", "long_time"]) same({ kind: "date", preset }, DATE_VECTORS);
    same({ kind: "date", preset: "custom", customPattern: "YYYY/MM/DD HH:mm:ss" }, DATE_VECTORS);
  });
  it("CMFPARITY-none", () => {
    for (const spec of [null, undefined, { kind: "none" }]) {
      same(spec, [...NUM_VECTORS, ...DATE_VECTORS]);
      expect(server.buildFormatter(spec as any)("x")).toBe("x");
    }
  });
  it("CMFPARITY-normalize", () => {
    DATE_VECTORS.forEach((v, i) => expect(server.normalizeToMs(v), `vector #${i}`).toEqual(web.normalizeToMs(v)));
  });
});
