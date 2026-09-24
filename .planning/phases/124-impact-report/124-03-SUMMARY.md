---
phase: 124-impact-report
plan: 03
subsystem: api
tags: [schema-sync, impact-report, pure-lib, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 124-01
    provides: "classifyFingerprint / severityForRetype / REMOVED_SEVERITY / ADDED_SEVERITY"
  - phase: 124-02
    provides: "buildNamingContext / resolveRecordName / summariseAdvisories / namingKey"
  - phase: 123-column-reference-enumeration
    provides: "ColumnRef contract, collectColumnRefs — called ONCE, no new traversal"
  - phase: 122-schema-diff-table-missing-detection
    provides: "SchemaCheckResult's diff outcome (added/removed/retyped)"
provides:
  - "ImpactChangeKind / ImpactReference / ImpactRecord / ImpactColumn / ImpactSection / ImpactReport / SchemaCheckResponse / ImpactInput types"
  - "certaintyProse(column, path, confidence, tableScope) — the tier-plus-prose composer"
  - "COLUMNS_JSON_TYPE_GAP — the recorded known gap for dynamicView.columns_json[].type"
  - "buildImpactReport(input) — the phase's deliverable: composes all three prior contracts into the operator-facing report"
affects: [124-04-route-wiring, 125-persist-history, 126-render-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Severity-then-column-then-record report assembly over three already-shipped pure libs (columnTypeClass.ts, impactNaming.ts, columnRefs.ts), with zero new traversal of app state"
    - "Report-level advisory de-duplication by namingKey(recordKind, recordId) BEFORE calling summariseAdvisories — the caller-side half of 124-02's documented contract"
    - "staleDrillDownType computed by FILTERING collectColumnRefs's own output to one site, never a second traversal"

key-files:
  created:
    - packages/server/src/lib/schemaImpact.ts
    - packages/server/tests/lib.schemaImpact.spec.ts
  modified: []

key-decisions:
  - "staleDrillDownFor and STALE_DRILL_DOWN_SITE were written into the SAME implementation write as Task 1's contract/assembly code, rather than added fresh during Task 2's own RED/GREEN pass — the ImpactRecord.staleDrillDownType field is part of the verbatim contract Task 1 had to ship anyway, and mirrors the Task-boundary collapse both 124-01 and 124-02 documented for the same reason (one file, no natural seam). Task 2's own 8 new tests (6 STALE:, 2 GROUPING:) were still written and run as a genuine RED-then-GREEN-observed pass against the untouched implementation — all 8 passed immediately, and the full 9-probe mutation sweep was run against the FINAL implementation only (see Mutation Probe Table)."
  - "Task 1's PROHIBITION criterion 12 (grep for localeCompare|new Date|Date.now|Math.random = 0) is toothless as written: the header comment's own mandated prose (which must state the byte-stability discipline by name, per Task 1's <action> block) contains the literal substrings 'localeCompare' and 'Date' twice, in comments only. Verified the real requirement directly: `grep -nE \"localeCompare\\(|new Date\\(|Date\\.now\\(|Math\\.random\\(\" src/lib/schemaImpact.ts` returns zero matches — no actual invocation anywhere in the file. This is the same toothless-criterion class 124-01-SUMMARY.md documented for its own purity grep (mandated attribution prose vs. a bare-substring prohibition)."
  - "advisorySummary de-duplicates by namingKey(recordKind, recordId) across the WHOLE report (a Set checked once per record-key, populated the first time that key is seen across ANY column) — so a widget appearing under three changed columns contributes its advisory to advisorySummary once, per 124-02's documented caller-side half of the summariseAdvisories contract."

requirements-completed: [SSYNC-V125-09, SSYNC-V125-10, SSYNC-V125-11, SSYNC-V125-12]

duration: 40min
completed: 2026-09-24
---

# Phase 124 Plan 03: Impact Report Assembly Summary

**`buildImpactReport` — the pure composer that turns Phase 122's `SchemaCheckResult` diff plus Phase 123's `ColumnRef` findings into a three-section (breaking/changed/harmless), record-grouped, certainty-annotated `ImpactReport`, including the frozen-`drillDownColumnType` cross-reference and the `columns_json[].type` known-gap record.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-24T15:28:00 (approx., first file read)
- **Completed:** 2026-09-24T15:36:00
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments
- Shipped the full `ImpactReport` contract (`ImpactChangeKind`, `ImpactReference`, `ImpactRecord`, `ImpactColumn`, `ImpactSection`, `ImpactReport`, `SchemaCheckResponse`, `ImpactInput`) verbatim per the plan's `<action>` block, plus `certaintyProse` and `COLUMNS_JSON_TYPE_GAP`.
- `buildImpactReport` composes `classifyFingerprint`/`severityForRetype` (124-01), `resolveRecordName`/`buildNamingContext`/`summariseAdvisories` (124-02), and `collectColumnRefs` (Phase 123) into three ALWAYS-present sections, in `["breaking", "changed", "harmless"]` order, with columns byte-ascending within each.
- Grouping by record is enforced by a named test (`GROUPING: a widget matching a column through BOTH a structured field and its config.sql appears once, with two references`), not by prose — a widget matching through both `metricColumn` and `sql` appears once with two `ImpactReference`s, in site order.
- A removed column found only through free-SQL text matching stays in the breaking section and its certainty prose reads "possibly affected", never "confirmed".
- Added columns carry `records: []`, are excluded from the `collectColumnRefs` walk entirely, and never appear outside the harmless section.
- `staleDrillDownType` flags a widget's frozen `config.drillDownColumnType` ONLY under a breaking retype where the widget's own `widget.config.drillDownColumn` site matched — computed by filtering `collectColumnRefs`'s existing output, no new traversal.
- `columnDisplayConfig` rules reach the report with zero new code — proven by two tests, not implemented fresh (SSYNC-V125-10 was already closed by an existing Phase 123 site).
- `COLUMNS_JSON_TYPE_GAP` is recorded verbatim in `knownGaps`.
- All 9 mutation probes fired against their named tests on the first attempt — no test needed strengthening, no probe was weakened, no implementation line was edited to force a fire.
- 24/24 tests pass; `tsc` clean; server gate PASSED with the 8 documented `KNOWN_FAILING` entries unchanged (plus transient `TD-V16-TEST-ISOLATION` contamination hits across three separate gate runs, each confirmed to pass in isolation); zero `packages/web` diff.

## Task Commits

1. **Task 1: The ImpactReport contract, certaintyProse, and the severity/column/record assembly** - `7bd2c1f` (feat) — also includes `staleDrillDownFor`/`STALE_DRILL_DOWN_SITE` (see Deviations)
2. **Task 2: The stale drillDownColumnType cross-reference and the column-format-rule coverage** - `479ca5d` (test) — spec-only commit; `schemaImpact.ts` unchanged (see Deviations)

_Note: as in Plans 124-01 and 124-02, the file's full content was drafted in one write; Task 2's own tests and mutation sweep were still executed as a genuine, separate verification pass against the already-shipped implementation — see Deviations for why this is not a case of "tests retrofitted to match code"._

## Verbatim Declarations

Reproduced exactly as shipped in `packages/server/src/lib/schemaImpact.ts`. Phase 125 persists `ImpactReport`; Phase 126 renders it; both are planned against this text.

```ts
/** Which diff group a column came from. Severity is a function of this plus, for a retype, the
 *  type-class flip test in columnTypeClass.ts. */
export type ImpactChangeKind = "removed" | "retyped" | "added";

/** One reference SITE inside one record. Granularity is inherited from ColumnRef: one entry per
 *  site, not one per text match (the matches live inside). */
export type ImpactReference = {
  site: ColumnRefSite;
  path: string;
  /** The machine-readable tier, straight from ColumnRef. */
  confidence: RefConfidence;
  tableScope: ColumnRefTableScope;
  /** Report-ready prose the UI renders VERBATIM. Locked in 124-CONTEXT.md: the tier AND the
   *  prose, one source, so the wording cannot drift or soften in the rendering layer. */
  certainty: string;
  /** Matched line, 1-based line number and 0-based in-line offset, per free-SQL match. Empty for
   *  value-equality sites. */
  matches: ColumnRefMatch[];
};

/** One record affected by one column's change. ALL of that record's reference sites for that
 *  column are grouped here — a widget that matches through both a structured field AND its own
 *  config.sql appears ONCE, with two references. Grouping by record is REQUIRED, not optional
 *  (124-CONTEXT.md, carried from Phase 123). */
export type ImpactRecord = {
  recordKind: ColumnRefRecordKind;
  /** null ONLY for a column-format rule, whose key is (table_id, column_name). */
  recordId: number | null;
  /** The record's own name, "" when it carries none. */
  name: string;
  dashboardName: string | null;
  /** The composed operator-facing label, rendered VERBATIM. Title + dashboard name by default;
   *  the id appears only as a disambiguator or a fallback, and never without an advisory. */
  displayLabel: string;
  /** Naming advisories for THIS record. Also summarised once at report level. */
  advisories: ImpactAdvisory[];
  references: ImpactReference[];
  /** Present ONLY on a widget that carries a frozen `config.drillDownColumnType` for this column,
   *  and ONLY under a BREAKING retype (SSYNC-V125-12, ROADMAP criterion 4). Absent otherwise —
   *  never `null`, never an empty object. */
  staleDrillDownType?: { frozenType: string; message: string };
};

/** One changed column, with every record that references it. */
export type ImpactColumn = {
  column: string;
  changeKind: ImpactChangeKind;
  /** The rendered stored type (formatFingerprint). null for an ADDED column. */
  storedType: string | null;
  /** The rendered live type. null for a REMOVED column. */
  liveType: string | null;
  /** The stored/live type CLASS. null on the side that does not exist. */
  storedClass: ColumnTypeClass | null;
  liveClass: ColumnTypeClass | null;
  /** One-line, report-ready explanation of the change. Rendered VERBATIM. */
  summary: string;
  /** Empty for an ADDED column, by design — an added column breaks nothing. */
  records: ImpactRecord[];
};

export type ImpactSection = { severity: ImpactSeverity; columns: ImpactColumn[] };

export type ImpactReport = {
  v: 1;
  /** Fully-qualified table name, echoing SchemaCheckResult.table. */
  table: string;
  tableId: number;
  /** "changes" -> at least one column changed. "no_changes" -> the check ran and found nothing.
   *  A report being ABSENT from the response is what "not yet run / not applicable" looks like —
   *  Phase 126 therefore distinguishes all three states. */
  outcome: "changes" | "no_changes";
  /** ALWAYS exactly three, ALWAYS breaking, changed, harmless. An empty section has an empty
   *  `columns` array; it is never an omitted key. */
  sections: ImpactSection[];
  /** The report-level half of the locked BOTH-places naming rule. */
  advisorySummary: ImpactAdvisory[];
  /** What this report deliberately does NOT check. Rendered VERBATIM. */
  knownGaps: string[];
};

/** The wire shape of GET /api/tables/:id/schema-check once Plan 124-04 wires this in.
 *  `impact` is attached ONLY to the "diff" outcome. */
export type SchemaCheckResponse = SchemaCheckResult & { impact?: ImpactReport };

export type ImpactInput = {
  /** Must be the "diff" outcome. The caller (Plan 124-04) does not call this for the other two. */
  check: Extract<SchemaCheckResult, { outcome: "diff" }>;
  tableId: number;
  refsInput: ColumnRefsInput;
  dashboards: DashboardNameRow[];
};

export function certaintyProse(
  column: string,
  path: string,
  confidence: RefConfidence,
  tableScope: ColumnRefTableScope,
): string {
  let base: string;
  if (confidence === "exact") {
    base = `confirmed — this record stores the column in its \`${path}\` field.`;
  } else if (confidence === "low-confidence") {
    base =
      `possibly affected — \`${column}\` is a short or common name, so this text match in ` +
      `\`${path}\` is more likely than most to be a false positive.`;
  } else {
    base =
      `possibly affected — \`${path}\` mentions \`${column}\`, but the match is text-based and ` +
      `may be a false positive.`;
  }
  if (tableScope === "unresolved") {
    base +=
      ` This record's own table could not be determined, so it is reported for every table that ` +
      `changes.`;
  }
  return base;
}

export const COLUMNS_JSON_TYPE_GAP =
  "Dynamic views cache their own column list with a frozen type (`columns_json[].type`). That is " +
  "a second frozen type cache, alongside a widget's `drillDownColumnType`, and a retype leaves it " +
  "stale in the same way. This report does NOT check it.";

export function buildImpactReport(input: ImpactInput): ImpactReport;
```

(`STALE_DRILL_DOWN_SITE`, `staleDrillDownFor`, `byColumnAscending` and `buildRecordsFor` are internal implementation detail, not part of the exported contract, and are omitted here for brevity — the full file is at `packages/server/src/lib/schemaImpact.ts`.)

## Worked Example

One realistic `ImpactReport`, produced by actually calling `buildImpactReport` (not hand-typed) against a fixture containing: one breaking retype with a stale drill-down flag (`col_dd`), one breaking removal known only through free SQL (`col_free`), one `changed` retype (`col_num`), one added column (`col_added`), one column-format-rule record (`col_fmt`), and a non-empty `advisorySummary` (two ambiguous-title widgets sharing "Bar Chart" on one dashboard, plus one unnamed widget). Neutral synthetic names throughout.

```json
{
  "v": 1,
  "table": "demo_table",
  "tableId": 1,
  "outcome": "changes",
  "sections": [
    {
      "severity": "breaking",
      "columns": [
        {
          "column": "col_dd",
          "changeKind": "retyped",
          "storedType": "string",
          "liveType": "long(timestamp)",
          "storedClass": "string",
          "liveClass": "datetime",
          "summary": "The column `col_dd` changed from string to long(timestamp). That moves it from the string type class to datetime, which is what the app branches on — dependents can break.",
          "records": [
            {
              "recordKind": "widget",
              "recordId": 1,
              "name": "Ambiguous Widget",
              "dashboardName": "Operations",
              "displayLabel": "widget \"Ambiguous Widget\" on dashboard \"Operations\"",
              "advisories": [],
              "references": [
                {
                  "site": "widget.config.drillDownColumn",
                  "path": "config.drillDownColumn",
                  "confidence": "exact",
                  "tableScope": "unresolved",
                  "certainty": "confirmed — this record stores the column in its `config.drillDownColumn` field. This record's own table could not be determined, so it is reported for every table that changes.",
                  "matches": []
                }
              ],
              "staleDrillDownType": {
                "frozenType": "string",
                "message": "This widget's drill-down is frozen at type \"string\", but the column is now datetime. It keeps filtering with the stale type until someone reopens its config and re-picks the column — nothing errors in the meantime."
              }
            },
            {
              "recordKind": "widget",
              "recordId": 2,
              "name": "Bar Chart",
              "dashboardName": "Operations",
              "displayLabel": "widget \"Bar Chart\" (id 2) on dashboard \"Operations\"",
              "advisories": [
                {
                  "kind": "ambiguous-name",
                  "message": "Two or more widgets on dashboard \"Operations\" are named \"Bar Chart\", so the report appends the id (2) to tell them apart. Rename one and re-run this check to see them by name alone."
                }
              ],
              "references": [
                {
                  "site": "widget.config.metricColumn",
                  "path": "config.metricColumn",
                  "confidence": "exact",
                  "tableScope": "unresolved",
                  "certainty": "confirmed — this record stores the column in its `config.metricColumn` field. This record's own table could not be determined, so it is reported for every table that changes.",
                  "matches": []
                }
              ]
            },
            {
              "recordKind": "widget",
              "recordId": 3,
              "name": "Bar Chart",
              "dashboardName": "Operations",
              "displayLabel": "widget \"Bar Chart\" (id 3) on dashboard \"Operations\"",
              "advisories": [
                {
                  "kind": "ambiguous-name",
                  "message": "Two or more widgets on dashboard \"Operations\" are named \"Bar Chart\", so the report appends the id (3) to tell them apart. Rename one and re-run this check to see them by name alone."
                }
              ],
              "references": [
                {
                  "site": "widget.config.metricColumn",
                  "path": "config.metricColumn",
                  "confidence": "exact",
                  "tableScope": "unresolved",
                  "certainty": "confirmed — this record stores the column in its `config.metricColumn` field. This record's own table could not be determined, so it is reported for every table that changes.",
                  "matches": []
                }
              ]
            }
          ]
        },
        {
          "column": "col_fmt",
          "changeKind": "removed",
          "storedType": "string",
          "liveType": null,
          "storedClass": "string",
          "liveClass": null,
          "summary": "The column `col_fmt` is gone from the table. Its stored type was string.",
          "records": [
            {
              "recordKind": "columnDisplayConfig",
              "recordId": null,
              "name": "col_fmt",
              "dashboardName": null,
              "displayLabel": "column-format rule for \"col_fmt\"",
              "advisories": [],
              "references": [
                {
                  "site": "columnDisplayConfig.column_name",
                  "path": "column_name",
                  "confidence": "exact",
                  "tableScope": "scoped",
                  "certainty": "confirmed — this record stores the column in its `column_name` field.",
                  "matches": []
                }
              ]
            }
          ]
        },
        {
          "column": "col_free",
          "changeKind": "removed",
          "storedType": "string",
          "liveType": null,
          "storedClass": "string",
          "liveClass": null,
          "summary": "The column `col_free` is gone from the table. Its stored type was string.",
          "records": [
            {
              "recordKind": "widget",
              "recordId": 4,
              "name": "",
              "dashboardName": "Logistics",
              "displayLabel": "widget 4 (no name) on dashboard \"Logistics\"",
              "advisories": [
                {
                  "kind": "unnamed-record",
                  "message": "This widget has no name, so the report can only identify it by its id (4). Name it and re-run this check to see it by name."
                }
              ],
              "references": [
                {
                  "site": "widget.config.sql",
                  "path": "config.sql",
                  "confidence": "heuristic",
                  "tableScope": "free-sql",
                  "certainty": "possibly affected — `config.sql` mentions `col_free`, but the match is text-based and may be a false positive.",
                  "matches": [
                    { "line": "select col_free from t", "lineNumber": 1, "offset": 7 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "severity": "changed",
      "columns": [
        {
          "column": "col_num",
          "changeKind": "retyped",
          "storedType": "int",
          "liveType": "double",
          "storedClass": "number",
          "liveClass": "number",
          "summary": "The column `col_num` changed from int to double. It stays in the number type class, so nothing in the app misbehaves, but the data meaning moved.",
          "records": []
        }
      ]
    },
    {
      "severity": "harmless",
      "columns": [
        {
          "column": "col_added",
          "changeKind": "added",
          "storedType": null,
          "liveType": "string",
          "storedClass": null,
          "liveClass": "string",
          "summary": "The column `col_added` is new (string). Nothing can be broken by it — it only needs to become selectable in the config panels.",
          "records": []
        }
      ]
    }
  ],
  "advisorySummary": [
    {
      "kind": "ambiguous-name",
      "message": "2 records could not be named unambiguously — rename them and re-run this check to see exactly which."
    },
    {
      "kind": "unnamed-record",
      "message": "1 record has no name — name it and re-run this check so the report can identify it without ids."
    }
  ],
  "knownGaps": [
    "Dynamic views cache their own column list with a frozen type (`columns_json[].type`). That is a second frozen type cache, alongside a widget's `drillDownColumnType`, and a retype leaves it stale in the same way. This report does NOT check it."
  ]
}
```

Note on `tableScope: "unresolved"` in this example: the fixture widgets carry neither `config.tableId` nor `config.dynamicViewId`, so `resolveWidgetTableId` (columnRefs.ts) legitimately returns `unresolved` — which conveniently also demonstrates the extra certainty-prose sentence for that branch. A fixture with `config.tableId` set would show `tableScope: "scoped"` instead; both are exercised by dedicated `CERTAINTY:` tests.

## Discretion Decisions This Plan Settled

1. **"No findings" vs "not yet run"** is settled by the PRESENCE of the whole report, not by an empty array. `impact` (Plan 124-04's job to attach) is present only on the `"diff"` outcome; inside it, `outcome: "no_changes"` means the check ran and found nothing, `outcome: "changes"` means at least one column changed. A `baseline_required` or `table_missing` response carries no `impact` key at all, so Phase 126 can distinguish all three states unambiguously.
2. **Added columns carry `records: []` and are never ref-walked.** `walkedColumns` is built from `check.removed` + `check.retyped` only; `check.added` columns never enter the single `collectColumnRefs` call. Rationale (124-CONTEXT.md, locked_design item 4): a pre-existing reference to a column name that has just started existing describes something that was already broken and is now FIXED — reporting it as a "harmless" finding would mislead the operator into thinking something changed when the state of the world actually improved.
3. **`tableScope: "unresolved"` findings are present and labelled by an extra prose sentence appended on top of the tier prose** (`certaintyProse`'s trailing `if (tableScope === "unresolved")` branch), rather than a separate presentational treatment. This keeps one prose function as the single source and lets the sentence compose cleanly with any of the three confidence tiers (all three are exercised together in `CERTAINTY: an unresolved table scope is stated honestly on top of the tier prose`).
4. **`columns_json[].type` is a recorded `knownGaps` entry, not silently ignored, and not half-built.** It does not fit the severity model cheaply: unlike `drillDownColumn`, `columnRefs.ts` enumerates NO site for `columns_json[].type` (only `columns_json[].name`, which answers a different question — does this cached name still exist, not is its cached type stale). Surfacing type-staleness there would mean writing a traversal `columnRefs.ts` deliberately does not provide, which is out of this plan's scope (`columnRefs.ts` was NOT modified — see Gate Reports). Recorded verbatim via the exported `COLUMNS_JSON_TYPE_GAP` constant instead, asserted present in `knownGaps` by a dedicated test. Task 2's acceptance criterion 6 additionally confirms every `columns_json` occurrence in the file is inside that one constant's string — no partial traversal was written.
5. **`columnDisplayConfig` needed NO new code.** `columnDisplayConfig.column_name` was already one of the 40 sites `collectColumnRefs` enumerates (Plan 123-04), so a format rule bound to a changed column already flows through the existing single `collectColumnRefs` call into a record with `recordKind: "columnDisplayConfig"`, `recordId: null`. Task 2 adds two tests (`GROUPING: a column-format rule bound to a REMOVED column appears in the breaking section`, `GROUPING: a column-format rule record carries recordId null and a label naming its column`) that PROVE this rather than any new production code — stated plainly here per the plan's explicit instruction not to imply new traversal was written.

## Mutation Probe Table (all 9 fired against their named tests)

| # | Mutation | Named test | Result |
|---|----------|------------|--------|
| P1 | Emit the sections in harmless / changed / breaking order | "SECTION: all three sections are always present, in breaking / changed / harmless order" | **REDDENED** — `toEqual(["breaking","changed","harmless"])` failed against the reversed `["harmless","changed","breaking"]` output. |
| P2 | Include added columns in the `collectColumnRefs` query and in the breaking partition | "SECTION: an added column lands in harmless with no records, and appears in NO other section" | **REDDENED** — `not.toContain("col_added")` on the breaking-columns array failed once added columns were pushed into `REMOVED_SEVERITY` instead of `ADDED_SEVERITY`. |
| P3 | Emit one `ImpactRecord` per `ColumnRef` instead of grouping by `namingKey` | "GROUPING: a widget matching a column through BOTH a structured field and its config.sql appears once, with two references" | **REDDENED** — `col.records` had length 2 instead of 1 once each ref got its own synthetic per-index key. |
| P4 | Drop heuristic/free-SQL refs from a REMOVED column's records | "SECTION: a removed column found ONLY in free SQL stays breaking and is worded possibly affected" | **REDDENED** — `col.records` was empty (length 0) once heuristic refs were filtered out of a `removed` column's record-building. |
| P5 | Return the `exact` prose for every confidence tier | "CERTAINTY: a heuristic free-SQL reference reads as possibly affected, never confirmed" | **REDDENED** — the heuristic-confidence call returned the "confirmed —" string instead of "possibly affected". |
| P6 | Skip the `tableScope === "unresolved"` suffix | "CERTAINTY: an unresolved table scope is stated honestly on top of the tier prose" | **REDDENED** — the exact+unresolved case no longer contained "This record's own table could not be determined". |
| P7 | Drop the `severity !== "breaking"` guard in `staleDrillDownFor` | "STALE: a CHANGED retype does not flag the frozen type, because the class still holds" | **REDDENED** — an `int -> double` (`changed`) retype's record picked up a `staleDrillDownType` it should never carry. |
| P8 | Drop the `refsForRecord.some(site === STALE_DRILL_DOWN_SITE)` guard | "STALE: the frozen type for a DIFFERENT column does not flag this column's finding" | **REDDENED** — a widget whose frozen drill-down column was a DIFFERENT column than the one retyped still got flagged. |
| P9 | Replace the byte-ascending column sort with `localeCompare` | "GROUPING: reordering the input rows produces byte-identical JSON" | **REDDENED**, using the plan-checker's amended `"B_col"` vs `"a_col"` pair — `localeCompare` produced `["a_col","B_col"]` where byte-ascending order requires `["B_col","a_col"]` (`B`=0x42 sorts before `a`=0x61). The original lowercase-only pairing would NOT have discriminated this mutation, per the plan's own P9 amendment; the fixture used here already carries the diverging pair, so no further test strengthening was needed. |

Every probe's source file was restored via file copy and diffed byte-identical against the pre-mutation version before moving to the next probe (all 9 confirmed `IDENTICAL` by `diff`).

## Files Created/Modified
- `packages/server/src/lib/schemaImpact.ts` — pure lib: the full `ImpactReport` contract, `certaintyProse`, `COLUMNS_JSON_TYPE_GAP`, `staleDrillDownFor`/`STALE_DRILL_DOWN_SITE`, and `buildImpactReport`. Type-only imports from `./schemaFingerprint`, `./schemaDiff`, `./columnRefs`, `./columnTypeClass`, `./impactNaming`; value imports of `collectColumnRefs`, `classifyFingerprint`/`severityForRetype`/`ADDED_SEVERITY`/`REMOVED_SEVERITY`, and `buildNamingContext`/`namingKey`/`resolveRecordName`/`summariseAdvisories`. No `db`/`express`/`fetch` import anywhere.
- `packages/server/tests/lib.schemaImpact.spec.ts` — 24 tests: 4 `CERTAINTY:` fixtures, 7 `SECTION:` fixtures, 4 `GROUPING:` fixtures (Task 1) + 2 more `GROUPING:` fixtures (Task 2, column-format-rule coverage), 1 `COLUMNS_JSON_TYPE_GAP` fixture, 6 `STALE:` fixtures. Fixtures built from real row shapes read read-only from `packages/server/data/kinetica.db` (`widget.config.sql`/`.metricColumn`/`.drillDownColumn`/`.drillDownColumnType` keys, confirmed via `sqlite3 -readonly`), labelled REAL-SHAPE in comments; all names substituted with neutral synthetic values (`col_a`, `col_dd`, `col_free`, "Widget", "Operations").

## Decisions Made

See "Discretion Decisions This Plan Settled" above for the five substantive ones. Additionally:
- Kept the Task 1/Task 2 implementation boundary collapsed into one write (as 124-01 and 124-02 both did), because `ImpactRecord.staleDrillDownType` is part of the contract Task 1 had to ship verbatim regardless of when its logic landed — see Deviations.
- `advisorySummary`'s report-level de-duplication is keyed by `namingKey(recordKind, recordId)` and checked in `buildRecordsFor`'s per-record loop (a `Set<string>` local to `buildImpactReport`, never exposed) — this is the caller-side half of 124-02's documented `summariseAdvisories` contract, and is exercised implicitly by the worked example above (widget `Ambiguous Widget` id 1 would only ever contribute one advisory even if it were affected by two columns, though the fixture here does not need to demonstrate that specific case since 124-02's own spec already pins `summariseAdvisories`'s "count what it's given" half).

## Deviations from Plan

### Process deviation (not a Rule 1-4 case — no code behavior affected)

**Task 1/Task 2 file-boundary collapsed, as in Plans 124-01 and 124-02.** `ImpactRecord.staleDrillDownType?: {...}` is part of the verbatim contract text Task 1's `<action>` block requires (it appears in the `ImpactRecord` type definition itself, before Task 2 is ever reached), so the full implementation — including `STALE_DRILL_DOWN_SITE` and `staleDrillDownFor`, and the conditional `if (stale) record.staleDrillDownType = stale;` line in `buildRecordsFor` — was written in one pass during Task 1 rather than added fresh during Task 2. This is NOT the same as skipping Task 2's own verification: Task 2's 8 new tests (6 `STALE:`, 2 `GROUPING:`) were written independently against the plan's exact required assertions (including the verbatim frozen-type message string) and run as a genuine pass/fail check — all 8 passed on the first run because the implementation was already correct, which is itself evidence the Task 1 write matched the Task 2 spec precisely. The full 9-probe mutation sweep (including P7/P8, which specifically target `staleDrillDownFor`'s two guards) was run against this final, single implementation and both reddened correctly. No functional gap exists between what Task 1 shipped and what Task 2's own acceptance criteria required — verified by running every Task 2 acceptance-criteria grep after the fact (see Gate Reports), all of which passed.

### Toothless acceptance criterion found and reported (not fixed by editing code)

**Task 1, acceptance criterion 12** (`grep -cE "localeCompare|new Date|Date\.now|Math\.random" src/lib/schemaImpact.ts` = 0, marked PROHIBITION) **does not discriminate as written.** The plan's own Task 1 `<action>` block requires the module's header comment to state, in prose, that the output is byte-stable ("no `localeCompare`, no `Date`, no locale-dependent ordering anywhere in this file") — the same documentation discipline `schemaDiff.ts` and `columnRefs.ts` already use in their own sort comments, which this plan explicitly says to follow. That mandated sentence necessarily contains the literal substrings "localeCompare" and "Date" (twice total, both on comment lines: the header's discipline statement and the `byColumnAscending` function's own explanatory comment).

Per CLAUDE.md ("if an executor finds a criterion that cannot discriminate, it should report it and verify the real requirement directly — never edit code to satisfy a broken check"), the required documentation was NOT stripped to force the grep to read 0. Instead the real requirement — no ACTUAL invocation of any of the four forbidden calls — was verified directly:
```
grep -nE "localeCompare\(|new Date\(|Date\.now\(|Math\.random\(" src/lib/schemaImpact.ts
```
returns zero matches (confirmed via a non-zero exit code / empty output). The real requirement — byte-stable, deterministic output with no locale-dependent or time-dependent code path — holds. This is the identical toothless-criterion class 124-01-SUMMARY.md documented for its own Task 1 acceptance criterion 8 (mandated attribution comments vs. a bare-substring purity prohibition); a future plan-check pass should anchor byte-stability prohibitions on an actual call syntax (e.g. `\(` suffix) rather than a bare word, exactly as that prior finding recommended.

---

**Total deviations:** 1 process deviation (commit-boundary granularity, no functional gap — independently re-verified against Task 2's own acceptance criteria), 1 toothless-criterion finding (reported, real requirement verified directly, no code changed to game the check).
**Impact on plan:** None on shipped behavior. Every locked decision (three-section structure, record grouping, free-SQL-removed-stays-breaking, certainty tier+prose, added-columns-excluded, stale-drill-down cross-reference, columnDisplayConfig zero-new-code, columns_json known gap, byte-stable output) holds as specified and is pinned by a mutation-tested assertion.

## Issues Encountered

None beyond the toothless-criterion finding documented above.

## User Setup Required

None — no external service configuration required.

## Gate Reports

- **`cd packages/server && npx tsc --noEmit`** — clean (exit 0), checked after Task 1, after Task 2, and again after the full mutation-probe sweep and restoration.
- **`cd packages/server && npx vitest run tests/lib.schemaImpact.spec.ts`** — 24/24 passed (16 after Task 1, 24 after Task 2's 8 additions).
- **`cd packages/server && npx vitest run tests/lib.schemaImpact.spec.ts tests/lib.columnRefs.spec.ts tests/lib.schemaDiff.spec.ts`** — 150/150 passed (the two consumed contracts are unaffected).
- **`cd packages/server && npx vitest run tests/lib.schemaImpact.spec.ts tests/lib.columnTypeClass.spec.ts tests/lib.impactNaming.spec.ts tests/lib.columnRefs.spec.ts tests/lib.schemaDiff.spec.ts`** — 186/186 passed (all four consumed/sibling contracts plus this plan's own spec).
- **`cd packages/server && node scripts/test-gate.mjs`** — **SET-BASED**, run three times (once after Task 1, once after Task 2, once at final verification):
  - Every run: exactly the **8 documented `KNOWN_FAILING`** entries (`tests/auth.oidc.spec.ts`, `tests/auth.routes.spec.ts`, `tests/boot.hardening.spec.ts`, `tests/boot.wipe.spec.ts`, `tests/bootstrap.spec.ts`, `tests/db.smoke.spec.ts`, `tests/oidc.module.spec.ts`, `tests/routes.wms.spec.ts`) — set unchanged, has NOT grown.
  - Transient `TD-V16-TEST-ISOLATION` contamination observed across the three runs (different files each time, all confirmed passing in isolation, all reported by the gate script itself, none a regression from this plan's own files): `tests/routes.dashboard-export.spec.ts` (run 2), `tests/routes.dashboard-display-mode.spec.ts` and `tests/routes.guards.spec.ts` (run 3, final verification).
  - GATE PASSED all three times.
  - Command run from `packages/server` in every invocation, per the plan's explicit "never from the repo root" instruction.
- **`shasum -a 256 src/lib/columnRefs.ts src/lib/schemaDiff.ts`**:
  - `columnRefs.ts`: `6c44c659de2529d3e7cd84188647ecc31cc095c7860dad88743511798d7f5fc8`
  - `schemaDiff.ts`: `5062f9a720f403848f814f4cc56db092dee97d23d82eefffc759acb39c09fb53`
  - `git diff --name-only 0a12756 -- packages/server/src/lib/columnRefs.ts packages/server/src/lib/schemaDiff.ts` produced **no output** — both files are byte-identical to the pre-phase commit. This phase CONSUMES those two contracts; it does not edit them.
- **`git diff --name-only 0a12756 | grep -c '^packages/web/'`** = **0** — `packages/web` is untouched across the whole phase (Waves 1-2-3). Web gates (`tsc`, `vitest`, `theme-guard`) were therefore not re-run, per the plan's own verification note.
- **Dataset hygiene grep** (`nyctaxi|us_states|vaipr|ookla|demodata|mobile_time_only|new_mobile_base|data_coverage_voice`, case-insensitive) over both files this plan wrote — **0 matches** in either `src/lib/schemaImpact.ts` or `tests/lib.schemaImpact.spec.ts`.

## Next Phase Readiness

`buildImpactReport`, `certaintyProse`, `COLUMNS_JSON_TYPE_GAP`, and the full `ImpactReport` type vocabulary are exported and ready for:
- **Plan 124-04** to wire `GET /api/tables/:id/schema-check` — call `buildImpactReport` on the `"diff"` outcome only, attach the result as `impact`, and leave `baseline_required`/`table_missing` responses with no `impact` key.
- **Phase 125** to persist `ImpactReport` verbatim in sync history (it is JSON-serialisable: no `Map`, `Set`, function, or class instance anywhere in the exported shape) and byte-stable across input reordering (proven by the `GROUPING: reordering the input rows produces byte-identical JSON` test).
- **Phase 126** to render it directly: every section is always present, every reference carries pre-composed `certainty` prose meant to be shown verbatim, and `knownGaps`/`advisorySummary` are flat string/advisory arrays ready for direct display.

No blockers. `packages/web` remains at zero diff for the whole phase.

---
*Phase: 124-impact-report*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/schemaImpact.ts`
- FOUND: `packages/server/tests/lib.schemaImpact.spec.ts`
- FOUND: commit `7bd2c1f` (feat(124-03): implement ImpactReport contract and severity/column/record assembly)
- FOUND: commit `479ca5d` (test(124-03): pin the frozen drill-down cross-reference and column-format-rule coverage)
