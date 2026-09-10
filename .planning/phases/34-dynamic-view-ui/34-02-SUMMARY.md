---
phase: 34-dynamic-view-ui
plan: 02
subsystem: ui
tags: [modal, dynamic-views, dashboard-ui, tdd, phase-34]
one_liner: "DynamicViewsModal shell + left list + delete flow — two-pane modal mirroring LayersModal with per-row status badges and inline delete-confirm"
requires:
  - useDynamicViewStore (Phase 33)
  - listDynamicViews + deleteDynamicView client helpers (Phase 33)
  - useToastStore (existing)
  - .modal-overlay + .modal-content.modal-layers CSS shell (Phase 12)
provides:
  - DynamicViewsModal default-export React component (dormant — Plan 34-03 wires DashboardsPage 4th button)
  - .dynamic-views-modal-* CSS namespace
  - ViewListRow + ViewStatusBadge sub-components (encapsulated per-row store subscription pattern)
affects:
  - kinetica_bi/src/components/* (new file)
  - kinetica_bi/src/styles/global.css (~150 lines appended)
tech-stack:
  added: []
  patterns:
    - Two-pane modal mirroring LayersModal (Phase 12 structural template)
    - Per-row scoped useDynamicViewStore selector (PITFALL S-02/C-02 carry-forward)
    - Inline delete-confirm state machine (trash → [Delete view][Keep view] swap)
    - Mount-time AbortController on listDynamicViews
    - handleCloseRequest wrapper routes ESC + backdrop + Close button through one helper
key-files:
  created:
    - kinetica_bi/src/components/DynamicViewsModal.tsx (354 lines)
    - kinetica_bi/src/components/DynamicViewsModal.spec.tsx (353 lines, 16 tests)
  modified:
    - kinetica_bi/src/styles/global.css (+149 lines)
decisions:
  - Modal ships dormant — DashboardsPage 4th button + modal mount is Plan 34-03 scope
  - isDirty is hardcoded false this plan; handleCloseRequest wrapper exists but window.confirm never fires (form fields and dirty tracking are 34-03)
  - + New button toggles draft state; right pane shows "New dynamic view" heading + form-placeholder text (34-03 replaces placeholder with actual form)
  - Row selection shows selected view name as heading in right pane (34-03 replaces with form rendering)
  - Toast kinds restricted to "info" / "error" — no "warning" (toast type union doesn't include it; RESEARCH.md correction #2)
  - dashboardId as PROP not via DashboardContext — provider doesn't wrap modal region (RESEARCH.md correction #3)
  - Per-row primitive selectors via ViewListRow sub-component (avoids re-render storm; PITFALL S-02/C-02)
  - Status badge testid="view-status-badge" + data-status attr — drives M11 spec assertions and renders FA icons (faCheck, faSpinner, faTriangleExclamation, faCircleExclamation)
  - Mount-time AbortController on listDynamicViews; Plan 34-03 ADDS previewAbortRef + saveAbortRef; Plan 34-04 ADDS deleteAbortRef and migrates handleDelete
  - .dynamic-views-modal-* CSS namespace reuses .modal-overlay + .modal-content.modal-layers (900px size class) for shell; only inner body grid + per-row styling is new
metrics:
  duration: 6m
  completed: "2026-05-15T02:24:30Z"
  tasks: 3
  files: 3
  tests_added: 16
  full_suite_status: "849/849 passing (no regressions)"
---

# Phase 34 Plan 02: Modal Shell and Left List Summary

## One-liner

DynamicViewsModal shell + left list + delete flow — two-pane modal mirroring LayersModal with per-row status badges and inline delete-confirm. Ships dormant (Plan 34-03 wires DashboardsPage 4th button).

## What Was Built

### `kinetica_bi/src/components/DynamicViewsModal.tsx` (354 lines, new)

Two-pane Dashboard-scoped Dynamic Views management modal:

- **Modal shell:** `.modal-overlay` portal + `.modal-content.modal-layers` 900px size class (Phase 12 reuse). Header with title "Dynamic Views" + Close button.
- **handleCloseRequest wrapper:** ESC handler, backdrop click, and Close button all route through one helper. `isDirty` is hardcoded false this plan; Plan 34-03 will wire form-field dirty tracking and the `window.confirm("Discard unsaved changes?")` path becomes live.
- **Mount-time AbortController:** `listDynamicViews(dashboardId, signal)` fires on mount; signal aborts on unmount. Plan 34-03 will KEEP this `abortRef` for listing and ADD `previewAbortRef` + `saveAbortRef`. Plan 34-04 will ADD `deleteAbortRef` and migrate `handleDelete` to use it.
- **Left list** with three states: loading (`"Loading…"`), empty (`"No dynamic views yet."`), populated (rows with name + status badge + trash). `+ New dynamic view` button at bottom.
- **`ViewListRow` sub-component:** Encapsulates per-row scoped selectors `useDynamicViewStore((s) => s.views[row.id]?.status)` (and `.reason`, `.error`). Prevents re-render storm — each row subscribes ONLY to its own status change (PITFALL S-02/C-02 carry-forward).
- **Inline delete-confirm:** Trash button (`aria-label="Delete view"`) swaps to `[Delete view] [Keep view]` text buttons on click. Confirm fires `deleteDynamicView(id)` → `useDynamicViewStore.getState().clearView(id)` → local row removal → toast `"View deleted"` (kind `"info"`). Error path: toast `"Failed to delete view: <message>"` (kind `"error"`), row preserved, confirm state reset.
- **`ViewStatusBadge` sub-component:** Renders one of four flavors based on status (with `data-testid="view-status-badge"` + `data-status` attr for spec assertions):
  - `materialized` — green check (faCheck), title `"Materialized"`
  - `pending` — spinner (faSpinner with spin), title `"Materializing…"`
  - `over_threshold` — amber triangle (faTriangleExclamation), title `"No filter active"` or `"Exceeds max records"` based on `reason`
  - `error` — red exclamation (faCircleExclamation), title = error message
- **Right pane** with three states: empty placeholder (`"Select a view or click + New to get started."`), selected view (heading shows view name + placeholder text), draft mode (heading shows `"New dynamic view"` + placeholder text). Plan 34-03 replaces placeholder text with the actual form.
- **Props contract:** `{ dashboardId: number; associatedTables: TableDto[]; onClose: () => void }`. `associatedTables` is pass-through this plan (reserved for 34-03 form).

### `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` (353 lines, 16 tests, new)

Coverage matrix M1-M12 from plan:
- **M1 (2 tests):** Mount + initial render — `.modal-overlay` + title + empty state + right-pane placeholder + visible `+ New dynamic view` button
- **M2 (2 tests):** Mount with views — all rows render with names + trash buttons; right pane initially shows empty-state placeholder
- **M3 (2 tests):** Row selection — active class applied + view name appears as h3 heading in right pane; clicking different row swaps active
- **M4 (1 test):** ESC handler — `fireEvent.keyDown(window, { key: "Escape" })` → onClose called once
- **M5 (2 tests):** Click-outside backdrop → onClose; click inside content → NOT onClose
- **M6 (1 test):** Close button → onClose called once
- **M7 (1 test):** `+ New dynamic view` button → right pane shows `"New dynamic view"` heading
- **M8 (1 test):** Inline delete-confirm happy path — `deleteDynamicView` called with row.id, `clearView` clears store entry, toast `("View deleted", "info")` fires, row removed from list
- **M9 (1 test):** Inline delete-confirm cancel — `[Keep view]` click → `deleteDynamicView` NOT called, trash icon returns
- **M10 (1 test):** Inline delete-confirm error — rejected promise → toast `("Failed to delete view: Server down", "error")`, row preserved, confirm state reset
- **M11 (1 test):** Status badge per row via real `useDynamicViewStore.getState().setView()` action — exercises Phase 33 mutation path (not raw `setState`); seeded badge renders with `data-status="materialized"`; mutating to `over_threshold` updates `data-status` + title contains `"No filter active"`
- **M12 (1 test):** AbortController cleanup — `listDynamicViews` signal captured; `unmount()` flips `signal.aborted` to true

Toast spy implementation uses a typed-cast `vi.spyOn(useToastStore.getState(), "showToast").mockImplementation(...)` recording calls into a local array (TS-friendly pattern; raw `ReturnType<typeof vi.fn>` failed strict typing).

### `kinetica_bi/src/styles/global.css` (+149 lines)

New `.dynamic-views-modal-*` namespace under `Phase 34 (DV-V16-08, DV-V16-11)` section comment:
- Layout: `.dynamic-views-modal-body` (320px / 1fr grid), `.dynamic-views-modal-left` (border-right scroll), `.dynamic-views-modal-right` (padded scroll), `.dynamic-views-modal-list`, `.dynamic-views-modal-add` (border-top button area), `.dynamic-views-modal-empty` (+ `.error` variant)
- Row: `.view-row` (grid with hover + active states), `.view-row-name` (truncating bold), `.view-row-actions`, `.view-row-btn` (+ `.danger` variant)
- Badge: `.view-status-badge` + four status variants reusing project tokens (`--accent` for materialized, `--muted` for pending, `#f59e0b` for over_threshold, `#ef4444` for error)

Reuses project CSS variables (`--accent`, `--border`, `--muted`, `--card`, `--text`) for parity with Phase 12 `.layers-modal-*` pattern. Shell itself reuses `.modal-overlay` + `.modal-content.modal-layers` (900px) — only inner body grid + per-row styling is new. **APPEND-ONLY**: zero existing CSS rules modified.

## Requirements Status

| Requirement | Status | Notes |
| ----------- | ------ | ----- |
| DV-V16-08 | Partial (closes in 34-03) | Dashboard-scoped modal lists existing dynamic views with delete affordance. "Edit" surface = row selection (right-pane heading shows selected name); full edit form lands in Plan 34-03. |
| DV-V16-11 | Fully closed | Delete fires `DELETE /api/dynamic-view/:id` (via `deleteDynamicView`), removes the row, clears the store entry (`clearView`), toasts success. Error path documented + tested. |

## Deviations from Plan

None — plan executed exactly as written. Three minor implementation refinements applied during Task 2 to satisfy `tsc --noEmit`:

1. **Spec `sampleTables` fixture:** Added `created_at` + `updated_at` to the `TableDto` literal (plan example had `as TableDto` cast which failed strict TS conversion because no overlap). Cleanly resolved by adding the missing required fields — no behavior change.
2. **Spec toast spy type:** Replaced `let showToastSpy: ReturnType<typeof vi.fn>` with a typed function + call-log pattern (`(message: string, kind?: string) => void` plus `showToastCalls: Array<[string, string | undefined]>`). Original spread-args `vi.fn()` failed TS strict checks. Resolved via mockImplementation cast + helper assertion `expectToastCalledWith`. No coverage change — same assertions, TS-clean.
3. **Acceptance criterion `grep -q 'CodeMirror\|sql('`** triggers on the comment line `* - Form fields, CodeMirror, max_records, Preview, Save` (intentional out-of-scope marker, not an actual import). Per plan intent — file genuinely does NOT import CodeMirror or call `sql()`. Verified by inspecting actual usage: only the comment mentions the name.

## Authentication Gates

None.

## Verification

- `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` → **16/16 tests PASS**
- `cd kinetica_bi && npx vitest run` → **849/849 frontend tests PASS** (no regressions to other specs because DynamicViewsModal is not yet mounted from DashboardsPage)
- `cd kinetica_bi && npx tsc --noEmit` → **exits 0** (no type errors)

## Test Count Delta

- Before plan: 833 frontend tests
- After plan: **849 frontend tests** (+16)

## Commits

| Commit | Type | Description |
| ------ | ---- | ----------- |
| `0bbd3bd` | test(34-02) | add failing spec for DynamicViewsModal shell + left list + delete |
| `39a1a8b` | feat(34-02) | implement DynamicViewsModal shell + left list + delete (GREEN) |
| `482059d` | chore(34-02) | add .dynamic-views-modal-* CSS namespace |

## Plan 34-03 Continuation Notes

- DynamicViewsModal is **NOT yet mounted from DashboardsPage** — Plan 34-03 owns the 4th action-bar button + modal-mount conditional alongside `{showLayersModal && <LayersModal ... />}`.
- **Right-pane placeholder texts** in `DynamicViewsModal.tsx` (the `"Form coming in next plan (34-03)."` paragraphs and the `"New dynamic view"` / `selectedView.name` headings) are intentional handoff points — Plan 34-03 replaces with actual form rendering (name input, table picker, SQL editor, max_records input, Preview button, Preview output panel, Save button).
- **Spec inline comments** flag the future updates (`// 34-03 NOTE:` markers in M3 and M7). When 34-03 replaces placeholder text with the rendered form, those two assertions migrate to form-field checks (e.g., `screen.getByLabelText("Name")` or `screen.getByPlaceholderText("Name your dynamic view")`).
- **Dirty tracking:** `isDirty` is hardcoded `false`. Plan 34-03 lifts it to component state, wires `setIsDirty(true)` on every form-field change handler, and resets to `false` on Save success / Discard. The `handleCloseRequest` wrapper + ESC effect dep on `[isDirty]` are already in place — no shell changes needed.
- **AbortController ref:** Plan 34-03 KEEPS `abortRef` for the listing call (unchanged) and ADDS `previewAbortRef` + `saveAbortRef`. Plan 34-04 ADDS `deleteAbortRef` and migrates `handleDelete` to use it.
- **Status badge contract** is locked: `data-testid="view-status-badge"` + `data-status` attr. Plan 35 renderer consumers won't touch the modal — they read `useDynamicViewStore.views[id].status` directly.

## Self-Check: PASSED

Verified all claims:

- FOUND: `kinetica_bi/src/components/DynamicViewsModal.tsx` (354 lines)
- FOUND: `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` (353 lines, 16 tests)
- FOUND: `.dynamic-views-modal-*` CSS namespace (22 selectors) in `kinetica_bi/src/styles/global.css`
- FOUND commit `0bbd3bd` (Task 1 — test RED)
- FOUND commit `39a1a8b` (Task 2 — feat GREEN)
- FOUND commit `482059d` (Task 3 — chore CSS)
- Full frontend suite: 849/849 passing (no regressions)
- tsc --noEmit: exits 0
