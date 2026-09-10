# Phase 37: CB/Track WMS Spike - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-driven SQL + WMS GetMap probes against the deployed Kinetica instance to lock the exact CB_* and TRACK_* WMS parameter names, color format, NTILE quantile SQL syntax, and CB_RASTER + TRACK_* combo behavior **before** any code lands in Phase 38. Spike runner committed (`kinetica_bi/server/src/cbTrackSpike.ts` or equivalent); verbatim probe outputs + Decision Record committed to `37-SPIKE-NOTES.md`. **P0 GATE: Phase 38 cannot start until every probe lane has a Decision Record entry locking the working param-name set per render mode.**

In scope: spike runner script (mirrors `kinetica_bi/server/src/spatialPredicateSpike.ts` shape), `37-SPIKE-NOTES.md` artifact with verbatim probes + Decision, operator UAT run against deployed Kinetica, three-lane CB param probing, full categorical edge-case coverage, full TRACK_* enumeration under STYLES=raster AND STYLES=cb_raster, NTILE quantile SQL probe.

Out of scope: any `wmsUrlBuilder.ts` code changes (Phase 38), any frontend code (Phases 39+), `dashboard_layers` schema migration (Phase 38), `/api/quantile` endpoint implementation (Phase 38), WKB-binary spatial mode (TD-V14-WKB-SPIKE carry; classbreak excludes WKB columns), OIDC-mode probing (Phase 43 UAT precedent).

</domain>

<decisions>
## Implementation Decisions

### Spike target fixtures (env-var-driven; defaults baked into runner help text)

Operator supplies fixtures via `kinetica_bi/server/.env`; runner reads same dotenv pattern as `spatialPredicateSpike.ts`:

- **CB numeric**: `demo.nyctaxi` table, `fare_amount` column. Known-reachable from v1.3/v1.4/v1.5 fixtures; wide numeric spread (0 → ~200) produces clear classbreak buckets at Manhattan zoom.
- **CB categorical (TEXT)**: `demo.nyctaxi` table, `payment_type` column (or operator's preferred low-cardinality TEXT — `vendor_id` / `store_and_fwd_flag` acceptable substitutes). Low cardinality (2–6 distinct values) confirms the `<other>` sink-bucket actually catches non-matched rows.
- **Track table**: env-var-driven only; operator supplies at spike time. Runner reads `TRACK_TABLE`, `TRACK_ID_COL`, `TRACK_X_COL`, `TRACK_Y_COL`, `TRACK_ORDER_COL`. No baked-in default. If no reachable track table at spike time, Track probes skip with explicit "DEFERRED — no operator-supplied track fixture" decision row (Phase 43 UAT closes via live attestation).
- **WMS BBOX (single, all probes)**: `BBOX=-74.05,40.65,-73.85,40.85` (EPSG:4326), Manhattan ±0.1°. Matches Phase 25 spatial-predicate anchor; reuses operator's known visual baseline; demo.nyctaxi has dense data here.

### Probe coverage strategy — three lanes for CB params + full enumeration for everything else

**Lane A (codebase-current, baseline)**: `CB_COLUMN_NAME` + `CB_BREAK_TYPE` + `CB_BREAK_POINT_N` + `CB_POINTCOLOR_N` (current `wmsUrlBuilder.ts:325-340` shape). Probes the EXISTING shipped naming so we know what the v1.2 Phase 11 spike thought worked.

**Lane B (Kinetica 7.1 docs)**: `CB_ATTR` + `CB_VALS` + `CB_POINTCOLORS` (per STACK research; docs-current naming). Probes the alternate naming surfaced by research.

**Lane C (raster-style under CB_RASTER, per operator domain note)**: `POINTCOLORS=#a,#b,#c` + `POINTSIZES=4,5,2` etc. under `STYLES=cb_raster`. Verifies the operator's confirmed-from-experience pattern that raster params work as comma-separated values under CB_RASTER. **This is the highest-confidence lane per operator domain knowledge — Phase 38 implementation will likely emit Lane C param shape.**

Decision Record locks the working param-name set per render mode after first PASS-with-visual-diff in Lane A or Lane B (or both, if both PASS). Lane C PASS is mandatory to confirm operator's CB_RASTER + raster-param-comma-sep model.

### Categorical CB_VALS — comprehensive edge-case coverage in one run

All four edge-cases probed in the same spike session (no operator re-run):

1. **`<other>` keyword**: `CB_VALS=cash,credit,<other>` against `payment_type` — confirm documented sink-bucket actually catches non-matched rows.
2. **Comma-escape behavior**: probe a synthetic TEXT value containing a literal comma (e.g., `CB_VALS="foo,bar",baz`). May be moot if `payment_type` has no comma-containing values — runner attempts both quoted and backslash-escaped forms; Decision Record notes "N/A — no comma values in fixture" if unverifiable.
3. **NULL bucket handling**: probe behavior when the column has NULL rows. Three possible outcomes documented in Decision Record: NULLs map to `<other>` / NULLs are excluded / NULLs render as their own bucket.
4. **Mixed numeric/categorical**: probe `CB_VALS=1:5,10:20,"high"` against a TEXT column to confirm Kinetica errors cleanly (HTTP 400 with explanatory message) rather than producing silent garbage tiles.

### TRACK_* + DOTRACKS — full enumeration under raster AND cb_raster

Every documented TRACK_* param probed under BOTH render modes (matrix probing):

- `DOTRACKS=TRUE` (gating param)
- `TRACK_ID_ATTR` (default `TRACKID`)
- `TRACK_ORDER_ATTR` (default `TIMESTAMP`)
- `TRACKHEADCOLORS` (head color)
- `TRACKLINECOLORS` (trail color)
- `TRACKHEADSIZES` (head size)
- `TRACKLINEWIDTHS` (line width)
- `TRACKMARKERSHAPES` (head shape — verify enum: circle/diamond/square/triangle per FEATURES research)
- `TRACKHEADSHAPES` (alternate naming — probe both to lock the correct one)

Comma-separated forms tested under `STYLES=cb_raster` (e.g., `TRACKHEADCOLORS=#abc,#def,#ghi`) to verify operator's domain note for Phase 40 emission.

Approximate probe count: **9 params × 2 render modes = 18 TRACK_* probes** + DOTRACKS gating. Single operator session via runner.

### NTILE quantile SQL — IN Phase 37 scope

Probe `SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY fare_amount) AS bucket, fare_amount FROM demo.nyctaxi LIMIT 1000` against deployed Kinetica. Confirms `NTILE(n) OVER (PARTITION BY 0 ORDER BY col)` window function syntax works as STACK research recommends (Kinetica lacks `PERCENTILE_DISC`/`PERCENTILE_CONT`).

If `PARTITION BY 0` fails, fallback probe: `NTILE(n) OVER (ORDER BY col)` (no partition). Decision Record locks the working form for Phase 38 `/api/quantile` endpoint implementation. Result also exercises whether Kinetica returns bucket boundaries usefully (column 1 = bucket #, column 2 = value) — Phase 38 endpoint may need a `GROUP BY bucket, MIN(col)` wrapper.

### Color format — explicit 6-char vs 8-char probe with visual tile diff

Probe both forms in separate WMS GetMap requests:

1. Lane A under `STYLES=classbreak`: `CB_POINTCOLOR_1=FF112233` (8-char AARRGGBB) vs `CB_POINTCOLOR_1=112233` (6-char RRGGBB). Capture both tile bytes.
2. Lane B under `STYLES=classbreak`: same with `CB_POINTCOLORS=FF112233,FF445566` vs `CB_POINTCOLORS=112233,445566`.
3. Lane C under `STYLES=cb_raster`: `POINTCOLORS=FF112233,FF445566` vs `POINTCOLORS=112233,445566`.

Decision Record documents the existing 6-char bug (Pitfalls research finding at `wmsUrlBuilder.ts:337`) with explicit tile-diff evidence so Phase 38 SCHEMA-V17-05 fix is unambiguous.

### Multi-candidate fallback shape — single operator session, all lanes in sequence

Runner sequences all probe lanes in one execution; no operator re-run. Verbatim probe output for every lane committed to `37-SPIKE-NOTES.md`, regardless of PASS/FAIL. Decision Record summarises which naming + format worked per render mode per fixture. Mirrors Phase 25's multi-candidate-per-mode pattern, expanded.

### Total-fail escalation policy

If ALL three CB param lanes FAIL across BOTH numeric AND categorical fixtures:
- Stop Phase 37 with Decision = `NONE_ESCALATE → BLOCK_V17`
- Operator + planner reconvene; whole milestone shape changes (mirrors Phase 25 escalation pattern)
- DO NOT fall back to a TD carry-forward — CB rendering is the v1.7 value prop

Partial-fail (e.g., Lane A FAIL + Lane B PASS) is **acceptable** — Decision Record locks Lane B and Phase 38 implements against B's naming. If Lane C FAILS but A or B PASSes, track styling under CB_RASTER is the only loss — Phase 40 narrows to "Track sub-mode under RASTER only" (matches the original FEATURES research interpretation).

If only NTILE FAILS but CB lanes PASS: Phase 38 `/api/quantile` endpoint disabled; CB UI ships without Auto-suggest (CB-V17-06 deferred to v1.8). Phase 38 + 39 unblock to proceed.

If only Track probes FAIL or are skipped (no fixture): Phase 40 ships with operator-override-only path (no auto-detect); auto-detect waits for v1.8. Phase 38, 39, 41, 42 unblock to proceed.

### Claude's Discretion

Areas explicitly left for the planner / Phase 37 implementer:

- **Spike runner UX**: default to **Node CLI mirroring `kinetica_bi/server/src/spatialPredicateSpike.ts` shape** — `npm run cb-track-spike` reading env vars; production-payload-parity for `/execute/sql` SQL probes; standard `fetch()` for WMS GetMap probes with redacted Basic auth. Final env-var naming + script entry name is planner's call.
- **Visual tile-diff evidence mechanism**: default to **runner saves PNG tile bytes to `kinetica_bi/server/spike-output/37-*.png`** (gitignored) + operator pastes representative tiles or screenshots into `37-SPIKE-NOTES.md`. Planner may upgrade to pixel-diff via a JS lib if trivial; otherwise the operator-eyeball compare is sufficient (v1.2 Phase 11 lesson: HTTP 200 alone is not evidence).
- **Decision Record format**: mirror Phase 25 `25-SPIKE-NOTES.md` structure — `## Probe X` blocks with verbatim SQL/WMS-URL + HTTP status + response body (or tile-bytes path) + PASS/FAIL + failure reason; `## Decision` with chosen param names + reasoning + downstream consequence; `## Caveats`; `## Open Question Resolutions`. Phase 37 expands to ~40+ probe blocks (3 CB lanes × N + 4 categorical edge-cases + ~18 TRACK_* matrix + NTILE + 6 color-format).
- **Auth mode coverage**: default to **password mode only** (Phase 25 precedent; OIDC defers to Phase 43 UAT — mirrors v1.3 S2.b + v1.4 Phase 24 + v1.5 Phase 31 trajectory). Password-mode PASS is sufficient unblock for Phase 38.
- **Whether to fold color-format probes into Lane A/B/C OR run as a separate "color sanity" block**: planner decides. Folding minimises operator time; separating makes the Decision Record cleaner.
- **WMS GetMap dimensions**: planner picks WIDTH+HEIGHT (e.g., 256×256 or 512×512) consistent with production tile requests; default to whatever `MapChartRenderer.tsx` ImageWMS source emits.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 37 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Spike — CB/Track WMS Param Lock" — SPIKE-V17-01 through SPIKE-V17-06 literal requirements
- `.planning/ROADMAP.md` §"Phase 37: CB/Track WMS Spike" — Goal + 5 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — Milestone goal + target features
- `.planning/STATE.md` — Current Position (Phase 37 not started)

### Spike pattern + structural model (mirror these)
- `kinetica_bi/server/src/spatialPredicateSpike.ts` — Closest precedent: env-var-driven, dotenv, basicAuth, multi-candidate fallback in a single run, verbatim output capture, production-payload-parity for /execute/sql. **Copy this file's shape; swap SQL templates for WMS GetMap URLs + add multi-render-mode loop.**
- `kinetica_bi/server/src/wmsSpike.ts` — Phase 11 WMS GetCapabilities runner; pattern for WMS-side probes (GET + Basic auth + raw response capture)
- `kinetica_bi/server/src/wkbSpike.ts` — Phase 18 runner at commit `d458408` (production-payload-parity reference)
- `.planning/phases/25-spatial-predicate-spike/25-CONTEXT.md` — Closest CONTEXT.md precedent (multi-candidate spike with fallback)
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` — Decision Record structure: `## Probe X` blocks + `## Decision` + `## Caveats` + `## Open Question Resolutions`
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` — Earlier precedent in same lineage

### Production payload reference
- `kinetica_bi/server/src/kinetica.ts:154-170` — Canonical `/execute/sql` request body (7-field shape: `encoding`, `offset`, `request_schema_str`, `data`, `options`, `statement`, `limit`); spike runner MUST match this for SQL probes (NTILE + any SHOW COLUMNS / metadata probes). **Phase 18 lost a full round-trip to a partial body — do not regress.**

### Current code under test
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:325-340` — Existing classbreak branch (emits CB_COLUMN_NAME/CB_BREAK_TYPE/CB_BREAK_POINT_N/CB_POINTCOLOR_N; uses `b.color.toUpperCase()` for 6-char RRGGBB color — **the known bug**)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:25` — `normalizeAARRGGBB` import (8-char path used by raster branch — what classbreak SHOULD emit per Phase 38 SCHEMA-V17-05)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:27` — `RenderMode` union (already includes `"classbreak"` — render-mode shape is locked)

### Research artifacts (read for probe design context)
- `.planning/research/SUMMARY.md` — Executive summary; build order; research flags
- `.planning/research/STACK.md` §"CB param names" + §"Track params" + §"Quantile SQL" — STACK confidence assessment (CB param names LOW confidence → spike required; Track HIGH; NTILE MEDIUM)
- `.planning/research/FEATURES.md` §"Track render mode" + §"Categorical CB_VALS" — UX research; <other> keyword documented; track-table column convention
- `.planning/research/ARCHITECTURE.md` §"wmsUrlBuilder extension" — Integration shape for Phase 38 (post-spike)
- `.planning/research/PITFALLS.md` §"CB color format" — The 6-char RRGGBB bug at `wmsUrlBuilder.ts:337`

### Kinetica WMS docs (external — for probe SQL/URL construction)
- https://docs.kinetica.com/7.1/api/rest/wms_rest/ — WMS REST API param reference (CB_*, TRACK_*, STYLES)
- https://docs.kinetica.com/7.1/feature_overview/wms_feature_overview/ — Render mode overview
- https://docs.kinetica.com/7.1/concepts/window/ — NTILE + window functions

### Prior milestone close-out (failure-mode reference)
- `.planning/PROJECT.md` §"Carried-in tech debt" — TD-V14-WKB-SPIKE structural model for NONE_ESCALATE fallback shape

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`kinetica_bi/server/src/spatialPredicateSpike.ts`** — Closest structural model. Env-var-driven, dotenv, Basic auth, redacted URL logging, multi-candidate-per-mode fallback in a single run, verbatim probe output. **Copy this file's shape**; swap SQL templates for WMS GetMap URLs + add multi-render-mode loop. Naming: `kinetica_bi/server/src/cbTrackSpike.ts` (planner's call).
- **`kinetica_bi/server/src/wmsSpike.ts`** — Phase 11 GetCapabilities runner; pattern for WMS-side probes via `fetch()` with Basic auth header.
- **`kinetica_bi/server/src/kinetica.ts:154-170`** — Production-parity `/execute/sql` request body. Re-derive NTILE probe payload from here, don't invent.
- **`kinetica_bi/server/package.json` scripts.{wkb-spike, spatial-predicate-spike, wms-spike}** — Pattern for adding `npm run cb-track-spike` script entry.

### Established Patterns

- **Operator-driven spike pattern** (Phase 13 S1-S4 → Phase 18 → Phase 25 → Phase 37): runner committed; operator runs against deployed instance; verbatim output committed to `<phase>-SPIKE-NOTES.md`; Decision Record locks downstream param/SQL names.
- **Production-payload-parity lock**: any new `/execute/sql` caller (incl. spike runners) MUST send the full 7-field body. Phase 18's first run was lost to violating this.
- **Decision-record schema**: `## Probe X` (verbatim SQL/URL + HTTP status + response body + PASS/FAIL + reason) → `## Decision` (chosen params + reasoning + downstream consequence) → `## Caveats` → `## Open Question Resolutions`.
- **Multi-candidate-fallback in a single operator run**: Phase 25 expanded the spike model from single-probe-per-mode to all-candidates-per-mode in one session. Phase 37 expands further: three CB lanes × multiple fixtures × multiple edge cases × two render modes.
- **Spike output gitignore**: planner should ensure raw tile bytes (`spike-output/*.png`) are gitignored — only the SPIKE-NOTES.md artifact + representative tiles or screenshots paste into the commit.

### Integration Points

- **No production code changes in Phase 37** — pure spike + artifact. Phase 38 is the first consumer:
  - `wmsUrlBuilder.ts:325-340` classbreak branch will be rewritten in Phase 38 SCHEMA-V17-03/04/05 using the spike-locked param names + color format
  - `kinetica_bi/server/src/lib/quantileSql.ts` (new in Phase 38) will use the spike-locked NTILE syntax
  - `POST /api/quantile` route (new in Phase 38) wraps `quantileSql.ts`
  - `track_config` schema (new in Phase 38 SCHEMA-V17-01) shape informed by which TRACK_* params PASS the spike

### Risks & Anti-Patterns to Avoid

- **HTTP 200 ≠ correct behavior** (v1.2 Phase 11 lesson): WMS GetMap returns 200 even when the param set is ignored. Visual tile-diff evidence is mandatory; the runner saves tile bytes and the operator confirms differentiation.
- **Silent no-op classbreak** (FEATURES + PITFALLS research): wrong CB param names parse cleanly but render as raster. Lane A vs B vs C diff-against-raster baseline catches this.
- **AUTH_MODE cross-mode test isolation** (TD-V16-TEST-ISOLATION carry): not applicable to Phase 37 (no new server specs ship in this phase); applies to Phase 38 onwards.

</code_context>

<specifics>
## Specific Ideas

- **Operator's CB_RASTER + raster-param-comma-sep pattern** (from /gsd:new-milestone questioning): "TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES are cb raster options. most of the raster options even POINTCOLORS, POINTSIZES, etc can be used for class breaks. You need to comma separate the values like this `POINTSIZES=4,5,2`." Lane C of the CB probing exists specifically to verify this; it is the highest-confidence path per operator domain knowledge and Phase 38 likely implements against Lane C's pattern.
- **Reuse Phase 25 anchor**: Manhattan bbox `-74.05,40.65,-73.85,40.85` (EPSG:4326). Operator already knows visual baseline + Kinetica response patterns at this location from v1.3/v1.4/v1.5.
- **Track table is operator-supplied at spike-run time** — runner reads `TRACK_TABLE`, `TRACK_ID_COL`, `TRACK_X_COL`, `TRACK_Y_COL`, `TRACK_ORDER_COL` from `.env`. No baked-in default. If no track fixture reachable, track probes skip with explicit DEFERRED row in Decision Record; Phase 40 ships operator-override-only path.
- **Comprehensive categorical coverage in one run** — all four edge cases (`<other>`, comma-escape, NULL bucket, mixed numeric/categorical) probed in a single operator session; downstream Phase 39 categorical UX design has full evidence.
- **NTILE in this phase, not deferred** — one extra probe block confirms `/api/quantile` design before Phase 38 endpoint work; cheap insurance against late-discovery rework.

</specifics>

<deferred>
## Deferred Ideas

- **OIDC-mode probing** — defer to Phase 43 UAT (mirrors v1.3 S2.b + v1.4 Phase 24 + v1.5 Phase 31 + v1.6 Phase 36 trajectory). Password-mode PASS is sufficient unblock for Phase 38.
- **WKB-binary spatial mode** — TD-V14-WKB-SPIKE carry; classbreak excludes WKB column picker per CB-V17-08. Re-spike path documented at `kinetica_bi/server/src/wkbSpike.ts`.
- **Pixel-diff automation** — operator-eyeball compare of saved PNG tiles is sufficient; pixel-diff JS lib is a v1.8+ nice-to-have if Phase 37 → Phase 38 → Phase 39 cycle surfaces ambiguity.
- **Cross-Kinetica-version regression matrix** — spike runner is preserved + re-runnable via `npm run cb-track-spike`; future Kinetica upgrades re-run on demand. No proactive multi-version probing in this phase.
- **CONTOUR + HEATMAP param surface deltas** — out of scope; Phase 11 already probed heatmap; contour is not in v1.7 scope.
- **Track table auto-registration via Kinetica metadata API** — FEATURES research found no `/show/table` flag for "track-type"; operator-supplied is the path. Re-evaluate in v1.8+ if a metadata path surfaces.

</deferred>

---

*Phase: 37-cb-track-wms-spike*
*Context gathered: 2026-05-18*
