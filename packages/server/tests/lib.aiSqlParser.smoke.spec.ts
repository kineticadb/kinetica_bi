import { describe, it, expect } from "vitest";
import { loadModule, parse } from "libpg-query";

describe("libpg-query smoke", () => {
  it("SQG-0a parses a SELECT", async () => {
    await loadModule();
    const r = await parse("SELECT 1");
    expect(r.stmts).toHaveLength(1);
    expect(Object.keys(r.stmts[0].stmt as object)).toContain("SelectStmt");
  });

  it("SQG-0b counts multiple statements and rejects unsupported syntax", async () => {
    await loadModule();
    expect((await parse("SELECT 1; SELECT 2")).stmts).toHaveLength(2);
    await expect(parse("SELECT a FROM t QUALIFY x")).rejects.toBeInstanceOf(Error);
  });
});
