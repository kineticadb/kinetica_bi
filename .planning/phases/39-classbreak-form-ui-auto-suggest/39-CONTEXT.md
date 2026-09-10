# Phase 39: Classbreak Form UI + Auto-Suggest - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-facing form UI for configuring Class Break rendering end-to-end inside `KineticaWmsLayerForm`. Phase 39 ships:

1. **3rd render-mode option**: "Class Break" added to the existing RENDER MODE radio group (alongside Raster + Heatmap; contour stays hidden from picker).
2. **Net-new `CbConfigForm` sub-component**: replaces the v1.2 `ClassbreakParamsGroup` entirely. Reads/writes `config.cb_config` via `coalesceCbConfig` + `lib/cbConfig.ts` helpers (Phase 38). Gated by `{renderMode === 'classbreak' && <CbConfigForm ... />}` at the same indent level as the existing raster/heatmap blocks.
3. **CB column picker + auto-detection**: dropdown of non-spatial, non-WKB columns. Selecting a numeric column auto-sets `valsType: "numeric"`; selecting TEXT/CHAR auto-sets `"categorical"`. Hidden override under Advanced lets operator force-flip type.
4. **Break-row builder**: N rows of `{ value, color, label?, pointSize, pointShape, shapeLineWidth, shapeLineColor, shapeFillColor }`. Per-row chevron `[▸]` expands inline advanced fields underneath. All 5 advanced fields always have valid defaults on row creation; the form clamps/validates to prevent invalid emission.
5. **Auto-suggest button**: `[Auto-suggest breaks]` with an inline N slider (range 2–16). Click → `POST /api/quantile` (Phase 38 endpoint) → modal-confirm overwrite when rows exist → replace breaks with returned boundaries, preserving colors by index.
6. **Categorical `<other>` bucket**: checkbox above rows defaults ON; when ON, an `<other>` row is auto-maintained at end of `breaks[]`.
7. **Cardinality probe for categorical mode**: fires `probeCardinality(table, column)` on CB column pick when `valsType === "categorical"`; warns at 100, hard-caps at 256 (v1.2 Phase 11 carry-forward).
8. **Legacy cleanup**: `ClassbreakParamsGroup` sub-component + `ClassbreakBreak` type deleted from `KineticaWmsLayerForm.tsx`. Legacy `config.cbColumn` + `config.classbreaks[]` fields on layer rows are LEFT in place (Phase 38 LEAVES legacy fields untouched; v1.8 cleanup).
9. **Error UX**: Auto-suggest failures surface as inline red text under the button AND a toast notification (high-visibility).
10. **WKB exclusion (CB-V17-08)**: WKB-binary columns absent from CB attr picker; inline message "WKB columns not supported for classbreak in v1.7".
11. **Fingerprint coverage (CB-V17-09)**: TRUST Phase 38's `lastEmittedParamsRef` lock — already serializes `cb_config` JSON; Phase 39 mutates same field, re-renders flow through existing fingerprint. No new fingerprint work.

In scope: form UI for CB end-to-end + `/api/quantile` consumer (`quantileFn` from `client.ts`) + per-row advanced reveal + categorical `<other>` toggle + cardinality probe wiring + legacy `ClassbreakParamsGroup` removal + spec coverage.

Out of scope: Track sub-section UI (Phase 40), LayersLegendPanel (Phase 41), standalone Legend widget (Phase 42), live UAT (Phase 43), WMS URL emission (Phase 38), `/api/quantile` server endpoint (Phase 38), `cb_config` schema migration (Phase 38), `lib/cbConfig.ts` helpers (Phase 38), `lastEmittedParamsRef` fingerprint extension (Phase 38).

</domain>

<decisions>
## Implementation Decisions

### Form integration approach — net-new `CbConfigForm`

The v1.2 `ClassbreakParamsGroup` (KineticaWmsLayerForm.tsx:180-440) writes to legacy `config.cbColumn` + `config.classbreaks[]`. Phase 38 hard cutover made those fields dead-read at the WMS URL boundary. Phase 39:

- **DELETES** `ClassbreakParamsGroup` sub-component (lines ~180-440) and its `ClassbreakBreak` type from `KineticaWmsLayerForm.tsx`.
- **CREATES** new `CbConfigForm` sub-component in the same file (or extracted into `kinetica_bi/src/components/charts/CbConfigForm.tsx` if the planner chooses). Reads/writes `config.cb_config` via `coalesceCbConfig` at the top.
- **REUSES** the v1.2 patterns that still apply: `probeCardinality` call shape, 256 hard-cap toast pattern, `[+ Add break]` CTA, color-picker idiom (`<input type="color">` with normalizeAARRGGBB on the value). Row layout itself is rebuilt to add the new label field + per-row advanced chevron.
- **Spec coverage**: existing `ClassbreakParamsGroup`-targeted tests in `KineticaWmsLayerForm.spec.tsx` are replaced with new `CbConfigForm`-targeted specs. No requirement to preserve old test names.

Justification: the cb_config shape is materially different from legacy classbreaks[] (has per-row label + 5 advanced fields + `<other>` toggle); growing the legacy component organically would couple the two shapes and complicate the eventual v1.8 legacy field cleanup.

### Render-mode picker — filter to 3 user-facing modes

The `RenderMode` TypeScript type stays at 4 values (`raster | heatmap | classbreak | contour`) per Phase 38 lock. The form picker filters `ALL_RENDER_MODES` to render only Raster + Heatmap + Class Break radio options; contour is dropped from the picker. Existing `allowedRenderModes` capability gate stays in place (currently no production caller restricts modes; just a future extension hook).

`onSelectRenderMode("classbreak")` writes `config.renderMode = "classbreak"`; wmsUrlBuilder (Phase 38) emits `STYLES=cb_raster`.

### CB column picker — eligibility filter

Eligible columns for the CB attr dropdown:
- INCLUDE: numeric types (int / integer / int8 / int16 / int32 / int64 / long / float / double / decimal / numeric / smallint / bigint / real / number / tinyint)
- INCLUDE: string types (string / varchar / char) — for categorical mode
- EXCLUDE: WKB-binary columns (any column whose type contains "bytes" or "wkb" case-insensitive)
- EXCLUDE: spatial columns already bound to x/y/wkt config fields (visual de-clutter; non-spatial CB only)

When operator hovers / focuses a WKB column entry (if shown for context) or has no eligible columns, an inline message reads "WKB columns not supported for classbreak in v1.7" (CB-V17-08). Empty eligible list shows "No CB-eligible columns on this table."

### Column-change behavior — preserve row count + colors, blank values

When the operator switches the CB column:
- **Preserve** `breaks[].length` (row count).
- **Preserve** `breaks[].color` by index (operator's color tuning carries).
- **Preserve** `breaks[].label` if present (operator's labels are column-agnostic).
- **Preserve** per-row advanced fields (`pointSize` etc.) by index.
- **CLEAR/RE-BLANK** `breaks[].value` based on new column's auto-detected `valsType`:
  - numeric → categorical: value becomes empty string `""`
  - categorical → numeric: value becomes `0` (zero, the simplest numeric default)
  - same type: value stays as-is
- **Auto-flip** `cb_config.valsType` to match new column's auto-detected type unless the operator has the Advanced "force categorical" override checked.

This rule applies even when an operator picks a column from the SAME mode (numeric → numeric): values stay, only `attr` changes.

### Numeric ↔ categorical mode override — hidden under Advanced

`valsType` auto-defaults from column type (CB-V17-02). Manual override is exposed via an Advanced section toggle (not a visible radio):

- Above the rows, a `[▸ Advanced]` chevron expands a panel containing:
  - `[ ] Treat numeric column as categorical` checkbox — only meaningful when current column is numeric; flips `valsType` to `"categorical"`.
- When checked + column is numeric, value inputs become text inputs (so operator can group integer bins as strings).
- When unchecked OR column is categorical (TEXT/CHAR), `valsType` follows column type auto-detect.

Rationale: CB-V17-02 says "operator can override" — interpreted narrowly as "override the picked column", with the type-flip available for power-user edge cases (e.g., treating an INT category code as a categorical bucket).

### Cardinality probe — on column pick, categorical only

When `valsType === "categorical"` AND operator picks (or changes) the CB column:
- Fire `probeCardinality(table, column, abortSignal)` immediately (existing v1.2 helper).
- Show "Counting distinct values…" hint while in-flight.
- On `count > 100`: warn via `useToastStore.getState().showToast(message, "permission")` — matches v1.2 Phase 11 wording: "That's a lot of breakpoints — consider a heatmap or numerical range instead."
- On `count > 256`: hard-cap error via toast (`"error"` kind): "Too many distinct values — Kinetica classbreak supports up to 256." Disable `[+ Add break]` when over cap.
- AbortController per probe; cancel in-flight on column re-pick.

Numeric mode does NOT fire the probe (no cardinality cap concern for ranges).

### `<other>` bucket — checkbox above rows, default ON

When `valsType === "categorical"`:
- Render `[✓] Include <other> bucket` checkbox above the rows.
- Default `cb_config.includeOtherBucket = true` on first switch to categorical.
- When ON: auto-maintain an `<other>` row at end of `breaks[]` (auto-append on toggle-ON; auto-remove on toggle-OFF).
- The `<other>` row's value field renders as a read-only chip showing `<other>`; color + label + advanced fields editable as normal.
- When OFF: NULL rows are silently excluded by Kinetica (Phase 37 OQ-5 observed behavior); operator-visible warning under the toggle: "NULL values will not appear in the map."

Per Phase 38 decision: `wmsUrlBuilder` does NOT auto-inject `<other>` — Phase 39 form is the sole owner of placing the row.

### Numeric breaks UX — value = numeric upper-boundary

Numeric break rows:
- `value` field is a number input (HTML `<input type="number">`).
- Each row's `value` represents the UPPER BOUNDARY of that bucket (per Phase 38 `/api/quantile` semantics: `breaks: number[]` of length N-1 defining N ranges).
- Visual hint: "Upper boundary" placeholder text.
- No range validation on value itself (NTILE quantile produces arbitrary numeric ranges including negatives).
- Sort rows ascending by value on Auto-suggest replace; do NOT auto-sort on manual edit (operator's order intent preserved).

### Categorical breaks UX — value = single string

Categorical break rows:
- `value` field is a text input (`<input type="text">`).
- Each row's `value` is a single distinct categorical value (or `<other>` for the sink).
- Validation BEFORE save: reject empty values (`""`); warn on duplicate values across rows.
- Phase 37 Edge-4 lock: client-side validation MUST happen before PATCH submit — Kinetica silently ignores malformed CB_VALS without HTTP error.
- Backslash-escape comma-containing values (Phase 37 Edge-2 default): if operator types `foo,bar`, the value emitter (in wmsUrlBuilder, NOT in the form) escapes to `foo\,bar`. **Phase 39 form stores the raw operator input including unescaped commas**; emission-time escaping is Phase 38's wmsUrlBuilder responsibility.

### Per-row label field

Each row has a label text input alongside the color picker. Stored in `cb_config.breaks[].label`. Empty label is valid (renders as "(no label)" in the legend Phase 41 ships). NOT emitted to WMS URL (Phase 38 lock — labels are presentation-layer only, surfaced by `<LayersLegendPanel />`).

### Per-row advanced params — chevron reveal + always-valid defaults

Each break row has a `[▸]` chevron at the row's right edge. Click expands an inline panel BELOW the row containing 5 fields:

| Field | Type | Default on row create | Range | Notes |
|-------|------|-----------------------|-------|-------|
| `pointSize` | integer | `5` | `1–20` | Clamp via number input min/max attrs |
| `pointShape` | enum | `"circle"` | `circle / square / diamond / triangle` | Dropdown |
| `shapeLineWidth` | integer | `1` | `1–20` | Clamp via number input min/max |
| `shapeLineColor` | AARRGGBB | derived from row `color` (or default `FF000000`) | hex format | Color picker + text input |
| `shapeFillColor` | AARRGGBB | derived from row `color` (or default `FFFFFFFF`) | hex format | Color picker + text input |

**Lock: every advanced field always has a valid value** — no `undefined` emission to the WMS URL. The form clamps invalid inputs (e.g., `pointSize=0` snaps to `1`, `pointSize=50` snaps to `20`). Empty number input falls back to the default (`5` for pointSize).

This means `wmsUrlBuilder`'s CB emission is always full comma-separated for every advanced field: `POINTSIZES=5,5,8,3,5`, `POINTSHAPES=circle,circle,square,circle,circle`, etc. No conditional drop logic needed.

**Reveal state is per-row + per-form-session** — NOT persisted to cb_config. Each row's chevron starts collapsed on form open.

### New-row creation — all defaults explicit

`[+ Add break]` appends a new row with all fields populated:

```typescript
{
  value: valsType === "numeric" ? 0 : "",
  color: PALETTE_COLORS[index % PALETTE_COLORS.length],  // sequential from default palette
  label: "",
  pointSize: 5,
  pointShape: "circle",
  shapeLineWidth: 1,
  shapeLineColor: "FF000000",
  shapeFillColor: "FFFFFFFF",
}
```

**Default palette**: planner picks a sequential 8-10 color palette (e.g., light-to-dark blue, or distinct hues for categorical) at `lib/cbConfig.ts` or local to `CbConfigForm.tsx`. Phase 41 legend rendering uses the same colors directly — no separate legend palette.

### Auto-suggest UX flow

**N input**: inline slider input alongside the `[Auto-suggest breaks]` button:
```
[N: 5] ───●─────  [Auto-suggest breaks]
       2          16
```
- Range: `2–16` (UI cap; tighter than server's `2–256` per Phase 38 — server-side cap stays for safety + categorical paths that don't use the UI slider).
- Default: `5`.
- Slider persists across clicks within the form session (not persisted to cb_config).
- Visible only in numeric mode (categorical doesn't use `/api/quantile`).

**Click behavior**:
1. Validate: column selected + `valsType === "numeric"` (button disabled otherwise with title "Select a numeric column for auto-suggest").
2. If `breaks[].length > 0`: show modal-confirm dialog (app-styled, matches LayersModal modal style) — "Replace N break rows with N-1 quantile boundaries?" with `[Replace] [Cancel]`. **Always** confirm — no "hand-edited" detection; any existing rows trigger the confirm.
3. On confirm OR if `breaks[].length === 0`: call `quantileFn({ schema, table, column, n }, signal)` (existing helper at `client.ts:1074`).
4. On success: replace `breaks[]` with new array of length N (N upper boundaries — append the dataset max as the Nth row's upper boundary, OR follow Phase 38 `/api/quantile` response semantics: N-1 boundaries → N buckets → N rows where row[0..N-2] take the boundary values and row[N-1] holds the dataset max placeholder).
   - **Color preservation by index**: row[i] retains existing color if `i < oldBreaks.length`; new rows get the default palette color at `[i % palette.length]`.
   - **Advanced fields preservation by index**: same rule — preserve `label`, `pointSize`, `pointShape`, etc. at matching index; new rows get defaults.
5. On 4xx/5xx: surface BOTH inline red text under the button ("Auto-suggest failed: <verbatim message>") AND a toast (`kind: "error"`).
6. On rapid re-click: previous in-flight request aborts via `AbortController.abort()`; only the latest request's response is consumed.

**N row semantics clarification**: Phase 38 `/api/quantile` returns `breaks: number[]` of length `n-1` — these are the N-1 upper boundaries that define N ranges. Phase 39 form materializes this as **N break rows** where:
- Rows `[0..N-2]`: `value = breaks[i]` (the upper boundary returned by the endpoint).
- Row `[N-1]`: `value = "" (empty) OR the dataset max if available` — the last bucket extends from `breaks[N-2]` to infinity. Planner picks: empty value (operator fills in if they want a visible label) vs auto-fill with dataset max from a follow-up `MAX(column)` query. Recommendation: empty + a placeholder hint "≥ {breaks[N-2]}" so the operator knows the row's semantic.

### Save + persistence

Save / dirty-tracking: follows the existing `KineticaWmsLayerForm` flow — operator's edits to `config.cb_config` propagate via the form's existing `onChange` chain → LayersModal save button → `PATCH /api/dashboards/:id/layers/:layerId` (Phase 38 route extension). No new save mechanism in Phase 39.

Form-to-URL re-render: trust Phase 38's `lastEmittedParamsRef` fingerprint extension. Phase 39 mutates `cb_config`; Phase 38 fingerprint includes the JSON-serialized field; tile re-render fires on any edit.

### Error UX — inline + toast

For Auto-suggest failures:
- **Inline**: red text directly below the button: "Auto-suggest failed: <message>". Persists until next Auto-suggest click or column change.
- **Toast**: `useToastStore.getState().showToast("Auto-suggest failed: <message>", "error")`. High-visibility, dismissible.

For categorical validation failures (empty value, duplicate value): inline red text under the offending row's value field. NO toast (too noisy for inline-fixable errors).

For WKB-column rejection: inline gray hint text in the column picker section. NO toast (informational, not an error).

### Claude's Discretion

Areas explicitly left for the planner / executor:

- **Default color palette**: planner picks specific 8-10 hex codes (suggestion: ColorBrewer "Blues" sequential for numeric, "Set2" qualitative for categorical). Hardcoded in `CbConfigForm.tsx` or extracted to `lib/cbPalette.ts`.
- **`CbConfigForm` file extraction**: inline as a sub-component in `KineticaWmsLayerForm.tsx` (mirrors existing `ClassbreakParamsGroup` pattern) vs extracted to its own file `components/charts/CbConfigForm.tsx`. Inline keeps lookup straightforward; extraction reduces the 1372-line file. Planner picks based on test isolation needs.
- **Modal-confirm component reuse**: planner identifies whether an existing modal helper exists (e.g., used by LayersModal's delete confirmation) or builds an inline-portal modal. No new dependency.
- **`PALETTE_COLORS` constant placement**: in `CbConfigForm.tsx` vs `lib/cbConfig.ts`. If Phase 41 legend reuses it, `lib/cbConfig.ts` makes sense.
- **Per-row advanced reveal state storage**: `useState<Set<number>>(new Set())` for expanded row indexes, OR `useState<Record<number, boolean>>({})`. Planner picks.
- **Row drag-reorder**: Phase 11 had drag-reorder mention; Phase 39 reqs do NOT mandate it. Planner can include or defer to v1.8 — operator's intent unclear from CB-V17-03's "drag-reorder" mention (which may have been speculative). If included, use `@dnd-kit/core` (already in `package.json`? — planner verifies).
- **Last bucket's value semantics**: empty value with `≥ {prev}` hint vs explicit dataset max via a follow-up `MAX(column)` Kinetica query. Recommendation: empty + hint (simpler; no extra round-trip).
- **Slider component**: native `<input type="range">` vs styled custom component. Native is fastest; styled matches v1.5 spatialFilterBar slider if one exists. Planner checks.
- **Spec test surface**: which tests in `KineticaWmsLayerForm.spec.tsx` to retain vs replace. All `ClassbreakParamsGroup`-targeted tests are obsolete (component is deleted). Planner builds new `CbConfigForm` test coverage from scratch.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 39 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Classbreak Form UI + Auto-Suggest" — CB-V17-01..09 literal requirements
- `.planning/ROADMAP.md` §"Phase 39: Classbreak Form UI + Auto-Suggest" — Goal + 5 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — milestone scope + open tech-debt

### Phase 38 dependencies (CANONICAL — Phase 39 implementer reads first)
- `.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md` — Hard-cutover decisions, `cb_config` JSON shape, `/api/quantile` contract, `lastEmittedParamsRef` extension scope, legacy field handling
- `.planning/phases/38-schema-wms-engine-foundation/38-VERIFICATION.md` — confirms Phase 39 unblocked on every Phase 38 deliverable
- `.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md` — db schema + DTO + helper modules (`lib/cbConfig.ts`, `lib/trackDetect.ts`) actually shipped
- `.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md` — wmsUrlBuilder Lane C rewrite + AARRGGBB fix actually shipped
- `.planning/phases/38-schema-wms-engine-foundation/38-03-SUMMARY.md` — `/api/quantile` endpoint + `quantileFn` client helper actually shipped

### Phase 37 spike outputs (CB UX edge cases)
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` §"Categorical Edge-Case Probes" — Edge-2 (comma-escape), Edge-3 (NULL bucket), Edge-4 (SILENT-IGNORE) — informs Phase 39 form client-side validation requirements
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` §"Open Question Resolutions" OQ-3, OQ-4, OQ-5 — `<other>` keyword PASS, backslash-escape default, NULL silent-excluded → `<other>` default-ON

### Phase 38 deliverables (READ-ONLY for Phase 39)
- `kinetica_bi/src/lib/cbConfig.ts` — `CbBreak`, `CbConfig`, `EMPTY_CB_CONFIG`, `coalesceCbConfig`, `isCbConfigConfigured`, `isNumericValsType`, `isCategoricalValsType` (Phase 39 form imports these)
- `kinetica_bi/src/lib/cbConfig.spec.ts` — helper test surface (Phase 39 doesn't modify)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Lane C emission (`STYLES=cb_raster` + Lane C param set); Phase 39 form mutations flow through this without form-side WMS code
- `kinetica_bi/src/api/client.ts:1074` — `quantileFn({ schema, table, column, n }, signal): Promise<{ breaks: number[] }>` (Phase 39 Auto-suggest button consumer)
- `kinetica_bi/server/src/index.ts` `/api/quantile` route — Phase 39 form's only server-side consumer

### Existing form code (Phase 39 modifies)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:180-440` — current `ClassbreakParamsGroup` + `ClassbreakBreak` type (DELETE in Phase 39)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:796-819` — RENDER MODE radio group (Phase 39 filters to 3 visible modes)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:1156` — current `{renderMode === "classbreak" && <ClassbreakParamsGroup ... />}` gate (Phase 39 swaps to `<CbConfigForm ... />`)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:452-471` — `renderMode` state derivation + the `useEffect` that signals validity on mode change (Phase 39 may extend validity gate to `cb_config.breaks.length >= 2`)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — current `ClassbreakParamsGroup`-targeted tests (Phase 39 replaces)

### Helper / utility precedents
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:25` — `normalizeAARRGGBB` import (Phase 39 form's color text inputs normalize on blur)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` `probeCardinality` call site in `ClassbreakParamsGroup` (Phase 39 `CbConfigForm` reuses this helper)
- `kinetica_bi/src/stores/toastStore.ts` (or equivalent) — `useToastStore.getState().showToast(message, kind)` — Phase 39 reuses for cardinality warnings + Auto-suggest errors
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — visible reference for the form section conventions (label classes, group containers)

### TD-V14-WKB-SPIKE constraint
- `.planning/PROJECT.md` §"Carried-in tech debt" — WKB constraint; Phase 39 CB attr picker MUST exclude WKB-binary columns (CB-V17-08)

### Color format references
- `kinetica_bi/src/lib/colorHex.ts` (or wherever `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` are exported) — Phase 39 color text input + color picker use these idioms

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`** (1372 lines) — host file for the form; Phase 39 deletes ClassbreakParamsGroup (lines 180-440) and adds CbConfigForm in its place.
- **`probeCardinality(table, column, signal)`** (called from line ~226 in current ClassbreakParamsGroup) — distinct-value count helper; Phase 39 CbConfigForm reuses verbatim.
- **`useToastStore.getState().showToast(message, kind)`** — existing toast pattern (`"error"`, `"permission"`, `"info"` kinds; NO `"warning"` per Phase 34 lock). Phase 39 uses for cardinality warnings + Auto-suggest errors.
- **`normalizeAARRGGBB` + `rgbFromAARRGGBB` + `alphaFromAARRGGBB` + `joinAARRGGBB`** (imported in KineticaWmsLayerForm.tsx, lines ~840-859 for raster pointColor pattern) — color picker idioms Phase 39 mirrors for per-row color + advanced shapeLine/shapeFill colors.
- **`coalesceCbConfig(layer.cb_config) → CbConfig`** (`lib/cbConfig.ts`) — Phase 39 reads at form mount to seed initial form state; writes back via `onChange({ ...config, cb_config: <serialized JSON> })`.
- **`quantileFn({ schema, table, column, n }, signal): Promise<{ breaks: number[] }>`** (`client.ts:1074`) — Phase 39 Auto-suggest button consumer; AbortController per click.
- **`<input type="color">` + text input two-control pattern** (raster pointColor at line 832-859) — Phase 39 row colors + advanced shape colors mirror exactly.

### Established Patterns

- **Sub-component as inline function in same file** — `ClassbreakParamsGroup` (lines 180-440) was inline; Phase 39 `CbConfigForm` follows the same convention unless extracted (Claude's Discretion).
- **`{renderMode === "X" && <ParamsGroupForX ... />}` gate pattern** — raster/heatmap/classbreak/contour each have their own gated block; Phase 39 swaps the classbreak gate's content.
- **`onChange({ ...config, fieldName: newValue })` immutable patch pattern** — form state lives in parent (`config: Record<string, unknown>`); sub-components patch via spread. Phase 39 CbConfigForm patches `cb_config` (JSON string) by serializing on every mutation: `onChange({ ...config, cb_config: JSON.stringify(newCbConfig) })`.
- **`isValid` callback prop pattern** — sub-components signal validity to parent via `isValid?: (valid: boolean) => void` prop. Phase 39 CbConfigForm signals `breaks.length >= 2 && all breaks have valid values`.
- **Categorical 256 hard-cap + 100 warn pattern** — locked v1.2 Phase 11; Phase 39 inherits unchanged.
- **AbortController per fetch + cancel on re-fire pattern** — Phase 13 materializeFilter, Phase 34 Save/Preview, Phase 35 orchestrator. Phase 39 Auto-suggest follows.
- **Modal pattern** — LayersModal + DynamicViewsModal use a portal-based modal. Phase 39 confirm-overwrite dialog reuses the same portal helper (if one exists) or matches the style.
- **Pure form-side validation BEFORE PATCH** — Phase 37 Edge-4 lock; Phase 39 categorical mode validates empty / duplicate values client-side before allowing save.

### Integration Points

- **`KineticaWmsLayerForm.tsx:180-440`** — DELETE ClassbreakParamsGroup + ClassbreakBreak type
- **`KineticaWmsLayerForm.tsx:796-819`** — render-mode radio filter (drop contour from picker)
- **`KineticaWmsLayerForm.tsx:1156`** — swap classbreak gate to render `<CbConfigForm ... />`
- **`KineticaWmsLayerForm.tsx:452-471`** — validity gate (extend to `cb_config.breaks.length >= 2`)
- **`KineticaWmsLayerForm.spec.tsx`** — replace ClassbreakParamsGroup specs with CbConfigForm specs
- **(optional)** `kinetica_bi/src/components/charts/CbConfigForm.tsx` — extracted file (Claude's Discretion)
- **(optional)** `kinetica_bi/src/lib/cbPalette.ts` — default color palette if shared with Phase 41 legend

### Risks & Anti-Patterns to Avoid

- **Don't read or write legacy `config.cbColumn` / `config.classbreaks[]`** — hard cutover (Phase 38). Phase 39 form touches only `config.cb_config`.
- **Don't emit `undefined` per-row advanced values to wmsUrlBuilder** — all rows always have all 5 advanced fields populated. The form clamps invalid input.
- **Don't trust Kinetica's CB_VALS parser to reject malformed categorical input** — Phase 37 Edge-4 SILENT-IGNORE; form must validate empty values + duplicates BEFORE save.
- **Don't auto-inject `<other>` row from `wmsUrlBuilder`** — Phase 38 lock; Phase 39 form is sole owner of the row.
- **Don't add new server vitest specs** — Phase 39 is frontend-only; no server changes.
- **Don't refactor `RenderMode` type** — Phase 38 lock; leave at 4 values, filter visibility in the picker.
- **Don't add Zod or any runtime JSON validation lib** — Phase 38 anti-pattern lock; TypeScript types + boundary `JSON.parse` only.
- **Don't fire `probeCardinality` in numeric mode** — categorical mode only (no cardinality concern for numeric ranges).
- **Don't surface every form-internal validation failure as a toast** — toasts are for high-visibility errors (Auto-suggest failure, cardinality hard-cap). Inline red text for form-fixable errors (empty value, duplicate value).
- **Don't escape commas at the form layer** — Phase 39 form stores raw operator input; wmsUrlBuilder (Phase 38) does backslash-escape at emission time. Avoids double-escaping.

</code_context>

<specifics>
## Specific Ideas

- **N slider range 2–16** (user-locked) overrides the server-side 2–256 cap from Phase 38. UI is the tighter cap; server keeps 2–256 for future paths (e.g., categorical cardinality probe might reuse the endpoint, hence 256 server cap stays valid).
- **PointSize range 1–20** (user-locked) — tighter than the speculative 1–50; matches Kinetica's practical point-render range and prevents unreadable tiles.
- **ShapeLineWidth range 1–20** (user-locked) — same rationale.
- **Per-row chevron expand pattern** — operator can mix advanced + simple rows in the same break list; each row's advanced reveal is independent.
- **Color carry-over by index on Auto-suggest** preserves operator's color tuning across re-runs of the Auto-suggest workflow (e.g., operator picks N=5, gets boundaries, tunes 5 colors, re-runs with N=7 → 5 colors stick + 2 new from palette).
- **Color carry-over by index on column-change** — same rule applies; switching column from `fare_amount` to `tip_amount` preserves colors so operator can compare visualizations.
- **Hidden `[Treat numeric column as categorical]` checkbox** — power-user escape hatch under Advanced section. Hidden by default to avoid confusing the average operator.
- **`<other>` row's value field is read-only chip** — visually distinguishes the sink bucket from operator-typed values; chip styling prevents accidental edit.
- **Modal-confirm on every Auto-suggest with existing rows** — no "hand-edited" detection; any non-empty `breaks[]` triggers the modal. Simpler than dirty-tracking logic.

</specifics>

<deferred>
## Deferred Ideas

- **Drag-reorder of break rows** — CB-V17-03 mentions it but spec is loose; planner can defer to v1.8 if `@dnd-kit/core` isn't already in the codebase.
- **Equal-interval / Jenks Natural Breaks / Manual quantile method picker** — v1.7 ships NTILE-only (quantile). v1.8+ revisit.
- **Auto-suggest preview-before-commit** — current UX: click → modal-confirm overwrite → replace. No "preview the boundaries first, then commit." If operators want to iterate on N rapidly, revisit.
- **Persist N slider value to `cb_config`** — session-only currently; revisit if operators report repeated re-tweaking on the same widget.
- **CB_LABELS WMS param emission** — Phase 38 deferred; Phase 41 legend renders labels client-side. Revisit if Kinetica adds native label support.
- **Bulk per-row advanced edit** ("apply this pointSize to all rows") — power-user feature; defer to v1.8.
- **Color palette picker** (choose a palette family — Blues / Viridis / Set2 / etc.) — defer; v1.7 ships one hardcoded palette per mode (sequential for numeric, qualitative for categorical).
- **WKB column "request feature support" UX** — current behavior is silent exclusion + inline message. No "request feature" CTA. Revisit if operators surface a use case.
- **Dataset MAX query for the last bucket's upper boundary display** — adds a Kinetica round-trip; planner recommended deferring. Empty + `≥ {prev}` hint suffices.
- **Inline preview of which rows will render with which colors** (mini-swatch row above the form) — visual aid; nice-to-have, not in Phase 39 scope. Phase 41 LayersLegendPanel ships the canonical legend view.
- **Auto-detect distinct-value column type via SAMPLE-based probe** (e.g., detect that a TEXT column is actually integer-stringified) — out of scope; column-type-based auto-detect from Kinetica's declared type is sufficient.
- **`@dnd-kit/core` integration audit** — planner verifies whether already in `package.json` before deciding drag-reorder inclusion.
- **`config.cbColumn` + `config.classbreaks[]` field cleanup migration** — Phase 38 LEAVES legacy fields on layer rows. v1.8 cleanup.

</deferred>

---

*Phase: 39-classbreak-form-ui-auto-suggest*
*Context gathered: 2026-05-21*
