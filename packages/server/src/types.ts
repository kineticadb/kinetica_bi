export type Dashboard = {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type Table = {
  id: number;
  name: string;
  schema: string;
  description?: string;
  columns: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type DashboardTableView = {
  id: number;
  dashboard_id: number;
  table_id: number;
  view_name: string;
  filter_clause: string;
  status: "pending" | "created" | "error";
  error_message?: string;
  created_at: string;
  updated_at: string;
};

export type Widget = {
  id: number;
  dashboard_id: number;
  title: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// Phase 32 (v1.6 DV-V16-01): saved dynamic-view row shape. `columns_json` is
// TEXT in SQLite (JSON-encoded array of { name, type }); the mapper decodes it
// to a typed array on read and re-encodes on write. `null` means the view has
// never been previewed yet (Plan 02 update endpoint clears it when
// template_sql changes — see CONTEXT.md § D3).
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

export type LayerType = "KineticaWms";

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
  // v1.6 Phase 35 (DV-V16-13): logical FK to dashboard_dynamic_views.id; NULL when layer is
  // table/filter-view-bound. Soft FK at the SQLite level (no REFERENCES) — same rationale as
  // table_id (see db.ts:86-87 lock): layer survives dv deletion; renderer detects orphan and
  // surfaces "Some layers over threshold" overlay. table_id stays NOT NULL — when dv-bound,
  // table_id = dv.source_table_id (set by the ChartConfigPanel/LayersModal picker; routing
  // through buildWmsParams precedence handles the dv-vs-table LAYERS-swap downstream).
  dynamic_view_id: number | null;
  // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns. Raw
  // JSON strings on the wire — deserialized at the frontend boundary via
  // src/lib/cbConfig.ts (cb_config) and Phase 40 form code (track_config).
  // NULL = "not yet configured"; backward-compat readers default to EMPTY_CB_CONFIG /
  // empty track config. PRAGMA-guarded ALTER (db.ts:159-187 block) supplies these as
  // TEXT NULL — existing pre-v1.7 rows surface as null and render as raster.
  cb_config: string | null;
  track_config: string | null;
  created_at: string;
  updated_at: string;
};
