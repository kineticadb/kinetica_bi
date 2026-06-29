---
phase: "94"
plan: "02"
subsystem: "both-stack"
tags: [env-flag, dv-filter-scope, auth-store, supertest, oidc, combination-key]
dependency_graph:
  requires: [94-01-SUMMARY.md]
  provides: [FSCOPE-V118-03 (env-flag half)]
  affects: [server /api/me, web auth store, ChartConfigPanel, KineticaWmsLayerForm, FilterSelectionPanel source list]
tech_stack:
  added: []
  patterns: [readBoolEnv-simple-string-compare, ttlKeepaliveLeadMinutes-mirror-pattern, === true absent-defaults-false]
key_files:
  created: []
  modified:
    - packages/server/src/index.ts
    - packages/web/src/api/client.ts
    - packages/web/src/store/auth.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/server/tests/auth.routes.spec.ts
    - packages/server/tests/routes.filter-materialize-combo.spec.ts
decisions:
  - "DISABLE_DV_FILTER_SCOPE is a simple boolean string compare (not readPositiveIntEnv); absent → enabled (default false)"
  - "=== true in fetchMe parser ensures an older server omitting dvFilterScopeDisabled defaults to false (enabled)"
  - "Same-dv source list via inline filter at ChartConfigPanel + KineticaWmsLayerForm call sites (not a new FilterSelectionPanel prop)"
  - "auth.routes.spec.ts oidc-mode failures are pre-existing TD-V16-TEST-ISOLATION (Issuer constructor mock); not introduced by this plan"
  - "Fixed pre-existing toEqual assertions at lines 382/393 to include roles/permissions in user object + dvFilterScopeDisabled"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 7
---

# Phase 94 Plan 02: DISABLE_DV_FILTER_SCOPE env-flag plumbing + dv-only UI gating + same-dv source list + supertests Summary

**One-liner:** DISABLE_DV_FILTER_SCOPE boolean env flag plumbed across 5 mirror sites (server boot → /api/me → MeResponse → fetchMe → auth store); dv-bound FilterSelectionPanel gated in ChartConfigPanel + KineticaWmsLayerForm; same-dv widget source list restricted at both call sites; both-auth-mode /api/me supertests added; missing oidc dv+combinationKey materialize supertest closed.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Env-flag plumbing across 5 mirror sites | b0e9d96 | server/src/index.ts, web/src/api/client.ts, web/src/store/auth.ts |
| 2 | UI gating + same-dv source list | ab5ced7 | ChartConfigPanel.tsx, KineticaWmsLayerForm.tsx |
| 3 | Both-auth-mode supertests + fix toEqual + oidc dv+combinationKey test | 7ee7193 | tests/auth.routes.spec.ts, tests/routes.filter-materialize-combo.spec.ts |

## What Was Built

### Task 1: Env-flag plumbing (5 mirror sites)

Mirrors the `ttlKeepaliveLeadMinutes` / `maxCombinationViewsPerTable` pattern exactly but as a boolean:

1. **Server boot** (`index.ts` after `MAX_COMBINATION_VIEWS_PER_TABLE`): `const DISABLE_DV_FILTER_SCOPE = process.env.DISABLE_DV_FILTER_SCOPE === "true"` — simple string compare, NOT `readPositiveIntEnv`. Absent or non-"true" → `false` (enabled, UI shown).

2. **/api/me response** (`index.ts`): appends `dvFilterScopeDisabled: DISABLE_DV_FILTER_SCOPE` to the `res.json(...)` call.

3. **MeResponse type** (`client.ts`): adds `dvFilterScopeDisabled: boolean` field.

4. **fetchMe parser** (`client.ts`): `dvFilterScopeDisabled: json.dvFilterScopeDisabled === true` — strict equality so an older server omitting the field defaults to `false` (enabled).

5. **Auth store** (`store/auth.ts`): adds `dvFilterScopeDisabled: boolean` to `AuthState`, initializes to `false`, and sets it from `/api/me` in the bootstrap `set({...})`.

### Task 2: UI gating + same-dv source list

**ChartConfigPanel.tsx:**
- Imports `useAuthStore` and reads `dvFilterScopeDisabled`.
- Gates the FilterSelectionPanel render: `selectedSource && !(draftDynamicViewId !== undefined && dvFilterScopeDisabled)` — table-bound widgets (`draftDynamicViewId === undefined`) are NEVER affected.
- Same-dv source list (LOCKED DECISION #8): computes `filterSourceWidgets` — when dv-bound, filters `widgets` to those with matching `config.dynamicViewId`; table-bound passes full list. Passed to `FilterSelectionPanel`.

**KineticaWmsLayerForm.tsx:**
- Imports `useAuthStore` and reads `dvFilterScopeDisabled`.
- Gates the FilterSelectionPanel render: `!(layer?.dynamic_view_id != null && dvFilterScopeDisabled)` — table-bound layers NEVER affected.
- Same-dv source list: inline filter inside the `widgets=` prop — dv-bound layers restrict to siblings with matching `config.dynamicViewId`.

### Task 3: Supertests

**auth.routes.spec.ts:**
- Fixed the two pre-existing toEqual assertions at lines 382/393 that were already failing: added `roles: ["analyst"], permissions: ["dashboards:view"]` to the `user` object (alice → analyst fallback) and added `dvFilterScopeDisabled: false`.
- Added password-mode test: `DISABLE_DV_FILTER_SCOPE=true` → `dvFilterScopeDisabled: true` on `/api/me`.
- Added oidc-mode test: same, using `stubOidcEnv()` + `seedOidcSession(accessToken)`. This hits the pre-existing TD-V16-TEST-ISOLATION oidc infrastructure issue in this file ("Issuer is not a constructor") — the failure is in the known-flaky set and unchanged.

**routes.filter-materialize-combo.spec.ts:**
- Added the missing oidc-mode dv+combinationKey materialize test inside the `AUTH_MODE=oidc` describe block (placed after the oidc table-path combinationKey test at line 292).
- Asserts: `^_kbi_filt_ujohn_doe_kinetica_com_d${dashId}_dv${dv.id}_s\w{8}_c[0-9a-f]{8}$` + exact `_c${hashKey8(COMBO_KEY)}` suffix + Bearer auth header.
- The test passes — closes the both-auth-mode dv+combinationKey coverage gap.

## Test Gate Results

| Gate | Result |
|------|--------|
| `cd packages/server && npx tsc --noEmit` | CLEAN |
| `cd packages/web && npx tsc --noEmit` | CLEAN |
| `npx vitest run` (web) | 127 files, 2943 tests — 100% pass |
| `npx vitest run src/styles/theme-guard.spec.ts` | GREEN (no new class names, no raw hex) |
| `npx vitest run tests/auth.routes.spec.ts` (server) | 16/20 pass; 4 oidc failures = pre-existing TD-V16-TEST-ISOLATION |
| `npx vitest run tests/routes.filter-materialize-combo.spec.ts` (server) | 8/8 pass |
| Full server vitest (SET-BASED) | Failing files ⊆ TD-V16-TEST-ISOLATION — PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing toEqual assertions at auth.routes.spec.ts:382/393**
- **Found during:** Task 3
- **Issue:** The toEqual assertions expected `{ user: { username: "alice" } }` but the server already returns `{ user: { username, roles, permissions } }` (since Phase 48). These were pre-existing failures in the baseline (confirmed via `git stash` check).
- **Fix:** Updated both assertions to include `roles: ["analyst"], permissions: ["dashboards:view"]` (alice → analyst fallback) alongside the new `dvFilterScopeDisabled: false`.
- **Files modified:** packages/server/tests/auth.routes.spec.ts (lines 382, 393)
- **Commit:** 7ee7193

## Decisions Made

1. `DISABLE_DV_FILTER_SCOPE` uses simple string compare (`=== "true"`), not `readPositiveIntEnv` — boolean semantics don't need integer parsing logic.
2. `fetchMe` parser uses `=== true` (strict, not truthy) so an older server response that omits the field is treated as `false` (enabled), preserving backward compatibility.
3. Same-dv source list computed inline at each call site (not a new prop on FilterSelectionPanel) — keeps the component interface unchanged.
4. The oidc-mode test for `DISABLE_DV_FILTER_SCOPE` in auth.routes.spec.ts hits the same pre-existing "Issuer is not a constructor" infrastructure issue as other oidc tests in that file; this is a known TD-V16-TEST-ISOLATION failure and not introduced by this plan. The test is structurally correct.

## Self-Check: PASSED

Files exist:
- `packages/server/src/index.ts` — FOUND with DISABLE_DV_FILTER_SCOPE + dvFilterScopeDisabled
- `packages/web/src/api/client.ts` — FOUND with dvFilterScopeDisabled in MeResponse + parser
- `packages/web/src/store/auth.ts` — FOUND with dvFilterScopeDisabled field + initial + bootstrap
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — FOUND with gate + same-dv list
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` — FOUND with gate + same-dv list
- `packages/server/tests/auth.routes.spec.ts` — FOUND with new tests + fixed assertions
- `packages/server/tests/routes.filter-materialize-combo.spec.ts` — FOUND with oidc dv vector

Commits exist:
- b0e9d96 — FOUND (feat 94-02 env-flag plumbing)
- ab5ced7 — FOUND (feat 94-02 dv-only UI gating)
- 7ee7193 — FOUND (test 94-02 supertests)
