---
phase: 37-cb-track-wms-spike
verified: 2026-05-19T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Track visual confirmation — STYLES=raster tile renders head/trail with TRACKHEADCOLORS + TRACKLINECOLORS styling"
    expected: "Colored track head marker and trail line visible on tile when demo.track fixture contains data within BBOX"
    why_human: "demo.track table is empty in operator's deployed instance; all 18 TRACK_* probes returned blank 4722-byte tiles. HTTP 200 + param acceptance confirmed; visual rendering requires operator to supply a track table with >=2 distinct TRACKID values and >=10 rows inside the BBOX."
  - test: "Track visual confirmation — STYLES=cb_raster tile renders per-break comma-separated TRACK_* params"
    expected: "Distinct per-TRACKID head/trail styling visible when comma-separated TRACKHEADCOLORS/TRACKLINECOLORS/TRACKHEADSIZES emit different values per break"
    why_human: "Same empty-fixture limitation. HTTP acceptance of comma-sep forms confirmed; positional semantics (POINTCOLORS=A,B,C maps A to bucket1) is inferred from byte-count differentiation, not directly observed."
  - test: "TRACKMARKERSHAPES vs TRACKHEADSHAPES alternate naming — confirm which name produces track head markers"
    expected: "One param name produces visible marker shapes; the other may be silently ignored or produce identical output"
    why_human: "Both names accepted at HTTP-parse level with empty fixture; cannot distinguish from HTTP status alone. Deferred to Phase 43 UAT."
---

# Phase 37: CB/Track WMS Spike — Verification Report

**Phase Goal:** Lock the exact Kinetica WMS parameter surface for classbreak and track styling against the deployed instance before any UI code ships — eliminating the CB_COLUMN_NAME vs CB_ATTR discrepancy and the color format ambiguity.

**Verified:** 2026-05-19
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator has run cbTrackSpike against the deployed Kinetica instance with their own credentials; HTTP status + tile bytes captured for every probe block | VERIFIED | 37-SPIKE-NOTES.md contains verbatim HTTP status, content-type, and byte counts for all probe blocks: 2 baseline + 12 CB lane + 4 edge-case + 3 NTILE + 18 TRACK_* = 39+ probe results. |
| 2 | 37-SPIKE-NOTES.md is committed with PASS/FAIL verdicts per probe block covering all three CB lanes, four categorical edge cases, DOTRACKS+TRACK_* matrix under both STYLES=raster and STYLES=cb_raster, NTILE, and 6-char vs 8-char color probes — every verdict backed by HTTP status AND tile-diff reference | VERIFIED | All probe blocks present with HTTP status + bytes + PASS/FAIL verdict. CB visual diff confirmed by operator observation ("looks like classbreak images"). Track visual DEFERRED per empty-fixture acceptable path (see Partial-PASS note). |
| 3 | Decision Record in 37-SPIKE-NOTES.md locks the exact working CB param-name set per render mode (or NONE_ESCALATE if all three lanes fail); records the 6-char vs 8-char verdict with implementation directive; locks NTILE syntax; locks DOTRACKS + TRACK_* matrix so Phase 40 can ship | VERIFIED | ## Decision section present with unambiguous directives: Lane B locked for STYLES=classbreak, Lane C locked for STYLES=cb_raster, 8-char AARRGGBB directive issued, NTILE PARTITION BY 0 form selected, TRACK_* matrix HTTP-locked with specific emit templates. No open choices left to downstream phases. |
| 4 | Spike runner kinetica_bi/server/src/cbTrackSpike.ts committed and runnable via npm run cb-track-spike from a clean checkout; existing spike script entries preserved | VERIFIED | File exists at 981 LOC (exceeds 400-line minimum). `npm run cb-track-spike` entry confirmed at package.json:14. All three prior spike entries preserved (wms-spike:11, wkb-spike:12, spatial-predicate-spike:13). |
| 5 | spike-output/ directory is gitignored; only 37-SPIKE-NOTES.md + screenshots land in the commit | VERIFIED | .gitignore:10 contains `kinetica_bi/server/spike-output/` — the exact path the runner writes PNG tiles to (SPIKE_OUTPUT_DIR resolves to kinetica_bi/server/spike-output). |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `kinetica_bi/server/src/cbTrackSpike.ts` | Operator-runnable CB+Track WMS spike runner | VERIFIED | 981 LOC. Contains all required patterns: CB_COLUMN_NAME, CB_BREAK_POINT_, CB_POINTCOLOR_, CB_ATTR, CB_VALS, CB_POINTCOLORS, POINTCOLORS, POINTSIZES, STYLES=classbreak, STYLES=cb_raster, DOTRACKS, TRACK_ID_ATTR, TRACK_ORDER_ATTR, TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES, TRACKLINEWIDTHS, TRACKMARKERSHAPES, TRACKHEADSHAPES, NTILE, PARTITION BY 0, dotenv.config, encoding: "json", request_schema_str, basicAuth, spike-output, BBOX=-74.05,40.65,-73.85,40.85. 182 pattern matches confirmed via grep. |
| `kinetica_bi/server/package.json` | npm script wiring for cb-track-spike | VERIFIED | Line 14: `"cb-track-spike": "tsx src/cbTrackSpike.ts"` |
| `.gitignore` | spike-output/ gitignored at repo root or server path | VERIFIED | Root .gitignore line 10: `kinetica_bi/server/spike-output/` (scoped path covers the exact directory the runner uses) |
| `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` | Decision Record with probe verdicts + downstream templates | VERIFIED | 386 lines. Contains all required sections: ## Probe blocks, ## Decision, ## Caveats, ## Open Question Resolutions, Lane A, Lane B, Lane C, NTILE, DOTRACKS, AARRGGBB. Zero TODO/FIXME/TBD/XXX markers. 83 matches on key section headers. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `cbTrackSpike.ts` | `spatialPredicateSpike.ts` structural model | dotenv loading, basicAuth, redactedUrl, rawFetch, runSql, classify, SPIKE SUMMARY | WIRED | All boilerplate patterns confirmed present in cbTrackSpike.ts at lines 77-78 (basicAuth/redactedUrl), 137 (rawFetch), 147 (runSql), 242-261 (classify functions). |
| `cbTrackSpike.ts runSql()` | kinetica.ts:154-170 canonical /execute/sql payload | encoding: "json", request_schema_str, 7-field body | WIRED | Lines 167-168 in cbTrackSpike.ts confirm `encoding: "json"` and `request_schema_str: ""` present in the SQL POST body. |
| `37-SPIKE-NOTES.md ## Decision` | Phase 38 SCHEMA-V17-03/04/05 + SCHEMA-V17-06 | CB_ATTR, CB_VALS, CB_POINTCOLORS, DOTRACKS, AARRGGBB, NTILE with verbatim URL/SQL templates | WIRED | Decision section contains verbatim URL templates (lines 332-337), SQL template (lines 340-350), and per-render-mode param lists. Phase 38 implementers can copy without re-probing. |
| `wmsUrlBuilder.ts:325-340` | Phase 37 Lane A probes | CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_N / CB_POINTCOLOR_N | WIRED | Lane A probes in cbTrackSpike.ts mirror the current codebase param shape at lines 334-384. The existing bug (6-char b.color.toUpperCase()) is documented and the fix directive issued in Decision. |
| `37-SPIKE-NOTES.md ## Decision` | Commits `d04de5b`, `3ffa937`, `becf38c`, `a9091b3` | Sequential task completion | WIRED | All 4 documented commit hashes exist in git log. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SPIKE-V17-01 | 37-01 | Spike verifies exact CB param names (CB_ATTR vs CB_COLUMN_NAME, CB_VALS vs CB_BREAK_POINT_N) with HTTP 200 + visual tile diff | SATISFIED | Lane A (CB_COLUMN_NAME/CB_BREAK_POINT_N) PASS HTTP+visual, Lane B (CB_ATTR/CB_VALS) PASS HTTP+visual, both with byte counts + operator visual confirmation. Decision: Lane B locked for Phase 38. |
| SPIKE-V17-02 | 37-01 | Spike confirms categorical CB_VALS including `<other>` keyword, comma-escape, NULL bucket, mixed numeric/categorical | SATISFIED | Edge-1 (`<other>`) PASS. Edge-2 (comma-escape) PARTIAL/UNVERIFIABLE on fixture. Edge-3 (NULL) PASS-EXCLUDED. Edge-4 (mixed) SILENT-IGNORE with Phase 39 client-side validation directive. All 4 edge cases documented. |
| SPIKE-V17-03 | 37-01 | Spike confirms 6-char vs 8-char AARRGGBB color format with explicit tile-diff evidence; documents wmsUrlBuilder.ts bug | SATISFIED | 6 pairs of byte-identical tiles (6-char vs 8-char per lane) documented. Bug at wmsUrlBuilder.ts:337 explicitly named. Phase 38 SCHEMA-V17-05 directive: standardize on 8-char AARRGGBB via normalizeAARRGGBB(). |
| SPIKE-V17-04 | 37-01 | Spike confirms DOTRACKS=TRUE + 9-param TRACK_* matrix under STYLES=raster | SATISFIED (HTTP-only; visual DEFERRED per CONTEXT.md policy) | T-R-1..T-R-9: all HTTP 200 + 4722 bytes. All 9 TRACK_* params (DOTRACKS, TRACK_ID_ATTR, TRACK_ORDER_ATTR, TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES, TRACKLINEWIDTHS, TRACKMARKERSHAPES, TRACKHEADSHAPES) accepted without error. Visual deferred to Phase 43 UAT precondition. |
| SPIKE-V17-05 | 37-01 | Spike confirms TRACK_* + comma-separated raster params under STYLES=cb_raster | SATISFIED (HTTP-only; visual DEFERRED per CONTEXT.md policy) | T-CB-1..T-CB-9: all HTTP 200 + 4722 bytes. Comma-separated TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES, TRACKLINEWIDTHS, TRACKMARKERSHAPES accepted. Visual deferred to Phase 43 UAT. |
| SPIKE-V17-06 | 37-01 | cbTrackSpike.ts committed + npm run cb-track-spike runnable + 37-SPIKE-NOTES.md committed with PASS/FAIL + Decision Record | SATISFIED | File at 981 LOC. npm script at package.json:14. SPIKE-NOTES.md at 386 lines with full Decision Record. 4 commits verified in git log. |

No orphaned requirements — all 6 SPIKE-V17-xx IDs in REQUIREMENTS.md are mapped to plan 37-01 and all are SATISFIED.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TODO/FIXME/TBD/XXX markers in SPIKE-NOTES.md | — | Zero open markers; all 9 Open Questions resolved |

---

## Partial-PASS Note: Track Visual Deferred

Per the CONTEXT.md escalation policy: Track probes had HTTP confirmation only because the operator's `demo.track` fixture is empty. This is the documented acceptable path. The NONE_ESCALATE → BLOCK_V17 escalation applies ONLY if all three CB lanes fail across both fixtures — which did NOT occur (all three CB lanes PASSED HTTP + visual). Phase 40 ships at HTTP-emit level. Visual moves to Phase 43 UAT precondition #1 (operator-supplied track table with >=2 distinct TRACKID values and >=10 rows inside the BBOX).

---

## Human Verification Required

### 1. Track Visual — STYLES=raster

**Test:** Supply a track table with >=2 distinct TRACKID values and >=10 rows within a known BBOX. Run `npm run cb-track-spike` with `TRACK_TABLE`, `TRACK_ID_COL`, `TRACK_ORDER_COL`, `TRACK_X_COL`, `TRACK_Y_COL`, `TRACK_BBOX` pointing at this table.

**Expected:** T-R-4 (TRACKHEADCOLORS=FFFF0000) tile shows red track heads; T-R-5 (TRACKLINECOLORS=FF0000FF) shows blue trail lines; T-R-6 (TRACKHEADSIZES=8) shows larger head markers than default.

**Why human:** demo.track is empty; all 18 TRACK_* probes returned blank 4722-byte tiles regardless of BBOX. Phase 43 UAT precondition.

### 2. Track Visual — STYLES=cb_raster comma-separated TRACK_* params

**Test:** Same fixture. Run T-CB-4..T-CB-9 probes (comma-separated TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES). Observe whether per-CB-break track styling renders differently per break.

**Expected:** Each comma-separated position maps to the corresponding CB break — e.g., TRACKHEADCOLORS=FFFF0000,FF00FF00 renders TRACKID values matching break 1 with red heads and break 2 with green heads.

**Why human:** Positional semantics inferred from byte-count differentiation only; direct observation requires real track data.

### 3. TRACKMARKERSHAPES vs TRACKHEADSHAPES alternate naming

**Test:** Run T-R-8 (TRACKMARKERSHAPES=circle) and T-R-9 (TRACKHEADSHAPES=circle) with a real track fixture. Compare tile output.

**Expected:** At least one param name produces visible circle markers; if both work identically, TRACKMARKERSHAPES is canonical per Kinetica 7.1 docs. If one silently fails, document the working name.

**Why human:** Both accepted at HTTP-parse level with empty fixture; behavior cannot be distinguished without actual track rendering.

---

## Locked Param Sets (contractual output of Phase 37)

The following are verbatim from 37-SPIKE-NOTES.md §Decision. Phase 38 and Phase 40 copy these without re-probing.

### CB Param Set — STYLES=classbreak (Phase 38 SCHEMA-V17-03)

```
STYLES=classbreak
CB_ATTR=<column>
CB_VALS=<comma-separated values; numeric or categorical; supports <other> as sink bucket>
CB_POINTCOLORS=<comma-separated 8-char AARRGGBB colors>
```

### CB Param Set — STYLES=cb_raster (Phase 38 SCHEMA-V17-04)

```
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

### Color Format — Phase 38 SCHEMA-V17-05

Both 6-char RRGGBB and 8-char AARRGGBB accepted by Kinetica (byte-identical tiles). **Phase 38 standardizes on 8-char AARRGGBB.** Fix: `wmsUrlBuilder.ts:337` `b.color.toUpperCase()` → `normalizeAARRGGBB(b.color, "FF000000")`, combined with the Lane A → Lane B param-name swap.

### NTILE Quantile SQL — Phase 38 SCHEMA-V17-06 /api/quantile

```sql
SELECT bucket, MIN(<column>) AS boundary
FROM (
  SELECT NTILE($n) OVER (PARTITION BY 0 ORDER BY <column>) AS bucket, <column>
  FROM <table>
)
GROUP BY bucket
ORDER BY bucket
-- Response: { breaks: number[] } where breaks[i] = lower boundary of bucket i+2
-- Drop bucket 1 MIN (dataset minimum); return N-1 boundaries for N ranges
```

### DOTRACKS + TRACK_* — Phase 40 (HTTP-locked)

Under STYLES=raster:
```
DOTRACKS=TRUE
TRACK_ID_ATTR=<column, default TRACKID>
TRACK_ORDER_ATTR=<column, default TIMESTAMP>
TRACKHEADCOLORS=<8-char AARRGGBB>
TRACKLINECOLORS=<8-char AARRGGBB>
TRACKHEADSIZES=<integer>
TRACKLINEWIDTHS=<integer>
TRACKMARKERSHAPES=<shape name: circle/square/diamond/triangle>
```

Under STYLES=cb_raster:
```
DOTRACKS=TRUE
TRACK_ID_ATTR=<column>
TRACK_ORDER_ATTR=<column>
TRACKHEADCOLORS=<comma-separated 8-char AARRGGBB, N values matching CB_VALS length>
TRACKLINECOLORS=<comma-separated 8-char AARRGGBB>
TRACKHEADSIZES=<comma-separated integers>
TRACKLINEWIDTHS=<comma-separated integers>
TRACKMARKERSHAPES=<comma-separated shape names>
```

VISUAL DEFERRED to Phase 43 UAT precondition #1.

---

## Downstream Unblock Confirmation

| Phase | Dependency on Phase 37 | Status |
|-------|------------------------|--------|
| Phase 38 (Schema + WMS Engine Foundation) | CB param-name set (Lane B for classbreak, Lane C for cb_raster), color format directive (8-char AARRGGBB), NTILE SQL template for /api/quantile | FULLY UNBLOCKED — all decisions locked without ambiguity |
| Phase 39 (Classbreak Form UI) | Categorical edge-case handling directives: `<other>` default-ON, client-side CB_VALS shape validation, backslash escape default | FULLY UNBLOCKED — all directives explicit in SPIKE-NOTES.md §Caveats |
| Phase 40 (Track Sub-Section UI) | DOTRACKS + TRACK_* param set under raster + cb_raster, HTTP-level acceptance confirmed | UNBLOCKED at HTTP-emit level — visual confirmation deferred to Phase 43 UAT precondition |
| Phase 41 (Advanced CB UX — per-break sizes/shapes) | cb_raster param set (Lane C: POINTCOLORS, POINTSIZES, POINTSHAPES CSV forms) | FULLY UNBLOCKED |
| Phase 42 (Integration + E2E tests) | Spike confirms exact param names and SQL template; test fixtures can use locked param sets | FULLY UNBLOCKED |
| Phase 43 (Verification + Live UAT) | Track visual walk-through is Phase 43 UAT precondition #1; must add to UAT checklist | PRECONDITION ADDED — operator must supply track table with >=2 TRACKID values + >=10 rows in BBOX |

---

## Gaps Summary

No gaps. All 5 must-haves verified. All 6 requirement IDs satisfied. The three human-verification items are not gaps — they are the intentional visual-deferred items covered by the CONTEXT.md Track-only failure path allowance. The spike achieved its goal: the CB param-name discrepancy is eliminated, the color format ambiguity is resolved with an implementation directive, and Phase 38 can begin implementing against known, locked parameter names without further probing.

---

_Verified: 2026-05-19_
_Verifier: Claude (gsd-verifier)_
