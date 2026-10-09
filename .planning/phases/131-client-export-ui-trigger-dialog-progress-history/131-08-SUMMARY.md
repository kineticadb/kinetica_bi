---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 08
subsystem: web-shell
tags: [exports, sidebar, app-shell, navigation]
requires: [131-02, 131-05, 131-06]
provides: [Exports sidebar item, "exports" page in App, logout stops export polling]
key-files:
  modified:
    - packages/web/src/components/Sidebar.tsx
    - packages/web/src/components/Sidebar.spec.tsx
    - packages/web/src/App.tsx
    - packages/web/src/App.spec.tsx
requirements: [EXPRT-V126-12, EXPRT-V126-07]
completed: 2026-10-07
---

# Phase 131 Plan 08: Sidebar Exports item + App wiring Summary

Exports is a first-class page: sidebar item (faDownload, after Datasets, no permission), `"exports"` in the Page union / render branch / ReturnTo whitelist, a `NAVIGATE_EXPORTS_EVENT` window listener, and `stopAllExportTracking()` in the unauthenticated cleanup block.

## Commits
- a3bb129 Task 1: Sidebar Exports item + EXPNAV-* specs
- 1ea8ca7 Task 2: App wiring + EXPAPP-* specs

## Probes (red, then reverted to green)
- P1 drop `parsed.page === "exports"` line: EXPAPP-returnto red
- P2 drop `stopAllExportTracking()`: EXPAPP-logout red

## Gates
web tsc clean; theme-guard 158 pass; full vitest green on re-run (4350 tests). The first full run showed 2 failures in 1 file while 131-07 was editing WidgetRenderer in the same tree; the re-run had zero failures. Not investigated further.

## Deviations
None. No fixed nav-item count assertion existed in Sidebar.spec, so no count ripple. Shared docs untouched.

## Self-Check: PASSED
