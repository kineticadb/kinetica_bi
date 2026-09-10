---
phase: 18-spatial-spike-and-endpoint
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/wkbSpike.ts
  - kinetica_bi/server/package.json
  - .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md
autonomous: false
requirements:
  - SPATIAL-V14-03
must_haves:
  truths:
    - "Operator has run WKB proximity probes against deployed Kinetica with their own BI-user credentials"
    - "18-SPIKE-NOTES.md exists; documents either (a) verbatim WKB query that returned non-empty distance-ordered rows OR (b) the conversion wrapper required (e.g. ST_GEOMFROMWKB) with verbatim probe output"
    - "18-SPIKE-NOTES.md records the operator's Kinetica version, schema, and the actual WKB column name used in the spike (so 18-02's WKB SQL builder targets a real column type)"
    - "Status decision is unambiguous: STXY_DISTANCE works on WKB column directly | STXY_DISTANCE requires wrapper | a different function name applies | NONE worked (P1 GATE FAIL)"
  artifacts:
    - path: ".planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md"
      provides: "Locked WKB function decision with verbatim probe output and downstream consequence for Plan 18-02"
      contains: "## WKB Probe A, ## WKB Probe B, ## WKB Probe C, ## Decision, ## Caveats"
    - path: "kinetica_bi/server/src/wkbSpike.ts"
      provides: "Operator-runnable spike script (npm run wkb-spike) that issues WKB proximity probes and prints raw output"
      min_lines: 60
  key_links:
    - from: ".planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision"
      to: "Plan 18-02 buildWkbQuery SQL template"
      via: "Spike outcome dictates SQL string — STXY_DISTANCE direct call OR wrapped via ST_GEOMFROMWKB OR different function entirely"
      pattern: "Decision.*STXY_DISTANCE|Decision.*ST_GEOMFROMWKB|Decision.*ST_DISTANCE"
    - from: ".planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision"
      to: "Plan 18-03 POST /api/info/query WKB branch"
      via: "Endpoint cannot route spatialMode='wkb' until this plan commits a decision"
      pattern: "spatialMode.*wkb"
---

<objective>
Operator runs WKB spatial-proximity probes against deployed Kinetica using their own BI-user credentials, and records the function-name + argument-types decision in `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`. This plan is the **P1 GATE** for Phase 18: Plans 18-02 (SQL builders) and 18-03 (endpoint) cannot define the WKB SQL template until this spike commits a decision.

Purpose: SPATIAL-V14-03 explicitly states the WKB function name and argument types are unconfirmed. Candidate hypothesis: `STXY_DISTANCE(wkb_col, click_lon, click_lat)` works on WKB columns directly because Kinetica's binary geometry is often a drop-in for WKT-context functions. This MUST be confirmed empirically before the endpoint's WKB branch is written.

Output: A spike runner script (`kinetica_bi/server/src/wkbSpike.ts`, modeled after the existing `kinetica_bi/server/src/wmsSpike.ts`) and a `18-SPIKE-NOTES.md` file with verbatim probe output and a definitive decision.

Pattern model: `.planning/milestones/v1.3-phases/13-spikes-and-endpoint/13-01-spike-runner-PLAN.md` (operator-driven spike with pre-baked probe commands; outcome locks downstream SQL templates).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md

# Reference: existing operator-driven spike pattern (Phase 13)
@.planning/milestones/v1.3-phases/13-spikes-and-endpoint/13-01-spike-runner-PLAN.md
@.planning/milestones/v1.3-phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md

# Reference: existing spike runner (Phase 11) — script structure to mirror
@kinetica_bi/server/src/wmsSpike.ts

<interfaces>
<!-- This plan does NOT consume any TS module interfaces — it is operator-driven -->
<!-- and produces a markdown decision file + a CLI runner script. -->

Environment variables operator must have set in `.env`:
- KINETICA_URL (e.g. http://172.31.0.22:8082/gpudb-0 — same value used by Phase 11+13 spikes)
- KINETICA_USERNAME (operator's BI username — password mode probe uses Basic auth)
- KINETICA_PASSWORD (operator's BI password)

Probe SQL templates the operator runs against a real WKB-typed column:
- Probe A (direct STXY_DISTANCE on WKB):
    SELECT STXY_DISTANCE(<wkb_col>, <click_lon>, <click_lat>) AS dist FROM <schema>.<table> ORDER BY dist ASC LIMIT 5
- Probe B (ST_DISTANCE with explicit wrap to point):
    SELECT ST_DISTANCE(<wkb_col>, ST_GEOMFROMTEXT('POINT(<click_lon> <click_lat>)')) AS dist FROM <schema>.<table> ORDER BY dist ASC LIMIT 5
- Probe C (GEODIST against a centroid extraction — fallback if A and B both fail):
    SELECT GEODIST(STX(<wkb_col>), STY(<wkb_col>), <click_lon>, <click_lat>) AS dist FROM <schema>.<table> ORDER BY dist ASC LIMIT 5

Click-point reference values (operator can swap with values that hit their actual data):
- clickLon = -73.95 (NYC area; works against demo.nyctaxi if WKB column exists)
- clickLat = 40.75
- If operator's data is elsewhere, they substitute lon/lat that hits a row inside their bbox

Pass criterion per probe: HTTP 200 + body.status="OK" + non-empty data with at least one numeric `dist` column.
Fail criterion: HTTP 400 + body.status="ERROR" + body.message naming an "unknown function" / "type mismatch" / "invalid argument type" / "geometry conversion".
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write WKB spike runner script (kinetica_bi/server/src/wkbSpike.ts) + npm script wiring</name>
  <files>kinetica_bi/server/src/wkbSpike.ts, kinetica_bi/server/package.json</files>
  <read_first>
    - kinetica_bi/server/src/wmsSpike.ts (existing spike runner — PATTERN to mirror byte-for-byte: dotenv config, basic-auth header, runSql helper, sectioned probe blocks, summary block at end)
    - kinetica_bi/server/package.json (read the "scripts" block — wms-spike is registered there; wkb-spike will be added alongside)
    - .planning/phases/18-spatial-spike-and-endpoint/ (verify path exists; this is the directory the spike notes will live in after Task 2)
  </read_first>
  <action>
    Create `kinetica_bi/server/src/wkbSpike.ts` modeled exactly on `kinetica_bi/server/src/wmsSpike.ts`. The file is a one-shot tsx CLI script — NOT part of the Express app.

    Required structure (copy wmsSpike.ts header + helpers verbatim, then replace the probe bodies):

    1. Header comment block: file purpose, USAGE (`cd kinetica_bi/server && npm run wkb-spike`), OUTPUT (stdout lines listing each probe + decision banner), NOT-PART-OF-APP marker.

    2. Imports + dotenv.config() + KINETICA_URL/USERNAME/PASSWORD env-var checks (paste verbatim from wmsSpike.ts:17-31).

    3. basicAuth + redactedUrl helpers (paste verbatim from wmsSpike.ts:33-38).

    4. `rawFetch(url, options)` and `runSql(sql)` helpers (paste verbatim from wmsSpike.ts:42-71).

    5. ── Operator setup section ──
       The spike needs a real schema/table/wkb-column to probe against. Read these at the top of the script (after env-var checks) from process.env:
         - WKB_PROBE_SCHEMA  (e.g. "demo")
         - WKB_PROBE_TABLE   (e.g. "nyctaxi_wkb")
         - WKB_PROBE_COLUMN  (e.g. "geom" — the WKB-typed column)
         - WKB_PROBE_LON     (e.g. "-73.95" — click longitude)
         - WKB_PROBE_LAT     (e.g. "40.75"  — click latitude)
       If any are missing, log an error message instructing the operator to add them to `.env` and exit 1 with the example template:
         WKB_PROBE_SCHEMA=demo
         WKB_PROBE_TABLE=nyctaxi_wkb
         WKB_PROBE_COLUMN=geom
         WKB_PROBE_LON=-73.95
         WKB_PROBE_LAT=40.75
       Console.log a banner: `[wkb-spike] Probing ${schema}.${table}.${column} at (${lon}, ${lat})`.

    6. ── Probe A: STXY_DISTANCE direct on WKB ──
       Build SQL string:
         const sqlA = `SELECT STXY_DISTANCE(${col}, ${lon}, ${lat}) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
       Call `runSql(sqlA)`. Log: `=== Probe A: STXY_DISTANCE(<wkb_col>, lon, lat) ===` then echo the SQL, HTTP status, and the FULL `JSON.stringify(result.body)` output (do NOT truncate — operator needs verbatim error messages for the spike notes).

    7. ── Probe B: ST_DISTANCE with ST_GEOMFROMTEXT wrapper ──
       Build SQL string:
         const sqlB = `SELECT ST_DISTANCE(${col}, ST_GEOMFROMTEXT('POINT(${lon} ${lat})')) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
       Call `runSql(sqlB)`. Log section banner, SQL, HTTP status, and full body.

    8. ── Probe C: GEODIST after STX/STY centroid extraction ──
       Build SQL string:
         const sqlC = `SELECT GEODIST(STX(${col}), STY(${col}), ${lon}, ${lat}) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
       Call `runSql(sqlC)`. Log section banner, SQL, HTTP status, and full body.

    9. ── Summary section ──
       For each probe, classify the outcome:
         - PASS = result.ok === true AND result.body.status === "OK" (or the upstream success-shape Kinetica returns) AND the result includes a `dist`-shaped numeric column.
         - FAIL = result.ok === false OR body.status === "ERROR".
       Log a final block:
         === SPIKE SUMMARY ===
         Probe A (STXY_DISTANCE direct):     PASS | FAIL — <one-line reason>
         Probe B (ST_DISTANCE + ST_GEOMFROMTEXT): PASS | FAIL — <one-line reason>
         Probe C (GEODIST + STX/STY):        PASS | FAIL — <one-line reason>
       Append the recommendation:
         [wkb-spike] Recommended path: <Probe A | Probe B | Probe C | NONE — escalate>
         [wkb-spike] Done. Now run Task 2 to record findings in 18-SPIKE-NOTES.md.

    10. Update `kinetica_bi/server/package.json` "scripts" block to add the new entry (preserve the existing wms-spike entry verbatim):
        "wkb-spike": "tsx src/wkbSpike.ts"

    Anti-patterns to avoid:
    - Do NOT truncate body output (operator needs verbatim error messages).
    - Do NOT add try/catch around the whole script — let it crash with a stack trace if env vars are misconfigured (operator-friendly debugging).
    - Do NOT execute any of the probes from this task — Claude only WRITES the script. Operator runs it in Task 2.
    - Do NOT create the 18-SPIKE-NOTES.md file in this task — that is Task 3 after operator output is captured.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/wkbSpike.ts` exists
    - File contains the literal string "STXY_DISTANCE" (Probe A)
    - File contains the literal string "ST_GEOMFROMTEXT" (Probe B)
    - File contains the literal string "GEODIST" (Probe C)
    - File contains `import dotenv from "dotenv"` and `dotenv.config()` (env-var loading)
    - File reads `process.env.WKB_PROBE_SCHEMA`, `process.env.WKB_PROBE_TABLE`, `process.env.WKB_PROBE_COLUMN`, `process.env.WKB_PROBE_LON`, `process.env.WKB_PROBE_LAT` — confirmed by grep
    - File contains `=== SPIKE SUMMARY ===` literal substring
    - `package.json` "scripts" object contains `"wkb-spike": "tsx src/wkbSpike.ts"`
    - Existing `wms-spike` script entry is preserved (regression check)
    - `cd kinetica_bi/server && npx tsc --noEmit` passes (script type-checks against existing tsconfig)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && grep -q "STXY_DISTANCE" src/wkbSpike.ts && grep -q "ST_GEOMFROMTEXT" src/wkbSpike.ts && grep -q "GEODIST" src/wkbSpike.ts && grep -q "wkb-spike" package.json && npx tsc --noEmit</automated>
  </verify>
  <done>wkbSpike.ts is committed; npm run wkb-spike is wired in package.json; tsc --noEmit passes; operator can run `npm run wkb-spike` against their deployed Kinetica.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Operator runs `npm run wkb-spike` against deployed Kinetica and pastes verbatim output</name>
  <files>(no files modified — operator captures output to chat; Task 3 turns it into 18-SPIKE-NOTES.md)</files>
  <read_first>
    - kinetica_bi/server/src/wkbSpike.ts (the script the operator runs — verify it exists and the env-var contract is clear)
  </read_first>
  <action>
    THIS IS A CHECKPOINT — Claude does NOT execute the spike. Claude pauses and instructs the operator.

    OPERATOR INSTRUCTIONS:

    1. Identify a real WKB-typed (binary geometry) column on a Kinetica table you have read access to. If you do not have one handy, create a tiny fixture first via Kinetica Workbench:
       CREATE TABLE ki_home.v18_wkb_fixture (id INT, geom WKT) // adjust to WKB type per your Kinetica version
       INSERT INTO ki_home.v18_wkb_fixture VALUES (1, ST_GEOMFROMTEXT('POINT(-73.95 40.75)'));
       INSERT INTO ki_home.v18_wkb_fixture VALUES (2, ST_GEOMFROMTEXT('POINT(-74.00 40.70)'));
       (Note: the exact CREATE TABLE column type for "WKB" depends on your Kinetica version. Use whatever column type your real production tables use for binary geometry. If unsure, ask your Kinetica admin or check `DESCRIBE TABLE` on a known-WKB-having table.)

    2. Add to `kinetica_bi/server/.env`:
       WKB_PROBE_SCHEMA=<your schema, e.g. ki_home>
       WKB_PROBE_TABLE=<your table, e.g. v18_wkb_fixture>
       WKB_PROBE_COLUMN=<your WKB column name, e.g. geom>
       WKB_PROBE_LON=-73.95
       WKB_PROBE_LAT=40.75

    3. Run the spike:
       cd kinetica_bi/server && npm run wkb-spike

    4. Paste the FULL stdout into chat — every line from "[wkb-spike] Probing ..." through "[wkb-spike] Done." Do NOT truncate Probe body output; Task 3 needs the verbatim error messages.

    5. Also paste the contents of your `.env` settings for WKB_PROBE_SCHEMA / TABLE / COLUMN (so 18-SPIKE-NOTES.md records the actual column name + table the spike ran against). Do NOT paste KINETICA_URL or credentials.

    6. Provide your Kinetica server version if you know it (e.g. "Kinetica 7.2.x"). If unknown, say "version unknown".

    Resume signal: type "wkb spike output captured" once you have pasted (a) full stdout, (b) probe schema/table/column env values, (c) Kinetica version (or "unknown").

    Claude proceeds to Task 3 only after the operator has pasted all three.
  </action>
  <acceptance_criteria>
    - Operator has pasted full stdout from `npm run wkb-spike`, including SUMMARY block (PASS/FAIL per probe)
    - Operator has provided WKB_PROBE_SCHEMA, WKB_PROBE_TABLE, WKB_PROBE_COLUMN values
    - Operator has provided Kinetica version (or "unknown")
    - At least ONE probe (A, B, or C) returned PASS — OR operator has explicitly noted "all three failed; escalating"
  </acceptance_criteria>
  <verify>
    <automated>MISSING — checkpoint task: verification is human-driven (operator pastes spike output to chat). Task 3 generates the verifiable file artifact.</automated>
  </verify>
  <done>Operator has typed the resume signal and pasted full spike output + env values + version. Claude has the data needed to write 18-SPIKE-NOTES.md in Task 3.</done>
  <resume-signal>Type "wkb spike output captured" and paste full spike stdout, probe env values (schema/table/column), and Kinetica version</resume-signal>
</task>

<task type="auto">
  <name>Task 3: Write 18-SPIKE-NOTES.md from operator's spike output</name>
  <files>.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md</files>
  <read_first>
    - .planning/milestones/v1.3-phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md (format precedent — section structure to mirror; PASS/FAIL/Decision pattern)
    - The Task 2 chat-attached operator output (raw stdout from npm run wkb-spike + env values + version)
    - kinetica_bi/server/src/wkbSpike.ts (re-read so the SQL templates documented in 18-SPIKE-NOTES.md match what the script actually issued)
  </read_first>
  <action>
    Create `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` with EXACTLY the following structure. Fill every `<...>` placeholder from the operator's Task 2 output. Where a probe was N/A, write `N/A — <reason>` (do NOT guess values).

    ```markdown
    # Phase 18 — WKB Spatial-Proximity Spike Notes

    **Spike date:** <ISO date>
    **Deployed Kinetica:** <KINETICA_URL value, with credentials redacted>
    **Operator:** <username from $KINETICA_USERNAME, redacted to first letter + `***` if sensitive>
    **Kinetica version:** <operator-provided, e.g. "Kinetica 7.2.x" or "unknown">
    **WKB probe target:** `<schema>.<table>.<column>` — e.g. `ki_home.v18_wkb_fixture.geom`
    **Click point:** lon=<lon>, lat=<lat>
    **Confidence:** HIGH (verified against deployed Kinetica) | MEDIUM (one probe ambiguous; documented below) | LOW (all probes failed; ESCALATION required)

    ## Probe A — STXY_DISTANCE direct on WKB column

    **Probe SQL:**
    ```sql
    SELECT STXY_DISTANCE(<wkb_col>, <click_lon>, <click_lat>) AS dist
    FROM <schema>.<table>
    ORDER BY dist ASC LIMIT 5
    ```

    **HTTP status:** <e.g. 200 or 400>
    **Response body (verbatim):**
    ```json
    <verbatim JSON from operator's stdout — full body, do not truncate error messages>
    ```

    **Status:** PASS | FAIL
    **Failure reason (if FAIL):** <one-line — e.g. "body.message: 'function STXY_DISTANCE does not accept WKB column type'">

    ## Probe B — ST_DISTANCE with ST_GEOMFROMTEXT wrapper

    **Probe SQL:**
    ```sql
    SELECT ST_DISTANCE(<wkb_col>, ST_GEOMFROMTEXT('POINT(<click_lon> <click_lat>)')) AS dist
    FROM <schema>.<table>
    ORDER BY dist ASC LIMIT 5
    ```

    **HTTP status:** <e.g. 200 or 400>
    **Response body (verbatim):**
    ```json
    <verbatim JSON from operator's stdout>
    ```

    **Status:** PASS | FAIL
    **Failure reason (if FAIL):** <one-line>

    ## Probe C — GEODIST after STX/STY centroid extraction

    **Probe SQL:**
    ```sql
    SELECT GEODIST(STX(<wkb_col>), STY(<wkb_col>), <click_lon>, <click_lat>) AS dist
    FROM <schema>.<table>
    ORDER BY dist ASC LIMIT 5
    ```

    **HTTP status:** <e.g. 200 or 400>
    **Response body (verbatim):**
    ```json
    <verbatim JSON from operator's stdout>
    ```

    **Status:** PASS | FAIL
    **Failure reason (if FAIL):** <one-line>

    ## Decision

    **Chosen WKB SQL pattern:** <one of: PROBE_A | PROBE_B | PROBE_C | NONE_ESCALATE>

    **SQL template Plan 18-02 buildWkbQuery() will use:**
    ```sql
    <verbatim winning template, with column-name + click-point parameter placeholders left as $WKB_COL / $LON / $LAT for the SQL builder to substitute>
    ```

    **Reasoning:** <one paragraph — why this probe was chosen. If A passed, prefer A (no wrapper, lowest overhead). If A failed but B passed, B is chosen and the doc-comment in 18-02 buildWkbQuery() will note the wrapper requirement. If only C passed, document the centroid-extraction caveat (C ignores polygon area; OK for point-shaped WKB but risky for polygon WKB — flag for v2.>

    **Downstream consequence:**
      - PROBE_A chosen: Plan 18-02 buildWkbQuery returns SQL identical in shape to buildWktQuery (same STXY_DISTANCE function, same arg order). Endpoint WKB branch ships with no wrapper.
      - PROBE_B chosen: Plan 18-02 buildWkbQuery wraps the click point in ST_GEOMFROMTEXT('POINT(... ...)') inside the SQL string. Doc-comment notes the per-query parsing overhead.
      - PROBE_C chosen: Plan 18-02 buildWkbQuery uses STX/STY to extract a centroid then GEODIST. Doc-comment warns that this is a polygon-area-ignoring approximation and v2 should revisit.
      - NONE_ESCALATE: This plan is BLOCKED. Plan 18-02 and 18-03 cannot proceed. Re-engage the operator and try alternative function names (e.g. ST_GEOMFROMWKB explicit constructor, ST_AsText to round-trip) before declaring SPATIAL-V14-03 unbuildable.

    ## Caveats

    <Free-form: any unexpected findings, env-specific quirks, polygon vs point WKB shape implications, Kinetica-version-specific notes that affect Plan 18-02's SQL template>

    ## Open Question Resolutions

    - **OQ-1 (WKB function name):** RESOLVED → see Decision above (Probe <A|B|C> chosen) | BLOCKED → see Decision above (NONE_ESCALATE)
    - **OQ-2 (Wrapper required):** YES (Probe B chosen) | NO (Probe A or C chosen) | N/A (NONE_ESCALATE)
    ```

    Fill EVERY `<...>` placeholder from the operator's Task 2 output. Where a probe genuinely yielded no data (e.g. operator's table was empty), write the verbatim Kinetica response (likely an empty `data` array with HTTP 200 — that's still a PASS for SQL-execution purposes; PROBE_A wins).

    Anti-patterns to avoid:
    - Do NOT fabricate a PASS for a probe the operator did not run.
    - Do NOT pick PROBE_A as the default if its body shows `"status":"ERROR"` — read the body verbatim and decide.
    - Do NOT skip the SQL-template-with-placeholders block — Plan 18-02 reads this file and copies the template verbatim into buildWkbQuery.
  </action>
  <acceptance_criteria>
    - File `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` exists
    - File contains all 5 top-level sections: `## Probe A`, `## Probe B`, `## Probe C`, `## Decision`, `## Caveats`
    - File contains the literal heading `**Chosen WKB SQL pattern:**` followed by one of: PROBE_A, PROBE_B, PROBE_C, NONE_ESCALATE
    - File contains the literal heading `**SQL template Plan 18-02 buildWkbQuery() will use:**` followed by a fenced sql code block
    - File contains zero literal `<...>` placeholders that were not explicitly replaced (verify: `grep -E '^<[^>]+>$' 18-SPIKE-NOTES.md` returns no matches; trailing-only HTML-like tokens are fine)
    - File contains the operator's Kinetica version line and the WKB probe target line (`**WKB probe target:**` followed by schema.table.column)
    - File ends without a TODO/FIXME/XXX marker (`grep -c "TODO\|FIXME\|XXX" returns 0`)
  </acceptance_criteria>
  <verify>
    <automated>test -f .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md && grep -E "^## Probe A|^## Probe B|^## Probe C|^## Decision|^## Caveats" .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md | wc -l | awk '$1 >= 5 {exit 0} {exit 1}' && grep -E "^\*\*Chosen WKB SQL pattern:\*\* (PROBE_A|PROBE_B|PROBE_C|NONE_ESCALATE)" .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md</automated>
  </verify>
  <done>18-SPIKE-NOTES.md is committed; all three probe sections have a definitive PASS/FAIL status; Decision section commits to one of {PROBE_A, PROBE_B, PROBE_C, NONE_ESCALATE}; if NONE_ESCALATE, the user is informed Plan 18-02 cannot proceed until escalation resolves.</done>
</task>

</tasks>

<verification>
- All three WKB probes have verbatim probe body output (PASS or FAIL with reason)
- Decision section commits to ONE chosen pattern with a verbatim SQL template Plan 18-02 will copy
- The `wkbSpike.ts` script type-checks (tsc --noEmit) and is reusable for future spike re-runs
- If NONE_ESCALATE, this plan is the BLOCKER for Plan 18-02 and 18-03 — escalation must occur before either lands
</verification>

<success_criteria>
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` exists, committed, structured per the format above
- Operator approval recorded in chat (resume signal received)
- No probe outcome was fabricated — every PASS/FAIL maps 1:1 to operator-pasted curl/spike output
- Plan 18-02 can proceed (PROBE_A | PROBE_B | PROBE_C chosen) OR Plan 18-02 is BLOCKED (NONE_ESCALATE) and a follow-up spike round must be planned
- `kinetica_bi/server/src/wkbSpike.ts` is reusable: future Phase 24 verification can re-run `npm run wkb-spike` to confirm production behavior
</success_criteria>

<output>
After completion, create `.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md` summarizing:
- The PASS/FAIL status of each probe (A, B, C)
- The chosen pattern (PROBE_A | PROBE_B | PROBE_C | NONE_ESCALATE) and the verbatim SQL template Plan 18-02 will use
- The operator's Kinetica version + WKB probe target schema.table.column
- Whether Plan 18-02 / 18-03 can proceed (PASS path) or are BLOCKED (NONE_ESCALATE path)
</output>
</content>
