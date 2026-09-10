---
phase: 15-chart-filtering
plan: "04"
subsystem: ui
tags: [react, zustand, vitest, sql, ttl-recovery, filtering, error-handling]

# Dependency graph
requires:
  - phase: 15-03
    provides: RecordsTableRenderer viewName selector + fromSource FROM-swap; total-count dep array widened
  - phase: 15-02
    provides: AggregatedWidgetRenderer materialize trigger + fromSwap + materializeAbortRef; FilterViewEntry.dashboardId
  - phase: 14-filter-chips
    provides: useFilterViewStore (views, clearView, markMaterializing, setView), FilterViewEntry type
provides:
  - isViewNotFoundError(err: unknown): boolean — Phase 13 spike S3 substring + S/SDc:1513 code match
  - AggregatedWidgetRenderer proactive expiry check (LIFE-V13-01) — clearView before runSql when expiresAt past
  - AggregatedWidgetRenderer reactive max-1-retry recovery (LIFE-V13-02) — silent re-materialize + retry on view-not-found
  - RecordsTableRenderer proactive expiry check (LIFE-V13-01) — both page-fetch and total-count effects
  - WidgetRenderer.spec.tsx LIFE-V13-01 + LIFE-V13-02 test describes (7 new test cases)
affects: [15-05, Phase-17-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dual-path TTL recovery: proactive expiresAt comparison + reactive isViewNotFoundError catch
    - Max-1-retry tracked via useRef<{viewName, retried}> — reset on viewName change for fresh budget
    - Second view-not-found falls through silently to raw FROM <table> (Pitfall 3 lock)
    - Retry materialize failure: toast + fall-through to raw FROM <table> (no error state)
    - RecordsTableRenderer pure consumer — proactive only; no reactive retry (VSTORE-V13-02)

key-files:
  created:
    - kinetica_bi/src/lib/kineticaErrors.ts
    - kinetica_bi/src/lib/kineticaErrors.spec.ts
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx

key-decisions:
  - "isViewNotFoundError lives in src/lib/kineticaErrors.ts (not WidgetRenderer.tsx or client.ts) — single-purpose helper matching cardinalityProbe.ts / columnTypes.ts precedent"
  - "retryRef uses useRef<{viewName, retried}> pattern — reset on viewName change so each fresh view gets a fresh retry budget"
  - "Second view-not-found falls through to raw FROM <table> silently — no toast, no error state shown (Pitfall 3 lock enforced)"
  - "RecordsTableRenderer proactive-only (no reactive retry) — pure consumer lock from 15-03 holds; sibling AggregatedWidgetRenderer handles clearView on reactive path"
  - "materializeAbortRef reused for reactive retry materialize controller — consistent abort semantics on rapid filter changes"

requirements-completed: [LIFE-V13-01, LIFE-V13-02]

# Metrics
duration: 5min
completed: 2026-05-07
---

# Phase 15 Plan 04: TTL Recovery (Proactive + Reactive) Summary

**Dual-path Kinetica 5-min TTL recovery wired into both renderers: proactive `expiresAt` check before `runSql` (LIFE-V13-01) + reactive `isViewNotFoundError` max-1-retry recovery in `AggregatedWidgetRenderer` (LIFE-V13-02); `isViewNotFoundError` ships as isolated `kinetica_bi/src/lib/kineticaErrors.ts` helper with 13-case spec**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-07T02:12:35Z
- **Completed:** 2026-05-07T02:17:30Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `kinetica_bi/src/lib/kineticaErrors.ts` created: `isViewNotFoundError(err: unknown): boolean` matches Phase 13 spike S3 verbatim — `/SqlEngine: Object '[^']+' not found/i` substring AND `S/SDc:1513` Kinetica internal code; both required to avoid false positives
- `kinetica_bi/src/lib/kineticaErrors.spec.ts` created: 13 test cases covering positive (verbatim Phase 13 string, wrapping text, case-insensitive regex), negative (missing regex, missing code, generic 400 error, 401 error), and defensive (undefined, null, empty object, non-string message, plain string, duck-typed object)
- `AggregatedWidgetRenderer` extended with (1) `expiresAt` scoped selector, (2) proactive expiry check before `runSql` with `clearView(tableId)` + early return (LIFE-V13-01), (3) `retryRef` max-1-retry tracker, (4) reactive `isViewNotFoundError` catch with silent re-materialize + retry (LIFE-V13-02), (5) Pitfall 3 lock: second view-not-found falls through to raw `FROM <table>`, (6) retry materialize failure: toast + fall-through
- `RecordsTableRenderer` extended with `recordsTableExpiresAt` selector and proactive expiry check in both page-fetch effect and total-count effect; both dep arrays updated; pure consumer lock preserved (no `isViewNotFoundError` catch)
- `WidgetRenderer.spec.tsx` extended with 7 new test cases across 3 describe blocks: `LIFE-V13-01` (Aggregated: 2 tests; Records: 1 test), `LIFE-V13-02` (reactive happy path, max-1-retry Pitfall 3, retry-fails-toast, non-recoverable-error pass-through)
- tsc clean; 308/308 vitest tests pass

## Task Commits

1. **Task 1: kineticaErrors.ts + spec** — `c9820ad` (feat)
2. **Task 2: WidgetRenderer.tsx proactive + reactive wiring** — `5cca1ac` (feat)
3. **Task 3: WidgetRenderer.spec.tsx LIFE-V13-01/02 describes** — `4f52367` (test)

## Files Created/Modified

- `kinetica_bi/src/lib/kineticaErrors.ts` — `isViewNotFoundError` helper (Phase 13 spike S3 pattern)
- `kinetica_bi/src/lib/kineticaErrors.spec.ts` — 13 test cases covering all edge cases
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — AggregatedWidgetRenderer: expiresAt selector + proactive + retryRef + reactive recovery; RecordsTableRenderer: recordsTableExpiresAt selector + proactive in both effects
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — 7 new test cases in LIFE-V13-01 + LIFE-V13-02 describe blocks

## Decisions Made

- **`isViewNotFoundError` in `src/lib/kineticaErrors.ts`.** New single-purpose helper file matching the `cardinalityProbe.ts` / `columnTypes.ts` precedent — testable in isolation; not co-located in `WidgetRenderer.tsx` where it would be harder to unit-test. Open Question 5 recommendation from RESEARCH.md confirmed.
- **`retryRef` pattern for max-1-retry.** Used `useRef<{viewName, retried}>` with reset-on-viewName-change semantics. This gives a fresh retry budget for each new materialized view without needing a separate `useRef<boolean>` or closure variable — the viewName-reset ensures correct behavior across multiple filter changes.
- **Second view-not-found falls through silently.** On `retried === true`, the second view-not-found calls `runChartQuery(fromSwap(sql, undefined))` (raw table) instead of `setError()`. This matches the requirement "no error state shown" — the user sees raw (unfiltered) data briefly until the next filterVersion cycle re-materializes.
- **Retry materialize reuses `materializeAbortRef`.** Consistent abort semantics: a rapid filter change mid-retry-materialize correctly aborts via the same ref that the debounced Effect 1 uses.
- **RecordsTableRenderer proactive-only.** Per VSTORE-V13-02 / pure consumer lock from 15-03: no `isViewNotFoundError` catch added. V13-LIMIT-01 still applies to records-table-only dashboards.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted plan's `runSql`/`materializeFilter` bare references to `clientModule.*` pattern in Task 3 tests**
- **Found during:** Task 3 (test authoring)
- **Issue:** Plan's spec code used `(runSql as ReturnType<typeof vi.fn>)` and `(materializeFilter as ReturnType<typeof vi.fn>)` bare names, but spec file only imports `import * as clientModule from "../../api/client"`. Direct name references would cause runtime ReferenceErrors in the test runner.
- **Fix:** Changed all bare references to `(clientModule.runSql as ReturnType<typeof vi.fn>)` and `(clientModule.materializeFilter as ReturnType<typeof vi.fn>)`. Same pattern as the 15-03 deviation fix.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** All 7 new test cases pass; 308/308 full suite.
- **Committed in:** 4f52367 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 - bug / naming convention adaptation)
**Impact on plan:** No scope change. Mock reference adaptation is semantically identical — same vi.fn() instance.

## Next Phase Readiness

- **15-05 (lifecycle cleanup):** App.tsx + DashboardsPage.tsx lifecycle resets use `useFilterViewStore.getState().views` snapshot + `entry.dashboardId` (FilterViewEntry extension from 15-02). No dependency on 15-04 changes.
- **Phase 17 (UAT):** TTL recovery is silent — Phase 17 manual UAT walks through the proactive + reactive recovery paths against deployed Kinetica (idle 5+ min with active filter → next interaction → verify no error state shown).
- **OIDC-mode DDL probe (S2.b):** Deferred blocker from STATE.md — must be verified before v1.3 milestone close if OIDC users need filtering.

## Self-Check: PASSED
