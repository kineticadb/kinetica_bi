---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 02
subsystem: web-client
tags: [exports, api-client, pure-helpers]
requires: []
provides:
  - typed /api/exports client helpers
  - exportFormat / exportRequest / exportDownload libs
affects: [131-04, 131-05, 131-06, 131-07, 131-08]
key-files:
  created:
    - packages/web/src/lib/exportFormat.ts
    - packages/web/src/lib/exportRequest.ts
    - packages/web/src/lib/exportDownload.ts
    - packages/web/src/api/client.exports.spec.ts
    - packages/web/src/lib/exportFormat.spec.ts
    - packages/web/src/lib/exportRequest.spec.ts
    - packages/web/src/lib/exportDownload.spec.ts
  modified:
    - packages/web/src/api/client.ts
requirements: [EXPRT-V126-05, EXPRT-V126-08, EXPRT-V126-12]
completed: 2026-10-07
---

# Phase 131 Plan 02: Client export foundations Summary

Typed `/api/exports` helpers, import-free formatting helpers, an orchestrator-equivalent request builder, and a preflight-then-navigate download seam.

## Commits
- 6a6af70 Task 1: exportFormat + exportRequest (+ specs)
- 36933c2 Task 2: client.ts export helpers (+ spec)
- f7a2e72 Task 3: exportDownload seam (+ spec)

## Exported signatures (verbatim, as implemented)

lib/exportFormat.ts (no runtime imports):
```ts
export type ExportJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled" | "session_expired";
export const EXPORT_CAP_REMEDY = "Add filters to narrow it down and try again.";
export const formatExportCount: (n: number) => string;
export const formatExportSizeLimit: (mb: number) => string;
export const exportRowCapMessage: (total: number, cap: number) => string;
export const exportLimitsHint: (l: { maxRows: number | null; maxFileMb: number | null; maxConcurrentPerUser: number | null }) => string | null;
export const defaultExportName: (widgetTitle: string | null | undefined, d: Date) => string;
export const exportFileName: (name: string, gzip: boolean) => string;
export const relativeExpiry: (expiresAt: string | null, now?: number) => string;
export const formatExportBytes: (bytes: number | null) => string;
export const parseExportTimestamp: (s: string) => Date;
export const exportStatusLabel: (s: ExportJobStatus) => string;
export const isTerminalExportStatus: (s: ExportJobStatus) => boolean;
export const exportDisplayName: (j: { name: string | null; createdAt: string }) => string;
```

api/client.ts:
```ts
export const NAVIGATE_EXPORTS_EVENT = "kbi:navigate-exports";
export type { ExportJobStatus };
export type ExportJobDto = { id: string; status: ExportJobStatus; widgetId: number | null; dashboardId: number | null; rowsWritten: number; totalRows: number | null; fileBytes: number | null; errorCode: string | null; errorMessage: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; expiresAt: string | null; gzip: boolean; name: string | null; dashboardName: string | null; widgetTitle: string | null };
export type ExportFormat = "raw" | "formatted";
export type ExportStartOptions = { gzip: boolean; format: ExportFormat; name: string };
export type StartExportBody = { widgetId: number; filters: ActiveFilter[]; spatialFilters?: { id: string; wkt: string }[]; spatialTarget?: SpatialTarget; sortField?: string; sortDir?: "asc" | "desc"; options: ExportStartOptions };
export const startExport: (body: StartExportBody) => Promise<ExportJobDto>;
export const getExportJob: (id: string) => Promise<ExportJobDto | null>;      // 404 -> null
export const listExportJobs: () => Promise<ExportJobDto[]>;
export const cancelExportJob: (id: string) => Promise<ExportJobDto | null>;   // 409 -> null
export const deleteExportJob: (id: string) => Promise<void>;                  // 204/404 resolve
export const exportDownloadUrl: (id: string) => string;
export const preflightExportDownload: (id: string) => Promise<{ ok: true } | { ok: false; status: number; message: string }>;
```

lib/exportRequest.ts: `export type ExportRequestInput = { widgetId; config; sortField; sortDir; options; filters; dvFilters; shapes; dashboardWidgets; dvScopeDisabled }; export function buildExportRequest(i: ExportRequestInput): StartExportBody;`

lib/exportDownload.ts: `export const EXPORT_NETWORK_ERROR_MESSAGE; export const __assignLocation: { fn: (url: string) => void }; export async function startExportDownload(id: string): Promise<boolean>;`

## Discrimination probes (all red, then reverted and green)
- P1 unresolved table filters: EXPREQ-scoped red
- P2 drop `&& target`: EXPREQ-spatial-neither red
- P3 table branch before dv branch: EXPREQ-dv red
- P4 local-time parse, run with TZ=America/New_York: EXPFMTC-timestamp red
- P5 assign before ok-check: EXPDL-ok, EXPDL-gone, EXPDL-reauth red

## Gates
web `tsc --noEmit` clean; full `vitest run` 194 files / 4279 tests pass; theme-guard 154 pass; exportFormat spec also green under TZ=America/New_York.

## Deviations from Plan
None in code. Test-only: the toast mock in exportDownload.spec.ts is cast (`as never`) to satisfy tsc against the toast store's signature. Shared docs untouched.

## Self-Check: PASSED
