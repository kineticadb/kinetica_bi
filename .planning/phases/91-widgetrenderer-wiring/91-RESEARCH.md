# Phase 91: WidgetRenderer Wiring — Research

**Researched:** 2026-06-27
**Domain:** Frontend read-path flip — AggregatedWidgetRenderer, TimelineRenderer, NumericLineRenderer
**Confidence:** HIGH — all findings verified from direct code inspection of the actual source files

---

## Summary

Phase 91 is a surgical read-path flip across three renderer files. The orchestrator (Phase 90) already materializes combination views and writes `filterCombinationStore.vizToHash["w:<widgetId>"]` + `registry[hash]`. The renderers still read from the legacy `filterViewStore.views[tableId]` path. This phase rewires the three read paths so each renderer resolves its own combo-hash, looks up the entry, and uses that entry's `viewName` / `materializing` / `expiresAt` in place of the legacy selectors.

The dv-bound path in `AggregatedWidgetRenderer` (`dynamicViewId !== undefined` branch of Effect 1 + all dv selectors) stays on the old stores until Phase 94. The table path of Effect 1 — the table-filter materialize trigger at `WidgetRenderer.tsx:543-599` — is **REMOVED** entirely because the orchestrator in Phase 90 now owns it. The dv-filter materialize branch at `WidgetRenderer.tsx:517-542` stays unchanged.

`TimelineRenderer` and `NumericLineRenderer` have no Effect 1 (they are read-only consumers of the filter view), so the change there is selector-only: three selectors replaced, one expiry-side-effect call updated.

Byte-identical behavior on default dashboards (COMBO-V118-04) is guaranteed by construction: with no `filterSelection` config, all widgets on a table resolve the same hash for a given active-filter set, so a single combination view is shared, and its `viewName` is the data source — same data, different view name suffix (`_c<hash8>` vs `_kbi_filt_…`). The planner must pick the correctness test that proves this.

**Primary recommendation:** Execute in one wave: selector replacements in all three files + Effect 1 table-path removal in `AggregatedWidgetRenderer` + static sole-trigger assertion update. Do not split across waves — a mid-phase state where selectors are swapped but Effect 1 still writes to `filterViewStore` is a split-brain bug (Anti-Pattern 3 from ARCHITECTURE.md).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| READ-V118-01 | Standard chart widgets bind to their combination's view via the FROM-swap read path | Selector swaps in AggregatedWidgetRenderer (lines 406-428), TimelineRenderer (lines 203-207), NumericLineRenderer (lines 187-191); Effect 1 table-path removal |
| COMBO-V118-04 | Default accept-all config → byte-identical to v1.17 | Proven by construction: accept-all resolves to same hash for all widgets on a table; correctness test in spec |

---

## Exact Read-Path Today (pre-Phase 91)

### AggregatedWidgetRenderer — `WidgetRenderer.tsx`

**Selectors (lines 406-428):**

```typescript
// line 408-410
const viewName = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.viewName : undefined
);
// line 412-414
const expiresAt = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.expiresAt ?? 0 : 0
);
// line 420-422
const materializing = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.materializing ?? false : false
);
// line 428
const clearMaterializingVersion = useFilterViewStore((s) => s.clearMaterializingVersion);
```

**Effect 1 (lines 506-609):**

The effect has two branches gated by `dynamicViewId !== undefined`:

- **dv branch (lines 517-542):** fires dv-filter materialize via `materializeFilter({ dashboardId, dynamicViewId, filters: dvFilters })` → `setDvView` / `clearDvView`. STAYS UNCHANGED through Phase 94.
- **table branch (lines 543-599):** fires table-filter materialize via `materializeFilter({ dashboardId, tableId, filters: tableFilters, spatialFilters?, spatialTarget? })` → `filterViewStore.setView`. **REMOVED in Phase 91.** The orchestrator (`useCombinationOrchestrator`) already does this work for table-bound widgets.
- Abort guard: `materializeAbortRef.current?.abort()` + `new AbortController()` pattern is in both branches.

**Effect 1 dep array (line 609):**
```
[sql, filterVersion, dashboardId, tableId, spatialFilterVersion, dvStatus, dynamicViewId]
```
After removal of the table branch, the deps are reduced; only the dv branch remains with its deps (`sql, filterVersion, dashboardId, dynamicViewId, dvStatus`). `spatialFilterVersion` and `tableId` are only needed for the table branch — can be removed from the dep array when the table branch goes.

**Effect 2 (lines 632-810):**

- Uses `viewName` / `expiresAt` / `materializing` / `clearMaterializingVersion` from the selectors above.
- `effectiveViewName` at line 683-698: the `dynamicViewId !== undefined` branch uses `dvFilterViewName || dvViewName`; the `else` branch uses `viewName`. After the swap, the `else` branch uses `comboEntry?.viewName`.
- The LIFE-V13-01 proactive expiry block (lines 668-677) references `useFilterViewStore.getState().clearView(tableId)` — **this call must be replaced** with an equivalent combination-store operation (or removed, since the orchestrator handles expiry). This is the one place inside Effect 2 that writes to a store; post-swap it must either call `useFilterCombinationStore.getState().clearEntry(comboHash)` or simply return and let the orchestrator re-materialize on next tick.
- The LIFE-V13-02 reactive retry block (lines 720-771) calls `useFilterViewStore.getState().clearView(tableId)` and `materializeFilter` directly for the non-dv path. **This retry path must be re-evaluated**: in Phase 91 the orchestrator owns materialize, so the retry should instead call `useFilterCombinationStore.getState().clearEntry(comboHash)` to signal re-materialize on the next filterVersion tick, rather than calling `materializeFilter` inline. This is a RISK — the planner must decide whether the inline retry stays (now calling combination-store instead of filterViewStore) or is simplified to "clear entry + wait for orchestrator re-fire". The simpler path avoids a second route to `materializeFilter` inside WidgetRenderer.
- Effect 2 dep array (lines 799-810): `clearMaterializingVersion` is replaced by `combinationVersion`.

### TimelineRenderer — `TimelineRenderer.tsx`

**Selectors (lines 203-207):**
```typescript
// line 203
const fvViewName = useFilterViewStore((s) => s.views[tableId]?.viewName);
// line 205
const fvExpiresAt = useFilterViewStore((s) => s.views[tableId]?.expiresAt ?? 0);
// line 207
const fvMaterializing = useFilterViewStore((s) => s.views[tableId]?.materializing ?? false);
```

**Usage in the fetch effect (lines 246-255):**
```typescript
const filterView = dynamicViewId === undefined ? fvViewName : undefined;
if (dynamicViewId === undefined) {
  if (fvMaterializing) return;  // suspend gate
  if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt) {
    useFilterViewStore.getState().clearView(tableId);  // <-- ALSO replaced
    return;
  }
}
```

**Fetch effect dep array (lines 402-403):**
```
fvViewName, fvExpiresAt, fvMaterializing,
```

**No Effect 1 in TimelineRenderer** — the `SOLE MATERIALIZE TRIGGER INVARIANT` comment (line 20-22) confirms this. No removal work needed beyond the selector swap.

### NumericLineRenderer — `NumericLineRenderer.tsx`

**Selectors (lines 187-191):**
```typescript
// line 187
const fvViewName = useFilterViewStore((s) => s.views[tableId]?.viewName);
// line 189
const fvExpiresAt = useFilterViewStore((s) => s.views[tableId]?.expiresAt ?? 0);
// line 191
const fvMaterializing = useFilterViewStore((s) => s.views[tableId]?.materializing ?? false);
```

**Usage pattern:** identical to TimelineRenderer — `dynamicViewId === undefined` guard, suspend gate on `fvMaterializing`, proactive expiry calling `useFilterViewStore.getState().clearView(tableId)`, dep array includes `fvViewName, fvExpiresAt, fvMaterializing`.

**No Effect 1** — confirmed by `SOLE MATERIALIZE TRIGGER INVARIANT` comment at lines 16-17. Selector-only change.

---

## The Exact Selector Swap

### New selectors for AggregatedWidgetRenderer (replace lines 406-428)

```typescript
// Phase 91: read from filterCombinationStore instead of filterViewStore.views[tableId]
// PITFALL S-02 lock: scope to s.vizToHash[vizKey] (one viz's primitive string), never s.registry whole.
// vizKey is stable across renders — widget.id never changes while the component is mounted.
const vizKey = `w:${widget.id}`;
const comboHash = useFilterCombinationStore((s) => s.vizToHash[vizKey]);
// comboEntry read imperatively inside effects to avoid object-selector re-render storm.
// The primitive comboHash string is the selector dep; entry fields are read at effect time.
// For Effect 2 suspend gate + proactive expiry we need reactive primitives:
const comboViewName = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.viewName ?? "") : "";
});
const comboMaterializing = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.materializing ?? false) : false;
});
const comboExpiresAt = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.expiresAt ?? 0) : 0;
});
// combinationVersion (primitive int) replaces clearMaterializingVersion as Effect 2 suspend-lift dep.
// setEntry, markMaterializing, clearEntry all bump it — covers both success and error cases.
const combinationVersion = useFilterCombinationStore((s) => s.combinationVersion);
```

**NOFILTER check:** `comboHash?.endsWith(":NOFILTER")` is safe because:
- `NOFILTER_SENTINEL = "NOFILTER"` (a literal, not `":NOFILTER"`)
- `stableComboHash` returns `"${sourceType}:${sourceId}:NOFILTER"` for empty filters — always ends in `:NOFILTER`
- Real hashes contain `|` chars in segments — they cannot end in `:NOFILTER`

When `comboHash` is `undefined` (orchestrator hasn't run yet on first tick) or ends with `:NOFILTER` (empty filter set): `comboViewName = ""`, `comboMaterializing = false`, `comboExpiresAt = 0` — renderer queries the base table unchanged. This is the NOFILTER → raw FROM rule.

**Alternative compact form** (avoids three chained lookups): each selector does the same `s.vizToHash[vizKey]` lookup. To avoid triple subscription, the planner may prefer a single `useFilterCombinationStore` call projecting to a `{ viewName, materializing, expiresAt }` tuple — but this returns a new object reference on every store write (PITFALL S-02). The safest approach is three primitive-string selectors OR a single selector projecting to a stable primitive string and reading entry fields imperatively in effects.

**Recommended pattern** (avoids the object-selector pitfall):
```typescript
// Single primitive key for Effect deps + proactive expiry.
// Concatenates the three fields that drive Effect 2 behavior into one string.
const comboKey = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  const e = h && !h.endsWith(":NOFILTER") ? s.registry[h] : undefined;
  return `${e?.viewName ?? ""}:${e?.expiresAt ?? 0}:${e?.materializing ? "1" : "0"}`;
});
// Then inside Effect 2: read entry imperatively via getState() for the actual values.
// Also keep combinationVersion for the suspend-gate lift.
```
This mirrors `viewsKey` / `comboViewsKey` in `MapChartRenderer` exactly.

The planner must lock one of these two forms.

### New selectors for TimelineRenderer + NumericLineRenderer (replace lines 203-207 and 187-191)

```typescript
// TimelineRenderer.tsx lines 203-207 (NumericLineRenderer.tsx lines 187-191 — identical pattern)
const vizKey = `w:${widget.id}`;
const fvViewName = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.viewName ?? "") : "";
});
const fvExpiresAt = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.expiresAt ?? 0) : 0;
});
const fvMaterializing = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.materializing ?? false) : false;
});
```

Keeping the same variable names (`fvViewName`, `fvExpiresAt`, `fvMaterializing`) minimizes downstream diff — the fetch effect body, usage logic, and dep array remain identical except for two lines:
1. `useFilterViewStore.getState().clearView(tableId)` in the proactive expiry block → replace with `useFilterCombinationStore.getState().clearEntry(comboHash)` (requires reading `comboHash` imperatively from `getState().vizToHash[vizKey]` at that point).
2. The import of `useFilterViewStore` is removed from these files only if no other selectors reference it. Both TimelineRenderer and NumericLineRenderer currently import `useFilterViewStore` only for these three selectors — confirm with grep before removing.

**Risk:** `widget.id` is not in scope at the top of `TimelineRenderer` / `NumericLineRenderer` in the same way as `AggregatedWidgetRenderer`. Confirm that `widget.id` is accessible in these components at hook call site (it is — both receive `widget` as a prop and access `cfg = widget.config ?? {}`; `widget.id` is available).

---

## What is REMOVED vs KEPT in Effect 1

### REMOVED — the table-filter materialize branch (lines 543-599 of WidgetRenderer.tsx)

This is the block:
```
// ── Table path (UNCHANGED) ──
if (tableId === undefined) return;
materializeAbortRef.current?.abort();
...
const shapes = useSpatialFilterStore.getState().shapes;
...
if (tableFilters.length === 0 && !hasShapesForThisTable) {
  dropFilterView({ dashboardId, tableId }).catch(() => {});
  useFilterViewStore.getState().clearView(tableId);
  return;
}
useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
try {
  const result = await materializeFilter(args, controller.signal);
  useFilterViewStore.getState().setView(tableId, result, dashboardId);
} catch (err) { ... clearMaterializing ... }
```

The entire table-path block is removed. The orchestrator owns this. After removal, the table-path variables that become dead — `tableFilters` (used only in Effect 1 table branch and the LIFE-V13-02 retry), `myTarget`, `targetsByTable`, `spatialFilterVersion`, `materializeAbortRef` (for the table path), `hasShapesForThisTable` — must be audited. Several are also used by the LIFE-V13-02 retry inline in Effect 2 (lines 720-771).

### KEPT — the dv-filter branch (lines 517-542 of WidgetRenderer.tsx)

```
if (dynamicViewId !== undefined) {
  if (dvStatus !== "materialized") return;
  materializeAbortRef.current?.abort();
  ...dvFilters materialize via materializeFilter({ dashboardId, dynamicViewId, filters: dvFilters })...
  return;
}
```

This branch and `materializeAbortRef` stay until Phase 94.

**Consequence for imports:** After Phase 91, `WidgetRenderer.tsx` still imports `materializeFilter` and `dropFilterView` — because the dv branch inside Effect 1 still calls both. The static sole-trigger assertion (`grep -r "materializeFilter|dropFilterView" packages/web/src/components/charts/`) STILL finds `WidgetRenderer.tsx`. That is expected and correct — the assertion concerns chart renderers calling materialize for TABLE-bound flows; the dv branch is an authorized call site. The assertion text must be updated: the authorized call sites are now `useCombinationOrchestrator.ts` (table combinations) + `WidgetRenderer.tsx` (dv-filter branch only). The CalendarRenderer / DataFilterRenderer / TimelineRenderer / NumericLineRenderer static tests remain unchanged (they already assert zero materializeFilter imports).

**DECISION the planner must lock:** What exactly does the static grep assertion test in `WidgetRenderer.spec.tsx` now assert? Options:
- A: "WidgetRenderer.tsx imports materializeFilter but only the dv branch calls it; CalendarRenderer/DataFilterRenderer/TimelineRenderer/NumericLineRenderer have zero" (same structure as today, just updated comments).
- B: Add a new static test that reads WidgetRenderer.tsx and asserts the table-branch calls `materializeFilter` zero times (i.e., the word `materializeFilter` does not appear in the table branch region) — harder to encode in a string test.

Option A is the minimum safe change.

### KEPT — Effect 2 LIFE-V13-02 reactive retry (lines 720-771 of WidgetRenderer.tsx)

The retry currently calls `materializeFilter` inline for the non-dv path. Post-swap, the non-dv path reads from `filterCombinationStore`. The retry should be changed to `clearEntry(comboHash)` to signal the orchestrator re-fire, not to call `materializeFilter` inline (which would violate the sole-trigger invariant for table-bound widgets). If inline retry is kept, it must go through the orchestrator — in practice this means: call `useFilterCombinationStore.getState().clearEntry(comboHash)` which will cause the orchestrator to re-materialize on its next tick (the orchestrator fires on `filterVersion` only, so clearing the entry alone does not immediately re-fire it). A simpler approach: bump `filterVersion` by one — but that pollutes the filter store for a recovery path. **Planner decision required:** simplest safe behavior for the view-not-found reactive retry in the new model is to `clearEntry(comboHash)` + do nothing (the orchestrator will re-materialize on the next filter change, or on the keep-alive touch). For Phase 91 correctness this is acceptable — the retry is a nice-to-have safety net, not required for COMBO-V118-04.

---

## NOFILTER → Raw FROM Rule

When a widget's resolved filter set is empty:
- `stableComboHash("table", tableId, [])` → `"table:<tableId>:NOFILTER"` (ends with `:NOFILTER`)
- The orchestrator does NOT create a view for NOFILTER hashes (store invariant: NOFILTER hashes are never stored in registry)
- `vizToHash["w:<id>"]` may be `undefined` (orchestrator has not yet run) OR set to the NOFILTER hash OR absent
- In all NOFILTER cases: `comboViewName = ""` → `fromSwap(sql, "")` returns original `sql` unchanged (same as `fromSwap(sql, undefined)`) — the query runs against the base table

Confirm `fromSwap` handles empty string correctly:
```bash
grep -n "fromSwap" packages/web/src/lib/fromSwap.ts | head -5
```
The `fromSwap(sql, undefined)` path already exists and is the zero-filter behavior — verify that `fromSwap(sql, "")` is equivalent (FILT-V13-03 zero-overhead lock). If `fromSwap` guards on `viewName` truthiness, an empty string is falsy — correct behavior. This must be verified.

For TimelineRenderer / NumericLineRenderer: they use `filterView ? filterView : effectiveTable` logic — `fvViewName = ""` is falsy, so `filterView = ""` → `queryTable = effectiveTable`. Correct.

---

## Suspend / First-Tick Fallback

**Scenario:** Dashboard mounts. `filterVersion` is 0. Orchestrator has not yet run its first tick (it's debounced 300ms). At this moment:
- `vizToHash["w:<id>"]` is `undefined`
- `comboHash` is `undefined`
- `comboMaterializing` is `false`
- `comboViewName` is `""`

Result: Effect 2 fires immediately with `effectiveViewName = undefined` → `fromSwap(sql, undefined)` → query runs against the base table. **This is the correct first-tick behavior** — the widget shows unfiltered data while the orchestrator runs its first materialize. As soon as the orchestrator completes and sets `registry[hash].viewName`, `combinationVersion` bumps, Effect 2 re-fires with the materialized view name.

**Scenario:** Active filters exist. Orchestrator fires, calls `markMaterializing(hash, ...)` (sets `materializing: true` in registry, bumps `combinationVersion`). `comboMaterializing` becomes `true`. Effect 2 suspend gate engages. The widget holds its prior data (or base-table data if no prior view). Orchestrator completes, calls `setEntry(hash, { viewName, ... })` (sets `materializing: false`, bumps `combinationVersion`). Effect 2 lifts, fires with the combo view name.

**Risk:** On the very first tick with active filters, there is a brief window where the base-table query fires before `markMaterializing` is set. This is the same behavior as today (Effect 1 was also debounced 300ms). The orchestrator's `markMaterializing` call is synchronous (before `await materializeFilter`) — once the orchestrator fires after 300ms, subsequent re-renders see `materializing: true` immediately. Phase 91 does not need to address this window beyond what Phase 90 already provides.

---

## dv-Bound Widgets — Branch That STAYS

For `dynamicViewId !== undefined`, ALL of the following stay on the legacy path through Phase 94:

1. `dvEntry` / `dvStatus` / `dvViewName` selectors from `useDynamicViewStore` — unchanged
2. `dvFilterEntry` / `dvFilterViewName` / `dvFilterMaterializing` selectors from `useFilterViewStore.dvViews` — unchanged
3. Effect 1 dv branch (lines 517-542) — unchanged
4. Effect 2 dv branch (`effectiveViewName = dvFilterViewName || dvViewName`) — unchanged
5. Effect 2 LIFE-V13-02 retry `if (dynamicViewId === undefined && ...)` guard — keeps scoping dv widgets out of the retry path

In TimelineRenderer and NumericLineRenderer, the dv-bound path is already gated by `dynamicViewId === undefined` before the filter-view logic, so the new combo selectors only apply when `dynamicViewId === undefined`. Confirm that this guard is in place in the fetch effect body (it is — `const filterView = dynamicViewId === undefined ? fvViewName : undefined`).

---

## COMBO-V118-04 Byte-Identical Correctness Test

**The invariant by construction:** With no `filterSelection` config on any widget:
- `resolveFilterSet(undefined, allFilters)` returns `allFilters.slice()` (all active filters)
- All widgets on the same table with the same active filter set → `stableComboHash("table", tableId, allFilters)` is identical for all
- Orchestrator creates ONE combo view for the table; all widget `vizToHash` entries map to the same hash
- One materialized view, all widgets read it → identical to v1.17 one-per-table model

**Automated test:** Add a new spec scenario to `WidgetRenderer.spec.tsx`:

```
describe("COMBO-V118-04 — default (accept-all) produces byte-identical read behavior", () => {
  it("widget with no filterSelection config reads from filterCombinationStore (not filterViewStore)", ...)
  it("two widgets on the same table with no filterSelection both map to the same hash (orchestrator dedup)", ...)
  it("widget with no active filters (NOFILTER) queries base table directly — no FROM-swap", ...)
})
```

Concretely: mock `useFilterCombinationStore` to have `vizToHash["w:42"] = "table:1:col|eq|\"foo\""` and `registry["table:1:col|eq|\"foo\""] = { viewName: "_kbi_combo_test_c1234abcd", materializing: false, ... }`. Assert that `runSql` is called with a FROM clause containing `_kbi_combo_test_c1234abcd`. Assert that `useFilterViewStore` mock is NOT consulted for the non-dv path.

---

## Existing Spec Files to Extend

| File | Extension |
|------|-----------|
| `WidgetRenderer.spec.tsx` | New `describe("COMBO-V118-04 …")` block; update static materializeFilter assertion comment to reflect dv-only scope; update `clearMaterializingVersion` mock reference to `combinationVersion` |
| `TimelineRenderer.spec.tsx` | Update Test 2b (filter-view FROM-swap) to pre-populate `filterCombinationStore` instead of `filterViewStore.views`; Update Test 2c (suspend gate) similarly; add Test N: "no filterSelection → base table on NOFILTER" |
| `NumericLineRenderer.spec.tsx` | Same three tests as TimelineRenderer, same mock updates |

The existing mock pattern in all three spec files mocks `useFilterViewStore` at module level. After the swap, the non-dv path no longer reads from `useFilterViewStore`. The mocks for `s.views[tableId]?.viewName` etc. become dead for table-bound tests. They should be changed to mock `useFilterCombinationStore` instead. Keep `useFilterViewStore` mock only for dv-path tests (dvViews selector).

---

## Sole-Trigger Static Assertion: What Changes

**Today:** `grep -r "materializeFilter|dropFilterView" packages/web/src/components/charts/` finds:
- `WidgetRenderer.tsx` — authorized (Effect 1: both table and dv branches)
- `CalendarRenderer.tsx` — zero (static test asserts)
- `DataFilterRenderer.tsx` — zero (static test asserts)
- `TimelineRenderer.tsx` — zero (sole-trigger invariant comment + static test in COLAPPLY spec block)
- `NumericLineRenderer.tsx` — zero (sole-trigger invariant comment + static test in COLAPPLY spec block)

**After Phase 91:** Same list, but `WidgetRenderer.tsx` now contains `materializeFilter` / `dropFilterView` ONLY in the dv branch (lines ~517-542). The static assertion comment in `WidgetRenderer.spec.tsx` must be updated to note: "materializeFilter now authorized only in the dv branch; table combination materialize is owned by useCombinationOrchestrator."

**No change to the grep command itself** — `grep -r "materializeFilter|dropFilterView" packages/web/src/components/charts/` still expects to find it only in `WidgetRenderer.tsx`. The test in `WidgetRenderer.spec.tsx` that verifies this pattern (the CalendarRenderer static assertion at line ~3107) remains unchanged. The key invariant update is: "WidgetRenderer imports materializeFilter for the DV path only; the table path is now the orchestrator's sole responsibility."

The STATE.md v1.18 invariant text: "sole-materialize-trigger — static grep: `grep -r "materializeFilter|dropFilterView" packages/web/src/components/charts/` finds only authorized call sites." After Phase 91 the authorized call sites in `components/charts/` are: WidgetRenderer.tsx (dv branch only). This is correct — no change to the grep command.

---

## Architecture Patterns

### Exact New Selector Pattern (locked per S-02)

The S-02 lock says: "all store selectors project to primitive strings." For AggregatedWidgetRenderer, the clean approach is:

```typescript
// Derive a single primitive string encoding all three reactive fields needed by Effect 2.
// Mirrors the viewsKey / comboViewsKey pattern in MapChartRenderer.
const vizKey = `w:${widget.id}`;
const comboKey = useFilterCombinationStore((s) => {
  const h = s.vizToHash[vizKey];
  const e = h && !h.endsWith(":NOFILTER") ? s.registry[h] : undefined;
  return `${e?.viewName ?? ""}:${e?.expiresAt ?? 0}:${e?.materializing ? "1" : "0"}`;
});
const combinationVersion = useFilterCombinationStore((s) => s.combinationVersion);
// Then INSIDE effects, read the entry imperatively:
// const h = useFilterCombinationStore.getState().vizToHash[vizKey];
// const entry = h && !h.endsWith(":NOFILTER") ? useFilterCombinationStore.getState().registry[h] : undefined;
```

`comboKey` drives re-renders (string equality via Zustand default shallow). `combinationVersion` is the explicit dep for the Effect 2 suspend-gate lift.

For TimelineRenderer and NumericLineRenderer, three separate primitive selectors (keeping `fvViewName`, `fvExpiresAt`, `fvMaterializing` as variable names) are the simplest change — fewest lines touched, existing dep arrays and fetch logic unchanged.

### The NOFILTER Sentinel Exact Value

From `stableComboHash.ts`:
```typescript
export const NOFILTER_SENTINEL = "NOFILTER";  // bare string, not ":NOFILTER"
```
But the full hash for empty filters is `"${sourceType}:${sourceId}:NOFILTER"` — ends with `":NOFILTER"`. The check `h.endsWith(":NOFILTER")` (note the colon) is the correct guard because a hash like `"table:5:NOFILTER"` ends with `:NOFILTER` while real hashes contain pipe chars in segments and never end that way. Import `NOFILTER_SENTINEL` from the lib and construct the check as `h.endsWith(`:${NOFILTER_SENTINEL}`)` — no hardcoding.

---

## Common Pitfalls Specific to Phase 91

### Pitfall A: Forgetting the `comboViewName === ""` case is the base-table path

When `comboHash` is undefined (first tick) or NOFILTER: `comboViewName = ""`. Effect 2 computes `effectiveViewName = ""`. Then:
- `fromSwap(sql, "")` — must be verified to return `sql` unchanged (falsy guard)
- If `fromSwap` does not guard on falsy, it may replace `FROM` with `FROM ` (empty-string table name) — broken query

**Verify:** `fromSwap(sql, "")` must equal `fromSwap(sql, undefined)`. Check `packages/web/src/lib/fromSwap.ts`.

### Pitfall B: Missing `comboHash` variable in imperative reads inside Effects

If the `comboHash` variable is only derived from the reactive selector (outside Effects), it may be stale inside an Effect callback (closure captures stale render-time value). For imperative reads inside Effects 1 and 2, always read from `useFilterCombinationStore.getState().vizToHash[vizKey]` — not from the closed-over `comboHash` constant. This mirrors the existing pattern where `shapes` is read imperatively inside Effect 1 to avoid stale closure.

### Pitfall C: Re-render storm from three separate vizToHash lookups

Three selectors each doing `s.vizToHash[vizKey]` → three subscriptions. If `vizToHash` changes for ANY vizKey (not just this widget's), all three fire. In practice, `setVizHash` replaces the whole `vizToHash` object, so ALL widgets re-subscribe on any widget's hash change. The single `comboKey` pattern (one selector) halves subscriptions and avoids this. Mitigation: use a single `comboKey` primitive in AggregatedWidgetRenderer.

### Pitfall D: The table path of Effect 1 is removed but `materializeAbortRef` is still used by the dv branch

`materializeAbortRef` is shared between the table branch and the dv branch today. After the table branch is removed, `materializeAbortRef` is still needed by the dv branch. Do not remove it.

### Pitfall E: `filterViewStore` import stays in WidgetRenderer.tsx for dv selectors

The `useFilterViewStore` import in `WidgetRenderer.tsx` must NOT be removed — it's still needed for `dvViews` selectors (lines 450-454). Only TimelineRenderer and NumericLineRenderer can have their `useFilterViewStore` imports removed (after verifying no other usages remain).

---

## Common Pitfalls (from PITFALLS.md, applicable to Phase 91)

### Re-render storm (Pitfall 4 from PITFALLS.md — S-02)

Non-primitive selectors cause every registry mutation to re-render every subscriber. Use `comboKey` (primitive string) not `registry[hash]` (object). `combinationVersion` (integer) as the Effect dep, not the registry object.

### Stale effectiveViewName race (Pitfall 5 from PITFALLS.md)

The suspend gate (`comboMaterializing = true`) must engage BEFORE the chart query fires. The orchestrator calls `markMaterializing` synchronously before `await materializeFilter`. Since `markMaterializing` bumps `combinationVersion`, Effect 2 will see `combinationVersion` change and re-run — but on that re-run, `comboMaterializing` is `true` and the effect returns early. The window between `markMaterializing` and `combinationVersion` propagating to the component is one React render cycle. During that window, Effect 2 may fire with the old (stale) `comboMaterializing = false`. This is the same race that existed before Phase 17-03 for the legacy path — it was fixed by making `markMaterializing` synchronous inside the drill-down click handler. For Phase 91, the orchestrator fires in a `setTimeout(300ms)` debounce, so there is no synchronous click-handler path. Accept this window (same as the existing debounce window) — it existed before and is acceptable.

### Dual-trigger period ending

Between Phase 90 completion and Phase 91 completion, both the orchestrator AND Effect 1's table branch fire. Effect 1 writes to `filterViewStore.views[tableId]`; the orchestrator writes to `filterCombinationStore.registry`. Renderers still read from `filterViewStore`. This is intentional (DUAL-TRIGGER decision from Phase 90). Phase 91 ends the dual-trigger by removing Effect 1's table branch AND flipping the selector. Both changes must happen atomically in one commit — do not split across two commits or the system is in split-brain.

---

## Test Gates for Phase 91

| Gate | Command |
|------|---------|
| TypeScript | `cd packages/web && npx tsc --noEmit` |
| Full vitest | `cd packages/web && npx vitest run` (100% — 2878+ tests) |
| Theme guard | `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` |
| Sole-trigger grep | `grep -r "materializeFilter\|dropFilterView" packages/web/src/components/charts/` — must find only `WidgetRenderer.tsx` (dv branch only) |

**Zero server diff expected.** The server is not touched in Phase 91.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (packages/web) |
| Config file | packages/web/vite.config.ts |
| Quick run command | `cd packages/web && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/TimelineRenderer.spec.tsx src/components/charts/NumericLineRenderer.spec.tsx` |
| Full suite command | `cd packages/web && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-V118-01 | WidgetRenderer reads combo view via FROM-swap | unit | Quick run command | Yes — extend WidgetRenderer.spec.tsx |
| READ-V118-01 | TimelineRenderer reads combo view (FROM-swap target swap) | unit | Quick run command | Yes — extend TimelineRenderer.spec.tsx |
| READ-V118-01 | NumericLineRenderer reads combo view (FROM-swap target swap) | unit | Quick run command | Yes — extend NumericLineRenderer.spec.tsx |
| COMBO-V118-04 | Default config → base table query while no combo view | unit | Quick run command | No — Wave 0 gap |
| COMBO-V118-04 | Default config → combo view used once orchestrator sets it | unit | Quick run command | No — Wave 0 gap |

### Sampling Rate
- **Per task commit:** `cd packages/web && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/TimelineRenderer.spec.tsx src/components/charts/NumericLineRenderer.spec.tsx`
- **Per wave merge:** `cd packages/web && npx vitest run`
- **Phase gate:** Full suite green before phase closes

### Wave 0 Gaps
- [ ] New `describe("COMBO-V118-04 — default accept-all …")` block in `WidgetRenderer.spec.tsx` — covers NOFILTER → base table + combo view → FROM-swap
- [ ] Mock updates in `TimelineRenderer.spec.tsx` Tests 2b + 2c — change from `filterViewStore` mock population to `filterCombinationStore` mock population
- [ ] Mock updates in `NumericLineRenderer.spec.tsx` parallel tests — same as TimelineRenderer

---

## Open Decisions (Planner Must Lock)

1. **AggregatedWidgetRenderer selector form:** Single `comboKey` primitive (one subscription, imperative entry reads in effects) OR three separate primitive selectors (`comboViewName`, `comboMaterializing`, `comboExpiresAt`). Recommendation: single `comboKey` + `combinationVersion` — mirrors MapChartRenderer's established pattern and avoids triple subscription.

2. **LIFE-V13-02 reactive retry behavior post-swap:** When `isViewNotFoundError` fires and `comboHash` is defined: (a) call `clearEntry(comboHash)` and return — orchestrator re-materializes on next filterVersion tick; OR (b) keep inline `materializeFilter` call but route through combination-store instead of filterViewStore. Recommendation: option (a) — removes a second route to `materializeFilter` in the table-bound path, simplest implementation, acceptable for Phase 91.

3. **Static sole-trigger assertion update:** The existing CalendarRenderer static test in `WidgetRenderer.spec.tsx` asserts that CalendarRenderer imports no materializeFilter. No change needed there. The comment on Effect 1 table-path removal should state the new authorized callers (dv branch in WidgetRenderer, useCombinationOrchestrator for table combos). Planner should add a brief comment explaining this in the spec; no new test file needed.

4. **fromSwap behavior with empty string:** Verify `fromSwap(sql, "")` equals `fromSwap(sql, undefined)` before finalizing the NOFILTER path. This is a correctness pre-condition; if fromSwap does NOT handle empty string as falsy, the fix is to pass `undefined` instead of `""` when `comboHash` is NOFILTER or undefined.

---

## Sources

### Primary (HIGH confidence — direct code inspection)

- `packages/web/src/components/charts/WidgetRenderer.tsx` (all lines) — current selectors (lines 406-428), Effect 1 (lines 506-609), Effect 2 (lines 632-810)
- `packages/web/src/components/charts/TimelineRenderer.tsx` (lines 195-407) — selectors (lines 203-207), fetch effect (lines 237-404)
- `packages/web/src/components/charts/NumericLineRenderer.tsx` (lines 183-376) — selectors (lines 187-191), fetch effect (lines 221-376)
- `packages/web/src/store/filterCombinationStore.ts` — CombinationEntry shape, vizToHash, combinationVersion, NOFILTER invariant
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — vizKey = `"w:<widgetId>"`, DUAL-TRIGGER comment, combinationVersion exclusion from deps
- `packages/web/src/lib/stableComboHash.ts` — `NOFILTER_SENTINEL = "NOFILTER"`, hash format `"${sourceType}:${sourceId}:NOFILTER"`
- `packages/web/src/lib/resolveFilterSet.ts` — accept-all returns `allFilters.slice()`
- `.planning/phases/88-foundation-pure-logic-types/88-01-SUMMARY.md` — stableComboHash contract, NOFILTER sentinel
- `.planning/phases/89-store-server-foundation/89-01-SUMMARY.md` — CombinationEntry type, combinationKey S-02 selector
- `.planning/phases/90-combination-orchestrator/90-03-SUMMARY.md` — DUAL-TRIGGER decision, vizKey = `"w:<widgetId>"`, filterSelection from `w.config.filterSelection`
- `.planning/research/ARCHITECTURE.md` (lines 330-370) — exact selector swap pattern for WidgetRenderer
- `.planning/research/PITFALLS.md` — S-02 re-render storm, stale view race

---

*Phase 91: WidgetRenderer Wiring*
*Researched: 2026-06-27*
