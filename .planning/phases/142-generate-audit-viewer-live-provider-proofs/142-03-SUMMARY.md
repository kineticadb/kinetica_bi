---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 03
subsystem: web
tags: [ai-generate, dashboards, client-api]
requires: []
provides: [generateDashboard, discardGeneratedDashboard, DashboardDto.generated_pending, takeGenerateIntent, Generate section in DashboardCreate]
affects: [142-07]
key-files:
  created:
    - packages/web/src/lib/aiSession/generateIntent.ts
    - packages/web/src/lib/aiSession/generateIntent.spec.ts
    - packages/web/src/api/client.generate.spec.ts
    - packages/web/src/components/DashboardsPage.generate.spec.tsx
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/components/DashboardsPage.tsx
requirements: [AIGEN-V20-01]
completed: 2026-10-23
---

# Phase 142 Plan 03: Generate entry point on the New Dashboard form Summary

New Dashboard form gains a "Generate from a table" option (ai:use plus AI enabled), a never-throwing generate/discard client API, and a take-once generate intent that hands the first ask to the opened dashboard.

## Tasks

1. Client API and take-once intent (commit d313930). RED recorded: both specs failed (4 tests) before implementation; green 8/8.
2. Generate section, D-06 pending prompt, "Not kept yet" label (commit see git log, "feat(142-03): Generate from a table..."). RED recorded: 10 of 12 GENFORM tests failed or timed out (1b and 7 are negative or unchanged-behaviour cases that pass before); green 12/12.

## Verification

- tsc clean; GENAPI/GENINT 8/8; GENFORM 12/12; DashboardsPage spec, urlsync, exportimport, keep, aiWidget and theme-guard: 298 passed.
- classNames added in DashboardsPage.tsx are all existing classes: btn-primary, btn-primary btn-sm, ghost-sm ghost-danger, ds-actions, ds-field, ds-field-label, ds-select, ds-name, config-group, config-toggle, muted, error.

## Deviations from Plan

- The acceptance grep `grep -c "Generate from a table" DashboardsPage.tsx` = 1 reads 2, because I added a code comment containing the phrase. Not a behaviour issue; the real requirement (the checkbox label exists once, rendered) is proven by GENFORM-1/2.
- Handlers load `generateDashboard`/`discardGeneratedDashboard` via `await import("../api/client")` (lazy, so specs mocking the client without them are unaffected).
- Open-view marker in GENFORM specs is the "Back" button with the create form gone, plus an `openDashboardUrl(42)` spy assertion (open mode), since the open view has no "Back to dashboards" label.

## Not provable here

Light/dark visual correctness of the new form block: routed to the 142-10 UAT.

gaps: []

## Self-Check: PASSED
