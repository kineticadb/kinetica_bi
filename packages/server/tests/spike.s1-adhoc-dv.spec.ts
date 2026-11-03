/**
 * spike.s1-adhoc-dv.spec.ts - Phase 133 Plan 08, S1 code half.
 *
 * Proves, without any Kinetica, that createOrReplaceMaterialized takes an inline
 * (session-bound) view name and has no dependency on a dashboard_dynamic_views row.
 * The live half (non-admin create / view-of-view / WMS / TTL) was checked once by a Phase 133 spike.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOrReplaceMaterialized } from "../src/lib/materializedView";
import { buildServerWhereClause } from "../src/lib/whereClause";
import { db } from "../src/db";
import type { AuthedRequest } from "../src/auth";

const req = {
  requestId: "spike-s1",
  user: { credentialType: "password", creds: { username: "admin", password: "x" } },
} as unknown as AuthedRequest;

const VIEW = "_kbi_ai_uadmin_s12345678_1";
const BODY = "SELECT zone, COUNT(*) AS n FROM fleet.trips GROUP BY zone";

const countRows = (): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM dashboard_dynamic_views").get() as { n: number }).n;

describe("S1-CODE ad-hoc dynamic view (no dashboard_dynamic_views row)", () => {
  const statements: string[] = [];

  beforeEach(() => {
    statements.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        statements.push(JSON.parse(init.body).statement as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "OK",
            data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
          }),
        };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("S1-CODE-1: inline session-bound name emits the exact CREATE OR REPLACE DDL", async () => {
    await createOrReplaceMaterialized({ req, view: VIEW, sqlBody: BODY, ttl: 5, route: "spike", op: "MATERIALIZE" });
    expect(statements).toEqual([
      `CREATE OR REPLACE MATERIALIZED VIEW ${VIEW} AS (${BODY}) USING TABLE PROPERTIES (TTL = 5)`,
    ]);
  });

  it("S1-CODE-2: no dashboard_dynamic_views row exists or is created", async () => {
    const before = countRows();
    await createOrReplaceMaterialized({ req, view: VIEW, sqlBody: BODY, ttl: 5, route: "spike", op: "MATERIALIZE" });
    expect(before).toBe(0);
    expect(countRows()).toBe(0);
  });

  it("S1-CODE-3: a filter view composes over the ad-hoc view via buildServerWhereClause", () => {
    const where = buildServerWhereClause([
      { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
    ]);
    expect(`SELECT * FROM ${VIEW} WHERE ${where}`).toBe(`SELECT * FROM ${VIEW} WHERE zone = 'East Village'`);
  });
});
