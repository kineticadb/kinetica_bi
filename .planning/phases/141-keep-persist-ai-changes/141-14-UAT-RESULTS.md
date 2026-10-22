# 141-14 Operator UAT — results (automated run, 2026-10-22)

**How:** At the operator's request ("go, skip 6") Claude ran the UAT. The browser steps were driven through the operator's signed-in Chrome over CDP, using the DEV harness only (no provider request, no AI quota). The operator signed in; Claude never handled credentials and never read or edited `packages/server/.env`. API in schema mode.
**Kinetica version (step 0):** 7.2.3.12 (same instance as 139/140).
**Test dashboards:** copies of dashboard 12 made via export/import: 13 (main), 14 (accidental duplicate), 15/16/17 (repro and verify). Each had a temporary AI widget and a spare records widget. All five were deleted afterwards (204); dashboard 12 is untouched, the AI view list is empty, and their saved-view Kinetica objects expire by TTL.
**Screenshots:** session scratchpad (not committed).

| Step | Light | Dark | Result |
|---|---|---|---|
| 0 Kinetica version, test dashboard | n/a | n/a | 7.2.3.12; dashboard 13 (repro 15/16, verify 17) |
| 1 Keep + reload (SC4) | ✓ | ✓ | PASS after two fixes (e5bb56e, eaad490); "Filters are not saved." seen; reload matches |
| 2 Filters | ✓ | ✓ | PASS |
| 3 Temp views | n/a | n/a | PASS |
| 4 Map tiles (both tile paths) | n/a | n/a | PASS |
| 5 409 (two tabs of the same user) | ✓ | ✓ | PASS |
| 6 Rights (viewer, no-manage user, forged fetch) | | | SKIPPED by the operator; server side covered by KEEP-ROUTE forged and partial-rights specs |
| 7 Headers in a real browser | n/a | n/a | PASS |
| 8 Leave dialog | ✓ | ✓ | PASS |
| 9 Join note | | | NOT TESTABLE (no second table with a join key on dashboard 12); deferred to Phase 142 with the 139 step-8 join checks |
| 10 Audit | n/a | n/a | PASS |
| 11 View on/off (D-20) | ✓ | ✓ | PASS |

## Step 1: Keep + reload
- First attempt: every Keep returned 422 "the AI assistant widget can't be changed by Keep". The client bakes on-screen geometry into widgets with no saved `config.layout`, which included the AI widget, and `checkKeepChange` refused any edit to it.
  - FIX e5bb56e: an `{id, rect}` edit of the AI widget is allowed; any other change, or removing it, is still refused. KVAL-4b and KEEP-ROUTE-ai-rect were red first, then green (52/52 Keep specs).
  - A dev-server restart caused by the code edit triggered the 139 boot sweep, which dropped the session's AI view (follow-up a).
- Keep then succeeded. The dialog read "Save AI changes? | 5 added · 1 edited · 1 removed. Filters are not saved." Cancel left everything unchanged. "Saving…" appeared with both buttons disabled. The response was 200 with real ids (idMap widgets 128-130, layer 25, dv 8); `X-Kbi-Dashboard-Version` went 13:10:22. The temp view was dropped, the bar disappeared, 0 revert buttons remained, the chat showed "Changes saved.", the AI pills were gone.
- The reload did NOT match: new widgets were saved at 1×1. Reproduced on copy 15 (78 writes after Keep) and traced on 16 with a temporary debug log. After the list swap, react-grid-layout first reported its stale pre-swap layout (old ids), then synthesized 1×1 items for new children with no layout or `data-grid`; `handleLayoutChange` persisted both and ping-ponged (32 callbacks). Effects: new widgets saved 1×1, the AI widget's baked rect overwritten, the version jumped ~88 (false 409s for other editors).
  - FIX eaad490: ignore a layout callback whose ids are not exactly the widgets on screen, and pass each grid child its rect as `data-grid`. KPAGE-4/5 red then green; full web suite 261 files / 5049 passed / 1 skipped; web tsc clean.
  - Re-verified on fresh dashboard 17: 3 writes after Keep (keep, drop, one PATCH); new widgets saved at 18×30, 9×14, 18×30; version 10→23; reload matched exactly (positions, sizes, layers, saved view).
  - Residual minor: the single remaining PATCH is because the bake uses the page's index-based fallback rect for a legacy widget with no saved layout (y24); RGL had shown it at y48 after collision, so it saves y48 once. Final state correct (follow-up d).

## Step 2: Filters
The table filter (`vendor_id = 'YCAB'`) and the drill filter on the AI view stayed applied after Keep. The AI-view filter was re-keyed from `dynamicView:-701` to `dynamicView:8`; its chip reads "UAT fares view" without the AI tag. A reload clears them.

## Step 3: Temp views
`GET /api/ai/dynamic-view/list` showed `_kbi_ai_…_701` before Keep and `[]` after. The view-bound chart showed data.

## Step 4: Map tiles
A row AI view (vendor DDS) with an AI heatmap layer was Kept (layer 29, dv 10). WMS `LAYERS` went from `_kbi_ai_…_1001` before to `_kbi_dv_uadmin_d13_10` after, and still named the saved view after a filter change to CMT (both buildWmsParams tile paths).

## Step 5: 409
Two tabs of the same user (D-17 treats another tab as foreign). Tab B renamed a widget; A's Keep returned 409. Dialog "This dashboard changed", body "Someone else changed this dashboard since you started. Your AI changes weren't saved.", Stay (`btn-primary btn-sm`, focused) and "Discard and reload the latest" (`ghost-sm ghost-danger`).
- Stay: Keep disabled with the note "Someone else changed this dashboard. Discard to load the latest."; nothing of A's saved.
- Discard and reload: bar gone, B's rename shown, A's chart gone.
- A's own layer saves (apiFetch `updateLayer`, twice) then Keep returned 200 (D-06/D-17); B's layer save then A's Keep returned 409. Dark screenshot legible.

## Step 6: skipped
Operator said "skip 6". Not browser-verified: viewer sees only Discard; user without Manage dynamic views message; forged devtools fetch. Server-side coverage: KEEP-ROUTE forged and partial-rights tests.

## Step 7: Headers
Browser JS cross-origin read the list header `X-Kbi-Dashboard-Version-Read` "15:widgets:98" and the write header `X-Kbi-Dashboard-Version` "15:98:99". `content-disposition` stays hidden.

## Step 8: Leave dialog
"You have unsaved AI changes | Leaving will discard the changes the AI made to this dashboard. Keep them first if you want to save them. | Stay | Discard and leave". No "coming soon".

## Step 9: Join note
Not testable here. Deferred to Phase 142.

## Step 10: Audit
`ai_audit` had `kept` and `keep_invalid` rows (and `keep_conflict` from step 5), all with counted 0, an empty question, and counts plus idMap only.

## Step 11: View on/off (D-20)
The Keep dialog added "View on/off changes are not saved." only when a view was toggled (step 1's dialog had no such line). After Save the chat note read "Changes saved. View on/off changes are not saved." The override for view 8 was `enabled:false` after Keep and null after reload. Light and dark.

## Visual issue fixed during UAT (pre-existing, not 141)
`btn-primary btn-sm` measured 21px against `ghost-sm` 23px (btn-primary had no border). FIX 3aef06f: `.btn-primary.btn-sm { border: 1px solid transparent }`; re-measured 23/23 in the bar and dialog; theme-guard 176 passes.

## Open minor follow-ups
- (a) After a server restart an open tab's AI views are not rebuilt; chart queries fail "not found" (139 boot sweep + client).
- (b) When Keep is blocked, the bar's note pushes Keep and Discard onto a second line.
- (c) "Discard and reload the latest" (ghost-danger) does not look like a danger button until hover.
- (d) The geometry bake uses the fallback rect, not the grid's actual position, for legacy widgets with no saved layout (one extra own-tab PATCH after Keep).
- (e) Step 9 join note and step 6 partial-rights/viewer UI not browser-verified.
- (f) Empty answer bubbles for harness turns without answer text (harness only).

## Not eyeballed
Step 6 UI, step 9 join note, live provider Keep, the viewer's bar in a real session.
