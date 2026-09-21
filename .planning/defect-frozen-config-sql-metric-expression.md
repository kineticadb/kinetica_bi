# DEFECT: `config.sql` freezes a custom metric's EXPRESSION, so imported widgets compute the source environment's definition

**Found:** 2026-09-18, by the operator during the Phase 121 cross-environment round trip (Step 5/6).
**Severity:** High — silently renders the wrong number, and falsifies the metric-conflict report v1.24 ships.
**Status:** FIXED 2026-09-21 (Phase 121 plans 05-07). Root cause was PRE-EXISTING (predates v1.24);
the false report text was v1.24's own. See "Fix as shipped" below.

## Symptom

Env B's `try_again` custom metric was edited to `AVG(total_amount - tip_amount) * 50.111111`.
The import report stated, correctly per its intent:

> Custom metric "try_again" on demo.nyctaxi already exists in this environment with a DIFFERENT
> expression. Imported widgets now use the EXISTING definition (AVG(total_amount - tip_amount) *
> 1.111111); the file's definition (AVG(total_amount - tip_amount)) was NOT applied.

The imported **Line Chart** renders `14.307650071701081` — byte-identical to env A, i.e. the FILE's
definition. The Configure panel for the SAME widget shows `Generated SQL` with `* 50.111111`.

The panel and the chart disagree. The chart is what the user believes.

## Root cause: `config.sql` is a frozen text snapshot, and nothing regenerates it

`ChartConfigPanel` resolves `metricId -> expression` via `resolveMetricExpr` (reads
`customMetricsStore` live) and bakes the result into `widget.config.sql` at **Apply** time:

```
"metricId": 2,
"sql": "SELECT vendor_id, AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi
        GROUP BY vendor_id ORDER BY value DESC LIMIT 100"
```

- `WidgetRenderer.tsx:403` — `AggregatedWidgetRenderer` fetches with `const sql = cfg.sql`.
  `grep -c resolveMetricExpr packages/web/src/components/charts/WidgetRenderer.tsx` -> **0**.
  It NEVER resolves the metric live.
- `packages/server/src/lib/dashboardImport.ts` never touches `config.sql` — a targeted grep for
  `config.sql` returns nothing. All nine reference kinds are **id**-valued; the frozen SQL is a
  TENTH, TEXT-valued reference that no sweep considered because it is a string, not an id.

So import correctly remaps `metricId` 10 -> 2 (REF-4 works), and the widget then ignores it.

## Two code paths disagree — the same seam as the dv/combination defect

| Renderer | Widget types | Metric resolution | Correct across environments? |
|---|---|---|---|
| `AggregatedWidgetRenderer` (`cfg.sql`) | bar, line, pie, scatter, table, bignumber, heatmap | **frozen at Apply time** | **NO** |
| `TimelineRenderer` / `NumericLineRenderer` | timeline, numericline | `resolveMetricExpr` live (Phase 100/103) | yes |

REF-4 widgets are wrong; REF-5 widgets are right. One dashboard, two answers.

## CONFIRMED single-environment — no import involved

Proven live 2026-09-18 in **environment A**, which has never been imported into. `try_again`
(metric id 10) was edited to `AVG(total_amount - tip_amount) * 700` in Datasets. A's own config panel
then generated `... * 700 AS value`; A's own Line Chart continued to render `14.307650071701081`.

So: edit a custom metric's expression, and every bar/line/pie/scatter/table/bignumber/heatmap widget
bound to it keeps rendering the OLD expression until somebody re-opens its config panel and presses
Apply. Import merely makes it *visible*, because import is the only operation that routinely puts a
widget next to a differing definition.

**This predates v1.24 and is not an export/import defect.**

## Why every gate stayed green

Phases 119/120 asserted `metricId` was REMAPPED — it is. No test asserts the widget QUERIES with the
target environment's expression, because no automated test renders a chart against a live Kinetica.
The naive side-by-side comparison PASSES for the same reason: the frozen SQL guarantees B matches A.
**The defect's signature is the comparison succeeding.**

## What is NOT affected

The table name inside the frozen SQL (`FROM demo.nyctaxi`) is safe by construction: import matches
tables by `schema.name`, so a matched table has the same name, and a created table carries the file's
name. The filter-view FROM-swap is applied on top of `cfg.sql` at render, so filtering still works.

## Fix as shipped (2026-09-21, Phase 121 plans 05/06)

**Chosen: option (b), a targeted expression swap at render time. NOT option (a), a shared SQL builder.**

Option (a) — extracting `ChartConfigPanel`'s SQL construction into a lib both the panel and the
renderer call — is the tidier architecture and was rejected for two concrete, code-derived reasons:

1. **The renderer does not have the inputs.** The panel's heatmap branch calls
   `inferDataTypeFromColumn(col, columnTypeMap)` to decide whether a group-by column gets a
   `DATE_TRUNC` bucket, and `columnTypeMap` derives from `selectedTable.columns`.
   `AggregatedWidgetRenderer` is mounted as `<AggregatedWidgetRenderer widget={effectiveWidget} />`
   with **no `tables` prop at all**. Threading it in is possible, but `tables` is empty on first
   render, so a rebuild would emit an UNBUCKETED heatmap query over the 5000-cell limit until the
   table list lands — a new visible defect created by the fix.
2. **A rebuild changes the whole string when the defect is one substring.** Any config saved by an
   older builder version (limit ladders, sort defaults, the `maxBarGroupBySeriesCap` multiplier,
   `customWhere` formatting) would silently start querying something different.

What shipped instead, in `packages/web/src/lib/liveMetricSql.ts`:

- A **depth- and quote-aware** scanner (`scanTopLevel`) replaces the LAST select-list item, which is
  the metric expression aliased `AS value` in all four shapes the panel can emit. Positional, so it
  survives a group-by column literally named `value`. Naive comma-splitting is explicitly forbidden
  and is mutation probe P2 — `ROUND(AVG(amount), 2) AS value` breaks it.
- **Fail-closed.** Any SQL the scanner cannot fully account for is returned BYTE-IDENTICAL, so an
  unparseable query degrades to today's behaviour rather than to a corrupted one.
- **A deleted metric falls back to the frozen `cfg.sql` deliberately** — last-known-good, so a
  working widget is not blanked. The config panel already flags it via `isOrphanedMetric`.
- **An unhydrated store SUSPENDS rather than falling back.** `customMetricsStore` is empty when a
  dashboard opens with no config panel, and falling back during hydration would flash the stale
  number on every load. `isMetricsHydrated` uses entry-presence, not row count, so "never loaded" is
  distinguishable from "deleted". `metricsPending` is a load-bearing dep of the fetch effect: for the
  orphan and unparseable outcomes `sql` is unchanged, so without it the pending -> ready transition
  would never re-fire and the widget would suspend forever (mutation probe M4).
- Resolution happens **before** `fromSwap`, mirroring the CalendarRenderer ordering lock recorded in
  v1.13: DATE_TRUNC SQL can contain FROM tokens a first-FROM regex would clobber.

`packages/server` was not touched. The export format and `dashboardImport.ts` were not touched.
Phases 119 and 120 stay closed.

### Verification

`LIVEMETRIC-XENV-target-expression` in `WidgetRenderer.customMetric.spec.tsx` asserts the EXECUTED
SQL STRING carries the target environment's expression, with a full-string `toBe` — never a
`toContain`, which a half-rewritten query would also pass. 6 P-probes and 6 M-probes each reddened
their named test. Two M-probe FIXTURES needed strengthening (never the probes): M4's pre-seeded the
store so the pending state it targeted never occurred, and M6 proved structurally undiscriminating —
this repo's `fromSwap` and the new swap commute, producing byte-identical output in either order, so
it was replaced with a spy asserting the structural precondition directly.

Operator-confirmed live 2026-09-21, both environments, all four checks PASS — including the
single-environment case that needs no import at all.

### Still open, found alongside and deliberately not fixed here

The hydration effect ends in `loadConfig(tableId).catch(() => {})`, copied byte-for-byte from
`TimelineRenderer.tsx:156-163`. If that fetch REJECTS, the widget suspends in `Loading...`
indefinitely with no error surfaced and no retry. This is a pre-existing project-wide idiom (also in
`BarRenderer`'s own hydration effect), not introduced by this fix; deviating unilaterally inside a
gap-closure plan would have put an unreviewed error-handling design into seven more widget types.
Candidate for a future phase.


## Requirement impact (revised after the environment-A confirmation)

- **DXIM-V124-10** ("Import reports what it did") — the metricConflicts message asserts *"Imported
  widgets now use the EXISTING definition ...; the file's definition was NOT applied."* That sentence
  is FALSE for the seven `AggregatedWidgetRenderer` types. Everything else -10 names literally
  (tables matched/created, metrics matched/created, new dashboard id) is accurate, so a narrow
  reading of -10 survives; the shipped sentence is v1.24's OWN text and is untrue, which is why the
  recommendation is to REOPEN rather than close over it.
- **DXIM-V124-03** ("recreates the dashboard and all its visualizations") — **HOLDS.** Import
  reproduces the source's behaviour faithfully, staleness included; the imported dashboard behaves
  exactly as the source dashboard does in its own environment. The failure is not import-specific.
- **DXIM-V124-01** (export) — **HOLDS.** The file carries `metricId` correctly, `danglingReferences: 0`.
