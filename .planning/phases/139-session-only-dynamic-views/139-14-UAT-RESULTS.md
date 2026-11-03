# 139-14 Operator UAT — results (automated run, 2026-10-20)

**How:** Claude drove the operator's signed-in Chrome (separate profile, CDP 127.0.0.1:9333, playwright-core in the session scratchpad) at the operator's request. The operator signed in (twice, including after the logout step); Claude never handled credentials and never read `packages/server/.env`. Only `window.__kbiAiHarness` and same-origin fetches with the browser session were used. **No AI provider request was made** (step 12 skipped).
**Kinetica version (step 0, D-26):** 7.2.3.12 (`version.gpudb_core_version = 7.2.3.12.20260410191247`, build Apr 10 2026, compute engine TBB = CPU build). 7.2.x, so the 7.2-documented research functions apply.
**Environment:** dev app (vite :5173, API :4000, restarted once for 7e), signed in as admin (password mode).
**Dashboard:** 12 "Bar Chart/Heatmap Dashboard" — map 117 (heatmap layer 23), bar 118 "Tips By Vendor", table 1 `demo.nyctaxi`.
**Screenshots:** session scratchpad (not committed).

| Step | Light | Dark | Result |
|---|---|---|---|
| 0 Kinetica version (D-26) | n/a | n/a | 7.2.3.12 (see above) |
| 1 median/percentile in GROUP BY inside an MV (U1-U3) | n/a | ✓ (bar) | PASS — "Fares by vendor" (group by vendor_id; count, APPROX median, APPROX p90, avg, min, max of fare_amount) built UNFILTERED (D-02, `aggregated:true`, 5 output rows). Medians 7.7-9.5, between min and max and below avg (right-skewed); p90 (18.38-24.48) > median for every vendor; no NULL or empty groups (vendor_id fully populated). Types: median/p90/avg double, min/max float, count long. Bar rendered matching values |
| 2 time buckets (U4) | n/a | n/a | PASS — DATE_TRUNC hour/week/day on `pickup_datetime` (timestamp; no DATE column on this table): bucket column type `datetime`; hour values on the hour, day at midnight; **week starts SUNDAY** (first bucket 2008-12-28 = Sunday). All built unfiltered |
| 3 row view + D-05 note | ✓ | ✓ | PASS — "Raw trips" -> `over_threshold` / `no_filter`; records widget shows "No filter applied — load the full table, or apply a filter to narrow it." + Load full table; muted chat note `"Raw trips" is waiting for a filter: demo.nyctaxi has too many rows to build it unfiltered (limit 100,000).` + follow-up "Filter demo.nyctaxi to the last 30 days"; legible in both. Copy note: that suggestion would return 0 rows on this 2009 dataset (date-agnostic) |
| 4 SC2 real tiles, both map sites | ✓ | ✓ | PASS both sites. Base filter vendor_id=DDS -> Raw trips materialized; `add_layer` bound to -102. **Site 1 (initial render):** first WMS GetMap `LAYERS=_kbi_ai_uadmin_..._102`, HTTP 200, real heat over NYC (saved layer 23 hidden to isolate). **Site 2 (filter change):** filter -> CMT, view rebuilt (`_mv` 4 -> 8), new GetMap under the AI view name, heat visibly changed (sparse DDS -> denser CMT). Pan/zoom requests also named the AI view |
| 5a D-01 base click re-materializes | ✓ | ✓ | PASS — real mouse click on a base-table bar filters vendor_id=NYC; the AI view rebuilds |
| 5b D-23 drill on an AI-view bar | ✓ | ✓ | PASS — real click -> `POST /api/filter/materialize {dynamicViewId:-101, aiNonce, aiGen:0}` 200; filter view `_kbi_filt_uadmin_d12_dvn101_...`; bar re-queried from it; top-bar chip "Fares by vendor" + AI tag + `vendor_id = 'NYC'`; no 404; `_kbi_ai_` never in UI text |
| 5c filter -> undo -> redo (fb38e93) | ✓ | — | PASS (browser-verified) — `revert(-1)`: view dropped (list empty); forward: `_101_g1`, drill filter kept, chip intact, dv filter view re-materialized after redo and queried; no 404 |
| 6 SC4 removal repoint/drop | ✓ | — | PASS — `remove_dynamic_view -104` with stamped repoint/drop: fitting bar repointed to demo.nyctaxi, view-only bar removed, Kinetica view dropped (list empty); ONE revert restored both bars bound and the view rebuilt as `_104_g1` |
| 6b D-25 saved-view removal ask-once | ✓ | — | PASS — temp saved view 7 + an AI bar on it: first removal skipped `needs_confirmation`; after harness `approveRemoval()` the same op applied; Revert restored. (Model-ask UI not exercised.) Saved aggregated view 7 also built UNFILTERED (D-03 confirmed for saved views) |
| 7 SC3 lifecycle listing | n/a | n/a | PASS — see below |
| 8 U5 preflight cancel / 8b join through filter view | | | **DEFERRED to Phase 142 (operator decision)**: dashboard 12 has a single table and no registered table shares a join key with demo.nyctaxi, so 8b cannot be built; 8a needs `AI_DV_PREFLIGHT_TIMEOUT_MS` in `.env` plus a deliberately expensive join on a shared Kinetica. Re-run both on a real fact+dimension pair in 142's live UAT. Unit/e2e coverage (CMP, AIDV, RDV, E2EDV) stands |
| 9 change a view (rebind) | ✓ | — | PASS — add B, patch bar `dynamicViewId` -> B, remove A in one answer: all applied; bar queries switched to `_652`; list shows only B. `bindWidget` to saved view 7: bar queries `_kbi_dv_uadmin_d12_7`. (View B's filter used 'CASH' vs actual 'Cash', so B was empty: test input, not a defect) |
| 10 change-bar counts | ✓ | — | PASS — "2 added" (view + chart); hover on "1 removed" shows "UAT saved vendor summary" |
| 11 visual sweep + D-20 lock | ✓ | ✓ | PASS — AI tag aligned in the top-bar chip group and the filter-panel group title ("FARES BY VENDOR" + AI + chip "from Median fare" / "applies to 1 widgets"); over-threshold placeholder and note legible; heat colours fine. D-20: Dynamic Views button `disabled`, title "Keep or discard the AI changes first", click opens nothing |
| 12 live ask | | | SKIPPED (no provider request; server log shows `AI_MODEL=Antigravity`, the invalid model id from 135) |

## Step 7 lifecycle: list before / after (harness `listAiViews()` and `GET /api/ai/dynamic-view/list` agreed every time)
| Event | Before | After |
|---|---|---|
| a undo / redo | `[_401]` | undo `[]`, redo `[_401_g1]` |
| b discard (real Discard button + confirm) | `[_401_g1, _402]` | `[]` |
| c dashboard switch (Back -> "Discard and leave" modal; buttons Discard/Stay/Discard and leave) | one view | back on dashboard 12: `[]` |
| d logout (user menu -> Log out) | `[_404]` | after re-login `[]`; direct Kinetica probe "Object ... not found"; server log `route:"AI session cleanup", op:DYNAMIC_DROP, success` at 19:02:45, 3 s after the build (logout drop, not TTL) |
| e restart (API process killed + restarted, browser kept, no logout) | `[_405, _406]` | after reload `[]`; both names "not found" in Kinetica; boot log `[ai] boot sweep: dropped 2 AI session views; 0 left to TTL (session ended or token expired); 0 failed` |
| f cap | 5 built | 6th -> 409, bound chart shows "you already have 5 session views (limit 5); remove one first" + Retry; Kinetica held 5; after removing one, retry built (5 again) |
| g TTL (optional) | | not run |

**TTL-only remainder observed: none** (no view was left to the TTL in a, b, c, d, e).

## Issues
1. **FOUND AND FIXED (2cef90c):** when a base-table filter changed while an AI view was building, the AI-view bar fired one query against the BASE table's filter view (`SELECT vendor_id, MAX(fare_median) ... FROM _kbi_filt_uadmin_d12_t1_...` -> 502 "Column 'fare_median' not found"), then recovered. Root cause: `useCombinationOrchestrator`'s table loop mapped every trigger widget with a `tableId` (dv-bound widgets carry their base `tableId` by dual-write) to the table combination while the view was pending; WidgetRenderer reads `vizToHash` for its FROM. Pre-existing for SAVED dynamic views (Phase 94); AI aggregated views made it frequent. Fix: skip widgets with a numeric `dynamicViewId` in the table loop (like dv-bound layers). DVTBL-1 (AI + saved) red before, green after; web tsc clean; full web vitest 251 files / 4944 passed / 1 skipped; browser race repro run twice after the fix: zero failing requests.
2. **OPEN (minor):** while an AI view is undone (reverted away), its hand drill filter stays as a top-bar chip labelled "dynamic view -101" (name unresolvable). Restores correctly on redo.
3. **OPEN (cosmetic):** on redo the bar briefly queries the unfiltered `_g1` view before the dv filter view is rebuilt; possible momentary flash of unfiltered data.
4. Copy notes (open, cosmetic): the "last 30 days" follow-up is date-agnostic; the cap message starts lowercase.
5. Harness artefacts (not defects): empty answer bubbles for harness turns without answer text; harness `filter`/`clearFilter` calls count as AI turns (shifts revert/forward indices).

## Cleanup (restored and verified)
AI widget 122 (created, deleted 204); saved dynamic view 7 "UAT saved vendor summary" (aggregated template, created, deleted 200 `dropped:true`); `filter_display_mode` panel -> restored to topbar. Final state: widgets 117, 118; layer 23; no dynamic views; `/api/ai/dynamic-view/list` empty.

Not eyeballed: preflight cancel and join through a filter view (deferred to 142); model-driven D-25 ask UI; TTL fallback (7g); live model adherence (step 12); dark mode for steps 5c, 6, 6b, 9, 10 (light only).
