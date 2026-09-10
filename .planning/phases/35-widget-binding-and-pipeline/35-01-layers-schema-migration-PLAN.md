---
phase: 35-widget-binding-and-pipeline
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/db.ts
  - kinetica_bi/server/src/types.ts
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/db.smoke.spec.ts
  - kinetica_bi/server/tests/layers.spec.ts
  - kinetica_bi/src/api/client.ts
autonomous: true
requirements:
  - DV-V16-13
must_haves:
  truths:
    - "dashboard_layers table has a nullable dynamic_view_id INTEGER column (idempotent migration)"
    - "Server PATCH /api/dashboards/:id/layers/:layerId accepts dynamic_view_id and round-trips it in both AUTH_MODE blocks"
    - "Frontend DashboardLayerDto + updateLayer Pick<> include dynamic_view_id?: number | null"
    - "table_id stays NOT NULL — dv-bound layer keeps table_id = dv.source_table_id (no schema relaxation)"
  artifacts:
    - path: "kinetica_bi/server/src/db.ts"
      provides: "PRAGMA-guarded ALTER + CREATE TABLE column + mapDashboardLayer + updateDashboardLayer"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/server/src/types.ts"
      provides: "DashboardLayer.dynamic_view_id: number | null"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "PATCH route body Pick<> extension"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/src/api/client.ts"
      provides: "DashboardLayerDto + updateLayer Pick<>"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/server/tests/db.smoke.spec.ts"
      provides: "v1.5 → v1.6 migration spec"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/server/tests/layers.spec.ts"
      provides: "PATCH dynamic_view_id supertest (both auth modes)"
      contains: "dynamic_view_id"
  key_links:
    - from: "PATCH /api/dashboards/:id/layers/:layerId"
      to: "updateDashboardLayer in db.ts"
      via: "Pick<> body forwarded as attrs"
      pattern: "dynamic_view_id"
    - from: "updateDashboardLayer"
      to: "dashboard_layers SQLite row"
      via: "\"dynamic_view_id\" in attrs discriminant"
      pattern: "\"dynamic_view_id\" in attrs"
---

<objective>
Add `dashboard_layers.dynamic_view_id INTEGER` (nullable, logical FK to `dashboard_dynamic_views.id`) and propagate the field end-to-end through the server CRUD pipeline + frontend DTO, with supertest coverage in both AUTH_MODE blocks. Pure additive — no frontend rendering changes here. This is the foundation Plan 35-06 consumes for per-layer dv binding.

Purpose: Establish per-layer dynamic-view binding at the schema level so MapChartRenderer (Plan 35-06) can route LAYERS-swap precedence through `buildWmsParams` (Plan 35-02).

Output: A nullable column + PRAGMA-guarded migration + extended server type / projection / updater / PATCH route + frontend DTO + two supertest specs.
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
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
@.planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
@.planning/phases/19-config-schema/19-01-schema-migration-PLAN.md
@kinetica_bi/server/src/db.ts
@kinetica_bi/server/src/types.ts
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/tests/db.smoke.spec.ts
@kinetica_bi/server/tests/layers.spec.ts
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Key types and contracts the executor needs. Locked references from research §"Pattern 3/4/5" (35-RESEARCH.md:374-466). -->

From kinetica_bi/server/src/db.ts (existing fresh-install CREATE TABLE at lines 83-96):
```sql
CREATE TABLE IF NOT EXISTS dashboard_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL,                       -- soft FK; survives table deletion (db.ts:87 lock)
  layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  info_enabled INTEGER NOT NULL DEFAULT 1,
  info_columns TEXT,
  info_template TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

From kinetica_bi/server/src/db.ts (existing PRAGMA-guarded migration block at lines 149-170 — v1.4 Phase 19 template):
```typescript
const layerCols = instance.prepare("PRAGMA table_info(dashboard_layers)").all() as Array<{ name: string }>;
const layerColNames = new Set(layerCols.map((c) => c.name));
if (!layerColNames.has("info_enabled")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1");
}
if (!layerColNames.has("info_columns")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN info_columns TEXT");
}
if (!layerColNames.has("info_template")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN info_template TEXT");
}
// Phase 35 adds the SAME PATTERN here for dynamic_view_id (no DEFAULT — NULL is the empty signal).
```

From kinetica_bi/server/src/db.ts (existing updateDashboardLayer at lines 470-493 — extend by one row):
```typescript
export const updateDashboardLayer = (
  id: number,
  attrs: Partial<Pick<DashboardLayer,
    "table_id" | "position" | "config" |
    "info_enabled" | "info_columns" | "info_template"
  >>
): DashboardLayer | undefined => {
  const existing = getDashboardLayer(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.table_id ?? existing.table_id,
    attrs.position ?? existing.position,
    JSON.stringify(attrs.config ?? existing.config),
    "info_enabled" in attrs ? attrs.info_enabled : existing.info_enabled,
    "info_columns" in attrs ? attrs.info_columns : existing.info_columns,
    "info_template" in attrs ? attrs.info_template : existing.info_template,
    id
  );
  return getDashboardLayer(id);
};
```

From kinetica_bi/server/src/index.ts (existing PATCH route at lines 583-594):
```typescript
app.patch("/api/dashboards/:id/layers/:layerId", (req, res) => {
  const layerId = Number(req.params.layerId);
  const body = req.body as Partial<Pick<DashboardLayer,
    "table_id" | "position" | "config" |
    "info_enabled" | "info_columns" | "info_template"
  >>;
  const updated = updateDashboardLayer(layerId, body);
  if (!updated) return res.status(404).json({ error: "Layer not found." });
  return res.json(updated);
});
```

From kinetica_bi/src/api/client.ts (existing DashboardLayerDto at lines 454-471):
```typescript
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: "KineticaWms";
  position: number;
  config: Record<string, unknown>;
  info_enabled: number;
  info_columns: string | null;
  info_template: string | null;
  created_at: string;
  updated_at: string;
};
```

From kinetica_bi/server/tests/db.smoke.spec.ts (existing v1.3 → v1.4 test at lines 246-336):
- Pattern: in-memory better-sqlite3, build pre-version schema explicitly, INSERT a row with legacy shape, run the migration block verbatim, assert PRAGMA table_info reports new column AND legacy row data is preserved with NULL in new column.

From kinetica_bi/server/tests/layers.spec.ts (existing PATCH supertest spec):
- Pattern: describe.each([["password"], ["oidc"]]) blocks; each block uses `loginAs(agent, user)` helper, PATCHes layer, asserts response body shape.
- Locked toast taxonomy from Phase 34 research: `ToastKind = "permission" | "info" | "error"` — no "warning".
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add dynamic_view_id column to schema + server type + projection + updater</name>
  <files>kinetica_bi/server/src/db.ts, kinetica_bi/server/src/types.ts</files>
  <read_first>
    - kinetica_bi/server/src/db.ts (FULL — lines 80-115 schema DDL, 149-211 PRAGMA migration, 436-529 mapDashboardLayer + updateDashboardLayer)
    - kinetica_bi/server/src/types.ts (verify DashboardLayer shape at lines 47-78)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (FULL — §"MapChart per-layer binding")
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Pattern 3", §"Pattern 4", §"Pitfall 8" — Map widget config panel exclusion is the OTHER plan's concern, but verify there's no spillover)
    - .planning/phases/19-config-schema/19-01-schema-migration-PLAN.md (v1.4 Phase 19 PRAGMA-guard template)
  </read_first>
  <behavior>
    - Test 1 (db.smoke.spec.ts): Pre-migration `PRAGMA table_info(dashboard_layers)` does NOT include `dynamic_view_id`; post-migration it does.
    - Test 2 (db.smoke.spec.ts): A v1.5-shape row INSERTed before the migration block is preserved with `dynamic_view_id = NULL` after migration; `table_id` value preserved verbatim.
    - Test 3 (db.smoke.spec.ts): Running the migration block twice is idempotent — `PRAGMA table_info` is identical after second run; row count and row values unchanged.
    - Test 4 (db.smoke.spec.ts): Fresh CREATE TABLE (no pre-existing rows) includes `dynamic_view_id` in PRAGMA table_info, defaulting to NULL.
  </behavior>
  <action>
    **1. Extend `DashboardLayer` type in `kinetica_bi/server/src/types.ts`:**

    Locate the existing `DashboardLayer` type (around line 47-78). Add a new field AFTER `info_template`:

    ```typescript
    export type DashboardLayer = {
      id: number;
      dashboard_id: number;
      table_id: number;                              // soft FK; NOT NULL — kept = source_table_id when dv-bound
      layer_type: "KineticaWms";
      position: number;
      config: Record<string, unknown>;
      info_enabled: number;
      info_columns: string | null;
      info_template: string | null;
      dynamic_view_id: number | null;                // NEW Phase 35 (DV-V16-13): logical FK to dashboard_dynamic_views.id; NULL when layer is table/filter-view-bound
      created_at: string;
      updated_at: string;
    };
    ```

    **2. Extend fresh-install CREATE TABLE in `kinetica_bi/server/src/db.ts:83-96`:**

    Add ONE LINE inside the `CREATE TABLE IF NOT EXISTS dashboard_layers (...)` block, BEFORE `created_at`:

    ```sql
    info_template TEXT,
    dynamic_view_id INTEGER,                         -- v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding; logical FK to dashboard_dynamic_views.id (no REFERENCES — soft FK, layer survives dv deletion; renderer detects orphan)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ```

    **Justification for NO `REFERENCES dashboard_dynamic_views(id)` clause:** Mirrors `table_id INTEGER NOT NULL` (db.ts:87) which has comment "soft FK (no REFERENCES) — layers survive table deletion; frontend renders error badge." Same rationale: dv deletion should leave the layer row intact; renderer surfaces orphan UX.

    **3. Extend PRAGMA-guarded migration block in `kinetica_bi/server/src/db.ts:149-170`:**

    Add ONE BLOCK immediately AFTER the existing `info_template` block:

    ```typescript
    if (!layerColNames.has("dynamic_view_id")) {
      instance.exec("ALTER TABLE dashboard_layers ADD COLUMN dynamic_view_id INTEGER");
    }
    ```

    **No DEFAULT value** — NULL is the empty signal (existing rows pre-migration must NOT be auto-bound to any dv).

    **4. Extend `mapDashboardLayer` projection in `kinetica_bi/server/src/db.ts` (around lines 436-468):**

    Locate the existing `mapDashboardLayer` function. Add `dynamic_view_id` to the returned object, sourced from the raw SQLite row:

    ```typescript
    const mapDashboardLayer = (row: any): DashboardLayer => ({
      id: row.id,
      dashboard_id: row.dashboard_id,
      table_id: row.table_id,
      layer_type: row.layer_type,
      position: row.position,
      config: JSON.parse(row.config ?? "{}"),
      info_enabled: row.info_enabled ?? 1,
      info_columns: row.info_columns ?? null,
      info_template: row.info_template ?? null,
      dynamic_view_id: row.dynamic_view_id ?? null,   // NEW Phase 35
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    ```

    **5. Extend `updateDashboardLayer` in `kinetica_bi/server/src/db.ts:470-493`:**

    Modify the function signature AND the UPDATE SQL AND the bound params using the `"key" in attrs` discriminant pattern (verbatim mirror of `info_*` block):

    ```typescript
    export const updateDashboardLayer = (
      id: number,
      attrs: Partial<Pick<DashboardLayer,
        "table_id" | "position" | "config" |
        "info_enabled" | "info_columns" | "info_template" |
        "dynamic_view_id"                              // NEW Phase 35
      >>
    ): DashboardLayer | undefined => {
      const existing = getDashboardLayer(id);
      if (!existing) return undefined;
      db.prepare(
        "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, dynamic_view_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(
        attrs.table_id ?? existing.table_id,
        attrs.position ?? existing.position,
        JSON.stringify(attrs.config ?? existing.config),
        "info_enabled" in attrs ? attrs.info_enabled : existing.info_enabled,
        "info_columns" in attrs ? attrs.info_columns : existing.info_columns,
        "info_template" in attrs ? attrs.info_template : existing.info_template,
        "dynamic_view_id" in attrs ? attrs.dynamic_view_id : existing.dynamic_view_id,   // NEW — discriminant lets explicit null clear
        id
      );
      return getDashboardLayer(id);
    };
    ```

    **Critical:** Use `"dynamic_view_id" in attrs` (NOT `attrs.dynamic_view_id ??`) so PATCHing `{ dynamic_view_id: null }` explicitly clears the binding (when operator switches a dv-bound layer back to a plain table).

    **6. Write/extend `kinetica_bi/server/tests/db.smoke.spec.ts`:**

    Add a NEW `it` block AFTER the existing v1.3 → v1.4 migration test (around line 336). Verbatim mirror of research Example 5 (35-RESEARCH.md:1032-1087), titled `"v1.5 → v1.6 migration: createDb adds dynamic_view_id to dashboard_layers and preserves pre-existing rows"`. The test must:
    - Build a v1.5-shape `dashboard_layers` (NO `dynamic_view_id` column) in `:memory:`.
    - INSERT one row with `table_id = 42`.
    - Assert `PRAGMA table_info(dashboard_layers)` pre-migration does NOT contain `dynamic_view_id`.
    - Run the migration block verbatim (`PRAGMA table_info` check + `ALTER TABLE ADD COLUMN`).
    - Assert `PRAGMA table_info` post-migration DOES contain `dynamic_view_id`.
    - Assert the pre-existing row's `dynamic_view_id` is `NULL` and `table_id` is still `42`.
    - Run the migration block a SECOND time and assert no error + no change in PRAGMA output (idempotency).

    Run the existing smoke spec to confirm prior tests still pass.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "dynamic_view_id INTEGER" kinetica_bi/server/src/db.ts` (both CREATE TABLE and PRAGMA migration)
    - `grep -c "dynamic_view_id" kinetica_bi/server/src/db.ts` returns ≥ 6 (CREATE TABLE + migration + mapDashboardLayer + updateDashboardLayer Pick + UPDATE SQL column + "in attrs" discriminant)
    - `grep -q "dynamic_view_id: number | null" kinetica_bi/server/src/types.ts`
    - `grep -q "\"dynamic_view_id\" in attrs" kinetica_bi/server/src/db.ts` (discriminant pattern)
    - `cd kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - New `it("v1.5 → v1.6 migration: ...")` block exists in db.smoke.spec.ts (`grep -q "v1.5 → v1.6 migration" kinetica_bi/server/tests/db.smoke.spec.ts`)
  </acceptance_criteria>
  <done>
    - Schema migration is idempotent and adds `dynamic_view_id INTEGER NULL` to existing AND new databases
    - `DashboardLayer` type and `updateDashboardLayer` updater both round-trip the field
    - `mapDashboardLayer` projection emits the field
    - Smoke spec covers fresh-install AND v1.5→v1.6 migration paths
    - tsc clean; vitest passes
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend PATCH route + frontend DashboardLayerDto + supertest both auth modes</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/src/api/client.ts, kinetica_bi/server/tests/layers.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (lines 540-601 — layer CRUD region with PATCH at 583-594)
    - kinetica_bi/src/api/client.ts (lines 454-490 — DashboardLayerDto + updateLayer)
    - kinetica_bi/server/tests/layers.spec.ts (FULL — supertest harness pattern for PATCH; describe.each both auth modes)
    - kinetica_bi/server/tests/routes.dynamic-view.spec.ts (reference for the both-auth-modes block pattern)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"MapChart per-layer binding" — server CRUD extension)
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Pattern 4", §"Pattern 5", §"Example 4")
  </read_first>
  <behavior>
    - Test 1 (layers.spec.ts, AUTH_MODE=password): PATCH `/api/dashboards/:id/layers/:layerId` with `{ dynamic_view_id: 7 }` returns 200 with the updated layer response carrying `dynamic_view_id: 7`.
    - Test 2 (layers.spec.ts, AUTH_MODE=password): PATCH with `{ dynamic_view_id: null }` over a layer that had `dynamic_view_id: 7` returns 200 with `dynamic_view_id: null` (explicit clear works via the "key" in attrs discriminant).
    - Test 3 (layers.spec.ts, AUTH_MODE=password): PATCH that omits `dynamic_view_id` on a layer with `dynamic_view_id: 7` returns 200 with `dynamic_view_id: 7` preserved (NOT cleared by absence).
    - Test 4 (layers.spec.ts, AUTH_MODE=oidc): Repeat Test 1 in the OIDC describe.each block.
    - Test 5 (layers.spec.ts, AUTH_MODE=oidc): Repeat Test 2 in the OIDC block.
    - All existing PATCH tests still pass (regression).
  </behavior>
  <action>
    **1. Extend PATCH route in `kinetica_bi/server/src/index.ts:583-594`:**

    Add `dynamic_view_id` to the `Pick<>` body type:

    ```typescript
    app.patch("/api/dashboards/:id/layers/:layerId", (req, res) => {
      const layerId = Number(req.params.layerId);
      const body = req.body as Partial<Pick<DashboardLayer,
        "table_id" | "position" | "config" |
        "info_enabled" | "info_columns" | "info_template" |
        "dynamic_view_id"                              // NEW Phase 35 (DV-V16-13)
      >>;
      const updated = updateDashboardLayer(layerId, body);
      if (!updated) return res.status(404).json({ error: "Layer not found." });
      return res.json(updated);
    });
    ```

    NO additional validation — `dynamic_view_id` accepts `number | null` end-to-end. SQLite enforces type only weakly; the operator can't realistically pass a non-numeric (frontend picker constructs an integer). Server-side trust mirrors `info_*` fields.

    **2. Extend `DashboardLayerDto` in `kinetica_bi/src/api/client.ts` (around lines 454-471):**

    Add `dynamic_view_id: number | null` AFTER `info_template`:

    ```typescript
    export type DashboardLayerDto = {
      id: number;
      dashboard_id: number;
      table_id: number;
      layer_type: "KineticaWms";
      position: number;
      config: Record<string, unknown>;
      info_enabled: number;
      info_columns: string | null;
      info_template: string | null;
      dynamic_view_id: number | null;                   // NEW Phase 35 (DV-V16-13)
      created_at: string;
      updated_at: string;
    };
    ```

    **3. Extend `updateLayer` Pick<> in `kinetica_bi/src/api/client.ts`:**

    Locate the existing `updateLayer` function (search for `export const updateLayer`). Add `"dynamic_view_id"` to its Pick<>:

    ```typescript
    export const updateLayer = async (
      dashboardId: number,
      layerId: number,
      attrs: Partial<Pick<DashboardLayerDto,
        | "table_id"
        | "position"
        | "config"
        | "info_enabled"
        | "info_columns"
        | "info_template"
        | "dynamic_view_id"                              // NEW Phase 35 (DV-V16-13)
      >>
    ): Promise<DashboardLayerDto> => { /* unchanged body — JSON body forwards attrs verbatim */ };
    ```

    Do NOT change the function body — it forwards `attrs` as the JSON body, and the server's Pick<> now accepts `dynamic_view_id`.

    **4. Write supertest cases in `kinetica_bi/server/tests/layers.spec.ts`:**

    Locate the existing PATCH `describe.each([["password"], ["oidc"]])` block (or whichever variant the file uses). Inside each describe.each iteration, add the three new tests:

    ```typescript
    it("PATCH accepts dynamic_view_id and round-trips it in the response", async () => {
      // Setup: create a dashboard + a layer with table_id only
      const dashboard = await createDashboardForTest(agent);
      const layer = await createLayerForTest(agent, dashboard.id, { table_id: 1 });

      const res = await agent
        .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
        .send({ dynamic_view_id: 7 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: layer.id, dynamic_view_id: 7 });
    });

    it("PATCH explicit { dynamic_view_id: null } clears a previously-set binding", async () => {
      const dashboard = await createDashboardForTest(agent);
      const layer = await createLayerForTest(agent, dashboard.id, { table_id: 1 });
      // Set first
      await agent.patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`).send({ dynamic_view_id: 7 });
      // Then clear
      const res = await agent
        .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
        .send({ dynamic_view_id: null });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: layer.id, dynamic_view_id: null });
    });

    it("PATCH that omits dynamic_view_id preserves the existing value (no implicit clear)", async () => {
      const dashboard = await createDashboardForTest(agent);
      const layer = await createLayerForTest(agent, dashboard.id, { table_id: 1 });
      await agent.patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`).send({ dynamic_view_id: 7 });
      // Patch something else
      const res = await agent
        .patch(`/api/dashboards/${dashboard.id}/layers/${layer.id}`)
        .send({ position: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: layer.id, dynamic_view_id: 7, position: 1 });
    });
    ```

    Adapt the `createDashboardForTest` / `createLayerForTest` helper calls to whatever the existing layers.spec.ts uses (read the file first). If the test file uses a different helper API, mirror it verbatim.

    **5. Verify the tests work with the existing setup hooks** — both AUTH_MODE blocks (the describe.each loop covers password + oidc automatically).
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/layers.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "dynamic_view_id" kinetica_bi/server/src/index.ts` (PATCH body Pick<>)
    - `grep -q "dynamic_view_id: number | null" kinetica_bi/src/api/client.ts` (DashboardLayerDto)
    - `grep -q "\"dynamic_view_id\"" kinetica_bi/src/api/client.ts` (updateLayer Pick<>)
    - `grep -c "dynamic_view_id" kinetica_bi/server/tests/layers.spec.ts` returns ≥ 5 (3 new tests, each referencing dynamic_view_id at least once)
    - `cd kinetica_bi/server && npx vitest run tests/layers.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (frontend type still compiles)
  </acceptance_criteria>
  <done>
    - PATCH route accepts and round-trips `dynamic_view_id` (set, clear, preserve-on-omit) in both auth modes
    - Frontend DTO + updateLayer helper accept the field
    - 3 new supertest cases × 2 auth modes = 6 new test runs added
    - Both server and frontend tsc clean
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts tests/layers.spec.ts` passes
- `cd kinetica_bi/server && npx tsc --noEmit` clean
- `cd kinetica_bi && npx tsc --noEmit` clean (DashboardLayerDto change does not break existing consumers)
- Migration is idempotent: running `createDb` twice on a database where `dynamic_view_id` exists is a no-op
- `table_id` stays NOT NULL (unchanged); dv-bound layers will set `table_id = dv.source_table_id` at the picker layer (Plan 35-06)
</verification>

<success_criteria>
- `dashboard_layers.dynamic_view_id INTEGER` (nullable) exists in fresh-install schema AND in v1.5-shape databases (idempotent migration)
- Server CRUD: type, projection, updater, PATCH route all accept and round-trip `dynamic_view_id`
- Frontend DTO mirrors byte-for-byte
- Supertest specs cover set / explicit-clear / preserve-on-omit in both AUTH_MODE=password and AUTH_MODE=oidc blocks
- No regression: existing layers.spec.ts and db.smoke.spec.ts tests still pass
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-01-SUMMARY.md`.
</output>
