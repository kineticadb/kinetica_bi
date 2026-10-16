---
created: 2026-10-16T12:00:00.000Z
title: Intermittent blank map in dark mode after an AI filter
area: map
files:
  - packages/web/src/components/charts/MapChartRenderer.tsx
  - packages/web/src/lib/aiSession/aiFilterApplier.ts
  - packages/web/src/lib/aiSession/devHarness.ts
---

## Problem

Found in the Phase 138 operator UAT (138-08-UAT-RESULTS.md, observation 1). In DARK mode, after an AI filter (harness `filter()`, topbar filter layout, AI widget present) the map went blank: basemap and WMS points vanished (map canvas centre pixel alpha 0) and a window resize did not recover it. A hand-click filter in the same state rendered fine. It happened 3 times in a row, then 8 further dark runs (including filtering at varied delays after load) did not reproduce it. Never seen in light mode. Cause unknown.

## Solution

Investigate with `/gsd:debug`. Starting hypotheses: a basemap style swap (dark basemap) racing the WMS source/layer change triggered by the combination-view FROM-swap; the AI outline class (`.widget-card--ai-changed`) or applier timing differing from a click; map host remount. Capture console errors and WebGL context state on the next repro; try repeating the harness filter immediately after a dark-mode theme switch.
