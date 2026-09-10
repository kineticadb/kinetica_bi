# Phase 94: Dynamic View Filter Scope Wiring — Research

**Researched:** 2026-06-28
**Domain:** dv-bound combination-view wiring + deploy-time disable env flag
**Confidence:** HIGH (all findings from direct code inspection of post-Phase-93.5 codebase)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FSCOPE-V118-03 | Dynamic views support filter-scope config, gated behind a deploy-time disable switch (env flag exposed to client) so a deployment can hide the dv filter-scope UI when not wanted. | Three-case orchestrator extension + env-flag mirror sites identified; server symmetry confirmed; no new SQLite migration needed. |
</phase_requirements>

---

## Summary

Phase 94 has two independent deliverables:

**Deliverable 1 — Orchestrator dv enumeration + dv-bound renderer read-path flip.** The combination orchestrator currently skips dv-bound widgets (`tableId === undefined` guard, line 168) and dv-bound layers (`dynamic_view_id !== null` guard, line 204). Phase 94 extends the orchestrator to enumerate these vizs, compute `resolveFilterSet(widget.config.filterSelection, dvFilters[dvId])`, hash with `stableComboHash("dv", dvId, resolved)`, and materialize one `filterCombinationStore` combo entry per unique dv-combination. The orchestrator already calls `markMaterializing(hash, dashboardId, "table", tableId)` — the dv path needs `("dv", dvId)` as the `sourceType`/`sourceId`. After materialization, dv-bound widget `AggregatedWidgetRenderer` Effect 1 (the legacy dv-branch) and `MapChartRenderer`'s `dvFilterViewsKey`/`resolvedDvEntry` dv path are replaced with combo-store reads — same pattern as the table→combo flip in Phases 91/92.

**Deliverable 2 — Deploy-time DISABLE env flag.** A new boolean env var `DISABLE_DV_FILTER_SCOPE` is read at boot via a new `readBoolEnv` helper (or a simple `process.env.DISABLE_DV_FILTER_SCOPE === "true"` check), exposed on `/api/me` as `dvFilterScopeDisabled: boolean`, propagated via `MeResponse` → `fetchMe` → `useAuthStore`. In `ChartConfigPanel` and `KineticaWmsLayerForm`, the `FilterSelectionPanel` is hidden for dv-bound vizs when `dvFilterScopeDisabled === true`. Table-bound widgets/layers are entirely unaffected.

**Primary recommendation:** Implement in two plans: Plan 01 owns the orchestrator dv enumeration + both dv renderer read-path flips (the engine); Plan 02 owns the env-flag plumbing (server boot → `/api/me` → client auth store → UI gating). These are decoupled — Plan 02 touches zero orchestrator or renderer code.

---

## Three Source-Type Cases (LOCKED)

The roadmap names three cases. Here is the exact behaviour for each:

### Case A: table-bound viz

No change from Phase 93.5. Orchestrator enumerates via `tableId !== undefined` + `isTriggerType`. Reads `filterState.filters[tableId]`. Hashes `stableComboHash("table", tableId, resolved, shapesForHash)`. Combo entry in `filterCombinationStore.registry` with `sourceType: "table"`. Renderers read via `vizToHash["w:<id>"]` or `vizToHash["l:<id>"]`.

### Case B: dv-bound viz WITH active dvFilters

`dynamicViewId` is set, `dvFilters[dvId]` is non-empty, `dvStatus === "materialized"`.

Orchestrator reads `filterState.dvFilters[dvId]`. Calls `resolveFilterSet(cfg, dvFilters[dvId])` (cfg = `widget.config.filterSelection`). Hashes `stableComboHash("dv", dvId, resolved)` — NO spatial 4th arg (server rejects spatial on dv path, enforced by 400 on `hasSpatialReq`). Fires `POST /api/filter/materialize { dashboardId, dynamicViewId: dvId, filters: resolved, combinationKey: hash }`. Server `buildFilterViewName` with `dynamicViewId + combinationKey` appends `_c<hash8>` to the dv filter view name. Combo entry stored with `sourceType: "dv", sourceId: dvId`.

AggregatedWidgetRenderer `effectiveViewName` source flips: instead of `dvFilterViewName || dvViewName`, reads `comboEntry?.viewName || dvViewName`. MapChartRenderer dv path: `resolvedDvEntry` for dv-bound layers reads combo entry when `vizToHash["l:<id>"]` is a `dv:` hash.

### Case C: dv-bound viz WITHOUT dvFilters (empty)

`dynamicViewId` is set, `dvFilters[dvId]` is empty.

Orchestrator: `resolveFilterSet(cfg, [])` = `[]` (regardless of filterSelection). `stableComboHash("dv", dvId, [])` ends `:NOFILTER`. Skip materializing, set `vizToHash["dv:<id>"] = undefined`. No combo entry. Renderer falls back to raw dv view (`dvViewName`) — same as today's `dvFilters.length === 0` path. The existing `dropFilterView({ dynamicViewId }) + clearDvView(dvId)` cleanup in Effect 1 is removed (orchestrator owns it now).

---

## Orchestrator dv Enumeration Edit Points (file:line)

**File:** `packages/web/src/hooks/useCombinationOrchestrator.ts`

### widgetsKey dep (lines 103–115)

Current filter excludes dv-bound widgets: `(w.config.tableId as number | undefined) !== undefined`. Phase 94 adds a parallel `dvWidgetsKey` selector for dv-bound trigger widgets, or folds dv widgets into the existing key with a `dv:<dvId>` segment. Simplest: add a second `dvWidgetsKey` useMemo, add it to the dep array.

```typescript
// NEW — Phase 94: stable primitive key for dv-bound trigger widgets
const dvWidgetsKey = useMemo(
  () =>
    widgets
      .filter((w) => isTriggerType(w.type) && typeof w.config.dynamicViewId === "number")
      .map((w) => `dv:${w.config.dynamicViewId}:${w.id}`)
      .sort()
      .join(","),
  [widgets],
);
```

Add `dvWidgetsKey` to Effect dep array (line 490): `[filterVersion, spatialFilterVersion, dashboardId, widgetsKey, layersKey, dvWidgetsKey, ceiling]`.

Also need `dvFilterVersion`: the orchestrator must re-fire when `dvFilters` change. `filterStore.filterVersion` already bumps on `addDvFilter` (confirmed at `WidgetRenderer.tsx:120` — "Phase 63: `addDvFilter` bumps `filterVersion`"). Therefore **no new dep is needed** — `filterVersion` already drives the re-fire for the dv path. Verify: `filterStore.ts` addDvFilter increments `filterVersion`.

### STEP A widget loop (lines 165–198)

After the existing widget loop, add a dv-widget loop:

```typescript
// Phase 94: dv-bound trigger widgets
// byDv: Map<dvId, Map<hash, { resolved; widgetIds }>>
type DvHashEntry = { resolved: ReturnType<typeof resolveFilterSet>; widgetIds: number[] };
const byDv = new Map<number, Map<string, DvHashEntry>>();

for (const w of widgets) {
  if (!isTriggerType(w.type)) continue;
  const dvId = w.config.dynamicViewId as number | undefined;
  if (dvId === undefined) continue; // table-bound handled above
  const dvEntry = useDynamicViewStore.getState().views[dvId];
  if (dvEntry?.status !== "materialized") continue; // gate: dv must be materialized
  const cfg = w.config.filterSelection as FilterSelectionConfig | undefined;
  const dvFilters = (filterState.dvFilters[dvId] ?? []) as ReturnType<typeof resolveFilterSet>;
  const resolved = resolveFilterSet(cfg, dvFilters);
  const hash = stableComboHash("dv", dvId, resolved); // NO spatial 4th arg
  if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
    vizKeyToHash.set(`w:${w.id}`, undefined);
    continue;
  }
  let hm = byDv.get(dvId);
  if (!hm) { hm = new Map(); byDv.set(dvId, hm); }
  let e = hm.get(hash);
  if (!e) { e = { resolved, widgetIds: [] }; hm.set(hash, e); }
  e.widgetIds.push(w.id);
  vizKeyToHash.set(`w:${w.id}`, hash);
}
```

Similarly, a dv-layer loop mirrors the table layer loop with `dynamic_view_id !== null` (currently skipped).

### STEP B ceiling enforcement

Ceiling is per-TABLE in the current STEP B. The dv path does NOT need a ceiling — there is at most one dv view per `dvId` (one entry per unique filter-combination of that dv). The ceiling constant `MAX_COMBINATION_VIEWS_PER_TABLE` applies to table combos only. Skip ceiling for dv entries (or apply the same ceiling per dvId, but the ROADMAP SC3 implies dv combos are independently capped). **Decision for planner:** simplest is no ceiling for dv path in Phase 94 (dv combinations are bounded by the number of active dvFilters which are naturally bounded by `FILTER_CAP_PER_TABLE`).

### STEP C desired set

Extend desired to include dv entries from `byDv`:
```typescript
for (const [dvId, hashMap] of byDv) {
  for (const [hash, entry] of hashMap) {
    if (!hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
      desired.set(hash, { tableId: undefined, dvId, resolved: entry.resolved, acceptedShapes: [], spatialTarget: undefined, sourceType: "dv" });
    }
  }
}
```
The `DesiredEntry` type needs `dvId?: number` and `sourceType: "table" | "dv"`.

### STEP D dispatch

When `sourceType === "dv"`:
```typescript
storeActions.markMaterializing(hash, dashboardId, "dv", dvId!);
// No spatial args — dv path is column-only
materializeFilter(
  { dashboardId, dynamicViewId: dvId!, filters: resolved, combinationKey: hash },
  ctrl.signal,
)
```
The `materializeFilter` call already accepts `dynamicViewId` in its args type (confirmed: `MaterializeFilterArgs` at `client.ts` includes `dynamicViewId?`). The `combinationKey` field is already part of `MaterializeFilterArgs` (added in Phase 89).

### STEP E currentVizKeys

Include dv-bound layers in `currentVizKeys`:
```typescript
for (const layer of layers) {
  if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) {
    currentVizKeys.add(`l:${layer.id}`); // dv-bound layers NOW tracked
  }
}
```
(Previously skipped — Phase 94 adds them.)

### filterCombinationStore.markMaterializing signature

Current call: `storeActions.markMaterializing(hash, dashboardId, "table", tableId)`. The store's `markMaterializing` already takes `sourceType: "table" | "dv"` and `sourceId: number` — confirmed by `filterCombinationStore.ts` (`CombinationEntry.sourceType` + `sourceId`). No store signature change needed.

---

## Legacy dv-Branch Effect 1 — Disposition: REMOVE (Phase 94)

**File:** `packages/web/src/components/charts/WidgetRenderer.tsx`, lines 512–537

The current dv-branch in Effect 1 (`WidgetRenderer.tsx:512`):
1. Gates on `dvStatus !== "materialized"` → return
2. Reads `dvFilters = filterStore.dvFilters[dvId]`
3. If empty → `dropFilterView({ dynamicViewId })` + `clearDvView(dvId)` → return
4. Calls `markDvMaterializing` → `materializeFilter({ dynamicViewId, filters: dvFilters })` → `setDvView`

Phase 94 removes this entire dv-branch from Effect 1. The orchestrator takes over. **Sole-trigger gate preserved.** Effect 1 dep array is further trimmed: `dvStatus` can be removed if it was only there for the dv-branch gate (but `dvStatus` is also in Effect 2's dep array, so it stays). The `materializeAbortRef` can be removed if Effect 1 has no remaining body — but it's currently used only by the dv-branch, so it can be removed too.

**Consequence:** `WidgetRenderer.tsx` Effect 1 becomes essentially empty (just the `if (tableId === undefined && dynamicViewId === undefined) return` guard). The `setTimeout` wrapper can be removed entirely. Effect 1 can be deleted, leaving only Effect 2.

**Sole-trigger invariant after Phase 94:**
```
grep -r "materializeFilter|dropFilterView" packages/web/src/components/charts/
```
Must find: orchestrator (`useCombinationOrchestrator.ts`) and `RecordsTableRenderer` (its own legacy island). `WidgetRenderer.tsx` dv-branch removed — no `materializeFilter` import remains active for the dv path in any renderer.

---

## dv Renderer Read-Path Change

### AggregatedWidgetRenderer (WidgetRenderer.tsx)

Current `effectiveViewName` selection for dv-bound (lines 627–638):
```typescript
if (dynamicViewId !== undefined) {
  const dvSource = dvFilterViewName || dvViewName;  // dvFilterViewName from filterViewStore.dvViews
  effectiveViewName = dvSource;
}
```

Phase 94 replacement:
```typescript
if (dynamicViewId !== undefined) {
  // Phase 94: prefer combo view (dv-combination) when available, fall back to raw dv view.
  const comboHash = useFilterCombinationStore.getState().vizToHash[vizKey];
  const dvComboEntry =
    comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[comboHash]
      : undefined;
  const dvSource = dvComboEntry?.viewName || dvViewName; // combo → dv (no table combo fallback)
  if (!dvSource) { ... same error path ... }
  effectiveViewName = dvSource;
}
```

The `dvFilterEntry` selector (line 445: `useFilterViewStore(s => s.dvViews[dvId])`) and `dvFilterViewName`/`dvFilterMaterializing` are RETIRED for this path. The combo entry's `materializing` flag becomes the suspend gate for the dv path.

**Effect 2 suspend gate changes (lines 593–595):**
- OLD: `if (dynamicViewId !== undefined && dvFilterMaterializing) return`
- NEW: `if (dynamicViewId !== undefined && dvComboEntry?.materializing) return`
  (where `dvComboEntry` is read imperatively via `getState()` as already done for table path)

**Effect 2 dep array (lines 707–717):** `dvFilterViewName` and `dvFilterMaterializing` are removed; `comboKey` and `combinationVersion` already drive the dv-combo path (same primitives).

**`dvFilterEntry` selector (line 445):** Can be removed if nothing else in WidgetRenderer reads `filterViewStore.dvViews`. Check: only `dvFilterViewName` and `dvFilterMaterializing` consume it — both retired.

### MapChartRenderer.tsx — dv-bound layer path

The existing dv path in MapChartRenderer (Effects 2+3) reads `filterViewStore.dvViews[layer.dynamic_view_id]` for `resolvedDvEntry`. Phase 94 changes this to read `filterCombinationStore.vizToHash["l:<layerId>"]` for dv-bound layers.

**`dvFilterViewsKey` selector (lines 593–605):** Currently subscribes to `filterViewStore.dvViews` for dv-bound layers. Phase 94 replaces with a `dvComboViewsKey` that reads from `filterCombinationStore.vizToHash` for dv-bound layers — same S-02 primitive-string pattern as `comboViewsKey`.

**Effect 2 (~line 1201–1206) and Effect 3 (~line 1455–1458):** The `dvFilter = useFilterViewStore.getState().dvViews[layer.dynamic_view_id]` read is replaced with a combo entry read:
```typescript
if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) {
  const dvLayerVizKey = `l:${layer.id}`;
  const dvComboHash = useFilterCombinationStore.getState().vizToHash[dvLayerVizKey];
  const dvComboEntry =
    dvComboHash && !dvComboHash.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[dvComboHash]
      : undefined;
  if (dvComboEntry && !dvComboEntry.materializing && dvComboEntry.viewName) {
    resolvedDvEntry = { status: "materialized", viewName: dvComboEntry.viewName };
    resolvedDvVersion = dvComboEntry.materializeVersion;
  }
}
```

Dep arrays in Effect 2 (line ~1421) and Effect 3 (line ~1504): `dvFilterViewsKey` → `dvComboViewsKey`.

---

## DV Source Set for FilterSelectionPanel

The `FilterSelectionPanel`'s source checklist (built from `FILTER_PRODUCING_TYPES`) lists widgets that emit `ActiveFilter` entries with a `sourceWidgetId`. For a **dv-bound** widget, the relevant `ActiveFilter` entries come from `filterStore.dvFilters[dvId]`, not `filterStore.filters[tableId]`.

**Who produces `dvFilters[dvId]`?** Confirmed in `WidgetRenderer.tsx:864` and `~line 120`: `addDvFilter` is called from `onDrillDown` inside dv-bound chart widgets. The `sourceWidgetId` on these dvFilter entries is the widget that was drilled. Therefore, the source allow-list for a dv-bound widget lists OTHER dv-bound widgets on the same dv (same `dynamicViewId`) — the filter producer must be a chart widget whose `dynamicViewId` matches.

**UI implication:** `FilterSelectionPanel` already receives the full `widgets` list and filters to `FILTER_PRODUCING_TYPES`. For dv-bound widgets, the checklist should further restrict to widgets with the same `dynamicViewId` (since only dv-siblings can produce `dvFilters[dvId]`). The `selfWidgetId` exclusion already handles the self-case.

**Planner decision:** The `FilterSelectionPanel` receives all `widgets`. The orchestrator's `resolveFilterSet` correctly uses `dvFilters[dvId]` for dv-bound path and `filters[tableId]` for table path. The UI checklist only matters for the allow-list mode — showing all filter-producing widgets is safe (cross-dv widgets would just never match a `dvFilter` sourceWidgetId and would be filtered out at resolve time). No new prop or filtering logic is strictly required, but the planner may choose to scope the checklist to same-dv widgets for UX clarity.

---

## Server dv + combinationKey Symmetry — CONFIRMED, NO CHANGE NEEDED

**Finding (HIGH confidence):** `buildFilterViewName` in `packages/server/src/lib/viewNaming.ts` already handles the dv path with `combinationKey` symmetrically. The `dv path` branch at `viewNaming.ts:125–127`:
```typescript
const segment = args.dynamicViewId !== undefined ? `dv${args.dynamicViewId}` : `t${args.tableId}`;
const base = `_kbi_filt_u${u}_d${args.dashboardId}_${segment}_s${s}`;
if (args.combinationKey !== undefined && args.combinationKey !== "") {
  return `${base}_c${hashKey8(args.combinationKey)}`;
}
```
When `dynamicViewId` is set AND `combinationKey` is non-empty, the output is `_kbi_filt_u<user>_d<dashId>_dv<dvId>_s<session>_c<hash8>`. This is confirmed in the docblock at lines 97–100.

**Server POST /api/filter/materialize dv-path handler** (lines 1228–1234): already passes `combinationKey` to `buildFilterViewName`. Confirmed at line 1233: `combinationKey,` is included in the call.

**Conclusion:** No server change needed for Phase 94. The server already accepts `combinationKey` on both table and dv paths and produces symmetric view names.

**Supertests:** The existing `routes.filter-materialize` supertests cover both auth modes. Phase 94 should add a new test vector for the dv + combinationKey combination (not currently covered). This is a BOTH-auth-mode supertest addition to the existing server spec file.

---

## DISABLE Env Flag — Exact Mirror Sites

The v1.15 `ttlKeepaliveLeadMinutes` pattern is the canonical mirror. Phase 94 introduces `DISABLE_DV_FILTER_SCOPE` (boolean disable flag — absent/`"false"` = dv filter-scope **enabled**, `"true"` = **disabled**).

### 1. Server boot read (packages/server/src/index.ts)

Add after `MAX_COMBINATION_VIEWS_PER_TABLE` (line ~175):
```typescript
// Phase 94 (FSCOPE-V118-03): deploy-time disable switch for dv filter-scope UI.
// Absent or "false" → enabled (default). "true" → UI hidden for dv-bound vizs.
// Unlike the TTL ints, this is boolean — use simple string comparison, not readPositiveIntEnv.
const DISABLE_DV_FILTER_SCOPE = process.env.DISABLE_DV_FILTER_SCOPE === "true";
```

### 2. GET /api/me response (index.ts line ~410)

Extend the `res.json(...)` call:
```typescript
return res.json({
  user: { ... },
  authMode,
  ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES,
  maxCombinationViewsPerTable: MAX_COMBINATION_VIEWS_PER_TABLE,
  dvFilterScopeDisabled: DISABLE_DV_FILTER_SCOPE,   // NEW
});
```

### 3. MeResponse type (packages/web/src/api/client.ts line ~250)

```typescript
export type MeResponse = {
  user: AuthUser;
  authMode: AuthMode;
  ttlKeepaliveLeadMinutes: number;
  maxCombinationViewsPerTable: number;
  dvFilterScopeDisabled: boolean;   // NEW
};
```

### 4. fetchMe parser (client.ts lines ~287–290)

```typescript
dvFilterScopeDisabled: json.dvFilterScopeDisabled === true,  // NEW; absent → false (enabled)
```
Use `=== true` (not truthy) — ensures absent field defaults to `false` (dv filter-scope enabled).

### 5. Auth store state + bootstrap (packages/web/src/store/auth.ts)

```typescript
// AuthState type:
dvFilterScopeDisabled: boolean;   // NEW — Phase 94 (FSCOPE-V118-03)

// Initial state:
dvFilterScopeDisabled: false,

// bootstrap set call:
set({ status: "authenticated", ..., dvFilterScopeDisabled: me.dvFilterScopeDisabled, ... });
```

### 6. FilterSelectionPanel gating in ChartConfigPanel (ChartConfigPanel.tsx)

The `FilterSelectionPanel` render at line ~732 is currently gated on `selectedSource`. For dv-bound widgets (`selectedSource?.kind === "dynamic"` i.e. `draftDynamicViewId !== undefined`), add the disable gate:

```typescript
{selectedSource && !(draftDynamicViewId !== undefined && dvFilterScopeDisabled) && (
  <FilterSelectionPanel ... />
)}
```
Where `dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled)`.

Table-bound widgets: `draftDynamicViewId === undefined` — the `&&` short-circuits, FilterSelectionPanel shown always (unchanged).

### 7. FilterSelectionPanel gating in KineticaWmsLayerForm (for dv-bound layers)

`KineticaWmsLayerForm` renders `FilterSelectionPanel` as the last config-group. For dv-bound layers (`layer.dynamic_view_id !== null`), add the same gate. `KineticaWmsLayerForm` receives `layer: DashboardLayerDto` — `layer.dynamic_view_id` is accessible. Need to thread `dvFilterScopeDisabled` as a prop or read from auth store directly (auth store read in component is fine per convention).

---

## No New Storage Confirmation

**widget.config.filterSelection** — already persisted on `dashboard_widgets.config` JSON blob via existing `PATCH /api/dashboards/:id/widgets/:wid`. No migration. Used for dv-bound widgets in exactly the same way as table-bound widgets.

**layer.filter_scope** — added as a TOP-LEVEL column on `dashboard_layers` by Phase 93-02. Already used by dv-bound layers (the orchestrator reads `layer.filter_scope ?? undefined`). No migration needed.

**NO new SQLite column on `dashboard_dynamic_views`** — the original ARCHITECTURE.md sketch mentioned a `filter_selection TEXT` column on `dashboard_dynamic_views`, but this was superseded. Confirmed: `widget.config.filterSelection` (stored on the widget row) is the config location for dv-bound chart widgets; `layer.filter_scope` (stored on the layer row) is the config for dv-bound layers. The dv row itself needs no `filter_selection` column — the config lives on the viz that IS the consumer, not on the dv definition.

---

## dv + Spatial Deferred Boundary (LOCKED)

The server enforces `hasSpatialReq` check at index.ts lines 1204–1209: if `spatialFilters` or `spatialTarget` is present on a `dynamicViewId` request → `400 "Spatial filtering is not supported on a dynamic-view source"`. This is a hard server-side rejection.

The orchestrator dv loop must NEVER pass `spatialFilters`/`spatialTarget` to `materializeFilter` for dv entries. The `stableComboHash` call for dv entries takes no 4th `shapes` argument. The `resolveSpatialShapes` function is NOT called for dv-bound vizs.

The `FilterSelectionPanel` includes a `SPATIAL_DRAWS_SENTINEL` row for dv-bound widgets if `allowlist` mode is enabled. This sentinel stored in `allowedSourceWidgetIds` is currently inert for dv-bound vizs — `resolveSpatialShapes` is not called in the dv-orchestrator path, so the sentinel is never read. This is safe. The sentinel will simply be ignored.

---

## Common Pitfalls

### Pitfall 1: dvFilterVersion dep not added — orchestrator misses dvFilter changes

The orchestrator re-fires on `filterVersion`. `filterStore.addDvFilter` increments `filterVersion` (confirmed at WidgetRenderer.tsx line ~120). So `filterVersion` already drives the dv-combination recomputation. **Do NOT add a separate `dvFilterVersion` dep** — it doesn't exist; adding it would require a new counter, which introduces unnecessary complexity.

### Pitfall 2: Legacy dv-branch Effect 1 left in place alongside orchestrator

If Effect 1's dv-branch is not removed, it competes with the orchestrator: both would call `materializeFilter({ dynamicViewId })` on the same dv. This is the dual-trigger violation for the dv path. Phase 94 MUST remove the dv-branch atomically with wiring the orchestrator. (Same discipline as Phase 91 removed the table branch atomically.)

### Pitfall 3: dvFilterViewsKey in MapChartRenderer not updated

If `dvFilterViewsKey` continues to read `filterViewStore.dvViews` after the orchestrator takes over, Effect 3 in MapChartRenderer will not re-fire when a dv-combination view materializes (the combo store changes, not `filterViewStore.dvViews`). The dep key selector for dv-bound layers must be updated to `dvComboViewsKey` reading from `filterCombinationStore.vizToHash`.

### Pitfall 4: S-02 violation — subscribing to dvFilters array

When reading `dvFilters[dvId]` inside the orchestrator STEP A, use `filterState.dvFilters[dvId]` via imperative `getState()` — do NOT subscribe to it. Same pattern as the existing `filterState.filters[tableId]` read.

### Pitfall 5: useDynamicViewStore.getState() inside the setTimeout

The orchestrator must gate on `dvEntry?.status === "materialized"` before processing a dv-bound widget. This is an imperative `getState()` read inside the setTimeout callback — same as `shapes` read. Never subscribe to `dynamicViewStore.views` — the `dvWidgetsKey` dep handles re-fire when dv materialization status changes (since `dynamicViewVersion` bumps; but `dynamicViewVersion` is not in the orchestrator's dep array). **Decision for planner:** the dv-bound widget combo only fires when `filterVersion` bumps (a filter is added/changed). If the dv materializes AFTER the last `filterVersion` bump, the orchestrator will not re-fire. This is the same behaviour as today — the widget already relied on dvStatus gating in Effect 1. The fix is: the existing `useDynamicViewMaterializeChain` already bumps `dynamicViewVersion` on dv materialize; if `dynamicViewVersion` is added to the orchestrator dep array, it would catch this case. **This is a planner decision to lock.**

### Pitfall 6: filterCombinationStore.markMaterializing sourceType/sourceId mismatch

Must call `markMaterializing(hash, dashboardId, "dv", dvId)` — NOT `"table", tableId`. The registry entry's `sourceType: "dv"` and `sourceId: dvId` are needed for cleanup loops (the snapshot-then-DROP loop at App.tsx/DashboardsPage.tsx iterates all entries regardless of sourceType).

---

## Code Examples

### Orchestrator dv dispatch call (Phase 94 extension)

```typescript
// In STEP D, when sourceType === "dv":
storeActions.markMaterializing(hash, dashboardId, "dv", dvId);
controllersRef.current.get(hash)?.abort();
const ctrl = new AbortController();
controllersRef.current.set(hash, ctrl);
// NO spatial args — dv path is column-only (server enforces 400 on spatial + dvId)
materializeFilter(
  { dashboardId, dynamicViewId: dvId, filters: resolved, combinationKey: hash },
  ctrl.signal,
)
  .then((res) => {
    if (ctrl.signal.aborted) return;
    useFilterCombinationStore.getState().setEntry(hash, {
      viewName: res.viewName,
      expiresAt: res.expiresAt,
      materializing: false,
      materializeVersion: 0,
      refCount: useFilterCombinationStore.getState().registry[hash]?.refCount ?? 0,
      dashboardId,
      sourceType: "dv",
      sourceId: dvId,
    });
  })
  .catch((err) => {
    if ((err as Error)?.name === "AbortError") return;
    if (ctrl.signal.aborted) return;
    useFilterCombinationStore.getState().clearEntry(hash);
  });
```

### AggregatedWidgetRenderer effectiveViewName (dv path, Phase 94)

```typescript
// Phase 94: replace dvFilterViewName || dvViewName with combo-or-raw-dv
if (dynamicViewId !== undefined) {
  // Imperative combo read (same pattern as table path comboEntry read above)
  const dvComboHash = useFilterCombinationStore.getState().vizToHash[vizKey];
  const dvComboEntry =
    dvComboHash && !dvComboHash.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[dvComboHash]
      : undefined;
  const dvSource = dvComboEntry?.viewName || dvViewName; // combo → raw dv
  if (!dvSource) { /* error path */ return; }
  effectiveViewName = dvSource;
}
```

---

## Open Questions / Planner Decisions Required

1. **`dynamicViewVersion` in orchestrator dep array?** If `dynamicViewVersion` is NOT in the dep array, the dv-combination materializes only on `filterVersion` bumps. If a dv materializes AFTER the last filter change, the orchestrator won't re-fire to pick up the newly-available dv view. Adding `dynamicViewVersion` to the dep array fixes this but adds a reactive dep. **Recommendation:** add it — it bumps rarely (only on dv materialize), and missing the window would leave a dv-bound widget on the raw-dv-view indefinitely until the next filter change.

2. **Ceiling for dv combos?** No ceiling is needed per dvId because the number of unique dv-filter combinations is naturally bounded by `dvFilters[dvId].length` which is capped. **Recommendation:** skip ceiling for dv path in Phase 94. Add a comment noting the omission and why it's safe.

3. **dvWidgetsKey vs dvLayersKey symmetry?** Need to decide if Phase 94 includes dv-bound LAYERS (map layers with `dynamic_view_id !== null`) in addition to dv-bound WIDGETS. The ROADMAP SC3 says "dv-bound layer's filter scope uses the dynamicViewId as the stableComboHash source key". This implies dv-bound layers are in scope. **Recommendation:** include both in Phase 94.

4. **FilterSelectionPanel checklist scoping for dv-bound widgets** — show all filter-producing widgets (current behaviour) or restrict to same-dv siblings? **Recommendation:** restrict to same-dv siblings for UX clarity (`selectedSource?.kind === "dynamic"` check in `FilterSelectionPanel` or at the ChartConfigPanel call site). Simple: filter `widgets` to `w.config.dynamicViewId === draftDynamicViewId` before passing to `FilterSelectionPanel`.

5. **`DISABLE_DV_FILTER_SCOPE` env var name** — this is the proposed name. Alternatives: `DV_FILTER_SCOPE_ENABLED=false` (inverse). **Recommendation:** use `DISABLE_DV_FILTER_SCOPE=true` (disable by setting to "true" = absence means enabled). This matches operator's expectation: adding a new env var to disable a feature.

---

## Standard Stack

No new npm packages. All existing:
- `filterCombinationStore` (Phase 89) — already has `markMaterializing("dv", dvId)` signature
- `resolveFilterSet` (Phase 88) — pure, works for dvFilters same as table filters
- `stableComboHash("dv", dvId, resolved)` (Phase 88) — `sourceType: "dv"` already supported
- `materializeFilter({ dynamicViewId, filters, combinationKey })` (Phase 89) — server already handles
- `buildFilterViewName({ dynamicViewId, combinationKey })` (Phase 89/server) — already handles dv + combo
- `useAuthStore` — extend with `dvFilterScopeDisabled: boolean`

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/hooks/useCombinationOrchestrator.ts` | Add dv widget+layer loops in STEP A; extend STEP C desired; extend STEP D dispatch; add `dvWidgetsKey` dep; optionally add `dynamicViewVersion` dep; import `useDynamicViewStore` |
| `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` | New Phase 94 describe block: dv-combo materialize, dv-NOFILTER skip, dv-widget not-materialized gate, dv+table shared refCount, env-flag-no-UI-change-to-engine |
| `packages/web/src/components/charts/WidgetRenderer.tsx` | Remove Effect 1 dv-branch entirely; update `effectiveViewName` for dv path to read combo entry; remove `dvFilterEntry`/`dvFilterViewName`/`dvFilterMaterializing` selectors; update Effect 2 dv suspend gate; trim dep array |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | Replace `dvFilterViewsKey` with `dvComboViewsKey` (reads `filterCombinationStore.vizToHash` for dv-bound layers); update `resolvedDvEntry` resolution in Effects 2+3 to read combo entries |
| `packages/web/src/components/charts/ChartConfigPanel.tsx` | Add `dvFilterScopeDisabled` auth store read; gate `FilterSelectionPanel` for dv-bound widgets |
| `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` | Gate `FilterSelectionPanel` for dv-bound layers when `dvFilterScopeDisabled` |
| `packages/web/src/store/auth.ts` | Add `dvFilterScopeDisabled: boolean` field; default `false`; set in bootstrap |
| `packages/web/src/api/client.ts` | Add `dvFilterScopeDisabled: boolean` to `MeResponse`; add parser in `fetchMe` |
| `packages/server/src/index.ts` | Add `DISABLE_DV_FILTER_SCOPE` boot read; extend `/api/me` response |
| `packages/server/tests/routes.filter-materialize.spec.ts` | Add both-auth-mode test for dv + combinationKey combination view name |

---

## Sources

### Primary (HIGH confidence — direct code inspection)
- `packages/web/src/hooks/useCombinationOrchestrator.ts` (full file, post-Phase-93.5) — exact guard lines (168, 204), dep array (490), STEP A/B/C/D/E structure
- `packages/web/src/components/charts/WidgetRenderer.tsx` (lines 360–718) — Effect 1 dv-branch (512–537), effectiveViewName selection (627–638), Effect 2 dep array (707–717)
- `packages/web/src/components/charts/MapChartRenderer.tsx` (grep output) — dvFilterViewsKey (line 593), resolvedDvEntry reads (lines 1201–1206, 1455–1458), dep arrays (1421, 1504)
- `packages/server/src/lib/viewNaming.ts` (full file) — confirms dv + combinationKey symmetric at lines 125–132
- `packages/server/src/index.ts` (lines 1195–1249) — dv-path handler; `combinationKey` already threaded to `buildFilterViewName` at line 1233
- `packages/web/src/store/auth.ts` (full file) — exact mirror sites for env-flag fields
- `packages/web/src/api/client.ts` (lines 246–290) — `MeResponse` type + `fetchMe` parser; exact pattern to mirror
- `packages/web/src/components/charts/ChartConfigPanel.tsx` (lines 180–190, 729–739) — `draftDynamicViewId` guard, FilterSelectionPanel render site
- `packages/server/src/index.ts` (lines 157–175) — `readPositiveIntEnv` + `MAX_COMBINATION_VIEWS_PER_TABLE` boot read pattern
- `.planning/phases/88-01-SUMMARY.md` — confirms `stableComboHash("dv", ...)` sourceType support
- `.planning/phases/90-03-SUMMARY.md` — confirms `tableId === undefined` guard + `dynamic_view_id !== null` guard; dual-trigger pattern
- `.planning/phases/91-01-SUMMARY.md` — confirms Effect 1 table-branch removal pattern
- `.planning/phases/92-01-SUMMARY.md`, `92-02-SUMMARY.md` — confirms `l:<layerId>` vizKey contract; dv-bound layer skip
- `.planning/phases/93-01-SUMMARY.md`, `93-02-SUMMARY.md` — confirms `FilterSelectionPanel` prop contract; `filter_scope` top-level field; no dv storage needed
- `.planning/phases/93.5-02-SUMMARY.md` — confirms `useMapOnlySpatialMaterialize` deleted; `spatialFilterVersion` dep safety

---

## Metadata

**Confidence breakdown:**
- Orchestrator extension edit points: HIGH — exact lines identified from code
- Legacy dv-branch removal scope: HIGH — confirmed Effect 1 structure post-Phase-91
- Server symmetry (no change needed): HIGH — `buildFilterViewName` dv+combo already implemented
- Env-flag mirror sites: HIGH — exact pattern from `ttlKeepaliveLeadMinutes` + `maxCombinationViewsPerTable`
- No new storage: HIGH — confirmed Phase 93-02 stores config on widget/layer rows
- dv-spatial deferred: HIGH — server enforces 400 on `hasSpatialReq + dynamicViewId`

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable codebase; no external library changes)
