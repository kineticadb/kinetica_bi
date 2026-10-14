# 136-12 Operator UAT — results (automated run, 2026-10-14)

**How:** Claude drove the operator's own signed-in Chrome (separate profile, CDP on 127.0.0.1:9333, playwright-core in the session scratchpad). The operator signed in; Claude never handled credentials or cookies. Only `window.__kbiAiHarness` and same-origin fetches with the browser's own session were used. No AI provider was called.
**Dashboard:** 12 "Bar Chart/Heatmap Dashboard" — map 117, bar 118 (SUM tip_amount by vendor_id, green), saved heatmap layer 23 (demo.nyctaxi, viridis, no blur). Table 1 `demo.nyctaxi`.
**Screenshots:** session scratchpad `uat136/shots/00..18-*.png` (not committed).

## Task 1 — WMS VAL_ATTR tile check
| Tile | Status | Type | Heat visible |
|---|---|---|---|
| weighted (`VAL_ATTR=fare_amount`, plasma, blur 8), NYC bbox | 200 | image/png (51,155 B, 18.3 % painted) | yes |
| control (same URL, `VAL_ATTR` removed), NYC bbox | 200 | image/png (34,498 B, 11.0 % painted) | yes |

Also at the live world view: 200 image/png both (591 vs 703 painted px). Kinetica accepts `VAL_ATTR` and it visibly changes the render. **PASS.**

**Blur:** saved-style tile with no `BLUR_RADIUS` vs the same with `BLUR_RADIUS=5` are **byte-identical (39,515 B)** — Kinetica's default blur is 5, so the AI default (5) matches saved heatmaps. No visible difference. **Resolved, no action.**

## Task 2 — visual / layout / undo
| Step | Result |
|---|---|
| 4.1 AI heatmap add | applied (temp id -1), tiles request plasma/8/fare_amount |
| 4.1 session eye (`setLayerVisible(-1,false/true)`) | hidden → no AI tile requested; shown → AI tile re-requested. PASS |
| 4.1 legend row "AI heat" + legend eye | **NOT TESTABLE here**: map 117 has the legend panel disabled and the AI may not enable it (not allow-listed); editing locked. See note 1 |
| 4.1 `editHeatmap(-1,{inferno,16,0.6})` | applied; tile inferno/16/fare_amount. Opacity is OL layer opacity (not a WMS param) — not measured, visually darker |
| 4.1 `editHeatmap(23,{magma})` (saved layer) | applied; tile magma. PASS (viridis was already its colour, so magma used) |
| 4.2 `editChart(118,{max,teal})` | applied; values ~110 vs 250k, teal bars, "AI edited" pill white on rgb(127,64,237) — readable dark AND light. PASS |
| 4.3 add bignumber / bar / records | applied; widths 9 / 18 / 36 cols, below saved content, **0 overlaps**, "AI added" pills. PASS |
| 4.3 `setLayout` swap 117↔118 | applied; swapped, AI widgets pushed down, 0 overlaps. PASS |
| 4.3b map + heatmap on a no-map dashboard | every dashboard has a map, so simulated on 12: session-removed map 117, `addChart("map")` + `addHeatmap` → both applied, map 28 cols wide below the bar (18-col gap too narrow — correct per D-08), 0 overlaps; light basemap (light) / dark basemap (dark); heat visible, clearly so when zoomed to NYC. PASS |
| 4.4 removal | no approval → skipped `needs_confirmation`, nothing removed; after `approveRemoval()` → removed; second saved removal → no ask; after `discard()` → `removalApproved=false`, asks again. PASS |
| 4.5 undo | `revert(-1)` → exactly the saved dashboard (green SUM bar, original layout, viridis); `forward(8)` → all changes back incl. swap and layer styles; `discard()` + reload → API shows widgets 117/118 unchanged (SUM, green, original layout) and layer 23 viridis. Nothing persisted. PASS |

## Notes / issues found
1. **Legend not exercised.** Map 117's legend panel is off. The "AI heat" legend row and legend eye need a map with the legend enabled (operator check, or enable on a test dashboard).
2. **AI-added KPI shows the label "value".** `addChart("bignumber","KPI",1,{metric:"fare_amount",aggregation:"sum"})` renders "value" above 5,921,923. Cosmetic; a better default label (e.g. "Sum of fare_amount") belongs with the 137 widget work or backlog.
3. **Layer-only edits do not badge the map.** After `editHeatmap` on the AI layer and saved layer 23, map 117 showed no "AI edited" pill; it only got one after `setLayout` moved it. AIWID-V20-06 says widgets AND layers the AI changed are highlighted — Phase 137 (D-18 fade outline / pills) must cover layer changes on the host map.
4. **UAT-steps bugs fixed:** the browser's resource-timing buffer stops at 250 entries (map tiles fill it), so Step 1's API-base detection and Step 3's tile lookup could fail; Step 1 now uses the known API base and `?dashboard=`, Step 2 enlarges/clears the buffer, Step 3 filters to the map's own XHR tiles.
