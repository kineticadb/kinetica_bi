# Phase 39: Classbreak Form UI + Auto-Suggest — Research

**Researched:** 2026-05-21
**Domain:** React form UI within KineticaWmsLayerForm — classbreak sub-component replacing legacy ClassbreakParamsGroup
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Form integration:** DELETE `ClassbreakParamsGroup` (lines 180–440) + `ClassbreakBreak` type. CREATE `CbConfigForm` sub-component reading/writing `config.cb_config` via `coalesceCbConfig`. Gate: `{renderMode === 'classbreak' && <CbConfigForm ... />}`.
- **Render-mode picker:** `RenderMode` TypeScript union stays at 4 values. Picker filters `ALL_RENDER_MODES` to show only Raster + Heatmap + Class Break (contour hidden). `RENDER_MODE_LABELS.classbreak = "Classbreak (categorical)"` stays; planner uses existing constant.
- **CB column eligibility filter:** INCLUDE numeric + string types; EXCLUDE `type.includes("bytes")` or `type.includes("wkb")` case-insensitive; EXCLUDE columns already bound to spatial config fields.
- **Column-change behavior:** Preserve row count + colors + labels + advanced fields by index; CLEAR/RE-BLANK `breaks[].value` based on new column's auto-detected `valsType`; auto-flip `valsType` unless advanced force-categorical override is checked.
- **valsType override:** Hidden `[▸ Advanced]` chevron at form level reveals `[ ] Treat numeric column as categorical` checkbox. Only meaningful when column is numeric.
- **Cardinality probe:** Categorical only. `probeCardinality(tableRef, column, signal)` on CB column pick. Warn at >100 (`"permission"` toast), hard-cap at >256 (`"error"` toast). Disable `[+ Add break]` when over cap.
- **`<other>` bucket:** Checkbox above rows, default ON for categorical. Auto-maintain `<other>` row at end of `breaks[]`. Read-only chip for `value` field. Warning when OFF: "NULL values will not appear in the map."
- **Numeric UX:** `<input type="number">` for value; placeholder "Upper boundary". No range validation on value.
- **Categorical UX:** `<input type="text">` for value. Validation BEFORE save: reject empty values, warn on duplicate values. Form stores raw input; wmsUrlBuilder escapes at emission time.
- **Per-row label field:** Text input alongside color picker. Stored in `cb_config.breaks[].label`. Empty label is valid.
- **Per-row advanced chevron:** 5 fields — pointSize (1–20, default 5), pointShape (circle/square/diamond/triangle, default circle), shapeLineWidth (1–20, default 1), shapeLineColor (AARRGGBB, default FF000000), shapeFillColor (AARRGGBB, default FFFFFFFF). EVERY advanced field always has a valid default on row create. Form clamps invalid inputs.
- **Advanced reveal state:** Per-row, per-session. NOT persisted to cb_config.
- **New-row defaults:** `value: valsType === "numeric" ? 0 : ""`, color from `PALETTE_COLORS[index % len]`, label `""`, pointSize 5, pointShape `"circle"`, shapeLineWidth 1, shapeLineColor `"FF000000"`, shapeFillColor `"FFFFFFFF"`.
- **Auto-suggest N slider range:** 2–16 (UI cap, tighter than server 2–256). Default 5. Numeric mode only. Session-only persistence.
- **Auto-suggest flow:** Validate column selected + numeric → if `breaks.length > 0` show modal-confirm → call `quantileFn` → on success replace rows (N rows: N-1 boundaries from server + 1 final row with empty value + `≥ {prev}` hint) → preserve colors/advanced by index → on failure: inline red text + `"error"` toast.
- **Error UX:** Auto-suggest failure = inline red text + toast. Categorical validation failure = inline red text only (no toast). WKB rejection = inline gray hint (no toast).
- **Save flow:** Follows existing `KineticaWmsLayerForm` onChange chain → LayersModal onPatch → 300ms debounce → `PATCH /api/dashboards/:id/layers/:layerId`. cb_config propagates as `JSON.stringify(newCbConfig)` via `onChange({ ...config, cb_config: JSON.stringify(newCbConfig) })`.
- **Hard cutover:** NEVER read/write legacy `config.cbColumn` / `config.classbreaks[]`. Phase 39 form touches only `config.cb_config`.
- **No Zod:** TypeScript types + JSON.parse at boundary only.
- **Toast kinds available:** `"permission"` | `"info"` | `"error"` (NO `"warning"`).
- **Fingerprint (CB-V17-09):** TRUST Phase 38's `lastEmittedParamsRef` — already serializes `{ p: wmsParams, c: layer.cb_config, t: layer.track_config }`. Phase 39 mutates `cb_config` via the existing onChange chain; no new fingerprint work needed.
- **WKB-column exclusion (CB-V17-08):** Exclude from CB attr picker. Inline message "WKB columns not supported for classbreak in v1.7".
- **No drag-reorder mandate:** Defer if `@dnd-kit/core` not already in `package.json`.

### Claude's Discretion

- **Default color palette:** Planner picks 8–10 hex codes. Suggested: ColorBrewer "Blues" sequential for numeric, "Set2" qualitative for categorical. Hardcoded in `CbConfigForm.tsx` or extracted to `lib/cbPalette.ts`.
- **`CbConfigForm` file extraction:** Inline in `KineticaWmsLayerForm.tsx` (mirrors ClassbreakParamsGroup pattern) vs extracted to `components/charts/CbConfigForm.tsx`.
- **Modal-confirm component reuse:** Identify whether a shared portal modal exists or build inline-portal. No new dependency.
- **`PALETTE_COLORS` constant placement:** `CbConfigForm.tsx` vs `lib/cbConfig.ts`. If Phase 41 reuses it, `lib/cbConfig.ts` preferred.
- **Per-row advanced reveal state storage:** `useState<Set<number>>(new Set())` vs `useState<Record<number, boolean>>({})`.
- **Last bucket value semantics:** Empty value + `≥ {prev}` hint (recommended — no extra round-trip) vs dataset MAX via follow-up query.
- **Slider component:** Native `<input type="range">` vs styled custom (check if spatialFilterBar slider exists).
- **Spec test surface:** Replace all ClassbreakParamsGroup-targeted tests; build new CbConfigForm coverage.

### Deferred Ideas (OUT OF SCOPE)

- Drag-reorder of break rows (unless @dnd-kit/core already present)
- Equal-interval / Jenks Natural Breaks / Manual quantile method picker
- Auto-suggest preview-before-commit
- Persist N slider value to cb_config
- CB_LABELS WMS param emission
- Bulk per-row advanced edit
- Color palette picker (palette family chooser)
- Dataset MAX query for last bucket upper boundary display
- Inline preview mini-swatch row above the form
- Auto-detect distinct-value column type via SAMPLE-based probe
- @dnd-kit/core integration audit (planner verifies, but feature is deferred)
- config.cbColumn + config.classbreaks[] field cleanup migration (v1.8)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CB-V17-01 | KineticaWmsLayerForm render-mode picker gains "Class Break" as a third visible option | Existing `ALL_RENDER_MODES` + `RENDER_MODE_LABELS` constants; planner filters to 3 user-facing modes by changing the `.filter()` predicate at line 806 |
| CB-V17-02 | CB column picker with type detection — column dropdown drives numeric vs categorical valsType; auto-default; operator can override | `cbEligibleColumns` filter pattern already exists in ClassbreakParamsGroup (lines 262–272); new CbConfigForm extends with WKB exclusion + spatial-col exclusion + auto-detection logic |
| CB-V17-03 | Numeric breaks UX — N-row builder with value/color/label; add/remove rows; 256 hard-cap from v1.2 | New CbConfigForm with `cb_config.breaks[]`; same row-builder CTA pattern as ClassbreakParamsGroup |
| CB-V17-04 | Categorical breaks UX — text-value rows; `<other>` bucket toggle; distinct-value probe; warn + cap at 256 | `probeCardinality` helper re-used verbatim; `<other>` row managed by form; wmsUrlBuilder emits `<other>` verbatim |
| CB-V17-05 | Per-break label field — text input alongside color picker; persisted in `cb_config.breaks[].label`; surfaced by legend | `CbBreak.label?: string` is already in the shipped `lib/cbConfig.ts` type |
| CB-V17-06 | Auto-suggest button — calls `POST /api/quantile` with column + N; replaces rows; confirm if rows exist | `quantileFn` from `client.ts:1074` already ships; N slider at 2–16; modal-confirm inline pattern identified |
| CB-V17-07 | Advanced per-row params (optional expand-on-click) — pointSize/pointShape/shapeLineWidth/shapeLineColor/shapeFillColor | `CbBreak` type already has all 5 optional fields; color picker + text input idiom from raster pointColor section (lines 832–859) |
| CB-V17-08 | WKB column gate — CB attr picker excludes WKB-binary columns; inline message | Eligibility filter in new CbConfigForm; column type check `type.toLowerCase().includes("bytes") || type.toLowerCase().includes("wkb")` |
| CB-V17-09 | Form-to-URL fingerprint — `lastEmittedParamsRef` covers all CB_* params | CONFIRMED SHIPPED in Phase 38-02: fingerprint = `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })`; Phase 39 has zero fingerprint work |

</phase_requirements>

---

## Summary

Phase 39 is a frontend-only form UI phase with zero server changes. All Phase 38 infrastructure (schema migration, CRUD routes, wmsUrlBuilder Lane C rewrite, cbConfig helpers, quantileFn client helper, fingerprint extension) is verified shipped and working. The task is to DELETE the legacy `ClassbreakParamsGroup` sub-component (lines 180–440 of `KineticaWmsLayerForm.tsx`) and replace it with a new `CbConfigForm` sub-component that reads/writes `config.cb_config` via `coalesceCbConfig`.

The primary integration challenge is wiring `schema` + `table` (needed for `quantileFn` and `probeCardinality`) from the `layer` prop + `associatedTables` prop into the new sub-component. The existing form already has `layer?: DashboardLayerDto` and `associatedTables?: TableDto[]` as props, so schema+table can be derived at form level: `const table = associatedTables.find(t => t.id === layer?.table_id)` gives `{ schema, name }`. The sub-component should receive these as props or derive them from `config.tableRef` (which ClassbreakParamsGroup used via `config.tableRef` already stored as `"schema.table"` in the config blob).

The modal-confirm for Auto-suggest overwrite does NOT have a shared portal component — the pattern in LayersModal.tsx and DynamicViewsModal.tsx is inline conditional rendering (see `confirmDeleteId` state in LayersModal, and the `[Delete layer] [Keep layer]` buttons appearing in-place). Phase 39's confirm-overwrite dialog follows the same inline pattern, not a portal. The modal-overlay CSS class (`modal-overlay`, `modal-content`) wraps the outer LayersModal; Phase 39's confirm is a smaller inline overlay within the CbConfigForm section.

**Primary recommendation:** Extract `CbConfigForm` into `kinetica_bi/src/components/charts/CbConfigForm.tsx` (not inline) because the form is ~300–400 lines and test isolation benefits from a dedicated spec file. Place `PALETTE_COLORS` in `lib/cbConfig.ts` (anticipating Phase 41 reuse). Use `useState<Set<number>>` for advanced-reveal. Use native `<input type="range">` for N slider (ZoomRangeSlider is a dual-handle custom component; the N slider is single-handle and native suffices).

---

## Standard Stack

### Core (all already in the project — zero new dependencies)

| Library / Module | Location | Purpose in Phase 39 |
|---------|---------|--------------|
| `lib/cbConfig.ts` | `kinetica_bi/src/lib/cbConfig.ts` | `CbBreak`, `CbConfig`, `EMPTY_CB_CONFIG`, `coalesceCbConfig`, `isCbConfigConfigured`, `isNumericValsType`, `isCategoricalValsType` |
| `api/client.ts` | line 1074 | `quantileFn(args, signal): Promise<{breaks: number[]}>` — Auto-suggest HTTP call |
| `lib/colorHex.ts` | `kinetica_bi/src/lib/colorHex.ts` | `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` — per-row color picker |
| `lib/cardinalityProbe.ts` | `kinetica_bi/src/lib/cardinalityProbe.ts` | `probeCardinality(tableRef, column, signal?)` — categorical mode cardinality gate |
| `store/toast.ts` | `kinetica_bi/src/store/toast.ts` | `useToastStore.getState().showToast(msg, kind)` — cardinality warnings + Auto-suggest errors |
| `KineticaWmsLayerForm.tsx` | `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` | Host file; lines 180–440 deleted; line 806 filtered; line 1156 gate swapped |
| React (built-in hooks) | — | `useState`, `useEffect`, `useRef`, `useCallback` — local state machine in CbConfigForm |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dnd-kit/core` | NOT in package.json (confirmed absent) | Drag-reorder of break rows | DEFERRED — not in codebase, drag-reorder is explicitly deferred to v1.8 |
| `ZoomRangeSlider` | local component | Dual-handle slider | NOT used in Phase 39 — N slider is single-handle, use native `<input type="range">` |

**Installation:** No new packages required.

---

## Architecture Patterns

### Existing Code to Modify (Exact Locations)

#### KineticaWmsLayerForm.tsx — 4 surgical changes

| Change | Lines | What |
|--------|-------|------|
| DELETE | 93 + 180–428 | `ClassbreakBreak` type declaration (line 93) + entire `ClassbreakParamsGroup` function (lines 180–428) |
| FILTER | 806 | `ALL_RENDER_MODES.filter(...)` — add `m !== "contour"` to the existing filter predicate so contour is removed from the picker |
| SWAP gate | 1156–1163 | Replace `<ClassbreakParamsGroup config={config} onChange={onChange} columns={columns} isValid={isValid} />` with `<CbConfigForm ... />` with appropriate props |
| EXTEND validity gate | 466–471 | The existing `useEffect` only resets validity on renderMode change. May need to also signal `isValid(cbConfig.breaks.length >= 2)` when renderMode === "classbreak" AND breaks change. CbConfigForm's own `isValid` signaling handles this; the top-level effect just resets on mode switch away (already correct). |

#### Render-mode picker filter

The current code at line 806:
```typescript
{ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m)).map((m) => (
```

Phase 39 adds a second filter clause: `&& m !== "contour"` — the `contour` mode stays in `ALL_RENDER_MODES` but is no longer shown in the picker:
```typescript
{ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m) && m !== "contour").map((m) => (
```

IMPORTANT: The existing spec at line 89–90 asserts `"Classbreak (categorical)"` and `"Contour (lines)"` are both rendered. The spec that checks `"Contour (lines)"` must be updated to expect it NOT to appear in the picker.

#### CbConfigForm Props Design

The new sub-component needs these props (mirrors ClassbreakParamsGroupProps but adds Phase 39 fields):

```typescript
type CbConfigFormProps = {
  // Existing config blob — CbConfigForm reads config.cb_config + patches it
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  // Column list for the CB attr dropdown (same prop passed to KineticaWmsLayerForm)
  columns: Column[];
  // Validity signal — fires isValid(breaks.length >= 2 && all values non-empty)
  isValid?: (valid: boolean) => void;
  // For probeCardinality and quantileFn — derived from layer + associatedTables
  // Planner choice: pass tableRef: string (already stored in config.tableRef as "schema.table")
  // OR pass schema: string + table: string as separate props
  // RECOMMENDED: pass tableRef (already present in config.tableRef; ClassbreakParamsGroup used this)
  // AND pass schema + table separately for quantileFn (needs schema+table split)
  tableRef?: string;      // "schema.table" for probeCardinality
  schema?: string;        // for quantileFn
  tableName?: string;     // for quantileFn
};
```

**Key finding:** `tableRef` is already stored in `config.tableRef` as a `"schema.table"` string (set by `ChartConfigPanel` at layer creation time, and persisted in `layer.config`). The existing `ClassbreakParamsGroup` reads it at line 198: `const tableRef = (config.tableRef as string) || ""`. For `probeCardinality`, `tableRef` suffices directly. For `quantileFn`, the component needs `schema` + `table` split (the endpoint takes them separately). The planner can either:
- Split `config.tableRef` at the `.` separator inside CbConfigForm (fragile if schema name contains `.`)
- Pass `schema` + `tableName` as separate CbConfigForm props, derived from `associatedTables.find(t => t.id === layer?.table_id)` at the KineticaWmsLayerForm level

**Recommended:** Derive from `associatedTables` at the KineticaWmsLayerForm level and pass as separate props. `associatedTables` and `layer` are already props on `KineticaWmsLayerForm`. This is cleaner than splitting `tableRef` at the `.` character.

```typescript
// Derived at KineticaWmsLayerForm render time, before passing to CbConfigForm:
const cbTable = layer ? associatedTables.find((t) => t.id === layer.table_id) : undefined;
const cbSchema = cbTable?.schema ?? "";
const cbTableName = cbTable?.name ?? "";
```

### cb_config Propagation Pattern

The form never stores cb_config as React state — it reads from `config.cb_config` (JSON string), deserializes via `coalesceCbConfig`, mutates the parsed `CbConfig` object, re-serializes, and calls `onChange`. This is the locked immutable-patch pattern:

```typescript
// Read at form top:
const cbConfig: CbConfig = coalesceCbConfig((config.cb_config as string | null) ?? null);

// On any mutation:
const next: CbConfig = { ...cbConfig, breaks: [...] };
onChange({ ...config, cb_config: JSON.stringify(next) });
```

Each field edit calls `onChange` → `onPatch(layerId, { config: nextConfig })` → 300ms debounce → `PATCH /api/dashboards/:id/layers/:layerId`. The `lastEmittedParamsRef` fingerprint then detects the `cb_config` change → triggers tile re-render. This entire pipeline is confirmed working (Phase 38 ships and tests it).

### Modal-Confirm Pattern (inline, no shared portal)

There is NO shared portal `<Modal />` component in the codebase. Both `LayersModal.tsx` and `DynamicViewsModal.tsx` implement confirmations as inline conditional rendering. For example, `LayersModal.tsx` uses `confirmDeleteId` state and renders `[Delete layer] [Keep layer]` buttons in-place when `isConfirming === true`.

Phase 39 Auto-suggest overwrite confirm is an inline overlay within the CbConfigForm section:

```typescript
const [showAutoSuggestConfirm, setShowAutoSuggestConfirm] = useState(false);

// When confirm needed:
if (cbConfig.breaks.length > 0) {
  setShowAutoSuggestConfirm(true);
  return; // don't fire yet
}
await runAutoSuggest();

// In JSX:
{showAutoSuggestConfirm && (
  <div className="cb-autosuggest-confirm" role="dialog" aria-modal="true">
    <p>Replace {cbConfig.breaks.length} break rows with {n - 1} quantile boundaries?</p>
    <button onClick={() => { setShowAutoSuggestConfirm(false); runAutoSuggest(); }}>
      Replace
    </button>
    <button onClick={() => setShowAutoSuggestConfirm(false)}>Cancel</button>
  </div>
)}
```

This matches the LayersModal confirm-delete CSS/style approach — no portal, just inline conditional.

### Color Picker + Text Input Pattern (from raster pointColor, lines 832–859)

Per-row color fields mirror the established raster pointColor two-control pattern exactly:

```typescript
// Per-row color (break.color — 8-char AARRGGBB):
<input
  type="color"
  className="config-color-picker"
  value={`#${rgbFromAARRGGBB(break.color || "FFFF3838")}`}
  onChange={(e) =>
    updateBreak(i, {
      color: joinAARRGGBB(
        alphaFromAARRGGBB(break.color || "FFFF3838"),
        e.target.value.replace("#", ""),
      ),
    })
  }
/>
<input
  type="text"
  className="config-color-text"
  value={normalizeAARRGGBB(break.color || "FFFF3838")}
  onChange={(e) =>
    updateBreak(i, { color: normalizeAARRGGBB(e.target.value, "FFFF3838") })
  }
/>
```

The same pattern applies to per-row `shapeLineColor` and `shapeFillColor` in the advanced panel.

### Recommended Project Structure

```
kinetica_bi/src/
├── components/charts/
│   ├── KineticaWmsLayerForm.tsx        # modified: delete ClassbreakParamsGroup,
│   │                                   # filter contour from picker, swap gate
│   ├── KineticaWmsLayerForm.spec.tsx   # modified: replace CB-targeted tests
│   └── CbConfigForm.tsx                # new: extracted sub-component
├── lib/
│   ├── cbConfig.ts                     # extended: add PALETTE_COLORS constant
│   └── cbConfig.spec.ts                # possibly extended for PALETTE_COLORS
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CB config serialization | Custom JSON schema validator | `coalesceCbConfig` + TypeScript types from `lib/cbConfig.ts` | Already ships; handles null + malformed JSON |
| Cardinality counting | Custom Kinetica SQL fetch | `probeCardinality(tableRef, column, signal)` from `lib/cardinalityProbe.ts` | Ships with session cache, abort signal, error handling |
| Quantile boundaries | Custom NTILE SQL | `quantileFn(args, signal)` from `api/client.ts:1074` | Verified NTILE endpoint, AbortSignal threading |
| Color normalization | Custom hex parser | `normalizeAARRGGBB`, `rgbFromAARRGGBB`, `alphaFromAARRGGBB`, `joinAARRGGBB` from `lib/colorHex.ts` | Pure helpers, all edge cases handled |
| Toast notifications | Custom notification | `useToastStore.getState().showToast(msg, kind)` | Established pattern; dedup + dismiss auto-handled |
| Abort-on-refire | Custom cancellation | `useRef<AbortController \| null>` per operation | Established pattern (probeCardinality, Auto-suggest) |
| CB URL emission | Form-side WMS param assembly | wmsUrlBuilder Lane C (Phase 38) | Phase 38 owns Lane C; form only sets cb_config JSON |

---

## Common Pitfalls

### Pitfall 1: Writing to legacy `config.cbColumn` / `config.classbreaks[]`
**What goes wrong:** If new CbConfigForm accidentally patches `config.cbColumn` or `config.classbreaks[]`, wmsUrlBuilder Lane C ignores those fields entirely (hard cutover from Phase 38) and the tile never re-renders.
**How to avoid:** CbConfigForm ONLY calls `onChange({ ...config, cb_config: JSON.stringify(next) })`. Grep for `cbColumn` and `classbreaks` references in the new file after writing.
**Warning signs:** No tile re-render when editing CB form fields.

### Pitfall 2: Categorical validation NOT running before PATCH
**What goes wrong:** Kinetica silently ignores malformed CB_VALS (Phase 37 Edge-4 SILENT-IGNORE) — tiles still render, but the break values are misapplied. Empty or duplicate values produce invisible incorrect visualizations.
**How to avoid:** `isValid` must return `false` when any categorical break has an empty `value` string (excluding the `<other>` row). LayersModal's Save button is disabled when `isValid === false`. Inline red text on the offending row's value field.
**Warning signs:** Tile renders with fewer than expected classbreaks.

### Pitfall 3: quantileFn gets schema and table swapped
**What goes wrong:** `QuantileArgs = { schema, table, column, n }` — if the planner passes `table` where `schema` should go, the Kinetica SQL fails with a 400 or returns incorrect boundaries.
**How to avoid:** Derive from `associatedTables.find(t => t.id === layer?.table_id)` which returns `{ schema, name }` — map `name` → `table` arg, `schema` → `schema` arg.

### Pitfall 4: Auto-suggest N semantics — N breaks vs N-1 boundaries
**What goes wrong:** The server returns `{ breaks: number[] }` of length `n - 1`. Misinterpreting this as `n` rows would create one fewer row than the operator expects.
**How to avoid:** The form materializes **N break rows** where rows `[0..N-2]` take `breaks[i]` and row `[N-1]` has an empty value with `≥ {breaks[N-2]}` placeholder hint.

### Pitfall 5: `<other>` row auto-maintenance — duplication on toggle
**What goes wrong:** If the toggle-ON handler appends an `<other>` row without checking whether one already exists, re-toggling creates duplicates.
**How to avoid:** Toggle-ON: `if (!breaks.some(b => b.value === '<other>')) { append }`. Toggle-OFF: filter out any row where `b.value === '<other>'`.

### Pitfall 6: Contour mode disappears from existing layer configs after picker filter
**What goes wrong:** A layer saved with `renderMode: "contour"` can no longer be edited if the `contour` radio is hidden from the picker — the radio won't render but the mode is still active.
**How to avoid:** The `{renderMode === "contour" && <ContourParams>}` gate at line 1165–1227 stays untouched. The picker just hides the radio option; an already-set contour config continues to render the contour params section. The operator can only switch AWAY from contour (all other 3 modes are visible in the picker).
**Mitigation:** This is acceptable per CONTEXT.md — contour is an internal dead-code path; no operators are using it in production.

### Pitfall 7: Spec test asserts "Contour (lines)" appears in picker
**What goes wrong:** The existing spec at `KineticaWmsLayerForm.spec.tsx:89–90` asserts `screen.getByText("Contour (lines)")` is in the document. After filtering contour from the picker, this test will fail.
**How to avoid:** Update that spec to expect contour NOT to be in the document. Add a new spec asserting only 3 modes appear in the picker.

### Pitfall 8: `probeCardinality` called in numeric mode
**What goes wrong:** The cardinality probe is expensive. Calling it for numeric columns wastes a round-trip.
**How to avoid:** Gate the probe: `if (isCategoricalValsType(newCbConfig)) { runProbe(col); }`. NEVER fire in numeric mode.

### Pitfall 9: Advanced fields emitting `undefined` to wmsUrlBuilder
**What goes wrong:** `wmsUrlBuilder` checks `if (cb.breaks.some(b => b.pointSize !== undefined))` before emitting `POINTSIZES`. If CbConfigForm creates new rows without explicitly setting advanced defaults, those rows have `pointSize: undefined` and the `SOME` check fires based on other rows — but the undefined rows would emit `String(undefined) = "undefined"` into the CSV.
**How to avoid:** All row-creation paths (Add break, Auto-suggest, toggle-<other>-ON) MUST set all 5 advanced fields to their defaults: `{ pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" }`.

---

## Code Examples

### Existing probeCardinality call (ClassbreakParamsGroup:226–229 — verbatim reuse)

```typescript
// Source: kinetica_bi/src/lib/cardinalityProbe.ts (Phase 11 helper)
const count = await probeCardinality(
  tableRef || "unknown",
  col,
  controller.signal,
);
```

### Toast patterns (from ClassbreakParamsGroup:233–244 — verbatim reuse)

```typescript
// Source: kinetica_bi/src/store/toast.ts — ToastKind = "permission" | "info" | "error"
useToastStore.getState().showToast(
  "Too many distinct values — Kinetica classbreak supports up to 256.",
  "error",
);
useToastStore.getState().showToast(
  "That's a lot of breakpoints — consider a heatmap or numerical range instead.",
  "permission",
);
```

### quantileFn call pattern

```typescript
// Source: kinetica_bi/src/api/client.ts:1074
// QuantileArgs = { schema: string; table: string; column: string; n: number }
// QuantileResponse = { breaks: number[] } — length === n - 1
const controller = new AbortController();
autoSuggestAbortRef.current = controller;
try {
  const { breaks } = await quantileFn(
    { schema: cbSchema, table: cbTableName, column: cbConfig.attr, n: nValue },
    controller.signal,
  );
  // breaks.length === n - 1; form creates N rows
  const newBreaks: CbBreak[] = breaks.map((boundary, idx) => ({
    value: boundary,
    color: idx < cbConfig.breaks.length ? cbConfig.breaks[idx].color : PALETTE_COLORS[idx % PALETTE_COLORS.length],
    label: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].label ?? "") : "",
    pointSize: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].pointSize ?? 5) : 5,
    pointShape: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].pointShape ?? "circle") : "circle",
    shapeLineWidth: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].shapeLineWidth ?? 1) : 1,
    shapeLineColor: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].shapeLineColor ?? "FF000000") : "FF000000",
    shapeFillColor: idx < cbConfig.breaks.length ? (cbConfig.breaks[idx].shapeFillColor ?? "FFFFFFFF") : "FFFFFFFF",
  }));
  // Append last row (N-th, the open-ended bucket)
  const lastBoundary = breaks[breaks.length - 1];
  newBreaks.push({
    value: "",
    color: (cbConfig.breaks.length > breaks.length - 1) ? cbConfig.breaks[breaks.length - 1].color : PALETTE_COLORS[breaks.length % PALETTE_COLORS.length],
    label: `≥ ${lastBoundary}`,
    pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF",
  });
} catch (err: unknown) {
  if ((err as { name?: string })?.name === "AbortError") return;
  const msg = (err as { message?: string })?.message ?? "Unknown error";
  setAutoSuggestError(`Auto-suggest failed: ${msg}`);
  useToastStore.getState().showToast(`Auto-suggest failed: ${msg}`, "error");
}
```

### CB config round-trip pattern (established onChange chain)

```typescript
// Form reads:
const cbConfig: CbConfig = coalesceCbConfig((config.cb_config as string | null) ?? null);

// Form writes:
const next: CbConfig = { ...cbConfig, breaks: newBreaks };
onChange({ ...config, cb_config: JSON.stringify(next) });
// → LayersModal onPatch(layerId, { config: nextConfig })
// → 300ms debounce → PATCH /api/dashboards/:id/layers/:layerId
// → lastEmittedParamsRef detects cb_config change → tile re-render
```

### Column eligibility filter (extends ClassbreakParamsGroup pattern at line 262–272)

```typescript
// Source: KineticaWmsLayerForm.tsx:262-272 — extend this
const numericTypes = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);
const stringTypes = new Set(["string", "varchar", "char"]);
const cbEligibleColumns = columns.filter((c) => {
  const t = c.type.toLowerCase().replace(/\(.*\)/, "").trim();
  // Phase 39 addition: exclude WKB-binary columns (CB-V17-08)
  if (c.type.toLowerCase().includes("bytes") || c.type.toLowerCase().includes("wkb")) return false;
  // Phase 39 addition: exclude spatial-config-bound columns (visual de-clutter)
  const spatialBound = new Set([
    config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn,
  ].filter(Boolean));
  if (spatialBound.has(c.name)) return false;
  return numericTypes.has(t) || stringTypes.has(t);
});
```

---

## Phase 38 API Verification (CONFIRMED SHIPPED)

| API | Location | Confirmed Shape |
|-----|----------|-----------------|
| `CbBreak` type | `lib/cbConfig.ts:21` | `{ value: string\|number; color: string; label?: string; pointSize?: number; pointShape?: string; shapeLineWidth?: number; shapeLineColor?: string; shapeFillColor?: string }` |
| `CbConfig` type | `lib/cbConfig.ts:45` | `{ attr: string; valsType: "numeric"\|"categorical"; breaks: CbBreak[]; includeOtherBucket?: boolean }` |
| `EMPTY_CB_CONFIG` | `lib/cbConfig.ts:66` | `{ attr: "", valsType: "numeric", breaks: [] }` |
| `coalesceCbConfig(raw)` | `lib/cbConfig.ts:78` | Returns `EMPTY_CB_CONFIG` for null or malformed JSON; validates `attr`+`breaks` keys present |
| `isCbConfigConfigured(cfg)` | `lib/cbConfig.ts:93` | `cfg.attr.length > 0 && cfg.breaks.length > 0` |
| `isNumericValsType(cfg)` | `lib/cbConfig.ts:98` | `cfg.valsType === "numeric"` |
| `isCategoricalValsType(cfg)` | `lib/cbConfig.ts:103` | `cfg.valsType === "categorical"` |
| `quantileFn(args, signal?)` | `api/client.ts:1074` | `Promise<{ breaks: number[] }>` — AbortSignal optional; uses `apiFetch` + `throwForStatus` |
| `QuantileArgs` | `api/client.ts:1063` | `{ schema: string; table: string; column: string; n: number }` |
| `DashboardLayerDto.cb_config` | `api/client.ts:480` | `string \| null` — raw JSON string |
| `lastEmittedParamsRef fingerprint` | `MapChartRenderer.tsx` (both Effect 2 + Effect 3) | `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })` |
| `wmsUrlBuilder Lane C` | `wmsUrlBuilder.ts:375` | Gates on `isCbConfigConfigured(coalesceCbConfig(layer.cb_config))`; reads `cb.breaks[].value/color/pointSize/etc.` |
| `PATCH /api/dashboards/:id/layers/:layerId` | `server/src/index.ts:858` | Accepts `cb_config: string \| null` via "key" in attrs discriminant; confirmed round-trip in 5 supertest cases |

---

## Form Prop Threading: tableRef / schema / table

The `CbConfigForm` needs `tableRef` (for `probeCardinality`) and `schema` + `table` separately (for `quantileFn`). These are derived at the `KineticaWmsLayerForm` level:

1. `config.tableRef` is stored in the config blob as `"schema.table"` — it is set by `ChartConfigPanel.tsx:417`. The existing `ClassbreakParamsGroup` reads this directly. HOWEVER, for `quantileFn`, we need them split.

2. `layer?: DashboardLayerDto` is an existing prop on `KineticaWmsLayerForm` with `layer.table_id`. `associatedTables?: TableDto[]` is also an existing prop with `{ id, name, schema }`. The table resolution is:
   ```typescript
   const cbTable = layer ? associatedTables.find((t) => t.id === layer.table_id) : undefined;
   const cbSchema = cbTable?.schema ?? "";
   const cbTableName = cbTable?.name ?? "";
   ```

3. The safest approach for CbConfigForm props: pass all three as separate props `tableRef`, `schema`, `tableName`. The parent derives them. `tableRef` is `cbTable ? `${cbTable.schema}.${cbTable.name}` : (config.tableRef as string) || ""` (with fallback to `config.tableRef` for backward compat with MapConfigPanel usage where `layer` prop is absent).

---

## State of the Art

| Old Approach | Current Approach | Phase Changed | Impact |
|--------------|------------------|---------------|--------|
| Lane A (`CB_COLUMN_NAME/CB_BREAK_POINT_N`) + `config.classbreaks[]` | Lane C (`CB_ATTR/CB_VALS/POINTCOLORS`) + `config.cb_config` JSON | Phase 38 | Phase 39 form writes cb_config only; legacy fields ignored at WMS layer |
| 6-char RRGGBB colors | 8-char AARRGGBB via `normalizeAARRGGBB` | Phase 38 | Color picker + text inputs write 8-char |
| `ClassbreakParamsGroup` inline in KineticaWmsLayerForm.tsx | `CbConfigForm` (extracted component in Phase 39) | Phase 39 | Better test isolation, cleaner file size |
| No fingerprint for CB params | `lastEmittedParamsRef = JSON.stringify({ p, c, t })` | Phase 38 | CB edits auto-trigger tile re-render |

**Deprecated/outdated:**
- `ClassbreakBreak` type (line 93): deleted in Phase 39.
- `ClassbreakParamsGroup` function (lines 180–428): deleted in Phase 39.
- `config.cbColumn` + `config.cbBreakType` + `config.classbreaks[]` fields: dead-read after Phase 38 hard cutover; left in storage as legacy data but never written by Phase 39 form.
- `RENDER_MODE_LABELS.contour` display: kept in constant but hidden from picker after Phase 39.

---

## Open Questions

1. **CbConfigForm file: inline vs extracted?**
   - What we know: `ClassbreakParamsGroup` was inline (276 lines). The new form will be longer (~350–450 lines with all 5 advanced fields + N slider + confirm dialog).
   - What's unclear: Whether test isolation truly requires extraction vs whether `KineticaWmsLayerForm.spec.tsx` can adequately cover both.
   - Recommendation: Extract to `CbConfigForm.tsx` + `CbConfigForm.spec.tsx`. The form size and test surface justify extraction. Inline would push `KineticaWmsLayerForm.tsx` well past 1500 lines.

2. **`PALETTE_COLORS` constant location**
   - What we know: Phase 41 LayersLegendPanel reads `cb_config.breaks[].color` directly from the stored JSON — it does NOT need a palette constant (colors are stored in the data). The palette is only used at row-creation time.
   - What's unclear: Whether Phase 41 needs the palette for visual theming of unknown-color rows.
   - Recommendation: Place in `lib/cbConfig.ts` (exported) so Phase 41 can import if needed. Suggest ColorBrewer `Blues` for numeric (8 values: `"FFF7FBFF"`, `"FFD0D1E6"`, `"FFA6BDDB"`, `"FF74A9CF"`, `"FF3690C0"`, `"FF0570B0"`, `"FF045A8D"`, `"FF023858"`) and `Set2` for categorical (`"FF66C2A5"`, `"FFFC8D62"`, `"FF8DA0CB"`, `"FFE78AC3"`, `"FFA6D854"`, `"FFFFD92F"`, `"FFE5C494"`, `"FFB3B3B3"`).

3. **CB-eligible column type matching — partial-type-string columns**
   - What we know: Kinetica returns types like `"int"`, `"double"`, `"varchar"`, `"string"`. The existing ClassbreakParamsGroup uses `.replace(/\(.*\)/, "")` to strip length suffixes like `varchar(255)`.
   - What's unclear: Whether `decimal(10,2)` or `numeric(18,4)` type strings exist in practice.
   - Recommendation: Retain the `.replace(/\(.*\)/, "").trim()` normalization from ClassbreakParamsGroup:263.

---

## Sources

### Primary (HIGH confidence — code was read directly)

- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — full file inspected (1372 lines); lines 93, 180–428 (ClassbreakParamsGroup), 806 (render-mode picker), 1156 (classbreak gate), 462–471 (validity useEffect), 832–859 (raster pointColor color picker pattern)
- `kinetica_bi/src/lib/cbConfig.ts` — full file verified; CbBreak/CbConfig/EMPTY_CB_CONFIG/coalesceCbConfig/isCbConfigConfigured/isNumericValsType/isCategoricalValsType signatures confirmed
- `kinetica_bi/src/api/client.ts:1063–1088` — QuantileArgs, QuantileResponse, quantileFn signature confirmed; DashboardLayerDto.cb_config: string | null confirmed
- `kinetica_bi/src/lib/colorHex.ts` — full file; normalizeAARRGGBB/rgbFromAARRGGBB/alphaFromAARRGGBB/joinAARRGGBB signatures confirmed
- `kinetica_bi/src/store/toast.ts` — ToastKind = "permission" | "info" | "error" confirmed; showToast signature confirmed
- `kinetica_bi/src/lib/cardinalityProbe.ts` — probeCardinality(tableRef, column, signal?) signature confirmed; session-cached
- `kinetica_bi/src/components/LayersModal.tsx` — modal structure (modal-overlay div), onPatch propagation, KineticaWmsLayerForm usage confirmed; no shared portal component; inline confirm-delete pattern
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:375–411` — Lane C cb_raster branch confirmed; STYLES_BY_MODE.classbreak = "cb_raster" confirmed
- `.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md` — cb_config PATCH round-trip confirmed; cbConfig.ts API locked
- `.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md` — wmsUrlBuilder Lane C confirmed; DashboardLayerDto extension confirmed; fingerprint JSON.stringify({p,c,t}) confirmed
- `.planning/phases/38-schema-wms-engine-foundation/38-03-SUMMARY.md` — quantileFn shape confirmed; QuantileArgs.schema + table separate params confirmed
- `.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md` — locked decisions verbatim
- `package.json` (grep) — `@dnd-kit/core` NOT present; drag-reorder is deferred

### Secondary (MEDIUM confidence — from Phase 37 spike notes)

- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` — Edge-4 SILENT-IGNORE lock confirmed; OQ-3 `<other>` keyword PASS confirmed; backslash-escape responsibility at wmsUrlBuilder (not form) confirmed

---

## Metadata

**Confidence breakdown:**
- Phase 38 APIs: HIGH — all files read directly, signatures verified
- Form integration approach: HIGH — source file read completely, exact line numbers confirmed
- Modal-confirm pattern: HIGH — LayersModal.tsx + DynamicViewsModal.tsx read; no shared portal component confirmed
- TableRef/schema threading: HIGH — prop chain traced from LayersModal → KineticaWmsLayerForm; TableDto type verified
- @dnd-kit/core absence: HIGH — grep confirmed absent from package.json

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (stable internal codebase; all referenced code is in the repo)
