---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 01
subsystem: export
tags: [csv, formula-injection, owasp]
requires: []
provides: [hardened web escapeCsvField, server csvExport port (escapeCsvField, rowsToCsv, csvLine), client/server parity spec]
affects: [128-05]
key-files:
  created: [packages/server/src/lib/csvExport.ts, packages/server/tests/lib.csvExport.spec.ts, packages/server/tests/lib.csvExport.parity.spec.ts]
  modified: [packages/web/src/lib/csvExport.ts, packages/web/src/lib/csvExport.spec.ts]
requirements-completed: [EXPRT-V126-04]
metrics:
  completed: 2026-10-06
---

# Phase 128 Plan 01: CSV formula-injection hardening Summary

OWASP single-quote prefix rule (leading = + - @ TAB CR; numbers and strict-numeric strings exempt; headers included) applied identically on the web writer and a new server port, with a parity spec against the web module.

## Tasks
1. Web escapeCsvField hardened, 13 FORMULA- tests added.
2. Server port plus FORMULA-/CSVLINE- spec and CSVPARITY- spec (direct relative import of the web module resolves fine in vitest).

## Verification
- Web csvExport spec 33 pass; full web vitest 4232 pass; theme-guard green; web and server tsc clean; server specs 17 pass.
- Discrimination probe: dropping `-` from the web CSV_FORMULA_LEAD_RE made both CSVPARITY- tests FAIL; reverted, they pass.

## Deviations
Process only: implementation and tests were written together, so the TDD RED run was not observed separately (the discrimination probe covers the guard's teeth). Shared docs untouched.
