---
phase: 13-spikes-and-endpoint
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md
autonomous: false
requirements:
  - SPIKE-V13-01
  - SPIKE-V13-02
  - SPIKE-V13-03
  - SPIKE-V13-04
must_haves:
  truths:
    - "Operator has run all four spike probes (S1, S2, S3, S4) live against the deployed Kinetica with their own BI-user credentials"
    - "13-SPIKE-NOTES.md exists with one section per spike, each containing: probe command, observed result, pass/fail, downstream consequence"
    - "S1 (WMS LAYERS=view) finding determines whether MAP-V13-* requirements stay in v1.3 or defer post-v1.3"
    - "S2 (DDL permission) finding determines whether a service-account DDL fallback plan must be added inside Phase 13"
    - "S3 (expired-view error message) provides the exact verbatim error string Phase 15 will use to build isViewNotFoundError() in LIFE-V13-02"
    - "S4 (schema qualification) finding determines whether the endpoint returns schema-qualified or unqualified view names"
  artifacts:
    - path: ".planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md"
      provides: "Locked findings for S1/S2/S3/S4 with pass/fail and downstream consequence"
      contains: "S1 — WMS LAYERS=view, S2 — DDL Permission, S3 — Expired-View Error, S4 — Schema Qualification"
  key_links:
    - from: ".planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md S2 finding"
      to: "Plan 13-03 endpoint construction"
      via: "DDL permission gate — pass=build per-user; fail=add 13-04 service-account gap-closure"
      pattern: "S2.*PASS|S2.*FAIL"
    - from: ".planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md S4 finding"
      to: "Plan 13-02 view-name builder"
      via: "Schema-qualified vs unqualified return value"
      pattern: "S4.*qualified|S4.*unqualified"
    - from: ".planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md S3 finding"
      to: "Phase 15 LIFE-V13-02 isViewNotFoundError()"
      via: "Verbatim error message string"
      pattern: "S3.*body\\.message|S3.*verbatim"
---

<objective>
Operator runs all four Phase-13 architectural spikes (S1 WMS LAYERS=view, S2 DDL permission, S3 expired-view error, S4 schema qualification) against deployed Kinetica using their own BI-user credentials, and records findings in `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md`. This plan UNBLOCKS Plan 13-03 endpoint construction — S2 determines whether per-user DDL is buildable; S4 determines view-name format.

Purpose: Resolve four Kinetica-deployment-specific unknowns that the rest of v1.3 depends on. Findings drive endpoint shape (S2, S4), Phase 15 reactive recovery (S3), and Phase 16 viability (S1).

Output: A single committed `13-SPIKE-NOTES.md` with one section per spike. Each section contains the probe command Claude provided, the operator's observed result (verbatim curl output), pass/fail, and the downstream build consequence. NO source code is written in this plan.

Pattern model: `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` (Phase 11 wave-1 spike precedent — same structure, same operator-driven workflow).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md
@.planning/phases/13-spikes-and-endpoint/13-RESEARCH.md
@.planning/phases/11-map-chart/11-SPIKE-NOTES.md
@.planning/phases/11-map-chart/11-01-wms-spike-and-cache-control-PLAN.md

<interfaces>
<!-- Reference: file format precedent from Phase 11 -->
<!-- The 13-SPIKE-NOTES.md file is markdown — no code interfaces. -->
<!-- Probe command bodies are derived from 13-RESEARCH.md "Spike Plan Pattern" section. -->

Key environment variables operator must have set or know:
- KINETICA_URL (e.g. http://172.31.0.22:8082/gpudb-0 — same value used by Phase 11 spike)
- KINETICA_USER (operator's own BI-user username; for OIDC mode, also test with an OIDC access token via Bearer)
- KINETICA_PASS (operator's own BI-user password — password mode only; OIDC test uses a fresh access token)

Probe SQL DDL (S2, S3) — exact strings:
- CREATE: `CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)`
- DROP:   `DROP TABLE IF EXISTS _kbi_filt_spike_test`
- POST-DROP QUERY (S3): `SELECT * FROM _kbi_filt_spike_test LIMIT 1`

Probe WMS GetMap (S1, S4) — exact URL template:
$KINETICA_URL/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=<view-or-qualified-view>&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png

Pass-criteria reference table (from 13-CONTEXT.md):
- S1 PASS = `file /tmp/wms_view_test.png` outputs `PNG image data`. FAIL = XML error body or empty file.
- S2 PASS = Kinetica `/execute/sql` returns `"status":"OK"`. FAIL = `"status":"ERROR"` with access-denied / permission-denied message.
- S3 PASS = exact verbatim body.message string captured (e.g. `"table 'NAME' does not exist"` or similar). No "PASS" required — capturing the string IS the pass criterion.
- S4 PASS = at least one of the two LAYERS forms (qualified, unqualified) returns `PNG image data`. Record which forms succeed.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Operator runs S1-S4 spike probes against deployed Kinetica</name>
  <files>(no files modified — operator captures output to chat; written in Task 2)</files>
  <read_first>
    - .planning/phases/13-spikes-and-endpoint/13-CONTEXT.md (decisions § "Spike methodology", "Spike scope per-spike" table; defines pass/fail per spike)
    - .planning/phases/13-spikes-and-endpoint/13-RESEARCH.md (§ "Spike Plan Pattern" — exact probe command shapes)
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md (format precedent — output structure to follow in Task 2)
  </read_first>
  <action>
    THIS IS A CHECKPOINT — Claude does NOT execute these probes. Claude pauses and instructs the operator to run the four blocks below against deployed Kinetica using their own BI-user credentials. Operator pastes raw curl output back into chat.

    For each block, operator captures: (1) the exact command run, (2) HTTP status, (3) full response body (especially body.message), (4) pass/fail per the criteria in CONTEXT.md.

    ---

    BLOCK A — S2 first (creates fixture used by S1, S3, S4)

    Set env vars in shell:
      export KU="<KINETICA_URL>"
      export KUSER="<your BI username>"
      export KPASS="<your BI password>"

    Probe S2.a (CREATE — password mode):
      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Record: HTTP status, full body JSON. Pass = `"status":"OK"`. Fail = `"status":"ERROR"` with `message` containing "access denied" or "permission".

    Probe S2.b (CREATE — OIDC mode, IF the deployed Kinetica supports Bearer auth in this environment): repeat with `-H "Authorization: Bearer <access_token>"` instead of `-u`. If OIDC isn't available in the spike environment, mark S2.b as N/A and document.

    Probe S2.c (DROP — confirms drop permission):
      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Record S2.c result. (We re-create in S1 below.)

    ---

    BLOCK B — S1 (after re-creating the view)

    Re-create the view (we just dropped it in S2.c):
      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Probe S1 (WMS LAYERS=view, unqualified — uses operator's default schema):
      curl -s -u "$KUSER:$KPASS" \
        "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=_kbi_filt_spike_test&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
        --output /tmp/wms_view_test.png

      file /tmp/wms_view_test.png

    Pass = output is `PNG image data`. Fail = XML error body or 0 bytes. If FAIL, capture: `cat /tmp/wms_view_test.png | head -c 2000` (in case of XML).

    ---

    BLOCK C — S4 (schema qualification — both forms)

    Determine your default schema (so we know what to qualify with):
      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"SELECT CURRENT_SCHEMA","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Record the schema (typical: `ki_home`).

    Probe S4.a (qualified — replace `ki_home` with your actual schema):
      curl -s -u "$KUSER:$KPASS" \
        "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=ki_home._kbi_filt_spike_test&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
        --output /tmp/wms_qualified.png

      file /tmp/wms_qualified.png

    Probe S4.b (unqualified — already done in S1; reuse `/tmp/wms_view_test.png` result).

    Record both results — which forms succeed.

    ---

    BLOCK D — S3 (expired/dropped view error)

    Drop the view, then immediately query it:
      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

      curl -i -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"SELECT * FROM _kbi_filt_spike_test LIMIT 1","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Note `-i` flag — captures HTTP response headers. Record VERBATIM:
      - HTTP status code (line 1 of output)
      - Full body JSON (especially `body.message`, `body.status`, any `body.code` or category fields)

    ---

    BLOCK E — Cleanup (regardless of which probes ran)

      curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
        -H "Content-Type: application/json" \
        -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'

    Then paste all the captured output into a single chat reply. Claude proceeds to Task 2 only after the operator has provided every block's output (or explicitly marked a block N/A with reason).
  </action>
  <acceptance_criteria>
    - Operator has provided HTTP status + full body for S2.a (CREATE password mode)
    - Operator has provided HTTP status + full body for S2.c (DROP)
    - Operator has provided `file` command output for /tmp/wms_view_test.png (S1) — either "PNG image data" or alternative content
    - Operator has provided `file` command output for /tmp/wms_qualified.png (S4.a) — either "PNG image data" or alternative content
    - Operator has provided HTTP status + full body for S3 (post-drop query) — including verbatim body.message string
    - Operator has either provided S2.b OIDC-mode result OR explicitly marked S2.b as N/A with reason (e.g. "no OIDC token available in spike environment")
    - Operator has confirmed cleanup DROP ran (or noted view will expire via TTL=5 within 5 minutes)
  </acceptance_criteria>
  <verify>
    <automated>MISSING — checkpoint task: verification is human-driven (operator confirms by pasting curl output to chat). Task 2 then turns those outputs into a verifiable file artifact.</automated>
  </verify>
  <done>Operator has typed the resume signal and pasted all five block outputs (or explicit N/A markers with reason) into chat; Claude has those outputs available for Task 2.</done>
  <resume-signal>Type "spike output captured" and paste all block outputs (or describe which block failed and why)</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Write 13-SPIKE-NOTES.md from spike output</name>
  <files>.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md</files>
  <read_first>
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md (format precedent — section structure to mirror)
    - .planning/phases/13-spikes-and-endpoint/13-CONTEXT.md (decisions § "Spike scope per-spike" table — pass/fail criteria + downstream consequence per spike)
    - .planning/phases/13-spikes-and-endpoint/13-RESEARCH.md (§ "Open Questions" — questions the spike notes must address)
    - The Task 1 chat-attached output blocks (S1, S2, S3, S4 raw curl results pasted by operator)
  </read_first>
  <action>
    Create `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` with EXACTLY the following section structure. Fill every `<...>` placeholder from the operator's Task 1 output. Where a probe was N/A, write `N/A — <reason>` (do NOT guess values).

    ```markdown
    # Phase 13 — Spike Notes (S1–S4)

    **Spike date:** <ISO date>
    **Deployed Kinetica:** <KINETICA_URL value, with credentials redacted>
    **Operator:** <username from $KUSER, redacted to first letter + `***` if sensitive>
    **Confidence:** HIGH (verified against deployed Kinetica)

    ## S1 — WMS LAYERS=<materialized_view_name>

    **Probe command:**
    ```bash
    curl -s -u "$KUSER:$KPASS" \
      "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=_kbi_filt_spike_test&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
      --output /tmp/wms_view_test.png && file /tmp/wms_view_test.png
    ```

    **Observed result:** <verbatim `file` output, e.g. "PNG image data, 256 x 256, ...">
    **Body excerpt (if non-PNG):** <verbatim head -c 2000 output, or N/A>
    **Status:** PASS | FAIL
    **Downstream consequence:**
      - If PASS: MAP-V13-* requirements stay in v1.3; Phase 16 will swap LAYERS=<view> in wmsUrlBuilder.
      - If FAIL: MAP-V13-01..06 deferred to post-v1.3 follow-up; Phase 16 success criterion 1 documented as DEFERRED in milestone audit. Charts (Phase 15) ship unchanged.

    ## S2 — DDL Permission (CREATE OR REPLACE MATERIALIZED VIEW + DROP TABLE IF EXISTS)

    ### S2.a — CREATE (password mode)

    **Probe command:**
    ```bash
    curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
      -H "Content-Type: application/json" \
      -d '{"statement":"CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
    ```

    **HTTP status:** <e.g. 200>
    **Response body:** <verbatim JSON>
    **Status:** PASS | FAIL

    ### S2.b — CREATE (OIDC mode)

    **Probe command:** Same as S2.a but with `-H "Authorization: Bearer <token>"` instead of `-u`.
    **HTTP status:** <e.g. 200> | N/A — <reason>
    **Response body:** <verbatim JSON> | N/A
    **Status:** PASS | FAIL | N/A

    ### S2.c — DROP TABLE IF EXISTS

    **HTTP status:** <e.g. 200>
    **Response body:** <verbatim JSON>
    **Status:** PASS | FAIL

    **Overall S2 status:** PASS | FAIL
    **Downstream consequence:**
      - If PASS: Plan 13-03 endpoint uses `kineticaSql(req, ddl, { op: "MATERIALIZE" })` with per-user creds verbatim — no fallback path. VIEW-V13-05 (DDL_DENIED 403) still ships as a defense-in-depth handler but should rarely fire in practice.
      - If FAIL: A new Plan 13-04 (gap-closure) is added inside Phase 13 to introduce a service-account DDL path BEFORE Phase 14 begins. The service-account credentials are sourced from `KINETICA_USERNAME` / `KINETICA_PASSWORD` env vars (already used by `verifyKineticaCredentials` in `auth.ts:60-64`); the endpoint construction in Plan 13-03 must accept a "service-account fallback" branch toggled by env var.

    ## S3 — Expired/Dropped-View Query Error

    **Probe command:**
    ```bash
    # Step 1: drop
    curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
      -H "Content-Type: application/json" \
      -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
    # Step 2: query the dropped view
    curl -i -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
      -H "Content-Type: application/json" \
      -d '{"statement":"SELECT * FROM _kbi_filt_spike_test LIMIT 1","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
    ```

    **HTTP status:** <e.g. 400>
    **Response body (verbatim):** <full JSON, especially `body.message`>
    **Verbatim error message string for `isViewNotFoundError()`:** `<the exact body.message text>`
    **Status:** RESOLVED (string captured) | BLOCKED (probe failed; reason: <...>)

    **Downstream consequence:**
      - If RESOLVED: Phase 15 LIFE-V13-02 builds `isViewNotFoundError(err)` in `kinetica_bi/src/lib/filterErrors.ts` (or chosen path) using a regex derived from this exact string — e.g. `/<verbatim substring or pattern>/i`. Reactive recovery branch matches precisely; no false positives.
      - If BLOCKED: Phase 15 LIFE-V13-02 falls back to broader catch — `instanceof KineticaUpstreamError && err.upstreamStatus === 400` — covers the same case at risk of reacting to genuinely-broken DDL. Documented in Phase 15 PLAN.

    ## S4 — Schema Qualification (LAYERS=<view> vs LAYERS=<schema>.<view>)

    ### S4.a — Schema-qualified (e.g. `ki_home._kbi_filt_spike_test`)

    **Probe command:**
    ```bash
    curl -s -u "$KUSER:$KPASS" \
      "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=<schema>._kbi_filt_spike_test&...&FORMAT=image/png" \
      --output /tmp/wms_qualified.png && file /tmp/wms_qualified.png
    ```

    **Operator's default schema:** <e.g. ki_home>
    **Observed result:** <verbatim `file` output>
    **Status:** PASS | FAIL

    ### S4.b — Unqualified (`_kbi_filt_spike_test`)

    Same probe as S1; result reused.
    **Status:** PASS | FAIL (mirrors S1 status)

    **Overall S4 status:** Both work | Only qualified works | Only unqualified works | Both fail (= S1 fail; MAP defer)

    **Downstream consequence:**
      - Both work: Endpoint returns unqualified view name (simpler); client uses unqualified in LAYERS. Documented in Plan 13-02 view-name builder.
      - Only qualified works: Endpoint returns SCHEMA-QUALIFIED view name; view-name builder in Plan 13-02 must read the user's default schema and prefix it. Adds a one-time `SHOW SCHEMAS` lookup or session-cached schema field.
      - Only unqualified works: Endpoint returns unqualified (no change from default). Document caveat for cross-schema operators.
      - Both fail: Same as S1 fail — MAP-V13-* defers post-v1.3.

    ## Open Question Resolutions

    - **OQ-1 (S3 verbatim error message):** RESOLVED | BLOCKED — see S3 above
    - **OQ-2 (S4 schema requirement):** RESOLVED | BLOCKED — see S4 above
    - **OQ-3 (route file extraction):** Not part of this spike; Plan 13-03 picks (default: inline in `index.ts`)
    - **OQ-4 (DELETE body vs query params):** Not part of this spike; Plan 13-03 picks (default: query params per RESEARCH.md recommendation)

    ## Caveats

    <Any unexpected findings, env-specific quirks, OIDC-mode unavailability, etc.>
    ```

    Fill EVERY `<...>` placeholder from the operator's Task 1 chat output. Where the operator marked a probe N/A, the corresponding section uses `N/A — <reason>`. NEVER fabricate a result. If S2 BOTH password and OIDC failed, mark overall S2 FAIL and note the gap-closure plan requirement explicitly.

    Commit message format (when this task completes): `docs(13): record spike findings (S1-S4)` per gsd-tools commit conventions.
  </action>
  <acceptance_criteria>
    - File `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` exists
    - File contains all six top-level section headings: `## S1 — WMS LAYERS`, `## S2 — DDL Permission`, `## S3 — Expired/Dropped-View Query Error`, `## S4 — Schema Qualification`, `## Open Question Resolutions`, `## Caveats`
    - File contains zero literal `<...>` placeholders that were not explicitly replaced with `N/A — <reason>` text (verify: `grep -E '^<[^>]+>$' .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` returns no matches; trailing-only angle-bracket lines like `</details>` are fine)
    - File contains exactly one literal token `**Status:** PASS` or `**Status:** FAIL` for S1 (grep `-c "^\*\*Status:\*\* PASS$\|^\*\*Status:\*\* FAIL$"` finds at least 1 instance for S1)
    - File contains the literal `**Overall S2 status:**` AND `**Overall S4 status:**` headings followed by a definitive value
    - For S3, file contains the literal `**Verbatim error message string for \`isViewNotFoundError()\`:**` line, followed by either a backtick-quoted string OR `N/A — <reason>`
    - File ends without a TODO marker — `grep -c "TODO\|FIXME\|XXX" .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` returns 0
  </acceptance_criteria>
  <verify>
    <automated>test -f .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md && grep -E "^## S1 |^## S2 |^## S3 |^## S4 |^## Open Question Resolutions|^## Caveats" .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md | wc -l | awk '$1 >= 6 {exit 0} {exit 1}'</automated>
  </verify>
  <done>13-SPIKE-NOTES.md is committed; all four spike sections have a definitive PASS/FAIL/N/A status; S3 captured the verbatim error string OR documented the BLOCKED reason; S2 and S4 outcomes determine downstream plan deltas (Plan 13-03 must read this file before construction).</done>
</task>

</tasks>

<verification>
- All four spike sections (S1, S2, S3, S4) have verbatim probe outputs and definitive status
- S2 outcome dictates whether Plan 13-04 service-account gap-closure must be added before Plan 13-03 wires the endpoint
- S4 outcome dictates whether Plan 13-02 view-name builder returns schema-qualified or unqualified names
- S3 verbatim error string is captured for Phase 15 use (or BLOCKED reason documented)
- The endpoint construction (Plan 13-03) is now informed; planner re-reads 13-SPIKE-NOTES.md as input to Plan 13-03
</verification>

<success_criteria>
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` exists, committed, structured per the format above
- Operator approval recorded in chat (resume signal received)
- No probe was fabricated — every outcome maps 1:1 to a curl response captured in Task 1
- Plan 13-02 and 13-03 can proceed (S2 PASS path) OR Plan 13-04 gap-closure is added (S2 FAIL path)
</success_criteria>

<output>
After completion, create `.planning/phases/13-spikes-and-endpoint/13-01-SUMMARY.md` summarizing:
- The PASS/FAIL status of each spike (S1, S2, S3, S4)
- The verbatim S3 error string (if captured)
- Whether MAP-V13-* requirements stay in v1.3 (S1 PASS) or defer post-v1.3 (S1 FAIL)
- Whether Plan 13-04 service-account gap-closure is needed (S2 FAIL) or not (S2 PASS)
- Whether view-name builder returns schema-qualified or unqualified names (S4 outcome)
</output>
</content>
</invoke>