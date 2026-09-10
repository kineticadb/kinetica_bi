# Phase 90: Combination-Orchestrator — Research

**Researched:** 2026-06-27
**Domain:** Dashboard-level hook that owns ALL combination-view materializations
**Confidence:** HIGH — grounded entirely in live code inspection

---

## Summary

Phase 90 introduces `useCombinationOrchestrator`, a new dashboard-level hook that is the
SOLE entity that calls `materializeFilter` for combination views. It fires on each
`filterVersion` tick, enumerates all widgets on the current dashboard, resolves each
widget's filter set via `resolveFilterSet`, hashes them via `stableComboHash`, diffs the
result against `filterCombinationStore.registry`, materializes NEW unique combinations
(one POST per new hash, with `combinationKey`), ref-counts via `acquire`/`release`, and
enforces the `MAX_COMBINATION_VIEWS_PER_TABLE = 10` ceiling with fallback to the global
all-filters view.

**This is a TRANSITION phase.** Phase 91/92 flip the renderer read paths to consume
`filterCombinationStore`. In Phase 90, the orchestrator runs ALONGSIDE the legacy
`AggregatedWidgetRenderer` Effect 1. Combination views are materialized but not yet read
by any renderer. The transition strategy is Option (a) below: dual-trigger, safe because
combination views have distinct `_c<hash8>` suffixes and do not collide with legacy view
names. Phase 91 retires Effect 1 from individual renderers.

**Primary recommendation:** Implement `useCombinationOrchestrator` as a standalone hook
in `packages/web/src/hooks/`, mounted in `DashboardOpen` immediately after
`useDynamicViewMaterializeChain`, using `filterVersion` as the sole Effect dep trigger.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMBO-V118-01 | One Kinetica view per UNIQUE combination across all visualizations; no duplicate WHERE clauses | Diff/dispatch algorithm + markMaterializing dedup guard prevent duplicate POSTs |
| COMBO-V118-03 | Per-table combination ceiling bounded by deploy-time env var (MAX_COMBINATION_VIEWS_PER_TABLE = 10); over-ceiling combinations fall back to full all-filters view; warning surfaced | Ceiling enforcement section + fallback algorithm; toast warning on first hit per table per tick |
</phase_requirements>

---

## Critical Question Resolutions

### Q1: Ownership / Sole-Trigger Semantics

**Current state (Phases 88/89 landed):** `AggregatedWidgetRenderer` Effect 1 in
`WidgetRenderer.tsx` (lines 497-609) is still the sole materialize trigger. It reads
`filterVersion` + `spatialFilterVersion` as deps, calls `markMaterializing` →
`materializeFilter` → `setView` on `filterViewStore`.

**Phase 90 end state:** The orchestrator owns combination-view materializations. Effect 1
in `AggregatedWidgetRenderer` continues to own the LEGACY per-table filter view path
until Phase 91 retires it. In Phase 90 both paths run; the orchestrator fires combination
views (with `_c<hash8>` suffix), Effect 1 fires legacy views (no suffix). No renderer
reads the combination views yet — read path swap is Phase 91/92.

**Phase 91 action (planning note):** Rewrite Effect 1 in `AggregatedWidgetRenderer` to
check `filterCombinationStore.vizToHash["w:<widgetId>"]` and skip its own POST (the
orchestrator already handled it). The static grep assertion on sole-trigger then shifts
to allow only the orchestrator + the legacy Effect 1 path until Phase 91 retires Effect 1
entirely.

### Q2: Transition Strategy — RECOMMENDED: Option (a) Dual-trigger

**Why Option (a) is safe and lowest-risk:**

Combination views produced by the orchestrator have names of the form
`_kbi_filt_u<user>_d<dashId>_t<tableId>_s<session>_c<hash8>`. Legacy views have names
of the form `_kbi_filt_u<user>_d<dashId>_t<tableId>_s<session>` (no `_c` suffix). These
are DISTINCT Kinetica view names. There is no collision, no split-brain, no race.

Renderers in Phase 90 still read from `filterViewStore.views[tableId]` (the legacy path).
The combination views sit in `filterCombinationStore.registry` waiting for Phase 91 to
wire the read path. Dashboard cleanup (App.tsx + DashboardsPage.tsx) already DROPs
combination views via the 9th-store snapshot-then-DROP loop (Phase 89 wired this).

**Why Option (b) — orchestrator also maintains legacy views — is WRONG:**
Would require the orchestrator to know which widgets are "chart/records type" (to
replicate Effect 1's table path), and would create a dual-write to both
`filterViewStore.views[tableId]` AND `filterCombinationStore.registry`. That is
Anti-Pattern 3 from ARCHITECTURE.md.

**Why Option (c) — feature flag / no-op until Phase 91 — is wasteful:**
Phase 90's purpose is to build and test the orchestrator in isolation. A no-op adds
no value. The dual-trigger approach lets Phase 90 be fully exercised and tested.

**Default-case name question (COMBO-V118-04):**
With default accept-all `FilterSelectionConfig`, every widget on table T resolves to the
SAME combination: ALL active filters. The orchestrator fires ONE combination view per
table, with name `_kbi_filt_u..._t<tableId>_s<session>_c<hash8>`. The LEGACY view (no
`_c` suffix) remains the one actually read by renderers in Phase 90. In Phase 91, when
renderers switch to reading from `filterCombinationStore`, the combination view
(with `_c<hash8>`) becomes the live read target. The legacy view becomes orphaned and
is cleaned up at next dashboard switch. This is the designed transition path.

### Q3: Diff/Dispatch Algorithm

```
On filterVersion tick (300ms debounced):

// Step 1: Enumerate all trigger widgets
widgets.filter(w => isTriggerType(w.type))  // exclude map, info-card, legend, datafilter, timeline, numericline, calendar

// Step 2: Compute (tableId, filterSelection) per widget
// tableId = w.config.tableId as number | undefined
// filterSelection = w.config.filterSelection as FilterSelectionConfig | undefined
// Skip widgets with no tableId (dv-bound widgets — Phase 94 scope)

// Step 3: Resolve filter sets
allFilters = useFilterStore.getState().filters[tableId] ?? []
resolved = resolveFilterSet(filterSelection, allFilters)
hash = stableComboHash("table", tableId, resolved)

// Step 4: Group by tableId, count unique non-NOFILTER hashes
// Build: Map<tableId, Map<hash, { widgets: widgetId[], resolved: ActiveFilter[] }>>

// Step 5: Per-table ceiling enforcement
for each (tableId, hashMap) in grouped:
  if hashMap.size > MAX_COMBINATION_VIEWS_PER_TABLE:
    // Deterministic fallback: keep the top-N hashes by refCount DESC (existing),
    // then by lowest widget id (tie-break). Excess hashes → fallbackHash.
    // fallbackHash = stableComboHash("table", tableId, allFilters[tableId] ?? [])
    //   (the full all-filters view = the combination every widget would get with
    //   accept-all config)
    // Surface a SINGLE toast warning once per table per orchestrator tick (not per widget).

// Step 6: Compute new desired registry = { hash → {tableId, resolved} }

// Step 7: Diff vs current registry
const current = useFilterCombinationStore.getState().registry
const desired = (computed above)

// Step 8a: Acquire NEW combos
for each (hash, {tableId, resolved}) in desired:
  if hash ends with ":NOFILTER": continue  // no view needed
  if hash in current:
    // REUSE: acquire if this widget's old hash differs
    updateVizHash("w:<widgetId>", hash)
    acquire(hash)  // refCount += 1 only if newly binding
  else:
    // NEW: fire POST
    markMaterializing(hash, dashboardId, "table", tableId)
    comboShort = comboShortHash(hash)
    POST /api/filter/materialize { dashboardId, tableId, filters: resolved, combinationKey: hash }
    -> setEntry(hash, { viewName, expiresAt, materializing: false, refCount: ..., ... })

// Step 8b: Release GONE combos (hashes in current but NOT in desired)
for each hash in current:
  if hash not in desired:
    release(hash)  // refCount -= 1; DROP-at-0 fires via dropCombinationView (caller's job)
    if releasedToZero: dropCombinationView({ dashboardId, viewName: current[hash].viewName }).catch(()=>{})

// Step 9: Update vizToHash for all widgets
for each widget → hash mapping: setVizHash("w:<widgetId>", hash or undefined for NOFILTER)
```

**Race prevention:** `markMaterializing(hash, ...)` is called synchronously before any
`await`. A second orchestrator tick arriving while the first is in-flight sees
`registry[hash].materializing === true` and skips the POST. This is the same pattern
as `AggregatedWidgetRenderer` Effect 1.

**Debounce:** Same 300ms `setTimeout` + `clearTimeout` on cleanup. Same primitive
`filterVersion` dep as Effect 1 — exactly one debounce tick per `filterVersion` advance.
Do NOT add a separate `combinationVersion` to the dep array — that would cause the
orchestrator to re-fire on its own store mutations (infinite loop).

**Idempotency:** `markMaterializing` guards against duplicate POSTs for the same hash.
`materializeFilter`'s `inFlightMaterialize` cache deduplicates at the network layer
(keyed by `${dashboardId}:t${tableId}` today — BUT this key must be changed for
combination calls, see CLIENT.TS MIGRATION below).

### Q4: Ceiling Enforcement + Fallback

**Ceiling value:** `MAX_COMBINATION_VIEWS_PER_TABLE = 10` is a named constant exported
from `filterCombinationStore.ts` (Phase 89 defined it). The STATE.md says "deploy-time
ENV VAR" but REQUIREMENTS.md says "env var (default ~10)". The Phase 89 SUMMARY
confirms the current implementation is a constant, NOT an env var. **PLANNER DECISION
NEEDED:** the REQUIREMENTS.md spec says env var; Phase 89 implemented a hardcoded
constant. Phase 90 should read from the constant and note this as a pending
COMBO-V118-03 gap — an env-var mechanism is not implemented yet. The ceiling enforcement
is still useful with the constant.

**Fallback algorithm (deterministic):**
When `uniqueHashes.size > MAX_COMBINATION_VIEWS_PER_TABLE` for a table:
1. Sort existing hashes by `registry[hash].refCount DESC` (shared views first).
2. Take the top `MAX_COMBINATION_VIEWS_PER_TABLE - 1` hashes.
3. One slot is reserved for the fallback hash.
4. `fallbackHash = stableComboHash("table", tableId, allFilters[tableId] ?? [])` — the
   all-filters view. This is a real hash, materializes a real view (same filters as
   today's legacy path), and all over-ceiling widgets bind to it.
5. Fire a single `useToastStore.getState().showToast(...)` with kind `"info"` (or
   `"error"` — PLANNER DECISION: the toast kind union is `"permission" | "info" | "error"`
   per Phase 34 lock; recommend `"info"` since it is non-critical).

**Warning surface:** One toast per table per orchestrator tick that hits the ceiling.
No per-widget indicator (that is Phase 95's on-widget badge, separate scope).

### Q5: Mount Point + Lifecycle

**Mount site:** `DashboardsPage.tsx` `DashboardOpen` body, immediately after line 428
where `useDynamicViewMaterializeChain` is called and after line 434 where
`useMapOnlySpatialMaterialize` is called. Same single-instance-per-open-dashboard
lifecycle as those two hooks.

**Signature:**
```typescript
export function useCombinationOrchestrator(
  dashboardId: number,
  widgets: WidgetDto[],
): void
```

`widgets` comes from `DashboardOpen`'s local state (synced from `widgetsQuery.data` at
line 481 of `DashboardsPage.tsx`). `filterVersion` is read via a store subscription
inside the hook (not passed as a prop) — same pattern as `useDynamicViewMaterializeChain`
which reads `matVersionKey` internally.

**Teardown:** Unmount cleanup aborts all in-flight materialize calls (AbortController
Map pattern from `useDynamicViewMaterializeChain`). Phase 89 already wired the cleanup
store reset at both App.tsx and DashboardsPage.tsx — the hook does NOT need to call
`reset()` directly; cleanup is owned by those two sites.

### Q6: Sole-Materialize-Trigger Static Assertion Evolution

**Today (Phase 89 complete):** `AggregatedWidgetRenderer` is the sole caller of
`materializeFilter` and `dropFilterView` within `components/charts/`. The static grep:
```
grep -r "materializeFilter\|dropFilterView" packages/web/src/components/charts/
```
finds only `WidgetRenderer.tsx` (authorized). All other chart renderers are clean.

**Phase 90:** The orchestrator lives in `packages/web/src/hooks/` (NOT in
`components/charts/`). It calls `materializeFilter` and `dropCombinationView`. The
existing grep over `components/charts/` remains valid: it still finds only
`WidgetRenderer.tsx`. The orchestrator is an ADDITIONAL authorized call site but in a
different directory, so no grep change is needed in Phase 90.

**Phase 91:** When `AggregatedWidgetRenderer` Effect 1 is rewritten to stop calling
`materializeFilter` directly, the grep over `components/charts/` will find NOTHING (or
only the dv-filter legacy path if that survives). A new grep over `hooks/` will confirm
only `useCombinationOrchestrator.ts` is the call site. The Phase 91 plan should add
this second grep as a gate.

**What the spec file should assert in Phase 90:**
```typescript
// In useCombinationOrchestrator.spec.ts
// Static assertion: verify the hook is the only orchestrator (by testing behavior,
// not by grep — grep is a CI gate).
// Verify: N unique combinations → N POSTs (not N*widgets POSTs).
// Verify: markMaterializing called before await (dedup guard).
```

---

## Template: useDynamicViewMaterializeChain Mapping

| DV Chain Element | Combination Orchestrator Equivalent |
|---|---|
| `dynamicViews` list state | `widgets` (prop, no async fetch needed) |
| `dynamicViewVersion` subscription | N/A — widgets come in as a prop |
| `matVersionKey` primitive string selector | `filterVersionKey = useFilterStore(s => s.filterVersion)` (already a primitive integer) |
| `cascadeControllersRef: Map<dvId, AbortController>` | `materializeControllersRef: Map<hash, AbortController>` |
| `lastSeenMatVerRef: Map<dvId, number>` | Not needed — hash-based diff IS the change detection |
| `fireCascade(dv, force)` | `materializeCombo(hash, tableId, resolved, dashboardId)` |
| cold-start no_filter fast-path | NOFILTER_SENTINEL check: skip POST, skip `markMaterializing` |
| `retry(dvId)` callback | Not needed in Phase 90 (no renderer error state yet) |
| `matVersionKey` dep in cascade effect | `filterVersion` integer dep |
| `dynamicViews` dep in cascade effect | `widgets` prop dep (useMemo stable key) |

**Key file:line:** `packages/web/src/hooks/useDynamicViewMaterializeChain.ts:52`

---

## Standard Stack (All Existing — No New Deps)

| Import | Source | Purpose |
|---|---|---|
| `useFilterStore` | `../store/filterStore` | Read `filterVersion` + `filters[tableId]` |
| `useFilterCombinationStore` | `../store/filterCombinationStore` | Read registry; call `markMaterializing`, `setEntry`, `setVizHash`, `acquire`, `release`, `clearEntry` |
| `useAuthStore` | `../store/auth` | Read `username` (needed for view name prediction, mirrors dv chain) |
| `useToastStore` | `../store/toast` | Ceiling warning toast |
| `resolveFilterSet` | `../lib/resolveFilterSet` | Per-widget filter resolution (Phase 88) |
| `stableComboHash`, `comboShortHash`, `NOFILTER_SENTINEL` | `../lib/stableComboHash` | Hash computation (Phase 88) |
| `materializeFilter`, `dropCombinationView`, `WidgetDto` | `../api/client` | POST + DROP + widget type |
| `MAX_COMBINATION_VIEWS_PER_TABLE` | `../store/filterCombinationStore` | Ceiling constant |
| `FilterSelectionConfig` | `../types/filterSelection` | Config type for defaulting |
| `useEffect`, `useRef`, `useMemo` | React | Standard hooks |

---

## Client.ts Migration Required (Phase 90 Task)

`materializeFilter`'s `inFlightMaterialize` cache is currently keyed by
`${dashboardId}:t${tableId}`. For combination calls, multiple different combinations for
the same `tableId` must NOT collapse into the same cache bucket. The key must become
`${dashboardId}:c${comboShortHash(hash)}` for orchestrator calls, or the
`MaterializeFilterArgs` must gain a `combinationKey` field that changes the cache key
branch.

**Recommended approach:** Add `combinationKey?: string` to `MaterializeFilterArgs`.
When present, cache key = `${dashboardId}:c${comboShortHash(combinationKey)}`.
When absent = existing behavior (`t${tableId}` or `dv${dynamicViewId}`). This is
purely additive. The server already accepts `combinationKey` (Phase 89 wired it).

**Files to modify:**
- `packages/web/src/api/client.ts` — add `combinationKey?` to `MaterializeFilterArgs`;
  add cache key branch. Lines 813-914.

---

## Architecture Patterns

### Recommended Project Structure for New File

```
packages/web/src/
├── hooks/
│   ├── useCombinationOrchestrator.ts        NEW — Phase 90
│   ├── useCombinationOrchestrator.spec.ts   NEW — Phase 90
│   ├── useDynamicViewMaterializeChain.ts    existing template
│   └── ...
```

### Pattern: AbortController Per Hash (not per widget)

```typescript
const materializeControllersRef = useRef<Map<string, AbortController>>(new Map());

// Before firing POST for hash:
materializeControllersRef.current.get(hash)?.abort();
const ctrl = new AbortController();
materializeControllersRef.current.set(hash, ctrl);

// Unmount cleanup:
useEffect(() => () => {
  materializeControllersRef.current.forEach(c => c.abort());
  materializeControllersRef.current.clear();
}, []);
```

### Pattern: filterVersion Dep (not combinationVersion)

```typescript
const filterVersion = useFilterStore((s) => s.filterVersion);

useEffect(() => {
  // ... debounced orchestration ...
  const timer = setTimeout(async () => { ... }, 300);
  return () => clearTimeout(timer);
}, [filterVersion, dashboardId, widgetsKey]);
// NOTE: widgetsKey is a primitive string derived from widgets (see below)
// NOTE: combinationVersion is NOT in deps — that would loop
```

### Pattern: Stable widgetsKey for Effect Dep

```typescript
const widgetsKey = useMemo(
  () => widgets
    .filter(w => isTriggerType(w.type) && (w.config.tableId as number | undefined) !== undefined)
    .map(w => `${w.id}:${w.config.tableId}`)
    .sort()
    .join(","),
  [widgets],
);
// Use widgetsKey (string) not widgets[] in dep array — PITFALL S-02 compliance
```

### Pattern: Ceiling Enforcement Loop

```typescript
// Group unique hashes by tableId
const byTable = new Map<number, Map<string, { resolved: ActiveFilter[] }>>();

// Per-table ceiling check
for (const [tableId, hashMap] of byTable) {
  if (hashMap.size <= MAX_COMBINATION_VIEWS_PER_TABLE) continue;
  // Deterministic: sort by existing refCount DESC, keep top N-1
  const sorted = [...hashMap.entries()].sort(([hA], [hB]) => {
    const rcA = store.registry[hA]?.refCount ?? 0;
    const rcB = store.registry[hB]?.refCount ?? 0;
    return rcB - rcA;
  });
  const keep = new Set(sorted.slice(0, MAX_COMBINATION_VIEWS_PER_TABLE - 1).map(([h]) => h));
  const allFilters = useFilterStore.getState().filters[tableId] ?? [];
  const fallbackHash = stableComboHash("table", tableId, allFilters);
  // Remap over-ceiling widgets to fallbackHash
  for (const [hash] of sorted.slice(MAX_COMBINATION_VIEWS_PER_TABLE - 1)) {
    if (!keep.has(hash)) hashMap.delete(hash);
    // affected widgets: remap to fallbackHash
  }
  hashMap.set(fallbackHash, { resolved: allFilters });
  useToastStore.getState().showToast(
    `Filter combinations for table ${tableId} exceed limit (${MAX_COMBINATION_VIEWS_PER_TABLE}). ` +
    `Some widgets fall back to the full filter view.`,
    "info",
  );
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---|---|---|
| Dedup key for filter arrays | Custom sort/join logic | `stableComboHash` (Phase 88 — 13 specs green) |
| 8-char view name suffix | Custom hash | `comboShortHash` (Phase 88, djb2, byte-identical to server) |
| Filter resolution (accept-all default) | Custom intersection | `resolveFilterSet` (Phase 88 — 10 specs green) |
| View drop with direct name | Custom DELETE fetch | `dropCombinationView` (Phase 89 — `client.ts:1016`) |
| Store ref-count management | Manual registry writes | `acquire`, `release`, `markMaterializing`, `setEntry`, `clearEntry` (Phase 89) |
| In-flight dedup for materialize | Manual Promise cache | `inFlightMaterialize` in `client.ts` (already handles it, but cache key must be updated) |

---

## Common Pitfalls

### Pitfall 1: combinationVersion as Effect dep — infinite loop
The orchestrator must NOT include `combinationVersion` in its Effect dep array. `setEntry`
bumps `combinationVersion`. If `combinationVersion` is a dep, every successful materialize
triggers the Effect to re-fire, which re-diffs, sees nothing new (already in registry), but
still re-creates the timeout. On dashboards with many widgets this creates a tight re-render
loop.
**Prevention:** Only `filterVersion` (from filterStore) + `dashboardId` + `widgetsKey` in deps.

### Pitfall 2: inFlightMaterialize cache key collision
The existing cache key `${dashboardId}:t${tableId}` collapses ALL combination calls for
the same table into one in-flight promise. If the orchestrator fires for combo `A` and
then combo `B` (different hash, same tableId), `B` joins `A`'s in-flight promise and gets
`A`'s view name. Phase 90 MUST add `combinationKey` to `MaterializeFilterArgs` and update
the cache key.
**Prevention:** `${dashboardId}:c${comboShortHash(combinationKey)}` as the cache key branch.

### Pitfall 3: Dropping a view still referenced by another hash
When the orchestrator releases a hash and fires `dropCombinationView`, it must check that
`release` actually cleared the entry (returned to 0). The store's `release` action does
`clearEntry` only when `refCount <= 0`. If two orchestrator ticks race (rapid filter
changes), a hash may have been re-acquired before the DROP fires.
**Prevention:** Only call `dropCombinationView` when `release` transitions the refCount
to 0 — check `!useFilterCombinationStore.getState().registry[hash]` after `release(hash)`.

### Pitfall 4: markMaterializing called for NOFILTER hashes
NOFILTER hashes (ending with `:NOFILTER`) must NEVER be passed to `markMaterializing` or
`setEntry`. The store contract explicitly forbids NOFILTER entries in registry.
**Prevention:** Guard every store write with `if (hash.includes(":NOFILTER")) continue`.

### Pitfall 5: widgets prop is an array reference — unstable dep
`widgets` is a local state array in `DashboardOpen`. A naive `[filterVersion, widgets]`
dep would re-fire the Effect on every render (array reference changes even when content
is unchanged).
**Prevention:** Derive `widgetsKey` (primitive string, useMemo) from the trigger-type
widget subset. Use `widgetsKey` in the dep array, not `widgets`.

### Pitfall 6: NON_TRIGGER_TYPES set must match WidgetRenderer.tsx
`useCombinationOrchestrator` must enumerate only the same widget types that
`AggregatedWidgetRenderer` handles. Non-trigger types (map, info-card, legend, datafilter,
timeline, numericline, calendar, radio group) must be excluded. They have no `tableId`
and no filter-scope config in Phase 90.
**Prevention:** Copy the `NON_TRIGGER_TYPES` constant from
`useMapOnlySpatialMaterialize.ts:43` and keep in sync.

---

## Existing Test Files to Extend

| File | What to Add |
|---|---|
| `packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts` | No changes needed — template reference only |
| `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` | CREATE: full spec mirroring `useDynamicViewMaterializeChain.spec.ts` structure (see spec plan below) |
| `packages/web/src/store/filterCombinationStore.spec.ts` | No changes needed (28 specs already green) |
| `packages/web/src/api/client.ts` | The `combinationKey?` addition to `MaterializeFilterArgs` should be covered by existing `materializeFilter` type-level tests + new unit test for cache key branching |

### Spec File Plan for useCombinationOrchestrator.spec.ts

Tests needed (group by scenario):

1. **No trigger widgets** — empty widgets array → zero POSTs fired
2. **Single widget, no active filters** — NOFILTER hash → zero POSTs, no `markMaterializing`
3. **Single widget, one active filter** — fires one POST with correct `combinationKey`; `markMaterializing` called before await; `setEntry` called after resolve
4. **Two widgets, same hash** — fires ONE POST (not two); `acquire` called twice (once per widget bind)
5. **Two widgets, different hashes** — fires TWO POSTs (different combinations); each gets its own AbortController
6. **Hash goes away on tick 2** — widget removed → `release` called; `dropCombinationView` fired when refCount reaches 0
7. **markMaterializing race guard** — second tick fires while first POST in-flight → same hash → second tick skips POST (registry shows `materializing: true`)
8. **Ceiling exceeded** — N+1 unique hashes for one table → only MAX_COMBINATION_VIEWS_PER_TABLE unique views materialized; over-ceiling widgets get fallback hash; toast shown
9. **NOFILTER sentinel guard** — hash ending in `:NOFILTER` → no `markMaterializing`, no POST, `setVizHash` called with `undefined`
10. **filterVersion dep isolation** — unrelated store mutation that does NOT advance `filterVersion` → orchestrator does NOT re-fire
11. **Unmount abort** — unmount during in-flight POST → AbortController aborted; no `setEntry` called after unmount

---

## Sole-Trigger Verification Commands

```bash
# Phase 90 gate: orchestrator in hooks/, not in components/charts/ — existing grep still valid
grep -r "materializeFilter\|dropFilterView" packages/web/src/components/charts/
# Expected: WidgetRenderer.tsx only (unchanged in Phase 90)

# Additional new check: confirm the new hook is the orchestrator
grep -r "materializeFilter" packages/web/src/hooks/
# Expected: useCombinationOrchestrator.ts only
```

---

## File:Line Integration Points

| What | File | Line (approx) | Action |
|---|---|---|---|
| Hook mount site | `DashboardsPage.tsx` | 434 (after `useMapOnlySpatialMaterialize`) | Add `useCombinationOrchestrator(dashboard.id, widgets)` |
| `MaterializeFilterArgs` | `client.ts` | 813 | Add `combinationKey?: string` field |
| `inFlightMaterialize` cache key | `client.ts` | 869-871 | Add `combinationKey` branch |
| `NON_TRIGGER_TYPES` source | `useMapOnlySpatialMaterialize.ts` | 43 | Copy pattern (not import — avoid circular dep risk) |
| `MAX_COMBINATION_VIEWS_PER_TABLE` import | `filterCombinationStore.ts` | 34 | Import in orchestrator |
| `acquire` / `release` actions | `filterCombinationStore.ts` | 66-67 | Both exported; use directly |
| `dropCombinationView` | `client.ts` | 1016 | Existing — import in orchestrator |

---

## Open Questions / Planner Decisions Required

1. **COMBO-V118-03 env-var gap:** REQUIREMENTS.md specifies a deploy-time env var for the
   ceiling. Phase 89 implemented a hardcoded constant. **Decision:** Does Phase 90 add the
   env-var plumbing (reading from env at boot, mirroring `DEFAULT_VIEW_TTL_MINUTES`), or
   does it use the constant and flag this as a gap for Phase 96 verification? Recommendation:
   use the constant; the env-var mechanism is Phase 94's server-side pattern to replicate.
   Flag as COMBO-V118-03 partial (ceiling enforced, env-var not yet wired).

2. **Toast kind for ceiling warning:** `"info"` vs `"error"`. The ceiling hit is not
   user-actionable from the toast; it is a designer/operator concern. Recommend `"info"`.

3. **Fallback hash when NO active filters at ceiling:** If the ceiling is hit but
   `allFilters[tableId] === []`, the fallback hash is a NOFILTER hash → no view. In that
   case, over-ceiling widgets should bind to `undefined` (raw FROM). Confirm this edge case
   is handled gracefully (it is — NOFILTER check already in algorithm).

4. **dv-bound widgets:** Phase 90 scope is TABLE-BOUND widgets only (`widget.config.tableId`
   defined, `widget.config.dynamicViewId` undefined). dv-bound combination orchestration is
   Phase 94. The orchestrator must skip widgets where `tableId === undefined`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (packages/web) |
| Config file | `packages/web/vite.config.ts` (vitest block) |
| Quick run command | `cd packages/web && npx vitest run src/hooks/useCombinationOrchestrator.spec.ts` |
| Full suite command | `cd packages/web && npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| COMBO-V118-01 | N widgets same hash → 1 POST | unit | `npx vitest run src/hooks/useCombinationOrchestrator.spec.ts` |
| COMBO-V118-01 | markMaterializing before await (dedup) | unit | same |
| COMBO-V118-01 | hash gone → release → dropCombinationView | unit | same |
| COMBO-V118-03 | N+1 hashes → ceiling cap + fallback | unit | same |
| COMBO-V118-03 | toast warning on ceiling hit | unit | same |

### Sampling Rate
- **Per task commit:** `cd packages/web && npx vitest run src/hooks/useCombinationOrchestrator.spec.ts`
- **Per wave merge:** `cd packages/web && npx vitest run`
- **Phase gate:** Full suite green + `tsc --noEmit` clean + theme-guard green

### Wave 0 Gaps
- [ ] `packages/web/src/hooks/useCombinationOrchestrator.ts` — the hook itself
- [ ] `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` — 11 spec scenarios above

---

## Sources

### Primary (HIGH confidence — live codebase)
- `packages/web/src/hooks/useDynamicViewMaterializeChain.ts` — template; full file read
- `packages/web/src/hooks/useMapOnlySpatialMaterialize.ts` — NON_TRIGGER_TYPES pattern; lines 1-60
- `packages/web/src/components/charts/WidgetRenderer.tsx` — Effect 1 (lines 497-609); AggregatedWidgetRenderer selectors (lines 375-495)
- `packages/web/src/store/filterCombinationStore.ts` — full file (Phase 89); API contract
- `packages/web/src/api/client.ts` — `MaterializeFilterArgs` (lines 813-835); `materializeFilter` cache key (lines 863-914); `dropCombinationView` (lines 1016+)
- `packages/web/src/components/DashboardsPage.tsx` — mount site (lines 428-441); widget enumeration
- `.planning/phases/88-foundation-pure-logic-types/88-01-SUMMARY.md` — `resolveFilterSet`, `stableComboHash`, `NOFILTER_SENTINEL` exact signatures
- `.planning/phases/89-store-server-foundation/89-01-SUMMARY.md` — store API: `acquire`, `release`, `markMaterializing`, `MAX_COMBINATION_VIEWS_PER_TABLE`
- `.planning/phases/89-store-server-foundation/89-02-SUMMARY.md` — server `combinationKey` param + DELETE `?viewName=` branch
- `.planning/research/ARCHITECTURE.md` — anti-patterns, integration points
- `.planning/research/PITFALLS.md` — Pitfall 6 (sole-trigger), Pitfall 7 (fan-out), Pitfall 1 (ceiling)
- `.planning/research/SUMMARY.md` — orchestrator as most consequential design decision
- `.planning/REQUIREMENTS.md` — COMBO-V118-01, COMBO-V118-03

---

## Metadata

**Confidence breakdown:**
- Transition strategy: HIGH — name collision analysis grounded in live server code (`buildFilterViewName` output shape confirmed in Phase 89 SUMMARY)
- Diff/dispatch algorithm: HIGH — derived from store API (all actions verified in 28 specs), `useDynamicViewMaterializeChain` template, and Effect 1 pattern
- Ceiling/fallback: HIGH — `MAX_COMBINATION_VIEWS_PER_TABLE` confirmed at value 10 in `filterCombinationStore.ts:34`; deterministic sort algorithm is original but grounded in existing refCount semantics
- client.ts cache key gap: HIGH — confirmed by direct grep; `combinationKey` NOT yet in `MaterializeFilterArgs`
- Mount point: HIGH — exact line confirmed in DashboardsPage.tsx

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable codebase — no external deps)
