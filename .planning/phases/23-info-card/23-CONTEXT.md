# Phase 23: info-card - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Register a new 9th chart type `info-card` whose renderer is a popup-mirror inside a widget grid cell. The card subscribes to the same `useInfoSelectionStore` as the popup, has its own in-widget layer dropdown that switches layers (and fetches on demand), its own Load-more button, and renders records via the same `renderInfoTemplate` helper Phase 21 established. Card and popup are siblings — both can populate the store; both reactively reflect each other's mutations.

**User-direct intent (locked):** "The card should show the exact same thing as the info popup on the map but in the card. This can serve as an alternative if the user prefers to show the popup in a separate visualization rather than on the map. All behavior should be the same as the popup too." → The card is a popup mirrored in a widget; UI parity with the popup is the design north star.

**In scope:**
- Register `info-card` in the chart-type registry — new file `kinetica_bi/src/components/charts/definitions/info-card.ts` invoking `registerChartType(...)`; called from `definitions/index.ts` `registerAllChartTypes()`. Picker icon, label "Info Card", `usesAggregation: false`, `supportsDrillDown: false` (info orthogonal to filter — Phase 21 lock), `defaultConfig: {}`, `fields: []`, no `CustomConfigPanel`
- New `WidgetRenderer.tsx` early-return branch for `widget.type === "info-card"` (mirrors the map and records short-circuit pattern)
- New `kinetica_bi/src/components/charts/InfoCardRenderer.tsx` (or equivalent) — the renderer component subscribed to `useInfoSelectionStore` + `useDashboardLayersStore`
- **Refactor Phase 21's `InfoPopup.tsx`** to extract a shared `<InfoSelectionView />` component (dropdown band + records list + Load-more footer + render path). Both popup and card mount this view; chrome differs (popup wraps with anchored-tail + close X + ESC; card wraps with widget chrome). Phase 21's specs split — `InfoPopup.spec.tsx` keeps popup-chrome cases; `InfoSelectionView.spec.tsx` (new) covers the shared behaviors; `InfoCardRenderer.spec.tsx` covers card-chrome and card-only edges
- **Refactor Phase 21's CSS** from `.info-popup-*` to neutral `.info-selection-*` namespace; popup wrapper keeps `.info-popup-*` for the anchored-tail / close-X / overlay-onClick chrome; card wrapper uses widget chrome only. Both call into shared `.info-selection-*` for the body
- Card's in-widget dropdown lists ALL dashboard layers (`useDashboardLayersStore`) where `info_enabled === 1 AND derived spatialMode !== "wkb"`, regardless of which map widget owns them or whether a map currently has them visible — dashboard-scoped, not map-widget-scoped
- Card's dropdown-switch fires `POST /api/info/query` for the new layer when `state[newLayerId]` is undefined (mirrors Phase 21 popup on-demand fetch). Card and popup are now BOTH info-query callers
- Card's Load-more button fires `appendPage` POST identically to popup's
- Internal scroll: card body scrolls when records overflow the widget cell. Sticky dropdown header at top of body; sticky Load-more footer at bottom
- Empty state: literal copy `Click a point on the map to see details` (ROADMAP verbatim) when `state[activeLayerId]` is empty, when `activeLayerId` is null, when configured layer is no longer in dashboard, or when `info_enabled` was flipped off — same neutral copy in all four cases (no warning variants)
- Spec coverage: chart-type registry registration, dropdown layer source filtering (`info_enabled` + spatialMode), dropdown-switch on-demand fetch path, Load-more append path, KV/template render parity with popup (use shared `<InfoSelectionView />` testbed where possible), empty state, store subscription correctness
- **Update PROJECT.md Key Decisions section** to reflect the relaxed pure-consumer lock — card and popup both call `POST /api/info/query`. The original lock prevented arbitrary widgets from fetching; the new lock is "only `<InfoSelectionView />` consumers (popup + card) can fetch info-queries; bar/line/pie/etc. cannot subscribe-to-fetch"
- **Update STATE.md "Key v1.4 Architecture Decisions"** with the new pure-consumer interpretation

**Out of scope (other phases / deferred):**
- Per-card widget config panel (no `CustomConfigPanel`, no fields beyond defaults — locked "card is not configured per layer")
- Per-card title field — deferred; revisit if UAT shows authors want to label cards distinctly
- Per-card filter on dropdown contents (e.g., "this card only shows Buildings layer") — not requested; cards mirror dashboard scope verbatim
- Drill-down on row click in card body — Phase 21 lock (info orthogonal to filter); `supportsDrillDown: false` enforced via the registry definition
- Hover-preview integration on the card — out of v1.4 (HOVER-V2-01 deferred)
- URL/localStorage persistence of card state — PERSIST-V2-01/02 deferred
- Multiple cards rendering different selections concurrently — single dashboard-global `activeLayerId` invariant from Phase 20 means every card on a dashboard agrees on the active layer; "two cards showing different layers simultaneously" requires a store-shape change deferred to v2
- Per-widget kill-switch on card — n/a; card has no map widget binding, no `infoEnabled` widget config, no listener-registration semantics. Card always renders (subject to empty-state)
- VERIFY-V14-01 (Phase 24 verification work)

</domain>

<decisions>
## Implementation Decisions

### Card identity & registry shape

- Chart type identifier: `info-card` (kebab-case, matches existing `records`, `bignumber`, `line` etc.)
- Label: `Info Card` (title-cased for the picker)
- Icon: short token (Claude's discretion — recommend `IC` to match existing conventions like `B`, `L`, `M`, `R`)
- `usesAggregation: false` — no SQL aggregation path. Mirrors `map` and `records` precedent
- `supportsDrillDown: false` — Phase 21 lock; info-popup interactions are orthogonal to the filter pipeline. Row clicks in the card body do NOT dispatch to `useFilterStore`
- `defaultConfig: {}` — empty object. No `title`, no fields. Card renders entirely from `useInfoSelectionStore` + `useDashboardLayersStore`
- `fields: []` — empty array. Generic field renderer has nothing to show. ChartConfigPanel's per-type config area renders an info note: "No configuration — Info Card mirrors the map info popup" (or equivalent placeholder; planner to decide exact copy)
- `CustomConfigPanel` undefined — no per-type panel needed
- Registration: new file `kinetica_bi/src/components/charts/definitions/info-card.ts` exporting a default `register()` function; imported and called from `definitions/index.ts` alongside the 8 existing types

### Layer subscription contract & dropdown source

- The card has an in-widget layer dropdown (NOT in a config panel). Same UI affordance as the popup — sticky header band at top of card body
- Dropdown source: `useDashboardLayersStore.layers.filter(l => l.info_enabled === 1 && deriveSpatialMode(l) !== "wkb")`. Dashboard-scoped — independent of which map widget owns each layer or whether any map currently has the layer visible
- The card and popup share `useInfoSelectionStore` state. Switching the dropdown in EITHER surface fires the same store mutations (`setActiveLayer` → wipe prior layer's entry, then `setLoading` → `setSelection` → `setLoading(false)`). The OTHER surface (popup if open while card is being switched, or card while popup is being switched) re-renders to reflect the new active layer
- When `state[newLayerId]` is undefined, dropdown-switch fires `POST /api/info/query` for that layer using the SAME spatial-context payload that the originating click used. **Open question for research:** the popup constructs the payload from `mapRef.current.getView().calculateExtent(...)` etc. — the card has no `mapRef`. Where does the card get `clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx` from when there's no associated map widget?
  - **Locked direction:** the request payload that hit `state[layerId]` for any layer is implicitly cached in the store entry's metadata, OR the most-recent click coordinate is captured at click time and re-used by any subsequent dropdown-switch (popup or card). Researcher to recommend; planner locks. The card's dropdown-switch CANNOT make up new spatial coordinates — it must reuse the last click's
- When the active layer's entry in the store is wiped (e.g., user dismisses the popup, store `reset()` fires) and the card is rendered, `activeLayerId` becomes null → card shows empty state until the next map click
- When the configured-via-dropdown layer becomes ineligible mid-session (deleted, `info_enabled=0`, switched to WKB mode): the existing Phase 21 `useEffect` that watches `[activeLayerId, visibleEnabledNonWkbLayerIds]` and calls `reset()` fires → card empties to default copy. Card extends this effect to use the NEW dashboard-scoped eligibility set (info_enabled + non-WKB across all dashboard layers, no map-widget visibility constraint) since the card is dashboard-scoped not map-scoped. Phase 21 popup's existing map-scoped eligibility logic is unchanged for the popup itself

### Pure-consumer lock — RELAXED

- **Pre-Phase 23 lock (PROJECT.md / STATE.md):** "Info Card reads from `useInfoSelectionStore` only — it must never call `POST /api/info/query` directly. Only the map click handler in `MapChartRenderer` feeds the store."
- **Phase 23 relaxation:** "Both popup and card mount `<InfoSelectionView />`, which calls `POST /api/info/query` on dropdown-switch (when `state[newLayerId]` is undefined) and on Load more. The map click handler in `MapChartRenderer` remains the SOLE entry point for the initial multi-layer fan-out; popup-and-card dropdown-switches are SINGLE-layer on-demand fetches reusing the last click's spatial coords. Other widget types (bar/line/pie/scatter/table/records/bignumber/map) still cannot fetch info-queries — only the popup and card can."
- Phase 23 plans MUST update PROJECT.md and STATE.md to reflect the relaxation. The requirement language in REQUIREMENTS.md CARD-V14-02 ("a dropdown in the widget config allows the user to select which dashboard layer's info selection to display") is reinterpreted as "an in-widget layer dropdown" (not a widget config panel dropdown). Update REQUIREMENTS.md CARD-V14-02 wording accordingly so future readers don't trip on the original phrasing
- Existing `infoQuery(...)` POST helper at `kinetica_bi/src/api/client.ts` is already importable; no new endpoint or helper needed. Both popup and card route through it via the shared `<InfoSelectionView />`

### Records display, scroll, and chrome

- Card body uses internal scroll. Records area fills available widget cell space. Author resizes via `react-grid-layout` cell handles to taste
- Sticky dropdown header band at the top of the card body (mirrors popup's sticky header semantics minus the close X)
- Sticky Load-more footer at the bottom of the card body when `state[activeLayerId].hasMore === true`; hidden when `hasMore === false`
- Records list scrolls between header and footer
- Card uses the standard dashboard widget chrome (drag handle, delete button, etc. — same as bar/line/pie/scatter/table/records/bignumber/map widgets). The widget chrome wraps the card body; the dropdown header is internal to the card body, NOT part of the widget chrome
- No close X (card is a permanent dashboard widget, dismissed via the standard widget delete button on widget chrome)
- No CSS triangle tail (no click-anchor; card is grid-positioned, not coordinate-anchored)
- No ESC dismiss handler (closing the card is a dashboard-edit operation, not a per-session interaction)

### Empty / mismatch states — single neutral copy

Single empty-state copy across all triggers:

> `Click a point on the map to see details`

(ROADMAP.md verbatim — Success Criterion 4.)

This single copy renders when ANY of:
- `activeLayerId === null` (initial load, before any click; or after `reset()` from popup dismiss / dashboard switch / logout)
- `activeLayerId` is non-null but `state[activeLayerId]` is undefined (rows/columns not loaded — should not happen given Phase 20's invariant `activeLayerId !== null ⇒ state[activeLayerId] exists`, but defensive render path)
- `state[activeLayerId].rows.length === 0`
- The layer pointed to by `activeLayerId` is no longer in the dashboard or has been disabled (the existing layer-leaves-eligibility-set effect from Phase 21 should fire `reset()`, dropping back to `activeLayerId === null`, and this empty-state path catches the result naturally)

No warning state; no "configuration error" copy; no per-card error chrome. Author / viewer just sees the neutral message and clicks the map. Aligns with Phase 22's "no live preview" simplicity preference.

### Visual style — shared `.info-selection-*` namespace

- Phase 21's `.info-popup-*` CSS classes are renamed to neutral `.info-selection-*`. The popup component continues to wrap content with the popup-specific classes (e.g., `.info-popup-anchored`, `.info-popup-tail`, `.info-popup-overlay`) for chrome that doesn't apply to the card
- Both popup and card render the body via the same `<InfoSelectionView />` component, which uses `.info-selection-*` for the dropdown header band, records list, KV table rows, template-mode container, Load-more button, error/loading micro-states
- The card's outer wrapper uses standard widget shell CSS (existing `.widget-*` patterns from `WidgetRenderer.tsx` consumers); the popup's outer wrapper continues to use `.info-popup-*` for anchored-tail / close-X / overlay-onClick chrome
- Refactor strategy: a single rename pass touching `kinetica_bi/src/components/charts/InfoPopup.tsx`, `kinetica_bi/src/styles/global.css` (or wherever Phase 21 placed the styles), and any tests asserting on class names. Researcher confirms the file locations; planner locks the rename diff scope
- One-shot rename (Claude's discretion) — gradual rename via class-name aliasing is more churn for no benefit since v1.4 is mid-flight; rename atomically in Phase 23 P01

### Code-share with Phase 21 — shared `<InfoSelectionView />`

- Phase 23 IS authorized to refactor Phase 21's `InfoPopup.tsx` to extract `<InfoSelectionView />`. The extraction is the design north star, not an optional optimization
- Proposed split (Claude's discretion to refine):
  - `<InfoSelectionView />` (new) — receives `eligibleLayers: DashboardLayerDto[]` + spatial-context-replay info as props; reads `useInfoSelectionStore` directly. Renders dropdown header + records list + Load more. Owns the dropdown-switch fetch and Load-more fetch logic
  - `<InfoPopup />` (refactored) — wraps `<InfoSelectionView />` with `ol/Overlay` anchor + close X + ESC + click-outside-overlay + tail. Receives `dashboardLayers` and `widgetConfig` from `MapChartRenderer`; computes the eligible layers list (visible + enabled + non-WKB scoped to the popup's owning map widget); passes eligibility list to `<InfoSelectionView />`
  - `<InfoCardRenderer />` (new) — wraps `<InfoSelectionView />` with widget chrome only (no anchor, no close X, no ESC). Reads `useDashboardLayersStore` to compute the dashboard-scoped eligibility list (info_enabled + non-WKB, no visibility constraint). Passes eligibility list to `<InfoSelectionView />`
- Spec strategy:
  - `InfoSelectionView.spec.tsx` (new) covers the shared behaviors: dropdown render with eligibility list, dropdown-switch fetch on undefined state, Load-more append fetch, KV/template render mode, empty state, error state in dropdown body
  - `InfoPopup.spec.tsx` (slimmed) keeps popup-only chrome cases: ol/Overlay anchor, ESC dismiss, click-outside dismiss, tail flip, off-screen clamp
  - `InfoCardRenderer.spec.tsx` (new) covers card-only chrome cases: widget shell render, no close X, no ESC, dashboard-scoped eligibility filtering, registration in chart-type registry
  - Existing Phase 21 popup specs that purely tested shared body behaviors migrate to `InfoSelectionView.spec.tsx`; chrome-specific specs stay in `InfoPopup.spec.tsx`
- The spatial-context-replay shape (how popup-or-card supplies the last click's coordinates and bbox to `<InfoSelectionView />`) is the planner's most material design call — research will surface options. Locked constraint: no map-widget reference inside `<InfoSelectionView />` (would couple it to OL).

### Claude's Discretion

- Exact file location of `<InfoSelectionView />` (recommend `kinetica_bi/src/components/charts/InfoSelectionView.tsx` — colocated with InfoPopup, matches existing pattern)
- Exact icon string for `info-card` definition (recommend `IC` to match existing icon brevity)
- Exact ChartConfigPanel placeholder copy when type=info-card has no fields (recommend `Info Card mirrors the map info popup — no configuration needed`)
- Whether `<InfoCardRenderer />` lives in a new file or as a thin wrapper inside `WidgetRenderer.tsx` like `RecordsTableRenderer` (recommend new file — easier spec colocation)
- Exact prop shape for `<InfoSelectionView />` (eligibility list as `DashboardLayerDto[]` vs a simplified projection; spatial-context-replay as a single object vs flattened props)
- Exact CSS rename diff (file count, selector-by-selector list, test file impact)
- Exact sticky-header CSS for card dropdown band (border, background, height, z-index inside the widget cell)
- Exact ARIA labels for the dropdown
- Whether the empty-state container uses an existing `.widget-placeholder` class (matches other widgets' empty states) or the new `.info-selection-empty` class (matches popup's empty render)
- Exact PROJECT.md / STATE.md update wording for the relaxed pure-consumer lock
- Exact REQUIREMENTS.md update wording for CARD-V14-02 (in-widget vs widget-config dropdown)
- Whether to update REQUIREMENTS.md inline as part of the Phase 23 plan or as a docs-only commit before plan execution

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 23: info-card" — Phase boundary, Success Criteria 1-4, depends-on Phase 20/21/22, "Notes" section establishing pure-consumer pattern (TO BE UPDATED in Phase 23)
- `.planning/REQUIREMENTS.md` §"Info Card Chart (CARD)" — CARD-V14-01..04 (chart type registration, dropdown selection, template/KV render parity with popup, empty state)
- `.planning/REQUIREMENTS.md` lines 89-94 §"Cross-widget Broadcast" — XWIDGET-V2-01 deferred (only Info Card is net-new in v1.4)

### Locked v1.4 architectural decisions (read these for context — TO BE UPDATED in Phase 23)
- `.planning/PROJECT.md` §"Current Milestone: v1.4 Map Info Popup" — HTML no-sanitize Key Decision (UNCHANGED), pure-consumer lock for Info Card (RELAXED in Phase 23 — both popup and card fetch), session-only store policy (UNCHANGED), lifecycle reset integration points (UNCHANGED)
- `.planning/STATE.md` §"Key v1.4 Architecture Decisions" — store-before-popup ordering (UNCHANGED), Info Card pure-consumer lock (RELAXED), server-side radius conversion (UNCHANGED), kill-switch semantics (UNCHANGED for popup; n/a for card)

### Direct upstream phases (this phase reads their outputs and refactors Phase 21)
- `.planning/phases/19-config-schema/19-VERIFICATION.md` — `info_enabled`, `info_columns`, `info_template` columns + `mapInfoConfig.ts` helpers; `DashboardLayerDto` shape
- `.planning/phases/19-config-schema/19-02-frontend-types-SUMMARY.md` — `DashboardLayerDto.info_enabled: number` (0/1), `info_columns: string | null`, `info_template: string | null` — card filters dropdown by `info_enabled === 1`
- `.planning/phases/20-info-selection-store/20-CONTEXT.md` — Store contract: 7 actions, `activeLayerId !== null ⇒ state[activeLayerId] exists` invariant, layer-switch wipes prior entry, single dashboard-global activeLayerId. Card subscribes to the same store as popup
- `.planning/phases/20-info-selection-store/20-01-store-and-spec-SUMMARY.md` — `useInfoSelectionStore` implementation; selector scoping rules
- `.planning/phases/20-info-selection-store/20-02-lifecycle-integration-SUMMARY.md` — App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup; three-store reset block. Card adds NO new lifecycle wiring; existing reset suffices
- `.planning/phases/21-map-click-popup/21-CONTEXT.md` — Popup decisions: sequential fan-out vs on-demand single-layer fetch; per-layer dropdown semantics; `renderInfoTemplate` helper signature; `dangerouslySetInnerHTML` no-sanitize render path; abort-on-re-click; ol/Overlay pattern. Card reuses dropdown-switch fetch path; refactors popup chrome split
- `.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md` — `renderInfoTemplate` is order-preserving (caller sorts). Card calls the same helper
- `.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md` — `InfoPopup.tsx` shape pre-refactor. Phase 23 splits this into `InfoPopup.tsx` (chrome) + `<InfoSelectionView />` (body)
- `.planning/phases/21-map-click-popup/21-03-map-renderer-integration-SUMMARY.md` — `MapChartRenderer` click-handler integration; spatial-context payload shape (clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx). Card needs spatial-context-replay strategy informed by this
- `.planning/phases/22-config-ui/22-CONTEXT.md` — Cross-phase column-sort lock (caller sorts before `renderInfoTemplate`). Card calls `renderInfoTemplate` via shared `<InfoSelectionView />`; sort happens once in the shared view
- `.planning/phases/22-config-ui/22-03-layer-config-SUMMARY.md` — InfoPopup.tsx now sorts `entry.columns` alphabetically before calling `renderInfoTemplate`. Phase 23 carries this forward — `<InfoSelectionView />` performs the sort once for both popup and card

### Pattern references (mirror these in this phase)
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` shape (type, label, icon, fields, defaultConfig, CustomConfigPanel, usesAggregation, supportsDrillDown). Phase 23 fills in for `info-card`
- `kinetica_bi/src/components/charts/definitions/index.ts` — Barrel pattern for registering chart types. New file `info-card.ts` registers via `register()`; index.ts imports and calls
- `kinetica_bi/src/components/charts/definitions/records.ts` — Reference for a simple definition without `CustomConfigPanel` (mostly fields + defaults). Card has empty fields, but the file structure is similar
- `kinetica_bi/src/components/charts/definitions/map.ts` — Reference for a `usesAggregation: false` definition with custom panel (Phase 23 has no panel but inherits the pattern)
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — Switch statement at lines 206-212 routing by `widget.type`. Phase 23 adds an early-return branch for `info-card` (mirrors map and records short-circuit)
- `kinetica_bi/src/components/charts/InfoPopup.tsx` (Phase 21) — TO BE REFACTORED. Extract shared `<InfoSelectionView />`; popup keeps anchored-tail / close X / ESC chrome
- `kinetica_bi/src/lib/renderInfoTemplate.ts` (Phase 21) — Pure helper. Both popup and card call via shared view; UNCHANGED in Phase 23
- `kinetica_bi/src/store/infoSelectionStore.ts` (Phase 20) — UNCHANGED. Card subscribes; both popup and card mutate via existing actions
- `kinetica_bi/src/store/dashboardLayersStore.ts` — Source for the card's eligibility filter (`info_enabled === 1 AND derived spatialMode !== "wkb"`)
- `kinetica_bi/src/api/client.ts` — `infoQuery(...)` helper from Phase 21; Phase 23 reuses for card's dropdown-switch fetch and Load more
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Spatial-context payload construction (line ~XXX, planner verifies); spatial-context-replay strategy must capture/replay this payload for the card to fetch on dropdown-switch without a map ref

### Spec test infra (mirror these for new specs)
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand reset shim; auto-covers `useInfoSelectionStore`, `useDashboardLayersStore`, `useFilterStore`, `useFilterViewStore` for the new card spec
- `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` — Existing popup spec; refactor splits behavioral tests to `InfoSelectionView.spec.tsx` and keeps popup-chrome cases here
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Existing renderer spec; some popup-related cases may stay here (click-handler-fires-fan-out)
- `kinetica_bi/src/components/charts/registry.spec.ts` (if exists; planner verifies) — Chart-type registry spec; new test for `info-card` registration assertion

### CSS / styling reference
- `kinetica_bi/src/styles/global.css` (or Phase 21's chosen location) — `.info-popup-*` classes from Phase 21. Phase 23 renames to `.info-selection-*` for shared body classes; popup-only chrome classes (`.info-popup-anchored`, `.info-popup-tail`, etc.) stay
- `kinetica_bi/src/styles/global.css` — Standard widget chrome classes (`.widget-*`, `.widget-placeholder`). Card uses these for outer wrapper

### Endpoint reference (UNCHANGED in Phase 23)
- `kinetica_bi/server/src/index.ts` `POST /api/info/query` — Endpoint unchanged. Card calls via existing `infoQuery(...)` client helper
- `kinetica_bi/server/src/spatialQuery.ts` — Server-side SQL builders unchanged

### External library references (none new for Phase 23)
- React + zustand + existing Phase 21 dependencies. No new libs needed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useInfoSelectionStore` (Phase 20):** Card subscribes via scoped selectors. `state[activeLayerId]` for records; `activeLayerId` for dropdown-selected layer. Both popup and card share this state — no new store
- **`useDashboardLayersStore`:** Source for the card's eligibility filter. `s.layers.filter(l => l.info_enabled === 1 && deriveSpatialMode(l) !== "wkb")`. Already used by `MapConfigPanel.tsx:38` (`useDashboardLayersStore((s) => s.layers)`). Card reads the same selector
- **`renderInfoTemplate` (Phase 21):** Pure helper at `kinetica_bi/src/lib/renderInfoTemplate.ts`. Card imports through the shared `<InfoSelectionView />` — same path as popup
- **`infoQuery(...)` (Phase 21):** POST helper at `kinetica_bi/src/api/client.ts`. Card uses for dropdown-switch fetch and Load more (same path as popup) — relaxed pure-consumer lock makes this OK
- **`<InfoPopup />` body (Phase 21):** Currently inlined in `InfoPopup.tsx`. Phase 23 extracts as `<InfoSelectionView />` (dropdown + records list + Load more). Both popup and card render via this component
- **Chart-type registry (`registry.ts` + `definitions/index.ts`):** Add `info-card.ts` definition; call `registerInfoCard()` in `registerAllChartTypes()`. No registry shape changes
- **Widget shell from `WidgetRenderer.tsx`:** Standard widget chrome (drag handle, delete, header). Card wraps body with this. New early-return branch at line ~206 for `widget.type === "info-card"`
- **`Toast` component:** Reuse for any error feedback (e.g., dropdown-switch fetch failure, Load-more failure). Same as popup's usage from Phase 21

### Established Patterns

- **Store-driven render with scoped selectors:** Card subscribes via `useInfoSelectionStore(s => s.activeLayerId)` and `useInfoSelectionStore(s => s.state[activeLayerId])` — never the whole store object. Phase 20 PITFALL S-02 carry-forward
- **Single-key store updates produce reference-stable other-key entries:** `setActiveLayer(B)` wipes `state[A]` but does NOT cause re-render in components subscribed only to `state[C]`. Card and popup both benefit
- **Atomic chart-type registration:** Chart types register via `registerChartType(def)` from a default-exported `register()` function in `definitions/<type>.ts`, called from `registerAllChartTypes()`. New types are atomic additions
- **WidgetRenderer early-return pattern:** Map and records widgets short-circuit before the `AggregatedWidgetRenderer` SQL path because they don't run aggregated SQL. Card follows the same pattern (it doesn't run SQL at all). New early-return inserted alongside the map and records cases
- **`dangerouslySetInnerHTML` for template render (Phase 21):** Locked PROJECT.md decision; no sanitization. Both popup and card render via the shared `<InfoSelectionView />` which uses this — single inline comment already exists in `renderInfoTemplate` consumers per Phase 21 PITFALL note
- **Cross-phase column sort (Phase 22):** `entry.columns` is sorted alphabetically by the caller (currently InfoPopup) before passing to `renderInfoTemplate`. Phase 23 moves the sort into the shared `<InfoSelectionView />` so both popup and card inherit it; `renderInfoTemplate` stays untouched
- **Lifecycle reset already wired (Phase 20-02):** `useInfoSelectionStore.reset()` fires from `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen cleanup. Card unmounts naturally on dashboard switch / logout via React. No new lifecycle hooks required

### Integration Points

1. **`kinetica_bi/src/components/charts/definitions/info-card.ts` (NEW):** Default-exported `register()` function calls `registerChartType({ type: "info-card", label: "Info Card", icon: "IC", fields: [], defaultConfig: {}, usesAggregation: false, supportsDrillDown: false })`
2. **`kinetica_bi/src/components/charts/definitions/index.ts` (EXTEND):** Import `registerInfoCard` from `./info-card`; call `registerInfoCard()` in `registerAllChartTypes()` alongside the 8 existing types
3. **`kinetica_bi/src/components/charts/InfoSelectionView.tsx` (NEW):** Shared body component extracted from Phase 21's `InfoPopup.tsx`. Receives eligibility list + spatial-context-replay info as props; reads `useInfoSelectionStore` directly. Renders dropdown header band + records list + Load-more button. Owns dropdown-switch fetch and Load-more fetch logic via existing `infoQuery(...)` helper
4. **`kinetica_bi/src/components/charts/InfoPopup.tsx` (REFACTOR):** Slim down to anchored-tail / close X / ESC / click-outside chrome wrapping `<InfoSelectionView />`. Pass map-widget-scoped eligibility list (visible + enabled + non-WKB) and spatial-context-replay (the click that opened the popup) to the inner view. Existing layer-leaves-eligibility effect that calls `reset()` stays in popup wrapper (it's popup-specific because it watches the popup-owning map's visible-layer set)
5. **`kinetica_bi/src/components/charts/InfoCardRenderer.tsx` (NEW):** Card body wrapping `<InfoSelectionView />`. Reads `useDashboardLayersStore` to compute dashboard-scoped eligibility list (info_enabled === 1 + non-WKB, no visibility constraint). Computes spatial-context-replay via the most-recent click's coords (research locks the source — likely a new top-level field in the store, or a sibling `useLastInfoClickCoord` slice). Wraps with widget chrome (no close X, no ESC, no anchor)
6. **`kinetica_bi/src/components/charts/WidgetRenderer.tsx` (EXTEND):** Add early-return branch:
   ```tsx
   if (widget.type === "info-card") {
     return <InfoCardRenderer widget={widget} />;
   }
   ```
   inserted alongside the map and records short-circuits at lines 206-211
7. **`kinetica_bi/src/styles/global.css` (REFACTOR):** Rename `.info-popup-*` classes to `.info-selection-*` for shared body classes. Popup-specific chrome classes (`.info-popup-anchored`, `.info-popup-tail`, `.info-popup-overlay`) stay as-is. Add card-wrapper class if needed for the dropdown-header sticky band inside widget chrome
8. **Specs:** Three new/refactored spec files
   - `InfoSelectionView.spec.tsx` (NEW) — shared body cases (dropdown render, dropdown-switch fetch, Load more, KV/template render, empty state, error)
   - `InfoPopup.spec.tsx` (SLIM) — popup-only chrome cases
   - `InfoCardRenderer.spec.tsx` (NEW) — card-only cases (registry registration, widget chrome wrap, dashboard-scoped eligibility, no close X / ESC)
9. **`.planning/PROJECT.md` (UPDATE):** Relax pure-consumer lock language; update Key Decision section. Phase 23 plan owns this update
10. **`.planning/STATE.md` (UPDATE):** Mirror PROJECT.md update in "Key v1.4 Architecture Decisions" subsection
11. **`.planning/REQUIREMENTS.md` (UPDATE):** Reword CARD-V14-02 to clarify "in-widget layer dropdown" (not widget-config dropdown). Phase 23 plan owns this update too

### Anti-patterns / pitfalls

- **DO NOT** subscribe to `useInfoSelectionStore.state` (whole map) in render. Scope to `state[activeLayerId]`. Phase 20 PITFALL S-02 carry-forward
- **DO NOT** add a per-card layer config or `CustomConfigPanel` — locked "card is not configured per layer". Empty fields, empty defaultConfig
- **DO NOT** add a per-card title field — deferred. Card uses standard widget chrome which already has a title affordance handled by the dashboard
- **DO NOT** sanitize `info_template` in the card render path — locked PROJECT.md HTML-no-sanitize. Same render path as popup via shared view
- **DO NOT** allow non-popup non-card widgets (bar/line/pie/scatter/table/records/bignumber/map) to subscribe-to-fetch from `useInfoSelectionStore`. The relaxed lock is specific to popup + card via shared `<InfoSelectionView />`. XWIDGET-V2-01 deferred
- **DO NOT** drill-down on row click in card body — `supportsDrillDown: false` enforced via registry. Info orthogonal to filter — Phase 21 lock
- **DO NOT** render the card without an empty-state path. ROADMAP success criterion 4 demands "neutral empty state rather than blank panel or JS error". Defensive render path covers `activeLayerId === null`, `state[activeLayerId]` undefined, and `rows.length === 0`
- **DO NOT** introduce a new spatial-context payload shape for the card. Reuse the popup's existing payload contract from Phase 18; the only delta is "where do clickLon/clickLat/mapBbox come from when no map ref is available?" — research locks the source
- **DO NOT** add an in-card filter/dispatch path. Card is presentational; row clicks do nothing. `supportsDrillDown: false`
- **DO NOT** dual-fetch on dashboard load. If popup is open and card is rendered, both subscribe to the same `state[activeLayerId]`. Initial fan-out happens once via map click; both surfaces reactively reflect the result. No card-initiated fetch on mount

</code_context>

<specifics>
## Specific Ideas

- **"The card should show the exact same thing as the info popup on the map but in the card."** — User's direct quote. Card's UX is popup mirrored in widget form. Layer dropdown, record rendering, Load more, empty state — all parity with popup
- **"Alternative if the user prefers to show the popup in a separate visualization rather than on the map."** — User's framing. Card is a polish/convenience surface for the same primitive (info-query-result), not a new data primitive. Justifies the shared `<InfoSelectionView />` extraction
- **"All the behavior should be the same as the popup too."** — Locks the dropdown-switch fetch and Load more behavior. Forced the relaxation of the pure-consumer lock
- **"It will show nothing when nothing is clicked on the map."** — Locks the empty-state default. Card does NOT initiate fetches on mount; waits for `activeLayerId` to be non-null
- **"The card is not configured per layer. The card is just like the map popup and should show the same results so the card should be able to switch from layer A to layer B if a user wants to."** — Locks the in-widget dropdown design. CARD-V14-02 reinterpreted: the dropdown is in-widget, NOT in widget config. No widget config panel needed
- **"All dashboard layers, info-enabled non-WKB"** — Card dropdown source is dashboard-scoped, independent of map widgets. Differs from popup's map-widget-scoped eligibility (which only includes layers visible in the popup-owning map)
- **"Empty state, neutral copy"** for layer-gone scenarios — Single empty-state copy for all error/missing/empty scenarios. No warning variants. Matches Phase 22's no-live-preview simplicity preference
- **"Internal scroll, records fill body"** — Card author resizes via grid handles; records area fills available space and scrolls when overflow. Standard widget body behavior
- **"Standard widget chrome + dropdown header"** — Card uses dashboard widget chrome (drag/delete/title) plus an internal sticky dropdown header band. No popup-style close X or tail
- **"Share refactored .info-selection-* namespace"** — Phase 21 CSS rename in Phase 23. Atomic one-shot rename. Both popup and card consume `.info-selection-*` body classes; popup keeps `.info-popup-*` chrome classes

</specifics>

<deferred>
## Deferred Ideas

- **Per-card title field** — Out for v1.4. Standard widget chrome already provides a title affordance handled by the dashboard. Revisit if UAT shows authors want per-card-distinct titles
- **Per-card layer-eligibility filter** ("this card only shows Buildings layer") — Not requested. Cards mirror dashboard scope. Revisit if UAT shows cluttered dropdowns on multi-layer dashboards
- **Multiple cards rendering different selections concurrently** — Out for v1.4. Single dashboard-global `activeLayerId` invariant from Phase 20 means every card on a dashboard agrees on the active layer. Multi-selection requires a Phase 20 store-shape change deferred to v2 (XWIDGET-V2-01 territory)
- **Drill-down on row click in card body** — Phase 21 lock; info orthogonal to filter. `supportsDrillDown: false` enforced. Revisit if v2 wants this (XWIDGET-V2-01 territory)
- **Custom empty-state copy per card** — Single neutral copy across all variants for v1.4. Author-customizable copy is a polish enhancement; revisit if UAT shows authors want per-card guidance text
- **Hover-preview integration on card** — HOVER-V2-01 deferred. Same gating logic would apply: per-layer info-enabled + non-WKB. Card spec stays click-driven
- **URL/localStorage persistence of card state** — PERSIST-V2-01/02 deferred. Card state is fully derived from `useInfoSelectionStore`, which is session-only
- **Per-widget kill-switch on card** — Card has no map widget binding, no `infoEnabled` widget config, no listener-registration semantics. The popup's per-widget kill switch (POPUP-V14-06) applies only to the popup's owning map widget. Card always renders subject to empty-state
- **Pre-populated dropdown selection on card mount** — Card opens with `activeLayerId` from store. If null (initial dashboard load), empty state until first map click. Pre-populating to first eligible layer would force a fetch on mount, which contradicts the "show nothing when nothing is clicked" lock
- **Card-card synchronization across multiple cards on same dashboard** — Single `activeLayerId` invariant means all cards agree automatically. No new sync logic needed; deferred discussion until v2 multi-selection makes this meaningful
- **Drag-handle reorder of layer dropdown items** — Layer dropdown order matches dashboard layer panel z-order (same as popup). User-controlled reorder is the existing layer panel reorder; no per-dropdown reorder
- **CodeMirror or any editor on card** — Card is read-only display. Author-editable template lives in layer config (Phase 22). No editor on card

</deferred>

---

*Phase: 23-info-card*
*Context gathered: 2026-05-09*
