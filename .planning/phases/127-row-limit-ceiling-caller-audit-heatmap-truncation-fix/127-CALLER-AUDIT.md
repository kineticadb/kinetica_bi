# Phase 127 Caller Audit: runSql / kineticaSqlHelper / kineticaSql

**Method.** Enumerated by grep at commit ee5a604 (HEAD of feat/large-exports before this document):
`grep -n "kineticaSqlHelper(\|kineticaSql(" packages/server/src/index.ts packages/server/src/lib/*.ts` and
`grep -rn "runSql(" packages/web/src` (non-spec). Each row was read at the shipped file:line (not RESEARCH's numbers).
Server hits: 21 (index.ts:2228 is a comment hit, excluded -> 20 real calls; grouped below into the rows listed).
Web call sites: 16 real `runSql(` calls (client.ts:302 is the definition, rowTruncation.ts / CalendarConfigPanel.tsx:108 are comments).
Table row count is >= these site counts (grouped rows list every line number).

## Legend
- **has-own-SQL-LIMIT**: the SQL carries its own LIMIT, bounded by design.
- **already-pins-extra.limit**: caller sets the envelope `extra.limit` explicitly.
- **needed-explicit-limit**: relied on an implicit envelope default; now pinned or otherwise fixed.
- **single-row/DDL**: returns no row data / one row; never needs more than one call.
- **latent-truncation (fixed by default; notice added)**: hit the old silent 1,000 cut; the 20,000 default fixes it, and a deploy-max cut now shows a "Limited to N" notice.

## Server call sites

| File:line | Caller / route | Rows asked | Class | Fixed by (plan · task · test) | Notes |
|---|---|---|---|---|---|
| kinetica.ts (kineticaSql envelope) | every caller | envelope limit | needed-explicit-limit (central) | 127-01 T2/T3 · ROWLIM-default, ROWLIM-clamp, ROWLIM-split-2 | 1,000 -> 20,000 default (KINETICA_MAX_ROWS_PER_QUERY), clamp, split by KINETICA_MAX_RECORDS_PER_CALL |
| kinetica.ts parseKineticaResponse / web METADATA_KEYS | /api/sql consumers | n/a | needed-explicit-limit | 127-01 T1 · RLMETA-1 | has_more_records / total_number_of_records no longer decoded as data columns |
| index.ts:2918 | POST /api/sql passthrough | client `options` | needed-explicit-limit | 127-01 T2 · ROWLIM-route-clamp | offset/limit spread last and clamped |
| index.ts:1193 | POST /api/views/:id/materialize (CREATE MATERIALIZED VIEW) | `extra.limit:1` | single-row/DDL | n/a | already-pins-extra.limit |
| index.ts:1499, 2029, 2164, 2196 | DROP TABLE IF EXISTS (materialize / dynamic view) | none | single-row/DDL | ROWLIM-ddl-single | |
| index.ts:1559 | POST /api/quantile | buildQuantileSql (n buckets) | has-own-SQL-LIMIT / small aggregate | n/a | |
| index.ts:1610 | POST /api/top-values | `LIMIT n` (topValuesSql.ts:53) | has-own-SQL-LIMIT | n/a | |
| index.ts:1642 | POST /api/column-stats | one aggregate row | single-row/DDL | n/a | |
| index.ts:1927 | dynamic-view preview `SELECT 1 ... LIMIT 0` | 0 | has-own-SQL-LIMIT | n/a | |
| index.ts:1953 | dynamic-view preview | `LIMIT sampleLimit` (index.ts:1903) | has-own-SQL-LIMIT | n/a | |
| index.ts:2052, 2077 | dynamic-view materialize COUNT(*) | one row | single-row/DDL | n/a | |
| index.ts:2377, 2401 | POST /api/info/query | SQL `LIMIT 50 OFFSET`, `extra.limit:50` | already-pins-extra.limit | n/a | |
| index.ts:2815 | GET /api/kinetica/schemas | INFORMATION_SCHEMA | needed-explicit-limit | 127-02 T1 · RLDISC-schemas | pins 20,000, warns on has_more |
| index.ts:2827 | GET /api/kinetica/schemas/:schema/tables | INFORMATION_SCHEMA | needed-explicit-limit | 127-02 T1 · RLDISC-tables | |
| index.ts:2840 | GET .../tables/:table/columns | INFORMATION_SCHEMA | needed-explicit-limit | 127-02 T1 · RLDISC-columns | |
| lib/materializedView.ts:37, 47, 48 | createOrReplaceMaterialized (DDL) | none | single-row/DDL | 127-01 · ROWLIM-ddl-single | MISSED by research; must never be re-issued by the split loop |

## Web runSql call sites

| File:line | Caller | Rows asked | Class | Fixed by (plan · task · test) | Notes |
|---|---|---|---|---|---|
| WidgetRenderer.tsx:677 | AggregatedWidgetRenderer (all aggregated charts incl. heatmap, bar multi-group-by) | chart LIMIT (heatmap Result limit up to 5,000; bar = baseLimit x series cap x 2 = 12,000 at defaults) | latent-truncation (fixed by default; notice added) | 127-06 T1/T2 · RLHM-wire-full-5000, RLHM-wire-server-cut, RLCHART-limited | Research said bar multi-group-by "max 500": wrong (see corrections) |
| WidgetRenderer.tsx:2055 | Records CSV download loop | PAGE 5000 until cap | needed-explicit-limit | 127-04 T1 · RLCSV-continue-on-has-more, RLCSV-ceiling-clamp | |
| WidgetRenderer.tsx:2188 | Records table page fetch | `LIMIT pageSize` (unbounded number input) | latent-truncation (fixed by default; notice added) | 127-04 T2 · RLREC-limited | |
| WidgetRenderer.tsx:2262 | Records total count | one row | single-row/DDL | 127-04 T1 · RLCSV-count-cw | previously omitted customWhere |
| TimelineRenderer.tsx:311 | time range probe | one row | single-row/DDL | n/a | |
| TimelineRenderer.tsx:347 | top-N series probe | small LIMIT | has-own-SQL-LIMIT | n/a | |
| TimelineRenderer.tsx:367 | ungrouped Timeline main | byte-locked SQL | latent-truncation | 127-05 · RLD16-tl-* | deploy-max notice only |
| TimelineRenderer.tsx:413 | grouped Timeline main | own limit + overflow probe | latent-truncation | 127-05 T1 · RLD16-tl-* | |
| NumericLineRenderer.tsx:288 | range probe | one row | single-row/DDL | n/a | |
| NumericLineRenderer.tsx:323 | top-N series probe | small LIMIT | has-own-SQL-LIMIT | n/a | |
| NumericLineRenderer.tsx:343 | ungrouped Numeric Line main | byte-locked SQL | latent-truncation | 127-05 T2 · RLD16-nl-* | deploy-max notice only |
| NumericLineRenderer.tsx:391 | grouped Numeric Line main | own limit + overflow probe | latent-truncation | 127-05 T2 · RLD16-nl-* | |
| CalendarRenderer.tsx:333 | Calendar cells | CELL_LIMIT (+1 probe) | latent-truncation | 127-05 T3 · RLD16-cal-* | |
| CalendarConfigPanel.tsx:288 | Calendar range probe | one row | single-row/DDL | n/a | |
| useViewKeepAlive.ts:97 | `SELECT 1 ... LIMIT 1` | 1 | has-own-SQL-LIMIT | n/a | |
| cardinalityProbe.ts:28 | `SELECT COUNT(DISTINCT col)` | one row | single-row/DDL | n/a | MISSED by research |

## Corrections to prior research
- MISSED: `packages/server/src/lib/materializedView.ts:37,47,48` (DDL via kineticaSql; never re-issued by split loop, ROWLIM-ddl-single).
- MISSED: `packages/web/src/lib/cardinalityProbe.ts:28` (single row).
- MISCLASSIFIED: aggregated multi-column bar group-by is not "max 500": ChartConfigPanel.tsx:441 sends `LIMIT baseLimit x maxBarGroupBySeriesCap x 2` (12,000 at defaults). Silently cut at 1,000 before; fixed by the 20,000 default; deploy-max cut shows `chart-limited-note` (127-06 T2).
- Records total-count query omitted `customWhere` (fixed 127-04 T1, RLCSV-count-cw).
- Observation, not fixed (out of scope): POST /api/sql spreads client `options` into the envelope, so a client can override `statement`/`encoding`; offset/limit are now spread last and clamped (127-01).

## Open / deferred
- Row-order stability across split kineticaSql calls without a unique ORDER BY is undocumented by Kinetica: checked live in 127-07 Task 2 step 4, re-checked by Phase 128's spike.

## Cited-test grep verification (hits across packages/*/src and packages/*/tests)
ROWLIM-default 1, ROWLIM-clamp 2, ROWLIM-split-2 1, ROWLIM-route-clamp 1, ROWLIM-ddl-single 1, RLDISC-schemas 1, RLDISC-tables 1, RLDISC-columns 1, RLCSV-continue-on-has-more 1, RLCSV-ceiling-clamp 1, RLREC-limited 1, RLCSV-count-cw 1, RLHM-wire-full-5000 1, RLHM-wire-server-cut 1, RLCHART-limited 1, RLD16-tl- 7, RLD16-nl- 7, RLD16-cal- 4, RLMETA-1 1. All >= 1.
