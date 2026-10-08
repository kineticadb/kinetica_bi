---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 10
subsystem: export
tags: [export, uat, live-verification, docs]
requires:
  - phase: 131-09
    provides: integrated gates, approved scratch table
  - phase: 131-11
    provides: zip compression gap closure
provides:
  - Live operator + orchestrator evidence for ROADMAP criterion 5 (V1-V13 all PASS)
  - Scratch table dropped; shared docs updated by hand
affects: [phase-131-verification]
requirements-completed: [EXPRT-V126-05, EXPRT-V126-06, EXPRT-V126-07, EXPRT-V126-08, EXPRT-V126-09, EXPRT-V126-10, EXPRT-V126-12]
key-files:
  modified:
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
metrics:
  tasks: 3
  completed: 2026-10-08
---

# Phase 131 Plan 10: Live UAT, Cleanup and Shared Docs Summary

All 13 live checks passed (operator for UI, orchestrator for server behaviour over real bootstrap + HTTP); snapshot isolation is verified live, the scratch table is dropped, and STATE/ROADMAP/REQUIREMENTS were updated by hand.

## Checkpoint: V1–V13

Genuine operator input 2026-10-08, plus orchestrator-run live evidence where noted.

| Item | Result | Evidence |
|---|---|---|
| V1 | PASS (operator) | |
| V2 | PASS (orchestrator, live via real server bootstrap + HTTP, throwaway DB/EXPORT_DIR, port 4118) | 1,500,000 rows raw in 74 s, 50,103,744 bytes. Header = configured columns in order. 0 sort violations (fare_amount desc). DDS rows 11,376. No trailing CRLF (matches client rowsToCsv). |
| V3 | PASS | Operator for toast/Download UI; orchestrator live for the server side (formatted + compressed + name `Résumé – 数据 / Q1`). Then gzip: valid, header "Fare ($)", `$999.99` values, 1.5M rows, 64 s. `Content-Disposition filename*=UTF-8''Résumé – 数据 - Q1.csv.gz`. Compression is now .zip (131-11 Z1–Z5 approved). |
| V4 | PASS (operator; list DTO also verified live by orchestrator) | |
| V5 | PASS (orchestrator live) | cancel -> cancelled, no file |
| V6 | PASS local-only | Orchestrator live: Range 206, resume 206, sha256 identical. Proxy: not run (Phase 129 debt stays open). |
| V7 | PASS | Operator: no polling after logout. Orchestrator live: session_expired with the D-16 message, no file. |
| V8 | PASS (orchestrator live) | kill -9 mid-export, restart: "[export] reconcile: 1 interrupted jobs failed, 0 orphan files removed"; job failed/server_restarted with its message; .part removed. |
| V9 | PASS (orchestrator live) | 3rd concurrent start -> 429 concurrency_cap verbatim; cancel frees the slot. With EXPORT_MAX_ROWS=500000, /me exportLimits {maxRows:500000,…} and the export failed row_cap ("This export has 1,489,624 rows; the limit is 500,000. Add filters…"), 0 rows, no file. Dialog disabled-Start-over-limit UI is unit-tested (EXPDLG); live UI not separately exercised. |
| V10 | PASS (orchestrator live) | Operator-approved predicate `vendor_id = 'DDS'` (replaced approved `vendor_id = 1`, which matched 0 rows; operator re-approved). Mutate ran mid-export (table -> 1,489,624 rows, 0 DDS). The export still had 1,500,000 rows incl. all 11,376 DDS and was byte-identical to the V2 file: snapshot isolation verified. |
| V11 | PASS (operator, light/dark) | |
| V12 | PASS after fix fd5e312 (operator) | Initially Enter did not start the export: Name lost focus on open (in dev, StrictMode's double effect restored focus to the opener). Fixed by focusing Name in the same effect (EXPDLG-strictmode-focus). |
| V13 | PASS (operator) | With a page_size widget-action override active, the dialog shows the D-04 note; cleared -> gone. Closes the Phase 128 Q-D carried debt under D-04. |

V13 follow-up found: the records page_size override never changes the table (pre-existing Phase 58 bug): actionAllowList key `page_size` (actionAllowList.ts:119, radioGroupCapture.ts:48) vs records reading `cfg.pageSize` (WidgetRenderer.tsx:1920); the overlay merges `page_size`, so it is a no-op and "Capture from target" captures nothing. Logged in STATE as a follow-up; outside Phase 131.

## UAT gap closure

- 6c710cf: dialog portals to document.body (grid CSS transforms trapped position:fixed inside the widget); modal-family styling (segmented radiogroup--buttons, ds-field labels). Tests EXPDLG-portal, EXPDLG-modal-classes.
- c83d138: reverted 0418602 (gzip OS byte; wrong diagnosis: the operator's Archive Utility refuses every .gz, even CLI gzip).
- 131-11 (717e2de, 86a84c3, d1c857d, 52d4725, 0d450b5): compression switched to .zip (CONTEXT D-07a), Z1–Z5 approved incl. the Finder double-click.
- fd5e312: Name focus under StrictMode (V12).
- Watch item: tests/lib.exportRunner.memory.spec.ts failed once in a full server test:gate run but passes alone (contamination; holds the new zip backpressure test).

## Task 2: Scratch cleanup

Command: `EXPORT_SCRATCH_TABLE=kbi_scratch.exp131_iso EXPORT_SCRATCH_CREATE_SCHEMA=yes EXPORT_SCRATCH_APPROVED=yes npx tsx src/spikes/exportScratchTable.ts drop --schema`

```
[export-scratch] > DROP TABLE IF EXISTS kbi_scratch.exp131_iso
[export-scratch] > DROP SCHEMA IF EXISTS kbi_scratch
```

Post-drop `count` fails as required:

```
[export-scratch] > SELECT COUNT(*) FROM kbi_scratch.exp131_iso
[export-scratch] Kinetica error (HTTP 400): SqlEngine: Object 'kbi_scratch' not found (S/SDc:1513)
```

Leftover check (read-only `SELECT object_name FROM ki_catalog.ki_objects WHERE object_name LIKE '\_kbi\_exp\_%'`): one object remains, `_kbi_exp_2432df35` (a snapshot from a UAT run, plausibly the kill -9 / session-expired runs which cannot drop their snapshot). Not dropped: the approval did not cover it; the default 60 min TTL is the backstop. The check query was run from a throwaway script outside the repo (removed).

The operator-created UAT 131 dashboard, dataset registration and UAT exports were not touched by the agent.

## Task 3: Shared docs (by hand, no gsd-tools mutation commands)

- REQUIREMENTS.md: EXPRT-V126-05/06/07/08/09/10/12 ticked and Complete (-05 via V2 + V10); -10 reworded to "Compress (.zip)" with the UAT note; -11 note left as is (V6 local-only); footer updated.
- ROADMAP.md: plan lines 131-01..131-10 ticked, 131-11 added as gap closure and ticked, "Plans" count 11. The Phase 131 checkbox in `## Phases` is NOT ticked (orchestrator does it after verification).
- STATE.md: frontmatter status `phase_131_executed_pending_verification`, stopped_at "Phase 131 plans complete (2026-10-08); verify next", total/completed plans 35; Phase 131 outcome + UAT gap closure paragraphs; debt updated (proxy-path still open; Q-D closed under D-04; snapshot isolation closed); page_size follow-up; "For Phase 132" note; Next line.

Acceptance greps: `Phase 131 outcome` = 1; `- [x] 131-` = 11 (10 required + 131-11); `- [x] **Phase 131:` = 0; `closed under D-04 (V13` = 1; `For Phase 131:` = 0.

## Deviations from Plan

- 131-11 gap-closure plan added (so 11 ticked plan lines, and totals 35 rather than 34).
- The V10 predicate was changed from `vendor_id = 1` to `vendor_id = 'DDS'` with operator re-approval.
- Plan said STATE status `phase_131_complete`; the orchestrator instruction `phase_131_executed_pending_verification` was used.

## Open debt

- Proxy-path resume (Phase 129 debt) still not exercised.
- `_kbi_exp_2432df35` awaits TTL expiry.
- Records page_size override no-op (Phase 58 bug), follow-up.

## Self-Check: PASSED
