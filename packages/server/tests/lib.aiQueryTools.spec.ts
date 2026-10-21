import { describe, it, expect } from "vitest";
import { QUERY_TOOLS, runQuery, getColumnProfile } from "../src/lib/ai/tools/query";
import type { ToolContext } from "../src/lib/ai/tools/types";
import type { QueryPort } from "../src/lib/ai/queryRunner";

const env = { kind: "query_result", untrusted: true, notice: "n", columns: ["a"], rows: [[1]], rowCount: 1, truncated: false, truncation: { rows: false, chars: false, cellsClipped: 0 } };
const prof = { kind: "column_profile", untrusted: true, notice: "n", table: "s.t", column: "c", rowCount: 1, nullCount: 0, distinctCount: 1, truncated: false };
function ctx(query?: Partial<QueryPort>, signal?: AbortSignal): ToolContext {
  return { query: query as QueryPort, signal } as unknown as ToolContext;
}

describe("query tools", () => {
  it("QTL-1 run_query ok -> single rows part", async () => {
    const res = await runQuery.run({ sql: "select 1" }, ctx({ run: async () => ({ ok: true, envelope: env as never }) }));
    expect(res.parts).toHaveLength(1);
    expect(res.parts[0].cls).toBe("rows");
    expect(res.parts[0].text).toBe(JSON.stringify(env));
    expect(res.isError).toBeUndefined();
  });
  it("QTL-2 run_query failure -> config + isError", async () => {
    const m = "Refused: only a single SELECT (or WITH ... SELECT) is allowed";
    const res = await runQuery.run({ sql: "x" }, ctx({ run: async () => ({ ok: false, message: m }) }));
    expect(res.parts).toHaveLength(1);
    expect(res.parts[0].cls).toBe("config");
    expect(res.parts[0].text).toBe(m);
    expect(res.isError).toBe(true);
  });
  it("QTL-3 get_column_profile ok -> values; failure -> config + isError", async () => {
    const ok = await getColumnProfile.run({ tableId: 1, column: "c" }, ctx({ profile: async () => ({ ok: true, envelope: prof as never }) }));
    expect(ok.parts).toHaveLength(1);
    expect(ok.parts[0].cls).toBe("values");
    const bad = await getColumnProfile.run({ tableId: 1, column: "c" }, ctx({ profile: async () => ({ ok: false, message: "nope" }) }));
    expect(bad.parts[0].cls).toBe("config");
    expect(bad.isError).toBe(true);
  });
  it("QTL-4 no ctx.query -> not available", async () => {
    for (const r of [await runQuery.run({ sql: "x" }, ctx()), await getColumnProfile.run({ tableId: 1, column: "c" }, ctx())]) {
      expect(r.parts[0].cls).toBe("config");
      expect(r.parts[0].text).toBe("Querying is not available in this deployment.");
      expect(r.isError).toBe(true);
    }
  });
  it("QTL-5 signal forwarded", async () => {
    const sig = new AbortController().signal;
    const seen: unknown[] = [];
    const q = {
      run: async (_s: string, s?: AbortSignal) => { seen.push(s); return { ok: false as const, message: "m" }; },
      profile: async (_a: unknown, s?: AbortSignal) => { seen.push(s); return { ok: false as const, message: "m" }; },
    };
    await runQuery.run({ sql: "x" }, ctx(q, sig));
    await getColumnProfile.run({ tableId: 1, column: "c" }, ctx(q, sig));
    expect(seen).toEqual([sig, sig]);
    expect(seen[0]).toBe(sig);
  });
  it("QTL-6 descriptions", () => {
    expect(runQuery.description).toContain("your own");
    expect(runQuery.description).toContain("not for charts");
    expect(getColumnProfile.description).toContain("one column");
    expect(QUERY_TOOLS).toHaveLength(2);
  });
});
