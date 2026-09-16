---
phase: 118-zoom-aware-layer-legend
plan: 02
subsystem: ui
tags: [react, resolveLegendLayers, LayersLegendPanel, zoom-range, css-tokens]

# Dependency graph
requires:
  - phase: 118-01
    provides: "lib/zoomRangeBounds.ts (isLayerActiveAtZoom) — the single source of truth for the zoom-range comparison, consumed here without re-derivation"
provides:
  - "resolveLegendLayers(storeLayers, includedLayerIds, zoom?) — optional 3rd param; ResolvedLegendLayer gains zoomRange?/zoomActive? (genuinely three-state)"
  - "LayersLegendPanel renders a third, distinct zoom-inactive visual state (mutually exclusive with hidden/stale by JS precedence) plus a reused mode-chip showing the configured zoom range"
  - "global.css .layers-legend-panel-layer-block--zoom-inactive rules, token-only (opacity 0.65 + border-left var(--warning))"
affects: [118-03-legend-widget-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Precedence for mutually-exclusive per-row visual states computed once in JS (showZoomInactive = visible && !stale && zoomActive === false) rather than left to CSS cascade/source order, to make 'must not look the same as X' true by construction."
    - "Three-state optional field (undefined/true/false) used to distinguish 'unknown' from 'known-false' so a not-yet-mounted consumer degrades to today's behavior instead of rendering confidently wrong state."

key-files:
  created: []
  modified:
    - packages/web/src/lib/resolveLegendLayers.ts
    - packages/web/src/lib/resolveLegendLayers.spec.ts
    - packages/web/src/components/LayersLegendPanel.tsx
    - packages/web/src/components/LayersLegendPanel.spec.tsx
    - packages/web/src/styles/global.css

key-decisions:
  - "Task 3 acceptance criterion 5 (`grep -c \"layers-legend-panel-layer-block--zoom-inactive\" global.css` = 2) is non-discriminating: the plan's own prescribed CSS block (written verbatim) has a 2-line multi-selector on the opacity rule, so the class name appears on 3 lines even though there are only 2 CSS rule blocks. grep -c counts LINES, not occurrences — the exact pitfall CLAUDE.md documents. Verified the real requirement directly (exactly 2 declaration blocks reference the modifier class, matching D1's two rules) instead of reformatting correct, plan-prescribed CSS to force a line count of 2."
  - "Followed D1-D4 exactly as locked in the plan: precedence computed in JS (not CSS cascade), chip shown whenever zoomActive !== undefined (not gated on active/inactive), chip copy uses inclusive ≥/≤ (not breakDisplayText's exclusive <), and the chip reuses the existing dead .layers-legend-panel-mode-chip class rather than inventing a new one."

requirements-completed: []  # Deliberately empty — critical warning #8 / plan 118-03 owns ZLGND closure after operator UAT. No requirement flipped in this plan.

# Metrics
duration: 12min
completed: 2026-09-16
---

# Phase 118 Plan 02: Zoom-Inactive Legend Rendering Summary

**Threaded an optional live zoom through `resolveLegendLayers` (three-state `zoomActive`/raw `zoomRange`, delegating the comparison to `lib/zoomRangeBounds`) and rendered it in `LayersLegendPanel` as a third, JS-precedence-driven visual state distinct from eye-off and dv-stale, plus a reused mode-chip showing the configured range (`zoom 3–10` / `zoom ≥ 3` / `zoom ≤ 10`) — with zero new markup for the ~all-layers-today case of no configured range or unknown zoom.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-16T18:39:22Z (approx, first baseline test run)
- **Completed:** 2026-09-16T18:47:52Z (approx)
- **Tasks:** 3
- **Files modified:** 5 (0 new)

## Accomplishments

- `resolveLegendLayers` accepts an optional `zoom` 3rd parameter; both existing 2-arg call sites (`MapChartRenderer.tsx`, `LegendRenderer.tsx`) still compile untouched (optional param).
- `ResolvedLegendLayer` gains `zoomRange?` (raw wire values, not translated OL bounds) and `zoomActive?` (genuinely three-state — `undefined` covers BOTH "no range configured" and "zoom unavailable", never coerced to `false`).
- `resolveLegendLayers.spec.ts` grew from 10 to 17 tests (Test 11–17), including the fractional-boundary case (2.9), the `maxZoom: 0` real-bound-not-falsy-absent case, and confirmation that `visible`/filtering are unaffected by the new param.
- `LayersLegendPanel` renders `--zoom-inactive` only when eye-on AND non-stale AND known-inactive (`showZoomInactive`, computed once in JS, never left to CSS source order) — mutually exclusive with `.hidden` and `--stale` by construction.
- The reused (previously dead) `.layers-legend-panel-mode-chip` now renders the configured range whenever the zoom is known, independent of active/inactive, with locked copy (`zoom 3–10` / `zoom ≥ 3` / `zoom ≤ 10`, en dash U+2013).
- `LayersLegendPanel.spec.tsx` grew from 34 to 41 tests (ZLP1–ZLP7); the six pre-existing `.layers-legend-panel-mode-chip` null assertions (verified precondition: 0 occurrences of `minZoom`/`maxZoom` in that spec file before this plan) remain green.
- `global.css` gains two token-only CSS rule blocks for `--zoom-inactive` (`opacity: 0.65`, numerically distinct from `.hidden`'s `0.45` and `--stale`'s `0.55`; `border-left: 2px solid var(--warning)` as a colour cue) — manual hex + rgba audits both returned 0.
- A layer with no configured range, or a configured range with unknown zoom, produces byte-identical markup to before this plan (ZLGND-V123-06/07).

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread optional zoom through resolveLegendLayers as a three-state field** - `ebf9b07` (feat)
2. **Task 2: Render the zoom-inactive state and the range chip in LayersLegendPanel** - `f0ed24c` (feat)
3. **Task 3: Add the token-only zoom-inactive CSS and audit it for hex by hand** - `2a114dc` (chore)

**Plan metadata:** (pending — this SUMMARY + STATE.md/ROADMAP.md commit)

## Files Created/Modified

- `packages/web/src/lib/resolveLegendLayers.ts` - optional 3rd `zoom` param; `zoomRange`/`zoomActive` derivation via `isLayerActiveAtZoom`
- `packages/web/src/lib/resolveLegendLayers.spec.ts` - Test 11–17 (17/17 total)
- `packages/web/src/components/LayersLegendPanel.tsx` - `zoomRangeChipText` helper, `showZoomInactive`/`showZoomRangeChip` precedence, className + chip markup, updated file header doc block
- `packages/web/src/components/LayersLegendPanel.spec.tsx` - ZLP1–ZLP7 (41/41 total)
- `packages/web/src/styles/global.css` - `.layers-legend-panel-layer-block--zoom-inactive` rules (2 blocks, token-only) + updated `.layers-legend-panel-mode-chip` doc comment

## Decisions Made

- Followed the plan's locked decisions D1 (JS-computed mutual exclusion, precedence `hidden > stale > zoom-inactive`), D2 (chip gated on `zoomActive !== undefined`, not on active/inactive), D3 (locked inclusive-bound copy: `zoom 3–10` / `zoom ≥ 3` / `zoom ≤ 10`), and D4 (reuse `.layers-legend-panel-mode-chip` verbatim, no new class) exactly as written.
- See key-decisions above for the one non-discriminating acceptance criterion reported and resolved by verifying the real requirement directly.

## Deviations from Plan

### Reported non-discriminating acceptance criteria (per CLAUDE.md — never edit correct code to chase a broken grep)

**1. Task 3, criterion 5 — `grep -c "layers-legend-panel-layer-block--zoom-inactive" global.css` = 2**

- **Issue:** The plan's own prescribed CSS (copied verbatim) is:
  ```css
  .layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-layer-name,
  .layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-break-row {
    opacity: 0.65;
  }
  .layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-layer {
    border-left: 2px solid var(--warning);
  }
  ```
  This is 2 CSS rule blocks ("two selectors" per the plan's prose), but the first rule's selector list spans 2 lines, so the class name appears on 3 separate lines total. `grep -c` counts matching LINES, not string occurrences, so the count is 3, not 2, even written exactly as the plan specifies.
- **Resolution:** Wrote the CSS exactly as the plan prescribes (it is correct and matches D1's two-rule intent). Verified the real requirement directly: `awk` count of `{` blocks following a match confirms exactly 2 CSS rule blocks reference `--zoom-inactive`, matching the two rules the plan describes. No CSS was reformatted (e.g. squeezed onto one line) to force a false-precision line count.
- **Files:** `packages/web/src/styles/global.css`

No code was altered to chase this count; the underlying requirement (exactly two CSS rules gated on the new modifier class, one dimming opacity and one adding the colour cue) was verified to genuinely hold.

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were encountered outside the one toothless-criterion finding above.

---

**Total deviations:** 1 reported non-discriminating acceptance criterion (0 auto-fixed). No scope creep; no code changed to satisfy a broken check.

## Mutation Probe Transcripts

**Probe 1 (Task 1, criterion 6) — `resolveLegendLayers`'s three-state `zoomActive` contract:**

- Mutated the `zoomActive` ternary's fallback from `: undefined` to `: false`.
- Re-ran `npx vitest run src/lib/resolveLegendLayers.spec.ts`: **2 failed, 15 passed (17)**.
  ```
  FAIL  Test 11: layer with NO minZoom/maxZoom + zoom 5 → zoomRange and zoomActive both undefined (ZLGND-V123-07)
    AssertionError: expected false to be undefined
  FAIL  Test 14: same layer + zoom argument omitted → zoomRange defined but zoomActive is undefined, NEVER false (ZLGND-V123-06)
    AssertionError: expected false to be undefined
  ```
  Test 14 (the plan's named test) reddened as required. Test 11 also reddened because it hits the same shared `else` branch (no range at all) — both are legitimate hits on the three-state contract, not a spurious failure.
- Reverted. Re-ran: **17 passed (17)**. `npx tsc --noEmit` clean.

**Probe 2 (Task 2, criterion 7) — `LayersLegendPanel`'s precedence guards:**

- Mutated `showZoomInactive` from `visible && !stale && zoomActive === false` to `zoomActive === false` (dropping the guards).
- Re-ran `npx vitest run src/components/LayersLegendPanel.spec.tsx`: **2 failed, 39 passed (41)**.
  ```
  FAIL  ZLP3: eye-off AND zoom-inactive → carries hidden, does NOT carry --zoom-inactive (D1 mutual exclusion)
    Received: "layers-legend-panel-layer-block hidden layers-legend-panel-layer-block--zoom-inactive"
  FAIL  ZLP4: dv-stale AND zoom-inactive → carries --stale, does NOT carry --zoom-inactive
    Received: "layers-legend-panel-layer-block layers-legend-panel-layer-block--stale layers-legend-panel-layer-block--zoom-inactive"
  ```
  Both named tests (ZLP3 and ZLP4) reddened exactly as required.
- Reverted. Re-ran: **41 passed (41)**. `npx tsc --noEmit` clean.

## Manual global.css Hex + RGBA Audit (load-bearing — theme-guard cannot see this)

```
$ git diff -U0 -- packages/web/src/styles/global.css | grep -E "^\+" | grep -cE "#[0-9a-fA-F]{3,8}\b"
0

$ git diff -U0 -- packages/web/src/styles/global.css | grep -E "^\+" | grep -cE "rgba?\("
0
```

Both return 0. `var(--warning)` usage went from 1 to 2 occurrences (confirmed); the two new `.layers-legend-panel-layer-block--zoom-inactive` rules use only `opacity: 0.65` and `var(--warning)` — no raw colour literal anywhere.

## Verification Results

```
cd packages/web && npx tsc --noEmit
→ exit 0, clean

cd packages/web && npx vitest run src/lib/resolveLegendLayers.spec.ts src/components/LayersLegendPanel.spec.tsx src/styles/theme-guard.spec.ts
→ Test Files 3 passed (3); Tests 208 passed (208)   [17 + 41 + 150, exact match; baseline was 194]

cd packages/web && npx vitest run src/lib/zoomRangeBounds.spec.ts src/components/charts/applyZoomRangeToLayer.spec.ts
→ Test Files 2 passed (2); Tests 21 passed (21)   [13 + 8, plan 118-01's work unregressed]

cd packages/web && npx vitest run
→ 176 files passed (176); 4019 tests passed (4019)   [baseline 176/4005 + 14 new (7+7) = exact match]

git status --porcelain packages/server
→ (empty)
```

## Exact Chip Copy Strings (for 118-03's UAT script)

- Both bounds configured (`{minZoom:3, maxZoom:10}`): `zoom 3–10` (en dash, no spaces around the dash)
- `minZoom` only (`{minZoom:3}`): `zoom ≥ 3`
- `maxZoom` only (`{maxZoom:10}`): `zoom ≤ 10`
- Chip `title` attribute: `"Drawing at the current zoom"` when active; `"Not drawing — zoom into this range to show this layer"` when inactive.

## Issues Encountered

None beyond the reported toothless-criterion finding documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `resolveLegendLayers` and `LayersLegendPanel` are both ready for plan 118-03 to wire a live `zoom` prop through from the map (or leave it `undefined` for the standalone Legend widget) — no further changes needed to either file's public surface for that wiring.
- No blockers. Per critical warning #8 / plan 118-03's ownership of ZLGND closure, **no ZLGND requirement was marked complete in this plan** — `ZLGND-V123-01, -02, -03, -06, -07` all remain open for plan 118-03's UAT-gated closure.
- The exact chip copy strings above are ready to be quoted verbatim in 118-03's UAT script.

## Self-Check: PASSED

- FOUND: packages/web/src/lib/resolveLegendLayers.ts
- FOUND: packages/web/src/lib/resolveLegendLayers.spec.ts
- FOUND: packages/web/src/components/LayersLegendPanel.tsx
- FOUND: packages/web/src/components/LayersLegendPanel.spec.tsx
- FOUND: packages/web/src/styles/global.css
- FOUND commit: ebf9b07
- FOUND commit: f0ed24c
- FOUND commit: 2a114dc

---
*Phase: 118-zoom-aware-layer-legend*
*Completed: 2026-09-16*
