---
phase: 38-schema-wms-engine-foundation
plan: "01"
subsystem: server-schema, server-crud, server-routes, frontend-lib
tags: [schema-migration, dto-crud, patch-route, helper-modules, vitest, auth-mode-agnostic]
dependency_graph:
  requires: []
  provides:
    - "dashboard_layers.cb_config + track_config SQLite columns (PRAGMA-guarded ALTER + CREATE TABLE)"
    - "DashboardLayer server type (cb_config + track_config nullable string fields)"
    - "mapDashboardLayer projection (cb_config + track_config row reads)"
    - "updateDashboardLayer 'key' in attrs discriminant (cb_config + track_config)"
    - "PATCH /api/dashboards/:id/layers/:layerId accepts cb_config + track_config"
    - "kinetica_bi/src/lib/cbConfig.ts (CbBreak, CbConfig, EMPTY_CB_CONFIG, coalesceCbConfig, isCbConfigConfigured, isNumericValsType, isCategoricalValsType)"
    - "kinetica_bi/src/lib/trackDetect.ts (TrackColumns, isTrackTable strict 4-name matcher)"
  affects:
    - "Phase 38-02: wmsUrlBuilder reads coalesceCbConfig(layer.cb_config) from cb_config column"
    - "Phase 39: CB form UI PATCHes cb_config; reads cbConfig helpers"
    - "Phase 40: Track form UI PATCHes track_config; reads isTrackTable"
    - "Phase 41: LayersLegendPanel reads cb_config.breaks[].label via cbConfig helpers"
tech_stack:
  added: []
  patterns:
    - "PRAGMA-guarded idempotent ALTER (4th reuse of v1.0→v1.1 sessions pattern)"
    - "'key' in attrs discriminant for explicit-null-clears vs omit-preserves CRUD"
    - "AUTH_MODE-agnostic supertest (vi.hoisted + vi.stubEnv per-describe-block)"
    - "Pure helper module + companion vitest spec (mirrors mapInfoConfig.ts + spatialTargets.ts)"
key_files:
  created:
    - kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts
    - kinetica_bi/src/lib/cbConfig.ts
    - kinetica_bi/src/lib/cbConfig.spec.ts
    - kinetica_bi/src/lib/trackDetect.ts
    - kinetica_bi/src/lib/trackDetect.spec.ts
  modified:
    - kinetica_bi/server/src/db.ts
    - kinetica_bi/server/src/types.ts
    - kinetica_bi/server/src/index.ts
decisions:
  - "Migration block appended AFTER dynamic_view_id guard, BEFORE return instance (chronological order per 38-CONTEXT.md)"
  - "DashboardLayerDto frontend extension intentionally deferred to Plan 38-02 Task 3 (paired with wmsUrlBuilder rewrite)"
  - "coalesceCbConfig returns EMPTY_CB_CONFIG for both null AND any JSON lacking 'attr'+'breaks' keys (shape validation at parse boundary)"
  - "trackDetect strict 4-name match only (TRACKID/x/y/TIMESTAMP): no aliases, no column type checks"
  - "PATCH route validation intentionally absent per 38-CONTEXT.md trust model (frontend validates; Kinetica accepts permissive shapes)"
metrics:
  duration: "~6 minutes (328 seconds)"
  completed: "2026-05-19"
  tasks: 3
  files: 8
---

# Phase 38 Plan 01: Schema DTO Helpers Summary

**One-liner:** PRAGMA-guarded ALTER migration adding cb_config + track_config JSON TEXT columns to dashboard_layers, end-to-end DashboardLayer type + projection + CRUD + PATCH route extension, plus lib/cbConfig.ts + lib/trackDetect.ts pure helper modules with 29 new green tests.

## What Was Built

### Task 1 — Schema migration + DashboardLayer DTO + updateDashboardLayer CRUD

**Files modified:** `kinetica_bi/server/src/db.ts`, `kinetica_bi/server/src/types.ts`

**Migration block placement:** The two new ALTER statements were appended immediately after the existing `if (!layerColNames.has("dynamic_view_id"))` guard (line ~187), before `return instance;`, for chronological ordering matching the v1.4 Phase 19 + v1.6 Phase 35 precedents. This reuses the same `layerColNames` Set from the single `PRAGMA table_info(dashboard_layers)` query (PRAGMA count stays at 1).

**CREATE TABLE block:** `cb_config TEXT,` and `track_config TEXT,` were inserted between `dynamic_view_id INTEGER,` and `created_at TEXT NOT NULL DEFAULT (datetime('now'))` in the existing `dashboard_layers` DDL — fresh installs get both columns; existing deployments get them via the PRAGMA-guarded ALTER.

**DashboardLayer type extension:** Two fields appended to `types.ts` below `dynamic_view_id: number | null;` with the established v1.7 comment style explaining the raw JSON wire format and backward-compat null handling.

**mapDashboardLayer projection:** `cb_config: row.cb_config ?? null, track_config: row.track_config ?? null` appended after the `dynamic_view_id` line — same `?? null` pattern as `info_columns` and `dynamic_view_id`.

**updateDashboardLayer CRUD:** Pick<> tuple extended with `| "cb_config"` and `| "track_config"`. UPDATE SQL now includes `cb_config = ?, track_config = ?` between `dynamic_view_id = ?` and `updated_at = ...`. Run args use the `"key" in attrs ? attrs.key : existing.key` discriminant — explicit null CLEARS, omitted key PRESERVES (same as info_* and dynamic_view_id).

### Task 2 — PATCH route extension + AUTH_MODE-agnostic supertest

**Files modified/created:** `kinetica_bi/server/src/index.ts`, `kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts`

**PATCH route body Pick<>** extended with `| "cb_config"` and `| "track_config"` after `| "dynamic_view_id"`. Comment block updated to mention SCHEMA-V17-02.

**Supertest mocking strategy:** Mirrors `routes.filter-materialize.spec.ts` exactly:
- `vi.hoisted()` block defines the `openid-client` mock (Issuer constructor + static `discover` + OPError + RPError) so AUTH_MODE=oidc boot does not network-call.
- `vi.mock("openid-client", ...)` wires the hoisted mock.
- `vi.stubGlobal("fetch", ...)` in each `beforeEach` stubs Kinetica fetch defensively (the PATCH route does not hit Kinetica, but boot-time requireConfig may probe).
- Two `describe` blocks: `AUTH_MODE=password` (4 tests) and `AUTH_MODE=oidc` (1 smoke test), each with `vi.stubEnv("AUTH_MODE", ...)` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach`.
- `cleanFixtures()` runs in `beforeEach` to prevent cross-test state bleeding.

**Test coverage (5 cases):**
1. PATCH cb_config → response.cb_config = JSON string, track_config = null; GET round-trip confirms
2. PATCH track_config → response.track_config = JSON string, cb_config = null; GET round-trip confirms
3. PATCH cb_config: null → response.cb_config = null (explicit-null-clears via "key" in attrs discriminant); GET round-trip confirms
4. PATCH under AUTH_MODE=oidc (seedOidcSession) → same cb_config round-trip behavior
5. PATCH position only → both cb_config + track_config preserved (key-omitted-preserves); GET round-trip confirms

### Task 3 — lib/cbConfig.ts + lib/trackDetect.ts helper modules + specs

**Files created:** `kinetica_bi/src/lib/cbConfig.ts`, `kinetica_bi/src/lib/cbConfig.spec.ts`, `kinetica_bi/src/lib/trackDetect.ts`, `kinetica_bi/src/lib/trackDetect.spec.ts`

#### lib/cbConfig.ts API (locked contract — Phase 38-02 + 39 + 40 + 41 will import these names)

```typescript
export type CbBreak = {
  value: string | number;    // numeric or categorical break value; supports "<other>" verbatim
  color: string;             // 8-char AARRGGBB (normalizeAARRGGBB in Phase 38-02 wmsUrlBuilder)
  label?: string;            // client-side only, NOT emitted in WMS URL
  pointSize?: number;        // Lane C POINTSIZES
  pointShape?: string;       // Lane C POINTSHAPES
  shapeLineWidth?: number;   // Lane C SHAPELINEWIDTHS
  shapeLineColor?: string;   // Lane C SHAPELINECOLORS (8-char AARRGGBB)
  shapeFillColor?: string;   // Lane C SHAPEFILLCOLORS (8-char AARRGGBB)
};

export type CbConfig = {
  attr: string;                          // empty string = "not yet configured"
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];                     // empty array = "not yet configured"
  includeOtherBucket?: boolean;          // Phase 39 form toggle; wmsUrlBuilder does NOT auto-inject
};

export const EMPTY_CB_CONFIG: CbConfig;     // { attr: "", valsType: "numeric", breaks: [] }
export function coalesceCbConfig(raw: string | null): CbConfig;  // null/parse-fail → EMPTY_CB_CONFIG
export function isCbConfigConfigured(cfg: CbConfig): boolean;    // attr non-empty + breaks.length > 0
export function isNumericValsType(cfg: CbConfig): boolean;       // valsType === "numeric"
export function isCategoricalValsType(cfg: CbConfig): boolean;   // valsType === "categorical"
```

#### lib/trackDetect.ts API (locked contract — Phase 40 form UI is first consumer)

```typescript
export type TrackColumns = {
  trackIdCol: string;   // matched TRACKID column preserving original casing
  xCol: string;         // matched x column preserving original casing
  yCol: string;         // matched y column preserving original casing
  orderCol: string;     // matched TIMESTAMP column preserving original casing
};

export function isTrackTable(columns: { name: string }[]): TrackColumns | null;
// Strict 4-name case-insensitive: TRACKID, x, y, TIMESTAMP. NO aliases.
// Returns null if any of the 4 are absent. Extra columns silently ignored.
```

**Test counts (29 new green tests total):**
- `routes.dashboard-layers-patch.spec.ts`: 5 tests (4 password-mode + 1 oidc smoke)
- `cbConfig.spec.ts`: 11 tests (3 EMPTY_CB_CONFIG + 5 coalesceCbConfig + 3 isCbConfigConfigured + 2 isNumericValsType + 2 isCategoricalValsType — 2 extra edge cases beyond spec minimum, both passing)
- `trackDetect.spec.ts`: 9 tests (8 specified behavior cases + 1 alias-rejection case)

## Decisions Made

1. **Migration block placement:** Appended after `dynamic_view_id` guard, before `return instance` — chronological order, single PRAGMA query reuse (count stays at 1).
2. **DashboardLayerDto deferred:** Frontend `client.ts` extension intentionally not touched in this plan. Plan 38-02 Task 3 will add `cb_config: string | null` and `track_config: string | null` to `DashboardLayerDto` paired with the wmsUrlBuilder rewrite.
3. **coalesceCbConfig shape validation:** Returns EMPTY_CB_CONFIG when parsed JSON lacks both `attr` AND `breaks` keys — guards against partially malformed JSON surviving to the wmsUrlBuilder consumer.
4. **No Zod:** Pure TypeScript types + JSON.parse boundary per 38-CONTEXT.md. Zod is not in the codebase.
5. **trackDetect strict 4-name match:** No aliases (`track_id`, `lat`, `lon`, `time`, `ts`). Operator override (Phase 40 TRACK-V17-02 checkbox) is the escape hatch. Documented in spec.

## Success Criteria Verification

- [x] SC1: Migration idempotency — `!layerColNames.has("cb_config")` and `!layerColNames.has("track_config")` guards prevent double-ALTER. Single `PRAGMA table_info(dashboard_layers)` query at line ~165 (count verified = 1).
- [x] SC4: PATCH round-trip server-side — Test 1 + Test 2 + GET round-trip confirm cb_config and track_config values persist and are returned unchanged on subsequent GET.
- [x] SC5: isTrackTable correctness — Test cases for all 4 fields present (case-insensitive), each missing field (returns null), empty array (null), extras ignored (matched), and alias rejection (null).
- [x] Server tsc: clean
- [x] Frontend tsc: clean
- [x] AUTH_MODE-agnostic: routes.dashboard-layers-patch.spec.ts has BOTH AUTH_MODE=password AND AUTH_MODE=oidc describe blocks; passes under both.

## Deviations from Plan

None — plan executed exactly as written. All task acceptance criteria met on first attempt.

## Self-Check

Files exist:
- [x] kinetica_bi/server/src/db.ts (modified)
- [x] kinetica_bi/server/src/types.ts (modified)
- [x] kinetica_bi/server/src/index.ts (modified)
- [x] kinetica_bi/src/lib/cbConfig.ts (created)
- [x] kinetica_bi/src/lib/cbConfig.spec.ts (created)
- [x] kinetica_bi/src/lib/trackDetect.ts (created)
- [x] kinetica_bi/src/lib/trackDetect.spec.ts (created)
- [x] kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts (created)

Commits exist:
- [x] 220b107 feat(38-01): schema migration + DashboardLayer type + mapDashboardLayer + updateDashboardLayer
- [x] 52449a3 feat(38-01): PATCH route extension + AUTH_MODE-agnostic supertest for cb_config + track_config
- [x] 286c0a9 feat(38-01): lib/cbConfig.ts + lib/trackDetect.ts helper modules + companion vitest specs

## Self-Check: PASSED
