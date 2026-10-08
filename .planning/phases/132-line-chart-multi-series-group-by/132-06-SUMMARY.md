---
phase: 132-line-chart-multi-series-group-by
plan: 06
subsystem: web-charts
tags: [line-chart, uat, closeout, docs]
requires: [132-03, 132-05]
provides: [phase-132-evidence, shared-docs-updated]
affects: [STATE.md, ROADMAP.md, REQUIREMENTS.md]
key-files:
  modified:
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
requirements-completed: [LINE-V126-01, LINE-V126-02, LINE-V126-03, LINE-V126-04]
completed: 2026-10-08
---

# Phase 132 Plan 06: Gates, live UAT and shared docs Summary

Phase 132 closed: web gates green, operator V1-V9 all PASS against real Kinetica (V9 after UAT fix 79daf34), LINE-V126-01..04 ticked Complete by hand.

## Task 1: Gates and invariants

- PHASE_BASE = d35081ffde662788ccd961213d487b671af2f0a5
- web tsc exit 0; full vitest 203 files / 4433 tests (4434 after the UAT fix); theme-guard 158/158.
- check-classnames: WidgetRenderer.tsx + ColumnFormatTooltip.tsx OK 23 tokens; ChartConfigPanel.tsx only the pre-existing `config-hint-warning`.
- Invariants vs PHASE_BASE: server / numericline / timeline / styles diff empty; BarRenderer slice diff empty; 15 changed web files all within plans 01-05 files_modified. LineRenderer slice counts as in the plan.
- Server untouched, so server gates not required.
- Probe roll-up (01-05): all went red, then were reverted (details in the 01-05 SUMMARYs; 132-01 had one deliberately weak extra no-op-sort probe that stayed green, replaced by the LCD-4 probe; 132-04 L132-3/25/27/28 were green pre-change as regression locks).

## Checkpoint: V1-V9

Genuine operator input 2026-10-08:

| Item | Result |
|---|---|
| V1 | PASS |
| V2 | PASS |
| V3 | PASS. Operator first saw only 2 vendor_id series: dev packages/server/.env has MAX_BAR_GROUP_BY_SERIES=2 (default 12), so the shared series cap (D-04) correctly showed "Showing top 2 of 5 series". After raising the cap all 5 showed. Local config value, not a defect. |
| V4 | PASS: sparse data rendered as gaps with a lone dot (no dip to 0). Series was vendor_id, so the filter was adapted to `NOT (passenger_count IN (2, 3) AND vendor_id = 'NYC') AND NOT (passenger_count IN (1, 3) AND vendor_id = 'YCAB')`. The earlier payment_type-based filter applied (totals dropped) but opened no gaps because the series was vendor_id. A natural gap (VTS has no X=0) was also visible. |
| V5 | PASS (drill: passenger_count = 4 chip only) |
| V6 | PASS (dropped-categories notice with the live Kinetica count; M = 7 distinct passenger_count values, confirmed read-only by the orchestrator) |
| V7 | PASS (tilt/scroll). Not explicitly confirmed: a light+dark pass for V7, and what pickup_datetime X labels looked like (dates vs epoch numbers). |
| V8 | PASS |
| V9 | PASS after UAT fix 79daf34 (below) |

V9 detail: a legacy Line Chart saved with NO Group By (groupByColumn "", sql `SELECT * FROM demo.nyctaxi LIMIT 100`) rendered raw rows (repeating vendor categories) under a misleading "Sum of pickup_latitude" title, and its Y-axis ticks (5 decimals + thousands, e.g. "40,000.00000") were clipped by the fixed 72px axis. Settings correctly demanded Group By column 1 (D-05). Operator decisions: show a "choose an X axis" prompt instead of raw rows; fix the width now.

Fix 79daf34: a line with no X column renders `widget-placeholder` "Choose an X axis column in this chart's settings." (testid line-needs-x). The Y axis is measured from the formatted ticks via estimateValueAxisWidth with a new optional maxPx (line cap 160; bar default 80 unchanged) plus 16 for the title. Tests: L132-36 new; L132-25/22/34 updated. Probes: no placeholder -> L132-34 red; bar 80px cap -> L132-36 red; fixed 72 -> L132-25 + L132-36 red. Operator re-checked: "that works".

## Task 3: Doc edits (by hand, no gsd-tools mutation commands)

- REQUIREMENTS.md: LINE-V126-01 reworded (Group By column 1 required = X axis, ascending X, extra columns = lines); LINE-V126-01..04 ticked and Complete; footer updated.
- ROADMAP.md: plan lines 132-01..06 ticked; Phase 132 checkbox in `## Phases` left unticked for the orchestrator.
- STATE.md: frontmatter (status phase_132_executed_pending_verification, 41/41 plans, stopped_at), Phase 132 outcome paragraph (incl. 79daf34, no-X prompt, Numeric Line remains the numeric/multi-metric option), follow-ups (tooltip float rounding, pickup_datetime/epoch X labels, Line vs Numeric Line merge idea), last phase of v1.26, Next updated.

Verification greps: outcome 1, ticked plans 6, reworded requirement 1, phase checkbox 0.

## Deviations from Plan

UAT fix 79daf34 (committed before this continuation) addressed the V9 findings; no other deviations. Stale "Current focus"/"Current Position" lines in STATE.md were left as-is (outside the plan's edit list).

## Self-Check: PASSED

Files edited and greps above confirmed; 79daf34 exists in git log.
