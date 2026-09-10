---
phase: 37-cb-track-wms-spike
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/cbTrackSpike.ts
  - kinetica_bi/server/package.json
  - .gitignore
  - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md
autonomous: false
requirements:
  - SPIKE-V17-01
  - SPIKE-V17-02
  - SPIKE-V17-03
  - SPIKE-V17-04
  - SPIKE-V17-05
  - SPIKE-V17-06
must_haves:
  truths:
    - "Operator has run cbTrackSpike against the deployed Kinetica instance with their own BI-user credentials (password mode); HTTP status + tile bytes captured for every probe block"
    - "37-SPIKE-NOTES.md is committed with PASS/FAIL verdicts per probe block covering: all three CB lanes (A codebase-current CB_COLUMN_NAME/CB_BREAK_POINT_N/CB_POINTCOLOR_N, B docs CB_ATTR/CB_VALS/CB_POINTCOLORS, C raster-style under STYLES=cb_raster with comma-separated POINTCOLORS/POINTSIZES), all four categorical edge cases (<other> keyword, comma-escape, NULL bucket, mixed numeric/categorical), DOTRACKS=TRUE + the 9-param TRACK_* matrix under both STYLES=raster and STYLES=cb_raster, NTILE quantile probe, and 6-char vs 8-char AARRGGBB color-format probes — every verdict backed by both HTTP status AND a visual tile-diff reference (PNG path or pasted screenshot)"
    - "Decision Record in 37-SPIKE-NOTES.md locks the exact working CB param-name set per render mode (or NONE_ESCALATE → BLOCK_V17 if all three lanes fail across both numeric+categorical fixtures); records the 6-char vs 8-char AARRGGBB verdict with explicit tile-diff evidence so Phase 38 SCHEMA-V17-05 fix is unambiguous; locks NTILE syntax (PARTITION BY 0 vs bare ORDER BY) for Phase 38 /api/quantile; locks DOTRACKS + TRACK_* matrix verdict so Phase 40 knows which params Kinetica accepts under each render mode"
    - "The spike runner kinetica_bi/server/src/cbTrackSpike.ts is committed and runnable via npm run cb-track-spike from a clean checkout; existing wms-spike + wkb-spike + spatial-predicate-spike script entries preserved"
    - "spike-output/ directory containing raw PNG tile bytes is gitignored at repo root; only 37-SPIKE-NOTES.md + representative pasted screenshots land in the commit"
  artifacts:
    - path: "kinetica_bi/server/src/cbTrackSpike.ts"
      provides: "Operator-runnable CB + Track WMS spike script invoked via npm run cb-track-spike"
      min_lines: 400
      contains: "CB_COLUMN_NAME, CB_BREAK_POINT_, CB_POINTCOLOR_, CB_ATTR, CB_VALS, CB_POINTCOLORS, POINTCOLORS, POINTSIZES, STYLES=classbreak, STYLES=cb_raster, DOTRACKS, TRACK_ID_ATTR, TRACK_ORDER_ATTR, TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES, TRACKLINEWIDTHS, TRACKMARKERSHAPES, TRACKHEADSHAPES, NTILE, PARTITION BY 0, dotenv.config, encoding: \"json\", request_schema_str, basicAuth, classify, spike-output, BBOX=-74.05,40.65,-73.85,40.85"
    - path: "kinetica_bi/server/package.json"
      provides: "npm-script wiring for the runner"
      contains: "cb-track-spike"
    - path: ".gitignore"
      provides: "PNG tile-byte output directory gitignored at repo root"
      contains: "spike-output"
    - path: ".planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md"
      provides: "Locked CB param-name + color-format + DOTRACKS + TRACK_* matrix + NTILE Decision Record with verbatim probe outputs and downstream consequences for Phases 38 + 40"
      contains: "## Probe, ## Decision, ## Caveats, ## Open Question Resolutions, Lane A, Lane B, Lane C, NTILE, DOTRACKS, AARRGGBB"
  key_links:
    - from: "kinetica_bi/server/src/cbTrackSpike.ts"
      to: "kinetica_bi/server/src/spatialPredicateSpike.ts"
      via: "Structural model — Phase 37 runner mirrors Phase 25 runner byte-for-byte for boilerplate (dotenv loading, env-var validation, basicAuth, redactedUrl, rawFetch, runSql, classify, banner format, SPIKE SUMMARY block); swap predicate probes for WMS GetMap probes + add multi-render-mode and multi-fixture loops"
      pattern: "import dotenv|basicAuth|redactedUrl|rawFetch|runSql|classify|SPIKE SUMMARY"
    - from: "kinetica_bi/server/src/cbTrackSpike.ts runSql()"
      to: "kinetica_bi/server/src/kinetica.ts:154-170 (canonical /execute/sql payload)"
      via: "Runner /execute/sql POST body for the NTILE probe MUST be byte-for-byte identical (7 fields: statement, offset, limit, encoding, request_schema_str, data, options) — Phase 18 lost a round-trip to a partial body; Phase 25 carried the lock; Phase 37 inherits it"
      pattern: "encoding.*json.*request_schema_str.*data.*options"
    - from: "kinetica_bi/src/lib/wmsUrlBuilder.ts:325-340 (current classbreak emitter)"
      to: "Phase 37 Lane A probes"
      via: "Lane A probes the EXISTING shipped naming so we know what the v1.2 Phase 11 spike thought worked (CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_N / CB_POINTCOLOR_N) and what the 6-char b.color.toUpperCase() bug at line 337 actually renders against today's Kinetica"
      pattern: "CB_COLUMN_NAME|CB_BREAK_POINT_|CB_POINTCOLOR_"
    - from: "37-SPIKE-NOTES.md ## Decision"
      to: "Phase 38 SCHEMA-V17-03/04/05 (wmsUrlBuilder.ts CB + Track + color rewrite) and Phase 38 SCHEMA-V17-06 (/api/quantile endpoint)"
      via: "Spike outcome dictates literal CB_* / TRACK_* param names + color format + NTILE syntax for Phase 38 implementation"
      pattern: "CB_ATTR|CB_VALS|CB_POINTCOLORS|CB_COLUMN_NAME|CB_BREAK_POINT_|TRACKHEADCOLORS|DOTRACKS|AARRGGBB|NTILE"
    - from: ".planning/phases/37-cb-track-wms-spike/37-CONTEXT.md"
      to: "Locked Phase 37 decisions"
      via: "Probe coverage strategy (3 CB lanes + 4 categorical edge cases + 18-cell TRACK_* matrix + NTILE + color format), Manhattan bbox -74.05,40.65,-73.85,40.85, demo.nyctaxi fixtures, env-var-driven track table, password-mode auth, total-fail escalation rules"
      pattern: ""
    - from: ".planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md"
      to: "37-SPIKE-NOTES.md format"
      via: "Decision Record schema precedent — ## Probe blocks (verbatim SQL/URL + HTTP status + body or tile path + PASS/FAIL + failure reason) → ## Decision (chosen params + reasoning + downstream consequence) → ## Caveats → ## Open Question Resolutions"
      pattern: "## Probe|## Decision|## Caveats|## Open Question Resolutions"
    - from: ".planning/research/STACK.md §\"CB param names\" + §\"Track\" + §\"Quantile\""
      to: "Probe design context"
      via: "STACK research surfaced the CB_ATTR/CB_VALS Kinetica-7.1-docs naming that conflicts with current CB_COLUMN_NAME/CB_BREAK_POINT_N codebase shape; STACK §Quantile recommends NTILE(n) OVER (PARTITION BY 0 ORDER BY col); STACK §Track enumerates TRACK_* params"
      pattern: ""
    - from: ".planning/research/PITFALLS.md §\"CB color format\""
      to: "Color-format probe design"
      via: "PITFALLS surfaced the 6-char RRGGBB bug at wmsUrlBuilder.ts:337 (b.color.toUpperCase() emits 6-char while raster branch uses normalizeAARRGGBB 8-char); Phase 37 probes both forms under all three CB lanes to lock the Kinetica-accepted format with tile-diff evidence"
      pattern: ""
---

<objective>
Operator-driven spike against the deployed Kinetica instance to lock the EXACT WMS parameter surface for classbreak (CB_*) and track (TRACK_*) styling — eliminating the CB_COLUMN_NAME vs CB_ATTR codebase-vs-docs discrepancy, the 6-char RRGGBB vs 8-char AARRGGBB color-format ambiguity, the DOTRACKS gating semantics, the CB_RASTER + comma-separated raster-param behavior, and the NTILE quantile SQL form — BEFORE any Phase 38 wmsUrlBuilder rewrite or /api/quantile endpoint code lands.

Purpose: **This phase is the P0 gate for the entire v1.7 milestone.** Phase 38 cannot start until every probe lane has a Decision Record entry locking the working param-name set per render mode. The strong evidence criterion (HTTP 200 AND visual tile diff confirming differentiated output — NOT just HTTP 200) catches silent param-ignored no-ops at spike time rather than at Phase 43 UAT (v1.2 Phase 11 lesson: WMS GetMap returns 200 even when CB params are silently ignored and the tile renders as raster).

Output: A spike runner script `kinetica_bi/server/src/cbTrackSpike.ts` modeled on `kinetica_bi/server/src/spatialPredicateSpike.ts` (production-payload-parity for SQL probes; `fetch()` for WMS GetMap probes; saves PNG tile bytes to `kinetica_bi/server/spike-output/37-*.png` — gitignored), an npm-script wire-up (`cb-track-spike`), a repo-root `.gitignore` addition for `spike-output/`, and a `37-SPIKE-NOTES.md` Decision Record committed to the phase directory.

Pattern model: `.planning/phases/25-spatial-predicate-spike/25-01-spatial-predicate-spike-PLAN.md` (3-task plan: Claude writes runner + notes template skeleton → operator runs spike + pastes verbatim outputs → Claude writes Decision Record from operator's stdout + tile observations). Single-plan shape per CONTEXT.md "Phase shape" guidance. Differentiator from Phase 25: WMS GetMap probes (not SQL predicate probes) + tile-bytes capture + multi-render-mode loop (STYLES=classbreak vs STYLES=raster vs STYLES=cb_raster) + multi-fixture loop (numeric vs categorical) + ~40+ probe blocks vs Phase 25's 12.
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
@.planning/phases/37-cb-track-wms-spike/37-CONTEXT.md

# Research artifacts (probe design context)
@.planning/research/SUMMARY.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
@.planning/research/ARCHITECTURE.md

# Closest plan precedent — single-plan operator-driven spike shape (3-task structure to mirror)
@.planning/phases/25-spatial-predicate-spike/25-01-spatial-predicate-spike-PLAN.md
@.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md

# Structural model for runner code (mirror byte-for-byte for boilerplate)
@kinetica_bi/server/src/spatialPredicateSpike.ts
@kinetica_bi/server/src/wmsSpike.ts
@kinetica_bi/server/src/kinetica.ts
@kinetica_bi/server/package.json

# Current code under test (Lane A probes the existing emitter)
@kinetica_bi/src/lib/wmsUrlBuilder.ts

<interfaces>
<!-- Environment variables operator must have set in kinetica_bi/server/.env -->

Pre-existing (from prior phase spikes):
- KINETICA_URL                  (e.g. http://172.31.0.22:8082/gpudb-0)
- KINETICA_USERNAME             (operator's BI username — password mode)
- KINETICA_PASSWORD             (operator's BI password)

NEW for Phase 37 spike (8 vars):
- CB_NUMERIC_TABLE              (default suggested: demo.nyctaxi — schema-qualified)
- CB_NUMERIC_COLUMN             (default suggested: fare_amount — wide numeric spread 0-200)
- CB_CATEGORICAL_TABLE          (default suggested: demo.nyctaxi — schema-qualified)
- CB_CATEGORICAL_COLUMN         (default suggested: payment_type — low-cardinality TEXT)
- TRACK_TABLE                   (operator-supplied; NO baked-in default; if absent, track probes SKIP with DEFERRED row)
- TRACK_ID_COL                  (operator-supplied; e.g. TRACKID)
- TRACK_ORDER_COL               (operator-supplied; e.g. TIMESTAMP)
- TRACK_X_COL                   (operator-supplied; track-table longitude column)
- TRACK_Y_COL                   (operator-supplied; track-table latitude column)

Constants baked into runner (NOT env-var-driven — CONTEXT.md locked):
- BBOX = "-74.05,40.65,-73.85,40.85"  (EPSG:4326, Manhattan ±0.1°; Phase 25 anchor; demo.nyctaxi dense data here)
- WIDTH = 512
- HEIGHT = 512
- FORMAT = "image/png"
- SRS = "EPSG:4326"

Three CB lanes (probe ALL three in every run; never early-exit):
  Lane A (codebase-current — what wmsUrlBuilder.ts:325-340 emits today):
    STYLES=classbreak
    CB_COLUMN_NAME=<col>
    CB_BREAK_TYPE=NUMERICAL  (or CATEGORICAL for categorical fixture)
    CB_BREAK_POINT_1=10        CB_POINTCOLOR_1=FF112233
    CB_BREAK_POINT_2=25        CB_POINTCOLOR_2=FF445566
    CB_BREAK_POINT_3=50        CB_POINTCOLOR_3=FF7788AA
    CB_BREAK_POINT_4=100       CB_POINTCOLOR_4=FFCC1100
    CB_BREAK_POINT_5=200       CB_POINTCOLOR_5=FF00CC11

  Lane B (Kinetica 7.1 docs — what STACK research surfaced):
    STYLES=classbreak
    CB_ATTR=<col>
    CB_VALS=10,25,50,100,200   (numeric)  OR  CB_VALS=cash,credit,<other>  (categorical)
    CB_POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11

  Lane C (raster-style under STYLES=cb_raster — operator's high-confidence domain note):
    STYLES=cb_raster
    CB_ATTR=<col>                                   (re-use docs naming for column reference)
    CB_VALS=10,25,50,100,200
    POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11
    POINTSIZES=4,5,6,7,8
    POINTSHAPES=circle,circle,circle,circle,circle  (smoke test: comma-separated raster params accepted under cb_raster?)

Categorical edge-case probes (against CB_CATEGORICAL_TABLE/COLUMN — e.g. demo.nyctaxi.payment_type):
  Edge-1 <other> keyword (under each PASS-ing lane):
    CB_VALS=cash,credit,<other>          (Lane B/C)
    CB_BREAK_POINT_1=cash, CB_BREAK_POINT_2=credit, CB_BREAK_POINT_3=<other>  (Lane A)
  Edge-2 comma-escape (synthetic — may be N/A if no comma-containing fixture values):
    CB_VALS="foo,bar",baz                (quoted variant)
    CB_VALS=foo\,bar,baz                 (backslash-escaped variant)
    -- Decision Record records "N/A — no comma values in fixture" if both fail with no comma-containing data; runner attempts both forms and captures verbatim Kinetica response so format ambiguity is documented
  Edge-3 NULL bucket (issue CB_VALS=cash,credit and observe how Kinetica buckets NULL rows on column):
    -- Three possible outcomes documented in Decision Record: NULLs map to <other> / NULLs are excluded / NULLs render as their own bucket
  Edge-4 mixed numeric/categorical (force-bad — confirm Kinetica errors cleanly):
    CB_VALS=1:5,10:20,"high"            (against the TEXT column — expect HTTP 400 with explanatory body, NOT silent garbage)

Color-format probes (under EACH of Lane A, Lane B, Lane C):
  Color-6 6-char RRGGBB:    POINTCOLORS=112233,445566 (Lane C); CB_POINTCOLORS=112233,445566 (Lane B); CB_POINTCOLOR_1=112233 (Lane A)
  Color-8 8-char AARRGGBB:  POINTCOLORS=FF112233,FF445566; CB_POINTCOLORS=FF112233,FF445566; CB_POINTCOLOR_1=FF112233
  -- Save both tile bytes per lane (37-color-{lane}-6char.png / 37-color-{lane}-8char.png); operator pastes visual diff into 37-SPIKE-NOTES.md

Track probes (skip-with-DEFERRED-row if TRACK_TABLE env var absent):
  All 9 documented TRACK_* params probed under BOTH STYLES=raster AND STYLES=cb_raster (18-cell matrix):
    DOTRACKS=TRUE                                         (gating param — under raster only; cb_raster implies tracks via cb_raster style itself)
    TRACK_ID_ATTR=<TRACK_ID_COL>
    TRACK_ORDER_ATTR=<TRACK_ORDER_COL>
    TRACKHEADCOLORS=FFFF0000                              (single under raster; comma-sep under cb_raster: FFFF0000,FF00FF00,FF0000FF)
    TRACKLINECOLORS=FF0000FF                              (single under raster; comma-sep under cb_raster)
    TRACKHEADSIZES=8                                      (single under raster; comma-sep under cb_raster)
    TRACKLINEWIDTHS=2                                     (single under raster; comma-sep under cb_raster)
    TRACKMARKERSHAPES=circle                              (single under raster; comma-sep under cb_raster; ALSO probe TRACKHEADSHAPES alternate naming for lock)
    TRACKHEADSHAPES=circle                                (alternate naming — probe both to lock which form Kinetica accepts)

NTILE quantile SQL probe (runs via /execute/sql against deployed Kinetica with production-parity 7-field body):
  NTILE-A: SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY <CB_NUMERIC_COLUMN>) AS bucket, <CB_NUMERIC_COLUMN> FROM <CB_NUMERIC_TABLE> LIMIT 1000
  NTILE-B (fallback if -A fails): SELECT NTILE(5) OVER (ORDER BY <CB_NUMERIC_COLUMN>) AS bucket, <CB_NUMERIC_COLUMN> FROM <CB_NUMERIC_TABLE> LIMIT 1000
  -- Decision Record locks the working form; if both fail, /api/quantile is disabled in Phase 38 (CB-V17-06 Auto-suggest deferred to v1.8)

Raster baseline reference (under each fixture):
  STYLES=raster + POINTCOLORS=FF00CC11 (single bright green) — saved to 37-baseline-raster-<fixture>.png as the "no CB applied" reference for tile-diff evidence. If a CB-lane tile is visually identical to this baseline, the CB params were silently ignored — that lane FAILs regardless of HTTP 200.

PASS criterion (strong — adapted from Phase 25):
  PASS = HTTP 200 AND content-type starts with "image/" AND PNG tile bytes differ from the raster-baseline tile bytes for the same fixture (visual-diff evidence by operator)
  FAIL = HTTP non-2xx OR content-type != image/* OR PNG bytes byte-identical-or-near-identical to raster baseline (param silently ignored)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Write cbTrackSpike runner (kinetica_bi/server/src/cbTrackSpike.ts) + npm-script wire-up + spike-output gitignore + 37-SPIKE-NOTES.md template skeleton</name>
  <files>kinetica_bi/server/src/cbTrackSpike.ts, kinetica_bi/server/package.json, .gitignore, .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md</files>
  <read_first>
    - kinetica_bi/server/src/spatialPredicateSpike.ts (CLOSEST structural model — mirror byte-for-byte for dotenv loading, env-var validation, basicAuth, redactedUrl, rawFetch, runSql, classify, banner format, SPIKE SUMMARY block; swap predicate probes for WMS GetMap probes + add multi-render-mode and multi-fixture loops)
    - kinetica_bi/server/src/wmsSpike.ts (WMS-side probe precedent — pattern for WMS GetMap via fetch() with Basic auth header; content-type checking; raw response handling)
    - kinetica_bi/server/src/wkbSpike.ts (Phase 18 runner; production-payload-parity reference at commit d458408)
    - kinetica_bi/server/src/kinetica.ts (lines 154-184 — canonical /execute/sql request body for the NTILE probe; the runner's runSql() MUST send the exact 7-field body: statement, offset, limit, encoding, request_schema_str, data, options; NEVER the bare {statement, limit} shape — Phase 18 lost a round-trip to that exact bug)
    - kinetica_bi/server/package.json (read the "scripts" block — wms-spike + wkb-spike + spatial-predicate-spike are registered there; cb-track-spike will be added alongside them, preserving all three existing entries)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (lines 25, 27, 200-260, 270-350 — current classbreak emitter that Lane A probes; the 6-char b.color.toUpperCase() bug at line 337; normalizeAARRGGBB import at line 25 used by raster branch)
    - .planning/phases/37-cb-track-wms-spike/37-CONTEXT.md (LOCKED decisions — three CB lanes A/B/C, four categorical edge cases, 18-cell TRACK_* matrix, NTILE in-scope, color-format probes, Manhattan bbox -74.05,40.65,-73.85,40.85, total-fail escalation rules, password-mode auth, env-var-driven track table with DEFERRED-skip fallback)
    - .planning/phases/25-spatial-predicate-spike/25-01-spatial-predicate-spike-PLAN.md (3-task plan structure precedent: write runner + npm script → operator runs → write notes)
    - .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md (Decision Record format precedent — ## Probe blocks + ## Decision + ## Caveats + ## Open Question Resolutions; format the 37-SPIKE-NOTES.md template skeleton to match)
    - .planning/research/STACK.md §"CB param names" + §"Track params" + §"Quantile SQL" (probe design context)
    - .planning/research/PITFALLS.md §"CB color format" (6-char bug location and consequence)
    - .gitignore (repo root — current entries; spike-output/ needs to be appended; existing kinetica_bi/server/src/wmsCapabilities.xml gitignore entry is precedent for spike-artifact gitignoring)
  </read_first>
  <action>
    Create `kinetica_bi/server/src/cbTrackSpike.ts` as a one-shot tsx CLI script (NOT part of the Express app). Mirror `kinetica_bi/server/src/spatialPredicateSpike.ts` byte-for-byte for the boilerplate (dotenv loading, env-var validation, basicAuth, redactedUrl, rawFetch, runSql, classify, banner format), then implement the probe matrix for three CB lanes × two fixtures + four categorical edge cases + 18-cell TRACK_* matrix + NTILE + color-format probes. ALSO: add the npm script entry, append `spike-output/` to repo-root .gitignore, AND write the `37-SPIKE-NOTES.md` template skeleton (empty section structure for Task 3 to fill from operator's Task 2 paste).

    Required structure for `cbTrackSpike.ts` (sections in order):

    1. **Header comment block** — file purpose, USAGE (`cd kinetica_bi/server && npm run cb-track-spike`), REQUIRED .env VARS (the 3 pre-existing + 4 numeric/categorical fixture + 5 optional track fixture vars), OUTPUT (stdout lines per probe + PNG tile bytes to `kinetica_bi/server/spike-output/` + SPIKE SUMMARY block), NOT-PART-OF-APP marker. Cite Phase 18 commit `d458408` as the payload-parity reference for the NTILE probe.

    2. **Imports + env loading** — copy verbatim from `spatialPredicateSpike.ts:40-54`:
       ```typescript
       import dotenv from "dotenv";
       import { writeFileSync, mkdirSync } from "node:fs";
       import { resolve, dirname } from "node:path";
       import { fileURLToPath } from "node:url";

       dotenv.config();

       const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
       const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
       const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;

       if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
         console.error("[cb-track-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env");
         process.exit(1);
       }

       const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
       const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");
       ```

    3. **Operator setup section — fixture env vars** — read these (with same missing-var error pattern as `spatialPredicateSpike.ts:67-90`):
       - CB_NUMERIC_TABLE (e.g. `demo.nyctaxi`)
       - CB_NUMERIC_COLUMN (e.g. `fare_amount`)
       - CB_CATEGORICAL_TABLE (e.g. `demo.nyctaxi`)
       - CB_CATEGORICAL_COLUMN (e.g. `payment_type`)

       If any of the 4 CB fixture vars are missing, log the example template (verbatim values above) and exit 1.

       Track fixture vars are OPTIONAL — read them but do NOT exit:
       - TRACK_TABLE (no default; if missing, TRACK_PROBES_ENABLED = false)
       - TRACK_ID_COL (e.g. `TRACKID`)
       - TRACK_ORDER_COL (e.g. `TIMESTAMP`)
       - TRACK_X_COL
       - TRACK_Y_COL

       ```typescript
       const TRACK_PROBES_ENABLED = Boolean(TRACK_TABLE && TRACK_ID_COL && TRACK_ORDER_COL && TRACK_X_COL && TRACK_Y_COL);
       if (!TRACK_PROBES_ENABLED) {
         console.log("[cb-track-spike] WARNING: TRACK_TABLE/TRACK_ID_COL/TRACK_ORDER_COL/TRACK_X_COL/TRACK_Y_COL not all set in .env — Track probes will SKIP with DEFERRED status per 37-CONTEXT.md fallback");
       }
       ```

       Log a banner:
       `[cb-track-spike] Deployed Kinetica: ${redactedUrl}`
       `[cb-track-spike] User: ${KINETICA_USERNAME}`
       `[cb-track-spike] CB numeric fixture: ${CB_NUMERIC_TABLE}.${CB_NUMERIC_COLUMN}`
       `[cb-track-spike] CB categorical fixture: ${CB_CATEGORICAL_TABLE}.${CB_CATEGORICAL_COLUMN}`
       `[cb-track-spike] Track fixture: ${TRACK_PROBES_ENABLED ? `${TRACK_TABLE}.${TRACK_ID_COL}/${TRACK_ORDER_COL}/${TRACK_X_COL}/${TRACK_Y_COL}` : "DEFERRED (no env vars)"}`
       `[cb-track-spike] BBOX (Manhattan, locked): -74.05,40.65,-73.85,40.85 EPSG:4326`

    4. **Constants section** — bake in the CONTEXT.md-locked values:
       ```typescript
       const BBOX = "-74.05,40.65,-73.85,40.85"; // EPSG:4326, Manhattan ±0.1°; matches Phase 25 anchor
       const WIDTH = 512;
       const HEIGHT = 512;
       const FORMAT = "image/png";
       const SRS = "EPSG:4326";
       const SPIKE_OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "spike-output");
       mkdirSync(SPIKE_OUTPUT_DIR, { recursive: true });
       ```

    5. **rawFetch + runSql + getMap helpers** — `rawFetch` and `runSql` copy VERBATIM from `spatialPredicateSpike.ts:113-160` (the 7-field /execute/sql payload doc-comment MUST be carried over). Add a new `getMap` helper for WMS probes:
       ```typescript
       async function getMap(params: Record<string, string>, outPath: string): Promise<{ ok: boolean; status: number; contentType: string; bytesLen: number; bodyText?: string }> {
         const url = `${KINETICA_URL}/wms?${new URLSearchParams(params).toString()}`;
         try {
           const response = await rawFetch(url);
           const contentType = response.headers.get("content-type") ?? "";
           if (response.ok && contentType.includes("image")) {
             const buf = Buffer.from(await response.arrayBuffer());
             writeFileSync(outPath, buf);
             return { ok: true, status: response.status, contentType, bytesLen: buf.byteLength };
           }
           // Non-image response — capture body text for Kinetica error message
           const bodyText = await response.text();
           return { ok: false, status: response.status, contentType, bytesLen: 0, bodyText };
         } catch (e) {
           return { ok: false, status: -1, contentType: "", bytesLen: 0, bodyText: String(e) };
         }
       }
       ```

       Each `getMap` call constructs WMS GetMap URL via `new URLSearchParams({SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: tableRef, BBOX, WIDTH: String(WIDTH), HEIGHT: String(HEIGHT), FORMAT, SRS, STYLES, ...probeParams})`. Saves response bytes to `spike-output/37-{probe-id}.png` if `content-type` starts with `image/`; otherwise captures `bodyText` so Kinetica error messages (HTTP 400 with "Unknown parameter CB_ATTR" etc.) land in stdout verbatim.

    6. **Baseline probes** — emit a raster baseline tile per fixture so subsequent CB-lane tiles have a known-good reference for visual-diff evidence:
       ```
       === Probe BASELINE-NUM: STYLES=raster baseline for ${CB_NUMERIC_TABLE} ===
       params: SERVICE=WMS REQUEST=GetMap VERSION=1.1.1 LAYERS=${CB_NUMERIC_TABLE} BBOX=${BBOX} WIDTH=512 HEIGHT=512 FORMAT=image/png SRS=EPSG:4326 STYLES=raster POINTCOLORS=FF00CC11
       outPath: spike-output/37-baseline-num.png
       ```
       Same for `BASELINE-CAT` against `${CB_CATEGORICAL_TABLE}`. Without these, the operator cannot tell whether a CB-lane tile "differs from raster" — they'd have nothing to compare to.

    7. **Lane A probes (codebase-current — STYLES=classbreak with CB_COLUMN_NAME/CB_BREAK_POINT_N/CB_POINTCOLOR_N)** — for each fixture (numeric, categorical):
       ```
       === Probe A-NUM-8: Lane A numeric, STYLES=classbreak, 8-char colors ===
       params: STYLES=classbreak CB_COLUMN_NAME=fare_amount CB_BREAK_TYPE=NUMERICAL
               CB_BREAK_POINT_1=10  CB_POINTCOLOR_1=FF112233
               CB_BREAK_POINT_2=25  CB_POINTCOLOR_2=FF445566
               CB_BREAK_POINT_3=50  CB_POINTCOLOR_3=FF7788AA
               CB_BREAK_POINT_4=100 CB_POINTCOLOR_4=FFCC1100
               CB_BREAK_POINT_5=200 CB_POINTCOLOR_5=FF00CC11
       outPath: spike-output/37-A-num-8.png

       === Probe A-NUM-6: Lane A numeric, STYLES=classbreak, 6-char colors (current bug shape) ===
       params: same CB_BREAK_POINT_* but CB_POINTCOLOR_1=112233 CB_POINTCOLOR_2=445566 ... etc (6-char RRGGBB; emit literally the b.color.toUpperCase() shape from wmsUrlBuilder.ts:337)
       outPath: spike-output/37-A-num-6.png

       === Probe A-CAT-8: Lane A categorical, STYLES=classbreak, 8-char colors ===
       params: STYLES=classbreak CB_COLUMN_NAME=payment_type CB_BREAK_TYPE=CATEGORICAL
               CB_BREAK_POINT_1=cash    CB_POINTCOLOR_1=FF112233
               CB_BREAK_POINT_2=credit  CB_POINTCOLOR_2=FF445566
               CB_BREAK_POINT_3=<other> CB_POINTCOLOR_3=FF7788AA
       outPath: spike-output/37-A-cat-8.png

       === Probe A-CAT-6: Lane A categorical, 6-char colors ===
       params: same as A-CAT-8 but 6-char colors
       outPath: spike-output/37-A-cat-6.png
       ```

    8. **Lane B probes (Kinetica 7.1 docs — STYLES=classbreak with CB_ATTR/CB_VALS/CB_POINTCOLORS)**:
       ```
       === Probe B-NUM-8: Lane B numeric, STYLES=classbreak, 8-char colors ===
       params: STYLES=classbreak CB_ATTR=fare_amount CB_VALS=10,25,50,100,200 CB_POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11
       outPath: spike-output/37-B-num-8.png

       === Probe B-NUM-6: Lane B numeric, 6-char colors ===
       params: STYLES=classbreak CB_ATTR=fare_amount CB_VALS=10,25,50,100,200 CB_POINTCOLORS=112233,445566,7788AA,CC1100,00CC11
       outPath: spike-output/37-B-num-6.png

       === Probe B-CAT-8: Lane B categorical, 8-char colors, <other> keyword ===
       params: STYLES=classbreak CB_ATTR=payment_type CB_VALS=cash,credit,<other> CB_POINTCOLORS=FF112233,FF445566,FF7788AA
       outPath: spike-output/37-B-cat-8.png

       === Probe B-CAT-6: Lane B categorical, 6-char colors ===
       params: same as B-CAT-8 but CB_POINTCOLORS=112233,445566,7788AA
       outPath: spike-output/37-B-cat-6.png
       ```

    9. **Lane C probes (raster-style under STYLES=cb_raster — operator's high-confidence domain note)**:
       ```
       === Probe C-NUM-8: Lane C numeric, STYLES=cb_raster, 8-char colors, comma-separated raster params ===
       params: STYLES=cb_raster CB_ATTR=fare_amount CB_VALS=10,25,50,100,200 POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11 POINTSIZES=4,5,6,7,8 POINTSHAPES=circle,circle,circle,circle,circle
       outPath: spike-output/37-C-num-8.png

       === Probe C-NUM-6: Lane C numeric, 6-char colors ===
       params: same as C-NUM-8 but POINTCOLORS=112233,445566,7788AA,CC1100,00CC11
       outPath: spike-output/37-C-num-6.png

       === Probe C-CAT-8: Lane C categorical, 8-char colors, <other> keyword ===
       params: STYLES=cb_raster CB_ATTR=payment_type CB_VALS=cash,credit,<other> POINTCOLORS=FF112233,FF445566,FF7788AA POINTSIZES=4,5,6
       outPath: spike-output/37-C-cat-8.png

       === Probe C-CAT-6: Lane C categorical, 6-char colors ===
       params: same as C-CAT-8 but POINTCOLORS=112233,445566,7788AA
       outPath: spike-output/37-C-cat-6.png
       ```

    10. **Categorical edge-case probes (Edge-2 comma-escape + Edge-3 NULL + Edge-4 mixed)** — under whichever CB lane gives the best signal (default to Lane C for cb_raster, but also probe Lane B for comparison):
        ```
        === Probe EDGE-2-QUOTED: comma-escape, quoted variant, Lane B ===
        params: STYLES=classbreak CB_ATTR=payment_type CB_VALS="foo,bar",baz CB_POINTCOLORS=FF112233,FF445566
        outPath: spike-output/37-edge-2-quoted.png

        === Probe EDGE-2-BACKSLASH: comma-escape, backslash variant, Lane B ===
        params: STYLES=classbreak CB_ATTR=payment_type CB_VALS=foo\,bar,baz CB_POINTCOLORS=FF112233,FF445566
        outPath: spike-output/37-edge-2-backslash.png

        === Probe EDGE-3-NULL: NULL bucket behavior, Lane B (NULLs in payment_type column tracked via diff against B-CAT-8 baseline) ===
        params: STYLES=classbreak CB_ATTR=payment_type CB_VALS=cash,credit CB_POINTCOLORS=FF112233,FF445566 (NOTE: no <other> bucket — observe where NULLs land in resulting tile)
        outPath: spike-output/37-edge-3-null.png

        === Probe EDGE-4-MIXED: mixed numeric:range/categorical mix, force-bad, Lane B (expect HTTP 400 with explanatory error) ===
        params: STYLES=classbreak CB_ATTR=payment_type CB_VALS=1:5,10:20,"high" CB_POINTCOLORS=FF112233,FF445566,FF7788AA
        outPath: spike-output/37-edge-4-mixed.png   (likely .txt — non-image response)
        ```
        Capture bodyText verbatim — Edge-4 is expected to be HTTP 400 with a Kinetica explanatory message; that message itself is the evidence.

    11. **NTILE quantile SQL probes (in scope per CONTEXT.md)** — these go through `runSql` (NOT `getMap`); production-payload-parity 7-field body MANDATORY:
        ```
        === Probe NTILE-A: PARTITION BY 0 form ===
        SQL: SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE} LIMIT 1000

        === Probe NTILE-B: bare ORDER BY (fallback) ===
        SQL: SELECT NTILE(5) OVER (ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE} LIMIT 1000

        === Probe NTILE-C: bucket-boundaries wrapper (validate /api/quantile design — extract MIN(col) per bucket) ===
        SQL: SELECT bucket, MIN(${CB_NUMERIC_COLUMN}) AS boundary FROM (SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE}) GROUP BY bucket ORDER BY bucket
        ```
        Emit verbatim SQL + HTTP status + full body JSON for each. Decision Record locks the form for Phase 38 /api/quantile.

    12. **TRACK_* matrix probes (skip block entirely if TRACK_PROBES_ENABLED === false)** — 18-cell matrix (9 params × 2 render modes):
        ```typescript
        if (TRACK_PROBES_ENABLED) {
          // Under STYLES=raster (DOTRACKS gating):
          //   T-R-1 DOTRACKS=TRUE alone (smoke: does the gating param render tracks?)
          //   T-R-2 + TRACK_ID_ATTR=<col>
          //   T-R-3 + TRACK_ORDER_ATTR=<col>
          //   T-R-4 + TRACKHEADCOLORS=FFFF0000 (single value)
          //   T-R-5 + TRACKLINECOLORS=FF0000FF (single)
          //   T-R-6 + TRACKHEADSIZES=8 (single)
          //   T-R-7 + TRACKLINEWIDTHS=2 (single)
          //   T-R-8 + TRACKMARKERSHAPES=circle (single)
          //   T-R-9 + TRACKHEADSHAPES=circle (alternate naming — probe both T-R-8 and T-R-9 to lock which Kinetica accepts)
          // Cumulative — each probe adds to the prior probe's params so the operator can see incremental effect on the tile.

          // Under STYLES=cb_raster (comma-sep raster params + tracks under classbreak):
          //   T-CB-1 CB lane that PASSed (default to Lane C as highest-confidence per CONTEXT.md) + DOTRACKS=TRUE (smoke: does DOTRACKS even apply under cb_raster, or is cb_raster track-implicit?)
          //   T-CB-2..T-CB-9 each TRACK_* param in comma-separated form (e.g. TRACKHEADCOLORS=FFFF0000,FF00FF00,FF0000FF)
        }
        ```

        Each probe block emits:
        ```typescript
        console.log("=== Probe T-R-4: STYLES=raster + DOTRACKS=TRUE + TRACK_ID_ATTR + TRACK_ORDER_ATTR + TRACKHEADCOLORS=FFFF0000 ===");
        console.log(`[cb-track-spike] params: ${JSON.stringify(probeParams)}`);
        const result = await getMap(probeParams, resolve(SPIKE_OUTPUT_DIR, "37-T-R-4.png"));
        console.log(`[cb-track-spike] HTTP status: ${result.status}, content-type: ${result.contentType}, bytes: ${result.bytesLen}`);
        if (result.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${result.bodyText.slice(0, 1000)}`);
        console.log("");
        ```

        Use `${TRACK_TABLE}` for LAYERS, `${TRACK_X_COL}` for X column (X_ATTR), `${TRACK_Y_COL}` for Y column (Y_ATTR), `${TRACK_ID_COL}` for TRACK_ID_ATTR, `${TRACK_ORDER_COL}` for TRACK_ORDER_ATTR. BBOX stays Manhattan locked — operator chooses a track table where data falls within that bbox OR the spike will produce empty-but-200 tiles (still useful for HTTP-status verdict; visual-diff verdict needs operator's track-fixture-overlap awareness).

    13. **SPIKE SUMMARY block** — at the end, emit a classify-and-summarize block mirroring `spatialPredicateSpike.ts:418-470`:
        ```typescript
        console.log("=== SPIKE SUMMARY ===");
        console.log("");
        console.log(`Baseline tiles: spike-output/37-baseline-num.png, spike-output/37-baseline-cat.png`);
        console.log(`Lane A probes (codebase-current naming): ${LANE_A_PASS_SHORTLIST}`);
        console.log(`Lane B probes (Kinetica 7.1 docs naming): ${LANE_B_PASS_SHORTLIST}`);
        console.log(`Lane C probes (raster-style under cb_raster): ${LANE_C_PASS_SHORTLIST}`);
        console.log(`Color format: 6-char tiles vs 8-char tiles per lane saved — operator visually compares`);
        console.log(`Categorical edge cases: EDGE-2/EDGE-3/EDGE-4 outputs in spike-output/`);
        console.log(`NTILE probes: ${NTILE_VERDICTS} — see NTILE-A/NTILE-B/NTILE-C body JSON above`);
        if (TRACK_PROBES_ENABLED) {
          console.log(`Track probes: 18-cell matrix complete — tiles in spike-output/37-T-R-*.png + 37-T-CB-*.png`);
        } else {
          console.log(`Track probes: DEFERRED — no TRACK_TABLE/TRACK_ID_COL/TRACK_ORDER_COL/TRACK_X_COL/TRACK_Y_COL env vars set`);
        }
        console.log("");
        console.log(`[cb-track-spike] Done. Paste this full stdout + open spike-output/37-*.png tiles for visual-diff verification, then complete Task 2 with the operator handoff.`);
        ```
        Where `LANE_*_PASS_SHORTLIST` is built from a `classify()`-style helper that returns `["PASS" | "FAIL", reason]` per probe — PASS requires HTTP 200 AND `bytesLen > 1000` (sanity: real tiles are ≥1KB; Kinetica empty-response error tiles can be <500 bytes). The operator confirms VISUAL difference vs baseline separately in Task 2 — the script's PASS is a precondition; visual-diff confirmation is the strong criterion.

    14. **Anti-patterns to avoid** (DO NOT do these):
        - DO NOT send `{ statement, limit }` only for the NTILE probe — production-parity 7-field body verbatim per `kinetica.ts:174-182`.
        - DO NOT hardcode CB column names, table names, or track column names — use env-var values.
        - DO NOT skip Lane A even though we already know its 6-char color is buggy — Lane A is the regression-evidence baseline; the spike documents what TODAY's code emits and how Kinetica actually responds to it.
        - DO NOT vary BBOX/WIDTH/HEIGHT across probes — Manhattan +-0.1° / 512x512 are locked so tile-diff comparisons are apples-to-apples.
        - DO NOT skip the raster baselines — without them the operator cannot tell if a CB-lane tile is "differently rendered" or "raster-fallback rendered."
        - DO NOT early-exit on first PASS — every probe runs, every tile saved, even on failure (CONTEXT.md: "Decision Record summarises which naming + format worked per render mode per fixture").
        - DO NOT execute any probes from this task — Claude only WRITES the script. Operator runs it in Task 2.
        - DO NOT write actual probe results into 37-SPIKE-NOTES.md in this task — only the empty section skeleton. Task 3 fills the verdicts.
        - DO NOT add try/catch around the script body — let it crash with a stack trace if env vars are misconfigured (operator-friendly debugging).
        - DO NOT import from project modules like `kinetica_bi/server/src/lib/spatialQuery.ts` — runner stays self-contained per Phase 25 precedent.

    THEN — update `kinetica_bi/server/package.json`:
       Preserve `wms-spike`, `wkb-spike`, `spatial-predicate-spike` entries verbatim; add NEW entry:
       ```json
       "cb-track-spike": "tsx src/cbTrackSpike.ts"
       ```

    THEN — append to repo-root `.gitignore`:
       ```
       # CB+Track WMS spike raw tile-byte output (Phase 37) — only 37-SPIKE-NOTES.md + pasted screenshots commit
       kinetica_bi/server/spike-output/
       ```

    THEN — write `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` template skeleton (empty section structure ONLY — Task 3 fills the verdicts from operator's Task 2 paste):
       ```markdown
       # Phase 37 — CB/Track WMS Spike Notes

       **Spike date:** <ISO date YYYY-MM-DD — fill in Task 3>
       **Deployed Kinetica:** <KINETICA_URL value with credentials redacted — fill in Task 3>
       **Operator:** <username from KINETICA_USERNAME — fill in Task 3>
       **Kinetica version:** <operator-provided in Task 2 — fill in Task 3, or "unknown">
       **CB numeric fixture:** <CB_NUMERIC_TABLE>.<CB_NUMERIC_COLUMN>
       **CB categorical fixture:** <CB_CATEGORICAL_TABLE>.<CB_CATEGORICAL_COLUMN>
       **Track fixture:** <TRACK_TABLE.TRACK_ID_COL/TRACK_ORDER_COL/TRACK_X_COL/TRACK_Y_COL — or "DEFERRED (no env vars supplied)">
       **Probe bbox (locked):** -74.05,40.65,-73.85,40.85 EPSG:4326 (Manhattan ±0.1°)
       **Probe tile size (locked):** 512×512 image/png
       **Auth mode:** password (OIDC deferred to Phase 43 UAT per CONTEXT.md "Auth mode coverage")
       **Confidence:** <HIGH (all probes verified with visual tile diff) | MEDIUM (one or more probes ambiguous — documented in Caveats) | LOW (NONE_ESCALATE on all three CB lanes — milestone re-scope per CONTEXT.md "Total-fail escalation")>

       ## Baseline Probes
       ### BASELINE-NUM — STYLES=raster baseline for numeric fixture
       <Verbatim params + HTTP status + bytesLen + tile path; pasted screenshot if relevant>

       ### BASELINE-CAT — STYLES=raster baseline for categorical fixture
       <same>

       ## Lane A Probes — STYLES=classbreak, codebase-current naming (CB_COLUMN_NAME / CB_BREAK_POINT_N / CB_POINTCOLOR_N)
       ### Probe A-NUM-8 — Lane A numeric, 8-char colors
       <Verbatim params + HTTP status + bytesLen + tile path + visual-diff verdict against BASELINE-NUM>
       ### Probe A-NUM-6 — Lane A numeric, 6-char colors (current wmsUrlBuilder.ts:337 bug shape)
       <same>
       ### Probe A-CAT-8 — Lane A categorical, 8-char colors
       <same>
       ### Probe A-CAT-6 — Lane A categorical, 6-char colors
       <same>

       ## Lane B Probes — STYLES=classbreak, Kinetica 7.1 docs naming (CB_ATTR / CB_VALS / CB_POINTCOLORS)
       ### Probe B-NUM-8 — Lane B numeric, 8-char colors
       <same>
       ### Probe B-NUM-6 — Lane B numeric, 6-char colors
       <same>
       ### Probe B-CAT-8 — Lane B categorical, 8-char colors, <other> keyword
       <same>
       ### Probe B-CAT-6 — Lane B categorical, 6-char colors
       <same>

       ## Lane C Probes — STYLES=cb_raster, raster-style comma-separated params (operator's high-confidence path)
       ### Probe C-NUM-8 — Lane C numeric, 8-char colors, comma-separated POINTCOLORS/POINTSIZES/POINTSHAPES
       <same>
       ### Probe C-NUM-6 — Lane C numeric, 6-char colors
       <same>
       ### Probe C-CAT-8 — Lane C categorical, 8-char colors, <other> keyword
       <same>
       ### Probe C-CAT-6 — Lane C categorical, 6-char colors
       <same>

       ## Categorical Edge-Case Probes
       ### Probe EDGE-2-QUOTED — comma-escape, "foo,bar",baz form
       <Verbatim params + HTTP status + body text (likely 400-class) + interpretation>
       ### Probe EDGE-2-BACKSLASH — comma-escape, foo\,bar,baz form
       <same>
       ### Probe EDGE-3-NULL — NULL bucket behavior (CB_VALS without <other>)
       <same — interpretation MUST specify where NULLs landed: <other> / excluded / own-bucket>
       ### Probe EDGE-4-MIXED — mixed numeric:range/categorical (expected HTTP 400 with explanatory body)
       <same — interpretation MUST confirm Kinetica errors cleanly, NOT silent garbage>

       ## Color-Format Probes — summary across lanes
       <Tabular comparison: Lane × 6-char-tile-path × 8-char-tile-path × visual-diff-verdict + verdict on which format Kinetica honors>

       ## NTILE Quantile Probes
       ### Probe NTILE-A — PARTITION BY 0 form
       <Verbatim SQL + HTTP status + body JSON verbatim + PASS/FAIL + parsed bucket boundaries if PASS>
       ### Probe NTILE-B — bare ORDER BY form (fallback)
       <same>
       ### Probe NTILE-C — bucket-boundaries wrapper (Phase 38 /api/quantile design validation)
       <same>

       ## Track Probes
       <If TRACK_PROBES_ENABLED was false at spike run time: write "DEFERRED — no operator-supplied track fixture; Phase 40 ships operator-override-only path per CONTEXT.md fallback. Re-runnable via `npm run cb-track-spike` once a track table is reachable.">
       <If TRACK_PROBES_ENABLED was true: 18 sub-headers — T-R-1..T-R-9 (under STYLES=raster) and T-CB-1..T-CB-9 (under STYLES=cb_raster) with cumulative-effect interpretation>

       ## Decision

       **CB param-name set locked per render mode:**
       - STYLES=classbreak: <Lane A naming | Lane B naming | NONE_ESCALATE>
       - STYLES=cb_raster:  <Lane C naming | NONE_ESCALATE>
       - Rationale: <which lanes PASSed, which failed silently, why the locked set is the Phase 38 implementation target>

       **Color format locked:**
       - <8-char AARRGGBB | 6-char RRGGBB | accepts-both>
       - Rationale: <tile-diff evidence summary>
       - Phase 38 SCHEMA-V17-05 directive: <swap b.color.toUpperCase() at wmsUrlBuilder.ts:337 to normalizeAARRGGBB | leave as-is | something else>

       **NTILE syntax locked:**
       - <NTILE(n) OVER (PARTITION BY 0 ORDER BY col) | NTILE(n) OVER (ORDER BY col) | NEITHER WORKS — /api/quantile disabled, CB-V17-06 Auto-suggest deferred to v1.8>
       - Phase 38 SCHEMA-V17-06 directive: <use NTILE-A form | use NTILE-B form | disable /api/quantile endpoint>
       - Bucket-boundaries extraction: <NTILE-C wrapper works as designed | needs adjustment — see body>

       **DOTRACKS + TRACK_* matrix locked:**
       - Under STYLES=raster: DOTRACKS=TRUE <required | optional | rejected>; working TRACK_* param set: <enumerated>; TRACKMARKERSHAPES vs TRACKHEADSHAPES: <which Kinetica accepts>
       - Under STYLES=cb_raster: <TRACK_* via comma-separated values PASSED | FAILED (Phase 40 ships under raster only)>
       - Phase 40 SCHEMA-V17-04 directive: <emit DOTRACKS+TRACK_* under raster only | under raster AND classbreak | DEFERRED>

       **Overall outcome:**
       - <PASS — Phase 38 unblocked> | <PARTIAL: Lane B/C PASS unblocks Phase 38; Track skipped → Phase 40 narrows to override-only; NTILE failed → /api/quantile disabled> | <NONE_ESCALATE → BLOCK_V17 (all three CB lanes failed across both fixtures per CONTEXT.md "Total-fail escalation")>

       **SQL/URL templates Phase 38 will emit:**
       <Verbatim WMS-URL param-set per render mode + the NTILE SQL Phase 38 /api/quantile will issue>

       ## Caveats
       <Free-form: 150-vertex equivalent issues if any, Kinetica-version quirks, transient retries, HTTP-200-with-silent-no-op tiles (the v1.5 lesson surface), operator observations from Task 2 step 8.>

       ## Open Question Resolutions

       - **OQ-1 (CB param-name conflict — codebase CB_COLUMN_NAME/CB_BREAK_POINT_N vs docs CB_ATTR/CB_VALS):** RESOLVED → <locked naming + tile-diff evidence>
       - **OQ-2 (Color format — 6-char vs 8-char AARRGGBB):** RESOLVED → <locked format + tile-diff evidence>
       - **OQ-3 (Categorical <other> sink-bucket semantics):** RESOLVED → <how Kinetica handles unmatched-row routing>
       - **OQ-4 (Comma-escape syntax for CB_VALS):** RESOLVED → <quoted | backslash | both | N/A (no comma values in fixture)>
       - **OQ-5 (NULL bucket routing):** RESOLVED → <to <other> | excluded | own-bucket>
       - **OQ-6 (NTILE syntax — PARTITION BY 0 vs bare):** RESOLVED → <locked form>
       - **OQ-7 (DOTRACKS gating semantics — required for tracks under raster?):** RESOLVED → <yes/no/optional>
       - **OQ-8 (TRACKMARKERSHAPES vs TRACKHEADSHAPES naming):** RESOLVED → <which one Kinetica accepts>
       - **OQ-9 (CB_RASTER + TRACK_* comma-sep combo per operator's domain note):** RESOLVED → <combo PASSED | FAILED + body evidence>
       ```

       NOTE: Every `<...>` placeholder in the skeleton stays as-is in this Task 1 commit. Task 3 fills them.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/cbTrackSpike.ts` exists
    - File contains `import dotenv from "dotenv"` AND `dotenv.config()` (env-var loading mirrors Phase 25 precedent)
    - File contains the literal string `encoding: "json"` AND `request_schema_str` AND `data: []` AND `options: {}` (production-parity 7-field /execute/sql payload for NTILE probe — verified by grep)
    - File contains `BBOX = "-74.05,40.65,-73.85,40.85"` OR equivalent literal Manhattan bbox string with these exact 4 numbers (CONTEXT.md-locked anchor)
    - File contains `STYLES=classbreak` (Lane A + B) AND `STYLES=cb_raster` (Lane C) AND `STYLES=raster` (baseline + Track-under-raster) — verified by grep for `STYLES=classbreak`, `STYLES=cb_raster`, `STYLES=raster`
    - File contains all three CB lane param sets:
        - Lane A: `CB_COLUMN_NAME` AND `CB_BREAK_TYPE` AND `CB_BREAK_POINT_` AND `CB_POINTCOLOR_`
        - Lane B: `CB_ATTR` AND `CB_VALS` AND `CB_POINTCOLORS`
        - Lane C: `POINTCOLORS` AND `POINTSIZES`
    - File contains the literal string `<other>` (categorical sink-bucket keyword probe)
    - File contains `NTILE(` AND `PARTITION BY 0` AND `ORDER BY` (NTILE-A probe SQL)
    - File contains `mkdirSync` AND `writeFileSync` AND `spike-output` (PNG tile-byte capture)
    - File contains all 9 TRACK_* params: `DOTRACKS`, `TRACK_ID_ATTR`, `TRACK_ORDER_ATTR`, `TRACKHEADCOLORS`, `TRACKLINECOLORS`, `TRACKHEADSIZES`, `TRACKLINEWIDTHS`, `TRACKMARKERSHAPES`, `TRACKHEADSHAPES` (verified by grep returning exactly 9 distinct matches)
    - File reads env vars: `process.env.CB_NUMERIC_TABLE`, `process.env.CB_NUMERIC_COLUMN`, `process.env.CB_CATEGORICAL_TABLE`, `process.env.CB_CATEGORICAL_COLUMN`, `process.env.TRACK_TABLE`, `process.env.TRACK_ID_COL`, `process.env.TRACK_ORDER_COL`, `process.env.TRACK_X_COL`, `process.env.TRACK_Y_COL` (grep confirms each `process.env.<var>` reference)
    - File contains `TRACK_PROBES_ENABLED` boolean gate (so track probes SKIP cleanly when env vars absent per CONTEXT.md DEFERRED fallback)
    - File contains `=== SPIKE SUMMARY ===` literal (summary banner mirroring Phase 25)
    - File contains at least one `getMap(` function or equivalent WMS GetMap helper using `new URLSearchParams` and `rawFetch`
    - File contains the literal probe label `BASELINE-NUM` AND `BASELINE-CAT` (raster baselines for tile-diff reference)
    - `kinetica_bi/server/package.json` scripts object contains `"cb-track-spike": "tsx src/cbTrackSpike.ts"`
    - Existing `wms-spike`, `wkb-spike`, `spatial-predicate-spike` script entries preserved (regression check via grep)
    - Repo-root `.gitignore` contains `spike-output` (PNG bytes excluded from commits)
    - File `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` exists with template skeleton
    - 37-SPIKE-NOTES.md contains all required section headers: `## Baseline Probes`, `## Lane A Probes`, `## Lane B Probes`, `## Lane C Probes`, `## Categorical Edge-Case Probes`, `## Color-Format Probes`, `## NTILE Quantile Probes`, `## Track Probes`, `## Decision`, `## Caveats`, `## Open Question Resolutions` (grep returns exactly these section headers, in order)
    - 37-SPIKE-NOTES.md contains placeholder text like `<...>` indicating Task 3 still needs to fill it (NOT pre-fabricated verdicts)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (script type-checks against existing tsconfig)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && grep -q "import dotenv" src/cbTrackSpike.ts && grep -q 'encoding: "json"' src/cbTrackSpike.ts && grep -q "request_schema_str" src/cbTrackSpike.ts && grep -q "STYLES=classbreak" src/cbTrackSpike.ts && grep -q "STYLES=cb_raster" src/cbTrackSpike.ts && grep -q "STYLES=raster" src/cbTrackSpike.ts && grep -q "CB_COLUMN_NAME" src/cbTrackSpike.ts && grep -q "CB_BREAK_POINT_" src/cbTrackSpike.ts && grep -q "CB_POINTCOLOR_" src/cbTrackSpike.ts && grep -q "CB_ATTR" src/cbTrackSpike.ts && grep -q "CB_VALS" src/cbTrackSpike.ts && grep -q "CB_POINTCOLORS" src/cbTrackSpike.ts && grep -q "POINTCOLORS" src/cbTrackSpike.ts && grep -q "POINTSIZES" src/cbTrackSpike.ts && grep -q "<other>" src/cbTrackSpike.ts && grep -q "NTILE(" src/cbTrackSpike.ts && grep -q "PARTITION BY 0" src/cbTrackSpike.ts && grep -q "DOTRACKS" src/cbTrackSpike.ts && grep -q "TRACK_ID_ATTR" src/cbTrackSpike.ts && grep -q "TRACK_ORDER_ATTR" src/cbTrackSpike.ts && grep -q "TRACKHEADCOLORS" src/cbTrackSpike.ts && grep -q "TRACKLINECOLORS" src/cbTrackSpike.ts && grep -q "TRACKHEADSIZES" src/cbTrackSpike.ts && grep -q "TRACKLINEWIDTHS" src/cbTrackSpike.ts && grep -q "TRACKMARKERSHAPES" src/cbTrackSpike.ts && grep -q "TRACKHEADSHAPES" src/cbTrackSpike.ts && grep -q "TRACK_PROBES_ENABLED" src/cbTrackSpike.ts && grep -q "spike-output" src/cbTrackSpike.ts && grep -q "BASELINE-NUM" src/cbTrackSpike.ts && grep -q "BASELINE-CAT" src/cbTrackSpike.ts && grep -q "=== SPIKE SUMMARY ===" src/cbTrackSpike.ts && grep -q "-74.05,40.65,-73.85,40.85" src/cbTrackSpike.ts && grep -q '"cb-track-spike": "tsx src/cbTrackSpike.ts"' package.json && grep -q '"wms-spike"' package.json && grep -q '"wkb-spike"' package.json && grep -q '"spatial-predicate-spike"' package.json && grep -q "spike-output" ../../.gitignore && [ -f ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ] && grep -q "^## Lane A Probes" ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md && grep -q "^## Lane B Probes" ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md && grep -q "^## Lane C Probes" ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md && grep -q "^## Decision" ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md && grep -q "^## Open Question Resolutions" ../../.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md && npx tsc --noEmit</automated>
  </verify>
  <done>cbTrackSpike.ts is committed and tsc-clean; npm run cb-track-spike is wired in package.json; spike-output/ is gitignored at repo root; 37-SPIKE-NOTES.md template skeleton exists with empty section structure ready for Task 3 to fill from operator's Task 2 paste. Operator can now run `npm run cb-track-spike` from `kinetica_bi/server` against their deployed Kinetica with the 4 mandatory CB fixture env vars set (Track probes auto-skip if track env vars absent).</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Operator runs `npm run cb-track-spike` against deployed Kinetica + pastes verbatim stdout + tile-diff observations</name>
  <files>(no files modified — operator captures output to chat + spike-output/*.png locally; Task 3 turns it into the 37-SPIKE-NOTES.md verdict fill)</files>
  <read_first>
    - kinetica_bi/server/src/cbTrackSpike.ts (the script the operator runs — verify it exists and the env-var contract matches the OPERATOR INSTRUCTIONS below)
    - .planning/phases/37-cb-track-wms-spike/37-CONTEXT.md (locked fixtures: demo.nyctaxi.fare_amount for numeric, demo.nyctaxi.payment_type for categorical, operator-supplied track table; Manhattan bbox locked)
    - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md (skeleton structure — operator can preview what Task 3 will fill so they know what observations to capture beyond the raw stdout)
  </read_first>
  <action>
    THIS IS A BLOCKING HUMAN-ACTION CHECKPOINT — Claude does NOT execute the spike. Claude pauses and instructs the operator. There is no CLI/API Claude can substitute here: the spike must run against the operator's deployed Kinetica instance with the operator's own BI-user credentials (password mode), inside the operator's network/VPN context. Additionally, the strong PASS criterion (visual tile diff) requires the operator's eyeballs on the saved PNG bytes — Claude cannot view binary images at spike-output paths.

    OPERATOR INSTRUCTIONS:

    1. Confirm fixture reachability. Open Kinetica Workbench (or your SQL client) and confirm BOTH of these SELECT queries return ≥1 row from your account, and that `payment_type` has at least 2 distinct values:
       ```sql
       SELECT COUNT(*) FROM demo.nyctaxi WHERE pickup_longitude BETWEEN -74.05 AND -73.85 AND pickup_latitude BETWEEN 40.65 AND 40.85;
       SELECT payment_type, COUNT(*) FROM demo.nyctaxi GROUP BY payment_type ORDER BY 2 DESC LIMIT 10;
       ```
       If either query is unreachable OR `payment_type` has only 1 distinct value (no categorical signal), STOP and report it before continuing — the spike fixtures are operator-locked per CONTEXT.md.

    2. (Optional but recommended) Confirm a track table is reachable. If you have a Kinetica table with TRACKID + x + y + TIMESTAMP columns and data overlapping the Manhattan bbox, identify it now; otherwise the Track probes will auto-skip with DEFERRED status (Phase 40 ships the operator-override-only path per CONTEXT.md fallback). Run:
       ```sql
       SELECT COUNT(*) FROM <your_track_table> WHERE x BETWEEN -74.05 AND -73.85 AND y BETWEEN 40.65 AND 40.85;
       ```
       to confirm overlap. If 0 rows but you still want track probes, pick a different bbox-adjacent table OR accept that Track tiles will be blank-but-HTTP-200 (still useful for param-acceptance verdict; visual-diff verdict requires bbox overlap).

    3. Add the following spike-target env vars to `kinetica_bi/server/.env` (the KINETICA_URL / USERNAME / PASSWORD entries should already be present from prior phases per memory `project_backend_env_load_order.md`):

       Mandatory (4):
       ```
       CB_NUMERIC_TABLE=demo.nyctaxi
       CB_NUMERIC_COLUMN=fare_amount
       CB_CATEGORICAL_TABLE=demo.nyctaxi
       CB_CATEGORICAL_COLUMN=payment_type
       ```

       Optional Track (5 — leave blank/omit to defer Track probes):
       ```
       TRACK_TABLE=<your_track_table — schema-qualified>
       TRACK_ID_COL=TRACKID
       TRACK_ORDER_COL=TIMESTAMP
       TRACK_X_COL=<your track-table longitude column>
       TRACK_Y_COL=<your track-table latitude column>
       ```

    4. (Backend dev shell precaution per project memory `project_backend_env_load_order.md`):
       The spike script itself loads `.env` via `dotenv.config()` at the top of `cbTrackSpike.ts` — you do NOT need to `source .env` for the spike. Just:
       ```bash
       cd kinetica_bi/server && npm run cb-track-spike
       ```

    5. Run the spike. Expect ~40-60 sequential probes (network-bound, ~1-3 minutes wall time depending on Kinetica latency). PNG tile bytes will accumulate in `kinetica_bi/server/spike-output/37-*.png` (gitignored — they stay local).

    6. **Perform the visual tile diff.** Open the PNG files in any image viewer and compare:
       - `spike-output/37-baseline-num.png` vs `spike-output/37-A-num-8.png`, `37-B-num-8.png`, `37-C-num-8.png` — these are the per-lane CB tiles for the numeric fixture under 8-char colors. Identify which lanes produce TILES VISUALLY DIFFERENT FROM THE RASTER BASELINE (= Kinetica honored the CB params); which produce IDENTICAL OR NEAR-IDENTICAL tiles (= Kinetica silently ignored the params and rendered as raster — Lane FAIL even if HTTP 200).
       - For each PASSing CB lane, also compare its 6-char vs 8-char variant (`37-A-num-6.png` vs `37-A-num-8.png` etc.) to determine whether Kinetica honors the alpha channel. If the 6-char tile renders with different (or no) opacity than the 8-char tile, AARRGGBB is the locked format. If they render identically, 6-char might still work but the alpha channel is being ignored — note this for the Decision Record.
       - Repeat the same lane × format comparison for the categorical fixture (`37-baseline-cat.png` vs `37-A-cat-*.png`, `37-B-cat-*.png`, `37-C-cat-*.png`).
       - For Track probes (if TRACK_PROBES_ENABLED was true): compare `37-T-R-1.png` (DOTRACKS=TRUE alone) through `37-T-R-9.png` (cumulative track params) against a no-DOTRACKS raster tile of the same track table; document which param starts producing visible track lines/heads. Same for `37-T-CB-*.png` under cb_raster.

    7. Paste the FULL stdout into chat — EVERY line from `[cb-track-spike] Deployed Kinetica: ...` through `[cb-track-spike] Done. ...`. Do NOT truncate any probe body — Task 3 needs verbatim Kinetica error messages for HTTP 400 responses (the EDGE-4-MIXED probe and any param-rejection probes carry the function-name / param-name / signature information in their response bodies).

    8. Paste tile-diff observations into chat in this structure (Task 3 needs this for the Decision Record — Claude cannot view binary PNGs):
       ```
       Lane A vs raster baseline:
         A-NUM-8 vs BASELINE-NUM: <DIFFERS | IDENTICAL | NEAR-IDENTICAL>
         A-NUM-6 vs BASELINE-NUM: <DIFFERS | IDENTICAL | NEAR-IDENTICAL>
         A-CAT-8 vs BASELINE-CAT: <DIFFERS | IDENTICAL | NEAR-IDENTICAL>
         A-CAT-6 vs BASELINE-CAT: <DIFFERS | IDENTICAL | NEAR-IDENTICAL>

       Lane B vs raster baseline:
         B-NUM-8 / B-NUM-6 / B-CAT-8 / B-CAT-6: <verdicts>

       Lane C vs raster baseline:
         C-NUM-8 / C-NUM-6 / C-CAT-8 / C-CAT-6: <verdicts>

       Color format diff (within each PASSing lane):
         Lane A 6-char vs 8-char: <IDENTICAL (Kinetica accepts both) | DIFFERENT (alpha channel honored — AARRGGBB locked) | LANE FAILED>
         Lane B 6-char vs 8-char: <same>
         Lane C 6-char vs 8-char: <same>

       Categorical <other> bucket observation:
         B-CAT-8 with CB_VALS=cash,credit,<other>: did the <other>-colored points cover non-cash-non-credit rows? <YES — sink-bucket works | NO — <other> ignored, non-matched rows excluded | UNCLEAR>

       Track matrix (if TRACK_PROBES_ENABLED):
         T-R-1 DOTRACKS=TRUE alone: <track lines visible | not visible — DOTRACKS does NOT auto-track without TRACK_ID_ATTR>
         T-R-2 + TRACK_ID_ATTR: <track lines now visible | still not — TRACK_ORDER_ATTR also required>
         T-R-3 + TRACK_ORDER_ATTR: <visible | not>
         T-R-4 TRACKHEADCOLORS: <head colors visibly applied | not>
         T-R-5 TRACKLINECOLORS: <line colors visibly applied | not>
         T-R-6 TRACKHEADSIZES: <head sizes scaled | not>
         T-R-7 TRACKLINEWIDTHS: <line widths scaled | not>
         T-R-8 TRACKMARKERSHAPES: <shape changed | not>
         T-R-9 TRACKHEADSHAPES (alt naming): <shape changed | not — which naming Kinetica accepts: TRACKMARKERSHAPES or TRACKHEADSHAPES>
         T-CB-1..T-CB-9 under cb_raster: <same per-param observations, comma-sep emission>

       NTILE observations (from stdout JSON bodies, no tile diff applicable):
         NTILE-A (PARTITION BY 0): <PASS — bucket boundaries returned: [b1,b2,b3,b4,b5] | FAIL — error: <verbatim Kinetica message>>
         NTILE-B (bare ORDER BY): <same>
         NTILE-C (bucket-MIN wrapper): <PASS — bucket → MIN(col) map returned | FAIL — error>
       ```

    9. Paste your Kinetica server version (e.g., `7.1.9.x`). If unknown, run `SHOW SYSTEM PROPERTIES;` in Kinetica Workbench OR check the deployment banner on the Workbench landing page. If still unknown, say "version unknown".

    10. Paste the verbatim values you used for the 4 mandatory CB env vars (and the 5 Track env vars if Track probes ran). Do NOT paste KINETICA_URL or credentials.

    11. (Optional) Drag-and-drop or paste-attach 2-4 representative PNG screenshots from spike-output/ directly into chat to provide visual evidence of the PASS/FAIL diffs (e.g., the baseline-num tile + the winning CB-lane tile side-by-side; the 6-char vs 8-char comparison for the winning lane). These will be embedded in the Decision Record by Task 3.

    12. Note any observations the script could not capture — e.g., transient network blips, Kinetica under load, ambiguous tile diffs that need follow-up, fixture surprises (categorical column had unexpected NULL distribution, track table data didn't overlap bbox).

    Resume signal: type `cb-track spike output captured` once you have pasted (a) full stdout, (b) tile-diff observation structure from step 8, (c) Kinetica version, (d) verbatim env values, (e) optional screenshots, (f) any observations.

    Claude proceeds to Task 3 only after the operator has pasted (a)-(d) at minimum; (e)-(f) are recommended but not blocking.

    Why this is a HUMAN-ACTION checkpoint (not auto/auth-gate): The spike runs against a private Kinetica instance reachable only from the operator's network with credentials Claude does not have. Even if Claude had credentials, the strong PASS criterion (visual tile diff) requires the operator's eyeballs on saved PNG bytes — Claude cannot view binary images at `spike-output/` paths. Operator runs, operator pastes; Claude diagnoses.
  </action>
  <acceptance_criteria>
    - Operator has pasted full stdout from `npm run cb-track-spike`, including the SPIKE SUMMARY block with verdicts for: BASELINE-NUM/CAT, Lane A probes (A-NUM-6/8, A-CAT-6/8), Lane B probes (B-NUM-6/8, B-CAT-6/8), Lane C probes (C-NUM-6/8, C-CAT-6/8), Edge probes (EDGE-2-QUOTED/BACKSLASH, EDGE-3-NULL, EDGE-4-MIXED), NTILE probes (NTILE-A/B/C), and Track probes (T-R-1..9, T-CB-1..9 if TRACK_PROBES_ENABLED was true OR explicit DEFERRED block)
    - Operator has provided tile-diff observation structure from step 8 — at minimum: per-lane verdicts (Lane A vs baseline, Lane B vs baseline, Lane C vs baseline), color-format diff verdicts within PASSing lanes, <other> bucket observation, and (if Track probes ran) the 9-row T-R matrix observation
    - Operator has provided Kinetica server version (or explicit "version unknown")
    - Operator has provided verbatim env values for CB_NUMERIC_TABLE, CB_NUMERIC_COLUMN, CB_CATEGORICAL_TABLE, CB_CATEGORICAL_COLUMN (and TRACK_* vars if Track probes ran)
    - Operator has typed the resume signal `cb-track spike output captured`
    - Outcome class is one of:
        (a) at least one CB lane PASSED (Lane A, B, or C — tiles differ from raster baseline) for BOTH numeric AND categorical fixtures → Phase 38 unblocked (full or partial CB shape per which lanes passed)
        (b) NTILE failed but CB lanes passed → Phase 38 unblocked except /api/quantile endpoint disabled (CB-V17-06 Auto-suggest deferred to v1.8)
        (c) Track probes failed/skipped → Phase 40 ships operator-override-only path (no auto-detect)
        (d) All three CB lanes FAILED across BOTH fixtures → NONE_ESCALATE → BLOCK_V17 per CONTEXT.md "Total-fail escalation" — milestone re-scope required
  </acceptance_criteria>
  <verify>
    <automated>MISSING — checkpoint task: verification is human-driven (operator pastes spike output + tile-diff observations to chat; Claude reads chat; PNG bytes are not Claude-readable). Task 3 produces the verifiable file artifact (filled 37-SPIKE-NOTES.md) and runs a file-content check there.</automated>
  </verify>
  <done>Operator has typed `cb-track spike output captured` and pasted (a) full spike stdout, (b) per-lane + per-format + Track-matrix tile-diff observations, (c) Kinetica version, (d) verbatim env values, plus optional (e) representative PNG screenshots and (f) observations. Claude has all data needed to fill 37-SPIKE-NOTES.md from the skeleton in Task 3.</done>
  <resume-signal>Type "cb-track spike output captured" and paste: (a) full stdout from npm run cb-track-spike; (b) tile-diff observation structure per step 8 — Lane A/B/C vs baseline verdicts + color-format diff verdicts + categorical <other> observation + Track matrix observation (if TRACK_PROBES_ENABLED); (c) Kinetica server version (or "unknown"); (d) verbatim values used for CB_NUMERIC_TABLE / CB_NUMERIC_COLUMN / CB_CATEGORICAL_TABLE / CB_CATEGORICAL_COLUMN (and TRACK_* if applicable); (e) optional 2-4 representative screenshots; (f) any observations not captured by the script</resume-signal>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Fill 37-SPIKE-NOTES.md skeleton from operator's Task 2 paste — verbatim probe outputs + Decision Record locking CB lanes, color format, NTILE syntax, DOTRACKS/TRACK_* matrix</name>
  <files>.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md</files>
  <read_first>
    - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md (the skeleton Task 1 created — fill every `<...>` placeholder verbatim from operator's Task 2 paste; do NOT skip sections, do NOT fabricate data)
    - .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md (format precedent — verbatim probe-body capture pattern, Decision section with downstream-consequence block, Caveats free-form, Open Question Resolutions checklist, status banner at top)
    - .planning/phases/37-cb-track-wms-spike/37-CONTEXT.md (decision-locking rules: total-fail escalation triggers NONE_ESCALATE → BLOCK_V17 ONLY if all three CB lanes fail across both fixtures; partial-fail is acceptable — Lane B PASS alone unblocks Phase 38; NTILE-only fail defers Auto-suggest; Track-only fail/skip ships override-only path)
    - kinetica_bi/server/src/cbTrackSpike.ts (re-read so probe SQL/URL templates documented in 37-SPIKE-NOTES.md match what the script actually issued — argument orders, exact param-name spellings, BBOX literal)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (lines 325-340 — the current classbreak emitter shape; Decision Record must explicitly direct Phase 38 SCHEMA-V17-03/05 on what to swap)
    - The Task 2 chat-attached operator output: (a) full stdout from npm run cb-track-spike, (b) tile-diff observation structure, (c) Kinetica server version, (d) env-var values, (e) any screenshots, (f) observations
  </read_first>
  <action>
    Fill `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` — the skeleton already exists from Task 1; this task replaces every `<...>` placeholder with verbatim data from the operator's Task 2 paste. Do NOT rewrite section structure; only fill the placeholders.

    Filling rules (apply per section):

    **Frontmatter banner block:** Fill from operator's paste — date (Task 2 timestamp), redacted KINETICA_URL, username, Kinetica version, fixture env values, Track-fixture-or-DEFERRED, Confidence verdict. Add a `**Status:** PASS | PARTIAL | NONE_ESCALATE → BLOCK_V17` line just below the title, mirroring 25-SPIKE-NOTES.md line 3 precedent.

    **Baseline + Lane + Edge + NTILE + Track Probe sections:** For each probe, fill from the operator's stdout:
    - Verbatim URL params block (rebuild from the `params:` line in stdout — exact spelling, exact ordering)
    - HTTP status (from `[cb-track-spike] HTTP status: NNN` line)
    - content-type (image/png OR text/* OR application/* — verbatim from stdout)
    - bytesLen (from `bytes: N` line)
    - Tile path: `spike-output/37-<probe-id>.png` (literal — operator's local file path)
    - If non-image response: full verbatim bodyText inside a fenced ```text block (do NOT truncate even if 50+ lines — Kinetica error messages contain the param-name / signature information the Decision Record needs)
    - PASS/FAIL classification per the dual-criterion rule:
        * HTTP-only PASS criterion (from script): HTTP 200 AND content-type starts with `image/` AND bytesLen > 1000
        * STRONG PASS criterion (from operator's tile-diff observation): script-PASS AND operator marked the tile DIFFERS from the baseline
        * Operator-tile-diff-IDENTICAL → record FAIL even if HTTP 200 (param silently ignored — exactly the v1.5 lesson surface)
    - Visual-diff verdict: copy operator's per-probe verdict from their step-8 observation paste
    - Interpretation: one line — what this verdict means for Phase 38 (e.g. "Lane A FAIL — current wmsUrlBuilder.ts:325-340 emit shape is silently ignored by today's Kinetica; Phase 38 SCHEMA-V17-03 MUST swap to Lane B/C naming").

    **## Decision section** — apply CONTEXT.md locking rules (verbatim):

    1. **CB param-name set per render mode:**
       - If any of Lane A, Lane B, Lane C PASSed (strong criterion — tile DIFFERS from baseline) for BOTH numeric AND categorical fixtures, lock that lane as the Phase 38 implementation target.
       - Priority order (when multiple lanes PASS): Lane C (operator's high-confidence domain note + cb_raster supports raster-param-comma-sep used by Phase 40 TRACK_* combo) > Lane B (docs-canonical naming) > Lane A (preserves current codebase shape but inherits the 6-char color bug).
       - If only one fixture passed a lane, lock that lane for that fixture mode and note the asymmetry in Caveats.
       - If ALL three lanes FAILED across BOTH fixtures, lock NONE_ESCALATE → BLOCK_V17 and STOP — Phase 38 is blocked, milestone re-scope per CONTEXT.md "Total-fail escalation".

    2. **Color format:**
       - If 8-char AARRGGBB tiles VISUALLY DIFFER from 6-char tiles within any PASSing lane (alpha channel honored), lock AARRGGBB. Phase 38 SCHEMA-V17-05 directive: "swap b.color.toUpperCase() at wmsUrlBuilder.ts:337 to normalizeAARRGGBB() (same helper raster branch uses at line 280)".
       - If 8-char and 6-char tiles are visually identical across all PASSing lanes (alpha channel ignored), Kinetica accepts both — lock AARRGGBB anyway (8-char is the SAFE format; emit AARRGGBB unconditionally so future Kinetica versions that honor alpha don't surprise us). Note in Caveats.
       - If only 6-char rendered correctly (8-char tile is broken or wrong colors), lock 6-char and note the alpha-channel limitation (rare; document Kinetica version).

    3. **NTILE syntax:**
       - If NTILE-A (PARTITION BY 0) PASSed (HTTP 200 + body returns numeric bucket column), lock that form. Phase 38 SCHEMA-V17-06 directive: "/api/quantile uses `NTILE(n) OVER (PARTITION BY 0 ORDER BY <col>) AS bucket`".
       - If NTILE-A FAILed but NTILE-B (bare ORDER BY) PASSed, lock bare form.
       - If BOTH NTILE-A and NTILE-B FAILed: /api/quantile is disabled in Phase 38; CB-V17-06 Auto-suggest deferred to v1.8. Phase 39 ships CB UI without Auto-suggest button.
       - If NTILE-C (bucket-MIN wrapper) PASSed: the Phase 38 endpoint design (return `{ breaks: number[] }` from MIN-per-bucket) is validated. If only NTILE-A/B PASSed but NTILE-C FAILed, Phase 38 needs a different bucket-boundary extraction approach — record it in Caveats.

    4. **DOTRACKS + TRACK_* matrix:**
       - If TRACK_PROBES_ENABLED was false: write "DEFERRED — no operator-supplied track fixture; Phase 40 ships operator-override-only path per CONTEXT.md fallback; auto-detect deferred to v1.8 when a track fixture is reachable. Re-runnable via `npm run cb-track-spike` once a track table is available."
       - If TRACK_PROBES_ENABLED was true: lock from operator's T-R-1..9 + T-CB-1..9 verdicts:
         * DOTRACKS=TRUE: required (if T-R-1 alone showed track lines once TRACK_ID_ATTR+TRACK_ORDER_ATTR were added in T-R-2/3, but DOTRACKS=FALSE produced no tracks) | optional (if cb_raster mode renders tracks even without DOTRACKS) | gating-only-under-raster (if raster mode requires it but cb_raster does not — most likely outcome per operator's domain note).
         * Working TRACK_* param set: enumerate which probes (T-R-4 through T-R-9) produced visible tile changes vs the prior probe. Phase 40 emits only the working params.
         * TRACKMARKERSHAPES vs TRACKHEADSHAPES: lock whichever Kinetica honored. If both worked (rare), prefer TRACKMARKERSHAPES (more documentation hits).
         * CB_RASTER + TRACK_* combo (T-CB-* matrix): if all PASSed, lock Phase 40 SCHEMA-V17-04 directive as "emit TRACK_* via comma-separated values under STYLES=cb_raster"; if FAILed, Phase 40 narrows to "Track sub-section appears under raster only — not classbreak."

    5. **Overall outcome:** PASS | PARTIAL | NONE_ESCALATE → BLOCK_V17 — derived from the four sub-decisions above per CONTEXT.md partial-fail rules.

    6. **SQL/URL templates Phase 38 will emit:** Verbatim param-set per render mode, embedded as fenced code blocks. For example:
       ```
       # CLASSBREAK render mode (Phase 38 wmsUrlBuilder.ts emit shape — verbatim):
       SERVICE=WMS
       REQUEST=GetMap
       VERSION=1.1.1
       STYLES=<locked: classbreak | cb_raster>
       LAYERS=<tableRef>
       BBOX=<runtime bbox>
       WIDTH=<runtime>
       HEIGHT=<runtime>
       SRS=EPSG:4326
       FORMAT=image/png
       <locked CB param set with $-style placeholders: $CB_ATTR=$col, $CB_VALS=$breakValuesCsv, $CB_POINTCOLORS=$colorsCsv etc.>

       # /api/quantile SQL (Phase 38 /api/quantile endpoint emit shape — verbatim):
       SELECT bucket, MIN($col) AS boundary
       FROM (SELECT <locked NTILE form> AS bucket, $col FROM $table) AS t
       GROUP BY bucket ORDER BY bucket
       ```

    **## Caveats section:** Free-form. Topics to cover when present in operator's data:
    - Silent no-op tiles (HTTP 200 but visually identical to baseline) — name the probe IDs and confirm the v1.5 strong PASS criterion caught them at spike time.
    - 6-char vs 8-char alpha channel observations — if Kinetica accepts both, document.
    - Edge-2 comma-escape — N/A (no comma values in fixture) is acceptable; document the verdict so Phase 39 categorical UX knows whether escape support is operator-relevant.
    - Edge-3 NULL bucket routing — operator's observation (to <other> / excluded / own-bucket).
    - Kinetica-version-specific quirks if the version differs from 7.1 docs assumptions.
    - Track fixture data overlap with Manhattan bbox — if track table data was outside the bbox, Track tiles are blank-but-200 (param-acceptance verdict still valid; visual-diff verdict requires re-run with a track-table-overlapping bbox).
    - Operator observations from Task 2 step 12.

    **## Open Question Resolutions checklist:** Resolve each OQ-1 through OQ-9 with the locked verdict + one-line rationale.

    Filling anti-patterns to avoid:
    - DO NOT fabricate a PASS for a probe the operator did not run.
    - DO NOT classify an HTTP 200 + tile-IDENTICAL-to-baseline probe as PASS — the v1.5 strong PASS criterion (visual diff) is the whole point of this spike; record it as FAIL in the Decision and note the silent-no-op in Caveats.
    - DO NOT lock Lane A as the Phase 38 target just because it's the current codebase shape — if operator's tile diff shows Lane A is silently ignored by today's Kinetica, Phase 38 MUST swap to Lane B or C regardless of churn.
    - DO NOT skip the SQL/URL templates code blocks — Phase 38 reads this file and copies the templates verbatim.
    - DO NOT leave any `<...>` placeholders unreplaced (other than the literal `$col` / `$table` / `$CB_ATTR`-style template placeholders that are intended to remain in the SQL/URL template blocks for Phase 38 to substitute at runtime).
    - DO NOT remove the Caveats section even if empty — write `(none)` instead so the section structure stays grep-stable.
    - DO NOT execute any probes from this task — Claude only WRITES the Decision Record from operator's existing paste. If the operator's paste is incomplete (missing tile-diff structure for any lane, missing Track verdicts when TRACK_PROBES_ENABLED was true, missing Kinetica version), Claude PAUSES and asks the operator for the missing piece before filling — NOT fabricating placeholder verdicts.
  </action>
  <acceptance_criteria>
    - File `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` exists
    - File contains a `**Status:**` line in the top 10 lines with one of: `PASS — Phase 38 AUTHORIZED`, `PARTIAL —` (followed by which sub-area is partial), or `NONE_ESCALATE → BLOCK_V17`
    - File contains all 11 top-level section headers (verbatim, line-anchored): `## Baseline Probes`, `## Lane A Probes`, `## Lane B Probes`, `## Lane C Probes`, `## Categorical Edge-Case Probes`, `## Color-Format Probes`, `## NTILE Quantile Probes`, `## Track Probes`, `## Decision`, `## Caveats`, `## Open Question Resolutions` (grep -c returns exactly 11 if the regex `^## (Baseline|Lane [ABC]|Categorical|Color|NTILE|Track|Decision|Caveats|Open) ` is used)
    - File contains at least 12 probe sub-headers in the form `### Probe ` (covers BASELINE-NUM/CAT + 4 Lane A + 4 Lane B + 4 Lane C minimum; more if Edge/NTILE/Track headers also use `### Probe` form)
    - File contains the literal heading `**CB param-name set locked per render mode:**` followed by a non-placeholder verdict (NOT containing `<...>`)
    - File contains the literal heading `**Color format locked:**` followed by one of: `8-char AARRGGBB`, `6-char RRGGBB`, or `accepts-both — emit AARRGGBB`
    - File contains the literal heading `**NTILE syntax locked:**` followed by one of: `NTILE(n) OVER (PARTITION BY 0 ORDER BY col)`, `NTILE(n) OVER (ORDER BY col)`, or `NEITHER WORKS — /api/quantile disabled, CB-V17-06 deferred to v1.8`
    - File contains the literal heading `**DOTRACKS + TRACK_* matrix locked:**` followed by either an enumerated working-param-set OR `DEFERRED — no operator-supplied track fixture`
    - File contains the literal heading `**Overall outcome:**` followed by one of: `PASS`, `PARTIAL`, or `NONE_ESCALATE → BLOCK_V17`
    - File contains the literal heading `**SQL/URL templates Phase 38 will emit:**` followed by at least one fenced code block (` ``` `) containing concrete WMS-URL or SQL template text
    - File contains all 9 `**OQ-N (...)** RESOLVED →` lines (OQ-1 through OQ-9) in the `## Open Question Resolutions` section
    - No `<...>` placeholder strings remain in the file other than the literal `$col` / `$table` / `$CB_ATTR` / `$colorsCsv` / `$breakValuesCsv`-style template placeholders inside the fenced code blocks (which Phase 38 will substitute at runtime). Verified by: `grep -E '<[a-z][^>]*>' 37-SPIKE-NOTES.md` returns zero matches outside fenced code blocks AND outside the `<other>` literal (the Kinetica sink-bucket keyword).
    - `grep -q "TODO\|TBD\|XXX\|FIXME" 37-SPIKE-NOTES.md` returns nothing (no leftover author markers)
  </acceptance_criteria>
  <verify>
    <automated>cd .planning/phases/37-cb-track-wms-spike && [ -f 37-SPIKE-NOTES.md ] && grep -q "^\*\*Status:\*\*" 37-SPIKE-NOTES.md && grep -q "^## Baseline Probes" 37-SPIKE-NOTES.md && grep -q "^## Lane A Probes" 37-SPIKE-NOTES.md && grep -q "^## Lane B Probes" 37-SPIKE-NOTES.md && grep -q "^## Lane C Probes" 37-SPIKE-NOTES.md && grep -q "^## Categorical Edge-Case Probes" 37-SPIKE-NOTES.md && grep -q "^## Color-Format Probes" 37-SPIKE-NOTES.md && grep -q "^## NTILE Quantile Probes" 37-SPIKE-NOTES.md && grep -q "^## Track Probes" 37-SPIKE-NOTES.md && grep -q "^## Decision" 37-SPIKE-NOTES.md && grep -q "^## Caveats" 37-SPIKE-NOTES.md && grep -q "^## Open Question Resolutions" 37-SPIKE-NOTES.md && grep -q "^\*\*CB param-name set locked per render mode:\*\*" 37-SPIKE-NOTES.md && grep -q "^\*\*Color format locked:\*\*" 37-SPIKE-NOTES.md && grep -q "^\*\*NTILE syntax locked:\*\*" 37-SPIKE-NOTES.md && grep -q "^\*\*DOTRACKS + TRACK_\* matrix locked:\*\*" 37-SPIKE-NOTES.md && grep -q "^\*\*Overall outcome:\*\*" 37-SPIKE-NOTES.md && grep -q "^\*\*SQL/URL templates Phase 38 will emit:\*\*" 37-SPIKE-NOTES.md && [ "$(grep -c "^\- \*\*OQ-[0-9]" 37-SPIKE-NOTES.md)" -ge 9 ] && ! grep -q "TODO\|TBD\|XXX\|FIXME" 37-SPIKE-NOTES.md</automated>
  </verify>
  <done>37-SPIKE-NOTES.md filled from operator's Task 2 paste with verbatim probe verdicts, Decision Record locking CB param-name set + color format + NTILE syntax + DOTRACKS/TRACK_* matrix verdicts, downstream Phase 38 directives explicit (SCHEMA-V17-03/04/05/06), Caveats capturing silent-no-op probes + alpha-channel behavior + Track-fixture-overlap notes, all 9 Open Question Resolutions filled. Phase 38 + 40 implementers can read this file and copy SQL/URL templates verbatim without re-probing Kinetica. P0 gate cleared (or explicit NONE_ESCALATE → BLOCK_V17 forces milestone re-scope per CONTEXT.md).</done>
</task>

</tasks>

<verification>
After all three tasks complete:

1. `kinetica_bi/server/src/cbTrackSpike.ts` exists, tsc-clean, and contains all required CB-lane param names, render-mode strings, track-param names, NTILE SQL, locked BBOX, and SPIKE-OUTPUT directory creation.

2. `kinetica_bi/server/package.json` has `"cb-track-spike": "tsx src/cbTrackSpike.ts"` alongside the three pre-existing spike scripts.

3. Repo-root `.gitignore` excludes `kinetica_bi/server/spike-output/` so raw PNG tile bytes never enter git history.

4. `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` is filled (not skeleton) with verbatim per-probe verdicts + Decision Record locking the four sub-areas (CB param-name set, color format, NTILE syntax, DOTRACKS/TRACK_* matrix) + downstream Phase 38/40 directives in fenced code blocks.

5. Overall outcome stated in 37-SPIKE-NOTES.md is one of: PASS (Phase 38 fully unblocked), PARTIAL (Phase 38 unblocked with NTILE-disabled and/or Track-skipped narrowing), or NONE_ESCALATE → BLOCK_V17 (milestone re-scope per CONTEXT.md "Total-fail escalation").

6. No production code changes outside the spike runner — `kinetica_bi/src/lib/wmsUrlBuilder.ts` is untouched (Phase 38 SCHEMA-V17-03/04/05 owns the wmsUrlBuilder rewrite informed by this spike's Decision Record).
</verification>

<success_criteria>
Phase 37 success criteria (verbatim from ROADMAP.md Phase 37 entry):

1. ✓ `37-SPIKE-NOTES.md` is committed with a PASS/FAIL verdict for every probe: CB param names (CB_ATTR vs CB_COLUMN_NAME), categorical CB_VALS string support including `<other>` and comma-escaping, color format (8-char AARRGGBB vs 6-char RRGGBB), DOTRACKS=TRUE under STYLES=raster, and TRACK_* + comma-separated raster params under STYLES=cb_raster — each verdict backed by both HTTP 200 status AND a visual tile diff. → Covered by Task 1 (3 lane × 2 fixture × 2 color = 12 base probes + 4 categorical edge + 18-cell TRACK matrix + 3 NTILE + 2 baselines = ~40 probes saved to spike-output/) and Task 3 (verdict fill).

2. ✓ The exact classbreak param name set is locked in the notes file (CB_ATTR or CB_COLUMN_NAME, CB_VALS or CB_BREAK_POINT_N, per-break color param name), with a Decision Record so Phase 38 can implement against known names without further probing. → Covered by Task 3 ## Decision section: "**CB param-name set locked per render mode:**".

3. ✓ The 6-char RRGGBB vs 8-char AARRGGBB finding is explicit in the notes file, documenting the existing `wmsUrlBuilder.ts` bug for mandatory fix in Phase 38. → Covered by Task 3 ## Decision section: "**Color format locked:**" + Phase 38 SCHEMA-V17-05 directive explicitly named.

4. ✓ The spike runner (`kinetica_bi/server/src/cbTrackSpike.ts`) is committed and executable via `npm run cb-track-spike` from a clean checkout. → Covered by Task 1 (runner + package.json script entry).

5. ✓ NTILE quantile SQL syntax (PARTITION BY 0 vs PARTITION BY null) is validated against the deployed instance and locked in the notes file so Phase 38 can implement `/api/quantile` without ambiguity. → Covered by Task 1 (NTILE-A/B/C probes) + Task 3 (## Decision: "**NTILE syntax locked:**").
</success_criteria>

<output>
After Task 3 completes, run a git commit consolidating all four files:
- kinetica_bi/server/src/cbTrackSpike.ts
- kinetica_bi/server/package.json
- .gitignore
- .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md

Commit message: `feat(phase-37): cb-track WMS spike — runner + 37-SPIKE-NOTES Decision Record locking CB param names, color format, NTILE syntax, DOTRACKS/TRACK_* matrix for Phase 38`

Then write the phase summary: `.planning/phases/37-cb-track-wms-spike/37-01-SUMMARY.md` documenting: spike outcome class (PASS/PARTIAL/NONE_ESCALATE), Phase 38 unblock state, Phase 40 unblock state (override-only vs auto-detect path), /api/quantile enable state (CB-V17-06 PASS vs deferred to v1.8), and re-run instructions for future Kinetica-version upgrades (`cd kinetica_bi/server && npm run cb-track-spike`).
</output>
