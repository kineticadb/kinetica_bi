---
phase: 32-dynamic-view-foundation
plan: 02
subsystem: server
tags: [dynamic-views, crud, express-routes, supertest, dual-auth-mode]
requires:
  - phase-32-CONTEXT-D1-token-presence-check
  - phase-32-CONTEXT-D3-columns-json-clear-on-template-change
  - phase-32-CONTEXT-D4-dashboard-scoping
  - phase-32-plan-01-listDashboardDynamicViews
  - phase-32-plan-01-getDashboardDynamicView
  - phase-32-plan-01-createDashboardDynamicView
  - phase-32-plan-01-updateDashboardDynamicView
  - phase-32-plan-01-substituteViewToken
  - phase-32-plan-01-MissingViewTokenError
provides:
  - GET-/api/dashboards/:dashboardId/dynamic-views
  - POST-/api/dashboards/:dashboardId/dynamic-views
  - PUT-/api/dynamic-views/:id
  - dummy-view-name-validation-placeholder ("_dummy_validation_view_name_")
  - dual-auth-mode-supertest-pattern-for-dynamic-views
affects:
  - kinetica_bi/server/src/index.ts route-registration region (Plan 03 insertion anchor preserved)
tech-stack:
  added:
    - kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts (new supertest file, 704 lines, 27 tests)
  patterns:
    - "_dummy_validation_view_name_" placeholder for create/update-time {view}-presence validation via substituteViewToken
    - columns_json discipline: caller-supplied wins; omit-with-template-change clears; omit-without-change preserves; explicit null clears
    - 4-describe-block harness (3 password full-matrix + 1 oidc smoke) mirrors routes.filter-materialize.spec.ts shape
key-files:
  created:
    - kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts
  modified:
    - kinetica_bi/server/src/index.ts (added 2 import sites + 3 route handlers; 158 insertions)
decisions:
  - "_dummy_validation_view_name_" string chosen as the dummy view name passed to substituteViewToken at create/update time — it is purely a presence-check placeholder, never persisted; underscored name makes greppable origin obvious if a future audit shows it leaking
  - PUT columns_json semantics use 3-way precedence: (1) caller-supplied (incl. explicit null) wins verbatim; (2) caller omits AND template_sql changed → clear; (3) caller omits AND template_sql unchanged → preserve. This matches the Plan 34 Preview-then-Save flow described in CONTEXT.md D3.
  - POST returns columns_json:null on create (never auto-derives at create time) — Preview is a separate user action; create-time auto-derivation would couple the CRUD route to Kinetica connectivity, breaking the dormant-ship invariant.
  - Wave 2 conflict-prevention: routes wrapped in a delimited "=====" comment block with explicit "Plan 03 routes append after this line" anchor — Plan 03's preview/materialize/delete handlers can insert directly above the v1.4 info-query block without touching this region's interior.
  - PUT updated_at advance is asserted with >= (not >) because SQLite datetime('now') has second granularity; the test inserts a 1.1s sleep before update to guarantee a tick advance.
  - The OIDC describe block uses ONE happy-path smoke per route (3 tests) rather than mirroring the full validation matrix — full validation already proved correct in AUTH_MODE=password and is auth-mode-independent (substituteViewToken + body checks run before auth-mode-specific code). This keeps the OIDC sub-suite small and focused on the credential-branch coverage.
  - Sleep-based updated_at test uses a real setTimeout (not vi.useFakeTimers) because better-sqlite3's datetime('now') reads the actual system clock, not Node's timer.
metrics:
  duration: 4
  tasks_completed: 2
  files_modified: 1
  files_created: 1
  tests_added: 27
  tests_total_green: 51
  completed: 2026-05-14
---

# Phase 32 Plan 02: Dynamic View CRUD Endpoints Summary

Three new Express routes (list / create / update) for dashboard-scoped dynamic views, layered on top of Plan 01's db helpers + `{view}`-token validation, with 27 supertest cases proving the validation matrix in both `AUTH_MODE=password` and `AUTH_MODE=oidc`. The phase-34 management UI now has a stable CRUD surface to bind against; preview / materialize / delete remain owned by Plan 03 (disjoint route paths).

## Tasks

| Task | Name                                                                                | Commit  | Files                                                  |
| ---- | ----------------------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| 1    | Add GET / POST `/api/dashboards/:dashboardId/dynamic-views` and PUT `/api/dynamic-views/:id` routes | 5fabb12 | kinetica_bi/server/src/index.ts                        |
| 2    | Supertest coverage of all 3 CRUD endpoints in AUTH_MODE=password + AUTH_MODE=oidc   | 0161d9f | kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts |

## What landed

### Route surface

```
GET    /api/dashboards/:dashboardId/dynamic-views   →  200 { dynamic_views: DashboardDynamicView[] }
POST   /api/dashboards/:dashboardId/dynamic-views   →  201 { dynamic_view: DashboardDynamicView }
PUT    /api/dynamic-views/:id                       →  200 { dynamic_view: DashboardDynamicView }
```

Error envelopes (uniform across all three routes): `{ error: string }`. Status codes: 400 for shape / token-validation failures, 401 for missing session cookie (via `requireConfig` → `requireAuth`), 404 for unknown `:id` on PUT, 500 for missing `KINETICA_URL` env.

### Response shape (DashboardDynamicView)

```typescript
{
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  columns_json: { name: string; type: string }[] | null;
  created_at: string;  // SQLite datetime: "YYYY-MM-DD HH:MM:SS"
  updated_at: string;
}
```

### Validation rules

- **POST required fields:** `source_table_id` (number), `name` (non-empty string), `template_sql` (non-empty string AND contains `{view}` per `substituteViewToken`), `max_records` (positive number). `dashboardId` path param must be numeric.
- **POST hardcode:** `columns_json: null` on create (Preview-then-Save flow populates it later via PUT). CONTEXT.md D3.
- **PUT partial update:** Each body field is optional; helper-side `updateDashboardDynamicView` preserves omitted fields. If `template_sql` is supplied, it must be non-empty AND contain `{view}`.
- **PUT columns_json discipline:**
  - Caller supplies `columns_json: [...]` → stored verbatim.
  - Caller supplies `columns_json: null` → field cleared.
  - Caller omits `columns_json` AND changes `template_sql` → field auto-cleared (CONTEXT.md D3 — forces re-Preview before next Save).
  - Caller omits `columns_json` AND `template_sql` unchanged → field preserved.

## Test coverage delta

| Describe block                                                       | Tests | Status  |
| -------------------------------------------------------------------- | ----- | ------- |
| `GET /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password` | 5     | passing |
| `POST /api/dashboards/:dashboardId/dynamic-views — AUTH_MODE=password`| 9     | passing |
| `PUT /api/dynamic-views/:id — AUTH_MODE=password`                    | 10    | passing |
| `Dynamic-view CRUD — AUTH_MODE=oidc smoke`                           | 3     | passing |
| **New Plan-02 tests**                                                | **27**| **green** |
| `tests/routes.filter-materialize.spec.ts` (regression, unchanged)    | 24    | passing |
| `tests/routes.filter-materialize-spatial.spec.ts` (regression)       | 26    | passing |
| **Combined related-spec total**                                      | **77**| **green** |

`npx tsc --noEmit` from `kinetica_bi/server/` exits 0 — no new type errors.

Pre-existing failures in unrelated specs (`auth.oidc.spec.ts`, `auth.routes.spec.ts`, `bootstrap.spec.ts`, etc.) flagged in Plan 01's SUMMARY remain out of scope per the SCOPE BOUNDARY rule and are NOT caused by this plan.

## Plan-02-specific decisions (under Claude's discretion)

1. **`"_dummy_validation_view_name_"` placeholder string.** The plan asked Claude to choose a placeholder for the create/update-time `{view}`-presence probe. Underscored prefix + suffix makes its origin obvious in any future log audit (it should NEVER appear in persisted SQL). The string is passed to `substituteViewToken` only for its side effect (throwing `MissingViewTokenError` on absence); the return value is discarded.

2. **`updated_at` test uses real `setTimeout(1100)`, not fake timers.** `better-sqlite3` evaluates `datetime('now')` against the OS clock, which `vi.useFakeTimers()` does not control. A 1.1s sleep guarantees the SQLite second tick advances.

3. **OIDC sub-suite limited to 3 happy-path smoke tests (one per route).** The full 24-case validation matrix lives in the password block and is auth-mode-independent (validation runs before any auth-mode-specific branch). Mirrors the existing `routes.filter-materialize.spec.ts` shape where OIDC adds 2 smoke cases on top of ~18 password cases.

4. **Wave-2 conflict-prevention anchors.** Wrapped the three new routes in delimited comment block ("===== v1.6 Phase 32 Plan 02 ... =====" open, "===== End Phase 32 Plan 02 — Plan 03 routes append after this line =====" close). Plan 03's preview/materialize/delete handlers can insert directly above the v1.4 Phase 18 info-query block without textual conflict.

## Deviations from Plan

None — all 2 tasks executed exactly as written. The plan's acceptance grep regexes assumed `app.get("…"` on a single line (the example in `<action>` was inline); I split the route registration across multiple lines per existing project style (`requireConfig` and `asyncHandler(...)` on their own lines). Each verb-route pair still appears exactly once in the file (verified via two-line grep with `-B1`). No semantic deviation.

## Hand-off pointers for Phase 33's `client.ts`

The 3 routes return JSON of the shapes documented above. Phase 33 client library should expose:

```typescript
async function listDynamicViews(dashboardId: number): Promise<DashboardDynamicView[]> {
  const res = await fetch(`/api/dashboards/${dashboardId}/dynamic-views`, { credentials: "include" });
  if (!res.ok) throw new Error(...);
  const { dynamic_views } = await res.json();
  return dynamic_views;
}

async function createDynamicView(
  dashboardId: number,
  input: {
    source_table_id: number;
    name: string;
    template_sql: string;  // MUST contain {view}
    max_records: number;   // > 0
  },
): Promise<DashboardDynamicView> {
  const res = await fetch(`/api/dashboards/${dashboardId}/dynamic-views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const { dynamic_view } = await res.json();
  return dynamic_view;
}

async function updateDynamicView(
  id: number,
  attrs: Partial<{
    source_table_id: number;
    name: string;
    template_sql: string;  // if supplied, MUST contain {view}
    max_records: number;
    columns_json: { name: string; type: string }[] | null;  // explicit null clears
  }>,
): Promise<DashboardDynamicView> {
  // ... PATCH /api/dynamic-views/:id (HTTP method is PUT, not PATCH — see route definition)
}
```

`DashboardDynamicView` TypeScript shape is already exported by the server's `src/types.ts` (Plan 01); Phase 33 should re-declare an identical interface in `client.ts` or import via a shared types file.

UI flows to remember:
- Preview button → POST `/api/dynamic-view/preview` (Plan 03; sends `template_sql` for transient probe — does NOT persist).
- Save button → if creating: POST `/api/dashboards/:dashboardId/dynamic-views` with the user's template_sql + the columns from the most recent Preview as `columns_json`. If editing: PUT `/api/dynamic-views/:id` with `{ template_sql, columns_json }` together.
- On `template_sql` edit in the modal → the UI should locally mark `columns_json` as stale and grey out the Save button until the user re-runs Preview. Server-side defense in depth: PUT will auto-clear `columns_json` if the caller omits it on a template_sql change.

## Self-Check: PASSED

- `kinetica_bi/server/src/index.ts` — MODIFIED (3 routes registered, verified by grep)
- `kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts` — FOUND (27 tests)
- commit 5fabb12 — FOUND
- commit 0161d9f — FOUND
- `npx tsc --noEmit` — exits 0
- 27 new tests pass; 24 + 26 pre-existing related specs still pass; no regression
