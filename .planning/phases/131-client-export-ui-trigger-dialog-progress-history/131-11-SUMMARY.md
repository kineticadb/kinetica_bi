---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 11
subsystem: export
tags: [export, zip, zip64, compress, gap-closure]
requires:
  - phase: 131-09
    provides: integrated gates
provides:
  - Streaming one-entry zip writer (deflate, CRC-32, data descriptor, ZIP64)
  - Compressed exports are .zip (openable by Finder double-click), not .csv.gz
  - ExportOptions.compress (gzip kept as deprecated alias); DTO field compress
affects: [131-10]
key-files:
  created:
    - packages/server/src/lib/zipStream.ts
    - packages/server/tests/helpers/readZip.ts
    - packages/server/tests/lib.zipStream.spec.ts
  modified:
    - packages/server/src/lib/exportRunner.ts
    - packages/server/src/lib/exportName.ts
    - packages/server/src/lib/exportCleanup.ts
    - packages/server/.env.example
    - packages/web/src/api/client.ts
    - packages/web/src/components/ExportDialog.tsx
metrics:
  tasks: 5
  completed: 2026-10-08
---

# Phase 131 Plan 11: Zip Compression for Exports Summary

Compressed exports now stream into a single-entry .zip (raw deflate, CRC-32 via zlib.crc32, data descriptor, automatic/forced ZIP64) instead of .csv.gz; the option is renamed gzip to compress and the UI says "Compress (.zip)".

## Commits

- 717e2de: streaming one-entry zip writer + independent reader + EXPZIP spec
- 86a84c3: writeCsv/run write a .zip; gzip renamed compress (deprecated alias kept); DTO compress
- d1c857d: .zip served and cleaned up; legacy .csv.gz still served/cleaned
- 52d4725: web "Compress (.zip)" label, compress field, .zip file hint

## Pinned signatures

- zipStream.ts: `createZipEntryStages(opts: ZipEntryOptions): [Transform, Transform, Transform]` (meter, deflate, framer); `ZipEntryOptions = { entryName: string; mtime?: Date; forceZip64?: boolean }`; also `dosDateTime`, `needsZip64`, `localFileHeader`, `dataDescriptor`, `centralDirectoryHeader`, `endOfCentralDirectory`, `ZIP_U32_MAX`. Requires Node >= 20.15 (zlib.crc32).
- `ExportOptions = { format?: "raw" | "formatted"; compress?: boolean; name?: string }` (exportRunner.ts); final path `<jobId>.zip` when compress, else `.csv`; zip entry name is the download base + ".csv".
- `EXPORT_FINAL_EXTS = [".csv", ".zip", ".csv.gz"]` (exportName.ts; .csv.gz is legacy only).
- Web DTO (client.ts): job field `compress: boolean`; `ExportStartOptions = { compress: boolean; format: ExportFormat; name: string }`.
- Test helper: `readSingleEntryZip(buf)` in tests/helpers/readZip.ts.

## Evidence

Independent readers: Node readSingleEntryZip, python3 zipfile (-I), `unzip -t` and macOS `ditto -x -k` all pass for plain and forced-ZIP64 output (EXPZIP-python / -unzip-t / -ditto tests run on this Mac). `bsdtar -tvf` lists the forced-ZIP64 sample (manual check).

Gates:
- server tsc clean; lib.zipStream 13/13; Task 2 set 119/119; Task 3 set 105/105
- test:gate PASSED (8 known). tests/lib.exportRunner.memory.spec.ts failed in the full run but passes alone, i.e. contamination. WATCH: it holds the new zip backpressure test.
- web tsc clean; vitest 198 files / 4358 tests; theme-guard 158/158; check-classnames OK (34 tokens / 2 files)
- Greps: web `gzip` 0 (was 22); web `.csv.gz` 0; server non-legacy `gzip` 0; .env.example `csv.gz` 0
- Dependencies unchanged vs 91b51b1

Mutation probes P1-P11, each red, then reverted:

| Probe | Mutation |
|---|---|
| P1 | descriptor CRC |
| P2 | local flags 0x0800 (red only after redoing with python; GNU-only sed was a no-op on macOS) |
| P3 | central ZIP64 extra order |
| P4 | local header without ZIP64 extra (red incl. both EXPZIP-ditto variants) |
| P5 | byteCap applied before zip |
| P6 | alias line removed |
| P7 | entry name without .csv |
| P8 | .zip removed from EXPORT_FINAL_EXTS |
| P9 | \|\.zip removed from OWN_EXPORT_FILE_RE |
| P10 | .csv.gz removed from EXPORT_FINAL_EXTS |
| P11 | exportFileName returns .csv.zip |

## Checkpoint: Z1-Z5

Operator reply (2026-10-08), verbatim: "approved"

Z1-Z5 all PASS per the operator, including the Finder double-click of the compressed export (Z3) and of the forced-ZIP64 sample (Z4).

## Deviations from Plan

1. [Rule 3 - Blocking] EXPZIP-python / -unzip-t / -ditto tests grouped via describe.each.
2. [Rule 3 - Blocking] BSD sed portability: GNU-only sed edits were no-ops on macOS; redone with perl/python (caught by the grep guards).
3. [Rule 3 - Blocking] SizeCapError imported from exportCaps in the memory spec.

## Follow-up for 131-10 (when it resumes)

Its V1/V3 steps must use .zip / `unzip -t` (not gzip), and EXPRT-V126-10 must be reworded to "Compress (.zip)".

## Self-Check: PASSED
Commits 717e2de, 86a84c3, d1c857d, 52d4725 verified in git log.
