---
phase: 139-session-only-dynamic-views
plan: 09
subsystem: web
tags: [ai, dynamic-view, lifecycle, session-store]
requires: [139-01, 139-08]
provides:
  - aiSessionStore dvNonce/dvGen/dvColumns, bumpDvGen, setDvColumns, appendFollowUps, setAiDvSink
  - lib/aiDv/aiDvLifecycle (trackAiDv, pendingAiDvDrop, installAiDvEffects, dropAllTrackedAiViews)
  - api client materializeAiDynamicView / dropAiDynamicView / listAiDynamicViews
  - value-free snapshot extensions (view base/aggregated/columns, widget columns/sortField, layer dynamicViewId/columns)
affects: [139-11, 139-13, 139-14]
key-files:
  created:
    - packages/web/src/store/aiSessionStore.dv.spec.ts
    - packages/web/src/lib/aiDv/aiDvLifecycle.ts
    - packages/web/src/lib/aiDv/aiDvLifecycle.spec.ts
  modified:
    - packages/web/src/store/aiSessionStore.ts
    - packages/web/src/api/client.ts
    - packages/web/src/hooks/useAiSessionActions.ts
    - packages/web/src/lib/aiSession/buildAskRequest.ts
    - packages/web/src/lib/aiSession/buildAskRequest.spec.ts
key-decisions:
  - "Undo/remove reconcile bumps dvGen then drops under the OLD gen; reset drops all without bump (reset clears gens)"
  - "Pending drop entry is deleted only if it is still the registered promise (a newer drop for the same tempId is not cleared)"
requirements-completed: [AISAFE-V20-06, AIACT-V20-07]
duration: ~25min
completed: 2026-10-20
---

# Phase 139 Plan 09: Client AI view lifecycle Summary

Per-tab nonce and per-view generation in the session store, a dv sink the store calls after fold changes and before reset, a lifecycle module that DROPs views the session no longer has (via keepalive POST), three API client calls, and a spec-free-of-values ask snapshot.

## Commits
- d13d6f9 + 5134bf0: store seam (second commit fixes STOREDV-7 path resolution; first commit's spec had that one test failing)
- 3c352f9: API client + aiDvLifecycle + install in useAiSessionActions
- d518ab6: snapshot extensions

## Verification
- web `tsc --noEmit` clean; `src/store src/lib/aiSession src/lib/aiDv src/lib/aiOps src/hooks` + theme-guard: 52 files / 930 tests green (`--maxWorkers=4`). Full web vitest NOT run (139-14 owns it, per orchestrator).
- Red-first: STOREDV spec ran red (7/7 failing) before implementation. LIFEC and SNAPW specs were written first but NOT run red before implementation (LIFEC imports a module that did not exist so it could only fail at import; SNAPW run only after the builder change). Behaviour is covered by the passing specs.
- Acceptance greps: aiDvSink?.onDerived = 2, onReset = 1, no `from "../api/client"` in store; client exports = 3; `installAiDvEffects()` in the hook = 1.

## Deviations
1. [Process] Task 1 first commit contained a spec whose STOREDV-7 used `new URL(import.meta.url)` (fails under vitest jsdom); fixed in a follow-up commit.
2. [Process] Task 3 plan asks for the full web gate; skipped per orchestrator override (139-14).
3. Non-discriminating criterion: `grep -c "LIFEC-" >= 8` / `STOREDV- >= 7` only count test titles; real behaviour is verified by the specs themselves.
4. LIFEC specs capture the registered sink by wrapping `setAiDvSink` with vi.mock (no probe global), so LIFEC-8 proves the real install path.
5. SNAPW-3 depends on the fixture's map host owning the layer (fixture has an unconfigured map widget); passes.

## Self-Check: PASSED
All created/modified files exist; commits d13d6f9, 5134bf0, 3c352f9, d518ab6 present on feat/ai-driven-dashboards.
