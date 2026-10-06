# Phase 128 Spike Notes — Export Paging

- **Date:** 2026-10-06
- **Kinetica:** http://172.31.0.22:8082/gpudb-0 (no credentials in URL)
- **BI user:** admin (password mode)
- **Table:** `demo.nyctaxi`, COUNT = 500,000 (>= 50k, D-02). EXPORT_SPIKE_MAX_ROWS cap (2,000,000) NOT applied.
- **Script:** `packages/server/src/spikes/exportPagingSpike.ts` (`npm run export-paging-spike`). Evidence run id `f4bbfc2b`.
- An earlier aborted run (`a90db3f4`, my shell pipe closed it) died right after Q0 table discovery, before any object was created. Nothing to clean from it.
- Sort column for Q4: `vendor_id` (first column, non-unique, char4). 20 columns in the table.

## Q0 Table selection
Auto-discovery listed schemas (`demo` 1,500,724 rows total, `telecom`, `vaipr` ...); fell back to `demo.nyctaxi` and COUNT(*) = 500000.

## Q1 max_get_records_size
- `SHOW SYSTEM PROPERTIES WITH OPTIONS ('properties' = 'max_get_records_size')` returned an EMPTY result (`"column_1":[]`) — the property is NOT readable by this user/this way.
- Empirical: `SELECT * FROM demo.nyctaxi` with limit 100000 returned **20000** rows, `has_more_records=true`, `total_number_of_records=500000` (309 ms).
- CONFIRMED_MAX = 20000 (empirical); BATCH = 20000.

## Q2 paging_table on source, no ORDER BY
- 25 pages x 20000 = 500000 rows; has_more_records true on every non-last page, false on the last (`hasMoreSequenceOk: true`).
- Per-page ms first/mid/last: 228 / 224 / 219.
- **The `paging_table` field in the response was `""` (empty) on page 1, and there is no `result_table_list` key.** Raw envelope keys: `count_affected, response_schema_str, binary_encoded_response, json_encoded_response, total_number_of_records, has_more_records, paging_table, info`.
- Multiset duplicates = 2 (the source data itself contains 2 duplicated rows; the same 2 appear in every path).
- `total_number_of_records` on page 1 = 500000.

## Q3 Snapshot MV + request-level OFFSET + ORDER BY all columns
- `CREATE MATERIALIZED VIEW ... AS (SELECT * FROM demo.nyctaxi) USING TABLE PROPERTIES (TTL = 30)`: **243 ms for 500000 rows**.
- `SELECT COUNT(*)` on the MV twice: 500000, 500000 (equals source COUNT).
- 25 pages, total 500000, has_more sequence correct. Per-batch ms first/mid/last: 516 / 713 / 815 (grows with offset: the full-column sort is re-done per call).
- Multiset H_pg == H_off: **true**; both totals 500000 == COUNT. Duplicate rows 2 (same as source).

## Q4 paging_table on MV WITH ORDER BY vendor_id
- 500000 rows == COUNT(mv); `vendor_id` non-decreasing across ALL rows including page boundaries (0 violations); has_more sequence correct; ms first/mid/last 272 / 261 / 342.
- Caveat: because Q2 showed the paging_table option is not producing a table (see Q5), this is effectively request-level OFFSET over a re-executed ORDER BY with a non-unique key; it passed here on a static table, but non-unique ORDER BY is not a documented determinism guarantee, hence the composite ORDER BY in the offset design.

## Q5 Durability + TTL
- pg3 (`paging_table_ttl "1"`) page 1: 20000 rows, has_more true.
- **A paging table is NOT SQL-queryable**: `SELECT COUNT(*) FROM <pg3>` -> `SqlEngine: Object '..._pg3' not found`. Combined with the empty `paging_table` field and missing `result_table_list`, there is no evidence any paging table was ever created by `/execute/sql` with this option.
- After a 90 s wait (TTL was 1 minute) page 2 of the same statement/paging_table still returned 20000 rows, has_more true, 283 ms. This is consistent with the server simply re-executing the statement per call; it proves nothing about paging-table durability.
- `ttlmv` (MV with `TTL = 1`, created at the same time): **gone** after the 90 s wait. MV TTL self-expiry works (both created objects verified absent by `SELECT COUNT(*)` error).

## Q6 Cleanup behaviour
- `DROP TABLE IF EXISTS <pg1>` -> success; afterwards `SELECT COUNT(*) FROM <pg1>` -> `Object not found` (but pg1 never visibly existed; the drop is a no-op for it).
- `DROP TABLE IF EXISTS <never created>` -> success (idempotent).
- A small result (`LIMIT 5`) with a paging_table name: 5 rows, `paging_table` field empty, no table exists. Paging table is not created for small results either.

## Q7 (D-04a) Split-call order WITHOUT ORDER BY
A = one call of 20000 (`KINETICA_MAX_RECORDS_PER_CALL=20000`); B1..B3 = 4 calls of 5000 each (`KINETICA_MAX_RECORDS_PER_CALL=5000`). Positional hash sequence comparison: B1, B2, B3 all **identical** to A (firstDiff -1, 20000 rows each). Verified on a static single-table `SELECT *`, three repeats. Not a documented guarantee; does not cover joins/aggregations/concurrent writes.

## Q8 (D-04b) KINETICA_MAX_RECORDS_PER_CALL above server max
`KINETICA_MAX_RECORDS_PER_CALL=40000`, `KINETICA_MAX_ROWS_PER_QUERY=60000`: two kineticaSql runs each returned 60000 rows (expected 60000), 2 duplicate rows (source data), warning logged exactly **1** time ("exceeds this Kinetica server's max_get_records_size (a call asking for 40000 rows returned 20000 with has_more_records=true)"). Server silently caps a per-call limit at 20000 and has_more_records drives correct continuation.

## Q9 Value types (for Phase 131)
column_datatypes: `char4, timestamp, timestamp, int8, float, float, float, int16, char1, float, float, char16, float, float, float, float, double, float, int8, boolean`. First row: `["YCAB",1429658222000,1429659614000,1,5.5,-73.98091,40.741055,1,"N",-73.929,40.7759,"Cash",20.5,0.5,0.5,3,0,24.8,0,1]` — timestamps are epoch milliseconds (numbers), boolean comes back as `1`, floats are JS numbers (float32 precision visible in values like -73.98091).

## Decision matrix

| Criterion | paging_table | snapshot MV + OFFSET |
|---|---|---|
| Exact rows (count + multiset) | inconclusive (rows exact, Q2/Q3, but no paging table exists; this is plain re-execution) | pass (Q3: 500000, multiset equal) |
| has_more_records last=false / others=true | pass (Q2) | pass (Q3) |
| ORDER BY preserved across pages | pass on static data (Q4), same mechanism as offset | pass (Q3 composite order, Q4 style) |
| Readable after the wait | inconclusive (Q5: reads work, but not from a paging table) | pass (MV TTL 30 min; page re-reads independent of a paging table) |
| DROP works | fail (nothing to drop: no paging table created, Q6) | pass (MV dropped, gone afterwards) |
| TTL self-expiry | fail (no paging table object exists to expire, Q5) | pass (TTL=1 MV expired within 90 s, Q5) |

## Decision

**Chosen mechanism:** offset
**Confirmed max_get_records_size:** 20000 (empirical)
**has_more_records is the exhaustion signal:** verified (every non-last page true, last page false in Q2/Q3/Q4; ends exactly at COUNT)
**paging_table_ttl units/format:** not applicable — option accepted without error as string minutes ("30"/"1") but no paging table is created (empty `paging_table`, no `result_table_list`, not queryable)
**Cleanup statement:** DROP TABLE IF EXISTS <name> (also drops materialized views; verified by leftover check)
**Snapshot MV creation time:** 243 ms for 500000 rows
**D-04a (split-call row order without ORDER BY):** verified
**D-04b (KINETICA_MAX_RECORDS_PER_CALL above server max):** verified

Rule applied (D-03): paging_table requires exact rows AND correct has_more AND ORDER BY preserved AND readable after the wait AND DROP works. The paging_table path cannot be shown to create any table on this instance, so DROP/TTL are not demonstrable; `offset` is chosen. Performance note: offset paging with full-column ORDER BY costs 516 -> 815 ms per 20000-row page at 500k rows (sort repeated per call), about 3x the unordered page time; acceptable but grows with table size.

## Planned runner design (for operator review)
The runner ALWAYS builds a job-private snapshot MV `_kbi_exp_<id8>` (`SELECT * FROM <source> WHERE <filters> AND (<customWhere>)`, TTL = EXPORT_VIEW_TTL_MINUTES default 60), takes `total_rows` from `SELECT COUNT(*) FROM` that MV (D-07), and then pages the MV with the chosen mechanism: offset: `ORDER BY <user sort>, <remaining exported columns>` per D-05/D-06 (request-level offset/limit, batch <= 20000, stop on has_more_records !== true). Rationale: the COUNT then checks the paging mechanism instead of trusting the paging response's own total (a circular check), and snapshot semantics do not depend on the mechanism. The MV is dropped on completion/cancel/failure; its TTL is the crash backstop.

## Phase 127 follow-ups (record only, not fixed here)
- D-04a verified and D-04b verified: no impact found on Phase 127's batch-split path. Caveat to keep in mind: the order-stability result is empirical for a single static table `SELECT *` only; Phase 127's records-CSV path without a unique sort remains undocumented behaviour in Kinetica.
- The `SHOW SYSTEM PROPERTIES ... max_get_records_size` probe returns empty for this user; the server max can only be learned empirically (20000).
- Source table `demo.nyctaxi` contains 2 fully duplicated rows; multiset checks must compare counts, not sets.

## Questions for the operator
- **Q-A:** Approve `**Chosen mechanism:** offset` (snapshot MV + request-level OFFSET + composite ORDER BY)? paging_table could not be shown to create any table.
- **Q-B:** Approve "snapshot MV in both paths" (the Planned runner design above): job-private MV, `total_rows` from COUNT(*) on the MV, then paging the MV?
- **Q-C (hidden columns):** CONTEXT D-08 says hidden columns are excluded, but research found the records table has NO hidden-column concept. The export will contain exactly `cfg.columns` (IDENT_RE-filtered) in that order, or every column in Kinetica schema order when `cfg.columns` is empty. Confirm, or describe where hidden columns come from.
- **Q-D (widget actions):** The records table renders `widget.config` merged with runtime widget-action overrides (`useWidgetActionStore.widgetOverrides`, WidgetRenderer.tsx:346-349). The export rebuilds SQL only from the PERSISTED widget config (no client-sent SQL), so a column/customWhere change applied by a widget action is NOT reflected. Is that acceptable for Phase 128 (Phase 131 follow-up otherwise)?

## Cleanup
All objects created by evidence run `f4bbfc2b`, each dropped in the script's `finally` with `DROP TABLE IF EXISTS`, then verified by `SELECT COUNT(*)` (all returned `Object ... not found`):

| Object | DROP result | Leftover check |
|---|---|---|
| `_kbi_exp_spike_f4bbfc2b_pg1` | dropped | gone |
| `_kbi_exp_spike_f4bbfc2b_mv` | dropped | gone |
| `_kbi_exp_spike_f4bbfc2b_pg2` | dropped | gone |
| `_kbi_exp_spike_f4bbfc2b_pg3` | dropped | gone |
| `_kbi_exp_spike_f4bbfc2b_ttlmv` | dropped (had already TTL-expired) | gone |
| `_kbi_exp_spike_f4bbfc2b_small` | dropped | gone |

Run `a90db3f4` created no objects (aborted during Q0). No base tables were modified.

## Operator decisions

**Approved:** yes — 2026-10-06

- **Q-A / Q-B (mechanism + runner design):** "Approve offset + MV". The operator approves `**Chosen mechanism:** offset`: a job-private snapshot MV, `total_rows = COUNT(*)` on the MV, then paging the MV with request-level OFFSET + `ORDER BY <user sort>, <remaining exported columns>`.
- **Q-C (hidden columns):** "Yes, configured columns". There is no hidden-column setting. The export contains exactly the widget's configured columns (`cfg.columns`, IDENT_RE-filtered) in order, or all columns in schema order when none are configured.
- **Q-D (widget-action overrides):** "Phase 131 follow-up". Not reflected in the Phase 128 export, which is acceptable here. Follow-up: decide when the Phase 131 trigger UI is built (e.g. the client could send validated overrides alongside filters).
- D-04a/b came out verified, so there are no Phase 127 follow-up fixes.

### Noted risks (accepted, not blocking)
1. Per-page time grows with the full-column composite sort repeated on each call (516 -> 713 -> 815 ms first/mid/last over 25 x 20k pages). Very large exports (e.g. 10M rows, about 500 pages) may run long. Phase 130/131 may want to surface progress/ETA or revisit this.
2. The spike ran as `admin`. The offset path requires the exporting user's credentials to CREATE MATERIALIZED VIEW. Users without that permission would fail at snapshot creation; the runner should classify that as a clear failure (`kinetica_error` with a readable message). Not tested as a non-admin user.

## Live runner smoke (Plan 128-07)

- **Date:** 2026-10-06. **Table:** `demo.nyctaxi` (independent `SELECT COUNT(*)` = 500000). **Mechanism in use:** offset (job-private snapshot MV + request-level OFFSET + composite ORDER BY), batch 20000.
- **Script:** `packages/server/src/spikes/exportRunnerSmoke.ts` (`EXPORT_SMOKE_TABLE=demo.nyctaxi npm run export-runner-smoke`). In-memory SQLite, temp EXPORT_DIR, credentials never printed. Source table read-only.
- **S1 complete: PASS.** status=complete, total_rows=500000, rows_written=500000 (= independent COUNT(*)), file_bytes=16636920, 10149 ms (about 49,266 rows/s, 25 pages, per-page 311-480 ms). Header line equals the configured 3 columns; CSV-aware record count = 500001 (= rows_written + 1). `SELECT COUNT(*)` on the snapshot after the run ERRORED (snapshot dropped by the runner).
- **S2 cancel: PASS.** Cancelled once rows_written reached 20000; final status=cancelled, no file in EXPORT_DIR for the job. The runner's own cleanup dropped the snapshot.
- **S3 session end: PASS.** deleteSession mid-export: status=session_expired, error_message "Export stopped: your session ended. Sign in and start it again.", rows_written=40000 < total_rows=500000, no file. The runner logged "cleanup of _kbi_exp_3a6ab67f skipped (SessionEndedError); its TTL will expire it", i.e. it made no further Kinetica call after the session ended (by design the runner cannot drop its snapshot without credentials; the 60-minute TTL is the backstop).
- **Leftover check:** the smoke's `finally` ran `DROP TABLE IF EXISTS` on `_kbi_exp_442c1a66`, `_kbi_exp_05f5ed53`, `_kbi_exp_3a6ab67f` (and the `_pg` names) and then `SELECT COUNT(*)` on each: all "gone". No `_kbi_exp_` object remains. The S3 snapshot (`_kbi_exp_3a6ab67f`) was dropped by the smoke, not by the runner.
- **NOT tested live:** "the underlying table changes during the job". The spike is read-only by decision D-02, so no writes were made to demo.nyctaxi. Structural guarantee instead: after snapshot creation every read (COUNT and all pages) comes from the job-private MV, which has REFRESH OFF by default per Kinetica docs; spike Q3 showed COUNT on the MV twice returning identical values. Source writes after the snapshot cannot reach the file.
- Also not tested: non-admin user lacking CREATE MATERIALIZED VIEW (accepted risk 2).
