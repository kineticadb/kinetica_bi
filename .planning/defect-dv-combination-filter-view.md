# DEFECT: dynamic views cannot find their filter view when filter COMBINATIONS are active

**Found:** 2026-09-17, by the operator while preparing the Phase 121 cross-environment checkpoint.
**Severity:** Medium-High — silently disables dynamic views on any dashboard using combined filters.
**Status:** OPEN. Pre-existing; NOT introduced by v1.24. Deliberately not fixed mid-milestone.

## Symptom

A dynamic view bound to a map layer shows `OVER THRESHOLD` and never materializes, even though the
dashboard has active filters that reduce the data to a handful of rows (the operator's Records Table
showed **46 rows** at the time). The map legend reads "Some layers over threshold".

The operator's reasonable reading — "I am well below the threshold" — is correct about their data and
still produces the failure, which is what makes this expensive to diagnose.

## Root cause: a version seam between v1.6 and v1.18

`lib/viewNaming.ts:116-131` — `buildFilterViewName` appends a combination suffix when a
`combinationKey` is supplied:

```js
const base = `_kbi_filt_u${u}_d${dashboardId}_${segment}_s${s}`;
if (args.combinationKey !== undefined && args.combinationKey !== "") {
  return `${base}_c${hashKey8(args.combinationKey)}`;
}
```

Its own doc comment (`index.ts:1256-1259`) states the intent: *"When present, buildFilterViewName
appends `_c<hash8>` to the view name so client-predicted names match actual Kinetica view names.
**When absent → byte-identical to v1.17.**"*

- The **filter / combination materialize** endpoint passes `combinationKey` (`index.ts:1261-1444`,
  5 occurrences) and therefore CREATES `…_c<hash>`.
- The **dynamic-view materialize** endpoint does NOT (`index.ts:1888-1893`, and again at
  `:1990-1994`) and therefore LOOKS FOR the unsuffixed name.

`combinationKey` occurs **exactly 5 times** in `index.ts`, all inside the filter endpoint — the dv
path never references it.

So the existence probe `SELECT COUNT(*) FROM ${expectedFilterViewName}` misses, the catch sets
`filterViewExists = false`, and the code takes the **base-table fallback**
(`index.ts:2046-2069`). For a large source table the base count exceeds `max_records` and it returns
`{ status: "over_threshold", reason: "no_filter" }` — while the real filter view exists and is tiny.

**v1.18 (Phases 88-91) changed filter-view naming; the v1.6 (Phases 32-36) dynamic-view path was
never updated to match.** Both features are individually correct; they stopped agreeing on a name.

## Why it survived this long

With NO filters there is no combination key, no suffix, and the lookup coincidentally matches. The
defect only appears once the operator does the thing dynamic views exist for — filter the data and
aggregate it. Automated coverage evidently never combined a dv with combined filters.

## Second, independent UI defect found alongside it

`OVER THRESHOLD` is shown for two materially different conditions
(`index.ts:2041` vs `:2059`/`:2066`):

| `reason` | meaning | operator's fix |
|---|---|---|
| `exceeds_max_records` | the FILTERED data is genuinely too large | narrow the filter or raise the cap |
| `no_filter` | no filter view found → fell back to the unfiltered BASE table | apply a filter, or tick Unlimited |

The badge shows identical text for both. The server knows which occurred and sends it in `reason`;
the UI discards it. That turns a one-line fix into an open-ended investigation — as it did here.

## Suggested fix

1. Thread `combinationKey` into the dv materialize path so `buildFilterViewName` produces the same
   name on both sides. **Check for other callers of `buildFilterViewName` with the same omission
   before assuming these are the only two** — this bug is precisely a missed call site.
2. Surface `reason` in the badge/tooltip so `no_filter` and `exceeds_max_records` are distinguishable.
3. Add a regression test for the combination it was missing: a dv bound to a layer on a dashboard with
   **two or more combined filters**, asserting it materializes against the filter view rather than
   falling back to base.

## Workaround in the meantime

Tick **"Unlimited (no row cap)"** on the dynamic view. With `filterViewExists` false this takes the
base-table branch unconditionally, so the dv materializes — **but ignores the dashboard's filters**,
since it is aggregating the unfiltered base table. Acceptable to unblock a test; wrong for real use.

## Impact on Phase 121

The operator hit this while building the custom-metric + dynamic-view dashboard the checkpoint
requires. REF-2 (`dynamicViewId`) can still be exercised via the Unlimited workaround, since the
export/import path only needs a bound, materialized dv — it does not care whether the dv was filtered.
