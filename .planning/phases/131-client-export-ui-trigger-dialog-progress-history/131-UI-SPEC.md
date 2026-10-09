---
phase: 131
slug: client-export-ui-trigger-dialog-progress-history
status: approved
reviewed_at: 2026-10-07
shadcn_initialized: false
preset: none
created: 2026-10-07
---

# Phase 131 — UI Design Contract

> Visual and interaction contract. Decisions D-01..D-18 in 131-CONTEXT.md are locked and are NOT re-specified here; this contract binds them to concrete existing classes, tokens and strings.
> Source of truth: `packages/web/src/styles/global.css` ("g.css" below) and `packages/web/src/components/ColumnFormatEditorModal.tsx`. Every class below was grepped on 2026-10-07; line numbers are as of that date.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (hand-rolled utility classes in g.css; no shadcn, no `components.json`) |
| Preset | not applicable |
| Component library | none |
| Icon library | FontAwesome free-solid (`@fortawesome/react-fontawesome`, already imported in `Sidebar.tsx:2-12`) |
| Font | `--font-display` (Space Grotesk Variable) for headings/modal title (g.css:45); body inherits app default |

New icon: `faDownload` from `@fortawesome/free-solid-svg-icons` for the Exports nav item. It is not yet imported anywhere (grep for faDownload/faFileArrowDown/faFileExport returned 0), so the executor must add it to the existing import block in `Sidebar.tsx` and confirm it resolves (`tsc` will fail if not).

---

## Reused Classes (verified — do NOT invent others)

| Purpose | Class | Defined |
|---------|-------|---------|
| Modal backdrop | `modal-overlay` | g.css:825 |
| Modal surface | `modal-content` (max-width 600px, `--panel-solid`) | g.css:834 |
| Modal header / title | `modal-header` / `modal-title` | g.css:849 / 857 |
| Modal body | `modal-body` | g.css:863 |
| Primary in pair | `btn-primary btn-sm` | g.css:1067 / 1089 |
| Secondary | `ghost-sm` | g.css:966 |
| Destructive | `ghost-sm ghost-danger` | g.css:966 / 981 |
| Button row | `ds-actions` | g.css:953 |
| Field / label / input | `ds-field` / `ds-field-label` / `.ds-field input` | g.css:1024 / 1030 / 1037 |
| Section group | `config-group` / `config-group-label` | g.css:1303 / 1309 |
| Hint text | `config-hint` | g.css:1319 |
| Checkbox/radio row | `config-toggle` (label wrapping `<input type="checkbox">`, 16px box) | g.css:~1325 / 1406 |
| Radios | native `<input type="radio">`, wrapped in `config-toggle` | accent applied globally via g.css:1283 |
| Page card wrapper | `dashboard-list` > `ChartCard` (title, description, actions) | g.css:590, `ChartCard.tsx:12` |
| Table rows | `datasets-table`, `ds-header`, `ds-row`, `ds-name`, `ds-meta` | g.css:908-950 |
| Muted text / loading | `muted` | g.css:1094 |
| Permission denied | `widget-permission-denied` | g.css:2279 |
| Toast | `toast`, `toast-message`, `toast-dismiss`, `toast-error` | g.css:2233-2261 |
| Inline error | `error` — NOTE: this class uses a raw hex today (g.css:1098, `#ef4444`); see New CSS `export-error` below, which uses `var(--danger)` instead. Do not use `error` for new export messages. |

Accent checkbox convention: global rule `input[type="checkbox"] { accent-color: var(--accent) }` (g.css:1283). Nothing per-element is needed; do not add `accent-color` inline.

---

## New CSS (unavoidable; all tokens verified in g.css :root lines 5-91, light overrides 115-139)

Put in `packages/web/src/styles/global.css`, appended directly after the Datasets-page block (after `.ds-actions > button`, ~g.css:964) so source order is after `.ds-header`. No `rgba()`, no hex.

```css
/* Exports page (Phase 131): same grid system as .ds-header/.ds-row, different columns.
   Name | Status | Rows | Size | Started | Expires | Actions */
.exports-table .ds-header,
.exports-table .ds-row {
  grid-template-columns: 2fr 1.4fr 1.2fr 0.8fr 1.3fr 1fr auto;
}

/* Failure reason / refusal text — theme token, light+dark safe (--danger is #fb7185 dark, #e11d48 light) */
.export-error {
  color: var(--danger);
  font-size: var(--text-base);
}

/* Progress bar: track + fill. Fill uses --accent (same violet both themes); track is tinted from --muted via color-mix so it works in both modes. */
.export-progress {
  height: 8px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--muted) 25%, transparent);
  overflow: hidden;
}
.export-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--duration-base) ease;
}
```

Total new classes: 4 (`exports-table`, `export-error`, `export-progress`, `export-progress-fill`). Anything else in this phase uses an existing class. Add `.export-progress` guard: when `totalRows` is unknown/0, render the fill at `width: 0` and show text only (no indeterminate animation).

Other (non-CSS) additions: `useToastStore.showToast` gets an optional 3rd arg `action?: { label: string; onClick: () => void }` rendered as a `ghost-sm` button between `toast-message` and `toast-dismiss` (inside existing `.toast` flex row; no new class). A toast with an action must persist longer than the default 5000 ms (use 15000 ms) because the user needs time to click it.

---

## Spacing Scale

Existing tokens only (g.css:67-75). Use `var(--space-*)`; never literal px except as noted.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| --space-1 | 4px | label-to-input gap (inside `ds-field`), icon gap |
| --space-2 | 8px | `ds-actions` gap, radio option gap |
| --space-5 | 16px | gap between dialog sections (inherited from `config-panel`; do NOT override it) |
| --space-5 | 16px | `modal-header` vertical padding, page card gap |
| --space-6 | 20px | `modal-body` padding (already provided by `modal-body`) |
| --space-8 | 24px | spacing between table and page header |

Exceptions: `--space-3` (10px) is used only inside the inherited `ds-header`/`ds-row` grids (g.css:915); new markup must not use it. The progress bar height is 8px (literal, inside the multiple-of-4 rule). No 44px touch-target exceptions (desktop app; all buttons are the existing `ghost-sm`/`btn-sm` box).

---

## Typography

Existing size tokens only (g.css:48-54). Four sizes in use:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label / hint / column header | `--text-sm` 11px (field labels use `--text-xs` 10px via `ds-field-label`, inherited) | 600 headers, 400 labels | inherit (app default; do not override) |
| Body / hints / error | `--text-base` 12px | 400 | inherit |
| Table body / dialog body copy | `--text-lg` 14px | 400 | inherit |
| Heading (modal title) | `--text-xl` 16px, `--font-display` | 700 via inherited `modal-title` | inherit |

Weights for NEW text: 400 (`--font-weight-normal`) and 600 (`--font-weight-semibold`). Inherited exceptions that this phase does not override: `modal-title` and `ds-name` are 700 (`--font-weight-bold`). Do not set `line-height` on new elements; the app has no global line-height contract and overriding creates inconsistency with sibling modals.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `var(--bg)` / `var(--panel)` | page background, page card |
| Secondary (30%) | `var(--panel-solid)` / `var(--input-bg)` / `var(--border)` | modal surface, inputs, row hairlines |
| Accent (10%) | `var(--accent)` | see reserved list |
| Destructive | `var(--danger)` | failure text; `ghost-danger` hover on Delete |

Accent reserved for: (1) `btn-primary btn-sm` "Start export" and "Download" in the dialog; (2) `export-progress-fill`; (3) checkbox/radio check fill (global rule); (4) `config-group-label` text (`--accent-text`, inherited); (5) input focus border (inherited). Nothing else, including status text in the table.

Status text is NOT colored by accent. Status labels render as plain text in default `--text`, with `queued`/`running` in `--text` and `complete` in `--text`; only `failed` / `session_expired` use `export-error` (`--danger`) and `cancelled` uses `muted`. This avoids needing a green/amber token that does not exist.

Known pre-existing hex (not introduced here, do not copy): `ghost-danger:hover` (#ef4444, g.css:982) and `.error` (#ef4444). Using `ghost-sm ghost-danger` is mandated by CLAUDE.md; theme-guard already accepts it.

Light/dark: every new rule uses tokens that are redefined under the light theme (g.css:115-139: `--danger`, `--muted`, `--accent`, `--text`). `color-mix(... var(--muted) 25%, transparent)` re-skins automatically. No `--accent-text` on accent fills: the Start/Download buttons use `btn-primary` which sets `color: var(--on-accent)`.

---

## Trigger Contract (D-01..D-04)

Records footer button (`WidgetRenderer.tsx:2449`, existing `widget-csv-download ghost-sm`, label "Download") — behavior only, markup unchanged:
- `totalCount` known and `<= csvDownloadRowCap`: existing in-browser download, untouched.
- `totalCount` > `csvDownloadRowCap`, or `totalCount` unknown (loading or failed): open the dialog.
- While the existing in-browser export is running the button keeps its current text and `disabled`.

---

## Dialog Layout (`ExportDialog.tsx`, new component)

Markup per `ColumnFormatEditorModal.tsx:262-273`:

```
<div className="modal-overlay" onClick={close}>
  <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onClick={stopPropagation}>
    <div className="modal-header">
      <div className="modal-title" id="export-dialog-title">Export records</div>
      <button className="ghost-sm" onClick={close}>Close</button>
    </div>
    <div className="modal-body">  ...phase body...  </div>
  </div>
</div>
```

Do not add a width class; `modal-content` 600px/90% is correct. `modal-body` scrolls if the content grows.

### Phase A — Form (status `form`)

Body is a vertical stack: wrap it in the existing `config-panel` (global.css:1288, `display:flex; flex-direction:column; gap:var(--space-5)`) and use its 16px gap as-is (no inline gap override).

1. Optional override note (D-04), only when a widget-action override is active: `<div className="config-hint">` with the string below. First in the body.
2. `ds-field`: `ds-field-label` "Name" + `<input type="text">`, autofocused, default per D-05, `maxLength=200`. Beneath it a `config-hint` showing the resulting file name: `<name>.csv` or `<name>.zip` (updates with the Compress checkbox).
3. `config-group` with `config-group-label` "Values": two `config-toggle` labels each wrapping `<input type="radio" name="export-format">`:
   - "Raw values" (default) + `config-hint` "Real column names and unformatted values."
   - "Formatted values" + `config-hint` "Display labels and number formats from Format columns."
4. `config-toggle` with `<input type="checkbox">`: "Compress (.zip)" (unchecked default).
5. Limits line: `<div className="config-hint">` "Limits: …" — render only if at least one cap is set; omit entirely otherwise.
6. Row-limit block (D-08), only when `totalCount > exportLimits.maxRows`: `<div className="export-error" role="alert">` with the row cap message. Start is `disabled`.
7. Server refusal block (D-09), only after a failed POST: `<div className="export-error" role="alert">` with the server `error` text verbatim.
8. `ds-actions` row, in this order left to right: `btn-primary btn-sm` "Start export" · `ghost-sm` "Download first N rows now" · `ghost-sm` "Cancel". "See all exports" follows below.

"See all exports" (D-18): a `<button type="button" className="ghost-sm">See all exports</button>` placed on the right of the `modal-header` is NOT used (header already has Close). Place it as the last element in `modal-body` after `ds-actions`, as a `ghost-sm`. Clicking closes the dialog (export, if started, keeps running) and navigates to the Exports page.

Disabled-Start reasons (exactly one tooltip `title` on the disabled button, in priority order): name empty after trim → "Enter a name for the export."; `totalCount > maxRows` → no tooltip (the message is already visible); POST in flight → label becomes "Starting…" and the button is disabled. Start is never disabled for concurrency (D-09).

Unknown `totalCount` (D-03): the dialog shows no row-count text, no over-limit block, and no "of N" in the partial button label: it reads "Download first {cap} rows now" regardless. If `totalCount` is known and the cap block is not shown, no extra copy is needed.

### Phase B — Progress (status `running`, after a successful POST)

Body: 
1. `<div className="config-hint">` "Exporting “{name}”" is NOT used; instead `<div className="ds-name">{name}</div>`.
2. `<div className="export-progress" role="progressbar" aria-valuemin=0 aria-valuemax={totalRows} aria-valuenow={rowsWritten}>` with `export-progress-fill` width `min(100, rowsWritten/totalRows*100)%` (0 if `totalRows` unknown).
3. `<div className="muted" aria-live="polite">` "{rowsWritten} of {totalRows} rows" (`toLocaleString()`); if `totalRows` unknown: "{rowsWritten} rows". For `queued` before first progress: "Waiting to start…".
4. `ds-actions`: `ghost-sm` "Cancel export" · `ghost-sm` "Close". Plus the "See all exports" `ghost-sm`.

Cancel export: calls `POST /api/exports/:id/cancel`; button becomes "Cancelling…" disabled; polling continues until the server reports `cancelled`, then the dialog shows Phase C-cancelled. Close: closes the dialog only; the export keeps running (D-10); no confirmation prompt.

### Phase C — Terminal

- `complete`: progress bar at 100%, text "{totalRows} rows · {size}". `ds-actions`: `btn-primary btn-sm` "Download" (an `<a href="/api/exports/:id/download">` styled with `btn-primary btn-sm`, a plain navigation so the browser download manager can resume) · `ghost-sm` "Close".
- `failed` / `session_expired`: `export-error role="alert"` with `errorMessage` verbatim. `ds-actions`: `ghost-sm` "Close". If `totalRows` and rowsWritten are known, keep the progress text above the error.
- `cancelled`: `muted` text "Export cancelled." `ds-actions`: `ghost-sm` "Close".

### Keyboard / focus

- Escape closes the dialog in all phases (window `keydown` listener, same as `ColumnFormatEditorModal.tsx:152-159`). There is no dirty prompt: the form has no unsaved server state.
- Focus: on open, focus the Name input (`autoFocus`). On Phase B/C transition, move focus to the first button in `ds-actions`. On close, return focus to the records footer Download button (store `document.activeElement` on open, restore on close).
- Tab order follows DOM order. Enter in the Name input submits Start when Start is enabled.
- Overlay click closes (same as precedent).

---

## Exports Page (`ExportsPage.tsx`, new; mirrors `DatasetsPage.tsx:187-243`)

Wrapper: `<div className="dashboard-list">` > `<ChartCard title="Exports" description="Your background CSV exports. Files are kept until they expire.">` — no `actions` prop (no page-level CTA).

States (all inside ChartCard, using DatasetsPage's exact pattern):
- Loading (first load only; subsequent 5 s polls update in place with no loading flash): `<div className="muted">Loading exports…</div>`
- Permission error: `<div className="widget-permission-denied">Permission denied</div>`
- Other error: `<div className="export-error">{error.message}</div>` followed by `ghost-sm` "Retry".
- Empty: `<div className="muted">No exports yet. Use Download on a large records table to start one.</div>`
- Action error (delete/cancel failed): `<div className="export-error">{message}</div>` above the table; cleared on the next action.
- Table: `<div className="datasets-table exports-table">`, header row `ds-header`, data rows `ds-row`.

Columns (header strings): `Name` · `Status` · `Rows` · `Size` · `Started` · `Expires` · `Actions`.
- Name: `<span className="ds-name">{name}</span>` with `ds-meta` second line "{dashboard name} · {widget name}" (D-15).
- Status: the status label (below). For failed rows, `<div className="export-error">{errorMessage}</div>` underneath.
- Rows: `{rowsWritten} of {totalRows}` while queued/running (live, 5 s poll), `{rowsWritten}` otherwise, both `toLocaleString()`.
- Size: `fileBytes` formatted ("1.2 GB", "340 MB", "12 KB"), "—" if null.
- Started: `new Date(createdAt).toLocaleString()` in a `ds-meta` span (matches Datasets "Updated").
- Expires: relative text from `expiresAt`: see below; "—" for non-complete rows.
- Actions: `<span className="ds-actions">`.

Row actions (D-17), all `ghost-sm` unless noted:
- queued/running: "Cancel"
- complete: "Download" (an `<a>`, `className="ghost-sm"`, href `/api/exports/:id/download`) + "Delete" (`ghost-sm ghost-danger`)
- failed / cancelled / session_expired: "Delete" (`ghost-sm ghost-danger`)

Delete confirmation: `window.confirm('Delete export "{name}"? The file will be removed and cannot be recovered.')` — identical pattern to `DatasetsPage.tsx` handleDelete. After success, remove the row optimistically on 2xx; on error show the Action error.
Cancel on this page: no confirmation (it is reversible by re-exporting and matches the dialog); the row shows "Cancelling…" in the Status cell until the server reports `cancelled`.

Polling: 5 s only while the list contains any queued/running row; stops otherwise and on unmount (D-17/D-12). Sorted newest first by `createdAt`.

Sidebar nav (D-14): in `Sidebar.tsx` nav array insert directly after the Datasets item, with no `permission` field: `{ label: "Exports", key: "exports", icon: faDownload }`. Add `"exports"` to the `Page` union in `App.tsx` and to the page switch/URL sync.

---

## Status labels and relative time

| DTO status | Label | Style |
|------------|-------|-------|
| queued | Queued | default text |
| running | Running | default text |
| complete | Complete | default text |
| failed | Failed | `export-error` |
| cancelled | Cancelled | `muted` |
| session_expired | Session ended | `export-error` |

Relative expiry (`expiresAt` vs now; recomputed on every render, no timer of its own):
- >= 24 h: "in {n} d" (floor)
- >= 1 h: "in {n} h" (floor) — e.g. "in 23 h"
- >= 1 min: "in {n} min"
- > 0: "in under 1 min"
- <= 0: "Expired"

---

## Copywriting Contract

All strings are exact. `{…}` are interpolations. Server-provided text is displayed verbatim, never rewritten, truncated or prefixed.

| Element | Copy |
|---------|------|
| Dialog title | Export records |
| Name label | Name |
| Name file hint | `{name}.csv` / `{name}.zip` |
| Values group label | Values |
| Raw option | Raw values |
| Raw explanation | Real column names and unformatted values. |
| Formatted option | Formatted values |
| Formatted explanation | Display labels and number formats from Format columns. |
| Compress checkbox | Compress (.zip) |
| Limits hint | Limits: {maxRows} rows · {size} · {n} at a time — include only caps that are set; join with " · "; `maxRows` via `toLocaleString()`; size is "{n} GB" when `maxFileMb % 1024 === 0` else "{n} MB"; concurrency as "{n} at a time" |
| Over-row-limit message | Same text as server `rowCapMessage` (mirror `exportCaps.ts`): numbers, then "Add filters to narrow it down and try again." Executor must copy the exact template from `packages/server/src/lib/exportCaps.ts`, not paraphrase |
| Override note (D-04) | Exports use the saved widget settings. Filters and sort are included; widget-action overrides are not. |
| Primary CTA | Start export |
| Start (in flight) | Starting… |
| Partial download | Download first {cap} rows now (cap with `toLocaleString()`) |
| Cancel (form) | Cancel |
| Close | Close |
| Cancel running export | Cancel export |
| Cancelling | Cancelling… |
| Download (complete) | Download |
| Progress | {rowsWritten} of {totalRows} rows |
| Progress, total unknown | {rowsWritten} rows |
| Queued | Waiting to start… |
| Complete summary | {totalRows} rows · {size} |
| Cancelled | Export cancelled. |
| Ready toast | Export "{name}" is ready (with `Download` action button; kind `info`) |
| Failure toast | server `errorMessage` verbatim (kind `error`) |
| Missing name tooltip | Enter a name for the export. |
| See all exports | See all exports |
| Page title | Exports |
| Page description | Your background CSV exports. Files are kept until they expire. |
| Column headers | Name · Status · Rows · Size · Started · Expires · Actions |
| Empty state | No exports yet. Use Download on a large records table to start one. |
| Loading | Loading exports… |
| Page error | {error.message} + "Retry" button |
| Row actions | Cancel · Download · Delete |
| Delete confirm | Delete export "{name}"? The file will be removed and cannot be recovered. |
| Error state (dialog, POST refused) | server `error` verbatim; Start stays enabled so the user can retry; dialog stays open |
| Error state (network, no server message) | Could not reach the server. Check your connection and try again. |
| Destructive actions | Delete export (confirmation via `window.confirm`, above). Cancel export is non-destructive to data and has no confirmation |

Default name (D-05): `{widget title} YYYY-MM-DD HHmm` local time, zero-padded, e.g. "Taxi trips 2026-10-07 1430". Empty widget title falls back to "Export".

---

## Interaction State Matrix

| Surface | State | Behavior |
|---------|-------|----------|
| Dialog | form, count ok | Start enabled when name non-empty |
| Dialog | form, over maxRows | `export-error` row-cap message, Start disabled |
| Dialog | POST in flight | Start "Starting…" disabled, all inputs disabled |
| Dialog | POST refused | `export-error` verbatim, inputs re-enabled, Start enabled |
| Dialog | running | progress bar + text, Cancel export / Close |
| Dialog | closed while running | polling continues in a module-level tracker; on `complete` fire the ready toast; on `failed` fire the error toast; on `cancelled` no toast |
| Dialog | reopened | not supported; user goes to the Exports page |
| Page | first load | Loading text |
| Page | empty / error / list | as above |
| Page | row action in flight | that row's buttons disabled |
| Toast | ready | persists 15 s, has Download action + dismiss `×` |

Tracking stops at a terminal status, when the job is no longer tracked, and on unmount (D-12). A reload re-attaches nothing (D-13).

---

## Acceptance anchors (all must FAIL before the work)

- `grep -c "export-progress-fill" packages/web/src/styles/global.css` reads 0 now, must be >= 1.
- `grep -c "exports-table" packages/web/src/styles/global.css` reads 0 now.
- `grep -c "faDownload" packages/web/src/components/Sidebar.tsx` reads 0 now.
- Every `className="..."` token in the new components must exist in g.css or the new block; verify with a script that extracts class tokens from `ExportDialog.tsx`/`ExportsPage.tsx` and greps g.css. This is the check the project is missing.
- NOT automatically verifiable (route to `checkpoint:human-verify`): progress bar visibility in light AND dark mode; dialog layout; toast action legibility; table column alignment at 1280px width; focus return to Download button.
- **Download controls are `<button>` elements, never `<a>`** (dialog, toast action and Exports-page rows). `.ds-actions > button` (global.css:962) applies `white-space: nowrap` to buttons only, and `btn-sm`/`ghost-sm` are sized for buttons, so an `<a class="btn-primary btn-sm">` would differ in box height, wrapping and underline. The button's onClick navigates to `GET /api/exports/:id/download` (e.g. `window.location.assign(url)`): the response is `Content-Disposition: attachment`, so the page stays put and the browser's download manager owns the transfer, so pause/resume works. Verify visually that Download and its paired ghost button match height in the same `ds-actions` row (add to the human-verify list).
- `role="progressbar"`: set `aria-valuemin=0` and `aria-valuenow=rowsWritten`. Set `aria-valuemax=totalRows` only when `totalRows` is known; omit it otherwise.
- Visual anchor: in the form phase, the Name field (autofocused) leads and "Start export" (the only accent button) closes the row. In the progress phase, the progress bar is the anchor.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none (not initialized, per project convention) | not applicable |
| Third-party | none | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending


## Amendment — operator UAT gap closure (2026-10-08)

Supersedes the form-phase markup above where they differ:
- **Mounting:** the dialog renders via `createPortal(…, document.body)`. Rendered inside a records widget, the grid's CSS transforms trapped `modal-overlay`'s `position: fixed`. Open and close behaviour matches the dashboard modals: overlay click, header Close and Escape close it, and focus returns to the footer Download.
- **Typography / layout:** this is the modal family, not the side-panel family. Name and Values are `ds-field` with a `ds-field-label`. Raw/Formatted is a segmented `radiogroup--buttons` with `radiogroup-button` and `radiogroup-button--selected` (as in DashboardSettingsModal), with `role="radiogroup"` / `role="radio"`. One `config-hint` describes the selected option. `config-group` and `config-group-label` are no longer used. Compress stays `config-toggle`, as in DynamicViewsModal.
- **Compression:** the gzip OS-byte change was reverted (wrong diagnosis: this Mac's Archive Utility refuses every `.gz`). Compression switches to `.zip`; see 131-CONTEXT.md D-07a and plan 131-11.
