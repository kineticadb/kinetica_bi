---
phase: 141-keep-persist-ai-changes
plan: 04
subsystem: web-store
tags: [ai-session, keep, zustand, filters]
requires: []
provides: [completeKeep, savedTurns, keepBlocked, rekeyDvFilters, keep-copy, AI_KEPT_VIEW_TOGGLES_SOURCE_ID]
affects: [141-10, 141-11, 141-13]
key-files:
  created:
    - packages/web/src/store/aiSessionStore.keep.spec.ts
    - packages/web/src/store/filterStore.rekey.spec.ts
  modified:
    - packages/web/src/lib/aiSession/types.ts
    - packages/web/src/lib/aiSession/constants.ts
    - packages/web/src/lib/aiSession/chatText.ts
    - packages/web/src/store/aiSessionStore.ts
    - packages/web/src/store/filterStore.ts
decisions:
  - completeKeep is deliberately not reset() (D-21), commented in code
  - View toggles survive Keep via a render-time widgetActionStore contribution under AI_KEPT_VIEW_TOGGLES_SOURCE_ID (Number.MIN_SAFE_INTEGER)
metrics:
  tasks: 2
  completed: 2026-10-21
gaps: []
---

# Phase 141 Plan 04: Keep client state Summary

completeKeep/savedTurns/keepBlocked in aiSessionStore, rekeyDvFilters in filterStore, and all Keep copy in AI_CHAT_COPY.

## Commits
- 82aea89: Task 1 (store, types, constants, copy, keep spec)
- 0501722: Task 2, filterStore.rekeyDvFilters + rekey spec (see git log)

## RED evidence
- Task 1: `aiSessionStore.keep.spec.ts` against stubs: 10 failed (10) (KSTORE-1..10). GREEN: 7 files / 86 tests pass.
- Task 2: `filterStore.rekey.spec.ts` against a no-op stub: 4 failed, 1 passed. KREKEY-2 (no change, no tick) passes against a no-op stub by nature; it guards the no-bump rule and is not a discriminating RED. GREEN: 3 files / 47 tests pass.
- `npx tsc --noEmit` clean after each task.

## Acceptance greps (all introduced by this work)
completeKeep=4, savedTurns=4, "141 D-21"=1, AI_KEPT_VIEW_TOGGLES_SOURCE_ID=4 in aiSessionStore.ts; "Filters are not saved."=1, "Keep them first"=1, keepSoon=1 (kept), "View on/off changes are not saved."=1 in chatText.ts. `discardAiSession|aiFilterSink?.onCursorMove` count in aiSessionStore.ts: 1 before, 1 after (completeKeep adds neither).

## Deviations from Plan
None. No existing spec enumerated store state keys, so none needed edits.

## Self-Check: PASSED
