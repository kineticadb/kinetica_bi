# 137-12 Operator UAT steps

Plan 137-12 Task 2 (human-verify). Task 3 (hand bookkeeping + SUMMARY) runs after the operator replies.
Steps 1-8 make NO provider request and NO AI quota use (DEV harness only). Step 9 is OPTIONAL.

## Gates (run by the orchestrator on the merged tree, 2026-10-14)
- shared tsc OK; server tsc OK; server test-gate PASSED (set-based); web tsc OK
- web vitest --maxWorkers=4: 4755 passed; theme-guard: 172 passed
- No provider or Kinetica call was made by the executor; packages/server/.env was not read.

## Prerequisites
- Dev app running (`npm run dev`). `__kbiAiHarness` only exists in dev builds and only on a dashboard page.
- Signed in as a user WITH "Use AI" (designer/admin), plus a second user WITHOUT it (step 1).
- AI must be configured on the server for the AI widget to appear in the picker (`GET /api/ai/config` enabled). Any `.env` change needs a server restart.
- Sign-in uses Kinetica credentials. If Kinetica is unreachable, reply "defer" and the plan pauses like 136-12.
- Use a TEST dashboard. A widget added through the picker is a REAL saved widget: delete it afterwards (edit mode, widget menu, Delete, then Save). Harness-added charts/layers are NOT saved; Discard or reload clears them.
- Console: open with Option+Cmd+J; if Chrome warns about pasting, type `allow pasting` and Enter once.
- Find ids: run `const h = __kbiAiHarness; h.help();` (lists saved widget ids). Tables/layers:
```js
const base = "http://localhost:4000"; // API base in dev (VITE_API_URL if set)
const dashId = new URLSearchParams(location.search).get("dashboard");
const get = (p) => fetch(base + p, { credentials: "include" }).then(r => r.json());
console.table((await get(`/api/dashboards/${dashId}/layers`)).data.map(l => ({ layerId: l.id, tableId: l.table_id, mode: l.config.renderMode, lat: l.config.latColumn, lon: l.config.lonColumn })));
console.table((await get("/api/tables")).data.map(t => ({ tableId: t.id, table: `${t.schema}.${t.name}`, columns: Object.entries(t.columns).map(([c, ty]) => `${c}:${ty}`).join(", ") })));
```
(If `dashId` is null, take the id from a `/api/dashboards/<id>/layers` entry in the Network tab. If you later see missing tile/requests in `performance` data, run `performance.setResourceTimingBufferSize(5000)` first.)
Note: tableId, a numeric column, a category column, lat/lon columns, the map widget id, a saved bar id, a saved heatmap layer id.

## Verify
Do every visual step in LIGHT and then DARK mode (theme toggle). Record verdicts per step per theme.

1. **Add the widget (Use-AI user; this adds a real saved widget, delete it after).** Visualizations -> "AI Assistant" is listed; add it. It appears 12 x 40 with the hint "Ask about this dashboard's data" and 2-3 starter questions built from your tables. (Do NOT click a starter; that is a live ask, step 9.) No overlap with other widgets. No lock notice in the dashboard header. As the user WITHOUT Use AI: the picker has no "AI Assistant", and an existing AI widget shows only "You don't have access to the AI assistant" with no ask box and the layout unchanged. Also check the no-access / not-configured notices are legible in both themes.

2. **Conversation look** (console; run in this order so the LAST turn holds the active choices):
```js
__kbiAiHarness.chatTurn("q", "", { status: "error", message: "The AI provider could not complete this answer. Try again.", retryable: true })
__kbiAiHarness.chatTurn("Add a map", "", { status: "cancelled" })
__kbiAiHarness.chatTurn("Show the tip", "Which tip do you mean?", { clarifications: [{ kind: "choose_option", question: "Which tip do you mean?", options: [{ id: "1", label: "Total tip" }, { id: "2", label: "Average tip" }] }], pickedChoice: { clarificationIndex: 0, optionId: "1" } })
__kbiAiHarness.chatTurn("Show total fare by vendor", "Added a bar chart of total fare by vendor.", { followUps: ["Show it by month", "Add a pie chart of tips"] })
__kbiAiHarness.chatTurn("Show the total", "Which total do you mean?", { clarifications: [{ kind: "choose_option", question: "Which total do you mean?", options: [{ id: "1", label: "Total fare" }, { id: "2", label: "Total tip" }] }] })
```
Check: user bubbles right (accent fill, readable text), AI bubbles left (opaque panel, border), newest at the bottom and auto-scrolled; follow-ups and "Revert dashboard to this state" under each answer; error bubble (danger border) with Retry; "Cancelled, nothing changed" muted; older choices greyed with "Total tip" ticked; the last turn's two choice buttons active; long follow-up buttons wrap cleanly; older (reverted-ahead) turns dim; the textarea grows to about 4 lines and Send/Cancel button height matches. Do NOT click follow-ups/choices/Retry/starters (they send a live ask).

3. **Progress:** `__kbiAiHarness.fakeRun("Adding a chart…", 15000)`: one status line with spinner (muted text legible); after 10 s it shows elapsed seconds; Send turns into Cancel and the box stays typeable; every AI widget on the page shows the same state.

4. **Small tile + drawer:** in edit mode resize the AI widget below 12 columns wide (or under 24 rows) (if editing is locked, run `__kbiAiHarness.discard()` first), or add a second AI widget (real saved widget, delete after) and shrink it. Check: ask bar + "History" + one-line last result, aligned, with ellipsis on long text. Click History: the drawer slides in from the right over the page (portalled, not clipped inside the tile), opaque background with border/shadow, shows the same conversation, focus on Close; Escape/Close closes it. Narrow the browser below 900 px: the drawer is full-screen.

5. **Highlights + bar:**
```js
__kbiAiHarness.addChart("bar", "AI bar", <tableId>, { metric: "<numeric col>", aggregation: "sum", groupByColumn: "<category col>" })
__kbiAiHarness.editChart(<saved chart id>, { color: "teal" })
__kbiAiHarness.removeWidget(<saved id>); __kbiAiHarness.approveRemoval(); __kbiAiHarness.removeWidget(<saved id>)
```
Check: changed widgets show an accent outline that fades in about 3 s (with OS "reduce motion" on, a steady ring instead, if you can toggle it); the "AI added"/"AI edited" pills stay and are readable; a full-width bar under the header (check spacing against the grid and filter bar) reads "Unsaved AI changes: N added · N edited · N removed. Editing is locked …"; hovering "N removed" lists the removed name (dotted underline); Keep is disabled and its tooltip "Saving AI changes is coming soon" shows on hover (say if not); `__kbiAiHarness.revert(-1)` keeps the bar visible ("none shown at this point"). The bar wraps cleanly on a narrow window.

5b. **136-12 UAT findings 2 + 3 (harness only).** Run `__kbiAiHarness.discard()` first to start clean, then:
```js
__kbiAiHarness.addChart("bignumber", "KPI", <tableId>, { metric: "<numeric col>", aggregation: "sum" })
```
The text above the number reads "Sum of <numeric col>" (NOT "value"), legible in light and dark.
```js
__kbiAiHarness.editHeatmap(<saved heatmap layer id>, { colormap: "magma" })
```
(the map widget itself untouched): the map that shows that layer gets the "AI edited" pill AND the about 3 s fading outline; the bar's edited count goes up by exactly 1 (the layer), not 2. If the dashboard has no saved heatmap layer, use `__kbiAiHarness.addHeatmap({...}, <mapId>)` (spec as in 5c) then `editHeatmap(<returned temp id>, { colormap: "inferno" })`: the map must flash again on the edit and carry the pill. Then `removeLayer(<saved layer id>)` + `approveRemoval()` + `removeLayer(<saved layer id>)` -> the map flashes again and keeps the pill.

5c. **136-12 UAT finding 1, Layers panel (harness only).** Run `__kbiAiHarness.discard()`. Enter edit mode, open the map widget's settings, and under "LAYERS PANEL" tick "Show Layers Panel"; save (use a test dashboard, or untick and save afterwards if you do not want to keep it). Then:
```js
__kbiAiHarness.addHeatmap({ tableId: <tableId>, spatialMode: "latlon", latColumn: "<lat col>", lonColumn: "<lon col>", style: { colormap: "plasma" }, name: "AI heat" }, <mapId>)
```
Check in light AND dark: the map's Layers panel lists an "AI heat" row (text and eye icon legible); clicking its eye hides the heat (no AI tiles drawn), clicking again shows it; the saved layers' rows and eyes are unaffected.

6. **Discard:** click Discard -> a centred confirm "Discard all AI changes?" (not clipped, focus on Cancel, Escape/backdrop closes). Cancel keeps everything; Discard clears the conversation, the AI changes and the bar.

7. **Leave warning still works:** make an AI change (e.g. step 5 addChart), click Back -> the existing leave dialog appears. Choose to discard/leave; confirm nothing was saved.

8. **Question for the requirement record (AISES-V20-04):** is a visible-but-disabled Keep acceptable in this phase (Keep is enabled in Phase 141, per D-16)? Answer yes/no.

9. **OPTIONAL live ask (skip is fine).** Free tier is 20 requests/day/model and one ask uses several requests. Use a real model id (e.g. the tested `gemini-3-flash-preview`), `AI_TIMEOUT_MS` >= 120000 in packages/server/.env, and restart the server after the change. Ask ONE question, e.g. "Add a bar chart of total fare by payment type". Report only: progress text appeared and changed (yes/no), the dashboard changed with the outline (yes/no), the answer showed follow-ups from the AI (yes/no; local templates are shown otherwise), any error text. Optionally press Cancel on a second ask within 2 s and report "Cancelled, nothing changed" + the question back in the box. Optionally, through the docker image on :8080, confirm the status line updates during the ask (S2 nginx).

## Cleanup
- Delete any AI Assistant widget you added via the picker (edit mode -> widget menu -> Delete -> Save).
- Untick "Show Layers Panel" and save if you enabled it only for 5c.
- Harness changes are unsaved; `__kbiAiHarness.discard()` or reload clears them.

## Reply format
One message: `approved` or a numbered issue list by step (with light/dark verdict for steps 2, 3, 4, 5, 5b, 5c, 6), then:
`8: yes|no`
`9: skipped` or `9: ran - progress yes/no, outline yes/no, AI follow-ups yes/no, errors: <text>`
Or just `defer`.
