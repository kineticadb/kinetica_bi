import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kineticaSql, __resetRowLimitWarningsForTest } from "../src/kinetica";
import type { AuthedRequest } from "../src/auth";

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
