# 141-14 Operator UAT steps

Plan 141-14 Task 2 (human-verify). Task 3 (UAT results + hand bookkeeping) runs after the operator replies.
Steps 0-11 make NO provider request and use NO AI quota (DEV harness only). Keep WRITES to the dashboard: use a TEST dashboard only.

## Gates (run by the executor on the integrated tree, 2026-10-21, sequentially)
GAP GATE: PASS
- Gap gate: `bash .planning/phases/141-keep-persist-ai-changes/141-14-gap-gate.sh` exit 0 (no parked/skipped proofs beyond the 7 allow-listed pre-141 lines; 141-01..13 SUMMARY each `gaps: []`).
- shared: tsc OK; vitest 203 passed (10 files)
- web: tsc OK; vitest --maxWorkers=4: 261 files passed, 1 skipped; 5047 tests passed, 1 skipped; theme-guard: 176 passed
- server: tsc OK; test-gate: 2608/2663 tests passed; GATE PASSED. 8 known-set files failing (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms); 2 more failed under load and pass alone (lib.exportRunner.memory, routes.schema-check = TD-V16-TEST-ISOLATION contamination).
- No provider or Kinetica call was made by the executor; packages/server/.env was not read.

## Known test-strength gaps (so you know where your eyes are the real proof)
- jsdom cannot prove: the cross-origin `X-Kbi-Dashboard-Version` header exposure (step 7), legibility / centring / button heights in LIGHT and DARK (steps 1, 5, 6, 8, 11), absence of a flash during the post-Keep swap (step 1), real WMS tiles (step 4) or real Kinetica DROPs of temp views (step 3).
- The SC3 race is proven with a stubbed foreign write only; steps 5 is the real two-session proof.
- The D-20 line "View on/off changes are not saved." is proven in jsdom only; step 11 is the real check.
- Several grep criteria in the 141 plans passed before the work (NEGREF-1 default-unchanged, `ai-keep` path count, `joinRefs` = 0) and are presence-only; the RED-first specs were the proof (see the 141-03/05/06/07/08 SUMMARYs).
- Several RED proofs were vacuous against their stubs (KH-3, WOV-1); other tests in the same file discriminate.
- Live provider behaviour with Keep is NOT covered here (Phase 142).

## Prerequisites
- Dev app running (`npm run dev`; servers already up on :4000 schema mode, :5173). `__kbiAiHarness` exists only in dev builds and only on a dashboard page.
- A TEST dashboard you are happy to have Keep write to: a copy of dashboard 12 (export/import) or a temp dashboard; Claude may restore afterwards. Dashboard 12 itself (map 117, bar 118, layer 23, table 1 `demo.nyctaxi`) is usable if Claude restores it (re-import/delete the added items) afterwards.
- Users (the operator signs each in; Claude never handles credentials):
  - A = an editor with Use AI (the CDP-driven main tab).
  - B = a second session of an editor: a second Chrome profile / incognito, OR (D-17: another TAB of the same user counts as foreign) a second tab of user A. Claude can use a second CDP browser context (operator signs in there) or a second tab.
  - C = a viewer without `dashboards:edit`. Operator-only unless an account is provided.
  - D = an editor WITHOUT `dynamic_views:manage` (create a role on the Roles page, then assign). Operator-only unless provided.
- Console: Option+Cmd+J; if Chrome warns about pasting, type `allow pasting` and Enter once. Then `const h = __kbiAiHarness; h.help();`
- Find ids (paste in the console):
```js
const base = "http://localhost:4000"; // API base in dev (VITE_API_URL if set)
const dashId = new URLSearchParams(location.search).get("dashboard");
const get = (p) => fetch(base + p, { credentials: "include" }).then(r => r.json());
console.table((await get(`/api/dashboards/${dashId}/layers`)).data.map(l => ({ layerId: l.id, tableId: l.table_id, mode: l.config.renderMode, lat: l.config.latColumn, lon: l.config.lonColumn })));
console.table((await get("/api/tables")).data.map(t => ({ tableId: t.id, table: `${t.schema}.${t.name}`, columns: Object.entries(t.columns).map(([c, ty]) => `${c}:${ty}`).join(", ") })));
```
  (If `dashId` is null, take the id from a `/api/dashboards/<id>/layers` request in the Network tab.)

## Verify
Do every VISUAL step in LIGHT and then DARK mode. Use the TEST dashboard only. `const h = __kbiAiHarness; h.help();` first. No step uses AI quota.

0. Record the Kinetica version (expected 7.2.3.12; say if different) and the test dashboard id.
1. SC4 Keep + reload (user A): with the `__kbiAiHarness` add a bar chart and a KPI (`h.addChart(...)`, `h.addWidget(...)`), add an AI heatmap layer to the map (`h.addHeatmap(...)`), edit one saved widget's title (`h.renameWidget`), remove one saved widget (`h.removeWidget`, then `h.approveRemoval()` and repeat), add one AI dynamic view and a chart bound to it (`h.addDynamicView(...)`, `h.addChartOnView(...)`; the 139-14 `chatTurn` op shapes). Note the bar counts. Click Keep: the dialog title is "Save AI changes?", the body shows the same counts and "Filters are not saved."; Save and Cancel have matching heights side by side (Save filled). Cancel -> nothing changes. Keep -> Save: Keep reads "Saving…" and both buttons are disabled briefly; then the bar disappears; no visible flash of missing or duplicated widgets; the chat keeps the conversation, has NO "Revert dashboard to this state" buttons, and ends with a muted "Changes saved.". Reload the page: every widget, layer and view is exactly as shown before the reload (positions included). Record "reload matches" yes/no and that "Filters are not saved." was seen.
2. Filters (D-13): before a Keep, drill-filter the chart bound to the AI view and set a table filter (`h.filter(...)`); Keep; both filters are still applied and the chip names the saved view; reload clears them. Other temp-id-keyed state (I8): before Keep open the info popup on the AI heatmap layer and pan/zoom the AI-added map; after Keep the popup is closed or shows the saved layer (never a dead temp layer), the new map keeps or cleanly resets its view, a chart filtered from an AI-added widget keeps its source highlight, and the console shows no error mentioning a negative id.
3. Temp views (D-15): before Keep `await fetch(base + "/api/ai/dynamic-view/list", { credentials: "include" }).then(r => r.json())` lists the `_kbi_ai_*` view; after Keep it lists none; the chart on the kept view shows data after a brief pending state.
4. Map tiles: a heatmap layer bound to an AI view (`h.bindLayer(...)`), then Keep: tiles render, and still render after changing a filter (both buildWmsParams sites, i.e. both tile paths; memory map-wms-is-separate-read-path). In DevTools Network the WMS URLs after Keep name the saved view, not `_kbi_ai_`.
5. SC3 409 (users A and B, two sessions): both open the test dashboard; B renames a widget; A makes an AI change and clicks Keep -> the conflict dialog reads "Someone else changed this dashboard since you started. Your AI changes weren't saved.", with Stay (filled, focused) and "Discard and reload the latest" (danger). Stay: Keep stays disabled with the muted note; nothing of A's was saved (B reloads and sees only B's rename). Keep again is impossible; "Discard and reload the latest": A sees B's rename and no AI changes. Then: A toggles a layer eye (own write) and makes an AI change -> Keep succeeds; B toggles an eye after A loaded -> A's Keep gets the 409.
6. Rights (SC2): user C (viewer) with an AI change sees only Discard and "Only editors can save AI changes". User D (no "Manage dynamic views") adds an AI view and clicks Keep -> the bar shows "You can't save these changes: saving dynamic views needs the Manage dynamic views permission." and the session is intact. As user C run in the console a forged request: `fetch(base + "/api/dashboards/" + dashId + "/ai-keep", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baselineVersion: 0, dynamicViews: { add: [], remove: [] }, layers: { add: [], edit: [], remove: [] }, widgets: { add: [], edit: [], remove: [<a saved widget id>] } }) }).then(r => r.status)` -> 403 and the widget still exists after reload.
7. Headers in a real browser: in DevTools Network, a widget PATCH (drag a widget, or rename via configure) response shows `X-Kbi-Dashboard-Version`, and `access-control-expose-headers` lists it (confirms the cross-origin read the 409 logic needs).
8. Leave dialog: with an AI change, click another dashboard: the dialog says "Keep them first if you want to save them." (no "coming soon").
9. Join note (139 D-21): Keep an AI view with a join; a muted note after "Changes saved." says saved views read joined tables without their filters.
10. Audit: `sqlite3 packages/server/data/kinetica.db "SELECT outcome, counted, question, changes_json FROM ai_audit WHERE outcome LIKE 'kee%' ORDER BY id DESC LIMIT 5"` shows kept / keep_conflict / keep_denied rows with counted 0, empty question, counts + ids only.
11. View on/off (D-20, LIGHT and DARK): with the harness, toggle a saved dynamic view off (a dynamicView `enabled: false` patch op via `h.turn`/`h.chatTurn`) and make one AI widget change; Keep: the dialog shows the extra line "View on/off changes are not saved." (and does NOT show it in step 1's Keep, where no view was toggled); after Save the chat note reads "Changes saved. View on/off changes are not saved."; the view stays off in this tab and is back on after reload.

## Cleanup
- Delete the test dashboard or re-import the original (if dashboard 12 was used, Claude removes the added widgets/layers/views and restores the renamed/removed ones). Remove the test role for user D and test users created. `__kbiAiHarness.discard()` or reload clears unsaved harness changes. Drop any leftover `_kbi_ai_*` views (step 3 list).

## Reply format
One message: `approved` or a numbered issue list by step (LIGHT/DARK verdicts for steps 1, 5, 6, 8 and 11), then:
`0: Kinetica version <x.y.z>, test dashboard id <n>`
`1: reload matches yes/no; "Filters are not saved." seen yes/no`
`2-4, 7, 9, 10: pass/fail (or skipped with reason)`
`11: line appeared only when a view was toggled yes/no`
Or `defer` (no Kinetica sign-in / no second user): the plan pauses and the two requirements stay Pending.
