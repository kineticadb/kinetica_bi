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

## Repro attempt 2026-10-30 (not reproduced)
Scratch dashboard 64 (AI widget + copy of dashboard 55's map: OSM basemap, KineticaWms heatmap on nyctaxi), harness `filter("table",1,"payment_type","eq","Cash")`, CDP script `darkmap.mjs`. 10 tries: theme toggle to dark then filter at 0 ms and 300 ms; load in dark then filter after 200 ms, 1.5 s and 5 s; two rounds of each. Map measured from a screenshot (luminance mean/sd) 8 s later: every try 43/26, the same as the unfiltered dark baseline (42/27); map canvases 2d, no WebGL context; no console errors or warnings. A screenshot shows basemap and WMS drawn. Total now 3 failures, then 18 clean dark runs. Not tried: the topbar filter layout from the 138 run, other basemaps, a slow network. Leave open as low priority; collect console and canvas state if it recurs.
