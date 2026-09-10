# Phase 25: spatial-predicate-spike - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-driven SQL probe against the deployed Kinetica instance to confirm spatial predicate names and behavior for **latlon** and **WKT** modes, with verbatim probe output and a Decision record committed to `25-SPIKE-NOTES.md`. The runner script is preserved at a known commit so future Kinetica-version re-runs are one shot. **This phase is the P1 gate for Phase 26** — no `spatialWhereClause.ts` code may be written until BOTH latlon AND WKT predicate forms PASS.

In scope: spike runner script (mirrors `kinetica_bi/server/src/wkbSpike.ts` shape), `25-SPIKE-NOTES.md` artifact with verbatim probes + Decision, operator UAT run, decision record locking the working predicate names.

Out of scope: `spatialWhereClause.ts` implementation (Phase 26), any frontend code, any new Kinetica DDL/objects beyond probe SELECTs, WKB-mode probing (still gated on TD-V14-WKB-SPIKE — no reachable WKB-binary column).

</domain>

<decisions>
## Implementation Decisions

### Predicate name set — probe BOTH candidate names per mode in a single run

Both REQUIREMENTS.md (`STXY_WITHIN` / `ST_WITHIN`) and the research SUMMARY (`STXY_CONTAINS` / `ST_INTERSECTS`) are valid candidate names. The spike resolves the conflict in one trip:

- **Latlon mode probes:** `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(<wkt>)) = 1` AND `STXY_CONTAINS(ST_GEOMFROMTEXT(<wkt>), lon_col, lat_col) = 1`
- **WKT mode probes:** `ST_WITHIN(geom_col, ST_GEOMFROMTEXT(<wkt>)) = 1` AND `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(<wkt>)) = 1`
- Runner attempts every candidate in sequence within the same run; all verbatim outputs land in `25-SPIKE-NOTES.md`; Decision record locks the **first PASS** per mode.

### Fail-path behavior — sequence all candidates within one run

If the primary predicate name returns HTTP 400 or empty rows, the runner automatically falls through to the next candidate (no operator re-run needed). Mirrors v1.3 S1-S4 pattern. Each probe's verbatim output is captured regardless of PASS/FAIL — Decision record summarises which name worked per mode.

### Total-fail escalation — block v1.5, re-scope milestone

If ALL probed names FAIL across BOTH modes:
- Stop Phase 25 with Decision = `NONE_ESCALATE → BLOCK_V15`
- Operator + planner reconvene; whole milestone shape changes (mirrors v1.3 had-it-failed scenario)
- Do NOT fall back to a TD carry-forward (this is different from v1.4 Phase 18 WKB outcome — that was a single-mode deferral; here all modes failing kills the milestone's value prop)

Partial-fail (e.g., latlon PASS + WKT FAIL) is **not** an authorized escalation path — the milestone's WKT-mode targets are first-class scope. If WKT FAILs, the milestone re-scopes.

### Latlon-mode test fixture — `demo.nyctaxi`

- Table: `demo.nyctaxi`
- Lon column: `pickup_longitude`
- Lat column: `pickup_latitude`
- Known-reachable from v1.3 fixture demo + v1.4 Phase 24 UAT — same fixture v1.3 operator used end-to-end.

### WKT-mode test fixture — `ki_home.us_states.WKT`

- Table: `ki_home.us_states`
- Geometry column: `WKT` (column literally named `WKT`)
- Operator-confirmed reachable in their Kinetica account (resolves the Phase 18 blocker where no real geometry column was available).
- US-state polygon table → spike shapes anchored over NYC will intersect NY state polygon = strong WKT PASS signal.

### Probe shape anchor — NYC, ~50 km bbox

- Center: `lon = -73.95, lat = 40.75` (same coords Phase 18 used)
- Bbox extent: ±0.5° (~50 km) — small enough that demo.nyctaxi returns thousands of in-bbox taxi rows, large enough that ki_home.us_states intersects NY state polygon
- Single coord set drives all three shape probes for both modes

### Probe shape payloads — all three production-realistic shapes

REQUIREMENTS.md SPIKE-V15-01 literal payload, single spike run covers all:
1. **4-corner bbox** — WKT `POLYGON ((lon1 lat1, lon2 lat1, lon2 lat2, lon1 lat2, lon1 lat1))` anchored on NYC ±0.5°
2. **64-vertex circle polygon** — WKT polygon approximating a circle (matches the production `ol/interaction/Draw.createRegularPolygon(64)` output)
3. **150-vertex lasso polygon** — WKT polygon at the production vertex cap (matches V15-P-03 `geom.simplify` + 150-vertex hard-cap output); doubles as a free **V15-P-03 size-limit probe** — if Kinetica rejects this shape, the WHERE-clause character limit is surfaced now rather than at Phase 31 UAT

### PASS criteria — signature confirmed + semantic correctness (≥1 row)

A probe PASSes only if:
- (a) SQL executes without HTTP 400 (signature confirmed), AND
- (b) returns ≥1 row from the known-spatial-spread dataset (semantic correctness — the predicate actually filters)

This is stronger than Phase 18's signature-only gate. Rationale: silent wrong-predicate-name bugs (e.g., `STXY_WITHIN` parses but no-ops because it expects different arg order) would compile but produce 0-row results forever; catch them here, not at Phase 31 UAT.

For `demo.nyctaxi` latlon bbox over Manhattan: expect thousands of rows.
For `ki_home.us_states` WKT bbox over NYC: expect ≥1 row (NY state polygon).

### Claude's Discretion

Areas explicitly left open for the planner / Phase 25 implementer:

- **Auth mode coverage** — default to **password mode only** (mirrors Phase 18 spike pattern; OIDC was DEFERRED in v1.3 S2.b and closed live at v1.4 Phase 24 UAT — same trajectory expected here). If operator wants OIDC during the run, no objection.
- **Spike runner UX** — default to **Node CLI** mirroring `kinetica_bi/server/src/wkbSpike.ts` shape: `npm run spatial-predicate-spike` reading env vars (KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, plus per-fixture target overrides if needed). Critical: `/execute/sql` payload MUST be full production parity (`encoding: "json"` + the 4 other fields in `kinetica.ts:154-170`) — Phase 18 lost a round-trip to this exact runner bug.
- **Decision record format** — mirror `18-SPIKE-NOTES.md` section structure: `## Probe A`, `## Probe B`, ... `## Decision`, `## Caveats`, `## Open Question Resolutions`. Each probe block: verbatim SQL + HTTP status + response body + PASS/FAIL + failure reason.
- **Env var naming for probe targets** — likely `LATLON_PROBE_SCHEMA` / `LATLON_PROBE_TABLE` / `LATLON_PROBE_LON_COL` / `LATLON_PROBE_LAT_COL` + WKT siblings + `PROBE_CENTER_LON` / `PROBE_CENTER_LAT` / `PROBE_BBOX_HALF_DEG`. Final naming is planner's call.
- **Whether to fold V15-P-05 (STXY_DWITHIN distance unit) probe into Phase 25 vs Phase 26 supertest** — planner decides. The 150-vertex lasso payload already addresses V15-P-03; V15-P-07 (OR-parens) is purely Phase 26 unit-test territory.
- **Runner output format on disk** — verbatim probe blocks written by the runner directly into `25-SPIKE-NOTES.md` OR runner outputs a JSON file that the operator pastes into the notes file. Planner decides; v1.3 / v1.4 pattern is direct-write.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 25 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Kinetica Predicate Spike" — SPIKE-V15-01, SPIKE-V15-02 literal requirements
- `.planning/ROADMAP.md` §"Phase 25: spatial-predicate-spike" — Goal + 3 success criteria
- `.planning/STATE.md` §"Key v1.5 Architecture Decisions" — P1-gate lock + runner-preservation lock

### Spike pattern + structural model (mirror these)
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` — Decision record structure: Probe A/B/C + Decision + Caveats + Open Question Resolutions
- `.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-PLAN.md` — Operator-driven spike PLAN format (frontmatter must_haves shape, key_links pattern)
- `kinetica_bi/server/src/wkbSpike.ts` — Runner script shape at production-parity commit `d458408` (full `/execute/sql` payload — DO NOT regress to bare `{statement, limit}`)
- `.planning/milestones/v1.3-phases/13-spikes-and-endpoint/13-01-spike-runner-PLAN.md` — Earliest operator-driven spike PLAN; pattern lineage for Phase 25

### Production payload reference
- `kinetica_bi/server/src/kinetica.ts:154-170` — Canonical `/execute/sql` request body (5 fields: `encoding`, `offset`, `request_schema_str`, `data`, `options` PLUS `statement` + `limit`); runner MUST match this shape

### Research artifacts (read for pitfall coverage in probe design)
- `.planning/research/SUMMARY.md` §"Implications for Roadmap" Phase 1 — Spike rationale + predicate-name conflict origin
- `.planning/research/PITFALLS.md` §"V15-P-14: Kinetica Predicate Availability" — Why both candidate names per mode
- `.planning/research/PITFALLS.md` §"V15-P-03: Freehand Polygon Vertex Explosion" — Why the 150-vertex lasso payload doubles as a size-limit probe
- `.planning/research/PITFALLS.md` §"V15-P-05: STXY_DWITHIN vs ST_DISTANCE Semantics" — Open question that may be folded into Phase 25 or deferred to Phase 26 supertest
- `.planning/research/PITFALLS.md` §"V15-P-07: Multi-Shape OR Clause Without Parens" — Phase 26 territory; not spiked here

### Prior milestone close-out (failure-mode reference)
- `.planning/PROJECT.md` §"v1.4 carried tech debt" — TD-V14-WKB-SPIKE outcome; structural model for "what NONE_ESCALATE looks like" if Phase 25 total-fails

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kinetica_bi/server/src/wkbSpike.ts` (Phase 18 runner at commit `d458408`): full structural model — env-var-driven probe target, production-parity `/execute/sql` payload, verbatim output capture. Copy this file's shape; swap SQL templates + add multi-candidate-name loop.
- `kinetica_bi/server/package.json` `scripts.wkb-spike`: pattern for adding `npm run spatial-predicate-spike` entry.
- `kinetica_bi/server/src/kinetica.ts:154-170`: canonical request shape — re-derive from here, do not invent.

### Established Patterns
- **Operator-driven spike pattern** (Phase 13 S1-S4 + Phase 18 + now Phase 25): runner script shipped in a commit; operator runs against their deployed instance; verbatim output committed to `<phase>-SPIKE-NOTES.md`; Decision record locks downstream SQL templates. **Phase 25 ships SAME pattern, expanded with multi-candidate-name fallback within a single run.**
- **Production-payload-parity lock**: any new `/execute/sql` caller (incl. spike runners) MUST send the full 5-field body. Phase 18's first run was lost to violating this; the runner-bug fix at commit `d458408` is the canonical reference.
- **Decision-record schema**: `## Probe X` blocks with verbatim SQL + HTTP status + response body; `## Decision` with chosen SQL pattern + reasoning + downstream consequence; `## Caveats`; `## Open Question Resolutions`. **Phase 25 expands** to N probes (≥6: 2 candidates × 3 shapes per mode; total ≥12 probes if both candidates are exercised against all shapes per mode).

### Integration Points
- No code integration in Phase 25 — pure spike + artifact. Phase 26 is the first consumer: `spatialWhereClause.ts:buildSpatialOrBlock` literal predicate names will be lifted directly from `25-SPIKE-NOTES.md ## Decision`.
- Phase 26's `buildSpatialOrBlock` planner MUST read `25-SPIKE-NOTES.md` Decision section to pick the literal predicate name (e.g., `STXY_WITHIN` vs `STXY_CONTAINS` per latlon-mode PASS). If both candidates PASSed, Phase 26 picks one and the runner-bug-protected re-run path stays available.

</code_context>

<specifics>
## Specific Ideas

- **Re-use Phase 18 click point**: `lon = -73.95, lat = 40.75` (Manhattan); ±0.5° bbox extent. Identical to the WKB spike anchor — operator already knows the coords and Kinetica response patterns at this location.
- **150-vertex lasso doubles as a free V15-P-03 probe**: the production cap is 150 vertices post-simplify; running the spike against a 150-vertex shape today closes the WHERE-clause size-limit gap without an extra probe.
- **Multi-candidate fallback within a single run is the Phase 25 differentiator from Phase 18**: Phase 18 was single-name-per-probe. Phase 25 sequences `STXY_WITHIN → STXY_CONTAINS` in one operator session, locking the working name without a re-plan trip.
- **The `ki_home.us_states.WKT` table is operator-supplied** — column literally named `WKT`. Runner code must NOT assume `geom_col` is named anything sensible; env-var-driven only.

</specifics>

<deferred>
## Deferred Ideas

- **WKB-mode probing** — out of scope for Phase 25; TD-V14-WKB-SPIKE carry-forward (no reachable WKB-binary column). v1.5 WKB paths return HTTP 501 (same deferral pattern as v1.4).
- **STXY_DWITHIN distance-unit probe (V15-P-05)** — may be folded into Phase 25 by the planner OR deferred to Phase 26 supertest. Research GAP open; not blocking SPIKE-V15-01 PASS.
- **Multi-predicate OR-parens correctness (V15-P-07)** — purely Phase 26 unit-test territory; not a Kinetica behavior to probe.
- **OIDC-mode probing** — defer to Phase 31 UAT (mirrors v1.3 S2.b + v1.4 Phase 24 trajectory). Password-mode PASS is sufficient unblock for Phase 26.
- **PASS-criteria subset-count assertion** — stronger validation deferred; ≥1-row check is sufficient for unblock. Subset counts (filtered ÷ unfiltered ratio) would catch silent off-by-one predicate variants but adds operator step; revisit if Phase 31 surfaces ambiguity.
- **Partial-fail latlon-only unblock** — explicitly disallowed at Phase 25 close. Milestone re-scopes if any mode FAILs.

</deferred>

---

*Phase: 25-spatial-predicate-spike*
*Context gathered: 2026-05-11*
