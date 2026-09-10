# Phase 18 — WKB Spatial-Proximity Spike Notes

**Spike date:** 2026-05-08
**Deployed Kinetica:** `http://172.31.0.22:8082/gpudb-0` (credentials redacted)
**Operator:** `admin` (BI-user, password mode)
**Kinetica version:** unknown
**WKB probe target:** `ki_home.v18_wkb_fixture.geom` — note: declared `WKT` (text-type), NOT WKB-binary; runner could not exercise the WKB code path
**Click point:** lon=-73.95, lat=40.75
**Confidence:** LOW (all probes failed; resolution = TECH DEBT — see Decision)

## Pre-spike runner-bug fix (commit d458408)

The first operator run of `npm run wkb-spike` (against the runner committed in `15714e3`) returned HTTP 400 on all three probes with the verbatim Kinetica error:

```
Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)
```

Root cause: `runSql()` in `kinetica_bi/server/src/wkbSpike.ts` sent only `{ statement, limit: 1 }` to `/execute/sql`, omitting the `encoding`, `offset`, `request_schema_str`, `data`, and `options` fields that the production SQL helper at `kinetica_bi/server/src/kinetica.ts:154-170` always sends. Kinetica rejected the requests at preprocessing — Probes A and B never reached SqlEngine and the `STXY_DISTANCE` / `ST_DISTANCE` function-name probes were never evaluated.

Commit `d458408` brings the spike runner's `/execute/sql` payload to full production-parity (`encoding: "json"` plus the other missing fields). The fixed runner is preserved for future re-runs.

The spike was NOT re-run after the fix because a second issue surfaced: operator's only WKB-shaped fixture column `ki_home.v18_wkb_fixture.geom` was declared with column type `WKT` (text), which Kinetica surfaces as a generic `GEO` type rather than the WKB-binary type Plans 18-02/18-03 must characterize. The operator confirmed they have no WKB-binary column reachable in their Kinetica account, so re-running the runner against the same fixture would not exercise the WKB code path.

## Probe A — STXY_DISTANCE direct on WKB column

**Probe SQL:**
```sql
SELECT STXY_DISTANCE(geom, -73.95, 40.75) AS dist
FROM ki_home.v18_wkb_fixture
ORDER BY dist ASC LIMIT 5
```

**HTTP status:** 400
**Response body (verbatim):**
```json
{
  "status": "ERROR",
  "message": "Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)",
  "data_type": "none",
  "data": "",
  "data_str": ""
}
```

**Status:** FAIL
**Failure reason (if FAIL):** runner-bug — Kinetica request preprocessing rejected for missing `encoding` parameter; probe never reached SqlEngine. Fix: commit `d458408` (pending re-run with real WKB column — see TD-V14-WKB-SPIKE).

## Probe B — ST_DISTANCE with ST_GEOMFROMTEXT wrapper

**Probe SQL:**
```sql
SELECT ST_DISTANCE(geom, ST_GEOMFROMTEXT('POINT(-73.95 40.75)')) AS dist
FROM ki_home.v18_wkb_fixture
ORDER BY dist ASC LIMIT 5
```

**HTTP status:** 400
**Response body (verbatim):**
```json
{
  "status": "ERROR",
  "message": "Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)",
  "data_type": "none",
  "data": "",
  "data_str": ""
}
```

**Status:** FAIL
**Failure reason (if FAIL):** runner-bug — Kinetica request preprocessing rejected for missing `encoding` parameter; probe never reached SqlEngine. Fix: commit `d458408` (pending re-run with real WKB column — see TD-V14-WKB-SPIKE).

## Probe C — GEODIST after STX/STY centroid extraction

**Probe SQL:**
```sql
SELECT GEODIST(STX(geom), STY(geom), -73.95, 40.75) AS dist
FROM ki_home.v18_wkb_fixture
ORDER BY dist ASC LIMIT 5
```

**HTTP status:** 400
**Response body (verbatim):**
```json
{
  "status": "ERROR",
  "message": "SqlEngine: No match found for function signature STX(<GEO>) (S/SDc:1513)",
  "data_type": "none",
  "data": "",
  "data_str": ""
}
```

**Status:** FAIL
**Failure reason (if FAIL):** Kinetica reached SqlEngine but rejected the column type — `STX(<GEO>)` signature not matched. Operator's fixture column `geom` was declared `WKT` (text), so Kinetica surfaced it as generic `GEO` type rather than the WKB-binary type the spike must characterize. Cannot conclude from this whether STX/STY would work on a true WKB column.

## Decision

**Chosen WKB SQL pattern:** NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)

**SQL template Plan 18-02 buildWkbQuery() will use:**
```sql
-- DEFERRED — see TD-V14-WKB-SPIKE; buildWkbQuery throws NotImplementedError until spike re-runs against a real WKB-binary column
```

**Reasoning:** The spike could not exercise the WKB code path. Two compounding issues blocked productive resolution:

1. The first run was tainted by a runner bug (missing `encoding: "json"` in the `/execute/sql` payload). Probes A and B failed at HTTP request preprocessing before SqlEngine ever evaluated the function signatures. Commit `d458408` fixes the runner.
2. The operator's only available fixture column (`ki_home.v18_wkb_fixture.geom`) was declared `WKT` (text), which Kinetica surfaces as generic `GEO` — not the WKB-binary type that Plans 18-02/18-03 must characterize. Probe C confirmed this when `STX(<GEO>)` returned a function-signature mismatch.

The operator confirmed (2026-05-08) that they have no WKB-binary column reachable in their Kinetica account, so a productive re-run against the fixed runner is not currently possible.

User decision (2026-05-08): defer SPATIAL-V14-03 to a future spike round once a WKB-typed column becomes reachable. The fixed runner (commit `d458408`) is preserved for that future re-run. Phase 18 will ship SPATIAL-V14-01 (lat/lon) and SPATIAL-V14-02 (WKT) only.

Plan 18-02's `buildWkbQuery` will throw `NotImplementedError("WKB mode deferred — TD-V14-WKB-SPIKE")` instead of producing SQL. Plan 18-03's `POST /api/info/query` endpoint will return HTTP 501 for `spatialMode === "wkb"` with a body referencing `TD-V14-WKB-SPIKE`. The function signatures stay exported for type stability so the endpoint can route by spatialMode without conditional imports.

**Downstream consequence:** NONE_ESCALATE chosen — Plan 18-02 buildWkbQuery throws NotImplementedError; Plan 18-03 returns 501 for wkb mode. Phase 18 ships partial scope (SPATIAL-V14-01 + 02 only). Re-run when a WKB-binary column becomes reachable.

## Caveats

- Runner bug (commit `d458408` fix) masked Probes A and B's true outcomes — we cannot conclude anything about whether `STXY_DISTANCE` or `ST_DISTANCE` would have worked against a real WKB-binary column.
- Fixture column type was `WKT` (text), not WKB-binary — Probe C's `STX(<GEO>)` mismatch result does not generalize to a true WKB-binary column.
- No re-run with a real WKB column was performed (operator has no WKB table reachable in their Kinetica account).
- The fixed runner (commit `d458408`) IS reusable — when WKB-table access becomes available, run `cd kinetica_bi/server && npm run wkb-spike` with corrected env vars (`WKB_PROBE_SCHEMA`, `WKB_PROBE_TABLE`, `WKB_PROBE_COLUMN`, `WKB_PROBE_LON`, `WKB_PROBE_LAT`) and update this file.

## Open Question Resolutions

- **OQ-1 (WKB function name):** BLOCKED → see Decision (NONE_ESCALATE → TECH DEBT). Re-run pending TD-V14-WKB-SPIKE.
- **OQ-2 (Wrapper required):** N/A — re-run pending TD-V14-WKB-SPIKE.
