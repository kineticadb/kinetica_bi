# Architecture Research: v1.2 Interactive Dashboards

**Domain:** Adding map chart + click-driven drill-down + cross-chart filter coordination to an existing Kinetica BI app
**Researched:** 2026-05-01
**Confidence:** HIGH — all findings derived from direct codebase read; no speculation

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Browser (React 18 + TS)                        │
├──────────────────────────┬──────────────────────────────────────────────┤
│  Dashboard / WidgetGrid  │  Filter Bar (per-table, active filters)       │
│  (react-grid-layout)     │  MODIFIED: add filters from drill-down        │
├──────────────────────────┴──────────────────────────────────────────────┤
│                         Widget Renderers                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │BarRenderer│ │LineRend. │ │PieRend.  │ │ScatterR. │ │MapRenderer   │  │
│  │MODIFIED  │ │MODIFIED  │ │MODIFIED  │ │MODIFIED  │ │NEW (OL-based)│  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │            │             │              │           │
│       └────────────┴────────────┴─────────────┴──────────────┘          │
│                         onDrillDown(tableId, column, value)              │
├─────────────────────────────────────────────────────────────────────────┤
│                         Zustand State Layer                              │
│  ┌─────────────┐  ┌──────────────────────────────────────────────────┐  │
│  │ useAuthStore│  │ useFilterStore (NEW)                              │  │
│  │ UNCHANGED   │  │ filters: Map<tableId, ActiveFilter[]>             │  │
│  └─────────────┘  │ addFilter / removeFilter / clearFilters(tableId)  │  │
│                   └──────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                         API Layer (apiFetch / runSql)                    │
│  UNCHANGED for SQL charts — filters injected into SQL WHERE clause       │
│  NEW: apiFetch POST /api/identify for map closest-point probe            │
├─────────────────────────────────────────────────────────────────────────┘
                              │ HTTP (proxied, per-user creds)
┌─────────────────────────────────────────────────────────────────────────┐
│                       Express Backend (port 4000)                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │ GET /api/wms     │  │ POST /api/sql    │  │ POST /api/identify     │ │
│  │ UNCHANGED        │  │ UNCHANGED        │  │ NEW                    │ │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬─────────── ┘ │
│           │                     │                        │              │
│  ┌────────┴─────────────────────┴────────────────────────┴───────────┐  │
│  │ kineticaWms(req, qs) / kineticaSql(req, sql)  — UNCHANGED         │  │
│  │ buildAuthHeader(req) — Bearer (OIDC) or Basic (password)           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                     Kinetica GPU-DB
                    /wms    /execute/sql
```

---

## Component Inventory: NEW vs MODIFIED vs UNCHANGED

### New Files

| File | Status | Responsibility |
|------|--------|----------------|
| `src/store/filterStore.ts` | NEW | Zustand store: `Map<tableId, ActiveFilter[]>`. Owns `addFilter`, `removeFilter`, `clearTableFilters`. Consumed by every chart renderer and the filter bar. This is the cross-chart coordination hub. |
| `src/components/charts/MapRenderer.tsx` | NEW | OpenLayers-backed map component. Fetches WMS tiles via `/api/wms`. Subscribes to `useFilterStore` for the configured `tableId`. Handles map clicks → calls `onDrillDown`. |
| `src/components/charts/definitions/map.ts` | MODIFIED | Existing stub has no spatial config. Must add: `renderMode`, `spatialMode`, `latColumn`, `lonColumn`, `geometryColumn`, `drillDownColumn`, `wmsStyle`. |
| `server/src/index.ts` | MODIFIED | Add `POST /api/identify` route before `app.use("/api", requireAuth)` gate is irrelevant — it IS behind `requireAuth`. |

### Modified Files

| File | Change Summary |
|------|----------------|
| `src/components/charts/WidgetRenderer.tsx` | Add `onDrillDown` prop threading to each renderer. Add `MapRenderer` case to the `switch`. Subscribe to `useFilterStore` and append `WHERE` clause to SQL before fetch. |
| `src/components/charts/registry.ts` | Add optional `drillDownColumn?: string` to `ChartTypeDefinition`. No structural change needed — drill-down is wired at the renderer level and configured via `widget.config.drillDownColumn`. |
| `src/components/charts/definitions/map.ts` | Replace the placeholder with the full descriptor (see Map Config Descriptor section). |
| `kinetica_bi/server/src/index.ts` | Add `POST /api/identify` route. No changes to existing routes. |

### Unchanged Files

| File | Reason |
|------|--------|
| `server/src/kinetica.ts` | `kineticaWms` and `kineticaSql` are credential-type-agnostic and route-agnostic. The `/api/identify` endpoint reuses `kineticaSql` as-is. |
| `server/src/kineticaErrors.ts` | Typed error taxonomy is adequate for all v1.2 failure modes. |
| `server/src/auth.ts` | `requireAuth` middleware is already credential-type-agnostic. |
| `server/src/db.ts` | No new persistence — filters are transient (client memory only). |
| `src/store/auth.ts` | Filter state has no interaction with auth state. |
| `src/store/user.ts` | Unchanged. |
| Filter bar component | Existing per-table filter bar already renders active filters by `tableId`. After `useFilterStore` is added, the filter bar subscribes to the store instead of local state. |

---

## 1. Map Chart Frontend Integration

### Where the MapRenderer Fits

The map chart follows the exact same pattern as the existing `RecordsTableRenderer` — it bypasses the shared `AggregatedWidgetRenderer` SQL/data-fetch path (which fetches aggregated SQL) and owns its data lifecycle entirely. The map does not fetch SQL rows; it fetches WMS tiles from `/api/wms` via `src/api/client.ts`. This is structurally identical to how `RecordsTableRenderer` has its own pagination fetch loop.

**In `WidgetRenderer.tsx`:**

```tsx
const WidgetRenderer = ({ widget, onDrillDown }: Props) => {
  if (widget.type === "records") return <RecordsTableRenderer widget={widget} onDrillDown={onDrillDown} />;
  if (widget.type === "map")     return <MapRenderer widget={widget} onDrillDown={onDrillDown} />;
  return <AggregatedWidgetRenderer widget={widget} onDrillDown={onDrillDown} />;
};
```

### Map Config Descriptor Shape

The existing `map.ts` definition is a placeholder with no spatial fields. It must be fully replaced:

```typescript
// src/components/charts/definitions/map.ts
const map: ChartTypeDefinition = {
  type: "map",
  label: "Map",
  icon: "M",
  // Map has a CustomConfigPanel because spatial column selection
  // cannot be expressed as simple generic fields (conditional fields
  // based on spatialMode). See MapConfigPanel component.
  CustomConfigPanel: MapConfigPanel,
  fields: [], // unused when CustomConfigPanel is set
  defaultConfig: {
    renderMode: "raster",       // "raster" | "heatmap" | "classbreak" | "contour"
    spatialMode: "latlng",      // "latlng" | "wkt" | "wkb"
    latColumn: "",              // used when spatialMode === "latlng"
    lonColumn: "",              // used when spatialMode === "latlng"
    geometryColumn: "",         // used when spatialMode === "wkt" or "wkb"
    drillDownColumn: "",        // column whose value is emitted on map click
    tableRef: "",               // schema.table name used in WMS LAYERS param
    centerLat: 0,
    centerLon: 0,
    zoom: 3,
    // WMS render-mode params (Kinetica-specific)
    wmsColormap: "jet",         // Kinetica color ramp name
    classBreakColumn: "",       // used when renderMode === "classbreak"
    classBreakValues: "",       // comma-separated break values
    opacity: 0.85,
  },
};
```

**Why `CustomConfigPanel`:** The spatial column selector is conditional — `latlng` mode shows two dropdowns (lat + lon); `wkt`/`wkb` shows one geometry dropdown. The generic `FieldRenderer` in `ChartConfigPanel` cannot express this conditionality. The pattern of `CustomConfigPanel` already exists in the registry type.

### How the Map Consumes Filters

The `MapRenderer` subscribes to `useFilterStore` for the widget's configured `tableId` (resolved from `widget.config.tableRef` — the same table ID used for cross-chart sharing). When the filter store changes, the map invalidates and re-fetches WMS tiles by appending a `WHERE` clause to the WMS `QUERY` parameter.

**WMS tile re-fetch on filter change:**

```
Filter changes in useFilterStore for tableId T
  → MapRenderer.useEffect([filters]) fires
  → recomputes filterClause: "col1 = 'val1' AND col2 = 'val2'"
  → rebuilds URLSearchParams with new QUERY param
  → OpenLayers TileLayer source URL changes → OL discards cached tiles, fetches new tiles
```

Kinetica WMS supports a `QUERY` parameter (a WHERE clause applied server-side before rendering). This is the correct mechanism — it filters at the GPU-DB layer, not in the browser. No CQL filter layer is needed.

**OpenLayers tile URL construction:**

```typescript
// Inside MapRenderer, the OL TileWMS source URL factory:
const buildWmsUrl = (filterClause: string) => {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: cfg.tableRef,
    STYLES: cfg.renderMode,   // "raster", "heatmap", etc.
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: "EPSG:4326",
    WIDTH: "256",
    HEIGHT: "256",
    ...(filterClause ? { QUERY: filterClause } : {}),
  });
  return `/api/wms?${params.toString()}`;
};
```

OpenLayers appends `BBOX={minx},{miny},{maxx},{maxy}` to the URL automatically per tile. The proxy at `/api/wms` passes the full query string verbatim to `kineticaWms`, which forwards it to Kinetica. No changes to `kineticaWms` are needed.

---

## 2. WMS Proxy Extension Assessment

**Assessment: UNCHANGED. The existing `kineticaWms` helper is fully compatible with all four render modes.**

Reading `kinetica.ts` confirms `kineticaWms` is transparent:

```typescript
// kineticaWms: takes the full query string from the caller, appends to /wms
const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/wms?${queryString}`, {
  headers: { Authorization: buildAuthHeader(req) },
});
```

The query string is passed verbatim. Kinetica WMS render modes (raster, heatmap, classbreak, contour) are differentiated entirely by WMS parameters (`STYLES`, `QUERY`, custom Kinetica params). The proxy does not inspect or rewrite parameters. Adding a `QUERY` filter param or changing `STYLES` to `heatmap` requires zero server changes.

Reading `index.ts` confirms `/api/wms`:

```typescript
app.get("/api/wms", requireConfig, asyncHandler(async (req, res) => {
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const response = await kineticaWms(req as AuthedRequest, queryString, { route: "GET /api/wms" });
  const contentType = response.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);
  const buffer = Buffer.from(await response.arrayBuffer());
  return res.send(buffer);
}));
```

The route re-encodes all query params from `req.query` into a new `URLSearchParams` string and passes it through. Any WMS parameter the frontend puts in the URL arrives at Kinetica unchanged. This handles all four render modes without modification.

**The only server change for map support is the NEW `/api/identify` endpoint (separate from WMS).**

---

## 3. Closest-Point Identify Endpoint

### Decision: `kineticaSql` with `ST_Distance` ORDER BY LIMIT 1

**Rejected: WMS GetFeatureInfo.** WMS GetFeatureInfo requires `REQUEST=GetFeatureInfo` with `QUERY_LAYERS`, `INFO_FORMAT`, `I`, `J` (pixel coordinates) and `BBOX`/`WIDTH`/`HEIGHT` of the tile the user clicked. This requires the frontend to track which tile was active, which pixel was clicked, and to reconstruct tile metadata at click time. It is feasible but significantly more complex than the SQL path.

**Chosen: `kineticaSql` with `ST_Distance`.** The frontend already knows the clicked map coordinate (latitude, longitude) from the OpenLayers `click` event. A single SQL query with `ORDER BY ST_Distance(...) LIMIT 1` returns the closest point's row. This reuses the existing `kineticaSql` helper and the existing `POST /api/sql` route, or a thin new route. The new route is preferred over `POST /api/sql` because it enforces the spatial-query contract, limits result to 1 row, and generates a clean audit log `op` value.

### Route Design

**Route:** `POST /api/identify`  
**Auth:** Behind `app.use("/api", requireAuth)` — same as all other API routes. `requireAuth` attaches `req.user` with `credentialType` and `creds`.  
**Audit:** Calls `kineticaSql(req, sql, { route: "POST /api/identify", op: "SQL" })` — emits the same audit JSON line as any SQL call.

**Request shape:**

```typescript
type IdentifyRequest = {
  tableRef: string;       // "schema.tablename" — validated server-side
  spatialMode: "latlng" | "wkt" | "wkb";
  latColumn?: string;     // required when spatialMode === "latlng"
  lonColumn?: string;     // required when spatialMode === "latlng"
  geometryColumn?: string;// required when spatialMode === "wkt" or "wkb"
  clickLat: number;       // WGS84 latitude from OL click event
  clickLon: number;       // WGS84 longitude from OL click event
  maxDistance?: number;   // degrees; default 0.01 (~1km). Prevents false hits on sparse data.
  filterClause?: string;  // active filter WHERE clause — identify respects current filters
};
```

**Response shape:**

```typescript
type IdentifyResponse = {
  found: boolean;
  row: Record<string, unknown> | null;   // column name → value for the closest row
  distance: number | null;               // ST_Distance value in degrees
};
```

**Error class on failure:** `KineticaUpstreamError` — thrown by `kineticaSql` on Kinetica errors, translated to HTTP 502 by the existing `errorMiddleware`. No new error class is needed. Input validation (missing `tableRef`, invalid `spatialMode`) returns HTTP 400 directly from the route handler.

**SQL generated server-side (latlng mode):**

```sql
SELECT *, ST_Distance(
  POINT({clickLon}, {clickLat}),
  POINT({lonColumn}, {latColumn})
) AS __identify_distance
FROM {tableRef}
WHERE ST_Distance(
  POINT({clickLon}, {clickLat}),
  POINT({lonColumn}, {latColumn})
) < {maxDistance}
{AND filterClause if present}
ORDER BY __identify_distance ASC
LIMIT 1
```

**SQL for wkt/wkb mode:**

```sql
SELECT *, ST_Distance(
  ST_GeomFromText('POINT({clickLon} {clickLat})'),
  {geometryColumn}
) AS __identify_distance
FROM {tableRef}
WHERE ST_Distance(
  ST_GeomFromText('POINT({clickLon} {clickLat})'),
  {geometryColumn}
) < {maxDistance}
{AND filterClause if present}
ORDER BY __identify_distance ASC
LIMIT 1
```

**Server-side SQL generation note:** Coordinate values are interpolated as numbers (not strings), so they cannot be SQL-injected. `tableRef` and column names must be validated against `/^[a-zA-Z_][a-zA-Z0-9_.]*$/` (same identifier regex used in `RecordsTableRenderer`). The `filterClause` arrives from the client — it must be treated as opaque (user-provided) and should be concatenated as-is. Since the BI app only allows filters created by its own drill-down mechanism (equality filters on known columns), the attack surface is the same as it is for `POST /api/sql`.

**Route implementation sketch:**

```typescript
app.post("/api/identify", requireConfig, asyncHandler(async (req, res) => {
  const { tableRef, spatialMode, latColumn, lonColumn, geometryColumn,
          clickLat, clickLon, maxDistance = 0.01, filterClause } =
    req.body as IdentifyRequest;

  // Input validation — 400 for bad inputs, never 502
  if (!tableRef || !IDENT_RE.test(tableRef)) {
    return res.status(400).json({ error: "tableRef is required and must be a valid identifier." });
  }
  if (typeof clickLat !== "number" || typeof clickLon !== "number") {
    return res.status(400).json({ error: "clickLat and clickLon must be numbers." });
  }
  // ... spatialMode validation

  const distanceExpr = spatialMode === "latlng"
    ? `ST_Distance(POINT(${clickLon}, ${clickLat}), POINT(${lonColumn}, ${latColumn}))`
    : `ST_Distance(ST_GeomFromText('POINT(${clickLon} ${clickLat})'), ${geometryColumn})`;

  const whereClause = [
    `${distanceExpr} < ${maxDistance}`,
    filterClause?.trim() ? filterClause : null,
  ].filter(Boolean).join(" AND ");

  const sql = `SELECT *, ${distanceExpr} AS __identify_distance FROM ${tableRef} WHERE ${whereClause} ORDER BY __identify_distance ASC LIMIT 1`;

  const result = await kineticaSqlHelper(req as AuthedRequest, sql, {
    route: "POST /api/identify",
    op: "SQL",
  }) as Record<string, unknown>;

  // Parse the columnar response into a single row
  const rows = parseColumnarResult(result); // same logic as frontend parseKineticaResponse
  if (rows.length === 0) {
    return res.json({ found: false, row: null, distance: null });
  }
  const row = rows[0];
  const distance = typeof row.__identify_distance === "number" ? row.__identify_distance : null;
  delete row.__identify_distance;
  return res.json({ found: true, row, distance });
}));
```

**Note on `contour` mode:** Contour render mode is excluded from identify support per the locked v1.2 scope decisions. The `/api/identify` route does not need to handle it.

---

## 4. Drill-Down State Model

### Where Filter State Lives: `useFilterStore` (NEW Zustand store)

**Decision:** New dedicated `src/store/filterStore.ts`. Do NOT put filter state in component local state, in `useAuthStore`, in `useUserStore`, or in the dashboard/widget config.

**Rationale:** Filter state must be shared across all charts pointed at the same `tableId`. The only way to achieve automatic cross-chart sharing without prop-drilling through the dashboard grid is a shared store. Zustand is already in use; adding a second store is zero friction.

### State Shape

```typescript
// src/store/filterStore.ts

export type FilterOperator = "eq"; // equality only in v1.2; extensible later

export type ActiveFilter = {
  id: string;                  // randomUUID() at creation — used as React key and for removal
  tableId: number;             // matches the BI app's SQLite table row ID
  column: string;              // column name
  operator: FilterOperator;    // "eq" in v1.2
  value: unknown;              // string, number, or boolean — displayed in filter bar
  source: "drill-down";        // distinguishes drill-down filters from manual filters (future)
};

type FilterState = {
  // Map<tableId, ActiveFilter[]> — one bucket per table
  filters: Record<number, ActiveFilter[]>;
  addFilter: (tableId: number, column: string, value: unknown) => void;
  removeFilter: (filterId: string) => void;
  clearTableFilters: (tableId: number) => void;
  getTableFilters: (tableId: number) => ActiveFilter[];
  buildWhereClause: (tableId: number) => string; // returns "" or "col = 'val' AND ..."
};

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: {},

  addFilter: (tableId, column, value) => set((state) => {
    const existing = state.filters[tableId] ?? [];
    // Idempotent: if an equal filter already exists, do not duplicate
    if (existing.some((f) => f.column === column && f.value === value)) return state;
    const newFilter: ActiveFilter = {
      id: randomUUID(),
      tableId,
      column,
      operator: "eq",
      value,
      source: "drill-down",
    };
    return { filters: { ...state.filters, [tableId]: [...existing, newFilter] } };
  }),

  removeFilter: (filterId) => set((state) => {
    const updated: Record<number, ActiveFilter[]> = {};
    for (const [tid, filters] of Object.entries(state.filters)) {
      updated[Number(tid)] = (filters as ActiveFilter[]).filter((f) => f.id !== filterId);
    }
    return { filters: updated };
  }),

  clearTableFilters: (tableId) => set((state) => ({
    filters: { ...state.filters, [tableId]: [] },
  })),

  getTableFilters: (tableId) => get().filters[tableId] ?? [],

  buildWhereClause: (tableId) => {
    const filters = get().filters[tableId] ?? [];
    if (filters.length === 0) return "";
    return filters.map((f) => {
      const escaped = typeof f.value === "string"
        ? `'${f.value.replace(/'/g, "''")}'`
        : String(f.value);
      return `${f.column} = ${escaped}`;
    }).join(" AND ");
  },
}));
```

### How Charts Subscribe

Each chart renderer subscribes to `useFilterStore` for its configured `tableId`. The subscription triggers a re-render when filters for that table change. The chart recomputes its SQL (appending the WHERE clause) and re-fetches.

```typescript
// In AggregatedWidgetRenderer (applies to bar, line, pie, scatter, table, bignumber, heatmap):
const filters = useFilterStore((state) => state.filters[tableId]);
const whereClause = useFilterStore((state) => state.buildWhereClause(tableId));

useEffect(() => {
  if (!sql?.trim()) { setData([]); return; }
  const effectiveSql = injectWhereClause(sql, whereClause);
  // fetch with effectiveSql
}, [sql, whereClause]);
```

`injectWhereClause(sql, clause)` is a utility function that appends `AND <clause>` if a `WHERE` already exists, or `WHERE <clause>` if not. It is a pure string transform, not a SQL parser — it assumes the widget's base SQL is well-formed (which it always is because `ChartConfigPanel.generatedSql` constructs it).

```typescript
const injectWhereClause = (sql: string, clause: string): string => {
  if (!clause) return sql;
  const upperSql = sql.trimEnd().toUpperCase();
  // If base SQL has WHERE already (aggregated queries do not normally have WHERE,
  // but future filter-clause view queries might):
  if (/\bWHERE\b/.test(upperSql)) {
    return `${sql.trimEnd()} AND ${clause}`;
  }
  // Insert before GROUP BY, ORDER BY, LIMIT if present:
  const insertBefore = upperSql.search(/\b(GROUP|ORDER|LIMIT)\b/);
  if (insertBefore !== -1) {
    return `${sql.slice(0, insertBefore)} WHERE ${clause} ${sql.slice(insertBefore)}`;
  }
  return `${sql.trimEnd()} WHERE ${clause}`;
};
```

---

## 5. Cross-Chart Coordination: Re-fetch Trigger and Concurrency

### Re-fetch Trigger

When `useFilterStore.addFilter(tableId, column, value)` is called:
1. Zustand updates `state.filters[tableId]`.
2. All subscribers of `useFilterStore` re-render. Subscribers that key on `tableId` matching their widget's table get a new `whereClause`.
3. `useEffect([sql, whereClause])` fires in each chart renderer — `whereClause` changed, so the effect runs.
4. Each chart independently fetches its SQL with the new WHERE clause appended.

This is automatic and zero-config: charts sharing the same `tableId` re-fetch without any dashboard-level coordination code.

### Debouncing

**Verdict: no debouncing needed for drill-down clicks.** Filters are added one at a time via a deliberate click action. The user must click, then click again to add a second filter. There is no rapid-fire filter event (no slider, no text input). Each click legitimately triggers one re-fetch per chart.

If a dashboard has 5 charts on the same table and the user clicks a bar → all 5 fire a fetch simultaneously. This is correct behavior: all 5 charts should update. The fetches are independent and concurrent, which is fine.

### Cancel-In-Flight

**Verdict: cancel in-flight requests using `AbortController` in the `useEffect` cleanup.** Without cancellation, a filter change while a fetch is in-flight can cause a stale result to overwrite a newer result (classic React race condition). The fix is standard:

```typescript
useEffect(() => {
  if (!sql?.trim()) { setData([]); return; }
  const controller = new AbortController();
  const effectiveSql = injectWhereClause(sql, whereClause);
  setLoading(true);
  runSql(effectiveSql, { signal: controller.signal })
    .then((res) => { setData(parseKineticaResponse(res)); })
    .catch((err) => { if (err.name !== "AbortError") setError(err.message); })
    .finally(() => setLoading(false));
  return () => controller.abort();
}, [sql, whereClause]);
```

`runSql` in `src/api/client.ts` must accept and pass an `AbortSignal` to `fetch`. This is a one-line change to `runSql` (add `signal` to the `fetch` init options).

---

## 6. Per-Chart-Type Drill-Down Contract

### Contract Definition

Each chart renderer receives an `onDrillDown` prop:

```typescript
type DrillDownHandler = (tableId: number, column: string, value: unknown) => void;
// Implementation: useFilterStore.getState().addFilter(tableId, column, value)
```

The `column` is the widget's configured `drillDownColumn` (stored in `widget.config.drillDownColumn`). The `value` is the value of that column for the clicked element. The `tableId` is the BI app's SQLite table ID for the widget's data source.

**Key invariant:** `drillDownColumn` is set at chart-config time. The click handler does not need to infer which column was clicked — it reads `cfg.drillDownColumn`. If `drillDownColumn` is empty, the click handler is a no-op (the chart is not configured for drill-down).

### Per-Chart-Type Click Contract

| Chart Type | Click Element | Value Extracted | Recharts Event | Notes |
|------------|---------------|-----------------|---------------|-------|
| **bar** | Bar segment | `row[cfg.drillDownColumn]` | `BarChart onClick` receives `activePayload[0].payload` — the full row object | `drillDownColumn` defaults to the `groupByColumn` (x-axis category). User can override. |
| **line** | Data point dot | `row[cfg.drillDownColumn]` | `LineChart onClick` receives `activePayload[0].payload` — the data row | `drillDownColumn` defaults to x-axis key (`groupByColumn`). |
| **pie** | Pie slice | `row[cfg.drillDownColumn]` | `Pie onClick` receives the slice's data object: `{ name, value, payload: {...} }` | `drillDownColumn` defaults to `groupByColumn` (the name/category column). |
| **scatter** | Data point | `row[cfg.drillDownColumn]` | `ScatterChart onClick` receives `activePayload[0].payload` | Scatter groups are less meaningful for equality filter — user must configure `drillDownColumn` explicitly. |
| **table** | Table row | `row[cfg.drillDownColumn]` | `<tr onClick={(e) => { ... }}>` — row data is directly in scope from the map | Any visible column can be the drill-down column. |
| **bignumber** | No click | N/A | No drill-down — single aggregate value, no row context | `drillDownColumn` field hidden in config panel for bignumber. |
| **heatmap** | No click (existing renderer is placeholder) | N/A | Heatmap renderer in `WidgetRenderer.tsx` does not exist yet (not in switch). Defer drill-down wiring until heatmap renderer is built. | |
| **records** | Table row | `row[cfg.drillDownColumn]` | `<tr onClick>` — row is the full raw record. Records table has the richest drill-down support (any column available). | Best default: the first column or a user-configured primary key column. |
| **map** | Map coordinate | Result from `/api/identify` `row[cfg.drillDownColumn]` | OpenLayers `map.on('click', ...)` event → fires identify probe → on success, emits `onDrillDown` with the returned row's drill-down column value. | Only supported for raster, heatmap (WMS mode), classbreak. Contour: no drill-down. |

### Registry Approach: Extend `ChartTypeDefinition`, Not a Sibling Registry

**Recommendation:** Extend the existing `ChartTypeDefinition` with one optional field rather than creating a sibling "click-handler registry."

```typescript
// In registry.ts:
export type ChartTypeDefinition = {
  // ... existing fields ...
  /** If true, this chart type supports drill-down. Config panel shows drillDownColumn field. */
  supportsDrillDown?: boolean;
};
```

The `drillDownColumn` config key is stored in `widget.config` (already a `Record<string, unknown>`). No new config field structure is needed. The `supportsDrillDown` flag in the definition tells the config panel whether to show the drill-down column selector.

Bignumber and heatmap (until renderer is built) set `supportsDrillDown: false` or omit the flag. All others set `supportsDrillDown: true`.

This avoids a second registry with its own lookup and re-registration boilerplate. The click behavior is entirely in the renderer — the definition only needs to gate the config UI.

---

## 7. Build Order

Dependencies flow strictly top-to-bottom. No phase needs something that is not yet built.

```
Phase A: Filter Store Foundation
  — useFilterStore, useFilterStore tests, injectWhereClause utility
  — No UI changes; purely additive
  ↓
Phase B: Existing-Chart Drill-Down Wiring
  — Add drillDownColumn to each chart definition (supportsDrillDown flag)
  — Add onDrillDown prop to WidgetRenderer + each existing renderer
  — Wire AggregatedWidgetRenderer to subscribe to useFilterStore
  — Wire filter bar to read from / write to useFilterStore
  — Result: bar/line/pie/scatter/table/records charts are interactive
  ↓
Phase C: Map Chart Base (WMS tile display)
  — Replace map.ts placeholder with full descriptor + MapConfigPanel
  — Implement MapRenderer with OpenLayers, tile fetch via /api/wms
  — Subscribe to useFilterStore → filter-parameterized WMS QUERY
  — Result: map displays Kinetica WMS tiles, respects active filters
  ↓
Phase D: Map Drill-Down via Identify Probe
  — Add POST /api/identify server route
  — Wire MapRenderer click → /api/identify → onDrillDown
  — Result: map clicks add filters like all other chart types
  ↓
Phase E: AbortController + Polish
  — Add AbortController to AggregatedWidgetRenderer and MapRenderer
  — Loading states, error boundaries, empty-state UX for map
  — Manual QA pass
```

**Why this order:**

- Phase A must be first: every subsequent phase depends on `useFilterStore` existing.
- Phase B before Phase C: proves the filter coordination pattern works end-to-end on simple charts before building the more complex map renderer.
- Phase C before Phase D: map must be rendering tiles before the identify probe is useful (can't test identify without a visible map to click on).
- Phase E last: polish does not block any functionality; AbortController can be added once the data-fetch pattern is stable.

---

## 8. Anti-Patterns to Avoid

### AP-1: Storing Filter State in Component Local State or Per-Chart Props

**What people do:** Add `const [filters, setFilters] = useState([])` inside `WidgetRenderer` or pass filters as a prop from a parent dashboard component.

**Why it's wrong:** Chart A's click cannot update Chart B's filter state if each chart owns its own state. Cross-chart coordination requires a shared store. Props require the dashboard component to own filter state, then thread it to every child — this creates a massive prop-drilling chain through `react-grid-layout` grid items.

**Do this instead:** `useFilterStore` is the single source of truth. Every chart subscribes directly. Zero prop-drilling. The dashboard component does not touch filter state.

### AP-2: Injecting Filter SQL in the WMS Request

**What people do:** Build a new SQL query that wraps the WMS tiles in a filter (e.g., trying to get Kinetica to render only filtered rows by sending filtered SQL to `/api/sql` instead of using WMS).

**Why it's wrong:** WMS tiles and SQL result rows have completely different lifecycles. SQL returns JSON rows; WMS returns raster tiles (PNG). You cannot get map tiles from the SQL endpoint. The correct approach for filtered map tiles is the WMS `QUERY` parameter (a WHERE clause appended to the WMS URL), which Kinetica applies server-side before rendering.

**Do this instead:** When filters change, rebuild the WMS tile URL with an updated `QUERY` param and replace the OpenLayers source. Kinetica GPU renders filtered tiles server-side.

### AP-3: Fetching `/api/identify` Inside the Filter Store Action

**What people do:** Put the `/api/identify` fetch call inside `useFilterStore.addFilter` or an async middleware, so clicking the map triggers an identify probe before adding a filter.

**Why it's wrong:** The filter store is a synchronous Zustand store. Async work does not belong in store actions. The store's job is to hold `ActiveFilter[]` state. The identify probe's job is to resolve what `(column, value)` the click corresponds to.

**Do this instead:** The click flow belongs entirely in `MapRenderer`: (1) catch OL click event → (2) fire `POST /api/identify` → (3) receive `{ row, found }` → (4) call `onDrillDown(tableId, cfg.drillDownColumn, row[cfg.drillDownColumn])` → (5) the parent's `onDrillDown` calls `useFilterStore.getState().addFilter(...)`. The store stays synchronous; async work is in the component.

### AP-4: Refetching SQL on Every OpenLayers Tile Request

**What people do:** Wire a `useEffect` on OpenLayers `tileloadend` events to re-fetch SQL data, intending to "sync" the map with chart data.

**Why it's wrong:** WMS tile fetches are per-tile, potentially dozens per pan/zoom. Triggering SQL fetches for every tile request would spam the server. WMS tiles and SQL chart data are independent data products serving different purposes (visual map tiles vs. aggregated chart rows). They must not be coupled.

**Do this instead:** SQL chart re-fetches are triggered only by filter store changes (`useEffect([whereClause])`). Map tile re-fetches are triggered only by OpenLayers when the viewport changes or the source URL changes. These lifecycles are completely separate.

### AP-5: Binding `drillDownColumn` to `chartId` Instead of Being Configured on the Widget

**What people do:** Create a `drillDownRegistry: Map<chartId, column>` that maps each chart instance to its drill-down column, managed separately from `widget.config`.

**Why it's wrong:** `widget.config` is already the persistent per-widget configuration store (saved to SQLite). Duplicating column binding in a separate registry means it gets out of sync on widget rename, clone, or dashboard load. It also makes the column invisible in the config panel.

**Do this instead:** `drillDownColumn` lives in `widget.config.drillDownColumn`. The `ChartConfigPanel` for each `supportsDrillDown` chart type shows a column selector for this field. The renderer reads `cfg.drillDownColumn` at click time. No separate registry.

### AP-6: Making `tableId` the Widget's SQLite Table ID Without Establishing the Link in Config

**What people do:** Assume `tableId` for the filter store can be inferred from `widget.config.table` (the string "schema.tablename") by doing a lookup in the dashboard's tables array at click time.

**Why it's wrong:** The lookup is async (the tables array may not be in scope at click time in the renderer). The filter store key is `tableId: number` (the SQLite integer ID), not `tableRef: string`. If two tables in different schemas have the same name, the string lookup is ambiguous.

**Do this instead:** Store `tableId: number` explicitly in `widget.config.tableId` at `ChartConfigPanel` save time. `ChartConfigPanel` already has access to the `tables` array and can resolve `tableId` from the selected `table` string via `selectedSource.tableId`. The renderer reads `cfg.tableId as number` directly — no runtime lookup needed.

---

## Data Flow Diagrams

### Drill-Down Flow (existing chart types)

```
User clicks bar segment
  → BarRenderer onClick: payload.row[cfg.drillDownColumn] = "West"
  → onDrillDown(cfg.tableId, cfg.drillDownColumn, "West")
  → useFilterStore.addFilter(tableId=5, "region", "West")
  → Zustand state update: filters[5] = [..., { id, column: "region", value: "West" }]
  → All subscribers of filters[5] re-render
    → BarRenderer: whereClause = "region = 'West'" → re-fetches aggregated SQL
    → LineRenderer (same tableId): same WHERE → re-fetches
    → MapRenderer (same tableId): rebuilds WMS URL with QUERY=region='West' → OL fetches new tiles
    → FilterBar: renders new chip "region = West" with × button
```

### Map Click → Identify Flow

```
User clicks map at (lat=40.7, lon=-74.0)
  → OL click event fires in MapRenderer
  → POST /api/identify { tableRef, spatialMode, latColumn, lonColumn, clickLat, clickLon, filterClause }
  → Server: kineticaSql(req, "SELECT *, ST_Distance(...) ... LIMIT 1", { op: "SQL" })
  → Kinetica returns columnar row: { region: "Northeast", revenue: 12000, ... }
  → Server parses → { found: true, row: { region: "Northeast", revenue: 12000 }, distance: 0.002 }
  → MapRenderer: onDrillDown(cfg.tableId, cfg.drillDownColumn, row[cfg.drillDownColumn])
  → useFilterStore.addFilter(...) → all same-table charts re-fetch
```

### Filter Removal Flow

```
User clicks × on "region = West" chip in FilterBar
  → useFilterStore.removeFilter(filterId)
  → Zustand state update: filter removed from filters[5]
  → All subscribers re-render with empty whereClause
  → Charts re-fetch without WHERE clause (back to full dataset)
  → Map rebuilds WMS URL without QUERY param → tiles re-fetch
```

---

## Integration Points Summary

| Integration Point | Type | What Changes |
|-------------------|------|-------------|
| `useFilterStore` | NEW | New Zustand store; all chart renderers subscribe |
| `WidgetRenderer.tsx` | MODIFIED | Add `onDrillDown` prop; add `MapRenderer` case; thread filter store |
| `AggregatedWidgetRenderer` | MODIFIED | Subscribe to `useFilterStore`; inject WHERE clause into SQL; AbortController |
| `RecordsTableRenderer` | MODIFIED | Add `onDrillDown` on row click; subscribe to filter store for WHERE clause |
| `BarRenderer` / `LineRenderer` / `PieRenderer` / `ScatterRenderer` / `TableRenderer` | MODIFIED | Add `onClick` handlers; pass `onDrillDown` |
| `MapRenderer.tsx` | NEW | OL map, WMS tile source, identify probe call, filter subscription |
| `map.ts` definition | MODIFIED | Replace placeholder with full spatial config descriptor |
| `MapConfigPanel.tsx` | NEW | Custom config panel for spatial column selection |
| `POST /api/identify` route | NEW | In `server/src/index.ts`; uses existing `kineticaSqlHelper` |
| `src/api/client.ts` | MODIFIED | Add `identify(params)` helper; add `signal` param to `runSql` |
| Filter bar component | MODIFIED | Read from `useFilterStore` instead of local state; `removeFilter` on chip × |
| `ChartTypeDefinition` | MODIFIED | Add `supportsDrillDown?: boolean` field |
| All chart definitions | MODIFIED | Add `supportsDrillDown: true` (or false for bignumber) |
| `kinetica.ts` | UNCHANGED | No changes needed |
| `kineticaErrors.ts` | UNCHANGED | Existing error taxonomy covers all new failure modes |
| `server/src/auth.ts` | UNCHANGED | `requireAuth` already generic |
| `server/src/db.ts` | UNCHANGED | No persistence changes (filters are transient) |

---

## Sources

- Direct codebase read: `kinetica_bi/server/src/kinetica.ts`, `index.ts`, `src/components/charts/registry.ts`, `WidgetRenderer.tsx`, `ChartConfigPanel.tsx`, all chart definitions, `src/store/auth.ts`, `src/store/user.ts`
- Kinetica WMS documentation: `QUERY` parameter is a Kinetica-specific WHERE clause applied before tile rendering; `STYLES` controls render mode (HIGH confidence from Kinetica WMS feature documentation)
- OpenLayers TileWMS source: URL factory pattern triggers tile refetch when source URL changes (HIGH confidence — standard OL pattern)
- Zustand subscription pattern: `useFilterStore((state) => state.filters[tableId])` creates a per-table selector that only re-renders when that table's filters change (HIGH confidence — standard Zustand selector pattern)
- React `AbortController` in `useEffect`: standard React pattern for cancelling in-flight fetches on dependency change or unmount (HIGH confidence)
- Kinetica `ST_Distance`: supported spatial function in Kinetica SQL; supports both point-to-point and geometry distance computations (MEDIUM confidence — verified against Kinetica SQL documentation patterns; exact function signature should be validated against current Kinetica version)
