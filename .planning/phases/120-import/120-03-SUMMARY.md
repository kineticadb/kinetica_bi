---
phase: 120-import
plan: 03
subsystem: api
tags: [dashboard-export-import, atomicity, sqlite-transaction, better-sqlite3, typescript]

# Dependency graph
requires:
  - phase: 120-import
    plan: 01
    provides: "RefIdMaps, emptyRefIdMaps, remapWidgetConfigRefs, remapFilterSelection"
  - phase: 120-import
    plan: 02
    provides: "validateImportFile, resolveTables, resolveCustomMetrics, ImportReport"
provides:
  - "applyDashboardImport(file) — the whole two-pass create-then-rewrite sequence inside one db.transaction, returning ImportReport"
affects: ["120-04", "120-05"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass import: Pass 1 creates every entity with a placeholder (widget config: {}), accumulating five old->new id maps; Pass 2 rewrites every widget config and layer filter_scope only once ALL FIVE maps are complete — the only ordering that satisfies the widget<->layer reference cycle"
    - "Custom metrics created LAST in Pass 1 (after tables/dashboard/dynamicViews/widgets/layers) to maximise how much already-written work a mid-import failure must roll back"
    - "SQLite RAISE(ABORT) trigger, installed and dropped per test (never a production seam), proves atomicity at three points instead of one natural (and, per Plan 120-02, no-longer-reachable) constraint fault"

key-files:
  created:
    - packages/server/tests/lib.dashboardImport.apply.spec.ts
  modified:
    - packages/server/src/lib/dashboardImport.ts

key-decisions:
  - "RESEARCH Q5's natural fault (seed a UNIQUE(table_id, label) collision) is NOT reachable: Plan 120-02's resolveCustomMetrics does a fresh listCustomMetrics lookup per metric and REUSES an exact label match rather than colliding with it, so an out-of-band-seeded row is matched, never collided with. A SQLite RAISE(ABORT) trigger was used instead — zero test-only production code, fully deterministic, and attachable at multiple points (widgets, layers, custom_metrics) rather than only one."
  - "The widget placeholder is `config: {}`, never `w.config` — both because the real config cannot be written until Pass 2 (it may reference a sibling widget or a layer with no new id yet) and because writing the file's OLD ids into the target means a missed Pass-2 rewrite would silently point at a pre-existing record; `{}` instead produces a visibly EMPTY widget."
  - "A3's mutation probe (moving the widget-config rewrite into the Pass-1 widget-creation loop — the 'rewrite-as-you-go' shortcut `<the_cycle>` explains cannot work) did NOT redden any existing test on first attempt: no test previously verified a REAL, resolvable includedLayerIds rewrite, only the deliberately-dangling strip. Per CLAUDE.md's non-discriminating-criterion rule, a new test was added asserting a widget's includedLayerIds resolves to the NEW layer id — this reddens correctly under A3, proving the two-pass ordering is load-bearing rather than incidental."
  - "A2's mutation probe (widget placeholder `config: w.config` instead of `{}`) does NOT redden anywhere in this spec, and is not expected to: Pass 2 still unconditionally overwrites the placeholder with the rewritten config regardless of what the placeholder started as, so the intermediate value is never observable from outside the transaction. The real discriminating test — a widget referencing a sibling not yet created reading a stale OLD id for one JSON round-trip — is a Plan 120-05 per-reference-kind correctness proof; recorded as deferred rather than invented locally."

requirements-completed: []
# Frontmatter lists DXIM-V124-03/-04/-09/-10 as this plan's target requirements, but per this
# plan's own warning 10, NO DXIM requirement is marked complete here — closure remains Plan
# 120-05's explicit responsibility.

# Metrics
duration: ~35min
completed: 2026-09-16
---

# Phase 120 Plan 03: applyDashboardImport — Two-Pass Transaction + Atomicity Summary

**The whole two-pass create-then-rewrite import sequence — Pass 1 creates every entity with a placeholder while accumulating five old→new id maps, Pass 2 rewrites every widget config and layer filter_scope once all five maps are complete — inside one `db.transaction`, with three SQLite `RAISE(ABORT)` triggers proving rollback reaches backward across seven tables at three different points in the sequence.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-16
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `applyDashboardImport` implements the exact two-pass sequence `<the_cycle>` specifies: tables →
  dashboard → dynamic views → widgets (placeholder `config: {}`) → layers → custom metrics (Pass
  1, in that order — metrics deliberately last), then widget config rewrite → layer
  `filter_scope` rewrite → `dashboard_tables` union edge (Pass 2), all inside exactly one
  `db.transaction(...)` call, invoked immediately and returning the `ImportReport`.
- The fixture is built by seeding a real dashboard through the normal `create*` accessors and
  exporting it via `buildDashboardExport` — a REAL export, never a hand-written approximation
  that could drift from the envelope shape (per the plan's explicit instruction).
- Always-new ids proven against a REAL collision: since `AUTOINCREMENT` never reuses an id
  through the normal accessors even across `DELETE`, the collision fixture directly inserts
  "pre-existing" dashboard and widget rows at the EXACT ids the file carries (raw `db.prepare`
  inserts), then proves those rows are byte-identical after import and every newly created id
  differs from every id the file carries.
- Atomicity proven at three points — first widget insert, first layer insert, and the LAST
  creation step (custom metrics) — each asserting a full seven-table row-count snapshot
  (`countRows()`) is unchanged, not merely that the failing table itself received no row. An
  `ATOMIC-clean` control (no trigger) runs last and would fail loudly if any trigger had leaked,
  rather than silently reddening an unrelated spec file later.
- The report names the new dashboard id (always different from the file's), tables matched vs
  created (union covers every file table), metrics created with target ids, and every stripped
  reference with its kind and OLD id.
- 6/6 mutation probes run for real against the committed source; one (A3) required strengthening
  its test before it discriminated, one (A2) confirmed genuinely non-discriminating here and
  explicitly deferred to Plan 120-05 rather than faked locally.
- Zero test-only seam in production code: `grep -ciE "failAfter|__testFail|testOnly" src/lib/dashboardImport.ts` → 0.

## Task Commits

1. **Task 1: applyDashboardImport — two-pass create-then-rewrite inside one transaction** - `af42f67` (feat) — 16 tests (`APPLY-create` ×6, `REPORT-` ×5, `NEWID-collision` ×5)
2. **Task 2: three trigger-induced rollback proofs** - `b05f25f` (test) — 7 `ATOMIC-` tests, 23 total in the file
3. **Task 3: 6 mutation probes** - `d2b7a27` (test) — probe record in the spec file's header; one new `APPLY-create` test added to strengthen A3, bringing the file to 24 tests

**Plan metadata:** (this commit, following this SUMMARY)

## Exported Symbol

From `packages/server/src/lib/dashboardImport.ts` (Plan 120-04 imports this verbatim):

```
applyDashboardImport(file: DashboardExportFile): ImportReport
```

## Divergence from RESEARCH Q5

RESEARCH Q5 recommended seeding the target with a `(table_id, label)` pair that collides with an
imported metric, letting SQLite's real `UNIQUE(table_id, label)` constraint fire naturally. **This
fault is no longer reachable**: Plan 120-02's `resolveCustomMetrics` performs a fresh
`listCustomMetrics(newTableId)` lookup per metric and REUSES any exact label match rather than
attempting a duplicate insert — any row a test seeds out-of-band is visible to that same lookup,
so import matches it instead of colliding with it. Research designed the fault before the
matching rule existed; this is stated plainly rather than pretended away.

A SQLite `CREATE TRIGGER ... BEFORE INSERT ... RAISE(ABORT)` was used instead, per the plan's own
`<atomicity_design>`. It is strictly better than both alternatives research considered: zero
test-only code ships in production (unlike a `failAfter` seam), it is fully deterministic (unlike
a constraint race), and it can be attached to ANY table — so rollback is proven at THREE points
(widgets, layers, the LAST step custom_metrics) rather than only one. Each test installs the
trigger, asserts `applyDashboardImport` throws, and drops the trigger in a `finally` — with a
defensive `DROP TRIGGER IF EXISTS` also in `beforeEach` so a crashed test cannot poison the next
one. `ATOMIC-clean` (no trigger, run last) is the leak-detection control.

## Mutation Probe Table (6/6 run; 1 required strengthening)

| # | Mutation | Result |
|---|---|---|
| A1 | Removed `db.transaction(...)`, called the body directly | Reddened every `ATOMIC-` rollback test — confirmed |
| A2 | Widget placeholder `config: w.config` instead of `{}` | Did NOT redden anywhere in this spec (Pass 2 always overwrites the placeholder before the transaction commits) — confirmed non-discriminating here; real proof deferred to Plan 120-05 |
| A3 | Moved the widget-config rewrite into the Pass-1 widget-creation loop ("rewrite-as-you-go") | Did NOT redden on first attempt — no test verified a REAL resolvable `includedLayerIds` rewrite. STRENGTHENED with a new test; reddens correctly after strengthening |
| A4 | Skipped `addDashboardTable` (step 9) entirely | Reddened the `dashboardTableIds` re-association test — confirmed |
| A5 | Dropped the Pass-2 layer `filter_scope` update | Reddened the layer `filter_scope` assertion — confirmed |
| A6 | Skipped the last widget, deleted the rewrite-count invariant | Reddened the `NEWID-collision` config-`{}` test — confirmed |

Full narrative, including exactly which line reddened and why, is in the spec file's own header
comment (`MUTATION PROBES (Plan 120-03 Task 3)`).

## A3 — the ordering claim `<the_cycle>` makes, proven by a test that had to be built

The plan's own Task 3 anticipated A1 and A3 as "the two that matter most." A1 fired immediately.
A3 did not — on inspection, every prior assertion touching a widget's config only checked the
ONE deliberately-dangling reference (an unresolvable `dynamicViewId` seeded into the fixture for
the `REPORT-` stripped-reference test), never a REAL, resolvable cross-entity reference. Moving
the widget rewrite into the widget-creation loop is invisible to that assertion because the
dangling reference strips identically either way. A new test —
`APPLY-create: a widget's includedLayerIds resolves to the NEW layer id...` — was added, asserting
the "Fixture Map" widget's `includedLayerIds` equals `[newLayerId]`. Under A3, layers do not exist
yet when this widget's config is rewritten, so the reference is stripped to `[]` instead — the
test reddens correctly. This is recorded per CLAUDE.md's "non-discriminating criterion" rule: the
gap was in the test, not in the mutation or the source, and the fix was to verify the real
requirement directly rather than accept a probe that could not fail.

## No Ordering Constraint `<the_cycle>` Missed

No additional cycle or ordering dependency beyond the widget↔layer one `<the_cycle>` already names
was found. Dynamic-view resolution, table resolution, and the `dashboard_tables` union edge each
depend on exactly one prior map (`table`, and `widget` for `filter_scope`) and nothing depends
forward on anything created later in Pass 1 except through the two already-named JSON sites.

## Deviations from Plan

### Auto-fixed / strengthened

**1. [Rule 3 — non-discriminating mutation probe, per CLAUDE.md] A3's probe test strengthened**
- **Found during:** Task 3, running the A3 probe.
- **Issue:** No existing test asserted a widget's config after import contains a REAL, resolved
  cross-entity id (only the deliberately-dangling strip was checked), so moving the rewrite loop
  earlier was invisible to the suite.
- **Fix:** Added `APPLY-create: a widget's includedLayerIds resolves to the NEW layer id...`,
  which reddens correctly under A3.
- **Files modified:** `packages/server/tests/lib.dashboardImport.apply.spec.ts`.
- **Commit:** `d2b7a27`.

No other deviations. Task 1's implementation matched the plan's `<action>` pseudocode exactly,
including the `?? null` map-miss comment on `dynamic_view_id`, the always-`JSON.stringify` rule
for `filter_scope`, and the "pass 2 rewrote N of M widgets" invariant.

## Issues Encountered

See "A3 — the ordering claim `<the_cycle>` makes, proven by a test that had to be built" above —
the only substantive finding beyond straightforward implementation of the plan's pseudocode.

## User Setup Required

None — no external service configuration required.

## Process Note (per plan's own warning 9)

`gsd-tools state advance-plan` and `roadmap update-plan-progress` are expected to fail to parse
this project's STATE.md/ROADMAP.md formats (as with all prior 119/120 waves). STATE.md and
ROADMAP.md are updated manually in the existing style in the commit following this SUMMARY.

## Next Phase Readiness

Plan 120-04 (`POST /api/dashboards/import` route) can import `applyDashboardImport` directly from
`packages/server/src/lib/dashboardImport.ts`, calling it only after `validateImportFile` has
accepted the body (per this plan's explicit contract — `applyDashboardImport` never validates
itself). No DXIM requirement was marked complete this plan — closure remains Plan 120-05's
responsibility, per this plan's warning 10.

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/dashboardImport.ts`
- FOUND: `packages/server/tests/lib.dashboardImport.apply.spec.ts`
- FOUND commit: `af42f67` (Task 1)
- FOUND commit: `b05f25f` (Task 2)
- FOUND commit: `d2b7a27` (Task 3)

---
*Phase: 120-import*
*Completed: 2026-09-16*
