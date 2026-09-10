# Phase 62: Server — Materialize From DV View - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Source:** v1.12 bug diagnosis (this session) + server-code trace

<domain>
## Phase Boundary

**Delivers:** Extend `POST /api/filter/materialize` (and its `DELETE`) so it can build a filtered sub-view of a **dynamic view's own materialized view** — `CREATE OR REPLACE MATERIALIZED VIEW <dv-filter-view> AS SELECT * FROM <dv_view> WHERE <filters>` — instead of always filtering the source table. This is the ONE server-side piece of the v1.12 dv-drill-down fix (DVDRILL-V112-03 server portion).

**SERVER-ONLY** (`packages/server`). NO frontend changes (the client wiring is Phase 63). NO new route — extend the existing endpoint. The table-source path stays byte-compatible (back-compat).

**Out of scope:** all client work (filter-store keying, drill dispatch, read-path swap, chips — Phase 63); spatial filtering on a dv source (spatial stays table-only this milestone → DVX-V2-01); editing the dv template.
</domain>

<decisions>
## Implementation Decisions (LOCKED / derived)

### Request contract (additive, back-compat)
- LOCKED: Add an optional `dynamicViewId?: number` to the `POST /api/filter/materialize` body. When PRESENT → the **dv path** (build `FROM <dv materialized-view name>`). When ABSENT → the EXISTING **table path** (`FROM <schema.table>`), unchanged.
- LOCKED: On the dv path, `tableId` is NOT required (relax the current `typeof tableId !== "number"` guard so the dv path requires `dynamicViewId` + `dashboardId` numeric instead). The client passes the dv's SQLite row id; the server derives the view name itself.
- LOCKED: The dv path is **column-filters only** (the `filters: ActiveFilter[]` body). Spatial (`spatialFilters`/`spatialTarget`) is NOT supported with `dynamicViewId` — reject the combination (spatial-on-dv is v2 / DVX-V2-01). Table-path spatial is unchanged.

### FROM source + view naming
- LOCKED: dv-path FROM source = `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` (already imported in index.ts at line 23; shape `_kbi_dv_u<u>_d<dash>_<dvId>`). This is the dv's materialized view — the same view the dv-bound widgets already read.
- LOCKED: The dv-FILTER view name must be DISTINCT from both the table-filter view (`_kbi_filt_u<u>_d<dash>_t<tableId>_s<s>`) AND the dv view (`_kbi_dv_..._<dvId>`). Extend `buildFilterViewName` (lib/viewNaming.ts) with an optional `dynamicViewId` that swaps the `_t<tableId>` segment for `_dv<dvId>` → `_kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>`. (Keep the table-path output byte-identical when dynamicViewId is absent.)
- LOCKED: Reuse `buildServerWhereClause(filters)` (lib/whereClause.ts:86) for the WHERE — the filters reference the dv's PROJECTED columns (a dv can rename/aggregate; the clicked column is a dv column, not necessarily a source-table column). Reuse `createOrReplaceMaterialized` (lib/materializedView.ts) for the DDL + TTL + race-retry. Return the bare unqualified view name (mirrors the table path; S4 outcome).

### Validation + fail-safe (dv path)
- LOCKED: `dynamicViewId` + `dashboardId` numeric; empty-filters → 400 (use DELETE to clear), mirroring the table path. Reject `dynamicViewId` + spatial together → 400.
- LOCKED: The dv row must exist (`db.ts` getDynamicView(id) — `SELECT * FROM dashboard_dynamic_views WHERE id = ?`, db.ts:724) and belong to `dashboardId` → 404 otherwise (same-dashboard scoping).
- DECISION (planner): if the dv's materialized view doesn't exist yet (dv not materialized / over-threshold), `CREATE ... AS SELECT FROM <dv_view>` will fail at Kinetica. The client (Phase 63) gates on the dv's materialized status before calling, but the server must fail SAFE — surface a clear typed error (let the Kinetica "object not found" bubble through asyncHandler → errorMiddleware, OR add a guard). Do NOT 500 with an opaque message. Stateless re views (no SQLite writes for filter views; TTL=5 is sole cleanup) — unchanged.

### DELETE
- LOCKED: `DELETE /api/filter/materialize` (index.ts:994) gets the same `dynamicViewId` branch → drops the dv-filter view (`buildFilterViewName({..., dynamicViewId})` → DROP). Table path unchanged.

### Invariants preserved
- No new route; no new SQLite table; stateless re filter views; the endpoint stays the only filter-materialize surface. `AggregatedWidgetRenderer` remains the SOLE client caller (Phase 63). Server vitest = SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION — never a fixed pass-count); server tsc clean as a separate gate. ZERO changes under `packages/web` this phase.
</decisions>

<canonical_refs>
## Canonical References (read before planning/implementing — all under packages/server/src)

- `index.ts` — `POST /api/filter/materialize` handler (lines ~893-992: body contract, validation steps 1-5, table lookup + `tableRef`, `buildFilterViewName` call, `createOrReplaceMaterialized`); `DELETE /api/filter/materialize` (lines ~994+). `buildDynamicViewName` already imported (line 23) + used by the dv-materialize route (~1521) — reuse it.
- `lib/viewNaming.ts` — `buildFilterViewName({ username, sessionId, dashboardId, tableId })` (~57-60); `sanitizeForViewName` (~37). EXTEND with optional `dynamicViewId`.
- `lib/dynamicViewName.ts` — `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` (~22-24) → `_kbi_dv_u<u>_d<dash>_<dvId>`. The dv FROM source.
- `lib/materializedView.ts` — `createOrReplaceMaterialized` (CREATE OR REPLACE + TTL + race-retry DROP/CREATE). Reuse verbatim.
- `lib/whereClause.ts` — `buildServerWhereClause(filters)` (~86), `escapeKineticaStringLiteral` (~63). Reuse for the dv WHERE.
- `db.ts` — `dashboard_dynamic_views` table (~119); dv-row lookup `SELECT * FROM dashboard_dynamic_views WHERE id = ?` (~724) — use the existing getter (e.g. getDynamicView).
- Tests: `tests/routes.filter-materialize.spec.ts` (the materialize supertests to extend — table path + view-name + validation), `tests/routes.filter-materialize-spatial.spec.ts`, `tests/routes.dynamic-view.spec.ts` (dv fixture + the `createAdminSession`/session helper pattern). `tests/lib.materializedView.spec.ts` for the DDL builder.
</canonical_refs>

<specifics>
## Specific Ideas
- New supertests (extend routes.filter-materialize.spec.ts or add routes.filter-materialize-dv.spec.ts), BOTH auth modes: (1) dv path builds `FROM <buildDynamicViewName(...)>` with the WHERE from filters; (2) dv-filter view name shape `_kbi_filt_u..._dv<dvId>_s<s>` (distinct from table + dv view); (3) table path output byte-UNCHANGED when dynamicViewId absent (regression lock); (4) `dynamicViewId` for a missing/other-dashboard dv → 404; (5) `dynamicViewId` + spatial → 400; (6) empty filters on dv path → 400; (7) DELETE dv branch drops the dv-filter view.
- viewNaming.ts unit test: `buildFilterViewName` with dynamicViewId → `_dv<id>` segment; without → unchanged `_t<id>`.
- Gate: `cd packages/server && npx vitest run` SET-BASED (failing files ⊆ TD-V16-TEST-ISOLATION — assert the failing-file SET, never a pass-count); `npx tsc --noEmit -p packages/server/tsconfig.json` exit 0; `git diff --name-only -- packages/web` EMPTY (server-only phase).
</specifics>

<deferred>
## Deferred Ideas
- Spatial (bbox/lasso/circle) filtering of a dv source — DVX-V2-01 (table-only this milestone).
- Auto-materializing a not-yet-materialized dv on the server side — client gates on status (Phase 63); server just fails safe.
</deferred>

---

*Phase: 62-server-materialize-from-dv-view*
*Context gathered: 2026-06-15*
