# 140-13 Operator UAT — results (automated run, 2026-10-21)

**How:** At the operator's request Claude ran the UAT. The live spike ran in the terminal (`npx tsx src/spikes/queryModeSpike.ts`); the dev API was restarted in query mode with a shell override (`AI_DATA_ACCESS=query`, which plain `dotenv.config()` does not override) and back; the visual steps were driven through the operator's signed-in Chrome over CDP (harness only, no provider request). The operator signed in; Claude never handled credentials and never read or edited `packages/server/.env`.
**Kinetica version (step 0):** 7.2.3.12 (same instance as the 139-14 UAT, recorded there 2026-10-20).
**Spike target:** http://172.31.0.22:8082, source `demo.nyctaxi`.
**Screenshots:** session scratchpad (not committed).

| Step | Light | Dark | Result |
|---|---|---|---|
| 0 Kinetica version | n/a | n/a | 7.2.3.12 |
| 1 live spike Q1-Q8 | n/a | n/a | PASS with caveats (see below): admin user, Q2/Q3 needed a slower SQL |
| 2 query mode on | n/a | n/a | PASS — log `dataAccess=query ... queryMaxRows=200 queryMaxChars=20000 queryTimeoutMs=30000 queryMaxPerAnswer=5`; boot sweep line OK |
| 3 "Ran N queries" | ✓ | ✓ | PASS — collapsed `ghost-sm` "Ran 3 queries" (aria-expanded false -> true); three `ai-chat-note muted ai-chat-query` lines "— 5 rows" / "— refused: only a single SELECT statement is allowed" / "— timed out"; toggle height 23px = every other chat button (23px); legible in both themes |
| 4 long SQL wrapping | ✓ | ✓ | PASS — large inline tile: 40-column SQL wraps (line 175px tall; scrollWidth == clientWidth up the chain; no page horizontal scroll). Small tile (temporary saved AI widget 6x10, ask bar + History + "Open conversation"): drawer `ai-drawer` line 338px tall, scrollWidth == clientWidth (463), drawer 479/479, no horizontal scroll |
| 5 markup literal (SC3) | ✓ | ✓ | PASS — markdown image, link to evil.test, `javascript:` link, `<img src=x onerror=alert(1)>`, `**bold**`, `# Heading`, `<script>` in the answer, a follow-up chip and the SQL line all render as literal text. 0 img/a/script elements, no bold/heading elements, no dialog. **No request to evil.test or `x`** (Playwright request listener + 250 resource-timing entries). Minor issue 1 below |
| 6 schema mode back | n/a | n/a | PASS — restarted without the override; log `dataAccess=schema` |
| 7 live Gemini ask in query mode | | | SKIPPED — dev `AI_MODEL` is still "Antigravity" (invalid id); deferred to Phase 142 live provider UAT |
| 8 deploy image (optional) | n/a | n/a | PASS — `docker build --target server -t kbi-server-140 .` exit 0; in the image `node --input-type=module -e` importing libpg-query -> loadModule -> parse('SELECT 1') printed 1; image removed afterwards |

## Step 1: spike Q1-Q8
CAVEAT: the spike user from `.env` is **admin**, not the non-admin `uat_analyst`; the spike's own "confirm this is the NON-ADMIN user" line was flagged. Non-admin grant behaviour stays covered by the 133 S7 spike; re-running as `uat_analyst` is optional (142).

| Q | Verdict | Detail |
|---|---|---|
| Q1 cap | PASS | rowCount=200, truncated=true, elapsed=202ms (envelope limit bounds returned rows; compute is bounded by the 30 s timeout) |
| Q2 timeout | PASS on rerun | First run FAIL ("ok?!"): the default `SPIKE_SLOW_SQL` (COUNT over a cross join of LIMIT 20000 x LIMIT 2000) finished in under 2 s because Kinetica computes a cross-join COUNT without enumerating pairs. Test-data issue, not a code defect. Rerun with `SPIKE_SLOW_SQL='SELECT COUNT(*) AS n FROM (SELECT fare_amount FROM demo.nyctaxi LIMIT 20000) a JOIN (SELECT fare_amount FROM demo.nyctaxi LIMIT 20000) b ON a.fare_amount + b.fare_amount > 50'`: "query timed out", taggedJobsRemaining=0, timeoutMs=2000 |
| Q3 cancel | PASS on rerun | same slow SQL: "query cancelled", taggedJobsRemaining=0 |
| Q4 writes | PASS | INSERT / CREATE TABLE AS / DELETE refused, sqlCallsForWrites=0 |
| Q5 dialect | PASS | All accepted dialect queries ran on Kinetica: APPROX_MEDIAN/PERCENTILE, STXY_CONTAINS/ST_MAKEPOLYGON, ST_DISTANCE, HOUR, DATEDIFF, TIMESTAMPADD, INTERVAL, CAST and `::`, UNION ALL, CTEs, FETCH FIRST, COUNT DISTINCT, CASE, HAVING, quoted "DEMO"."NYCTAXI". "PG-accepted but Kinetica-rejected: 0". No real analyst query was refused by the guard |
| Q6 error categories (D-18) | PASS | The model sees only categorized messages ("unknown column no_such_col; check the names with describe_table"; "Refused: table demo.nyctaxi_nope is not on this dashboard ..."); raw Kinetica text appears only in the local terminal. GROUP BY ROLLUP is accepted and runs. Categories were right for the cases probed, no pattern additions needed |
| Q7 quoted names | PASS | quoted upper "DEMO"."NYCTAXI" and lower "demo"."nyctaxi" both ok |
| Q8 profile | PASS | fare_amount rowCount=500000 distinct=756 nulls=0 topValues=0 (numeric, no top values by design); vendor_id rowCount=500000 distinct=5 nulls=0 topValues=5 |

## Gates (Task 1, c39318d)
- shared: 192 passed. web: 4953 passed + theme-guard 172. server: tsc clean.
- Server `test-gate` script printed **GATE FAILED**, solely on `lib.exportRunner.memory` (EXPMEM zip-backpressure 60 s timeout). It also fails alone and fails identically at the pre-phase commit 4536a0c, and no export code was touched in Phase 140, so it is classified **environmental** (this machine). The other failing files are the 8 known plus 3 isolation-only (auth.login-rbac, routes.exports, routes.management), all inside the known TD-V16-TEST-ISOLATION set. The script's own verdict was FAILED; the classification above is ours.
- Gap gate re-checked at Task 3: `grep -rnE "it\.fails|GAP-140-" packages/server/tests` empty; 140-10 and 140-11 SUMMARY frontmatter `gaps: []`.

## Issues
1. (minor, open, cosmetic) The query SQL line uses the UI font (Manrope Variable); its ligature renders `--` as an en dash. SQL text should use a monospace font or disable ligatures. The text itself is exact.
2. (minor, open) Spike default `SPIKE_SLOW_SQL` is too fast on Kinetica 7.2.3.12 (cross-join COUNT shortcut); change the default to a non-shortcut join (the rerun SQL above).
3. (minor, open) Spike user was admin, not the non-admin analyst; spike's own warning fired.

## Cleanup verified
Temporary AI widget 123 deleted (204); dashboard 12 widgets back to 117:map, 118:bar; AI session discarded; dev API back in schema mode.

## Not eyeballed / not run
- Live model adherence to the query-mode rules (own-reading only, aliases, caps): no provider run (step 7 skipped) -> Phase 142.
- Audit row `queries_json` from a live ask (step 7 sqlite check): not run; covered by server specs RQ-*.
- Non-admin grant behaviour in the spike: covered by 133 S7 only.
