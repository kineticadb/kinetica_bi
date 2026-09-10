# Phase 76: Column Formatting Editor UI - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Source:** Autonomous run — decisions made by Claude per operator's "execute 75–78 without my input" directive, applying the project's locked UI consistency conventions. All UI choices surfaced here for later review.

<domain>
## Phase Boundary

A FRONTEND-ONLY (`packages/web`) per-table Column Formatting editor, reached from the Tables/Datasets area, that lets an operator: list a table's columns with detected types, set a custom display label per column (clearing reverts to raw name), and pick a format per column (number / date / advanced d3) with a LIVE PREVIEW of a sample value — saving to the GLOBAL per-table config via the Phase 75 endpoints.

**In scope:** the editor UI + its entry point + live preview + save flow, consuming Phase 75's `columnFormatter` lib, `columnDisplayConfigStore`, and api/client CRUD helpers.
**NOT in scope:** applying labels/formatting at render surfaces (records-table, charts, map popups) — that is Phase 77. Any server change (Phase 75 owns the server surface; flag if any server diff appears — none expected).

</domain>

<decisions>
## Implementation Decisions

### Entry point
- Add a **"Format columns" button** (style `ghost-sm`, consistent with existing row/detail actions) on the **`TableDetail` view** (`DatasetsPage.tsx:123`, mode `"view"`), which already lists the table's columns. Clicking opens the editor modal for that table.
- Rationale: TableDetail is already the per-table context and lists columns; no new route needed. (A row-level button on the list was considered but the detail view is the cleaner home.)

### Editor shell — two-pane modal
- **Mirror `DynamicViewsModal.tsx`**: portal `.modal-overlay` + `.modal-content`, `.modal-header` with title + `ghost-sm` Close, ESC + click-outside close, **dirty-state guard** (`window.confirm("Discard unsaved changes?")` when `isDirty`).
- **Two-pane `.modal-left` / `.modal-right`:**
  - LEFT: scrollable column list — each row shows the column name + its detected Kinetica type (from `TableDto.columns: Record<string,string>`). Auto-select the first column on open. A small indicator (dot/label) marks columns that already have a saved label or format.
  - RIGHT: the editor form for the selected column.

### Right-pane editor form (per column)
- **Display label** — a `.ds-field` text input (`.ds-field-label` "Display label"); placeholder shows the raw column name; **clearing the field reverts to the raw name** (empty string → no label persisted, i.e. delete/omit label so `resolveLabel` falls back to raw name).
- **Format kind picker** — a `.ds-select` dropdown: **None / Number / Date / Advanced (d3-format)**. Default selection derived from `defaultFormatKind(colName, columns)` (number→Number, datetime→Date, else→None) but operator-overridable.
- **Kind-specific controls** (conditional, mirroring `CalendarConfigPanel` conditional sections with `.config-group` / `.config-group-label`):
  - **Number:** thousands separator (`.config-toggle` accent checkbox), decimal places (number input, 0–N), currency (toggle + symbol text input, default `$`), percent (toggle). Percent preset appends a literal `%` (no ×100 — Phase 75 lib already enforces this).
  - **Date:** preset dropdown (the 5 presets the Phase 75 lib supports) + an optional custom-pattern text input (tokens `YYYY/MM/DD/HH/mm`), shown when preset = "Custom".
  - **Advanced (d3):** a single text input for the raw d3-format specifier, with `.config-hint` noting it uses raw d3 semantics (so `%` DOES ×100 here — unlike the Number→percent preset).
- All controls write into a local working `FormatSpec` for the selected column; the form is fully controlled.

### Live preview
- A **live preview row** in the right pane shows a SAMPLE value rendered through `buildFormatter(workingSpec)` — updating on every control change (no Save needed).
- **Sample value source:** use a representative sample per kind without requiring a Kinetica query — number kind → a fixed illustrative number (e.g. `1234567.891`); date kind → a fixed ISO timestamp; d3 → the same number sample. (Avoids a data fetch; the editor is about the FORMAT, not live data. If a real sample is trivially available from existing table metadata it MAY be used, but a fetch is NOT required — planner's discretion, default to the fixed-sample approach.)
- Preview must never throw — it relies on the Phase 75 lib's raw-fallback guarantee; show the raw sample if the spec is invalid.

### Save UX
- **Per-column upsert on Save:** Save persists the currently-edited column(s) via `upsertColumnDisplayConfig(tableId, columnName, label, formatSpec)` (label omitted/empty → revert to raw; for a column set to kind "none" with no label → `deleteColumnDisplayConfig` to keep the table clean). Update the store (`upsertColumn`/`removeColumn`) so `configVersion` bumps.
- Track `isDirty` across the form; **single Save button** (`.btn-primary`), disabled when `!isDirty || saving`. Toast on success (`useToastStore.showToast(..., "info")`), toast on error (`"error"`). Mirror `DynamicViewsModal` / `RolesPage` save pattern.
- Switching the selected column with unsaved edits: prompt or auto-stage — default to **staging edits in-memory per column and saving all dirty columns on Save** (cleaner than forcing a save per column switch). Planner may simplify to save-on-switch if staging proves complex, but staging is preferred for UX.

### Theme / consistency (LOCKED — non-negotiable)
- **Theme tokens only**, NO raw hex — `var(--accent)`, `var(--text)`, `var(--muted)`, `var(--border)`, `var(--input-bg)`, `var(--danger)`, `var(--on-accent)`. theme-guard.spec.ts MUST stay green (do NOT add the new component to the allowlist).
- Reuse existing classes: `.ds-field`, `.ds-field-label`, `.ds-select`, `.config-toggle` (accent checkbox via global `accent-color: var(--accent)`), `.config-group`, `.config-group-label`, `.config-hint`, `.btn-primary`, `.modal-*`.
- Light-mode requires NO component conditionals — tokens auto-flip via `:root[data-theme="light"]`.

### Claude's Discretion
- Exact component/file names + whether the modal is one component or split (list + form sub-components).
- The exact 5 date presets surfaced (match whatever `columnFormatter.ts` actually supports — read it).
- Whether to show a per-column "saved" badge in the left list and its exact styling.
- Test breakdown (component tests for label-revert, kind switching, live preview, save→store/API).

</decisions>

<specifics>
## Specific Ideas

- The editor is about choosing a FORMAT, so a fixed illustrative sample value for the live preview is sufficient and avoids a Kinetica round-trip — keep it dependency-free.
- Co-locate with the Datasets area mental model: "manage a table" → "format its columns".
- Mirror DynamicViewsModal end-to-end for modal mechanics; mirror CalendarConfigPanel for the conditional format-control sections.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 75 outputs this phase consumes (READ FIRST)
- `packages/web/src/lib/columnFormatter.ts` — `FormatSpec` discriminated union (`number|date|d3|none` + per-kind fields, lines ~22-43), `buildFormatter(spec)` (never throws, raw fallback), `defaultFormatKind(colName, columns)`. The editor builds a `FormatSpec` and previews via `buildFormatter`. The percent preset (no ×100) vs d3 escape-hatch (×100) distinction lives here.
- `packages/web/src/store/columnDisplayConfigStore.ts` — `loadConfig(tableId)`, `setConfig`, `upsertColumn`, `removeColumn`, `resolveLabel`, `resolveFormatter`, `configVersion`. The editor loads on open and writes on save.
- `packages/web/src/api/client.ts:1373-1413` — `ColumnDisplayConfigRow` type + `listColumnDisplayConfig` / `upsertColumnDisplayConfig` / `deleteColumnDisplayConfig`. `TableDto` (`:273-281`, `columns: Record<string,string>`).

### UI patterns to mirror
- `packages/web/src/components/DynamicViewsModal.tsx` — canonical two-pane portal modal: overlay/content, ESC + click-outside, dirty-guard close, left-list auto-select, right-pane lifecycle, preview-pane pattern, save (toast `"info"|"error"`, disabled-when-saving).
- `packages/web/src/components/CalendarConfigPanel.tsx` — conditional `.config-group` sections + form controls.
- `packages/web/src/components/DatasetsPage.tsx:123` — `TableDetail` (entry point host) + `ghost-sm` button style + `Object.entries(table.columns)` iteration.
- `packages/web/src/components/RolesPage.tsx` — save + `isDirty` + dirty-guard reference.
- `packages/web/src/styles/global.css` — `.ds-field*`, `.ds-select`, `.config-toggle`, `.config-group*`, `.btn-primary`, `.modal-*`, theme tokens (`:root` + `:root[data-theme="light"]`).
- `packages/web/src/styles/theme-guard.spec.ts` — the no-raw-hex gate (new component must pass WITHOUT being allowlisted).

### Requirements
- `.planning/REQUIREMENTS.md` — COLEDIT-V115-01 (open editor, list columns + types), -02 (label set + clear-reverts), -03 (per-column format pick + live preview + save to global config).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 75 lib/store/client (above) — the entire data + formatting layer already exists; this phase is pure UI on top.
- `DynamicViewsModal` modal scaffolding — copy structure, swap content.
- Shared form CSS classes — no new CSS tokens needed.

### Established Patterns
- Page-level Datasets navigation (`mode: list|view|edit|create`); per-table actions are `ghost-sm` buttons; column iteration via `Object.entries(table.columns)`.
- Modals are portals with overlay + content, ESC/click-outside, dirty-guard via `window.confirm`.
- Save flow: `setSaving(true)` → await api → update store → `showToast` → `setSaving(false)`; button disabled while saving / not dirty.
- Toast kinds limited to `"info" | "error"` (+ `"permission"`).

### Integration Points
- `DatasetsPage.tsx` `TableDetail` — add the "Format columns" button + modal mount.
- New editor component(s) under `packages/web/src/components/`.
- Consumes Phase 75 store/lib/client; writes nothing to the server beyond the existing Phase 75 endpoints.

</code_context>

<deferred>
## Deferred Ideas

- Applying the labels/formatting at render surfaces (records-table, chart tooltips/axes/series, map popups) — **Phase 77**.
- Real-data sample preview pulled from Kinetica — deferred; fixed illustrative sample is sufficient for a format editor (revisit only if operators ask).
- Bulk operations (e.g. "apply this number format to all numeric columns") — out of scope; per-column editing only this phase.

</deferred>

---

*Phase: 76-column-formatting-editor-ui*
*Context gathered: 2026-06-20 (autonomous)*
