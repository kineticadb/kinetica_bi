# 137-12 Operator UAT — results (automated run, 2026-10-15)

**How:** Claude drove the operator's signed-in Chrome (separate profile, CDP 127.0.0.1:9333, playwright-core in the session scratchpad). The operator signed in and set the AI env vars themselves; Claude never read `.env` or handled credentials. Only `window.__kbiAiHarness`, the dev-served store modules and same-origin fetches with the browser's session were used. **No AI provider request was made** (step 9 skipped).
**Dashboard:** 12 — map 117, bar 118, saved heatmap layer 23 (table 1 `demo.nyctaxi`).
**Screenshots:** session scratchpad `uat136/shots/137-*.png` (not committed).

| Step | Light | Dark | Result |
|---|---|---|---|
| 1 add from picker | ✓ | ✓ | PASS — "AI Assistant" listed (after AI env fixed), added as widget 119 at 12×40 (x0,y24), hint + 3 starters, ask box, no lock notice. No-access user part NOT run (no second user; covered by unit tests) |
| 2 conversation look | ✓ | ✓ | PASS with issues 1–3 — bubbles, error border + Retry, muted "Cancelled, nothing changed", ✓ on picked choice, last choices active, long follow-up wraps, auto-scroll to bottom, textarea grows to 4 lines (55 px), Send height matches; reverted-ahead turns dim (opacity 0.55) |
| 3 progress | ✓ | ✓ | PASS — spinner + one line, "· 12s" elapsed after 10 s, Send → Cancel, textarea stays editable. Multi-widget sync not checked (one AI widget) |
| 4 small tile + drawer | ✗ | ✗ | FAIL — issues 4 and 5. Tile shows History + ask bar + one-line last result with ellipsis; drawer is portalled, opaque, focus on Close, Escape closes. <900 px full-screen not checked |
| 5 highlights + bar | ✓ | ✓ | PASS with issue 6 — outline fades ~3 s, pills legible, bar counts, "1 removed" hover lists "Map", Keep disabled with "Saving AI changes is coming soon", revert(-1) keeps bar ("none shown at this point") |
| 5b KPI label / map pill | ✓ | ✓ | PASS — KPI reads "Sum of fare_amount"; layer-only editHeatmap(23) gives map 117 the pill; edited count +1 (not 2); changedWidgetIds → [117] and the map gets the outline |
| 5c Layers panel | ✓ | ✓ | PASS — "AI heat" row + eye legible; hidden → only the saved (viridis) tile requested, 0 plasma; shown → plasma tiles return; saved row unaffected |
| 6 Discard confirm | ✓ | ✓ | PASS — centred, portalled, focus on Cancel, Escape/Cancel keep everything, Discard clears turns, changes and bar |
| 7 leave warning | — | ✓ | PASS with issue 7 — dialog "You have unsaved AI changes" (Stay / Discard and leave); after leaving, API shows only 117/118 |
| 8 Keep decision | | | **yes** — disabled Keep acceptable until Phase 141 (AISES-V20-04) |
| 9 live ask | | | skipped |

## Issues
1. **Older choices not greyed** (step 2): answered-turn choice buttons are `disabled` but render at full contrast, identical to active ones (D: "choices greyed out").
2. **Question shown twice** (step 2): a clarification shows the question as the answer bubble AND as the label before the choice buttons.
3. **Clarification turns carry generic follow-ups + Revert** (step 2): the local starter templates and "Revert dashboard to this state" appear under a clarification that changed nothing — noisy next to the choices.
4. **Drawer is centred, not right-anchored** (step 4): `.ai-drawer-overlay { place-items: stretch end }` loses to `global.css .modal-overlay { place-items: center }` (same specificity, later in cascade) — computed `justify-items: center`; drawer sits at x 432–912 of 1344. No slide-in animation exists either.
5. **Send overflows the small tile** (step 4): in `.ai-tile-bar` the textarea does not shrink below 154 px, so Send (51 px) extends 33 px past the tile's right edge and is clipped (9-col tile). Placeholder wraps to 2 lines.
6. **Bar copy** (step 5): "… · 1 removed Editing is locked …" has no separator before "Editing"; "0 removed" keeps the dotted hover underline with nothing to list.
7. **Leave dialog copy** (step 7): "Keep them first if you want to save them" while Keep is disabled until Phase 141.
8. **Steps-file gap**: the harness never sets the AI highlight (only `askRunner` does), so the step 5/5b outline was checked by calling `setHighlight` / `changedWidgetIds` on the live dev-served modules.

## Cleanup
AI widget 119 deleted (204); map 117 `legendPanelEnabled` removed again (config keys back to title/basemapLight/basemapDark/layout); harness session discarded. Dashboard 12 = widgets 117, 118.
