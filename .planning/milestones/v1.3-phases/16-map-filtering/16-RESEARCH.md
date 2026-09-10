# Phase 16: map-filtering — Research

**Researched:** 2026-05-06
**Domain:** OpenLayers `ImageWMS` LAYERS-swap consumer wiring + per-layer scoped Zustand subscription + `wmsUrlBuilder` signature surgery + atomic dead-code deletion of v1.2 `QUERY` block
**Confidence:** HIGH (all primitives exist in-repo and were direct-file-verified; OL `ImageWMS.updateParams` semantics confirmed against `node_modules/ol/source/ImageWMS.d.ts`; Phase 14/15 inheritance contracts verified by reading actual store, helper, and renderer source)

## Summary

Phase 16 is the **map-side activation** that closes TD-V12-01 and finishes the v1.3 LAYERS-swap migration. Every primitive needed is already in-repo: Phase 14 shipped `useFilterViewStore` (with `viewName` / `expiresAt` / `materializing` / `materializeVersion` per `tableId`); Phase 15 shipped `AggregatedWidgetRenderer` as the sole materialize trigger plus `FilteringBadge`, `isViewExpired`-style proactive checks (inline in `WidgetRenderer.tsx`), and the dual-store subscription pattern (top-level scoped selector for re-render trigger + `getState()` reads inside effects). Phase 16 wires the same plumbing into `MapChartRenderer.tsx` Effects 2 + 3 and changes `buildWmsParams`'s signature to drop `whereClause` and accept `materializeVersion`. **Zero new dependencies, zero new test infrastructure, zero server changes.**

The defining technical risk is **NOT** the OL `ImageWMS.updateParams` mechanics (verified: replaces user-provided params, OL caches by full URL, changing `LAYERS` or `_mv` triggers automatic re-fetch) and **NOT** the per-layer scoped subscription (Phase 12 already established `layer.table_id`-keyed iteration as a primary pattern). The defining risk is **PITFALL V13-P-06 — accidentally regressing the v1.2 OL lifecycle locks** (M-01 dispose, M-02 source.updateParams, M-03 EPSG:3857, ResizeObserver updateSize, XHR+arraybuffer+base64 imageLoadFunction) during Effect 2/3 surgery. The user-locked CONTEXT explicitly forbids touching Effect 1 (Map create) and the ResizeObserver / dispose / XHR plumbing — Phase 16 is a **per-layer wmsParams build-call swap inside the existing Effect 2/3 bodies**.

**Primary recommendation:** Treat `MapChartRenderer.tsx:285-426` (Effects 2 + 3) as a surgical, line-locked edit. Frontload a diff-locked block-comment that enumerates every v1.2 lock preserved (M-01..M-08, Pitfall 1..4) and changes (LAYERS source decision tree + `_mv` emission + Effect 3 `viewsKey` dep). Mirror Phase 15's `WidgetRenderer.tsx` `viewName + expiresAt + getState()` pattern verbatim — same scoped selectors at component top, same `getState()` reads inside effects, same proactive `Date.now() >= expiresAt` check (no reactive XHR-response parsing per CONTEXT lock). Single atomic plan, single final green commit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plan staging (1 atomic plan, single commit boundary):**
- `16-01-PLAN.md` covers: `wmsUrlBuilder.ts` signature change + spec block surgery + `MapChartRenderer.tsx` LAYERS-swap + Effect 3 dep-array swap + spec extension. `tsc --noEmit` and full vitest suite must be green at end of plan.
- Rationale: builder signature change is breaking (drops `whereClause`, adds `materializeVersion`). Splitting from callsite migrations would leave intermediate state where builder accepts one shape and callers pass another.
- Internal commit boundary inside the plan (planner's discretion): may produce multiple atomic commits as long as the final commit leaves green; deliverable is one PLAN file with wave-orchestrated tasks (mirrors Phase 14/15 pattern).

**`buildWmsParams` signature change:**
- New signature: `buildWmsParams(config: MapWidgetConfig, materializeVersion: number | undefined): Record<string, string>`.
- `whereClause` arg deleted entirely (server-side WHERE; map never builds client-side WHERE in v1.3).
- `filterVersion` no longer threaded through this builder.
- `MapWidgetConfig.layerName?` and `tableRef?` stay (legacy/canonical pair preserved).
- `viewName` substitution: planner picks between (a) substituting `tableRef = viewName` at the call site OR (b) adding `viewName?` field to the type and letting builder pick LAYERS source.
- Old `_v=String(filterVersion)` line at `wmsUrlBuilder.ts:134` becomes `_mv=String(materializeVersion)` ONLY when `materializeVersion !== undefined`. When undefined, `_mv` is OMITTED entirely.
- `whereClause`-driven QUERY emit block at `wmsUrlBuilder.ts:229-234` deletes; `// AP-3 lock` comment migrates to a doc-comment at file head explaining server-side WHERE moved to materialize endpoint (Phase 13).

**MapChartRenderer subscription pattern (per-layer scoped `getState()` reads):**
- Inside Effects 2 + 3, for each `layer` in `includedLayers`:
  - `const entry = useFilterViewStore.getState().views[layer.table_id];`
  - `const isExpired = entry !== undefined && Date.now() >= entry.expiresAt;`
  - `const viewName = !isExpired ? entry?.viewName : undefined;`
  - `const materializeVersion = !isExpired ? entry?.materializeVersion : undefined;`
  - `const layersSource = viewName ?? tableRef;`
- Snapshot `getState()` reads, NOT React-subscription selectors at the per-layer build site. Matches existing `useFilterStore.getState().filterVersion` call at `MapChartRenderer.tsx:335`.
- React-subscription happens ONCE at component top via the `viewsKey` derivation (drives Effect 3 re-fires).

**Effect 3 dep array (filterVersion-keyed; expiresAt is run-time only):**
- Effect 3 keeps `filterVersion` as primary trigger. NEW addition: a `viewsKey` string from a top-level `useFilterViewStore` selector.
- Suggested derivation (planner refines): `const viewsKey = useFilterViewStore((s) => includedLayers.map(l => \`${l.table_id}:${s.views[l.table_id]?.viewName ?? ''}:${s.views[l.table_id]?.materializeVersion ?? 0}\`).join('|'));`
- Effect 3 dep array becomes `[filterVersion, viewsKey, includedLayers, tables]` (planner verifies; eslint-disable comment carries forward unchanged).
- `expiresAt` is NOT in dep array. Read inline via `getState()` at run time. TTL recovery is a side effect of next `filterVersion` bump or re-fired `viewsKey` after re-materialize.

**TTL recovery on map tiles (proactive only):**
- Proactive expiry check at every per-layer `wmsParams` build site (Effects 2 + 3): if `Date.now() >= entry.expiresAt`, treat layer as if no view exists — fall through to `LAYERS=<tableRef>` and OMIT `_mv`. Silent: no toast, no overlay, no error.
- NO reactive XHR-response parsing — Phase 16 does NOT parse `imageloaderror` response bodies for `S/SDc:1513` signature. Existing tile-error toast (`'Map tiles failed to load.'`, 2s debounce) at `MapChartRenderer.tsx:347-358` stays unchanged.
- Recovery flow on happy path: user idles 5+ min with active filter → Kinetica drops view (sliding TTL) → user clicks a chart on same table → `AggregatedWidgetRenderer` re-materializes → `setView` writes new entry → `viewsKey` changes → `MapChartRenderer` Effect 3 re-fires → `updateParams` swaps to new `LAYERS=<viewName>` and bumped `_mv`.
- Map-only-on-table-X edge case: if dashboard has map widget on `tableId=X` but NO `AggregatedWidgetRenderer` on `tableId=X`, the map cannot recover after expiry — it stays on `LAYERS=<tableRef>` permanently. Accepted limitation parallel to Phase 15's `V13-LIMIT-01`. Phase 17 verification surfaces if it bites users.

**`_mv` emission contract (omit when no view):**
- `_mv=<materializeVersion>` emitted ONLY when a non-expired `entry.viewName` is in use.
- When falling through to `LAYERS=<tableRef>` (no entry, expired entry, or empty-filters state), `_mv` is OMITTED entirely. No `_mv=0` sentinel; no `_v` repurposing.
- Rationale: OL `ImageWMS` caches by full URL. The LAYERS value itself changes between view and table, so URL changes — cache-bust automatic. `_mv` only meaningful as same-name `CREATE OR REPLACE` cache-bust, only matters when a view is in use.

**`bumpMaterializeVersion` caller (no Phase 16 caller):**
- Phase 16 introduces NO `bumpMaterializeVersion()` calls. `useFilterViewStore.setView` already increments `materializeVersion` on same-name `CREATE OR REPLACE` (Phase 14 lock). `AggregatedWidgetRenderer` triggers materialize → `setView` → `_mv` increments → OL `ImageWMS` sees new URL → cache-bust fires.
- The action stays dormant in the store. If no caller emerges by Phase 17 milestone close, flag for removal.

**`widget.config.layerName` legacy fallback (leave as-is):**
- Phase 16 LAYERS decision tree is `viewName → tableRef → layerName`. Deletion of `layerName` is separate tech-debt cleanup; out of scope.

**Spec test structure (two new describe blocks):**
- DELETE: `wmsUrlBuilder.spec.ts` lines 468–492 (`describe("buildWmsParams — filter clause (FILT-04)")`) — fully removed.
- UPDATE: existing `_v=…` assertions (lines 70, 75, 486, 489) become `_mv=…` AND assertion semantics shift: `_mv` present-when-materializeVersion-provided, absent-when-undefined. Old "always emitted" semantic for `_v` is gone.
- ADD (new describe blocks):
  - `LAYERS source decision tree` — viewName-takes-precedence, tableRef fallback, layerName fallback, no-source-omits-LAYERS.
  - `_mv emission` — present-when-materializeVersion-given, absent-when-undefined, stringification, no-_v-emission anywhere.
- `MapChartRenderer.spec.tsx` extensions: Effect 2 / Effect 3 wiring tests asserting on per-layer `useFilterViewStore.getState()` reads and proactive-expiry fallback. Mock `useFilterViewStore` and assert `imageWmsSource.updateParams` calls receive correct LAYERS / `_mv` shape across viewName-active / expired / no-entry / no-filter scenarios.
- Compile-time signature check: `expectTypeOf<typeof buildWmsParams>().parameters` (or equivalent) confirming `whereClause` no longer in the signature.

**Tile-error toast (keep as-is):**
- Existing Effect 2 tile-error handler at `MapChartRenderer.tsx:347-358` stays byte-unchanged. `'Map tiles failed to load.'` copy + 2s debounce + retry-affordance lock.

**`MapChartRenderer` is a PURE consumer:**
- Never triggers `materializeFilter` / `dropFilterView`. Only `AggregatedWidgetRenderer` materializes (VSTORE-V13-02 / FILT-V13 lock).

### Claude's Discretion

- Exact `viewsKey` selector shape — recommended derivation given above; planner refines for re-render minimization.
- Whether `viewName` is added as an explicit `MapWidgetConfig` field or substituted at the call site via `tableRef`. Both work; planner picks based on test ergonomics.
- File location for proactive `isViewExpired(entry)` helper (extracted vs inline) — Phase 15 left this open; Phase 16 may share or duplicate. (Recommendation: extract to `src/lib/viewExpiry.ts` if it lands as 3+ duplicated lines across files.)
- Whether `MapChartRenderer.spec.tsx` extensions split into a new spec file (`MapChartRenderer.filtering.spec.tsx`) or extend the existing spec — planner picks.
- "Filtering..." badge wiring on map widgets:
  - Default recommendation: extend `<FilteringBadge tableId={n} />` or thin wrapper to subscribe to ANY `includedLayers[*].table_id` whose entry has `materializing: true`. Show one badge in map widget's card header.
  - Alternative: per-layer indicator inside layer-stack toolbar / overlay — more granular, more code.
  - Alternative: NO badge on map widgets — preserves Phase 11 ergonomic but loses parity with Phase 15.
  - Planner picks based on existing component reuse cost and UX parity intuition. Default = single per-widget badge driven by any-layer-materializing.
- Whether to remove `useFilterStore` `filterVersion` import from `MapChartRenderer.tsx` if Effect 3 no longer needs it (likely still needed if `viewsKey` is sole sub but `filterVersion` triggers re-fires on chip-state changes that haven't yet materialized — planner verifies).
- Inline pitfall-comment style (`// V13-P-XX lock`, `// PITFALL M-02 lock` carry-forwards) — match Phase 15 idiom.
- Whether to add `aria-busy` or live-region on map widget during materializing — a11y polish; out of phase scope unless trivial.

### Deferred Ideas (OUT OF SCOPE)

- End-to-end visual verification + low-cardinality test fixture (`VERIFY-V13-01..02`) → Phase 17. Phase 16 success criterion #1 ("tiles visibly narrow") is exercised by Phase 17's fixture; Phase 16 ships with unit-level coverage of the LAYERS / `_mv` decision tree.
- OIDC-mode S2.b live DDL re-probe → Phase 17.
- `MapConfigPanel` changes — Phase 12 reduced it to title + basemap + layer-inclusion picker; Phase 16 doesn't touch it.
- Old Phase 11 single-WMS widget shape — `.widget-map-reconfigure` overlay (Phase 12 LAYER-12 hard cutover) stays untouched.
- `bumpMaterializeVersion` callers — `setView`'s auto-bump on same-name `CREATE OR REPLACE` covers cache-bust contract. Dormant action stays; flag for removal at Phase 17 milestone close if no caller emerges.
- `widget.config.layerName` legacy fallback removal — separate tech-debt cleanup.
- `MapChartRenderer` materialize triggering, drill-on-map click, identify endpoint, hover tooltip — all separate phases / future scope.
- Reactive XHR-response parsing for view-not-found tile errors — explicitly rejected. Proactive expiry + chart-driven recovery are sufficient.
- Setting `_mv=0` sentinel when no view — explicitly rejected; OMIT instead.
- Threading `expiresAt` into Effect 3 dep array or scheduling `setTimeout(handleExpiry)` — explicitly rejected in favor of inline `getState()` read at build time.
- `/api/wms` proxy server-side cache-bust hardening — `Cache-Control: no-store` (M-08 lock) stays; no Phase 16 changes.
- Per-layer "Filtering..." indicator (vs single per-widget badge) — out of scope unless Claude's Discretion above picks it.
- `aria-busy` / live-region on map widget — out of phase scope unless trivial.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAP-V13-01 | When filters are active for a table, map layers rendering that table use `LAYERS=<view_name>` instead of `LAYERS=<table>` in WMS GetMap requests. | Per-layer `getState()` read of `useFilterViewStore.views[layer.table_id]?.viewName`; substitute into `MapWidgetConfig.tableRef` (or add `viewName?` field) at the build site inside Effects 2 + 3. SPIKE-V13-01 PASS gates this — operator confirmed `LAYERS=<materialized_view_name>` renders PNG tiles against deployed Kinetica (`STATE.md` Phase 13 lock). |
| MAP-V13-02 | When filters are NOT active for a table, map layers fall back to `LAYERS=<table>` (raw, unfiltered). | LAYERS source decision tree: `viewName → tableRef → layerName`. When no entry exists in `useFilterViewStore.views[tableId]` OR entry is proactively expired, `viewName` is `undefined` → `LAYERS=<tableRef>`. Existing `tableRef` resolution at `MapChartRenderer.tsx:329` (`${tableMeta.schema}.${tableMeta.name}`) stays. |
| MAP-V13-03 | `wmsUrlBuilder.ts` `QUERY` / `FILTER_PARAM` block fully removed; `_v` cache-buster RENAMED to `_mv` and RETAINED — sourced from `useFilterViewStore.materializeVersion[tableId]`. | Delete: `FILTER_PARAM` const at line 100; `whereClause` param at line 124; `_v` emit at line 134; FILT-04 emit block at lines 229-234. New: `materializeVersion: number \| undefined` arg; `_mv=String(materializeVersion)` ONLY when defined. `setView` already auto-bumps `materializeVersion` on same-name `CREATE OR REPLACE` (Phase 14, `filterViewStore.ts:55-67`). |
| MAP-V13-04 | `MapChartRenderer` Effect 3 dep array changes from `[filterVersion, includedLayers, tables]` to a stable `viewsKey` string; v1.2 PITFALL locks (ResizeObserver, blob lifecycle, mapRef guard, XHR+arraybuffer+base64 imageLoadFunction) preserved verbatim per V13-P-06. | Top-level `useFilterViewStore` selector deriving per-layer `viewsKey`. Effect 1 (Map create + ResizeObserver at lines 228-278) and Effect 4 (basemap swap at lines 429-435) byte-unchanged. Effect 2 body's per-layer `wmsParams` build call (lines 333-337) and Effect 3 body's per-layer `wmsParams` build call (lines 421-422) are the only edit sites — surrounding lifecycle plumbing stays verbatim. |
| MAP-V13-05 | Map widgets and `RecordsTableRenderer` are PURE CONSUMERS of `useFilterViewStore` — never trigger `POST /api/filter/materialize` themselves. | Phase 16 only adds `getState()` reads to `useFilterViewStore.views`; no `materializeFilter` / `dropFilterView` import in `MapChartRenderer.tsx`. Sole materialize trigger remains `AggregatedWidgetRenderer.useEffect[sql, filterVersion, dashboardId, tableId]` at `WidgetRenderer.tsx:250-287` (Phase 15 lock). |
| MAP-V13-06 | `wmsUrlBuilder.spec.ts` FILT-04 test block (lines 470-492) explicitly deleted in cleanup phase; `_v` test cases updated to `_mv`; new tests assert on `LAYERS=<view>` substitution when filter active. | Delete describe block at lines 468-492. Update `_v` assertions at lines 70, 75, 486, 489 to `_mv` semantics (present-when-defined / absent-when-undefined). Add two new describes (`LAYERS source decision tree`, `_mv emission`). Extend `MapChartRenderer.spec.tsx` with `_filterViewState` mock (mirroring `_filterState`) and assert `updateParams` calls receive correct shape across viewName-active / expired / no-entry scenarios. |

</phase_requirements>

## Standard Stack

### Core (zero new dependencies — entire Phase 16 stack is already in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| openlayers (`ol`) | v10 (per `STACK.md`) | `ImageWMS.updateParams` per-layer LAYERS-swap; M-01..M-05 / Pitfall 1..4 lifecycle locks | Already used by `MapChartRenderer.tsx`. `ImageWMS.d.ts` confirms `updateParams(params: any): void` signature; OL replaces user-provided params and re-renders. URL-cache-by-content lets `LAYERS` / `_mv` changes drive automatic re-fetch. |
| zustand | ^4.5.2 | `useFilterViewStore` consumer subscription (top-level `viewsKey` selector + `getState()` reads inside effects); `useFilterStore.filterVersion` carry-forward | Already used by 5 stores in `src/store/`. Reset shim wired (`__mocks__/zustand.ts` + `src/test/setup.ts`). Phase 14 contract (`viewName`, `expiresAt`, `materializing`, `materializeVersion`, `dashboardId`) verified by direct read of `filterViewStore.ts:30-36`. |
| react | ^18.3.1 | `useEffect` dep arrays (Effect 2 / Effect 3 surgery), `useRef` (existing `imageSourcesRef` / `mapRef` / `imageLayersRef` carry-forward), no new context | Already in repo. Phase 16 uses standard React 18 hooks; no new ref / context patterns. |
| vitest | ^4.1.5 | Spec extension for `wmsUrlBuilder.spec.ts` + `MapChartRenderer.spec.tsx` | Already established in both files. `wmsUrlBuilder.spec.ts` is 492 LOC with 8 describes; `MapChartRenderer.spec.tsx` is 666 LOC with comprehensive OL mocks. |
| @testing-library/react | ^16.3.2 | `render`, `act`, `screen` for renderer specs | Already used by `MapChartRenderer.spec.tsx`. |

**Version verification:** All versions verified by reading `kinetica_bi/package.json` (per Phase 14/15 RESEARCH.md). **Zero install, zero version bump.**

**Confidence:** HIGH — every dependency is already in `package.json`. Phase 16 introduces no new packages.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | Phase 16 introduces zero new packages | All needed primitives exist |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `getState()` reads inside Effects 2/3 | Top-level `useFilterViewStore` subscription with full views map | Rejected: violates PITFALL C-02 selector-scoping. A top-level subscription to `s.views` would re-render `MapChartRenderer` on EVERY filter mutation across ALL tables — even ones not in this widget's `includedLayers`. Per-layer scoped `getState()` reads at the build site are the established pattern (matches `useFilterStore.getState().filterVersion` at line 335). |
| Reactive XHR-response parsing for view-not-found errors | Add `imageloaderror` body parsing to detect `S/SDc:1513` and re-materialize | Rejected by user lock. CONTEXT.md §"TTL recovery" explicitly takes proactive-only path. Phase 15 dual-path is for chart SQL where error is in the catch chain; OL XHR path is harder to instrument and the chart-driven re-materialize covers most user flows. Existing tile-error toast handles the rare race. |
| Add `viewName?` field to `MapWidgetConfig` type | Substitute `tableRef = viewName` at the call site | Either works; planner picks. Substituting at call site keeps `MapWidgetConfig` type narrow (it stays a "what to render" config; view-name is runtime state). Adding a field documents intent at the type level but adds a leaky abstraction. RECOMMENDATION: substitute at call site (`{ ...cfg, tableId, tableRef: viewName ?? rawTableRef }`) — simpler diff, preserves Phase 11 type. |
| `_mv=0` sentinel when no view | Omit `_mv` entirely | User-locked: omit. Cleanest URL semantics; LAYERS value already changes between view and table so URL is unique without `_mv`. Sentinel adds noise. |
| `setTimeout(handleExpiry)` per active view | Inline `Date.now() >= expiresAt` check at build time | User-locked: inline check. No timer scheduling complexity; check fires whenever Effects 2/3 re-run; recovery driven by next `filterVersion` or `viewsKey` change. |
| Per-layer "Filtering..." indicator inside layer-stack toolbar | Single per-widget badge subscribing to ANY layer materializing | Default recommendation: single badge (matches Phase 15 chart-widget chrome; lower implementation cost). Per-layer indicator is more granular but doesn't match the Phase 15 pattern. Planner picks. |

**Installation:** None. All dependencies present.

## Architecture Patterns

### Recommended Project Structure (no new files required)

```
src/
├── components/
│   ├── charts/
│   │   ├── MapChartRenderer.tsx           # PRIMARY edit site: Effects 2 + 3 wmsParams build calls
│   │   ├── MapChartRenderer.spec.tsx      # EXTEND: add LAYERS-swap + expiry + _mv tests
│   │   └── ...
│   ├── FilteringBadge.tsx                 # CONSIDER: extend for any-layer-materializing semantics (Claude's Discretion)
│   └── ...
├── lib/
│   ├── wmsUrlBuilder.ts                   # PRIMARY edit site: signature change, QUERY block delete, _v→_mv
│   ├── wmsUrlBuilder.spec.ts              # EDIT: delete FILT-04 block, update _v→_mv, add 2 new describes
│   └── (viewExpiry.ts)                    # OPTIONAL: extract isViewExpired(entry) helper if shared with Phase 15
├── store/
│   ├── filterViewStore.ts                 # READ-ONLY (no Phase 16 changes; _mv source via setView auto-bump)
│   ├── filterStore.ts                     # READ-ONLY (filterVersion stays as Effect 3 trigger)
│   └── dashboardLayersStore.ts            # READ-ONLY
└── ...
```

### Pattern 1: Per-Layer Scoped `getState()` Read at Build Site

**What:** Inside Effects 2 + 3, for each `layer` in `includedLayers`, snapshot-read `useFilterViewStore.getState().views[layer.table_id]` at the moment the `wmsParams` is built. Combined with a top-level `viewsKey` selector that re-renders the component when relevant entries mutate.

**When to use:** When a renderer iterates a list of items each keyed by a different `tableId`, and a top-level subscription to the whole store would cause cross-table re-renders.

**Example:**
```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:230-236 (Phase 15 pattern, mirrored for Phase 16)

// At component top (drives Effect 3 re-fires):
const viewsKey = useFilterViewStore((s) =>
  includedLayers
    .map((l) => `${l.table_id}:${s.views[l.table_id]?.viewName ?? ''}:${s.views[l.table_id]?.materializeVersion ?? 0}`)
    .join('|')
);

// Inside Effect 2 / Effect 3 per-layer loop:
for (const layer of includedLayers) {
  const tableId = layer.table_id;
  const entry = useFilterViewStore.getState().views[tableId];
  const isExpired = entry !== undefined && Date.now() >= entry.expiresAt;
  const viewName = !isExpired ? entry?.viewName : undefined;
  const materializeVersion = !isExpired ? entry?.materializeVersion : undefined;
  // LAYERS source decision tree: viewName → tableRef → layerName (existing fallback)
  const tableMeta = tables.find((t) => t.id === tableId);
  if (!tableMeta) continue;
  const tableRef = viewName ?? `${tableMeta.schema}.${tableMeta.name}`;
  const wmsConfigInput = { ...cfg, tableId, tableRef } as MapWidgetConfig;
  source.updateParams(buildWmsParams(wmsConfigInput, materializeVersion));
}
```

### Pattern 2: Atomic Signature Change with Single Plan

**What:** When changing a function's signature where every caller must update simultaneously, do it in one atomic plan with type-checker verification at each commit.

**When to use:** When the new signature is incompatible with the old (drops a required param, changes a type) AND there are multiple callers; a feature-flag intermediate or back-compat shim is the alternative.

**Example:**
```typescript
// OLD signature (wmsUrlBuilder.ts:121-125):
export function buildWmsParams(
  config: MapWidgetConfig,
  filterVersion: number,
  whereClause: string,
): Record<string, string> { ... }

// NEW signature (Phase 16):
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
): Record<string, string> { ... }

// Plan order (single PLAN, may be multiple internal commits):
// 1. Edit wmsUrlBuilder.ts (signature + QUERY block delete + _v→_mv)
// 2. Edit MapChartRenderer.tsx Effects 2 + 3 (call sites at lines 333, 422)
// 3. Edit wmsUrlBuilder.spec.ts (delete FILT-04, update _v→_mv, add 2 new describes)
// 4. Edit MapChartRenderer.spec.tsx (add useFilterViewStore mock + LAYERS-swap tests)
// Final commit: tsc --noEmit clean + full vitest green
```

### Pattern 3: OL `ImageWMS.updateParams` Mechanics

**What:** OpenLayers `ImageWMS.updateParams(params)` replaces user-provided params and triggers re-render. OL caches by full image URL — changing `LAYERS` or `_mv` produces a different URL, so a re-fetch fires automatically.

**When to use:** Any time WMS params change. NEVER rebuild the source or the layer (PITFALL M-02 lock).

**Example:**
```typescript
// Source: kinetica_bi/node_modules/ol/source/ImageWMS.d.ts:215-225
// updateParams(params: any): void
// Replaces user-provided params (BBOX, WIDTH, HEIGHT, CRS/SRS are dynamically managed by OL).

// Existing pattern (MapChartRenderer.tsx:420-422):
source.updateParams(buildWmsParams(wmsConfigInput, filterVersion, whereClause));

// Phase 16 pattern:
source.updateParams(buildWmsParams(wmsConfigInput, materializeVersion));
```

### Pattern 4: Pure Consumer Lock

**What:** Map renderer reads from `useFilterViewStore` but never calls `materializeFilter` / `dropFilterView` / `setView` / `markMaterializing`. Only `AggregatedWidgetRenderer` triggers the materialize side effect.

**When to use:** Any renderer that consumes `useFilterViewStore` outside `AggregatedWidgetRenderer`.

**Example:**
```typescript
// CORRECT (Phase 15 RecordsTableRenderer + Phase 16 MapChartRenderer):
const viewName = useFilterViewStore((s) => s.views[tableId]?.viewName);
// ...use viewName in SQL FROM-swap or WMS LAYERS substitution...

// FORBIDDEN in MapChartRenderer:
materializeFilter({ dashboardId, tableId, filters }); // ❌ V13-P-DDLflood violation
useFilterViewStore.getState().setView(...);            // ❌ V13-P-01 violation
```

### Anti-Patterns to Avoid

- **Top-level subscription to `s.views`:** would re-render the whole map widget on any cross-table mutation. Use scoped per-layer derivation (`viewsKey`) at component top + `getState()` reads inside effects.
- **Optimistic `setView` from map widget:** widgets would query a non-existent view (V13-P-01). Map is a pure consumer; no `setView` calls.
- **Bulk delete of v1.2 OL lifecycle code while migrating Effect 2/3:** PITFALL V13-P-06 — bulk replace is the established way to lose M-01 / M-02 / Pitfall 1/4 locks. Surgical edit only at the per-layer wmsParams build call.
- **`_mv=0` sentinel when no view:** noise; URL changes anyway via LAYERS swap.
- **Reactive XHR-response parsing:** out of scope per CONTEXT lock; existing tile-error toast handles the rare race.
- **Threading `expiresAt` into Effect 3 dep array:** would cause re-fires every wall-clock second a view is approaching expiry. Inline `getState()` check at run time only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache-busting WMS tiles on filter change | Custom URL hash / query param scheme | `_mv=<materializeVersion>` from `useFilterViewStore` (auto-bumped by `setView` on same-name `CREATE OR REPLACE` per Phase 14 lock) | OL `ImageWMS` already caches by full URL. Phase 14 already implemented the auto-bump on `setView`. Custom scheme would duplicate work and risk drift from the chart-side cache contract. |
| WMS layer re-fetch trigger | `source.refresh()` or `source.changed()` after every params write | `source.updateParams(newParams)` exclusively | `updateParams` already fires the internal change event AND merges into the cached `params_` object. `refresh()` is for forcing a refetch with the SAME URL (used by the "Retry" button at `MapChartRenderer.tsx:438-440` for error recovery). |
| Re-render guard for cross-table filter changes | `useMemo` + ref-equality dance on `useFilterViewStore.views` | Top-level `useFilterViewStore((s) => viewsKey)` selector with stable per-layer string derivation | Zustand selectors already short-circuit on shallow equality of returned values. A primitive string `viewsKey` provides O(1) equality; React's diff fires Effect 3 only when the string changes. PITFALL C-02 lock. |
| Proactive expiry timer scheduling | `setTimeout(handleExpiry, expiresAt - Date.now())` per active view | Inline `Date.now() >= entry.expiresAt` check at every per-layer build site (Effects 2/3) | Timer-based recovery introduces clock-skew, cleanup, and stale-closure bugs. Inline check fires whenever Effect re-runs (driven by `filterVersion` or `viewsKey`); recovery is the next user click. |
| View-not-found tile error detection | `imageloaderror` body parsing to detect `S/SDc:1513` and re-materialize | Existing tile-error toast (`MapChartRenderer.tsx:347-358`) + chart-driven re-materialize via `AggregatedWidgetRenderer` | Reactive XHR parsing is explicitly rejected by user lock. The proactive `Date.now() >= expiresAt` check prevents most view-not-found errors at source; remaining races surface via the existing tile-error toast. |
| Materialize trigger from map widget | `useEffect([filterVersion]) → materializeFilter(...)` inside `MapChartRenderer` | Pure consumer pattern: read `useFilterViewStore.views[tableId]` only; let `AggregatedWidgetRenderer` on the same `tableId` materialize | Phase 14 VSTORE-V13-02 lock. Multiple renderers triggering materialize on same `tableId` would issue 2N redundant DDL calls per filter change. The map widget on a `tableId` with no `AggregatedWidgetRenderer` falls through to raw table — accepted limitation parallel to Phase 15 V13-LIMIT-01. |
| Custom `MapWidgetConfig` extension for view name | Add `viewName?: string` to `MapWidgetConfig` and persist it | Substitute `tableRef = viewName ?? rawTableRef` at the call site (runtime substitution, not config persistence) | `viewName` is runtime state, not user config. Adding a field would leak runtime state into a persisted shape and require migration logic. |
| Custom error class for view-not-found | New `ViewNotFoundError` class | Existing `isViewNotFoundError(err)` helper in `kinetica_bi/src/lib/kineticaErrors.ts` (Phase 15 LIFE-V13-02) | Phase 15 already established the pattern. Phase 16 doesn't use it (proactive-only TTL recovery), but if future scope adds reactive recovery, the helper is ready. |

**Key insight:** Phase 16 is a **wiring change**, not a primitive-build phase. Every primitive (store, helper, badge, error detection, OL update mechanics) was built and verified in Phases 13-15. Phase 16's job is to **swap two function-call shapes** (`buildWmsParams(cfg, filterVersion, whereClause)` → `buildWmsParams(cfg, materializeVersion)`) and **add one top-level selector** (`viewsKey`). Resist the temptation to add new primitives; reach for the existing ones first.

## Common Pitfalls

### Pitfall V13-P-06: Effect 3 Surgery Drops v1.2 Lifecycle Locks

**What goes wrong:** While editing Effect 2 / Effect 3 to swap LAYERS source and add `_mv` emission, the developer accidentally deletes / re-shapes adjacent code that implements M-01 (mapRef guard), M-02 (`source.updateParams` per layer), Pitfall 1 (addLayer / removeLayer; never dispose), Pitfall 4 (XHR + arraybuffer + base64 imageLoadFunction), or the ResizeObserver `updateSize` plumbing.

**Why it happens:** The Effects 2 and 3 bodies are large (~80 + ~25 LOC). A bulk find-and-replace of `whereClause` references can sweep up adjacent locks. The per-layer iteration loop is dense; collapsing it to a different shape risks the dep-array semantics.

**How to avoid:**
1. Frontload a diff-locked block-comment at the top of Effects 2 and 3 enumerating EVERY v1.2 lock preserved (M-01..M-08, Pitfall 1..4) and every Phase 16 change (LAYERS source, `_mv`, dep array).
2. Edit ONLY the per-layer `wmsParams` build call sites: `MapChartRenderer.tsx:333-337` and `:421-422`. Surrounding plumbing (lines 285-332, 339-399 in Effect 2; 406-419, 423-426 in Effect 3) stays verbatim.
3. Effect 1 (Map create + ResizeObserver, lines 228-278) and Effect 4 (basemap swap, lines 429-435) are byte-unchanged — do NOT edit.
4. Pre/post-edit diff: `git diff MapChartRenderer.tsx` should show ONLY:
   - Removed: `whereClause = ""` lines (314-318, 415-417), `// Phase 16 TODO` comments
   - Added: `useFilterViewStore.getState().views[layer.table_id]` reads, `Date.now() >= expiresAt` checks, `viewName` substitution into `tableRef`, `materializeVersion` 2nd arg to `buildWmsParams`
   - Changed: Effect 3 dep array (line 426) `[filterVersion, includedLayers, tables]` → `[filterVersion, viewsKey, includedLayers, tables]`

**Warning signs:**
- After Phase 16, map tiles stop updating on filter changes (Effect 3 body re-shaped incorrectly)
- StrictMode dev builds construct two OL Map instances (mapRef guard accidentally removed)
- Map tiles show blank on initial render (ResizeObserver `updateSize` removed)
- Test E (`visible===false`) or Test I (M-01 dispose) starts failing in `MapChartRenderer.spec.tsx`

### Pitfall PT16-A: `_mv` Stickiness Across LAYERS Source Flips

**What goes wrong:** A layer transitions from `LAYERS=<viewName>` (filter active) → `LAYERS=<tableRef>` (filter cleared). If `_mv` is still attached to the request from the previous build, OL caches by URL — the new `LAYERS=<tableRef>&_mv=N` URL is different from the prior `LAYERS=<viewName>&_mv=N`, so a re-fetch fires correctly. BUT if the developer keeps `_mv` on tableRef requests (e.g., `_mv=0` sentinel or `_mv=<filterVersion>` repurposed), the URL diff is ambiguous and downstream debugging is confusing.

**Why it happens:** The temptation to "always emit `_mv` for cache-bust safety" is strong. The user-locked decision says omit-when-no-view; resist the temptation to backslide.

**How to avoid:** Strict gate in `wmsUrlBuilder.ts`: emit `_mv` ONLY when `materializeVersion !== undefined`. The undefined branch is the no-view path (LAYERS → tableRef or layerName). Spec test asserts: when `materializeVersion === undefined`, `expect(result).not.toHaveProperty('_mv')`.

**Warning signs:**
- Network tab shows `LAYERS=public.taxi_trips&_mv=0` after Clear All — incorrect; `_mv` should be absent.
- New describe block `_mv emission` test fails on the "absent-when-undefined" assertion.

### Pitfall PT16-B: `viewsKey` Selector Recomputes on Every Render

**What goes wrong:** Top-level `useFilterViewStore((s) => includedLayers.map(...).join('|'))` selector reads `includedLayers` from outer scope. If `includedLayers` is recomputed on every render (e.g., via `useMemo([allLayers, ids, visibility])`), the selector closure may capture a fresh `includedLayers` reference on each render, causing `viewsKey` to recompute and trigger Effect 3 re-fires unnecessarily.

**Why it happens:** Zustand selectors are pure; the selector function itself is captured at hook-call time. If the closure references React-render-scope variables, those are fresh on each render.

**How to avoid:** Either (a) include `includedLayers` in the selector's `useMemo` so the selector reference is stable, OR (b) compute `viewsKey` directly via `useMemo([allLayers, includedLayerIds, viewsSnapshot])` and skip the selector. Recommendation: derive `viewsKey` via Zustand selector but ensure `includedLayers` is already memoized at lines 159-171 (it is — `useMemo([allLayers, widgetConfig.includedLayerIds])` already exists).

**Warning signs:**
- Effect 3 fires on every render, even when no filter / store mutation occurred.
- React DevTools profiler shows excessive renders on map widget after Clear All.

### Pitfall PT16-C: `tables.find()` Race on Initial Mount

**What goes wrong:** `MapChartRenderer.tsx:327-328` already guards `if (!tableMeta) continue;` because `tables` arrives async via `useApiQuery` in `DashboardsPage`. Phase 16 does NOT change this guard, but the new `viewName` resolution path must respect it: a missing `tableMeta` means we can't build a valid LAYERS source, so we skip the layer add (matching v1.2 behavior).

**Why it happens:** Easy to assume that if `viewName` is truthy, we have a valid LAYERS source — but `viewName` is only meaningful relative to a server-side materialized view of `<schema.table>`. The view name itself doesn't need `tableMeta` for LAYERS, but the rest of the WMS params (X_ATTR, Y_ATTR, etc.) and the spatial config still need the underlying schema/columns.

**How to avoid:** Keep the `if (!tableMeta) continue;` guard. The `viewName` substitution happens AFTER the guard:
```typescript
const tableMeta = tables.find((t) => t.id === tableId);
if (!tableMeta) continue;                              // existing guard — KEEP
const rawTableRef = `${tableMeta.schema}.${tableMeta.name}`;
const layersSource = viewName ?? rawTableRef;          // Phase 16 addition
const wmsConfigInput = { ...cfg, tableId, tableRef: layersSource } as MapWidgetConfig;
```

**Warning signs:** Test G (filter subscription uses `layer.table_id`) regresses if the guard is removed.

### Pitfall PT16-D: Forgetting to Mock `useFilterViewStore` in `MapChartRenderer.spec.tsx`

**What goes wrong:** The existing spec mocks `useFilterStore`, `useDashboardLayersStore`, `useToastStore`, and the OL packages — but does NOT mock `useFilterViewStore` (Phase 14 dormant store; never used by this file pre-Phase 16). When Phase 16 wires `MapChartRenderer` to read `useFilterViewStore`, the spec must add a `_filterViewState` shared object and a `vi.mock("../../store/filterViewStore", ...)` block mirroring `_filterState` at lines 29-32.

**Why it happens:** Phase 14 deliberately shipped the store dormant. The spec mocks were last updated in Phase 12 (no `useFilterViewStore` consumer existed). The Zustand reset shim covers state isolation across runs, but the spec needs an explicit hook mock that returns the per-test view-store snapshot.

**How to avoid:** Add to `MapChartRenderer.spec.tsx` (mirroring lines 151-164):
```typescript
const _filterViewState: { views: Record<number, any> } = { views: {} };

vi.mock("../../store/filterViewStore", () => {
  const hook = (selector: (s: any) => any) => selector({ views: _filterViewState.views });
  (hook as any).getState = () => ({ views: _filterViewState.views });
  return { useFilterViewStore: hook };
});
```

Add to `beforeEach`: `_filterViewState.views = {};`

**Warning signs:** Spec extension throws `useFilterViewStore is not a function` or returns `undefined` for `getState()`.

### Pitfall PT16-E: `filterVersion` Removal Breaks Pre-Materialize Re-Fires

**What goes wrong:** A developer notices that Phase 16's `viewsKey` selector triggers Effect 3 re-fires when `materializeVersion` changes — and concludes `filterVersion` is redundant. They remove `useFilterStore` import. Result: Effect 3 no longer fires when chip state changes BUT before materialize completes (e.g., during the 300ms debounce). Map tiles stay stale until materialize completes.

**Why it happens:** `filterVersion` increments on chip mutation (immediate). `viewsKey` only changes after `setView` writes the new view name (post-300ms-debounce + materialize round-trip). If only `viewsKey` is the dep, Effect 3 doesn't re-fire on chip mutation alone.

**How to avoid:** Keep `filterVersion` as a primary trigger in Effect 3 dep array. Final shape: `[filterVersion, viewsKey, includedLayers, tables]`. CONTEXT.md §"Effect 3 dep array" explicitly locks this. The eslint-disable comment carries forward unchanged.

**Warning signs:** Map tiles don't update during the 300ms materialize debounce; only update after materialize completes.

### Pitfall PT16-F: Deleting `wmsUrlBuilder.spec.ts` FILT-04 Block Without Removing All `_v` Test Updates

**What goes wrong:** The atomic deletion of FILT-04 (lines 470-492) is straightforward. But the existing `_v` assertions at lines 70, 75, 486, 489 must also be updated to `_mv` semantics — and the semantic shift (always-emitted → present-when-defined) changes the assertion shape. If only the describe block is deleted but the `_v` assertions are left, tests fail on missing `_v` property.

**Why it happens:** Bulk delete is easier than per-line updates. The semantic shift is subtle: `_v` was always emitted; `_mv` is conditional.

**How to avoid:** Update assertions to:
- Line 70 ("emits _v as stringified filterVersion") → "emits `_mv` as stringified materializeVersion when materializeVersion is provided" — assertion becomes `expect(result._mv).toBe("42")` with `materializeVersion = 42` arg.
- Line 75 ("emits _v=0 when filterVersion is 0") → "emits `_mv=0` when materializeVersion is 0" (note: 0 is a valid materializeVersion in the new contract; only `undefined` omits) OR delete this test if user-lock is "no `_mv=0` ever" (which it is — see PT16-A; planner verifies).
- Lines 486, 489 (within the deleted FILT-04 block) — gone with the block.
- New describe block "`_mv emission`" covers the present/absent matrix.

**Warning signs:** `wmsUrlBuilder.spec.ts` has red on `_v` property assertions; type errors on `buildWmsParams(makeConfig(), 1, "")` calls (3-arg form no longer accepted).

## Code Examples

Verified patterns from existing in-repo files (line numbers as of pre-Phase 16 commit `448dab9`):

### Per-Layer LAYERS Source Decision Tree (NEW pattern for Phase 16)

```typescript
// Inside Effect 2 or Effect 3 per-layer loop in MapChartRenderer.tsx
// Replaces lines 314-318 (Effect 2) and 415-417 (Effect 3)

const tableId = layer.table_id;

// Phase 16: per-layer view-store snapshot read at build time (PITFALL C-02 lock).
// V13-P-06 lock: Effect structure preserved; only the wmsParams build call changes.
const entry = useFilterViewStore.getState().views[tableId];
const isExpired = entry !== undefined && Date.now() >= entry.expiresAt;
const viewName = !isExpired ? entry?.viewName : undefined;
const materializeVersion = !isExpired ? entry?.materializeVersion : undefined;

// Resolve table_id → tableRef (existing guard at line 327-329 stays).
const tableMeta = tables.find((t) => t.id === tableId);
if (!tableMeta) continue;
const rawTableRef = `${tableMeta.schema}.${tableMeta.name}`;

// LAYERS source decision tree: viewName → tableRef → layerName (existing back-compat fallback).
// Substitute viewName into tableRef at call site (preserves narrow MapWidgetConfig type).
const wmsConfigInput = {
  ...cfg,
  tableId,
  tableRef: viewName ?? rawTableRef,
} as MapWidgetConfig;

// Phase 16: signature change — drops whereClause, adds materializeVersion.
const wmsParams = buildWmsParams(wmsConfigInput, materializeVersion);

// (Effect 2 only) — construct ImageWMS source as before. Tile-error handlers UNCHANGED.
// (Effect 3 only) — source.updateParams(wmsParams) (M-02 lock).
```

### `viewsKey` Top-Level Selector (NEW pattern for Phase 16)

```typescript
// At MapChartRenderer top, alongside existing filterVersion subscription (line 155).

// Phase 16: viewsKey drives Effect 3 re-renders when relevant per-layer entries mutate.
// Stable string identity → Effect 3 re-fires only when one of the included layers' entries changes.
// PITFALL C-02 lock: per-layer scope, not whole `s.views`.
const viewsKey = useFilterViewStore((s) =>
  includedLayers
    .map((l) =>
      `${l.table_id}:${s.views[l.table_id]?.viewName ?? ''}:${s.views[l.table_id]?.materializeVersion ?? 0}`
    )
    .join('|')
);
```

### `buildWmsParams` New Signature (Phase 16 wmsUrlBuilder.ts)

```typescript
// Source: planned shape, derived from existing kinetica_bi/src/lib/wmsUrlBuilder.ts:121-134

export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
): Record<string, string> {
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: SRS_VALUE,            // PITFALL M-03 lock — explicit SRS always included
    STYLES: STYLES_BY_MODE[config.renderMode],
  };

  // Phase 16 (MAP-V13-03): _mv ONLY when materializeVersion is defined; omit otherwise.
  // PT16-A lock: no _mv=0 sentinel; LAYERS source flip already changes URL.
  if (materializeVersion !== undefined) {
    params._mv = String(materializeVersion);
  }

  // LAYERS source decision tree: tableRef (canonical, may be view-substituted at call site)
  // → layerName (legacy back-compat fallback). viewName substitution handled by caller via tableRef.
  if (config.tableRef) {
    params.LAYERS = config.tableRef;
  } else if (config.layerName) {
    params.LAYERS = config.layerName;
  }

  // ... (rest of the file: spatial / render-mode branches UNCHANGED) ...

  // DELETED: WhereClause-driven QUERY emit block (lines 229-234 in v1.2).
  // AP-3 lock migrated to file-head doc comment: server-side WHERE moved to materialize endpoint (Phase 13).

  return params;
}
```

### `FilteringBadge` Extension for ANY-of-N-Layers Materializing (OPTIONAL — Claude's Discretion)

```typescript
// Source: extension of kinetica_bi/src/components/FilteringBadge.tsx pattern

import { useFilterViewStore } from "../store/filterViewStore";

export const MapFilteringBadge = ({ tableIds }: { tableIds: number[] }) => {
  const anyMaterializing = useFilterViewStore((s) =>
    tableIds.some((id) => s.views[id]?.materializing === true)
  );
  if (!anyMaterializing) return null;
  return (
    <span className="widget-filtering-badge">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>Filtering...</span>
    </span>
  );
};

// Caller (in DashboardsPage.tsx widget chrome, mirroring line 753):
// {widget.type === "map" && (
//   <MapFilteringBadge tableIds={includedLayers.map(l => l.table_id)} />
// )}
```

### `MapChartRenderer.spec.tsx` `useFilterViewStore` Mock (NEW pattern for Phase 16)

```typescript
// Add to top-of-file shared state (mirrors _filterState at lines 29-32):

const _filterViewState: {
  views: Record<number, {
    viewName: string;
    expiresAt: number;
    materializing: boolean;
    materializeVersion: number;
    dashboardId: number;
  }>;
} = { views: {} };

// Add alongside existing store mocks (mirrors lines 151-164):

vi.mock("../../store/filterViewStore", () => {
  const hook = (selector: (s: any) => any) => selector({ views: _filterViewState.views });
  (hook as any).getState = () => ({ views: _filterViewState.views });
  return { useFilterViewStore: hook };
});

// Add to beforeEach reset block (mirrors line 250):
// _filterViewState.views = {};

// Example new test:
it("emits LAYERS=<viewName> when useFilterViewStore.views[tableId] is set with non-expired entry", async () => {
  _layersState.layers = [makeLayer({ id: 1, position: 0, table_id: 10 })];
  _filterViewState.views = {
    10: {
      viewName: "_kbi_filt_u1_d1_t10_sabc",
      expiresAt: Date.now() + 60_000, // future
      materializing: false,
      materializeVersion: 3,
      dashboardId: 1,
    },
  };
  await act(async () => {
    render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
  });
  const source = allImageWmsInstances[0];
  // Source constructed with view-name LAYERS:
  const params = (ImageWMS as any).mock.calls[0][0].params;
  expect(params.LAYERS).toBe("_kbi_filt_u1_d1_t10_sabc");
  expect(params._mv).toBe("3");
});

it("falls through to LAYERS=<tableRef> when entry is expired (Date.now() >= expiresAt)", async () => {
  _layersState.layers = [makeLayer({ id: 1, position: 0, table_id: 10 })];
  _filterViewState.views = {
    10: {
      viewName: "_kbi_filt_u1_d1_t10_sabc",
      expiresAt: Date.now() - 1_000, // past
      materializing: false,
      materializeVersion: 3,
      dashboardId: 1,
    },
  };
  await act(async () => {
    render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
  });
  const params = (ImageWMS as any).mock.calls[0][0].params;
  expect(params.LAYERS).toBe("public.t10");
  expect(params).not.toHaveProperty("_mv");
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `LAYERS=<schema.table>&QUERY=<where_clause>` (v1.2 client-side WHERE injection) | `LAYERS=<view_name>` when filtered, `LAYERS=<schema.table>` when not (v1.3 server-side materialize) | v1.3 milestone (Phase 13 spike S1 PASS, Phase 14 store, Phase 15 chart consumer, Phase 16 map consumer) | Closes TD-V12-01 (v1.2 WMS-QUERY tile filter never narrowed tiles); restores end-to-end filter feedback on map widgets; removes client-side WHERE from `wmsUrlBuilder.ts`. |
| `_v=<filterVersion>` cache-buster (always emitted) | `_mv=<materializeVersion>` cache-buster (emitted only when view active) | Phase 16 (MAP-V13-03) | Cleaner URL semantics; cache-bust only fires for same-name `CREATE OR REPLACE` cycles, where it's necessary. LAYERS source flip already drives URL change between view ↔ raw-table states. |
| `buildWmsParams(config, filterVersion, whereClause)` (3-arg, AP-3 lock) | `buildWmsParams(config, materializeVersion)` (2-arg, server-side WHERE) | Phase 16 (atomic with Effect 2/3 migration) | Type-level enforcement of "no client-side WHERE". The deleted `whereClause` arg is the architectural anti-corruption boundary. |
| Effect 3 dep `[filterVersion, includedLayers, tables]` (Phase 12) | Effect 3 dep `[filterVersion, viewsKey, includedLayers, tables]` (Phase 16) | Phase 16 (MAP-V13-04) | Effect 3 re-fires on (a) chip-state changes (pre-materialize, via `filterVersion`) AND (b) view materialize completes (post-materialize, via `viewsKey`). Both paths needed for tile freshness. |
| Reactive XHR-response parsing for view-not-found (Phase 15 dual-path option) | Proactive `Date.now() >= expiresAt` check inline at build site (Phase 16 single-path) | Phase 16 (CONTEXT user-lock) | Simpler implementation; existing tile-error toast handles rare race. Map's pure-consumer role + chart-driven re-materialize covers most user flows. Map-only-on-table-X dashboard is accepted limitation. |

**Deprecated/outdated:**
- `wmsUrlBuilder.ts` `FILTER_PARAM = "QUERY"` constant (line 100) — TD-V12-01 root cause; deleted in Phase 16.
- `wmsUrlBuilder.ts` `whereClause` arg + FILT-04 emit block (lines 124, 229-234) — replaced by server-side WHERE at the materialize endpoint (Phase 13 VIEW-V13-06).
- `MapChartRenderer.tsx:316, 415` `Phase 16 TODO` comments + `whereClause = ""` stubs — replaced by live `useFilterViewStore.getState().views[layer.table_id]` reads.
- `wmsUrlBuilder.spec.ts:468-492` `FILT-04 — filter clause` describe block — deleted atomically with the LAYERS-swap landing.

## Open Questions

1. **`viewsKey` derivation: stable across includedLayers reordering?**
   - What we know: `includedLayers` is sorted by `position` ascending (`MapChartRenderer.tsx:170`). Drag-reorder bumps `position` values. The `viewsKey` derivation iterates `includedLayers.map(...).join('|')` — the string changes if iteration order changes.
   - What's unclear: does drag-reorder cause a spurious Effect 3 re-fire even when no view-store mutation occurred? Likely yes (the string would be `1:view_x:5|2:view_y:3` vs `2:view_y:3|1:view_x:5`).
   - Recommendation: planner considers sorting `viewsKey` by `table_id` numeric (stable across position drag-reorder): `includedLayers.map(...).sort().join('|')`. Spurious Effect 3 re-fire on drag-reorder is harmless (idempotent `updateParams` calls), but adds wasted work.

2. **`viewsKey` uniqueness when two layers share the same `table_id`?**
   - What we know: Phase 12 architecture allows multiple layers on the same `table_id` (e.g., one heatmap, one raster of the same dataset).
   - What's unclear: with the proposed derivation, two same-`table_id` entries would produce duplicate segments — harmless for string equality but not minimal.
   - Recommendation: derive from `Object.entries(views)` filtered by the unique `table_id` set, OR de-duplicate `includedLayers.map(l => l.table_id)` before mapping. Planner picks; both work.

3. **Should the OPTIONAL `MapFilteringBadge` extension use `useFilterViewStore` selector with array as input?**
   - What we know: Zustand selectors return primitives or stable references. `tableIds.some(...)` returns boolean — primitive, safe.
   - What's unclear: does `tableIds` (array) change identity on every render of the parent? If `includedLayers` is memoized, `tableIds.map(l => l.table_id)` may need memoization too. Planner verifies.
   - Recommendation: pass `tableIds` as memoized array; selector reduces to boolean.

4. **`isViewExpired(entry)` helper extraction site?**
   - What we know: Phase 15 has the inline check at `WidgetRenderer.tsx:310, 1067, 1104` (3 sites). Phase 16 adds 2 more sites (Effects 2 + 3).
   - What's unclear: does extracting to `src/lib/viewExpiry.ts` provide enough payoff to justify the new file?
   - Recommendation: planner picks. If extracted, signature is `isViewExpired(entry: FilterViewEntry | undefined): boolean` returning `entry !== undefined && Date.now() >= entry.expiresAt`. Spec covers undefined / past / future cases.

5. **Should Phase 16 spec extension live in a new file or extend `MapChartRenderer.spec.tsx`?**
   - What we know: existing spec is 666 LOC with comprehensive OL mocks. Phase 16 adds ~6-8 new tests covering LAYERS-swap + `_mv` + expiry.
   - What's unclear: does extension push the file over a maintainable size?
   - Recommendation: extend in-place (single file is easier to navigate than split-by-feature). Add a new `describe("MapChartRenderer — Phase 16 LAYERS-swap + _mv emission", () => {})` block at the bottom of the file with the new `_filterViewState` mock setup scoped to that block.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/16-map-filtering/16-CONTEXT.md` — User-locked decisions for Phase 16 (verbatim mirror in this RESEARCH.md `<user_constraints>` section)
- `.planning/REQUIREMENTS.md` § Map Filtering (LAYERS-swap) — MAP-V13-01..06 specs and traceability
- `.planning/ROADMAP.md` § Phase 16 — Goal + 5 success criteria
- `.planning/STATE.md` § Phase 13 lock — SPIKE-V13-01 PASS verbatim (WMS LAYERS=`<materialized_view_name>` renders PNG tiles); Phase 13 endpoint contract; Phase 15 lockdown
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` (243 LOC) — current builder: signature, QUERY emit block, `_v` cache-buster, AP-3 lock comments
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` (492 LOC) — current spec: `_v` assertions at lines 70/75/486/489, FILT-04 block at lines 470-492
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (487 LOC) — current renderer: Effect 1 (mount, lines 228-278), Effect 2 (layer reconciliation, lines 285-399), Effect 3 (per-layer filter, lines 406-426), Effect 4 (basemap, lines 429-435), tile-error handlers (lines 347-358), XHR imageLoadFunction (lines 200-225)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (666 LOC) — current spec: store mocks at lines 151-164, OL mocks at lines 65-145, test patterns A-J
- `kinetica_bi/src/store/filterViewStore.ts` (107 LOC) — Phase 14 contract: `FilterViewEntry` shape, `setView` auto-bump on same-name `CREATE OR REPLACE`, `bumpMaterializeVersion` dormant action
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` (1242 LOC) — Phase 15 patterns: `AggregatedWidgetRenderer` materialize trigger (lines 250-287), scoped selectors (lines 230-236), proactive expiry check (line 310, 1067, 1104), `RecordsTableRenderer` pure-consumer pattern (lines 994-1117)
- `kinetica_bi/src/components/FilteringBadge.tsx` (32 LOC) — Phase 15 component: scoped `materializing` selector pattern; reusable for map widget extension
- `kinetica_bi/src/lib/kineticaErrors.ts` (29 LOC) — Phase 15 helper: `isViewNotFoundError` (NOT used by Phase 16; documented for future scope)
- `kinetica_bi/node_modules/ol/source/ImageWMS.d.ts` (228 LOC) — verified `updateParams(params: any): void` signature; `getParams()` returns user-provided params; `params: { [x: string]: any }` accepts arbitrary key/value; `BBOX`, `WIDTH`, `HEIGHT`, `CRS`/`SRS` are dynamically managed by OL
- `.planning/research/PITFALLS.md` § V13-P-06 (Effect 3 collapse), V13-P-09 (multi-tab last-write-wins), V13-P-11 (records-table not subscribed parallel — applies to map-only-on-table-X), V13-P-12 (DDL permission silent fail)
- `.planning/research/ARCHITECTURE.md` § "FRONTEND v1.3 Filter Data Flow" — confirms map renderer reads `viewName` and calls `updateParams({LAYERS: viewName ?? table})`
- `.planning/phases/15-chart-filtering/15-RESEARCH.md` § "MapChartRenderer.tsx:316, 414 still uses buildWhereClause" — Phase 15 acknowledgment of Phase 16 scope; verifies stub-and-defer is the locked transition
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Trigger wiring scope" — `AggregatedWidgetRenderer` is sole materialize trigger (Phase 16 honors)

### Secondary (MEDIUM confidence)

- `.planning/codebase/STACK.md` § Frameworks — OpenLayers v10 baseline (verified by `ImageWMS.d.ts` shape; exact patch version not extracted)
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter (relied on for spec / source style)
- `.planning/codebase/TESTING.md` — vitest + jsdom + RTL (relied on for spec mock patterns)
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` § S1 — verbatim PNG-render confirmation (referenced by CONTEXT; not directly read in this research session — relying on STATE.md transcription)

### Tertiary (LOW confidence)

- (none — all critical claims grounded in primary sources)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies present in repo; OL `ImageWMS.updateParams` semantics verified against type definitions; Phase 14/15 plumbing verified by direct file reads.
- Architecture: HIGH — every pattern mirrored from Phase 15 `WidgetRenderer.tsx` and verified in-repo; per-layer scoped subscription pattern is established Phase 12 idiom.
- Pitfalls: HIGH — V13-P-06 Effect surgery risk explicitly documented in `.planning/research/PITFALLS.md`; PT16-A through PT16-F derived from direct code inspection of edit sites and CONTEXT user-locks.
- Validation strategy: HIGH for unit-level (specs cover decision tree + `_mv` matrix); MEDIUM for end-to-end "tiles visibly narrow" — explicitly deferred to Phase 17 fixture per CONTEXT lock.

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days; stable v1.3 architecture; revisit if Phase 17 verification surfaces unexpected edge cases or if OpenLayers v10 → v11 migration lands)
