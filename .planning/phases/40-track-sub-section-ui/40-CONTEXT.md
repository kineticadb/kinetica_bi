# Phase 40: Track Sub-Section UI - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-facing form UI for configuring track styling on a map layer. Phase 40 ships:

1. **New `TrackSubSection` sub-component** inside `KineticaWmsLayerForm.tsx` — reads/writes `config.track_config` JSON (Phase 38 schema) via `coalesceTrackConfig` from `wmsUrlBuilder.ts`.
2. **Render-mode gating**: Sub-section renders when `renderMode === "raster" || renderMode === "classbreak"` AND (`isTrackTable(columns)` returns truthy OR operator override checkbox checked). Heatmap + contour exclude the sub-section.
3. **Auto-detect + override checkbox** with three states:
   - `isTrackTable=true` AND no persisted state → auto-enable (checkbox checked, `enabled=true`, sub-section visible)
   - Persisted `track_config.enabled` → wins on load (checkbox state mirrors persisted enabled flag)
   - Override checkbox: always visible; pre-checked + "(auto-detected)" hint when isTrackTable=true; bare label "Treat as track table" otherwise
4. **8 form inputs** in a single-column semantic order: `trackIdAttr` (column dropdown) → `trackOrderAttr` (column dropdown) → `headColor` (AARRGGBB two-control) → `headSize` (number 1–20) → `headShape` (POINT_SHAPES enum dropdown) → `trailColor` (AARRGGBB two-control) → `lineWidth` (number 1–20, writes to `trackConfig.trailSize`).
5. **State preservation locks**: unchecking the override checkbox preserves field values (only flips `enabled=false`); render-mode flip to heatmap silently preserves `track_config`; render-mode flip back restores the visible sub-section with prior values.
6. **Persistence**: form state flows through existing `onChange` chain → `LayersModal` save → `PATCH /api/dashboards/:id/layers/:layerId` (Phase 38 route extension). No new save mechanism.
7. **Re-render trigger**: trust Phase 38's `lastEmittedParamsRef` fingerprint — already serializes `layer.track_config` JSON in `JSON.stringify({ p, c, t })`. No new fingerprint work.

In scope: form UI for track sub-section end-to-end + isTrackTable wiring on column load + override checkbox + persistence round-trip + spec coverage.

Out of scope: `wmsUrlBuilder` Track block (Phase 38 already shipped — single-value under STYLES=raster, comma-sep matching CB_VALS.length under STYLES=cb_raster), `lib/trackDetect.ts` (Phase 38), `track_config` schema migration (Phase 38), `lastEmittedParamsRef` fingerprint extension (Phase 38), live UAT (Phase 43), LayersLegendPanel (Phase 41), standalone Legend widget (Phase 42).

</domain>

<decisions>
## Implementation Decisions

### Auto-detect + override checkbox + enabled flag semantics

Three-state truth table:

| State | `isTrackTable` | persisted `enabled` | initial `enabled` | checkbox UI | sub-section visible |
|-------|----------------|--------------------|--------------------|-------------|---------------------|
| New layer, track-shape table | true | undefined (new) | **true** | checked + "(auto-detected)" hint | yes |
| New layer, non-track table | false | undefined (new) | false | unchecked, no hint | no |
| Saved layer with track enabled | (either) | true | **true** | checked; "(auto-detected)" hint shown only if isTrackTable=true | yes |
| Saved layer with track disabled | true | false | false | unchecked + "(auto-detected)" hint | no |
| Saved layer with track disabled | false | false | false | unchecked, no hint | no |

**Rules:**
- Persisted `enabled` value wins on load (deterministic; operator's prior choice respected).
- Auto-detect kicks in only for new layers (no persisted state) — auto-enables track styling when the table shape matches.
- The "(auto-detected)" hint label is purely informational and never changes the enabled flag; it appears whenever isTrackTable=true regardless of checkbox state.
- Checkbox click flips `enabled` between true ↔ false; the sub-section visibility follows enabled.

### Render-mode gating

Sub-section renders when `renderMode === "raster" || renderMode === "classbreak"` AND `track_config.enabled === true`.

- Heatmap render mode hides the sub-section without changing `track_config.enabled`.
- Contour render mode (hidden from picker since Phase 39) is also excluded.
- Flipping render mode raster ↔ classbreak preserves all sub-section state and visibility verbatim.
- Flipping to heatmap then back to raster/classbreak silently restores the visible sub-section with prior values.

### Uncheck override → preserve field values

When the operator unchecks the "Treat as track table" override:
- `track_config.enabled` flips to `false`.
- All other `track_config` fields (trackIdAttr, trackOrderAttr, headColor, etc.) **preserved verbatim**.
- Re-checking restores the prior config in-place.
- Mirrors v1.4 `info_enabled` kill-switch pattern (per-widget Info kill switch preserved popup template + columns).

### Field layout — single-column semantic order

```
[ ] Treat as track table  [(auto-detected)]

  TRACK INPUTS
  Track ID column        [select column ▾]    (default: TRACKID — auto-seeded if isTrackTable matches)
  Track order column     [select column ▾]    (default: TIMESTAMP — auto-seeded if isTrackTable matches)

  Head color             [🎨][AARRGGBB]       (default: FFFF0000 red)
  Head size              [number ▴▾]          (default: 8, range 1–20)
  Head shape             [shape ▾]            (default: circle)

  Trail color            [🎨][AARRGGBB]       (default: FF0000FF blue)
  Line width             [number ▴▾]          (default: 2, range 1–20)
```

Single column matches existing form section style (raster/heatmap/contour all use single-column groups). Vertical stack.

### Default values when sub-section first activates

When `enabled` flips from false → true (either via auto-detect or override-check), seed the following defaults into `track_config` if the corresponding field is currently undefined:

| Field | Default | Source |
|-------|---------|--------|
| `trackIdAttr` | `isTrackTable.trackIdCol` if matched, else `"TRACKID"` | preserves original column casing from Phase 38 helper |
| `trackOrderAttr` | `isTrackTable.orderCol` if matched, else `"TIMESTAMP"` | same |
| `headColor` | `"FFFF0000"` (red) | matches wmsUrlBuilder's emission default (line 453) |
| `trailColor` | `"FF0000FF"` (blue) | matches wmsUrlBuilder's emission default (line 456) |
| `headSize` | `8` | spike-default; head visibly larger than trail |
| `trailSize` | `2` | trail kept thin so head reads first |
| `headShape` | `"circle"` | safest spike-confirmed default |

Each default is applied **independently per field** — if the operator clears any single field and re-enables (e.g., via uncheck → re-check), only the cleared field re-seeds. Other operator-set values are preserved.

### `trackIdAttr` + `trackOrderAttr` inputs — column-picker dropdowns

Both fields render as `<select className="ds-select">` dropdowns populated from the form's `columns: Column[]` prop — same idiom as raster X_ATTR/Y_ATTR + CB attr picker. Include an empty `<option value="">— select —</option>` placeholder.

Eligibility:
- `trackIdAttr` dropdown shows all non-spatial columns (mirrors CB column-picker eligibility logic; numeric + string types acceptable since TRACKID can be either).
- `trackOrderAttr` dropdown shows all columns (TIMESTAMP is commonly TIMESTAMP type but operators may use any orderable column).

No free-text fallback — the dropdown is the sole input shape; if the columns prop is empty (table not yet loaded), dropdowns are disabled.

### Head shape enum — full POINT_SHAPES (12 values)

`headShape` dropdown exposes the full 12-value `POINT_SHAPES` enum from `wmsUrlBuilder.ts:62-74` for parity with CB POINT_SHAPES UX:

```
none / circle / dash / diamond / dot / hollowcircle / hollowdiamond / hollowsquare / hollowsquarewithplus / pipe / plus / square
```

Default: `circle`.

**Risk acknowledged**: Phase 37 spike only HTTP-tested the smaller set `circle | square | diamond | triangle` (37-SPIKE-NOTES.md OQ-9). The remaining 8 values were not probed under `TRACKMARKERSHAPES`. Risk envelope: HTTP 200 + silent no-render on untested values (Kinetica typically returns HTTP 200 for unknown shape names, rendering a default). Phase 43 UAT precondition: operator visually confirms each shape renders correctly with a real track table.

**No '(none)' special-case in form**: `headShape` always has a value (`circle` default). If operator wants no head marker, they set `headSize=0`. This keeps emission logic simple — wmsUrlBuilder emits `TRACKMARKERSHAPES` whenever `tc.headShape !== undefined`, which is always true after auto-seeding.

### `headShape` field label

Operator-facing label: `Head shape`. Maps internally to `trackConfig.headShape` → wmsUrlBuilder emits as `TRACKMARKERSHAPES` per Kinetica 7.1 docs naming.

### Color picker — two-control AARRGGBB pattern

Both `headColor` and `trailColor` use the existing two-control idiom from raster `pointColor` (KineticaWmsLayerForm.tsx:832-859) + CB row colors:

- `<input type="color">` for RGB picker — drives the lower 6 chars of AARRGGBB; alpha (first 2 chars) is preserved across moves.
- `<input type="text">` for full AARRGGBB hex — accepts 6-char or 8-char input; normalized on blur.
- Uses `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` helpers (Phase 39's same import set).

**Validation**: text input accepts free-text typing; on blur, `normalizeAARRGGBB(value, defaultValue)` pads 6-char to 8-char with `FF` alpha; falls back to the field's default value on invalid input. No live red-border error — matches existing UX silence.

### `trailSize` vs `lineWidth` field surface — single 'Line width' field

The form exposes a SINGLE number input labeled `Line width` writing only to `trackConfig.trailSize`. wmsUrlBuilder emits as `TRACKLINEWIDTHS` (line 462: `tc.trailSize ?? tc.lineWidth`).

- The `lineWidth` field on the TypeScript type is left as a latent compatibility shim — Phase 40 form does not write to it.
- Operators have one obvious control; the alias mechanism in wmsUrlBuilder remains a safety net for any external integration.
- v1.8 cleanup may remove `lineWidth` from `TrackConfig` if no external consumer surfaces.

### Number input ranges + defaults

| Field | Range | Default | Rationale |
|-------|-------|---------|-----------|
| `headSize` | integer 1–20 | 8 | Matches Phase 39 pointSize range cap; head visibly larger than trail by default |
| `trailSize` | integer 1–20 | 2 | Trail kept thin so head reads first |

Both inputs render as `<input type="number" min={1} max={20}>` — the browser clamps invalid input. On blur, additional safety clamp via `Math.max(1, Math.min(20, value))` falls back to the field's default if NaN.

### "Deleting all values" semantics (TRACK-V17-06)

TRACK-V17-06 says "deleting all values clears track_config.enabled to false." Phase 40 interpretation: **the override checkbox is the sole control for enabled**. Field-clearing (e.g., emptying the headColor text input) does NOT auto-disable.

- The phrase "deleting all values" maps to the explicit checkbox uncheck action.
- Individual cleared fields stay as `undefined` in `track_config`; wmsUrlBuilder's emission code already handles undefined fields gracefully (skips that param).
- No "auto-disable when all fields blank" magic.
- No inline "Clear all fields" button (deferred).

### Persistence round-trip

`track_config` flows through the existing form chain:
1. Operator edits inputs → `setTrackConfig(newConfig)` updates local state.
2. Local state writes to `config.track_config = JSON.stringify(newConfig)` via the parent `onChange` prop (existing pattern from CbConfigForm).
3. LayersModal save handler PATCHes `/api/dashboards/:id/layers/:layerId` with the updated `config` blob (Phase 38 route extension).
4. On dashboard reload, `track_config` reads back from the layer row → `coalesceTrackConfig(raw)` → seeds form state → checkbox + sub-section visibility derived from `enabled`.

No new client API helper; reuses existing `updateDashboardLayer` flow.

### Fingerprint coverage (Phase 38 trust)

`MapChartRenderer.tsx:1118,1208` already serializes `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })`. Phase 40 mutates `track_config`; the existing fingerprint already covers it.

Regression test: Phase 40 spec asserts that toggling `track_config.enabled` AND editing `headColor` both produce different fingerprint values via the same Phase 38 mechanism. Mirrors the Phase 39 CB-V17-09 regression-only approach.

### Claude's Discretion

Areas explicitly left for the planner / executor:

- **`TrackSubSection` file extraction**: inline as a sub-component in `KineticaWmsLayerForm.tsx` (mirrors raster/heatmap/contour inline pattern) vs extracted to `components/charts/TrackSubSection.tsx` (mirrors Phase 39 CbConfigForm extraction). Planner picks based on test isolation needs + the 1372-line host file's current bloat.
- **`isTrackTable` useEffect placement**: a `useEffect([columns])` in either the host form (computes once, passes result down as prop) or inside `TrackSubSection` (encapsulated). Planner picks. Inside the sub-component is cleaner; host form may need the result for the override-checkbox `(auto-detected)` hint regardless.
- **`coalesceTrackConfig` import path**: re-export from `lib/wmsUrlBuilder.ts` (current source) or extract to a new `lib/trackConfig.ts` helper module mirroring `lib/cbConfig.ts`. Phase 38 CONTEXT explicitly deferred extraction "until a 2nd consumer surfaces" — Phase 40 is the 2nd consumer (form). Planner: extract to `lib/trackConfig.ts` if it grows beyond ~30 lines, otherwise inline re-export.
- **Override checkbox placement**: above the sub-section content (inside the same `config-group`) vs floating above the group as a peer header. Planner picks based on visual cleanliness.
- **isTrackTable detection on initial column load timing**: Phase 38 CONTEXT.md flags "async-safe — columns fetched after table select." Planner handles the timing — columns prop arrives populated only after the table dropdown picks a table. The useEffect dep must trigger on columns change, not on first mount.
- **`(auto-detected)` hint visual treatment**: inline italic text after the checkbox label vs a chip/badge. Planner picks.
- **Spec test surface**: new spec file `TrackSubSection.spec.tsx` (if extracted) OR new test blocks in `KineticaWmsLayerForm.spec.tsx` (if inline). 5+ ROADMAP success criteria require coverage.
- **What "Trail color" emits**: form writes to `trackConfig.trailColor`; wmsUrlBuilder emits as `TRACKLINECOLORS` (line 456). Field label "Trail color" — operator-friendly; the WMS param name doesn't leak into the UI.
- **Default `headSize` value**: locked at 8 per the explicit "Spike defaults" decision; the validation-range question's label said `5 / 2` but its description verified `8 / 2`. The earlier-locked spike default 8 wins. If operator preference shifts, planner can revisit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 40 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Track Sub-Section UI" — TRACK-V17-01..06 literal requirements
- `.planning/ROADMAP.md` §"Phase 40: Track Sub-Section UI" — Goal + 5 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — milestone scope

### Phase 38 dependencies (CANONICAL — Phase 40 implementer reads first)
- `.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md` — track_config JSON shape lock, wmsUrlBuilder Track block, hard cutover decisions, isTrackTable helper
- `.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md` — `lib/trackDetect.ts` + schema migration actually shipped
- `.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md` — wmsUrlBuilder Track block + comma-expand under cb_raster actually shipped

### Phase 37 spike outputs (Track + shape enum)
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` §"Track Probes" + §"Decision" — HTTP-locked TRACK_* params; comma-sep under cb_raster confirmed; TRACKMARKERSHAPES (Phase 40 emits this name) vs TRACKHEADSHAPES alternate-naming question deferred to Phase 43 UAT
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` §"Open Question Resolutions" OQ-7, OQ-8, OQ-9 — DOTRACKS under both raster/cb_raster, comma-sep claim HTTP-confirmed, TRACKMARKERSHAPES naming locked
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` lines 310-312, 321 — exact param emission templates for raster + cb_raster paths

### Phase 39 precedent (CbConfigForm patterns)
- `.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md` — sibling sub-section pattern; Phase 40 mirrors layout/state/validation conventions
- `kinetica_bi/src/components/charts/CbConfigForm.tsx` — file structure, color-picker pattern, isValid signaling, defaults seeding — Phase 40 mirrors

### Phase 38 deliverables (READ-ONLY for Phase 40)
- `kinetica_bi/src/lib/trackDetect.ts` — `isTrackTable(columns): TrackColumns | null` (case-insensitive strict 4-name match)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:36-46` — `TrackConfig` TypeScript type (already exported)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:48-60` — `coalesceTrackConfig(raw: string | null): TrackConfig` (Phase 40 form imports this)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:62-89` — `PointShape` union type + `POINT_SHAPES` array (12-value enum; Phase 40 headShape dropdown imports)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:428-472` — Track block emission code (DO NOT MODIFY — Phase 40 form mutations flow through this without form-side WMS code)
- `kinetica_bi/src/api/client.ts:481,518` — `DashboardLayerDto.track_config: string | null` extended in Phase 38

### Existing form code (Phase 40 modifies)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:48` — `import CbConfigForm` precedent (Phase 40 may add `import TrackSubSection`)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:561-823` — raster params section pattern
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:824-893` — heatmap params section pattern (Phase 40 mounts Track sub-section near these, but render-mode-conditional independently)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:895-906` — CbConfigForm gate (sibling pattern Phase 40 mirrors)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:832-859` — raster pointColor two-control AARRGGBB pattern (Phase 40 mirrors verbatim for headColor + trailColor)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — spec patterns; Phase 40 adds new test blocks or new spec file

### Helper / utility precedents
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:25` — `normalizeAARRGGBB` import (Phase 40 form color text inputs normalize on blur)
- `kinetica_bi/src/lib/colorHex.ts` — `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` exports

### v1.4 info-enabled kill-switch precedent
- v1.4 Phase 19 `info_enabled` boolean column + Phase 22 MapConfigPanel toggle — established the "preserve field values, only flip enabled" pattern; Phase 40 mirrors

### TD-V14-WKB-SPIKE
- `.planning/PROJECT.md` §"Carried-in tech debt" — WKB constraint. Phase 40 has NO WKB exposure — track styling is column-name-based detection (TRACKID + x + y + TIMESTAMP), not column-type-based. No WKB gate needed in this sub-section.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`** — host file for the form; Phase 40 mounts `TrackSubSection` (or inline equivalent) above CbConfigForm at line ~895 OR alongside the existing raster/heatmap params blocks.
- **`isTrackTable(columns) → TrackColumns | null`** (`lib/trackDetect.ts`) — Phase 40 form's primary auto-detect input; runs in a `useEffect([columns])` to populate trackConfig defaults.
- **`TrackConfig` + `coalesceTrackConfig(raw)`** (`wmsUrlBuilder.ts:36-60`) — Phase 40 imports these directly for type-safe `track_config` reads.
- **`POINT_SHAPES` + `PointShape`** (`wmsUrlBuilder.ts:62-89`) — Phase 40 headShape dropdown reuses this 12-value enum verbatim.
- **`normalizeAARRGGBB` + `rgbFromAARRGGBB` + `alphaFromAARRGGBB` + `joinAARRGGBB`** (raster pointColor pattern at KineticaWmsLayerForm.tsx:832-859) — Phase 40 mirrors verbatim for headColor + trailColor.
- **`CbConfigForm` component shape** (Phase 39) — sibling sub-component pattern; Phase 40 mirrors structure (props: `config`, `onChange`, `columns`, `isValid` + any track-specific extras).
- **`useToastStore.getState().showToast(message, kind)`** — Phase 40 uses for any error toasts (e.g., if column dropdown receives a stale columns prop). `"error"`, `"permission"`, `"info"` kinds locked from v1.6/v1.7.

### Established Patterns

- **`{renderMode === "X" && <ParamsBlockX ... />}` gate pattern** — raster/heatmap/classbreak (CbConfigForm)/contour each gated independently. Phase 40 adds a Track sub-section gated by `(renderMode === "raster" || renderMode === "classbreak") && trackConfig.enabled === true`.
- **Sub-component as inline function vs extracted file** — `ClassbreakParamsGroup` was inline (now deleted); `CbConfigForm` was extracted. Planner picks based on host file bloat.
- **`onChange({ ...config, fieldName: newValue })` immutable patch pattern** — Phase 40 patches `track_config` by serializing on every mutation: `onChange({ ...config, track_config: JSON.stringify(newTrackConfig) })`.
- **`isValid` callback prop pattern** — Phase 40 always signals `isValid(true)` since trackConfig has no required-completeness gate (operator can leave fields blank and tracks render with wmsUrlBuilder defaults).
- **`<input type="color">` + text input two-control pattern** — Phase 40 uses for headColor + trailColor.
- **Render-mode swap state preservation** — locked by TRACK-V17-03; planner verifies via spec that switching raster ↔ classbreak preserves trackConfig 1:1.

### Integration Points

- **`KineticaWmsLayerForm.tsx:895` area** — mount `<TrackSubSection ... />` either as a new conditional block sibling to `<CbConfigForm ... />` (preferred — independent gating) or inside both raster/heatmap/classbreak gates (duplicative — avoid).
- **`KineticaWmsLayerForm.tsx`** — import `TrackSubSection` (if extracted) and `coalesceTrackConfig` + `isTrackTable` (if `useEffect` lives in host).
- **(optional)** `kinetica_bi/src/components/charts/TrackSubSection.tsx` — extracted file.
- **(optional)** `kinetica_bi/src/lib/trackConfig.ts` — extracted helper module if planner prefers consolidation.
- **`KineticaWmsLayerForm.spec.tsx`** — new test blocks asserting all 5 ROADMAP SCs + 6 TRACK-V17 REQ-IDs.
- **(optional)** `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` — separate spec file (if extracted).

### Risks & Anti-Patterns to Avoid

- **Don't modify `wmsUrlBuilder.ts` Track block** — Phase 38 ships emission code; Phase 40 form mutations flow through the existing path. Anti-pattern: any new emission logic in the form layer.
- **Don't auto-disable based on field clearing** — TRACK-V17-06's "deleting all values" maps to the override checkbox, not field-by-field detection. Field clearing leaves `track_config.{field}` as undefined; wmsUrlBuilder handles gracefully.
- **Don't extract `coalesceTrackConfig` if it stays trivial** — Phase 38 CONTEXT.md flagged "no separate lib/trackConfig.ts module — single consumer for now; Phase 40 may extract if a 2nd consumer surfaces." Phase 40 is the 2nd consumer; planner decides whether the extraction earns its keep.
- **Don't reset `track_config` on render-mode flip to heatmap** — TRACK-V17-03 lock; preserve state silently.
- **Don't reset `track_config` on override-uncheck** — preserve field values; only flip enabled.
- **Don't hardcode `trackIdAttr="TRACKID"` when isTrackTable's TrackColumns has the matched casing** — use `isTrackTable(columns)?.trackIdCol ?? "TRACKID"` to preserve original column casing.
- **Don't add WKB-column gate to track form** — track detection is column-name-based, not column-type-based; no WKB exposure.
- **Don't trust the `lineWidth` field on TrackConfig** — Phase 40 form writes only to `trailSize` (single 'Line width' input). `lineWidth` is a latent compatibility shim.
- **Don't add headShape='(none)' as a special form value** — `headSize=0` is the no-marker control; `headShape` always has a value to keep emission logic clean.
- **Don't rely on Phase 37's spike-tested 4-shape enum** — Phase 40 exposes the full 12-value POINT_SHAPES; Phase 43 UAT validates each option visually.
- **Don't add new server vitest specs** — Phase 40 is frontend-only.
- **Don't extend `lastEmittedParamsRef` fingerprint** — Phase 38 already includes `layer.track_config`. Regression test only.

</code_context>

<specifics>
## Specific Ideas

- **Persisted-state-wins on load** (operator-locked) — handles the edge case where an operator manually enabled tracks on a non-track-shape table (e.g., a flight log with columns LON/LAT/TS instead of x/y/TIMESTAMP); their override persists across reloads.
- **Auto-enable on new-layer + track-shape table** — saves operator clicks on the common case. Mirrors v1.5 spatial-mode auto-suggest pattern (Phase 28 MapConfigPanel auto-suggests latlon/wkt/wkb based on column shape).
- **Single 'Line width' field writes only to trailSize** — eliminates operator confusion about the trailSize vs lineWidth alias; the latter stays as a latent compatibility shim.
- **Preserve fields on uncheck** — v1.4 info-enabled kill-switch precedent; lets operators temporarily disable tracks for screenshot/debug without losing their styling work.
- **isTrackTable matched-casing seed** — if the table uses lowercase `trackid` instead of uppercase `TRACKID`, the form seeds the dropdown with the actual matched name. Less operator friction.
- **POINT_SHAPES 12-value enum reuse** — keeps Track + CB headShape UX visually identical for operators who configure both render modes on the same layer.
- **Two-control AARRGGBB pattern** — operators get alpha-transparency support out of the box (e.g., trail with 50% opacity for visual layering with classbreak fills).

</specifics>

<deferred>
## Deferred Ideas

- **Track-shape detection via Kinetica metadata** (e.g., querying Kinetica for "is this table a track table?" API) — relies on Kinetica feature support that's unclear; Phase 37 spike didn't probe a metadata endpoint. v1.8+.
- **Track shape aliases** (e.g., accepting `track_id`, `lat`/`lon`, `time`/`ts`) — Phase 38 lock: strict 4-name match only. v1.8+.
- **TRACKHEADSHAPES alternate-naming flag** — Phase 37 OQ-9 deferred to Phase 43 UAT. If Kinetica build prefers TRACKHEADSHAPES, Phase 43 swaps the emission param.
- **Per-shape spike re-test** — Phase 40 exposes 12-value POINT_SHAPES; only 4 were spike-confirmed. Phase 43 UAT visually validates each shape. If any fails, v1.8 restricts the dropdown.
- **Auto-disable when all fields blank** — magic semantics rejected; checkbox is the sole enabled control.
- **'(none)' option for headShape** — operator uses headSize=0 instead; defer to v1.8 if operators surface friction.
- **Inline 'Clear all track styling' button** — defer to v1.8.
- **Two-column 'Head | Trail' visual grouping** — single-column locked for v1.7 visual consistency; v1.8 may revisit.
- **lineWidth field as a separate input** — collapsed into single 'Line width' writing to trailSize; v1.8 may delete the lineWidth alias from TrackConfig type if no external consumer surfaces.
- **Smart column-type filtering on trackIdAttr dropdown** (e.g., only show INT/STRING types) — v1.8+; Phase 40 shows all non-spatial columns.
- **'Apply track styling to all layers' bulk operation** — power-user feature; v1.8+.
- **Persisted N-column track layout (e.g., per-track-ID color override)** — Phase 38 TrackConfig has no per-track field; comma-sep TRACK_* under cb_raster is keyed to CB_VALS length, not track-ID enumeration. v1.8+.
- **Track preview thumbnail in form** — visual preview of head shape/color combo. Nice-to-have; v1.8+.
- **`@dnd-kit/core` drag-reorder for tracks** — N/A; Phase 40 has no list-of-rows UI (single track config per layer).

</deferred>

---

*Phase: 40-track-sub-section-ui*
*Context gathered: 2026-05-21*
