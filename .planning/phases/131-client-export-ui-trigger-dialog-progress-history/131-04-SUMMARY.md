---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 04
subsystem: server-export
tags: [exports, route, dto, content-disposition]
requires: [131-01, 131-02]
provides:
  - exportName.ts (sanitizeExportName, exportFileBase)
  - DTO name/dashboardName/widgetTitle
  - POST /api/exports options.name + format "formatted"
affects: [131-05, 131-06]
key-files:
  created:
    - packages/server/src/lib/exportName.ts
    - packages/server/tests/lib.exportName.spec.ts
    - packages/server/tests/lib.exportCaps.clientParity.spec.ts
  modified:
    - packages/server/src/lib/exportJobAccess.ts
    - packages/server/src/exportRoutes.ts
    - packages/server/tests/lib.exportJobAccess.spec.ts
    - packages/server/tests/routes.exports.spec.ts
    - packages/server/tests/routes.exports.download.spec.ts
requirements: [EXPRT-V126-08, EXPRT-V126-09, EXPRT-V126-12]
completed: 2026-10-07
---

# Phase 131 Plan 04: Server name + formatted route + DTO Summary

The name is stored sanitised in options_json (no schema change), served as a filesystem-safe Content-Disposition (non-ASCII intact via filename*), and the DTO carries name/dashboardName/widgetTitle.

## Pinned signatures

```typescript
// packages/server/src/lib/exportName.ts
export const EXPORT_NAME_MAX = 200;
export const EXPORT_FILE_BASE_MAX = 150;
export function sanitizeExportName(raw: unknown): string | undefined;
export function exportFileBase(name: string | null | undefined): string | undefined;
// packages/server/src/lib/exportJobAccess.ts
export type ExportJobDto = { id; status; widgetId; dashboardId; rowsWritten; totalRows; fileBytes; errorCode; errorMessage; createdAt; startedAt; finishedAt; expiresAt; gzip: boolean;
  name: string | null; dashboardName: string | null; widgetTitle: string | null };  // 17 keys
export const exportDownloadName: (job: Pick<ExportJob,"id"|"createdAt"|"filePath"> & { optionsJson?: string | null }) => string;
```

Route errors (400, code invalid_export_request): `options.format must be "raw" or "formatted".`, `options.name must be a string.`. Blank name after sanitising is not stored; long names are truncated, never rejected.

## Commits
- 1d2ad62: Task 1 exportName + DTO/name seam
- 561a300: Task 2 route + download + parity specs

## Probes (all red, then reverted to green)
- P1 remove `/` from RESERVED: EXPNAME-file-unicode, EXPNAME-file-reserved, EXPACC131-download-name red
- P2 drop BIDI replace in exportFileBase: EXPNAME-file-empty red
- P3 add optionsJson to DTO: EXPACC131-dto-keys red
- P4 reject "formatted" in route check: EXPRT131-format-formatted red
- P5 reword web exportRowCapMessage: EXPCAPPAR-row-cap red (web file restored)

## Gates
Server tsc clean; the 4 touched route/lib specs 67/67; `npm run test:gate`: GATE PASSED (routes.dashboard-export.spec.ts contamination-only, passes alone).

## Deviations
None. Shared docs untouched. db.ts and db.exportJobs.spec.ts unchanged (no schema change).

## Self-Check: PASSED
