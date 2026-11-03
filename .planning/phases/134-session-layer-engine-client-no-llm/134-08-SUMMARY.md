---
phase: 134-session-layer-engine-client-no-llm
plan: 08
subsystem: web/DashboardsPage
tags: [session-layer, leave-guard, popstate, beforeunload]
requires: [134-06, 134-07]
provides: [Back / browser Back / reload warn when AI changes are unsaved]
key-files:
  created:
    - packages/web/src/components/DashboardsPage.aiLeave.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
requirements: [AISES-V20-07]
completed: 2026-10-12
---

# Phase 134 Plan 08: Dashboard leave guard Summary

Both DashboardOpen Back buttons go through `requestLeave(onBack)`, dirty browser Back re-pushes `?dashboard=<id>` and asks, and a StrictMode-symmetric `beforeunload` effect (keyed on `selectHasUnsavedAiChanges`) cancels reload/tab close only while dirty.

## Commits
- cc5ff6f test: AILEAVE-1..7 (red: 2/3/4/6/7; green controls: 1, 5)
- 3a0477e feat: wiring

## Red/green record
Before: AILEAVE-1, -5 GREEN (positive controls); AILEAVE-2, -3, -4 (no dialog), -6 (defaultPrevented false), -7 (live listeners 0, expected 1) RED, each for the intended reason. After: 7/7 green; DashboardsPage aiLeave/urlsync/aiLock/aiSession/spec 5 files / 124 tests green; tsc clean; theme-guard 160 green; full web suite 212 files / 4525 tests pass, 1 skipped, no timeouts.

## Popstate variant shipped
The PRIMARY re-push design shipped (not the fallback): with `view.mode === "open"`, URL without `?dashboard`, and unsaved AI changes, the handler calls `openDashboardUrl(id)`, then `requestLeave(...)`. AILEAVE-4 passes in jsdom: the URL contains `dashboard=1` again, dialog shown, Discard returns to the list with the session cleared. The effect deps changed from `view.mode` to `view`. Confidence remains MEDIUM for real browsers (jsdom does not model real history traversal/stack depth, e.g. repeated Back presses can accumulate pushed entries); 134-09 must check browser Back by hand: Back with unsaved changes keeps the dashboard + URL + dialog, Stay then Back again re-prompts, Discard lands on the list URL with no stray entries.

## Acceptance
- Pre-checks were 0 (AILEAVE-, requestLeave(onBack), beforeunload). After: `grep -c "requestLeave(onBack)"` = 2 (wrapper is `onClick={() => requestLeave(onBack)}`); add/removeEventListener("beforeunload") = 1 each.
- AILEAVE-7 (spy-counted adds minus removes under StrictMode) is the discriminating check, not the greps.

## Deviations / notes
- None to the design. The `useWidgetActionStore.getState().reset?.()` in spec beforeEach is a defensive optional call; AILEAVE-3's "no key 0 in contributions" assertion is weak (the AI session never creates contributions in that spec), so it is cheap but not strongly discriminating.
- The AILEAVE-2/3 red failure mode was a 5 s timeout waiting for the dialog rather than a crisp assertion (expected for findBy on absent dialog).
- Not automatically verifiable: real-browser Back behaviour and the native beforeunload prompt (route to 134-09 human check).

## Self-Check: PASSED
