import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ColumnDisplayConfigRow, Dashboard, DashboardDynamicView, DashboardLayer, DashboardTableView, Table, Widget } from "./types";
import { seedRbac } from "./lib/rbacSeed";

const ensureDir = (dbPath: string) => {
  // Skip directory creation for in-memory databases used in tests.
  if (dbPath === ":memory:") return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS dashboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schema TEXT NOT NULL DEFAULT '',
    description TEXT,
    columns TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dashboard_tables (
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (dashboard_id, table_id)
  );

  CREATE TABLE IF NOT EXISTS dashboard_table_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    view_name TEXT NOT NULL,
    filter_clause TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    kinetica_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    credential_type TEXT NOT NULL DEFAULT 'password',
    id_token_ciphertext BLOB,
    id_token_iv BLOB,
    id_token_auth_tag BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);

  -- Phase 12: dashboard_layers added in v1.2; CREATE TABLE IF NOT EXISTS handles both new and existing deployments
  -- Phase 19 (v1.4 CONFIG-V14-01): info popup columns added inline so fresh installs get them as part of CREATE TABLE.
  -- Existing v1.2/v1.3 deployments are migrated by the PRAGMA-guarded ALTER block below (mirrors v1.0→v1.1 sessions migration at lines 101-124).
  CREATE TABLE IF NOT EXISTS dashboard_layers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    -- table_id: soft FK (no REFERENCES) — layers survive table deletion; frontend renders error badge.
    -- Phase 35 lock: stays NOT NULL even for dv-bound layers — caller sets table_id = dv.source_table_id
    -- (NOT null) so drill-down + filter-bar code paths keep working; buildWmsParams precedence routes
    -- the LAYERS-swap to dv vs table at render time.
    table_id INTEGER NOT NULL,
    layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
    position INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    info_enabled INTEGER NOT NULL DEFAULT 1,
    info_columns TEXT,
    info_template TEXT,
    -- v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding. Logical FK to
    -- dashboard_dynamic_views.id; NO REFERENCES — soft FK matching table_id rationale (layer
    -- survives dv deletion; renderer detects orphan and omits the layer from the WMS stack).
    -- NULL = layer is table/filter-view bound (existing routing). No DEFAULT — NULL is the
    -- empty signal; existing v1.5 rows MUST NOT be auto-bound to any dv.
    dynamic_view_id INTEGER,
    -- v1.7 Phase 38 (SCHEMA-V17-01): classbreak + track config JSON columns. Both nullable
    -- TEXT (NULL = "not yet configured"). The PRAGMA-guarded ALTER block below migrates
    -- existing v1.4/v1.5/v1.6 deployments; this CREATE TABLE block covers fresh installs.
    cb_config TEXT,
    track_config TEXT,
    -- v1.18 Phase 93 (FSCOPE-V118-02): per-layer filter scope as JSON string. NULL = not
    -- configured = accept-all. Mirrors cb_config / track_config TEXT NULL pattern.
    filter_scope TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dashboard_layers_dashboard_id ON dashboard_layers (dashboard_id);

  -- Phase 32 (v1.6 DV-V16-01): dynamic views — saved SQL templates that re-materialize
  -- on top of an existing filter view. columns_json is refreshed on successful Preview /
  -- Save (CONTEXT.md D3); refreshed when template_sql changes (Plan 02 update endpoint).
  -- name is the user-facing label (unique per dashboard); the actual materialized Kinetica
  -- view name is computed at runtime via buildDynamicViewName() — NOT stored.
  CREATE TABLE IF NOT EXISTS dashboard_dynamic_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    source_table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_sql TEXT NOT NULL,
    max_records INTEGER NOT NULL DEFAULT 100000, -- 0 = unlimited (no row cap)
    columns_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dashboard_dynamic_views_dashboard_id ON dashboard_dynamic_views (dashboard_id);

  -- v1.7 → v1.8 RBAC (SCHEMA-V18-01): app-local role registry. Three wholly-new tables
  -- (no ALTER needed — CREATE TABLE IF NOT EXISTS covers both fresh installs and existing
  -- v1.7 deployments). Seeded idempotently by seedRbac() in createDb (INSERT OR IGNORE).
  -- Username is the Kinetica/OIDC username; NO local users table (identity is external).
  -- Usernames are stored LOWERCASED in user_roles (46-CONTEXT.md: OIDC casing is inconsistent;
  -- case-insensitive matching prevents silent role-assignment breakage).
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    built_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Role → permission mapping (many-to-many). permission is a code-catalog string
  -- (lib/permissions.ts), intentionally NOT a FK; no permissions table in v1.8 per
  -- 46-CONTEXT.md. Editable by user admin in Phase 50, including for built-in roles.
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
  );

  -- Username → role assignment (many-to-many). username stored LOWERCASED.
  -- Multiple roles per user → union of permissions (resolved in rbacDb.ts Plan 46-03).
  CREATE TABLE IF NOT EXISTS user_roles (
    username TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (username, role_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_roles_username ON user_roles (username);

  -- v1.8 RBAC seed history (addendum 2026-06-05): tracks which (role_name, permission)
  -- default mappings have EVER been seeded. This table implements the
  -- operator-removal-survival contract:
  --   Boot 1 → INSERT OR IGNORE into history (changes=1) → INSERT OR IGNORE into role_permissions.
  --   Operator deletes a role_permissions row → next boot: history row already exists
  --   (changes=0) → mapping NOT re-inserted (removal survives restart).
  --   Future release adds a new permission to a role's defaults → no history row
  --   (changes=1) → seeded exactly once.
  -- Intentionally stores role_name TEXT (not role_id FK) so history survives a hypothetical
  -- role drop + re-create without orphaning. role_name uniqueness is enforced by the roles
  -- table's UNIQUE constraint, so the (role_name, permission) composite PK is stable.
  CREATE TABLE IF NOT EXISTS rbac_seed_history (
    role_name TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_name, permission)
  );

  -- Phase 47 (v1.8): durable login history independent of session GC. Upserted on every
  -- successful login (password + OIDC). Username LOWERCASED (Phase 46 convention). Feeds
  -- GET /api/users union + Phase 49 last-seen. CREATE TABLE IF NOT EXISTS covers existing deployments.
  CREATE TABLE IF NOT EXISTS known_users (
    username TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Phase 50 (v1.8 AUDIT-V18-01): RBAC mutation audit log. Every role assign, revoke,
  -- mapping-save, role-create, and role-delete writes one row AND emits one OBS-01
  -- JSON log line (via emitRbacAudit helper in lib/rbacAudit.ts).
  -- before_json/after_json capture state before and after the mutation (null where
  -- not applicable — e.g. before_json=null for role_created).
  CREATE TABLE IF NOT EXISTS rbac_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_ts ON rbac_audit (ts);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit (actor);

  -- v1.10 Phase 55 (ACCESS-V110-02): per-dashboard view-access grants. App-local
  -- visibility layer (Kinetica creds remain the data authority). Single table with a
  -- grantee_type discriminator covers BOTH user grants (lowercased free-form username —
  -- pre-provisioning allowed, intentionally NOT FK-constrained to known_users) and role
  -- grants (role NAME, not id, so a role drop+recreate does not orphan). Cascade on
  -- dashboard delete via FK ON DELETE CASCADE (matches dashboard_tables). CREATE TABLE IF
  -- NOT EXISTS covers fresh + existing deployments — no destructive migration.
  -- NOTE: foreign_keys PRAGMA is NOT enabled globally in this app (only WAL is set);
  -- the FK ON DELETE CASCADE is defined for schema correctness and future-proofing.
  -- Actual grant cleanup on dashboard delete is handled explicitly in deleteDashboard()
  -- (see below) to ensure cascade fires regardless of PRAGMA state.
  CREATE TABLE IF NOT EXISTS dashboard_access_grants (
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    grantee_type TEXT NOT NULL CHECK(grantee_type IN ('user','role')),
    grantee TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (dashboard_id, grantee_type, grantee)
  );
  CREATE INDEX IF NOT EXISTS idx_dashboard_access_grants_dashboard_id ON dashboard_access_grants (dashboard_id);

  -- v1.15 Phase 75 (COLCFG-V115-01): global per-table column display config.
  -- Keyed by (table_id, column_name). label NULL = use raw column name.
  -- format_spec is JSON-encoded FormatSpec (NULL = no formatting). JSON-in-TEXT
  -- mirrors dashboard_dynamic_views.columns_json. CREATE TABLE IF NOT EXISTS covers
  -- fresh + existing installs (new table, no rows to migrate, no ALTER needed).
  CREATE TABLE IF NOT EXISTS column_display_config (
    table_id INTEGER NOT NULL,
    column_name TEXT NOT NULL,
    label TEXT,
    format_spec TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (table_id, column_name)
  );
  CREATE INDEX IF NOT EXISTS idx_column_display_config_table_id ON column_display_config (table_id);

  -- v1.16 Phase 81 (BRANDFND-01): global singleton brand configuration.
  -- Single row enforced by CHECK(id = 1) + INSERT OR IGNORE seed. Follows the
  -- column_display_config (v1.15) JSON-blob pattern: config_json holds the full
  -- BrandConfig object (token overrides, fonts, app name, custom CSS) so token
  -- additions never require a schema migration. Logo stored as base64 TEXT (not
  -- BLOB) for clean better-sqlite3 round-trips, consistent with the JSON-blob
  -- approach. CREATE TABLE IF NOT EXISTS covers fresh + existing deployments
  -- (brand_config is a NEW v1.16 table — no ALTER/PRAGMA migration needed).
  CREATE TABLE IF NOT EXISTS brand_config (
    id          INTEGER PRIMARY KEY CHECK(id = 1),
    config_json TEXT NOT NULL DEFAULT '{}',
    logo_data   TEXT,
    logo_mime   TEXT,
    logo_updated_at TEXT,
    logo_dark_data TEXT,
    logo_dark_mime TEXT,
    logo_dark_updated_at TEXT,
    favicon_data TEXT,
    favicon_mime TEXT,
    favicon_updated_at TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT
  );
`;

export const createDb = (dbPath: string): Database.Database => {
  ensureDir(dbPath);
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.exec(SCHEMA_DDL);

  // v1.0 → v1.1 migration: add credential_type + id_token_* columns to existing
  // sessions tables that predate v1.1. CREATE TABLE IF NOT EXISTS above does NOT
  // alter an existing table, so for v1.0 deployments we issue idempotent
  // ALTER TABLE ADD COLUMN statements guarded by PRAGMA table_info.
  // (PITFALLS I-02 — missing column = #1 "login works, everything else fails";
  //  PITFALLS M-02 — runs at boot before app.listen, never mid-flight.)
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
  if (!colNames.has("id_token_iv")) {
    instance.exec("ALTER TABLE sessions ADD COLUMN id_token_iv BLOB");
  }
  if (!colNames.has("id_token_auth_tag")) {
    instance.exec("ALTER TABLE sessions ADD COLUMN id_token_auth_tag BLOB");
  }

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

  // v1.5 → v1.6 migration: add dynamic_view_id column to existing dashboard_layers tables
  // that predate Phase 35 (DV-V16-13). No DEFAULT — NULL is the empty signal (existing rows
  // must NOT be auto-bound to any dynamic-view). PRAGMA-guard pattern verbatim mirror of the
  // info_* block above (PITFALLS M-02 — runs at boot before app.listen, never mid-flight).
  if (!layerColNames.has("dynamic_view_id")) {
    instance.exec("ALTER TABLE dashboard_layers ADD COLUMN dynamic_view_id INTEGER");
  }

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
  // v1.18 Phase 93 (FSCOPE-V118-02): add filter_scope TEXT column to existing deployments.
  // Idempotent: second boot is a no-op (PRAGMA guard prevents double-ALTER).
  if (!layerColNames.has("filter_scope")) {
    instance.exec("ALTER TABLE dashboard_layers ADD COLUMN filter_scope TEXT");
  }

  // v1.8 RBAC (SCHEMA-V18-01): idempotent built-in role + default-mapping seed.
  // Runs every boot; INSERT OR IGNORE makes it a no-op on subsequent restarts.
  seedRbac(instance);

  // v1.16 Phase 81 (BRANDFND-01): seed the singleton brand_config row.
  // INSERT OR IGNORE — first boot inserts the row with defaults (config_json='{}'),
  // a no-op on every subsequent restart. Mirrors the seedRbac idempotency model.
  instance.exec("INSERT OR IGNORE INTO brand_config (id) VALUES (1)");

  // v1.16 Phase 83 Plan 04 (BRANDUI-06): add logo_dark_* columns to existing Phase-81
  // deployments that have brand_config without the dark-logo columns.
  // SCHEMA_DDL CREATE TABLE above includes these columns for fresh installs.
  // PRAGMA-guarded ALTER pattern verbatim from sessions (above) and dashboard_layers.
  const brandCols = instance
    .prepare("PRAGMA table_info(brand_config)")
    .all() as Array<{ name: string }>;
  const brandColNames = new Set(brandCols.map((c) => c.name));
  if (!brandColNames.has("logo_dark_data")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_data TEXT");
  }
  if (!brandColNames.has("logo_dark_mime")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_mime TEXT");
  }
  if (!brandColNames.has("logo_dark_updated_at")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_updated_at TEXT");
  }
  if (!brandColNames.has("favicon_data")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN favicon_data TEXT");
  }
  if (!brandColNames.has("favicon_mime")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN favicon_mime TEXT");
  }
  if (!brandColNames.has("favicon_updated_at")) {
    instance.exec("ALTER TABLE brand_config ADD COLUMN favicon_updated_at TEXT");
  }

  return instance;
};

const defaultDbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "kinetica.db");
export const db = createDb(defaultDbPath);

const mapDashboard = (row: any): Dashboard => ({
  id: row.id,
  name: row.name,
  description: row.description ?? "",
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapWidget = (row: any): Widget => ({
  id: row.id,
  dashboard_id: row.dashboard_id,
  title: row.title,
  type: row.type,
  position: row.position,
  config: JSON.parse(row.config || "{}"),
  created_at: row.created_at,
  updated_at: row.updated_at
});

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
  // v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding. SQLite returns INTEGER NULL
  // as JS null; surface verbatim (Phase 35-02 buildWmsParams + Phase 35-06 LayersModal consume).
  dynamic_view_id: row.dynamic_view_id ?? null,
  // v1.7 Phase 38 (SCHEMA-V17-01/02): raw JSON strings, NULL surfaces as JS null.
  // Phase 38-02 wmsUrlBuilder reads cb_config via coalesceCbConfig(layer.cb_config);
  // Phase 40 form code reads track_config via inline JSON.parse.
  cb_config: row.cb_config ?? null,
  track_config: row.track_config ?? null,
  // v1.18 Phase 93 (FSCOPE-V118-02): filter_scope stored as JSON string in DB, emitted as
  // parsed object on the DTO (read side). Route stringifies on write (write side).
  // cast to any: DashboardLayer.filter_scope is string | null (column shape); the DTO wire
  // format carries FilterSelectionConfig | undefined (parsed object). Both sides explicit
  // so the object round-trips cleanly.
  filter_scope: (row.filter_scope ? JSON.parse(row.filter_scope) : undefined) as any,
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const listDashboards = (): Dashboard[] => {
  return db.prepare("SELECT * FROM dashboards ORDER BY updated_at DESC").all().map(mapDashboard);
};

export const getDashboard = (id: number): Dashboard | undefined => {
  const row = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(id);
  return row ? mapDashboard(row) : undefined;
};

export const createDashboard = (name: string, description?: string): Dashboard => {
  const stmt = db.prepare("INSERT INTO dashboards (name, description) VALUES (?, ?)");
  const result = stmt.run(name, description ?? null);
  return getDashboard(Number(result.lastInsertRowid)) as Dashboard;
};

export const updateDashboard = (id: number, attrs: Partial<Pick<Dashboard, "name" | "description">>): Dashboard | undefined => {
  const existing = getDashboard(id);
  if (!existing) return undefined;
  db.prepare("UPDATE dashboards SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
    attrs.name ?? existing.name,
    attrs.description ?? existing.description,
    id
  );
  return getDashboard(id);
};

export const deleteDashboard = (id: number): boolean => {
  // Explicit grant cleanup before dashboard delete. foreign_keys PRAGMA is not globally
  // ON in this app (only WAL is set), so ON DELETE CASCADE on dashboard_access_grants
  // does not fire automatically — we explicitly delete grants first (ACCESS-V110-02).
  db.prepare("DELETE FROM dashboard_access_grants WHERE dashboard_id = ?").run(id);
  const result = db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  return result.changes > 0;
};

export const listWidgets = (dashboardId: number): Widget[] => {
  return db
    .prepare("SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY position ASC")
    .all(dashboardId)
    .map(mapWidget);
};

export const createWidget = (dashboardId: number, input: Omit<Widget, "id" | "dashboard_id" | "created_at" | "updated_at">): Widget => {
  const stmt = db.prepare(
    "INSERT INTO widgets (dashboard_id, title, type, position, config) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(dashboardId, input.title, input.type, input.position ?? 0, JSON.stringify(input.config ?? {}));
  return getWidget(Number(result.lastInsertRowid)) as Widget;
};

export const getWidget = (id: number): Widget | undefined => {
  const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id);
  return row ? mapWidget(row) : undefined;
};

export const updateWidget = (
  id: number,
  attrs: Partial<Pick<Widget, "title" | "type" | "position" | "config">>
): Widget | undefined => {
  const existing = getWidget(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE widgets SET title = ?, type = ?, position = ?, config = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.title ?? existing.title,
    attrs.type ?? existing.type,
    attrs.position ?? existing.position,
    JSON.stringify(attrs.config ?? existing.config),
    id
  );
  return getWidget(id);
};

export const deleteWidget = (id: number): boolean => {
  const result = db.prepare("DELETE FROM widgets WHERE id = ?").run(id);
  return result.changes > 0;
};

// --- Tables ---

const mapTable = (row: any): Table => ({
  id: row.id,
  name: row.name,
  schema: row.schema,
  description: row.description ?? "",
  columns: JSON.parse(row.columns || "{}"),
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const listTables = (): Table[] => {
  return db.prepare("SELECT * FROM tables ORDER BY updated_at DESC").all().map(mapTable);
};

export const getTable = (id: number): Table | undefined => {
  const row = db.prepare("SELECT * FROM tables WHERE id = ?").get(id);
  return row ? mapTable(row) : undefined;
};

export const createTable = (input: Pick<Table, "name" | "schema"> & Partial<Pick<Table, "description" | "columns">>): Table => {
  const stmt = db.prepare("INSERT INTO tables (name, schema, description, columns) VALUES (?, ?, ?, ?)");
  const result = stmt.run(input.name, input.schema, input.description ?? null, JSON.stringify(input.columns ?? {}));
  return getTable(Number(result.lastInsertRowid)) as Table;
};

export const updateTable = (
  id: number,
  attrs: Partial<Pick<Table, "name" | "schema" | "description" | "columns">>
): Table | undefined => {
  const existing = getTable(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE tables SET name = ?, schema = ?, description = ?, columns = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.name ?? existing.name,
    attrs.schema ?? existing.schema,
    attrs.description ?? existing.description,
    JSON.stringify(attrs.columns ?? existing.columns),
    id
  );
  return getTable(id);
};

export const deleteTable = (id: number): boolean => {
  const result = db.prepare("DELETE FROM tables WHERE id = ?").run(id);
  return result.changes > 0;
};

// --- Dashboard-Table associations ---

export const listDashboardTables = (dashboardId: number): Table[] => {
  return db
    .prepare(
      "SELECT t.* FROM tables t JOIN dashboard_tables dt ON dt.table_id = t.id WHERE dt.dashboard_id = ? ORDER BY dt.created_at ASC"
    )
    .all(dashboardId)
    .map(mapTable);
};

export const addDashboardTable = (dashboardId: number, tableId: number): boolean => {
  try {
    db.prepare("INSERT OR IGNORE INTO dashboard_tables (dashboard_id, table_id) VALUES (?, ?)").run(dashboardId, tableId);
    return true;
  } catch {
    return false;
  }
};

export const removeDashboardTable = (dashboardId: number, tableId: number): boolean => {
  const result = db.prepare("DELETE FROM dashboard_tables WHERE dashboard_id = ? AND table_id = ?").run(dashboardId, tableId);
  return result.changes > 0;
};

// --- Dashboard-Table Views ---

const mapView = (row: any): DashboardTableView => ({
  id: row.id,
  dashboard_id: row.dashboard_id,
  table_id: row.table_id,
  view_name: row.view_name,
  filter_clause: row.filter_clause ?? "",
  status: row.status,
  error_message: row.error_message ?? undefined,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const listViews = (dashboardId: number): DashboardTableView[] => {
  return db
    .prepare("SELECT * FROM dashboard_table_views WHERE dashboard_id = ? ORDER BY created_at ASC")
    .all(dashboardId)
    .map(mapView);
};

export const listViewsForTable = (dashboardId: number, tableId: number): DashboardTableView[] => {
  return db
    .prepare("SELECT * FROM dashboard_table_views WHERE dashboard_id = ? AND table_id = ? ORDER BY created_at ASC")
    .all(dashboardId, tableId)
    .map(mapView);
};

export const getView = (id: number): DashboardTableView | undefined => {
  const row = db.prepare("SELECT * FROM dashboard_table_views WHERE id = ?").get(id);
  return row ? mapView(row) : undefined;
};

export const createView = (
  dashboardId: number,
  tableId: number,
  viewName: string,
  filterClause: string
): DashboardTableView => {
  const stmt = db.prepare(
    "INSERT INTO dashboard_table_views (dashboard_id, table_id, view_name, filter_clause, status) VALUES (?, ?, ?, ?, 'pending')"
  );
  const result = stmt.run(dashboardId, tableId, viewName, filterClause);
  return getView(Number(result.lastInsertRowid)) as DashboardTableView;
};

export const updateViewStatus = (
  id: number,
  status: DashboardTableView["status"],
  errorMessage?: string
): DashboardTableView | undefined => {
  db.prepare(
    "UPDATE dashboard_table_views SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, errorMessage ?? null, id);
  return getView(id);
};

export const updateViewFilter = (
  id: number,
  filterClause: string
): DashboardTableView | undefined => {
  db.prepare(
    "UPDATE dashboard_table_views SET filter_clause = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?"
  ).run(filterClause, id);
  return getView(id);
};

export const deleteView = (id: number): boolean => {
  const result = db.prepare("DELETE FROM dashboard_table_views WHERE id = ?").run(id);
  return result.changes > 0;
};

// --- Dashboard Layers (Phase 12) ---

export const listDashboardLayers = (dashboardId: number): DashboardLayer[] => {
  return db
    .prepare("SELECT * FROM dashboard_layers WHERE dashboard_id = ? ORDER BY position ASC, id ASC")
    .all(dashboardId)
    .map(mapDashboardLayer);
};

export const getDashboardLayer = (id: number): DashboardLayer | undefined => {
  const row = db.prepare("SELECT * FROM dashboard_layers WHERE id = ?").get(id);
  return row ? mapDashboardLayer(row) : undefined;
};

export const createDashboardLayer = (
  dashboardId: number,
  input: { table_id: number; layer_type?: "KineticaWms"; position?: number; config?: Record<string, unknown> }
): DashboardLayer => {
  // Default position = current max + 1 for this dashboard
  const maxRow = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS max_pos FROM dashboard_layers WHERE dashboard_id = ?")
    .get(dashboardId) as { max_pos: number };
  const nextPosition = input.position ?? (maxRow.max_pos + 1);
  const stmt = db.prepare(
    "INSERT INTO dashboard_layers (dashboard_id, table_id, layer_type, position, config) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    dashboardId,
    input.table_id,
    input.layer_type ?? "KineticaWms",
    nextPosition,
    JSON.stringify(input.config ?? {})
  );
  return getDashboardLayer(Number(result.lastInsertRowid)) as DashboardLayer;
};

export const updateDashboardLayer = (
  id: number,
  attrs: Partial<Pick<DashboardLayer,
    | "table_id"
    | "position"
    | "config"
    | "info_enabled"
    | "info_columns"
    | "info_template"
    | "dynamic_view_id"
    | "cb_config"
    | "track_config"
    | "filter_scope"
  >>
): DashboardLayer | undefined => {
  const existing = getDashboardLayer(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE dashboard_layers SET table_id = ?, position = ?, config = ?, info_enabled = ?, info_columns = ?, info_template = ?, dynamic_view_id = ?, cb_config = ?, track_config = ?, filter_scope = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    attrs.table_id ?? existing.table_id,
    attrs.position ?? existing.position,
    JSON.stringify(attrs.config ?? existing.config),
    // v1.4 Phase 19: info popup fields. Use `"key" in attrs` to distinguish explicit null
    // (caller clearing the field back to null) from undefined (caller omitting the field).
    // `??` is not used here because `null ?? existing` returns `existing`, silently ignoring
    // an explicit null. `||` is not used because `0 || existing.info_enabled` would drop a
    // deliberate info_enabled=0 disable. `"key" in attrs` is the correct discriminant.
    "info_enabled" in attrs ? attrs.info_enabled : existing.info_enabled,
    "info_columns" in attrs ? attrs.info_columns : existing.info_columns,
    "info_template" in attrs ? attrs.info_template : existing.info_template,
    // v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding. Same discriminant pattern as
    // info_* — explicit `{ dynamic_view_id: null }` CLEARS the binding (operator unbinding a
    // dv-bound layer back to a plain table); omitting the key PRESERVES the existing value.
    "dynamic_view_id" in attrs ? attrs.dynamic_view_id : existing.dynamic_view_id,
    // v1.7 Phase 38 (SCHEMA-V17-02): cb_config + track_config use the same 'key' in attrs
    // discriminant as info_* and dynamic_view_id — explicit null CLEARS the field
    // (operator unbinding cb_config back to "not configured"); omitting the key PRESERVES.
    "cb_config" in attrs ? attrs.cb_config : existing.cb_config,
    "track_config" in attrs ? attrs.track_config : existing.track_config,
    // v1.18 Phase 93 (FSCOPE-V118-02): filter_scope — same discriminant pattern. Value is
    // already a STRING at this layer (route stringified the FilterSelectionConfig object before
    // calling updateDashboardLayer). Explicit null CLEARS; omitting PRESERVES.
    // NOTE: existing.filter_scope comes from mapDashboardLayer which parses it to an object;
    // when preserving we must re-stringify so better-sqlite3 receives a valid bindable value.
    "filter_scope" in attrs
      ? attrs.filter_scope
      : (existing.filter_scope == null
          ? existing.filter_scope
          : JSON.stringify(existing.filter_scope)),
    id
  );
  return getDashboardLayer(id);
};

export const deleteDashboardLayer = (id: number): boolean => {
  const result = db.prepare("DELETE FROM dashboard_layers WHERE id = ?").run(id);
  return result.changes > 0;
};

/**
 * Reorder layers atomically. Accepts an array of layer IDs in the desired order.
 * Normalises positions to 0..N-1. PITFALL (RESEARCH.md Pitfall 6) lock — eliminates
 * gaps left by previous deletes; ALL layers for the dashboard MUST be present in
 * orderedIds (caller sends the full ordered list).
 * Throws if an id does not belong to dashboardId or if the count mismatches.
 */
export const reorderDashboardLayers = (
  dashboardId: number,
  orderedIds: number[]
): DashboardLayer[] => {
  const existing = listDashboardLayers(dashboardId);
  if (existing.length !== orderedIds.length) {
    throw new Error(`reorderDashboardLayers: expected ${existing.length} ids, received ${orderedIds.length}`);
  }
  const existingIds = new Set(existing.map((l) => l.id));
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      throw new Error(`reorderDashboardLayers: layer ${id} not found in dashboard ${dashboardId}`);
    }
  }
  const updateStmt = db.prepare(
    "UPDATE dashboard_layers SET position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const txn = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => updateStmt.run(index, id));
  });
  txn(orderedIds);
  return listDashboardLayers(dashboardId);
};

// --- Dashboard Dynamic Views (Phase 32 v1.6 DV-V16-01) ---

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
  input: {
    source_table_id: number;
    name: string;
    template_sql: string;
    max_records: number;
    columns_json?: { name: string; type: string }[] | null;
  }
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
  // Uses the `"key" in attrs` discriminant (mirrors mapDashboardLayer info_* handling) so an explicit
  // `columns_json: null` clears the field, while omitting the key preserves the existing value.
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

// --- Column Display Config (Phase 75 v1.15 COLCFG-V115-01) ---

const mapColumnDisplayConfig = (row: any): ColumnDisplayConfigRow => ({
  table_id: row.table_id,
  column_name: row.column_name,
  label: row.label ?? null,
  // format_spec is TEXT in SQLite; parse to object on read, re-stringify on write.
  // Null-guard mirrors mapDashboardDynamicView columns_json (Pitfall 4 — never JSON.parse(null)).
  format_spec: row.format_spec ? JSON.parse(row.format_spec) : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const listColumnDisplayConfig = (tableId: number): ColumnDisplayConfigRow[] =>
  db
    .prepare("SELECT * FROM column_display_config WHERE table_id = ? ORDER BY column_name ASC")
    .all(tableId)
    .map(mapColumnDisplayConfig);

export const getColumnDisplayConfig = (
  tableId: number,
  columnName: string
): ColumnDisplayConfigRow | undefined => {
  const row = db
    .prepare("SELECT * FROM column_display_config WHERE table_id = ? AND column_name = ?")
    .get(tableId, columnName);
  return row ? mapColumnDisplayConfig(row) : undefined;
};

export const upsertColumnDisplayConfig = (
  tableId: number,
  columnName: string,
  label: string | null,
  formatSpec: unknown | null
): ColumnDisplayConfigRow => {
  db.prepare(`
    INSERT INTO column_display_config (table_id, column_name, label, format_spec)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(table_id, column_name) DO UPDATE SET
      label = excluded.label,
      format_spec = excluded.format_spec,
      updated_at = datetime('now')
  `).run(
    tableId,
    columnName,
    label ?? null,
    formatSpec ? JSON.stringify(formatSpec) : null
  );
  return getColumnDisplayConfig(tableId, columnName)!;
};

export const deleteColumnDisplayConfig = (tableId: number, columnName: string): boolean => {
  const result = db
    .prepare("DELETE FROM column_display_config WHERE table_id = ? AND column_name = ?")
    .run(tableId, columnName);
  return result.changes > 0;
};
