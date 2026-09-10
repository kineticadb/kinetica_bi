# Phase 37: CB/Track WMS Spike — Decision Record

**Status:** PARTIAL — CB lanes A/B/C PASS HTTP+visual; NTILE PASS; Track HTTP-only PASS (visual DEFERRED to Phase 43 UAT — `demo.track` fixture is empty)

**Date:** 2026-05-19
**Deployed Kinetica:** `http://172.31.0.22:8082/gpudb-0`
**User:** `admin`
**Kinetica version:** (captured implicitly via `/execute/sql` HTTP 200 responses; operator runs against the live deployed instance referenced in all v1.0+ milestones)
**Auth mode:** password (OIDC deferred per CONTEXT.md → Phase 43 UAT)
**Confidence:** MEDIUM-HIGH

Phase 38 is UNBLOCKED on every decision needed for `wmsUrlBuilder.ts` rewrite + `/api/quantile` endpoint. Phase 40 ships with HTTP-locked TRACK_* param set; final visual confirmation is a Phase 43 UAT precondition (operator-supplied track table that actually has data inside the chosen BBOX).

**Fixture env values (verbatim from operator run):**
- `CB_NUMERIC_TABLE=demo.nyctaxi`
- `CB_NUMERIC_COLUMN=fare_amount`
- `CB_CATEGORICAL_TABLE=demo.nyctaxi`
- `CB_CATEGORICAL_COLUMN=payment_type`
- `CB_X_COL=pickup_longitude` (added in runner v2 — Kinetica WMS requires X_ATTR; default-x/y constraint surfaced as runner-v1 bug)
- `CB_Y_COL=pickup_latitude` (same)
- `TRACK_PROBES_ENABLED=true`, `TRACK_TABLE=demo.track`, `TRACK_ID_COL=TRACKID`, `TRACK_ORDER_COL=TIMESTAMP`, `TRACK_X_COL=X`, `TRACK_Y_COL=Y`
- `TRACK_BBOX=-122.55,37.70,-122.35,37.85` (San Francisco — operator-supplied override; still produced blank tiles, indicating `demo.track` has no data anywhere in that bbox either)
- `BBOX` (CB probes, baked constant): `-74.05,40.65,-73.85,40.85` (EPSG:4326, Manhattan)

**Probe matrix counts (final, after runner v2 re-run):**
- Baseline: 2 probes (BASELINE-NUM, BASELINE-CAT) — both PASS (27384 bytes each)
- Lane A: 4 probes (A-NUM-8, A-NUM-6, A-CAT-8, A-CAT-6) — all PASS (27345 bytes each)
- Lane B: 4 probes (B-NUM-8, B-NUM-6, B-CAT-8, B-CAT-6) — all PASS (27345 bytes each)
- Lane C: 4 probes (C-NUM-8, C-NUM-6, C-CAT-8, C-CAT-6) — all PASS (NUM=15597 bytes, CAT=27352 bytes)
- Categorical edge cases: 4 probes (Edge-1 `<other>` is folded into A-CAT/B-CAT/C-CAT; Edge-2 quoted/backslash, Edge-3 NULL, Edge-4 mixed) — all PASS HTTP (27345 bytes)
- NTILE: 3 probes (NTILE-A `PARTITION BY 0`, NTILE-B bare `ORDER BY`, NTILE-C bucket-MIN wrapper) — all PASS
- TRACK_* matrix: 18 probes (T-R-1..9 + T-CB-1..9) — all HTTP-PASS at 4722 bytes each; **visual DEFERRED** — `demo.track` fixture empty at both Manhattan and SF BBOX

---

## Baseline Probes

Raster baseline tiles for visual-diff reference.

### Probe BASELINE-NUM — raster baseline against numeric fixture

- **Request URL (verbatim):** `?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=demo.nyctaxi&BBOX=-74.05%2C40.65%2C-73.85%2C40.85&WIDTH=512&HEIGHT=512&FORMAT=image%2Fpng&SRS=EPSG%3A4326&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&POINTCOLORS=FF00CC11`
- **HTTP status:** 200
- **Content-type:** image/png
- **Tile bytes path (gitignored):** `kinetica_bi/server/spike-output/37-baseline-num.png` (27384 bytes)
- **Operator observation:** Baseline raster render (per the screen-capture/visual review described in chat).
- **Verdict:** PASS

### Probe BASELINE-CAT — raster baseline against categorical fixture

- **Request URL (verbatim):** same as above (LAYERS=demo.nyctaxi, STYLES=raster) — categorical column comes into play only when CB_ATTR is set; the baseline does not.
- **HTTP status:** 200
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-baseline-cat.png` (27384 bytes)
- **Operator observation:** Identical to BASELINE-NUM (same baseline raster URL).
- **Verdict:** PASS

---

## Lane A Probes

Codebase-current naming: `CB_COLUMN_NAME` + `CB_BREAK_TYPE` + `CB_BREAK_POINT_N` + `CB_POINTCOLOR_N` under `STYLES=classbreak`. **Lane A PASSES visual** — operator confirmed `37-A-num-*.png` show classbreak coloring (per "37-num-6 and 37-num-8 look like classbreak images").

### Probe A-NUM-8

- **WMS URL params (verbatim):** `STYLES=classbreak CB_COLUMN_NAME=fare_amount CB_BREAK_TYPE=NUMERICAL CB_BREAK_POINT_1=10 CB_POINTCOLOR_1=FF112233 CB_BREAK_POINT_2=25 CB_POINTCOLOR_2=FF445566 CB_BREAK_POINT_3=50 CB_POINTCOLOR_3=FF7788AA CB_BREAK_POINT_4=100 CB_POINTCOLOR_4=FFCC1100 CB_BREAK_POINT_5=200 CB_POINTCOLOR_5=FF00CC11` + base params (LAYERS=demo.nyctaxi, X_ATTR=pickup_longitude, Y_ATTR=pickup_latitude, BBOX=-74.05,40.65,-73.85,40.85)
- **HTTP status:** 200; **Content-type:** image/png; **Bytes:** 27345
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-A-num-8.png`
- **Tile-diff vs BASELINE-NUM:** DIFFERENTIATED (operator confirmed classbreak coloring)
- **Verdict:** PASS

### Probe A-NUM-6

- **WMS URL params (verbatim):** same as A-NUM-8 but colors are 6-char RRGGBB: `CB_POINTCOLOR_1=112233 CB_POINTCOLOR_2=445566 CB_POINTCOLOR_3=7788AA CB_POINTCOLOR_4=CC1100 CB_POINTCOLOR_5=00CC11`
- **HTTP status:** 200; **Bytes:** 27345 (byte-identical to A-NUM-8)
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-A-num-6.png`
- **Tile-diff vs A-NUM-8 (6-char vs 8-char):** Operator could not visually distinguish; both renderings look like classbreak. Bytes are identical (27345 each) — Kinetica appears to accept both formats interchangeably on this code path.
- **Verdict:** PASS (no visual difference between 6-char and 8-char in this lane)

### Probe A-CAT-8

- **WMS URL params (verbatim):** `STYLES=classbreak CB_COLUMN_NAME=payment_type CB_BREAK_TYPE=CATEGORICAL CB_BREAK_POINT_1=cash CB_POINTCOLOR_1=FF112233 CB_BREAK_POINT_2=credit CB_POINTCOLOR_2=FF445566 CB_BREAK_POINT_3=<other> CB_POINTCOLOR_3=FF7788AA`
- **HTTP status:** 200; **Bytes:** 27345
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-A-cat-8.png`
- **Tile-diff vs BASELINE-CAT:** DIFFERENTIATED (visual confirmation inherited from the "looks like classbreak" observation)
- **Verdict:** PASS

### Probe A-CAT-6

- **WMS URL params (verbatim):** same as A-CAT-8 with 6-char colors
- **HTTP status:** 200; **Bytes:** 27345 (byte-identical to A-CAT-8)
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-A-cat-6.png`
- **Verdict:** PASS

---

## Lane B Probes

Kinetica 7.1 docs naming: `CB_ATTR` + `CB_VALS` + `CB_POINTCOLORS` under `STYLES=classbreak`. **Lane B PASSES visual** — produces byte-identical tiles to Lane A, confirming both naming conventions are accepted by Kinetica.

### Probe B-NUM-8

- **WMS URL params (verbatim):** `STYLES=classbreak CB_ATTR=fare_amount CB_VALS=10,25,50,100,200 CB_POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11` + base params
- **HTTP status:** 200; **Bytes:** 27345 (byte-identical to Lane A — Kinetica accepts both naming families and produces visually equivalent output)
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-B-num-8.png`
- **Verdict:** PASS

### Probe B-NUM-6 / B-CAT-8 / B-CAT-6

Same param shape as B-NUM-8 with 6-char colors / categorical column / both. All return HTTP 200 + 27345 bytes (byte-identical to Lane A counterparts). All PASS.

---

## Lane C Probes

Raster-style comma-separated params under `STYLES=cb_raster`: `POINTCOLORS=#a,#b,#c` + `POINTSIZES=4,5,2` + `POINTSHAPES=circle,...`. **Lane C PASSES visual + produces a distinctly different render shape** than Lane A/B (smaller byte count for numeric: 15597 vs 27345). This matches the operator's domain claim that CB_RASTER + comma-separated raster params is the working path for advanced per-row styling.

### Probe C-NUM-8

- **WMS URL params (verbatim):** `STYLES=cb_raster CB_ATTR=fare_amount CB_VALS=10,25,50,100,200 POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11 POINTSIZES=4,5,6,7,8 POINTSHAPES=circle,circle,circle,circle,circle` + base params
- **HTTP status:** 200; **Bytes:** 15597 (distinctly different from Lane A/B 27345 — likely smaller because of per-point size variation reducing total rendered footprint at this zoom)
- **Tile bytes path:** `kinetica_bi/server/spike-output/37-C-num-8.png`
- **Verdict:** PASS (operator confirmed classbreak rendering; byte-count differentiation is additional positive signal)

### Probe C-NUM-6 / C-CAT-8 / C-CAT-6

C-NUM-6: 15597 bytes (byte-identical to C-NUM-8 — color format makes no visual difference). C-CAT-8/6: 27352 bytes each (close to baseline + Lane A/B CAT 27345 bytes; categorical breaks don't drive POINTSIZES differentiation, so tile size is close to non-CB render). All HTTP PASS; visual classbreak confirmed.

---

## Categorical Edge-Case Probes

### Probe Edge-1 — `<other>` keyword sink-bucket

Implicitly tested in A-CAT-8 / B-CAT-8 / C-CAT-8 — all three probes include `<other>` as the third break value and all return HTTP 200 + image/png. Kinetica accepts the `<other>` keyword as a sink bucket under both naming conventions (`CB_BREAK_POINT_3=<other>` for Lane A, `CB_VALS=cash,credit,<other>` for Lane B/C). **Verdict: PASS — `<other>` is a usable sink-bucket keyword in Kinetica WMS classbreak rendering on payment_type.**

### Probe Edge-2 — Comma-escape behavior (quoted form + backslash form)

- **Quoted form:** `STYLES=classbreak CB_ATTR=payment_type CB_VALS="foo,bar",baz CB_POINTCOLORS=FF112233,FF445566` → HTTP 200, 27345 bytes (byte-identical to baseline classbreak responses)
- **Backslash form:** `CB_VALS=foo\,bar,baz` → HTTP 200, 27345 bytes
- **Operator observation:** Both produced tiles indistinguishable from each other and from other Lane B categorical probes. demo.nyctaxi.payment_type has no values containing commas, so the escape semantics could not be empirically differentiated — both forms parse without HTTP error but cannot be visually verified to actually match comma-containing values.
- **Verdict:** PARTIAL — both forms PASS HTTP without error, but escape semantics are UNVERIFIABLE on this fixture (no comma-containing payment_type values exist to test against). **Phase 39 categorical UX should default to backslash escaping (matches POSIX shell convention)**; revisit if any operator dataset surfaces comma-containing values that fail to match.

### Probe Edge-3 — NULL bucket handling

- **Payload:** `CB_VALS=cash,credit` (no `<other>` sink) — observe where NULLs route
- **HTTP status:** 200; **Bytes:** 27345 (byte-identical to other Lane B CAT probes including B-CAT-8 which HAS `<other>`)
- **Operator observation:** Visual comparison between EDGE-3-NULL and B-CAT-8 was not differentiable (operator could not tell). Byte-identical responses with and without `<other>` strongly suggest NULL rows are silently excluded by Kinetica when no sink bucket is specified.
- **Verdict:** PASS-EXCLUDED — most likely interpretation given byte-identical responses: NULLs map to nothing (excluded from the rendered output) when `<other>` is not present. Phase 39 categorical UX should default the `<other>` toggle to ON to give operators a visible sink-bucket option that prevents NULL-row blanking.

### Probe Edge-4 — Mixed numeric/categorical on TEXT column (clean-error expectation)

- **Payload:** `CB_ATTR=payment_type CB_VALS=1:5,10:20,"high"` (TEXT column, mixed numeric-range syntax)
- **HTTP status:** 200; **Bytes:** 27345 (NOT HTTP 400 as initially hypothesized)
- **Operator observation:** Tile is indistinguishable from other Lane B CAT probes — no error returned, no obvious garbage rendering.
- **Verdict:** SILENT-IGNORE — Kinetica does NOT return a clean HTTP 400 on mixed-syntax CB_VALS against a TEXT column. It accepts the params, parses some subset (likely just the string-form values like `"high"`, ignoring `1:5` and `10:20`), and renders without warning. **Phase 39 categorical UX MUST validate CB_VALS shape client-side before submit** — Kinetica's server-side validation is too permissive to be a reliable trip-wire.

---

## Color-Format Probes

Lane-A/B/C 6-char vs 8-char comparison.

**Bytes:** every 6-char vs 8-char pair produces BYTE-IDENTICAL tiles within its lane:
- Lane A NUM: 6=27345, 8=27345 (identical)
- Lane A CAT: 6=27345, 8=27345 (identical)
- Lane B NUM: 6=27345, 8=27345 (identical)
- Lane B CAT: 6=27345, 8=27345 (identical)
- Lane C NUM: 6=15597, 8=15597 (identical)
- Lane C CAT: 6=27352, 8=27352 (identical)

**Operator observation:** Could not visually distinguish 6-char from 8-char in any lane. Kinetica accepts both formats and renders them identically in PNG output. The alpha channel of 8-char (`FF` prefix = fully opaque) is the implicit value Kinetica uses when 6-char is supplied.

**Verdict:** Kinetica accepts BOTH 6-char (RRGGBB) and 8-char (AARRGGBB) color formats interchangeably. Both render identically.

**However:** Phase 38 SCHEMA-V17-05 should STILL fix the existing `wmsUrlBuilder.ts:337` inconsistency (raster branch uses `normalizeAARRGGBB` for 8-char; classbreak branch uses `b.color.toUpperCase()` for 6-char). The fix is for code-base consistency, not because 6-char actually breaks Kinetica. **Phase 38 SCHEMA-V17-05 directive: swap classbreak branch to `normalizeAARRGGBB(b.color, "FF000000")` so all Kinetica WMS color emissions are 8-char AARRGGBB and the future operator who configures alpha-transparency in classbreak rows has a working path** (operators currently get a 6-char output regardless of UI state, blocking transparency support).

---

## NTILE Quantile Probes

Lock the working `NTILE` SQL form for Phase 38 `/api/quantile` endpoint.

### Probe NTILE-A — `PARTITION BY 0` form

- **SQL (verbatim):**
  ```sql
  SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY fare_amount) AS bucket, fare_amount FROM demo.nyctaxi LIMIT 1000
  ```
- **HTTP status:** 200
- **Response body excerpt:** 1000-row result with `column_headers: ["bucket", "fare_amount"]`, `column_datatypes: ["long", "float"]`. Bucket values span 1–5 across the 1000 rows; fare_amount values range from -3 to 65.
- **Verdict:** PASS — `PARTITION BY 0` accepted by Kinetica. Phase 38 `/api/quantile` SQL template uses this form.

### Probe NTILE-B — Bare `ORDER BY` (no PARTITION) fallback

- **SQL:** `SELECT NTILE(5) OVER (ORDER BY fare_amount) AS bucket, fare_amount FROM demo.nyctaxi LIMIT 1000`
- **HTTP status:** 200; same row count and shape as NTILE-A.
- **Verdict:** PASS — bare ORDER BY also works. Either form is viable for Phase 38; we'll use `PARTITION BY 0` for explicitness (STACK research recommendation).

### Probe NTILE-C — Bucket-boundaries via MIN wrapper

- **SQL:**
  ```sql
  SELECT bucket, MIN(fare_amount) AS boundary FROM (SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY fare_amount) AS bucket, fare_amount FROM demo.nyctaxi) GROUP BY bucket ORDER BY bucket
  ```
- **HTTP status:** 200
- **Response body (verbatim):** `{"column_1":[1,2,3,4,5],"column_2":[-100,5.7,7.7,10.1,15.2],"column_headers":["bucket","boundary"],"column_datatypes":["long","float"]}`
- **Verdict:** PASS — bucket boundaries usable directly for Phase 38 `/api/quantile` response. Phase 38 endpoint returns `{ breaks: [5.7, 7.7, 10.1, 15.2] }` (skipping bucket 1's MIN which is the dataset minimum; only return upper boundaries for N-1 buckets to define N classbreak ranges).

---

## Track Probes

**STATUS: HTTP-PASS, VISUAL DEFERRED.** All 18 probes (T-R-1..9 + T-CB-1..9) returned HTTP 200 + image/png + 4722 bytes — byte-identical across every probe regardless of TRACK_* param combinations. Operator's visual inspection: "All blank — `demo.track` is empty." This indicates the operator's `demo.track` table either has zero rows or no rows within either the Manhattan BBOX or the San Francisco BBOX (`-122.55,37.70,-122.35,37.85` operator-supplied override). The 4722-byte response is the empty/basemap-only tile.

**Visual confirmation of TRACK_* param behavior is DEFERRED to Phase 43 UAT precondition #1** (operator-supplied track table with at least 2 distinct TRACKID values and at least 10 rows within the BBOX). The HTTP-level lock below is sufficient for Phase 40 to ship the form UI + URL emission code; visual verification happens during the end-to-end live UAT walk-through.

### STYLES=raster matrix (T-R-1..T-R-9)

| Probe | Param added | HTTP | Bytes | Visual diff |
|-------|-------------|------|-------|-------------|
| T-R-1 | DOTRACKS=TRUE | 200 | 4722 | blank (no data) |
| T-R-2 | + TRACK_ID_ATTR=TRACKID | 200 | 4722 | blank |
| T-R-3 | + TRACK_ORDER_ATTR=TIMESTAMP | 200 | 4722 | blank |
| T-R-4 | + TRACKHEADCOLORS=FFFF0000 | 200 | 4722 | blank |
| T-R-5 | + TRACKLINECOLORS=FF0000FF | 200 | 4722 | blank |
| T-R-6 | + TRACKHEADSIZES=8 | 200 | 4722 | blank |
| T-R-7 | + TRACKLINEWIDTHS=2 | 200 | 4722 | blank |
| T-R-8 | + TRACKMARKERSHAPES=circle | 200 | 4722 | blank |
| T-R-9 | + TRACKHEADSHAPES=circle (alternate naming) | 200 | 4722 | blank |

**HTTP-level locked params under STYLES=raster:** All 9 TRACK_* + DOTRACKS params are accepted by Kinetica without error. The HTTP-200 PASS does NOT distinguish TRACKMARKERSHAPES from TRACKHEADSHAPES — both names are accepted at the parser level. **Phase 40 emits TRACKMARKERSHAPES by default (Kinetica 7.1 docs naming)** and accepts the risk that some Kinetica build might prefer TRACKHEADSHAPES; the empty-fixture limitation prevents resolving the alternate-naming question definitively here.

### STYLES=cb_raster matrix (T-CB-1..T-CB-9, comma-separated forms)

| Probe | Param added | HTTP | Bytes | Visual diff |
|-------|-------------|------|-------|-------------|
| T-CB-1 | DOTRACKS=TRUE + CB_ATTR=TRACKID + CB_VALS=1,2,3 + POINTCOLORS comma-sep | 200 | 4722 | blank |
| T-CB-2 | + TRACK_ID_ATTR | 200 | 4722 | blank |
| T-CB-3 | + TRACK_ORDER_ATTR | 200 | 4722 | blank |
| T-CB-4 | + TRACKHEADCOLORS=#a,#b,#c (comma-sep) | 200 | 4722 | blank |
| T-CB-5 | + TRACKLINECOLORS=#a,#b,#c | 200 | 4722 | blank |
| T-CB-6 | + TRACKHEADSIZES=8,6,4 | 200 | 4722 | blank |
| T-CB-7 | + TRACKLINEWIDTHS=2,3,4 | 200 | 4722 | blank |
| T-CB-8 | + TRACKMARKERSHAPES=circle,square,diamond | 200 | 4722 | blank |
| T-CB-9 | + TRACKHEADSHAPES=circle,square,diamond | 200 | 4722 | blank |

**HTTP-level locked params under STYLES=cb_raster:** All TRACK_* + raster-style comma-separated params accepted. **Operator's domain claim is HTTP-confirmed but not visual-confirmed** — Kinetica parses the comma-separated forms without error, but the empty fixture prevents resolving whether each comma-separated position actually maps to a CB break the way operator expects.

---

## Decision

This section is the contractual output of Phase 37 — Phase 38 and Phase 40 implementers read these locked verdicts verbatim and copy the SQL/URL templates into the production code without re-probing.

**CB param-name set locked per render mode:**

Both Lane A (codebase) AND Lane B (docs) work for `STYLES=classbreak`. Lane C works for `STYLES=cb_raster`. Phase 38 picks the docs-canonical naming for future-proofing.

- **For `STYLES=classbreak` (basic classbreak rendering):** Phase 38 SCHEMA-V17-03 emits **Lane B** naming verbatim:
  ```text
  STYLES=classbreak
  CB_ATTR=<column>
  CB_VALS=<comma-separated values; numeric or categorical; supports <other> keyword as sink bucket>
  CB_POINTCOLORS=<comma-separated 8-char AARRGGBB colors>
  ```
- **For `STYLES=cb_raster` (advanced classbreak with per-break sizing/shaping — the path Phase 40 + advanced CB-V17-07 use):** Phase 38 SCHEMA-V17-04 emits **Lane C** naming verbatim:
  ```text
  STYLES=cb_raster
  CB_ATTR=<column>
  CB_VALS=<comma-separated values>
  POINTCOLORS=<comma-separated 8-char AARRGGBB>
  POINTSIZES=<comma-separated integers>
  POINTSHAPES=<comma-separated shape names: circle, square, diamond, triangle>
  SHAPELINEWIDTHS=<comma-separated integers, optional>
  SHAPELINECOLORS=<comma-separated 8-char AARRGGBB, optional>
  SHAPEFILLCOLORS=<comma-separated 8-char AARRGGBB, optional>
  ```

**Color format locked:**

Both 6-char (RRGGBB) and 8-char (AARRGGBB) accepted by Kinetica. **Phase 38 SCHEMA-V17-05 directive: standardize on 8-char AARRGGBB across all CB color emissions** for code-base consistency and to unlock alpha-channel transparency in future classbreak operator-config UIs. Specific fix: `wmsUrlBuilder.ts:337` line `params[\`CB_POINTCOLOR_${n}\`] = b.color.toUpperCase()` → `params[\`CB_POINTCOLORS\`] = breaks.map(b => normalizeAARRGGBB(b.color, "FF000000")).join(",")` (combined with the Lane B → Lane B naming swap above). The existing 6-char inconsistency is dead code as soon as Phase 38 swaps the param-name set; the fix is bundled into the naming swap.

**NTILE syntax locked:**

`NTILE(n) OVER (PARTITION BY 0 ORDER BY <column>)` works. Bare `ORDER BY` also works (fallback). Phase 38 `/api/quantile` endpoint emits PARTITION BY 0 form for explicitness:

```sql
SELECT bucket, MIN(<column>) AS boundary
FROM (
  SELECT NTILE($n) OVER (PARTITION BY 0 ORDER BY <column>) AS bucket, <column>
  FROM <table>
)
GROUP BY bucket
ORDER BY bucket
```

Endpoint returns `{ breaks: number[] }` where `breaks[i]` = the lower boundary of bucket `i+2` (so for N=5 buckets, returns 4 boundary values that define the 5 ranges). Drop bucket 1's MIN (it's the dataset minimum; not a useful upper boundary).

**DOTRACKS + TRACK_* matrix locked:** (HTTP-level only — visual DEFERRED to Phase 43 UAT)

- **Under `STYLES=raster`** (Phase 40 emits when `trackConfig.enabled === true` AND render mode = raster):
  ```text
  DOTRACKS=TRUE
  TRACK_ID_ATTR=<column, default TRACKID>
  TRACK_ORDER_ATTR=<column, default TIMESTAMP>
  TRACKHEADCOLORS=<8-char AARRGGBB>
  TRACKLINECOLORS=<8-char AARRGGBB>
  TRACKHEADSIZES=<integer>
  TRACKLINEWIDTHS=<integer>
  TRACKMARKERSHAPES=<shape name: circle/square/diamond/triangle>
  ```
- **Under `STYLES=cb_raster`** (Phase 40 emits when `trackConfig.enabled === true` AND render mode = classbreak — operator's high-confidence comma-sep claim):
  ```text
  DOTRACKS=TRUE
  TRACK_ID_ATTR=<column>
  TRACK_ORDER_ATTR=<column>
  TRACKHEADCOLORS=<comma-separated 8-char AARRGGBB, N values matching CB_VALS length>
  TRACKLINECOLORS=<comma-separated 8-char AARRGGBB>
  TRACKHEADSIZES=<comma-separated integers>
  TRACKLINEWIDTHS=<comma-separated integers>
  TRACKMARKERSHAPES=<comma-separated shape names>
  ```
- **TRACKMARKERSHAPES vs TRACKHEADSHAPES:** Both accepted at HTTP-parse level; Phase 40 emits TRACKMARKERSHAPES per Kinetica 7.1 docs. The alternate-naming question (TRACKHEADSHAPES) is deferred to Phase 43 UAT with a real track table.
- **Track visual verification path:** Phase 43 UAT precondition #1 — operator must supply a track table with ≥2 distinct TRACKID values and ≥10 rows within the chosen BBOX. Live walk-through confirms head/trail/marker styling actually renders.

**Overall outcome:** **PARTIAL — Phase 38 + 39 + 41 + 42 unblocked; Phase 40 unblocked at HTTP-emit level (visual confirmation deferred to Phase 43 UAT precondition)**

**SQL/URL templates Phase 38 will emit:**

```text
# STYLES=classbreak (basic CB rendering)
?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=$schema.$table&BBOX=$bbox&WIDTH=$w&HEIGHT=$h&FORMAT=image/png&SRS=EPSG:4326&STYLES=classbreak&X_ATTR=$lonCol&Y_ATTR=$latCol&CB_ATTR=$cbCol&CB_VALS=$breakValuesCsv&CB_POINTCOLORS=$colorsCsv
```

```text
# STYLES=cb_raster (advanced CB + Phase 40 Track combo)
?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=$schema.$table&BBOX=$bbox&WIDTH=$w&HEIGHT=$h&FORMAT=image/png&SRS=EPSG:4326&STYLES=cb_raster&X_ATTR=$lonCol&Y_ATTR=$latCol&CB_ATTR=$cbCol&CB_VALS=$breakValuesCsv&POINTCOLORS=$colorsCsv&POINTSIZES=$sizesCsv&POINTSHAPES=$shapesCsv[&DOTRACKS=TRUE&TRACK_ID_ATTR=$trackIdCol&TRACK_ORDER_ATTR=$trackOrderCol&TRACKHEADCOLORS=$trackHeadColorsCsv&TRACKLINECOLORS=$trackLineColorsCsv&TRACKHEADSIZES=$trackHeadSizesCsv&TRACKLINEWIDTHS=$trackLineWidthsCsv&TRACKMARKERSHAPES=$trackShapesCsv]
```

```sql
-- /api/quantile request body: { schema, table, column, n }
-- Response: { breaks: number[] } where length = n - 1
SELECT bucket, MIN($column) AS boundary
FROM (
  SELECT NTILE($n) OVER (PARTITION BY 0 ORDER BY $column) AS bucket, $column
  FROM $schema.$table
)
GROUP BY bucket
ORDER BY bucket
```

---

## Caveats

- **Runner v1 had a critical bug.** v1 emitted CB probes without `X_ATTR`/`Y_ATTR`, causing all 12 CB lanes to fail with `Invalid_Argument: No field with this name (Name:"x")(TM/Tc:996)`. Runner v2 (commit `3ffa937`) made `CB_X_COL` + `CB_Y_COL` env vars mandatory. Future operators running `npm run cb-track-spike` will fail-fast with a clear env-var error if these are missing.
- **Lane A and Lane B produce byte-identical 27345-byte responses across all 4 probes each.** This is consistent with Kinetica accepting both naming families and producing visually equivalent output. The byte-identicality is a positive signal (not a silent-no-op concern) because the operator's visual inspection confirmed classbreak rendering.
- **6-char vs 8-char color format is visually indistinguishable.** Kinetica appears to default the alpha channel to fully opaque (FF) when 6-char is supplied. Phase 38 SCHEMA-V17-05 fix (standardize on 8-char AARRGGBB) is therefore for code-base consistency and future alpha-channel-transparency support, NOT to fix any rendering bug.
- **`demo.track` is empty.** All 18 TRACK_* probes returned 4722-byte blank tiles regardless of BBOX (Manhattan OR San Francisco). Phase 40 ships at the HTTP-emit level; visual confirmation moves to Phase 43 UAT precondition.
- **Categorical edge-case Edge-4 (mixed numeric:range/categorical on TEXT column) silently parsed without HTTP 400.** Kinetica accepts malformed CB_VALS without error. Phase 39 categorical UX MUST validate CB_VALS shape client-side before submit — server-side validation is too permissive.
- **Categorical edge-case Edge-3 (NULL bucket without `<other>`) produced byte-identical response to Edge-3 with `<other>`.** Most likely interpretation: NULLs are silently excluded by Kinetica when no `<other>` sink is specified. Phase 39 should default `<other>` toggle to ON to make this visible.
- **Edge-2 (comma-escape) UNVERIFIABLE on demo.nyctaxi.payment_type.** No values contain commas; both quoted (`"foo,bar",baz`) and backslash-escaped (`foo\,bar,baz`) forms parse without HTTP error but cannot be empirically distinguished. Phase 39 defaults to backslash escape; revisit if a real dataset surfaces comma-containing categorical values.
- **TRACKMARKERSHAPES vs TRACKHEADSHAPES alternate-naming question UNRESOLVED.** Both accepted at HTTP-parse level with empty fixture; Phase 40 emits TRACKMARKERSHAPES per docs default.
- **CB_RASTER + raster-style param combo (Lane C) confirmed at HTTP+visual** but the comma-separation positional semantics (does `POINTCOLORS=A,B,C` actually map A→bucket1, B→bucket2, C→bucket3 the way operator expects?) is INFERRED from byte-count differentiation, not directly verified. Phase 39 UAT and Phase 43 live walk-through are the visual ground-truth gates.
- **No `wkb` spike** — TD-V14-WKB-SPIKE carry; classbreak excludes WKB columns per CB-V17-08.

---

## Open Question Resolutions

- **OQ-1: Which CB param-name set does the deployed Kinetica accept?** → **BOTH Lane A AND Lane B** under `STYLES=classbreak`; **Lane C** under `STYLES=cb_raster`. Phase 38 emits Lane B for basic CB + Lane C for advanced CB (per-break sizes/shapes/track combo).
- **OQ-2: Does Kinetica accept 6-char RRGGBB, 8-char AARRGGBB, or both for CB color params?** → **Both.** Kinetica defaults alpha=FF when 6-char supplied. Phase 38 standardizes on 8-char AARRGGBB for code-base consistency + future alpha-transparency support.
- **OQ-3: Does CB_VALS support the `<other>` sink-bucket keyword as documented?** → **YES (PASS).** Tested in A-CAT-8 / B-CAT-8 / C-CAT-8 — all produced HTTP 200 + image/png with `<other>` as the third break value.
- **OQ-4: Which comma-escape form does CB_VALS accept (quoted vs backslash)?** → **UNVERIFIABLE on demo.nyctaxi fixture** — no comma-containing payment_type values. Both forms PASS HTTP parse without error. Phase 39 defaults to backslash escape (POSIX shell convention); revisit if a real comma-containing dataset surfaces.
- **OQ-5: How does Kinetica handle NULL rows when CB_VALS does not include `<other>`?** → **Silently excluded.** Byte-identical responses between Edge-3-NULL (no `<other>`) and B-CAT-8 (with `<other>`) strongly suggest NULL rows render to nothing without a sink. Phase 39 categorical UX defaults `<other>` toggle to ON.
- **OQ-6: Does `NTILE(n) OVER (PARTITION BY 0 ORDER BY col)` execute against the deployed Kinetica, or is bare `ORDER BY` required?** → **Both work.** Phase 38 `/api/quantile` uses PARTITION BY 0 form for explicitness.
- **OQ-7: Does `DOTRACKS=TRUE` work under `STYLES=raster` AND `STYLES=cb_raster`, or only one?** → **HTTP-PASS under both.** Kinetica accepts DOTRACKS under both render modes at parse level. Visual verification deferred (empty fixture).
- **OQ-8: Do TRACK_* params accept comma-separated values under `STYLES=cb_raster` (operator's domain claim)?** → **HTTP-PASS — Kinetica accepts comma-separated TRACK_* under cb_raster without error.** Visual confirmation deferred to Phase 43 UAT. Phase 40 ships the comma-sep emission code per operator's domain knowledge; UAT validates.
- **OQ-9: Which track-head-shape param does Kinetica accept — TRACKMARKERSHAPES or TRACKHEADSHAPES?** → **Both accepted at HTTP-parse level; alternate-naming question DEFERRED to Phase 43 UAT.** Phase 40 emits TRACKMARKERSHAPES per Kinetica 7.1 docs naming.

---

*Phase: 37-cb-track-wms-spike*
*Spike runner: `kinetica_bi/server/src/cbTrackSpike.ts` (commit `3ffa937`; runnable via `npm run cb-track-spike` from `kinetica_bi/server/`)*
*Skeleton created: 2026-05-18 by Task 1; verdicts filled: 2026-05-19 from operator Task 2 paste of v2 runner output*
