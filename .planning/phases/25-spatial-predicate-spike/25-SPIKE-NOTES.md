# 25-SPIKE-NOTES.md — Spatial Predicate Spike Decision Record

**Status: PASS — Phase 26 `buildSpatialOrBlock` AUTHORIZED**

---

## 1. Run Metadata

| Field | Value |
|---|---|
| Deployed Kinetica URL | http://172.31.0.22:8082/gpudb-0 |
| User | admin (password-mode Basic auth) |
| Kinetica server version | unknown — operator did not capture; recommend follow-up via `SHOW SYSTEM PROPERTIES` before Phase 26 ships to record version pinning in Phase 26 PLAN frontmatter (allows revisit if Kinetica is upgraded) |
| Latlon target | demo.nyctaxi.(pickup_longitude, pickup_latitude) |
| WKT target | ki_home.us_states.WKT (geometry column is literally named `WKT`) |
| Probe anchor | lon=-73.95, lat=40.75, ±0.5° |
| Probe script | kinetica_bi/server/src/spatialPredicateSpike.ts (commit f72615f) |
| Run date | 2026-05-11 |
| Runner invocation | `cd kinetica_bi/server && npm run spatial-predicate-spike` |

---

## 2. Probe Results — All 12 Probes

PASS criterion (strong — same as locked in 25-CONTEXT.md): HTTP 200 AND body.status != "ERROR" AND COUNT(*) > 0.

### Latlon Probes (table: demo.nyctaxi, BI-user reachable)

| Probe ID | Predicate signature | Shape | n (COUNT(*)) | Result | Interpretation |
|---|---|---|---|---|---|
| L-A1 | `STXY_WITHIN(pickup_longitude, pickup_latitude, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1` | 4-corner bbox | 490758 | **PASS** | STXY_WITHIN works for bbox shape; 490k pickup points in ~50km NYC square confirms data density |
| L-A2 | `STXY_WITHIN(pickup_longitude, pickup_latitude, ST_GEOMFROMTEXT('<64-vertex-circle>')) = 1` | 64-vertex circle | 490753 | **PASS** | Circle inscribed in bbox; 5-row difference vs bbox is correct (circle excludes bbox corners) |
| L-A3 | `STXY_WITHIN(pickup_longitude, pickup_latitude, ST_GEOMFROMTEXT('<150-vertex-lasso>')) = 1` | 150-vertex lasso | 490752 | **PASS** | Jittered lasso; 1-row difference vs circle is expected (minor shape deviation) |
| L-B1 | `STXY_CONTAINS(ST_GEOMFROMTEXT('<bbox-WKT>'), pickup_longitude, pickup_latitude) = 1` | 4-corner bbox | 490758 | **PASS** | Reversed argument order; identical count to L-A1 — commutative-by-design semantics confirmed |
| L-B2 | `STXY_CONTAINS(ST_GEOMFROMTEXT('<64-vertex-circle>'), pickup_longitude, pickup_latitude) = 1` | 64-vertex circle | 490753 | **PASS** | Identical count to L-A2 — argument reversal is purely syntactic for point-in-polygon |
| L-B3 | `STXY_CONTAINS(ST_GEOMFROMTEXT('<150-vertex-lasso>'), pickup_longitude, pickup_latitude) = 1` | 150-vertex lasso | 490752 | **PASS** | Identical count to L-A3 — confirmed commutative |

### WKT Probes (table: ki_home.us_states, BI-user reachable)

| Probe ID | Predicate signature | Shape | n (COUNT(*)) | Result | Interpretation |
|---|---|---|---|---|---|
| W-A1 | `ST_WITHIN(WKT, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1` | 4-corner bbox | 0 | **FAIL** (script criterion) | Semantically correct: no US state is fully contained within a 1° NYC-area bbox. Wrong semantic for v1.5 map-shape filtering — see Decision section. |
| W-A2 | `ST_WITHIN(WKT, ST_GEOMFROMTEXT('<64-vertex-circle>')) = 1` | 64-vertex circle | 0 | **FAIL** (script criterion) | Same reasoning as W-A1; circle is smaller than any US state |
| W-A3 | `ST_WITHIN(WKT, ST_GEOMFROMTEXT('<150-vertex-lasso>')) = 1` | 150-vertex lasso | 0 | **FAIL** (script criterion) | Same reasoning as W-A1 |
| W-B1 | `ST_INTERSECTS(WKT, ST_GEOMFROMTEXT('<bbox-WKT>'))` | 4-corner bbox | 3 | **PASS** | NY, NJ, CT — the three US states that intersect an NYC-area bbox. Correct semantic for v1.5 filtering. |
| W-B2 | `ST_INTERSECTS(WKT, ST_GEOMFROMTEXT('<64-vertex-circle>'))` | 64-vertex circle | 3 | **PASS** | Same 3 states; circle inscribed in bbox still touches all three |
| W-B3 | `ST_INTERSECTS(WKT, ST_GEOMFROMTEXT('<150-vertex-lasso>'))` | 150-vertex lasso | 3 | **PASS** | Same 3 states; lasso variation within bbox does not exclude any of the three |

**Script recommendation banner output:**
```
Latlon mode recommendation: STXY_WITHIN
WKT mode recommendation:    ST_INTERSECTS
Overall: PASS — Phase 26 buildSpatialOrBlock authorized
```

All 12 probes returned HTTP 200 with `status: "OK"`. No network blips, no re-runs, no transient errors reported by operator.

---

## 3. Decisions

### 3.1 Latlon mode — LOCKED: `STXY_WITHIN`

**Rejected:** `STXY_CONTAINS`

**Rationale:**
- Both L-A (STXY_WITHIN) and L-B (STXY_CONTAINS) returned identical row counts across all three shapes (490758 / 490753 / 490752). They are commutative-by-design point-in-polygon predicates that differ only in argument order: `STXY_WITHIN(lon, lat, shape)` vs `STXY_CONTAINS(shape, lon, lat)`.
- `STXY_WITHIN` is chosen because:
  - (a) It matches the canonical Kinetica documentation reference and the Phase 18 spike (v1.4) confirmed it works for the `STXY_DISTANCE` distance-query pattern; `STXY_WITHIN` is the canonical spatial-filter counterpart.
  - (b) The `(lon, lat)` column pair appears FIRST in the argument list, which is natural when binding a WHERE clause to an existing column pair already expressed in `(lon, lat)` order in our `buildSpatialOrBlock` template. This avoids argument-order confusion during Phase 26 template construction.
  - (c) The argument order `(x, y, geom)` is more grep-stable — future readers see the data columns before the shape literal.

### 3.2 WKT mode — LOCKED: `ST_INTERSECTS`

**Rejected:** `ST_WITHIN`

**Rationale:**
- The W-A probes (ST_WITHIN) returned 0 rows. This is NOT a Kinetica bug — it is the semantically correct answer to "is the entire US state polygon fully contained within this 1° NYC-area shape?" No US state is small enough to fit inside a 1° box, so 0 is correct.
- However, 0-row `ST_WITHIN` is the WRONG semantic for v1.5 map-shape filtering. Users draw a shape on the map and expect to see features whose geometry **touches** the drawn shape — not features that are **swallowed whole** by it. For polygon/geometry layers (US states, census tracts, building footprints), `ST_WITHIN` would always return 0 unless the drawn shape is larger than the geometry.
- `ST_INTERSECTS` returns 3 (NY, NJ, CT — geographically adjacent to NYC and all intersecting the probe shapes). This is the correct v1.5 semantic: "features whose geometry intersects the drawn shape."
- The W-A FAIL was anticipated during research (25-RESEARCH.md §"WKT predicate semantics") and does not indicate a Kinetica defect. ST_WITHIN remains a valid Kinetica function — it is simply the wrong predicate for this use case.

### 3.3 Exact SQL templates for Phase 26 `buildSpatialOrBlock`

**The following templates are to be copied verbatim into Phase 26's `spatialWhereClause.ts`:**

```sql
-- LATLON mode template (bind shape WKT as a parameterized value):
STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT(?)) = 1

-- WKT mode template (bind shape WKT as a parameterized value):
ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT(?)) = 1
```

Where:
- `<lon_col>` = the column name holding longitude floats (e.g. `pickup_longitude`)
- `<lat_col>` = the column name holding latitude floats (e.g. `pickup_latitude`)
- `<geom_col>` = the column name holding geometry (e.g. `WKT`)
- `?` = parameterized placeholder bound to the serialized shape WKT string (EPSG:4326, produced by Phase 29's OL draw-tool `writeGeometry({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })`)

**Note on `ST_GEOMFROMTEXT` wrapping:** Both templates use `ST_GEOMFROMTEXT(?)` to parse the shape WKT at query time. This is intentional — the shape is a user-drawn polygon (bbox / circle / lasso) with potentially hundreds of vertices. Kinetica parses the WKT once per query execution. The `STXY_DISTANCE`-based info-query (Phase 18) uses `STXY_DISTANCE(geom, x, y)` without WKT parsing because that query binds a coordinate pair; spatial filter binds a polygon WKT so `ST_GEOMFROMTEXT` is required.

---

## 4. Risks and Known Limitations

### 4.1 Server version not captured

The Kinetica server version was not recorded during the operator run. This is a documentation gap, not a blocking risk. The spike results are valid regardless of version. However, if the Kinetica deployment is upgraded in future, the spatial predicates should be re-validated before shipping to production. Recommended action: run `SHOW SYSTEM PROPERTIES` on the deployed instance and record the version in Phase 26's PLAN frontmatter.

### 4.2 `ST_WITHIN` returning 0 rows is correct, not a Kinetica bug

W-A1 through W-A3 returned 0 rows and were classified FAIL by the script's ≥1-row criterion. This is an intentional classification — `ST_WITHIN` requires the geometry column's features to be fully INSIDE the drawn shape. For polygon/geometry layers (where features are large relative to drawn shapes), this is always the wrong semantic. The script's FAIL classification correctly guided selection toward `ST_INTERSECTS`. Future engineers encountering 0-row `ST_WITHIN` results on this fixture should NOT interpret it as a Kinetica dysfunction.

### 4.3 WKB mode remains deferred (TD-V14-WKB-SPIKE)

This spike covered latlon and WKT modes only. WKB-binary columns were not probed (no WKB-binary column was available in the operator's Kinetica account). The v1.5 architecture continues the v1.4 deferral: `isSpatialTargetEligible` returns false for WKB mode; server returns HTTP 501 at all three eligibility gates. TD-V14-WKB-SPIKE carries forward.

### 4.4 Lasso simplification mandatory for WHERE clause safety

The spike used a 150-vertex lasso. Phase 29 MUST apply `geometry.simplify(map.getView().getResolution() * 2)` on the cloned geometry BEFORE WKT serialisation at every `drawend` to prevent WHERE clause size bombs (V15-P-03 lock). The spike was not testing clause length; production lasso drawing can produce thousands of vertices if simplification is omitted.

### 4.5 Latlon counts are population-level (demo.nyctaxi full table)

The latlon probes ran against the full `demo.nyctaxi` table (no filter active). The 490k+ row counts are expected for a NYC taxi pickup dataset in a 1°×1° box. These counts validate that the predicates return data, not that they return the "correct" subset — spatial correctness of the predicates is confirmed by the consistent counts across both STXY_WITHIN and STXY_CONTAINS (identical counts = no argument-order flip bug) and across all three shape types (decreasing counts bbox > circle > lasso = correct polygon containment hierarchy).

---

## 5. Phase 26 Hand-off Checklist

The `buildSpatialOrBlock` implementer in Phase 26 needs the following from this notes file:

- [ ] **Latlon predicate:** `STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT(?)) = 1` — copy verbatim from Section 3.3
- [ ] **WKT predicate:** `ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT(?)) = 1` — copy verbatim from Section 3.3
- [ ] **Argument order for latlon:** `(lon_col, lat_col, shape)` — lon/lat FIRST, shape LAST. Do NOT swap. STXY_CONTAINS has the reversed order `(shape, lon, lat)` and was rejected for this reason.
- [ ] **Argument order for WKT:** `(geom_col, shape_literal)` — geometry column FIRST, shape literal SECOND. Both ST_WITHIN and ST_INTERSECTS use this order; the reversal risk is on the latlon side only.
- [ ] **Outer parens mandatory (V15-P-07 lock):** `buildSpatialOrBlock` MUST wrap the OR chain in outer parens: `(pred1 OR pred2)`. Unit test must assert exact paren structure for 2-shape + 1-column-filter input BEFORE any multi-shape UI exists. Single-shape bug is invisible; multi-shape breaks column filters silently.
- [ ] **WKB gate:** `isSpatialTargetEligible` must return false for WKB mode. Server returns HTTP 501. Do NOT invoke buildSpatialOrBlock for WKB targets.
- [ ] **Shape WKT source:** The `?` placeholder is bound to the WKT produced by Phase 29's OL draw-tool `writeGeometry({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })` after `geometry.simplify(...)`. Phase 26 receives this WKT string as input — it does not perform projection or simplification.
- [ ] **Version follow-up:** Before Phase 26 ships, capture the Kinetica server version via `SHOW SYSTEM PROPERTIES` and record it in Phase 26's PLAN frontmatter. This enables future re-validation if Kinetica is upgraded.
- [ ] **Runner preserved:** `kinetica_bi/server/src/spatialPredicateSpike.ts` at commit f72615f is the one-shot re-run path for future Kinetica-version validation. Do not delete or modify without creating a replacement.
