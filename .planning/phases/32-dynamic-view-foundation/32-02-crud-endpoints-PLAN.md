---
phase: 32-dynamic-view-foundation
plan: 02
type: execute
wave: 2
depends_on:
  - 32-dynamic-view-foundation-01
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts
autonomous: true
requirements:
  - DV-V16-01
must_haves:
  truths:
    - "Operator-authenticated user can list all dynamic views for a dashboard via `GET /api/dashboards/:dashboardId/dynamic-views`."
    - "Operator can create a new dynamic view via `POST /api/dashboards/:dashboardId/dynamic-views` and get back the persisted row."
    - "Operator can update an existing dynamic view via `PUT /api/dynamic-views/:id`."
    - "When `template_sql` is changed via PUT, `columns_json` is automatically cleared (forces re-Preview before re-Save)."
    - "Creating a dynamic view whose `template_sql` lacks `{view}` returns 400 with the MissingViewTokenError message — the validation runs against the supplied template at create-time."
    - "All three endpoints reject unauthenticated requests with 401 (requireConfig/requireAuth middleware applied)."
    - "All three endpoints work identically in `AUTH_MODE=password` and `AUTH_MODE=oidc`."
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "Three new Express routes for dynamic-view CRUD"
      contains: "/api/dashboards/:dashboardId/dynamic-views"
    - path: "kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts"
      provides: "Supertest coverage of list/create/update in both auth modes"
  key_links:
    - from: "kinetica_bi/server/src/index.ts new CRUD routes"
      to: "kinetica_bi/server/src/db.ts listDashboardDynamicViews / createDashboardDynamicView / updateDashboardDynamicView"
      via: "direct import + call"
      pattern: "createDashboardDynamicView\\(|updateDashboardDynamicView\\(|listDashboardDynamicViews\\("
    - from: "kinetica_bi/server/src/index.ts POST + PUT routes"
      to: "kinetica_bi/server/src/lib/dynamicViewSql.ts substituteViewToken"
      via: "validation — call substituteViewToken with a dummy view name at create/update time to detect MissingViewTokenError BEFORE persistence"
      pattern: "substituteViewToken\\(\\s*body\\.template_sql"
---

<objective>
Plan 02 adds the three pure-CRUD endpoints that Phase 34's management UI will bind against: list, create, update. No materialize logic here — that lives in Plan 03. Validation: confirm the supplied `template_sql` contains `{view}` at create + update time using Plan 01's `substituteViewToken` helper (it throws `MissingViewTokenError` on absence) so the database never accepts an unrunnable template. Update flow honors locked decision D3 — clearing `columns_json` whenever `template_sql` changes, which forces operators to Preview-then-Save again.

Purpose: Phase 34 needs a stable CRUD surface to drive the management modal. Splitting CRUD from preview/materialize/delete keeps the supertest spec for each side small and focused, and keeps Wave 2 parallel (Plan 02 + Plan 03 share no files except `index.ts` route additions — and they touch disjoint route paths).

Output: Three new Express routes registered on the existing app instance, plus a supertest spec exercising every happy path + failure case in both `AUTH_MODE=password` and `AUTH_MODE=oidc` blocks.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md
@.planning/phases/32-dynamic-view-foundation/32-01-db-schema-and-helpers-PLAN.md

<interfaces>
<!-- After Plan 01 lands, the following are importable. -->

From `kinetica_bi/server/src/db.ts` (added in Plan 01):
```typescript
export const listDashboardDynamicViews: (dashboardId: number) => DashboardDynamicView[];
export const getDashboardDynamicView: (id: number) => DashboardDynamicView | undefined;
export const createDashboardDynamicView: (
  dashboardId: number,
  input: { source_table_id: number; name: string; template_sql: string; max_records: number; columns_json?: { name: string; type: string }[] | null }
) => DashboardDynamicView;
export const updateDashboardDynamicView: (
  id: number,
  attrs: Partial<Pick<DashboardDynamicView, "name" | "template_sql" | "max_records" | "columns_json" | "source_table_id">>
) => DashboardDynamicView | undefined;
export const deleteDashboardDynamicView: (id: number) => boolean;
```

From `kinetica_bi/server/src/types.ts` (added in Plan 01):
```typescript
export type DashboardDynamicView = {
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  columns_json: { name: string; type: string }[] | null;
  created_at: string;
  updated_at: string;
};
```

From `kinetica_bi/server/src/lib/dynamicViewSql.ts` (added in Plan 01):
```typescript
export function substituteViewToken(template: string, viewName: string): string;
export class MissingViewTokenError extends Error;
```

From `kinetica_bi/server/src/index.ts` (existing — pattern for new routes to follow):
- All routes use `requireConfig` middleware (which itself wraps requireAuth + ensures Kinetica creds).
- All routes wrap async handlers in `asyncHandler(...)` so typed errors bubble to `errorMiddleware`.
- Body parsing via `req.body` (express.json applied globally).

From `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` lines 1-132 (existing PATTERN — supertest harness shape with both auth modes):
- Top-of-file hoisted `vi.mock("openid-client", ...)` is required for AUTH_MODE=oidc boot.
- `buildTestApp()` from `tests/helpers/app` returns a supertest agent.
- `makeSessionCookie("alice")` builds password-mode session.
- `seedOidcSession("john.doe@kinetica.com")` builds OIDC-mode session.
- `cleanFixtures()` resets `sessions`, `dashboard_table_views`, `dashboard_tables`, `tables`, `dashboards`. NEW: this spec must also clear `dashboard_dynamic_views`.

Test seed fixture pattern (existing):
```typescript
const seedFixture = (tableName = "events", schema = "ki_home") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  return { dashId: dash.id, tableId: tbl.id, schema, tableName };
};
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add `GET / POST /api/dashboards/:dashboardId/dynamic-views` and `PUT /api/dynamic-views/:id` routes</name>
  <files>kinetica_bi/server/src/index.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts lines 1-100 (imports section + module preamble) AND lines 685-832 (existing `POST /api/filter/materialize` + `DELETE /api/filter/materialize` for the route-registration idiom, requireConfig + asyncHandler usage)
    - kinetica_bi/server/src/db.ts (the new exports added in Plan 01: `listDashboardDynamicViews`, `createDashboardDynamicView`, `getDashboardDynamicView`, `updateDashboardDynamicView`)
    - kinetica_bi/server/src/lib/dynamicViewSql.ts (substituteViewToken + MissingViewTokenError signature for validation)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md § "CRUD (round-out)" section + § D3 (columns_json cleared on template_sql change)
  </read_first>
  <action>
    1. Add these named imports at the top of `kinetica_bi/server/src/index.ts` (near the existing db imports — find the `import { ... } from "./db";` block):

    ```typescript
    import {
      listDashboardDynamicViews,
      createDashboardDynamicView,
      getDashboardDynamicView,
      updateDashboardDynamicView,
      // NOTE: deleteDashboardDynamicView is imported by Plan 03's DELETE route — DO NOT add it here.
    } from "./db";
    import { substituteViewToken, MissingViewTokenError } from "./lib/dynamicViewSql";
    ```

    2. Append the three new routes to the route-registration block in `createApp(...)`. Place them AFTER `DELETE /api/filter/materialize` (line ~831) and BEFORE the `POST /api/info/query` block (line ~870). Routes:

    ```typescript
    // ----- v1.6 Phase 32 Plan 02: Dynamic Views CRUD (DV-V16-01) -----
    // CONTEXT.md § "CRUD (round-out)": list / create / update only.
    // Preview / materialize / delete live in Plan 03 (separate route surface).
    //
    // Validation pattern: at create + update time, call substituteViewToken with
    // a dummy view name to detect MissingViewTokenError BEFORE persistence.
    // This guarantees the DB never holds a template that materialize cannot run.
    // CONTEXT.md § D1: "{view} absent → 400, configuration error not runtime degrade".

    app.get(
      "/api/dashboards/:dashboardId/dynamic-views",
      requireConfig,
      asyncHandler(async (req, res) => {
        const dashboardId = Number(req.params.dashboardId);
        if (!Number.isFinite(dashboardId)) {
          return res.status(400).json({ error: "dashboardId path param must be numeric." });
        }
        const rows = listDashboardDynamicViews(dashboardId);
        return res.json({ dynamic_views: rows });
      })
    );

    app.post(
      "/api/dashboards/:dashboardId/dynamic-views",
      requireConfig,
      asyncHandler(async (req, res) => {
        const dashboardId = Number(req.params.dashboardId);
        if (!Number.isFinite(dashboardId)) {
          return res.status(400).json({ error: "dashboardId path param must be numeric." });
        }
        const body = (req.body ?? {}) as {
          source_table_id?: number;
          name?: string;
          template_sql?: string;
          max_records?: number;
        };
        // Field validation (all four are required at create time; columns_json is server-managed).
        if (typeof body.source_table_id !== "number") {
          return res.status(400).json({ error: "source_table_id is required and must be a number." });
        }
        if (typeof body.name !== "string" || body.name.trim() === "") {
          return res.status(400).json({ error: "name is required and must be a non-empty string." });
        }
        if (typeof body.template_sql !== "string" || body.template_sql.trim() === "") {
          return res.status(400).json({ error: "template_sql is required and must be a non-empty string." });
        }
        if (typeof body.max_records !== "number" || body.max_records < 1) {
          return res.status(400).json({ error: "max_records is required and must be a positive number." });
        }
        // CONTEXT.md § D1: template must contain {view} token. substituteViewToken throws on absence.
        try {
          substituteViewToken(body.template_sql, "_dummy_validation_view_name_");
        } catch (err) {
          if (err instanceof MissingViewTokenError) {
            return res.status(400).json({ error: err.message });
          }
          throw err;
        }
        const row = createDashboardDynamicView(dashboardId, {
          source_table_id: body.source_table_id,
          name: body.name,
          template_sql: body.template_sql,
          max_records: body.max_records,
          columns_json: null, // CONTEXT.md § D3: populated only after successful Preview-then-Save.
        });
        return res.status(201).json({ dynamic_view: row });
      })
    );

    app.put(
      "/api/dynamic-views/:id",
      requireConfig,
      asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ error: "id path param must be numeric." });
        }
        const existing = getDashboardDynamicView(id);
        if (!existing) {
          return res.status(404).json({ error: "Dynamic view not found." });
        }
        const body = (req.body ?? {}) as {
          source_table_id?: number;
          name?: string;
          template_sql?: string;
          max_records?: number;
          columns_json?: { name: string; type: string }[] | null;
        };
        // If template_sql is being updated, validate the new SQL contains {view}.
        if (typeof body.template_sql === "string") {
          if (body.template_sql.trim() === "") {
            return res.status(400).json({ error: "template_sql must be a non-empty string when provided." });
          }
          try {
            substituteViewToken(body.template_sql, "_dummy_validation_view_name_");
          } catch (err) {
            if (err instanceof MissingViewTokenError) {
              return res.status(400).json({ error: err.message });
            }
            throw err;
          }
        }
        // CONTEXT.md § D3: when template_sql changes, columns_json MUST be cleared.
        // Operator must run Preview again before the next Save populates columns_json afresh.
        // If the caller explicitly supplies columns_json in the same request body, the caller's
        // value wins (this is the Plan 34 flow: Preview returns new columns, UI sends template_sql +
        // columns_json together on Save). If the caller omits columns_json but updates template_sql,
        // we clear it.
        let columnsJsonAttr: { name: string; type: string }[] | null | undefined;
        if ("columns_json" in body) {
          columnsJsonAttr = body.columns_json ?? null;
        } else if (
          typeof body.template_sql === "string" &&
          body.template_sql !== existing.template_sql
        ) {
          columnsJsonAttr = null;
        } else {
          columnsJsonAttr = undefined; // omit — preserve existing
        }
        const attrs: Partial<{
          source_table_id: number;
          name: string;
          template_sql: string;
          max_records: number;
          columns_json: { name: string; type: string }[] | null;
        }> = {};
        if (typeof body.source_table_id === "number") attrs.source_table_id = body.source_table_id;
        if (typeof body.name === "string") attrs.name = body.name;
        if (typeof body.template_sql === "string") attrs.template_sql = body.template_sql;
        if (typeof body.max_records === "number") attrs.max_records = body.max_records;
        if (columnsJsonAttr !== undefined) attrs.columns_json = columnsJsonAttr;

        const updated = updateDashboardDynamicView(id, attrs);
        return res.json({ dynamic_view: updated });
      })
    );
    ```

    DO NOT modify any other route. Plan 03 will add the preview / materialize / delete routes in the same range; they touch disjoint paths so the two plans can land in any order within Wave 2.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <done>
    Three new routes are registered on the Express app. `tsc --noEmit` exits 0. No existing route handler is modified. The validation uses `substituteViewToken` + `MissingViewTokenError` from Plan 01.
  </done>
  <acceptance_criteria>
    - `grep -nE 'app\\.get\\(\\s*"/api/dashboards/:dashboardId/dynamic-views"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'app\\.post\\(\\s*"/api/dashboards/:dashboardId/dynamic-views"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'app\\.put\\(\\s*"/api/dynamic-views/:id"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -n 'substituteViewToken(body.template_sql' kinetica_bi/server/src/index.ts` returns at least 2 lines (once in POST, once in PUT).
    - `grep -n 'MissingViewTokenError' kinetica_bi/server/src/index.ts` returns at least 2 lines (used in both POST and PUT validation).
    - `grep -nE 'listDashboardDynamicViews|createDashboardDynamicView|getDashboardDynamicView|updateDashboardDynamicView' kinetica_bi/server/src/index.ts | wc -l` returns at least 4 lines (one per import + usage).
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` still exits 0 (no regression on existing routes).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Supertest coverage of all 3 CRUD endpoints in AUTH_MODE=password + AUTH_MODE=oidc</name>
  <files>kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts (read in full — this is the PATTERN TO MIRROR for the dual-auth-mode harness: hoisted openid-client mock, buildTestApp, makeSessionCookie, seedOidcSession, cleanFixtures, describe blocks per auth mode + per route)
    - kinetica_bi/server/tests/helpers/app.ts (read in full — buildTestApp signature + DB seed reset behavior)
    - kinetica_bi/server/src/index.ts (the 3 new routes — read the route bodies you just wrote so the spec asserts the exact response shapes you emit)
    - kinetica_bi/server/src/db.ts (the new createDashboardDynamicView + listDashboardDynamicViews helpers for direct seeding in the GET tests)
  </read_first>
  <action>
    1. Create `kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts`. Structure: copy lines 1-132 of `routes.filter-materialize.spec.ts` (the hoisted mock + helpers preamble) verbatim, then write FOUR describe blocks:

       - `describe("GET /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password")`
       - `describe("POST /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password")`
       - `describe("PUT /api/dynamic-views/:id — AUTH_MODE=password")`
       - `describe("Dynamic-view CRUD — AUTH_MODE=oidc smoke")`

       NOTE: extend `cleanFixtures` to also wipe `dashboard_dynamic_views`:
       ```typescript
       const cleanFixtures = () => {
         db.exec("DELETE FROM sessions");
         db.exec("DELETE FROM dashboard_dynamic_views");
         db.exec("DELETE FROM dashboard_table_views");
         db.exec("DELETE FROM dashboard_tables");
         db.exec("DELETE FROM tables");
         db.exec("DELETE FROM dashboards");
       };
       ```

    2. Implement at least these tests:

       **GET (password):**
       - `it("returns 200 with empty array when no dynamic views exist for dashboard")` → response body `{ dynamic_views: [] }`.
       - `it("returns 200 with all dynamic views for the dashboard, ordered by id ASC")` — seed 2 rows directly via `createDashboardDynamicView`, assert response array length 2 and `dynamic_views[0].id < dynamic_views[1].id`.
       - `it("returns 400 when dashboardId path param is non-numeric")` — request `/api/dashboards/abc/dynamic-views`, expect 400.
       - `it("returns 401 with no session cookie (requireConfig enforces requireAuth)")`.

       **POST (password):**
       - `it("returns 201 with the persisted row when all fields are valid")` — send `{ source_table_id, name: "Top vendors by fare", template_sql: "SELECT vendor, AVG(fare) FROM {view} GROUP BY vendor", max_records: 1000 }`; assert response body `dynamic_view` has the supplied fields + auto-assigned id + `columns_json: null` + ISO timestamp fields.
       - `it("returns 400 when template_sql lacks {view} token")` — send `template_sql: "SELECT * FROM raw_events"`; assert response status 400 + body.error contains the string `{view}`.
       - `it("returns 400 when source_table_id is missing")`.
       - `it("returns 400 when name is empty string")`.
       - `it("returns 400 when max_records is 0 or negative")`.
       - `it("returns 400 when template_sql is a whitespace-only string")`.
       - `it("returns 400 when dashboardId path param is non-numeric")`.
       - `it("accepts case-insensitive + whitespace-tolerant variants of {view}")` — three subtests: `{VIEW}`, `{ view }`, `{View}` all return 201.
       - `it("returns 401 with no session cookie")`.

       **PUT (password):**
       - `it("returns 200 with the updated row when partial fields are supplied")` — create a row directly, PUT `{ name: "New name" }`, assert only `name` changed + `updated_at` advances.
       - `it("clears columns_json automatically when template_sql changes and caller omits columns_json")` — create a row with `columns_json: [{ name: 'foo', type: 'TEXT' }]` (directly via createDashboardDynamicView), PUT `{ template_sql: "SELECT a, b FROM {view}" }` (different from original), assert response `dynamic_view.columns_json === null`.
       - `it("preserves columns_json when template_sql is unchanged and caller omits columns_json")`.
       - `it("honors caller-supplied columns_json verbatim (UI Preview-then-Save flow)")` — PUT `{ template_sql: "SELECT * FROM {view}", columns_json: [{ name: 'x', type: 'INT' }] }`, assert response columns_json matches.
       - `it("returns 400 when template_sql is updated to a value lacking {view}")`.
       - `it("returns 404 when id does not exist")`.
       - `it("returns 401 with no session cookie")`.

       **OIDC smoke (one critical case per route):**
       - `it("GET works under AUTH_MODE=oidc with credential_type=oidc session")` — `vi.stubEnv("AUTH_MODE", "oidc")`, `seedOidcSession("john.doe@kinetica.com")`, assert 200.
       - `it("POST works under AUTH_MODE=oidc")` — same seed, send a valid create body, assert 201.
       - `it("PUT works under AUTH_MODE=oidc")` — direct DB-create + PUT, assert 200.

    3. Use the same `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(successKineticaBody), { status: 200 })))` pattern as the existing spec — even though these CRUD endpoints do NOT hit Kinetica, `requireConfig` may probe the session, and `successKineticaBody` is harmless to stub. (If buildTestApp does not require it, omit; mirror the existing spec.)

    4. Run the spec; iterate until green. Test count must be ≥ 19 (4 + 9 + 6 + 3, allowing for minor expansion).
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view-crud.spec.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    Spec exits 0. Every CRUD route + every validation branch covered. Both auth modes exercised. At least 19 passing tests.
  </done>
  <acceptance_criteria>
    - `grep -nE '^describe\\(' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts | wc -l` returns at least 4.
    - `grep -nE 'AUTH_MODE.*password' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts` returns at least 1 line.
    - `grep -nE 'AUTH_MODE.*oidc' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts` returns at least 1 line.
    - `grep -nE 'DELETE FROM dashboard_dynamic_views' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts` returns exactly 1 line (cleanFixtures extended).
    - `grep -nE '\\{view\\}|\\{VIEW\\}|\\{ view \\}' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts | wc -l` returns at least 3 lines (case + whitespace variants tested).
    - `grep -nE 'columns_json' kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts | wc -l` returns at least 4 lines (clear-on-template-change tested, caller-supplied tested, preserve-when-unchanged tested).
    - `cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view-crud.spec.ts` exits 0 with ≥ 19 passing tests.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts tests/routes.filter-materialize-spatial.spec.ts` exits 0 (no regression on pre-existing supertest specs in the same file family).
  </acceptance_criteria>
</task>

</tasks>

<verification>
After all 2 tasks complete:

```bash
cd kinetica_bi/server && npx vitest run --reporter=verbose 2>&1 | tail -30
cd kinetica_bi/server && npx tsc --noEmit
```

Expected: all pre-Plan-02 specs stay green; new `routes.dynamic-view-crud.spec.ts` adds ≥ 19 tests, all green. No type errors.
</verification>

<success_criteria>
- Three new routes registered: `GET /api/dashboards/:dashboardId/dynamic-views`, `POST /api/dashboards/:dashboardId/dynamic-views`, `PUT /api/dynamic-views/:id`.
- Create + Update both validate `{view}` presence via `substituteViewToken`; missing token → 400.
- Update clears `columns_json` automatically when `template_sql` changes and caller omits the field.
- All three routes return 401 without a session (requireConfig enforces requireAuth).
- All three routes work in both `AUTH_MODE=password` and `AUTH_MODE=oidc`.
- `npx tsc --noEmit` clean.
</success_criteria>

<output>
After completion, create `.planning/phases/32-dynamic-view-foundation/32-02-SUMMARY.md` documenting:
- Final route paths + response shapes.
- Test counts (per describe block + total new + grand-total still-green).
- Decisions made under Claude's discretion (e.g., the `_dummy_validation_view_name_` placeholder string used to detect MissingViewTokenError at create/update time).
- Hand-off pointers for Phase 33's client.ts (the JSON request/response shapes).
</output>