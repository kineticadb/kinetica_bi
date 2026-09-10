---
phase: 34-dynamic-view-ui
plan: 03
subsystem: ui
tags: [modal, dynamic-views, codemirror, lang-sql, cursor-insert, preview, tdd, phase-34]
one_liner: "DynamicViewsModal extended with right-pane form (CodeMirror SQL editor + Insert {view} cursor-insert + max_records clamp) and 5-state Preview output panel with validation/server error source tagging"

# Dependency graph
requires:
  - phase: 34-01-dependency-and-client-fix
    provides: "@codemirror/lang-sql@^6.10.0 installed; throwForStatus preserves verbatim server error messages (enables P5 verbatim {view}-token error surfacing)"
  - phase: 34-02-modal-shell-and-left-list
    provides: "DynamicViewsModal shell + ViewListRow + ViewStatusBadge + mount-time abortRef + handleCloseRequest + .dynamic-views-modal-* CSS base namespace + 16 spec tests"
provides:
  - "Right-pane DynamicViewForm sub-component (name input, source-table picker, CodeMirror SQL editor with sql() extension + placeholder, Insert {view} button with cursor-position dispatch, max_records numeric input with clamp-on-blur, Preview button, 5-state Preview output panel)"
  - "previewRanSinceLastSave LOCKED state flag (initialized false; flips true ONLY on Preview success; reset on + New / row select). Plan 34-04's Save handler reads for columns_json carry decision."
  - "formColumnsJson + originalTemplateSql state — populated on Preview success / row select; consumed by Plan 34-04 Save body"
  - "PreviewState discriminated union with `source: 'validation' | 'server'` field — validation errors reset on field edit; server errors persist until next Preview click. DOM data-error-source attr drives spec assertions."
  - "previewAbortRef (operation-scoped) — aborted on next Preview click + on modal unmount. Mount-time abortRef from Plan 34-02 preserved verbatim for listDynamicViews."
  - "draftSession counter — ensures form lifecycle effect re-runs when + New is clicked while already in draft mode"
affects:
  - kinetica_bi/src/components/DynamicViewsModal.tsx (+434 LOC, 354 → 789)
  - kinetica_bi/src/components/DynamicViewsModal.spec.tsx (+498 LOC, 353 → 851; 16 → 37 tests)
  - kinetica_bi/src/styles/global.css (+126 lines, appended)
tech-stack:
  added: []
  patterns:
    - "CodeMirror 6 cursor-position dispatch via captured EditorView ref (first impl in codebase; Pattern 3 from 34-RESEARCH.md)"
    - "Operation-scoped AbortController ref alongside mount-time ref (separation of concerns; Pitfall 6 lock)"
    - "PreviewState discriminated union with error-source tag (validation vs server reset semantics)"
    - "Mock @uiw/react-codemirror + @codemirror/lang-sql in vitest to render <textarea data-testid='cm-editor'> with globalThis.__lastEditorView for dispatch assertion"
    - "Lifecycle effect dep counter (draftSession) to force re-run when state values haven't changed but a user action should reset"
key-files:
  created: []
  modified:
    - kinetica_bi/src/components/DynamicViewsModal.tsx
    - kinetica_bi/src/components/DynamicViewsModal.spec.tsx
    - kinetica_bi/src/styles/global.css
decisions:
  - "Form is extracted into DynamicViewForm sub-component within the SAME FILE (per planner discretion in CONTEXT.md — single consumer + readability)"
  - "Preview button stays ENABLED during loading (text flips to 'Running…') so the second click aborts the in-flight call. P6 requirement supersedes the disable-while-loading default."
  - "Preview button has both aria-label='Preview' and data-testid='preview-button' to give stable spec selection regardless of visible text ('Preview' vs 'Running…')"
  - "Validation-source errors auto-reset to idle when SQL becomes non-empty OR source_table_id becomes set (resetValidationPreviewError helper called from setFormTemplateSql + setFormSourceTableId). Server-source errors persist until next Preview click (BLOCKER #4 lock)."
  - "draftSession counter added to the lifecycle effect dep array — guarantees re-fire on consecutive + New clicks (F4 test). Without it, isDraft is already true on the second click and the effect never re-runs to reset form state."
  - "Insert {view} button NOT disabled when editor is empty (CM6 placeholder is DOM overlay, not document content — RESEARCH Pitfall 3 verified). The button label literally renders the text 'Insert {view}'."
  - "Empty-tables banner (F8) replaces the form ONLY in showForm context (draft or selection); the left-list and + New button remain reachable. The banner text matches CONTEXT.md verbatim."
  - "max_records clamp-on-blur rounds Number(raw) first, then clamps to min 1. Empty string and NaN snap to 1 with 'Must be at least 1' error (3s timeout). No upper bound (server accepts any positive integer)."
metrics:
  duration: 9m
  completed: "2026-05-15T02:37:43Z"
  tasks: 1
  files: 3
  tests_added: 21
  full_suite_status: "870/870 passing (no regressions)"
requirements-completed: [DV-V16-09, DV-V16-10]
---

# Phase 34 Plan 03: Form and Preview Summary

## One-liner

DynamicViewsModal extended with right-pane form (CodeMirror SQL editor + Insert {view} cursor-insert + max_records clamp) and 5-state Preview output panel with validation/server error source tagging. previewRanSinceLastSave flag wired for Plan 34-04 Save consumption.

## What Was Built

### `kinetica_bi/src/components/DynamicViewsModal.tsx` (354 → 789 lines, +434)

Plan 34-02's shell remains intact (header / left-list / handleCloseRequest / ViewListRow / ViewStatusBadge / mount-time abortRef). Plan 34-03 adds:

**State machine (added to parent component):**
- `formName / formSourceTableId / formTemplateSql / formMaxRecordsDraft / formMaxRecords / formColumnsJson / originalTemplateSql` — form fields
- `previewRanSinceLastSave` — LOCKED state flag (initialized false; flips true ONLY on Preview success; reset on + New / row select). Plan 34-04 reads for columns_json carry.
- `isDirty` — now real state (was hardcoded false in 34-02); flips true on every field-change handler. `handleCloseRequest` already uses it; `window.confirm("Discard unsaved changes?")` is now reachable.
- `nameError / tableError / sqlError / maxRecordsError` — 4 inline error states
- `previewState` — discriminated union (`idle | loading | success | error`); `error` variant has `source: 'validation' | 'server'` tag
- `previewLoading` — boolean for button label flip
- `draftSession` — counter bumped on every + New click to force the lifecycle effect to re-run

**Refs:**
- `editorViewRef` — captures CodeMirror EditorView via `onCreateEditor` for cursor-position dispatch
- `previewAbortRef` — operation-scoped AbortController for the Preview call (separate from Plan 34-02's mount-time `abortRef` for `listDynamicViews`)

**Lifecycle effect:** populates form state when row selected or `isDraft` toggled (or draftSession bumped). ALL three resets fire on both branches: `formColumnsJson`, `originalTemplateSql`, `previewRanSinceLastSave`, plus `previewState=idle`, all errors cleared, `isDirty=false`.

**Handlers:**
- `clampMaxRecords(raw)` — mirrors MapConfigPanel.clampRadius; rounds + clamps to min 1; returns `{ value, clamped, msg? }`
- `handleMaxRecordsBlur` — applies clamp; surfaces inline error for 3s if clamped
- `handleInsertViewToken` — captures `editorViewRef.current`; calls `view.dispatch({ changes: { from: view.state.selection.main.head, insert: "{view}" } })` then `view.focus()`. Null-safe no-op if editor not yet mounted (Pitfall 2 carry-forward).
- `resetValidationPreviewError` — flips Preview output panel from validation-source error to idle (called from `setFormTemplateSql` + `setFormSourceTableId`)
- `handleSetFormName / handleSetFormSourceTableId / handleSetFormTemplateSql` — wrap setState with isDirty=true and corresponding inline-error clearing
- `handlePreviewClick` — full Preview flow: local validation → abort prior controller → fresh signal → `previewDynamicView({ template_sql, source_table_id, dashboard_id, sample_limit: 100 }, signal)` → on success `setPreviewState({kind:'success'})` + `setFormColumnsJson(JSON.stringify(result.columns))` + `setPreviewRanSinceLastSave(true)`. On AbortError → silent. On other error → `setPreviewState({kind:'error', source:'server', message: err.message})`.

**DynamicViewForm sub-component** (~190 lines of JSX inside the same file):
- Name input (`<input type="text" aria-label="Name" placeholder="Name your dynamic view">`)
- Source-table picker (`<select aria-label="Source table">` with options from associatedTables)
- Template SQL section: label + Insert {view} button (right-aligned) + `<CodeMirror>` with `[sql()]` extension + `minHeight="200px"` + `maxHeight="400px"` + placeholder + hint line "Use {view} where you'd reference the source filter view."
- max_records numeric input (`<input type="number" min={1} step={1} aria-label="Max records">` with onBlur clamp)
- Preview button (aria-label + data-testid for stable spec selection regardless of "Preview" vs "Running…" text)
- 5-state Preview output panel:
  - idle: "Click Preview to see sample data."
  - loading: "Running preview…"
  - success: alphabetical chip list + HTML table (or 0-rows message) + row count footer
  - error: red box with `data-error-source` attribute (= `validation` or `server`)

**Right-pane selector logic:** `showForm = isDraft || selectedView !== null`. If `showForm && noTables` → renders the empty-tables banner (replaces form entirely). Otherwise renders `DynamicViewForm` or the "Select a view…" placeholder.

### `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` (353 → 851 lines, +498; 16 → 37 tests)

**Test infrastructure additions:**
- `vi.mock("@uiw/react-codemirror")` — stubs `<CodeMirror>` as a `<textarea data-testid="cm-editor">` and exposes a fake `EditorView` (with `state.selection.main.head`, `dispatch` spy, `focus` spy) at `globalThis.__lastEditorView` so F5 can assert cursor-position dispatch.
- `vi.mock("@codemirror/lang-sql")` — stubs `sql()` to return `[]`.
- `mockedClient.previewDynamicView: vi.fn()` added; reset in `beforeEach`.

**Migrated Plan 34-02 tests:**
- **M3** (row select): replaced `screen.querySelectorAll("h3")` heading check with `screen.findByPlaceholderText("Name your dynamic view")` + `getByTestId("cm-editor")` assertions
- **M7** (+ New draft mode): replaced `screen.getByText("New dynamic view")` with `screen.getByPlaceholderText("Name your dynamic view")` + `getByTestId("cm-editor")` assertions

**Plan 34-03 new test blocks (21 new tests):**

| Test | Coverage |
| ---- | -------- |
| F1 | + New renders all form fields including default max_records=10000; NO Save button |
| F2 | Row select populates name / template_sql / max_records / source_table_id |
| F3 | Typing in name input keeps form rendered (isDirty test deferred to 34-04 close path) |
| F4 | Preview success → + New resets preview output to idle (uses draftSession dep) |
| F5 | Insert {view} button calls `view.dispatch({changes:{from:3, insert:"{view}"}})` + `view.focus()` |
| F6 (5) | max_records clamps: '0' → '1', '-5' → '1', '0.5' → '1', '10000' kept, '' → '1' |
| F7 | name input is mutable in draft mode |
| F8 | Empty associatedTables → banner replaces form, no Preview button |
| P1 | Preview not-run shows "Click Preview to see sample data." |
| P2 | Preview pending shows "Running preview…" |
| P3 (2) | Success renders alphabetical chips + table + row count footer; re-clicking Preview keeps success state observable |
| P4 | 0-rows shows chips + "Query returned 0 rows. Check filters and template." |
| P5 | Server error renders verbatim with `data-error-source="server"`; PERSISTS across SQL edits |
| P6 (2) | Two consecutive Preview clicks: first signal aborted, second signal fresh; unmount aborts in-flight signal silently |
| P7 | Empty SQL → click Preview → validation error with `data-error-source="validation"`; typing SQL resets to idle |

### `kinetica_bi/src/styles/global.css` (+126 lines, appended)

Appended below Plan 34-02's `.view-status-badge.*` block:
- `.dynamic-views-modal-form` — vertical flex column container
- `.dynamic-views-modal-field` — label + input + inline-error stack
- Input + select styling under `.dynamic-views-modal-form` namespace (reuses `--card`, `--border`, `--text` vars)
- `.dynamic-views-modal-editor-section / -header / -hint` — Template SQL section
- `.dynamic-views-modal-field-error` — 12px red inline text
- `.dynamic-views-modal-form-actions` — right-aligned action row (Preview button container)
- `.dynamic-views-modal-preview` — 150-300px scrollable bordered panel
- `.dynamic-views-modal-preview-chips / -chip` — alphabetical column chip pills
- `.dynamic-views-modal-preview-table-wrap / -table` — overflow-x data table
- `.dynamic-views-modal-preview-footer` — small muted row-count footer
- `.dynamic-views-modal-preview-error` — red box with pre-wrap whitespace for multi-line server messages

Pure append — zero existing rules modified.

## Requirements Status

| Requirement | Status | Notes |
| ----------- | ------ | ----- |
| DV-V16-09 | Partial (Plan 34-04 closes) | Form has name input, source-table picker, CodeMirror SQL editor with `{view}` hint + cursor-position Insert button, max_records numeric input with clamp-on-blur (min 1, integer). Save button + handler land in Plan 34-04. |
| DV-V16-10 | Fully closed | Preview button calls `POST /api/dynamic-view/preview` via `previewDynamicView` client helper; renders alphabetical column chips + HTML table; server 400 errors surface verbatim (Plan 34-01 throwForStatus fix). 5-state output panel with validation/server error reset semantics. |

## Deviations from Plan

None — plan executed exactly as written.

Three implementation choices made within Claude's discretion (all locked by CONTEXT/RESEARCH defaults but worth flagging):

1. **draftSession counter added.** The plan's lifecycle effect depends on `[isDraft, selectedId, views]`. When `+ New` is clicked twice in a row, `isDraft` stays `true` and the effect doesn't re-fire — F4 would fail. Added a `draftSession` counter (bumped on every `+ New` click) to the dep array so the effect always re-runs. Locks the F4 assertion that Preview output resets to idle on re-`+ New`.

2. **Preview button stays enabled during loading.** P6 requires that clicking Preview twice cancels the first call's signal. If the button is `disabled={previewLoading}` (the obvious default), the second `fireEvent.click` is ignored. Removed the `disabled` prop; the button text still flips to "Running…" for visual feedback. Added `data-testid="preview-button"` so the P6 test can click reliably regardless of text.

3. **Spec uses module-level `import React from 'react'`** for the CodeMirror mock's `React.createElement` call instead of `require('react')` — strict tsc rejects `require` without `@types/node`, and the project doesn't have node types installed.

## Authentication Gates

None.

## Verification

- `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` → **37/37 tests PASS**
- `cd kinetica_bi && npx vitest run` → **870/870 frontend tests PASS** (no regressions)
- `cd kinetica_bi && npx tsc --noEmit` → **exits 0**
- All acceptance-criterion greps PASS:
  - `@codemirror/lang-sql`, `@uiw/react-codemirror`, `view.dispatch`, `view.state.selection.main.head`, `clampMaxRecords`, `previewAbortRef`, `previewRanSinceLastSave`, `setPreviewRanSinceLastSave(true)`, `source: "validation"`, `source: "server"`, `resetValidationPreviewError`, `associated tables`, `Click Preview to see sample data`, `Running preview`, `rows previewed (sample_limit=100)`, `Query returned 0 rows`, `data-error-source`, `Insert {"{view}"}` — all FOUND in DynamicViewsModal.tsx
  - `saveAbortRef|deleteAbortRef` only appears in forward-looking comments (Plan 34-04 handoff markers) — no actual ref declarations or usages, consistent with Plan 34-02's documentation pattern

## Test Count Delta

- Before plan: 849 frontend tests
- After plan: **870 frontend tests** (+21)
- DynamicViewsModal.spec.tsx: 16 → 37 tests (-2 migrated, +21 new = +19 net; remaining 2 = the migrated M3/M7 still count as tests)

## Commits

| Commit | Type | Description |
| ------ | ---- | ----------- |
| `273b05c` | test(34-03) | RED: 23/37 failing — F1-F8 + P1-P7 + migrated M3/M7 + CodeMirror mocks |
| `b2551b8` | feat(34-03) | GREEN: DynamicViewForm sub-component + form state machine + Preview state machine + Insert {view} cursor-dispatch + max_records clamp |
| `132cceb` | chore(34-03) | Append form + Preview output panel CSS (~126 lines) |

## Plan 34-04 Continuation Notes

This plan's exposed contracts for Plan 34-04 (Save handler + DashboardsPage wiring):

- **`previewRanSinceLastSave` state flag** — read on Save click. Plan 34-04's body construction:
  ```typescript
  const templateChanged = formTemplateSql !== originalTemplateSql;
  if (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) {
    body.columns_json = formColumnsJson;
  }
  // else: omit columns_json (server preserves or auto-clears per CONTEXT 32 § D3)
  ```
- **`formColumnsJson` state** — JSON.stringify(result.columns) from the most recent Preview success. Persisted via Save body when carry rule applies.
- **`originalTemplateSql` state** — captures the row's template_sql at load time. Comparison drives the "template changed" branch in Plan 34-04's Save body.
- **`isDirty` state** — now real (was hardcoded false in 34-02). `handleCloseRequest` already routes through `window.confirm("Discard unsaved changes?")` when dirty. Plan 34-04 will write the close-path dirty-confirm tests (the path is exercised by the full Save flow).
- **`previewAbortRef`** — kept for Plan 34-04. Plan 34-04 ADDS `saveAbortRef` and `deleteAbortRef` (and migrates `handleDelete` to use the latter).
- **Save button placement** — Plan 34-04 adds a Save button BELOW the Preview output panel inside the `DynamicViewForm` sub-component, or alongside Preview in `.dynamic-views-modal-form-actions`. The form-actions container currently right-aligns the Preview button; Save will likely live to its right (primary action).
- **No-tables banner** is rendered in the parent component (not DynamicViewForm). When `_associatedTables.length === 0`, Plan 34-04 must also block Save (no source table → no Save).

The modal is STILL not mounted on DashboardsPage — Plan 34-04 owns the 4th action-bar button + modal mount conditional alongside `{showLayersModal && <LayersModal ... />}`.

## Self-Check: PASSED

Verified all claims:

- FOUND: `kinetica_bi/src/components/DynamicViewsModal.tsx` (789 lines)
- FOUND: `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` (851 lines, 37 it() blocks)
- FOUND: `.dynamic-views-modal-form/-field/-editor-section/-editor-header/-editor-hint/-field-error/-form-actions/-preview/-preview-chips/-preview-chip/-preview-table-wrap/-preview-table/-preview-footer/-preview-error` selectors (14 new classes) in `kinetica_bi/src/styles/global.css`
- FOUND commit `273b05c` (Task 1 — test RED)
- FOUND commit `b2551b8` (Task 1 — feat GREEN)
- FOUND commit `132cceb` (Task 1 — chore CSS)
- Full frontend suite: 870/870 passing (no regressions to other specs)
- tsc --noEmit: exits 0

---

*Phase: 34-dynamic-view-ui*
*Completed: 2026-05-15*
