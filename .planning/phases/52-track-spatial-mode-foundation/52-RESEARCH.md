# Phase 52: Track Spatial Mode Foundation - Research

**Researched:** 2026-06-07
**Domain:** React form UI + TypeScript type extension + spatial mode routing
**Confidence:** HIGH — all findings derived from direct live-code reads of the files
named in the CONTEXT.md canonical refs. No speculation.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- "track" joins the LAYER-side spatial mode choices (picker shows lat/lon, WKT, WKB, Track).
- **Architecture boundary (Claude-locked from blast-radius scout):** the SHARED
  `SpatialMode = "latlon" | "wkt" | "wkb"` unions in `spatialTargets.ts`, server
  `spatialWhereClause.ts`, and server `spatialQuery.ts` stay UNTOUCHED — they are
  byte-parity wire contracts. Track is a layer-form concern; at the spatial-target and
  info-query boundaries a track layer TRANSLATES to the latlon path (lonCol=xCol,
  latCol=yCol). Whether the layer-side union extends `columnTypes.ts`'s SpatialMode or
  a new LayerSpatialMode type wraps it is planner/executor discretion — but zero server
  type changes.
- Column pickers: x (numeric only), y (numeric only), track ID (any non-geometry), ordering
  (timestamp/datetime/numeric). Defaults: track ID → TRACKID (case-insensitive); ordering →
  TIMESTAMP (case-insensitive). Missing defaults → picker starts EMPTY; form is invalid until
  all four are chosen.
- Table change re-runs auto-suggest and clears stale selections (Phase 28 lock: suggested
  mode always wins on table change).
- `autoSuggestSpatialMode`-family logic extends: table matching track shape (TRACKID + x + y
  + TIMESTAMP, case-insensitive) suggests Track mode for NEW layers / table changes. User can
  freely switch modes.
- Track layers ARE eligible spatial-filter targets — `isSpatialTargetEligible` treats a
  complete track config as eligible, emitting `{ spatialMode: "latlon", lonCol: xCol, latCol:
  yCol }` over the wire. Server untouched.
- Track layers participate in click fan-out via the latlon query path using x/y. Server
  untouched.
- **Old model removal:** Delete `TrackSubSection` + override checkbox + host-form gate.
  Stale `track_config` on any layer row is ignored without error (column stays in DB). NO
  reconfigure overlay, NO migration. (CUTOVER-V19-01 amended; overlay work is gone from
  Phase 53 too.)
- Keep `lib/trackConfig.ts` only if Phase 53's track params reuse its types/defaults;
  otherwise fold into the new model. Planner's call.

### Claude's Discretion
- Layer-side type shape (extend columnTypes SpatialMode vs LayerSpatialMode wrapper) — as
  long as wire contracts stay 3-mode.
- Where the four track columns persist in the layer row (likely the existing per-mode column
  fields + track_config or new fields — pick what round-trips cleanly through the PATCH route;
  server DashboardLayer type may need additive fields).
- Picker ordering/labels in the form; validation message wording.
- Spec organization (KineticaWmsLayerForm.spec extension vs new file).

### Deferred Ideas (OUT OF SCOPE)
- Per-track coloring (TRACK-V20-01), track live preview (TRACK-V20-02) — future.
- Render-mode narrowing, param surfaces, color picker, WMS emission locks — Phase 53 (not
  this phase).
- Reconfigure overlay — permanently descoped (zero usage).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRACKMODE-V19-01 | User can select Track as a spatial mode in the Map Layers form (alongside lat/lon, WKT, WKB) | Mode picker is driven by ALL_SPATIAL_MODES array + SPATIAL_MODE_LABELS record in KineticaWmsLayerForm.tsx:108–109; adding "track" to both arrays is the insertion point |
| TRACKMODE-V19-02 | Selecting Track reveals column pickers — x, y, track ID, ordering — with TRACKID/TIMESTAMP defaults when columns present | Pattern established by latlon pickers (lines 516–585); typed column filtering via getValidSpatialColumns reused for x/y (numeric); new typed-predicate helpers needed for track ID + ordering |
| TRACKMODE-V19-03 | Track mode is auto-suggested when table matches track column shape; user can freely switch | autoSuggestSpatialMode in columnTypes.ts:187–217 is the single extension point; isTrackTable predicate lives at packages/web/src/lib/trackDetect.ts and can be called directly |
| TRACKMODE-V19-04 | v1.7 track sub-section + override checkbox removed — mode picker is the single entry point | TrackSubSection.tsx is the DELETE target; KineticaWmsLayerForm.tsx:985–992 is the host-mount gate to remove; TrackSubSection.spec.tsx is the companion spec to delete |
</phase_requirements>

---

## Summary

Phase 52 is a focused TypeScript/React refactor of the WMS layer configuration form. The
four tasks are: (1) widen the layer-side SpatialMode union with a "track" literal; (2) add
four typed column pickers behind a `spatialMode === "track"` gate with TRACKID/TIMESTAMP
auto-defaults; (3) extend autoSuggestSpatialMode to detect the track column shape; (4) delete
the TrackSubSection component and its host-mount gate. The wire contracts are a zero-change
boundary — every spatial-filter and info-popup call site already speaks latlon natively;
track layers translate xCol/yCol to lonCol/latCol at those boundaries.

The key architectural finding is that `SpatialMode` has TWO separate declarations in the
codebase: one in `lib/columnTypes.ts` (layer-form–facing; used by KineticaWmsLayerForm,
LayersModal, autoSuggestSpatialMode, getValidSpatialColumns) and one in `lib/spatialTargets.ts`
(wire-contract–facing; byte-parity with the server; used by MapConfigPanel, MapChartRenderer's
spatial-filter path, InfoSelectionView, infoQuery). The CONTEXT decision is: only the
columnTypes.ts union widens. The spatialTargets.ts union and the server both stay at 3 modes.
This means isSpatialTargetEligible must translate "track" → latlon on the eligibility + emit
path, and isConfigComplete + buildSpatialColumns must handle "track" with xCol/yCol.

The column-persistence question resolves cleanly: reuse the existing `track_config` JSON
string column that already exists on `dashboard_layers`. The four track fields (xCol, yCol,
trackIdAttr, trackOrderAttr) can all live as a structured JSON object in `track_config`,
updating the TrackConfig type to include xCol/yCol. The `track_config` field already
round-trips through the PATCH route unchanged. Alternatively, the executor could store xCol in
lonColumn and yCol in latColumn (reusing the latlon fields); the planner should decide which is
cleaner (see Architecture Patterns §Persistence Decision below).

**Primary recommendation:** Widen only the columnTypes.ts SpatialMode union. Persist the four
track columns in `track_config` JSON (extend TrackConfig type). Translate track→latlon at the
three boundary sites (isConfigComplete, buildSpatialColumns, isSpatialTargetEligible).

---

## Standard Stack

No new npm dependencies. This is a pure TypeScript/React change within the existing monorepo.

### Core Files Changed
| File | Role | Change Type |
|------|------|-------------|
| `packages/web/src/lib/columnTypes.ts` | SpatialMode union + autoSuggestSpatialMode + getValidSpatialColumns | EXTEND union; extend autoSuggest |
| `packages/web/src/lib/trackDetect.ts` | isTrackTable predicate | REUSE as-is (already client-side) |
| `packages/web/src/lib/trackConfig.ts` | TrackConfig type + TRACK_DEFAULTS | EXTEND type with xCol/yCol fields |
| `packages/web/src/lib/spatialColumns.ts` | buildSpatialColumns — info-popup spatial routing | EXTEND for track branch |
| `packages/web/src/lib/wmsUrlBuilder.ts` | MapWidgetConfig type + buildWmsParams | EXTEND config type; spatial-mode branch adds track→latlon |
| `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` | Mode picker + per-mode pickers + TrackSubSection gate | EXTEND picker arrays; ADD track pickers; REMOVE TrackSubSection gate + import |
| `packages/web/src/components/charts/TrackSubSection.tsx` | v1.7 override checkbox UI | DELETE entirely |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | isConfigComplete + buildSpatialColumns call + info fan-out | EXTEND isConfigComplete; already calls buildSpatialColumns |
| `packages/web/src/lib/spatialTargets.ts` | isSpatialTargetEligible | EXTEND to handle "track" → eligibility via latlon translation |
| `packages/web/src/components/charts/MapConfigPanel.tsx` | SpatialMode labels record in target section | EXTEND SPATIAL_MODE_LABELS if the SpatialTarget union widens; otherwise NO CHANGE if SpatialTarget.spatialMode stays 3-mode |
| `packages/web/src/components/LayersModal.tsx` | handleTableChange autoSuggest call | UNCHANGED function body; autoSuggest internally extends |

### Files That Need No Direct Changes
| File | Why No Change |
|------|---------------|
| `packages/server/src/**` | Zero server changes — wire contracts untouched |
| `packages/web/src/api/client.ts` | `InfoSpatialMode = "latlon" \| "wkt" \| "wkb"` STAYS (wire contract); DashboardLayerDto.track_config already exists |
| `packages/web/src/components/charts/InfoSelectionView.tsx` | Already calls `buildSpatialColumns(cfg)` → returns latlon columns when track mode translates correctly |

---

## Architecture Patterns

### Pattern 1: SpatialMode Union — Two-Union Strategy (CRITICAL)

**What:** There are two separate `SpatialMode` type declarations, one per purpose:
- `lib/columnTypes.ts:155` — `"latlon" | "wkt" | "wkb"` — layer-form facing
- `lib/spatialTargets.ts:36` — `"latlon" | "wkt" | "wkb"` — wire-contract facing

**What changes:** Only `columnTypes.ts:155` widens to `"latlon" | "wkt" | "wkb" | "track"`.
The `spatialTargets.ts` union stays at 3 modes (server wire contract). This means
`MapWidgetConfig.spatialMode` (in `wmsUrlBuilder.ts:80`) also widens because it imports from
`columnTypes.ts`.

**Translation boundary:** At every site that sends SpatialMode over the wire or calls an API
expecting `InfoSpatialMode`, a track layer translates to `"latlon"` with `lonCol = xCol`,
`latCol = yCol`. The three translation sites are:

```typescript
// Site 1: buildSpatialColumns (lib/spatialColumns.ts)
// ADD before the final `return null`:
if (cfg.spatialMode === "track") {
  const tc = coalesceTrackConfig((cfg as any).track_config ?? null);
  if (!tc.xCol || !tc.yCol) return null;
  return { lonCol: tc.xCol, latCol: tc.yCol };
}

// Site 2: isConfigComplete (MapChartRenderer.tsx)
// ADD after wkb branch:
if (config.spatialMode === "track") {
  const tc = coalesceTrackConfig((config as any).track_config ?? null);
  return !!tc.xCol && !!tc.yCol && !!tc.trackIdAttr && !!tc.trackOrderAttr;
}

// Site 3: isSpatialTargetEligible (spatialTargets.ts) — AMENDED per CONTEXT decision
// track layers ARE eligible; translate to latlon:
if (target.spatialMode === "track") {
  return Boolean(target.lonCol) && Boolean(target.latCol);
  // caller must translate xCol→lonCol, yCol→latCol when building the SpatialTarget
}
```

**Note on spatialTargets.ts approach:** Since `SpatialTarget.spatialMode` stays 3-mode, the
MapConfigPanel auto-suggest for spatial-filter targets should translate "track" → build a
`SpatialTarget` with `spatialMode: "latlon"`, `lonCol: xCol`, `latCol: yCol`. The track layer
never appears with `spatialMode: "track"` inside a SpatialTarget. This is the cleaner approach
and avoids widening the wire-contract type. The planner must decide whether isSpatialTargetEligible
needs to change at all, or whether the translation happens upstream in MapConfigPanel when it
creates the SpatialTarget row.

### Pattern 2: Column Picker Structure (latlon precedent)

**What:** The latlon mode renders two `<select>` elements after the mode radio; WKT renders
one. The track mode will render four. All pickers use the same `validColumns` pattern
(filtered by type via getValidSpatialColumns for x/y; different predicates for trackId/ordering).

**Existing pattern (lines 516–585 of KineticaWmsLayerForm.tsx):**
```typescript
{spatialMode === "latlon" && (
  <>
    <label className="ds-field-label">
      Latitude column
      <select className="ds-select" value={(config.latColumn as string) || ""}
        onChange={(e) => onPickColumn("latColumn", e.target.value)}>
        <option value="">— select —</option>
        {validColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
    </label>
    {/* lon picker same pattern */}
  </>
)}
```

**Track mode new pickers follow the identical pattern:**
- x column → `getValidSpatialColumns(columns, "latlon")` (numeric only — latlon predicate
  is pure-numeric, which is correct for x/y track coords)
- y column → same
- track ID column → all non-geometry columns (needs new predicate or inline filter)
- ordering column → datetime/numeric columns (needs new predicate or inline filter)

**Typed column filtering for track ID and ordering:**

`getValidSpatialColumns` in columnTypes.ts handles "latlon" = numeric, "wkt" = string+geometry,
"wkb" = geometry. For track pickers, new column-filter helpers are needed:

```typescript
// In columnTypes.ts — ADD two helpers:

export function getTrackIdColumns(columns: Column[]): Column[] {
  // Any non-geometry column (string or numeric IDs both legitimate)
  return columns.filter((c) => !KINETICA_GEOMETRY_TYPES.has(normalizeType(c.type)));
}

export function getTrackOrderColumns(columns: Column[]): Column[] {
  // Timestamp/datetime/numeric columns
  return columns.filter((c) => {
    const t = normalizeType(c.type);
    return DATETIME_TYPES.has(t) || NUMERIC_TYPES.has(t);
  });
}
```

Note: `KINETICA_GEOMETRY_TYPES` is defined in `columnTypes.ts` but is not currently exported.
It must be made available to the filter helpers (or the helpers defined in-file).

### Pattern 3: autoSuggestSpatialMode Extension

**Existing function (columnTypes.ts:187–217):**
```typescript
export function autoSuggestSpatialMode(
  columns: Column[],
  options?: { preferWktOverWkb?: boolean },
): SpatialMode {
  // 1. Any geometry column → wkb (or wkt if preferWktOverWkb)
  // 2. WKT hint in type string → wkt
  // 3. lat + lon name match → latlon
  // 4. Fallback → latlon
}
```

**Extension strategy:** Track detection should be inserted BEFORE step 3 (name-based latlon),
because a track table with x/y columns would otherwise be detected as latlon. The isTrackTable
predicate already lives in `lib/trackDetect.ts` and is already imported by TrackSubSection.

```typescript
// INSERT before step 3 in autoSuggestSpatialMode:
const trackMatch = isTrackTable(columns);
if (trackMatch) return "track";
```

The return type of `autoSuggestSpatialMode` widens from `SpatialMode` (3-mode) to the new
4-mode type. All callers (LayersModal.handleTableChange, LayersModal.handleDataSourceChange,
MapConfigPanel target auto-suggest) receive the result and write it into layer.config.spatialMode
or SpatialTarget.spatialMode. For MapConfigPanel's SpatialTarget rows, the executor MUST
translate "track" → latlon at the point of SpatialTarget construction.

**Auto-defaults on track suggestion:** When autoSuggestSpatialMode detects a track table and
returns "track", the caller (LayersModal.handleTableChange) must also pre-fill track column
defaults. Currently handleTableChange only sets `spatialMode` in the cleared config. The new
behavior: when suggestedMode === "track" AND isTrackTable returns a match, also write the four
track fields into track_config (or into config keys — see Persistence section below).

### Pattern 4: Column Persistence — Concrete Recommendation

**Option A (Recommended): Reuse track_config JSON**

The `track_config` TEXT column already exists on `dashboard_layers` (db.ts:108). The
existing `TrackConfig` type in `lib/trackConfig.ts` has `trackIdAttr` and `trackOrderAttr`.
Add `xCol` and `yCol`:

```typescript
// lib/trackConfig.ts — ADD xCol + yCol:
export type TrackConfig = {
  enabled: boolean;      // NOTE: this field becomes semantically unused in v1.9;
                         // Phase 53 can remove it, or executor can leave it as a no-op
  xCol?: string;         // NEW: x/longitude column for track points
  yCol?: string;         // NEW: y/latitude column for track points
  trackIdAttr?: string;
  trackOrderAttr?: string;
  headColor?: string;
  trailColor?: string;
  headSize?: number;
  trailSize?: number;
  lineWidth?: number;
  headShape?: string;
};
```

**Round-trip:** KineticaWmsLayerForm reads `config.track_config` (a JSON string already
merged in by LayersModal at line 538). Pickers write back via `onChange({ ...config,
track_config: JSON.stringify(nextTrackConfig) })`. The `onPatch` PATCH call reads
`track_config` as a top-level layer field and sends it to `PATCH /api/layers/:id`
(server route at index.ts:661–667 accepts `track_config`). Zero server changes.

**Stale track_config on existing layers:** Old-model rows have track_config JSON with
`{ enabled: true, trackIdAttr, trackOrderAttr, ... }` but no `xCol`/`yCol`. These rows
render harmlessly — the new form shows empty x/y pickers (because `tc.xCol` is undefined,
the form is invalid but renders without error). CUTOVER-V19-01 says stale track_config is
ignored without error — this is naturally satisfied because `coalesceTrackConfig` returns
the parsed object as-is (Phase 52 executor adds no migration).

**Option B (Alternative): Store xCol in lonColumn, yCol in latColumn**

The existing `MapWidgetConfig` already has `lonColumn` and `latColumn` fields. When
spatialMode === "track", these could double as xCol/yCol. This avoids extending TrackConfig.
However, it leaks track semantics into latlon field names and is ambiguous to the reader.
**Recommendation: Option A.** Cleaner separation; `track_config` is already the track
namespace.

### Pattern 5: isValid Signaling

The existing `isValid` prop (optional callback) is called from two places in the form:
- `useEffect` on renderMode change (resets to true when switching away from classbreak)
- `CbConfigForm` calls `isValid(false)` when CB config is incomplete

For track mode, `isValid` must be called with `false` when any of the four pickers is empty,
and `true` when all four are filled. Pattern: `useEffect` on track column values:

```typescript
useEffect(() => {
  if (spatialMode !== "track") return;
  const tc = coalesceTrackConfig(config.track_config as string | null);
  const complete = !!tc.xCol && !!tc.yCol && !!tc.trackIdAttr && !!tc.trackOrderAttr;
  isValid?.(complete);
}, [spatialMode, config.track_config, isValid]);
```

**Important:** The existing `useEffect` at line 257–263 only resets isValid to true when
renderMode changes away from classbreak. A parallel effect for track completeness must not
collide. The safest approach: a single useEffect watching both spatialMode and track_config,
calling `isValid(complete)` when spatialMode === "track" and `isValid(true)` on switch-away.

### Pattern 6: Mode Switch Column Clearing

When the user switches from track to another mode, the existing `onSelectSpatialMode` handler
(line 272–285) clears latColumn/lonColumn/wktColumn/wkbColumn. It does NOT clear track_config.
For track mode, the executor should also clear track column fields from track_config on
mode-switch (or accept that stale track_config persists and is simply ignored when spatialMode
≠ "track"). Given that Phase 53 needs track_config for WMS emission, clearing it on
mode-switch would break re-selection of track mode. **Recommendation:** Do NOT clear
track_config on mode switch. The stale-field-on-switch pattern is already established (wkb
doesn't clear latColumn etc). The form simply ignores track_config when spatialMode ≠ "track".

### Pattern 7: WMS Emission — Phase 52 Must Not Break It

`buildWmsParams` in `wmsUrlBuilder.ts` has a track block at lines 425–458 gated on
`layerJsonFields?.track_config` AND `tc.enabled === true`. In Phase 52, track layers will have
`spatialMode === "track"` but the spatial-mode branch in buildWmsParams (lines 292–303) only
handles "latlon", "wkt", and the else-wkb fallback. The executor MUST add a "track" case:

```typescript
} else if (config.spatialMode === "track") {
  // Translate track x/y to WMS X_ATTR/Y_ATTR (same as latlon)
  const tc = coalesceTrackConfig(layerJsonFields?.track_config ?? null);
  if (tc.xCol) params[X_COLUMN_PARAM] = tc.xCol;
  if (tc.yCol) params[Y_COLUMN_PARAM] = tc.yCol;
}
```

This ensures Kinetica receives the correct spatial columns when rendering track tiles.
The track WMS emission block (DOTRACKS + TRACK_* params, lines 425–458) continues to fire
additively when `tc.enabled === true` — but in the new model `enabled` is irrelevant because
Phase 53 will gate DOTRACKS on spatialMode === "track" instead. For Phase 52, the track WMS
emission block will still fire from `tc.enabled` if old track_config rows exist, which is
harmless (operator confirmed zero live usage).

**Phase 53 concern flagged:** Phase 53 will need to change the WMS emission track block gate
from `tc.enabled === true` to `config.spatialMode === "track"`. Phase 52 must not change this
gate to avoid breaking the regression spec in `wmsUrlBuilder.spec.ts` (lines 781–843).

---

## SpatialMode Consumer Inventory

### Per-file verdict for track branching:

| File | Branch Needed? | What Changes |
|------|----------------|-------------|
| `lib/columnTypes.ts:155` | YES — widen union | `"latlon" \| "wkt" \| "wkb" \| "track"` |
| `lib/columnTypes.ts:187` (autoSuggest) | YES — extend | Insert track detection before name-based step 3 |
| `lib/columnTypes.ts:175` (getValidSpatialColumns) | YES — add helper | Add `getTrackIdColumns` + `getTrackOrderColumns` |
| `lib/spatialTargets.ts:36` (SpatialMode) | NO — stays 3-mode (wire contract) | |
| `lib/spatialTargets.ts:85` (isSpatialTargetEligible) | YES — translate track | Return `Boolean(target.lonCol) && Boolean(target.latCol)` for track (SpatialTarget built with lonCol=xCol, latCol=yCol by MapConfigPanel upstream) |
| `lib/spatialColumns.ts:21` (buildSpatialColumns) | YES — add track branch | Returns `{ lonCol: tc.xCol, latCol: tc.yCol }` when spatialMode === "track" |
| `lib/wmsUrlBuilder.ts:80` (MapWidgetConfig) | YES — already widens | MapWidgetConfig.spatialMode imports from columnTypes (widens automatically) |
| `lib/wmsUrlBuilder.ts:292` (spatial branch) | YES — add track case | Emit X_ATTR = tc.xCol, Y_ATTR = tc.yCol |
| `lib/trackConfig.ts` (TrackConfig) | YES — extend type | Add `xCol?` + `yCol?` fields |
| `lib/trackDetect.ts` (isTrackTable) | NO — already correct | Already client-side; already imported by TrackSubSection.tsx; reuse unchanged |
| `KineticaWmsLayerForm.tsx:108` (ALL_SPATIAL_MODES) | YES — add "track" | `["latlon", "wkt", "wkb", "track"]` |
| `KineticaWmsLayerForm.tsx:95` (SPATIAL_MODE_LABELS) | YES — add entry | `track: "Track (vessel/asset)"` (label wording is discretion) |
| `KineticaWmsLayerForm.tsx:292` (validColumns) | YES — add track columns | Separate column-set variables for each of the four track pickers |
| `KineticaWmsLayerForm.tsx:516–585` (per-mode pickers) | YES — add track block | Four pickers in a `{spatialMode === "track" && (...)}` gate |
| `KineticaWmsLayerForm.tsx:985–992` (TrackSubSection gate) | YES — DELETE | Remove the `(renderMode === "raster" \|\| renderMode === "classbreak")` gate and TrackSubSection mount |
| `KineticaWmsLayerForm.tsx:51` (TrackSubSection import) | YES — DELETE | Remove `import TrackSubSection from "./TrackSubSection"` |
| `MapChartRenderer.tsx:138` (isConfigComplete) | YES — add track branch | Return true when all four track fields present in track_config |
| `MapChartRenderer.tsx:1456` (buildSpatialColumns call) | NO CHANGE NEEDED | buildSpatialColumns already handles the translation via new track branch |
| `MapChartRenderer.tsx:1506` (infoQuery spatialMode cast) | YES — possible cast issue | `cfg.spatialMode as InfoSpatialMode` will fail TypeScript check if spatialMode === "track"; translate to "latlon" before the cast |
| `MapConfigPanel.tsx:60` (SPATIAL_MODE_LABELS) | CONDITIONAL — only if SpatialTarget section uses the widened union | If SpatialTarget.spatialMode stays 3-mode, MapConfigPanel's local SPATIAL_MODE_LABELS does not need "track" |
| `LayersModal.tsx:239` (handleTableChange autoSuggest) | INDIRECT — autoSuggest extends | handleTableChange uses the return value; must write xCol/yCol defaults into track_config when mode is "track" |
| `InfoSelectionView.tsx:212` (infoQuery spatialMode cast) | YES — same cast issue as MapChartRenderer | Translate track → "latlon" before cast |
| `api/client.ts:826` (InfoSpatialMode) | NO — stays 3-mode (wire) | |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Track column-shape detection | Custom isTrackTable reimplementation | `lib/trackDetect.ts:isTrackTable` — already client-side | Already exists; tested; 4-column strict match semantics match the requirement exactly |
| Numeric column filtering for x/y pickers | New NUMERIC_TYPES set | `getValidSpatialColumns(columns, "latlon")` — already returns numeric columns | latlon picker is purely numeric; track x/y are the same semantic; exact reuse |
| Track column defaults on auto-suggest | Custom default logic | `TrackColumns` return from isTrackTable provides `xCol`, `yCol`, `trackIdCol`, `orderCol` with original casing preserved | isTrackTable already returns the matched column names in original casing |
| isValid signaling | Custom validity store | Existing `isValid?.(bool)` prop callback on KineticaWmsLayerForm | Pattern established by CbConfigForm; Layer form host handles the disable/enable |
| Column picker rendering | Custom picker component | Standard `<select>` with `<option>` children (same as latlon/wkt/wkb pickers in the form) | Consistent with entire form; same CSS classes |

---

## Common Pitfalls

### Pitfall 1: TypeScript cast `cfg.spatialMode as InfoSpatialMode` fails for "track"
**What goes wrong:** MapChartRenderer.tsx:1506 and InfoSelectionView.tsx:212 both cast
`cfg.spatialMode as InfoSpatialMode`. Once SpatialMode widens to include "track", this cast
becomes unsafe — TypeScript may not catch it but at runtime "track" would be sent to
`infoQuery` which would confuse the server.
**How to avoid:** Before the cast, translate:
```typescript
const infoMode: InfoSpatialMode =
  cfg.spatialMode === "track" ? "latlon" : (cfg.spatialMode as InfoSpatialMode);
```
And use `infoMode` for the infoQuery call. The `spatialColumns` from `buildSpatialColumns`
already returns the correct latlon columns when track translates.

### Pitfall 2: autoSuggestSpatialMode returns "track" breaks MapConfigPanel SpatialTarget construction
**What goes wrong:** MapConfigPanel calls `autoSuggestSpatialMode(columns, { preferWktOverWkb: true })`
when adding a new spatial-filter target row (line 469). If it returns "track", the new
SpatialTarget is initialized with `spatialMode: "track"` — but SpatialTarget.spatialMode is
typed as `"latlon" | "wkt" | "wkb"`. TypeScript compile error.
**How to avoid:** In MapConfigPanel's SpatialTarget auto-suggest path, translate:
```typescript
const rawMode = autoSuggestSpatialMode(firstTableCols, { preferWktOverWkb: true });
const spatialMode: SpatialMode = rawMode === "track" ? "latlon" : rawMode;
```
AND also pre-populate lonCol/latCol from the track column match if rawMode was "track".

### Pitfall 3: ALL_SPATIAL_MODES array controls the picker render loop
**What goes wrong:** The spatial mode picker renders via `ALL_SPATIAL_MODES.filter(m => allowedSpatialModes.includes(m))`. The `allowedSpatialModes` is derived from `capabilities?.spatialModes ?? ALL_SPATIAL_MODES`. The WMS capabilities response (`spatialModes` field from server wmsCapabilities.ts) returns `["latlon", "wkt", "wkb"]` — it will NOT include "track". So if the filter is applied naively, "track" would be excluded when capabilities loads.
**How to avoid:** "track" is a LAYER FORM choice, not a Kinetica WMS mode. It must be
excluded from the capabilities gate, similar to how "classbreak" is excluded at line 609
(`if (m === "classbreak") return true`). Add: `if (m === "track") return true` in the
render mode filter equivalent for spatial modes.

### Pitfall 4: wmsUrlBuilder spatial-mode else-branch catches "track" as "wkb"
**What goes wrong:** The existing spatial branch is: `if latlon / else if wkt / else (wkb)`.
If "track" is not handled, it falls into the wkb else-branch and emits `GEO_ATTR` with
`config.wkbColumn` (which is empty for a track layer). The WMS request omits spatial columns
entirely → Kinetica renders nothing.
**How to avoid:** Add an explicit `else if (config.spatialMode === "track")` branch before the
wkb else (or restructure to avoid the fallthrough).

### Pitfall 5: Phase 40 TRACK-V17-03 specs in KineticaWmsLayerForm.spec.tsx will break on deletion
**What goes wrong:** The "Phase 40 TRACK-V17-03 mount-gate + state preservation" describe
block at KineticaWmsLayerForm.spec.tsx:972–1116 has 7 tests that assert the presence/absence
of "Treat as track table" checkbox. All 7 will fail once TrackSubSection is deleted.
**How to avoid:** Delete the entire TRACK-V17-03 describe block from the spec. Replace with
new track-mode picker assertions. The spec file has ~1120 lines total; the TRACK-V17-03 block
is the last describe block (lines 972–end approximately).

### Pitfall 6: LayersModal merges track_config into config blob — structure must be consistent
**What goes wrong:** LayersModal.tsx line 538 merges `track_config: selectedLayer.track_config`
into the config blob passed to KineticaWmsLayerForm. The form reads `config.track_config`.
If the track column fields (xCol, yCol) are stored elsewhere (e.g., lonColumn/latColumn),
the merged config would not carry them.
**How to avoid:** Ensure xCol and yCol are stored in track_config (Option A from Persistence
recommendation). Do not store them in lonColumn/latColumn (would conflict with the latlon mode's
meaning and would be cleared by mode-switch column clearing in `onSelectSpatialMode`).

### Pitfall 7: isConfigComplete falling through to "return false" for "track"
**What goes wrong:** isConfigComplete in MapChartRenderer.tsx:138–150 returns `false` for any
unrecognized spatialMode. If "track" is not added, all track layers are treated as
not-configured and skipped in WMS tile rendering (Effect 2) and info-popup fan-out (Effect 6).
**How to avoid:** Add the track branch to isConfigComplete before the final `return false`.

---

## Old-Model Deletion Inventory

### DELETE entirely:
| File | Lines | Notes |
|------|-------|-------|
| `packages/web/src/components/charts/TrackSubSection.tsx` | ALL | The entire file; 319 lines |
| `packages/web/src/components/charts/TrackSubSection.spec.tsx` | ALL | The entire file; 680 lines |

### DELETE within KineticaWmsLayerForm.tsx:
| What | Location | Notes |
|------|----------|-------|
| `import TrackSubSection from "./TrackSubSection"` | Line 51 | Remove import |
| `{(renderMode === "raster" \|\| renderMode === "classbreak") && (<TrackSubSection .../>)}` | Lines 985–992 | Remove the entire JSX block |

### DELETE within KineticaWmsLayerForm.spec.tsx:
| What | Location | Notes |
|------|----------|-------|
| `describe("Phase 40 TRACK-V17-03 mount-gate + state preservation", ...)` | Lines ~972–end | Remove the entire describe block (~144 lines); replace with new track-mode describe |

### SURVIVE (needed by Phase 53):
| File | What Survives | Why |
|------|--------------|-----|
| `lib/trackConfig.ts` | `TrackConfig` type, `coalesceTrackConfig`, `TRACK_DEFAULTS` | Phase 53 WMS emission still reads track_config JSON for DOTRACKS + TRACK_* params; the wmsUrlBuilder track emission block is Phase 53 territory |
| `lib/trackDetect.ts` | `isTrackTable` | Used by new autoSuggestSpatialMode extension and by the new track pickers |
| `lib/wmsUrlBuilder.ts` track emission block | Lines 425–458 (`if (layerJsonFields?.track_config)` block) | Phase 53 consumes; Phase 52 MUST NOT delete or change the gate condition |
| `wmsUrlBuilder.spec.ts` track tests | Lines 781–843 | Regression locks for track WMS emission; Phase 52 must not break these |

---

## Code Examples

### autoSuggestSpatialMode Extension Pattern
```typescript
// Source: packages/web/src/lib/columnTypes.ts (extend existing function)
// Import isTrackTable from "./trackDetect" at top of file

export function autoSuggestSpatialMode(
  columns: Column[],
  options?: { preferWktOverWkb?: boolean },
): SpatialMode {  // SpatialMode is now "latlon" | "wkt" | "wkb" | "track"
  const preferWkt = options?.preferWktOverWkb === true;

  const hasGeometry = columns.some((c) =>
    KINETICA_GEOMETRY_TYPES.has(normalizeType(c.type))
  );
  if (hasGeometry) return preferWkt ? "wkt" : "wkb";

  const hasWktHint = columns.some((c) =>
    c.type.toLowerCase().includes("wkt")
  );
  if (hasWktHint) return "wkt";

  // NEW: detect track column shape BEFORE latlon name heuristic
  // (track tables have x/y which would otherwise match the latlon heuristic)
  if (isTrackTable(columns)) return "track";

  const hasLat = columns.some((c) => /^(lat|latitude|y)$/i.test(c.name));
  const hasLon = columns.some((c) => /^(lon|lng|longitude|x)$/i.test(c.name));
  if (hasLat && hasLon) return "latlon";

  return "latlon";
}
```

### buildSpatialColumns Track Branch
```typescript
// Source: packages/web/src/lib/spatialColumns.ts (extend existing function)
import { coalesceTrackConfig } from "./trackConfig";

export function buildSpatialColumns(
  cfg: Partial<MapWidgetConfig>,
): SpatialColumns | null {
  if (cfg.spatialMode === "latlon") { /* ... */ }
  if (cfg.spatialMode === "wkt") { /* ... */ }
  if (cfg.spatialMode === "wkb") { /* ... */ }
  if (cfg.spatialMode === "track") {
    const tc = coalesceTrackConfig((cfg as any).track_config ?? null);
    if (!tc.xCol || !tc.yCol) return null;
    return { lonCol: tc.xCol, latCol: tc.yCol };
  }
  return null;
}
```

### LayersModal handleTableChange Extension (auto-seed track defaults)
```typescript
// Source: packages/web/src/components/LayersModal.tsx (extend existing handler)
const handleTableChange = (newTableId: number) => {
  if (!selectedLayer) return;
  const newTable = associatedTables.find((t) => t.id === newTableId);
  const newColumns = newTable
    ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
    : [];
  const suggestedMode = autoSuggestSpatialMode(newColumns);
  const cleared = { ...selectedLayer.config } as Record<string, unknown>;
  delete cleared.latColumn; delete cleared.lonColumn;
  delete cleared.wktColumn; delete cleared.wkbColumn;
  const nextConfig: Record<string, unknown> = {
    ...cleared,
    spatialMode: suggestedMode,
  };
  // NEW: auto-seed track_config defaults when track is suggested
  let trackConfigPatch: string | undefined;
  if (suggestedMode === "track") {
    const match = isTrackTable(newColumns);
    if (match) {
      const tc = coalesceTrackConfig(
        (selectedLayer.track_config as string | null) ?? null
      );
      trackConfigPatch = JSON.stringify({
        ...tc,
        xCol: match.xCol,
        yCol: match.yCol,
        trackIdAttr: match.trackIdCol,
        trackOrderAttr: match.orderCol,
      });
    }
  }
  onPatch(selectedLayer.id, {
    table_id: newTableId,
    dynamic_view_id: null,
    config: nextConfig,
    ...(trackConfigPatch !== undefined ? { track_config: trackConfigPatch } : {}),
  });
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1.7: TrackSubSection override checkbox, auto-detect, track_config.enabled = true | v1.9: "track" as spatial mode picker choice, four typed pickers, auto-suggest | Phase 52 | Single entry point; no duplicate checkbox ceremony |
| Spatial filter: track tables not eligible | v1.9: track layers eligible via latlon translation (xCol=lonCol, yCol=latCol) | Phase 52 CONTEXT amendment | Track layers can be used as spatial filter targets |
| Info popup: track layers not in fan-out | v1.9: track layers participate via latlon translation | Phase 52 CONTEXT amendment | Track layers can show info popups on click |

---

## Open Questions

1. **SpatialTarget widget for track layers in MapConfigPanel**
   - What we know: When a track layer exists, MapConfigPanel's spatial-target section should
     let the operator assign it as a target. The auto-suggest for SpatialTargets (line 469)
     calls autoSuggestSpatialMode which will now return "track" for track tables.
   - What's unclear: The SPATIAL_MODE_LABELS record in MapConfigPanel.tsx (line 60–64) shows
     mode labels for the SpatialTarget row's radio buttons. If track layers show up as
     SpatialTargets with `spatialMode: "latlon"` (translated at construction time), the UX
     makes sense. If they show up as "track", a new label is needed AND the SpatialTarget type
     widens (against wire contract). Translated approach is recommended but adds translation
     complexity at MapConfigPanel.
   - Recommendation: Translate at MapConfigPanel SpatialTarget construction. The resulting
     SpatialTarget has `spatialMode: "latlon"`, `lonCol: xCol`, `latCol: yCol`. No UI label
     needed for "track". This is the simplest path and keeps the wire contract clean.

2. **track_config enabled field meaning post-Phase-52**
   - What we know: `TrackConfig.enabled` was the gate for the old model. In Phase 52 the new
     gate is `spatialMode === "track"`. The enabled field becomes semantically irrelevant.
   - What's unclear: Should Phase 52 stop writing `enabled` to track_config, or leave it?
   - Recommendation: Leave `enabled` in the type and write it as `true` when saving track
     columns (for backward compatibility with the Phase 53 WMS emission block which still
     gates on `tc.enabled`). Phase 53 will change the gate. This avoids breaking the
     regression spec tests in wmsUrlBuilder.spec.ts during Phase 52.

---

## Sources

### Primary (HIGH confidence)
All findings are from direct reads of the live codebase. No external sources consulted
(this is a pure internal refactor with no external library changes).

- `packages/web/src/lib/columnTypes.ts` — SpatialMode union (line 155), autoSuggestSpatialMode
  (lines 187–217), getValidSpatialColumns (175–185), NUMERIC_TYPES/DATETIME_TYPES sets
- `packages/web/src/lib/spatialTargets.ts` — SpatialTarget type (49–55), isSpatialTargetEligible
  (85–94), both typed as 3-mode wire contract
- `packages/web/src/lib/spatialColumns.ts` — buildSpatialColumns (21–37) with 3 mode branches
- `packages/web/src/lib/wmsUrlBuilder.ts` — MapWidgetConfig (65–140), buildWmsParams spatial
  branch (292–303), track emission block (425–458)
- `packages/web/src/lib/trackConfig.ts` — TrackConfig type (14–24), coalesceTrackConfig
  (27–38), TRACK_DEFAULTS (50–56)
- `packages/web/src/lib/trackDetect.ts` — isTrackTable (30–41), TrackColumns type (13–22) —
  already client-side (NOT server-only as CONTEXT.md partially implied)
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` — ALL_SPATIAL_MODES (line 108),
  SPATIAL_MODE_LABELS (95–99), mode picker render (496–508), latlon pickers (516–585), TrackSubSection
  gate (985–992)
- `packages/web/src/components/charts/TrackSubSection.tsx` — full component (319 lines) — DELETE target
- `packages/web/src/components/charts/MapChartRenderer.tsx` — isConfigComplete (138–150),
  fingerprint includes track_config (1190), buildSpatialColumns call (1456), infoQuery fan-out (1500–1515)
- `packages/web/src/components/charts/InfoSelectionView.tsx` — infoQuery calls with
  `cfg.spatialMode as InfoSpatialMode` (lines 212, 286)
- `packages/web/src/components/charts/MapConfigPanel.tsx` — SpatialTarget auto-suggest (469–540),
  SPATIAL_MODE_LABELS (60–64)
- `packages/web/src/components/LayersModal.tsx` — handleTableChange (233–256), track_config merge
  (line 538), autoSuggestSpatialMode call (line 239)
- `packages/server/src/types.ts` — DashboardLayer type (61–93) — track_config TEXT NULL (line 90)
- `packages/server/src/db.ts` — updateDashboardLayer accepts track_config (606), mapDashboardLayer
  (315–334), PATCH route (index.ts:661–667)
- `packages/web/src/api/client.ts` — InfoSpatialMode = "latlon" | "wkt" | "wkb" (line 826) — STAYS
- `packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx` — TRACK-V17-03 describe
  block at ~line 972 (7 tests to delete)
- `packages/web/src/components/charts/TrackSubSection.spec.tsx` — 680 lines to delete entirely
- `packages/web/src/lib/wmsUrlBuilder.spec.ts` — track emission tests (lines 781–843) — MUST NOT BREAK

---

## Metadata

**Confidence breakdown:**
- SpatialMode consumer inventory: HIGH — all files read directly
- Persistence recommendation (track_config): HIGH — db.ts + types.ts + PATCH route all confirmed
- Auto-suggest extension pattern: HIGH — isTrackTable already client-side; insertion point clear
- TrackSubSection deletion inventory: HIGH — all three deletion sites pinpointed with line numbers
- Spec impact: HIGH — spec files read directly; break sites identified

**Research date:** 2026-06-07
**Valid until:** N/A — internal codebase; valid until files change
