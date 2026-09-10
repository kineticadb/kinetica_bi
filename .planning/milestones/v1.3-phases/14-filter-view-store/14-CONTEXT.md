# Phase 14: filter-view-store - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Pure client-side infrastructure. Phase 14 ships:

1. **`useFilterViewStore`** Zustand slice — server-resolved view names + `expiresAt` + `materializing` + `materializeVersion` per `tableId`. State + actions + unit tests.
2. **API helpers** in `src/api/client.ts` — `materializeFilter(args, signal?)` and `dropFilterView(args, signal?)`, following the existing `apiFetch` + `throwForStatus` pattern. Helper unit tests with mocked `fetch`.
3. **Zero modifications** to `AggregatedWidgetRenderer`, `RecordsTableRenderer`, `App.tsx`, `DashboardsPage.tsx`, or `useFilterStore`.

**Scope tightening from ROADMAP.md:** Phase 14 success criterion #3 (the renderer-side `materializeAbortRef` trigger wiring on `filterVersion` change) **migrates to Phase 15**. Phase 14 ships the store + helpers as pure plumbing; Phase 15 wires the trigger inside `AggregatedWidgetRenderer` atomically with the FROM-swap consumer side. No intermediate deploy state where DDL fires without consumers — see "Implementation Decisions § Trigger wiring" below.

**Out of scope for Phase 14:**
- Renderer-side trigger wiring (`materializeAbortRef`, 300ms debounce on `filterVersion` change) → Phase 15
- FROM-swap on chart SQL (`FILT-V13-01`, `FILT-V13-02`) → Phase 15
- TTL recovery (`LIFE-V13-01`, `LIFE-V13-02`) → Phase 15
- Logout / dashboard-switch hook extension + fire-and-forget DROP (`LIFE-V13-03`, `LIFE-V13-04`) → Phase 15
- Toast wiring on materialize failure → Phase 15 (decision documented here so the Phase 15 planner inherits it)
- Map LAYERS-swap (`MAP-V13-*`) → Phase 16
- Dead-code deletion (`injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `filterStore.ts`) → Phase 15 (atomic with FROM-swap)

</domain>

<decisions>
## Implementation Decisions

### Trigger wiring scope (user-locked: "Land 14 + 15 atomically")

- Phase 14 does NOT modify `AggregatedWidgetRenderer`. The store + helpers ship dormant — no caller in production code paths.
- ROADMAP.md Phase 14 success criterion #3 ("AggregatedWidgetRenderer is the sole trigger for materialize calls — a dedicated `materializeAbortRef` (separate from the chart-query AbortController) aborts any in-flight materialize before firing a new one on `filterVersion` change") is migrated to Phase 15. The Phase 15 planner treats it as a Phase 15 deliverable.
- VSTORE-V13-02 ("Materialize call is dispatched from `AggregatedWidgetRenderer` ONLY; 300ms debounce; dedicated `materializeAbortRef` separate from chart-query `AbortController`; `setView()` is called only after server confirms 200") effectively migrates to Phase 15. The store-side primitive (200-only `setView()`, separate abort handling) is buildable in Phase 14; the renderer-side dispatch is not.
- Rationale: avoids ~1 phase of wasted DDL on every chart click between Phase 14 deploy and Phase 15 deploy. Cleanest end-state; no feature-flag dead code.

### Store shape (locked by VSTORE-V13-01 + reference-stable updates)

- Slice name: `useFilterViewStore`. Filename: `kinetica_bi/src/store/filterViewStore.ts`. Spec: `kinetica_bi/src/store/filterViewStore.spec.ts`. Located under `src/store/` so the Zustand reset shim (`__mocks__/zustand.ts` via `vi.mock("zustand")` in `src/test/setup.ts`) auto-covers it.
- Shape:
  ```ts
  type FilterViewEntry = {
    viewName: string;
    expiresAt: number;          // epoch ms; client compares against Date.now()
    materializing: boolean;     // true between markMaterializing() and setView()/clearView()
    materializeVersion: number; // increments per CREATE OR REPLACE; sourced by Phase 16 _mv cache-buster
  };
  type FilterViewState = {
    views: Record<number, FilterViewEntry>; // keyed by tableId
    setView: (tableId: number, view: { viewName: string; expiresAt: number }) => void;
    clearView: (tableId: number) => void;
    markMaterializing: (tableId: number) => void;
    bumpMaterializeVersion: (tableId: number) => void;
    reset: () => void;
  };
  ```
- **Reference-stable per-table updates** (mirrors `useDashboardLayersStore.updateLayer` at `dashboardLayersStore.ts:36-46`): when an action mutates entry for `tableId=X`, only that entry's reference changes; entries for other table ids retain their object identity. Lets selector-driven widgets avoid cross-table re-renders (PITFALL C-02 carry-forward).
- **Action semantics:**
  - `markMaterializing(tableId)`: creates an entry if missing, sets `materializing: true`. If entry exists, sets `materializing: true` while preserving `viewName` / `expiresAt` / `materializeVersion` (so the chart can keep showing filtered data while a refresh is in flight).
  - `setView(tableId, { viewName, expiresAt })`: writes (or overwrites) the entry. Sets `materializing: false`. If `viewName` matches the existing entry's `viewName` (same `CREATE OR REPLACE` content swap), increments `materializeVersion` by 1; else (new viewName) initializes `materializeVersion` to 1. **Called only after server returns 200** (no optimistic update).
  - `clearView(tableId)`: deletes entry from `views` map (delete-key semantics, like `clearFilters` in v1.2 filterStore). Used when user clears all filters for the table.
  - `bumpMaterializeVersion(tableId)`: increments existing entry's `materializeVersion` by 1; no-op if entry missing. Reserved for Phase 15/16 cases where the renderer wants to force a WMS cache-bust without a fresh materialize round-trip (e.g., during reactive recovery). Phase 14 ships the action; Phase 14 has no caller.
  - `reset()`: clears `views` to `{}`. Internal-only (no App.tsx / DashboardsPage.tsx wiring in Phase 14).

### API helpers (locked by VSTORE-V13-04 + Phase 13 endpoint contract)

- Both helpers live in `kinetica_bi/src/api/client.ts` alongside `runSql`, `materializeView`, etc. (NOT a new file — match existing convention; `client.ts` is the single client-side network module).
- Signatures:
  ```ts
  type MaterializeFilterArgs = { dashboardId: number; tableId: number; filters: ActiveFilter[] };
  type MaterializeFilterResponse = { viewName: string; expiresAt: number };

  export const materializeFilter = async (
    args: MaterializeFilterArgs,
    signal?: AbortSignal
  ): Promise<MaterializeFilterResponse> => { ... };

  type DropFilterViewArgs = { dashboardId: number; tableId: number };
  type DropFilterViewResponse = { dropped: true };

  export const dropFilterView = async (
    args: DropFilterViewArgs,
    signal?: AbortSignal
  ): Promise<DropFilterViewResponse> => { ... };
  ```
- `ActiveFilter` is imported from `src/store/filterStore.ts` (existing v1.2 type — Phase 14 does not duplicate it; the server-side `ActiveFilter` in `whereClause.ts` was deliberately duplicated server-side to keep the server frontend-import-free, but the client uses the existing type).
- **Implementation pattern:** `apiFetch` + `throwForStatus` (matches `runSql` at `client.ts:126-143` and v1.2 `materializeView` at `client.ts:419`). Body is JSON for POST; query string for DELETE (matches Phase 13 endpoint contract: `req.query.dashboardId` + `req.query.tableId`).
- **AbortSignal threading:** identical to `runSql`'s pattern at `client.ts:126-143`. Caller (Phase 15 renderer) creates the controller; helper threads `signal` into `apiFetch`.
- **DELETE fire-and-forget semantics:** the helper itself awaits the response and returns `{ dropped: true }` on success. Fire-and-forget is the CALLER's behavior (Phase 15 callers will not `await` the returned promise). Helper does not silently swallow errors — caller decides.

### Error UX (deferred wiring; documented for Phase 15 planner)

User-locked: **toast every failure** (no once-per-session suppression flag).

- `useFilterViewStore` does NOT carry an `errorToastShown` field. State stays minimal.
- Phase 15's `AggregatedWidgetRenderer` catch path will:
  - Catch `PermissionError` (403) → `useToastStore.getState().showToast(message, "error")` where `message` is the error string from the server (matches v1.0 no-code-field convention; per Phase 13 CONTEXT.md `errorMiddleware` rule at `index.ts:812-815`, the server returns `{ error: "..." }` with NO `code` field for permission errors).
  - Catch `UpstreamError` (502) / generic `Error` → `useToastStore.getState().showToast(message, "error")`.
  - Catch `AbortError` → silent (matches v1.2 abort handling at `WidgetRenderer.tsx:243`).
  - On any failure (other than abort), DO NOT call `setView()` — leaves the store entry empty (or in `materializing: false` if `markMaterializing` had been called) so the chart query falls through to raw `FROM <table>`.
- Trade-off accepted: repeated failures (e.g., flaky network, sustained DDL denial) produce repeated toasts. User-acceptable for an internal tool; if it becomes a problem in v1.3 verification, the Phase 17 planner can add suppression. Rejected: silent-with-error-field (defers feedback to Phase 15+ UI; user wanted active feedback).

### Reset wiring scope (user-locked: "Phase 14 ships reset() only")

- Phase 14 ships the `reset()` store action with full unit-test coverage.
- Phase 14 does **NOT** modify `App.tsx:42` (logout → `useFilterStore.reset()`) or `DashboardsPage.tsx:381` (dashboard-switch → `useFilterStore.reset()`).
- Honors REQUIREMENTS.md traceability — LIFE-V13-03 (logout reset extension) and LIFE-V13-04 (dashboard-switch reset extension) stay tagged Phase 15.
- Trade accepted: between Phase 14 deploy and Phase 15 deploy, logout/dashboard-switch leaves stale `useFilterViewStore` entries in memory. Server-side, those views auto-clean via Kinetica's 5-min sliding TTL. No security risk (view-name encodes session; new session can't access another's view).

### Verification (user-locked: "Tests only, no integration test in Phase 14")

- **Store unit tests** (`filterViewStore.spec.ts`):
  - Canary: store starts empty per test (verifies Zustand reset shim coverage).
  - `setView` action: creates new entry; overwrites entry on same `tableId`; sets `materializing: false`; increments `materializeVersion` on same-name overwrite; initializes `materializeVersion: 1` on new viewName.
  - `markMaterializing`: creates new entry with `materializing: true`; preserves existing entry fields when called on existing entry.
  - `clearView`: deletes the key; no-op when key absent.
  - `bumpMaterializeVersion`: increments existing entry's version; no-op when entry missing.
  - `reset`: empties the `views` map.
  - **Reference stability:** mutating entry for `tableId=1` does NOT change the object identity of entry for `tableId=2`.
- **API helper unit tests** (location: planner picks — `client.spec.ts` if exists, else colocated `*.spec.ts`):
  - `materializeFilter` POST shape (URL, JSON body, credentials, signal threading); resolves on 200 with `{ viewName, expiresAt }`.
  - `materializeFilter` 403 path → throws `PermissionError`. 502 path → throws `UpstreamError`. AbortError → propagates.
  - `dropFilterView` DELETE shape (URL with query string `?dashboardId=N&tableId=M`, credentials, signal threading); resolves on 200 with `{ dropped: true }`.
- **No `AggregatedWidgetRenderer` integration test in Phase 14.** Phase 15's integration test will cover both the trigger wiring AND the FROM-swap together — single test surface that exercises the full end-to-end path. Phase 14's renderer-side wiring (currently zero) is trivially covered by static type-checking + Phase 15's integration test.
- Mocking pattern: helper tests use `vi.spyOn(globalThis, "fetch")` or per-test `vi.fn()` replacement, matching the pattern any existing `client.ts` spec uses (planner verifies — if no client.spec.ts exists, follow `wmsUrlBuilder.spec.ts` mock pattern).

### Claude's Discretion

- Exact spec file count and split (one big `filterViewStore.spec.ts` vs split into action-spec / reference-stability-spec).
- Whether helper tests live in a new `client.spec.ts` or colocated `*.spec.ts` per helper. Planner picks based on existing conventions in `kinetica_bi/src/api/`.
- Whether `FilterViewEntry` and request/response types are exported from `filterViewStore.ts` or `client.ts` or both.
- Inline pitfall comments referencing PITFALL IDs (V13-P-09 multi-tab same-user same-session last-write-wins; V13-P-10 abort-controller separation) — match the inline-comment style from `filterStore.ts`.
- Whether the helpers also accept an `AbortController` (not just `AbortSignal`) — pick whichever is more ergonomic; `AbortSignal` matches `runSql`'s existing signature.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone (project-level)

- `.planning/PROJECT.md` § "Current Milestone: v1.3 Unified Dashboard Filtering" — Two-store split rationale (chip state in `useFilterStore`; view names in `useFilterViewStore`); locked architecture; carry-forward rules
- `.planning/REQUIREMENTS.md` § "Client View State Store" — VSTORE-V13-01..04 full specs; § "Lifecycle & Recovery" — LIFE-V13-* (Phase 15 territory; read for context only)
- `.planning/ROADMAP.md` § Phase 14 — Goal + 4 success criteria (with the criterion-#3 migration to Phase 15 noted in Domain section above) + canonical refs list
- `.planning/STATE.md` — Phase 13 lockdown (endpoint contract, view-name regex, decisions)

### Phase 13 inheritance (endpoint contract — DO NOT REDEFINE)

- `.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md` — Endpoint shape decisions; view-name format; OIDC sanitization rules; error-translation conventions
- `kinetica_bi/server/src/index.ts:667-728` — `POST /api/filter/materialize` and `DELETE /api/filter/materialize` reference implementation. POST body: `{ dashboardId, tableId, filters }` → returns `{ viewName, expiresAt }`. DELETE query string: `?dashboardId=N&tableId=M` → returns `{ dropped: true }`.
- `kinetica_bi/server/src/lib/viewNaming.ts` — View-name builder; regex `/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/` for any client-side validation Phase 14 may want.
- `kinetica_bi/server/src/lib/whereClause.ts` — Server-side `ActiveFilter` shape (duplicated from frontend). Phase 14's client-side helpers send the existing frontend `ActiveFilter[]`; field-shape parity is the contract.

### v1.3 research (commit `e68080f`)

- `.planning/research/SUMMARY.md` — Synthesized stack + pitfalls + architecture overview for v1.3
- `.planning/research/ARCHITECTURE.md` § filter-view-store, § two-store split rationale, § per-fetch-vs-per-store abort scope
- `.planning/research/PITFALLS.md` — V13-P-09 (multi-tab same-user same-session last-write-wins; deterministic name accepts this); V13-P-10 (abort-controller separation between materialize and chart-query); V13-P-11 (ref-stable per-table updates for selector re-render scoping); V13-P-S1 (server-side WHERE placement — already shipped Phase 13)
- `.planning/research/STACK.md` — Zero new client deps for Phase 14; Zustand version baseline

### Codebase maps (READ BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter — match existing style
- `.planning/codebase/STRUCTURE.md` — `src/store/*.ts` placement; `src/api/client.ts` for network helpers
- `.planning/codebase/STACK.md` — Existing dependency baseline (Zustand, vitest)
- `.planning/codebase/TESTING.md` — Spec naming + setup conventions

### Existing code (mandatory read before writing)

- `kinetica_bi/src/store/dashboardLayersStore.ts` — **closest template for Phase 14's reference-stable per-id update pattern** (lines 36-46 `updateLayer`); same `create<T>((set) => ({...}))` shape; ~55 LOC; documented "auto-covered by Zustand reset shim" comment
- `kinetica_bi/src/store/auth.ts` — Zustand template (~70 LOC); shape reference
- `kinetica_bi/src/store/filterStore.ts` — **DO NOT MODIFY** — VSTORE-V13-03 lock: byte-for-byte unchanged. `ActiveFilter` type imported from here by Phase 14's helpers.
- `kinetica_bi/src/api/client.ts` — `apiFetch` (line 36); `throwForStatus` (line 61); `runSql` signature with `signal?: AbortSignal` (line 126); `PermissionError` / `UpstreamError` / `ReauthRequiredError` classes (lines 7-32); `materializeView` (line 419) reference for v1.0 materialize-style helper
- `kinetica_bi/__mocks__/zustand.ts` — Zustand store-reset shim; auto-covers any `create<T>(...)` store imported in a spec via `setupFiles`
- `kinetica_bi/src/test/setup.ts` — `vi.mock("zustand")` activation; afterEach cleanup
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:215-253` — Phase 9 `AggregatedWidgetRenderer` pattern (filter subscription + AbortController + useEffect cleanup). **Phase 14 does NOT modify this file** — referenced so the planner understands the trigger that Phase 15 will wire alongside this code.
- `kinetica_bi/src/App.tsx:40-44` — `useFilterStore.reset()` on logout. **Phase 14 does NOT modify this file** — Phase 15 LIFE-V13-03 extends it.
- `kinetica_bi/src/components/DashboardsPage.tsx:379-383` — `useFilterStore.reset()` on dashboard switch. **Phase 14 does NOT modify this file** — Phase 15 LIFE-V13-04 extends it.

### v1.2 / v1.0 anti-pattern locks (still apply)

- **AP-1**: View-name state lives ONLY in `useFilterViewStore` — no useState shadow copies in components (Phase 15 enforces; Phase 14 simply provides the source of truth).
- **C-02 / S-02**: Selector scope = `views[tableId]` for hot widgets; full `views` only for page-level components. Reference-stable updates make this safe.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useDashboardLayersStore`** (`src/store/dashboardLayersStore.ts`, ~55 LOC) — closest template. Mirror for `useFilterViewStore`. Same `create<T>((set) => ({...}))` shape; same reference-stable update pattern (`updateLayer` lines 36-46) — copy that idiom for `setView` and `markMaterializing`.
- **`apiFetch` + `throwForStatus`** (`src/api/client.ts:36, 61`) — single source of truth for credentialed network calls. New helpers MUST use both. `throwForStatus` already maps 401 → `ReauthRequiredError`, 403 → `PermissionError`, 502 → `UpstreamError` — Phase 14's helpers get this for free.
- **Typed-error classes** (`src/api/client.ts:7-32`) — `PermissionError`, `UpstreamError`, `ReauthRequiredError`. Thrown by `throwForStatus`; consumed by `useApiQuery`'s typed-error chain (Phase 15 renderer integration uses this).
- **Zustand reset shim** (`__mocks__/zustand.ts` + `src/test/setup.ts`) — covers any new store under `src/store/*.ts` automatically. Include the inline doc comment "auto-covered by Zustand reset shim" matching `useDashboardLayersStore` lines 13-15.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per `CONVENTIONS.md`)
- 2-space indent; no formatter — match existing style
- Zustand pattern: `create<StateType>((set) => ({ ...state, ...actions }))` — actions colocated with state on same object
- Inline pitfall-comment style: comments reference PITFALL IDs (e.g., `// V13-P-10 lock`) so future readers can trace decisions
- Test specs colocated next to source as `*.spec.{ts,tsx}`; vitest auto-discovers via existing `src/**/*.spec.{ts,tsx}` glob
- Reference-stable updates: only the mutated entry gets a new object reference (see `dashboardLayersStore.updateLayer` for the exact idiom)

### Integration Points

- **Phase 15 consumers** — `AggregatedWidgetRenderer` will subscribe to `useFilterViewStore.views[tableId]` via selector; will fire `materializeFilter` on `filterVersion` change with debounce + `materializeAbortRef`; will catch errors and route to `useToastStore`. Phase 14 ships the API surface that Phase 15 consumes.
- **Phase 15 lifecycle wiring** — `App.tsx:40-44` and `DashboardsPage.tsx:379-383` will be extended (in Phase 15) to call `useFilterViewStore.reset()` alongside the existing `useFilterStore.reset()`, plus fire `dropFilterView` for each active view (LIFE-V13-03/04).
- **Phase 16 consumers** — `MapChartRenderer` will subscribe to `useFilterViewStore.views[tableId].viewName` (for `LAYERS=`) and `.materializeVersion` (for `_mv` cache-buster). Phase 14 must ensure these fields are stable enough for OL ImageWMS source `updateParams` callers.

### Critical: existing convention notes

- **No `code` field on permission errors**: server convention from `index.ts:812-815` returns `{ error: "..." }` with NO `code` field for `KineticaPermissionError`. The REQUIREMENTS.md `code: "DDL_DENIED"` mention was a placeholder; existing convention wins. Client-side, `PermissionError.message` carries the server's text — Phase 15's toast pulls from `err.message`.
- **AbortError is silent**: matches Phase 9 lock at `WidgetRenderer.tsx:243` — `if (err?.name === "AbortError") return;`. Phase 14's helpers DO NOT swallow AbortError; they let it propagate. Phase 15's catch path silences it.
- **`useFilterStore` is a separate concept from `useFilterViewStore`**: chip state + drill-down dispatch + 10-cap stay in the existing v1.2 slice (VSTORE-V13-03 lock). View names + `expiresAt` + `materializing` + `materializeVersion` go in the new slice. The two stores intentionally do NOT share state.

</code_context>

<specifics>
## Specific Ideas

- **Mirror `useDashboardLayersStore` more than `useAuthStore`** — the per-id reference-stable update pattern at `dashboardLayersStore.ts:36-46` is exactly what Phase 14 needs for per-tableId entry updates; auth store's flatter shape is less applicable here.
- **"Pure plumbing phase"** — Phase 14 is deliberately code-only. No user-visible behavior change ships in this phase alone; the value lands when Phase 15 wires the trigger. This is the cleanest staging given that `AggregatedWidgetRenderer` is the trigger's correct home AND the FROM-swap consumer's correct home — splitting them across phases produces wasted DDL.
- **Toast-every-failure is a deliberate trade** — user accepts repeated toasts on flaky failures rather than carrying a once-per-session suppression flag in the store. State stays minimal; if it becomes a UX problem it's a Phase 17 follow-up.
- **`dropFilterView` is fire-and-forget at the call site, not in the helper** — the helper itself awaits the response and returns `{ dropped: true }` (matches `materializeView` style). Phase 15 callers will not `await` the returned promise. Helper does not silently swallow errors.

</specifics>

<deferred>
## Deferred Ideas

- **Renderer-side trigger wiring** (`materializeAbortRef`, 300ms debounce, dispatch on `filterVersion` change) — Phase 15 (was ROADMAP.md success criterion #3 for Phase 14; user-locked migration to keep Phase 15 atomic with FROM-swap)
- **Toast-on-failure wiring** in `AggregatedWidgetRenderer` — Phase 15 (Phase 14 documents the decision; Phase 15 implements)
- **`useFilterViewStore.reset()` integration into App.tsx and DashboardsPage.tsx** — Phase 15 (LIFE-V13-03/04)
- **Fire-and-forget DROP on logout / dashboard-switch** — Phase 15 (LIFE-V13-03/04)
- **Once-per-session toast suppression flag** — Phase 17 follow-up if toast-every-failure proves noisy in v1.3 verification
- **Proactive TTL expiry recovery (`expiresAt` check before chart query)** — Phase 15 LIFE-V13-01
- **Reactive TTL expiry recovery (`isViewNotFoundError` catch + retry)** — Phase 15 LIFE-V13-02; pattern locked to `/SqlEngine: Object '[^']+' not found/i` substring + Kinetica code `S/SDc:1513` per Phase 13 STATE.md
- **`bumpMaterializeVersion` callers** — Phase 15/16 reactive recovery + map cache-bust paths. Phase 14 ships the action; no Phase 14 caller.
- **OIDC-mode DDL re-probe (S2.b deferred from Phase 13)** — Phase 15 LIFE-V13-02 OR Phase 17 verification before milestone close
- **Phase 16 `_mv` cache-buster sourced from `useFilterViewStore.materializeVersion[tableId]`** — Phase 16 (Phase 14 ensures the field is stable + reference-friendly for OL ImageWMS source `updateParams`)

</deferred>

---

*Phase: 14-filter-view-store*
*Context gathered: 2026-05-06*
