# Stack Research: v1.3 Unified Dashboard Filtering

**Domain:** Server-side transient materialized-view filtering for Kinetica BI
**Researched:** 2026-05-06
**Confidence:** MEDIUM (Kinetica DDL syntax confirmed from official docs; WMS-views compatibility requires operator spike)

---

## v1.3 Summary: What Changes vs What Stays

### Stays Unchanged (Zero Stack Delta)
The entire existing stack — React 18 + TypeScript + Vite, Express 4 + TypeScript, better-sqlite3, Zustand, OpenLayers 10 — does not change. No new npm packages are needed for v1.3.

### Changes (Code Modifications, Not New Dependencies)

| Layer | File(s) Modified | Nature of Change |
|-------|-----------------|-----------------|
| Backend endpoint | `server/src/index.ts` | New `POST /api/views/materialize-filter` route (net-new, not extending existing `/api/views/:id/materialize`) |
| DDL execution | `server/src/kinetica.ts` | Reuse existing `kineticaSql()` with `op: "MATERIALIZE"` — no changes to the helper itself |
| WMS URL builder | `src/lib/wmsUrlBuilder.ts` | Remove `QUERY` / `_v` params; `LAYERS` param now conditionally uses view name |
| Map renderer | `src/components/charts/MapChartRenderer.tsx` | Effect 3 calls new filter endpoint instead of `updateParams({ QUERY, _v })`; `buildWhereClause` import removed |
| Chart renderer | `src/components/charts/WidgetRenderer.tsx` | `AggregatedWidgetRenderer` uses `FROM <viewName>` swap instead of `injectWhereClause` |
| Filter store | `src/store/filterStore.ts` | Dead code deletion: `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` |
| Frontend API | `src/api/client.ts` | New `materializeFilter(tableId, filters)` client function; new `dropFilter(tableId)` |

---

## Kinetica DDL: Materialized View Syntax (v1.3 Core)

### Confirmed Syntax

Source: [Kinetica DDL Reference 7.1](https://docs.kinetica.com/7.1/sql/ddl/) — MEDIUM confidence (official docs, exact SQL syntax confirmed)

```sql
CREATE OR REPLACE MATERIALIZED VIEW [<schema>.]<view_name> AS
(
  SELECT * FROM <schema>.<source_table> WHERE <filter_clause>
)
USING TABLE PROPERTIES (TTL = 5)
```

The existing materialize endpoint in `index.ts:623` already uses this exact pattern without TTL:
```typescript
const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ${sourceTable}${whereClause}`;
```

v1.3 adds `USING TABLE PROPERTIES (TTL = 5)` to make it transient.

### TTL Semantics — Critical Finding

Source: [Kinetica TTL Concepts 7.1](https://docs.kinetica.com/7.1/concepts/ttl/) — HIGH confidence (official docs, explicit)

**TTL unit: minutes (not seconds).**

**TTL is SLIDING, not fixed.** The timer resets to the configured TTL value each time the view is accessed. This is architecturally important:
- If a user holds a filter and queries charts every few seconds, the view stays alive indefinitely
- If a user walks away for 5+ minutes, the view expires and is auto-dropped by Kinetica
- "Fixed 5-min TTL from creation" in the v1.3 architecture description is **inaccurate** — it is actually "5-min TTL from last access"
- For v1.3 this is actually better than fixed: active sessions keep their views alive; idle sessions clean up automatically

**On expiry:** Kinetica **auto-drops** the view. It does not become inaccessible-but-present; the table object is removed from the database.

**Default view TTL:** Views expire after the server's `default_ttl` setting (operator-configured) unless an explicit TTL is set. Setting `TTL = 5` overrides this, resetting on each access.

**TTL = -1** means never expires. **TTL = 0** means immediate expiration.

**PERSIST flag (for API path only):** The `/create/materializedview` REST endpoint has a `persist` option (true/false). The SQL DDL path does not expose this as a `USING TABLE PROPERTIES` key — TTL controls persistence implicitly (TTL > 0 = expires, i.e. not persisted).

### REFRESH Mode — Not Needed for v1.3

Source: [Kinetica Materialized View Feature Overview 7.1](https://docs.kinetica.com/7.1/feature_overview/create_materializedview_feature_overview/) — MEDIUM confidence

`REFRESH ON CHANGE` / `on_change` detects mutations to the source table and incrementally re-materializes. This is the API-endpoint refresh_method option, not a SQL DDL clause. For v1.3's use case (filter applied at creation time via WHERE clause; source table is read-only from the BI app's perspective), **no REFRESH mode is needed**. The view is re-created from scratch on each filter change via `CREATE OR REPLACE`.

### Complete v1.3 DDL Pattern

```sql
-- Create or update a filtered view (called on each filter change):
CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u17_d42_t9_s1aef AS
(
  SELECT * FROM demo.taxi_trips
  WHERE pickup_zone = 'East Village'
)
USING TABLE PROPERTIES (TTL = 5)

-- Drop when filters cleared (called on clearFilters):
DROP TABLE IF EXISTS _kbi_filt_u17_d42_t9_s1aef
```

Note: Kinetica uses `DROP TABLE` to drop materialized views, not `DROP MATERIALIZED VIEW`. The `IF EXISTS` clause is supported and prevents errors when the view has already expired via TTL.

---

## Kinetica View Naming Constraints

Source: [Kinetica Table Naming Criteria 7.1](https://docs.kinetica.com/7.1/concepts/tables/) — HIGH confidence (official docs)

| Constraint | Rule |
|-----------|------|
| Max length | 200 characters |
| First character | Alphanumeric or underscore (`_`) |
| Allowed characters | Alphanumeric, `_`, `#`, `{`, `}`, `[`, `]`, `(`, `)`, `:`, `-`, spaces |
| Schema qualification | Optional; defaults to user's default schema if omitted |
| Uniqueness | Must be unique within its schema (no collision with other tables or views) |

**`_kbi_filt_u17_d42_t9_s1aef` is valid:** Underscore prefix is allowed as first character, all other characters (letters, digits, underscores) are in the allowed set.

**Length check for longest plausible name:** `_kbi_filt_u99999_d99999_t99999_s1a2b3c4` = 40 characters — well within the 200-character limit.

**No reserved prefix detected** for underscore-leading names in Kinetica docs. The `_kbi_` prefix is a safe application namespace convention.

**Schema-unqualified view names** land in the creating user's default schema. If `demo.taxi_trips` is the source table and the user's default schema is `ki_home` or similar, the view `_kbi_filt_u17_d42_t9_s1aef` will be created there. This is fine — view names don't need to be in the same schema as the source table.

---

## WMS LAYERS Param: Views vs Tables — Unverified

Source: [Kinetica WMS REST API 7.1](https://docs.kinetica.com/7.1/api/rest/wms_rest/index.html) — LOW confidence (LAYERS docs reference "table names" only; views not explicitly mentioned)

The WMS LAYERS parameter docs state: "One or more comma-separated table names, each in `[schema_name.]table_name` format, using standard name resolution rules."

Materialized views are not explicitly mentioned as valid LAYERS values. However:
- Kinetica materialized views are implemented as a type of table internally (they are queried like tables via SELECT)
- The WMS endpoint resolves LAYERS via the same name-resolution as SQL FROM clauses
- The existing codebase already passes `schema.tablename` as LAYERS — the swap to `schema.viewname` (or unqualified `_kbi_filt_...`) uses the same format

**Verdict:** Likely works — Kinetica's WMS renders from any queryable object. But this **requires an operator spike** before v1.3 Phase 1 planning is locked. The spike is the first gate: issue a WMS GetMap with `LAYERS=<materialized_view_name>` against the deployed instance.

**If WMS LAYERS rejects view names:** the fallback is a SQL-to-image path (query the view, encode result as image server-side) — but this would be a significant architecture change. Spike first.

---

## Per-User Auth on Materialize DDL

Source: [Kinetica Security Concepts 7.1](https://docs.kinetica.com/7.1/security/sec_concepts/index.html), [Security SQL 7.1](https://docs.kinetica.com/7.1/sql/security/) — MEDIUM confidence (official docs; exact per-user create permission not fully documented)

### What is Confirmed

- `table_admin` on a schema = permission to CREATE, ALTER, DROP any table or view in that schema
- The creator of a materialized view automatically gets `table_admin` on the created view
- `CREATE OR REPLACE MATERIALIZED VIEW` executed via the user's own credentials will fail with a Kinetica permission error (HTTP 400 + `/access denied/i` body) if the user lacks DDL rights

### What Requires Operator Validation

Whether standard BI users (non-DBA) have DDL create rights by default is **not documented** in the public Kinetica security docs. Two deployment models are possible:

1. **Users have `system_write` or schema-level `table_admin`:** `CREATE MATERIALIZED VIEW` executes under the user's own creds — this is the intended v1.3 path (already supported by `kineticaSql(req, ddl, { op: "MATERIALIZE" })`)

2. **Users are read-only (no DDL rights):** `CREATE MATERIALIZED VIEW` would throw `KineticaPermissionError` (HTTP 400 + access-denied body). The existing `classifyHttpError` in `kinetica.ts:109` already handles this case correctly — it would surface as a 403 to the frontend.

### Existing Error Handling Already Covers the Failure Mode

`kinetica.ts` already has:
```typescript
// 400 + body.message matching /access denied|permission/i → KineticaPermissionError
if (body?.message && /access denied|permission/i.test(body.message)) {
  throw new KineticaPermissionError("Kinetica permission denied", 400);
}
```

This was specifically spike-verified for DDL in v1.0 Phase 2 (spike commit `2f81b7d`). The error chain maps to a 403 response to the frontend — the user sees a non-breaking error message rather than a silent failure.

**Operator action required before v1.3 Phase 1:** Verify that BI users have DDL permission to create views in their default schema, or determine if a service-account DDL path is needed.

---

## Existing Backend: Extend vs Net-New

### What Exists (Pre-v1.3)

The pre-existing `POST /api/views/:id/materialize` route (index.ts:613):
- Looks up a `dashboard_table_views` SQLite row by integer ID
- Reads `view.filter_clause` (a persisted string in SQLite)
- Issues `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ...`
- Updates SQLite `status` to `"created"` or `"error"`

This route is designed for **persisted, dashboard-scoped views** with manually-set filter clauses. It is **not** what v1.3 needs.

### What v1.3 Needs (Net-New)

v1.3 requires a **transient, session-scoped, filter-driven** endpoint:

```
POST /api/filter/materialize
Body: { tableId, dashboardId, filters: ActiveFilter[] }
Returns: { viewName: string, expiresApprox: number }

DELETE /api/filter/materialize
Body: { tableId, dashboardId }
Returns: 204
```

Key differences from the existing route:
- **Scoped to `(userId, sessionId, dashboardId, tableId)`** — view name is computed server-side from session + request context, never stored in SQLite
- **No SQLite row for the transient view** — view lives only in Kinetica; server maintains an in-memory map of `(userId, dashboardId, tableId) → viewName` at most, or recomputes the name deterministically
- **TTL = 5 in DDL** — auto-expiry via Kinetica; no background sweep needed
- **DROP on clear** — separate endpoint or `filters: []` convention triggers `DROP TABLE IF EXISTS`

The existing `POST /api/views/:id/materialize` stays unchanged — it serves the pre-existing dashboard-table-view CRUD workflow. v1.3 adds a parallel endpoint.

### Debounce Strategy: No New Library Needed

The v1.3 debounce is frontend-driven, not server-driven. The pattern:

```typescript
// In AggregatedWidgetRenderer / MapChartRenderer Effect 3:
const timerRef = useRef<ReturnType<typeof setTimeout>>();
useEffect(() => {
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    materializeFilter(tableId, dashboardId, tableFilters);
  }, 300);
  return () => clearTimeout(timerRef.current);
}, [filterVersion]);
```

This is identical to the 300ms debounce already used in `LayersModal`'s auto-save (v1.2). No `lodash.debounce` or other server-side debounce library is needed — `setTimeout` in the frontend effect is sufficient.

**Do not introduce:** `lodash`, `p-debounce`, or any server-side debounce queue. The server endpoint is idempotent (`CREATE OR REPLACE`) and lightweight.

---

## Frontend Integration Points

### View-Name → Widget SQL `FROM` Swap

Currently in `WidgetRenderer.tsx:AggregatedWidgetRenderer`:
```typescript
// CURRENT (v1.2 — to be deleted):
const whereClause = buildWhereClause(tableFilters);
const finalSql = injectWhereClause(sql, whereClause);
```

v1.3 replacement pattern:
```typescript
// v1.3 — view name swap:
const viewName = useFilterViewStore(s => s.views[tableId]);
const finalSql = viewName
  ? sql.replace(/FROM\s+[\w.]+/i, `FROM ${viewName}`)  // swap table ref
  : sql;  // no filters — use raw table
```

The FROM swap is simpler and safer than WHERE injection: no SQL parsing, no regex-on-GROUP-BY, no `escapeKineticaStringLiteral` needed. The view name is alphanumeric + underscore — no injection surface.

A new Zustand slice (`useFilterViewStore` or extending `useFilterStore`) tracks `{ [tableId]: viewName | null }`. The `materializeFilter` API call returns the view name; the store holds it.

### View Expiry Detection

**Do not implement a countdown timer.** Instead, detect expiry reactively:
- When a chart `runSql` call fails with a Kinetica error indicating the view does not exist, the existing `KineticaUpstreamError` → 502 path fires
- The frontend catches the error, clears the `viewName` from the store, and triggers a re-materialize on the next filter event (which will already fire if the user is actively clicking)

Alternatively, the server endpoint can return `{ viewName, ttlMinutes: 5 }` and the frontend uses `Date.now() + 5 * 60 * 1000` as an optimistic expiry timestamp — when a request is made past that timestamp, the client proactively re-materializes before issuing the chart query. This is simpler than reactive error handling.

**Recommended approach:** Optimistic `expiresAt` timestamp from the server. On each chart query, if `Date.now() >= expiresAt`, call `/api/filter/materialize` first. This avoids one round-trip failed query per expiry event.

### AbortController Reuse

The existing `AbortController` pattern in `AggregatedWidgetRenderer` (cancel in-flight fetch on filter change) applies unchanged to v1.3. The materialize call itself should also be abortable:

```typescript
const controller = new AbortController();
// cancel previous materialize call if filter changes again before server responds
await materializeFilter(tableId, dashboardId, filters, controller.signal);
```

The existing `runSql<T>(sql, options?, signal?)` signature in `src/api/client.ts` already threads `AbortSignal` — the new `materializeFilter` client function should follow the same pattern.

### WMS LAYERS Param Change in `wmsUrlBuilder.ts`

Currently `buildWmsParams` sets `LAYERS = config.tableRef` and conditionally appends `QUERY = whereClause`. In v1.3:

```typescript
// v1.3 wmsUrlBuilder.ts:
// LAYERS = viewName (when filtered) or tableRef (when not filtered)
// QUERY and _v params removed entirely
params.LAYERS = viewName ?? config.tableRef;
// Remove: params[FILTER_PARAM] = whereClause  ← DELETE THIS BLOCK
// Remove: _v: String(filterVersion)           ← DELETE THIS
```

The `_v` cache-buster is no longer needed because the LAYERS value itself changes when the view name changes — OpenLayers ImageWMS will re-request when params change, which happens naturally on `source.updateParams({ LAYERS: newViewName })`.

---

## What NOT to Add

| Temptation | Why to Reject | Use Instead |
|------------|---------------|-------------|
| `lodash.debounce` | Adds dep for a `setTimeout` | Use `setTimeout` in useEffect cleanup (already done in v1.2 LayersModal) |
| Server-side debounce / request queue | Server endpoint is idempotent; race between two concurrent materialize calls is harmless | Frontend-side debounce via useEffect timer |
| `REFRESH ON CHANGE` mode on view | View is a filter snapshot; source table mutated by Kinetica ingest, not BI app. ON CHANGE would cause constant re-materialize on busy tables | Re-create via `CREATE OR REPLACE` on each filter event |
| `PERSIST = true` on view | Persisted views survive DB restart; we want them cleaned up automatically | `TTL = 5` (sliding) handles cleanup without any server-side sweep |
| `DROP MATERIALIZED VIEW` syntax | Kinetica uses `DROP TABLE` for views | `DROP TABLE IF EXISTS <viewName>` |
| Second SQLite table to track transient views | Transient views are Kinetica-side state; duplicating in SQLite adds complexity with no benefit | Kinetica TTL is the authoritative cleanup; optional in-memory Map on server for the session |
| Per-layer in-memory view tracking | Each layer already has `table_id` — use `(sessionId, dashboardId, tableId)` as composite key | Deterministic view-name construction avoids needing to look up "what view did I create for this layer" |

---

## Spike Requirements Before Phase 1 Lock

These are items that cannot be answered from documentation and must be validated against the deployed Kinetica instance before architecture is finalized:

| Spike | Question | Consequence if No |
|-------|---------|-------------------|
| **S1 (P1 blocker)** | Does `LAYERS=<materialized_view_name>` return valid WMS tiles? | Entire map-filtering approach must be redesigned |
| **S2 (P1 gate)** | Do BI users have DDL permission to `CREATE MATERIALIZED VIEW` using their own credentials? | Need service-account DDL path or DBA grant |
| **S3 (P1 gate)** | Does `DROP TABLE IF EXISTS <viewName>` work without error when the view has already expired via TTL? | Must handle "table not found" errors on cleanup |
| **S4 (informational)** | What does the user's default schema resolve to? (Needed for unqualified view names in WMS LAYERS) | Must schema-qualify view names in LAYERS param |

S1 is the highest priority — if WMS rejects materialized view names in LAYERS, the architecture needs a different map-filtering approach before any code is written.

---

## Sources

- [Kinetica DDL Reference 7.1 — CREATE MATERIALIZED VIEW syntax](https://docs.kinetica.com/7.1/sql/ddl/) — MEDIUM confidence
- [Kinetica TTL Concepts 7.1 — TTL units (minutes, sliding)](https://docs.kinetica.com/7.1/concepts/ttl/) — HIGH confidence
- [Kinetica Materialized View Concepts 7.1](https://docs.kinetica.com/7.1/concepts/materialized_views/) — MEDIUM confidence
- [Kinetica Materialized View Feature Overview 7.1 — REFRESH modes](https://docs.kinetica.com/7.1/feature_overview/create_materializedview_feature_overview/) — MEDIUM confidence
- [Kinetica Table Naming Criteria 7.1 — max 200 chars, underscore allowed](https://docs.kinetica.com/7.1/concepts/tables/) — HIGH confidence
- [Kinetica WMS REST API 7.1 — LAYERS param format](https://docs.kinetica.com/7.1/api/rest/wms_rest/index.html) — LOW confidence (views not mentioned)
- [Kinetica WMS Feature Overview 7.1](https://docs.kinetica.com/7.1/feature_overview/wms_feature_overview/) — MEDIUM confidence
- [Kinetica Security Concepts 7.1 — table_admin permission for DDL](https://docs.kinetica.com/7.1/security/sec_concepts/index.html) — MEDIUM confidence
- Codebase: `kinetica_bi/server/src/index.ts` — existing materialize endpoint at line 613
- Codebase: `kinetica_bi/server/src/kinetica.ts` — `kineticaSql` helper, `classifyHttpError`, audit log
- Codebase: `kinetica_bi/src/lib/wmsUrlBuilder.ts` — LAYERS param construction, QUERY/cache-buster pattern to remove
- Codebase: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect 3 filter subscription, `updateParams` call to replace
- Codebase: `kinetica_bi/src/store/filterStore.ts` — dead code targets (`injectWhereClause`, `buildWhereClause`, etc.)

---
*Stack research for: Kinetica BI v1.3 Unified Dashboard Filtering*
*Researched: 2026-05-06*
