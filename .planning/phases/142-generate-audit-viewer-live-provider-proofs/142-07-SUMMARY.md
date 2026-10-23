---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 07
subsystem: web
tags: [ai-generate, dashboards, keep, discard]
requires: [142-03]
provides: [GeneratedDashboardBar, take-once generate start, pending-aware Discard/Keep]
affects: [DashboardsPage DashboardOpen, AiChangeBar, AiWidgetRenderer]
key-files:
  created:
    - packages/web/src/components/GeneratedDashboardBar.tsx
    - packages/web/src/components/GeneratedDashboardBar.spec.tsx
    - packages/web/src/components/charts/AiWidgetRenderer.generate.spec.tsx
    - packages/web/src/components/DashboardsPage.generatedOpen.spec.tsx
  modified:
    - packages/web/src/components/AiChangeBar.tsx
    - packages/web/src/components/AiChangeBar.spec.tsx
    - packages/web/src/components/charts/AiWidgetRenderer.tsx
    - packages/web/src/components/DashboardsPage.tsx
decisions:
  - "Take-once intent in an AiWidgetRenderer effect works deterministically under StrictMode; the setDraft fallback was not needed."
metrics:
  tasks: 3
  completed: 2026-10-23
---

# Phase 142 Plan 07: Generated dashboard open flow Summary

Opening a generated dashboard auto-starts its first ask once (take-once intent), shows a pending note with Discard, routes Discard to a server-delete confirm while unkept, and refetches the pending flag after the first Keep.

gaps: []

## Commits
- 151232a: GeneratedDashboardBar (note + portalled discard dialog), AiChangeBar `onDiscardGenerated`
- 7c482af: AiWidgetRenderer consumes `takeGenerateIntent(ctx.dashboardId)` once and calls `runAsk`
- 5c74066: DashboardOpen wiring (`generated_pending` note, `onDiscardGenerated`, Keep refetch via `listDashboards`, `onGeneratedDiscarded` in the open branch), GENOPEN-1..8

## Verification
- Targeted: GeneratedDashboardBar, AiChangeBar, AiDiscardDialog, AiWidgetRenderer(+generate), AiChat, DashboardsPage generatedOpen/keep/aiLeave/aiSession, theme-guard all green; `tsc --noEmit` clean (a transient error from 142-06/08's in-progress AiActivityPage spec appeared mid-run and cleared).
- The 141 stale-layout guard line is still present exactly once; `handleLayoutChange`, `data-grid` children, leave dialog and unmount cleanup untouched.

## Deviations from Plan
- [Process] Red-first was not recorded as a separate run for tasks 1-2 (spec and implementation were written back-to-back, then run green). Specs were still written against the stated behaviors.
- [Rule 3] GENOPEN spec renders `<AiLeaveDialog />` beside DashboardsPage (the leave dialog is hosted outside it) and extends the OL view mock with `getCenter`/`getZoom` (map widget in the six-widget list otherwise logged errors). Dialog buttons are scoped with `within(dialog)` because the bar's Discard stays mounted behind it. After a discard the list is empty, so "list shown" is detected by the "+ New Dashboard" text rather than an Open button.

## Non-discriminating criteria (reported)
- GENOPEN-7 (RGL regression) and the 141-guard grep pass against code this plan does not change; it pins that the generated-widget Keep path cannot regress the guard, it does not prove new behavior. It would only fail if the guard or data-grid were removed.
- Pending-note/dialog legibility and light/dark appearance are not provable here; left to the 142-10 UAT.

## Self-Check: PASSED
Created files exist; commits 151232a and 7c482af present, 5c74066 present.
