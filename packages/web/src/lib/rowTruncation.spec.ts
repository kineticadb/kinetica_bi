import { describe, it, expect } from "vitest";
import { bumpTrailingLimit, detectTruncation, readHasMore, DEPLOYMENT_MAX_HINT } from "./rowTruncation";

describe("detectTruncation", () => {
  it("RLTRUNC-exact-full: exactly-full grid with server false is not truncated", () => {
    expect(detectTruncation({ fetched: 5000, ownLimit: 5000, serverHasMore: false })).toBeNull();
  });
  it("RLTRUNC-exact-full-unknown: exactly-full with unknown server signal is not truncated", () => {
    expect(detectTruncation({ fetched: 5000, ownLimit: 5000, serverHasMore: undefined })).toBeNull();
  });
  it("RLTRUNC-own-limit: limit+1 rows means the widget's own limit was hit", () => {
    expect(detectTruncation({ fetched: 5001, ownLimit: 5000, serverHasMore: false })).toEqual({ shown: 5000, reason: "result-limit" });
  });
  it("RLTRUNC-deploy-max: server flag below own limit names the deployment max with rows shown", () => {
    expect(detectTruncation({ fetched: 1000, ownLimit: 5000, serverHasMore: true })).toEqual({ shown: 1000, reason: "deployment-max" });
  });
  it("RLTRUNC-both: both binding reports the widget's own limit", () => {
    expect(detectTruncation({ fetched: 5000, ownLimit: 5000, serverHasMore: true })).toEqual({ shown: 5000, reason: "result-limit" });
  });
  it("RLTRUNC-below: under the limit is not truncated", () => {
    expect(detectTruncation({ fetched: 249, ownLimit: 250, serverHasMore: undefined })).toBeNull();
  });
  it("RLTRUNC-no-own-limit-more: no own limit + server flag is deployment-max", () => {
    expect(detectTruncation({ fetched: 20000, ownLimit: null, serverHasMore: true })).toEqual({ shown: 20000, reason: "deployment-max" });
  });
  it("RLTRUNC-no-own-limit-none: no own limit, no flag is not truncated", () => {
    expect(detectTruncation({ fetched: 20000, ownLimit: null, serverHasMore: undefined })).toBeNull();
  });
  it("RLTRUNC-zero: zero rows is not truncated", () => {
    expect(detectTruncation({ fetched: 0, ownLimit: 250, serverHasMore: false })).toBeNull();
  });
});

describe("readHasMore", () => {
  it("RLTRUNC-hasmore: only real booleans are returned", () => {
    expect(readHasMore({ has_more_records: true })).toBe(true);
    expect(readHasMore({ has_more_records: false })).toBe(false);
    expect(readHasMore({})).toBeUndefined();
    expect(readHasMore({ has_more_records: "true" })).toBeUndefined();
    expect(readHasMore(null)).toBeUndefined();
    expect(readHasMore([])).toBeUndefined();
  });
});

describe("bumpTrailingLimit", () => {
  it("RLTRUNC-bump: rewrites trailing LIMIT, prefix byte-identical", () => {
    const prefix = "SELECT a, b, AVG(v) AS value FROM t GROUP BY a, b ORDER BY value DESC ";
    expect(bumpTrailingLimit(prefix + "LIMIT 5000")).toEqual({ sql: prefix + "LIMIT 5001", limit: 5000 });
  });
  it("RLTRUNC-bump-ws: tolerates trailing whitespace and semicolon", () => {
    const r = bumpTrailingLimit("SELECT * FROM t LIMIT 250 ;\n");
    expect(r?.limit).toBe(250);
    expect(r?.sql).toBe("SELECT * FROM t LIMIT 251 ;\n");
  });
  it("RLTRUNC-bump-lower: preserves keyword case", () => {
    const r = bumpTrailingLimit("select * from t limit 10");
    expect(r).toEqual({ sql: "select * from t limit 11", limit: 10 });
  });
  it("RLTRUNC-bump-offset: LIMIT with OFFSET is not bumped", () => {
    expect(bumpTrailingLimit("SELECT * FROM t LIMIT 10 OFFSET 5")).toBeNull();
  });
  it("RLTRUNC-bump-none: no LIMIT is not bumped", () => {
    expect(bumpTrailingLimit("SELECT * FROM t")).toBeNull();
  });
  it("RLTRUNC-bump-subquery: LIMIT only inside a subquery is not bumped", () => {
    expect(bumpTrailingLimit("SELECT * FROM (SELECT * FROM t LIMIT 5) x")).toBeNull();
  });
});

describe("DEPLOYMENT_MAX_HINT", () => {
  it("RLTRUNC-hint: names the env var", () => {
    expect(DEPLOYMENT_MAX_HINT).toContain("KINETICA_MAX_ROWS_PER_QUERY");
  });
});
