# Phase 21: map-click-popup - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Click on an info-enabled map widget → run a sequential top-down spatial-info fan-out across that map's visible enabled non-WKB layers; the FIRST layer that returns rows opens an OL-anchored popup at the click coordinate showing those records. Popup contains a layer dropdown (lists all eligible layers — hit-or-not), a "Load more" pagination control (50/page, append), and a close button. Layer dropdown switches trigger lazy on-demand fetch for unqueried layers. Records render via the layer's `info_template` HTML when configured, else as a plain key-value table of `info_columns` (or all response columns when `info_columns` is null).

In scope:
- OL `singleclick` handler registration on the map widget (gated by `getInfoEnabled(widgetConfig)` at registration time per POPUP-V14-06)
- Sequential per-layer `POST /api/info/query` fan-out with abort-on-re-click
- `kinetica_bi/src/components/charts/InfoPopup.tsx` (or equivalent) — the popup React component, mounted via `ol/Overlay` inside `MapChartRenderer`
- Shared template helper `kinetica_bi/src/lib/renderInfoTemplate.ts` (Phase 23 Info Card will import it)
- Client API helper for `POST /api/info/query` in `kinetica_bi/src/api/client.ts` (mirrors `materializeFilter` precedent at lines 585-610)
- Toast feedback for all-empty / all-error click outcomes (uses existing `kinetica_bi/src/components/Toast.tsx`)
- Wiring `useInfoSelectionStore` actions: `setLoading` → `setSelection` (or `setError`) → `setActiveLayer` per layer; `appendPage` on Load more; `reset()` on dismiss / new click / layer-toggle invalidation
- Spec coverage for click handler, fan-out semantics, dropdown render, Load-more append, dismiss paths, kill-switch (no listener), WKB-skip

Out of scope (other phases):
- The shared `renderInfoTemplate` helper's BEING USED BY Info Card (Phase 23 wires the consumer)
- Layer config UI for `info_enabled` / `info_columns` / `info_template` (Phase 22)
- Per-widget config UI for `infoEnabled` / `infoRadiusPx` (Phase 22)
- Hover-on-map preview (out of v1.4)
- URL/localStorage persistence of selection (PERSIST-V2-* deferred)

</domain>

<decisions>
## Implementation Decisions

### Popup positioning + container

- **Anchor:** `ol/Overlay` positioned at the clicked `[lon, lat]` map coord. Popup follows pan/zoom (sticks to the geographic point). First `ol/Overlay` use in this codebase — establishes the pattern for any future map UI (hover, tooltips).
- **Map interactivity:** Stays fully interactive while popup is open. New map click ALWAYS triggers replace (abort prior + reset() + new fan-out). No proximity-threshold de-dupe.
- **Edge handling:** When click pixel is near a widget edge, ol/Overlay's `positioning` flips dynamically (`bottom-left` ↔ `top-right` etc.) so the popup never overflows the widget bounds. ~10 lines of pixel-bounds math against the widget container size + click pixel.
- **Off-screen pan:** When pan/zoom moves the anchor off-screen, popup CLAMPS to the nearest map edge with a small arrow indicator pointing toward the off-screen anchor. Not auto-dismiss; not free-tracking. (Behavioral mid-ground: keeps popup readable while honoring 'this happened HERE' semantics. Implementation: ol/Overlay `autoPan: false` + manual viewport-bounds projection in an Effect that listens to `map.on("postrender")` or `map.getView().on("change")`.)
- **Z-order:** Popup z-index above OL's default control z-index (1000-ish). Controls remain clickable when not occluded by popup.
- **Sticky header:** Header contains layer dropdown (left) + close button (right). Mirrors `LayersModal` header pattern. Header stays visible when records list scrolls.
- **Anchor offset + tail:** Popup edge ~12px from click pixel; CSS triangle tail ('▲'/'▼' equivalent) points toward click. Standard map-popup look (Google Maps, Mapbox, OSM).
- **Single dashboard-global popup:** Clicking on map B while map A's popup is open dismisses A and opens B. Matches `useInfoSelectionStore` single-`activeLayerId` invariant locked in Phase 20 — no per-widget popup state, no store-shape refactor.

### Multi-layer fetch concurrency

- **Sequential top-down, stop on first hit.** Iterate visible-enabled-non-WKB layers in z-order (top of layer panel = first). For each, fire `POST /api/info/query` with the click pixel→ground-radius converted server-side. As soon as one layer returns `rows.length > 0`, OPEN the popup with that layer focused; do NOT continue querying remaining layers (they fetch lazily on dropdown switch).
- **Popup does NOT open until first hit.** No popup chrome during the wait — only a `cursor: progress` on the map widget. (Selected over the recommended Promise.all-then-open default. Rationale: cheaper Kinetica load when first layer commonly has the answer; quieter UX on empty clicks.)
- **First-position layer in dropdown:** First eligible layer (top-most z-order), regardless of where the first hit landed. (E.g., if layer 1 returns empty and layer 2 hits, the dropdown still lists 1, 2, 3, … in that order; `activeLayerId` is layer 2.)
- **Re-click during in-flight fan-out:** Per-click `AbortController`; new click aborts the prior controller, calls `useInfoSelectionStore.getState().reset()`, fires fresh sequential fan-out for the new click point. Mirrors v1.3 `materializeAbortRef` pattern (V13-P-10 lock).
- **WKB layers silently skipped:** Layers whose source has `spatialMode === "wkb"` are filtered out of the fan-out list BEFORE iteration starts; they don't appear in the dropdown either. Honors TD-V14-WKB-SPIKE-as-feature: 501 is not user-surfaceable; behavior reverts automatically when WKB lands. (Locked decision: Phase 18 endpoint already returns 501; popup just doesn't query.)
- **Per-layer first-fetch error during sequential fan-out:** Treat like empty — continue to next layer in z-order. Only after ALL eligible layers have errored or returned empty: fire toast. (Resilient to flaky single-layer errors.)

### Dropdown contents + lazy on-demand fetch

- **Dropdown lists all visible enabled non-WKB layers**, hit-or-not. Honors POPUP-V14-02 'lists all visible, enabled layers' verbatim. Layers below the first hit are listed but unqueried at popup-open time.
- **Two query paths:**
  1. *Initial sequential-until-hit* — multi-layer fan-out triggered by map click; stops at first hit.
  2. *On-demand single-layer fetch* — triggered when user switches the dropdown to a layer whose `state[layerId]` is undefined (or whose entry was wiped by `setActiveLayer` on prior switch). Uses `setLoading(layerId, true)` → `setSelection(layerId, payload)` → `setActiveLayer(layerId)` → `setLoading(layerId, false)`.
- **Per-layer order in dropdown is z-order from the layers panel** (ascending `position`). Stable across the session.
- **Switching to an already-fetched layer (entry exists in `state[layerId]`):** No fetch — just `setActiveLayer(layerId)`. (Note: per Phase 20 lock, switching FROM layer A TO layer B fully WIPES `state[A]`. So the only path where the new layer's entry survives is "user opens popup, never switches; no entry to keep". In practice every dropdown switch will trigger an on-demand fetch.)

### Loading + error UX

- **Pre-first-hit feedback:** `cursor: progress` on the map widget container while sequential queries are running. No popup chrome. Reverts to default cursor on first hit OR all-empty/all-error toast.
- **All-empty toast:** Existing `Toast` component (`src/components/Toast.tsx`). Message: `"No records within click radius"`. Auto-dismisses ~3s.
- **All-error toast:** `"Failed to fetch info for {N} layer(s)"`. (Distinguish from empty toast so the user knows whether to retry vs the click point really has no data nearby.)
- **On-demand fetch (dropdown switch):** Body replaces with centered spinner + "Loading…" text while fetch is pending. Sticky header (dropdown + close) stays visible.
- **Load-more pagination:** Existing rows STAY visible. The "Load more" button itself shows the spinner / disabled state. New page appends below. Matches `useInfoSelectionStore.appendPage` contract from Phase 20 (caller controls `setLoading(layerId, true)` before appendPage and `setLoading(layerId, false)` after).
- **Load-more failure:** Toast `"Failed to load more records"`. Existing rows preserved (Phase 20 store contract: `setError` preserves rows). The button becomes "Retry" — clicking it re-fires the same `appendPage` POST. Reset to "Load more" label after success.
- **`hasMore: false`:** "Load more" button hidden entirely.

### Dismiss interactions

All paths converge on `useInfoSelectionStore.getState().reset()`:

1. **Close button (X)** in popup header — POPUP-V14-05 verbatim.
2. **Escape key** — `window.addEventListener("keydown", …)` for `e.key === "Escape"`. Mirrors `LayersModal:71-77` pattern. Listener registered when popup opens, removed on dismiss.
3. **Click outside the popup body** — overlay `onClick` calls `reset()` (and `e.stopPropagation()` on the popup body to prevent inner clicks from bubbling). Mirrors `LayersModal:168` pattern.
4. **New map click** — replaces selection (abort prior, reset, new fan-out). Always replaces; no proximity threshold.
5. **Layer visibility toggle / layer delete / `info_enabled` flip on the active layer** — when the active layer leaves the visible-enabled-non-WKB set, fire `reset()`. Implementation: useEffect in the InfoPopup component watches `[activeLayerId, visibleEnabledNonWkbLayerIds]`; if `activeLayerId` is non-null AND not in the set, call `reset()`. This includes WKB-mode flips (e.g., dashboard author flips `spatialMode` to wkb in config) which auto-removes the layer from the set.
6. **Lifecycle (logout, dashboard switch):** Already wired by Phase 20-02 — `reset()` is called from `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` `DashboardOpen` cleanup. Popup unmounts naturally via React when these fire (no explicit unmount-on-reset coupling needed).

**Filter-bar interactions do NOT dismiss.** FilteringBadge clicks, chart drill-down filter additions, and `materializeFilter` triggers do not call `reset()`. Popup is orthogonal to the filter pipeline (Phase 18 lock: info-query reads source table directly, NOT the materialized view). User can compare 'records here' vs 'currently filtered chart data' simultaneously.

### Click handler short-circuit (POPUP-V14-06)

- **Listener registration is the gate.** `MapChartRenderer` reads `getInfoEnabled(widgetConfig)` at render time; if `false`, the OL `singleclick` handler is NOT registered at all (no click event fires the popup logic, no network, no store mutation). When `infoEnabled` flips `true → false` in the config, the cleanup function removes the listener; flip `false → true` re-registers.
- This is the locked semantics from PROJECT.md Key Decision: "Per-widget infoEnabled: false disables the OL click listener entirely (no listener registration)."

### Template rendering (POPUP-V14-04)

- **Shared helper:** `kinetica_bi/src/lib/renderInfoTemplate.ts` exports a pure function. Phase 23 Info Card will import the same helper. Spec colocated.
- **Helper signature (proposed; Claude's discretion to refine):** `renderInfoTemplate({ template: string | null, columns: string[], row: Record<string, unknown> }): { mode: "template"; html: string } | { mode: "kv"; pairs: { col: string; value: unknown }[] }`. Pure mode discriminator so the popup component decides the React render path (`dangerouslySetInnerHTML` vs key-value table).
- **Template token substitution syntax:** Claude's discretion (not asked). Recommended: `{column_name}` (Tableau/Grafana convention). Keep the substitution function tiny and well-tested. No expressions, no escaping, no logic — just literal substitution of `row[columnName]` into `{columnName}` placeholders.
- **No HTML sanitization** — locked by PROJECT.md Key Decision: "Dashboard authors are privileged users (analogous to saved SQL queries)". The popup renders the substituted template via React's `dangerouslySetInnerHTML`. (Documenting the lock here so the planner doesn't add a sanitizer "just in case".)
- **Key-value fallback:** When `info_template` is null, render a `<table>` of `(column, value)` pairs. Columns chosen by `info_columns` JSON-array string when set (parse with try/catch and fall back to all response columns on parse error); when null, all response columns.

### Click-to-radius pipeline

- **Server-side radius conversion.** Click pixel → ground distance happens server-side via `pxToGroundDistance` (latlon, meters) / `pxToGroundDegrees` (wkt, degrees). Client sends `radiusPx` + `mapBbox` + `mapWidthPx` + `mapHeightPx` in the request body. Locked Phase 18 architectural decision; popup just collects these from `mapRef.current.getView()` + the widget's clientWidth/Height.
- **`mapBbox` source:** `mapRef.current.getView().calculateExtent(mapRef.current.getSize())` returns `[minX, minY, maxX, maxY]` in EPSG:3857. Pass through verbatim — server expects EPSG:3857 per Phase 18 contract.
- **`clickLon`/`clickLat`:** OL `singleclick` event provides `event.coordinate` in EPSG:3857 (the locked map projection per M-03). Convert to lon/lat via `ol/proj.transform(event.coordinate, "EPSG:3857", "EPSG:4326")` for both latlon and wkt modes — server expects geographic coords.

### Claude's Discretion

- Template token syntax (recommend `{column_name}`).
- Exact spinner CSS (reuse existing CSS-variable theme).
- Toast wording (within 'No records' / 'Failed to fetch' semantics).
- Popup width/max-width/max-height (Claude picks reasonable defaults consistent with `.modal-content` precedent — likely 360–480px width max, 60vh height max).
- Component file split between `InfoPopup.tsx` and the click-handler logic inside `MapChartRenderer.tsx` (suggest: click handler + fan-out logic stays in MapChartRenderer; InfoPopup is a presentation component that reads `useInfoSelectionStore` and emits `onClose`/`onLayerSwitch`/`onLoadMore` callbacks).
- Spec test names and grouping; whether to spec InfoPopup as a render-tree integration test or via a `MapChartRenderer.spec.tsx` extension.
- Whether to introduce an `InfoQueryAbortRef` ref pattern in MapChartRenderer (mirroring `materializeAbortRef` from `AggregatedWidgetRenderer`) or use a local `useRef` + `useCallback` closure.
- Implementation of "anchor clamps to map edge with arrow indicator" — exact pixel math + CSS arrow asset.
- Whether the cursor-loading state lives in component state or a class on the widget container (suggest: class for fewer renders).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 21: map-click-popup" — Phase boundary, success criteria 1-6, depends-on Phase 19/20.
- `.planning/REQUIREMENTS.md` §"Map Click Popup (POPUP)" — POPUP-V14-01..06 (click → fan-out → popup, layer dropdown, pagination, template-or-KV render, dismiss-resets-store, per-widget kill switch).
- `.planning/REQUIREMENTS.md` §"Info Selection Store (STORE)" — STORE-V14-05 (layer-switch page reset, consumed by popup).

### Locked v1.4 architectural decisions (read these for context)
- `.planning/PROJECT.md` §"Current Milestone: v1.4 Map Info Popup" — Out-of-scope list; HTML-template no-sanitization Key Decision; per-widget kill-switch semantics; per-layer kill-switch semantics; session-only store policy; lifecycle reset integration points.
- `.planning/STATE.md` §"Key v1.4 Architecture Decisions (locked at roadmap creation)" — HTML template policy, store-before-popup ordering, Info Card pure-consumer lock, server-side radius conversion lock, kill switch semantics.

### Direct upstream phases (this phase wires their outputs together)
- `.planning/phases/20-info-selection-store/20-CONTEXT.md` — Phase 20 store contract: 7 actions including `setSelection` (REPLACE, preserves prior loading), `appendPage` (APPEND), `setActiveLayer` (wipes prior layer entry), `setLoading`/`setError` (placeholder-on-missing), `clearSelection` (delete-key), `reset()` (top-level wipe). activeLayerId-non-null-iff-state[activeLayerId]-exists invariant. Dismiss MUST call reset() (not setActiveLayer(null), which type-forbidden).
- `.planning/phases/20-info-selection-store/20-01-store-and-spec-SUMMARY.md` — Phase 20 store implementation summary; lookup hooks via `useInfoSelectionStore`.
- `.planning/phases/20-info-selection-store/20-02-lifecycle-integration-SUMMARY.md` — Phase 20 lifecycle wiring; `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` `DashboardOpen` cleanup three-store reset block (filterViewStore → filterStore → infoSelectionStore).
- `.planning/phases/19-config-schema/19-VERIFICATION.md` — Phase 19 verification of `info_enabled` / `info_columns` / `info_template` columns + `mapInfoConfig.ts` helpers (`getInfoEnabled` / `getInfoRadiusPx`).
- `.planning/phases/18-spatial-spike-and-endpoint/18-VERIFICATION.md` — Phase 18 verification of `POST /api/info/query` endpoint contract; spec at `kinetica_bi/server/tests/routes.info-query.spec.ts`; WKB-501 lock; server-side radius conversion lock.
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` — TD-V14-WKB-SPIKE decision record; future re-run path for WKB mode.

### Pattern references (mirror these in this phase)
- `kinetica_bi/src/store/infoSelectionStore.ts` — The store this phase consumes. Read all 7 actions before wiring the click handler / dropdown / Load more / dismiss paths.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Where the click handler lives. Effect 1 (lines 261-313) mounts the OL Map; click handler registration goes in a new Effect that depends on `getInfoEnabled(widgetConfig)`. ol/Overlay attachment also lives here.
- `kinetica_bi/src/components/LayersModal.tsx` — Modal-shell template: ESC key (lines 71-77), click-outside dismiss (line 168), sticky header pattern. Mirror these idioms in the popup chrome.
- `kinetica_bi/src/components/charts/AggregatedWidgetRenderer.tsx` — `materializeAbortRef` per-click AbortController pattern (V13-P-10 lock). Mirror for popup fan-out abort-on-re-click.
- `kinetica_bi/src/api/client.ts` lines 585-610 (`materializeFilter` + `dropFilterView`) — POST helper precedent. Add `infoQuery(req): Promise<InfoQueryResponse>` mirroring this pattern.
- `kinetica_bi/src/lib/mapInfoConfig.ts` — `getInfoEnabled` / `getInfoRadiusPx` helpers (already shipped Phase 19). Use directly; do NOT duplicate defaults.
- `kinetica_bi/src/components/Toast.tsx` — Existing toast component; reuse for all-empty / all-error / Load-more-error feedback.
- `kinetica_bi/src/styles/global.css` lines 482-540 — `.modal-overlay`, `.modal-content`, `.modal-header`, `.modal-body` CSS classes. Popup may reuse base styling primitives but needs new classes for the anchored-tail variant (suggest `.info-popup-*` namespace).

### Endpoint reference
- `kinetica_bi/server/src/index.ts` lines 753-940 — `POST /api/info/query` route handler. Request body shape (lines 793-808), response shape (line 762-764). WKB 501 dispatch (around line 852-854).
- `kinetica_bi/server/src/spatialQuery.ts` — SQL builders (no client-side equivalent; client just passes payload through).
- `kinetica_bi/server/src/radiusConversion.ts` — `pxToGroundDistance` / `pxToGroundDegrees` (server-side).

### OpenLayers reference (for the OL Overlay pattern)
- `https://openlayers.org/en/latest/apidoc/module-ol_Overlay-Overlay.html` — ol/Overlay constructor, `setPosition`, `positioning` options, `autoPan` config. First use of ol/Overlay in this codebase — pattern needs establishing for hover/tooltip future work.
- `https://openlayers.org/en/latest/examples/popup.html` — Reference example for click-to-popup pattern.

### Test infra
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand reset shim; covers any new store consumer automatically.
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Existing MapChartRenderer spec; extend or split based on test count/scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useInfoSelectionStore` (Phase 20, dormant):** First consumer is this phase. All 7 actions cover every popup interaction: setLoading + setSelection on first-hit; appendPage on Load more; setActiveLayer on dropdown switch (which wipes prior layer's entry); setError on append-fail (preserves rows); reset() on dismiss + new-click + lifecycle. NO custom store extension needed — locked Phase 20 contract is sufficient.
- **`getInfoEnabled` / `getInfoRadiusPx` (Phase 19):** `kinetica_bi/src/lib/mapInfoConfig.ts`. Already handle the v1.3-era widget compat (default `infoEnabled: true`, `infoRadiusPx: 20`). Use directly.
- **`Toast` component:** `kinetica_bi/src/components/Toast.tsx`. Reuse for all-empty / all-error / Load-more-error feedback. Check API for queueing; likely supports auto-dismiss after 3s.
- **`materializeAbortRef` pattern:** From v1.3 `AggregatedWidgetRenderer.tsx`. Mirror for `infoQueryAbortRef` (per-widget per-click AbortController). Aborts on re-click, on dismiss, on widget unmount.
- **`LayersModal` modal-shell idioms:** ESC key listener, overlay-onClick dismiss, sticky header. Lift the patterns into the popup component (don't reuse the modal element itself — popup is anchored, not centered).
- **`materializeFilter` / `dropFilterView` POST helpers:** `kinetica_bi/src/api/client.ts:585-610`. Mirror for `infoQuery(...)` helper.
- **OL Map ref + view extent access:** `MapChartRenderer.tsx:200-310` already exposes `mapRef.current` and the view extent. Use `mapRef.current.getView().calculateExtent(mapRef.current.getSize())` for `mapBbox` and `mapRef.current.getSize()` for `[mapWidthPx, mapHeightPx]`.

### Established Patterns

- **OL handlers in useEffect:** Any `map.on("singleclick", handler)` registration goes in a useEffect with the `un` cleanup in the return. Mirror the basemap setup pattern from MapChartRenderer Effect 1. Dependency array: `[getInfoEnabled(widgetConfig), includedLayers, mapRef.current]` so listener re-registers when kill-switch flips or eligible layer set changes.
- **Reference-stable per-key store updates:** `state[layerId] = nextEntry` produces a new top-level state object but other layers' entries keep object identity. Selector consumers in the popup must scope to `useInfoSelectionStore(s => s.state[activeLayerId])` to avoid fan-out re-renders. Phase 20 PITFALL S-02 carry-forward.
- **Internal-only `reset()` action:** `useInfoSelectionStore.getState().reset()` is called from non-React paths (lifecycle hooks). Popup dismiss handlers ALSO call it imperatively (not via subscription). Established pattern.
- **No `useMemo` on store updates:** Re-renders are cheap with selector-driven scope.
- **`dangerouslySetInnerHTML`:** No existing use in the codebase (greenfield). The popup template render path is the first use. Add an inline comment citing PROJECT.md Key Decision so future readers don't reflexively add a sanitizer.
- **`ol/proj.transform`:** EPSG:3857 ↔ EPSG:4326 conversion idiom for click coords. M-03 lock means projection is fixed; no need to pull from `mapRef.current.getView().getProjection()`.
- **Map widget container width/height:** `containerRef.current.clientWidth/clientHeight`. Use as `mapWidthPx`/`mapHeightPx` payload fields.

### Integration Points

1. **`MapChartRenderer.tsx` Effect (new):** Register/unregister `singleclick` handler. Gated by `getInfoEnabled(widgetConfig)`. Handler reads `mapRef.current` for extent + size, computes `clickLon`/`clickLat` via `ol/proj.transform`, kicks off sequential fan-out via a new helper.
2. **`MapChartRenderer.tsx` JSX:** Render `<InfoPopup />` (anchored via `ol/Overlay`) when `useInfoSelectionStore(s => s.activeLayerId) !== null`. Or: imperatively `map.addOverlay(...)` from an Effect that subscribes to `activeLayerId`.
3. **`InfoPopup.tsx` (new file at `kinetica_bi/src/components/charts/InfoPopup.tsx`):** Presentation component reading `useInfoSelectionStore`. Receives `dashboardLayers` (the visible-enabled-non-WKB list) + `widgetConfig` as props. Emits `onClose`, `onLayerSwitch(layerId)`, `onLoadMore()`. Sticky header with dropdown + close X; body with template-or-KV render of rows; footer with Load more.
4. **`renderInfoTemplate.ts` (new at `kinetica_bi/src/lib/renderInfoTemplate.ts`):** Pure helper. Spec at `renderInfoTemplate.spec.ts`. Phase 23 Info Card will import this same module — DO NOT inline the helper inside InfoPopup.tsx.
5. **`api/client.ts` (extend):** Add `infoQuery(payload): Promise<InfoQueryResponse>` near the existing v1.3 helpers (lines 585-620). Type both request and response per Phase 18 endpoint contract.
6. **`global.css`:** Add `.info-popup-*` classes for the anchored-tail variant. Reuse CSS variables from `--panel`, `--border`, `--shadow` (matches existing `.modal-content` styling).

### Anti-patterns / pitfalls (carry forward from prior phases)

- **PITFALL S-02 (Phase 12+ carry):** NEVER subscribe to `useInfoSelectionStore.state` (whole object) in render — scope to `state[activeLayerId]`. Whole-state subscriptions fan out on every layer mutation.
- **PITFALL M-03 (Phase 11+ carry):** OL View is locked to EPSG:3857. Click coords come out as EPSG:3857; transform to EPSG:4326 before sending to server.
- **No mid-async store mutations on stale activeLayerId:** When user switches dropdown layer A → B, then A's slow request finally returns, the `setSelection(A, ...)` would re-create A's wiped entry. Guard with the AbortController (canceled on switch) so the old promise rejects rather than running its `setSelection`. Mirrors v1.3 `clearMaterializingVersion` counter pattern (Phase 17 dep-array fix).
- **No view-of-views:** Phase 18 lock — info-query reads source table directly, not the materialized filter view. Don't try to pass `viewName` from `useFilterViewStore` into the info-query payload.
- **Don't sanitize `info_template`:** Locked PROJECT.md decision. Inline comment in renderInfoTemplate.ts cites it explicitly.
- **Don't subscribe to whole `dashboardLayersStore`:** Use a derived selector (the visible-enabled-non-WKB list as a memoized array). Otherwise every layer-config patch (auto-save) fires a popup re-render.

</code_context>

<specifics>
## Specific Ideas

- "Mirror Google Maps / OSM popup behavior" — anchored to map coord, follows pan/zoom, ~12px offset with CSS pointer tail, edge-flip, edge-clamp on off-screen pan.
- "Sequential top-down, stop on first hit; popup waits for hit before opening." — User-overrode the parallel-fan-out recommendation. Cheaper for typical case (top layer has the answer); quieter UX on empty clicks (no popup chrome that flashes open then says "0 records"). Trade-off accepted: layers below the first hit incur on-demand round-trip when user dropdown-switches.
- "Filter changes do NOT dismiss." — Popup is orthogonal to the filter pipeline (Phase 18 lock: source-table queries, not filtered views). User can compare 'records here' vs 'currently filtered chart data' simultaneously — this is the comparison workflow that justifies the architectural split.
- "All eligible layers in dropdown" — even unqueried-yet ones. Dashboard authors see the full layer set; on-demand query happens lazily on switch. Matches POPUP-V14-02 verbatim.
- The `ol/Overlay` is the first in the codebase. Establishing the pattern carefully here pays off for future hover/tooltip work in v2.

</specifics>

<deferred>
## Deferred Ideas

- **Hover-on-map preview** — Out of v1.4 (PROJECT.md Out-of-scope). Locked.
- **Aggregate views for heatmap/contour** ("info popup over a heatmap pulls the underlying records"): handled by `info_columns` selecting raw columns from the source table; aggregate/binned info-popups are AGG-V2-01 (deferred to v2).
- **Cross-widget broadcast** (other chart types subscribing to info-store as data source) — XWIDGET-V2-01 (deferred to v2).
- **URL/localStorage persistence of selection** — PERSIST-V2-01/02 (deferred to v2).
- **Template token syntax** — Claude's discretion this phase. If dashboard authors push back on `{column_name}` (vs `${...}` or `<%= ... %>`), revisit in a follow-up.
- **'Showing X of ~Y' total-estimate badge** — `totalEstimate` is in the endpoint response but not in the store shape. Phase 20 deliberately doesn't store it. Phase 21 popup can read it directly off the response and show inline if useful — Claude's discretion. Revisit if dashboard users want it surfaced.
- **Touch / mobile pan-zoom interactions on the popup** — Out of v1.4 default scope; this codebase's audience is desktop-first BI users. If touch UX surfaces in UAT, defer to a v2 polish phase.
- **Per-layer 'Check this layer' eager toggle** — alternative to lazy-on-switch. Not chosen because dropdown-switch already gives the user direct control over which layer to query.
- **Inline error banner inside popup body** (vs Toast) for Load-more failure — Toast was selected; if UAT shows users miss the toast, revisit.

</deferred>

---

*Phase: 21-map-click-popup*
*Context gathered: 2026-05-08*
