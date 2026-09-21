---
phase: 120-import
plan: 05
subsystem: api
tags: [dashboard-export-import, id-remapping, mutation-testing, requirements-closure, sqlite, better-sqlite3, typescript]

# Dependency graph
requires:
  - phase: 120-import
    plan: 01
    provides: "visitWidgetConfigRefs/visitFilterSelectionRefs, collectWidgetConfigRefs, remapWidgetConfigRefs/remapFilterSelection"
  - phase: 120-import
    plan: 02
    provides: "validateImportFile, resolveTables, resolveCustomMetrics, ImportReport"
  - phase: 120-import
    plan: 03
    provides: "applyDashboardImport — two-pass create-then-rewrite inside one transaction"
  - phase: 120-import
    plan: 04
    provides: "POST /api/dashboards/import route, gated on dashboards:create AND datasets:manage"
provides:
  - "routes.dashboard-import.refs.spec.ts — the direct, per-reference-kind proof that every one of the eight reference kinds points at the NEWLY created/matched record through the real HTTP route, against a fixture deliberately armed so a no-op remapper would still 'work'"
  - "Phase 120 requirement closure — DXIM-V124-03/-04/-05/-06/-07/-09/-10/-11 marked automated-complete in REQUIREMENTS.md, with the one-database limitation and REF-2/-4/-5 fixture-only status stated as an explicit Phase 121 hand-off"
affects: ["121"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Armed-fixture id remapping proof: export a real dashboard, rewrite ONLY tables[].schema before import, so table/metric ids remap genuinely old->new while every OTHER old id (widget/layer/dynamicView) still resolves to a real pre-existing record — the exact shape a no-op remapper would render as 'working'"
    - "Per-kind sweep, never a merged set: IMPNEW-sweep drives the SHIPPED collectWidgetConfigRefs per kind against that same kind's old-id set, because independent AUTOINCREMENT counters per table make a merged-Set comparison produce false positives"

key-files:
  created:
    - packages/server/tests/routes.dashboard-import.refs.spec.ts
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "The fixture is armed by rewriting ONLY file.tables[].schema to \"kbi_target\" before POST /api/dashboards/import — the single change that forces genuinely old->new table/metric id maps (tables no longer match by schema.name, so they are CREATED; the new tables carry no custom metrics, so metrics are CREATED too) while every OTHER old id (widget/layer/dynamicView) still resolves to the original kitchen-sink dashboard's own untouched rows. IMPNEW-decoy asserts that trap stays armed."
  - "IMPNEW-sweep compares PER KIND against collectWidgetConfigRefs's five separate arrays, never one merged id Set — a merged set would false-positive because a correctly remapped NEW widget id can coincidentally equal an OLD table id in a small fixture (independent AUTOINCREMENT counters per table)."
  - "M11 (the probe A2 from Plan 120-03 explicitly deferred here) required neutralizing the Pass-2 rewrite-count invariant in the same mutation, matching what Plan 120-03's own A6 probe already established — otherwise the mutation just throws and rolls back the whole transaction, masking the defect instead of exposing it as sweep-detectable OLD ids left in a widget's config."
  - "Requirements closure is explicitly NOT operator-verified: DXIM-V124-03/-05/-10 are marked automated-complete here, with REQUIREMENTS.md's traceability table carrying a dedicated note that Phase 120's proof runs in ONE database and that REF-2/-4/-5 have never been exercised outside a fixture — Phase 121 must exercise a real dashboard with a custom metric AND a dynamic view before its cross-environment round trip."

requirements-completed: [DXIM-V124-03, DXIM-V124-04, DXIM-V124-05, DXIM-V124-06, DXIM-V124-07, DXIM-V124-09, DXIM-V124-10, DXIM-V124-11]

# Metrics
duration: ~40min
completed: 2026-09-17
---

# Phase 120 Plan 05: Per-Reference-Kind NEW-id Proofs + Requirement Closure Summary

**23 new integration tests prove, through the real `POST /api/dashboards/import` route and a fixture deliberately armed so a no-op remapper would still "work," that every one of the eight reference kinds is rewritten to the NEWLY created/matched record — 12/12 mutation probes fired on the first attempt, the SET-BASED server gate passed, and Phase 120 closes with 8 DXIM-V124 requirements marked automated-complete and the milestone's real cross-environment proof explicitly deferred to Phase 121.**

## Performance

- **Duration:** ~40 min (commits span 2026-09-17T02:27:49 → 02:47:59 local; file reads and the
  12-probe verification sequence preceded/interspersed the first two commits)
- **Completed:** 2026-09-17
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `routes.dashboard-import.refs.spec.ts` proves, per reference kind, through the real HTTP route
  (never a direct `applyDashboardImport` call — confirmed absent from the file), that each of the
  eight reference kinds (REF-1..8) plus the sixth-site layer `filter_scope` and the
  `dashboard_tables` union edge point at the NEWLY created/matched record, not the file's old id —
  each proof also confirms the OLD record is left untouched.
- The fixture is proven ARMED: `IMPNEW-decoy` confirms every old id the file references (widgets,
  layers, the dynamic view, both custom metrics, the widget table) still resolves to a real,
  pre-existing record in the target after import — the exact condition that makes a skipped-remap
  defect silent rather than a crash.
- `IMPNEW-sweep` re-drives the SHIPPED `collectWidgetConfigRefs` over every imported widget's config,
  compared **per kind** against that same kind's old-id set (per the plan-checker's Task-1
  correction) — a catch-all for a ninth reference kind nobody has enumerated yet.
- All three rewrite traps (`IMPTRAP6` empty `includedLayerIds` sentinel, `IMPTRAP7`
  `__spatial_draws__` sentinel + order preservation + no null/undefined entries, `IMPTRAP8` legacy
  singular `action`) verified end to end through the route.
- `ROUNDTRIP-shape`/`ROUNDTRIP-refs` recorded and explicitly labeled as weaker, self-consistency-only
  evidence in both the spec header and this SUMMARY — never presented as proof against a foreign
  environment.
- 12/12 Task-2 mutation probes fired on the FIRST attempt — no test required strengthening.
- Phase 120 closed: `npx tsc --noEmit` clean on both stacks, the SET-BASED server gate exited 0
  (`GATE PASSED`), `packages/web` carries zero diff from this phase, and 8 DXIM-V124 requirements
  are marked automated-complete in `REQUIREMENTS.md` with an explicit, prominent limitation note.

## Task Commits

1. **Task 1: Per-reference-kind NEW-id proofs, end to end through the route** - `34b2d4a` (test) —
   23 tests (11 `IMPNEW-REF*` main proofs across all 8 kinds, 3 `IMPNEW-REF2/-4/-5` extra proofs,
   1 `IMPNEW-decoy`, 1 `IMPNEW-union`, 1 `IMPNEW-sweep`, 4 `IMPTRAP*`, 2 `ROUNDTRIP-*`)
2. **Task 2: 12 mutation probes** - `83a5545` (test) — probe record appended to the spec file's header
3. **Task 3: full SET-BASED gate + phase closeout** - `878060b` (docs) — REQUIREMENTS.md /
   ROADMAP.md / STATE.md updated manually (gsd-tools cannot parse this project's formats — see below)

**Plan metadata:** (this commit, following this SUMMARY)

## 12-Row Mutation Probe Table (12/12 fired, ZERO required strengthening)

| # | Mutation | Test(s) reddened | Fired on first attempt? |
|---|---|---|---|
| M1 | Deleted the REF-1 `tableId` block from `visitWidgetConfigRefs` | `IMPNEW-REF1:` | YES |
| M2 | Deleted the REF-2 `dynamicViewId` block | `IMPNEW-REF2:` (config site) | YES |
| M3 | Deleted the REF-3 `sourceMapWidgetId` block | `IMPNEW-REF3:` | YES |
| M4 | Deleted the REF-4 scalar `metricId` block | `IMPNEW-REF4:` (config site) + 2 side-effect tests (see note) | YES |
| M5 | Deleted the REF-5 `metrics[]` loop | `IMPNEW-REF5:` (config site) + 1 side-effect test | YES |
| M6 | Deleted the REF-6 `includedLayerIds` loop | `IMPNEW-REF6:` | YES |
| M7 | Deleted the REF-7 `filterSelection` call (config site) | `IMPNEW-REF7:` (config site) + `IMPTRAP7:` (order) | YES |
| M8 | Deleted the REF-8 `options[]` loop | all three `IMPNEW-REF8:` tests | YES |
| M9 | Skipped the Pass-2 layer `filter_scope` update | `IMPNEW-REF7:` (sixth site) + `IMPTRAP7:` (null/undefined) | YES |
| M10 | Mapped `dashboardTableIds` through identity instead of `maps.table` | `IMPNEW-union:` + `ROUNDTRIP-shape` | YES |
| M11 | **(deferred probe A2 from Plan 120-03)** widget placeholder `config: w.config`, Pass-2 skips the LAST widget, invariant neutralized | `IMPNEW-sweep:` (target) + all three `IMPNEW-REF8:` + `ROUNDTRIP-refs` | YES |
| M12 | REF-7 naive `arr.map` with no `asId` sentinel gate | BOTH `IMPTRAP7:` tests (target) + `IMPNEW-REF7:` config site | YES |

**12/12 fired on the FIRST attempt.** M4/M5's extra side-effect failures are a genuine, expected
consequence of Phase 120-01's "one traversal, two directions" design — deleting a `visitWidgetConfigRefs`
block removes that reference kind from BOTH collect (export) and remap (import), so the metric is
never even collected into `file.customMetrics` at export time, cascading into the REF-4/-5 "extra
proof" tests as well. M11 correctly fires the named target (`IMPNEW-sweep`) plus a wider blast radius
because the skipped widget (Radio, the fixture's last widget by position) carries REF-8 sites too —
recorded as expected, not a gap.

### Phase-wide mutation-probe tally

10 (120-01) + 6 (120-02) + 6 (120-03) + 5 (120-04) + 12 (120-05) = **39/39 probes fired**. Three
required a test strengthened before they discriminated (V5/120-02, A3/120-03, R1+R2/120-04, each
already documented in their own SUMMARY); this plan's 12 needed none.

## Server Gate — GATE PASSED (SET-BASED, no pass-count recorded)

```
node scripts/test-gate.mjs
...
GATE PASSED — every failing file is either documented or contamination-only.
```

- **Known-failing (8, pre-existing, documented in `KNOWN_FAILING`):** `tests/auth.oidc.spec.ts`,
  `tests/auth.routes.spec.ts`, `tests/boot.hardening.spec.ts`, `tests/boot.wipe.spec.ts`,
  `tests/bootstrap.spec.ts`, `tests/db.smoke.spec.ts`, `tests/oidc.module.spec.ts`,
  `tests/routes.wms.spec.ts` — all TD-V11-04 (OIDC issuer-mock) or pre-existing documented issues,
  none touched by this phase.
- **Contamination-only (1, passed alone):** `tests/auth.login-rbac.spec.ts` — TD-V16-TEST-ISOLATION.
- **No other unknown failure** — the gate reported zero real (fails-in-isolation) failures.
- No pass-count is recorded anywhere in this SUMMARY or the planning docs, per the SET-BASED rule.

## Both-Stack tsc / packages/web Untouched

- `cd packages/server && npx tsc --noEmit` → zero output.
- `cd packages/web && npx tsc --noEmit` → zero output.
- **Base commit used for the `packages/web` untouched check: `3aba760`** (the commit immediately
  preceding Plan 120-01's first commit `542e802` — i.e. the last commit before Phase 120 began).
  `git diff --stat 3aba760..HEAD -- packages/web` → empty, both before this plan's own commits and
  after. (Unrelated in-flight `packages/web` changes exist in the working tree from other work on
  this branch — deliberately excluded from this check by scoping to the phase-base commit rather
  than raw `git status`, per the plan's own instruction.)
- `git diff --exit-code -- packages/server/tests/lib.dashboardExportRefs.spec.ts
  packages/server/tests/routes.dashboard-export.spec.ts packages/server/tests/errorMiddleware.spec.ts`
  → exits 0 — no Phase 119 or pre-existing regression spec was touched anywhere in Phase 120.

## What This Phase Did NOT Prove (stated prominently, per the plan's own instruction)

- **Cross-environment portability.** Every proof in this plan runs inside ONE SQLite database. The
  fixture is armed to force genuinely old->new table/metric id maps by rewriting `tables[].schema`,
  but widget, layer and dynamicView ids are never actually foreign — they are the same connection's
  own pre-existing rows. This proves reference REMAPPING; it does not prove that an export produced
  on one server imports correctly on a genuinely different one. **Phase 121's operator round-trip
  between two real environments is the actual proof of the milestone's stated purpose.**
- **REF-2 (`dynamicViewId`), REF-4 (scalar `metricId`) and REF-5 (`metrics[].metricId`) have never
  been exercised outside a fixture.** The operator's real Phase 119 export (dashboard id 4, "Test
  Dashboard") contained no dynamic views and no custom metrics, so these three reference kinds have
  only ever been proven against test-constructed data. **Flagging for Phase 121 planning: the
  operator should be asked to build a dashboard using a custom metric AND a dynamic view before the
  cross-environment round trip**, or these three kinds will still never have run outside a test.
  This is recorded as an explicit hand-off requirement in both `REQUIREMENTS.md`'s traceability
  table and `STATE.md`'s Current Position.
- The round trip tests (`ROUNDTRIP-shape`/`ROUNDTRIP-refs`) are self-consistency evidence only — a
  self-consistent import can still be wrong about what a FOREIGN environment's pre-existing records
  mean; they do not substitute for the per-kind `IMPNEW-REF*` proofs or for Phase 121's UAT.

## Acceptance Criteria That Did Not Discriminate (across all five 120-* plans, honestly reported)

None found by this plan beyond what was already reported and fixed in Plans 02-04 (V5/120-02,
A3/120-03, R1+R2/120-04 — see their own SUMMARYs for the "cannot fail" finding and the fix). This
plan's own acceptance criteria were run before commit and all discriminated correctly:
- The plan's stated "before" count for `^- \[x\] 120-0` in ROADMAP.md (`0`, confirmed at the plan's
  own authoring time before ANY Phase 120 plan executed) was, by THIS plan's execution time, already
  `4` — Plans 120-01 through 120-04 had each checked their own box as they completed. This is
  authoring-time staleness, not a broken criterion: the criterion's actual claim ("after: 5") was
  verified true and is the only thing that matters for closing the phase.

## Process Note (per the plan's own warning 10)

`gsd-tools state advance-plan` and `roadmap update-plan-progress` are confirmed, as with all four
prior 120-* plans, unable to parse this project's `STATE.md`/`ROADMAP.md` formats — not attempted
this time, given the established pattern; `STATE.md`/`ROADMAP.md`/`REQUIREMENTS.md` were all updated
manually in the existing style in the Task 3 commit (`878060b`).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 120 (Import) is COMPLETE. Phase 121 (UI + Cross-Environment Verification) is next, depends on
Phases 119 and 120 (both complete), and is not yet planned. Its requirements are DXIM-V124-01,
DXIM-V124-03, DXIM-V124-10 (already automated-complete here and in Phase 119, but re-verified by
Phase 121's UI + real operator round-trip per the milestone's own phase map). **Hand-off requirement
for Phase 121 planning:** exercise a real dashboard with a custom metric AND a dynamic view before
the cross-environment round trip, per the limitation stated above.

## Self-Check: PASSED

- FOUND: `packages/server/tests/routes.dashboard-import.refs.spec.ts`
- FOUND: `.planning/phases/120-import/120-05-SUMMARY.md`
- FOUND commit: `34b2d4a` (Task 1)
- FOUND commit: `83a5545` (Task 2)
- FOUND commit: `878060b` (Task 3)

---
*Phase: 120-import*
*Completed: 2026-09-17*
