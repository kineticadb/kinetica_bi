---
phase: 33-dynamic-view-store
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts
autonomous: true
requirements:
  - DV-V16-07
must_haves:
  truths:
    - "`POST /api/dynamic-view/:id/drop` exists and accepts a numeric :id path param."
    - "On valid :id: loads the row, computes `dynamicViewName` via `buildDynamicViewName({ userId: req.user!.creds.username, dashboardId: row.dashboard_id, dynamicViewId: row.id })`, runs `DROP TABLE IF EXISTS <dynamicViewName>` via `kineticaSqlHelper`, returns `200 { dropped: true }`."
    - "On missing :id: returns `404 { error: 'Dynamic view not found.' }` and does NOT fire any Kinetica DROP."
    - "On non-numeric :id: returns `400 { error: '...numeric...' }` (mirrors DELETE /api/dynamic-view/:id validation pattern)."
    - "The SQLite row is UNTOUCHED — this is a DROP-only primitive, NOT a delete. (Verified by asserting `getDashboardDynamicView(id)` still returns the row after a successful drop call.)"
    - "Idempotent — calling drop twice in a row both return 200 (DROP IF EXISTS is silent on missing views)."
    - "Endpoint works in both `AUTH_MODE=password` and `AUTH_MODE=oidc` (supertest coverage in both blocks)."
    - "401 returned on missing session cookie."
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "New Express route POST /api/dynamic-view/:id/drop registered between the existing materialize (~line 1115) and DELETE (~line 1219) routes"
      contains: "/api/dynamic-view/:id/drop"
    - path: "kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts"
      provides: "Supertest coverage: happy path, 404 missing-id, 400 non-numeric, 401 no-session, idempotency, row-untouched assertion, both auth modes (≥ 8 tests)"
      min_lines: 200
  key_links:
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/:id/drop"
      to: "kinetica_bi/server/src/lib/dynamicViewName.ts buildDynamicViewName"
      via: "compute the target Kinetica view name from { userId, dashboardId, dynamicViewId } — same code path used by materialize + DELETE routes"
      pattern: "buildDynamicViewName\\(\\{"
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/:id/drop"
      to: "kinetica_bi/server/src/db.ts getDashboardDynamicView"
      via: "load row by :id to derive dashboard_id + dynamic_view_id for the name composer"
      pattern: "getDashboardDynamicView\\("
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/:id/drop"
      to: "kinetica_bi/server/src/kinetica.ts kineticaSql (aliased as kineticaSqlHelper)"
      via: "DROP TABLE IF EXISTS <dynamicViewName>"
      pattern: "DROP TABLE IF EXISTS"
---

<objective>
Ship the NEW server endpoint `POST /api/dynamic-view/:id/drop` — a DROP-only lifecycle-cleanup primitive that leaves the SQLite config row UNTOUCHED. This endpoint is consumed exclusively by Plan 33-03's `reset()` DROP loop in the lifecycle reset block (logout + dashboard switch). The existing destructive `DELETE /api/dynamic-view/:id` stays untouched — it's the operator's explicit "delete this saved config" primitive, NOT a lifecycle cleanup primitive.

Purpose: Bridges the gap between "operator deletes a saved config" (existing DELETE — drops view AND row) and "user logs out / switches dashboard" (this NEW endpoint — drops view, keeps row). Without it, the reset() loop would either (a) wipe operator's saved configs by calling DELETE, or (b) leave dormant materialized views on Kinetica indefinitely until TTL=5min cleanup.

Output: One new route registered between the existing `POST /api/dynamic-view/materialize` (~line 1115) and `DELETE /api/dynamic-view/:id` (~line 1219). One new supertest spec file mirroring the dual-auth-mode shape of `routes.dynamic-view.spec.ts`.

This plan is **independent** of Plan 33-01 (no frontend imports) and runs in parallel as Wave 1. Plan 33-03 imports the resulting client helper (defined in Plan 33-03) which hits this endpoint.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/33-dynamic-view-store/33-CONTEXT.md
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md
@.planning/phases/32-dynamic-view-foundation/32-03-preview-materialize-delete-PLAN.md

<interfaces>
<!-- Existing helpers + types this plan composes. -->

From `kinetica_bi/server/src/lib/dynamicViewName.ts` (existing, used by materialize + DELETE routes):
```typescript
export type DynamicViewNameArgs = { userId: string; dashboardId: number; dynamicViewId: number };
export function buildDynamicViewName(args: DynamicViewNameArgs): string;
// Output: _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
```

From `kinetica_bi/server/src/db.ts` (existing — used by materialize + DELETE routes):
```typescript
export const getDashboardDynamicView: (id: number) => DashboardDynamicView | undefined;
// Returns { id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json, created_at, updated_at } or undefined.
```

From `kinetica_bi/server/src/kinetica.ts` (existing, aliased in index.ts as `kineticaSqlHelper`):
```typescript
import { kineticaSql as kineticaSqlHelper, kineticaWms } from "./kinetica";
export async function kineticaSql(req: AuthedRequest, sql: string, opts: { route: string; op: KineticaOp }): Promise<...>;
```

From `kinetica_bi/server/src/index.ts` (existing patterns to mirror):
- `asyncHandler` wrap (declared at line ~237)
- `requireConfig` middleware (declared at line ~226)
- `authedReq = req as AuthedRequest` cast (used at lines 768, 1131)
- KineticaOp `"DYNAMIC_MATERIALIZE"` is the existing audit-log op tag used by the materialize + DELETE routes; this new route can REUSE that tag (the operator semantically does materialize-housekeeping when dropping a dynamic view) OR introduce `"DYNAMIC_DROP"` for finer-grained log filtering — executor's discretion. CONTEXT.md line 119 explicitly suggests `op: "DYNAMIC_DROP"`. Pick `DYNAMIC_DROP` — requires extending the `KineticaOp` union in `kinetica_bi/server/src/kinetica.ts`. (See action body for the verbatim KineticaOp extension.)

Reference for the route shape (the existing DELETE handler at index.ts:1219-1248 is the closest analog):
```typescript
// DELETE /api/dynamic-view/:id at kinetica_bi/server/src/index.ts:1219-1248 — DROP + delete row.
// The new POST /api/dynamic-view/:id/drop is identical EXCEPT:
//   - method: POST (not DELETE)
//   - path: /api/dynamic-view/:id/drop (not /api/dynamic-view/:id)
//   - response: { dropped: true } (not { deleted, dropped: true })
//   - NO call to deleteDashboardDynamicView — row stays intact
//   - op: "DYNAMIC_DROP" (not "DYNAMIC_MATERIALIZE")
```

Test harness reference (`routes.dynamic-view.spec.ts` — read first 200 lines):
- Hoisted openid-client mock so AUTH_MODE=oidc boot succeeds without network.
- `kineticaOk` / `respond` builders for Kinetica column-major responses.
- `seedFixture`, `seedDynamicView`, `makeSessionCookie`, `seedOidcSession`, `cleanFixtures` helpers.
- `sqlStatements(fetchMock)` extracts Kinetica `/execute/sql` statements in call order.
- The new `routes.dynamic-view-drop.spec.ts` MUST mirror this preamble VERBATIM (lines 1-191 of routes.dynamic-view.spec.ts). The describe block names follow the pattern `POST /api/dynamic-view/:id/drop — AUTH_MODE=password` and `... AUTH_MODE=oidc smoke`.

CONTEXT.md endpoint contract (verbatim from 33-CONTEXT.md lines 114-126):
- Path: `POST /api/dynamic-view/:id/drop`
- Behavior:
  1. Load row from `dashboard_dynamic_views` by `:id`. If absent → 404 `{ error: "Dynamic view not found." }`.
  2. Compute `dynamicViewName` via `buildDynamicViewName({ userId: authedReq.user!.creds.username, dashboardId: row.dashboard_id, dynamicViewId: row.id })`.
  3. `await kineticaSqlHelper(authedReq, \`DROP TABLE IF EXISTS ${dynamicViewName}\`, { route: "POST /api/dynamic-view/:id/drop", op: "DYNAMIC_DROP" })`.
  4. Respond `200 { dropped: true }`.
- Idempotent (DROP IF EXISTS is silent on missing views). No row mutation. Errors propagate through global errorMiddleware.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Register `POST /api/dynamic-view/:id/drop` in `kinetica_bi/server/src/index.ts`</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/src/kinetica.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (read lines 1-100 for the import block, lines 1114-1250 for the existing dynamic-view materialize + DELETE handlers — the new route registers between them)
    - kinetica_bi/server/src/kinetica.ts (read in full — confirm the `KineticaOp` union type location and current members so you know exactly where to add `DYNAMIC_DROP`)
    - kinetica_bi/server/src/lib/dynamicViewName.ts (read in full — confirm function signature)
    - kinetica_bi/server/src/db.ts lines 540-610 (read for `getDashboardDynamicView` signature confirmation; do NOT modify)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "NEW server endpoint" (lines 114-126 — the verbatim spec)
    - .planning/phases/32-dynamic-view-foundation/32-03-preview-materialize-delete-PLAN.md (read in full — for the verbatim style of route handlers in this region)
  </read_first>
  <action>
    1. Extend `KineticaOp` in `kinetica_bi/server/src/kinetica.ts`. Find the `KineticaOp` union (it currently contains members like `"MATERIALIZE"`, `"DYNAMIC_PREVIEW"`, `"DYNAMIC_MATERIALIZE"`, `"INFO_QUERY"`, etc.). Add `"DYNAMIC_DROP"` to the union. Concrete change:

    Locate the existing line declaring `KineticaOp` (grep: `grep -n "KineticaOp" kinetica_bi/server/src/kinetica.ts`). If the type is defined as a union literal like:

    ```typescript
    export type KineticaOp = "RAW" | "MATERIALIZE" | "DYNAMIC_PREVIEW" | "DYNAMIC_MATERIALIZE" | "INFO_QUERY" | ...;
    ```

    Add `| "DYNAMIC_DROP"` to the union. If it's defined as a const tuple + derived type, extend the tuple. Preserve all existing members.

    2. In `kinetica_bi/server/src/index.ts`, register the new route. Place it AFTER the existing `POST /api/dynamic-view/materialize` block (ends around line 1216) and BEFORE the existing `DELETE /api/dynamic-view/:id` block (starts around line 1218). The handler body must be VERBATIM:

    ```typescript
    // ----- v1.6 Phase 33 (DV-V16-07): Dynamic Views DROP-only primitive -----
    // POST /api/dynamic-view/:id/drop — DROP-only lifecycle-cleanup primitive used by
    // the frontend dynamicViewStore.reset() DROP loop (logout + dashboard switch).
    //
    // CONTRAST with DELETE /api/dynamic-view/:id below: DELETE drops the Kinetica view
    // AND deletes the SQLite row (destructive — operator's "delete this saved config" path).
    // This endpoint drops the Kinetica view ONLY — the SQLite row stays intact so the
    // operator's saved config survives logout. Mirrors the existing filter-view DROP
    // primitive (DELETE /api/filter/materialize at index.ts:801-823) which has no
    // config-row equivalent — filter views live only as Kinetica views.
    //
    // Idempotent — DROP IF EXISTS is silent on missing views. The frontend reset() loop
    // is fire-and-forget (.catch(()=>{})) so a 4xx/5xx here never blocks logout.
    app.post(
      "/api/dynamic-view/:id/drop",
      requireConfig,
      asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ error: "id path param must be numeric." });
        }
        const row = getDashboardDynamicView(id);
        if (!row) {
          return res.status(404).json({ error: "Dynamic view not found." });
        }
        const authedReq = req as AuthedRequest;
        const dynamicViewName = buildDynamicViewName({
          userId: authedReq.user!.creds.username,
          dashboardId: row.dashboard_id,
          dynamicViewId: row.id,
        });
        // DROP-only — NO call to deleteDashboardDynamicView. SQLite row stays intact.
        // Errors bubble through errorMiddleware (auth/permission/upstream — frontend swallows them).
        await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
          route: "POST /api/dynamic-view/:id/drop",
          op: "DYNAMIC_DROP",
        });
        return res.json({ dropped: true });
      })
    );
    ```

    3. Confirm the existing imports already present in index.ts cover everything:
       - `getDashboardDynamicView` — already imported (line ~80 from `./db`).
       - `buildDynamicViewName` — already imported (line ~20).
       - `kineticaSqlHelper` (aliased from `kineticaSql`) — already imported (line ~15).
       - `requireConfig`, `asyncHandler`, `AuthedRequest` — already declared/imported.
       NO new top-of-file imports should be needed for index.ts.

    4. Run `npx tsc --noEmit` from `kinetica_bi/server/`. If the KineticaOp type extension is wrong, fix it (the type error message will point to the line where `op: "DYNAMIC_DROP"` was rejected).

    5. DO NOT modify the existing `DELETE /api/dynamic-view/:id` handler at lines 1218-1248. DO NOT modify the existing `POST /api/dynamic-view/materialize` handler. DO NOT modify the existing `POST /api/filter/materialize` or any unrelated route.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx tsc --noEmit 2>&1 | tail -20 && grep -nE 'app\.post\(\s*"/api/dynamic-view/:id/drop"' kinetica_bi/server/src/index.ts</automated>
  </verify>
  <done>
    New route registered. KineticaOp union extended with `"DYNAMIC_DROP"`. `tsc --noEmit` clean. No existing handlers modified. Full server vitest suite still green (no regression).
  </done>
  <acceptance_criteria>
    - `grep -nE 'app\.post\(\s*"/api/dynamic-view/:id/drop"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE '"DYNAMIC_DROP"' kinetica_bi/server/src/index.ts` returns at least 1 line (the op tag in the new handler).
    - `grep -nE '"DYNAMIC_DROP"' kinetica_bi/server/src/kinetica.ts` returns at least 1 line (the union member).
    - `grep -nE 'return res\.json\(\{ dropped: true \}\)' kinetica_bi/server/src/index.ts | wc -l` returns at least 1 (the new handler's success response).
    - `grep -nE '"id path param must be numeric\."' kinetica_bi/server/src/index.ts | wc -l` returns at least 2 (existing DELETE handler + new drop handler both have this validation).
    - `grep -nE 'app\.delete\(\s*"/api/dynamic-view/:id"' kinetica_bi/server/src/index.ts` still returns exactly 1 line (existing DELETE handler untouched).
    - `grep -nE 'deleteDashboardDynamicView' kinetica_bi/server/src/index.ts | wc -l` returns exactly 1 (only DELETE handler calls it; new drop handler does NOT).
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view.spec.ts` still exits 0 (no regression on existing dynamic-view spec).
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` still exits 0 (no regression on filter-view spec).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Supertest spec `kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts` (both auth modes, ≥ 8 tests)</name>
  <files>kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/routes.dynamic-view.spec.ts (read in full — PRIMARY TEMPLATE for the dual-auth-mode test shape; copy lines 1-191 verbatim as the preamble for this new file)
    - kinetica_bi/server/tests/helpers/app.ts (read in full — confirm `buildTestApp` returns an agent suitable for supertest-style POST calls)
    - kinetica_bi/server/src/index.ts (re-read the new POST /api/dynamic-view/:id/drop handler you just wrote so spec assertions match exact response shapes)
    - kinetica_bi/server/src/db.ts lines 540-610 (`getDashboardDynamicView`, `createDashboardDynamicView` — used in seeding + post-drop row-untouched assertion)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "Tests" (locked test list)
  </read_first>
  <action>
    1. Create `kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts`. Copy the preamble VERBATIM from `routes.dynamic-view.spec.ts` lines 1-191 (the hoisted openid-client mock, the import block, the response builders, the seed helpers, the `cleanFixtures` block, and `sqlStatements`). Adjust the file header comment to describe the new endpoint:

    ```typescript
    /**
     * routes.dynamic-view-drop.spec.ts — Phase 33 Plan 02 supertest coverage.
     *
     * Covers the new POST /api/dynamic-view/:id/drop endpoint — the DROP-only
     * lifecycle-cleanup primitive used by the frontend dynamicViewStore.reset()
     * DROP loop (logout + dashboard switch). Mirrors the dual-auth-mode harness
     * pattern from routes.dynamic-view.spec.ts.
     *
     * CONTRAST with DELETE /api/dynamic-view/:id covered by routes.dynamic-view.spec.ts:
     *   - DELETE drops view AND removes SQLite row.
     *   - POST /api/dynamic-view/:id/drop drops view ONLY; SQLite row stays intact.
     *
     * Test list (locked by 33-CONTEXT.md):
     *   AUTH_MODE=password block:
     *     1. happy path — returns 200 { dropped: true }, fires DROP TABLE IF EXISTS, row UNTOUCHED.
     *     2. 404 when id does not exist — no DROP fired.
     *     3. 400 when id path param is non-numeric — no DROP fired.
     *     4. 401 when no session cookie.
     *     5. idempotent — calling twice both return 200 (DROP IF EXISTS is silent).
     *   AUTH_MODE=oidc smoke block:
     *     6. happy path under OIDC — Bearer <access_token> on Kinetica fetch.
     *     7. 404 under OIDC — no DROP fired.
     *   Optional additional coverage:
     *     8. Upstream Kinetica 502 error propagates as 502 (errorMiddleware integration).
     */
    ```

    2. Implement the test bodies. Concrete scaffolding (executor: fill in any imports/helpers that diverge from the routes.dynamic-view.spec.ts preamble):

    ```typescript
    // ============================================================================
    //  POST /api/dynamic-view/:id/drop — AUTH_MODE=password
    // ============================================================================
    describe("POST /api/dynamic-view/:id/drop — AUTH_MODE=password", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "password");
        cleanFixtures();
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("happy path — returns 200 { dropped: true }, fires DROP TABLE IF EXISTS, row UNTOUCHED", async () => {
        const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { dashId, tableId } = seedFixture();
        const dv = seedDynamicView(dashId, tableId);
        const { cookie } = makeSessionCookie("alice");

        const res = await agent
          .post(`/api/dynamic-view/${dv.id}/drop`)
          .set("Cookie", cookie)
          .send();

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ dropped: true });

        // Assert exactly one Kinetica fetch fired — the DROP statement.
        const statements = sqlStatements(fetchMock);
        expect(statements).toHaveLength(1);
        expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);

        // CRITICAL row-untouched assertion: SQLite row still exists after drop.
        expect(getDashboardDynamicView(dv.id)).toBeDefined();
        expect(getDashboardDynamicView(dv.id)?.name).toBe(dv.name);
      });

      it("returns 404 when id does not exist — no DROP fired", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { cookie } = makeSessionCookie("alice");

        const res = await agent
          .post(`/api/dynamic-view/99999/drop`)
          .set("Cookie", cookie)
          .send();

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not found/i);
        expect(sqlStatements(fetchMock)).toHaveLength(0); // no Kinetica round-trip
      });

      it("returns 400 when :id path param is non-numeric", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { cookie } = makeSessionCookie("alice");

        const res = await agent
          .post(`/api/dynamic-view/abc/drop`)
          .set("Cookie", cookie)
          .send();

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/numeric/i);
        expect(sqlStatements(fetchMock)).toHaveLength(0);
      });

      it("returns 401 when no session cookie", async () => {
        const agent = await buildTestApp();
        const { dashId, tableId } = seedFixture();
        const dv = seedDynamicView(dashId, tableId);

        const res = await agent
          .post(`/api/dynamic-view/${dv.id}/drop`)
          .send();

        expect(res.status).toBe(401);
      });

      it("idempotent — calling drop twice both return 200 (DROP IF EXISTS is silent)", async () => {
        const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { dashId, tableId } = seedFixture();
        const dv = seedDynamicView(dashId, tableId);
        const { cookie } = makeSessionCookie("alice");

        const res1 = await agent.post(`/api/dynamic-view/${dv.id}/drop`).set("Cookie", cookie).send();
        const res2 = await agent.post(`/api/dynamic-view/${dv.id}/drop`).set("Cookie", cookie).send();

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        expect(sqlStatements(fetchMock)).toHaveLength(2); // two DROP statements
        expect(getDashboardDynamicView(dv.id)).toBeDefined(); // row still intact after both calls
      });
    });

    // ============================================================================
    //  POST /api/dynamic-view/:id/drop — AUTH_MODE=oidc smoke
    // ============================================================================
    describe("POST /api/dynamic-view/:id/drop — AUTH_MODE=oidc smoke", () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_MODE", "oidc");
        cleanFixtures();
        resetOidcClientForTests();
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("happy path under OIDC — Bearer <access_token> on Kinetica fetch", async () => {
        const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { dashId, tableId } = seedFixture();
        const dv = seedDynamicView(dashId, tableId);
        const { cookie, token } = seedOidcSession("john.doe@kinetica.com");

        const res = await agent
          .post(`/api/dynamic-view/${dv.id}/drop`)
          .set("Cookie", cookie)
          .send();

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ dropped: true });

        // Assert the Kinetica fetch was called with Bearer <token> (mirrors routes.dynamic-view.spec.ts oidc smoke).
        const kineticaCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/execute/sql"));
        expect(kineticaCalls).toHaveLength(1);
        const init = kineticaCalls[0][1] as RequestInit;
        const authHeader = (init.headers as Record<string, string>)["Authorization"] ?? "";
        expect(authHeader).toBe(`Bearer ${token}`);
      });

      it("returns 404 under OIDC when id does not exist — no DROP fired", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const agent = await buildTestApp();
        const { cookie } = seedOidcSession("john.doe@kinetica.com");

        const res = await agent
          .post(`/api/dynamic-view/99999/drop`)
          .set("Cookie", cookie)
          .send();

        expect(res.status).toBe(404);
        expect(sqlStatements(fetchMock)).toHaveLength(0);
      });
    });
    ```

    3. Run the spec. Iterate until all tests pass.

    4. Run the FULL server vitest suite to confirm no regressions on any pre-existing spec.

    5. NOTE: If `routes.dynamic-view.spec.ts` uses `describe.each` to consolidate password+oidc into a single describe block, mirror that pattern instead — but the current file (per the existing structure verified above) uses separate `describe` blocks per auth mode. Mirror what exists.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view-drop.spec.ts --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>
    Spec file exists. At least 7 tests covering the locked test list (5 password block + 2 oidc smoke). All passing. Full server vitest suite still green. tsc clean.
  </done>
  <acceptance_criteria>
    - `test -f kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts` exits 0.
    - `grep -nE '^describe\(' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 2 (password + oidc blocks).
    - `grep -nE 'AUTH_MODE.*password|AUTH_MODE.*oidc' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 2.
    - `grep -nE '\.post\(`/api/dynamic-view/\$\{.*\}/drop`\)|/api/dynamic-view/.*/drop' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 5 (5+ test calls hit the new endpoint).
    - `grep -nE 'DROP TABLE IF EXISTS _kbi_dv_' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 1 (statement-shape assertion).
    - `grep -nE 'getDashboardDynamicView.*toBeDefined|row.*intact|row.*UNTOUCHED|row.*still.*exist' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 1 (row-untouched assertion present).
    - `grep -nE 'dropped: true' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 2 (response-body assertions).
    - `grep -nE 'Bearer.*token|Bearer.*fake' kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts | wc -l` returns at least 1 (OIDC bearer header assertion).
    - `cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view-drop.spec.ts` exits 0 with at least 7 passing tests.
    - `cd kinetica_bi/server && npx vitest run` (full suite) exits 0 — no regression.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

</tasks>

<verification>
After both tasks complete:

```bash
cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view-drop.spec.ts tests/routes.dynamic-view.spec.ts --reporter=verbose 2>&1 | tail -40
cd kinetica_bi/server && npx vitest run --reporter=verbose 2>&1 | tail -20
cd kinetica_bi/server && npx tsc --noEmit
```

Expected: new spec adds ≥ 7 passing tests. Existing routes.dynamic-view.spec.ts still green (≥ 18 tests). Full server suite green. tsc clean.
</verification>

<success_criteria>
- New route `POST /api/dynamic-view/:id/drop` registered between materialize and DELETE handlers.
- KineticaOp union extended with `"DYNAMIC_DROP"` for audit-log granularity.
- Handler validates :id is numeric, returns 404 on missing row, fires `DROP TABLE IF EXISTS <dynamicViewName>` via `kineticaSqlHelper`, returns `200 { dropped: true }`.
- SQLite row UNTOUCHED — handler does NOT call `deleteDashboardDynamicView` (proven by spec assertion).
- Idempotent — drop+drop both return 200.
- Both auth modes covered (≥ 5 password tests + ≥ 2 oidc smoke tests).
- Full server vitest suite + tsc green.
</success_criteria>

<output>
After completion, create `.planning/phases/33-dynamic-view-store/33-02-SUMMARY.md` documenting:
- Final endpoint contract (request shape — empty body, response — `{ dropped: true }`, status codes).
- The `KineticaOp` extension (where in `kinetica.ts` the union was extended).
- Test counts (per describe block, total new, full-suite still-green count).
- Hand-off pointer for Plan 33-03: client.ts new helper `dropDynamicView(id, signal?)` POSTs to this endpoint; the reset() DROP loop in App.tsx + DashboardsPage.tsx is the only authorized caller.
</output>
