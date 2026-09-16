---
phase: 118-zoom-aware-layer-legend
plan: 03
subsystem: ui
tags: [react, zustand, openlayers, zoom-range, map, legend]

# Dependency graph
requires:
  - phase: 118-01
    provides: "lib/zoomRangeBounds.ts (isLayerActiveAtZoom) — the shared zoom-range predicate consumed by resolveLegendLayers"
  - phase: 118-02
    provides: "resolveLegendLayers's optional zoom param + LayersLegendPanel's --zoom-inactive rendering and mode-chip — this plan wires the live value in"
provides:
  - "MapChartRenderer's in-map legend reads its own widget's live zoom from mapCurrentViewStore (currentZoomForLegend), reactively threaded into resolveLegendLayers and the memo deps"
  - "LegendRenderer's standalone widget reads its bound map's live zoom by sourceMapWidgetId, degrading through the same 'unknown' path as no-range-configured when that map is not mounted (never the orphan UI)"
  - "Operator UAT (118-UAT.md): all 8 checks PASS, closing all 7 ZLGND-V123 requirements"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primitive number|undefined zustand selectors keyed by widget id, mirroring MapConfigPanel.tsx's scoped-selector precedent — never a whole-object selector, never an imperative mapRef read for a value that must trigger a re-render."
    - "Unknown zoom is threaded through unchanged (never coerced with ?? 0 / ?? false) so 'zoom unavailable' degrades through the exact same three-state path as 'no range configured' — proven by a coercion mutation probe."

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/components/charts/LegendRenderer.tsx
    - packages/web/src/components/charts/LegendRenderer.spec.tsx
    - .planning/phases/118-zoom-aware-layer-legend/118-UAT.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "This plan closes ZLGND-V123-05 even though it is not in this plan's own `requirements` frontmatter list (only 118-01's predicate work is). ZLGND-V123-05's completion was flipped once prematurely after 118-01 (code + tests, no consuming UI yet) and explicitly reverted (commit ddd9cb5) because this project's convention is Complete = code + tests + operator UAT. The operator's 2026-09-16 UAT is the first point all three are true for -05, so it closes here alongside the other six, not in 118-01."
  - "All ZLGND-V123 requirements are closed together, on this plan, because the phase's own locked convention (see REQUIREMENTS.md and 118-01/118-02 SUMMARY 'Next Phase Readiness' notes) is that no ZLGND requirement is Complete without the operator's blocking UAT — code-complete is not requirement-complete on this phase."

requirements-completed: [ZLGND-V123-01, ZLGND-V123-02, ZLGND-V123-03, ZLGND-V123-04, ZLGND-V123-05, ZLGND-V123-06, ZLGND-V123-07]

# Metrics
duration: 12min (Tasks 1-2) + operator UAT turnaround
completed: 2026-09-16
---

# Phase 118 Plan 03: Live-Zoom Wiring + Operator UAT Summary

**Wired both legend consumers (in-map panel and standalone Legend widget) to `mapCurrentViewStore`'s live fractional zoom via primitive reactive selectors, then closed all 7 ZLGND-V123 requirements on an 8/8-PASS operator UAT covering both themes, live zoom tracking, and a deliberate info-click behaviour fix.**

## Performance

- **Duration:** ~12 min for Tasks 1-2 (automated wiring); Task 3 was a blocking operator checkpoint
- **Started:** 2026-09-16T18:50:00Z (approx.)
- **Completed:** 2026-09-16 (operator UAT approved)
- **Tasks:** 3 (2 auto, 1 checkpoint:human-verify)
- **Files modified:** 6 (2 code + 2 spec, 1 UAT record, 1 requirements doc)

## Accomplishments

- `MapChartRenderer.tsx` gained `currentZoomForLegend` — a reactive `useMapCurrentViewStore((s) => s.views[widget.id]?.zoom)` selector threaded into `resolveLegendLayers`'s 3rd argument and the memo's dependency array. The in-map legend's zoom-activity now recomputes on every `moveend`, not just at mount.
- `LegendRenderer.tsx` gained `currentZoom` — the same pattern keyed by `sourceMapWidgetId`, passed through **unchanged** (never coerced) so "bound map not mounted" degrades through the identical path as "no range configured": no chip, no dimming, and explicitly NOT the orphan UI (the binding is still valid; only the live zoom is missing).
- `MapChartRenderer.spec.tsx`: `ZLM1` (live update, not a mount-time snapshot) + `ZLM2` (structural: no `getView().getZoom()` inside the memo body) — spec grew 222 → **224/224**.
- `LegendRenderer.spec.tsx`: `ZLR1`/`ZLR1b` (bound map mounted, both sides of the fractional boundary) + `ZLR2` (bound map not mounted → `zoomActive: undefined`, never `false`) + `ZLR3` (unmounted case renders the mocked panel, not the orphan UI) — spec grew 12 → **16/16**, with its first-ever `mapCurrentViewStore` mock.
- Operator UAT (`118-UAT.md`): **8/8 PASS** — `UAT-118-A` through `UAT-118-H`, closing all 7 `ZLGND-V123-*` requirements in `.planning/REQUIREMENTS.md` (checkbox list + traceability table).

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the in-map legend to its own widget's live zoom** - `07172b4` (feat)
2. **Task 2: Wire the standalone Legend widget + prove unavailable-zoom degradation** - `f15f260` (feat)
3. **Task 3: Operator UAT** — checkpoint, no code commit; verdicts recorded in `118-UAT.md` - `c059c04` (docs)

**Plan metadata:** (this SUMMARY + REQUIREMENTS.md/STATE.md/ROADMAP.md commits, below)

## Files Created/Modified

- `packages/web/src/components/charts/MapChartRenderer.tsx` - `currentZoomForLegend` reactive selector; 3rd arg to `resolveLegendLayers`; new memo dep
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` - new describe block "LayersLegendPanel zoom activity (Phase 118 / ZLGND-V123-04)": `ZLM1`, `ZLM2`
- `packages/web/src/components/charts/LegendRenderer.tsx` - `currentZoom` reactive selector (keyed by `sourceMapWidgetId`); 3rd arg to `resolveLegendLayers`; new memo dep
- `packages/web/src/components/charts/LegendRenderer.spec.tsx` - first `mapCurrentViewStore` mock; `ZLR1`, `ZLR1b`, `ZLR2`, `ZLR3`
- `.planning/phases/118-zoom-aware-layer-legend/118-UAT.md` - operator's verbatim 8/8 PASS verdicts recorded
- `.planning/REQUIREMENTS.md` - all 7 `ZLGND-V123-*` flipped Complete (checkbox list + traceability table)

## Decisions Made

- Followed the plan's honesty discipline exactly: `ZLM1` proves the data path end-to-end via an explicit `rerender(...)` after `fireAllMoveend()` (the spec's store mock has no zustand subscription, so a store write alone does not schedule a re-render in this harness) — it does NOT claim to prove zustand auto-re-renders on write. That claim is covered structurally by `ZLM2` and for real by the operator's `UAT-118-C`.
- `LegendRenderer.tsx`'s unknown-zoom value is passed through with zero coercion (`?? 0` / `?? false` are both absent) — verified both structurally (`grep -cE` = 0) and destructively (the mutation probe below).
- See key-decisions (frontmatter) for why `ZLGND-V123-05` closes on this plan rather than 118-01.

## Deviations from Plan

None — Tasks 1 and 2 executed exactly as written; both mutation probes behaved exactly as the plan predicted (no toothless criteria found in this plan's own text). See "Process Findings" below for phase-level (not this-plan-specific) findings worth carrying forward.

## Mutation Probe Transcripts (full 6-probe rollup across the phase)

**Probe 1 (118-01, Task 1) — `zoomRangeBounds.ts`'s `-1` translation:**
Dropped the `- 1` in `toOlZoomBounds`. Re-ran `zoomRangeBounds.spec.ts`: **8 failed, 5 passed (13)**, including `ZLB7` (the boundary-table test). Reverted: **13/13**, `tsc` clean.

**Probe 2 (118-01, Task 3) — the info-click gate's fractional-zoom fix:**
Restored the old raw-inclusive-bounds formula in the info-click gate. Isolated re-run (`-t "P5z4|P5z5"`) confirmed **`P5z4` reddened** (`expected "vi.fn()" to be called 1 times, but got 0 times`); `P5z5` stayed green. (Full-file re-run showed a larger blast radius — 141/222 failed — because the plan's literal mutation snippet uses non-null assertions instead of the real old formula's `?? -Infinity`/`?? Infinity` fallback, breaking every no-range fixture too; noted as a secondary finding, not a defect in the actual code.) Reverted: **222/222**, `tsc` clean.

**Probe 3 (118-02, Task 1) — `resolveLegendLayers`'s three-state `zoomActive` contract:**
Changed the `zoomActive` fallback from `undefined` to `false`. Re-ran `resolveLegendLayers.spec.ts`: **2 failed, 15 passed (17)** — `Test 14` (the plan's named test, ZLGND-V123-06) and `Test 11` (ZLGND-V123-07, same shared `else` branch) both reddened, both legitimate hits on the three-state contract. Reverted: **17/17**, `tsc` clean.

**Probe 4 (118-02, Task 2) — `LayersLegendPanel`'s mutual-exclusion precedence guards:**
Dropped the `visible && !stale &&` guards from `showZoomInactive`. Re-ran `LayersLegendPanel.spec.tsx`: **2 failed, 39 passed (41)** — `ZLP3` (eye-off + zoom-inactive) and `ZLP4` (dv-stale + zoom-inactive) both reddened, confirming D1's mutual exclusion is real, not incidental. Reverted: **41/41**, `tsc` clean.

**Probe 5 (118-03, Task 1) — the dep-array entry, re-run fresh on the current tree for this SUMMARY:**
Removed `currentZoomForLegend` from the `resolvedLegendLayers` memo's dependency array only (selector + call-site argument left in place). Re-ran `MapChartRenderer.spec.tsx -t "ZLM1|ZLM2"`:
```
FAIL  ZLM1: the panel's zoom-inactive class + range chip follow the live zoom, not a mount-time snapshot
AssertionError: expected 'Layer 1' to contain 'zoom 3–10'
Expected: "zoom 3–10"
Received: "Layer 1"
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 222 skipped (224)
```
Confirms it is the dep-array entry, not merely the argument, that makes the panel update on zoom. Reverted (`cp` from pre-mutation backup): full-file re-run **224/224**, `tsc --noEmit` clean.

**Probe 6 (118-03, Task 2) — the coercion guard, re-run fresh on the current tree for this SUMMARY:**
Changed the selector to `sourceMapWidgetId === undefined ? undefined : (s.views[sourceMapWidgetId]?.zoom ?? 0)`. Re-ran `LegendRenderer.spec.tsx -t "ZLR"`:
```
FAIL  ZLR2: bound map NOT mounted (views is {}, the real unavailable shape) — zoomActive undefined, NOT false
AssertionError: expected false to be undefined
- Expected: undefined
+ Received: false
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed | 12 skipped (16)
```
Confirms the exact "confidently wrong panel" failure mode this requirement exists to prevent — a coerced `0` reports `zoomActive: false` instead of `undefined`. Reverted (`cp` from pre-mutation backup): full-file re-run **16/16**, `tsc --noEmit` clean.

All 6 probes reddened their named test(s) and were cleanly reverted with no residual diff.

## Manual Colour-Audit Transcripts (118-02 — load-bearing, theme-guard cannot see this)

`theme-guard.spec.ts` allowlists `global.css` wholesale from its hex scan (asserts hex IS present for allowlisted files, never that it is absent), so these two manual `git diff` audits are the only check that no raw colour literal was added by this phase's new `--zoom-inactive` CSS:

```
$ git diff -U0 -- packages/web/src/styles/global.css | grep -E "^\+" | grep -cE "#[0-9a-fA-F]{3,8}\b"
0

$ git diff -U0 -- packages/web/src/styles/global.css | grep -E "^\+" | grep -cE "rgba?\("
0
```

Both 0. The two new `.layers-legend-panel-layer-block--zoom-inactive` rules use only `opacity: 0.65` and `var(--warning)` (usage count went 1 → 2). This audit proves nothing was *added*; it cannot prove the tokens chosen are *legible* in both themes — that gap is exactly why `UAT-118-D`/`UAT-118-E` were run as separate, blocking, both-theme checks (see below).

## Full-Suite Gate Results (re-run against the CURRENT tree for this SUMMARY, not reused from Task 3's numbers)

```
$ cd packages/web && npx tsc --noEmit
(exit 0, no output)

$ cd packages/web && npx vitest run
 Test Files  176 passed (176)
      Tests  4025 passed (4025)
[reconciliation: matches the 176/4025 recorded at Task 3's checkpoint — the suite is stable
 (Phase 117 flakiness root-caused and fixed in cde63ae); no drift since the checkpoint was presented.]

$ cd packages/web && npx vitest run src/styles/theme-guard.spec.ts
 Test Files  1 passed (1)
      Tests  150 passed (150)

$ git diff --numstat ea45e78 -- packages/server
(empty)

$ cd packages/web && npx vitest run src/components/charts/MapChartRenderer.spec.tsx
 Test Files  1 passed (1)
      Tests  224 passed (224)

$ cd packages/web && npx vitest run src/components/charts/LegendRenderer.spec.tsx
 Test Files  1 passed (1)
      Tests  16 passed (16)

$ grep -rn "isLayerActiveAtZoom\|toOlZoomBounds" packages/web/src --include='*.ts' --include='*.tsx' | grep -v spec | grep -v "lib/zoomRangeBounds.ts"
packages/web/src/components/charts/MapChartRenderer.tsx:80:import { toOlZoomBounds, isLayerActiveAtZoom } from "../../lib/zoomRangeBounds";
packages/web/src/components/charts/MapChartRenderer.tsx:206:  const { minZoom: nextMinZoom, maxZoom: nextMaxZoom } = toOlZoomBounds(config);
packages/web/src/components/charts/MapChartRenderer.tsx:1808:        return isLayerActiveAtZoom(
packages/web/src/lib/resolveLegendLayers.ts:16:import { isLayerActiveAtZoom } from "./zoomRangeBounds";
packages/web/src/lib/resolveLegendLayers.ts:93:          ? isLayerActiveAtZoom({ minZoom: cfg.minZoom, maxZoom: cfg.maxZoom }, zoom)
[5 lines, 2 distinct production consumer files — no THIRD implementation of the range comparison exists anywhere.]
```

All gates green on the current tree, all totals reconciled against Task 3's checkpoint numbers with zero drift.

## Operator UAT — Verbatim Verdicts (full record in `118-UAT.md`)

**Verdict: APPROVED — all 8 checks PASS, 2026-09-16.** Nothing recorded as not-exercised — every check was runnable and every one was run.

- **UAT-118-A (PASS) — regression canary (ZLGND-V123-07).** L1 (no configured range) renders exactly as before this phase. Highest-visibility risk since most layers in real dashboards have no configured range.
- **UAT-118-B (PASS) — active vs zoom-inactive + range chip (ZLGND-V123-01/03).** At zoom ~8, L2 active / L3 zoom-inactive with correct chips (`zoom 3–10` / `zoom 12–18`).
- **UAT-118-C (PASS) — live update, no reload, no re-open (ZLGND-V123-04).** L2/L3 swapped states while scroll-zooming, no reload/re-open, smooth on `moveend`.
- **UAT-118-D (PASS) — zoom-inactive vs eye-off, DARK theme (ZLGND-V123-02).** L2/L3/L4 read as three distinct things; left rule and chip text legible.
- **UAT-118-E (PASS) — SAME CHECK, LIGHT theme.** Verified separately, not assumed from D — this exact allowlisted-`global.css` blind spot is what shipped Phase 114's `.onboarding-banner` light-mode defect. Held.
- **UAT-118-F (PASS) — standalone Legend widget (ZLGND-V123-06).** Matches in-map panel while bound map is mounted; falls back to plain appearance (no chips, no fading) and does NOT show the orphan UI when the bound map is absent.
- **UAT-118-G (PASS) — deliberate info-click fix.** A visibly-drawn layer at fractional zoom 2.9 (just below `minZoom: 3`) now returns records; the gate still correctly rejects at zoom 1.5 where the layer isn't drawn. Operator-approved behaviour change.
- **UAT-118-H (PASS) — the operator's original complaint.** "Which layer is responsible for what I'm looking at?" is now answerable at a glance. The faded-not-removed reading of "should be clear" matches what was wanted; no preference change raised.

## Process Findings (phase-level, worth carrying forward)

1. **A pre-existing SHIPPED bug was found, put in scope, and fixed.** `isLayerVisibleAtCurrentZoom` (the info-click fan-out gate) used raw inclusive bounds and diverged from what OpenLayers actually draws at fractional zoom — a layer visibly drawn at zoom 2.9 (`minZoom: 3`) silently swallowed info-clicks. This was discovered by 118-RESEARCH.md, documented as `TD-ZLGND-INFOZOOM`, and the operator explicitly put it in scope for this phase rather than deferring it. There is now exactly ONE zoom predicate (`lib/zoomRangeBounds.ts`) consumed by both the OL-application path and the info-click gate — confirmed by the "no third implementation" grep above.
2. **Self-falsifying acceptance criteria: a recurring planner-side defect, not executor error.** Across this phase's three plans, at least 3 non-discriminating grep criteria were caught and corrected *before* execution (embedded as "CORRECTED before execution" notes directly in plan text — e.g. 118-03 Task 1's criterion 2 and Task 2's criterion 6), and at least 4 more were found and reported *during* execution (3 in 118-01, 1 in 118-02 — see those SUMMARYs' "Reported non-discriminating acceptance criteria" sections). None were satisfied by editing correct code to chase a broken count; in every case the real requirement was verified directly, per CLAUDE.md's "Writing verifiable acceptance criteria" rule. The running total of this pattern across Phases 115-118 is approximately 28-32 instances. This plan (118-03) itself introduced zero new instances — both of its mutation probes and all of its grep criteria behaved exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 118 is now Complete (3/3 plans), all 7 `ZLGND-V123-*` requirements Complete, milestone v1.23 requirements fully closed (7/7 mapped to Phase 118).
- No blockers, no open gaps, no deferred items — the operator raised no preference change on `UAT-118-H` (the faded-not-removed reading stands as locked in `118-CONTEXT.md`).
- The self-falsifying-criteria pattern (finding 2 above) is worth addressing at the planning-prompt level in a future milestone, not as a fix within this one.

## Self-Check: PASSED

- FOUND: packages/web/src/components/charts/MapChartRenderer.tsx (currentZoomForLegend present)
- FOUND: packages/web/src/components/charts/LegendRenderer.tsx (currentZoom present)
- FOUND: .planning/phases/118-zoom-aware-layer-legend/118-UAT.md (8/8 PASS recorded)
- FOUND: .planning/phases/118-zoom-aware-layer-legend/118-03-SUMMARY.md
- FOUND commit: 07172b4
- FOUND commit: f15f260
- FOUND commit: c059c04
- FOUND commit: 503cd99

---
*Phase: 118-zoom-aware-layer-legend*
*Completed: 2026-09-16*
