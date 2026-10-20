# Phase 139: Session-Only Dynamic Views - Research

**Researched:** 2026-10-20
**Domain:** Server-compiled structured dynamic-view spec, ad-hoc Kinetica materialized views, session lifecycle/cleanup, AI gateway wiring, web read-path merge (WidgetRenderer + MapChartRenderer)
**Confidence:** MEDIUM-HIGH (code paths HIGH; Kinetica function behaviour MEDIUM; live-only behaviours listed as operator UAT steps)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 Follow dashboard filters, same as saved views.** An AI view's base source is `{view}` (the source table after active filters), so a click or AI filter on the base table narrows it and it re-materializes on filter change, exactly like a saved dynamic view. Keep (141) must be able to save it as a normal `dashboard_dynamic_views` row with no behaviour change.
- **D-02 Aggregated views can build unfiltered.** A view with group-by/aggregates builds over the unfiltered base if its *output* row count fits max_records. A non-aggregated row view keeps the existing rule: it shows "needs a filter" / "too many rows" until filters bring it under max_records.
- **D-03 Saved views get the same rule in this phase** so AI and saved views behave identically and Keep changes nothing. (Saved views are free SQL templates, so the rule is likely "output row count <= max_records" rather than detecting GROUP BY; that's up to the planner, but existing saved-view behaviour for non-aggregated templates must not regress.)
- **D-04 max_records:** a server env default (e.g. `AI_DV_MAX_RECORDS`) is the ceiling; the spec may ask for less, never more.
- **D-05 Over-threshold answer:** when an AI view is waiting for a filter or is over the threshold, the answer says so and offers a follow-up filter suggestion (e.g. "Filter to the last 30 days"). The widget shows the existing over-threshold state.
- **D-06 Spec shape:** one base table (read through `{view}`) + optional joins + columns + filters + group-by + aggregates + sort + limit. No raw SQL anywhere in the spec. An unknown table or column is rejected (live schema, per 136 repair/refuse rules).
- **D-07 Joins are in scope.** The operator was explicit: "Dynamic views can join multiple tables together using a materialized view. That is the benefit of it." This amends AISAFE-V20-04's field list (table, columns, filters, grouping, aggregates, sort, limit) to add joins; update REQUIREMENTS.md wording in this phase.
  - Up to N joined tables, env cap (e.g. `AI_DV_MAX_JOINS`), **default 2**.
  - INNER and LEFT only; equality keys only (`a.col = b.col`, one or more AND-ed pairs, type-compatible per the live schema). No cross joins, no expressions in ON.
  - Each joined table is read through its own current filter view when it has one, otherwise the raw table. The base table follows filters (D-01).
  - The user must have access to every joined table/column (per-op check, 135 D-16).
- **D-08 Join cost guard:** a row-count preflight before materialize, compared with max_records; the materialize is SQL-tagged so the existing tag -> find -> `/admin/alter/jobs` cancel can stop it on Cancel/timeout (S7: Kinetica has no statement timeout or cost estimate; abort alone does not cancel).
- **D-09 Aggregates:** count, count distinct, sum, avg, min, max, **plus median and percentiles** (operator chose the wider set). Research must confirm the Kinetica functions and their behaviour on GPU tables (approximate vs exact).
- **D-10 Time buckets:** group-by may be `{column, bucket: minute|hour|day|week|month|year}` on date/time columns only; compiled server-side.
- **D-11 No computed/derived columns:** columns, aggregates and time buckets only.
- **D-12 Limit:** optional; default = maximum = the view's max_records.
- **D-13 Same keep-alive as saved views:** standard `DEFAULT_VIEW_TTL_MINUTES` (5) TTL, touched by `useViewKeepAlive` while the dashboard is open. Explicit DROP on undo, revert, discard, dashboard switch and logout; the TTL is only the safety net for crashes and closed tabs.
- **D-14 Per-session cap:** env (e.g. `AI_DV_MAX_PER_SESSION`), **default 5**, counting AI views (not their filter re-materializations). Over the cap the gateway refuses with a clear message ("Remove a view first...").
- **D-15 Undo/revert drops at once; redo rebuilds** from the stored spec (same name pattern, new suffix). Frees the cap immediately.
- **D-16 Server restart:** startup sweep that lists views matching the AI name prefix and drops them; TTL covers anything missed. Verified by listing views in Kinetica. **Research flag:** views are created as the user; confirm what identity the server can use at boot to list/drop them. If none, record the gap and fall back to TTL-only for restart (do not quietly drop the criterion).
- Server-chosen names carry a session-scoped suffix so two tabs of the same user don't collide (research ARCHITECTURE option B); never `CREATE OR REPLACE` onto a real view; prefix-validated on drop.
- **D-17 Removing a view with dependents:** a widget/layer whose referenced columns all exist on the view's base table is repointed to that table; otherwise it is removed in the same answer. The answer lists what was repointed/removed; one undo restores all of it. No dangling references.
- **D-18 The AI may remove a saved dynamic view, session-only** (others still see it; it becomes real only at Keep). Consistent with 135 D-16; `dynamic_views:manage` is checked at Keep (141). Session removal must not drop materializations other users depend on.
- **D-19 Add/remove only, no `edit_dynamic_view` op.** "Change it" = add new view + repoint + remove old, within one answer.
- **D-20 Labelling:** a readable display name from the spec (e.g. "Trips by hour") plus an "AI" tag, like the AI filter chips, wherever the view name shows (widget source label, filter badges, the locked Dynamic Views list). The server-chosen Kinetica name is never shown.
- Carried forward: S1 (ad-hoc inline materialize as non-admin works; no dv row; column source `SELECT * FROM <view> LIMIT 0`); S7 (grants don't limit the user; all limits app-side); 135 D-16 (any `ai:use` user who can view the dashboard and access the tables may do session ops; edit rights at Keep); 134 D-08/D-15 (Dynamic Views editor locked during an AI session; leaving warns, then discards and runs cleanup hooks); 138 D-01/D-03 (filters are whole-source; dv-backed widgets filter via the dv filter slice); maps are a separate read path (FROM-swaps wire `MapChartRenderer`, both `buildWmsParams` sites + dep keys); filter badges read `filterCombinationStore`.

### Claude's Discretion
- Exact spec schema (zod) in `packages/shared`, and filter operators inside the spec (reuse the 138 filter operator set).
- Route shape for ad-hoc materialize (new route vs `dynamicViewDef` in `/api/filter/materialize`).
- How session AI views merge into `dynamicViewStore` / `useDynamicViewMaterializeChain` and the read sites.
- Exact env names and the over-cap / over-threshold message copy (follow 135's exact-message style).

### Deferred Ideas (OUT OF SCOPE)
- `edit_dynamic_view` op (change a view in place), not in AIACT-V20-07/08.
- Computed / derived columns and HAVING in the spec.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIACT-V20-07 | The AI can add a session-only dynamic view and point widgets or layers at it; map tiles follow. | Ad-hoc route + registry (Q6), merge point in `DashboardsPage` / chain hook (Q6), both `MapChartRenderer` `buildWmsParams` sites already read `useDynamicViewStore.views[layer.dynamic_view_id]` (works for negative ids once the store is populated), `add_widget`/`add_layer` need a `dynamicViewId` arg + allow-list carve-out (Q9). |
| AIACT-V20-08 | The AI can remove a dynamic view. | `remove_dynamic_view` fold + gateway-stamped dependents list, repoint/remove atomically in one turn entry (Q8). |
| AISAFE-V20-04 | AI dynamic views are a structured description (table, columns, filters, grouping, aggregates, sort, limit) that the server compiles to SQL. Model never submits raw SQL. (Amend to add joins, D-07.) | Spec schema + `compileAiDvSpec` (Q1, Q2, Q3, Q7); quoted identifiers, live-schema validation (existing `assertIdentifier`/`assertColumnsExist`/`liveSchema.describe`). |
| AISAFE-V20-06 | Temp Kinetica views are removed on undo, discard, dashboard switch, logout and server restart. | Registry table + drop route + hooks (Q5, Q6); finding that existing client logout DROP loops cannot work after explicit logout (Q5); startup sweep using persisted sessions (Q5). |
</phase_requirements>

## Summary

The existing dv machinery is almost entirely **id-keyed against a SQLite row** (`dashboard_dynamic_views`): materialize, drop, the dv branch of `/api/filter/materialize`, the chain hook's list, `WidgetRenderer`'s orphan check and the orchestrator's `dv:<id>` viz keys. Session views have negative temp ids and no row. The workable design is: (1) a new server-side registry + new ad-hoc routes that build a server-chosen name and compile the structured spec to a **valid saved-dv template over `{view}`**, reusing `substituteViewToken` and `createOrReplaceMaterialized` unchanged; (2) on the web, merge session views into the **single `dynamicViews` list** the chain hook returns (it already feeds `DashboardContext`, the orchestrator, `WidgetRenderer` orphan detection and the `dynamicViewStore`) so every existing read site, including both `MapChartRenderer` `buildWmsParams` sites and `useViewKeepAlive`, works with negative ids with almost no change.

Three findings change the plan and need explicit tasks. **(a)** Kinetica 7.2 documents **only `APPROX_MEDIAN(expr)` and `APPROX_PERCENTILE(expr, p)` (p 0..100, "within about 2%")**: there is no documented exact median/percentile, so D-09 ships as approximate and the answer copy must say so. **(b)** The **existing client DROP loops cannot drop anything on explicit logout**: `auth.logout()` awaits `POST /api/auth/logout` (which deletes the session row), and only then does `App.tsx` see `status === "unauthenticated"` and fire `dropDynamicView`, which then 401s. So AISAFE-V20-06's "logout" needs a **server-side drop inside the logout handler before `deleteSession`**, driven by a new SQLite registry (`ai_session_views`). **(c)** The server has **no service credential**, but sessions are persisted in SQLite (AES-GCM, 8 h) and `exportRunner.principalForSession(sid)` already rebuilds a user principal from them, so a **boot sweep can drop views as the owning user for every unexpired session**; expired sessions and expired OIDC access tokens fall back to the 5-minute TTL (state this gap plainly in the plan).

D-02/D-03 (aggregated views build unfiltered) is **not** a server-only change: the web chain hook has a local `nofilter + capped -> over_threshold/no_filter` fast-path (no HTTP) that would stop aggregated saved views ever reaching the server. The server list route must expose a derived `aggregated` flag (or the fast-path must go), and several existing specs that use the default GROUP BY seed template pin the old behaviour and must be rewritten deliberately (listed in Q4).

**Primary recommendation:** Build `compileAiDvSpec(spec, sources) -> { template, columns }` (pure, shared-testable) emitting a `{view}` template with quoted identifiers; add `POST /api/ai/dynamic-view/materialize` and `POST /api/ai/dynamic-view/drop` backed by an `ai_session_views` SQLite registry (name, sid, username, dashboard, nonce, temp id) that also powers the cap, logout drop and boot sweep; merge session rows into the chain's `dynamicViews`; make the gateway stamp dependents on `remove_dynamic_view`; and treat live Kinetica behaviours (APPROX_* in GROUP BY on GPU, DATE_TRUNC on timestamp, LIMIT-bounded preflight, DROP leak check) as an explicit operator UAT plan.

## Standard Stack

No new libraries. Everything is in-repo.

### Core
| Library / module | Version | Purpose | Why Standard |
|---|---|---|---|
| zod | already a dep (`packages/shared` uses `zod`, server tools use `zod/v4`) | `AiDvSpecSchema` in `packages/shared` | Same pattern as `aiOp.ts` / `aiFilter.ts`; `.strict()` objects, no SQL field |
| `lib/materializedView.ts` `createOrReplaceMaterialized` | in-repo | `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = n)` with 1078 race recovery | The shared path S1 validated; add optional `tag`/`signal` pass-through (default DDL text unchanged) |
| `lib/dynamicViewSql.ts` `substituteViewToken` | in-repo | `{view}` substitution + MissingViewTokenError | Guarantees the compiled body is a valid saved-dv template (Q7) |
| `lib/kineticaJobs.ts` `tagSql` / `cancelKineticaJobsByTag` | in-repo | Tag, find in `/admin/show/jobs` `query_text`, cancel via `/admin/alter/jobs` | S7.6 verified as non-admin; `kineticaSql` already has a `tag` option |
| `lib/columnGuard.ts` | in-repo | `assertIdentifier`, `assertColumnsExist`, `SQL_IDENT_RE` | Identifier trust earned by live/registered snapshot membership |
| `lib/ai/liveSchema.ts` `createLiveSchema().describe` | in-repo | User-credentialed column truth, `{ok:false}` for missing/inaccessible alike | AISAFE-V20-03 no-existence-leak behaviour |
| `lib/whereClause.ts` `buildServerWhereClause` | in-repo | Filter predicates | Interpolates `f.column` verbatim, so pass a pre-validated quoted, alias-qualified column (`t0."col"`); values go through `escapeKineticaStringLiteral` |
| `lib/exportRunner.ts` `principalForSession` | in-repo | Rebuild a user principal from a sid (no caching) | Precedent for boot/background work as the user |
| `better-sqlite3` via `db.ts` | in-repo | `ai_session_views` registry | Existing migration pattern (`CREATE TABLE IF NOT EXISTS` in schema script) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| New `/api/ai/dynamic-view/*` routes (recommended) | `dynamicViewDef` in `/api/filter/materialize` + `/api/dynamic-view/materialize` | Overloading the saved routes touches the heavily-pinned `routes.dynamic-view.spec.ts` and the dv filter branch. A separate route module keeps saved behaviour byte-unchanged; share the *helpers* (threshold gate, `createOrReplaceMaterialized`), not the handler |
| Registry table (recommended) | Derive names deterministically only | Deterministic names cannot support logout-drop-before-session-delete, boot sweep, or an authoritative cap without enumerating Kinetica. Registry is ~1 small table |
| Approximate percentile (only option) | exact via window functions / NTILE | `/api/quantile` uses NTILE bucket-MIN (an approximation too), not an exact percentile; exact percentile needs a sort + window and is not documented as an aggregate. Do not hand-roll |

**Installation:** none.

**Version verification:** no packages added. Kinetica docs checked are the 7.2 pages (docs.kinetica.com/7.2). The live instance version is not recorded in this repo; if it is not 7.2.x, re-verify Q1/Q2 on the live instance (see UAT).

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
  aiDynamicView.ts          # AiDvSpecSchema, AI_DV_BUCKETS, AI_DV_AGG_FNS, output-name rules (pure, no SQL)
  aiOp.ts                   # add_dynamic_view gets `name` + `spec`; remove_dynamic_view gets gateway-stamped dependents
packages/server/src/lib/
  aiDvCompile.ts            # compileAiDvSpec(spec, ctx) -> { template, columns, aggregated }   (pure)
  aiDvName.ts               # buildAiDynamicViewName / parseAiDynamicViewName (prefix-validated)
  aiSessionViews.ts         # registry CRUD, per-sid cap, dropViewsForSid(), sweepAiViewsOnBoot()
packages/server/src/
  aiDvRoutes.ts             # POST /api/ai/dynamic-view/materialize, POST /api/ai/dynamic-view/drop (registered next to registerAiRoutes)
packages/web/src/
  lib/aiDv/                 # sessionDvRows (derived DynamicViewRow[] from SessionDerived), materialize/drop client calls
  hooks/useDynamicViewMaterializeChain.ts   # takes sessionRows; branches materialize call by id sign
```

### Pattern 1: Compile to a saved-dv template (Q7)
**What:** The compiler's only output is `template` (a SELECT whose base is the literal `{view}` token) plus `columns` (output names/types) plus `aggregated`. The materialize route does exactly what the saved route does: `substituteViewToken(template, targetRef)` then `createOrReplaceMaterialized`. Phase 141 persists `template` as `template_sql` via the existing create path (`POST /api/dashboards/:id/dynamic-views` re-validates `{view}` presence; `columns_json` = `columns`).
**Template shape (illustrative; every identifier double-quoted, aliases `t0..tN` generated by the compiler, never model text):**
```sql
SELECT DATE_TRUNC('HOUR', t0."pickup_datetime") AS "pickup_hour",
       COUNT(*) AS "trips",
       APPROX_PERCENTILE(t0."fare", 90) AS "fare_p90"
FROM {view} AS t0
INNER JOIN fleet.zones AS t1 ON t0."zone_id" = t1."id"
WHERE t0."vendor" = 'x'
GROUP BY DATE_TRUNC('HOUR', t0."pickup_datetime")
ORDER BY "trips" DESC
LIMIT 5000
```
**Join sources (Q3):** `compileAiDvSpec` takes `resolveJoinRef(tableId) -> string`. The **persisted** rendering (what Keep saves) uses raw `schema.table` for joins. The **session materialize** rendering substitutes a joined table's filter-view name when that view currently exists. This means a saved view after Keep joins raw tables (see Open Question 1).
**Source:** project code (`dynamicViewSql.ts`, `materializedView.ts`); quoted-identifier acceptance verified live in 133 S7.5 (`UPPER quoted "VENDOR_ID"` works).

### Pattern 2: Server-chosen name, prefix-validated, registry-backed (Q6)
**What:** `_kbi_ai_u<sanitizedUser>_s<sid8>_n<nonce8>_<abs(tempId)>` where `sid8` = first 8 chars of the login sid (as filter views do), `nonce8` = per-AI-session random hex minted by the web `aiSessionStore` (regenerated on `reset()`), so two tabs of one user (same sid) cannot collide. The client sends `{dashboardId, nonce, tempId, spec}`, **never a name**. The server rebuilds the name from `(authed user, sid, nonce, tempId)`, validating `nonce` against `^[a-f0-9]{8}$` and `tempId` as a negative int. Drop accepts the same tuple (or a name that fully matches the regex built for the *caller's* user+sid). The 133 spike used `_kbi_ai_u<user>_s<sid8>_<n>`; the extra `_n<nonce>` segment is the tab-safe extension. Total length well under 200.
**Redo (D-15):** same name is safe (same prefix, own registry row, CREATE OR REPLACE onto an AI-owned name only); see Pitfall 3 for the in-flight race that makes a per-generation suffix attractive (`_g<n>` appended by the client store, validated `^\d{1,3}$`). Recommendation: include a generation counter so a late in-flight CREATE from before an undo can never collide with the rebuilt view's name.

### Pattern 3: Single merge point on the web (Q6)
**What:** `useDynamicViewMaterializeChain(dashboardId, widgets, sessionRows)` returns `dynamicViews = [...savedRows (minus session-removed), ...sessionRows]`. Everything downstream already consumes that list: `DashboardContextProvider` (orphan check at `WidgetRenderer.tsx` ~L557 uses `dashboardDynamicViews.some(dv => dv.id === dynamicViewId)`; without the merge a session-view-bound widget renders as **orphan**), `useCombinationOrchestrator(..., dynamicViews)` (creates the `dv:<id>` source-combination viz key from `dv.source_table_id`), `aiBaselineRef`/`aiSnapRef` snapshots, `LayersModal`/`WidgetConfigModal`. In the chain's `fireCascade`, branch on `dv.id < 0`: call the ad-hoc materialize with `combination_key = hash` instead of `materializeDynamicView(dv.id)`. `useViewKeepAlive` already keys every `dynamicViewStore.views` entry (including negative ids) by `viewName`, so D-13 keep-alive needs **no change**.
**Session row shape:** a `DynamicViewRow` with `id` = tempId, `dashboard_id`, `source_table_id` = `spec.base.tableId`, `name` = display name, `template_sql` = (client may hold only the spec; set to `""`), `max_records` = resolved max, `columns_json` = server-returned columns, plus an `ai: true` marker for the D-20 "AI" tag. Keep `columns_json` populated because chart column pickers and the gateway's `dynamicViewInfo` read it.

### Anti-Patterns to Avoid
- **Reusing `dropDynamicView(id)` for session views.** `POST /api/dynamic-view/:id/drop` does `getDashboardDynamicView(id)` and 404s a negative id; the existing DROP loops in `DashboardsPage.tsx` (~L811) and `App.tsx` (~L281) iterate **every** `dynamicViewStore.views` entry with `status === "materialized"` and would call it for negative ids, silently leaking the view. Filter `id > 0` there and add a separate session-drop path (or one helper used by both).
- **Letting the client send a view name or SQL.** The client sends the *validated spec* (the server re-validates shape, live schema and recompiles on every materialize); the name is rebuilt server-side.
- **`CREATE OR REPLACE` onto anything not produced by `buildAiDynamicViewName`.** Guard with the parse function before every DDL/DROP.
- **Setting `dynamicViewId: null` to unbind a repointed widget.** Renderers test `dynamicViewId !== undefined` (`WidgetRenderer.tsx` ~L489/L557), so `null` still reads as dv-bound. Use `undefined` in the in-memory overlay (spread keeps the key with value `undefined`, which reads as unbound) and never serialize the overlay.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Quoting / escaping values | string concat of model text | `escapeKineticaStringLiteral` + `buildServerWhereClause` with a pre-quoted `t0."col"`; types from `coerceAiFilterItem` | Same filter semantics/ISO-date handling as clicks and AI filters (138) |
| Identifier validation | regex per field | `assertIdentifier` / `AiIdentifierSchema` (`^[A-Za-z_][A-Za-z0-9_]*$`) + membership in the live describe | Trust is membership, not syntax |
| Job cancel | ad-hoc `/admin` calls | `tagSql` / `cancelKineticaJobsByTag` (+ `kineticaSql({tag})`) | S7.6 verified; tag regex `^[A-Za-z0-9-]{1,64}$` |
| Principal for background work | storing credentials | `principalForSession(sid)` | Never cached; throws `SessionEndedError` |
| View-column lookup | `columns_json` | `buildViewColumnsProbeSql` (`SELECT * FROM <view> LIMIT 0`) | S1 decision; `columns_json` is client-asserted |
| Percentile/median | NTILE/window self-rolls | `APPROX_MEDIAN` / `APPROX_PERCENTILE` | Only documented aggregates (Q1) |
| Temporal truncation | epoch arithmetic | `DATE_TRUNC('<UNIT>', col)` | Already used by the calendar chart on the app's time columns (Q2) |
| View-of-view dependency handling | custom | rely on Kinetica: "Dropping a table also drops dependent ... materialized views" | See Pitfall 6 |

**Key insight:** every individual capability already exists; the phase is wiring plus three genuinely new things: the spec compiler, the registry, and the removal-dependents fold.

## Answers to the Operator's Open Questions

### Q1. Median / percentile SQL (D-09) — MEDIUM
- Kinetica 7.2 "Math Aggregation Functions" documents `APPROX_MEDIAN(expr)` ("equal to `APPROX_PERCENTILE(expr, 50)`... within about **2%** of the true median") and `APPROX_PERCENTILE(expr, p)` (`p` between **0.0 and 100.0**). It also documents `COUNT(expr)`, `COUNT_DISTINCT(expr)` (exact), `APPROX_COUNT_DISTINCT`, `SUM`, `AVG`/`MEAN`, `MIN`, `MAX`, `STDDEV*`, `VAR*`. Source: https://docs.kinetica.com/7.2/sql/query/math-functions/ (fetched 2026-10-20).
- **There is no `MEDIAN`, `PERCENTILE`, `PERCENTILE_CONT` on that page** (I report "not documented in 7.2", not "does not exist"). Compile D-09 to `APPROX_MEDIAN` / `APPROX_PERCENTILE` only; **exact is not available** and the answer text must label them approximate (about 2%). Do not offer exact median.
- The docs page does not state GROUP BY or materialized-view behaviour or GPU-table behaviour, nor NULL handling for these. They are listed with the other grouped aggregates, but this is **unverified live**. Mark as operator UAT item U3. `percentile` spec form: `{fn: "percentile", column, p}` with `0 < p < 100` (reject 0/100 and non-finite; emit `Number(p)` literal, never a string). `median` = `{fn:"median", column}`.
- The app already emits `COUNT(DISTINCT col)` for count distinct (`buildNumericLineSql`, `WidgetRenderer`: "COUNT_DISTINCT is not a Kinetica function" comment in-repo), whereas the 7.2 docs list `COUNT_DISTINCT(expr)`. Keep the proven `COUNT(DISTINCT "col")`.

### Q2. Time-bucket compilation (D-10) — MEDIUM
- `DATE_TRUNC([part,] expr)` (alias `TIMESTAMP_TRUNC(part, expr)`); units `YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, MINUTE, SECOND, MILLISECOND`, case-insensitive. `TIME_BUCKET(width_ms, ts[, offset[, base]])` / `DATE_BUCKET(width_days, ds, ...)` are fixed-width alternatives (base default `2000-01-03`, a Monday). Source: https://docs.kinetica.com/7.2/sql/query/date-time-functions/. There is **no `DATETIME(...)` truncation function**; use `DATE_TRUNC`.
- All six D-10 buckets map to `DATE_TRUNC('MINUTE'|'HOUR'|'DAY'|'WEEK'|'MONTH'|'YEAR', "col")`. The unit string comes from a closed enum, never from model text. The same expression goes in SELECT and GROUP BY.
- The app already runs `DATE_TRUNC('<unit>', <timeCol>)` in the calendar chart (`buildCalendarSql.ts`), so the function is proven on the dashboard's time columns; `TimelineRenderer` uses `DATE_TRUNC`/FLOOR-epoch. I could not confirm from docs whether the result type for a `timestamp` (long ms with timestamp property) input is TIMESTAMP, nor the WEEK start day. Operator UAT U4.
- **Column typing trap (HIGH, from code):** `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` reports `bigint` for TIMESTAMP/DATE/TIME/DATETIME (see `lib/showTableTypes.ts`), so the live describe cannot tell a time column from a plain long. Decide "is this a date/time column" from the **registered table snapshot** (`Table.columns[col]` types `timestamp|date|time|datetime`, same set as `aiFilterDataTypeOf`), and still require the column to exist in the live describe. Rules: reject `time` columns; for `date` columns allow only day/week/month/year (sub-day buckets are meaningless); `timestamp`/`datetime` allow all six.
- Output column type for a bucket: record as `"datetime"` in the spec-derived columns; the web renders it through existing datetime handling. Confirm via the `LIMIT 0` probe in UAT.

### Q3. Joins (D-07/D-08) — HIGH for code, MEDIUM for preflight cost
- **How saved dvs reference other tables today:** they do not, structurally. A saved template is free SQL; only the `{view}` token is substituted (global replace) with the source table's current combination filter view or the base table. A joined table in a saved template is whatever `schema.table` text the author typed: no filter-view lookup exists. So "joined table via its own current filter view" is **net-new behaviour** in this phase.
- **How to compile it:** the server cannot compute a joined table's combination key (it is a client hash of filters+shapes). Either the client sends `joinFilterKeys: { [tableId]: combinationKey }` (computed with `dvSourceComboHash(tableId, filters[tableId], shapes)`, as the chain does for the base), and the server probes `SELECT 1 FROM <buildFilterViewName(tableId, combinationKey)> LIMIT 0` and falls back to `schema.table` on `isTableNotFoundError` (this is exactly the `/api/dynamic-view/preview` and materialize pattern). **Gap to state in the plan:** the orchestrator only materializes combination views for tables used by a widget/layer/dv-source viz key; a joined table with an active filter but no widget on it has **no filter view**, so the join silently reads the raw table. Recommend v1 = "use the filter view if it exists, else raw" (literally D-07), tell the operator, and do not extend the orchestrator unless asked (see Open Question 2).
- **Join rules to enforce server-side (live schema, per join):** INNER/LEFT only; `on` is a non-empty array of `{leftColumn, rightColumn}` pairs (left side may reference base or an earlier join alias by index, never an expression); both columns must exist in the live describe of their table; types must be compatible (both numeric via `isAiNumericColumnType`, or both datetime kind, or both string); every joined `tableId` must be on the dashboard (`dashboardTableIds`, same D-22 rule as `add_layer`) and describable by the user; cap `joins.length <= AI_DV_MAX_JOINS` (default 2).
- **Row-count preflight SQL (D-08):** with `body = substituteViewToken(template, targetRef)` and `cap = max_records`:
  ```sql
  SELECT COUNT(*) FROM (SELECT 1 AS x FROM (<body>) LIMIT <cap + 1>)
  ```
  The inner `LIMIT cap+1` bounds counting work if the engine short-circuits (not verified; U5) and still returns `cap+1` when over. Run via `kineticaSql(principal, sql, {route, op: "DYNAMIC_MATERIALIZE", tag, signal})` where `tag = "dv-" + requestId` (matches `^[A-Za-z0-9-]{1,64}$`). The statement is rewritten to `/* kbi-ai:<tag> */ SELECT ...` by `tagSql`.
- **Tag / find / cancel wiring (exportRunner/AI precedent):** `aiRoutes.ts` already does `res.on("close")` + hard deadline then `cancelKineticaJobsByTag(principalForSession(sid), tag)`. Mirror that in the ad-hoc materialize handler: on client abort (`res.on("close")` before `res.writableEnded`) and on a server deadline (new env `AI_DV_PREFLIGHT_TIMEOUT_MS`, default 30000), call `cancelKineticaJobsByTag`. Tag the preflight **and** the CREATE (extend `createOrReplaceMaterialized` args with optional `tag`/`signal`; when omitted the DDL string is byte-identical, which keeps `lib.materializedView.spec.ts` green). Timeout result: return an error (HTTP 504-style body) so the chain's existing `setError` + toast path handles it; do not invent a new over-threshold `reason` unless the web empty-state copy is also added.

### Q4. D-02/D-03 threshold change — HIGH (code read)
**Current behaviour** (`index.ts` ~L2075-2225, `POST /api/dynamic-view/materialize`): the gate compares the **source** row count to `max_records`, not the output:
1. Probe `SELECT COUNT(*) FROM <expectedFilterViewName>`. If the filter view exists: `row.max_records > 0 && rowCount >= row.max_records` -> `DROP stale` + `{status:"over_threshold", reason:"exceeds_max_records", row_count}`; else materialize against the filter view.
2. If the filter view is absent (`isTableNotFoundError`): `SELECT COUNT(*) FROM <baseRef>`; `row.max_records > 0 && baseCount >= max_records` -> `{over_threshold, reason:"no_filter"}`; else materialize against the base table. `max_records === 0` is unlimited and skips both gates.

**Minimal addition that cannot regress non-aggregated templates:** keep both existing source-count gates verbatim as the fast accept path. Only when a gate is about to return `over_threshold` **and the template is aggregated**, run the output-count preflight (Q3 SQL, tagged, cancellable) against the same `targetRef` that would have been used; if `outputCount <= max_records` fall through to materialize (response `row_count` = output count), else return the same `over_threshold` payload (include the output count in `row_count`). Extract the three decision branches into a pure function (`decideThreshold`) so both routes and tests share it.
- **Aggregated detection:** for AI views the compiler returns `aggregated = groupBy.length > 0 || aggregates.length > 0`. For saved templates use a conservative classifier over the template text with string literals/comments stripped: matches `\bGROUP\s+BY\b` or `\bDISTINCT\b` or a trailing `\bLIMIT\s+\d+\b` (the 3 shapes that bound output). False negatives keep the old (cheap, safe) behaviour; false positives cost one extra tagged COUNT. Do **not** run the output preflight for every over-threshold saved view (a `SELECT * FROM {view}` template over a huge table would execute the full query, a real regression in cost).
- **Hidden second blocker (web):** `useDynamicViewMaterializeChain.fireCascade` has a **local fast-path** (`token === "nofilter" && dv.max_records > 0` -> `setView(... over_threshold/no_filter)` with no HTTP). An aggregated unfiltered view would never reach the server. The list route (`GET /api/dashboards/:id/dynamic-views`) must return a derived `aggregated: boolean` per row (computed, not stored; no schema change), and the fast-path must be skipped when `dv.aggregated`. Session rows set `aggregated` from the compiler. `retry()` already force-fires past the fast-path.
- **Existing specs that pin current behaviour (must be touched):**
  - `packages/server/tests/routes.dynamic-view.spec.ts`: the shared `seedDynamicView` default template is `SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor` (**aggregated**, so the classifier will trigger the new preflight). Tests "over threshold" (~L523), "no filter view + capped base over cap" (~L652) and any that depend on mocked `kineticaSql` call **order** will now see an extra call. Fix by passing `template_sql: "SELECT * FROM {view}"` in those two existing tests (preserves the pinned non-aggregated contract), and add new tests: aggregated + output fits -> `materialized`; aggregated + output over -> `over_threshold` with output `row_count`; preflight tagged; non-aggregated never runs the preflight (assert call count).
  - `packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts`: T2, T18, DVCOMBO-C4, DVCOMBO-SP-C3/C4 pin the local fast-path. They use row fixtures without `aggregated`, so treating `undefined` as non-aggregated keeps them green; add tests for `aggregated: true` reaching the server with no key.
  - `WidgetRenderer.spec.tsx`, `MapChartRenderer.spec.tsx`, `DashboardsPage.spec.tsx`, `App.spec.tsx` reference `no_filter`/DROP loops; re-run, expect no change if the `id > 0` guard is the only edit.
- **Boundary semantics:** existing source rule is strict (`>= max` is over). The operator's wording for the output rule is `<= max_records`. Use `<=` for the **output** preflight (as decided) and leave the source rule untouched; note the one-row discrepancy in a code comment.

### Q5. D-16 startup sweep identity — HIGH for code, flagged gaps
- **No service identity exists.** `kinetica.ts` builds `Authorization` only from the per-request principal (`buildAuthHeader(req)`); `env` has `KINETICA_URL` only (no Kinetica user/password/token); `APP_ADMIN_USERNAME` is an app RBAC bootstrap name, not a Kinetica credential. There is no admin credential at boot and none should be added (operator prefers env over runtime stores, but adding a privileged Kinetica secret is a security expansion outside this phase).
- **What the server can do:** sessions persist in SQLite (`sessions` table, secret AES-256-GCM with `SESSION_ENCRYPTION_KEY`, `expires_at` = +8 h). `principalForSession(sid)` rebuilds a principal for any unexpired session whose `kinetica_url` matches. `reconcileExportsOnBoot()` already runs before `app.listen` in the boot IIFE. So: add `sweepAiViewsOnBoot()` there. For each registry row: try `principalForSession(row.sid)`; `DROP TABLE IF EXISTS <row.view_name>` as that user; delete the row. Password sessions always work; OIDC works while the stored access token is still valid.
- **Gaps (record in the plan, do not drop the criterion):** (1) rows whose session expired/was deleted, (2) OIDC sessions with an expired access token (`KineticaAuthError`), (3) a crash where the registry row was never written. These fall back to **TTL-only** (`DEFAULT_VIEW_TTL_MINUTES`, default 5 min; S1.6 observed reaping at 1 min TTL within 150 s). Registry rows for gone sessions are deleted after logging a count. The restart "verified by listing views in Kinetica" step is an operator UAT (U6) because it needs a live instance.
- **Listing views by prefix:** `POST /show/table` documents `table_name = '*'` with `show_children = true` ("set `table_name` to `*` and `show_children` to true" lists every table, view and schema); wildcard forms like `schema.*` or `prefix*` are **not documented**, and the docs do not say whether results are limited to what the caller can access. Use `kineticaShowTable(req, "*", {showOptions:{show_children:"true"}})` and filter `table_names` by the `_kbi_ai_u<user>_s<sid8>_` prefix **client-side**; never drive DROP from a listing alone (drive from the registry; use the listing for verification and as a secondary reconcile). `INFORMATION_SCHEMA` is reachable (S1.5c used `INFORMATION_SCHEMA.COLUMNS`), but a views-list catalog table was not verified here (LOW; do not depend on `ki_catalog.*`). Source: https://docs.kinetica.com/7.2/api/rest/show_table_rest/.
- **DROP semantics:** `DROP TABLE [IF EXISTS] [schema.]name` and "all dependent views, materialized views... will be dropped" (https://docs.kinetica.com/7.2/sql/ddl/drop-table/); the repo already uses `DROP TABLE IF EXISTS <view>` for materialized views everywhere, so keep it.
- **Logout is broken for existing dv DROPs (HIGH, code read):** `useAuthStore.logout()` does `await apiLogout()` (server deletes the session and clears the cookie) and then `set({status:"unauthenticated"})`; only then does the `App.tsx` effect (`status === "unauthenticated"`) fire `dropFilterView/dropDynamicView/dropCombinationView`, which now 401. Those loops only really work for the `UNAUTHORIZED` path before the cookie is gone, and for explicit logout rely on the 5-min TTL. For AISAFE-V20-06 add the drop **inside `POST /api/auth/logout` before `deleteSession(sid)`**: `await dropViewsForSid(sid)` (best effort, bounded by a short timeout, never fails logout). Also call `dropViewsForSid` from the session-expiry sweep only if sessions are still decryptable at that point (otherwise TTL). Do not "fix" the existing filter-view loops here (out of scope); mention it as a tracked observation.

### Q6. Ad-hoc materialize route design — HIGH
- **Route shape:** new `POST /api/ai/dynamic-view/materialize` and `POST /api/ai/dynamic-view/drop` in a new `aiDvRoutes.ts` registered beside `registerAiRoutes`. Gates: `requireConfig`, `requirePermission(AI_USE)`, `canViewDashboard(username, dashboardId)` (same 404 existence-hiding as the dv list route), AI enabled. Do **not** require `DYNAMIC_VIEWS_MANAGE` (135 D-16/ARCHITECTURE). Body: `{dashboardId, nonce, tempId, gen?, spec, combination_key?, joinFilterKeys?}`.
- **Materialize algorithm:** parse `spec` with `AiDvSpecSchema`; live-describe base and every joined table as the user (`createLiveSchema`) and run `compileAiDvSpec` validation (unknown table/column -> 400 with fixed text; inaccessible == nonexistent); resolve `max_records = min(spec.limit ?? ceiling, AI_DV_MAX_RECORDS)`; cap check against registry rows for this sid when the name is new; resolve the base source exactly like the saved route (filter-view probe by `buildFilterViewName({tableId: spec.base.tableId, combinationKey})` -> base table fallback); apply the Q4 threshold gate (aggregated=true gets the output preflight); `substituteViewToken`; `createOrReplaceMaterialized({view: name, ttl: DEFAULT_VIEW_TTL_MINUTES, tag})`; **upsert the registry row**; then **re-read the registry row** and if it vanished (concurrent drop), `DROP` again and return `{status:"dropped"}` (Pitfall 3). Return the same discriminated union as the saved route (`materialized | over_threshold`) plus `columns` (from the compiler) so the web store/shadow can use them. `DEFAULT_VIEW_TTL_MINUTES` is a closure const inside `createApp()` in `index.ts`; either register the new routes inside `createApp()` or pass it as an argument (do not re-read the env with a different default).
- **Drop route:** rebuild the name from the tuple, `DROP TABLE IF EXISTS`, delete the registry row, `viewColumnsCache.delete(name)`. Idempotent; the client treats it fire-and-forget (`.catch(()=>{})`), but for **undo/revert** the client should `await` it (or at least sequence it before the redo) so the cap is freed immediately (D-15).
- **Web merge into stores:** `dynamicViewStore` already accepts any numeric id (`setView(id, ...)`, negative included) and `useViewKeepAlive` keys by id/viewName; the chain hook branches on `id < 0`. `filterCombinationStore`: the orchestrator already binds `dv:<id>` source combos from the `dynamicViews` list it is passed (needs `source_table_id`); `currentDvSourceComboHash(dv.source_table_id, widgets)` works unchanged for session rows. The dv drill-down click path (`dispatchDrillDown` -> `/api/filter/materialize` dv branch) requires a `dashboard_dynamic_views` row and 404s for negative ids; the gateway/fold currently refuse filtering AI-created dvs ("can't be filtered yet" in `foldSession.ts` twice and `gateway.ts` `sourceRule`). Minimum for 139: **disable/ignore drill-down on widgets bound to a negative dv id** so a click does not 404 silently. Optional (recommended if scope allows): add a `dynamicViewId < 0` branch to `/api/filter/materialize` that builds the dv name from the registry instead of `getDashboardDynamicView`, then lift the three refusals. See Open Question 3.
- **Map read path (both sites):** `MapChartRenderer.tsx` reads `useDynamicViewStore.getState().views[layer.dynamic_view_id]` at the two `buildWmsParams` call sites (~L1325 and ~L1585) and has `dynamicViewsKey` in both dependency arrays (~L1566, ~L1653), which is the primitive projection of the store. Because the session layer is a `DashboardLayerDto` with `dynamic_view_id = <negative id>` and the store entry is keyed by that id, **no change is needed at those sites**. The risk is the opposite: a regression test must prove both sites resolve a negative-id dv (add a spec that renders a session layer bound to a materialized negative-id entry and asserts the WMS `LAYERS=` param is the session view name at both sites; plus a `pending -> materialized` flip re-fires Effect 2 via `dynamicViewsKey`). `resolveLayerViewName`/legend (`resolveLegendLayers.ts`, `LayersLegendPanel`) also reference `no_filter`; include them in the regression sweep. `makeSessionLayer` must set `dynamic_view_id` and `table_id = baseTableId` (currently hard-codes `dynamic_view_id: null`).
- **DROP hooks (all call the same client helper `dropAiDynamicView({nonce,tempId,gen})`):**
  - *Undo/revert:* `aiSessionStore.setCursor` already notifies an `aiFilterSink` on cursor moves. Add a sibling `aiDvSink` (same registration pattern: lib outside the engine registers, default none) that, on `onCursorMove(from,to,turns,baseEntries)`, diffs applied `add_dynamic_view` entries between the two prefixes: views present at `from` but not at `to` get DROP; views present at `to` but not `from` (redo) are rebuilt by the chain (the derived rows reappear, so the chain materializes them; no explicit call needed).
  - *Discard / dashboard switch / leave:* `useAiSessionStore.reset()` is called by the `DashboardsPage` cleanup effect (`[dashboard.id]`, ~L851) and by `Discard`. Snapshot the session's live AI views **before** `reset()` (the existing code already snapshots `dynamicViewStore.views` before its reset) and DROP each; the nonce is also what the logout/boot sweeps key on, so even a missed client DROP is caught server-side.
  - *Logout / UNAUTHORIZED:* `App.tsx` effect runs the loop after the session is gone (Q5), so the real mechanism is the server logout hook; still add the `id > 0` guard to the saved-dv loops so negative ids do not generate 404 calls, and add a best-effort `dropAiDynamicView` there for the UNAUTHORIZED-with-live-cookie case.
  - *Closed tab / crash:* TTL only (plus boot sweep on restart).
- **Tests to expect to touch:** `DashboardsPage.spec.tsx` and `App.spec.tsx` assert the DROP loops call `dropDynamicView` for materialized entries; keep them green by only skipping `id <= 0`.

### Q7. Keep compatibility — HIGH
The compiled body is `template` containing literal `{view}` (see Pattern 1), passes `substituteViewToken(template, "_dummy_validation_view_name_")` (the same validation `POST /api/dashboards/:id/dynamic-views` runs), uses only `schema.table` raw refs for joins in the persisted rendering, and `columns` is already `[{name,type}]` for `columns_json`. Add a unit test that compiles several specs and asserts (a) `substituteViewToken` does not throw, (b) the token occurs exactly once (the base), (c) the output contains no unquoted model-supplied identifier. Phase 141 should store `{ name, source_table_id: spec.base.tableId, template_sql: template, max_records, columns_json }`. Keep the divergence note: joined-table filter views are session-only (Open Question 1).

### Q8. Dependents on removal (D-17) — HIGH for references, MEDIUM for the fold design
- **References:** a widget references a dv via **`config.dynamicViewId`** (a dv-bound widget normally has no `tableId`); a layer references it via the **top-level** `dashboard_layers.dynamic_view_id` field (not `layer.config`; same top-level rule as `track_config` per memory note). `foldSession.buildSim` already tracks `dvBound` per widget; `ShadowWidget.dynamicViewId` exists on the server shadow; the server `ShadowLayer` does **not** record a dv id (add it).
- **Atomic mechanism (recommended):** the gateway **stamps** the dependents onto the op at validation time, exactly like it stamps `layout` onto `add_widget`. Extend `remove_dynamic_view` with optional gateway-stamped fields `repoint: { tableId, widgetIds[], layerIds[] }` and `drop: { widgetIds[], layerIds[] }`. At stage e (live_schema) the gateway live-describes the dv's **base table** (`spec.base.tableId` for session views; `source_table_id` from the dv row for saved ones) and, for each dependent widget/layer, checks that **every referenced column** exists on it. Widget referenced columns = values under `AI_COLUMN_BINDING_KEYS` (`metric`, `metricColumn`, `groupByColumn`, `groupByColumns`) plus `columns`/`sortField`; **move `AI_COLUMN_BINDING_KEYS` and the extraction helper to `packages/shared`** (currently exported from server `gateway.ts`) so `foldSession` (web) uses the same list. Layers: `latColumn/lonColumn/wktColumn/wkbColumn/valueColumn`. Widgets carrying a frozen `config.sql` (custom SQL) are always **removed**, never repointed (the SQL text embeds the old view's columns). All-columns-present -> repoint; otherwise remove. The `label`/answer lists both groups.
- **Fold:** `foldSession` applies the stamped fields in the same `remove_dynamic_view` entry: repoint = overlay `{dynamicViewId: undefined, tableId, table: "<schema>.<name>"}` for saved widgets (via `widgetMeta.config`/`contribution.widget`) or an in-place rewrite of `addedWidgets`; layers = `dynamic_view_id: null`, `table_id: tableId`; removals reuse `removedWidgetIds`/`removedLayerIds` / delete from `addedWidgets`/`addedLayers`. Because the fold is pure over the op log, **one undo (cursor move) restores everything** with no inverse code. Add `removedDynamicViewIds` to `SessionDerived` and `applySessionToDynamicViews(saved, derived)` (ref-stable like `applySessionToWidgets`) for the merge.
- **Consistency check to add to `foldSession` tests:** after folding any log, no remaining widget/layer references a dv id absent from the effective dv list (the "no dangling references" success criterion as a property test over generated op sequences).
- **D-18 (saved dv removal):** same op with `id > 0`: filter it out of the effective list and out of the chain (chain then stops materializing it and prunes its controller; `useViewKeepAlive` re-sync drops the key). Do **not** issue a Kinetica DROP for a saved dv's view on session removal: its name is per-user (`_kbi_dv_u<user>_d<dash>_<id>`) so other users' materializations are untouched anyway, and an undo needs it intact; the existing switch/logout loop drops it. `needs_confirmation` for saved content: removing a saved dv should follow the 136 D-06 ask-once rule like `remove_widget` (gateway `confirmRemove`); decide in discuss/plan (Open Question 4).

### Q9. Gateway integration — HIGH
- **Where validated:** `checkAiOp` in `lib/ai/gateway.ts`, order shape -> allow_list -> permission -> reference -> live_schema -> layout -> ok (plus `clarification`/`cap` stages). `add_dynamic_view`/`remove_dynamic_view` are currently shape-only placeholders in `aiOp.ts` and **have no mutate tool** in `tools/mutate.ts` (`MUTATE_TOOLS` lacks `add_dynamic_view`; `remover("remove_dynamic_view", ...)` exists). Add a typed flat tool `add_dynamic_view` (args mirror the spec; vocab enums: `fn`, `bucket`, `join type`, `operator`; no SQL/free-form field) and extend `registry`/context docs.
- **Per-stage rules for `add_dynamic_view`:**
  1. *shape:* `parseAiOp` strict schema (`name` 1..80, `spec`); cross-field checks in `parseAiOp` like `add_layer` (distinct output names, `percentile` has `p`, `bucket` only on a column, `limit <= ceiling`, at most `AI_DV_MAX_JOINS` joins, join `on` non-empty).
  2. *allow_list:* closed enums only; reject any key outside the schema (`.strict()`).
  3. *permission:* unchanged (`ai:use` + `canViewDashboard`; no edit-right checks, 135 D-16).
  4. *reference:* temp id unused; every `tableId` (base + joins) on the dashboard (`tableRule`); **cap (D-14):** count `shadow.dynamicViews` entries with `id < 0` (client snapshot includes session views once merged into `dynamicViews`) plus this answer's adds; at/over `AI_DV_MAX_PER_SESSION` return stage `"cap"` with exact text, e.g. `"you already have 5 session views (limit 5); remove one first"` (135 style: ids/counts only, never values). The authoritative cap is the registry count at materialize (client snapshot is advisory; two tabs share the sid, so the server cap is per-sid).
  5. *live_schema:* describe base + each join as the user; every referenced column exists (`nearest()` did-you-mean on the probed table's columns only, D-17 leak rule); numeric required for `sum/avg/median/percentile`; bucket columns must be date/time per **registered snapshot type** (Q2); join key type compatibility.
  6. *ok:* compile once (`compileAiDvSpec`) to derive `columns` and to prove it compiles; store `columns` in the shadow (`ShadowState.dynamicViews` becomes a `Map<id, {name, columns?}>` or a parallel map) and **stamp** `maxRecords` onto the op. `applyOpToShadow` records it so later ops in the same answer can bind a widget to the new view.
- **Pointing widgets/layers at the view (AIACT-V20-07):** `add_widget` today rejects any config key not in the catalogue (`tableId` is the single carve-out in `validateAiWidgetConfig`). Add `dynamicViewId` as a second carve-out, make `tableId` and `dynamicViewId` mutually exclusive, and in `opColumnRefs`/live_schema check the widget's column refs against the **dv's columns from the shadow** (the live describe takes a table id only). `add_layer` needs an optional `dynamicViewId` (mutually exclusive with `tableId`; require `tableId` of the base for `table_id`) with spatial columns checked against the dv's output columns (so a view feeding a heatmap must keep lat/lon as plain columns; surface a clear reason otherwise). `get_dashboard` (`DashboardView.dynamicViews`) must list `columns` for session views so the model can pick metric/groupBy names; `describe_table` is table-only.
- **Repoint-by-model (D-19):** there is no op that rebinds an existing widget (`patch` on a dv-bound widget is refused with `DV_BOUND`; `tableId` patches refused). So "change it" = `add_dynamic_view` (new) + `add_widget`/`add_layer` bound to it + `remove_widget`/`remove_dynamic_view` of the old, all in one answer. D-17's automatic repoint is the **only** repoint code path; do not add a rebind op (Open Question 5 if the operator expects in-place rebind).
- **Env (parsed in `lib/aiConfig.ts` with `parseIntInRange`, same style):** `AI_DV_MAX_RECORDS` (ceiling, default 100000 to match the table default), `AI_DV_MAX_JOINS` (default 2, range 0..4), `AI_DV_MAX_PER_SESSION` (default 5, range 1..20), `AI_DV_PREFLIGHT_TIMEOUT_MS` (default 30000). Surface the limits in `GET /api/ai/config` only if the web needs them (it does not for correctness; the server enforces). Add `.env.example`/docs entries and extend `lib.aiConfig.spec.ts` / `boot.aiConfig.spec.ts`.

## Common Pitfalls

### Pitfall 1: Leaked views from the existing DROP loops
**What goes wrong:** the dashboard-switch and logout loops call `dropDynamicView(id)` for every materialized entry; negative ids 404 and the view lives until TTL.
**How to avoid:** guard `id > 0`, route negatives to `dropAiDynamicView`; server registry is the backstop.
**Warning signs:** `_kbi_ai_` views visible in `/show/table` after leaving the dashboard.

### Pitfall 2: Logout cannot drop from the client
**What goes wrong:** the cookie/session is gone before the client's DROP requests fire (Q5).
**How to avoid:** drop inside `POST /api/auth/logout` before `deleteSession`. Test: a server spec that registers a row, calls logout, and asserts a `DROP TABLE IF EXISTS <name>` statement was issued **before** the session was deleted.

### Pitfall 3: Undo races an in-flight materialize
**What goes wrong:** undo aborts the fetch (HTTP only) and sends DROP; the abandoned CREATE still completes server-side and recreates the view after the DROP, leaking it (abort does not cancel Kinetica jobs, S7).
**How to avoid:** (a) tag the CREATE and, on drop, also `cancelKineticaJobsByTag` for that view's tag; (b) post-create registry re-check (materialize re-reads its row after CREATE; if gone, DROP again); (c) generation suffix in the name so a stale create never targets the rebuilt view.

### Pitfall 4: Aggregated saved views never reach the server
**What goes wrong:** the web local no_filter fast-path (Q4). **How to avoid:** `aggregated` flag from the list route; spec the new web tests.

### Pitfall 5: `dynamicViewId: null` reads as bound
See Anti-Patterns. Use `undefined` in overlays; assert in a spec that a repointed widget renders as a table-bound widget (no orphan, no dv status gate).

### Pitfall 6: Replacing a base filter view drops its dependents
**What goes wrong:** Kinetica drops dependent materialized views when a table/view is dropped, and `CREATE OR REPLACE` internally drops-then-creates (the existing 1078 race note). An AI view built on a combination filter view can vanish when that filter view is re-materialized.
**How to avoid:** this is the same behaviour saved dvs live with: the chain re-materializes when the `ready:<hash>:<viewName>:<expiresAt>:<materializeVersion>` token changes. Make sure session rows are inside that cascade (they are, once in the list). Also include joined-table filter-view names in the session row's token so a change re-fires. Verify live (U7).

### Pitfall 7: Existing specs that silently pin the old threshold
See Q4. Do not "fix" a failing old test by editing code; change the fixture to a non-aggregated template and add new tests for the new rule (CLAUDE.md: report toothless/changed criteria).

### Pitfall 8: Dev `.env` / parallel load false failures
Server specs read `packages/server/.env` (memory note); `DEFAULT_VIEW_TTL_MINUTES` or new `AI_DV_*` dev overrides can falsely redden specs. Run the web vitest and server gates **sequentially** (`--maxWorkers=4`); server vitest is set-based per CLAUDE.md.

### Pitfall 9: Adding a gateway op shape ripples
Extending `AiOpSchema` payloads touches `aiOp.spec.ts`, `lib.aiGateway*.spec.ts`, `lib.aiShadow.spec.ts`, `lib.aiToolsRegistry.spec.ts` (tool count), `lib.aiContract.spec.ts` (contract version/hash; check whether `AI_CONTRACT_VERSION` must bump), `foldSession.spec.ts`, `structuralOps.e2e.spec.ts` (`unsupported_in_134` cases for dv ops flip to applied). Budget these explicitly.

### Pitfall 10: Quoted identifiers and case
Kinetica identifiers: S7.5 showed unquoted names are upper-cased in results ("UPPER unquoted" -> `VENDOR_ID`) while `as-given` columns come through as typed. Always double-quote and alias outputs (`AS "name"`) so output column names are exactly the spec's names, which downstream widgets reference. Reject `"` in any identifier (the `^[A-Za-z_][A-Za-z0-9_]*$` rule already does).

## Code Examples

### Name builder with prefix validation (illustrative)
```typescript
// lib/aiDvName.ts  (new symbols: buildAiDynamicViewName, parseAiDynamicViewName)
import { sanitizeForViewName } from "./viewNaming";
const NONCE_RE = /^[a-f0-9]{8}$/;
export function buildAiDynamicViewName(a: { username: string; sid: string; nonce: string; tempId: number; gen?: number }): string {
  if (!NONCE_RE.test(a.nonce) || !Number.isInteger(a.tempId) || a.tempId >= 0) throw new Error("bad ai view id");
  const g = a.gen && a.gen > 0 ? `_g${Math.min(a.gen, 999)}` : "";
  return `_kbi_ai_u${sanitizeForViewName(a.username)}_s${a.sid.slice(0, 8)}_n${a.nonce}_${Math.abs(a.tempId)}${g}`;
}
```
Parse = regex over the same shape; drop/DDL call sites must go through `build...` (never accept a client-supplied string).

### Registry + cap (illustrative)
```sql
CREATE TABLE IF NOT EXISTS ai_session_views (
  view_name TEXT PRIMARY KEY,
  sid TEXT NOT NULL, username TEXT NOT NULL, dashboard_id INTEGER NOT NULL,
  nonce TEXT NOT NULL, temp_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_session_views_sid ON ai_session_views (sid);
```
Cap: `SELECT COUNT(*) FROM ai_session_views WHERE sid = ? AND view_name <> ?` against `AI_DV_MAX_PER_SESSION` before CREATE of a new name. Prune rows older than the session `expires_at` window at boot.

### Threshold decision (pure, shared by saved + ad-hoc routes)
```typescript
type Decision = { kind: "materialize"; rowCount: number } | { kind: "over"; reason: "exceeds_max_records" | "no_filter"; rowCount?: number };
// decideThreshold({ maxRecords, sourceCount, sourceKind: "filter"|"base", aggregated, outputCount? })
// source < max            -> materialize (unchanged, no preflight)
// maxRecords === 0        -> materialize (unchanged)
// source >= max && !aggregated -> over (unchanged)
// source >= max && aggregated  -> caller runs the tagged output preflight; outputCount <= max -> materialize else over
```

### Server logout hook ordering
```typescript
app.post("/api/auth/logout", async (req, res) => {
  const decoded = decodeAndVerifyJwt(req);
  if (decoded?.sid) {
    try { await dropViewsForSid(decoded.sid, { timeoutMs: 3000 }); } catch { /* never fail logout */ }
    try { deleteSession(decoded.sid); } catch { /* swallow */ }
  }
  clearSessionCookie(res);
  return res.status(204).send();
});
```
(The current handler is synchronous; making it `async` must keep the 204/idempotent behaviour and the `routes.auth*` specs green.)

## State of the Art

| Old Approach | Current Approach | Impact |
|---|---|---|
| Saved dv = row + deterministic name `_kbi_dv_u<user>_d<dash>_<id>` | Session dv = registry row + `_kbi_ai_u<user>_s<sid8>_n<nonce>_<abs(tempId)>` | New naming/drop path; saved routes untouched |
| Threshold gates on source rows | Source gate first, output preflight only for aggregated templates | Aggregated views build unfiltered (D-02/D-03) without cost regression |
| Client-only logout DROP loops | Server-side drop in logout handler + boot sweep | Makes AISAFE-V20-06 true for logout/restart |

**Deprecated/outdated:** none relevant. Note the 7.2 docs list `COUNT_DISTINCT(expr)` while the codebase emits `COUNT(DISTINCT col)`; both exist, keep the proven form.

## Open Questions

1. **Joined-table filter views vs Keep fidelity**
   - Known: D-07 says joined tables read through their current filter view; D-01/Q7 say Keep saves a normal row with no behaviour change; a saved template can only reference raw tables.
   - Unclear: after Keep, the saved view joins raw (unfiltered) tables, so a view built while a joined table was filtered looks different afterwards.
   - Recommendation: implement session rendering with filter views, persist raw joins, and show a note in the Keep UI (141). Confirm with the operator at plan time; this is a documented divergence, not a silent one.
2. **Joined table with an active filter but no widget on it has no filter view**
   - Known: the orchestrator materializes combinations only for tables with a viz key.
   - Recommendation: v1 uses "filter view if it exists, else raw" (literally D-07). Registering extra `dvj:<id>:<tableId>` viz keys in the orchestrator is possible but touches the heavily-tested orchestrator; defer unless the operator wants filters to always reach joins.
3. **Drill-down clicks on session-dv widgets**
   - Known: the dv filter branch needs a row; 138 D-03 says dv-backed widgets filter via the dv filter slice; 138/gateway currently refuse AI-dv filtering.
   - Recommendation: minimum = ignore drill-down for negative dv ids (no 404); preferred = a `dynamicViewId < 0` branch in `/api/filter/materialize` using the registry, then lift the three "can't be filtered yet" refusals. Ask the operator whether AI-view filtering is in scope for 139 (success criteria do not require it).
4. **Removing a saved dv: confirmation**
   - 136 D-06 asks once before removing saved widgets/layers. Saved dvs are session-only removable (D-18); recommend the same `needs_confirmation` gate for `id > 0` for consistency. Confirm.
5. **Rebind op**
   - D-19 says change = add + repoint + remove. No rebind op exists for existing widgets. Recommendation: model-side = remove + add bound widget; D-17 auto-repoint is internal. Confirm that is what "repoint" in D-19 meant.
6. **Live Kinetica version** is not recorded in the repo; Q1/Q2 are from the 7.2 docs.

## Operator / live-UAT steps (no writes were made by this research)

| # | Step (run as the non-admin UAT user, scratch `_kbi_spike_*` names, via a spike script like `adhocDvSpike.ts`) | Why |
|---|---|---|
| U1 | `SELECT APPROX_MEDIAN("fare"), APPROX_PERCENTILE("fare", 90) FROM demo.nyctaxi` and the same with `GROUP BY` | Confirm function names, p scale (0-100), GROUP BY behaviour |
| U2 | Same expressions inside `CREATE OR REPLACE MATERIALIZED VIEW ... AS (...)` on a GPU table | MV acceptance |
| U3 | NULL handling / empty-group result of APPROX_* | Docs silent |
| U4 | `DATE_TRUNC('HOUR'|'WEEK'|..., ts_col)` on timestamp (long ms), datetime and date columns; note result type and week start | Docs silent on input types/result type |
| U5 | Preflight `SELECT COUNT(*) FROM (SELECT 1 AS x FROM (<join body>) LIMIT n+1)` timing vs plain COUNT over a big join; confirm tag appears in `/admin/show/jobs` `query_text` and `/admin/alter/jobs` cancels it | Cost guard actually bounds work (S7.6 verified tag/find/cancel for plain queries only) |
| U6 | Boot sweep + logout + undo + discard + switch: list with `POST /show/table {table_name:"*", options:{show_children:"true"}}` and filter `_kbi_ai_` before/after each lifecycle event | Success criterion 3 "verified by listing views in Kinetica" |
| U7 | Re-materialize the base filter view while an AI view depends on it; confirm the AI view is dropped and the chain rebuilds it | Pitfall 6 |
| U8 | TTL sliding vs fixed with read-touch (S1.6 did not distinguish) | `useViewKeepAlive` relies on a read resetting TTL |
| U9 | Visual check: AI view in a bar chart and a heatmap layer, "AI" tag, over-threshold state, map tiles follow a filter change, dark and light mode | CLAUDE.md: CSS/visual defects evade tsc/vitest/theme-guard; route to `checkpoint:human-verify` |

## Validation Architecture

Skipped: `workflow.nyquist_validation` is `false` in `.planning/config.json`. Test gates per CLAUDE.md: web `npx tsc --noEmit` + `npx vitest run` + `theme-guard.spec.ts`; server `npx tsc --noEmit` + set-based vitest (failing files must be a subset of `TD-V16-TEST-ISOLATION`). Run web and server suites sequentially with `--maxWorkers=4`.

Red-first anchors verified to be absent today (all returned 0 matches under `packages/*/src` and `packages/server/tests` on 2026-10-20): `compileAiDvSpec`, `buildAiDynamicViewName`, `ai_session_views`, `AI_DV_MAX_PER_SESSION`, `AiDvSpecSchema`, `sweepAiViewsOnBoot`, `AI_DV_MAX_RECORDS`, `AI_DV_MAX_JOINS`, `APPROX_MEDIAN`, `dropAiDynamicView`, `materializeAiDynamicView`. **Do not** use `_kbi_ai_` as a grep anchor: it already appears in `tests/spike.s1-adhoc-dv.spec.ts` (`_kbi_ai_uadmin_s12345678_1`). Use `_n<nonce>` shaped names or the symbol names above. Existing test files likely touched: `routes.dynamic-view.spec.ts`, `lib.materializedView.spec.ts`, `lib.aiGateway.spec.ts`, `lib.aiShadow.spec.ts`, `lib.aiToolsRegistry.spec.ts`, `lib.aiContract.spec.ts`, `lib.aiConfig.spec.ts`, `bootstrap.spec.ts` (asserts the boot IIFE body shape; a new `await sweepAiViewsOnBoot()` before `app.listen` must satisfy its regex), `shared/src/aiOp.spec.ts`, web `foldSession.spec.ts`, `structuralOps.e2e.spec.ts`, `useDynamicViewMaterializeChain.spec.ts`, `MapChartRenderer.spec.tsx`, `WidgetRenderer.spec.tsx`, `DashboardsPage.spec.tsx`, `App.spec.tsx`.

## Sources

### Primary (HIGH confidence)
- Repo code read in full or in the relevant ranges: `packages/server/src/index.ts` (dv routes ~L1208-1580, ~L1735-2325, `/api/sql`, boot IIFE), `lib/materializedView.ts`, `lib/dynamicViewSql.ts`, `lib/dynamicViewName.ts`, `lib/viewNaming.ts`, `lib/columnGuard.ts`, `lib/viewColumns.ts`, `lib/kineticaJobs.ts`, `lib/exportRunner.ts` (`principalForSession`), `lib/ai/gateway.ts`, `lib/ai/shadow.ts`, `lib/ai/liveSchema.ts`, `lib/ai/runAnswer.ts`, `lib/ai/tools/mutate.ts`, `kinetica.ts`, `sessionStore.ts`, `aiRoutes.ts`; `packages/shared/src/aiOp.ts`, `aiCatalog.ts`, `aiFilter.ts`, `actionAllowList.ts`; `packages/web/src/store/dynamicViewStore.ts`, `aiSessionStore.ts`, `hooks/useDynamicViewMaterializeChain.ts`, `hooks/useViewKeepAlive.ts`, `lib/aiSession/foldSession.ts`, `lib/aiSession/applySession.ts`, `lib/dvSourceCombo.ts`, `components/DashboardsPage.tsx`, `App.tsx`, `store/auth.ts`, `components/charts/MapChartRenderer.tsx`, `WidgetRenderer.tsx`.
- `.planning/phases/133-.../133-SPIKES.md` (S1, S7 live results), `.planning/research/ARCHITECTURE.md` Q3 (option B).
- https://docs.kinetica.com/7.2/sql/query/math-functions/ - APPROX_MEDIAN, APPROX_PERCENTILE, COUNT_DISTINCT, etc.
- https://docs.kinetica.com/7.2/sql/query/date-time-functions/ - DATE_TRUNC, TIME_BUCKET, DATE_BUCKET, units.
- https://docs.kinetica.com/7.2/sql/ddl/drop-table/ - DROP TABLE syntax; dependents dropped.
- https://docs.kinetica.com/7.2/api/rest/show_table_rest/ - `table_name='*'`, `show_children`, options.

### Secondary (MEDIUM confidence)
- https://docs.kinetica.com/7.2/sql/query/aggregation-functions/ - lookup/grouping aggregates only; confirms no median/percentile there.

### Tertiary (LOW confidence)
- Whether `/show/table` results are limited to caller-accessible objects (docs silent); `ki_catalog` views catalog (not verified); WEEK start day and DATE_TRUNC result type on long-backed timestamps (docs silent).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; all pieces exist and were read.
- Architecture: MEDIUM-HIGH - merge point, routes, registry, hooks derived from code; the removal-dependents stamping design and the aggregated-flag plumbing are recommendations not yet prototyped.
- Pitfalls: HIGH for the code-derived ones (logout ordering, negative-id DROP 404, fast-path, `null` binding); MEDIUM for Kinetica dependent-drop behaviour (docs-stated, not tested live).
- Kinetica SQL behaviour: MEDIUM - function names/units verified in 7.2 docs; GROUP BY/MV/GPU/type behaviour needs the UAT steps.

**Research date:** 2026-10-20
**Valid until:** 2026-11-19 (stable code area; re-verify Kinetica docs if the live instance is not 7.2).
