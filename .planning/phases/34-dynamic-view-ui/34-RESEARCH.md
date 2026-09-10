# Phase 34: dynamic-view-ui - Research

**Researched:** 2026-05-14
**Domain:** React modal UI consuming Phase 33 store + client helpers; CodeMirror 6 SQL editor; LayersModal-pattern two-pane layout
**Confidence:** HIGH

## Summary

Phase 34 ships `DynamicViewsModal.tsx` — a 4th dashboard-action-bar modal that mirrors Phase 12 `LayersModal` structure (two-pane, `.modal-overlay` portal, ESC/click-outside, inline delete confirm) with two intentional divergences locked in CONTEXT.md: (1) **explicit Save** instead of auto-save, (2) **dirty-state confirm** on close. The right pane embeds an `@codemirror/lang-sql`-powered editor (new dependency, ^6.10.0 — sibling-major of existing `@codemirror/lang-html@^6.4.11`) with an "Insert {view}" button using the verified CodeMirror 6 cursor-insertion API (`view.dispatch({ changes: { from: view.state.selection.main.head, insert: "{view}" } })`).

All Phase 33 contracts (`useDynamicViewStore`, 7 client helpers, `buildDynamicViewName`, `MaterializeDynamicViewResponse` discriminated union, `DynamicViewRow` type) are already shipped and dormant — Phase 34 is the first consumer. The modal mounts at `DashboardsPage.tsx:947` area as a 4th conditional render alongside `{showLayersModal && ...}`; dashboardId is passed as a **prop** (not via `DashboardContext` — that provider wraps only the widget grid, NOT the modals region).

**Primary recommendation:** Mirror `LayersModal.tsx` structure verbatim for the modal shell + left-list + delete confirm + missing-table predicate; mirror `MapConfigPanel`'s `clampRadius` pattern for `max_records` clamp-on-blur; use the verified CM6 cursor-insert API for the "Insert {view}" button (vs. the existing Phase 22 "insert-at-end" deferral, which Phase 34 CONTEXT incorrectly assumes is "cursor-position"). Flag one known bug: `throwForStatus` discards server error messages for 400 responses — modal needs a workaround to surface `{view}`-token-missing errors verbatim.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Modal architecture (two-pane, mirrors LayersModal verbatim):**
- Left pane: list of existing dynamic views; per-row name + materialize-status badge + trash; "+ New dynamic view" button; click row → form loads in right pane.
- Right pane: form (name, table picker, SQL editor, max-records, Preview button, Preview output panel, Save button); empty state when no item selected: "Select a view or click + New."
- Modal width: reuse `.modal-layers` 900px max-width if no style divergence; else `.modal-dynamic-views` same width.
- Modal shell: `.modal-overlay` portal, click-outside → dirty-state confirm; ESC → dirty-state confirm.
- Inline form component: NO shared sub-component (single consumer) — keep JSX inline in `DynamicViewsModal.tsx` (planner discretion to extract if >500 LOC).

**Save flow (explicit Save button — diverges from LayersModal auto-save):**
- Local React state: `{ name, source_table_id, template_sql, max_records, columns_json, isDirty }`.
- Validate locally first (non-empty name, table chosen, template non-empty, max_records ≥ 1).
- On Save: `createDynamicView` (or `updateDynamicView`) → `markPending(id, viewName)` → `materializeDynamicView(id)` → `setView`/`setError` → toast outcome.
- AbortController wraps materialize call; aborted on modal close.
- On 400: surface server error inline below editor in red; re-enable Save.
- Save is NOT gated on materialize success — persistence is source of truth.
- Form reset on save: modal stays open; re-load canonical row from server response; dirty flag clears.
- columns_json: send from Preview response if template_sql changed; omit otherwise (server preserves or auto-clears per CONTEXT 32 § D3).

**Dirty state + modal close:**
- `isDirty` flips true on any field change after load; cleared on Save success or explicit Discard.
- Close-X / ESC / outside-click all route through dirty confirm.
- Confirm: title `Discard unsaved changes?`, body `Your edits to "{name}" will be lost.` (or `Your new view will not be saved.` for new), buttons `[Discard]` (primary destructive) + `[Cancel]`.
- `window.confirm()` is acceptable (matches existing app pattern at DashboardsPage.tsx:102 + DatasetsPage.tsx:33).
- Switch-views path (click different view while dirty): same confirm.

**Delete confirmation (inline, LayersModal pattern):**
- Trash icon per row → row swaps to `[Delete view]` (red) + `[Keep view]` (ghost).
- Delete view → `deleteDynamicView(id)` → `useDynamicViewStore.getState().clearView(id)` → remove row from local list → toast `"View deleted"`.
- If deleted view was selected → clear right-pane selection.
- On error: revert inline state; toast error.

**Preview UX:**
- Bottom panel in right pane, below form fields, above Save button.
- Order: `[name][table][editor][max_records][Insert {view}][Preview] → [Preview output] → [Save]`.
- Default min-height 150px / max-height 300px with internal scroll.
- Button-only trigger (never auto-fires).
- Validation: template_sql non-empty + source_table_id chosen + dashboard_id available.
- Call `previewDynamicView({ template_sql, source_table_id, dashboard_id, sample_limit: 100 }, abortSignal)`.
- Output states: initial / loading / success-with-rows / success-with-0-rows / error.
- Column chip list at top (alphabetical, `{name} {TYPE}`); HTML table below; row count footer.
- No cache — each click re-fetches.
- Preview does NOT auto-update columns_json on persisted row — Save persists.

**Materialize feedback surfaces:**
- Toast on Save outcome (last toast wins): materialized → info, no_filter → info, exceeds_max_records → warning, error → error.
- Left-list badge per view from `useDynamicViewStore.views[id].status`: materialized (green dot/check), pending (spinner/pulse), over_threshold (yellow triangle + reason tooltip), error (red exclamation + error tooltip).
- No badge if no entry exists in store.

**AbortController scope:** 3 separate refs — `previewAbortRef`, `saveAbortRef`, `deleteAbortRef`. Aborted on next click of same operation + on modal close.

**CodeMirror SQL editor:**
- Dependency: `@codemirror/lang-sql` (sibling-major of existing `@codemirror/lang-html: ^6.4.11`).
- Component: `<CodeMirror>` from `@uiw/react-codemirror` (already installed).
- Extensions: `[sql()]` (generic dialect — sufficient for Kinetica SQL).
- Theme: default light (no theme prop).
- Height: `minHeight="200px"`, `maxHeight="400px"`.
- Line numbers: ON (`basicSetup` default).
- Editable: TRUE.
- Placeholder: `"-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor"`.

**"Insert {view}" button:**
- Position: above editor, right-aligned with editor section label.
- Click: insert literal `{view}` at cursor position via CM6 `view.dispatch({ changes: { from: cursor, insert: '{view}' } })`.
- Disabled when editor is empty AND placeholder showing (verify CM6 placeholder semantics in research — DONE; see Findings below).

**Inline hint text below editor:** `Use {view} where you'd reference the source filter view.`

**`{view}` validation timing: SERVER-ONLY.**
- Frontend does NOT validate. Server's `substituteViewToken` (`kinetica_bi/server/src/lib/dynamicViewSql.ts:27-40`) is single source of truth (regex: `/\{\s*view\s*\}/gi`).
- 400 with message `"Dynamic view template must contain a {view} token."` — surfaced verbatim (Preview panel for Preview, below editor for Save).

**Field validation + defaults:**
- name: required, non-empty after trim.
- source_table_id: required, first associated table default for new; missing-tables state disables form with banner.
- template_sql: required, non-empty after trim; `{view}` validation server-only.
- max_records: default 10000 (Claude's discretion); min 1; no upper bound client-side; integer; clamp-on-blur.
- columns_json: not user-editable; Preview populates; Save persists.

**Action-bar button placement:** Insert as 4th button between "Map Layers" and "Back" at `DashboardsPage.tsx:705-707` area.

**Empty states:** no-views, no-tables (Save blocked), preview-not-run, preview-0-rows.

**Test coverage scope:** `DynamicViewsModal.spec.tsx` + extended `DashboardsPage.spec.tsx`. Full enumerated cases in CONTEXT.md.

### Claude's Discretion

- Exact CSS class names (`.dynamic-views-modal-*` recommended; reuse `.modal-layers` size).
- Whether to extract form into sub-component if >500 LOC.
- Default `max_records` (recommend 10000).
- Toast styling — use existing `useToastStore` (verified — see Findings below).
- Spec organization (follow LayersModal.spec.tsx style).
- Whether Preview column chips show types in `(parens)`, `TYPE` suffix, or hover tooltip.
- Whether "Insert {view}" disabled while editor empty.
- Tab order through form fields.

### Deferred Ideas (OUT OF SCOPE)

- Widget binding (ChartConfigPanel Data Source picker → dynamicViewId) → Phase 35 (DV-V16-12).
- Renderer FROM/LAYERS-swap against resolved dynamic view → Phase 35 (DV-V16-13).
- Over-threshold widget empty state → Phase 35 (DV-V16-14).
- Cascading re-materialize on filter-view bump → Phase 35.
- Name uniqueness check within dashboard.
- SQL syntax error live-underline (Monaco-style).
- Auto-complete on `{` keystroke.
- Pre-populated template gallery.
- Copy view to another dashboard.
- URL/localStorage persistence of edit state.
- Live preview pane during typing.
- Resizable preview output panel.
- Drag-reorder of views in left list.
- Tab order explicit tabIndex.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **DV-V16-08** | Dashboard action-bar button "Dynamic Views" opens a modal listing all dynamic views for the dashboard with edit/delete affordances. | `DashboardsPage.tsx:705-707` template located; 4th button insertion pattern verified. Left-list mirrors `LayersModal.tsx:186-291` (layer-list render with delete-confirm inline state machine). |
| **DV-V16-09** | Create/Edit dialog: name, source-table picker (associated tables only), CodeMirror SQL editor with `{view}` hint, max-records numeric input, Preview, Save. | CodeMirror integration template at `KineticaWmsLayerForm.tsx:46-47,1113-1122`; numeric clamp-on-blur at `MapConfigPanel.tsx:149-181`; associated-tables picker pattern at `LayersModal.tsx:297-318`; `@codemirror/lang-sql` import + signature verified via official docs (HIGH confidence). |
| **DV-V16-10** | Preview button calls `POST /api/dynamic-view/preview`; renders sample rows + column metadata; Save persists `columns_json`. | `previewDynamicView` client helper already shipped at `client.ts:870-884`; returns `{ rows: unknown[][]; columns: { name: string; type: string }[] }`; columns_json carry-rules locked in CONTEXT.md (server auto-clears on template_sql change per Phase 32 §D3 unless co-supplied). |
| **DV-V16-11** | Delete fires `DELETE /api/dynamic-view/:id`, removes the row, drops the materialized view, clears store entry. | `deleteDynamicView` client helper shipped at `client.ts:848-860`; clears Kinetica view + SQLite row server-side (Phase 32). Modal calls `useDynamicViewStore.getState().clearView(id)` after success. |
</phase_requirements>

## Standard Stack

### Core (already installed — verified in `kinetica_bi/package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@uiw/react-codemirror` | ^4.25.9 (installed) | React wrapper for CodeMirror 6 | Used in Phase 22 `KineticaWmsLayerForm.tsx:46` for HTML template editor. Established pattern. |
| `@codemirror/lang-html` | ^6.4.11 (installed) | Reference sibling — confirms CM6 v6 major is current | N/A — sibling reference. |
| `zustand` | ^4.5.2 (installed) | Used for all stores including `useDynamicViewStore`, `useAuthStore`, `useToastStore` | Project standard. |
| `react` / `react-dom` | ^18.3.1 (installed) | Component framework | Project standard. |
| `@fortawesome/react-fontawesome` + `@fortawesome/free-solid-svg-icons` | ^3.3.1 / ^7.2.0 (installed) | Icons (faTrash, faGripVertical, faCopy used in LayersModal) | Project standard; mirror trash icon usage. |

### New Dependency to Add
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@codemirror/lang-sql` | **^6.10.0** (verified via `npm view @codemirror/lang-sql version` 2026-05-14) | SQL syntax highlighting + tokenization for CodeMirror 6 | Official @codemirror sibling package; same v6 major as installed `@codemirror/lang-html: ^6.4.11`. Latest 6.10.0 published 2025-09-16. |

**Installation:**
```bash
cd kinetica_bi && npm install @codemirror/lang-sql@^6.10.0
```

**Verified via `npm view @codemirror/lang-sql time --json` on 2026-05-14:**
- 6.10.0 → 2025-09-16 (latest stable, current)
- 6.9.1 → 2025-07-28
- 6.9.0 → 2025-05-30

### Supporting (already in tree)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `useToastStore` | `src/store/toast.ts` | Toast helper (existing) | Save outcome + Delete outcome (verified — see Findings) |
| `useAuthStore` | `src/store/auth.ts` | Current user shape (existing) | Get `username` for `buildDynamicViewName` (verified — see Findings) |
| `buildDynamicViewName` | `src/lib/dynamicViewName.ts` | Pure helper (Phase 33) | Compute viewName before `markPending` |
| `useDynamicViewStore` | `src/store/dynamicViewStore.ts` | Per-view state (Phase 33) | Read `views[id].status` for badge; write via `markPending` / `setView` / `setError` / `clearView` |
| 7 client helpers | `src/api/client.ts:778-923` | All Phase 33 helpers shipped | `listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@codemirror/lang-sql` generic dialect | `sql({ dialect: PostgreSQL })` or similar Kinetica-flavor | Kinetica SQL is mostly ANSI-standard; generic dialect's tokenization is sufficient. Loading a dialect adds bundle weight for no observable benefit. CONTEXT.md locks generic. |
| Custom dirty-state confirm modal | `window.confirm()` | Existing app pattern uses `window.confirm()` at `DashboardsPage.tsx:102` and `DatasetsPage.tsx:33`. No custom dialog component exists. CONTEXT.md explicitly allows `window.confirm()`. |
| Cursor-position insert (verified API) | "Insert-at-end" (Phase 22's deferred approach at `KineticaWmsLayerForm.tsx:494-502`) | CONTEXT.md mandates cursor-position; planner should NOT mirror Phase 22's deferred insert-at-end fallback (which is documented as "Claude's Discretion" carry-over at `KineticaWmsLayerForm.tsx:497`). |

## Architecture Patterns

### Recommended Project Structure
```
kinetica_bi/src/components/
├── DynamicViewsModal.tsx          # NEW — two-pane modal (left-list + right-form + preview)
├── DynamicViewsModal.spec.tsx     # NEW — vitest spec
├── DashboardsPage.tsx             # EXTEND — 4th button + modal mount conditional
├── DashboardsPage.spec.tsx        # EXTEND — button render + modal-open assertion
└── LayersModal.tsx                # REFERENCE — structural template (mirror)

kinetica_bi/src/styles/
└── global.css                     # EXTEND — .dynamic-views-modal-* CSS, or reuse .modal-layers

kinetica_bi/package.json           # EXTEND — add @codemirror/lang-sql
```

### Pattern 1: Two-pane modal with `.modal-overlay` portal + click-outside-to-close + ESC handler

**What:** LayersModal's complete structural template — outer overlay `<div>` with `onClick={onClose}` for outside-click; inner `.modal-content.modal-layers` with `onClick={(e) => e.stopPropagation()}` to prevent backdrop click from firing.

**When to use:** All four action-bar modals in the codebase use this pattern.

**Example (verbatim from `LayersModal.tsx:176-184`):**
```typescript
// Source: kinetica_bi/src/components/LayersModal.tsx:176-184
return (
  <div className="modal-overlay" onClick={onClose}>
    <div
      className="modal-content modal-layers"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <div className="modal-title">Layers</div>
        <button className="ghost-sm" onClick={onClose}>Close</button>
      </div>
      ...
```

**ESC handler (verbatim from `LayersModal.tsx:80-86`):**
```typescript
// Source: kinetica_bi/src/components/LayersModal.tsx:80-86
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [onClose]);
```

**Phase 34 divergence:** wrap `onClose` in a `handleCloseRequest()` that checks `isDirty` and runs `window.confirm("Discard unsaved changes?")` before calling actual onClose. Apply to all 3 paths (overlay click, ESC, Close button).

### Pattern 2: Inline delete confirm state machine (LayersModal pattern)

**What:** Per-row `confirmDeleteId: number | null` useState; trash icon swaps to `[Delete view]` + `[Keep view]` inline buttons when the row's id matches.

**When to use:** Destructive operations within list rows where a full modal would be excessive but raw single-click delete is unsafe.

**Example (verbatim from `LayersModal.tsx:64,193,231-281`):**
```typescript
// Source: kinetica_bi/src/components/LayersModal.tsx:64
const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

// Source: lines 193-194
const isConfirming = confirmDeleteId === l.id;

// Source: lines 231-281 (render):
<div className="layer-row-actions">
  {isConfirming ? (
    <>
      <button
        type="button"
        className="layer-row-btn danger"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(l.id);
          setConfirmDeleteId(null);
        }}
      >
        Delete layer
      </button>
      <button
        type="button"
        className="layer-row-btn"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmDeleteId(null);
        }}
      >
        Keep layer
      </button>
    </>
  ) : (
    <button
      type="button"
      className="layer-row-btn danger"
      aria-label="Delete layer"
      onClick={(e) => {
        e.stopPropagation();
        setConfirmDeleteId(l.id);
      }}
    >
      <FontAwesomeIcon icon={faTrash} />
    </button>
  )}
</div>
```

**Phase 34 mirror:** swap labels `Delete layer` → `Delete view`, `Keep layer` → `Keep view`, `aria-label="Delete layer"` → `aria-label="Delete view"`.

### Pattern 3: CodeMirror 6 cursor-position text insertion (VERIFIED CM6 API)

**What:** Capture `EditorView` instance via `onCreateEditor` callback into a `useRef`; insert at cursor via `view.dispatch({ changes: { from, insert } })`.

**Verified API (Context7 + official codemirror.net docs, 2026-05-14):**
- `onCreateEditor?(view: EditorView, state: EditorState): void` — fires once on mount.
- Cursor position: `view.state.selection.main.head: number`.
- Insert: `view.dispatch({ changes: { from: cursorPos, insert: "text" } })`.
- `TransactionSpec.changes: ChangeSpec` where simple insertion is `{from: number, insert: string | Text}` (omit `to` for pure insert).

**Example (Phase 34 implementation pattern):**
```typescript
// Source: synthesized from codemirror.net/docs/ref/ + @uiw/react-codemirror docs (verified 2026-05-14)
import { useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";

function DynamicViewsModal() {
  const editorViewRef = useRef<EditorView | null>(null);

  const handleInsertViewToken = () => {
    const view = editorViewRef.current;
    if (!view) return;
    const cursorPos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: cursorPos, insert: "{view}" },
    });
    view.focus(); // return focus to editor after button click
  };

  return (
    <>
      <button type="button" onClick={handleInsertViewToken}>
        Insert {"{view}"}
      </button>
      <CodeMirror
        value={templateSql}
        onChange={(value) => { setTemplateSql(value); setIsDirty(true); }}
        extensions={[sql()]}
        minHeight="200px"
        maxHeight="400px"
        placeholder={`-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor`}
        onCreateEditor={(view) => { editorViewRef.current = view; }}
      />
    </>
  );
}
```

**NOTE for planner:** Phase 22's existing "Insert column" picker at `KineticaWmsLayerForm.tsx:494-502` uses **insert-at-end** (NOT cursor-position) — comment at line 497 reads `// Insert-at-end (deferred: cursor-position injection per 22-CONTEXT.md "Claude's Discretion").` Phase 34 CONTEXT.md INCORRECTLY assumes Phase 22 already implemented cursor-position. **Phase 34 is the first cursor-position implementation in this codebase.**

### Pattern 4: Clamp-on-blur numeric input with inline error

**What:** Local `draft: string` state for free typing; `clampFn(raw): { value, clamped }` validator; `onBlur` handler that clamps, persists, and surfaces a 3-second inline error if clamping happened.

**Example (verbatim from `MapConfigPanel.tsx:149-181`):**
```typescript
// Source: kinetica_bi/src/components/charts/MapConfigPanel.tsx:149-181
const clampRadius = (raw: string): { value: number; clamped: boolean } => {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { value: 1, clamped: true }; // empty/NaN → snap to min
  }
  const rounded = Math.round(n);
  if (rounded < 1) return { value: 1, clamped: true };
  if (rounded > 200) return { value: 200, clamped: true };
  return { value: rounded, clamped: rounded !== n };
};

const handleRadiusBlur = () => {
  const { value, clamped } = clampRadius(radiusDraft);
  setRadiusDraft(String(value));
  if (clamped) {
    setRadiusError("Must be 1–200");
    setTimeout(() => setRadiusError(null), 3000);
  }
  if (value !== infoRadiusPx) {
    onChange({ ...config, infoRadiusPx: value });
  }
};
```

**Phase 34 adaptation (no upper bound per CONTEXT.md):**
```typescript
const clampMaxRecords = (raw: string): { value: number; clamped: boolean } => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: 1, clamped: true };
  const rounded = Math.round(n);
  if (rounded < 1) return { value: 1, clamped: true };
  return { value: rounded, clamped: rounded !== n };
};
```

### Pattern 5: AbortController per long-running operation

**What:** Per-operation `useRef<AbortController | null>`; on new trigger, abort prior + create new; on unmount, abort.

**Example (verbatim from `MapChartRenderer.tsx:540,1043-1047,710-711`):**
```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.tsx:540
const infoQueryAbortRef = useRef<AbortController | null>(null);

// Source: lines 1043-1047 — on re-trigger
infoQueryAbortRef.current?.abort();
useInfoSelectionStore.getState().reset();
overlayRef.current?.setPosition(undefined);
const controller = new AbortController();
infoQueryAbortRef.current = controller;

// Source: lines 710-711 — on cleanup/unmount
infoQueryAbortRef.current?.abort();
infoQueryAbortRef.current = null;
```

**AbortError handling (verbatim from `WidgetRenderer.tsx:360-361`):**
```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:360-361
// AbortError is expected on rapid filter changes — silent (matches Phase 9 lock).
if ((err as Error)?.name === "AbortError") return;
```

**Phase 34 needs 3 separate refs** (per CONTEXT.md):
```typescript
const previewAbortRef = useRef<AbortController | null>(null);
const saveAbortRef = useRef<AbortController | null>(null);
const deleteAbortRef = useRef<AbortController | null>(null);

// On unmount:
useEffect(() => {
  return () => {
    previewAbortRef.current?.abort();
    saveAbortRef.current?.abort();
    deleteAbortRef.current?.abort();
  };
}, []);
```

### Pattern 6: Store consumer for left-list badge (PITFALL S-02 / C-02 scoping)

**What:** Per-row selector scoped to `state.views[id].status` rather than spreading the entire `views` object.

**Recommended pattern for N rows:**
```typescript
// Render one row per view; each row component subscribes via its own selector.
function ViewListRow({ id, name, onSelect, onDelete }: ViewListRowProps) {
  // PITFALL S-02 carry-forward: scope to primitive (status string) to minimize re-renders.
  const status = useDynamicViewStore((s) => s.views[id]?.status);
  return (
    <div className="view-row">
      <span>{name}</span>
      <ViewStatusBadge status={status} />
      ...
    </div>
  );
}
```

**Alternative (single selector returning a derived map) is WORSE** — entire list re-renders on any view's status change. The per-row primitive selector is the locked v1.3/v1.4/v1.5 pattern.

### Pattern 7: Toast helper (verified path + signature)

**Path:** `kinetica_bi/src/store/toast.ts` (verified exists at this path).

**Signature (verbatim from `toast.ts:3-12`):**
```typescript
// Source: kinetica_bi/src/store/toast.ts:3-12
export type ToastKind = "permission" | "info" | "error";
export type Toast = { id: number; message: string; kind: ToastKind };

type ToastState = {
  toasts: Toast[];
  _lastShown: Map<string, number>;
  showToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
};
```

**Usage pattern (verbatim from `DashboardsPage.tsx:628`):**
```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx:628
useToastStore.getState().showToast("Layer added");
// Source: line 630 — error kind
useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
```

**CRITICAL FINDING — `kind: "warning"` does NOT exist.** CONTEXT.md § "Materialize feedback surfaces" specifies `"warning kind"` for `exceeds_max_records` toast — but `ToastKind` is only `"permission" | "info" | "error"`. Planner must either:
1. Use `"info"` kind for `exceeds_max_records` (matches the existing toast taxonomy; warning-like color comes from CSS).
2. Use `"error"` kind for `exceeds_max_records` (over-treats — server returned success, just a configuration constraint).
3. Extend `ToastKind` to add `"warning"` (out of scope — Phase 34 should NOT modify the store).

**Recommendation:** Use `"info"` kind for all `over_threshold` outcomes (matches `"Saved — no filter active..."` info-kind too). Use `"error"` only for actual materialize failures.

**Toast dedup:** 5-second window per `kind::message` key (`toast.ts:13,22-23`). Two identical toasts within 5s are suppressed — planner must avoid repeating identical toasts on retry.

### Pattern 8: Auth store consumer for `userId`

**Path:** `kinetica_bi/src/store/auth.ts`. AuthUser shape: `{ username: string }` (verified at `client.ts:84`).

**Field for `buildDynamicViewName`:** `useAuthStore.getState().user?.username` — string or undefined when unauthenticated (which should be impossible inside a logged-in dashboard view, but defensive code matters).

**Usage pattern (planner template):**
```typescript
import { useAuthStore } from "../store/auth";
import { buildDynamicViewName } from "../lib/dynamicViewName";

const userId = useAuthStore.getState().user?.username;
if (!userId) {
  // Defensive — should be unreachable inside DashboardsPage's auth-gated children.
  useToastStore.getState().showToast("Session expired — please log in again", "error");
  return;
}
const viewName = buildDynamicViewName({
  userId,
  dashboardId,
  dynamicViewId: dynamicViewRow.id,
});
```

### Pattern 9: Dashboard ID source

**Finding:** `DashboardContext` exists (`src/components/DashboardContext.tsx`) but its provider wraps ONLY the widget grid (`DashboardsPage.tsx:852-919`) — NOT the action-bar buttons or the modals region (`DashboardsPage.tsx:947+`).

**Verified file structure (DashboardsPage.tsx):**
```
line 692  return ( <div className="dashboard-open">
line 698    <div className="dashboard-toolbar">    ← action-bar buttons (lines 699-708)
line 852    <DashboardContextProvider dashboardId={...} widgets={...}>
line 854      ResponsiveGridLayout ...
line 919    </DashboardContextProvider>
line 921    {showTableModal && <TablePickerModal .../>}
line 947    {showLayersModal && <LayersModal .../>}    ← modals OUTSIDE provider
```

**Recommendation:** **Pass `dashboardId` as a PROP** to `DynamicViewsModal`, mirroring how `LayersModal` is mounted at `DashboardsPage.tsx:947-958` (no context dependency). Also pass `associatedTables` as a prop. This matches the existing modal mount pattern verbatim and avoids re-architecting the provider tree.

**Example (verbatim from `DashboardsPage.tsx:947-958`):**
```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx:947-958
{showLayersModal && (
  <LayersModal
    layers={layers}
    associatedTables={associatedTables}
    onClose={handleLayersModalClose}
    onCreate={handleLayerCreate}
    onDelete={handleLayerDelete}
    onDuplicate={handleLayerDuplicate}
    onPatch={handleLayerPatch}
    onReorder={handleLayerReorder}
  />
)}
```

**Phase 34 mirror:**
```typescript
{showDynamicViewsModal && (
  <DynamicViewsModal
    dashboardId={dashboard.id}
    associatedTables={associatedTables}
    onClose={() => setShowDynamicViewsModal(false)}
  />
)}
```

The modal is self-contained from there: lists, creates, updates, deletes, previews, materializes — all via the 7 Phase 33 client helpers + its own store reads/writes.

### Anti-Patterns to Avoid

- **DO NOT mirror Phase 22's "insert-at-end" fallback** (`KineticaWmsLayerForm.tsx:494-502`). That was a deferred carry-over. Phase 34 CONTEXT mandates true cursor-position insertion — implement the verified CM6 API (see Pattern 3).
- **DO NOT use `DashboardContext` for `dashboardId`** in the modal. The provider doesn't wrap the modal region. Pass as prop.
- **DO NOT use a `kind: "warning"` toast** — type doesn't exist. Use `"info"` for over_threshold outcomes.
- **DO NOT call `clearView` on the store via Save success** — only Delete triggers `clearView`. Save success uses `setView` to write the materialized result.
- **DO NOT rebuild a confirm dialog component.** Use `window.confirm()` per CONTEXT.md and existing app pattern.
- **DO NOT auto-save fields.** CONTEXT.md explicitly diverges from LayersModal's auto-save in favor of explicit Save button.
- **DO NOT clamp `max_records` while typing** (CONTEXT.md anti-pattern carry-forward from Phase 22). Clamp on blur only.
- **DO NOT subscribe the modal to ALL `useDynamicViewStore.views`** with a single selector — render N row components, each scoped to its own id (PITFALL S-02 / C-02).
- **DO NOT call `deleteDynamicView` from reset/cleanup paths.** That's the operator-explicit destructive primitive. Lifecycle cleanup uses `dropDynamicView` (already wired in Phase 33 at App.tsx + DashboardsPage.tsx).
- **DO NOT block Save on materialize success** (CONTEXT.md lock). CRUD persistence is the source of truth; materialize is best-effort feedback.
- **DO NOT mutate `useDynamicViewStore` on Preview.** Preview is read-only; only Save writes to the store.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL syntax highlighting + line numbers | Custom regex-based highlighter on a `<textarea>` | `@codemirror/lang-sql` + `@uiw/react-codemirror` | CM6's lang-sql handles dialect lexing, escapes, comments, multi-line strings; bundle cost is minor (~50KB gz) on top of already-installed `@codemirror/lang-html`. |
| Cursor-position text insertion | Custom `<textarea>` `selectionStart`/`selectionEnd` manipulation | CM6 `view.dispatch({ changes: { from, insert } })` | Custom approach loses syntax highlighting, line numbers, the whole editor. CM6 already has the API; just call it. |
| Toast / inline error / spinner UI | Custom transient-message components | `useToastStore.getState().showToast(...)` (existing) + per-form inline error state (existing pattern in MapConfigPanel) | Reuse the Phase 22 / 23 patterns; no new UI primitives needed. |
| Modal shell with portal + ESC + click-outside | Custom modal framework | `.modal-overlay` + `.modal-content.modal-layers` CSS classes; mirror LayersModal handlers | All four action-bar modals use the same shell — proven, tested, accessible. |
| Inline delete confirm | Native `confirm()` for delete-from-list | `confirmDeleteId: number | null` useState + inline `[Delete view] [Keep view]` swap | LayersModal's pattern; less disruptive than a modal-over-modal; one click to cancel. |
| Dirty-state confirm dialog | Custom React modal | `window.confirm()` (existing pattern at `DashboardsPage.tsx:102`, `DatasetsPage.tsx:33`) | Browser-native; allows the user to use ESC/Enter; no custom component to maintain. |
| Numeric input with min/max + clamp | Custom range slider component | `<input type="number" min={1}>` + `clamp-on-blur` JS handler | Browser provides up/down arrows + keyboard support for free; pattern proven in Phase 22 `MapConfigPanel`. |
| Per-view status badge subscription | Single `useStore` selector returning the entire `views` map | Per-row `useDynamicViewStore((s) => s.views[id]?.status)` selector in a `<ViewListRow>` sub-component | Avoids re-rendering the whole list on any view's status change. PITFALL S-02 / C-02 carry-forward. |
| `{view}` token validation | Frontend regex/validator that mirrors server's `substituteViewToken` | Let server validate (regex `/\{\s*view\s*\}/gi`); surface verbatim 400 error message | Single source of truth at `kinetica_bi/server/src/lib/dynamicViewSql.ts:25`. No drift risk. |

**Key insight:** All the heavy lifting is already in the codebase — Phase 33's 7 client helpers, Phase 33's `useDynamicViewStore`, Phase 33's `buildDynamicViewName`, Phase 22's CodeMirror integration template, Phase 12's LayersModal structure, Phase 22's `clampRadius` pattern, existing `useToastStore`, existing `useAuthStore`. Phase 34 is **composition**, not invention. The single net-new dependency is `@codemirror/lang-sql`.

## Common Pitfalls

### Pitfall 1: 400 error message is swallowed by `throwForStatus`
**What goes wrong:** Server returns `400 { error: "Dynamic view template must contain a {view} token." }`. Frontend `throwForStatus` extracts the message at `client.ts:67-75` but then throws `new Error(\`${fallbackMessage}: ${response.status}\`)` at line 79 — the **extracted message is discarded** for non-401/403/502 status codes. Operator sees `"Failed to create dynamic view: 400"`, not the actionable `{view}` token message.

**Why it happens:** `throwForStatus` only uses the extracted `message` to construct the `ReauthRequiredError`/`PermissionError`/`UpstreamError` instances. The fallthrough `throw new Error(...)` at line 79 hard-codes `${fallbackMessage}: ${response.status}`.

**How to avoid:** Phase 34 modal needs to **bypass** `throwForStatus` for the 4 endpoints that may return 400 with semantic messages (`createDynamicView`, `updateDynamicView`, `previewDynamicView`). Option A: catch the thrown `Error`, re-fetch the response body in the calling code (but the response is already consumed). Option B: wrap each helper call with a custom error reader that intercepts the 400 BEFORE `throwForStatus` runs — but the helpers already invoke `throwForStatus` internally. Option C (RECOMMENDED): introduce a parallel helper or extend `throwForStatus` to use the extracted `message` in the generic fallthrough.

**Recommended fix (planner judgment):**
```typescript
// In client.ts throwForStatus, change line 79 from:
throw new Error(`${fallbackMessage}: ${response.status}`);
// To:
throw new Error(message); // preserves server's error string when present
```
This is a minor, additive client.ts change that benefits Phase 34 + all future endpoints. Backward compatible — `message` falls back to `fallbackMessage` when the server returns no JSON body.

Alternative (Phase-34-only): the modal copies-and-modifies the relevant client helpers to extract 400 messages explicitly. Less clean but doesn't touch shared infrastructure.

**Warning signs:** Tests that pass `vi.fn().mockRejectedValueOnce(new Error("..."))` need to match the new format; vitest specs for the 3 affected helpers need updating if the fix is taken.

### Pitfall 2: CodeMirror `EditorView` ref captured by `onCreateEditor` is null on first render
**What goes wrong:** `editorViewRef.current` is `null` until the editor mounts. If "Insert {view}" is clicked very quickly (e.g., in a vitest spec rendering the modal and immediately firing a click), the handler dereferences null and silently no-ops.

**Why it happens:** `onCreateEditor` fires asynchronously during the editor's first paint, not synchronously during the initial React render.

**How to avoid:** Guard at the top of the click handler:
```typescript
const handleInsertViewToken = () => {
  const view = editorViewRef.current;
  if (!view) return; // editor not mounted yet — no-op gracefully
  view.dispatch({ changes: { from: view.state.selection.main.head, insert: "{view}" } });
  view.focus();
};
```

For specs: either await an `await screen.findByLabelText(...)` for an editor-internal element to confirm mount, or test the click handler's null-safe behavior explicitly.

**Warning signs:** Spec fails intermittently with "Cannot read properties of null."

### Pitfall 3: CodeMirror placeholder + cursor-insert interaction
**What goes wrong:** CONTEXT.md flags "Disabled when editor is empty AND placeholder is visible (otherwise user inserts into placeholder which doesn't make sense in CM6 placeholder semantics — verify in research)."

**Verified behavior:** CM6's placeholder extension renders the placeholder as **DOM decoration** (a `<span class="cm-placeholder">` overlay), NOT as actual document content. The underlying `EditorState.doc` is genuinely empty (`""`). Calling `view.dispatch({ changes: { from: 0, insert: "{view}" } })` on an empty doc inserts at position 0, the placeholder disappears (because the doc is no longer empty), and the cursor is now at position 6 (`"{view}".length`). This is the correct UX.

**Recommendation:** **Insert {view}** button should NOT be disabled when placeholder is showing. Empty-editor + insert works perfectly via the verified API. CONTEXT.md's caution is unnecessary.

**Warning signs:** None — verified by CM6 reference docs and the `placeholder` prop behavior in `@uiw/react-codemirror`.

### Pitfall 4: `useDynamicViewStore` selector subscribes to entire object — re-render storm
**What goes wrong:** Calling `useDynamicViewStore((s) => s)` or `useDynamicViewStore((s) => s.views)` causes the entire modal to re-render on every action that bumps `dynamicViewVersion` — including views the modal isn't displaying.

**Why it happens:** Zustand's default `Object.is` shallow-compare on selector return values; a new top-level `views` object reference (every mutation) breaks the reference check.

**How to avoid:** Render N row components, each scoped to a single id's status:
```typescript
{views.map((v) => (
  <ViewListRow key={v.id} view={v} ... />
))}

function ViewListRow({ view }: { view: DynamicViewRow }) {
  const status = useDynamicViewStore((s) => s.views[view.id]?.status);
  return <div>... <StatusBadge status={status} /> ...</div>;
}
```

This is the v1.3/v1.4/v1.5 locked pattern (PITFALL S-02 / C-02).

**Warning signs:** React DevTools flame graph shows the modal re-rendering on every store mutation.

### Pitfall 5: Toast dedup window suppresses retry feedback
**What goes wrong:** `useToastStore` dedups identical `kind::message` pairs within 5 seconds (`toast.ts:13`). If the operator clicks Save twice rapidly and both produce identical toasts, only the first appears.

**How to avoid:** Make toast messages include a transient detail (e.g., view name) or a timestamp suffix when retries are expected. For Phase 34's `over_threshold/no_filter` case, including the view name in the toast disambiguates:
```typescript
useToastStore.getState().showToast(
  `Saved "${name}" — no filter active; view will materialize when a filter is applied.`,
  "info"
);
```

**Warning signs:** Spec expectations for repeated toasts fail; operator confusion in UAT ("I clicked Save but nothing happened").

### Pitfall 6: AbortController cross-cancellation between Preview / Save / Delete
**What goes wrong:** Using a single AbortController for all three operations causes Delete-then-Save to cancel the Save (or vice versa).

**How to avoid:** Three separate refs (CONTEXT.md already locks this):
```typescript
const previewAbortRef = useRef<AbortController | null>(null);
const saveAbortRef = useRef<AbortController | null>(null);
const deleteAbortRef = useRef<AbortController | null>(null);
```

**Warning signs:** Save's materialize promise rejects with AbortError when the operator clicks Delete on a different row.

### Pitfall 7: Form re-load after Save discards in-flight unsaved edits
**What goes wrong:** CONTEXT.md says "Form reset on save success: Modal stays open. Form re-loads with the canonical row from the server response so any auto-clear (columns_json clear) is reflected. Dirty flag clears." If the operator types in the SQL field DURING the Save round-trip (between optimistic Save click and server response), those edits are silently overwritten by the canonical row.

**How to avoid:** Disable form fields during Save (in addition to disabling the Save button). The `saving: boolean` state should `disabled` all inputs + the editor (`editable={!saving}` on CodeMirror).

**Warning signs:** UAT: operator reports "my edits disappeared after clicking Save."

### Pitfall 8: `clearView` on a non-existent id is a NO-OP — silent failure surface
**What goes wrong:** Phase 33 store locks `clearView(non-existent id)` to a strict no-op (`dynamicViewStore.ts:140-149`). If the modal calls `clearView(id)` after `deleteDynamicView` but the entry was never materialized in this session (no store entry), the no-op is invisible — and that's the correct behavior. But if `deleteDynamicView` is called with the wrong id (e.g., a stale closure from a re-render), the visible row disappears from the LOCAL modal list but the materialized view stays alive server-side (or vice versa).

**How to avoid:** Always use the canonical row id from the most-recent server response. Don't trust closures over state from earlier renders. Validate by reading `useDynamicViewStore.getState().views[id]` after `clearView` and asserting deletion.

**Warning signs:** Orphan Kinetica views surviving deletion; mismatched left-list and server state.

## Code Examples

Verified patterns from official sources.

### Example 1: CodeMirror 6 cursor-position insertion (verified via codemirror.net/docs/ref)
```typescript
// Source: https://codemirror.net/docs/ref/ (verified 2026-05-14)
// + https://github.com/uiwjs/react-codemirror (onCreateEditor verified)
import { useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";

const editorViewRef = useRef<EditorView | null>(null);

// Capture the EditorView instance on mount
const handleCreateEditor = (view: EditorView) => {
  editorViewRef.current = view;
};

// Insert text at current cursor position
const insertAtCursor = (text: string) => {
  const view = editorViewRef.current;
  if (!view) return;
  const pos = view.state.selection.main.head; // current cursor position
  view.dispatch({ changes: { from: pos, insert: text } });
  view.focus();
};

<CodeMirror
  value={value}
  onChange={setValue}
  extensions={[sql()]}
  minHeight="200px"
  maxHeight="400px"
  placeholder="-- placeholder text"
  onCreateEditor={handleCreateEditor}
/>
```

### Example 2: `useDynamicViewStore` per-row consumer (PITFALL S-02 carry-forward)
```typescript
// Source: synthesized from spatialFilterStore.ts consumers and Phase 33 locks
import { useDynamicViewStore, type DynamicViewStatus } from "../store/dynamicViewStore";

function ViewListRow({ row, isSelected, onSelect, onDelete }: {
  row: DynamicViewRow;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  // Per-row primitive selector — minimizes re-renders.
  const status = useDynamicViewStore((s) => s.views[row.id]?.status);
  return (
    <div
      className={`view-row${isSelected ? " active" : ""}`}
      onClick={() => onSelect(row.id)}
    >
      <span className="view-row-name">{row.name}</span>
      <ViewStatusBadge status={status} />
      <button onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}>
        <FontAwesomeIcon icon={faTrash} />
      </button>
    </div>
  );
}

function ViewStatusBadge({ status }: { status: DynamicViewStatus | undefined }) {
  if (!status) return null;
  // map status → icon + color
  ...
}
```

### Example 3: Save → markPending → materialize → setView/setError sequence
```typescript
// Source: synthesized from Phase 33 contracts + CONTEXT.md Save flow
import { createDynamicView, materializeDynamicView } from "../api/client";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { buildDynamicViewName } from "../lib/dynamicViewName";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";

async function handleSave({
  dashboardId, formState, isNew, abortSignal,
}: SaveArgs): Promise<void> {
  // 1. CRUD
  const result = isNew
    ? await createDynamicView(dashboardId, {
        source_table_id: formState.source_table_id,
        name: formState.name,
        template_sql: formState.template_sql,
        max_records: formState.max_records,
      }, abortSignal)
    : await updateDynamicView(formState.id!, {
        ...formState,
        columns_json: formState.columns_json, // sent if Preview ran
      }, abortSignal);
  const row = result.dynamic_view;

  // 2. Compute viewName + markPending
  const userId = useAuthStore.getState().user?.username;
  if (!userId) {
    useToastStore.getState().showToast("Session expired", "error");
    return;
  }
  const viewName = buildDynamicViewName({
    userId, dashboardId, dynamicViewId: row.id,
  });
  useDynamicViewStore.getState().markPending(row.id, viewName);

  // 3. Materialize
  try {
    const matResult = await materializeDynamicView(row.id, abortSignal);
    if (matResult.status === "materialized") {
      useDynamicViewStore.getState().setView(row.id, {
        viewName: matResult.view_name,
        status: "materialized",
        expiresAt: matResult.expires_at,
      });
      useToastStore.getState().showToast(`Dynamic view materialized`, "info");
    } else if (matResult.status === "over_threshold") {
      useDynamicViewStore.getState().setView(row.id, {
        viewName,
        status: "over_threshold",
        reason: matResult.reason,
      });
      if (matResult.reason === "no_filter") {
        useToastStore.getState().showToast(
          `Saved "${row.name}" — no filter active; view will materialize when a filter is applied.`,
          "info"
        );
      } else {
        useToastStore.getState().showToast(
          `Saved "${row.name}" — ${matResult.row_count} rows exceeds max_records ${row.max_records}; raise the threshold or narrow filters.`,
          "info" // NOTE: not "warning" — that kind does not exist (see Pitfall: toast)
        );
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return; // silent — modal closed
    const msg = (err as Error)?.message ?? "unknown";
    useDynamicViewStore.getState().setError(row.id, msg);
    useToastStore.getState().showToast(`Materialize failed: ${msg}`, "error");
  }
}
```

### Example 4: `LayersModal` shell structure (mirror verbatim for `.modal-overlay` shell)
```typescript
// Source: kinetica_bi/src/components/LayersModal.tsx:176-184 (verbatim shell)
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
      <div className="layers-modal-body">
        <div className="layers-modal-left">
          {/* left-list */}
        </div>
        <div className="layers-modal-right">
          {/* right-form + preview */}
        </div>
      </div>
    </div>
  </div>
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 22 "Insert column" `<select>` inserts at END of template | Phase 34 "Insert {view}" button uses CM6 cursor-position dispatch | This phase | More precise UX; CM6 API verified and trivial to call (one ref + one dispatch). |
| Auto-save with 300ms debounce (LayersModal pattern) | Explicit Save button + dirty-state confirm on close | This phase (CONTEXT.md lock) | Operator gets atomic Save semantics for heavy SQL; less network churn. |
| All client helpers shared a single `throwForStatus` fallback that discards server message on non-401/403/502 | (Recommended fix) Include extracted server message in generic `throw new Error(message)` | Suggested in this research | Operator-facing error strings become actionable; affects all helpers, not just dynamic-view. |
| 5-store reset block | 6-store reset block (Phase 33 added `useDynamicViewStore.reset()` + DROP loop) | Phase 33 (already shipped) | Phase 34 doesn't touch — just consumes the 6th store. |

**Deprecated/outdated:**
- Phase 22's "insert-at-end" deferral (`KineticaWmsLayerForm.tsx:494-502`) — Phase 34's cursor-position approach is the new pattern; Phase 22 could opportunistically migrate to it in a future phase (out of scope).

## Open Questions

1. **Should `throwForStatus` be fixed to preserve server error messages?**
   - What we know: Line 79 of `client.ts` throws `new Error(\`${fallbackMessage}: ${response.status}\`)` — discards the extracted `message`.
   - What's unclear: Whether the planner wants this fix in Phase 34 (cleanly benefits all future endpoints) or a Phase-34-local workaround (planner adds custom 400-handling around the 3 affected client calls).
   - Recommendation: **Apply the one-line `throwForStatus` fix** — backward-compatible, additive, eliminates a real UX gap. Add a regression spec asserting that a 400 with `{ error: "..." }` body throws an Error whose `.message` is the server's string.

2. **What is the canonical UI affordance for the materialize-status badge?**
   - What we know: CONTEXT.md says "green dot or check icon," "spinner / pulse," "yellow triangle," "red exclamation."
   - What's unclear: Whether the project has an existing badge component (Phase 12 mentions `FilteringBadge` and `MapFilteringBadge`; Phase 24 mentions a layer-row badge).
   - Recommendation: Reuse `FilteringBadge` styling tokens (`.widget-filtering-badge` family in `global.css`) for parity with existing surface. Use Font Awesome icons from `@fortawesome/free-solid-svg-icons` (already installed: `faCheck`, `faSpinner`, `faTriangleExclamation`, `faCircleExclamation`).

3. **Where does the operator's `dashboard_id` get passed for the Preview call?**
   - What we know: CONTEXT.md says the Preview body includes `dashboard_id`. `dashboardId` is on the modal's props.
   - What's unclear: The server route signature for Preview (`POST /api/dynamic-view/preview`) — does it accept `dashboard_id` in the body, or is it inferred from session/auth? Reading the Phase 32 endpoint registration:
     - Verified at `kinetica_bi/server/src/index.ts:875+` and `client.ts:862-868`: Preview accepts `{ template_sql, source_table_id, dashboard_id, sample_limit? }` — body includes `dashboard_id`.
   - Recommendation: Pass `dashboard_id: dashboardId` from props on every Preview call.

4. **Should the Insert {view} button reside above or beside the editor section label?**
   - What we know: CONTEXT.md says "above the editor, right-aligned alongside the editor's section label (or as a small ghost button to the right of the label)."
   - What's unclear: Existing form patterns — KineticaWmsLayerForm puts the "Insert column" `<select>` BELOW the column picker and ABOVE the editor (lines 1085-1104).
   - Recommendation: Place "Insert {view}" button immediately above the editor, right-aligned within the same row as the section label ("Template SQL"). Use `.ds-field-label` for the section label and add a small `button.ghost-sm` for the insert button. Keeps the vertical flow consistent with the existing form.

## Validation Architecture

Skipped per `.planning/config.json` (`workflow.nyquist_validation: false`).

## Sources

### Primary (HIGH confidence)
- `kinetica_bi/src/components/LayersModal.tsx` (379 lines) — Modal structural template; ESC handler at lines 80-86; click-outside at line 177; inline delete confirm at lines 64,193,231-281.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx:46-47,1113-1122` — CodeMirror integration template (HTML edition).
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx:149-181` — Clamp-on-blur numeric pattern.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:540,710-711,1043-1047` — AbortController per-operation pattern.
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:360-361` — AbortError silent-handling pattern.
- `kinetica_bi/src/store/toast.ts` (35 lines) — Verified toast helper path + signature.
- `kinetica_bi/src/store/auth.ts:20-70` — Verified auth store; `user?.username` field.
- `kinetica_bi/src/api/client.ts:84,742-923` — AuthUser shape + all 7 Phase 33 client helpers verified shipped.
- `kinetica_bi/src/store/dynamicViewStore.ts` — Phase 33 store shipped verbatim.
- `kinetica_bi/src/lib/dynamicViewName.ts` — Phase 33 pure helper shipped.
- `kinetica_bi/server/src/lib/dynamicViewSql.ts:18-40` — Server-side `{view}` validation; error message `"Dynamic view template must contain a {view} token."`.
- `kinetica_bi/server/src/index.ts:875-900` — Server validation chain.
- `kinetica_bi/src/components/DashboardsPage.tsx:692-708,852-919,947-958` — Action-bar + DashboardContextProvider wrap region + modal mount pattern.
- `kinetica_bi/src/components/DashboardContext.tsx` — Provider wraps grid only, NOT action-bar/modals.
- `kinetica_bi/src/App.tsx:69-108` — Lifecycle reset 6-store block already wired with DROP loop.
- `kinetica_bi/package.json` — Verified dependencies.
- `codemirror.net/docs/ref/` (Context7 / WebFetch 2026-05-14) — CM6 `view.state.selection.main.head` + `view.dispatch({ changes: { from, insert } })` API.
- `github.com/codemirror/lang-sql` (WebFetch 2026-05-14) — `sql([config])` signature + import statement.
- `github.com/uiwjs/react-codemirror` (WebFetch 2026-05-14) — `onCreateEditor?(view: EditorView, state: EditorState): void` callback signature.
- `npm view @codemirror/lang-sql` (2026-05-14) — 6.10.0 current; verified publish date 2025-09-16.

### Secondary (MEDIUM confidence)
- LayersModal-style spec test patterns at `kinetica_bi/src/components/LayersModal.spec.tsx` (270 lines, 15+ test cases) — model for `DynamicViewsModal.spec.tsx`.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` line 184-244 — model for "modal-open" + "DROP loop on cleanup" specs.

### Tertiary (LOW confidence)
- None — all critical claims verified against primary sources or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@codemirror/lang-sql@6.10.0` verified via npm registry + official changelog (2025-09-16 latest).
- Architecture: HIGH — all patterns mirror existing shipped code (LayersModal, MapConfigPanel, MapChartRenderer, WidgetRenderer).
- Pitfalls: HIGH for #1 (verified bug in `throwForStatus`), HIGH for #2/#3 (verified CM6 behavior), HIGH for #6 (confirmed by `MapChartRenderer` triple-ref pattern); MEDIUM for #5 (toast dedup verified, but field experience of "5s window suppresses retry" is logical inference).
- Code examples: HIGH — all synthesized from verified primary sources.

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (stable codebase; CM6 ecosystem mature). Re-verify `@codemirror/lang-sql` version if more than 30 days elapse before planning.

---

## Quick Reference for Planner

**Files to create (NEW):**
1. `kinetica_bi/src/components/DynamicViewsModal.tsx` — main component
2. `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` — vitest spec

**Files to extend (EXISTING):**
3. `kinetica_bi/src/components/DashboardsPage.tsx` — add 4th button (lines 705-707 area) + modal state + modal mount conditional (line 947 area)
4. `kinetica_bi/src/components/DashboardsPage.spec.tsx` — assert button renders + opens modal
5. `kinetica_bi/src/styles/global.css` — `.dynamic-views-modal-*` CSS namespace (or reuse `.modal-layers`)
6. `kinetica_bi/package.json` — add `@codemirror/lang-sql@^6.10.0`

**Recommended (optional but high-value):**
7. `kinetica_bi/src/api/client.ts:79` — one-line fix to preserve server error message in generic 400 fallthrough (planner judgment; benefits all helpers).

**Files to read-only consume (DO NOT MODIFY):**
- `kinetica_bi/src/store/dynamicViewStore.ts` — Phase 33 shipped
- `kinetica_bi/src/store/toast.ts` — existing
- `kinetica_bi/src/store/auth.ts` — existing
- `kinetica_bi/src/lib/dynamicViewName.ts` — Phase 33 shipped
- `kinetica_bi/src/components/DashboardContext.tsx` — informational (do not extend coverage to modal region)
- All 7 Phase 33 client helpers in `client.ts`

**Verified type contracts (just reference):**
- `DynamicViewRow` — `client.ts:747-757`
- `MaterializeDynamicViewResponse` — `client.ts:766-769` (3-branch discriminated union)
- `PreviewDynamicViewResponse` — `client.ts:772-775`
- `DynamicViewStatus` / `DynamicViewReason` / `DynamicViewEntry` — `dynamicViewStore.ts:49-58`
