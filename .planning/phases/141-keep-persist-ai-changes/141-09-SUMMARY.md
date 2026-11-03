---
phase: 141-keep-persist-ai-changes
plan: 09
subsystem: web-client
tags: [keep, version-store, apiFetch, 409]
requires: [141-01]
provides: [useDashboardVersionStore, keepAiChanges, apiFetch version header capture]
affects: [141-13]
key-files:
  created:
    - packages/web/src/store/dashboardVersionStore.ts
    - packages/web/src/store/dashboardVersionStore.spec.ts
    - packages/web/src/api/client.aiKeep.spec.ts
  modified:
    - packages/web/src/api/client.ts
requirements-completed: []
gaps: []
duration: ~15min
completed: 2026-10-21
---

# Phase 141 Plan 09: Client version store and keepAiChanges Summary

Per-tab dashboard version store (min of four list reads, advanced along a contiguous own-write chain) fed by header capture in apiFetch, plus a never-throwing, never-retrying `keepAiChanges` mapping to ok/conflict/permission/invalid/failed.

## Commits
- ed05bf9 feat(141-09): dashboardVersionStore
- baa6f38 feat(141-09): apiFetch version header capture and keepAiChanges

## RED evidence
- Task 1 (stub store): `7 failed | 1 passed` (KVS-2..8 red, KVS-1 trivially green).
- Task 2 (capture call removed, keepAiChanges stubbed to "failed"): `Tests 6 failed | 1 passed (7)` (KCL-1, 3, 4, 5, 6, 7/8 red; KCL-2 green as tolerance case).

## Verification
- KVS 8/8, KCL 7 tests (covers KCL-1..8), `src/api` + store spec: 8 files / 120 tests green, `tsc --noEmit` clean.
- Acceptance greps: `export const keepAiChanges`=1 in client.ts; store has no `api/client` import.

## Deviations from Plan
- Process: in task 2 I wrote the implementation before the spec, then captured RED by temporarily neutering client.ts (capture call removed, keepAiChanges stubbed), then restored the real code. RED is genuine but not strictly first-written.
- KCL-1..8 were consolidated into 7 `it` blocks (KCL-7 and KCL-8 share one). Each title carries its `KCL-` id.

## Notes for downstream
- Browser cross-origin: custom response headers are only readable if the server sets CORS `exposedHeaders` (packages/server/src/index.ts has none today; 141-05 plan mentions it). If that is not landed, header capture is a silent no-op in dev (Vite :5173 -> API :4000) and baseline stays undefined. Worth verifying at UAT.
- Plain-object fetch mocks without `headers.get` are tolerated; existing client specs pass unchanged.

## Self-Check: PASSED
