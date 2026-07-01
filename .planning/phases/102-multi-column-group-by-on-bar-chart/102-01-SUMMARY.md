---
phase: 102-multi-column-group-by-on-bar-chart
plan: "01"
subsystem: bar-chart-group-by
tags: [env-var, auth-store, pivot-helper, tdd, both-stack]
dependency_graph:
  requires: []
  provides: [maxBarGroupBySeriesCap-env-chain, barGroupedSeries-pivot-helper]
  affects: [102-02-config-panel, 102-03-renderer]
tech_stack:
  added: []
  patterns:
    - readPositiveIntEnv boot const (mirrors MAX_COMBINATION_VIEWS_PER_TABLE Phase 90 pattern)
    - MeResponse/fetchMe defensive coalesce (mirrors dvFilterScopeDisabled Phase 94 pattern)
    - Pure unit-tested lib helper (mirrors groupedSeries.ts Phase 72 pattern)
key_files:
  created:
    - packages/web/src/lib/barGroupedSeries.ts
    - packages/web/src/lib/barGroupedSeries.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/tests/auth.routes.spec.ts
    - packages/web/src/api/client.ts
    - packages/web/src/store/auth.ts
decisions:
  - "BAR_SERIES_SEPARATOR = ' / ' compound key — ' / ' collision is an accepted known edge-case (Pitfall 3 RESEARCH.md), not engineered around"
  - "isMultiColumnBarGroupBy guards length >= 2 — single-column falls through to legacy bar path (BARGRP-V119-04 backward-compat)"
  - "maxBarGroupBySeriesCap default 12 — matches MAX_SERIES in groupedSeries.ts and web auth-store initial value"
metrics:
  duration: "~8 minutes"
  tasks_completed: 3
  files_changed: 6
  completed_date: "2026-07-01"
---

# Phase 102 Plan 01: BOTH-Stack Foundation — Env Chain + Pivot Helper Summary

One-liner: `MAX_BAR_GROUP_BY_SERIES` env-var plumbed server-boot → `/api/auth/me` → `MeResponse`/`fetchMe` → `useAuthStore.maxBarGroupBySeriesCap` (default 12), plus a pure `barGroupedSeries.ts` helper that maps flat multi-column SQL rows to `{ bucket, series, value }` pivot input via `" / "` compound series key, unit-proven to compose with the existing `groupedSeries.ts` `selectTopSeries`/`pivotSeriesRows`.

## Objective

Build the BOTH-stack foundation for Phase 102: the deploy-time series cap env var plumbed from server boot through the auth chain, and a pure unit-tested pivot helper that maps flat multi-column bar-chart SQL rows into the shape that Plans 02 (config panel) and 03 (renderer) consume.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Server env var + /api/auth/me field + dual-auth supertests | 02eec86 | packages/server/src/index.ts, packages/server/tests/auth.routes.spec.ts |
| 2 | Web MeResponse + fetchMe coalesce + auth store field | 8dcbc83 | packages/web/src/api/client.ts, packages/web/src/store/auth.ts |
| 3 | Pure barGroupedSeries pivot helper + unit spec (TDD) | 4896926 (RED), 2b14348 (GREEN) | packages/web/src/lib/barGroupedSeries.ts, packages/web/src/lib/barGroupedSeries.spec.ts |

## Implementation Details

### Task 1: Server env var chain
- Added `const MAX_BAR_GROUP_BY_SERIES = readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12)` immediately after `MAX_COMBINATION_VIEWS_PER_TABLE` in `index.ts` — same comment style, same fallback+warn pattern
- Appended `maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES` to the existing `/api/auth/me` `res.json()` call — the ONLY server payload change in Phase 102
- Updated BOTH `toEqual` assertions in `auth.routes.spec.ts` (password + oidc modes) to include `maxBarGroupBySeriesCap: 12`

### Task 2: Web auth chain
- Extended `MeResponse` type with `maxBarGroupBySeriesCap: number`
- Added defensive coalesce in `fetchMe`: `typeof json.maxBarGroupBySeriesCap === "number" ? json.maxBarGroupBySeriesCap : 12` (mirrors the `maxCombinationViewsPerTable` line exactly)
- Added field to `AuthState` type (with Phase 102 comment), initial state (`12`), and bootstrap `set({...})` call in `auth.ts`

### Task 3: Pure barGroupedSeries helper (TDD)
- RED: wrote `barGroupedSeries.spec.ts` with 11 tests across 5 behavior cases before any implementation
- GREEN: created `barGroupedSeries.ts` with `BAR_SERIES_SEPARATOR = " / "`, `isMultiColumnBarGroupBy`, and `toBarPivotInput`
- The helper is a pure module — zero React/Recharts/Zustand imports (mirrors groupedSeries.ts purity contract)
- Test 5 imports the real `selectTopSeries` + `pivotSeriesRows` to prove the shapes compose

## Verification Results

- `cd packages/server && npx tsc --noEmit` — CLEAN
- `cd packages/web && npx tsc --noEmit` — CLEAN
- `npx vitest run src/lib/barGroupedSeries.spec.ts` — 11/11 PASSED
- `npx vitest run src/store` — 295/295 PASSED
- `npx vitest run` (full web) — 3163/3163 PASSED (138 test files)
- `npx vitest run src/styles/theme-guard.spec.ts` — 136/136 PASSED
- `git diff --stat packages/server/src` — ONLY `index.ts` changed (6 lines: env const + res.json field)
- Server `auth.routes.spec.ts`: pre-existing 5 failures confirmed identical before/after changes (TD-V16-TEST-ISOLATION: OIDC `Issuer is not a constructor` + dev .env leaking `DISABLE_DV_FILTER_SCOPE=true` + `MAX_COMBINATION_VIEWS_PER_TABLE=2` into the strict `toEqual` tests); no new failures introduced

## Deviations from Plan

None — plan executed exactly as written. The barGroupedSeries.ts implementation matches the plan's provided code verbatim with added JSDoc comments.

## Self-Check: PASSED

- [x] `packages/web/src/lib/barGroupedSeries.ts` — EXISTS
- [x] `packages/web/src/lib/barGroupedSeries.spec.ts` — EXISTS
- [x] Commit `02eec86` — EXISTS (server env var + tests)
- [x] Commit `8dcbc83` — EXISTS (web auth chain)
- [x] Commit `4896926` — EXISTS (RED spec)
- [x] Commit `2b14348` — EXISTS (GREEN implementation)
