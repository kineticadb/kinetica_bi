---
phase: 39-classbreak-form-ui-auto-suggest
verified: 2026-05-21T20:00:00Z
status: passed
score: 5/5 success criteria verified; 9/9 requirement IDs satisfied
re_verification: false
---

# Phase 39: Classbreak Form UI + Auto-Suggest Verification Report

**Phase Goal:** Operators can configure classbreak rendering end-to-end from the LayersModal: pick the CB column, build numeric or categorical breaks with labels and colors, optionally add per-break advanced params, use Auto-suggest to populate quantile boundaries, and have the map re-render correctly on every change.
**Verified:** 2026-05-21
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Render-mode picker shows 3 options (Raster, Heatmap, Class Break); selecting Class Break reveals CbConfigForm without disturbing other paths | VERIFIED | `KineticaWmsLayerForm.tsx:546` — `ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m) && m !== "contour")` produces exactly 3 options; `KineticaWmsLayerForm.tsx:896-909` gates CbConfigForm under `renderMode === "classbreak"`; spec test at `KineticaWmsLayerForm.spec.tsx:94` asserts exactly 3 radios present and Contour absent |
| SC2 | Clicking [Auto-suggest breaks] calls `/api/quantile`, replaces rows with confirm when hand-edited; map re-renders with new break colors after save | VERIFIED | `CbConfigForm.tsx:42` imports `quantileFn` from `../../api/client`; `CbConfigForm.tsx:259-317` implements `runAutoSuggest` with `quantileFn` call + AbortController; `CbConfigForm.tsx:255+525-551` implements `showConfirm` state + `role="dialog"` confirm overlay; fingerprint covers `cb_config` at `MapChartRenderer.tsx:1118,1208` |
| SC3 | Categorical mode available for TEXT/CHAR columns: break values are text inputs, `<other>` bucket toggle present, distinct-value count probe warns + caps at 256 | VERIFIED | `CbConfigForm.tsx:453-489` — `cb-categorical-section` renders when `valsType='categorical'`; `<other>` toggle at line 477; `probeCardinality` wired at line 143; count>256 toast + hardCap guard at lines 145,383,777; warn>100 at line 150 |
| SC4 | WKB-binary columns excluded from CB column picker; inline message "WKB columns not supported for classbreak in v1.7" | VERIFIED | `CbConfigForm.tsx:99-106` — `hasWkbColumns` computed via `rawType.includes("bytes") \|\| rawType.includes("wkb")`; `CbConfigForm.tsx:412-415` — inline message rendered unconditionally when `hasWkbColumns`; `cbConfig.ts:164` — `filterCbEligibleColumns` performs WKB exclusion |
| SC5 | Editing any CB param triggers WMS tile re-render — `lastEmittedParamsRef` fingerprint covers all CB_* params | VERIFIED | `MapChartRenderer.tsx:1118,1208` — `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })`; 5 regression tests in `MapChartRenderer.spec.tsx:4351-4403` including structural grep of production source (test 5 reads the actual `.tsx` file and asserts the `{p,c,t}` shape via regex) |

**Score:** 5/5 success criteria verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `kinetica_bi/src/components/charts/CbConfigForm.tsx` | Full implementation: column picker + row builder + categorical + Auto-suggest | VERIFIED | 791 lines; substantive (not a stub); wired into `KineticaWmsLayerForm.tsx:897` under classbreak gate |
| `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx` | 59 tests covering all CB-V17-02..08 behaviors | VERIFIED | 1238 lines; 59 `it(` calls confirmed; all tests GREEN per executor |
| `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` | ClassbreakParamsGroup deleted; render-mode filter; CbConfigForm mounted | VERIFIED | `grep -c "ClassbreakParamsGroup"` returns 0; contour filter at line 546; CbConfigForm imported (line 48) and mounted (line 897) |
| `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` | 33 tests; Contour assertion inverted; 3-radio test added | VERIFIED | 33 `it(` calls; contour-not-present test at line 90; 3-radio test at line 94; CbConfigForm skeleton test at line 135 |
| `kinetica_bi/src/lib/cbConfig.ts` | PALETTE_COLORS + createDefaultBreak + filterCbEligibleColumns + detectValsTypeFromColumn added | VERIFIED | 182 lines; all 4 exports confirmed at lines 114, 129, 157, 175 |
| `kinetica_bi/src/lib/cbConfig.spec.ts` | 31 tests for all cbConfig helpers | VERIFIED | 253 lines; 31 `it(` calls confirmed |
| `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` | 5 CB-V17-09 regression tests for fingerprint | VERIFIED | `describe("Phase 39 CB-V17-09 ...")` at line 4351; 5 `it(` calls (lines 4364, 4371, 4378, 4384, 4393) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `KineticaWmsLayerForm.tsx` | `CbConfigForm.tsx` | `import` + render under `renderMode === "classbreak"` | WIRED | Line 48 import; line 897 render with `schema`, `tableName`, `isValid` props |
| `CbConfigForm.tsx` | `quantileFn` in `api/client.ts` | `import { quantileFn }` + call in `runAutoSuggest` | WIRED | Line 42 import; line 270 call `await quantileFn(...)` |
| `CbConfigForm.tsx` | `probeCardinality` in `lib/cardinalityProbe.ts` | `import { probeCardinality }` + call on column select | WIRED | Line 40 import; line 143 call `await probeCardinality(...)` |
| `CbConfigForm.tsx` | `filterCbEligibleColumns` in `lib/cbConfig.ts` | `import` + `useMemo` | WIRED | Line 28 import; line 95 `useMemo(() => filterCbEligibleColumns(...))` |
| `CbConfigForm.tsx` | `onChange` prop | `patchCb` as sole write site | WIRED | `patchCb` at line 109 is the only `onChange` caller; all 7 mutation sites (lines 126, 193, 222, 228, 232, 245, 304) call `patchCb` |
| `MapChartRenderer.tsx` | `layer.cb_config` | Fingerprint `JSON.stringify({ p, c, t })` | WIRED | Lines 1118 and 1208 both include `c: layer.cb_config` in the fingerprint |
| `wmsUrlBuilder.ts` | CB break data | `coalesceCbConfig` + comma-separated param emission | WIRED | Lines 392-410: `CB_ATTR`, `CB_VALS`, `POINTCOLORS`, optional `POINTSIZES`, `POINTSHAPES`, `SHAPELINEWIDTHS`, `SHAPELINECOLORS`, `SHAPEFILLCOLORS` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CB-V17-01 | 39-01 | Render-mode picker gains Class Break as 3rd option (Contour hidden) | SATISFIED | `KineticaWmsLayerForm.tsx:546` — `m !== "contour"` filter; `KineticaWmsLayerForm.spec.tsx:94` — 3-radio test |
| CB-V17-02 | 39-02 | CB column picker surfaces all non-spatial, non-WKB columns with type detection | SATISFIED | `CbConfigForm.tsx:90-97` — `spatialBound` exclusion + `filterCbEligibleColumns`; `detectValsTypeFromColumn` drives numeric/categorical default |
| CB-V17-03 | 39-02+39-03 | Numeric N-row builder with add/remove; 256 categorical hard-cap | SATISFIED | `CbConfigForm.tsx:228,232` — add/remove buttons; `hardCap` at line 383 disables `[+ Add break]` when cardinality>256; drag-reorder explicitly deferred to v1.8 (no `@dnd-kit/core` in package.json — confirmed in 39-RESEARCH.md) |
| CB-V17-04 | 39-03 | Categorical breaks UX: text inputs, `<other>` toggle, distinct-value probe | SATISFIED | `CbConfigForm.tsx:453-489` categorical section; `<other>` toggle at line 477; probeCardinality at line 143; warn>100 at line 150; hard-cap>256 + toast at line 145 |
| CB-V17-05 | 39-02 | Per-break label field persisted in `cb_config.breaks[].label` | SATISFIED | `CbConfigForm.tsx:611-627` — label input per row; `patchCb` serializes to `cb_config` JSON via `JSON.stringify` |
| CB-V17-06 | 39-03 | Auto-suggest button calls `POST /api/quantile`; N configurable 2-16; confirm if hand-edited | SATISFIED | `CbConfigForm.tsx:499-500` — `min={2} max={16}`; `runAutoSuggest` at line 259 calls `quantileFn`; `showConfirm` at line 255 + dialog at line 525 |
| CB-V17-07 | 39-02 | Per-row advanced params: pointSize/pointShape/shapeLineWidth/shapeLineColor/shapeFillColor | SATISFIED | `CbConfigForm.tsx:666-738` per-row advanced panel with all 5 fields; `wmsUrlBuilder.ts:396-410` emits comma-separated POINTSIZES/POINTSHAPES/SHAPELINEWIDTHS/SHAPELINECOLORS/SHAPEFILLCOLORS |
| CB-V17-08 | 39-01+39-02 | WKB columns excluded from picker; inline message present | SATISFIED | `cbConfig.ts:164` — `filterCbEligibleColumns` excludes WKB; `CbConfigForm.tsx:412-415` — "WKB columns not supported for classbreak in v1.7" shown when `hasWkbColumns` |
| CB-V17-09 | 39-03 | Fingerprint regression spec — `lastEmittedParamsRef` covers CB_* params | SATISFIED | 5 tests in `MapChartRenderer.spec.tsx:4351-4403`; test 5 reads production source via `fs.readFileSync` and asserts `{p,c,t}` shape regex; both production sites at lines 1118 and 1208 confirmed |

---

### Phase 38 Hard-Cutover Lock

`grep -c "cbColumn\|classbreaks" CbConfigForm.tsx` returns **0** — confirmed. The comment on line 5 uses "cb-column / classbreak-array" (rewording per Plan 39-02 deviation note) to satisfy this constraint without losing developer intent.

---

### Anti-Patterns Found

No blocker anti-patterns detected in Phase 39 files.

| File | Pattern | Severity | Finding |
|------|---------|----------|---------|
| `CbConfigForm.tsx` | Placeholder stub | INFO | No `return null` / placeholder text — 791-line full implementation |
| `CbConfigForm.tsx` | Legacy field writes | NONE | Confirmed 0 occurrences of `cbColumn` or `classbreaks` |

---

### Deviations from Plan (Documented and Accommodated)

1. **WKB hint visibility (39-02):** Plan specified "show WKB hint only when `eligibleColumns.length === 0`". Implemented as "show whenever `hasWkbColumns === true`" because the test `"shows WKB inline message when WKB columns present"` rendered with both eligible AND WKB columns. Semantically correct for CB-V17-08 intent (warn operators that WKB columns are excluded). Test is authoritative.

2. **Cardinality loading hint placement (39-03):** `cardinality?.state === "loading"` hint moved outside the `valsType=categorical` guard (line 448) to handle controlled-component timing where `cbConfig.valsType` hasn't propagated from parent yet during the in-flight probe.

3. **`aria-label` removed from `<other>` chip span (39-03):** Chip span is a display element, not interactive. `data-testid="cb-other-chip-{i}"` is the stable selector.

4. **Idempotent `<other>` test re-framed as "orphaned row" scenario (39-03):** Initial state `includeOtherBucket=false` with orphaned `<other>` row; toggle ON detects existing row and skips duplicate.

5. **Drag-reorder not implemented (CB-V17-03 partial):** REQUIREMENTS.md mentions "drag-reorder" in CB-V17-03, but 39-RESEARCH.md confirms `@dnd-kit/core` is absent from `package.json` and drag-reorder is explicitly deferred to v1.8. This is a known, documented deferral — not a gap in Phase 39 scope.

6. **Plan sub-plan checkboxes in ROADMAP.md still `[ ]`:** The phase-level entry at ROADMAP.md line 114 correctly shows `[x]` with "completed 2026-05-21". The three sub-plan list items still show `[ ]`. This is a cosmetic inconsistency; the phase is correctly marked complete at the phase level. Sub-plan checkboxes should be updated in the orchestrator's update-roadmap step.

---

### Human Verification Required

None required for Phase 39. Per phase context: live UAT is Phase 43. The bar for Phase 39 is automated test coverage + grep-verifiable source state, both of which pass.

---

### Gaps Summary

No gaps. All 5 success criteria and all 9 CB-V17 requirement IDs are satisfied:

- All key files exist with substantive implementations (791-line CbConfigForm.tsx, 1238-line spec, fingerprint regression spec)
- All critical wiring paths verified (CbConfigForm → KineticaWmsLayerForm, CbConfigForm → quantileFn, CbConfigForm → probeCardinality, MapChartRenderer fingerprint)
- Phase 38 hard-cutover lock holds (0 legacy field reads/writes)
- All 7 commits confirmed in git log (`6dec8cc`, `5ff72c3`, `b694a82`, `9d8a9d8`, `eadf3ab`, `9ebd1c7`, `ae63444`)
- 1131/1131 frontend test suite GREEN per executor self-check

---

_Verified: 2026-05-21_
_Verifier: Claude (gsd-verifier)_
