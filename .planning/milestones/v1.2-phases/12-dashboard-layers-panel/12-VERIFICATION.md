---
phase: 12-dashboard-layers-panel
verified_at: "2026-05-06"
overall_status: tech_debt
criteria_status:
  criterion_1: PASS
  criterion_2: PASS
  criterion_3: SUPERSEDED
  criterion_4: PASS
  criterion_5: PASS
  criterion_6: PASS
gaps:
  - id: GAP-12-C3
    criterion: 3
    status: superseded
    superseded_at: "2026-05-06"
    superseded_reason: "Filtering will be reworked outside WMS QUERY — the QUERY-based filter param approach is being abandoned. 12-07 spike scaffolding reverted in commit 8e60d2c. Replacement approach to be scoped in a future phase."
    title: "Per-layer WMS filter param does not narrow rendered tiles"
    description: >
      WMS GetMap request fires with &QUERY=<sql> when a drill-down filter is active,
      but Kinetica renders the same tiles with or without the QUERY param. The renderer
      wiring is correct (updateParams fires, _v cache-busts), but the filter has no
      observable effect on tile output. The QUERY param name or its value format is
      likely wrong for the deployed Kinetica version. Phase 11 spike-notes explicitly
      flagged QUERY as "accepted without error but never validated for tile narrowing".
    affected_files:
      - kinetica_bi/src/lib/wmsUrlBuilder.ts
      - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    missing:
      - "Kinetica WMS spike to confirm the correct server-side filter parameter name (QUERY vs CQL_FILTER vs FILTER vs a Kinetica-proprietary param)"
      - "Confirm the correct SQL value format: bare WHERE-clause body vs. full SELECT vs. URL-encoded vs. base64"
      - "End-to-end test: apply a drill-down on a low-cardinality column of a Kinetica table, compare tile PNG with and without the param, confirm pixel difference"
    recommended_action: >
      Run /gsd:plan-phase 12 --gaps to generate 12-07-PLAN.md for C3 gap closure.
      The plan should begin with a Kinetica WMS spike (GetCapabilities + GetMap probe
      with known QUERY/CQL_FILTER/FILTER variants), then update wmsUrlBuilder.ts +
      MapChartRenderer.tsx and re-verify C3.
---

# Phase 12 — End-to-End Verification

**Verification date:** 2026-05-06
**Verifier:** RPereira@kinetica.com

---

## Verdict

**5/6 criteria GREEN — Criterion 3 deferred as a documented gap (filter param name / value format unknown for deployed Kinetica version). Routed to 12-07 gap-closure cycle.**

---

## Walkthrough Log

User walked all 6 criteria against the running app (`npm run dev` frontend on :5173, `cd server && npm run dev` backend on :4000). C1, C2, C4, C5, and C6 passed after follow-up fixes applied during the session (see "Follow-up Fixes" section). C3 fired the QUERY param correctly (confirmed in Network tab) but produced no visible change in tile output — user explicitly deferred this to a gap-closure cycle.

---

## Per-Criterion Status

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Layer CRUD via modal | PASS | Passed after follow-up commits `478d8d3` (POINTCOLORS / POINTSIZES param names) and `d89769d` (race fix — skip layer add until tables prop resolves). Full CRUD walkthrough confirmed: create, auto-save, drag-reorder, duplicate, delete-confirm, missing-table badge, opacity slider PATCH. |
| 2 | Multi-layer rendering | PASS | Passed after follow-up commit `d7b84ab` (positive zIndex offset keeps WMS image layers above opaque OSM basemap). Layer-inclusion picker checkboxes toggle individual layers without remounting the OL Map instance; zoom/pan retained. |
| 3 | Per-layer filter subscription (M-02 lock) | RED | WMS request fires with `&QUERY=<sql>` (confirmed in Network tab, _v cache-bust present). Kinetica renders identical tiles with and without the param — no observable narrowing. Root cause unknown: QUERY param name may be wrong for the deployed version, or the value format (bare clause body vs. full SELECT) may be incorrect. Renderer wiring is confirmed correct. Deferred to gap-closure cycle. |
| 4 | Hard cutover for Phase 11 widgets | PASS | Manually crafted a Phase 11-shape widget (`spatialMode` set, no `includedLayerIds`). Dashboard reload shows the `.widget-map-reconfigure` overlay with verbatim copy. `accent-2` blue tint styling confirmed. |
| 5 | Missing-table state + dead-code | PASS | Missing-table badge renders in layer row. WMS tiles do not fire for that layer. `bboxHelper.ts` absent from src. `grep fetchBbox\|bboxHelper kinetica_bi/src` returns 0 matches. Zoom-to-data button absent from map widgets. |
| 6 | Empty-state overlay | PASS | After deleting all layers from dashboard, map widget shows `.widget-map-empty` overlay with verbatim copy "No layers — open the Layers panel to add some". Recreating a layer removes the overlay and tiles resume. Per-widget include-all-unchecked path also triggers the overlay. |

---

## Follow-up Fixes Shipped During Verification

The following commits were applied during this verification session to address bugs encountered in the walkthrough. They are not plan deviations — they are the expected gap-closure pattern for a manual verification phase.

| Commit | Root-cause summary |
|--------|--------------------|
| `dfb12ca` | LAYERS param was never injected: `layer.table_id` (integer FK) was passed directly to Kinetica WMS instead of being resolved to the `schema.name` string that Kinetica requires in the LAYERS param. Fixed by resolving `table_id → associatedTables.find(t => t.id === layer.table_id)?.name` in MapChartRenderer. |
| `d89769d` | Race condition: layer was added to the OL Map before the `associatedTables` prop resolved from the async dashboard load. The layer config had no table reference, so the WMS URL contained no LAYERS value. Fixed by guarding the layer-add effect with `tables.length > 0`. |
| `be5acc6` | OL Map effect could not attach because the canvas host `div` was conditionally not mounted during the reconfigure-overlay branch. Fixed by always mounting the canvas `div` and rendering both the OL container and the overlay simultaneously (overlay sits above via CSS z-index). |
| `478d8d3` | Incorrect Kinetica WMS param names: `POINTCOLOR` (should be `POINTCOLORS`), `POINTSIZE` (should be `POINTSIZES`). Also, drag-reorder was not reflected in OL layer z-index; fixed by assigning positive z-index offsets proportional to `layer.position`. |
| `d7b84ab` | WMS image layers rendered behind the opaque OSM basemap. Fixed by starting z-index at a positive offset (e.g., `position + 1`) so ImageWMS layers always sit above the basemap's z-index of 0. |

---

## Open Gap: C3 — Per-layer WMS filter param does not narrow tiles

> **SUPERSEDED 2026-05-06** — Filtering will be reworked outside WMS QUERY; the QUERY-based approach is abandoned. 12-07 spike scaffolding reverted in commit `8e60d2c`. Replacement approach to be scoped in a future phase.

### ID: GAP-12-C3

### Observable behaviour

When a drill-down filter is applied to a chart using table T, the per-layer filter subscription in `MapChartRenderer` correctly calls `source.updateParams({ QUERY: whereClause, _v: filterVersion })`. The Network tab confirms a new GetMap request fires with the `QUERY` param appended and a fresh `_v` cache-buster. However, the Kinetica WMS endpoint renders tiles that appear visually identical to the unfiltered result — no points or polygons are removed from the tile output.

### What is confirmed correct

- M-02 lock is in place: `updateParams()` is called per layer on `filterVersion` change; the OL Map instance is never disposed.
- Cache-busting works: `_v=<filterVersion>` increments and browser cache does not serve stale tiles.
- Renderer wiring is confirmed by tracing the effect in `MapChartRenderer.tsx`.
- Phase 11 spike-notes (`11-SPIKE-NOTES.md`) explicitly stated: "QUERY filter param accepted without error; tile output identical with/without filter in all probe cases (dense demo.nyctaxi dataset may mask effect)". This gap was carried forward from Phase 11 without resolution.

### Suspected root causes

1. **Wrong param name** — Kinetica WMS may require `CQL_FILTER`, `FILTER`, `WHERE`, or a proprietary Kinetica-specific parameter rather than `QUERY`.
2. **Wrong value format** — The value sent is a bare SQL WHERE-clause body (e.g., `vendor_id = 'CMT'`). Kinetica may require a different format: full SELECT statement, URL-encoded expression, base64-encoded expression, or Kinetica-proprietary filter DSL.
3. **Dense dataset masking** — Phase 11 spike was run against `demo.nyctaxi` (millions of rows at NYC scale). A low-cardinality column filter on that density may produce tiles indistinguishable from unfiltered at viewport zoom. This is a methodology issue for validation, not necessarily a code bug.

### Affected files

- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — constructs the QUERY param value; param name is hardcoded as `"QUERY"`
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — calls `source.updateParams()` with the built params

### Missing items (for gap-closure planner)

1. Kinetica WMS spike: issue GetMap requests with `QUERY`, `CQL_FILTER`, `FILTER`, and `WHERE` params against a known low-cardinality table. Compare tile PNG checksums with/without the param. Identify which param name produces a visibly different result.
2. Confirm accepted value format for whichever param name works: bare clause body, full SELECT, URL-encoded, base64.
3. Update `wmsUrlBuilder.ts` param name constant and value builder.
4. Add a unit test in `wmsUrlBuilder.spec.ts` asserting the corrected param name is emitted.
5. Re-run C3 walkthrough against a low-cardinality column (e.g., a status or category field, not a high-density continuous dataset).

---

## Recommended Next Step

**GAP-12-C3 is SUPERSEDED.** The WMS-QUERY filter-param approach is being abandoned in favor of a different filtering mechanism (to be scoped). No action against `12-07-PLAN.md` is required — that plan is also marked superseded.

---

## Tech Debt (Informational — v1.3 Candidates)

- **Filter on high-density tables is visually unverifiable**: Even with a correct filter param, millions-of-rows tables (e.g., demo.nyctaxi at city scale) may not produce a perceptible tile difference at dashboard zoom levels. A dedicated test table with low cardinality and spatially spread data should be used for all future WMS filter verification.
- **Phase 11 Criterion 3 also deferred**: The identical filter-tile gap existed in Phase 11 verification (11-VERIFICATION.md, Criterion 3 DEFERRED) and was not closed before Phase 12 began. Both phases share the same underlying bug.
- **No automated tile-output test**: The OL rendering layer has no pixel-level integration test. A future investment in a headless OL+Kinetica test fixture would catch WMS param errors before UAT.
