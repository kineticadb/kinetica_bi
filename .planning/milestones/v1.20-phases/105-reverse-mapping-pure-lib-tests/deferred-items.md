# Deferred Items — Phase 105

## Pre-existing web vitest unhandled-rejection exit-1 (out of scope for 105-01)

**Found during:** Task 2 verification (`cd packages/web && npx vitest run`).

**Symptom:** `npx vitest run` reports `Test Files 142 passed (142)` / `Tests 3247 passed (3247)` (100% of individual tests pass) but the process exits with code 1 because of 2 "Unhandled Rejection" errors:
- `ReauthRequiredError: Authentication required` thrown from `columnDisplayConfigStore.ts:112` (`loadConfig` → `listColumnDisplayConfig` in `src/api/client.ts:1585`), surfacing during `src/components/charts/InfoPopup.spec.tsx`.
- A `useDashboardContext must be used inside DashboardContext.Provider` render error surfacing during `src/components/DashboardContext.spec.tsx`.

**Verified pre-existing / out of scope:** Confirmed via A/B run — the identical 2 unhandled errors and identical exit code 1 occur when `computeReverseFilterMap.spec.ts` is excluded from the run (`npx vitest run --exclude "**/computeReverseFilterMap.spec.ts"` → `141 passed (141)` files, `3229 passed (3229)` tests, same 2 errors, exit 1). Phase 105-01 touches only `packages/web/src/lib/computeReverseFilterMap.ts` + its colocated spec — neither file is imported by, nor imports, `InfoPopup.spec.tsx`, `DashboardContext.spec.tsx`, or `columnDisplayConfigStore.ts`. This is pre-existing cross-file/cross-mode test-isolation noise (same family of issue as server-side `TD-V16-TEST-ISOLATION`), not caused by this plan's changes.

**Action taken:** Not fixed (out of scope per SCOPE BOUNDARY — only auto-fix issues directly caused by the current task's changes). Logged here for a future phase/verifier to pick up if a web-side test-isolation tech-debt item needs to be opened.

**Files:** `packages/web/src/components/charts/InfoPopup.spec.tsx`, `packages/web/src/components/DashboardContext.spec.tsx`, `packages/web/src/store/columnDisplayConfigStore.ts` — none modified by 105-01.
