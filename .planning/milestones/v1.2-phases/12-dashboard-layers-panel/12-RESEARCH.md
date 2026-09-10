# Phase 12: Dashboard Layers Panel - Research

**Researched:** 2026-05-05
**Domain:** Dashboard-scope layer registry, SQLite schema migration, Zustand store pattern, OpenLayers N-layer stack, React two-pane modal UX
**Confidence:** HIGH — grounded entirely in the existing codebase (Phases 9–11 patterns, MapChartRenderer.tsx, DashboardsPage.tsx, db.ts, client.ts) plus CONTEXT.md locked decisions. No new third-party library APIs to verify.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layer-Widget Architecture + Persistence**
- Multiple map widgets per dashboard; each picks a subset of dashboard layers via `widget.config.includedLayerIds: number[]`. New widgets default to all layers ON (lazy/inclusive — new layers added after widget creation appear automatically unless explicitly excluded).
- **Lift boundary:** `tableRef`/`tableId`, `spatialMode`, `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`, `renderMode`, `colormap`, `BLUR_RADIUS`, `POINTCOLOR`/`POINTSIZE`/`POINTOPACITY`, classbreaks, contour params move to `dashboard_layers.config` (JSON blob). `title`, `basemap`, `includedLayerIds` stay on `widget.config`. Zoom-to-data button and `bboxHelper.ts` are removed entirely.
- **Render order:** `dashboard_layers.position` is the single source of truth. No per-widget position override. All map widgets render the same z-order (subset filtered by `includedLayerIds`, position preserved).
- **Persistence model:** New `dashboard_layers` SQLite table — `id`, `dashboard_id` (FK → dashboards.id, ON DELETE CASCADE), `table_id` (FK → tables.id, NOT cascaded — soft FK), `layer_type TEXT CHECK('KineticaWms')`, `position INTEGER`, `config TEXT` (JSON blob), `created_at`, `updated_at`.
- **Hard cutover:** No migration of Phase 11 map widgets. Old-config map widgets render a reconfiguration placeholder. `bboxHelper.ts` + `bboxHelper.spec.ts` deleted in the same plan as the cutover.

**Layers Panel UI**
- A large modal opened from a new "Layers" top-bar button (sibling to Tables and Visualizations). Same `btn-primary btn-sm` styling. Modal uses the same portal/overlay pattern as `TablePickerModal` / `VisualizationPickerModal` (`DashboardsPage.tsx:616–643`).
- Two-pane layout: left rail = layer list + "+ Add layer" button; right pane = `<KineticaWmsLayerForm>` for the selected layer.
- Empty-list behavior: auto-create a blank layer on first open; user lands in config form immediately (no empty-state screen).
- Auto-save on every field change, debounced (300–500ms). No Apply / Cancel buttons.
- Per-layer row controls: drag handle, eye-icon visibility toggle, type-icon, auto-derived name (`${tableName} — ${renderMode}`), trash (with confirm), duplicate, edit (selects in right pane).
- Opacity slider (0–100%) per layer via OL `Layer.setOpacity()`.

**Per-Layer Config UX**
- `<KineticaWmsLayerForm>` extracted from `MapConfigPanel.tsx` into `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`. Receives layer config as a prop + `onChange(patch)` callback; parent owns auto-save debouncing.
- `MapConfigPanel.tsx` shrinks to: title, basemap selector, layer-inclusion picker (multi-select against `dashboardLayersStore`).
- `layerType: 'KineticaWms'` is the only valid value in v1.2 (CHECK constraint). TypeScript union is single-arm in v1.2.
- Sensible defaults for blank layers: `renderMode: 'raster'`, `spatialMode: 'latlon'`, `colormap: 'viridis'`, `POINTSIZE: 5`, `POINTCOLOR: '#3b82f6'`, `POINTOPACITY: 100`, classbreak/contour params empty, table/columns unset.

**Filter / Table Binding Model**
- Filter-store key = layer's `tableId`. Reuses `useFilterStore.filters[tableId]` exactly like Phase 9 — no store changes.
- AP-1, AP-2, AP-3, AP-4 all carry forward. Per-layer filter subscription in `MapChartRenderer`.
- M-01 through M-08 pitfall locks carry forward per layer instance.
- Map clicks are no-ops in Phase 12 (no `singleclick` or `pointermove` handlers).
- Filter bar already iterates `associatedTables`; planner verifies tables referenced only by a layer still produce chip groups.

### Claude's Discretion
- Exact SQL migration filename + version number
- Backend route file location (`routes/layers.ts` vs inline in `index.ts`)
- Debounce window (300ms vs 500ms)
- Auto-derived layer name dedup behavior (e.g., suffix `(2)`)
- Opacity: `Layer.setOpacity()` vs CSS wrapper (OL `Layer.setOpacity()` is the cleaner path)
- Drag-reorder: manual mouse events vs `react-grid-layout` (existing dep) vs `dnd-kit` (new dep); avoid new deps if possible
- Empty-state copy for missing-table badge
- Exact UI for layer-inclusion picker (multi-select dropdown vs checkbox list)
- Confirm-dialog for layer delete (reuse existing toast/modal pattern)
- `includedLayerIds` semantics: lazy/inclusive (new layers appear in pre-existing widgets unless explicitly excluded) is the default
- Cleanup strategy for Phase 11 dead code — delete in the same plan, not a follow-up
- `KineticaWmsLayerForm` location: `src/components/charts/` or `src/components/layers/`

### Deferred Ideas (OUT OF SCOPE)
- Map drill-down / identify endpoint (IDENT-V13-01..03)
- Hover-tooltip on map features
- Per-layer saved-filter / saved-view concept
- Basemap-as-layer
- SQL/aggregated layer types
- Inline layer rename
- Dashboard-scope keyboard shortcut for Layers modal
- Sync zoom/pan across multiple map widgets
- Per-map `position` override
- Per-classbreak-row alpha picker
- Standalone heatmap chart-type renderer (MAP-V13-01)
- Custom WMS layer style upload (MAP-V13-03)
- Bbox/lasso spatial select (DRILL-V13-02)
- Multiple layer types beyond KineticaWms
- Auto-migration of Phase 11 map widgets
</user_constraints>

---

## Summary

Phase 12 introduces a dashboard-scope layer registry — a parallel entity to widgets — that decouples WMS configuration (spatial columns, render mode, render params) from map widget config. The core technical work is: (1) a new SQLite table + CRUD API, (2) a Zustand store slice mirroring the widget-state pattern, (3) a two-pane `LayersModal` with auto-save, (4) a `KineticaWmsLayerForm` component lifted from `MapConfigPanel`, and (5) a rewritten `MapChartRenderer` that renders N stacked `ImageWMS` sources with per-layer filter subscriptions.

All the hard technical problems (OpenLayers lifecycle, filter store shape, WMS params, pitfalls M-01 through M-08) are already solved in Phase 11. Phase 12 extends those patterns — it does not require new technology research. The dominant implementation risk is correctly managing N parallel OL layer instances, each with independent filter subscriptions and `updateParams` calls, without regressing the M-01 (dispose) or M-02 (update not rebuild) locks.

The hard cutover for Phase 11 map widgets is intentional and low-risk because v1.2 has not shipped to production. The placeholder overlay ("This map needs to be reconfigured") is a one-time UI affordance, not migration logic.

**Primary recommendation:** Implement as a direct extension of Phase 11 patterns. Keep plans scoped to one concern each (DB schema, API surface, store, modal shell, config form extraction, renderer rework). The renderer rework and config form extraction are the two largest tasks and should each get their own plan.

---

## Standard Stack

### Core (all already installed, no new deps required)

| Library | Version | Purpose | Role in Phase 12 |
|---------|---------|---------|-----------------|
| `better-sqlite3` | 9.4.3 | SQLite DB | New `dashboard_layers` table; inline migration in `db.ts` |
| `express` | 4.19.2 | HTTP server | New `/api/dashboards/:id/layers[/:layerId]` routes |
| `zustand` | 4.5.2 | State management | New `dashboardLayersStore.ts` slice |
| `ol` | 10.9.0 | OpenLayers | N-layer `ImageWMS` + `ImageLayer` stack in renderer |
| `react` | 18.3.1 | UI | `LayersModal`, `KineticaWmsLayerForm`, layer-inclusion picker |
| `clsx` | 2.1.0 | className util | Modal + layer row styling |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.1.5 | Test runner | All new `.spec.ts` and `.spec.tsx` files |
| `@testing-library/react` | ^16.3.2 | Component tests | `LayersModal.spec.tsx`, `KineticaWmsLayerForm.spec.tsx`, `MapChartRenderer.spec.tsx` |
| `supertest` | ^7.2.2 | Server route tests | `server/tests/layers.test.ts` for CRUD routes |

### Drag-to-Reorder

**Recommendation: reuse `react-grid-layout` (2.2.2, already installed) for reorder logic — or implement manual CSS drag with `onDragStart`/`onDrop`/`onDragOver` on the list items.** Do not add `dnd-kit` or any new dependency. The layer list is a simple vertical ordered list, not a 2D grid — native HTML5 drag-and-drop events suffice and add zero bundle cost. If complexity warrants, `react-grid-layout` is available but its grid API is oriented to 2D layout, not 1D lists.

**Alternatives Considered**

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native drag events | `dnd-kit` | dnd-kit is superior for accessibility + touch but adds ~10 kB gzip to a tool with no touch-accessibility requirement today |
| Inline migration in `db.ts` | Separate migrations directory | CONTEXT.md mentions `kinetica_bi/server/src/migrations/` but the directory doesn't exist yet; db.ts uses the `PRAGMA table_info` + `ALTER TABLE` inline pattern for the v1.1 migration and that is the established project pattern. Planner picks: keep inline in `db.ts` for consistency with the v1.1 sessions migration pattern. |

**Installation:** No new packages needed. All dependencies are already present.

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
kinetica_bi/server/src/
├── db.ts                        # Add dashboard_layers table DDL + CRUD functions
├── types.ts                     # Add DashboardLayer type
└── index.ts                     # Add /api/dashboards/:id/layers[/:layerId] routes
                                 #   (or extract to routes/layers.ts — Claude's discretion)

kinetica_bi/server/tests/
└── layers.test.ts               # supertest CRUD + reorder coverage

kinetica_bi/src/
├── api/client.ts                # Add DashboardLayerDto type + listDashboardLayers,
│                                #   createLayer, updateLayer, deleteLayer, reorderLayers
├── store/
│   ├── dashboardLayersStore.ts  # New Zustand slice
│   └── dashboardLayersStore.spec.ts
└── components/
    ├── charts/
    │   ├── KineticaWmsLayerForm.tsx    # Extracted from MapConfigPanel
    │   ├── KineticaWmsLayerForm.spec.tsx
    │   ├── MapConfigPanel.tsx          # Shrunk: title + basemap + layer-inclusion picker
    │   ├── MapConfigPanel.spec.tsx     # Updated
    │   ├── MapChartRenderer.tsx        # Reworked: N-layer ImageWMS stack
    │   └── MapChartRenderer.spec.tsx   # Rewritten for N-layer
    └── LayersModal.tsx                 # Two-pane modal + layer list
        LayersModal.spec.tsx
```

### Pattern 1: SQLite Schema Migration (Inline `PRAGMA` Guard Pattern)

**What:** Add `dashboard_layers` to `SCHEMA_DDL` in `db.ts` using `CREATE TABLE IF NOT EXISTS`, then add a `PRAGMA table_info`-guarded `ALTER TABLE` block for the case where an existing `db.ts`-initialized database lacks the table (v1.1 → v1.2 upgrade path).

**When to use:** This matches the existing v1.0 → v1.1 sessions-column migration in `db.ts:88-112`. There is no separate migrations directory; migrations live inline.

**Example (existing pattern to mirror):**
```typescript
// In SCHEMA_DDL const (db.ts) — add:
CREATE TABLE IF NOT EXISTS dashboard_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL,
  layer_type TEXT NOT NULL CHECK(layer_type = 'KineticaWms'),
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

// After createDb instance creation — guarded migration (if table didn't exist in older deploys):
const layerCols = instance.prepare("PRAGMA table_info(dashboard_layers)").all() as Array<{ name: string }>;
if (layerCols.length === 0) {
  // Table was just created by IF NOT EXISTS — no ALTER needed
  // (guard handles future column additions if needed)
}
```

**Key detail on `table_id` FK:** CONTEXT.md specifies `table_id` is NOT a cascaded FK. The schema comment should note this is intentional: when a table is removed from the dashboard, layers survive (shown with error badge). Enforce this by omitting `REFERENCES tables(id)` in the DDL OR adding it without `ON DELETE CASCADE`. The frontend reads the layer's table against `associatedTables` at render time to detect the missing-table state.

### Pattern 2: Zustand Store for Dashboard Layers (Mirror of Filter Store)

**What:** A new Zustand slice `useDashboardLayersStore` that holds the array of layers for the currently-open dashboard, exposes actions for CRUD + reorder, and is loaded by `DashboardsPage` on dashboard open.

**When to use:** Any component that reads or mutates layers.

**Example:**
```typescript
// src/store/dashboardLayersStore.ts
import { create } from "zustand";
import type { DashboardLayerDto } from "../api/client";

type LayersState = {
  layers: DashboardLayerDto[];
  setLayers: (layers: DashboardLayerDto[]) => void;
  addLayer: (layer: DashboardLayerDto) => void;
  updateLayer: (id: number, patch: Partial<DashboardLayerDto>) => void;
  removeLayer: (id: number) => void;
  reorderLayers: (ordered: DashboardLayerDto[]) => void;
};

export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
  addLayer: (layer) => set((s) => ({ layers: [...s.layers, layer] })),
  updateLayer: (id, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, ...patch } : l),
  })),
  removeLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),
  reorderLayers: (ordered) => set({ layers: ordered }),
}));
```

**PITFALL S-01 lock applies here too:** `dashboardLayersStore` is the single source of truth for layer list state. `LayersModal` and `MapChartRenderer` both read from this store, never from local useState copies.

### Pattern 3: N-Layer `ImageWMS` Stack in MapChartRenderer

**What:** Replace the single `wmsLayerRef` / `wmsSourceRef` pair with arrays: `wmsLayerRefs` and `wmsSourceRefs`, indexed by the layer's position in the `includedLayers` array (layers sorted by `position`, filtered by `includedLayerIds`).

**When to use:** MapChartRenderer renders any number of dashboard layers on top of the basemap.

**Key decisions from CONTEXT.md:**
- N layers mounted in the same OL `Map` instance (not N separate maps)
- Each `ImageLayer` is added to the map via `map.addLayer()` in position order
- Basemap `TileLayer` added first (z-index lowest), then WMS layers in order
- Per-layer opacity: `imageLayer.setOpacity(layer.config.opacity / 100)` — OL accepts 0.0–1.0
- Per-layer cleanup: `useEffect` cleanup must `forEach` over all layer instances: `map.removeLayer()` + source cleanup

**Effect 2 (filter subscription) becomes per-layer:**
```typescript
// One useEffect per included layer — or one effect that iterates:
useEffect(() => {
  // PITFALL M-02 lock: updateParams per layer, never rebuild map
  includedLayers.forEach((layer, i) => {
    const src = wmsSourceRefs.current[i];
    if (!src) return;
    const tableFilters = useFilterStore.getState().filters[layer.config.tableId] ?? [];
    const whereClause = buildWhereClause(tableFilters);
    src.updateParams({
      ...buildWmsParams(layer.config, filterVersion, whereClause),
      _v: String(filterVersion), // M-02 lock
    });
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filterVersion]); // S-02 lock: primitive dep only
```

**Old-config placeholder:** When `widget.config.includedLayerIds` is `undefined` AND the config has Phase 11 fields (`spatialMode`, `renderMode`, etc.) but the widget is type `map`, render:
```tsx
<div className="widget-map-reconfigure">
  This map needs to be reconfigured. Open the Layers panel to create layers,
  then select them in this widget's config.
</div>
```
Detection: `config.spatialMode !== undefined && config.includedLayerIds === undefined`.

### Pattern 4: Auto-Save Debounce Pattern (Mirrors WidgetConfigModal)

**What:** Parent `LayersModal` owns the live layer list state and the PATCH dispatcher. `KineticaWmsLayerForm` calls `onChange(patch)` on every field change. Parent debounces the PATCH call by 300ms.

**When to use:** Every field edit in the form.

**Example:**
```typescript
// In LayersModal:
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleLayerChange = (layerId: number, patch: Partial<LayerConfig>) => {
  // Optimistic local update immediately
  useDashboardLayersStore.getState().updateLayer(layerId, { config: { ...layer.config, ...patch } });
  // Debounced PATCH to server
  if (debounceRef.current) clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => {
    updateLayer(dashboardId, layerId, patch).catch((err) => showToast(err.message, "error"));
  }, 300);
};
```

### Pattern 5: CRUD API Route Shape (Mirror of Widget Routes)

**What:** Express routes for layer CRUD under `/api/dashboards/:id/layers` — mirror the widget route shape in `index.ts:449-477`.

**Route surface:**
```
GET    /api/dashboards/:id/layers           → listDashboardLayers(dashboardId)
POST   /api/dashboards/:id/layers           → createLayer(dashboardId, input)
PATCH  /api/dashboards/:id/layers/:layerId  → updateLayer(layerId, attrs)
DELETE /api/dashboards/:id/layers/:layerId  → deleteLayer(layerId) → 204
PATCH  /api/dashboards/:id/layers/reorder   → reorderLayers(dashboardId, orderedIds[])
```

**Reorder endpoint:** Accepts `{ orderedIds: number[] }` body. Updates `position` for each layer in a single transaction using `db.transaction()`. Returns updated layer list.

### Anti-Patterns to Avoid

- **Rebuilding the OL map on layer list change:** Adding or removing a layer must call `map.addLayer()` / `map.removeLayer()` on the existing map instance — never `map.dispose()` + new `Map()`. Violates M-01 (loses zoom/pan state) and M-02.
- **Deriving `includedLayers` at render time from a non-stable selector:** Use a stable selector `useDashboardLayersStore(s => s.layers)` scoped to the dashboard. Do not pass the full layers array as a prop through many component levels (AP-1 parallel for layers).
- **Prop-drilling layer state:** Layers flow from `dashboardLayersStore` via selector. `MapChartRenderer` subscribes directly; it does not receive layers as a prop.
- **Storing layer opacity in WMS params:** Opacity is an OL `Layer`-level property (`setOpacity()`), not a Kinetica WMS parameter. Do not add `OPACITY` to the WMS URL — it has no effect server-side.
- **Auto-deleting layers when a table is removed:** Layer survives with error badge. No server-side cascade on `table_id`. This is an explicit CONTEXT.md decision.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite idempotent migration | Custom migration runner | `PRAGMA table_info` guard + `CREATE TABLE IF NOT EXISTS` in `db.ts` | Existing pattern in db.ts:88-112; avoids migration-file ordering complexity |
| Drag-to-reorder (1D list) | Full DnD library | Native HTML5 drag events (`draggable`, `onDragStart`, `onDrop`, `onDragOver`) | Layer list is a simple vertical list; no bundle cost; sufficient for keyboard-inaccessible internal tool |
| Debounce | Custom timer logic | `useRef<ReturnType<typeof setTimeout>>` + `clearTimeout` | Already the pattern in Phase 11's auto-suggest; keeps dependency count zero |
| WMS layer opacity | CSS `opacity` on container div | `OL ImageLayer.setOpacity(0.0–1.0)` | OL manages opacity at compositing time; CSS opacity would also dim the basemap overlaid beneath it |
| Layer config validation | Custom schema library | TypeScript types + inline `isConfigComplete()` guard | Same gate used in Phase 11; zod not installed; TypeScript strict is sufficient |
| Layer name derivation | Complex naming service | `${tableName} — ${renderMode}` with `(2)` suffix counter | Simple string concat; computed from existing layer fields |

**Key insight:** Phase 12 has no unsolved problems. Every pattern already exists in the codebase. The work is composition and extraction, not invention.

---

## Common Pitfalls

### Pitfall 1: Accumulating OL Layer Instances on Layer List Change (M-01 variant)
**What goes wrong:** When `includedLayerIds` changes (user toggles a layer's eye icon), if the renderer tears down and recreates all N `ImageLayer` instances, it loses the per-layer `updateParams` handle AND triggers a full tile re-fetch for unchanged layers. Worse: if the renderer disposes the OL map itself, the user loses their zoom/pan position.
**Why it happens:** Developer uses a `useEffect([layers])` that creates fresh `ImageLayer` instances on every layer-list change.
**How to avoid:** Keep the OL `Map` instance stable. Manage layers imperatively: `map.addLayer()` when a layer is added to `includedLayers`, `map.removeLayer()` when removed. Use `wmsLayerRefs.current` as a `Map<layerId, ImageLayer>` keyed by layer ID rather than an array.
**Warning signs:** Map zooms to default view after toggling a layer's visibility.

### Pitfall 2: Per-Layer Filter Subscription Fires for ALL Filter Changes (C-02 variant)
**What goes wrong:** Each `ImageWMS` source in the N-layer stack fires `updateParams` when any table's filters change, even tables the layer is not bound to.
**Why it happens:** A single `useEffect([filterVersion])` calls `updateParams` on all layers without checking if the specific layer's `tableId` filters actually changed.
**How to avoid:** Inside the `filterVersion`-subscribed effect, gate each layer's `updateParams` call by actually reading `useFilterStore.getState().filters[layer.config.tableId]`. Even if the effect fires for all filter changes (because `filterVersion` bumps globally), only pass a new `QUERY` param when the layer's own table filters have changed. The `_v=filterVersion` suffix still updates (cache-bust lock M-02), but the QUERY value doesn't change needlessly.
**Warning signs:** All WMS layers refetch tiles when a filter is added for an unrelated table.

### Pitfall 3: Opacity State Stored in Both OL Layer and React State
**What goes wrong:** Developer stores opacity in `useState` for the slider AND in `layer.config.opacity` in the store. On re-render, the OL layer's opacity is reset to the config value, fighting the slider's local state.
**Why it happens:** Two-way binding between UI slider and OL layer opacity without a single source of truth.
**How to avoid:** Single source of truth is `layer.config.opacity` in `dashboardLayersStore`. The slider reads from the store and calls `onChange`; the `useEffect` that manages OL layers calls `imageLayer.setOpacity(layer.config.opacity / 100)` whenever the layer config changes. No local `useState` for opacity.
**Warning signs:** Opacity slider snaps back to previous value on re-render.

### Pitfall 4: Missing-Table Detection Fails When Layer's Table Is in Another Dashboard
**What goes wrong:** A layer's `table_id` matches a table that exists in the `tables` global table but is NOT in `dashboard_tables` for the current dashboard. The frontend checks `associatedTables` (scoped to the current dashboard) to determine if a table is "available" — a layer whose table is in another dashboard but not this one shows the "Table removed" badge erroneously.
**Why it happens:** The check uses `associatedTables.find(t => t.id === layer.tableId)` which is dashboard-scoped, not global.
**How to avoid:** This is actually the CORRECT behavior per CONTEXT.md: "Auto-disabled state when a layer's `table_id` is removed from the dashboard's tables." The error badge is expected when the table is not in the CURRENT dashboard's `dashboard_tables` join, regardless of whether it exists globally.
**Warning signs:** None — this is the intended design. Document it with a comment.

### Pitfall 5: LayersModal Auto-Save Races With Optimistic Store Update
**What goes wrong:** On rapid field changes, the debounced PATCH fires with the config from 300ms ago, overwriting the more recent optimistic store update.
**Why it happens:** The debounce closure captures the `patch` from when the timeout was set, not from when it fires.
**How to avoid:** The debounce should snapshot the FULL current config at fire time (not the delta). Use a `useRef` to hold the "pending config" that is updated synchronously on every change; the debounced PATCH reads from that ref, not from a closure over the original `patch` parameter.

### Pitfall 6: Drag-Reorder Position Gaps After Delete
**What goes wrong:** After deleting layer at position 3 from a 5-layer list, positions become 0, 1, 2, 4. A subsequent drag-reorder normalizes positions, but the gap causes ordering edge cases.
**Why it happens:** CONTEXT.md specifies "gaps allowed during reorder" but doesn't address delete-induced gaps.
**How to avoid:** The reorder PATCH endpoint normalizes positions to 0-N-1 for all layers in the dashboard. Use the `PATCH /api/dashboards/:id/layers/reorder` endpoint (not individual PATCHes) whenever any order change occurs, including after delete.
**Warning signs:** Layer render order differs from the panel order after a delete + reorder sequence.

### Pitfall 7: `includedLayerIds` Default = All Layers — Stale Default After New Layer Added
**What goes wrong:** If "all layers ON by default" is implemented by snapshotting `dashboard_layers` IDs at widget-create time (eager), a new layer added after the widget was created is NOT automatically included.
**Why it happens:** Eager snapshot doesn't update as layers are added.
**How to avoid:** Per CONTEXT.md (Claude's discretion, locked as lazy/inclusive): default is NOT a stored snapshot — it's computed at render time as: "any layer whose ID is NOT in `widget.config.excludedLayerIds`." This means `includedLayerIds` in widget config actually means `excludedLayerIds` semantically (store opt-outs, not opt-ins). OR: store `includedLayerIds` as empty array = all ON (treat absent/empty as all-inclusive). The planner picks; lazy/inclusive is the CONTEXT.md direction.

---

## Code Examples

Verified patterns from existing Phase 11 codebase:

### OL `ImageLayer` Opacity (Phase 11 `MapChartRenderer.tsx` — existing API)
```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx
// OL ImageLayer is already imported and used; setOpacity() is its standard API.
import ImageLayer from "ol/layer/Image";
import ImageWMS from "ol/source/ImageWMS";

const source = new ImageWMS({ url: `${API_BASE}/api/wms`, params: wmsParams });
const layer = new ImageLayer({ source, opacity: 0.8 }); // 0.0–1.0
// Later: layer.setOpacity(0.5);
map.addLayer(layer);
```

### `PRAGMA table_info` Migration Guard (db.ts:88-112 exact pattern)
```typescript
// Source: kinetica_bi/server/src/db.ts:88-112
const cols = instance
  .prepare("PRAGMA table_info(sessions)")
  .all() as Array<{ name: string }>;
const colNames = new Set(cols.map((c) => c.name));
if (!colNames.has("credential_type")) {
  instance.exec(
    "ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'"
  );
}
```

### `apiFetch` CRUD Function Pattern (client.ts exact shape)
```typescript
// Source: kinetica_bi/src/api/client.ts:330-343
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
```

### Zustand Slice Pattern (filterStore.ts exact shape — mirror for dashboardLayersStore)
```typescript
// Source: kinetica_bi/src/store/filterStore.ts
import { create } from "zustand";
export const useFilterStore = create<FilterState>((set) => ({
  filters: {},
  filterVersion: 0,
  addFilter: (tableId, filter) => set((state) => { /* ... */ }),
}));
```

### Express Route Pattern — Widget CRUD (index.ts:449-477)
```typescript
// Source: kinetica_bi/server/src/index.ts:449-462
app.post("/api/dashboards/:id/widgets", (req, res) => {
  const dashboardId = Number(req.params.id);
  if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
  const input = req.body as Omit<Widget, "id" | "dashboard_id" | "created_at" | "updated_at">;
  if (!input?.title || !input?.type) {
    return res.status(400).json({ error: "Widget requires 'title' and 'type'." });
  }
  const widget = createWidget(dashboardId, { /* ... */ });
  return res.status(201).json(widget);
});
```

### Modal Pattern (DashboardsPage.tsx:616-629)
```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx:616-629
{showTableModal && (
  <TablePickerModal
    associatedTables={associatedTables}
    onAdd={handleAddTable}
    onRemove={handleRemoveTable}
    onClose={() => setShowTableModal(false)}
  />
)}
// TablePickerModal renders with div.modal-overlay + div.modal-content pattern
```

### `buildWmsParams` Usage (MapChartRenderer.tsx — to be reused per layer)
```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx
import { buildWmsParams, type MapWidgetConfig } from "../../lib/wmsUrlBuilder";
// Per-layer — layer.config has the same field shape as MapWidgetConfig
const wmsParams = buildWmsParams(
  layer.config as MapWidgetConfig,
  filterVersion,
  whereClause
);
```

---

## State of the Art

| Old Approach (Phase 11) | New Approach (Phase 12) | Impact |
|-------------------------|-------------------------|--------|
| Single `ImageWMS` source per map widget | N stacked `ImageWMS` sources, one per included layer | Map widgets render multiple overlaid datasets |
| `widget.config` holds all spatial/render params | `dashboard_layers.config` holds spatial/render params; `widget.config` holds only `title`, `basemap`, `includedLayerIds` | Layer config is reused across multiple map widgets |
| `MapConfigPanel` is the only spatial config surface | `KineticaWmsLayerForm` is the single source of truth for layer config fields | Config form reused by `LayersModal` without duplication |
| Per-widget table binding for WMS | Per-layer table binding; widget picks which layers to include | Multiple tables can be visualized on one map |
| `bboxHelper.ts` + zoom-to-data button | Deleted entirely | Simplification; multi-table bbox is semantically ambiguous |

**Deprecated/outdated in Phase 12:**
- `MapWidgetConfig.spatialMode`, `latColumn`, `lonColumn`, `wktColumn`, `wkbColumn`, `renderMode`, `colormap`, `BLUR_RADIUS`, `POINTCOLOR`, `POINTSIZE`, `POINTOPACITY`, `cbColumn`, `cbBreakType`, `classbreaks`, contour params — all move to `dashboard_layers.config`. The TypeScript type for `widget.config` on map widgets shrinks accordingly.
- `fetchBbox` from `bboxHelper.ts` — deleted. `autoFitDoneRef` logic in `MapChartRenderer` — deleted.
- `MapConfigPanel`'s spatial-mode picker, render-mode picker, and all render-mode-specific param groups — extracted to `KineticaWmsLayerForm`. Only title + basemap + layer-inclusion picker remain.

---

## Open Questions

1. **`reorderLayers` endpoint collision with `/:layerId` route**
   - What we know: The route `PATCH /api/dashboards/:id/layers/reorder` would be registered before `PATCH /api/dashboards/:id/layers/:layerId`. Express matches routes in registration order, so `reorder` would match as the literal string `:layerId` if registered after.
   - What's unclear: Whether the routes are registered in the right order, or whether a separate path like `PATCH /api/dashboards/:id/layers-order` is cleaner.
   - Recommendation: Register `reorder` route BEFORE the generic `/:layerId` route. Express matches literally before parameterically if registered first. Document this ordering dependency with a comment.

2. **`includedLayerIds` storage semantics — opt-in vs opt-out**
   - What we know: CONTEXT.md directs lazy/inclusive default (new layers appear in pre-existing widgets automatically). This means storing `excludedLayerIds` is semantically cleaner than `includedLayerIds`.
   - What's unclear: CONTEXT.md uses the name `includedLayerIds` in the schema but the behavior is opt-out. Storing an empty array as "all ON" or storing `excludedLayerIds` are both valid.
   - Recommendation: Store `widget.config.includedLayerIds` as an explicit array populated at widget-create time as a snapshot of current layer IDs, updated on layer include/exclude toggle. "Lazy" = on layer CREATE, append the new layer ID to every existing map widget's `includedLayerIds`. This avoids the opt-out semantics confusion at the cost of one PATCH per map widget when a new layer is added. Planner picks.

3. **Filter bar with layers-only tables**
   - What we know: CONTEXT.md notes "a table referenced ONLY by a layer must still produce a chip group when filtered." The filter bar currently iterates `views` (which come from `dashboard_tables` join). A table bound to a layer but not added via the Tables modal would not appear in `views`.
   - What's unclear: Whether the filter bar needs to union `layer.tableId` values into its table list.
   - Recommendation: Planner verifies: if a layer's `table_id` maps to a table that was added via the Tables modal (which is the current flow — users add tables first, then bind layers to those tables), no change is needed. If layers can be bound to tables not in `dashboard_tables`, the filter bar's iteration needs to union `associatedTables` with `layers.map(l => l.tableId)`. CONTEXT.md workflow implies tables are added before layers, so no change is expected.

---

## Sources

### Primary (HIGH confidence — verified against existing codebase)
- `kinetica_bi/server/src/db.ts` — SQLite schema pattern, `PRAGMA table_info` migration guard, `mapWidget` / CRUD function shape
- `kinetica_bi/server/src/index.ts:449-502` — Express route shape for widgets and dashboard-table associations
- `kinetica_bi/src/api/client.ts` — `apiFetch`, `throwForStatus`, DTO types, CRUD function shape
- `kinetica_bi/src/components/DashboardsPage.tsx:334-643` — Modal open/close pattern, top-bar button placement, auto-save comment at :441-443
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — OL lifecycle, `ImageWMS` + `ImageLayer` pattern, per-layer pattern basis
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Source for the KineticaWmsLayerForm extraction
- `kinetica_bi/src/store/filterStore.ts` — Zustand slice shape to mirror in `dashboardLayersStore.ts`
- `kinetica_bi/src/test/setup.ts` + `kinetica_bi/vitest.config.ts` — Test infrastructure; new stores automatically covered by the Zustand reset shim

### Secondary (HIGH confidence — CONTEXT.md locked decisions)
- `.planning/phases/12-dashboard-layers-panel/12-CONTEXT.md` — All architectural decisions verified against codebase; no contradictions found
- `.planning/research/PITFALLS.md` — M-01..M-08, D/C/S pitfall locks; all carry forward

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; versions confirmed from `package.json`
- Architecture patterns: HIGH — every pattern traced to existing working code in the codebase
- Pitfalls: HIGH — inherited from verified Phase 11 patterns; Phase 12 extends, does not replace them
- Open questions: LOW — they are questions, not unknowns that block planning; all have a recommended resolution

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable patterns; only risk is if OpenLayers API changes, which it won't within 30 days)
