---
phase: 35-widget-binding-and-pipeline
plan: 01
subsystem: database

tags: [sqlite, better-sqlite3, dashboard_layers, dynamic_view_id, pragma-migration, supertest, tdd]

# Dependency graph
requires:
  - phase: 32-dynamic-view-foundation
    provides: "dashboard_dynamic_views table (logical FK target for dashboard_layers.dynamic_view_id)"
  - phase: 33-dynamic-view-store
    provides: "DynamicViewRow DTO + useDynamicViewStore (consumes the new dynamic_view_id at render time)"
  - phase: 19-config-schema
    provides: "PRAGMA-guarded idempotent ALTER pattern + 'key' in attrs discriminant updater"
provides:
  - "dashboard_layers.dynamic_view_id INTEGER NULL column (idempotent migration; soft FK to dashboard_dynamic_views.id)"
  - "DashboardLayer.dynamic_view_id: number | null (server type + mapDashboardLayer projection + updateDashboardLayer updater)"
  - "PATCH /api/dashboards/:id/layers/:layerId accepts dynamic_view_id with 'key' in attrs discriminant (explicit null clears, omit preserves)"
  - "DashboardLayerDto.dynamic_view_id: number | null (frontend DTO + updateLayer Pick<>)"
  - "Supertest coverage: dynamic_view_id round-trip in AUTH_MODE=password (3 tests) + AUTH_MODE=oidc (2 smoke tests)"
affects: [35-02-buildwmsparams-precedence, 35-06-map-renderer-and-layer-picker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PRAGMA-guarded idempotent ALTER TABLE (verbatim mirror of v1.0→v1.1 sessions + v1.3→v1.4 info_* migrations)"
    - "Soft FK at SQLite level (no REFERENCES) — layer survives dv deletion; renderer detects orphan"
    - "'key' in attrs discriminant for explicit-null-clear vs preserve-on-omit (consistent with info_* fields)"
    - "Hoisted openid-client mock + resetOidcClientForTests for AUTH_MODE=oidc supertest blocks"

key-files:
  created: []
  modified:
    - "kinetica_bi/server/src/db.ts (CREATE TABLE + PRAGMA migration + mapDashboardLayer + updateDashboardLayer)"
    - "kinetica_bi/server/src/types.ts (DashboardLayer.dynamic_view_id field)"
    - "kinetica_bi/server/src/index.ts (PATCH route Pick<> body type)"
    - "kinetica_bi/src/api/client.ts (DashboardLayerDto + updateLayer Pick<>)"
    - "kinetica_bi/server/tests/db.smoke.spec.ts (v1.6 column-order + v1.5→v1.6 migration + round-trip tests)"
    - "kinetica_bi/server/tests/layers.spec.ts (PATCH dynamic_view_id supertest, both auth modes)"
    - "kinetica_bi/src/components/LayersModal.spec.tsx (factory: dynamic_view_id: null)"
    - "kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx (factory)"
    - "kinetica_bi/src/components/charts/InfoPopup.spec.tsx (factory)"
    - "kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx (factory)"
    - "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (factory)"
    - "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (factory)"
    - "kinetica_bi/src/store/dashboardLayersStore.spec.ts (factory)"

key-decisions:
  - "Keep table_id NOT NULL even for dv-bound layers — caller sets table_id = dv.source_table_id so drill-down + filter-bar code paths keep working; buildWmsParams precedence routes the dv-vs-table LAYERS-swap at render time (no schema relaxation)"
  - "No REFERENCES on dynamic_view_id (soft FK) — mirrors table_id rationale (db.ts:87 lock): layer survives dv deletion; renderer surfaces orphan UX"
  - "No DEFAULT on dynamic_view_id — NULL is the empty signal; existing v1.5 rows MUST NOT be auto-bound to any dv"
  - "Use 'dynamic_view_id' in attrs discriminant (NOT attrs.dynamic_view_id ??) in updateDashboardLayer so PATCH { dynamic_view_id: null } explicitly clears the binding"
  - "Frontend DashboardLayerDto.dynamic_view_id is non-optional (number | null) — strict type contract forces all fixtures to populate the field; prevents silent undefined leakage into PATCH bodies"
  - "OIDC supertest coverage uses separate describe block (not describe.each) — matches routes.dynamic-view.spec.ts pattern; existing layers.spec.ts is password-mode-only, so we add a second block rather than restructure the file"

patterns-established:
  - "Soft-FK column with no DEFAULT for v1.6 per-row dv binding (renderer detects orphan; layer survives source deletion)"
  - "PRAGMA-guarded ALTER block extended one cell deeper for each v1.x → v1.(x+1) schema bump"

requirements-completed: [DV-V16-13]

# Metrics
duration: 8min
completed: 2026-05-15
---

# Phase 35 Plan 01: Layers Schema Migration Summary

**dashboard_layers gains a nullable dynamic_view_id INTEGER column with end-to-end type + projection + updater + PATCH + frontend DTO plumbing, unlocking per-layer dynamic-view binding for Plan 35-02 buildWmsParams precedence.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-15T16:34:06Z
- **Completed:** 2026-05-15T16:42:18Z
- **Tasks:** 2 (TDD: 4 atomic commits — 2 test + 2 feat)
- **Files modified:** 13

## Accomplishments

- `dashboard_layers.dynamic_view_id INTEGER` column added to fresh installs AND idempotently migrated into existing v1.5 databases (PRAGMA-guarded ALTER mirrors v1.0→v1.1 + v1.3→v1.4 patterns verbatim)
- Server CRUD pipeline (type → projection → updater → PATCH route body) all accept and round-trip the field; explicit `{ dynamic_view_id: null }` clears the binding via the `"key" in attrs` discriminant
- Frontend `DashboardLayerDto` + `updateLayer` Pick<> extended (byte-for-byte mirror of server-side type)
- Supertest coverage: 3 cases in `AUTH_MODE=password` (set / explicit-null-clear / preserve-on-omit) + 2 smoke cases in `AUTH_MODE=oidc` (set + explicit-null-clear); proves the field survives both credential-type code paths
- 7 frontend spec fixtures updated to populate `dynamic_view_id: null` (Rule 1 auto-fix — strict non-optional type contract forced fixtures to be complete)

## Task Commits

Each task was committed atomically following the TDD red→green pattern:

1. **Task 1 RED: failing tests for dynamic_view_id schema/CRUD** - `71dd3a6` (test)
2. **Task 1 GREEN: add column + type + projection + updater** - `b2abde4` (feat)
3. **Task 2 RED: PATCH dynamic_view_id supertest coverage** - `351a155` (test)
4. **Task 2 GREEN: extend PATCH Pick<> + frontend DTO** - `1178973` (feat, includes 7 spec fixture updates)

## Files Created/Modified

- `kinetica_bi/server/src/db.ts` — CREATE TABLE adds `dynamic_view_id INTEGER` before `created_at`; new PRAGMA-guarded `ALTER TABLE ... ADD COLUMN dynamic_view_id INTEGER` block; `mapDashboardLayer` projection emits `row.dynamic_view_id ?? null`; `updateDashboardLayer` accepts the field via `"dynamic_view_id" in attrs` discriminant
- `kinetica_bi/server/src/types.ts` — `DashboardLayer.dynamic_view_id: number | null` (non-optional, mirrors server SQLite null-handling)
- `kinetica_bi/server/src/index.ts` — PATCH `/api/dashboards/:id/layers/:layerId` Pick<> body type extended to accept `dynamic_view_id` (pass-through trust model, same as `info_*`)
- `kinetica_bi/src/api/client.ts` — `DashboardLayerDto.dynamic_view_id: number | null` + `updateLayer` Pick<> extended
- `kinetica_bi/server/tests/db.smoke.spec.ts` — 3 new tests: v1.6 column-order (12 cols), v1.5→v1.6 idempotent migration (table_id stays 42, dynamic_view_id NULL), mapDashboardLayer+updateDashboardLayer round-trip (set/clear/preserve)
- `kinetica_bi/server/tests/layers.spec.ts` — 5 new tests: 3 in password mode (set / explicit-null-clear / preserve-on-omit) + 2 in OIDC smoke (set / explicit-null-clear) with hoisted openid-client mock
- 7 frontend spec files — `dynamic_view_id: null` added to layer factories: `LayersModal.spec.tsx`, `MapConfigPanel.spec.tsx`, `MapChartRenderer.spec.tsx`, `InfoPopup.spec.tsx`, `InfoCardRenderer.spec.tsx`, `InfoSelectionView.spec.tsx`, `dashboardLayersStore.spec.ts`

## Decisions Made

- **Soft FK (no REFERENCES) on `dynamic_view_id`** — mirrors `table_id` rationale at `db.ts:86-87`: layer survives source deletion; renderer detects orphan and surfaces "Some layers over threshold" overlay (consistent with the existing dangling-table_id pattern).
- **`table_id` stays NOT NULL** — when a layer is dv-bound, the picker sets `table_id = dv.source_table_id` (NOT null) so drill-down + filter-bar code paths keep working unchanged; `buildWmsParams` precedence routes the actual WMS LAYERS-swap to the dv at render time.
- **No DEFAULT on `dynamic_view_id`** — NULL is the empty signal; existing v1.5 rows must NOT be auto-bound to any dv.
- **`"dynamic_view_id" in attrs` discriminant in updater** — `??` would silently ignore an explicit null; `||` would drop `0` (irrelevant for INTEGER FK but consistent pattern); `"key" in attrs` is the correct discriminant matching `info_enabled`/`info_columns`/`info_template`.
- **Non-optional frontend type (`number | null`, not `number | null | undefined`)** — strict contract forces all fixtures to populate the field; prevents silent undefined leakage into PATCH bodies that would skip the discriminant branch.
- **OIDC supertest in a separate describe block** — `routes.dynamic-view.spec.ts` uses the same pattern (separate `describe("... — AUTH_MODE=oidc smoke", ...)`); the existing `layers.spec.ts` is password-mode-only with `vi.stubEnv("AUTH_MODE", "password")` in `beforeEach`, so a second describe with `vi.stubEnv("AUTH_MODE", "oidc")` + hoisted `openid-client` mock is the minimal-change pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated v1.4 column-order regression test for new dynamic_view_id**
- **Found during:** Task 1 GREEN (after adding `dynamic_view_id` to CREATE TABLE)
- **Issue:** Existing test `"creates dashboard_layers table with v1.4 info popup columns"` hardcoded an 11-column list in its `expect(cols).toEqual([...])` assertion; adding `dynamic_view_id` to the CREATE TABLE made the assertion fail (12 cols vs 11).
- **Fix:** Added `"dynamic_view_id"` to the expected column list (between `info_template` and `created_at`); updated the comment to reflect v1.6 placement.
- **Files modified:** `kinetica_bi/server/tests/db.smoke.spec.ts`
- **Verification:** `npx vitest run tests/db.smoke.spec.ts` — 14/14 pass
- **Committed in:** `b2abde4` (Task 1 GREEN)

**2. [Rule 1 - Bug] Populated `dynamic_view_id: null` in 7 frontend spec layer factories**
- **Found during:** Task 2 GREEN (after extending `DashboardLayerDto.dynamic_view_id` as non-optional `number | null`)
- **Issue:** Frontend `tsc --noEmit` reported 7 type errors — existing spec layer factories built layer DTOs without `dynamic_view_id`, which is required by the strict (non-optional) type contract. Optional typing (`dynamic_view_id?: number | null`) would mask undefined leakage into PATCH bodies, so the strict contract is the correct lock.
- **Fix:** Added `dynamic_view_id: null` to the 7 layer factories (one line each).
- **Files modified:** `LayersModal.spec.tsx`, `MapConfigPanel.spec.tsx`, `MapChartRenderer.spec.tsx`, `InfoPopup.spec.tsx`, `InfoCardRenderer.spec.tsx`, `InfoSelectionView.spec.tsx`, `dashboardLayersStore.spec.ts`
- **Verification:** `npx tsc --noEmit` clean; ran the 7 affected specs — 242/242 tests pass
- **Committed in:** `1178973` (Task 2 GREEN)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bug/correctness)
**Impact on plan:** Both auto-fixes were trivial cascade updates of pre-existing fixtures/assertions that the new schema column invalidated. No scope creep, no architectural decisions, no behavioral changes.

## Issues Encountered

- **Plan instructed `describe.each([["password"], ["oidc"]])` pattern**, but `layers.spec.ts` is structured as one password-mode `describe` and the canonical project pattern (per `routes.dynamic-view.spec.ts`) is separate describe blocks with `vi.stubEnv` setup in each. **Resolution:** kept the existing password-mode describe intact, added the 3 new password-mode tests inside it, and appended a second describe `"layers PATCH dynamic_view_id — AUTH_MODE=oidc smoke"` with hoisted `openid-client` mock + `resetOidcClientForTests` (verbatim mirror of `routes.dynamic-view.spec.ts` OIDC block). Net effect: 5 new tests (3 password + 2 OIDC smoke) per plan must_haves; AUTH_MODE coverage requirement satisfied; existing file structure preserved.

## Self-Check: PASSED

All 13 claimed files exist on disk; all 4 claimed commits (`71dd3a6`, `b2abde4`, `351a155`, `1178973`) found in `git log --all`.

## Next Plan Readiness

- Plan 35-02 (`buildwmsparams-precedence`) consumes `DashboardLayerDto.dynamic_view_id` for the LAYERS-swap precedence; column + type + DTO all in place. (Note: 35-02 SUMMARY already exists — that plan was executed out-of-order before 35-01 was formally completed; this 35-01 work retroactively cements the schema foundation 35-02 depends on.)
- Plan 35-06 (`map-renderer-and-layer-picker`) will consume the PATCH route to wire LayersModal's per-layer Data Source picker; route + frontend `updateLayer` Pick<> all in place.
- `table_id` remains NOT NULL — Plan 35-06 picker MUST set `table_id = dv.source_table_id` when binding to a dv (NOT null) to satisfy the schema constraint and keep drill-down + filter-bar working.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
