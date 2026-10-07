---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
plan: 01
subsystem: server/export
tags: [export, caps, ttl, env, sqlite]
requires: []
provides:
  - lib/exportCaps.ts (env knobs, messages, cap errors, getExportLimits)
  - db helpers: countActiveExportJobsForUser, listActiveExportJobs, listExpiredExportJobs, listCompleteExportFilePaths
  - exportRunner.isExportRunLive
  - exportJobAccess.exportExpiresAt / isExportExpired / DTO expiresAt
affects: [130-02, 130-03, 130-04]
key-files:
  created: [packages/server/src/lib/exportCaps.ts, packages/server/tests/lib.exportCaps.spec.ts]
  modified: [packages/server/src/db.ts, packages/server/src/lib/exportRunner.ts, packages/server/src/lib/exportJobAccess.ts, packages/server/tests/setup.ts, packages/server/.env.example, packages/server/tests/db.exportJobs.spec.ts, packages/server/tests/lib.exportJobAccess.spec.ts]
decisions:
  - "Expiry computed (finished_at + TTL), no schema change"
metrics:
  tasks: 3
  completed: 2026-10-07
---

# Phase 130 Plan 01: Export caps/TTL foundations Summary

Foundations for Phase 130: env knobs + exact cap messages + typed cap errors in one module, four db read helpers, `isExportRunLive`, and a computed `expiresAt` on the export DTO.

## Pinned signatures (verbatim)

```typescript
// packages/server/src/lib/exportCaps.ts (imports nothing from runner/access/cleanup)
export const EXPORT_DEFAULT_TTL_HOURS = 24;
export const EXPORT_DEFAULT_MAX_CONCURRENT_PER_USER = 2;
export const getExportTtlHours = (): number;
export const getExportMaxRows = (): number | null;
export const getExportMaxFileMb = (): number | null;
export const getExportMaxConcurrentPerUser = (): number;
export const exportMbToBytes = (mb: number): number;
export const formatExportCount = (n: number): string;
export const formatExportSizeLimit = (mb: number): string;
export const EXPORT_CAP_REMEDY: string;
export const EXPORT_GZIP_HINT: string;
export const EXPORT_SERVER_RESTARTED_MESSAGE = "Export stopped: the server restarted. Start it again.";
export const rowCapMessage = (total: number, cap: number): string;
export const sizeCapMessage = (a: { capMb: number; rowsAtCut: number; totalRows: number | null; gzip: boolean }): string;
export const concurrencyCapMessage = (count: number): string;
export class ExportCapError extends Error { readonly code: "concurrency_cap"; constructor(message: string) }
export class RowCapError extends Error { constructor(readonly total: number, readonly cap: number) }
export class SizeCapError extends Error { constructor(readonly maxBytes: number, readonly rowsAtCut: number) }
export type ExportLimits = { maxRows: number | null; maxFileMb: number | null; maxConcurrentPerUser: number };
export const getExportLimits = (): ExportLimits;

// packages/server/src/db.ts
export const countActiveExportJobsForUser = (username: string): number;
export const listActiveExportJobs = (): ExportJob[];
export const listExpiredExportJobs = (ttlHours: number): ExportJob[];   // throws unless positive integer
export const listCompleteExportFilePaths = (): { id: string; filePath: string }[];

// packages/server/src/lib/exportRunner.ts
export const isExportRunLive = (jobId: string): boolean;

// packages/server/src/lib/exportJobAccess.ts
export const exportExpiresAt = (job: Pick<ExportJob, "finishedAt">): string | null;
export const isExportExpired = (job: Pick<ExportJob, "finishedAt">, now?: number): boolean;
// ExportJobDto gains expiresAt: string | null (after finishedAt)
```

Note: the ExportCapError constructor takes only `message` (code is fixed `"concurrency_cap"`), unlike the research sketch `(code, message)`.

## Commits
- 86b0c29 feat(130-01): exportCaps module + env plumbing
- 45668ef feat(130-01): db read helpers + isExportRunLive
- a9dbabb feat(130-01): computed expiry on export DTO

## Discrimination probes (all fired red, reverted, green)
- `formatExportCount` -> `String(n)`: EXPCAP-msg-row, size-nogzip, size-gzip, size-mb red.
- Always append gzip hint: EXPCAP-msg-size-gzip and size-mb red.
- `lower(username)=lower(?)` -> `username = ?`: EXPDB130-count-active red.
- `-${ttlHours}` -> `+${ttlHours}`: EXPDB130-expired red.
- Drop `+ "Z"` under `TZ=America/New_York`: EXPACC130-expires-at, -ttl-env, -is-expired red.

## Verification
- `expires_at` count in db.ts: 2 before and after (schema untouched).
- tsc clean; new specs green; routes.exports specs green (50 tests across 3 files).
- `npm run test:gate`: GATE PASSED.

## Deviations from Plan
None. Minor: EXPDB130 tests assert by id membership (the file's in-memory DB is shared across tests, so "exactly" is expressed per-fixture).

## Notes
- Working tree also contains uncommitted packages/web changes belonging to plan 130-05; untouched.
- Shared docs (STATE/ROADMAP/REQUIREMENTS) not touched, per instruction.

## Self-Check: PASSED
