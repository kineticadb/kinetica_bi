---
phase: 32-dynamic-view-foundation
verified: 2026-05-14T11:37:00Z
status: passed
score: 10/10 must-haves verified
re_verification: null
---

# Phase 32: dynamic-view-foundation Verification Report

**Phase Goal:** Server-side foundation for v1.6 Dynamic Views. New `dashboard_dynamic_views` SQLite table; pure SQL helper for `{view}` token substitution; three new endpoints (preview / materialize / drop); supertest coverage in both `AUTH_MODE=password` and `AUTH_MODE=oidc`; full v1.3 backward compat (no impact on filter-view endpoints).

**Verified:** 2026-05-14T11:37:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth (MV-32-XX)                                                                                       | Status     | Evidence                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `dashboard_dynamic_views` table created on boot with all 9 columns + FK CASCADE                        | VERIFIED   | `kinetica_bi/server/src/db.ts:104-115` — CREATE TABLE IF NOT EXISTS with all 9 columns; `dashboard_id REFERENCES dashboards(id) ON DELETE CASCADE`; `source_table_id REFERENCES tables(id) ON DELETE CASCADE`. Migration spec at `tests/db.dynamicViewsMigration.spec.ts` (5 tests green) asserts column list + types + NOT NULL flags. |
| 02  | `substituteViewToken` exists with case-insensitive whitespace-tolerant regex; throws on absent token   | VERIFIED   | `kinetica_bi/server/src/lib/dynamicViewSql.ts:25` — regex `/\{\s*view\s*\}/gi`. Exports `substituteViewToken` (L27) and `MissingViewTokenError` (L18). Throws `MissingViewTokenError` when token absent (L32-34). `tests/lib.dynamicViewSql.spec.ts` covers 10 cases — including case variants `{View}`, `{VIEW}`, whitespace `{ view }`, and absence-throws. |
| 03  | `buildDynamicViewName` produces `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>` (D7)                | VERIFIED   | `kinetica_bi/server/src/lib/dynamicViewName.ts:22-25` — exact pattern `_kbi_dv_u${sanitizedUserId}_d${dashboardId}_${dynamicViewId}`. Reuses `sanitizeForViewName` from `viewNaming.ts` (single source of truth for sanitization rule). `tests/lib.dynamicViewName.spec.ts` 6 cases green. |
| 04  | `createOrReplaceMaterialized` helper exists; inline retry removed from `index.ts`                      | VERIFIED   | `kinetica_bi/server/src/lib/materializedView.ts:31-54` — handles TM/SMc:1078 + "Could not find the table" with DROP IF EXISTS + plain CREATE retry. `index.ts:788-795` shows `POST /api/filter/materialize` now uses an 8-line `await createOrReplaceMaterialized({...})` call. No inline retry constructs remain in `index.ts` (only the route-local `isTableNotFoundError` helper at L999-1002 for the no-filter detection probe, which is a different concern). 24 `tests/routes.filter-materialize.spec.ts` cases still green — contract preserved. |
| 05  | Six new Express routes registered                                                                      | VERIFIED   | `app.get` @ `index.ts:842` /api/dashboards/:dashboardId/dynamic-views; `app.post` @ L855 same path; `app.put` @ L902 /api/dynamic-views/:id; `app.post` @ L1005 /api/dynamic-view/preview; `app.post` @ L1115 /api/dynamic-view/materialize; `app.delete` @ L1219 /api/dynamic-view/:id. All six paths and verbs confirmed. |
| 06  | Materialize endpoint exhibits the four D2/D5/D6/D7 behaviors                                            | VERIFIED   | `index.ts:1144-1165` — no filter view (COUNT throws table-not-found) → DROP + `{ status: "over_threshold", reason: "no_filter" }`. L1177-1183 — count ≥ max_records → DROP + `{ status: "over_threshold", reason: "exceeds_max_records", row_count }`. L1199-1214 — below threshold → `createOrReplaceMaterialized({ ttl: 5, ... })` + `{ status: "materialized", view_name, row_count, expires_at }`. TM/SMc:1078 race-recovery delegated to helper (verified by 1 dedicated supertest case at `routes.dynamic-view.spec.ts:543`). |
| 07  | Token validation: Create + Update routes reject missing `{view}` with HTTP 400                          | VERIFIED   | `index.ts:882-890` POST validation calls `substituteViewToken(body.template_sql, "_dummy_validation_view_name_")` and returns 400 on `MissingViewTokenError`. L921-934 PUT does the same when `template_sql` is supplied. Test `routes.dynamic-view-crud.spec.ts:263` "returns 400 when template_sql lacks {view} token" confirms behavior. |
| 08  | Update auto-clears `columns_json` when `template_sql` changes (D3)                                      | VERIFIED   | `index.ts:935-963` — three-way precedence: caller-supplied `columns_json` wins; caller omits AND template_sql changed → auto-clear (L944-948); caller omits AND unchanged → preserve (L950). Supertest coverage in `routes.dynamic-view-crud.spec.ts` (PUT block, L431+). |
| 09  | At least 24 new supertest cases; both `AUTH_MODE=password` and `AUTH_MODE=oidc` exercised               | VERIFIED   | `tests/routes.dynamic-view.spec.ts` = 24 tests across 4 describe blocks (Preview/Materialize/Delete in `password`, OIDC smoke). `tests/routes.dynamic-view-crud.spec.ts` = 27 tests (GET/POST/PUT in `password`, OIDC smoke). Total: 51 new dynamic-view supertests. Both auth modes verified via `vi.stubEnv("AUTH_MODE", ...)` in the describe-block beforeAll hooks. |
| 10  | Backward compat: `POST /api/filter/materialize` tests still green                                       | VERIFIED   | `npx vitest run tests/routes.filter-materialize.spec.ts tests/routes.filter-materialize-spatial.spec.ts` → 50/50 pass. No regression from the helper extraction. |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact                                                            | Expected                                                                     | Status   | Details                                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kinetica_bi/server/src/db.ts`                                       | `dashboard_dynamic_views` DDL + 5 CRUD helpers + mapDashboardDynamicView      | VERIFIED | DDL L104-115 (9 columns + FK CASCADE on both parents + index). CRUD: `listDashboardDynamicViews` L547, `getDashboardDynamicView` L554, `createDashboardDynamicView` L568, `updateDashboardDynamicView` L595, `deleteDashboardDynamicView` L609. |
| `kinetica_bi/server/src/types.ts`                                    | `DashboardDynamicView` type                                                  | VERIFIED | L47 — `export type DashboardDynamicView = {...}` with all 9 fields including JSON-decoded `columns_json: { name, type }[] | null`. |
| `kinetica_bi/server/src/lib/dynamicViewSql.ts`                       | `substituteViewToken` + `MissingViewTokenError`                              | VERIFIED | 40 lines; both exports present; regex `/\{\s*view\s*\}/gi`; `lastIndex` reset defense against /g state leak (L31, L38).                                          |
| `kinetica_bi/server/src/lib/dynamicViewName.ts`                      | `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`               | VERIFIED | 25 lines; reuses `sanitizeForViewName` from `viewNaming.ts`.                                                                                                     |
| `kinetica_bi/server/src/lib/materializedView.ts`                     | `createOrReplaceMaterialized` shared helper                                  | VERIFIED | 54 lines; handles `TM/SMc:1078` + `Could not find the table` race with DROP IF EXISTS + plain CREATE retry. Used by both filter-view + dynamic-view materialize. |
| `kinetica_bi/server/src/kinetica.ts`                                 | `KineticaOp` union extended with `DYNAMIC_PREVIEW` + `DYNAMIC_MATERIALIZE`   | VERIFIED | L39-40 — both members present in the union.                                                                                                                       |
| `kinetica_bi/server/src/index.ts`                                    | 6 new route registrations + `isTableNotFoundError` helper                    | VERIFIED | Six routes confirmed at L842, L855, L902, L1005, L1115, L1219. Local helper `isTableNotFoundError` at L999-1002.                                                  |
| `kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts`          | Migration spec — 5 tests                                                     | VERIFIED | 5 tests, all green. Asserts column list, types, NOT NULL flags, idempotency, CASCADE behavior.                                                                    |
| `kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts`                | Helper spec — ≥6 tests                                                       | VERIFIED | 10 tests, all green. Covers case variants, whitespace, multi-occurrence, MissingViewTokenError throw, lastIndex defense.                                          |
| `kinetica_bi/server/tests/lib.dynamicViewName.spec.ts`               | Naming spec                                                                  | VERIFIED | 6 tests, all green.                                                                                                                                              |
| `kinetica_bi/server/tests/lib.materializedView.spec.ts`              | Helper spec — race recovery branches                                          | VERIFIED | 6 tests, all green. Covers happy path, TM/SMc:1078 retry, "Could not find the table" retry, non-matching error propagates.                                        |
| `kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts`          | 27 supertests across GET/POST/PUT in both auth modes                          | VERIFIED | 27 tests, all green. 5 GET + 9 POST + 10 PUT in `password`; 3 OIDC smoke.                                                                                         |
| `kinetica_bi/server/tests/routes.dynamic-view.spec.ts`               | 24 supertests across preview/materialize/delete in both auth modes            | VERIFIED | 24 tests, all green. 11 preview + 7 materialize + 4 delete in `password`; 3 OIDC smoke.                                                                          |

---

### Key Link Verification

| From                                       | To                                                              | Via                                                                                | Status | Details                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts` POST /api/filter/materialize    | `lib/materializedView.ts::createOrReplaceMaterialized`         | direct `await createOrReplaceMaterialized({...})` call                              | WIRED  | `index.ts:788-795`. Existing 24 supertest cases still green (contract preserved).                                                                       |
| `index.ts` POST /api/dynamic-view/materialize | `lib/materializedView.ts::createOrReplaceMaterialized`     | direct `await createOrReplaceMaterialized({...})` with ttl=5                        | WIRED  | `index.ts:1199-1206`. Test confirms CREATE OR REPLACE fires + retry path on TM/SMc:1078.                                                                |
| `index.ts` POST + PUT CRUD validation       | `lib/dynamicViewSql.ts::substituteViewToken`                  | calls helper with `"_dummy_validation_view_name_"` placeholder; catches `MissingViewTokenError` | WIRED  | `index.ts:884`, `index.ts:927`. Returns 400 on throw. Test `routes.dynamic-view-crud.spec.ts:263` proves end-to-end 400 response.                       |
| `index.ts` POST /api/dynamic-view/preview   | `lib/dynamicViewSql.ts::substituteViewToken`                  | calls helper with resolved source name (filter-view OR bare-table fallback)         | WIRED  | `index.ts:1066`. Test `routes.dynamic-view.spec.ts:194+` covers happy path + 400 on missing token.                                                       |
| `index.ts` POST /api/dynamic-view/materialize | `lib/dynamicViewSql.ts::substituteViewToken`                | calls helper with `expectedFilterViewName`                                         | WIRED  | `index.ts:1189`. Defensive 400 surface for out-of-band-corrupted DB rows.                                                                                |
| `index.ts` POST /api/dynamic-view/materialize | `lib/dynamicViewName.ts::buildDynamicViewName`              | called with `{ userId, dashboardId, dynamicViewId }`                                | WIRED  | `index.ts:1132-1136`. Test confirms view name matches `/^_kbi_dv_u\w+_d\d+_\d+$/`.                                                                       |
| `index.ts` DELETE /api/dynamic-view/:id     | `lib/dynamicViewName.ts::buildDynamicViewName`                | called with row.dashboard_id + row.id                                              | WIRED  | `index.ts:1232-1236` → DROP TABLE IF EXISTS + row deletion sequence.                                                                                     |
| `index.ts` POST /api/dynamic-view/preview + materialize | `lib/filterViewName.ts::buildFilterViewName`     | resolves the source filter-view name for token substitution + COUNT(*) probe       | WIRED  | `index.ts:1036-1041` (preview) and `index.ts:1137-1142` (materialize).                                                                                  |
| `index.ts` CRUD + runtime routes            | `db.ts` CRUD helpers (list/get/create/update/delete)           | direct function calls                                                              | WIRED  | All 5 helpers imported at `index.ts:74-79`. List @ L850; create @ L891; update @ L965; get @ L910, L1123, L1227; delete @ L1245.                       |
| `kinetica.ts` audit log                     | New `DYNAMIC_PREVIEW` / `DYNAMIC_MATERIALIZE` op tags          | `KineticaOp` type union extension                                                  | WIRED  | `kinetica.ts:39-40` union members. All six route invocations of `kineticaSqlHelper` use one of these op tags (audit-log alignment).                     |

---

### Requirements Coverage

| Requirement   | Source Plan(s)         | Description                                                                                                                                  | Status     | Evidence                                                                                                                                                                              |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-V16-01     | 32-01 (schema) + 32-02 (CRUD round-out) | SQLite table `dashboard_dynamic_views` with idempotent migration                                                                  | SATISFIED  | `db.ts:104-115` DDL + index; migration spec @ `tests/db.dynamicViewsMigration.spec.ts` covers idempotency (re-run on existing DB does not error). CRUD round-out via 3 routes in Plan 02. |
| DV-V16-02     | 32-01                  | Pure helper `substituteViewToken(template, viewName)` with `{view}` regex                                                                   | SATISFIED  | `lib/dynamicViewSql.ts:25-40`. 10 unit tests cover case-insensitive + whitespace-tolerant + multi-occurrence + absence-throws.                                                          |
| DV-V16-03     | 32-03                  | `POST /api/dynamic-view/preview` endpoint                                                                                                    | SATISFIED  | `index.ts:1005-1112`. 11 password supertests + 1 OIDC smoke cover happy path, no-filter fallback to bare source-table, missing `{view}` token → 400, 404 on unknown source_table_id.    |
| DV-V16-04     | 32-03                  | `POST /api/dynamic-view/materialize` with threshold gate + TM/SMc:1078 retry                                                                  | SATISFIED  | `index.ts:1115-1216`. 7 password supertests + 1 OIDC smoke cover materialized below threshold, over_threshold/exceeds_max_records, over_threshold/no_filter, TM/SMc:1078 retry path.   |
| DV-V16-05     | 32-03                  | `DELETE /api/dynamic-view/:id` + dual-auth supertest coverage                                                                                | SATISFIED  | `index.ts:1219-1248`. 4 password supertests + 1 OIDC smoke cover happy path (DROP + row deletion), 404 on missing id (no DROP fired), 400 on non-numeric id, error propagation.        |

No orphaned requirements — REQUIREMENTS.md DV-V16-01..05 are all owned by Phase 32 plans 01-03, and all are checked `[x]`.

---

### Anti-Patterns Found

None.

- No `TODO` / `FIXME` / `XXX` / `HACK` / `PLACEHOLDER` markers in any of the new/modified files in scope.
- No `return null` / `return {}` stub bodies in route handlers.
- No `console.log`-only handlers.
- Inline TM/SMc:1078 retry block from `index.ts` was removed cleanly during the helper extraction — only references to the substring remain in comments documenting the centralization (lines 786, 977, 991, 997, 1001 — all are comments OR the centralized matcher itself in `isTableNotFoundError`).

---

### Known Deviation Review (Plan 03 — no-filter detection)

The deviation described in the verification request — switching from `listViewsForTable` + status-string check to a Kinetica round-trip probe — is sound and verified:

1. **Root cause of the plan-text bug:** `DashboardTableView.status` enum is `"pending" | "created" | "error"` (verified via `kinetica_bi/server/src/types.ts:25`); the plan referenced a non-existent `"ready"` value. Furthermore, session-scoped filter views from `POST /api/filter/materialize` are never persisted to `dashboard_table_views` (confirmed by reading the filter-materialize handler at `index.ts:700-799` — no SQLite write). So even with a corrected status string the lookup would always be empty.
2. **Replacement semantics:** Preview uses `SELECT 1 FROM <expectedFilterViewName> LIMIT 0` probe (`index.ts:1048-1061`) to choose between filter-view substitution and bare-source-table fallback. Materialize uses the `SELECT COUNT(*)` round-trip (`index.ts:1148-1165`) doubled as existence-check + threshold input — saves one Kinetica round-trip vs the plan's 2-step `SELECT 1` + `SELECT COUNT(*)`.
3. **`no_filter` semantics preserved:** `index.ts:1162` returns exactly `{ status: "over_threshold", reason: "no_filter" }` when the COUNT probe catches a `TM/SMc:1078`-family error. Test `routes.dynamic-view.spec.ts:512-541` asserts the response body + that the only statements that fire are COUNT (throws) + DROP — no CREATE.
4. **Forward compatibility with Phase 33:** The wire-format guarantee is `{ status: "over_threshold", reason: "no_filter" | "exceeds_max_records", ... }` discriminated union — Phase 33's renderer logic for the empty-state will switch on `status === "over_threshold"` and inspect `reason` for messaging. The probe-based detection does not change the consumer contract.

**Deviation verdict:** Architecturally correct; the contract on the wire matches the original plan; the test suite locks the behaviour in place.

---

### Human Verification Required

None for this phase. Phase 32 is server-side foundation only — no UI surface exists yet (Phases 33-35 land the frontend store, modal, and renderer integration). All goal-achievement evidence is verifiable via:
- Source inspection (route handlers, helpers, schema DDL)
- Static type checking (`npx tsc --noEmit` exits 0)
- Supertest assertions across `AUTH_MODE=password` + `AUTH_MODE=oidc`
- Regression specs for `POST /api/filter/materialize`

Live operator UAT is a Phase 36 concern.

---

### Test Suite Results

```
$ npx vitest run \
    tests/routes.dynamic-view.spec.ts \
    tests/routes.dynamic-view-crud.spec.ts \
    tests/routes.filter-materialize.spec.ts \
    tests/routes.filter-materialize-spatial.spec.ts \
    tests/lib.dynamicViewSql.spec.ts \
    tests/lib.dynamicViewName.spec.ts \
    tests/lib.materializedView.spec.ts \
    tests/db.dynamicViewsMigration.spec.ts

Test Files  8 passed (8)
Tests       128 passed (128)
```

- 51 new Phase 32 dynamic-view supertests (24 runtime + 27 CRUD) — green
- 50 filter-materialize regression supertests (24 base + 26 spatial) — green (no regression from helper extraction)
- 27 unit-test specs across 4 lib + 1 migration file — green

`npx tsc --noEmit` from `kinetica_bi/server/` exits 0 — no new type errors.

---

### Gaps Summary

None. All 10 must-haves verified at all three levels (exists, substantive, wired). The phase delivers exactly the contract described in `32-CONTEXT.md` and ROADMAP.md, with one architectural deviation in Plan 03 (no-filter detection mechanism) that preserves the user-facing wire contract and is fully covered by supertests.

Phase 32 is ready to proceed. Phase 33 (frontend store + client.ts) can bind against the stable endpoint surface documented in the Plan 02 + Plan 03 SUMMARYs.

---

_Verified: 2026-05-14T11:37:00Z_
_Verifier: Claude (gsd-verifier)_
