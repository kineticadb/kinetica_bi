---
status: resolved
trigger: "Records Table widget renders column headers as column_1, column_2, column_3 instead of actual Kinetica table column names"
created: 2026-04-28T00:00:00Z
updated: 2026-04-28T13:08:00Z
resolved: 2026-04-28T13:08:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMED ROOT CAUSE — Kinetica ALWAYS returns positional keys (column_1, column_2, ...) in json_encoded_response. Real names are ALWAYS in a sibling "column_headers" array in the same parsed object. kinetica.ts forwards the entire decoded object including column_headers to the frontend. parseKineticaResponse uses Object.keys(columnar) which picks up column_1, column_2, etc. The fix is to use column_headers for remapping inside parseKineticaResponse.
test: COMPLETED — three empirical curl queries confirmed the response shape
expecting: Fix: in parseKineticaResponse, after getting columnar, check for columnar.column_headers (string[]). If present, remap column_N keys to the real names. Also the INFORMATION_SCHEMA query returns data in column_1 (not COLUMN_NAME key) — so the discovery effect's r.COLUMN_NAME lookup was always undefined. Discovery approach worked but was broken: it got the names into column_1 array, and the lookup r.COLUMN_NAME ?? r.column_name returned "" for every row.
next_action: Implement fix in parseKineticaResponse to use column_headers for remapping, and fix RecordsTableRenderer discovery parsing to use the remapped key name

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Records Table widget shows real column names (e.g., customer_id, name, email) as table headers
actual: Headers show column_1, column_2, column_3 etc.
errors: None visible. No JS errors. No HTTP errors. Backend audit log shows outcome: "success".
reproduction: Create Records Table widget, select data source (e.g., ki_home.customer), leave Columns empty, click Apply
started: After commit 5cdcafd, first time Records Table was tested. Two follow-up fix commits also failed.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: INFORMATION_SCHEMA discovery query (commit 7851b7c) would populate real column names
  evidence: User tested empirically, still showed column_# headers
  timestamp: 2026-04-28

- hypothesis: column_headers field in Kinetica response wrapper (commit 984b1fe) could be used for remapping
  evidence: User tested empirically, still did not show real column names; this commit has since been reverted
  timestamp: 2026-04-28

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-04-28T00:00:00Z
  checked: kinetica.ts lines 197-206
  found: Server unwraps body.data_str -> JSON.parse -> .json_encoded_response -> JSON.parse and returns "encoded ?? body". The column_headers field (if present) in data_str is discarded; only json_encoded_response is forwarded to the frontend.
  implication: If Kinetica puts column headers in data_str alongside json_encoded_response, that info is lost

- timestamp: 2026-04-28T00:00:00Z
  checked: WidgetRenderer.tsx parseKineticaResponse lines 30-91
  found: Function pivots columnar data using Object.keys(columnar) as column names. Line 66 has a commented-out attempt to use column_headers for remapping. If Kinetica returns column_1/column_2 as keys in json_encoded_response, those become the displayed headers.
  implication: The fix must either (a) prevent Kinetica from returning positional keys, or (b) intercept before/after parsing to remap them

- timestamp: 2026-04-28T00:00:00Z
  checked: RecordsTableRenderer INFORMATION_SCHEMA discovery effect (lines 486-513)
  found: Runs SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=... query. Maps result rows using r.COLUMN_NAME ?? r.column_name. Only uses cols if IDENT_RE passes. Then uses effectiveColumns as the SELECT clause: SELECT col1, col2, ... FROM table.
  implication: If Kinetica's INFORMATION_SCHEMA returns real column names, the SELECT should use them and Kinetica should return named keys. But this failed empirically — either the discovery query returns nothing, or Kinetica still returns positional keys even with explicit SELECT list.

- timestamp: 2026-04-28T01:00:00Z
  checked: curl GET /api/sql with SELECT * FROM ki_home.us_states LIMIT 1
  found: Response shape is {"column_1":[...], "column_2":[...], ..., "column_headers":["WKT","AFFGEOID",...], "column_datatypes":["geometry","string",...]}. Real names are in column_headers array alongside positional data keys. kinetica.ts already passes this through to frontend intact.
  implication: column_headers is always present in the response. The fix belongs entirely in parseKineticaResponse — remap column_N keys using column_headers before returning rows.

- timestamp: 2026-04-28T01:00:00Z
  checked: curl GET /api/sql with explicit SELECT NAME, STUSPS, STATEFP FROM ki_home.us_states LIMIT 2
  found: STILL returns column_1, column_2, column_3 keys — Kinetica always uses positional keys regardless of explicit column list. column_headers = ["NAME","STUSPS","STATEFP"].
  implication: The INFORMATION_SCHEMA discovery approach (commit 7851b7c) was doubly broken: (1) even if discovery succeeded and we issued SELECT col1, col2, Kinetica STILL returns column_1/column_2, and (2) the discovery effect's row parsing used r.COLUMN_NAME which was always undefined because the real data was at r.column_1 (before remapping was in place).

- timestamp: 2026-04-28T01:00:00Z
  checked: curl INFORMATION_SCHEMA query SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ki_home' AND TABLE_NAME='us_states' ORDER BY ORDINAL_POSITION ASC
  found: Returns {"column_1":["WKT","AFFGEOID","ALAND",...], "column_headers":["COLUMN_NAME"]}. The column names are in column_1, not in a key called COLUMN_NAME. The discovery effect code did r.COLUMN_NAME ?? r.column_name which is always "" because the key in each row object IS column_1 (as returned by parseKineticaResponse before any remapping fix).
  implication: The discovery effect was broken because it tried to access r.COLUMN_NAME on row objects whose key was column_1. With the parseKineticaResponse fix applied (remap via column_headers), the key in each row object will be "COLUMN_NAME" (from column_headers[0]), so r.COLUMN_NAME will work correctly. But this whole INFORMATION_SCHEMA path becomes unnecessary — the simpler fix is to just use column_headers in parseKineticaResponse for the data queries themselves.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: Kinetica ALWAYS returns positional keys (column_1, column_2, ...) in json_encoded_response regardless of the SELECT clause. The actual column names are always present in a sibling "column_headers" array (and "column_datatypes" is another sibling metadata key). The server (kinetica.ts) already forwarded the full decoded object including column_headers to the frontend, but parseKineticaResponse was ignoring column_headers and using Object.keys(columnar) — which gives column_1, column_2, etc. — as the row property names. The INFORMATION_SCHEMA discovery approach (commit 7851b7c) was doubly broken: (1) it ran an extra round-trip query, (2) even if it got column names, Kinetica STILL returned column_1/column_2 for the data query, and (3) the discovery result parsing used r.COLUMN_NAME which was undefined because the row key was also column_1 at that point.

fix: Modified parseKineticaResponse in WidgetRenderer.tsx to: (a) filter out metadata keys (column_headers, column_datatypes) from data iteration, (b) build a keyToName mapping using column_headers[idx] for each positional data key, (c) use real names when building row objects. Also removed the INFORMATION_SCHEMA discovery effect and its associated discoveredColumns state from RecordsTableRenderer — it was redundant and caused a double-fetch on every mount.

verification: Empirically simulated the fixed parseKineticaResponse logic against a live /api/sql response for SELECT * FROM ki_home.us_states LIMIT 1. Row keys are now [WKT, AFFGEOID, ALAND, AWATER, GEOID, LSAD, NAME, STATEFP, STATENS, STUSPS] instead of column_1..column_10. TypeScript compile check passes with zero errors.

files_changed:
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
