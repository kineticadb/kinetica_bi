# Pitfalls Research: v1.5 Spatial Filtering on Map

**Domain:** Adding OL Draw interactions + Kinetica spatial-WHERE pipeline to an existing React + OpenLayers + v1.3 materialize app
**Researched:** 2026-05-11
**Confidence:** HIGH — grounded in codebase analysis of `MapChartRenderer.tsx` (Effect 1-6 structure, mountedRef, sourceListenerCleanupRef, singleclick handler), `spatialQuery.ts` (SQL builder patterns), `whereClause.ts` (AND-chain builder), `wmsUrlBuilder.ts` (_mv cache-buster, LAYERS-swap), plus OL official docs (Draw API, ol/sphere, stopClick behavior, Control extension) and Kinetica 7.1 spatial-function reference.

---

> **Scope note:** Every pitfall below is specific to ADDING spatial drawing + Kinetica spatial-WHERE filtering to an app that already has the v1.4 singleclick info popup and the v1.3 materialize pipeline. The v1.3 and v1.4 pitfalls (V13-P-01..V13-P-19, M-01..M-05, S-02, etc.) are NOT repeated here — they are treated as locked and carry-forward. Each pitfall below is tagged with **Severity** and **Phase ownership**.

---

## Critical Pitfalls

### V15-P-01: Draw Interaction and v1.4 Singleclick Handler Fire Simultaneously

**Severity:** Critical
**Phase:** Design (interaction model must be locked before any Draw code is written)

**What goes wrong:**
The v1.4 info-popup singleclick handler is registered in Effect 6 of `MapChartRenderer.tsx` (line 970: `map.on("singleclick", handler as never)`). When a Draw interaction is added to the same map, OL dispatches `singleclick` independently of whether the Draw interaction is active. A user in Bbox-draw mode clicks the map to anchor the first corner — OL fires `singleclick`, which enters Effect 6's handler and begins a spatial-nearest info query fan-out. Simultaneously, the Draw interaction receives the click as its first vertex. Both paths execute concurrently: the popup opens on the draw-start click, and the draw proceeds. The result is a phantom popup appearing on every draw-start click.

`stopClick: true` on the Draw constructor is the documented mitigation but has a known reliability gap: GitHub issue #12147 (filed March 2021, version 6.5.0) shows `singleclick` still fires despite `stopClick: true`. The OL event pipeline emits `singleclick` 250ms after the raw click if no `dblclick` arrives — by then, the `pointerdown` that the Draw interaction's `condition` function filtered may have already returned `false`, but the deferred `singleclick` emission is evaluated on a different event path that `stopClick` does not reliably intercept across all OL versions.

**Why it happens:**
OL's interaction pipeline evaluates Draw's `condition` on `pointerdown` only. The `singleclick` event is a synthetic OL event emitted 250ms later — it travels the separate `handleEvent` path on the Map, not through the Draw interaction's condition gate. `stopClick: true` is supposed to suppress this synthetic event, but the suppression is version-dependent and unreliable (confirmed broken in OL 6.5.0; the issue thread shows the behavior is intermittent across later versions too).

**How to avoid:**
The canonical mitigation is NOT to rely on `stopClick: true` alone. Use a **mode-aware guard** at the TOP of Effect 6's singleclick handler:

```typescript
// At the top of the Effect 6 singleclick handler (before any eligibleLayers check):
const currentMode = useSpatialFilterStore.getState().drawMode;
if (currentMode !== 'pan' && currentMode !== 'info') {
  // Drawing mode active — swallow this singleclick entirely.
  return;
}
```

The `drawMode` Zustand primitive (e.g. `'pan' | 'info' | 'bbox' | 'lasso' | 'circle'`) is the source of truth. When a draw mode is active, the singleclick guard short-circuits before any `infoQuery` call. This is the "check a flag" approach the OL issue author mentioned — but using a Zustand primitive (PITFALL S-02 lock) rather than inspecting OL interaction state.

**Do NOT** unregister the singleclick listener on every mode switch (Effect 6 re-fires on every `eligibleLayers` change — unregistering/re-registering under mode changes adds a second dep that causes Effect 6 to rebuild during draw, which is wasteful and races the mount/unmount cleanup gate from GAP-24-02-A). Instead: keep the single listener, add the mode guard inside it.

**Warning signs:**
- Info popup appears briefly when the user clicks to start a bbox/lasso/circle draw, then immediately dismisses when the next Draw vertex click arrives
- After draw mode is exited, clicking on the map does not open the info popup (guard left in wrong state)
- Rapid mode switches leave the handler in the prior mode's state (Zustand selector is stale closure — use `getState()`, not a closed-over value)

**Precedent:** Effect 6, `MapChartRenderer.tsx` line 829: handler already reads `eligibleLayers` via closed-over value — the mode guard must use `useSpatialFilterStore.getState().drawMode` (imperative read, always current) not a closed-over selector.

---

### V15-P-02: Stale Cursor After Mode Switch Error or Unmount

**Severity:** High
**Phase:** Design / Implementation

**What goes wrong:**
OL does not manage `map.getViewport().style.cursor` automatically on Draw interaction registration. Production apps set `cursor = 'crosshair'` when entering a draw mode and reset it to `''` (or `'default'`) on exit. The trap: if a draw interaction throws (e.g., degenerate shape — see V15-P-16), or if the React component unmounts mid-draw (dashboard switch), the cleanup path that resets the cursor may not execute. After recovery, the map viewport retains `cursor: crosshair` permanently. Users cannot tell they are no longer in draw mode.

A secondary trap: if cursor management lives in the React state setter path (`setState("crosshair")`), StrictMode's double-invoke of useEffect cleanup (the GAP-24-06-A pattern) can reset the cursor to `''` on the second mount's cleanup, even though the user has already selected a draw mode.

**Why it happens:**
Cursor state is imperative DOM manipulation outside React's declarative model. Unlike React-managed state, it is not reset on re-render. The `map.getViewport().style.cursor` is a raw DOM property; React has no knowledge of it unless you explicitly reset it in every cleanup path.

**How to avoid:**
Cursor management must live in a single `useEffect` that depends on `drawMode`:

```typescript
useEffect(() => {
  const viewport = mapRef.current?.getViewport();
  if (!viewport) return;
  const cursorMap: Record<string, string> = {
    pan: '',
    info: 'crosshair',   // info mode — pointer intent
    bbox: 'crosshair',
    lasso: 'crosshair',
    circle: 'crosshair',
  };
  viewport.style.cursor = cursorMap[drawMode] ?? '';
  return () => {
    // Always reset on unmount or mode change — never leave stale cursor.
    viewport.style.cursor = '';
  };
}, [drawMode]);
```

The return cleanup fires on both mode change AND component unmount, so the stale-cursor path is eliminated. The `mapRef.current?.` guard mirrors the M-01 lock from Effect 1 — `mapRef.current` is null until Effect 1 runs.

**Warning signs:**
- Crosshair cursor persists after a dashboard switch (Effect cleanup didn't fire or mapRef was null in cleanup)
- Cursor remains `''` (no crosshair) even in draw mode (the `drawMode` dep is an object or array reference, violating PITFALL S-02 — use a primitive string selector)

---

### V15-P-03: Freehand Polygon Vertex Explosion → WHERE Clause Size Bomb

**Severity:** Critical
**Phase:** Implementation (drawend handler)

**What goes wrong:**
OL's freehand mode (`freehand: true` on the Draw interaction, or `freehandCondition` satisfied) records a vertex for every `pointermove` event while the mouse button is held. On a 1920px-wide map at 60fps, a 3-second freehand drag yields approximately 180 pointermove events. Each vertex becomes a coordinate pair in the WKT polygon string: `POLYGON((lon0 lat0, lon1 lat1, ..., lonN latN, lon0 lat0))`. With 200 vertices and ~20 characters per coordinate pair, the WKT string is ~4,000 characters. That string feeds `whereClause.ts` as a SQL literal inside `ST_WITHIN(x, y, ST_GEOMFROMTEXT('POLYGON((...))'))` or equivalent — the total WHERE clause can reach 4,500+ characters.

While Kinetica's SQL endpoint has no documented hard character limit on queries, every drawn shape adds another ~4,000-character term to the OR chain (V15-P-07). With 5 shapes, the materialize DDL body alone is ~22,000 characters, plus the `CREATE OR REPLACE MATERIALIZED VIEW ... AS SELECT * FROM ... WHERE (...)` wrapper. More critically, the DDL becomes a `dashboard_layers` config concern: the spatial filter targets are stored in SQLite as JSON, but the WHERE clause itself is built fresh on each materialize call — there is no storage size issue for individual shapes, but the runtime SQL payload matters.

**Why it happens:**
OL freehand mode is intentionally designed for smooth free-form input. It does not throttle or simplify vertices in real time — it records every pointermove. Developers commonly forget to apply simplification at `drawend`.

**How to avoid:**
In the Draw interaction's `drawend` event handler, apply Douglas-Peucker simplification before storing the geometry:

```typescript
draw.on('drawend', (event) => {
  const geom = event.feature.getGeometry() as Polygon;
  // OL Polygon.simplify() uses the current view resolution as tolerance.
  // Multiply by 2 to be more aggressive — still visually accurate at the drawn zoom level.
  const simplified = geom.simplify(mapRef.current!.getView().getResolution()! * 2);
  // Hard vertex cap: reject draws with >150 vertices even after simplification.
  const coords = (simplified as Polygon).getCoordinates()[0];
  if (coords.length > 150) {
    useToastStore.getState().showToast(
      'Shape too complex — draw a simpler lasso (max 150 vertices)',
      'warning'
    );
    // Remove the feature that was added to the vector source automatically on drawend.
    vectorSource.removeFeature(event.feature);
    return;
  }
  event.feature.setGeometry(simplified);
  // Proceed to store the shape in useSpatialFilterStore.
});
```

Also quantize coordinates to 5 decimal places (~1m precision) before SQL interpolation:
```typescript
const roundTo5 = (n: number) => Math.round(n * 1e5) / 1e5;
```
This reduces per-vertex character count from ~20 to ~14 characters without any perceptible geographic accuracy loss.

**Warning signs:**
- Materialize POST response time spikes from ~200ms to >2s after freehand draws
- Server logs show SQL strings >10,000 characters
- Kinetica returns a `kineticaUpstreamError` with a body mentioning query length or parse timeout

---

### V15-P-04: Mercator Distortion for Circle Radius at High Latitudes

**Severity:** Critical
**Phase:** Implementation (circle SQL builder)

**What goes wrong:**
When a user draws a circle on a Web Mercator (EPSG:3857) map, OL's `ol/geom/Circle` stores the radius in EPSG:3857 units (meters-on-the-projected-plane, NOT meters-on-the-ground). At 60°N, Web Mercator inflates North-South distances by a factor of `1/cos(60°) = 2`. A circle with a 3857 radius of 5,000 (meters-projected) covers only ~2,500 ground-meters North-South, while covering 5,000 ground-meters East-West. If the SQL uses the raw 3857 radius in `STXY_DWITHIN(x, y, geom, radius)` or `GEODIST(lon, lat, clickLon, clickLat) <= radius`, the circle filter selects a different (latitude-dependent) area than what the user drew on screen.

The companion mistake: using naive `(x - x0)^2 + (y - y0)^2 < r^2` in EPSG:3857 coordinates in a SQL WHERE clause — this is planar distance, not ground distance, and is wrong for any Kinetica spatial operation that expects WGS84.

**Why it happens:**
OL's `Circle.getRadius()` in EPSG:3857 looks like "meters" — the EPSG:3857 unit IS meters. But these are projected-plane meters, not geodetic meters-on-the-ground. The distinction is easy to miss when all the numbers look plausible. The v1.4 `pxToGroundDistance` pattern in `radiusConversion.ts` (111_320 * cos(lat)) uses a similar correction — v1.5 must use the same correction for drawn shapes.

**How to avoid:**
At `drawend`, transform the OL circle's center from EPSG:3857 to EPSG:4326 using `ol/proj.transform` (mirroring the v1.4 EPSG:3857→4326 transform at `MapChartRenderer.tsx` line 846), then compute the ground radius using `ol/sphere.getDistance`:

```typescript
import { transform } from 'ol/proj';
import { getDistance } from 'ol/sphere';

// At drawend for a circle geometry:
const olCircle = event.feature.getGeometry() as OlCircle; // ol/geom/Circle
const center3857 = olCircle.getCenter() as [number, number];
const edge3857 = [center3857[0] + olCircle.getRadius(), center3857[1]] as [number, number];

const centerWgs84 = transform(center3857, 'EPSG:3857', 'EPSG:4326') as [number, number];
const edgeWgs84 = transform(edge3857, 'EPSG:3857', 'EPSG:4326') as [number, number];

// getDistance returns geodetic meters — use this for the SQL predicate, NOT the 3857 radius.
const radiusGroundMeters = getDistance(centerWgs84, edgeWgs84);
```

The SQL predicate then uses `GEODIST(lonCol, latCol, centerLon, centerLat) <= radiusGroundMeters` for lat/lon-mode layers, or `STXY_DWITHIN(wktCol, centerLon, centerLat, radiusGroundMeters)` for WKT-mode layers (if STXY_DWITHIN accepts meters — see V15-P-05 for the WKT-mode gotcha).

**Precedent:** `radiusConversion.ts` `pxToGroundDistance` (Phase 18): `111_320 * cos(clickLat * Math.PI / 180) * pxPerDegree`. The v1.5 `getDistance` approach is more accurate than the flat-earth approximation used in v1.4 and should be preferred for drawn shapes.

**Warning signs:**
- At equator, circle filter selects the expected area; at 60°N the same visual circle selects a much smaller area
- SQL predicate uses raw `olCircle.getRadius()` without CRS transform
- Measurement label shows "5km" but SQL filter rejects many points that fall visually inside the drawn circle

---

### V15-P-05: Circle on WKT/GEOMETRY Columns — STXY_DWITHIN vs ST_DISTANCE Semantics

**Severity:** High
**Phase:** Implementation (spatial WHERE builder)

**What goes wrong:**
For lat/lon-mode layers, `GEODIST(lonCol, latCol, centerLon, centerLat) <= radiusGroundMeters` is straightforward — GEODIST returns meters. For WKT-mode layers, the v1.4 precedent in `spatialQuery.ts` uses `STXY_DISTANCE(wktCol, clickLon, clickLat)` which returns SRS-units of the geometry's storage CRS (typically degrees for EPSG:4326). If the v1.5 circle SQL builder uses `STXY_DWITHIN(wktCol, centerLon, centerLat, radiusGroundMeters)` but `STXY_DWITHIN` interprets the distance parameter in degrees (per the WKT column's SRS), not meters, then the `radiusGroundMeters` value (e.g., 5000 for 5km) will be treated as 5000 degrees — matching every point on Earth.

According to Kinetica 7.1 docs: `STXY_DWITHIN(x, y, geom, distance)` — the `distance` parameter is in the SAME units as the geometry column's SRS. For WKT columns in EPSG:4326, that is degrees, not meters. `GEODIST` is the only Kinetica function that guarantees meter output.

For GEOMETRY (native Kinetica GEOMETRY column / wkb-mode), `ST_DISTANCE(geomCol, ST_GEOMFROMTEXT('POINT(lon lat)'))` returns SRS-units (degrees for EPSG:4326 columns), matching the v1.4 `buildWkbQuery` pattern.

**Why it happens:**
The naming `STXY_DWITHIN` looks like a "distance within" predicate in meters, but "distance" is SRS-unit-dependent. The v1.4 spatialQuery.ts comment explicitly flags this: "radiusGroundDistance MUST be in those same units" — but this is easy to miss when building the new circle-specific SQL branch.

**How to avoid:**
Use mode-specific builders for the circle SQL predicate, matching the v1.4 builder pattern:

- **latlon mode**: `GEODIST(lonCol, latCol, centerLon, centerLat) <= radiusGroundMeters` — GEODIST always returns meters.
- **wkt mode**: Convert `radiusGroundMeters` to degrees using `pxToGroundDegrees` equivalent (degrees ≈ meters / 111_320 / cos(lat)), then: `STXY_DISTANCE(wktCol, centerLon, centerLat) <= radiusDegrees`. Mirror the v1.4 `buildWktQuery` pattern exactly.
- **wkb/geometry mode**: `ST_DISTANCE(wkbCol, ST_GEOMFROMTEXT('POINT(centerLon centerLat)')) <= radiusDegrees`. Mirror `buildWkbQuery` pattern.

The same radius-unit conversion utilities from `radiusConversion.ts` (Phase 18) should be reused. A new `metersToDegreesAtLat(meters, lat)` helper avoids duplication.

**Warning signs:**
- Circle filter selects all rows (radius treated as 5000 degrees) or no rows (radius treated as 0.00001 degrees)
- GEODIST-based filter works correctly but STXY_DISTANCE-based filter selects a wildly different record count for the same drawn circle
- Unit mismatch only visible at runtime against live Kinetica — no compile-time or test-time signal

---

### V15-P-06: CRS Transform Direction Inversion — EPSG:3857 Sent to Server as if WGS84

**Severity:** Critical
**Phase:** Implementation (any coordinate extraction from OL)

**What goes wrong:**
Every OL geometry returned from Draw interactions is in the map's native projection: EPSG:3857 (Web Mercator, locked per PITFALL M-03). Kinetica spatial predicates expect WGS84 coordinates (longitude, latitude in degrees). The transform must be `EPSG:3857 → EPSG:4326`. The common mistake is calling `transform(coord, 'EPSG:4326', 'EPSG:3857')` (inverted direction), sending Mercator meter values to Kinetica as if they were degrees. A point at [0°N, 0°E] in EPSG:3857 is [0, 0] — same as WGS84, so the equator never catches this bug. At [40°N, -74°W] (New York), EPSG:3857 is approximately [-8,236,000, 4,971,000] meters. Sending these values as WGS84 latitude/longitude to `GEODIST(-8236000, 4971000, ...)` produces nonsense distances.

**Why it happens:**
`ol/proj.transform(coord, fromProjection, toProjection)` is easy to call with the arguments transposed. The v1.4 precedent at `MapChartRenderer.tsx` line 846 correctly transforms `'EPSG:3857'` to `'EPSG:4326'` — but each new coordinate extraction site in v1.5 (bbox corners, polygon vertices, circle center) is a new call site that can independently invert the direction.

**How to avoid:**
Define a typed helper at the boundary — any code path that extracts coordinates from OL geometry must use this function and only this function:

```typescript
// In a new file: src/lib/spatialTransform.ts
import { transform } from 'ol/proj';

/** Convert a single OL EPSG:3857 coordinate to WGS84 [lon, lat]. */
export function olCoordToWgs84(coord: [number, number]): [number, number] {
  return transform(coord, 'EPSG:3857', 'EPSG:4326') as [number, number];
}

/** Convert an array of OL EPSG:3857 ring vertices to WGS84 [lon, lat][] pairs. */
export function olRingToWgs84(ring: number[][]): [number, number][] {
  return ring.map(([x, y]) => olCoordToWgs84([x, y]));
}
```

The function signature makes the direction explicit (`olCoordToWgs84` — from OL, to WGS84). Callers cannot pass WGS84 coordinates because there is no `[lon, lat]` → WGS84 helper (that would be a no-op). Apply at every `drawend` site: bbox corners, polygon rings, circle center. The v1.4 precedent in Effect 6 (`MapChartRenderer.tsx` line 846-850) is the canonical reference for `transform` + `transformExtent` direction.

**Warning signs:**
- Circle/bbox/lasso filter returns all rows or no rows regardless of where it is drawn
- Coordinates logged from `drawend` appear in the millions (Mercator units), not in the ±180/±90 range
- Works at [0, 0] on the map but breaks everywhere else (equator/prime-meridian coincidence)

---

### V15-P-07: Multi-Shape OR Clause Without Grouping Parens — Wrong Operator Precedence

**Severity:** Critical
**Phase:** Implementation (WHERE clause builder)

**What goes wrong:**
The v1.5 WHERE clause combines N spatial shape predicates with column filters:

```sql
-- CORRECT:
WHERE (shape_pred_1 OR shape_pred_2 OR shape_pred_3) AND col_filter_1 AND col_filter_2

-- WRONG — what happens if OR-group parens are omitted:
WHERE shape_pred_1 OR shape_pred_2 OR shape_pred_3 AND col_filter_1 AND col_filter_2
-- SQL AND binds tighter than OR, so this evaluates as:
-- shape_pred_1 OR shape_pred_2 OR (shape_pred_3 AND col_filter_1 AND col_filter_2)
-- = every row matching shape_1 OR shape_2 (completely unfiltered by column filters!)
```

With one shape this is invisible — `(shape_pred_1) AND col_filter_1` is the same without parens. The bug only manifests with 2+ shapes. Users draw a second bbox and notice the column filter is gone — they see more records than expected.

**Why it happens:**
`whereClause.ts`'s `buildServerWhereClause` uses `.join(" AND ")` — a correct AND chain for column filters. The new spatial-OR chain is a separate composer. If the two composers are concatenated with `AND` without wrapping the spatial OR-group in parens, operator precedence produces the wrong result.

**How to avoid:**
Extend `whereClause.ts` with a new composer function that handles the spatial-OR + column-AND combination:

```typescript
// In whereClause.ts (server), mirroring the module's existing pure-function style:
export function buildSpatialWhereClause(
  spatialPredicates: string[], // each is a self-contained predicate string
  columnFilters: ActiveFilter[],
): string {
  const parts: string[] = [];

  if (spatialPredicates.length > 0) {
    // CRITICAL: always wrap the OR group in parens, even for a single shape.
    // This makes the behavior correct and consistent regardless of count.
    const spatialGroup = `(${spatialPredicates.join(' OR ')})`;
    parts.push(spatialGroup);
  }

  if (columnFilters.length > 0) {
    // buildServerWhereClause already AND-joins column filters.
    parts.push(buildServerWhereClause(columnFilters));
  }

  return parts.length > 0 ? parts.join(' AND ') : '1=1';
}
```

A unit test with 2 spatial predicates + 1 column filter that asserts the output matches `(s1 OR s2) AND col` (NOT `s1 OR s2 AND col`) must be part of the phase's test surface.

**Warning signs:**
- Adding a second shape removes the column filter effect (all rows from both shapes return, ignoring the column filter)
- Single-shape behavior is correct, two-shape behavior is wrong — the bug is count-dependent
- SQL logged to the server shows no parens around the OR group

---

### V15-P-08: Materialize Race with Multi-Table Fan-Out — N Concurrent Materialize Calls Per Shape Change

**Severity:** High
**Phase:** Implementation (shape-change → materialize coordination)

**What goes wrong:**
The v1.3 `materializeAbortRef` pattern (one ref per `AggregatedWidgetRenderer` instance, one per table) handles the case where a second materialize call for the same table pre-empts the first. In v1.5, one shape change affects ALL spatial-filter targets (every `(targetTable, spatialColumn, spatialMode)` in the per-map widget config). If a map widget has 3 target tables, a shape draw triggers 3 concurrent materialize calls. Each has its own `materializeAbortRef`, so each table's call chain is independently correct. The race risk is: a subsequent rapid shape draw fires a second wave of 3 materialize calls while the first wave is still in flight. The `materializeAbortRef` for each table aborts the prior call for that table correctly — so no data correctness issue.

The real risk is a different one: if the shape-change event batches all 3 materialize calls into a single React state update that triggers 3 separate `AggregatedWidgetRenderer` effects simultaneously, the server receives 3 parallel `POST /api/filter/materialize` calls at the same time for 3 different tables. Kinetica executes 3 parallel `CREATE OR REPLACE MATERIALIZED VIEW` DDL statements. This is correct but generates a server-side DDL concurrency burst. With 5 target tables and rapid shape draws, this can become 10+ concurrent DDL statements.

**Why it happens:**
The v1.3 coordinator pattern (one `AggregatedWidgetRenderer` is the sole materialize trigger per table) naturally serializes materialize calls per table but allows cross-table parallelism. In v1.5, adding a spatial predicate to the WHERE clause means EVERY table's view needs to be recreated on each shape change. The existing V13-P-15 coordinator still prevents per-widget redundancy within a table, but cross-table fan-out is inherently parallel.

**How to avoid:**
Accept cross-table parallelism as correct behavior (each view is independent). The mitigation is at the UX layer: add a 300ms debounce to the shape-change → materialize trigger, matching the existing `AggregatedWidgetRenderer` debounce pattern (Phase 15 LIFE-V13-04). User draws shape → debounce fires once → N materialize calls in parallel for N target tables.

Also confirm that `materializeAbortRef` per-table abort chain handles the shape-add→shape-remove→shape-add rapid sequence correctly. Pattern from V13-P-02: the `materializeAbortRef.current?.abort()` before assigning a new controller is the safeguard. One ref per table, re-used for all shape/column filter combinations for that table.

**Warning signs:**
- Server logs show 5+ parallel `POST /api/filter/materialize` arriving at the same millisecond after a shape draw
- One table's view updates but another's does not (one of the parallel DDL calls was aborted by a rapid second shape draw)
- Kinetica DDL concurrency error (if the DB has a concurrency limit on materialized view creation)

---

### V15-P-09: Cross-Map Vector Overlay Re-Render Thrash — 5 Maps Re-Render Per Drag Step

**Severity:** High
**Phase:** Implementation (Zustand store shape)

**What goes wrong:**
All map widgets on a dashboard subscribe to `useSpatialFilterStore` for shape rendering. If the store holds the raw shape geometry objects (OL Feature or GeoJSON) and they are mutated or replaced during a live draw (every `pointermove` during freehand), each mutation triggers a re-render in all 5 map widgets simultaneously. At 60fps, this is 300 per-widget re-renders per second. Each re-render iterates the shapes array to rebuild the Vector overlay. With 5 maps, that is 1,500 re-renders/second during an active freehand draw.

OL's Vector source itself does not cause this — adding a feature to a VectorSource is an imperative OL call that updates the canvas without React re-renders. The problem is specifically if `useSpatialFilterStore` holds the COMMITTED shapes list AND a live-draw preview shape that updates on every `pointermove`. Both committed and in-progress shapes in the same Zustand slice means every pointer move writes to the store, triggering all store subscribers.

**Why it happens:**
PITFALL S-02 (existing lock): subscribing to the whole store with a non-primitive selector causes excessive re-renders. In v1.5, the shapes array is an object reference — `s.shapes` — which is a new array reference on every mutation. All subscribers see the new reference and re-render even if their rendered subset is unchanged.

**How to avoid:**
Separate the in-progress (live-draw) shape from the committed shapes:

1. **In-progress draw**: managed entirely within OL's own Vector source and Draw interaction. No Zustand writes during `pointermove`. The Draw interaction adds a sketch feature to the VectorSource that OL updates natively on every pointer move — no React re-renders.
2. **Committed shapes** (stored in Zustand): written to the store ONLY on `drawend` with the simplified final geometry. This is one write per completed shape, not one per pointer move.
3. **Zustand selector (PITFALL S-02 lock)**: subscribe to `shapes.length` (primitive) or a comma-joined ID string to detect add/remove without triggering on reference changes:
   ```typescript
   const shapeCount = useSpatialFilterStore(s => s.shapes.length);
   const shapeIds = useSpatialFilterStore(s => s.shapes.map(sh => sh.id).join(','));
   ```
   React re-renders on `shapeCount` change (new shape committed), not on pointermove.

**Warning signs:**
- React DevTools Profiler shows each `MapChartRenderer` re-rendering at 60fps during freehand draw
- All 5 map widgets' re-render flame graphs are synchronized (same Zustand write triggering all)
- Performance drops noticeably on dashboards with 3+ map widgets during draw
- Zustand store write appears in the profiler on every `pointermove` event

---

### V15-P-10: View Name Collision When Spatial Filter Replaces Column Filter Mid-Flight

**Severity:** High
**Phase:** Implementation (materialize trigger)

**What goes wrong:**
The v1.3 view name format `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` is the SAME regardless of whether the WHERE clause contains a column filter, a spatial filter, or both. When a user has a column filter active and draws a shape, the materialize call for the same `(userId, dashId, tableId, sessionShort)` tuple issues `CREATE OR REPLACE MATERIALIZED VIEW` — the `OR REPLACE` atomically replaces the column-filter-only view with the column+spatial-filter view. This is correct behavior.

The race: if a column-filter materialize is in-flight (user clicked a chart) when the shape's drawend fires (user drew a shape ~200ms later), both materialize calls compete. The second (`materializeAbortRef.current?.abort()`) correctly aborts the first. The view that lands is the one from the second call. However, the FIRST call may have already executed on the Kinetica server and written the column-filter-only view by the time the frontend aborts — then the second call executes and overwrites it with column+spatial. Final state is correct, but there is a transient window where the stale column-only view is the active view.

The actual problem is the opposite scenario: column filter + spatial shape in flight, user rapidly removes the shape. The `materializeAbortRef` for the table aborts the combined WHERE call. The next call (shape removed, column filter only) may race the still-executing DDL on Kinetica. Kinetica's `CREATE OR REPLACE` is not transactional at the application layer — if the combined-WHERE DDL finishes AFTER the column-only DDL, the wrong view wins. This is a silent data correctness issue: the user removed the spatial filter but Kinetica still uses the spatial+column view.

**Why it happens:**
Kinetica DDL latency is 100-500ms. The frontend AbortController aborts the HTTP request to the BI server — but if the BI server has already forwarded the DDL to Kinetica and is waiting on Kinetica's response, aborting the HTTP request does NOT abort the Kinetica DDL execution. Kinetica continues executing the DDL; the BI server receives Kinetica's success response after the HTTP client already aborted. The frontend then issues a second DDL for the "correct" state — and if the first DDL was slower (complex WHERE), the second DDL may land first.

**How to avoid:**
The practical mitigation is the 300ms debounce on the materialize trigger. Shape removal is immediate in the store; the debounce absorbs rapid add+remove sequences into a single materialize call that reflects the final state:

```
t0:  User draws shape → shape added to store → debounce 300ms starts
t50: User removes shape → shape removed → debounce RESETS
t350: Debounce fires → materialize with column-only WHERE (correct final state)
```

Without the debounce, t0 fires a materialize, t50 fires another. With debounce, only t350 fires. This eliminates the race in the common case. The debounce is already established in v1.3 (Phase 15, LIFE-V13-04 pattern) — apply the same 300ms value for shape changes.

**Warning signs:**
- Spatial filter appears to remain active after user removes all shapes (stale view content)
- Server logs show two rapid `POST /api/filter/materialize` for the same table within 100ms
- Removing a spatial filter and immediately redrawing produces the column-only filter count from the first draw's view

---

### V15-P-11: Shape Measurement Label Re-Positioning — OL Overlay vs Style.text Trade-Off

**Severity:** Medium
**Phase:** Implementation (draw overlay design)

**What goes wrong:**
Committed shapes need a persistent measurement label (circle radius, bbox W×H, lasso area). Two approaches exist:

**Approach A: `Style.text` on the OL Feature** — attach the label via `new Style({ text: new Text({ text: radiusLabel }) })` on the feature's style. OL auto-positions the label relative to the geometry centroid during every pan/zoom/render cycle. No React involvement. The label moves correctly as the geometry moves in screen space.

**Approach B: `ol/Overlay`** — a DOM element positioned with `overlay.setPosition(centerCoord)`. OL handles the geographic-to-screen transform on pan/zoom. Works for popup-style labels.

The trap with Approach A: OL's `Style.text` renders inside the OL canvas — the text is part of the tile, not a DOM element. The text style options are limited to what OL's Canvas 2D renderer supports (no CSS, no DOM events on the label). The label is also regenerated on every OL renderFrame, which is fine for static labels but requires the label string to be computed at style-time, not at React render time.

The trap with Approach B: `ol/Overlay` positions using `setPosition(coord)` in the geometry's CRS (EPSG:3857 for our map). The position is correct at all zoom levels because OL computes the pixel offset from geographic coordinates. But: each shape needs its own Overlay instance. With N committed shapes, there are N Overlay objects on the map. Each must be cleaned up when the shape is removed (`map.removeOverlay(overlay)` in the shape-removal path). Forgetting to `removeOverlay` on shape deletion leaves ghost labels that persist after their shape is gone.

**Why it happens:**
Developers choose Overlay thinking they can use CSS/HTML for rich label formatting, but forget that each Overlay is an imperative OL object that must be lifecycle-managed. The Pattern from v1.4 Effect 5 (`MapChartRenderer.tsx` line 801-818): one Overlay per popup, added in `useEffect` with cleanup `map.removeOverlay(overlay)`. The same pattern applies per-shape, but shapes are dynamic (added/removed by user) — the cleanup must fire on shape removal, not just on component unmount.

**How to avoid:**
Prefer **Approach A (Style.text)** for measurement labels. It avoids all per-shape lifecycle complexity. The label is embedded in the feature's style function:
```typescript
// When creating/storing a committed shape feature:
const measureLabel = computeMeasureLabel(shape); // e.g., "r: 5.2 km"
feature.setStyle(new Style({
  // ... fill/stroke for the shape ...
  text: new Text({
    text: measureLabel,
    placement: 'point',
    overflow: true,
    font: '12px sans-serif',
    fill: new Fill({ color: '#fff' }),
    stroke: new Stroke({ color: '#333', width: 2 }),
  }),
}));
```
The label auto-repositions on pan/zoom with zero additional code. No `map.addOverlay` / `map.removeOverlay` lifecycle.

Use **Approach B (Overlay)** only if the label needs HTML formatting (e.g., a styled tooltip chip). In that case, mirror the exact cleanup pattern from Effect 5: store the Overlay reference keyed by shapeId, call `map.removeOverlay` in the shape-removal handler before deleting from the store.

**Warning signs:**
- Ghost labels visible on the map after their corresponding shapes are deleted (Overlay not removed)
- Labels stop following the geometry after pan/zoom (Overlay position not updated — use geographic coordinate as position, not screen pixel)
- Labels disappear at certain zoom levels (Style.text `overflow: false` default clips text when geometry is too small for the label)

---

### V15-P-12: "Clear All Spatial Filters" Scope Ambiguity — Map-Local vs Dashboard-Wide

**Severity:** Medium
**Phase:** Design (before any UX is built)

**What goes wrong:**
Shapes are dashboard-scoped (the locked decision: cross-map shape visibility, shapes affect all target tables across the dashboard). The per-map toolbar has a "Clear all spatial filters" button. A user on a 3-map dashboard presses this button on Map A. Expectation ambiguity: does "Clear all" mean (a) remove all shapes on the entire dashboard, or (b) remove only shapes whose target list includes Map A's tables?

If (a): pressing the button on Map A removes shapes that Map B has configured as spatial targets but Map A has not. The user on Map B experiences an unexpected filter change.

If (b): two users pressing "Clear all" on Map A and Map B independently may each only partially clear the dashboard's shapes (each map removes different subsets). No single action clears all shapes.

The UX mistake is labeling the button "Clear all spatial filters" when it has either (a) dashboard-wide behavior (surprising from a per-map toolbar) or (b) per-map behavior (not "all" — misleading label).

**Why it happens:**
Dashboard-scoped shapes feel natural to implement as a single `useSpatialFilterStore.clearAll()` action — simple, one call. But the button lives on a per-map toolbar, creating a false mental model that "Clear all" is map-local.

**How to avoid:**
Lock the semantics during design, before implementation, and encode the decision in the button label:
- If the intent is dashboard-wide clear: label the button "Clear all shapes" (not "spatial filters on this map"). Position it in the FilterBar alongside column-filter chip management (not on the per-map toolbar).
- If the intent is per-map clear: the button should clear only shapes that list THIS MAP's tables as targets. Label it "Clear shapes (this map)". Shapes that other maps use but this map does not remain untouched.

The safer choice, given cross-map shape visibility is a locked feature, is to put "Clear all shapes" in the FilterBar (dashboard-level UI) and NOT put a "Clear" button on the per-map toolbar at all. The per-map toolbar should have mode buttons only (Pan / Info / Draw-bbox / Draw-lasso / Draw-circle), not a destructive clear action.

**Warning signs:**
- User on Map A presses "Clear" and Map B's ongoing analysis is disrupted (shapes removed that were serving Map B)
- Operator reports "the clear button didn't remove all my shapes" (button only cleared the map-local subset)
- Label says "Clear all" but behavior is "clear this map's shapes"

---

### V15-P-13: Degenerate Shape at drawend — Zero-Area Bbox, Single-Point Polygon

**Severity:** Medium
**Phase:** Implementation (drawend handler)

**What goes wrong:**
A user attempting a bbox draw clicks without dragging (mousedown + immediate mouseup at the same pixel). OL's `createBox()` geometry function produces a degenerate rectangle with `minX === maxX` and `minY === maxY` — a zero-area shape. The resulting SQL WHERE:

```sql
STXY_WITHIN(x, y, ST_GEOMFROMTEXT('POLYGON((lon lat, lon lat, lon lat, lon lat, lon lat))'))
```

is a point polygon — Kinetica will return no rows (a zero-area region contains no points, by the strict topological definition). More problematically, some Kinetica implementations reject degenerate polygons in `ST_GEOMFROMTEXT` with a parse error. `STXY_ENVELOPE_INTERSECTS(x, y, lon, lat, lon, lat)` (bbox form) with equal min/max coordinates similarly matches nothing or errors.

For lasso mode, OL may produce a polygon with only 2 distinct points if the user clicks and immediately releases — a degenerate line-polygon.

**Why it happens:**
OL fires `drawend` for every completed draw, including zero-size shapes. There is no built-in minimum-size threshold. Developers forget to validate the geometry before storing it as a committed shape.

**How to avoid:**
At `drawend`, validate geometry before committing to the store:

```typescript
draw.on('drawend', (event) => {
  const geom = event.feature.getGeometry();

  // Minimum bbox check: extent must have non-zero area in EPSG:3857.
  const extent = geom.getExtent();
  const extentArea = (extent[2] - extent[0]) * (extent[3] - extent[1]);
  if (extentArea < 100) { // 100 sq-meters in 3857 (effectively a click with no drag)
    useToastStore.getState().showToast('Shape too small — drag to define an area', 'info');
    vectorSource.removeFeature(event.feature); // remove the OL feature added by drawend
    return; // do not commit to store; do not trigger materialize
  }

  // For lasso: minimum vertex count (after simplification) is 4 (triangle + closing vertex).
  if (geom.getType() === 'Polygon') {
    const coords = (geom as Polygon).getCoordinates()[0];
    if (coords.length < 4) {
      useToastStore.getState().showToast('Draw a closed shape to apply a spatial filter', 'info');
      vectorSource.removeFeature(event.feature);
      return;
    }
  }

  // Passed validation — commit to useSpatialFilterStore.
});
```

**Warning signs:**
- Spatial filter appears to activate (store updated, materialize called) but zero rows are returned from all tables
- Kinetica returns a `kineticaUpstreamError` body mentioning "invalid geometry" or "degenerate polygon"
- FilterBar shows a spatial shape chip for a zero-area shape with "0 records" on every table

---

### V15-P-14: Kinetica Predicate Availability — STXY_WITHIN vs STXY_INTERSECTS for Point vs Polygon Data

**Severity:** High
**Phase:** Design — requires a spike before committing predicate names

**What goes wrong:**
v1.5's spatial filters apply to rows in a Kinetica table, where each row is either a point (lat/lon or WKT point) or a polygon/line geometry. For point data, the filter is "is this point inside the drawn shape?" — correct predicate: `STXY_WITHIN(x, y, shape_geom)` (x/y-mode) or `ST_WITHIN(row_geom, shape_geom)` (geometry column mode). For polygon/line data, the filter is "does this geometry intersect the drawn shape?" — correct predicate: `ST_INTERSECTS(row_geom, shape_geom)`.

The v1.5 WHERE builder must know whether the layer's data is point-type or polygon/line-type to choose the correct predicate. Using `STXY_WITHIN` on a polygon-geometry column table will only match rows whose geometry centroid is inside the drawn shape — rows that partially intersect the drawn shape are excluded. Using `ST_INTERSECTS` on a point table works correctly but `STXY_INTERSECTS(x, y, shape_geom)` is preferred (faster for x/y columns).

A second risk: Kinetica's `STXY_WITHIN`, `STXY_INTERSECTS`, and `STXY_ENVELOPE_INTERSECTS` are confirmed in Kinetica 7.1 docs (verified via docs.kinetica.com/7.1/location_intelligence/geo_functions/). The v1.3 spike S1-S4 confirmed function availability for the deployed instance, but only for `STXY_DISTANCE`, `GEODIST`, and `ST_DISTANCE`. The v1.5 predicates — `STXY_WITHIN`, `STXY_INTERSECTS`, `ST_WITHIN`, `ST_INTERSECTS`, and `STXY_ENVELOPE_INTERSECTS` — have NOT been spiked against the operator's deployed Kinetica version. The operator's version may differ from 7.1 docs.

**Why it happens:**
Developers assume function names from documentation apply to the deployed instance. The v1.3 pattern of doing a spike BEFORE committing to predicate names is the established precedent — but this predicate surface is wider and involves shapes (polygons) not just distance (scalars).

**How to avoid:**
The v1.5 planning phase must include a **Kinetica predicate availability spike** before any spatial WHERE builder is written. Spike questions:
1. Does the deployed Kinetica accept `STXY_WITHIN(x, y, ST_GEOMFROMTEXT('POLYGON(...)'))` in a WHERE clause?
2. Does `STXY_INTERSECTS(x, y, ST_GEOMFROMTEXT('POLYGON(...)'))` work?
3. Does `STXY_ENVELOPE_INTERSECTS(x, y, minLon, minLat, maxLon, maxLat)` work for bbox mode (potentially faster than a full polygon check)?
4. Does `ST_INTERSECTS(geomCol, ST_GEOMFROMTEXT('POLYGON(...)'))` work for geometry-column mode?
5. Does `ST_GEOMFROMTEXT('POLYGON(...)')` in the WHERE clause accept a polygon with >50 vertices without performance degradation?

The spike runner at Phase 18 commit `d458408` is the precedent. Replicate the spike pattern for each new predicate. Lock predicate names in `spatialQuery.ts` only after spike confirmation.

**Warning signs:**
- Spatial filter materialize call succeeds (Kinetica accepts the DDL) but the view returns wrong row counts
- Kinetica returns `kineticaUpstreamError` with "function not found: stxy_within" in the body
- Predicate works for small shapes but times out on large polygons (function present but unindexed)

---

### V15-P-15: OL Draw Interaction Lifecycle — Forgotten Cleanup on Dashboard Switch

**Severity:** High
**Phase:** Implementation

**What goes wrong:**
Draw interactions are added to the OL map via `map.addInteraction(drawInteraction)`. When the React component unmounts (dashboard switch, GAP-24-02-A pattern), the Draw interaction must be removed via `map.removeInteraction(drawInteraction)`. If the `drawInteraction` ref is not cleaned up:

1. The Draw interaction remains attached to the (now-destroyed) OL map. If the map is disposed but the interaction is not removed first, OL's `dispose()` may or may not clean up the interaction's event listeners — OL's Map.dispose() does NOT explicitly call `removeInteraction` for all registered interactions.
2. If the user switches back to the same dashboard and a new Map is constructed (M-01 pattern: new Map in Effect 1 on re-mount), the old `drawInteractionRef.current` points to an interaction that was registered on the OLD map. Adding it to the NEW map or calling `removeInteraction` on the wrong map reference crashes silently.

**Why it happens:**
The v1.4 Effect 1 cleanup (`MapChartRenderer.tsx` line 544-575) handles `sourceListenerCleanupRef`, `imageLayersRef`, `imageSourcesRef`, and the info-query abort. A new `drawInteractionRef` must be explicitly added to this cleanup list. The template pattern (GAP-24-01-A fix: `for (const cleanup of sourceListenerCleanupRef.values()) cleanup()`) can be extended to include interaction cleanup functions.

**How to avoid:**
Add Draw interaction management alongside the existing `sourceListenerCleanupRef` pattern. When a Draw interaction is created (in a separate Effect keyed on `drawMode`), store a cleanup function:

```typescript
// Effect 7 (new): Draw interaction lifecycle.
// Dep: [drawMode] — interaction swaps on mode change.
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (drawMode === 'pan' || drawMode === 'info') {
    // No Draw interaction needed for non-draw modes.
    return;
  }
  const interaction = buildDrawInteraction(drawMode, vectorSource);
  map.addInteraction(interaction);

  // Cleanup: remove interaction BEFORE map.setTarget(undefined) in Effect 1.
  // This cleanup fires on both mode change AND unmount.
  return () => {
    map.removeInteraction(interaction);
  };
}, [drawMode]);
```

The Effect 1 cleanup already sets `mountedRef.current = false` FIRST, which guards against async OL callbacks. Effect 7's cleanup runs before Effect 1's (React runs effect cleanups in the reverse order they were registered) — so `map.removeInteraction` fires while the map is still alive.

**Warning signs:**
- Dashboard switch while in draw mode leaves a stale crosshair cursor (V15-P-02)
- After returning to a dashboard, the first click in pan mode fires the Draw interaction from the previous session
- `map.removeInteraction` in Effect 7 cleanup throws "interaction not found" (interaction was registered on the prior map, not the current one)

---

### V15-P-16: Lifecycle — Shapes Must Clear on Dashboard Switch (Not Persist)

**Severity:** Medium
**Phase:** Design / Implementation

**What goes wrong:**
The operator locked session-only semantics for drawn shapes (mirrors `useFilterStore` / `useInfoSelectionStore` reset pattern). On dashboard switch, shapes must be cleared from `useSpatialFilterStore`. If the store reset is not added to the canonical lifecycle reset block in `DashboardsPage.tsx`, shapes from Dashboard A appear on Dashboard B when the user switches. More subtly: the V1.3 layer `dashboard_layers` is fetched fresh on dashboard open (the store is dashboard-scoped). If shapes persist in `useSpatialFilterStore` without resetting, the spatial filter WHERE clause references shapes drawn for Dashboard A's table structure, which may not even be valid for Dashboard B's tables.

**Why it happens:**
The canonical 4-store reset block at v1.4 close is:
`filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore`
in both `App.tsx` (UNAUTHORIZED handler) and `DashboardsPage.tsx` (DashboardOpen cleanup).

`useSpatialFilterStore` is a NEW store added in v1.5. It MUST be added as a 5th entry in both reset locations. This is the same category of omission as V13-P-11 (RecordsTableRenderer not subscribed) — new infrastructure, forgotten in lifecycle cleanup.

**How to avoid:**
The phase plan for the `useSpatialFilterStore` slice must explicitly list the reset locations as acceptance criteria:
1. `App.tsx` UNAUTHORIZED handler — add `useSpatialFilterStore.getState().reset()` after `lastInfoClickContextStore.getState().reset()`
2. `DashboardsPage.tsx` DashboardOpen cleanup — add same

Also: widget-removal ("Delete Map A widget") should NOT automatically clear shapes — shapes are dashboard-scoped, not widget-scoped. If another map widget on the same dashboard still targets the same tables, the shapes remain valid. Only dashboard-switch (or logout) clears shapes.

**Warning signs:**
- Shapes drawn on Dashboard A are still visible when returning to Dashboard A from Dashboard B (cross-dashboard leakage)
- FilterBar on Dashboard B shows spatial filter chips from Dashboard A's drawn shapes
- The materialize call on Dashboard B uses shape predicates referencing Dashboard A's table columns

---

### V15-P-17: Per-Map Toolbar Custom Controls — OL Zoom Control Click Capture Conflict

**Severity:** Medium
**Phase:** Implementation (toolbar control design)

**What goes wrong:**
The v1.4 OL map is constructed with `defaultControls({ attribution: false }).extend([new Attribution(...)])` — the OL Zoom control is included in `defaultControls()`. Custom toolbar buttons (Pan, Info, Draw-bbox, Draw-lasso, Draw-circle) must coexist with the Zoom control's DOM. Two conflict surfaces:

1. **z-index overlap**: If custom toolbar buttons are positioned as absolutely-positioned React DOM elements overlapping the OL viewport, they will be above/below the OL canvas. The OL Zoom control uses `z-index: 1` on `.ol-zoom`. Custom React buttons at the map widget level may be at a different stacking context. If the custom buttons are inside the React JSX tree (not inside the OL control DOM), they do not participate in OL's control event-stop mechanism. A click on a toolbar button that visually overlaps the OL canvas may propagate to the OL map if `event.stopPropagation()` is not called.

2. **Zoom control pointer events**: The OL Zoom control buttons listen for `click` events on their own DOM. If a custom control wrapper intercepts `pointerdown` at a parent element, zoom buttons stop responding.

The trap of using `ol/control/Control` extension: OL controls are imperative objects added via `map.addControl(control)` — they exist in OL's DOM, not React's. Managing them from React requires the same lifecycle care as `ol/Overlay` (add in useEffect, remove in cleanup).

**Why it happens:**
The simplest approach (React buttons floating above the map CSS) avoids OL control lifecycle complexity — but sacrifices event isolation. The correct approach (extending `ol/control/Control`) requires imperative DOM management outside React.

**How to avoid:**
Use **React buttons positioned outside the OL viewport div**, not overlaid on top of it. The `widget-map` div wraps both the OL canvas (`containerRef` div / `widget-map-canvas`) and other React UI elements. The toolbar can be a sibling React div above `widget-map-canvas`:

```jsx
<div className="widget-map">
  <div className="widget-map-toolbar">
    {/* Pan, Info, Bbox, Lasso, Circle mode buttons — pure React, no OL involvement */}
    <ModeButton mode="pan" ... />
    <ModeButton mode="bbox" ... />
    {/* etc */}
  </div>
  <div ref={containerRef} className="widget-map-canvas" />
  {/* ... overlays, error states ... */}
</div>
```

The toolbar div is ABOVE the canvas in the DOM, does not overlap it, and receives clicks without any OL event involvement. The OL Zoom control remains inside `widget-map-canvas` (OL renders it there). No z-index conflict. No `stopPropagation` needed.

**Warning signs:**
- OL Zoom In/Out buttons stop responding to clicks when the toolbar is added (event captured by toolbar wrapper)
- Mode button click also triggers a map `singleclick` event (button overlaps OL canvas, click propagates)
- Toolbar buttons disappear behind the OL canvas (z-index stacking context issue)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Rely on `stopClick: true` on Draw to suppress singleclick | No mode-guard code needed | Unreliable across OL versions — singleclick still fires (confirmed issue #12147); info popup opens on draw-start click | Never — use explicit mode-guard in singleclick handler (V15-P-01) |
| Store in-progress draw geometry in Zustand on every `pointermove` | Unified state management | 60fps Zustand writes → 5× map widget re-renders per frame (V15-P-09); visible jank on dashboards with 3+ maps | Never — in-progress draw stays in OL VectorSource only; commit to Zustand at `drawend` |
| Use raw OL circle radius (EPSG:3857 meters) in SQL | No CRS transform needed | Wrong query area at any latitude other than equator (V15-P-04); silent wrong results | Never — always use `getDistance` from `ol/sphere` for ground-distance radius |
| Build spatial WHERE clause with string concatenation (no parens around OR group) | Simpler builder code | OR operator precedence bug with 2+ shapes (V15-P-07); column filter effectively disabled | Never — use `buildSpatialWhereClause` wrapper that always wraps the OR group in parens |
| Skip the Kinetica predicate spike before implementation | Saves 1 phase of planning time | Ship spatial filter code using predicate names that don't exist in operator's Kinetica version; silent wrong results or Kinetica errors (V15-P-14) | Never — the v1.3 and v1.4 precedent is spike before commit |
| Use `ol/Overlay` per shape for measurement labels | Rich HTML label formatting | N overlays = N lifecycle management sites; forgotten `removeOverlay` on shape delete leaves ghost labels (V15-P-11) | Only if HTML formatting is truly required; prefer Style.text |
| No vertex simplification on freehand lasso | No drawend processing needed | 200+ vertex WKT strings bloat the SQL WHERE clause and DDL body; potential Kinetica query size errors (V15-P-03) | Never — always apply `geom.simplify()` at drawend with a hard vertex cap toast |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OL Draw + singleclick | `stopClick: true` on Draw constructor | Guard at top of singleclick handler: `if (drawMode !== 'pan' && drawMode !== 'info') return` (V15-P-01) |
| OL geometry → SQL coordinates | Use `olCircle.getRadius()` directly in SQL as meters | Convert center+edge to WGS84 via `ol/proj.transform`, compute ground radius via `ol/sphere.getDistance` (V15-P-04) |
| OL bbox corners → Kinetica bbox predicate | Extract EPSG:3857 coordinates, send to server | Always call `olCoordToWgs84` (V15-P-06) before any server payload; type-enforce via a dedicated helper module |
| Kinetica `STXY_DWITHIN` radius units | Pass meters, expect Kinetica to interpret as meters | `STXY_DWITHIN` distance is in the geometry column's SRS units (degrees for WGS84 WKT columns). Use `STXY_DISTANCE(col, lon, lat) <= radiusDegrees` matching v1.4 `buildWktQuery` pattern (V15-P-05) |
| `ST_GEOMFROMTEXT('POLYGON(...)')` in WHERE | Interpolate raw Mercator coordinates | Always transform polygon vertices to WGS84 BEFORE building the WKT string; x=longitude, y=latitude in WGS84 |
| `useSpatialFilterStore` lifecycle reset | Forget to add to the 4-store reset block | Add as the 5th store in both `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen paths (V15-P-16, mirrors V13-P-11 pattern) |
| Draw interaction cleanup on unmount | Forget `map.removeInteraction()` in Effect 7 cleanup | Effect 7 cleanup `return () => map.removeInteraction(interaction)` fires before Effect 1's `map.dispose()` (V15-P-15) |
| OL VectorLayer cleanup | Only call `map.removeLayer(vectorLayer)` | Also call `vectorLayer.getSource()?.clear()` + `vectorLayer.getRenderer()?.dispose()` to prevent OL memory leaks (confirmed issue #10437 / #8141) |
| Cursor management | `setState` for cursor in React (loses sync with OL) | Imperative: `map.getViewport().style.cursor = cursorMap[drawMode]` inside a `useEffect` with drawMode dep + reset in cleanup (V15-P-02) |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Zustand write on every `pointermove` during freehand draw | All map widgets re-render at 60fps; visible jank | Keep in-progress geometry in OL VectorSource only; write to Zustand only at `drawend` (V15-P-09) | Day 1 with 2+ map widgets on a dashboard |
| No debounce on shape-change → materialize trigger | Rapid shape interactions (draw→remove→draw) fire 5+ concurrent materialize waves | Apply same 300ms debounce as `AggregatedWidgetRenderer` to shape-change materialize path (V15-P-10) | On any rapid interaction with the draw toolbar |
| Per-shape `ol/Overlay` with no cleanup | Memory usage grows with each shape add/remove cycle | Style.text preferred; if Overlay required, `map.removeOverlay` in shape-removal handler (V15-P-11) | After 20+ shape add/remove cycles |
| Un-simplified freehand polygon in SQL | Server SQL parse time increases with vertex count; Kinetica query response slows | `geom.simplify(resolution * 2)` at `drawend` + 150-vertex hard cap with toast (V15-P-03) | On any freehand draw longer than 2 seconds |
| Re-creating OL Draw interaction on every React re-render | OL internal state resets mid-draw; interaction conflicts accumulate | One Draw interaction per mode, created in a dedicated useEffect with `[drawMode]` dep; never create inside render function | Day 1 — any mid-draw re-render breaks the in-progress geometry |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No feedback when draw mode is active | User doesn't know they are in draw mode; clicks the map to explore info and starts an unintended draw | Cursor crosshair (V15-P-02) + active-state visual on the mode button + toast on first draw-mode entry |
| Degenerate shape accepted silently | Spatial filter applied but returns 0 records; user confused | Validate at `drawend` and show toast "Shape too small — drag to define an area" (V15-P-13) |
| "Clear all spatial filters" clears dashboard-global (not per-map) | User pressing the button on Map A loses filters meant for Map B | Put clear action in FilterBar (dashboard-level) not per-map toolbar; label clearly (V15-P-12) |
| Freehand draw rejected with "too complex" but no explanation | User doesn't know how to avoid the problem | Toast must include vertex count: "Lasso has 212 vertices (max 150) — draw a simpler shape" |
| Measurement label disappears on zoom out | User draws a circle labeled "5.2 km"; at low zoom the label text overflows the geometry and OL clips it | Use `overflow: true` on `Style.text` or use Overlay approach for labels (V15-P-11) |
| Info popup opens on draw-start click | User clicks to start a bbox, popup appears briefly then closes on the second click | V15-P-01 mode-guard in singleclick handler eliminates this |
| Shapes persist after dashboard switch | User navigates to a new dashboard, their spatial filter from the previous dashboard is still active | `useSpatialFilterStore.getState().reset()` in `DashboardsPage.tsx` DashboardOpen cleanup (V15-P-16) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Draw + singleclick conflict**: In draw mode, clicking the map does NOT open the info popup — verify by switching to bbox mode and clicking the map, confirming no popup appears (V15-P-01)
- [ ] **Cursor cleanup**: Switching from bbox mode to pan mode resets the cursor to default — verify by checking `map.getViewport().style.cursor` after mode switch (V15-P-02)
- [ ] **Circle radius at 60°N**: A drawn circle at a high-latitude location selects the correct ground area — verify by comparing record counts from the same drawn-size circle at equator vs 60°N against a table with uniform point density (V15-P-04)
- [ ] **WKT circle radius units**: For a WKT-mode layer, the circle filter selects records matching the drawn radius — verify the SQL uses `STXY_DISTANCE <= radiusDegrees` not `<= radiusMeters` (V15-P-05)
- [ ] **Multi-shape OR parens**: Two shapes + one column filter — the column filter still applies to BOTH shapes' results — verify by checking the SQL WHERE clause in server logs (V15-P-07)
- [ ] **Freehand vertex cap**: Drawing a 5-second freehand lasso shows a toast and does not commit the shape — verify the vertex count is below 150 after simplification or toast fires (V15-P-03)
- [ ] **Dashboard switch resets shapes**: Shapes drawn on Dashboard A do not appear on Dashboard B — verify by drawing a shape, switching dashboards, and confirming FilterBar has no spatial chips (V15-P-16)
- [ ] **Shape removal clears view**: After removing the last shape chip from FilterBar, the materialize view reverts to column-filter-only or raw-table — verify WMS tiles update (V15-P-10)
- [ ] **Degenerate shape rejected**: A click (no drag) in bbox mode shows the "Shape too small" toast and does not add a shape chip — verify no chip appears in FilterBar (V15-P-13)
- [ ] **Draw interaction cleaned up on unmount**: Dashboard switch while in draw mode does not leave a stale Draw interaction on the new dashboard's map — verify by switching dashboards mid-draw and confirming pan mode works correctly on the new dashboard (V15-P-15)
- [ ] **Kinetica predicates spiked**: `STXY_WITHIN` and `STXY_INTERSECTS` return results for a test polygon WHERE clause against the operator's deployed Kinetica — spike required before committing predicate names (V15-P-14)
- [ ] **OL Zoom control still works**: After adding the toolbar, the OL Zoom In/Out buttons respond to clicks — verify on a dashboard with a map widget that has the toolbar enabled (V15-P-17)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| V15-P-01: singleclick fires during draw | LOW | Add `useSpatialFilterStore.getState().drawMode` guard at top of Effect 6 handler; no Effect restructure needed |
| V15-P-03: freehand vertex explosion | LOW | Add `geom.simplify()` call + vertex cap check in `drawend` handler; no store/backend changes |
| V15-P-04: mercator circle distortion | MEDIUM | Replace raw `olCircle.getRadius()` with `getDistance(centerWgs84, edgeWgs84)` from `ol/sphere`; update SQL builder to use `radiusGroundMeters` |
| V15-P-05: circle radius unit mismatch | MEDIUM | Add mode-specific radius converter function mirroring `pxToGroundDegrees` pattern; update SQL builder for WKT/geometry modes |
| V15-P-06: CRS transform direction | LOW | Add typed `olCoordToWgs84` helper; grep for raw `transform(coord, 'EPSG:4326', 'EPSG:3857')` invocations at draw boundary |
| V15-P-07: OR clause missing parens | LOW | Update `buildSpatialWhereClause` to always wrap the OR group; add unit test asserting paren presence with 2+ shapes |
| V15-P-09: Zustand write on pointermove | MEDIUM | Refactor: remove in-progress geometry writes from Zustand; keep in-progress state entirely in OL VectorSource; only write to Zustand at `drawend` |
| V15-P-14: Kinetica predicate unavailable | HIGH | Run spike for each new predicate name; if unavailable, find equivalent Kinetica function (e.g., `ST_WITHIN` vs `STXY_WITHIN`); may require rewriting spatial SQL builders |
| V15-P-15: Draw interaction not cleaned up | LOW | Add `map.removeInteraction(interaction)` to Effect 7 cleanup return; add `mountedRef.current` guard to any Draw interaction async callbacks |
| V15-P-16: Shapes not reset on dashboard switch | LOW | Add `useSpatialFilterStore.getState().reset()` to `DashboardsPage.tsx` DashboardOpen cleanup and `App.tsx` UNAUTHORIZED handler; 5-minute fix |

---

## Pitfall-to-Phase Mapping

| Pitfall ID | Pitfall | Severity | Phase Ownership | Verification |
|------------|---------|----------|-----------------|--------------|
| V15-P-01 | Draw + v1.4 singleclick handler fire simultaneously | Critical | Design — lock mode-guard pattern before Draw code written | Click in draw mode → no popup appears |
| V15-P-02 | Stale cursor after mode switch or unmount | High | Design/Impl — cursor useEffect with drawMode dep + cleanup | Cursor resets on mode switch and dashboard switch |
| V15-P-03 | Freehand polygon vertex explosion → SQL bomb | Critical | Impl — drawend handler validation + simplification | 5-second lasso draw triggers toast or stays below 150 vertices |
| V15-P-04 | Mercator distortion for circle radius at high latitudes | Critical | Impl — circle SQL builder uses `ol/sphere.getDistance` | Circle filter area is consistent at equator and 60°N |
| V15-P-05 | Circle on WKT/geometry columns — radius unit mismatch | High | Impl — spatial WHERE builder per-mode radius unit conversion | WKT-mode circle filter selects correct radius of records |
| V15-P-06 | CRS transform direction inverted | Critical | Impl — typed `olCoordToWgs84` helper used at all drawend sites | Coordinates sent to server are in ±180/±90 range |
| V15-P-07 | Multi-shape OR clause without grouping parens | Critical | Impl — `buildSpatialWhereClause` wrapper with parens | 2 shapes + 1 column filter: column filter still applies to both shapes |
| V15-P-08 | Materialize race with multi-table fan-out | High | Impl — 300ms debounce on shape-change materialize trigger | Rapid draw interactions don't produce Kinetica DDL concurrency burst |
| V15-P-09 | Cross-map Vector overlay re-render thrash | High | Impl — keep in-progress state in OL VectorSource, commit to Zustand at drawend only | No 60fps re-renders of map widgets during freehand draw |
| V15-P-10 | View name collision — spatial replaces column filter mid-flight | High | Impl — debounce absorbs rapid shape add/remove | Shape remove → re-draw within 300ms lands correct WHERE |
| V15-P-11 | Shape measurement label re-positioning | Medium | Impl — prefer Style.text; Overlay requires removeOverlay on shape delete | Labels follow geometry on pan/zoom; no ghost labels after shape removal |
| V15-P-12 | "Clear all spatial" scope ambiguity | Medium | Design — lock semantics before UX is built | Clear action label matches actual behavior scope |
| V15-P-13 | Degenerate shape at drawend | Medium | Impl — geometry validation before store commit | Zero-drag click in bbox mode shows toast, no chip added |
| V15-P-14 | Kinetica predicate availability not spiked | High | Design — spike required before any predicate name is committed to code | `STXY_WITHIN` / `STXY_INTERSECTS` confirmed working on operator's Kinetica |
| V15-P-15 | OL Draw interaction lifecycle — not cleaned up on unmount | High | Impl — Effect 7 cleanup mirrors Effect 1 pattern | Dashboard switch while drawing leaves no stale interaction |
| V15-P-16 | Shapes not reset on dashboard switch | Medium | Impl — `useSpatialFilterStore.reset()` in lifecycle reset block | No shape chips on Dashboard B after switching from Dashboard A |
| V15-P-17 | Per-map toolbar conflicts with OL Zoom control | Medium | Impl — toolbar as sibling div, not OL canvas overlay | OL Zoom In/Out buttons respond after toolbar is added |

---

## Sources

- Codebase analysis: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect 1 cleanup (lines 544-575, mountedRef + sourceListenerCleanupRef); Effect 5 ol/Overlay lifecycle (lines 801-818); Effect 6 singleclick handler (lines 824-975, EPSG:3857→4326 transform at line 846, fan-out abort pattern)
- Codebase analysis: `kinetica_bi/server/src/lib/spatialQuery.ts` — `buildLatLonQuery` (GEODIST meters), `buildWktQuery` (STXY_DISTANCE degrees), `buildWkbQuery` (ST_DISTANCE + ST_GEOMFROMTEXT); radiusGroundDistance unit documentation
- Codebase analysis: `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause` AND-chain pattern; trust boundary documentation; pure-module constraint
- Codebase analysis: `kinetica_bi/src/lib/wmsUrlBuilder.ts` — `_mv` cache-buster pattern (lines 157-159); PITFALL M-02 lock; PITFALL M-03 lock (SRS=EPSG:3857)
- [OpenLayers Draw API — latest](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html) — `stopClick` option (boolean, suppresses singleclick during draw), `freehand` option, `condition` option
- [OL Issue #7525](https://github.com/openlayers/openlayers/issues/7525) — singleclick events fired during Draw interaction; `stopClick` is not a reliable solution; "jump through hoops to look for active draw interactions" workaround
- [OL Issue #12147](https://github.com/openlayers/openlayers/issues/12147) — `stopClick: true` still fires singleclick; confirmed unreliable in OL 6.5.0
- [OpenLayers ol/sphere module — latest](https://openlayers.org/en/latest/apidoc/module-ol_sphere.html) — `getDistance(c1, c2)` returns geodetic meters (WGS84 ellipsoid mean radius); preferred over planar distance for circle radius at high latitudes
- [OL Draw Geodesic Circles Example](https://openlayers.org/en/latest/examples/draw-and-modify-geodesic.html) — canonical pattern for transforming EPSG:3857 circle center+edge to WGS84 and computing ground radius via `getDistance`
- [Kinetica Geospatial/Geometry Functions 7.1](https://docs.kinetica.com/7.1/location_intelligence/geo_functions/) — `STXY_WITHIN(x, y, geom)`, `STXY_DWITHIN(x, y, geom, distance)` (distance in SRS units of geom, NOT meters), `STXY_INTERSECTS(x, y, geom)`, `STXY_ENVINTERSECTS(x, y, geom)`, `GEODIST(lon, lat, lon, lat)` (returns meters), `ST_DISTANCE`, `ST_INTERSECTS`, `ST_WITHIN`
- [OL VectorLayer memory leak issue #10437](https://github.com/openlayers/openlayers/issues/10437) — proper cleanup sequence: `source.clear()` → `renderer.dispose()` → `setSource(null)` → `map.removeLayer`
- `.planning/PROJECT.md` — v1.5 milestone definition; v1.4 locked patterns (mountedRef, sourceListenerCleanupRef, 4-store reset block, PITFALL M-03, Effect 6 singleclick handler structure)
- `.planning/research/_archive_v1.3/PITFALLS.md` — V13-P-01..V13-P-19; V13-P-02 (materializeAbortRef pattern); V13-P-11 (RecordsTableRenderer missed in lifecycle — same category as V15-P-16); V13-P-15 (per-widget materialize coordinator)

---
*Pitfalls research for: v1.5 Spatial filtering on map — adding OL Draw interactions to React + OpenLayers + v1.3 materialize pipeline*
*Researched: 2026-05-11*
