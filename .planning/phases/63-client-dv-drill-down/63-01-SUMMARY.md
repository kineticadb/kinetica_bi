---
phase: 63-client-dv-drill-down
plan: 01
subsystem: client-filter-stores
tags: [filter-store, dynamic-view, drill-down, zustand]
requires:
  - "Phase 62 server materialize-from-dv-view contract (dynamicViewId body field) — consumed downstream (63-03), not this plan"
provides:
  - "useFilterStore.dvFilters: Record<dynamicViewId, ActiveFilter[]> + addDvFilter/removeDvFilter/clearDvFilters"
  - "useFilterViewStore.dvViews: Record<dynamicViewId, FilterViewEntry> + setDvView/markDvMaterializing/clearDvView"
  - "Both reset() impls zero the dv slices (DVDRILL-V112-05 lifecycle, no new reset call sites)"
affects:
  - "63-02 (dv-aware drill dispatch consumes addDvFilter/markDvMaterializing)"
  - "63-03 (dv read-path FROM-swap consumes dvViews/setDvView/clearDvView)"
  - "63-04 (chips consume dvFilters/removeDvFilter)"
tech-stack:
  added: []
  patterns:
    - "Parallel dv-keyed slice (NOT composite-string re-keying) keeps the table path byte-unchanged"
    - "dv actions reuse the shared filterVersion counter so WidgetRenderer Effect 1 re-fires off dv changes too"
key-files:
  created: []
  modified:
    - "packages/web/src/store/filterStore.ts"
    - "packages/web/src/store/filterStore.spec.ts"
    - "packages/web/src/store/filterViewStore.ts"
    - "packages/web/src/store/filterViewStore.spec.ts"
decisions:
  - "Parallel dv-keyed slices (LOCKED 63-CONTEXT) rather than re-keying Record<number> → Record<string>; lowest-risk, table path untouched"
  - "No clearDvMaterializing action — the dv-bound widget gates its chart query on dvStatus, not the filter-view materializing flag (deferred to 63-03)"
metrics:
  duration: "3min"
  tasks: 2
  files: 4
  completed: "2026-06-15"
---

# Phase 63 Plan 01: DV-Scoped Filter-Store Slices Summary

Added parallel `dynamicViewId`-keyed slices to both filter stores (`dvFilters` on `useFilterStore`, `dvViews` on `useFilterViewStore`) with mirrored dv actions sharing the existing `filterVersion` counter, so a dv drill-down can never collide with a same-numbered `tableId` — fixing the root cause of the v1.12 bug where a dv drill landed in `filters[tableId]`. Both `reset()` impls now zero the dv slices, giving DVDRILL-V112-05 lifecycle cleanup for free with no new reset call sites.

## What Was Built

- **filterStore.ts:** `dvFilters: Record<number, ActiveFilter[]>` + `addDvFilter/removeDvFilter/clearDvFilters` — copied from the table-keyed bodies verbatim (same `FILTER_CAP_PER_TABLE` cap + overflow toast, same exact-dup dedupe, same same-column REPLACE, same delete-key clear, same no-op-no-version-bump rules). Reuses the shared `filterVersion` counter. `reset()` → `{ filters: {}, dvFilters: {}, filterVersion: 0 }`. Table path (`filters`, `addFilter`, `removeFilter`, `clearFilters`, `setBulkFilters`, `FILTER_CAP_PER_TABLE`) byte-unchanged.
- **filterViewStore.ts:** `dvViews: Record<number, FilterViewEntry>` (reuses `FilterViewEntry` unchanged) + `setDvView/markDvMaterializing/clearDvView` mirroring `setView/markMaterializing/clearView`. `reset()` → `{ views: {}, dvViews: {}, clearMaterializingVersion: 0 }`. No `clearDvMaterializing` (dvStatus-gated downstream). Table path byte-unchanged.
- **Specs:** 13 dv-filter cases + 11 dv-view cases including the store-level isolation/bug-fix locks (`addDvFilter(7,…)` leaves `filters[7]` empty; `setDvView(7,…)` leaves `views[7]` undefined; and the reverses) and reset-zeroes-both-slices.

## Verification Results

- `cd packages/web && npx vitest run src/store/filterStore.spec.ts src/store/filterViewStore.spec.ts` → **77 passed (39 + 38)**, 0 failures. Existing table-path tests still green (regression confirmed).
- `cd packages/web && npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `git diff` over this plan's commits (`7a763cd^..HEAD`) touches **only** the 4 `packages/web/src/store` files; **zero** `packages/server` diff.
- TDD: RED commit precedes GREEN for each task (new dv tests failed with `is not a function` before implementation).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: packages/web/src/store/filterStore.ts (dvFilters + addDvFilter/removeDvFilter/clearDvFilters; reset zeroes dvFilters)
- FOUND: packages/web/src/store/filterViewStore.ts (dvViews + setDvView/markDvMaterializing/clearDvView; reset zeroes dvViews)
- FOUND commit 7a763cd (test: filterStore RED)
- FOUND commit a41062e (feat: filterStore GREEN)
- FOUND commit 8124e08 (test: filterViewStore RED)
- FOUND commit f6e6669 (feat: filterViewStore GREEN)
