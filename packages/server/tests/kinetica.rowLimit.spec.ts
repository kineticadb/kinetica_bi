import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kineticaSql, __resetRowLimitWarningsForTest } from "../src/kinetica";
import type { AuthedRequest } from "../src/auth";
import { KineticaAuthError } from "../src/kineticaErrors";

const buildReq = (): AuthedRequest =>
  ({
    user: { sub: "alice", sid: "x".repeat(64), creds: { username: "alice", password: "pw" } },
    requestId: "rowlim-req",
  }) as unknown as AuthedRequest;

const ROUTE = "POST /api/sql";

const respond = (encoded: unknown, extra: Record<string, unknown> = {}, status = 200) =>
  new Response(
    JSON.stringify({
      status: "OK",
      data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded), ...extra }),
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

const stubOne = () => {
  const f = vi.fn().mockImplementation(async () => respond({ column_1: [1] }));
  vi.stubGlobal("fetch", f);
  return f;
};
const sent = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(f.mock.calls[i][1].body as string);
const run = (extra?: Record<string, unknown>) =>
  kineticaSql(buildReq(), "SELECT 1", { route: ROUTE, op: "SQL", extra });

const setEnv = (max: string, batch: string) => {
  process.env.KINETICA_MAX_ROWS_PER_QUERY = max;
  process.env.KINETICA_MAX_RECORDS_PER_CALL = batch;
};

beforeEach(() => {
  setEnv("", "");
  __resetRowLimitWarningsForTest();
});
afterEach(() => {
  setEnv("", "");
});

describe("kineticaSql ROWLIM per-query ceiling", () => {
  it("ROWLIM-default: no env, no extra -> limit 20000 offset 0", async () => {
    const f = stubOne();
    await run();
    expect(sent(f).limit).toBe(20000);
    expect(sent(f).offset).toBe(0);
  });

  it("ROWLIM-env: KINETICA_MAX_ROWS_PER_QUERY=5000 -> limit 5000", async () => {
    setEnv("5000", "");
    const f = stubOne();
    await run();
    expect(sent(f).limit).toBe(5000);
  });

  it.each(["abc", "0", "-5", "1.5"])("ROWLIM-invalid: %s falls back to 20000 and warns", async (raw) => {
    setEnv(raw, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = stubOne();
    await run();
    expect(sent(f).limit).toBe(20000);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("KINETICA_MAX_ROWS_PER_QUERY must be a positive integer"))).toBe(true);
  });

  it("ROWLIM-clamp: huge extra.limit is clamped and one call is made", async () => {
    setEnv("20000", "");
    const f = stubOne();
    await run({ limit: 5000000 });
    expect(sent(f).limit).toBe(20000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ROWLIM-pin: 50 and 1 are kept", async () => {
    const f = stubOne();
    await run({ limit: 50 });
    await run({ limit: 1 });
    expect(sent(f, 0).limit).toBe(50);
    expect(sent(f, 1).limit).toBe(1);
  });

  it("ROWLIM-nonpositive: negative / non-numeric limit means no limit given", async () => {
    const f = stubOne();
    await run({ limit: -9999 });
    await run({ limit: "x" });
    expect(sent(f, 0).limit).toBe(20000);
    expect(sent(f, 1).limit).toBe(20000);
  });

  it("ROWLIM-offset: valid offset kept, negative -> 0", async () => {
    const f = stubOne();
    await run({ offset: 30 });
    await run({ offset: -1 });
    expect(sent(f, 0).offset).toBe(30);
    expect(sent(f, 1).offset).toBe(0);
  });
});

describe("kineticaSql ROWLIM clamp below batch", () => {
  it("ROWLIM-clamp-below-batch: max 5000 < batch 20000 clamps a larger client limit", async () => {
    setEnv("5000", "20000");
    const f = stubOne();
    await run({ limit: 9000 });
    expect(sent(f).limit).toBe(5000);
  });
});

const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const stubSeq = (...pages: Array<() => Response>) => {
  const f = vi.fn();
  for (const p of pages) f.mockImplementationOnce(async () => p());
  vi.stubGlobal("fetch", f);
  return f;
};

describe("kineticaSql ROWLIM batch splitting and continuation", () => {
  it("ROWLIM-split-2: 40000 max / 20000 batch -> two ordered calls concatenated", async () => {
    setEnv("40000", "20000");
    const f = stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(20000, 20000) }, { has_more_records: false })
    );
    const r = (await run()) as { column_1: number[]; has_more_records: boolean };
    expect(f).toHaveBeenCalledTimes(2);
    expect(sent(f, 0)).toMatchObject({ offset: 0, limit: 20000 });
    expect(sent(f, 1)).toMatchObject({ offset: 20000, limit: 20000 });
    expect(sent(f, 0).statement).toBe(sent(f, 1).statement);
    expect(r.column_1).toEqual(rows(0, 40000));
    expect(r.has_more_records).toBe(false);
  });

  it("ROWLIM-split-early-end: has_more false after page 1 -> one call", async () => {
    setEnv("40000", "20000");
    const f = stubSeq(() => respond({ column_1: rows(0, 20000) }, { has_more_records: false }));
    await run();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ROWLIM-split-truncated: both pages full and has_more true -> 2 calls, has_more reported true", async () => {
    setEnv("40000", "20000");
    const f = stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(20000, 20000) }, { has_more_records: true })
    );
    const r = (await run()) as { column_1: number[]; has_more_records: boolean };
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.column_1).toHaveLength(40000);
    expect(r.has_more_records).toBe(true);
  });

  it("ROWLIM-split-remainder: 50000 / 20000 -> limits 20000, 20000, 10000", async () => {
    setEnv("50000", "20000");
    const f = stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(20000, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(40000, 10000) }, { has_more_records: true })
    );
    await run();
    expect(f).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((i) => sent(f, i).limit)).toEqual([20000, 20000, 10000]);
    expect([0, 1, 2].map((i) => sent(f, i).offset)).toEqual([0, 20000, 40000]);
  });

  it("ROWLIM-split-baseoffset: offset 100 + limit 30000 -> offsets 100, 20100; limits 20000, 10000", async () => {
    setEnv("40000", "20000");
    const f = stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(20000, 10000) }, { has_more_records: true })
    );
    await run({ offset: 100, limit: 30000 });
    expect([sent(f, 0).offset, sent(f, 1).offset]).toEqual([100, 20100]);
    expect([sent(f, 0).limit, sent(f, 1).limit]).toEqual([20000, 10000]);
  });

  it("ROWLIM-split-multicol: headers/datatypes taken once, data columns concatenated", async () => {
    setEnv("4", "2");
    stubSeq(
      () =>
        respond(
          { column_headers: ["a", "b"], column_datatypes: ["int", "string"], column_1: [1, 2], column_2: ["x", "y"] },
          { has_more_records: true }
        ),
      () =>
        respond(
          { column_headers: ["a", "b"], column_datatypes: ["int", "string"], column_1: [3, 4], column_2: ["z", "w"] },
          { has_more_records: false }
        )
    );
    const r = (await run()) as Record<string, unknown>;
    expect(r.column_headers).toEqual(["a", "b"]);
    expect(r.column_datatypes).toEqual(["int", "string"]);
    expect(r.column_1).toEqual([1, 2, 3, 4]);
    expect(r.column_2).toEqual(["x", "y", "z", "w"]);
  });

  it("ROWLIM-d11-short-page: batch above the server's real max -> keeps paging, warns once", async () => {
    setEnv("12000", "20000");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = stubSeq(
      () => respond({ column_1: rows(0, 5000) }, { has_more_records: true }),
      () => respond({ column_1: rows(5000, 5000) }, { has_more_records: true }),
      () => respond({ column_1: rows(10000, 2000) }, { has_more_records: false })
    );
    const r = (await run()) as { column_1: number[] };
    expect(f).toHaveBeenCalledTimes(3);
    expect(sent(f, 1).offset).toBe(5000);
    expect(r.column_1).toHaveLength(12000);
    const hits = warn.mock.calls.filter(
      (c) => String(c[0]).includes("KINETICA_MAX_RECORDS_PER_CALL") && String(c[0]).includes("exceeds this Kinetica server")
    );
    expect(hits).toHaveLength(1);
  });

  it("ROWLIM-d11-once: two invocations hitting the short page warn once in total", async () => {
    setEnv("12000", "20000");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      stubSeq(
        () => respond({ column_1: rows(0, 5000) }, { has_more_records: true }),
        () => respond({ column_1: rows(5000, 100) }, { has_more_records: false })
      );
      await run();
    }
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes("exceeds this Kinetica server"));
    expect(hits).toHaveLength(1);
  });

  it("ROWLIM-ddl-single: no column arrays, even with has_more true -> one call", async () => {
    setEnv("40000", "20000");
    const f = stubSeq(() => respond({ count_affected: 1 }, { has_more_records: true }));
    await run();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ROWLIM-zero-rows-guard: has_more true with 0 rows stops", { timeout: 2000 }, async () => {
    setEnv("40000", "20000");
    const f = vi.fn().mockImplementation(async () => respond({ column_1: [] }, { has_more_records: true }));
    vi.stubGlobal("fetch", f);
    await run();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ROWLIM-audit-once: a 2-call split emits exactly one success audit line", async () => {
    setEnv("40000", "20000");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => respond({ column_1: rows(20000, 5) }, { has_more_records: false })
    );
    await run();
    const audits = log.mock.calls.filter((c) => String(c[0]).includes('"outcome":"success"'));
    expect(audits).toHaveLength(1);
  });

  it("ROWLIM-split-error: call 2 returning 401 rejects with KineticaAuthError", async () => {
    setEnv("40000", "20000");
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSeq(
      () => respond({ column_1: rows(0, 20000) }, { has_more_records: true }),
      () => new Response("Unauthorized", { status: 401 })
    );
    await expect(run()).rejects.toBeInstanceOf(KineticaAuthError);
  });
});
