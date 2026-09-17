# Phase 119 Plan 04: Ninth-Reference-Kind Audit + Operator Export Checkpoint Summary

**Status: Task 1 (automated audit) complete. Task 2 (blocking operator checkpoint) is PENDING — this
file will be updated with an `## Operator verdict` section once the operator responds.**

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

## Task 2: Operator exports a real dashboard — AWAITING RESPONSE

This is a blocking `checkpoint:human-verify` task. See the orchestrator's checkpoint message for the
verbatim steps presented to the operator. This section will be replaced with the actual
`## Operator verdict` once they respond, per the plan's instruction.
