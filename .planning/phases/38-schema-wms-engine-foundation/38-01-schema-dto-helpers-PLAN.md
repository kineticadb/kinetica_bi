---
phase: 38-schema-wms-engine-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/db.ts
  - kinetica_bi/server/src/types.ts
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/src/lib/cbConfig.ts
  - kinetica_bi/src/lib/cbConfig.spec.ts
  - kinetica_bi/src/lib/trackDetect.ts
  - kinetica_bi/src/lib/trackDetect.spec.ts
  - kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts
autonomous: true
requirements:
  - SCHEMA-V17-01
  - SCHEMA-V17-02
  - SCHEMA-V17-07
gap_closure: false

must_haves:
  truths:
    - "SC1: A running server restarts cleanly against an existing v1.6 SQLite DB — the PRAGMA-guarded cb_config + track_config ALTER block is idempotent (second restart produces no error)."
    - "SC4: A PATCH request with cb_config or track_config JSON round-trips through the server and is returned unchanged on the subsequent GET — server type + projection + CRUD + PATCH route + frontend DTO extension wired end-to-end."
    - "SC5: lib/trackDetect.ts isTrackTable correctly matches a TRACKID + x + y + TIMESTAMP column set (case-insensitive) and rejects any set missing any of the four fields."
    - "lib/cbConfig.ts coalesceCbConfig converts null/parse-fail raw JSON to EMPTY_CB_CONFIG; isCbConfigConfigured/isNumericValsType/isCategoricalValsType narrow correctly."
    - "Server vitest for the extended PATCH route passes under AUTH_MODE=password AND AUTH_MODE=oidc (single AUTH_MODE-agnostic spec; no TD-V16-TEST-ISOLATION regression)."
  artifacts:
    - path: "kinetica_bi/server/src/db.ts"
      provides: "CREATE TABLE block + PRAGMA-guarded ALTER block extended with cb_config + track_config TEXT columns; mapDashboardLayer projection extended; updateDashboardLayer CRUD extended with 'key' in attrs discriminant"
      contains: "ALTER TABLE dashboard_layers ADD COLUMN cb_config TEXT"
    - path: "kinetica_bi/server/src/types.ts"
      provides: "DashboardLayer type carries cb_config + track_config as nullable raw JSON strings"
      contains: "cb_config: string | null"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "PATCH /api/dashboards/:id/layers/:layerId accepts cb_config + track_config in body Pick<>"
      contains: '"cb_config"'
    - path: "kinetica_bi/src/lib/cbConfig.ts"
      provides: "Pure helper module: CbBreak + CbConfig types, EMPTY_CB_CONFIG, coalesceCbConfig, isCbConfigConfigured, isNumericValsType, isCategoricalValsType"
      contains: "EMPTY_CB_CONFIG"
    - path: "kinetica_bi/src/lib/cbConfig.spec.ts"
      provides: "vitest unit coverage for cbConfig helpers (positive + negative inputs)"
      contains: "describe"
    - path: "kinetica_bi/src/lib/trackDetect.ts"
      provides: "Pure helper module: TrackColumns type + isTrackTable(columns) strict 4-name case-insensitive matcher"
      contains: "isTrackTable"
    - path: "kinetica_bi/src/lib/trackDetect.spec.ts"
      provides: "vitest unit coverage for trackDetect (7 cases including case-insensitive, missing-each-field, empty, extras-ignored)"
      contains: "isTrackTable"
    - path: "kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts"
      provides: "AUTH_MODE-agnostic supertest covering PATCH round-trip of cb_config + track_config"
      contains: "AUTH_MODE"
  key_links:
    - from: "kinetica_bi/server/src/db.ts CREATE TABLE block (line ~83-105)"
      to: "kinetica_bi/server/src/db.ts PRAGMA-guarded ALTER block (line ~159-187)"
      via: "Both extended with cb_config + track_config columns"
      pattern: "cb_config TEXT"
    - from: "kinetica_bi/server/src/types.ts DashboardLayer (line ~61)"
      to: "kinetica_bi/server/src/db.ts mapDashboardLayer (line ~213-230)"
      via: "Projection reads row.cb_config + row.track_config and surfaces null"
      pattern: "cb_config: row.cb_config"
    - from: "kinetica_bi/server/src/db.ts updateDashboardLayer (line ~490-525)"
      to: "kinetica_bi/server/src/index.ts PATCH route (line ~583-602)"
      via: "Body Pick<> includes cb_config + track_config; CRUD UPDATE SET extends with 'key' in attrs discriminant"
      pattern: '"cb_config" in attrs'

key_links:
  - ".planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md (locked decisions — STYLES always cb_raster, hard cutover, helper module shapes, schema migration pattern, DTO discriminant pattern)"
  - ".planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md §Decision (no direct emission from this plan — but lib/cbConfig.ts CbBreak/CbConfig type shape must exactly match what Phase 38-02 wmsUrlBuilder will consume)"
  - "kinetica_bi/server/src/db.ts:83-105 (CREATE TABLE dashboard_layers — extend with cb_config TEXT + track_config TEXT)"
  - "kinetica_bi/server/src/db.ts:159-187 (PRAGMA-guarded ALTER block for v1.4 info_* + v1.6 dynamic_view_id — extend with two new ALTER statements)"
  - "kinetica_bi/server/src/db.ts:213-230 (mapDashboardLayer projection — add cb_config + track_config row reads)"
  - "kinetica_bi/server/src/db.ts:490-525 (updateDashboardLayer CRUD — extend Pick<> and UPDATE SET with cb_config + track_config; use 'key' in attrs discriminant)"
  - "kinetica_bi/server/src/types.ts:61 (DashboardLayer — add cb_config: string | null + track_config: string | null)"
  - "kinetica_bi/server/src/index.ts:583-602 (PATCH route — extend body Pick<> with cb_config + track_config)"
  - "kinetica_bi/src/lib/mapInfoConfig.ts (PATTERN to mirror — DEFAULT_* + getter helpers + pure helper module shape; lib/cbConfig.ts mirrors this)"
  - "kinetica_bi/src/lib/spatialTargets.ts (PATTERN for helper with type narrowing + EMPTY constant)"
  - "kinetica_bi/server/tests/routes.filter-materialize.spec.ts (PATTERN for AUTH_MODE-agnostic supertest with hoisted openid-client mock + describe blocks for both AUTH_MODE values)"
  - "kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts (v1.6 precedent for PATCH-route supertest in both AUTH_MODEs)"
---

<objective>
Land the server-side foundation for v1.7 classbreak + track persistence: PRAGMA-guarded ALTER migration adding `cb_config` + `track_config` JSON TEXT columns to `dashboard_layers`, end-to-end DTO + CRUD + PATCH wiring, and the two pure helper modules (`lib/cbConfig.ts` + `lib/trackDetect.ts`) with companion vitest specs. Nothing user-visible ships from this plan — it is the table-and-types foundation Phase 38-02 (wmsUrlBuilder rewrite) + Phase 38-03 (/api/quantile) + Phase 39/40 (form UI) read against.

Purpose: SCHEMA-V17-01 + SCHEMA-V17-02 + SCHEMA-V17-07. Mirrors v1.4 Phase 19 + v1.6 Phase 35 PRAGMA + CRUD precedent exactly (4th reuse of the locked pattern).

Output: schema migrated, DashboardLayer type + projection + CRUD + PATCH route extended end-to-end, two helper modules + specs + one AUTH_MODE-agnostic supertest landed.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md
@.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md

<interfaces>
<!-- Key shapes the executor needs to land verbatim. Extracted from 38-CONTEXT.md decisions block. -->
<!-- These are CONTRACTS — Phase 38-02 + 39 + 40 + 41 will import these names. Do not rename. -->

From `kinetica_bi/src/lib/cbConfig.ts` (NEW FILE — verbatim shape locked by 38-CONTEXT.md):
```typescript
export type CbBreak = {
  value: string | number;
  color: string;          // 8-char AARRGGBB (Phase 38-02 emits, Phase 39 form supplies)
  label?: string;
  pointSize?: number;
  pointShape?: string;
  shapeLineWidth?: number;
  shapeLineColor?: string;
  shapeFillColor?: string;
};

export type CbConfig = {
  attr: string;
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];
  includeOtherBucket?: boolean;
};

export const EMPTY_CB_CONFIG: CbConfig = {
  attr: "",
  valsType: "numeric",
  breaks: [],
};

export function coalesceCbConfig(raw: string | null): CbConfig;       // null/parse-fail → EMPTY_CB_CONFIG
export function isCbConfigConfigured(cfg: CbConfig): boolean;          // attr non-empty + breaks.length > 0
export function isNumericValsType(cfg: CbConfig): boolean;             // narrow on cfg.valsType === "numeric"
export function isCategoricalValsType(cfg: CbConfig): boolean;         // narrow on cfg.valsType === "categorical"
```

From `kinetica_bi/src/lib/trackDetect.ts` (NEW FILE — verbatim shape locked by 38-CONTEXT.md):
```typescript
export type TrackColumns = {
  trackIdCol: string;  // matched column name preserving original casing
  xCol: string;
  yCol: string;
  orderCol: string;    // TIMESTAMP-named column, preserving original casing
};

// Strict 4 names case-insensitive: TRACKID + x + y + TIMESTAMP. Returns matched
// column names (preserving original casing from columns list) when all 4 present;
// otherwise returns null. NO aliases (no track_id / lat / lon / time / ts).
// NO column type checks. Operator override (Phase 40 TRACK-V17-02) is the escape
// hatch for non-standard schemas.
export function isTrackTable(columns: { name: string }[]): TrackColumns | null;
```

Server `DashboardLayer` type extension (kinetica_bi/server/src/types.ts:61 — APPEND below dynamic_view_id):
```typescript
// v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns.
// Raw JSON strings on the wire — deserialized at the frontend boundary via
// kinetica_bi/src/lib/cbConfig.ts (cb_config) and Phase 40 form code (track_config).
// NULL = "not yet configured"; backward-compat readers default to EMPTY_CB_CONFIG /
// empty track config. PRAGMA-guarded ALTER (db.ts:159-187 block) supplies these as
// TEXT NULL — existing pre-v1.7 rows surface as null and render as raster.
cb_config: string | null;
track_config: string | null;
```

Server `updateDashboardLayer` Pick<> + UPDATE SET extension (kinetica_bi/server/src/db.ts:490-525):
```typescript
// Pick<> additions (after dynamic_view_id):
| "cb_config"
| "track_config"

// UPDATE SQL — append before WHERE clause:
... cb_config = ?, track_config = ?, updated_at = ...

// Run args — append after dynamic_view_id 'key' in attrs:
"cb_config" in attrs ? attrs.cb_config : existing.cb_config,
"track_config" in attrs ? attrs.track_config : existing.track_config,
```

PATCH route body Pick<> extension (kinetica_bi/server/src/index.ts:590-598):
```typescript
const body = req.body as Partial<Pick<DashboardLayer,
  | "table_id"
  | "position"
  | "config"
  | "info_enabled"
  | "info_columns"
  | "info_template"
  | "dynamic_view_id"
  | "cb_config"
  | "track_config"
>>;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Schema migration — extend CREATE TABLE + PRAGMA-guarded ALTER block + mapDashboardLayer projection + updateDashboardLayer CRUD + DashboardLayer type</name>
  <files>kinetica_bi/server/src/types.ts, kinetica_bi/server/src/db.ts</files>
  <read_first>
    - kinetica_bi/server/src/types.ts:61-85 (current DashboardLayer type — note the dynamic_view_id field added in v1.6 Phase 35; append two new fields below it with the same comment style)
    - kinetica_bi/server/src/db.ts:80-105 (current CREATE TABLE block — note the info_enabled / info_columns / info_template / dynamic_view_id lines; append cb_config TEXT + track_config TEXT in the same chronological-order comment style)
    - kinetica_bi/server/src/db.ts:159-187 (PRAGMA-guarded ALTER block: info_* + dynamic_view_id; extend with two new !layerColNames.has() guards at the END of the block)
    - kinetica_bi/server/src/db.ts:213-230 (mapDashboardLayer — add cb_config + track_config row reads with `?? null` like info_columns / dynamic_view_id)
    - kinetica_bi/server/src/db.ts:490-525 (updateDashboardLayer Pick<> + UPDATE SQL + run args with `"key" in attrs ? attrs.key : existing.key` discriminant pattern — extend Pick<> by 2 entries, extend UPDATE SET by 2 columns, extend .run() arglist with 2 entries before `id`)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"Schema migration" + §"DTO + CRUD extension" (locked decisions: nullable TEXT, idempotent on second restart, 'key' in attrs not ?? not ||, append AFTER dynamic_view_id block for chronological order)
  </read_first>
  <behavior>
    - Test 1 (db.smoke or new db.cbTrackMigration.spec.ts): Booting createDb against a fresh path produces a dashboard_layers table whose PRAGMA table_info includes both cb_config and track_config as TEXT NULL columns.
    - Test 2 (db.cbTrackMigration.spec.ts): Booting createDb a SECOND time against the SAME db file produces no error and the two columns remain present exactly once (idempotency lock — PRAGMA guard prevents double-ALTER).
    - Test 3: After insertDashboardLayer + updateDashboardLayer({ cb_config: '{"attr":"fare","valsType":"numeric","breaks":[]}' , track_config: null }), getDashboardLayer returns cb_config === '{"attr":"fare","valsType":"numeric","breaks":[]}' AND track_config === null.
    - Test 4: After update with explicit { cb_config: null }, getDashboardLayer returns cb_config === null (explicit-null-clears via "key" in attrs discriminant — NOT ?? which would silently preserve existing).
    - Test 5: After update WITHOUT cb_config key in attrs, existing cb_config value is preserved (key-omitted-preserves via "key" in attrs discriminant).
  </behavior>
  <action>
    Edit `kinetica_bi/server/src/types.ts` — locate the DashboardLayer block at line 61. AFTER the closing of the `dynamic_view_id: number | null;` comment block (which currently ends near line 82), and BEFORE `created_at: string;`, APPEND these literal lines:

    ```typescript
      // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns. Raw
      // JSON strings on the wire — deserialized at the frontend boundary via
      // kinetica_bi/src/lib/cbConfig.ts (cb_config) and Phase 40 form code (track_config).
      // NULL = "not yet configured"; backward-compat readers default to EMPTY_CB_CONFIG /
      // empty track config. PRAGMA-guarded ALTER (db.ts:159-187 block) supplies these as
      // TEXT NULL — existing pre-v1.7 rows surface as null and render as raster.
      cb_config: string | null;
      track_config: string | null;
    ```

    Edit `kinetica_bi/server/src/db.ts`:

    (A) CREATE TABLE block (line ~83-105) — locate the `dynamic_view_id INTEGER,` line. AFTER that line and BEFORE the `created_at TEXT NOT NULL DEFAULT (datetime('now')),` line, APPEND:

    ```sql
        -- v1.7 Phase 38 (SCHEMA-V17-01): classbreak + track config JSON columns. Both nullable
        -- TEXT (NULL = "not yet configured"). The PRAGMA-guarded ALTER block below migrates
        -- existing v1.4/v1.5/v1.6 deployments; this CREATE TABLE block covers fresh installs.
        cb_config TEXT,
        track_config TEXT,
    ```

    (B) PRAGMA-guarded ALTER block (line ~159-187) — locate the closing `}` of the `if (!layerColNames.has("dynamic_view_id"))` guard near line 187. AFTER that closing brace and BEFORE `return instance;`, APPEND:

    ```typescript
      // v1.6 → v1.7 migration (SCHEMA-V17-01): add cb_config + track_config JSON columns to
      // existing dashboard_layers tables that predate Phase 38. Mirrors v1.4 info_* + v1.6
      // dynamic_view_id PRAGMA-guarded ALTER pattern above. Both nullable TEXT — NULL signals
      // "not yet configured"; backward-compat readers (wmsUrlBuilder Phase 38-02 cb_raster
      // branch) coalesce null → EMPTY_CB_CONFIG via lib/cbConfig.ts.
      // Acceptance: second server restart against a v1.7 database is a no-op (PRAGMA guard
      // prevents double-ALTER; matches the established info_* / dynamic_view_id idempotency).
      if (!layerColNames.has("cb_config")) {
        instance.exec("ALTER TABLE dashboard_layers ADD COLUMN cb_config TEXT");
      }
      if (!layerColNames.has("track_config")) {
        instance.exec("ALTER TABLE dashboard_layers ADD COLUMN track_config TEXT");
      }
    ```

    (C) mapDashboardLayer projection (line ~213-230) — locate the `dynamic_view_id: row.dynamic_view_id ?? null,` line. AFTER that line and BEFORE `created_at: row.created_at,`, APPEND:

    ```typescript
      // v1.7 Phase 38 (SCHEMA-V17-01/02): raw JSON strings, NULL surfaces as JS null.
      // Phase 38-02 wmsUrlBuilder reads cb_config via coalesceCbConfig(layer.cb_config);
      // Phase 40 form code reads track_config via inline JSON.parse.
      cb_config: row.cb_config ?? null,
      track_config: row.track_config ?? null,
    ```

    (D) updateDashboardLayer (line ~490-525):
      - Extend the Pick<> tuple — locate `| "dynamic_view_id"` and APPEND two new entries on new lines after it:
        ```typescript
            | "cb_config"
            | "track_config"
        ```
      - Extend the UPDATE SQL — locate the `"UPDATE dashboard_layers SET table_id = ?, ..., dynamic_view_id = ?, updated_at = ..."` template literal. CHANGE the comma-separated SET list to insert `cb_config = ?, track_config = ?` BETWEEN `dynamic_view_id = ?` and `updated_at = ...`, so the new SQL reads (in full):
        ```typescript
        "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, dynamic_view_id = ?, cb_config = ?, track_config = ?, updated_at = datetime('now') WHERE id = ?"
        ```
      - Extend the .run() arglist — locate the `"dynamic_view_id" in attrs ? attrs.dynamic_view_id : existing.dynamic_view_id,` line. AFTER that line and BEFORE the trailing `id` arg, APPEND:
        ```typescript
            // v1.7 Phase 38 (SCHEMA-V17-02): cb_config + track_config use the same 'key' in attrs
            // discriminant as info_* and dynamic_view_id — explicit null CLEARS the field
            // (operator unbinding cb_config back to "not configured"); omitting the key PRESERVES.
            "cb_config" in attrs ? attrs.cb_config : existing.cb_config,
            "track_config" in attrs ? attrs.track_config : existing.track_config,
        ```
  </action>
  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; grep -q "ALTER TABLE dashboard_layers ADD COLUMN cb_config TEXT" src/db.ts &amp;&amp; grep -q "ALTER TABLE dashboard_layers ADD COLUMN track_config TEXT" src/db.ts &amp;&amp; grep -q "cb_config TEXT" src/db.ts &amp;&amp; grep -q "track_config TEXT" src/db.ts &amp;&amp; grep -q 'cb_config: row.cb_config' src/db.ts &amp;&amp; grep -q '"cb_config" in attrs' src/db.ts &amp;&amp; grep -q '"track_config" in attrs' src/db.ts &amp;&amp; grep -q 'cb_config: string | null' src/types.ts &amp;&amp; grep -q 'track_config: string | null' src/types.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "ALTER TABLE dashboard_layers ADD COLUMN cb_config TEXT" kinetica_bi/server/src/db.ts` returns 0 (ALTER block extended).
    - `grep -q "ALTER TABLE dashboard_layers ADD COLUMN track_config TEXT" kinetica_bi/server/src/db.ts` returns 0.
    - `grep -q "cb_config TEXT" kinetica_bi/server/src/db.ts` finds matches in BOTH the CREATE TABLE block AND the ALTER block (at least 2 matches expected).
    - `grep -q 'cb_config: row.cb_config' kinetica_bi/server/src/db.ts` returns 0 (mapDashboardLayer extended).
    - `grep -q '"cb_config" in attrs' kinetica_bi/server/src/db.ts` returns 0 (CRUD discriminant extended — NOT `??`).
    - `grep -q '"track_config" in attrs' kinetica_bi/server/src/db.ts` returns 0.
    - `grep -q 'cb_config: string | null' kinetica_bi/server/src/types.ts` returns 0 (DashboardLayer type extended).
    - `grep -q 'track_config: string | null' kinetica_bi/server/src/types.ts` returns 0.
    - `cd kinetica_bi/server &amp;&amp; npx tsc --noEmit` exits 0 (no type errors).
    - PRAGMA-guarded pattern preserved: the new ALTER block sits inside the existing `const layerColNames = new Set(...)` scope (does NOT re-query PRAGMA table_info — verify by counting `PRAGMA table_info(dashboard_layers)` occurrences in db.ts: should be 1, not 2).
  </acceptance_criteria>
  <done>
    Schema migration block emits the two new ALTER statements idempotently; DashboardLayer type carries the two nullable string fields; mapDashboardLayer projects them; updateDashboardLayer's `"key" in attrs` discriminant extends correctly so explicit null clears + omitted key preserves. Server tsc passes clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: PATCH route extension + AUTH_MODE-agnostic supertest for cb_config + track_config round-trip</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts:583-602 (current PATCH /api/dashboards/:id/layers/:layerId route — note the body destructure pattern with Pick<DashboardLayer, ...>; extend Pick<> with two new keys)
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts:1-150 (AUTH_MODE-agnostic supertest pattern: hoisted openid-client mock, buildTestApp, makeSessionCookie, seedOidcSession, two describe blocks `— AUTH_MODE=password` + `— AUTH_MODE=oidc`, vi.stubEnv("AUTH_MODE", ...))
    - kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts:1-100 (v1.6 precedent — same harness applied to a PATCH-style CRUD route; copy the seedFixture + cleanFixtures shape and adapt for dashboard_layers)
    - kinetica_bi/server/src/db.ts (after Task 1 lands) — createDashboardLayer signature; the test seeds a layer then PATCHes it
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"DTO + CRUD extension" + §"AUTH_MODE-agnostic supertests" (TD-V16-TEST-ISOLATION constraint — single spec, both modes)
  </read_first>
  <behavior>
    - Test 1 (AUTH_MODE=password): seed dashboard + layer with cb_config=null, track_config=null. PATCH with body {cb_config: '{"attr":"fare_amount","valsType":"numeric","breaks":[{"value":10,"color":"FF112233"}]}'}. Expect 200 + response.cb_config === the same JSON string verbatim + track_config === null (unchanged because key omitted).
    - Test 2 (AUTH_MODE=password): same seed. PATCH with {track_config: '{"enabled":true,"trackIdAttr":"TRACKID"}'}. Expect 200 + response.track_config === verbatim string + cb_config === null (unchanged).
    - Test 3 (AUTH_MODE=password): seed with cb_config = '{"attr":"x","valsType":"numeric","breaks":[]}'. PATCH with {cb_config: null}. Expect 200 + response.cb_config === null (explicit-null-clears via "key" in attrs discriminant).
    - Test 4 (AUTH_MODE=oidc): smoke test — same as Test 1 but with seedOidcSession() instead of makeSessionCookie(). Verifies the route works under OIDC credential type.
    - Test 5 (AUTH_MODE=password): PATCH with neither cb_config nor track_config in body (only existing keys like position). Both fields preserve their existing values.
  </behavior>
  <action>
    Edit `kinetica_bi/server/src/index.ts` PATCH route at line 583-602:

    Locate the `const body = req.body as Partial<Pick<DashboardLayer,` block. Extend the union by appending TWO new keys AFTER `| "dynamic_view_id"`:

    ```typescript
        const body = req.body as Partial<Pick<DashboardLayer,
          | "table_id"
          | "position"
          | "config"
          | "info_enabled"
          | "info_columns"
          | "info_template"
          | "dynamic_view_id"
          // v1.7 Phase 38 (SCHEMA-V17-02): classbreak + track config JSON pass-through.
          // Same trust model as info_* / dynamic_view_id — frontend constructs / validates
          // the JSON string; server forwards verbatim to updateDashboardLayer. Phase 39 form
          // UI does client-side Zod-free validation; Kinetica accepts permissive CB_VALS
          // shapes (Phase 37 OQ-4) so server validation is intentionally absent.
          | "cb_config"
          | "track_config"
        >>;
    ```

    Also update the comment block above the destructure to mention SCHEMA-V17-02 (one new line appended to the existing comment).

    Create `kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` — AUTH_MODE-agnostic supertest. Mirror the structure of `routes.filter-materialize.spec.ts` exactly:

    1. Hoisted `openid-client` mock block (verbatim copy from filter-materialize spec lines 24-70) so AUTH_MODE=oidc boot does not network-call.
    2. `import { buildTestApp } from "./helpers/app";` + `createSession` + `db, createDashboard, createTable, createDashboardLayer`.
    3. Local helpers: `seedFixture()` (creates dashboard + table + layer with cb_config=null + track_config=null), `makeSessionCookie()`, `seedOidcSession()`, `cleanFixtures()` (drops sessions + dashboards + dashboard_layers + tables).
    4. Two describe blocks: `describe("PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=password", ...)` and `describe("PATCH /api/dashboards/:id/layers/:layerId — AUTH_MODE=oidc", ...)`, each with `vi.stubEnv("AUTH_MODE", ...)` in beforeEach, `vi.unstubAllEnvs()` in afterEach, `cleanFixtures()` in beforeEach.
    5. Tests covering the 5 behaviors above. PATCH URL format: `/api/dashboards/${dashId}/layers/${layerId}`. Use `await agent.patch(url).set("Cookie", cookie).send(body).expect(200)` then assert on response.body.cb_config and response.body.track_config.
    6. For each PATCH test, also issue a subsequent `GET /api/dashboards/:id/layers` and confirm the returned layer's cb_config + track_config match what was PATCHed (round-trip lock).

    Stub global fetch defensively at the top of each test block (the PATCH route does not hit Kinetica, but requireConfig may probe at boot):

    ```typescript
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(successKineticaBody), { status: 200 })));
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; grep -q '"cb_config"' src/index.ts &amp;&amp; grep -q '"track_config"' src/index.ts &amp;&amp; test -f tests/routes.dashboard-layers-patch.spec.ts &amp;&amp; grep -q "AUTH_MODE=password" tests/routes.dashboard-layers-patch.spec.ts &amp;&amp; grep -q "AUTH_MODE=oidc" tests/routes.dashboard-layers-patch.spec.ts &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run tests/routes.dashboard-layers-patch.spec.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q '"cb_config"' kinetica_bi/server/src/index.ts` returns 0 (PATCH route body Pick<> extended).
    - `grep -q '"track_config"' kinetica_bi/server/src/index.ts` returns 0.
    - `test -f kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` returns 0 (spec file exists).
    - `grep -q "AUTH_MODE=password" kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` returns 0 AND `grep -q "AUTH_MODE=oidc" kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` returns 0 (BOTH describe blocks present — AUTH_MODE-agnostic per TD-V16-TEST-ISOLATION lock).
    - `grep -q "vi.hoisted" kinetica_bi/server/tests/routes.dashboard-layers-patch.spec.ts` returns 0 (openid-client mock present so AUTH_MODE=oidc boot does not network-call).
    - `cd kinetica_bi/server &amp;&amp; npx vitest run tests/routes.dashboard-layers-patch.spec.ts --reporter=verbose` reports 0 failures (all 5 behavior cases pass under password mode; smoke test passes under oidc mode).
    - `cd kinetica_bi/server &amp;&amp; npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>
    PATCH route accepts and round-trips cb_config + track_config under both AUTH_MODE values. New supertest passes 100% in both modes without adding to TD-V16-TEST-ISOLATION red. SC4 satisfied at the server layer (frontend DTO extension lands in Plan 38-02 Task 3 to keep this plan's scope tight).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: lib/cbConfig.ts + lib/trackDetect.ts helper modules + companion vitest specs</name>
  <files>kinetica_bi/src/lib/cbConfig.ts, kinetica_bi/src/lib/cbConfig.spec.ts, kinetica_bi/src/lib/trackDetect.ts, kinetica_bi/src/lib/trackDetect.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/mapInfoConfig.ts (PATTERN to mirror — pure helper module, DEFAULT_* constants, getter helpers, JSDoc explaining backward-compat coalescing)
    - kinetica_bi/src/lib/mapInfoConfig.spec.ts (PATTERN for companion spec — describe blocks per export, positive + negative cases per helper)
    - kinetica_bi/src/lib/spatialTargets.ts (PATTERN for EMPTY constant + type narrowing predicates `isSpatialTargetEligible`)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"Pure helper modules" (verbatim type definitions for CbBreak / CbConfig / TrackColumns; locked match rules for trackDetect — strict 4 names case-insensitive TRACKID/x/y/TIMESTAMP, no aliases, no column type checks)
    - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision § color format + § CB param set (cbConfig CbBreak shape must support: pointSize, pointShape, shapeLineWidth, shapeLineColor, shapeFillColor — these are the Lane C optional per-break params; type signature includes them as optional fields)
  </read_first>
  <behavior>
    cbConfig.spec.ts:
    - EMPTY_CB_CONFIG: attr === "", valsType === "numeric", breaks deep-equals [] (no includeOtherBucket).
    - coalesceCbConfig(null): returns EMPTY_CB_CONFIG (reference or deep-equal).
    - coalesceCbConfig("not-json-bogus{"): returns EMPTY_CB_CONFIG (JSON.parse throws → coalesce catches → returns EMPTY).
    - coalesceCbConfig('{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FF112233"}]}'): returns the parsed object verbatim, attr === "fare", breaks.length === 1, breaks[0].value === 10, breaks[0].color === "FF112233".
    - isCbConfigConfigured(EMPTY_CB_CONFIG): returns false (attr is "").
    - isCbConfigConfigured({attr: "x", valsType: "numeric", breaks: []}): returns false (breaks.length === 0).
    - isCbConfigConfigured({attr: "x", valsType: "numeric", breaks: [{value: 1, color: "FF000000"}]}): returns true.
    - isNumericValsType({...valsType: "numeric"}): returns true; isNumericValsType({...valsType: "categorical"}): returns false.
    - isCategoricalValsType inverse.

    trackDetect.spec.ts:
    - All 4 columns present (exact case): isTrackTable([{name:"TRACKID"},{name:"x"},{name:"y"},{name:"TIMESTAMP"}]) returns {trackIdCol:"TRACKID", xCol:"x", yCol:"y", orderCol:"TIMESTAMP"}.
    - Case-insensitive variations: [{name:"trackid"},{name:"X"},{name:"Y"},{name:"timestamp"}] returns {trackIdCol:"trackid", xCol:"X", yCol:"Y", orderCol:"timestamp"} (preserves original casing).
    - Missing TRACKID: [{name:"x"},{name:"y"},{name:"TIMESTAMP"}] returns null.
    - Missing x: returns null. Missing y: returns null. Missing TIMESTAMP: returns null.
    - Empty array: returns null.
    - Extras present: [{name:"TRACKID"},{name:"x"},{name:"y"},{name:"TIMESTAMP"},{name:"DRIVER_ID"},{name:"SPEED"}] returns the matched 4 columns (extras silently ignored).
    - NO alias support: [{name:"track_id"},{name:"lat"},{name:"lon"},{name:"timestamp"}] returns null (track_id is not TRACKID; lat is not y; lon is not x — strict 4-name match locked).
  </behavior>
  <action>
    Create `kinetica_bi/src/lib/cbConfig.ts`:

    ```typescript
    /**
     * v1.7 Phase 38 (SCHEMA-V17-07): pure helper module for classbreak config
     * JSON shape carried on dashboard_layers.cb_config. Mirrors v1.4 Phase 19
     * mapInfoConfig.ts + v1.5 Phase 28 spatialTargets.ts pattern — pure types
     * + EMPTY constant + null-coalescer + type-narrowing predicates. No Zod,
     * no React, no Zustand. JSON.parse at the boundary; everything else passes
     * the parsed shape through.
     *
     * The cb_config JSON string is set via Phase 39 form UI (CB-V17-01..09)
     * and round-trips through the server via Plan 38-01 PATCH route. Phase 38-02
     * wmsUrlBuilder reads it via coalesceCbConfig(layer.cb_config) before
     * emitting Lane C params under STYLES=cb_raster.
     *
     * Type-narrowing predicates (isNumericValsType / isCategoricalValsType)
     * pre-stage Phase 39's numeric-vs-categorical branch UI — wmsUrlBuilder
     * does NOT branch on valsType; it serializes breaks[].value verbatim into
     * comma-separated CB_VALS (Kinetica accepts both numeric strings and
     * string-form categorical values under the same param).
     */

    export type CbBreak = {
      /** Break boundary value. Numeric for valsType="numeric"; string for valsType="categorical".
       *  Supports the literal "<other>" keyword as a sink-bucket value in categorical mode
       *  (Phase 37 SPIKE-V17-02 OQ-3 PASS — Kinetica accepts the verbatim <other> keyword). */
      value: string | number;
      /** 8-char AARRGGBB hex. Phase 38-02 wmsUrlBuilder normalizes via normalizeAARRGGBB
       *  (colorHex.ts:30) before emitting POINTCOLORS — legacy 6-char values become
       *  FF + RRGGBB. Phase 39 form's color picker writes 8-char by default. */
      color: string;
      /** Optional per-break legend label. Pure client-side presentation (Phase 41
       *  LayersLegendPanel reads this directly from cb_config); NOT emitted in WMS URL. */
      label?: string;
      /** Optional per-break point size (Lane C POINTSIZES comma-separated emission). */
      pointSize?: number;
      /** Optional per-break point shape (Lane C POINTSHAPES — circle/square/diamond/triangle). */
      pointShape?: string;
      /** Optional per-break shape line width (Lane C SHAPELINEWIDTHS). */
      shapeLineWidth?: number;
      /** Optional per-break shape line color (Lane C SHAPELINECOLORS, 8-char AARRGGBB). */
      shapeLineColor?: string;
      /** Optional per-break shape fill color (Lane C SHAPEFILLCOLORS, 8-char AARRGGBB). */
      shapeFillColor?: string;
    };

    export type CbConfig = {
      /** CB_ATTR column name. Empty string signals "not yet configured". */
      attr: string;
      /** Numeric (INT/DOUBLE/FLOAT/DECIMAL) vs categorical (TEXT/CHAR) source column.
       *  Phase 39 form's CB column picker auto-defaults based on column type;
       *  operator can override. wmsUrlBuilder does NOT branch on this — it
       *  serializes breaks[].value verbatim. */
      valsType: "numeric" | "categorical";
      /** Per-break entries. Empty array signals "not yet configured" (wmsUrlBuilder
       *  cb_raster branch skips emission when breaks.length === 0). */
      breaks: CbBreak[];
      /** Phase 39 form UI flag: pre-populate an <other> sink-bucket row when
       *  toggled ON (CB-V17-04). wmsUrlBuilder does NOT auto-inject — Phase 39
       *  form is responsible for placing the row in breaks[]. */
      includeOtherBucket?: boolean;
    };

    /** Backward-compat default for layers whose cb_config is NULL (pre-Phase-38 rows
     *  or operator-cleared rows). wmsUrlBuilder's cb_raster branch checks
     *  isCbConfigConfigured(coalesceCbConfig(raw)) before emitting any CB_* params;
     *  EMPTY_CB_CONFIG always reads as "not configured" so legacy rows render as raster. */
    export const EMPTY_CB_CONFIG: CbConfig = {
      attr: "",
      valsType: "numeric",
      breaks: [],
    };

    /**
     * Parse raw cb_config JSON string. Returns EMPTY_CB_CONFIG on null or any parse
     * failure (NEVER throws). JSON validation is best-effort — Phase 39 form's
     * client-side validation is the trust boundary for shape integrity; this helper
     * only guards the read path against corrupt/null/legacy values.
     */
    export function coalesceCbConfig(raw: string | null): CbConfig {
      if (raw === null) return EMPTY_CB_CONFIG;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "attr" in parsed && "breaks" in parsed) {
          return parsed as CbConfig;
        }
        return EMPTY_CB_CONFIG;
      } catch {
        return EMPTY_CB_CONFIG;
      }
    }

    /** True when attr is non-empty AND breaks.length > 0. Used by wmsUrlBuilder
     *  cb_raster branch to gate Lane C emission. */
    export function isCbConfigConfigured(cfg: CbConfig): boolean {
      return cfg.attr.length > 0 && cfg.breaks.length > 0;
    }

    /** Type-narrowing predicate for numeric breaks UX (Phase 39 CB-V17-03). */
    export function isNumericValsType(cfg: CbConfig): boolean {
      return cfg.valsType === "numeric";
    }

    /** Type-narrowing predicate for categorical breaks UX (Phase 39 CB-V17-04). */
    export function isCategoricalValsType(cfg: CbConfig): boolean {
      return cfg.valsType === "categorical";
    }
    ```

    Create `kinetica_bi/src/lib/cbConfig.spec.ts` — vitest unit coverage for ALL 9 behavior cases above. Use `import { describe, it, expect } from "vitest";` and one describe block per export (EMPTY_CB_CONFIG / coalesceCbConfig / isCbConfigConfigured / isNumericValsType / isCategoricalValsType).

    Create `kinetica_bi/src/lib/trackDetect.ts`:

    ```typescript
    /**
     * v1.7 Phase 38 (SCHEMA-V17-07): pure helper module for detecting Kinetica
     * track tables by column-name shape. Strict 4-name case-insensitive match:
     * TRACKID + x + y + TIMESTAMP. NO alias support (no track_id / lat / lon /
     * time / ts). NO column type checks. Operator override (Phase 40
     * TRACK-V17-02) is the escape hatch for non-standard schemas.
     *
     * Pure module — no React, no Zustand, no async. Phase 40 form UI is the
     * first consumer (useEffect([columns]) fires isTrackTable; when truthy,
     * the Track sub-section pre-populates with the matched column names).
     */

    export type TrackColumns = {
      /** Matched TRACKID column name, preserving original casing from the columns list. */
      trackIdCol: string;
      /** Matched x column name, preserving original casing. */
      xCol: string;
      /** Matched y column name, preserving original casing. */
      yCol: string;
      /** Matched TIMESTAMP column name, preserving original casing. */
      orderCol: string;
    };

    /**
     * Detect whether the given columns list constitutes a Kinetica track table.
     * Matches exactly four required column names case-insensitively: TRACKID, x,
     * y, TIMESTAMP. Returns the matched columns (preserving original casing) when
     * all four are present; null otherwise. Extra columns are silently ignored.
     */
    export function isTrackTable(columns: { name: string }[]): TrackColumns | null {
      const lower = new Map<string, string>();
      for (const c of columns) {
        lower.set(c.name.toLowerCase(), c.name);
      }
      const trackIdCol = lower.get("trackid");
      const xCol = lower.get("x");
      const yCol = lower.get("y");
      const orderCol = lower.get("timestamp");
      if (!trackIdCol || !xCol || !yCol || !orderCol) return null;
      return { trackIdCol, xCol, yCol, orderCol };
    }
    ```

    Create `kinetica_bi/src/lib/trackDetect.spec.ts` — vitest unit coverage for ALL 8 behavior cases above. Use one describe block "isTrackTable" with `it()` per case. Assert on both the matched return value (deep-equal the TrackColumns object) and the null return for missing-field / alias / empty cases.
  </action>
  <verify>
    <automated>cd kinetica_bi &amp;&amp; test -f src/lib/cbConfig.ts &amp;&amp; test -f src/lib/cbConfig.spec.ts &amp;&amp; test -f src/lib/trackDetect.ts &amp;&amp; test -f src/lib/trackDetect.spec.ts &amp;&amp; grep -q "EMPTY_CB_CONFIG" src/lib/cbConfig.ts &amp;&amp; grep -q "coalesceCbConfig" src/lib/cbConfig.ts &amp;&amp; grep -q "isCbConfigConfigured" src/lib/cbConfig.ts &amp;&amp; grep -q "isTrackTable" src/lib/trackDetect.ts &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run src/lib/cbConfig.spec.ts src/lib/trackDetect.spec.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - All four files exist: `test -f kinetica_bi/src/lib/cbConfig.ts && test -f kinetica_bi/src/lib/cbConfig.spec.ts && test -f kinetica_bi/src/lib/trackDetect.ts && test -f kinetica_bi/src/lib/trackDetect.spec.ts`.
    - `grep -q "EMPTY_CB_CONFIG" kinetica_bi/src/lib/cbConfig.ts` returns 0 (EMPTY constant exported).
    - `grep -q "coalesceCbConfig" kinetica_bi/src/lib/cbConfig.ts` AND `grep -q "isCbConfigConfigured" kinetica_bi/src/lib/cbConfig.ts` AND `grep -q "isNumericValsType" kinetica_bi/src/lib/cbConfig.ts` AND `grep -q "isCategoricalValsType" kinetica_bi/src/lib/cbConfig.ts` all return 0 (all four helpers exported).
    - `grep -q "isTrackTable" kinetica_bi/src/lib/trackDetect.ts` returns 0 (matcher exported).
    - `grep -q "TrackColumns" kinetica_bi/src/lib/trackDetect.ts` returns 0 (return type exported).
    - NO Zod import: `! grep -q "from \"zod\"" kinetica_bi/src/lib/cbConfig.ts` (codebase pattern is TS types only).
    - NO alias support: `! grep -q "track_id\\|\"lat\"\\|\"lon\"" kinetica_bi/src/lib/trackDetect.ts` (strict 4-name match only).
    - `cd kinetica_bi &amp;&amp; npx vitest run src/lib/cbConfig.spec.ts src/lib/trackDetect.spec.ts --reporter=verbose` reports 0 failures (all 9 cbConfig cases + all 8 trackDetect cases pass).
    - `cd kinetica_bi &amp;&amp; npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>
    Both helper modules ship with companion specs that pass. SC5 satisfied. EMPTY_CB_CONFIG + coalesceCbConfig ready for Plan 38-02 wmsUrlBuilder to consume; isTrackTable ready for Phase 40 form UI to consume. NO call site wired in this plan (Phase 38-02 wires cbConfig in wmsUrlBuilder; Phase 40 wires trackDetect in KineticaWmsLayerForm).
  </done>
</task>

</tasks>

<verification>
End-to-end checks for Plan 38-01:

1. Migration idempotency: `cd kinetica_bi/server && rm -f /tmp/test-38-01.db && DB_PATH=/tmp/test-38-01.db node -e "require('./dist/db.js') || require('./src/db.js')"` (or via tsx) twice in a row — both invocations exit 0; PRAGMA query against /tmp/test-38-01.db shows cb_config + track_config columns present exactly once.
2. Type compilation: `cd kinetica_bi/server && npx tsc --noEmit` exits 0; `cd kinetica_bi && npx tsc --noEmit` exits 0.
3. New supertest: `cd kinetica_bi/server && npx vitest run tests/routes.dashboard-layers-patch.spec.ts --reporter=verbose` reports 0 failures across both AUTH_MODE describe blocks.
4. New unit specs: `cd kinetica_bi && npx vitest run src/lib/cbConfig.spec.ts src/lib/trackDetect.spec.ts --reporter=verbose` reports 0 failures.
5. No TD-V16-TEST-ISOLATION regression: the new routes.dashboard-layers-patch.spec.ts contains BOTH `AUTH_MODE=password` AND `AUTH_MODE=oidc` describe blocks AND passes under each.
6. Hard-cutover lock honored: NO read-shim for legacy `config.cbColumn` / `config.classbreaks[]` introduced in this plan (these stay in MapWidgetConfig type from Phase 11 but no new code reads them).
</verification>

<success_criteria>
- PRAGMA-guarded migration emits two new ALTER statements idempotently against existing v1.6 DBs (SCHEMA-V17-01).
- DashboardLayer server type + projection + CRUD + PATCH route extended end-to-end with `cb_config: string | null` + `track_config: string | null`; AUTH_MODE-agnostic supertest passes both modes (SCHEMA-V17-02 server side).
- `kinetica_bi/src/lib/cbConfig.ts` + `kinetica_bi/src/lib/trackDetect.ts` shipped with companion specs covering 17 unit cases total; both modules pure (no React / Zustand / Zod) (SCHEMA-V17-07).
- Server tsc + frontend tsc clean.
- ROADMAP Phase 38 SC1 (migration idempotency), SC4 (PATCH round-trip server-side), SC5 (isTrackTable correctness) all satisfied by this plan's exit.
- Frontend DashboardLayerDto extension intentionally deferred to Plan 38-02 Task 3 (paired with wmsUrlBuilder rewrite — single PR-shaped touch on the frontend client surface).
</success_criteria>

<output>
After completion, create `.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md` documenting:
- Migration block placement (after dynamic_view_id, before return instance)
- DashboardLayer type field comment block
- AUTH_MODE-agnostic supertest mocking strategy (hoisted openid-client mock + vi.stubGlobal fetch)
- cbConfig + trackDetect helper-module behavior summaries (so Phase 39 + 40 form-UI planners can read against the locked API)
- Files modified (8 files: types.ts, db.ts, index.ts, cbConfig.ts, cbConfig.spec.ts, trackDetect.ts, trackDetect.spec.ts, routes.dashboard-layers-patch.spec.ts)
- Test counts (5 supertest cases + 9 cbConfig spec cases + 8 trackDetect spec cases = 22 new green tests)
</output>
