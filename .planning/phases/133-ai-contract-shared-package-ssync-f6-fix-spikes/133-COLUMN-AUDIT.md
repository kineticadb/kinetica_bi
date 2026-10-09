# Phase 133 Column Audit: client-supplied identifiers interpolated into SQL

**Method.** Enumerated at commit 1b31b24 (branch feat/ai-driven-dashboards) with
`grep -n "kineticaSqlHelper(\|kineticaSql(" packages/server/src/index.ts packages/server/src/lib/*.ts packages/server/src/*.ts` (44 hits across all files; 20 in index.ts, rest are definitions, comments, and lib helpers) and
`grep -c '${' packages/server/src/lib/{whereClause,spatialWhereClause,spatialQuery,exportSql,quantileSql,topValuesSql,columnStatsSql}.ts`
(counts: whereClause 9, spatialWhereClause 7, spatialQuery 10, exportSql 15, quantileSql 5, topValuesSql 6, columnStatsSql 7).
Each site was read at the shipped file:line (index.ts lines are at HEAD 1b31b24, not research numbers). "Snapshot" = `getTable(id).columns` (`Record<string,string>`, kept current by Schema Sync).

## Legend
- **CLIENT-COL**: column name from the request body, interpolated unquoted.
- **CLIENT-TABLE**: schema/table/view name from the request, interpolated unquoted.
- **SERVER-DERIVED**: name built from server state only (`buildFilterViewName`, `buildDynamicViewName`).
- **SERVER-HELD**: saved widget/dv config written by an authorised designer (e.g. export `cfg.columns`, `cfg.sortField`).
- **FREE-SQL**: whole statement/fragment is client or designer text by design (per-user Kinetica credentials are the boundary).
- **ADJACENT**: not a column site, but a related interpolation finding.
- **Tier A**: existence check against snapshot/probe. **Tier B**: structural `SQL_IDENT_RE` check, plus A when `(schema,table)` is a registered table. **Tier C**: record only.

## Sites

| # | File:line | Route / builder | Name source | Guard before 133 | Class / Tier | Fixed by (plan · task · test) | Status |
|---|---|---|---|---|---|---|---|
| 1 | lib/whereClause.ts via index.ts:1446 (`composeWhereClause`) | POST /api/filter/materialize table path (index.ts:1289) | `body.filters[].column` | none; header comment falsely claims server metadata | CLIENT-COL, A | 133-01 T3 · CG-FM1..8 | pending |
| 2 | lib/spatialWhereClause.ts via index.ts:1446 | POST /api/filter/materialize spatial target | `body.spatialTarget.lonCol/latCol/spatialCol` | none; only presence/mode coherence | CLIENT-COL, A | 133-01 T3 · CG-FM1..8 | pending |
| 3 | lib/whereClause.ts via index.ts (dv branch ~1331-1381) | POST /api/filter/materialize dv path | `body.filters[].column` | none; no registered snapshot (`columns_json` client-asserted) | CLIENT-COL, A (dv column source) | 133-09 · CG-DV1..4 | pending |
| 4 | lib/exportSql.ts:95-230 (`buildExportPlan`) via exportRoutes.ts | POST /api/exports | `spec.filters[].column`, `spec.sortField`, spatial cols; `cfg.columns`/`cfg.sortField` (SERVER-HELD) | shape only: `EXPORT_IDENT_RE` (exportSql.ts:23) | CLIENT-COL, A on table path; B-kept on dv path / unregistered `cfg.table` fallback | 133-02 · CG-OR1..2 | pending |
| 5 | lib/spatialQuery.ts via index.ts:2394,2418 | POST /api/info/query (index.ts:2260) | `body.spatialColumns.*`, `body.schema`, `body.table`, `body.viewName` | `typeof === "string"` only; `tableRow` used only as 404 guard | CLIENT-COL + CLIENT-TABLE, A (see finding below) | 133-02 · CG-OR3..7 | pending |
| 6 | lib/quantileSql.ts via index.ts:1576 | POST /api/quantile (index.ts:1535) | `body.schema`, `body.table`, `body.column` | non-empty string only | CLIENT-COL + CLIENT-TABLE, B (+A if registered) | 133-03 · CG-TB1..6 | pending |
| 7 | lib/topValuesSql.ts via index.ts:1627 | POST /api/top-values (index.ts:1589) | same | same | B (+A) | 133-03 · CG-TB1..6 | pending |
| 8 | lib/columnStatsSql.ts via index.ts:1659 | POST /api/column-stats (index.ts:1639) | same | same | B (+A) | 133-03 · CG-TB1..6 | pending |
| 9 | index.ts:1491 then 1516 | DELETE /api/filter/materialize `?viewName=` direct drop | `req.query.viewName` into `DROP TABLE IF EXISTS` | none | ADJACENT (not a column site) | 133-03 · CG-TB7..9 | pending |
| 10 | index.ts:2935 | POST /api/sql | whole statement | none by design | FREE-SQL, C | n/a (C) | n/a |
| 11 | index.ts:1944,1970, lib/dynamicViewSql.ts | POST /api/dynamic-view/preview | `body.template_sql` | `{view}` token only | FREE-SQL, C | n/a (C) | n/a |
| 12 | index.ts:2046-2213 | POST /api/dynamic-view/materialize | stored `template_sql`; names from naming helpers | server-derived | SERVER-DERIVED + stored FREE-SQL, C | n/a (C) | n/a |
| 13 | index.ts:1200 | POST /api/views/:id/materialize | stored `filter_clause`, `view_name` | RBAC `DASHBOARDS_EDIT` | stored FREE-SQL, C | n/a (C) | n/a |
| 14 | lib/exportSql.ts:145 | export `cfg.customWhere` | saved widget config | none (designer-authored) | FREE-SQL, C | n/a (C) | n/a |
| 15 | index.ts:2832-2857 | GET /api/kinetica/schemas[/:schema/tables[/:table/columns]] | path params in string literals | `'` doubled (correct for literals) | SERVER-ESCAPED literal, C | n/a (C) | n/a |
| 16 | index.ts:2893 | GET /api/wms | raw query string | none (Kinetica enforces) | passthrough, C | n/a (C) | n/a |
| 17 | index.ts:1516,2046,2181,2213 | DROP of names from `buildFilterViewName`/`buildDynamicViewName` | server-derived | n/a | SERVER-DERIVED, C | n/a (C) | n/a |

## Planning-time finding: info/query on dynamic-view layers

dv-bound map layers send `viewName` = the dv's own `_kbi_dv_*` view or a `_kbi_filt_*_dv<id>_*` view, whose columns (e.g. an H3 `WKT` projection) are NOT in the source table's snapshot. Tier A applies only when `viewName` is absent or is this table's own filter view (`_kbi_filt_u*_d*_t<tableId>_s*`); dv views get Tier B. Recorded so 133-02 does not break dv-layer info popups.

## Accepted residuals

(a) Tier-B sites accept a syntactically valid but nonexistent column on a VIEW (no snapshot; Kinetica returns its own error). Accepted because views have no registered snapshot; a dv probe (Phase 139) could close it.
(b) Export dv path and unregistered `cfg.table` fallback are regex-only (`EXPORT_IDENT_RE` already present). Accepted: no anchor to check against; closable by the dv probe.
(c) info/query on dv views is regex-only, for the reason in the finding above. Closable in Phase 139 with the structured-spec output column list.
(d) SERVER-HELD `cfg.columns`/`cfg.sortField` are not membership-checked: written by authorised designers. The Phase 141 Keep path must validate AI-written config.

## Flags for later phases

- `customWhere` (registry `textarea` on 8+ widget types) must stay out of every AI allow-list (Phase 136).
- POST /api/sql is the raw passthrough the model must never reach (Phase 140).
- The column guard is snapshot-based, so the AI gateway (Phase 135) should reuse `assertColumnsExist` from `packages/server/src/lib/columnGuard.ts`.
