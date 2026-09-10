---
phase: 34-dynamic-view-ui
plan: 04
type: execute
wave: 3
depends_on:
  - "34-03"
files_modified:
  - kinetica_bi/src/components/DynamicViewsModal.tsx
  - kinetica_bi/src/components/DynamicViewsModal.spec.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - DV-V16-08
  - DV-V16-09
must_haves:
  truths:
    - "Operator clicks the new 'Dynamic Views' button on the dashboard action bar (4th button between 'Map Layers' and 'Back') → DynamicViewsModal opens with the current dashboard's views."
    - "Operator clicks Save → createDynamicView/updateDynamicView fires (with saveAbortRef.signal); on 201/200 success → buildDynamicViewName + markPending(id, viewName) + materializeDynamicView call. On materialized → setView + toast info. On over_threshold → setView with reason + toast info (NOT warning — kind doesn't exist). On error → setError + toast error. Save NOT gated on materialize success."
    - "columns_json carry (LOCKED per BLOCKER #1): Save body includes `columns_json` IFF `templateChanged && previewRanSinceLastSave && formColumnsJson !== null`. The stale-row-load case (row select → edit template_sql without Preview → Save) MUST NOT send columns_json — the server's auto-clear (CONTEXT 32 §D3) takes effect and persisted state stays consistent."
    - "Operator's form-field edits set isDirty=true. Closing the modal with isDirty=true (Close button, ESC, click-outside) triggers window.confirm('Discard unsaved changes?'); Cancel keeps the modal open; Discard closes. Save success clears isDirty so subsequent close skips the confirm."
    - "AbortController scope: 4 controllers total — mount-time `abortRef` (Plan 34-02; preserved verbatim for listDynamicViews) + 3 operation-scoped refs (`previewAbortRef` from Plan 34-03; `saveAbortRef` + `deleteAbortRef` added in this plan). Plan 34-02's delete handler is migrated to `deleteAbortRef` in this plan. Closing the modal mid-Save aborts the materialize call cleanly (AbortError silent)."
    - "Server 400 with `{ error: \"Dynamic view template must contain a {view} token.\" }` surfaces VERBATIM inline below the SQL editor (Save path) — relies on Plan 34-01's throwForStatus fix."
    - "Action-bar 'Dynamic Views' button on DashboardsPage opens the modal with dashboardId + associatedTables as PROPS (not via context)."
  artifacts:
    - path: "kinetica_bi/src/components/DynamicViewsModal.tsx"
      provides: "Extends Plan 34-03 with Save handler, saveAbortRef, deleteAbortRef, migrated handleDelete (now uses deleteAbortRef), Save button JSX, columns_json carry conditional (templateChanged && previewRanSinceLastSave && formColumnsJson !== null), dirty-state window.confirm wiring (isDirty now flips true on field edits — already from 34-03 — and is checked in handleCloseRequest)."
      min_lines: 600
    - path: "kinetica_bi/src/components/DynamicViewsModal.spec.tsx"
      provides: "Extends Plan 34-03 spec with S1-S11 Save coverage (CRUD success + 3 materialize branches + error + 3 columns_json carry cases including BLOCKER #1 stale-row-load case + AbortController cancellation) and D1-D3 dirty-state confirm coverage. Final test count ≈ 40."
      min_lines: 700
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "4th action-bar button 'Dynamic Views' + showDynamicViewsModal state + modal mount conditional with dashboardId={dashboard.id} + associatedTables={associatedTables} props."
      contains: "showDynamicViewsModal"
    - path: "kinetica_bi/src/components/DashboardsPage.spec.tsx"
      provides: "3 new tests: button renders after 'Map Layers'; clicking opens DynamicViewsModal with correct props; onClose closes the modal."
      contains: "Dynamic Views"
  key_links:
    - from: "kinetica_bi/src/components/DashboardsPage.tsx (action bar)"
      to: "DynamicViewsModal"
      via: "showDynamicViewsModal state + mount conditional"
      pattern: "showDynamicViewsModal && \\(\\s*<DynamicViewsModal"
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (Save handler)"
      to: "useDynamicViewStore.markPending + materializeDynamicView + setView/setError"
      via: "Save click → CRUD → markPending → materialize → setView/setError → toast"
      pattern: "markPending\\("
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (Save UPDATE body)"
      to: "columns_json carry-rule conditional"
      via: "if (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) body.columns_json = formColumnsJson"
      pattern: "templateChanged && previewRanSinceLastSave && formColumnsJson"
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (delete handler)"
      to: "deleteAbortRef"
      via: "Plan 34-02's handleDelete migrated; controller created inside handler"
      pattern: "deleteAbortRef\\.current"
---

<objective>
Final plan for Phase 34. Closes the Save flow (CRUD → materialize → toast), wires the action-bar button on DashboardsPage, locks the columns_json carry-rule state machine per BLOCKER #1, and migrates Plan 34-02's delete handler to its operation-scoped AbortController ref. Depends on Plan 34-03 (form + Preview + previewRanSinceLastSave flag).

**Scope this plan (Wave 3, depends on 34-03):**
- Save button + handler in `DynamicViewForm` / `DynamicViewsModal`. Local validation (name + table + template + max_records). CRUD call (`createDynamicView` for + New, `updateDynamicView` for edit). `saveAbortRef` wraps the full CRUD + materialize sequence. On 400, inline `sqlError` below editor with verbatim server message. On success: form re-loads canonical row from server response; isDirty resets; `previewRanSinceLastSave` resets to false (NEW Save session).
- columns_json carry-rule (LOCKED — BLOCKER #1):
  - CREATE: never sends columns_json (server defaults null).
  - UPDATE template unchanged: omit columns_json (server preserves).
  - UPDATE template changed AND previewRanSinceLastSave: send columns_json from Preview success.
  - UPDATE template changed AND NOT previewRanSinceLastSave: omit columns_json (server auto-clears per CONTEXT 32 §D3).
- Materialize sequence (LOCKED): buildDynamicViewName → markPending(id, viewName) → materializeDynamicView(id, saveAbortRef.signal) → setView OR setError → toast (kind "info" or "error" — NEVER "warning").
- `saveAbortRef` + `deleteAbortRef` operation-scoped refs (NEW in this plan).
- Migrate Plan 34-02's `handleDelete` to use `deleteAbortRef.current` for the abort signal.
- Update unmount cleanup effect to abort all three operation-scoped refs (`previewAbortRef` + `saveAbortRef` + `deleteAbortRef`).
- Type imports (NEW per MAJOR #3): `UpdateDynamicViewArgs`, plus existing types if not already imported.
- Dirty-state `window.confirm` close paths: the `handleCloseRequest` wrapper already exists from Plan 34-02 with `if (isDirty)` guard; this plan just relies on Plan 34-03's `isDirty` state which now flips true on field edits.
- Wire 4th action-bar button "Dynamic Views" on DashboardsPage between "Map Layers" and "Back" + modal mount conditional with `dashboardId={dashboard.id}` + `associatedTables={associatedTables}` props.
- Extend DashboardsPage.spec.tsx with 3 new tests (button render + open modal + onClose closes).
- Extend DynamicViewsModal.spec.tsx with S1-S11 (Save) + D1-D3 (dirty-state confirm) coverage.

**Out of scope:** Nothing — Phase 34 is feature-complete after this plan.

Purpose: Close DV-V16-08 fully (action-bar button + modal mount end-to-end), DV-V16-09 fully (Save button + materialize), and address all 9 checker issues from the verification report.

Output: DynamicViewsModal.tsx ~700 LOC, spec ~750 LOC with ~40 tests total, DashboardsPage 4th button + modal mount, DashboardsPage.spec.tsx +3 tests.
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
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md

<interfaces>
<!-- All Phase 33 client helpers - REQUIRED type imports per MAJOR #3 -->
```typescript
// Plan 34-04 MUST add these imports to DynamicViewsModal.tsx (Plan 34-03 already added DynamicViewColumn / PreviewDynamicViewResponse):
import {
  createDynamicView,
  updateDynamicView,
  materializeDynamicView,
  type UpdateDynamicViewArgs,   // NEW — Save UPDATE body type
  // DynamicViewRow already imported in Plan 34-02 — verify and DO NOT re-import.
} from "../api/client";

// Existing type shapes (already in client.ts):
export type DynamicViewRow = { id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json: string | null, created_at, updated_at };
export type CreateDynamicViewArgs = { source_table_id: number; name: string; template_sql: string; max_records: number };
export type UpdateDynamicViewArgs = Partial<{ source_table_id, name, template_sql, max_records, columns_json: string | null }>;
export type MaterializeDynamicViewResponse =
  | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
  | { status: "over_threshold"; reason: "no_filter" }
  | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number };

export const createDynamicView: (dashboardId: number, body: CreateDynamicViewArgs, signal?: AbortSignal) => Promise<{ dynamic_view: DynamicViewRow }>;
export const updateDynamicView: (id: number, body: UpdateDynamicViewArgs, signal?: AbortSignal) => Promise<{ dynamic_view: DynamicViewRow }>;
export const materializeDynamicView: (dynamicViewId: number, signal?: AbortSignal) => Promise<MaterializeDynamicViewResponse>;
```

<!-- Phase 33 store actions (Plan 34-04 calls these) -->
```typescript
useDynamicViewStore.getState().markPending(id: number, viewName: string): void;
useDynamicViewStore.getState().setView(id: number, payload: { viewName, status, expiresAt?, error?, reason? }): void;
useDynamicViewStore.getState().setError(id: number, error: string): void;
```

<!-- Phase 33 naming helper -->
```typescript
import { buildDynamicViewName } from "../lib/dynamicViewName";
// buildDynamicViewName({ userId: string; dashboardId: number; dynamicViewId: number }) → "_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>"
```

<!-- Auth store -->
```typescript
import { useAuthStore } from "../store/auth";
// useAuthStore.getState().user?.username  → string | undefined
```

<!-- columns_json carry state machine (LOCKED per BLOCKER #1) -->
```
                                        ┌────────────────────────────────────┐
                                        │ previewRanSinceLastSave state flag │
                                        └────────────────────────────────────┘

Plan 34-03 ownership:
  Initialize on mount/row-select/+New → false
  Flip true → ONLY on Preview success
  (Plan 34-03 already implemented these.)

Plan 34-04 ownership:
  Read in Save handler:
    if (isUpdate && templateChanged && previewRanSinceLastSave && formColumnsJson !== null)
      → body.columns_json = formColumnsJson
    else
      → omit columns_json from body
  Reset to false on Save success (starts a new Save session — operator must re-Preview to send columns_json again).

Test paths (S7, S8, S9 below):
  S7: UPDATE with no template change → omit columns_json
  S8: UPDATE with template change AND Preview ran AND columns_json available → send columns_json
  S9: UPDATE with template change AND Preview NOT ran → omit columns_json (BLOCKER #1 case)
```

<!-- DashboardsPage action-bar template -->
```tsx
<div className="dashboard-toolbar">
  <button className="btn-primary btn-sm" onClick={() => setShowTableModal(true)}>Tables</button>
  <button className="btn-primary btn-sm" onClick={() => setShowVizModal(true)}>Visualizations</button>
  <button className="btn-primary btn-sm" onClick={() => setShowLayersModal(true)}>Map Layers</button>
  <button className="btn-primary btn-sm" onClick={() => setShowDynamicViewsModal(true)}>Dynamic Views</button>  {/* NEW */}
  <button className="ghost-sm" onClick={onBack}>Back</button>
</div>
```

<!-- Modal mount template -->
```tsx
{showLayersModal && (<LayersModal layers={...} associatedTables={associatedTables} onClose={handleLayersModalClose} ... />)}
{showDynamicViewsModal && (
  <DynamicViewsModal
    dashboardId={dashboard.id}
    associatedTables={associatedTables}
    onClose={() => setShowDynamicViewsModal(false)}
  />
)}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add saveAbortRef + deleteAbortRef + migrate handleDelete; lock 4-controller scope (MAJOR #2 + MAJOR #3 type imports)</name>
  <files>kinetica_bi/src/components/DynamicViewsModal.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DynamicViewsModal.tsx (Plan 34-03 output — full file; this task extends refs and migrates delete handler)
    - kinetica_bi/src/api/client.ts (lines 778-901 — verify exact export names: createDynamicView, updateDynamicView, materializeDynamicView, UpdateDynamicViewArgs, CreateDynamicViewArgs, MaterializeDynamicViewResponse)
    - kinetica_bi/src/store/auth.ts (verify the `useAuthStore.getState().user?.username` field path)
    - kinetica_bi/src/lib/dynamicViewName.ts (verify the buildDynamicViewName signature)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (section "AbortController scope")
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Pattern 5 — 3 operation-scoped refs)
  </read_first>
  <behavior>
    No new spec tests this task — it's a structural prep step. Spec coverage of the migrated delete handler is via the unchanged Plan 34-02 M8-M10 tests (which still pass because the delete contract is unchanged, only the abort signal source changes).

    Verification: Plan 34-02's M8 (happy delete), M9 (Keep view cancel), M10 (delete error) tests STILL PASS after the migration. Plan 34-03's tests STILL PASS.
  </behavior>
  <action>
**Step 1: Add missing type imports (MAJOR #3).**

At the top of `DynamicViewsModal.tsx`, extend the existing `import { ... } from "../api/client"` to include:

```typescript
import {
  listDynamicViews,
  deleteDynamicView,
  createDynamicView,                    // NEW (Plan 34-04 Save handler)
  updateDynamicView,                    // NEW (Plan 34-04 Save handler)
  materializeDynamicView,               // NEW (Plan 34-04 Save handler)
  previewDynamicView,                   // already from Plan 34-03
  type DynamicViewRow,                  // already from Plan 34-02
  type TableDto,                        // already from Plan 34-02
  type UpdateDynamicViewArgs,           // NEW (MAJOR #3 — Save UPDATE body type)
  type DynamicViewColumn,               // already from Plan 34-03
  type PreviewDynamicViewResponse,      // already from Plan 34-03
} from "../api/client";

import { buildDynamicViewName } from "../lib/dynamicViewName";  // NEW
import { useAuthStore } from "../store/auth";                    // NEW
```

Verify no duplicate imports.

**Step 2: Add saveAbortRef + deleteAbortRef + extend cleanup effect.**

Find the existing `previewAbortRef` declaration (added in Plan 34-03). Immediately after it, add:

```typescript
const saveAbortRef = useRef<AbortController | null>(null);
const deleteAbortRef = useRef<AbortController | null>(null);
```

Update the unmount cleanup effect (added by Plan 34-03 for previewAbortRef) to abort ALL three:

```typescript
useEffect(() => () => {
  previewAbortRef.current?.abort();
  saveAbortRef.current?.abort();
  deleteAbortRef.current?.abort();
}, []);
```

DO NOT touch Plan 34-02's mount-time `abortRef` — it continues to scope the `listDynamicViews` call exclusively (its cleanup is inside the `useEffect([dashboardId])` block, not here).

Add a comment documenting the 4-controller scope (MAJOR #2 lock):

```typescript
// AbortController inventory (4 total, per CONTEXT.md "AbortController scope"):
//   1. abortRef          — Plan 34-02; mount-time, scoped to listDynamicViews call.
//   2. previewAbortRef   — Plan 34-03; operation-scoped, aborted on next Preview click + unmount.
//   3. saveAbortRef      — Plan 34-04 (this plan); operation-scoped, wraps CRUD + materialize.
//   4. deleteAbortRef    — Plan 34-04 (this plan); operation-scoped, wraps deleteDynamicView call.
```

**Step 3: Migrate `handleDelete` to use `deleteAbortRef`.**

Find the existing Plan 34-02 `handleDelete` (uses `deleteDynamicView(id)` with no signal). Replace it with:

```typescript
const handleDelete = async (id: number) => {
  deleteAbortRef.current?.abort();
  const ctrl = new AbortController();
  deleteAbortRef.current = ctrl;
  try {
    await deleteDynamicView(id, ctrl.signal);
    if (ctrl.signal.aborted) return;
    useDynamicViewStore.getState().clearView(id);
    setViews((prev) => (prev ?? []).filter((v) => v.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setIsDraft(false);
    }
    useToastStore.getState().showToast("View deleted", "info");
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return; // silent
    const msg = (err as Error)?.message ?? "unknown";
    useToastStore.getState().showToast(`Failed to delete view: ${msg}`, "error");
  } finally {
    setConfirmDeleteId(null);
  }
};
```

Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` — all existing tests STILL PASS (Plan 34-02's M8/M9/M10 + Plan 34-03's F1-F8/P1-P7).
Run `cd kinetica_bi && npx tsc --noEmit` — clean.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "import.*UpdateDynamicViewArgs" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (MAJOR #3 — type imported).
    - `grep -q "import.*createDynamicView" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "import.*updateDynamicView" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "import.*materializeDynamicView" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "import.*buildDynamicViewName" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "useAuthStore" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -c "new AbortController()" kinetica_bi/src/components/DynamicViewsModal.tsx` returns ≥ 4 (MAJOR #2 lock — mount-time + 3 ops). Note: count includes the controller created INSIDE handleDelete (the per-call instance — 1 unique `new` site that gets executed many times) plus the mount-time `useEffect`. After Task 2 of this plan adds handleSaveClick, the count grows to 4 unique `new` sites; the operator should run this assertion AT THE END of all Task 2 work, but Task 1's intermediate state should already show ≥ 3 sites (mount-time + previewAbortRef + deleteAbortRef).
    - `grep -q "deleteAbortRef" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (MAJOR #2).
    - `grep -q "saveAbortRef" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (MAJOR #2).
    - `grep -q "previewAbortRef" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (carried from Plan 34-03).
    - `grep -q "deleteAbortRef.current?.abort()" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (delete handler migrated).
    - `grep -q "deleteDynamicView(id, ctrl.signal)" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (delete passes operation signal, not undefined).
    - `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits 0 (all Plan 34-02 + 34-03 tests still pass — no regressions).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>
    Type imports added (UpdateDynamicViewArgs, createDynamicView, updateDynamicView, materializeDynamicView, buildDynamicViewName, useAuthStore). saveAbortRef + deleteAbortRef declared. Cleanup effect aborts all 3 operation refs. Plan 34-02's handleDelete migrated to deleteAbortRef. All existing tests still green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add Save handler with columns_json carry state machine (BLOCKER #1) + Save button JSX + spec coverage (S1-S11, D1-D3)</name>
  <files>kinetica_bi/src/components/DynamicViewsModal.tsx, kinetica_bi/src/components/DynamicViewsModal.spec.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/DynamicViewsModal.tsx (Task 1 of this plan — full file; this task adds handleSaveClick + Save button JSX)
    - kinetica_bi/src/components/DynamicViewsModal.spec.tsx (Plan 34-03 spec — extend with Save + dirty-state coverage)
    - kinetica_bi/src/api/client.ts (lines 778-901 — createDynamicView, updateDynamicView, materializeDynamicView, UpdateDynamicViewArgs)
    - kinetica_bi/src/lib/dynamicViewName.ts (signature)
    - kinetica_bi/src/store/auth.ts (`useAuthStore.getState().user?.username`)
    - kinetica_bi/src/store/dynamicViewStore.ts (markPending / setView / setError signatures)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (sections: "Save flow", "Materialize step", "Materialize feedback surfaces", "Edit semantics" — columns_json carry rules)
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Pitfall 5 — toast dedup; Pitfall 7 — disable form during save; Code Example 3 — full Save handler reference)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md (§D3 — columns_json auto-clear contract on UPDATE with template_sql change)
  </read_first>
  <behavior>
    All new it() blocks. Toast spy from Plan 34-02's beforeEach is reused (MINOR #8 lock — DO NOT re-spy). Assertion pattern for toast calls:

    ```typescript
    const toastFn = useToastStore.getState().showToast as ReturnType<typeof vi.fn>;
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("materialized"), "info");
    // or
    expect(toastFn.mock.calls[0]).toEqual([expect.stringContaining("materialized"), "info"]);
    ```

    For auth mocking, use `vi.spyOn(useAuthStore, "getState").mockReturnValue({ user: { username: "alice" } } as any)` in each Save test's setup block (or beforeEach).

    **S1: Save — name required validation (no network)**
    - Open + New, leave name empty, fill SQL + table → click Save → inline error "Name is required" below name input. mockedClient.createDynamicView NOT called.

    **S2: Save — CRUD success → markPending → materialize → setView (materialized) + info toast**
    - Mock createDynamicView → `{ dynamic_view: makeRow(42, "demo") }`.
    - Mock materializeDynamicView → `{ status: "materialized", view_name: "_kbi_dv_u_alice_d5_42", row_count: 100, expires_at: 1234567890 }`.
    - Spy on `useDynamicViewStore.getState().markPending` and `setView`. Spy on useAuthStore → username "alice".
    - Fill form (name="demo", template="SELECT 1 FROM {view}"); click Save.
    - Assert (in order, with waitFor):
      1. createDynamicView called with body `{ source_table_id: 2, name: "demo", template_sql: "SELECT 1 FROM {view}", max_records: 10000 }` — no columns_json.
      2. markPending called with `(42, "_kbi_dv_u_alice_d5_42")`.
      3. materializeDynamicView called with `(42, expect.anything())` (signal arg).
      4. setView called with `(42, { viewName: "_kbi_dv_u_alice_d5_42", status: "materialized", expiresAt: 1234567890 })`.
      5. showToast called with message containing `"materialized"` and kind `"info"`.
      6. Form re-loads with canonical row from server response; isDirty resets to false; previewRanSinceLastSave resets to false (assert indirectly via subsequent Save body containing no columns_json).

    **S3: Save — over_threshold/no_filter → setView + info toast**
    - Mock create success + materialize → `{ status: "over_threshold", reason: "no_filter" }`.
    - Assert: setView with `(42, { viewName: "_kbi_dv_u_alice_d5_42", status: "over_threshold", reason: "no_filter" })`. showToast with message containing `"no filter active"` and kind `"info"` (NOT "warning").

    **S4: Save — over_threshold/exceeds_max_records → setView + info toast**
    - Mock create success + materialize → `{ status: "over_threshold", reason: "exceeds_max_records", row_count: 15000 }`.
    - Assert: setView with `{ viewName, status: "over_threshold", reason: "exceeds_max_records" }`. showToast with message containing `"15000"` and `"exceeds max_records"`; kind `"info"`.

    **S5: Save — CRUD 400 → inline server message verbatim; Save re-enabled; NO markPending/materialize**
    - Mock createDynamicView to reject with `new Error("Dynamic view template must contain a {view} token.")`. (Plan 34-01's throwForStatus preserves verbatim.)
    - Click Save → inline error below SQL editor shows EXACTLY `"Dynamic view template must contain a {view} token."` Save button re-enabled. markPending/materialize NEVER called.

    **S6: Save — materialize error → setError + error toast**
    - Mock create success → materialize rejects with `new Error("Kinetica error: SqlEngine error")`.
    - Assert: setError called with `(42, "Kinetica error: SqlEngine error")`. showToast with kind `"error"` and message containing `"Kinetica error"`. Form stays loaded with canonical row (CRUD persisted; materialize is recoverable).

    **S7: Save — UPDATE existing view (no template change) → omits columns_json**
    - Pre-existing row `{ id: 5, template_sql: "SELECT 1", columns_json: '{"col": "INT"}' }`. Click row → form populates. Change NAME only (e.g., "newname"). Click Save → updateDynamicView called with body `{ name: "newname", source_table_id, template_sql: "SELECT 1", max_records }` — `columns_json` OMITTED.

    **S8: Save — UPDATE template_sql changed AND Preview ran → SENDS columns_json**
    - Pre-existing row with template "SELECT 1". Click row → form populates. Click Preview (mock returns columns). Change template to "SELECT 2 FROM {view}". Click Save → updateDynamicView called with body INCLUDING `columns_json: JSON.stringify(previewColumns)`.

    **S9: Save — UPDATE template_sql changed AND Preview NOT run → OMITS columns_json (BLOCKER #1 case)**
    - Pre-existing row `{ id: 5, template_sql: "SELECT 1", columns_json: '{"col": "INT"}' }`. Click row → form populates (formColumnsJson now contains the stale row data; previewRanSinceLastSave is false).
    - Change template_sql to "SELECT 2 FROM {view}" but DO NOT click Preview. Click Save.
    - Assert: updateDynamicView called with body containing `template_sql: "SELECT 2 FROM {view}"` AND `name`, `source_table_id`, `max_records` — but NOT `columns_json` (assert via `expect(body).not.toHaveProperty("columns_json")` OR explicit check that `body.columns_json === undefined`).
    - This is the CRITICAL BLOCKER #1 test — without the previewRanSinceLastSave flag, the previous implementation would send the stale columns_json from the row load. The fix ensures the server's auto-clear (CONTEXT 32 §D3) takes effect.

    **S10: Save — previewRanSinceLastSave resets on Save success (re-Save without re-Preview omits columns_json)**
    - Setup: + New form, fill, run Preview (previewRanSinceLastSave=true), click Save → mock CREATE success → materialize success.
    - Now the modal stays open with the canonical row loaded. previewRanSinceLastSave should now be FALSE (reset on Save success).
    - Change template_sql (does NOT click Preview). Click Save again → updateDynamicView called with the new template_sql but NO columns_json (because previewRanSinceLastSave was reset).
    - This is a regression guard: a Save-Save sequence without intervening Preview must NOT carry the columns_json from the first Save's Preview.

    **S11: Save AbortController on modal close**
    - Mock create returns a never-resolving promise (capture the signal). Click Save → Save button shows spinner/disabled. Unmount component (modal close) → saveAbortRef signal.aborted === true.

    **D1: Dirty-state confirm — Cancel keeps modal open**
    - Open + New form. Type in name field → isDirty=true (Plan 34-03 wired this).
    - Mock `window.confirm` to return false.
    - Click Close button → window.confirm called with `"Discard unsaved changes?"`. mockOnClose NOT called.

    **D2: Dirty-state confirm — Discard closes**
    - Same setup; mock `window.confirm` returns true → mockOnClose called once.

    **D3: Save success clears dirty**
    - Fill form, click Save (mock CRUD + materialize success). After Save resolves, click Close button → window.confirm NOT called; mockOnClose called directly.
    - Asserts that Save success resets isDirty=false in addition to previewRanSinceLastSave=false.

    Total new tests this task: 11 (S1-S11) + 3 (D1-D3) = 14.
    Spec total after Plan 34-04: ~27 (Plan 34-03 end) + 14 ≈ 41 tests.
  </behavior>
  <action>
**Step 1: Add `saving` state + handleSaveClick in DynamicViewsModal.tsx.**

After Plan 34-03's `previewLoading` state, add:

```typescript
const [saving, setSaving] = useState(false);
```

Implement `handleSaveClick` — strictly enforces the locked columns_json carry rule (BLOCKER #1):

```typescript
const handleSaveClick = async () => {
  // Local validation
  let hasErr = false;
  if (!formName.trim()) { setNameError("Name is required"); hasErr = true; }
  if (formSourceTableId === null) { setTableError("Source table is required"); hasErr = true; }
  if (!formTemplateSql.trim()) { setSqlError("Template SQL is required"); hasErr = true; }
  if (formMaxRecords < 1) { setMaxRecordsError("Max records must be at least 1"); hasErr = true; }
  if (hasErr) return;

  saveAbortRef.current?.abort();
  const ctrl = new AbortController();
  saveAbortRef.current = ctrl;
  setSaving(true);
  setSqlError(null); // clear any prior server-error inline

  try {
    let row: DynamicViewRow;
    if (isDraft) {
      // CREATE — never sends columns_json (server defaults null).
      const result = await createDynamicView(dashboardId, {
        source_table_id: formSourceTableId!,
        name: formName.trim(),
        template_sql: formTemplateSql,
        max_records: formMaxRecords,
      }, ctrl.signal);
      row = result.dynamic_view;
    } else {
      // UPDATE — columns_json carry-rule (LOCKED per BLOCKER #1):
      //   templateChanged && previewRanSinceLastSave && formColumnsJson !== null  →  send
      //   else                                                                    →  omit (server preserves or auto-clears)
      const templateChanged = formTemplateSql !== originalTemplateSql;
      const body: UpdateDynamicViewArgs = {
        source_table_id: formSourceTableId!,
        name: formName.trim(),
        template_sql: formTemplateSql,
        max_records: formMaxRecords,
      };
      if (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) {
        body.columns_json = formColumnsJson;
      }
      const result = await updateDynamicView(selectedId!, body, ctrl.signal);
      row = result.dynamic_view;
    }

    if (ctrl.signal.aborted) return;

    // CRUD success — refresh local list + reset form to canonical
    setViews((prev) => {
      if (!prev) return prev;
      const idx = prev.findIndex((v) => v.id === row.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
    setSelectedId(row.id);
    setIsDraft(false);
    setOriginalTemplateSql(row.template_sql);
    setFormColumnsJson(row.columns_json);
    setIsDirty(false);
    setPreviewRanSinceLastSave(false);   // LOCKED — new Save session; operator must re-Preview to send columns_json.

    // Materialize sequence
    const username = useAuthStore.getState().user?.username;
    if (!username) {
      useToastStore.getState().showToast("Session expired — please log in again", "error");
      return;
    }
    const viewName = buildDynamicViewName({
      userId: username,
      dashboardId,
      dynamicViewId: row.id,
    });
    useDynamicViewStore.getState().markPending(row.id, viewName);

    try {
      const matResult = await materializeDynamicView(row.id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (matResult.status === "materialized") {
        useDynamicViewStore.getState().setView(row.id, {
          viewName: matResult.view_name,
          status: "materialized",
          expiresAt: matResult.expires_at,
        });
        useToastStore.getState().showToast(`Dynamic view "${row.name}" materialized`, "info");
      } else if (matResult.status === "over_threshold") {
        useDynamicViewStore.getState().setView(row.id, {
          viewName,
          status: "over_threshold",
          reason: matResult.reason,
        });
        if (matResult.reason === "no_filter") {
          useToastStore.getState().showToast(
            `Saved "${row.name}" — no filter active; view will materialize when a filter is applied.`,
            "info",
          );
        } else {
          // exceeds_max_records — LOCKED: use "info" NOT "warning" (kind doesn't exist).
          useToastStore.getState().showToast(
            `Saved "${row.name}" — ${matResult.row_count} rows exceeds max_records ${row.max_records}; raise the threshold or narrow filters.`,
            "info",
          );
        }
      }
    } catch (matErr) {
      if ((matErr as Error)?.name === "AbortError") return;
      const matMsg = (matErr as Error).message ?? "unknown";
      useDynamicViewStore.getState().setError(row.id, matMsg);
      useToastStore.getState().showToast(`Materialize failed: ${matMsg}`, "error");
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    const msg = (err as Error).message ?? "Save failed";
    // Inline error below editor with verbatim server message (Plan 34-01's throwForStatus preserves it).
    setSqlError(msg);
  } finally {
    setSaving(false);
  }
};
```

**Step 2: Add Save button JSX inside `DynamicViewForm` sub-component.**

Pass `saving` + `onSaveClick` props from parent. Render after the Preview output panel:

```tsx
<div className="dynamic-views-modal-form-actions">
  <button
    type="button"
    className="btn-primary"
    onClick={onSaveClick}
    disabled={saving}
  >
    {saving ? "Saving…" : "Save"}
  </button>
</div>
```

Update the `DynamicViewForm` prop type to include `saving: boolean` and `onSaveClick: () => void`.

Pass from the parent's render:
```tsx
<DynamicViewForm
  // ... existing props from Plan 34-03 ...
  saving={saving}
  onSaveClick={handleSaveClick}
/>
```

**Step 3: Extend DynamicViewsModal.spec.tsx with S1-S11 + D1-D3.**

Add to top of spec (if not already from Plan 34-03):

```typescript
import { useAuthStore } from "../store/auth";
import { buildDynamicViewName } from "../lib/dynamicViewName";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listDynamicViews: vi.fn(),
    deleteDynamicView: vi.fn(),
    previewDynamicView: vi.fn(),
    createDynamicView: vi.fn(),       // NEW Plan 34-04
    updateDynamicView: vi.fn(),       // NEW Plan 34-04
    materializeDynamicView: vi.fn(),  // NEW Plan 34-04
  };
});

const mockedClient = clientModule as {
  listDynamicViews: ReturnType<typeof vi.fn>;
  deleteDynamicView: ReturnType<typeof vi.fn>;
  previewDynamicView: ReturnType<typeof vi.fn>;
  createDynamicView: ReturnType<typeof vi.fn>;
  updateDynamicView: ReturnType<typeof vi.fn>;
  materializeDynamicView: ReturnType<typeof vi.fn>;
};
```

Add a new nested describe `describe("DynamicViewsModal (Save + dirty-state — Plan 34-04)", () => { ... })` with the 14 tests S1-S11 and D1-D3.

Auth + store spy setup helper (use inside each test):

```typescript
const setupAuth = (username = "alice") => {
  vi.spyOn(useAuthStore, "getState").mockReturnValue({ user: { username } } as any);
};
const markPendingSpy = () => vi.spyOn(useDynamicViewStore.getState(), "markPending");
const setViewSpy = () => vi.spyOn(useDynamicViewStore.getState(), "setView");
const setErrorSpy = () => vi.spyOn(useDynamicViewStore.getState(), "setError");

const fillNewForm = (name = "demo", sql = "SELECT 1 FROM {view}") => {
  fireEvent.click(screen.getByText("+ New dynamic view"));
  fireEvent.change(screen.getByPlaceholderText("Name your dynamic view"), { target: { value: name } });
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: sql } });
};
```

Critical test — S9 (BLOCKER #1 case):

```typescript
it("S9: UPDATE with template_sql changed AND Preview NOT run → omits columns_json (BLOCKER #1)", async () => {
  const existingRow = {
    ...makeRow(5, "existing"),
    template_sql: "SELECT 1",
    columns_json: JSON.stringify([{ name: "stale", type: "INT" }]),
  };
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [existingRow] });
  mockedClient.updateDynamicView.mockResolvedValue({
    dynamic_view: { ...existingRow, template_sql: "SELECT 2 FROM {view}", columns_json: null },
  });
  mockedClient.materializeDynamicView.mockResolvedValue({
    status: "materialized", view_name: "_kbi_dv_u_alice_d5_5", row_count: 1, expires_at: 0,
  });
  setupAuth("alice");
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText("existing");
  // Click the row (NOT + New).
  fireEvent.click(screen.getByText("existing"));
  // Form should populate with template_sql = "SELECT 1" and formColumnsJson = the stale JSON.
  // CRITICAL: previewRanSinceLastSave is false (row select reset it; Plan 34-03 lock).
  // Change template_sql WITHOUT clicking Preview.
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "SELECT 2 FROM {view}" } });
  // Click Save.
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  // Assert: updateDynamicView was called with template_sql AND no columns_json.
  await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
  const callArgs = mockedClient.updateDynamicView.mock.calls[0];
  const body = callArgs[1];
  expect(body.template_sql).toBe("SELECT 2 FROM {view}");
  // BLOCKER #1 assertion — body must NOT contain columns_json.
  expect(body).not.toHaveProperty("columns_json");
});
```

S2 (full happy path):

```typescript
it("S2: Save: createDynamicView → markPending → materialize → setView (materialized) + info toast", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.createDynamicView.mockResolvedValue({
    dynamic_view: makeRow(42, "demo"),
  });
  mockedClient.materializeDynamicView.mockResolvedValue({
    status: "materialized",
    view_name: "_kbi_dv_u_alice_d5_42",
    row_count: 100,
    expires_at: 1234567890,
  });
  setupAuth("alice");
  const markPendingFn = markPendingSpy();
  const setViewFn = setViewSpy();
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  fillNewForm("demo", "SELECT 1 FROM {view}");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
  const createBody = mockedClient.createDynamicView.mock.calls[0][1];
  expect(createBody).toEqual({
    source_table_id: 2,
    name: "demo",
    template_sql: "SELECT 1 FROM {view}",
    max_records: 10000,
  });
  expect(createBody).not.toHaveProperty("columns_json");

  await waitFor(() => expect(markPendingFn).toHaveBeenCalledWith(42, "_kbi_dv_u_alice_d5_42"));
  await waitFor(() => expect(mockedClient.materializeDynamicView).toHaveBeenCalledWith(42, expect.anything()));
  await waitFor(() => expect(setViewFn).toHaveBeenCalledWith(42, {
    viewName: "_kbi_dv_u_alice_d5_42",
    status: "materialized",
    expiresAt: 1234567890,
  }));

  const toastFn = useToastStore.getState().showToast as ReturnType<typeof vi.fn>;
  await waitFor(() => {
    const calls = toastFn.mock.calls;
    expect(calls.some(([msg, kind]) => String(msg).includes("materialized") && kind === "info")).toBe(true);
  });
});
```

S5 (verbatim 400 inline):

```typescript
it("S5: Save 400 surfaces server message verbatim below editor; no materialize", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.createDynamicView.mockRejectedValueOnce(
    new Error("Dynamic view template must contain a {view} token."),
  );
  setupAuth("alice");
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  fillNewForm("demo", "SELECT 1");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByText("Dynamic view template must contain a {view} token.")).toBeInTheDocument(),
  );
  expect(mockedClient.materializeDynamicView).not.toHaveBeenCalled();
});
```

S10 (regression — previewRanSinceLastSave resets on Save success):

```typescript
it("S10: previewRanSinceLastSave resets on Save success; subsequent Save without re-Preview omits columns_json", async () => {
  // Setup mocks: empty list, successful CREATE, successful Preview, successful UPDATE (second Save).
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.createDynamicView.mockResolvedValue({
    dynamic_view: makeRow(42, "demo"),
  });
  mockedClient.previewDynamicView.mockResolvedValue({
    rows: [["a"]], columns: [{ name: "c", type: "TEXT" }],
  });
  mockedClient.materializeDynamicView.mockResolvedValue({
    status: "materialized", view_name: "_kbi_dv_u_alice_d5_42", row_count: 1, expires_at: 0,
  });
  mockedClient.updateDynamicView.mockResolvedValue({
    dynamic_view: { ...makeRow(42, "demo"), template_sql: "SELECT 3 FROM {view}", columns_json: null },
  });
  setupAuth("alice");
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={() => {}} />);
  await screen.findByText(/No dynamic views yet/);
  // Step 1: + New, fill, Preview, Save.
  fillNewForm("demo", "SELECT 1 FROM {view}");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(mockedClient.previewDynamicView).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
  // Step 2: form now shows the saved row (id=42). Change template_sql WITHOUT Preview.
  await waitFor(() => expect(screen.getByDisplayValue("demo")).toBeInTheDocument());
  fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: "SELECT 3 FROM {view}" } });
  // Click Save again.
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
  // Assert: second Save body does NOT contain columns_json (previewRanSinceLastSave was reset on first Save).
  const updateBody = mockedClient.updateDynamicView.mock.calls[0][1];
  expect(updateBody.template_sql).toBe("SELECT 3 FROM {view}");
  expect(updateBody).not.toHaveProperty("columns_json");
});
```

D1-D3 (dirty-state confirm):

```typescript
it("D1: Dirty-state confirm — Cancel keeps modal open", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  const onClose = vi.fn();
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={onClose} />);
  await screen.findByText(/No dynamic views yet/);
  fireEvent.click(screen.getByText("+ New dynamic view"));
  fireEvent.change(screen.getByPlaceholderText("Name your dynamic view"), { target: { value: "x" } });
  // isDirty=true now.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
  expect(onClose).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it("D2: Dirty-state confirm — Discard closes", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  const onClose = vi.fn();
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={onClose} />);
  await screen.findByText(/No dynamic views yet/);
  fireEvent.click(screen.getByText("+ New dynamic view"));
  fireEvent.change(screen.getByPlaceholderText("Name your dynamic view"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(confirmSpy).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
});

it("D3: Save success clears dirty — subsequent Close skips confirm", async () => {
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  mockedClient.createDynamicView.mockResolvedValue({ dynamic_view: makeRow(42, "demo") });
  mockedClient.materializeDynamicView.mockResolvedValue({
    status: "materialized", view_name: "v", row_count: 1, expires_at: 0,
  });
  setupAuth("alice");
  const onClose = vi.fn();
  const confirmSpy = vi.spyOn(window, "confirm");
  render(<DynamicViewsModal dashboardId={5} associatedTables={[sampleTable]} onClose={onClose} />);
  await screen.findByText(/No dynamic views yet/);
  fillNewForm("demo", "SELECT 1 FROM {view}");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
  await waitFor(() => expect(useDynamicViewStore.getState().views[42]).toBeDefined());
  // Now close — isDirty=false → no confirm.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
});
```

Add S1, S3, S4, S6, S7, S8, S11 following the same patterns.

Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx`. ~41 tests should pass.
Run `cd kinetica_bi && npx vitest run` — full suite green.
Run `cd kinetica_bi && npx tsc --noEmit` — clean.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "handleSaveClick" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "createDynamicView(" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "updateDynamicView(" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "materializeDynamicView(" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "buildDynamicViewName(" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "markPending(" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "templateChanged && previewRanSinceLastSave && formColumnsJson" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (BLOCKER #1 conditional present).
    - `grep -q "setPreviewRanSinceLastSave(false)" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (reset on Save success — BLOCKER #1 lock).
    - `grep -q '"info"' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (info toast kind used).
    - `grep '"warning"' kinetica_bi/src/components/DynamicViewsModal.tsx | wc -l` returns 0 (warning kind NOT used).
    - `grep -q "window.confirm" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (dirty-state confirm wired from Plan 34-02; unchanged).
    - `grep -q "Discard unsaved changes" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "no filter active" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q "exceeds max_records" kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -c "new AbortController()" kinetica_bi/src/components/DynamicViewsModal.tsx` returns ≥ 4 (MAJOR #2 final lock — mount-time + 3 ops).
    - Spec contains the BLOCKER #1 test:
      - `grep -q "BLOCKER #1\|S9:.*omits columns_json" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
      - `grep -q "expect(body).not.toHaveProperty..columns_json.." kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0 (the actual assertion).
    - `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits 0 with ≥ 38 tests passing (~41 expected).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green).
  </acceptance_criteria>
  <done>
    Save handler implemented with locked columns_json carry rule (BLOCKER #1: `templateChanged && previewRanSinceLastSave && formColumnsJson !== null`). previewRanSinceLastSave resets on Save success. Materialize sequence + toast surfacing. Save button JSX present. ~14 new spec tests including the critical BLOCKER #1 S9 case. Dirty-state confirm (D1-D3) green. tsc + full vitest clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire 4th action-bar button on DashboardsPage + extend DashboardsPage.spec.tsx</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx (lines 1-100 for imports; lines 690-720 for action-bar; lines 920-960 for modal mount conditionals; locate `associatedTables` and `dashboard.id` variables in scope)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (existing structure — find the closest "Tables button opens TablePickerModal" or "Map Layers button opens LayersModal" test to mirror)
    - kinetica_bi/src/components/DynamicViewsModal.tsx (the component built in Plan 34-03 + this plan's Tasks 1-2)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (section "Action-bar button placement")
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Pattern 9 — Dashboard ID source; locked: prop, not context)
  </read_first>
  <behavior>
    Test additions to DashboardsPage.spec.tsx:

    **B1: "Dynamic Views" button renders in action bar**
    - After mounting DashboardsPage with a selected dashboard, query `screen.getByRole("button", { name: "Dynamic Views" })` succeeds.
    - Button appears AFTER "Map Layers" and BEFORE "Back" — verify via sibling ordering.

    **B2: Clicking "Dynamic Views" opens the modal (mocked) with correct props**
    - Mock DynamicViewsModal import; capture props via `(globalThis as any).__lastDVMProps = props`.
    - Click button → `data-testid="dynamic-views-modal-mock"` appears.
    - Assert `capturedProps.dashboardId` is a number === fixture's `dashboard.id`; `capturedProps.associatedTables` is an array; `capturedProps.onClose` is a function.

    **B3: onClose prop closes the modal**
    - Click button → modal renders. Click the mock's "close" button (which calls `props.onClose`) → modal no longer rendered.

    **B0 (negative)**: Before clicking, `screen.queryByTestId("dynamic-views-modal-mock")` returns null.

    Run total: 3 new tests passing.
  </behavior>
  <action>
**Step 1: Modify DashboardsPage.tsx.**

a. Add import (alphabetical with other component imports):
```typescript
import DynamicViewsModal from "./DynamicViewsModal";
```

b. Add state near existing `showLayersModal` useState:
```typescript
const [showDynamicViewsModal, setShowDynamicViewsModal] = useState(false);
```

c. Insert 4th action-bar button BETWEEN "Map Layers" and "Back" (around line 705-708):

```tsx
<button className="btn-primary btn-sm" onClick={() => setShowLayersModal(true)}>
  Map Layers
</button>
<button className="btn-primary btn-sm" onClick={() => setShowDynamicViewsModal(true)}>
  Dynamic Views
</button>
<button className="ghost-sm" onClick={onBack}>Back</button>
```

d. Insert modal mount conditional ADJACENT to LayersModal mount (around line 947-958), AFTER LayersModal's conditional:

```tsx
{showLayersModal && (
  <LayersModal ... />
)}

{showDynamicViewsModal && (
  <DynamicViewsModal
    dashboardId={dashboard.id}
    associatedTables={associatedTables}
    onClose={() => setShowDynamicViewsModal(false)}
  />
)}
```

Verify `dashboard.id` and `associatedTables` are both in scope at the modal-mount location (they're used by LayersModal at line 947-958, so they MUST already be in scope).

DO NOT modify the `DashboardContextProvider` wrap region — DynamicViewsModal receives dashboardId via prop (research correction #3).

**Step 2: Extend DashboardsPage.spec.tsx.**

Find the existing describe block near "LayersModal button" tests. Add:

```typescript
describe("Phase 34: Dynamic Views button", () => {
  vi.mock("./DynamicViewsModal", () => {
    return {
      default: (props: {
        dashboardId: number;
        associatedTables: unknown[];
        onClose: () => void;
      }) => {
        (globalThis as any).__lastDVMProps = props;
        return (
          <div data-testid="dynamic-views-modal-mock">
            DVM dashboardId={props.dashboardId} tables={props.associatedTables.length}
            <button onClick={props.onClose}>close-dvm</button>
          </div>
        );
      },
    };
  });

  beforeEach(() => {
    (globalThis as any).__lastDVMProps = null;
  });

  it("renders 'Dynamic Views' button in dashboard action bar after Map Layers", async () => {
    await renderDashboardsPageWithOpenDashboard();
    const button = await screen.findByRole("button", { name: "Dynamic Views" });
    expect(button).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    const mapLayersIdx = buttons.findIndex((b) => b.textContent === "Map Layers");
    const dvIdx = buttons.findIndex((b) => b.textContent === "Dynamic Views");
    expect(dvIdx).toBeGreaterThan(mapLayersIdx);
  });

  it("clicking 'Dynamic Views' opens DynamicViewsModal with dashboardId + associatedTables props", async () => {
    await renderDashboardsPageWithOpenDashboard();
    expect(screen.queryByTestId("dynamic-views-modal-mock")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dynamic Views" }));
    expect(screen.getByTestId("dynamic-views-modal-mock")).toBeInTheDocument();
    const props = (globalThis as any).__lastDVMProps;
    expect(typeof props.dashboardId).toBe("number");
    expect(Array.isArray(props.associatedTables)).toBe(true);
    expect(typeof props.onClose).toBe("function");
  });

  it("onClose prop closes the modal", async () => {
    await renderDashboardsPageWithOpenDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Dynamic Views" }));
    expect(screen.getByTestId("dynamic-views-modal-mock")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-dvm"));
    expect(screen.queryByTestId("dynamic-views-modal-mock")).not.toBeInTheDocument();
  });
});
```

Reuse `renderDashboardsPageWithOpenDashboard()` if it exists; otherwise mirror the existing "Map Layers button" test's mount pattern.

Run `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx`. 3 new tests pass; all existing pass.
Run `cd kinetica_bi && npx vitest run` — full suite green.
Run `cd kinetica_bi && npx tsc --noEmit` — clean.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "showDynamicViewsModal" kinetica_bi/src/components/DashboardsPage.tsx` exits 0.
    - `grep -q "Dynamic Views" kinetica_bi/src/components/DashboardsPage.tsx` exits 0 (button label).
    - `grep -q "import DynamicViewsModal" kinetica_bi/src/components/DashboardsPage.tsx` exits 0.
    - `grep -q "dashboardId={dashboard.id}" kinetica_bi/src/components/DashboardsPage.tsx` exits 0 (prop passed).
    - `grep -q "useContext(DashboardContext)" kinetica_bi/src/components/DynamicViewsModal.tsx` returns no matches (DashboardContext NOT used by modal — research correction #3 honored).
    - `grep -q "Dynamic Views" kinetica_bi/src/components/DashboardsPage.spec.tsx` exits 0.
    - `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx` exits 0 with all existing + 3 new tests passing.
    - `cd kinetica_bi && npx vitest run` exits 0 (full frontend suite green).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - Button ordering: "Map Layers" before "Dynamic Views" before "Back" (visually verify the JSX).
  </acceptance_criteria>
  <done>
    4th action-bar button "Dynamic Views" wired between "Map Layers" and "Back". Modal mounted conditionally with dashboardId + associatedTables + onClose props. 3 new DashboardsPage tests green. Phase 34 feature-complete.
  </done>
</task>

</tasks>

<verification>
After all three tasks:
1. `cd kinetica_bi && npx vitest run` exits 0 — full frontend suite green; DynamicViewsModal.spec.tsx has ~41 tests; DashboardsPage.spec.tsx has 3 new tests.
2. `cd kinetica_bi && npx tsc --noEmit` exits 0.
3. Operator sees the "Dynamic Views" button on the dashboard action bar.
4. Clicking it opens the two-pane modal.
5. + New / row select → form renders.
6. Preview → output panel (chips / table / 0-rows / 2 error sources).
7. Save → CRUD + markPending + materialize + setView/setError + toast.
8. **BLOCKER #1 verified**: Row-load + edit-template-without-Preview + Save → updateDynamicView body has NO columns_json (S9 spec test passes).
9. Modal close with dirty form → window.confirm fires; Cancel keeps open, Discard closes.
10. Delete inline confirm → delete fires (with deleteAbortRef signal) + clearView + row removed + toast.
11. Server 400 errors surface VERBATIM (Plan 34-01 throwForStatus fix).
</verification>

<success_criteria>
- DV-V16-08: Action-bar "Dynamic Views" button opens the modal listing existing views with edit (row-select) + delete affordances. **Closed.**
- DV-V16-09: Save button + materialize + toast outcomes wired. **Closed.**
- DV-V16-10: Closed in Plan 34-03 (Preview button + columns_json sourcing). **Preserved here.**
- DV-V16-11: Closed in Plan 34-02 (delete flow). **Preserved here; delete handler migrated to deleteAbortRef.**
- All checker issues addressed:
  - **BLOCKER #1**: columns_json carry uses `previewRanSinceLastSave` flag — initialized in 34-03, consumed in 34-04 Save handler, reset on Save success. S9 spec test asserts the stale-row-load-then-Save case omits columns_json from body.
  - **MAJOR #2**: 4 AbortController scopes locked — mount-time `abortRef` preserved verbatim, 3 new operation-scoped refs added across 34-03 (preview) + 34-04 (save + delete; delete handler migrated).
  - **MAJOR #3**: `UpdateDynamicViewArgs` + `DynamicViewRow` + other Save-handler types explicitly imported.
  - **MAJOR #4**: Validation vs server error sources tagged in `previewState` discriminated union (closed in 34-03; preserved here).
  - **MAJOR #5**: Plan split into 34-03 (form + Preview) + 34-04 (Save + wiring) — done.
  - **MINOR #6**: 34-02 M11 uses `useDynamicViewStore.getState().setView` (real action path) — done.
  - **MINOR #7**: 34-02's M3 + M7 spec tests updated in 34-03 to assert form fields, not placeholder text.
  - **MINOR #8**: 34-03 + 34-04 spec tests reuse 34-02's toast spy from beforeEach.
  - **MINOR #9**: 34-02 Truth #4 reframed to operator-observable.
- Frontend vitest ≥ baseline + new tests; tsc clean.
</success_criteria>

<output>
After completion, create `.planning/phases/34-dynamic-view-ui/34-04-SUMMARY.md` capturing:
- DynamicViewsModal.tsx LOC: Plan 34-03 end → Plan 34-04 end.
- DynamicViewsModal.spec.tsx test count delta (was ~27; now ~41).
- DashboardsPage.tsx lines added (button + state + import + modal mount).
- DashboardsPage.spec.tsx tests added (3).
- Confirmation per-issue:
  - BLOCKER #1 closed by S9 + S10 spec tests asserting `body.columns_json` is absent in the stale-row + Save-Save regression cases.
  - MAJOR #2 verified by `grep -c "new AbortController()" ...` ≥ 4.
  - MAJOR #3 verified by `grep -q "UpdateDynamicViewArgs" ...`.
  - MAJOR #4 closed in Plan 34-03 (preserved here).
  - MAJOR #5 split delivered.
  - MINOR #6/7/8/9 closed in respective plans.
- All 4 Phase 34 requirements (DV-V16-08 through DV-V16-11) closed.
- Frontend vitest count before/after.
- Notes for Phase 35 (ChartConfigPanel widget binding + renderer FROM-swap + cascading re-materialize on filter-view bump).
</output>
</content>
</invoke>