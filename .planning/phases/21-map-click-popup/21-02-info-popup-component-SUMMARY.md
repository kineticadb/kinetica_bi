---
phase: 21-map-click-popup
plan: 02
subsystem: ui
tags: [react, zustand, typescript, vitest, testing-library, css]

# Dependency graph
requires:
  - phase: 21-01-render-info-template
    provides: renderInfoTemplate helper + RenderResult discriminated union
  - phase: 20-info-selection-store
    provides: useInfoSelectionStore with scoped selector contract
  - phase: 19-config-schema
    provides: DashboardLayerDto with info_enabled / info_columns / info_template fields
  - phase: 18-spatial-spike-and-endpoint
    provides: POST /api/info/query endpoint contract (locked)
provides:
  - infoQuery client helper + InfoQueryRequest / InfoQueryResponse / SpatialColumns types in api/client.ts
  - InfoPopup.tsx presentation component (reads useInfoSelectionStore, emits onClose/onLayerSwitch/onLoadMore)
  - InfoPopup.spec.tsx — 20 vitest tests covering header, body modes, load-more, auto-dismiss, selector scoping
  - info-popup-* CSS classes in global.css (anchored-tail variant of modal styling)
affects: [21-03-map-chart-renderer-integration, 23-info-card]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scoped Zustand selector: useInfoSelectionStore((s) => s.activeLayerId !== null ? s.state[s.activeLayerId] : null) — NEVER whole s.state"
    - "Click-outside dismiss via transparent backdrop div onClick + popup body e.stopPropagation()"
    - "ESC dismiss via window.addEventListener('keydown') in useEffect (mirrors LayersModal pattern)"
    - "Auto-dismiss via useMemo eligibleIds Set + useEffect watching eligibleIds + activeLayerId"

key-files:
  created:
    - kinetica_bi/src/components/charts/InfoPopup.tsx
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx
  modified:
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "infoQuery helper mirrors materializeFilter POST pattern exactly — apiFetch + throwForStatus + AbortSignal threading"
  - "InfoPopup uses two separate scoped selectors (activeLayerId + entry) to prevent PITFALL S-02 fan-out re-renders"
  - "No setActiveLayer(null) — dismiss calls reset() per locked activeLayerId invariant from Phase 20"
  - "dangerouslySetInnerHTML with inline no-sanitize comment citing PROJECT.md Key Decision (locked; no DOMPurify)"
  - "th scope='row' added to kv table for accessibility (minor deviation from plan sketch, improves HTML semantics)"

patterns-established:
  - "Pattern: InfoPopup is pure presentation — reads store, emits callbacks, no side effects beyond ESC/auto-dismiss"
  - "Pattern: eligibleLayers prop derived by parent (Plan 21-03); InfoPopup never computes eligibility itself"

requirements-completed: [POPUP-V14-02, POPUP-V14-03, POPUP-V14-04, POPUP-V14-05]

# Metrics
duration: 5min
completed: 2026-05-08
---

# Phase 21 Plan 02: Info Popup Component Summary

**infoQuery POST helper + InfoPopup React component with scoped-selector store reads, template/kv rendering, load-more, and ESC/click-outside/auto-dismiss paths**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-08T15:03:26Z
- **Completed:** 2026-05-08T15:08:22Z
- **Tasks:** 2 (TDD: 4 commits — 2 RED + 2 GREEN)
- **Files modified:** 4

## Accomplishments

- `infoQuery` callable from Plan 21-03 click handler with fully typed request/response and AbortSignal threading
- InfoPopup renders all body states (template, kv, loading, empty, error) against seeded store state without an OL Map instance
- 20 InfoPopup spec tests + 6 infoQuery spec tests all green; tsc --noEmit clean; 47/47 combined suite green
- CSS block appended to global.css with 20 `.info-popup-*` class selectors ready for Plan 21-03 Overlay mount

## Locked Behaviors (with line numbers)

| Behavior | File | Line (approx) |
|----------|------|---------------|
| Scoped selector for activeLayerId | InfoPopup.tsx | 48 |
| Scoped selector for entry (PITFALL S-02) | InfoPopup.tsx | 50-52 |
| dangerouslySetInnerHTML call site | InfoPopup.tsx | 107-111 |
| No-sanitize inline comment (PROJECT.md lock) | InfoPopup.tsx | 105-106 |
| ESC handler via window.addEventListener | InfoPopup.tsx | 59-65 |
| Click-outside e.stopPropagation() | InfoPopup.tsx | 88 |
| Auto-dismiss eligibleIds useMemo | InfoPopup.tsx | 68-71 |
| Auto-dismiss useEffect | InfoPopup.tsx | 72-76 |
| No setActiveLayer(null) anywhere | InfoPopup.tsx | — (grep returns 0) |

## Test Counts

- **infoQuery describe block:** 6 tests (I1–I6) in client.spec.ts
- **InfoPopup describe block:** 20 tests (H1–H7, B1–B7, L1–L3, A1–A2, S1) in InfoPopup.spec.tsx
- **Combined suite:** 47/47 green (client.spec.ts + InfoPopup.spec.tsx + renderInfoTemplate.spec.ts)

## CSS Classes Added

`global.css` additions (after existing `@keyframes filtering-spin` block):

- `.info-popup-backdrop` — transparent click-outside dismiss target
- `.info-popup` — bordered panel (360px width, 60vh max-height, flex column)
- `.info-popup-header` — flex header with space-between alignment
- `.info-popup-layer-select` — flex:1 layer dropdown
- `.info-popup-close` — transparent X button (mirrors .modal-close)
- `.info-popup-body` — scrollable body flex:1
- `.info-popup-loading` — centered Loading… indicator
- `.info-popup-empty` — centered No records message
- `.info-popup-error` — centered error text (red)
- `.info-popup-rows` — flex column row container
- `.info-popup-row` — individual row with border + border-radius
- `.info-popup-row-template` — template-mode row (HTML via dangerouslySetInnerHTML)
- `.info-popup-row-kv` — kv-mode `<table>` (100% width, border-collapse)
- `.info-popup-footer` — footer with centered Load-more button
- `.info-popup-load-more` — Load-more button (disabled style: opacity 0.6)

## Task Commits

Each task committed atomically (TDD: RED then GREEN):

1. **Task 1 RED: infoQuery failing spec** - `5f0bd99` (test)
2. **Task 1 GREEN: infoQuery implementation** - `7b89337` (feat)
3. **Task 2 RED: InfoPopup failing spec** - `e09c06d` (test)
4. **Task 2 GREEN: InfoPopup component + CSS** - `8c59a78` (feat)

## Files Created/Modified

- `/kinetica_bi/src/api/client.ts` — Appended `infoQuery`, `InfoQueryRequest`, `InfoQueryResponse`, `SpatialColumns`, `InfoSpatialMode` exports
- `/kinetica_bi/src/api/client.spec.ts` — Added `describe("infoQuery")` block with 6 tests (I1–I6)
- `/kinetica_bi/src/components/charts/InfoPopup.tsx` — New file; 165 lines; presentation component
- `/kinetica_bi/src/components/charts/InfoPopup.spec.tsx` — New file; 398 lines; 20 tests
- `/kinetica_bi/src/styles/global.css` — Appended 70-line `.info-popup-*` CSS block

## Decisions Made

- **th scope="row":** Added `scope="row"` to kv table `<th>` elements for accessibility. Plan sketch omitted this but it improves HTML semantics with zero behavioral change.
- **20 spec tests vs minimum 16:** Added 4 extra tests during spec elaboration (B2 two-row template, B3 loading state, H2 dropdown value assertion, H3 option order). All align with plan behavior spec.
- **Load-more button text "Loading…" during loading:** When `entry.hasMore && entry.loading`, the button renders "Loading…" text (disabled). The plan spec said `disabled` but didn't specify alternate text — this makes the disabled state self-explanatory.

## Deviations from Plan

None — plan executed exactly as written. Minor elaborations (scope="row", extra spec tests) are additive, not structural.

## Issues Encountered

None. All tests passed on first run after implementation.

## Next Phase Readiness

Plan 21-03 (MapChartRenderer integration) can now:
- Import `infoQuery` from `../../api/client` for the click-handler fetch fan-out
- Import `InfoPopup` from `./InfoPopup` for `ol/Overlay` mounting
- Pass `eligibleLayers` (visible + info_enabled=1 + spatialMode!='wkb' layers) as prop
- Pass `layerNameFor` resolver (schema.table → display name)
- Wire `onClose` → `useInfoSelectionStore.getState().reset()` + `overlay.setPosition(undefined)`
- Wire `onLayerSwitch(id)` → `store.setActiveLayer(id)` + dispatch fresh fetch
- Wire `onLoadMore` → `store.setLoading(id, true)` → `infoQuery({..., page: entry.page+1})` → `store.appendPage` / `store.setError` → `store.setLoading(id, false)`

---
*Phase: 21-map-click-popup*
*Completed: 2026-05-08*
