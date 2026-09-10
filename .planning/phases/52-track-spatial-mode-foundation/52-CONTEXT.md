# Phase 52: Track Spatial Mode Foundation - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Track becomes a first-class spatial mode in the Map Layers form: selectable in the mode picker, auto-suggested on column-shape match, with typed column pickers (x/y/track ID/ordering) and sensible defaults. The v1.7 TrackSubSection + override-checkbox model is REMOVED. Track layers remain spatial-filter and info-popup capable via their x/y. Render-mode narrowing, param surfaces, color picker, and WMS emission locks are Phase 53.

</domain>

<decisions>
## Implementation Decisions

### Track as a spatial mode
- "track" joins the LAYER-side spatial mode choices (picker shows lat/lon, WKT, WKB, Track).
- **Architecture boundary (Claude-locked from blast-radius scout):** the SHARED `SpatialMode = "latlon" | "wkt" | "wkb"` unions in `spatialTargets.ts`, server `spatialWhereClause.ts`, and server `spatialQuery.ts` stay UNTOUCHED — they are byte-parity wire contracts. Track is a layer-form concern; at the spatial-target and info-query boundaries a track layer TRANSLATES to the latlon path (lonCol=xCol, latCol=yCol). Whether the layer-side union extends `columnTypes.ts`'s SpatialMode or a new LayerSpatialMode type wraps it is planner/executor discretion — but zero server type changes.

### Column pickers (typed)
- Selecting Track reveals four pickers: **x** (numeric columns only), **y** (numeric only), **track ID** (any non-geometry column — string or numeric IDs both legitimate), **ordering** (timestamp/datetime/numeric columns).
- Defaults when present (case-insensitive): track ID → `TRACKID`; ordering → `TIMESTAMP`. x/y reuse the existing latlon lon/lat auto-suggest heuristics where sensible.
- Missing defaults → picker starts EMPTY; the layer form is invalid (existing isValid signaling) until all four are chosen.
- Table change re-runs auto-suggest and clears stale selections (existing Phase 28 lock: suggested mode always wins on table change).

### Auto-suggest
- `autoSuggestSpatialMode`-family logic extends: a table matching the track shape (TRACKID + x + y + TIMESTAMP, case-insensitive — reuse `lib/trackDetect.ts` `isTrackTable`) suggests Track mode for NEW layers / table changes. User can freely switch modes; no re-prompting on existing layers.

### Spatial filtering + info popup (track layers stay first-class explorable)
- **Draw-to-filter:** track layers ARE eligible spatial-filter targets — `isSpatialTargetEligible` (and the target auto-suggest) treat a complete track config as eligible, emitting `{ spatialMode: "latlon", lonCol: <xCol>, latCol: <yCol> }` over the wire. Server untouched.
- **Info popup:** track layers participate in the click fan-out via the latlon query path using x/y. Server untouched.
- Both preserve the v1.7-era capability (track tables configured as latlon were filterable/interrogable) — REVERSES the roadmap's original "not eligible" SC; ROADMAP.md already amended.

### Old model removal (NO cutover ceremony)
- Operator confirmed: **nobody uses track rendering yet.** Delete `TrackSubSection` + the override checkbox + their host-form gate outright; stale `track_config` on any layer row is ignored without error (the column stays in the DB schema — harmless). NO reconfigure overlay, NO migration. (CUTOVER-V19-01 amended accordingly; the overlay work is gone from Phase 53 too.)
- Keep `lib/trackConfig.ts` only if Phase 53's track params reuse its types/defaults; otherwise fold into the new model. Planner's call.

### Claude's Discretion
- Layer-side type shape (extend columnTypes SpatialMode vs LayerSpatialMode wrapper) — as long as wire contracts stay 3-mode
- Where the four track columns persist in the layer row (likely the existing per-mode column fields + track_config or new fields — pick what round-trips cleanly through the PATCH route; server DashboardLayer type may need additive fields)
- Picker ordering/labels in the form; validation message wording
- Spec organization (KineticaWmsLayerForm.spec extension vs new file)

</decisions>

<specifics>
## Specific Ideas

- Operator's framing (verbatim intent): "Track rendering should first be a selectable spatial mode. If they select Track then the app provides the user with options to select the x, y, TRACKID column (default to TRACKID if table has it), ordering column (default to TIMESTAMP if table has it)."
- The mode picker IS the choice — no auto-detect checkbox ceremony.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 52 (success criteria as AMENDED 2026-06-07 — track IS filter/popup capable)
- `.planning/REQUIREMENTS.md` — TRACKMODE-V19-01..04 (+ CUTOVER-V19-01 as amended)

### v1.7 track model being replaced
- `.planning/milestones/v1.7-ROADMAP.md` § Phase 40 — what TrackSubSection does today
- `.planning/milestones/v1.8-phases/` n/a; the Phase 37 spike Decision Record lives in `.planning/milestones/v1.7-phases-...` / STATE accumulated context — TRACK_* WMS params (Phase 53 consumes; Phase 52 only needs the column model)

### Existing code (read before touching)
- `packages/web/src/lib/columnTypes.ts` — SpatialMode union + autoSuggestSpatialMode + column-type inference (typed-picker source)
- `packages/web/src/lib/spatialTargets.ts` — SpatialTarget wire type + isSpatialTargetEligible (the 3-gate eligibility lock from v1.5) — track translation lands here
- `packages/web/src/lib/trackDetect.ts` (server has its own) — wait: isTrackTable lives at `packages/server/src/lib/trackDetect.ts`; check for a client copy or port the predicate
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` — mode picker, per-mode column pickers, TrackSubSection mount gate (~line 917 per v1.7 notes), isValid signaling
- `packages/web/src/components/charts/TrackSubSection.tsx` — DELETE target
- `packages/web/src/components/charts/MapConfigPanel.tsx` — spatial-target section (eligibility consumer)
- `packages/web/src/components/charts/MapChartRenderer.tsx` — info-popup fan-out (spatialMode per layer)
- `packages/server/src/index.ts` info-query + filter/materialize handlers — confirm they receive latlon-translated payloads unchanged (NO server edits expected)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isTrackTable(columns)` predicate (server lib; port/mirror client-side for auto-suggest)
- Existing per-mode column-picker UI patterns in KineticaWmsLayerForm (latlon lon/lat pickers)
- isSpatialTargetEligible single-source-of-truth pattern (v1.5 3-gate lock) — extend, don't fork

### Established Patterns
- Auto-suggest-on-table-change always wins (Phase 28 lock)
- Byte-parity wire contracts between client/server libs — do NOT widen server SpatialMode
- Hide-don't-disable; theme tokens only (see ui-consistency memory)

### Integration Points
- KineticaWmsLayerForm mode picker + column pickers
- spatialTargets eligibility + MapConfigPanel target section + MapChartRenderer popup path (latlon translation)
- Server DashboardLayer row: where track columns persist (additive fields ok; PATCH route round-trip)

</code_context>

<deferred>
## Deferred Ideas

- Per-track coloring (TRACK-V20-01), track live preview (TRACK-V20-02) — future
- Render-mode narrowing, param surfaces, color picker, WMS regression locks — Phase 53 (not this phase)
- Reconfigure overlay — permanently descoped (zero usage)

</deferred>

---

*Phase: 52-track-spatial-mode-foundation*
*Context gathered: 2026-06-07*
