# Phase 22: config-ui - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add user-facing controls to the existing config panels so dashboard authors can configure the per-layer and per-widget Info Popup behavior that Phase 21 already renders.

**In scope:**
- Per-layer "INFO POPUP" section inside `KineticaWmsLayerForm` (used by `LayersModal` right pane), persisting to `dashboard_layers.info_enabled` (toggle), `info_columns` (chip-combobox multi-picker; alphabetical), `info_template` (HTML code editor) via the existing `onPatch(layerId, patch)` flow
- Per-widget "INFO POPUP" section inside `MapConfigPanel`, persisting to `widget.config.infoEnabled` (toggle) and `widget.config.infoRadiusPx` (number input, integer 1–200) via the existing `onChange(config)` flow
- Auto-save flow: 300ms debounced `onPatch` for layers (already wired), `onChange` per-keystroke for widget config (already wired)
- Disabled-state handling: when `info_enabled=false`, sub-fields (picker + editor) render disabled; when `infoEnabled=false`, radius input renders disabled; when the layer's table is missing, the entire layer section is disabled with a "Bind a table to configure info popup" message
- Spec coverage for: section render order, default-all-columns sentinel preserved when nothing is deselected, alphabetical column ordering, toggle-disables-subfields, radius clamp-on-blur, empty-template renders KV mode

**Out of scope (other phases / deferred):**
- Tabs / structural redesign of either form (chose stacked `config-group` section to match existing pattern)
- Live template preview against a real / synthetic row (deferred — author can verify by clicking the map post-save)
- Search/filter input above the column picker (deferred — re-evaluate if UAT shows it's needed for >50-column tables)
- Drag-orderable column list (chose alphabetical; user-controlled order via `info_template` instead)
- Migrating CodeMirror/Monaco to other surfaces in the app (only the info_template editor uses it)
- Pre-populated example template (chose empty editor + placeholder hint)
- Insert-column-by-clicking-chips integration (chose a separate "Insert column" picker above the textarea instead)
- CARD-V14-* (Phase 23 Info Card)

</domain>

<decisions>
## Implementation Decisions

### Section structure & placement

- **Stacked `config-group` block, no tabs.** ROADMAP.md says "Info Popup tab" but the existing `KineticaWmsLayerForm` and `MapConfigPanel` use `<div className="config-group">` sections with a `config-group-label` header. Adding a tab control would be a structural redesign of both forms — out of scope. The new "INFO POPUP" section matches every other section (TITLE, BASEMAP, LAYERS, SPATIAL MODE, RENDER MODE, OPACITY, …) verbatim.
- **Position: at the very bottom of each form**, after all rendering / opacity config. Signals "optional add-on"; doesn't disrupt the existing top-to-bottom config flow that authors already know.
- **Section header label: `INFO POPUP` (uppercase, matches existing labels)**. Same label on both `KineticaWmsLayerForm` and `MapConfigPanel`. Authors learn the feature name once. Internally consistent with v1.4 milestone naming, REQUIREMENTS.md, ROADMAP.md, `useInfoSelectionStore`, `getInfoEnabled`/`getInfoRadiusPx`.
- **No `INFO POPUP — LAYER` / `INFO POPUP — WIDGET` differentiation.** Scope is implicit from where the form lives.

### Column multi-picker UX

- **Visual style: multi-select dropdown / chip combobox.** No existing pattern in this codebase — researcher MUST investigate available shapes. Acceptable approaches: (a) a small library the project can adopt (research current options), (b) a custom implementation using existing primitives. Recommendation will favor a library only if the bundle cost is small (~<20 KB gzip) and accessibility is good out of the box. Plan locks the choice; CONTEXT does not.
- **Default state: all columns selected, `info_columns` stays `null` in the database.** Visually all chips are present (or all checkboxes checked, depending on the chosen widget shape). Only when the user actually removes a chip does `info_columns` get persisted as a JSON-string array. Preserves the Phase 19 "NULL = all columns" sentinel — and the practical benefit that if the table later gains a column, default-all layers auto-include it.
- **Ordering: alphabetical, no user reorder.** Picker shows columns in alphabetical order by column name. Easier scanning when tables have many columns. The `kv` rendering mode in the popup ALSO renders alphabetically (see template-render note below) — picker order matches popup order.
- **No search/filter input.** Most layers have <30 columns; the bounded-height scrollable picker handles them. Re-evaluate if UAT shows it's needed.

**Implication for Phase 21's `renderInfoTemplate.ts`:** the helper itself is order-preserving — it renders the column-name list it's given. Phase 22's caller (the InfoPopup, when it reads `info_columns` from the layer) MUST sort the column-name array alphabetically before passing it through to the helper, so the popup's `kv` mode renders in the same order the picker shows. Document this in the plan; renderInfoTemplate stays untouched.

### HTML template editor UX

- **Lightweight code editor (CodeMirror 6 or Monaco — Claude's discretion).** Recommendation favors **CodeMirror 6**: ~50 KB gzip, modular extensions, simpler API for a read/edit-HTML use case. Monaco would be overkill (~500 KB+, full IDE-grade). Researcher to verify the recommendation against project bundle constraints; planner locks the choice and the import path.
- **Inline syntax note + security warning below the textarea.** Two short lines, verbatim:
  - `Use {column_name} to insert values.`
  - `HTML is rendered as-is — do not paste templates from untrusted sources.`
  This is the only place in the UI that surfaces the no-sanitization tradeoff. Cites the PROJECT.md Key Decision implicitly so authors don't have to read the docs to understand the model.
- **No live preview pane.** Authors validate by clicking the actual map after save (LayersModal auto-saves at 300ms; popup re-fetches on next click). Avoids the "preview against what row?" question, the "what if the table is empty?" edge case, and the bundle/server cost of a preview-fetch endpoint.
- **"Insert column" picker above the textarea.** A dropdown of currently-selected columns (the same set the chip-combobox shows). Clicking a column inserts the literal token `{column_name}` at the editor's cursor position. Reduces typos when column names are long or contain underscores. Researcher to confirm the cursor-position API of the chosen editor library; planner locks the helper function.
- **Empty-state: empty editor + placeholder/ghost text.** When `info_template` is null/empty, the editor renders empty with placeholder text like `— leave blank to render as a key-value table.` Saving with empty content persists `null` (popup falls back to KV mode per POPUP-V14-04). No pre-populated example template; no "Use template" toggle.

### Validation + save flow

- **Auto-save on every change, 300ms debounce.** Mirrors the existing `LayersModal` pattern verbatim (parent-owned debounce + `onPatch`). Author edits a field → 300ms later it persists via the existing `updateLayer` PATCH path. For `MapConfigPanel`, the existing per-keystroke `onChange(config)` propagation is already debounced upstream; reuse it. Zero new save UX, no "unsaved changes" state to manage.
- **Radius numeric input: clamp on blur + inline error.** While typing, allow any value (so the user can clear and retype freely). On blur:
  - If value is `<1`, snap to `1` and persist.
  - If value is `>200`, snap to `200` and persist.
  - If value is non-integer, snap to the nearest integer.
  - In all clamp cases, show a small inline error message like `Must be 1–200` for ~3s under the input.
  Backing input also sets `<input type="number" min={1} max={200} step={1}>` for browser-level affordances.
- **Disable sub-fields when toggle is off.**
  - Layer form: when `info_enabled=false`, the column chip-combobox and the template editor render with `disabled` attribute set, `aria-disabled='true'`, and visually greyed out via existing CSS variables. The toggle is the master switch.
  - Widget form: when `infoEnabled=false`, the radius `<input type="number">` renders disabled.
  Standard form ergonomics; clearly communicates that the toggle is the master switch.
- **Missing-table state: disable the entire layer Info Popup section.** When the layer's `table_id` doesn't resolve in `associatedTables` (the existing missing-table state already badged in `LayersModal`), render the section with all controls disabled and a single message: `Bind a table to configure info popup`. The toggle, picker, and editor are all non-interactive in this state. Once the user binds a table (via the existing TABLE dropdown above the form), the section comes alive.

### Claude's Discretion

- Exact CodeMirror 6 vs Monaco selection (recommend CodeMirror 6; planner locks).
- Exact chip-combobox library vs custom implementation (researcher recommends; planner locks).
- Exact CSS class names for the new section (`.info-popup-config-*` namespace recommended for parity with `.info-popup-*` from Phase 21).
- Inline error message styling (reuse existing form-error pattern if one exists; introduce a minimal one if not).
- Exact placeholder text wording in the empty editor state — within the spirit of "leave blank to render as a key-value table."
- Whether the "Insert column" picker is a `<select>` that fires `onChange` or a popover with a chip list — researcher informs, planner locks.
- Whether the chip-combobox shows column types alongside names (e.g., `latitude (DOUBLE)`) — researcher recommends; planner locks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 22: config-ui" — Phase boundary, success criteria 1-4, depends-on Phase 19/21, "Notes" section calling out KineticaWmsLayerForm + MapConfigPanel as the two surfaces.
- `.planning/REQUIREMENTS.md` lines 49-50 — CONFIG-V14-03 (layer Info Popup section: toggle + column multi-picker + HTML template editor) and CONFIG-V14-04 (widget Info Popup section: toggle + numeric radius 1-200, default 20).

### Locked v1.4 architectural decisions (read these for context)
- `.planning/PROJECT.md` §"Current Milestone: v1.4 Map Info Popup" — Out-of-scope list; HTML-template no-sanitization Key Decision; per-widget kill-switch semantics; per-layer kill-switch semantics; lifecycle reset integration points.
- `.planning/STATE.md` §"Key v1.4 Architecture Decisions" — HTML template policy (no sanitization, dashboard authors are privileged), kill switch semantics (per-widget `infoEnabled: false` → no listener registration; per-layer `info_enabled = 0` → removed from popup dropdown).

### Direct upstream phases (this phase writes config that those phases consume)
- `.planning/phases/19-config-schema/19-VERIFICATION.md` — Phase 19 verification of `info_enabled`, `info_columns`, `info_template` columns on `dashboard_layers`; `infoEnabled` / `infoRadiusPx` on widget config; `mapInfoConfig.ts` helpers (`getInfoEnabled` default `true`, `getInfoRadiusPx` default `20`); Phase 22 is responsible for enforcing min=1/max=200 at edit time (Phase 19 helpers do NOT clamp).
- `.planning/phases/19-config-schema/19-01-schema-migration-SUMMARY.md` — Phase 19 schema migration summary; lookup how `info_columns` is stored (TEXT NULL = all-columns sentinel).
- `.planning/phases/19-config-schema/19-02-frontend-types-SUMMARY.md` — Phase 19 frontend type summary; `DashboardLayerDto` shape with `info_enabled: number` (0/1), `info_columns: string | null`, `info_template: string | null`; `MapWidgetConfig` shape with `infoEnabled?: boolean`, `infoRadiusPx?: number`.
- `.planning/phases/21-map-click-popup/21-CONTEXT.md` — Phase 21 popup context; `renderInfoTemplate.ts` helper signature (order-preserving); `info_columns` JSON-array-string contract (parse with try/catch fallback to all-columns); `infoEnabled=false` → no OL click listener registration.
- `.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md` — `renderInfoTemplate` helper summary; helper renders the column-name list it's given verbatim. Phase 22's chip-combobox decision means the InfoPopup must sort column names alphabetically before calling the helper (so picker order = popup `kv` order).
- `.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md` — `InfoPopup.tsx` summary; the popup that consumes per-layer `info_columns` / `info_template` and per-widget `infoEnabled` / `infoRadiusPx`.

### Pattern references (mirror these in this phase)
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Existing widget config panel; lines 56-118 show the `config-group` / `config-group-label` pattern that the new `INFO POPUP` section will mirror. New section sits at the very bottom (after the LAYERS picker, line 116). Auto-save: existing `onChange(config)` flow.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Existing layer form (851 lines); new `INFO POPUP` section sits at the very bottom of the form. Auto-save: parent-owned 300ms debounce via `onChange(config)` propagating up to LayersModal's `onPatch(layerId, patch)`.
- `kinetica_bi/src/components/LayersModal.tsx` — Modal wrapper around `KineticaWmsLayerForm`; provides `onPatch(layerId, patch)` and the missing-table badge. Lines 134-145 show the column-list resolution pattern (read columns from `associatedTables.find(t => t.id === selectedLayer.table_id)`) — the chip-combobox MUST use the same lookup. Lines 142-143 show the missing-table predicate (`!associatedTables.find((t) => t.id === layer.table_id)`) — the disabled-section state uses the same predicate.
- `kinetica_bi/src/lib/mapInfoConfig.ts` — Read-only helpers (`getInfoEnabled` / `getInfoRadiusPx`) with locked defaults `true` / `20`. Phase 22 writes back to the same fields; readers stay through these helpers. Defaults are NOT changed.
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — Existing spec; extend with the new INFO POPUP section render + interaction cases.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — Existing spec; extend with the new INFO POPUP section render + interaction cases.

### Endpoint / data references
- `kinetica_bi/server/src/db.ts` lines 91-93 (DDL), 131-152 (PRAGMA-guarded ALTER), 188-190 (`mapDashboardLayer` projection of the 3 fields), 454-471 (`updateDashboardLayer` UPDATE with `"info_enabled" in attrs` discriminant). Phase 22 changes are entirely client-side; no server changes needed.
- `kinetica_bi/src/api/client.ts` lines 460-462 (`DashboardLayerDto` field shapes), 494-496 (`updateLayer` Pick<...>` widening — already includes the 3 info fields). Phase 22's auto-save dispatches through this existing helper.

### External library references (researcher to verify)
- CodeMirror 6 — `https://codemirror.net/` — modular code editor; ~50 KB gzip with HTML language extension; recommended choice. Researcher to verify import path and React integration story (`@uiw/react-codemirror` is the typical wrapper).
- Monaco Editor — `https://microsoft.github.io/monaco-editor/` — full IDE editor; ~500 KB+; not recommended unless researcher finds a strong reason.
- Chip-combobox — research current accessible options the project can adopt (e.g., headless component libraries) vs a custom implementation using existing primitives. Bundle target: <20 KB gzip if a library is used.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`config-group` / `config-group-label` pattern:** Used throughout `MapConfigPanel.tsx` and `KineticaWmsLayerForm.tsx`. Phase 22 reuses these classes verbatim for the new INFO POPUP section.
- **`getInfoEnabled` / `getInfoRadiusPx` (Phase 19):** Read-only helpers with locked defaults. UI should NOT call these for editing (the form binds directly to the raw `config.infoEnabled` / `config.infoRadiusPx`); these are for runtime readers (popup logic in Phase 21).
- **Existing `<input type="number">` patterns:** Search the codebase (`grep -rn 'type="number"' kinetica_bi/src`) for the established min/max/step idiom and clamp helper if any. Reuse before introducing new utilities.
- **`onPatch(layerId, patch)` auto-save (LayersModal):** 300ms debounced PATCH; Phase 22 hooks the new fields into the same `patch` payload. No new save infrastructure needed.
- **Missing-table predicate (LayersModal:142-143):** `!associatedTables.find((t) => t.id === layer.table_id)`. Use this same predicate to disable the INFO POPUP section in the layer form when the layer has no resolvable table.
- **Existing modal-overlay / form-disabled CSS:** Greyed-out / disabled styling tokens may already exist in `global.css`. Reuse before introducing new ones.

### Established Patterns

- **Auto-save propagation:** Layer form → `onChange(config)` → `LayersModal` → `onPatch(layerId, patch)` → debounced 300ms → `updateLayer(layerId, patch)` (PATCH `/api/dashboard-layers/:id`). Widget form → `onChange(config)` → upstream debouncer → server PATCH. Phase 22 plugs into the existing flow at the form layer.
- **Spec colocation:** Both `MapConfigPanel.spec.tsx` and `KineticaWmsLayerForm.spec.tsx` exist next to their components. Phase 22 extends them in place.
- **Reference-stable updates:** Form fields call `onChange({ ...config, key: value })` — never mutate the config object. Mirror in the new section.
- **Default sentinels in the database, not in the UI:** `info_columns: null` means "all columns" at the DB layer; the UI presents this as "all chips visible". The UI must NOT auto-populate `info_columns` with the explicit column-name array on first render — that would lose the sentinel and break the auto-include-future-columns property.

### Integration Points

1. **`KineticaWmsLayerForm.tsx` (extend):** Add a new `<div className="config-group">` block at the bottom of the form. Block contains: section header `<div className="config-group-label">INFO POPUP</div>`, `info_enabled` toggle (checkbox), chip-combobox column picker (sourced from `columns` prop, sorted alphabetically), info_template editor (CodeMirror 6 or chosen library, with "Insert column" picker above), inline syntax note + security warning. Toggle disables sub-fields when off. Whole block disabled when missing-table state is active.
2. **`MapConfigPanel.tsx` (extend):** Add a new `<div className="config-group">` block at the bottom of the form. Block contains: section header `<div className="config-group-label">INFO POPUP</div>`, `infoEnabled` toggle, `infoRadiusPx` `<input type="number" min={1} max={200} step={1}>` with clamp-on-blur + inline error. Toggle disables radius input when off.
3. **`KineticaWmsLayerForm.spec.tsx` (extend):** Add tests for: section render order (after OPACITY), default-all-columns sentinel preservation, alphabetical column ordering in picker, toggle-disables-subfields, missing-table-disables-section, auto-save propagation through `onChange`.
4. **`MapConfigPanel.spec.tsx` (extend):** Add tests for: section render order (after LAYERS), `infoEnabled` default `true` (via `getInfoEnabled`), radius clamp-on-blur (typing 999 → snaps to 200, typing 0 → snaps to 1, typing -5 → snaps to 1, typing 50.7 → snaps to 51), toggle-disables-radius, auto-save propagation.
5. **`global.css` (extend):** Add any new disabled-state / inline-error CSS classes if existing tokens don't suffice. Recommend `.info-popup-config-*` namespace for new selectors. Researcher to confirm whether the existing form-disabled tokens are reusable.
6. **`package.json` (extend):** Add the chosen chip-combobox library (or build custom) and the chosen code editor library (CodeMirror 6 + HTML language pack expected). Confirm bundle impact in the plan.

### Anti-patterns / pitfalls

- **DO NOT auto-populate `info_columns` with the explicit column-name array on first render.** That loses the "NULL = all columns" sentinel and breaks the auto-include-future-columns property. The UI shows all chips by default but persists `null` until the user actively deselects something.
- **DO NOT clamp radius while typing.** Allow any input during typing; clamp only on blur. Otherwise the user can't clear and retype freely.
- **DO NOT render the column picker / template editor as fully editable when `info_enabled=false`.** Disabled state is the master-switch contract.
- **DO NOT render the section as fully editable when the layer has no resolvable table.** No columns to pick from; template editor would reference nothing.
- **DO NOT add HTML sanitization or any "safer" rendering of `info_template` in the editor preview.** Locked PROJECT.md decision; the editor is text-only edit, the popup is the sole renderer.
- **DO NOT reorder existing form sections.** New section appends at the bottom only.
- **DO NOT change the `MapWidgetConfig` or `DashboardLayerDto` types.** Phase 19 already shipped them; Phase 22 only writes to existing fields.

</code_context>

<specifics>
## Specific Ideas

- "Mirror the existing config-group pattern" — verbatim. No tab redesign; no collapsible disclosure; no side panel. Just one more section at the bottom of each form.
- "Chip combobox over checkbox list" — user-overrode the recommended simpler shape. Acceptable trade-off: needs research, but the chip UX is more polished for default-all-columns case (chips communicate "these are included" more clearly than checkboxes communicate "these are checked").
- "CodeMirror over plain textarea" — user-overrode the recommended simpler shape. Acceptable trade-off: the HTML+`{token}` syntax benefits more from monospace + line numbers + bracket matching than typical short text inputs do.
- "Picker alphabetical, KV renders alphabetical" — user wants the picker order to match the popup render order. Means InfoPopup (Phase 21) must sort the column-name array before passing to `renderInfoTemplate`. Plan must call this out in the InfoPopup integration task — `renderInfoTemplate` itself stays untouched (still order-preserving).
- "Inline syntax note + security warning" — surfaces the no-sanitization tradeoff in the UI exactly once, where the author edits the template. Makes the trust model visible without forcing authors to read docs.

</specifics>

<deferred>
## Deferred Ideas

- **Live template preview** against a real or synthetic row — chose "no preview". Authors validate by clicking the actual map post-save. Re-evaluate if UAT shows authors are confused about how the template renders.
- **Search/filter input above the column picker** — chose "no search". Re-evaluate if UAT shows it's needed for tables with >50 columns.
- **Drag-orderable column list** — chose "alphabetical, no reorder". Authors who want a specific render order can use `info_template` instead. Re-evaluate if UAT shows authors want explicit KV-order control.
- **Pre-populated example template** — chose "empty editor + placeholder hint". Saves first-time authors from having to edit-out a starter template if they just want the KV table.
- **"Use template" toggle separate from `info_enabled`** — chose "empty template = KV mode". One fewer control to manage.
- **Click-chip-to-insert integration** between the picker and the template editor — chose a separate "Insert column" picker above the textarea instead. Simpler discoverability.
- **Tabbed layout for the layer / widget config panels** — chose "stacked sections". Tabbing is structural redesign that goes beyond Phase 22's scope. Re-evaluate if more config sections accumulate in v1.5+.
- **Tooltip / info-icon helper docs** — chose "inline syntax note + security warning visible at all times". Tooltips hide the no-sanitization tradeoff one click away from the editor.
- **Per-section save buttons** — chose "auto-save with 300ms debounce". Mirrors the existing pattern across the entire layer form.
- **Hide sub-fields when toggle is off** — chose "disable, don't hide". Avoids jumpy layout; keeps the toggle's master-switch role visible.
- **Radius slider variant** — only a numeric input was scoped. Re-evaluate if UAT shows authors prefer a slider for the 1-200 range.
- **Per-column type display in the picker** (e.g., `latitude (DOUBLE)`) — Claude's discretion. Researcher informs the recommendation; planner locks. Default leaning: show types in the dropdown options but not in the chips (chips stay compact).

</deferred>

---

*Phase: 22-config-ui*
*Context gathered: 2026-05-08*
