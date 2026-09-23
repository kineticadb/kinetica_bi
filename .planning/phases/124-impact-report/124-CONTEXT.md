# Phase 124: Impact Report - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

A schema check returns a **report the operator can act on**: every affected widget, layer, custom
metric and column-format rule named in their own terms, breaking changes separated from harmless
ones, and certainty stated rather than implied.

**Server-side response shape.** The UI that renders it is Phase 126; applying a change and
persisting history is Phase 125. This phase turns Phase 123's `ColumnRef` findings and Phase 122's
`SchemaCheckResult` diff into something a human reads and works from.

Out of scope: rendering, applying, persisting, and any repair.

</domain>

<decisions>
## Implementation Decisions

### Severity — three levels, not two

**Locked.** A retype only breaks the app when it changes the **type class** the UI branches on
(`number` / `string` / `datetime` / `boolean`, per `inferDataTypeFromColumn`).

| Level | Means | Examples |
|---|---|---|
| **breaking** | the type class flips, or the column is gone | `int → varchar`; any removed column |
| **changed** | same class, different type — nothing in the app misbehaves, but the data meaning moved | `int → double`, `varchar(8) → varchar(32)` |
| **harmless** | no dependent can break | added columns |

Two levels was rejected because it would file `int → double` and `varchar(8) → varchar(32)` with
added columns — and the operator specifically asked to see those. "Report the change, never
classify" was rejected because it pushes the analysis back onto the person at exactly the moment
the report is meant to do the work.

**A `breaking` retype must additionally flag every widget carrying a frozen `drillDownColumnType`
for that column** (criterion 4) — those keep filtering with the stale type until reconfigured, with
no error. 69 widget configs carry that field (`ChartConfigPanel.tsx:1063-1065`).

### A removed column found only in free SQL is BREAKING, flagged unconfirmed

**Locked.** It sits in the breaking section with its certainty stated — not demoted to a separate
"possibly affected" area. A genuinely referenced dropped column is the worst case this feature
exists to catch, and under-reporting it is the failure mode the milestone is built around. A false
positive costs the operator seconds, because Phase 123 supplies the matched line and offset.

### Naming — the report nudges the operator to fix their naming rather than papering over it

This principle emerged from the operator's answers to both naming questions and should guide any
case not enumerated here.

**Ambiguous titles.** Widget titles are NOT unique: four dashboards today have two widgets sharing
one title (dashboard 4 "Bar Chart" ×2, dashboard 5 "Records Table" ×2, dashboard 6 "Big Number" ×2,
dashboard 10 "Technology" ×2). Default identification is **title + dashboard name**; the widget id
is appended **only when a title collides within its dashboard**, together with an advisory telling
the operator to rename one and re-run so the two become distinguishable without ids.

**Missing names.** Fall back to the id, AND state plainly that the widget has no name, AND suggest
naming it and re-running. Do not silently substitute a generated label — the operator should know
the gap exists.

**Relationship to success criterion 1 — read this before flagging a violation.** Criterion 1 says
affected widgets are identified "by its title and its dashboard's name — not by id". That stands as
the DEFAULT. The id appears only as a disambiguator or fallback, always accompanied by an advisory,
because an id is a thing the operator cannot look up anywhere in the UI. This is the operator's
explicit decision (2026-09-23), not a drift from the criterion.

**Layers** are named from `config.name` — real values include "Heatmap NYC Taxi", "Main NYC taxi",
"Assets". It is a JSON field, not a column, and may be absent; same fallback rule applies.

### The naming advisory appears in BOTH places

**Locked.** On the individual finding (so it is actionable where the operator is looking) AND once
at report level as a summary (e.g. "3 widgets could not be named unambiguously — rename them and
re-run to see exactly which"). Finding-only risks the pattern going unnoticed across 20 findings;
report-level-only leaves the operator guessing which findings it refers to.

### Structure — by SEVERITY first, then by column

**Locked.** Breaking first, then changed, then harmless; within each, grouped by column; within a
column, grouped by record.

Triage-first ordering: the worst thing is at the top. The known cost is that one column with mixed
consequences appears under more than one severity — accepted deliberately.

**Grouping by record within a column is REQUIRED, not optional** (carried from Phase 123): a widget
routinely produces BOTH an exact finding (e.g. `metricColumn`) and a heuristic one (its
`config.sql`) for the same column, because the operator chose completeness over a quieter report.
Ungrouped, the same widget appears twice and the report looks buggy.

### Certainty — the tier AND report-ready prose

**Locked.** Each finding carries its machine-readable tier (`exact` / `heuristic` /
`low-confidence`) **and** prose the UI renders verbatim — e.g. *"possibly affected — this metric's
SQL mentions `vendor_id`, but the match is text-based and may be a false positive"*.

Rationale: the wording that decides whether an operator trusts a finding is too important to be
invented in the rendering layer, where it can drift or soften. One source, consistent everywhere.
Criterion 5 requires free-SQL findings read as *possibly* affected rather than confirmed.

### Claude's Discretion

- The report type's exact field names and nesting, provided it is reproduced verbatim in the SUMMARY
  (Phase 125 persists it and Phase 126 renders it, and both are planned against it).
- Exact advisory wording, within the decisions above.
- How `tableScope: "unresolved"` findings are presented — they must be present and honestly labelled
  (carried from Phase 123), but the phrasing is open.
- Whether an unaffected check returns an empty report or an explicit "nothing affected" marker —
  pick one and be consistent; Phase 126 must be able to tell "no findings" from "not yet run".
- Whether severity is computed in a new pure lib or inside the existing check route (a `lib/` module
  is the house pattern — see `schemaDiff.ts`, `columnRefs.ts`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's inputs — both are shipped CONTRACTS
- `packages/server/src/lib/columnRefs.ts` — the `ColumnRef` finding type and all 40 sites. Contract
  reproduced verbatim in `.planning/phases/123-column-reference-enumeration/123-01-SUMMARY.md` and
  `123-04-SUMMARY.md`
- `packages/server/src/lib/schemaDiff.ts` — `SchemaCheckResult` (three outcomes; `table_missing`
  omits the diff-group keys). Verbatim in `122-03-SUMMARY.md`
- `packages/server/src/lib/schemaFingerprint.ts` — the per-column fingerprint being compared

### Type semantics — the basis of the severity split
- `packages/web/src/lib/columnTypes.ts` — `inferDataTypeFromColumn` (:85), `NUMERIC_TYPES` (:42-46),
  `INTEGER_TYPES` (:51-55), `DATETIME_TYPES`/`BOOLEAN_TYPES` (:64-65), `normalizeType` (:67-69).
  **The type CLASS this returns is what decides breaking vs changed.**

### The two silent-failure sites this report must surface
- `packages/web/src/components/charts/ChartConfigPanel.tsx:1063-1065` — `drillDownColumnType` frozen
  at save time into 69 widget configs; a retype leaves them filtering with the stale type, no error
- `packages/web/src/store/columnDisplayConfigStore.ts:151-161` — `resolveLabel`/`resolveFormatter`
  fall back silently to the raw column name and identity formatter, so a rename makes labels and
  number formatting quietly stop applying (criterion 2)

### Prior phases' locked decisions that constrain this one
- `.planning/phases/123-column-reference-enumeration/123-CONTEXT.md` — the three certainty tiers,
  matched-line + offset on heuristic findings, free-SQL findings assert no table
- `.planning/phases/122-schema-diff-table-missing-detection/122-CONTEXT.md` — three outcomes,
  baseline-before-diff, Phase 122 writes nothing
- `.planning/PROJECT.md` § "Current Milestone: v1.25 Schema Sync" — the five locked scope decisions

### Requirements and criteria
- `.planning/REQUIREMENTS.md` — SSYNC-V125-06, -09, -10, -11, -12
- `.planning/ROADMAP.md` § "Phase 124" — the five success criteria

### Project conventions
- `./CLAUDE.md` — § "Writing verifiable acceptance criteria" (RUN every grep before committing to
  it) and § "Test gates". Server tests are SET-BASED: `node scripts/test-gate.mjs`, never raw
  `npx vitest run`, never a fixed pass-count.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `columnRefs.ts` and `schemaDiff.ts` are pure libs with fixture-based specs — the established shape
  and test pattern for this module.
- `inferDataTypeFromColumn` already encodes exactly the class distinction the severity split needs;
  do not re-derive a second type taxonomy. Note it currently lives in `packages/web` — the planner
  must decide how the server reaches that logic without duplicating it, or justify a mirror.

### Established Patterns
- Pure libs under `packages/server/src/lib/` compute; routes stay thin.
- Fixtures built from real rows where real data exists, synthetic where it does not, **labelled
  either way** — 12 of Phase 123's 40 sites are synthetic-only, and saying so is what makes the
  coverage claim honest.

### Integration Points
- The check route from Phase 122 (`GET /api/tables/:id/schema-check`) is where the report surfaces.
- Phase 125 persists this report in sync history; Phase 126 renders it. The report type is a
  contract both are planned against.

### Naming data, verified 2026-09-23
- 74 widgets, **0 with empty titles**, but **4 (dashboard, title) pairs are ambiguous**.
- `dashboard_layers` has NO name column; the name lives at `config.name`.
- All 7 dashboards are named; all 10 custom-metric labels are distinct.

</code_context>

<specifics>
## Specific Ideas

- Operator, on ambiguous widget titles: *"Honestly, the user should just rename 1 chart and rerun
  the report to distinguish the same names."* And on missing names: *"fall back to the id but
  suggest to the operator to name their widgets and rerun the report to know exactly which one. You
  should also let them know the widget does not have a name."*
  → The report **nudges toward better naming hygiene** rather than silently compensating. Apply that
  principle to any naming case not enumerated above.

</specifics>

<deferred>
## Deferred Ideas

- **Auto-repair (`SSYNC-F1`)** — the report names what broke; it never offers to fix it. Milestone
  decision: detect and report only.
- **`dynamicView.columns_json[].type`** — a SECOND frozen type cache alongside `drillDownColumnType`,
  found during Phase 123. A retype makes it stale the same way. Flagged there for this phase;
  **surface it if it fits the severity model cheaply, otherwise record it as a known gap** rather
  than silently ignoring it.
- **`SSYNC-F6`** — the server-side column-existence gate. Adjacent, not this phase.

</deferred>

---

*Phase: 124-impact-report*
*Context gathered: 2026-09-23*
