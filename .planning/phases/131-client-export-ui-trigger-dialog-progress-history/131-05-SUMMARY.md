---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 05
subsystem: web-ui
tags: [exports, zustand, dialog, polling]
requires: [131-02, 131-03]
provides: [exportTracker store, ExportDialog]
affects: [131-07, 131-08]
key-files:
  created:
    - packages/web/src/store/exportTracker.ts
    - packages/web/src/store/exportTracker.spec.ts
    - packages/web/src/components/ExportDialog.tsx
    - packages/web/src/components/ExportDialog.spec.tsx
requirements: [EXPRT-V126-05, EXPRT-V126-06, EXPRT-V126-07, EXPRT-V126-08, EXPRT-V126-09, EXPRT-V126-10]
completed: 2026-10-07
---

# Phase 131 Plan 05: Export tracker and ExportDialog Summary

Module-level 5 s setTimeout-chain export tracker (zustand) plus the form/progress/terminal ExportDialog with an unmount cleanup that keeps the D-11 ready/error toast working.

## Commits
- a27feec Task 1: exportTracker + EXPTRK spec (11 tests)
- 062e61e Task 2: ExportDialog + EXPDLG spec (24 tests)

## Pinned API (verbatim, for Plans 07/08)

store/exportTracker.ts:
```ts
export const EXPORT_POLL_MS = 5000;
export type ExportTrackerState = { jobs: Record<string, ExportJobDto>; dialogJobId: string | null };
export const useExportTrackerStore: UseBoundStore<StoreApi<ExportTrackerState>>;
export function trackExport(dto: ExportJobDto): void;
export function untrackExport(id: string): void;
export function setDialogJob(id: string | null): void;   // null after a terminal job also drops that entry
export function stopAllExportTracking(): void;           // App.tsx must call on logout (Plan 07/08)
```

components/ExportDialog.tsx:
```ts
export type ExportDialogProps = {
  widgetTitle: string; totalCount: number | null; inBrowserCap: number;
  formattedAvailable: boolean; overrideActive: boolean; dvNotReady: boolean;
  buildRequest: (options: ExportStartOptions) => StartExportBody;
  onPartialDownload: () => void; onClose: () => void;
};
export default function ExportDialog(props: ExportDialogProps): JSX.Element;
```
Behavior notes: dialog calls `onClose` for Close/Cancel/Escape/overlay/See all exports/partial download (partial and see-all call close first). "See all exports" dispatches `NAVIGATE_EXPORTS_EVENT` on window after closing. The caller renders the dialog conditionally and unmounts it on `onClose`.

## Probes (all red, then reverted)
- P1 setInterval: EXPTRK-no-overlap, -ready-toast, -dialog-open red
- P2 drop dialogJobId check: EXPTRK-dialog-open red
- P3 drop generation++: initially NOT red (the `jobs[id]` guard covered it); test strengthened (re-track same id before the stale poll resolves), then red
- P4 drop overRowLimit from canStart: EXPDLG-over-limit red
- P5 close without setDialogJob(null): EXPDLG-close-running red
- P6 Download as `<a>`: EXPDLG-complete red
- P7 remove setDialogJob(null) in unmount effect: EXPDLG-unmount-running red
- P8 unconditional clear: EXPDLG-unmount-foreign red

## Gates
web tsc clean; full vitest 198 files / 4342 tests pass; theme-guard 158 pass; check-classnames `OK 21 tokens in 1 files` (0 missing); 0 hex/rgba, 0 `<a `, 0 `/api/exports` in ExportDialog.tsx. No fake-timer leak observed.

## Deviations from Plan
- Prettier was run over the four files (repo uses it); the override note lives in an `OVERRIDE_NOTE` const so the verbatim string stays greppable.
- `rowCapMessage` is a derived const (null unless over limit) to satisfy tsc narrowing; same rendering.
- Not automatable, routed to Plan 131-10 checkpoint: layout, progress bar light/dark, equal button heights, focus ring.

Shared docs (STATE/ROADMAP/REQUIREMENTS) untouched; no gsd-tools mutation run.

## Self-Check: PASSED
