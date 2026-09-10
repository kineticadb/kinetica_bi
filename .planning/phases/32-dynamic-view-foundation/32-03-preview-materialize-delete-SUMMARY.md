---
phase: 32-dynamic-view-foundation
plan: 03
subsystem: server
tags: [dynamic-views, preview, materialize, delete, kinetica, supertest, runtime-endpoints, race-recovery, oidc, ttl]
requires:
  - phase-32-CONTEXT-D1-substituteViewToken
  - phase-32-CONTEXT-D2-no-filter-behavior
  - phase-32-CONTEXT-D5-materialize-race-recovery
  - phase-32-CONTEXT-D6-TTL-5
  - phase-32-CONTEXT-D7-naming
  - phase-32-plan-01-substituteViewToken
  - phase-32-plan-01-MissingViewTokenError
  - phase-32-plan-01-buildDynamicViewName
  - phase-32-plan-01-createOrReplaceMaterialized
  - phase-32-plan-01-getDashboardDynamicView
  - phase-32-plan-01-deleteDashboardDynamicView
  - phase-32-plan-02-Plan-03-insertion-anchor
provides:
  - POST-/api/dynamic-view/preview
  - POST-/api/dynamic-view/materialize
  - DELETE-/api/dynamic-view/:id
  - DYNAMIC_PREVIEW-audit-op
  - DYNAMIC_MATERIALIZE-audit-op
  - isTableNotFoundError-route-local-helper
  - kinetica-probe-pattern-for-filter-view-existence
affects:
  - phase-33-dynamic-view-client.ts (consumes preview/materialize/delete responses)
  - phase-34-DynamicViewModal (binds Preview button + Save flow)
  - phase-35-renderers (will trigger materialize on filter-view version bump)
tech-stack:
  added:
    - kinetica_bi/server/tests/routes.dynamic-view.spec.ts (24 tests)
    - KineticaOp union extended with DYNAMIC_PREVIEW + DYNAMIC_MATERIALIZE
  patterns:
    - "Kinetica round-trip as filter-view existence check (no SQLite-row sentinel)"
    - "isTableNotFoundError centralised matcher: msg includes TM/SMc:1078 OR /Could not find the table/i (matches lib/materializedView.ts race-recovery detector)"
    - "COUNT(*) probe doubles as existence-check + threshold-input (saves one round-trip)"
    - "SELECT 1 FROM <view> LIMIT 0 probe for cheap existence check (Preview route)"
    - "column-major Kinetica response unpack — column_headers + column_1..N — same as info-query"
    - "Plan 03 routes wrapped in delimited comment block paired with Plan 02 anchor — no textual conflict"
key-files:
  created:
    - kinetica_bi/server/tests/routes.dynamic-view.spec.ts
  modified:
    - kinetica_bi/server/src/index.ts (added deleteDashboardDynamicView import, buildDynamicViewName import, isTableNotFoundError local helper, 3 new route handlers)
    - kinetica_bi/server/src/kinetica.ts (KineticaOp union: + DYNAMIC_PREVIEW + DYNAMIC_MATERIALIZE)
key-decisions:
  - "sample_limit clamp = [1, 1000], default 100 (Claude's discretion — caps Preview cost; default matches CONTEXT.md endpoint example)"
  - "Preview no-filter detection via Kinetica round-trip (SELECT 1 LIMIT 0 probe), NOT via dashboard_table_views lookup — session-scoped filter views from POST /api/filter/materialize are NEVER persisted to dashboard_table_views, so the only authoritative existence check is Kinetica-side"
  - "Materialize COUNT(*) probe doubles as existence-check + threshold-input — saves one Kinetica round-trip per call"
  - "Default column type = 'unknown' when Kinetica response lacks column_datatypes (existing /execute/sql encoded shape doesn't include type metadata)"
  - "DELETE returns 404 on missing id BEFORE firing any Kinetica DROP — preserves caller's ability to distinguish 'never existed' from 'drop failed'"
  - "Route-local isTableNotFoundError helper duplicates lib/materializedView.ts § isReplaceRace detector intentionally — keeping the matcher next to its only Plan-03 consumer avoids a cross-module dependency for a 2-line predicate"
patterns-established:
  - "Filter-view existence probe pattern — use Kinetica round-trip catching 'Could not find the table' instead of SQLite-row check"
  - "Dynamic-view runtime endpoints all share buildDynamicViewName + buildFilterViewName for deterministic naming"
  - "All Kinetica DROPs in Plan 03 use DROP TABLE IF EXISTS — idempotent + silent on missing"
requirements-completed: [DV-V16-03, DV-V16-04, DV-V16-05]
metrics:
  duration: 8
  tasks_completed: 2
  files_modified: 2
  files_created: 1
  tests_added: 24
  tests_total_green: 154
  completed: 2026-05-14
---

# Phase 32 Plan 03: Dynamic View Preview / Materialize / Delete Runtime Endpoints Summary

Three new Express routes (`POST /api/dynamic-view/preview`, `POST /api/dynamic-view/materialize`, `DELETE /api/dynamic-view/:id`) compose Plan 01's helpers (`substituteViewToken`, `buildDynamicViewName`, `createOrReplaceMaterialized`) with the existing `buildFilterViewName` to deliver the Phase 32 "meat": ad-hoc Preview without persistence, threshold-gated CREATE OR REPLACE with TM/SMc:1078 race-recovery, and idempotent DROP + row removal on Delete. 24 new supertest cases cover the full validation matrix in `AUTH_MODE=password` plus a 3-case OIDC smoke.

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-14T15:22:14Z
- **Completed:** 2026-05-14
- **Tasks:** 2
- **Files modified:** 2 (`kinetica_bi/server/src/index.ts`, `kinetica_bi/server/src/kinetica.ts`)
- **Files created:** 1 (`kinetica_bi/server/tests/routes.dynamic-view.spec.ts`)

## Accomplishments

- **Preview endpoint (DV-V16-03):** Probes Kinetica for the session-scoped filter view via `SELECT 1 FROM <view> LIMIT 0`; on "Could not find the table" falls back to the bare source-table reference (lets operators develop SQL without first applying a filter). Substitutes `{view}` via Plan 01's helper, then runs `SELECT * FROM (<substituted>) LIMIT N` and decodes the column-major encoded response into `{ rows: any[][], columns: { name, type }[] }`. Sample_limit clamped to `[1, 1000]`, default 100. Returns 400 on missing `{view}` token, 404 on unknown source_table_id, 401 with no session cookie.
- **Materialize endpoint (DV-V16-04):** Three-way decision tree:
  1. `SELECT COUNT(*) FROM <filterView>` — on "Could not find the table" (filter view never materialised OR TTL'd out): `DROP TABLE IF EXISTS <dynamicView>` + return `{ status: "over_threshold", reason: "no_filter" }`.
  2. Count ≥ `max_records`: `DROP TABLE IF EXISTS <dynamicView>` + return `{ status: "over_threshold", reason: "exceeds_max_records", row_count: N }`.
  3. Below threshold: `substituteViewToken` then `createOrReplaceMaterialized({ ttl: 5, ... })` — TM/SMc:1078 race-recovery delegated to Plan 01's shared helper. Returns `{ status: "materialized", view_name, row_count, expires_at }`.
- **Delete endpoint (DV-V16-05):** `DROP TABLE IF EXISTS <dynamicView>` (best-effort, idempotent) then `deleteDashboardDynamicView(id)`. Returns 404 BEFORE firing the DROP when id is missing (caller can distinguish 404 from 500 cleanly). Auth and upstream errors propagate via errorMiddleware without deleting the SQLite row.
- **Audit-log alignment:** Extended `KineticaOp` union with `DYNAMIC_PREVIEW` (preview-route probes + executions) and `DYNAMIC_MATERIALIZE` (materialize COUNT/CREATE/DROP + delete-route DROP). Operators can now filter the structured log by these tags to slice dynamic-view workload from filter-view workload.
- **Test coverage:** 24 new supertest cases — 11 password Preview, 7 password Materialize, 4 password Delete, 3 OIDC smoke. Total Phase 32-related specs now green: 154 (51 from Plan 01 + 27 from Plan 02 + 24 from Plan 03 + 24 filter-materialize regression + 26 filter-materialize-spatial regression + ~2 db migration spec already counted).

## Task Commits

1. **Task 1: Add preview/materialize/delete routes** — `e2542e2` (feat)
2. **Task 2: Supertest coverage (24 tests)** — `545cd30` (test)

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — Added 3 import additions (`deleteDashboardDynamicView`, `buildDynamicViewName`; `substituteViewToken` + `MissingViewTokenError` + `createOrReplaceMaterialized` + `buildFilterViewName` already imported by earlier plans), one local helper `isTableNotFoundError`, and three route handlers wrapped in a delimited comment block (`v1.6 Phase 32 Plan 03` open/close). ~270 line insertion above the `v1.4 Phase 18 info-query` block; Plan 02's anchor comment is preserved.
- `kinetica_bi/server/src/kinetica.ts` — `KineticaOp` union extended with `DYNAMIC_PREVIEW` and `DYNAMIC_MATERIALIZE` (audit-log op tags).
- `kinetica_bi/server/tests/routes.dynamic-view.spec.ts` (NEW) — Hoisted openid-client mock + helpers preamble copied from `routes.filter-materialize.spec.ts`; 4 describe blocks; 24 tests total.

## Endpoint Reference (operator-facing contract — for Phase 33 client.ts)

### `POST /api/dynamic-view/preview`

Request:
```json
{
  "template_sql": "SELECT vendor, AVG(fare) FROM {view} GROUP BY vendor",
  "source_table_id": 4,
  "dashboard_id": 1,
  "sample_limit": 100
}
```

Response (200):
```json
{
  "rows": [["A", 12.5], ["B", 10.0]],
  "columns": [{ "name": "vendor", "type": "unknown" }, { "name": "avg_fare", "type": "unknown" }]
}
```

Errors:
- 400 — missing or empty `template_sql` / `source_table_id` / `dashboard_id`; `{view}` token absent in template
- 404 — `source_table_id` not registered in admin tables
- 401 — no session cookie
- 500 / 502 — upstream Kinetica error (propagated)

### `POST /api/dynamic-view/materialize`

Request: `{ "dynamic_view_id": 7 }`

Response (200, discriminated union by `status`):
- `{ "status": "materialized", "view_name": "_kbi_dv_u<userId>_d<dashId>_<dvId>", "row_count": 500, "expires_at": 1778772734000 }` — TTL=5 min sliding
- `{ "status": "over_threshold", "reason": "no_filter" }` — filter view absent
- `{ "status": "over_threshold", "reason": "exceeds_max_records", "row_count": 200 }` — count ≥ max_records

Errors:
- 400 — missing or non-numeric `dynamic_view_id`; out-of-band-corrupted DB row missing `{view}`
- 404 — `dynamic_view_id` row missing OR source_table_id row missing
- 401 — no session cookie
- 500 / 502 — upstream Kinetica error (propagated)

### `DELETE /api/dynamic-view/:id`

Response (200): `{ "deleted": true, "dropped": true }`

Errors:
- 400 — non-numeric `:id` path param
- 404 — row not found (no DROP fired — caller can retry without race risk)
- 401 — no session cookie
- 500 / 502 — DROP failure (SQLite row preserved for retry)

## Kinetica response shape (confirmed during execution)

`kineticaSql` returns the **column-major** encoded shape:

```typescript
{
  column_headers: string[],
  column_1: T1[],
  column_2: T2[],
  // ...
}
```

The preview decoder transposes this to row-major (`unknown[][]`) — same convention as `POST /api/info/query` (index.ts:1132-1148) and discovery routes. Column types are **NOT** present in this shape (verified across all existing consumers); the decoder defaults `type` to `"unknown"` per column. If a future Kinetica response variant adds `column_datatypes`, the decoder picks it up transparently.

For COUNT(*): the response is `{ column_headers: ["c"], column_1: [N] }` — single row, single value.

## Decisions Made (under Claude's discretion)

1. **sample_limit clamp = [1, 1000], default 100.** The plan didn't specify either bound. 1000 caps the Preview cost (a too-large preview defeats the "one-shot probe" purpose of the endpoint), and 100 matches the example in CONTEXT.md.

2. **Preview no-filter detection via Kinetica round-trip, NOT via SQLite lookup.** The plan attempted to detect "active filter view" through a `dashboard_table_views` row with `status === "ready"`. Two problems with that:
   - `DashboardTableView.status` is `"pending" | "created" | "error"` — there's no `"ready"` value.
   - Session-scoped filter views produced by `POST /api/filter/materialize` are NEVER inserted into `dashboard_table_views`. They live exclusively as Kinetica materialized views with deterministic names from `buildFilterViewName`.
   
   The authoritative existence check is therefore a Kinetica round-trip. For Preview, a single `SELECT 1 FROM <view> LIMIT 0` probe lets us pick the right `{view}` substitution before the real preview SQL runs. For Materialize, the `SELECT COUNT(*)` probe doubles as existence check + threshold input — single round-trip.

3. **Default column type = "unknown".** Kinetica's `/execute/sql` encoded response has no column-type metadata in any consumer I could find (info-query, discovery routes). Rather than fabricate, the decoder emits `"unknown"`. Phase 35's ChartConfigPanel can infer types from sampled values if needed, or a future Kinetica response variant can populate `column_datatypes` (decoder handles both transparently).

4. **DELETE returns 404 BEFORE firing DROP.** When the SQLite row doesn't exist, we have nothing to drop and nothing to delete — returning 404 immediately preserves the caller's ability to distinguish "never existed / already deleted" from "drop failed". Asserted in the test "returns 404 when id does not exist — no DROP fired".

5. **Route-local `isTableNotFoundError` helper.** Plan 01's `lib/materializedView.ts` has the same matcher inline (`msg.includes("TM/SMc:1078") || /Could not find the table/i.test(msg)`). Plan 03 has two consumers (Preview probe, Materialize COUNT) — duplicating the 2-line predicate keeps each route handler self-contained without adding a new module. If a third consumer appears, lifting to a shared `lib/kineticaErrorMatchers.ts` becomes worthwhile.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan's no_filter detection scheme was structurally incorrect**
- **Found during:** Task 1 implementation (before first compile)
- **Issue:** The plan instructed to look up the "current source filter-view" via `listViewsForTable(dashboard_id, table_id)` and filter for `view_name === expectedFilterViewName && status === "ready"`. But:
  - `DashboardTableView.status` enum is `"pending" | "created" | "error"` — no `"ready"` value exists (confirmed via `kinetica_bi/server/src/types.ts:25`).
  - Session-scoped filter views from `POST /api/filter/materialize` are **never** inserted into `dashboard_table_views` (verified by reading the filter-materialize handler at index.ts:698-797 — it only writes to Kinetica, never to SQLite). `dashboard_table_views` is the *persisted saved-view* table managed by `POST /api/dashboards/:id/views` + `POST /api/views/:id/materialize` — a separate v1.3 subsystem.
  - Under the plan's logic, `activeFilterView` would always be `undefined` and the route would always return `no_filter` — broken on the happy path.
- **Fix:** Switched to Kinetica round-trip detection. Preview probes with `SELECT 1 FROM <expectedFilterViewName> LIMIT 0` and on "Could not find the table" (TM/SMc:1078 family) falls back to bare source-table. Materialize uses `SELECT COUNT(*)` as the existence probe (doubles as threshold input — single round-trip vs the plan's 2). Documented inline with a multi-paragraph comment block explaining the architectural reasoning so future readers don't re-introduce the bug.
- **Files modified:** `kinetica_bi/server/src/index.ts`
- **Verification:** All 24 supertest cases pass; the "happy path below threshold" test confirms the COUNT-then-CREATE statement sequence; the "no filter view" test confirms COUNT returns table-not-found → single DROP + over_threshold; no statement decoder bugs surfaced.
- **Committed in:** `e2542e2` (Task 1)

**2. [Rule 3 — Blocking] KineticaOp union missing DYNAMIC_PREVIEW + DYNAMIC_MATERIALIZE**
- **Found during:** Task 1 first `tsc --noEmit` run
- **Issue:** The `KineticaOp` type union in `kinetica.ts` is the audit-log op tag; passing `"DYNAMIC_PREVIEW"` or `"DYNAMIC_MATERIALIZE"` produced 7 `TS2322` type errors at the route handlers' `kineticaSqlHelper(... , { op })` call sites.
- **Fix:** Extended the union: `KineticaOp = "SQL" | "DISCOVERY" | "MATERIALIZE" | "WMS" | "INFO_QUERY" | "DYNAMIC_PREVIEW" | "DYNAMIC_MATERIALIZE"`. Comment documents which routes own the new tags.
- **Files modified:** `kinetica_bi/server/src/kinetica.ts`
- **Verification:** `npx tsc --noEmit` clean after edit; audit-log emits the new op verbatim (verified by reading kinetica.ts:148-150 baseAudit composition).
- **Committed in:** `e2542e2` (Task 1)

---

**Total deviations:** 2 auto-fixed (1 architectural bug in plan, 1 blocking type-error)
**Impact on plan:** Both fixes essential for correctness. The no-filter detection rewrite changed the implementation strategy but preserved the user-facing contract (`{ status: "over_threshold", reason: "no_filter" }`) exactly. No scope creep — both fixes stay inside the three plan-specified routes.

## Issues Encountered

- **Plan claim about `column_datatypes` was speculative.** The plan template referenced `column_datatypes` in the Preview decoder, but no existing Kinetica consumer in the codebase uses or expects that field. Verified by grepping `column_datatypes` across `src/` and `tests/` — zero hits. Decoder defaults `type: "unknown"` per column; if Kinetica ever does emit `column_datatypes` the decoder picks it up. Documented in the inline route comment.
- **Pre-existing test failures remain out of scope.** `auth.oidc.spec.ts`, `oidc.module.spec.ts`, `bootstrap.spec.ts`, `boot.wipe.spec.ts`, `routes.wms.spec.ts` failures (116 total in the full vitest run) are present on the baseline commit (`bf2c2e2` from Plan 01) and persist independently of any work in this plan. Plan 01's SUMMARY documented them and confirmed via stash that they exist on the bare baseline. Out of scope per SCOPE BOUNDARY rule.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Phase 33 (client.ts):** All three endpoints are stable. Client library should expose:

```typescript
async function previewDynamicView(args: {
  dashboardId: number;
  sourceTableId: number;
  templateSql: string;
  sampleLimit?: number;
}): Promise<{ rows: unknown[][]; columns: { name: string; type: string }[] }>;

async function materializeDynamicView(dynamicViewId: number): Promise<
  | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
  | { status: "over_threshold"; reason: "no_filter" }
  | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number }
>;

async function deleteDynamicView(id: number): Promise<{ deleted: boolean; dropped: boolean }>;
```

The materialize return is a **discriminated union** on `status` — the consumer should:
1. Switch on `status === "materialized"` for the happy path (render the dynamic view).
2. Switch on `status === "over_threshold"` and inspect `reason` for empty-state messaging (`"no_filter"` → "Apply a filter to enable dynamic view"; `"exceeds_max_records"` → "Filtered data ({row_count} rows) exceeds dynamic-view limit"). Both branches GUARANTEE the Kinetica materialized view is dropped, so dependents safely render empty.

**Phase 34 (DynamicViewModal):** Preview button binds to `previewDynamicView`, then on Save: PUT `/api/dynamic-views/:id` (Plan 02) with `{ template_sql, columns_json: columns }` together. The `columns_json` field persists the most recent Preview's column shape so Phase 35's ChartConfigPanel can populate pickers without re-running Preview on every dashboard load (CONTEXT.md § D3).

**Phase 35 (renderers):** On filter-view version bump (Phase 33's filter-view store), each saved dynamic view should fire `materializeDynamicView(id)` — same trigger pattern as filter-view re-materialize. The `over_threshold` branch is the empty state.

## Self-Check: PASSED

- `kinetica_bi/server/src/index.ts` — MODIFIED (3 routes registered between lines 1004-1248, verified by grep)
- `kinetica_bi/server/src/kinetica.ts` — MODIFIED (KineticaOp union extended)
- `kinetica_bi/server/tests/routes.dynamic-view.spec.ts` — FOUND (24 tests, all green)
- commit `e2542e2` — FOUND in `git log --oneline -5`
- commit `545cd30` — FOUND in `git log --oneline -5`
- `npx tsc --noEmit` from `kinetica_bi/server/` — exits 0
- `npx vitest run` on `routes.dynamic-view.spec.ts` — 24/24 pass
- `npx vitest run` on `routes.filter-materialize.spec.ts` — 24/24 pass (no regression)
- 9-spec union (all Phase 32-related + filter-materialize + info-query) — 154/154 pass

---
*Phase: 32-dynamic-view-foundation*
*Completed: 2026-05-14*
