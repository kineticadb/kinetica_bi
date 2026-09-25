---
phase: 124-impact-report
plan: 04
subsystem: api
tags: [schema-sync, impact-report, rbac, route-wiring, mutation-testing, vitest]

# Dependency graph
requires:
  - phase: 124-03
    provides: "buildImpactReport / ImpactReport / SchemaCheckResponse / ImpactInput — the report contract this plan wires into a live route"
  - phase: 123-column-reference-enumeration
    provides: "ColumnRefsInput shape + collectColumnRefs, called (once) inside buildImpactReport"
  - phase: 122-schema-diff-table-missing-detection
    provides: "GET /api/tables/:id/schema-check, its three-outcome contract, and the requireConfig + datasets:manage gate this plan extends"
provides:
  - "loadColumnRefsInput(tableId) — the SELECT-only, all-dashboards ColumnRefsInput assembler"
  - "GET /api/tables/:id/schema-check now attaches `impact` to the \"diff\" outcome only"
  - "The route's permission gate is now datasets:manage AND dashboards:manage_access (operator decision 2026-09-24)"
  - "SSYNC-V125-06/-09/-10/-11/-12 closed with evidence in REQUIREMENTS.md"
affects: [125-apply-sync-history, 126-datasets-ui-access-gating]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All-dashboards SELECT-only loader (four table-wide, deterministically ORDER BY id ASC queries) rather than a per-dashboard loop, for an administrative report that must not under-report by view-grant"
    - "Double-permission route gate via two back-to-back `...requirePermission(...)` spreads — the same AND-gate form as the v1.24 dashboard-import route (index.ts:817-818), reused rather than invented"
    - "Impact key presence (not an empty-vs-populated value) as the wire-level signal distinguishing 'not yet run' from 'nothing affected' from 'something changed'"

key-files:
  created: []
  modified:
    - packages/server/src/db.ts
    - packages/server/src/index.ts
    - packages/server/tests/routes.schema-check.spec.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "The schema-check route now requires BOTH datasets:manage AND dashboards:manage_access, not datasets:manage alone (operator decision 2026-09-24, applied verbatim from the plan's amended Task 1 action block). Adds NO new permission to the catalog — DASHBOARDS_MANAGE_ACCESS already exists and is already in a default role's set."
  - "Task 1's file list (packages/server/src/db.ts, tests/routes.schema-check.spec.ts) did not list packages/server/src/index.ts, but the plan's own ROUTE GATE AMENDED block (added after the plan check) mandates editing index.ts's permission gate as part of Task 1. Implemented the gate change and its 403 test in the Task 1 commit as directed by the amendment text, despite the header omission — the same commit-boundary-vs-late-amendment pattern 124-01/02/03 already documented for their own Task-boundary collapses."
  - "Mutation probe P5 required strengthening the test, not the probe (see Mutation Probe Table) — an empty `dashboards` input still produces the literal substring \"on dashboard\" via impactNaming.ts's id-fallback phrasing (`on dashboard ${id}`, unquoted), so the plan's own toContain(\"on dashboard\") assertion could not discriminate it from a populated `dashboards` array. Strengthened to also assert the quoted real dashboard name."

requirements-completed: [SSYNC-V125-06, SSYNC-V125-09, SSYNC-V125-10, SSYNC-V125-11, SSYNC-V125-12]

duration: 20min
completed: 2026-09-24
---

# Phase 124 Plan 04: Route Wiring, All-Dashboards Loader & Requirement Closure Summary

**`GET /api/tables/:id/schema-check` now attaches the Phase 124 impact report to its `"diff"` outcome via a new SELECT-only, all-dashboards loader, and the route is now double-gated on `datasets:manage` AND `dashboards:manage_access` — an operator decision applied after the plan check, closing all five of Phase 124's requirements.**

## Performance

- **Duration:** ~20 min (excluding the operator checkpoint wait)
- **Started:** 2026-09-24T19:38:00Z (approx., first file read)
- **Completed:** 2026-09-24T19:57:00Z
- **Tasks:** 2 automated tasks + 1 checkpoint (approved, no rework)
- **Files modified:** 5 (`db.ts`, `index.ts`, `routes.schema-check.spec.ts`, `REQUIREMENTS.md`, `ROADMAP.md`) — zero files created

## Accomplishments

- Shipped `loadColumnRefsInput(tableId)` in `db.ts` — four table-wide, deterministically ordered SELECTs (`widgets`, `dashboard_layers`, `dashboard_dynamic_views`, `dashboard_table_views`) plus the two existing table-scoped accessors (`listCustomMetrics`, `listColumnDisplayConfig`), assembling the exact `ColumnRefsInput` shape Phase 123 defined. Proven SELECT-only by a PROHIBITION grep and a byte-identical-config-tables integration test.
- Proven the all-dashboards reach with a test a per-dashboard loader structurally cannot pass: a widget on a SECOND dashboard still appears in the report (mutation probe P1 confirms — scoping the widget SELECT to one dashboard reddens exactly this test).
- Wired `buildImpactReport` into `GET /api/tables/:id/schema-check`'s existing "diff" return only, per the plan's interface block — the three prior return points (404, `table_missing`, `baseline_required`) were untouched except for the deliberate non-attachment of `impact`.
- **Route-gate amendment (operator decision 2026-09-24, applied exactly as specified):** the route now requires BOTH `datasets:manage` and `dashboards:manage_access`. Reasoning, reproduced from the plan: the impact report deliberately names widgets and dashboards across EVERY dashboard — a report scoped to what the caller can already see would under-report, which is the failure mode this milestone exists to prevent. But `datasets:manage` alone does not govern cross-dashboard visibility: `canViewDashboard` bypasses on `dashboards:manage_access` (`lib/dashboardAccessDb.ts:11`), a DIFFERENT permission, and role→permission mappings are DB-editable with no reset-to-defaults (`lib/permissions.ts:5,61`). Without the second gate, a custom role holding `datasets:manage` without `dashboards:manage_access` would see widget titles and dashboard names, through this route alone, that it cannot see anywhere else in the app. This adds **no new permission to the catalog** — `DASHBOARDS_MANAGE_ACCESS` already exists (`permissions.ts:23`) and is already in a default role's set — and follows the exact double-gate spread form the v1.24 dashboard-import route already established (`index.ts:817-818`). `git diff --name-only -- packages/server/src/lib/permissions.ts packages/server/src/lib/rbacDb.ts` is empty: zero catalog change. Web `RolesPage`/permissions specs were not touched and remain green.
- Closed all five of Phase 124's requirements (SSYNC-V125-06/-09/-10/-11/-12) in `REQUIREMENTS.md` with evidence citing plan, spec file, and proving test title; ticked all four `124-0x-PLAN.md` boxes in `ROADMAP.md`.
- Operator approved the Task 3 prose checkpoint on 2026-09-24 with **no rewording** — every operator-facing string ships exactly as implemented by Plans 124-02/124-03.

## Task Commits

1. **Task 1: `loadColumnRefsInput` + the double-permission route gate** - `5a0b2c6` (feat) — includes the route-gate amendment and its 403 test (see Deviations: file-list vs. amendment scope)
2. **Task 2: Wire the report into the route + close the five requirements** - `c746f24` (feat)

**Plan metadata:** _(this commit — SUMMARY.md)_

## Operator Checkpoint (Task 3)

**Result: APPROVED, 2026-09-24, no rewording requested.** All operator-facing prose ships exactly as presented at the checkpoint. Per the plan's `<output>` requirement, the approved strings are reproduced verbatim below — Phase 126 renders these VERBATIM and is planned against this exact text.

### Approved strings, verbatim (from `packages/server/src/lib/schemaImpact.ts` and `impactNaming.ts`)

**Certainty prose — exact confidence:**
> confirmed — this record stores the column in its `${path}` field.

**Certainty prose — free-SQL / heuristic:**
> possibly affected — `${path}` mentions `${column}`, but the match is text-based and may be a false positive.

**Certainty prose — free-SQL / low-confidence (short/common column name):**
> possibly affected — `${column}` is a short or common name, so this text match in `${path}` is more likely than most to be a false positive.

**Certainty prose — unresolved table scope suffix (appended to any of the three above):**
> This record's own table could not be determined, so it is reported for every table that changes.

**Removed-column summary:**
> The column `${column}` is gone from the table. Its stored type was ${storedType}.

**Record display label (default, no collision):**
> widget "${title}" on dashboard "${dashboardName}"

**Naming advisory — ambiguous name:**
> Two or more widgets on dashboard "${dashboardName}" are named "${title}", so the report appends the id (${id}) to tell them apart. Rename one and re-run this check to see them by name alone.

**Naming advisory — unnamed record:**
> This ${recordKind} has no name, so the report can only identify it by its id (${id}). Name it and re-run this check to see it by name.

**Stale drill-down message:**
> This widget's drill-down is frozen at type "${frozenType}", but the column is now ${liveClass}. It keeps filtering with the stale type until someone reopens its config and re-picks the column — nothing errors in the meantime.

**`COLUMNS_JSON_TYPE_GAP` (known-gap note):**
> Dynamic views cache their own column list with a frozen type (`columns_json[].type`). That is a second frozen type cache, alongside a widget's `drillDownColumnType`, and a retype leaves it stale in the same way. This report does NOT check it.

These are reproduced identically to `124-02-SUMMARY.md` and `124-03-SUMMARY.md`'s own verbatim declarations — Plan 124-04 changed no string literal in either `schemaImpact.ts` or `impactNaming.ts`; it only wired the already-shipped, already-approved contract into a live route.

### The report JSON shown at the checkpoint (produced live, via a temporary `console.log` since removed)

```json
{
  "v": 1,
  "table": "demo.impact_table_3",
  "tableId": 1,
  "outcome": "changes",
  "sections": [
    {
      "severity": "breaking",
      "columns": [
        {
          "column": "col_a",
          "changeKind": "removed",
          "storedType": "string(char8)",
          "liveType": null,
          "storedClass": "string",
          "liveClass": null,
          "summary": "The column `col_a` is gone from the table. Its stored type was string(char8).",
          "records": [
            {
              "recordKind": "widget",
              "recordId": 1,
              "name": "Widget One",
              "dashboardName": "Impact Naming Dashboard",
              "displayLabel": "widget \"Widget One\" on dashboard \"Impact Naming Dashboard\"",
              "advisories": [],
              "references": [
                {
                  "site": "widget.config.metricColumn",
                  "path": "config.metricColumn",
                  "confidence": "exact",
                  "tableScope": "scoped",
                  "certainty": "confirmed — this record stores the column in its `config.metricColumn` field.",
                  "matches": []
                }
              ]
            }
          ]
        }
      ]
    },
    { "severity": "changed", "columns": [] },
    { "severity": "harmless", "columns": [] }
  ],
  "advisorySummary": [],
  "knownGaps": [
    "Dynamic views cache their own column list with a frozen type (`columns_json[].type`). That is a second frozen type cache, alongside a widget's `drillDownColumnType`, and a retype leaves it stale in the same way. This report does NOT check it."
  ]
}
```

The `console.log` was removed before the Task 1/2 commits landed (the working tree was verified clean via `git status --short` after removal).

## Verbatim Declarations

### `loadColumnRefsInput`, reproduced exactly as shipped in `packages/server/src/db.ts`

```ts
/**
 * v1.25 Phase 124 (SSYNC-V125-06/-09/-10/-11/-12): assemble the ColumnRefsInput the impact report
 * walks. SELECT-only — this function writes NOTHING, matching the schema-check route's own
 * no-write guarantee (proven by that route's "byte-identical config tables" spec).
 *
 * Four TABLE-WIDE selects, not a per-dashboard loop: a column reference from ANY dashboard is
 * relevant to the table that changed, and the existing listWidgets/listDashboardLayers/
 * listDashboardDynamicViews/listViews accessors are all dashboard-scoped. `ORDER BY id ASC` on
 * each makes the input deterministic, which the report's byte-stability depends on.
 *
 * Custom metrics and column-display-config rows ARE table-scoped (their tables carry table_id),
 * so those two reuse the existing accessors unchanged.
 *
 * Visibility note: this deliberately reads EVERY dashboard's rows regardless of per-dashboard view
 * grants. The schema-check route is gated on datasets:manage AND dashboards:manage_access — an
 * administrative operation whose whole purpose is "show me everything this change breaks".
 * Filtering by the caller's dashboard grants would under-report, which is the failure mode this
 * milestone exists to prevent.
 */
export const loadColumnRefsInput = (tableId: number): ColumnRefsInput => ({
  widgets: db.prepare("SELECT * FROM widgets ORDER BY id ASC").all().map(mapWidget),
  layers: db.prepare("SELECT * FROM dashboard_layers ORDER BY id ASC").all().map(mapDashboardLayer),
  dynamicViews: db
    .prepare("SELECT * FROM dashboard_dynamic_views ORDER BY id ASC")
    .all()
    .map(mapDashboardDynamicView),
  tableViews: db
    .prepare("SELECT * FROM dashboard_table_views ORDER BY id ASC")
    .all()
    .map(mapView),
  customMetrics: listCustomMetrics(tableId),
  columnDisplayConfig: listColumnDisplayConfig(tableId),
});
```

### The wired route's final block, reproduced exactly as shipped in `packages/server/src/index.ts` (Phase 125 edits this same block to add the apply/persist step — planned against this exact shape)

```ts
  // v1.25 Phase 124 route-gate amendment (SSYNC-V125-06/-09/-10/-11/-12, operator decision
  // 2026-09-24): the impact report (wired below) names widgets and dashboards across EVERY
  // dashboard, deliberately -- a report scoped to what the caller can already see would
  // under-report. datasets:manage alone does not govern cross-dashboard visibility
  // (canViewDashboard bypasses on dashboards:manage_access, lib/dashboardAccessDb.ts:11, a
  // DIFFERENT permission), so this route now requires BOTH -- the same AND-gate spread form as
  // the v1.24 dashboard-import route (:817-818). Adds NO new permission to the catalog.
  app.get(
    "/api/tables/:id/schema-check",
    requireConfig,
    ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
    ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const table = getTable(id);
      if (!table) return res.status(404).json({ error: "Table not found." });

      const qualified = `${table.schema}.${table.name}`;

      const body = await kineticaShowTable(req as AuthedRequest, qualified, {
        route: "GET /api/tables/:id/schema-check",
        op: "DISCOVERY",
        showOptions: { no_error_if_not_exists: "true" },
      });

      const presence = tablePresence(body);
      if (presence === "unreadable") {
        throw new KineticaUpstreamError(
          "Kinetica returned an unreadable /show/table response; the schema check could not complete."
        );
      }
      if (presence === "missing") {
        return res.json(tableMissingResult(qualified));
      }

      const live = parseColumnFingerprints(body, qualified);
      if (Object.keys(live).length === 0) {
        // The table exists but no column types could be read. Reporting a diff here would say
        // every column was removed — a confidently wrong finding from a degraded response.
        throw new KineticaUpstreamError(
          "Kinetica reported the table exists but returned no readable column types; the schema check could not complete."
        );
      }

      const stored = parseFingerprintSnapshot(getTableColumnsFingerprint(id));
      if (!stored) return res.json(baselineRequiredResult(qualified, live));

      const diff = diffResult(qualified, stored, live);
      // The impact report is attached ONLY to the "diff" outcome. Its ABSENCE is what tells
      // Phase 126 "not yet run / not applicable" — a baseline_required or table_missing response
      // carries no `impact` key at all, and an empty report would be indistinguishable from one.
      if (diff.outcome !== "diff") return res.json(diff); // unreachable; narrows the union
      const impact = buildImpactReport({
        check: diff,
        tableId: id,
        refsInput: loadColumnRefsInput(id),
        dashboards: listDashboards().map((d) => ({ id: d.id, name: d.name })),
      });
      const response: SchemaCheckResponse = { ...diff, impact };
      return res.json(response);
    })
  );
```

### `SchemaCheckResponse` wire shape and the presence rule (for Phase 126)

`SchemaCheckResponse = SchemaCheckResult & { impact?: ImpactReport }`. Three, and only three, wire states:

| Response shape | Meaning |
|---|---|
| `outcome: "baseline_required"` or `"table_missing"`, **no `impact` key at all** | Not applicable — no precise baseline exists yet, or the table is gone/renamed in Kinetica. Phase 126 must NOT render an impact panel here. |
| `outcome: "diff"`, `impact.outcome === "no_changes"` | The check ran successfully and found nothing — an explicit, positive "you're in sync" state, not the absence of a report. |
| `outcome: "diff"`, `impact.outcome === "changes"` | At least one column changed; `impact.sections` holds the findings (always exactly three sections, breaking/changed/harmless, each possibly empty). |

Proven live by two dedicated tests asserting `expect(res.body).not.toHaveProperty("impact")` on the two non-diff outcomes, plus a third asserting `expect(res.body.impact.outcome).toBe("no_changes")` on an unchanged table.

### The visibility decision (verbatim reasoning, for Phase 126's UI copy if it ever explains the gate)

The loader reads every dashboard's widgets, layers, dynamic views and saved filter views regardless of the calling operator's own per-dashboard view grants. The schema-check route is an administrative operation gated on `datasets:manage` AND (as of this plan) `dashboards:manage_access` — its whole purpose is "show me everything this change breaks," and filtering by the caller's own dashboard grants would under-report, which is the exact failure mode this milestone exists to prevent.

## Requirement Closure Table

| ID | Plan | Spec file | Proving test |
|----|------|-----------|--------------|
| SSYNC-V125-06 | 124-04 | `tests/routes.schema-check.spec.ts` | `"IMPACT: a widget on a SECOND dashboard referencing the removed column still appears in the report"` + `"IMPACT: a removed column returns a breaking section naming the affected widget by title and dashboard"` |
| SSYNC-V125-09 | 124-03 (wired live by 124-04) | `tests/lib.schemaImpact.spec.ts` (`CERTAINTY:` fixtures) + live route response | `certaintyProse` — renders "confirmed" only for `exact` confidence, "possibly affected" for `heuristic`/`low-confidence`; verified end-to-end through the wire response in this plan's own tests |
| SSYNC-V125-10 | 124-03 (wired live by 124-04) | `tests/lib.schemaImpact.spec.ts` (`GROUPING:` column-format-rule fixtures) | Closed by an **EXISTING** Phase 123 site (`columnDisplayConfig.column_name`, already one of the 40 `collectColumnRefs` sites) plus new tests — explicitly NOT new traversal. `loadColumnRefsInput` reuses `listColumnDisplayConfig` unchanged. |
| SSYNC-V125-11 | 124-03 (wired live by 124-04) | `tests/routes.schema-check.spec.ts` | `"IMPACT: an added column appears only in the harmless section"` |
| SSYNC-V125-12 | 124-03 (wired live by 124-04) | `tests/routes.schema-check.spec.ts` | `"IMPACT: a retyped column's entry states the stored type and the live type"` |

## Mutation Probe Table (5 named probes + the route-gate probe, all fired)

| # | Mutation | Named test | Result |
|---|----------|------------|--------|
| P1 | Scope `loadColumnRefsInput`'s widget SELECT to `WHERE dashboard_id = 1` | `"IMPACT: a widget on a SECOND dashboard referencing the removed column still appears in the report"` | **REDDENED** — `recordNames` became `[]`; the second-dashboard widget disappeared. |
| P2 | Attach `impact` to the `baseline_required` return as well | `"IMPACT: a baseline_required response carries NO impact key"` | **REDDENED** — mutant `impact` object leaked into the response. |
| P3 | Attach `impact` to the `table_missing` return as well | `"IMPACT: a table_missing response carries NO impact key"` | **REDDENED** — same leak. |
| P4 | Return `outcome: "changes"` unconditionally from `buildImpactReport` | `"IMPACT: an unchanged table returns an impact report with outcome no_changes"` | **REDDENED** — assertion expected `"no_changes"`, got `"changes"`. |
| P5 | Pass `dashboards: []` into `buildImpactReport` | `"IMPACT: a removed column returns a breaking section naming the affected widget by title and dashboard"` | **DID NOT REDDEN on the first attempt.** `impactNaming.ts`'s id-fallback phrasing (`` on dashboard ${dashId} ``, unquoted, when a dashboard id is absent from the `dashboardNames` map) still contains the literal substring `"on dashboard"`, so the plan's own `toContain("on dashboard")` assertion could not tell a real dashboard name from a dropped `dashboards` input. **Test STRENGTHENED** (never the probe) to additionally assert the QUOTED real name — `toContain('on dashboard "Impact Naming Dashboard"')` — and `record.dashboardName === "Impact Naming Dashboard"`. Re-run **REDDENED** as expected: the mutant produced `"widget \"Widget One\" on dashboard 1"`. |
| Route-gate probe (ad hoc, per the plan's amended Task 1 action) | Remove `...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` from the route | `"ROUTE-403: a session holding only datasets:manage is still denied (dashboards:manage_access is required too)"` | **REDDENED** — status became 200 instead of the expected 403. |

Every probe's source file was restored via file copy and diffed byte-identical against the pre-mutation version before moving to the next probe (all confirmed `IDENTICAL` by `diff`).

## Files Created/Modified

- `packages/server/src/db.ts` — added `loadColumnRefsInput(tableId)` (37 lines incl. doc comment) and a type-only import of `ColumnRefsInput` from `./lib/columnRefs`. No other line touched.
- `packages/server/src/index.ts` — added the second `requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` gate spread + its explanatory comment, the `buildImpactReport`/`SchemaCheckResponse` imports, `loadColumnRefsInput` added to the `./db` import block, and replaced the route's single final `return res.json(diffResult(...))` line with the impact-attachment block. No other route in the file was touched.
- `packages/server/tests/routes.schema-check.spec.ts` — added `PERMISSIONS` import, `seedDatasetsManageOnlySession` helper (mirrors `routes.dashboard-import.spec.ts`'s `seedManageOnlySession`), one `ROUTE-403:` gate test, and a new `describe("... — impact report")` block with 8 `IMPACT:` tests (2 from Task 1, 6 from Task 2). All 14 pre-existing tests in the file are byte-unchanged.
- `.planning/REQUIREMENTS.md` — ticked SSYNC-V125-06/-09/-10/-11/-12, rewrote their five description lines with automation evidence, updated the five traceability-table rows to `Complete`, and corrected the stale `Complete: 4` summary line to `Complete: 11` (it had not been updated after Phase 123 either — fixed here since this plan is the sole owner of this file's Phase 124 bookkeeping and the drift was directly adjacent to the lines this plan owns).
- `.planning/ROADMAP.md` — ticked the four `124-0x-PLAN.md` plan-line checkboxes. Goal and the five success criteria left untouched, per the plan.

## Decisions Made

See `key-decisions` in the frontmatter for the three substantive ones. Additionally:
- Reused the top-level `CHANGED_STORED`/`CHANGED_LIVE_BODY`/`STABLE_MAP`/`STABLE_LIVE_BODY`/`MISSING_BODY` fixtures already present in the file (Phase 122's own fixtures) for the retype/added/no-changes/baseline/missing IMPACT tests, rather than inventing parallel fixtures — this kept new content minimal and avoided introducing any further dataset-specific names beyond the two already-neutral local `IMPACT_STORED`/`IMPACT_LIVE_BODY` constants this plan added.
- The IMPACT-describe-block fixtures were built with TWO columns (`col_a` removed, `col_b` unchanged) rather than one, because a live body reporting zero readable columns triggers the route's own "no readable column types" `KineticaUpstreamError` (502) — a degraded-response guard, not a diff outcome. Discovered by actually running the tests (first attempt 502'd); documented here rather than silently worked around.

## Deviations from Plan

### Process deviation: Task 1's declared file list understated its own amended scope (not a Rule 1-4 case — matches the plan's own instructions)

Task 1's frontmatter-adjacent `<files>` list names only `packages/server/src/db.ts` and `tests/routes.schema-check.spec.ts`. But Task 1's own `<action>` block contains a "ROUTE GATE AMENDED — operator decision 2026-09-24, apply this" section that mandates editing the permission gate in `packages/server/src/index.ts` and adding a discriminating 403 test — both explicitly required by acceptance criteria embedded in that same `<action>` block (the `PERMISSIONS.DASHBOARDS_MANAGE_ACCESS` count `3 -> 4` grep, the 403 test, the `permissions.ts`/`rbacDb.ts` zero-diff check). This is a case where the plan's own late amendment (added after the plan check, per the orchestrator's own framing) outran its file-list header. Implemented the gate change and its test in the Task 1 commit as the amendment directs. No functional ambiguity — every acceptance criterion the amendment specifies was independently verified to pass (see Gate Reports). Flagged per the "document all deviations" instruction; same class of finding 124-01/02/03 each documented for their own task-boundary/file-list mismatches.

### Fourth toothless acceptance criterion found this phase (reported, real requirement verified directly — not gamed)

Task 1's dataset-hygiene PROHIBITION (`grep -icE "nyctaxi|us_states|vaipr|ookla|demodata|mobile_time_only|new_mobile_base|data_coverage_voice" <the files this task writes>` = 0) **does not discriminate as literally written against the whole file.** `routes.schema-check.spec.ts` is a pre-existing Phase-122 file already containing **18** occurrences of `nyctaxi` — the operator's own public NYC-taxi demo dataset name, used throughout its 14 pre-existing fixtures/tests since 2026-09-21 (predating both purge commits `bdd8265`/`9ae6fcc` this rule cites). Running the grep against the whole file post-edit would read 18, not 0, and would have read 18 even with zero new lines added.

Per CLAUDE.md ("if an executor finds a criterion that cannot discriminate, it should report it and verify the real requirement directly — never edit code to satisfy a broken check"), the pre-existing fixtures were left untouched (out of this task's scope; Rule boundary), and the real requirement — **no new dataset-specific identifier introduced by this plan's own added content** — was verified by diffing only the ADDED lines:

```
git diff <file> | grep '^+' | grep -icE "nyctaxi|us_states|vaipr|ookla|demodata|mobile_time_only|new_mobile_base|data_coverage_voice"
```

This diff-based check caught something real: my first draft of the new `ROUTE-403:` gate test copy-pasted the surrounding file's `createTable({ name: "nyctaxi", schema: "demo" })` idiom by habit, introducing exactly one new `nyctaxi` occurrence in a test that had no reason to use that name. The added-lines grep read 1, not 0, immediately after I believed Task 1 was complete. Renamed it to the neutral `"demo_table"` and re-ran the check — 0 added-lines matches, confirmed. This is a good illustration of why the criterion should be anchored to ADDED lines rather than the whole file: a whole-file check on a file this plan only extends would either (a) always fail on pre-existing content and teach the executor to distrust the gate, or (b) as originally scoped ("the files this task writes"), pass trivially without ever catching the copy-paste habit that a diff-based check did catch. A future plan-check pass should write this criterion as a diff against the pre-plan commit, restricted to `^+` lines, from the start — the same fix 124-01-SUMMARY.md already recommended for its own purity-prohibition false positive, now recommended a second time for a different criterion class.

This is the **fourth** toothless acceptance criterion found and reported in this phase (124-01's `packages/web` grep against mandated attribution comments; 124-03's `localeCompare|new Date|Math.random` grep against its own mandated byte-stability documentation, twice across Tasks 1 and 2's shared file; now this one) — consistent with the orchestrator's explicit prediction that a fourth instance was likely.

---

**Total deviations:** 1 process deviation (file-list vs. late-amendment scope, no functional gap — every amendment-mandated acceptance criterion independently verified), 1 toothless-criterion finding (reported, real requirement verified via an added-lines diff, one incidental copy-pasted dataset name caught and fixed by that same check, no pre-existing content altered to game the check).
**Impact on plan:** None on shipped behavior. The route gate, the all-dashboards loader, the impact-key presence rule, and all five requirement closures hold exactly as specified.

## Issues Encountered

- My first attempt at the two Task 1 `IMPACT:` fixtures used a single-column table (`col_a` only, removed). The corresponding live body then reported zero readable columns, which the route's own pre-existing degraded-response guard (`Object.keys(live).length === 0` → `KineticaUpstreamError`, 502) correctly rejects as "no readable column types," not a diff. Fixed by adding a second, unchanged column (`col_b`) to both fixtures so the live response is never empty — a real constraint of the route's own honest-failure design, not a bug in it.
- None beyond that fixture fix and the toothless-criterion finding documented above. Each mutation-probe restoration was taken from a fresh backup of the then-current (post-edit) source and confirmed byte-identical by `diff` before moving to the next probe; no stale or in-progress edit was ever overwritten.

## User Setup Required

None — no external service configuration required.

## Gate Reports

- **`cd packages/server && npx tsc --noEmit`** — clean (exit 0), checked after Task 1, after Task 2, after every mutation-probe restoration, and again just before this SUMMARY.
- **`cd packages/server && npx vitest run tests/routes.schema-check.spec.ts`** — **23/23 passed** (14 pre-existing tests unchanged + 1 new `ROUTE-403:` gate test + 2 Task-1 `IMPACT:` tests + 6 Task-2 `IMPACT:` tests). Confirmed green at Task 1 (with the 2 new `IMPACT:` tests in the intended RED state, pending Task 2's wiring), at Task 2 (all 23 green), after each mutation-probe restoration, and at final verification.
- **`cd packages/server && node scripts/test-gate.mjs`** — **SET-BASED**, run four times (after Task 1, after Task 2, once more after the mutation sweep, once more at final verification before this SUMMARY):
  - Every run: exactly the **8 documented `KNOWN_FAILING`** entries (`tests/auth.oidc.spec.ts`, `tests/auth.routes.spec.ts`, `tests/boot.hardening.spec.ts`, `tests/boot.wipe.spec.ts`, `tests/bootstrap.spec.ts`, `tests/db.smoke.spec.ts`, `tests/oidc.module.spec.ts`, `tests/routes.wms.spec.ts`) — set unchanged, has NOT grown.
  - Transient `TD-V16-TEST-ISOLATION` contamination observed across the four runs (a different file(s) each time, all confirmed passing in isolation, all reported by the gate script itself, none a regression from this plan's own files): `tests/routes.dashboard-export.spec.ts` and `tests/routes.filter-materialize.spec.ts` (one run), `tests/routes.dashboard-import.refs.spec.ts` (a later run).
  - **GATE PASSED** all four times. Command run from `packages/server` in every invocation, per the plan's explicit "never from the repo root" instruction.
- **`git diff --name-only -- packages/server/src/lib/permissions.ts packages/server/src/lib/rbacDb.ts`** — empty. Zero catalog change; the double-gate uses an existing permission.
- **`git diff --name-only 0a12756 | grep -c '^packages/web/'`** = **0** — `packages/web` is untouched across the whole phase (Waves 1-4). Web gates (`tsc`, `vitest` 181 files / 4100 tests, `theme-guard` 152/152) were therefore NOT re-run, per the plan's own verification note; they remain at the last-known-green state from Phase 123's own verification.
- **`.planning/REQUIREMENTS.md` `Pending` count** — BEFORE (at commit `0a12756`): **13**. AFTER (this plan): **8**.
- **`.planning/ROADMAP.md` Phase 124 plan-box counts** — BEFORE this plan (after the planner's own write): `- [ ] 124-0x` = 4, `- [x] 124-0x` = 0. AFTER: `- [x] 124-0x` = 4.
- **Dataset hygiene grep, added-lines-only** (see Deviations) — 0 matches in both files' new content, after fixing the one incidental `nyctaxi` copy-paste.

## Note for Phase 126 (live-observed, not a defect)

**Five of the nine registered tables have been dropped from Kinetica** (live-observed 2026-09-23 — `/show/table` returns `table_names: []` for them). A live check against most of the registered tables today will therefore return `table_missing`, not a diff. This is expected behaviour given the current state of the live Kinetica instance, not a defect in this plan's work — Phase 126's operator verification should expect it and not file it as a bug.

## Next Phase Readiness

- **Phase 125** (Apply & Sync History) edits the exact same route block reproduced verbatim above, to add the apply/persist step after the impact report is built. `loadColumnRefsInput` and the impact-attachment block are stable and unchanged from what is reproduced here.
- **Phase 126** (Datasets UI, Access Gating & Operator Verification) renders `ImpactReport` and must gate its own UI/API access on the SAME two permissions this route now requires (`datasets:manage` AND `dashboards:manage_access`) — SSYNC-V125-19 will need to account for the double-gate, not just `datasets:manage` alone, when it is planned.
- Phase 124 is now COMPLETE: all four plans executed, all five requirements closed. Plans 124-01/02/03 shipped 186/186 passing across their own three new lib specs plus the two sibling contracts they consume (per `124-03-SUMMARY.md`'s Gate Reports); this plan's `routes.schema-check.spec.ts` is now 23/23 passing. Server gate passing with the same 8 `KNOWN_FAILING` entries throughout the phase; zero `packages/web` diff for the entire phase.
- No blockers.

---
*Phase: 124-impact-report*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `packages/server/src/db.ts` (contains `loadColumnRefsInput`)
- FOUND: `packages/server/src/index.ts` (contains `buildImpactReport` wiring)
- FOUND: `packages/server/tests/routes.schema-check.spec.ts` (23 tests, all passing)
- FOUND: `.planning/REQUIREMENTS.md` (5 requirements ticked, Pending count 8)
- FOUND: `.planning/ROADMAP.md` (4 plan boxes ticked)
- FOUND: commit `5a0b2c6` (feat(124-04): add loadColumnRefsInput and double-permission route gate)
- FOUND: commit `c746f24` (feat(124-04): wire the impact report into the schema-check route)
