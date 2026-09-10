# Phase 28: spatial-target-config - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Map widget config gains a `widget.config.spatialTargets: SpatialTarget[]` field persisted via the existing `PATCH /api/widgets/:id` endpoint. A pure frontend helper module exports the `SpatialTarget` type plus `getSpatialTargets(widget)` and `isSpatialTargetEligible(target)` predicates. `MapConfigPanel.tsx` gains a "Spatial filter targets" section with an add/remove editor (table picker + spatial-mode radios + per-mode column pickers + inline WKB warning) that persists via the existing 300ms-debounced auto-save.

**Independent of Phase 27** — Phase 27 explicitly deferred `SpatialTarget` here; no Phase 27 imports needed. Can land before or after Phase 29 (per ROADMAP "depends on Phase 27" — type-shape parity only, not runtime dependency).

**No server changes** — persistence rides the existing widget PATCH endpoint; legacy v1.4 widgets without `spatialTargets` default to `[]` (no data migration needed).

</domain>

<decisions>
## Implementation Decisions

### Frontend SpatialTarget type & helper contract

- **Module path:** `kinetica_bi/src/lib/spatialTargets.ts` (locked by REQUIREMENTS.md TARGET-V15-02). The module is the **single source of truth** — it both DEFINES and EXPORTS the `SpatialTarget` type alongside the helpers. Mirrors `kinetica_bi/src/lib/mapInfoConfig.ts` (types + helpers co-located).
- **Sibling spec:** `kinetica_bi/src/lib/spatialTargets.spec.ts`.
- **Type shape — mirrors server byte-for-byte:**
  ```ts
  export type SpatialMode = "latlon" | "wkt" | "wkb";
  export type SpatialTarget = {
    tableId: number;
    spatialMode: SpatialMode;
    lonCol?: string;     // required for latlon
    latCol?: string;     // required for latlon
    spatialCol?: string; // required for wkt
  };
  ```
  Exact field names and optionality match `kinetica_bi/server/src/lib/spatialWhereClause.ts` lines 54–81. **No frontend-only fields** — no UI `id`, no camelCase rename. Phase 30 `materializeFilter` client helper sends `spatialTarget` over the wire as-is (zero projection).
  - React-key strategy for the editor: since there's no per-row `id` field, use `tableId + spatialMode` composite or array index for keys. Planner picks the concrete approach (likely a stable composite that tolerates same-table-multiple-modes — `${tableId}-${spatialMode}-${index}`).
- **`getSpatialTargets(widget): SpatialTarget[]`** — pure default-coercion: `return widget.config.spatialTargets ?? []`. Mirrors `getInfoEnabled` / `getInfoRadiusPx` simplicity. **Does NOT filter to eligible** — callers that need only eligible targets do `getSpatialTargets(widget).filter(isSpatialTargetEligible)`.
- **`isSpatialTargetEligible(target: SpatialTarget): boolean`** — single eligibility predicate, source of truth across all three v1.5 gates (config-time / materialize-time / server-time per MAT-V15-03). Returns `false` for:
  - `spatialMode === "wkb"` (TD-V14-WKB-SPIKE deferred)
  - `spatialMode === "latlon"` AND (missing `lonCol` OR missing `latCol`)
  - `spatialMode === "wkt"` AND missing `spatialCol`
  Returns `true` only for fully-configured latlon or wkt targets.

### MapConfigPanel section placement & visibility

- **Section header text:** "Spatial filter targets" (matches ROADMAP success criteria 3 + the rest of MapConfigPanel's title-case headers).
- **Placement:** Below the existing "Info Popup" section (Phase 22's CONFIG-V14-03/04 sections). Bottom of the panel — mirrors how Info Popup was appended after the basemap/layer-inclusion sections.
- **Visibility:** **Always visible** — section header + add affordance always render regardless of `spatialTargets.length`. Matches the Info Popup pattern (section always visible, content gates downstream). No new `spatialFilteringEnabled` toggle field — that would be scope creep beyond TARGET-V15-01..03.
- **Empty state:** When `spatialTargets.length === 0`, the section renders a subtle placeholder text below the header — "No spatial filter targets configured." The add affordance lives in the section header (see Add/Remove UX below), so no separate footer button is rendered.

### Per-row UX: table / mode / column pickers

- **Row layout: multi-line stacked.** Each row renders as a small card mirroring `KineticaWmsLayerForm.tsx`'s layout:
  - Line 1: table picker dropdown + trash icon (top-right of row)
  - Line 2: spatial-mode radio group (`latlon | wkt | wkb`)
  - Line 3: mode-dependent column picker(s) OR WKB warning text (see WKB warning below)
- **Auto-suggest spatial mode on table pick:** Reuse `autoSuggestSpatialMode` logic from `KineticaWmsLayerForm.tsx` (Phase 11). On table selection, inspect column metadata: if exactly one mode is detected (e.g. only a lat/lon pair → `latlon`; only a geometry column → `wkt`), pre-select that mode. Operator can override via radios. Reduces clicks for the common case.
- **Table picker source: dashboard's `associatedTables` only.** Operator can pick only from tables already associated with the dashboard — same scope as the rest of MapConfigPanel and the v1.3 materialize semantics. Does NOT include arbitrary Kinetica tables or layer-only tables.
- **Column pickers per mode:**
  - `latlon` → two dropdowns: "Longitude column" + "Latitude column" (operator picks both)
  - `wkt` → one dropdown: "Spatial column"
  - `wkb` → no column inputs; the picker slot is replaced by the WKB warning text
- **Column candidate source:** Reuse `getValidSpatialColumns(columns, spatialMode)` from `kinetica_bi/src/lib/spatialColumns.ts` (Phase 11 helper) if available. Otherwise list all table columns and let validation flag bad picks via the inline incomplete indicator.

### Add / Remove / Validation UX

- **Add affordance: `+` icon next to the section header** (NOT a footer button — user override of the default footer-button recommendation). Click appends a fresh empty row `{ tableId: <first associatedTable or 0>, spatialMode: 'latlon' }`. The empty-state placeholder text remains the descriptive copy ("No spatial filter targets configured.") when `spatialTargets.length === 0`; the add interaction always lives in the header.
- **Remove affordance: trash icon, immediate (no confirmation).** Top-right of each row's line 1. Click removes the row from `spatialTargets[]` and fires the existing 300ms-debounced auto-save. Matches the Layers panel chip-remove pattern — spatial targets are easy-to-recreate config metadata; confirmation would feel heavy.
- **Incomplete-row indicator: subtle inline italic text** below the column pickers on any row where `isSpatialTargetEligible(target) === false` AND `spatialMode !== 'wkb'`. Text: "Incomplete — will not filter". Does NOT block save (auto-save proceeds via the existing 300ms debounce; the row persists; the eligibility predicate rejects it at materialize-time).
- **WKB inline warning text:** Locked verbatim from ROADMAP success criteria 3 — "WKB spatial mode not yet supported — deferred". Appears **below the spatial-mode radios, in place of the column pickers** when `spatialMode === 'wkb'`. Style: amber/yellow italic to match Phase 22's deferred-feature pattern.

### Persistence

- Auto-save via existing `MapConfigPanel` 300ms-debounced `onChange({ ...config, spatialTargets: nextTargets })` callback path. No new endpoint, no new debounce logic.
- The `PATCH /api/widgets/:id` endpoint already accepts arbitrary `config` JSON — no server-side schema change needed for TARGET-V15-01.
- Legacy v1.4 widgets without `spatialTargets` default to `[]` via `getSpatialTargets(widget)` on read; auto-save writes the field on first edit.

### Claude's Discretion

- Exact CSS class names + visual treatment of the WKB warning text and incomplete-row indicator (operator just needs them visible and clearly different from valid state).
- Exact React-key strategy for target rows (composite vs index — pick whichever survives reorder cleanly).
- Whether the `+` add-affordance is a `<button>` with `+` text or an `<svg>` icon — visual nuance.
- Spec organization (single describe block vs grouped per-action).
- Whether `getSpatialTargets` returns a reference to the underlying array or a defensive shallow copy — recommend reference (matches `getInfoEnabled` minimal-helper style).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 scope
- `.planning/ROADMAP.md` §"Phase 28: spatial-target-config" — Goal, depends-on, requirements list, 3 success criteria
- `.planning/REQUIREMENTS.md` TARGET-V15-01..03 (with full type shape + helper signatures) and MAT-V15-03 (three-gate eligibility pattern that `isSpatialTargetEligible` participates in)
- `.planning/PROJECT.md` §"Current Milestone: v1.5 Spatial filtering on map" — milestone-level intent

### Server-side type parity (mirror byte-for-byte)
- `kinetica_bi/server/src/lib/spatialWhereClause.ts` lines 54–81 — `SpatialMode`, `SpatialFilter`, `SpatialTarget` server types. Frontend `SpatialTarget` MUST match field-for-field so Phase 30's `materializeFilter` client helper sends it as-is over the wire.

### Established frontend helper-module pattern (mirror this)
- `kinetica_bi/src/lib/mapInfoConfig.ts` — Co-located type + helper pattern (defines `MapInfoConfig` shape + `getInfoEnabled` + `getInfoRadiusPx` in the same file). Phase 28 mirrors this for `spatialTargets.ts`.
- `kinetica_bi/src/lib/mapInfoConfig.spec.ts` — Sibling spec style to follow.

### Established MapConfigPanel section pattern (Phase 22 reference)
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Where the new section lands. Existing Info Popup section (added Phase 22) is the template: section header + enable/disable toggle + per-field inputs + inline error/warning text + persist via the existing onChange callback.
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — Sibling spec — Phase 22's Info Popup spec blocks are the template for the new "Spatial filter targets" spec blocks.

### Established per-row spatial-mode picker pattern (Phase 11 reference)
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` lines ~364–620 — `SpatialMode` type, `ALL_SPATIAL_MODES`, spatial-mode radio group, per-mode column dropdowns (`latlon` → latColumn + lonColumn; `wkt` → spatialColumn; `wkb` → currently disabled). Phase 28 row layout mirrors this exactly.

### Column-metadata utilities (reuse if applicable)
- `kinetica_bi/src/lib/spatialColumns.ts` — `getValidSpatialColumns(columns, mode)` + `autoSuggestSpatialMode` (Phase 11). Phase 28 reuses both inside the row UI.

### Widget PATCH endpoint (no changes needed)
- Existing `PATCH /api/widgets/:id` accepts arbitrary `config` JSON. TARGET-V15-01 persistence rides this endpoint with the 300ms-debounced auto-save already wired in MapConfigPanel.

### Downstream consumers (do NOT touch in this phase, but be aware of the contract)
- Phase 30 `MAT-V15-02..03` — `materializeFilter` client helper extends its body type to include `spatialTarget?: SpatialTarget` (the type from `spatialTargets.ts`). Three-gate eligibility: config-time MapConfigPanel WKB warning (this phase), materialize-time `isSpatialTargetEligible` skip (Phase 30), server-time `SpatialFilterWkbDeferredError` → 501 (Phase 26 already shipped).
- Phase 26 server — already throws `SpatialFilterWkbDeferredError` for WKB targets, returns 501. Frontend eligibility predicate must reject WKB BEFORE sending (silent-skip on the client per MAT-V15-03).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`kinetica_bi/src/lib/mapInfoConfig.ts`** — Type-plus-helper co-location pattern. Direct template for `spatialTargets.ts`.
- **`kinetica_bi/src/lib/spatialColumns.ts`** — `getValidSpatialColumns` + `autoSuggestSpatialMode`. Reuse inside MapConfigPanel row UI.
- **`kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`** — Spatial-mode radio + per-mode column-picker pattern (latlon = 2 dropdowns, wkt = 1, wkb = warning). Phase 28 row layout copy-paste-mirrors this structure.
- **`kinetica_bi/src/components/charts/MapConfigPanel.tsx`** — Existing Info Popup section is the template for the new "Spatial filter targets" section (header → toggle/affordance → inputs → inline warnings → debounced onChange).
- **`kinetica_bi/server/src/lib/spatialWhereClause.ts`** — Server `SpatialTarget` type that frontend mirrors byte-for-byte. No import — type duplication is the established pattern (matches `DashboardLayer` / `DashboardLayerDto`).

### Established Patterns
- **MapConfigPanel auto-save:** 300ms-debounced `onChange(nextConfig)` already wired. New section reuses this; no new debounce logic.
- **MapConfigPanel section anatomy:** section header → optional enable/disable toggle → per-field inputs → inline error/warning text. Phase 22 Info Popup is the reference.
- **Server↔frontend type duplication:** Convention is byte-parity, no import. `DashboardLayer` (server) / `DashboardLayerDto` (frontend) is the canonical example; `spatialTargets.ts` (frontend) ↔ `spatialWhereClause.ts` (server) follows the same pattern.
- **Sentinel-default reads via pure helpers:** `getInfoEnabled` / `getInfoRadiusPx` style → `getSpatialTargets(widget)` returns `widget.config.spatialTargets ?? []`. No mutation, no migration writes.
- **Inline WKB-deferred pattern:** Phase 11's `KineticaWmsLayerForm` disables WKB column inputs when WKB selected. Phase 28 extends this to "WKB selected → show locked warning text, no column pickers".

### Integration Points
- `MapConfigPanel.tsx` — Append "Spatial filter targets" section after the Info Popup section. New section accepts the same `(config, onChange)` props the panel already uses.
- `MapConfigPanel.spec.tsx` — Add spec blocks for: add row, remove row, mode change, column pick, incomplete-row indicator, WKB warning, auto-save fires with correct `spatialTargets` array.
- `kinetica_bi/src/lib/spatialTargets.ts` — New file. Exports `SpatialMode`, `SpatialTarget`, `getSpatialTargets`, `isSpatialTargetEligible`.
- `kinetica_bi/src/lib/spatialTargets.spec.ts` — New file. Covers all helper signatures and eligibility branches (WKB / incomplete latlon / incomplete wkt / valid latlon / valid wkt).
- `MapWidgetConfig` (in `kinetica_bi/src/lib/wmsUrlBuilder.ts`) — Extend with optional `spatialTargets?: SpatialTarget[]`. Import the type from `lib/spatialTargets.ts` to keep single-source-of-truth.

</code_context>

<specifics>
## Specific Ideas

- **Add affordance lives in the section header, not the footer** — user override of the default footer-button recommendation. Combined with the "always visible + empty-state placeholder" decision, the section reads as: header (always with `+`) → empty-state copy OR row list → no footer button.
- **Type duplication, not import:** Phase 28 frontend `SpatialTarget` is its own declaration in `kinetica_bi/src/lib/spatialTargets.ts`. Do not attempt to import from server modules. Byte-parity is preserved by the planner referencing both files side-by-side during writing.
- **No new endpoints, no schema migrations:** TARGET-V15-01 rides the existing `PATCH /api/widgets/:id` JSON config column. Legacy widgets read as `[]` via `getSpatialTargets`. Zero server work in this phase.
- **The user accepted Claude's recommendation on 15 of 16 questions** (the exception was Area 4 Q1: header `+` icon instead of footer button). The remaining decisions are the conservative-default lock; the planner should not second-guess them.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 29 `SHAPE-V15-01..04`** — OL VectorLayer rendering of `useSpatialFilterStore.shapes` on every map widget, plus `MapDrawToolbar`. Phase 28 does NOT integrate with the draw UX; eligibility predicate is consumed but no shapes are drawn from this phase.
- **Phase 30 `MAT-V15-01..03`** — Materialize endpoint client wiring (`materializeFilter` body extension, per-target `spatialTarget` send, eligibility-gate skip, `_mv` cache-buster increment). Phase 28 ships the predicate; Phase 30 wires it into the materialize trigger.
- **FilterBar spatial chips** — Phase 30 scope.
- **`spatialFilteringEnabled` per-widget toggle** — Not in TARGET-V15-01..03; introducing it would be scope creep. The "always-visible section + empty-state placeholder" decision handles the "feature off" case without a toggle.
- **WKB column-picker un-greying** — Tied to TD-V14-WKB-SPIKE. When that closes, this phase's WKB warning slot becomes a real column picker. Out of scope for v1.5.
- **MapChartRenderer awareness of `spatialTargets`** — Phase 30 territory; Phase 28 only persists the field and ships the predicate.

</deferred>

---

*Phase: 28-spatial-target-config*
*Context gathered: 2026-05-12*
