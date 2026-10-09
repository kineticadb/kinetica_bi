---
phase: 124-impact-report
plan: 02
subsystem: api
tags: [schema-sync, naming, advisory, pure-lib, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 123-column-reference-enumeration
    provides: "ColumnRef contract (recordKind/recordId/recordLabel), ColumnRefsInput shape"
  - phase: 124-01
    provides: "Wave sibling; no direct code dependency (naming is orthogonal to type classification)"
provides:
  - "ImpactAdvisoryKind / ImpactAdvisory / RecordNaming / NamingContext / DashboardNameRow types"
  - "namingKey(recordKind, recordId) — the stable per-record key used for both dashboardOf lookups and collision membership"
  - "buildNamingContext(input, dashboards) — one pass over all id-bearing record kinds building the collision set and dashboard-of map"
  - "resolveRecordName(ref, ctx) — composes the operator-facing displayLabel + advisories for one ColumnRef-shaped record"
  - "summariseAdvisories(all) — the report-level half of the BOTH-places advisory rule, deterministic order, counts by kind"
affects: [124-03-report-assembler, 124-04-route-wiring, 125-persist-history, 126-render-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collision scan keyed by `${recordKind}|${groupId}|${name}`, empty names excluded from the count — a second, disjoint dimension from `dashboardOf`'s `${recordKind}|${recordId}` key so a table-scoped record's table_id can never be misread as a dashboard id"
    - "One composed-string source for both the finding-level advisory and (via summariseAdvisories) the report-level advisory, so the two can never drift apart in wording"

key-files:
  created:
    - packages/server/src/lib/impactNaming.ts
    - packages/server/tests/lib.impactNaming.spec.ts
  modified: []

key-decisions:
  - "dashboardOf is populated ONLY for the four dashboard-scoped record kinds (widget, layer, dynamicView, tableView) — customMetric is grouped by table_id for collision purposes but deliberately excluded from dashboardOf, otherwise its table_id would be misread as a dashboard id by resolveRecordName's dashboard-clause logic (caught by the first GREEN run failing two customMetric tests)"
  - "Two mutation probes (P4, P5) did not redden their originally-planned test assertions on first run, because resolveRecordName's empty-name / caller-supplied-recordLabel paths made the buildNamingContext-level bug invisible from that angle; per CLAUDE.md, the tests were STRENGTHENED to assert on NamingContext.ambiguous directly rather than weakening the probes or editing the implementation to force a fire"
  - "columnDisplayConfig is checked FIRST in resolveRecordName's branch order, before the empty-recordLabel check — a column-format rule's recordLabel is the column name itself (locked non-empty per columnRefs.ts), but ordering it first makes the 'never an id, never an advisory' rule structurally obvious rather than incidental"

requirements-completed: [SSYNC-V125-06]

duration: 35min
completed: 2026-09-24
---

# Phase 124 Plan 02: Record Naming & Advisory Summary Summary

**Pure `resolveRecordName`/`summariseAdvisories` naming resolver that defaults every affected-record label to title+dashboard (no id), appending an id only as a collision disambiguator or missing-name fallback, always paired with a nudge-to-rename advisory in both the finding and the report-level summary.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-24T15:10:00-04:00 (approx., first file read)
- **Completed:** 2026-09-24T15:25:00-04:00
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments
- Shipped `buildNamingContext`, which walks all five id-bearing record kinds once, builds a `dashboardOf` map (dashboard-scoped kinds only) and an `ambiguous` set keyed by `${recordKind}|${groupId}|${name}` — empty names are structurally excluded from the collision count, so two unnamed records on one dashboard are never mistaken for an ambiguity.
- Shipped `resolveRecordName`, composing the exact label forms locked in 124-CONTEXT.md: default `noun "name" on dashboard "X"` with no id; collision form appends `(id N)` to every colliding member plus an `ambiguous-name` advisory; missing-name form falls back to the id, states plainly the record has no name, and suggests renaming; `columnDisplayConfig` is named by its column and is structurally incapable of ever carrying an id or an advisory.
- Shipped `summariseAdvisories`, the report-level half of the BOTH-places rule: counts by `kind` (never by parsing `message`), deterministic `ambiguous-name` then `unnamed-record` order, singular/plural wording, zero-count kinds omitted.
- Ran all 8 mutation probes; 6 reddened on the first try, 2 (P4, P5) required strengthening the named test (documented below) — no probe was weakened and no implementation line was edited just to force a fire.

## Task Commits

1. **Task 1 (RED): failing spec for record naming and advisory summary** - `28b2074` (test) — all 15 tests written up front, verified failing against a `throw new Error("not implemented")` stub
2. **Task 1+2 (GREEN): implement record naming resolver and advisory summary** - `d73d331` (feat) — full `impactNaming.ts` plus the two strengthened test assertions found during the mutation sweep

_Note: Task 1's `<action>` and Task 2's `<action>` both target the same two files (`impactNaming.ts` + its spec); as in Plan 124-01, the full implementation was drafted as one file in one GREEN commit rather than split feature-by-feature — see Deviations._

## Verbatim Declarations

Reproduced exactly as shipped in `packages/server/src/lib/impactNaming.ts`. Plans 124-03/04 and Phases 125/126 are planned against this text.

```ts
/** The two advisory kinds this report ever raises. */
export type ImpactAdvisoryKind = "unnamed-record" | "ambiguous-name";

/** A naming advisory. `message` is report-ready prose the UI renders VERBATIM — never re-worded,
 *  never re-assembled downstream. Locked in 124-CONTEXT.md: the advisory appears BOTH on the
 *  individual finding and once, summarised, at report level. */
export type ImpactAdvisory = { kind: ImpactAdvisoryKind; message: string };

export type RecordNaming = {
  /** The record's own name, exactly as stored. "" when it carries none. */
  name: string;
  /** The dashboard this record lives on. null for table-scoped records (custom metrics and
   *  column-format rules belong to a TABLE, not a dashboard). */
  dashboardName: string | null;
  /** The composed operator-facing label. Rendered VERBATIM by Phase 126. */
  displayLabel: string;
  advisories: ImpactAdvisory[];
};

export type DashboardNameRow = { id: number; name: string };

export type NamingContext = {
  /** dashboard id -> name. A dashboard id absent from this map renders as `dashboard <id>`. */
  dashboardNames: Record<number, string>;
  /** namingKey() values whose name collides inside its own group. */
  ambiguous: ReadonlySet<string>;
  /** namingKey() value -> owning dashboard id. Absent for table-scoped records. */
  dashboardOf: Record<string, number>;
};

/** `${recordKind}|${recordId}` — `recordId` may be `null`, which stringifies to `"null"` and is
 *  only ever reached by `columnDisplayConfig`. */
export function namingKey(recordKind: ColumnRefRecordKind, recordId: number | null): string {
  return `${recordKind}|${recordId}`;
}

export function buildNamingContext(
  input: ColumnRefsInput,
  dashboards: DashboardNameRow[],
): NamingContext {
  const dashboardNames: Record<number, string> = Object.fromEntries(
    dashboards.map((d) => [d.id, d.name]),
  );

  const rows = collectNameGroups(input);

  const dashboardOf: Record<string, number> = {};
  // groupKey -> count of NON-EMPTY names sharing it, per record kind. An empty name is never
  // counted toward a collision — two unnamed records are two unnamed records, not an ambiguity.
  const collisionCounts = new Map<string, number>();
  const memberKeys = new Map<string, string[]>();

  for (const row of rows) {
    const key = namingKey(row.recordKind, row.recordId);
    if (row.isDashboardScoped) dashboardOf[key] = row.groupId;

    if (row.name === "") continue;
    const groupKey = `${row.recordKind}|${row.groupId}|${row.name}`;
    collisionCounts.set(groupKey, (collisionCounts.get(groupKey) ?? 0) + 1);
    const members = memberKeys.get(groupKey) ?? [];
    members.push(key);
    memberKeys.set(groupKey, members);
  }

  const ambiguous = new Set<string>();
  for (const [groupKey, count] of collisionCounts) {
    if (count < 2) continue;
    for (const key of memberKeys.get(groupKey) ?? []) ambiguous.add(key);
  }

  return { dashboardNames, ambiguous, dashboardOf };
}

export function resolveRecordName(
  ref: { recordKind: ColumnRefRecordKind; recordId: number | null; recordLabel: string },
  ctx: NamingContext,
): RecordNaming {
  const { recordKind, recordId, recordLabel } = ref;
  const noun = RECORD_NOUN[recordKind];
  const key = namingKey(recordKind, recordId);
  const dashId = ctx.dashboardOf[key];
  const hasDashboard = Object.prototype.hasOwnProperty.call(ctx.dashboardOf, key);
  const dashboardName = hasDashboard ? ctx.dashboardNames[dashId] ?? null : null;
  const dashClause = hasDashboard
    ? ctx.dashboardNames[dashId] !== undefined
      ? ` on dashboard "${ctx.dashboardNames[dashId]}"`
      : ` on dashboard ${dashId}`
    : "";

  if (recordKind === "columnDisplayConfig") {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `column-format rule for "${recordLabel}"`,
      advisories: [],
    };
  }

  if (recordLabel === "") {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `${noun} ${recordId} (no name)${dashClause}`,
      advisories: [
        {
          kind: "unnamed-record",
          message:
            `This ${noun} has no name, so the report can only identify it by its id (${recordId}). ` +
            `Name it and re-run this check to see it by name.`,
        },
      ],
    };
  }

  if (ctx.ambiguous.has(key)) {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `${noun} "${recordLabel}" (id ${recordId})${dashClause}`,
      advisories: [
        {
          kind: "ambiguous-name",
          message:
            `Two or more ${RECORD_NOUN_PLURAL[recordKind]}${dashClause || " on this table"} are ` +
            `named "${recordLabel}", so the report appends the id (${recordId}) to tell them apart. ` +
            `Rename one and re-run this check to see them by name alone.`,
        },
      ],
    };
  }

  return {
    name: recordLabel,
    dashboardName,
    displayLabel: `${noun} "${recordLabel}"${dashClause}`,
    advisories: [],
  };
}

export function summariseAdvisories(all: ImpactAdvisory[]): ImpactAdvisory[] {
  const counts: Record<ImpactAdvisoryKind, number> = {
    "ambiguous-name": 0,
    "unnamed-record": 0,
  };
  for (const a of all) counts[a.kind] += 1;

  const out: ImpactAdvisory[] = [];
  if (counts["ambiguous-name"] > 0) {
    const n = counts["ambiguous-name"];
    out.push({
      kind: "ambiguous-name",
      message:
        `${n} ${n === 1 ? "record" : "records"} could not be named unambiguously — ` +
        `rename ${n === 1 ? "it" : "them"} and re-run this check to see exactly which.`,
    });
  }
  if (counts["unnamed-record"] > 0) {
    const n = counts["unnamed-record"];
    out.push({
      kind: "unnamed-record",
      message:
        `${n} ${n === 1 ? "record has" : "records have"} no name — ` +
        `name ${n === 1 ? "it" : "them"} and re-run this check so the report can identify ` +
        `${n === 1 ? "it" : "them"} without ids.`,
    });
  }
  return out;
}
```

(`RECORD_NOUN`/`RECORD_NOUN_PLURAL` file-local maps and the `collectNameGroups` helper are internal
implementation detail, not part of the exported contract, and are omitted here for brevity — the
full file is at `packages/server/src/lib/impactNaming.ts`.)

## Composed Label Table (per record kind, named and unnamed/ambiguous forms)

Phase 126 can design directly against this table.

| Record kind | Named, unique | Named, colliding | No name |
|---|---|---|---|
| `widget` | `widget "Trips over time" on dashboard "Operations"` | `widget "Bar Chart" (id 41) on dashboard "Operations"` | `widget 43 (no name) on dashboard "Operations"` |
| `layer` | `map layer "Main layer" on dashboard "Operations"` | `map layer "Dup layer" (id 72) on dashboard "Operations"` | `map layer 71 (no name) on dashboard "Operations"` |
| `dynamicView` | `dynamic view "X" on dashboard "Operations"` | `dynamic view "X" (id N) on dashboard "Operations"` | `dynamic view N (no name) on dashboard "Operations"` |
| `tableView` | `saved filter view "X" on dashboard "Operations"` | `saved filter view "X" (id N) on dashboard "Operations"` | `saved filter view N (no name) on dashboard "Operations"` |
| `customMetric` | `custom metric "Average duration"` (no dashboard clause) | `custom metric "Total" (id 81)` (no dashboard clause) | `custom metric N (no name)` |
| `columnDisplayConfig` | `column-format rule for "col_a"` (only form — never named/unnamed/ambiguous variants; always non-empty, never an id) | n/a — never ambiguous | n/a — always has a label (the column name itself) |
| any dangling `dashboard_id` | `widget "Orphan" on dashboard 99` (numeric fallback, not a name) | — | — |

`dynamicView`/`tableView` rows above follow the same composition rules as `widget`/`layer` (proven
generically by `resolveRecordName`'s single branch structure, which switches only on
`recordKind === "columnDisplayConfig"` vs. everything else) but were not given dedicated fixtures in
this plan's 10 `NAMING:` tests — `widget` and `layer` were chosen as the two representative
dashboard-scoped kinds per the plan's own test-title list. Flagged for the operator: if Plan 124-03
surfaces a `dynamicView`/`tableView` collision or missing-name case not otherwise exercised by its
own `GROUPING:` tests, a dedicated fixture here would close that gap; not added speculatively since
the plan's `must_haves.artifacts` did not request one and every existing dv/tableView row in the dev
DB is named and collision-free (124-CONTEXT.md, "all 7 dashboards are named").

## Collision Group-Key Table

| recordKind | name source | group id | counted toward `dashboardOf`? |
|---|---|---|---|
| `widget` | `w.title` | `w.dashboard_id` | yes |
| `layer` | `typeof l.config?.name === "string" ? l.config.name : ""` | `l.dashboard_id` | yes |
| `dynamicView` | `dv.name` | `dv.dashboard_id` | yes |
| `tableView` | `tv.view_name` | `tv.dashboard_id` | yes |
| `customMetric` | `m.label` | `m.table_id` | **no** — table-scoped; `dashboardOf` must stay absent or `table_id` would be misread as a dashboard id |
| `columnDisplayConfig` | n/a | n/a | **never in the table at all** — its key is `(table_id, column_name)`, unique by construction, no id to append even if it were not; it is never ambiguous |

An empty name is **never** counted toward a collision, for any kind — the guard is
`if (row.name === "") continue;` before the collision map is touched, applied uniformly.

## Mutation Probe Table (all 8 fired against their named tests)

| # | Mutation | Named test | Result |
|---|----------|------------|--------|
| P1 | Always append `(id N)` in `resolveRecordName`, collision or not | "NAMING: a uniquely-titled widget is named by title and dashboard, with NO id in the label" | **REDDENED** on first try — `widget "Trips over time" (id 40) on dashboard "Operations"` failed both the exact-string and the `not.toMatch(/\bid\b/)` assertions. |
| P2 | Never append the id, even on a collision | "NAMING: two widgets sharing a title on one dashboard BOTH get an id and BOTH get an advisory" | **REDDENED** on first try — both `a.displayLabel` and `b.displayLabel` collapsed to the unqualified form. |
| P3 | Key the collision count on `title` alone, dropping `dashboard_id` from the group key | "NAMING: the same title on two DIFFERENT dashboards is not a collision and neither gets an id" | **REDDENED** on first try — both widgets on different dashboards were incorrectly flagged ambiguous and given ids. |
| P4 | Count empty names toward collisions (drop the non-empty guard) | "NAMING: two unnamed widgets on one dashboard are flagged unnamed, never ambiguous" | **DID NOT REDDEN on first try** against the test as originally written (see Deviations) — `resolveRecordName`'s empty-name branch is checked *before* its ambiguous-set check, so the bug in `buildNamingContext` never became visible through `resolveRecordName`'s output for this fixture. **Test STRENGTHENED** to assert `ctx.ambiguous.has(namingKey(...))` directly; re-run **REDDENED** as specified. |
| P5 | Read a layer's name from a non-existent `layer.name` column instead of `config.name` | "NAMING: a layer is named from config.name, and a layer with no config.name falls back to its id" | **DID NOT REDDEN on first try** (see Deviations) — the test passed `recordLabel` explicitly to `resolveRecordName`, so it never exercised `collectNameGroups`'s own reading of `config.name`, which is only consulted for the collision scan. **Test STRENGTHENED** with two additional layers sharing a `config.name` value and an assertion on `ctx.ambiguous`; re-run **REDDENED** as specified. |
| P6 | Give `columnDisplayConfig` the generic id-fallback path | "NAMING: a column-format rule is named by its column and never carries an id" | **REDDENED** on first try — label became `column-format rule "col_a"` (missing "for") and, more importantly, the mutant would carry `(id null)` on any actually-empty-labelled record; the exact-string assertion caught the wording change immediately. |
| P7 | Return `[]` from `summariseAdvisories` whenever any advisory is present | "ADVISORY: three ambiguous records produce one report-level line naming the count" | **REDDENED** on first try. |
| P8 | Emit the summary in `unnamed-record`, `ambiguous-name` order | "ADVISORY: both kinds present produce exactly two lines, ambiguous first, unnamed second" | **REDDENED** on first try. |

Every probe's source file was restored via file copy and diffed byte-identical against the
pre-mutation version before moving to the next probe (`diff` confirmed identical after the full
sweep).

## Files Created/Modified
- `packages/server/src/lib/impactNaming.ts` — pure lib: `ImpactAdvisoryKind`, `ImpactAdvisory`,
  `RecordNaming`, `NamingContext`, `DashboardNameRow`, `namingKey`, `buildNamingContext`,
  `resolveRecordName`, `summariseAdvisories`. Type-only import of `ColumnRefRecordKind`,
  `ColumnRefsInput` from `./columnRefs`; no other imports.
- `packages/server/tests/lib.impactNaming.spec.ts` — 15 tests: 10 `NAMING:` fixtures (unique title,
  within-dashboard collision, cross-dashboard non-collision, missing-name fallback, unnamed-not-
  ambiguous, layer config.name naming + layer collision, table-scoped customMetric, colliding
  customMetric labels, column-format rule, dangling-dashboard fallback) and 5 `ADVISORY:` fixtures
  (empty in/out, plural count line, singular line, both-kinds order, count-by-kind-not-dedup
  contract).

## Decisions Made
- `dashboardOf` is populated only for the four dashboard-scoped kinds; `customMetric` is excluded so
  its `table_id` can never be misread as a dashboard id by the dash-clause logic — see Verbatim
  Declarations and the Collision Group-Key Table above.
- `columnDisplayConfig` is checked first in `resolveRecordName`'s branch order (before the
  empty-label check), making the "never an id, never an advisory" rule a structural property of the
  function rather than an accident of branch ordering.
- Kept Task 1 and Task 2's implementation in a single GREEN commit (as Plan 124-01 did), because both
  tasks' `<action>` blocks build up the same file incrementally with no natural seam that would
  produce a meaningfully different diff if split — see Deviations.

## Deviations from Plan

### Process deviation (not a Rule 1-4 case — no code behavior affected)

**Task 1/Task 2 boundary collapsed into RED-then-GREEN, not per-task.** The plan's own `tdd="true"`
flow for each task implies a RED/GREEN pair per task; because both tasks build the same file
(`impactNaming.ts`) and the full spec was drafted as one file per the plan's `<behavior>` blocks
(which list all 15 test titles up front, split only by `describe` block), the RED commit
(`28b2074`) contains all 15 test titles from both tasks and the GREEN commit (`d73d331`) contains
`buildNamingContext`/`resolveRecordName` AND `summariseAdvisories` together. This mirrors the same
commit-boundary deviation Plan 124-01 documented. No functional impact — every acceptance criterion
from both Task 1 and Task 2 was independently verified to pass (see Gate Reports below).

### Two mutation probes required test strengthening, not implementation edits (Rule-compliant per CLAUDE.md)

**P4 (empty names must never count toward a collision)** and **P5 (a layer's name must come from
`config.name`, not a non-existent `layer.name`)** did not redden their originally-planned named tests
on the first mutation run. In both cases the *implementation* was already correct; the *test*, as
originally written, could not see the specific internal state the mutation broke:

- P4: `resolveRecordName` checks `recordLabel === ""` before consulting `ctx.ambiguous`, so an
  unnamed widget's advisory is `unnamed-record` regardless of whether `buildNamingContext` correctly
  excluded it from the collision count. The bug (counting empty names toward collisions) is real and
  reachable — it would surface the moment any *other* code path consulted `ctx.ambiguous` for an
  empty-named key — but this specific test's assertions on `resolveRecordName`'s output could not
  discriminate it.
- P5: the test called `resolveRecordName` with an explicit `recordLabel` argument for every
  fixture, which is exactly how the real caller (Plan 124-03) will use it — but that means the test
  never exercised `collectNameGroups`'s own `l.config?.name` read, which matters only for the
  collision *scan*, not for composing an already-known label.

Per `CLAUDE.md` § "Writing verifiable acceptance criteria" ("If an executor finds a criterion that
cannot discriminate, it should report it and verify the real requirement directly — never edit code
to satisfy a broken check") and the plan's own mutation-probe instruction ("If a probe does not fire,
STRENGTHEN THE TEST — never weaken the probe"), both tests were strengthened to assert directly on
`NamingContext.ambiguous` (P4: two additional `expect(ctx.ambiguous.has(namingKey(...))).toBe(false)`
assertions on the existing unnamed-widgets fixture; P5: two new layers sharing a `config.name` value
plus `expect(ctx.ambiguous.has(namingKey("layer", 72))).toBe(true)` assertions). Both mutations then
reddened exactly as specified. No implementation line was changed to force a probe to fire.

---

**Total deviations:** 1 process deviation (commit-boundary granularity, no functional impact), 2
mutation-probe test-strengthening cases (both reported and resolved per CLAUDE.md's explicit
instruction, no code changed to game a check).
**Impact on plan:** None on shipped behavior. All locked naming decisions (default title+dashboard,
collision disambiguation, missing-name fallback, layer config.name, columnDisplayConfig's
id-incapability, BOTH-places advisory) hold as specified and are now each independently pinned by a
mutation-tested assertion.

## Issues Encountered

None beyond the two mutation-probe findings documented above.

## User Setup Required

None — no external service configuration required.

## Gate Reports

- **`cd packages/server && npx tsc --noEmit`** — clean (exit 0).
- **`cd packages/server && npx vitest run tests/lib.impactNaming.spec.ts`** — 15/15 passed.
- **`cd packages/server && npx vitest run tests/lib.columnTypeClass.spec.ts`** — 21/21 passed,
  confirming Plan 124-01's spec is unaffected by this plan.
- **`cd packages/server && node scripts/test-gate.mjs`** (run from `packages/server`, per this
  plan's explicit correction of Plan 124-01's own wrong-directory mistake) — **SET-BASED**:
  1383/1436 tests passed; 8 failing files, all 8 exactly the documented `KNOWN_FAILING` entries
  (`tests/auth.oidc.spec.ts`, `tests/auth.routes.spec.ts`, `tests/boot.hardening.spec.ts`,
  `tests/boot.wipe.spec.ts`, `tests/bootstrap.spec.ts`, `tests/db.smoke.spec.ts`,
  `tests/oidc.module.spec.ts`, `tests/routes.wms.spec.ts`). Set unchanged, has NOT grown. No
  `TD-V16-TEST-ISOLATION` transient hits observed on this run. GATE PASSED.
- **`cd packages/web && npx tsc --noEmit`** — clean (exit 0), run for completeness though this
  plan's own gate list does not require it as a blocking gate.
- **`git diff --name-only 0a12756`** — `grep -c '^packages/web/'` = **0**. `packages/web` is
  untouched; web `vitest`/`theme-guard` gates were therefore not re-run.
- **Dataset hygiene grep** (`nyctaxi|us_states|vaipr|ookla|demodata|mobile_time_only|
  new_mobile_base|data_coverage_voice`, case-insensitive) over both files this plan wrote — **0
  matches**. Fixtures use neutral synthetic names only ("Trips over time", "Bar Chart", "Main
  layer", "Average duration", "Operations", "Logistics", "col_a", "Orphan").

## Next Phase Readiness

`namingKey`, `buildNamingContext`, `resolveRecordName`, and `summariseAdvisories` are exported and
ready for Plan 124-03 (report assembler) to consume alongside Plan 124-01's
`classifyFingerprint`/`severityForRetype`. The verbatim declarations above are the contract; no
further changes to this module are expected from those plans. Flagged for 124-03's own planning: its
`GROUPING:` tests are the other half of the `summariseAdvisories` caller contract (de-duplicating
advisories by `namingKey` before calling it) — this plan's own tests only pin the function's "count
what it's given" half, per the doc comment above `summariseAdvisories`. No blockers.

---
*Phase: 124-impact-report*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/impactNaming.ts`
- FOUND: `packages/server/tests/lib.impactNaming.spec.ts`
- FOUND: `.planning/phases/124-impact-report/124-02-SUMMARY.md`
- FOUND: commit `28b2074` (test(124-02): add failing spec for record naming and advisory summary)
- FOUND: commit `d73d331` (feat(124-02): implement record naming resolver and advisory summary)
