---
phase: 26-server-spatial-where
plan: 3
type: execute
wave: 3
depends_on:
  - 26-01-spatial-where-builder
  - 26-02-materialize-endpoint
files_modified:
  - kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts
autonomous: true
requirements:
  - WHERE-V15-04

# Coverage scope: column-only / spatial-only / combined / 1-shape / 2-shape paren / 3-shape paren /
# 0-shape pass-through / empty input 400 / pair-completeness 400 / tableId mismatch 400 / WKB 501 /
# audit-log op tag. Mirrored across AUTH_MODE=password AND AUTH_MODE=oidc.

must_haves:
  truths:
    - "DDL for combined input contains EXACT substring: (STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1) AND (zone = 'East Village')"
    - "DDL for 2-shape combined input contains EXACT substring: (STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"
    - "DDL for 3-shape spatial-only contains EXACT substring: (STXY_WITHIN(...) = 1 OR STXY_WITHIN(...) = 1 OR STXY_WITHIN(...) = 1)"
    - "WKB mode response: status 501 + body deep-equals { error: \"WKB mode deferred\", td: \"TD-V14-WKB-SPIKE\" }"
    - "WKB mode response: kineticaSql fetch is NOT called (zero calls to /execute/sql)"
    - "0-shape pass-through (spatialFilters: [], no spatialTarget, with filters): DDL has NO spatial predicate (column-only path)"
    - "Empty input (filters: [] + spatialFilters: [] + no spatialTarget): 400 with new message containing \"non-empty\""
    - "spatialFilters present without spatialTarget: 400 with message containing \"spatialTarget is required\""
    - "spatialTarget present without spatialFilters: 400 with message containing \"spatialFilters are required\""
    - "spatialTarget.tableId !== body.tableId: 400 with message containing \"must match body.tableId\""
    - "Audit-log op tag stays \"MATERIALIZE\" (combined input)"
    - "All assertions run twice — once under AUTH_MODE=password, once under AUTH_MODE=oidc"
  artifacts:
    - path: "kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts"
      provides: "Supertest coverage of WHERE-V15-04 — combined spatial+column composition"
      contains: "STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT"
  key_links:
    - from: "kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts"
      to: "kinetica_bi/server/src/index.ts (POST /api/filter/materialize)"
      via: "supertest agent.post(\"/api/filter/materialize\").send({ ...spatial body... })"
      pattern: "agent\\.post\\(\"/api/filter/materialize\"\\)"
---

<objective>
Create `kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts` — a sibling supertest file (NOT a modification of the existing 23-test v1.3 spec) covering all Phase 26 spatial paths under both AUTH_MODE=password and AUTH_MODE=oidc.

Purpose: WHERE-V15-04. The V15-P-07 paren-correctness invariant gets a SECOND assertion at the supertest level (DDL output inspection) on top of Plan 01's unit-test assertion. Defense in depth before any multi-shape UI lands (Phase 29).

Output: One new spec file committed to git, exits 0 under `npm test`.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/26-server-spatial-where/26-CONTEXT.md
@.planning/phases/26-server-spatial-where/26-RESEARCH.md
@.planning/phases/26-server-spatial-where/26-01-spatial-where-builder-SUMMARY.md
@.planning/phases/26-server-spatial-where/26-02-materialize-endpoint-SUMMARY.md
@kinetica_bi/server/tests/routes.filter-materialize.spec.ts
@kinetica_bi/server/tests/routes.info-query.spec.ts
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/src/lib/spatialWhereClause.ts

<interfaces>
<!-- Auth-fixture helpers MUST be copied VERBATIM from routes.filter-materialize.spec.ts -->
<!-- These are not exported; this spec re-defines them locally. -->

From routes.filter-materialize.spec.ts (lines 21-131):
```typescript
// Hoisted mock so AUTH_MODE=oidc boot succeeds without network
const mocks = vi.hoisted(() => { ... });  // Issuer + OPError + RPError
vi.mock("openid-client", () => ({ Issuer: mocks.Issuer, ... }));

import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { resetOidcClientForTests } from "../src/oidc";
import { db, createDashboard, createTable } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

const successKineticaBody = { ... };
const seedFixture = (tableName = "events", schema = "ki_home") => { ... };
const makeSessionCookie = (username = "alice") => { ... };
const makeJwt = (payload) => { ... };
const seedOidcSession = (username, accessToken?) => { ... };
const cleanFixtures = () => { ... };
```

From kinetica_bi/server/src/lib/spatialWhereClause.ts (Plan 01):
```typescript
export type SpatialFilter = { id: string; wkt: string };
export type SpatialTarget = {
  tableId: number;
  spatialMode: "latlon" | "wkt" | "wkb";
  lonCol?: string;
  latCol?: string;
  spatialCol?: string;
};
```

Endpoint contract (from Plan 02):
- Request body: `{ dashboardId, tableId, filters?: ActiveFilter[], spatialFilters?: SpatialFilter[], spatialTarget?: SpatialTarget }`
- 200: `{ viewName, expiresAt }`
- 400 cases: empty input, pair-completeness, tableId mismatch
- 501: WKB mode (body `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }`)
- Audit-log op stays "MATERIALIZE"
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create routes.filter-materialize-spatial.spec.ts mirroring v1.3 supertest auth fixtures + all 12+ spatial assertions × 2 AUTH_MODE blocks</name>
  <files>kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts</files>

  <read_first>
    BEFORE writing this spec, read these files in this order:
    1. kinetica_bi/server/tests/routes.filter-materialize.spec.ts (FULL FILE) — the auth-fixture pattern source. Copy the entire hoisted `mocks` block, the `vi.mock("openid-client")` call, and all helper functions (`seedFixture`, `makeSessionCookie`, `makeJwt`, `seedOidcSession`, `cleanFixtures`) VERBATIM. Read the describe-block structure for AUTH_MODE=password AND AUTH_MODE=oidc.
    2. kinetica_bi/server/tests/routes.info-query.spec.ts (skim) — the 501-assertion-pattern reference (kineticaSql NOT invoked when 501).
    3. kinetica_bi/server/src/index.ts lines 684-745 — the actual endpoint behavior under test (the post-Plan-02 version).
    4. kinetica_bi/server/src/lib/spatialWhereClause.ts — type imports needed.
    5. .planning/phases/26-server-spatial-where/26-CONTEXT.md §"Supertest coverage" — the exact scenarios required.
    6. .planning/phases/26-server-spatial-where/26-RESEARCH.md §5 "Test Plan" — assertion table.
  </read_first>

  <action>
    Create a NEW file `kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts` mirroring `routes.filter-materialize.spec.ts` structure. Concrete structure (DO NOT paraphrase the auth helpers — copy them VERBATIM from the reference spec):

    **Section 1: File preamble + hoisted mocks (copy verbatim from routes.filter-materialize.spec.ts lines 1-71)**

    Start with this docstring:
    ```typescript
    /**
     * routes.filter-materialize-spatial.spec.ts — Plan 26-03 supertest coverage.
     *
     * Covers Phase 26 extensions to POST /api/filter/materialize:
     *   - Combined spatial + column WHERE composition (WHERE-V15-04)
     *   - V15-P-07 paren-correctness for 1 / 2 / 3 shape inputs
     *   - 4-case composition (column-only / spatial-only / combined / 0-shape pass-through)
     *   - Pair-completeness 400s (spatialFilters ↔ spatialTarget)
     *   - TableId mismatch 400
     *   - WKB mode 501 BEFORE builder invocation (zero kinetica fetch calls)
     *   - Audit-log op tag stays "MATERIALIZE"
     *
     * Sibling spec to routes.filter-materialize.spec.ts (which stays at 23/23 for v1.3
     * backward-compat coverage). Auth fixtures copied verbatim — keeps the two specs
     * independent so this one can be re-run in isolation during Phase 26 debugging.
     */
    ```

    Then copy verbatim (lines 21-131 of routes.filter-materialize.spec.ts):
    - Imports (`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi` from vitest; `jwt` from jsonwebtoken)
    - Full `vi.hoisted(() => { ... })` mock block for openid-client (Issuer + OPError + RPError + client)
    - `vi.mock("openid-client", ...)` call
    - Test imports (`buildTestApp`, `createSession`, `resetOidcClientForTests`, `db`, `createDashboard`, `createTable`)
    - Constants (`AUTH_SECRET`, `KINETICA_URL`, `SESSION_PASSWORD`, `FAKE_OIDC_ACCESS_TOKEN`, `successKineticaBody`)
    - Helpers (`seedFixture`, `makeSessionCookie`, `makeJwt`, `seedOidcSession`, `cleanFixtures`)

    **Section 2: Spatial-test fixtures (NEW to this spec)**

    Add at module scope after the auth helpers:
    ```typescript
    import type { SpatialFilter, SpatialTarget } from "../src/lib/spatialWhereClause";

    const SHAPE_1: SpatialFilter = { id: "shape1", wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))" };
    const SHAPE_2: SpatialFilter = { id: "shape2", wkt: "POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))" };
    const SHAPE_3: SpatialFilter = { id: "shape3", wkt: "POLYGON((4 4, 5 4, 5 5, 4 5, 4 4))" };

    const makeLatlonTarget = (tableId: number): SpatialTarget => ({
      tableId,
      spatialMode: "latlon",
      lonCol: "lon",
      latCol: "lat",
    });

    const makeWktTarget = (tableId: number): SpatialTarget => ({
      tableId,
      spatialMode: "wkt",
      spatialCol: "geom",
    });

    const makeWkbTarget = (tableId: number): SpatialTarget => ({
      tableId,
      spatialMode: "wkb",
      spatialCol: "geom",
    });

    // Helper: extract the SQL statement from the fetchMock that hit /execute/sql.
    // Returns undefined when no /execute/sql call was made (used for 501 assertions).
    const getKineticaStatement = (fetchMock: ReturnType<typeof vi.fn>): string | undefined => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
      if (!call) return undefined;
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      return body.statement as string;
    };
    ```

    **Section 3: Test cases — DUAL AUTH_MODE structure**

    Create TWO top-level describe blocks. Each contains the SAME 12 it() cases (the only delta is auth-fixture choice). Structure:

    ```typescript
    describe("POST /api/filter/materialize spatial — AUTH_MODE=password", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "password");
        cleanFixtures();
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      // ... 12 it() cases below, using makeSessionCookie("alice") ...
    });

    describe("POST /api/filter/materialize spatial — AUTH_MODE=oidc", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "oidc");
        resetOidcClientForTests();
        cleanFixtures();
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      // ... SAME 12 it() cases, using seedOidcSession("john.doe@kinetica.com") ...
    });
    ```

    **The 12 it() cases (apply IDENTICALLY to both describe blocks):**

    1. **"column-only request: v1.3 backward-compat — DDL has column WHERE, no spatial"**
       Setup: send `{ dashboardId, tableId, filters: [{column:"zone",value:"East Village",dataType:"string",addedAt:0}] }` (no spatial fields). Stub fetch with successKineticaBody.
       Assert: `res.status === 200`; DDL statement matches `/WHERE zone = 'East Village'/`; DDL does NOT contain "STXY_WITHIN" or "ST_INTERSECTS".

    2. **"spatial-only latlon 1-shape: DDL has wrapped spatial predicate, no AND"**
       Setup: `{ dashboardId, tableId, filters: [], spatialFilters: [SHAPE_1], spatialTarget: makeLatlonTarget(tableId) }`.
       Assert: `res.status === 200`; statement contains exact substring `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1)`; statement does NOT contain ` AND ` (single-AND check — spatial-only).

    3. **"spatial-only wkt 1-shape: DDL uses ST_INTERSECTS (NOT ST_WITHIN)"**
       Setup: `{ ..., filters: [], spatialFilters: [SHAPE_1], spatialTarget: makeWktTarget(tableId) }`.
       Assert: statement contains `(ST_INTERSECTS(geom, ST_GEOMFROMTEXT(`; statement does NOT contain `ST_WITHIN(`.

    4. **"combined 1-shape + 1-col: DDL is (spatial) AND (col) — exact paren structure"**
       Setup: `{ ..., filters: [colFilter], spatialFilters: [SHAPE_1], spatialTarget: makeLatlonTarget(tableId) }`.
       Assert: statement contains EXACT substring `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1) AND (zone = 'East Village')`.

    5. **"V15-P-07 LOAD-BEARING — combined 2-shape + 1-col: DDL is (s1 OR s2) AND (col) with exact parens"**
       Setup: `{ ..., filters: [colFilter], spatialFilters: [SHAPE_1, SHAPE_2], spatialTarget: makeLatlonTarget(tableId) }`.
       Assert: statement contains EXACT substring `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')) = 1) AND (zone = 'East Village')`.
       This is the single most important assertion in the spec — the silent multi-shape regression mode V15-P-07 is locked out here.

    6. **"3-shape spatial-only: DDL has (s1 OR s2 OR s3) with two OR separators"**
       Setup: `{ ..., filters: [], spatialFilters: [SHAPE_1, SHAPE_2, SHAPE_3], spatialTarget: makeLatlonTarget(tableId) }`.
       Assert: statement contains substring `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0`; statement contains exactly 2 occurrences of ` OR ` (count via `(statement.match(/ OR /g) ?? []).length === 2`); statement does NOT contain ` AND `.

    7. **"0-shape pass-through (spatialFilters: [], NO spatialTarget) + filters: column-only path"**
       Setup: `{ ..., filters: [colFilter], spatialFilters: [], spatialTarget: undefined }`.
       Note: pair-completeness check (Plan 02 step 3) treats empty spatialFilters as "no spatial" — should pass through to column-only DDL.
       Assert: `res.status === 200`; statement contains `WHERE zone = 'East Village'`; statement does NOT contain "STXY_WITHIN" or "ST_INTERSECTS".

    8. **"empty input: filters: [] + spatialFilters: [] + no spatialTarget → 400"**
       Setup: `{ dashboardId, tableId, filters: [] }` (omit spatial entirely).
       Assert: `res.status === 400`; `res.body.error` contains substring `"non-empty"` (matches both v1.3 message AND new message; safe across the upgrade).

    9. **"spatialFilters present without spatialTarget → 400"**
       Setup: `{ ..., filters: [], spatialFilters: [SHAPE_1] }` (no spatialTarget).
       Assert: `res.status === 400`; `res.body.error` contains substring `"spatialTarget is required"`.

    10. **"spatialTarget present without spatialFilters → 400"**
        Setup: `{ ..., filters: [colFilter], spatialFilters: [], spatialTarget: makeLatlonTarget(tableId) }` (empty spatialFilters with present target).
        Note: pair-completeness step in Plan 02 treats empty array as absent for this check; the validation message is "spatialFilters are required when spatialTarget is provided".
        Assert: `res.status === 400`; `res.body.error` contains substring `"spatialFilters are required"`.

    11. **"spatialTarget.tableId !== body.tableId → 400"**
        Setup: `{ dashboardId, tableId, filters: [colFilter], spatialFilters: [SHAPE_1], spatialTarget: makeLatlonTarget(tableId + 999) }` (mismatched tableId).
        Assert: `res.status === 400`; `res.body.error` contains substring `"must match body.tableId"`.

    12. **"WKB mode → 501 with verbatim body; kineticaSql NOT invoked (zero fetch /execute/sql calls)"**
        Setup: stub fetchMock; send `{ ..., filters: [], spatialFilters: [SHAPE_1], spatialTarget: makeWkbTarget(tableId) }`.
        Assert:
        - `res.status === 501`
        - `res.body` deep-equals (use `toEqual`) `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }`
        - `getKineticaStatement(fetchMock) === undefined` (no /execute/sql call was made — early-return BEFORE builder)
        - Defense-in-depth: `fetchMock.mock.calls.find(c => String(c[0]).includes("/execute/sql"))` is `undefined`

    13. **"audit-log op tag stays \"MATERIALIZE\" for combined input"**
        Setup: spy on console.log; send combined request like test 4.
        Assert: at least one log line matches `/"op":"MATERIALIZE"/` AND `/"route":"POST \/api\/filter\/materialize"/`.

    (Total: 13 cases per describe block × 2 describe blocks = 26 test cases. Plan 03 SUMMARY should confirm 26/26 green.)

    **Helper for repeated colFilter**: define at module scope alongside spatial fixtures:
    ```typescript
    const colFilter = { column: "zone", value: "East Village", dataType: "string" as const, addedAt: 0 };
    ```

    **Body-shape requests for OIDC describe block**: use `seedOidcSession("john.doe@kinetica.com")` instead of `makeSessionCookie("alice")` for the Cookie header. Everything else identical.

    **DO NOT modify** `routes.filter-materialize.spec.ts` — it stays at 23/23 v1.3 reference; this new spec is purely additive. (Plan 02 backward-compat work already confirmed the old spec still passes.)
  </action>

  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; npx vitest run tests/routes.filter-materialize-spatial.spec.ts 2>&amp;1 | tail -20</automated>
  </verify>

  <acceptance_criteria>
    - File `kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts` exists
    - File contains TWO top-level describe blocks: one for AUTH_MODE=password, one for AUTH_MODE=oidc (grep `^describe\(` returns 2 lines)
    - File contains exactly 26 it() cases (13 cases × 2 auth-mode describe blocks)
    - File contains EXACT assertion string `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')) = 1) AND (zone = 'East Village')` (the V15-P-07 load-bearing 2-shape combined assertion)
    - File contains substring `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1) AND (zone = 'East Village')` (the 1-shape combined assertion)
    - File contains substring `ST_INTERSECTS(geom, ST_GEOMFROMTEXT(` (wkt-mode predicate assertion)
    - File contains substring `toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" })` (verbatim 501 body deep-equality)
    - File imports `SpatialFilter` and `SpatialTarget` types from `../src/lib/spatialWhereClause`
    - File contains `vi.hoisted(` (oidc mock pattern present)
    - File contains `vi.mock("openid-client"` (oidc mock pattern present)
    - File contains `seedOidcSession(` at least once in the AUTH_MODE=oidc describe block
    - File contains `makeSessionCookie(` at least once in the AUTH_MODE=password describe block
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize-spatial.spec.ts` exits 0 with 26/26 tests passing
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` still passes (existing 23/23 — backward compat regression check; spec file was NOT modified)
  </acceptance_criteria>

  <done>
    New supertest file with 26 tests (13 × 2 AUTH_MODE), all green. V15-P-07 load-bearing 2-shape+1-col assertion present with EXACT string match. WKB 501 body verified via `toEqual`. Zero `/execute/sql` fetch calls verified for WKB path. ST_INTERSECTS (not ST_WITHIN) verified for wkt mode. Existing 23/23 v1.3 spec untouched.
  </done>
</task>

</tasks>

<verification>
After Task 1:
1. `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize-spatial.spec.ts` — 26/26 green.
2. `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` — existing 23/23 still green.
3. `cd kinetica_bi/server && npx vitest run tests/lib.spatialWhereClause.spec.ts` — Plan 01 spec still 17/17 green.
4. `cd kinetica_bi/server && npx tsc --noEmit` — exits 0 (no TS errors anywhere).
5. `grep -c "ST_WITHIN(" kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts` returns 0 (no stale ST_WITHIN usage; explicit "does NOT contain ST_WITHIN" assertions only mention it as a string in `.not.toContain` form, not in raw test data).
   (Note: the assertion `expect(...).not.toContain("ST_WITHIN")` is allowed; the prohibition is on USING the predicate in test data setup.)

Full Phase 26 regression check:
6. `cd kinetica_bi/server && npm test` — all server tests green (no Phase 26 introduced regressions; pre-existing red tests TD-V11-04 / TD-V13-01 stay red but should not increase in count).
</verification>

<success_criteria>
- WHERE-V15-04: Supertest coverage for column-only / spatial-only / combined / 1-shape / 2-shape paren / 3-shape paren / 0-shape pass-through; both AUTH_MODE=password AND AUTH_MODE=oidc; WKB→501 with zero kineticaSql calls; audit-log op tag verified.
- V15-P-07 load-bearing 2-shape + 1-col assertion present with EXACT string match (defense-in-depth alongside Plan 01 unit test).
- 26/26 green for the new spec; 23/23 v1.3 spec unchanged; 17/17 Plan 01 spec unchanged.
</success_criteria>

<output>
After completion, create `.planning/phases/26-server-spatial-where/26-03-supertest-coverage-SUMMARY.md` capturing:
- Final test count (26/26 expected)
- V15-P-07 load-bearing assertion location (line number in the new spec)
- Confirmation that routes.filter-materialize.spec.ts (23/23) is untouched
- Confirmation that lib.spatialWhereClause.spec.ts (17/17) is untouched
- Total Phase 26 test count: 23 (v1.3 spec) + 17 (Plan 01 unit) + 26 (Plan 03 supertest) = 66 spatial-or-spatial-adjacent tests
- Commit hash
- Any TS / Vitest warnings observed during run
</output>
