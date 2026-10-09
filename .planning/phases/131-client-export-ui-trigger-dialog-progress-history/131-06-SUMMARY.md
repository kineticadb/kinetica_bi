---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 06
subsystem: web-ui
tags: [exports, page, polling-hook]
requires: [131-02, 131-03]
provides: [useExportsList, ExportsPage]
affects: [131-08]
key-files:
  created:
    - packages/web/src/hooks/useExportsList.ts
    - packages/web/src/hooks/useExportsList.spec.ts
    - packages/web/src/components/ExportsPage.tsx
    - packages/web/src/components/ExportsPage.spec.tsx
requirements: [EXPRT-V126-12, EXPRT-V126-07, EXPRT-V126-06]
completed: 2026-10-07
---

# Phase 131 Plan 06: useExportsList hook + ExportsPage Summary

Exports page (DatasetsPage-style table) over a setTimeout-chain polling hook that runs only while a non-terminal row exists and never flashes loading.

## Pinned API (for Plan 08)

ExportsPage: `components/ExportsPage.tsx`, `export default ExportsPage` -- a `const ExportsPage = () => JSX`, **no props**. Mount it directly (e.g. `import ExportsPage from "./components/ExportsPage"`). Renders its own `ChartCard` title "Exports" inside `.dashboard-list`.

Hook (`hooks/useExportsList.ts`):
```ts
export const EXPORTS_LIST_POLL_MS = 5000;
export type ExportsListError = { kind: "permission" | "other"; message: string };
export function useExportsList(): { jobs: ExportJobDto[]; loading: boolean; error: ExportsListError | null; reload: () => void; replaceJob: (dto: ExportJobDto) => void; removeJob: (id: string) => void };
```
Page mounts load on mount; a freshly-mounted page always refetches (no cache), so nav re-entry shows current state.

## Commits
- 5acf55e Task 1: useExportsList + spec (10 EXPLIST tests)
- 8987af8 Task 2: ExportsPage + spec (14 EXPPAGE tests)

## Probes (red, then reverted to green)
- P1 always schedule: EXPLIST-poll-idle, poll-stops, mutators red
- P2 setLoading(true) every load: initially NOT red (the original assertion read result.current before React rendered). Test strengthened (deferred in-flight poll, assert loading false mid-flight + render history); then red. Code untouched.
- P3 skip window.confirm: EXPPAGE-delete red
- P4 Cancel not shown for running: EXPPAGE-actions + EXPPAGE-cancel red (probe inverted: running rows lost Cancel)
- P5 `new Date(createdAt)` under TZ=America/New_York: EXPPAGE-size-started-expires red

## Gates
web tsc clean; full vitest 197 files / 4318 tests pass (no leak observed); theme-guard 158 pass; spec also green under TZ=America/New_York; check-classnames: `OK 13 tokens in 1 files` (0 missing); 0 hex/rgba, 0 `<a `, 0 `/api/exports` in ExportsPage.tsx.

## Not automatable (Plan 131-10 checkpoint)
Column alignment at 1280 px, light/dark status colours, Download/Delete equal height.

## Deviations
None in code. Spec choice: real hook rendered with api/client + lib/exportDownload mocked. Shared docs untouched.

## Self-Check: PASSED
