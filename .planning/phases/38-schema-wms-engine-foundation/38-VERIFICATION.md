---
phase: 38-schema-wms-engine-foundation
verified: 2026-05-19T03:15:00Z
status: passed
score: 7/7 requirements satisfied; 5/5 success criteria verified
re_verification: false
---

# Phase 38: Schema + WMS Engine Foundation — Verification Report

**Phase Goal:** The server-side and URL-builder foundation is in place — schema migrated, DTO extended, wmsUrlBuilder emitting correct CB_* and TRACK_* params per spike findings, 6-char color bug fixed, and `/api/quantile` endpoint live — so Phases 39 and 41 can persist and test real data.

**Verified:** 2026-05-19T03:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Server restarts cleanly against existing DB — PRAGMA-guarded `cb_config` + `track_config` ALTER is idempotent | VERIFIED | `db.ts:201-206` — `!layerColNames.has("cb_config")` guard before ALTER; PRAGMA queried once (count=1); both columns present in CREATE TABLE block (lines 106-107) and ALTER block |
| SC2 | `POST /api/quantile` returns `{ breaks: number[] }` under both AUTH_MODE=password and AUTH_MODE=oidc | VERIFIED | `routes.quantile.spec.ts` — 17/17 tests pass (11 password + 6 oidc); AUTH_MODE-agnostic dual describe blocks present |
| SC3 | `wmsUrlBuilder.buildWmsParams` emits 8-char AARRGGBB for classbreak colors; regression spec locks format | VERIFIED | `normalizeAARRGGBB(b.color, "FF000000")` used for all CB colors; `wmsUrlBuilder.spec.ts` — 8-char regression lock spec passes (78/78 total) |
| SC4 | PATCH with `cb_config` / `track_config` round-trips through server unchanged on GET — DTO + CRUD + route + frontend DTO end-to-end | VERIFIED | `routes.dashboard-layers-patch.spec.ts` — 5/5 tests pass including explicit-null-clears + key-omitted-preserves; `client.ts:480-481` has DashboardLayerDto extension |
| SC5 | `lib/trackDetect.ts isTrackTable()` identifies TRACKID+x+y+TIMESTAMP and rejects missing fields | VERIFIED | `trackDetect.spec.ts` — 9/9 cases pass (canonical, case-insensitive, each missing field, empty, extras, no-alias rejection) |

**Score:** 5/5 success criteria verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `kinetica_bi/server/src/db.ts` | PRAGMA-guarded ALTER for cb_config + track_config; CREATE TABLE extended; mapDashboardLayer projects both; updateDashboardLayer uses `"key" in attrs` | VERIFIED | Lines 106-107 (CREATE), 201-206 (ALTER guards), 251-252 (projection), 551-552 (CRUD discriminant) all confirmed |
| `kinetica_bi/server/src/types.ts` | `DashboardLayer` extended with `cb_config: string \| null` + `track_config: string \| null` | VERIFIED | Lines 89-90 confirmed |
| `kinetica_bi/server/src/index.ts` | PATCH route extended; POST `/api/quantile` mounted with `kineticaSql(..., { route: "POST /api/quantile", op: "QUANTILE" })` | VERIFIED | Lines 610-611 (PATCH Pick<>), 858 (route mount), 898 (kineticaSql call shape verbatim) confirmed |
| `kinetica_bi/server/src/kinetica.ts` | `KineticaOp` union extended with `"QUANTILE"` | VERIFIED | Line 48 confirmed |
| `kinetica_bi/server/src/lib/quantileSql.ts` | `buildQuantileSql` + `parseQuantileResponse`; NTILE PARTITION BY 0 template; pure module | VERIFIED | Both exports confirmed; `PARTITION BY 0` present; no Express/db/kinetica imports |
| `kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` | AUTH_MODE-agnostic supertest; PASSES both modes | VERIFIED | 5/5 pass; dual describe blocks; `vi.hoisted` openid-client mock present (line 23) |
| `kinetica_bi/server/tests/routes.quantile.spec.ts` | AUTH_MODE-agnostic quantile supertest; PASSES both modes | VERIFIED | 17/17 pass; dual describe blocks; `vi.hoisted` mock present (line 24) |
| `kinetica_bi/server/tests/lib.quantileSql.spec.ts` | Pure unit spec for quantileSql | VERIFIED | 11/11 pass |
| `kinetica_bi/src/lib/cbConfig.ts` | `EMPTY_CB_CONFIG`, `coalesceCbConfig`, `isCbConfigConfigured`, `isNumericValsType`, `isCategoricalValsType`; NO Zod | VERIFIED | All 5 exports confirmed; no Zod import |
| `kinetica_bi/src/lib/trackDetect.ts` | `isTrackTable(columns)` strict 4-name case-insensitive; NO aliases | VERIFIED | Function confirmed; "lat"/"lon"/"track_id" appear only in comments, not code |
| `kinetica_bi/src/lib/cbConfig.spec.ts` + `trackDetect.spec.ts` | Companion specs PASS | VERIFIED | 24/24 pass (15 cbConfig + 9 trackDetect) |
| `kinetica_bi/src/lib/wmsUrlBuilder.ts` | Lane C `STYLES=cb_raster`; `normalizeAARRGGBB` for all CB colors; NO legacy `config.classbreaks` reads; Track block appended | VERIFIED | See hard-cutover lock section below |
| `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` | Lane C URL emission, 8-char AARRGGBB lock, Track matrix, `_mv` preservation, null-track-config backward-compat — all PASS | VERIFIED | 78/78 pass |
| `kinetica_bi/src/api/client.ts` | `DashboardLayerDto` extended with `cb_config: string \| null` + `track_config: string \| null`; `quantileFn` appended | VERIFIED | Lines 480-481 (DTO), 1074 (quantileFn), 1077 (AbortSignal arg) confirmed |
| `kinetica_bi/src/components/charts/MapChartRenderer.tsx` | `lastEmittedParamsRef` fingerprint extended to include `cb_config` + `track_config` | VERIFIED | Lines 1118, 1208 — fingerprint is `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `db.ts` CREATE TABLE | `db.ts` PRAGMA-guarded ALTER | Both extended with `cb_config TEXT` + `track_config TEXT` | WIRED | Lines 106-107 + 201-206 |
| `types.ts DashboardLayer` | `db.ts mapDashboardLayer` | `cb_config: row.cb_config ?? null` + `track_config: row.track_config ?? null` | WIRED | Lines 89-90 + 251-252 |
| `db.ts updateDashboardLayer` | `index.ts PATCH route` | `"cb_config" in attrs` discriminant; Pick<> extended in PATCH body | WIRED | Lines 551-552 + 610-611 |
| `quantileSql.ts buildQuantileSql` | 37-SPIKE-NOTES.md NTILE template | `PARTITION BY 0` verbatim; column substituted 3 times | WIRED | Line 48 of quantileSql.ts |
| `index.ts POST /api/quantile` | `kinetica.ts kineticaSql` | `kineticaSql(authedReq, sql, { route: "POST /api/quantile", op: "QUANTILE" })` | WIRED | Line 898 (verbatim call shape per plan lock) |
| `wmsUrlBuilder.ts` classbreak branch | `cbConfig.ts coalesceCbConfig` | `coalesceCbConfig(layerJsonFields.cb_config)` in Lane C block | WIRED | Line 389 of wmsUrlBuilder.ts |
| `MapChartRenderer.tsx` | `wmsUrlBuilder.ts buildWmsParams` | 5th arg `{ cb_config: layer.cb_config, track_config: layer.track_config }` | WIRED | Lines 1001, 1201 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHEMA-V17-01 | 38-01 | `dashboard_layers` gains nullable `cb_config` + `track_config` TEXT columns via PRAGMA-guarded idempotent ALTER | SATISFIED | `db.ts` — CREATE TABLE lines 106-107; ALTER guards lines 201-206; PRAGMA queried once (count=1 confirmed) |
| SCHEMA-V17-02 | 38-01 | Server `DashboardLayer` type + `mapDashboardLayer` + `updateDashboardLayer` + PATCH route + frontend `DashboardLayerDto` all extended; AUTH_MODE-agnostic supertest covers both modes | SATISFIED | All 6 touch-points confirmed; PATCH spec 5/5 pass under both modes |
| SCHEMA-V17-03 | 38-02 | `wmsUrlBuilder.ts` classbreak branch emits Lane C param set (CB_ATTR, CB_VALS, POINTCOLORS, POINTSIZES, POINTSHAPES, SHAPELINEWIDTHS, SHAPELINECOLORS, SHAPEFILLCOLORS) per spike-locked params | SATISFIED | `STYLES_BY_MODE.classbreak = "cb_raster"` (line 185); 19 Lane C param name references confirmed; spec 78/78 pass |
| SCHEMA-V17-04 | 38-02 | `wmsUrlBuilder.ts` track block emits `DOTRACKS=TRUE` + TRACK_* params; backward-compat: `trackConfig===undefined` produces identical URLs | SATISFIED | Track block at lines 439-456; `enabled===false` and heatmap-mode gates confirmed; null-track-config backward-compat spec passes |
| SCHEMA-V17-05 | 38-02 | CB color bug fixed — `normalizeAARRGGBB` replaces `b.color.toUpperCase()` (6-char RRGGBB → 8-char AARRGGBB); regression spec locks format | SATISFIED | `normalizeAARRGGBB(b.color, "FF000000")` in Lane C block (line 393); 8-char regression spec passes (2 cases) |
| SCHEMA-V17-06 | 38-03 | `POST /api/quantile` accepts `{schema,table,column,n}`, returns `{breaks:number[]}` using locked NTILE template; pure `lib/quantileSql.ts`; AUTH_MODE-agnostic supertest | SATISFIED | Route at index.ts:858; `buildQuantileSql` + `parseQuantileResponse` exports confirmed; quantile spec 17/17 pass; `quantileFn` client helper in client.ts:1074 |
| SCHEMA-V17-07 | 38-01 | `lib/trackDetect.ts isTrackTable()` + `lib/cbConfig.ts` (EMPTY_CB_CONFIG, coalesceCbConfig, type-narrowing helpers); each has companion unit spec | SATISFIED | trackDetect spec 9/9 pass; cbConfig spec 15/15 pass; 24 total |

All 7 requirement IDs satisfied. No orphaned requirements.

---

## Hard-Cutover Lock Compliance

| Check | Expected | Result |
|-------|----------|--------|
| `grep -n "config\.classbreaks\|config\.cbColumn" wmsUrlBuilder.ts` | ZERO matches | ZERO — confirmed |
| `grep -n "CB_BREAK_POINT_\|CB_POINTCOLOR_\|CB_COLUMN_NAME\|CB_POINTCOLORS" wmsUrlBuilder.ts` | ZERO matches (Lane A + Lane B prefix naming absent) | ZERO — confirmed |
| `grep -c "POINTCOLORS\|POINTSIZES\|POINTSHAPES\|SHAPELINEWIDTHS\|SHAPELINECOLORS\|SHAPEFILLCOLORS" wmsUrlBuilder.ts` | > 0 (Lane C names present) | 19 — confirmed |

---

## TD-V16-TEST-ISOLATION Compliance

| Spec File | AUTH_MODE References | Both Blocks Present | vi.hoisted Present | Result |
|-----------|---------------------|---------------------|--------------------|-|
| `routes.dashboard-layers-patch.spec.ts` | 8 occurrences | AUTH_MODE=password (line 136) + AUTH_MODE=oidc (line 263) | Line 23 | COMPLIANT |
| `routes.quantile.spec.ts` | 6 occurrences | AUTH_MODE=password (line 129) + AUTH_MODE=oidc (line 287) | Line 24 | COMPLIANT |
| `lib.quantileSql.spec.ts` | N/A — pure unit spec; no Express boot | No AUTH_MODE needed | N/A | COMPLIANT |

No new TD-V16-TEST-ISOLATION regressions introduced.

---

## Test Suite Summary

| Spec File | Tests | Result |
|-----------|-------|--------|
| `server/tests/routes.dashboard-layers-patch.spec.ts` | 5/5 | ALL PASS |
| `server/tests/routes.quantile.spec.ts` | 17/17 | ALL PASS |
| `server/tests/lib.quantileSql.spec.ts` | 11/11 | ALL PASS |
| `src/lib/cbConfig.spec.ts` | 15/15 | ALL PASS |
| `src/lib/trackDetect.spec.ts` | 9/9 | ALL PASS |
| `src/lib/wmsUrlBuilder.spec.ts` | 78/78 | ALL PASS |
| Server `tsc --noEmit` | — | CLEAN |
| Frontend `tsc --noEmit` | — | CLEAN |

**Total new tests from Phase 38: 57 (5 + 17 + 11 + 15 + 9 = 57 from new files; 78 in wmsUrlBuilder covering both existing and new Lane C specs)**

---

## Downstream Unblock Confirmation

| Phase | Prerequisite | Status |
|-------|-------------|--------|
| **Phase 39** (Classbreak Form UI + Auto-suggest) | Form can write `cb_config` JSON via `PATCH` + wmsUrlBuilder emits Lane C cb_raster params; `POST /api/quantile` live; `quantileFn(args, signal)` in client.ts | UNBLOCKED |
| **Phase 40** (Track Sub-Section UI) | `isTrackTable(columns)` exported from `trackDetect.ts`; `track_config` round-trips via PATCH + GET; `wmsUrlBuilder` emits `DOTRACKS + TRACK_*` when `trackConfig.enabled === true` | UNBLOCKED |
| **Phase 41** (LayersLegendPanel) | `coalesceCbConfig(layer.cb_config)` available from `cbConfig.ts`; `CbBreak.label` field in type; `isCbConfigConfigured` gate available | UNBLOCKED |
| **Phase 42** (End-to-End Verification) | All v1.7 foundation artifacts exist, spec-covered, and tsc-clean | UNBLOCKED |

---

## Anti-Patterns Found

None. No TODO/FIXME/PLACEHOLDER comments detected in Phase 38 artifacts. No empty implementations. No stub return patterns.

---

## Human Verification Required

None. Phase 38 is entirely server-side and pure-module work with no user-visible UI. All success criteria are programmatically verifiable and confirmed passing.

---

_Verified: 2026-05-19T03:15:00Z_
_Verifier: Claude (gsd-verifier)_
