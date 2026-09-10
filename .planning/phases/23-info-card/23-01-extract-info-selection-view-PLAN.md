---
phase: 23-info-card
plan: 01
plan_id: "23-01"
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/components/charts/InfoSelectionView.tsx
  - kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx
  - kinetica_bi/src/components/charts/InfoPopup.tsx
  - kinetica_bi/src/components/charts/InfoPopup.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - CARD-V14-03
must_haves:
  truths:
    - "InfoSelectionView component renders dropdown header + records list + Load-more footer with NO popup chrome"
    - "InfoPopup wraps InfoSelectionView with anchored chrome (backdrop, close X, ESC, popup container)"
    - "All popup chrome tests (H4 close-X, H5 ESC, H6 backdrop click) still pass against InfoPopup"
    - "All popup body tests (H1-H3, H7, B1-B7, L1-L3, A1-A2, S1) now run against InfoSelectionView spec instead of InfoPopup spec"
    - "Body CSS classes use .info-selection-* namespace; popup chrome classes (.info-popup-backdrop, .info-popup, .info-popup-close, .info-popup-overlay-element) keep .info-popup-* names"
    - "Cross-phase column sort (alphabetical localeCompare) lives inside InfoSelectionView (single-source for both popup and card)"
    - "tsc --noEmit passes; no whole-store useInfoSelectionStore subscriptions added (PITFALL S-02 preserved)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      provides: "Shared body component (dropdown + records list + Load more) with PITFALL S-02 scoped selectors"
      min_lines: 100
    - path: "kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx"
      provides: "Body behavior spec (dropdown render, body modes, Load more, empty/loading/error, eligibility-leave, S-02)"
      min_lines: 200
    - path: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      provides: "Slim popup chrome wrapper (anchored container + close X + ESC + click-outside backdrop) wrapping InfoSelectionView"
    - path: "kinetica_bi/src/components/charts/InfoPopup.spec.tsx"
      provides: "Slimmed popup-chrome-only spec (H4/H5/H6 cases retained; body cases moved out)"
    - path: "kinetica_bi/src/styles/global.css"
      provides: "Renamed body classes (.info-selection-*); popup-only chrome classes preserved"
  key_links:
    - from: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      to: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      via: "JSX child (popup wrapper renders <InfoSelectionView ... />)"
      pattern: "InfoSelectionView"
    - from: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      to: "kinetica_bi/src/lib/renderInfoTemplate.ts"
      via: "import + per-row call"
      pattern: "renderInfoTemplate"
    - from: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      to: "kinetica_bi/src/store/infoSelectionStore.ts"
      via: "scoped selectors (activeLayerId + state[activeLayerId])"
      pattern: "useInfoSelectionStore"
---

<objective>
Extract the popup body (dropdown header + records list + Load-more footer + cross-phase column sort + auto-dismiss-on-eligibility-leave + PITFALL S-02 scoped selectors) from `InfoPopup.tsx` into a new shared `<InfoSelectionView />` component, slim `InfoPopup.tsx` down to chrome only (anchored container + close X + ESC + click-outside backdrop), migrate the affected spec cases, and rename body CSS classes from `.info-popup-*` to `.info-selection-*` (keeping popup-only chrome classes as-is).

Purpose: Without this extraction, the Info Card (Plan 23-03) cannot share the popup's body without duplicating ~100 lines of JSX + 3 effects + 2 scoped selectors — and any future fix to one surface would silently diverge from the other. The shared `<InfoSelectionView />` is the design north star locked in 23-CONTEXT.md § "Code-share with Phase 21" and 23-RESEARCH.md § "Pattern 1: Shared body component with chrome wrappers."

Output: Pure refactor — zero net behavior change for popup users. The popup still renders the same dropdown, records, Load-more, and dismisses the same ways; the body code now lives in a reusable component. The card (Plan 23-03) imports `<InfoSelectionView />` to render the same body inside a widget cell. NOTE: Plan 23-01 does NOT yet wire the on-demand fetch into `<InfoSelectionView />` — those handlers stay in `MapChartRenderer.tsx` for now, and the popup wrapper passes `onLayerSwitch` / `onLoadMore` callbacks through to the view exactly as it did pre-refactor. Plan 23-03 is responsible for moving the fetch logic into the view (after Plan 23-02 supplies the `useLastInfoClickContextStore` slice). This keeps Plan 23-01 a pure structural refactor with no behavior change.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/23-info-card/23-CONTEXT.md
@.planning/phases/23-info-card/23-RESEARCH.md
@.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md

@kinetica_bi/src/components/charts/InfoPopup.tsx
@kinetica_bi/src/components/charts/InfoPopup.spec.tsx
@kinetica_bi/src/lib/renderInfoTemplate.ts
@kinetica_bi/src/store/infoSelectionStore.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Contracts the executor needs. Extracted from existing codebase. -->

From kinetica_bi/src/components/charts/InfoPopup.tsx (current Props interface — pre-refactor):
```typescript
type Props = {
  eligibleLayers: DashboardLayerDto[];
  layerNameFor: (layer: DashboardLayerDto) => string;
  onClose: () => void;
  onLayerSwitch: (layerId: number) => void;
  onLoadMore: () => void;
};
```

From kinetica_bi/src/store/infoSelectionStore.ts:
```typescript
export type InfoSelectionEntry = {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};
// PITFALL S-02 scoped selectors (lock):
//   const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
//   const entry = useInfoSelectionStore((s) =>
//     s.activeLayerId !== null ? s.state[s.activeLayerId] : null);
// NEVER subscribe to s.state whole.
```

From kinetica_bi/src/lib/renderInfoTemplate.ts (consumed unchanged):
```typescript
export function renderInfoTemplate(args: {
  template: string | null;
  columns: string[];        // CALLER MUST PRE-SORT (Phase 22 cross-phase lock)
  row: Record<string, unknown>;
  infoColumns: string | null;
}): { mode: "template"; html: string } | { mode: "kv"; pairs: Array<{ col: string; value: unknown }> };
```

From kinetica_bi/src/api/client.ts:
```typescript
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  info_enabled: number;        // 0 | 1
  info_columns: string | null;
  info_template: string | null;
  // ...
};
```

NEW Props interface for `<InfoSelectionView />` (Plan 23-01 locks; Plan 23-03 may extend with `spatialContext` / `resolveTable` / `tables`):
```typescript
type InfoSelectionViewProps = {
  eligibleLayers: DashboardLayerDto[];
  layerNameFor: (layer: DashboardLayerDto) => string;
  /** Caller dispatches dropdown-switch (e.g. fetch + setActiveLayer). View calls this on dropdown change when newId !== activeLayerId. Plan 23-03 will move this fetch logic INTO the view; for now the popup wrapper supplies it. */
  onLayerSwitch: (layerId: number) => void;
  /** Caller dispatches Load more (fetch + appendPage). Plan 23-03 will move this fetch logic INTO the view; for now the popup wrapper supplies it. */
  onLoadMore: () => void;
  /** Called when active layer leaves eligibleLayers set. Popup uses this for chrome dismiss; card uses it for store reset. */
  onActiveLayerIneligible: () => void;
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rename .info-popup-* body classes to .info-selection-* in global.css (RED-GREEN: existing InfoPopup spec must still pass after class rename if popup uses the renamed classes)</name>
  <files>kinetica_bi/src/styles/global.css, kinetica_bi/src/components/charts/InfoPopup.tsx</files>
  <read_first>
    - kinetica_bi/src/styles/global.css (lines 1928-2003 for the .info-popup-* body block; lines 2008-2095 stay untouched — those are Phase 22 layer/widget config classes, NOT body classes)
    - kinetica_bi/src/components/charts/InfoPopup.tsx (current className references at lines 87, 88, 89, 91, 103, 110, 112, 115, 118, 121, 141, 147, 163, 165)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Q3 (R3): CSS rename diff" (selector inventory table at lines 707-740)
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx (any querySelector / className assertions)
  </read_first>
  <behavior>
    - Test 1 (RED initially, then GREEN after rename): InfoPopup spec H1-H7 / B1-B7 / L1-L3 / A1-A2 / S1 still pass after rename. The body classes are now .info-selection-* but InfoPopup.tsx (still owning the body in this task — extraction is Task 2) uses the renamed classes consistently.
    - Test 2: A grep for `.info-popup-(header|layer-select|body|loading|empty|error|rows|row|row-kv|footer|load-more|row-template)` against global.css returns ZERO matches.
    - Test 3: A grep for `.info-popup-(backdrop|close|overlay-element)` against global.css returns >=1 match each (popup chrome preserved).
    - Test 4: A grep for `.info-selection-(header|layer-select|body|loading|empty|error|rows|row|row-kv|footer|load-more|row-template)` against global.css returns >=1 match each.
  </behavior>
  <action>
    Apply the rename diff in `kinetica_bi/src/styles/global.css` lines 1928-2003 EXACTLY as follows. The popup chrome classes (3 selectors) stay; the body classes (11 selectors + 1 marker class) rename. Phase 22 `.info-popup-config-*` classes (lines 2008-2095) are OUT OF SCOPE for this rename — they are layer/widget config form classes, not popup body classes; do NOT touch them.

    Selector-by-selector rename map (verbatim from 23-RESEARCH.md Q3):

    | Line (current) | OLD selector | NEW selector | Reason |
    |----------------|--------------|--------------|--------|
    | 1931 | `.info-popup-backdrop` | **STAYS** `.info-popup-backdrop` | popup chrome (click-outside dismiss target — no analog in card) |
    | 1935 | `.info-popup` | **STAYS** `.info-popup` (popup chrome — anchored container; outer wrapper) — NOTE: this is intentionally kept on the popup chrome wrapper. The body root inside `<InfoSelectionView />` will use a NEW class `.info-selection` (not yet present in CSS — Task 2 adds it inline as a flex container OR may inherit from `.info-popup`'s styles via a SHARED rule). For Task 1, just RENAME the body-specific selectors; the `.info-popup` outer-container styles stay because popup outer wrapper still uses `.info-popup`. | popup chrome |
    | 1948 | `.info-popup-header` | `.info-selection-header` | shared body |
    | 1956 | `.info-popup-layer-select` | `.info-selection-layer-select` | shared body |
    | 1961 | `.info-popup-close` | **STAYS** `.info-popup-close` | popup chrome (close X — no analog in card) |
    | 1970 | `.info-popup-close:hover` | **STAYS** | popup chrome |
    | 1971 | `.info-popup-body` | `.info-selection-body` | shared body |
    | 1976-1978 | `.info-popup-loading, .info-popup-empty, .info-popup-error` (combined selector) | `.info-selection-loading, .info-selection-empty, .info-selection-error` | shared body |
    | 1983 | `.info-popup-error` (color override) | `.info-selection-error` | shared body |
    | 1984 | `.info-popup-rows` | `.info-selection-rows` | shared body |
    | 1985 | `.info-popup-row` | `.info-selection-row` | shared body |
    | 1986-1988 | `.info-popup-row-kv` (table/th/td variants) | `.info-selection-row-kv` | shared body |
    | 1989 | `.info-popup-footer` | `.info-selection-footer` | shared body |
    | 1995 | `.info-popup-load-more` | `.info-selection-load-more` | shared body |
    | 1999 | `.info-popup-load-more:disabled` | `.info-selection-load-more:disabled` | shared body |
    | 2003 | `.info-popup-overlay-element` | **STAYS** `.info-popup-overlay-element` | popup chrome (ol/Overlay wrapper element — no analog in card) |

    Plus update the 14-class-references in `kinetica_bi/src/components/charts/InfoPopup.tsx` (className strings ONLY — no JSX structure change in this task; structure change happens in Task 2):

    - Line 87: `className="info-popup-backdrop"` — STAYS
    - Line 88: `className="info-popup"` — STAYS (outer popup container)
    - Line 89: `className="info-popup-header"` → `className="info-selection-header"`
    - Line 91: `className="info-popup-layer-select"` → `className="info-selection-layer-select"`
    - Line 103: `className="info-popup-close"` — STAYS
    - Line 110: `className="info-popup-body"` → `className="info-selection-body"`
    - Line 112: `className="info-popup-loading"` → `className="info-selection-loading"`
    - Line 115: `className="info-popup-empty"` → `className="info-selection-empty"`
    - Line 118: `className="info-popup-error"` → `className="info-selection-error"`
    - Line 121: `className="info-popup-rows"` → `className="info-selection-rows"`
    - Line 141: `className="info-popup-row info-popup-row-template"` → `className="info-selection-row info-selection-row-template"`
    - Line 147: `className="info-popup-row info-popup-row-kv"` → `className="info-selection-row info-selection-row-kv"`
    - Line 163: `className="info-popup-footer"` → `className="info-selection-footer"`
    - Line 165: `className="info-popup-load-more"` → `className="info-selection-load-more"`

    For `InfoPopup.spec.tsx` (and `MapChartRenderer.spec.tsx` if relevant) — update any querySelector that targeted a renamed class. Per 23-RESEARCH.md Q3, only `container.querySelector(".info-popup")` (line 134 of spec) targets a STAYS class — no spec change needed for that. Other spec class-name queries should be migrated to the new `.info-selection-*` names. Run the spec after rename and fix any that fail.

    Commit RED→GREEN sequence:
    1. RED: pure rename of CSS selectors only (TSX classNames not yet updated) → spec fails because TSX still references `.info-popup-body`/`.info-popup-rows` etc. but CSS has renamed. Confirm at least one spec assertion fails.
    2. GREEN: update TSX className strings + spec selectors to match → spec passes.
    Single atomic commit acceptable (the RED state is purely transitional during one editor session); use commit message `refactor(23-01): rename .info-popup-* body classes to .info-selection-* (Phase 23 P01 Task 1)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run InfoPopup.spec</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "\.info-popup-(header|layer-select|body|loading|empty|error|rows|row[^-]|row-kv|footer|load-more|row-template)" kinetica_bi/src/styles/global.css` returns ZERO matches
    - `grep -E "\.info-popup-(backdrop|close|overlay-element)" kinetica_bi/src/styles/global.css` returns >=3 matches (chrome classes preserved)
    - `grep -E "\.info-selection-(header|layer-select|body|loading|empty|error|rows|row|row-kv|footer|load-more|row-template)" kinetica_bi/src/styles/global.css` returns >=12 matches
    - `grep -E "info-popup-(header|layer-select|body|loading|empty|error|rows|row[^-]|row-kv|footer|load-more|row-template)" kinetica_bi/src/components/charts/InfoPopup.tsx` returns ZERO matches (TSX className strings updated)
    - `grep -E "info-popup-(backdrop|close)" kinetica_bi/src/components/charts/InfoPopup.tsx` returns >=2 matches (popup chrome classes still referenced)
    - `cd kinetica_bi && npm test -- --run InfoPopup.spec` exits 0 (all H/B/L/A/S tests still pass; only class names changed, no behavior change)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>InfoPopup.tsx renders the same JSX structure as before (no extraction yet — Task 2's job) but uses `.info-selection-*` class names for body elements; popup chrome (`.info-popup-backdrop`, `.info-popup`, `.info-popup-close`, `.info-popup-overlay-element`) keeps original names; all existing InfoPopup specs still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extract InfoSelectionView from InfoPopup.tsx — popup wraps view; specs split (RED: new spec asserts shared-body behaviors against InfoSelectionView)</name>
  <files>kinetica_bi/src/components/charts/InfoSelectionView.tsx, kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx, kinetica_bi/src/components/charts/InfoPopup.tsx, kinetica_bi/src/components/charts/InfoPopup.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/InfoPopup.tsx (post-Task-1 — body classes already renamed to `.info-selection-*`)
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx (full file — H1-H7, B1-B7, L1-L3, A1-A2, S1 tests at lines 47, 54, 73, 90, 106, 122, 144, 167, 184, 203, 214, 229, 239, 259, 281, 299, 314, 336, 359, 377)
    - kinetica_bi/src/store/infoSelectionStore.ts (PITFALL S-02 scoped-selector contract at header lines 17-19; setActiveLayer signature locked at lines 70 — number not number|null; reset() lock at 168-170)
    - kinetica_bi/src/lib/renderInfoTemplate.ts (full file — pure helper; caller must pre-sort columns)
    - kinetica_bi/src/api/client.ts (DashboardLayerDto shape at lines 450-466)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Q2 (R2): InfoSelectionView minimal prop interface" (test migration table at lines 670-686)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Pattern 1: Shared body component" (lines 195-237)
  </read_first>
  <behavior>
    InfoSelectionView spec (NEW) — all body cases relocated from InfoPopup spec, plus the eligibility-leave callback case:
    - Test V1: renders nothing when activeLayerId is null (was H1).
    - Test V2: renders dropdown with 2 options; active layer selected; option order matches eligibleLayers prop order (was H2 + H3 combined).
    - Test V3: dropdown change to different layer calls onLayerSwitch with new id; same-id no-op (was H7) — view's onChange handler must filter out same-id events.
    - Test V4: template mode renders substituted HTML row using dangerouslySetInnerHTML; two rows render two template instances (was B1 + B2).
    - Test V5: loading with no rows renders Loading indicator; header remains visible (was B3).
    - Test V6: no rows + no loading + no error renders "No records" empty state (was B4).
    - Test V7: error with no rows renders error text (was B5).
    - Test V8: kv mode (info_template=null) renders KV table with all columns; columns sorted alphabetically (was B6) — assert `<th>` order is alphabetical even when `entry.columns` is unsorted.
    - Test V9: info_columns filters kv table to specified columns only (was B7).
    - Test V10: Load more visible when hasMore=true; click calls onLoadMore (was L1).
    - Test V11: Load more absent when hasMore=false (was L2).
    - Test V12: Load more disabled during loading; click does not call onLoadMore (was L3).
    - Test V13: when active layer leaves eligibleLayers set, view calls onActiveLayerIneligible callback exactly once (was A1; renamed from onClose to onActiveLayerIneligible per new prop contract).
    - Test V14: does NOT call onActiveLayerIneligible when eligibleLayers identity changes but active layer still in set (was A2).
    - Test V15 (PITFALL S-02 regression): mutating an unrelated layer's state via the store does NOT cause InfoSelectionView body to re-render (was S1).
    - Test V16 (NEW — cross-phase column sort): when entry.columns is `["zebra", "apple", "mango"]`, the kv mode `<th>` order is `apple → mango → zebra` (alphabetical localeCompare).

    InfoPopup spec (SLIM) — chrome-only cases retained:
    - Test H4: clicking close X calls onClose exactly once.
    - Test H5: pressing Escape calls onClose exactly once.
    - Test H6: clicking backdrop calls onClose; clicking popup body does not.
    - Test H1 simplified to: when activeLayerId is null, popup wrapper renders nothing (the wrapper short-circuits before mounting InfoSelectionView OR the wrapper-level guard prevents the popup container from rendering — pick one and assert it directly).
    - All other H/B/L/A/S tests REMOVED from InfoPopup.spec.tsx — they live in InfoSelectionView.spec.tsx.
  </behavior>
  <action>
    Step 1: Create `kinetica_bi/src/components/charts/InfoSelectionView.tsx` with EXACTLY this prop interface (locked per 23-RESEARCH.md Q2):

    ```tsx
    import { useEffect, useMemo } from "react";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import { renderInfoTemplate } from "../../lib/renderInfoTemplate";
    import type { DashboardLayerDto } from "../../api/client";

    type Props = {
      /** Eligibility list. Caller (popup or card wrapper) computes with its own scoping rule. Stable order (popup: by position via includedLayers; card: by position via dashboard layers). */
      eligibleLayers: DashboardLayerDto[];
      /** Display-name resolver for dropdown options. */
      layerNameFor: (layer: DashboardLayerDto) => string;
      /** Dropdown switch dispatch — caller decides whether to fetch / setActiveLayer. View only fires when newId !== activeLayerId. */
      onLayerSwitch: (layerId: number) => void;
      /** Load-more dispatch — caller decides whether to fetch / appendPage. */
      onLoadMore: () => void;
      /** Called when active layer leaves eligibleLayers (e.g. info_enabled flipped to 0, layer deleted, spatialMode flipped to wkb). Popup uses this to dismiss; card uses it to reset the store and render empty state. */
      onActiveLayerIneligible: () => void;
    };

    export default function InfoSelectionView({ eligibleLayers, layerNameFor, onLayerSwitch, onLoadMore, onActiveLayerIneligible }: Props) {
      // PITFALL S-02 lock: scoped selectors. NEVER subscribe to s.state whole.
      const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
      const entry = useInfoSelectionStore((s) =>
        s.activeLayerId !== null ? s.state[s.activeLayerId] : null
      );
      const activeLayer = activeLayerId !== null
        ? eligibleLayers.find((l) => l.id === activeLayerId) ?? null
        : null;

      // Auto-callback when active layer leaves eligibleLayers — single behavior, two surfaces.
      // Popup wrapper supplies onActiveLayerIneligible = () => { reset(); overlay.setPosition(undefined); }
      // Card wrapper supplies onActiveLayerIneligible = () => useInfoSelectionStore.getState().reset()
      const eligibleIds = useMemo(
        () => new Set(eligibleLayers.map((l) => l.id)),
        [eligibleLayers]
      );
      useEffect(() => {
        if (activeLayerId !== null && !eligibleIds.has(activeLayerId)) {
          onActiveLayerIneligible();
        }
      }, [activeLayerId, eligibleIds, onActiveLayerIneligible]);

      if (activeLayerId === null || activeLayer === null) return null;

      const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newId = Number(e.target.value);
        if (newId !== activeLayerId) onLayerSwitch(newId);
      };

      return (
        <>
          <div className="info-selection-header">
            <select
              className="info-selection-layer-select"
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
          </div>
          <div className="info-selection-body">
            {entry?.loading && (entry.rows.length === 0) && (
              <div className="info-selection-loading">Loading…</div>
            )}
            {entry && !entry.loading && entry.rows.length === 0 && !entry.error && (
              <div className="info-selection-empty">No records</div>
            )}
            {entry?.error && entry.rows.length === 0 && (
              <div className="info-selection-error">{entry.error}</div>
            )}
            {entry && entry.rows.length > 0 && (
              <div className="info-selection-rows">
                {entry.rows.map((row, idx) => {
                  // Phase 22 cross-phase lock: caller alphabetically sorts columns BEFORE renderInfoTemplate
                  // so KV-mode column order = ChipCombobox picker order. Lives HERE so both popup and card inherit it.
                  const sortedColumns = [...entry.columns].sort((a, b) => a.localeCompare(b));
                  const result = renderInfoTemplate({
                    template: activeLayer.info_template,
                    columns: sortedColumns,
                    row,
                    infoColumns: activeLayer.info_columns,
                  });
                  if (result.mode === "template") {
                    // NO SANITIZATION — locked at .planning/PROJECT.md Key Decision (v1.4 HTML template policy):
                    // "Dashboard authors are privileged users (analogous to saved SQL queries)."
                    return (
                      <div
                        key={idx}
                        className="info-selection-row info-selection-row-template"
                        dangerouslySetInnerHTML={{ __html: result.html }}
                      />
                    );
                  }
                  return (
                    <table key={idx} className="info-selection-row info-selection-row-kv">
                      <tbody>
                        {result.pairs.map(({ col, value }) => (
                          <tr key={col}>
                            <th scope="row">{col}</th>
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
            <div className="info-selection-footer">
              <button
                className="info-selection-load-more"
                onClick={onLoadMore}
                disabled={entry.loading}
              >
                {entry.loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      );
    }

    function formatKvValue(v: unknown): string {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }
    ```

    Step 2: Slim `kinetica_bi/src/components/charts/InfoPopup.tsx` to chrome only:

    ```tsx
    import { useEffect } from "react";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import InfoSelectionView from "./InfoSelectionView";
    import type { DashboardLayerDto } from "../../api/client";

    type Props = {
      eligibleLayers: DashboardLayerDto[];
      layerNameFor: (layer: DashboardLayerDto) => string;
      onClose: () => void;
      onLayerSwitch: (layerId: number) => void;
      onLoadMore: () => void;
    };

    export default function InfoPopup({ eligibleLayers, layerNameFor, onClose, onLayerSwitch, onLoadMore }: Props) {
      // Subscribe just enough to know when to render-suppress AND to drive ESC handler dep array.
      // PITFALL S-02 lock: scoped selector.
      const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);

      // ESC key dismiss — mirrors LayersModal.tsx:71-77.
      useEffect(() => {
        if (activeLayerId === null) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [activeLayerId, onClose]);

      // Suppress popup chrome entirely when nothing is selected.
      if (activeLayerId === null) return null;

      // Click-outside backdrop dismiss; close X dismiss.
      // Inner stopPropagation prevents body clicks from bubbling to backdrop.
      return (
        <div className="info-popup-backdrop" onClick={onClose}>
          <div className="info-popup" onClick={(e) => e.stopPropagation()}>
            <button
              className="info-popup-close"
              aria-label="Close"
              onClick={onClose}
            >
              &times;
            </button>
            <InfoSelectionView
              eligibleLayers={eligibleLayers}
              layerNameFor={layerNameFor}
              onLayerSwitch={onLayerSwitch}
              onLoadMore={onLoadMore}
              onActiveLayerIneligible={onClose}
            />
          </div>
        </div>
      );
    }
    ```

    NOTE — the popup's CSS layout previously mounted the dropdown <select> INSIDE `.info-popup-header`, with the close-X also inside that header (current InfoPopup.tsx lines 89-108). Post-refactor, the close-X is OUTSIDE InfoSelectionView (it's chrome) and InfoSelectionView renders its own `.info-selection-header` containing only the dropdown. The close-X needs visual placement. The simplest layout is: close-X positioned absolutely top-right of `.info-popup` container; InfoSelectionView's `.info-selection-header` flows below it. This may require minor CSS tweaks to `.info-popup-close` (add `position: absolute; top: 8px; right: 8px;` if not already absolutely positioned). VERIFY by reading lines 1961-1969 of `kinetica_bi/src/styles/global.css` (the existing `.info-popup-close` rule) — if it's already absolutely positioned or has no layout-side-effect, no CSS change needed; if not, add the absolute positioning. Adjust at executor's discretion to keep the existing visual appearance.

    Step 3: Create `kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` with all 16 tests (V1-V16) listed in `<behavior>` above. Use the existing `InfoPopup.spec.tsx` as a template — copy each H/B/L/A/S test that's listed in the migration table, rename `onClose` → `onActiveLayerIneligible` where applicable (test V13/V14), update import to `InfoSelectionView` (default export), and update class-name queries from `.info-popup-*` to `.info-selection-*` to match the new namespace.

    Step 4: Slim `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` to ONLY tests H1, H4, H5, H6:
    - Delete tests H2, H3, H7 (moved to V2, V3 in InfoSelectionView spec).
    - Delete tests B1-B7 (moved to V4-V9).
    - Delete tests L1-L3 (moved to V10-V12).
    - Delete tests A1-A2 (moved to V13-V14; renamed callback prop).
    - Delete test S1 (moved to V15).
    - Keep H1 but simplify to: `expect(container.firstChild).toBeNull()` when activeLayerId === null.
    - Keep H4 (close X click).
    - Keep H5 (ESC dismiss).
    - Keep H6 (backdrop click vs body click).

    Step 5: Run `cd kinetica_bi && npm test` — all migrated specs must be GREEN. Run `cd kinetica_bi && npx tsc --noEmit` — must exit 0.

    Commit message: `refactor(23-01): extract InfoSelectionView from InfoPopup; split specs (Phase 23 P01 Task 2)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run "InfoSelectionView.spec|InfoPopup.spec"</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/InfoSelectionView.tsx` exists
    - File `kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` exists
    - `grep -c "^  it(" kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` returns >=14 (16 tests V1-V16; allow 2 to be combined or skipped if helpers force consolidation)
    - `grep -c "^  it(" kinetica_bi/src/components/charts/InfoPopup.spec.tsx` returns 4 (H1, H4, H5, H6 only — all body tests removed)
    - `grep "useInfoSelectionStore" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=1 match (scoped selectors used)
    - `grep -E "useInfoSelectionStore\(\)" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns ZERO matches (no whole-store subscription — PITFALL S-02 lock)
    - `grep -E "useInfoSelectionStore\(\)" kinetica_bi/src/components/charts/InfoPopup.tsx` returns ZERO matches
    - `grep "InfoSelectionView" kinetica_bi/src/components/charts/InfoPopup.tsx` returns >=1 match (popup wraps view)
    - `grep "renderInfoTemplate" kinetica_bi/src/components/charts/InfoPopup.tsx` returns ZERO matches (template logic moved out of popup)
    - `grep "renderInfoTemplate" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=1 match (template logic in view)
    - `grep -E "localeCompare|\.sort" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=1 match (cross-phase column sort lives in view)
    - `grep -E "localeCompare|\\[\\.\\.\\.entry\\.columns\\]\\.sort" kinetica_bi/src/components/charts/InfoPopup.tsx` returns ZERO matches (sort moved out of popup)
    - `grep "info-popup-backdrop\|info-popup-close\|info-popup\"" kinetica_bi/src/components/charts/InfoPopup.tsx` returns >=3 matches (popup chrome classes still in popup wrapper)
    - `grep "info-popup-" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns ZERO matches (NO popup chrome classes in shared view)
    - `cd kinetica_bi && npm test -- --run "InfoSelectionView.spec|InfoPopup.spec"` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Full regression: `cd kinetica_bi && npm test` exits 0 (no other spec broken; MapChartRenderer.spec.tsx must still pass — its popup-related cases (P1-P14) are unaffected because MapChartRenderer.tsx still owns handleLayerSwitch/handleLoadMore/handleClose and passes them as props to <InfoPopup>)
  </acceptance_criteria>
  <done>
    `<InfoSelectionView />` is a standalone component owning the dropdown header + records list + Load-more footer + auto-eligibility-leave callback + cross-phase column sort + PITFALL S-02 scoped selectors. `<InfoPopup />` is now a thin chrome wrapper (backdrop, close X, ESC handler) that renders `<InfoSelectionView />` inside. The 4 popup-chrome tests pass against the slim popup spec; the 16 body-behavior tests pass against the new view spec. `MapChartRenderer.tsx` continues to own `handleLayerSwitch` / `handleLoadMore` / `handleClose` and threads them into `<InfoPopup>` via existing props — Plan 23-01 makes ZERO changes to `MapChartRenderer.tsx`. Plan 23-03 will move those handlers into the view; Plan 23-01 is a pure structural refactor.
  </done>
</task>

</tasks>

<verification>
- Frontend regression: `cd kinetica_bi && npm test` exits 0
- TypeScript: `cd kinetica_bi && npx tsc --noEmit` exits 0
- Class rename consistency: no `.info-popup-(header|layer-select|body|loading|empty|error|rows|row|row-kv|footer|load-more|row-template)` remaining in CSS or any TSX/spec file
- Popup chrome classes preserved: `.info-popup-backdrop`, `.info-popup`, `.info-popup-close`, `.info-popup-overlay-element` all still defined in CSS and referenced in InfoPopup.tsx
- View is decoupled from OL: `grep -E "ol/|openlayers|mapRef" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns ZERO matches
</verification>

<success_criteria>
1. `kinetica_bi/src/components/charts/InfoSelectionView.tsx` exists, exports a default-export React component, owns the dropdown + body + Load-more JSX, owns the auto-eligibility-leave effect, owns the cross-phase column sort, uses PITFALL S-02 scoped selectors. Lines >= 100.
2. `kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` exists, contains >= 14 `it(...)` test blocks covering V1-V16 (allow 2 merged), all GREEN.
3. `kinetica_bi/src/components/charts/InfoPopup.tsx` is slimmed to chrome wrapper: backdrop click handler, close X button, ESC key effect, renders `<InfoSelectionView />` as child. No `renderInfoTemplate` import. No `entry.columns.sort` call. No `eligibleIds` Set memo. No body JSX (.info-selection-rows, .info-selection-row-kv, etc. live in InfoSelectionView only).
4. `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` slimmed to 4 chrome-only tests (H1, H4, H5, H6), all GREEN.
5. `kinetica_bi/src/styles/global.css` body classes renamed to `.info-selection-*`; popup chrome classes (`.info-popup-backdrop`, `.info-popup`, `.info-popup-close`, `.info-popup-overlay-element`) preserved.
6. `cd kinetica_bi && npx tsc --noEmit` exits 0.
7. `cd kinetica_bi && npm test` exits 0 (no other spec broken).
</success_criteria>

<output>
After completion, create `.planning/phases/23-info-card/23-01-extract-info-selection-view-SUMMARY.md` capturing: extraction site (which lines moved from InfoPopup.tsx to InfoSelectionView.tsx), spec test counts (V1-V16 + remaining H1/H4/H5/H6), CSS rename diff (selectors renamed vs preserved), AbortController status (still in MapChartRenderer for now — Plan 23-03 will move), and any deviations from the plan with rationale.
</output>
