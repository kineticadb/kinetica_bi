# 142-10 Operator UAT steps

Plan 142-10 Task 2 (human-verify, multi-day per the Gemini quota plan). Task 3 (results file) runs after the operator replies. 142-11 runs the Ollama half and the bookkeeping.

## Gates
GAP GATE: PASS
- Gap gate: `bash .planning/phases/142-generate-audit-viewer-live-provider-proofs/142-gap-gate.sh` exit 0 (after the four `gaps: none` lines in 142-03/07/08/09 were normalised to `gaps: []`, commit b47d47b).
- shared: tsc OK; vitest 210 passed (10 files)
- server: tsc OK; test-gate: 2687/2744 tests passed; 12 files failing: 8 known-set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms); 3 more pass alone (layers, routes.exports, routes.filter-materialize = TD-V16-TEST-ISOLATION contamination); lib.exportRunner.memory failed in the gate's isolation re-run (known environmental timing case) but PASSES alone on a manual rerun (8/8). Verdict: gate reports FAILED only on that one file, which is environmental; every failing file is in the known set or passes alone.
- web: tsc OK; vitest --maxWorkers=4: 270 files passed, 1 skipped; 5113 tests passed, 1 skipped; theme-guard: 182 passed
- No provider or Kinetica call was made by the executor; packages/server/.env was not read.

## Known test-strength gaps (so you know where your eyes are the real proof)
- jsdom cannot prove: legibility, LIGHT/DARK look, band geometry looking right, live model adherence, real Kinetica DROPs of `_kbi_ai_` views, real logout/restart sweeps, or Ollama behaviour.
- 142-01: PENDVIS-5/6 cannot discriminate red-first; reported, not altered.
- 142-02: GENNUDGE-1 and GENNUDGE-4 assert unchanged behaviour and cannot discriminate by themselves; GENNUDGE-2/3/5/6 are the discriminating proofs.
- The 24 h TTL sweep is proven by specs only (G3c cannot wait 24 h).
- Tool count wording: 18 tools (schema mode) / 20 (query mode).

## Prerequisites
- Dev app running (`npm run dev` in packages/server, `npx vite` in packages/web; already up on :4000 and :5173). `__kbiAiHarness` exists only in dev builds and only on a dashboard page: `const h = __kbiAiHarness; h.help();` (listAiViews, chatTurn, aiViews, peekAiView).
- Chrome on CDP 127.0.0.1:9333 with a separate scratchpad profile; playwright-core installed in the scratchpad (in auto mode the operator may need to allow `npm i playwright-core` and `node <scratchpad>/*`). The operator signs in each user; Claude never handles credentials.
- Users: admin (has audit:view; generates and keeps); a designer in a second profile (`uat_designer` or any designer: visibility check); `uat_analyst` (no audit:view).
- A TEST dashboard copy of dashboard 12 for asks that Keep.
- Console: `const base = "http://localhost:4000";` (VITE_API_URL if set). Chrome may warn about pasting: type `allow pasting`.
- Operator's `.env` for Gemini: `AI_ENABLED=true`, `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `AI_MODEL=gemini-3-flash-preview` (replaces the invalid `Antigravity`), `AI_TIMEOUT_MS=120000`, `AI_DATA_ACCESS=schema`, `AI_MAX_ANSWERS_PER_DAY=<today's budget>`. Restart the server after every change (`tsx watch` does not reload .env).
- SQLite at `packages/server/data/kinetica.db`.

## Gemini quota plan
The free tier allows about 20 requests per day per model; one ask uses 2-5 requests, a generate 4-10 (MEDIUM estimates).

| Day | Steps | Approx. requests | Notes |
|---|---|---|---|
| 1 | G0, G1, G2, G3 | 16-19 | AI_MAX_ANSWERS_PER_DAY=5 |
| 2 | G3b, G3c, G4 | 2 + ~12 | G3b/G3c are cancelled generations, ~1 request each |
| 3 | G5, G6, G7 | ~11 | G6 is harness only, 0 requests |
| 4 | G8 (query mode) | ~10-12 | |
| 5-7 | G10 S6 spike `--runs 1` per day | 9-13 each | 3 days for >= 20 clean trials |

Paid/billing-enabled key path: everything in one sitting with S6 `--runs 3`. G9 needs no provider requests and can run any day after G2/G3.

## Gemini steps
Visual steps in LIGHT and then DARK. TEST dashboards only for asks that Keep.

G0. Setup: `.env` per Prerequisites, restart. `fetch(base + "/api/ai/config", { credentials: "include" }).then(r => r.json())` shows enabled, provider openai-compatible, model gemini-3-flash-preview, no key. Record the Kinetica version.
G1. Audit access (no quota, LIGHT+DARK): admin sees "AI activity" after Roles; the page shows "Query results are never logged."; table headers legible; as uat_analyst no nav item and `fetch(base + "/api/ai/audit", { credentials: "include" }).then(r => r.status)` -> 403.
G2. SC1 generate + refine + Keep (LIGHT+DARK): New Dashboard -> tick "Generate from a table" -> Table demo.nyctaxi -> "What do you want to see?" = "fares and tips by payment type" -> Generate dashboard. The dashboard opens, the first ask starts by itself once (one /api/ai/ask in the Network tab), the pending note or change bar shows, 4-8 widgets appear: KPIs on top, a time trend and breakdowns in the middle, a map with a heatmap layer (nyctaxi has pickup lat/lon), a full-width records table at the bottom, AI Assistant on the right; columns suit the data (operator verdict). Second profile (designer): the dashboard is NOT in their list and `?dashboard=<id>` shows the unavailable banner. Refine: ask "Replace the pie chart with a bar chart by vendor". Keep -> Save. Reload: same widgets in the same places, no 1x1 widget; the list row no longer says "Not kept yet"; the designer now sees it.
G3. SC2 Discard: generate another (no prompt). If the AI made no dynamic view, ask "Add a dynamic view of average fare by hour and chart it". Note the id. Before: `h.listAiViews()` shows its `_kbi_ai_` view(s); `sqlite3 packages/server/data/kinetica.db "SELECT (SELECT COUNT(*) FROM dashboards WHERE id=<id>),(SELECT COUNT(*) FROM widgets WHERE dashboard_id=<id>),(SELECT COUNT(*) FROM dashboard_layers WHERE dashboard_id=<id>),(SELECT COUNT(*) FROM dashboard_dynamic_views WHERE dashboard_id=<id>),(SELECT COUNT(*) FROM dashboard_tables WHERE dashboard_id=<id>),(SELECT COUNT(*) FROM ai_session_views WHERE dashboard_id=<id>),(SELECT COUNT(*) FROM ai_audit WHERE dashboard_id=<id>)"`. Change bar Discard -> "Discard this dashboard?" (LIGHT+DARK legible, Cancel focused) -> Discard: back on the list, row gone. After: the same sqlite3 query reads 0|0|0|0|0|0|N (audit rows kept); open any other dashboard and `h.listAiViews()` shows none for that dashboard.
G3b. D-06 + D-07 (≈1 request each): generate, press Cancel at once: "Cancelled, nothing changed", empty dashboard with the pending note and "Discard dashboard". Back to the list ("Not kept yet" shown); New Dashboard -> Generate again -> the message `You already have a generated dashboard that isn't kept yet: "<name>". Keep or discard it first.` with "Open it" / "Discard it" (matched heights); "Discard it" removes it.
G3c. Sweeps (cancelled generations): one unkept -> logout -> login: gone. One unkept -> operator restarts the server: gone, and the server log has `[ai] boot sweep: deleted 1 unkept generated dashboards`. (The 24 h TTL is proven by specs only.)
G4. Core asks on the TEST dashboard (D-25a): "Add a bar chart of trip count by vendor" (applied; Follow-ups chips present = trailer adherence); click one follow-up; "Rename that chart to Trips per vendor and make it a line chart"; "Remove the records table" (asks to confirm once, then removes); an ambiguous ask "Show fares by type" (offers Choices or asks a clarification); "Revert dashboard to this state" on an earlier answer. Record per ask: applied/skipped, trailer present yes/no.
G5. Filters and views (D-25b): "Filter to payment type <a real value, exact casing from G6 step 0 or the data>" -> AI chip, charts and map tiles narrow; "Make a dynamic view of average tip by hour and chart it" -> view builds; on a dashboard with a SAVED dynamic view: "Remove the saved view <name>" asks once (D-25 139) before removing.
G6. Joins (no quota, harness; D-27): step 0 read-only `SELECT DISTINCT vendor_id FROM demo.nyctaxi`; ask the operator to APPROVE creating `uat.vendor_dim (vendor_id VARCHAR(4), vendor_name VARCHAR(32))` with the real codes minus one (so LEFT has unmatched rows); after approval create, register in Datasets, add to the TEST dashboard. 139 step 8: operator sets `AI_DV_PREFLIGHT_TIMEOUT_MS=2000`, restart; a deliberately expensive join (self-join of nyctaxi via the harness) -> refused with the timeout message and no `/* kbi-ai:aidv-` job left in `/admin/show/jobs` (if it builds too fast, record the time and skip per 139-14 wording). 139 step 8b: filter on the dim, INNER vs LEFT join views (`peekAiView`): INNER rows <= LEFT rows, LEFT shows the unmatched vendor. 141 step 9: Keep a joined view -> the muted join note after "Changes saved.".
G7. Model-driven Keep (141 follow-up): an AI ask adds a widget on the TEST dashboard -> Keep -> reload matches; the audit shows a kept row.
G8. Query mode (D-25c): operator sets `AI_DATA_ACCESS=query`, restart. "What's the average tip by payment type?" -> answered in words with "Ran N queries"; "Which columns would make good breakdowns?" -> uses get_column_profile (check the tools in the AI activity detail); optionally one Generate in query mode. `sqlite3 packages/server/data/kinetica.db "SELECT queries_json FROM ai_audit WHERE queries_json IS NOT NULL ORDER BY id DESC LIMIT 3"` -> SQL, rowCount, durationMs, outcome only; no row values. Operator sets schema mode back.
G9. SC3 audit content (no quota, LIGHT+DARK): rows for G2-G8 with Kind Ask / Generate / Keep; outcome filter "Kept" and each keep_* value; dashboard filter shows "Deleted dashboard #<G3 id>" muted with no link; a Keep row reads "Kept N added, N edited, N removed"; an ask detail shows question, answer, tools, queries (G8), provider/model, tokens, data access, allow-list version; Previous/Next and "Page X of Y · N entries" correct; a timeout row (if any) shows the incomplete-tools line.
G10. S6 spike (operator's terminal, per the quota plan): `cd packages/server && read -s AI_API_KEY && export AI_API_KEY` then `AI_ENABLED=true AI_PROVIDER=openai-compatible AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ AI_MODEL=gemini-3-flash-preview AI_TIMEOUT_MS=120000 npx tsx src/spikes/toolCallSpike.ts --runs 1 --rpm 6 --out ./s6-gemini-<day>.json` (one run per quota day; `--runs 3` on a paid key). Paste the matrix row / verdict lines (no key) into the reply. The registry has 18 tools in schema mode.

## Ollama steps (142-11)
O0. Approvals and start: operator sets Docker Desktop to 8 CPUs and >= 8 GB RAM, then APPROVES. Run `docker run -d --name kbi-ollama -v kbi-ollama:/root/.ollama -p 127.0.0.1:11434:11434 -e OLLAMA_CONTEXT_LENGTH=16384 -e OLLAMA_NUM_PARALLEL=1 -e OLLAMA_KEEP_ALIVE=30m ollama/ollama`, then (second approval, ~4.7 GB) `docker exec kbi-ollama ollama pull qwen2.5:7b-instruct`. Operator sets `.env` (AI_BASE_URL=http://localhost:11434/v1, AI_MODEL=qwen2.5:7b-instruct, AI_TIMEOUT_MS=600000, AI_DATA_ACCESS=schema; no key) and restarts the server.
O1. Probe: `cd packages/server && AI_ENABLED=true AI_PROVIDER=openai-compatible AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen2.5:7b-instruct AI_TIMEOUT_MS=600000 npx tsx src/spikes/toolCallSpike.ts --raw --runs 1 --rpm 30 --out <scratchpad>/s6-ollama-probe.json`; then `docker exec kbi-ollama ollama ps` shows CONTEXT 16384 and 100% CPU. Record whether the adapter's tool_choice/stream_options are accepted (no HTTP 400) and whether tool calls arrive as tool_calls (not plain content).
O2. S6 (unattended, may take hours): same env, `--runs 3 --rpm 30 --out <scratchpad>/s6-ollama.json`; if native tool calling fails, one extra run with `--mode json`. Record clean trials, valid-call %, multi-turn, verdict, per-call latency.
O3. App core set (LIGHT; DARK only for anything new on screen): on the TEST dashboard "Add a bar chart of trip count by vendor" (applied? Follow-ups trailer present?) and an edit ask ("Rename it to Trips per vendor"); "Filter to payment type <real value>" (chip + narrowing); Generate from demo.nyctaxi (record total time and round count; pass if 4-8 widgets arrive, partial if it times out at 600 s or builds fewer than 4); Keep it if it arrived; then generate another (or reuse a cancelled one) and Discard it and run the G3 sqlite3 query: 0|0|0|0|0|0|N.
O4. AI activity shows the Ollama rows with provider openai-compatible / model qwen2.5:7b-instruct and their outcomes.
O5. Cleanup: operator decides whether to keep the model; default `docker rm -f kbi-ollama && docker volume rm kbi-ollama && docker rmi ollama/ollama`; `docker ps -a | grep kbi-ollama` and `docker volume ls | grep kbi-ollama` print nothing. Operator switches `.env` back to Gemini or sets AI_ENABLED=false and restarts.

## Cleanup
- Drop `uat.vendor_dim` (and the `uat` schema if created only for this) with operator approval and unregister it in Datasets.
- Delete TEST dashboards.
- Operator restores `AI_DV_PREFLIGHT_TIMEOUT_MS`, `AI_DATA_ACCESS=schema` and `AI_MAX_ANSWERS_PER_DAY`.
- Docker cleanup is in the Ollama section (O5).

## Reply format
Per step: `G<n>: pass|fail|skipped (reason)` with LIGHT/DARK where asked (G1, G2, G3, G3b, G9). Issues numbered by step. Include the Kinetica version, dashboard ids, sqlite3 before/after outputs (G3), trailer presence per ask (G4), one queries_json sample (G8) and the S6 verdict lines (no key).
