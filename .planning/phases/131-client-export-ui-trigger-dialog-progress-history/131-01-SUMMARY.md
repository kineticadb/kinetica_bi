---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 01
subsystem: server-export
tags: [export, csv, formatter, d3-format]
requires: []
provides:
  - server buildFormatter/normalizeToMs/FormatSpec (packages/server/src/lib/columnFormatter.ts)
  - ExportOptions.format "formatted" + name; loadFormatPlan
affects: [131-04]
tech-stack:
  added: [d3-format ^3.1.2 (runtime), "@types/d3-format ^3.0.4 (dev)"]
key-files:
  created:
    - packages/server/src/lib/columnFormatter.ts
    - packages/server/tests/lib.columnFormatter.parity.spec.ts
    - packages/server/tests/lib.exportRunner.formatted.spec.ts
  modified:
    - packages/server/package.json
    - package-lock.json
    - packages/server/src/lib/exportRunner.ts
requirements-completed: []
duration: ~10m
completed: 2026-10-07
---

# Phase 131 Plan 01: Server formatted export Summary

Server port of the web column formatter (parity-proven) plus a formatted row mapper in the export runner; labels and formatted cells flow through the unchanged csvLine/escapeCsvField so the formula guard still applies. Route still rejects "formatted" (Plan 131-04 opens it).

## Pinned exported signatures

```typescript
// packages/server/src/lib/exportRunner.ts
export type ExportOptions = { format?: "raw" | "formatted"; gzip?: boolean; name?: string };
export type FormatPlan = { labels: string[]; fns: (((v: unknown) => unknown) | null)[] };
export function loadFormatPlan(widgetId: number, header: readonly string[]): FormatPlan | null;
// packages/server/src/lib/columnFormatter.ts
export function buildFormatter(spec: FormatSpec | null | undefined): (v: unknown) => unknown  // same as web
export function normalizeToMs(v: unknown): number
export type FormatSpec = FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone | FormatSpecSI
```

## Commits
- cf4c65e: dependency + server formatter + parity spec
- fee7c05: formatted row mapper + EXPFMT spec

## Discrimination probes (all red, then reverted to green)
- Parity: swapped currency prefix to suffix in server copy -> CMFPARITY-number red.
- P1 (outHeader -> header): EXPFMT-labels and EXPFMT-formula-guard red.
- P2 (batches yield rows unmapped): EXPFMT-cells red.
- P3 (removed tableId guard): EXPFMT-no-tableId red.

## Verification
- Parity 6/6, EXPFMT 7/7, existing runner/caps/cancel specs pass (49 total); tsc clean; `npm ci --dry-run` OK; `npm run test:gate`: GATE PASSED.

## Deviations
- Minor: one comment in the ported file referenced "columnTypes.ts"; reworded so the negative-guard grep reads 0. Plan line numbers for the test harness were off (harness at lines 73-149); copied the correct range.
- Otherwise none. No shared docs touched.

## Self-Check: PASSED
