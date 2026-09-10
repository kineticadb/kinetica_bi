---
phase: 89-store-server-foundation
plan: "01"
subsystem: filter-combination-store
tags: [zustand, store, ref-count, keep-alive, cleanup, v1.18, frontend-only]
dependency_graph:
  requires:
    - stableComboHash (packages/web/src/lib/stableComboHash.ts) — Phase 88
    - NOFILTER_SENTINEL (packages/web/src/lib/stableComboHash.ts) — Phase 88
    - dropFilterView pattern (packages/web/src/api/client.ts) — Phase 15/35
    - filterViewStore cleanup pattern (App.tsx + DashboardsPage.tsx) — Phase 15
    - useViewKeepAlive (packages/web/src/hooks/useViewKeepAlive.ts) — Phase 78
  provides:
    - useFilterCombinationStore (packages/web/src/store/filterCombinationStore.ts)
    - CombinationEntry (packages/web/src/store/filterCombinationStore.ts)
    - FilterCombinationState (packages/web/src/store/filterCombinationStore.ts)
    - MAX_COMBINATION_VIEWS_PER_TABLE = 10 (packages/web/src/store/filterCombinationStore.ts)
    - dropCombinationView({ dashboardId, viewName }) (packages/web/src/api/client.ts)
    - 9th-store cleanup at App.tsx logout (packages/web/src/App.tsx)
    - 9th-store cleanup at DashboardsPage.tsx dashboard-switch (packages/web/src/components/DashboardsPage.tsx)
    - combination-registry keep-alive (packages/web/src/hooks/useViewKeepAlive.ts)
  affects:
    - Phase 90 (combination orchestrator — imports useFilterCombinationStore + dropCombinationView)
    - Phase 91 (WidgetRenderer wiring — imports useFilterCombinationStore + vizToHash + combinationVersion)
    - Phase 92 (MapChartRenderer wiring — imports useFilterCombinationStore + vizToHash)
tech_stack:
  added: []
  patterns:
    - zustand create<State> with spread-update + reference-stable per-key updates (S-02 pattern)
    - DROP-at-0 ref-count lifecycle (release triggers clearEntry when refCount reaches 0)
    - snapshot-then-DROP loop before reset() (mirrors filterViewStore LIFE-V13-04 pattern)
    - primitive-string subscription for re-sync effects (S-02 compliant combinationKey)
    - in-flight dedup Map for concurrent DROP requests (mirrors inFlightDrop)
key_files:
  created:
    - packages/web/src/store/filterCombinationStore.ts
    - packages/web/src/store/filterCombinationStore.spec.ts
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/App.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/hooks/useViewKeepAlive.ts
decisions:
  - "markMaterializing carries sourceType+sourceId on placeholder (needed by cleanup loops to fire typed DROPs)"
  - "setVizHash does NOT bump combinationVersion (vizToHash changes are not registry mutations)"
  - "release on missing/already-deleted entry is a safe no-op (guard: if (!prev) return s)"
  - "release when refCount reaches <= 0 deletes the entry; network DROP is caller's responsibility"
  - "dropCombinationView uses separate inFlightDropCombo Map (avoids cross-contamination with inFlightDrop)"
  - "combinationKey subscription uses hash:viewName:expiresAt:materializeVersion segments (S-02 compliant)"
  - "cleanup loop only DROPs entries with non-empty viewName (materializing entries have no live Kinetica view)"
metrics:
  duration_seconds: 393
  completed_date: "2026-06-27"
  tasks_completed: 3
  files_created: 2
  files_modified: 4
---

# Phase 89 Plan 01: Store + Server Foundation (Frontend) Summary

**One-liner:** Ref-counted filterCombinationStore (9th store) with DROP-at-0 lifecycle, dropCombinationView API helper, snapshot-then-DROP cleanup at both App.tsx logout and DashboardsPage.tsx dashboard-switch, and keep-alive extension for combination-registry views.

## What Was Built

### Task 1: filterCombinationStore + spec (28 specs green)

**`packages/web/src/store/filterCombinationStore.ts`** — the 9th store

Exported API for Phase 90/91/92 importers:

```typescript
export const MAX_COMBINATION_VIEWS_PER_TABLE = 10;  // ceiling VALUE; enforcement in Phase 90

export type CombinationEntry = {
  viewName: string;           // empty while materializing
  expiresAt: number;          // epoch ms; 0 when unknown
  materializing: boolean;
  materializeVersion: number; // WMS _mv cache-buster
  refCount: number;           // # vizualizations bound to this combination
  dashboardId: number;        // for cleanup loops
  sourceType: "table" | "dv";
  sourceId: number;           // tableId or dvId
};

export type FilterCombinationState = {
  registry: Record<string, CombinationEntry>;   // keyed by stableComboHash output
  vizToHash: Record<string, string | undefined>; // "w:<widgetId>" | "l:<layerId>" | "dv:<dvId>"
  combinationVersion: number;                    // primitive Effect dep (S-02 pattern)
  setEntry(hash, entry): void;
  markMaterializing(hash, dashboardId, sourceType, sourceId): void;
  clearEntry(hash): void;
  setVizHash(vizKey, hash | undefined): void;
  acquire(hash): void;   // refCount += 1
  release(hash): void;   // refCount -= 1; clearEntry when reaches 0 (DROP-at-0)
  reset(): void;
};

export const useFilterCombinationStore: StoreApi<FilterCombinationState>;
```

**dropCombinationView contract for Phase 90/91/92 importers:**

```typescript
// In packages/web/src/api/client.ts
export type DropCombinationViewArgs = { dashboardId: number; viewName: string };
export const dropCombinationView: (args: DropCombinationViewArgs, signal?: AbortSignal) =>
  Promise<DropFilterViewResponse>;
// DELETE /api/filter/materialize?dashboardId=<id>&viewName=<encoded-name>
// In-flight dedup via inFlightDropCombo Map keyed "${dashboardId}:c:${viewName}"
```

**Key design invariants:**
- NOFILTER hashes (ending with `:NOFILTER`) are NEVER stored in registry — callers check before calling setEntry/markMaterializing.
- `setVizHash` does NOT bump `combinationVersion` — vizToHash changes are not registry mutations; subscribers scope to their own vizKey.
- `release` drops the registry entry when refCount reaches 0 (DROP-at-0); the network DELETE is the CALLER's responsibility.
- PITFALL S-02 lock: NEVER subscribe to `s.registry` (whole object) — scope to `s.vizToHash[vizKey]` or `s.combinationVersion` (primitive).

### Task 2: dropCombinationView + both cleanup sites

**`packages/web/src/api/client.ts`** — new `dropCombinationView` helper after `dropFilterView`

Targets combination views by direct name (Plan 89-02 extends DELETE /api/filter/materialize to accept `?viewName=`). Mirrors `dropFilterView` pattern exactly: separate `inFlightDropCombo` Map, explicit dual-handler settle-cleanup, same error handling.

**`packages/web/src/App.tsx`** logout cleanup (lines ~135-142):
```typescript
// 9th store block added after useDynamicViewStore.getState().reset()
const combinationRegistry = useFilterCombinationStore.getState().registry;
for (const entry of Object.values(combinationRegistry)) {
  if (entry.viewName) {
    dropCombinationView({ dashboardId: entry.dashboardId, viewName: entry.viewName }).catch(() => {});
  }
}
useFilterCombinationStore.getState().reset();
```

**`packages/web/src/components/DashboardsPage.tsx`** dashboard-switch cleanup (lines ~531-539):
Same snapshot-then-DROP-then-reset block, added after `useColumnDisplayConfigStore.getState().reset()`.

Both sites:
- Snapshot BEFORE reset (so the loop reads live entry.dashboardId + entry.viewName)
- Only DROP entries with non-empty viewName (materializing entries have no live Kinetica view)
- Fire-and-forget `.catch(() => {})` — never blocks logout or dashboard-switch on network latency

### Task 3: useViewKeepAlive combination-registry extension

**`packages/web/src/hooks/useViewKeepAlive.ts`**

Three changes (additive only — existing f: and d: paths unchanged):

1. Import `useFilterCombinationStore`
2. Third primitive subscription: `combinationKey` string projection over `registry` entries — `${hash}:${viewName}:${expiresAt}:${materializeVersion}` per entry, sorted, joined. S-02 compliant.
3. In re-sync effect liveKeys build: combination-registry loop adding `c:<hash>` entries for live views (viewName non-empty, expiresAt > 0, not expired). Identical liveness test to filter-views path.
4. `combinationKey` added to re-sync dep array: `[filterKey, dynamicKey, combinationKey, dashboardId]`.

The existing `schedule`/`touch`/`prune` loops operate generically over `liveKeys` — `c:` keys flow through automatically without any additional logic.

## Deviations from Plan

None — plan executed exactly as written.

## Test Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (packages/web) | PASS — clean |
| `npx vitest run src/store/filterCombinationStore.spec.ts` | PASS — 28/28 |
| `npx vitest run` (full suite) | PASS — 125 files, 2860 tests |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASS — 128/128 |
| `git diff --name-only packages/server` (my commits) | EMPTY — zero server diff in my commits |
| `git diff -- packages/web/package.json` | EMPTY — no new deps |
| `grep -c "useFilterCombinationStore.getState().reset()" App.tsx` | 1 — present |
| `grep -c "useFilterCombinationStore.getState().reset()" DashboardsPage.tsx` | 1 — present |

Pre-existing errors: 1-2 serialization errors from `InfoPopup.spec.tsx` (401 network failures — TD-V16-TEST-ISOLATION set, unrelated to this phase).

## Self-Check: PASSED

All 6 files (2 created, 4 modified) exist on disk. Three task commits present in git log:
- `a6f9e09` — feat(89-01): filterCombinationStore — 9th store + ref-count registry + MAX_COMBINATION_VIEWS_PER_TABLE
- `efa5dc3` — feat(89-01): dropCombinationView API helper + 9th-store cleanup at BOTH reset sites
- `c9278ea` — feat(89-01): extend useViewKeepAlive to cover combination-registry views
