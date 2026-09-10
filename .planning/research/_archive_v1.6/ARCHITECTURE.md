# Architecture Research

**Domain:** v1.5 Spatial filtering on map — interactive drawn shapes wired into v1.3 materialize pipeline
**Researched:** 2026-05-11
**Confidence:** HIGH (all integration points derived from reading actual source files at the exact lines affected; no training-data assumptions)

---

## Standard Architecture

### System Overview — v1.5 Spatial Filter Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React 18 + Zustand)                                                   │
│                                                                                  │
│  ┌────────────────────────┐  spatialFilterVersion++  ┌────────────────────────┐  │
│  │  useSpatialFilterStore │ ────────────────────────→│  useFilterViewStore    │  │
│  │  (session-only, flat)  │                          │  (unchanged v1.3)      │  │
│  │  shapes: Shape[]       │    (same materialize      │  views[tableId]        │  │
│  │  spatialVersion: num   │     trigger re-fires)     └───────────┬────────────┘  │
│  └────────────┬───────────┘                                       │              │
│               │                                                   │ viewName     │
│   shape add / │ remove via                                        ↓              │
│   FilterBar × │ or Delete key                        ┌────────────────────────┐  │
│   or draw end │                                       │ AggregatedWidget       │  │
│               ↓                                       │ Renderer               │  │
│  ┌────────────────────────┐   subscribes to           │ (SOLE materialize      │  │
│  │  MapChartRenderer      │   spatialFilterStore  →   │  trigger — unchanged)  │  │
│  │  (OL Vector overlay:   │                           │ Effect 1: debounced    │  │
│  │   OL Draw interaction  │                           │  materializeFilter()   │  │
│  │   + feature collection)│                           │  with BOTH filters AND │  │
│  └────────────────────────┘                           │  spatialFilters        │  │
│                                                       └───────────┬────────────┘  │
│  ┌────────────────────────┐                                       │              │
│  │  FilterBar             │   spatialFilterVersion                │ POST         │
│  │  (spatial chips row)   │   ──────────────────→                ↓              │
│  │  + per-table col chips │                           materializeFilter(         │
│  └────────────────────────┘                             {dashboardId, tableId,  │
│                                                          filters, spatialFilters}│
└──────────────────────────────────────────────────────┬───────────────────────────┘
                                                       │ POST /api/filter/materialize
                                                       ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express 4 + TypeScript)                                                │
│                                                                                  │
│  POST /api/filter/materialize (MODIFIED — accepts spatialFilters[] in body)     │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  1. buildServerWhereClause(filters)  → colClause (existing)              │   │
│  │  2. buildSpatialWhereClause(spatialFilters, spatialColumn) → spatialOr   │   │
│  │     (NEW — lib/spatialWhereClause.ts)                                    │   │
│  │  3. composeWhereClause(colClause, spatialOr) → combined                  │   │
│  │     "(spatial1 OR spatial2 OR ...) AND (col1 AND col2 AND ...)"          │   │
│  │  4. DDL: CREATE OR REPLACE MATERIALIZED VIEW ... WHERE combined          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  lib/spatialWhereClause.ts (NEW — pure module)                                  │
│  lib/whereClause.ts        (UNCHANGED — pure column-AND builder)                 │
│  lib/viewNaming.ts         (UNCHANGED — deterministic view name)                 │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
                          │ DDL to Kinetica
                          ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│  KINETICA GPU-DB                                                                  │
│  CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u..._d..._t..._s...              │
│    AS (SELECT * FROM schema.table WHERE                                           │
│        (ST_WITHIN(col, ST_GEOMFROMWKT('POLYGON(...)'))                           │
│         OR ST_WITHIN(col, ST_GEOMFROMWKT('POLYGON(...)'))                        │
│         OR ...)                                                                   │
│        AND (col1 = 'val1' AND col2 = 42))                                        │
│  USING TABLE PROPERTIES (TTL = 5)                                                │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Question-by-Question Integration Analysis

### Q1: Server-Side WHERE-Clause Integration

**Recommendation: Option (b) — new `lib/spatialWhereClause.ts` module; server caller composes the two.**

Option (a) extends `whereClause.ts` signature. Do not do this — `whereClause.ts` is a pure column-equality builder. Mixing spatial concerns into it breaks the single-responsibility principle and makes the unit tests harder to scope.

Option (c) inlines composition inside the endpoint. Do not do this — the endpoint handler (`index.ts`) is already doing too much (body validation, table lookup, view-name construction, DDL execution). Adding SQL composition logic inline makes the handler hard to test and violates the pattern established by `whereClause.ts` and `spatialQuery.ts` (pure modules, zero Express deps).

**Option (b) is correct** because it follows the exact module shape of the existing codebase: pure builders → handler composes → DDL sent to Kinetica. Three separate concerns, three separate modules.

#### Proposed module signatures

**New: `server/src/lib/spatialWhereClause.ts`**

```typescript
/**
 * Spatial filter DTO (server-side). Shape matches the wire format from the
 * POST /api/filter/materialize request body's spatialFilters[] array.
 *
 * One SpatialFilter describes a single drawn shape. The spatialColumn and
 * spatialMode for the target table are resolved server-side from the per-table
 * target config — NOT embedded in the shape itself (shapes are geometry only;
 * the table/column binding lives on the per-map widget config persisted in
 * widgets.config.spatialTargets).
 */
export type SpatialShapeType = "bbox" | "polygon" | "circle";

export type SpatialFilter = {
  shapeId: string;           // stable client-side UUID for chip keying + OL feature ID
  type: SpatialShapeType;
  // Geometry representation — one of:
  wkt?: string;              // caller pre-converts bbox/polygon/circle to WKT (preferred)
  // circle shorthand (if WKT generation is deferred to server):
  centerLon?: number;
  centerLat?: number;
  radiusMeters?: number;
};

/**
 * Target column binding resolved from widget config + table metadata.
 * The endpoint derives this from the per-map spatialTargets config when it
 * builds the WHERE clause for a specific table.
 */
export type SpatialColumnTarget = {
  spatialMode: "latlon" | "wkt" | "wkb";
  // latlon mode:
  lonCol?: string;
  latCol?: string;
  // wkt/wkb mode:
  spatialCol?: string;
};

/**
 * Build an OR-joined spatial predicate from one or more drawn shapes.
 * Returns "1=1" (pass-through) when spatialFilters is empty.
 *
 * Each shape generates one Kinetica spatial predicate matched to the target
 * column's spatial mode:
 *   - wkt/wkb: ST_WITHIN(col, ST_GEOMFROMWKT('...WKT...'))
 *   - latlon: GEODIST(lonCol, latCol, cx, cy) <= radiusMeters   (circle only)
 *             or polygon bounding-box approximation (bbox/lasso — see notes)
 *
 * Pure function — zero imports beyond Node stdlib. No Express deps.
 */
export function buildSpatialWhereClause(
  spatialFilters: SpatialFilter[],
  target: SpatialColumnTarget,
): string;

/**
 * Compose a column-AND clause with a spatial-OR clause.
 * Returns the combined predicate string suitable for embedding in DDL.
 *
 * Logic:
 *   - Both clauses non-trivial (not "1=1"): "(spatial) AND (col)"
 *   - Only spatial: returns spatial clause
 *   - Only col: returns col clause
 *   - Neither: returns "1=1"
 */
export function composeWhereClause(colClause: string, spatialClause: string): string;
```

**Modified: `server/src/index.ts` — POST /api/filter/materialize handler**

```typescript
// New body shape:
const body = req.body as {
  dashboardId?: number;
  tableId?: number;
  filters?: ActiveFilter[];            // column-equality filters (existing)
  spatialFilters?: SpatialFilter[];    // drawn shapes (new)
  spatialTarget?: SpatialColumnTarget; // resolved from widget config (new)
};

// Composition:
const colClause = buildServerWhereClause(filters ?? []);
const spatialClause = buildSpatialWhereClause(
  spatialFilters ?? [],
  spatialTarget ?? { spatialMode: "wkt" }, // default: skip spatial if no target
);
const whereClause = composeWhereClause(colClause, spatialClause);
const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;
```

**Kinetica spatial function to use for wkt/wkb containment:**

```sql
-- ST_WITHIN returns true when the geometry is fully within the polygon
ST_WITHIN(col, ST_GEOMFROMWKT('POLYGON((lon1 lat1, lon2 lat2, ...))'))
```

Use `ST_WITHIN` (not `STXY_DISTANCE`) for shape-based filtering — STXY_DISTANCE is for point-proximity (info queries). For latlon mode with bbox/polygon, the WKT approach is cleaner than trying to construct a bounding GEODIST expression; convert the polygon to a WKT envelope and use `ST_WITHIN`. For latlon mode with circle, `GEODIST(lonCol, latCol, cx, cy) <= radiusMeters` is exact.

**Research flag:** Verify `ST_WITHIN` + `ST_GEOMFROMWKT` are available in the deployed Kinetica version (spike required before coding `buildSpatialWhereClause`). The existing `buildWkbQuery` already uses `ST_GEOMFROMTEXT('POINT(...)')` so the function is present; `ST_WITHIN` with a polygon argument needs operator confirmation.

---

### Q2: Spatial Filter Shape (DTO)

**Decision: Geometry lives on the shape. Table+column target lives on the materialize request body, NOT on the shape.**

Rationale: shapes are dashboard-scoped (drawn once, apply to all tables). Each call to the materialize endpoint is per-table (existing API contract). The endpoint already knows the table; the per-map widget config tells it which column to use. Coupling column choice to the shape would require sending N shapes × M columns, which is redundant and creates maintenance issues when column config changes.

**Wire format for `POST /api/filter/materialize`:**

```typescript
// Client sends (per-table):
{
  dashboardId: number;
  tableId: number;
  filters: ActiveFilter[];          // column filters (existing)
  spatialFilters: SpatialFilter[];  // drawn shapes (new) — empty array = no spatial filter
  spatialTarget: {                  // resolved from widgets.config.spatialTargets for this tableId
    spatialMode: "latlon" | "wkt" | "wkb";
    lonCol?: string;      // latlon mode
    latCol?: string;      // latlon mode
    spatialCol?: string;  // wkt/wkb mode
  };
}
```

**`SpatialFilter` shape (client → server and stored in `useSpatialFilterStore`):**

```typescript
export type SpatialShapeType = "bbox" | "polygon" | "circle";

export type SpatialFilter = {
  shapeId: string;           // UUID (crypto.randomUUID()) — stable across store updates
  type: SpatialShapeType;
  wkt: string;               // pre-computed WKT; client converts OL geometry to WKT before adding to store
  label: string;             // human-readable: "Bbox 2.3km×1.1km", "Circle 500m", "Lasso 3.2km²"
  addedAt: number;           // Date.now() — chip display ordering
};
```

**Why WKT on the shape:**
- Server-side WKT embedding in SQL is already proven by `buildWkbQuery`'s `ST_GEOMFROMTEXT('POINT(...)')` pattern
- OL's `GeoJSON.writeGeometry()` or `WKT.writeGeometry()` format converters handle the OL geometry → string conversion at draw-end time
- Sending WKT avoids server-side geometry parsing of multiple formats
- All three shape types (bbox, polygon, circle) can be expressed as WKT POLYGON; circle is approximated as a 64-point polygon at draw-end (Kinetica `GEODIST` for circle is exact but only for point-in-circle, not polygon-within-circle)

**Circle alternative:** For `type: "circle"`, also store `{ centerLon, centerLat, radiusMeters }` alongside WKT so the server can use `GEODIST(lonCol, latCol, cx, cy) <= radius` for latlon-mode tables (which is more accurate than a polygon approximation at map scale). The WKT polygon is used for wkt/wkb-mode tables.

---

### Q3: Materialize Trigger Ownership

**Decision: `AggregatedWidgetRenderer` remains the sole materialize trigger. No new component.**

The v1.3 invariant ("only `AggregatedWidgetRenderer` triggers materialize — `MapChartRenderer` + `RecordsTableRenderer` are pure consumers") MUST be preserved. Violating it would produce N×M redundant DDL calls.

**How it works with spatial filters:**

`AggregatedWidgetRenderer`'s Effect 1 already subscribes to `filterVersion` (from `useFilterStore`). In v1.5, it additionally subscribes to `spatialFilterVersion` (from `useSpatialFilterStore`). Both version bumps trigger the same debounced materialize path.

The `materializeFilter` client call gains `spatialFilters` + `spatialTarget` in its body. The server composes both into a single DDL. The returned `viewName` and `materializeVersion` bump are identical — no new cache-buster needed.

**`AggregatedWidgetRenderer` Effect 1 (MODIFIED — additions only):**

```typescript
// New selectors:
const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialVersion);
const shapes = useSpatialFilterStore((s) => s.shapes);

// New dependency in Effect 1:
useEffect(() => {
  if (tableId === undefined) return;
  // ... (existing timer setup) ...
  
  // Resolve spatialTarget from widget config's spatialTargets for this tableId:
  const spatialTargets = (cfg.spatialTargets as SpatialTarget[] | undefined) ?? [];
  const target = spatialTargets.find((t) => t.tableId === tableId);
  
  const hasSpatialFilter = shapes.length > 0 && target !== undefined;
  const hasColFilter = tableFilters.length > 0;
  
  if (!hasColFilter && !hasSpatialFilter) {
    // Empty both → drop
    dropFilterView({ dashboardId, tableId }).catch(() => {});
    useFilterViewStore.getState().clearView(tableId);
    return;
  }
  
  // Materialize with combined filters:
  const result = await materializeFilter({
    dashboardId, tableId,
    filters: tableFilters,
    spatialFilters: hasSpatialFilter ? shapes : [],
    spatialTarget: target ?? null,
  }, controller.signal);
  useFilterViewStore.getState().setView(tableId, result, dashboardId);
  
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sql, filterVersion, spatialFilterVersion, dashboardId, tableId]);
```

**Why not `MapChartRenderer` as trigger:**
- `MapChartRenderer` hosts the draw interaction but is instantiated once per map widget. Multiple map widgets on the same dashboard would produce duplicate DDL calls.
- `AggregatedWidgetRenderer` is table-scoped (one per table per widget). The per-table dedup is already correct.
- The "shape drawn on Map A" → "all maps re-render" flow goes: draw-end → `useSpatialFilterStore.addShape()` → `spatialFilterVersion++` → all `AggregatedWidgetRenderer` instances subscribed to that version bump fire their materialize debounce → `setView()` → `useFilterViewStore` selector changes → `MapChartRenderer` Effect 3 fires `updateParams({ LAYERS: viewName })` on all maps. This is clean single-direction data flow with no cross-component coordination.

---

### Q4: Zustand Slice Design

**Decision: Flat `Shape[]` in a single `useSpatialFilterStore` (dashboard-switch reset clears it). No keying by dashboardId.**

**Option A — keyed by `dashboardId`:**
```typescript
type State = { shapes: Record<number, SpatialFilter[]>; ... }
```
Pros: shapes survive route changes if the dashboard ID is still in the URL.
Cons: stale shapes from a previous dashboard survive if the key accidentally matches; adds a lookup layer everywhere shapes are read; `reset()` must know which dashboardId to clear (or wipe all, making keying pointless).

**Option B — flat `SpatialFilter[]` (RECOMMENDED):**
```typescript
type State = { shapes: SpatialFilter[]; spatialVersion: number; ... }
```
Pros: matches the existing flat shape of `useFilterStore.filters` after the tableId key is resolved; reset semantics are identical to `useInfoSelectionStore` and `useLastInfoClickContextStore` (wipe on dashboard-switch). Shapes are dashboard-scoped by convention (reset block), not by key.

Since shapes are session-only (like `useInfoSelectionStore`) and the reset block enforces the dashboard-scope guarantee, keying by dashboardId adds complexity without correctness benefit.

**Proposed `useSpatialFilterStore` shape:**

```typescript
// kinetica_bi/src/store/spatialFilterStore.ts  (NEW FILE)

export type SpatialFilter = {
  shapeId: string;           // crypto.randomUUID() — stable, used as OL feature ID + chip key
  type: "bbox" | "polygon" | "circle";
  wkt: string;               // OL geometry serialized to WKT at draw-end time
  label: string;             // "Bbox 2.3km×1.1km" | "Circle 500m" | "Lasso 3.2km²"
  // For circle-mode latlon tables (GEODIST path):
  centerLon?: number;
  centerLat?: number;
  radiusMeters?: number;
  addedAt: number;
};

export type SpatialFilterState = {
  shapes: SpatialFilter[];
  spatialVersion: number;    // increments on every addShape / removeShape / clearShapes
  addShape: (shape: SpatialFilter) => void;
  removeShape: (shapeId: string) => void;
  clearShapes: () => void;
  reset: () => void;         // called from lifecycle reset block
};

export const useSpatialFilterStore = create<SpatialFilterState>((set) => ({
  shapes: [],
  spatialVersion: 0,

  addShape: (shape) =>
    set((s) => ({
      shapes: [...s.shapes, shape],
      spatialVersion: s.spatialVersion + 1,
    })),

  removeShape: (shapeId) =>
    set((s) => {
      const next = s.shapes.filter((sh) => sh.shapeId !== shapeId);
      if (next.length === s.shapes.length) return s; // no-op
      return { shapes: next, spatialVersion: s.spatialVersion + 1 };
    }),

  clearShapes: () =>
    set((s) => {
      if (s.shapes.length === 0) return s; // no-op
      return { shapes: [], spatialVersion: s.spatialVersion + 1 };
    }),

  reset: () => set({ shapes: [], spatialVersion: 0 }),
}));
```

**Per-map widget config for spatial targets (separate from this store — see Q5).**

**Lifecycle reset block extension:**

The current 4-store reset block in `DashboardsPage.tsx` lines 388-407 and `App.tsx` lines 42-56 becomes a 5-store block. Canonical order (add `spatialFilterStore` as fifth):

```typescript
// DashboardsPage.tsx DashboardOpen cleanup + App.tsx UNAUTHORIZED:
useFilterViewStore.getState().reset();
useFilterStore.getState().reset();
useInfoSelectionStore.getState().reset();
useLastInfoClickContextStore.getState().reset();
useSpatialFilterStore.getState().reset();   // NEW — fifth store
```

No server-side DROP loop is needed for spatial filters — shapes are session-only (no server resource associated with `useSpatialFilterStore`). The materialized view DROP happens via the existing `useFilterViewStore` cleanup loop (which already fires DROPs for all active views).

**Second new slice — `useMapDrawModeStore` (optional, may be per-widget state instead):**

The per-map drawing toolbar mode (Info / Pan / Bbox / Lasso / Circle) can be either:
- Local `useState` in `MapChartRenderer` (simpler; mode is per-widget, not shared)
- A second Zustand slice `useMapDrawModeStore` keyed by `widgetId`

Recommendation: local `useState` in `MapChartRenderer`. The draw mode is not needed by any other component. If it turns out that toolbar state needs to be inspectable from `FilterBar` or other components, promote to a store then. Keep scope minimal until proven needed.

---

### Q5: Per-Map Config Persistence

**Decision: Extend `widgets.config` JSON blob (cheapest).**

Option analysis:

**Option A — extend `widgets.config` JSON blob (RECOMMENDED):**
```typescript
// In widget.config for a map widget:
{
  spatialTargets: [
    { tableId: 7, spatialMode: "wkt", spatialCol: "geom" },
    { tableId: 12, spatialMode: "latlon", lonCol: "x", latCol: "y" },
  ]
}
```
Pros: zero schema migration; `widgets.config` is a `TEXT` JSON blob already; `updateWidget(id, { config: ... })` writes it; `PATCH /api/widgets/:id` endpoint already exists at `index.ts:484-490`; matches how `includedLayerIds`, `basemap`, `infoRadiusPx`, and `infoEnabled` are stored.
Cons: no SQL-queryable referential integrity (if a table is removed from the dashboard, stale `spatialTargets` entries persist in the JSON blob until the user manually removes them). Acceptable for v1.5 scope — same trade-off as `includedLayerIds` today.

**Option B — new `widget_spatial_targets` SQLite table:**
```sql
CREATE TABLE widget_spatial_targets (
  id INTEGER PRIMARY KEY,
  widget_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  spatial_mode TEXT NOT NULL,
  spatial_col TEXT,
  lon_col TEXT,
  lat_col TEXT,
  FOREIGN KEY (widget_id) REFERENCES widgets(id) ON DELETE CASCADE,
  FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
);
```
Pros: referential integrity; cascading deletes clean up stale entries automatically.
Cons: new table needs a `db.ts` migration guard (PRAGMA-guarded idempotent ALTER pattern, but for a CREATE TABLE); new CRUD endpoints needed; adds a server roundtrip to save/load targets during map widget config edits.

**Option C — extend `dashboard_layers`:**
Rejected per the question's own analysis. Layers are per-Kinetica-layer; spatial targets are per-map-widget. Mixing them would require one `dashboard_layers` row per spatial target, which has no clear "position" or "layer_type" and would pollute the layers concept.

**Recommendation: Option A.** The codebase consistently uses `widget.config` as a schema-free extension point (see `infoRadiusPx`, `infoEnabled`, `includedLayerIds`). Stale-target cleanup is a UX-level concern (when a table is removed from the dashboard, show a warning in `MapConfigPanel`'s spatial-targets editor that the table is no longer associated — same pattern as `KineticaWmsLayerForm`'s missing-table state).

**New frontend type:**

```typescript
// kinetica_bi/src/lib/spatialTargets.ts  (NEW FILE)

export type SpatialTarget = {
  tableId: number;
  spatialMode: "latlon" | "wkt" | "wkb";
  spatialCol?: string;   // wkt/wkb mode
  lonCol?: string;       // latlon mode
  latCol?: string;       // latlon mode
};

/** Read spatialTargets from widget.config; return [] if absent. */
export function getSpatialTargets(config: Record<string, unknown>): SpatialTarget[] { ... }

/** Check if a target's column config is complete enough to materialize. */
export function isSpatialTargetEligible(target: SpatialTarget): boolean { ... }
```

**Server-side:** No new SQLite table. The endpoint already reads `getTable(tableId)` for the table ref; the `spatialTarget` comes from the request body (client sends it). The server does not persist `spatialTargets` — it only uses the per-call `spatialTarget` to build the WHERE clause. The source of truth is `widget.config.spatialTargets` in SQLite, read at client render time.

---

### Q6: Cross-Map Shape Rendering

**Decision: `MapChartRenderer` subscribes to `useSpatialFilterStore` and manages a dedicated OL VectorLayer. No `DashboardSpatialOverlay` HOC.**

A `DashboardSpatialOverlay` HOC would add an OL layer outside the `MapChartRenderer`'s OL `Map` instance, which is impossible — OL layers are bound to exactly one `Map`. Each map widget has its own OL `Map` instance (one per `MapChartRenderer` mount). The overlay must live inside each `MapChartRenderer`.

**Cross-map shape propagation flow:**
1. Draw completes on Map A → `draw.on('drawend', handler)` fires → `useSpatialFilterStore.addShape(shape)` → `spatialVersion++`
2. All `MapChartRenderer` instances subscribe: `const shapes = useSpatialFilterStore((s) => s.shapes)` (or a stable `shapesKey` computed from `shapeId`s)
3. Each `MapChartRenderer`'s Effect 7 (new) fires on `shapesKey` change → syncs the VectorLayer's feature collection to match `shapes`
4. Shape removed on Map B (click → Delete / chip ×) → `useSpatialFilterStore.removeShape(shapeId)` → `spatialVersion++` → all map renderers re-sync their VectorLayer

**Shape edit flow:** There is no "edit by modify" in v1.5 scope (see PROJECT.md — shapes are drawn and committed; removal is via chip × or Delete key on selected OL feature). If edit-by-modify is added in v1.6, the modify interaction would call `updateShape(shapeId, newWkt)` on the store, which propagates to all maps via the same Effect 7 mechanism.

**`MapChartRenderer` additions:**

```typescript
// New ref:
const vectorLayerRef = useRef<VectorLayer<VectorSource<Feature<Geometry>>> | null>(null);
const vectorSourceRef = useRef<VectorSource<Feature<Geometry>> | null>(null);
// OL interaction refs:
const drawInteractionRef = useRef<Draw | null>(null);
const selectInteractionRef = useRef<Select | null>(null);

// New Zustand subscription (stable primitive dep):
const shapes = useSpatialFilterStore((s) => s.shapes);
const shapesKey = shapes.map((sh) => sh.shapeId).join(',');

// Effect 7 (NEW) — sync useSpatialFilterStore.shapes → OL VectorSource features:
useEffect(() => {
  if (!vectorSourceRef.current) return;
  const source = vectorSourceRef.current;
  source.clear();
  const wktFormat = new WKT();
  for (const shape of shapes) {
    const olGeom = wktFormat.readGeometry(shape.wkt, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    const feature = new Feature({ geometry: olGeom });
    feature.setId(shape.shapeId); // for selection by shapeId
    source.addFeature(feature);
  }
}, [shapesKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Draw mode as local state (recommendation from Q4):**

```typescript
type DrawMode = "info" | "pan" | "bbox" | "lasso" | "circle";
const [drawMode, setDrawMode] = useState<DrawMode>("info");
```

Effect 8 (new) wires/unwires OL Draw interactions based on `drawMode`. On `drawend`, converts OL geometry to WKT, computes label (area/radius/dimensions), calls `useSpatialFilterStore.addShape()`.

---

### Q7: Materialize Cache-Buster

**Decision: Spatial shape changes increment the SAME `materializeVersion` counter as column-filter changes.**

`materializeVersion` lives in `useFilterViewStore.views[tableId].materializeVersion`. It increments inside `setView()` (called by `AggregatedWidgetRenderer`'s Effect 1 after `POST /api/filter/materialize` returns). The `POST` fires on `filterVersion` OR `spatialFilterVersion` change. Both paths route through the same `await materializeFilter(...)` → `setView()` → `materializeVersion++` chain.

**No race condition** because:
- The debounced 300ms timer coalesces rapid changes (column filter + spatial filter added within 300ms → single DDL call with both)
- `materializeAbortRef` cancels any in-flight materialize when a new one starts (existing V13-P-10 lock)
- Both filter dimensions land in the same WHERE clause of the same DDL

**`_mv` in WMS params** (`MapChartRenderer.tsx` Effect 3) reads `materializeVersion` from `useFilterViewStore` via `viewsKey`. Since `viewsKey` includes `materializeVersion` as a segment (`${id}:${viewName}:${materializeVersion}:${materializing}`), any `materializeVersion` bump causes `viewsKey` to change, Effect 3 to re-fire, and `source.updateParams({ ..., _mv: materializeVersion })` to send a new URL — forcing OL to bypass its tile cache.

**The `spatialFilterVersion` bump:**
`AggregatedWidgetRenderer` Effect 1 dep array gains `spatialFilterVersion`. Effect 1 fires → 300ms debounce → `materializeFilter()` → `setView()` → `materializeVersion++` → `viewsKey` changes → Effect 3 re-fires → WMS re-requests with new `_mv`. This is identical to the column-filter path.

---

### Q8: Spatial-Filter Chip Integration into FilterBar

**Decision: Add a dashboard-scoped spatial chip row alongside the existing per-table column chip rows. Do NOT duplicate spatial chips per table.**

Current `DashboardsPage.tsx` FilterBar renders `Array.from(tableIdsWithFilters).map((tableId) => ...)`. Each table gets its own chip row with a table-name label and per-column chips.

Spatial filters are dashboard-scoped (one set of shapes applies to all tables). Duplicating a spatial chip in every per-table row when 3 tables are in the dashboard would produce 3 identical chip rows for the same shape — confusing UX.

**Recommended layout:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  SPATIAL FILTERS:  [Bbox 2.3km×1.1km ×]  [Circle 500m ×]  Clear all │
├──────────────────────────────────────────────────────────────────────┤
│  demo.taxi_trips WHERE  [zone = 'East Village ×]  Clear all          │
│  demo.weather WHERE     [date = '2024-01-01' ×]   Clear all          │
└──────────────────────────────────────────────────────────────────────┘
```

**Implementation:** Add a conditional section above the per-table rows in `DashboardsPage.tsx`'s filter bar render block (lines 701-752). The spatial section renders when `useSpatialFilterStore.shapes.length > 0`.

```typescript
// In DashboardsPage.tsx, inside the filterBar div:
const shapes = useSpatialFilterStore((s) => s.shapes);

{shapes.length > 0 && (
  <div className="filter-bar-item filter-bar-spatial">
    <span className="filter-bar-table">Spatial filters</span>
    <div className="filter-bar-chips">
      {shapes.map((sh) => (
        <span key={sh.shapeId} className="filter-bar-chip">
          {sh.label}
          <button
            type="button"
            className="filter-bar-chip-dismiss"
            aria-label={`Remove shape ${sh.label}`}
            onClick={() => useSpatialFilterStore.getState().removeShape(sh.shapeId)}
          >×</button>
        </span>
      ))}
    </div>
    <button
      type="button"
      className="filter-bar-clear"
      onClick={() => useSpatialFilterStore.getState().clearShapes()}
    >Clear all</button>
  </div>
)}
```

**When no spatial filter AND no column filter:** FilterBar auto-hides (existing behavior unchanged — the `tableIdsWithFilters` set is empty AND `shapes.length === 0`).

---

### Q9: Spatial-Filter Eligibility Per Target Table

**Decision: Eligibility is checked at THREE points — config time (warn), draw time (silent skip in materialize trigger), and materialization time (skip silently if no eligible target).**

Mirror the v1.4 eligibility patterns:
- v1.4: `eligibleLayers` is computed in `MapChartRenderer` and filters out `info_enabled === 0` layers
- v1.5: `eligibleTargets` is computed in `AggregatedWidgetRenderer`'s Effect 1 and filters out targets without a valid spatial column

**Config time (warn user):** In `MapConfigPanel`'s spatial-targets editor, show a warning when a configured target has `spatialMode: "wkb"` (WKB deferred) or when the selected column does not exist in the table's column list. This is purely UI validation — no server roundtrip.

**Draw time (effect trigger):** `AggregatedWidgetRenderer` Effect 1 skips materialization for a given tableId when `spatialTargets.find(t => t.tableId === tableId)` returns `undefined` OR `!isSpatialTargetEligible(target)`. Silently skips — the shape still renders on all maps; it just doesn't affect that table's materialized view.

**Materialize time (server-side guard):** The server validates `spatialTarget.spatialMode !== "wkb"` before calling `buildSpatialWhereClause`. If WKB mode is sent, return HTTP 501 (existing `WkbDeferredError` pattern from `POST /api/info/query`). This prevents clients from bypassing the client-side guard.

**Eligibility predicate (client-side):**

```typescript
// In kinetica_bi/src/lib/spatialTargets.ts
export function isSpatialTargetEligible(target: SpatialTarget): boolean {
  if (target.spatialMode === "wkb") return false; // TD-V14-WKB-SPIKE deferred
  if (target.spatialMode === "wkt") return !!target.spatialCol;
  if (target.spatialMode === "latlon") return !!target.lonCol && !!target.latCol;
  return false;
}
```

**WKB deferral (TD-V14-WKB-SPIKE):** v1.5 carries the same tech debt as v1.4. The spatial filter eligibility check gates WKB mode out at the client before the materialize call. When TD-V14-WKB-SPIKE is resolved, `isSpatialTargetEligible` is updated to `return target.spatialMode !== "wkb" || wkbColumnIsReachable(target)` and the server-side 501 guard is replaced with the real WKB SQL builder.

---

### Q10: Lifecycle Integration

**Reset block:** Extended to 5 stores as described in Q4. The 5th `useSpatialFilterStore.getState().reset()` call is added in the same two lifecycle sites (`DashboardsPage.tsx` line ~407 and `App.tsx` UNAUTHORIZED handler).

**Files affected by reset block extension:**
- `kinetica_bi/src/components/DashboardsPage.tsx` — extend lines 388-407
- `kinetica_bi/src/App.tsx` — extend the UNAUTHORIZED handler (lines ~42-56)

**Shape-drawn-but-target-table-no-longer-on-dashboard cleanup:**

When a shape is drawn and then the user removes a table from the dashboard (via the Tables panel), the spatial chip remains visible. This is intentional — the shape still applies to any remaining tables that have spatial targets. If all tables with spatial targets are removed, the AggregatedWidgetRenderer for that table no longer mounts (no widgets reference it), so the materialize trigger for that table stops firing. The stale chip in FilterBar is a UX nuisance but not a correctness bug.

**Mitigation:** `MapConfigPanel`'s spatial-targets editor shows a "Table not associated with dashboard" warning (same as `KineticaWmsLayerForm`'s missing-table predicate) when a target's `tableId` is not in `associatedTables`. The user can remove the stale target from the config. No automated cleanup needed in v1.5.

**Draw interaction cleanup in `MapChartRenderer`:** Effect 8's cleanup (return function) must call:
```typescript
if (drawInteractionRef.current) {
  mapRef.current?.removeInteraction(drawInteractionRef.current);
  drawInteractionRef.current.dispose();
  drawInteractionRef.current = null;
}
```
This mirrors the existing OL Overlay cleanup pattern in Effect 5 and the `mountedRef` cleanup-gate pattern from GAP-24-02-A.

---

## Component Boundaries

| Component | Status | Responsibility | Communicates With |
|-----------|--------|----------------|-------------------|
| `lib/spatialWhereClause.ts` | NEW | Build spatial-OR SQL predicate from shapes + target column | Called by `index.ts` handler |
| `lib/spatialTargets.ts` | NEW | `SpatialTarget` type, `getSpatialTargets`, `isSpatialTargetEligible` | `AggregatedWidgetRenderer`, `MapConfigPanel` |
| `store/spatialFilterStore.ts` | NEW | `SpatialFilter[]` + `spatialVersion`; reset on logout/switch | `MapChartRenderer`, `AggregatedWidgetRenderer`, `DashboardsPage` FilterBar |
| `server/src/index.ts` | MODIFIED | Accept `spatialFilters` + `spatialTarget` in POST body; compose clauses | `spatialWhereClause.ts`, `whereClause.ts` |
| `server/src/lib/whereClause.ts` | UNCHANGED | Column-AND clause builder | Called by `index.ts` handler |
| `src/api/client.ts` | MODIFIED | `materializeFilter` gains `spatialFilters?` + `spatialTarget?` params | `AggregatedWidgetRenderer` |
| `src/components/charts/WidgetRenderer.tsx` / `AggregatedWidgetRenderer` | MODIFIED | Subscribe to `spatialFilterVersion`; pass `spatialFilters` + `spatialTarget` to materialize | `spatialFilterStore`, `materializeFilter` |
| `src/components/charts/MapChartRenderer.tsx` | MODIFIED | Add OL VectorLayer + Draw interactions; Effect 7 shape sync; Effect 8 draw mode wiring; per-map toolbar | `spatialFilterStore` (write on draw-end; read for overlay sync) |
| `src/components/charts/MapConfigPanel.tsx` | MODIFIED | Spatial targets editor section (table picker + mode + column picker) | `widget.config.spatialTargets`, `spatialTargets.ts` |
| `src/components/DashboardsPage.tsx` | MODIFIED | Spatial chip row in FilterBar; 5th store in reset block | `spatialFilterStore` |
| `src/components/App.tsx` | MODIFIED | 5th store in UNAUTHORIZED reset block | `spatialFilterStore` |

---

## Data Flow

### Draw → Materialize → WMS Tiles

```
1. User selects "Bbox" mode on Map A toolbar
   → setDrawMode("bbox") [local state in MapChartRenderer]
   → Effect 8 adds OL Draw interaction to Map A
   ↓
2. User drags to draw bbox
   → OL draw.on("drawend") fires
   → Convert OL geometry to WKT (EPSG:4326 coordinates)
   → Compute label ("Bbox 2.3km×1.1km")
   → useSpatialFilterStore.addShape({ shapeId: uuid, type: "bbox", wkt, label })
   → spatialVersion++
   ↓
3. useSpatialFilterStore.shapes updates
   → FilterBar re-renders: spatial chip row appears
   → ALL MapChartRenderer instances re-render via shapesKey selector:
       Effect 7 fires on each map → OL VectorSource.clear() → addFeature per shape
       → shape visible on all maps as Vector overlay
   ↓
4. AggregatedWidgetRenderer Effect 1 fires (dep: spatialFilterVersion changed)
   → 300ms debounce starts
   → On timer: resolve spatialTarget from widget.config.spatialTargets for this tableId
   → isSpatialTargetEligible(target) = true → proceed
   → markMaterializing(tableId, dashboardId)
   → POST /api/filter/materialize { dashboardId, tableId, filters, spatialFilters, spatialTarget }
   ↓
5. Server handler:
   → buildServerWhereClause(filters) → "zone = 'East Village'"
   → buildSpatialWhereClause(spatialFilters, target) → "ST_WITHIN(geom, ST_GEOMFROMWKT('POLYGON(...)'))"
   → composeWhereClause(col, spatial) → "(ST_WITHIN(...)) AND (zone = 'East Village')"
   → DDL: CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_... WHERE composed_clause TTL=5
   → Returns { viewName, expiresAt }
   ↓
6. Client: setView(tableId, { viewName, expiresAt }, dashboardId)
   → materializeVersion++ in useFilterViewStore
   → viewsKey changes
   ↓
7. MapChartRenderer Effect 3 fires:
   → source.updateParams({ LAYERS: viewName, _mv: materializeVersion })
   → OL issues new WMS GetMap request with LAYERS=<view_name>
   → Kinetica renders tiles from filtered materialized view
   ↓
8. AggregatedWidgetRenderer Effect 2 fires:
   → fromSwap(sql, viewName) → SQL queries the view
   → Chart renders filtered data
```

### Chip Remove → Clear → Unfiltered View

```
1. User clicks × on spatial chip
   → useSpatialFilterStore.removeShape(shapeId)
   → spatialVersion++
   ↓
2. AggregatedWidgetRenderer Effect 1 fires
   → shapes.length === 0 AND tableFilters.length === 0
   → dropFilterView({ dashboardId, tableId })
   → useFilterViewStore.clearView(tableId)
   ↓
3. viewsKey changes → Effect 3 fires
   → source.updateParams({ LAYERS: tableRef }) — unfiltered
   ↓
4. All maps show unfiltered tiles
   → FilterBar spatial row disappears (shapes.length === 0)
```

---

## New Files Summary

| File | Type | Purpose |
|------|------|---------|
| `kinetica_bi/server/src/lib/spatialWhereClause.ts` | NEW server | `buildSpatialWhereClause`, `composeWhereClause`, `SpatialFilter` type, `SpatialColumnTarget` type |
| `kinetica_bi/src/store/spatialFilterStore.ts` | NEW frontend | `useSpatialFilterStore`, `SpatialFilter` client type, `SpatialFilterState` |
| `kinetica_bi/src/lib/spatialTargets.ts` | NEW frontend | `SpatialTarget` type, `getSpatialTargets()`, `isSpatialTargetEligible()` |

---

## Modified Files Summary

| File | What Changes |
|------|-------------|
| `kinetica_bi/server/src/index.ts` | `POST /api/filter/materialize` body accepts `spatialFilters?` + `spatialTarget?`; calls `buildSpatialWhereClause` + `composeWhereClause` |
| `kinetica_bi/src/api/client.ts` | `materializeFilter()` request type gains `spatialFilters?: SpatialFilter[]` + `spatialTarget?: SpatialColumnTarget` |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx` (AggregatedWidgetRenderer) | Effect 1 dep gains `spatialFilterVersion`; resolves `spatialTarget` from widget config; passes spatial args to `materializeFilter` |
| `kinetica_bi/src/components/charts/MapChartRenderer.tsx` | VectorLayer setup in Effect 1; Draw interactions in Effect 8; per-map toolbar; Effect 7 shape sync; draw-end → `addShape()`; delete-on-feature-select → `removeShape()` |
| `kinetica_bi/src/components/charts/MapConfigPanel.tsx` | Spatial targets editor section |
| `kinetica_bi/src/components/DashboardsPage.tsx` | Spatial chip row in FilterBar; 5th store in DashboardOpen reset block |
| `kinetica_bi/src/App.tsx` | 5th store in UNAUTHORIZED reset block |

---

## Build Order

Build order respects dependencies: server-side pure modules first, then stores, then client helpers, then renderers, then UI.

### Phase A — Server: `spatialWhereClause.ts` + endpoint body extension

**Depends on:** nothing new (extends existing pure-module pattern).

1. `server/src/lib/spatialWhereClause.ts`: implement `buildSpatialWhereClause` (ST_WITHIN/GEODIST per mode) + `composeWhereClause` with vitest unit tests (pure function, easy to test without DB).
2. `server/src/index.ts`: extend POST body validation + call `buildSpatialWhereClause` + `composeWhereClause` in handler. Extend DELETE body to accept `hasSpatialFilter` flag so the DROP path fires when EITHER filter type clears.
3. Supertest additions: spatial-filters-only case, col+spatial composed case, empty-spatial-filters pass-through.

**Research spike needed before Phase A:** Confirm `ST_WITHIN` + `ST_GEOMFROMWKT` are available in deployed Kinetica (run a one-shot SQL via the existing `POST /execute/sql` proxy against a known geometry column).

### Phase B — Frontend store: `spatialFilterStore.ts`

**Depends on:** nothing (pure Zustand slice; mirrors `useInfoSelectionStore` shape).

1. `store/spatialFilterStore.ts`: `addShape`, `removeShape`, `clearShapes`, `reset`. Vitest unit tests with the store-reset shim.

### Phase C — Frontend config lib: `spatialTargets.ts`

**Depends on:** Phase B (uses `SpatialFilter` type) — actually independent; no cross-import.

1. `lib/spatialTargets.ts`: `SpatialTarget` type, `getSpatialTargets`, `isSpatialTargetEligible`. Vitest unit tests.

### Phase D — Client helper: extend `materializeFilter`

**Depends on:** Phase A (server accepts new body fields), Phase C (SpatialTarget type).

1. `api/client.ts`: extend `materializeFilter` request body type. Existing mock harness covers this; update mock return type in tests that check the request body.

### Phase E — `AggregatedWidgetRenderer`: subscribe to spatial filters

**Depends on:** Phase B (store), Phase C (lib), Phase D (client fn).

1. `WidgetRenderer.tsx`: add `spatialFilterVersion` dep to Effect 1; resolve `spatialTarget` from `cfg.spatialTargets`; pass `spatialFilters` + `spatialTarget` to `materializeFilter`. Tests: extend existing Effect 1 vitest with spatial filter scenario.

### Phase F — Per-map config: `MapConfigPanel.tsx` spatial-targets editor

**Depends on:** Phase C (SpatialTarget type, eligibility check).

1. `MapConfigPanel.tsx`: spatial targets section — add target (table picker from associatedTables, mode dropdown, column picker), remove target, missing-table warning. `PATCH /api/widgets/:id` endpoint already exists; no server changes needed.

### Phase G — `MapChartRenderer.tsx`: drawing toolbar + Vector overlay + shape sync

**Depends on:** Phase B (store — read shapes for overlay; write shapes on draw-end).

1. Effect 1 extension: create `VectorSource` + `VectorLayer` + add to map (alongside existing basemap TileLayer and ImageLayer stack).
2. Effect 7 (new): sync `shapes` → OL features (WKT parse → reproject → addFeature).
3. Effect 8 (new): wire/unwire OL `Draw` interaction based on `drawMode` local state; `drawend` handler converts geometry to WKT → `addShape()`.
4. Draw toolbar UI: Info / Pan / Bbox / Lasso / Circle mode buttons (CSS sibling to OL zoom controls).
5. Feature selection for delete: OL `Select` interaction → on `select`, listen for `keydown Delete` → `removeShape(feature.getId())`.
6. Per-map "Clear all shapes" button → `clearShapes()`.
7. OL cleanup in Effect 1 cleanup and Effect 8 cleanup: `removeInteraction(draw)`, `draw.dispose()`, `vectorLayerRef.current?.dispose()`.

### Phase H — FilterBar spatial chip row

**Depends on:** Phase B (store).

1. `DashboardsPage.tsx`: spatial chip row above per-table rows; "Clear all" calls `clearShapes()`; chip × calls `removeShape(shapeId)`.

### Phase I — Lifecycle reset block extension

**Depends on:** Phase B (store has `reset()`).

1. `DashboardsPage.tsx` DashboardOpen cleanup: add `useSpatialFilterStore.getState().reset()` as 5th call.
2. `App.tsx` UNAUTHORIZED handler: same.
3. Regression tests: verify 5-store reset fires correctly.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Coupling spatial target to the shape object

**What people do:** Embed `{ tableId, spatialMode, spatialCol }` on each `SpatialFilter` shape so the shape "knows" which table it applies to.

**Why it's wrong:** Shapes are dashboard-scoped. A single drawn bbox applies to all configured target tables. If the column config changes (user edits `MapConfigPanel` after drawing), shapes would carry stale column references. The per-call `spatialTarget` (derived fresh from widget config at materialize time) is always current.

**Do this instead:** `SpatialFilter` carries only geometry (WKT, label, shapeId, type). The `spatialTarget` is resolved at materialize time from `widget.config.spatialTargets`.

### Anti-Pattern 2: Triggering materialize from `MapChartRenderer` on draw-end

**What people do:** Wire the draw-end handler to call `materializeFilter` directly, bypassing `AggregatedWidgetRenderer`.

**Why it's wrong:** Violates the v1.3 "single materialize trigger" invariant. N map widgets × M table widgets = N×M DDL calls. Also, `MapChartRenderer` has no direct access to `AggregatedWidgetRenderer`'s abort controller or debounce state.

**Do this instead:** Draw-end writes to `useSpatialFilterStore`. `AggregatedWidgetRenderer` subscribes to `spatialFilterVersion` and triggers materialize on change (same debounce + abort pattern as column filters).

### Anti-Pattern 3: Storing OL Feature geometries in Zustand

**What people do:** Store OL `Geometry` objects or OL `Feature` instances in `useSpatialFilterStore`.

**Why it's wrong:** OL geometry objects are mutable, non-serializable, and have internal state. Zustand treats state as plain objects; storing non-plain objects breaks `Object.is` comparison, causes stale closures, and prevents any future state persistence (sessionStorage, URL).

**Do this instead:** Convert OL geometry to WKT string at draw-end time (`new WKT().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })`). Reconstruct OL features from WKT in Effect 7.

### Anti-Pattern 4: One Zustand spatial store per map widget

**What people do:** Give each `MapChartRenderer` its own `spatialFilterStore` instance (e.g., via a React context provider per widget).

**Why it's wrong:** Shapes must be cross-map visible. Map A's drawn shapes must render on Map B. A per-widget store would require cross-widget synchronization — the same problem that makes "lift state to parent" necessary. The singleton global store is the correct solution for session-scoped cross-widget state.

**Do this instead:** Singleton `useSpatialFilterStore`. All maps read from the same store; Effect 7 in each `MapChartRenderer` is the fan-out.

### Anti-Pattern 5: Skipping the `composeWhereClause` abstraction

**What people do:** Inline the `(spatial) AND (col)` string concatenation directly in the `index.ts` handler.

**Why it's wrong:** The composition logic has four cases (neither, spatial-only, col-only, both) and edge cases for the "1=1" fallback. Inlining it makes it untestable. The existing `buildServerWhereClause` and `buildSpatialWhereClause` are both pure functions — their composition should also be pure and separately testable.

**Do this instead:** `composeWhereClause(colClause, spatialClause)` in `spatialWhereClause.ts`. Unit-tested independently.

---

## Integration Points Summary

| Boundary | Communication | Affected Files |
|----------|---------------|----------------|
| Draw-end → store | `useSpatialFilterStore.addShape()` | `MapChartRenderer.tsx` (write), `spatialFilterStore.ts` |
| Store → overlay sync | Effect 7 shapesKey dep; OL WKT parse + `source.addFeature` | `MapChartRenderer.tsx` (all instances) |
| Store → materialize trigger | `spatialFilterVersion` dep in Effect 1 | `WidgetRenderer.tsx` (AggregatedWidgetRenderer) |
| Store → FilterBar chips | `shapes` selector in `DashboardsPage.tsx` | `DashboardsPage.tsx` |
| `AggregatedWidgetRenderer` → server | `materializeFilter({ ..., spatialFilters, spatialTarget })` | `client.ts`, `index.ts` |
| Server WHERE composition | `buildServerWhereClause(filters)` + `buildSpatialWhereClause(spatial, target)` + `composeWhereClause` | `index.ts`, `whereClause.ts`, `spatialWhereClause.ts` |
| View resolution → WMS | `viewsKey` selector → Effect 3 → `updateParams({ LAYERS: viewName, _mv })` | `MapChartRenderer.tsx`, `filterViewStore.ts` |
| Chip × → store → trigger | `removeShape` → `spatialVersion++` → Effect 1 fires | `DashboardsPage.tsx`, `spatialFilterStore.ts`, `WidgetRenderer.tsx` |
| Logout/switch reset | 5th call in 2 reset sites | `App.tsx`, `DashboardsPage.tsx` |

---

## Sources

- `kinetica_bi/server/src/lib/whereClause.ts` — existing pure column-AND builder (lines 1-92); structural template for `spatialWhereClause.ts`
- `kinetica_bi/server/src/lib/spatialQuery.ts` — `buildWkbQuery` at line 144 showing `ST_GEOMFROMTEXT` use in Kinetica; `SpatialQueryArgs` shape; `SpatialMode` union
- `kinetica_bi/server/src/lib/viewNaming.ts` — deterministic view-name shape (unchanged in v1.5)
- `kinetica_bi/server/src/lib/radiusConversion.ts` — spatial conversion helpers; circle materialize should reuse `pxToGroundDistance`/`pxToGroundDegrees` where applicable
- `kinetica_bi/server/src/index.ts` lines 684-745 — existing `POST/DELETE /api/filter/materialize` handler shape (modified in v1.5); lines 748-900 `POST /api/info/query` WKB 501 pattern to mirror for eligibility guard
- `kinetica_bi/src/store/filterStore.ts` — `ActiveFilter` type, `spatialVersion` counter pattern
- `kinetica_bi/src/store/filterViewStore.ts` — `FilterViewEntry`, `markMaterializing`/`setView`/`clearView` lifecycle; `materializeVersion` counter; `dashboardId` on entry for reset loop
- `kinetica_bi/src/store/infoSelectionStore.ts` — structural template for `spatialFilterStore.ts` (flat record shape, explicit `reset()`)
- `kinetica_bi/src/store/lastInfoClickContextStore.ts` — structural template for simple session-only flat store with `reset()`
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` lines 281-325 — Effect 1 materialize trigger; lines 239-275 Zustand selectors; V13-P-10 `materializeAbortRef` pattern
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` lines 360-438 — `viewsKey` selector, `shapesKey` pattern; OL `imageLayersRef`/`imageSourcesRef`/`sourceListenerCleanupRef`/`mountedRef` ref patterns; Effect 3 dep array
- `kinetica_bi/src/components/DashboardsPage.tsx` lines 388-407 — 4-store reset block (to extend to 5); lines 701-752 — FilterBar render block (spatial chip row insertion point)
- `.planning/research/_archive_v1.3/ARCHITECTURE.md` — v1.3 materialize pipeline detailed integration analysis; anti-patterns A1-A4 (preserved and extended in v1.5)
- `.planning/PROJECT.md` — v1.5 milestone scope definition; v1.3 KEY DECISIONS "sole materialize trigger" and "dual-path TTL recovery" (both preserved in v1.5)

---
*Architecture research for: Kinetica BI v1.5 Spatial filtering on map*
*Researched: 2026-05-11*
