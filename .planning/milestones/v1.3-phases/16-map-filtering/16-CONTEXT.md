# Phase 16: map-filtering - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the production consumer for map widgets so each `ImageWMS` layer renders `LAYERS=<view_name>` when its table has an active filter and `LAYERS=<table>` when it doesn't. Closes TD-V12-01.

Phase 16 ships:

1. **`wmsUrlBuilder.ts` cleanup** — `QUERY` / `FILTER_PARAM` block deleted; `_v` cache-buster renamed to `_mv` ("materialize version") and re-sourced from `useFilterViewStore.materializeVersion[tableId]`; signature changes to drop `whereClause` and add `materializeVersion`. Empty-/whitespace-only `whereClause` short-circuit goes with the deleted block.
2. **`MapChartRenderer` LAYERS-swap** — Effects 2 + 3 read per-layer `useFilterViewStore.getState().views[layer.table_id]?.viewName` at the build site. Truthy → `LAYERS=<viewName>` and `_mv=<materializeVersion>`. Falsy (no entry) or expired (proactive `Date.now() >= expiresAt`) → `LAYERS=<schema.table>` (`tableRef`) with no `_mv`. The two `Phase 16 TODO` comments at `MapChartRenderer.tsx:314` and `:415` are replaced with the live wiring.
3. **Effect 3 dep array** — replaces `[filterVersion, includedLayers, tables]` with a stable per-layer key derived from `useFilterViewStore` (planner picks: `viewsKey` selector returning `includedLayers.map(l => \`${l.table_id}:${views[l.table_id]?.viewName ?? ''}:${views[l.table_id]?.materializeVersion ?? 0}\`).join('|')`, or equivalent). Effect 1 (Map create + ResizeObserver) and Effect 2 (per-layer source attach) lifecycle bodies stay verbatim — only the per-layer `wmsParams` build call inside Effect 2 changes.
4. **Atomic dead-code deletion** — the `wmsUrlBuilder.spec.ts` `FILT-04 — filter clause` describe block (lines 470–492) deletes IN THE SAME PLAN as the renderer wiring. `_v=…` test assertions update to `_mv`. Two new describe blocks land: `LAYERS source decision tree` (viewName → tableRef → layerName fallback) and `_mv emission` (present when `materializeVersion` given, absent when no view). `tsc --noEmit` clean post-plan.
5. **MapChartRenderer is a PURE consumer** — never triggers `materializeFilter` / `dropFilterView`. Only `AggregatedWidgetRenderer` materializes (VSTORE-V13-02 / FILT-V13 lock). When a map widget is on a `tableId` that no `AggregatedWidgetRenderer` on the dashboard targets, the map renders `LAYERS=<table>` permanently — accepted limitation, parallel to Phase 15's `V13-LIMIT-01` (records-table-only-on-table-X). Phase 17 verification surfaces if it bites users.

**Out of scope for Phase 16:**

- End-to-end verification + low-cardinality test fixture (`VERIFY-V13-01..02`) → Phase 17. Phase 16 success criterion #1 ("tiles visibly narrow") is exercised by Phase 17's fixture; Phase 16 ships with unit-level coverage of the LAYERS / `_mv` decision tree.
- OIDC-mode S2.b live DDL re-probe → Phase 17.
- `MapConfigPanel` changes — Phase 12 reduced it to title + basemap + layer-inclusion picker; Phase 16 doesn't touch it.
- Old Phase 11 single-WMS widget shape — `.widget-map-reconfigure` overlay (Phase 12 LAYER-12 hard cutover) stays untouched.
- `bumpMaterializeVersion` callers — `setView`'s auto-bump on same-name `CREATE OR REPLACE` covers the cache-bust contract. The dormant action stays; if no caller emerges by Phase 17 close, flag for removal.
- `widget.config.layerName` legacy fallback — preserved as-is; deletion is a separate tech-debt cleanup.
- `MapChartRenderer` materialize triggering, drill-on-map click, identify endpoint, hover tooltip — all separate phases / future scope.

</domain>

<decisions>
## Implementation Decisions

### Plan staging (user-locked: 1 atomic plan)

- **Single plan, single commit** — `16-01-PLAN.md` covers `wmsUrlBuilder.ts` signature change + spec block surgery + `MapChartRenderer.tsx` LAYERS-swap + Effect 3 dep-array swap + spec extension. `tsc --noEmit` and full vitest suite must be green at end of plan.
- Rationale: the builder signature change is breaking (drops `whereClause`, adds `materializeVersion`). Splitting it from the two callsite migrations leaves an intermediate state where the builder accepts one shape and the callers pass another. The single-plan choice avoids a feature-flag intermediate or temporary back-compat shim.
- Internal commit boundary inside the plan (planner's discretion): may produce multiple atomic commits as long as the final commit leaves green; the deliverable is one PLAN file with the wave-orchestrated tasks Phase 14/15 used.

### `buildWmsParams` signature change (user-locked)

- New signature: `buildWmsParams(config: MapWidgetConfig, materializeVersion: number | undefined): Record<string, string>`.
- `whereClause` arg deleted entirely (server-side WHERE; map never builds client-side WHERE in v1.3).
- `filterVersion` no longer threaded through this builder. The cache-bust is now keyed on `materializeVersion` (when a view is active), not chip-state version.
- `MapWidgetConfig` type: `layerName?` and `tableRef?` stay (legacy/canonical pair preserved). NEW optional field on the call site (NOT on `MapWidgetConfig`): the `viewName` is passed via `config.tableRef` substitution at the call site (planner picks: substitute `tableRef = viewName` when active, OR add `viewName?` field to the type and let the builder pick LAYERS source). Either works; planner picks the cleaner shape.
- Old `_v=String(filterVersion)` line at `wmsUrlBuilder.ts:134` becomes `_mv=String(materializeVersion)` ONLY when `materializeVersion !== undefined`. When undefined, `_mv` is OMITTED entirely (no `_mv=0` sentinel — see "_mv when no view exists" below).
- The `whereClause`-driven QUERY emit block at `wmsUrlBuilder.ts:229-234` deletes; the `// AP-3 lock` comment migrates to a doc-comment at the file head explaining server-side WHERE moved to the materialize endpoint (Phase 13).

### MapChartRenderer subscription pattern (user-locked: per-layer scoped getState reads)

- Inside Effects 2 + 3, for each `layer` in `includedLayers`:
  - `const entry = useFilterViewStore.getState().views[layer.table_id];`
  - `const isExpired = entry !== undefined && Date.now() >= entry.expiresAt;`
  - `const viewName = !isExpired ? entry?.viewName : undefined;`
  - `const materializeVersion = !isExpired ? entry?.materializeVersion : undefined;`
  - `const layersSource = viewName ?? tableRef;`
- Snapshot `getState()` reads, NOT React-subscription selectors, at the per-layer build site. This matches the existing `useFilterStore.getState().filterVersion` call at `MapChartRenderer.tsx:335` and respects PITFALL C-02 selector-scoping (no top-level subscription that would re-render on cross-table mutations).
- React-subscription happens ONCE at component top via the `viewsKey` derivation (see Effect 3 dep array below). The `getState()` reads inside Effects 2/3 only need to fetch fresh values at re-fire time.

### Effect 3 dep array (user-locked: filterVersion-keyed; expiresAt is run-time only)

- Effect 3 keeps `filterVersion` as the primary trigger. NEW addition: a `viewsKey` string derived via top-level `useFilterViewStore` selector that re-renders the component when relevant entries mutate.
- Suggested derivation (planner refines): `const viewsKey = useFilterViewStore((s) => includedLayers.map(l => \`${l.table_id}:${s.views[l.table_id]?.viewName ?? ''}:${s.views[l.table_id]?.materializeVersion ?? 0}\`).join('|'));`. Stable string identity → re-renders only when one of the included layers' table_id entries changes.
- Effect 3 dep array becomes `[filterVersion, viewsKey, includedLayers, tables]` (planner verifies; the eslint-disable comment carries forward unchanged).
- `expiresAt` is NOT in the dep array. Read inline via `getState()` at run time. TTL recovery is a side effect of the next `filterVersion` bump or a re-fired `viewsKey` change after re-materialize.

### TTL recovery on map tiles (user-locked: proactive only)

- **Proactive expiry check at every per-layer `wmsParams` build site** (Effects 2 + 3): if `Date.now() >= entry.expiresAt`, treat the layer as if no view exists — fall through to `LAYERS=<tableRef>` and OMIT `_mv`. Silent: no toast, no overlay, no error.
- **No reactive XHR-response parsing** — Phase 16 does not parse `imageloaderror` response bodies for the `S/SDc:1513` signature. The existing tile-error toast (`'Map tiles failed to load.'`, 2s debounce) at `MapChartRenderer.tsx:347-358` stays unchanged. If a view expires between the proactive check and the actual WMS request, the existing tile-error path fires once; next `filterVersion` bump (or re-materialize via `AggregatedWidgetRenderer`) clears the stale entry.
- **Recovery flow on the happy path:** user idles 5+ min with active filter → Kinetica drops the view (sliding TTL) → user clicks a chart on the same table → `AggregatedWidgetRenderer` re-materializes → `setView` writes new entry → `viewsKey` changes → `MapChartRenderer` Effect 3 re-fires → `updateParams` swaps to new `LAYERS=<viewName>` and bumped `_mv`.
- **Map-only-on-table-X edge case:** if a dashboard has a map widget on `tableId=X` but NO `AggregatedWidgetRenderer` on `tableId=X`, the map cannot recover after expiry — it stays on `LAYERS=<tableRef>` permanently. Accepted limitation parallel to Phase 15's `V13-LIMIT-01`. Phase 17 verification surfaces if it bites; gap-closure is a future scope.

### `_mv` emission contract (user-locked: omit when no view)

- `_mv=<materializeVersion>` emitted ONLY when a non-expired `entry.viewName` is in use (i.e., when `LAYERS=<viewName>`).
- When falling through to `LAYERS=<tableRef>` (no entry, expired entry, or empty-filters state), `_mv` is OMITTED entirely. No `_mv=0` sentinel; no `_v` repurposing.
- Rationale: OL `ImageWMS` caches by full URL. The LAYERS value itself changes between view and table, so the URL changes — cache-bust is automatic. `_mv` is only meaningful as a same-name `CREATE OR REPLACE` cache-bust, which only matters when a view is in use.

### `bumpMaterializeVersion` caller (user-locked: no Phase 16 caller)

- Phase 16 introduces NO `bumpMaterializeVersion()` calls. `useFilterViewStore.setView` already increments `materializeVersion` on same-name `CREATE OR REPLACE` (Phase 14 lock). `AggregatedWidgetRenderer` triggers materialize → `setView` → `_mv` increments → OL ImageWMS sees new URL → cache-bust fires. Phase 15's reactive recovery uses `setView` via re-materialize (also bumps).
- The `bumpMaterializeVersion` action stays dormant in the store. If no caller emerges by Phase 17 milestone close, flag for removal as a tech-debt item.

### `widget.config.layerName` legacy fallback (user-locked: leave as-is)

- The Phase 11-10 era `layerName?` field on `MapWidgetConfig` (a back-compat fallback used when `tableRef` is missing) stays untouched. Phase 16's LAYERS decision tree is `viewName → tableRef → layerName`. Deletion of `layerName` is a separate tech-debt cleanup; out of scope.

### Spec test structure (user-locked: two new describe blocks)

- **Delete:** `wmsUrlBuilder.spec.ts` lines 468–492 (`describe("buildWmsParams — filter clause (FILT-04)")`) — fully removed.
- **Update:** existing `_v=…` assertions (lines 70, 75, 486, 489) become `_mv=…` AND the assertion semantics shift: `_mv` is present-when-materializeVersion-provided, absent-when-undefined. Old "always emitted" semantic for `_v` is gone.
- **Add (new describe blocks):**
  - `LAYERS source decision tree` — covers viewName-takes-precedence, tableRef fallback, layerName fallback, no-source-omits-LAYERS.
  - `_mv emission` — covers present-when-materializeVersion-given, absent-when-undefined, stringification, no-_v-emission anywhere.
- **MapChartRenderer.spec.tsx extensions:** Effect 2 / Effect 3 wiring tests asserting on per-layer `useFilterViewStore.getState()` reads and the proactive-expiry fallback. Mock `useFilterViewStore` (already auto-covered by Zustand reset shim) and assert `imageWmsSource.updateParams` calls receive correct LAYERS / `_mv` shape across viewName-active / expired / no-entry / no-filter scenarios.
- Compile-time signature check: vitest `expectTypeOf<typeof buildWmsParams>().parameters` (or equivalent) confirming `whereClause` is no longer in the signature.

### Tile-error toast (user-locked: keep as-is)

- Existing Effect 2 tile-error handler at `MapChartRenderer.tsx:347-358` stays byte-unchanged. `'Map tiles failed to load.'` copy + 2s debounce + retry-affordance lock. Phase 16 does NOT add view-aware copy or per-error suppression; the proactive expiry check prevents most view-not-found tile errors at source.

### "Filtering..." badge on map widgets (Claude's Discretion — user did NOT prioritize for discussion)

- Default recommendation: extend the Phase 15 `<FilteringBadge tableId={n} />` component or a thin wrapper to subscribe to ANY `includedLayers[*].table_id` whose entry has `materializing: true`. Show one badge in the map widget's card header (matching chart widget chrome) when any layer is in materialize phase.
- Alternative: per-layer indicator inside the layer-stack toolbar / overlay. More granular; more code; doesn't match Phase 15 chart-widget pattern.
- Alternative: NO badge on map widgets (consistent with Phase 11's "filter bar IS the per-table feedback" lock). Loses parity with Phase 15 chart widgets but preserves Phase 11 ergonomic.
- Planner picks based on existing Phase 15 component reuse cost and UX parity intuition. Default = single per-widget badge driven by any-layer-materializing.

### Claude's Discretion

- Exact `viewsKey` selector shape — recommended derivation given above; planner refines for re-render minimization.
- Whether `viewName` is added as an explicit `MapWidgetConfig` field or substituted at the call site via `tableRef`. Both work; planner picks based on test ergonomics.
- File location for the proactive `isViewExpired(entry)` helper (extracted vs inline) — Phase 15 left this open for chart-recovery in `15-04`; Phase 16 may share or duplicate.
- Whether `MapChartRenderer.spec.tsx` extensions split into a new spec file (`MapChartRenderer.filtering.spec.tsx`) or extend the existing spec — planner picks.
- Decision on the FilteringBadge wiring (above) — single-badge / per-layer / none.
- Whether to remove the `useFilterStore` `filterVersion` import from `MapChartRenderer.tsx` if Effect 3 no longer needs it (likely still needed if `viewsKey` is the only sub but `filterVersion` triggers re-fires on chip-state changes that haven't yet materialized — planner verifies).
- Inline pitfall-comment style for new code (`// V13-P-XX lock`, `// PITFALL M-02 lock` carry-forwards) — match Phase 15 idiom.
- Whether to add an `aria-busy` or live-region on the map widget during materializing — a11y polish; out of phase scope unless trivial.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone (project-level)

- `.planning/PROJECT.md` § "Current Milestone: v1.3 Unified Dashboard Filtering" — Map widgets target features (LAYERS=view, QUERY removed, _mv retained); two-store split rationale; v1.2 dead-code list
- `.planning/REQUIREMENTS.md` § "Map Filtering (LAYERS-swap)" — MAP-V13-01..06 full specs
- `.planning/REQUIREMENTS.md` § Traceability — Phase 16 mapping (6 requirements: MAP-V13-01..06)
- `.planning/ROADMAP.md` § Phase 16 — Goal + 5 success criteria; preserves v1.2 lifecycle locks (M-01 dispose, ResizeObserver, blob lifecycle)
- `.planning/STATE.md` — Phase 13 spike S1 PASS (LAYERS=view renders); Phase 13/14/15 lockdown

### Phase 15 inheritance (mandatory reads — Phase 16 is a parallel-architecture consumer of the same plumbing)

- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § "Plan staging" — pattern Phase 16 deliberately diverges from (1 atomic vs 5 fine-grained); same green-per-plan constraint applies
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § "Dead-code deletion timing" — atomic-with-renderer-wiring pattern Phase 16 mirrors (FILT-04 spec block + signature change)
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § "TTL recovery (proactive + reactive)" — Phase 15 dual-path; Phase 16 chose proactive-only. Planner reads to understand what's NOT being mirrored
- `.planning/phases/15-chart-filtering/15-RESEARCH.md` (if present) and `15-VERIFICATION.md` — chart-side proof points; Phase 16 inherits the validated `useFilterViewStore` contract

### Phase 14 inheritance (store + helper contract — DO NOT REDEFINE)

- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Store shape" — `FilterViewEntry` shape including `materializeVersion`, `expiresAt`, `materializing`; reference-stable per-table updates locked
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Trigger wiring scope" — `AggregatedWidgetRenderer` is sole materialize trigger; map is pure consumer
- `kinetica_bi/src/store/filterViewStore.ts` — `setView` auto-bumps `materializeVersion` on same-name overwrite; `bumpMaterializeVersion` available but Phase 16 has no caller

### Phase 13 inheritance (endpoint + view-name format)

- `.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md` § Spike S1 — WMS LAYERS=`<view_name>` PASS verified against deployed Kinetica; map LAYERS-swap is buildable
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` § S1 — verbatim PNG-render confirmation; gates Phase 16 success criterion #1
- `kinetica_bi/server/src/lib/viewNaming.ts` — view-name format `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`; client-side validation regex if needed

### Phase 11 / Phase 12 carry-forward (PITFALL locks Phase 16 MUST preserve verbatim)

- `.planning/phases/11-map-chart/11-CONTEXT.md` — original PITFALL M-01..M-08 locks; OpenLayers Strict-Mode mount/dispose; `EPSG:3857` lock; WKT/WKB branch
- `.planning/phases/12-dashboard-layers-panel/12-CONTEXT.md` — N-layer ImageWMS stack, `dashboard_layers` SQLite table, layer.table_id top-level field (NOT inside config blob), layer.position drag-reorder semantics, hard cutover for old Phase 11 widget shape (`.widget-map-reconfigure`)
- `.planning/phases/12-dashboard-layers-panel/12-VERIFICATION.md` — 5-PASS / 1-SUPERSEDED status; SUPERSEDED criterion is TD-V12-01 (closes in Phase 16)
- `.planning/research/PITFALLS.md` § Pitfall 1 (NEVER dispose the Map; addLayer/removeLayer); Pitfall 2 (filter-version effect fires for ALL bumps; only matching layer gets new params); Pitfall 3 (opacity single source of truth in layer.config); Pitfall 4 (XHR + arraybuffer + base64 imageLoadFunction)

### Codebase maps (READ BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter — match existing style
- `.planning/codebase/STRUCTURE.md` — `src/components/charts/`, `src/lib/`, `src/store/` placement
- `.planning/codebase/STACK.md` — OpenLayers v10 + ImageWMS baseline; zero new client deps for Phase 16
- `.planning/codebase/TESTING.md` — vitest + jsdom + RTL; OL canvas is jsdom-stubbed (lifecycle tests, not tile rendering)

### Existing code (mandatory read before writing)

- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Phase 16 deletes lines 100 (`FILTER_PARAM`), 134 (`_v=…`), 229–234 (FILT-04 emit); changes signature at line 121; replaces `_v` with `_mv` sourcing from new `materializeVersion` arg
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` — Phase 16 deletes lines 470–492 (FILT-04 describe block); updates `_v` assertions at 70, 75, 486, 489 to `_mv` semantics; adds two new describe blocks (LAYERS source decision tree; `_mv` emission)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:280-426` — Effects 2 + 3 are the primary edit sites:
  - Lines 314, 415 — replace `Phase 16 TODO` comments + `whereClause = ""` with `useFilterViewStore.getState().views[layer.table_id]` reads + proactive expiry check
  - Line 333, 422 — `buildWmsParams(wmsConfigInput, materializeVersion)` calls (signature changed)
  - Line 426 — Effect 3 dep array swaps from `[filterVersion, includedLayers, tables]` to `[filterVersion, viewsKey, includedLayers, tables]` (or planner-refined shape)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:347-358` — tile-error toast handler stays unchanged
- `kinetica_bi/src/store/filterViewStore.ts` — Phase 16 reads `views[tableId]` (`viewName`, `expiresAt`, `materializeVersion`); does NOT call any actions
- `kinetica_bi/src/store/filterStore.ts` — Phase 16 still reads `filterVersion` (Effect 3 trigger when chip state changes pre-materialize); BYTE-UNCHANGED otherwise
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — extend with LAYERS-swap + per-layer `getState` + proactive-expiry fallback assertions; mock `useFilterViewStore` via the Zustand reset shim
- `kinetica_bi/src/components/charts/FilteringBadge.tsx` (Phase 15) — extend or wrap for map widget if FilteringBadge wiring is chosen (Claude's Discretion)
- `kinetica_bi/server/src/index.ts` § `/api/wms` proxy — UNCHANGED in Phase 16. `Cache-Control: no-store` (M-08 lock) stays

### v1.3 research (commit `e68080f`)

- `.planning/research/SUMMARY.md` — Synthesized stack + pitfalls + architecture overview
- `.planning/research/ARCHITECTURE.md` § map-renderer subscription pattern; § viewsKey derivation
- `.planning/research/PITFALLS.md`:
  - V13-P-01 (setView post-200 only — applies to Phase 15 trigger path, not Phase 16 consumer)
  - V13-P-09 (multi-tab same-user same-session last-write-wins — accepted)
  - V13-P-11 (ref-stable per-table updates)
  - Map-specific carry-forwards: M-01 / Pitfall 1..4 from `_archive_v1.2/PITFALLS.md`

### v1.0 / v1.2 anti-pattern locks (still apply)

- **AP-1**: View-name state lives ONLY in `useFilterViewStore` — no useState shadow copies in `MapChartRenderer`
- **AP-2**: Map tile fetches and SQL chart fetches are independent lifecycles — Phase 16 does not introduce SQL refetch on tile changes
- **AP-3**: Server-side WHERE only — Phase 16 does NOT introduce client-side WHERE; the deleted `whereClause` arg in `buildWmsParams` enforces this at the type level
- **AP-4**: `tableId` is `number`, persisted at config-save time; Phase 16 reads from `layer.table_id` (top-level `dashboard_layers` SQLite column, NOT `layer.config.tableId`)
- **C-02**: Hot widgets MUST scope selectors — Phase 16's `viewsKey` derivation respects this (per-layer subset, not whole `views` map)
- **PITFALL M-01..M-08**: ALL preserved verbatim with explicit lock comments where touched
- **Pitfall 1..4 (Phase 12)**: ALL preserved verbatim — addLayer/removeLayer (no dispose), filter-version-bumps-all-layers, opacity single source of truth, XHR+arraybuffer+base64 imageLoadFunction

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useFilterViewStore`** (`src/store/filterViewStore.ts`, ~106 LOC) — Phase 14 dormant store, Phase 15 first chart consumer, Phase 16 first map consumer. `views[tableId]` carries `viewName` / `expiresAt` / `materializing` / `materializeVersion` / `dashboardId`. `getState()` is read inline at per-layer build site; `useFilterViewStore(...)` selector at component top builds `viewsKey` for dep array.
- **`useFilterStore.filterVersion`** — Phase 16 keeps reading this for Effect 3 to fire on chip-state changes that pre-date materialize completion. BYTE-UNCHANGED.
- **`buildWmsParams`** (`src/lib/wmsUrlBuilder.ts`) — pure builder; Phase 16 changes signature (drops `whereClause`, adds `materializeVersion`) and removes the `QUERY` / `_v` block. ~130 LOC after cleanup.
- **`FilteringBadge`** (Phase 15 component) — candidate for reuse on map widgets (Claude's Discretion). Currently subscribes to single `tableId.materializing`; map widgets need ANY-of-N-layers semantics.
- **`isViewExpired` (Phase 15 helper, if extracted)** — Phase 16 may reuse for the proactive expiry check inside Effects 2 + 3.
- **Existing tile-error toast handler** (`MapChartRenderer.tsx:347-358`) — debounced 2s; `useToastStore.getState().showToast`. UNCHANGED in Phase 16.
- **OpenLayers `ImageWMS.updateParams`** — accepts a fresh params object; OL caches by URL → changing LAYERS or `_mv` forces a re-fetch. PITFALL M-02 lock.
- **Zustand reset shim** (`__mocks__/zustand.ts` + `src/test/setup.ts`) — auto-covers `useFilterViewStore` mock setup in `MapChartRenderer.spec.tsx`.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per `CONVENTIONS.md`)
- 2-space indent; no formatter — match existing style
- `getState()` reads inside effects for mid-effect snapshots (not selector subscriptions); top-level subscriptions ONLY for re-render triggers
- Inline pitfall-comment style: comments reference IDs (`// PITFALL M-02 lock`, `// V13-P-XX lock`) so future readers can trace decisions
- Per-layer iteration in Effects 2 + 3 (Phase 12 pattern) — Phase 16 keeps the loop shape; only the `wmsParams` build call changes
- `eslint-disable-next-line react-hooks/exhaustive-deps` on Effect 3 dep array (intentional `tableFilters` omission carries forward)

### Integration Points

- **`MapChartRenderer.tsx` Effects 2 + 3** — primary edit sites for LAYERS-swap + `_mv` emission + proactive expiry check
- **`wmsUrlBuilder.ts`** — signature change, `QUERY` block deletion, `_v`→`_mv` rename
- **`wmsUrlBuilder.spec.ts`** — FILT-04 block deletion, `_v` assertion updates, two new describe blocks
- **`MapChartRenderer.spec.tsx`** — new test coverage for LAYERS-swap, expiry fallback, `_mv` emission contract
- **NO server-side changes** — `/api/wms` proxy untouched; `kineticaWms` helper untouched

### Critical: existing convention notes (carry-forward)

- **Per-layer materializeVersion**: each layer's `_mv` reads from THAT layer's `table_id` entry, not a global value. Multi-layer widgets get per-layer cache-busts.
- **No `bumpMaterializeVersion` caller**: Phase 16 never calls this action. `setView` auto-bump on same-name `CREATE OR REPLACE` is the sole bump mechanism.
- **Proactive expiry inline, no scheduled timers**: `Date.now() >= expiresAt` is checked at build time only. No `setTimeout(handleExpiry, …)` per active view (rejected option in discussion).
- **`_mv` absent when no view**: NOT `_mv=0`, NOT `_mv=<filterVersion>`. Cleanest URL semantics.
- **Tile-error toast preserved**: existing 2s-debounced `'Map tiles failed to load.'` stays. Proactive expiry should prevent most view-not-found tile errors.

</code_context>

<specifics>
## Specific Ideas

- **1 atomic plan, single commit boundary** — explicit user choice. The breaking signature change for `buildWmsParams` (drops `whereClause`, adds `materializeVersion`) cannot be split across plans without an intermediate state where the builder accepts one shape and the renderers pass another. One plan, one final green commit.
- **Proactive-only TTL recovery, no reactive XHR parsing** — explicit user choice. Phase 15 took the dual-path approach; Phase 16 deliberately picks the simpler half. Map's pure-consumer role + the chart-driven re-materialize path covers most user flows. The XHR parsing for view-not-found tile errors was rejected as overkill given the proactive check + existing tile-error toast.
- **Silent fallback to `LAYERS=<table>` on expiry** — no toast, no overlay, no per-layer indicator. User-locked. Matches Phase 15's "fall through to raw FROM <table>" lock for chart-recovery silence.
- **`_mv` omitted (not `_mv=0`) when no view** — cache-bust unnecessary because LAYERS value already changes between view and table. `_mv` is THE materialize-version cache-bust, only meaningful when materialized.
- **No `bumpMaterializeVersion` caller** — `setView`'s auto-bump on same-name `CREATE OR REPLACE` covers Phase 16's needs. The dormant action gets flagged for removal at Phase 17 milestone close if no caller emerges.
- **`layerName` legacy fallback preserved** — out of scope for Phase 16; deletion is a separate tech-debt cleanup. The LAYERS decision tree (`viewName → tableRef → layerName`) honors all three.
- **Per-layer scoped `getState` reads at build site** — matches the existing `useFilterStore.getState().filterVersion` call at `MapChartRenderer.tsx:335` and respects PITFALL C-02 selector scoping.
- **`viewsKey` top-level subscription drives Effect 3 re-renders** — paired with `getState` reads inside the effect. The selector minimizes cross-table re-render churn.
- **Map-only-on-table-X edge case is an accepted limit** — parallel to Phase 15's `V13-LIMIT-01`. Phase 17 verification surfaces if it bites users; gap-closure is future scope.

</specifics>

<deferred>
## Deferred Ideas

- **End-to-end visual verification + low-cardinality test fixture** (`VERIFY-V13-01..02`) — Phase 17 owns the fixture that lets Phase 16 success criterion #1 ("tiles visibly narrow") be exercised. Phase 16 ships with unit-level coverage of the LAYERS / `_mv` decision tree only.
- **OIDC-mode S2.b live DDL re-probe** — Phase 17 (deferred from Phase 13 spike, deferred again from Phase 15 to keep Phase 17's milestone-close ownership clean).
- **Reactive XHR-response parsing for view-not-found tile errors** — explicitly rejected for Phase 16. If proactive expiry + chart-driven recovery proves insufficient under load, revisit in v2 or a Phase 17 follow-up.
- **`bumpMaterializeVersion` action removal** — if no caller emerges by Phase 17 milestone close, flag for tech-debt cleanup. Phase 14 shipped it; Phase 15 didn't use it; Phase 16 doesn't use it.
- **`widget.config.layerName` legacy fallback removal** — separate tech-debt cleanup; Phase 16 leaves it as-is.
- **`MapConfigPanel` re-touching** — Phase 12 reduced it to title + basemap + layer-inclusion picker. Phase 16 does not touch it.
- **Map-only-on-table-X dashboard recovery gap** — accepted limitation parallel to `V13-LIMIT-01`. Phase 17 verification surfaces if users hit it.
- **Per-layer "Filtering..." indicator (vs single per-widget badge)** — Claude's Discretion; default = single per-widget badge subscribing to any-layer-materializing. If per-layer granularity is wanted later, separate UX phase.
- **`aria-busy` / live-region on map widget during materializing** — a11y polish; out of phase scope unless trivial.
- **Map widget visual cue for filtered tableId beyond filter bar** — Phase 11 lock said "filter bar IS the per-table feedback; no per-chart cue". Phase 15 partially broke this with FilteringBadge for charts. Whether maps follow suit is in Claude's Discretion above; if rejected, the badge gets per-table parity loss with charts.
- **`/api/wms` proxy server-side cache-bust hardening** — `Cache-Control: no-store` (M-08) stays; no Phase 16 changes.
- **`bumpMaterializeVersion` caller for reactive WMS recovery** — explicitly rejected in this discussion.
- **Setting `_mv=0` sentinel when no view** — explicitly rejected; OMIT instead.
- **Threading `expiresAt` into Effect 3 dep array or scheduling `setTimeout(handleExpiry)`** — explicitly rejected in favor of inline `getState()` read at build time.

</deferred>

---

*Phase: 16-map-filtering*
*Context gathered: 2026-05-06*
