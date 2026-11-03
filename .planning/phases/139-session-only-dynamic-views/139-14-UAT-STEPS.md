# 139-14 Operator UAT steps

Plan 139-14 Task 2 (human-verify). Task 3 (UAT results + hand bookkeeping) runs after the operator replies.
Steps 0-11 make NO provider request and use NO AI quota (DEV harness only). Step 12 is OPTIONAL.

## Gates (run by the executor on the integrated tree, 2026-10-20, sequentially)
- shared: tsc OK; vitest 189 passed (9 files)
- server: tsc OK; test-gate PASSED (set-based; 8 known-failing files allowed; lib.exportRunner.memory and routes.dashboard-export pass alone = TD-V16-TEST-ISOLATION contamination). 2365/2420 tests passed.
- web: tsc OK; vitest --maxWorkers=4: 251 files passed, 1 skipped, 4942 tests passed, 1 skipped; theme-guard: 172 passed
- OIDC "Issuer is not a constructor" failures (bootstrap.spec, auth.routes.spec) fail identically on pre-phase commit 4536a0c in a temp worktree. Two further failures (auth.routes password-mode `/me` authMode deep-equal; bootstrap "AUTH_OIDC_ISSUER_URL is missing") appear only when packages/server/.env is present: at 4536a0c with the same .env they fail the same way (10 failed there too), so they are dev-.env leak, not Phase 139 regressions. No DEFAULT_VIEW_TTL_MINUTES=3 TTL failure surfaced in the gate run.
- No provider or Kinetica call was made by the executor; packages/server/.env was not read (it was copied unread into a temp worktree for the comparison, then deleted).

## Known test-strength gaps (so you know where your eyes are the real proof)
- Several plan greps count only test titles or symbols (LIFEC-, STOREDV-, FOLDDV-, GWDV-, BINDDV-, TOOLDV-, E2EDV-, dvInfo, refCols) and cannot show behaviour; specs were the proof. Lifecycle (steps 7a-7e) is the real check that views never outlive the session.
- jsdom cannot prove: real WMS tiles following an AI view (step 4), legibility of the D-05 over-threshold note/follow-up (step 3), AI tag alignment (steps 5, 11). Eyes are the proof.
- Gap C (fb38e93, AI-view generation in the orchestrator dv key) is proven only structurally (ORCHDV-4). Whether real undo/redo bumps the dv row before the chain re-materializes is NOT browser-verified: step 5c is the real check.
- Gap A (6a26b22) tool description text still says "saved dynamic view"; cosmetic.
- Harness-added `add_dynamic_view` carries no stamped `columns`, so peek/aiViews column types are real only for chain-driven builds; harness removal (`removeDynamicView`) does NOT repoint dependents, so use a full `chatTurn` op (step 6).
- Dynamic Views modal is disabled while AI changes are unsaved (134 D-08 lock): D-20 "list" is satisfied by the lock; step 11 asks you to confirm.

## Prerequisites
- Dev app running (`npm run dev`). `__kbiAiHarness` only exists in dev builds and only on a dashboard page.
- Sign in with Kinetica credentials as a user WITH "Use AI" (designer/admin). If Kinetica is unreachable, reply "defer" and the plan pauses like 138-08.
- Use a TEST dashboard. Harness changes are never saved. Reload or `__kbiAiHarness.discard()` clears AI changes.
- Dashboard 12 (map 117 with heatmap layer 23, bar 118, table 1 `demo.nyctaxi`) is the default. Note from the tables output: `<tableId>`, a lat column, a lon column, a timestamp column, a numeric fare column, a category (string) column (e.g. vendor_id), and the map widget id and bar widget id.
- Console: open with Option+Cmd+J; if Chrome warns about pasting, type `allow pasting` and Enter once.
- Find ids:
```js
const base = "http://localhost:4000"; // API base in dev (VITE_API_URL if set)
const dashId = new URLSearchParams(location.search).get("dashboard");
const get = (p) => fetch(base + p, { credentials: "include" }).then(r => r.json());
console.table((await get(`/api/dashboards/${dashId}/layers`)).data.map(l => ({ layerId: l.id, tableId: l.table_id, mode: l.config.renderMode, lat: l.config.latColumn, lon: l.config.lonColumn })));
console.table((await get("/api/tables")).data.map(t => ({ tableId: t.id, table: `${t.schema}.${t.name}`, columns: Object.entries(t.columns).map(([c, ty]) => `${c}:${ty}`).join(", ") })));
```
(If `dashId` is null, take the id from a `/api/dashboards/<id>/layers` entry in the Network tab.)
- Server-side listing (independent of the harness), same session:
```js
await fetch(base + "/api/ai/dynamic-view/list", { credentials: "include" }).then(r => r.json())
```
`h.listAiViews()` prints the same list as Kinetica reports it. Use whichever is available; record both if they differ.
- Server log: keep the server terminal visible for the step 7e boot line.

## Map tile check helper
Run `performance.setResourceTimingBufferSize(5000)` BEFORE the action. After it:
```js
performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("wms")).slice(-5)
```
New tile URLs must have `LAYERS=_kbi_ai_...` when the layer is bound to an AI view.

## Harness quick reference (`h` is `const h = __kbiAiHarness`)
```js
const h = __kbiAiHarness; h.help();
__kbiAiHarness.addDynamicView("Trips by hour", { baseTableId: <tableId>, groupBy: [{ column: "<timestamp col>", bucket: "hour", as: "pickup_hour" }], aggregates: [{ fn: "count", as: "trips" }] }, -201)
__kbiAiHarness.addChartOnView("bar", "Median fare", -101, { metric: "fare_median", aggregation: "max", groupByColumn: "<category col>" })
__kbiAiHarness.bindWidget(<widgetId>, <dvId>)
__kbiAiHarness.bindLayer(<layerId>, <dvId>)
__kbiAiHarness.removeDynamicView(<dvId>)      // does NOT repoint dependents
__kbiAiHarness.aiViews()                      // status + Kinetica name + expiresAt
await __kbiAiHarness.listAiViews()            // _kbi_ai_ views as Kinetica reports them
await __kbiAiHarness.peekAiView(<tempId>)     // sample rows + column types
__kbiAiHarness.filter("dynamicView", <dvId>, "<dv column>", "eq", "<value>")
__kbiAiHarness.revert(-1); __kbiAiHarness.forward(0); __kbiAiHarness.discard()
```

## Verify
Do every VISUAL step in LIGHT and then DARK mode. No step makes a provider request except the OPTIONAL step 12. `const h = __kbiAiHarness; h.help();` first. Start each step from a clean session (`h.discard()`) unless it says otherwise. After any build, `h.aiViews()` shows status and the Kinetica name.

0. D-26: record the Kinetica version (Workbench/GAdmin About, or the version on the Kinetica home page). If it is not 7.2.x, say so: steps 1-2 then double as the re-check of the 7.2-documented functions (APPROX_MEDIAN, APPROX_PERCENTILE, DATE_TRUNC).

1. U1-U3 median/percentile in GROUP BY inside a materialized view: `h.chatTurn("Fares by vendor", "Done.", { ops: [{ op: "add_dynamic_view", tempId: -101, name: "Fares by vendor", spec: { baseTableId: <tableId>, groupBy: [{ column: "<category col>" }], aggregates: [{ fn: "count", as: "trips" }, { fn: "median", column: "<fare col>", as: "fare_median" }, { fn: "percentile", column: "<fare col>", p: 90, as: "fare_p90" }] } }] })` then `h.addChartOnView("bar", "Median fare", -101, { metric: "fare_median", aggregation: "max", groupByColumn: "<category col>" })`. Check: `h.aiViews()` shows -101 materialized (it built UNFILTERED on the large table because the output is small: D-02); the bar renders; `await h.peekAiView(-101)` shows plausible medians (between min and max, near the average) and p90 > median. Record any NULL group / empty-group behaviour you see (U3).

2. U4 time buckets: `__kbiAiHarness.addDynamicView("Trips by hour", { baseTableId: <tableId>, groupBy: [{ column: "<timestamp col>", bucket: "hour", as: "pickup_hour" }], aggregates: [{ fn: "count", as: "trips" }] }, -201)` and the same with `bucket: "week"` (tempId -202); if a DATE column exists, `bucket: "day"` on it (tempId -203). `await h.peekAiView(-201)` (and -202, -203) for each: record the bucket column's type and the weekday of a week bucket (week start). Expected: builds; hour values on the hour.

3. D-02 row view + D-05 note (LIGHT and DARK): `h.chatTurn("Raw trips", "Here is a row view.", { ops: [{ op: "add_dynamic_view", tempId: -102, name: "Raw trips", spec: { baseTableId: <tableId>, columns: [{ column: "<category col>" }, { column: "<lat col>" }, { column: "<lon col>" }, { column: "<fare col>" }] } }] })`, then `h.addChartOnView("records", "Raw trips", -102, {})`. Expected: the records widget shows "No filter applied — load the full table, or apply a filter to narrow it."; under the answer a muted note `"Raw trips" is waiting for a filter: ... (limit 100,000).` and a follow-up button suggesting a filter (e.g. "Filter demo.nyctaxi to the last 30 days"). Note and follow-up legible in both modes.

4. SC2 real tiles, both map sites (LIGHT and DARK): `performance.setResourceTimingBufferSize(5000)`; click a bar value by hand so the base table is filtered and "Raw trips" fits (status materialized in `h.aiViews()`); then `h.chatTurn("Heat from the view", "Done.", { ops: [{ op: "add_layer", tempId: -103, widgetId: <mapId>, dynamicViewId: -102, tableId: <tableId>, renderMode: "heatmap", spatialMode: "latlon", latColumn: "<lat col>", lonColumn: "<lon col>" }] })`. (Alternative: `h.bindLayer(<layerId>, -102)` rebinds the existing heatmap layer.) Check with the tile helper: new WMS URLs have `LAYERS=_kbi_ai_...` and real heat appears (site 1: initial render). Then pan/zoom the map AND change the hand filter: new tile URLs again name the (re-built) AI view and the heat follows (site 2). Record BOTH verdicts separately, light and dark.

5. D-01 + D-23 + gen-key (LIGHT and DARK): with "Fares by vendor" bound to the bar from step 1:
   a. Click a value on a base-table chart: the AI view rebuilds (`h.aiViews()` expiresAt changes; bar values change; no error state = U7 dependent-view rebuild OK).
   b. Click a bar IN the AI-view bar (D-23 drill): the dashboard filters it (top-bar chip under "Fares by vendor" with the small "AI" tag; filter panel group title "Fares by vendor" + "AI" tag); no 404 in the Network tab; the Kinetica name `_kbi_ai_...` never appears in the UI.
   c. Filter -> undo -> redo on an AI view (fb38e93): with the drill filter from b still active, `h.revert(-1)` then `h.forward(0)` (view comes back as `_g1`); the AI-view bar keeps the filter and shows filtered data, the chip is intact, no 404, and the Network tab shows the filtered query going to the `_g1` name (not the old name). Record stale vs correct.

6. SC4 removal repoint/remove: build -104 "Fares summary" bound by a bar whose columns all exist on the base table (e.g. groupBy the category column, aggregate `fn:"max", column:"<fare col>", as:"<fare col>"` so the bar's refs exist on the base) and a second bar using `trips` (not a base column). Then `h.chatTurn("Remove it", "Removed.", { ops: [{ op: "remove_dynamic_view", id: -104, repoint: { tableId: <tableId>, widgetIds: [<first bar id>], layerIds: [] }, drop: { widgetIds: [<second bar id>], layerIds: [] } }] })`: the first bar now renders from the base table, the second is gone; ONE `h.revert(-1)` (or the chat Revert) restores both bars bound to the view and the view rebuilds.
   6b. D-25 saved-view removal ask-once: on a dashboard with a widget bound to a SAVED dynamic view (positive id), `h.chatTurn("Remove saved", "Removed.", { ops: [{ op: "remove_dynamic_view", id: <saved dvId>, repoint: { tableId: <tableId>, widgetIds: [], layerIds: [] }, drop: { widgetIds: [<widget on it>], layerIds: [] } }] })`: confirm you are asked ONCE (a single approval prompt, not one per widget); declining leaves everything unchanged; approving removes it; Revert restores. If no saved view is available, reply "6b: not testable".

7. SC3 lifecycle, verified by LISTING views in Kinetica (`await h.listAiViews()`, and the GET /api/ai/dynamic-view/list snippet). For each event note the list BEFORE and AFTER:
   a. Undo: with one AI view built, `await h.listAiViews()` (BEFORE), `h.revert(-1)`, wait a few seconds, `await h.listAiViews()` -> gone; `h.forward(0)`, `await h.listAiViews()` -> reappears with a `_g1` suffix (redo).
   b. Discard (also covers "revert" of all): build two views, `await h.listAiViews()`, click Discard -> confirm, `await h.listAiViews()` -> empty.
   c. Dashboard switch: build a view, `await h.listAiViews()`, open another dashboard, come back, `await h.listAiViews()` -> empty.
   d. Logout: build a view, `await h.listAiViews()`, log out, log back in, `await h.listAiViews()` -> empty (dropped by the server before the session was deleted).
   e. Restart: build two views, `await h.listAiViews()`, stop and restart the SERVER process (keep the browser open; do not log out), reload, sign in if asked, `await h.listAiViews()` -> empty, and the server log shows one line "[ai] boot sweep: dropped N AI session views; M left to TTL ...". If a view remains, wait 6 minutes and list again (TTL fallback) and record it.
   f. Cap: build 5 views (`__kbiAiHarness.addDynamicView(...)` x5), then a 6th -> the 6th shows an error with "you already have 5 session views (limit 5); remove one first"; remove one, retry -> builds.
   g. OPTIONAL U8 TTL: build a view, close the tab, wait 6+ minutes, list from another tab (`await h.listAiViews()`) -> gone.

8. U5 preflight cancel: stop the server, set `AI_DV_PREFLIGHT_TIMEOUT_MS=2000` in packages/server/.env, start it; build a join view over the two largest tables on the dashboard (`__kbiAiHarness.addDynamicView("Join", { baseTableId: <t1>, joins: [{ tableId: <t2>, type: "inner", on: [{ left: "<key>", right: "<key>" }] }], columns: [...], }, -301)`, no filter). Expected: the widget shows "The view took too long to build and was cancelled." (or it builds fast: then record the time and skip); in Workbench/GAdmin Jobs no job whose text starts with `/* kbi-ai:aidv-` is still running. Remove the env line and restart afterwards.
   8b. Join through a filter view (INNER + LEFT): with the default timeout restored, set a hand filter on `<t2>` (a table with a widget, so its filter view exists), then build one join view with `type: "inner"` (tempId -302) and one with `type: "left"` (tempId -303); `await h.peekAiView(-302)` and `-303`: both build; the filtered join table's rows are narrowed (inner row count <= left row count; left keeps unmatched base rows with NULLs on the joined columns). Record both.

9. Change a view (D-19/D-24 rebind): with a bar bound to view A, `h.chatTurn("Change it", "Changed.", { ops: [<add_dynamic_view B>, { op: "patch", action: { target: { kind: "widget", id: <bar id> }, configPatch: { dynamicViewId: <B> } } }, { op: "remove_dynamic_view", id: <A> }] })`: the bar shows B's data; `await h.listAiViews()` shows only B. Also rebind with `h.bindWidget(<bar id>, <saved dvId>)` (rebind to a saved view): the bar shows the saved view's data.

10. Change bar counts: after step 1 the bar reads "N added" including the views; hover a removed saved view (if you removed one with approval in 6b) shows its name.

11. Visual sweep (LIGHT and DARK): AI tag alignment next to view names (top bar + panel), over-threshold placeholders, the note + follow-up under answers, map heat colours. D-20: while AI changes are unsaved, the Dynamic Views modal button is disabled (locked): confirm you cannot open it with AI views present.

12. OPTIONAL live ask (skip is fine; free tier 20 requests/day/model; real model id; `AI_TIMEOUT_MS` >= 120000; restart after .env changes): ask "Show the median fare by vendor as a bar". Report only: did a view + bar appear (yes/no), did the answer mention "approximate" (yes/no), any error text.

## Cleanup
- `h.discard()` or reload clears AI changes. Remove `AI_DV_PREFLIGHT_TIMEOUT_MS` from .env and restart. Restore any saved view/widget you removed (Revert).

## Reply format
One message: `approved` or a numbered issue list by step (with LIGHT/DARK verdict for steps 3, 4, 5, 11 and both map sites in step 4), then:
`0: Kinetica version <x.y.z>`
`7: list-before/list-after for a-f (g optional), any TTL-only remainder`
`6b: verdict | not testable`
`12: skipped` or `12: ran - view+bar yes/no, answer mentioned approximate yes/no, errors: <text>`
Or just `defer`.
