---
phase: 125-apply-sync-history
verified: 2026-09-28T14:30:00Z
status: passed
score: 5/5 ROADMAP success criteria verified
re_verification: null
requirements_verified: [SSYNC-V125-13, SSYNC-V125-14, SSYNC-V125-15, SSYNC-V125-16, SSYNC-V125-17]
requirements_correctly_still_open: [SSYNC-V125-18, SSYNC-V125-19, SSYNC-V125-01]
gates:
  server_test_gate: "GATE PASSED — 1489/1542, 8 failing files, set EXACTLY == the 8 documented KNOWN_FAILING, zero rotating contamination this run"
  server_tsc: "clean (exit 0)"
  web_touched: "0 files under packages/web/ between 688ff43 and HEAD"
  working_tree: "clean; git diff --exit-code passes after every probe revert"
mutation_probes_run_by_verifier: 5
mutation_probes_fired: 5
non_blocking_findings:
  - id: DOC-1
    severity: warning
    file: .planning/REQUIREMENTS.md
    detail: "Coverage rollup still reads `**Complete: 11**` and enumerates only Phases 122-124, while the 19-item checklist and the traceability table both mark SSYNC-V125-13..-17 Complete. Should read 16. Plan 125-04 declared `.planning/REQUIREMENTS.md — SSYNC-V125-13..-17 marked complete` as an artifact and commit 5a2a303 updated both per-requirement surfaces but not the rollup line."
  - id: DOC-2
    severity: info
    file: .planning/phases/125-apply-sync-history/125-04-SUMMARY.md
    detail: "Two body surfaces are stale relative to the frontmatter: the `**Status:**` paragraph says the blocking checkpoint `is UNANSWERED` and the What-shipped table row 3 says `BLOCKING checkpoint — awaiting the operator`, while `metrics.tasks` and the later § `Checkpoint (Task 3) — ANSWERED 2026-09-28: APPROVED` record it as approved. Commit 3d86f2b updated the frontmatter and the checkpoint section but not the two earlier body surfaces."
  - id: MIRROR-1
    severity: info
    file: packages/server/tests/lib.schemaApply.spec.ts
    detail: "`WEB_EXCLUDED_DRILLDOWN_TYPES` is hardcoded from packages/web/src/lib/columnTypes.ts:29-38 and is NOT covered by any MIRROR-PARITY assertion (lib.columnTypeClass.spec.ts guards NUMERIC_TYPES, BOOLEAN_TYPES, DATETIME_TYPES and normalizeType only). Verified byte-equal to the web original TODAY by hand; a future edit to the web set would redden nothing. Same class of unguarded mirror, one rung weaker than the three that ARE guarded."
human_verification:
  - test: "Apply against a real Kinetica table and confirm the config panels offer the live columns with the right type class"
    expected: "A TIMESTAMP column offers datetime affordances, not numeric ones; a WKT/geometry column stays out of the drill-down picker"
    why_human: "SSYNC-V125-13's second clause is a packages/web behaviour. This phase touches zero web files, and the repo has no cross-package imports — the server proves it by MIRRORING the web taxonomy in a spec, never by executing it. Phase 126 owns the UI and the operator verification."
  - test: "Apply against a live Kinetica table end-to-end (not a mocked /show/table body)"
    expected: "One /show/table call, snapshot replaced, one history entry recorded with the report"
    why_human: "Every test in this phase mocks fetch. 125-CONTEXT.md records that five of nine registered tables have been dropped from Kinetica, so live exercise is Phase 126 UAT's job."
  - test: "Render SCHEMA_APPLY_TEXT_WIDTH_GAP alongside an apply result"
    expected: "The operator sees the text-width caveat"
    why_human: "The constant exists, is exported and is tested, but has NO emitter in this phase. Operator decided at the blocking checkpoint that Phase 126 renders it (now ROADMAP Phase 126 criterion 6). Correctly carried, not a Phase 125 gap."
---

# Phase 125: Apply & Sync History — Verification Report

**Phase Goal:** On explicit confirmation the stored snapshot is replaced with the live Kinetica
column set and nothing else is touched, and the changeset plus the report survive as a durable
per-table worklist.

**Verified:** 2026-09-28
**Status:** passed — 5/5 ROADMAP success criteria
**Re-verification:** No — initial verification (no previous 125-VERIFICATION.md anywhere in the tree)
**Baseline for diffs:** `688ff43` → `HEAD` (`3d86f2b`)

---

## Goal Achievement — the five ROADMAP criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | After applying, reading the table's metadata returns the live Kinetica columns and types — the stale snapshot is gone | ✓ VERIFIED | `routes.schema-apply.spec.ts` `PERSIST-diff` applies, then re-runs `GET /api/tables/:id/schema-check` on the SAME live body **through the app's own read path** and asserts `hasChanges: false`. `lib.schemaApply.transaction.spec.ts` `ONLYTABLES-diff` additionally asserts `getTable(id).columns` equals `{col_a:"long", col_b:"string(char16)", col_ts:"timestamp"}` and `getTableColumnsFingerprint(id) === serializeFingerprintSnapshot(LIVE)`. Not a db peek in either case. |
| 2 | Every `widgets`, `dashboard_layers`, `custom_metrics`, `column_display_config` row identical to before; only the `tables` row changed | ✓ VERIFIED — **and independently re-proved by probe** | See § "Criterion 2 — proved, not decorated" below. |
| 3 | An apply carrying removals or retypes succeeds; no path refuses it, demands a force flag, or requires findings to be resolved first | ✓ VERIFIED | Enforced by SHAPE. `applySchemaSync`'s input type is `{tableId, table, live, reportedLive, actor}` — no force/override/ack field. `SchemaApplyResult` is `applied \| no_changes \| stale \| table_missing` — no disableable refusal arm. `tsc --noEmit` clean. Diff-anchored grep over all `+` lines of `packages/server/src` + `tests` for `\bforce\b\|override\|bypass\|acknowledge` returns **6 hits, every one a comment or a test title, zero code**. Behaviourally: `ONLYTABLES-breaking` (lib) and `PERSIST-breaking` (route, 200 `applied`) both apply an addition + removal + retype. |
| 4 | Applying records a per-table history entry holding when it ran, the changeset and the impact report as it stood; still readable after a restart | ✓ VERIFIED | `db.syncHistory.spec.ts` `HIST-restart` writes to a **file-backed** db, `close()`s it, re-opens with `createDb(path)` and reads entry + meta back. `HIST-roundtrip` asserts `report_json` is byte-identical to `JSON.stringify(report)` in the column and back out. `READ-after-apply` round-trips `ts`/`actor`/`kind`/`changeset`/`report` through the route. `PERSIST-actor` proves `actor` is the session's own username (and explicitly `not "system"`, `not APP_ADMIN_USERNAME`). The report is **rebuilt server-side** from the re-read live map inside `applySchemaSync`, never accepted from the client. |
| 5 | A history entry can be deleted on its own, leaving the table's other entries and its stored schema untouched | ✓ VERIFIED | `HIST-delete-one` deletes the middle of three, asserts the two siblings survive with their payloads AND that `getTable(id).columns` / `getTableColumnsFingerprint(id)` are unchanged. Route half: `DELETE-one` (204 + schema untouched), `DELETE-wrong-table` (an entry belonging to another table is 404 and deletes nothing — the path's table id is load-bearing), `DELETE-keeps-dropped` (the cap's `droppedCount` is deliberately not reset). |

**Score: 5/5.**

---

## Criterion 2 — proved, not decorated

This was the load-bearing claim and I re-derived it rather than reading it.

**Structure (read, confirmed):**
- `snapshotConfigTables()` is `SELECT * ... ORDER BY id` over all four tables — **full rows, never counts** (`lib.schemaApply.transaction.spec.ts:453-460`).
- `expectNonVacuous()` asserts all four arrays are non-empty, and is called **before every single `toEqual`** in all three `ONLYTABLES-` comparison tests (lines 493, 544, 575), plus a dedicated `ONLYTABLES-seeded` test that names each table's expected row count explicitly, so a helper that silently stopped checking one table is caught.
- `expectRowWriteBudget(n, fn)` wraps the call in SQLite `total_changes()` and asserts the delta. Budget **2** for the three successful applies (one `tables` UPDATE + one history INSERT), budget **0** for `NOOP-nothing` and `STALE-refuses`.

**Probe V1 — the stray write.** I inserted `db.prepare("UPDATE widgets SET title = title").run();` as the first statement of `applySchemaSync`'s `db.transaction`. This is the *value-identical* case: it rewrites a row in place with the value already there.

> Result: **3 NAMED tests reddened** — `ONLYTABLES-diff`, `ONLYTABLES-baseline`, `ONLYTABLES-breaking`, all with `expected 3 to be 2` at `expectRowWriteBudget`. 3 failed / 9 passed.

**Probe V2 — which guard actually closed it.** With V1 still in place I neutered *only* the budget assertion (`expect(totalRowWrites() - before).toBe(expected)` → no-op) and re-ran.

> Result: **12/12 GREEN.** The full-ROW snapshot comparison saw nothing.

This independently confirms the phase's own finding, exactly as the SUMMARY states it: the row-snapshot technique alone **cannot** detect a value-identical write (`db.ts` declares **zero** `CREATE TRIGGER` — verified: `grep -cE "CREATE TRIGGER" packages/server/src/db.ts` = 0, so no `updated_at` bump betrays it). The `total_changes()` budget is the only thing standing there. The earlier SUMMARY claim that `dashboard_layers` lacks a timestamp column was corrected in `52a8c0f`; the corrected mechanism is the one I measured.

Both probes reverted with `git checkout --`; `git diff --exit-code` clean.

---

## The other four load-bearing claims

### Claim 2 — the empty-map wipe is impossible ✓ VERIFIED

The hazard is real and I confirmed it at the source: `renderColumnsMap({})` returns `{}` and
`isStaleAgainst({},{})` is `false`, so an empty `live` reaching `applySchemaSync` would be applied
happily and would WIPE `tables.columns`. The lib deliberately does not defend.

The defence is in the route, `packages/server/src/index.ts` (`POST .../schema-apply`), and it
**precedes the Kinetica call**: `!reportedLive || typeof !== "object" || Array.isArray(...) ||
Object.keys(...).length === 0` → 400. There is a **second, independent** guard after the call for a
degraded upstream (`Object.keys(live).length === 0` → `KineticaUpstreamError`), mirroring the
schema-check route.

Named test: `REFUSE-badbody: a missing or EMPTY live map is a 400 and never reaches Kinetica` —
asserts 400 for both `{}` and `{live:{}}`, `expect(fetchMock).not.toHaveBeenCalled()`, and that the
`tables` row and history count are untouched.

**Probe V3:** neutered the `length === 0` clause. `REFUSE-badbody` reddened, **and only it**
(1 failed / 20 passed). Reverted.

### Claim 3 — no force/override path exists ✓ VERIFIED

Covered in criterion 3 above. Worth restating the strongest form: the test file itself records that
there is nothing to exercise — *"there is no second argument to pass, no `{ force: true }` to omit,
and no findings-acknowledgement call to skip"* — the absence is a property of the input type, which
`tsc --noEmit` enforces. That is the honest shape for an unprovable-by-grep negative, and it is what
shipped.

### Claim 4 — the renderer does not re-flatten types ✓ VERIFIED

`TYPE_NAMING_REFINEMENTS` = `[timestamp, datetime, date, time, boolean, bool, wkt, wkb]`, emitted
**bare** by `renderColumnType`, ahead of `formatFingerprint`. Rationale in-file: the web's
`normalizeType` strips the parenthetical, so `long(timestamp)` → `long` ∈ `NUMERIC_TYPES` (a
timestamp column would classify as a **number**) and `string(wkt)` → `string` ∉
`EXCLUDED_DRILLDOWN_TYPES` (a geometry column would be admitted to the drill-down picker, the exact
thing PITFALL D-01 exists to prevent).

`PARITY-class` asserts against the **SHIPPED** classifier — `classifyFingerprint` imported from
`packages/server/src/lib/columnTypeClass.ts` — not a hardcoded expected-class table. I confirmed the
import (line 19) and the loop body (`const expected = classifyFingerprint(f.fp)`). It is paired with
`PARITY-class-naive`, a counter-proof requiring **at least one** fixture to disagree under the naive
renderer and naming `col_ts` specifically, so the sweep cannot pass against a renderer that does
nothing. `webInfer` in the spec is a faithful re-implementation of the web's
`inferDataTypeFromColumn` branch order — I diffed it against `packages/web/src/lib/columnTypes.ts:85-97`
line by line; identical.

**Probe V4:** made `renderColumnType` return `formatFingerprint(fp)` for named markers.
**8 tests reddened** — `RENDER-temporal`, `RENDER-temporal-all`, `RENDER-boolean`, `RENDER-spatial`,
`RENDER-multi`, `RENDER-map`, `PARITY-class`, `PARITY-drilldown`. Reverted.

### Claim 5 — `packages/web` untouched ✓ VERIFIED

`git diff --name-only 688ff43 HEAD | grep -c '^packages/web/'` = **0**. The full change set is 4
server source/test pairs + `.planning`. Nothing else.

### Claim 6 — apply and history routes double-gated ✓ VERIFIED

All three routes carry `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` **and**
`...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` — the same AND-gate spread as the
Phase 122/124 `GET .../schema-check` precedent and the v1.24 dashboard-import route.

| Route | DATASETS_MANAGE | DASHBOARDS_MANAGE_ACCESS | requireConfig |
|---|---|---|---|
| `POST /api/tables/:id/schema-apply` | ✓ | ✓ | ✓ |
| `GET /api/tables/:id/sync-history` | ✓ | ✓ | — (documented: no Kinetica connection; column-display-config / custom-metrics precedent) |
| `DELETE /api/tables/:id/sync-history/:entryId` | ✓ | ✓ | — (same) |

Named tests: `GATE-analyst`, `GATE-datasets-only` (*"the second half of the AND-gate is enforced"*),
`GATE-admin`, `READ-gate`, `DELETE-gate`.

**Probe V5:** removed the `DASHBOARDS_MANAGE_ACCESS` spread from `GET .../sync-history`.
`READ-gate` reddened, **and only it** (1 failed / 20 passed). Reverted.

---

## Requirements Coverage

Every ID in every plan's frontmatter, cross-referenced against `.planning/REQUIREMENTS.md`.
No orphans: `REQUIREMENTS.md` maps exactly `-13..-17` to Phase 125, and the union of the four plans'
`requirements` fields is exactly `{-13,-14,-15,-16,-17}`.

| Req | Plans claiming it | Status | Evidence verified |
|---|---|---|---|
| SSYNC-V125-13 | 02, 03, 04 | ✓ SATISFIED (server half) | `POST .../schema-apply` → `applySchemaSync` replaces `tables.columns` + `columns_fingerprint` in one `db.transaction`; `renderColumnsMap` preserves the type class. `PERSIST-diff` through the app's own read path. **Second clause ("config panels offer…") is a packages/web behaviour — see Human Verification.** |
| SSYNC-V125-14 | 02, 03, 04 | ✓ SATISFIED | Full-ROW snapshot over all four tables, non-vacuous, PLUS the `total_changes()` budget of exactly 2. Verifier probe V1 fired; probe V2 proved the budget is the guard that matters. |
| SSYNC-V125-15 | 03, 04 | ✓ SATISFIED | Type-shape enforcement, zero `force` in code, `PERSIST-breaking` + `ONLYTABLES-breaking`. |
| SSYNC-V125-16 | 01, 03, 04 | ✓ SATISFIED | `table_sync_history` capped at `SYNC_HISTORY_CAP = 20` per table (`CAP-under`, `CAP-over`, `CAP-scoped`), drop count in a separate `table_sync_history_meta` row so a per-entry delete cannot erase it (`DROPPED-count`, `DROPPED-survives-delete`), read + per-entry delete routes, both double-gated. |
| SSYNC-V125-17 | 01, 03, 04 | ✓ SATISFIED | `ts`, `actor`, `kind`, `SyncChangeset`, `ImpactReport` — byte-identical round trip (`HIST-roundtrip`), report rebuilt server-side, baseline entries store NULL/NULL (`HIST-baseline-nulls`), corrupt payload reads back null rather than throwing (`HIST-corrupt-json`). |

**Boundary check — SSYNC-V125-18 must still be OPEN:** ✓ **correct.** Checklist line 48 is `- [ ]`,
the traceability table row reads `Phase 126 — … | Pending`, and commit `5a2a303`'s message records
it as deliberately untouched. **No defect.** `SSYNC-V125-01` and `-19` are likewise still Pending
under Phase 126, as mapped.

---

## Automated Gates

| Gate | Command | Result |
|---|---|---|
| Server test gate (SET-BASED) | `cd packages/server && node scripts/test-gate.mjs` | **GATE PASSED** — 1489/1542, 8 failing files, set **exactly equal** to the 8 documented `KNOWN_FAILING` (5× TD-V11-04 OIDC, `db.smoke` schema drift, `routes.wms`). Zero rotating TD-V16 contamination on this run. |
| Server typecheck | `cd packages/server && npx tsc --noEmit` | Clean, exit 0 |
| Phase's own four specs | `npx vitest run` on the 4 changed spec files | 4 files / **73 tests** passed, after all probes reverted |
| Web | — | Not run and not applicable: **0** web files changed |
| Working tree | `git status --porcelain && git diff --exit-code` | Clean after every one of the 5 probes |

---

## Verifier Mutation Probes

Five probes, **five fired**. All reverted; tree verified clean after each.

| # | Mutation | Expected to redden | Actually reddened |
|---|---|---|---|
| V1 | value-identical `UPDATE widgets SET title = title` inside `applySchemaSync`'s transaction | criterion-2 tests | `ONLYTABLES-diff`, `-baseline`, `-breaking` (3 named, all at the budget assertion) |
| V2 | V1 **plus** budget assertion disabled | isolates the row-snapshot's power | **nothing — 12/12 green.** Confirms the snapshot alone is blind to a value-identical write |
| V3 | empty-`live` guard neutered in the apply route | `REFUSE-badbody` | `REFUSE-badbody`, and only it |
| V4 | `renderColumnType` re-flattens named markers | `RENDER-*` / `PARITY-*` | 8 named tests |
| V5 | `DASHBOARDS_MANAGE_ACCESS` removed from `GET .../sync-history` | `READ-gate` | `READ-gate`, and only it |

---

## Known Findings — confirmed handled as described

| Finding | Handling verified |
|---|---|
| Four non-discriminating acceptance criteria, two outright unsatisfiable | Reported in the SUMMARYs, never gamed. Confirmed no code was bent to satisfy them; the `\bforce\b` criterion that *did* survive is diff-anchored to added non-comment lines and I re-ran it independently. |
| `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` unreachable over HTTP | Confirmed unreachable: the route 404s on an unknown table row before `applySchemaSync` can reach its `table_missing` arm, and the Kinetica-missing case returns a 409 spread from `tableMissingResult`, a *different* string. Kept as a library contract per operator decision; the in-file comment states this explicitly. |
| `SCHEMA_APPLY_TEXT_WIDTH_GAP` has no emitter | Confirmed: exported and tested (`renderColumnType({base:"string",refinements:[]})` → `"string"`, `"text" ∈ EXCLUDED`, `"string" ∉ EXCLUDED`), attached to no response. ROADMAP **Phase 126 criterion 6** exists and names the constant and its file. Correctly carried. |
| False `dashboard_layers` timestamp claim, corrected in `52a8c0f` | Confirmed the corrected mechanism by measurement: `grep -cE "CREATE TRIGGER" packages/server/src/db.ts` = **0**. Probe V2 is the empirical demonstration. |
| Probe P10 initially did not fire; the TEST was strengthened twice, the probe never weakened | Confirmed by outcome: my own P10-equivalent (V1) fires at `expectRowWriteBudget`, a guard that exists *because* the earlier, weaker test could not see it — and V2 shows the weaker test still cannot. |

---

## Anti-Pattern Scan

Scanned all 4 changed source/test files for `TODO|FIXME|XXX|HACK|PLACEHOLDER|coming soon`,
empty implementations and `console.log`-only bodies.

**Zero blockers. Zero warnings.** The one comment block matching a "gap" keyword is
`SCHEMA_APPLY_TEXT_WIDTH_GAP`'s `KNOWN GAP, carried deliberately rather than papered over` —
a deliberate, operator-ratified, Phase-126-scheduled limitation, not a stub.

All fixtures are synthetic (`demo_schema.demo_table`, `col_a`/`col_b`/`col_ts`/`col_gone`,
`demo_operator`) — no real Kinetica table or column name on any added line, as the plans required.

---

## Non-Blocking Findings (not gaps against the goal)

**DOC-1 (warning) — `.planning/REQUIREMENTS.md` coverage rollup is stale.**
Line 105 still reads `**Complete: 11**` and enumerates only Phases 122-124, while the checklist
(`-13`..`-17` all `[x]`) and the traceability table (all five `Complete`) say otherwise. It should
read **16**. Plan 125-04 named `.planning/REQUIREMENTS.md — SSYNC-V125-13..-17 marked complete` as
an artifact; commit `5a2a303` updated both per-requirement surfaces but left the rollup. Confirmed
by `git show 5a2a303 -- .planning/REQUIREMENTS.md | grep "Complete: "` → no hit. One-line fix; I did
not make it, per the write-only-VERIFICATION.md instruction.

**DOC-2 (info) — `125-04-SUMMARY.md` self-contradicts on the checkpoint.**
Its `**Status:**` paragraph and What-shipped row 3 still say the blocking checkpoint is UNANSWERED /
awaiting the operator; the frontmatter and § `Checkpoint (Task 3)` say APPROVED 2026-09-28. Commit
`3d86f2b` closed the checkpoint in two places and missed two others. The checkpoint **is** closed —
six strings approved as written.

**MIRROR-1 (info) — one unguarded web→server mirror.**
`WEB_EXCLUDED_DRILLDOWN_TYPES` in `lib.schemaApply.spec.ts` is hardcoded from the web original and
has no `MIRROR-PARITY` assertion behind it, unlike `NUMERIC_TYPES` / `BOOLEAN_TYPES` /
`DATETIME_TYPES` / `normalizeType`. I hand-verified it is byte-equal to
`packages/web/src/lib/columnTypes.ts:29-38` **today** (8 members, same order). If the web set ever
changes, nothing reddens — and `PARITY-drilldown` would keep asserting against a stale taxonomy.
Cheap to close whenever the columnTypeClass mirror spec is next touched.

---

## What I Could NOT Verify (stated plainly, not marked passed)

1. **SSYNC-V125-13's second clause — "config panels offer the current Kinetica columns."**
   This is `packages/web` behaviour. This phase changes **zero** web files (by design), and the repo
   has no cross-package imports, so the server proves it by *mirroring* the web taxonomy in a spec
   and asserting against the shipped `classifyFingerprint`. That is the strongest evidence available
   without editing `packages/web` — but it is a mirror, not an execution. Phase 126 owns the UI.

2. **Anything live.** Every test in this phase mocks `fetch`. No apply was run against a real
   Kinetica table. 125-CONTEXT.md records that five of nine registered tables have been dropped from
   Kinetica, so most live checks return `table_missing`; Phase 126 owns operator verification.

3. **The six operator-facing strings.** Approved by the operator at the blocking checkpoint
   (2026-09-28). Wording quality is not machine-verifiable and I did not re-litigate it.

4. **Rotating test contamination.** The gate passed with the failing set *exactly* equal to the 8
   documented `KNOWN_FAILING` on this run, with zero extras. Per TD-V16-TEST-ISOLATION that set
   rotates, so a future run may show extras that are contamination rather than regression — I
   observed one run, not a distribution.

---

## Gaps Summary

**None blocking.** All five ROADMAP success criteria are verified against the codebase, not against
the SUMMARYs — and the phase's single highest-stakes claim (criterion 2) was re-derived from scratch
with a two-stage probe that both confirmed the guard fires *and* confirmed that the weaker,
obvious-looking guard would not have. All five requirements owned by the phase are genuinely
satisfied; `SSYNC-V125-18` is correctly still open.

The one thing worth an orchestrator action before the phase is closed is **DOC-1**: the
`REQUIREMENTS.md` coverage rollup understates the milestone by five requirements. That is
bookkeeping, not a deliverable, so it does not move the status — but it is the kind of quiet
inconsistency this project has been bitten by, and it costs one line to fix.

---

_Verified: 2026-09-28_
_Verifier: Claude (gsd-verifier)_
_5 mutation probes run by the verifier, 5 fired, all reverted, `git diff --exit-code` clean_
