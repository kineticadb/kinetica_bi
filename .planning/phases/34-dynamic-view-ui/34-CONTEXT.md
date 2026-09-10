# Phase 34: dynamic-view-ui - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the dashboard-level "Dynamic Views" management modal — a two-pane modal (mirrors `LayersModal` Phase 12) that operators open via a new 4th action-bar button. Inside: list existing dynamic views with edit/delete affordances; create/edit form with name + source-table picker + CodeMirror SQL editor + max-records numeric input + Preview button + Save button + Preview output panel.

**Phase 34 also fires `materializeDynamicView` directly via Phase 33 client helpers** on Save (immediately after `createDynamicView` / `updateDynamicView` succeeds) — operator gets in-modal feedback on materialize outcome (toast + left-list badge). Phase 35 renderers will later read the same `useDynamicViewStore` state and trigger cascading re-materialize on filter-view version bump.

In scope:
- New "Dynamic Views" action-bar button at `kinetica_bi/src/components/DashboardsPage.tsx:705-707` area (4th button after "Map Layers")
- New modal component `kinetica_bi/src/components/DynamicViewsModal.tsx` (+ spec) — two-pane layout, `.modal-overlay` portal shell, ESC to close, dirty-state confirm on close-with-unsaved-changes
- New form sub-component if useful (Claude's discretion) — likely inline in DynamicViewsModal since the form is single-purpose (unlike `KineticaWmsLayerForm` which is shared)
- CodeMirror SQL editor wired with `@codemirror/lang-sql` (new dependency), min-height 200px / max-height 400px, line numbers ON, light theme
- "Insert {view}" button above editor + inline hint text + server-only `{view}` validation
- Preview output panel below the form (bottom of right pane, above Save): chip-style column list (name + type) + first-N-rows HTML table
- Save flow: `createDynamicView` (or `updateDynamicView`) → `markPending(id, viewName)` → `materializeDynamicView(id)` → `setView`/`setError` → toast outcome; AbortController wraps the materialize call (cancelled on modal close)
- Left-list badge per view reading `useDynamicViewStore.views[id].status` for persistent state (materialized / over_threshold / pending / error)
- Inline delete confirm (LayersModal pattern: trash icon swaps to `[Delete view] [Keep view]`)
- New CSS (recommend `.dynamic-views-modal-*` namespace) in `kinetica_bi/src/styles/global.css`
- Extended specs at `DashboardsPage.spec.tsx` to assert button opens modal

Out of scope (deferred to later phases):
- Widget binding — ChartConfigPanel "Data Source" picker → Phase 35 (DV-V16-12)
- Renderer FROM/LAYERS-swap against resolved dynamic view → Phase 35 (DV-V16-13)
- Cascading re-materialize on filter-view bump → Phase 35
- Over-threshold widget empty state ("Too much data — narrow your filters") → Phase 35 (DV-V16-14)
- E2E verification → Phase 36 (VERIFY-V16-01)
- Cross-dashboard dynamic-view sharing — locked OUT per CONTEXT 32 § D4
- URL/localStorage persistence of edit state — explicitly out (PERSIST-V2)
- SQL syntax error live-underline (Monaco-style) — out (CodeMirror lang-sql doesn't provide line/col positions from server errors)
- Auto-complete on `{` keystroke — overkill for one token

</domain>

<decisions>
## Implementation Decisions

### Modal architecture

**Two-pane layout, mirrors LayersModal verbatim:**
- Left pane: list of existing dynamic views for this dashboard. Each row: name + materialize-status badge + trash icon. Click row → right pane loads form for edit. "+ New dynamic view" button at top.
- Right pane: form (name, table picker, SQL editor, max-records, Preview button, Preview output panel, Save button). Empty state when no item selected: "Select a view or click + New."
- Modal width: match LayersModal's `.modal-layers` 900px max-width or introduce `.modal-dynamic-views` with same width. Recommend reusing the size class if no other style differs.
- Modal shell: `.modal-overlay` portal with click-outside-to-close → routes through the dirty-state confirm.
- ESC key: closes modal → routes through dirty-state confirm.

**Inline form component:** Recommend NO shared form component. Unlike `KineticaWmsLayerForm` (reused by `LayersModal`), the dynamic-view form has no other consumer. Keep the JSX inline inside `DynamicViewsModal.tsx` — easier to evolve. If file size becomes unwieldy (>500 LOC), planner can extract; planner has discretion.

### Save flow (explicit Save button, NOT auto-save)

Diverges from LayersModal auto-save pattern intentionally. ROADMAP success criterion 4 says "Save persists the dynamic view + immediately triggers a materialize check" — explicit gesture. SQL is heavy enough that per-keystroke PATCH is wasteful.

**Form state:** Local React state inside the modal. Tracks `{ name, source_table_id, template_sql, max_records, columns_json }` plus dirty flag (`isDirty`).

**Save button behavior (on click):**
1. Validate locally: `name` non-empty, `source_table_id` chosen, `template_sql` non-empty, `max_records >= 1`. If fail → inline form errors, no network call.
2. Disable Save + show spinner.
3. Call `createDynamicView(dashboardId, body)` for new, OR `updateDynamicView(id, body)` for edit. Body includes `columns_json` if Preview ran successfully (persists the columns_json the server returned from Preview); otherwise omit columns_json on create (server defaults null) or carry forward existing on update.
4. On 400 (e.g., missing `{view}` token): re-enable Save; surface server error message inline below the editor in red.
5. On other error: re-enable Save; toast with error message.
6. On 201/200 (CRUD success): proceed to materialize step.

**Materialize step (immediately after CRUD success):**
1. Compute `viewName = buildDynamicViewName({ userId, dashboardId, dynamicViewId: row.id })` using Phase 33 frontend helper.
2. Call `useDynamicViewStore.getState().markPending(row.id, viewName)`.
3. Call `materializeDynamicView(row.id, abortSignal)` with the modal-scoped `AbortController.signal`.
4. On `{ status: "materialized", view_name, row_count, expires_at }`: `setView(row.id, { viewName: view_name, status: "materialized", expiresAt: expires_at })` + toast `"Dynamic view materialized"`.
5. On `{ status: "over_threshold", reason: "no_filter" }`: `setView(row.id, { viewName, status: "over_threshold", reason: "no_filter" })` + toast `"Saved — no filter active; view will materialize when a filter is applied."`.
6. On `{ status: "over_threshold", reason: "exceeds_max_records", row_count }`: `setView(row.id, { viewName, status: "over_threshold", reason: "exceeds_max_records" })` + toast `"Saved — {N} rows exceeds max_records {M}; raise the threshold or narrow filters."`.
7. On AbortError: silent (user closed modal — V13-P-12 carry-forward).
8. On other error: `setError(row.id, err.message)` + toast `"Materialize failed: {message}"`. CRUD persistence is NOT rolled back — the saved view stays in SQLite; materialize is retried on next dashboard open or operator-triggered re-Save.

**Save is NOT gated on materialize success** — persistence is the source of truth. Over-threshold and materialize errors are runtime conditions the operator can recover from without re-editing.

**Edit semantics:** When operator edits an existing view's `template_sql`, the server's `PUT /api/dynamic-views/:id` handler auto-clears `columns_json` (CONTEXT 32 § D3) unless the request body co-supplies it. The modal should always send `columns_json` from the most-recent successful Preview if `template_sql` changed; otherwise omit `columns_json` to let the server preserve.

**Form reset on save success:** Modal stays open. Form re-loads with the canonical row from the server response so any auto-clear (columns_json clear) is reflected. Dirty flag clears.

### Dirty state + modal close

**Dirty tracking:** `isDirty` flag flips true on any form field change after load. Cleared on Save success or explicit Discard.

**Close paths that route through dirty-state confirm:**
- Close-X button click
- ESC key
- Outside-click on `.modal-overlay`

**Confirm dialog:**
- Title: `Discard unsaved changes?`
- Body: `Your edits to "{name}" will be lost.` (or `Your new view will not be saved.` if creating)
- Buttons: `[Discard]` (primary destructive) + `[Cancel]` (secondary, keeps modal open)
- Native browser confirm() is acceptable (matches existing app patterns); custom dialog is Claude's discretion if a confirm component exists.

**Switch-views path:** Click a different view in left list while form is dirty → same confirm. On Discard, switch to new view; on Cancel, stay on current.

### Delete confirmation (inline, LayersModal pattern)

- Trash icon on each list row.
- Click trash → row swaps to `[Delete view]` (red button) + `[Keep view]` (ghost button) inline within the same row.
- Click Delete view → `deleteDynamicView(id)` (destructive — drops Kinetica view + deletes SQLite row).
- On success: `useDynamicViewStore.getState().clearView(id)` + remove row from local list + toast `"View deleted"`. If the deleted view was selected, clear right-pane selection.
- On error: revert inline state; toast error.
- Click Keep view → revert inline state.

### Preview UX

**Location:** Bottom panel within the right pane, below the form fields and above the Save button. Vertically stacked: `[name] [table] [editor] [max_records] [Insert {view} btn] [Preview btn] → [Preview output] → [Save btn]`. Resizable height not required; default min-height 150px / max-height 300px with internal scroll.

**Trigger:** Button-only. Operator clicks Preview → server call → render. Never auto-fires.

**Preview button behavior:**
1. Validate locally: `template_sql` non-empty + `source_table_id` chosen + `dashboard_id` available. If fail → inline error in Preview panel ("Select a source table and write SQL first.").
2. Disable Preview + show spinner.
3. Call `previewDynamicView({ template_sql, source_table_id, dashboard_id, sample_limit: 100 }, abortSignal)`.
4. On success `{ rows, columns }`: render output (see below). Store the returned `columns` in local state — used by Save to populate `columns_json`.
5. On 400 (missing `{view}` or other validation): server error message verbatim in red box.
6. On other error: server error message verbatim in red box.
7. On AbortError: silent.

**Output rendering:**
- Column chip list at top of panel: alphabetical by name. Each chip: `{name} {TYPE}` (e.g., `vendor TEXT`, `avg_fare DOUBLE`). Type comes from server response `columns[].type` (server defaults to `"unknown"` per index.ts:1108 if Kinetica omits `column_datatypes`).
- Below: HTML table with header row (column names in original server order) + body rows (first N from server response). Scroll-x for wide tables. Vertical scroll within max-height for many rows.
- Row count footer: `{N} rows previewed (sample_limit=100)`.

**Preview output states:**
1. **Initial / not yet run:** placeholder text `"Click Preview to see sample data."` centered in panel.
2. **Loading:** spinner + `"Running preview..."`.
3. **Success with rows:** column chips + table + row count footer.
4. **Success but 0 rows:** column chips (still useful — column discovery works without rows) + message `"Query returned 0 rows. Check filters and template."` in place of the table.
5. **Error:** red error box with server message verbatim. Example: `"Template SQL must contain {view} token."` (from server's substituteViewToken via the 400 path), or Kinetica syntax error from line 1064 area of index.ts.

**Preview cache:** None. Each click re-fetches. SQL templates are mutable; staleness is the operator's signal to re-Preview.

**Preview does NOT auto-update columns_json on the persisted row** — only Save persists. The Preview-then-Save sequence is the locked path; Preview-alone is read-only by design (mirrors server route which doesn't persist).

### Materialize feedback surfaces

Two complementary surfaces, both fed by `useDynamicViewStore`:

**1. Toast on Save outcome** (transient, last toast wins):
- `Materialized` — green / info kind
- `Saved — no filter active; view will materialize when a filter is applied.` — info kind (over_threshold/no_filter)
- `Saved — {N} rows exceeds max_records {M}; raise the threshold or narrow filters.` — warning kind (over_threshold/exceeds_max_records)
- `Materialize failed: {message}` — error kind

**2. Left-list badge per view** (persistent across modal re-opens):
- Reads from `useDynamicViewStore.views[id].status` — selector-scoped per id (PITFALL C-02 / S-02).
- States:
  - `materialized` — small green dot or check icon
  - `pending` — spinner / pulse
  - `over_threshold` — yellow triangle (hover: shows reason via title attr or tooltip — "No filter active" / "Exceeds max records")
  - `error` — red exclamation (hover: shows error message)
  - No badge if no entry exists in store (view never materialized in this session — e.g., on first dashboard open before any consumer reads the view).

**No status update on `deleteDynamicView`** — clearView removes the entry entirely; the row disappears from the left list. Badge is N/A.

### AbortController scope

The modal owns a single `AbortController` per "active operation" (preview / save+materialize / delete). When the modal closes, the controller aborts in-flight requests.

- Preview: `previewAbortRef.current = new AbortController()`. Aborted on next Preview click or modal close.
- Save+materialize: `saveAbortRef.current = new AbortController()`. Aborted on next Save click or modal close.
- Delete: `deleteAbortRef.current = new AbortController()`. Aborted on next Delete or modal close.

Use 3 separate refs to avoid cross-cancellation (deleting one view shouldn't cancel a Save on another).

### CodeMirror SQL editor

**Dependency:** Add `@codemirror/lang-sql` to `kinetica_bi/package.json` dependencies. Pin to the same major as the existing `@codemirror/*` deps (current `@codemirror/lang-html: ^6.4.11` → use `@codemirror/lang-sql: ^6.x`).

**Editor configuration:**
- Component: `<CodeMirror>` from `@uiw/react-codemirror` (already installed; same wrapper KineticaWmsLayerForm uses).
- Extensions: `[sql()]` from `@codemirror/lang-sql` (generic SQL dialect — sufficient; Kinetica SQL is mostly standard).
- Theme: default light theme (no theme prop = `light` per @uiw/react-codemirror docs).
- Height: `minHeight="200px"`, `maxHeight="400px"` (matches HTML editor in KineticaWmsLayerForm).
- Line numbers: ON (`basicSetup` default). Helpful for SQL syntax error references.
- Editable: TRUE. Operators type SQL.
- Placeholder: `"-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor"`. Comment lines so it reads as valid-ish SQL hint.

**"Insert {view}" button:**
- Position: above the editor, right-aligned alongside the editor's section label (or as a small ghost button to the right of the label).
- Click handler: insert the literal string `{view}` at the editor's current cursor position. Use the CodeMirror view ref (via `onCreateEditor` callback to capture the view) and `view.dispatch({ changes: { from: cursor, insert: '{view}' } })`. KineticaWmsLayerForm has an existing "Insert column" picker (Phase 22) — mirror the cursor-position mechanism. Planner reads KineticaWmsLayerForm.tsx for the exact API.
- Disabled when editor is empty AND placeholder is visible (otherwise user inserts into placeholder which doesn't make sense in CM6 placeholder semantics — verify in research).

**Inline hint text below editor:**
- Single line: `Use {view} where you'd reference the source filter view.`
- Styling: small, muted (matches existing form hint text patterns).

**`{view}` validation timing: server-only.**
- The frontend does NOT validate `{view}` presence. The server's `substituteViewToken` (kinetica_bi/server/src/lib/dynamicView.ts) is the single source of truth (regex: `/\{\s*view\s*\}/i`).
- On Preview or Save, if server returns 400 with message `"Template SQL must contain {view} token."` (or whatever `MissingViewTokenError.message` reads), surface verbatim:
  - In the Preview panel for Preview errors
  - Inline below the SQL editor for Save errors (red text, dismissable on next edit)
- Save is blocked while the inline error is showing (operator must edit the SQL or click Discard to acknowledge).

### Field validation + defaults

**name:**
- Required. Non-empty after trim.
- Local validation only (server validates non-empty too but doesn't gate on uniqueness — multiple views with same name within a dashboard are allowed at the database level).
- Inline error: `"Name is required"` below the field on Save click with empty value.
- No uniqueness check this phase (would require a separate `listDynamicViews` lookup; defer to Claude's discretion if planner wants to add a soft warning).

**source_table_id:**
- Required. Picker shows `associatedTables` only (the same list `LayersModal` uses).
- Default for new: first associated table. If `associatedTables` is empty, button to open modal is shown but the form's Save is disabled with hint `"This dashboard has no associated tables. Add a table first."` — operator clicks Tables button first.
- Inline error if absent on Save: `"Source table is required"`.

**template_sql:**
- Required. Non-empty after trim.
- `{view}` token validation: server-only (above).
- Inline error if empty on Save: `"Template SQL is required"`.

**max_records:**
- Default for new: `10000` (Claude's discretion — provides a safe default that's restrictive enough to enforce the threshold story but generous enough for typical dashboards. Planner may adjust based on milestone-level discussion; if there's a project-wide threshold convention from v1.3 filter materialization, mirror it).
- Min: `1` (`<input type="number" min={1}>`).
- Max: no upper bound enforced client-side. Server accepts any positive integer.
- Inline error if `<1` or non-integer on Save: `"Max records must be at least 1"`.
- Clamp on blur: snap to min if `<1`; snap to integer if non-integer.

**columns_json:**
- Not user-editable. Populated by Preview, persisted on Save.
- On new view (no Preview run): omit from create body → server defaults null.
- On edit + template_sql changed + Preview ran: send columns_json from Preview response.
- On edit + template_sql changed + Preview not run: server auto-clears columns_json per CONTEXT 32 § D3.
- On edit + template_sql unchanged: omit columns_json (server preserves).

### Action-bar button placement

Insert as 4th button between "Map Layers" and "Back" at `DashboardsPage.tsx:705-707` area:

```tsx
<button className="btn-primary btn-sm" onClick={() => setShowLayersModal(true)}>
  Map Layers
</button>
<button className="btn-primary btn-sm" onClick={() => setShowDynamicViewsModal(true)}>
  Dynamic Views
</button>
<button className="ghost-sm" onClick={onBack}>Back</button>
```

State: `const [showDynamicViewsModal, setShowDynamicViewsModal] = useState(false);` near the existing `showLayersModal` state. Modal render conditional alongside `{showLayersModal && <LayersModal ... />}`.

### Empty states

- **No dynamic views in left list:** Centered empty state in left pane — `"No dynamic views yet."` + visible `+ New dynamic view` button. Right pane shows `"Select a view or click + New to get started."`.
- **No associated tables (blocks Save):** Both panes disabled. Banner at top: `"This dashboard has no associated tables. Click Tables to add one first."` with inline link/button to open Tables modal.
- **Preview before run:** see Preview UX above.
- **Preview returns 0 rows:** see Preview UX above.

### Test coverage scope

Component spec `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` must cover:
- Modal opens / closes / ESC dismisses (with dirty-state confirm path)
- "+ New" creates blank form; switching between existing views populates form
- Form validation (name required, table required, template required, max_records >= 1)
- Preview button: success path renders chips + table; error path renders verbatim error; loading state; 0-rows state
- Save button: createDynamicView call shape; updateDynamicView call shape (incl. columns_json carry rules); 400 inline error; success toast; over_threshold toast (both reasons); error toast
- Materialize sequence on Save: markPending → materializeDynamicView → setView/setError with correct payloads
- AbortController: closing modal mid-Save aborts the materialize call
- Inline delete confirm flow: click trash → swap → Delete view → deleteDynamicView called → clearView store call → row removed
- Dirty-state close confirm: shows on close-with-dirty-form; Discard closes; Cancel keeps open
- Left-list badge reflects `useDynamicViewStore.views[id].status` (mock store)
- ESC, click-outside, close-X all route through dirty-state confirm

Spec `kinetica_bi/src/components/DashboardsPage.spec.tsx` extended:
- "Dynamic Views" button renders alongside Tables / Visualizations / Map Layers
- Clicking the button opens DynamicViewsModal

### Claude's Discretion

- Exact CSS class names (`.dynamic-views-modal-*` recommended for parity with `.layers-modal-*` from Phase 12).
- Whether to share `LayersModal`'s `.modal-layers` size class or introduce `.modal-dynamic-views` with same width. Recommend share if no style differences.
- Whether to extract the form into a sub-component (`DynamicViewForm.tsx`) if `DynamicViewsModal.tsx` exceeds ~500 LOC — planner judgment.
- Default `max_records` value (recommend 10000 — adjust if there's a milestone-wide convention).
- Toast styling — use existing `useToast` / `useToastStore` if one exists; otherwise reuse the toast hooks Phase 22 / 23 added.
- Spec organization (single describe vs grouped per concern) — follow `LayersModal.spec.tsx` style.
- Whether Preview column chips show data types in `(parens)`, ` TYPE` suffix, or just the column name with a hover tooltip — operator-readable variants; planner locks.
- Whether the "Insert {view}" button is disabled while the editor is empty (verify CM6 placeholder semantics in research/planner check).
- Tab order through form fields (logical: name → table → editor → max_records → Insert → Preview → Save).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 34: dynamic-view-ui" — Phase boundary, 4 success criteria, depends-on Phase 33.
- `.planning/REQUIREMENTS.md` §"Management UI (Phase 34)" — DV-V16-08 (action-bar button + modal), DV-V16-09 (create/edit form), DV-V16-10 (Preview button + columns_json), DV-V16-11 (delete flow).
- `.planning/REQUIREMENTS.md` §"Locked Decisions" — Template token, no-filter behavior, columns persistence, scoping.
- `.planning/PROJECT.md` §"Current Milestone: v1.6 Dynamic Views" — Milestone intent + Phase 33 close-out notes.

### Phase 33 frontend store contract (this phase consumes)
- `.planning/phases/33-dynamic-view-store/33-CONTEXT.md` — Store shape, action contract, viewName deterministic helper, dynamicViewVersion semantics, all locked semantics.
- `kinetica_bi/src/store/dynamicViewStore.ts` — `useDynamicViewStore` exports. Phase 34 consumes via `useDynamicViewStore.getState().markPending(id, viewName)`, `setView`, `setError`, `clearView`. NO selector subscription in the modal (modal reads `views[id].status` for the badge only) — Phase 35 renderers do the heavy subscribing.
- `kinetica_bi/src/lib/dynamicViewName.ts` — `buildDynamicViewName({ userId, dashboardId, dynamicViewId })`. Phase 34 calls this between `createDynamicView` and `markPending` to get the viewName.
- `kinetica_bi/src/api/client.ts` — 7 helpers (listDynamicViews, createDynamicView, updateDynamicView, deleteDynamicView, previewDynamicView, materializeDynamicView, dropDynamicView). Pure pass-through; modal owns its own AbortController refs.

### Phase 32 server contract (modal hits these endpoints)
- `.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md` — Endpoint shapes, validation rules, columns_json auto-clear behavior, retry pattern.
- `kinetica_bi/server/src/index.ts:842-1240` — All 6 dynamic-view endpoints. Modal hits all of them: GET list (mount), POST create (Save new), PUT update (Save edit), DELETE destroy (Delete view), POST preview, POST materialize. NEW `POST /api/dynamic-view/:id/drop` (Phase 33) is NOT called from this modal — only the reset() DROP loop calls it.

### Modal pattern templates (mirror these)
- `kinetica_bi/src/components/LayersModal.tsx` — PRIMARY template. Two-pane layout, `.modal-overlay` portal, ESC handler, left-list with delete confirm inline, right-pane form, click-outside-to-close. Phase 34 mirrors at structural level.
- `kinetica_bi/src/components/LayersModal.spec.tsx` — Spec style for two-pane modals with list + form interactions.
- `kinetica_bi/src/components/DashboardsPage.tsx:699-708` — Action-bar button placement (Tables / Visualizations / Map Layers); modal mount conditional at line ~923 area (`{showLayersModal && <LayersModal ... />}`).

### CodeMirror integration template
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:46-48,1113-1130` — `@uiw/react-codemirror` import + `@codemirror/lang-html` setup + `<CodeMirror>` usage with `minHeight`, `maxHeight`, `extensions`, `value`, `onChange`. Phase 34 mirrors with `sql()` extension instead of `html()`.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Also contains the "Insert column" picker pattern (Phase 22 lines around the editor) — read the exact cursor-insertion mechanism and mirror for "Insert {view}".
- `kinetica_bi/package.json` — Add `@codemirror/lang-sql` to dependencies (match major of `@codemirror/lang-html: ^6.4.11`).

### Form patterns
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Numeric input clamp-on-blur pattern (max_records validation mirrors infoRadiusPx clamp from Phase 22).
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Table picker pattern (associated tables).

### Toast pattern
- `kinetica_bi/src/store/toast.ts` (or equivalent — verify in research/planning) — Existing toast helper used by Phase 22 / 23. Modal uses for Save outcome and Delete confirmation.

### Test infra
- `kinetica_bi/src/test/setup.ts` — Vitest + jsdom config + Zustand reset shim.
- `kinetica_bi/__mocks__/zustand.ts` — Auto-applies to `src/store/*.ts`. `useDynamicViewStore` covered for free.
- `kinetica_bi/src/components/LayersModal.spec.tsx` — Pattern for two-pane modal specs.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — Pattern for action-bar button + modal-open assertions.

### Downstream consumers (informational — not touched in this phase)
- Phase 35 `AggregatedWidgetRenderer` / `RecordsTableRenderer` / `MapChartRenderer` — Will read `useDynamicViewStore.views[widget.config.dynamicViewId]` for FROM/LAYERS-swap. Phase 34's job is just to ensure the store reaches `status === "materialized"` for views that should be live; Phase 35 owns the runtime FROM-swap.
- Phase 36 verifier — Source-only attestation or live UAT.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`LayersModal.tsx`** — Primary structural template. Two-pane, portal shell, left list with delete confirm, right form, ESC, click-outside. Phase 34 mirrors but: explicit Save (vs auto-save), dirty-state confirm on close (vs none).
- **`KineticaWmsLayerForm.tsx`** — CodeMirror integration template. Uses `@uiw/react-codemirror` + `@codemirror/lang-html` with `minHeight`/`maxHeight`/`extensions`. Phase 34 swaps `lang-html` → `lang-sql`. Also has the "Insert column" picker — cursor-insertion mechanism is reusable for "Insert {view}" button.
- **`@uiw/react-codemirror`** + `@codemirror/lang-html` — Already in package.json. Phase 34 adds `@codemirror/lang-sql` (sibling package, same v6 major).
- **`ChipCombobox`** (Phase 22) — Multi-select dropdown. Not directly used in Phase 34 (no multi-select), but the chip-style rendering can inform the Preview column chip list.
- **`useDynamicViewStore` + `buildDynamicViewName` + 7 client helpers** — All shipped in Phase 33. Modal consumes the action APIs + naming helper directly.
- **`associatedTables: TableDto[]`** — Already loaded at `DashboardsPage.tsx:369`. Available in DashboardOpen scope; pass to modal as prop.
- **`useAuthStore` (or equivalent)** — For `userId` needed by `buildDynamicViewName`. Check current pattern: `kinetica_bi/src/store/auth.ts` likely exports the user info; planner verifies and locks.
- **`useToast` / `useToastStore`** — Existing toast pattern (verify path in research/planning).
- **`dashboardId` from `DashboardContext`** — Already provided by Phase 30's context extension. Modal reads via `useContext(DashboardContext)`.

### Established Patterns
- **Two-pane modal with inline delete confirm** (LayersModal Phase 12). Mirror exactly for layout + delete UX.
- **`.modal-overlay` portal + `.modal-{name}` size class** — Modal shell. Reuse `.modal-layers` size or add `.modal-dynamic-views` if styling diverges.
- **Auto-save 300ms debounced** for layer/widget config — Phase 34 deliberately diverges to explicit Save per ROADMAP wording.
- **CodeMirror via `@uiw/react-codemirror`** with `minHeight`/`maxHeight`/`extensions` — Reused pattern.
- **Numeric input clamp-on-blur** with inline error (KineticaWmsLayerForm `infoRadiusPx` from Phase 22). Mirror for `max_records`.
- **Toast for non-blocking outcome feedback** — Save/Delete results.
- **AbortController per long-running operation, aborted on unmount/re-trigger** — v1.3 V13-P-10 lock. Modal owns its own refs.
- **Pure pass-through client helpers** — Modal calls them; modal owns store + toast side effects.
- **Inline error messages below fields** for form validation — established pattern.

### Integration Points
1. `kinetica_bi/src/components/DashboardsPage.tsx` — Add 4th action-bar button + modal state + modal render conditional. Pass `dashboardId`, `associatedTables` as props.
2. `kinetica_bi/src/components/DynamicViewsModal.tsx` — NEW file. Consumes Phase 33 store + client helpers; renders 4 success criteria.
3. `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` — NEW spec file.
4. `kinetica_bi/src/styles/global.css` — NEW CSS classes (`.dynamic-views-modal-*`). Reuse `.modal-overlay`, possibly `.modal-layers` size, or new size class.
5. `kinetica_bi/package.json` — Add `@codemirror/lang-sql` dependency.
6. `kinetica_bi/src/components/DashboardsPage.spec.tsx` — Extend to assert button render + modal-open.

</code_context>

<specifics>
## Specific Ideas

- **"Mirror LayersModal exactly"** for the modal shell and two-pane structure. The only intentional divergences are: (1) explicit Save button instead of auto-save, (2) dirty-state confirm on close (LayersModal doesn't need this because auto-save).
- **"Mirror KineticaWmsLayerForm exactly"** for CodeMirror integration + "Insert {token}" button cursor-insertion mechanism.
- **Materialize-on-Save is a deliberate scope expansion** for operator UX feedback (toast + badge) — Phase 35 will read the SAME store state and trigger re-materialize on filter-view bump. No duplication of materialize logic; Phase 34 just kick-starts the state machine.
- **Preview column chips show `{name} {TYPE}`** so operators can copy-paste column names into chart configs (Phase 35). The chip list is the bridge between SQL authoring and widget binding.
- **`{view}` validation is server-only** because the server's `substituteViewToken` regex is already the single source of truth and Phase 33's frontend doesn't need to mirror that helper. Server returns 400 with verbatim message; modal surfaces verbatim. No drift risk.
- **Default max_records = 10000** — locked in CONTEXT for the planner to use unless they discover a different project-wide convention during research. The exact value isn't load-bearing; the threshold story is.
- **Operator's mental model on Save:** "I'm committing this configuration. If it materializes today, great — widgets will see it. If not (over-threshold or no filter), the config is still saved and will materialize as soon as a filter is applied or max_records is increased."
- **Delete is irreversible** but cheap — operator can re-create from saved SQL. Inline confirm is sufficient friction; full type-name-to-confirm would be excessive.

</specifics>

<deferred>
## Deferred Ideas

- **Widget binding** (ChartConfigPanel Data Source picker → dynamicViewId) — Phase 35 (DV-V16-12).
- **Renderer FROM-swap / LAYERS-swap** against resolved dynamic view — Phase 35 (DV-V16-13).
- **Over-threshold widget empty state** ("Too much data — narrow your filters") — Phase 35 (DV-V16-14).
- **Cascading re-materialize on filter-view bump** — Phase 35.
- **Name uniqueness check** within a dashboard — soft warning could be added; deferred unless UAT shows operators creating duplicates.
- **SQL syntax error live-underline** — Monaco-style. Out of scope; lang-sql doesn't expose error positions.
- **Auto-complete on `{` keystroke** — Custom CodeMirror extension for one token. Overkill.
- **Pre-populated template gallery** (Top 10 / Top by category / etc.) — Future iteration; v2 nice-to-have.
- **Copy view to another dashboard** — Cross-dashboard sharing locked OUT per CONTEXT 32 § D4.
- **URL/localStorage persistence of edit state** — Out (PERSIST-V2).
- **Live preview pane during typing** — Server cost + UX complexity; rejected.
- **Resizable preview output panel** — Default min/max only; user can scroll. Defer if UAT shows it's needed.
- **Drag-reorder of views in left list** — Order doesn't matter functionally (lookups are by id); skip for now.
- **Tab order through form fields** — Logical default (top-to-bottom); explicit `tabIndex` if UAT shows issues.

</deferred>

---

*Phase: 34-dynamic-view-ui*
*Context gathered: 2026-05-14*
