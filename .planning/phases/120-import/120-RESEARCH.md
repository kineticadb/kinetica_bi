# Phase 120: Import - Research

**Researched:** 2026-09-16
**Domain:** Server-side (Express + better-sqlite3), bespoke id-remapping over an existing schema. No new library, no schema change — this is entirely internal-codebase design work built on Phase 119's shared inventory module.
**Confidence:** HIGH on everything grounded in direct code read (schema DDL, existing accessors, existing transaction precedent, permission catalog); MEDIUM on the two genuine design questions (Q4 metric-conflict policy, Q6 validation strictness) where CONTEXT.md leaves the edge case open and a recommendation, not a fact, is being made.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked by the operator
1. **Always new ids.** *"New dashboards and visualization ids should be used in case there is already an existing dashboard with the old id or visualization ids."* Import never reuses an id from the file. Importing a file whose ids collide with existing records must succeed and must leave those existing records untouched (DXIM-V124-04).
2. **Tables match by `schema.name`** — reuse an existing registry entry, create when missing, never duplicate for the same `schema.name` (DXIM-V124-06). Import reports which were matched vs created.
3. **Custom metrics travel and are created if absent**, matched by label where already present (DXIM-V124-07). Widgets reference them by id; a metric that does not arrive is a silently broken widget.
4. **Access grants are NOT imported** (DXIM-V124-08, closed in Phase 119). The imported dashboard starts with the target environment's own access rules.
5. **Column display config does NOT travel** — it is shared per-table across every dashboard in the target, and importing it would silently change how OTHER dashboards render.

### The eight reference kinds — established and verified three times
| # | Reference | Shape | Trap |
|---|---|---|---|
| REF-1 | `widgets.config.tableId` | scalar | — |
| REF-2 | `widgets.config.dynamicViewId` | scalar | fixture-only, never seen live |
| REF-3 | `widgets.config.sourceMapWidgetId` | scalar → another widget | ordering: target must exist first |
| REF-4 | custom-metric scalar `metricId` | scalar | fixture-only, never seen live |
| REF-5 | `widgets.config.metrics[].metricId` | array of objects | fixture-only, never seen live |
| REF-6 | `widgets.config.includedLayerIds` | array | empty array = SENTINEL meaning ALL LAYERS, not none |
| REF-7 | `widgets.config.filterSelection.allowedSourceWidgetIds` | array | mixes widget ids with the STRING `__spatial_draws__`, which must NOT be remapped |
| REF-8 | `widgets.config.options[].actions[].target` | polymorphic `{kind, id}` | plus a LEGACY singular `options[].action` field |

Plus a sixth SITE carrying the REF-7 shape: `dashboard_layers.filter_scope` (DB column, JSON-as-TEXT).

**Phase 119 built the walk as a deliberately separate pure module — `packages/server/src/lib/dashboardExportRefs.ts` — precisely so this phase's remapper consumes the SAME inventory. Do not write a second list of reference kinds.**

### Coverage limitation carried in from Phase 119
5 of 8 kinds (REF-1, -3, -6, -8, plus the `dashboard_tables` union edge) were exercised by the operator's own live export. **REF-2, REF-4, REF-5 have only ever existed in fixtures.** Weight testing accordingly.

### Atomicity
DXIM-V124-09 requires a mid-import failure leave nothing behind. `better-sqlite3` is synchronous and supports transactions; the natural implementation is a single transaction around the whole import. **The test that matters induces a failure mid-import and asserts the database is unchanged**, not one that merely checks the happy path.

### Claude's Discretion
- Route shape (`POST /api/dashboards/import` assumed) and whether the file arrives as multipart (`multer` precedent exists, v1.16 Phase 81) or a JSON body.
- The report's exact shape, provided it names the new dashboard id, tables matched vs created, and metrics created (DXIM-V124-10).
- Validation strategy for DXIM-V124-11 — how strictly to check a hand-edited file, and what the rejection message says.
- What import does with an unrecognised `schemaVersion`. Phase 119 deliberately left this to 120.

### Deferred Ideas (OUT OF SCOPE)
DXIM-F1 bulk multi-dashboard files · DXIM-F2 server-to-server migration · DXIM-F3 exporting access grants for same-environment cloning · DXIM-F4 dry-run preview showing what an import would change · DXIM-F5 re-import over an existing dashboard (update in place). Re-testing `TD-V16-TEST-ISOLATION` attribution while this milestone is in server code — deferred, not this phase's job.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| DXIM-V124-03 | Importing recreates the dashboard and all its visualizations | Q1 two-pass create/rewrite design (below) is the mechanism; Q7 round-trip test is the primary proof |
| DXIM-V124-04 | Import always assigns NEW ids; collisions with existing records leave those records untouched | Q1 "always new ids, never reuse" — every `create*` accessor already autoincrements; the id maps (old→new) are the only place an old id is ever read, never written back to a target row |
| DXIM-V124-05 | Every id reference inside imported config is remapped — no imported widget points at a pre-existing record by accident | Q1 (remapper design + ordering), Q2 (the three traps on the import side), Q7 (the mutation-probe test that specifically catches a naive no-op remapper) |
| DXIM-V124-06 | Tables matched by `schema.name`, created when missing, never duplicated | Q3 — confirms `tables` has NO unique constraint today; recommends a plain lookup + first-match-wins policy, explicitly not adding one (no schema change) |
| DXIM-V124-07 | Custom metrics travel, created if absent, matched by label where present | Q4 — surfaces the label-matches-but-expression-differs conflict as a genuine open design question with a recommendation |
| DXIM-V124-09 | Import is atomic — mid-failure leaves nothing behind | Q5 — confirms `better-sqlite3` transaction precedent (3 existing call sites) and designs a natural (constraint-driven) fault-injection test plus an optional test-only hook |
| DXIM-V124-10 | Import reports what it did (tables matched/created, metrics created, new dashboard id) | Q1 (the id maps are exactly the report's raw material) |
| DXIM-V124-11 | A malformed/truncated/hand-edited file is rejected with a clear message, nothing partially applied | Q6 — recommends structural validation (no new dependency, no zod on the server) done BEFORE the transaction opens |
</phase_requirements>

## Summary

Import is the mirror of Phase 119's export, and it inherits export's two defining properties: it is pure local SQLite (no Kinetica round-trip, no `requireConfig`), and its correctness is entirely a question of **exhaustively walking the same eight reference kinds** — this time to rewrite, not collect. The single biggest design decision is **how the rewriter avoids drifting from the collector**, because `dashboardExportRefs.ts`'s collect functions *flatten* every reference into a deduplicated `ExportRefs` id-list and throw away exactly the positional information a rewriter needs (which JSON path held that id). A rewriter therefore cannot be built by "driving" the existing collect functions directly — it needs its own traversal — but it can and must be built in the **same file**, structured so each collect branch and its rewrite counterpart sit side by side and share every low-level primitive that already exists (`asId`, `dedupSorted`/`normalize` pattern, `getOptionActionsLike`, the `collectFilterSelectionRefs` sentinel-safe filter). See Q1 for the concrete recommendation and its drift analysis.

The second major finding, not explicit in CONTEXT.md's framing but forced by the actual accessor signatures: **the ordering problem is not just REF-3 (widget→widget).** `dashboard_layers.filter_scope` can name a widget, and a widget's `includedLayerIds`/`options[].actions[].target` can name a layer — a genuine two-way cycle between widgets and layers that no single topological creation order can satisfy. `createDashboardLayer()`'s own signature already reflects this: it does not accept `filter_scope` at creation time at all (only `updateDashboardLayer()` can set it). This is strong, code-level evidence that the correct shape is a **two-pass import**: Pass 1 creates every row (tables → dynamic views → custom metrics → widgets-with-placeholder-config → layers-with-placeholder-filter_scope), accumulating five old-id→new-id maps as it goes; Pass 2, run only once every map is complete, rewrites each widget's real config and each layer's real `filter_scope` against the now-total maps and `UPDATE`s the rows. This sequencing resolves REF-3 as a special case of the same general problem, not a one-off.

Third: `tables` has **no unique constraint** on `(schema, name)` in the DDL today (confirmed by reading `SCHEMA_DDL` directly) — the "match by schema.name" requirement must be implemented as an application-level lookup, and the code must have an explicit, stated policy for what happens if a real database already has duplicates (Q3). `custom_metrics` **does** have `UNIQUE(table_id, label)`, which turns "matched by label where already present" into a real constraint the import must respect — and surfaces a genuine, CONTEXT.md-unresolved edge case: same label, different expression (Q4).

Fourth: atomicity is not a new pattern (three existing `db.transaction()` call sites) but the codebase has **no existing precedent for injecting a mid-transaction failure in a test** — every existing "mock a failure" pattern in this repo mocks an *async* Kinetica client boundary, not a `db.ts` accessor, and ESM named-export spying does not reliably work here. Q5 recommends a fault-injection design that uses a REAL SQLite constraint (the `custom_metrics` unique index) fired deliberately late in the creation order, so the test proves that already-inserted tables/widgets/layers from the SAME transaction are rolled back too — not just that the metrics step itself failed.

Fifth: no new RBAC permission is needed. `designer` and `admin` already hold BOTH `dashboards:create` and `datasets:manage`; `analyst` and `user_admin` hold neither — the exact split import needs. `requirePermission()` already documents that `requireAuth` (its first element) is idempotent specifically so two calls can be spread back-to-back; `...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), ...requirePermission(PERMISSIONS.DATASETS_MANAGE)` is a zero-new-code AND-gate using the existing middleware factory exactly as designed.

**Primary recommendation:** extend `dashboardExportRefs.ts` with three new sibling functions (`rewriteWidgetConfigRefs`, `rewriteLayerRefs`, `rewriteDynamicViewRefs`) that mirror the existing collect functions branch-for-branch, reusing `asId`, `collectFilterSelectionRefs`'s sentinel-safe logic (factor its inner filter into a shared `remapFilterSelectionRefs`), and `getOptionActionsLike`. Add a new `lib/dashboardImport.ts` (mirrors `dashboardExport.ts`'s role) implementing the two-pass sequence inside one `db.transaction()`, a pre-flight structural + referential validation pass that runs BEFORE the transaction opens (reusing the *existing*, unmodified collect functions to check the file references only what the file itself contains), and an import report built directly from the five id maps. Add one new plain (non-unique) accessor, `getTableBySchemaName`, to `db.ts`. Gate the route with `...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), ...requirePermission(PERMISSIONS.DATASETS_MANAGE)` — no new permission.

## Q1 — The Remapper's Shape

### Why the collect functions cannot directly drive rewriting

`collectWidgetConfigRefs(config): ExportRefs` returns `{ tableIds: number[], widgetIds: number[], ... }` — deduplicated, sorted, flattened. Given only this output, a rewriter has no way to know that (say) `widgetIds` entry `7` came from `config.sourceMapWidgetId` versus `config.filterSelection.allowedSourceWidgetIds[2]` versus `config.options[1].actions[0].target.id` — three structurally different write sites that must be patched differently (a scalar assignment, an array-element replace-in-place, and a nested object-field replace). The collect function is deliberately lossy (that's exactly why it's a good collector — for export's purposes, "what set of tables does this dashboard need" doesn't care where in the JSON the id came from). **A second, dedicated traversal is required for rewriting.** This is not a design choice to avoid, it is a structural fact about what `ExportRefs` throws away.

### Two designs evaluated

**Design A — Fully generic visitor shared by both directions.** Refactor the module around a single low-level "site list" — one array of descriptors, each `{ kind: RefKind, get(cfg): unknown, set(cfg, value): void }` — one descriptor per REF-1..8 site (REF-8's polymorphic dispatch and REF-6/7's array-with-sentinel handling live inside each descriptor's own closure, not in a generic walker; Phase 119's own research already rejected a truly type-driven generic JSON walker for good reason — see below). `collectWidgetConfigRefs` iterates the descriptor list calling `get`; a new `rewriteWidgetConfigRefs` iterates the same list calling `get`, remapping, then `set`. **There is exactly one enumeration of "where are the 8 reference sites."** Adding a REF-9 later means adding ONE descriptor, and both directions automatically pick it up — this is the design that makes drift *structurally impossible*, not just disciplined-against.

**Design B — Independent sibling rewrite functions, same file, hand-mirrored.** Add `rewriteWidgetConfigRefs`/`rewriteLayerRefs`/`rewriteDynamicViewRefs` as separate functions, each re-enumerating REF-1..8 (or the layer/dv subset) with its own `if`/`switch` blocks, placed immediately next to their collect counterparts in the same file, sharing only the low-level primitives (`asId`, sentinel filter, `getOptionActionsLike`). This is what Phase 119's own doc-comment ("Adding a NINTH reference kind ... requires updating this module") already anticipates in spirit, but if read literally it only obligates updating the *collect* side — a future engineer could add REF-9 to `collectWidgetConfigRefs` and genuinely forget the mirrored line in `rewriteWidgetConfigRefs`. Two lists, even in one file, can drift.

### Recommendation: Design A, with one caveat

**Recommend Design A** — the drift risk is the deciding criterion the task explicitly names, and Design A is the only one of the two that removes the *possibility* of drift rather than relying on a reviewer noticing a missing mirrored branch. The caveat: Phase 119's own 119-RESEARCH.md explicitly rejected a *fully generic recursive JSON walker* for export, for a real reason — it would over-match ordinary numeric config (`page_size`, `opacity`) and under-match the legacy singular `action` field. Design A above is **not** that rejected design: it is not "walk all JSON and guess," it is "one hand-written descriptor per known site, iterated by a generic driver" — the site-specific knowledge (which field, what shape, what the sentinel is) still lives in hand-written code, only the *iteration and dispatch* is shared. This distinction is the entire reason Design A is safe here where a truly generic walker would not be.

**Practical sizing note:** this refactor touches code with an existing, passing, 257-line unit-test file (`tests/lib.dashboardExportRefs.spec.ts`) and a 596-line integration fixture (`tests/routes.dashboard-export.spec.ts`) that Phase 119 ran 20 mutation probes against. **The plan MUST keep both files green, unmodified in their assertions, as a regression gate** — if refactoring `collectWidgetConfigRefs`'s internals to be descriptor-driven changes its *output* in any way, that is instant, loud proof of a mistake. Do not relax or rewrite those existing tests to make a refactor pass; if a descriptor-driven rewrite cannot keep them green untouched, fall back to Design B (still not a fork — same file, shared primitives) rather than accepting silent behavior drift in the already-shipped export path.

### The REF-6 / REF-7 / REF-8 rewrite rules specifically (Q2, answered in Q1's design terms)

- **REF-6 `includedLayerIds`:** rewrite rule is "map every element through the layer id-map; if the array is empty, output `[]` unchanged; if the field is absent, leave it absent." The trap is not the mechanics of `.map()` (mapping zero elements already trivially produces `[]`) — it is a *plausible but wrong* "helpful" implementation that treats emptiness as "this widget currently means all layers, so let me materialize the concrete list of new layer ids for clarity." That would be a **behavior change**: a widget currently meaning "always render every layer, including future ones" would silently become "render only these N layers, frozen at import time." The rewritten field must be structurally identical in shape (empty stays empty, present-with-N-elements stays present-with-N-remapped-elements) — never re-interpreted.
- **REF-7 `allowedSourceWidgetIds`:** the existing `asId()` predicate (`typeof v === "number" && Number.isInteger(v) && v > 0`) is exactly the tool that makes this safe, and it must be reused unchanged rather than rewritten. A naive `.map(id => widgetIdMap.get(id))` would look up `"__spatial_draws__"` in a `Map<number, number>` and get `undefined` back, which would then either throw (if the code enforces "unmapped means dangling, drop it") or silently write `undefined`/`null` into the array, **destroying the sentinel and quietly breaking spatial-draw filtering** on the imported dashboard — a defect indistinguishable from "everything worked" until an operator draws a shape on the map and nothing filters. The rewrite rule must check `asId(entry) !== undefined` first: numeric entries get remapped (or dropped if unmapped/dangling), the sentinel string (or any other non-numeric future value) passes through **completely untouched**, not even inspected.
- **REF-8 (`options[].actions[].target` + legacy `options[].action.target`):** the existing `getOptionActionsLike()` reader must be mirrored by a `rewriteOptionActionsLike()` that performs the SAME `Array.isArray(option.actions) ? ... : option.action ...` branch, so any option's *actions* are found and rewritten in whichever shape they are actually stored (new array or legacy singular) — mutating in place preserves `configPatch` verbatim (already proven to contain no ids) and only replaces `target.id`, dispatching on `target.kind` (`"widget"|"layer"|"dynamicView"`) to the matching id-map, exactly mirroring the collect side's `switch`.

### Ordering — the create-then-rewrite sequence

Confirmed from the actual accessor signatures (`db.ts`):
- `createWidget(dashboardId, { title, type, position, config })` — config is set at creation; there is no way to create a widget without *some* config.
- `createDashboardLayer(dashboardId, { table_id, layer_type?, position?, config? })` — **does not accept `dynamic_view_id` or `filter_scope` at all.** Both are settable only via `updateDashboardLayer(id, attrs)`, which already supports the `"key" in attrs` discriminant for explicit-null-vs-omit.

This is not incidental — it means the codebase's own existing write API already forces a two-step layer lifecycle (create-with-table_id, then update-with-the-rest), which the import can reuse directly rather than inventing a new accessor. Recommended sequence, all inside one transaction:

1. **Tables** — for each exported table, look up by `(schema, name)`; reuse if found, `createTable({ schema, name, columns, description })` if not. Build `tableIdMap: Map<oldId, newId>`.
2. **Dynamic views** — for each, `createDashboardDynamicView(newDashboardId, { source_table_id: tableIdMap.get(dv.source_table_id)!, name, template_sql, max_records, columns_json })`. Build `dvIdMap`.
3. **Custom metrics** — for each REFERENCED metric in the file, resolve `table_id` via `tableIdMap`, then match-by-label (Q4) or `createCustomMetric(...)`. Build `metricIdMap`.
4. **Widgets** — for each, `createWidget(newDashboardId, { title, type, position, config: {} })` (placeholder — the real config is not yet safely writable because it may reference a layer or sibling widget that doesn't have a new id yet). Build `widgetIdMap`.
5. **Layers** — for each, `createDashboardLayer(newDashboardId, { table_id: tableIdMap.get(layer.table_id)!, layer_type, position, config: layer.config })` (layer's own `config` carries no ids, per Phase 119 — travels verbatim, no placeholder needed), then immediately `updateDashboardLayer(newId, { dynamic_view_id: layer.dynamic_view_id ? dvIdMap.get(layer.dynamic_view_id) : null })` (dv id map is already complete from step 2 — no placeholder needed here either). Build `layerIdMap`. `filter_scope` is deliberately NOT set yet.
6. **Rewrite pass (only possible now that all 5 maps are complete):** for each original widget, compute `rewriteWidgetConfigRefs(originalConfig, { tableIdMap, widgetIdMap, layerIdMap, dvIdMap, metricIdMap })` and `updateWidget(widgetIdMap.get(originalWidget.id)!, { config: rewritten })`. For each original layer with a non-null `filter_scope`, compute the remapped value via the shared `remapFilterSelectionRefs` helper and `updateDashboardLayer(layerIdMap.get(originalLayer.id)!, { filter_scope: JSON.stringify(rewritten) })`.
7. **`addDashboardTable`** for every id in the file's `dashboardTableIds` (mapped through `tableIdMap`) — reproduces the union edge Phase 119 exported.

Step 6 is genuinely a *second pass over the whole entity set*, not an incremental "create widget, immediately patch its own forward refs" — because a widget's refs may point at a *sibling* widget or a layer that is only guaranteed to exist once step 5 has finished. Confirms the phase framing's ordering concern (REF-3) generalizes to the widget↔layer cycle, which is the harder version of the same problem.

## Q2 — The Three Traps, Import Side

Answered inline in Q1's rewrite-rule section above (REF-6, REF-7, REF-8). Restated as a compact table for the planner:

| Trap | Wrong instinct | Correct rewrite rule |
|---|---|---|
| REF-6 empty array | "Expand empty/absent to the full new layer-id list for clarity" | Never re-interpret; empty stays `[]`, absent stays absent, non-empty gets each element remapped |
| REF-7 sentinel string | `.map(remap)` over the whole array (throws or nulls the sentinel) | `asId()`-gate first; numeric passes through the id-map, non-numeric (the sentinel, or anything unknown) passes through completely unchanged |
| REF-8 legacy `action` | Only rewrite `options[].actions[]`, silently skip pre-Phase-60.2 rows that only have singular `action` | Reuse the exact `getOptionActionsLike()` branch logic (mirrored, not re-derived) so both shapes are found and rewritten |

## Q3 — Table Matching by `schema.name`

**`tables` has NO unique constraint today** — confirmed by reading `SCHEMA_DDL` in `db.ts` directly (`id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, schema TEXT NOT NULL DEFAULT ''` — no `UNIQUE`, no composite index on `(schema, name)`). `createTable()` performs a bare `INSERT`, no existence check. **Duplicates for the same `(schema, name)` pair can already exist in a real, pre-existing database** — nothing in the current app prevents an operator from registering the same physical table twice via `POST /api/tables`.

No existing accessor does this lookup (grepped `db.ts` for `WHERE schema` / `schema = ?` outside `updateTable` — zero hits). **A new accessor is required:** `getTableBySchemaName(schema: string, name: string): Table | undefined`. This is a new function, not a schema change — no `ALTER TABLE`, no new index, no new constraint. **Per the "no schema change" constraint, do NOT add a `UNIQUE(schema, name)` index or constraint as part of this phase**, even though it would resolve the ambiguity — that is an out-of-scope schema change and would need its own migration/backfill story (what happens to *existing* duplicate rows on upgrade?). This is the one place in this research where "say so loudly if you conclude a schema change is needed" applies in reverse: **a schema change would arguably be the more correct long-term fix, but it is explicitly out of this phase's scope, so state the limitation instead of silently working around it.**

**Recommended policy for pre-existing duplicates:** `getTableBySchemaName` should query `ORDER BY id ASC LIMIT 1` (oldest row wins, deterministic) and simply proceed — this phase does not need to detect or resolve pre-existing duplicate registry rows, it only needs to not **create a third**. Document this explicitly as a known limitation in the import report/code comment rather than silently picking a row with no stated rule.

**What "create when missing" needs:** exactly `schema`, `name`, `columns` (`Record<string,string>`) from the export's `tables[]` entries — `createTable()`'s existing signature already accepts all three plus optional `description`. No new fields needed.

**Interaction with `dashboard_tables` (union edge):** the file's `dashboardTableIds` array (Phase 119's export already separates this from the walk-derived table set) drives step 7 above — call `addDashboardTable(newDashboardId, tableIdMap.get(oldTableId)!)` for each. `addDashboardTable` already does `INSERT OR IGNORE` (idempotent), so no special-casing is needed even though the target dashboard is guaranteed brand-new (every insert will succeed on the first attempt in practice; `OR IGNORE` is simply harmless here).

**Interaction with `dashboard_layers.table_id` (soft FK, no REFERENCES):** since this column has no `REFERENCES` clause, `createDashboardLayer` can be called with any integer, including a genuinely-orphaned `tableIdMap` miss. This should not happen in a well-formed file (pre-flight validation, Q6, should catch it), but if it does the layer will render with the app's existing "orphan layer" error-badge behavior (documented soft-FK contract) rather than crash — worth noting as an existing safety net, not something import needs to defend against separately.

## Q4 — Custom Metrics: the label/expression conflict

`custom_metrics` has `UNIQUE(table_id, label)` — confirmed in `SCHEMA_DDL` (`db.ts:264`, comment: *"UNIQUE(table_id, label) enforces unique label per table (the 409 source)"*). This means "matched by label where already present" (CONTEXT.md decision #3) is not just a suggested policy, it is a **real constraint** the import will hit if it tries to blindly `createCustomMetric` a metric whose (table_id-after-matching, label) pair already exists in the target — the insert will throw a SQLite constraint violation.

**The genuine open question:** CONTEXT.md's locked wording — *"matched by label where already present"* — does not condition matching on the expression being identical. Read literally, the locked decision says: same table + same label ⇒ reuse, full stop, regardless of the underlying SQL. But if the target's existing metric under that label has a **different expression** than the one in the file, reusing it silently changes what the imported widget computes (the widget references the metric by id, has no idea the label-matched row means something different in this environment) — this is precisely the "silent wrong data" failure mode this phase's framing warns about, just for metrics instead of table references.

**Two options, with a recommendation:**
1. **Reuse-and-warn (recommended)** — honors the locked decision's plain reading (reuse by label is the rule, not conditioned on expression), but the import report gains a `metricConflicts: [{ tableId, label, existingExpression, importedExpression }]` array whenever a label match is found with a differing expression, so the operator gets a visible, structured signal (DXIM-V124-10's "report what it did" already requires naming metrics matched vs created — extending it to also flag *conflicting* matches is a natural, low-cost addition, not scope creep). This keeps the whole import from failing over what may be a benign SQL-dialect variance across environments, while still satisfying "design for detectability."
2. **Hard-fail the whole import on any conflict** — stricter, but contradicts the plain reading of the locked decision (which says nothing about expression equality being a precondition for matching), and would make importing into a target environment that happens to reuse common metric labels ("Total Revenue") for genuinely different SQL needlessly brittle.

**Recommendation: option 1.** This is presented as a recommendation, not a fact — CONTEXT.md itself flags this exact scenario as needing the planner's judgment ("This is a genuine design question — surface it with a recommendation"), and the two options are a real tradeoff, not a hidden bug to fix.

## Q5 — Atomicity

**Transaction precedent, confirmed (3 existing sites):** `db.ts:825` (`reorderDashboardLayers`, wraps a sequence of `UPDATE`s), `index.ts:210` (an existing bootstrap-time transaction), `lib/rbacSeed.ts:57` (seed transaction). All follow the same `better-sqlite3` idiom: `const txn = db.transaction((args) => { ...sync statements... }); txn(args);` — synchronous, and **any thrown exception inside the callback automatically rolls back every statement executed so far in that call**, no explicit `ROLLBACK` needed. Import's entire Pass 1 + Pass 2 sequence (Q1) belongs inside exactly one such `db.transaction()` call — every `create*`/`update*`/`addDashboardTable` call in the sequence is itself synchronous SQLite, so nothing about better-sqlite3's sync-only transaction requirement is violated.

**Testing atomicity — no existing precedent for the specific mechanism needed.** Grepped every `vi.spyOn`/`vi.mock` use in `packages/server/tests/*.ts`: the only mocked-failure precedent (`tests/lib.materializedView.spec.ts`) mocks an **async Kinetica SQL client boundary** (`mockRejectedValueOnce`), not a `db.ts` accessor — and `db.ts` exports its functions as plain named `const` exports, imported via destructuring elsewhere (`import { createWidget, ... } from "./db"`), which ESM module semantics make **unreliable to `vi.spyOn`** once destructured at another module's import site (the spy would need the importing module to use `import * as db from "./db"` and call `db.createWidget(...)`, which `dashboardExport.ts`/`dashboardImport.ts` do not and should not need to restructure just for one test).

**Recommended design — a natural, real-constraint fault, fired late:** structure Pass 1's creation order so custom metrics are created **last** (after tables, dynamic views, widgets, and layers all already have real rows in the same transaction — see Q1's step ordering, metrics step 3 can be deferred to just before step 6 without breaking any dependency, since nothing in steps 4-5 needs a metric id to exist yet, only the Pass-2 widget-config rewrite does). The atomicity test then seeds the **target** database with a custom metric on the table that the import's own table-matching will resolve to, using the SAME `(table_id, label)` pair as one of the fixture's imported metrics — a genuine `UNIQUE(table_id, label)` violation fires naturally when the import tries to `createCustomMetric` that entry (assuming the label-match-and-reuse logic, Q4, is bypassed for this one deliberately-conflicting row by giving it a matching label but asserting the test seeds it in a way the code's own matching does NOT catch — e.g. seed it with a different case or whitespace variant if the matching is exact-string, or more simply and more robustly: seed the SAME label with a table_id that the matching logic will NOT associate with this import, e.g. seed the exact (resolved table_id, label) combination directly into the DB out-of-band via `db.exec`, bypassing the app's own createCustomMetric so the app's own reuse-lookup never sees it as "the same import's target," but the raw SQLite UNIQUE index still fires when the import's create path attempts the insert). This exercises the REAL constraint the app already depends on, requires ZERO test-only hooks in production code, and — because it fires only after tables/widgets/layers already exist as real rows inside the SAME transaction — proves the strong claim: **rollback undoes not just the failing statement, but every already-succeeded statement earlier in the same import, across every affected table** (assert dashboard/widget/layer/table row counts, not just metric counts, are identical to their pre-import values afterward).

**Secondary/supplementary option:** if the plan additionally wants to test a failure point with no natural constraint to exploit (e.g., mid-way through Pass 2's rewrite loop), add a narrow, explicitly-labeled test-only injection seam (a parameter like `{ __testFailAfter?: "widgets" }` on the internal Pass-1/Pass-2 orchestrator, never on the exported route handler) — but this is optional; the metrics-constraint approach above is sufficient to satisfy DXIM-V124-09's actual requirement and should be the primary test.

## Q6 — Validation and Permissions

### Validation strictness (DXIM-V124-11)

**No `zod` on the server** — confirmed: `packages/server/package.json` has no `zod` dependency (it exists only in `packages/web/package.json`, `^3.25.76`, used for `WidgetActionTargetSchema` etc. client-side). Introducing it server-side to validate the import file would be a **new dependency**, which the phase's constraints forbid absent a genuinely unavoidable reason — and it is not unavoidable here.

**Recommended level: structural checks, not full schema validation.** Mirror the pattern already used throughout `dashboardExportRefs.ts` itself (`isPlainObject`, `Array.isArray`, `asId`'s `typeof`/`Number.isInteger` guards) — plain `typeof`/`Array.isArray`/`isPlainObject` assertions on the envelope's top-level shape (`schemaVersion` is a positive integer, `dashboard`/`widgets`/`layers`/`dynamicViews`/`tables`/`customMetrics`/`dashboardTableIds` are present with the right JS types) plus, critically, **a referential pre-flight pass that runs BEFORE the transaction opens**: reuse the *unmodified* `collectWidgetConfigRefs`/`collectLayerRefs`/`collectDynamicViewRefs` from Phase 119 to recompute what each widget/layer/dv in the FILE references, and verify every referenced id is a member of the file's own `widgets`/`layers`/`tables`/`dynamicViews`/`customMetrics` id sets **or** was already declared dangling by the file's own `danglingReferences` array. Recommend **not trusting** the file's self-reported `danglingReferences` at face value (an adversarially or carelessly hand-edited file could lie) — recompute it fresh using the same `absorb()`-style membership check `dashboardExport.ts` already uses, and treat any freshly-discovered dangling reference the SAME way Phase 119 treats it: informational, not fatal (strip/null the reference at rewrite time, and surface it in the import report), reserving hard REJECTION for genuinely **structural** malformation (wrong top-level types, missing required keys, an id field that isn't a number where one is required, a JSON parse failure) — never for a dangling reference to something outside the file's own scope, which is a legitimate, previously-observed real-world case (Phase 119's own `DANGLE-cross` test: a legend bound to a widget on another dashboard).

This gives a **two-tier validation model**: (1) structural — reject with a clear message, zero DB writes attempted; (2) referential-dangling — accept, strip, and report. Both checks run entirely in memory, before `db.transaction()` opens, so DXIM-V124-11's "changes nothing" guarantee for a rejected file is trivially true (nothing was ever written) rather than depending on transaction rollback at all.

### Unrecognised `schemaVersion`

Recommend: reject with a clear, specific message (`"Unsupported schemaVersion: 2 (this build supports 1)"`) rather than attempting a best-effort import — Phase 119 defined `EXPORT_SCHEMA_VERSION = 1` as a plain incrementing integer specifically so `version > SUPPORTED_MAX` is a trivial, unambiguous check (119-RESEARCH.md Q4). A future version-2 file is either forward-incompatible (this build genuinely cannot understand its shape) or requires an upgrade path this phase does not need to design. Treat any version other than the exact value(s) this build recognizes as a structural-validation rejection (tier 1 above), not an attempted-and-possibly-wrong import.

### Permissions

**Confirmed: no new permission needed.** `DEFAULT_ROLE_MAPPINGS` (`lib/permissions.ts`) shows `designer` already holds BOTH `PERMISSIONS.DASHBOARDS_CREATE` and `PERMISSIONS.DATASETS_MANAGE`; `admin` holds all 18 by construction; `analyst` holds only `DASHBOARDS_VIEW`; `user_admin` holds neither. This is exactly the split import needs (designers/admins can import; analysts/user_admins cannot) with **zero role-mapping changes**.

**Composing the gate needs no new code:** `rbac.ts`'s `requirePermission(permission)` factory returns `[requireAuth, checkFn]`, and its own doc comment states `requireAuth` is "idempotent; safe to call twice." Spreading two calls back-to-back —
```ts
app.post(
  "/api/dashboards/import",
  ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE),
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  (req, res) => { /* handler */ }
);
```
— produces a genuine AND-gate (both permission checks must independently call `next()`), matching every other route's registration style in `index.ts` exactly, and is precisely the composition CONTEXT.md's own code-context section already names as the plausible gate. **Ripple avoided:** since no `PERMISSIONS` entry is added, none of the four known ripple sites (`lib.permissions.spec.ts` — two `toBe(18)`/`toHaveLength(18)`-style assertions, `db.rbacMigration.spec.ts`, `RolesPage.spec.tsx`) need touching; current counts (verified 2026-09-16): `grep -rn "toBe(18)" packages/server` → 10 lines across the suite (includes `routes.dashboard-export.spec.ts`'s own PARITY test from Phase 119), `grep -rn "toHaveLength(18)" packages/server` → 2. A plan that adds no permission should explicitly assert these counts are **unchanged**, not newly created.

**A body-size finding worth flagging (not previously documented anywhere in this milestone):** `app.use(express.json({ limit: "1mb" }))` is a **global** body-parser limit (`index.ts:144`), applied ahead of every route. If the import route accepts the file as a JSON body, a sufficiently large real dashboard export (many widgets with large `config` blobs, e.g. long `columns_json` arrays or many custom metrics) could exceed 1MB and be rejected by Express's body-parser with a generic, unhelpful 413 — **not** the clear DXIM-V124-11 message this phase is supposed to produce for malformed files. This is a genuinely different failure mode (oversized-but-well-formed) that the route's own validation code never even sees. Recommend the plan explicitly decide: (a) accept the 1MB global cap as adequate for realistic dashboard sizes (Phase 119's own operator export of a 7-widget/4-layer/3-table dashboard was well under it) and document the limitation, or (b) give this one route a larger, route-specific `express.json({ limit: "10mb" })` override (Express supports per-route body-parser middleware ahead of the shared one), or (c) use `multer` (already a dependency) for a multipart upload, which is not subject to the JSON body-parser's limit at all. This is Claude's Discretion per CONTEXT.md but deserves an explicit decision, not a silent inheritance of the global cap.

## Code Examples

### Reusable primitives already in `dashboardExportRefs.ts` (import must reuse these, not redefine them)
```ts
// Source: packages/server/src/lib/dashboardExportRefs.ts
const asId = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;

// getOptionActionsLike mirrors packages/web/src/lib/radioGroupConfig.ts's getOptionActions —
// reads NEW actions[] OR falls back to the LEGACY singular action field.
const getOptionActionsLike = (option: Record<string, unknown>): ActionLike[] => {
  if (Array.isArray(option.actions)) return option.actions as ActionLike[];
  if (option.action && typeof option.action === "object") return [option.action as ActionLike];
  return [];
};
```

### The two-step layer lifecycle that FORCES the two-pass import design
```ts
// Source: packages/server/src/db.ts — createDashboardLayer's own signature has no
// filter_scope / dynamic_view_id parameter; only updateDashboardLayer sets them.
export const createDashboardLayer = (
  dashboardId: number,
  input: { table_id: number; layer_type?: "KineticaWms"; position?: number; config?: Record<string, unknown> }
): DashboardLayer => { /* ... */ };
```

### The transaction idiom to reuse verbatim
```ts
// Source: packages/server/src/db.ts:824-828 (reorderDashboardLayers), the only
// same-shape precedent for a multi-statement atomic sequence in this codebase.
const txn = db.transaction((ids: number[]) => {
  ids.forEach((id, index) => updateStmt.run(index, id));
});
txn(orderedIds);
```

### Composing two permissions with zero new code
```ts
// Source: packages/server/src/rbac.ts — requirePermission()'s own doc comment:
// "[0] requireAuth ... idempotent; safe to call twice when global app.use(...) is also mounted"
app.post(
  "/api/dashboards/import",
  ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE),
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  (req, res) => { /* ... */ }
);
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Enumerating the 8 reference kinds again | A second hand-maintained list in a new import module | Extend `dashboardExportRefs.ts` in place (Design A, Q1) | Two lists drift silently — the exact failure this phase exists to prevent |
| JSON schema validation of the uploaded file | `zod` (or any new validation library) on the server | Plain `typeof`/`Array.isArray`/`isPlainObject` structural checks, matching the style already used throughout `dashboardExportRefs.ts` | No new dependency; server has zero existing zod usage (web-only); the existing pure-module style already demonstrates this is sufficient |
| Table dedup by `schema.name` | A new UNIQUE index/constraint | Application-level `getTableBySchemaName` lookup, first-match-wins | Adding a constraint is a schema change (out of scope) and doesn't resolve what to do with pre-existing duplicate rows anyway |
| Injecting a mid-transaction test failure | An ESM spy on a destructured `db.ts` named export | A real `UNIQUE(table_id, label)` violation, seeded out-of-band, fired late in the creation order | ESM named-export spying is unreliable in this codebase's import style (no existing precedent); a real constraint needs no test-only production code |

**Key insight:** every "don't hand-roll" item above resolves to "reuse something that already exists in this codebase" — table matching aside (which needs one small new accessor), this phase adds no new abstraction, only extends Phase 119's.

## Common Pitfalls

### Pitfall 1: Treating the collect functions as sufficient for rewriting
**What goes wrong:** assuming `ExportRefs`' flattened id lists can drive an in-place rewrite.
**Why it happens:** the module's own doc comment says "Phase 120's import remapper consumes the same `ExportRefs` shape produced here," which is true for BUILDING the id maps (which old ids need a mapping) but not for WRITING the remapped config back — that needs position information the collector deliberately discards.
**How to avoid:** build the id maps from `ExportRefs`-shaped collection (fine), but perform the actual JSON rewrite via a dedicated traversal (Q1 Design A) that revisits each site directly.
**Warning signs:** a "rewriter" that takes `ExportRefs` as its only input and has no access to the original `config` object.

### Pitfall 2: Ordering by naive topological sort
**What goes wrong:** trying to compute "widgets depend on layers depend on tables" and process strictly in dependency order — this is impossible because widgets and layers reference each other (widget→layer via `includedLayerIds`/action targets; layer→widget via `filter_scope`).
**Why it happens:** REF-3 (widget→widget) is the only ordering issue CONTEXT.md's table names explicitly; the widget↔layer cycle is easy to miss because it spans two different entity kinds.
**How to avoid:** the two-pass design (Q1) sidesteps ordering entirely — create everything with placeholders first, rewrite everything only once every id map is complete.
**Warning signs:** a plan phrased as "create tables, then layers, then widgets, remapping refs inline as each is created" — this ordering cannot work for the cyclic pair no matter what order layers/widgets are listed in.

### Pitfall 3: Silently leaving an unresolved reference as its original numeric id
**What goes wrong:** a reference whose target isn't in this dashboard's own file (a cross-dashboard dangling ref, or a genuinely corrupt id) gets left as-is in the rewritten config because "no mapping found" is treated as "nothing to do."
**Why it happens:** it's the path of least resistance — `idMap.get(oldId) ?? oldId` looks harmless.
**How to avoid:** explicitly strip/null any reference that isn't in the corresponding id map, never fall back to the original value — an unmapped old id in the TARGET environment is exactly the "points at a pre-existing unrelated record" failure this whole phase exists to prevent.
**Warning signs:** any `??` or `||` fallback to the original id in rewrite code.

### Pitfall 4: Reading `filter_scope` as always a string
**What goes wrong:** code that assumes `layer.filter_scope` (typed `string | null` in `types.ts`) is always a raw string and calls `JSON.parse` on it — but `mapDashboardLayer` already parses it before handing it back, so the DTO's runtime value is an object despite the type annotation (a known, documented type/runtime mismatch — Phase 119's own `collectFilterSelectionRefs` explicitly handles both shapes for this reason).
**Why it happens:** trusting the TypeScript type over the actual runtime shape.
**How to avoid:** reuse `collectFilterSelectionRefs`'s existing "accept either a string or an already-parsed object" pattern in the rewrite counterpart too; when writing, always `JSON.stringify()` before calling `updateDashboardLayer` (mirrors the write side documented in `db.ts`'s own comment: "Route stringifies ... on write").
**Warning signs:** a rewrite helper typed to accept only `string`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| N/A — this is new functionality | N/A | — | No prior import capability exists in this codebase; there is nothing being replaced |

**Deprecated/outdated:** none — this section is not applicable; Phase 120 is greenfield within an established schema.

## Open Questions

1. **Metric label/expression conflict policy (Q4)**
   - What we know: `UNIQUE(table_id, label)` makes blind-create fail on collision; CONTEXT.md's locked wording says "matched by label," full stop.
   - What's unclear: whether the operator intends "matched by label" to implicitly assume same-expression-when-same-label (an assumption that may not hold across environments), or genuinely wants reuse regardless.
   - Recommendation: reuse-and-report (Q4 option 1) — matches the locked wording literally, adds detectability via the import report rather than failing the whole operation. Flag for confirmation if the planner wants a stricter (fail-on-conflict) policy instead — both are defensible, this is a real tradeoff not a fact.

2. **Body-size limit for the import route**
   - What we know: the global `express.json({ limit: "1mb" })` applies unless overridden; Phase 119's own operator export (7 widgets/4 layers/3 tables) was comfortably under it.
   - What's unclear: whether any real target dashboard could plausibly exceed 1MB pretty-printed (many widgets, large `columns_json`, many custom metrics).
   - Recommendation: default to accepting the global 1MB limit (document the number) unless the planner has reason to expect larger real dashboards; a route-specific override is a one-line change if needed later (Claude's Discretion per CONTEXT.md — this research surfaces the question, doesn't answer it for the operator).

3. **Pre-existing duplicate `(schema, name)` rows in a real deployment**
   - What we know: no constraint has ever prevented this; `getTableBySchemaName` (new) will need a deterministic tie-break.
   - What's unclear: whether any real deployment actually has such duplicates today (this research did not query a live database — only the schema DDL and code paths).
   - Recommendation: `ORDER BY id ASC LIMIT 1`, documented as a known, deliberate limitation — not something this phase needs to detect or repair.

## Grep-Based Acceptance Criteria (run 2026-09-16, all currently 0/absent as required by CLAUDE.md)

All candidate anchor symbols below were checked against the current tree with the exact commands shown. **None of these should be treated as pre-committed function names** — the planner should verify (re-run the grep) against whatever names the actual plan introduces, per CLAUDE.md's "run every grep you propose" rule; these are candidates with their current (pre-work) counts, not a prescription.

| Candidate symbol | Command | Current count | Verdict |
|---|---|---|---|
| `importDashboard` | `grep -rn "importDashboard" packages/server/src packages/server/tests packages/web/src \| wc -l` | 0 | Safe anchor |
| `buildDashboardImport` | same pattern | 0 | Safe |
| `applyDashboardImport` | same pattern | 0 | Safe |
| `rewriteWidgetConfigRefs` | same pattern | 0 | Safe — only if the planner adopts this exact name |
| `rewriteLayerRefs` | same pattern | 0 | Safe |
| `rewriteDynamicViewRefs` | same pattern | 0 | Safe |
| `getTableBySchemaName` | same pattern | 0 | Safe |
| `dashboards/import` (route path) | same pattern | 0 | Safe — confirms no existing route collides |
| `IMPORT_SCHEMA_VERSION` / any import-side version constant name | same pattern | 0 | Safe |
| `routes.dashboard-import.spec.ts` (file existence) | `test -f packages/server/tests/routes.dashboard-import.spec.ts` | absent | Safe — new file |
| `lib.dashboardImport.spec.ts` (file existence) | `test -f packages/server/tests/lib.dashboardImport.spec.ts` | absent | Safe — new file |
| `toBe(18)` (ripple-avoidance, repo-wide) | `grep -rn "toBe(18)" packages/server \| wc -l` | 10 | Use as a "still 10 occurrences, unchanged" NEGATIVE-space check — a plan proving no new permission was added should assert this is UNCHANGED post-work, not newly appearing |
| `toHaveLength(18)` (ripple-avoidance) | `grep -rn "toHaveLength(18)" packages/server \| wc -l` | 2 | Same — assert unchanged |
| `UNIQUE(table_id, label)` (confirms the real constraint exists, for the atomicity test's own justification) | `grep -rn "UNIQUE(table_id, label)" packages/server/src \| wc -l` | 2 (DDL comment + DDL line) | Informational — not a work-introduced anchor, don't use as a pass/fail criterion |

**Guidance for the planner:** do not anchor on `db.transaction(` (already occurs 3 times for unrelated reasons — reorderDashboardLayers, an index.ts bootstrap sequence, rbacSeed) or on `requirePermission(PERMISSIONS.DASHBOARDS_CREATE)` (already occurs 7 times / `requirePermission(PERMISSIONS.DATASETS_MANAGE)` 9 times across existing unrelated routes) — neither discriminates the new import route from existing ones. Anchor on the literal new route path string or a newly-introduced function/constant name, verified absent first exactly as done above.

**Mutation-probe priority (per CLAUDE.md/task framing):** the highest-value probes for this phase specifically **disable one reference kind's rewrite** (e.g., temporarily make `rewriteWidgetConfigRefs` skip the REF-6 branch, or make REF-7's sentinel-check a no-op `.map(remap)`) and prove a test reddens — this is the direct simulation of "a missed reference does not error, it silently points at a pre-existing/foreign record." Recommend at minimum one such probe per reference kind (8 probes) plus one for the dashboard_tables union edge and one for the atomicity rollback (Q5) — mirroring Phase 119's 20-probe, zero-non-firing standard.

## Sources

### Primary (HIGH confidence — direct code inspection, this repo, 2026-09-16)
- `packages/server/src/lib/dashboardExportRefs.ts` (full file, 251 lines) — the shared inventory this phase must extend, not fork
- `packages/server/src/lib/dashboardExport.ts` (full file) — the envelope shape, `EXPORT_SCHEMA_VERSION`, the `absorb()`/dangling-reference pattern to mirror for pre-flight validation
- `packages/server/tests/routes.dashboard-export.spec.ts` (full file, 596 lines) — the kitchen-sink fixture; the round-trip test's natural basis
- `packages/server/tests/lib.dashboardExportRefs.spec.ts` (existence + line count confirmed, 257 lines) — the regression gate a Q1 refactor must keep green
- `packages/server/src/db.ts` (full `SCHEMA_DDL`, all `create*`/`update*`/`get*` accessors for dashboards, tables, dashboard_tables, dashboard_layers, dashboard_dynamic_views, custom_metrics) — confirmed no `(schema,name)` unique constraint, confirmed `custom_metrics UNIQUE(table_id, label)`, confirmed `createDashboardLayer`'s signature excludes `filter_scope`/`dynamic_view_id`, confirmed the 3 existing `db.transaction()` call sites
- `packages/server/src/rbac.ts` — `requirePermission()` factory, confirmed `requireAuth` idempotency comment enabling back-to-back composition
- `packages/server/src/lib/permissions.ts` — full `PERMISSIONS` catalog (18 entries) and `DEFAULT_ROLE_MAPPINGS`, confirmed designer/admin hold both `DASHBOARDS_CREATE` + `DATASETS_MANAGE`, analyst/user_admin hold neither
- `packages/server/src/index.ts` — confirmed `express.json({ limit: "1mb" })` global body-parser limit, confirmed no existing multi-permission AND-gate precedent to copy beyond composing `requirePermission` twice, confirmed 7/9 existing occurrences of the two candidate permissions
- `packages/server/scripts/test-gate.mjs` (full file) — SET-BASED gate mechanics; re-run this session, GATE PASSED, 1044/1097, 8 known-failing, 0 unknown/isolation failures this run
- `packages/web/src/components/charts/filterSourceTypes.ts` — `SPATIAL_DRAWS_SENTINEL = "__spatial_draws__"` constant confirmed
- `packages/web/src/lib/radioGroupConfig.ts` — `getOptionActions()` canonical reader, confirmed mirrored by `getOptionActionsLike` in the server module
- `.planning/phases/119-export/119-RESEARCH.md`, `.planning/phases/119-export/119-04-SUMMARY.md`, `.planning/phases/120-import/120-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` §Phase 120 — locked decisions, requirement text, coverage limitation, success criteria

### Secondary / Tertiary
None used — no WebSearch or Context7 lookups were needed or appropriate; this phase (like 119) has zero third-party library surface (no new dependency permitted) and the entire problem is internal to this codebase's existing schema and accessors.

## Metadata

**Confidence breakdown:**
- Reference-kind rewrite design (Q1/Q2): HIGH — every rule grounded in the actual collect-function source and the actual accessor signatures that force the two-pass ordering
- Table matching (Q3): HIGH on the absence of a unique constraint (read directly from DDL); MEDIUM on the recommended tie-break policy (a reasonable default, not the only possible one)
- Custom metrics (Q4): HIGH on the constraint's existence; MEDIUM on the recommended conflict policy — explicitly flagged as a judgment call, not a fact
- Atomicity (Q5): HIGH on transaction precedent; MEDIUM on the fault-injection test design (a recommended pattern, not something already proven to work in this exact codebase — no existing test does this yet)
- Validation/permissions (Q6): HIGH — no new dependency needed (verified zod absent server-side), no new permission needed (verified via `DEFAULT_ROLE_MAPPINGS`), gate composition mechanism verified via `rbac.ts`'s own doc comment

**Research date:** 2026-09-16
**Valid until:** ~30 days, or immediately if Phase 119's `dashboardExportRefs.ts` is modified by any other work before this phase starts (re-read the file fresh — this research's line numbers and exact function bodies are a snapshot)
