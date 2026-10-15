# 138-08 Operator UAT steps

Plan 138-08 Task 2 (human-verify). Task 3 (UAT results + hand bookkeeping) runs after the operator replies.
Steps 1-8b make NO provider request and NO AI quota use (DEV harness only). Step 9 is OPTIONAL.

## Gates (run by the executor on the integrated tree, 2026-10-15, sequentially)
- shared: tsc OK; vitest 158 passed (7 files)
- server: tsc OK; test-gate PASSED (set-based; 8 known-failing files allowed; routes.filter-materialize-spatial and routes.info-query pass alone = TD-V16-TEST-ISOLATION contamination)
- web: tsc OK; vitest --maxWorkers=4: 242 files passed, 1 skipped, 4851 tests passed, 1 skipped; theme-guard: 172 passed
- No provider or Kinetica call was made by the executor; packages/server/.env was not read.

## Known test-strength gaps (so you know where your eyes are the real proof)
- LOCKF-8 (AiChangeBar.spec, filter-only answer shows no bar) passes on pre-138-03 code, so it does not discriminate: step 3 is the real check for "filter-only = no Keep/Discard bar, no Edit lock, no leave dialog".
- UNDOF-1..8 (per-column undo) were red only as module-not-found: steps 4 and 5 are the real check for per-column Revert/Forward/Discard.
- AAT-2 and ZR-4..8 pass against no-op stubs: steps 8 and 8b are the real check for the zero-row note / "Clear this filter" and the scoped-widget note.

## Prerequisites
- Dev app running (`npm run dev`). `__kbiAiHarness` only exists in dev builds and only on a dashboard page.
- Sign in with Kinetica credentials as a user WITH "Use AI" (designer/admin). If Kinetica is unreachable, reply "defer" and the plan pauses like 136-12.
- Use a TEST dashboard. Harness changes are never saved; filters are view state and are never saved. Reload or `__kbiAiHarness.discard()` clears AI changes.
- Dashboard 12 (map 117, bar 118, layer 23, table 1 `demo.nyctaxi`) was used in 136/137 and has a map with a table-bound layer AND a bar on the same table. For step 6 you need a dashboard with a saved dynamic view widget (or create one: Dynamic Views -> new view -> add a widget bound to it).
- Console: open with Option+Cmd+J; if Chrome warns about pasting, type `allow pasting` and Enter once.
- Find ids: run `const h = __kbiAiHarness; h.help();` (lists saved widget ids). Tables/layers:
```js
const base = "http://localhost:4000"; // API base in dev (VITE_API_URL if set)
const dashId = new URLSearchParams(location.search).get("dashboard");
const get = (p) => fetch(base + p, { credentials: "include" }).then(r => r.json());
console.table((await get(`/api/dashboards/${dashId}/layers`)).data.map(l => ({ layerId: l.id, tableId: l.table_id, mode: l.config.renderMode, lat: l.config.latColumn, lon: l.config.lonColumn })));
console.table((await get("/api/tables")).data.map(t => ({ tableId: t.id, table: `${t.schema}.${t.name}`, columns: Object.entries(t.columns).map(([c, ty]) => `${c}:${ty}`).join(", ") })));
```
(If `dashId` is null, take the id from a `/api/dashboards/<id>/layers` entry in the Network tab.)
Note: tableId, a category (string) column and a value you can see in the bar, a numeric column, the map widget id, a dynamic view id and one of its columns.

## Map tile check helper
Run `performance.setResourceTimingBufferSize(5000)` BEFORE the filter. After a filter, run:
```js
performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("wms")).slice(-5)
```
New tile URLs must reference a combination view (not the base table) and the visible points/heat must thin out.

## Harness quick reference (`h` is `const h = __kbiAiHarness`)
```js
__kbiAiHarness.filter("table", <tableId>, "<category col>", "eq", "<value>")
__kbiAiHarness.filter("table", <tableId>, "<numeric col>", "between", ["0", "10"])
__kbiAiHarness.filter("dynamicView", <dvId>, "<dv column>", "eq", "<value>")
__kbiAiHarness.clearFilter("table", <tableId>, "<category col>")
__kbiAiHarness.filterState()   // filters + AI deltas + lock state
```

## Verify
Do every visual step in LIGHT and then DARK mode. Steps 1-8 make NO provider request. `const h = __kbiAiHarness; h.help();` first. Start each step from a clean session (`h.discard()`) unless it says otherwise.

1. SC4 + SC1 map/bar/records narrow like a click: on the map + bar dashboard run `performance.setResourceTimingBufferSize(5000)`, note the map, then `h.filter("table", <tableId>, "<category col>", "eq", "<a value you can see in the bar>")`. Check: the bar shows only that category, records (if present) narrow, the MAP TILES visibly thin out to that category (new WMS tile URLs reference a combination view, see helper); then `h.clearFilter("table", <tableId>, "<category col>")` restores all three. Compare with clicking the same bar by hand: the map and bar look the same as after the AI filter.

2. Chip tag + outline + no pill (D-14, D-15): after `h.filter(...)` as in step 1: the top-bar chip reads `<col> = '<value>'` with a small "AI" tag (legible, aligned, not clipped); open the filter panel: the chip shows "AI" and "from AI assistant". The bar, records and the MAP get the accent outline that fades in ~3 s; no "AI edited" pill anywhere. `h.highlight([<mapId>])` flashes the outline on the map on demand. Now click a different bar value by hand: the chip's "AI" tag disappears (user edit).

3. D-09 no bar / no lock / no leave dialog: after a filter-only `h.filter(...)`: no "Unsaved AI changes" bar; the dashboard Edit button works (not locked); click Back: no leave dialog. Then `h.chatTurn("Add a chart and filter", "Done.", { ops: [{ op: "add_widget", tempId: -101, type: "records", title: "AI records", config: { tableId: <tableId> } }, { op: "apply_filter", source: { kind: "table", id: <tableId> }, filters: [{ column: "<category col>", operator: "eq", value: "<value>", dataType: "string" }] }] })`: the bar appears with "1 added" (the filter is not counted) and editing locks.

4. Per-column Revert/Forward (D-10, D-11, SC2): `h.discard()`. Click a bar to set a manual filter on column A. `h.filter("table", <tableId>, "<column B>", "eq", "<value>")`. Then click a different chart to set/replace column A by hand. In the AI widget's chat (or `h.revert(-1)`): Revert removes ONLY the AI's column B filter; your manual column A stays. `h.forward(0)` brings B back; A unchanged. Same-column case: set column B = X by hand, `h.filter(... column B = Y)` replaces it (chip shows Y with AI tag), `h.revert(-1)` restores X.

5. Discard (D-12): set a manual filter on A, `h.filter(... A = other value)`, then make the bar appear with a mixed `h.chatTurn` as in step 3, click Discard -> confirm: A is back to YOUR value, the AI widget is gone, the conversation is cleared.

6. Dynamic view (D-03): on a dashboard with a saved dynamic view widget: `h.filter("dynamicView", <dvId>, "<dv column>", "eq", "<value>")`: the dv-backed widget narrows; the chip appears under the dv name with the AI tag; `h.clearFilter("dynamicView", <dvId>)` restores.

7. Clear all (D-07): set two manual filters (and draw a map shape if the map allows it), then `h.chatTurn("Clear the filters", "Cleared.", { ops: [{ op: "clear_filter" }] })`: every column filter clears (yours too), the drawn shape stays; the chat notes read "Cleared all filters (N widgets)." and "Drawn map shapes were left on." (if a shape exists); Revert brings both filters back.

8. Zero rows + notes (D-16, D-17): `h.chatTurn("Only zzz", "Filtered to zzz.", { ops: [{ op: "apply_filter", source: { kind: "table", id: <tableId> }, filters: [{ column: "<string col>", operator: "eq", value: "zzz_no_such_value", dataType: "string" }] }] })`: widgets show their normal empty state; under the answer a muted note "Filtered <table> to <col> = 'zzz_no_such_value' (N widgets)." and, within ~20 s, "The <col> filter on <table> matched no rows." with a "Clear this filter" button; click it: the filter is removed and the button disappears. Notes and button legible in light and dark. Also run `h.filter("table", <tableId>, "<numeric col>", "between", ["0", "10"])` and an in-list `h.filter("table", <tableId>, "<category col>", "in", ["<v1>", "<v2>"])`: chips read like the filter panel's own chips.

8b. Scoped widget (D-18): dashboard 12 has no widget with a filter selection, so on a TEST dashboard open a chart's settings and set its filter source selection to only one other widget (allow-list), save; then `h.chatTurn("Only <value>", "Done.", { ops: [{ op: "apply_filter", source: { kind: "table", id: <tableId> }, filters: [{ column: "<category col>", operator: "eq", value: "<value>", dataType: "string" }] }] })`: that chart does NOT narrow and gets no outline, the 'Filtered ...' note's widget count excludes it, and a muted note reads "1 widget with its own filter selection was not filtered." (light and dark). Restore the chart's selection afterwards. If you cannot set this up, reply "8b: not testable" — it is covered by unit test AAT-12 and recorded as such.

9. OPTIONAL live ask (skip is fine; free tier 20 requests/day/model; real model id; `AI_TIMEOUT_MS` >= 120000; restart the server after .env changes): ask "Show only <a value> <category col>" once. Report only: did a filter apply with the AI tag and outline (yes/no), did the answer mention it (yes/no), any error text. Optionally ask about a column that exists on two tables and report whether the two choice buttons appeared.

## Cleanup
- Restore any chart filter selection changed for 8b. Harness changes are unsaved; `__kbiAiHarness.discard()` or reload clears them.

## Reply format
One message: `approved` or a numbered issue list by step (with LIGHT/DARK verdict for steps 1, 2, 3, 6, 7, 8, 8b), then:
`8b: verdict | not testable`
`9: skipped` or `9: ran - filter+tag+outline yes/no, answer mentioned it yes/no, errors: <text>`
Or just `defer`.
