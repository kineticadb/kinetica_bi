# Phase 53: Render Narrowing, Param Surfaces, Color & Cutover - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

The Map Layers form reacts fully to Track mode: render modes narrow to Raster + Class Break; a new TRACK STYLE section exposes the track styling params (Phase 52 deleted their old home); irrelevant param groups hide per combo; track colors use the proper color-control idiom; WMS emission regression-locked. "Cutover" is already satisfied (Phase 52 deleted the old model cleanly — CUTOVER-V19-01 as amended just needs the no-error-on-stale-config truth verified). Live walk-through is Phase 54.

</domain>

<decisions>
## Implementation Decisions

### Render-mode narrowing (RENDER-V19-01)
- Under `spatialMode === "track"`, the render-mode picker offers ONLY Raster and Class Break (no heatmap; contour already removed globally in v1.7).
- **Stale-mode coercion: SILENT.** A layer entering Track mode with persisted `renderMode` heatmap (or contour) auto-coerces to `raster` — no toast, no confirm; persists on next save. Matches auto-suggest-wins philosophy.

### Track param surfaces (RENDER-V19-02/03)
- **New TRACK STYLE section** rendered when `spatialMode === "track"` (Phase 52 deleted TrackSubSection — this is its replacement home, but driven by spatial mode, not detection).
- **Param set = the v1.7 set, nothing new:** head color, head size (1-20), head shape (dropdown from POINT_SHAPES), trail color, line width (writes trailSize — keep the v1.7 single-field convention). All persist into the existing `track_config` JSON alongside Phase 52's xCol/yCol/trackIdAttr/trackOrderAttr.
- **Track + Raster:** TRACK STYLE replaces the RASTER PARAMS group entirely — pointColor/pointSize/pointShape/shapeline/shapefill hidden (they don't apply).
- **Track + Class Break:** CB break builder (CbConfigForm) shows + TRACK STYLE shows; per-break advanced point/shape params (the [▸] chevron panels) hidden in track context.
- Heatmap params group never reachable under track (mode not offered).

### Color controls (COLOR-V19-01)
- Track head/trail colors use the EXISTING color-input + alpha idiom from the raster pointColor control (`rgbFromAARRGGBB` / `joinAARRGGBB` / `alphaFromAARRGGBB`, KineticaWmsLayerForm ~728-750) — native `<input type="color">` + alpha control, storing 8-char AARRGGBB. NO new color-picker dependency; no palette swatches (CB palette stays CB-only).

### Cutover (CUTOVER-V19-01 as amended)
- Already materially done in Phase 52 (TrackSubSection deleted; stale track_config ignored harmlessly). This phase: verify-by-spec that a layer row carrying old-shape track_config (enabled but no xCol/yCol) renders without error and simply behaves as an incomplete track config (or whatever mode it has). No overlay, no migration.

### WMS regression locks (RENDER-V19-04)
- The Phase 38/v1.7 emission block (wmsUrlBuilder ~432-470: DOTRACKS + TRACK_* single-value under raster; comma-separated under cb_raster) and its specs (~781-843) remain the contract — this phase may now TOUCH them only where the enabled-gating needs to key off spatial mode (`spatialMode === "track"` && complete config) instead of (or in addition to) `tc.enabled`; preserve emission shapes byte-for-byte per the Phase 37 spike Decision Record. lastEmittedParamsRef fingerprint must continue covering track_config changes (it already serializes {p, c, t}).
- Decide-in-planning: whether emission gates on `tc.enabled` (Phase 52 still writes it) or directly on spatial mode — keep BOTH passing during transition; document the chosen gate.

### Claude's Discretion
- TRACK STYLE section placement/heading style (mirror existing param-group headings: "RASTER PARAMS" precedent → "TRACK STYLE")
- Whether the line-width field gains a clarifying hint ("trail thickness")
- Exact coercion implementation point (onSelectSpatialMode vs render-mode derivation)
- Spec organization

</decisions>

<specifics>
## Specific Ideas

- Operator (milestone questioning, verbatim intent): "With track rendering raster we only need to configure track rendering params and not point, shapefill or shapeline params."
- Session note: the x/y "double precision" type-recognition bug was found during 53 discussion and ALREADY FIXED (`5e3514b`) — not part of this phase's scope, but its regression specs live in columnTypes.spec.ts.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 53 (amended SCs — no overlay)
- `.planning/REQUIREMENTS.md` — RENDER-V19-01..04, COLOR-V19-01, CUTOVER-V19-01 (amended)
- `.planning/phases/52-track-spatial-mode-foundation/52-VERIFICATION.md` — what 52 shipped (incl. the track X_ATTR/Y_ATTR WMS case + follow-up type fix)

### Existing code (read before touching)
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` — render-mode picker (~ALL_RENDER_MODES line 112, allowedRenderModes 206, renderMode 247), param groups (RASTER PARAMS ~728+, pointColor color-idiom ~728-750), Phase 52 track pickers (~621-682), CbConfigForm mount
- `packages/web/src/lib/trackConfig.ts` — TrackConfig (now with xCol/yCol) + TRACK_DEFAULTS (headColor FFFF0000 etc.)
- `packages/web/src/lib/wmsUrlBuilder.ts` — track emission block ~432-470 (Phase 37 spike contract; gate may change, shapes may not), POINT_SHAPES export
- `packages/web/src/components/charts/CbConfigForm.tsx` — per-break advanced chevron panels (to hide under track)
- `packages/web/src/lib/wmsUrlBuilder` specs ~781-843 — emission regression locks (extend, don't weaken)
- v1.7 Phase 37 spike Decision Record (STATE accumulated context / milestones/v1.7-*) — TRACK_* param names + cb_raster comma-sep contract

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Color-input + alpha idiom (rgbFromAARRGGBB/joinAARRGGBB/alphaFromAARRGGBB) — COLOR-V19-01 is reuse
- POINT_SHAPES (12 values) for head-shape dropdown; TRACK_DEFAULTS for initial values
- coalesceTrackConfig single parse path; onPickTrackCol-style track_config merge pattern from Phase 52
- lastEmittedParamsRef already fingerprints track_config

### Established Patterns
- Param-group headings + conditional groups per renderMode (the existing form structure)
- Theme tokens only; green-accent conventions (ui-consistency memory)
- Set-based/frontend-100% gates: 1595/1595 current baseline

### Integration Points
- KineticaWmsLayerForm: mode-narrowed picker, TRACK STYLE section, group visibility conditionals, coercion
- wmsUrlBuilder: emission gate keyed to track mode (shapes byte-preserved)
- CbConfigForm: advanced-panel hiding prop/flag under track context

</code_context>

<deferred>
## Deferred Ideas

- Per-track coloring (TRACK-V20-01), live preview (TRACK-V20-02)
- Palette swatches for track colors (CB-style) — color-input idiom chosen instead
- Live walk-through — Phase 54

</deferred>

---

*Phase: 53-render-narrowing-param-surfaces-color-cutover*
*Context gathered: 2026-06-07*
