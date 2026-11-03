# 138-08 Operator UAT — results (automated run, 2026-10-16)

**How:** Claude drove the operator's signed-in Chrome (separate profile, CDP 127.0.0.1:9333, playwright-core in the session scratchpad). The operator signed in; Claude never handled credentials. Only `window.__kbiAiHarness`, the dev-served `filterStore` module (same instance URL the app loaded) and same-origin fetches with the browser session were used. **No AI provider request was made** (step 9 skipped).
**Dashboard:** 12 — map 117 (heatmap layer 23) + bar 118, table 1 `demo.nyctaxi`; dashboard 4 for the dynamic view (dv 6 "Avg NYC").
**Screenshots:** session scratchpad (not committed).

| Step | Light | Dark | Result |
|---|---|---|---|
| 1 SC4 + SC1 narrow like a click | ✓ | ✓ | PASS (dark: observation 1) — `vendor_id='VTS'`: bar narrows (~$123,918 tips), new WMS tile URLs use `LAYERS=_kbi_filt_uadmin_d12_t1_s2044b645_cc30e6559` (combination view), map points thin; clear returns `LAYERS=demo.nyctaxi`. Hand-clicking the VTS bar produces the IDENTICAL combination view name (click-equivalence against real Kinetica). **SC4 map tiles narrow: PASS** |
| 2 chip tag, outline, no pill (D-14/D-15) | ✓ | ✓ | PASS — top-bar chip `vendor_id = 'VTS'` + AI tag; panel chip "AI" + "from AI assistant"; map and bar get `.widget-card--ai-changed` (seen ~1 s, fades); no "AI edited" pill. Hand-clicking CMT after AI `in ('VTS','CMT')` replaced it with `vendor_id = 'CMT'` "from Tips By Vendor", no AI tag |
| 3 no bar / lock / leave dialog (D-09) | ✓ | ✓ | PASS — filter-only: no Unsaved bar, no disabled buttons, `hasUnsavedAiChanges` false, Back with no dialog. Mixed turn: "1 added · 0 edited · 0 removed", editing locked, Keep disabled (until 141), AI records narrowed (3 widgets) |
| 4 per-column Revert/Forward (D-10/D-11/SC2) | ✓ | — | PASS — manual `vendor_id=VTS` + AI `payment_type='Credit'`: revert(-1) removes only the AI filter, forward(0) restores; after hand-removing the manual chip, revert does not resurrect it; same-column: manual VTS, AI CMT, revert restores VTS "from Tips By Vendor" |
| 5 Discard (D-12) | ✓ | — | PASS — confirm "Discard all AI changes?…"; filters back to manual VTS (no AI tag), AI records widget and bar gone |
| 6 dynamic view (D-03) | ✓ | ✓ | PASS — `filter("dynamicView",6,"avg_passenger_count","between",["1","2"])`: chip under AVG NYC with AI tag; dv bar (103) and map outlined; label changed …474559 → …037093375; `clearFilter("dynamicView",6)` restores |
| 7 clear all (D-07) | ✓ | covered by 8/8b (same `.ai-chat-note`) | PASS — two manual filters, `clear_filter` clears both, note "Cleared all filters (2 widgets)."; revert(-1) restores both. NOT checked: drawn-shape survival (no shape drawn) |
| 8 zero rows + notes (D-16/D-17) | ✓ | ✓ | PASS — `zzz_no_such_value`: bar "No data returned"; notes "Filtered nyctaxi to payment_type = 'zzz_no_such_value' (2 widgets)." and "The payment_type filter on nyctaxi matched no rows." within ~1 s; "Clear this filter" removes the filter and disappears (issue 2). `between` and `in` chips read like the panel's own chips |
| 8b scoped widget (D-18) | ✓ | ✓ | PASS — bar 118 allow-list [117]: only the map is outlined, bar not narrowed ("0 of 1 filters" badge); notes "Filtered nyctaxi to vendor_id = 'VTS' (1 widget)." and "1 widget with its own filter selection was not filtered." |
| 9 live ask | | | skipped (no provider request) |

## Issues / observations (operator: track 1 and 2; 3 is a note)
1. **Intermittent blank map in DARK mode after an AI filter** (harness `filter()`, topbar layout, AI widget present): basemap and WMS points vanished (canvas centre pixel alpha 0), window resize did not recover; hand-click in the same state rendered fine. Happened 3 times in a row, then 8 further dark runs (incl. varied delays after load) did not reproduce. Never seen in light. Cause unknown -> `/gsd:debug`. Todo: `todos/pending/2026-10-16-ai-filter-dark-map-blank-intermittent.md`.
2. **"Clear this filter" is visually identical to the follow-up suggestion buttons** rendered right below it in AiChat (both `ghost-sm`); easy to miss. Todo: `todos/pending/2026-10-16-ai-filter-clear-button-styling.md`.
3. Harness-only: `filter()`/`clearFilter()` turns render an empty answer bubble (harness sends no answer text). Not user-facing.

## Cleanup (restored and verified)
Dashboard 12 `filter_display_mode` set to "panel" for steps 2-8b, restored to "topbar"; bar 118 `config.filterSelection` allow-list [117] for 8b, restored to the exact original config (no `filterSelection` key); temporary AI widget 121 created for chat notes, deleted (204). Dashboard 12 = widgets 117, 118. App theme back to light.

Not eyeballed: drawn-shape survival on clear-all; live model adherence (step 9); dark mode for steps 4 and 5 (light only).
