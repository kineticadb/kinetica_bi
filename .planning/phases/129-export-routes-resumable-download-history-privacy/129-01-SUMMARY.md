---
phase: 129-export-routes-resumable-download-history-privacy
plan: 01
subsystem: server/exports
tags: [exports, ownership, privacy, dto]
requires: [phase-128 export runner and export_jobs registry]
provides: [deleteExportJob, case-insensitive listExportJobsForUser, exportFilePaths, exportJobAccess module]
affects: [129-02, 129-03]
key-files:
  created:
    - packages/server/src/lib/exportJobAccess.ts
    - packages/server/tests/lib.exportJobAccess.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/lib/exportRunner.ts
    - packages/server/tests/db.exportJobs.spec.ts
decisions:
  - Stored username is not lowercased on insert (dv view-name derivation needs it as typed); matching is case-insensitive at read time.
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 129 Plan 01: Export access seam Summary

Data and access seam for the /api/exports routes: db delete helper, case-insensitive per-user list, exported `exportFilePaths`, and one module deciding ownership, client DTO, download name and servable file.

## Commits
- ca1c75c: db.ts / exportRunner.ts changes + EXPDB129- specs (5)
- 39fe5d3: exportJobAccess.ts + EXPACC129- specs (15)

## Pinned signatures (exportJobAccess.ts)
```typescript
export const EXPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sameExportOwner = (a: string, b: string): boolean
export const findOwnedExportJob = (id: string, username: string): ExportJob | undefined
export type ExportJobDto = {
  id: string; status: ExportJob["status"]; widgetId: number | null; dashboardId: number | null;
  rowsWritten: number; totalRows: number | null; fileBytes: number | null;
  errorCode: string | null; errorMessage: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; gzip: boolean;
};
export const toExportJobDto = (job: ExportJob): ExportJobDto
export const exportDownloadName = (job: Pick<ExportJob, "id" | "createdAt" | "filePath">): string
export const resolveServableExportFile = (job: Pick<ExportJob, "id" | "filePath" | "fileBytes">): { path: string; size: number } | null
```
Other: `deleteExportJob(id: string): boolean` (db.ts), `exportFilePaths(jobId: string): string[]` (exportRunner.ts). `resolveServableExportFile` does not check status; the route must.

## Discrimination probes (all red with mutation, green after revert)
- Task 1: `username = ?` SQL -> EXPDB129-list-case-insensitive and EXPDB129-list-stored-case red; restored -> 15/15 green.
- (a) sameExportOwner body `true` -> EXPACC129-not-owner red.
- (b) DTO with `...job` spread -> EXPACC129-dto-keys red.
- (c) basename-equals-id rule removed -> EXPACC129-servable-foreign (and servable-part) red.
- (d) size-equality rule removed -> EXPACC129-servable-size red.

## Deviations from Plan
None - plan executed as written.

## Verification
- tsc --noEmit clean; db.exportJobs, exportRunner (cancel, main), exportJobAccess specs green.
- `npm run test:gate`: PASSED (routes.management.spec.ts failed in the full run but passes alone: known contamination).
- Shared docs untouched; no requirement marked complete.

## Self-Check: PASSED
