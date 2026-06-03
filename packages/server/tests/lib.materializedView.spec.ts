/**
 * lib.materializedView.spec.ts — Phase 32 Plan 01 Task 3 (DV-V16-01).
 *
 * Unit coverage of `createOrReplaceMaterialized` — the shared helper extracted
 * from POST /api/filter/materialize so Plan 03's dynamic-view materialize
 * route can reuse the TM/SMc:1078 race-recovery retry pattern (32-CONTEXT.md
 * § D5). Mocks `kineticaSql` directly (the helper is the only consumer that
 * matters for this test); the broader contract-preservation check lives in
 * routes.filter-materialize.spec.ts (run separately).
 *
 * Test plan (M1–M6):
 *   M1 Happy path: 1 call, no retry.
 *   M2 TM/SMc:1078 retry: 3 calls (CREATE OR REPLACE → DROP → CREATE).
 *   M3 'Could not find the table' retry: same 3-call shape.
 *   M4 Non-matching error rethrows: 1 call, error propagates.
 *   M5 TTL flows through verbatim.
 *   M6 route/op flow into the kineticaSql audit opts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the kinetica module BEFORE importing the helper so the helper picks
// up our mocked kineticaSql. The hoisted mocks object is referenced both
// here and inside individual tests for per-call control.
const mocks = vi.hoisted(() => ({
  kineticaSql: vi.fn(),
}));

vi.mock("../src/kinetica", () => ({
  kineticaSql: mocks.kineticaSql,
}));

import { createOrReplaceMaterialized } from "../src/lib/materializedView";
import type { AuthedRequest } from "../src/auth";

// Minimal stub — the helper does not introspect req at all; it just hands it
// to kineticaSql, which we have mocked. Cast is intentional.
const stubReq = {} as AuthedRequest;

const RACE_ERR_MSG = "Could not find the table: 'ki_home._kbi_filt_x' (TM/SMc:1078)";
const SQLENGINE_ERR_MSG =
  "SqlEngine: Could not find the table 'ki_home._kbi_filt_x'";
const NON_RACE_ERR_MSG =
  "SqlEngine: Object 'ki_home.events' not found (S/SDc:1513)";

describe("createOrReplaceMaterialized (Phase 32 DV-V16-01)", () => {
  beforeEach(() => {
    mocks.kineticaSql.mockReset();
  });

  it("M1: happy path — emits exactly one CREATE OR REPLACE statement with locked TTL=5", async () => {
    mocks.kineticaSql.mockResolvedValueOnce({});

    await createOrReplaceMaterialized({
      req: stubReq,
      view: "myview",
      sqlBody: "SELECT 1",
      ttl: 5,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });

    expect(mocks.kineticaSql).toHaveBeenCalledTimes(1);
    const [_req, sql, opts] = mocks.kineticaSql.mock.calls[0];
    expect(sql).toBe(
      "CREATE OR REPLACE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)"
    );
    expect(opts).toMatchObject({
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });
  });

  it("M2: TM/SMc:1078 retry — DROP IF EXISTS + plain CREATE (no OR REPLACE) on second/third call", async () => {
    mocks.kineticaSql
      .mockRejectedValueOnce(new Error(RACE_ERR_MSG))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await createOrReplaceMaterialized({
      req: stubReq,
      view: "myview",
      sqlBody: "SELECT 1",
      ttl: 5,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });

    expect(mocks.kineticaSql).toHaveBeenCalledTimes(3);
    const statements = mocks.kineticaSql.mock.calls.map((c) => c[1] as string);
    expect(statements[0]).toBe(
      "CREATE OR REPLACE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)"
    );
    expect(statements[1]).toBe("DROP TABLE IF EXISTS myview");
    expect(statements[2]).toBe(
      "CREATE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)"
    );
    // The retry CREATE must NOT carry the OR REPLACE clause (that's the whole point).
    expect(statements[2]).not.toMatch(/CREATE OR REPLACE/);
  });

  it("M3: 'Could not find the table' (no TM/SMc:1078 suffix) also triggers DROP+CREATE retry", async () => {
    mocks.kineticaSql
      .mockRejectedValueOnce(new Error(SQLENGINE_ERR_MSG))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await createOrReplaceMaterialized({
      req: stubReq,
      view: "myview",
      sqlBody: "SELECT 1",
      ttl: 5,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });

    expect(mocks.kineticaSql).toHaveBeenCalledTimes(3);
    const statements = mocks.kineticaSql.mock.calls.map((c) => c[1] as string);
    expect(statements[1]).toBe("DROP TABLE IF EXISTS myview");
    expect(statements[2]).toBe(
      "CREATE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)"
    );
  });

  it("M4: non-matching error rethrows — does NOT retry, exactly 1 call", async () => {
    mocks.kineticaSql.mockRejectedValueOnce(new Error(NON_RACE_ERR_MSG));

    await expect(
      createOrReplaceMaterialized({
        req: stubReq,
        view: "myview",
        sqlBody: "SELECT 1",
        ttl: 5,
        route: "POST /api/filter/materialize",
        op: "MATERIALIZE",
      })
    ).rejects.toThrow(NON_RACE_ERR_MSG);

    expect(mocks.kineticaSql).toHaveBeenCalledTimes(1);
  });

  it("M5: TTL value flows through into the emitted statement", async () => {
    mocks.kineticaSql.mockResolvedValueOnce({});

    await createOrReplaceMaterialized({
      req: stubReq,
      view: "myview",
      sqlBody: "SELECT 1",
      ttl: 10,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });

    const sql = mocks.kineticaSql.mock.calls[0][1] as string;
    expect(sql).toContain("USING TABLE PROPERTIES (TTL = 10)");
  });

  it("M6: custom route + op tags flow through to kineticaSql audit opts on every call (incl. retry)", async () => {
    mocks.kineticaSql
      .mockRejectedValueOnce(new Error(RACE_ERR_MSG))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await createOrReplaceMaterialized({
      req: stubReq,
      view: "myview",
      sqlBody: "SELECT 1",
      ttl: 5,
      route: "POST /api/dynamic-view/materialize",
      op: "MATERIALIZE",
    });

    expect(mocks.kineticaSql).toHaveBeenCalledTimes(3);
    for (const call of mocks.kineticaSql.mock.calls) {
      const opts = call[2] as { route: string; op: string };
      expect(opts.route).toBe("POST /api/dynamic-view/materialize");
      expect(opts.op).toBe("MATERIALIZE");
    }
  });
});
