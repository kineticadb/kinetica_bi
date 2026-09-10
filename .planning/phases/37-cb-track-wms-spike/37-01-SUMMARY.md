# Plan 37-01: CB/Track WMS Spike — SUMMARY

**Phase:** 37 — cb-track-wms-spike
**Plan:** 37-01-cb-track-wms-spike
**Status:** COMPLETE
**Started:** 2026-05-18
**Completed:** 2026-05-19
**Commits:** `d04de5b` (Task 1 — runner + skeleton), `3ffa937` (runner v2 — X_ATTR/Y_ATTR + TRACK_BBOX patch), `becf38c` (Task 3 — filled Decision Record)

## Objective

Operator-driven spike against the deployed Kinetica instance to lock the EXACT WMS parameter surface for classbreak (CB_*) and track (TRACK_*) styling — eliminating the CB_COLUMN_NAME vs CB_ATTR codebase-vs-docs discrepancy, the 6-char RRGGBB vs 8-char AARRGGBB color-format ambiguity, the DOTRACKS gating semantics, the CB_RASTER + comma-separated raster-param behavior, and the NTILE quantile SQL form — BEFORE any Phase 38 `wmsUrlBuilder` rewrite or `/api/quantile` endpoint code lands.

## Requirements Addressed

- SPIKE-V17-01: CB param names probed under both naming conventions (Lane A codebase, Lane B docs) + categorical CB_VALS + color format ✓
- SPIKE-V17-02: Categorical `<other>` keyword + comma-escape + NULL bucket + mixed numeric/categorical edge cases probed ✓
- SPIKE-V17-03: 6-char RRGGBB vs 8-char AARRGGBB explicit probes under all three lanes ✓
- SPIKE-V17-04: DOTRACKS=TRUE + 9-param TRACK_* matrix under STYLES=raster probed (HTTP-only; visual deferred per empty fixture) ✓
- SPIKE-V17-05: TRACK_* + comma-separated raster params under STYLES=cb_raster probed (HTTP-only; visual deferred) ✓
- SPIKE-V17-06: `cbTrackSpike.ts` committed + `npm run cb-track-spike` runnable + `37-SPIKE-NOTES.md` Decision Record committed ✓

## Key Files Created/Modified

### Created
- `kinetica_bi/server/src/cbTrackSpike.ts` (~1010 LOC) — spike runner mirroring `spatialPredicateSpike.ts` shape; 40+ probe blocks across three CB lanes × two fixtures + four categorical edge cases + 18-cell TRACK_* matrix + 3 NTILE probes + color-format probes
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` — Decision Record with Status banner + 11 section headers + 9 OQ resolutions + per-probe verbatim verdicts + Phase 38/40 SQL/URL templates

### Modified
- `kinetica_bi/server/package.json` — added `cb-track-spike` script entry (mirrors `wms-spike` / `wkb-spike` / `spatial-predicate-spike` precedents)
- `.gitignore` — added `kinetica_bi/server/spike-output/` so raw PNG tile bytes never enter git history; only 37-SPIKE-NOTES.md + screenshots commit

## Locked Decisions (consumed by Phase 38 + Phase 40)

**CB param-name set:**
- **STYLES=classbreak (basic CB):** Phase 38 SCHEMA-V17-03 emits Lane B (docs-canonical) — `CB_ATTR` + `CB_VALS` + `CB_POINTCOLORS`
- **STYLES=cb_raster (advanced CB + Track combo):** Phase 38 SCHEMA-V17-04 emits Lane C (operator's domain-confirmed) — `CB_ATTR` + `CB_VALS` + comma-separated `POINTCOLORS` / `POINTSIZES` / `POINTSHAPES` / `SHAPELINEWIDTHS` / `SHAPELINECOLORS` / `SHAPEFILLCOLORS`

**Color format:** Both 6-char (RRGGBB) and 8-char (AARRGGBB) accepted by Kinetica; Phase 38 SCHEMA-V17-05 standardizes on 8-char AARRGGBB for code-base consistency + future alpha-channel support. Fix `wmsUrlBuilder.ts:337` `.toUpperCase()` → `normalizeAARRGGBB(b.color, "FF000000")`.

**NTILE quantile SQL:** `NTILE($n) OVER (PARTITION BY 0 ORDER BY $col)` with bucket-MIN wrapper for boundaries. Phase 38 SCHEMA-V17-06 `/api/quantile` endpoint emits this SQL template.

**DOTRACKS + TRACK_* matrix (HTTP-locked; visual DEFERRED):**
- Both STYLES=raster and STYLES=cb_raster accept DOTRACKS + 9 TRACK_* params + comma-separated forms.
- Phase 40 ships emission code per the HTTP-locked param set.
- TRACKMARKERSHAPES emitted by default (Kinetica 7.1 docs naming); TRACKHEADSHAPES alternate-naming risk DEFERRED.
- Visual confirmation moves to Phase 43 UAT precondition #1 (operator-supplied track table with ≥2 distinct TRACKID values + ≥10 rows in BBOX).

**Categorical edge cases:**
- `<other>` keyword PASS (sink bucket works).
- NULL bucket: silently excluded when `<other>` absent → Phase 39 defaults `<other>` toggle ON.
- Mixed numeric/categorical: silently parsed without HTTP 400 → Phase 39 client-side validation MANDATORY.
- Comma-escape: UNVERIFIABLE on `demo.nyctaxi.payment_type` (no comma-containing values) → Phase 39 defaults to backslash escape; revisit if real comma values surface.

## Process Notes

**Runner v1 had a critical bug.** v1 emitted CB probes without `X_ATTR`/`Y_ATTR`, causing all 12 CB lanes to fail with `Invalid_Argument: No field with this name (Name:"x")(TM/Tc:996)`. The runner correctly emitted these for Track probes (lines 667-668, 769-770 in v1) but not for CB probes against `demo.nyctaxi`. Production `kinetica_bi/src/lib/wmsUrlBuilder.ts:134-139` resolves X_ATTR/Y_ATTR from `config.lonColumn`/`config.latColumn`, confirming the production path requires these params.

**Runner v2 fix (commit `3ffa937`):** Made `CB_X_COL` + `CB_Y_COL` env vars mandatory. Added `TRACK_BBOX` optional override. Two helper functions `cbBaseParams()` and `trackBaseParams()` ensure X_ATTR/Y_ATTR injection on CB probes and BBOX override on Track probes. tsc-clean.

**`demo.track` fixture is empty.** All 18 TRACK_* probes returned byte-identical 4722-byte blank tiles under both Manhattan and San Francisco (operator-supplied TRACK_BBOX override) BBOX values. This indicates the operator's `demo.track` table has zero rows (or rows outside both probed regions). Phase 40 ships at the HTTP-emit level; visual verification is a Phase 43 UAT precondition.

**No `wkb` spike.** TD-V14-WKB-SPIKE carry; classbreak excludes WKB columns per CB-V17-08.

## Verification

- Task 1 acceptance criteria: ✓ (35+ grep patterns + tsc --noEmit clean)
- Task 2 checkpoint: ✓ (operator confirmed v2 run results + visual classbreak rendering on Lane A/B/C)
- Task 3 acceptance criteria: ✓ (17 of 17 section/key-line grep patterns + ≥9 OQ resolutions + no TODO/TBD/XXX/FIXME markers)

## Downstream Consumers

- **Phase 38** (Schema + WMS Engine Foundation): Reads `## Decision` section to copy SQL/URL templates verbatim; implements SCHEMA-V17-03/04/05/06/07 against locked param names.
- **Phase 40** (Track Sub-Section UI): Reads `## Decision` § "DOTRACKS + TRACK_* matrix locked" to emit comma-separated TRACK_* params under STYLES=cb_raster; visual verification deferred to Phase 43.
- **Phase 39** (Classbreak Form UI): Reads `## Caveats` for client-side validation requirements (CB_VALS shape validation, `<other>` default-ON toggle).
- **Phase 43** (Verification + Live UAT): Reads `## Caveats` for live UAT preconditions — operator-supplied track table with real data is mandatory for TRACK_* visual confirmation.
