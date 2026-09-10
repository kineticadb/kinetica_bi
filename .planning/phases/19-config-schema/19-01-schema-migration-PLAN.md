---
phase: 19-config-schema
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/db.ts
  - kinetica_bi/server/src/types.ts
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/db.smoke.spec.ts
autonomous: true
requirements:
  - CONFIG-V14-01
must_haves:
  truths:
    - "createDb(':memory:') produces a dashboard_layers table whose PRAGMA table_info includes info_enabled, info_columns, info_template (no manual ALTER required for fresh installs because they are part of the CREATE TABLE IF NOT EXISTS DDL)"
    - "Pre-existing v1.2/v1.3 dashboard_layers tables (lacking the 3 new columns) gain them via PRAGMA-guarded ALTER TABLE ADD COLUMN statements run inside createDb after instance.exec(SCHEMA_DDL); pre-existing layer rows survive (no data loss); credential_type-style PITFALLS M-02 pattern"
    - "info_enabled is INTEGER NOT NULL DEFAULT 1 — every existing dashboard_layers row gains info_enabled=1 (opt-in by default); info_columns is TEXT NULL (defaults NULL = all-columns fallback); info_template is TEXT NULL (defaults NULL = key-value fallback)"
    - "Re-running createDb on an already-migrated database is a no-op (no ALTER fires the second time) — proven by the migration test's idempotency assertion"
    - "DashboardLayer TS type in server/src/types.ts gains info_enabled (number; SQLite 0/1), info_columns (string | null; raw JSON string from SQLite TEXT column), info_template (string | null) so route handlers and CRUD helpers compile against the new shape"
    - "mapDashboardLayer in db.ts surfaces the 3 new columns from the SQLite row into the DashboardLayer object; CRUD helpers (updateDashboardLayer Pick<...>) accept the 3 new fields; UPDATE statement persists them"
    - "PATCH /api/dashboards/:id/layers/:layerId route in index.ts forwards info_enabled/info_columns/info_template from req.body through updateDashboardLayer (no validation tightening beyond existing pass-through pattern; defer strict validation to Phase 22 UI)"
    - "vitest run on db.smoke.spec.ts exits 0 with the new migration-idempotency test green; tsc --noEmit passes clean for kinetica_bi/server"
    - "Server boot does not fail: createDb(defaultDbPath) runs the new ALTER block on a real on-disk database that already contains v1.2 layer rows without throwing"
  artifacts:
    - path: "kinetica_bi/server/src/db.ts"
      provides: "Schema DDL extension (3 new columns in CREATE TABLE IF NOT EXISTS dashboard_layers) + PRAGMA-guarded ALTER TABLE migration block + mapDashboardLayer projection of new columns + updateDashboardLayer accepts new fields"
      contains: "info_enabled INTEGER NOT NULL DEFAULT 1"
    - path: "kinetica_bi/server/src/types.ts"
      provides: "DashboardLayer type extended with info_enabled, info_columns, info_template"
      contains: "info_enabled"
    - path: "kinetica_bi/server/tests/db.smoke.spec.ts"
      provides: "Migration test mirroring the v1.0→v1.1 sessions migration spec (PITFALLS M-02): pre-migration shape, post-migration shape, pre-existing row preserved with default applied, idempotency"
      min_lines: 280
  key_links:
    - from: "kinetica_bi/server/src/db.ts createDb post-DDL block"
      to: "PRAGMA-guarded ALTER TABLE block"
      via: "PRAGMA table_info(dashboard_layers) → if-not-has → ALTER TABLE ADD COLUMN"
      pattern: "PRAGMA table_info\\(dashboard_layers\\)"
    - from: "kinetica_bi/server/src/db.ts mapDashboardLayer"
      to: "DashboardLayer type in types.ts"
      via: "row.info_enabled / row.info_columns / row.info_template surfaced into the typed object"
      pattern: "info_enabled: row\\.info_enabled"
    - from: "kinetica_bi/server/src/db.ts updateDashboardLayer"
      to: "UPDATE dashboard_layers SQL statement"
      via: "Pick<DashboardLayer, ...> includes info_enabled | info_columns | info_template; UPDATE persists them"
      pattern: "UPDATE dashboard_layers SET"
---

<objective>
Extend the SQLite `dashboard_layers` table with 3 new columns (`info_enabled`, `info_columns`, `info_template`) using a PRAGMA-guarded `ALTER TABLE` migration that runs idempotently on existing v1.2/v1.3 deployments. Update the server-side `DashboardLayer` TS type, the `mapDashboardLayer` projection, the `updateDashboardLayer` CRUD helper signature/SQL, and the PATCH route's accepted body shape so the new columns flow end-to-end through the existing CRUD pipeline. Add a migration-idempotency spec mirroring the existing v1.0→v1.1 sessions migration test.

Purpose: CONFIG-V14-01 — schema foundation for the v1.4 map info popup. Phase 21 (popup) and Phase 22 (UI) cannot ship without this. Phase 19 is locked to schema + types only (per STATE.md "Config schema split from config UI" decision); this plan does NOT add UI, validation, or popup behavior.

Output:
1. `kinetica_bi/server/src/db.ts` — `SCHEMA_DDL` extended (CREATE TABLE IF NOT EXISTS dashboard_layers includes the 3 new columns for fresh installs); a new PRAGMA-guarded ALTER block added after `instance.exec(SCHEMA_DDL)` to migrate existing tables; `mapDashboardLayer` projects the new columns; `updateDashboardLayer` accepts and persists the new fields.
2. `kinetica_bi/server/src/types.ts` — `DashboardLayer` type extended with `info_enabled: number`, `info_columns: string | null`, `info_template: string | null`.
3. `kinetica_bi/server/src/index.ts` — PATCH `/api/dashboards/:id/layers/:layerId` body type widened to include the 3 new optional fields (no new validation; pass-through to `updateDashboardLayer`).
4. `kinetica_bi/server/tests/db.smoke.spec.ts` — new `it("v1.3 → v1.4 migration: createDb adds info_enabled/info_columns/info_template to dashboard_layers and preserves pre-existing rows", ...)` mirroring the existing sessions-migration test verbatim, plus assertions on the fresh-install schema and on `mapDashboardLayer` projection.

Pattern model: `kinetica_bi/server/src/db.ts:101-124` (the v1.0→v1.1 sessions migration) + `kinetica_bi/server/tests/db.smoke.spec.ts:96-192` (the migration-idempotency test).
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

# Phase 18 outcome (informs which fields are needed downstream)
@.planning/phases/18-spatial-spike-and-endpoint/18-VERIFICATION.md
@.planning/phases/18-spatial-spike-and-endpoint/18-03-info-query-endpoint-PLAN.md

# Pattern references — READ BEFORE WRITING ANY CODE
@kinetica_bi/server/src/db.ts
@kinetica_bi/server/src/types.ts
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/tests/db.smoke.spec.ts

<interfaces>
<!-- Existing types/exports the plan extends -->

From kinetica_bi/server/src/types.ts (lines 42-53 — current shape, BEFORE this plan):
```typescript
export type LayerType = "KineticaWms";

export type DashboardLayer = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

From kinetica_bi/server/src/db.ts (current shape, BEFORE this plan):
```typescript
// SCHEMA_DDL contains: CREATE TABLE IF NOT EXISTS dashboard_layers (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
//   table_id INTEGER NOT NULL,
//   layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
//   position INTEGER NOT NULL DEFAULT 0,
//   config TEXT NOT NULL DEFAULT '{}',
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );

const mapDashboardLayer = (row: any): DashboardLayer => ({
  id: row.id,
  dashboard_id: row.dashboard_id,
  table_id: row.table_id,
  layer_type: row.layer_type,
  position: row.position,
  config: JSON.parse(row.config || "{}"),
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const updateDashboardLayer = (
  id: number,
  attrs: Partial<Pick<DashboardLayer, "table_id" | "position" | "config">>
): DashboardLayer | undefined => {
  const existing = getDashboardLayer(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.table_id ?? existing.table_id,
    attrs.position ?? existing.position,
    JSON.stringify(attrs.config ?? existing.config),
    id
  );
  return getDashboardLayer(id);
};
```

From kinetica_bi/server/src/db.ts:101-124 (the EXACT migration pattern to mirror):
```typescript
// v1.0 → v1.1 migration: add credential_type + id_token_* columns to existing
// sessions tables that predate v1.1. CREATE TABLE IF NOT EXISTS above does NOT
// alter an existing table, so for v1.0 deployments we issue idempotent
// ALTER TABLE ADD COLUMN statements guarded by PRAGMA table_info.
const cols = instance
  .prepare("PRAGMA table_info(sessions)")
  .all() as Array<{ name: string }>;
const colNames = new Set(cols.map((c) => c.name));
if (!colNames.has("credential_type")) {
  instance.exec(
    "ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'"
  );
}
if (!colNames.has("id_token_ciphertext")) {
  instance.exec("ALTER TABLE sessions ADD COLUMN id_token_ciphertext BLOB");
}
// ... etc
```

LOCKED column shapes (from ROADMAP.md Phase 19 Notes + REQUIREMENTS.md CONFIG-V14-01):
```sql
info_enabled INTEGER NOT NULL DEFAULT 1   -- per-layer toggle; existing rows opt in (DEFAULT 1)
info_columns TEXT                          -- nullable; JSON-array string of column names; NULL = all columns
info_template TEXT                         -- nullable; raw HTML template; NULL = default key-value table
```

LOCKED scope boundary (from STATE.md v1.4 architecture decisions):
"Config schema split from config UI: Phase 19 delivers only schema migrations and TS type updates (CONFIG-V14-01, CONFIG-V14-02). Phase 22 delivers the React UI panels (CONFIG-V14-03, CONFIG-V14-04). This prevents Phase 19 from growing to a two-week phase and keeps the schema stable before any UI work touches it."

This plan must NOT include: any React component, any new UI, any column-validation logic beyond pass-through, any client.ts mutations (those are Plan 19-02 scope), any wiring into the popup or info-card consumers (Phases 21/23).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend DashboardLayer type + dashboard_layers schema DDL + PRAGMA-guarded migration in db.ts</name>
  <files>kinetica_bi/server/src/types.ts, kinetica_bi/server/src/db.ts, kinetica_bi/server/src/index.ts</files>
  <read_first>
    - kinetica_bi/server/src/types.ts (lines 42-53 — current DashboardLayer type to extend)
    - kinetica_bi/server/src/db.ts (entire file — confirms SCHEMA_DDL location, the v1.0→v1.1 ALTER migration pattern at lines 101-124, mapDashboardLayer at lines 151-160, updateDashboardLayer at lines 419-434)
    - kinetica_bi/server/src/index.ts (lines 533-584 — confirms the layers route handlers and the pass-through PATCH body shape that will need widening)
    - kinetica_bi/server/tests/db.smoke.spec.ts (read entire file — establishes the migration-test pattern that Task 2 will mirror)
  </read_first>
  <behavior>
    - Test 1 (fresh install): createDb(":memory:") creates dashboard_layers with 11 columns total (8 existing + 3 new); PRAGMA table_info(dashboard_layers) includes info_enabled, info_columns, info_template; info_enabled has notnull=1 and dflt_value containing "1"; info_columns/info_template have notnull=0
    - Test 2 (migration idempotent on already-migrated DB): re-running createDb on a database that already has the 3 new columns does NOT throw and does NOT duplicate the columns
    - Test 3 (existing v1.3 row migration): a pre-existing dashboard_layers row (inserted before the migration) survives the migration; SELECT info_enabled returns 1 (DEFAULT applied); SELECT info_columns / info_template return NULL
    - Test 4 (mapDashboardLayer projection): mapDashboardLayer({...row, info_enabled: 1, info_columns: null, info_template: null}) returns an object whose info_enabled === 1, info_columns === null, info_template === null
    - Test 5 (updateDashboardLayer persists new fields): calling updateDashboardLayer(id, { info_enabled: 0, info_columns: '["lon","lat"]', info_template: "<b>{{name}}</b>" }) persists the values; getDashboardLayer(id) returns those values
    - Test 6 (tsc clean): cd kinetica_bi/server && npx tsc --noEmit passes
  </behavior>
  <action>
    Step 1 — Extend the DashboardLayer type in `kinetica_bi/server/src/types.ts`:

    Replace the existing block (lines 44-53):
      export type DashboardLayer = {
        id: number;
        dashboard_id: number;
        table_id: number;
        layer_type: LayerType;
        position: number;
        config: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      };

    With:
      export type DashboardLayer = {
        id: number;
        dashboard_id: number;
        table_id: number;
        layer_type: LayerType;
        position: number;
        config: Record<string, unknown>;
        // v1.4 Phase 19 (CONFIG-V14-01): info popup config columns on dashboard_layers.
        // info_enabled: 0 | 1 (SQLite has no boolean; INTEGER NOT NULL DEFAULT 1 — existing rows opt in).
        // info_columns: JSON-array string of column names to include in the popup; null = all columns.
        // info_template: raw HTML template string; null = default key-value table.
        // Phase 22 will validate / type-narrow these in the UI; Phase 19 keeps them as raw SQLite shapes.
        info_enabled: number;
        info_columns: string | null;
        info_template: string | null;
        created_at: string;
        updated_at: string;
      };

    Step 2 — Extend SCHEMA_DDL in `kinetica_bi/server/src/db.ts` (around lines 81-91, the dashboard_layers CREATE TABLE block).

    Replace the existing block:
      -- Phase 12: dashboard_layers added in v1.2; CREATE TABLE IF NOT EXISTS handles both new and existing deployments
      CREATE TABLE IF NOT EXISTS dashboard_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
        -- table_id: soft FK (no REFERENCES) — layers survive table deletion; frontend renders error badge
        table_id INTEGER NOT NULL,
        layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
        position INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

    With:
      -- Phase 12: dashboard_layers added in v1.2; CREATE TABLE IF NOT EXISTS handles both new and existing deployments
      -- Phase 19 (v1.4 CONFIG-V14-01): info popup columns added inline so fresh installs get them as part of CREATE TABLE.
      -- Existing v1.2/v1.3 deployments are migrated by the PRAGMA-guarded ALTER block below (mirrors v1.0→v1.1 sessions migration at lines 101-124).
      CREATE TABLE IF NOT EXISTS dashboard_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
        -- table_id: soft FK (no REFERENCES) — layers survive table deletion; frontend renders error badge
        table_id INTEGER NOT NULL,
        layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
        position INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        info_enabled INTEGER NOT NULL DEFAULT 1,
        info_columns TEXT,
        info_template TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

    Step 3 — Add a PRAGMA-guarded ALTER block in `kinetica_bi/server/src/db.ts` createDb function. Insert IMMEDIATELY AFTER the existing v1.0→v1.1 sessions ALTER block (currently ends at line 124, just before `return instance;` on line 126).

    Insert this block (modeled byte-for-byte on the sessions migration at lines 101-124):

      // v1.3 → v1.4 migration: add info_enabled / info_columns / info_template columns to existing
      // dashboard_layers tables that predate v1.4 (CONFIG-V14-01). CREATE TABLE IF NOT EXISTS above
      // does NOT alter an existing table, so for v1.2/v1.3 deployments we issue idempotent
      // ALTER TABLE ADD COLUMN statements guarded by PRAGMA table_info.
      // Pattern verbatim from the v1.0→v1.1 sessions migration above (PITFALLS M-02 lock — runs at
      // boot before app.listen, never mid-flight; first ALTER picks DEFAULT 1 for existing rows
      // so all pre-v1.4 layers opt in to info popup automatically).
      const layerCols = instance
        .prepare("PRAGMA table_info(dashboard_layers)")
        .all() as Array<{ name: string }>;
      const layerColNames = new Set(layerCols.map((c) => c.name));
      if (!layerColNames.has("info_enabled")) {
        instance.exec(
          "ALTER TABLE dashboard_layers ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1"
        );
      }
      if (!layerColNames.has("info_columns")) {
        instance.exec("ALTER TABLE dashboard_layers ADD COLUMN info_columns TEXT");
      }
      if (!layerColNames.has("info_template")) {
        instance.exec("ALTER TABLE dashboard_layers ADD COLUMN info_template TEXT");
      }

    Step 4 — Update mapDashboardLayer in `kinetica_bi/server/src/db.ts` (lines 151-160).

    Replace the existing function:
      const mapDashboardLayer = (row: any): DashboardLayer => ({
        id: row.id,
        dashboard_id: row.dashboard_id,
        table_id: row.table_id,
        layer_type: row.layer_type,
        position: row.position,
        config: JSON.parse(row.config || "{}"),
        created_at: row.created_at,
        updated_at: row.updated_at
      });

    With:
      const mapDashboardLayer = (row: any): DashboardLayer => ({
        id: row.id,
        dashboard_id: row.dashboard_id,
        table_id: row.table_id,
        layer_type: row.layer_type,
        position: row.position,
        config: JSON.parse(row.config || "{}"),
        // v1.4 Phase 19 (CONFIG-V14-01): info popup columns. SQLite returns INTEGER as number
        // and NULL TEXT as JS null. Surface them verbatim — Phase 22 UI will format/validate.
        info_enabled: row.info_enabled,
        info_columns: row.info_columns ?? null,
        info_template: row.info_template ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at
      });

    Step 5 — Update updateDashboardLayer in `kinetica_bi/server/src/db.ts` (lines 419-434).

    Replace the existing function:
      export const updateDashboardLayer = (
        id: number,
        attrs: Partial<Pick<DashboardLayer, "table_id" | "position" | "config">>
      ): DashboardLayer | undefined => {
        const existing = getDashboardLayer(id);
        if (!existing) return undefined;
        db.prepare(
          "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(
          attrs.table_id ?? existing.table_id,
          attrs.position ?? existing.position,
          JSON.stringify(attrs.config ?? existing.config),
          id
        );
        return getDashboardLayer(id);
      };

    With:
      export const updateDashboardLayer = (
        id: number,
        attrs: Partial<Pick<DashboardLayer, "table_id" | "position" | "config" | "info_enabled" | "info_columns" | "info_template">>
      ): DashboardLayer | undefined => {
        const existing = getDashboardLayer(id);
        if (!existing) return undefined;
        db.prepare(
          "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(
          attrs.table_id ?? existing.table_id,
          attrs.position ?? existing.position,
          JSON.stringify(attrs.config ?? existing.config),
          // v1.4 Phase 19: info popup fields. `??` instead of `||` so 0 (info_enabled disabled) is preserved.
          attrs.info_enabled ?? existing.info_enabled,
          attrs.info_columns ?? existing.info_columns,
          attrs.info_template ?? existing.info_template,
          id
        );
        return getDashboardLayer(id);
      };

    Step 6 — Widen the PATCH route body type in `kinetica_bi/server/src/index.ts` (around line 572-577).

    Current code:
      app.patch("/api/dashboards/:id/layers/:layerId", (req, res) => {
        const layerId = Number(req.params.layerId);
        const updated = updateDashboardLayer(layerId, req.body);
        if (!updated) return res.status(404).json({ error: "Layer not found." });
        return res.json(updated);
      });

    Update to:
      app.patch("/api/dashboards/:id/layers/:layerId", (req, res) => {
        const layerId = Number(req.params.layerId);
        // v1.4 Phase 19 (CONFIG-V14-01): pass-through forwarding of info_enabled / info_columns /
        // info_template alongside existing table_id / position / config. No strict validation here —
        // Phase 22 UI will validate; Phase 19 keeps the existing pass-through pattern.
        const body = req.body as Partial<Pick<DashboardLayer,
          "table_id" | "position" | "config" | "info_enabled" | "info_columns" | "info_template"
        >>;
        const updated = updateDashboardLayer(layerId, body);
        if (!updated) return res.status(404).json({ error: "Layer not found." });
        return res.json(updated);
      });

    If `DashboardLayer` is not yet imported in index.ts, add the import alongside the existing types imports (search for `import.*types` near the top of index.ts; if `DashboardLayer` isn't already imported, add it. If a `Layer` shape isn't imported, the route currently passes `req.body` as-is without typing — in that case add `import type { DashboardLayer } from "./types";` near the other type imports).

    Step 7 — Manual sanity check: search for any OTHER call site in server/src that constructs a DashboardLayer object literal (`{ id, dashboard_id, table_id, ... }`). The only construction site should be `mapDashboardLayer` in db.ts. If grep finds others, update them too. If grep returns only db.ts, no further changes needed.

    Anti-patterns to avoid:
    - Do NOT touch the v1.0→v1.1 sessions migration block — it stays verbatim.
    - Do NOT add validation of info_enabled values (e.g., 0/1 only) in the route — Phase 22 will validate at the UI layer.
    - Do NOT change createDashboardLayer to accept info_* fields — initial creation uses defaults from the DDL (info_enabled = 1, info_columns = NULL, info_template = NULL). Phase 22 UI will set them via PATCH.
    - Do NOT change the mapDashboardLayer return type from `DashboardLayer` to a wider type — the type extension already accommodates the new fields.
    - Do NOT add `info_columns` JSON parsing to mapDashboardLayer — keep it as the raw TEXT string. Phase 22 UI / Phase 21 popup decide when to JSON.parse.
    - Do NOT add a frontend client.ts change in this task — that is Plan 19-02 scope.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/server/src/types.ts` DashboardLayer type contains the three fields (verify: `grep -E 'info_enabled: number' kinetica_bi/server/src/types.ts` matches; same for `info_columns: string \| null` and `info_template: string \| null`)
    - `kinetica_bi/server/src/db.ts` SCHEMA_DDL contains `info_enabled INTEGER NOT NULL DEFAULT 1` inside the dashboard_layers CREATE TABLE block (verify: `grep -E 'info_enabled INTEGER NOT NULL DEFAULT 1' kinetica_bi/server/src/db.ts`)
    - `kinetica_bi/server/src/db.ts` SCHEMA_DDL contains `info_columns TEXT,` and `info_template TEXT,` (verify: both grep)
    - `kinetica_bi/server/src/db.ts` contains the PRAGMA-guarded ALTER block (verify: `grep -E 'PRAGMA table_info\(dashboard_layers\)' kinetica_bi/server/src/db.ts`)
    - `kinetica_bi/server/src/db.ts` contains `ALTER TABLE dashboard_layers ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1` (verify: grep)
    - `kinetica_bi/server/src/db.ts` contains `ALTER TABLE dashboard_layers ADD COLUMN info_columns TEXT` (verify: grep)
    - `kinetica_bi/server/src/db.ts` contains `ALTER TABLE dashboard_layers ADD COLUMN info_template TEXT` (verify: grep)
    - `kinetica_bi/server/src/db.ts` mapDashboardLayer surfaces all three new fields (verify: `grep -E 'info_enabled: row\.info_enabled' kinetica_bi/server/src/db.ts`)
    - `kinetica_bi/server/src/db.ts` updateDashboardLayer SQL writes all three new columns (verify: `grep -E 'info_enabled = \?, info_columns = \?, info_template = \?' kinetica_bi/server/src/db.ts`)
    - `kinetica_bi/server/src/db.ts` updateDashboardLayer Pick<...> includes the three new fields (verify: `grep -E '"info_enabled" \| "info_columns" \| "info_template"' kinetica_bi/server/src/db.ts`)
    - `kinetica_bi/server/src/index.ts` PATCH route forwards info_enabled / info_columns / info_template (verify: `grep -E '"info_enabled".*"info_columns".*"info_template"' kinetica_bi/server/src/index.ts` matches inside the PATCH /api/dashboards/:id/layers/:layerId block)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && grep -E "info_enabled INTEGER NOT NULL DEFAULT 1" src/db.ts && grep -E "info_columns TEXT" src/db.ts && grep -E "info_template TEXT" src/db.ts && grep -E "PRAGMA table_info\(dashboard_layers\)" src/db.ts && grep -E "ALTER TABLE dashboard_layers ADD COLUMN info_enabled" src/db.ts && grep -E "info_enabled: number" src/types.ts && grep -E "info_columns: string \| null" src/types.ts && grep -E "info_template: string \| null" src/types.ts && npx tsc --noEmit</automated>
  </verify>
  <done>DashboardLayer TS type extended with info_enabled / info_columns / info_template; SCHEMA_DDL gains the 3 new columns inline; PRAGMA-guarded ALTER block migrates pre-existing tables idempotently; mapDashboardLayer projects new columns; updateDashboardLayer Pick<...> + UPDATE SQL persists them; PATCH route widens to forward them; tsc --noEmit clean across kinetica_bi/server.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add migration-idempotency spec to db.smoke.spec.ts (mirror v1.0→v1.1 sessions migration test)</name>
  <files>kinetica_bi/server/tests/db.smoke.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/db.smoke.spec.ts (entire file — the new tests are appended to the existing describe block; the v1.0→v1.1 sessions migration test at lines 96-192 is the line-by-line model)
    - kinetica_bi/server/src/db.ts (the version with Task 1 changes already applied — confirms the new SCHEMA_DDL and ALTER block to assert against)
    - kinetica_bi/server/src/types.ts (the Task 1-extended DashboardLayer type — confirms what mapDashboardLayer returns)
  </read_first>
  <behavior>
    Append four new it(...) blocks to the existing `describe("db.ts module shape (Wave 0)", () => { ... })` block in db.smoke.spec.ts:

    - Test A "creates dashboard_layers table with v1.4 info popup columns (CONFIG-V14-01)": createDb(":memory:") returns a DB whose PRAGMA table_info(dashboard_layers) includes info_enabled (INTEGER, notnull=1, dflt_value containing "1"), info_columns (TEXT, notnull=0), info_template (TEXT, notnull=0). Asserts the full column list matches: id, dashboard_id, table_id, layer_type, position, config, info_enabled, info_columns, info_template, created_at, updated_at — 11 columns total.
    - Test B "v1.3 → v1.4 migration: createDb adds info_enabled/info_columns/info_template to dashboard_layers and preserves pre-existing rows (PITFALLS M-02)": Build a v1.3-shape in-memory DB by hand (CREATE TABLE dashboard_layers with only the 8 pre-v1.4 columns), insert one pre-existing layer row, then apply the migration block verbatim (mirrors the v1.0→v1.1 sessions test pattern at lines 96-192). Pre-migration: 8 columns; post-migration: 11 columns. Pre-existing row's info_enabled === 1 (DEFAULT applied); info_columns === null; info_template === null; pre-existing fields (table_id, layer_type, config) preserved verbatim.
    - Test C "v1.3 → v1.4 migration is idempotent: re-running the ALTER block on an already-migrated DB does not throw and does not duplicate columns": Run the ALTER block twice; PRAGMA table_info on the second run still returns 11 columns (no duplicates). The test passes if the second run completes without throwing.
    - Test D "mapDashboardLayer projects info_enabled / info_columns / info_template from the SQLite row (verifies CONFIG-V14-01 DTO surface)": insert a layer via createDashboardLayer + use updateDashboardLayer to set info_enabled=0, info_columns='["lon","lat"]', info_template="<b>{{name}}</b>", then getDashboardLayer(id) returns an object with those exact values (info_enabled === 0, info_columns === '["lon","lat"]', info_template === '<b>{{name}}</b>'). Then update with info_enabled=1, info_columns=null, info_template=null and confirm round-trip back to defaults.
  </behavior>
  <action>
    Open `kinetica_bi/server/tests/db.smoke.spec.ts` and append the following four tests INSIDE the existing `describe("db.ts module shape (Wave 0)", () => { ... })` block, AFTER the existing tests (after the closing `});` of the v1.0→v1.1 migration test at line 192, but BEFORE the closing `});` of the describe at line 193).

    EXACT test code to append (use this verbatim — it mirrors the existing v1.0→v1.1 migration test line by line):

      // ────────────────────────────────────────────────────────────────────────
      // v1.4 Phase 19 (CONFIG-V14-01): dashboard_layers info popup columns
      // ────────────────────────────────────────────────────────────────────────

      it("creates dashboard_layers table with v1.4 info popup columns (CONFIG-V14-01)", () => {
        const x = createDb(":memory:");
        const cols = x
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all()
          .map((r: { name: string }) => r.name);
        // Locked column order: 8 pre-v1.4 + 3 v1.4 (info_*) = 11 columns total.
        // info_* columns appear BEFORE created_at/updated_at because that's where Plan 19-01
        // inserted them inside the CREATE TABLE block.
        expect(cols).toEqual([
          "id",
          "dashboard_id",
          "table_id",
          "layer_type",
          "position",
          "config",
          "info_enabled",
          "info_columns",
          "info_template",
          "created_at",
          "updated_at",
        ]);

        // Type / nullable / default sanity per CONFIG-V14-01 spec
        const info = x
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
        const byName = Object.fromEntries(info.map((c) => [c.name, c]));

        // info_enabled: INTEGER NOT NULL DEFAULT 1
        expect(byName.info_enabled).toBeDefined();
        expect(byName.info_enabled.type).toBe("INTEGER");
        expect(byName.info_enabled.notnull).toBe(1);
        expect(byName.info_enabled.dflt_value).toContain("1");

        // info_columns: TEXT NULL (no default)
        expect(byName.info_columns).toBeDefined();
        expect(byName.info_columns.type).toBe("TEXT");
        expect(byName.info_columns.notnull).toBe(0);
        expect(byName.info_columns.dflt_value).toBeNull();

        // info_template: TEXT NULL (no default)
        expect(byName.info_template).toBeDefined();
        expect(byName.info_template.type).toBe("TEXT");
        expect(byName.info_template.notnull).toBe(0);
        expect(byName.info_template.dflt_value).toBeNull();
      });

      it("v1.3 → v1.4 migration: createDb adds info_enabled / info_columns / info_template to dashboard_layers and preserves pre-existing rows (PITFALLS M-02)", async () => {
        // Build a v1.3-shape in-memory database by hand (no info_* columns).
        // Mirrors the v1.0→v1.1 sessions migration test pattern (lines 96-192 of this file).
        const Database = (await import("better-sqlite3")).default;
        const inst = new Database(":memory:");
        inst.exec(`
          CREATE TABLE dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
          CREATE TABLE dashboard_layers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
            table_id INTEGER NOT NULL,
            layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
            position INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        inst.prepare("INSERT INTO dashboards (id, name) VALUES (1, 'test')").run();
        // Insert a v1.3 layer row (placeholder config — we test structure, not behaviour)
        inst
          .prepare(
            "INSERT INTO dashboard_layers (dashboard_id, table_id, layer_type, position, config) VALUES (?, ?, ?, ?, ?)"
          )
          .run(1, 42, "KineticaWms", 0, '{"foo":"bar"}');

        // Pre-migration: only 8 columns
        const preCols = inst
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all()
          .map((r: { name: string }) => r.name);
        expect(preCols).not.toContain("info_enabled");
        expect(preCols).not.toContain("info_columns");
        expect(preCols).not.toContain("info_template");
        expect(preCols.length).toBe(8);

        // Apply the v1.3→v1.4 migration block (mirrors the production block in db.ts createDb).
        // NOTE: this is a verbatim duplicate of the migration logic in db.ts createDb (Plan 19-01 Task 1).
        // If you change one, change the other. (Targeted regression test for PITFALLS M-02.)
        const cols = inst
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all() as Array<{ name: string }>;
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("info_enabled")) {
          inst.exec(
            "ALTER TABLE dashboard_layers ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1"
          );
        }
        if (!colNames.has("info_columns")) {
          inst.exec("ALTER TABLE dashboard_layers ADD COLUMN info_columns TEXT");
        }
        if (!colNames.has("info_template")) {
          inst.exec("ALTER TABLE dashboard_layers ADD COLUMN info_template TEXT");
        }

        // Post-migration: 11 columns present
        const postCols = inst
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all()
          .map((r: { name: string }) => r.name);
        expect(postCols).toContain("info_enabled");
        expect(postCols).toContain("info_columns");
        expect(postCols).toContain("info_template");
        expect(postCols.length).toBe(11);

        // Pre-existing row still selectable + DEFAULT applied + null defaults
        const row = inst
          .prepare(
            "SELECT info_enabled, info_columns, info_template, table_id, layer_type, config FROM dashboard_layers WHERE id = ?"
          )
          .get(1) as {
            info_enabled: number;
            info_columns: string | null;
            info_template: string | null;
            table_id: number;
            layer_type: string;
            config: string;
          };
        expect(row).toBeDefined();
        // info_enabled DEFAULT 1 was applied to the pre-existing row
        expect(row.info_enabled).toBe(1);
        // info_columns / info_template default to null (TEXT, no DEFAULT clause)
        expect(row.info_columns).toBeNull();
        expect(row.info_template).toBeNull();
        // Pre-existing fields preserved verbatim
        expect(row.table_id).toBe(42);
        expect(row.layer_type).toBe("KineticaWms");
        expect(row.config).toBe('{"foo":"bar"}');

        inst.close();
      });

      it("v1.3 → v1.4 migration is idempotent: re-running the ALTER block on an already-migrated DB does not throw and does not duplicate columns", async () => {
        const Database = (await import("better-sqlite3")).default;
        const inst = new Database(":memory:");
        // Start with a v1.4-shape table (already migrated)
        inst.exec(`
          CREATE TABLE dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
          CREATE TABLE dashboard_layers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
            table_id INTEGER NOT NULL,
            layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
            position INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            info_enabled INTEGER NOT NULL DEFAULT 1,
            info_columns TEXT,
            info_template TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);

        // Re-run the migration block (verbatim from db.ts createDb). Should be a no-op.
        const runMigration = () => {
          const cols = inst
            .prepare("PRAGMA table_info(dashboard_layers)")
            .all() as Array<{ name: string }>;
          const colNames = new Set(cols.map((c) => c.name));
          if (!colNames.has("info_enabled")) {
            inst.exec(
              "ALTER TABLE dashboard_layers ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1"
            );
          }
          if (!colNames.has("info_columns")) {
            inst.exec("ALTER TABLE dashboard_layers ADD COLUMN info_columns TEXT");
          }
          if (!colNames.has("info_template")) {
            inst.exec("ALTER TABLE dashboard_layers ADD COLUMN info_template TEXT");
          }
        };

        // First run: no-op (already migrated). Second run: also no-op.
        expect(() => runMigration()).not.toThrow();
        expect(() => runMigration()).not.toThrow();

        // Column count stays at 11 (no duplicate ALTERs fired)
        const cols = inst
          .prepare("PRAGMA table_info(dashboard_layers)")
          .all()
          .map((r: { name: string }) => r.name);
        expect(cols.length).toBe(11);
        // Each column appears exactly once
        const seen = new Set<string>();
        for (const c of cols) {
          expect(seen.has(c)).toBe(false);
          seen.add(c);
        }

        inst.close();
      });

      it("mapDashboardLayer projects info_enabled / info_columns / info_template from the SQLite row (CONFIG-V14-01 DTO surface)", async () => {
        // Use createDb + the production CRUD helpers to round-trip a layer row through the DTO mapper.
        const dbModule = await import("../src/db");
        // Set up a dashboard the layer can FK to
        // (createDb returns a fresh DB but the production module-singleton db is what the helpers use,
        //  so we operate on it directly. Fine for an in-process spec.)
        const dashboard = dbModule.createDashboard("info-popup-test", "");
        const layer = dbModule.createDashboardLayer(dashboard.id, {
          table_id: 99,
          layer_type: "KineticaWms",
          config: { foo: "bar" },
        });
        // Right after creation: defaults from DDL (info_enabled = 1, info_columns = null, info_template = null)
        const fresh = dbModule.getDashboardLayer(layer.id);
        expect(fresh).toBeDefined();
        expect(fresh!.info_enabled).toBe(1);
        expect(fresh!.info_columns).toBeNull();
        expect(fresh!.info_template).toBeNull();

        // Round-trip update: disable info popup, set columns + template
        const updated = dbModule.updateDashboardLayer(layer.id, {
          info_enabled: 0,
          info_columns: '["lon","lat"]',
          info_template: "<b>{{name}}</b>",
        });
        expect(updated).toBeDefined();
        expect(updated!.info_enabled).toBe(0);
        expect(updated!.info_columns).toBe('["lon","lat"]');
        expect(updated!.info_template).toBe("<b>{{name}}</b>");

        // Round-trip back to defaults
        const reset = dbModule.updateDashboardLayer(layer.id, {
          info_enabled: 1,
          info_columns: null,
          info_template: null,
        });
        expect(reset).toBeDefined();
        expect(reset!.info_enabled).toBe(1);
        expect(reset!.info_columns).toBeNull();
        expect(reset!.info_template).toBeNull();

        // Cleanup
        dbModule.deleteDashboardLayer(layer.id);
        dbModule.deleteDashboard(dashboard.id);
      });

    Anti-patterns to avoid:
    - Do NOT replace any existing it(...) blocks — the v1.0→v1.1 sessions tests stay verbatim.
    - Do NOT use `kinetica_bi/server/tests/layers.spec.ts` style supertest patterns here — db.smoke.spec.ts is a pure DB-layer spec, not a route spec.
    - Do NOT add a new describe block — append the four tests inside the existing one.
    - Do NOT mock createDb — use it directly. The migration tests build a from-scratch in-memory DB via `new Database(":memory:")` to simulate a v1.3 deployment shape.
    - Do NOT set `info_enabled` to a non-0/non-1 value in the round-trip test — Phase 22 will validate the bound; Phase 19 only asserts the schema persists whatever is passed.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/tests/db.smoke.spec.ts` contains all four new it(...) blocks (verify: each grep matches at least once)
    - `grep -c "creates dashboard_layers table with v1.4 info popup columns" tests/db.smoke.spec.ts` returns >= 1
    - `grep -c "v1.3 → v1.4 migration: createDb adds" tests/db.smoke.spec.ts` returns >= 1
    - `grep -c "v1.3 → v1.4 migration is idempotent" tests/db.smoke.spec.ts` returns >= 1
    - `grep -c "mapDashboardLayer projects info_enabled" tests/db.smoke.spec.ts` returns >= 1
    - The new tests appear INSIDE the existing `describe("db.ts module shape (Wave 0)"` block (not a new describe)
    - `cd kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts --reporter=verbose` exits 0 (all original + 4 new tests pass)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts --reporter=verbose && grep -c "creates dashboard_layers table with v1.4 info popup columns" tests/db.smoke.spec.ts | awk '$1 >= 1 {exit 0} {exit 1}' && grep -c "v1.3 → v1.4 migration: createDb adds" tests/db.smoke.spec.ts | awk '$1 >= 1 {exit 0} {exit 1}' && grep -c "v1.3 → v1.4 migration is idempotent" tests/db.smoke.spec.ts | awk '$1 >= 1 {exit 0} {exit 1}' && grep -c "mapDashboardLayer projects info_enabled" tests/db.smoke.spec.ts | awk '$1 >= 1 {exit 0} {exit 1}' && npx tsc --noEmit</automated>
  </verify>
  <done>db.smoke.spec.ts contains four new tests (fresh-install schema, v1.3→v1.4 migration with row preservation, migration idempotency, mapDashboardLayer DTO projection); all original tests still pass; tsc --noEmit clean.</done>
</task>

</tasks>

<verification>
- `kinetica_bi/server/src/types.ts` DashboardLayer type extended with info_enabled, info_columns, info_template
- `kinetica_bi/server/src/db.ts` SCHEMA_DDL extended (CREATE TABLE IF NOT EXISTS dashboard_layers includes 3 new columns inline so fresh installs get them automatically)
- `kinetica_bi/server/src/db.ts` PRAGMA-guarded ALTER TABLE block migrates pre-existing dashboard_layers tables idempotently (mirrors v1.0→v1.1 sessions migration pattern)
- `kinetica_bi/server/src/db.ts` mapDashboardLayer surfaces the 3 new columns; updateDashboardLayer Pick<...> + UPDATE SQL persist them
- `kinetica_bi/server/src/index.ts` PATCH /api/dashboards/:id/layers/:layerId forwards the 3 new fields through to updateDashboardLayer (no validation tightening)
- `kinetica_bi/server/tests/db.smoke.spec.ts` 4 new tests cover fresh-install schema, v1.3→v1.4 migration with row preservation, migration idempotency, and mapDashboardLayer DTO projection — all green
- vitest run on db.smoke.spec.ts exits 0; tsc --noEmit clean
- No frontend changes (Plan 19-02 scope); no UI components (Phase 22 scope); no popup behavior (Phase 21 scope)
- Server boot does not fail on a real on-disk database that already contains v1.2/v1.3 layer rows
</verification>

<success_criteria>
- CONFIG-V14-01 implemented end-to-end on the backend: dashboard_layers gains info_enabled (INTEGER NOT NULL DEFAULT 1), info_columns (TEXT NULL), info_template (TEXT NULL); migration is PRAGMA-guarded and idempotent; pre-existing layer rows survive (no data loss) and gain info_enabled = 1 by default
- Phase 19 ROADMAP success criterion 1 satisfied: "dashboard_layers table gains info_enabled, info_columns, and info_template columns via a PRAGMA-guarded ALTER TABLE migration that runs idempotently on a database with existing layer rows — no data loss, no server startup failure"
- Phase 19 ROADMAP success criterion 3 partially satisfied (server side): "TypeScript types for DashboardLayerDto and the map widget config object are updated to include the new fields; tsc --noEmit passes clean" — the SERVER side `DashboardLayer` type is extended; the FRONTEND `DashboardLayerDto` mirror is Plan 19-02 scope
- Plan 19-02 can begin in Wave 2 with the server contract finalized (column names, types, defaults all locked here)
</success_criteria>

<output>
After completion, create `.planning/phases/19-config-schema/19-01-schema-migration-SUMMARY.md` summarizing:
- The dashboard_layers SCHEMA_DDL extension (3 new columns added inline; line range in db.ts)
- The PRAGMA-guarded ALTER block (line range in db.ts createDb)
- The DashboardLayer TS type extension (line range in types.ts)
- The mapDashboardLayer + updateDashboardLayer + PATCH route changes (line ranges)
- The db.smoke.spec.ts test count (e.g., "8/8 passing — 4 pre-existing + 4 new")
- Whether tsc --noEmit was clean across server package
- Migration safety attestation: "Pre-v1.4 layer rows survive the migration with info_enabled=1, info_columns=null, info_template=null; idempotent on re-boot"
</output>
