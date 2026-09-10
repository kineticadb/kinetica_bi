# Domain Pitfalls: v1.2 Interactive Dashboards

**Domain:** Adding OpenLayers + WMS map chart, click-driven drill-down, and cross-chart filter coordination to an existing Kinetica BI app
**Researched:** 2026-05-01
**Confidence:** HIGH — grounded in codebase analysis of `kinetica.ts`, `useApiQuery.ts`, Zustand store implementations, and the `__mocks__/zustand.ts` shim, plus established OpenLayers, WMS, and React concurrency patterns

---

> **Scope note:** These pitfalls are specific to *adding* these features to the existing v1.1 system. Each pitfall is anchored to something observable in the current codebase or to a well-established failure mode in the OpenLayers + React + Kinetica WMS integration surface. Generic OpenLayers tutorials are not the target. Where a prior-milestone anti-pattern class could resurface, it is explicitly called out.

---

## Map / OpenLayers / WMS Pitfalls

### M-01: OpenLayers Map Instance Not Disposed on React Unmount — Memory Leak

**What goes wrong:**
An OpenLayers `Map` instance registers event listeners against its target DOM element, holds references to `TileQueue` workers, `ImageTile` objects, and a `RenderExecutorGroup`. In React 18 Strict Mode (which this project uses via Vite's default), every component mounts, unmounts, and remounts once in development to surface exactly this class of bug. If the `useEffect` that creates the map does not call `map.setTarget(undefined)` and `map.dispose()` in its cleanup function, each Strict Mode cycle leaks one full map instance — event listeners, worker references, and tile cache entries included.

In production (single mount), the leak is deferred until the component unmounts (e.g., user navigates away from a dashboard that contains a map widget). If the component remounts (e.g., tab switching, layout re-render), a new map is created on the same container while the old one still holds DOM event listeners — the two maps both respond to pointer events, producing duplicate pan/zoom handlers and doubled tile requests.

**Why it happens:**
Developers create the map in a `useEffect` with the container ref as dependency, but forget or overlook that `useEffect` returns a cleanup function. The map "works" immediately, so the missing cleanup is invisible in a happy-path dev session. Strict Mode surfaces it in development but the doubled-mount behavior only shows as "weird flickering" rather than an explicit error.

**How to avoid:**
```typescript
useEffect(() => {
  if (!containerRef.current || mapRef.current) return;
  const map = new Map({
    target: containerRef.current,
    layers: [...],
    view: new View({ ... }),
  });
  mapRef.current = map;
  return () => {
    map.setTarget(undefined); // detaches DOM listeners
    map.dispose();            // releases tile workers and listener registry
    mapRef.current = null;
  };
}, []); // empty dep array — mount once; cleanup on unmount
```

Use a `mapRef` (`useRef<Map | null>(null)`) as a guard so the Strict Mode double-invocation of the setup half does not create two map instances before cleanup runs.

**Warning signs:**
- Chrome DevTools Memory heap shows `ol/Map` instances accumulating across dashboard navigation
- Browser console shows "Warning: Can't perform a React state update on an unmounted component" originating from inside OpenLayers event dispatchers
- Two simultaneous WMS tile fetches fire for each tile position after a component re-render (visible in Network tab as paired duplicate requests)
- Map visually "jumps" or pans twice per user gesture

**Phase to address:** The phase that introduces the MapChart component. Must be in the component's initial implementation, not as a follow-up. Cleanup pattern is non-negotiable in Strict Mode.

---

### M-02: WMS Tile Cache Not Busted When Per-Table Filter Changes — Stale Tiles

**What goes wrong:**
The browser and OpenLayers both cache WMS tile responses keyed on the tile URL. When the per-table filter changes (e.g., user clicks a bar and adds `region = 'WEST'`), the BI app's `/api/wms` proxy request will carry the new filter parameters — but if the WMS `TileLayer`'s source URL template is not updated (i.e., the URL string passed to `TileWMS` is identical to the previous filter state), OpenLayers serves the old tiles from its in-memory tile cache without making new requests to the server. The map appears to update (React re-renders, filter bar updates), but the visual tile layer still reflects the pre-filter data. Users will see the contradiction: a filter bar showing "region = WEST" but a map still rendering all regions.

This is compounded by the browser's HTTP cache: even if OpenLayers discards its tile cache, the browser may serve the old tile from disk cache if the response did not include `Cache-Control: no-store` and the URL is unchanged.

**Why it happens:**
WMS tile source URLs encode filter parameters as query string values. OpenLayers treats URLs as cache keys. If the developer updates a React state variable that holds filter parameters but does not force the `TileWMS` source to rebuild its URL (or update the source object reference), the cached tiles are served. The filter appears applied everywhere else (charts, filter bar) but not on the map.

**How to avoid:**
Encode the active filter as a deterministic string and include it as a `_v` (version) parameter in the WMS URL — or use OpenLayers' `source.updateParams()` method, which forces cache invalidation and tile re-fetch:

```typescript
// When filter changes:
tileWmsSource.updateParams({
  CQL_FILTER: buildCqlFilter(activeFilters), // or custom param
  _v: filterHash, // deterministic hash of current filter state
});
```

If constructing a new `TileWMS` source object on filter change (simpler), ensure the old source is removed from the layer before the new one is set to avoid a stale tile flash.

The `/api/wms` proxy route should also set `Cache-Control: no-store` on its responses so browser caching does not interfere.

**Warning signs:**
- Map does not visually change after a drill-down click that updates all other charts
- Network tab shows zero new `/api/wms` requests after a filter change while other API calls fire normally
- Refreshing the page shows the correct filtered tile data — confirming it's a cache issue, not a data issue

**Phase to address:** The phase that wires the filter store to the map component. Cannot be deferred — the entire value proposition of the map (interactive filtering) depends on this working.

---

### M-03: EPSG:3857 vs EPSG:4326 Projection Mismatch — Visual Corruption

**What goes wrong:**
OpenLayers defaults to EPSG:3857 (Web Mercator) for its map view. Kinetica's WMS endpoint can serve tiles in either EPSG:4326 (geographic lat/lon) or EPSG:3857 depending on how the WMS request is formed. If the `TileWMS` source specifies `projection: 'EPSG:4326'` but the OpenLayers `View` uses `EPSG:3857` (or vice versa), the tile grid does not align with the basemap. Tiles render but are visually offset or stretched — features appear in the wrong geographic position, often subtly (a few kilometers off), which is worse than an obvious error because it passes visual inspection in low-zoom views but fails in high-zoom detail work.

The reprojection path (serving EPSG:4326 tiles into an EPSG:3857 view) also has a non-trivial CPU cost: OpenLayers reprojects each tile in the browser, which is synchronous and will block the main thread on large tiles or many simultaneous tile loads.

**Why it happens:**
Developers set the basemap tile layer (e.g., OpenStreetMap) to EPSG:3857 (default), then add the Kinetica WMS layer without specifying the same projection. Kinetica's WMS may default to EPSG:4326 in its `GetCapabilities` response depending on version. The mismatch is silent — no error is thrown.

**How to avoid:**
- Lock the OpenLayers `View` to EPSG:3857 explicitly.
- In the WMS request to Kinetica, pass `SRS=EPSG:3857` (WMS 1.1.1) or `CRS=EPSG:3857` (WMS 1.3.0) as a URL parameter. Verify Kinetica supports 3857 tile output.
- If Kinetica only supports EPSG:4326, use a dedicated `Projection` object in OpenLayers configured for 4326 — do not mix projections between layers.
- Verify during integration: add a known-location marker (e.g., a fixed vector feature at the Kinetica server's geographic region) and confirm it aligns with the basemap.

**Warning signs:**
- Features on the WMS layer are horizontally or vertically offset from their expected position on the basemap
- Tiles look correct at zoom 0 but increasingly misaligned at zoom 10+
- Browser DevTools shows reprojection compute spikes during tile load

**Phase to address:** The phase that implements the map component and WMS layer setup. Add a projection-alignment integration test that verifies a known coordinate renders in the correct tile position.

---

### M-04: WKT vs Kinetica WKB Column Type — Wrong WMS Parameter Set

**What goes wrong:**
Kinetica's WMS endpoint requires different parameter names depending on the geometry column type. For lat/lon pair columns, the WMS request uses `X_ATTR` and `Y_ATTR` parameters. For WKT geometry columns (standard text geometry), it uses `GEO_ATTR`. For Kinetica's native WKB (Well-Known Binary) geometry — which is what Kinetica calls "WKB" but is actually their internal binary spatial type stored as a `bytes` column — the column encoding differs and the same `GEO_ATTR` parameter applies but the column name must reference the correct type.

The common mistake: a user selects a geometry column from the column-discovery dropdown. The column appears as a single column (not a lat/lon pair). The developer assumes it is WKT and passes it as `GEO_ATTR`. If the column is Kinetica's internal WKB type, the WMS response returns empty tiles or an error, because Kinetica encodes WKB differently from WKT and cannot interpret the column as GEO_ATTR without knowing it is binary.

**Why it happens:**
The Kinetica column discovery API (`/show/table`) returns a `column_type` field. The type string for WKT is `WKT` and for Kinetica WKB it is `bytes` with a `type_spec` containing `wkb`. These are different types requiring different WMS parameter handling, but both appear as "a geometry column" to the user in the UI.

**How to avoid:**
- During chart config, when the user selects a spatial column, query the column's type metadata from the existing column-discovery endpoint.
- Branch on column type at WMS parameter construction time:
  - `colType === 'lat_lon_pair'`: use `X_ATTR` + `Y_ATTR`
  - `colType === 'wkt'`: use `GEO_ATTR` with the column name
  - `colType === 'wkb'` (Kinetica bytes/wkb): use `GEO_ATTR` — but validate that Kinetica's WMS can render it (it can, if the column is properly a native WKB spatial column)
- Surface the detected column type in the config panel so the user sees "Geometry type: WKT" rather than a silent empty map.

**Warning signs:**
- Map renders a blank tile grid with no features after configuring a geometry column
- Kinetica WMS returns HTTP 200 with an empty (white) PNG
- `/api/wms` proxy logs show a 200 response but map shows nothing

**Phase to address:** The phase that implements the map chart config panel and WMS parameter builder.

---

### M-05: Heatmap `blur` Radius Units — Pixels vs Map Units

**What goes wrong:**
OpenLayers' `Heatmap` layer (for client-side heatmap rendering from vector features) accepts a `blur` property in pixels. Kinetica's WMS `heatmap` render mode accepts a `BLUR_RADIUS` parameter that is in map units (degrees or meters depending on projection). If the developer conflates these and passes a pixel-scale value to the WMS parameter, or vice versa, the heatmap appears either massively oversmeared (all blobs merge into solid color) or with near-invisible point dots (blur is effectively zero).

The heatmap blur in Kinetica's WMS is also zoom-dependent in effect: a `BLUR_RADIUS=10` looks different at zoom 3 vs zoom 12 because it's in map units. The developer may set a value that looks fine at the dev zoom level but is wrong at the zoom levels users will actually use.

**Why it happens:**
Two different rendering paths (OpenLayers client-side `Heatmap` layer vs Kinetica server-side WMS heatmap) use the same English term "blur radius" with different units. The WMS path sends parameters to Kinetica; the client-side path configures the OpenLayers layer. Both are plausible implementations. If the chosen implementation is the WMS path (which it should be for Kinetica data at scale), the units are map-unit-relative and zoom-sensitive.

**How to avoid:**
- For the v1.2 map: use Kinetica WMS for all render modes including heatmap. Do not use OpenLayers client-side `Heatmap` layer (which requires pulling all data to the client, defeating Kinetica's GPU rendering).
- Document in the chart config panel that `BLUR_RADIUS` for WMS heatmap is in Kinetica map units, not pixels. Provide default values tested at representative zoom levels (e.g., zoom 5 → `BLUR_RADIUS=5`, zoom 10 → `BLUR_RADIUS=0.5`).
- Add a note in the config UI: "Blur radius is in map units. Adjust per zoom level."

**Warning signs:**
- Heatmap looks like a solid color blob at all zoom levels (blur too large)
- Heatmap looks like scattered dots with no blending (blur too small or zero)
- Heatmap looks correct in dev session (specific zoom) but users report it looks wrong at their default zoom

**Phase to address:** The phase that implements heatmap render mode configuration.

---

### M-06: Classbreak Categorical Column with High Cardinality — Unrenderable Legend + Slow Render

**What goes wrong:**
Kinetica's WMS `classbreak` render mode assigns a distinct color to each unique value in a categorical column. With a column that has 10,000 unique values (e.g., a user_id, order_id, or hash column), Kinetica must generate a 10,000-entry color scheme in the WMS response. This causes:
1. The WMS tile request takes very long or times out.
2. The tile response is large (embedded color legend data).
3. The frontend legend component attempts to render 10,000 legend entries, freezing the browser.
4. The visual output is meaningless — 10,000 similar colors are indistinguishable.

**Why it happens:**
The config panel lets the user select any column for classbreak grouping. Without a cardinality check, the user selects an id column expecting colors by category, not realizing the column has unique values per row.

**How to avoid:**
- At config-panel time, when the user selects a column for classbreak rendering, query `SELECT COUNT(DISTINCT <column>) FROM <table>` via the existing `kineticaSql` helper.
- If cardinality > threshold (recommend 100 for usability, hard cap at 256 which is Kinetica's classbreak maximum), display a warning: "Column has N unique values. Classbreak works best with fewer than 100 categories. Consider a column with low cardinality."
- Hard-block the WMS request if cardinality > 256 (Kinetica's documented classbreak limit) to prevent a guaranteed error.
- The cardinality check should be async and non-blocking — run it when the column is selected, not on every render.

**Warning signs:**
- WMS tile request takes > 10 seconds for a classbreak layer
- Browser freezes when the legend renders
- Kinetica returns a WMS error response (not a tile) citing too many classbreak values

**Phase to address:** The phase that implements the map chart config panel for classbreak mode.

---

### M-07: WMS Request URL Length Exceeds Limits With Deep Filter Chains

**What goes wrong:**
The current `kineticaWms` helper accepts a `queryString` parameter that is passed directly to the Kinetica WMS endpoint: `${kineticaUrl}/wms?${queryString}`. When per-table filters are applied (drill-down accumulation), each active filter adds parameters to the WMS request. If filters are expressed as CQL_FILTER or as Kinetica-specific WHERE-clause parameters embedded in the URL, a deep filter chain (10+ equality filters) can push the URL past the browser's GET request limit (~2,048 characters for IE/older systems; ~8,192 characters for modern browsers; and whatever limit the Node.js/Express proxy enforces, typically 8,192).

Beyond the technical limit: long URL query strings appear in server access logs (even if not in the audit log, which the code carefully omits). If a filter value happens to include sensitive data (e.g., filtering on a user email column), the entire filter expression appears in the proxy's access log.

**Why it happens:**
Each drill-down click adds one equality filter. The design intentionally accumulates filters. WMS uses GET requests by default. Filter parameters grow linearly with drill-down depth.

**How to avoid:**
- The Kinetica WMS endpoint supports POST requests for large parameter sets. Implement a `kineticaWmsPost` helper variant for filter-heavy requests that sends parameters in the POST body.
- Alternatively: enforce the UX cap from D-04 (max filter count) as the primary mitigation — fewer than 20 filters will not approach URL limits.
- On the proxy route: set `maxUrlLength` on Express's query parser to surface the error explicitly rather than truncating silently.
- If using GET, encode filters as a compact representation before URL-encoding (e.g., a JSON blob instead of repeated key=value pairs).

**Warning signs:**
- WMS tiles stop loading after several drill-down clicks
- Browser Network tab shows the tile request as `(failed)` with a net::ERR_ABORTED
- Express proxy logs a `431 Request Header Fields Too Large` or the URL is visibly truncated

**Phase to address:** The phase that wires active filters to the WMS request builder. Must be addressed before the UX cap in D-04 is defined, because D-04's cap is the primary defense against this.

---

### M-08: WMS Tile Auth With Per-User Bearer Token — Cache Serves Stale Auth State After Token Expiry

**What goes wrong:**
The browser has no native mechanism to re-issue expired bearer tokens on cached responses — browser HTTP caching is not auth-aware. The current `kineticaWms` proxy injects the per-user `Authorization` header server-side (correct v1.1 pattern, PITFALL I-01 locked). However, browsers do cache responses from the proxy endpoint `/api/wms` if the response does not explicitly opt out of caching. If tiles are cached (HTTP 200 with no `Cache-Control: no-store`), the browser serves the cached tile without re-hitting the proxy — meaning the auth check is bypassed for cached tiles.

In OIDC mode, where access tokens expire after 1 hour, a user who has been on a dashboard for 59 minutes will have valid tile cache responses served from before their token expired. At token expiry, new tile requests hit the proxy, get a 401 from Kinetica (token expired), go through the REAUTH chain, and the user is redirected to re-authenticate. But: the cached tiles remain visible in the map. The user sees a partially stale map — some tiles from before expiry, some tiles blank/errored after.

This is a regression risk from v1.1 PITFALL I-07's OIDC token expiry chain: that pitfall addresses the `kineticaSql` path. The `kineticaWms` path needs the same expiry handling.

**Why it happens:**
`kineticaWms` returns a raw `Response` object (correct — it streams the binary tile body). The proxy route pipes this response to the client. If the proxy route does not set explicit cache headers before piping, the browser inherits whatever cache headers Kinetica's WMS sends (which may include `Expires` or `Cache-Control: max-age`).

**How to avoid:**
- In the `/api/wms` Express proxy route that calls `kineticaWms`, always set `res.setHeader('Cache-Control', 'no-store')` before piping the tile response. This prevents the browser from caching auth-protected tile content.
- Per-request tile fetching (no browser cache) is acceptable for this use case because the filter state can change between any two clicks — cached tiles are rarely correct anyway.
- This aligns with M-02's fix (no-store prevents stale filter tiles) — one fix addresses both M-02 and M-08.

**Warning signs:**
- After OIDC token expiry, some map tiles remain visible while new tiles fail to load
- Network tab shows mix of `(from disk cache)` tile responses alongside 401 errors for new requests
- The filter bar and other charts correctly show the REAUTH state, but the map still shows partial data

**Phase to address:** The phase that implements the `/api/wms` proxy route. Apply `Cache-Control: no-store` in the route implementation, not as a follow-up.

---

## Drill-Down + Filter Chain Pitfalls

### D-01: Drill-Down Config Allows Geometry, Blob, and Nullable ID Columns — Silent Empty Result or Crash

**What goes wrong:**
The drill-down mechanism adds an equality filter on a user-configured column: `WHERE <column> = <clicked_value>`. If the configured column is a geometry column (WKT string hundreds of characters long), a large text blob, or a nullable synthetic ID column, the result is one of three failure modes:
1. The SQL filter `WHERE wkt_col = 'POLYGON((...very long string...))` produces zero results because WKT exact-match is unreliable for floating-point coordinates (rendering produces slightly different coordinate strings than storage).
2. The equality filter on a unique ID column (e.g., `order_id = 12345`) returns exactly one row, which propagates to every chart — users see mostly empty charts rather than a meaningful slice.
3. The WMS `CQL_FILTER` with a geometry column value exceeds URL limits immediately (WKT geometry strings are long), hitting M-07 instantly.

**Why it happens:**
The config panel for drill-down will let the user pick any column from the table schema. Without filtering the column list or validating the selection, users will naturally pick the first interesting-looking column.

**How to avoid:**
- At config-panel time: filter the column dropdown for drill-down to exclude `WKT`, `bytes`/WKB, and `TEXT` columns over a length threshold.
- Recommend numeric or low-cardinality string columns for drill-down configuration.
- Add a config-time warning if the selected column is nullable: "Column may contain NULLs. Drill-down on a NULL value will apply IS NULL, not = NULL."
- This is a config-time guard, not a runtime guard — validate when the user selects the column, not when they click.

**Warning signs:**
- All charts show zero data after a drill-down click (too-specific filter)
- A drill-down on a geometry column produces a WMS URL truncation error (M-07 fires immediately)

**Phase to address:** The phase that implements the drill-down config panel for existing chart types.

---

### D-02: Drill-Down Value Contains SQL-Special Characters — SQL Injection Risk in CQL_FILTER

**What goes wrong:**
A clicked bar segment with value `O'Brien` (apostrophe in name) produces a filter like `WHERE name = 'O'Brien'` — a SQL syntax error. A value like `'; DROP TABLE users; --` is a textbook injection vector. The `kineticaSql` helper currently builds SQL statements via string interpolation (the SQL is passed as a string from the route layer). There is no parameterization evidence in `kinetica.ts` (line 160: `body: JSON.stringify({ statement: sql, ... })`), meaning the SQL string is built by the caller. If the drill-down value is interpolated into the SQL string at the route level without escaping, this is an injection vector.

The CQL_FILTER path (for WMS requests) is a separate attack surface: CQL_FILTER is a URL query parameter containing a filter expression. Apostrophes must be doubled (`''`), and user-supplied values must be escaped before being placed in the CQL_FILTER string.

**Why it happens:**
The v1.0 `kineticaSql` helper was designed for server-controlled SQL (the routes build the SQL string themselves, from trusted config). There was no user-supplied data flowing into SQL at v1.0. v1.2 introduces the first path where user-clicked data values flow into SQL statements.

**How to avoid:**
- For `kineticaSql` drill-down queries: use a parameterized query if Kinetica's `/execute/sql` endpoint supports parameter binding (verify in Kinetica docs — it does support `?` placeholders in some API versions). If not available, use a safe escaping function: replace single quotes with `''` and verify no other SQL metacharacters can break the statement structure.
- Create a `escapeKineticaStringLiteral(value: string): string` utility that: doubles single quotes, strips semicolons if not inside quotes, and is unit-tested with adversarial inputs.
- For CQL_FILTER in WMS URLs: use the same escaping function plus URL-encode the result.
- Add a test: drill-down value `"O'Brien"` → assert the SQL and CQL_FILTER are correctly escaped.
- Connection to prior milestone: PITFALL I-01 class — a one-character mistake in the wrong path has outsized consequences. The same discipline applies here.

**Warning signs:**
- Clicking on a bar with an apostrophe-containing label results in a 502 / Kinetica SQL error
- Server logs show a Kinetica SQL parse error (not the audit log — the console.error channel in kineticaSql)

**Phase to address:** The phase that implements the drill-down click handler and builds the equality filter. Must be addressed in the same plan as the filter SQL builder, not deferred.

---

### D-03: Drill-Down on a NULL Value — `column = null` Is Always False in SQL

**What goes wrong:**
In SQL, `WHERE column = NULL` is always false — the correct syntax is `WHERE column IS NULL`. If a chart element represents the NULL bucket (a bar labeled "Unknown" or "(blank)" that groups all null-value rows), and the drill-down click handler builds `WHERE <column> = <value>` where value is `null` or `undefined`, the resulting filter returns zero rows. All charts go blank. The user thinks drill-down is broken.

**Why it happens:**
The drill-down handler receives the clicked value from the chart event. Recharts (the existing charting library) may pass `null` or `undefined` for null-bucket data points. The generic filter builder does not branch on null.

**How to avoid:**
- In the drill-down filter builder: explicitly check if the value is `null` or `undefined`. If so, build `{ column, operator: 'IS NULL', value: null }` as the filter representation, not `{ column, operator: '=', value: null }`.
- When converting the filter to SQL: `operator === 'IS NULL'` → `"${column} IS NULL"`, never `"${column} = NULL"`.
- Add a test case: clicking a null-valued bar produces `IS NULL` in the generated SQL, not `= null`.

**Warning signs:**
- Clicking on a null/blank/unknown bar segment produces zero results in all charts
- The filter bar shows an active filter (looks right) but data is empty

**Phase to address:** The phase that implements the drill-down filter builder (same plan as D-02's escaping function — they share the filter-builder utility).

---

### D-04: Filter Accumulation Grows Unbounded — Query Plan Degrades with 50+ AND Conditions

**What goes wrong:**
The locked v1.2 design: each drill-down click adds one equality filter; filters accumulate; user clears via the filter bar. There is no stated cap on accumulation. A user exploring data by clicking repeatedly can accumulate 50+ equality filters on the same query. Kinetica's query planner handles small AND chains efficiently but degrades non-linearly with large filter sets — especially if the filters reference different columns (no single index covers all of them). The resulting queries become slow, creating a feedback loop where slow queries mean the user waits, clicks again, and adds more filters.

Additionally: the filter bar UI displaying 50 active filters becomes unusable — it scrolls off-screen, becomes a wall of text, and clearing individual filters requires significant scrolling.

**Why it happens:**
No cap was specified in the v1.2 locked scope. The "accumulate and clear via filter bar" design implies unlimited accumulation. This is fine for typical use (3-5 drill-downs) but has no safety valve.

**How to avoid:**
- Enforce a soft cap of 10 active filters per table. When the cap is reached, show a warning: "Maximum filters reached. Clear some filters before drilling down further."
- Alternatively (better UX): implement D-05's same-column replacement — this naturally limits accumulation by preventing duplicate-column filters.
- The filter store (Zustand) should enforce the cap at write time: `if (filters.length >= MAX_FILTERS) return state;` — never silently drop the click.

**Warning signs:**
- Dashboard query response times grow linearly with number of clicks
- Filter bar becomes vertically very tall (scrolling required)
- Users report that "after clicking a lot, the dashboard gets slow"

**Phase to address:** The phase that implements the filter store and drill-down action. Cap is a store invariant enforced at the time of filter addition.

---

### D-05: Same Column Filtered Twice With Different Values — `col = a AND col = b` Is Always Empty

**What goes wrong:**
If a user clicks bar A (adding `region = 'EAST'`) and then clicks bar B (adding `region = 'WEST'`), the accumulated filter becomes `WHERE region = 'EAST' AND region = 'WEST'` — which is a logical contradiction returning zero rows. All charts go blank. The user has no way to understand why; the filter bar shows two active filters that both look valid.

This is a logic error, not a data error, so no error is thrown — all charts return empty results silently.

**Why it happens:**
The filter accumulation design adds every click as a new AND-ed filter without checking if the clicked column already has an active filter. The design is simple (correct for the initial scope) but does not handle the same-column re-click case.

**How to avoid:**
- **Recommended:** When a drill-down click adds a filter for column C, check if column C already has an active equality filter in the current filter set. If so, **replace** the existing filter for that column with the new value, not append. This is unambiguous behavior (last click wins) and eliminates the empty-result bug.
- The replacement should happen in the Zustand filter store action: `addFilter({ column, value })` → if `filters.find(f => f.column === column)` exists, replace it; otherwise append.
- Communicate the replacement in the UI: the filter bar should visually update the existing filter chip rather than adding a second chip for the same column.
- Add a test: add `region = EAST`, add `region = WEST` on the same column → assert only one filter in store with value `WEST`, not two filters.

**Warning signs:**
- Clicking a second bar in a bar chart grouped by the same column causes all charts to go blank
- Filter bar shows two chips for the same column
- All chart data fetches return 0 rows after the second click

**Phase to address:** Same phase as D-04 (filter store implementation). The replacement logic and the cap are both invariants of the filter store's `addFilter` action.

---

## Cross-Chart Coordination Pitfalls

### C-01: Race Condition — Filter Changes While WMS Tile Request Is In-Flight

**What goes wrong:**
A user clicks a bar (drill-down), which updates the Zustand filter store. All charts react to the filter store change and issue new requests. The map's WMS tile layer issues new tile fetch requests to `/api/wms`. Before the first batch of tiles arrives, the user clicks again — the filter changes a second time. The second batch of WMS requests fires. The first batch's responses arrive after the second batch's requests are out. Depending on which responses arrive first, the map may render tiles from the first filter state (stale) on top of tiles from the second filter state (current), or tiles may flash as they are replaced.

This is the same class of bug that `useApiQuery.ts` already addresses for SQL chart queries (line 29: `let active = true; ... if (!active) return;`). The `active` flag pattern prevents stale data from being committed to state. The WMS tile path needs the same protection.

**Why it happens:**
The WMS tile path (OpenLayers fetching tiles from the proxy) is not managed by `useApiQuery` — it is managed by OpenLayers' internal tile loader. When filter params change, new tile requests fire via OpenLayers' tile queue. OpenLayers does not automatically cancel in-flight tile requests when source params change.

**How to avoid:**
- When the filter store changes and the map source is updated (via `source.updateParams()` or a new source object), call `source.clear()` on the old tile cache before setting new params. This causes OpenLayers to treat all existing tiles as invalid and fire new requests.
- Implement an `AbortController` in the `/api/wms` proxy route's fetch to Kinetica, keyed on `request_id`. When a new tile request for the same tile position arrives, abort the in-flight request for that position. This prevents Kinetica from processing stale tile requests.
- Simpler mitigation: the tile cache invalidation from M-02 (updating source params) already causes OpenLayers to discard in-flight tile responses that don't match the current tile grid key. Verify this behavior by testing rapid filter changes.

**Warning signs:**
- After rapid clicking, the map shows a patchwork of tiles from different filter states
- Network tab shows tile requests for the previous filter state completing after the new filter is active
- Map visual is inconsistent with the filter bar (some tiles filtered, some not)

**Phase to address:** The phase that wires filter store changes to the map tile source. AbortController on the proxy fetch is the backend implementation; source.clear() is the frontend implementation. Both in the same plan.

---

### C-02: Every Chart Subscribed to the Full Filter Store — O(N) Re-Renders on Each Click

**What goes wrong:**
The current Zustand store pattern (observed in `auth.ts`) subscribes components to the entire store slice. If every chart widget subscribes to the entire filter store (e.g., `const filters = useFilterStore(state => state.filters)`), and the filter store contains filters for multiple tables, then every chart re-renders when any filter anywhere changes — even filters for tables that a given chart is not associated with.

With 8 charts on a dashboard (the v1.2 target), each drill-down click causes 8 synchronous React re-renders, each of which re-executes the chart's query (8 API calls). If the chart components don't memoize correctly, this compounds further into React tree re-renders of child components.

**Why it happens:**
Zustand's selector is not applied to prevent this by default: `state.filters` returns the full array. If filters for multiple tables are in the same array, any change to any table's filters triggers all subscribers.

**How to avoid:**
- Use table-scoped selectors: `useFilterStore(state => state.filters[tableId] ?? [])`. Zustand uses strict equality by default — if `filters[tableId]` reference is unchanged (other table's filters changed), the component does not re-render.
- Keep the filter store keyed by table: `{ [tableId: string]: Filter[] }` rather than a flat array. Table-scoped subscriptions are then stable when other tables' filters change.
- Memoize the SQL query string with `useMemo` keyed on the chart's table filters — prevents re-fetches when parent components re-render for unrelated reasons.
- Connection to prior milestone anti-pattern AP-5 (no per-route env reads): same principle — state reads should be scoped to what the reader actually needs, not the entire global state.

**Warning signs:**
- React DevTools Profiler shows all 8 chart components re-rendering on every drill-down click
- Network tab shows API calls from charts associated with unrelated tables firing after a drill-down

**Phase to address:** The phase that implements the filter store. Table-keyed structure is an architectural decision that must be made at store creation — it is expensive to retrofit.

---

### C-03: Chart B's Request Fails After Drill-Down on Chart A — Contract for Error Display

**What goes wrong:**
After a drill-down click, all charts for the affected table re-fetch. Chart A rerenders with filtered data. Chart B (on the same table) issues a new fetch that returns a 502 from Kinetica (upstream error — e.g., Kinetica is briefly overloaded). The question is: what does Chart B show?

Options:
1. Show the previous (stale) data and an error toast. User may not realize Chart B is stale while Chart A shows correct filtered data.
2. Show an empty state with an error message. User can see the chart is broken.
3. Show a loading state indefinitely. Worst — user cannot tell if it is loading or broken.

Currently `useApiQuery.ts` sets `error` state but does NOT clear the previous `data` (line 29: `setData(result)` only on success). This means on error, the chart renders stale data alongside an error indicator — option 1 above, which is the existing behavior for all chart types.

**Why it happens:**
The `useApiQuery` hook was designed before cross-chart coordination existed. Its error/data model doesn't have a concept of "stale data from a previous filter state."

**How to avoid:**
- Establish a documented contract: on a filter change, `useApiQuery` should clear `data` to `null` before the new fetch resolves, showing a loading state rather than stale data. This prevents the "Chart A shows filtered data, Chart B shows pre-filter data" inconsistency.
- Add a `staleDataOnError: boolean` option to `useApiQuery` to control whether stale data is preserved on error. Default to `false` for charts that participate in cross-chart coordination.
- Show an error toast (already implemented) AND an inline error state in the chart body — not just stale data. The existing `error.kind === 'upstream'` path in `useApiQuery` sets error state; the chart renderer must check `error !== null` and render an error UI, not silently show stale data.

**Warning signs:**
- After a drill-down, some charts show updated data while others show old data with no visual indication they are stale
- Error toast fires for Chart B but Chart B's visual appears normal (old data)

**Phase to address:** The phase that implements cross-chart filter coordination and the filter store subscription. The contract must be documented in the same plan as the coordination implementation.

---

### C-04: Filter Applied to Column on Table A Applied to Chart on Table B — Wrong Table Scope

**What goes wrong:**
This anti-pattern is explicitly called out as a locked design decision in v1.2 (filters are table-scoped, not dashboard-scoped). However, the implementation risk is that a developer wires the filter store incorrectly and broadcasts all filters to all charts regardless of table association.

Example: Dashboard has Chart A (on `orders` table, drill-down on `region`) and Chart B (on `customers` table). User drills down on Chart A, adding `region = 'WEST'` to the `orders` filter. If Chart B's query naively applies all active filters, it will add `WHERE region = 'WEST'` to its `customers` query. If `customers` has a `region` column, this produces a wrong result (silently — no error). If `customers` has no `region` column, it produces a SQL error.

**Why it happens:**
A simple filter store implementation that stores all filters in a single flat array, and each chart reads all filters to append to its WHERE clause, will produce this bug. It requires actively scoping filters by table to avoid it.

**How to avoid:**
- The filter store must be keyed by `tableId` (see C-02 for the structural requirement).
- Each chart must only read filters for its own `tableId`: `filters[chart.tableId] ?? []`.
- At integration time, add a test: add a filter for table A, verify table B's query does not include the filter.
- This is the "same table auto-share, different table isolation" requirement from the locked scope.

**Warning signs:**
- Charts on Table B show fewer results after drilling down on a chart for Table A
- SQL error from a chart on Table B referencing a column that only exists in Table A
- Filter bar shows "active" filters affecting charts they should not affect

**Phase to address:** The phase that implements the filter store. Structural decision (keyed by tableId) at store creation. Same as C-02.

---

### C-05: Map Closest-Point Identify Probe Returns Multiple Equally-Close Points — Non-Deterministic Filter

**What goes wrong:**
The locked v1.2 design for map drill-down: user clicks on the map; the BI app sends a closest-point WMS "identify" request (Kinetica's `/wms` with `REQUEST=GetFeatureInfo` or Kinetica's equivalent identify endpoint) to find the underlying data row(s) nearest to the click coordinate. If two points are equidistant from the click (common in grid-sampled data, or duplicate coordinate entries), the identify response may return both rows. The drill-down mechanism must choose one row to create the equality filter — or it creates two conflicting filters (D-05 class).

The choice of which row to use as the filter value is non-deterministic if the identify endpoint returns them in arbitrary order.

**Why it happens:**
Geospatial data often has duplicate or near-duplicate coordinates. The user clicking "between" two features is a normal interaction. The identify probe does not guarantee a unique result.

**How to avoid:**
- Define a deterministic tie-breaking rule at spec time (before implementation): "When multiple equally-close points are returned by the identify probe, use the first result in the response array."
- Alternatively: when multiple candidates are returned, show a disambiguation popover on the map (small popup with the candidate values listed as clickable items). This is the most user-friendly approach and avoids silent non-determinism.
- Add a visual feedback element: show a click marker on the map at the clicked coordinate, indicating a probe is in-flight. Remove it when the drill-down filter is applied.
- In the identify response handler: `const candidate = results[0]` — explicit first-result selection, with a comment explaining the tie-break rule.
- Add a test: mock an identify response with two equally-close results; assert the first result's value is used for the filter.

**Warning signs:**
- Clicking near a data cluster produces inconsistent filter values across repeated clicks (different row selected each time)
- Filter bar shows different values after clicking the same map location twice

**Phase to address:** The phase that implements the map click-to-drill-down handler. Tie-break rule must be in the spec before implementation, not discovered during code review.

---

## State / Test Pitfalls

### S-01: Filter State in Zustand AND in Chart-Local React State — Two Sources of Truth

**What goes wrong:**
A developer implementing a chart component stores the "currently applied filter" both in the Zustand filter store (as the shared coordination layer) and as a local `useState` in the chart component (for optimistic UI, or for a "pending filter" before it's committed). These two sources of truth diverge when:
1. Another chart adds a filter (updates Zustand) but the local state is not updated.
2. The filter is cleared via the filter bar (updates Zustand) but the local state retains the old value.
3. A component re-mounts and initializes local state from `defaultValue` rather than reading from Zustand.

The symptom: the chart appears to be filtered (visual change) but the filter bar does not show the filter, or vice versa.

**Why it happens:**
Adding local state is the path of least resistance in React. `useState` for "what the chart is currently showing" feels natural. The global store integration adds one layer of indirection that feels like over-engineering until it breaks.

**How to avoid:**
- Establish a rule in the filter store design: filters live in Zustand ONLY. Chart components read from the filter store via a selector. They do not maintain a local copy of the filter state.
- The chart component's local state is limited to: loading state, error state, and fetched data — not filter state.
- The Zustand filter store is the single source of truth for all filter-related state.
- Code review check: reject any PR that has `useState` tracking filter values alongside a Zustand filter store subscription.

**Warning signs:**
- Filter bar shows 0 active filters but chart is rendering filtered data (or vice versa)
- Clearing all filters from the filter bar does not update one or more charts
- Chart shows stale filtered data after navigation back to the dashboard

**Phase to address:** The phase that implements the filter store AND the first chart's drill-down integration. Establish the single-source-of-truth rule as an architectural constraint before any chart integrates with the store.

---

### S-02: Filter Clear Does Not Trigger Re-Fetch — Empty Filter Treated as No-Op

**What goes wrong:**
The `useApiQuery` hook fires a new fetch when its `deps` array changes. If the filter store subscription provides the current filters as a dep, clearing all filters changes the filter array from `[filterA, filterB]` to `[]`. In JavaScript, `[] !== []` — arrays are compared by reference in Zustand selectors. The selector `state => state.filters[tableId] ?? []` returns a new `[]` array reference every time the filters are empty but the dep comparison (`===`) sees a new reference and correctly fires a re-fetch.

However: if the filter value is derived and memoized incorrectly (e.g., `const filters = useMemo(() => store.filters[tableId], [store.filters])` — depending on how `store.filters` is shaped), clearing filters may produce the same memoized reference as the initial empty state, resulting in no re-fetch.

**Why it happens:**
Empty filter state and initial state are both "no filters." A naive memoization treats them as identical, producing a stable reference that never triggers the `useApiQuery` dep change. The bug only surfaces after a filter has been added and then cleared — not on initial load.

**How to avoid:**
- Use a filter "generation counter" or "filter version" in the store: every add/remove operation increments `filterVersion: number`. Charts subscribe to `filterVersion` as a dep rather than the filter array itself. `filterVersion` always changes (even on clear), so re-fetch always fires.
- Alternatively: ensure the filter store's `clearFilters` action creates a new array reference each time (do not return the same `[]` reference): `set(state => ({ filters: { ...state.filters, [tableId]: [] } }))`. New object reference ensures Zustand notifies subscribers.
- Add a test: add a filter → assert re-fetch fires; clear filters → assert re-fetch fires again. The second assertion catches this specific bug.

**Warning signs:**
- Clearing filters from the filter bar does not update chart data (data remains filtered visually)
- No network request fires after clearing filters (visible in Network tab)
- Refreshing the page shows the correct unfiltered data — confirming the filter store state is the issue

**Phase to address:** The phase that implements the filter store's `clearFilters` action and its integration with `useApiQuery`. Must be tested with an explicit "add then clear" test, not just an "add" test.

---

### S-03: Frontend Tests Using Zustand Without the Store-Reset Shim — Filter State Leaks Between Tests

**What goes wrong:**
The v1.1 frontend test infrastructure added a Zustand store-reset shim (`__mocks__/zustand.ts`) that resets all store state to initial values between tests via `afterEach`. This shim is activated by `vi.mock("zustand")` in `src/test/setup.ts`.

When the v1.2 filter store is added (a new `create()` call), the shim automatically registers it for reset — **as long as the test file imports `zustand` or the store through the mocked module path**. The regression risk: if a new test file is added for filter-store behavior that does not import `setup.ts` (e.g., a standalone spec file that manually calls `vi.mock` or does not include the global setup), the filter state from test A bleeds into test B. Tests pass individually but fail when run in suite order.

This is the same class of issue identified in v1.1 (the shim was added specifically to prevent it). The risk resurfaces whenever a new store is added or a new spec file is created that doesn't follow the established pattern.

**Why it happens:**
New test files may be created by copy-paste from a non-RTL test file (e.g., from the server test suite, which has no Zustand). The `vi.mock("zustand")` line in `setup.ts` is global — but only for files that include that setup file in their Vitest config. A new test file that is not in the same `vitest.config.ts` test suite won't inherit the global setup.

**How to avoid:**
- Keep all frontend tests in a single Vitest project so `setupFiles: ['src/test/setup.ts']` applies universally. Do not create a separate `vitest.config.ts` for filter-store tests.
- Add a canary test to the filter store spec: `it('filter store is reset between tests', () => { ... })` that adds a filter in one test and asserts the store is empty in the next.
- In any new spec file: explicitly document "This file relies on src/test/setup.ts for Zustand store reset. Do not run in isolation without that setup file."
- Connection to prior milestone: the shim was the v1.1 solution for auth store isolation. The same shim handles the v1.2 filter store automatically — but only if the test infrastructure is used correctly.

**Warning signs:**
- Filter store tests pass individually but fail when run in suite (test order matters — always a leak sign)
- A test that checks "store starts empty" fails because a previous test left filters behind
- `vitest --reporter=verbose` shows test failures that disappear when `--isolate` is used

**Phase to address:** The phase that adds the filter store AND writes its first test file. Validate the shim covers the new store by running `beforeEach` + `afterEach` canaries. This is a regression-prevention concern — the infrastructure already exists, it just needs to be applied correctly to v1.2 stores.

---

## "Looks Done But Isn't" Checklist

- [ ] **Map cleanup:** Map renders and pans correctly — verify `map.dispose()` is called on unmount by checking memory in React DevTools after navigating away from a dashboard with a map
- [ ] **WMS tile freshness:** Filter bar updates correctly — verify new WMS tile requests fire after each drill-down (Network tab; should see tile fetches with updated filter params)
- [ ] **Null drill-down:** Clicking a null-value bar looks like it filtered — verify the SQL generated contains `IS NULL` not `= NULL` (check server logs)
- [ ] **Same-column filter replacement:** Clicking the same bar group twice looks like it works — verify only one filter exists for that column in the store (not two contradictory filters)
- [ ] **Filter clear re-fetch:** Clearing filters makes charts look refreshed — verify a network request fired (not served from stale state)
- [ ] **Projection alignment:** Map tiles render and align with basemap — verify a known geographic feature (e.g., city center) renders at the correct position at zoom 10+
- [ ] **Apostrophe value drill-down:** Clicking a bar with "O'Brien" value doesn't crash — verify the escaped SQL is sent to Kinetica (server logs)
- [ ] **Token expiry + tiles:** Map tiles are visible after 1 hour of OIDC session — verify no stale cached tiles serve post-expiry (check Network tab for `(from disk cache)` tile responses)
- [ ] **Geometry column classbreak warning:** Selecting a geometry column for classbreak mode shows a warning — verify the config panel validates column type before making a WMS request
- [ ] **Zustand store reset in tests:** Adding a filter in one test doesn't affect the next test — run filter store specs 3x to verify order-independence

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store filters as flat array (not keyed by tableId) | Simpler initial implementation | C-02 and C-04 bugs; O(N) re-renders on all filter changes; requires refactor when multi-table dashboard is used | Never — table-keying is 2 lines of extra code with large correctness gain |
| No cardinality check on classbreak column | Avoids async config validation | M-06 browser freeze on high-cardinality columns; unrenderable legend | Never — cardinality check is one SQL query at config time |
| Skip WMS source.updateParams() — rebuild full map on filter change | Simpler code | Jarring UX (map reinitializes on every filter change); loses view state (zoom/pan position) | Never — updateParams() is the correct OpenLayers API |
| CSS-pixel blur radius for heatmap WMS | Consistent mental model with CSS | M-05 visual corruption — value is in wrong units for server-side render | Never — document units clearly in the config UI |
| Skip AbortController on proxy fetch | Simpler proxy route | C-01 stale-tile race condition under rapid clicks | Acceptable as MVP if filter change rate is expected to be low (internal tool); address before user-facing release |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenLayers + Kinetica WMS | Send WMS request without `SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1` required params | Always include the WMS spec-required params in the base URL template; Kinetica WMS is strict about these |
| OpenLayers + React 18 | Create map outside `useEffect`, in component body or module scope | Always create map in `useEffect` with `containerRef.current` guard; return cleanup that calls `map.dispose()` |
| Zustand filter store + `useApiQuery` | Pass the filter array directly as a dep: `[filters]` | Arrays are always new references; use a stable primitive dep (e.g., `filterVersion` counter or serialized string) |
| Kinetica `/execute/sql` + user-supplied values | Interpolate clicked value directly: `WHERE col = '${value}'` | Escape via `value.replace(/'/g, "''")` at minimum; test with apostrophe values |
| Kinetica WMS identify probe + map click | Assume single result returned | Always handle array of results; implement tie-break rule for multi-result response |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No filter store selector scoping | All 8 charts re-render on every click | Table-keyed Zustand selectors with primitive dep | Day 1 with > 3 charts on dashboard |
| High-cardinality classbreak (10K values) | Browser freeze on legend render + slow WMS tile | Cardinality cap at config time (M-06) | Any classbreak on an id-like column |
| Unbounded filter accumulation | Slow Kinetica queries after 20+ drill-downs | 10-filter cap in store `addFilter` (D-04) | After ~20 clicks in exploration mode |
| WMS GET with deep filter chain | 431 URL Too Long / silent truncation | POST variant for filter-heavy WMS calls (M-07) | When a filter chain exceeds ~15 equality filters |
| No WMS tile cache-control header | Stale tiles served post-filter-change | `Cache-Control: no-store` on `/api/wms` proxy route | Every filter change (persistent issue) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| User-clicked value interpolated into SQL without escaping | SQL injection via crafted data value (D-02) | `escapeKineticaStringLiteral()` utility; test with adversarial inputs |
| `Cache-Control` not set on WMS tile responses | Auth-protected tile data cached in browser; served to another user on shared device | `no-store` on all `/api/wms` responses (M-08) |
| CQL_FILTER URL param contains user data unescaped | Injection into Kinetica WMS filter expression via crafted data value | Same escaping function as D-02; URL-encode the escaped result |
| Drill-down column allows geometry/blob columns | URL length overflow (M-07) + WKT injection via geometry string containing SQL metacharacters | Config-time column type filter (D-01) |

---

## Pitfall-to-Phase Mapping

| ID | Pitfall | Category | Priority | Recommended Phase |
|----|---------|----------|----------|-------------------|
| M-01 | Map instance not disposed on unmount | Map | CRITICAL | Phase: Map component implementation |
| M-02 | WMS tile cache not invalidated on filter change | Map | CRITICAL | Phase: Filter-store-to-map wiring |
| D-02 | Drill-down value SQL injection / apostrophe crash | Drill-down | CRITICAL | Phase: Drill-down filter builder (same plan as filter SQL utility) |
| D-05 | Same-column filter contradiction — always-empty result | Drill-down | CRITICAL | Phase: Filter store implementation |
| C-04 | Cross-table filter scope bleed | Cross-chart | CRITICAL | Phase: Filter store implementation |
| S-01 | Two sources of truth for filter state | State | CRITICAL | Phase: Filter store implementation |
| M-03 | EPSG:3857 vs EPSG:4326 projection mismatch | Map | HIGH | Phase: Map component / WMS layer setup |
| M-04 | WKT vs Kinetica WKB column type — wrong WMS params | Map | HIGH | Phase: Map config panel |
| M-08 | WMS tile auth cache serves stale post-expiry | Map | HIGH | Phase: `/api/wms` proxy route |
| D-01 | Drill-down on geometry/blob/nullable-id column | Drill-down | HIGH | Phase: Drill-down config panel |
| D-03 | Drill-down on NULL value → IS NULL vs = NULL | Drill-down | HIGH | Phase: Drill-down filter builder (same plan as D-02) |
| D-04 | Unbounded filter accumulation | Drill-down | HIGH | Phase: Filter store implementation |
| C-01 | Race condition: filter changes during in-flight WMS request | Cross-chart | HIGH | Phase: Filter-store-to-map wiring |
| C-02 | O(N) re-renders — all charts subscribe to full filter store | Cross-chart | HIGH | Phase: Filter store implementation |
| C-03 | Chart B stale data after Chart A drill-down + error | Cross-chart | HIGH | Phase: Cross-chart coordination |
| C-05 | Map identify probe returns multiple equidistant points | Cross-chart | HIGH | Phase: Map click-to-drill-down handler |
| S-02 | Filter clear does not trigger re-fetch | State | HIGH | Phase: Filter store + `useApiQuery` integration |
| S-03 | Zustand shim not covering new filter store in tests | State | HIGH | Phase: Filter store (first test file) |
| M-05 | Heatmap blur radius units — pixels vs map units | Map | MEDIUM | Phase: Heatmap render mode configuration |
| M-06 | High-cardinality classbreak column | Map | MEDIUM | Phase: Map config panel (classbreak mode) |
| M-07 | WMS GET URL length limit with deep filter chains | Map | MEDIUM | Phase: WMS request builder + filter wiring |

---

## Prior Milestone Anti-Pattern Resurface Risk

| Prior AP | Original Context | v1.2 Resurface Risk |
|----------|-----------------|---------------------|
| v1.0 AP-5: no per-route `process.env` reads | Auth credentials must come from session, not env | Filter values must come from Zustand store, not component-local state or URL params (S-01) |
| v1.1 PITFALL I-01: credential discriminant — check `credentialType`, not field truthiness | Bearer vs Basic auth selection | Filter dispatch must check `filter.operator === 'IS NULL'`, not value truthiness (D-03) |
| v1.1 PITFALL I-07: `kineticaWms` token expiry | OIDC token expiry not caught before proxy call | WMS tile responses must not be cached by browser; token expiry causes stale-tile state (M-08) |
| v1.1 PITFALL S-03: Zustand store-reset shim | Auth store state bleeding between tests | Filter store state bleeding between tests — same shim, same risk, new store (S-03) |
| v1.0 Phase 2 spike: 400 + access-denied → KineticaPermissionError | Kinetica error taxonomy is non-standard | High-cardinality classbreak may return a WMS 400 with a body that resembles access-denied — verify it is classified as `KineticaUpstreamError`, not `KineticaPermissionError` (M-06) |

---

## Sources

- Codebase analysis: `kinetica_bi/server/src/kinetica.ts` — `kineticaWms` return-raw-Response pattern, audit log, `buildAuthHeader` PITFALL I-01 lock
- Codebase analysis: `kinetica_bi/src/hooks/useApiQuery.ts` — `active` flag pattern for stale response suppression; existing `PermissionError`/`ReauthRequiredError`/`UpstreamError` dispatch
- Codebase analysis: `kinetica_bi/src/store/auth.ts` — Zustand `create()` usage, selector patterns
- Codebase analysis: `kinetica_bi/__mocks__/zustand.ts` — store-reset shim implementation, `storeResetFns` Set
- Codebase analysis: `kinetica_bi/src/test/setup.ts` — `vi.mock("zustand")` activation pattern, `afterEach` cleanup
- Codebase analysis: `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition`, extensible chart system
- Codebase analysis: `kinetica_bi/src/components/charts/definitions/map.ts` — current stub map definition (no WMS params yet)
- Project context: `.planning/PROJECT.md` — locked v1.2 scope decisions (filter scope, drill-down design, map render modes, spatial column types)
- Prior milestone: `.planning/research/_archive_v1.1/PITFALLS.md` — I-01, I-07, S-03 class pitfalls, "Looks Done But Isn't" structure
- Prior milestone: `.planning/MILESTONES.md` — v1.0 AP-5, v1.1 TD-V11-03 (RFC 9207 iss-check workaround in oidc.ts — open security-flagged TD)
- OpenLayers documentation (training data, HIGH confidence for core API): `Map.dispose()`, `TileWMS.updateParams()`, `source.clear()` methods; projection system; `useEffect` cleanup requirements
- SQL standard (HIGH confidence): `NULL = NULL` is `NULL` (not TRUE); `IS NULL` is the correct null predicate
- Kinetica WMS documentation (MEDIUM confidence — verify against deployed Kinetica version): spatial column parameter names (`X_ATTR`/`Y_ATTR` vs `GEO_ATTR`), WKT vs WKB handling, classbreak limits, identify endpoint shape

---

*Pitfalls research for: v1.2 Interactive Dashboards (OpenLayers + WMS map, click drill-down, cross-chart filter coordination)*
*Researched: 2026-05-01*
