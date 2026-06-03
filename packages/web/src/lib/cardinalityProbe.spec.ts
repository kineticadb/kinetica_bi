/**
 * cardinalityProbe.spec.ts — Phase 11 M-06 classbreak cardinality probe
 *
 * Covers:
 *   - Correct SQL generation (COUNT DISTINCT)
 *   - Correct return value parsing
 *   - Session cache: hit (same key) and miss (different key)
 *   - Abort: cache entry cleared on AbortError so retry can re-fetch
 *   - AbortSignal threading to runSql
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeCardinality, __resetCardinalityCacheForTest } from "./cardinalityProbe";

// Mock the runSql client
vi.mock("../api/client", () => ({
  runSql: vi.fn(),
}));

import { runSql } from "../api/client";

const mockRunSql = runSql as ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetCardinalityCacheForTest();
  mockRunSql.mockReset();
});

describe("probeCardinality", () => {
  it("probeCardinality runs the right SQL", async () => {
    mockRunSql.mockResolvedValueOnce({ data: { n: [42] } });

    await probeCardinality("demo.nyctaxi", "vendor_id");

    expect(mockRunSql).toHaveBeenCalledWith(
      "SELECT COUNT(DISTINCT vendor_id) AS n FROM demo.nyctaxi",
      undefined,
      undefined,
    );
  });

  it("probeCardinality returns the parsed count", async () => {
    mockRunSql.mockResolvedValueOnce({ data: { n: [7] } });

    const result = await probeCardinality("my_schema.my_table", "category");

    expect(result).toBe(7);
  });

  it("cache hit: second call with same (tableRef, column) does not invoke runSql", async () => {
    mockRunSql.mockResolvedValueOnce({ data: { n: [50] } });

    const first = await probeCardinality("demo.nyctaxi", "pickup_borough");
    const second = await probeCardinality("demo.nyctaxi", "pickup_borough");

    expect(first).toBe(50);
    expect(second).toBe(50);
    // runSql should only be called ONCE (cache hit on second call)
    expect(mockRunSql).toHaveBeenCalledTimes(1);
  });

  it("cache miss: different column triggers a second runSql call", async () => {
    mockRunSql.mockResolvedValueOnce({ data: { n: [10] } });
    mockRunSql.mockResolvedValueOnce({ data: { n: [20] } });

    const first = await probeCardinality("demo.nyctaxi", "vendor_id");
    const second = await probeCardinality("demo.nyctaxi", "trip_distance");

    expect(first).toBe(10);
    expect(second).toBe(20);
    expect(mockRunSql).toHaveBeenCalledTimes(2);
  });

  it("aborted call: cache entry cleared so retry can re-fetch", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    mockRunSql.mockRejectedValueOnce(abortError);

    // First call: aborts
    await expect(probeCardinality("demo.nyctaxi", "vendor_id")).rejects.toThrow("Aborted");

    // Second call: should call runSql again (cache was cleared on abort)
    mockRunSql.mockResolvedValueOnce({ data: { n: [5] } });
    const retryResult = await probeCardinality("demo.nyctaxi", "vendor_id");

    expect(retryResult).toBe(5);
    expect(mockRunSql).toHaveBeenCalledTimes(2);
  });

  it("passes signal through to runSql", async () => {
    mockRunSql.mockResolvedValueOnce({ data: { n: [3] } });

    const controller = new AbortController();
    await probeCardinality("demo.nyctaxi", "vendor_id", controller.signal);

    expect(mockRunSql).toHaveBeenCalledWith(
      expect.stringContaining("COUNT(DISTINCT"),
      undefined,
      controller.signal,
    );
  });

  it("handles row-major result shape (fallback parsing path)", async () => {
    // Some Kinetica result shapes return { n: 42 } at the top level
    mockRunSql.mockResolvedValueOnce({ n: 42 });

    const result = await probeCardinality("demo.nyctaxi", "vendor_id");

    expect(result).toBe(42);
  });
});
