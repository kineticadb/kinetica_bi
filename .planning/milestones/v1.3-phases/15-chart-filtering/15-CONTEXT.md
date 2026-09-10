# Phase 15: chart-filtering - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the production consumers of Phase 13's `/api/filter/materialize` endpoint and Phase 14's dormant `useFilterViewStore` + helpers. Phase 15 ships:

1. **`AggregatedWidgetRenderer` as the SOLE materialize trigger** — debounced 300ms `useEffect` on `filterVersion` change; calls `markMaterializing → await materializeFilter(args, signal) → setView` (or `dropFilterView → clearView` on empty filters); dedicated `materializeAbortRef` separate from chart-query `AbortController`.
2. **FROM-swap in chart SQL** — `AggregatedWidgetRenderer` (FILT-V13-01) and `RecordsTableRenderer` (FILT-V13-02) substitute `FROM <table>` with `FROM <view_name>` when `useFilterViewStore.views[tableId].viewName` is non-null. When no filter is active, query raw table — zero materialize round-trips.
3. **Atomic dead-code deletion** — `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` removed from `filterStore.ts` IN THE SAME PLAN as the `AggregatedWidgetRenderer` FROM-swap landing (FILT-V13-05). `filterStore.spec.ts` blocks for those functions deleted. `tsc --noEmit` clean post-deletion.
4. **Per-widget "Filtering..." badge** — inline next to widget title in card header; small spinner glyph + "Filtering..." text; appears the moment `markMaterializing` fires, disappears on `setView`/`clearView`/error; renders for every widget on the filtered tableId.
5. **Dual-path TTL expiry recovery** (LIFE-V13-01/02):
   - **Proactive**: client checks `Date.now() >= useFilterViewStore.views[tableId].expiresAt` before each chart query; if expired, clears the stored view and re-materializes silently before the chart query runs.
   - **Reactive**: `.catch()` on chart query detects `isViewNotFoundError(err)` (matches `/SqlEngine: Object '[^']+' not found/i` substring + Kinetica internal code `S/SDc:1513` at HTTP 400, per Phase 13 spike S3 capture) → clears view from store → re-materializes → retries the chart query.
6. **Lifecycle reset extensions** (LIFE-V13-03/04) — `App.tsx:40-44` logout effect extended to fire `useFilterViewStore.reset()` AND fire-and-forget `dropFilterView` for each active view. `DashboardsPage.tsx:379-383` dashboard-switch cleanup extended identically. Page-refresh / tab-close = no client cleanup; Kinetica TTL is sole cleanup mechanism (LIFE-V13-05 — locked, no work).
7. **`DashboardContext`** — new `src/components/DashboardContext.tsx` exposing `{ dashboardId: number }` only; mounted inside `DashboardOpen` wrapping the widget grid; throws on missing-context access (no silent fallback). Consumers: `AggregatedWidgetRenderer` (and Phase 16 `MapChartRenderer` if it needs dashboardId — out of scope here).

**Out of scope for Phase 15:**

- Map widget LAYERS-swap (`MAP-V13-01..06`) → Phase 16
- End-to-end verification + test fixture (`VERIFY-V13-01..02`) → Phase 17
- OIDC-mode S2.b DDL re-probe → **deferred to Phase 17 verification** (was tagged Phase 15 in STATE.md; user-locked migration to keep Phase 15 focused on FROM-swap pipeline; Phase 17 owns milestone close anyway)
- `wmsUrlBuilder.ts` `QUERY` / `FILTER_PARAM` removal + `_v` → `_mv` rename (`MAP-V13-03`) → Phase 16
- `useFilterStore` modifications — VSTORE-V13-03 lock holds: chip state byte-unchanged. Phase 15 only ADDS a view-store subscription in renderers and REMOVES the four dead utility functions.
- Map-renderer materialize triggering — MapChartRenderer + RecordsTableRenderer are PURE consumers; only `AggregatedWidgetRenderer` triggers materialize (prevents 2N redundant DDL when chart + map share a table — VSTORE-V13-02 / FILT-V13 lock).

</domain>

<decisions>
## Implementation Decisions

### Plan staging (user-locked: 5 fine-grained plans, each ships green)

Phase 15 splits into 5 plans. **Each plan must leave `tsc --noEmit` clean and full vitest suite green** — every commit is a deployable state. No "temporary unused-import" intermediate states.

- **15-01 — DashboardContext + dashboardId plumbing**
  - New file `kinetica_bi/src/components/DashboardContext.tsx` — exports `DashboardContext` (React context) + `useDashboardContext()` hook.
  - Provider value shape: `{ dashboardId: number }` only — minimal surface (no associated tableIds, no drop helpers, no full DashboardDto).
  - Hook throws `"useDashboardContext must be used inside DashboardContext.Provider"` on missing context — fail-loud idiom; tests must wrap renderers in the provider.
  - Mount site: `DashboardOpen` in `DashboardsPage.tsx`, wrapping the widget grid (NOT at DashboardsPage level, NOT at App.tsx level — tight scope, auto-cleared on dashboard switch).
  - No production consumer in 15-01 — context is dormant. 15-02 wires the first reader.
  - Spec: `DashboardContext.spec.tsx` covering provider/consumer happy path + missing-context throw.

- **15-02 — AggregatedWidgetRenderer trigger + FROM-swap + "Filtering..." badge + atomic dead-code deletion**
  - Add materialize trigger to `AggregatedWidgetRenderer` (`WidgetRenderer.tsx:198-253`):
    - Subscribe to `useFilterViewStore.views[tableId]` via reference-stable selector (PITFALL C-02 lock).
    - On `[sql, filterVersion]` effect: `clearTimeout` + `setTimeout(300ms, …)` debounce; inside the timer:
      - If `tableFilters.length > 0`: `markMaterializing(tableId)` → `await materializeFilter({ dashboardId, tableId, filters: tableFilters }, materializeAbortRef.current.signal)` → `setView(tableId, { viewName, expiresAt })`.
      - If `tableFilters.length === 0`: `dropFilterView({ dashboardId, tableId })` (fire-and-forget — no `await` at the call site) → `clearView(tableId)`.
    - Dedicated `materializeAbortRef = useRef<AbortController | null>(null)` separate from the chart-query `AbortController` (V13-P-10 lock); abort previous before each new materialize.
  - FROM-swap in the chart-query effect:
    - Read `viewName` via selector: `const viewName = useFilterViewStore((s) => s.views[tableId]?.viewName)`.
    - If `viewName` truthy: regex/string-scan replace of `FROM <table>` → `FROM <viewName>` in `widget.config.sql`. Same predictable-SQL-shape strategy that Phase 9 `injectWhereClause` used (no full SQL parse). Helper extracted to `src/lib/fromSwap.ts` (or kept inline — planner picks).
    - If `viewName` falsy: query raw table SQL unchanged (FILT-V13-03 — zero materialize overhead on cold loads).
  - "Filtering..." badge:
    - Inline in widget card header next to widget title (matches v1.2 editable-title chrome at top of every card).
    - Small spinner glyph + "Filtering..." text (use existing CSS spinner if one exists; else a simple animated unicode/CSS dot — planner picks).
    - **No threshold / grace period** — badge appears the moment `markMaterializing` fires, disappears on `setView` / `clearView` / error. Cleanest mental model; sub-100ms flicker is acceptable.
    - Renders for **every widget on the filtered tableId** — implementation = each widget independently subscribes to `useFilterViewStore.views[tableId]?.materializing`. When user clicks a chart, all widgets on that table flash the badge for the materialize duration.
    - Existing chart data remains visible underneath the badge (REQUIREMENTS FILT-V13-04 lock — NOT a full overlay).
    - Existing `loading` state continues to cover the chart-query phase (the second visual phase after materialize completes).
  - Toast on materialize failure (per Phase 14 user-lock — "toast every failure"):
    - `PermissionError` (403) → `useToastStore.getState().showToast(err.message, "error")` (server returns `{ error: string }` with NO `code` field — Phase 13 convention; toast text is the server message verbatim).
    - `UpstreamError` (502) / generic `Error` → same toast pattern.
    - `AbortError` → silent (matches Phase 9 `WidgetRenderer.tsx:243` lock).
    - On any non-abort failure: do NOT call `setView()` — leaves store entry empty (or `materializing: false` if `markMaterializing` ran) so the chart query falls through to raw `FROM <table>`.
  - **Atomic dead-code deletion** (FILT-V13-05):
    - Remove `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `kinetica_bi/src/store/filterStore.ts`.
    - Remove the corresponding test blocks from `kinetica_bi/src/store/filterStore.spec.ts`.
    - Remove imports from `WidgetRenderer.tsx:25-29` (the `buildWhereClause` / `injectWhereClause` / `ActiveFilter` import block — keep `useFilterStore` + `ActiveFilter` re-import if still needed).
    - `tsc --noEmit` MUST be clean at end of plan — no orphan callers anywhere in the codebase.
  - Spec: extend `WidgetRenderer.spec.tsx` with materialize-trigger + FROM-swap + badge assertions. Use `vi.mock("../../api/client")` to stub `materializeFilter` / `dropFilterView`.

- **15-03 — RecordsTableRenderer FROM-swap consumer + badge**
  - `RecordsTableRenderer` (`WidgetRenderer.tsx:852-1068`) subscribes to `useFilterViewStore.views[tableId]?.viewName` via the same scoped selector pattern.
  - Replace `const sql = \`SELECT ${colsClause} FROM ${table}${orderBy} LIMIT ...\`` with `const fromSource = viewName ?? table` then `\`FROM ${fromSource}\``. Same change applies to the COUNT(*) query at line 937.
  - Total-count effect (`useEffect` at line 932) must re-fire on `viewName` change so the row count narrows post-filter (REQUIREMENTS FILT-V13-02 success-criterion #2).
  - **No materialize trigger here** — `RecordsTableRenderer` is a PURE consumer. The `AggregatedWidgetRenderer` on the same table fires materialize; this renderer reacts. (If a dashboard has ONLY a records table on a given tableId and no other AggregatedWidgetRenderer, materialize will not fire. That is acceptable per the locked architecture — known limitation, addressed only if v1.3 verification surfaces it; Phase 17 may flag.)
  - "Filtering..." badge: same pattern as 15-02 (subscribe to `materializing`, render in card header next to widget title).
  - Spec: extend `WidgetRenderer.spec.tsx` records-table block with view-name FROM-swap assertions.

- **15-04 — TTL recovery (proactive + reactive)**
  - **Proactive** (LIFE-V13-01) — in `AggregatedWidgetRenderer` and `RecordsTableRenderer` chart-query effect:
    - Before each `runSql` call, check `Date.now() >= useFilterViewStore.views[tableId]?.expiresAt`. If expired: `clearView(tableId)` → trigger materialize re-run (effectively schedules a fresh materialize via the next `filterVersion` cycle, OR directly invokes the materialize trigger inline — planner picks based on minimal-duplication).
    - User sees: "Filtering..." badge briefly while view is rebuilt → chart data appears. No toast, no error UI.
  - **Reactive** (LIFE-V13-02) — chart-query `.catch` path:
    - New helper `isViewNotFoundError(err: unknown): boolean` in `kinetica_bi/src/lib/kineticaErrors.ts` (or co-located — planner picks). Pattern locked: matches `/SqlEngine: Object '[^']+' not found/i` substring AND HTTP status 400 AND error text contains `S/SDc:1513`. (Phase 13 spike S3 verbatim capture: `SqlEngine: Object '<view-name>' not found (S/SDc:1513)` at HTTP 400.)
    - When the chart query hits this: `clearView(tableId)` → re-fire materialize → retry the chart query ONCE.
    - If the retry's materialize itself fails (PermissionError / UpstreamError) → toast (per "toast every failure" lock); chart falls through to raw `FROM <table>` (no view name, no FROM-swap).
    - If the retry's chart query also returns view-not-found → fall through to raw `FROM <table>`; do NOT loop indefinitely (max 1 reactive retry).
  - Spec coverage: mock `runSql` to throw the verbatim Kinetica error string; assert clearView + retry sequence; assert no infinite loop; assert silence on first recovery, toast on retry failure.

- **15-05 — Lifecycle reset extensions**
  - `App.tsx:40-44` logout effect — extend the existing `if (status === "unauthenticated")` block:
    1. Read active tableIds from `useFilterViewStore.getState().views` (snapshot keys before reset).
    2. For each active tableId, fire-and-forget `dropFilterView({ dashboardId, tableId }).catch(() => {})` — call site does NOT `await`; errors silently swallowed (we're cleaning up; user is logging out; nothing to surface).
    3. Then `useFilterViewStore.getState().reset()` AND `useFilterStore.getState().reset()` (existing call).
    4. **dashboardId source for the cleanup loop:** read from each entry's stored value — but views entries don't carry dashboardId today. Two options for the planner: (a) extend `FilterViewEntry` with `dashboardId` field (server-side response is per-`(dashboardId, tableId)`, so the field is already known at `setView` time); or (b) derive from current dashboard context (problem: at logout time the user might not be on a dashboard). **Recommend option (a)** — store `dashboardId` on the entry; minor schema extension to `FilterViewEntry`; cleanest cleanup semantics. Planner verifies and locks.
  - `DashboardsPage.tsx:379-383` dashboard-switch cleanup — extend the existing `useEffect([dashboard.id])` cleanup return:
    1. Snapshot active tableIds from `useFilterViewStore`.
    2. For each, fire-and-forget `dropFilterView({ dashboardId, tableId }).catch(() => {})`.
    3. Then `useFilterViewStore.getState().reset()` AND existing `useFilterStore.getState().reset()`.
    4. dashboardId source: same as logout — recommend storing on the entry.
  - Spec: cover both lifecycle paths via vitest renderer specs / a small App.spec.tsx integration test (planner picks).
  - **Page refresh / tab close** (LIFE-V13-05) — no client work; Kinetica's 5-min sliding TTL handles orphan cleanup. Plan acknowledges and skips.

### "Filtering..." badge UX (user-locked)

| Decision | Choice |
|----------|--------|
| Position | Inline next to widget title in existing card header chrome |
| Visual | Text + spinner icon (small inline spinner glyph + "Filtering..." text) |
| Threshold | None — show always; sub-100ms flicker is acceptable |
| Scope | Every widget on the filtered tableId (each widget subscribes independently to `useFilterViewStore.views[tableId]?.materializing`) |
| Layering | Existing chart data visible underneath; existing `loading` state continues to cover the post-materialize chart-query phase |
| Aria / a11y | Claude's Discretion — recommend `aria-busy` on the widget card during materializing |

### `DashboardContext` plumbing (user-locked)

- **File**: new `kinetica_bi/src/components/DashboardContext.tsx`.
- **Shape**: `{ dashboardId: number }` only. NOT the full `DashboardDto`; NOT a list of associated tableIds; NOT a drop helper (lifecycle stays in App.tsx + DashboardsPage where the existing `useFilterStore.reset()` calls live).
- **Mount**: inside `DashboardOpen` (in `DashboardsPage.tsx`), wrapping the widget grid. NOT at App.tsx (over-broad), NOT at DashboardsPage component (would need null handling for "no dashboard open" case).
- **Missing-context behavior**: `useDashboardContext()` THROWS — fail-loud. Tests must wrap renderers in the provider; this mirrors real runtime where `AggregatedWidgetRenderer` only renders inside an open dashboard.
- **Consumer in Phase 15**: `AggregatedWidgetRenderer` calls `useDashboardContext().dashboardId` to populate `materializeFilter` / `dropFilterView` arg. `RecordsTableRenderer` does NOT need it (pure consumer — never calls materialize). Phase 16 `MapChartRenderer` evaluates need separately (out of scope here).

### Dead-code deletion timing (user-locked)

- Plan **15-02** removes `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `filterStore.ts` AND removes the corresponding spec blocks AND removes the imports from `WidgetRenderer.tsx` — all in the same commit as the FROM-swap landing. Atomic. `tsc --noEmit` MUST be clean post-15-02.
- `RecordsTableRenderer` in 15-03 already does not call these utilities (it builds SQL inline at line 915 with template-literal interpolation; no WHERE injection). So 15-03 just adds the FROM-swap and badge subscription — no additional cleanup required.

### OIDC S2.b DDL re-probe (user-locked migration)

- Deferred from Phase 15 to **Phase 17 verification**. STATE.md tagged it to either Phase 15 LIFE-V13-02 or Phase 17 — user picked Phase 17 (cleaner separation; Phase 17 owns milestone close).
- Phase 15 supertest coverage stays as-is (the existing Phase 13 supertests in `tests/routes.filter.materialize.spec.ts` cover both `AUTH_MODE=password` and `AUTH_MODE=oidc` with stubbed sessions — that's sufficient for Phase 15 to ship). Phase 17 runs the live deployed-Kinetica probe against an OIDC session.

### Plan ordering (user-locked)

15-01 → 15-02 → 15-03 → 15-04 (recovery) → 15-05 (lifecycle). Recovery is a chart-renderer concern (proactive/reactive code paths in the same renderers that 15-02/03 just wired) — natural adjacency. Lifecycle resets are higher-level App.tsx / DashboardsPage concerns that build on a fully-wired chart filtering pipeline. Each plan ships green; no in-flight intermediate states.

### Claude's Discretion

- Exact CSS classes / spinner glyph for the "Filtering..." badge (target: matches existing widget chrome; planner picks based on existing `widget-*` styles + any spinner already used in `<LayersModal>` or elsewhere).
- Whether `fromSwap` regex helper is extracted to `src/lib/fromSwap.ts` or kept inline in `WidgetRenderer.tsx`.
- Whether `isViewNotFoundError` lives in `src/lib/kineticaErrors.ts` (new file), `src/api/client.ts` (existing typed-error neighborhood), or co-located in `WidgetRenderer.tsx`.
- Test-spec file count and split (one big `WidgetRenderer.spec.tsx` extension vs split into `materialize-trigger.spec.tsx` / `from-swap.spec.tsx` / `ttl-recovery.spec.tsx`).
- Whether `FilterViewEntry` extension to carry `dashboardId` happens in 15-02 (proactive — used by 15-05 cleanup loops) or 15-05 (when the cleanup loops are wired). Planner picks; recommend 15-02 for cohesion with the materialize-trigger code that calls `setView`.
- Whether the badge component is a new `<FilteringBadge tableId={n} />` or inline JSX in each renderer's card-header block.
- Whether to add `aria-busy={materializing}` on the widget card root element.
- Exact retry semantics for reactive recovery: at most 1 retry is locked; planner decides whether the retry path also re-fires `markMaterializing` (likely yes, for badge consistency).
- Whether the proactive `Date.now() >= expiresAt` check uses a small helper (e.g., `isViewExpired(entry)`) or inline arithmetic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone (project-level)

- `.planning/PROJECT.md` § "Current Milestone: v1.3 Unified Dashboard Filtering" — Locked architecture; FROM-swap + LAYERS-swap target features; v1.2 dead-code list; two-store split rationale
- `.planning/REQUIREMENTS.md` § "Chart Filtering (FROM-swap)" — FILT-V13-01..05 full specs
- `.planning/REQUIREMENTS.md` § "Lifecycle & Recovery" — LIFE-V13-01..05 full specs
- `.planning/REQUIREMENTS.md` § Traceability — Phase 15 mapping (10 requirements)
- `.planning/ROADMAP.md` § Phase 15 — Goal + 6 success criteria
- `.planning/STATE.md` — Phase 13/14 lockdown; Phase 13 spike findings (especially S3 verbatim error capture: `SqlEngine: Object '<view-name>' not found (S/SDc:1513)` at HTTP 400 — drives `isViewNotFoundError` regex)

### Phase 14 inheritance (mandatory reads — Phase 15 is the first production caller of Phase 14's plumbing)

- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Trigger wiring scope" — Phase 14 user-lock migrating ROADMAP Phase 14 success-criterion #3 + VSTORE-V13-02 dispatch portion to Phase 15
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Error UX" — Toast-every-failure lock; PermissionError / UpstreamError / AbortError handling rules
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Reset wiring scope" — Phase 14 ships `reset()` action; Phase 15 LIFE-V13-03/04 wires it
- `.planning/phases/14-filter-view-store/14-RESEARCH.md` § "Phase 15 caller pattern" — Templates for `markMaterializing → await materializeFilter → setView` ordering; abort-controller separation; toast routing

### Phase 13 inheritance (endpoint contract — DO NOT REDEFINE)

- `.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md` — Endpoint shape; view-name format; OIDC sanitization; error-translation conventions
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` — S1-S4 spike findings (S3 captured the verbatim "view not found" error string Phase 15 needs for `isViewNotFoundError`)
- `kinetica_bi/server/src/index.ts:667-728` — `POST /api/filter/materialize` and `DELETE /api/filter/materialize` reference implementation. POST: `{ dashboardId, tableId, filters }` → `{ viewName, expiresAt }`. DELETE: `?dashboardId=N&tableId=M` → `{ dropped: true }`.
- `kinetica_bi/server/src/lib/viewNaming.ts` — View-name builder; regex `/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/` for any client-side validation.

### v1.2 carry-forward (Phase 9 / 10 patterns Phase 15 extends or replaces)

- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — `useFilterStore` shape (BYTE-UNCHANGED in Phase 15 — VSTORE-V13-03 lock); cap/dedupe semantics; cross-dashboard reset wiring at `App.tsx:40-44` and `DashboardsPage.tsx:379-383` (Phase 15 EXTENDS these hooks)
- `.planning/phases/10-existing-chart-drill-down/10-CONTEXT.md` — `dispatchDrillDown` flow (UNCHANGED); `cfg.drillDownColumn` schema; click → addFilter sequence that drives the materialize trigger Phase 15 wires
- v1.2 PITFALL C-02 (selector scope = `views[tableId]` for hot widgets); C-03 (clear data on filter change — show loading); D-04 (10-cap toast); S-02 (primitive dep `filterVersion`)

### v1.3 research (commit `e68080f`)

- `.planning/research/SUMMARY.md` — Synthesized stack + pitfalls + architecture overview
- `.planning/research/ARCHITECTURE.md` § Q3 (debounce in `AggregatedWidgetRenderer` `useEffect`); § Q5 (FROM-swap consumer pattern); § "Re-render triggers" table
- `.planning/research/PITFALLS.md`:
  - V13-P-01 (setView post-200 only, no optimistic updates)
  - V13-P-02 (`materializeAbortRef` separate from chart-query AbortController)
  - V13-P-03 (proactive `expiresAt` check before chart query)
  - V13-P-04 (reactive `isViewNotFoundError` catch + retry)
  - V13-P-09 (multi-tab same-user same-session last-write-wins — accepted)
  - V13-P-10 (helper signature accepts `signal?: AbortSignal`)
  - V13-P-11 (ref-stable per-table updates)
  - V13-P-12 (DDL permission failure → toast + fall through to raw table)

### Codebase maps (READ BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter — match existing style
- `.planning/codebase/STRUCTURE.md` — `src/store/`, `src/components/`, `src/lib/`, `src/api/` placement
- `.planning/codebase/STACK.md` — Existing dependency baseline (Recharts, OpenLayers, Zustand, vitest); zero new client deps for Phase 15
- `.planning/codebase/TESTING.md` — Spec naming + setup conventions; vitest + jsdom + @testing-library/react; Zustand reset shim auto-coverage

### Existing code (mandatory read before writing)

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:198-253` — `AggregatedWidgetRenderer` v1.2 shape (filter subscription + AbortController + useEffect cleanup); Phase 15 ADDS materialize trigger + FROM-swap + badge here
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:852-1068` — `RecordsTableRenderer` v1.2 shape (server-paginated, interactive sort, total count); Phase 15 ADDS view-name FROM-swap + badge subscription here
- `kinetica_bi/src/store/filterStore.ts` — VSTORE-V13-03 lock: chip state byte-unchanged. Phase 15 DELETES the four utility functions at lines 104-195 (`escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`)
- `kinetica_bi/src/store/filterStore.spec.ts` — Phase 15 deletes test blocks for the four removed utilities
- `kinetica_bi/src/store/filterViewStore.ts` — Phase 14's dormant slice; Phase 15 wires the first production caller. Reference-stable per-table update pattern at `setView` / `markMaterializing`
- `kinetica_bi/src/api/client.ts:570-612` — Phase 14's dormant `materializeFilter` + `dropFilterView` helpers; Phase 15 wires the first production caller. AbortSignal threading already in place
- `kinetica_bi/src/App.tsx:40-44` — `useFilterStore.reset()` on logout. Phase 15 LIFE-V13-03 EXTENDS this hook to also reset `useFilterViewStore` + fire-and-forget DROPs
- `kinetica_bi/src/components/DashboardsPage.tsx:379-383` — `useFilterStore.reset()` on dashboard switch. Phase 15 LIFE-V13-04 EXTENDS this hook similarly
- `kinetica_bi/src/components/DashboardsPage.tsx` § `DashboardOpen` component — Phase 15 wraps its widget grid in `<DashboardContext.Provider value={{ dashboardId: dashboard.id }}>`
- `kinetica_bi/src/store/toast.ts` — `useToastStore.getState().showToast(message, kind)` for the materialize-failure toast routing
- `kinetica_bi/src/api/client.ts:7-32` — `PermissionError` / `UpstreamError` / `ReauthRequiredError` typed-error classes (returned by `throwForStatus`); Phase 15 catch path uses `instanceof` checks
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Zustand store-reset shim; auto-covers any `create<T>(...)` store imported in a spec via `setupFiles`. Phase 15's renderer specs that read `useFilterViewStore` get reset coverage for free
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — Phase 15 extends with materialize-trigger + FROM-swap + badge + recovery assertions

### v1.0/v1.2 anti-pattern locks (still apply)

- **AP-1**: View-name state lives ONLY in `useFilterViewStore` — no useState shadow copies in renderers
- **AP-3**: All filter values continue to flow through the server-side WHERE clause (Phase 13's `whereClause.ts`); Phase 15 DELETES the client-side counterparts atomically with FROM-swap landing
- **AP-4**: `tableId` is `number`, persisted at config-save time; reads from `widget.config.tableId` (no runtime lookup)
- **C-02 / S-02**: Hot widgets MUST scope selectors to `views[tableId]` — never read whole `views` map; `filterVersion` (primitive) drives `useEffect` deps, never the array reference
- **C-03**: Clear `data` to null on filter change → show loading, not stale data (Phase 9 lock — Phase 15 inherits via the existing chart-query effect; the new "Filtering..." badge OVERLAYS but does not replace this behavior — REQUIREMENTS FILT-V13-04 locks "existing chart data remains visible underneath" specifically for the materialize phase)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 14 dormant plumbing** (`useFilterViewStore` + `materializeFilter` + `dropFilterView`) — Phase 15 wires the first production caller. All store actions, helper signatures, and AbortSignal threading already exist; Phase 15 is consumer-side only.
- **`useFilterStore`** (`src/store/filterStore.ts`, ~195 LOC after deletion: ~95 LOC) — chip state byte-unchanged; the four utility functions delete to atomic with FROM-swap. `addFilter` / `removeFilter` / `clearFilters` / `reset` continue to drive what's in `filters[tableId]`; Phase 15 reads this to decide materialize-vs-drop.
- **`useToastStore`** (`src/store/toast.ts`) — already wired into v1.0 typed-error chain; Phase 15 routes `PermissionError` / `UpstreamError` from `materializeFilter` failures here.
- **Typed-error classes** (`src/api/client.ts:7-32`) — `PermissionError`, `UpstreamError`, `ReauthRequiredError`. `throwForStatus` returns them; Phase 15 catches via `instanceof`.
- **Zustand reset shim** (`__mocks__/zustand.ts` + `src/test/setup.ts`) — auto-covers `useFilterViewStore` + `useFilterStore` between vitest runs. Phase 15's renderer specs inherit.
- **Existing widget card chrome** — REQUIREMENTS lock + user decision: badge inline next to widget title. Planner reads existing chrome layout in `WidgetRenderer.tsx` and `widget-card.css` (or equivalent) to find the title insertion point.
- **Existing `dispatchDrillDown` + `useFilterStore.addFilter` flow** — Phase 10 wiring is unchanged; the `filterVersion++` trigger that Phase 15's materialize-effect listens to is already in place.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per `CONVENTIONS.md`)
- 2-space indent; no formatter — match existing style
- Zustand consumer pattern: `const slice = useFilterViewStore((s) => s.views[tableId])` — scoped selector for hot widgets
- Inline pitfall-comment style: comments reference PITFALL IDs (e.g., `// V13-P-01 lock`) so future readers can trace decisions
- Test specs colocated next to source as `*.spec.{ts,tsx}`; vitest auto-discovers via `src/**/*.spec.{ts,tsx}` glob
- AbortController pattern in chart-query effect: `useEffect` creates controller; cleanup calls `abort()`. Phase 15 ADDS a SECOND `materializeAbortRef` separate from the chart-query controller.
- Debounce pattern: `setTimeout` + `clearTimeout` in `useEffect` cleanup (matches LayersModal auto-save at `LayersModal.tsx` 300ms debounce)
- Reference-stable per-table updates (`useFilterViewStore` already does this) — selector subscriptions for one tableId don't re-fire on other tables' mutations

### Integration Points

- **AggregatedWidgetRenderer** (`WidgetRenderer.tsx:198-253`) — primary site of new code: materialize trigger, FROM-swap, badge subscription, error-toast routing, dashboardId-from-context read.
- **RecordsTableRenderer** (`WidgetRenderer.tsx:852-1068`) — secondary FROM-swap consumer: subscribe to `useFilterViewStore.views[tableId]?.viewName` for both the page-fetch and total-count effects; subscribe to `materializing` for badge.
- **DashboardOpen** (`DashboardsPage.tsx`) — wraps widget grid in new `<DashboardContext.Provider value={{ dashboardId: dashboard.id }}>` (15-01).
- **App.tsx:40-44** — extend logout effect to fire `useFilterViewStore.reset()` + fire-and-forget DROPs (15-05 LIFE-V13-03).
- **DashboardsPage.tsx:379-383** — extend dashboard-switch cleanup to fire `useFilterViewStore.reset()` + fire-and-forget DROPs (15-05 LIFE-V13-04).
- **filterStore.ts** — atomic deletion of four utilities (15-02 with FROM-swap landing).
- **filterStore.spec.ts** — atomic deletion of four utility test blocks (15-02).
- **WidgetRenderer.tsx imports** — remove `buildWhereClause`, `injectWhereClause` from line 25-29 import block (15-02).

### Critical: existing convention notes (carry-forward from Phase 14)

- **No `code` field on permission errors**: server returns `{ error: "..." }` with NO `code` field for `KineticaPermissionError`. Phase 15 toast pulls from `err.message` directly.
- **AbortError is silent**: matches Phase 9 `WidgetRenderer.tsx:243` lock — `if (err?.name === "AbortError") return;`. Phase 15's materialize catch path follows.
- **Two stores stay separate**: `useFilterStore` (chip state) and `useFilterViewStore` (view names) intentionally do NOT share state. Phase 15 reads from BOTH but never combines them into a single hook.
- **Materialize-trigger ordering**: `markMaterializing → await materializeFilter → setView` is a NON-NEGOTIABLE sequence (V13-P-01 lock). Never write a viewName before server confirms 200.
- **dashboardId on FilterViewEntry** (recommended addition in 15-02): if `FilterViewEntry` is extended to carry `dashboardId`, the cleanup loops in 15-05 (logout + dashboard-switch) can iterate the entries and fire DROPs without external lookups. Cleanest cleanup; minor schema extension. Phase 14 didn't include it; Phase 15 may.

</code_context>

<specifics>
## Specific Ideas

- **5 fine-grained plans, each ships green** — user explicitly asked for tsc-clean + tests-green at every commit. The dead-code deletion in 15-02 must be in the same commit as the FROM-swap landing for that constraint to hold. Planner must NOT split "remove imports" from "swap to view-name SQL" across plans.
- **"Filtering..." badge inline next to widget title** — matches existing card-header chrome (editable title from v1.2 lives there). Don't introduce floating overlays or new positioning systems; reuse the title-bar layout.
- **Always-show badge with no flicker grace period** — user accepts sub-100ms flicker rather than implementing a delayed-render setTimeout. Aligns with the project's preference for predictable interactive feedback over "smart" debouncing.
- **DashboardContext is intentionally minimal** — `{ dashboardId }` only. User rejected richer scope (associated tableIds, drop helpers, full DashboardDto) to keep the abstraction surgical. Lifecycle stays in App.tsx + DashboardsPage where the existing reset code lives.
- **Throw on missing context** — fail-loud is the user's preference. Tests must wrap renderers in the provider; this is the same idiom React's official docs recommend (and matches how `react-redux` `useSelector` requires `<Provider>`).
- **OIDC S2.b deferred to Phase 17** — Phase 17 owns milestone close anyway; this keeps Phase 15 focused on the FROM-swap pipeline.
- **Recovery before lifecycle (15-04 → 15-05)** — TTL recovery is a renderer-level concern; lifecycle resets are page/app-level. Natural dependency order.
- **Reactive recovery max 1 retry** — never loop indefinitely. If retry's chart query also returns view-not-found, fall through to raw `FROM <table>` (silent UX); if retry's materialize itself fails, toast + fall through.
- **Phase 13 spike S3 verbatim error capture drives `isViewNotFoundError`** — pattern is `/SqlEngine: Object '[^']+' not found/i` substring + Kinetica internal code `S/SDc:1513` at HTTP 400. Documented in STATE.md (Phase 13 lock); Phase 15 implementation MUST match exactly.

</specifics>

<deferred>
## Deferred Ideas

- **Map widget LAYERS-swap** (`MAP-V13-01..06`) — Phase 16 (`map-filtering`)
- **`wmsUrlBuilder.ts` cleanup** (`QUERY` / `FILTER_PARAM` removal; `_v` → `_mv` rename) — Phase 16
- **`MapChartRenderer` Effect 3 dep-array swap** to `viewsKey` from `useFilterViewStore` — Phase 16 (`MAP-V13-04`)
- **End-to-end verification + low-cardinality test fixture** (`VERIFY-V13-01..02`) — Phase 17 (`verification`)
- **OIDC-mode S2.b live DDL re-probe against deployed Kinetica** — Phase 17 (deferred from STATE.md Phase 15 tag at user's request)
- **Once-per-session toast suppression flag** — Phase 17 follow-up if "toast every failure" proves noisy in v1.3 verification (Phase 14 deferred this; Phase 15 inherits the deferral)
- **`bumpMaterializeVersion` callers in `MapChartRenderer`** — Phase 16 (Phase 14 ships the action; Phase 15 has no caller; Phase 16's WMS cache-bust path uses it)
- **Records-table-only dashboard with no AggregatedWidgetRenderer on the same tableId** — known limitation: materialize never fires for that tableId because RecordsTableRenderer is a pure consumer. If v1.3 verification (Phase 17) surfaces this, gap-closure plan added then. Acceptable for current v1.3 scope.
- **`aria-busy` on widget card during materialize** — Claude's Discretion in 15-02; if planner picks not-now, log as a future a11y polish item
- **Recovery failure UX beyond max-1-retry** — Phase 15 falls through to raw table on retry failure; if v1.3 verification shows users are confused, revisit
- **Dashboardless contexts (logout while not on a dashboard)** — `useFilterViewStore` should be empty at that point (any active filter would have been on a dashboard, and dashboard-switch cleanup ran on the way out). If this assumption breaks, Phase 17 verification surfaces it
- **`FilterViewEntry.dashboardId` schema extension timing** — Phase 14 didn't include it; Phase 15 may add in 15-02 (recommended) or 15-05 (when cleanup loops are wired). Planner picks
- **Replace-page-refresh cleanup** — LIFE-V13-05 locks "no client cleanup; Kinetica TTL handles orphans". Phase 15 explicitly does no work here. If TTL turns out insufficient under load, Phase 17 or v2 revisits

</deferred>

---

*Phase: 15-chart-filtering*
*Context gathered: 2026-05-06*
