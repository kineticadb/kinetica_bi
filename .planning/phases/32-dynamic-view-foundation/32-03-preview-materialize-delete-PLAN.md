---
phase: 32-dynamic-view-foundation
plan: 03
type: execute
wave: 2
depends_on:
  - 32-dynamic-view-foundation-01
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/routes.dynamic-view.spec.ts
autonomous: true
requirements:
  - DV-V16-03
  - DV-V16-04
  - DV-V16-05
must_haves:
  truths:
    - "`POST /api/dynamic-view/preview` runs `SELECT * FROM (<substituted_sql>) LIMIT N` against Kinetica and returns rows + column metadata WITHOUT creating a permanent view."
    - "`POST /api/dynamic-view/preview` falls back to the bare source-table reference when no active filter view exists (so operators can develop SQL without applying a filter first)."
    - "`POST /api/dynamic-view/preview` returns 400 when `template_sql` lacks `{view}` (MissingViewTokenError)."
    - "`POST /api/dynamic-view/materialize` first looks up the current filter view; if absent → drops any existing dynamic view + returns `{ status: \"over_threshold\", reason: \"no_filter\" }` (CONTEXT.md § D2)."
    - "`POST /api/dynamic-view/materialize` runs `SELECT COUNT(*) FROM <filter_view>` and: count ≥ max_records → drops the dynamic view + returns `{ status: \"over_threshold\", reason: \"exceeds_max_records\", row_count: N }`."
    - "`POST /api/dynamic-view/materialize` below threshold runs `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = 5)` via the shared `createOrReplaceMaterialized` helper (Plan 01) — TTL=5 matches v1.3 filter views (CONTEXT.md § D6)."
    - "`POST /api/dynamic-view/materialize` recovers from TM/SMc:1078 (proven by the helper's own unit spec from Plan 01; supertest spec asserts the route still returns 200 in that race-recovery scenario)."
    - "`DELETE /api/dynamic-view/:id` drops the Kinetica materialized view AND deletes the SQLite row; returns 404 when the id does not exist (so the UI can distinguish missing-row from server error)."
    - "All three endpoints reject unauthenticated requests with 401 and work in both `AUTH_MODE=password` and `AUTH_MODE=oidc`."
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "Three new Express routes: preview, materialize, delete"
      contains: "/api/dynamic-view/preview, /api/dynamic-view/materialize, /api/dynamic-view/:id"
    - path: "kinetica_bi/server/tests/routes.dynamic-view.spec.ts"
      provides: "Supertest coverage of preview + materialize + delete in both auth modes (≥ 18 tests)"
  key_links:
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/materialize"
      to: "kinetica_bi/server/src/lib/materializedView.ts createOrReplaceMaterialized"
      via: "below-threshold path calls createOrReplaceMaterialized({ req, view, sqlBody, ttl: 5, route, op })"
      pattern: "createOrReplaceMaterialized\\(\\{"
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/materialize"
      to: "kinetica_bi/server/src/lib/dynamicViewName.ts buildDynamicViewName"
      via: "compute the target Kinetica view name from { userId, dashboardId, dynamicViewId }"
      pattern: "buildDynamicViewName\\(\\{"
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/materialize"
      to: "kinetica_bi/server/src/lib/viewNaming.ts buildFilterViewName"
      via: "look up the current source filter-view name to substitute into {view}"
      pattern: "buildFilterViewName\\(\\{"
    - from: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/preview + materialize"
      to: "kinetica_bi/server/src/lib/dynamicViewSql.ts substituteViewToken"
      via: "substitute the {view} token into the operator's template_sql before execution"
      pattern: "substituteViewToken\\("
---

<objective>
Plan 03 lands the three "runtime" endpoints — Preview (one-shot ad-hoc query), Materialize (threshold-gated CREATE OR REPLACE), Delete (drop + row removal). Every locked decision from CONTEXT.md (D1 token, D2 no-filter, D5 retry, D6 TTL=5, D7 naming) lands here, composing all three Plan 01 helpers (`substituteViewToken`, `buildDynamicViewName`, `createOrReplaceMaterialized`) and the existing `buildFilterViewName`.

Purpose: This is the meat of Phase 32 — what Phase 35's renderers will trigger when filter-view version bumps. Splitting this from Plan 02 keeps the supertest spec focused on Kinetica fetch mocks (Plan 03) versus pure DB-roundtrip tests (Plan 02), which means Wave 2 has two independent ~50%-context plans.

Output: Three Express routes registered on the existing app, plus a supertest spec covering all happy paths + 400/404/501 cases + the TM/SMc:1078 retry + no-filter / over-threshold short-circuits, all in both auth modes.
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

From `kinetica_bi/server/src/lib/dynamicViewSql.ts`:
```typescript
export function substituteViewToken(template: string, viewName: string): string;
export class MissingViewTokenError extends Error;
```

From `kinetica_bi/server/src/lib/dynamicViewName.ts`:
```typescript
export type DynamicViewNameArgs = { userId: string; dashboardId: number; dynamicViewId: number };
export function buildDynamicViewName(args: DynamicViewNameArgs): string;
// Shape: _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
```

From `kinetica_bi/server/src/lib/materializedView.ts`:
```typescript
export type CreateOrReplaceMaterializedArgs = {
  req: AuthedRequest;
  view: string;
  sqlBody: string;  // SELECT clause WITHOUT outer parens; helper wraps it
  ttl: number;
  route: string;
  op: string;
};
export async function createOrReplaceMaterialized(args: CreateOrReplaceMaterializedArgs): Promise<void>;
```

From `kinetica_bi/server/src/lib/viewNaming.ts` (existing):
```typescript
export function buildFilterViewName(args: { username, sessionId, dashboardId, tableId }): string;
```

From `kinetica_bi/server/src/db.ts` (existing + Plan 01 additions):
```typescript
export const getDashboardDynamicView: (id: number) => DashboardDynamicView | undefined;
export const deleteDashboardDynamicView: (id: number) => boolean;
export const getTable: (id: number) => Table | undefined;
// CONTEXT.md § D2 implementation hook: "look up current source filter-view from dashboard_table_views"
// — read existing table to find pattern:
export const listViewsForTable: (dashboardId: number, tableId: number) => DashboardTableView[];
```

Existing `POST /api/filter/materialize` pattern from `kinetica_bi/server/src/index.ts` (after Plan 01 refactor — lines ~685-807):
- `authedReq.user!.creds.username` → for buildFilterViewName + buildDynamicViewName userId field
- `authedReq.user!.sid` → for buildFilterViewName sessionId field
- `kineticaSqlHelper(authedReq, sql, { route, op })` → for ad-hoc SQL (preview + count + drop)

Kinetica response decoding pattern (from `POST /api/info/query` lines ~870+ — read those when implementing preview):
- Response body shape from `kineticaSql`: `{ status, message, data_type, data_str: <JSON-encoded> }`
- `data_str` JSON-decodes to `{ json_encoded_response: <JSON-encoded again> }`
- That inner string JSON-decodes to `{ column_headers: string[], column_datatypes: string[], rows: ... }` or similar — confirm exact shape by reading kinetica.ts / info-query handler before coding the preview response decoder.

CONTEXT.md endpoint contracts (re-pasted here for executor convenience):

POST /api/dynamic-view/preview request:
```json
{ "template_sql": "...", "source_table_id": 4, "dashboard_id": 1, "sample_limit": 100 }
```
Response: `{ rows: any[][], columns: { name: string, type: string }[] }`

POST /api/dynamic-view/materialize request:
```json
{ "dynamic_view_id": 7 }
```
Response (below threshold): `{ status: "materialized", view_name, row_count, expires_at }`
Response (no filter): `{ status: "over_threshold", reason: "no_filter" }`
Response (above threshold): `{ status: "over_threshold", reason: "exceeds_max_records", row_count }`

DELETE /api/dynamic-view/:id response: `{ deleted: true, dropped: true }` (200) OR `{ error: "..." }` (404).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add `POST /api/dynamic-view/preview` + `POST /api/dynamic-view/materialize` + `DELETE /api/dynamic-view/:id` routes</name>
  <files>kinetica_bi/server/src/index.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (read in full — focus on the imports section, the `POST /api/filter/materialize` handler at lines ~685-807 for the materialize-with-retry-helper pattern AFTER Plan 01 refactor, and `POST /api/info/query` at lines ~870+ for the Kinetica response-decoding idiom used by Preview)
    - kinetica_bi/server/src/kinetica.ts (read in full — `kineticaSql` return shape; how `data_str` decodes)
    - kinetica_bi/server/src/db.ts (the new helpers from Plan 01 plus existing `getTable`, `listViewsForTable`, `getDashboardDynamicView`)
    - kinetica_bi/server/src/lib/dynamicViewSql.ts + dynamicViewName.ts + materializedView.ts (the 3 Plan 01 helpers — confirm exact signatures)
    - kinetica_bi/server/src/lib/viewNaming.ts (`buildFilterViewName` signature)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md (all 7 locked decisions + the Endpoints section)
  </read_first>
  <action>
    1. Extend the top-of-file imports in `kinetica_bi/server/src/index.ts`:

    ```typescript
    // Add to existing db import (next to listDashboardDynamicViews from Plan 02):
    import {
      getDashboardDynamicView,
      deleteDashboardDynamicView,
      listViewsForTable, // existing — used for D2 no-filter lookup
      // ...other Plan 02 imports already added
    } from "./db";

    // New imports from Plan 01 helpers:
    import { buildDynamicViewName } from "./lib/dynamicViewName";
    import { createOrReplaceMaterialized } from "./lib/materializedView";
    // substituteViewToken + MissingViewTokenError already imported by Plan 02.
    ```

    (If Plan 02 has not added `substituteViewToken` import yet because the two plans run in parallel, this plan adds it. The executor should grep first; if already present, skip the duplicate.)

    2. Append the three new routes. Place them AFTER the Plan 02 CRUD block (after `PUT /api/dynamic-views/:id`) and BEFORE the `POST /api/info/query` block. Routes:

    ```typescript
    // ----- v1.6 Phase 32 Plan 03: Dynamic Views runtime endpoints -----
    // DV-V16-03 preview, DV-V16-04 materialize, DV-V16-05 delete.
    //
    // CONTEXT.md locked decisions wired here:
    //   - D1: substituteViewToken (case-insensitive, whitespace-tolerant, throws on absence)
    //   - D2: no filter view → return over_threshold + drop dynamic view
    //   - D5: TM/SMc:1078 retry — delegated to createOrReplaceMaterialized helper
    //   - D6: TTL=5 minutes on materialized dynamic view
    //   - D7: buildDynamicViewName produces `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>`

    // POST /api/dynamic-view/preview — one-shot read; does NOT create a permanent view.
    app.post(
      "/api/dynamic-view/preview",
      requireConfig,
      asyncHandler(async (req, res) => {
        const body = (req.body ?? {}) as {
          template_sql?: string;
          source_table_id?: number;
          dashboard_id?: number;
          sample_limit?: number;
        };
        if (typeof body.template_sql !== "string" || body.template_sql.trim() === "") {
          return res.status(400).json({ error: "template_sql is required and must be a non-empty string." });
        }
        if (typeof body.source_table_id !== "number") {
          return res.status(400).json({ error: "source_table_id is required and must be a number." });
        }
        if (typeof body.dashboard_id !== "number") {
          return res.status(400).json({ error: "dashboard_id is required and must be a number." });
        }
        const sampleLimit = typeof body.sample_limit === "number" && body.sample_limit > 0
          ? Math.min(body.sample_limit, 1000)
          : 100;

        const table = getTable(body.source_table_id);
        if (!table) {
          return res.status(404).json({ error: "Source table not found." });
        }
        const sourceTableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

        // CONTEXT.md § Preview: fall back to bare source-table when no active filter view exists.
        // This lets operators develop SQL without applying a filter first; the filter-aware
        // behavior kicks in once they're satisfied + Save + Materialize.
        const authedReq = req as AuthedRequest;
        const filterViews = listViewsForTable(body.dashboard_id, body.source_table_id);
        const expectedFilterViewName = buildFilterViewName({
          username: authedReq.user!.creds.username,
          sessionId: authedReq.user!.sid,
          dashboardId: body.dashboard_id,
          tableId: body.source_table_id,
        });
        // Look for a row whose view_name matches the per-user/session expected name and status === "ready".
        const activeFilterView = filterViews.find(
          (v) => v.view_name === expectedFilterViewName && v.status === "ready",
        );
        const sourceForSubstitution = activeFilterView ? activeFilterView.view_name : sourceTableRef;

        // CONTEXT.md § D1: substituteViewToken throws MissingViewTokenError if {view} is absent.
        let substituted: string;
        try {
          substituted = substituteViewToken(body.template_sql, sourceForSubstitution);
        } catch (err) {
          if (err instanceof MissingViewTokenError) {
            return res.status(400).json({ error: err.message });
          }
          throw err;
        }

        const previewSql = `SELECT * FROM (${substituted}) LIMIT ${sampleLimit}`;
        const result = (await kineticaSqlHelper(authedReq, previewSql, {
          route: "POST /api/dynamic-view/preview",
          op: "DYNAMIC_PREVIEW",
        })) as { column_headers?: string[]; column_datatypes?: string[]; rows?: unknown[][] } & Record<string, unknown>;

        // Decode rows + column metadata from kineticaSql response. Mirror the unpack
        // pattern used by POST /api/info/query (see index.ts ~line 980+). The exact
        // shape is owned by kinetica.ts unwrap — if kineticaSql returns a flat object
        // with column_headers + column_datatypes + rows arrays (data records format),
        // emit them as-is. If it returns the {column_names, column_types, data_rows}
        // shape, adapt accordingly. Re-read kinetica.ts to confirm.
        const columnNames: string[] = Array.isArray(result.column_headers) ? result.column_headers : [];
        const columnTypes: string[] = Array.isArray(result.column_datatypes) ? result.column_datatypes : [];
        const rows: unknown[][] = Array.isArray(result.rows) ? result.rows : [];
        const columns = columnNames.map((name, i) => ({ name, type: columnTypes[i] ?? "unknown" }));

        return res.json({ rows, columns });
      })
    );

    // POST /api/dynamic-view/materialize — threshold-gated CREATE OR REPLACE.
    app.post(
      "/api/dynamic-view/materialize",
      requireConfig,
      asyncHandler(async (req, res) => {
        const body = (req.body ?? {}) as { dynamic_view_id?: number };
        if (typeof body.dynamic_view_id !== "number") {
          return res.status(400).json({ error: "dynamic_view_id is required and must be a number." });
        }
        const row = getDashboardDynamicView(body.dynamic_view_id);
        if (!row) {
          return res.status(404).json({ error: "Dynamic view not found." });
        }
        const table = getTable(row.source_table_id);
        if (!table) {
          return res.status(404).json({ error: "Source table not found." });
        }
        const authedReq = req as AuthedRequest;
        const dynamicViewName = buildDynamicViewName({
          userId: authedReq.user!.creds.username,
          dashboardId: row.dashboard_id,
          dynamicViewId: row.id,
        });

        // CONTEXT.md § D2: look up current source filter-view. If absent → over_threshold.
        const expectedFilterViewName = buildFilterViewName({
          username: authedReq.user!.creds.username,
          sessionId: authedReq.user!.sid,
          dashboardId: row.dashboard_id,
          tableId: row.source_table_id,
        });
        const filterViews = listViewsForTable(row.dashboard_id, row.source_table_id);
        const activeFilterView = filterViews.find(
          (v) => v.view_name === expectedFilterViewName && v.status === "ready",
        );
        if (!activeFilterView) {
          // Drop any stale dynamic view (idempotent — DROP IF EXISTS).
          await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
            route: "POST /api/dynamic-view/materialize",
            op: "DYNAMIC_MATERIALIZE",
          });
          return res.json({ status: "over_threshold", reason: "no_filter" });
        }

        // CONTEXT.md § DV-V16-04: row-count check against the filter view.
        const countSql = `SELECT COUNT(*) AS c FROM ${activeFilterView.view_name}`;
        const countResult = (await kineticaSqlHelper(authedReq, countSql, {
          route: "POST /api/dynamic-view/materialize",
          op: "DYNAMIC_COUNT",
        })) as { rows?: unknown[][]; column_headers?: string[] } & Record<string, unknown>;
        // Defensive: kineticaSql may surface the count as a single-row, single-cell array.
        // Re-read info-query handler decoding for the precise shape; pattern below assumes
        // result.rows = [[N]] (the canonical shape used by other count queries in this codebase).
        const firstRow = Array.isArray(countResult.rows) ? countResult.rows[0] : undefined;
        const countCell = Array.isArray(firstRow) ? firstRow[0] : undefined;
        const rowCount =
          typeof countCell === "number"
            ? countCell
            : typeof countCell === "string"
              ? Number(countCell)
              : 0;

        if (rowCount >= row.max_records) {
          await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
            route: "POST /api/dynamic-view/materialize",
            op: "DYNAMIC_MATERIALIZE",
          });
          return res.json({ status: "over_threshold", reason: "exceeds_max_records", row_count: rowCount });
        }

        // Below threshold: substitute, then CREATE OR REPLACE via the shared helper (TM/SMc:1078 retry).
        let substituted: string;
        try {
          substituted = substituteViewToken(row.template_sql, activeFilterView.view_name);
        } catch (err) {
          if (err instanceof MissingViewTokenError) {
            // This should be impossible because Plan 02 validates {view} at create + update time,
            // but guard anyway — DB rows may be edited out-of-band.
            return res.status(400).json({ error: err.message });
          }
          throw err;
        }

        await createOrReplaceMaterialized({
          req: authedReq,
          view: dynamicViewName,
          sqlBody: substituted,
          ttl: 5,
          route: "POST /api/dynamic-view/materialize",
          op: "DYNAMIC_MATERIALIZE",
        });

        const expiresAt = Date.now() + 5 * 60 * 1000;
        return res.json({
          status: "materialized",
          view_name: dynamicViewName,
          row_count: rowCount,
          expires_at: expiresAt,
        });
      })
    );

    // DELETE /api/dynamic-view/:id — drop materialized view + delete row.
    app.delete(
      "/api/dynamic-view/:id",
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
        // DROP first (best-effort — DROP IF EXISTS is idempotent); then delete row.
        // If DROP fails for non-existence reasons, error bubbles to errorMiddleware and the
        // row is NOT deleted. This is intentional: caller can retry. Idempotent on the happy path.
        await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
          route: "DELETE /api/dynamic-view/:id",
          op: "DYNAMIC_MATERIALIZE",
        });
        const deleted = deleteDashboardDynamicView(id);
        return res.json({ deleted, dropped: true });
      })
    );
    ```

    3. After writing, run `npx tsc --noEmit` from `kinetica_bi/server/` and fix any signature drift (e.g., if `kineticaSql` unwrapped response shape differs from `column_headers`/`rows`, adapt the decoder using `info-query` handler as the reference).

    DO NOT modify Plan 02's CRUD routes or any pre-existing route.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <done>
    Three new routes registered. `tsc --noEmit` clean. All four Plan 01 helpers (`substituteViewToken`, `buildDynamicViewName`, `createOrReplaceMaterialized`, plus existing `buildFilterViewName`) are wired into the materialize route. No existing handlers modified.
  </done>
  <acceptance_criteria>
    - `grep -nE 'app\\.post\\(\\s*"/api/dynamic-view/preview"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'app\\.post\\(\\s*"/api/dynamic-view/materialize"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'app\\.delete\\(\\s*"/api/dynamic-view/:id"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -n 'createOrReplaceMaterialized({' kinetica_bi/server/src/index.ts | wc -l` returns at least 2 (filter-materialize route from Plan 01 + new dynamic-view-materialize route).
    - `grep -n 'buildDynamicViewName(' kinetica_bi/server/src/index.ts | wc -l` returns at least 2 (used in materialize + delete routes).
    - `grep -nE 'reason: "no_filter"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'reason: "exceeds_max_records"' kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -nE 'ttl: 5,' kinetica_bi/server/src/index.ts | wc -l` returns at least 1 line (CONTEXT.md § D6 TTL=5 hardcoded; if the executor refactored TTL to a const, grep for that const instead).
    - `grep -n 'DROP TABLE IF EXISTS ${dynamicViewName}' kinetica_bi/server/src/index.ts | wc -l` returns at least 3 (no-filter drop, over-threshold drop, delete-route drop).
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` still exits 0 (no regression).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Supertest coverage — preview + materialize + delete in both auth modes (≥ 18 tests)</name>
  <files>kinetica_bi/server/tests/routes.dynamic-view.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts (read in full — PATTERN TO MIRROR for the dual-auth-mode harness, fetch mock, TM/SMc:1078 retry test at lines 208-259)
    - kinetica_bi/server/tests/routes.info-query.spec.ts (read first 100 lines — info-query is the structurally closest analog for "fetch mock that returns multi-call Kinetica responses" which the materialize flow needs: filter-view-lookup COUNT + CREATE-OR-REPLACE)
    - kinetica_bi/server/src/index.ts (the 3 new routes — re-read the bodies you wrote so spec assertions match exact response shapes)
    - kinetica_bi/server/src/db.ts (`createDashboardDynamicView`, `createView` + `updateViewStatus` for seeding "filter view exists in ready state" scenarios)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md § "Endpoints" (response shapes locked verbatim)
  </read_first>
  <action>
    1. Create `kinetica_bi/server/tests/routes.dynamic-view.spec.ts` using the same hoisted openid-client mock + helpers preamble from `routes.filter-materialize.spec.ts` (copy lines 1-132 verbatim, adjust imports — add `createDashboardDynamicView`, `createView`, `updateViewStatus` to the db import block).

    Extend `cleanFixtures`:
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

    Add helpers:
    ```typescript
    const seedDynamicView = (dashId: number, tableId: number, overrides: Partial<{ name: string; template_sql: string; max_records: number }> = {}) => {
      return createDashboardDynamicView(dashId, {
        source_table_id: tableId,
        name: overrides.name ?? "Top vendors",
        template_sql: overrides.template_sql ?? "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
        max_records: overrides.max_records ?? 1000,
      });
    };

    const seedFilterView = (dashId: number, tableId: number, username: string, sid: string) => {
      // Match the server-side buildFilterViewName format so the route's lookup succeeds.
      const viewName = `_kbi_filt_u${username.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32)}_d${dashId}_t${tableId}_s${sid.slice(0, 8)}`;
      const created = createView(dashId, tableId, viewName, "zone = 'East Village'");
      updateViewStatus(created.id, "ready");
      return viewName;
    };
    ```

    Note: if `seedFilterView`'s sid is the same one returned by `makeSessionCookie`, the route's `buildFilterViewName` will produce the same name. Use the `sid` returned by `makeSessionCookie` / `seedOidcSession`.

    2. Implement these describe blocks + tests:

    **describe("POST /api/dynamic-view/preview — AUTH_MODE=password"):**
    - `it("returns 200 with { rows, columns } when filter view is active")` — seed dashboard + table + filter view (ready) + dynamic-view row; mock fetch to return `{ status: "OK", data_str: <JSON encoded result with column_headers + column_datatypes + rows> }`; assert body has `columns: [{ name, type }, ...]` and `rows` array.
    - `it("falls back to bare source-table when no active filter view exists")` — seed dashboard + table but NO filter view; assert fetch mock receives a statement matching `SELECT \* FROM \(SELECT .* FROM ki_home\.events.*\) LIMIT 100` (i.e., substituted with the table reference `ki_home.events`, not a filter-view name).
    - `it("returns 400 when template_sql lacks {view} token")` — body `template_sql: "SELECT * FROM raw_events"`; assert 400 + body.error contains `{view}`.
    - `it("clamps sample_limit to 1000 max")` — body `sample_limit: 5000`; assert fetch mock receives `LIMIT 1000`.
    - `it("defaults sample_limit to 100 when omitted")`.
    - `it("returns 404 when source_table_id does not exist")`.
    - `it("returns 400 when required field is missing")` — covers template_sql / source_table_id / dashboard_id (3 subcases).
    - `it("returns 401 with no session cookie")`.

    **describe("POST /api/dynamic-view/materialize — AUTH_MODE=password"):**
    - `it("happy path below threshold — returns { status: 'materialized', view_name, row_count, expires_at } and fires CREATE OR REPLACE")` — seed filter view ready + dynamic-view (max_records: 1000); mock fetch sequence: COUNT → `{ rows: [[500]] }`, then CREATE OR REPLACE → success. Assert response status === "materialized", view_name matches `/^_kbi_dv_u\w+_d\d+_\d+$/`, row_count === 500. Assert fetch calls in order: COUNT statement, then `CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_... USING TABLE PROPERTIES (TTL = 5)`.
    - `it("over threshold — drops dynamic view + returns { status: 'over_threshold', reason: 'exceeds_max_records', row_count }")` — seed (max_records: 100), COUNT returns 200; assert response has the exact reason string AND fetch sequence ends with `DROP TABLE IF EXISTS _kbi_dv_...`.
    - `it("no filter view — drops dynamic view + returns { status: 'over_threshold', reason: 'no_filter' }")` — DO NOT seed filter view; assert response has reason `no_filter` + fetch fired exactly 1 statement: `DROP TABLE IF EXISTS _kbi_dv_...`. No COUNT, no CREATE OR REPLACE.
    - `it("TM/SMc:1078 race-recovery — CREATE OR REPLACE retries with DROP+CREATE and still returns materialized")` — fetch sequence: COUNT → 500, CREATE OR REPLACE → 400 with body containing "TM/SMc:1078", DROP → success, CREATE → success. Assert response status === "materialized". Assert statement sequence: [COUNT, CREATE OR REPLACE, DROP TABLE IF EXISTS, CREATE MATERIALIZED VIEW] (note: 4 statements; the 4th is CREATE, NOT CREATE OR REPLACE).
    - `it("returns 400 when dynamic_view_id is missing")`.
    - `it("returns 404 when dynamic_view_id does not exist")`.
    - `it("returns 401 with no session cookie")`.

    **describe("DELETE /api/dynamic-view/:id — AUTH_MODE=password"):**
    - `it("happy path — drops view + deletes row + returns { deleted: true, dropped: true }")` — seed dynamic view + mock DROP success. Assert: response body, row removed from DB (call `getDashboardDynamicView(id)` returns undefined after request), fetch mock received the DROP statement.
    - `it("returns 404 when id does not exist")` — request `/api/dynamic-view/99999`, assert 404. No fetch fired (i.e., the route returned 404 before calling Kinetica).
    - `it("returns 400 when id path param is non-numeric")`.
    - `it("returns 401 with no session cookie")`.

    **describe("Dynamic-view runtime — AUTH_MODE=oidc smoke"):**
    - `it("preview works under AUTH_MODE=oidc")` — at least one preview happy path with `seedOidcSession("john.doe@kinetica.com")`. Assert the Kinetica fetch is called with `Authorization: Bearer fake-oidc-access-token` (matches existing test pattern from `routes.filter-materialize.spec.ts` line 516+).
    - `it("materialize below threshold works under AUTH_MODE=oidc")` — same OIDC seed + filter view name uses the OIDC-sanitized username; assert response status === "materialized".
    - `it("delete works under AUTH_MODE=oidc")`.

    3. Run the spec; iterate until green. Test count must be ≥ 18.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view.spec.ts --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>
    Spec exits 0. All three routes covered in password mode with full happy/sad paths + TM/SMc:1078 retry. OIDC smoke covers at least one of each route. At least 18 passing tests.
  </done>
  <acceptance_criteria>
    - `grep -nE '^describe\\(' kinetica_bi/server/tests/routes.dynamic-view.spec.ts | wc -l` returns at least 4.
    - `grep -nE 'AUTH_MODE.*password|AUTH_MODE.*oidc' kinetica_bi/server/tests/routes.dynamic-view.spec.ts | wc -l` returns at least 2.
    - `grep -nE 'reason: "no_filter"|reason: \\\\"no_filter\\\\"' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line (no-filter test exists).
    - `grep -nE 'reason: "exceeds_max_records"|reason: \\\\"exceeds_max_records\\\\"' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line.
    - `grep -nE 'TM/SMc:1078' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line (race-recovery test exists).
    - `grep -nE 'DROP TABLE IF EXISTS _kbi_dv_' kinetica_bi/server/tests/routes.dynamic-view.spec.ts | wc -l` returns at least 2 lines (asserted in no-filter + over-threshold + delete tests).
    - `grep -nE 'CREATE OR REPLACE MATERIALIZED VIEW _kbi_dv_' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line (happy-path materialize assertion).
    - `grep -nE 'USING TABLE PROPERTIES \\(TTL = 5\\)' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line (TTL assertion).
    - `grep -nE 'Bearer fake-oidc-access-token' kinetica_bi/server/tests/routes.dynamic-view.spec.ts` returns at least 1 line (OIDC bearer auth assertion).
    - `cd kinetica_bi/server && npx vitest run tests/routes.dynamic-view.spec.ts` exits 0 with ≥ 18 passing tests.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi/server && npx vitest run` (full suite) exits 0 — no regression on any prior spec.
  </acceptance_criteria>
</task>

</tasks>

<verification>
After all 2 tasks complete, run the full server vitest suite + tsc:

```bash
cd kinetica_bi/server && npx vitest run --reporter=verbose 2>&1 | tail -40
cd kinetica_bi/server && npx tsc --noEmit
```

Expected: every prior spec stays green; new `routes.dynamic-view.spec.ts` adds ≥ 18 tests, all green. No type errors. Combined with Plan 02's `routes.dynamic-view-crud.spec.ts`, Phase 32 contributes ≥ 37 new server-side tests.
</verification>

<success_criteria>
- Three new routes registered: `POST /api/dynamic-view/preview`, `POST /api/dynamic-view/materialize`, `DELETE /api/dynamic-view/:id`.
- Preview: substitutes `{view}` with active filter view OR bare source-table; returns rows + columns; 400 on missing token.
- Materialize: enforces the three-way decision tree (no_filter → drop+over_threshold / exceeds_max_records → drop+over_threshold / below → CREATE OR REPLACE via shared helper).
- TM/SMc:1078 retry inherited cleanly from Plan 01's `createOrReplaceMaterialized` helper (proven by supertest, not just unit test).
- Delete: drops Kinetica view + deletes SQLite row; 404 on missing id (does NOT fire DROP).
- All routes work in both `AUTH_MODE=password` and `AUTH_MODE=oidc`.
- `npx tsc --noEmit` clean.
</success_criteria>

<output>
After completion, create `.planning/phases/32-dynamic-view-foundation/32-03-SUMMARY.md` documenting:
- Final route paths + request/response shapes (operator-facing contract reference for Phase 34's UI).
- The `data_str` decoding shape used by Preview + COUNT (confirmed from re-reading kinetica.ts during execution).
- Test counts (per describe block, total new, full-suite still-green count).
- Any decisions made under Claude's discretion (e.g., the 1000-row clamp on `sample_limit`, the choice to return 404 with no DROP fired when delete id is missing).
- Hand-off pointers for Phase 33's client.ts: how to construct request bodies + how to interpret the `status: "materialized" | "over_threshold"` discriminated union.
</output>