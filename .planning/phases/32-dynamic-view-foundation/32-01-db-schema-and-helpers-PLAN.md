---
phase: 32-dynamic-view-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/db.ts
  - kinetica_bi/server/src/types.ts
  - kinetica_bi/server/src/lib/dynamicViewSql.ts
  - kinetica_bi/server/src/lib/dynamicViewName.ts
  - kinetica_bi/server/src/lib/materializedView.ts
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts
  - kinetica_bi/server/tests/lib.dynamicViewName.spec.ts
  - kinetica_bi/server/tests/lib.materializedView.spec.ts
  - kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts
autonomous: true
requirements:
  - DV-V16-01
  - DV-V16-02
must_haves:
  truths:
    - "Booting against a fresh SQLite database creates a `dashboard_dynamic_views` table with the locked column shape."
    - "Booting against a pre-v1.6 SQLite database (no `dashboard_dynamic_views` table) creates the table without dropping existing data."
    - "`substituteViewToken('SELECT * FROM {view}', 'foo')` returns `SELECT * FROM foo`."
    - "`substituteViewToken('SELECT * FROM { VIEW }', 'foo')` returns `SELECT * FROM foo` (case-insensitive + whitespace-tolerant)."
    - "`substituteViewToken('SELECT * FROM foo', 'foo')` throws `MissingViewTokenError`."
    - "`buildDynamicViewName({ userId: 'alice', dashboardId: 7, dynamicViewId: 3 })` returns `_kbi_dv_ualice_d7_3`."
    - "Both `POST /api/filter/materialize` (preserved behavior) and any future `/api/dynamic-view/materialize` route share the same TM/SMc:1078 retry helper."
  artifacts:
    - path: "kinetica_bi/server/src/db.ts"
      provides: "Idempotent `dashboard_dynamic_views` schema + PRAGMA-guarded migration"
      contains: "CREATE TABLE IF NOT EXISTS dashboard_dynamic_views"
    - path: "kinetica_bi/server/src/lib/dynamicViewSql.ts"
      provides: "Pure helper `substituteViewToken` + `MissingViewTokenError` class"
      exports: ["substituteViewToken", "MissingViewTokenError"]
    - path: "kinetica_bi/server/src/lib/dynamicViewName.ts"
      provides: "Pure helper `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`"
      exports: ["buildDynamicViewName"]
    - path: "kinetica_bi/server/src/lib/materializedView.ts"
      provides: "Shared `createOrReplaceMaterialized({ req, view, sqlBody, ttl, route, op })` helper extracted from index.ts"
      exports: ["createOrReplaceMaterialized"]
    - path: "kinetica_bi/server/src/types.ts"
      provides: "`DashboardDynamicView` TypeScript type matching new SQLite shape"
      contains: "DashboardDynamicView"
    - path: "kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts"
      provides: "Unit coverage of `substituteViewToken` happy path + case-insensitive + whitespace-tolerant + missing-token throw"
    - path: "kinetica_bi/server/tests/lib.dynamicViewName.spec.ts"
      provides: "Unit coverage of name format + sanitization rules"
    - path: "kinetica_bi/server/tests/lib.materializedView.spec.ts"
      provides: "Unit coverage of TM/SMc:1078 retry + 'Could not find the table' retry + non-matching error rethrow"
    - path: "kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts"
      provides: "Idempotency + pre-v1.6 migration coverage for `dashboard_dynamic_views`"
  key_links:
    - from: "kinetica_bi/server/src/index.ts POST /api/filter/materialize"
      to: "kinetica_bi/server/src/lib/materializedView.ts createOrReplaceMaterialized"
      via: "import + call replaces the inline try/catch retry block at lines ~780-803"
      pattern: "createOrReplaceMaterialized\\("
    - from: "kinetica_bi/server/src/lib/dynamicViewSql.ts substituteViewToken"
      to: "MissingViewTokenError"
      via: "throw when regex /\\{\\s*view\\s*\\}/i fails to match"
      pattern: "throw new MissingViewTokenError"
---

<objective>
Phase 32 ships the server-side foundation for v1.6 Dynamic Views. Plan 01 lays down everything that has zero HTTP surface area: the new SQLite table, three pure helpers, and the extraction of the existing TM/SMc:1078 retry pattern out of `index.ts` into a reusable module. No new endpoints land in this plan — they land in Plans 02 and 03 on top of these primitives.

Purpose: Plans 02 and 03 must import `substituteViewToken`, `buildDynamicViewName`, `createOrReplaceMaterialized`, and persist rows into `dashboard_dynamic_views`. Landing those primitives + their unit tests first means Plans 02 and 03 only have to wire HTTP shape on top of already-proven building blocks (this is the explicit "Wave 1: helpers/schema; Wave 2: endpoints" split the orchestrator asked for).

Output: A new SQLite table, three pure-module helpers with full vitest coverage, a refactored `POST /api/filter/materialize` that uses the extracted retry helper (with the existing supertest spec still green), and a migration spec that proves both fresh-install and pre-v1.6 boot paths.
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

<interfaces>
<!-- Existing patterns the executor must replicate. All paths absolute from repo root. -->

From `kinetica_bi/server/src/lib/viewNaming.ts` (PATTERN TO MIRROR for `buildDynamicViewName`):
```typescript
export function sanitizeForViewName(username: string): string {
  return username.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}

export type FilterViewNameArgs = {
  username: string;
  sessionId: string;
  dashboardId: number;
  tableId: number;
};

export function buildFilterViewName(args: FilterViewNameArgs): string {
  const u = sanitizeForViewName(args.username);
  const s = args.sessionId.slice(0, 8);
  return `_kbi_filt_u${u}_d${args.dashboardId}_t${args.tableId}_s${s}`;
}
```

From `kinetica_bi/server/src/db.ts` lines 80-97 (Phase 19 v1.4 PATTERN TO MIRROR for the new `CREATE TABLE IF NOT EXISTS` block):
```typescript
// Phase 12: dashboard_layers added in v1.2; CREATE TABLE IF NOT EXISTS handles both new and existing deployments
// Phase 19 (v1.4 CONFIG-V14-01): info popup columns added inline so fresh installs get them as part of CREATE TABLE.
CREATE TABLE IF NOT EXISTS dashboard_layers (
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
CREATE INDEX IF NOT EXISTS idx_dashboard_layers_dashboard_id ON dashboard_layers (dashboard_id);
```

From `kinetica_bi/server/src/index.ts` lines ~767-803 (CURRENT retry pattern to extract):
```typescript
const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;
try {
  await kineticaSqlHelper(authedReq, ddl, {
    route: "POST /api/filter/materialize",
    op: "MATERIALIZE",
  });
} catch (err) {
  const msg = (err as Error)?.message ?? "";
  const isReplaceRace =
    msg.includes("TM/SMc:1078") || /Could not find the table/i.test(msg);
  if (!isReplaceRace) throw err;
  await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${viewName}`, {
    route: "POST /api/filter/materialize",
    op: "MATERIALIZE",
  });
  await kineticaSqlHelper(
    authedReq,
    `CREATE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`,
    { route: "POST /api/filter/materialize", op: "MATERIALIZE" },
  );
}
```

From `kinetica_bi/server/src/kinetica.ts` (kineticaSql signature surface used by helper):
```typescript
// kineticaSql(req: AuthedRequest, sql: string, opts: { route: string; op: string; ... }) => Promise<unknown>
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: dashboard_dynamic_views table + idempotent migration + types + DB helpers</name>
  <files>kinetica_bi/server/src/db.ts, kinetica_bi/server/src/types.ts, kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/db.ts (read in full — current SCHEMA_DDL + PRAGMA-guarded ALTER pattern at lines 100-155, plus existing mapXxx/listXxx/createXxx/updateXxx/deleteXxx helper conventions)
    - kinetica_bi/server/src/types.ts (read in full — existing DTO shape for `Dashboard`, `Widget`, `DashboardLayer`; new `DashboardDynamicView` type must follow the same JSON-decode pattern)
    - kinetica_bi/server/tests/db.smoke.spec.ts (read in full — existing migration-style spec idiom for vitest, including in-memory createDb usage)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md (locked decisions D1, D3, D4, D7 + Endpoints section column shape)
  </read_first>
  <action>
    1. Append this block VERBATIM to the `SCHEMA_DDL` template literal in `kinetica_bi/server/src/db.ts` (after the existing `dashboard_layers` block, before the closing backtick):

    ```sql
      -- Phase 32 (v1.6 DV-V16-01): dynamic views — saved SQL templates that re-materialize
      -- on top of an existing filter view. `columns_json` is refreshed on successful Preview /
      -- Save (CONTEXT.md D3); refreshed when template_sql changes (Plan 02 update endpoint).
      -- `name` is the user-facing label (unique per dashboard); the actual materialized Kinetica
      -- view name is computed at runtime via buildDynamicViewName() — NOT stored.
      CREATE TABLE IF NOT EXISTS dashboard_dynamic_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
        source_table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        template_sql TEXT NOT NULL,
        max_records INTEGER NOT NULL DEFAULT 100000,
        columns_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_dynamic_views_dashboard_id ON dashboard_dynamic_views (dashboard_id);
    ```

    2. Since the new table is introduced in v1.6 (no pre-existing column-rename / column-add case), NO PRAGMA-guarded ALTER block is required for this table — `CREATE TABLE IF NOT EXISTS` handles both fresh-install and any future v1.5-or-earlier deployment. Do NOT add an ALTER block.

    3. In `kinetica_bi/server/src/types.ts`, add:

    ```typescript
    export type DashboardDynamicView = {
      id: number;
      dashboard_id: number;
      source_table_id: number;
      name: string;
      template_sql: string;
      max_records: number;
      columns_json: { name: string; type: string }[] | null;
      created_at: string;
      updated_at: string;
    };
    ```

    Place it next to the existing `DashboardTableView` type. Export from the same module.

    4. In `kinetica_bi/server/src/db.ts`, immediately after the `--- Dashboard Layers (Phase 12) ---` block (after `deleteDashboardLayer` / `reorderDashboardLayers`), add a new `// --- Dashboard Dynamic Views (Phase 32 v1.6 DV-V16-01) ---` section with these exported functions (mirror the `mapDashboardLayer` / `listDashboardLayers` / `createDashboardLayer` / `updateDashboardLayer` / `deleteDashboardLayer` shape verbatim — same JSON.parse-on-read / JSON.stringify-on-write, same `"key" in attrs` discriminant for partial updates):

    ```typescript
    const mapDashboardDynamicView = (row: any): DashboardDynamicView => ({
      id: row.id,
      dashboard_id: row.dashboard_id,
      source_table_id: row.source_table_id,
      name: row.name,
      template_sql: row.template_sql,
      max_records: row.max_records,
      // columns_json is TEXT in SQLite; null when never set, JSON-encoded array otherwise.
      // Mirrors mapDashboardLayer info_columns nullable-text handling.
      columns_json: row.columns_json ? JSON.parse(row.columns_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });

    export const listDashboardDynamicViews = (dashboardId: number): DashboardDynamicView[] => {
      return db
        .prepare("SELECT * FROM dashboard_dynamic_views WHERE dashboard_id = ? ORDER BY id ASC")
        .all(dashboardId)
        .map(mapDashboardDynamicView);
    };

    export const getDashboardDynamicView = (id: number): DashboardDynamicView | undefined => {
      const row = db.prepare("SELECT * FROM dashboard_dynamic_views WHERE id = ?").get(id);
      return row ? mapDashboardDynamicView(row) : undefined;
    };

    export const createDashboardDynamicView = (
      dashboardId: number,
      input: { source_table_id: number; name: string; template_sql: string; max_records: number; columns_json?: { name: string; type: string }[] | null }
    ): DashboardDynamicView => {
      const stmt = db.prepare(
        "INSERT INTO dashboard_dynamic_views (dashboard_id, source_table_id, name, template_sql, max_records, columns_json) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const result = stmt.run(
        dashboardId,
        input.source_table_id,
        input.name,
        input.template_sql,
        input.max_records,
        input.columns_json ? JSON.stringify(input.columns_json) : null
      );
      return getDashboardDynamicView(Number(result.lastInsertRowid)) as DashboardDynamicView;
    };

    export const updateDashboardDynamicView = (
      id: number,
      attrs: Partial<Pick<DashboardDynamicView, "name" | "template_sql" | "max_records" | "columns_json" | "source_table_id">>
    ): DashboardDynamicView | undefined => {
      const existing = getDashboardDynamicView(id);
      if (!existing) return undefined;
      // Phase 32 D3: if template_sql changes, columns_json MUST be cleared (forces re-preview before re-save).
      // Caller (Plan 02 PUT route) is responsible for detecting the change; this helper supports both flows.
      const nextColumnsJson = "columns_json" in attrs
        ? (attrs.columns_json ? JSON.stringify(attrs.columns_json) : null)
        : (existing.columns_json ? JSON.stringify(existing.columns_json) : null);
      db.prepare(
        "UPDATE dashboard_dynamic_views SET source_table_id = ?, name = ?, template_sql = ?, max_records = ?, columns_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(
        attrs.source_table_id ?? existing.source_table_id,
        attrs.name ?? existing.name,
        attrs.template_sql ?? existing.template_sql,
        "max_records" in attrs ? attrs.max_records : existing.max_records,
        nextColumnsJson,
        id
      );
      return getDashboardDynamicView(id);
    };

    export const deleteDashboardDynamicView = (id: number): boolean => {
      const result = db.prepare("DELETE FROM dashboard_dynamic_views WHERE id = ?").run(id);
      return result.changes > 0;
    };
    ```

    Add `DashboardDynamicView` to the top-of-file `import { Dashboard, ... } from "./types"` line.

    5. Create `kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts` with vitest tests:
       - `it("creates dashboard_dynamic_views table on fresh boot")` — calls `createDb(":memory:")`, asserts `PRAGMA table_info(dashboard_dynamic_views)` returns 9 rows with the exact column names listed in the success criteria.
       - `it("is idempotent — calling createDb twice does not error")` — calls `createDb(":memory:")` twice on the same path (use a temp file path, not :memory: for the 2nd run; pattern from db.smoke.spec.ts).
       - `it("creates index idx_dashboard_dynamic_views_dashboard_id")` — assert `PRAGMA index_list(dashboard_dynamic_views)` contains a row whose `name` equals `idx_dashboard_dynamic_views_dashboard_id`.
       - `it("dropping the parent dashboard cascade-deletes its dynamic views")` — insert a dashboard + table + dynamic_view, DELETE FROM dashboards WHERE id = ?, then SELECT COUNT(*) FROM dashboard_dynamic_views — expect 0.

    DO NOT modify any other route or helper in this task. Migration spec is the only test added here; helper unit specs land in Tasks 2 + 3.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/db.dynamicViewsMigration.spec.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    Migration spec exits 0 with at least 4 passing tests. `dashboard_dynamic_views` table exists with the exact 9 columns; the `dashboard_id` index exists; cascade delete works; `DashboardDynamicView` type is exported from `types.ts`; five new exported CRUD helpers (`listDashboardDynamicViews`, `getDashboardDynamicView`, `createDashboardDynamicView`, `updateDashboardDynamicView`, `deleteDashboardDynamicView`) exist in `db.ts`. No other route or test file modified.
  </done>
  <acceptance_criteria>
    - `grep -n "CREATE TABLE IF NOT EXISTS dashboard_dynamic_views" kinetica_bi/server/src/db.ts` returns exactly 1 line.
    - `grep -n "CREATE INDEX IF NOT EXISTS idx_dashboard_dynamic_views_dashboard_id" kinetica_bi/server/src/db.ts` returns exactly 1 line.
    - `grep -nE "id INTEGER PRIMARY KEY AUTOINCREMENT,|dashboard_id INTEGER NOT NULL REFERENCES dashboards|source_table_id INTEGER NOT NULL REFERENCES tables|name TEXT NOT NULL,|template_sql TEXT NOT NULL,|max_records INTEGER NOT NULL DEFAULT 100000,|columns_json TEXT,|created_at TEXT NOT NULL DEFAULT \\(datetime\\('now'\\)\\),|updated_at TEXT NOT NULL DEFAULT \\(datetime\\('now'\\)\\)" kinetica_bi/server/src/db.ts | wc -l` returns at least 9 matches (all 9 columns present in the new block).
    - `grep -nE "export type DashboardDynamicView" kinetica_bi/server/src/types.ts` returns exactly 1 line.
    - `grep -nE "^export const (listDashboardDynamicViews|getDashboardDynamicView|createDashboardDynamicView|updateDashboardDynamicView|deleteDashboardDynamicView) " kinetica_bi/server/src/db.ts` returns exactly 5 lines.
    - `cd kinetica_bi/server && npx vitest run tests/db.dynamicViewsMigration.spec.ts` exits 0 with ≥ 4 passing tests.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (no new type errors).
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Pure helpers `substituteViewToken` + `buildDynamicViewName` + their unit specs</name>
  <files>kinetica_bi/server/src/lib/dynamicViewSql.ts, kinetica_bi/server/src/lib/dynamicViewName.ts, kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts, kinetica_bi/server/tests/lib.dynamicViewName.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/lib/viewNaming.ts (read in full — PATTERN TO MIRROR for name helper structure + sanitizeForViewName reuse + jsdoc header style)
    - kinetica_bi/server/tests/lib.viewNaming.spec.ts (read in full — PATTERN TO MIRROR for the dynamicViewName spec; same describe/it shape, no jest globals, vitest only)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md (D1 token regex `\{\s*view\s*\}/i`, D7 name format `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>`)
  </read_first>
  <behavior>
    - Test S1: `substituteViewToken('SELECT * FROM {view}', 'foo')` → `'SELECT * FROM foo'`.
    - Test S2: `substituteViewToken('SELECT * FROM { view }', 'foo')` → `'SELECT * FROM foo'` (whitespace tolerant).
    - Test S3: `substituteViewToken('SELECT * FROM {VIEW}', 'foo')` → `'SELECT * FROM foo'` (case insensitive).
    - Test S4: `substituteViewToken('SELECT * FROM {View}', 'foo')` → `'SELECT * FROM foo'` (mixed case).
    - Test S5: `substituteViewToken('SELECT * FROM {view} UNION SELECT * FROM {view}', 'foo')` → `'SELECT * FROM foo UNION SELECT * FROM foo'` (replaces ALL occurrences, global flag).
    - Test S6: `substituteViewToken('SELECT * FROM foo', 'bar')` throws `MissingViewTokenError` with a message containing `{view}`.
    - Test S7: `substituteViewToken('SELECT * FROM \\{view\\}', 'foo')` — backslash-escaped braces are NOT treated as escapes by Kinetica SQL parser; the regex matches `{view}` substring regardless of surrounding characters, so this case STILL replaces. (Document; assert post-substitution string contains `\\foo\\`.)
    - Test S8: `MissingViewTokenError` is `instanceof Error` and `instanceof MissingViewTokenError`.
    - Test N1: `buildDynamicViewName({ userId: 'alice', dashboardId: 7, dynamicViewId: 3 })` → `'_kbi_dv_ualice_d7_3'`.
    - Test N2: `buildDynamicViewName({ userId: 'john.doe@kinetica.com', dashboardId: 1, dynamicViewId: 42 })` → `'_kbi_dv_ujohn_doe_kinetica_com_d1_42'` (uses same `sanitizeForViewName` rule).
    - Test N3: `buildDynamicViewName({ userId: 'a'.repeat(50), dashboardId: 1, dynamicViewId: 1 })` produces a userId segment exactly 32 chars long (truncation rule from `sanitizeForViewName`).
    - Test N4: Output always matches regex `/^_kbi_dv_u[a-zA-Z0-9_]+_d\d+_\d+$/`.
  </behavior>
  <action>
    1. Create `kinetica_bi/server/src/lib/dynamicViewSql.ts` with this exact content:

    ```typescript
    /**
     * Pure SQL helper: substitute the `{view}` token in a dynamic-view template
     * with the source filter-view's materialized name.
     *
     * Locked decisions (32-CONTEXT.md § D1):
     *  - Single placeholder: `{view}`.
     *  - Case-insensitive (`{View}` / `{VIEW}` accepted).
     *  - Whitespace-tolerant around the token (`{ view }` accepted).
     *  - GLOBAL replace — every occurrence in the template is substituted.
     *  - If no occurrence is found, throws `MissingViewTokenError`. This is a
     *    configuration error: a dynamic view that does NOT reference the source
     *    filter view would bypass the threshold gate (CONTEXT.md D1 rationale).
     *
     * Pure module — zero imports beyond the JS stdlib (none used here).
     * No Express, no db, no kinetica.ts.
     */

    export class MissingViewTokenError extends Error {
      constructor(message?: string) {
        super(message ?? "Dynamic view template must contain a {view} token.");
        this.name = "MissingViewTokenError";
      }
    }

    const VIEW_TOKEN_RE = /\{\s*view\s*\}/gi;

    export function substituteViewToken(template: string, viewName: string): string {
      if (!VIEW_TOKEN_RE.test(template)) {
        throw new MissingViewTokenError();
      }
      // Reset lastIndex because /g regex retains state across .test()/.exec().
      VIEW_TOKEN_RE.lastIndex = 0;
      return template.replace(VIEW_TOKEN_RE, viewName);
    }
    ```

    2. Create `kinetica_bi/server/src/lib/dynamicViewName.ts` with this exact content:

    ```typescript
    /**
     * Pure helper — compose the deterministic Kinetica view name for a saved
     * dynamic view. Shape locked by 32-CONTEXT.md § D7:
     *
     *   _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
     *
     * No session-short suffix (mirrors filter-view naming) and no hash salt
     * (dynamic_view_id is unique per dashboard; CREATE OR REPLACE handles
     * cache-busting on SQL edit — CONTEXT.md D7).
     *
     * Pure module — reuses `sanitizeForViewName` from viewNaming.ts so the
     * sanitization rule is in exactly one place (single source of truth).
     */
    import { sanitizeForViewName } from "./viewNaming";

    export type DynamicViewNameArgs = {
      userId: string;
      dashboardId: number;
      dynamicViewId: number;
    };

    export function buildDynamicViewName(args: DynamicViewNameArgs): string {
      const u = sanitizeForViewName(args.userId);
      return `_kbi_dv_u${u}_d${args.dashboardId}_${args.dynamicViewId}`;
    }
    ```

    3. Create `kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts` mirroring `tests/lib.viewNaming.spec.ts` shape (vitest, describe + it, no shared state). Implement every test S1-S8 from the `<behavior>` block. Use `expect(...).toBe(...)` for string equality and `expect(() => substituteViewToken(...)).toThrow(MissingViewTokenError)` for the throw assertion.

    4. Create `kinetica_bi/server/tests/lib.dynamicViewName.spec.ts` mirroring `tests/lib.viewNaming.spec.ts` shape. Implement every test N1-N4 from the `<behavior>` block.

    RED→GREEN: write the spec FIRST (it will fail because the module does not exist yet), then add the module, then re-run.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/lib.dynamicViewSql.spec.ts tests/lib.dynamicViewName.spec.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    Both new specs exit 0 with ≥ 8 + ≥ 4 = ≥ 12 total passing tests. `substituteViewToken` is exported from `kinetica_bi/server/src/lib/dynamicViewSql.ts`. `MissingViewTokenError` is exported and instances are `instanceof Error`. `buildDynamicViewName` is exported from `kinetica_bi/server/src/lib/dynamicViewName.ts`. Both modules are pure (no imports beyond `viewNaming.ts`).
  </done>
  <acceptance_criteria>
    - `grep -n "^export function substituteViewToken" kinetica_bi/server/src/lib/dynamicViewSql.ts` returns exactly 1 line.
    - `grep -n "^export class MissingViewTokenError" kinetica_bi/server/src/lib/dynamicViewSql.ts` returns exactly 1 line.
    - `grep -n "VIEW_TOKEN_RE = /\\\\{\\\\s\\*view\\\\s\\*\\\\}/gi" kinetica_bi/server/src/lib/dynamicViewSql.ts` returns exactly 1 line (regex literal exactly `/\{\s*view\s*\}/gi`).
    - `grep -n "^export function buildDynamicViewName" kinetica_bi/server/src/lib/dynamicViewName.ts` returns exactly 1 line.
    - `grep -n '_kbi_dv_u' kinetica_bi/server/src/lib/dynamicViewName.ts` returns at least 1 line.
    - `grep -n 'import { sanitizeForViewName } from "./viewNaming"' kinetica_bi/server/src/lib/dynamicViewName.ts` returns exactly 1 line (no duplicate sanitization rule).
    - `cd kinetica_bi/server && npx vitest run tests/lib.dynamicViewSql.spec.ts` exits 0 with ≥ 8 passing tests.
    - `cd kinetica_bi/server && npx vitest run tests/lib.dynamicViewName.spec.ts` exits 0 with ≥ 4 passing tests.
    - `grep -E '^import' kinetica_bi/server/src/lib/dynamicViewSql.ts | wc -l` returns 0 (zero imports — pure module).
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extract `createOrReplaceMaterialized` shared helper + refactor POST /api/filter/materialize to use it</name>
  <files>kinetica_bi/server/src/lib/materializedView.ts, kinetica_bi/server/src/index.ts, kinetica_bi/server/tests/lib.materializedView.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts lines 1-100 + lines 685-832 (current `POST /api/filter/materialize` handler + current `DELETE /api/filter/materialize` handler — the inline retry block to extract is at lines ~780-803)
    - kinetica_bi/server/src/kinetica.ts (read in full — current `kineticaSql` export signature, used as `kineticaSqlHelper` in index.ts:15; the new helper must accept the same `req: AuthedRequest` + `{ route, op }` opts)
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts lines 200-260 (read existing TM/SMc:1078 retry spec — it MUST stay green after the refactor; the helper just moves the logic, contract is unchanged)
    - kinetica_bi/server/src/types.ts (for `AuthedRequest` type if exported there, otherwise find via grep)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md § D5 (retry pattern locked) + § D6 (TTL=5)
  </read_first>
  <behavior>
    - Test M1: Happy path — fetch mock returns success on call 1; helper calls `kineticaSql` exactly once with statement matching `^CREATE OR REPLACE MATERIALIZED VIEW myview AS \(SELECT 1\) USING TABLE PROPERTIES \(TTL = 5\)$`. No retry fires.
    - Test M2: TM/SMc:1078 retry — fetch mock throws an Error whose `.message` contains `TM/SMc:1078` on call 1; success on calls 2 and 3. Helper makes exactly 3 calls: (a) `CREATE OR REPLACE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)`, (b) `DROP TABLE IF EXISTS myview`, (c) `CREATE MATERIALIZED VIEW myview AS (SELECT 1) USING TABLE PROPERTIES (TTL = 5)` (note: NOT "CREATE OR REPLACE" on retry).
    - Test M3: "Could not find the table" retry — fetch mock throws an Error whose `.message` is `'SqlEngine: Could not find the table xyz'`; helper still retries with DROP+CREATE.
    - Test M4: Non-matching error rethrows — fetch mock throws `Error('SqlEngine: Object not found (S/SDc:1513)')`; helper does NOT retry; the original error propagates to the caller. Helper makes exactly 1 call.
    - Test M5: TTL value flows through — pass `ttl: 10`, statement contains `USING TABLE PROPERTIES (TTL = 10)`.
    - Test M6: Custom route + op flow to audit — pass `route: "POST /api/dynamic-view/materialize"`, `op: "DYNAMIC_MATERIALIZE"`; the kineticaSql mock receives those values in its 3rd arg.
  </behavior>
  <action>
    1. Create `kinetica_bi/server/src/lib/materializedView.ts` with this exact content:

    ```typescript
    /**
     * Shared helper: `CREATE OR REPLACE MATERIALIZED VIEW` with the Kinetica
     * race-recovery retry locked in v1.5 Phase 30 (32-CONTEXT.md § D5).
     *
     * Kinetica's CREATE OR REPLACE internally looks up the existing view, drops
     * it, then creates anew — and fails with "Could not find the table"
     * (TM/SMc:1078) when a concurrent DELETE (or another widget's materialize)
     * dropped the view between the lookup and Kinetica's internal drop step.
     *
     * Happy path: single CREATE OR REPLACE statement. On the specific race
     * error we retry with explicit DROP IF EXISTS + plain CREATE — DROP IF
     * EXISTS is silent when the view does not exist, so the retry is always
     * safe.
     *
     * Used by:
     *   - POST /api/filter/materialize (extracted from index.ts in Phase 32 Plan 01)
     *   - POST /api/dynamic-view/materialize (added in Phase 32 Plan 03)
     */
    import { kineticaSql } from "../kinetica";
    import type { AuthedRequest } from "../auth";

    export type CreateOrReplaceMaterializedArgs = {
      req: AuthedRequest;
      view: string;       // bare unqualified Kinetica view name
      sqlBody: string;    // the SELECT clause WITHOUT outer parens — helper wraps it
      ttl: number;        // minutes; emitted as USING TABLE PROPERTIES (TTL = <n>)
      route: string;      // for audit log entries — e.g. "POST /api/filter/materialize"
      op: string;         // audit op tag — e.g. "MATERIALIZE" or "DYNAMIC_MATERIALIZE"
    };

    export async function createOrReplaceMaterialized(
      args: CreateOrReplaceMaterializedArgs,
    ): Promise<void> {
      const { req, view, sqlBody, ttl, route, op } = args;
      const replaceDdl = `CREATE OR REPLACE MATERIALIZED VIEW ${view} AS (${sqlBody}) USING TABLE PROPERTIES (TTL = ${ttl})`;
      try {
        await kineticaSql(req, replaceDdl, { route, op });
        return;
      } catch (err) {
        const msg = (err as Error)?.message ?? "";
        const isReplaceRace =
          msg.includes("TM/SMc:1078") || /Could not find the table/i.test(msg);
        if (!isReplaceRace) throw err;
        // Race recovery: drop-if-exists + plain create.
        await kineticaSql(req, `DROP TABLE IF EXISTS ${view}`, { route, op });
        await kineticaSql(
          req,
          `CREATE MATERIALIZED VIEW ${view} AS (${sqlBody}) USING TABLE PROPERTIES (TTL = ${ttl})`,
          { route, op },
        );
      }
    }
    ```

    2. In `kinetica_bi/server/src/index.ts`, refactor `POST /api/filter/materialize` to use the new helper. Replace the existing inline try/catch retry block (lines ~767-803 — from the `// Phase 30 follow-up: defensive retry around Kinetica race (TM/SMc:1078).` comment through the closing `}` of the catch) with:

    ```typescript
    // Phase 32 Plan 01: extracted to lib/materializedView.ts so dynamic-view
    // materialize (Plan 03) shares the same TM/SMc:1078 race-recovery retry.
    // CONTEXT.md § D5: same retry pattern across filter-view and dynamic-view.
    await createOrReplaceMaterialized({
      req: authedReq,
      view: viewName,
      sqlBody: `SELECT * FROM ${tableRef} WHERE ${whereClause}`,
      ttl: 5,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });
    ```

    Add the import at the top of `index.ts` near the other lib imports:
    `import { createOrReplaceMaterialized } from "./lib/materializedView";`

    DO NOT change `POST /api/views/:id/materialize` (line ~633), `DELETE /api/filter/materialize` (line ~809), or any other route. The helper is only consumed by `POST /api/filter/materialize` in this plan; Plan 03 wires it into the new dynamic-view route.

    3. Create `kinetica_bi/server/tests/lib.materializedView.spec.ts` implementing tests M1-M6 from `<behavior>`. Mock `kineticaSql` via `vi.mock("../src/kinetica", ...)` (use `vi.fn()` returning configurable success/failure per call index — pattern from `tests/routes.filter-materialize.spec.ts` lines 208-259). Pass a stub `AuthedRequest` (cast `{} as AuthedRequest` is acceptable — the helper itself does not inspect the request body, only kineticaSql does). Assert the exact statements sent on each call using `vi.fn().mock.calls`.

    4. After refactor, run `tests/routes.filter-materialize.spec.ts` to prove the existing supertest coverage is still green — the helper extraction is contract-preserving.

    RED→GREEN: write `lib.materializedView.spec.ts` first against the module that does not exist yet (expect ERR_MODULE_NOT_FOUND), then create the module, then re-run.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/lib.materializedView.spec.ts tests/routes.filter-materialize.spec.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    `lib.materializedView.spec.ts` exits 0 with ≥ 6 passing tests. `routes.filter-materialize.spec.ts` still exits 0 with all original tests passing (contract preserved through refactor). `createOrReplaceMaterialized` is exported and imported by `index.ts`. The inline TM/SMc:1078 try/catch block in `index.ts` has been removed.
  </done>
  <acceptance_criteria>
    - `grep -n "^export async function createOrReplaceMaterialized" kinetica_bi/server/src/lib/materializedView.ts` returns exactly 1 line.
    - `grep -n 'TM/SMc:1078' kinetica_bi/server/src/lib/materializedView.ts` returns at least 1 line (retry condition present).
    - `grep -n 'Could not find the table' kinetica_bi/server/src/lib/materializedView.ts` returns at least 1 line.
    - `grep -nE "^import \\{ createOrReplaceMaterialized \\} from " kinetica_bi/server/src/index.ts` returns exactly 1 line.
    - `grep -c 'TM/SMc:1078' kinetica_bi/server/src/index.ts` returns 0 (the inline retry block has been fully removed from index.ts — only the helper has it now). NOTE: comment references to Phase 30 may remain, but no `.includes("TM/SMc:1078")` runtime check.
    - `grep -nE "await createOrReplaceMaterialized\\(\\{" kinetica_bi/server/src/index.ts` returns at least 1 line (POST /api/filter/materialize is now using the helper).
    - `cd kinetica_bi/server && npx vitest run tests/lib.materializedView.spec.ts` exits 0 with ≥ 6 passing tests.
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` exits 0 with ALL existing tests (≥ 25) passing — proves the refactor preserves the filter-materialize contract.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

</tasks>

<verification>
After all 3 tasks complete, run the full server vitest suite to prove nothing else regressed:

```bash
cd kinetica_bi/server && npx vitest run --reporter=verbose 2>&1 | tail -50
```

Expected: every previously-green spec stays green, plus 4 new specs (db.dynamicViewsMigration, lib.dynamicViewSql, lib.dynamicViewName, lib.materializedView) all green. Total new tests: ≥ 22 (4 + 8 + 4 + 6).

Also run `cd kinetica_bi/server && npx tsc --noEmit` to confirm no new type errors anywhere.
</verification>

<success_criteria>
- `dashboard_dynamic_views` table exists with exactly the 9 columns from CONTEXT.md + D7-aligned index.
- `substituteViewToken` substitutes `{view}` case-insensitively, whitespace-tolerantly, globally; throws `MissingViewTokenError` on absence.
- `buildDynamicViewName` produces `_kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>`; reuses `sanitizeForViewName`.
- `createOrReplaceMaterialized` lives in its own module and is consumed by `POST /api/filter/materialize` (proving the extraction round-trip works before Plan 03 takes a second consumer).
- All 4 new spec files green; existing `routes.filter-materialize.spec.ts` still green (contract preservation).
- `npx tsc --noEmit` clean from `kinetica_bi/server/`.
</success_criteria>

<output>
After completion, create `.planning/phases/32-dynamic-view-foundation/32-01-SUMMARY.md` documenting:
- Files added (db.ts diff summary, types.ts new export, 3 new lib/* modules, 4 new tests/* specs).
- Files modified (index.ts: refactored POST /api/filter/materialize to use createOrReplaceMaterialized).
- Final test counts (new + existing-still-green).
- Any decisions made under Claude's discretion (e.g., default `max_records` value — the action picks 100000; if a different default is justified, document why).
- Hand-off pointers for Plans 02 and 03 (which helpers are now importable, what the row shape is).
</output>