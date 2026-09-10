# Project Research Summary

**Project:** Kinetica BI v1.2 — Interactive Dashboards
**Domain:** Map chart (OpenLayers + Kinetica WMS) + click-driven drill-down + cross-chart filter coordination
**Researched:** 2026-05-01
**Confidence:** HIGH (architecture + features from direct codebase read; MEDIUM on Kinetica-specific WMS param names; pitfalls HIGH)

---

## Executive Summary

v1.2 adds three tightly coupled features to the existing Kinetica BI dashboard: a map chart driven by Kinetica's WMS tile endpoint, click-driven drill-down on all chart types, and automatic cross-chart filter coordination for charts sharing the same table. The foundational dependency is a new `useFilterStore` Zustand slice (keyed by `tableId`) — everything else writes to or reads from it. Getting that store's structure right on day one (tableId-keyed, same-column filter replacement, 10-filter cap, correct null handling) prevents at least six critical bugs that would require painful refactoring later.

The stack addition is deliberately minimal: one new frontend production dependency (`ol@^10.5.0`), one new server route (`POST /api/identify` using the existing `kineticaSql` helper), and one new Zustand store file. No new server npm packages, no new database tables, no new state management library. The existing `kineticaWms` proxy, chart registry, and `ChartTypeDefinition` pattern are fully compatible and require extension only, not replacement. The WMS filter mechanism uses Kinetica's `QUERY` parameter (a WHERE clause applied server-side before tile rendering), which means filter changes invalidate and refetch tiles without any client-side data processing.

The primary implementation risks are: (1) Kinetica-specific WMS parameter names (`X_ATTR`/`Y_ATTR` vs `GEO_ATTR`, the exact `STYLES` values, the identify endpoint shape, and the server-side filter param name) are MEDIUM confidence and require a dedicated spike task before writing WMS-specific code; (2) the `WidgetRenderer`-to-filter-store subscription wiring is the largest single architectural change — making every chart's SQL query dynamically inject a WHERE clause touches every renderer; (3) projection alignment (EPSG:3857 vs 4326) must be locked early to avoid subtle tile-offset bugs that pass visual inspection at low zoom but fail at high zoom.

---

## Key Findings

### Stack Additions

One new frontend production dependency only. No new server deps.

**New production dependency:**
- `ol@^10.5.0` — OpenLayers map rendering engine. Import only what you use (never `import * from 'ol'`). TypeScript types bundled; no `@types/ol`. Vite ESM compatible out of the box. Lazy-load `MapChartRenderer` via `React.lazy()` to keep the main bundle clean. Expected bundle cost: ~120–150 KB gzipped for the subset used.

**New server route (zero new npm deps):**
- `POST /api/identify` — ~50 LOC route that validates coordinates, builds `ST_Distance ORDER BY LIMIT 1` SQL, delegates to existing `kineticaSql`. Existing audit/error path covers it. Kinetica's `GetFeatureInfo` WMS request is NOT supported — the SQL path is correct.

**New frontend modules (zero new npm deps):**
- `src/store/filterStore.ts` — new Zustand slice, tableId-keyed `Record<number, ActiveFilter[]>`
- `src/components/charts/MapChartRenderer.tsx` + `MapConfigPanel.tsx` — OL map component and custom config panel
- `src/api/client.ts` modification — add `identify()` helper; add `signal` param to `runSql` for `AbortController` support

**Spike required before WMS code:** Call `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities` to confirm exact param spellings: `X_ATTR` vs `GEO_ATTR` for spatial columns, `STYLES` values for each render mode, the server-side filter param name (`QUERY` vs `CQL_FILTER` vs other), and identify endpoint existence.

### Feature Inventory

**Table stakes — must ship (P0/P1):**

| ID | Feature | Complexity |
|----|---------|-----------|
| TS-F1 | Shared filter state per table (Zustand, transient) | M |
| TS-F2 | All same-table charts re-query on filter change | L |
| TS-D1 | Click on chart element adds equality filter | M |
| TS-D3/D4 | Clear-all + per-filter dismiss badges | S |
| TS-D5 | Drill-down column config per chart type | M |
| TS-D6 | Visual "selected" state on clicked element | M |
| TS-M1 | Spatial column mode picker (lat/lon \| WKT \| WKB) | M |
| TS-M9 | OpenLayers WMS tile render | L |
| TS-M14 | Hover tooltip (identify probe) | M |
| TS-M15 | Map click drill-down (raster/heatmap/classbreak only) | L |
| TS-M10/F4 | Tile reload + invalidation on filter change | M |
| TS-M13 | Pan and zoom | S |
| TS-M11/M12 | Map loading + error states | S |

**Cheap differentiators to include (P2):**
- Point-size slider (D-1, S — field already in `map.ts`, just wire to WMS)
- Toast on drill-down (D-4, S — existing Toast component, ~10 lines)
- Basemap style selector (D-7, S — one OL source swap + config select field)
- "Zoom to data" button (TS-M16, S — one bbox SQL query + `view.fit()`)

**Defer to v1.3+:** Filter persistence (AF-3), bbox/lasso spatial select (AF-1/2), multi-value OR selection (AF-8), undo keyboard shortcut (D-5).

**Anti-features explicitly rejected in v1.2:** hover-based filter activation (AF-5), SQL editor in filter bar (AF-6), contour mode drill-down (AF-7), per-chart filter exclusion toggle (AF-4).

### Architecture

**Component map:**

| Component | Status | Key Change |
|-----------|--------|-----------|
| `src/store/filterStore.ts` | NEW | `Record<number, ActiveFilter[]>`, `addFilter` with same-column replace + cap, `buildWhereClause` |
| `src/components/charts/MapChartRenderer.tsx` | NEW | OL map `useRef`+`useEffect` lifecycle; WMS tile source; filter subscription |
| `MapConfigPanel.tsx` | NEW | Custom config panel — conditional spatial column picker |
| `POST /api/identify` route | NEW | In `server/src/index.ts`; delegates to `kineticaSql` |
| `WidgetRenderer.tsx` | MODIFIED | `onDrillDown` prop; `MapChartRenderer` case; filter store subscription |
| `AggregatedWidgetRenderer` | MODIFIED | Subscribe to filter store; inject WHERE into SQL; AbortController |
| Recharts renderers (bar/line/pie/scatter/table) | MODIFIED | Add `onClick` handlers; emit `onDrillDown` |
| Filter bar component | MODIFIED | Read from `useFilterStore`; filter chips with dismiss |
| `src/components/charts/definitions/map.ts` | MODIFIED | Replace placeholder with full spatial config descriptor |
| `src/api/client.ts` | MODIFIED | Add `identify()` helper; add `signal` to `runSql` |
| `kinetica.ts`, `auth.ts`, `db.ts` | UNCHANGED | No server infrastructure changes |

**Key pattern — `injectWhereClause`:** Pure string utility that appends active filter clause to `config.sql` at render time (before GROUP BY/ORDER BY if present). Not a SQL parser. This makes TS-F2 work without touching stored SQL.

**Key pattern — map lifecycle:** Create map in `useEffect([])` with containerRef guard. Return cleanup: `map.setTarget(undefined)` then `map.dispose()`. Config changes use `source.updateParams()` and `view.animate()` — never remount. OL event listeners cleaned up with `map.un()` in effect cleanup.

**Build order (architecture researcher's 5-phase recommendation):**
A. Filter store + `injectWhereClause` → B. Existing chart drill-down + filter bar → C. Map WMS render + config → D. Map identify + click drill-down → E. AbortController + polish

### Critical Pitfalls

**CRITICAL — must address in same implementation plan as their phase:**

1. **Filter store tableId-keyed from day one (C-02, C-04)** — Flat array causes cross-table filter bleed and O(N) re-renders on every click. `Record<number, ActiveFilter[]>` structure is a one-time decision.

2. **SQL escape + NULL handling in `buildWhereClause` (D-02, D-03)** — `O'Brien` clicked value breaks SQL. `col = NULL` is always false; must produce `col IS NULL`. Same code path; address together.

3. **Same-column filter replacement in `addFilter` (D-05)** — Clicking region=EAST then region=WEST accumulates `region = 'EAST' AND region = 'WEST'` → zero rows silently. Replace, don't append, on same column.

4. **Map component: M-01 + M-02 + M-03 + M-08 together** — OL dispose on unmount, WMS tile cache bust on filter change, projection lock, and `Cache-Control: no-store` on proxy must all be in the initial map plan. M-02 and M-08 share one fix (no-store header). Cannot be deferred as polish.

5. **S-01 — filters live in Zustand only** — No component-local `useState` for filter values. Single source of truth enforced in code review.

---

## Implications for Roadmap

Both researchers agree on build order. Recommended shape: **4 delivery phases** (consolidating the architecture researcher's 5 phases; "polish" is absorbed into Phase 4).

### Phase 1: Filter Foundation

**Rationale:** `useFilterStore` is the dependency root. All three feature areas write to or read from it. Establishing structure, invariants, and tests before any UI work prevents the hardest refactors.

**Delivers:**
- `src/store/filterStore.ts` with `Record<number, ActiveFilter[]>`, same-column replace, 10-filter cap, `buildWhereClause` with SQL escape + null handling
- `injectWhereClause` utility with full test coverage (including WHERE/GROUP BY injection, edge cases)
- `ChartTypeDefinition.supportsDrillDown` flag; `drillDownColumn` config field in all chart definitions
- Zustand shim canary test confirming new store is covered (S-03)

**Must address together:** C-02, C-04 (tableId-keyed), D-02, D-03, D-05 (filter builder correctness), S-01 (Zustand-only rule), S-02 (clear triggers re-fetch)

**Research flag:** Standard patterns. No additional research needed.

---

### Phase 2: Existing Chart Drill-Down + Cross-Chart Coordination

**Rationale:** Proves the filter pipeline (click → filter store → re-query → display) end-to-end on familiar Recharts components before adding OpenLayers complexity.

**Delivers:**
- `onDrillDown` prop threading through `WidgetRenderer` → bar/line/pie/scatter/table/records renderers
- `AggregatedWidgetRenderer` subscribes to `useFilterStore`, uses `injectWhereClause`, has `AbortController`
- `runSql` gains `signal` param
- Filter bar reads `useFilterStore`; renders filter chips with dismiss (TS-D4) and clear-all (TS-D3)
- Visual "selected" state on clicked element (TS-D6, Recharts Cell fill override)
- Column type guard in drill-down config panel (D-01 — exclude geometry/blob/text columns from picker)
- Stale-data contract on re-fetch error (C-03 — clear data before new fetch, not preserve stale data)

**Research flag:** Standard patterns. No additional research needed.

---

### Phase 3: Map Chart (WMS Render + Config)

**Rationale:** Map renders Kinetica WMS tiles and participates in filter coordination already proven in Phase 2. Spike on WMS params runs at the start before any WMS code is written.

**Delivers:**
- **Spike first:** `GetCapabilities` XML inspection → confirm `X_ATTR`/`GEO_ATTR`, `STYLES` values, filter param name, projection support. Write findings to a spike note before continuing.
- `MapConfigPanel.tsx`: spatial mode picker (TS-M1), render mode selector (TS-M2), color/opacity/zoom/center fields, classbreak column + cardinality guard (TS-M7, M-06), drill-down column selector (TS-M8)
- `MapChartRenderer.tsx`: OL init/dispose (M-01), `TileWMS` source, filter subscription + `source.updateParams()` (M-02), projection locked (M-03), `Cache-Control: no-store` on proxy (M-08)
- WKT vs WKB param branching in WMS URL builder (M-04)
- Pan/zoom (TS-M13), loading state (TS-M11), error state (TS-M12), tile reload on filter (TS-M10/F4)
- WMS URL length guard: filter cap from Phase 1 is primary defense; add `no-store` (M-07)
- Cheap differentiators: D-1 (point-size slider), D-7 (basemap selector)

**Must address together:** M-01, M-02, M-03, M-08 (all in initial MapChartRenderer plan); M-04 (WKT vs WKB branching); M-06 (cardinality guard)

**Research flag:** NEEDS SPIKE. Do not write WMS parameter construction code until GetCapabilities is inspected on the deployed Kinetica instance.

---

### Phase 4: Map Drill-Down (Identify Probe) + Polish

**Rationale:** Map must be rendering tiles before the identify probe is useful or testable.

**Delivers:**
- **Spike first:** Confirm `ST_Distance` function signature on deployed Kinetica version (POINT vs ST_POINT vs ST_GeomFromText syntax for both latlng and wkt/wkb modes)
- `POST /api/identify` route: validate tableRef (identifier regex), validate clickLat/clickLon (numeric), build `ST_Distance ORDER BY LIMIT 1` SQL for latlng and wkt/wkb modes, delegate to `kineticaSql`, return `{ found, row, distance }`
- `identify()` client helper in `src/api/client.ts`
- `MapChartRenderer` OL `singleclick` handler → `POST /api/identify` → `onDrillDown` chain (TS-M15)
- Hover tooltip (TS-M14) using same identify endpoint
- Contour mode: click is a no-op (AF-7 enforcement in click handler guard)
- Tie-break rule in spec before code: first result in identify response wins (C-05)
- `AbortController` on identify fetch
- Race condition mitigation: `source.clear()` on filter change (C-01)
- "Zoom to data" (TS-M16), toast on drill-down (D-4)
- Manual QA pass against "Looks Done But Isn't" checklist from PITFALLS.md

**Must address together:** C-05 (tie-break rule documented in plan), C-01 (race condition + source.clear())

**Research flag:** NEEDS SPIKE on `ST_Distance` signature before route is written.

---

### Phase Ordering Rationale

- Phase 1 before all: filter store structure (tableId-keyed, same-column replace) cannot be cheaply retrofitted; do it right once
- Phase 2 before Phase 3: proves filter cycle on simple charts; bugs surface in familiar code rather than inside OpenLayers
- Phase 3 before Phase 4: map must render tiles before identify probe is testable
- Spike tasks front-loaded in Phases 3 and 4: no Kinetica-specific param code until verified against the running instance

### Research Flags

**Needs spike at phase start:**
- Phase 3: `GetCapabilities` XML → exact WMS param names (`X_ATTR`/`GEO_ATTR`, `STYLES` values, server-side filter param name, projection support). One task before any WMS construction code.
- Phase 4: `ST_Distance` function signature on deployed Kinetica (POINT syntax). One task before route code.

**Standard patterns (no research needed):**
- Phase 1: Zustand store patterns, SQL utility logic
- Phase 2: Recharts `onClick`, AbortController, `useEffect` deps

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | `ol@^10.5.0` choice is HIGH; Kinetica WMS param names are MEDIUM — require `GetCapabilities` spike |
| Features | HIGH | Codebase directly read; BI UX conventions well-established (Grafana/Kibana/Superset/Tableau) |
| Architecture | HIGH | Component boundaries from direct codebase inspection; OL+React patterns are standard |
| Pitfalls | HIGH | Grounded in codebase analysis (`kineticaWms` proxy, `useApiQuery` active-flag, Zustand shim); OL dispose and WMS cache patterns are well-established |

**Overall confidence:** HIGH on architecture and implementation approach. MEDIUM on Kinetica-specific API surface.

### Gaps to Address

- **WMS param names** (`X_ATTR` vs `GEO_ATTR`, `STYLES` exact values, server-side filter param): validate via `GetCapabilities` at Phase 3 start
- **`ST_Distance` signature** on deployed Kinetica: exact constructor syntax (POINT vs ST_POINT vs ST_GeomFromText): validate at Phase 4 start
- **Kinetica WMS projection support**: verify `SRS=EPSG:3857` is accepted; if not, fallback to EPSG:4326 with explicit OL Projection config — decision must be in Phase 3 spike
- **Filter clear empty-ref stability** (S-02): ensure `clearTableFilters` creates a new array reference (not reusing `[]`) so Zustand notifies subscribers
- **Kinetica parameterized query support**: `/execute/sql` `?` placeholder binding — if supported, use it in `buildWhereClause` instead of manual escaping for D-02

---

## Sources

### Primary (HIGH confidence — codebase direct read)
- `kinetica_bi/server/src/kinetica.ts` — `kineticaWms` proxy pattern, `kineticaSql` helper
- `kinetica_bi/server/src/index.ts` — existing `/api/wms` route
- `kinetica_bi/src/components/charts/registry.ts`, `WidgetRenderer.tsx`, `ChartConfigPanel.tsx`
- `kinetica_bi/src/components/charts/definitions/map.ts` — current placeholder stub
- `kinetica_bi/src/hooks/useApiQuery.ts` — `active` flag stale-response pattern
- `kinetica_bi/src/store/auth.ts` — existing Zustand store patterns
- `kinetica_bi/__mocks__/zustand.ts`, `src/test/setup.ts` — store-reset shim
- `kinetica_bi/src/components/DashboardsPage.tsx` — filter bar lines 450–471

### Secondary (MEDIUM confidence — training data, Kinetica 7.x docs)
- Kinetica WMS API: `STYLES`, `QUERY`/`CQL_FILTER`, `X_ATTR`/`Y_ATTR`/`GEO_ATTR`, classbreak params
- `ST_Distance` Kinetica SQL spatial function
- OpenLayers v10: `Map.dispose()`, `TileWMS.updateParams()`, `source.clear()`, `singleclick` event

### Tertiary (LOW confidence — verify at implementation time)
- Whether Kinetica's `/execute/sql` supports `?` parameter binding
- Exact Kinetica WMS classbreak param names (`CB_COLUMN_NAME`, `CB_BREAK_TYPE`, etc.)
- Kinetica WMS identify endpoint (confirmed NOT `GetFeatureInfo`; SQL path is correct approach)

---

*Research completed: 2026-05-01*
*Ready for roadmap: yes*
