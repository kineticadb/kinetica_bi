# Architecture Patterns: v2.0 AI-Driven Dashboards

**Domain:** AI agent that manipulates an existing BI dashboard (session layer + undo + Keep)
**Researched:** 2026-10-08
**Overall confidence:** MEDIUM-HIGH. Integration points are verified against the code. LLM-provider and SSE specifics are not verified against current vendor docs (this file is architecture, not stack), and the spikes below are real unknowns.

## Headline Recommendations

1. **The agent loop runs on the server. Mutations are applied on the client.** The server owns the LLM key, the provider adapter, the schema/query tools (which need the user's Kinetica creds) and audit. The *session layer* lives in the browser (`zustand`), so mutation tools are declarative: the server validates each op against a shadow copy of the dashboard sent with the request and streams it to the client over SSE. There is no client round-trip per tool call.
2. **Session layer = an ordered op log on the client, not DB rows.** Session-only entities get negative temp ids. Nothing is written to SQLite until "Keep", so isolation from other users, reload-revert and discard-revert are true by construction.
3. **Keep is a NEW transactional server endpoint** (`POST /api/dashboards/:id/ai-keep`) that reuses `lib/dashboardExportRefs.ts` id remapping (`RefIdMaps` + `remapWidgetConfigRefs`). It does NOT reuse `applyDashboardImport`, which always creates a new dashboard.
4. **Session-only dynamic views still materialize server-side.** Kinetica is the only data substrate and every dv read path is keyed by a `dashboard_dynamic_views` row id. This needs a new ad-hoc (inline-definition) materialize path. This is the riskiest unknown, so spike it first.
5. **Filters go through `filterStore` -> `filterCombinationStore` -> `/api/filter/materialize`, via a NEW module outside the action engine.** The `ACTION-ENGINE-NO-FILTER` invariant stays intact. The AI filter applier is a sibling, not part of `applyWidgetAction`.

## Recommended Architecture

```
 Browser (packages/web)                                     Server (packages/server)
 ┌──────────────────────────────────────────┐              ┌───────────────────────────────────────┐
 │ AiWidget (new widget type, portals only) │  POST (fetch │ routes/ai (new aiRoutes.ts)           │
 │  ask box [+ explanation + follow-ups]    │  + ReadableStream SSE)                              │
 │            │ ask(prompt, snapshot)       │─────────────▶│ requireAuth + requirePermission(AI_USE)│
 │            ▼                             │              │   ┌─────────────────────────────┐     │
 │ aiClient (stream reader)                 │◀─ SSE events─│   │ agentLoop (provider-agnostic)│    │
 │            │ step/op/explain/followups/done              │   │  LlmProvider adapter         │    │
 │            ▼                             │              │   │  tools:                      │    │
 │ aiSessionStore  (op log + inverses)      │              │   │   read: get_schema,          │    │
 │   ├─ structural derive (added/removed)   │              │   │         get_dashboard,       │    │
 │   ├─ patches -> widgetActionStore        │              │   │         run_query (gated)    │    │
 │   │   (source key AI_SOURCE_ID)          │              │   │   mutate (declarative):      │    │
 │   └─ filter ops -> aiFilterApplier       │              │   │    add/remove_widget,        │    │
 │        └─> filterStore -> materialize    │              │   │    add/remove_layer, add/    │    │
 │ Keep / Discard / Undo UI                 │  POST ai-keep│   │    remove_dynamic_view,      │    │
 │            └────────────────────────────────────────────▶│   │    patch_*, apply_filter     │    │
 │                                          │              │   └──────────┬──────────────────┘     │
 └──────────────────────────────────────────┘              │   shadowState (per request, from      │
                                                           │   client snapshot) validates ops      │
                                                           │   kineticaSql(req, sql, op AI_QUERY)  │
                                                           │   ai-keep txn (db.transaction)        │
                                                           └───────────────────────────────────────┘
```

### Component Boundaries

| Component | New/Modified | Responsibility | Talks to |
|---|---|---|---|
| `packages/shared/` (zod op + config schemas) | **NEW** | Single source for `AiOp` schema, `WidgetAction`, allow-list; imported by web and server | web, server |
| `packages/server/src/aiRoutes.ts` | **NEW** | `POST /api/ai/ask` (SSE), `POST /api/dashboards/:id/ai-keep`, `GET /api/ai/config` | index.ts wiring, rbac, db |
| `packages/server/src/lib/ai/agentLoop.ts` | **NEW** | Tool-use loop, step budget, abort on client disconnect, shadow-state validation | provider, tools |
| `packages/server/src/lib/ai/providers/{anthropic,openaiCompat}.ts` + `LlmProvider` interface | **NEW** | Pluggable provider (Claude default; OpenAI-compatible for local) | agentLoop |
| `packages/server/src/lib/ai/tools/*.ts` | **NEW** | Schema/dashboard context, guarded query, op-emitting mutation tools | db.ts, kinetica.ts |
| `packages/server/src/lib/ai/sqlGuard.ts` | **NEW** | Single-statement read-only SELECT validation for `run_query` | tools/runQuery |
| `packages/server/src/lib/aiKeep.ts` | **NEW** | Transactional promote of op log to DB with temp->real id map | db.ts, `dashboardExportRefs.ts` |
| `packages/server/src/kinetica.ts` | **MODIFIED** | Add `"AI_QUERY"` to `KineticaOp` union (audit tag only) | - |
| `packages/server/src/env.ts` + `lib/permissions.ts` | **MODIFIED** | `AI_*` env vars; optional `ai:use` permission (see Pitfall on count specs) | rbac |
| `packages/server/src/index.ts` | **MODIFIED** | Mount `aiRoutes`; add ad-hoc dv materialize route(s) | - |
| `packages/web/src/store/aiSessionStore.ts` | **NEW** | Op log, inverses, derived structural sets, undo/keep/discard, status | widgetActionStore, DashboardsPage |
| `packages/web/src/lib/aiOps/applyAiOp.ts` | **NEW** | Dispatch of each op; re-validates (never trust the stream) | stores |
| `packages/web/src/lib/aiOps/aiFilterApplier.ts` | **NEW** | The ONLY AI->filter contact point; calls `filterStore` actions | filterStore |
| `packages/web/src/components/charts/AiWidgetRenderer.tsx` + `AiConfigPanel.tsx` + `definitions/ai.ts` | **NEW** | Widget type (Compact/Full), registered in `definitions/index.ts` | aiClient, aiSessionStore |
| `packages/web/src/lib/widgetAction.ts`, `actionAllowList.ts` | **MODIFIED** | Allow-list v3 (wider patchable fields; relax `id: positive()` for temp ids); extract to shared | - |
| `packages/web/src/components/DashboardsPage.tsx` | **MODIFIED** | Compute `effectiveWidgets/Layers/DynamicViews` = base + session layer; reset in the cleanup chain; Keep/Discard bar | aiSessionStore |
| `packages/web/src/components/charts/MapChartRenderer.tsx`, `LegendRenderer.tsx`, `lib/applyLayerOverrides.ts` | **MODIFIED** | Read added/removed layers (not only overrides); wire temp-dv FROM-swap at BOTH `buildWmsParams` sites | aiSessionStore |
| `packages/web/src/hooks/useDynamicViewMaterializeChain.ts` | **MODIFIED** | Include session dvs in the cascade (calls the ad-hoc materialize) | dynamicViewStore |
| `packages/web/src/api/client.ts` | **MODIFIED** | `askAi` stream reader, `keepAiChanges`, ad-hoc dv materialize | - |

## Q1. Where the agent loop runs: server

**Why server (verified constraints):**
- The LLM API key must never reach the browser (and `/api/*` is behind `requireAuth`, so per-user rate limit and audit are cheap).
- The `run_query` tool needs the user's Kinetica creds. Those live encrypted in `sessionStore.ts` and are only available server-side (`req.user.creds`, or `principalForSession(sid)` in `lib/exportRunner.ts:158` for work that outlives a request).
- Provider pluggability (Anthropic vs OpenAI-compatible local) is an adapter concern; the browser should not know about it. Local models are usually only reachable from the server network.
- RBAC and the allow-list gate can be enforced before ANY op reaches the client.

**The wrinkle:** the session layer is client state (it must be per-user, per-tab, and vanish on reload). So the server can't mutate it.

**Resolution: declarative mutation tools + shadow state.**
1. `POST /api/ai/ask` body: `{ dashboardId, prompt, snapshot, mode, history? }`. `snapshot` = the *effective* dashboard (base + current session layer): widgets (id, type, title, config minus bulky fields), layers, dynamic views, active filters, table ids.
2. The agent loop keeps a mutable `shadowState` initialised from `snapshot`. A mutate tool (e.g. `add_widget`) validates its args (zod + allow-list + referenced ids exist in `shadowState` + table is on the dashboard), updates `shadowState`, returns a short tool_result to the LLM, and emits an `op` SSE event. The LLM gets immediate feedback; there is no client round trip.
3. The client applies each `op` as it arrives (and re-validates it with the shared schema; the stream is not trusted).
4. Server-side errors (invalid column, unknown id) are tool_results with `isError`, so the model self-corrects within the step budget.

*Rejected alternative:* client-executes-tools-and-returns-results (server pauses mid-loop). Needs a second endpoint, request correlation, timeouts when the tab closes, and gives no real benefit because mutation results are fully predictable from shadow state.
*Rejected alternative:* browser-side loop with a thin LLM proxy. Leaks provider concerns to the client, and the query tool would still need a server route per call.

**Statelessness:** do NOT keep conversation state server-side (the product is "not a chat transcript"). The client sends the snapshot + the last few Q/A summaries; the server holds nothing between requests. This also makes horizontal restarts safe. Only an in-flight `AbortController` is held per request.

Confidence: HIGH on the split (follows directly from where creds and session state live).

## Q2. Tool surface

| Tool | Executed | Maps to | New? |
|---|---|---|---|
| `get_schema(tableId?)` | server | `db.ts` tables registry + cached columns; `kineticaShowTable` for refresh | tool new, data exists |
| `get_dashboard()` | server (shadow state) | snapshot from request | new |
| `get_column_profile(tableId, column)` | server, **query mode only** | reuse `lib/columnStatsSql.ts`, `topValuesSql.ts`, `quantileSql.ts` (they already run as the user) | tool new, SQL exists |
| `run_query(sql)` | server, **query mode only** | `kineticaSql(req, sql, {route:"POST /api/ai/ask", op:"AI_QUERY"})` | new guard + op tag |
| `add_widget(type, title, config, layout?)` | op -> client | creates temp-id widget; replaces `POST /api/dashboards/:id/widgets` at Keep | new (structural) |
| `remove_widget(id)` | op -> client | hides; `DELETE /api/widgets/:id` at Keep | new |
| `patch(target, configPatch)` | op -> client | **existing** `WidgetAction` envelope -> `widgetActionStore` | EXISTING seam |
| `add_layer(tableId, config)` / `remove_layer(id)` | op -> client | `POST/DELETE /api/dashboards/:id/layers` at Keep | new (structural) |
| `add_dynamic_view(sourceTableId, name, template_sql, ...)` / `remove_dynamic_view(id)` | op -> client + ad-hoc materialize | `POST/DELETE` dv routes at Keep | new (structural) |
| `apply_filter(source, filters)` / `clear_filter(source, column?)` | op -> client | `filterStore` actions (`addFilter/setBulkFilters/removeFilter/addDvFilter`) | new applier |
| `explain(text)` / `suggest_followups([..])` | op -> client | Full-mode UI only | new |
| `generate_dashboard(tableId)` | orchestration, not a single tool | see Q9 | new |

Rules:
- **Reuse the existing envelope for patches.** `WidgetActionSchema` is the `patch` tool's `inputSchema` (as `docs/mcp-action-seam.md` §4 designed). Existing PATCH routes are NOT used for session changes (they would persist); they're used only inside Keep.
- **Do not use MCP in the app path.** `docs/mcp-action-seam.md` anticipated an MCP server. For an in-app agent the loop and tool registry are plain TypeScript; MCP can be layered on later (same `AiOp` zod). Adding `@modelcontextprotocol/sdk` now is scope creep.
- **`add_widget` needs per-widget-type config validation.** The registry (`components/charts/definitions/*.ts`) has `fields[]` + `defaultConfig`, but NO zod schema, and the allow-list covers only 6 widget fields. Generate a validator from `fields[]` (type/options/min/max) plus a small hand-written set of data-binding keys (metric, aggregation, groupByColumns, dimension, `tableId` - see the blocked-key list in `actionAllowList.ts`). Merge over `defaultConfig`. Flag as a spike (S3).
- **Allow-list v3 must be a deliberate, versioned bump** (`ALLOW_LIST_VERSION`), and `getFieldLocation` stays the single source of truth for field location. Hardcoded colors from the model must be rejected or mapped to theme tokens (CLAUDE.md theme rule applies to AI-chosen config too, e.g. bar `color` default is a hex in `definitions/bar.ts`; leave defaults, don't let the AI emit hex).

## Q3. Extending the action engine to structural changes

The engine today is *patch-only on existing ids* (`applyWidgetAction` returns `target_not_found` for anything not in `lookups`). Do **not** shoehorn structure into `widgetActionStore.contributions` (switch-replace per control id is the wrong semantics for an additive log, and `ActionLookups` lists would need to include session entities).

**Design: `aiSessionStore` holds the op log; the engine stays the patch applier.**

```ts
type AiStep = { id: string; op: AiOp; inverse: AiInverse; ts: number; label: string };
type AiSessionState = {
  dashboardId: number | null;
  steps: AiStep[];            // ordered; undo pops
  // derived (recomputed from steps, like widgetActionStore.deriveOverlays):
  addedWidgets: WidgetDto[];  // id < 0
  addedLayers: DashboardLayerDto[];
  addedDynamicViews: DynamicViewRow[];
  removed: { widget: Set<number>; layer: Set<number>; dynamicView: Set<number> };
  status: "idle" | "streaming" | "review";
};
```

- **Temp ids are negative integers** from a monotonic counter (`-1, -2, ...`). They can't collide with SQLite autoincrement ids and are obviously temporary in logs. Requires relaxing `z.number().int().positive()` to `.int().nonzero()` in `WidgetActionTargetSchema` (only for the AI path).
- **Patches** continue to flow through `widgetActionStore.setControlContribution(AI_SOURCE_ID, ...)`, rebuilt from the op log on every change. Source-keyed contributions already exist for exactly this ("transient per-viewer overlay; source-keyed"). Pick a reserved control id for the AI source (e.g. `0` or a large negative that no widget id can equal; widget ids are positive). Patch targets may be temp ids (the target is a session widget): resolve those by *mutating the session widget's config in the derived list*, not via overlay (overlays are keyed by saved ids and the added widget is already session-only).
- **Added widgets/layers/dvs** are merged at the *read site*: `DashboardsPage` computes `effectiveWidgets = [...base.filter(!removed), ...added]`. Layers: today `MapChartRenderer` reads `allLayers` from `useDashboardLayersStore` then `applyLayerOverrides` (line ~534-539). Extend with an `applyLayerSession(layers, session)` step that appends added and drops removed (and keep `applyLayerOverrides` referentially-stable behaviour). `LegendRenderer` must use the same helper (GAP-61-01 precedent: two read paths drifted before).
- **Removed** entities are hidden from derived lists only; the DB row is untouched until Keep. A removed widget that other widgets reference (Legend bound to a map, radio targets, `filter_selection` refs): hide dependents' references gracefully; `collectWidgetConfigRefs` already enumerates reference sites.
- **Lifecycle:** `aiSessionStore.reset()` joins the DashboardOpen cleanup chain at `DashboardsPage.tsx` ~line 740 next to `widgetActionStore.reset()` (it is the "7th" store; AI session is the 8th/last, but it must also run the temp-dv DROP loop BEFORE `dynamicViewStore.reset()`).
- **Layout of new widgets:** the grid uses `widget.config.layout {x,y,w,h}` (see `DashboardsPage.tsx` ~1085). Server tool returns a suggested `layout`; the client resolves overlap with the same `nextY` logic used for manual add (do not let the model pick coordinates blindly). Never modify the layout of saved widgets in the session layer (react-grid-layout `onLayoutChange` persists via `updateWidget`; gate that callback while `status != idle` so a drag in review doesn't persist AI geometry - flag, S5).

### Must session-only dynamic views materialize server-side? **Yes.**

Evidence: `POST /api/dynamic-view/materialize` takes `{dynamic_view_id}` and does `getDashboardDynamicView(id)`; the view name is `buildDynamicViewName({userId, dashboardId, dynamicViewId})` (`lib/dynamicViewName.ts`); `/api/filter/materialize`'s dv path (`dynamicViewId`) also reads the dv row; `/api/dynamic-view/:id/drop` is by id. A negative temp id has no row, so every one of those 404s.

Options:
- **(A) Draft rows** (`draft_owner`, `draft_expires_at` columns; filtered out of all list/export queries). Reuses every existing route unchanged, but touches every list/get query, export, access control, and needs a sweeper. Leak risk is exactly the thing the product forbids.
- **(B, recommended) Ad-hoc inline materialize.** New routes `POST /api/dynamic-view/materialize-adhoc` and a `dynamicViewDef` alternative in `/api/filter/materialize` body: `{dashboardId, sourceTableId, template_sql, max_records, tempId}`. The server runs the *same* `substituteViewToken` + `lib/materializedView.ts` code path, names the view with a temp token (`_kbi_dv_u<user>_d<dash>_t<abs(tempId)>`, **session-scoped suffix too**, so two tabs of the same user don't collide), validates the SQL with the same checks as the existing dv preview/PUT routes (`dynamicViewSql.ts`), and registers a TTL'd view (existing TTL/cleanup infra from v1.15 view lifecycle). Drop via the existing `/drop` loop in `dynamicViewStore.reset()`.
  - Permission: ad-hoc materialize executes as the user and creates a Kinetica view, so it needs the same Kinetica rights existing dv materialize needs. Do NOT require `DYNAMIC_VIEWS_MANAGE` for viewing (an analyst without edit rights must be able to explore), but DO require `ai:use`, and rate-limit the number of live temp views per session (reuse `MAX_COMBINATION_VIEWS_PER_TABLE`-style cap).
  - Both `WidgetRenderer` AND `MapChartRenderer` (2 `buildWmsParams` sites + dep keys) must resolve the temp dv's view name (known gotcha: "Map WMS is a separate read-path"). Budget explicit tasks for both.

Even *widgets backed by a temp dv* in "removed/discard" states must DROP the Kinetica view; leaking views is a real operational cost (see PITFALLS).

## Q4. Filters via the existing path

- AI emits `{op:"apply_filter", source:{kind:"table"|"dv", id}, filters: ActiveFilter[]}`. The client's `aiFilterApplier` calls `useFilterStore.getState().setBulkFilters(tableId, filters)` (table path) or `addDvFilter(dvId, f)` (dv path, Phase 63 slice). Those bump `filterVersion`; `AggregatedWidgetRenderer` Effect 1 and the dv cascade hook materialize; `filterCombinationStore` registers combinations; maps pick it up through their existing combination read. **Nothing here is new infrastructure**, which is the point: it "drives, does not bypass".
- Respect `FILTER_CAP_PER_TABLE = 25` (store toasts; surface the toast text back as a step note, and have the server tool pre-check count from the snapshot's active filters).
- Keep `actionEngineDecoupling.spec.ts` green: `aiFilterApplier.ts` lives in `lib/aiOps/` and is imported by `applyAiOp.ts`, NOT by `applyWidgetAction.ts`/`widgetAction.ts`/`widgetActionStore.ts`. Check the spec's grep scope before placing files (it statically greps the engine files).
- **Filters are session-only already** (they are viewer state), so Keep does NOT persist filters. Surface that to the user in the Keep UI ("filters are not saved"). If product wants saved default filters, that is a separate feature (do not build).
- Selection of the right table when a widget is dv-backed: `apply_filter` must name the *source*; the shadow-state validator checks the column exists on that table/dv `columns_json`.
- Spatial/map-draw filters: out of scope for v2.0 (spatialFilterStore has its own semantics); the tool surface is column filters only.

## Q5. Undo stack design

- **Granularity: one undo unit per AI *turn* (ask), with per-step breakdown visible.** Users think "undo what the AI just did", not "undo step 3 of 7". Provide "Undo" (last turn) and "Discard all" (reset whole session layer). Per-step undo is possible from the log but not required.
- **Mechanism: op log + inverse, not state snapshots.**
  - Structural/patch ops are *pure derivations* of the log: undo = drop the step(s), recompute derived sets + re-write the AI contribution. Inverse is trivial.
  - Filter ops are *side-effects* on `filterStore`: each step records the **prior filter state for that source** (`before: ActiveFilter[]`) and its inverse is `setBulkFilters`/`removeFilter` back to `before`. (`setBulkFilters` is replace-by-column and preserves others; to restore "column was absent" use `removeFilter`.)
  - Temp-dv ops: inverse = drop the Kinetica view (best effort) + remove from the added list.
- **Interleaved user actions** (user manually adds a filter between AI turns) must not be clobbered: inverse touches only the columns the AI changed.
- **Persistence of the stack:** in-memory only. Reload = discard (a locked requirement); do not write to localStorage.
- **Stale-state hazard:** the shadow state sent to the server must be the *effective* dashboard at ask time, including prior session changes, so multi-turn sessions compose correctly.
- Undo disabled while `status === "streaming"` (cancel first; cancel = abort fetch -> server aborts LLM call; already-applied ops stay in the log and are undoable).

## Q6. "Keep" promotes the session layer to persisted entities

**Gate:** server enforces `DASHBOARDS_EDIT` (+ `LAYERS_MANAGE` if any layer op, `DYNAMIC_VIEWS_MANAGE` if any dv op, `WIDGETS_CONFIGURE` for patches that touch widget config) via `getEffectivePermissions` inside the handler (route-level `requirePermission` is a single permission, and the existing import route chains two). The client hides Keep when `useAuthStore.hasPermission` says no, but the server is the authority. Users without edit rights simply never see Keep; "Discard" is always available. Also re-check `canViewDashboard` (v1.10 per-dashboard access).

**Endpoint:** `POST /api/dashboards/:id/ai-keep` with `{ steps: AiOp[] (structural + patch only), expectedDashboardUpdatedAt }`.

**Algorithm (inside one `db.transaction`, mirroring `applyDashboardImport`'s structure):**
1. Validate every op again with the shared zod + allow-list (never trust the client).
2. Maintain `RefIdMaps` (`emptyRefIdMaps()`; `maps.widget/layer/dynamicView` are `Map<number, number>`; temp negative id -> real id).
3. Pass 1, create in dependency order: **dynamic views -> layers -> widgets** (widgets can reference dvs/layers/other widgets). Use the same creators `applyDashboardImport` uses: `createDashboardDynamicView`, `createDashboardLayer`, `createWidget`; record `maps.*.set(tempId, created.id)`.
4. Pass 2, remap: for each created widget/layer config call `remapWidgetConfigRefs(config, maps)` (and the layer/dv equivalents) then `updateWidget/updateDashboardLayer`. This is exactly import's Pass 2; it also strips/reports refs that cannot resolve (e.g. an added widget referencing a removed one).
5. Apply patches to existing entities (merge into stored config with `getFieldLocation` split; top-level layer fields `track_config`/`cb_config` per the `track_config` gotcha), then removals (`DELETE` equivalents: `deleteWidget`, layer delete, dv delete).
6. Return `{ idMap: {widget:{-1:123}, layer:{...}, dynamicView:{...}}, report }`.
7. **Client after success:** apply `idMap` to the session (swap temp ids for real ids in `addedWidgets` etc. - or simply refetch widgets/layers/dvs and clear the session layer), re-key `filterStore.dvFilters`, `dynamicViewStore.views`, and `filterCombinationStore.vizToHash` entries that were keyed by temp ids (or drop and re-materialize; the simpler path is clear-and-refetch with a single toast; flag S4 for the temp-dv->real-dv view rename: the real view name uses the real id, so re-materialize once).

**Why not reuse `applyDashboardImport`:** it always `createDashboard(...)`s, resolves tables by `schema.name`, and has no notion of "patch/delete existing". What IS reusable: `RefIdMaps`, `remapWidgetConfigRefs`, `remapFilterSelection`, `collect*Refs` (dangling detection), and the "validate-before-write, all-in-one-transaction, report what was stripped" discipline. Add a lightweight `ai-keep` module beside `dashboardImport.ts`.

**Concurrency:** another designer may have edited the dashboard since the session started. Send `expectedDashboardUpdatedAt`; on mismatch return 409 and let the user choose Keep anyway (patches use merge-into-current) or discard. Minimum viable: last-write-wins with a warning (flag).

**Partial Keep:** keep all-or-nothing in v2.0 (transaction). Selective per-step Keep is deferred.

## Q7. How the AI gets dashboard and schema context

| Context | Source | Notes |
|---|---|---|
| Table registry + columns + types | SQLite `tables` (columns cached at registration; `schemaSync` v1.25 keeps fresh) restricted to tables on this dashboard (`listDashboardTables`) for analysts; designers' generate flow may offer all registered tables | Already contains column names/types; no Kinetica call for schema-only mode |
| Custom metrics + column display config | `customMetricsStore` server tables (`GET /api/tables/:id/custom-metrics`) | Lets the AI reference "Revenue" metrics by label; resolved server-side |
| Dashboard state | Client `snapshot` (effective state) | Strip bulky/irrelevant config (colors, formats) to a compact summary; full config only for entities the model asks about via `get_dashboard(ids)` |
| Widget-type catalogue | Generated from the registry (`getAllChartTypes()`: `type`, `label`, field keys/enums/defaults, data-binding keys) shipped to the server as a build-time JSON or maintained in `packages/shared` | The server cannot import web registry code. This must be a generated artifact or shared module (S3). |
| Sample/profile data | Only in **query mode**: `get_column_profile` via existing stats SQL; `run_query` with `LIMIT` | In schema-only mode the model sees no row values at all |
| Active filters | snapshot | |

- **Token budget:** the prompt is built from a compact JSON summary; cap tables at N columns per table in prompt and offer `get_schema(tableId)` for detail. Wide Kinetica tables (hundreds of columns) are the realistic overflow case.
- **Admin data-access modes via env** (project preference: env over runtime store): `AI_DATA_ACCESS=schema|query` (default `schema`). In `schema` mode the `run_query` and `get_column_profile` tools are simply not registered with the LLM. In `query` mode they are registered and run as the user. Also surface what was sent to the provider in the audit log (see PITFALLS: data egress to a third-party LLM).
- `AI_PROVIDER=anthropic|openai-compat`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MAX_STEPS`, `AI_TIMEOUT_MS`. Fail closed: `/api/ai/config` returns `{enabled:false}` when unconfigured, and the AI widget renders a "not configured" state.

## Q8. Streaming the AI's steps to the widget

- **Transport:** `POST /api/ai/ask` returning `text/event-stream`, consumed by `fetch` + `ReadableStream` on the client (native `EventSource` is GET-only and can't carry the snapshot/body; cookies for the session auth still go along with `credentials`). No SSE exists in the repo today (existing long-running work, the v1.26 export runner, is poll-based), so this is new infra; WebSockets are unnecessary (one-directional).
- **Event types:** `status` (thinking/running tool), `step` (human label, e.g. "Added a bar chart of sales by region"), `op` (the structured op to apply), `explain` (text delta, Full mode), `followups` (array), `error` (typed code), `done` (usage, step count).
- **Server:** `res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})`, flush after each event, heartbeat comment every ~15s, `req.on('close', abort)` -> `AbortController` into the provider call and any in-flight `kineticaSql`. Note the server's `express.json({limit:"1mb"})` bounds the snapshot size, so summarise the snapshot.
- Not `asyncHandler`-bubbled for mid-stream errors: once headers are sent, errors must be emitted as an `error` event then `res.end()` (the existing `errorMiddleware` would try to send JSON after headers). Pitfall.
- **Client:** `aiClient.askAi()` is an async generator; `AiWidgetRenderer` renders `status`/`step` lines (progress), `applyAiOp` is called per `op` event (so the dashboard visibly changes as the agent works), and Full mode shows `explain` + `followups` (clicking a follow-up re-asks). Not a chat transcript: only the latest turn is displayed.
- **Reverse proxy:** document buffering requirements for the deploy kit (nginx `proxy_buffering off` for this path). Verify with the operator's real proxy (S2).

## Q9. Analyst vs designer flows, "generate a dashboard"

- **Analyst explore** (any user with `ai:use` and view access): ops apply to the session layer; Keep is hidden without edit rights. Without Keep rights there are NO server writes except ad-hoc dv views.
- **Designer generate** (needs `DASHBOARDS_CREATE`, plus edit): recommended flow: (1) user picks a table in the AI widget/designer entry on `DashboardsPage`, (2) client calls existing `POST /api/dashboards` (+ `POST /api/dashboards/:id/tables`) to create an empty dashboard, (3) the same agent loop runs with a `generate` system prompt and `mode:"generate"` (higher step budget, layout planner, strong bias to a coherent set: KPIs on top, map if geometry columns exist, filter widget), (4) the result sits in the session layer for review, (5) Keep commits via `ai-keep`.
  - This gives ONE mechanism (session layer + Keep) for both flows, rather than a second code path that writes DB directly.
  - **Alternative considered:** have the AI emit a v1.24 export file and call `validateImportFile` + `applyDashboardImport`. It gets tier-1 structural validation and id remapping for free, but requires `DATASETS_MANAGE` (import's second permission, which designers may lack), forces the model to author the verbose full export schema including every table row, and can't preview before commit. Reject; but DO reuse its remap/validate helpers (Q6). The export file *schema* is still a good reference for the shape of a whole-dashboard op list.
  - Trade-off: an empty dashboard row exists before Keep. Offer "Delete dashboard" on Discard when the dashboard was created by this flow. Alternatively hold generation in a dashboardless "draft" (rejected: no dashboardId -> no filter/materialize paths).

## Data Flow (one ask)

1. User types a question in the AI widget; client builds `snapshot` from `effective*` selectors + `filterStore`.
2. `POST /api/ai/ask` -> `requireAuth` -> `ai:use` -> `canViewDashboard` -> build system prompt (+ tools per `AI_DATA_ACCESS`).
3. Loop: LLM -> tool_use -> (read tool: run, return result) or (mutate tool: validate vs shadow state, emit `op`, return ok) -> ... -> `explain` + `followups` -> `done`.
4. Client applies `op`s into `aiSessionStore`; widgets render; temp dvs trigger ad-hoc materialize; filters trigger the normal materialize path.
5. User reviews: Undo / Discard (client only) or Keep (-> `ai-keep`).

## Patterns to Follow

### Pattern 1: Shared op schema, double validation
**What:** `AiOp` zod discriminated union in `packages/shared`, validated on the server (before emit), on the client (before apply) and on Keep (before write).
**Why:** the allow-list is the safety boundary; the stream and the Keep body are both attacker-controlled inputs from the server's/client's perspective.
```ts
export const AiOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("patch"), action: WidgetActionSchema }),
  z.object({ op: z.literal("add_widget"), tempId: z.number().int().negative(), type: z.string(), title: z.string(), config: z.record(z.unknown()) }),
  z.object({ op: z.literal("remove_widget"), id: z.number().int() }),
  // add_layer, remove_layer, add_dynamic_view, remove_dynamic_view, apply_filter, clear_filter ...
]);
```

### Pattern 2: Derived-from-log state (mirror `deriveOverlays`)
Recompute all derived sets from `steps` on every change. Never mutate derived state directly; this makes undo trivial and Keep a pure function of the log.

### Pattern 3: Source-keyed contribution for patches
Write the AI's patches to `widgetActionStore` under a reserved `AI_SOURCE_ID`, so radio-control overlays and AI overlays compose through the existing deep-merge and `releaseLayerConfigField` logic.

### Pattern 4: Provider adapter with a normalized tool-call shape
`interface LlmProvider { stream(req: {system, messages, tools, signal}): AsyncIterable<LlmEvent> }` with `LlmEvent = text_delta | tool_use | stop`. Anthropic and OpenAI-compatible adapters translate. Local models often have weaker tool-calling; keep a JSON-mode fallback that parses a constrained op list (S6).

## Anti-Patterns to Avoid

### Anti-pattern 1: AI calls the existing PATCH/POST routes directly
**Why bad:** persists unsaved changes for everyone (violates "others never see unsaved AI changes"), and bypasses the session layer. **Instead:** those routes run only inside Keep, under the user's edit permission.

### Anti-pattern 2: Putting filter logic in the action engine
**Why bad:** breaks `ACTION-ENGINE-NO-FILTER` and its static spec. **Instead:** `aiFilterApplier` sibling module.

### Anti-pattern 3: Draft DB rows for session entities
**Why bad:** every list/export/access query becomes a potential leak; needs a sweeper; violates reload-reverts-by-construction. **Instead:** negative temp ids + ad-hoc materialize.

### Anti-pattern 4: Letting the model write raw SQL into widgets
**Why bad:** widgets build SQL from config (`metric`, `aggregation`, `customWhere` etc.); `customWhere` is a raw predicate. **Instead:** restrict AI to structured fields; treat `customWhere` as not allow-listed in v2.0 (or validate via `whereClause.ts`); `add_dynamic_view` `template_sql` goes through the existing dv SQL validation.

### Anti-pattern 5: Server-side conversation memory
**Why bad:** state to clean up, contradicts "not a chat transcript". **Instead:** stateless asks with snapshot.

## Q10. Read-only query tool executing as the user

- Call `kineticaSql(req as AuthedRequest, sql, {route:"POST /api/ai/ask", op:"AI_QUERY", extra:{limit: AI_QUERY_MAX_ROWS}})`. `kineticaSql` already: uses `req.user.creds` (Kinetica enforces *that user's* grants, so the tool can never see more than the user can), clamps limit to `KINETICA_MAX_ROWS_PER_QUERY`, writes the audit line with `request_id/username/route/op`. Add `"AI_QUERY"` to the `KineticaOp` union for log filtering.
- **Do not rely on Kinetica grants for read-only.** A user with write rights could be talked into a DDL/DML by prompt injection (e.g. text inside a data column). `sqlGuard.ts`: parse-reject anything that is not a single `SELECT`/`WITH ... SELECT`; reject `;`-chained statements, `INTO`, DDL/DML keywords, table functions that write; allow only tables on the dashboard (or registered tables). Reuse the existing dv SQL checks in `lib/dynamicViewSql.ts` / `whereClause.ts` where they fit. Unknown-parse -> reject (fail closed).
- **Cap results:** low row cap (e.g. 50) and a column/cell truncation before sending to the LLM; this is also the data-egress control.
- **Session lifetime:** within one request the `req` principal suffices; a request is bounded by `AI_TIMEOUT_MS`. If any step ever runs after the request ends (it should not), use `principalForSession(sid)` like the export runner and handle `SessionEndedError`.
- Query results go to the LLM provider: for `AI_DATA_ACCESS=query` with a hosted provider this is a data-egress decision the admin makes explicitly via env; document it.

## Suggested Build Order (phases continue from 133)

Dependencies: shared op contract -> session layer (structural) -> agent loop + schema-only tools -> streaming UI -> filters -> dv/ad-hoc materialize -> query tool -> Keep -> generate. Keep is last because it needs stable op shapes; but the *contract* for it should be designed in phase 133.

| Phase | Name | Delivers | Depends on | Research flag |
|---|---|---|---|---|
| **133** | AI contract & spikes | `packages/shared` (zod `AiOp`, `WidgetAction`, allow-list v3 extraction, config validators generated from registry); env schema (`AI_*`); `LlmProvider` interface; **spikes S1-S3** | - | **Deeper research** (S1 ad-hoc dv, S3 config validators) |
| **134** | Session layer engine (client) | `aiSessionStore`, temp ids, derived effective widgets/layers/dvs wired in `DashboardsPage`, `MapChartRenderer`, `LegendRenderer`, `applyLayerOverrides`; undo/discard; reset in cleanup chain; tested with hand-written ops (no LLM) | 133 | Standard (follows `widgetActionStore` patterns) |
| **135** | Server agent loop + provider adapters + read tools | `aiRoutes.ts`, `agentLoop`, Anthropic + OpenAI-compat adapters, `get_schema/get_dashboard`, shadow-state validation, `ai:use` permission + permission ripple specs, `/api/ai/config` | 133 | Provider tool-calling details (local model JSON fallback) |
| **136** | AI widget + SSE streaming | `definitions/ai.ts`, `AiWidgetRenderer` (Compact/Full), `AiConfigPanel`, `aiClient` stream reader, step/explain/followups UI, cancel, modals portaled | 134, 135 | SSE through the operator's proxy (S2) |
| **137** | Structural ops end to end | add/remove widget & layer & patch tools wired model -> op -> session layer; per-type config validation; layout placement | 134, 135, 136 | Standard after S3 |
| **138** | Filters | `aiFilterApplier`, `apply_filter/clear_filter` tools, filter undo inverses, map WMS verification; keeps decoupling spec | 134, 137 | Standard (well-trodden path) |
| **139** | Dynamic views (session-only) | Ad-hoc materialize routes, temp-view naming/TTL/drop, `useDynamicViewMaterializeChain` + both map `buildWmsParams` sites + dv filter path, `add/remove_dynamic_view` tools | 137, 138, S1 | **Deeper research** |
| **140** | Query tool (data access mode) | `sqlGuard`, `run_query`, `get_column_profile`, `AI_QUERY` op, env gating, audit/egress, prompt-injection hardening | 135 | **Deeper research** (SQL guard robustness) |
| **141** | Keep (persist) | `POST /api/dashboards/:id/ai-keep` txn, id remap reuse, permission checks, 409 staleness, client id swap/refetch, Keep/Discard bar | 137 (and 138/139 to cover all op kinds) | Standard (mirrors import) |
| **142** | Generate dashboard + hardening | designer "generate from table" flow, generate prompt/budget, empty-dashboard cleanup, e2e + UAT, docs (supersede `mcp-action-seam.md` status) | 141 | Prompt quality iteration |

Rationale for order:
- 134 can be built and fully tested with zero LLM, de-risking the largest *client* change (read-site merging across Widget/Map/Legend) early.
- 135 and 134 are parallelizable by different executors (disjoint files); NOTE the memory rule: assign shared-doc/ROADMAP updates to ONE plan.
- Filters (138) before dv (139): filters use only existing machinery; dv needs the new server surface.
- Query tool (140) is independent of the UI and highest-risk for safety, so it comes after the loop is proven in schema-only mode, but before Keep so security review isn't rushed at the end.
- Keep (141) needs stable op shapes; 133 defines them so it can start whenever structural ops (137) exist.

## Risky Unknowns (spikes)

| # | Spike | Question | Fail mode / fallback |
|---|---|---|---|
| S1 | Ad-hoc dv materialize | Can `lib/materializedView.ts` + TTL cleanup serve an inline definition with a session-scoped name without a DB row? Does the dv filter path (`/api/filter/materialize` dv branch, `buildFilterViewName` expecting dv row) accept an inline def cleanly? | Fallback (A): draft rows with `draft_owner` |
| S2 | SSE in this deployment | Does the operator's proxy/ingress buffer `text/event-stream`? Does `cookie`-based auth + 1MB json limit work with POST streaming? Session TTL mid-stream? | Fallback: chunked NDJSON over POST, or poll a job (export-job precedent) |
| S3 | Per-widget-type config validators | Can zod validators be derived from `ChartTypeDefinition.fields` + data-binding keys accurately for all 16 widget types without a big hand-written table? Where do data-binding keys (metric/groupBy/table) actually live (config vs top-level)? | Support only a subset of widget types in v2.0 (bar/line/pie/table/bignumber/map/records/heatmap); widen later |
| S4 | Temp -> real id re-keying after Keep | `filterStore.dvFilters`, `dynamicViewStore.views`, `filterCombinationStore.vizToHash` ("w:<id>", "l:<id>", "dv:<id>") are keyed by ids | Fallback: after Keep, `reset()` those stores for AI-added sources and re-materialize |
| S5 | Grid layout interaction | Does gating `onLayoutChange` during review suffice to keep AI geometry unpersisted? Does react-grid-layout handle appended items without reflow of saved widgets? | Place AI widgets in reserved rows below existing content |
| S6 | Local-model tool-calling reliability | OpenAI-compatible local servers vary in function-calling quality | JSON-mode constrained-output fallback; document "supported local models" |

## Scalability Considerations

| Concern | 100 users | 10K users | Notes |
|---|---|---|---|
| Concurrent LLM streams | Direct, per-user cap | Queue + per-user/global concurrency limit; provider rate-limit backoff | Express holds a socket per stream |
| Temp Kinetica views | Few | Per-session cap + short TTL + sweep (reuse view-lifecycle cleanup from v1.15) | Orphans after crash/closed tab are the main leak |
| Prompt size | Fine | Cache tool-level schema summaries per table (invalidate on schema sync v1.25) | Wide tables |
| Query-tool load | Row cap | Per-user query budget/timeouts | Executes against GPU-DB as the user |
| Audit volume | Fine | Log structured per-ask record (user, dashboard, tool calls, token usage), not prompt bodies by default | Egress review |

## Sources

All HIGH confidence (read directly in this repo):
- `packages/web/docs/mcp-action-seam.md`, `packages/web/src/lib/widgetAction.ts`, `applyWidgetAction.ts`, `actionAllowList.ts`, `applyLayerOverrides.ts`
- `packages/web/src/store/widgetActionStore.ts`, `filterStore.ts`, `filterCombinationStore.ts`, `dynamicViewStore.ts`
- `packages/web/src/components/DashboardsPage.tsx` (cleanup chain ~L740, widget add ~L1085, layers L1245-1285), `charts/MapChartRenderer.tsx` (L534-539), `charts/definitions/index.ts`, `charts/registry.ts`
- `packages/web/src/hooks/useDynamicViewMaterializeChain.ts`
- `packages/server/src/index.ts` (routes at L843 import, L959-1010 widgets, L1055-1133 layers, L1149-1187 views, L1289 filter materialize, L1688-2040 dynamic views, L2930 SQL proxy), `rbac.ts`, `kinetica.ts` (`kineticaSql`, `KineticaOp`, `KineticaPrincipal`), `lib/exportRunner.ts` (`principalForSession`), `lib/dashboardImport.ts`, `lib/dashboardExport.ts`, `lib/dashboardExportRefs.ts`, `lib/dynamicViewName.ts`, `lib/permissions.ts`, `lib/dashboardAccessDb.ts`
- `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md` (this file is stale, dated 2026-03-23, and describes an early layout; real paths are `packages/*`)

LOW confidence / unverified: SSE-through-proxy behaviour, local-model tool-calling quality, exact `materializedView.ts` reuse feasibility for inline definitions (S1). Not checked against current LLM vendor docs (belongs to STACK research).
