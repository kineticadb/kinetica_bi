---
phase: 119-export
plan: 03
subsystem: api
tags: [export, dashboard, integration-test, mutation-probes, completeness-proof]

# Dependency graph
requires: ["119-01", "119-02"]
provides:
  - "packages/server/tests/routes.dashboard-export.spec.ts — the completeness/exclusion/non-leak/delivery integration proof for GET /api/dashboards/:id/export"
affects: [119-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One kitchen-sink dashboard fixture exercises all eight widget-config reference kinds (REF-1..8) plus the layer filter_scope sixth site and the dashboard_tables union edge, in a single beforeEach, rather than one fixture per reference kind — makes the completeness claim a single assertable artifact instead of eight independent (and individually incomplete) ones"
    - "Exclusion proofs seed a live canary row first, then assert absence from res.text (raw bytes) — an assertion against an empty table proves nothing"
    - "Non-leak proof compares response-to-response (denied.body toEqual missing.body), never response-to-literal — the comparison itself is what stays discriminating against future refactors"

key-files:
  created:
    - packages/server/tests/routes.dashboard-export.spec.ts
  modified: []

key-decisions:
  - "One fixture, not eight — REF-1..8 plus the sixth-site filter_scope and the dashboard_tables-only table all coexist on a single dashboard; every referenced entity asserted present by sorted id-SET equality (toEqual), not toContain, so a stray extra inclusion fails too"
  - "Three exclusion canaries (access-grant grantee, column-display label, dashboard_table_views view name) are live seeded rows, asserted absent from res.text (raw response bytes), not res.body — closes the 'proves nothing against an empty table' gap"
  - "The non-leak 404 test compares denied.body to missing.body directly, never to a literal — the exact property mutation probe M6 (splitting the guard into 404-then-403) proved this catches"
  - "Ten mutation probes were run for real against the committed source and reverted; all ten fired their named assertion on the first attempt — no test needed strengthening"

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-09-16
---

# Phase 119 Plan 03: Dashboard Export Completeness Proof Summary

**One kitchen-sink dashboard fixture proves `GET /api/dashboards/:id/export` walks all eight widget-config reference kinds plus the layer `filter_scope` sixth site to completion (38 named tests), while three seeded canaries prove the three operator-excluded/runtime data sets are absent from the raw bytes, the 404 guard proves non-leaking by direct response comparison, and ten real mutation probes against the committed assembler/route each reddened their named assertion before being reverted.**

## Performance

- **Duration:** ~25 min (research/read + fixture construction + ten real mutate-test-revert cycles)
- **Started:** 2026-09-16T19:55:00Z (approx, first read)
- **Completed:** 2026-09-16T20:20:00Z
- **Tasks:** 3 completed
- **Files modified:** 1 (newly created)

## Accomplishments

- A single dashboard fixture (`dash`) exercises every one of the eight `REF-n` reference kinds named in `119-RESEARCH.md`, PLUS the sixth-site `dashboard_layers.filter_scope`, PLUS the `dashboard_tables` union edge (an associated-but-unreferenced table, and an unassociated-but-referenced table, coexisting in the same export) — 22 `INCL-*`/`DANGLE-*` tests in Task 1, all passing on first run.
- Three exclusion canaries (`canary-grantee-9f3a`, `canary-column-label-7b2c`, `canary_view_name_5d1e`) are seeded as LIVE rows against real access-grant, column-display-config, and `dashboard_table_views` tables, then asserted absent from `res.text` (raw bytes, not the parsed object) — 16 additional `EXCL-*`/`NOLEAK-*`/`DELIV-*`/`PARITY-*` tests in Task 2.
- The non-leak 404 property is proved by comparing `denied.body` to `missing.body` directly (never to a literal), plus a non-numeric `:id` case and a post-grant 200 flip — closing the exact "helpful 403-split refactor" gap mutation probe M6 confirmed is real (it would have reintroduced the id-enumeration leak v1.10 deliberately closed).
- Ten mutation probes were run for real against the committed `dashboardExport.ts`/`index.ts`, one at a time, each reverted before the next: all ten fired their named assertion on the first attempt (see "Mutation Probe Results" below). No assertion needed strengthening.
- `git diff --exit-code` confirmed `dashboardExport.ts`, `index.ts`, `db.ts`, `permissions.ts`, `package.json`, and `scripts/test-gate.mjs` are all byte-identical to their pre-probe committed state.
- The SET-BASED server gate (`node scripts/test-gate.mjs`) exits 0 with `GATE PASSED`; both packages' `tsc --noEmit` are clean; `packages/web` has zero diff (server-only phase, confirmed both before and after this plan's work).

## Mutation Probe Results (all 10 fired)

| # | Mutation | Reddened (named test + any collateral) |
|---|---|---|
| M1 | Dropped `associatedIds` from the table union (kept only `refs.tableIds`) | `INCL-union: the dashboard_tables-only table travels...` (+ the sibling "all four related tables travel" test) |
| M2 | Replaced referenced-metric lookup with a full per-table metric listing | `EXCL-metric: the unreferenced sibling metric label does not appear...` (+ `INCL-metrics: both referenced metrics travel`) |
| M3 | Added a `views` key (runtime materialized-view bookkeeping) to the envelope | `EXCL-runtime: the dashboard_table_views view_name does not appear...` AND `EXCL-runtime: the envelope has no views key` |
| M4 | Added a `grants` key (access-grant listing) to the envelope | `EXCL-grants: the access-grant grantee string does not appear...` AND `EXCL-grants: the envelope has no grants / accessGrants key` |
| M5 | Added a `columnDisplayConfig` key to the envelope | `EXCL-columnconfig: the column_display_config label does not appear...` |
| M6 | Split the route guard into 404-for-missing + separate 403-for-denied | `NOLEAK-404: an analyst with no grant gets 404, byte-identical to a nonexistent dashboard id` (+ `NOLEAK-grant: after a user grant...`) |
| M7 | Deleted the `Content-Disposition` `setHeader` line | `DELIV-disposition: the filename is slugified...` AND `DELIV-disposition: the header contains no quote, CR or LF...` |
| M8 | `JSON.stringify(payload, null, 2)` → `JSON.stringify(payload)` | `DELIV-pretty: the body is pretty-printed, not minified` |
| M9 | `exportFileName`'s allow-list regex → a denylist stripping only slashes | `DELIV-disposition: the header contains no quote, CR or LF...` PLUS 25 other tests (see note below) |
| M10 | Removed `dashboardTableIds` from the returned envelope | `INCL-union: dashboardTableIds lists exactly the two associated table ids` (the ONLY failure — confirms this assertion's precision) |

**M9 note (a finding, not a broken criterion):** the denylist swap left the kitchen-sink dashboard's quote-and-CRLF-bearing name unsanitized in the filename slug. Node's http layer throws when `res.setHeader` receives a value containing a raw CR/LF, so every request against that dashboard crashed (26 tests failed, not 1). The target assertion was still among the failures, so the probe fired as required and no test needed strengthening — but the blast radius is a genuinely different (and arguably more informative) failure mode than the other nine probes, which each failed only their own value-level assertion. Recorded in the spec's header comment.

## Task Commits

1. **Task 1: kitchen-sink fixture + INCL/DANGLE tests** - `12e717e` (test)
2. **Task 2: exclusion canaries, non-leak 404, delivery headers, parity** - `84ba4c5` (test)
3. **Task 3: ten mutation probes recorded; SET-BASED gate verified** - `0708d22` (test)

**Plan metadata:** this commit (docs: complete plan)

_All three tasks were non-TDD `auto` tasks (no `tdd="true"` attribute) — each committed once its tests passed and its acceptance-criteria greps were independently re-run._

## Files Created/Modified

- `packages/server/tests/routes.dashboard-export.spec.ts` (created) — 38 tests across two `describe` blocks: kitchen-sink completeness (`INCL-*`, `DANGLE-*`) and exclusions/non-leak/delivery/parity (`EXCL-*`, `NOLEAK-*`, `DELIV-*`, `PARITY-*`). Header comment documents the coverage summary and the full ten-row mutation-probe record.

## Decisions Made

- One fixture dashboard carries all eight reference kinds simultaneously (rather than one dashboard per kind) — this is what makes the "complete, not merely present" claim a single artifact: any future ninth reference kind would need its own addition to this same fixture and its own `INCL-REF9` test, not a new isolated file.
- Exclusion assertions read `res.text`, never `res.body`, per the plan's explicit instruction — a canary hiding in a field name or nested blob would survive an object-level check.
- The DANGLE test names (`DANGLE-clean`, `DANGLE-cross`) are deliberately distinct from the pre-existing `DANGLE-widget`/`DANGLE-table`/`DANGLE-metric`/`DANGLE-layer`/`DANGLE-none` titles already present in Plan 02's `tests/lib.dashboardExport.spec.ts` — same prefix convention, no name collision, no shared coverage (Plan 02's spec tests the pure assembler function directly; this plan's spec tests the full HTTP round-trip).

## Deviations from Plan

None (Rule 1/2/3 auto-fixes). No source code was changed by this plan — per its own explicit scope ("NOT in this plan: any source change"), only the ten mutation probes touched source files, and each was reverted with `git diff --exit-code` confirmed clean before proceeding to the next. No defect was found in Plan 01 or Plan 02's code; all ten probes reddened cleanly on the first attempt against the already-correct implementation.

## Issues Encountered

- **The plan's own "before" baseline greps for `EXCL-`, `DELIV-`, and `DANGLE-` across the whole `packages/server` tree were stale by the time this plan executed** — Plan 02's own spec file (`tests/lib.dashboardExport.spec.ts`) had already introduced its own `EXCL-metric`, `DELIV-name`, and five `DANGLE-*` test titles (all confirmed at repo scope: `EXCL-` → 3, `DELIV-` → 4, `DANGLE-` → 7, none in the file this plan creates). This did not affect this plan's actual acceptance criteria, which are scoped to counts WITHIN the new file `tests/routes.dashboard-export.spec.ts` specifically (which was 0/absent for all of these before this plan's commits) — but it is worth flagging as a repeated instance of the project's own documented "verify a grep reads 0 before trusting it" lesson, this time at the plan-authoring stage rather than the execution stage. No action was needed; the file-scoped criteria were correct as written and all passed.
- **Header-comment self-trip avoided by construction:** following the Plan 01/02 precedent (both of which hit the trap of a comment literally quoting a string the acceptance criteria required to be absent), this plan's mutation-probe header comment was written directly against the actual final test titles and re-verified with the exact `grep -cE '^ \* M([1-9]|10) '` criterion before committing — first draft used a double-asterisk `" * * M1 "` format that scored 0 against the required regex; corrected to the single-asterisk `" * M1 "` format (matching Plan 01's `P`-numbered precedent) and re-verified at 10 before committing.
- **`gsd-tools state advance-plan` / `roadmap update-plan-progress` still cannot parse this project's STATE.md/ROADMAP.md formats** (per warning 7, matches 119-01/119-02) — both files were updated manually in their existing style rather than via those commands.

## User Setup Required

None — no external service configuration required. This plan is pure integration-test authorship plus temporary, fully-reverted source mutations; no auth gate was encountered beyond the ones the tests themselves exercise (401/404/200 via seeded sessions).

## Next Phase Readiness

- Plan 04 (ninth-reference-kind audit + operator export checkpoint) can rely on: the export route is proven complete against all eight known reference kinds plus the sixth-site `filter_scope`; the three operator-excluded/runtime data sets are proven absent by canary, not merely un-coded; the 404 guard is proven non-leaking by direct response comparison; and the download header is proven injection-safe against a hostile dashboard name.
- **No DXIM requirement was marked complete** in `.planning/REQUIREMENTS.md` by this plan (all eleven remain `Pending`, verified via grep before writing this SUMMARY) — per this plan's explicit instruction (warning 8). Plan 04 owns closure after the operator checkpoint.
- If Phase 120's import remapper or any future widget type introduces a NINTH reference kind, both `dashboardExportRefs.ts`'s own module comment (Plan 01) and this plan's kitchen-sink fixture will need a corresponding update — this plan's fixture construction order (tables → dashboard → metrics → dynamic view → layers → widgets → cycle-closing patches) is the template to extend.

---
*Phase: 119-export*
*Completed: 2026-09-16*

## Self-Check: PASSED

- FOUND: packages/server/tests/routes.dashboard-export.spec.ts
- FOUND: .planning/phases/119-export/119-03-SUMMARY.md
- FOUND commit: 12e717e (Task 1 — kitchen-sink fixture + INCL/DANGLE tests)
- FOUND commit: 84ba4c5 (Task 2 — exclusion canaries, non-leak 404, delivery, parity)
- FOUND commit: 0708d22 (Task 3 — mutation probes recorded; SET-BASED gate verified)
