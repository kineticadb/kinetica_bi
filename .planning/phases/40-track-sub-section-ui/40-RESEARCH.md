# Phase 40: Track Sub-Section UI - Research

**Researched:** 2026-05-21
**Domain:** React form sub-component (frontend-only) — track styling config UI inside KineticaWmsLayerForm
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Auto-detect + override checkbox semantics**: Three-state truth table — persisted `enabled` wins on load; auto-detect kicks in only for new layers (no persisted state). "(auto-detected)" hint is purely informational, never changes the `enabled` flag. Checkbox click flips `enabled` between true and false; sub-section visibility follows `enabled`.
- **Render-mode gating**: Sub-section renders when `renderMode === "raster" || renderMode === "classbreak"` AND `track_config.enabled === true`. Heatmap + contour exclude the sub-section. Flipping raster ↔ classbreak preserves state and visibility verbatim. Flipping to heatmap then back silently restores the sub-section.
- **Uncheck → preserve fields**: Unchecking the override checkbox flips `enabled` to false but preserves all other `track_config` fields verbatim. Re-checking restores them in-place.
- **Field layout**: Single-column semantic order: trackIdAttr → trackOrderAttr → headColor → headSize → headShape → trailColor → lineWidth (writes to trailSize).
- **Default values on first activate**: trackIdAttr from `isTrackTable.trackIdCol ?? "TRACKID"`, trackOrderAttr from `isTrackTable.orderCol ?? "TIMESTAMP"`, headColor `"FFFF0000"`, trailColor `"FF0000FF"`, headSize `8`, trailSize `2`, headShape `"circle"`. Applied independently per field — only undefined fields get seeded.
- **trackIdAttr + trackOrderAttr**: `<select className="ds-select">` dropdowns with `<option value="">— select —</option>`. trackIdAttr shows all non-spatial columns; trackOrderAttr shows ALL columns. Empty columns prop → dropdowns disabled.
- **Head shape enum**: Full 12-value POINT_SHAPES from `wmsUrlBuilder.ts:76-89` (none/circle/dash/diamond/dot/hollowcircle/hollowdiamond/hollowsquare/hollowsquarewithplus/pipe/plus/square). Default: `circle`. Phase 43 UAT validates each shape visually.
- **Color picker pattern**: Two-control AARRGGBB (color picker + text input) verbatim from raster `pointColor` at KineticaWmsLayerForm.tsx:572-599. Uses `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` from `colorHex.ts`.
- **Single 'Line width' field writes only to trailSize**: `lineWidth` on TrackConfig is a latent shim — Phase 40 form NEVER writes to it.
- **Number input ranges**: headSize 1–20 default 8; trailSize 1–20 default 2. Browser clamp via min/max attrs; additional clamp on blur via `Math.max(1, Math.min(20, value))`.
- **TRACK-V17-06 "deleting all values"**: Override checkbox is the sole control for `enabled`. Field-clearing leaves field as `undefined` in track_config; wmsUrlBuilder handles gracefully. No auto-disable on field clearing.
- **Persistence**: track_config flows through existing `onChange` chain → LayersModal save → PATCH (Phase 38 route). No new save mechanism.
- **Fingerprint**: Trust Phase 38's `lastEmittedParamsRef` already includes `t: layer.track_config`. No new fingerprint work; regression spec only.
- **No WKB gate**: Track detection is column-name-based, not column-type-based.
- **No `headShape='(none)'` special case**: headSize=0 is the no-marker control.
- **No auto-disable on field clearing**: Checkbox is sole enabled control.
- **No TRACKMARKERSHAPES vs TRACKHEADSHAPES resolution**: Phase 43 UAT handles it. Phase 40 trusts the HTTP-locked param name.

### Claude's Discretion

- **TrackSubSection file extraction**: Inline sub-component in KineticaWmsLayerForm.tsx (mirrors raster/heatmap/contour inline pattern) vs extracted to `components/charts/TrackSubSection.tsx` (mirrors Phase 39 CbConfigForm extraction). Planner picks based on test isolation needs + 1372-line host file bloat.
- **isTrackTable useEffect placement**: In host form (computes once, passes result down) or inside TrackSubSection (encapsulated). Planner picks. Inside sub-component is cleaner; host form may need the result for the override-checkbox `(auto-detected)` hint.
- **coalesceTrackConfig import path**: Re-export from `lib/wmsUrlBuilder.ts` (current source) or extract to a new `lib/trackConfig.ts`. Phase 40 is the 2nd consumer — planner extracts to `lib/trackConfig.ts` if it grows beyond ~30 lines, otherwise inline re-export.
- **Override checkbox placement**: Above the sub-section content inside the same config-group, or floating above as a peer header. Planner picks.
- **isTrackTable detection timing**: Columns prop arrives populated only after the table dropdown picks a table. useEffect dep must trigger on columns change, not on first mount.
- **`(auto-detected)` hint visual treatment**: Inline italic text after checkbox label vs a chip/badge. Planner picks.
- **Spec test surface**: New spec file `TrackSubSection.spec.tsx` (if extracted) OR new test blocks in `KineticaWmsLayerForm.spec.tsx` (if inline).

### Deferred Ideas (OUT OF SCOPE)

- Track-shape detection via Kinetica metadata
- Track shape aliases (track_id, lat/lon, time/ts)
- TRACKHEADSHAPES alternate-naming flag
- Per-shape spike re-test (Phase 43 UAT)
- Auto-disable when all fields blank
- '(none)' option for headShape
- Inline 'Clear all track styling' button
- Two-column 'Head | Trail' visual grouping
- lineWidth field as a separate input
- Smart column-type filtering on trackIdAttr dropdown
- 'Apply track styling to all layers' bulk operation
- Persisted N-column track layout
- Track preview thumbnail
- @dnd-kit/core drag-reorder for tracks
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRACK-V17-01 | `isTrackTable(columns)` fires from `useEffect([columns])`; when true, `trackConfig.enabled` defaults to false but sub-section appears | isTrackTable signature verified at `lib/trackDetect.ts:30`; returns `TrackColumns | null`; async-safe useEffect pattern established by Phase 39 probe patterns |
| TRACK-V17-02 | Override checkbox `[ ] Treat as track table` always visible; when auto-detected, pre-checked with "(auto-detected)" hint | Three-state truth table fully locked in CONTEXT.md; checkbox always rendered regardless of isTrackTable result |
| TRACK-V17-03 | Track sub-section appears when render mode = raster OR classbreak AND (isTrackTable OR operator-override) | Render-mode gating pattern mirrors `{renderMode === "classbreak" && <CbConfigForm ... />}` at line 896 |
| TRACK-V17-04 | Track inputs: trackIdAttr, trackOrderAttr, headColor, trailColor, headSize, trailSize, lineWidth, headShape | All 8 form fields locked with types, defaults, and ranges; POINT_SHAPES 12-value array verified at wmsUrlBuilder.ts:76-89 |
| TRACK-V17-05 | Under classbreak + track enabled, comma-separated TRACK_* emission per CB_VALS length | Phase 38 wmsUrlBuilder.ts:428-472 already handles this; Phase 40 form MUST NOT touch emission code; form only mutates track_config JSON |
| TRACK-V17-06 | Persistence: track_config round-trips through PATCH + dashboard load; "deleting all values" clears enabled to false | Override checkbox is sole enabled control; PATCH route extended in Phase 38; coalesceTrackConfig returns `{ enabled: false }` on null |
</phase_requirements>

## Summary

Phase 40 ships a single React form sub-component — `TrackSubSection` — that reads and writes `config.track_config` (a JSON string) through the existing `onChange` chain in `KineticaWmsLayerForm`. All server-side infrastructure (schema column, PATCH route, wmsUrlBuilder Track block, DashboardLayerDto extension, MapChartRenderer fingerprint) was fully completed in Phase 38. Phase 40 has zero server work.

The component follows the exact same extraction and state-management pattern as Phase 39's `CbConfigForm`. Key behaviors: auto-detect via `isTrackTable(columns)` in a `useEffect([columns])`, a three-state override checkbox, 7 form inputs (two column pickers, two AARRGGBB color pairs, two number inputs, one shape dropdown), state-preservation on render-mode flip and checkbox uncheck, and isValid always signals true (no required-completeness gate).

The primary planning risk is the 1372-line host file: extracting `TrackSubSection` to its own file (`components/charts/TrackSubSection.tsx`) is strongly recommended for spec isolation, following the Phase 39 CbConfigForm precedent. `coalesceTrackConfig` should be extracted to `lib/trackConfig.ts` since Phase 40 is the second consumer (Phase 38 decision: "Phase 40 may extract if a 2nd consumer surfaces").

**Primary recommendation:** Extract TrackSubSection to `components/charts/TrackSubSection.tsx` with a companion `TrackSubSection.spec.tsx`; extract `coalesceTrackConfig` + `TrackConfig` to `lib/trackConfig.ts` re-exporting from `wmsUrlBuilder.ts` for backward compat.

## Standard Stack

### Core
| Library/Module | Version/Location | Purpose | Why Standard |
|----------------|-----------------|---------|--------------|
| React (useState, useEffect, useCallback, useMemo) | Already in project | Component state, side effects, memoization | Project standard |
| `lib/trackDetect.ts:isTrackTable` | Phase 38 deliverable | Detects track-table column shape | Phase 40's primary auto-detect input |
| `lib/wmsUrlBuilder.ts:TrackConfig` | Phase 38 deliverable, lines 36-46 | TypeScript type for track_config | Already exported; Phase 40 imports |
| `lib/wmsUrlBuilder.ts:coalesceTrackConfig` | Phase 38 deliverable, lines 49-60 | Parse raw track_config JSON | Returns `{ enabled: false }` on null/parse-fail |
| `lib/wmsUrlBuilder.ts:POINT_SHAPES` | Phase 38 deliverable, lines 76-89 | 12-value shape enum for headShape dropdown | Same array as CB point shape picker |
| `lib/colorHex.ts` | Existing | normalizeAARRGGBB, rgbFromAARRGGBB, alphaFromAARRGGBB, joinAARRGGBB | Two-control AARRGGBB pattern |

### Supporting
| Library/Module | Location | Purpose | When to Use |
|----------------|----------|---------|-------------|
| `useToastStore.getState().showToast` | `store/toast.ts` | Error toasts for any error path | Error toast (kind: "error", "info", "permission") |
| `@testing-library/react` | Project test infra | Spec file rendering | Phase 40 spec (TrackSubSection.spec.tsx or KineticaWmsLayerForm.spec.tsx new blocks) |
| vitest | Project test infra | Unit test runner | Mirrors CbConfigForm.spec.tsx conventions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extracting to TrackSubSection.tsx | Inline in KineticaWmsLayerForm.tsx | Inline keeps code in one place but the host file is already 1372 lines and tests cannot isolate the sub-component cleanly |
| Extracting coalesceTrackConfig to lib/trackConfig.ts | Leaving inline in wmsUrlBuilder.ts | Phase 40 is the 2nd consumer (form reads it); extraction was explicitly deferred by Phase 38 CONTEXT.md "until a 2nd consumer surfaces" |

**Installation:** No new packages required. All dependencies are already in the project.

## Architecture Patterns

### Recommended Project Structure

```
kinetica_bi/src/
├── components/charts/
│   ├── KineticaWmsLayerForm.tsx      # host form — add TrackSubSection mount + import
│   ├── KineticaWmsLayerForm.spec.tsx # existing spec — may add regression test only
│   ├── TrackSubSection.tsx           # NEW — extracted sub-component (recommended)
│   └── TrackSubSection.spec.tsx      # NEW — companion spec file (recommended)
├── lib/
│   ├── trackDetect.ts                # Phase 38 deliverable — READ ONLY
│   ├── trackConfig.ts                # NEW — extract coalesceTrackConfig + TrackConfig here
│   ├── wmsUrlBuilder.ts              # Phase 38 deliverable — READ ONLY (Track block exists)
│   └── colorHex.ts                  # Existing — normalizeAARRGGBB etc.
```

### Pattern 1: TrackSubSection Props Shape (mirrors CbConfigForm)

```typescript
// Source: kinetica_bi/src/components/charts/CbConfigForm.tsx:44-54
type TrackSubSectionProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns: { name: string; type: string }[];
  isValid?: (valid: boolean) => void;
};
```

**Note**: Unlike CbConfigForm, TrackSubSection has NO schema/tableName/tableRef props (track_config needs no server calls). isValid always signals `true` (no required-completeness gate — Phase 40 CONTEXT.md).

### Pattern 2: coalesceTrackConfig read + patchTrack write (mirrors CbConfigForm patchCb)

```typescript
// Source: kinetica_bi/src/components/charts/CbConfigForm.tsx:108-114
// Mirror for TrackSubSection:
const trackConfig: TrackConfig = coalesceTrackConfig(
  (config.track_config as string | null) ?? null
);

const patchTrack = useCallback(
  (next: TrackConfig) => {
    onChange({ ...config, track_config: JSON.stringify(next) });
  },
  [config, onChange],
);
```

### Pattern 3: isTrackTable useEffect([columns]) with default seeding

```typescript
// First fires when columns populate (async after table select — not on mount with empty [])
useEffect(() => {
  const detected = isTrackTable(columns);
  // Only auto-enable on new layers (no persisted state)
  const hasPersistedState = (config.track_config as string | null) !== null;
  if (detected && !hasPersistedState) {
    patchTrack({
      enabled: true,
      trackIdAttr: detected.trackIdCol,
      trackOrderAttr: detected.orderCol,
      headColor: "FFFF0000",
      trailColor: "FF0000FF",
      headSize: 8,
      trailSize: 2,
      headShape: "circle",
    });
  }
}, [columns]);
// Note: patchTrack and config.track_config intentionally NOT in deps —
// tracks on columns-change only (same pattern as CbConfigForm cardinality probe)
```

### Pattern 4: Override checkbox three-state truth table

```typescript
// Checkbox click — flip enabled only, preserve all other fields
const onToggleEnabled = (checked: boolean) => {
  patchTrack({ ...trackConfig, enabled: checked });
};

// isTrackTable result drives (auto-detected) hint — computed via useMemo
const detectedColumns = useMemo(() => isTrackTable(columns), [columns]);

// Default seeding on enable: only seed undefined fields
const onEnableWithDefaults = (checked: boolean) => {
  if (!checked) {
    patchTrack({ ...trackConfig, enabled: false });
    return;
  }
  patchTrack({
    trackIdAttr: detectedColumns?.trackIdCol ?? "TRACKID",
    trackOrderAttr: detectedColumns?.orderCol ?? "TIMESTAMP",
    headColor: "FFFF0000",
    trailColor: "FF0000FF",
    headSize: 8,
    trailSize: 2,
    headShape: "circle",
    ...trackConfig,  // operator-set values override defaults
    enabled: true,
  });
};
```

### Pattern 5: AARRGGBB two-control (verbatim from KineticaWmsLayerForm.tsx:572-599)

```typescript
// Source: KineticaWmsLayerForm.tsx:572-599 (raster pointColor pattern)
// Phase 40 mirrors for headColor — replace config.pointColor with trackConfig.headColor:
<input
  type="color"
  className="config-color-picker"
  aria-label="Head color (RGB)"
  value={`#${rgbFromAARRGGBB(trackConfig.headColor || "FFFF0000")}`}
  onChange={(e) =>
    patchTrack({
      ...trackConfig,
      headColor: joinAARRGGBB(
        alphaFromAARRGGBB(trackConfig.headColor || "FFFF0000"),
        e.target.value.replace("#", ""),
      ),
    })
  }
/>
<input
  type="text"
  className="config-color-text"
  aria-label="Head color (AARRGGBB hex)"
  value={normalizeAARRGGBB(trackConfig.headColor || "FFFF0000")}
  onChange={(e) =>
    patchTrack({
      ...trackConfig,
      headColor: normalizeAARRGGBB(e.target.value, "FFFF0000"),
    })
  }
/>
```

### Pattern 6: Render-mode gate in KineticaWmsLayerForm (new mount point)

```typescript
// Source: KineticaWmsLayerForm.tsx:895-906 (CbConfigForm gate — Phase 40 adds BELOW this)
{/* ─── TRACK SUB-SECTION (Phase 40) ─────────────────────────── */}
{(renderMode === "raster" || renderMode === "classbreak") && (
  <TrackSubSection
    config={config}
    onChange={onChange}
    columns={columns ?? []}
    isValid={isValid}
  />
)}
```

**Important**: The Track sub-section gate is INDEPENDENT of the CbConfigForm gate. Both can render simultaneously (classbreak mode with track sub-section visible). The Track sub-section renders outside the `{renderMode === "classbreak" && ...}` block — it sits as a sibling block gated on raster OR classbreak.

### Pattern 7: Column picker dropdowns (mirrors CbConfigForm eligibility logic)

```typescript
// trackIdAttr — all non-spatial, non-WKB columns (mirrors CB attr picker minus WKB)
const trackIdColumns = columns.filter((c) => {
  const t = c.type.toLowerCase();
  // Exclude spatial-bound + WKB-binary columns
  return !spatialBound.has(c.name) && !t.includes("bytes") && !t.includes("wkb");
});

// trackOrderAttr — ALL columns (TIMESTAMP can be any orderable type)
const trackOrderColumns = columns;

<select
  className="ds-select"
  value={trackConfig.trackIdAttr ?? ""}
  disabled={columns.length === 0}
  onChange={(e) => patchTrack({ ...trackConfig, trackIdAttr: e.target.value || undefined })}
>
  <option value="">— select —</option>
  {trackIdColumns.map((c) => (
    <option key={c.name} value={c.name}>{c.name}</option>
  ))}
</select>
```

### Anti-Patterns to Avoid

- **Don't modify wmsUrlBuilder.ts Track block**: Phase 38 ships the full emission code at lines 428-472. Phase 40 form mutations flow through without form-side WMS code. READ ONLY.
- **Don't auto-disable based on field clearing**: TRACK-V17-06's "deleting all values" maps to checkbox uncheck. Individual field clearing leaves field as `undefined`; wmsUrlBuilder handles gracefully.
- **Don't reset track_config on render-mode flip to heatmap**: TRACK-V17-03 lock — preserve state silently.
- **Don't reset track_config on override-uncheck**: Only flip enabled to false; all other fields stay.
- **Don't hardcode "TRACKID" when isTrackTable has matched casing**: Use `isTrackTable(columns)?.trackIdCol ?? "TRACKID"` to preserve original column casing from the matched table.
- **Don't write to trackConfig.lineWidth**: Phase 40 form writes only to `trailSize`. lineWidth is a latent compatibility shim in the TypeScript type.
- **Don't add headShape='(none)' as a special form value**: headSize=0 is the no-marker control; headShape always has a value after auto-seeding.
- **Don't trust Phase 37's 4-shape spike set**: Phase 40 exposes all 12 POINT_SHAPES; Phase 43 UAT validates each visually.
- **Don't add new server vitest specs**: Phase 40 is frontend-only.
- **Don't extend lastEmittedParamsRef fingerprint**: Phase 38 already includes `t: layer.track_config` at MapChartRenderer.tsx:1118 and line ~1208. Regression test only.
- **Don't add WKB-column gate to track detection**: Column-name-based detection, not type-based.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse raw track_config JSON | Custom JSON.parse with error handling | `coalesceTrackConfig` from wmsUrlBuilder.ts (or lib/trackConfig.ts) | Returns `{ enabled: false }` on null/parse failure; already tested |
| Detect track table column shape | Column name matching logic | `isTrackTable` from lib/trackDetect.ts | Exact 4-name case-insensitive match already spec-tested (9 tests); handles casing preservation |
| Normalize AARRGGBB color input | Color parsing | `normalizeAARRGGBB` from lib/colorHex.ts | Handles leading #, lowercase, 6-char padding, fallback on invalid |
| Emit WMS TRACK_* params | Any URL-building in form layer | Trust wmsUrlBuilder.ts:428-472 | Already handles single-value (raster) and comma-sep (cb_raster) expansion |
| 12-value shape enum | Custom shape list | `POINT_SHAPES` from wmsUrlBuilder.ts | Already exported, already matches the raster pointShape picker |

**Key insight:** Phase 38 built all the infrastructure specifically for Phase 40 to consume. The form is pure UI plumbing — read TrackConfig via coalesceTrackConfig, patch via patchTrack(JSON.stringify), let wmsUrlBuilder and MapChartRenderer handle the rest.

## Common Pitfalls

### Pitfall 1: isTrackTable fires on initial mount with empty columns
**What goes wrong:** `useEffect([columns])` fires immediately on mount with `columns = []`; isTrackTable returns null (no data), and the auto-detect never re-fires when columns populate.
**Why it happens:** columns prop starts as `[]` (default value in KineticaWmsLayerForm:172 — `columns = []`) and only gets populated after the user selects a table in LayersModal.
**How to avoid:** The useEffect dep on `[columns]` is correct — it fires whenever columns changes. But the implementation must handle the empty-array case gracefully (isTrackTable returns null → no-op). No special "initial mount" guard needed; the useEffect will fire again when columns populate with data.
**Warning signs:** Auto-detect never activates even for valid track tables — check that the useEffect dep array includes `columns` (the array reference, not a derived primitive).

### Pitfall 2: Stale columns prop causes false-negative auto-detect on table switch
**What goes wrong:** After a table switch, columns prop briefly contains the old table's columns; isTrackTable returns the wrong result.
**Why it happens:** LayersModal clears columns and reloads them asynchronously after table change.
**How to avoid:** The `useEffect([columns])` pattern is correct here. When columns clears to `[]` between table switches, isTrackTable returns null and the auto-detect waits for the new table's columns to populate.

### Pitfall 3: Writing to trackConfig.lineWidth instead of trailSize
**What goes wrong:** The form writes to `lineWidth` field on TrackConfig instead of `trailSize`; wmsUrlBuilder emits TRACKLINEWIDTHS using `tc.trailSize ?? tc.lineWidth` so it works — but the Phase 40 CONTEXT.md explicitly locks 'Line width' writes to `trailSize` only.
**Why it happens:** TrackConfig has both `trailSize` and `lineWidth` fields; the lineWidth name matches the WMS param family.
**How to avoid:** Always write to `trailSize`. lineWidth is a latent compatibility shim — Phase 40 form never writes to it.

### Pitfall 4: Auto-seeding on every columns change instead of only on new layers
**What goes wrong:** Operator opens an existing layer with track_config saved; columns populate → isTrackTable returns truthy → useEffect auto-seeds, overwriting the operator's saved config.
**Why it happens:** Auto-seeding logic doesn't check whether a persisted state already exists.
**How to avoid:** Check `(config.track_config as string | null) !== null` before auto-seeding. If track_config is already set, respect it; auto-seed only when track_config is null (new layer path).

### Pitfall 5: Render-mode gate mounted inside raster/heatmap/classbreak individual gates
**What goes wrong:** If TrackSubSection is mounted inside `{renderMode === "raster" && ...}` AND `{renderMode === "classbreak" && ...}` separately, the component unmounts and remounts on mode switch, losing local state.
**Why it happens:** Duplicating the mount point to cover two render modes.
**How to avoid:** Gate with a single expression: `{(renderMode === "raster" || renderMode === "classbreak") && <TrackSubSection ... />}`. This is a single continuous mount; React preserves component state across raster ↔ classbreak switches.

### Pitfall 6: columns prop timing — TrackSubSection receives `columns` but KineticaWmsLayerForm passes `columns ?? []`
**What goes wrong:** The host form destructures `columns = []` (line 172), so TrackSubSection always receives a defined array. If the planner passes `columns={columns}` directly, the sub-component gets `[]` initially rather than `undefined`, which is fine — but the useEffect must handle `[]` correctly (see Pitfall 1).
**How to avoid:** Pass `columns={columns ?? []}` from the host to TrackSubSection. The host form already defaults `columns = []`.

### Pitfall 7: associatedTables in the host form
**What goes wrong:** The host form's CbConfigForm gate at line 903 uses `associatedTables.find(...)` which could fail if associatedTables is undefined.
**Why it happens:** The prop defaults to `[]` (line 181: `associatedTables = []`), so it's always defined. However, if Phase 40 TrackSubSection needs schema/table, it's NOT available in track form (no server calls needed).
**How to avoid:** TrackSubSection does NOT need associatedTables, schema, or tableName props. No server calls in track form.

## Code Examples

Verified patterns from official sources:

### coalesceTrackConfig (Phase 38 shipped, lines 49-60)

```typescript
// Source: kinetica_bi/src/lib/wmsUrlBuilder.ts:49-60
export function coalesceTrackConfig(raw: string | null): TrackConfig {
  if (raw === null) return { enabled: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "enabled" in parsed) {
      return parsed as TrackConfig;
    }
    return { enabled: false };
  } catch {
    return { enabled: false };
  }
}
```

**Validation**: `"enabled" in parsed` — only requires `enabled` key present; all other fields are optional.

### TrackConfig type (Phase 38 shipped, lines 36-46)

```typescript
// Source: kinetica_bi/src/lib/wmsUrlBuilder.ts:36-46
export type TrackConfig = {
  enabled: boolean;
  trackIdAttr?: string;
  trackOrderAttr?: string;
  headColor?: string;    // 8-char AARRGGBB
  trailColor?: string;   // 8-char AARRGGBB
  headSize?: number;
  trailSize?: number;    // emitted as TRACKLINEWIDTHS
  lineWidth?: number;    // alias for trailSize; trailSize takes precedence
  headShape?: string;
};
```

### isTrackTable signature (Phase 38 shipped)

```typescript
// Source: kinetica_bi/src/lib/trackDetect.ts:30
export function isTrackTable(columns: { name: string }[]): TrackColumns | null;
// Strict 4-name case-insensitive: TRACKID, x, y, TIMESTAMP. NO aliases.
// Extra columns silently ignored.
```

### POINT_SHAPES array (Phase 38 shipped, lines 76-89) — 12 values

```typescript
// Source: kinetica_bi/src/lib/wmsUrlBuilder.ts:76-89
export const POINT_SHAPES: PointShape[] = [
  "none", "circle", "dash", "diamond", "dot",
  "hollowcircle", "hollowdiamond", "hollowsquare", "hollowsquarewithplus",
  "pipe", "plus", "square",
];
```

**Verified**: KineticaWmsLayerForm.spec.tsx:201-214 confirms all 12 values are present in the raster pointShape picker.

### wmsUrlBuilder Track block emission (Phase 38 shipped — READ ONLY)

```typescript
// Source: kinetica_bi/src/lib/wmsUrlBuilder.ts:428-472
// Key emission lines:
params.DOTRACKS = "TRUE";
params.TRACK_ID_ATTR = tc.trackIdAttr ?? "TRACKID";
params.TRACK_ORDER_ATTR = tc.trackOrderAttr ?? "TIMESTAMP";
// Under cb_raster: expand to N = breaks.length; under raster: N = 1
const expand = (v: string): string => Array.from({ length: n }, () => v).join(",");
params.TRACKHEADCOLORS = expand(normalizeAARRGGBB(tc.headColor, "FFFF0000"));
params.TRACKLINECOLORS = expand(normalizeAARRGGBB(tc.trailColor, "FF0000FF"));
params.TRACKHEADSIZES = expand(String(tc.headSize));
const lineWidthVal = tc.trailSize ?? tc.lineWidth;  // trailSize takes precedence
params.TRACKLINEWIDTHS = expand(String(lineWidthVal));
params.TRACKMARKERSHAPES = expand(tc.headShape);
```

**Phase 40 insight**: wmsUrlBuilder already handles the expand(N) pattern for cb_raster. Phase 40 form only needs to write the single-value TrackConfig fields; emission handles the comma-sep expansion automatically.

### MapChartRenderer fingerprint (Phase 38 shipped — verify only)

```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx lines ~1118, ~1208
const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
```

**Phase 40 spec**: Assert that toggling `track_config.enabled` and editing `headColor` produce different fingerprint values. The `buildFingerprint` helper pattern from `MapChartRenderer.spec.tsx` (added in Phase 39 CB-V17-09) is the correct test approach.

### CbConfigForm.tsx patchCb pattern (Phase 39 precedent)

```typescript
// Source: kinetica_bi/src/components/charts/CbConfigForm.tsx:108-114
const patchCb = useCallback(
  (next: CbConfig) => {
    onChange({ ...config, cb_config: JSON.stringify(next) });
  },
  [config, onChange],
);
```

**Phase 40 mirrors**: `patchTrack(next: TrackConfig) => onChange({ ...config, track_config: JSON.stringify(next) })`

### KineticaWmsLayerForm CbConfigForm gate (the sibling pattern Phase 40 mirrors)

```typescript
// Source: kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:895-906
{renderMode === "classbreak" && (
  <CbConfigForm
    config={config}
    onChange={onChange}
    columns={columns}
    isValid={isValid}
    tableRef={(config.tableRef as string) || ""}
    schema={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.schema ?? "") : ""}
    tableName={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.name ?? "") : ""}
  />
)}
```

**Phase 40**: Add immediately below this block (or after the heatmap block):
```typescript
{(renderMode === "raster" || renderMode === "classbreak") && (
  <TrackSubSection
    config={config}
    onChange={onChange}
    columns={columns}
    isValid={isValid}
  />
)}
```

### Column type used in columns prop

```typescript
// Source: kinetica_bi/src/lib/columnTypes.ts (imported by KineticaWmsLayerForm.tsx:31)
// and CbConfigForm.tsx:24
export type Column = { name: string; type: string };
// The `columns` prop throughout this codebase is always Column[] or { name: string }[]
// isTrackTable accepts { name: string }[] (subset)
// filterCbEligibleColumns accepts { name: string; type: string }[]
// TrackSubSection should type its prop as Column[] to match host form
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy `config.classbreaks[]` + `config.cbColumn` in classbreak form | Phase 38 hard cutover to `cb_config` JSON on `dashboard_layers` | Phase 38 (2026-05-19) | Track form follows the same pattern: `track_config` JSON only |
| Single-value WMS params for all render modes | Comma-sep under cb_raster matching CB_VALS length | Phase 38 wmsUrlBuilder rewrite | Form writes single-value TrackConfig fields; wmsUrlBuilder expand handles the comma-sep |
| `ClassbreakParamsGroup` inline sub-component | Extracted `CbConfigForm.tsx` with companion spec | Phase 39 (2026-05-21) | Phase 40 should follow extracted-file pattern |
| `lastEmittedParamsRef` covers only wmsParams | Extended fingerprint `{ p, c, t }` with cb_config + track_config | Phase 38 MapChartRenderer extension | Phase 40 form edits automatically trigger re-render via existing fingerprint |

## Open Questions

1. **coalesceTrackConfig extraction to lib/trackConfig.ts**
   - What we know: Phase 38 kept TrackConfig + coalesceTrackConfig inline in wmsUrlBuilder.ts with the explicit note "Phase 40 may extract if a 2nd consumer surfaces." Phase 40 is the 2nd consumer (form reads it).
   - What's unclear: Whether the planner should extract just `coalesceTrackConfig` + `TrackConfig` type or also `PointShape` + `POINT_SHAPES` (which are already exported from wmsUrlBuilder.ts and used by the existing raster pointShape picker — moving them would break that import).
   - Recommendation: Extract ONLY `coalesceTrackConfig` + `TrackConfig` to `lib/trackConfig.ts`; leave `PointShape` + `POINT_SHAPES` in `wmsUrlBuilder.ts` (they serve the raster picker too). Re-export from wmsUrlBuilder.ts for backward compat.

2. **isValid always true vs validation gate**
   - What we know: CONTEXT.md says `isValid(true)` always since trackConfig has no required-completeness gate. The sub-section can render with all fields undefined and wmsUrlBuilder handles gracefully.
   - What's unclear: Should isValid prop even be included if it's always true? CbConfigForm uses isValid for breaks.length >= 2 gate.
   - Recommendation: Include `isValid` prop (call `isValid(true)` unconditionally in a useEffect), keeping the interface consistent with CbConfigForm. The parent won't be confused and no capability is lost.

3. **Override checkbox placement relative to sub-section inputs**
   - What we know: CONTEXT.md leaves this to the planner. The checkbox must always be visible; inputs only when enabled.
   - Recommendation: Place checkbox at the top of a single `config-group` block with aria-labelledby pointing to a "TRACK PARAMS" label. Inputs are children of the same group, conditionally rendered below. This matches the raster/heatmap/classbreak config-group pattern.

## Sources

### Primary (HIGH confidence)

- `kinetica_bi/src/lib/wmsUrlBuilder.ts:36-89` — TrackConfig type, coalesceTrackConfig, PointShape, POINT_SHAPES verified in source
- `kinetica_bi/src/lib/trackDetect.ts` — isTrackTable signature and implementation verified
- `kinetica_bi/src/lib/colorHex.ts` — normalizeAARRGGBB, rgbFromAARRGGBB, alphaFromAARRGGBB, joinAARRGGBB all verified
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:1-250,557-906` — host form structure, column types, CbConfigForm gate, raster AARRGGBB pattern verified
- `kinetica_bi/src/components/charts/CbConfigForm.tsx:1-140` — patchCb pattern, props shape, state management verified
- `kinetica_bi/src/lib/cbConfig.ts` — full content verified; shows Phase 39's cbConfig helpers for Phase 40 to mirror
- `.planning/phases/40-track-sub-section-ui/40-CONTEXT.md` — all implementation decisions and locked constraints
- `.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md` — confirmed isTrackTable + coalesceTrackConfig shipped
- `.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md` — confirmed wmsUrlBuilder Track block shipped at lines 428-472; fingerprint at 1118+1208
- `.planning/phases/39-classbreak-form-ui-auto-suggest/39-03-SUMMARY.md` — confirmed CbConfigForm ships pattern; 1131/1131 tests green
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — test conventions verified (vi.mock pattern, baseConfig, baseColumns, no makeLayer helper in this spec)

### Secondary (MEDIUM confidence)

- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` Track Probes section — HTTP-locked param names; visual deferred to Phase 43 UAT

### Tertiary (LOW confidence)

- None — all findings verified against source code or planning documents

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs verified in source files
- Architecture patterns: HIGH — mirrors Phase 39 CbConfigForm exactly; all patterns verified
- Pitfalls: HIGH — derived from actual code inspection and Phase 38/39 decision records
- Emission behavior: HIGH — wmsUrlBuilder Track block read directly (lines 428-472)

**Research date:** 2026-05-21
**Valid until:** Stable — Phase 40 is frontend-only; no external dependencies changed; all code inspected directly

---

*Phase: 40-track-sub-section-ui*
*Research: 2026-05-21*
