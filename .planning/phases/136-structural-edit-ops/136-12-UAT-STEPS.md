# 136-12 Operator UAT steps (deferred)

**Status:** deferred 2026-10-14 (no Kinetica access); RUN 2026-10-14 by Claude driving the operator's signed-in Chrome over CDP (dashboard 12) — results in 136-12-UAT-RESULTS.md. Fixed here after that run: API base, resource-timing buffer, tile lookup. Run these before closing Phase 136.
Plan 136-12 Task 1 (WMS `VAL_ATTR` tile check) and Task 2 (visual/layout/undo check) are both covered here.
Task 3 (bookkeeping + SUMMARY) runs after the operator replies.

All steps run in the browser console. No cURL, no cookies leave the browser.

## Before you start
- Run the app in dev mode (Vite dev). `__kbiAiHarness` only exists in dev builds.
- Open a dashboard with: a saved bar chart, a map with a saved heatmap layer, and a table with lat/lon columns.
- Open the console (⌥⌘J). If Chrome warns about pasting, type `allow pasting` and press Enter once.

## Step 1: find your ids and column names
```js
const h = __kbiAiHarness; h.help();
const urls = performance.getEntriesByType("resource").map(e => e.name);
const base = "http://localhost:4000"; // API_BASE in dev (VITE_API_URL if set)
const dashId = new URLSearchParams(location.search).get("dashboard") ?? urls.map(u => u.match(/\/api\/dashboards\/(\d+)\/layers/)).filter(Boolean).pop()?.[1];
const get = (p) => fetch(base + p, { credentials: "include" }).then(r => r.json());
const layers = (await get(`/api/dashboards/${dashId}/layers`)).data;
console.table(layers.map(l => ({ layerId: l.id, tableId: l.table_id, mode: l.config.renderMode, lat: l.config.latColumn, lon: l.config.lonColumn })));
const tables = (await get("/api/tables")).data;
console.table(tables.map(t => ({ tableId: t.id, table: `${t.schema}.${t.name}`, columns: Object.entries(t.columns).map(([c, ty]) => `${c}:${ty}`).join(", ") })));
```
Note down: the bar id and map id (the `saved widgets:` line of the help text), the saved heatmap's `layerId`, its `tableId`, `lat` and `lon`, and one numeric column on that table (e.g. `fare_amount`).
If `__kbiAiHarness` is undefined, you are not on a dashboard page or not on the dev build.

## Step 2: add the AI heatmap (replace the placeholder values)
```js
performance.setResourceTimingBufferSize(5000); performance.clearResourceTimings(); // the browser stops recording after 250 requests; map tiles fill that fast
const r = h.addHeatmap({ tableId: 12, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude", style: { colormap: "plasma", blurRadius: 8, valueColumn: "fare_amount" }, name: "AI heat" });
const aiLayerId = r?.entries[0].op.tempId; aiLayerId;
```
Expected: a console table with `add_layer` and `applied`, a negative number (the AI layer id), heat on the map.
- Warning "No map on this dashboard": run `h.addChart("map", "Trips map")` first, then rerun.
- Warning "More than one candidate map": pass the map id as a second argument, e.g. `h.addHeatmap({...}, 72)`.

## Step 3: tile check (VAL_ATTR weighted vs control)
```js
const tileUrl = performance.getEntriesByType("resource").filter(e => e.initiatorType === "xmlhttprequest").map(e => e.name).filter(u => u.includes("/api/wms") && u.includes("VAL_ATTR=")).pop();
for (const [label, url] of [["weighted", tileUrl], ["control", tileUrl.replace(/([?&])VAL_ATTR=[^&]*&?/, "$1")]]) {
  const res = await fetch(url, { credentials: "include" }); const blob = await res.blob();
  console.log(label, res.status, blob.type, blob.size);
  const img = new Image(); img.src = URL.createObjectURL(blob); img.title = label + " (click to close)";
  Object.assign(img.style, { position: "fixed", zIndex: 99999, top: "10px", left: label === "weighted" ? "10px" : "340px", width: "320px", border: "2px solid", background: "white" });
  img.onclick = () => img.remove(); document.body.appendChild(img);
}
```
Expected: `weighted 200 image/png <size>` and `control 200 image/png <size>`, and two pinned images (left weighted, right control) with visible heat. Click an image to close it.
If `tileUrl` is undefined, pan the map slightly and paste again.

**Blur:** AI heatmaps default to blur 5; saved heatmaps without a blur use Kinetica's default. Is the difference noticeable?

## Step 4: visual checks (☀/🌙 = check in light AND dark)
Replace `60` with your bar id and `33` with your saved heatmap layer id.

**4.1 Heatmap ☀/🌙.** The legend shows an "AI heat" row; its eye hides and shows the layer. Then:
```js
h.editHeatmap(aiLayerId, { colormap: "inferno", blurRadius: 16, opacity: 0.6 })
h.editHeatmap(33, { colormap: "viridis" })
```
Both layers redraw with the new colours.

**4.2 Badges ☀/🌙.**
```js
h.editChart(60, { aggregation: "max", color: "teal" })
```
The numbers change, the bar turns teal, and an "AI edited" pill appears. Both pills ("AI edited" and "AI added") are readable.

**4.3 Layout** (use your table id and real columns):
```js
h.addChart("bignumber", "KPI", 12, { metric: "fare_amount", aggregation: "sum" })
h.addChart("bar", "Bar", 12, { metric: "fare_amount", aggregation: "avg", groupByColumn: "payment_type" })
h.addChart("records", "Rows", 12, {})
```
Expected: the KPI is small, the bar about half width, records full width; gaps fill first, then below; no overlaps; "AI added" pills.
`h.state().layout` lists every widget's position. Swap two with `h.setLayout([{id:60,x:..,y:..,w:..,h:..}, {id:-2,x:..,y:..,w:..,h:..}])`.
If a default size feels wrong, note the widget type and the size you'd prefer.

**4.3b Map on a dashboard with no map ☀/🌙** (open such a dashboard, redo steps 1–2 first):
```js
h.addChart("map", "Trips map")
h.addHeatmap({ tableId: 12, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude" })
```
A large map, no overlap, the right basemap per theme, visible heat.

**4.4 Removal** (saved widget ids):
```js
h.removeWidget(60)                          // asks for confirmation, removes nothing
h.approveRemoval(); h.removeWidget(60)      // removes it
h.removeWidget(<another saved id>)          // removes without asking again
h.discard(); h.removeWidget(60)             // asks again
```

**4.5 Undo:**
```js
h.revert(-1)                                   // exactly the saved dashboard
h.forward(<last index from the turn table>)    // all AI changes come back
h.discard()                                    // everything clears
```
Reload the page: nothing was saved.

## What to report back
- The two Step 3 lines (`weighted …`, `control …`), "heat visible yes/no" for each, and the blur observation.
- Then "approved", or a numbered list of issues by step, with light/dark verdicts for 4.1, 4.2 and 4.3b.

After the reply: spawn the 136-12 continuation (Task 3: hand bookkeeping of REQUIREMENTS/ROADMAP/STATE/PROJECT, 136-12-SUMMARY incl. fix 5233a6e), then the Phase 136 verifier writing to `.planning/phases/136-structural-edit-ops/136-VERIFICATION.md`.
