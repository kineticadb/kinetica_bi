# Phase 20: info-selection-store - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship `useInfoSelectionStore` — a frontend Zustand slice (per-layerId session-only) that holds the dashboard's current map info-popup selection, plus its lifecycle reset wiring at the two canonical sites already used by `useFilterViewStore`. No popup or Info Card consumers in this phase — the store ships dormant-for-feature but reset-active. Phase 21 (`MapChartRenderer` click handler) is the designated first writer; Phase 23 (Info Card) is the designated first reader.

In scope: store file + spec, 7 actions, lifecycle reset hooks at `DashboardOpen` cleanup + `App.tsx` UNAUTHORIZED handler.

Out of scope: any popup UI, click handler, Info Card, network calls, layer-config UI, template rendering helper. (All belong to Phases 21–23.)

</domain>

<decisions>
## Implementation Decisions

### Store shape
- Top-level state: `state: Record<layerId, InfoSelectionEntry>` + `activeLayerId: number | null`.
- `InfoSelectionEntry`: `{ rows: Record<string, unknown>[]; columns: string[]; page: number; hasMore: boolean; loading: boolean; error: string | null }`.
- Locked by REQUIREMENTS.md STORE-V14-01; not re-litigated.

### Action contract (7 actions, not 6)
REQUIREMENTS.md STORE-V14-01 lists 6 actions. Discussion added a 7th: `appendPage`. Final action set:

1. `setSelection(layerId: number, payload: { rows, columns, page, hasMore }): void` — REPLACE semantics (fresh-click path). Caller passes `page` explicitly; store does not auto-increment. Does NOT auto-clear `loading` — caller toggles.
2. `appendPage(layerId: number, payload: { rows, page, hasMore }): void` — APPEND semantics (Load-more path). Pushes new rows onto existing entry, sets `page` and `hasMore` from payload. `columns` unchanged (already set by initial setSelection). Caller passes `page` explicitly; store does NOT auto-increment.
3. `clearSelection(layerId: number): void` — DELETE-KEY semantics (mirrors `useFilterViewStore.clearView`). Removes the per-layerId entry entirely. No-op when entry absent.
4. `setActiveLayer(layerId: number): void` — Number-only signature (no `null` overload). When `layerId === current activeLayerId`, no-op (reference-stable; mirrors `filterStore` exact-duplicate dedupe). When changing, the **prior** layer's entry is fully wiped via delete-key (rows, columns, page, hasMore all gone — equivalent to `clearSelection(prior)` inline). The **new** layer's entry is left untouched (Phase 21 click handler is responsible for setSelection on the new layer; setActiveLayer is a pure focus-switch).
5. `setLoading(layerId: number, loading: boolean): void` — Per-layer flag flip. Caller toggles before/after fetch (both fresh-click and Load-more paths). Creates a placeholder entry if absent (mirrors `useFilterViewStore.markMaterializing` placeholder pattern with `rows: [], columns: [], page: 0, hasMore: false, error: null`).
6. `setError(layerId: number, error: string | null): void` — Per-layer error flip. Append-fail path: caller leaves rows in place and calls setError(msg) — existing pages remain visible, user can retry. Creates a placeholder entry if absent (same pattern as setLoading).
7. `reset(): void` — Top-level wipe. Sets `state = {}` and `activeLayerId = null`. Internal-only, called from lifecycle sites (not user-facing).

### Initial state
- `activeLayerId: null` (matches CARD-V14-04 empty-state path used by Phase 23 Info Card).
- `state: {}`.

### activeLayerId invariant
- `activeLayerId` is non-null **iff** the user has a live selection visible. The only paths to null are: (a) initial state, (b) `reset()`. There is no `setActiveLayer(null)` path — the type signature forbids it. POPUP-V14-05 dismiss must call `reset()`, not setActiveLayer(null).
- This means: when `activeLayerId` is non-null, `state[activeLayerId]` is guaranteed to exist (Phase 21 click handler must `setSelection` before `setActiveLayer`). Phase 23 Info Card can rely on this when reading.

### Layer-switch state retention
- On `setActiveLayer(B)` where current is `A` (and `A !== B`): `state[A]` is fully deleted (rows, columns, page, hasMore, loading, error all gone). Returning to A re-fetches from scratch via the click handler.
- `state[B]` is NOT touched by `setActiveLayer`. If B has a prior cached entry from earlier in the session, it survives (Phase 21 click handler decides whether to overwrite it via setSelection or not).
- Same-layer `setActiveLayer(A)` when current is `A`: full no-op (no state change, no version bump).

### Lifecycle reset wiring scope (this phase)
Phase 20 wires `useInfoSelectionStore.reset()` at both canonical sites — does NOT ship dormant. STORE-V14-03 / STORE-V14-04 acceptance demands working resets, and the integration sites are already established by `useFilterViewStore`:

- `DashboardsPage.tsx` `DashboardOpen` cleanup effect — call `useInfoSelectionStore.getState().reset()` alongside the existing `useFilterViewStore.getState().reset()` and `useFilterStore.getState().reset()` calls (around `DashboardsPage.tsx:396-397`).
- `App.tsx` UNAUTHORIZED event handler — call `useInfoSelectionStore.getState().reset()` alongside the existing two store resets (around `App.tsx:53-54`).

Dashboard switch path uses `reset()` directly. Does NOT use `setActiveLayer(null)` (which doesn't exist anyway per the activeLayerId invariant above).

### Reference-stable per-layerId update pattern
- All mutations to `state[layerId]` produce a new top-level `state` object but leave entries for OTHER layerIds with their object identity intact. Mirrors `useFilterViewStore.setView` (filterViewStore.ts:59-73).
- Selector consumers in Phase 21/23 must scope to `s.state[layerId]` (PITFALL C-02 / S-02 carry-forward) so re-renders don't fan out across all layers when one updates.

### Type definitions
- `layerId: number` — matches `DashboardLayerDto.id` (number, not string).
- `columns: string[]` — array of column names from the spatial query response (mirrors `POST /api/info/query` response shape from Phase 18).
- `rows: Record<string, unknown>[]` — per the SPATIAL-V14-04 endpoint contract.
- Store file: `kinetica_bi/src/store/infoSelectionStore.ts` + `infoSelectionStore.spec.ts` (matches naming + location of `filterViewStore.ts`).

### Spec coverage (Claude's discretion)
Spec must cover: all 7 actions including no-op paths (clearSelection/setActiveLayer same-layer/reset), placeholder-creation pathways for setLoading/setError on absent entries, layer-switch delete-key for prior entry, append-fail rows-preserved path, reference-stability assertion (other layers' entry identity preserved on single-layer mutation). Existing Zustand reset shim (`__mocks__/zustand.ts` + `vi.mock("zustand")` in `src/test/setup.ts`) auto-covers the store — no extra test wiring.

### Claude's Discretion
- Internal placeholder shape for setLoading / setError on absent layerId (suggested: `{ rows: [], columns: [], page: 0, hasMore: false, loading: false, error: null }`).
- Order of operations inside `setActiveLayer` body (delete prior + set activeLayerId atomically — single `set()` call).
- Whether to expose `setLoading` / `setError` as object-payload or positional args (positional matches existing store conventions).
- Spec test names and grouping.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 20: info-selection-store" — Phase boundary, success criteria, depends-on Phase 19.
- `.planning/REQUIREMENTS.md` §"Info Selection Store (STORE)" — STORE-V14-01..05 (store shape, session-only, dashboard reset, logout reset, layer-switch page reset).

### Locked v1.4 architectural decisions
- `.planning/PROJECT.md` §"Current Milestone: v1.4 Map Info Popup" — Out-of-scope list (URL/DB persistence deferred, hover deferred, etc.).
- `.planning/STATE.md` §"Key v1.4 Architecture Decisions (locked at roadmap creation)" — Store-before-popup ordering, Info Card pure-consumer lock, lifecycle reset integration points (DashboardOpen + App.tsx), session-only store policy.

### Pattern references (mirror these in this phase)
- `kinetica_bi/src/store/filterViewStore.ts` — reference-stable per-key update pattern, placeholder-on-missing pattern (`markMaterializing`), delete-key clear pattern (`clearView`), internal-only `reset()` action, Zustand-reset-shim auto-coverage. THE primary template for this phase.
- `kinetica_bi/src/store/filterStore.ts` — exact-duplicate dedupe (no-op on same value), version-counter increment-on-real-change pattern, `reset()` as internal-only action.
- `kinetica_bi/src/App.tsx` lines 9-54 — canonical UNAUTHORIZED handler reset call site (paired stores currently: filterStore + filterViewStore; Phase 20 adds infoSelectionStore as the third).
- `kinetica_bi/src/components/DashboardsPage.tsx` lines 350-397 — canonical DashboardOpen cleanup reset call site.

### Endpoint shape (response will populate this store from Phase 21)
- Phase 18 `routes.info-query` (mounted at `kinetica_bi/server/src/index.ts:781-938`) — `POST /api/info/query` response shape `{ rows, columns, totalEstimate?, hasMore, page }` is what Phase 21 click handler will pass to `setSelection` / `appendPage`. Phase 20 store types must align byte-for-byte with this response.

### Test infra
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand reset shim activated via `vi.mock("zustand")`. Stores under `src/store/*.ts` are auto-covered; no extra plumbing needed.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useFilterViewStore` (kinetica_bi/src/store/filterViewStore.ts:30-129): Direct template — copy structure, rename types/actions, adapt to new shape. The `markMaterializing` placeholder-on-missing pattern is the model for `setLoading`/`setError` on absent layerId. The reference-stable `setView` mutation pattern (lines 59-73) is the model for every per-layerId mutation in this store.
- `useFilterStore` (kinetica_bi/src/store/filterStore.ts:33-102): Reference for exact-duplicate dedupe (no-op on same-value, lines 53-58) — pattern reused for `setActiveLayer` same-layer no-op.
- Zustand reset shim (`kinetica_bi/__mocks__/zustand.ts` + `src/test/setup.ts`): Auto-covers any new store under `src/store/*.ts`. No spec-side reset boilerplate needed.

### Established Patterns
- **Two-store split** (locked v1.3): Filter chips in `useFilterStore`, server-resolved view names in `useFilterViewStore`. Phase 20 adds a third orthogonal store for info-selection — does NOT extend either existing store. All three reset together at the same two lifecycle sites.
- **Internal-only `reset()` action**: Both existing stores expose `reset` in their action list but it's only called from App.tsx + DashboardsPage cleanup. Phase 20 follows the same pattern (no UI surface for reset).
- **Reference-stable per-key updates**: `views: { ...state.views, [tableId]: nextEntry }` pattern produces new top-level object but other keys keep object identity. Selector consumers scope to `s.views[tableId]` (PITFALL C-02). Phase 20 mirrors this exactly with `state[layerId]`.
- **No `useMemo` on store updates**: re-renders are cheap with selector-driven scope; entries that don't change keep object identity.
- **Spec via vitest + Zustand reset shim**: No `beforeEach` reset boilerplate — the shim handles it. Spec just imports the store and exercises actions.

### Integration Points
1. `kinetica_bi/src/App.tsx` UNAUTHORIZED handler (lines 45-54) — add `useInfoSelectionStore.getState().reset()` alongside the existing two resets. Three-store-reset block is the canonical lifecycle pattern after Phase 20.
2. `kinetica_bi/src/components/DashboardsPage.tsx` DashboardOpen cleanup (lines 389-397) — add `useInfoSelectionStore.getState().reset()` in the same block.
3. Phase 21 will import the store at `kinetica_bi/src/components/MapChartRenderer.tsx` (or wherever the click handler lands). Phase 23 will import it at the new Info Card chart renderer. Phase 20 ships no consumer wiring.

</code_context>

<specifics>
## Specific Ideas

- "Mirror useFilterViewStore exactly" — naming, file location, action conventions, reference-stable update pattern, internal-only reset.
- The `appendPage` action exists specifically because Phase 21 popup will fire "Load more" requests that need to extend the visible row list without losing prior pages. Caller-side merging would force every popup tick to read-then-write, which is a bug factory. Store ownership of the cumulative invariant is cleaner.
- Append-fail keeps rows on purpose: the popup user has scrolled through 3 pages, page 4 fails — wiping pages 1-3 would be hostile UX. Mirrors `clearMaterializing` preserves-prior-fields pattern (filterViewStore.ts:104-113).

</specifics>

<deferred>
## Deferred Ideas

- Spec coverage for Info Card consumer behavior — belongs to Phase 23.
- Store-side multi-layer fan-out fetch coordination — Phase 21 click handler concern, not store concern.
- URL/localStorage persistence — explicitly deferred to PERSIST-V2-01/02 (out of v1.4 scope).
- Aggregate-bucket store entries (heatmap/contour layer info) — AGG-V2-01 (out of v1.4 scope).
- Cross-widget broadcast (existing chart types subscribing to info-store as data source) — XWIDGET-V2-01 (out of v1.4 scope).
- `totalEstimate` consumption from the endpoint response — Phase 20 store shape doesn't include it (REQUIREMENTS.md STORE-V14-01 doesn't list it). Phase 21 popup can read it from the response directly without storing if needed; revisit if popup UX wants a "showing X of ~Y" badge.

</deferred>

---

*Phase: 20-info-selection-store*
*Context gathered: 2026-05-08*
