---
phase: 34-dynamic-view-ui
plan: 03
type: execute
wave: 2
depends_on:
  - "34-01"
  - "34-02"
files_modified:
  - kinetica_bi/src/components/DynamicViewsModal.tsx
  - kinetica_bi/src/components/DynamicViewsModal.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - DV-V16-09
  - DV-V16-10
must_haves:
  truths:
    - "Operator opens the form via '+ New dynamic view' or by clicking an existing row → form renders with: name input, source-table picker (associatedTables only), CodeMirror SQL editor with `[sql()]` extension + placeholder + line numbers, 'Insert {view}' button above editor that inserts at CURSOR position via view.dispatch, inline hint text 'Use {view} where you'd reference the source filter view.', max_records numeric input with clamp-on-blur (min 1, integer)."
    - "Operator's form-field edits flip isDirty=true; row select / + New populates the form fresh and resets isDirty=false."
    - "Operator clicks Preview → previewDynamicView fires (with previewAbortRef.signal); output panel shows column chips (alphabetical, `{name} {TYPE}`) + HTML table of first-N rows + row count footer. 0-rows shows chips + message. Server errors surface server message verbatim in red box."
    - "After a successful Preview, formColumnsJson is populated (JSON.stringify of columns) AND previewRanSinceLastSave flips to true — both consumed by the Save flow in Plan 34-04."
    - "Validation errors (e.g., empty SQL or no source_table_id) appear in the Preview panel as `{ kind: 'error', source: 'validation', message: 'Select a source table and write SQL first.' }`. When the operator edits a form field that resolves the validation issue (sets non-empty SQL or chooses a table), the panel resets to `{ kind: 'idle' }` so a stale validation error never lingers. Server errors (`source: 'server'`) PERSIST until the next Preview click — explicitly different from validation errors."
    - "When the dashboard has zero associatedTables: form is replaced by a banner 'This dashboard has no associated tables. Click Tables to add one first.'; Preview / Save not rendered."
    - "previewAbortRef cancels on next Preview click and on modal unmount; AbortError is silent (no toast, no state change)."
  artifacts:
    - path: "kinetica_bi/src/components/DynamicViewsModal.tsx"
      provides: "Extends Plan 34-02 shell with: form state machine (name / source_table_id / template_sql / max_records draft+committed / columns_json / previewRanSinceLastSave / originalTemplateSql / isDirty), DynamicViewForm sub-component (CodeMirror editor + Insert {view} + max_records clamp + Preview button + 5-state Preview output panel), and previewAbortRef (operation-scoped controller — separate from Plan 34-02's mount-time abortRef). NOTE: previewRanSinceLastSave initializes to false; flips true ONLY on Preview success. Plan 34-04 consumes."
      min_lines: 400
    - path: "kinetica_bi/src/components/DynamicViewsModal.spec.tsx"
      provides: "Extends Plan 34-02 spec with form-rendering, Insert {view} cursor insert, max_records clamp, validation-vs-server error reset semantics, and the 7 Preview tests (P1-P7). Also updates Plan 34-02's M3 and M7 tests to assert form fields (not placeholder text)."
      min_lines: 500
    - path: "kinetica_bi/src/styles/global.css"
      provides: "Form + Preview output panel CSS appended to existing Phase 34 section."
      contains: ".dynamic-views-modal-form"
  key_links:
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (Insert {view} button)"
      to: "view.dispatch — CM6 cursor-position insertion"
      via: "editorViewRef captured via onCreateEditor"
      pattern: "view\\.dispatch\\(\\{\\s*changes:\\s*\\{\\s*from:"
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (max_records input)"
      to: "clamp-on-blur handler"
      via: "onBlur fires clampMaxRecords; onChange only updates draft string"
      pattern: "clampMaxRecords"
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (Preview success)"
      to: "previewRanSinceLastSave + formColumnsJson"
      via: "setPreviewRanSinceLastSave(true) + setFormColumnsJson(JSON.stringify(result.columns))"
      pattern: "setPreviewRanSinceLastSave\\(true\\)"
---

<objective>
Form + CodeMirror + Preview plan. Extends Plan 34-02's modal shell with the right-pane form, CodeMirror SQL editor with cursor-position Insert {view} button, max_records clamp-on-blur, and the Preview button + 5-state output panel. Establishes the `previewRanSinceLastSave` flag (consumed by Plan 34-04's Save flow). Adds one operation-scoped AbortController ref (`previewAbortRef`) — Plan 34-04 adds `saveAbortRef` + `deleteAbortRef`.

**Scope this plan (Wave 2, depends on 34-01 + 34-02):**
- Form state machine inside `DynamicViewsModal.tsx`: name / source_table_id / template_sql / max_records (draft string + committed integer) / formColumnsJson / originalTemplateSql / previewRanSinceLastSave / isDirty / 4 inline error states.
- Extract a `DynamicViewForm` sub-component in the same file (~250 lines of JSX) — keeps the parent file readable.
- CodeMirror editor: `@uiw/react-codemirror` + `[sql()]` extension + line numbers + light theme + minHeight 200px / maxHeight 400px + placeholder.
- Insert {view} button: cursor-position via `view.dispatch({ changes: { from: view.state.selection.main.head, insert: "{view}" } })`. `editorViewRef` captured via `onCreateEditor`.
- max_records clamp-on-blur: min 1, integer; mirrors `MapConfigPanel.clampRadius`.
- Field-change handlers set `isDirty=true` and clear the corresponding inline error.
- Preview button + output panel (5 states: not-run, loading, success-with-rows, 0-rows, error). Two distinct error sources: `source: "validation"` (resets on field edit) vs `source: "server"` (persists until next Preview click).
- `previewAbortRef` — operation-scoped controller. Aborted on next Preview click + on modal unmount. **Mount-time `abortRef` from Plan 34-02 is NOT renamed or replaced — it continues to scope the mount-time `listDynamicViews` call.**
- `previewRanSinceLastSave` flag: initializes to false; flips true ONLY on Preview success (not on Preview start, not on Preview error, not on row select, not on + New). Plan 34-04's Save flow reads this flag for the columns_json carry decision.
- Extend `DynamicViewsModal.spec.tsx` with form coverage (F1-F10), Preview coverage (P1-P7), and update Plan 34-02's M3/M7 placeholder assertions to form-rendered assertions.
- Append form + Preview CSS to existing Phase 34 section in global.css.

**Out of scope (Plan 34-04):**
- Save button + handler (CRUD → buildDynamicViewName → markPending → materializeDynamicView → setView/setError → toast).
- `saveAbortRef` + `deleteAbortRef` (Plan 34-04 adds both; also migrates Plan 34-02's delete handler to `deleteAbortRef`).
- Dirty-state `window.confirm` on close paths (the wrapper is already in 34-02; 34-04 flips `isDirty` to a real state on form edits — actually we wire isDirty here too, but the close-path confirm assertions live in Plan 34-04 since the path is exercised by the full Save flow tests).
- DashboardsPage 4th action-bar button + modal mount.
- Extended DashboardsPage.spec.tsx tests.
- columns_json carry rules in Save body (uses `previewRanSinceLastSave` from this plan).

Plan 34-03 ships a fully interactive form + Preview UX but Save remains disabled (Plan 34-04 owns the button). The modal is still NOT mounted on DashboardsPage at the end of this plan.

Purpose: Close DV-V16-09 partially (form + CodeMirror + Insert {view} + max_records clamp) and DV-V16-10 fully (Preview button + columns + table + verbatim server errors).

Output: DynamicViewsModal.tsx grows from ~250 LOC to ~600 LOC; spec grows from ~250 LOC to ~550 LOC with ~22 tests; ~40 lines of new CSS appended.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/34-dynamic-view-ui/34-CONTEXT.md
@.planning/phases/34-dynamic-view-ui/34-RESEARCH.md
@.planning/phases/33-dynamic-view-store/33-CONTEXT.md

<interfaces>
<!-- Phase 33 client helpers needed by this plan - from kinetica_bi/src/api/client.ts -->
```typescript
export type DynamicViewRow = { id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json: string | null, created_at, updated_at };
export type PreviewDynamicViewArgs = { template_sql: string; source_table_id: number; dashboard_id: number; sample_limit?: number };
export type DynamicViewColumn = { name: string; type: string };
export type PreviewDynamicViewResponse = { rows: unknown[][]; columns: DynamicViewColumn[] };
export const previewDynamicView: (body: PreviewDynamicViewArgs, signal?: AbortSignal) => Promise<PreviewDynamicViewResponse>;
```

<!-- CodeMirror CM6 cursor-position API (VERIFIED 2026-05-14) -->
```typescript
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";          // From Plan 34-01 dependency install.
import type { EditorView } from "@codemirror/view";

const editorViewRef = useRef<EditorView | null>(null);
// Capture via onCreateEditor:
<CodeMirror
  onCreateEditor={(view) => { editorViewRef.current = view; }}
  extensions={[sql()]}
  minHeight="200px"
  maxHeight="400px"
  placeholder={`-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor`}
  value={templateSql}
  onChange={(v) => { setTemplateSql(v); setIsDirty(true); }}
/>
// Cursor-position insert:
const view = editorViewRef.current;
if (!view) return;
const pos = view.state.selection.main.head;
view.dispatch({ changes: { from: pos, insert: "{view}" } });
view.focus();
```

<!-- Preview state machine (LOCKED — separate validation vs server error sources) -->
```typescript
type PreviewErrorSource = "validation" | "server";
type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; rows: unknown[][]; columns: DynamicViewColumn[] }
  | { kind: "error"; source: PreviewErrorSource; message: string };
```

Reset behavior (locked per MAJOR #4):
- On Preview success → `{ kind: "success", ... }` (also sets formColumnsJson + previewRanSinceLastSave).
- On Preview server error → `{ kind: "error", source: "server", message: err.message }`. Persists until next Preview click.
- On Preview validation failure → `{ kind: "error", source: "validation", message: "Select a source table and write SQL first." }`. Resets to `{ kind: "idle" }` when the operator edits a field that resolves the issue (sets non-empty SQL or chooses a table).
- On AbortError → silent (no state change).

<!-- columns_json + Save carry flag (LOCKED — addresses BLOCKER #1; Plan 34-04 reads these) -->
```typescript
// Carry-rule state machine — initialized + transitioned in this plan; consumed by Plan 34-04's Save handler.
const [formColumnsJson, setFormColumnsJson] = useState<string | null>(null);
const [previewRanSinceLastSave, setPreviewRanSinceLastSave] = useState<boolean>(false);

// Reset to false: + New mode, row select, Save success (Plan 34-04).
// Flip true: ONLY on Preview success.
// Plan 34-04 Save body condition:
//   if (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) body.columns_json = formColumnsJson;
```

Why the flag? Without it, Plan 34-02 row-select populates `formColumnsJson = row.columns_json`, and Plan 34-04's Save would erroneously send the STALE columns_json on a "edit template_sql without Preview" path — bypassing the server's auto-clear (CONTEXT 32 §D3). The flag explicitly tracks whether the operator has actually run Preview during this edit session.

<!-- Form lifecycle state init — row select / + New / Save success -->
```typescript
// On + New:
setFormName(""); setFormSourceTableId(_associatedTables[0]?.id ?? null);
setFormTemplateSql(""); setFormMaxRecordsDraft("10000"); setFormMaxRecords(10000);
setFormColumnsJson(null); setOriginalTemplateSql(null);
setPreviewRanSinceLastSave(false);             // ← LOCKED reset
setPreviewState({ kind: "idle" });
setIsDirty(false); /* + clear all inline errors */

// On row select (load row into form):
setFormName(row.name); setFormSourceTableId(row.source_table_id);
setFormTemplateSql(row.template_sql); setFormMaxRecordsDraft(String(row.max_records)); setFormMaxRecords(row.max_records);
setFormColumnsJson(row.columns_json); setOriginalTemplateSql(row.template_sql);
setPreviewRanSinceLastSave(false);             // ← LOCKED reset (NEVER carries from a prior session)
setPreviewState({ kind: "idle" });
setIsDirty(false); /* + clear all inline errors */
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend DynamicViewsModal with form + CodeMirror + Insert {view} + max_records clamp + spec coverage</name>
  <files>kinetica_bi/src/components/DynamicViewsModal.tsx, kinetica_bi/src/components/DynamicViewsModal.spec.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/DynamicViewsModal.tsx (Plan 34-02 output — full file; this task extends it)
    - kinetica_bi/src/components/DynamicViewsModal.spec.tsx (Plan 34-02 spec — extend with form coverage)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (lines 1-100 for imports, 1085-1130 for CodeMirror integration pattern — but DO NOT mirror the "insert-at-end" approach at lines 494-502; that was deferred. This phase uses verified cursor-position dispatch.)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (lines 149-181 — exact clampRadius pattern; adapt to clampMaxRecords with no upper bound)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (sections: "CodeMirror SQL editor", "Insert {view} button", "Field validation + defaults", "Inline hint text below editor")
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Patterns 3 + 4; Pitfalls 2 + 3 — confirmed Insert {view} should NOT be disabled with placeholder showing; verified CM6 API)
    - kinetica_bi/src/styles/global.css (Phase 34 section from Plan 34-02 — append form styles to this section)
  </read_first>
  <behavior>
    Test additions to existing DynamicViewsModal.spec.tsx (the file from Plan 34-02). New it() blocks under nested describe blocks.

    **Test infrastructure (locked reuse of Plan 34-02 fixtures):**
    - Reuse the existing top-level `beforeEach` block from Plan 34-02 which sets up the toast spy via `vi.spyOn(useToastStore.getState(), "showToast").mockImplementation(() => {})`. New tests in this plan do NOT re-spy on `showToast`; they read it back via `(useToastStore.getState().showToast as ReturnType<typeof vi.fn>).mock.calls[N]`. Plan 34-04's Save tests follow the same pattern.
    - Mock `@uiw/react-codemirror` and `@codemirror/lang-sql` at the top of the spec file (see action below).

    **F1: Form renders for + New (draft mode)**
    - Click + New → right pane renders form: name input (placeholder "Name your dynamic view"), source-table picker showing associatedTables (first table pre-selected), CodeMirror editor (located by `screen.getByTestId("cm-editor")`), Insert {view} button above editor, hint text "Use {view} where you'd reference the source filter view.", max_records numeric input with value "10000", Preview button, NO Save button yet (Plan 34-04 adds it).

    **F2: Form renders for existing row select**
    - Pre-resolve listDynamicViews with one row (name: "demo", template_sql: "SELECT 1", max_records: 5000, source_table_id: 2, columns_json: null). Click row → form populates: name="demo", template_sql="SELECT 1", max_records=5000, table picker selected to id 2.

    **F3: Form-field edits flip isDirty**
    - From row-selected state, type a character in name input. Assert (indirectly): the form's internal isDirty is now true. Direct test: Plan 34-04's close-path dirty-confirm test exercises this; this plan only asserts behavior of an exposed observable (e.g., subsequent Preview click still works, no immediate visual change). Acceptable assertion: type in name → no error, form remains rendered. (Stronger assertion deferred to Plan 34-04 close-path tests.)

    **F4: Form lifecycle — + New resets previewRanSinceLastSave**
    - Pre-resolve list with one row. Click row → form populates. Run Preview successfully → previewRanSinceLastSave=true (assert indirectly via Preview success state). Now click + New → form clears to draft defaults. The Preview output panel resets to `{ kind: "idle" }` (asserts via visible "Click Preview to see sample data." text).
    - Same reset on row-switch (click a different row).

    **F5: Insert {view} button inserts at cursor position**
    - Test by spying on the captured editorView ref. Top of spec mocks `@uiw/react-codemirror`:
      ```typescript
      vi.mock("@uiw/react-codemirror", () => ({
        default: vi.fn((props: any) => {
          const stubView = {
            state: { selection: { main: { head: 0 } }, doc: { length: props.value?.length ?? 0 } },
            dispatch: vi.fn((spec: any) => {
              if (spec?.changes?.insert) {
                props.onChange?.((props.value ?? "") + spec.changes.insert);
              }
            }),
            focus: vi.fn(),
          };
          (globalThis as any).__lastEditorView = stubView;
          setTimeout(() => props.onCreateEditor?.(stubView, stubView.state), 0);
          return <textarea data-testid="cm-editor" value={props.value ?? ""} onChange={(e) => props.onChange?.(e.target.value)} />;
        }),
      }));
      vi.mock("@codemirror/lang-sql", () => ({ sql: vi.fn(() => []) }));
      ```
    - Test: click + New → wait for editor onCreateEditor → set `stub.state.selection.main.head = 3` → click "Insert {view}" → assert `stub.dispatch` called with `{ changes: { from: 3, insert: "{view}" } }` AND `stub.focus` called.

    **F6: max_records clamp-on-blur**
    - Type "0" in max_records → blur → value snaps to "1"; inline error "Must be at least 1" appears briefly (3s timeout).
    - Type "-5" → blur → snaps to "1".
    - Type "0.5" → blur → snaps to "1" (rounded then clamped).
    - Type "10000" → blur → stays "10000", no error.
    - Empty string → blur → snaps to "1".

    **F7: name field validation (local — no network)**
    - Plan 34-03 does NOT yet have a Save button. F7 is reframed as: open + New form (empty name) → click Preview → previewDynamicView IS called only when SQL+table valid. Name-required validation lands in Plan 34-04 with the Save handler. This plan's F7 just asserts the name input exists and is mutable.

    **F8: associatedTables empty → form banner**
    - Pass `associatedTables={[]}` prop. Mount modal. Click + New → right pane shows banner "This dashboard has no associated tables. Click Tables to add one first." — NO form rendered. NO Preview button visible.

    **F9-F10:** Reserved for Plan 34-04 (Save validation and template_sql required validation are tied to the Save click).

    **Updates to Plan 34-02's tests:**
    - **M3 update:** Plan 34-02's M3 (row select shows placeholder text) → after Plan 34-03 lands, this test asserts the form renders. Update assertion from `screen.getByText(/Form coming in next plan/)` (or whatever Plan 34-02 chose) to `screen.getByLabelText("Name")` or `screen.getByPlaceholderText("Name your dynamic view")`.
    - **M7 update:** Plan 34-02's M7 (+ New shows draft mode placeholder) → after Plan 34-03 lands, assert form fields appear: `screen.getByPlaceholderText("Name your dynamic view")` is visible and `screen.getByTestId("cm-editor")` is visible.
    - **Any other right-pane placeholder assertions** in Plan 34-02 tests must change to form-presence assertions. Search the spec file for `getByText(/Form coming in next plan/)` / `getByText(/New dynamic view/)` / `getByText(/Select a view or click/)` and update them based on whether the test exercises the empty state (no selection — keep) vs. a draft / row-selected state (replace with form check).

    **Preview tests P1-P7:**

    **P1: Preview not-run — placeholder text**
    - Open + New form. Preview output panel shows `"Click Preview to see sample data."` initially.

    **P2: Preview loading state**
    - Mock previewDynamicView to return a never-resolving promise. Fill name, set template_sql via fireEvent.change on `cm-editor` textarea, click Preview → output panel shows `"Running preview…"`.

    **P3: Preview success — chips + table + state side-effects**
    - Mock previewDynamicView to resolve with `{ rows: [["a", 1], ["b", 2]], columns: [{ name: "vendor", type: "TEXT" }, { name: "fare", type: "DOUBLE" }] }`. Click Preview → output panel shows: column chips (alphabetical: "fare DOUBLE", "vendor TEXT"), HTML table with 2 header cells + 2 data rows, row count footer `"2 rows previewed (sample_limit=100)"`.
    - Side-effects (assert indirectly via subsequent form behavior — full assertion deferred to Plan 34-04 Save tests):
      - formColumnsJson is JSON-stringified columns array.
      - previewRanSinceLastSave is true.
    - For an indirect assertion: this plan can check that re-running Preview does NOT clear previewRanSinceLastSave (call Preview twice; assert it stays true between calls).

    **P4: Preview 0-rows**
    - Mock previewDynamicView to resolve with `{ rows: [], columns: [{ name: "x", type: "INT" }] }`. Click Preview → chips render + message `"Query returned 0 rows. Check filters and template."` instead of table.

    **P5: Preview error — verbatim server message (source: "server")**
    - Mock previewDynamicView to reject with `new Error("Dynamic view template must contain a {view} token.")` (relies on Plan 34-01's throwForStatus fix). Click Preview → output panel shows red error box with the VERBATIM message.
    - Now type a character in the SQL editor → output panel STILL shows the server error (does NOT reset, because `source: "server"`).
    - Click Preview again with valid input + mock returning success → previous error is replaced by chips + table.

    **P6: Preview AbortController cancellation**
    - Mock previewDynamicView to return a never-resolving promise (capture the signal). Click Preview → previewDynamicView called once with `signal`. Click Preview AGAIN → previous signal aborted (assert `signal1.aborted === true`); fresh signal passed to the second call.
    - Close modal mid-Preview (unmount component) → signal aborted; no toast.

    **P7: Preview validation block — error source "validation" resets on edit**
    - Open + New (empty SQL, table auto-selected). Click Preview → previewDynamicView NOT called; output panel shows `"Select a source table and write SQL first."` red box. Assert `previewState.kind === "error"` and `source === "validation"` (verifiable via DOM data attr `data-error-source="validation"`).
    - Type valid SQL in editor (or change a field that resolves validation) → output panel resets to `"Click Preview to see sample data."` (`kind: "idle"`).
    - Open + New, clear source_table_id (via setting to "" in spec helper), set valid SQL, click Preview → validation error appears (no table chosen). Choose a table → output resets to idle.
    - Add inverse test: server error (P5) → type in SQL → output STILL shows server error (does NOT reset).

    Total new it() blocks this plan: F1+F2+F3+F4+F5+F6+F7+F8 (8) + P1-P7 (7) = 15 new tests.
    Plus update Plan 34-02's M3 + M7 (2 modifications).
    Spec total after this plan: ~14 (Plan 34-02) - 2 modified + 15 new ≈ 27 tests.
  </behavior>
  <action>
**Step 1: Extend DynamicViewsModal.tsx with form + CodeMirror + Preview state machine + Insert {view} + max_records.**

Add imports at top of the file (preserve Plan 34-02's existing imports; add these):
```typescript
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";
import {
  previewDynamicView,
  type DynamicViewColumn,
  type PreviewDynamicViewResponse,
} from "../api/client";
```

Add new state INSIDE the DynamicViewsModal function body (after Plan 34-02's existing state):

```typescript
// Form state (Plan 34-03 — DV-V16-09)
const [formName, setFormName] = useState("");
const [formSourceTableId, setFormSourceTableId] = useState<number | null>(null);
const [formTemplateSql, setFormTemplateSql] = useState("");
const [formMaxRecordsDraft, setFormMaxRecordsDraft] = useState("10000");
const [formMaxRecords, setFormMaxRecords] = useState(10000);
const [formColumnsJson, setFormColumnsJson] = useState<string | null>(null);
const [originalTemplateSql, setOriginalTemplateSql] = useState<string | null>(null);

// LOCKED per BLOCKER #1: tracks whether the operator has run Preview since the last Save (or row load).
// Initialized to false; flips TRUE only on Preview success. Plan 34-04 reads this for columns_json carry.
const [previewRanSinceLastSave, setPreviewRanSinceLastSave] = useState<boolean>(false);

const [isDirty, setIsDirty] = useState(false);

// Inline form errors
const [nameError, setNameError] = useState<string | null>(null);
const [tableError, setTableError] = useState<string | null>(null);
const [sqlError, setSqlError] = useState<string | null>(null);
const [maxRecordsError, setMaxRecordsError] = useState<string | null>(null);

// CodeMirror EditorView ref
const editorViewRef = useRef<EditorView | null>(null);

// Preview state machine (LOCKED per MAJOR #4 — discriminated union with error-source tag).
type PreviewErrorSource = "validation" | "server";
type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; rows: unknown[][]; columns: DynamicViewColumn[] }
  | { kind: "error"; source: PreviewErrorSource; message: string };
const [previewState, setPreviewState] = useState<PreviewState>({ kind: "idle" });
const [previewLoading, setPreviewLoading] = useState(false);

// AbortController refs.
// LOCKED per MAJOR #2:
//   - Plan 34-02's `abortRef` is KEPT for the mount-time listDynamicViews call (no rename).
//   - This plan ADDS previewAbortRef (operation-scoped, aborted on next Preview + on unmount).
//   - Plan 34-04 ADDS saveAbortRef + deleteAbortRef and MOVES handleDelete to use deleteAbortRef.
const previewAbortRef = useRef<AbortController | null>(null);

// Cleanup on unmount (this plan adds previewAbortRef; Plan 34-04 adds saveAbortRef + deleteAbortRef to this list).
useEffect(() => () => {
  previewAbortRef.current?.abort();
}, []);
```

**Form lifecycle effect.** Populate form state when row selected or draft mode triggered. Critical: ALL three resets (formColumnsJson, originalTemplateSql, previewRanSinceLastSave) AND previewState idle must run for both branches:

```typescript
useEffect(() => {
  if (isDraft) {
    setFormName("");
    setFormSourceTableId(_associatedTables[0]?.id ?? null);
    setFormTemplateSql("");
    setFormMaxRecordsDraft("10000");
    setFormMaxRecords(10000);
    setFormColumnsJson(null);
    setOriginalTemplateSql(null);
    setPreviewRanSinceLastSave(false);       // LOCKED reset
    setPreviewState({ kind: "idle" });
    setNameError(null); setTableError(null); setSqlError(null); setMaxRecordsError(null);
    setIsDirty(false);
    return;
  }
  if (selectedId !== null) {
    const row = views?.find((v) => v.id === selectedId);
    if (!row) return;
    setFormName(row.name);
    setFormSourceTableId(row.source_table_id);
    setFormTemplateSql(row.template_sql);
    setFormMaxRecordsDraft(String(row.max_records));
    setFormMaxRecords(row.max_records);
    setFormColumnsJson(row.columns_json);
    setOriginalTemplateSql(row.template_sql);
    setPreviewRanSinceLastSave(false);       // LOCKED reset
    setPreviewState({ kind: "idle" });
    setNameError(null); setTableError(null); setSqlError(null); setMaxRecordsError(null);
    setIsDirty(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isDraft, selectedId, views]);
```

**Clamp helper:**
```typescript
const clampMaxRecords = (raw: string): { value: number; clamped: boolean; msg?: string } => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: 1, clamped: true, msg: "Must be at least 1" };
  const rounded = Math.round(n);
  if (rounded < 1) return { value: 1, clamped: true, msg: "Must be at least 1" };
  return { value: rounded, clamped: rounded !== n };
};

const handleMaxRecordsBlur = () => {
  const { value, clamped, msg } = clampMaxRecords(formMaxRecordsDraft);
  setFormMaxRecordsDraft(String(value));
  setFormMaxRecords(value);
  if (clamped && msg) {
    setMaxRecordsError(msg);
    setTimeout(() => setMaxRecordsError(null), 3000);
  } else {
    setMaxRecordsError(null);
  }
  setIsDirty(true);
};
```

**Insert {view} handler (cursor-position via CM6 dispatch):**
```typescript
const handleInsertViewToken = () => {
  const view = editorViewRef.current;
  if (!view) return; // editor not mounted yet — safe no-op
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: "{view}" } });
  view.focus();
};
```

**Field-change handlers** — also clear validation errors (MAJOR #4 reset semantics):

```typescript
// LOCKED per MAJOR #4:
// On form-field edits that resolve a validation block, reset preview output panel to idle.
// Server errors (source: "server") persist until next Preview click.
const resetValidationPreviewError = () => {
  setPreviewState((prev) =>
    prev.kind === "error" && prev.source === "validation" ? { kind: "idle" } : prev
  );
};

const handleSetFormName = (v: string) => {
  setFormName(v); setIsDirty(true); setNameError(null);
};
const handleSetFormSourceTableId = (v: number | null) => {
  setFormSourceTableId(v); setIsDirty(true); setTableError(null);
  resetValidationPreviewError(); // table now chosen — validation error may be obsolete
};
const handleSetFormTemplateSql = (v: string) => {
  setFormTemplateSql(v); setIsDirty(true); setSqlError(null);
  resetValidationPreviewError(); // SQL now non-empty — validation error may be obsolete
};
```

**Preview handler:**
```typescript
const handlePreviewClick = async () => {
  // Validation (sets source: "validation" so subsequent field edits reset it).
  if (!formTemplateSql.trim() || formSourceTableId === null) {
    setPreviewState({
      kind: "error",
      source: "validation",
      message: "Select a source table and write SQL first.",
    });
    return;
  }
  previewAbortRef.current?.abort();
  const ctrl = new AbortController();
  previewAbortRef.current = ctrl;
  setPreviewLoading(true);
  setPreviewState({ kind: "loading" });
  try {
    const result: PreviewDynamicViewResponse = await previewDynamicView({
      template_sql: formTemplateSql,
      source_table_id: formSourceTableId,
      dashboard_id: dashboardId,
      sample_limit: 100,
    }, ctrl.signal);
    if (ctrl.signal.aborted) return;
    setPreviewState({ kind: "success", rows: result.rows, columns: result.columns });
    setFormColumnsJson(JSON.stringify(result.columns));
    setPreviewRanSinceLastSave(true);           // LOCKED — only flip on success
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;  // silent
    setPreviewState({
      kind: "error",
      source: "server",
      message: (err as Error).message ?? "Preview failed",
    });
    // Do NOT touch formColumnsJson or previewRanSinceLastSave on error — keep whatever was there.
  } finally {
    setPreviewLoading(false);
  }
};
```

**Render the form INSIDE the existing `dynamic-views-modal-right` div.** Replace Plan 34-02's placeholder rendering:

```tsx
<div className="dynamic-views-modal-right">
  {_associatedTables.length === 0 ? (
    <div className="dynamic-views-modal-empty error">
      This dashboard has no associated tables. Click Tables to add one first.
    </div>
  ) : !isDraft && selectedId === null ? (
    <div className="dynamic-views-modal-empty">
      Select a view or click + New to get started.
    </div>
  ) : (
    <DynamicViewForm
      isDraft={isDraft}
      formName={formName} setFormName={handleSetFormName}
      formSourceTableId={formSourceTableId} setFormSourceTableId={handleSetFormSourceTableId}
      associatedTables={_associatedTables}
      formTemplateSql={formTemplateSql} setFormTemplateSql={handleSetFormTemplateSql}
      formMaxRecordsDraft={formMaxRecordsDraft}
      setFormMaxRecordsDraft={setFormMaxRecordsDraft}
      onMaxRecordsBlur={handleMaxRecordsBlur}
      onInsertViewToken={handleInsertViewToken}
      onCreateEditor={(view) => { editorViewRef.current = view; }}
      nameError={nameError} tableError={tableError} sqlError={sqlError} maxRecordsError={maxRecordsError}
      previewState={previewState}
      previewLoading={previewLoading}
      onPreviewClick={handlePreviewClick}
    />
  )}
</div>
```

**Extract `DynamicViewForm` sub-component** in the same file (below `DynamicViewsModal` export). ~250 lines of JSX. Renders:
1. Name input (`<input type="text" id="dv-form-name" />` with `value={formName}`, `onChange`, `placeholder="Name your dynamic view"`, `aria-label="Name"`). Inline `nameError` below.
2. Source-table picker (`<select aria-label="Source table">` with options from associatedTables; `value={formSourceTableId ?? ""}`, onChange parses int). Inline `tableError` below.
3. Section label `Template SQL` + Insert {view} button (right-aligned alongside label) + CodeMirror editor + inline hint text + inline `sqlError` below.
4. max_records numeric input (`<input type="number" min={1} step={1} aria-label="Max records" />` with `value={formMaxRecordsDraft}`, `onChange`, `onBlur={onMaxRecordsBlur}`). Inline `maxRecordsError` below.
5. Preview button.
6. Preview output panel (5 states — see below).
7. NO Save button (Plan 34-04 adds it).

CodeMirror block:
```tsx
<div className="dynamic-views-modal-editor-section">
  <div className="dynamic-views-modal-editor-header">
    <label className="ds-field-label">Template SQL</label>
    <button type="button" className="ghost-sm" onClick={onInsertViewToken}>
      Insert {"{view}"}
    </button>
  </div>
  <CodeMirror
    value={formTemplateSql}
    onChange={setFormTemplateSql}
    extensions={[sql()]}
    minHeight="200px"
    maxHeight="400px"
    placeholder={"-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor"}
    onCreateEditor={onCreateEditor}
  />
  <div className="dynamic-views-modal-editor-hint">
    Use {"{view}"} where you'd reference the source filter view.
  </div>
  {sqlError && <div className="dynamic-views-modal-field-error">{sqlError}</div>}
</div>
```

Per RESEARCH Pitfall 3, the Insert {view} button is NOT disabled when the editor is empty/placeholder showing.

Preview button + output panel JSX:
```tsx
<div className="dynamic-views-modal-form-actions">
  <button
    type="button"
    className="btn-primary btn-sm"
    onClick={onPreviewClick}
    disabled={previewLoading}
  >
    {previewLoading ? "Running…" : "Preview"}
  </button>
</div>
<div className="dynamic-views-modal-preview">
  {previewState.kind === "idle" && (
    <div className="dynamic-views-modal-empty">Click Preview to see sample data.</div>
  )}
  {previewState.kind === "loading" && (
    <div className="dynamic-views-modal-empty">Running preview…</div>
  )}
  {previewState.kind === "error" && (
    <div
      className="dynamic-views-modal-preview-error"
      data-error-source={previewState.source}
    >
      {previewState.message}
    </div>
  )}
  {previewState.kind === "success" && (
    <>
      <div className="dynamic-views-modal-preview-chips">
        {[...previewState.columns]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => (
            <span key={c.name} className="dynamic-views-modal-preview-chip">
              {c.name} {c.type.toUpperCase()}
            </span>
          ))}
      </div>
      {previewState.rows.length === 0 ? (
        <div className="dynamic-views-modal-empty">Query returned 0 rows. Check filters and template.</div>
      ) : (
        <div className="dynamic-views-modal-preview-table-wrap">
          <table className="dynamic-views-modal-preview-table">
            <thead>
              <tr>{previewState.columns.map((c) => <th key={c.name}>{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {previewState.rows.map((r, i) => (
                <tr key={i}>{r.map((cell, j) => <td key={j}>{String(cell ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dynamic-views-modal-preview-footer">
        {previewState.rows.length} rows previewed (sample_limit=100)
      </div>
    </>
  )}
</div>
```

**Step 2: Extend DynamicViewsModal.spec.tsx with form + Preview coverage; update Plan 34-02's M3/M7.**

At top of spec, add the CodeMirror mocks (see F5 in behavior). Keep Plan 34-02's existing `beforeEach` toast spy unchanged — the new Preview tests do NOT need the toast spy (Preview doesn't toast in this plan; Plan 34-04 Save does).

Add a nested describe `describe("DynamicViewsModal (form + Preview — Plan 34-03)", () => { ... })`. Inside, add F1, F2, F3, F4, F5, F6, F7, F8 and P1-P7 it() blocks.

Helper for filling the form:
```typescript
const fillFormForPreview = (sql = "SELECT 1 FROM {view}") => {
  fireEvent.click(screen.getByText("+ New dynamic view"));
  // Wait for form to render
  // table auto-selects to associatedTables[0]
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: sql } });
};
```

P3 indirect side-effect test (verifies previewRanSinceLastSave stays true across two Preview calls):
```typescript
it("Preview success: re-clicking Preview does not reset previewRanSinceLastSave", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.previewDynamicView.mockResolvedValue({
    rows: [["a"]],
    columns: [{ name: "vendor", type: "TEXT" }],
  });
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  fillFormForPreview("SELECT 1 FROM {view}");
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await waitFor(() => expect(screen.getByText(/1 rows previewed/)).toBeInTheDocument());
  // Second Preview — assert the flag stays set; behavior is via Plan 34-04 columns_json carry,
  // but observable indirectly here: chips still render, no idle state.
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(screen.getByText(/1 rows previewed/)).toBeInTheDocument());
});
```

P5 test (server error persists; field edit does NOT reset):
```typescript
it("Preview server error persists across field edits (source: 'server')", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.previewDynamicView.mockRejectedValueOnce(
    new Error("Dynamic view template must contain a {view} token."),
  );
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  fillFormForPreview("SELECT 1");
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await waitFor(() =>
    expect(screen.getByText("Dynamic view template must contain a {view} token.")).toBeInTheDocument(),
  );
  // Verify source attribute
  const errBox = screen.getByText("Dynamic view template must contain a {view} token.");
  expect(errBox.getAttribute("data-error-source")).toBe("server");
  // Edit SQL — server error should STILL be visible
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "SELECT 2 FROM {view}" } });
  expect(screen.getByText("Dynamic view template must contain a {view} token.")).toBeInTheDocument();
});
```

P7 validation reset test:
```typescript
it("Preview validation error resets to idle when SQL becomes non-empty (source: 'validation')", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  fireEvent.click(screen.getByText("+ New dynamic view"));
  // Empty SQL → click Preview → validation error
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await waitFor(() =>
    expect(screen.getByText("Select a source table and write SQL first.")).toBeInTheDocument(),
  );
  expect(screen.getByText("Select a source table and write SQL first.").getAttribute("data-error-source")).toBe("validation");
  expect(mockedClient.previewDynamicView).not.toHaveBeenCalled();
  // Type SQL → validation error should reset to idle
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "SELECT 1 FROM {view}" } });
  expect(screen.queryByText("Select a source table and write SQL first.")).not.toBeInTheDocument();
  expect(screen.getByText("Click Preview to see sample data.")).toBeInTheDocument();
});
```

**Update Plan 34-02's M3 + M7 tests:**

Search the existing spec for the placeholder-text assertions. Replace as documented in F1/F2 behavior. Concretely:
- M3 (row select shows placeholder): change `expect(screen.getByText(/Form coming/)).toBeInTheDocument()` to `expect(screen.getByLabelText("Name")).toBeInTheDocument()` (or whatever Plan 34-02 used).
- M7 (+ New shows draft mode): change `expect(screen.getByText("New dynamic view")).toBeInTheDocument()` to `expect(screen.getByPlaceholderText("Name your dynamic view")).toBeInTheDocument()`.

Any other Plan 34-02 right-pane placeholder assertions: replace with form-presence checks.

**Step 3: Append form + Preview CSS to global.css Phase 34 section.**

Append to the existing Phase 34 section block:
```css
.dynamic-views-modal-form { display: flex; flex-direction: column; gap: 12px; padding: 8px; }
.dynamic-views-modal-form input[type="text"],
.dynamic-views-modal-form input[type="number"],
.dynamic-views-modal-form select {
  background: var(--color-input-bg, #1a2030);
  border: 1px solid var(--color-border, #2a3142);
  color: var(--color-text, #d6dbe5);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  width: 100%;
}
.dynamic-views-modal-editor-section { display: flex; flex-direction: column; gap: 4px; }
.dynamic-views-modal-editor-header { display: flex; align-items: center; justify-content: space-between; }
.dynamic-views-modal-editor-hint { font-size: 12px; color: var(--color-text-muted, #8a93a8); margin-top: 2px; }
.dynamic-views-modal-field-error { font-size: 12px; color: var(--color-danger, #d8444b); margin-top: 2px; }
.dynamic-views-modal-form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }

.dynamic-views-modal-preview { display: flex; flex-direction: column; gap: 8px; min-height: 150px; max-height: 300px; overflow-y: auto; padding: 8px; border: 1px solid var(--color-border, #2a3142); border-radius: 4px; }
.dynamic-views-modal-preview-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dynamic-views-modal-preview-chip { background: var(--color-chip-bg, #2a3142); color: var(--color-text, #d6dbe5); border-radius: 12px; padding: 2px 10px; font-size: 11px; font-family: var(--font-mono, monospace); }
.dynamic-views-modal-preview-table-wrap { overflow-x: auto; }
.dynamic-views-modal-preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dynamic-views-modal-preview-table th, .dynamic-views-modal-preview-table td { border: 1px solid var(--color-border, #2a3142); padding: 4px 8px; text-align: left; }
.dynamic-views-modal-preview-table th { background: var(--color-table-header, #1a2030); font-weight: 600; }
.dynamic-views-modal-preview-footer { font-size: 11px; color: var(--color-text-muted, #8a93a8); text-align: right; }
.dynamic-views-modal-preview-error { background: rgba(216,68,75,0.10); color: var(--color-danger, #d8444b); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--color-danger, #d8444b); font-family: var(--font-mono, monospace); font-size: 12px; white-space: pre-wrap; }
```

Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx`. All ~27 tests should pass (14 from Plan 34-02 with M3/M7 modified + 15 new).
Run `cd kinetica_bi && npx vitest run` — full suite green.
Run `cd kinetica_bi && npx tsc --noEmit` — clean.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "@codemirror/lang-sql" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "@uiw/react-codemirror" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "view.dispatch" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "view.state.selection.main.head" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "clampMaxRecords" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "Insert {view}\|Insert {\"{view}\"}" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "previewAbortRef" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "previewRanSinceLastSave" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (LOCKED state machine flag present).
    - `grep -q "setPreviewRanSinceLastSave(true)" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (flag flipped on Preview success).
    - `grep -q 'source: "validation"' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (MAJOR #4 — validation source tagged).
    - `grep -q 'source: "server"' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (MAJOR #4 — server source tagged).
    - `grep -q "resetValidationPreviewError\|prev.source === .validation." kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (validation-only reset logic).
    - `grep -q "associated tables" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (the no-tables banner text).
    - `grep -q "Click Preview to see sample data" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "Running preview" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "rows previewed (sample_limit=100)" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "Query returned 0 rows" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "data-error-source" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (DOM attribute for spec assertion).
    - `grep -c "saveAbortRef\|deleteAbortRef" kinetica_bi/src/components/DynamicViewsModal.tsx` returns 0 (Plan 34-04 owns these — NOT in this plan).
    - `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits 0 with ≥ 27 tests passing.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green).
  </acceptance_criteria>
  <done>
    Form + CodeMirror + Insert {view} + max_records clamp + Preview state machine all working. previewRanSinceLastSave flag wired (consumed by Plan 34-04). Validation vs server error sources tagged in DOM and reset semantics implemented. previewAbortRef in place. Plan 34-02's M3/M7 placeholder tests migrated to form-rendered assertions. ~27 tests green. tsc + full vitest clean.
  </done>
</task>

</tasks>

<verification>
After this task:
1. `cd kinetica_bi && npx vitest run` exits 0 — full frontend suite green (Plan 34-02 baseline + 15 new tests + 2 modified tests).
2. `cd kinetica_bi && npx tsc --noEmit` exits 0.
3. Modal renders form when + New / row select (in jsdom); CodeMirror is mocked but Insert {view} dispatch verifiable.
4. Preview happy + 0-rows + 2 error sources all assertable.
5. previewRanSinceLastSave flag exists in source — Plan 34-04 will consume.
6. Modal is STILL not mounted on DashboardsPage — Plan 34-04 owns wiring.
</verification>

<success_criteria>
- DV-V16-09 partially closed: Form has name, source-table picker, CodeMirror editor with `{view}` hint + cursor-position Insert, max-records numeric input (min 1, clamp-on-blur). Save button NOT yet present (Plan 34-04 closes the rest).
- DV-V16-10 fully closed: Preview button calls `POST /api/dynamic-view/preview` (via previewDynamicView client helper); renders chips + HTML table; server 400 errors surface verbatim thanks to Plan 34-01's throwForStatus fix.
- BLOCKER #1 foundations laid: `previewRanSinceLastSave` flag initialized correctly, flipped only on Preview success, reset on + New / row select. Plan 34-04 consumes for columns_json carry.
- MAJOR #2 partial: previewAbortRef is the first operation-scoped ref; Plan 34-02's mount-time abortRef is preserved verbatim.
- MAJOR #4 fully closed: PreviewState discriminated union has `source: "validation" | "server"`; validation errors reset on field edit; server errors persist until next Preview.
- MINOR #7 closed: Plan 34-02's M3 + M7 placeholder assertions migrated to form-rendered checks within this plan.
- MINOR #8 closed: Toast spy from Plan 34-02's beforeEach is reused; no re-spying.
- All locked CONTEXT.md decisions for form + CodeMirror + Preview honored.
</success_criteria>

<output>
After completion, create `.planning/phases/34-dynamic-view-ui/34-03-SUMMARY.md` capturing:
- DynamicViewsModal.tsx LOC before (Plan 34-02 end) and after this plan.
- DynamicViewsModal.spec.tsx test count delta (was ~14; now ~27).
- global.css LOC added.
- Confirmation that:
  - previewRanSinceLastSave flag is wired and Plan 34-04 will consume.
  - Plan 34-02's mount-time abortRef is preserved (no rename).
  - Validation vs server error reset semantics implemented (data-error-source DOM attr).
  - Plan 34-02's M3 + M7 placeholder tests migrated to form checks.
- Note: Save flow + DashboardsPage wiring NOT yet implemented — Plan 34-04 closes Phase 34.
</output>
</content>
</invoke>