---
phase: 34-dynamic-view-ui
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/components/DynamicViewsModal.tsx
  - kinetica_bi/src/components/DynamicViewsModal.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - DV-V16-08
  - DV-V16-11
must_haves:
  truths:
    - "DynamicViewsModal mounts as a two-pane modal-overlay portal: left = list of dynamic views with status badges + delete-confirm; right = empty-state placeholder ('Select a view or click + New to get started')."
    - "Operator can click + New dynamic view in the left pane (callback fires; modal does not crash even though no form is rendered yet in this plan)."
    - "Operator can click a row in the left list; the right pane reflects the selection (placeholder shows for now; form comes in Plan 34-03)."
    - "Operator clicks the trash icon on a row, then the inline `[Delete view]` button, and observes the row vanish, the success toast `View deleted`, and the corresponding store entry cleared — all driven by deleteDynamicView(id) + useDynamicViewStore.clearView(id)."
    - "Operator clicks Close button, ESC, or backdrop → modal closes via onClose() — dirty-state confirm wrapper exists but no fields are dirty in this plan (the helper exists and is called; isDirty stays false because there's no form yet)."
    - "Per-row status badge reads useDynamicViewStore.views[id]?.status via a per-row scoped selector (PITFALL S-02 / C-02)."
    - "Modal does NOT crash when listDynamicViews returns empty array — shows 'No dynamic views yet.' empty state with visible + New button."
    - "All new CSS lives under the `.dynamic-views-modal-*` namespace; modal reuses `.modal-overlay` and `.modal-content.modal-layers` size class for shell."
  artifacts:
    - path: "kinetica_bi/src/components/DynamicViewsModal.tsx"
      provides: "Two-pane modal component: shell + ESC handler + click-outside + dirty-state confirm wrapper + left list with badges + inline delete-confirm + + New button + right-pane empty state. Exports default DynamicViewsModal."
      min_lines: 200
    - path: "kinetica_bi/src/components/DynamicViewsModal.spec.tsx"
      provides: "Vitest spec covering: mount/unmount, ESC/click-outside/close-X all route through onClose, left-list renders rows with name + status badge, + New button fires onCreate, click row sets selection, inline delete-confirm flow (trash → Delete view → deleteDynamicView call + clearView call + row removed + toast), badge reads from useDynamicViewStore per-row."
      min_lines: 250
    - path: "kinetica_bi/src/styles/global.css"
      provides: "New `.dynamic-views-modal-*` CSS namespace (body, left, right, view-row, view-row-name, view-row-actions, view-row-btn, view-status-badge, empty-state)."
      contains: ".dynamic-views-modal-body"
  key_links:
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx"
      to: "useDynamicViewStore.views[id].status"
      via: "per-row scoped selector"
      pattern: "useDynamicViewStore\\(\\(s\\) => s\\.views"
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (delete confirm)"
      to: "deleteDynamicView + clearView"
      via: "Delete view button onClick handler"
      pattern: "deleteDynamicView\\("
    - from: "kinetica_bi/src/components/DynamicViewsModal.tsx (modal close paths)"
      to: "handleCloseRequest helper"
      via: "ESC + click-outside + Close button all share one helper"
      pattern: "handleCloseRequest"
---

<objective>
Ship `DynamicViewsModal.tsx` — the modal SHELL and LEFT PANE. Mirrors `LayersModal.tsx` structure (two-pane, `.modal-overlay` portal, `.modal-content.modal-layers` size class, ESC handler, click-outside, inline delete-confirm). The right pane shows an empty-state placeholder; the actual form (CodeMirror editor, max_records, Preview, Save) lands in Plan 34-03.

**Scope this plan:**
- Modal shell (overlay, content wrapper, header, body grid)
- ESC handler + click-outside + Close button → all route through `handleCloseRequest()` (which wraps onClose with the dirty-state confirm helper — though no fields are dirty in this plan, the wrapper exists so 34-03 only adds the form, not the close machinery)
- Left list: renders rows from `listDynamicViews(dashboardId)` query result, per-row status badge from `useDynamicViewStore`, inline delete-confirm flow that fires `deleteDynamicView` + `useDynamicViewStore.clearView` + local row removal + success toast
- + New dynamic view button (calls an `onCreate`-style handler — wires to "create blank draft" state which Plan 34-03 uses)
- Right-pane empty state placeholder
- New CSS namespace `.dynamic-views-modal-*`
- Vitest spec covering all shell + left-list behavior with mocked store + mocked client helpers

**Out of scope (Plan 34-03):**
- Form fields (name, table picker, SQL editor, max_records)
- Preview button + output panel
- Save button + materialize sequence
- AbortController refs for preview/save
- Dirty-state tracking on form fields (the `handleCloseRequest` wrapper exists, but `isDirty` is always false this plan)
- DashboardsPage.tsx wiring (4th button + modal mount) — Plan 34-03 owns this

Plan 34-02 ships dormant — the modal exists but is NOT yet mounted from DashboardsPage. Spec drives the component via direct mount.

Purpose: Ship the shell + delete flow as a standalone testable artifact. Cleanly closes DV-V16-08 (modal lists views with edit/delete affordances; "edit" is just row-selection — full edit form arrives in 34-03) and DV-V16-11 (delete fires DELETE + clearView + row removal + toast).

Output: New 250+-line component, new 250+-line spec, ~80 lines of new CSS. All locked CONTEXT.md decisions for shell/list/delete honored verbatim.
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
<!-- Phase 33 store (already shipped — DO NOT modify) - from kinetica_bi/src/store/dynamicViewStore.ts -->
```typescript
export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
export type DynamicViewReason = "no_filter" | "exceeds_max_records";
export type DynamicViewEntry = {
  viewName: string;
  status: DynamicViewStatus;
  expiresAt?: number;
  error?: string;
  reason?: DynamicViewReason;
};
export type DynamicViewState = {
  views: Record<number, DynamicViewEntry>;
  dynamicViewVersion: number;
  setView: (id: number, payload: {...}) => void;
  markPending: (id: number, viewName: string) => void;
  setError: (id: number, error: string) => void;
  clearView: (id: number) => void;
  reset: () => void;
};
export const useDynamicViewStore: <T>(selector: (s: DynamicViewState) => T) => T;
```

<!-- Phase 33 client helpers - from kinetica_bi/src/api/client.ts:747-860 -->
```typescript
export type DynamicViewRow = {
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  columns_json: string | null;
  created_at: string;
  updated_at: string;
};

export const listDynamicViews: (dashboardId: number, signal?: AbortSignal)
  => Promise<{ dynamic_views: DynamicViewRow[] }>;

export const deleteDynamicView: (id: number, signal?: AbortSignal)
  => Promise<{ deleted: true; dropped?: true }>;
```

<!-- Toast helper - from kinetica_bi/src/store/toast.ts:3 -->
```typescript
export type ToastKind = "permission" | "info" | "error";
// Usage: useToastStore.getState().showToast("View deleted", "info");
// NOTE: there is NO "warning" kind. Use "info" for non-error feedback.
```

<!-- Phase 22 LayersModal pattern (mirror structurally) - from kinetica_bi/src/components/LayersModal.tsx -->
- ESC handler at lines 80-86 (window keydown listener, cleanup on unmount)
- Modal shell at lines 176-184 (`.modal-overlay` div with onClick={onClose}, inner `.modal-content.modal-layers` with onClick stopPropagation)
- Inline delete confirm at lines 64 (confirmDeleteId state), 193 (isConfirming derived), 231-281 (render swap with `[Delete layer] [Keep layer]` buttons)
- For Phase 34: swap labels to `[Delete view] [Keep view]`, aria-label to `"Delete view"`

<!-- DynamicViewsModal props contract (locked for this plan; Plan 34-03 will add `onCreate` becomes "open draft form" handler) -->
```typescript
export type DynamicViewsModalProps = {
  dashboardId: number;
  associatedTables: TableDto[];   // unused in this plan but reserved for 34-03 form rendering; pass-through
  onClose: () => void;
};
```

<!-- Status badge contract for left list -->
```typescript
// Badge appearance per status (Claude's discretion within CONTEXT.md envelope):
//   materialized   -> green check icon (faCheck) + green color
//   pending        -> spinner icon (faSpinner with fa-spin CSS) + neutral color
//   over_threshold -> yellow triangle icon (faTriangleExclamation) + yellow color + title="No filter active" or "Exceeds max records" based on entry.reason
//   error          -> red exclamation (faCircleExclamation) + red color + title=entry.error
// If status === undefined (no entry in store), no badge renders.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write failing spec for DynamicViewsModal shell + left list + delete flow</name>
  <files>kinetica_bi/src/components/DynamicViewsModal.spec.tsx</files>
  <read_first>
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (sections: "Modal architecture", "Delete confirmation (inline, LayersModal pattern)", "Dirty state + modal close", "Materialize feedback surfaces" — left-list badge subsection, "Empty states")
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Patterns 1 + 2 + 6 + 7; Pitfalls 4 + 6; Code Example 4 for LayersModal shell verbatim)
    - kinetica_bi/src/components/LayersModal.spec.tsx (lines 1-270 — pattern for two-pane modal specs with mocked client helpers + DOM-driven interactions)
    - kinetica_bi/src/components/LayersModal.tsx (lines 64, 80-86, 176-291 — shell + ESC + delete-confirm structure)
    - kinetica_bi/src/store/dynamicViewStore.ts (full file — store shape Phase 33 shipped; per-row selector pattern)
    - kinetica_bi/src/store/toast.ts (full file ~35 lines — verify ToastKind union; verify dedup window)
    - kinetica_bi/src/api/client.ts (lines 747-860 — DynamicViewRow type, listDynamicViews + deleteDynamicView signatures)
    - kinetica_bi/__mocks__/zustand.ts (the auto-applied store-reset shim — confirm useDynamicViewStore is covered)
    - kinetica_bi/src/test/setup.ts (test config — confirms vi.mock("zustand") is active so the store auto-resets between tests)
  </read_first>
  <behavior>
    Write the spec file BEFORE the component (RED). Tests will fail because the component doesn't exist yet.

    Coverage matrix (each item is one or more `it(...)` blocks):

    **M1: Mount + initial render (no views)**
    - Modal renders inside `.modal-overlay` (`document.querySelector('.modal-overlay')` is truthy after mount).
    - Modal title is `"Dynamic Views"`.
    - Loading state: while `listDynamicViews` promise is pending, left pane shows `"Loading…"` placeholder; right pane shows nothing or placeholder.
    - After resolve with empty `{ dynamic_views: [] }`: left pane shows `"No dynamic views yet."` empty state + a visible `+ New dynamic view` button. Right pane shows `"Select a view or click + New to get started."`.

    **M2: Mount + initial render (with views)**
    - After resolve with `{ dynamic_views: [row1, row2] }`: left pane renders two rows; row text contains each view's `.name` (`row1.name`, `row2.name`).
    - Each row has a `[role=button]` (or clickable div) plus a trash button with `aria-label="Delete view"`.
    - Right pane initially shows the empty-state placeholder (`"Select a view or click + New to get started."`) — selection only happens on user click.

    **M3: Row selection**
    - User clicks the row text for row1 → the row gains class `active` (or `aria-current="true"`); right pane STILL shows placeholder (form is Plan 34-03) but with a different message (e.g., `"Form coming in next plan"` is acceptable as a placeholder; CONTEXT.md doesn't lock the in-between message — pick something obvious). Pragmatic choice: render `<div className="dynamic-views-modal-empty">Select a view or click + New to get started.</div>` until 34-03 provides form. For row-selected state, show the SAME placeholder but with the selected view's `name` as a heading — proves selection state propagated.
    - Clicking a different row swaps active class.
    - **Note for executor:** Plan 34-03 will replace these placeholder texts with form rendering. When 34-03 updates this test, the assertion changes to `screen.getByLabelText('Name')` (or equivalent form-field check). Document this future change inline in the test (e.g., `// 34-03 NOTE: replace placeholder assertion with form-rendered assertion`).

    **M4: ESC handler routes through onClose**
    - User presses ESC → `onClose` prop is called exactly once.
    - (No dirty state in this plan — `isDirty` stays false so handleCloseRequest doesn't show confirm.)

    **M5: Click-outside routes through onClose**
    - User clicks the `.modal-overlay` backdrop → `onClose` called exactly once.
    - User clicks INSIDE `.modal-content` (e.g., header) → `onClose` NOT called (stopPropagation works).

    **M6: Close button routes through onClose**
    - User clicks Close button → `onClose` called exactly once.

    **M7: + New dynamic view button**
    - User clicks `+ New dynamic view` button → some observable state change in the modal (Plan 34-03 will give this a real behavior; for this plan, accept either: (a) modal logs/records the click via setting `selectedId = null` AND a `isDraft` boolean state, OR (b) right pane shows `"New dynamic view (form coming in 34-03)"`). Lock for spec: clicking the button MUST cause the right pane's text to change from `"Select a view or click + New to get started."` to a draft-mode message (planner picks the exact string — recommend `"New dynamic view"` heading visible). Test asserts via `screen.getByText("New dynamic view")` after click.
    - **Note for executor:** Plan 34-03 will replace this placeholder text with a rendered form. When 34-03 updates this test, the assertion changes to a form-field check (e.g., `screen.getByPlaceholderText("Name your dynamic view")`). Document this future change inline.

    **M8: Inline delete-confirm flow — happy path**
    - Pre-condition: list resolved with 2 rows.
    - User clicks the trash button (aria-label "Delete view") on row1 → row1's actions swap to `[Delete view] [Keep view]` buttons. The trash icon disappears.
    - User clicks `[Delete view]` → mock `deleteDynamicView` is called with `row1.id`. After it resolves with `{ deleted: true }`: `useDynamicViewStore.getState().clearView(row1.id)` is called; row1 disappears from the rendered list; `useToastStore.getState().showToast` is called with `"View deleted"` and kind `"info"`.
    - If row1 was selected, right pane reverts to empty state placeholder.

    **M9: Inline delete-confirm flow — Keep view (cancel)**
    - User clicks trash on row1 → confirms swap.
    - User clicks `[Keep view]` → row reverts to normal trash icon; `deleteDynamicView` NOT called.

    **M10: Inline delete-confirm flow — error path**
    - User clicks trash → Delete view → mock `deleteDynamicView` rejects with `new Error("Server down")`.
    - After rejection: row stays visible (not removed); toast called with `"Failed to delete view: Server down"` kind `"error"`; confirm state resets (row goes back to trash icon, not stuck in confirm mode).

    **M11: Status badge per row (per-row store selector)**
    - Pre-seed `useDynamicViewStore` with a materialized entry by calling the real action: `useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "materialized" })`. Do NOT use `useDynamicViewStore.setState({ views: { ... } })` — that bypasses the store action path and is not representative of the real Phase 33 mutation API (which Phase 35 will exercise).
    - Mount modal; left list renders. Row1 shows a badge with status indicator (test by `data-testid="view-status-badge"` and `data-status="materialized"` attr, or by checking the badge's child has class `"materialized"`). Row2 (no store entry) shows NO badge.
    - Mutate via the real action path: `useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "over_threshold", reason: "no_filter" })`. Row1's badge updates to `over_threshold` flavor with `title` attribute containing `"No filter active"`.
    - Verifies the per-row scoped selector (PITFALL S-02) wires correctly AND that the badge subscribes to real store actions (not just raw `setState` snapshots).

    **M12: AbortController cleanup on unmount**
    - Mount the modal; `listDynamicViews` is called with a non-undefined `signal` (the modal's mount-time AbortController).
    - Unmount the modal before the listDynamicViews promise resolves → `signal.aborted === true` after unmount.

    **Mocks:**
    - Mock `../api/client` to expose `vi.fn()` versions of `listDynamicViews`, `deleteDynamicView`. Default `listDynamicViews` returns `Promise.resolve({ dynamic_views: [] })`; specific tests override via `mockResolvedValueOnce`.
    - Mock `../store/toast` — replace `useToastStore.getState().showToast` with `vi.fn()` for assertion.
    - Use the real `useDynamicViewStore` (its mock shim in `__mocks__/zustand.ts` auto-resets between tests).
    - For row data, build fixtures via a helper:
      ```typescript
      const makeRow = (id: number, name: string): DynamicViewRow => ({
        id, dashboard_id: 5, source_table_id: 2, name,
        template_sql: "SELECT * FROM {view}", max_records: 1000,
        columns_json: null, created_at: "2026-05-14T00:00:00Z", updated_at: "2026-05-14T00:00:00Z",
      });
      ```

    Run vitest. ALL ~14+ tests should FAIL (component doesn't exist).
  </behavior>
  <action>
Create `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` from scratch with the test coverage matrix above (M1-M12). Use React Testing Library (`render`, `screen`, `fireEvent`, `waitFor`, `act`) mirroring the style of `LayersModal.spec.tsx`. Top of file:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DynamicViewsModal from "./DynamicViewsModal";
import * as clientModule from "../api/client";
import type { DynamicViewRow, TableDto } from "../api/client";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useToastStore } from "../store/toast";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listDynamicViews: vi.fn(),
    deleteDynamicView: vi.fn(),
  };
});

const mockedClient = clientModule as {
  listDynamicViews: ReturnType<typeof vi.fn>;
  deleteDynamicView: ReturnType<typeof vi.fn>;
};

// Fixture helpers
const makeRow = (id: number, name: string): DynamicViewRow => ({
  id, dashboard_id: 5, source_table_id: 2, name,
  template_sql: "SELECT * FROM {view}", max_records: 1000,
  columns_json: null, created_at: "2026-05-14T00:00:00Z", updated_at: "2026-05-14T00:00:00Z",
});

const sampleTable: TableDto = {
  id: 2, name: "t", schema: "public", columns: { col1: "VARCHAR" },
} as TableDto;
```

Structure the file with `describe("DynamicViewsModal", () => { ... })` and one nested describe per coverage cluster (Mount, Close paths, + New, Delete, Badge, Cleanup). Each test resets mocks in `beforeEach`:

```typescript
beforeEach(() => {
  mockedClient.listDynamicViews.mockReset();
  mockedClient.deleteDynamicView.mockReset();
  // Default empty list
  mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
  // Reset zustand stores (auto-applied via __mocks__/zustand.ts, but verify)
  useDynamicViewStore.setState({ views: {}, dynamicViewVersion: 0 });
  // Spy on toast — set up at outer beforeEach so Plan 34-03 specs reuse it.
  vi.spyOn(useToastStore.getState(), "showToast").mockImplementation(() => {});
});
```

For M11, exercise the real store action (do NOT use setState):
```typescript
it("badge renders per-row from useDynamicViewStore via real setView action", async () => {
  const row1 = makeRow(1, "alpha");
  const row2 = makeRow(2, "beta");
  mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
  // Seed via real action — exercises Phase 33's setView code path.
  useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "materialized" });
  render(<DynamicViewsModal dashboardId={5} associatedTables={[]} onClose={() => {}} />);
  await screen.findByText("alpha");
  // Row1 has badge with data-status="materialized"
  const badges = screen.getAllByTestId("view-status-badge");
  expect(badges.length).toBe(1);
  expect(badges[0].getAttribute("data-status")).toBe("materialized");
  // Now mutate via real action — verifies subscription path.
  act(() => {
    useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "over_threshold", reason: "no_filter" });
  });
  const badges2 = screen.getAllByTestId("view-status-badge");
  expect(badges2[0].getAttribute("data-status")).toBe("over_threshold");
  expect(badges2[0].getAttribute("title")).toContain("No filter active");
});
```

For M12 (AbortController cleanup), assert by capturing the signal arg:
```typescript
let capturedSignal: AbortSignal | undefined;
mockedClient.listDynamicViews.mockImplementation((_, signal) => {
  capturedSignal = signal;
  return new Promise(() => {}); // never resolves
});
const { unmount } = render(<DynamicViewsModal dashboardId={5} associatedTables={[]} onClose={() => {}} />);
expect(capturedSignal).toBeDefined();
expect(capturedSignal!.aborted).toBe(false);
unmount();
expect(capturedSignal!.aborted).toBe(true);
```

Total: ~14-16 it() blocks. Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` — ALL should fail with "Cannot find module './DynamicViewsModal'" (RED phase complete).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx 2>&1 | grep -E "Cannot find module|Tests" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exists with at least 12 `it(...)` blocks covering M1-M12.
    - `grep -c "^  it(" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` returns >= 12 (count of `it(` lines).
    - `grep -q "listDynamicViews" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "deleteDynamicView" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "useDynamicViewStore" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "View deleted" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "Failed to delete view" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "No dynamic views yet" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "Select a view or click" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "aria-label.*Delete view" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0.
    - `grep -q "useDynamicViewStore.getState().setView" kinetica_bi/src/components/DynamicViewsModal.spec.tsx` exits 0 (M11 uses real action, not raw setState).
    - Spec FAILS to run because DynamicViewsModal.tsx doesn't exist yet (`cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits non-zero with module-not-found).
  </acceptance_criteria>
  <done>
    Spec file created with ≥12 tests covering shell, close paths, + New, delete flow (3 sub-paths), status badge (via real setView action), abort cleanup. All tests RED because component doesn't exist yet.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement DynamicViewsModal.tsx shell + left list + delete flow (GREEN)</name>
  <files>kinetica_bi/src/components/DynamicViewsModal.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DynamicViewsModal.spec.tsx (the spec written in Task 1 — implementation must satisfy every assertion)
    - kinetica_bi/src/components/LayersModal.tsx (lines 1-300 — structural template; mirror shell, ESC, click-outside, delete-confirm verbatim with label substitutions)
    - kinetica_bi/src/store/dynamicViewStore.ts (full file — store shape, action signatures)
    - kinetica_bi/src/store/toast.ts (full file — ToastKind = "permission" | "info" | "error"; useToastStore.getState().showToast)
    - kinetica_bi/src/api/client.ts (lines 747-860 — types and helper signatures; specifically DynamicViewRow, TableDto, listDynamicViews, deleteDynamicView)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (sections: "Modal architecture", "Delete confirmation (inline, LayersModal pattern)", "Materialize feedback surfaces" — left-list badge subsection)
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (Patterns 1, 2, 6, 7; Pitfalls 4, 6, 8; verified that `kind: "warning"` does NOT exist — use `"info"` for non-error and `"error"` only for errors)
  </read_first>
  <behavior>
    Implementation drives all spec tests from RED to GREEN. Per-test contracts already defined in Task 1's spec; this task just implements them.
  </behavior>
  <action>
Create `kinetica_bi/src/components/DynamicViewsModal.tsx`. Full component scaffold:

```typescript
/**
 * Phase 34 (DV-V16-08, DV-V16-11): Dashboard-scoped Dynamic Views management modal.
 *
 * Two-pane modal mirroring LayersModal (Phase 12) structurally:
 *   - Left pane: list of existing dynamic views + status badges + inline delete confirm + + New button.
 *   - Right pane: form (Plan 34-03 — this file ships shell + left list + empty-state placeholder only).
 *
 * Locked semantics (CONTEXT.md):
 *   - Shell mirrors LayersModal: .modal-overlay portal, .modal-content.modal-layers size class, ESC,
 *     click-outside, stopPropagation on inner content.
 *   - Dirty-state confirm on close paths — wrapper `handleCloseRequest()` exists (calls window.confirm
 *     iff isDirty), but isDirty is always false in this plan since there's no form. Plan 34-03 wires
 *     dirty tracking on form fields and the confirm is then exercised.
 *   - Inline delete confirm — LayersModal pattern: trash → [Delete view] [Keep view] swap.
 *   - On delete success: deleteDynamicView → clearView → remove row locally → toast 'View deleted'.
 *   - On delete error: toast 'Failed to delete view: <message>'; row stays; confirm resets.
 *   - Status badge per row: useDynamicViewStore(s => s.views[id]?.status) scoped selector (PITFALL S-02).
 *   - + New button: opens draft mode (right pane reflects; form fields come in 34-03).
 *
 * AbortController scope: one mount-time controller for listDynamicViews + delete operations in this
 * plan. Plan 34-03 will KEEP this mount-time `abortRef` for the listing call and ADD operation-scoped
 * `previewAbortRef` / `saveAbortRef` / `deleteAbortRef` (Plan 34-04 moves the delete handler to
 * `deleteAbortRef`). Do NOT pre-emptively rename `abortRef` here — leave it for Plan 34-03/04 to evolve.
 */

import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faCheck,
  faSpinner,
  faTriangleExclamation,
  faCircleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import {
  listDynamicViews,
  deleteDynamicView,
  type DynamicViewRow,
  type TableDto,
} from "../api/client";
import {
  useDynamicViewStore,
  type DynamicViewStatus,
  type DynamicViewReason,
} from "../store/dynamicViewStore";
import { useToastStore } from "../store/toast";

export type DynamicViewsModalProps = {
  dashboardId: number;
  associatedTables: TableDto[]; // Reserved for Plan 34-03 form; pass-through this plan.
  onClose: () => void;
};

export default function DynamicViewsModal({
  dashboardId,
  associatedTables: _associatedTables,
  onClose,
}: DynamicViewsModalProps): JSX.Element {
  // ---- State ----
  const [views, setViews] = useState<DynamicViewRow[] | null>(null); // null = loading; [] = loaded empty
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // isDirty stays false this plan (no form fields yet). Plan 34-03 wires field-change handlers.
  const isDirty = false;

  // ---- AbortController (mount-time, scoped to component lifecycle) ----
  // Plan 34-03 will KEEP this ref for the mount-time listing call (unchanged).
  // Plan 34-03 will ADD: previewAbortRef, saveAbortRef.
  // Plan 34-04 will ADD: deleteAbortRef AND MIGRATE handleDelete to use it (instead of this mount-time ref).
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setViews(null);
    setLoadError(null);
    listDynamicViews(dashboardId, signal)
      .then(({ dynamic_views }) => {
        if (signal.aborted) return;
        setViews(dynamic_views);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return; // silent
        if (signal.aborted) return;
        setLoadError((err as Error)?.message ?? "Failed to load dynamic views");
      });
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [dashboardId]);

  // ---- Close paths (ESC + click-outside + Close button — all route through handleCloseRequest) ----
  const handleCloseRequest = () => {
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  // ---- Delete flow ----
  // Plan 34-04 will replace `undefined` with `deleteAbortRef.current?.signal` and add controller-creation lines.
  const handleDelete = async (id: number) => {
    try {
      await deleteDynamicView(id);
      useDynamicViewStore.getState().clearView(id);
      setViews((prev) => (prev ?? []).filter((v) => v.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setIsDraft(false);
      }
      useToastStore.getState().showToast("View deleted", "info");
    } catch (err) {
      const msg = (err as Error)?.message ?? "unknown";
      useToastStore.getState().showToast(`Failed to delete view: ${msg}`, "error");
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setIsDraft(false);
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsDraft(true);
  };

  // ---- Render ----
  return (
    <div className="modal-overlay" onClick={handleCloseRequest}>
      <div
        className="modal-content modal-layers"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Dynamic Views</div>
          <button className="ghost-sm" onClick={handleCloseRequest}>Close</button>
        </div>
        <div className="dynamic-views-modal-body">
          <div className="dynamic-views-modal-left">
            {views === null && !loadError ? (
              <div className="dynamic-views-modal-empty">Loading…</div>
            ) : loadError ? (
              <div className="dynamic-views-modal-empty error">{loadError}</div>
            ) : views.length === 0 ? (
              <div className="dynamic-views-modal-empty">No dynamic views yet.</div>
            ) : (
              <div className="dynamic-views-modal-list">
                {views.map((v) => (
                  <ViewListRow
                    key={v.id}
                    row={v}
                    isActive={v.id === selectedId}
                    isConfirming={confirmDeleteId === v.id}
                    onSelect={handleSelect}
                    onDeleteClick={() => setConfirmDeleteId(v.id)}
                    onConfirmDelete={() => handleDelete(v.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}
              </div>
            )}
            <div className="dynamic-views-modal-add">
              <button className="btn-primary" type="button" onClick={handleNew}>
                + New dynamic view
              </button>
            </div>
          </div>
          <div className="dynamic-views-modal-right">
            {isDraft ? (
              <div className="dynamic-views-modal-empty">
                <h3>New dynamic view</h3>
                <p>Form coming in next plan (34-03).</p>
              </div>
            ) : selectedId !== null && views?.find((v) => v.id === selectedId) ? (
              <div className="dynamic-views-modal-empty">
                <h3>{views.find((v) => v.id === selectedId)!.name}</h3>
                <p>Form coming in next plan (34-03).</p>
              </div>
            ) : (
              <div className="dynamic-views-modal-empty">
                Select a view or click + New to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-component: per-row scoped store consumer (PITFALL S-02 / C-02) ----

type ViewListRowProps = {
  row: DynamicViewRow;
  isActive: boolean;
  isConfirming: boolean;
  onSelect: (id: number) => void;
  onDeleteClick: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

function ViewListRow({
  row, isActive, isConfirming, onSelect, onDeleteClick, onConfirmDelete, onCancelDelete,
}: ViewListRowProps): JSX.Element {
  // Per-row scoped primitive selector — Phase 33 PITFALL S-02 / C-02 carry-forward.
  const status = useDynamicViewStore((s) => s.views[row.id]?.status);
  const reason = useDynamicViewStore((s) => s.views[row.id]?.reason);
  const error = useDynamicViewStore((s) => s.views[row.id]?.error);

  return (
    <div
      className={`view-row${isActive ? " active" : ""}`}
      onClick={() => onSelect(row.id)}
      role="button"
      tabIndex={0}
    >
      <span className="view-row-name">{row.name}</span>
      <ViewStatusBadge status={status} reason={reason} error={error} />
      <div className="view-row-actions">
        {isConfirming ? (
          <>
            <button
              type="button"
              className="view-row-btn danger"
              onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
            >
              Delete view
            </button>
            <button
              type="button"
              className="view-row-btn"
              onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
            >
              Keep view
            </button>
          </>
        ) : (
          <button
            type="button"
            className="view-row-btn danger"
            aria-label="Delete view"
            onClick={(e) => { e.stopPropagation(); onDeleteClick(); }}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Sub-component: status badge ----

type ViewStatusBadgeProps = {
  status: DynamicViewStatus | undefined;
  reason: DynamicViewReason | undefined;
  error: string | undefined;
};

function ViewStatusBadge({ status, reason, error }: ViewStatusBadgeProps): JSX.Element | null {
  if (!status) return null;
  if (status === "materialized") {
    return (
      <span className="view-status-badge materialized" data-testid="view-status-badge" data-status="materialized" title="Materialized">
        <FontAwesomeIcon icon={faCheck} />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="view-status-badge pending" data-testid="view-status-badge" data-status="pending" title="Materializing…">
        <FontAwesomeIcon icon={faSpinner} spin />
      </span>
    );
  }
  if (status === "over_threshold") {
    const title = reason === "no_filter" ? "No filter active" : "Exceeds max records";
    return (
      <span className="view-status-badge over_threshold" data-testid="view-status-badge" data-status="over_threshold" title={title}>
        <FontAwesomeIcon icon={faTriangleExclamation} />
      </span>
    );
  }
  // status === "error"
  return (
    <span className="view-status-badge error" data-testid="view-status-badge" data-status="error" title={error ?? "Error"}>
      <FontAwesomeIcon icon={faCircleExclamation} />
    </span>
  );
}
```

Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx`. All 12+ tests should PASS (GREEN).

If specific tests fail, iterate. Likely tweaks:
- `findByRole("button", { name: /Delete view/i })` — the trash button has `aria-label="Delete view"` (matched by `name:`), and the inline `[Delete view]` confirm button has text `Delete view`. Disambiguate in spec by using `aria-label` for the trash query and text-only for the confirm query.
- For in-test mutations of `useDynamicViewStore` always go through real actions (e.g., `useDynamicViewStore.getState().setView(id, payload)`) — never raw `setState` snapshots — to exercise Phase 33's mutation path.
- `useToastStore.getState().showToast` — if spec mocks it via `vi.spyOn(useToastStore.getState(), "showToast")`, the implementation must call exactly `useToastStore.getState().showToast(...)` (not destructure first).

DO NOT add form fields, CodeMirror, max_records, Preview, Save in this plan. Right-pane content is intentionally a placeholder.

Verify tsc: `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits 0 with all 12+ tests passing.
    - `kinetica_bi/src/components/DynamicViewsModal.tsx` exists.
    - `wc -l kinetica_bi/src/components/DynamicViewsModal.tsx` shows ≥ 200 lines (it will likely be 220-260 lines).
    - `grep -q 'useDynamicViewStore..s. => s.views' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0 (per-row scoped selector present).
    - `grep -q 'deleteDynamicView(' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'clearView(' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'showToast(.View deleted.' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'Failed to delete view' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'handleCloseRequest' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'AbortController' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q 'aria-label="Delete view"' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `grep -q '+ New dynamic view' kinetica_bi/src/components/DynamicViewsModal.tsx` exits 0.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - `grep -q 'CodeMirror\|sql(' kinetica_bi/src/components/DynamicViewsModal.tsx` returns non-zero (CodeMirror/SQL editor INTENTIONALLY NOT in this plan — Plan 34-03 adds it).
  </acceptance_criteria>
  <done>
    DynamicViewsModal.tsx exists with shell + ESC handler + click-outside + Close button + handleCloseRequest wrapper + dynamicViewsModal-* CSS hooks + per-row scoped status badge + inline delete-confirm + + New button + right-pane empty-state placeholder. All Task 1 spec tests PASS. tsc clean. CodeMirror NOT yet wired (Plan 34-03's job).
  </done>
</task>

<task type="auto">
  <name>Task 3: Add .dynamic-views-modal-* CSS namespace to global.css</name>
  <files>kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/styles/global.css (search for `.layers-modal-` and `.modal-layers` blocks to mirror layout patterns; also find `.layer-row` / `.layer-row-name` / `.layer-row-actions` / `.layer-row-btn` to copy spacing/colors)
    - kinetica_bi/src/components/DynamicViewsModal.tsx (the component built in Task 2 — confirm exact class names used: `dynamic-views-modal-body`, `dynamic-views-modal-left`, `dynamic-views-modal-right`, `dynamic-views-modal-empty`, `dynamic-views-modal-list`, `dynamic-views-modal-add`, `view-row`, `view-row-name`, `view-row-actions`, `view-row-btn`, `view-status-badge`)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (section "Claude's Discretion" — exact CSS class names; "Materialize feedback surfaces" — badge color guidance)
  </read_first>
  <action>
Append (at the bottom of `kinetica_bi/src/styles/global.css`) a new section commented as `/* === Phase 34 (DV-V16-08, DV-V16-11): Dynamic Views Modal === */`.

Define the following classes. Match the visual weight + spacing of `.layers-modal-*` blocks already in the file (find them and mirror). Use existing color variables from the file (search for color tokens like `--color-...`).

```css
/* === Phase 34 (DV-V16-08, DV-V16-11): Dynamic Views Modal === */

.dynamic-views-modal-body {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  height: 65vh;
  overflow: hidden;
}

.dynamic-views-modal-left {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border, #2a3142);
  overflow-y: auto;
  padding-right: 8px;
}

.dynamic-views-modal-right {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding-left: 8px;
}

.dynamic-views-modal-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.dynamic-views-modal-add {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border, #2a3142);
}

.dynamic-views-modal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  color: var(--color-text-muted, #8a93a8);
  font-size: 14px;
  text-align: center;
  flex: 1;
  gap: 8px;
}
.dynamic-views-modal-empty.error {
  color: var(--color-danger, #d8444b);
}

.view-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
}
.view-row:hover {
  background: var(--color-row-hover, rgba(255,255,255,0.04));
}
.view-row.active {
  background: var(--color-row-active, rgba(82,168,236,0.15));
  outline: 1px solid var(--color-accent, #52a8ec);
}

.view-row-name {
  font-size: 14px;
  color: var(--color-text, #d6dbe5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-row-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.view-row-btn {
  background: transparent;
  border: 1px solid var(--color-border, #2a3142);
  color: var(--color-text, #d6dbe5);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.view-row-btn:hover { background: var(--color-row-hover, rgba(255,255,255,0.06)); }
.view-row-btn.danger { color: var(--color-danger, #d8444b); border-color: var(--color-danger, #d8444b); }
.view-row-btn.danger:hover { background: rgba(216,68,75,0.12); }

.view-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 12px;
}
.view-status-badge.materialized { color: var(--color-success, #4ec07a); }
.view-status-badge.pending { color: var(--color-text-muted, #8a93a8); }
.view-status-badge.over_threshold { color: var(--color-warning, #e2a72b); }
.view-status-badge.error { color: var(--color-danger, #d8444b); }
```

If the project's CSS uses different color variable conventions (e.g., literal hex values throughout, or different variable names), inspect the existing `.layers-modal-*` block first and copy its variable conventions. The fallback hex values above are sane defaults if no variables exist — but mirror what's in the file.

Run `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` — should remain green (specs don't assert on CSS).

DO NOT remove or modify any existing CSS rules. APPEND-ONLY.
  </action>
  <verify>
    <automated>grep -c "dynamic-views-modal-\|view-row-\|view-status-badge" kinetica_bi/src/styles/global.css</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q ".dynamic-views-modal-body" kinetica_bi/src/styles/global.css` exits 0.
    - `grep -q ".dynamic-views-modal-left" kinetica_bi/src/styles/global.css` exits 0.
    - `grep -q ".dynamic-views-modal-right" kinetica_bi/src/styles/global.css` exits 0.
    - `grep -q ".view-row " kinetica_bi/src/styles/global.css` exits 0 (the base `.view-row` class).
    - `grep -q ".view-status-badge" kinetica_bi/src/styles/global.css` exits 0.
    - `grep -q "Phase 34" kinetica_bi/src/styles/global.css` exits 0 (the section comment is present).
    - No existing CSS rules removed (verifiable by `cd kinetica_bi && git diff src/styles/global.css | grep '^-[^-]' | wc -l` showing 0 deletions; only `+` lines added).
    - `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` still exits 0.
  </acceptance_criteria>
  <done>
    `.dynamic-views-modal-*` and `.view-row*` and `.view-status-badge*` classes appended to global.css under a Phase 34 section comment. Existing rules untouched. Spec still green.
  </done>
</task>

</tasks>

<verification>
After all three tasks:
1. `cd kinetica_bi && npx vitest run src/components/DynamicViewsModal.spec.tsx` exits 0 (≥12 tests green).
2. `cd kinetica_bi && npx vitest run` exits 0 (full suite green — no regressions to other specs because DynamicViewsModal is not yet mounted from DashboardsPage).
3. `cd kinetica_bi && npx tsc --noEmit` exits 0.
4. Modal renders correctly in isolated test environment (jsdom): mount, list rows, status badges, inline delete-confirm, close paths.
5. Plan 34-03 can now import this component and add the form + button on DashboardsPage.
</verification>

<success_criteria>
- DV-V16-08 partially closed: Dashboard-scoped modal lists existing dynamic views with edit/delete affordances. ("Edit" surface = row selection; full edit form lands in 34-03 — flagged in plan summary).
- DV-V16-11 fully closed: Delete fires DELETE /api/dynamic-view/:id (via deleteDynamicView), removes the row, clears the store entry (clearView), toasts success.
- Modal can mount/unmount cleanly with no console errors; AbortController cleanup on unmount verified by spec.
- All locked CONTEXT.md decisions for shell + left list + delete honored verbatim.
- `kind: "warning"` toast NOT used anywhere (research correction #2 honored).
- `DashboardContext` NOT used for dashboardId (research correction #3 honored — uses prop).
</success_criteria>

<output>
After completion, create `.planning/phases/34-dynamic-view-ui/34-02-SUMMARY.md` capturing:
- New files: DynamicViewsModal.tsx (line count), DynamicViewsModal.spec.tsx (test count + line count).
- Modified files: global.css (lines added).
- Confirmation that DV-V16-11 is fully closed and DV-V16-08 is partially closed (form pending 34-03).
- Note: modal NOT yet mounted from DashboardsPage — Plan 34-03 owns the action-bar button + modal mount.
- Total test count delta (frontend vitest before vs after).
</output>
</content>
</invoke>