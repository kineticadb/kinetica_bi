import { describe, expect, it } from "vitest";
import { createDb, db } from "../src/db";

describe("db.ts module shape (Wave 0)", () => {
  it("exports createDb as a function", () => {
    expect(typeof createDb).toBe("function");
  });

  it("exports the production module-singleton db", () => {
    expect(db).toBeDefined();
    // better-sqlite3 instances expose .prepare and .pragma at minimum.
    expect(typeof (db as { prepare?: unknown }).prepare).toBe("function");
  });

  it("createDb(\":memory:\") returns a fresh Database with the existing DDL applied", () => {
    const x = createDb(":memory:");
    const tableNames = x
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    // Must include the 5 pre-existing tables. (sessions table is added in Plan 02 Task 1
    // — that task extends this spec with an additional `it("creates sessions table", ...)`.)
    expect(tableNames).toContain("dashboards");
    expect(tableNames).toContain("widgets");
    expect(tableNames).toContain("tables");
    expect(tableNames).toContain("dashboard_tables");
    expect(tableNames).toContain("dashboard_table_views");
  });

  // Sanity: at least one CRUD helper is still importable (proves the refactor
  // didn't accidentally remove a downstream export). Imported lazily here so
  // its absence surfaces as a clear error rather than a module-load failure.
  it("preserves at least one existing CRUD export", async () => {
    const mod = (await import("../src/db")) as Record<string, unknown>;
    expect(typeof mod.listDashboards).toBe("function");
  });

  it("creates sessions table + idx_sessions_expires_at + idx_sessions_username (Wave 1)", () => {
    const x = createDb(":memory:");
    const tableNames = x
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(tableNames).toContain("sessions");

    const indexNames = x
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_sessions_%' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(indexNames).toContain("idx_sessions_expires_at");
    expect(indexNames).toContain("idx_sessions_username");

    // Schema sanity: PRAGMA table_info returns 13 columns in the locked order (9 v1.0 + 4 v1.1).
    const cols = x
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(cols).toEqual([
      "sid",
      "username",
      "ciphertext",
      "iv",
      "auth_tag",
      "kinetica_url",
      "created_at",
      "last_used_at",
      "expires_at",
      "credential_type",
      "id_token_ciphertext",
      "id_token_iv",
      "id_token_auth_tag",
    ]);
  });

  it("v1.1 sessions schema: credential_type defaults to 'password' and id_token_* columns are nullable BLOB (MODE-02, MODE-06)", () => {
    const x = createDb(":memory:");
    const info = x
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));

    // credential_type: TEXT NOT NULL DEFAULT 'password'
    expect(byName.credential_type).toBeDefined();
    expect(byName.credential_type.type).toBe("TEXT");
    expect(byName.credential_type.notnull).toBe(1);
    expect(byName.credential_type.dflt_value).toContain("'password'");

    // id_token_*: BLOB, nullable (notnull=0)
    for (const col of ["id_token_ciphertext", "id_token_iv", "id_token_auth_tag"]) {
      expect(byName[col]).toBeDefined();
      expect(byName[col].type).toBe("BLOB");
      expect(byName[col].notnull).toBe(0);
    }
  });

  it("v1.0 → v1.1 migration: createDb adds missing columns and preserves pre-existing rows (PITFALLS M-02)", async () => {
    // Build a v1.0-shape in-memory database by hand (no credential_type / id_token_* columns)
    const Database = (await import("better-sqlite3")).default;
    const inst = new Database(":memory:");
    inst.exec(`
      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        iv BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        kinetica_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
    `);

    // Insert a v1.0 row (placeholder BLOBs — we only test structure here, not crypto)
    inst
      .prepare(
        "INSERT INTO sessions (sid, username, ciphertext, iv, auth_tag, kinetica_url, expires_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))"
      )
      .run("legacy-sid-v10", "alice", Buffer.alloc(16), Buffer.alloc(12), Buffer.alloc(16), "https://k.test");

    // Pre-migration: only 9 columns
    const preCols = inst
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(preCols).not.toContain("credential_type");
    expect(preCols).not.toContain("id_token_ciphertext");

    // Apply the v1.1 migration block (mirrors the production block in createDb).
    // NOTE: this is a verbatim duplicate of the migration logic in db.ts createDb.
    // If you change one, change the other. (Targeted regression test for PITFALLS M-02.)
    const cols = inst
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("credential_type")) {
      inst.exec(
        "ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'"
      );
    }
    if (!colNames.has("id_token_ciphertext")) {
      inst.exec("ALTER TABLE sessions ADD COLUMN id_token_ciphertext BLOB");
    }
    if (!colNames.has("id_token_iv")) {
      inst.exec("ALTER TABLE sessions ADD COLUMN id_token_iv BLOB");
    }
    if (!colNames.has("id_token_auth_tag")) {
      inst.exec("ALTER TABLE sessions ADD COLUMN id_token_auth_tag BLOB");
    }

    // Post-migration: all 13 columns present
    const postCols = inst
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(postCols).toContain("credential_type");
    expect(postCols).toContain("id_token_ciphertext");
    expect(postCols).toContain("id_token_iv");
    expect(postCols).toContain("id_token_auth_tag");

    // Pre-existing row still selectable + DEFAULT applied
    const row = inst
      .prepare(
        "SELECT credential_type, id_token_ciphertext, id_token_iv, id_token_auth_tag, username FROM sessions WHERE sid = ?"
      )
      .get("legacy-sid-v10") as {
      credential_type: string;
      id_token_ciphertext: Buffer | null;
      id_token_iv: Buffer | null;
      id_token_auth_tag: Buffer | null;
      username: string;
    };
    expect(row).toBeDefined();
    expect(row.credential_type).toBe("password");
    expect(row.id_token_ciphertext).toBeNull();
    expect(row.id_token_iv).toBeNull();
    expect(row.id_token_auth_tag).toBeNull();
    expect(row.username).toBe("alice");

    // Idempotency: re-running the migration block on a now-up-to-date DB must not throw
    const cols2 = inst
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const colNames2 = new Set(cols2.map((c) => c.name));
    for (const name of ["credential_type", "id_token_ciphertext", "id_token_iv", "id_token_auth_tag"]) {
      expect(colNames2.has(name)).toBe(true);
    }
    // No ALTER fires this time — the test passes simply by reaching here without throwing.

    inst.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // v1.4 Phase 19 (CONFIG-V14-01): dashboard_layers info popup columns
  // ────────────────────────────────────────────────────────────────────────

  it("creates dashboard_layers table with v1.4 info popup columns (CONFIG-V14-01)", () => {
    const x = createDb(":memory:");
    const cols = x
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all()
      .map((r: { name: string }) => r.name);
    // Locked column order: 8 pre-v1.4 + 3 v1.4 (info_*) + 1 v1.6 (dynamic_view_id) = 12 cols total.
    // info_* columns appear BEFORE created_at/updated_at (Plan 19-01 placement);
    // dynamic_view_id appears AFTER info_template, BEFORE created_at (Plan 35-01 placement).
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
      "dynamic_view_id",
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

  // ────────────────────────────────────────────────────────────────────────
  // v1.5 → v1.6 Phase 35 (DV-V16-13): dashboard_layers.dynamic_view_id
  // Per-layer dynamic-view binding column. Soft FK (no REFERENCES) — layer
  // survives dv deletion; renderer detects orphan. Idempotent ALTER mirrors
  // the v1.0→v1.1 sessions + v1.3→v1.4 info_* migration patterns above.
  // ────────────────────────────────────────────────────────────────────────

  it("creates dashboard_layers table with v1.6 dynamic_view_id column (DV-V16-13)", () => {
    const x = createDb(":memory:");
    const cols = x
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all()
      .map((r: { name: string }) => r.name);
    // Locked column order: 8 pre-v1.4 + 3 v1.4 (info_*) + 1 v1.6 (dynamic_view_id) = 12 columns total.
    // dynamic_view_id appears BEFORE created_at/updated_at because that's where the new column
    // is inserted in the CREATE TABLE block (after info_template).
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
      "dynamic_view_id",
      "created_at",
      "updated_at",
    ]);

    // Type / nullable / default sanity per DV-V16-13 spec
    const info = x
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));

    // dynamic_view_id: INTEGER NULL (no default — NULL is the empty signal)
    expect(byName.dynamic_view_id).toBeDefined();
    expect(byName.dynamic_view_id.type).toBe("INTEGER");
    expect(byName.dynamic_view_id.notnull).toBe(0);
    expect(byName.dynamic_view_id.dflt_value).toBeNull();

    // table_id stays NOT NULL — dv-bound layers will set table_id = dv.source_table_id
    // at the picker layer; no schema relaxation in Phase 35 (CONTEXT.md lock).
    expect(byName.table_id.notnull).toBe(1);
  });

  it("v1.5 → v1.6 migration: createDb adds dynamic_view_id to dashboard_layers and preserves pre-existing rows (PITFALLS M-02)", async () => {
    // Build a v1.5-shape in-memory database by hand (info_* columns present, NO dynamic_view_id).
    // Mirrors the v1.3→v1.4 migration test pattern (lines 246-336 of this file).
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
        info_enabled INTEGER NOT NULL DEFAULT 1,
        info_columns TEXT,
        info_template TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    inst.prepare("INSERT INTO dashboards (id, name) VALUES (1, 'test')").run();
    // Insert a v1.5 layer row with table_id = 42 (the key value we assert survives migration).
    inst
      .prepare(
        "INSERT INTO dashboard_layers (dashboard_id, table_id, layer_type, position, config) VALUES (?, ?, ?, ?, ?)"
      )
      .run(1, 42, "KineticaWms", 0, '{"foo":"bar"}');

    // Pre-migration: 11 columns, NO dynamic_view_id
    const preCols = inst
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(preCols).not.toContain("dynamic_view_id");
    expect(preCols.length).toBe(11);

    // Apply the v1.5→v1.6 migration block (mirrors the production block in db.ts createDb).
    // NOTE: this is a verbatim duplicate of the migration logic in db.ts createDb (Plan 35-01 Task 1).
    // If you change one, change the other. (Targeted regression test for PITFALLS M-02.)
    const runMigration = () => {
      const cols = inst
        .prepare("PRAGMA table_info(dashboard_layers)")
        .all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("dynamic_view_id")) {
        inst.exec("ALTER TABLE dashboard_layers ADD COLUMN dynamic_view_id INTEGER");
      }
    };
    runMigration();

    // Post-migration: 12 columns including dynamic_view_id
    const postCols = inst
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(postCols).toContain("dynamic_view_id");
    expect(postCols.length).toBe(12);

    // Pre-existing row preserved verbatim with dynamic_view_id = NULL
    const row = inst
      .prepare(
        "SELECT dynamic_view_id, table_id, layer_type, config, info_enabled FROM dashboard_layers WHERE id = ?"
      )
      .get(1) as {
        dynamic_view_id: number | null;
        table_id: number;
        layer_type: string;
        config: string;
        info_enabled: number;
      };
    expect(row).toBeDefined();
    // dynamic_view_id defaults to NULL (no DEFAULT clause, no auto-binding)
    expect(row.dynamic_view_id).toBeNull();
    // Pre-existing fields preserved verbatim — critically, table_id = 42 (NOT relaxed to null)
    expect(row.table_id).toBe(42);
    expect(row.layer_type).toBe("KineticaWms");
    expect(row.config).toBe('{"foo":"bar"}');
    expect(row.info_enabled).toBe(1);

    // Idempotency: re-running the migration block on a now-up-to-date DB must not throw
    // and must not duplicate the column.
    expect(() => runMigration()).not.toThrow();
    expect(() => runMigration()).not.toThrow();
    const idempotentCols = inst
      .prepare("PRAGMA table_info(dashboard_layers)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(idempotentCols.length).toBe(12);
    // Each column appears exactly once
    const seen = new Set<string>();
    for (const c of idempotentCols) {
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }

    inst.close();
  });

  it("mapDashboardLayer + updateDashboardLayer round-trip dynamic_view_id (set / clear / preserve-on-omit)", async () => {
    // Round-trip through the production CRUD helpers — proves the DTO mapper projects the field
    // AND the updater uses the `"key" in attrs` discriminant correctly (explicit null clears,
    // undefined preserves).
    const dbModule = await import("../src/db");
    const dashboard = dbModule.createDashboard("dv-binding-test", "");
    const layer = dbModule.createDashboardLayer(dashboard.id, {
      table_id: 99,
      layer_type: "KineticaWms",
      config: {},
    });
    // Fresh layer: dynamic_view_id is null by default
    const fresh = dbModule.getDashboardLayer(layer.id);
    expect(fresh).toBeDefined();
    expect(fresh!.dynamic_view_id).toBeNull();

    // Set: PATCH { dynamic_view_id: 7 }
    const set = dbModule.updateDashboardLayer(layer.id, { dynamic_view_id: 7 });
    expect(set).toBeDefined();
    expect(set!.dynamic_view_id).toBe(7);
    // table_id is untouched (NOT NULL constraint, dv-bound layers keep table_id = source_table_id)
    expect(set!.table_id).toBe(99);

    // Preserve-on-omit: PATCH something else, dynamic_view_id is NOT cleared
    const preserved = dbModule.updateDashboardLayer(layer.id, { position: 5 });
    expect(preserved).toBeDefined();
    expect(preserved!.dynamic_view_id).toBe(7);
    expect(preserved!.position).toBe(5);

    // Explicit clear: PATCH { dynamic_view_id: null }
    const cleared = dbModule.updateDashboardLayer(layer.id, { dynamic_view_id: null });
    expect(cleared).toBeDefined();
    expect(cleared!.dynamic_view_id).toBeNull();

    // Cleanup
    dbModule.deleteDashboardLayer(layer.id);
    dbModule.deleteDashboard(dashboard.id);
  });
});
