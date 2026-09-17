# Phase 119 Plan 04: Ninth-Reference-Kind Audit + Operator Export Checkpoint Summary

**Status: COMPLETE. Task 1 (automated audit) and Task 2 (blocking operator checkpoint) both done —
operator APPROVED, 2026-09-16. See `## Operator verdict` below for the full record.**

## Task 1: Ninth-reference-kind audit against a recorded baseline

### Command run (from `packages/web`, 2026-09-16)

```sh
cd packages/web && grep -rhoE "\bconfig(\?)?\.[A-Za-z_]*(Id|Ids)\b" src/components/charts src/lib src/store | sed -E 's/^config(\?)?\.//' | sort -u
```

### Recorded baseline (five lines, from the plan)

```
dynamicViewId
includedLayerIds
metricId
sourceMapWidgetId
tableId
```

### Observed output (this execution)

```
dynamicViewId
includedLayerIds
metricId
sourceMapWidgetId
tableId
```

**Result: byte-identical to the baseline. Zero diff.**

Each of the five names maps to an implemented `REF-n` in `packages/server/src/lib/dashboardExportRefs.ts`:

| Name | REF-n | Verified by |
|---|---|---|
| `tableId` | REF-1 | `grep -q "tableId" src/lib/dashboardExportRefs.ts` → match |
| `dynamicViewId` | REF-2 | `grep -q "dynamicViewId" src/lib/dashboardExportRefs.ts` → match |
| `sourceMapWidgetId` | REF-3 | `grep -q "sourceMapWidgetId" src/lib/dashboardExportRefs.ts` → match |
| `metricId` | REF-4 (scalar; REF-5 array form `metrics[].metricId` is a known blind spot, see below) | `grep -q "metricId" src/lib/dashboardExportRefs.ts` → match |
| `includedLayerIds` | REF-6 | `grep -q "includedLayerIds" src/lib/dashboardExportRefs.ts` → match |

Full automated verify command (from the plan) run and passed:

```
AUDIT-OK
```

`packages/server && npx tsc --noEmit` → clean. `node scripts/test-gate.mjs` → `GATE PASSED` (SET-BASED;
1042/1097 passed, 10 files failing — 8 on the documented known-failing list, 2
(`tests/layers.spec.ts`, `tests/routes.filter-materialize.spec.ts`) confirmed pass-alone
`TD-V16-TEST-ISOLATION` contamination). `git diff --exit-code -- packages/server packages/web` exits
0 — this task made no source changes.

### What this grep CAN and CANNOT see (stated honestly, not oversold)

This audit matches only fields written as a **direct** `config.<name>Id` / `config.<name>Ids` property
access (optionally through an optional-chain `config?.`). It is a first-level, flat-property pattern
match, not a JSON walker.

**It CANNOT and does NOT match the three already-known NESTED reference kinds:**

- `config.metrics[].metricId` (REF-5) — the id is one level down, inside an array element's own
  `.metricId` access (e.g. `el.metricId`, `m.metricId`), never literally typed as `config.metricId`
  at the point the array is indexed.
- `config.filterSelection.allowedSourceWidgetIds` (REF-7) — the id list hangs off a nested
  `filterSelection` object; the regex would need to match `allowedSourceWidgetIds` directly with no
  `config.` prefix, which it does not (by design — the pattern anchors on the literal `config.` /
  `config?.` prefix).
- `config.options[].actions[].target.id` (REF-8) — two levels of array nesting plus a polymorphic
  `.target.id`; nothing in that chain is spelled `config.<name>Id`.

These three are handled in `dashboardExportRefs.ts` (confirmed by direct code read, this plan) and
are proven present by 119-01's unit tests and 119-03's kitchen-sink integration fixture — but this
Task 1 grep is structurally blind to all three. **Task 2 (the operator's own real dashboard) is the
only check in this phase that can catch a nested ninth kind**, because a human comparing "what I
know is on this dashboard" against "what's in the file" doesn't care how deeply the id is nested.

### Named non-references (confirmed, so nobody re-investigates)

- `defaultOptionId`, `selectedOptionId` (RadioGroup) — option-local string keys, not entity ids.
- `shapeId`, `yAxisId`, `xAxisId`, `stackId` — chart-library-local identifiers (Nivo/visx internals),
  never persisted as foreign references.

### Third independent pass (converging evidence, not just this grep)

In addition to the plan's own prescribed audit above, an independent broader sweep was run as a
cross-check — matching `*Id`/`*Ids` (no `config.` prefix requirement) across the entire
`src/components/charts` tree:

```sh
cd packages/web && grep -rhoE "\b[A-Za-z_.]*(Id|Ids)\b" src/components/charts | sort -u
```

This produced 116 distinct identifier fragments. Beyond the five baseline names and their known
nested siblings (`metrics[].metricId`, `allowedSourceWidgetIds`, `target.id` reached via
`action.target`), every other candidate resolved to one of:

- **Runtime/local variable names never written into persisted `config`** — `originWidgetId`,
  `ownerWidgetId`, `sourceWidgetId`, `selfWidgetId`, `baseSourceTableId`, `chartTableId`, `targetId`,
  `activeWidgetId`, `activeLayerId`, `hitId`, `newId`, `addedId`, `removedId`, `orphanIds`, `liveIds`,
  `eligibleIds`, `currentIds`, `calledWidgetId`/`calledDashId`/`calledDvId`/`calledTableId`/`calledSnap.originWidgetId`
  (all test-fixture/mock-call variable names), `firstTableId`, `firstTargetId`, `newTableId`,
  `newLayerId`, `newDefaultId`, `persistedTableId`, `persistedDynamicViewId`, `storedMetricId`,
  `draftDynamicViewId`, `dvId`, `layerId`, `widgetId`, `dashboardId`, `controlId`, `sourceId`,
  `sourceTableId`, `selectedShapeId`, `selectedSource.*`, `gradientId`, `themeId`, `BasemapId`.
- **DOM/test-tooling APIs**, not domain ids at all — `document.getElementById`, `screen.getByTestId`,
  `screen.queryByTestId`, `useId`, `generateOptionId`, `randomId`, `this.getId`/`this.setId`,
  `feature.getId`/`feature.setId`.
- **Already-covered access paths to the same five/three known kinds**, just reached through a local
  variable or destructure rather than a literal `config.` prefix — e.g. `cfg.tableId`, `draft.tableId`,
  `saved.config.tableId`, `w.config.dynamicViewId`, `widget.config.includedLayerIds`,
  `boundWidget.config.includedLayerIds`, `arg.allowedSourceWidgetIds`,
  `value.allowedSourceWidgetIds`, `sel.metricId`, `m.metricId`.

No candidate resolved to a NEW persisted `config.*Id`/`Ids` field outside the eight kinds already in
`dashboardExportRefs.ts`. This is a **third** independent pass (research's original grep, this plan's
prescribed five-line baseline grep, and this broader unscoped sweep) converging on the same answer —
that convergence is the actual evidentiary weight here, not any single grep in isolation. It does
**not** relieve Task 2 of its job: none of these three passes can prove completeness against a real
customer-built dashboard the way a human export-and-inspect can.

---

## Task 2: Operator exports a real dashboard

## Operator verdict

**APPROVED.**

The operator exported one of their own real dashboards and reviewed the downloaded file directly
(verified by the orchestrator reading the downloaded file, not from the operator's self-report
alone).

**Dashboard exported:** id `4`, "Test Dashboard" — downloaded as
`~/Downloads/dashboard-4-test-dashboard.json`.

**Measured contents:**

| Field | Value |
|---|---|
| `schemaVersion` | 1 |
| `widgets` | 7 (types: heatmap, legend, map, radiogroup, records, table) |
| `layers` | 4 |
| `tables` | 3 |
| `dashboardTableIds` | 3 |
| `customMetrics` | 0 |
| `dynamicViews` | 0 |
| `danglingReferences` | 0 |

Envelope keys present and correct: `schemaVersion, exportedAt, dashboard, widgets, layers,
dynamicViews, tables, customMetrics, dashboardTableIds, danglingReferences`. The suggested filename
(`dashboard-4-test-dashboard.json`) is sensible and the file is readable/diffable.

`danglingReferences: 0` confirms no broken bindings on this particular dashboard.

### Reference-kind coverage — honest accounting (NOT "8/8 operator-verified")

This export exercised **5 of the 8** reference kinds live, on a real, operator-known dashboard,
including the three riskiest (widget-to-widget, layer-array, and the polymorphic action-target
kind). It did NOT exercise the remaining 3, because this particular dashboard contains none of the
relevant objects — those 3 remain covered by the automated suite (Plan 01 unit tests + Plan 03
kitchen-sink fixture) only, never by a human eye on a real customer-built dashboard.

**Live-verified by this operator export (5/8):**

| REF-n | Kind | Evidence in this export |
|---|---|---|
| REF-1 | `tableId` | 3 tables present |
| REF-3 | `sourceMapWidgetId` | a **legend** widget present (standalone Legend → map binding) |
| REF-6 | `includedLayerIds` | a **map** widget plus 4 layers |
| REF-8 | `options[].actions[].target` (+ legacy singular `action`) | a **radiogroup** widget present |
| — | `dashboard_tables` UNION edge | `dashboardTableIds: 3` |

**NOT exercised by this export — automated-only coverage (3/8):**

| REF-n | Kind | Why not exercised | Coverage that DOES exist |
|---|---|---|---|
| REF-2 | `dynamicViewId` | `dynamicViews: 0` — this dashboard has no dynamic view | Plan 01 unit test + Plan 03 kitchen-sink fixture only |
| REF-4 | scalar `metricId` | `customMetrics: 0` — this dashboard uses no custom metric | Plan 01 unit test + Plan 03 kitchen-sink fixture only |
| REF-5 | `metrics[].metricId` (array form) | `customMetrics: 0` — same reason | Plan 01 unit test + Plan 03 kitchen-sink fixture only |

This 5/8-vs-3/8 split is recorded deliberately (mirroring how Phases 115-117 recorded their
not-exercised items) because Phase 120 builds its id remapper directly on this inventory, and
"which reference kinds have only ever been seen in a fixture, never in a real customer dashboard"
must be known going in, not assumed to be equivalent to the 5 that were.

### Gap found

None. The operator found nothing missing, nothing extra, and no dangling references. No
`/gsd:plan-phase 119 --gaps` follow-up is required.

### Process findings (recorded per this plan's closing instruction)

- **20/20 mutation probes fired across the phase** (10 in Plan 01 against the pure reference-walk
  module, 10 in Plan 03 against the assembler/route), each reverted with the source confirmed
  byte-identical afterward (`git diff --exit-code` clean both times).
- **The self-tripped-criterion trap** (a plan mandating a code comment that literally quotes the
  very token its own acceptance-criteria grep counts, and the comment scoring against its own
  criterion) **hit all three prior waves** (119-01, 119-02, 119-03) and was caught each time by
  running the acceptance-criteria greps before committing rather than assuming they would pass —
  never by weakening the check.
- **`gsd-tools state advance-plan` / `roadmap update-plan-progress` cannot parse this project's
  STATE.md/ROADMAP.md file formats** (`Plan: N of M` vs. the tool's expected `Current Plan:` /
  `Total Plans in Phase:` headings). All four waves of this phase (119-01 through 119-04) hit this
  and worked around it with manual edits in the existing file style. Worth fixing at the source
  (teaching the tool this project's actual heading format) or formally documenting as a permanent
  tooling gap, since four consecutive waves have now paid the same workaround cost.

### Gates re-run against the current tree (2026-09-16, this continuation)

- `packages/server && npx tsc --noEmit` → clean.
- `node scripts/test-gate.mjs` → `GATE PASSED` (SET-BASED; 1044/1097 passed, 8 files failing, all 8
  on the documented known-failing list — no new regressions since Plan 03's run).
- `git diff --numstat 6ccf6d8 -- packages/web` → empty (server-only phase, confirmed again).
