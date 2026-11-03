---
quick_id: 261009-jg6
title: Fix dynamic views not finding their filter view when filter combinations are active
date: 2026-10-09
status: complete
operator_verified: 2026-10-09 (approved — Avg NYC map layer, demo.nyctaxi)
commits: [4f8393f, 80bca78, fb7325b, 14b54ba]
fixes: .planning/defect-dv-combination-filter-view.md
---

# Quick Task 261009-jg6 — Summary

**One-liner:** Dynamic views render again under filters. Three stacked causes were fixed, plus spatial draws now narrow a dv's source, plus a reason-aware legend badge.

## Root causes (confirmed by reading code, not assumed)

1. **The client never asked the server.** `useDynamicViewMaterializeChain.ts` keyed on `filterViewStore.materializeVersion`. Nothing has written that store since v1.18 / Phase 91, so the value was always 0. The local no-filter fast path therefore set `over_threshold / no_filter` every time, regardless of filters or Unlimited. This is why Unlimited was also blank.
2. **The server looked up the wrong name.** Dv materialize (`index.ts` ~2075) and preview (~1973) built the filter-view name without the v1.18 `combinationKey`. Since v1.18, every filter view is `…_c<hash8>`. The lookup always missed and fell back to the base table, even with a single filter.
3. **No filter view existed for a dv to read.** The v1.18 combination orchestrator only materialized views for widgets and layers, never for a dv's source table.

## What changed

| Commit | Change |
|---|---|
| 4f8393f | Server dv materialize and preview accept an optional `combination_key` (a non-string returns 400 before any SQL) and look up the matching `_c<hash>` filter view. Adds the shared `lib/dvSourceCombo.ts` helper and the client API parameter. DynamicViewsModal preview and save pass the key. |
| 80bca78 | The orchestrator materializes and ref-counts each dv's source combination under `dv:<id>`. It is still the sole `materializeFilter` caller. The chain now reacts to the combination store, not the dead store. The fast path is kept only for capped dvs with no filter, so Unlimited with no filter reaches the server's base-table branch. On a failed source materialize the dv shows an `error` status, not a permanent `pending`. A `failedHashesRef` guard stops a retry loop until filters change. |
| fb7325b | The legend badge distinguishes "No filter applied" (`no_filter`) from "Over threshold" (`exceeds_max_records`), using existing classes with no CSS diff. |
| 14b54ba | Added after the operator's first live check, which used a spatial-only filter. A dv's source combination now includes the source table's spatial draws, resolved like widgets and layers (`aggregateSpatialTargetsByTable`). A spatial-only draw counts as "filter applied", and clearing it returns to no-filter. No server change was needed. |

## Verification

- **Red-first specs:** DVCOMBO-S1/S3/S4, O1/O3–O5, C1–C3/C5/C7/C8, L1, SP-H1/H2, SP1–SP3, SP-C1/SP-C3. Mutation proofs exist for the server key, orchestrator iteration, chain gating, shape folding and the spatial dependency.
- **Gates at 14b54ba:**
  - Web: `tsc` clean; vitest 4414 passed, 1 skipped; theme-guard 158/158.
  - Server: `tsc` clean; `test-gate.mjs` GATE PASSED. Extra failing files pass alone (TD-V16-TEST-ISOLATION), plus the known `DEFAULT_VIEW_TTL_MINUTES=3` dev-`.env` noise.
- **Invariants held:** the only non-spec `materializeFilter(` sites are in `useCombinationOrchestrator.ts`; v1.18 dedupe and ref-count are intact; the Phase 133 column guard and `viewColumnsCache` are untouched.
- **Operator live check (approved 2026-10-09):** the Avgs layer (dv "Avg NYC") renders H3 cells under a spatial circle, a column drill, both together, clear-all and the Unlimited case. Badges are legible in light and dark.

## Non-discriminating criteria reported, not bent

- SP4 and SP-C4 (no eligible spatial target means the draw is ignored) passed before the work. They are regression guards only.
- The first SP-C1 and SP-C3 passed even with the dependency removed, because an inline array re-ran the effect. They were fixed with a stable constant and the mutation was re-run, after which they fail correctly.

## Follow-ups (not done here)

- The map overlay text "Some layers over threshold" is still reason-agnostic; only the legend badge distinguishes the two cases.
- The orchestrator never increments the combination store's `materializeVersion`, so the chain token keys on `viewName + expiresAt` instead.
- If no map widget has an eligible spatial target for a dv's source table, a spatial-only draw is ignored and the combination stays column-only.
- A brand-new dv's preview and save may hit the base fallback until the orchestrator registers it.
- A widget that shares a failed hash won't retry until the next filter change (a side effect of the `failedHashesRef` guard).
- **Unrelated, seen during the live check:** the Pie Chart error `Column 'test_col' not found` is stale config referencing the dropped test column. It is a Kinetica error, not the Phase 133 guard.
