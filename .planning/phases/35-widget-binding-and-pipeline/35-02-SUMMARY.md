---
phase: 35-widget-binding-and-pipeline
plan: 02
subsystem: ui
tags: [wms, openlayers, dynamic-views, typescript-overloads, pure-function, tdd, vitest]

# Dependency graph
requires:
  - phase: 33-dynamic-view-store
    provides: useDynamicViewStore status union ("materialized" | "over_threshold" | "pending" | "error") + dynamicViewVersion global counter
  - phase: 16
    provides: existing buildWmsParams 2-case precedence (filter-view tableRef / bare layerName) + _mv cache-buster semantics (PT16-A)
  - phase: 11
    provides: WMS param shape + spatial-mode + render-mode branches that Phase 35 must not perturb
provides:
  - DynamicViewEntryInput type export (status + viewName only — load-bearing fields for URL construction)
  - Extended buildWmsParams with 4-case LAYERS / _mv precedence (dv-materialized → null-on-non-materialized → filter-view → bare-table)
  - Overload signatures preserving non-null return for legacy 2-arg callers (no MapChartRenderer changes needed in this plan)
  - 10 new spec cases covering all 4 precedence branches + dv-over-fv lock + spatial-mode interaction + defensive paths
affects:
  - 35-06-map-renderer-and-layer-picker (consumer — wires the 4-arg form per layer)
  - Plan 35-03 orchestrator (indirect — its setView writes feed the dvEntry the caller will pass here)
  - any future dv-aware WMS caller (the type export becomes the contract surface)

# Tech tracking
tech-stack:
  added: []  # No new libraries — pure TypeScript signature + branch logic
  patterns:
    - "TypeScript function overloads to widen return type for new args while preserving legacy non-null return"
    - "4-case precedence with explicit early-return null for layer-skip semantics"
    - "Per-source-kind LAYERS naming as implicit OL tile cache key (Pitfall 5 lock — no version-counter collision possible)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts

key-decisions:
  - "Used TypeScript overload signatures (2-arg returns non-null; 4-arg returns | null) instead of universally widening the return type, so existing MapChartRenderer call sites compile unchanged without null-narrowing. Honors the plan's locked must-have 'Existing callers (MapChartRenderer Effects 2/3) compile unchanged' without forcing a touch on Plan 35-06's territory."
  - "Kept all existing spatial-mode + render-mode branches untouched and outside the new if/else. The 4-case precedence ONLY decides LAYERS + _mv; everything else projects onto whichever LAYERS source wins."
  - "Defensive omission of _mv when dynamicViewVersion is undefined (mirrors PT16-A lock: never emit _mv=0 sentinel) — LAYERS distinctness alone busts the OL tile cache when source kind changes, _mv is a within-kind buster only."

patterns-established:
  - "Function-overload-based backward-compatibility pattern for widened return types: legacy callers get the narrow type, new callers get the union. Avoids cascade-rewriting consumer call sites in unrelated files."
  - "DynamicViewEntryInput as the contract type at the WMS-URL boundary — only fields load-bearing for URL construction (status + viewName) cross the boundary; everything else (expiresAt, reason, error) stays a renderer concern."

requirements-completed: [DV-V16-13]

# Metrics
duration: 5min
completed: 2026-05-15
---

# Phase 35 Plan 02: buildWmsParams precedence Summary

**4-case LAYERS / _mv precedence (dv-materialized → null-on-non-materialized → filter-view → bare-table) added to buildWmsParams via TypeScript overloads, preserving zero-touch backward compat for legacy callers and unblocking Plan 35-06's per-layer dv binding.**

## Performance

- **Duration:** ~5 min (293 s)
- **Started:** 2026-05-15T16:33:41Z
- **Completed:** 2026-05-15T16:38:34Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2

## Accomplishments

- Exported `DynamicViewEntryInput` type as the WMS-boundary contract (status + viewName) — Plan 35-06 will consume.
- Extended `buildWmsParams` with two new optional args (`dynamicViewEntry`, `dynamicViewVersion`) implementing the locked 4-case precedence; non-materialized dv-bound layers return `null` so the caller can skip them in the N-layer stack.
- Used TypeScript function overloads so the 2-arg legacy form still returns `Record<string, string>` (non-null) — MapChartRenderer Effects 2/3 compile unchanged with no narrowing required.
- Comprehensive spec coverage: 10 new cases (case 1, 2a/b/c, 3, 4, dv-wins-over-fv, dv + spatial-mode, materialized-no-version, legacy 2-arg overload smoke). 66/66 total tests pass; tsc clean.

## Task Commits

Each task was committed atomically (TDD discipline: RED → GREEN → spec expansion):

1. **Task 1 RED: failing spec smoke for dv-materialized precedence** — `3709561` (test)
2. **Task 1 GREEN: extend buildWmsParams with 4-case dv precedence + overload signatures** — `4f351f7` (feat)
3. **Task 2: expand spec to full 8-case precedence coverage + overload guard** — `145f5b8` (test)

_TDD note: Task 1 split into RED + GREEN per the TDD execution flow; Task 2 expands the spec to the full 8 cases the plan requires._

## Files Created/Modified

- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Added `DynamicViewEntryInput` type export above the builder. Extended `buildWmsParams` with overload signatures (2-arg returns `Record<string,string>`; 4-arg returns `Record<string,string> | null`) plus inline 4-case precedence branch at the top of LAYERS resolution. Spatial-mode + render-mode branches untouched.
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` — Added a new `describe("buildWmsParams — Phase 35 dynamic-view precedence (DV-V16-13)")` block with 10 cases. Existing 56 base / spatial / render-mode tests unchanged and still pass.

## Decisions Made

- **TypeScript overloads instead of universal return-type widening.** The plan locks "Existing callers compile unchanged because new args are optional" as a must-have. Universally widening the return to `Record<string,string> | null` broke MapChartRenderer:838 at compile time (TS2322: null not assignable to ImageWMS `params`). Overload signatures preserve the narrow non-null return for the 2-arg form (legacy callers) while widening for the 4-arg form (Plan 35-06 callers). Pure-function discipline maintained; no React/Zustand imports added to wmsUrlBuilder.ts; no consumer files touched.
- **Defensive _mv omission when `dynamicViewVersion` is undefined** in case 1 (dv-materialized but no version supplied). Mirrors Phase 16 PT16-A lock ("never emit _mv=0 sentinel"). The spec asserts this with `expect(result).not.toHaveProperty("_mv")`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Universally widened return type broke MapChartRenderer compile**

- **Found during:** Task 1 GREEN (after applying the locked `Record<string, string> | null` return type)
- **Issue:** Widening the return type to `Record<string, string> | null` broke `kinetica_bi/src/components/charts/MapChartRenderer.tsx:838` at type level (TS2322: `null` not assignable to ImageWMS `params: { [x: string]: any; } | undefined`). The plan's must-have lock — "Existing callers (MapChartRenderer Effects 2/3) compile unchanged because new args are optional" — was violated by the bare type widening even though no runtime behavior changed (the 2-arg form can never enter the null-return branch since it requires `dynamicViewEntry !== undefined`).
- **Fix:** Added TypeScript function overload signatures: the 2-arg form has return type `Record<string, string>` (non-null), the 4-arg form has return type `Record<string, string> | null`. The implementation signature retains the union; only the public overloads narrow it. No call-site changes needed in MapChartRenderer (Plan 35-06's territory).
- **Files modified:** `kinetica_bi/src/lib/wmsUrlBuilder.ts` (overload signatures added above implementation)
- **Verification:** `npx tsc --noEmit` exits 0 with zero errors. `npx vitest run src/lib/wmsUrlBuilder.spec.ts` 66/66 passes. Added a legacy-2-arg overload smoke test that accesses `result.LAYERS` directly without `!` narrowing as a type-level regression guard.
- **Committed in:** `4f351f7` (Task 1 GREEN)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix to satisfy the locked must-have. No scope creep — change is fully contained within `wmsUrlBuilder.ts`, preserves pure-function discipline, and matches the plan's "Existing 2-arg callers must still compile + work unchanged" backward-compat lock verbatim.

## Issues Encountered

None beyond the deviation above. RED → GREEN → spec expansion flow executed cleanly; no analysis-paralysis stalls; no auth gates; no architectural questions.

## User Setup Required

None — pure-function helper extension with no runtime config, no env vars, no external service.

## Next Phase Readiness

- **Ready for Plan 35-06** (map-renderer-and-layer-picker): the 4-arg `buildWmsParams` signature is the contract Plan 35-06 calls per layer. The `DynamicViewEntryInput` type export is the boundary contract. Plan 35-06 will:
  1. Compute the per-layer `dvEntry` from `useDynamicViewStore.views[layer.dynamic_view_id]` (imperative `.getState()` snapshot at Effect 2/3 fire time, per Pitfall C-02).
  2. Compute `dvVersion` from `useDynamicViewStore.dynamicViewVersion`.
  3. Call `buildWmsParams(wmsConfigInput, materializeVersion, dvEntry, dvVersion)`.
  4. Branch on `wmsParams === null` to omit the layer from the visible N-layer stack and surface the "Some layers over threshold" overlay.
- **Ready for Wave 1 parallel sibling 35-01** (server schema migration): no file overlap. 35-01 modifies server SQLite migration + DTOs; 35-02 modifies only the frontend pure-function helper + spec.
- **No blockers** for downstream plans.

## Self-Check: PASSED

Verified:
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` modified (overload signatures + DynamicViewEntryInput export + 4-case branch present). Confirmed.
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` modified (new describe block with 10 cases). Confirmed.
- Commit `3709561` (RED test) exists in `git log`. Confirmed.
- Commit `4f351f7` (GREEN impl) exists in `git log`. Confirmed.
- Commit `145f5b8` (Task 2 spec) exists in `git log`. Confirmed.
- `npx vitest run src/lib/wmsUrlBuilder.spec.ts` exits 0 with 66/66 passing.
- `npx tsc --noEmit` exits 0 with zero errors.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
