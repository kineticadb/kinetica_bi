---
phase: 21-map-click-popup
plan: 02
type: execute
wave: 2
depends_on:
  - 21-01
files_modified:
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/components/charts/InfoPopup.tsx
  - kinetica_bi/src/components/charts/InfoPopup.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - POPUP-V14-02
  - POPUP-V14-03
  - POPUP-V14-04
  - POPUP-V14-05
must_haves:
  truths:
    - "infoQuery POSTs to /api/info/query and returns InfoQueryResponse — mirrors materializeFilter pattern"
    - "InfoPopup renders sticky header with layer dropdown (left) and close button (right)"
    - "InfoPopup renders body in template mode (dangerouslySetInnerHTML per row) when info_template is set"
    - "InfoPopup renders body in key-value table mode when info_template is null"
    - "InfoPopup shows 'Load more' when hasMore=true and hides when hasMore=false"
    - "InfoPopup calls onLoadMore on button click; button shows spinner/disabled state during load"
    - "InfoPopup calls onClose on X button click, ESC key, click outside popup body"
    - "InfoPopup calls onLayerSwitch(layerId) when dropdown selection changes"
    - "InfoPopup auto-dismisses (calls onClose) when activeLayerId leaves the eligible set"
    - "InfoPopup subscribes to scoped state[activeLayerId] selector — never whole state object (PITFALL S-02)"
  artifacts:
    - path: "kinetica_bi/src/api/client.ts"
      provides: "infoQuery client helper + InfoQueryRequest / InfoQueryResponse / SpatialColumns types"
      exports: ["infoQuery", "InfoQueryRequest", "InfoQueryResponse", "SpatialColumns"]
      contains: "export const infoQuery"
    - path: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      provides: "Presentation component reading useInfoSelectionStore"
      exports: ["default"]
      contains: "export default function InfoPopup"
      min_lines: 150
    - path: "kinetica_bi/src/components/charts/InfoPopup.spec.tsx"
      provides: "Vitest spec for header / body modes / Load-more / dismiss paths / auto-dismiss"
      contains: "describe(\"InfoPopup\""
      min_lines: 200
    - path: "kinetica_bi/src/styles/global.css"
      provides: "info-popup-* CSS classes (anchored-tail variant of modal styling)"
      contains: ".info-popup"
  key_links:
    - from: "kinetica_bi/src/api/client.ts"
      to: "POST /api/info/query"
      via: "apiFetch + throwForStatus"
      pattern: "/api/info/query"
    - from: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      to: "useInfoSelectionStore"
      via: "scoped selector s.state[s.activeLayerId]"
      pattern: "useInfoSelectionStore\\(\\(s\\)"
    - from: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      to: "renderInfoTemplate (Plan 21-01)"
      via: "import from '../../lib/renderInfoTemplate'"
      pattern: "from .*renderInfoTemplate"
    - from: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      to: "ESC dismiss"
      via: "window.addEventListener('keydown')"
      pattern: 'e\\.key === "Escape"'
---

<objective>
Build the user-visible popup chrome and the network primitive it depends on. Two independent files (client helper + presentation component) plus CSS, assembled here so Plan 21-03 (MapChartRenderer integration) can mount the component via `ol/Overlay` and trigger fetches via the helper without any UI/component work in that plan.

Purpose: Separate "what gets rendered when the store has data" (this plan, pure presentation + network helper) from "what feeds the store + where the popup mounts geospatially" (Plan 21-03, the OL integration). This keeps the React component fully unit-testable without an OL Map instance.

Output:
- `kinetica_bi/src/api/client.ts` — extended with `infoQuery` helper, `InfoQueryRequest`, `InfoQueryResponse`, `SpatialColumns` types
- `kinetica_bi/src/components/charts/InfoPopup.tsx` — new file; presentation component
- `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` — new file; vitest spec
- `kinetica_bi/src/styles/global.css` — appended `.info-popup-*` class block

Scope rules:
- This plan does NOT register any OL listener (Plan 21-03).
- This plan does NOT mount the Overlay (Plan 21-03).
- This plan does NOT compute eligibleLayers from MapChartRenderer state (Plan 21-03 derives, passes as prop).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/21-map-click-popup/21-CONTEXT.md
@.planning/phases/21-map-click-popup/21-RESEARCH.md
@.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/store/infoSelectionStore.ts
@kinetica_bi/src/components/LayersModal.tsx
@kinetica_bi/src/components/Toast.tsx
@kinetica_bi/src/store/toast.ts
@kinetica_bi/src/lib/mapInfoConfig.ts

<interfaces>
<!-- Existing types this plan consumes. Executor uses these directly — no codebase exploration needed. -->

From kinetica_bi/src/store/infoSelectionStore.ts (Phase 20 — already shipped):
```typescript
export type InfoSelectionEntry = {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};

export type InfoSelectionState = {
  state: Record<number, InfoSelectionEntry>;
  activeLayerId: number | null;
  setSelection: (layerId: number, payload: { rows; columns; page; hasMore }) => void;
  appendPage: (layerId: number, payload: { rows; page; hasMore }) => void;
  clearSelection: (layerId: number) => void;
  setActiveLayer: (layerId: number) => void;  // signature is (layerId: number), NOT number|null
  setLoading: (layerId: number, loading: boolean) => void;
  setError: (layerId: number, error: string | null) => void;
  reset: () => void;
};

export const useInfoSelectionStore: UseBoundStore<...>;
```

From kinetica_bi/src/api/client.ts (existing — read for patterns):
```typescript
// Line 38: apiFetch wrapper handles 401 + REAUTH_REQUIRED
const apiFetch: typeof fetch = async (input, init) => { ... };

// Line 61-79: throwForStatus maps 401/403/502 to typed errors
async function throwForStatus(response, fallbackMsg) { ... }

// Line 446-465: DashboardLayerDto with Phase 19 info_* fields
export type DashboardLayerDto = {
  id: number;
  table_id: number;
  position: number;
  config: Record<string, unknown>;
  info_enabled: number;          // 0 | 1
  info_columns: string | null;
  info_template: string | null;
  ...
};

// Line 585-599: materializeFilter — POST helper PRECEDENT to mirror
export const materializeFilter = async (
  args: MaterializeFilterArgs,
  signal?: AbortSignal
): Promise<MaterializeFilterResponse> => {
  const response = await apiFetch(`${API_BASE}/api/filter/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to materialize filter view");
  }
  return response.json() as Promise<MaterializeFilterResponse>;
};
```

From kinetica_bi/src/lib/renderInfoTemplate.ts (Plan 21-01 — produced by upstream wave):
```typescript
export type RenderResult =
  | { mode: "template"; html: string }
  | { mode: "kv"; pairs: { col: string; value: unknown }[] };

export type RenderInfoTemplateArgs = {
  template: string | null;
  columns: string[];
  row: Record<string, unknown>;
  infoColumns?: string | null;
};

export function renderInfoTemplate(args: RenderInfoTemplateArgs): RenderResult;
```

From kinetica_bi/src/store/toast.ts (existing — already shipped):
```typescript
useToastStore.getState().showToast(message: string, kind?: "permission" | "info" | "error"): void;
// dedup window: 5000ms; auto-dismiss after 5000ms
```

Server endpoint contract (kinetica_bi/server/src/index.ts:787-940 — Phase 18 shipped):
```
POST /api/info/query
Request body:
  layerId: number, tableId: number, schema: string, table: string,
  spatialMode: "latlon" | "wkt" | "wkb",
  spatialColumns: { lonCol?, latCol?, wktCol?, wkbCol? },  // exactly one variant populated
  clickLon: number, clickLat: number,                       // EPSG:4326 (geographic degrees)
  radiusPx: number,                                          // > 0
  mapBbox: [number,number,number,number],                    // EPSG:3857
  mapWidthPx: number, mapHeightPx: number,                   // > 0
  page: number                                                // ≥ 0 integer
Response (200): { rows: Record<string,unknown>[], columns: string[], hasMore: boolean, page: number }
Response (501) for spatialMode='wkb': { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }
```

Existing CSS classes to mirror (kinetica_bi/src/styles/global.css:481-520):
- `.modal-overlay` — full-viewport backdrop (NOT used here; popup is anchored, not centered)
- `.modal-content` — bordered panel (mirror styling primitives via `.info-popup`)
- `.modal-header` — flex header with title + close button
- `.modal-close` — close X button styling (mirror in `.info-popup-close`)

CSS variables already defined: `--panel`, `--border`, `--shadow`, `--text-muted`.
</interfaces>

<pitfalls>
<!-- Carry-forward from prior phases — non-negotiable. -->

- **PITFALL S-02 (Phase 12+ carry):** NEVER subscribe to `useInfoSelectionStore.state` whole — scope selector to `s.state[s.activeLayerId]`. Whole-state subscriptions fan out on every layer mutation (e.g. setLoading on layer A re-renders the popup viewing layer B).
- **NO `setActiveLayer(null)` (locked):** Type signature is `(layerId: number)`. Dismiss MUST call `useInfoSelectionStore.getState().reset()`. The component does NOT call `setActiveLayer(null)` anywhere.
- **NO sanitization (locked):** Template HTML rendered via `dangerouslySetInnerHTML`. Inline comment citing PROJECT.md Key Decision is REQUIRED at the dangerouslySetInnerHTML call site.
- **NO sanitizer library import (locked):** Don't import DOMPurify, sanitize-html, etc.
- **Single-active invariant:** When `activeLayerId === null`, the component renders nothing (returns null). The parent decides when to mount the Overlay.
</pitfalls>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add infoQuery client helper + types to api/client.ts</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/api/client.spec.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (full file — needs to be re-read for current state since the helper appends near line 627)
    - kinetica_bi/src/api/client.ts:585-627 (materializeFilter + dropFilterView pattern to mirror)
    - kinetica_bi/src/api/client.spec.ts (existing client spec — extend with infoQuery describe block; mirror the materializeFilter spec structure at line 17 onward)
    - .planning/phases/21-map-click-popup/21-RESEARCH.md (§ Pattern 5 — infoQuery client helper)
    - kinetica_bi/server/src/index.ts:787-940 (server endpoint validation rules — payload must satisfy these or get 400)
  </read_first>
  <behavior>
    Test cases for the new `describe("infoQuery", () => { ... })` block (mirror materializeFilter precedent):
    - Test I1: 200 OK with body `{ rows: [{ a: 1 }], columns: ["a"], hasMore: false, page: 0 }` → returns parsed body verbatim
    - Test I2: 401 → throws ReauthRequiredError (via throwForStatus)
    - Test I3: 403 → throws PermissionError
    - Test I4: 502 → throws UpstreamError
    - Test I5: AbortSignal aborted before fetch resolves → throws AbortError (signal.aborted=true; native fetch rejects)
    - Test I6: Verifies POST body matches the InfoQueryRequest shape (JSON.stringify of args)
  </behavior>
  <action>
    Append the following block AT THE END of `kinetica_bi/src/api/client.ts` (after `dropFilterView` at line 627):

    ```typescript
    // ---------------------------------------------------------------------------
    // Phase 21 (POPUP-V14-01..06): client helper for POST /api/info/query.
    //
    // Phase 18 endpoint contract (locked at .planning/phases/18-spatial-spike-and-endpoint
    // /18-VERIFICATION.md and kinetica_bi/server/src/index.ts:787-940):
    //   POST /api/info/query
    //     body:  { layerId, tableId, schema, table, spatialMode, spatialColumns,
    //              clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx, page }
    //     resp:  { rows, columns, hasMore, page }
    //     501:   spatialMode='wkb' returns { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }
    //
    // AbortSignal threading (mirrors V13-P-10 lock from materializeFilter): caller (Plan 21-03
    // MapChartRenderer click handler) wires a dedicated `infoQueryAbortRef` to abort the
    // sequential fan-out on re-click and on dropdown switch.
    //
    // Error contract: throwForStatus maps 401/403/502 to ReauthRequiredError /
    // PermissionError / UpstreamError. AbortError propagates natively (helper does NOT swallow).
    // 501 (WKB-deferred) flows through throwForStatus as a generic non-2xx — caller is
    // responsible for filtering WKB layers BEFORE calling this helper (Plan 21-03 eligibleLayers
    // useMemo). The helper itself stays mode-agnostic.
    // ---------------------------------------------------------------------------

    /** Mirrors server SpatialColumns at server/src/lib/spatialQuery.ts:55-60. Field-shape parity is the contract. */
    export type SpatialColumns = {
      lonCol?: string;
      latCol?: string;
      wktCol?: string;
      wkbCol?: string;
    };

    /** Mirrors server SpatialMode at server/src/lib/spatialQuery.ts:45. */
    export type InfoSpatialMode = "latlon" | "wkt" | "wkb";

    export type InfoQueryRequest = {
      layerId: number;
      tableId: number;
      schema: string;
      table: string;
      spatialMode: InfoSpatialMode;
      spatialColumns: SpatialColumns;
      clickLon: number;       // EPSG:4326 (geographic degrees) — Plan 21-03 transforms from EPSG:3857 OL coord
      clickLat: number;       // EPSG:4326
      radiusPx: number;       // > 0 (server validates)
      mapBbox: [number, number, number, number];  // EPSG:3857 [minX, minY, maxX, maxY]
      mapWidthPx: number;     // > 0
      mapHeightPx: number;    // > 0
      page: number;           // ≥ 0 integer (server validates)
    };

    export type InfoQueryResponse = {
      rows: Record<string, unknown>[];
      columns: string[];
      hasMore: boolean;
      page: number;
      totalEstimate?: number;  // optional per SPATIAL-V14-04; CONTEXT.md notes it may be surfaced inline by popup at Claude's discretion
    };

    export const infoQuery = async (
      args: InfoQueryRequest,
      signal?: AbortSignal
    ): Promise<InfoQueryResponse> => {
      const response = await apiFetch(`${API_BASE}/api/info/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to fetch info records");
      }
      return response.json() as Promise<InfoQueryResponse>;
    };
    ```

    Then extend `kinetica_bi/src/api/client.spec.ts` by adding a new `describe("infoQuery", () => { ... })` block AFTER the existing `describe("materializeFilter", ...)`. Mirror the existing materializeFilter test scaffold (vi.fn() global fetch mock, beforeEach reset, etc.).

    Run:
    - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` — all tests green (existing + new infoQuery block).
    - `cd kinetica_bi && npx tsc --noEmit` — exit 0.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/api/client.spec.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export const infoQuery" kinetica_bi/src/api/client.ts` returns `1`
    - `grep -c "export type InfoQueryRequest" kinetica_bi/src/api/client.ts` returns `1`
    - `grep -c "export type InfoQueryResponse" kinetica_bi/src/api/client.ts` returns `1`
    - `grep -c "export type SpatialColumns" kinetica_bi/src/api/client.ts` returns `1`
    - `grep -c "/api/info/query" kinetica_bi/src/api/client.ts` returns at least `1`
    - `grep -c "POPUP-V14" kinetica_bi/src/api/client.ts` returns at least `1` (regression tag)
    - `grep -c 'describe\("infoQuery"' kinetica_bi/src/api/client.spec.ts` returns `1`
    - Spec for infoQuery has at least 6 `it(` calls (I1-I6) — count via grep within the new describe block
    - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    `infoQuery` callable from any frontend module with typed request/response. Plan 21-03 imports it. AbortSignal threading verified. Error mapping (401/403/502) routed through existing typed-error chain.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build InfoPopup.tsx presentation component + spec</name>
  <files>kinetica_bi/src/components/charts/InfoPopup.tsx, kinetica_bi/src/components/charts/InfoPopup.spec.tsx</files>
  <read_first>
    - .planning/phases/21-map-click-popup/21-CONTEXT.md (§ Popup positioning + container; § Loading + error UX; § Dismiss interactions; § Template rendering)
    - .planning/phases/21-map-click-popup/21-RESEARCH.md (§ Pattern 3 — useInfoSelectionStore consumer; § Pattern 6 — ESC + click-outside; § InfoPopup component sketch)
    - kinetica_bi/src/components/LayersModal.tsx (lines 71-77 ESC handler; line 168 click-outside; sticky modal-header pattern)
    - kinetica_bi/src/store/infoSelectionStore.ts (full file — full action contract; setActiveLayer signature is `(layerId: number)`)
    - kinetica_bi/src/lib/renderInfoTemplate.ts (Plan 21-01 output — RenderResult discriminated union)
    - kinetica_bi/src/api/client.ts:446-466 (DashboardLayerDto with info_enabled / info_columns / info_template)
    - kinetica_bi/__mocks__/zustand.ts (Zustand reset shim — automatically covers new consumers)
    - kinetica_bi/src/test/setup.ts (vi.mock("zustand") activation)
  </read_first>
  <behavior>
    Spec test cases (group under top-level `describe("InfoPopup", () => { ... })`):

    Header + body rendering:
    - Test H1: activeLayerId=null → component renders nothing (returns null); container has zero children
    - Test H2: activeLayerId=5, eligibleLayers=[id:5,id:8] → dropdown lists 2 options; "5" is selected
    - Test H3: dropdown order matches eligibleLayers prop order (caller-controlled stable order)
    - Test H4: clicking close X invokes onClose callback exactly once
    - Test H5: pressing Escape key invokes onClose exactly once
    - Test H6: clicking the overlay backdrop (outside popup body) invokes onClose; clicking the popup body does NOT (e.stopPropagation)
    - Test H7: dropdown change to a different layer id calls onLayerSwitch(newId); same-id selection does NOT call

    Body — template mode:
    - Test B1: entry.rows=[{a:1}], info_template="<b>{a}</b>" set on the active layer → renders `<b>1</b>` via dangerouslySetInnerHTML
    - Test B2: rows.length=2 with template → 2 rendered template instances appear in document
    - Test B3: entry.loading=true, entry.rows.length=0 → renders centered "Loading…" indicator (sticky header still visible)
    - Test B4: entry.loading=false, entry.rows.length=0, entry.error=null → renders empty-state "No records" message inside body
    - Test B5: entry.error="oops", entry.rows.length=0 → renders error text "oops" in body

    Body — kv mode:
    - Test B6: entry.rows=[{a:1, b:"x"}], entry.columns=["a","b"], info_template=null, info_columns=null → renders 2-row `<table>` with cells "a", "1", "b", "x"
    - Test B7: same row but info_columns='["b"]' → renders 1-row table with "b", "x" only

    Load more:
    - Test L1: entry.hasMore=true, entry.loading=false → "Load more" button visible; click invokes onLoadMore
    - Test L2: entry.hasMore=false → "Load more" button NOT in document
    - Test L3: entry.hasMore=true, entry.loading=true → "Load more" button is disabled; click does NOT invoke onLoadMore (button.disabled prevents click)

    Auto-dismiss on activeLayer leaving eligible set:
    - Test A1: render with activeLayerId=5 in eligibleLayers; rerender with eligibleLayers excluding id 5 → onClose invoked exactly once
    - Test A2: render with activeLayerId=5; rerender with same eligibleLayers (no change) → onClose NOT invoked

    Selector scoping (PITFALL S-02 regression):
    - Test S1: render with activeLayerId=5; mutate state[7] (other layer) via store action → InfoPopup does NOT re-render (assert via render-count spy on a memo'd inner component, OR assert `useInfoSelectionStore` selector function returns reference-stable value when state[7] mutates)
  </behavior>
  <action>
    Create `kinetica_bi/src/components/charts/InfoPopup.tsx`. Component signature:

    ```typescript
    /**
     * Phase 21 (POPUP-V14-02..05) — Map info popup presentation component.
     *
     * SCOPE: Pure presentation. Reads useInfoSelectionStore. Emits callbacks.
     *   - onClose: dismiss (close X | ESC | click-outside | active layer leaves set)
     *   - onLayerSwitch(layerId): user picked a different layer in dropdown
     *   - onLoadMore: user clicked the "Load more" footer button
     *
     * MOUNTING: This component is mounted inside an `ol/Overlay` element by Plan 21-03
     * MapChartRenderer. The popup container DOM lives outside React's normal tree (OL
     * imperatively appends the element ref to its DOM). Because of that, ESC handler
     * uses `window.addEventListener("keydown")` (mirrors LayersModal:71-77).
     *
     * RENDER MODE: When the active layer's `info_template` is non-null, each row renders
     * via the shared `renderInfoTemplate` helper (Plan 21-01) using
     * `dangerouslySetInnerHTML`. NO sanitization — locked at .planning/PROJECT.md Key
     * Decision: "Dashboard authors are privileged users (analogous to saved SQL queries).
     * Risk documented in PROJECT.md Key Decisions."
     *
     * STORE SELECTOR (PITFALL S-02 lock from Phase 12+):
     *   - activeLayerId: useInfoSelectionStore((s) => s.activeLayerId)
     *   - entry:         useInfoSelectionStore((s) => s.activeLayerId !== null
     *                                            ? s.state[s.activeLayerId] : null)
     *   - NEVER subscribe to s.state whole — fan-out re-renders on unrelated layer mutations.
     */
    import { useEffect, useMemo } from "react";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import { renderInfoTemplate } from "../../lib/renderInfoTemplate";
    import type { DashboardLayerDto } from "../../api/client";

    type Props = {
      /** Visible-enabled-non-WKB layers — derived by parent (Plan 21-03 MapChartRenderer eligibleLayers useMemo). Stable order by ascending position. */
      eligibleLayers: DashboardLayerDto[];
      /** Display-name resolver for dropdown options. Caller maps tableId → schema.name (mirrors LayersModal:82-99). */
      layerNameFor: (layer: DashboardLayerDto) => string;
      /** Dismiss — close X, ESC, click-outside, active-layer-leaves-set. Caller invokes useInfoSelectionStore.getState().reset() + Overlay.setPosition(undefined). */
      onClose: () => void;
      /** Dropdown selection changed (newId !== activeLayerId). Caller calls store.setActiveLayer(newId) + dispatches on-demand fetch. */
      onLayerSwitch: (layerId: number) => void;
      /** Load-more clicked. Caller calls store.setLoading(true) → infoQuery({ ..., page: entry.page+1 }) → store.appendPage / store.setError → store.setLoading(false). */
      onLoadMore: () => void;
    };

    export default function InfoPopup({ eligibleLayers, layerNameFor, onClose, onLayerSwitch, onLoadMore }: Props) {
      const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
      // PITFALL S-02 lock: scoped selector — NEVER s.state whole.
      const entry = useInfoSelectionStore((s) =>
        s.activeLayerId !== null ? s.state[s.activeLayerId] : null
      );
      const activeLayer = activeLayerId !== null
        ? eligibleLayers.find((l) => l.id === activeLayerId) ?? null
        : null;

      // ESC key dismiss — mirrors LayersModal.tsx:71-77.
      useEffect(() => {
        if (activeLayerId === null) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [activeLayerId, onClose]);

      // Auto-dismiss when active layer leaves eligible set (e.g. layer toggled invisible,
      // info_enabled flipped to 0, layer deleted, spatialMode flipped to 'wkb').
      // Set comparison via memo'd id Set — recomputes only when eligibleLayers identity changes.
      const eligibleIds = useMemo(
        () => new Set(eligibleLayers.map((l) => l.id)),
        [eligibleLayers]
      );
      useEffect(() => {
        if (activeLayerId !== null && !eligibleIds.has(activeLayerId)) {
          onClose();
        }
      }, [activeLayerId, eligibleIds, onClose]);

      if (activeLayerId === null || activeLayer === null) return null;

      const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newId = Number(e.target.value);
        if (newId !== activeLayerId) onLayerSwitch(newId);
      };

      // Click-outside dismiss: backdrop div onClick → onClose; popup body stops propagation.
      // Mirrors LayersModal.tsx:168 pattern.
      return (
        <div className="info-popup-backdrop" onClick={onClose}>
          <div className="info-popup" onClick={(e) => e.stopPropagation()}>
            <div className="info-popup-header">
              <select
                className="info-popup-layer-select"
                value={activeLayerId}
                onChange={handleDropdownChange}
                aria-label="Select layer"
              >
                {eligibleLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {layerNameFor(l)}
                  </option>
                ))}
              </select>
              <button
                className="info-popup-close"
                aria-label="Close"
                onClick={onClose}
              >
                &times;
              </button>
            </div>
            <div className="info-popup-body">
              {entry?.loading && (entry.rows.length === 0) && (
                <div className="info-popup-loading">Loading…</div>
              )}
              {entry && !entry.loading && entry.rows.length === 0 && !entry.error && (
                <div className="info-popup-empty">No records</div>
              )}
              {entry?.error && entry.rows.length === 0 && (
                <div className="info-popup-error">{entry.error}</div>
              )}
              {entry && entry.rows.length > 0 && (
                <div className="info-popup-rows">
                  {entry.rows.map((row, idx) => {
                    const result = renderInfoTemplate({
                      template: activeLayer.info_template,
                      columns: entry.columns,
                      row,
                      infoColumns: activeLayer.info_columns,
                    });
                    if (result.mode === "template") {
                      // NO SANITIZATION — locked at .planning/PROJECT.md Key Decision:
                      // "Dashboard authors are privileged users (analogous to saved SQL queries)."
                      return (
                        <div
                          key={idx}
                          className="info-popup-row info-popup-row-template"
                          dangerouslySetInnerHTML={{ __html: result.html }}
                        />
                      );
                    }
                    return (
                      <table key={idx} className="info-popup-row info-popup-row-kv">
                        <tbody>
                          {result.pairs.map(({ col, value }) => (
                            <tr key={col}>
                              <th>{col}</th>
                              <td>{formatKvValue(value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })}
                </div>
              )}
            </div>
            {entry?.hasMore && (
              <div className="info-popup-footer">
                <button
                  className="info-popup-load-more"
                  onClick={onLoadMore}
                  disabled={entry.loading}
                >
                  {entry.loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    /** kv-mode value formatter. Pure — no JSX. Coerces unknown to string for safe table cell rendering. */
    function formatKvValue(v: unknown): string {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }
    ```

    Then create `kinetica_bi/src/components/charts/InfoPopup.spec.tsx`. Use `@testing-library/react` (already a project dep — check existing MapChartRenderer.spec.tsx imports). Import `useInfoSelectionStore` and seed state via `useInfoSelectionStore.getState().setSelection(...)` / `setActiveLayer(...)` from within `act()` blocks.

    Spec structure:
    ```typescript
    import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
    import { render, screen, fireEvent, act } from "@testing-library/react";
    import InfoPopup from "./InfoPopup";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import type { DashboardLayerDto } from "../../api/client";

    // POPUP-V14-02..05 — InfoPopup presentation spec.
    // Reset shim from kinetica_bi/__mocks__/zustand.ts wipes the store between tests.

    function makeLayer(id: number, opts: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
      return {
        id,
        dashboard_id: 1,
        table_id: 100 + id,
        layer_type: "KineticaWms",
        position: id,
        config: { spatialMode: "latlon", lonColumn: "lon", latColumn: "lat" },
        info_enabled: 1,
        info_columns: null,
        info_template: null,
        created_at: "2026-05-08T00:00:00Z",
        updated_at: "2026-05-08T00:00:00Z",
        ...opts,
      };
    }

    describe("InfoPopup", () => {
      // ... H1-H7, B1-B7, L1-L3, A1-A2, S1
    });
    ```

    Append to `kinetica_bi/src/styles/global.css` AFTER the existing `.modal-*` block (after line 540 area). Add the following classes (CSS variables referenced are already defined):

    ```css
    /* Phase 21 (POPUP-V14-02..05): info popup chrome.
       Anchored variant of .modal-content. The .info-popup-backdrop is mounted INSIDE the
       ol/Overlay element (Plan 21-03), so it covers the popup's bounding box only — not the
       full viewport like .modal-overlay. */
    .info-popup-backdrop {
      /* Transparent backdrop — click-outside dismiss target. Sits over the popup body. */
      position: relative;
    }
    .info-popup {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      width: 360px;
      max-width: 480px;
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }
    .info-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      gap: 8px;
    }
    .info-popup-layer-select {
      flex: 1;
      min-width: 0;
      font-size: 13px;
    }
    .info-popup-close {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      color: var(--text-muted, #6b7280);
    }
    .info-popup-close:hover { color: inherit; }
    .info-popup-body {
      padding: 10px;
      overflow-y: auto;
      flex: 1 1 auto;
    }
    .info-popup-loading,
    .info-popup-empty,
    .info-popup-error {
      text-align: center;
      padding: 20px;
      color: var(--text-muted, #6b7280);
    }
    .info-popup-error { color: #b91c1c; }
    .info-popup-rows { display: flex; flex-direction: column; gap: 8px; }
    .info-popup-row { padding: 6px; border: 1px solid var(--border); border-radius: 4px; }
    .info-popup-row-kv { width: 100%; border-collapse: collapse; }
    .info-popup-row-kv th { text-align: left; padding: 2px 6px; font-weight: 600; vertical-align: top; }
    .info-popup-row-kv td { padding: 2px 6px; word-break: break-word; }
    .info-popup-footer {
      padding: 8px 10px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: center;
    }
    .info-popup-load-more {
      font-size: 12px;
      padding: 4px 12px;
    }
    .info-popup-load-more:disabled { opacity: 0.6; cursor: not-allowed; }
    ```

    Run:
    - `cd kinetica_bi && npx vitest run src/components/charts/InfoPopup.spec.tsx` — all tests green.
    - `cd kinetica_bi && npx tsc --noEmit` — exit 0.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/InfoPopup.spec.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/InfoPopup.tsx` exists
    - File `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` exists
    - `grep -c "export default function InfoPopup" kinetica_bi/src/components/charts/InfoPopup.tsx` returns `1`
    - `grep -c 'useInfoSelectionStore((s) =>' kinetica_bi/src/components/charts/InfoPopup.tsx` returns at least `2` (one for activeLayerId, one for entry — proves PITFALL S-02 scoped selectors)
    - `grep -c "s.state[s.activeLayerId]" kinetica_bi/src/components/charts/InfoPopup.tsx` returns at least `1` (scoped entry selector)
    - `grep -c 'e.key === "Escape"' kinetica_bi/src/components/charts/InfoPopup.tsx` returns `1` (ESC handler)
    - `grep -c 'e.stopPropagation()' kinetica_bi/src/components/charts/InfoPopup.tsx` returns at least `1` (click-outside guard)
    - `grep -c "dangerouslySetInnerHTML" kinetica_bi/src/components/charts/InfoPopup.tsx` returns `1` (template render path)
    - `grep -c "Dashboard authors are privileged users" kinetica_bi/src/components/charts/InfoPopup.tsx` returns at least `1` (no-sanitize lock cited inline)
    - `grep -c "renderInfoTemplate" kinetica_bi/src/components/charts/InfoPopup.tsx` returns at least `2` (import + call)
    - `grep -c "setActiveLayer(null)" kinetica_bi/src/components/charts/InfoPopup.tsx` returns `0` (forbidden — null path uses reset())
    - `grep -c "import.*sanitize\|DOMPurify" kinetica_bi/src/components/charts/InfoPopup.tsx` returns `0` (no sanitizer import)
    - Spec contains at least 16 `it(` invocations covering H1-H7 + B1-B7 + L1-L3 + A1-A2 + S1: `grep -c "it(" kinetica_bi/src/components/charts/InfoPopup.spec.tsx` returns ≥ `16`
    - `grep -c "POPUP-V14" kinetica_bi/src/components/charts/InfoPopup.spec.tsx` returns at least `1`
    - `grep -c '\.info-popup' kinetica_bi/src/styles/global.css` returns at least `8` (info-popup, backdrop, header, layer-select, close, body, loading, empty, error, rows, row, row-kv, footer, load-more — at least 8 of these classes)
    - `cd kinetica_bi && npx vitest run src/components/charts/InfoPopup.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Component renders against seeded store state in tests without an OL Map. Header dropdown wired. Body branches between template / kv / loading / empty / error correctly. Load-more visible only when hasMore=true and disabled during loading. ESC + click-outside + close-X all converge on onClose. Auto-dismiss fires when activeLayerId leaves eligibleLayers. CSS classes appended to global.css.
  </done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run src/api/client.spec.ts src/components/charts/InfoPopup.spec.tsx src/lib/renderInfoTemplate.spec.ts` — all green.
2. `cd kinetica_bi && npx tsc --noEmit` — exit 0.
3. No new dependencies in `kinetica_bi/package.json` (no DOMPurify, no sanitize-html).
4. InfoPopup imports zero from `MapChartRenderer.tsx` (decoupled — Plan 21-03 owns the integration direction).
</verification>

<success_criteria>
- `infoQuery(args, signal)` POSTs to `/api/info/query` with the locked Phase 18 contract
- AbortError propagates from a pre-aborted signal
- 401/403/502 throw the typed error chain (ReauthRequiredError / PermissionError / UpstreamError)
- InfoPopup renders nothing when `activeLayerId === null`
- InfoPopup uses scoped selectors (PITFALL S-02 — verified by greppable selector form)
- Template-mode rows use `dangerouslySetInnerHTML` with no sanitization (locked decision cited inline)
- KV-mode rows render a `<table>` with column-value pairs
- Load-more visible iff `hasMore=true`; disabled during `loading=true`
- Close X, ESC, click-outside, and activeLayer-leaves-set all converge on `onClose()`
</success_criteria>

<output>
After completion, create `.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md` documenting:
- Locked behaviors with line numbers (selector scoping, dangerouslySetInnerHTML site, ESC handler, click-outside)
- Test counts (≥16 InfoPopup + ≥6 infoQuery — report actual)
- CSS classes added (list)
- Any deviations (e.g., if executor inlined formatKvValue or restructured spec describes)
- Note that Plan 21-03 will mount this component inside ol/Overlay and pass `eligibleLayers` + `layerNameFor` props
</output>
