---
phase: 13-spikes-and-endpoint
plan: 03
type: execute
wave: 3
depends_on:
  - 13-01
  - 13-02
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/routes.filter-materialize.spec.ts
autonomous: true
requirements:
  - VIEW-V13-01
  - VIEW-V13-02
  - VIEW-V13-04
  - VIEW-V13-05
  - VIEW-V13-07
must_haves:
  truths:
    - "POST /api/filter/materialize with non-empty filters issues `CREATE OR REPLACE MATERIALIZED VIEW <name> AS (SELECT * FROM <schema>.<table> WHERE <clause>) USING TABLE PROPERTIES (TTL = 5)` via kineticaSql with op: 'MATERIALIZE' and returns { viewName, expiresAt }"
    - "DELETE /api/filter/materialize?dashboardId=N&tableId=M issues `DROP TABLE IF EXISTS <viewName>` via kineticaSql and returns { dropped: true }"
    - "Both routes are mounted under /api so requireAuth gates them; both use requireConfig + asyncHandler"
    - "Server is stateless re views — no SQLite reads/writes; no in-memory map; route handlers contain zero try/catch (typed errors bubble through asyncHandler → errorMiddleware)"
    - "Supertest covers: happy-path POST (DDL string + view-name format + expiresAt > now); happy-path DELETE; empty-filters POST 400; missing-table 404; KineticaPermissionError → 403 with no `code` field; both AUTH_MODE=password and AUTH_MODE=oidc session contexts"
    - "OIDC username with special characters (e.g. john.doe@kinetica.com) produces a sanitized view name matching `_kbi_filt_u\\w+_d\\d+_t\\d+_s\\w{8}`"
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "POST /api/filter/materialize and DELETE /api/filter/materialize route handlers inside createApp() body"
      contains: "/api/filter/materialize"
    - path: "kinetica_bi/server/tests/routes.filter-materialize.spec.ts"
      provides: "Supertest coverage for POST + DELETE in both AUTH_MODE variants"
      contains: "describe(\"POST /api/filter/materialize\"|describe(\"DELETE /api/filter/materialize\""
  key_links:
    - from: "kinetica_bi/server/src/index.ts route handler"
      to: "kinetica_bi/server/src/lib/viewNaming.ts buildFilterViewName()"
      via: "import { buildFilterViewName } from './lib/viewNaming' at top of index.ts"
      pattern: "buildFilterViewName"
    - from: "kinetica_bi/server/src/index.ts route handler"
      to: "kinetica_bi/server/src/lib/whereClause.ts buildServerWhereClause()"
      via: "import { buildServerWhereClause, type ActiveFilter } from './lib/whereClause' at top of index.ts"
      pattern: "buildServerWhereClause"
    - from: "kinetica_bi/server/src/index.ts route handler"
      to: "kinetica_bi/server/src/kinetica.ts kineticaSql()"
      via: "kineticaSqlHelper(req as AuthedRequest, ddl, { route, op: 'MATERIALIZE' })"
      pattern: "kineticaSqlHelper.*op:\\s*[\"']MATERIALIZE[\"']"
    - from: "kinetica_bi/server/src/index.ts errorMiddleware"
      to: "POST /api/filter/materialize 403 response"
      via: "KineticaPermissionError thrown by kineticaSql → asyncHandler forwards → errorMiddleware → 403 + { error } (no code field)"
      pattern: "KineticaPermissionError"
---

<objective>
Wire `POST /api/filter/materialize` and `DELETE /api/filter/materialize` into `kinetica_bi/server/src/index.ts` (inside `createApp()` body, mounted under the existing `/api/*` requireAuth-guarded namespace), composed from the Plan 13-02 utilities (`buildFilterViewName`, `buildServerWhereClause`) and the existing `kineticaSql` helper. Add comprehensive supertest coverage for both routes in both `AUTH_MODE` variants.

Purpose: This is the integration plan that ships the v1.3 server-side primitive. Phase 14 client-side wiring depends on the request/response shape locked here. Phase 13's success criteria 2-5 (in ROADMAP.md) are satisfied by this plan's tasks.

Output: Two route handlers added to `index.ts` (placed alongside the existing `/api/views/:id/materialize` reference at line ~613), one new test spec covering POST + DELETE in both AUTH_MODE variants, and updated import block in index.ts pulling in the Plan 13-02 utilities.

Pattern model: The existing `POST /api/views/:id/materialize` at `kinetica_bi/server/src/index.ts:613-648` is the structural reference, with three deltas:
1. NO try/catch (Phase 13 routes are stateless re views — no SQLite side effects to persist on error)
2. View name is constructed server-side from session context, not read from a SQLite row
3. WHERE clause is built server-side from request body filters via `buildServerWhereClause`, not stored in `view.filter_clause`
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md
@.planning/phases/13-spikes-and-endpoint/13-RESEARCH.md
@.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md
@.planning/phases/13-spikes-and-endpoint/13-02-SUMMARY.md
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/src/kinetica.ts
@kinetica_bi/server/src/auth.ts
@kinetica_bi/server/src/db.ts
@kinetica_bi/server/tests/routes.materialize.spec.ts

<interfaces>
<!-- Plan 13-02 utility module exports — the new code imports these -->
<!-- Source: kinetica_bi/server/src/lib/viewNaming.ts (created in Plan 13-02) -->

```typescript
export function sanitizeForViewName(username: string): string;
export type FilterViewNameArgs = {
  username: string;
  sessionId: string;
  dashboardId: number;
  tableId: number;
  // schema?: string;  // present only if SPIKE-V13-04 said qualified-required
};
export function buildFilterViewName(args: FilterViewNameArgs): string;
```

<!-- Source: kinetica_bi/server/src/lib/whereClause.ts (created in Plan 13-02) -->

```typescript
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};
export function escapeKineticaStringLiteral(val: string): string;
export function buildServerWhereClause(filters: ActiveFilter[]): string;
```

<!-- Existing helpers used by the new routes (already imported in index.ts) -->

```typescript
// Source: kinetica_bi/server/src/index.ts (existing imports)
import { kineticaSql as kineticaSqlHelper } from "./kinetica";  // line 15
import { type AuthedRequest } from "./auth";                     // line 13
import { getTable } from "./db";                                  // line 35
// requireConfig: defined inline at line 197-202 (function-local; NOT imported)
// asyncHandler: defined inline at line 208-214 (function-local; NOT imported)
// All inside createApp() body — new routes go inside the same function scope.
```

<!-- AuthedRequest field shape (post-requireAuth) -->
<!-- Source: kinetica_bi/server/src/auth.ts:26-38 -->

```typescript
export type AuthedRequest = Request & {
  requestId?: string;
  user?: {
    sub: string;
    sid: string;                                  // <-- sessionId for sessionShort
    credentialType: "password" | "oidc";
    creds: {
      username: string;                           // <-- username for sanitization
      password: string;
      token: string;
    };
  };
};
```

<!-- Reference DDL syntax (from RESEARCH.md and Kinetica docs) -->

```sql
CREATE OR REPLACE MATERIALIZED VIEW <viewName> AS
(SELECT * FROM <tableRef> WHERE <whereClause>)
USING TABLE PROPERTIES (TTL = 5)

DROP TABLE IF EXISTS <viewName>
```
- Parentheses around the SELECT subquery are REQUIRED.
- `USING TABLE PROPERTIES (TTL = 5)` MUST be after the closing paren of the subquery.
- TTL unit is minutes (sliding); 5 minutes per locked decision.
- DROP uses `DROP TABLE IF EXISTS` (NOT `DROP MATERIALIZED VIEW` — that syntax is invalid).

<!-- Existing test fixtures and helpers -->
<!-- Source: kinetica_bi/server/tests/routes.materialize.spec.ts -->

```typescript
const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";

const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
```

<!-- AUTH_MODE stubbing pattern (REQUIRED in beforeEach) -->
<!-- Source: kinetica_bi/server/tests/routes.wms.capabilities.spec.ts:39-42 -->

```typescript
beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "password");  // or "oidc" for OIDC tests
  db.exec("DELETE FROM sessions");
});
afterEach(() => { vi.unstubAllEnvs(); });
```

<!-- Reference handler skeleton (RESEARCH.md Pattern 1) -->

```typescript
app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
  const { dashboardId, tableId, filters } = req.body as {
    dashboardId: number;
    tableId: number;
    filters: ActiveFilter[];
  };
  if (!Array.isArray(filters) || filters.length === 0) {
    return res.status(400).json({ error: "filters array must be non-empty for POST." });
  }
  if (typeof dashboardId !== "number" || typeof tableId !== "number") {
    return res.status(400).json({ error: "dashboardId and tableId are required numbers." });
  }
  const authedReq = req as AuthedRequest;
  const viewName = buildFilterViewName({
    username: authedReq.user!.creds.username,
    sessionId: authedReq.user!.sid,
    dashboardId,
    tableId,
  });
  const table = getTable(tableId);
  if (!table) return res.status(404).json({ error: "Table not found." });
  const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name;
  const whereClause = buildServerWhereClause(filters);
  const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;
  await kineticaSqlHelper(authedReq, ddl, {
    route: "POST /api/filter/materialize",
    op: "MATERIALIZE",
  });
  const expiresAt = Date.now() + 5 * 60 * 1000;
  return res.json({ viewName, expiresAt });
}));
```
</interfaces>

<spike_dependent_branches>
<!-- Read 13-SPIKE-NOTES.md before implementing — these branches alter task action -->

S2 (DDL permission) outcome:
  - PASS: Implement per-user creds path verbatim (this plan as written). VIEW-V13-05 supertest still asserts 403-with-no-code-field for the case where Kinetica DOES deny.
  - FAIL: Plan 13-04 (gap-closure) is added BEFORE this plan executes. The handler accepts a service-account fallback branch (env-var-toggled). This plan's tasks DO NOT change; the fallback is layered in 13-04 and the supertest in this plan adds an additional case for the service-account path.

S4 (schema qualification) outcome:
  - Both work / Only unqualified: viewNaming.ts (Plan 13-02) returns unqualified; this plan's handler does NOT pass a schema. No code change here.
  - Only qualified works: viewNaming.ts requires `schema` param. The handler reads `table.schema` (already available from `getTable(tableId)`) and passes it: `buildFilterViewName({ ..., schema: table.schema })`. The supertest happy-path then asserts the view name is prefixed (e.g. `ki_home._kbi_filt_...`).
  - Both fail: charts ship; map defers. Endpoint is built either way (regardless of S1/S4 — endpoint is map-agnostic).
</spike_dependent_branches>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add POST + DELETE /api/filter/materialize routes to index.ts</name>
  <files>kinetica_bi/server/src/index.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (lines 1-70: existing imports — confirm where to add new imports for lib/viewNaming and lib/whereClause; lines 197-214: requireConfig + asyncHandler definitions; lines 419-420: app.use("/api", requireAuth) global guard; lines 613-648: existing POST /api/views/:id/materialize as structural reference; lines 800-823: errorMiddleware translation rules)
    - kinetica_bi/server/src/lib/viewNaming.ts (Plan 13-02 — buildFilterViewName signature; CHECK whether `schema` param is present based on S4 outcome)
    - kinetica_bi/server/src/lib/whereClause.ts (Plan 13-02 — buildServerWhereClause signature; ActiveFilter type)
    - kinetica_bi/server/src/kinetica.ts (lines 30-37: KineticaOp enum — confirm "MATERIALIZE" is already a valid op tag)
    - kinetica_bi/server/src/auth.ts (lines 26-38: AuthedRequest user shape — for `creds.username` and `sid` access)
    - kinetica_bi/server/src/db.ts (lines 248-260: getTable signature — confirm `table.schema` and `table.name` field names)
    - .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md (S4 outcome — drives whether handler passes `schema` to buildFilterViewName)
  </read_first>
  <behavior>
    - POST /api/filter/materialize with body {dashboardId: 1, tableId: 1, filters: [{column:"zone", value:"East Village", dataType:"string", addedAt:0}]} returns 200 with { viewName: <string matching `_kbi_filt_u\w+_d1_t1_s\w{8}` regex>, expiresAt: <number greater than Date.now()> }
    - POST sends DDL string `CREATE OR REPLACE MATERIALIZED VIEW <viewName> AS (SELECT * FROM <schema>.<table> WHERE zone = 'East Village') USING TABLE PROPERTIES (TTL = 5)` to Kinetica via kineticaSql with op: "MATERIALIZE"
    - POST with empty filters array returns 400 (paired endpoints — clear path is DELETE, not empty-filters POST)
    - POST with missing dashboardId or tableId returns 400
    - POST when getTable(tableId) returns undefined → returns 404 with { error: "Table not found." }
    - POST when Kinetica returns 403 → KineticaPermissionError → errorMiddleware sends 403 + { error: <message> } with NO `code` field (matches existing convention at index.ts:812-815)
    - POST in OIDC mode (credentialType="oidc") with username "john.doe@kinetica.com" produces viewName starting with `_kbi_filt_ujohn_doe_kinetica_com_` (sanitization applied)
    - DELETE /api/filter/materialize?dashboardId=1&tableId=1 returns 200 with { dropped: true }
    - DELETE sends `DROP TABLE IF EXISTS <viewName>` to Kinetica via kineticaSql with op: "MATERIALIZE"
    - DELETE with missing query params returns 400
    - DELETE does NOT require a table to exist in SQLite (server is stateless re views — `DROP TABLE IF EXISTS` is idempotent on Kinetica side; route uses session-derived viewName regardless)
    - Both routes are gated by requireAuth (mounted under /api/*); without a session cookie, requests get 401 from the existing requireAuth middleware
    - Both routes use requireConfig (return 500 if KINETICA_URL is not set)
    - NEITHER route handler contains a try/catch (errors bubble through asyncHandler → errorMiddleware)
    - kineticaSql is invoked with `op: "MATERIALIZE"` for both POST and DELETE (verified in audit log entries during testing)
  </behavior>
  <action>
    Step 1 (Read): Read 13-SPIKE-NOTES.md S4 outcome. Branches:
      - "Both work" or "Only unqualified works": handler does NOT pass `schema` to buildFilterViewName.
      - "Only qualified works": handler passes `table.schema` to buildFilterViewName (Plan 13-02 viewNaming.ts must already accept this param — verify by reading lib/viewNaming.ts).

    Step 2 (Imports): Add the following imports to `kinetica_bi/server/src/index.ts` near the existing kinetica/auth/db imports (around lines 13-55). Use the EXACT relative paths:

    ```typescript
    import { buildFilterViewName } from "./lib/viewNaming";
    import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause";
    ```

    Place these IMMEDIATELY AFTER the existing `import { kineticaSql as kineticaSqlHelper, kineticaWms } from "./kinetica";` line (currently line 15) so all helper-module imports cluster.

    Step 3 (Routes): Inside the `createApp()` function body, AFTER the existing `app.post("/api/views/:id/materialize", ...)` block (currently ends at line 648), and BEFORE the `// Table persistence` comment (currently at line 650), insert the following two route handlers:

    ```typescript
    // ----- v1.3 Phase 13: Filter materialize (transient, session-scoped) -----
    // POST /api/filter/materialize — apply filters by creating/replacing a transient materialized view.
    // DELETE /api/filter/materialize — clear filters by dropping the transient view.
    //
    // Differences from /api/views/:id/materialize (the persisted view CRUD endpoint above):
    //   - Server is stateless re views (no SQLite reads/writes; Kinetica TTL=5 is sole cleanup)
    //   - View name is composed from session context (user, session, dashboard, table), not read from a row
    //   - WHERE clause is built server-side from request body filters (VIEW-V13-06)
    //   - NO try/catch — typed errors bubble through asyncHandler → errorMiddleware (no side effects to persist)
    //
    // V13-P-08: Username sanitization happens inside buildFilterViewName (lib/viewNaming.ts).
    // CONTEXT.md decisions § View-name details: shape is _kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>.

    app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        dashboardId?: number;
        tableId?: number;
        filters?: ActiveFilter[];
      };
      const { dashboardId, tableId, filters } = body;

      if (typeof dashboardId !== "number" || typeof tableId !== "number") {
        return res.status(400).json({ error: "dashboardId and tableId are required numbers." });
      }
      if (!Array.isArray(filters) || filters.length === 0) {
        return res.status(400).json({ error: "filters array must be non-empty (use DELETE to clear)." });
      }

      const table = getTable(tableId);
      if (!table) return res.status(404).json({ error: "Table not found." });
      const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

      const authedReq = req as AuthedRequest;
      const viewName = buildFilterViewName({
        username: authedReq.user!.creds.username,
        sessionId: authedReq.user!.sid,
        dashboardId,
        tableId,
        // S4 BRANCH: if S4 said "Only qualified works", uncomment the next line:
        // schema: table.schema,
      });

      const whereClause = buildServerWhereClause(filters);
      const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;

      await kineticaSqlHelper(authedReq, ddl, {
        route: "POST /api/filter/materialize",
        op: "MATERIALIZE",
      });

      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes (sliding TTL)
      return res.json({ viewName, expiresAt });
    }));

    app.delete("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
      const dashboardId = Number(req.query.dashboardId);
      const tableId = Number(req.query.tableId);

      if (!Number.isFinite(dashboardId) || !Number.isFinite(tableId)) {
        return res.status(400).json({ error: "dashboardId and tableId query params are required numbers." });
      }

      const authedReq = req as AuthedRequest;
      const viewName = buildFilterViewName({
        username: authedReq.user!.creds.username,
        sessionId: authedReq.user!.sid,
        dashboardId,
        tableId,
        // S4 BRANCH: if S4 said "Only qualified works", uncomment and read schema from getTable(tableId):
        // schema: getTable(tableId)?.schema ?? undefined,
      });

      await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${viewName}`, {
        route: "DELETE /api/filter/materialize",
        op: "MATERIALIZE",
      });

      return res.json({ dropped: true });
    }));
    ```

    Step 4 (S4 branch): If S4 outcome was "Only qualified works", uncomment BOTH the POST `// schema: table.schema,` line AND the DELETE `// schema: getTable(tableId)?.schema ?? undefined,` line. Replace the surrounding comments with `// S4 outcome: schema-qualified required` (keep one explanatory comment).

    Step 5 (Verify): Run `cd kinetica_bi/server && npx tsc --noEmit` — must pass with zero errors. Then `npm test` — full suite including existing tests must stay green (no regressions).

    NEVER add a try/catch around the kineticaSqlHelper call — the existing errorMiddleware (index.ts:801-823) handles KineticaAuthError/KineticaPermissionError/KineticaUpstreamError. Adding try/catch here breaks the no-side-effects-stateless-handler invariant (V13 Pitfall 1 in RESEARCH.md).

    NEVER add SQLite reads/writes for the transient view — server is stateless re views (VIEW-V13-04). The `dashboard_table_views` SQLite table is for the pre-v1.0 PERSISTED view CRUD only.

    NEVER change the existing POST /api/views/:id/materialize handler — that endpoint stays intact for persisted views.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/index.ts` contains the literal substring `import { buildFilterViewName } from "./lib/viewNaming";`
    - File contains the literal substring `import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause";`
    - File contains the literal substring `app.post("/api/filter/materialize"`
    - File contains the literal substring `app.delete("/api/filter/materialize"`
    - File contains the literal substring `CREATE OR REPLACE MATERIALIZED VIEW` AT LEAST TWICE (once for the existing /api/views/:id/materialize at line ~623, once for the new POST /api/filter/materialize): `grep -c "CREATE OR REPLACE MATERIALIZED VIEW" kinetica_bi/server/src/index.ts` >= 2
    - File contains the literal substring `USING TABLE PROPERTIES (TTL = 5)` (the new DDL — appears exactly once)
    - File contains the literal substring `DROP TABLE IF EXISTS` (the DELETE handler DDL)
    - File contains the literal substring `op: "MATERIALIZE"` AT LEAST 3 TIMES (existing materialize endpoint + new POST + new DELETE): `grep -c 'op: "MATERIALIZE"' kinetica_bi/server/src/index.ts` >= 3
    - The new POST handler does NOT contain `try {` within its body. Verify: extract the lines between `app.post("/api/filter/materialize"` and the next `app.` declaration, then `grep -c "try {"` on that range — must equal 0
    - The new DELETE handler does NOT contain `try {` within its body. Same check on its range — must equal 0
    - File contains the literal substring `Date.now() + 5 * 60 * 1000` (expiresAt computation; 5 min in ms)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - `cd kinetica_bi/server && npm test` exits 0 (full backend suite — no regressions in existing tests)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx tsc --noEmit && npm test 2>&1 | tail -5</automated>
  </verify>
  <done>Both routes are wired in index.ts; tsc clean; existing tests still green; no try/catch in new handlers; imports added in the helper-imports cluster; S4 branch reflected per 13-SPIKE-NOTES.md outcome.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create routes.filter-materialize.spec.ts with full coverage (POST + DELETE; password + OIDC modes)</name>
  <files>kinetica_bi/server/tests/routes.filter-materialize.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/routes.materialize.spec.ts (lines 1-55: imports, fixture setup, makeSessionCookie helper, successKineticaBody mock — copy these patterns verbatim; lines 56-110: happy-path test pattern; lines 131-156: KineticaPermissionError test pattern)
    - kinetica_bi/server/tests/routes.wms.capabilities.spec.ts (lines 39-42: vi.stubEnv("AUTH_MODE", ...) pattern; lines 1-50: any OIDC-mode session helper if present)
    - kinetica_bi/server/tests/setup.ts (env var defaults set in setupFiles — AUTH_SECRET, KINETICA_URL, DB_PATH=:memory:, mockKineticaLoginOK helper)
    - kinetica_bi/server/tests/helpers/app.ts (buildTestApp() — must `await` the call)
    - kinetica_bi/server/src/index.ts (the new handlers added in Task 1 — for confirming exact request/response shape)
    - kinetica_bi/server/src/sessionStore.ts (createSession signature — for OIDC session creation; check if `credentialType: "oidc"` accepts `idToken` and `secret` as access_token)
    - .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md (S4 outcome — drives expected viewName regex in supertest assertions)
  </read_first>
  <behavior>
    Full describe-block list (each `describe` should contain the listed `it` cases):

    describe("POST /api/filter/materialize — AUTH_MODE=password"):
      - "happy path: returns 200 with { viewName, expiresAt } where viewName matches _kbi_filt_u<user>_d<dash>_t<table>_s<8hex>"
      - "DDL string: contains CREATE OR REPLACE MATERIALIZED VIEW <viewName> AS (SELECT * FROM ki_home.events WHERE zone = 'East Village') USING TABLE PROPERTIES (TTL = 5)"
      - "DDL escapes single quotes: input value O'Brien produces SQL fragment 'O''Brien'"
      - "view-name format: matches /^_kbi_filt_u\\w+_d\\d+_t\\d+_s\\w{8}$/"
      - "kineticaSql audit op: invocation uses op: 'MATERIALIZE' (assert via fetch mock body inspection or audit log parse)"
      - "empty filters array: returns 400 with { error: \"filters array must be non-empty (use DELETE to clear).\" }"
      - "missing dashboardId: returns 400"
      - "missing tableId: returns 400"
      - "non-existent tableId: getTable returns undefined → returns 404 with { error: \"Table not found.\" }"
      - "Kinetica returns 403 → KineticaPermissionError → response is 403 with { error } and NO `code` field (assert res.body.code === undefined)"
      - "Kinetica returns 401 → KineticaAuthError → response is 401 with { error, code: 'REAUTH_REQUIRED' }"
      - "no session cookie: returns 401 (requireAuth blocks)"
      - "expiresAt is a number greater than Date.now() (sanity check the 5-min offset)"

    describe("POST /api/filter/materialize — AUTH_MODE=oidc"):
      - "OIDC username with dots produces sanitized view name (e.g. john.doe@kinetica.com → ujohn_doe_kinetica_com)"
      - "happy path: returns 200; auth header to Kinetica is Bearer <token> (not Basic)"

    describe("DELETE /api/filter/materialize — AUTH_MODE=password"):
      - "happy path: returns 200 with { dropped: true }"
      - "DDL string: contains DROP TABLE IF EXISTS <viewName>"
      - "kineticaSql op: invocation uses op: 'MATERIALIZE' (same op tag as POST — single MATERIALIZE op tag covers both create and drop)"
      - "missing dashboardId query param: returns 400"
      - "missing tableId query param: returns 400"
      - "non-numeric dashboardId: returns 400"
      - "no session cookie: returns 401"

    describe("DELETE /api/filter/materialize — AUTH_MODE=oidc"):
      - "OIDC session: returns 200 with auth header Bearer <token>"
  </behavior>
  <action>
    Step 1 (RED): Create `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` with all describe/it blocks from <behavior>. Use the patterns from `routes.materialize.spec.ts:1-55`:

    ```typescript
    import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
    import jwt from "jsonwebtoken";
    import { buildTestApp } from "./helpers/app";
    import { createSession } from "../src/sessionStore";
    import {
      db,
      createDashboard,
      createTable,
    } from "../src/db";

    const AUTH_SECRET = process.env.AUTH_SECRET!;
    const KINETICA_URL = process.env.KINETICA_URL!;
    const SESSION_PASSWORD = "alice-pw-secret";

    // Seed a dashboard + table fixture (no SQLite views — server is stateless re transient views)
    const seedFixture = (tableName = "events", schema = "ki_home") => {
      const dash = createDashboard("Test Dashboard", "");
      const tbl = createTable({ name: tableName, schema, columns: {} });
      return { dashId: dash.id, tableId: tbl.id, schema, tableName };
    };

    const successKineticaBody = {
      status: "OK",
      message: "",
      data_type: "execute_sql_response",
      data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
    };

    const makeSessionCookie = (username = "alice") => {
      const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
      const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
      return { sid, cookie: `kbi_session=${token}` };
    };

    const makeOidcSessionCookie = (username = "john.doe@kinetica.com") => {
      const sid = createSession({
        username,
        secret: "fake-oidc-access-token",
        kineticaUrl: KINETICA_URL,
        credentialType: "oidc",
        idToken: "fake-id-token",
      });
      const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
      return { sid, cookie: `kbi_session=${token}` };
    };

    describe("POST /api/filter/materialize — AUTH_MODE=password", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "password");
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM dashboard_table_views");
        db.exec("DELETE FROM dashboard_tables");
        db.exec("DELETE FROM tables");
        db.exec("DELETE FROM dashboards");
      });
      afterEach(() => { vi.unstubAllEnvs(); });

      it("happy path: returns 200 with { viewName, expiresAt }", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        ));
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(200);
        expect(res.body.viewName).toMatch(/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/);
        expect(res.body.expiresAt).toBeGreaterThan(Date.now());
        // S4 branch: if qualified-required, also assert: expect(res.body.viewName).toMatch(/^ki_home\._kbi_filt_/);
      });

      it("sends DDL: CREATE OR REPLACE MATERIALIZED VIEW <name> AS (SELECT * FROM <schema>.<table> WHERE zone = 'East Village') USING TABLE PROPERTIES (TTL = 5)", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        );
        vi.stubGlobal("fetch", fetchMock);
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }],
          });
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body as string);
        expect(body.statement).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u\w+/);
        expect(body.statement).toContain("(SELECT * FROM ki_home.events WHERE zone = 'East Village')");
        expect(body.statement).toContain("USING TABLE PROPERTIES (TTL = 5)");
      });

      it("escapes single quotes in string values: O'Brien → 'O''Brien'", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        );
        vi.stubGlobal("fetch", fetchMock);
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "name", value: "O'Brien", dataType: "string", addedAt: 0 }],
          });
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body as string);
        expect(body.statement).toContain("name = 'O''Brien'");
      });

      it("empty filters array: returns 400", async () => {
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({ dashboardId: dashId, tableId, filters: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("non-empty");
      });

      it("missing dashboardId: returns 400", async () => {
        const { tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({ tableId, filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }] });
        expect(res.status).toBe(400);
      });

      it("missing tableId: returns 400", async () => {
        const { dashId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({ dashboardId: dashId, filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }] });
        expect(res.status).toBe(400);
      });

      it("non-existent tableId: returns 404", async () => {
        const { dashId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId: 99999,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Table not found.");
      });

      it("Kinetica 403 → 403 with NO code field (errorMiddleware convention)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(403);
        expect(res.body.error).toBeTruthy();
        expect(res.body.code).toBeUndefined();
      });

      it("Kinetica 401 → 401 with code: REAUTH_REQUIRED", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("REAUTH_REQUIRED");
      });

      it("no session cookie: returns 401 (requireAuth)", async () => {
        const { dashId, tableId } = seedFixture();
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(401);
      });
    });

    describe("POST /api/filter/materialize — AUTH_MODE=oidc", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "oidc");
        // OIDC mode requires OIDC env vars — stub minimal to allow boot
        vi.stubEnv("OIDC_ISSUER", "https://idp.test");
        vi.stubEnv("OIDC_CLIENT_ID", "test-client");
        vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
        vi.stubEnv("OIDC_REDIRECT_URI", "http://localhost/callback");
        vi.stubEnv("WEB_REDIRECT_BASE", "http://localhost");
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM tables");
        db.exec("DELETE FROM dashboards");
      });
      afterEach(() => { vi.unstubAllEnvs(); });

      it("OIDC username with dots produces sanitized view name", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        ));
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeOidcSessionCookie("john.doe@kinetica.com");
        const agent = await buildTestApp();
        const res = await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        expect(res.status).toBe(200);
        expect(res.body.viewName).toMatch(/^_kbi_filt_ujohn_doe_kinetica_com_/);
      });

      it("OIDC: auth header to Kinetica is Bearer <token>", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        );
        vi.stubGlobal("fetch", fetchMock);
        const { dashId, tableId } = seedFixture();
        const { cookie } = makeOidcSessionCookie("alice@kinetica.com");
        const agent = await buildTestApp();
        await agent
          .post("/api/filter/materialize")
          .set("Cookie", cookie)
          .send({
            dashboardId: dashId,
            tableId,
            filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
          });
        const [, init] = fetchMock.mock.calls[0];
        const auth = (init.headers as Record<string, string>).Authorization;
        expect(auth).toMatch(/^Bearer fake-oidc-access-token$/);
      });
    });

    describe("DELETE /api/filter/materialize — AUTH_MODE=password", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "password");
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM tables");
        db.exec("DELETE FROM dashboards");
      });
      afterEach(() => { vi.unstubAllEnvs(); });

      it("happy path: returns 200 with { dropped: true }", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        ));
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: 1, tableId: 1 })
          .set("Cookie", cookie);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ dropped: true });
      });

      it("sends DDL: DROP TABLE IF EXISTS <viewName>", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        );
        vi.stubGlobal("fetch", fetchMock);
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: 1, tableId: 1 })
          .set("Cookie", cookie);
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body as string);
        expect(body.statement).toMatch(/^DROP TABLE IF EXISTS _kbi_filt_u\w+_d1_t1_s\w{8}$/);
      });

      it("missing dashboardId: returns 400", async () => {
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ tableId: 1 })
          .set("Cookie", cookie);
        expect(res.status).toBe(400);
      });

      it("missing tableId: returns 400", async () => {
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: 1 })
          .set("Cookie", cookie);
        expect(res.status).toBe(400);
      });

      it("non-numeric dashboardId: returns 400", async () => {
        const { cookie } = makeSessionCookie("alice");
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: "abc", tableId: 1 })
          .set("Cookie", cookie);
        expect(res.status).toBe(400);
      });

      it("no session cookie: returns 401", async () => {
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: 1, tableId: 1 });
        expect(res.status).toBe(401);
      });
    });

    describe("DELETE /api/filter/materialize — AUTH_MODE=oidc", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "oidc");
        vi.stubEnv("OIDC_ISSUER", "https://idp.test");
        vi.stubEnv("OIDC_CLIENT_ID", "test-client");
        vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
        vi.stubEnv("OIDC_REDIRECT_URI", "http://localhost/callback");
        vi.stubEnv("WEB_REDIRECT_BASE", "http://localhost");
        db.exec("DELETE FROM sessions");
      });
      afterEach(() => { vi.unstubAllEnvs(); });

      it("OIDC: returns 200; Bearer auth header", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(successKineticaBody), { status: 200 })
        );
        vi.stubGlobal("fetch", fetchMock);
        const { cookie } = makeOidcSessionCookie("alice@kinetica.com");
        const agent = await buildTestApp();
        const res = await agent
          .delete("/api/filter/materialize")
          .query({ dashboardId: 1, tableId: 1 })
          .set("Cookie", cookie);
        expect(res.status).toBe(200);
        const [, init] = fetchMock.mock.calls[0];
        const auth = (init.headers as Record<string, string>).Authorization;
        expect(auth.startsWith("Bearer ")).toBe(true);
      });
    });
    ```

    Step 2 (Adjust to OIDC env): The OIDC test setup uses `vi.stubEnv` for OIDC_ISSUER etc. If `buildTestApp()` does HTTP discovery against the issuer, the OIDC tests may need additional fetch stubbing for the `.well-known/openid-configuration` endpoint. Check `kinetica_bi/server/tests/auth.oidc.spec.ts` for the established OIDC-mode setup pattern; replicate. If discovery is too noisy to stub, the OIDC tests can use `validateOidcEnv` mocking via `vi.mock("../src/oidc", ...)` — copy the pattern from existing OIDC tests.

    Step 3 (Run): `cd kinetica_bi/server && npx vitest run routes.filter-materialize.spec.ts` — every test passes (GREEN).

    Step 4 (Run full suite): `cd kinetica_bi/server && npm test` — full backend suite stays green.

    Spike-dependent test branch: If S4 outcome was "Only qualified works", the happy-path test must additionally assert `expect(res.body.viewName).toMatch(/^ki_home\._kbi_filt_/)` (qualified prefix). Add this assertion in the appropriate it-block.

    NEVER skip the AUTH_MODE OIDC tests — VIEW-V13-07 explicitly requires both modes covered. If OIDC discovery is the blocker, mock the oidc module entirely (`vi.mock("../src/oidc", () => ({ validateOidcEnv: vi.fn(), initOidcClient: vi.fn().mockResolvedValue({}), ... }))`).
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` exists
    - File contains 4 top-level `describe(` blocks: `POST /api/filter/materialize — AUTH_MODE=password`, `POST /api/filter/materialize — AUTH_MODE=oidc`, `DELETE /api/filter/materialize — AUTH_MODE=password`, `DELETE /api/filter/materialize — AUTH_MODE=oidc`
    - File contains the regex literal `/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/` (view-name format assertion)
    - File contains the literal substring `USING TABLE PROPERTIES (TTL = 5)` (DDL shape assertion)
    - File contains the literal substring `DROP TABLE IF EXISTS _kbi_filt_u` (DELETE DDL assertion)
    - File contains the literal substring `O''Brien` (single-quote escape assertion)
    - File contains the literal substring `expect(res.body.code).toBeUndefined()` (no-code-field assertion for KineticaPermissionError)
    - File contains the literal substring `code: "REAUTH_REQUIRED"` OR `expect(res.body.code).toBe("REAUTH_REQUIRED")` (KineticaAuthError 401 assertion)
    - File contains the literal substring `Bearer ` (OIDC auth header assertion)
    - File contains the literal substring `vi.stubEnv("AUTH_MODE", "password")` AND `vi.stubEnv("AUTH_MODE", "oidc")` (both AUTH_MODE variants exercised)
    - `cd kinetica_bi/server && npx vitest run routes.filter-materialize.spec.ts` exits 0 with at least 18 tests passing (count: 13 password POST + 2 OIDC POST + 6 password DELETE + 1 OIDC DELETE = ~22)
    - `cd kinetica_bi/server && npm test` exits 0 (full backend suite — no regressions)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run routes.filter-materialize.spec.ts && npm test 2>&1 | tail -5</automated>
  </verify>
  <done>routes.filter-materialize.spec.ts exists; all describe blocks cover the listed cases; full vitest suite stays green; tsc clean; both AUTH_MODE variants tested per VIEW-V13-07; KineticaPermissionError 403-no-code-field convention asserted.</done>
</task>

</tasks>

<verification>
- `kinetica_bi/server/src/index.ts` has POST + DELETE /api/filter/materialize handlers, no try/catch in either, op: "MATERIALIZE" tag on both kineticaSqlHelper calls
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` covers happy paths, error paths (400/401/403/404), DDL string shape, view-name format, single-quote escape, both AUTH_MODE variants
- `cd kinetica_bi/server && npm test` exits 0 (full suite green)
- `cd kinetica_bi/server && npx tsc --noEmit` exits 0
- The view-name regex `_kbi_filt_u\w+_d\d+_t\d+_s\w{8}` is the source-of-truth for Phase 14 client expectations
- The endpoint contract `{ viewName, expiresAt }` for POST and `{ dropped: true }` for DELETE is the source-of-truth for Phase 14 client helpers
</verification>

<success_criteria>
- POST /api/filter/materialize handler is wired and tested in both AUTH_MODE variants
- DELETE /api/filter/materialize handler is wired and tested in both AUTH_MODE variants
- VIEW-V13-01, VIEW-V13-02, VIEW-V13-04, VIEW-V13-05, VIEW-V13-07 are satisfied (frontmatter requirements list)
- Phase 13 ROADMAP success criteria 2, 3, 4, 5 are satisfied (see ROADMAP.md Phase 13 entry)
- Plan 14-01 (Phase 14 first plan) can begin: it knows the exact request/response shape and view-name format
</success_criteria>

<output>
After completion, create `.planning/phases/13-spikes-and-endpoint/13-03-SUMMARY.md` summarizing:
- The two route handlers added (file, line range, request/response shape)
- The exact view-name regex Phase 14 will use to validate client-received names
- Whether S4 caused schema-qualified output (yes/no)
- Test count: how many tests in routes.filter-materialize.spec.ts (split by describe block)
- Confirmation: `cd kinetica_bi/server && npm test` exit 0 + tsc clean
- Phase 13 readiness for the milestone audit: which phase-13 requirements are now `[x]` (SPIKE-V13-01..04 from Plan 13-01; VIEW-V13-03 + VIEW-V13-06 from Plan 13-02; VIEW-V13-01, 02, 04, 05, 07 from this plan)
</output>
</content>
</invoke>