---
phase: 11-map-chart
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/index.ts
  - .planning/phases/11-map-chart/11-SPIKE-NOTES.md
  - kinetica_bi/server/src/wmsSpike.ts
autonomous: true
requirements:
  - MAP-01
  - FILT-04
must_haves:
  truths:
    - "An authoritative SPIKE-NOTES.md records the exact Kinetica WMS parameter names and STYLES values for the deployed instance"
    - "Every response from /api/wms includes Cache-Control: no-store"
    - "The Wave-1 spike answers all seven Open Questions from RESEARCH.md (param names, STYLES, filter param, SRS, colormaps, ST_Envelope, POINTOPACITY)"
  artifacts:
    - path: ".planning/phases/11-map-chart/11-SPIKE-NOTES.md"
      provides: "Locked Kinetica WMS parameter names + STYLES values + filter param + SRS + colormaps + ST_Envelope signature for downstream wmsUrlBuilder.ts"
      contains: "SPATIAL_PARAMS, STYLES, FILTER_PARAM, SRS, COLORMAPS, ST_ENVELOPE"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "/api/wms route handler now sets Cache-Control: no-store"
      contains: "Cache-Control"
  key_links:
    - from: "kinetica_bi/server/src/index.ts (/api/wms route)"
      to: "browser cache"
      via: "Cache-Control: no-store response header"
      pattern: "res\\.setHeader\\([\"']Cache-Control[\"']"
    - from: "11-SPIKE-NOTES.md"
      to: "src/lib/wmsUrlBuilder.ts (Wave 2)"
      via: "documented param-name table consumed by URL builder author"
      pattern: "SPATIAL_PARAMS|STYLES|FILTER_PARAM"
---

<objective>
Run the WMS GetCapabilities spike against the deployed Kinetica instance, write findings to `11-SPIKE-NOTES.md`, and harden `/api/wms` with `Cache-Control: no-store`. This plan UNBLOCKS every other Phase 11 plan that touches WMS parameter names or filter-driven tile invalidation. Without these locked param names, Wave 2's `wmsUrlBuilder.ts` and `/api/wms/capabilities` endpoint cannot be written correctly.

Purpose: Resolve RESEARCH.md MEDIUM-confidence Open Questions #1–#6 (exact param spellings) by hitting the real Kinetica WMS endpoint, AND apply the M-08 Cache-Control lock so filter changes never serve stale tiles. Combined with Wave 2's `_v=filterVersion` cache-buster, this is the complete defense against M-02 + M-08.

Output: `11-SPIKE-NOTES.md` (param-name lookup table consumed by `wmsUrlBuilder.ts`), modified `/api/wms` route handler with `Cache-Control: no-store` + matching unit test, and a temporary spike-runner script (`server/src/wmsSpike.ts`) used to call GetCapabilities.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-RESEARCH.md
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/src/kinetica.ts

<interfaces>
<!-- Existing /api/wms route (server/src/index.ts:659-668) -->
```typescript
app.get("/api/wms", requireConfig, asyncHandler(async (req, res) => {
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const response = await kineticaWms(req as AuthedRequest, queryString, {
    route: "GET /api/wms",
  });
  // ... pipes response back to client
}));
```

<!-- kineticaWms helper signature (server/src/kinetica.ts:239-310) -->
```typescript
export async function kineticaWms(
  req: AuthedRequest,
  queryString: string,
  audit: { route: string }
): Promise<Response>;
```

<!-- Reference: 5 successful /api/wms responses must include Cache-Control: no-store -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Cache-Control: no-store to /api/wms route + spec</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/src/index.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (lines 655-680: current /api/wms handler shape)
    - kinetica_bi/server/src/kinetica.ts (lines 239-310: how kineticaWms streams the response so we know where to insert the header)
    - kinetica_bi/server/src/index.spec.ts (existing test file format and supertest patterns; create if absent)
    - .planning/phases/11-map-chart/11-CONTEXT.md (M-08 lock; "Cache-Control: no-store on ALL /api/wms proxy responses")
    - .planning/research/PITFALLS.md M-08 entry (rationale for the header — browser HTTP cache is not auth-aware)
  </read_first>
  <action>
    In `kinetica_bi/server/src/index.ts`, locate the `/api/wms` handler at line 659. Add `res.setHeader("Cache-Control", "no-store");` as the FIRST statement inside the handler body (BEFORE the `kineticaWms(...)` call) so the header is set even if the upstream call throws. Inline-comment the line: `// PITFALL M-08 lock: browser cache is not auth-aware; never serve stale tiles after filter change OR after OIDC token rotation`.

    Then add a supertest spec in `kinetica_bi/server/src/index.spec.ts` (create if missing — use existing test patterns from `kinetica_bi/server/src/db.spec.ts` if present, else use `import request from "supertest"` + `import { app } from "./index"`). Test names:
    - `"GET /api/wms responds with Cache-Control: no-store header"` — assert `response.headers["cache-control"] === "no-store"`
    - `"GET /api/wms sets Cache-Control even when upstream Kinetica errors"` — mock `kineticaWms` to throw `KineticaUpstreamError`; assert response status 502 AND `cache-control: no-store`

    Mock `kineticaWms` via `vi.mock("./kinetica", () => ({ kineticaWms: vi.fn() }))`. If `app` isn't currently exported, add `export` to its declaration in `index.ts`. Tests run via existing `npm test` from `kinetica_bi/server/`.

    DO NOT modify `kineticaWms` itself — header belongs on the route handler so failure modes still set it.
  </action>
  <acceptance_criteria>
    - `grep -n "Cache-Control.*no-store" kinetica_bi/server/src/index.ts` returns exactly 1 match inside the `/api/wms` handler block
    - `grep -n "PITFALL M-08" kinetica_bi/server/src/index.ts` returns at least 1 match inline-commenting the header line
    - `kinetica_bi/server/src/index.spec.ts` exists and contains the literal test names: `"GET /api/wms responds with Cache-Control: no-store header"` and `"GET /api/wms sets Cache-Control even when upstream Kinetica errors"`
    - `cd kinetica_bi/server && npm test` exits 0 with both new tests passing
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npm test -- index.spec</automated>
  </verify>
  <done>Both supertest assertions pass; the inline `// PITFALL M-08 lock` comment is present; no other route handlers were modified.</done>
</task>

<task type="auto">
  <name>Task 2: Write WMS GetCapabilities spike runner + execute against deployed Kinetica</name>
  <files>kinetica_bi/server/src/wmsSpike.ts, kinetica_bi/server/package.json</files>
  <read_first>
    - kinetica_bi/server/src/kinetica.ts (lines 239-312: kineticaWms helper for transport pattern; replicate auth+URL handling)
    - kinetica_bi/.env or kinetica_bi/server/.env (KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD env vars — DO NOT COMMIT, just read)
    - kinetica_bi/server/src/types.ts (AuthedRequest shape — for understanding kineticaWms call signature; the spike script does NOT use AuthedRequest, it makes its own raw fetch)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Open Questions #1-#7 — the spike must answer all of them)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("SPIKE REQUIRED" canonical_refs entry)
  </read_first>
  <action>
    Create `kinetica_bi/server/src/wmsSpike.ts` as a standalone Node script (not part of the Express app — invoked via `npx tsx server/src/wmsSpike.ts`). The script:

    1. Reads `KINETICA_URL`, `KINETICA_USERNAME`, `KINETICA_PASSWORD` from `process.env` (load via `dotenv`; the server already uses dotenv — `import dotenv from "dotenv"; dotenv.config();` at top of file).
    2. Builds Basic auth header: `"Basic " + Buffer.from(\`${user}:${pass}\`).toString("base64")`.
    3. Calls `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1` via native `fetch` with the Basic header. Print the response status + content-type.
    4. Reads response body as text. If 200 + content-type contains XML, write to `kinetica_bi/server/src/wmsCapabilities.xml` (gitignored — add a .gitignore line if needed, but this file is the raw fixture for parser writing in 11-03).
    5. Run a sequence of small probe SQL queries via raw `fetch` to `${KINETICA_URL}/execute/sql` (Basic auth) to verify `ST_Envelope` signature. Probe SQL:
       ```sql
       SELECT ST_XMin(ST_Envelope(ST_GeomFromText('POINT(1 2)'))) AS minLon
       ```
       Print whether the response succeeds. Try alternate function spellings if the first fails: `STXMIN`, `ST_X_MIN`. Document which spelling works.
    6. Probe SRS support: build a minimal `GetMap` request with `SRS=EPSG:3857`, `BBOX=-20037508,-20037508,20037508,20037508`, `WIDTH=10&HEIGHT=10&FORMAT=image/png&LAYERS=<a known table — read from the first table in the local SQLite via the existing db.ts if simple, else hard-code a placeholder and let the implementer paste a real table name during execution>`. If 200 → SRS:3857 works. If 400 → try `SRS=EPSG:900913`. Print result.
    7. Probe POINTOPACITY: try `POINTCOLOR=FF0000FF` (8-digit RRGGBBAA) — if 400, try `POINTOPACITY=100` separate param.

    Add a `wms-spike` script to `kinetica_bi/server/package.json`:
    ```json
    "scripts": {
      "wms-spike": "tsx src/wmsSpike.ts"
    }
    ```

    Run the spike: `cd kinetica_bi/server && npm run wms-spike 2>&1 | tee /tmp/wms-spike-output.txt`. Capture every printed line.

    NOTE: If the deployed Kinetica is not reachable from the executor's network (connection refused, DNS failure), the executor MUST stop and report this as a CHECKPOINT — the planner cannot continue without spike data. Do NOT fabricate spike findings.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/wmsSpike.ts` exists
    - `cd kinetica_bi/server && npm run wms-spike` exits 0 OR exits non-zero with a clear network/auth error printed (not a TypeScript or runtime crash)
    - Stdout includes lines matching the patterns: `GetCapabilities status: <number>`, `ST_Envelope probe:`, `SRS probe:`, `POINTOPACITY probe:`
    - `kinetica_bi/server/src/wmsCapabilities.xml` exists with `<?xml` as the first 5 chars (raw fixture for the capabilities parser in 11-03) — OR a `wmsSpike` console line states "GetCapabilities returned non-XML, content-type was X" if the deployed Kinetica returns JSON
    - `kinetica_bi/server/package.json` `scripts` block includes the literal key `"wms-spike"`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npm run wms-spike 2>&1 | tee /tmp/wms-spike-output.txt && grep -E "GetCapabilities status|ST_Envelope probe|SRS probe|POINTOPACITY probe" /tmp/wms-spike-output.txt | wc -l | awk '$1 >= 4 {exit 0} {exit 1}'</automated>
  </verify>
  <done>The spike script ran end-to-end against deployed Kinetica; all four probe lines appeared in stdout; raw GetCapabilities XML (or its absence with explanation) is captured to disk.</done>
</task>

<task type="auto">
  <name>Task 3: Write 11-SPIKE-NOTES.md from spike output</name>
  <files>.planning/phases/11-map-chart/11-SPIKE-NOTES.md</files>
  <read_first>
    - /tmp/wms-spike-output.txt (the spike-runner stdout from Task 2)
    - kinetica_bi/server/src/wmsCapabilities.xml (raw GetCapabilities XML — if it exists)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Open Questions #1-#7 — the seven questions the spike-notes must answer)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("canonical_refs" SPIKE REQUIRED entry — confirms the deliverable is a planner-named spike note)
  </read_first>
  <action>
    Create `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` with the following exact section structure:

    ```markdown
    # Phase 11 — WMS GetCapabilities Spike Notes

    **Spike date:** <ISO date>
    **Deployed Kinetica:** <KINETICA_URL value, with credentials redacted>
    **Spike runner:** kinetica_bi/server/src/wmsSpike.ts
    **Confidence:** HIGH (verified against deployed Kinetica)

    ## Locked Parameter Names

    | Concept | Param Name | Notes |
    |---------|-----------|-------|
    | Lat column | <X_COLUMN_NAME or X_ATTR — verbatim from spike> | |
    | Lon column | <Y_COLUMN_NAME or Y_ATTR> | |
    | Geometry column | <GEOMETRY_COLUMN_NAME or GEO_ATTR> | Used for both WKT and WKB modes (Kinetica detects type from column metadata) |
    | Server-side filter | <QUERY or CQL_FILTER or WHERE> | Used in tileWmsSource.updateParams({ <FILTER_PARAM>: whereClause, _v: filterVersion }) |
    | Cache-buster | _v | filterVersion from useFilterStore |

    ## STYLES values per render mode

    | Render mode | STYLES value | Notes |
    |-------------|-------------|-------|
    | raster | <e.g. "point" or "raster"> | |
    | heatmap | heatmap | |
    | classbreak | classbreak | |
    | contour | contour | |

    ## Per-mode params

    ### Raster
    POINTCOLOR=<RRGGBB or RRGGBBAA — note which> ; POINTSIZE=<int> ; POINTOPACITY=<separate param OR alpha-suffix on POINTCOLOR>

    ### Heatmap
    BLUR_RADIUS=<units = Kinetica map units; M-05 lock> ; COLORMAP=<intersect of [viridis, plasma, inferno, magma, cividis, turbo, jet, hot] and supported list>

    Supported COLORMAPS (from GetCapabilities): <comma-separated list>

    ### Classbreak
    CB_COLUMN_NAME=<col> ; CB_BREAK_TYPE=<CATEGORICAL|NUMERICAL> ; CB_BREAK_POINT_<n>=<value> ; CB_POINTCOLOR_<n>=<RRGGBB|AA>

    ### Contour
    CONTOUR_COLOR=<RRGGBB|AA> ; CONTOUR_SMOOTH=<bool> ; CONTOUR_BANDWIDTH=<units = Kinetica map units; M-05 lock>

    ## SRS Support

    | SRS | Accepted by deployed Kinetica? |
    |-----|-------------------------------|
    | EPSG:3857 | <yes/no> |
    | EPSG:900913 | <yes/no> |
    | EPSG:4326 | <yes/no> |

    **Locked SRS for OL View:** <EPSG:3857 if accepted; otherwise document fallback>

    ## ST_Envelope SQL

    Verified working spelling:
    ```sql
    <the exact spelling that returned 200 from the spike, e.g. SELECT ST_XMin(ST_Envelope(geom_col)) ...>
    ```

    Bbox SQL templates for downstream `wmsUrlBuilder.ts` and the Wave 3 bbox helper:

    Lat/lon mode:
    ```sql
    SELECT MIN(lon_col) AS minLon, MAX(lon_col) AS maxLon, MIN(lat_col) AS minLat, MAX(lat_col) AS maxLat FROM <table>
    ```

    WKT/WKB mode:
    ```sql
    <use the verified spelling from above>
    ```

    ## Open Question Resolutions

    - Q1 (param spellings): RESOLVED — see "Locked Parameter Names" table above
    - Q2 (ST_Envelope): RESOLVED — see "ST_Envelope SQL" section
    - Q3 (SRS): RESOLVED — see "SRS Support" table
    - Q4 (colormaps): RESOLVED — see Heatmap section
    - Q5 (capabilities endpoint shape): not part of this spike; resolved by 11-03 plan
    - Q6 (POINTOPACITY): RESOLVED — see Raster section
    - Q7 (bundle size): not part of this spike; resolved by 11-05 plan via post-install measurement

    ## Caveats

    <Any unexpected findings, e.g. Kinetica returned an error for a probe; deployed Kinetica is older than expected; certain modes not supported>
    ```

    Fill every `<...>` placeholder from the spike output. If a probe failed (e.g. network error reached Kinetica but Kinetica rejected the query), DOCUMENT the failure verbatim — do NOT guess. Where the spike output is ambiguous, prefer the spelling Kinetica returned a 200 for.

    If the spike could not run at all (network unreachable), this task creates 11-SPIKE-NOTES.md with a single `## SPIKE BLOCKED` section explaining the network failure and listing every Open Question still unresolved. Downstream Wave 2 plans will need a CHECKPOINT before proceeding.
  </action>
  <acceptance_criteria>
    - File `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` exists
    - File contains all section headings: `## Locked Parameter Names`, `## STYLES values per render mode`, `## Per-mode params`, `## SRS Support`, `## ST_Envelope SQL`, `## Open Question Resolutions`
    - File does NOT contain literal placeholder text `<...>` outside of explicit "BLOCKED" markers (every angle-bracket placeholder either filled in or replaced with `BLOCKED — see Caveats`)
    - `grep -c "RESOLVED\|BLOCKED" .planning/phases/11-map-chart/11-SPIKE-NOTES.md` >= 5 (at least 5 of the 7 Open Questions are addressed)
    - Markdown lints cleanly (no broken table rows; sections in declared order)
  </acceptance_criteria>
  <verify>
    <automated>test -f .planning/phases/11-map-chart/11-SPIKE-NOTES.md && grep -E "## Locked Parameter Names|## STYLES values per render mode|## Per-mode params|## SRS Support|## ST_Envelope SQL|## Open Question Resolutions" .planning/phases/11-map-chart/11-SPIKE-NOTES.md | wc -l | awk '$1 >= 6 {exit 0} {exit 1}'</automated>
  </verify>
  <done>11-SPIKE-NOTES.md is committed; every Open Question is either RESOLVED with a verified value or BLOCKED with a documented reason; downstream wmsUrlBuilder.ts has a single source of truth for param names.</done>
</task>

</tasks>

<verification>
- /api/wms route handler emits `Cache-Control: no-store` (verified via supertest spec).
- Spike runner script exists and is callable via `npm run wms-spike`.
- 11-SPIKE-NOTES.md captures the deployed Kinetica's WMS parameter surface in a structured table downstream plans can reference verbatim.
- No production code references the placeholder param names from RESEARCH.md — wmsUrlBuilder.ts (Wave 2) will pull from SPIKE-NOTES.md.
- Backend test suite still green: `cd kinetica_bi/server && npm test`.
</verification>

<success_criteria>
- `cd kinetica_bi/server && npm test -- index.spec` exits 0 with both Cache-Control assertions passing.
- `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` exists with all six required section headings and at least 5 Open Questions marked RESOLVED or BLOCKED.
- `kinetica_bi/server/src/wmsSpike.ts` and the `wms-spike` npm script exist; the script ran end-to-end at least once against deployed Kinetica.
- M-08 inline comment present in `index.ts`.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-01-SUMMARY.md` summarizing:
- The exact resolved values for X/Y/GEO column param names, STYLES per mode, FILTER_PARAM, SRS, COLORMAPS, ST_Envelope spelling, POINTOPACITY treatment
- Whether any Open Question was BLOCKED and what unblocks it
- Confirmation that Cache-Control: no-store ships on /api/wms responses (with supertest evidence)
</output>
