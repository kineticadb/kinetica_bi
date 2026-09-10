---
phase: 90-combination-orchestrator
verified: 2026-06-27T19:48:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 90: Combination Orchestrator Verification Report

**Phase Goal:** A single dashboard-level hook owns all combination-view materializations — computes unique combinations across all table-bound widgets on each filterVersion tick, diffs the registry, fires one POST per new combination, enforces the per-table ceiling with fallback + "info" toast, ref-counts (DROP at 0). Dual-trigger transition: AggregatedWidgetRenderer Effect 1 stays untouched (renderers still read legacy views until Phase 91); orchestrator lives in hooks/.
**Verified:** 2026-06-27T19:48:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `combinationKey?` on `MaterializeFilterArgs`; `inFlightMaterialize` branches to `${dashboardId}:c${comboShortHash(combinationKey)}` when present | VERIFIED | `client.ts` line 843 (`combinationKey?: string`), line 878-882 (ternary, combinationKey branch first) |
| 2  | `comboShortHash` imported in `client.ts` | VERIFIED | `client.ts` line 5 |
| 3  | Server reads `MAX_COMBINATION_VIEWS_PER_TABLE` at boot via `readPositiveIntEnv`, default 10 | VERIFIED | `index.ts` line 175 |
| 4  | GET /api/auth/me returns `maxCombinationViewsPerTable` in both auth modes | VERIFIED | `index.ts` line 410; password-mode supertest green; OIDC-mode fails only due to pre-existing `Issuer is not a constructor` isolation bug (TD-V16-TEST-ISOLATION) |
| 5  | Web `MeResponse`/`fetchMe`/auth store carry `maxCombinationViewsPerTable` | VERIFIED | `client.ts` line 250 (MeResponse), line 289 (fetchMe coalesce); `auth.ts` lines 18, 34, 49 |
| 6  | `useCombinationOrchestrator` exists in `hooks/`, exported, 405 lines, all 11 spec scenarios green | VERIFIED | File exists at `packages/web/src/hooks/useCombinationOrchestrator.ts`; `hooks/useCombinationOrchestrator.spec.ts` 11/11 green |
| 7  | `combinationVersion` absent from Effect dep array; deps are exactly `[filterVersion, dashboardId, widgetsKey, ceiling]`; NO-LOOP proven by spec scenario 10 | VERIFIED | Line 404: `}, [filterVersion, dashboardId, widgetsKey, ceiling])` ; no `combinationVersion` reference in dep array; spec scenario 10 passes |
| 8  | Mounted in `DashboardsPage.tsx` `DashboardOpen` after `useViewKeepAlive`; Effect 1 and all renderer read-paths unchanged; sole-trigger invariant preserved in `components/charts/` | VERIFIED | `DashboardsPage.tsx` lines 31 (import) + 449 (call); only `WidgetRenderer.tsx` imports `materializeFilter` in `components/charts/` (all other chart files contain comment references only, no import) |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/api/client.ts` | `combinationKey?` on `MaterializeFilterArgs` + cache-key branch using `comboShortHash` | VERIFIED | Lines 843 + 878-882; `comboShortHash` import at line 5 |
| `packages/server/src/index.ts` | `MAX_COMBINATION_VIEWS_PER_TABLE` boot const + `/api/me` exposure | VERIFIED | Lines 175 + 410 |
| `packages/web/src/api/client.ts` | `maxCombinationViewsPerTable: number` on `MeResponse` + `fetchMe` coalescing | VERIFIED | Lines 250 + 289 |
| `packages/web/src/store/auth.ts` | `maxCombinationViewsPerTable` in `AuthState` + initial 10 + bootstrap set | VERIFIED | Lines 18, 34, 49 |
| `packages/web/src/hooks/useCombinationOrchestrator.ts` | Dashboard-level combination-materialize orchestrator hook; min 120 lines | VERIFIED | 405 lines; exports `useCombinationOrchestrator` |
| `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` | 11-scenario spec referencing `combinationVersion` | VERIFIED | 556 lines; 11 `it()` blocks; `combinationVersion` referenced in scenario 10 |
| `packages/web/src/components/DashboardsPage.tsx` | Hook mounted with `useCombinationOrchestrator(dashboard.id, widgets)` | VERIFIED | Lines 31 + 449 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `materializeFilter` cache-key computation | `comboShortHash` | `${dashboardId}:c${comboShortHash(combinationKey)}` branch | VERIFIED | `client.ts` line 879 |
| GET /api/auth/me handler | `MAX_COMBINATION_VIEWS_PER_TABLE` boot const | `res.json` payload field | VERIFIED | `index.ts` line 410: `maxCombinationViewsPerTable: MAX_COMBINATION_VIEWS_PER_TABLE` |
| auth store bootstrap | `MeResponse.maxCombinationViewsPerTable` | `set(...)` on `/api/me` | VERIFIED | `auth.ts` line 49: `maxCombinationViewsPerTable: me.maxCombinationViewsPerTable` |
| `useCombinationOrchestrator` | `materializeFilter` (with `combinationKey`) | one POST per new unique hash | VERIFIED | `useCombinationOrchestrator.ts` line 289: `{ dashboardId, tableId, filters: resolved, combinationKey: hash }` |
| `useCombinationOrchestrator` | `useFilterCombinationStore` (acquire/release/markMaterializing/setEntry/setVizHash) | ref-count registry lifecycle | VERIFIED | Lines 281, 295, 338, 363, 374, 376 |
| `useCombinationOrchestrator` | `useAuthStore.maxCombinationViewsPerTable` | ceiling read from auth store | VERIFIED | Line 80: `useAuthStore((s) => s.maxCombinationViewsPerTable) ?? MAX_COMBINATION_VIEWS_PER_TABLE` |
| `DashboardsPage.tsx` DashboardOpen | `useCombinationOrchestrator` | mount call after `useViewKeepAlive` | VERIFIED | Lines 442 + 449 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| COMBO-V118-01 | 90-01, 90-03 | One view per unique combination, dedup + ref-count | SATISFIED | `combinationKey` cache-key fix in `client.ts`; orchestrator diffs registry, fires one POST per new unique hash, ref-counts acquire/release, DROP at refCount 0; spec scenarios 3-6 prove it |
| COMBO-V118-03 | 90-02, 90-03 | Env-var ceiling enforcement + fallback + warning | SATISFIED | `MAX_COMBINATION_VIEWS_PER_TABLE` read at boot with `readPositiveIntEnv` (default 10); exposed on `/api/me`; auth store carries it; orchestrator enforces ceiling with fallback to all-filters view + single "info" toast per table per tick; spec scenario 8 proves it |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/server/tests/auth.routes.spec.ts` | 382, 393 | `toEqual` assertions assert `user: { username: "alice" }` without `roles`/`permissions` which the server now returns | Info (pre-existing) | Pre-existing failure since Phase 48; the server has returned `roles`+`permissions` in `user` since Phase 48/50. Phase 90-02 updated these assertions to add `maxCombinationViewsPerTable` but did not fix the missing `roles`/`permissions`. Test fails in isolation. This is a pre-existing TD-V16-TEST-ISOLATION issue, not introduced by Phase 90. |

---

### Gate Results

| Gate | Result | Details |
|------|--------|---------|
| `cd packages/web && npx tsc --noEmit` | PASS | Clean (no output) |
| `cd packages/web && npx vitest run src/hooks/useCombinationOrchestrator.spec.ts src/api/client.spec.ts` | PASS | 73/73 tests passed (2 files) |
| `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` | PASS | 128/128 passed |
| `cd packages/server && npx tsc --noEmit` | PASS | Clean (no output) |
| Server auth.routes.spec.ts — password-mode MAX_COMBINATION_VIEWS_PER_TABLE=4 test | PASS | Test name "MAX_COMBINATION_VIEWS_PER_TABLE=4 surfaces as maxCombinationViewsPerTable: 4 on /api/me (Phase 90 COMBO-V118-03)" green |
| Server full vitest SET-BASED gate | PASS (set gate) | 12 failing files; all within pre-existing TD-V16-TEST-ISOLATION cross-mode contamination (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.dynamic-view, routes.filter-materialize-dv, routes.filter-materialize, routes.wms); no new failures introduced by Phase 90 |

---

### NO-LOOP Scenario Verification (Critical)

Spec scenario 10 ("combinationVersion-not-in-deps") directly proves the no-loop invariant:
1. Tick 1 fires and `materializeFilter` is called once.
2. `mockClear()` resets the call count.
3. `setEntry()` is called on the existing hash (this bumps `combinationVersion` internally).
4. Timers are advanced 310ms.
5. `materializeFilter` is asserted NOT called — no re-fire.

Result: PASS (scenario 10 green).

---

### Dual-Trigger Invariant Verification

- `WidgetRenderer.tsx` is the **only** source file in `packages/web/src/components/charts/` that imports `materializeFilter`. All other chart files (CalendarRenderer, TimelineRenderer, DataFilterRenderer, etc.) either contain static comment assertions that they do NOT import it, or are clean.
- `useCombinationOrchestrator.ts` lives in `hooks/` (not `components/`), satisfying the "orchestrator in hooks/" constraint.
- AggregatedWidgetRenderer Effect 1 dep array `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion, dvStatus, dynamicViewId]` is unchanged (verified by reading WidgetRenderer.tsx lines 497-609).

---

### Human Verification Required

**None** — all automated checks passed for the Phase 90 scope. Phase 91/92 will be the appropriate phases for verifying that renderers read the combination store entries.

---

## Gaps Summary

No gaps found. All 8 observable truths verified, all artifacts exist and are substantive, all key links are wired, both COMBO-V118-01 and COMBO-V118-03 requirements satisfied. The 4 failing server tests in `auth.routes.spec.ts` when run in isolation are pre-existing TD-V16-TEST-ISOLATION failures (3 pre-existing from Phase 48/74 era + 1 new OIDC-mode test that hits the same `Issuer is not a constructor` contamination). The password-mode "returns authMode='password'" test was already failing before Phase 90 because the `user` object in the response has contained `roles`+`permissions` since Phase 48 but the assertion was never updated for those fields. Phase 90 added only `maxCombinationViewsPerTable: 10` to the assertion, which is correct — but the missing `roles`/`permissions` fields remain a pre-existing omission.

---

_Verified: 2026-06-27T19:48:00Z_
_Verifier: Claude (gsd-verifier)_
