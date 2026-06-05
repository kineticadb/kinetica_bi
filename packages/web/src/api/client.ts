import type { ActiveFilter } from "../store/filterStore";
import type { SpatialTarget } from "../lib/spatialTargets";
import { useToastStore } from "../store/toast";

export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const UNAUTHORIZED_EVENT = "kbi:unauthorized";
export const PERMISSION_DENIED_EVENT = "kbi:permission-denied";

// Module-level debounce timer for PERMISSION_DENIED_EVENT dispatch.
// N parallel 403/PERMISSION_DENIED responses collapse into a single /me re-fetch.
let permissionDeniedRefetchTimer: ReturnType<typeof setTimeout> | null = null;

// --- Client-side error classes ---

export class ReauthRequiredError extends Error {
  readonly status = 401 as const;
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PermissionError extends Error {
  readonly status = 403 as const;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UpstreamError extends Error {
  readonly status = 502 as const;
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Network layer ---

const apiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401 && typeof window !== "undefined") {
    // Body-peek for code: "REAUTH_REQUIRED". Clone so the original response stream
    // remains consumable by the caller. Failure to parse → fall back to no-dispatch
    // (defensive — future 401 reasons should NOT logout the user unless the server
    // explicitly says REAUTH_REQUIRED).
    let shouldDispatch = false;
    try {
      const peek = await response.clone().json();
      if (peek && typeof peek === "object" && (peek as { code?: string }).code === "REAUTH_REQUIRED") {
        shouldDispatch = true;
      }
    } catch {
      // body wasn't JSON or already consumed — do not dispatch
    }
    if (shouldDispatch) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
  }
  if (response.status === 403 && typeof window !== "undefined") {
    try {
      const peek = await response.clone().json();
      if (peek && typeof peek === "object" && (peek as { code?: string }).code === "PERMISSION_DENIED") {
        const perm = typeof (peek as { permission?: unknown }).permission === "string"
          ? (peek as { permission: string }).permission : "a required permission";
        useToastStore.getState().showToast(`You no longer have permission: ${perm}`, "permission");
        if (permissionDeniedRefetchTimer !== null) clearTimeout(permissionDeniedRefetchTimer);
        permissionDeniedRefetchTimer = setTimeout(() => {
          permissionDeniedRefetchTimer = null;
          window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT));
        }, 200);
      }
    } catch {
      // body wasn't JSON or already consumed — do not dispatch
    }
  }
  return response;
};

// --- Internal helper to extract error message and throw the right class ---

const throwForStatus = async (response: Response, fallbackMessage: string): Promise<never> => {
  // Try to read { error: string } from JSON body; fall back to text or status code.
  let message = fallbackMessage;
  try {
    const body = await response.clone().json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      message = (body as { error: string }).error;
    }
  } catch {
    const text = await response.text().catch(() => "");
    if (text) message = `${fallbackMessage}: ${text}`;
  }
  if (response.status === 401) throw new ReauthRequiredError(message);
  if (response.status === 403) throw new PermissionError(message);
  if (response.status === 502) throw new UpstreamError(message);
  // Preserve server-extracted message when present (Phase 34 DV-V16-09 / DV-V16-10).
  // When the body had { error: "..." } JSON, `message` is the server's verbatim string.
  // When the body was text, `message` is "${fallbackMessage}: ${text}" (see catch block above).
  // When neither, `message` is the fallback. This keeps existing 4xx/5xx callers backward-compatible
  // while letting Phase 34's DynamicViewsModal surface verbatim {view}-token errors.
  throw new Error(message);
};

// --- Auth ---

export type AuthUser = { username: string; roles: string[]; permissions: string[] };

// Phase 7 (UX-08 / OIDC-01): runtime auth-mode discovery — used by store/auth.ts bootstrap()
// and by LoginPage.tsx for the OIDC SSO branch.
export type AuthMode = "password" | "oidc";
export type AuthConfig = { authMode: AuthMode };

// IMPORTANT: raw fetch (NOT apiFetch). The endpoint is unauthenticated and must NOT
// trigger UNAUTHORIZED_EVENT if it 401s or fails. Caller (bootstrap) wraps in try/catch.
export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
  if (!response.ok) throw new Error(`Failed to load auth config: ${response.status}`);
  return response.json() as Promise<AuthConfig>;
};

// Phase 7 (UX-08): /me now returns authMode alongside user. Expanded MeResponse type.
export type MeResponse = { user: AuthUser; authMode: AuthMode };

export const login = async (username: string, password: string): Promise<AuthUser> => {
  const response = await apiFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error || `Login failed: ${response.status}`);
  }
  return json.user as AuthUser;
};

export const logout = async (): Promise<void> => {
  await apiFetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
};

export const fetchMe = async (): Promise<MeResponse | null> => {
  // Intentionally uses raw fetch (not apiFetch) — treats 401 as "not authenticated",
  // not as a session expiry. DO NOT migrate to throwForStatus.
  const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Failed to load session: ${response.status}`);
  const json = await response.json();
  return {
    user: {
      username: json.user.username,
      roles: json.user.roles ?? [],
      permissions: json.user.permissions ?? [],
    },
    authMode: json.authMode as AuthMode,
  };
};

export const runSql = async <T = unknown>(
  sql: string,
  options?: Record<string, unknown>,
  signal?: AbortSignal // Phase 9 FILT-02: additive — AbortController wiring in AggregatedWidgetRenderer
): Promise<T> => {
  const response = await apiFetch(`${API_BASE}/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, options }),
    signal
  });

  if (!response.ok) {
    await throwForStatus(response, "SQL request failed");
  }

  return response.json() as Promise<T>;
};

export const apiHealth = async () => {
  const response = await apiFetch(`${API_BASE}/api/health`);
  return response.json();
};

export type DashboardDto = {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export const createDashboard = async (input: Pick<DashboardDto, "name"> & Partial<Pick<DashboardDto, "description">>): Promise<DashboardDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to create dashboard");
  }
  return response.json() as Promise<DashboardDto>;
};

export const updateDashboard = async (id: number, attrs: Partial<Pick<DashboardDto, "name" | "description">>): Promise<DashboardDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to update dashboard");
  }
  return response.json() as Promise<DashboardDto>;
};

export const deleteDashboard = async (id: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete dashboard");
  }
};

export const listDashboardTables = async (dashboardId: number): Promise<TableDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/tables`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load dashboard tables");
  }
  const json = await response.json();
  return json.data as TableDto[];
};

export const addDashboardTable = async (dashboardId: number, tableId: number): Promise<TableDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table_id: tableId })
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to add table");
  }
  const json = await response.json();
  return json.data as TableDto[];
};

export const removeDashboardTable = async (dashboardId: number, tableId: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/tables/${tableId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to remove table");
  }
};

export const listDashboards = async (): Promise<DashboardDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load dashboards");
  }
  const json = await response.json();
  return json.data as DashboardDto[];
};

export type TableDto = {
  id: number;
  name: string;
  schema: string;
  description?: string;
  columns: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export const listTables = async (): Promise<TableDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/tables`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load tables");
  }
  const json = await response.json();
  return json.data as TableDto[];
};

export const getTableById = async (id: number): Promise<TableDto> => {
  const response = await apiFetch(`${API_BASE}/api/tables/${id}`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load table");
  }
  return response.json() as Promise<TableDto>;
};

export const createTableEntry = async (input: Pick<TableDto, "name" | "schema" | "columns"> & Partial<Pick<TableDto, "description">>): Promise<TableDto> => {
  const response = await apiFetch(`${API_BASE}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to create table");
  }
  return response.json() as Promise<TableDto>;
};

export const fetchKineticaSchemas = async (): Promise<string[]> => {
  const response = await apiFetch(`${API_BASE}/api/kinetica/schemas`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load schemas");
  }
  const json = await response.json();
  return json.data as string[];
};

export const fetchKineticaTables = async (schema: string): Promise<string[]> => {
  const response = await apiFetch(`${API_BASE}/api/kinetica/schemas/${encodeURIComponent(schema)}/tables`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load tables");
  }
  const json = await response.json();
  return json.data as string[];
};

export const fetchKineticaColumns = async (schema: string, table: string): Promise<Record<string, string>> => {
  const response = await apiFetch(`${API_BASE}/api/kinetica/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load columns");
  }
  const json = await response.json();
  return json.data as Record<string, string>;
};

// --- Widgets ---

export type WidgetDto = {
  id: number;
  dashboard_id: number;
  title: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const listWidgets = async (dashboardId: number): Promise<WidgetDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/widgets`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load widgets");
  }
  const json = await response.json();
  return json.data as WidgetDto[];
};

export const createWidget = async (
  dashboardId: number,
  input: Pick<WidgetDto, "title" | "type"> & Partial<Pick<WidgetDto, "position" | "config">>
): Promise<WidgetDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/widgets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to create widget");
  }
  return response.json() as Promise<WidgetDto>;
};

export const updateWidget = async (
  id: number,
  attrs: Partial<Pick<WidgetDto, "title" | "type" | "position" | "config">>
): Promise<WidgetDto> => {
  const response = await apiFetch(`${API_BASE}/api/widgets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to update widget");
  }
  return response.json() as Promise<WidgetDto>;
};

export const deleteWidget = async (id: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/widgets/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete widget");
  }
};

export const deleteTableEntry = async (id: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/tables/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete table");
  }
};

// --- Views ---

export type ViewDto = {
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

export const listViews = async (dashboardId: number): Promise<ViewDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/views`);
  if (!response.ok) {
    await throwForStatus(response, "Failed to load views");
  }
  const json = await response.json();
  return json.data as ViewDto[];
};

export const createView = async (
  dashboardId: number,
  input: { table_id: number; view_name: string; filter_clause: string }
): Promise<ViewDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to create view");
  }
  return response.json() as Promise<ViewDto>;
};

export const updateViewFilter = async (
  id: number,
  filterClause: string
): Promise<ViewDto> => {
  const response = await apiFetch(`${API_BASE}/api/views/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter_clause: filterClause })
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to update view");
  }
  return response.json() as Promise<ViewDto>;
};

export const deleteView = async (id: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/views/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete view");
  }
};

export const materializeView = async (id: number): Promise<{ view: ViewDto; ddl?: string }> => {
  const response = await apiFetch(`${API_BASE}/api/views/${id}/materialize`, { method: "POST" });
  if (!response.ok) {
    await throwForStatus(response, "Failed to materialize view");
  }
  return response.json() as Promise<{ view: ViewDto; ddl: string }>;
};

export const updateTable = async (id: number, attrs: Partial<Pick<TableDto, "name" | "schema" | "description" | "columns">>): Promise<TableDto> => {
  const response = await apiFetch(`${API_BASE}/api/tables/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs)
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to update table");
  }
  return response.json() as Promise<TableDto>;
};

// ─── Dashboard Layers (Phase 12) ──────────────────────────────────────────
// CRUD against /api/dashboards/:id/layers — server route in packages/server/src/index.ts (Plan 12-01).
// PATCH /reorder is a SEPARATE endpoint registered BEFORE /:layerId (Express order matters);
// see 12-01-PLAN.md for the precedence note.

export type LayerType = "KineticaWms";

export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  // v1.4 Phase 19 (CONFIG-V14-01/02): info popup config columns mirroring the server-side
  // DashboardLayer type. SQLite returns INTEGER as number (0 | 1) and NULL TEXT as JS null.
  // info_columns is the raw JSON-array string ('["lon","lat"]') — Phase 21 popup parses it.
  // info_template is the raw HTML template string — Phase 21 popup renders it directly
  // (no sanitization per locked Key Decision in PROJECT.md).
  info_enabled: number;
  info_columns: string | null;
  info_template: string | null;
  // v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding. Byte-for-byte mirror of
  // the server-side DashboardLayer.dynamic_view_id. NULL when layer is table/filter-view-bound;
  // non-null when bound to a dashboard_dynamic_views.id. Plan 35-02 buildWmsParams + Plan 35-06
  // LayersModal "Data Source" picker consume this field for the LAYERS-swap precedence.
  dynamic_view_id: number | null;
  // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns mirroring
  // the server-side DashboardLayer extension byte-for-byte. Raw JSON strings on the wire;
  // frontend deserializes via lib/cbConfig.ts coalesceCbConfig() at consumer sites (Phase
  // 38-02 wmsUrlBuilder cb_raster branch + Phase 39 form UI). NULL = "not yet configured";
  // legacy widgets render as raster because wmsUrlBuilder coalesces null → EMPTY_CB_CONFIG
  // and gates Lane C emission on isCbConfigConfigured.
  cb_config: string | null;
  track_config: string | null;
  created_at: string;
  updated_at: string;
};

export const listDashboardLayers = async (dashboardId: number): Promise<DashboardLayerDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/layers`);
  if (!response.ok) await throwForStatus(response, "Failed to load layers");
  const json = await response.json();
  return json.data as DashboardLayerDto[];
};

export const createLayer = async (
  dashboardId: number,
  input: { table_id: number; layer_type?: LayerType; position?: number; config?: Record<string, unknown> }
): Promise<DashboardLayerDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/layers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwForStatus(response, "Failed to create layer");
  return response.json() as Promise<DashboardLayerDto>;
};

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
    | "dynamic_view_id"
    | "cb_config"
    | "track_config"
  >>
): Promise<DashboardLayerDto> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/layers/${layerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });
  if (!response.ok) await throwForStatus(response, "Failed to update layer");
  return response.json() as Promise<DashboardLayerDto>;
};

export const deleteLayer = async (dashboardId: number, layerId: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/layers/${layerId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete layer");
  }
};

export const reorderLayers = async (
  dashboardId: number,
  orderedIds: number[]
): Promise<DashboardLayerDto[]> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/layers/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  if (!response.ok) await throwForStatus(response, "Failed to reorder layers");
  const json = await response.json();
  return json.data as DashboardLayerDto[];
};

// Phase 11: WMS capabilities probe (MAP-01, MAP-02)
export type WmsCapabilitiesDto = {
  renderModes: ("raster" | "heatmap" | "classbreak" | "contour")[];
  colormaps: string[];
  spatialModes: ("latlon" | "wkt" | "wkb")[];
  srs: string[];
  source: "probed" | "fallback";
};

export async function fetchWmsCapabilities(
  signal?: AbortSignal
): Promise<WmsCapabilitiesDto> {
  const response = await apiFetch(`${API_BASE}/api/wms/capabilities`, { signal });
  if (!response.ok) {
    throw new Error(`fetchWmsCapabilities failed: ${response.status}`);
  }
  return response.json() as Promise<WmsCapabilitiesDto>;
}

// ---------------------------------------------------------------------------
// Phase 14 (VSTORE-V13-04): client helpers for POST/DELETE /api/filter/materialize.
//
// Phase 13 endpoint contract (locked at .planning/STATE.md):
//   POST   /api/filter/materialize  body:  { dashboardId, tableId, filters }
//                                   resp:  { viewName, expiresAt }
//   DELETE /api/filter/materialize  query: ?dashboardId=N&tableId=M
//                                   resp:  { dropped: true }   (200, NOT 204)
//
// AbortSignal threading (V13-P-10 lock): caller (Phase 15 AggregatedWidgetRenderer)
// will wire a dedicated `materializeAbortRef` SEPARATE from the chart-query
// AbortController so rapid filter changes can cancel in-flight materialize calls
// without aborting the chart-query that's about to FROM-swap.
//
// Error contract: throwForStatus maps 401/403/502 to ReauthRequiredError /
// PermissionError / UpstreamError (typed-error chain consumed by Phase 15's catch path).
// AbortError propagates natively — helpers do NOT swallow.
//
// Phase 14 ships these helpers DORMANT — Phase 15 wires the first production caller.
// ---------------------------------------------------------------------------

/**
 * Phase 30 (MAT-V15-02): wire shape of a single spatial filter sent to the server.
 *
 * BYTE-PARITY with server `packages/server/src/lib/spatialWhereClause.ts` (SpatialFilter).
 * Note this is intentionally MINIMAL — the client useSpatialFilterStore Shape carries
 * richer fields (type, label, measurement, addedAt) for UI use; only id + wkt cross the wire.
 * The Shape → SpatialFilter projection happens at the Plan 30-02 AggregatedWidgetRenderer
 * call site (NOT inside this helper) — keeping the helper UI-state-agnostic.
 */
export type SpatialFilter = {
  id: string;
  wkt: string;
};

// Re-export SpatialTarget from lib/spatialTargets so client-side callers have a single
// import path for materialize args. Type is BYTE-PARITY with server (see lib/spatialTargets.ts header).
export type { SpatialTarget } from "../lib/spatialTargets";

export type MaterializeFilterArgs = {
  dashboardId: number;
  tableId: number;
  // ActiveFilter shape is duplicated server-side at packages/server/src/lib/whereClause.ts:35-42
  // to keep the server module frontend-import-free. Field-shape parity is the contract —
  // any change to the client ActiveFilter MUST be mirrored in whereClause.ts atomically.
  filters: ActiveFilter[];
  // Phase 30 (MAT-V15-02): optional spatial extension. Both fields must be present together
  // OR both absent — the server pair-completeness check (POST /api/filter/materialize
  // step 3) returns 400 on partial submission. Plan 30-02 AggregatedWidgetRenderer is the
  // sole caller that sets these; v1.3 column-only callers leave both undefined.
  spatialFilters?: SpatialFilter[];
  spatialTarget?: SpatialTarget;
};

export type MaterializeFilterResponse = {
  viewName: string;
  expiresAt: number;
};

// Post-VERIFY (Phase 35 follow-up): in-flight dedup for concurrent materializeFilter calls
// on the same (dashboardId, tableId). Phase 30's RecordsTableRenderer materialize trigger
// (WidgetRenderer.tsx:1385) intentionally duplicates AggregatedWidgetRenderer's Effect 1 to
// close TD-V15-MAP-ONLY-TRIGGER. When a dashboard has BOTH a chart AND a records-table on
// the same table, every spatial-filter mutation fires two parallel POSTs (observed: ~100ms
// apart). The server's CREATE OR REPLACE is correct but the redundant DDL load is wasteful
// and surfaces as user-visible "2 materialize calls per filter."
//
// Cache key = `${dashboardId}:${tableId}` (NOT the full args — different filters/shapes on
// the SAME (dashboardId, tableId) should still collapse: the first call materializes one
// canonical view name for that pair, and stale args would be re-fired on the next debounce
// tick anyway. The server's last-write-wins (V13-P-09) handles content drift.)
//
// On abort: dropped from the cache so a subsequent call re-fires. On any settle (resolve or
// reject), entry is removed via promise.finally so transient failures don't poison the cache.
const inFlightMaterialize = new Map<string, Promise<MaterializeFilterResponse>>();

export const materializeFilter = async (
  args: MaterializeFilterArgs,
  signal?: AbortSignal
): Promise<MaterializeFilterResponse> => {
  const cacheKey = `${args.dashboardId}:${args.tableId}`;
  const existing = inFlightMaterialize.get(cacheKey);
  if (existing) {
    // Concurrent caller (e.g. RecordsTableRenderer trigger firing alongside
    // AggregatedWidgetRenderer Effect 1 for the same table) — join the in-flight promise.
    // We deliberately do NOT honor the caller's `signal` here: aborting one consumer's
    // request would also abort the in-flight shared promise that other consumers are
    // awaiting. The caller can ignore the resolved result via its own AbortController
    // pattern (the renderer's existing materializeAbortRef does this — Effect 2's chart
    // query checks viewName freshness via the store version counter).
    return existing;
  }
  const promise = (async () => {
    const response = await apiFetch(`${API_BASE}/api/filter/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal,
    });
    if (!response.ok) {
      await throwForStatus(response, "Failed to materialize filter view");
    }
    return response.json() as Promise<MaterializeFilterResponse>;
  })();
  inFlightMaterialize.set(cacheKey, promise);
  // Clear entry on settle (success OR failure) so the NEXT call re-fires fresh.
  // Using explicit then(onFulfilled, onRejected) instead of .finally().catch() — the
  // dual-handler form does NOT create a derived promise that would propagate the
  // original rejection as an "unhandled rejection." The caller (returned `promise`)
  // is responsible for its own .catch handling; our cleanup is fire-and-forget.
  void promise.then(
    () => {
      if (inFlightMaterialize.get(cacheKey) === promise) {
        inFlightMaterialize.delete(cacheKey);
      }
    },
    () => {
      if (inFlightMaterialize.get(cacheKey) === promise) {
        inFlightMaterialize.delete(cacheKey);
      }
    },
  );
  return promise;
};

export type DropFilterViewArgs = {
  dashboardId: number;
  tableId: number;
};

export type DropFilterViewResponse = {
  dropped: true;
};

// Post-VERIFY (Phase 35 follow-up): in-flight dedup for dropFilterView.
// Same pattern as materializeFilter's inFlightMaterialize cache. AggregatedWidget
// Effect 1 AND RecordsTableRenderer's spatial-trigger effect both fire dropFilterView
// when filters clear for a table, producing two parallel DELETE requests with
// identical (dashboardId, tableId) query params (observed: ~6ms apart in live UAT).
// The server endpoint is idempotent (DROP IF EXISTS) but the redundant DDL load +
// network noise is wasteful and visible to the operator. Concurrent callers
// collapse to one HTTP DELETE; both await the same promise.
const inFlightDrop = new Map<string, Promise<DropFilterViewResponse>>();

export const dropFilterView = async (
  args: DropFilterViewArgs,
  signal?: AbortSignal
): Promise<DropFilterViewResponse> => {
  const cacheKey = `${args.dashboardId}:${args.tableId}`;
  const existing = inFlightDrop.get(cacheKey);
  if (existing) {
    // Concurrent caller (e.g. RecordsTableRenderer drop firing alongside
    // AggregatedWidgetRenderer Effect 1 drop for the same table) — join the
    // in-flight promise. AbortSignal handling matches materializeFilter:
    // deliberately NOT honored on cache joins to avoid aborting the shared
    // promise that other consumers are awaiting.
    return existing;
  }
  // Inline template literal for the query string — matches the existing convention used by
  // deleteDashboard at client.ts:183. URLSearchParams is overkill for two known number params.
  const url = `${API_BASE}/api/filter/materialize?dashboardId=${args.dashboardId}&tableId=${args.tableId}`;
  const promise = (async () => {
    const response = await apiFetch(url, {
      method: "DELETE",
      signal,
    });
    // Phase 13 endpoint returns 200 with { dropped: true } — NOT 204. Do NOT replicate the
    // `response.status !== 204` short-circuit from deleteDashboard at client.ts:184.
    if (!response.ok) {
      await throwForStatus(response, "Failed to drop filter view");
    }
    return response.json() as Promise<DropFilterViewResponse>;
  })();
  inFlightDrop.set(cacheKey, promise);
  // Clear on settle so a subsequent drop fires fresh. Explicit dual-handler form
  // avoids the unhandled-rejection chain that .finally().catch() produces.
  void promise.then(
    () => {
      if (inFlightDrop.get(cacheKey) === promise) {
        inFlightDrop.delete(cacheKey);
      }
    },
    () => {
      if (inFlightDrop.get(cacheKey) === promise) {
        inFlightDrop.delete(cacheKey);
      }
    },
  );
  return promise;
};

// ---------------------------------------------------------------------------
// Phase 21 (POPUP-V14-01..06): client helper for POST /api/info/query.
//
// Phase 18 endpoint contract (locked at .planning/phases/18-spatial-spike-and-endpoint
// /18-VERIFICATION.md and packages/server/src/index.ts:787-940):
//   POST /api/info/query
//     body:  { layerId, tableId, schema, table, spatialMode, spatialColumns,
//              clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx, page }
//     resp:  { rows, columns, hasMore, page }
//     501:   spatialMode='wkb' returns { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }
//
// AbortSignal threading (mirrors V13-P-10 lock from materializeFilter): caller (Plan 21-03
// MapChartRenderer click handler) wires a dedicated `infoQueryAbortRef` to abort the
// sequential fan-out on re-click and on dropdown switch.
//
// Error contract: throwForStatus maps 401/403/502 to ReauthRequiredError /
// PermissionError / UpstreamError. AbortError propagates natively (helper does NOT swallow).
// 501 (WKB-deferred) flows through throwForStatus as a generic non-2xx — caller is
// responsible for filtering WKB layers BEFORE calling this helper (Plan 21-03 eligibleLayers
// useMemo). The helper itself stays mode-agnostic.
// ---------------------------------------------------------------------------

/** Mirrors server SpatialColumns at packages/server/src/lib/spatialQuery.ts:55-60. Field-shape parity is the contract. */
export type SpatialColumns = {
  lonCol?: string;
  latCol?: string;
  wktCol?: string;
  wkbCol?: string;
};

/** Mirrors server SpatialMode at packages/server/src/lib/spatialQuery.ts:45. */
export type InfoSpatialMode = "latlon" | "wkt" | "wkb";

export type InfoQueryRequest = {
  layerId: number;
  tableId: number;
  schema: string;
  table: string;
  // When non-empty, server queries the active v1.3 filter view (FROM <viewName>)
  // instead of the source table. Caller looks up useFilterViewStore.views[tableId]
  // with isViewExpired guard — same pattern WMS layers use.
  viewName?: string;
  spatialMode: InfoSpatialMode;
  spatialColumns: SpatialColumns;
  clickLon: number;      // EPSG:4326 (geographic degrees) — caller transforms from EPSG:3857 OL coord
  clickLat: number;      // EPSG:4326
  radiusPx: number;      // > 0 (server validates)
  mapBbox: [number, number, number, number];  // EPSG:4326 [minLon, minLat, maxLon, maxLat] — caller transforms via transformExtent
  mapWidthPx: number;    // > 0
  mapHeightPx: number;   // > 0
  page: number;          // >= 0 integer (server validates)
};

export type InfoQueryResponse = {
  rows: Record<string, unknown>[];
  columns: string[];
  hasMore: boolean;
  page: number;
  totalEstimate?: number;  // optional per SPATIAL-V14-04; CONTEXT.md notes it may be surfaced inline by popup (design discretion)
};

export const infoQuery = async (
  args: InfoQueryRequest,
  signal?: AbortSignal
): Promise<InfoQueryResponse> => {
  const response = await apiFetch(`${API_BASE}/api/info/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to fetch info records");
  }
  return response.json() as Promise<InfoQueryResponse>;
};

// ===========================================================================
// Phase 33 Plan 03 (DV-V16-07): Dynamic Views client helpers.
//
// Pure pass-through — NONE of these helpers import useDynamicViewStore. Callers
// (Phase 34 modal at create/edit/preview/delete; Phase 35 renderer at markPending →
// materialize → setView; this plan's lifecycle wiring at App.tsx + DashboardsPage.tsx)
// own all store side-effects. Locked across v1.3 / v1.4 / v1.5 / v1.6.
//
// All helpers thread AbortSignal? per V13-P-10 — caller may abort in-flight calls
// when dropdowns switch, dashboards unmount, or AbortControllers re-fire.
//
// Type byte-parity (Plan 32 § D3 pattern): DynamicViewRow mirrors server
// DashboardDynamicView at packages/server/src/db.ts verbatim.
// ===========================================================================

/** Server-side row shape from packages/server/src/db.ts DashboardDynamicView (Plan 32). */
export type DynamicViewRow = {
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number; // 0 = unlimited (no row cap); positive = row-count threshold
  // Post-VERIFY type fix: server-side `mapDashboardDynamicView` (db.ts:574) parses the
  // stored TEXT and ships a parsed array on the wire — NOT the raw stringified form. The
  // original type `string | null` was incorrect and caused consumers (e.g., LayersModal
  // formColumns derivation) to JSON.parse a non-string and silently fall through to []
  // (empty column pickers). The union accommodates BOTH for backward-compat with any
  // pre-fix data paths; runtime consumers must accept either shape.
  columns_json: { name: string; type: string }[] | string | null;
  created_at: string;
  updated_at: string;
};

/** Preview response column metadata — name + Kinetica column datatype string. */
export type DynamicViewColumn = {
  name: string;
  type: string;
};

/** Discriminated union by `status` — three response branches from POST /api/dynamic-view/materialize. */
export type MaterializeDynamicViewResponse =
  | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
  | { status: "over_threshold"; reason: "no_filter" }
  | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number };

/** Preview response — rows are column-major arrays (raw Kinetica shape). */
export type PreviewDynamicViewResponse = {
  rows: unknown[][];
  columns: DynamicViewColumn[];
};

/** GET /api/dashboards/:dashboardId/dynamic-views — list. */
export const listDynamicViews = async (
  dashboardId: number,
  signal?: AbortSignal,
): Promise<{ dynamic_views: DynamicViewRow[] }> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/dynamic-views`, {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to list dynamic views");
  }
  return response.json() as Promise<{ dynamic_views: DynamicViewRow[] }>;
};

export type CreateDynamicViewArgs = {
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  // Phase 34 post-VERIFY fix: optional on CREATE. The modal sends this when Preview ran
  // successfully before Save. Without it, columns_json stays null on the new row and
  // Phase 35 column pickers (ChartConfigPanel + LayersModal) have nothing to show.
  columns_json?: { name: string; type: string }[];
};

/** POST /api/dashboards/:dashboardId/dynamic-views — create (server validates {view} token; 400 on miss). */
export const createDynamicView = async (
  dashboardId: number,
  body: CreateDynamicViewArgs,
  signal?: AbortSignal,
): Promise<{ dynamic_view: DynamicViewRow }> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/dynamic-views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to create dynamic view");
  }
  return response.json() as Promise<{ dynamic_view: DynamicViewRow }>;
};

export type UpdateDynamicViewArgs = Partial<{
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  // Post-VERIFY type fix: server PUT handler expects PARSED array (validates shape at
  // line 927). The original `string | null` declaration caused silent double-encoding
  // (client JSON.stringify'd a string → server stored "\"[...]\"" in SQLite).
  columns_json: { name: string; type: string }[] | null;
}>;

/** PUT /api/dynamic-views/:id — partial update; server clears columns_json automatically on template_sql change. */
export const updateDynamicView = async (
  id: number,
  body: UpdateDynamicViewArgs,
  signal?: AbortSignal,
): Promise<{ dynamic_view: DynamicViewRow }> => {
  const response = await apiFetch(`${API_BASE}/api/dynamic-views/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to update dynamic view");
  }
  return response.json() as Promise<{ dynamic_view: DynamicViewRow }>;
};

/**
 * DELETE /api/dynamic-view/:id — DESTRUCTIVE: drops Kinetica view AND removes SQLite row.
 * Phase 34 modal "Delete" button is the only authorized caller; NEVER called from reset() path
 * (the reset path uses dropDynamicView for lifecycle cleanup, which preserves the SQLite row).
 */
export const deleteDynamicView = async (
  id: number,
  signal?: AbortSignal,
): Promise<{ deleted: true; dropped?: true }> => {
  const response = await apiFetch(`${API_BASE}/api/dynamic-view/${id}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to delete dynamic view");
  }
  return response.json() as Promise<{ deleted: true; dropped?: true }>;
};

export type PreviewDynamicViewArgs = {
  template_sql: string;
  source_table_id: number;
  dashboard_id: number;
  sample_limit?: number;
};

/** POST /api/dynamic-view/preview — one-shot read; falls back to bare source-table when no active filter view exists. Server clamps sample_limit to [1, 1000], default 100. */
export const previewDynamicView = async (
  body: PreviewDynamicViewArgs,
  signal?: AbortSignal,
): Promise<PreviewDynamicViewResponse> => {
  const response = await apiFetch(`${API_BASE}/api/dynamic-view/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to preview dynamic view");
  }
  return response.json() as Promise<PreviewDynamicViewResponse>;
};

/** POST /api/dynamic-view/materialize — threshold-gated CREATE OR REPLACE. Response is a discriminated union by `status`. */
export const materializeDynamicView = async (
  dynamicViewId: number,
  signal?: AbortSignal,
): Promise<MaterializeDynamicViewResponse> => {
  const response = await apiFetch(`${API_BASE}/api/dynamic-view/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dynamic_view_id: dynamicViewId }),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to materialize dynamic view");
  }
  return response.json() as Promise<MaterializeDynamicViewResponse>;
};

/**
 * POST /api/dynamic-view/:id/drop — Phase 33 Plan 02 endpoint. DROP-only lifecycle
 * cleanup primitive — drops the Kinetica view but leaves the SQLite row intact.
 * Used exclusively by the dynamicViewStore.reset() DROP loop in App.tsx UNAUTHORIZED +
 * DashboardsPage.tsx DashboardOpen cleanup. Fire-and-forget at the callsite:
 * `dropDynamicView(id).catch(() => {})` swallows errors so logout / dashboard switch
 * is never blocked (V13-P-12 carry-forward).
 */
export const dropDynamicView = async (
  id: number,
  signal?: AbortSignal,
): Promise<{ dropped: true }> => {
  const response = await apiFetch(`${API_BASE}/api/dynamic-view/${id}/drop`, {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to drop dynamic view");
  }
  return response.json() as Promise<{ dropped: true }>;
};

// ---------------------------------------------------------------------------
// v1.7 Phase 38 (SCHEMA-V17-06): /api/quantile client helper for Phase 39
// Auto-suggest classbreak boundaries.
//
// Server route: POST /api/quantile { schema, table, column, n } → { breaks: number[] }.
// SQL template locked in .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision.
//
// AbortSignal threading mirrors materializeFilter — Phase 39 Auto-suggest button
// wires a dedicated AbortController so rapid re-clicks cancel the in-flight call.
// NO in-flight dedup needed (single quantile call per operator action; not a fan-out).
//
// Error contract: throwForStatus maps 401/403/502 to ReauthRequiredError /
// PermissionError / UpstreamError (typed-error chain). Phase 39 useApiQuery
// surfaces failures as inline error text under the [Auto-suggest] CTA — no toast.
// ---------------------------------------------------------------------------

export type QuantileArgs = {
  schema: string;
  table: string;
  column: string;
  n: number;
};

export type QuantileResponse = {
  breaks: number[]; // length === n - 1 (server drops bucket 1's MIN per 37-SPIKE-NOTES.md)
};

export const quantileFn = async (
  args: QuantileArgs,
  signal?: AbortSignal,
): Promise<QuantileResponse> => {
  const response = await apiFetch(`${API_BASE}/api/quantile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to fetch quantile breaks");
  }
  return response.json() as Promise<QuantileResponse>;
};

// Categorical Auto-suggest: top-N distinct values by frequency (GROUP BY + COUNT(*)).
export type TopValuesArgs = {
  schema: string;
  table: string;
  column: string;
  n: number;
};

export type TopValuesResponse = {
  values: string[]; // descending-frequency distinct values, length <= n
};

export const topValuesFn = async (
  args: TopValuesArgs,
  signal?: AbortSignal,
): Promise<TopValuesResponse> => {
  const response = await apiFetch(`${API_BASE}/api/top-values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to fetch top values");
  }
  return response.json() as Promise<TopValuesResponse>;
};

// Numeric column stats backing Equal-Interval + Standard-Deviation classification.
export type ColumnStatsArgs = {
  schema: string;
  table: string;
  column: string;
};

export type ColumnStatsResponse = {
  min: number;
  max: number;
  mean: number;
  stddev: number;
};

export const columnStatsFn = async (
  args: ColumnStatsArgs,
  signal?: AbortSignal,
): Promise<ColumnStatsResponse> => {
  const response = await apiFetch(`${API_BASE}/api/column-stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to fetch column stats");
  }
  return response.json() as Promise<ColumnStatsResponse>;
};
