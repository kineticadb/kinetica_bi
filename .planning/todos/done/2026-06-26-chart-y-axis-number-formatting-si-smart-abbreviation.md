---
created: 2026-06-26T12:47:14.915Z
title: Chart Y-axis number formatting + SI smart abbreviation
area: ui
files:
  - packages/web/src/lib/ (v1.15 number-format / column-display formatter lib — d3-format based)
  - packages/web/src/components/ (Column Format editor UI)
  - packages/web/src/components/charts/TimelineRenderer.tsx (Y-axis ticks)
  - packages/web/src/components/charts/ (line chart renderer + timeline/line config panels)
---

## Problem

Timeline and line charts have no way to format their Y-axis numbers, and the existing
client-side column number-format options (added in v1.15 — d3-format based) have no
"smart abbreviation" choice. Large values render in full (e.g. 1,234,567) on chart axes
and in formatted columns, which is hard to read in a dense dashboard.

This is a NEW feature, OUT OF SCOPE for v1.16 (White-Label Theming). Captured during the
v1.16 Phase-84 UAT; plan as its own phase/milestone AFTER v1.16 verification ships.

## Solution

Two parts:

1. **Smart-abbreviation number format (formatter lib + Column Format editor UI):**
   Add a "smart abbreviation" option to the existing number-format choices.
   **Operator decision (2026-06-26): use SI prefixes via d3-format `~s` → k / M / G / T**
   (e.g. 1.2k, 1.2M, 1.2G, 1.2T) — NOT financial K/M/B/T. `d3-format` is already a web dep.
   Configurable decimals (reuse the existing decimals control). Surface it in the Column
   Format editor UI alongside the current number options.

2. **Y-axis number-format option on timeline + line charts:**
   Add a Y-axis number-format config field to the timeline + line chart config panels,
   reusing the column number-format options (incl. the new SI abbreviation). Apply the
   resolved formatter to the Y-axis tick labels in `TimelineRenderer` and the line chart
   renderer (recharts tickFormatter / axis tick formatter).

**Scope:** formatter lib, Column Format editor UI, timeline+line config panels, the two
renderers, + tests (formatter unit tests for `~s` output; renderer/config tests).
Reuse the v1.15 column-display-config formatter rather than duplicating logic.

When planning: confirm whether the Y-axis format is a per-widget config (likely) vs derived
from a column's display config; and whether the abbreviation applies to tooltips/data-labels
too (probably yes, for consistency).
