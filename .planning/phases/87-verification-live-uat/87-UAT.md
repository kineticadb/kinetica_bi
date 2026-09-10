---
status: complete
phase: 87-verification-live-uat
source: milestone v1.17 (phases 85-86 SUMMARYs) + VERIFY-V117-01 walk-through checklist
started: 2026-06-27T00:00:00Z
updated: 2026-06-27T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Automated gates (run by Claude)
expected: web vitest 100% from packages/web; web tsc clean; server tsc clean; theme-guard green; v1.17 is frontend-only (zero packages/server diff)
result: pass
note: "web 122 files / 2772→2809 tests pass; web+server tsc clean; theme-guard 128; `git diff --name-only v1.16..HEAD -- packages/server` EMPTY (frontend-only confirmed). The 9 vitest 'errors' are the pre-existing InfoPopup.spec async unhandled-rejection noise (count fluctuates run-to-run; not test failures) — same baseline as v1.16."

### 2. SI smart-abbreviation format — Column Format editor + propagation (FMT-V117-01/02)
expected: Column Format editor lists "Smart abbreviation (k / M / G / T)"; selecting it shows a decimals control + live preview ("1.2M" at decimals=1); the choice persists per-column and SI-formatted values render across records table, chart tooltips, axis-title/series labels, and map info popups. Invalid/empty input falls back to the raw value.
result: pass

### 3. Per-widget Y-axis number format control — timeline + line (AXIS-V117-01)
expected: The timeline AND numeric-line chart config panels each expose a Y-axis number-format control offering the same options as the column editor (including SI smart-abbreviation).
result: pass

### 4. Hybrid default + override + clear-to-default (AXIS-V117-02)
expected: With no per-widget override, the Y-axis ticks use the bound value column's display-config formatter (and refresh live when that column's config is edited). Setting a per-widget format overrides it live; choosing "Use column default" clears the override and falls back to the column formatter.
result: pass

### 5. Ticks-only isolation (AXIS-V117-03)
expected: The per-widget Y-axis override changes the Y-axis TICK labels only — chart tooltips and on-bar/data labels keep their existing v1.15 column-config behavior (unchanged by the override).
result: pass

### 6. Bar chart value-axis number format + orientation (added during UAT)
expected: The bar chart config panel exposes the same value-axis number-format control; SI abbreviation applies to the value axis (Y when vertical, X when horizontal); switching vertical↔horizontal keeps each axis title on the correct axis (category vs value); the bar chart fills its card with compact axis/tooltip fonts.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

<!-- Operator-found issues during the live walk-through, all fixed in-session with the
     commit that resolved each. Re-walk the affected test to confirm PASS. -->

- truth: "Smart-abbreviation Y-axis labels reclaim plot space instead of a fixed-width axis"
  status: resolved
  reason: "Operator: with SI abbreviation, the Y-axis kept a fixed width, wasting left-edge space."
  severity: minor
  test: 5
  root_cause: "Fixed YAxis width; recharts 2.x has no width='auto'. Added estimateValueAxisWidth() to size the value axis to its formatted tick labels (short SI → narrow, long raw → wide)."
  artifacts:
    - path: "packages/web/src/lib/estimateAxisWidth.ts (new) + TimelineRenderer/NumericLineRenderer"
      issue: "fixed value-axis width"
  fix: "8ccf2c9"

- truth: "Bar charts fill their widget card (no dead space below the bars)"
  status: resolved
  reason: "Operator: large wasted space under the bar charts."
  severity: major
  test: 6
  root_cause: "Aggregated renderers returned <ResponsiveContainer> with a flex height-resolution gap. Fix = absolute-inset fill wrapper + .widget-body min-height:0 (the flexbox default min-height:auto collapsed the percentage-height chart)."
  fix: "630ca84, 179fdec, 55d572f, a12fcbc"

- truth: "Bar chart axis titles + spacing are correct and compact"
  status: resolved
  reason: "Operator: Y-title overlapped ticks; left/bottom dead space; axis titles didn't swap on orientation flip; chrome too big; fonts too large; axis-title gap too wide."
  severity: major
  test: 6
  root_cause: "Axis titles were bound to the physical X/Y axis (didn't follow data on flip); dynamic width didn't reserve title room; margins/legend over-sized for small widgets; tick/title fonts at 12 vs the calendar's 11."
  fix: "23fb1d3, 1dfaf8b, f8dfd49, 46ab296 (titles/spacing); 55d572f (fonts 11)"

- truth: "Chart tooltip uses a compact, tokenized font"
  status: resolved
  reason: "Operator: tooltip font too big; wanted a token size, then smaller."
  severity: cosmetic
  test: 5
  root_cause: "Hardcoded fontSize:13 (off-scale). Tokenized to var(--text-xs) (10px) over a few iterations."
  fix: "193df99, fe0017a, 2e99cc3"

- truth: "Login page uses the right style tokens + compact dashboard density"
  status: resolved
  reason: "Operator: cyan (--accent-2) focus ring instead of brand accent; hardcoded input bg; oversized scale."
  severity: major
  test: 1
  root_cause: "Login inputs used --accent-2 focus + rgba white-tint bg (not --input-bg) and an oversized --text-lg/--space scale. Repointed focus→--accent, bg→--input-bg, login-error→--danger via color-mix; compacted inputs to .ds-field density + CTA to .btn-primary; shrank the card."
  fix: "e8db14a, 3f93119, 9394eb7"

- truth: "Filter chips follow the re-branded --accent (white-label)"
  status: resolved
  reason: "Operator: top filter chips not using CSS tokens."
  severity: major
  test: 1
  root_cause: "Chip fill/border were hardcoded rgba(127,64,237,…) (Aurora violet, theme-guard-ignored) → ignored a re-branded accent. Switched to color-mix(in srgb, var(--accent) 14%/30%, transparent)."
  fix: "918cd48"

- truth: "The Edit-roles popover is opaque (rows don't bleed through)"
  status: resolved
  reason: "Operator: edit-roles panel was transparent."
  severity: major
  test: 1
  root_cause: "Used translucent var(--panel) instead of opaque var(--panel-solid) — same fix as the v1.16 info-popup/modals."
  fix: "e8db14a"

- truth: "Calendar heatmap legend sits close to the grid"
  status: resolved
  reason: "Operator: too much spacing between the legend and the heatmap."
  severity: cosmetic
  test: 1
  root_cause: "Legend strip horizontal padding 8px → 4px."
  fix: "918cd48"
