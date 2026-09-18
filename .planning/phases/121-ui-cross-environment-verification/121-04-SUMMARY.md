---
phase: 121-ui-cross-environment-verification
plan: 04
subsystem: verification
tags: [checkpoint, human-verify, cross-environment, dxim, operator-uat]

# Dependency graph
requires:
  - phase: 121-01
    provides: "downloadDashboardExport + importDashboardFile client API"
  - phase: 121-02
    provides: "ImportDashboardModal — file picker + full report presentation"
  - phase: 121-03
    provides: "DashboardsPage per-row Export + AND-gated Import dashboard control"
provides:
  - "The milestone's first genuine cross-environment round trip: two server processes, two SQLite files, a file moved through the browser"
  - "REF-2 (dynamicViewId), REF-4 (scalar metricId) and REF-5 (metrics[].metricId) exercised live for the first time"
  - "A confirmed High-severity defect: config.sql freezes a custom metric's expression (defect-frozen-config-sql-metric-expression.md)"
affects: ["v1.24 closeout"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two environments from inline env vars only (DB_PATH/PORT/APP_ADMIN_USERNAME) — packages/server/.env never edited, nothing to undo"

key-files:
  created:
    - .planning/defect-frozen-config-sql-metric-expression.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

# Metrics
verdict: PASS-WITH-DEFECT
requirements-reopened: [DXIM-V124-10]
---

# Phase 121 Plan 04: Cross-Environment Round Trip — Operator Verdict

## Verdict

**PASS on portability, with one High-severity defect found. DXIM-V124-10 REOPENED.**

The round trip works. A dashboard exported from one running server was imported into a genuinely
different server with its own SQLite database, entirely through the app UI, three times, and every
widget renders the same data as the source with every interaction intact.

What failed is not portability but a **claim the import report makes about itself**. See
§"Defect found" below.

## The two environments

| | Environment A (source) | Environment B (target) |
|---|---|---|
| SPA | `http://localhost:5173` | `http://localhost:5174` (separate browser profile) |
| Server | `:4000` | `:4001` |
| Database | `packages/server/data/kinetica.db` | `packages/server/data/env-b.db` |
| Launch | `npm run dev` | `DB_PATH=./data/env-b.db PORT=4001 APP_ADMIN_USERNAME=admin npm run dev` |

`packages/server/.env` was never edited. Both SPAs ran under Vite, so the blob-download path was
exercised and the nginx same-origin path was NOT. Both servers share one `KINETICA_URL`, so this is a
test of **metadata portability, not data-source portability**. Stated here so it is not written up as
more than it is.

## Source dashboard and export file

Environment A dashboard id **4, "Test Dashboard"**, extended during this checkpoint with a custom
metric and a dynamic view — Phase 119 had recorded `customMetrics: 0` / `dynamicViews: 0` for it, and
closing that gap was this phase's job.

Export file `dashboard-4-test-dashboard (2).json`, 20,112 bytes, `schemaVersion` present:

| Field | Count |
|---|---|
| widgets | 9 |
| layers | 2 |
| tables | 3 |
| **customMetrics** | **2** (`total_wo_tip`, `try_again`) |
| **dynamicViews** | **1** (`Avg NYC`, `max_records: 0`) |
| dashboardTableIds | 3 |
| danglingReferences | **0** |

Both REF-bearing counts are non-zero, so this qualifies as a FULL pass on the E4 criterion rather
than the partial pass this milestone had twice settled for. The dynamic view carries
`max_records: 0` — the UNLIMITED sentinel whose rejection was fixed in `21e8690` earlier the same
day; this exact file would have been refused at the import boundary before that fix.

## Import reports (pasted verbatim)

**Import 1** (empty-ish B, before the expression edit) — created dashboard id 1, 9 widgets, 2 layers,
1 dynamic view; tables and metrics CREATED; no conflicts.

**Import 2** (after editing B's `try_again` expression to force the conflict path) — created
dashboard id **2**, Widgets 9, Layers 2, Dynamic views 1; `demo.nyctaxi`, `ki_home.us_states`,
`demo.track` all **matched**; `total_wo_tip` and `try_again` both **matched**; and under
**METRIC CONFLICTS — REVIEW BEFORE TRUSTING THESE WIDGETS**:

> Custom metric "try_again" on demo.nyctaxi already exists in this environment with a DIFFERENT
> expression. Imported widgets now use the EXISTING definition (AVG(total_amount - tip_amount) *
> 1.111111); the file's definition (AVG(total_amount - tip_amount)) was NOT applied.

**Import 3** (light-theme legibility check) — created dashboard id **3**, identical shape, same
conflict message (by then reading `* 50.111111`), rendered legibly on white.

`MetricConflict` had never been produced outside a fixture before this. No duplicate metric was
created by either re-import — environment B still holds exactly two `custom_metrics` rows.

## Comparison table (all 11 rows)

| # | Check | Result |
|---|---|---|
| 1 | Widget inventory | **PASS** — 9 widgets, same types, titles, positions |
| 2 | Custom-metric widget (REF-4) | **PASS** — Bar Chart `total_wo_tip` reads `14.307650071701081` in BOTH, identical to 17 significant digits, same five vendors in the same order |
| 3 | Timeline / Numeric Line (REF-5) | **PASS** — line charts match exactly |
| 4 | Dynamic-view-bound widget (REF-2) | **PASS** — the dv-bound Bar Chart draws and matches |
| 5 | Table / Records widget | **PASS** — covered by the side-by-side |
| 6 | Map widget (REF-6) | **PASS** — same layers, same order; the dv-bound layer draws; toggling on/off works in B |
| 7 | Standalone Legend (REF-3) | **NOT EXERCISED** — this dashboard carries no standalone Legend widget. Live-verified in Phase 119; not re-verified here |
| 8 | Drill-down | **PASS** — same behaviour in both |
| 9 | Filters | **PASS** — covered by the side-by-side |
| 10 | Radio Group actions (REF-8) | **PASS** |
| 11 | Empty/absent surprises | **PASS** — no blank widget, no "(deleted metric)", no error state. Confirmed structurally too: no imported widget config is `{}` |

## Reference-kind accounting (119-04-SUMMARY.md's format)

| REF | Kind | Before this checkpoint | After |
|---|---|---|---|
| REF-1 | `tableId` | live (one environment) | **live ACROSS environments** |
| REF-2 | `dynamicViewId` | **fixture-only** | **live ACROSS environments** |
| REF-3 | `sourceMapWidgetId` | live (one environment) | unchanged — not in this dashboard |
| REF-4 | scalar `metricId` | **fixture-only** | **live ACROSS environments** (id remap correct; see defect for what the widget then does with it) |
| REF-5 | `metrics[].metricId` | **fixture-only** | **live ACROSS environments** |
| REF-6 | `includedLayerIds` | live (one environment) | **live ACROSS environments** |
| REF-8 | `options[].actions[].target` | live (one environment) | **live ACROSS environments** |
| REF-9 | `spatialTargets[].tableId` | added 2026-09-17, fixture-only | **live ACROSS environments** — remapped to `[2, 4]` in B |
| — | `dashboard_tables` union edge | live | **live ACROSS environments** — 3 ids |

The three kinds this phase existed to de-risk are no longer fixture-only.

## Defect found

`.planning/defect-frozen-config-sql-metric-expression.md` — **High severity, root cause PRE-EXISTING.**

`ChartConfigPanel` bakes a custom metric's expression into `widget.config.sql` at Apply time.
`AggregatedWidgetRenderer` (`WidgetRenderer.tsx:403`) renders from that frozen text and never
resolves the metric —
`grep -c resolveMetricExpr packages/web/src/components/charts/WidgetRenderer.tsx` → **0**.
`dashboardImport.ts` never rewrites `config.sql`. All nine reference kinds are **id**-valued; the
frozen SQL is a **tenth, TEXT-valued reference** no sweep considered, because it is a string.

Affects Bar, Line, Pie, Scatter, Table, Big Number, Heatmap. `TimelineRenderer` and
`NumericLineRenderer` resolve live (Phases 100/103) and are correct — one dashboard, two answers.

**Confirmed pre-existing, no import involved:** in environment A alone — never imported into —
`try_again` was edited to `AVG(total_amount - tip_amount) * 700`. A's own config panel then generated
`... * 700 AS value`; A's own Line Chart went on rendering `14.307650071701081`.

The consequence for this milestone: the conflict message's sentence *"Imported widgets now use the
EXISTING definition; the file's definition was NOT applied"* is **false** for those seven chart
types. They render the file's definition.

**The comparison PASSING is the defect's signature.** The frozen SQL guarantees B matches A. Had
environment B's `try_again` been the definition B's users actually wanted, the imported widget would
have silently shown A's numbers forever.

## Requirement outcome

| Requirement | Outcome | Reasoning |
|---|---|---|
| DXIM-V124-01 (export) | **HOLDS** | File carries `metricId` correctly, `danglingReferences: 0` |
| DXIM-V124-03 (recreates visualizations) | **HOLDS** | Import reproduces the source faithfully, staleness included; the imported dashboard behaves exactly as the source does in its own environment. The failure is not import-specific |
| DXIM-V124-10 (import reports what it did) | **REOPENED** | Every item -10 literally names is accurate, so a narrow reading survives. Operator decision 2026-09-18: reopen rather than ship a known-false user-facing sentence, since the conflict message is precisely the part of -10 that had never been live-checked |

## Defects surfaced by this checkpoint overall

Four, none findable by any automated gate:

1. `6c6de97` — REF-9 `spatialTargets[].tableId` never remapped (FIXED)
2. `21e8690` — `max_records: 0` rejected at import (FIXED; reopened + re-closed DXIM-V124-11)
3. `4a8c117` — custom metrics loaded for the wrong table (FIXED)
4. frozen `config.sql` metric expression (OPEN — reopens DXIM-V124-10)

That is the argument for the checkpoint existing at all, recorded as such.

## Gate numbers at verdict time

- `packages/web`: `npx tsc --noEmit` clean; `npx vitest run` **179 files / 4069 tests / 0 failed**;
  theme-guard **152/152**
- `packages/server`: `npx tsc --noEmit` clean
- E1 `packages/server/data/env-b.db` exists · E2 two `tsx watch` processes concurrent · E6
  `git diff --numstat HEAD -- packages/server packages/web` **empty** — this plan changed no source

## Known limitations, not smoothed over

1. Both SPAs ran under Vite — the nginx same-origin deployment path is still unverified.
2. One host, one `KINETICA_URL` — metadata portability only.
3. Row 7 (standalone Legend, REF-3) was not exercised; the dashboard has no Legend widget.
4. Test data left dirty on purpose: A's `try_again` is `AVG(total_amount - tip_amount) * 700`, B's is
   `* 50.111111`, and B holds three imported copies of "Test Dashboard" (ids 1, 2, 3).

## Next

The frozen-`config.sql` fix is NOT in export/import. The recommended fix is to make
`AggregatedWidgetRenderer` resolve the metric expression live, as `TimelineRenderer` and
`NumericLineRenderer` already do — closing the seam and fixing the single-environment bug at the same
time. Regenerating `config.sql` during import Pass 2 would fix only the import symptom and leave
environment A broken. Route to `/gsd:plan-phase 121 --gaps`.
