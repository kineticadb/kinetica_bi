# DEFECT: `config.sql` freezes a custom metric's EXPRESSION, so imported widgets compute the source environment's definition

**Found:** 2026-09-18, by the operator during the Phase 121 cross-environment round trip (Step 5/6).
**Severity:** High — silently renders the wrong number, and falsifies the metric-conflict report v1.24 ships.
**Status:** OPEN. Root cause is PRE-EXISTING (predates v1.24); the false report text is v1.24's own.

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

## Suggested fix

1. Preferred: make `AggregatedWidgetRenderer` resolve the metric expression live, exactly as
   `TimelineRenderer`/`NumericLineRenderer` already do — deleting the seam rather than patching it.
   `cfg.sql` becomes a display/fallback artifact, not the query.
2. Cheaper, narrower: regenerate `config.sql` from the remapped `metricId` in import Pass 2. Fixes
   import, leaves the single-environment staleness bug in place.
3. Either way: a regression test binding a bar/line widget to a custom metric whose expression
   DIFFERS between source and target, asserting the executed SQL carries the TARGET's expression.

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
