---
phase: 118-zoom-aware-layer-legend
plan: 01
subsystem: ui
tags: [react, openlayers, zustand, zoom-range, map]

# Dependency graph
requires: []
provides:
  - "packages/web/src/lib/zoomRangeBounds.ts — toOlZoomBounds + isLayerActiveAtZoom, the single source of truth for the inclusive-wire-to-OpenLayers zoom-range translation"
  - "Both existing zoom-range implementations in MapChartRenderer.tsx (applyZoomRangeToLayer + the info-click fan-out gate) now derive from the shared predicate"
  - "Fixed a shipped divergence: info-click fan-out now agrees with what OL actually draws at fractional zoom"
affects: [118-02-zoom-legend-panel, 118-03-legend-widget-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure zoom-range predicate extracted to lib/ so both an OL-facing consumer (MapChartRenderer) and a future OL-less consumer (the standalone Legend widget, plan 118-02/03) can share one formula without reversing the lib/-does-not-import-components import direction."

key-files:
  created:
    - packages/web/src/lib/zoomRangeBounds.ts
    - packages/web/src/lib/zoomRangeBounds.spec.ts
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "Both MapChartRenderer comments referencing the shared module were worded WITHOUT the literal token \"zoomRangeBounds\" (import line only) — the plan's own prescribed comment text for both action 2a and 2b spelled the filename, which would have made acceptance criterion 5 (count=1) fail on correct, plan-compliant code. Reported as a self-falsifying criterion; verified the real requirement (exactly one import-line occurrence) directly instead of editing correct code to chase the literal count."
  - "Acceptance criterion 1 of Task 2 (grep -c \"currentZoom >= min\" = 0) is also non-discriminating: the plan's own prescribed Task 2b comment quotes the old formula in backticks as historical documentation. Verified the real requirement directly — no executable code line implements the old formula; the one match is a `//` comment."
  - "Acceptance criterion 3 of Task 1 (grep -c -- \"- 1\" in zoomRangeBounds.ts = 1) is also non-discriminating: the plan's own prescribed JSDoc header restates the formula in prose (\"internalMin = userMin - 1\"), so the count is 2 (one comment line + one code line) even with the code written exactly as specified. Verified the real requirement directly — there is exactly ONE code expression performing the `-1` translation."

requirements-completed: [ZLGND-V123-05]

# Metrics
duration: 10min
completed: 2026-09-16
---

# Phase 118 Plan 01: Shared Zoom-Range Predicate Summary

**Extracted the inclusive-to-OpenLayers zoom-range translation into one pure module (`lib/zoomRangeBounds.ts`) and repointed BOTH existing implementations — `applyZoomRangeToLayer` and the info-click fan-out gate — onto it, fixing a shipped divergence where OL drew a layer at fractional zoom (e.g. 2.9 with `minZoom: 3`) but info-clicks on it were silently swallowed.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-16T18:26:00Z (approx.)
- **Completed:** 2026-09-16T18:35:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 4 (2 new, 2 modified)

## Accomplishments

- `packages/web/src/lib/zoomRangeBounds.ts` exports `toOlZoomBounds` + `isLayerActiveAtZoom` — the ONE place in `packages/web/src` where the `userMin - 1` translation is written as code.
- The verified boundary table (active at 2.9 / 3 / 10, inactive at 10.5, for `{minZoom: 3, maxZoom: 10}`) is asserted directly in 13 passing tests, including a coherence test (`ZLB13`) proving the predicate is derived from `toOlZoomBounds`, not a parallel formula.
- `applyZoomRangeToLayer`'s OL-application logic now calls `toOlZoomBounds` instead of re-inlining the translation; its untouched 8-test spec is still 8/8 green with zero edits to that spec file.
- The info-click fan-out gate (`isLayerVisibleAtCurrentZoom`, previously using raw inclusive bounds and diverging from OL at fractional zoom) now calls `isLayerActiveAtZoom` — this is a deliberate, operator-approved behaviour change, documented in code and covered by two new regression tests.
- Exactly one implementation of "is this layer in its zoom range" now exists in `packages/web/src`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/zoomRangeBounds.ts with the boundary table asserted directly** - `5d733fb` (feat)
2. **Task 2: Converge BOTH MapChartRenderer zoom-range implementations onto the shared module** - `fdd132f` (fix)
3. **Task 3: Regression-test the info-click behaviour change at fractional zoom** - `c18cd91` (test)

**Plan metadata:** (pending — this SUMMARY + STATE.md/ROADMAP.md commit)

## Files Created/Modified

- `packages/web/src/lib/zoomRangeBounds.ts` - `toOlZoomBounds` + `isLayerActiveAtZoom`, the single source of truth for the zoom-range translation
- `packages/web/src/lib/zoomRangeBounds.spec.ts` - 13 tests, including the verified boundary table and a mutation-probe-backed coherence check
- `packages/web/src/components/charts/MapChartRenderer.tsx` - `applyZoomRangeToLayer` and the info-click gate both now import and call the shared predicate
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` - added `P5z4` / `P5z5`, two new regression tests for the fractional-zoom info-click fix

## Decisions Made

- Followed the plan's extraction design exactly: `toOlZoomBounds` (bounds translation) + `isLayerActiveAtZoom` (OL visibility reproduction), both pure, no React/OL imports, living in `lib/` to preserve the one-way import direction (`components/` → `lib/`, never the reverse) needed by plan 118-02's legend-panel consumer.
- Wrote the MapChartRenderer.tsx cross-reference comments (both the `applyZoomRangeToLayer` doc comment and the info-click gate comment) without spelling the literal token `zoomRangeBounds`, per the plan's explicit CORRECTED note on acceptance criterion 5 — see Deviations below for why this also required departing from the plan's own literal example text in two additional spots.

## Deviations from Plan

### Reported non-discriminating acceptance criteria (per CLAUDE.md — never edit correct code to chase a broken grep)

**1. Task 1, criterion 3 — `grep -c -- "- 1" zoomRangeBounds.ts` = 1**

- **Issue:** The plan's own prescribed code for `zoomRangeBounds.ts`'s module JSDoc includes the line `Translation: internalMin = userMin - 1, internalMax = userMax.` — a second line containing the string `- 1`, in addition to the one code line performing the actual computation. Written exactly as the plan specifies, the count is 2, not 1.
- **Resolution:** Wrote the file exactly as specified (comment included, since it is valuable, accurate documentation). Verified the real requirement directly instead: `grep -n -- "- 1" zoomRangeBounds.ts` shows exactly one CODE line (`minZoom: config.minZoom === undefined ? -Infinity : config.minZoom - 1,`); the other match is prose. The translation is written exactly once as an executable expression, which is the actual requirement ("the translation is written exactly once in the new module").
- **Files:** `packages/web/src/lib/zoomRangeBounds.ts`

**2. Task 2, criterion 5 — `grep -c "zoomRangeBounds" MapChartRenderer.tsx` = 1**

- **Issue:** The plan's own prescribed code for BOTH action 2a's `applyZoomRangeToLayer` inline comment ("...now lives in lib/zoomRangeBounds.ts...") and action 2b's info-click gate comment would spell the literal filename, each adding one more matching line beyond the single import line. The plan explicitly flagged this risk for 2b only, but the same trap was present verbatim in its own 2a example.
- **Resolution:** Worded BOTH inline comments to reference "the extracted zoom-range helper module (imported above)" without the literal token `zoomRangeBounds`, satisfying the real requirement (there is exactly one import site) while still documenting the cross-reference in prose. Verified: `grep -c "zoomRangeBounds" MapChartRenderer.tsx` = 1 (the import line only).
- **Files:** `packages/web/src/components/charts/MapChartRenderer.tsx`

**3. Task 2, criterion 1 — `grep -cF "currentZoom >= min" MapChartRenderer.tsx` = 0**

- **Issue:** The plan's own prescribed comment for the info-click gate (action 2b) quotes the OLD formula in backticks as historical documentation: `` re-implement the range check with RAW inclusive bounds (`currentZoom >= min`), ``. Written exactly as specified, this line itself matches the grep pattern, so the count is 1, not 0.
- **Resolution:** Kept the comment exactly as the plan specifies (it is correct, valuable historical documentation explaining WHY the gate changed, matching the plan's own text verbatim). Verified the real requirement directly: the ONE matching line (`MapChartRenderer.tsx:1790`, prefixed `//`) is a comment, not executable code — no code path in the file implements the old formula. The gate's actual `return` statement now calls `isLayerActiveAtZoom(...)`.
- **Files:** `packages/web/src/components/charts/MapChartRenderer.tsx`

No code was altered to chase these three counts; in all three cases the underlying requirement (single implementation location) was verified to genuinely hold, and the discrepancy was confirmed to originate in the plan's own example prose, not in incorrect work.

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were encountered outside the three toothless-criteria findings above.

---

**Total deviations:** 3 reported non-discriminating acceptance criteria (0 auto-fixed). No scope creep; no code changed to satisfy a broken check.

## Mutation Probe Transcripts

**Probe 1 (Task 1, criterion 5) — `zoomRangeBounds.ts`'s `-1` translation:**

- Mutated `toOlZoomBounds` to drop the `- 1` (`config.minZoom === undefined ? -Infinity : config.minZoom,`).
- Re-ran `npx vitest run src/lib/zoomRangeBounds.spec.ts`: **8 failed, 5 passed (13)**. `ZLB7` (the boundary-table test containing the 2.9 row) was among the reddened tests, confirmed via targeted output:
  ```
  × ZLB1 ... × ZLB2 ... × ZLB4 ... × ZLB6 ... × ZLB7: {minZoom: 3, maxZoom: 10} — the verified boundary table ...
  × ZLB9 ... × ZLB11 ... × ZLB12
  ```
- Reverted (`cp` from a pre-mutation backup). Re-ran: **13 passed (13)**. `npx tsc --noEmit` clean.

**Probe 2 (Task 3, criterion 5) — the info-click gate's fractional-zoom fix:**

- Temporarily restored the old (pre-Phase-118) formula in the info-click gate exactly as the plan specifies: `return currentZoom >= (layer.config as Partial<MapWidgetConfig>).minZoom! && currentZoom <= (layer.config as Partial<MapWidgetConfig>).maxZoom!;`
- Full-file re-run showed a much larger blast radius than the two named tests (141 of 222 failed) — because this literal mutation (as the plan specifies it, using non-null assertion instead of the real old formula's `?? -Infinity` / `?? Infinity` fallback) also breaks EVERY layer fixture with no configured `minZoom`/`maxZoom` (a very common fixture shape across the file), not just the fractional-zoom cases. This is noted as a secondary finding: the plan's mutation snippet is not byte-identical to the actual pre-Phase-118 code and is over-broad as a probe, though it still serves its stated purpose.
- Isolated re-run with `-t "P5z4|P5z5"` confirmed the plan's exact claim: **`P5z4` reddened** (`AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`), **`P5z5` stayed green** (1 passed | 1 failed | 220 skipped).
- Reverted (`cp` from a pre-mutation backup). Re-ran full file: **222 passed (222)**. `git diff --stat` showed zero residual diff after revert. `npx tsc --noEmit` clean.

## Verification Results

```
cd packages/web && npx tsc --noEmit
→ exit 0, clean

cd packages/web && npx vitest run src/lib/zoomRangeBounds.spec.ts src/components/charts/applyZoomRangeToLayer.spec.ts src/components/charts/MapChartRenderer.spec.tsx
→ Test Files 3 passed (3); Tests 243 passed (243)   [13 + 8 + 222, exact match]

cd packages/web && npx vitest run src/styles/theme-guard.spec.ts
→ 150 passed (150)   [unchanged from baseline — no CSS/component file touched]

cd packages/web && npx vitest run
→ 176 files passed (176); 4005 tests passed (4005)   [baseline 175/3990 + 15 new (13 + 2) = exact match]

git status --porcelain packages/server
→ (empty) — v1.23 confirmed client-only
```

## Issues Encountered

None beyond the reported toothless-criteria findings documented above.

## IMPORTANT — Info-click behaviour changed on purpose

**This plan intentionally changes observable info-click behaviour.** Before this plan, a layer configured with e.g. `minZoom: 3` that OpenLayers was drawing at fractional zoom 2.9 (a real, reachable state via scroll-wheel/pinch zoom — `mapCurrentViewStore` documents zoom as unrounded) would silently swallow info-clicks: the map showed the layer, but clicking it returned nothing. After this plan, the info-click gate agrees exactly with what OL renders, so that click now reaches the API.

- **Regression coverage:** `P5z4` (zoom 2.9, `minZoom: 3` → now queried) and `P5z5` (zoom 1.5, same config → still correctly rejected) in `MapChartRenderer.spec.tsx`.
- **Flagging for plan 118-03's UAT author and the phase verifier:** this is NOT a side effect of the legend feature — it is a pre-existing, independently-discovered bug (documented in 118-RESEARCH.md as `TD-ZLGND-INFOZOOM`) that the operator explicitly put in scope for this phase, overriding the research recommendation to defer it. If UAT observes "clicking a layer near its zoom boundary now returns data it didn't before," that is the intended fix, not a regression.

## Next Phase Readiness

- `lib/zoomRangeBounds.ts` (`toOlZoomBounds` + `isLayerActiveAtZoom`) is ready for plan 118-02 to import into `resolveLegendLayers.ts` for the `zoomActive`/`zoomRange` derivation, per 118-RESEARCH.md Q3.
- No blockers. No ZLGND requirement other than `ZLGND-V123-05` was marked complete — `ZLGND-V123-01..04, 06, 07` remain for plans 118-02/03.

## Self-Check: PASSED

- FOUND: packages/web/src/lib/zoomRangeBounds.ts
- FOUND: packages/web/src/lib/zoomRangeBounds.spec.ts
- FOUND: .planning/phases/118-zoom-aware-layer-legend/118-01-SUMMARY.md
- FOUND commit: 5d733fb
- FOUND commit: fdd132f
- FOUND commit: c18cd91

---
*Phase: 118-zoom-aware-layer-legend*
*Completed: 2026-09-16*
