import { describe, it, expect } from "vitest";
import { escapeCsvField, rowsToCsv, csvLine } from "../src/lib/csvExport";

describe("server csvExport", () => {
  it("FORMULA-eq: =1+1 gets a leading quote", () => {
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
  });
  it("FORMULA-hyperlink: =HYPERLINK(\"x\") is prefixed then quoted", () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });
  it("FORMULA-at: @SUM(A1) gets a leading quote", () => {
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("FORMULA-plus: +cmd gets a leading quote", () => {
    expect(escapeCsvField("+cmd")).toBe("'+cmd");
  });
  it("FORMULA-minus-text: -2+3 is text, gets a leading quote", () => {
    expect(escapeCsvField("-2+3")).toBe("'-2+3");
  });
  it("FORMULA-tab: a leading TAB gets a leading quote", () => {
    expect(escapeCsvField("\tx")).toBe("'\tx");
  });
  it("FORMULA-cr: a leading CR is prefixed then quoted", () => {
    expect(escapeCsvField("\rx")).toBe("\"'\rx\"");
  });
  it("FORMULA-quote-order: prefix happens before RFC-4180 quoting", () => {
    expect(escapeCsvField("=a,b")).toBe("\"'=a,b\"");
  });
  it("FORMULA-numeric-exempt: -5, +1e6, -3.14 strings stay unchanged", () => {
    for (const v of ["-5", "+1e6", "-3.14", ".5", "-0"]) expect(escapeCsvField(v)).toBe(v);
  });
  it("FORMULA-number-type: JS numbers stay unchanged", () => {
    expect(escapeCsvField(-5)).toBe("-5");
    expect(escapeCsvField(-3.14)).toBe("-3.14");
  });
  it("FORMULA-midstring: only a LEADING trigger counts", () => {
    expect(escapeCsvField("a=b")).toBe("a=b");
    expect(escapeCsvField("")).toBe("");
  });
  it("FORMULA-header: header names go through the same guard", () => {
    expect(rowsToCsv([], ["=x", "ok"])).toBe("'=x,ok");
  });
  it("FORMULA-row: rowsToCsv neutralises cells and keeps numbers", () => {
    expect(rowsToCsv([{ a: "=1+1", b: -5, c: "-7" }], ["a", "b", "c"])).toBe("a,b,c\r\n'=1+1,-5,-7");
  });
  it("CSVLINE-join: csvLine escapes each value and joins with commas", () => {
    expect(csvLine(["=1+1", -5, null, "a,b"])).toBe("'=1+1,-5,,\"a,b\"");
  });
  it("CSVLINE-empty: csvLine([]) is the empty string", () => {
    expect(csvLine([])).toBe("");
  });
});
