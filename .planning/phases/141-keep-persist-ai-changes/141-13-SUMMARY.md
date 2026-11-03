---
phase: 141-keep-persist-ai-changes
plan: 13
subsystem: web
tags: [keep, ai-session, dashboards-page, dialogs]
requires: [141-01, 141-04, 141-08, 141-09, 141-10, 141-11, 141-12]
provides: [runKeep, runReloadLatest, rectsFromLayouts, AiChangeBar Keep states, DashboardsPage Keep wiring]
key-files:
  created:
    - packages/web/src/lib/aiSession/keepRunner.ts
    - packages/web/src/lib/aiSession/keepRunner.spec.ts
    - packages/web/src/components/DashboardsPage.keep.spec.tsx
  modified:
    - packages/web/src/hooks/useDynamicViewMaterializeChain.ts
    - packages/web/src/components/AiChangeBar.tsx
    - packages/web/src/components/AiChangeBar.spec.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/lib/aiSession/chatText.ts
requirements: [AISES-V20-05, AISES-V20-06]
gaps: []
completed: 2026-10-21
---

# Phase 141 Plan 13: Keep client wiring Summary

Keep works end to end on the client. A React-free `runKeep` runs the flow: baseline, build payload, POST, clear version, refetch four lists, then one synchronous swap (applyLists, dvFilters re-key, completeKeep last). `AiChangeBar` shows Keep to raw `dashboards:edit` holders only. `DashboardsPage` supplies the refetch/swap glue.

## Commits
- eb4c1e8: keepRunner + spec (Task 1)
- 458372d: dv-chain `setSavedDynamicViews` (Task 1; missed in the first commit because a failed `sed` aborted my `&&` chain, caught by a grep and committed separately)
- 0b3fa0f: AiChangeBar Keep states, BAR7-4 edit, KBAR-1..10, keepSoon removed (Task 2)
- 4491052: DashboardsPage wiring, KRUN-10, DashboardsPage.keep.spec KPAGE-1..3 (Task 3)

## RED evidence
- Task 1: `keepRunner.spec.ts` against a stub returning `{kind:"error",message:""}`: `Tests 13 failed (13)`. GREEN: 13/13; `src/hooks` 11 files / 176 tests.
- Task 2: `AiChangeBar.spec.tsx` before the component change: `Tests 12 failed | 9 passed (21)` (edited BAR7-4 plus KBAR-1..10 incl. 7b; the 9 passing are the untouched BAR cases). GREEN: AiChangeBar + AiKeepDialogs + theme-guard 202/202.
- Task 3: `DashboardsPage.keep.spec.tsx` before wiring: `Tests 3 failed (3)`. The real cause was Keep rendered `disabled` because no `onKeep` was passed (testing-library role dump showed Keep disabled), so Save was never reachable. `KRUN-10` before `rectsFromLayouts` existed: `1 failed` (`rectsFromLayouts is not a function`). GREEN: 17/17.
- Note: `rectsFromLayouts` was briefly written in Task 1 and removed before the Task 1 commit so Task 3 got a real RED.

## Gates (run alone, sequentially)
- `npx tsc --noEmit` clean.
- `npx vitest run src/components/DashboardsPage --maxWorkers=4`: 11 files / 178 tests pass (no existing DashboardsPage spec edited).
- Full web suite `npx vitest run --maxWorkers=4`: 261 files passed, 1 skipped; 5047 tests passed, 1 skipped. No failures, no fake-timer leak observed.
- `theme-guard.spec.ts`: 176 passed.
- Greps (introduced by this work): `grep -rn keepSoon packages/web/src` = 0; `PERMISSIONS.DASHBOARDS_EDIT` in AiChangeBar = 1; `viewTogglesNotSaved=` = 1; hex in AiChangeBar = 0 (invariant, cannot fail first); `onKeep={onKeep}` = 1, `onReloadLatest={onReloadLatest}` = 1, `keep: (id, body) => keepAiChanges(id, body)` = 1 in DashboardsPage.

## Carry-forwards handled
- 141-08: `buildKeepPayload` throwing (no rect / incomplete layout) is caught in `runKeep` and mapped to the D-12 `KEEP_FAILED_MESSAGE` (KRUN-7).
- 141-12: `response.warnings` go to `completeKeep({ warnings })`, so they appear as muted chat notes (KRUN-2: "Changes saved." then "W"). The version header is handled by apiFetch capture (141-09); `runKeep` clears the stale baseline before refetch so the list reads re-seed it.
- 139 issue-1: no dv-to-table-combo binding changes were made.

## Decisions
- `runReloadLatest` swallows a reload failure after the discard (baseline stays cleared, so Keep refuses until the page is reloaded) rather than leaving an unhandled rejection from the bar's `void onReloadLatest()`.
- Disabled-title precedence on Keep: busy, nothing-to-save, conflict-blocked, committed-blocked.

## Deviations from Plan
1. **[Process] chain-hook change committed separately** (458372d) because a failed `sed &&` skipped the edit. No code impact.
2. **[Test shape] KBAR-7 split into KBAR-7 and KBAR-7b** (Stay path vs "Discard and reload the latest" path), since after Stay the Keep button is correctly disabled and the dialog cannot be reopened in the same render. Both behaviours from the plan are asserted.
3. **[Criterion note] `grep -c "KBAR-" AiChangeBar.spec.tsx >= 10`** holds (11 titles); `grep -c "AiKeepDialog\|KBAR-"` pre-check was 0 as claimed. No non-discriminating criteria found, except invariants already labelled (no-hex grep).
- No Rule 1-3 fixes were needed.

## Not auto-verifiable (routed to 141-14)
No visual flash during the swap; reload in a real browser shows the saved result; tiles on both buildWmsParams sites after Keep; dialog/bar legibility in light and dark; CORS `exposedHeaders` for the version header in dev (flagged by 141-09).

## Self-Check: PASSED
Files exist (keepRunner.ts/spec, DashboardsPage.keep.spec.tsx), commits eb4c1e8, 458372d, 0b3fa0f, 4491052 present.
