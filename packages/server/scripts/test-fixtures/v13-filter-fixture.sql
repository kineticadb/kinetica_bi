-- v1.3 Phase 17 verification fixture (VERIFY-V13-01 / TD-V12-04 closure)
--
-- Purpose: Low-cardinality, spatially-spread synthetic table for end-to-end
-- filter UAT. Each filter value owns ~10–20% of points; filtering one value
-- visibly removes a chunk at default dashboard zoom (continental US scale).
--
-- Run by: Phase 17 operator (BI-user creds; default schema ki_home).
-- Drop after VERIFICATION.md is written:
--   DROP TABLE IF EXISTS ki_home.v13_filter_fixture;
--
-- This file is a REFERENCE artifact. It is NOT auto-run by CI, NOT loaded
-- by vitest, and NOT executed by the BI app at runtime. Operator copies and
-- pastes (or runs via curl) directly against deployed Kinetica.

DROP TABLE IF EXISTS ki_home.v13_filter_fixture;

CREATE TABLE ki_home.v13_filter_fixture (
  id          INT NOT NULL,
  category    VARCHAR(8) NOT NULL,    -- filter column: 8 values 'A'..'H' (cardinality target 5–10)
  lat         DOUBLE NOT NULL,         -- CONUS spread: ~24..49
  lon         DOUBLE NOT NULL,         -- CONUS spread: ~-125..-67
  metric      DOUBLE NOT NULL,         -- aggregation target for bar/line/pie/scatter (renamed from `measure` — Kinetica reserves MEASURE keyword)
  bucket      VARCHAR(4) NOT NULL,     -- secondary dimension for chart variety: 'low'|'med'|'high'
  PRIMARY KEY (id)
);

-- Insert ~1000 rows (target band 500–2000) using Kinetica's GENERATE_SERIES.
-- One INSERT INTO ... SELECT for compactness; if the deployed Kinetica build
-- lacks GENERATE_SERIES, the operator may substitute hand-crafted INSERTs.
--
-- Distribution: id i ∈ [1..1000]
--   category = CHAR(65 + (i % 8))                   -- 'A'..'H' uniform
--   lat      = 24 + (i % 250) * 0.1                  -- 24.0..49.0 step 0.1
--   lon      = -125 + (i % 580) * 0.1                -- -125.0..-67.0 step 0.1
--   metric   = 10 + ((i * 7) % 100)                  -- 10..109 (chart aggregations have variation)
--   bucket   = CASE WHEN metric < 40 THEN 'low' WHEN metric < 80 THEN 'med' ELSE 'high' END

INSERT INTO ki_home.v13_filter_fixture (id, category, lat, lon, metric, bucket)
SELECT
  i AS id,
  CHAR(65 + MOD(i, 8))                       AS category,
  24.0 + (MOD(i, 250) * 0.1)                 AS lat,
  -125.0 + (MOD(i, 580) * 0.1)               AS lon,
  10.0 + (MOD(i * 7, 100))                   AS metric,
  CASE
    WHEN (10.0 + (MOD(i * 7, 100))) < 40.0  THEN 'low'
    WHEN (10.0 + (MOD(i * 7, 100))) < 80.0  THEN 'med'
    ELSE                                          'high'
  END                                         AS bucket
FROM TABLE(GENERATE_SERIES(1, 1000)) AS t(i);

-- Quick verification queries (operator runs to confirm shape before UAT):
--   SELECT COUNT(*)                                          FROM ki_home.v13_filter_fixture;       -- expect 1000
--   SELECT category, COUNT(*) FROM ki_home.v13_filter_fixture GROUP BY category ORDER BY category;  -- expect 8 rows, ~125 each
--   SELECT MIN(lat), MAX(lat), MIN(lon), MAX(lon)            FROM ki_home.v13_filter_fixture;       -- expect CONUS bbox
