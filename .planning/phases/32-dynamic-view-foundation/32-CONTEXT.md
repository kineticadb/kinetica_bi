---
phase: 32
title: dynamic-view-foundation
created: 2026-05-14
status: ready_to_plan
discuss_mode: lightweight_inline
---

# Phase 32 — Dynamic View Foundation (Context)

## Phase goal

Server-side foundation for v1.6 Dynamic Views. Add the `dashboard_dynamic_views` SQLite table, a pure SQL helper for `{view}` token substitution, and three new endpoints (preview / materialize / delete) layered on top of the existing v1.3 filter-view pipeline. No frontend in this phase — it ships dormant.

## Locked decisions (from lightweight discussion, 2026-05-14)

### D1 — Template token
- Single placeholder: `{view}`
- Case-insensitive match, whitespace-tolerant around the braces (regex: `\{\s*view\s*\}/i`)
- Substituted with the source filter-view's materialized name (resolved via existing `buildFilterViewName({ userId, dashboardId, tableId, salt })`)
- If `{view}` is absent: helper throws `MissingViewTokenError` → route returns 400. This is a configuration error, not a runtime degrade.
- **Why**: Single-substitution semantics keep the helper trivially testable and ban the operator from referencing the source table directly (which would bypass filtering).

### D2 — No-filter behavior
- No filter active → no source filter view → dynamic view is considered "over_threshold" and dropped.
- **Why**: Running the dynamic view against the unfiltered source table would defeat the threshold gate entirely. Cleaner to treat "no filters yet" as a single uniform over-threshold state — dependents render the same empty state in both cases.
- **Implementation hook**: materialize endpoint first resolves the source-table's *currently materialized* filter view from the `dashboard_filter_views` table. If no row → short-circuit return `{ status: "over_threshold", reason: "no_filter" }`.

### D3 — Columns persistence
- `columns_json` column on `dashboard_dynamic_views` (TEXT, JSON-encoded array of `{ name, type }`)
- Updated whenever Preview returns successfully (operator clicks Save after a Preview)
- Read by ChartConfigPanel in Phase 35 to populate metric / group-by / drill-down pickers
- **Why**: ChartConfigPanel can't run live SQL against Kinetica from the browser, and dynamic-view columns are unknown until SQL is parsed by Kinetica. Persisting the last-known column set means picker UX works offline / without a round-trip on every dashboard load.

### D4 — Scoping
- Dashboard-scoped (FK on `dashboard_id`). Multiple dynamic views per dashboard. No global / cross-dashboard sharing in v1.6.
- Lifecycle reset on logout + dashboard switch (Phase 33 wires the store reset; Phase 32 backend `DELETE` endpoint is the destruction primitive).

### D5 — Materialize race-recovery
- Same TM/SMc:1078 race that Phase 30 fixed for filter-view CREATE OR REPLACE applies here.
- Reuse the retry pattern: try `CREATE OR REPLACE MATERIALIZED VIEW`, on `TM/SMc:1078` or "Could not find the table" error retry once with `DROP TABLE IF EXISTS` + plain `CREATE MATERIALIZED VIEW`.
- **Why**: Same Kinetica internals that bit filter views will bite dynamic views — operator workflow rebuilds them frequently.

### D6 — TTL
- TTL=5 on the materialized view (matches v1.3 filter-view TTL). Kinetica auto-expires the view if it's not touched.
- **Why**: Consistency with filter-view housekeeping; widget rebinding bumps activity and refreshes TTL.

### D7 — Naming
- Dynamic view name: `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>` (mirrors `_kbi_filt_*` naming).
- Hash-salt suffix: NOT needed (dynamic_view_id is unique within user/dashboard already, and view names don't need cache-busting since CREATE OR REPLACE handles replacement).

## Endpoints

### `POST /api/dynamic-view/preview`
Request:
```json
{
  "template_sql": "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
  "source_table_id": 4,
  "dashboard_id": 1,
  "sample_limit": 100
}
```
Behavior:
1. Resolve current source filter-view name (if any) OR fall back to source table name when previewing without an active filter.
2. Substitute `{view}` → resolved name.
3. Execute `SELECT * FROM (<substituted_sql>) LIMIT <sample_limit>` against Kinetica.
4. Return `{ rows, columns: [{ name, type }] }` from Kinetica response metadata.
5. Does NOT persist anything. Pure read.

### `POST /api/dynamic-view/materialize`
Request: `{ "dynamic_view_id": 7 }`
Behavior:
1. Load row from `dashboard_dynamic_views`.
2. Look up current source filter-view name. If none → return `{ status: "over_threshold", reason: "no_filter" }` and drop any existing materialized dynamic view.
3. Run `SELECT COUNT(*) FROM <source_view>` to get filtered row count.
4. If count >= `max_records` → `DROP TABLE IF EXISTS <dynamic_view_name>` and return `{ status: "over_threshold", reason: "exceeds_max_records", row_count: N }`.
5. Otherwise: `CREATE OR REPLACE MATERIALIZED VIEW <dynamic_view_name> AS (<substituted_sql>) USING TABLE PROPERTIES (TTL = 5)`. On TM/SMc:1078 retry with DROP+CREATE. Return `{ status: "materialized", view_name, row_count }`.

### `DELETE /api/dynamic-view/:id`
Behavior: `DROP TABLE IF EXISTS <dynamic_view_name>`, then `DELETE FROM dashboard_dynamic_views WHERE id = ?`.

### CRUD (round-out)
Also needed in Phase 32 for Phase 34 UI to bind against:
- `GET /api/dashboards/:dashboardId/dynamic-views` — list
- `POST /api/dashboards/:dashboardId/dynamic-views` — create (validates `{view}` presence; does NOT auto-materialize — frontend triggers `/materialize` separately for symmetry with filter-view flow)
- `PUT /api/dynamic-views/:id` — update; clears `columns_json` if `template_sql` changes (forces re-preview before save in UI)

## Code context (already in repo)

- `kinetica_bi/server/src/lib/filterViewName.ts` — `buildFilterViewName({ userId, dashboardId, tableId, salt })`. Reuse pattern for `buildDynamicViewName`.
- `kinetica_bi/server/src/index.ts` `POST /api/filter/materialize` — retry-on-TM/SMc:1078 pattern. Extract into a shared `createOrReplaceMaterialized(view, sqlBody, ttl)` helper in this phase so both filter view + dynamic view share it.
- `kinetica_bi/server/src/db/migrations.ts` — idempotent PRAGMA-guarded migration pattern from v1.4 Phase 19.
- `kinetica_bi/server/src/lib/kineticaClient.ts` — wrapper used by all SQL execution.
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` — supertest harness pattern; new `routes.dynamic-view.spec.ts` follows same shape (both auth modes).

## Out of scope (deferred to later phases)

- Frontend store and lifecycle reset → Phase 33
- Management modal (create/edit/preview UI) → Phase 34
- Widget binding + cascading re-materialize → Phase 35
- E2E verification → Phase 36
